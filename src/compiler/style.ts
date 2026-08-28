// src/compiler/style.ts
// 4-1-c Style → WXSS
// px → rpx（仅编译期生效，Web 端永不转换）；Skyline 不支持的属性编译期警告
// HTML 标签选择器 → 小程序标签选择器（与 template.ts 共用 TAG_MAP，保证元素与样式一一对应）
import { TAG_MAP, SEMANTIC_CLASS } from './tags'
import type { StyleTransformOptions } from './types'

// 选择器中的标签名 → 小程序标签（.links a → .links view、h1 → text）
// 命中条件：标签名必须位于选择器起始或组合器之后（空格 / > + ~ , ( 之后），
// 前面不能是字母/数字/连字符/类名/ID（.a、#input、tag-a、data-input 均不误伤）
const TAG_NAMES = Object.keys(TAG_MAP).sort((a, b) => b.length - a.length)
const TAG_SELECTOR_RE = new RegExp(
  `(?<![\\w-.#:\\[*])(?:${TAG_NAMES.join('|')})(?=[\\s.#:\\[>+,~)(\\u0000]|$)`,
  'g',
)

/** 重写单个选择器：先屏蔽属性选择器 [..]（引号内容可能含标签字样），重写标签后再还原 */
// 占位符 \u0000 需在 lookahead 集合中（属性选择器也是标签名的合法后继）
function rewriteTagSelectors(selector: string): string {
  const attrs: string[] = []
  const masked = selector.replace(/\[[^\]]*\]/g, (m) => {
    attrs.push(m)
    return `\u0000${attrs.length - 1}\u0000`
  })
  const rewritten = masked.replace(TAG_SELECTOR_RE, (tag) => {
    // 语义标签（h1-h6/p/a）→ 基础类选择器：模板已附加 proteus-* 类，可精确区分；
    // 若映射为标签会撞选择器（.card h3 与 .card p 都变 .card text，后写覆盖先写 → h3 被染灰）
    const semantic = SEMANTIC_CLASS[tag]
    if (semantic) return `.${semantic}`
    return TAG_MAP[tag]
  })
  return rewritten.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => attrs[Number(i)])
}

/** 仅重写每条规则的选择器部分（声明块与 @media/@keyframes 骨架原样保留） */
function rewriteSelectorTags(css: string): string {
  return css.replace(/([^{}]+)\{/g, (_m, sel: string) => `${rewriteTagSelectors(sel)}{`)
}

// Web UA 语义基础样式（对齐 HTML 标准附录 D 默认样式表，rpx 直接书写不过 px2rpx）：
// h1-h6/p/a 在 Web 有浏览器默认样式，映射为 text/view 后无默认样式，注入基础类还原语义；
// margin 用 em（相对自身字号）且只设底部单边——Web 相邻段落 margin 折叠取 max，
// 而 Skyline 自研引擎不折叠，单边 bottom 在两端主流组合（段落连续 / 标题后接段落）下
// 视觉间距一致（如 p→p 均为 1em、h1→p 均为 0.67emₕ₁）；用户样式特异性更高可覆盖
const BASE_SEMANTIC_WXSS = [
  '.proteus-h1 { display: block; font-size: 64rpx; font-weight: 700; margin: 0 0 0.67em; }',
  '.proteus-h2 { display: block; font-size: 48rpx; font-weight: 700; margin: 0 0 0.83em; }',
  '.proteus-h3 { display: block; font-size: 36rpx; font-weight: 700; margin: 0 0 1em; }',
  '.proteus-h4 { display: block; font-size: 32rpx; font-weight: 700; margin: 0 0 1.33em; }',
  '.proteus-h5 { display: block; font-size: 28rpx; font-weight: 700; margin: 0 0 1.67em; }',
  '.proteus-h6 { display: block; font-size: 24rpx; font-weight: 700; margin: 0 0 2.33em; }',
  '.proteus-p { display: block; margin: 0 0 1em; }',
  '.proteus-a { color: #1a7af8; text-decoration: underline; }',
].join('\n')

/** style 源码 → WXSS（纯函数，独立可测） */
export function transformStyleToWxss(
  source: string,
  opts: StyleTransformOptions = { px2rpx: true, rpxRatio: 2 },
): string {
  let css = `${BASE_SEMANTIC_WXSS}\n${source}`
  // 1. 标签选择器映射（与模板标签映射一一对应，避免元素已映射而样式匹配不到）
  css = rewriteSelectorTags(css)
  // 2. px → rpx
  if (opts.px2rpx) {
    css = css.replace(/(\d+(?:\.\d+)?)px\b/g, (_m, n: string) => `${Number(n) * opts.rpxRatio}rpx`)
  }
  // 3. Skyline 不支持的属性编译期警告
  const unsupported: string[] = []
  if (/float\s*:/.test(css)) unsupported.push('float')
  if (/position\s*:\s*fixed\b/.test(css)) unsupported.push('position: fixed')
  for (const u of unsupported) {
    console.warn(`[mp-transform] WXSS 检测到 Skyline 不支持的属性：${u}（编译期警告）`)
  }
  return css
}
