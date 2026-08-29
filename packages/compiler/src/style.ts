// src/compiler/style.ts
// 4-1-c Style → WXSS
// px → rpx（仅编译期生效，Web 端永不转换）；Skyline 不支持的属性编译期警告
// HTML 标签选择器 → 小程序标签选择器（与 template.ts 共用映射，保证元素与样式一一对应）
// ★底线循环 ①③：生效映射来自 resolveOverrides（tags.ts 常量 + config rules 覆盖，即时生效）
import type { StyleTransformOptions } from './types'
import type { TransformTrace } from './trace'
import { resolveOverrides } from './overrides'
import { executeRule } from './transforms/registry'
import type { RuleContext } from './transforms/types'
import type { ResolvedOverrides } from './overrides'

// 选择器中的标签名 → 小程序标签（.links a → .links view、h1 → text）
// 命中条件：标签名必须位于选择器起始或组合器之后（空格 / > + ~ , ( 之后），
// 前面不能是字母/数字/连字符/类名/ID（.a、#input、tag-a、data-input 均不误伤）
// 正则按生效映射生成（config customTags / mapping 覆盖后新标签也能重写）
function makeTagSelectorRe(tagMap: Record<string, string>, semanticClass: Record<string, string>): RegExp {
  const names = [...Object.keys(tagMap), ...Object.keys(semanticClass)].sort((a, b) => b.length - a.length)
  return new RegExp(
    `(?<![\\w-.#:\\[*])(?:${names.join('|')})(?=[\\s.#:\\[>+,~)(\\u0000]|$)`,
    'g',
  )
}

/** 重写单个选择器：先屏蔽属性选择器 [..]（引号内容可能含标签字样），重写标签后再还原 */
// 占位符 \u0000 需在 lookahead 集合中（属性选择器也是标签名的合法后继）
function rewriteTagSelectors(selector: string, res: ResolvedOverrides, tagRe: RegExp): string {
  const attrs: string[] = []
  const masked = selector.replace(/\[[^\]]*\]/g, (m) => {
    attrs.push(m)
    return `\u0000${attrs.length - 1}\u0000`
  })
  const rewritten = masked.replace(tagRe, (tag) => {
    // 语义标签（h1-h6/p/a）→ 基础类选择器：模板已附加 proteus-* 类，可精确区分；
    // 若映射为标签会撞选择器（.card h3 与 .card p 都变 .card text，后写覆盖先写 → h3 被染灰）
    const semantic = res.semanticClass[tag]
    if (semantic) return `.${semantic}`
    return res.tagMap[tag] ?? tag
  })
  return rewritten.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => attrs[Number(i)])
}

/** 仅重写每条规则的选择器部分（声明块与 @media/@keyframes 骨架原样保留） */
function rewriteSelectorTags(css: string, res: ResolvedOverrides, tagRe: RegExp): string {
  return css.replace(/([^{}]+)\{/g, (_m, sel: string) => `${rewriteTagSelectors(sel, res, tagRe)}{`)
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

/** 统计选择器重写前源 CSS 中的标签选择器处数（语义标签与普通标签分开计数） */
function countSelectorRewrites(css: string, res: ResolvedOverrides): { tag: number; semantic: number } {
  const semanticKeys = Object.keys(res.semanticClass)
  const tagKeys = Object.keys(res.tagMap).filter((k) => !semanticKeys.includes(k))
  const lookahead = '[\\s.#:\\[>+,~)(\\u0000]|$'
  const semanticRe = new RegExp(`(?<![\\w-.\\#:\\[*])(?:${semanticKeys.join('|')})(?=${lookahead})`, 'g')
  const tagRePlain = new RegExp(`(?<![\\w-.\\#:\\[*])(?:${tagKeys.join('|')})(?=${lookahead})`, 'g')
  return { tag: (css.match(tagRePlain) ?? []).length, semantic: (css.match(semanticRe) ?? []).length }
}

/** style 源码 → WXSS（纯函数，独立可测） */
export function transformStyleToWxss(
  source: string,
  opts: StyleTransformOptions = { px2rpx: true, rpxRatio: 2 },
): string {
  const trace = opts.trace
  // ★底线循环 ①③：生效映射 + 禁用集（config rules 即时生效）
  const res = resolveOverrides(opts.rules)
  const tagRe = makeTagSelectorRe(res.tagMap, res.semanticClass)
  const scopeId = opts.scopeId
  const doScope = Boolean(scopeId) && !res.disabled.has('style/scoped-css')
  if (doScope && scopeId) trace?.add('style/scoped-css', { before: '<style scoped>', after: `选择器末尾追加 [${scopeId}]（:deep() 去包装）` })

  const injectBase = !res.disabled.has('style/semantic-base-wxss')
  let css = injectBase ? `${BASE_SEMANTIC_WXSS}\n${source}` : source
  if (injectBase) trace?.add('style/semantic-base-wxss', { before: 'h1-h6/p/a 无 UA 样式', after: '.proteus-h1~h6/.proteus-p/.proteus-a 基础 WXSS（注入在用户样式之前）' })

  // 1. 标签选择器映射（与模板标签映射一一对应，避免元素已映射而样式匹配不到）
  const doSelectorRewrite = !res.disabled.has('style/selector-tag') && !res.disabled.has('style/selector-semantic')
  const counts = doSelectorRewrite ? countSelectorRewrites(css, res) : { tag: 0, semantic: 0 }
  if (doSelectorRewrite) css = rewriteSelectorTags(css, res, tagRe)
  if (counts.tag > 0) trace?.add('style/selector-tag', { before: `选择器含 HTML 标签（${counts.tag} 处）`, after: '映射为小程序标签（div → view）' })
  if (counts.semantic > 0) trace?.add('style/selector-semantic', { before: `h1-h6/p/a 选择器（${counts.semantic} 处）`, after: '.proteus-* 类选择器（避免同特异性覆盖）' })

  // 2. px → rpx（★阶段三分派层：经注册表 executeRule 执行，AI 覆盖规则 apply 即生效）
  const doPx2rpx = opts.px2rpx && !res.disabled.has('style/px-to-rpx')
  const pxCount = (css.match(/(\d+(?:\.\d+)?)px\b/g) ?? []).length
  if (doPx2rpx) {
    const pxCtx: RuleContext = {
      input: css,
      options: { rpxRatio: opts.rpxRatio },
    }
    executeRule('style/px-to-rpx', pxCtx)
    css = (pxCtx.output as string) ?? css
    if (pxCount > 0) trace?.add('style/px-to-rpx', { before: `${pxCount} 处 px`, after: `${pxCount} 处 rpx（rpxRatio=${opts.rpxRatio}）` })
  }

  // 3. Skyline 不支持的属性编译期警告
  const unsupported: string[] = []
  if (!res.disabled.has('style/skyline-unsupported')) {
    if (/float\s*:/.test(css)) unsupported.push('float')
    if (/position\s*:\s*fixed\b/.test(css)) unsupported.push('position: fixed')
  }
  for (const u of unsupported) {
    console.warn(`[mp-transform] WXSS 检测到 Skyline 不支持的属性：${u}（编译期警告）`)
    trace?.add('style/skyline-unsupported', { before: u, after: '编译期警告（不阻断构建）' })
  }

  // 4. scoped CSS（v0.3）：:deep() 去包装 + 每条规则选择器末尾追加 [scopeId]
  //    （模板侧元素已附加 scopeId 属性，属性选择器精确匹配；@media/@keyframes 骨架保留）
  if (doScope && scopeId) {
    css = css.replace(/:deep\(([^)]*)\)/g, '$1')
    css = css.replace(/([^{}]+)\{/g, (m: string, sel: string) => {
      const s = sel.trim()
      if (s.startsWith('@')) return m
      return `${s}[${scopeId}] {`
    })
  }
  return css
}
