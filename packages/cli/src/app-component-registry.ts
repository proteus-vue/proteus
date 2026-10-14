// packages/cli/src/app-component-registry.ts —— ★★★App 组件实例化（构建期产出组件注册表）
//
// 【它补什么（决策 #811）】App 链此前**不展开 Vue 组件**——`p-*` 组件标签只作不透明原生标签下发，
//   组件内部（`p-icon` 的 `<svg><path>` 等）在端上永不渲染。真正的组件实例化引擎（`slot-runtime` 的
//   `instantiateTemplate` + `opts.components`）早已就绪（还带 props/插槽/递归），**缺的是生产者**：
//   没有任何构建步骤把子组件的 `.vue` 编译成 `ComponentDef`（`{template, table, data}`）。
//   ⇒ 本模块 = 那个生产者：扫描页面用到的 `p-*` 组件 → 定位源码（框架组件库 / 应用 components/）→
//     用 `buildLayoutTemplate` + `buildVaporSubscriptions` 编译 → 产出 `Record<tag, ComponentDef>`。
//
// 【形态对齐】与设备夹具 `hosts/android/gen-vapor-fixture.mjs` 同范式（构建期编译，端上不跑 script）；
//   产物形状 = `slot-runtime` 的 `ComponentDef`（`template`/`table`/`data`），随 `runtime-content.json`
//   下发，运行期由 `screen-runtime` 喂给 `instantiateTemplate` 的 `opts.components`。
//
// 【为什么在 cli】构建期 `buildLayoutTemplate` 依赖 `@vue/compiler-sfc`（Node API）⇒ 端上跑不了
//   （同 app-runtime-content.ts）。组件源码定位复用 plugin-vite 的 `resolveComponentsRoot`（唯一实现）。
import fs from 'node:fs'
import path from 'node:path'
import { buildLayoutTemplate, buildVaporSubscriptions } from '@proteus-vue/compiler'
import { resolveComponentsRoot } from '@proteus-vue/plugin-vite'
import { iconByName, hasIcon } from '@proteus-vue/icons'
import { resolveGlass, cssSaturateForMaterial } from '@proteus-vue/glass'

/**
 * ★★★玻璃材质折叠（自研液态玻璃，决策 #818）：`<pg-glass …props>` → 引擎 `glass` 字段。
 *   复用 `@proteus-vue/glass` 的 `resolveGlass`（**材质参数唯一真源**）解析 preset+props →
 *   折成内核 `GlassSpec` 形态（hex tint 而非 rgba——内核 `parse_css_color` 只吃 #RRGGBBAA）。
 *   返回 null = 无法解析（缺 preset 等）⇒ 不折（`pg-glass` 保持普通盒）。
 */
export function glassResolver(props: Record<string, string | undefined>): Record<string, unknown> | null {
  const preset = props.preset ?? 'custom'
  const num = (v: string | undefined): number | undefined => {
    if (v === undefined) return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  const bool = (v: string | undefined): boolean | undefined => (v === undefined ? undefined : v === 'true' || v === '')
  const r = resolveGlass({
    preset: preset as never,
    intensity: props.intensity === undefined ? undefined : (Number.isFinite(Number(props.intensity)) ? Number(props.intensity) : (props.intensity as never)),
    tint: props.tint,
    radius: num(props.radius),
    border: bool(props.border),
    noise: num(props.noise),
    fallback: props.fallback as never,
    interactive: bool(props.interactive),   // ★#905：触控形变
    overlay: bool(props.overlay),            // ★#952：选中胶囊叠加层
    interactiveEffect: props.interactiveEffect as never,   // ★#906：交互效果形态（resolveGlass 归一）
    material: props.material as never,
  })
  const sideMap: Record<string, string> = { all: 'all', top: 'top', bottom: 'bottom', right: 'right' }
  return {
    blur: r.blurPx,
    // 内核只吃 #RRGGBBAA：rgba(r,g,b,a) → #RRGGBBAA（alpha 0..1 → 0..255）
    tint: rgbaToHex8(r.tint),
    radius: r.radiusPx,
    border: r.border,
    borderSide: sideMap[r.borderSide ?? 'all'] ?? 'all',
    noise: r.noise,
    // ★★★决策 #910（报告 P2-3）：`saturation` 此前**硬编码 1.0**（IR 字段从未被填 ⇒ 原生自绘恒中性 ⇒ 玻璃偏灰、
    //   缺 iOS `.regular` 的"blur + saturate"通透感；该常量此前只在 Web/MP 的 CSS 路径补过，见 `@proteus-vue/glass` 的
    //   `CSS_SATURATE=1.8`）。现按材质派生，且**复用 CSS 侧同一映射** `cssSaturateForMaterial`（SSOT——防两套口径漂移）。
    saturation: cssSaturateForMaterial(materialOf(props.material)),
    // ★★★决策 #900：材质选择——`<pg-glass material="...">` → 折进 `glass.material`（宿主按 id 派发管线）。
    //   缺省/未知 ⇒ 'glass'（保持既有行为；合法集 = 材质目录 id，见 `@proteus-vue/shader` catalog）。
    material: materialOf(props.material),
    // ★★★决策 #905：触控形变流动——折进 `glass.interactive`（宿主据此接触摸→每帧喂 touch/press uniform）。
    interactive: r.interactive,
    // ★#952：选中胶囊叠加层——折进 `glass.overlay`（宿主写 overlay uniform：叠半透明中性色 light→灰/dark→亮）。
    overlay: r.overlay ? 1 : 0,
    // ★★★决策 #906：交互效果形态——0=**上层玻璃表面流动**（默认，Apple `isInteractive`）/ 1=内容折射位移。
    //   折进 `glass.effect`，宿主透传为着色器 `effect` uniform（复用原 `_pad2` 槽，布局仍 96B）。
    effect: r.interactiveEffect === 'displace' ? 1 : 0,
    // ★level 是**运行期能力决策**（系统材质 vs 自绘），由宿主据自身 OS 能力定，非构建期 —— 此处不下发。
  }
}

/** ★#900：材质 id 归一——已知材质白名单；缺省/未知 ⇒ 'glass'（向后兼容，不静默给未知 id）。 */
const KNOWN_MATERIALS = new Set(['glass', 'backdropBlur', 'frosted', 'vibrancy'])
function materialOf(v: string | undefined): string {
  return v && KNOWN_MATERIALS.has(v) ? v : 'glass'
}

/** CSS 颜色 → 内核可吃的 `#RRGGBBAA`（rgba(...) / #rgb / #rrggbb / #rrggbbaa）。不可解析 ⇒ 透明黑。 */
function rgbaToHex8(css: string): string {
  const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  const s = css.trim().toLowerCase()
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s)
  if (m) {
    const a = m[4] === undefined ? 1 : Number(m[4])
    return `#${hex(Number(m[1]))}${hex(Number(m[2]))}${hex(Number(m[3]))}${hex(a * 255)}`
  }
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}ff`
  if (/^#[0-9a-f]{6}$/.test(s)) return `${s}ff`
  if (/^#[0-9a-f]{8}$/.test(s)) return s
  return '#00000000'
}

/**
 * ★★★App p-icon 图标降级（P4-续 phase B · 决策 #813）：静态语义名 → `{d, viewBox}`。
 *   构建期注入 `buildLayoutTemplate` 的 `opts.iconResolver`——**静态** `<p-icon name="home">` 在编译期
 *   解析为 path（降级为叶子盒）。返回 null ⇒ 未知名（不降级 + 诊断）。**所有** App 编译通路（静态
 *   `screen-content` + 运行期 `runtime-content`）共用本解析器（同源同口径）。
 */
export const iconResolver = (name: string): { d: string; viewBox?: string } | null => {
  if (!hasIcon(name)) return null
  const def = iconByName(name)
  return { d: def.d, viewBox: def.viewBox ?? '0 0 24 24' }
}

/** 一个组件的构建期快照（= slot-runtime 的 `ComponentDef` 形态，可直接序列化跨端） */
export interface AppComponentDef {
  /** 该组件 `<template>` 的编译产物（`buildLayoutTemplate` 结果） */
  tpl: unknown
  /** props → 槽位 的订阅表（有它 props 才能下行） */
  table: unknown
  /** `<script setup>` 的构建期数据快照（端上不执行 script） */
  data: Record<string, unknown>
}

/** 标签 → 源码绝对路径。tag 为 kebab（`p-icon`）。 */
const tagRegex = (tpl: string): string[] => {
  const used = new Set<string>()
  // 去掉注释块（示例文本里的 <p-xxx> 不应误当使用）
  const body = tpl.replace(/<!--[\s\S]*?-->/g, '')
  const re = /<([A-Za-z][\w-]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const raw = m[1]
    // PascalCase → kebab（与 MP collectComponents 同口径）
    const tag = /[A-Z]/.test(raw) ? raw.replace(/\B([A-Z])/g, '-$1').toLowerCase() : raw
    // ★★★决策 #906：框架前缀族 = `p-*`（基础组件）**与 `pg-*`（玻璃族：pg-glass / pg-glass-nav）**——
    //   此前只认 `^p-[a-z]` ⇒ `pg-` 开头的标签**漏收**（pg-glass 靠编译器特例才折，pg-glass-nav 则完全不展开）。
    if (/^p[a-z]?-[a-z]/.test(tag)) used.add(tag)
  }
  return [...used]
}

/** 从 SFC 源码抽 `<script setup>` 里的 `const NAME = ref(<字面量>)` 初值（同 app-content 的简化版）。 */
function extractRefLiterals(sfc: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const bodyM = /<script[^>]*setup[^>]*>([\s\S]*?)<\/script>/.exec(sfc)
  const body = bodyM ? bodyM[1] : ''
  const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:ref|shallowRef)\s*\(\s*([^)]*?)\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const v = m[2].trim()
    try {
      if (/^-?\d+(\.\d+)?$/.test(v)) out[m[1]] = Number(v)
      else if (/^'(?:[^'\\]|\\.)*'$/.test(v) || /^"(?:[^"\\]|\\.)*"$/.test(v)) out[m[1]] = JSON.parse(v.replace(/'/g, '"'))
      else if (v === 'true' || v === 'false') out[m[1]] = v === 'true'
    } catch {
      /* 非字面量初值：跳过（端上不执行 script，无法求值） */
    }
  }
  return out
}

/** 解析某组件标签的 `.vue` 源码绝对路径（应用 `components/` 优先，再框架组件库）。未找到 ⇒ null。 */
function resolveComponentSource(tag: string, root: string, fwRoot: string): string | null {
  const candidates = [
    path.join(root, 'components', tag, 'index.vue'),
    path.join(root, 'components', `${tag}.vue`),
    path.join(fwRoot, tag, 'index.vue'),
    path.join(fwRoot, `${tag}.vue`),
  ]
  return candidates.find((c) => fs.existsSync(c)) ?? null
}

/**
 * 解析若干页面用到的、**有 .vue 源码**的 `p-*` 组件标签集——供 `buildLayoutTemplate` 的
 * `opts.componentTags`（据此标记组件边界）。**无源码的标签不入集**（不产边界 ⇒ 不退化为空占位）。
 */
export function resolveComponentTags(sfcSources: Array<{ name: string; src: string }>, root: string): Set<string> {
  const fwRoot = resolveComponentsRoot(root)
  const used = new Set<string>()
  for (const s of sfcSources) for (const t of tagRegex(s.src)) used.add(t)
  const out = new Set<string>()
  for (const tag of used) if (resolveComponentSource(tag, root, fwRoot)) out.add(tag)
  return out
}

/**
 * 收集若干页面源码里用到的 `p-*` 组件，编译成注册表。
 * @param sfcSources 页面 SFC 源码（用于扫描用到的组件标签）
 * @param root 项目根（用于解析应用组件目录 + 相对路径）
 * @param tokens/globalCss 与页面**同一份**设计令牌/全局样式（保证组件内样式折叠同源）
 * @returns `Record<tag, AppComponentDef>`（仅含**找到源码**的组件）
 */
export function buildAppComponentRegistry(
  sfcSources: Array<{ name: string; src: string }>,
  root: string,
  opts: { tokens?: Record<string, string>; globalCss?: string; keepReactiveStructure?: boolean } = {},
): { components: Record<string, AppComponentDef>; diagnostics: string[] } {
  const diagnostics: string[] = []
  const fwRoot = resolveComponentsRoot(root)
  const usedTags = new Set<string>()
  for (const s of sfcSources) for (const t of tagRegex(s.src)) usedTags.add(t)

  const components: Record<string, AppComponentDef> = {}
  for (const tag of [...usedTags].sort()) {
    // 源码解析顺序：应用 components/<tag>/index.vue → 框架组件库 <tag>/index.vue（与 MP collectComponents 同序）
    const found = resolveComponentSource(tag, root, fwRoot)
    if (!found) {
      // 无源码（宿主注入的宿主组件等）⇒ 如实记、不注册（运行期保留边界、内部留空 = 既有行为，不回归）
      diagnostics.push(`组件 <${tag}> 无源码（应用 components/ 与框架组件库均未找到）——本版不展开`)
      continue
    }
    const src = fs.readFileSync(found, 'utf-8')
    const filename = path.relative(root, found)
    const statics = extractRefLiterals(src)
    const tplRes = buildLayoutTemplate(src, filename, undefined, opts.tokens, statics, opts.globalCss, false, { iconResolver, glassResolver, ...(opts.keepReactiveStructure ? { keepReactiveStructure: true } : {}) })
    if (!tplRes.ok) {
      diagnostics.push(`组件 <${tag}> 模板编译失败（${filename}）`)
      continue
    }
    // ★★★决策 #906：组件模板内的**子组件绑定**（kebab 形态如 `pg-glass-nav` 内含 `<pg-glass :radius>`）
    //   也须按 `component.` 归类——与 `buildLayoutTemplate` 的 `componentTags` 同源（此处对**本组件**源解析）。
    const selfTags = resolveComponentTags([{ name: tag, src }], root)
    const subRes = buildVaporSubscriptions(src, filename, selfTags.size > 0 ? { componentTags: selfTags } : {})
    components[tag] = {
      tpl: tplRes.template,
      table: subRes.ok ? subRes.table : { version: 1, sources: [], evaluators: [], l0Slots: [], stats: { l1: 0, l0: 0, l1Rate: 0 } },
      data: statics,
    }
    for (const d of tplRes.diagnostics) diagnostics.push(`组件 <${tag}>: ${d.code} ${d.message}`)
  }
  return { components, diagnostics }
}
