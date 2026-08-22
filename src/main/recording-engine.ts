/**
 * 录制引擎 - 核心状态机与步骤管理
 *
 * 状态流转：idle → recording → paused → saving → idle
 *
 * 【v1.1 修复与增强】
 * - 修复初始步骤截错页面：等待 did-finish-load 后再抓取
 * - 废弃时删除会话目录和 UI 步骤
 * - 步骤删除/插入/排序功能
 */

import { WebContents } from 'electron'
import { CdpManager } from './cdp-manager'
import { FileWriter, StepData, SessionMeta } from './file-writer'
import { cleanDom } from './dom-cleaner'
import { getCurrentChromeUA } from './anti-fingerprint'

export type RecordingState = 'idle' | 'recording' | 'paused' | 'saving'

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
  /** 插入模式：从指定步骤后插入新步骤 */
  private insertAfterIndex: number = -1

  constructor() {
    this.fileWriter = new FileWriter()
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

  // ==================== 状态控制 ====================

  /**
   * 开始录制
   * 【v1.1】初始导航步骤改为等待页面加载完成后再抓取
   */
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

    // 如果提供了 URL，等待页面加载完成后再录制初始步骤
    if (url && this.webContents) {
      // 注册一次性 did-finish-load 监听器
      this.webContents.once('did-finish-load', async () => {
        // 页面已完全加载，现在抓取的内容是正确的目标页面
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
      this.insertAfterIndex = -1 // 退出插入模式
    }
  }

  /**
   * 从指定步骤后恢复录制（插入模式）
   */
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

  /**
   * 重置废弃当前录制
   * 【v1.1】增加文件删除 + 清空 UI 步骤
   */
  async reset(): Promise<void> {
    const sessionDir = this.fileWriter.getSessionDir()

    // 删除会话目录
    if (sessionDir) {
      await this.fileWriter.deleteSessionDir()
    }

    // 清空内部状态
    this.setState('idle')
    this.stepIndex = 0
    this.steps = []
    this.insertAfterIndex = -1

    // 通知 UI 步骤已全部清空
    this.callbacks.onStepsUpdated?.([])
  }

  // ==================== 步骤管理 ====================

  /**
   * 删除指定步骤
   */
  async deleteStep(targetStepIndex: number): Promise<void> {
    // 从内存中移除
    this.steps = this.steps.filter(s => s.stepIndex !== targetStepIndex)

    // 重新编号
    this.steps.forEach((s, i) => {
      s.stepIndex = i
    })
    this.stepIndex = this.steps.length

    // 在磁盘上删除并重建
    await this.fileWriter.deleteStep(targetStepIndex)
    await this.fileWriter.renumberSteps(this.steps)

    // 通知 UI
    this.callbacks.onStepsUpdated?.(this.getSteps())
  }

  /**
   * 交换两个步骤的顺序
   */
  async swapSteps(indexA: number, indexB: number): Promise<void> {
    if (indexA < 0 || indexB < 0 || indexA >= this.steps.length || indexB >= this.steps.length) return

    // 交换内存中的步骤
    const temp = this.steps[indexA]
    this.steps[indexA] = this.steps[indexB]
    this.steps[indexB] = temp

    // 重新编号
    this.steps.forEach((s, i) => {
      s.stepIndex = i
    })

    // 在磁盘上重建
    await this.fileWriter.renumberSteps(this.steps)

    // 通知 UI
    this.callbacks.onStepsUpdated?.(this.getSteps())
  }

  // ==================== 步骤录制 ====================

  async handleProbeEvent(event: ProbeEvent): Promise<void> {
    if (this.state !== 'recording') return
    if (!this.webContents || !this.cdpManager) return

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

      // 并行执行快照（增加错误容忍）
      const [mhtml, screenshot, rawHtml] = await Promise.all([
        this.cdpManager.captureMHTML().catch(() => null),
        this.cdpManager.captureScreenshotNative().catch(() => Buffer.alloc(0)),
        this.webContents!.executeJavaScript(
          'document.documentElement.outerHTML'
        ).catch(() => '')
      ])

      const cleanedHtml = cleanDom(rawHtml)

      await this.fileWriter.writeStep(stepData, mhtml, cleanedHtml, screenshot)

      // 如果在插入模式，将新步骤插入到指定位置
      if (this.insertAfterIndex >= 0) {
        this.steps.splice(this.insertAfterIndex + 1, 0, stepData)
        // 重新编号所有步骤
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
   * 录制导航步骤
   * 【v1.1】使用实际的当前 URL 和 Title（从 webContents 获取）
   */
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
