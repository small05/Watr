/**
 * 窗口管理器 v1.2 - 标签页 + 右键菜单 + Profile 切换
 *
 * 【v1.2 增强】
 * - 多标签页管理（BrowserTab[]）
 * - 原生右键菜单（新标签页打开、后退/前进/刷新、复制等）
 * - setWindowOpenHandler 拦截 target="_blank"
 * - Profile 切换重建浏览器视图
 * - 导航栏 72px（标签栏 32px + 地址栏 40px）
 * - 只录制活动标签页
 */

import {
  BaseWindow, WebContentsView, Session, Menu, MenuItem,
  session as electronSession, screen, clipboard
} from 'electron'
import { join } from 'path'
import { RecordingEngine } from './recording-engine'
import { ViewportEmulator } from './viewport-emulator'
import { ProfileManager, BrowserProfile } from './profile-manager'
import { buildFingerprintInjectionScript } from './fingerprint-injector'
import { setupAntiFingerprint } from './anti-fingerprint'

const BROWSER_RATIO = 0.75
const PANEL_RATIO = 0.25
const NAVBAR_HEIGHT = 72
const MIN_WIDTH = 1280
const MIN_HEIGHT = 800

export interface BrowserTab {
  id: string
  view: WebContentsView
  title: string
  url: string
  isActive: boolean
}

export class WindowManager {
  private mainWindow: BaseWindow | null = null
  private navbarView: WebContentsView | null = null
  private panelView: WebContentsView | null = null
  private viewportEmulator: ViewportEmulator | null = null
  private currentSession: Session
  private tabs: BrowserTab[] = []
  private activeTabId: string = ''

  constructor(
    private defaultSession: Session,
    private recordingEngine: RecordingEngine,
    private profileManager: ProfileManager
  ) {
    this.currentSession = defaultSession
  }

  async createWindow(): Promise<void> {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: screenW, height: screenH } = primaryDisplay.workAreaSize
    const winWidth = Math.max(Math.round(screenW * 0.85), MIN_WIDTH)
    const winHeight = Math.max(Math.round(screenH * 0.85), MIN_HEIGHT)

    this.mainWindow = new BaseWindow({
      width: winWidth,
      height: winHeight,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      title: 'Watr - Web Action Trajectory Recorder',
      show: false,
      backgroundColor: '#1a1a2e'
    })

    // ---- 导航栏视图 ----
    this.navbarView = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/navbar-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    // ---- 控制面板视图 ----
    this.panelView = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/panel-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    // ---- 挂载 ----
    this.mainWindow.contentView.addChildView(this.navbarView)
    this.mainWindow.contentView.addChildView(this.panelView)

    // ---- 创建默认标签页 ----
    await this.createTab('about:blank')

    // ---- 布局 ----
    this.updateLayout()
    this.mainWindow.on('resize', () => this.updateLayout())

    // ---- 加载导航栏 ----
    if (process.env.ELECTRON_RENDERER_URL) {
      const devUrl = process.env.ELECTRON_RENDERER_URL
      this.navbarView.webContents.loadURL(devUrl.replace(/\/$/, '') + '/navbar.html')
    } else {
      this.navbarView.webContents.loadFile(join(__dirname, '../renderer/navbar.html'))
    }

    // ---- 加载控制面板 ----
    if (process.env.ELECTRON_RENDERER_URL) {
      this.panelView.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      this.panelView.webContents.loadFile(join(__dirname, '../renderer/index.html'))
    }

    // ---- 延迟显示 ----
    setTimeout(() => { this.mainWindow?.show() }, 300)

    this.mainWindow.on('closed', () => {
      this.mainWindow = null
      this.navbarView = null
      this.panelView = null
      this.tabs = []
    })
  }

  // ==================== 标签页管理 ====================

  async createTab(url?: string): Promise<BrowserTab> {
    const tabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const view = new WebContentsView({
      webPreferences: {
        session: this.currentSession,
        preload: join(__dirname, '../preload/browser-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webviewTag: false
      }
    })

    view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')

    // 注入指纹伪装
    this.injectProfileFingerprint(view)

    // 右键菜单
    this.setupContextMenu(view, tabId)

    // 拦截 window.open / target="_blank"
    view.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
      this.createTab(linkUrl)
      return { action: 'deny' }
    })

    const tab: BrowserTab = {
      id: tabId,
      view,
      title: '新标签页',
      url: url || 'about:blank',
      isActive: false
    }

    this.tabs.push(tab)

    if (this.mainWindow) {
      this.mainWindow.contentView.addChildView(view)
    }

    // 切换到新标签页
    this.switchToTab(tabId)

    // 监听 URL 变化
    this.setupTabTracking(tab)

    // 加载 URL
    if (url) {
      view.webContents.loadURL(url)
    }

    this.pushTabsState()
    return tab
  }

  switchToTab(tabId: string): void {
    for (const tab of this.tabs) {
      if (tab.id === tabId) {
        tab.isActive = true
        this.activeTabId = tabId
        // 绑定录制引擎到活动标签的 webContents
        this.recordingEngine.bindWebContents(tab.view.webContents)
        this.viewportEmulator = new ViewportEmulator(tab.view.webContents)
      } else {
        tab.isActive = false
      }
    }
    this.updateLayout()
    this.pushTabsState()
    this.pushUrlState()
  }

  closeTab(tabId: string): void {
    const tabIndex = this.tabs.findIndex(t => t.id === tabId)
    if (tabIndex === -1) return

    // 不能关闭最后一个标签页
    if (this.tabs.length <= 1) return

    const tab = this.tabs[tabIndex]

    if (this.mainWindow) {
      this.mainWindow.contentView.removeChildView(tab.view)
    }
    tab.view.webContents.close()
    this.tabs.splice(tabIndex, 1)

    // 如果关闭的是活动标签，切换到相邻标签
    if (tab.isActive) {
      const newActiveIndex = Math.min(tabIndex, this.tabs.length - 1)
      this.switchToTab(this.tabs[newActiveIndex].id)
    }

    this.pushTabsState()
  }

  getTabsList(): Array<{ id: string; title: string; url: string; isActive: boolean }> {
    return this.tabs.map(t => ({
      id: t.id,
      title: t.title,
      url: t.url,
      isActive: t.isActive
    }))
  }

  private getActiveTab(): BrowserTab | undefined {
    return this.tabs.find(t => t.id === this.activeTabId)
  }

  private setupTabTracking(tab: BrowserTab): void {
    const wc = tab.view.webContents

    const update = () => {
      if (wc.isDestroyed()) return
      tab.url = wc.getURL()
      tab.title = wc.getTitle() || '新标签页'
      if (tab.isActive) {
        this.pushUrlState()
      }
      this.pushTabsState()
    }

    wc.on('did-navigate', update)
    wc.on('did-navigate-in-page', update)
    wc.on('page-title-updated', update)
    wc.on('did-finish-load', update)
  }

  // ==================== 右键菜单 ====================

  private setupContextMenu(view: WebContentsView, _tabId: string): void {
    view.webContents.on('context-menu', (_event, params) => {
      const menuItems: Electron.MenuItemConstructorOptions[] = []

      // 链接操作
      if (params.linkURL) {
        menuItems.push({
          label: '在新标签页中打开链接',
          click: () => { this.createTab(params.linkURL) }
        })
        menuItems.push({
          label: '复制链接地址',
          click: () => { clipboard.writeText(params.linkURL) }
        })
        menuItems.push({ type: 'separator' })
      }

      // 选中文本操作
      if (params.selectionText) {
        menuItems.push({
          label: '复制',
          click: () => { clipboard.writeText(params.selectionText) }
        })
        menuItems.push({ type: 'separator' })
      }

      // 导航操作
      menuItems.push({
        label: '后退',
        enabled: view.webContents.canGoBack(),
        click: () => { view.webContents.goBack() }
      })
      menuItems.push({
        label: '前进',
        enabled: view.webContents.canGoForward(),
        click: () => { view.webContents.goForward() }
      })
      menuItems.push({
        label: '刷新',
        click: () => { view.webContents.reload() }
      })

      const menu = Menu.buildFromTemplate(menuItems)
      menu.popup()
    })
  }

  // ==================== 指纹注入 ====================

  private injectProfileFingerprint(view: WebContentsView): void {
    const profile = this.profileManager.getActiveProfile()
    const script = buildFingerprintInjectionScript(profile)

    if (script) {
      // 在每次页面加载前注入
      view.webContents.on('did-start-navigation', () => {
        view.webContents.executeJavaScript(script).catch(() => {})
      })
    }
  }

  // ==================== 导航控制 ====================

  goBack(): void {
    const tab = this.getActiveTab()
    if (tab?.view.webContents.canGoBack()) {
      tab.view.webContents.goBack()
    }
  }

  goForward(): void {
    const tab = this.getActiveTab()
    if (tab?.view.webContents.canGoForward()) {
      tab.view.webContents.goForward()
    }
  }

  reload(): void {
    this.getActiveTab()?.view.webContents.reload()
  }

  goHome(): void {
    this.navigateTo('about:blank')
  }

  navigateTo(url: string): void {
    const tab = this.getActiveTab()
    if (tab) {
      tab.view.webContents.loadURL(url)
    }
  }

  // ==================== 状态推送 ====================

  private pushUrlState(): void {
    const tab = this.getActiveTab()
    if (!tab || !this.navbarView || this.navbarView.webContents.isDestroyed()) return

    this.navbarView.webContents.send('nav:url-changed', {
      url: tab.url,
      title: tab.title,
      canGoBack: tab.view.webContents.canGoBack(),
      canGoForward: tab.view.webContents.canGoForward()
    })
  }

  private pushTabsState(): void {
    if (!this.navbarView || this.navbarView.webContents.isDestroyed()) return

    this.navbarView.webContents.send('nav:tabs-updated', this.getTabsList())
  }

  // ==================== Session / Profile 管理 ====================

  switchToPrivateSession(): void {
    const privateSession = electronSession.fromPartition(`temp_private_${Date.now()}`)
    this.applySessionSettings(privateSession)
    this.currentSession = privateSession
    this.recreateAllTabs()
  }

  switchToNormalSession(): void {
    this.currentSession = this.defaultSession
    this.recreateAllTabs()
  }

  async clearSessionData(): Promise<void> {
    await this.currentSession.clearStorageData()
    await this.currentSession.clearCache()
    this.getActiveTab()?.view.webContents.reload()
  }

  /** 切换 Profile 后重建所有标签页 */
  applyProfile(profileId: string): void {
    this.profileManager.setActiveProfile(profileId)

    const profile = this.profileManager.getActiveProfile()

    // 如果 Profile 指定了 userAgent，更新 Session 层
    if (profile.userAgent) {
      this.currentSession.setUserAgent(profile.userAgent)
    }

    this.recreateAllTabs()
  }

  private applySessionSettings(targetSession: Session): void {
    setupAntiFingerprint(targetSession)
  }

  private recreateAllTabs(): void {
    if (!this.mainWindow) return

    // 保存当前标签的 URL 列表
    const urls = this.tabs.map(t => t.url)
    const activeIndex = this.tabs.findIndex(t => t.isActive)

    // 移除所有旧标签
    for (const tab of this.tabs) {
      this.mainWindow.contentView.removeChildView(tab.view)
      tab.view.webContents.close()
    }
    this.tabs = []

    // 重建标签
    for (let i = 0; i < urls.length; i++) {
      this.createTab(urls[i])
    }

    // 切换到之前的活动标签
    if (this.tabs[activeIndex]) {
      this.switchToTab(this.tabs[activeIndex].id)
    }
  }

  // ==================== 布局 ====================

  private updateLayout(): void {
    if (!this.mainWindow || !this.navbarView || !this.panelView) return

    const bounds = this.mainWindow.getContentBounds()
    const browserWidth = Math.round(bounds.width * BROWSER_RATIO)
    const panelWidth = bounds.width - browserWidth
    const browserHeight = bounds.height - NAVBAR_HEIGHT

    // 导航栏
    this.navbarView.setBounds({
      x: 0, y: 0,
      width: browserWidth,
      height: NAVBAR_HEIGHT
    })

    // 所有标签的视图（只有活动标签显示）
    for (const tab of this.tabs) {
      if (tab.isActive) {
        tab.view.setBounds({
          x: 0, y: NAVBAR_HEIGHT,
          width: browserWidth,
          height: browserHeight
        })
      } else {
        // 隐藏非活动标签
        tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      }
    }

    // 控制面板
    this.panelView.setBounds({
      x: browserWidth, y: 0,
      width: panelWidth,
      height: bounds.height
    })

    if (this.viewportEmulator) {
      this.viewportEmulator.updateScale(browserWidth, browserHeight)
    }
  }

  // ==================== 视图访问器 ====================

  getBrowserWebContents() {
    return this.getActiveTab()?.view.webContents ?? null
  }

  getPanelWebContents() {
    return this.panelView?.webContents ?? null
  }

  getNavbarWebContents() {
    return this.navbarView?.webContents ?? null
  }

  getMainWindow() {
    return this.mainWindow
  }

  focusPanelView(): void {
    if (this.panelView && !this.panelView.webContents.isDestroyed()) {
      this.panelView.webContents.focus()
    }
  }

  async ensureWindow(): Promise<void> {
    if (!this.mainWindow) {
      await this.createWindow()
    }
  }

  focusWindow(): void {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore()
      this.mainWindow.focus()
    }
  }
}
