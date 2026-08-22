/**
 * 浏览器视图 Preload 脚本 - 隔离上下文探针入口
 *
 * 职责：
 * 1. 在 Isolated World 中加载事件捕获探针
 * 2. 通过 contextBridge 暴露最小化安全 IPC API（供页面 JS 使用，如有需要）
 * 3. 探针自身直接通过 ipcRenderer 与主进程通信（不经过 contextBridge）
 * 4. 注入 stealth patches（window.chrome 补齐等）
 * 5. 严禁在主上下文注入任何全局变量
 *
 * 【v1.1 关键修复】
 * contextBridge.exposeInMainWorld 暴露 API 到页面主世界 (main world)，
 * 但 preload 代码运行在隔离世界 (isolated world) 中，
 * 无法通过 window.__watrBridge 访问自己暴露的 API。
 * 修复方案：探针内部直接使用 ipcRenderer.send()。
 */

import { contextBridge, ipcRenderer, webFrame } from 'electron'

// ---- 暴露安全的 IPC Bridge 到页面主世界（保留，供未来扩展使用） ----
contextBridge.exposeInMainWorld('__watrBridge', {
  sendProbeEvent: (event: unknown) => {
    ipcRenderer.send('probe:event', event)
  },
  sendNavigation: (data: { url: string; title: string }) => {
    ipcRenderer.send('probe:navigation', data)
  },
  sendChallengeResolved: (data: { url: string; title: string }) => {
    ipcRenderer.send('probe:challenge-resolved', data)
  }
})

// ---- 探针内部直接使用的 IPC 发送函数（修复 contextBridge 作用域问题） ----
function sendProbeEvent(event: unknown): void {
  ipcRenderer.send('probe:event', event)
}

function sendNavigation(data: { url: string; title: string }): void {
  ipcRenderer.send('probe:navigation', data)
}

function sendChallengeResolved(data: { url: string; title: string }): void {
  ipcRenderer.send('probe:challenge-resolved', data)
}

// ---- 主世界隐身补丁注入（解决动态 iframe 的 HEADCHR_IFRAME 检测） ----
function injectMainWorldStealth(): void {
  try {
    webFrame.executeJavaScript(`
      (function () {
        if (window.__watr_stealth_applied) return;
        window.__watr_stealth_applied = true;

        // 1. 原生 toString 伪装
        const nativeToString = Function.prototype.toString;
        const fnMap = new WeakMap();
        const markNative = (fn, name) => {
          fnMap.set(fn, name || fn.name || '');
          return fn;
        };

        try {
          const toStringProxy = new Proxy(nativeToString, {
            apply(target, thisArg, argArray) {
              if (fnMap.has(thisArg)) {
                const name = fnMap.get(thisArg);
                return 'function ' + (name ? name + '() ' : '') + '{ [native code] }';
              }
              return Reflect.apply(target, thisArg, argArray);
            }
          });
          Function.prototype.toString = toStringProxy;
          markNative(toStringProxy, 'toString');
        } catch (e) {}

        // 2. 补齐 window.chrome 对象
        if (!window.chrome) {
          const chromeObj = {
            runtime: {
              connect: markNative(function connect() { return {}; }, 'connect'),
              sendMessage: markNative(function sendMessage() {}, 'sendMessage'),
              id: undefined
            },
            loadTimes: markNative(function loadTimes() { return {}; }, 'loadTimes'),
            csi: markNative(function csi() { return {}; }, 'csi'),
            app: {
              isInstalled: false,
              InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
              RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
            }
          };

          Object.defineProperty(window, 'chrome', {
            value: chromeObj,
            writable: false,
            configurable: false,
            enumerable: true
          });
        }

        // 3. 修复 iframe.contentWindow / contentDocument 的 chrome 穿透（消除 HEADCHR_IFRAME FAIL）
        try {
          const originalContentWindow = Object.getOwnPropertyDescriptor(
            HTMLIFrameElement.prototype,
            'contentWindow'
          );

          if (originalContentWindow && originalContentWindow.get) {
            const origGet = originalContentWindow.get;
            const contentWindowGetter = function contentWindow() {
              const win = origGet.call(this);
              if (win) {
                try {
                  if (!win.chrome) {
                    Object.defineProperty(win, 'chrome', {
                      value: window.chrome,
                      writable: false,
                      configurable: false,
                      enumerable: true
                    });
                  }
                } catch (e) {}
              }
              return win;
            };
            markNative(contentWindowGetter, 'get contentWindow');

            Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
              get: contentWindowGetter,
              set: originalContentWindow.set,
              configurable: true,
              enumerable: true
            });
          }

          const originalContentDocument = Object.getOwnPropertyDescriptor(
            HTMLIFrameElement.prototype,
            'contentDocument'
          );

          if (originalContentDocument && originalContentDocument.get) {
            const origDocGet = originalContentDocument.get;
            const contentDocumentGetter = function contentDocument() {
              const doc = origDocGet.call(this);
              if (doc && doc.defaultView) {
                try {
                  if (!doc.defaultView.chrome) {
                    Object.defineProperty(doc.defaultView, 'chrome', {
                      value: window.chrome,
                      writable: false,
                      configurable: false,
                      enumerable: true
                    });
                  }
                } catch (e) {}
              }
              return doc;
            };
            markNative(contentDocumentGetter, 'get contentDocument');

            Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', {
              get: contentDocumentGetter,
              set: originalContentDocument.set,
              configurable: true,
              enumerable: true
            });
          }
        } catch (e) {}
      })();
    `).catch(() => {});
  } catch (e) {}
}

// 立即在主世界注入隐身补丁
injectMainWorldStealth();

// ---- 在页面加载后注入隔离上下文探针 ----
window.addEventListener('DOMContentLoaded', () => {
  injectProbe()
})

/**
 * 注入探针脚本到 Isolated World
 */
function injectProbe(): void {
  // 确保主世界补丁生效
  injectMainWorldStealth();

  setupEventCapture()
  setupMutationObserver()
  setupChallengeDetection()
}

// ==================== 事件捕获 ====================

let inputDebounceTimer: ReturnType<typeof setTimeout> | null = null
const INPUT_DEBOUNCE_MS = 300
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

      // 【v1.1 修复】直接使用 ipcRenderer.send 而非 window.__watrBridge
      sendProbeEvent(eventData)
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

        sendProbeEvent(eventData)
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

      sendProbeEvent(eventData)
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
      sendProbeEvent(eventData)
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
      sendProbeEvent(eventData)
    },
    { capture: true, passive: true }
  )
}

// ==================== 选择器生成 ====================

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

  const rect = el.getBoundingClientRect()
  const boundingBox = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  }

  const cssSelector = buildCssSelector(el)
  const xpath = buildXPath(el)
  const playwrightSelector = buildPlaywrightSelector(
    el, tagName, id, role, ariaLabel, name, placeholder, innerText
  )

  return {
    tagName, id, classList, innerText, role, ariaLabel,
    name, placeholder, title, alt,
    xpath, cssSelector, playwrightSelector, boundingBox
  }
}

function buildCssSelector(el: HTMLElement): string {
  if (el.id) {
    return `${el.tagName.toLowerCase()}#${CSS.escape(el.id)}`
  }

  const uniqueAttrs = ['name', 'data-testid', 'data-id', 'aria-label', 'placeholder']
  for (const attr of uniqueAttrs) {
    const val = el.getAttribute(attr)
    if (val) {
      const selector = `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(val)}"]`
      try {
        if (document.querySelectorAll(selector).length === 1) {
          return selector
        }
      } catch { /* invalid selector */ }
    }
  }

  const modalParent = findModalParent(el)
  const scope = modalParent
    ? buildCssSelector(modalParent) + ' >> '
    : ''

  if (el.classList.length > 0) {
    const classSelector = `${el.tagName.toLowerCase()}.${Array.from(el.classList).map(c => CSS.escape(c)).join('.')}`
    try {
      if (document.querySelectorAll(classSelector).length === 1) {
        return scope + classSelector
      }
    } catch { /* invalid selector */ }
  }

  const parent = el.parentElement
  if (parent && parent !== document.body) {
    const parentSelector = buildCssSelector(parent)
    return `${parentSelector} > ${el.tagName.toLowerCase()}`
  }

  return el.tagName.toLowerCase()
}

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

function buildPlaywrightSelector(
  el: HTMLElement, tagName: string, id: string,
  role: string | null, ariaLabel: string | null,
  name: string, placeholder: string, innerText: string
): string {
  if (role && ariaLabel) {
    return `getByRole('${role}', { name: '${ariaLabel}' })`
  }
  if (role && innerText && ['button', 'link', 'menuitem', 'tab'].includes(role)) {
    return `getByRole('${role}', { name: '${innerText.substring(0, 50)}' })`
  }
  if (placeholder) {
    return `getByPlaceholder('${placeholder}')`
  }

  if (id) {
    return `locator('#${id}')`
  }
  if (name) {
    return `locator('[name="${name}"]')`
  }
  if (innerText && innerText.length < 50) {
    return `getByText('${innerText}')`
  }

  const css = buildCssSelector(el)
  if (css) {
    return `locator('${css}')`
  }

  if (tagName === 'CANVAS' || tagName === 'SVG') {
    const rect = el.getBoundingClientRect()
    return `locator('${tagName.toLowerCase()}').click({ position: { x: ${Math.round(rect.width * 0.5)}, y: ${Math.round(rect.height * 0.5)} } })`
  }

  return `locator('${tagName.toLowerCase()}')`
}

function findModalParent(el: HTMLElement): HTMLElement | null {
  let current = el.parentElement
  while (current && current !== document.body) {
    const role = current.getAttribute('role')
    const className = current.className || ''
    if (
      role === 'dialog' || role === 'alertdialog' ||
      /modal|drawer|popup|overlay/i.test(className)
    ) {
      return current
    }
    current = current.parentElement
  }
  return null
}

// ==================== 大白话描述 ====================

function generateDescription(
  actionType: string, el: HTMLElement, extra?: Record<string, any>
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

function getSafeInputValue(el: HTMLInputElement): string | null {
  if (!el || !el.value) return null

  const type = (el.type || '').toLowerCase()
  const name = (el.name || '').toLowerCase()
  const id = (el.id || '').toLowerCase()
  const placeholder = (el.placeholder || '').toLowerCase()
  const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase()

  if (type === 'password') return '******'

  const allAttrs = `${name} ${id} ${placeholder} ${ariaLabel}`
  if (SENSITIVE_PATTERNS.test(allAttrs)) return '******'

  return el.value
}

// ==================== 构建探针事件 ====================

function buildProbeEvent(
  actionType: string, target: HTMLElement, extra?: Record<string, any>
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

  const urlObserver = new MutationObserver(() => {
    const currentUrl = window.location.href
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl
      sendNavigation({ url: currentUrl, title: document.title })
    }
  })

  urlObserver.observe(document, { childList: true, subtree: true })
}

// ==================== Cloudflare 验证检测 ====================

let challengeDetected = false

function setupChallengeDetection(): void {
  const checkInterval = setInterval(() => {
    const title = document.title || ''
    const isChallenge =
      title.includes('Just a moment') ||
      title.includes('Attention Required') ||
      title.includes('Checking your browser')

    if (isChallenge && !challengeDetected) {
      challengeDetected = true
    }

    if (!isChallenge && challengeDetected) {
      challengeDetected = false
      sendChallengeResolved({
        url: window.location.href,
        title: document.title
      })
    }
  }, 1000)

  window.addEventListener('beforeunload', () => {
    clearInterval(checkInterval)
  })
}
