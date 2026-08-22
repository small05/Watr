/**
 * 浏览器视图 Preload 脚本 - 隔离上下文探针入口
 *
 * 职责：
 * 1. 在 Isolated World 中加载事件捕获探针
 * 2. 通过 contextBridge 暴露最小化安全 IPC API
 * 3. 注入 stealth patches（window.chrome 补齐等）
 * 4. 严禁在主上下文注入任何全局变量
 */

import { contextBridge, ipcRenderer } from 'electron'

// ---- 暴露安全的 IPC Bridge（最小化 API 表面） ----
contextBridge.exposeInMainWorld('__watrBridge', {
  /** 上报探针捕获的事件到主进程 */
  sendProbeEvent: (event: unknown) => {
    ipcRenderer.send('probe:event', event)
  },

  /** 上报页面导航事件 */
  sendNavigation: (data: { url: string; title: string }) => {
    ipcRenderer.send('probe:navigation', data)
  },

  /** 上报 Cloudflare 验证通过 */
  sendChallengeResolved: (data: { url: string; title: string }) => {
    ipcRenderer.send('probe:challenge-resolved', data)
  }
})

// ---- 在页面加载后注入隔离上下文探针 ----
// 使用 DOMContentLoaded 确保 DOM 可用
window.addEventListener('DOMContentLoaded', () => {
  injectProbe()
})

/**
 * 注入探针脚本到 Isolated World
 * 探针与页面业务 JS 共享真实 DOM 树，但 JS 沙箱互不可见
 */
function injectProbe(): void {
  // ---- Stealth Patches ----
  // 补齐 window.chrome 对象（在隔离世界中对页面可见）
  try {
    if (!(window as any).chrome) {
      const chromeObj = {
        runtime: {
          connect: function () { return {} },
          sendMessage: function () {},
          id: undefined
        },
        loadTimes: function () { return {} },
        csi: function () { return {} }
      }

      // 使用 Proxy 确保 Function.prototype.toString 返回 [native code]
      const nativeFnProxy = (target: any): any => {
        return new Proxy(target, {
          get(obj, prop) {
            if (prop === 'toString') {
              return function () {
                return 'function ' + (obj.name || '') + '() { [native code] }'
              }
            }
            return obj[prop]
          }
        })
      }

      // 包装 chrome 对象中的函数
      if (chromeObj.runtime.connect) {
        chromeObj.runtime.connect = nativeFnProxy(chromeObj.runtime.connect)
      }
      if (chromeObj.runtime.sendMessage) {
        chromeObj.runtime.sendMessage = nativeFnProxy(chromeObj.runtime.sendMessage)
      }
      chromeObj.loadTimes = nativeFnProxy(chromeObj.loadTimes)
      chromeObj.csi = nativeFnProxy(chromeObj.csi)

      Object.defineProperty(window, 'chrome', {
        value: chromeObj,
        writable: false,
        configurable: false,
        enumerable: true
      })
    }
  } catch {
    // 静默失败，避免阻断页面
  }

  // ---- 事件捕获探针 ----
  setupEventCapture()

  // ---- SPA 突变监听 ----
  setupMutationObserver()

  // ---- Cloudflare 验证检测 ----
  setupChallengeDetection()
}

// ==================== 事件捕获 ====================

/** 输入防抖定时器 */
let inputDebounceTimer: ReturnType<typeof setTimeout> | null = null
const INPUT_DEBOUNCE_MS = 300

/** 敏感字段关键词 */
const SENSITIVE_PATTERNS = /password|card|token|cvv|secret|ssn|pin/i

function setupEventCapture(): void {
  // ---- Click 捕获 ----
  document.addEventListener(
    'click',
    (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target) return

      const eventData = buildProbeEvent('click', target, {
        clientX: e.clientX,
        clientY: e.clientY
      })

      ;(window as any).__watrBridge?.sendProbeEvent(eventData)
    },
    { capture: true, passive: true }
  )

  // ---- Input 捕获（300ms 防抖） ----
  document.addEventListener(
    'input',
    (e: Event) => {
      const target = e.target as HTMLInputElement
      if (!target) return

      if (inputDebounceTimer) {
        clearTimeout(inputDebounceTimer)
      }

      inputDebounceTimer = setTimeout(() => {
        const value = getSafeInputValue(target)
        const eventData = buildProbeEvent('input', target, {
          inputValue: value
        })

        ;(window as any).__watrBridge?.sendProbeEvent(eventData)
      }, INPUT_DEBOUNCE_MS)
    },
    { capture: true, passive: true }
  )

  // ---- Change 捕获（下拉选择等） ----
  document.addEventListener(
    'change',
    (e: Event) => {
      const target = e.target as HTMLElement
      if (!target) return

      const value = getSafeInputValue(target as HTMLInputElement)
      const eventData = buildProbeEvent('change', target, {
        inputValue: value
      })

      ;(window as any).__watrBridge?.sendProbeEvent(eventData)
    },
    { capture: true, passive: true }
  )

  // ---- Submit 捕获 ----
  document.addEventListener(
    'submit',
    (e: Event) => {
      const target = e.target as HTMLFormElement
      if (!target) return

      const eventData = buildProbeEvent('submit', target)
      ;(window as any).__watrBridge?.sendProbeEvent(eventData)
    },
    { capture: true, passive: true }
  )

  // ---- Enter 键提交 ----
  document.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return

      const target = e.target as HTMLElement
      if (!target) return

      const eventData = buildProbeEvent('keydown_enter', target)
      ;(window as any).__watrBridge?.sendProbeEvent(eventData)
    },
    { capture: true, passive: true }
  )
}

// ==================== 选择器生成 ====================

/**
 * 多维稳健选择器生成算法
 * 同时提取 role/aria、属性、CSS、XPath、文本、坐标
 */
function generateSelectors(el: HTMLElement) {
  const tagName = el.tagName?.toUpperCase() || ''
  const id = el.id || ''
  const classList = Array.from(el.classList || [])
  const innerText = (el.innerText || '').trim().substring(0, 100)
  const role = el.getAttribute('role') || null
  const ariaLabel = el.getAttribute('aria-label') || null
  const name = el.getAttribute('name') || ''
  const placeholder = (el as HTMLInputElement).placeholder || ''
  const title = el.getAttribute('title') || ''
  const alt = el.getAttribute('alt') || ''

  // BoundingClientRect
  const rect = el.getBoundingClientRect()
  const boundingBox = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  }

  // ---- CSS Selector 生成 ----
  const cssSelector = buildCssSelector(el)

  // ---- XPath 生成 ----
  const xpath = buildXPath(el)

  // ---- Playwright 选择器生成（P0-P3 优先级梯队） ----
  const playwrightSelector = buildPlaywrightSelector(
    el, tagName, id, role, ariaLabel, name, placeholder, innerText
  )

  return {
    tagName,
    id,
    classList,
    innerText,
    role,
    ariaLabel,
    name,
    placeholder,
    title,
    alt,
    xpath,
    cssSelector,
    playwrightSelector,
    boundingBox
  }
}

/**
 * 构建短路径语义 CSS Selector
 * 优先基于 ID、唯一属性或父子关系构建，避免脆弱的 nth-child
 */
function buildCssSelector(el: HTMLElement): string {
  // 优先使用 ID
  if (el.id) {
    return `${el.tagName.toLowerCase()}#${CSS.escape(el.id)}`
  }

  // 使用唯一属性
  const uniqueAttrs = ['name', 'data-testid', 'data-id', 'aria-label', 'placeholder']
  for (const attr of uniqueAttrs) {
    const val = el.getAttribute(attr)
    if (val) {
      const selector = `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(val)}"]`
      if (document.querySelectorAll(selector).length === 1) {
        return selector
      }
    }
  }

  // 检测模态框作用域
  const modalParent = findModalParent(el)
  const scope = modalParent
    ? buildCssSelector(modalParent) + ' >> '
    : ''

  // 使用 class 组合
  if (el.classList.length > 0) {
    const classSelector = `${el.tagName.toLowerCase()}.${Array.from(el.classList).map(c => CSS.escape(c)).join('.')}`
    if (document.querySelectorAll(classSelector).length === 1) {
      return scope + classSelector
    }
  }

  // 回退：使用父子关系
  const parent = el.parentElement
  if (parent && parent !== document.body) {
    const parentSelector = buildCssSelector(parent)
    return `${parentSelector} > ${el.tagName.toLowerCase()}`
  }

  return el.tagName.toLowerCase()
}

/**
 * 构建稳健 XPath
 */
function buildXPath(el: HTMLElement): string {
  if (el.id) {
    return `//${el.tagName.toLowerCase()}[@id='${el.id}']`
  }

  const parts: string[] = []
  let current: HTMLElement | null = el

  while (current && current !== document.body) {
    let part = current.tagName.toLowerCase()

    if (current.id) {
      part = `//${part}[@id='${current.id}']`
      parts.unshift(part)
      break
    }

    const ariaLabel = current.getAttribute('aria-label')
    if (ariaLabel) {
      part = `${part}[@aria-label='${ariaLabel}']`
    }

    // 计算同名兄弟中的位置
    const parent = current.parentElement
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (s) => s.tagName === current!.tagName
      )
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1
        part = `${part}[${idx}]`
      }
    }

    parts.unshift(part)
    current = current.parentElement
  }

  return '/' + parts.join('/')
}

/**
 * 构建 Playwright 选择器（P0-P3 优先级梯队）
 */
function buildPlaywrightSelector(
  el: HTMLElement,
  tagName: string,
  id: string,
  role: string | null,
  ariaLabel: string | null,
  name: string,
  placeholder: string,
  innerText: string
): string {
  // P0: 语义角色与可访问性
  if (role && ariaLabel) {
    return `getByRole('${role}', { name: '${ariaLabel}' })`
  }
  if (role && innerText && ['button', 'link', 'menuitem', 'tab'].includes(role)) {
    return `getByRole('${role}', { name: '${innerText.substring(0, 50)}' })`
  }
  if (placeholder) {
    return `getByPlaceholder('${placeholder}')`
  }

  // P1: 业务唯一属性与静态文本
  if (id) {
    return `locator('#${id}')`
  }
  if (name) {
    return `locator('[name="${name}"]')`
  }
  if (innerText && innerText.length < 50) {
    return `getByText('${innerText}')`
  }

  // P2: CSS Selector
  const css = buildCssSelector(el)
  if (css) {
    return `locator('${css}')`
  }

  // P3: 坐标定位（仅 Canvas/SVG）
  if (tagName === 'CANVAS' || tagName === 'SVG') {
    const rect = el.getBoundingClientRect()
    return `locator('${tagName.toLowerCase()}').click({ position: { x: ${Math.round(rect.width * 0.5)}, y: ${Math.round(rect.height * 0.5)} } })`
  }

  return `locator('${tagName.toLowerCase()}')`
}

/**
 * 检测最近的模态框父容器
 */
function findModalParent(el: HTMLElement): HTMLElement | null {
  let current = el.parentElement
  while (current && current !== document.body) {
    const role = current.getAttribute('role')
    const className = current.className || ''
    if (
      role === 'dialog' ||
      role === 'alertdialog' ||
      /modal|drawer|popup|overlay/i.test(className)
    ) {
      return current
    }
    current = current.parentElement
  }
  return null
}

// ==================== 大白话描述生成 ====================

/**
 * 生成人可读的大白话操作描述
 */
function generateDescription(
  actionType: string,
  el: HTMLElement,
  extra?: Record<string, any>
): string {
  const tagName = el.tagName?.toUpperCase() || ''
  const innerText = (el.innerText || '').trim().substring(0, 50)
  const id = el.id ? `#${el.id}` : ''
  const placeholder = (el as HTMLInputElement).placeholder || ''
  const ariaLabel = el.getAttribute('aria-label') || ''
  const displayName = innerText || ariaLabel || placeholder || id || tagName.toLowerCase()

  const elDesc = `(${tagName.toLowerCase()}${id})`

  switch (actionType) {
    case 'click':
      if (tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
        return `点击了文本为 '${displayName}' 的按钮 ${elDesc}`
      }
      if (tagName === 'A') {
        const href = (el as HTMLAnchorElement).href || ''
        return `点击了跳转至 '${displayName}' 的导航链接 ${elDesc}`
      }
      if (tagName === 'INPUT') {
        const type = (el as HTMLInputElement).type || 'text'
        if (type === 'checkbox') return `切换了复选框 '${displayName}' ${elDesc}`
        if (type === 'radio') return `选择了单选项 '${displayName}' ${elDesc}`
        return `点击了输入框 '${displayName}' ${elDesc}`
      }
      if (tagName === 'CANVAS') {
        return `点击了 Canvas 画布区域 ${elDesc}（坐标：${extra?.clientX || 0}, ${extra?.clientY || 0}）`
      }
      return `点击了 '${displayName}' ${elDesc}`

    case 'input':
      return `在 '${placeholder || displayName}' 输入框中键入了内容 ${elDesc}`

    case 'change':
      if (tagName === 'SELECT') {
        return `在下拉菜单 '${displayName}' 中选择了选项 ${elDesc}`
      }
      return `修改了 '${displayName}' 的值 ${elDesc}`

    case 'submit':
      return `提交了表单 ${elDesc}`

    case 'keydown_enter':
      return `在 '${displayName}' 中按下了回车键提交 ${elDesc}`

    default:
      return `执行了 ${actionType} 操作于 '${displayName}' ${elDesc}`
  }
}

// ==================== 敏感数据脱敏 ====================

/**
 * 获取输入值（敏感数据自动脱敏）
 */
function getSafeInputValue(el: HTMLInputElement): string | null {
  if (!el || !el.value) return null

  const type = (el.type || '').toLowerCase()
  const name = (el.name || '').toLowerCase()
  const id = (el.id || '').toLowerCase()
  const placeholder = (el.placeholder || '').toLowerCase()
  const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase()

  // 密码类型直接脱敏
  if (type === 'password') return '******'

  // 检查属性是否匹配敏感关键词
  const allAttrs = `${name} ${id} ${placeholder} ${ariaLabel}`
  if (SENSITIVE_PATTERNS.test(allAttrs)) {
    return '******'
  }

  return el.value
}

// ==================== 构建探针事件 ====================

function buildProbeEvent(
  actionType: string,
  target: HTMLElement,
  extra?: Record<string, any>
) {
  const selectors = generateSelectors(target)
  const description = generateDescription(actionType, target, extra)

  return {
    actionType,
    timestamp: new Date().toISOString(),
    pageUrl: window.location.href,
    pageTitle: document.title,
    description,
    targetElement: {
      tagName: selectors.tagName,
      id: selectors.id,
      classList: selectors.classList,
      innerText: selectors.innerText,
      role: selectors.role,
      ariaLabel: selectors.ariaLabel,
      xpath: selectors.xpath,
      cssSelector: selectors.cssSelector,
      playwrightSelector: selectors.playwrightSelector,
      boundingBox: selectors.boundingBox
    },
    inputValue: extra?.inputValue ?? null
  }
}

// ==================== SPA DOM 突变监听 ====================

function setupMutationObserver(): void {
  let lastUrl = window.location.href

  // 监听 URL 变化（SPA 路由）
  const urlObserver = new MutationObserver(() => {
    const currentUrl = window.location.href
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl
      ;(window as any).__watrBridge?.sendNavigation({
        url: currentUrl,
        title: document.title
      })
    }
  })

  urlObserver.observe(document, {
    childList: true,
    subtree: true
  })
}

// ==================== Cloudflare 验证检测 ====================

let challengeDetected = false

function setupChallengeDetection(): void {
  // 定期检查页面 Title 是否为 Cloudflare 验证页
  const checkInterval = setInterval(() => {
    const title = document.title || ''
    const isChallenge =
      title.includes('Just a moment') ||
      title.includes('Attention Required') ||
      title.includes('Checking your browser')

    if (isChallenge && !challengeDetected) {
      challengeDetected = true
      // 不需要上报 - 主进程的 recording-engine 会通过 pageTitle 自动检测
    }

    if (!isChallenge && challengeDetected) {
      // 验证已通过
      challengeDetected = false
      ;(window as any).__watrBridge?.sendChallengeResolved({
        url: window.location.href,
        title: document.title
      })
    }
  }, 1000)

  // 页面卸载时清理
  window.addEventListener('beforeunload', () => {
    clearInterval(checkInterval)
  })
}
