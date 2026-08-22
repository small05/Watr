/**
 * 窗口管理器 - BaseWindow + WebContentsView 三视图架构
 *
 * 【v1.1 增强】
 * - 新增导航栏 WebContentsView（40px 高度）
 * - 布局：左侧上方导航栏 + 下方浏览器视图，右侧控制面板
 * - 录制停止后聚焦面板视图（修复 URL 输入框焦点丢失）
 * - 支持隐私模式 session 切换
 */

import { BaseWindow, WebContentsView, Session, session as electronSession, screen } from 'electron'
import { join } from 'path'
import { RecordingEngine } from './recording-engine'
import { ViewportEmulator } from './viewport-emulator'

const BROWSER_RATIO = 0.75
const PANEL_RATIO = 0.25
const NAVBAR_HEIGHT = 40
const MIN_WIDTH = 1280
const MIN_HEIGHT = 800

export class WindowManager {
  private mainWindow: BaseWindow | null = null
  private navbarView: WebContentsView | null = null
  private browserView: WebContentsView | null = null
  private panelView: WebContentsView | null = null
  private viewportEmulator: ViewportEmulator | null = null
  private currentSession: Session

  constructor(
    private defaultSession: Session,
    private recordingEngine: RecordingEngine
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

    // ---- 创建导航栏视图（40px 高度） ----
    this.navbarView = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/navbar-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    // ---- 创建浏览器视图 ----
    this.browserView = new WebContentsView({
      webPreferences: {
        session: this.currentSession,
        preload: join(__dirname, '../preload/browser-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webviewTag: false
      }
    })

    this.browserView.webContents.setWebRTCIPHandlingPolicy(
      'disable_non_proxied_udp'
    )

    // ---- 创建控制面板视图 ----
    this.panelView = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/panel-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    // ---- 挂载三个子视图 ----
    this.mainWindow.contentView.addChildView(this.navbarView)
    this.mainWindow.contentView.addChildView(this.browserView)
    this.mainWindow.contentView.addChildView(this.panelView)

    // ---- 设置布局 ----
    this.updateLayout()
    this.mainWindow.on('resize', () => this.updateLayout())

    // ---- 初始化虚拟视口 ----
    this.viewportEmulator = new ViewportEmulator(this.browserView.webContents)

    // ---- 加载导航栏 ----
    if (process.env.ELECTRON_RENDERER_URL) {
      // 开发模式：从 vite dev server 加载
      const devUrl = process.env.ELECTRON_RENDERER_URL
      this.navbarView.webContents.loadURL(devUrl.replace(/\/$/, '') + '/navbar.html')
    } else {
      this.navbarView.webContents.loadFile(
        join(__dirname, '../renderer/navbar.html')
      )
    }

    // ---- 加载控制面板 ----
    if (process.env.ELECTRON_RENDERER_URL) {
      this.panelView.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      this.panelView.webContents.loadFile(
        join(__dirname, '../renderer/index.html')
      )
    }

    // ---- 浏览器默认空白页 ----
    this.browserView.webContents.loadURL('about:blank')

    // ---- 监听浏览器 URL 变化，推送到导航栏 ----
    this.setupBrowserUrlTracking()

    // ---- 延迟显示窗口 ----
    setTimeout(() => {
      this.mainWindow?.show()
    }, 300)

    this.mainWindow.on('closed', () => {
      this.mainWindow = null
      this.navbarView = null
      this.browserView = null
      this.panelView = null
    })
  }

  /**
   * 监听浏览器视图的 URL 变化，实时推送给导航栏
   */
  private setupBrowserUrlTracking(): void {
    if (!this.browserView || !this.navbarView) return

    const bwc = this.browserView.webContents
    const nwc = this.navbarView.webContents

    const pushUrlState = () => {
      if (nwc.isDestroyed() || bwc.isDestroyed()) return
      nwc.send('nav:url-changed', {
        url: bwc.getURL(),
        title: bwc.getTitle(),
        canGoBack: bwc.canGoBack(),
        canGoForward: bwc.canGoForward()
      })
    }

    bwc.on('did-navigate', pushUrlState)
    bwc.on('did-navigate-in-page', pushUrlState)
    bwc.on('page-title-updated', pushUrlState)
    bwc.on('did-finish-load', pushUrlState)
  }

  /** 重新计算布局 */
  private updateLayout(): void {
    if (!this.mainWindow || !this.navbarView || !this.browserView || !this.panelView) return

    const bounds = this.mainWindow.getContentBounds()
    const browserWidth = Math.round(bounds.width * BROWSER_RATIO)
    const panelWidth = bounds.width - browserWidth
    const browserHeight = bounds.height - NAVBAR_HEIGHT

    // 导航栏：左侧顶部
    this.navbarView.setBounds({
      x: 0,
      y: 0,
      width: browserWidth,
      height: NAVBAR_HEIGHT
    })

    // 浏览器视图：导航栏下方
    this.browserView.setBounds({
      x: 0,
      y: NAVBAR_HEIGHT,
      width: browserWidth,
      height: browserHeight
    })

    // 控制面板：右侧全高
    this.panelView.setBounds({
      x: browserWidth,
      y: 0,
      width: panelWidth,
      height: bounds.height
    })

    if (this.viewportEmulator) {
      this.viewportEmulator.updateScale(browserWidth, browserHeight)
    }
  }

  // ==================== 导航控制 ====================

  /** 后退 */
  goBack(): void {
    if (this.browserView?.webContents.canGoBack()) {
      this.browserView.webContents.goBack()
    }
  }

  /** 前进 */
  goForward(): void {
    if (this.browserView?.webContents.canGoForward()) {
      this.browserView.webContents.goForward()
    }
  }

  /** 刷新 */
  reload(): void {
    this.browserView?.webContents.reload()
  }

  /** 主页 */
  goHome(): void {
    this.navigateTo('about:blank')
  }

  /** 导航到指定 URL */
  navigateTo(url: string): void {
    if (this.browserView) {
      this.browserView.webContents.loadURL(url)
    }
  }

  // ==================== Session 管理（隐私模式） ====================

  /**
   * 切换到隐私模式（临时 session）
   */
  switchToPrivateSession(): void {
    const privateSession = electronSession.fromPartition(`temp_private_${Date.now()}`)
    this.applySessionSettings(privateSession)
    this.currentSession = privateSession
    this.recreateBrowserView()
  }

  /**
   * 切换回正常模式（持久化 session）
   */
  switchToNormalSession(): void {
    this.currentSession = this.defaultSession
    this.recreateBrowserView()
  }

  /**
   * 清除当前 session 的所有存储数据
   */
  async clearSessionData(): Promise<void> {
    await this.currentSession.clearStorageData()
    await this.currentSession.clearCache()
    // 刷新浏览器使清除生效
    this.browserView?.webContents.reload()
  }

  /** 对新 session 应用反指纹设置 */
  private applySessionSettings(targetSession: Session): void {
    // 导入反指纹模块的设置函数（延迟导入避免循环依赖）
    const { setupAntiFingerprint } = require('./anti-fingerprint')
    setupAntiFingerprint(targetSession)
  }

  /**
   * 重建浏览器视图（切换 session 时需要）
   */
  private recreateBrowserView(): void {
    if (!this.mainWindow || !this.browserView) return

    // 移除旧视图
    this.mainWindow.contentView.removeChildView(this.browserView)

    // 创建新视图
    this.browserView = new WebContentsView({
      webPreferences: {
        session: this.currentSession,
        preload: join(__dirname, '../preload/browser-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webviewTag: false
      }
    })

    this.browserView.webContents.setWebRTCIPHandlingPolicy(
      'disable_non_proxied_udp'
    )

    this.mainWindow.contentView.addChildView(this.browserView)
    this.updateLayout()
    this.setupBrowserUrlTracking()

    // 更新虚拟视口
    this.viewportEmulator = new ViewportEmulator(this.browserView.webContents)

    // 重新绑定录制引擎
    this.recordingEngine.bindWebContents(this.browserView.webContents)

    this.browserView.webContents.loadURL('about:blank')
  }

  // ==================== 视图访问器 ====================

  getBrowserWebContents() {
    return this.browserView?.webContents ?? null
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

  /**
   * 聚焦面板视图（录制停止后调用，修复 URL 输入框焦点问题）
   */
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
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore()
      }
      this.mainWindow.focus()
    }
  }
}
