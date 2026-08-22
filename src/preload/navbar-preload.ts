/**
 * 导航栏 Preload 脚本 v1.2
 * 为浏览器顶部导航栏提供 IPC bridge
 * 新增标签页管理 IPC
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('watrNavbar', {
  // ---- 导航控制 ----
  goBack: () => ipcRenderer.invoke('nav:go-back'),
  goForward: () => ipcRenderer.invoke('nav:go-forward'),
  reload: () => ipcRenderer.invoke('nav:reload'),
  goHome: () => ipcRenderer.invoke('nav:go-home'),
  navigate: (url: string) => ipcRenderer.invoke('nav:navigate-to', url),

  // ---- 标签页管理 ----
  createTab: (url?: string) => ipcRenderer.invoke('tab:create', url),
  closeTab: (tabId: string) => ipcRenderer.invoke('tab:close', tabId),
  switchTab: (tabId: string) => ipcRenderer.invoke('tab:switch', tabId),

  // ---- 事件监听 ----
  onUrlChanged: (callback: (data: { url: string; title: string; canGoBack: boolean; canGoForward: boolean }) => void) => {
    ipcRenderer.on('nav:url-changed', (_event, data) => {
      callback(data)
    })
  },
  onTabsUpdated: (callback: (tabs: Array<{ id: string; title: string; url: string; isActive: boolean }>) => void) => {
    ipcRenderer.on('nav:tabs-updated', (_event, tabs) => {
      callback(tabs)
    })
  }
})
