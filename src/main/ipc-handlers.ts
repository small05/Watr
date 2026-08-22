/**
 * IPC 通信处理器 v1.2
 *
 * 【v1.2 新增】
 * - 标签页管理通道（创建/切换/关闭）
 * - 录制模式切换 + 深度快照
 * - Profile CRUD 通道
 */

import { ipcMain, shell, clipboard } from 'electron'
import { WindowManager } from './window-manager'
import { RecordingEngine, ProbeEvent } from './recording-engine'
import { ProfileManager, BrowserProfile } from './profile-manager'

export function registerIpcHandlers(
  windowManager: WindowManager,
  recordingEngine: RecordingEngine,
  profileManager: ProfileManager
): void {
  // ==================== 录制控制 ====================

  ipcMain.handle('recording:start', async (_event, url: string) => {
    const browserWc = windowManager.getBrowserWebContents()
    if (browserWc) {
      recordingEngine.bindWebContents(browserWc)

      recordingEngine.setCallbacks({
        onStateChange: (state) => {
          windowManager.getPanelWebContents()?.send('recording:state-changed', state)
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

  // ==================== 录制模式（v1.2 新增） ====================

  ipcMain.handle('recording:set-mode', async (_event, mode: 'lite' | 'deep') => {
    recordingEngine.setRecordingMode(mode)
    return { success: true }
  })

  ipcMain.handle('recording:get-mode', () => {
    return recordingEngine.getRecordingMode()
  })

  ipcMain.handle('recording:deep-snapshot', async () => {
    await recordingEngine.captureDeepSnapshot()
    return { success: true }
  })

  // ==================== 步骤管理 ====================

  ipcMain.handle('step:delete', async (_event, stepIndex: number) => {
    await recordingEngine.deleteStep(stepIndex)
    return { success: true }
  })

  ipcMain.handle('step:swap', async (_event, indexA: number, indexB: number) => {
    await recordingEngine.swapSteps(indexA, indexB)
    return { success: true }
  })

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

  // ==================== 导航栏控制 ====================

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

  // ==================== 标签页管理（v1.2 新增） ====================

  ipcMain.handle('tab:create', async (_event, url?: string) => {
    await windowManager.createTab(url)
    return { success: true }
  })

  ipcMain.handle('tab:close', async (_event, tabId: string) => {
    windowManager.closeTab(tabId)
    return { success: true }
  })

  ipcMain.handle('tab:switch', async (_event, tabId: string) => {
    windowManager.switchToTab(tabId)
    return { success: true }
  })

  ipcMain.handle('tab:list', () => {
    return windowManager.getTabsList()
  })

  // ==================== 隐私模式 ====================

  ipcMain.handle('privacy:enable', () => {
    windowManager.switchToPrivateSession()
    return { success: true }
  })

  ipcMain.handle('privacy:disable', () => {
    windowManager.switchToNormalSession()
    return { success: true }
  })

  ipcMain.handle('privacy:clear-data', async () => {
    await windowManager.clearSessionData()
    return { success: true }
  })

  // ==================== Profile 管理（v1.2 新增） ====================

  ipcMain.handle('profile:list', () => {
    return profileManager.listProfiles()
  })

  ipcMain.handle('profile:get-active', () => {
    return {
      id: profileManager.getActiveProfileId(),
      profile: profileManager.getActiveProfile()
    }
  })

  ipcMain.handle('profile:set-active', (_event, profileId: string) => {
    windowManager.applyProfile(profileId)
    return { success: true }
  })

  ipcMain.handle('profile:get-template', () => {
    return profileManager.getTemplateValues()
  })

  ipcMain.handle('profile:create', async (_event, profileData: Omit<BrowserProfile, 'id' | 'isBuiltin' | 'createdAt' | 'autoGenerated'>) => {
    const newProfile = await profileManager.createProfile(profileData)
    return { success: true, profile: newProfile }
  })

  ipcMain.handle('profile:update', async (_event, id: string, updates: Partial<BrowserProfile>) => {
    const updated = await profileManager.updateProfile(id, updates)
    return { success: !!updated, profile: updated }
  })

  ipcMain.handle('profile:delete', async (_event, id: string) => {
    const success = await profileManager.deleteProfile(id)
    return { success }
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
