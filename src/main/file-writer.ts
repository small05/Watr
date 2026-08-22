/**
 * 文件系统持久化引擎
 *
 * 职责：
 * - 创建会话目录 record_session_YYYYMMDD_HHMMSS/
 * - 按步骤序列创建 step_XXX_actionType/ 子目录
 * - 异步写入 action.json, description.txt, page_snapshot.mhtml,
 *   page_dom.cleaned.html, screenshot.png
 * - 管理 session_meta.json 全局元数据
 *
 * 路径策略：
 * - 默认基准路径：app.getPath('documents')/Watr/
 * - 严禁使用相对路径写入程序工作目录
 * - 支持 UI 自定义落盘目录
 */

import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

/** 步骤数据结构 */
export interface StepData {
  stepIndex: number
  actionType: string
  timestamp: string
  pageUrl: string
  pageTitle: string
  isChallengePage: boolean
  description: string
  userNotes: string
  targetElement: {
    tagName: string
    id: string
    classList: string[]
    innerText: string
    role: string | null
    ariaLabel: string | null
    xpath: string
    cssSelector: string
    playwrightSelector: string
    boundingBox: { x: number; y: number; width: number; height: number }
  } | null
  inputValue: string | null
}

/** 会话元数据 */
export interface SessionMeta {
  sessionId: string
  startTime: string
  endTime: string | null
  initialUrl: string
  viewport: { width: number; height: number }
  platform: string
  userAgent: string
  totalSteps: number
}

export class FileWriter {
  private sessionDir: string = ''
  private baseDir: string
  private stepCount: number = 0

  constructor(customBaseDir?: string) {
    // 默认存储在 Documents/Watr/
    this.baseDir = customBaseDir || join(app.getPath('documents'), 'Watr')
  }

  /** 更新存储基准目录 */
  setBaseDir(dir: string): void {
    this.baseDir = dir
  }

  /** 获取当前基准目录 */
  getBaseDir(): string {
    return this.baseDir
  }

  /**
   * 创建新的录制会话目录
   * @returns 会话目录绝对路径
   */
  async createSession(): Promise<string> {
    const now = new Date()
    const timestamp = this.formatTimestamp(now)
    const sessionId = `rec_${timestamp}`
    this.sessionDir = join(this.baseDir, `record_session_${timestamp}`)
    this.stepCount = 0

    await fs.mkdir(this.sessionDir, { recursive: true })
    return this.sessionDir
  }

  /**
   * 写入会话全局元数据 session_meta.json
   */
  async writeSessionMeta(meta: SessionMeta): Promise<void> {
    const filePath = join(this.sessionDir, 'session_meta.json')
    await fs.writeFile(filePath, JSON.stringify(meta, null, 2), 'utf-8')
  }

  /**
   * 更新会话元数据（增量更新，如结束时间和总步数）
   */
  async updateSessionMeta(
    updates: Partial<SessionMeta>
  ): Promise<void> {
    const filePath = join(this.sessionDir, 'session_meta.json')
    try {
      const raw = await fs.readFile(filePath, 'utf-8')
      const meta = JSON.parse(raw)
      Object.assign(meta, updates)
      await fs.writeFile(filePath, JSON.stringify(meta, null, 2), 'utf-8')
    } catch {
      // 如果文件不存在，跳过
    }
  }

  /**
   * 写入单个步骤的完整数据
   */
  async writeStep(
    stepData: StepData,
    mhtml: string | null,
    cleanedHtml: string,
    screenshot: Buffer
  ): Promise<string> {
    const stepIndex = String(stepData.stepIndex).padStart(3, '0')
    const dirName = `step_${stepIndex}_${this.sanitizeDirName(stepData.actionType)}`
    const stepDir = join(this.sessionDir, dirName)

    await fs.mkdir(stepDir, { recursive: true })

    // 并行写入所有文件
    const writes: Promise<void>[] = []

    // 1. action.json
    writes.push(
      fs.writeFile(
        join(stepDir, 'action.json'),
        JSON.stringify(stepData, null, 2),
        'utf-8'
      )
    )

    // 2. description.txt
    const descText = this.buildDescriptionText(stepData)
    writes.push(
      fs.writeFile(join(stepDir, 'description.txt'), descText, 'utf-8')
    )

    // 3. page_snapshot.mhtml（可能为 null，如截图降级时不捕获 MHTML）
    if (mhtml) {
      writes.push(
        fs.writeFile(join(stepDir, 'page_snapshot.mhtml'), mhtml, 'utf-8')
      )
    }

    // 4. page_dom.cleaned.html
    writes.push(
      fs.writeFile(
        join(stepDir, 'page_dom.cleaned.html'),
        cleanedHtml,
        'utf-8'
      )
    )

    // 5. screenshot.png
    writes.push(fs.writeFile(join(stepDir, 'screenshot.png'), screenshot))

    await Promise.all(writes)

    this.stepCount++
    return stepDir
  }

  /**
   * 更新某个步骤的用户注记
   * 同时更新 action.json 的 userNotes 字段和 description.txt
   */
  async updateStepNotes(
    stepIndex: number,
    userNotes: string
  ): Promise<void> {
    const stepDirs = await this.findStepDir(stepIndex)
    if (!stepDirs) return

    // 更新 action.json
    const actionPath = join(stepDirs, 'action.json')
    try {
      const raw = await fs.readFile(actionPath, 'utf-8')
      const action = JSON.parse(raw)
      action.userNotes = userNotes
      await fs.writeFile(actionPath, JSON.stringify(action, null, 2), 'utf-8')

      // 重新生成 description.txt
      const descText = this.buildDescriptionText(action)
      await fs.writeFile(
        join(stepDirs, 'description.txt'),
        descText,
        'utf-8'
      )
    } catch {
      // 文件不存在或解析失败
    }
  }

  /**
   * 查找指定步骤序号对应的目录
   */
  private async findStepDir(
    stepIndex: number
  ): Promise<string | null> {
    const prefix = `step_${String(stepIndex).padStart(3, '0')}_`
    try {
      const entries = await fs.readdir(this.sessionDir)
      const match = entries.find((e) => e.startsWith(prefix))
      return match ? join(this.sessionDir, match) : null
    } catch {
      return null
    }
  }

  /**
   * 构建 description.txt 的文本内容
   */
  private buildDescriptionText(stepData: StepData): string {
    const idx = String(stepData.stepIndex).padStart(3, '0')
    const lines: string[] = [
      `【步骤 ${idx}】`,
      `- 自动识别说明：${stepData.description}`,
      `- 目标页面：${stepData.pageUrl}`
    ]

    if (stepData.targetElement) {
      lines.push(
        `- 推荐选择器：${stepData.targetElement.playwrightSelector || stepData.targetElement.cssSelector}`
      )
    }

    if (stepData.actionType === 'click' && stepData.targetElement?.boundingBox) {
      const bb = stepData.targetElement.boundingBox
      lines.push(`- 触发动作：click (X: ${bb.x}, Y: ${bb.y})`)
    } else {
      lines.push(`- 触发动作：${stepData.actionType}`)
    }

    lines.push('--------------------------------------------------')

    if (stepData.userNotes && stepData.userNotes.trim()) {
      lines.push('【人工特殊补充说明 (User Notes)】')
      lines.push(stepData.userNotes.trim())
      lines.push('--------------------------------------------------')
    }

    return lines.join('\n') + '\n'
  }

  /**
   * 导出全部步骤为 Markdown 格式的 AI 上下文
   */
  async exportAsMarkdown(): Promise<string> {
    const entries = await fs.readdir(this.sessionDir)
    const stepDirs = entries
      .filter((e) => e.startsWith('step_'))
      .sort()

    const sections: string[] = [
      '# 网页操作轨迹录制 - AI 上下文数据包\n'
    ]

    // 添加会话元数据
    try {
      const metaRaw = await fs.readFile(
        join(this.sessionDir, 'session_meta.json'),
        'utf-8'
      )
      const meta = JSON.parse(metaRaw)
      sections.push('## 会话信息')
      sections.push('```json')
      sections.push(JSON.stringify(meta, null, 2))
      sections.push('```\n')
    } catch {
      // skip
    }

    // 逐步骤添加
    for (const dir of stepDirs) {
      const descPath = join(this.sessionDir, dir, 'description.txt')
      try {
        const desc = await fs.readFile(descPath, 'utf-8')
        sections.push(`## ${dir}\n`)
        sections.push(desc)

        // 附加 action.json 的选择器信息
        const actionPath = join(this.sessionDir, dir, 'action.json')
        const actionRaw = await fs.readFile(actionPath, 'utf-8')
        const action = JSON.parse(actionRaw)
        if (action.targetElement) {
          sections.push('\n**选择器详情：**')
          sections.push('```json')
          sections.push(JSON.stringify(action.targetElement, null, 2))
          sections.push('```\n')
        }
      } catch {
        // skip
      }
    }

    return sections.join('\n')
  }

  /** 获取当前会话目录路径 */
  getSessionDir(): string {
    return this.sessionDir
  }

  /** 获取已记录步数 */
  getStepCount(): number {
    return this.stepCount
  }

  /** 时间戳格式化 YYYYMMDD_HHMMSS */
  private formatTimestamp(date: Date): string {
    const y = date.getFullYear()
    const mo = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    const h = String(date.getHours()).padStart(2, '0')
    const mi = String(date.getMinutes()).padStart(2, '0')
    const s = String(date.getSeconds()).padStart(2, '0')
    return `${y}${mo}${d}_${h}${mi}${s}`
  }

  /** 安全化目录名（移除不安全字符） */
  private sanitizeDirName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 40)
  }
}
