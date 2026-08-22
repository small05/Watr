/**
 * 控制面板 Preload 脚本 v1.2
 *
 * 【v1.2 新增】
 * - 录制模式切换 + 深度快照
 * - Profile 管理 API
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

  // ==================== 录制模式（v1.2 新增） ====================

  setRecordingMode: (mode: 'lite' | 'deep') =>
    ipcRenderer.invoke('recording:set-mode', mode),
  getRecordingMode: () =>
    ipcRenderer.invoke('recording:get-mode'),
  captureDeepSnapshot: () =>
    ipcRenderer.invoke('recording:deep-snapshot'),

  // ==================== 步骤管理 ====================

  deleteStep: (stepIndex: number) =>
    ipcRenderer.invoke('step:delete', stepIndex),
  swapSteps: (indexA: number, indexB: number) =>
    ipcRenderer.invoke('step:swap', indexA, indexB),
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

  // ==================== 隐私模式 ====================

  enablePrivacy: () =>
    ipcRenderer.invoke('privacy:enable'),
  disablePrivacy: () =>
    ipcRenderer.invoke('privacy:disable'),
  clearSessionData: () =>
    ipcRenderer.invoke('privacy:clear-data'),

  // ==================== Profile 管理（v1.2 新增） ====================

  listProfiles: () =>
    ipcRenderer.invoke('profile:list'),
  getActiveProfile: () =>
    ipcRenderer.invoke('profile:get-active'),
  setActiveProfile: (profileId: string) =>
    ipcRenderer.invoke('profile:set-active', profileId),
  getProfileTemplate: () =>
    ipcRenderer.invoke('profile:get-template'),
  createProfile: (profileData: unknown) =>
    ipcRenderer.invoke('profile:create', profileData),
  updateProfile: (id: string, updates: unknown) =>
    ipcRenderer.invoke('profile:update', id, updates),
  deleteProfile: (id: string) =>
    ipcRenderer.invoke('profile:delete', id),

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
