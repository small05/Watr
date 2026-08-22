/**
 * 控制面板 Preload 脚本 v1.1
 *
 * 【v1.1 新增】
 * - 步骤管理 API（删除/交换/插入）
 * - 隐私模式 + 清除 Cookies
 * - onStepsUpdated 事件监听
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('watrApi', {
  // ==================== 录制控制 ====================

  startRecording: (url: string) =>
    ipcRenderer.invoke('recording:start', url),
  pauseRecording: () =>
    ipcRenderer.invoke('recording:pause'),
  resumeRecording: () =>
    ipcRenderer.invoke('recording:resume'),
  stopRecording: () =>
    ipcRenderer.invoke('recording:stop'),
  resetRecording: () =>
    ipcRenderer.invoke('recording:reset'),
  getRecordingState: () =>
    ipcRenderer.invoke('recording:get-state'),

  // ==================== 步骤管理（v1.1 新增） ====================

  /** 删除指定步骤 */
  deleteStep: (stepIndex: number) =>
    ipcRenderer.invoke('step:delete', stepIndex),

  /** 交换两个步骤的顺序 */
  swapSteps: (indexA: number, indexB: number) =>
    ipcRenderer.invoke('step:swap', indexA, indexB),

  /** 从指定步骤后插入录制 */
  insertAfterStep: (stepIndex: number) =>
    ipcRenderer.invoke('step:insert-after', stepIndex),

  // ==================== 用户注记 ====================

  updateStepNotes: (stepIndex: number, notes: string) =>
    ipcRenderer.invoke('recording:update-notes', stepIndex, notes),

  // ==================== 导出 ====================

  copyAsMarkdown: () =>
    ipcRenderer.invoke('export:copy-markdown'),
  openOutputDirectory: () =>
    ipcRenderer.invoke('export:open-directory'),

  // ==================== 配置 ====================

  setOutputDir: (dir: string) =>
    ipcRenderer.invoke('config:set-output-dir', dir),
  getOutputDir: () =>
    ipcRenderer.invoke('config:get-output-dir'),

  // ==================== 浏览器导航 ====================

  navigate: (url: string) =>
    ipcRenderer.invoke('browser:navigate', url),
  getCurrentUrl: () =>
    ipcRenderer.invoke('browser:get-url'),

  // ==================== 隐私模式（v1.1 新增） ====================

  /** 启用隐私模式 */
  enablePrivacy: () =>
    ipcRenderer.invoke('privacy:enable'),

  /** 禁用隐私模式 */
  disablePrivacy: () =>
    ipcRenderer.invoke('privacy:disable'),

  /** 清除 Cookies 和存储数据 */
  clearSessionData: () =>
    ipcRenderer.invoke('privacy:clear-data'),

  // ==================== 事件监听 ====================

  onStateChanged: (callback: (state: string) => void) => {
    ipcRenderer.on('recording:state-changed', (_event, state) => {
      callback(state)
    })
  },

  onStepAdded: (callback: (step: unknown) => void) => {
    ipcRenderer.on('recording:step-added', (_event, step) => {
      callback(step)
    })
  },

  /** 【v1.1 新增】步骤列表整体更新（删除/排序/插入后触发） */
  onStepsUpdated: (callback: (steps: unknown[]) => void) => {
    ipcRenderer.on('recording:steps-updated', (_event, steps) => {
      callback(steps)
    })
  },

  onError: (callback: (message: string) => void) => {
    ipcRenderer.on('recording:error', (_event, message) => {
      callback(message)
    })
  }
})
