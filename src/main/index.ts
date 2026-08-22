/**
 * Watr - Web Action Trajectory Recorder
 * 主进程入口：初始化窗口、反指纹、IPC 通道
 *
 * 【v1.2】
 * - 便携化：所有数据存储在程序本体目录中
 * - Profile 管理器初始化
 */

import { app, session } from 'electron'
import * as path from 'path'
import { WindowManager } from './window-manager'
import { setupAntiFingerprint } from './anti-fingerprint'
import { registerIpcHandlers } from './ipc-handlers'
import { RecordingEngine } from './recording-engine'
import { ProfileManager } from './profile-manager'

// ---- 便携化：所有数据存储在程序本体目录中 ----
const isPackaged = app.isPackaged
const portableRoot = isPackaged
  ? path.dirname(app.getPath('exe'))
  : path.resolve(__dirname, '../..')  // 开发环境：项目根目录

const userDataDir = path.join(portableRoot, 'userdata')
app.setPath('userData', userDataDir)

// 导出供其他模块使用
export function getPortableRoot(): string {
  return portableRoot
}

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
let profileManager: ProfileManager

app.whenReady().then(async () => {
  // ---- 初始化 Profile 管理器 ----
  profileManager = new ProfileManager(portableRoot)
  await profileManager.init()

  // ---- 反指纹：Session 层标头拦截 ----
  const defaultSession = session.fromPartition('persist:recorder_session')
  setupAntiFingerprint(defaultSession)

  // ---- 初始化录制引擎（便携化录制目录） ----
  recordingEngine = new RecordingEngine(portableRoot)

  // ---- 创建主窗口 ----
  windowManager = new WindowManager(defaultSession, recordingEngine, profileManager)
  await windowManager.createWindow()

  // ---- 注册 IPC 通信通道 ----
  registerIpcHandlers(windowManager, recordingEngine, profileManager)
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
