/**
 * 录制引擎 - 核心状态机与步骤管理
 *
 * 状态流转：idle → recording → paused → saving → idle
 * 职责：
 * - 管理录制生命周期
 * - 维护步骤计数与时间统计
 * - Cloudflare Challenge 特判
 * - 协调探针数据 → CDP 快照 → 文件落盘的完整管道
 */

import { WebContents } from 'electron'
import { CdpManager } from './cdp-manager'
import { FileWriter, StepData, SessionMeta } from './file-writer'
import { cleanDom } from './dom-cleaner'
import { getCurrentChromeUA } from './anti-fingerprint'

/** 录制状态枚举 */
export type RecordingState = 'idle' | 'recording' | 'paused' | 'saving'

/** 步骤事件（从探针 IPC 传来） */
export interface ProbeEvent {
  actionType: string
  timestamp: string
  pageUrl: string
  pageTitle: string
  description: string
  targetElement: StepData['targetElement']
  inputValue: string | null
}

/** 录制引擎事件回调 */
export interface RecordingCallbacks {
  onStateChange?: (state: RecordingState) => void
  onStepAdded?: (step: StepData) => void
  onError?: (error: Error) => void
}

export class RecordingEngine {
  private state: RecordingState = 'idle'
  private fileWriter: FileWriter
  private cdpManager: CdpManager | null = null
  private webContents: WebContents | null = null
  private stepIndex: number = 0
  private startTime: string = ''
  private initialUrl: string = ''
  private callbacks: RecordingCallbacks = {}
  private steps: StepData[] = []

  constructor() {
    this.fileWriter = new FileWriter()
  }

  /** 绑定浏览器视图的 webContents */
  bindWebContents(wc: WebContents): void {
    this.webContents = wc
    this.cdpManager = new CdpManager(wc)
  }

  /** 设置事件回调 */
  setCallbacks(cb: RecordingCallbacks): void {
    this.callbacks = cb
  }

  /** 获取当前状态 */
  getState(): RecordingState {
    return this.state
  }

  /** 获取所有已记录步骤 */
  getSteps(): StepData[] {
    return [...this.steps]
  }

  /** 获取文件写入器（供 IPC 层使用） */
  getFileWriter(): FileWriter {
    return this.fileWriter
  }

  /** 设置自定义存储目录 */
  setOutputDir(dir: string): void {
    this.fileWriter.setBaseDir(dir)
  }

  // ==================== 状态控制 ====================

  /** 开始录制 */
  async start(url?: string): Promise<void> {
    if (this.state !== 'idle') return

    this.setState('recording')
    this.stepIndex = 0
    this.steps = []
    this.startTime = new Date().toISOString()
    this.initialUrl = url || ''

    // 创建会话目录
    await this.fileWriter.createSession()

    // 写入初始 session_meta.json
    const meta: SessionMeta = {
      sessionId: `rec_${this.formatCompactTimestamp(new Date())}`,
      startTime: this.startTime,
      endTime: null,
      initialUrl: this.initialUrl,
      viewport: { width: 1920, height: 1080 },
      platform: process.platform,
      userAgent: getCurrentChromeUA(),
      totalSteps: 0
    }
    await this.fileWriter.writeSessionMeta(meta)

    // 如果提供了 URL，录制初始导航步骤
    if (url) {
      await this.recordNavigationStep(url, 'init_navigate')
    }
  }

  /** 暂停录制 */
  pause(): void {
    if (this.state === 'recording') {
      this.setState('paused')
    }
  }

  /** 恢复录制 */
  resume(): void {
    if (this.state === 'paused') {
      this.setState('recording')
    }
  }

  /** 结束并保存 */
  async stop(): Promise<string> {
    if (this.state !== 'recording' && this.state !== 'paused') {
      return ''
    }

    this.setState('saving')

    // 更新 session_meta.json 的结束时间和总步数
    await this.fileWriter.updateSessionMeta({
      endTime: new Date().toISOString(),
      totalSteps: this.stepIndex
    })

    const sessionDir = this.fileWriter.getSessionDir()
    this.setState('idle')
    return sessionDir
  }

  /** 重置废弃当前录制 */
  reset(): void {
    this.setState('idle')
    this.stepIndex = 0
    this.steps = []
  }

  // ==================== 步骤录制 ====================

  /**
   * 处理来自探针的事件，执行完整的录制管道：
   * 1. 构建 StepData
   * 2. CDP 瞬态挂载抓取 MHTML
   * 3. 原生截图
   * 4. 获取并清洗 DOM
   * 5. 文件落盘
   */
  async handleProbeEvent(event: ProbeEvent): Promise<void> {
    if (this.state !== 'recording') return
    if (!this.webContents || !this.cdpManager) return

    try {
      // 检测 Cloudflare Challenge 页面
      const isChallenge = this.detectChallengePage(
        event.pageTitle,
        event.pageUrl
      )

      // 构建步骤数据
      const stepData: StepData = {
        stepIndex: this.stepIndex,
        actionType: isChallenge ? 'challenge_detected' : event.actionType,
        timestamp: event.timestamp,
        pageUrl: event.pageUrl,
        pageTitle: event.pageTitle,
        isChallengePage: isChallenge,
        description: isChallenge
          ? `检测到 Cloudflare 人机验证挑战，等待人工完成验证`
          : event.description,
        userNotes: '',
        targetElement: event.targetElement,
        inputValue: event.inputValue
      }

      // 并行执行快照操作
      const [mhtml, screenshot, rawHtml] = await Promise.all([
        // MHTML 快照（CDP 瞬态挂载）
        this.cdpManager.captureMHTML().catch(() => null),
        // 截图降级：优先原生 API
        this.cdpManager.captureScreenshotNative(),
        // 获取 DOM HTML
        this.webContents!.executeJavaScript(
          'document.documentElement.outerHTML'
        ).catch(() => '')
      ])

      // 清洗 DOM
      const cleanedHtml = cleanDom(rawHtml)

      // 写入文件
      await this.fileWriter.writeStep(
        stepData,
        mhtml,
        cleanedHtml,
        screenshot
      )

      // 更新内部状态
      this.steps.push(stepData)
      this.stepIndex++

      // 通知 UI
      this.callbacks.onStepAdded?.(stepData)
    } catch (error) {
      this.callbacks.onError?.(error as Error)
    }
  }

  /**
   * 录制导航步骤（页面跳转）
   */
  async recordNavigationStep(
    url: string,
    actionType: string = 'navigate'
  ): Promise<void> {
    const event: ProbeEvent = {
      actionType,
      timestamp: new Date().toISOString(),
      pageUrl: url,
      pageTitle: '',
      description: `访问目标网站: ${url}`,
      targetElement: null,
      inputValue: null
    }
    await this.handleProbeEvent(event)
  }

  /**
   * 录制 Cloudflare 验证通过步骤
   */
  async recordChallengeResolved(url: string, title: string): Promise<void> {
    const event: ProbeEvent = {
      actionType: 'challenge_resolved',
      timestamp: new Date().toISOString(),
      pageUrl: url,
      pageTitle: title,
      description: '人机验证已通过，页面已成功加载',
      targetElement: null,
      inputValue: null
    }
    await this.handleProbeEvent(event)
  }

  /**
   * 更新步骤的用户注记
   */
  async updateStepNotes(
    stepIndex: number,
    userNotes: string
  ): Promise<void> {
    // 更新内存中的步骤
    const step = this.steps.find((s) => s.stepIndex === stepIndex)
    if (step) {
      step.userNotes = userNotes
    }

    // 更新磁盘文件
    await this.fileWriter.updateStepNotes(stepIndex, userNotes)
  }

  // ==================== 内部工具 ====================

  /**
   * 检测 Cloudflare Challenge 页面
   * 根据页面 Title 或特征节点判定
   */
  private detectChallengePage(title: string, _url: string): boolean {
    const challengeTitles = [
      'Just a moment...',
      'Attention Required',
      'Checking your browser',
      'Please Wait',
      'Security Check'
    ]
    return challengeTitles.some((ct) =>
      title.toLowerCase().includes(ct.toLowerCase())
    )
  }

  /** 更新状态并通知 */
  private setState(newState: RecordingState): void {
    this.state = newState
    this.callbacks.onStateChange?.(newState)
  }

  /** 紧凑时间戳 */
  private formatCompactTimestamp(date: Date): string {
    const y = date.getFullYear()
    const mo = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    const h = String(date.getHours()).padStart(2, '0')
    const mi = String(date.getMinutes()).padStart(2, '0')
    const s = String(date.getSeconds()).padStart(2, '0')
    return `${y}${mo}${d}_${h}${mi}${s}`
  }
}
