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

/** 逗号选择器列表顶层分割（括号感知：:not(.a, .b) / [data-x="a,b"] 内的逗号不分割） */
function splitTopLevelSelectors(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
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
  // ★2026-08：text 默认行内（微信 text 语义；Skyline defaultDisplayBlock 会把所有节点 block 化——tag 选择器
  //   需配合 tagNameStyleIsolation: legacy（app.json）才能作用原生组件；WebView 下本就 inline，规则无害）
  'text { display: inline; }',
  '.proteus-h1 { display: block; font-size: 64rpx; font-weight: 700; margin: 0 0 0.67em; }',
  '.proteus-h2 { display: block; font-size: 48rpx; font-weight: 700; margin: 0 0 0.83em; }',
  '.proteus-h3 { display: block; font-size: 36rpx; font-weight: 700; margin: 0 0 1em; }',
  '.proteus-h4 { display: block; font-size: 32rpx; font-weight: 700; margin: 0 0 1.33em; }',
  '.proteus-h5 { display: block; font-size: 28rpx; font-weight: 700; margin: 0 0 1.67em; }',
  '.proteus-h6 { display: block; font-size: 24rpx; font-weight: 700; margin: 0 0 2.33em; }',
  '.proteus-p { display: block; margin: 0 0 1em; }',
  '.proteus-a { color: #1a7af8; text-decoration: underline; }',
].join('\n')

// ★vue-compat-advance Batch 2：<transition> 进入动画（纯 CSS，元素经 wx:if 重建时 animation 自动播放）
// 语义：fade 淡入 / slide-up 上滑 / scale 缩放；离开动画 MP 无钩子（wx:if 移除即消失）——文档说明差异
const TRANSITION_WXSS = [
  // ★Batch 5：离开动画（__tl{i} 插值 class 切换；forwards 保持末帧直到延迟移除）
  '.proteus-transition-fade-leave { animation: proteus-fade-out 0.25s ease forwards; }',
  '.proteus-transition-slide-up-leave { animation: proteus-slide-up-out 0.32s cubic-bezier(0.35, 0.91, 0.33, 0.97) forwards; }',
  '.proteus-transition-scale-leave { animation: proteus-scale-out 0.4s cubic-bezier(0.35, 0.91, 0.33, 0.97) forwards; }',
  '.proteus-transition-fade { animation: proteus-fade-in 0.25s ease; }',
  '.proteus-transition-slide-up { animation: proteus-slide-up-in 0.32s cubic-bezier(0.35, 0.91, 0.33, 0.97); }',
  '.proteus-transition-scale { animation: proteus-scale-in 0.4s cubic-bezier(0.35, 0.91, 0.33, 0.97); }',
  '@keyframes proteus-fade-in { from { opacity: 0; } to { opacity: 1; } }',
  '@keyframes proteus-fade-out { from { opacity: 1; } to { opacity: 0; } }',
  '@keyframes proteus-slide-up-in { from { transform: translateY(20%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }',
  '@keyframes proteus-slide-up-out { from { transform: translateY(0); opacity: 1; } to { transform: translateY(20%); opacity: 0; } }',
  '@keyframes proteus-scale-in { from { transform: scale(0.92) translateY(4%); opacity: 0.8; } to { transform: scale(1) translateY(0); opacity: 1; } }',
  '@keyframes proteus-scale-out { from { transform: scale(1) translateY(0); opacity: 1; } to { transform: scale(0.92) translateY(4%); opacity: 0.8; } }',
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
  // ★vue-compat-advance Batch 2：<transition> 进入动画 keyframes 注入（按需：仅页面使用 transition 时）
  const injectTransition = opts.usesTransition === true && !res.disabled.has('transition/animation-wxss')
  if (injectTransition) css = `${css}\n\n${TRANSITION_WXSS}`

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

  // 4. scoped CSS（v0.3 → ★2026-08 真机重构）：选择器类名后缀拼接——scopeId 并入类名（.box → .box-data-v-xxx），单一类选择器
  //    （Skyline glass-easel **不支持复合类选择器 .a.b**——真机实测：组件自己 wxss 匹配自己根节点都失效（p-button padding 消失）且无警告；
  //    属性选择器 [data-v] 也不支持（f48460c 改 class 复合仍不兼容）→ 类名后缀是唯一 Skyline 确定支持的路径（类选择器 ✓））
  //    ★修复①②③（0b16523）：@keyframes 帧不处理 / 伪类伪元素后缀在类名后（.a-data-v-x:hover）/ 逗号列表逐条 / :deep 去包装后统一后缀
  if (doScope && scopeId) {
    css = css.replace(/:deep\(([^)]*)\)/g, '$1') // 去包装（后缀由下方统一处理）
    css = css.replace(/([^{}]+)\{/g, (m: string, sel: string) => {
      const s = sel.trim()
      if (s.startsWith('@')) return m
      const parts = splitTopLevelSelectors(s)
      const scoped = parts
        .map((p) => {
          const t = p.trim()
          if (/^(from|to|\d+(?:\.\d+)?%)$/i.test(t)) return t // @keyframes 帧选择器不处理
          return suffixClassTokens(t, scopeId)
        })
        .join(', ')
      return `${scoped} {`
    })
  }
  return css
}

/** ★scoped 类名后缀拼接：选择器内每个类 token 追加 -scopeId（单类选择器，Skyline ✓）
 * - .box → .box-data-v-x；.box:hover → .box-data-v-x:hover（伪类不后缀）
 * - .box .title → .box-data-v-x .title-data-v-x（每个类 token）
 * - 属性选择器内容屏蔽（[..] 内可能含 .）；已带 scopeId 后缀的不重复
 * - 标签选择器（无 .）不处理（依赖微信样式隔离 ownerSpace） */
function suffixClassTokens(sel: string, scopeId: string): string {
  const attrs: string[] = []
  const masked = sel.replace(/\[[^\]]*\]/g, (m) => {
    attrs.push(m)
    return `\u0000${attrs.length - 1}\u0000`
  })
  const out = masked.replace(/\.(-?[_a-zA-Z][-_a-zA-Z0-9]*)/g, (m, name: string) =>
    name.endsWith(`-${scopeId}`) ? m : `.${name}-${scopeId}`,
  )
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => attrs[Number(i)])
}
