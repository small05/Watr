/**
 * IPC 通信处理器 v1.1
 *
 * 【v1.1 新增】
 * - 导航栏控制通道（后退/前进/刷新/主页/导航）
 * - 步骤管理通道（删除/交换/从某步骤后插入）
 * - 隐私模式切换 + 清除 Cookies
 * - 录制停止后聚焦面板视图
 */

import { ipcMain, shell, clipboard } from 'electron'
import { WindowManager } from './window-manager'
import { RecordingEngine, ProbeEvent } from './recording-engine'

export function registerIpcHandlers(
  windowManager: WindowManager,
  recordingEngine: RecordingEngine
): void {
  // ==================== 录制控制 ====================

  ipcMain.handle('recording:start', async (_event, url: string) => {
    const browserWc = windowManager.getBrowserWebContents()
    if (browserWc) {
      recordingEngine.bindWebContents(browserWc)

      recordingEngine.setCallbacks({
        onStateChange: (state) => {
          windowManager.getPanelWebContents()?.send('recording:state-changed', state)
          // 【v1.1】录制停止后聚焦面板视图，修复 URL 输入框焦点丢失
          if (state === 'idle') {
            setTimeout(() => windowManager.focusPanelView(), 100)
          }
        },
        onStepAdded: (step) => {
          windowManager.getPanelWebContents()?.send('recording:step-added', step)
        },
        onStepsUpdated: (steps) => {
          windowManager.getPanelWebContents()?.send('recording:steps-updated', steps)
        },
        onError: (error) => {
          windowManager.getPanelWebContents()?.send('recording:error', error.message)
        }
      })

      // 先导航，再开始录制（start 内部会等待 did-finish-load）
      if (url && url.trim()) {
        windowManager.navigateTo(url)
      }

      await recordingEngine.start(url)
    }
    return { success: true }
  })

  ipcMain.handle('recording:pause', async () => {
    recordingEngine.pause()
    return { success: true }
  })

  ipcMain.handle('recording:resume', async () => {
    recordingEngine.resume()
    return { success: true }
  })

  ipcMain.handle('recording:stop', async () => {
    const sessionDir = await recordingEngine.stop()
    return { success: true, sessionDir }
  })

  ipcMain.handle('recording:reset', async () => {
    await recordingEngine.reset()
    return { success: true }
  })

  ipcMain.handle('recording:get-state', () => {
    return {
      state: recordingEngine.getState(),
      steps: recordingEngine.getSteps(),
      stepCount: recordingEngine.getSteps().length
    }
  })

  // ==================== 步骤管理（v1.1 新增） ====================

  /** 删除指定步骤 */
  ipcMain.handle('step:delete', async (_event, stepIndex: number) => {
    await recordingEngine.deleteStep(stepIndex)
    return { success: true }
  })

  /** 交换两个步骤 */
  ipcMain.handle('step:swap', async (_event, indexA: number, indexB: number) => {
    await recordingEngine.swapSteps(indexA, indexB)
    return { success: true }
  })

  /** 从指定步骤后恢复录制（插入模式） */
  ipcMain.handle('step:insert-after', async (_event, stepIndex: number) => {
    recordingEngine.resumeFromStep(stepIndex)
    return { success: true }
  })

  // ==================== 用户注记 ====================

  ipcMain.handle(
    'recording:update-notes',
    async (_event, stepIndex: number, notes: string) => {
      await recordingEngine.updateStepNotes(stepIndex, notes)
      return { success: true }
    }
  )

  // ==================== 导出 ====================

  ipcMain.handle('export:copy-markdown', async () => {
    const markdown = await recordingEngine.getFileWriter().exportAsMarkdown()
    clipboard.writeText(markdown)
    return { success: true, length: markdown.length }
  })

  ipcMain.handle('export:open-directory', async () => {
    const dir = recordingEngine.getFileWriter().getSessionDir()
    if (dir) {
      await shell.openPath(dir)
    }
    return { success: true }
  })

  // ==================== 配置 ====================

  ipcMain.handle('config:set-output-dir', async (_event, dir: string) => {
    recordingEngine.setOutputDir(dir)
    return { success: true }
  })

  ipcMain.handle('config:get-output-dir', () => {
    return recordingEngine.getFileWriter().getBaseDir()
  })

  // ==================== 浏览器导航 ====================

  ipcMain.handle('browser:navigate', async (_event, url: string) => {
    windowManager.navigateTo(url)
    return { success: true }
  })

  ipcMain.handle('browser:get-url', () => {
    const wc = windowManager.getBrowserWebContents()
    return wc ? wc.getURL() : ''
  })

  // ==================== 导航栏控制（v1.1 新增） ====================

  ipcMain.handle('nav:go-back', () => {
    windowManager.goBack()
    return { success: true }
  })

  ipcMain.handle('nav:go-forward', () => {
    windowManager.goForward()
    return { success: true }
  })

  ipcMain.handle('nav:reload', () => {
    windowManager.reload()
    return { success: true }
  })

  ipcMain.handle('nav:go-home', () => {
    windowManager.goHome()
    return { success: true }
  })

  ipcMain.handle('nav:navigate-to', async (_event, url: string) => {
    windowManager.navigateTo(url)
    return { success: true }
  })

  // ==================== 隐私模式（v1.1 新增） ====================

  /** 切换到隐私模式 */
  ipcMain.handle('privacy:enable', () => {
    windowManager.switchToPrivateSession()
    return { success: true }
  })

  /** 切换回正常模式 */
  ipcMain.handle('privacy:disable', () => {
    windowManager.switchToNormalSession()
    return { success: true }
  })

  /** 清除当前 session 的 Cookies 和存储数据 */
  ipcMain.handle('privacy:clear-data', async () => {
    await windowManager.clearSessionData()
    return { success: true }
  })

  // ==================== 探针事件 ====================

  ipcMain.on('probe:event', async (_event, probeEvent: ProbeEvent) => {
    await recordingEngine.handleProbeEvent(probeEvent)
  })

  ipcMain.on(
    'probe:navigation',
    async (_event, data: { url: string; title: string }) => {
      if (recordingEngine.getState() === 'recording') {
        await recordingEngine.recordNavigationStep(data.url)
      }
    }
  )

  ipcMain.on(
    'probe:challenge-resolved',
    async (_event, data: { url: string; title: string }) => {
      if (recordingEngine.getState() === 'recording') {
        await recordingEngine.recordChallengeResolved(data.url, data.title)
      }
    }
  )
}
