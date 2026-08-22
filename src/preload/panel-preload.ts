/**
 * 控制面板 Preload 脚本
 *
 * 为右侧 Vue 3 控制面板暴露安全的 IPC 通信接口
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('watrApi', {
  // ==================== 录制控制 ====================

  /** 开始录制 */
  startRecording: (url: string) =>
    ipcRenderer.invoke('recording:start', url),

  /** 暂停录制 */
  pauseRecording: () =>
    ipcRenderer.invoke('recording:pause'),

  /** 恢复录制 */
  resumeRecording: () =>
    ipcRenderer.invoke('recording:resume'),

  /** 停止并保存 */
  stopRecording: () =>
    ipcRenderer.invoke('recording:stop'),

  /** 重置废弃 */
  resetRecording: () =>
    ipcRenderer.invoke('recording:reset'),

  /** 获取当前录制状态 */
  getRecordingState: () =>
    ipcRenderer.invoke('recording:get-state'),

  // ==================== 用户注记 ====================

  /** 更新步骤注记 */
  updateStepNotes: (stepIndex: number, notes: string) =>
    ipcRenderer.invoke('recording:update-notes', stepIndex, notes),

  // ==================== 导出 ====================

  /** 复制为 AI Markdown 上下文 */
  copyAsMarkdown: () =>
    ipcRenderer.invoke('export:copy-markdown'),

  /** 打开输出目录 */
  openOutputDirectory: () =>
    ipcRenderer.invoke('export:open-directory'),

  // ==================== 配置 ====================

  /** 设置自定义输出目录 */
  setOutputDir: (dir: string) =>
    ipcRenderer.invoke('config:set-output-dir', dir),

  /** 获取当前输出目录 */
  getOutputDir: () =>
    ipcRenderer.invoke('config:get-output-dir'),

  // ==================== 浏览器导航 ====================

  /** 导航到 URL */
  navigate: (url: string) =>
    ipcRenderer.invoke('browser:navigate', url),

  /** 获取当前 URL */
  getCurrentUrl: () =>
    ipcRenderer.invoke('browser:get-url'),

  // ==================== 事件监听 ====================

  /** 监听录制状态变更 */
  onStateChanged: (callback: (state: string) => void) => {
    ipcRenderer.on('recording:state-changed', (_event, state) => {
      callback(state)
    })
  },

  /** 监听新步骤添加 */
  onStepAdded: (callback: (step: unknown) => void) => {
    ipcRenderer.on('recording:step-added', (_event, step) => {
      callback(step)
    })
  },

  /** 监听错误 */
  onError: (callback: (message: string) => void) => {
    ipcRenderer.on('recording:error', (_event, message) => {
      callback(message)
    })
  }
})
