/**
 * 窗口管理器 - BaseWindow + WebContentsView 双栏架构
 *
 * 左侧 ~75%: 内置浏览器视图（纯净 Chrome 伪装）
 * 右侧 ~25%: Vue 3 控制面板 UI
 */

import { BaseWindow, WebContentsView, Session, screen } from 'electron'
import { join } from 'path'
import { RecordingEngine } from './recording-engine'
import { ViewportEmulator } from './viewport-emulator'

/** 左右分栏比例 */
const BROWSER_RATIO = 0.75
const PANEL_RATIO = 0.25

/** 最小窗口尺寸 */
const MIN_WIDTH = 1280
const MIN_HEIGHT = 800

export class WindowManager {
  private mainWindow: BaseWindow | null = null
  private browserView: WebContentsView | null = null
  private panelView: WebContentsView | null = null
  private viewportEmulator: ViewportEmulator | null = null

  constructor(
    private session: Session,
    private recordingEngine: RecordingEngine
  ) {}

  async createWindow(): Promise<void> {
    // 获取主屏幕工作区尺寸，自适应窗口大小
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: screenW, height: screenH } = primaryDisplay.workAreaSize
    const winWidth = Math.max(Math.round(screenW * 0.85), MIN_WIDTH)
    const winHeight = Math.max(Math.round(screenH * 0.85), MIN_HEIGHT)

    // ---- 创建 BaseWindow（无默认 webContents 的纯容器） ----
    this.mainWindow = new BaseWindow({
      width: winWidth,
      height: winHeight,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      title: 'Watr - Web Action Trajectory Recorder',
      show: false,
      backgroundColor: '#1a1a2e'
    })

    // ---- 创建左侧：内置浏览器视图 ----
    this.browserView = new WebContentsView({
      webPreferences: {
        session: this.session,
        preload: join(__dirname, '../preload/browser-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // WebRTC 防泄露本机 IP
        webviewTag: false
      }
    })

    // WebRTC 网络策略：禁止泄露非代理 UDP（防止暴露真实局域网 IP）
    this.browserView.webContents.setWebRTCIPHandlingPolicy(
      'disable_non_proxied_udp'
    )

    // ---- 创建右侧：控制面板视图 ----
    this.panelView = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/panel-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    // ---- 挂载两个子视图 ----
    this.mainWindow.contentView.addChildView(this.browserView)
    this.mainWindow.contentView.addChildView(this.panelView)

    // ---- 设置初始布局 ----
    this.updateLayout()

    // ---- 监听窗口 resize 事件，自适应重排布局 ----
    this.mainWindow.on('resize', () => this.updateLayout())

    // ---- 初始化虚拟视口仿真 (1920x1080) ----
    this.viewportEmulator = new ViewportEmulator(this.browserView.webContents)

    // ---- 加载控制面板 UI ----
    // 开发模式使用 Vite dev server，生产模式加载打包文件
    if (process.env.ELECTRON_RENDERER_URL) {
      this.panelView.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      this.panelView.webContents.loadFile(
        join(__dirname, '../renderer/index.html')
      )
    }

    // ---- 默认加载空白页（等待用户输入 URL 或开始录制） ----
    this.browserView.webContents.loadURL('about:blank')

    // ---- 窗口准备好后显示（避免白屏闪烁） ----
    this.mainWindow.once('ready-to-show' as any, () => {
      this.mainWindow?.show()
    })
    // BaseWindow 没有 ready-to-show，延迟 200ms 显示
    setTimeout(() => {
      this.mainWindow?.show()
    }, 200)

    // 窗口关闭事件
    this.mainWindow.on('closed', () => {
      this.mainWindow = null
      this.browserView = null
      this.panelView = null
    })
  }

  /** 根据当前窗口尺寸重新计算并设置子视图 bounds */
  private updateLayout(): void {
    if (!this.mainWindow || !this.browserView || !this.panelView) return

    const bounds = this.mainWindow.getContentBounds()
    const browserWidth = Math.round(bounds.width * BROWSER_RATIO)
    const panelWidth = bounds.width - browserWidth

    this.browserView.setBounds({
      x: 0,
      y: 0,
      width: browserWidth,
      height: bounds.height
    })

    this.panelView.setBounds({
      x: browserWidth,
      y: 0,
      width: panelWidth,
      height: bounds.height
    })

    // 更新视口仿真的缩放比
    if (this.viewportEmulator) {
      this.viewportEmulator.updateScale(browserWidth, bounds.height)
    }
  }

  /** 获取浏览器视图的 webContents */
  getBrowserWebContents() {
    return this.browserView?.webContents ?? null
  }

  /** 获取控制面板视图的 webContents */
  getPanelWebContents() {
    return this.panelView?.webContents ?? null
  }

  /** 获取主窗口 */
  getMainWindow() {
    return this.mainWindow
  }

  /** 在浏览器视图中导航到指定 URL */
  navigateTo(url: string): void {
    if (this.browserView) {
      this.browserView.webContents.loadURL(url)
    }
  }

  /** 确保窗口存在 */
  async ensureWindow(): Promise<void> {
    if (!this.mainWindow) {
      await this.createWindow()
    }
  }

  /** 聚焦窗口 */
  focusWindow(): void {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore()
      }
      this.mainWindow.focus()
    }
  }
}
