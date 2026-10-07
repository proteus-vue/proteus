// packages/cli/src/app-content.ts —— ★★★App 端屏内容构建（`proteus build --target ios|android|harmony`）
//   项目路由 → 真实 SFC → 编译器 → 屏内容（2026-10-04）
//
// 【它做什么】把项目里每个路由指向的 SFC 编译成 **App 端屏内容**（`ScreenContent`：
//   内核节点描述），产出 `<root>/dist/app/<platform>/screen-content.json`（键 = 屏名）。
//   宿主（Android/iOS 的 ScreenHost）按屏名取内容建真实页面子树。
//
// 【★标准目标（不自造笼统的 `app`）】平台命名与全仓一致（`CONCRETE_PLATFORMS`：
//   web/mp/ios/android/harmony）——App 端**按具体平台**构建（`ios`/`android`/`harmony`），
//   产物分目录 `dist/app/<platform>/`。当前三端内容由**同一编译器**产出（结构一致），
//   但按平台分目录是**标准做法**：平台专属编译（条件编译/平台变体）就绪后，各端产物自然分叉，
//   且宿主按自己的平台取自己的产物（不共享一份隐含默认）。
//
// 【为什么在构建期】`buildLayoutTemplate` 依赖 `@vue/compiler-sfc`（Node API）⇒ 端上（QuickJS/JSC）
//   跑不了。构建期编译、产物下发（与 MP 产 wxml、Vapor 产 layout template 同一形态）。
//
// 【数据来源】项目**统一导航产物** `router/auto-routes.ts`（gen-routes 生成，含 routes 的
//   `component` 字段）——保证 App 屏内容与路由表**同源**（同一棵路由树）。
//
// 【诚实边界】App 路径**不吃 CSS class**（缺口 C1）⇒ 屏内容眼下主要是**结构**（节点/层级）+
//   页面里的 inline style；逐页诊断如实返回（调用方可打印）。CSS class 展开属后续批次。
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildLayoutTemplate, parseCssVarTokens, extractFromSfc, computeTree, overlayIrValues, SWITCH_BATCHES, APP_ENUM_VALUES } from '@proteus-vue/compiler'
import type { AlignNode } from '@proteus-vue/compiler'
import { screenContentFromLayoutTemplate } from '@proteus-vue/render-backend'
import { APP_PLATFORMS, type AppPlatform } from './targets'

// ★目标/平台名 SSOT 在 ./targets（三处一致，不漂）。此处再导出供既有消费方（hosts 生成器等）。
export { APP_PLATFORMS, type AppPlatform, isAppPlatform } from './targets'

export interface AppScreenContentResult {
  ok: boolean
  /** 平台（产物落在 `<root>/dist/app/<platform>/`） */
  platform: AppPlatform
  /** 产物文件（`<root>/dist/app/<platform>/screen-content.json`） */
  outFile: string
  /** 编译成功页数 */
  compiled: number
  /** 跳过页数（缺 SFC / 编译失败） */
  skipped: number
  /** 逐页诊断（如实；多为 CSS class / 不支持语法） */
  diagnostics: string[]
}

/**
 * 生成 App 屏内容产物（**按平台**）。
 * @param root 项目根（含 `router/auto-routes.ts`——由 gen-routes 产出；调用方负责先跑 gen-routes）
 * @param platform 具体平台（ios/android/harmony；产物落 `dist/app/<platform>/`）
 */
/**
 * ★★★G-61 后批：**IR 切换白名单**（plan §2.2 逐字段批次）。
 *   `PROTEUS_APP_IR_SWITCH`：批次名（默认 `paint-values`）或 `off`（关闭覆盖 ⇒ 纯旧通路）。
 *   ★永久排除项见 `SWITCH_BATCHES['app-adaptation-excluded']`（App 适配——须搬到 applier，不走本通道）。
 *   ★★函数内求值（**不是模块常量**——本仓实测：模块级常量在 ESM 里只求值一次，
 *     测试/工具里"改 env 再调用"会拿到**首次**的白名单 ⇒ off/on 对比恒同，**静默失效**）。
 */
function irSwitchFields(): readonly string[] {
  const v = process.env.PROTEUS_APP_IR_SWITCH ?? 'paint-values'
  if (v === 'off') return []
  return SWITCH_BATCHES[v] ?? SWITCH_BATCHES['paint-values']!
}

export async function buildAppScreenContent(root: string, platform: AppPlatform = 'android'): Promise<AppScreenContentResult> {
  const autoRoutes = path.join(root, 'router', 'auto-routes.ts')
  if (!fs.existsSync(autoRoutes)) {
    throw new Error(`缺 ${path.relative(root, autoRoutes)}——先运行 gen-routes（proteus build --target skyline/web 会产出）`)
  }
  // ★批次 9：设计令牌（`globalStyle` 声明的 CSS 变量文件）——SFC 内 `var()` 编译期折叠
  //   （App 端无运行时 CSS 引擎）。与 Web/MP 消费同一份令牌文件（单一事实源）。
  let tokens: Record<string, string> | undefined
  // ★批次 46：全局样式表内容（`globalStyle`）——App 端无 CSS 引擎 ⇒ 其 `.class{}` 规则也须在
  //   构建期折进节点（页面大量用全局类 `sa-card`/`sa-item`…，此前只折 SFC 内 `<style>` ⇒ 全落空）。
  let globalCss: string | undefined
  try {
    const cfgPath = path.join(root, 'proteus.config.ts')
    if (fs.existsSync(cfgPath)) {
      const { loadProteusConfig } = await import('./config-loader')
      const { config: cfgV4 } = await loadProteusConfig(cfgPath)
      const gs = cfgV4.targets.mp?.globalStyle ? path.resolve(root, cfgV4.targets.mp.globalStyle) : undefined
      if (gs && fs.existsSync(gs)) {
        globalCss = fs.readFileSync(gs, 'utf-8')
        tokens = parseCssVarTokens(globalCss)
      }
    }
  } catch {
    /* 无配置/加载失败 ⇒ 不折叠 var()（保持既有行为，不阻断） */
  }
  const routerDir = path.dirname(autoRoutes)
  // 动态加载（TS 直接 import；auto-routes 仅 type import ⇒ 无运行时依赖）
  const mod = (await import(pathToFileURL(autoRoutes).href)) as {
    routes?: Array<{ name: string; component?: string }>
  }
  const routes = mod.routes ?? []
  if (routes.length === 0) throw new Error(`${path.relative(root, autoRoutes)} 无 routes——格式变了？`)

  const out: Record<string, unknown> = {}
  const diagnostics: string[] = []
  let compiled = 0
  let skipped = 0
  for (const r of routes) {
    const rel = r.component
    if (!rel) {
      diagnostics.push(`${r.name}: 无 component 字段`)
      skipped++
      continue
    }
    const abs = path.resolve(routerDir, rel)
    if (!fs.existsSync(abs)) {
      diagnostics.push(`${r.name}: 缺 SFC（${rel}）`)
      skipped++
      continue
    }
    const sfcSrc = fs.readFileSync(abs, 'utf-8')
    // ★批次 46：页面自身的 `ref(<字面量>)` 初值 → 构建期静态实例化（App 端无运行时，页面数据
    //   取初值快照）——KPI 卡（`stats`）/状态值（`themeLabel`…）由此在 App 端显示。
    const pageStatics = { ...extractRefLiterals(sfcSrc) }
    const res = buildLayoutTemplate(sfcSrc, path.relative(root, abs), undefined, tokens, pageStatics, globalCss)
    if (!res.ok) {
      diagnostics.push(`${r.name}: 模板编译失败`)
      skipped++
      continue
    }
    // ★★★G-61 后批：**IR 覆盖**（切换执行——见 applyIrOverlay；白名单来自 SWITCH_BATCHES）
    applyIrOverlay(sfcSrc, path.relative(root, abs), pageStatics, tokens, globalCss, res.template, irSwitchFields(), diagnostics, r.name)
    out[r.name] = screenContentFromLayoutTemplate(res.template)
    compiled++
    for (const d of res.diagnostics) diagnostics.push(`${r.name}: ${d.code} ${d.message}`)
  }

  // ★★★批次 45：**App 壳合并**（App.vue 的 global/overlay 层 → 每页单树）。
  //   提供 `<root>/app-shell.ts`（导出 `statics`）⇒ 构建期静态实例化 App.vue，取其 **global 层**
  //   （主题底，置底）+ **overlay 层**（chrome/tab 栏，置顶，`position:absolute` 浮于页面）与页面内容
  //   合成**一棵树**（先 global、后页面、末 overlay）——后画者在顶层 ⇒ 零宿主/内核改动即得 App 壳。
  //   缺 `app-shell.ts` ⇒ **零行为变化**（不合并）。
  try {
    const shellPath = path.join(root, 'app-shell.ts')
    const appVue = path.join(root, 'App.vue')
    if (fs.existsSync(shellPath) && fs.existsSync(appVue)) {
      const shellMod = (await import(pathToFileURL(shellPath).href)) as { statics?: Record<string, unknown> }
      const statics = shellMod.statics ?? {}
      const shellRes = buildLayoutTemplate(fs.readFileSync(appVue, 'utf-8'), path.relative(root, appVue), undefined, tokens, statics, globalCss)
      if (shellRes.ok) {
        // ★★★G-61 后批：壳（App.vue）同样走 IR 覆盖（与页面同判据——global/overlay 层也有样式）
        applyIrOverlay(
          fs.readFileSync(appVue, 'utf-8'),
          path.relative(root, appVue),
          statics,
          tokens,
          globalCss,
          shellRes.template,
          irSwitchFields(),
          diagnostics,
          'app-shell',
        )
        const shellNodes = (screenContentFromLayoutTemplate(shellRes.template).nodes ?? []) as ShellNode[]
        const globalSub = subtreeOf(shellNodes, 'global-layer')
        const overlaySub = subtreeOf(shellNodes, 'overlay-layer')
        // ★壳自带 tab 栏（overlay-layer 的**最后一个直接子节点**）在合并时**剔除**——它由**宿主原生
        //   tab 栏**替代（后者能反映当前页高亮并驱动切页；静态壳 tab 栏无法回写 activeTab）。
        //   剔除后避免"双 Tab 栏"；底部导航由宿主提供（与 MP 原生 tabBar 同语义）。
        {
          const ov = shellNodes.find((n) => n.semantic === 'overlay-layer')
          if (ov) {
            const kids = shellNodes.filter((n) => n.parentId === ov.id)
            const tabbarRoot = kids.length ? kids[kids.length - 1] : undefined
            if (tabbarRoot) {
              // 闭包该子树并移出 overlaySub
              const drop = new Set<number>([tabbarRoot.id])
              let grew = true
              while (grew) {
                grew = false
                for (const n of shellNodes) {
                  if (n.parentId != null && drop.has(n.parentId) && !drop.has(n.id)) {
                    drop.add(n.id)
                    grew = true
                  }
                }
              }
              for (const id of drop) overlaySub.delete(id)
            }
          }
        }
        if (globalSub.size || overlaySub.size) {
          for (const r of routes) {
            const page = out[r.name] as { nodes?: ShellNode[] } | undefined
            if (!page?.nodes) continue
            page.nodes = mergeShell(page.nodes, shellNodes, globalSub, overlaySub)
          }
          for (const d of shellRes.diagnostics) diagnostics.push(`App.vue(壳): ${d.code} ${d.message}`)
        }
      } else {
        diagnostics.push('App.vue(壳): 模板编译失败——未合并（页面照常构建）')
      }
    }
  } catch (e) {
    diagnostics.push(`App.vue(壳) 合并失败（页面照常构建）：${String((e as Error)?.message ?? e)}`)
  }

  const outDir = path.join(root, 'dist', 'app', platform)
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, 'screen-content.json')
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2))
  // ★★★运行时表现配置 → app-config.json（2026-10-08 · 决策 #594）：宿主据此显隐系统状态栏等。
  //   源自应用根 `app.config.ts`（`safeArea.statusBar` 等）——与 Web/MP 同一份（单一事实源）。
  //   缺文件/加载失败 ⇒ 不写（宿主用默认 show）。
  try {
    const appCfgPath = path.join(root, 'app.config.ts')
    if (fs.existsSync(appCfgPath)) {
      const { loadProjectConfig } = await import('./config-loader')
      const appCfg = (await loadProjectConfig(appCfgPath)) as { safeArea?: { statusBar?: string } } | undefined
      const statusBar = appCfg?.safeArea?.statusBar === 'hide' ? 'hide' : 'show'
      fs.writeFileSync(path.join(outDir, 'app-config.json'), JSON.stringify({ safeArea: { statusBar } }, null, 2))
    }
  } catch { /* 无 app.config / 加载失败 ⇒ 不写，宿主默认 show */ }
  if (compiled === 0) throw new Error('零页面编译成功——App 屏内容产物为空（路由格式/编译器有问题？）')
  return { ok: true, platform, outFile, compiled, skipped, diagnostics }
}

/** 从 `openIdx` 处的 `(` 取**括号平衡**的内容（跳过字符串字面量） */
function parseBalanced(src: string, openIdx: number): string | null {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]
    if (ch === '(') depth++
    else if (ch === ')') { depth--; if (depth === 0) return src.slice(openIdx + 1, i) }
    else if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch
      for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++
    }
  }
  return null
}

/**
 * 从 SFC 的 `<script setup>` 抽取 `const X = ref(<字面量>)` 的初值快照（App 端无运行时，页面数据
 *   取构建期初值）。只认**可 JSON 求值的字面量**（数字/字符串/布尔/数组/对象）；其余（含调用/变量）跳过。
 */
export function extractRefLiterals(sfcSrc: string): Record<string, unknown> {
  const m = /<script[^>]*>([\s\S]*?)<\/script>/.exec(sfcSrc)
  if (!m) return {}
  const script = m[1]
  const out: Record<string, unknown> = {}
  // ① `const X = ref(<字面量>)`
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*ref\s*(?:<[^>]*>)?\s*\(/g
  let mm: RegExpExecArray | null
  while ((mm = re.exec(script))) {
    const name = mm[1]
    const openIdx = mm.index + mm[0].length - 1   // `m[0]` 末尾即 `(`
    const lit = parseBalanced(script, openIdx)
    if (lit == null || !lit.trim()) continue
    try {
      // eslint-disable-next-line no-new-func
      out[name] = new Function(`return (${lit});`)()
    } catch { /* 非字面量 ⇒ 跳过 */ }
  }
  // ② `const X = <字面量>`（**非 ref 的普通常量**——真实项目大量用，如 `const versionText = 'v0.1.0 …'`；
  //   模板里 `{{ versionText }}` 此前因无值而空着，独立视觉验收抓出「关于卡片缺版本值」）。
  const re2 = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*([\s\S]*?)(?=\n\s*(?:const|let|var|function|async|class|export|\/\/|\/\*|$)|\n\s*\n)/g
  let m2: RegExpExecArray | null
  while ((m2 = re2.exec(script))) {
    const name = m2[1]
    if (name in out) continue
    let lit = (m2[2] ?? '').trim()
    // 去掉尾部分号/行尾注释
    lit = lit.replace(/;\s*$/, '').replace(/\/\/[^\n]*$/, '').trim()
    if (!lit) continue
    // 只看**纯字面量**形态（字符串/数字/布尔/数组/对象/模板串无插值）——含标识符/调用一律跳过（不猜）
    if (!/^(\{|\[|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`$]*`|-?\d|\btrue\b|\bfalse\b|\bnull\b)/.test(lit)) continue
    try {
      // eslint-disable-next-line no-new-func
      const v = new Function(`return (${lit});`)()
      if (v === undefined || typeof v === 'function') continue
      out[name] = v
    } catch { /* 非字面量 ⇒ 跳过 */ }
  }
  return out
}

/**
 * ★★★G-61 后批：**IR 值覆盖**（切换执行——plan §2.2 逐字段批次）。
 *   在旧折叠产物上，把 **CSE 算出的白名单字段值**写回（旧通路继续负责结构转换与 App 适配）。
 *   ★对齐前提：给 extract 传**与旧通路相同的 statics**（否则两树不同源——覆盖会整体拒绝，
 *     绝不部分错配）。★值域护栏：枚举字段过 `APP_ENUM_VALUES`（内核封闭集）。
 *   @returns 覆盖统计（供 diagnostics 如实透出）
 */
function applyIrOverlay(
  sfcSrc: string,
  filename: string,
  statics: Record<string, unknown> | undefined,
  tokens: Record<string, string> | undefined,
  globalCss: string | undefined,
  template: { nodes: Array<{ id: number; parentId: number | null; style?: Record<string, unknown> }> },
  fields: readonly string[],
  diagnostics: string[],
  label: string,
): { applied: number; unaligned: number; reason?: string } {
  let ex
  let computed
  try {
    ex = extractFromSfc(sfcSrc, {
      ...(statics ? { statics } : {}),
      ...(globalCss ? { globalCss } : {}),
    })
    computed = computeTree(ex.roots, ex.sheet, { inlineStyles: ex.inlineStyles })
  } catch (e) {
    diagnostics.push(`${label}: IR 覆盖跳过（CSE 提取/计算失败：${(e as Error).message.slice(0, 100)}）`)
    return { applied: 0, unaligned: 0, reason: 'cse-failed' }
  }
  // 旧树：扁平 nodes（含合成 p-text 叶——对齐器会跳过）按 parentId 构树
  const kidsOf = new Map<number | null, typeof template.nodes>()
  const byId = new Map<number, (typeof template.nodes)[number]>()
  for (const n of template.nodes) {
    byId.set(n.id, n)
    const pid = n.parentId ?? null
    const arr = kidsOf.get(pid)
    if (arr) arr.push(n)
    else kidsOf.set(pid, [n])
  }
  const toAlign = (n: (typeof template.nodes)[number]): AlignNode => ({
    id: n.id,
    tag: (n as { tag?: string }).tag ?? '',
    children: (kidsOf.get(n.id) ?? []).map(toAlign),
  })
  const oldRoots = (kidsOf.get(null) ?? []).map(toAlign)
  const r = overlayIrValues(
    oldRoots,
    (id: number | string) => (byId.get(id as number)?.style ?? {}) as Record<string, unknown>,
    ex.roots,
    computed.byKey as never,
    { fields, enumValues: APP_ENUM_VALUES as unknown as Record<string, readonly string[]> },
  )
  if (r.reason) {
    diagnostics.push(`${label}: IR 覆盖整体拒绝（${r.reason}）——保留旧通路值`)
    return { applied: 0, unaligned: r.unaligned, reason: r.reason }
  }
  if (r.unaligned > 0) diagnostics.push(`${label}: IR 覆盖未对齐 ${r.unaligned} 节点（对齐不完整——已应用 ${r.applied} 字段，请复核）`)
  for (const op of r.ops) {
    if (op.skipped) diagnostics.push(`${label}: 节点 ${op.nodeId} 字段 ${op.field} 跳过（${op.skipped}）`)
  }
  void tokens
  return { applied: r.applied, unaligned: r.unaligned }
}

/** 屏内容节点（`screenContentFromLayoutTemplate` 的形状——只声明本文件用到的字段） */
interface ShellNode {
  id: number
  parentId: number | null
  semantic?: string
  [k: string]: unknown
}

/** 某语义容器（`global-layer`/`overlay-layer`）的**子树 id 集合**（含根；按 parentId 链闭包） */
function subtreeOf(nodes: ShellNode[], semantic: string): Set<number> {
  const root = nodes.find((n) => n.semantic === semantic)
  if (!root) return new Set()
  const set = new Set<number>([root.id])
  let grew = true
  while (grew) {
    grew = false
    for (const n of nodes) {
      if (n.parentId != null && set.has(n.parentId) && !set.has(n.id)) {
        set.add(n.id)
        grew = true
      }
    }
  }
  return set
}

/**
 * 把 App 壳的 global 层（置底）+ overlay 层（置顶）与页面内容合成**一棵树**。
 * 顺序 = [新根] → global 子树 → 页面子树 → overlay 子树（后画者在顶层；overlay 用 absolute 浮于页面）。
 * 全部 id 重排到新空间（避免壳/页面 id 冲突），parentId 同步改写（容器根挂新根、其余按映射）。
 */
function mergeShell(
  pageNodes: ShellNode[],
  shellNodes: ShellNode[],
  globalSub: Set<number>,
  overlaySub: Set<number>,
): ShellNode[] {
  const out: ShellNode[] = [{ id: 0, parentId: null, semantic: 'app-root' }]
  const shellById = new Map(shellNodes.map((n) => [n.id, n]))
  let cursor = 1
  const emit = (nodes: ShellNode[], ids: Set<number>, reparentRootTo: number | null): void => {
    const map = new Map<number, number>()
    // 先分配 id（按原数组序 ⇒ pre-order 稳定）
    for (const n of nodes) if (ids.has(n.id)) map.set(n.id, cursor++)
    for (const n of nodes) {
      if (!ids.has(n.id)) continue
      const newId = map.get(n.id)!
      const pid = n.parentId
      const newParent = pid != null && ids.has(pid) ? map.get(pid)! : reparentRootTo
      out.push({ ...n, id: newId, parentId: newParent })
    }
  }
  // ① global 层（置底）
  const globalOrder = shellNodes.filter((n) => globalSub.has(n.id))
  emit(globalOrder, globalSub, 0)
  // ② 页面（其根 parentId=null → 挂新根）
  const pageIds = new Set(pageNodes.map((n) => n.id))
  emit(pageNodes, pageIds, 0)
  // ③ overlay 层（置顶；absolute 浮于页面）
  const overlayOrder = shellNodes.filter((n) => overlaySub.has(n.id))
  emit(overlayOrder, overlaySub, 0)
  void shellById
  // ★布局：新根 = **纵向流**（页面在上、层用绝对定位浮出）；global/overlay 层容器**绝对铺满**
  //   （不占流、不挤压页面）。App 端无 CSS 引擎 ⇒ 显式写清（与 Web 视口语义一致）。
  const insetFull = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }
  //   ★屏内容节点是**扁平**结构（样式键在**顶层**，`style:{}` 是空壳）⇒ 顶层合并。
  for (const n of out) {
    if (n.semantic === 'app-root') {
      // 根：纵向流 + 全宽（`widthRatio:1` = 100%，内核的百分比字段）+ `relative`（绝对子层以此为定位父）
      n.display = 'flex'
      n.flexDirection = 'column'
      n.alignItems = 'stretch'   // 子项（页面/层）横向撑满（与 Web 块级默认一致）
      n.position = 'relative'
      n.widthRatio = 1
      n.heightRatio = 1
    } else if (n.semantic === 'global-layer') {
      Object.assign(n, insetFull)
    } else if (n.semantic === 'overlay-layer') {
      Object.assign(n, insetFull, { pointerEvents: false })
    } else if (n.parentId === 0 && n.position !== 'absolute') {
      // app-root 的**普通流直接子节点**（= 页面根）：App 端块级元素无默认撑满（引擎按内容收缩）
      //   ⇒ 直接给**绝对铺满**（与 global/overlay 层同法，实测可靠铺满）+ 纵向流 + stretch，
      //   复现 CSS 块级流（页面内容横向撑满），否则内容挤在左上窄条。
      Object.assign(n, insetFull)
      if (n.display == null) n.display = 'flex'
      if (n.flexDirection == null) n.flexDirection = 'column'
      if (n.alignItems == null) n.alignItems = 'stretch'
      // ★★★底部让位 = 页面**自身内边距**（与 Web `.proteus-mount-layer--page` 的
      //   `padding-bottom: calc(120px + safe)` 同义）：Tab 栏是 overlay（浮在页面之上、不占流）
      //   ⇒ 页面必须自己留出底部空间，否则最后一屏内容被 Tab 栏压住。此前用"视口缩小 56dp"代替，
      //   会让依赖 bottom 定位的元素整体偏移（fab 偏高 1.6×，独立验收抓出）。取 120dp（= Web 值）。
      {
        const pad = { ...((n.padding as Record<string, number> | undefined) ?? {}) }
        // ★下让位 = Tab 栏 + 音乐条（与 Web `.proteus-mount-layer--page` 的 120px 同）
        pad.bottom = Math.max(Number(pad.bottom ?? 0) || 0, 120)
        // ★上让位 = 状态栏（与 Web 同款：`padding-top: calc(44px + safe-top)`）——App 端 edge-to-edge
        //   会顶到状态栏下（实测鸿蒙「运营同学」被时钟盖住）；44dp 是 Web 的安全值。
        pad.top = Math.max(Number(pad.top ?? 0) || 0, 44)
        n.padding = pad
      }
    }
  }
  return out
}
