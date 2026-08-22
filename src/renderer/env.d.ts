/**
 * watrApi 类型声明 v1.1
 */

export interface WatrApi {
  // 录制控制
  startRecording: (url: string) => Promise<{ success: boolean }>
  pauseRecording: () => Promise<{ success: boolean }>
  resumeRecording: () => Promise<{ success: boolean }>
  stopRecording: () => Promise<{ success: boolean; sessionDir?: string }>
  resetRecording: () => Promise<{ success: boolean }>
  getRecordingState: () => Promise<{
    state: string
    steps: StepData[]
    stepCount: number
  }>

  // 步骤管理（v1.1）
  deleteStep: (stepIndex: number) => Promise<{ success: boolean }>
  swapSteps: (indexA: number, indexB: number) => Promise<{ success: boolean }>
  insertAfterStep: (stepIndex: number) => Promise<{ success: boolean }>

  // 用户注记
  updateStepNotes: (stepIndex: number, notes: string) => Promise<{ success: boolean }>

  // 导出
  copyAsMarkdown: () => Promise<{ success: boolean; length: number }>
  openOutputDirectory: () => Promise<{ success: boolean }>

  // 配置
  setOutputDir: (dir: string) => Promise<{ success: boolean }>
  getOutputDir: () => Promise<string>

  // 浏览器导航
  navigate: (url: string) => Promise<{ success: boolean }>
  getCurrentUrl: () => Promise<string>

  // 隐私模式（v1.1）
  enablePrivacy: () => Promise<{ success: boolean }>
  disablePrivacy: () => Promise<{ success: boolean }>
  clearSessionData: () => Promise<{ success: boolean }>

  // 事件监听
  onStateChanged: (callback: (state: string) => void) => void
  onStepAdded: (callback: (step: StepData) => void) => void
  onStepsUpdated: (callback: (steps: StepData[]) => void) => void
  onError: (callback: (message: string) => void) => void
}

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

declare global {
  interface Window {
    watrApi: WatrApi
  }
}
