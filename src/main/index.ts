/**
 * Watr - Web Action Trajectory Recorder
 * 主进程入口：初始化窗口、反指纹、IPC 通道
 */

import { app, session } from 'electron'
import { WindowManager } from './window-manager'
import { setupAntiFingerprint } from './anti-fingerprint'
import { registerIpcHandlers } from './ipc-handlers'
import { RecordingEngine } from './recording-engine'

// 单实例锁定 - 防止多开
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

// ---- Chromium 启动开关（必须在 app.ready 前设置） ----
// 彻底消除 navigator.webdriver = true 的自动化标记
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')
// 确保 navigator.plugins.length > 0（补齐 PDF 插件）
app.commandLine.appendSwitch('enable-pdf-viewer')
// 禁止暴露 automation 标记
app.commandLine.appendSwitch('disable-features', 'AutomationControlled')

let windowManager: WindowManager
let recordingEngine: RecordingEngine

app.whenReady().then(async () => {
  // ---- 反指纹：Session 层标头拦截 ----
  const defaultSession = session.fromPartition('persist:recorder_session')
  setupAntiFingerprint(defaultSession)

  // ---- 初始化录制引擎 ----
  recordingEngine = new RecordingEngine()

  // ---- 创建主窗口 ----
  windowManager = new WindowManager(defaultSession, recordingEngine)
  await windowManager.createWindow()

  // ---- 注册 IPC 通信通道 ----
  registerIpcHandlers(windowManager, recordingEngine)
})

// macOS 激活窗口
app.on('activate', () => {
  if (windowManager) {
    windowManager.ensureWindow()
  }
})

// 所有窗口关闭时退出（Windows / Linux）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 多实例启动时聚焦已有窗口
app.on('second-instance', () => {
  if (windowManager) {
    windowManager.focusWindow()
  }
})
