/**
 * 录制引擎 - 核心状态机与步骤管理 v1.2
 *
 * 【v1.2 增强】
 * - 轻量录制模式（默认）：不挂载 CDP，使用原生截图
 * - 深度录制模式：按需 CDP 快照
 * - 便携化录制目录
 * - 只录制活动标签页
 */

import { WebContents } from 'electron'
import { CdpManager } from './cdp-manager'
import { FileWriter, StepData, SessionMeta } from './file-writer'
import { cleanDom } from './dom-cleaner'
import { getCurrentChromeUA } from './anti-fingerprint'

export type RecordingState = 'idle' | 'recording' | 'paused' | 'saving'
export type RecordingMode = 'lite' | 'deep'

export interface ProbeEvent {
  actionType: string
  timestamp: string
  pageUrl: string
  pageTitle: string
  description: string
  targetElement: StepData['targetElement']
  inputValue: string | null
}

export interface RecordingCallbacks {
  onStateChange?: (state: RecordingState) => void
  onStepAdded?: (step: StepData) => void
  onStepsUpdated?: (steps: StepData[]) => void
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
  private insertAfterIndex: number = -1
  /** 【v1.2】录制模式：默认轻量模式 */
  private recordingMode: RecordingMode = 'lite'

  constructor(portableRoot?: string) {
    this.fileWriter = new FileWriter(portableRoot)
  }

  bindWebContents(wc: WebContents): void {
    this.webContents = wc
    this.cdpManager = new CdpManager(wc)
  }

  setCallbacks(cb: RecordingCallbacks): void {
    this.callbacks = cb
  }

  getState(): RecordingState {
    return this.state
  }

  getSteps(): StepData[] {
    return [...this.steps]
  }

  getFileWriter(): FileWriter {
    return this.fileWriter
  }

  setOutputDir(dir: string): void {
    this.fileWriter.setBaseDir(dir)
  }

  /** 【v1.2】获取/设置录制模式 */
  getRecordingMode(): RecordingMode {
    return this.recordingMode
  }

  setRecordingMode(mode: RecordingMode): void {
    this.recordingMode = mode
  }

  // ==================== 状态控制 ====================

  async start(url?: string): Promise<void> {
    if (this.state !== 'idle') return

    this.setState('recording')
    this.stepIndex = 0
    this.steps = []
    this.insertAfterIndex = -1
    this.startTime = new Date().toISOString()
    this.initialUrl = url || ''

    await this.fileWriter.createSession()

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

    if (url && this.webContents) {
      this.webContents.once('did-finish-load', async () => {
        if (this.state === 'recording') {
          await this.recordNavigationStep(
            this.webContents!.getURL(),
            'init_navigate'
          )
        }
      })
    }
  }

  pause(): void {
    if (this.state === 'recording') {
      this.setState('paused')
    }
  }

  resume(): void {
    if (this.state === 'paused') {
      this.setState('recording')
      this.insertAfterIndex = -1
    }
  }

  resumeFromStep(stepIndex: number): void {
    if (this.state !== 'paused' && this.state !== 'idle') return
    this.insertAfterIndex = stepIndex
    this.stepIndex = stepIndex + 1
    this.setState('recording')
  }

  async stop(): Promise<string> {
    if (this.state !== 'recording' && this.state !== 'paused') {
      return ''
    }

    this.setState('saving')

    await this.fileWriter.updateSessionMeta({
      endTime: new Date().toISOString(),
      totalSteps: this.steps.length
    })

    const sessionDir = this.fileWriter.getSessionDir()
    this.setState('idle')
    return sessionDir
  }

  async reset(): Promise<void> {
    const sessionDir = this.fileWriter.getSessionDir()
    if (sessionDir) {
      await this.fileWriter.deleteSessionDir()
    }
    this.setState('idle')
    this.stepIndex = 0
    this.steps = []
    this.insertAfterIndex = -1
    this.callbacks.onStepsUpdated?.([])
  }

  // ==================== 步骤管理 ====================

  async deleteStep(targetStepIndex: number): Promise<void> {
    this.steps = this.steps.filter(s => s.stepIndex !== targetStepIndex)
    this.steps.forEach((s, i) => { s.stepIndex = i })
    this.stepIndex = this.steps.length
    await this.fileWriter.deleteStep(targetStepIndex)
    await this.fileWriter.renumberSteps(this.steps)
    this.callbacks.onStepsUpdated?.(this.getSteps())
  }

  async swapSteps(indexA: number, indexB: number): Promise<void> {
    if (indexA < 0 || indexB < 0 || indexA >= this.steps.length || indexB >= this.steps.length) return
    const temp = this.steps[indexA]
    this.steps[indexA] = this.steps[indexB]
    this.steps[indexB] = temp
    this.steps.forEach((s, i) => { s.stepIndex = i })
    await this.fileWriter.renumberSteps(this.steps)
    this.callbacks.onStepsUpdated?.(this.getSteps())
  }

  // ==================== 步骤录制 ====================

  /**
   * 处理探针事件
   * 【v1.2】根据 recordingMode 决定是否调用 CDP
   */
  async handleProbeEvent(event: ProbeEvent): Promise<void> {
    if (this.state !== 'recording') return
    if (!this.webContents) return

    try {
      const isChallenge = this.detectChallengePage(event.pageTitle, event.pageUrl)

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

      // 【v1.2 轻量模式】根据录制模式决定是否调用 CDP
      const useCdp = this.recordingMode === 'deep' && this.cdpManager != null

      const [mhtml, screenshot, rawHtml] = await Promise.all([
        // MHTML：仅深度模式下生成
        useCdp ? this.cdpManager!.captureMHTML().catch(() => null) : Promise.resolve(null),
        // 截图：始终使用原生方式（不触发风控）
        this.webContents!.capturePage().then(img => img.toPNG()).catch(() => Buffer.alloc(0)),
        // DOM：始终通过 JS 获取
        this.webContents!.executeJavaScript(
          'document.documentElement.outerHTML'
        ).catch(() => '')
      ])

      const cleanedHtml = cleanDom(rawHtml)

      await this.fileWriter.writeStep(stepData, mhtml, cleanedHtml, screenshot)

      if (this.insertAfterIndex >= 0) {
        this.steps.splice(this.insertAfterIndex + 1, 0, stepData)
        this.steps.forEach((s, i) => { s.stepIndex = i })
        this.insertAfterIndex++
        this.stepIndex = this.steps.length
        await this.fileWriter.renumberSteps(this.steps)
        this.callbacks.onStepsUpdated?.(this.getSteps())
      } else {
        this.steps.push(stepData)
        this.stepIndex++
        this.callbacks.onStepAdded?.(stepData)
      }
    } catch (error) {
      this.callbacks.onError?.(error as Error)
    }
  }

  /**
   * 【v1.2 新增】手动触发一次深度快照（仅当前步骤）
   * 无论当前录制模式如何，都执行一次 CDP 快照
   */
  async captureDeepSnapshot(): Promise<void> {
    if (this.state !== 'recording' || !this.webContents || !this.cdpManager) return

    try {
      const url = this.webContents.getURL()
      const title = this.webContents.getTitle()

      const stepData: StepData = {
        stepIndex: this.stepIndex,
        actionType: 'deep_snapshot',
        timestamp: new Date().toISOString(),
        pageUrl: url,
        pageTitle: title,
        isChallengePage: false,
        description: `手动深度快照: ${url}`,
        userNotes: '',
        targetElement: null,
        inputValue: null
      }

      const [mhtml, screenshot, rawHtml] = await Promise.all([
        this.cdpManager.captureMHTML().catch(() => null),
        this.webContents.capturePage().then(img => img.toPNG()).catch(() => Buffer.alloc(0)),
        this.webContents.executeJavaScript(
          'document.documentElement.outerHTML'
        ).catch(() => '')
      ])

      const cleanedHtml = cleanDom(rawHtml)
      await this.fileWriter.writeStep(stepData, mhtml, cleanedHtml, screenshot)

      this.steps.push(stepData)
      this.stepIndex++
      this.callbacks.onStepAdded?.(stepData)
    } catch (error) {
      this.callbacks.onError?.(error as Error)
    }
  }

  async recordNavigationStep(url: string, actionType: string = 'navigate'): Promise<void> {
    const actualUrl = this.webContents?.getURL() || url
    const actualTitle = this.webContents?.getTitle() || ''

    const event: ProbeEvent = {
      actionType,
      timestamp: new Date().toISOString(),
      pageUrl: actualUrl,
      pageTitle: actualTitle,
      description: `访问目标网站: ${actualUrl}`,
      targetElement: null,
      inputValue: null
    }
    await this.handleProbeEvent(event)
  }

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

  async updateStepNotes(stepIndex: number, userNotes: string): Promise<void> {
    const step = this.steps.find((s) => s.stepIndex === stepIndex)
    if (step) {
      step.userNotes = userNotes
    }
    await this.fileWriter.updateStepNotes(stepIndex, userNotes)
  }

  // ==================== 内部工具 ====================

  private detectChallengePage(title: string, _url: string): boolean {
    const challengeTitles = [
      'Just a moment...', 'Attention Required',
      'Checking your browser', 'Please Wait', 'Security Check'
    ]
    return challengeTitles.some((ct) =>
      title.toLowerCase().includes(ct.toLowerCase())
    )
  }

  private setState(newState: RecordingState): void {
    this.state = newState
    this.callbacks.onStateChange?.(newState)
  }

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
