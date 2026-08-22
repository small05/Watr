/**
 * 反指纹模块 - 网络层标识重写与环境伪装
 *
 * 核心职责：
 * 1. 重写 User-Agent 剥离 Electron 标识
 * 2. 重写 Sec-CH-UA Client Hints 消除 Electron 品牌
 * 3. 跨平台自适应（根据 process.platform 动态生成匹配的标头）
 */

import { Session } from 'electron'

/** 从 Electron 内置 Chromium 提取主版本号 */
function getChromiumMajorVersion(): string {
  // Electron 43 对应 Chromium 150
  // 从 process.versions.chrome 动态获取精确版本
  const chromeVersion = process.versions.chrome
  return chromeVersion ? chromeVersion.split('.')[0] : '150'
}

/** 根据当前操作系统生成标准 Chrome User-Agent */
function buildChromeUA(): string {
  const chromeMajor = getChromiumMajorVersion()
  const chromeVersion = process.versions.chrome || `${chromeMajor}.0.0.0`

  if (process.platform === 'win32') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
  } else if (process.platform === 'linux') {
    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
  } else {
    // macOS fallback（虽然非目标平台，但保持兼容）
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
  }
}

/** 根据当前操作系统生成 Sec-CH-UA Client Hints 标头 */
function buildClientHints() {
  const chromeMajor = getChromiumMajorVersion()

  // Sec-CH-UA: 严禁出现 "Electron" 品牌标识
  const secChUa = `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not-A.Brand";v="99"`

  // Sec-CH-UA-Platform: 必须与当前系统一致，严禁跨系统硬编码
  let platform: string
  if (process.platform === 'win32') {
    platform = '"Windows"'
  } else if (process.platform === 'linux') {
    platform = '"Linux"'
  } else {
    platform = '"macOS"'
  }

  return {
    'sec-ch-ua': secChUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': platform
  }
}

/**
 * 在指定 Session 上安装反指纹拦截器
 * 拦截所有 HTTP 请求标头，重写 UA 和 Client Hints
 */
export function setupAntiFingerprint(targetSession: Session): void {
  const chromeUA = buildChromeUA()
  const clientHints = buildClientHints()

  // ---- 拦截 HTTP 请求标头 ----
  targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders }

    // 重写 User-Agent（剥离 Electron/x.x.x 标识）
    headers['User-Agent'] = chromeUA

    // 重写 Client Hints（消除 Electron 品牌）
    headers['sec-ch-ua'] = clientHints['sec-ch-ua']
    headers['sec-ch-ua-mobile'] = clientHints['sec-ch-ua-mobile']
    headers['sec-ch-ua-platform'] = clientHints['sec-ch-ua-platform']

    callback({ requestHeaders: headers })
  })

  // ---- 设置默认 User-Agent（影响 navigator.userAgent） ----
  targetSession.setUserAgent(chromeUA)

  console.log('[AntiFingerprint] UA:', chromeUA)
  console.log('[AntiFingerprint] Client Hints:', clientHints)
}

/** 导出当前使用的 Chrome UA（供其他模块读取） */
export function getCurrentChromeUA(): string {
  return buildChromeUA()
}
