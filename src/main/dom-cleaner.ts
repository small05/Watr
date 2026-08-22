/**
 * DOM 清洗算法
 *
 * 将原始 HTML 字符串清洗为适合 LLM 理解的高密度纯净 DOM：
 * - 剥离所有 <script> 标签
 * - 移除 Base64 内联图片（src="data:image/..." → 占位符）
 * - 压缩冗余内联 SVG 路径数据
 * - 移除统计埋点 / 追踪像素（1x1 img）
 * - 移除 <noscript> 标签
 * - 清理内联 style 中的冗余属性
 */

/** Base64 图片 src 匹配正则 */
const BASE64_IMG_REGEX = /src\s*=\s*["']data:image\/[^"']{100,}["']/gi

/** 追踪像素匹配（1x1 或很小的图片） */
const TRACKING_PIXEL_REGEX =
  /<img[^>]*(?:width\s*=\s*["']1["'][^>]*height\s*=\s*["']1["']|height\s*=\s*["']1["'][^>]*width\s*=\s*["']1["'])[^>]*\/?>/gi

/** SVG path 的 d 属性数据（超过 200 字符的路径视为冗余） */
const SVG_PATH_REGEX = /(<path[^>]*\sd\s*=\s*["'])[^"']{200,}(["'][^>]*\/?>)/gi

/** 行内 <style> 块 */
const STYLE_TAG_REGEX = /<style[^>]*>[\s\S]*?<\/style>/gi

/** Script 标签 */
const SCRIPT_TAG_REGEX = /<script[^>]*>[\s\S]*?<\/script>/gi

/** Noscript 标签 */
const NOSCRIPT_TAG_REGEX = /<noscript[^>]*>[\s\S]*?<\/noscript>/gi

/** HTML 注释 */
const HTML_COMMENT_REGEX = /<!--[\s\S]*?-->/g

/** 多余空行压缩 */
const MULTI_NEWLINE_REGEX = /\n{3,}/g

/**
 * 清洗 HTML 字符串，生成适合 LLM 理解的紧凑 DOM 结构
 *
 * @param rawHtml - 原始页面 HTML
 * @returns 清洗后的紧凑 HTML
 */
export function cleanDom(rawHtml: string): string {
  let cleaned = rawHtml

  // 1. 移除所有 <script> 标签及内容
  cleaned = cleaned.replace(SCRIPT_TAG_REGEX, '')

  // 2. 移除 <noscript> 标签
  cleaned = cleaned.replace(NOSCRIPT_TAG_REGEX, '')

  // 3. 移除内联 <style> 块
  cleaned = cleaned.replace(STYLE_TAG_REGEX, '')

  // 4. 替换 Base64 内联图片为占位符
  cleaned = cleaned.replace(
    BASE64_IMG_REGEX,
    'src="[base64-image-removed]"'
  )

  // 5. 移除追踪像素（1x1 img）
  cleaned = cleaned.replace(TRACKING_PIXEL_REGEX, '<!-- tracking-pixel-removed -->')

  // 6. 压缩超长 SVG path 数据
  cleaned = cleaned.replace(SVG_PATH_REGEX, '$1[svg-path-truncated]$2')

  // 7. 移除 HTML 注释
  cleaned = cleaned.replace(HTML_COMMENT_REGEX, '')

  // 8. 压缩多余空行
  cleaned = cleaned.replace(MULTI_NEWLINE_REGEX, '\n\n')

  // 9. 去除首尾空白
  cleaned = cleaned.trim()

  return cleaned
}
