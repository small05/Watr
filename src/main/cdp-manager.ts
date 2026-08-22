/**
 * CDP 管理器 - 按需瞬态挂载管道
 *
 * 严格遵循文档规范：
 * - 禁止 CDP 调试器常驻挂载（防止 Cloudflare Turnstile 检测 V8 调试模式）
 * - 采用 attach → 执行 → detach 的瞬态管道
 * - 串行 Promise 队列防止竞态
 * - 截图降级：常规步骤优先用 webContents.capturePage()
 */

import { WebContents } from 'electron'

export class CdpManager {
  private taskQueue: Promise<void> = Promise.resolve()

  constructor(private webContents: WebContents) {}

  /**
   * 在串行队列中执行一个 CDP 瞬态操作
   * 保证同一时刻仅有一个 attach/detach 周期
   */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.taskQueue = this.taskQueue
        .then(() => fn())
        .then(resolve)
        .catch(reject)
    })
  }

  /**
   * 瞬态 CDP 执行管道
   * attach('1.3') → sendCommand → detach()
   */
  private async execCdp<T>(
    command: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const debugger_ = this.webContents.debugger

    try {
      if (!debugger_.isAttached()) {
        debugger_.attach('1.3')
      }

      const result = await debugger_.sendCommand(command, params)
      return result as T
    } finally {
      if (debugger_.isAttached()) {
        try {
          debugger_.detach()
        } catch {
          // detach 失败不影响主流程（可能已被 DevTools 触发 detach）
        }
      }
    }
  }

  /**
   * 导出 MHTML 页面快照
   * 通过 CDP Page.captureSnapshot 实现，按需瞬态挂载
   */
  async captureMHTML(): Promise<string> {
    return this.enqueue(async () => {
      const result = await this.execCdp<{ data: string }>(
        'Page.captureSnapshot',
        { format: 'mhtml' }
      )
      return result.data
    })
  }

  /**
   * 高清截图（CDP 方式）
   * 仅在需要全页面长截图时使用
   */
  async captureScreenshotCDP(): Promise<Buffer> {
    return this.enqueue(async () => {
      const result = await this.execCdp<{ data: string }>(
        'Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: false }
      )
      return Buffer.from(result.data, 'base64')
    })
  }

  /**
   * 截图降级方案（推荐）
   * 使用 Electron 原生 webContents.capturePage()
   * 无需挂载 CDP 调试器，不触发风控检测
   */
  async captureScreenshotNative(): Promise<Buffer> {
    const image = await this.webContents.capturePage()
    return image.toPNG()
  }

  /**
   * 设备虚拟视口仿真
   * 通过 CDP Emulation.setDeviceMetricsOverride 锁定 1920x1080
   */
  async setDeviceMetrics(
    width: number,
    height: number,
    deviceScaleFactor: number = 1
  ): Promise<void> {
    return this.enqueue(async () => {
      await this.execCdp('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor,
        mobile: false
      })
    })
  }

  /**
   * 清除设备仿真
   */
  async clearDeviceMetrics(): Promise<void> {
    return this.enqueue(async () => {
      await this.execCdp('Emulation.clearDeviceMetricsOverride')
    })
  }
}
