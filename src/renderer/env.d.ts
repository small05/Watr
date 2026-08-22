/**
 * watrApi 类型声明
 * 与 panel-preload.ts 中 contextBridge 暴露的 API 对齐
 */

export interface WatrApi {
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
  updateStepNotes: (stepIndex: number, notes: string) => Promise<{ success: boolean }>
  copyAsMarkdown: () => Promise<{ success: boolean; length: number }>
  openOutputDirectory: () => Promise<{ success: boolean }>
  setOutputDir: (dir: string) => Promise<{ success: boolean }>
  getOutputDir: () => Promise<string>
  navigate: (url: string) => Promise<{ success: boolean }>
  getCurrentUrl: () => Promise<string>
  onStateChanged: (callback: (state: string) => void) => void
  onStepAdded: (callback: (step: StepData) => void) => void
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
