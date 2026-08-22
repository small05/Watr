/**
 * 导航栏 Preload 脚本
 * 为浏览器顶部导航栏提供 IPC bridge
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('navApi', {
  /** 后退 */
  goBack: () => ipcRenderer.invoke('nav:go-back'),
  /** 前进 */
  goForward: () => ipcRenderer.invoke('nav:go-forward'),
  /** 刷新 */
  reload: () => ipcRenderer.invoke('nav:reload'),
  /** 主页 */
  goHome: () => ipcRenderer.invoke('nav:go-home'),
  /** 导航到 URL */
  navigateTo: (url: string) => ipcRenderer.invoke('nav:navigate-to', url),

  /** 监听 URL 变化（主进程推送） */
  onUrlChanged: (callback: (data: { url: string; title: string; canGoBack: boolean; canGoForward: boolean }) => void) => {
    ipcRenderer.on('nav:url-changed', (_event, data) => {
      callback(data)
    })
  }
})
