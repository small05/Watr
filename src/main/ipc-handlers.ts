/**
 * IPC 通信处理器
 *
 * 建立三方双向通信通道：
 * - 探针 (browser-preload) → 主进程：事件上报
 * - 主进程 → 控制面板 (panel)：步骤推送、状态变更
 * - 控制面板 → 主进程：控制指令（开始/暂停/保存/重置）、注记更新
 */

import { ipcMain, shell, clipboard } from 'electron'
import { WindowManager } from './window-manager'
import { RecordingEngine, ProbeEvent } from './recording-engine'

/**
 * 注册所有 IPC 通信处理器
 */
export function registerIpcHandlers(
  windowManager: WindowManager,
  recordingEngine: RecordingEngine
): void {
  // ==================== 控制面板 → 主进程 ====================

  /** 开始录制 */
  ipcMain.handle('recording:start', async (_event, url: string) => {
    const browserWc = windowManager.getBrowserWebContents()
    if (browserWc) {
      recordingEngine.bindWebContents(browserWc)

      // 设置回调：步骤添加时推送到面板
      recordingEngine.setCallbacks({
        onStateChange: (state) => {
          windowManager.getPanelWebContents()?.send('recording:state-changed', state)
        },
        onStepAdded: (step) => {
          windowManager.getPanelWebContents()?.send('recording:step-added', step)
        },
        onError: (error) => {
          windowManager.getPanelWebContents()?.send('recording:error', error.message)
        }
      })

      // 导航到目标 URL
      if (url && url.trim()) {
        windowManager.navigateTo(url)
      }

      await recordingEngine.start(url)
    }
    return { success: true }
  })

  /** 暂停录制 */
  ipcMain.handle('recording:pause', async () => {
    recordingEngine.pause()
    return { success: true }
  })

  /** 恢复录制 */
  ipcMain.handle('recording:resume', async () => {
    recordingEngine.resume()
    return { success: true }
  })

  /** 停止并保存 */
  ipcMain.handle('recording:stop', async () => {
    const sessionDir = await recordingEngine.stop()
    return { success: true, sessionDir }
  })

  /** 重置废弃 */
  ipcMain.handle('recording:reset', async () => {
    recordingEngine.reset()
    return { success: true }
  })

  /** 获取当前状态 */
  ipcMain.handle('recording:get-state', () => {
    return {
      state: recordingEngine.getState(),
      steps: recordingEngine.getSteps(),
      stepCount: recordingEngine.getSteps().length
    }
  })

  // ==================== 用户注记 ====================

  /** 更新步骤注记 */
  ipcMain.handle(
    'recording:update-notes',
    async (_event, stepIndex: number, notes: string) => {
      await recordingEngine.updateStepNotes(stepIndex, notes)
      return { success: true }
    }
  )

  // ==================== 导出 ====================

  /** 导出为 Markdown 并复制到剪贴板 */
  ipcMain.handle('export:copy-markdown', async () => {
    const markdown = await recordingEngine.getFileWriter().exportAsMarkdown()
    clipboard.writeText(markdown)
    return { success: true, length: markdown.length }
  })

  /** 打开输出目录 */
  ipcMain.handle('export:open-directory', async () => {
    const dir = recordingEngine.getFileWriter().getSessionDir()
    if (dir) {
      await shell.openPath(dir)
    }
    return { success: true }
  })

  /** 设置自定义输出目录 */
  ipcMain.handle('config:set-output-dir', async (_event, dir: string) => {
    recordingEngine.setOutputDir(dir)
    return { success: true }
  })

  /** 获取当前输出目录 */
  ipcMain.handle('config:get-output-dir', () => {
    return recordingEngine.getFileWriter().getBaseDir()
  })

  // ==================== 浏览器导航 ====================

  /** 在内置浏览器中导航到指定 URL */
  ipcMain.handle('browser:navigate', async (_event, url: string) => {
    windowManager.navigateTo(url)
    return { success: true }
  })

  /** 获取当前浏览器 URL */
  ipcMain.handle('browser:get-url', () => {
    const wc = windowManager.getBrowserWebContents()
    return wc ? wc.getURL() : ''
  })

  // ==================== 探针 → 主进程 ====================

  /** 接收来自 browser-preload 探针的事件 */
  ipcMain.on('probe:event', async (_event, probeEvent: ProbeEvent) => {
    await recordingEngine.handleProbeEvent(probeEvent)
  })

  /** 接收页面导航事件 */
  ipcMain.on(
    'probe:navigation',
    async (_event, data: { url: string; title: string }) => {
      if (recordingEngine.getState() === 'recording') {
        await recordingEngine.recordNavigationStep(data.url)
      }
    }
  )

  /** 接收 Cloudflare 验证通过事件 */
  ipcMain.on(
    'probe:challenge-resolved',
    async (_event, data: { url: string; title: string }) => {
      if (recordingEngine.getState() === 'recording') {
        await recordingEngine.recordChallengeResolved(data.url, data.title)
      }
    }
  )
}
