/**
 * 虚拟视口仿真器 - 1920x1080 宽屏锁定
 *
 * 解决痛点：左侧浏览器物理区域仅 ~75% 窗口宽度（约 1080px），
 * 直接加载会触发网页 @media 断点导致宽屏导航栏折叠为汉堡菜单。
 *
 * 实现方式：
 * 1. CDP Emulation.setDeviceMetricsOverride 锁定逻辑视口 1920x1080
 * 2. 自动计算缩放比呈现在左侧区域
 * 3. 所有坐标数据以 1920x1080 逻辑像素为基准落盘
 */

import { WebContents } from 'electron'
import { CdpManager } from './cdp-manager'

/** 虚拟视口固定分辨率 */
const VIRTUAL_WIDTH = 1920
const VIRTUAL_HEIGHT = 1080

export class ViewportEmulator {
  private cdpManager: CdpManager
  private currentScale: number = 1

  constructor(private webContents: WebContents) {
    this.cdpManager = new CdpManager(webContents)
  }

  /**
   * 启用虚拟视口仿真
   * 锁定逻辑分辨率为 1920x1080，deviceScaleFactor = 1
   */
  async enable(): Promise<void> {
    await this.cdpManager.setDeviceMetrics(
      VIRTUAL_WIDTH,
      VIRTUAL_HEIGHT,
      1
    )
  }

  /**
   * 禁用虚拟视口仿真
   */
  async disable(): Promise<void> {
    await this.cdpManager.clearDeviceMetrics()
  }

  /**
   * 当左侧浏览器视图大小变化时，更新缩放比
   * Scale ≈ 实际宽度 / 1920
   */
  updateScale(actualWidth: number, _actualHeight: number): void {
    this.currentScale = actualWidth / VIRTUAL_WIDTH
  }

  /**
   * 获取当前缩放比（用于调试/日志）
   */
  getScale(): number {
    return this.currentScale
  }

  /**
   * 获取虚拟视口参数（用于 session_meta.json）
   */
  getViewportMeta() {
    return {
      width: VIRTUAL_WIDTH,
      height: VIRTUAL_HEIGHT,
      scale: this.currentScale
    }
  }

  /**
   * 将物理像素坐标转换为虚拟 1920x1080 逻辑坐标
   * 用于坐标归一化落盘
   */
  physicalToLogical(physicalX: number, physicalY: number) {
    return {
      x: Math.round(physicalX / this.currentScale),
      y: Math.round(physicalY / this.currentScale)
    }
  }

  /**
   * 获取 CDP 管理器实例（供其他模块复用）
   */
  getCdpManager(): CdpManager {
    return this.cdpManager
  }
}
