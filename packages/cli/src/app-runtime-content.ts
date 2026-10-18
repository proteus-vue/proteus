// packages/cli/src/app-runtime-content.ts —— ★★★B1：App 端**运行期**屏内容构建（2026-10-09）
//
// 【它补什么（用户「先把宿主关注点分离完全打通，不留任务遗留项，别又是做一半留一半」）】
//   App 壳此前走**构建期静态屏内容**（`buildAppScreenContent` → `{nodes}`）——把页面拍平成死节点树，
//   ⇒ 无运行期 ⇒ 事件/响应式/导航全无（决策 #539/#541 的"下一大阶段"）。而引擎侧 `entry-vapor`
//   早有**运行期**通路（`instantiateTemplate` + `slot-runtime` 派发），只是没喂给 App 壳。
//   ⇒ 本模块为**每个屏**额外产出**运行期编译产物**（`tpl`/`table`/`events`/`handlers`/`data`）——
//     运行期由 `@proteus-vue/render-backend` 的 `createScreenRuntime` **实例化 + 订阅 + 手势派发**。
//
// 【与 `app-content.ts` 的关系（★与静态路径同源同口径）】都从项目 `router/auto-routes.ts` 读 routes、
//   同一份 tokens/globalCss 折叠。静态 `screen-content.json` **保留**（最小宿主/降级兜底/回归基线）；
//   本模块产 `runtime-content.json`（App 壳的真实运行期）。两者按需消费，不互替。
//
// 【为什么在构建期】`buildLayoutTemplate`/`buildVaporSubscriptions`/`compileEvents` 依赖
//   `@vue/compiler-sfc`（Node API）⇒ 端上跑不了（与 Vapor 夹具 `gen-vapor-fixture.mjs` 同形态）。
import fs from 'node:fs'
import path from 'node:path'
import { buildLayoutTemplate, buildVaporSubscriptions, compileEvents, parseCssVarTokens } from '@proteus-vue/compiler'
import { iconByName, hasIcon } from '@proteus-vue/icons'
import { extractRefLiterals, reorderNodesByZ } from './app-content'
import { buildAppComponentRegistry, resolveComponentTags, glassResolver, type AppComponentDef } from './app-component-registry'
import type { AppPlatform } from './targets'
import { resolveAppRoutes } from './app-routes'
import { loadTsModule } from './config-loader'

/** 一个屏的运行期产物 */
export interface ScreenRuntimeArtifact {
  /** 布局模板（运行期 `instantiateTemplate` 的输入） */
  tpl: unknown
  /** 订阅表（源 → 槽位；`SlotRuntime` 据此把数据变更翻成指令） */
  table: unknown
  /** 事件绑定（节点 id → 事件名 → handler 名） */
  events: unknown[]
  /** handler 动作表（`{op:'set'|'add'|'emit'|..., source, program}`） */
  handlers: Record<string, unknown[]>
  /** 初始数据快照（构建期从 SFC script 抽 `ref(<字面量>)`——端上不执行 script） */
  data: Record<string, unknown>
  /**
   * ★★★**组件注册表**（App 组件实例化，决策 #811）：该屏用到的 `p-*` 组件的构建期编译产物
   *   （`{tpl, table, data}`）——运行期由 `screen-runtime` 喂给 `instantiateTemplate` 的 `opts.components`
   *   ⇒ 组件内部被**展开**。缺省省略 ⇒ 既有产物不变（无组件时不产该字段）。
   */
  components?: Record<string, AppComponentDef>
  /**
   * ★★★**数据泵表**（通用原语 `v-pump`，本批）：该屏声明的运行期数据源（宿主按 `hz` 周期性产新值）。
   *   缺省省略 ⇒ 既有产物不变。
   */
  pumps?: Array<{ src: string; hz: number; gen: { kind: string; min: number; max: number; period?: number } }>
  /**
   * ★★**源文件路径**（决策 #713 · 仅供 dev）：该屏对应的 `.vue`（相对项目根）——
   *   节点 `loc` 只带行列、不带文件，面板据此拼出 `file:line:col` 并跳转源文件。缺省省略（release 无）。
   */
  file?: string
}

export interface AppRuntimeContentResult {
  ok: boolean
  platform: AppPlatform
  /** 产物文件（`<root>/dist/app/<platform>/runtime-content.json`） */
  outFile: string
  compiled: number
  skipped: number
  diagnostics: string[]
}

/** 空订阅表占位（`buildVaporSubscriptions` 失败时的降级——不静默假装有订阅） */
const EMPTY_TABLE = { version: 1, sources: [], evaluators: [], l0Slots: [], stats: { l1: 0, l0: 0, l1Rate: 0 } }

/**
 * 生成 App 端**运行期**屏内容产物（按平台）。与 `buildAppScreenContent` 同源（同一 routes / 同一 tokens）。
 *
 * @param root 项目根（含 `router/auto-routes.ts`）
 * @param platform 具体平台
 * @param opts.dev ★（决策 #713）dev 构建 ⇒ 为每个模板节点发射**源位置** `loc`（面板 Elements → 源码映射）；
 *   缺省 false ⇒ 产物逐字节不变。
 */
export async function buildAppRuntimeContent(
  root: string,
  platform: AppPlatform,
  opts: { dev?: boolean } = {},
): Promise<AppRuntimeContentResult> {
  const diagnostics: string[] = []
  const dev = opts.dev === true

  // ★honor `router.routesOutput`（唯一实现 app-routes.ts）——与 app-content 同源同口径。
  const { file: autoRoutes, config: cfgV4 } = await resolveAppRoutes(root)
  if (!fs.existsSync(autoRoutes)) {
    throw new Error(`缺 ${path.relative(root, autoRoutes)}——先运行 gen-routes（proteus build --target skyline/web 会产出）`)
  }

  // ── ① 设计令牌 + 全局样式（与静态路径**逐字同源**——两侧样式折叠口径一致）──
  let tokens: Record<string, string> | undefined
  let globalCss: string | undefined
  try {
    const gs = cfgV4?.targets.mp?.globalStyle ? path.resolve(root, cfgV4.targets.mp.globalStyle) : undefined
    if (gs && fs.existsSync(gs)) {
      globalCss = fs.readFileSync(gs, 'utf-8')
      tokens = parseCssVarTokens(globalCss)
    }
  } catch { /* 无配置/加载失败 ⇒ 不折叠 var()（保持既有行为，不阻断） */ }

  const routerDir = path.dirname(autoRoutes)
  // ★经 config-loader 的 TS 加载器（Node 的 ESM `import()` 不认 `.ts`——真缺陷，见 loadTsModule 注释）
  const mod = loadTsModule(autoRoutes) as {
    routes?: Array<{ name: string; component?: string }>
  }
  const routes = mod.routes ?? []
  if (routes.length === 0) throw new Error(`${path.relative(root, autoRoutes)} 无 routes——格式变了？`)

  const out: Record<string, ScreenRuntimeArtifact> = {}
  // ★★★App 组件实例化（决策 #811）：**预读所有页面源码**——① 供组件标签扫描（算可展开集合）
  //   ② 主循环复用（避免重复读盘）。必须在编译页面前算好 `expandableTags`（供边界标记）。
  const pageSources: Array<{ name: string; src: string }> = []
  const srcByName = new Map<string, { src: string; abs: string }>()
  for (const r of routes) {
    if (!r.component) continue
    const abs = path.resolve(routerDir, r.component)
    if (!fs.existsSync(abs)) continue
    const src = fs.readFileSync(abs, 'utf-8')
    pageSources.push({ name: r.name, src })
    srcByName.set(r.name, { src, abs })
  }
  // ★可展开的 `p-*` 组件标签（有 .vue 源码者）——编译器据此把它们标为组件边界（见 buildLayoutTemplate opts）
  const expandableTags = resolveComponentTags(pageSources, root)
  // ★★App p-icon 图标降级（P4-续 phase B）：静态 `<p-icon name="home">` 在编译期解析为 path（内核据此渲染）。
  const iconResolver = (name: string): { d: string; viewBox?: string } | null => {
    if (!hasIcon(name)) return null
    const def = iconByName(name)
    return { d: def.d, viewBox: def.viewBox ?? '0 0 24 24' }
  }
  // ★★★决策 #938：**动态 `:name` 的运行期图标表** `__iconPath`——把构建期已知数据里
  //   出现的图标名（键名 `icon` 的字符串值，如 `navItems[].icon`）解析为 path/viewBox，注入屏 `data`；
  //   运行期 `<p-icon :name="item.icon">` 的折叶求值器读它取 path（见 build.ts 的绑定改写）。
  //   ★诚实边界：只覆盖**构建期可知**的图标名（data 字面量里的值）；运行期才算出的名不在此表 ⇒ 不渲染（不静默）。
  const collectIconNames = (v: unknown, out: Set<string>): void => {
    if (Array.isArray(v)) { for (const x of v) collectIconNames(x, out); return }
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'icon' && typeof val === 'string' && val) out.add(val)
        else collectIconNames(val, out)
      }
    }
  }
  const compileOpts = {
    ...(expandableTags.size > 0 ? { componentTags: expandableTags } : {}),
    iconResolver,
    glassResolver,
    // ★★★运行时列表/条件保持（2026-10-13 · 台账 A1/B1/B2 同源墙）：运行期通路**必须**保留响应式
    //   v-for/v-if（否则被静态展开成死节点 ⇒ 订阅表/运行期列表被架空）。静态通路（app-content.ts）不开。
    keepReactiveStructure: true,
  }
  let compiled = 0
  let skipped = 0
  for (const r of routes) {
    const rel = r.component
    if (!rel) { diagnostics.push(`${r.name}: 无 component 字段`); skipped++; continue }
    const pre = srcByName.get(r.name)
    if (!pre) { diagnostics.push(`${r.name}: 缺 SFC（${rel}）`); skipped++; continue }
    const { src: sfcSrc, abs } = pre
    const filename = path.relative(root, abs)

    // 静态初值（`ref(<字面量>)`）——作模板 `statics`（编译期折常量插值）+ `data` 运行期源初值
    const statics = { ...extractRefLiterals(sfcSrc) }
    const tplRes = buildLayoutTemplate(
      sfcSrc,
      filename,
      undefined,
      tokens,
      statics,
      globalCss,
      dev,
      compileOpts,
    )
    if (!tplRes.ok) { diagnostics.push(`${r.name}: 模板编译失败`); skipped++; continue }

    // ★★★`v-pump` 声明的运行期数据源名（通用原语）：不在 script 里 ⇒ 作为 `pumpSources` 注入订阅表，
    //   使页面对泵源的绑定（`{{p0}}`/`:style`）建出**订阅槽位**（源=泵）。
    const pumpList = (tplRes.template as { pumps?: Array<{ src: string; gen: { min: number } }> }).pumps ?? []
    const pumpNames = pumpList.map((p) => p.src)
    // ★泵源首帧初值：取 gen.min（有意义的起点；否则文本首帧显示 undefined）——进 `data`（源初值）。
    for (const p of pumpList) if (statics[p.src] === undefined) statics[p.src] = p.gen.min
    const subRes = buildVaporSubscriptions(sfcSrc, filename, { ...(pumpNames.length > 0 ? { pumpSources: pumpNames } : {}), ...(expandableTags.size > 0 ? { componentTags: expandableTags } : {}) })
    const evRes = compileEvents(sfcSrc)

    // ★★★批 A④（2026-10-08 · 决策 #658）：**z-index 层叠序重排**（运行期通路——与静态通路同源同实现）。
    //   ★为什么这里也必须有（本仓实测踩到）：App 壳**运行期**消费 `runtime-content.json` 的 `tpl.nodes`
    //     （`instantiateTemplate` 按**数组序** emit ⇒ 数组序 = 绘制序）；只修静态 `screen-content.json`
    //     ⇒ 产物 JSON 已是新序、而设备渲染仍按旧序（**静默**——这正是本项要消灭的那类形态）。
    {
      const tpl = tplRes.template as { nodes?: Array<{ id: number; parentId: number | null; style?: Record<string, unknown> }> }
      if (Array.isArray(tpl.nodes)) {
        const zDiags: string[] = []
        tpl.nodes = reorderNodesByZ(
          tpl.nodes,
          (n) => ({
            id: n.id,
            parentId: n.parentId ?? null,
            position: n.style?.position,
            zIndex: n.style?.zIndex,
          }),
          zDiags,
        )
        for (const d of zDiags) diagnostics.push(`${r.name}: ${d}`)
      }
    }

    out[r.name] = {
      tpl: wrapViewportRoot(tplRes.template),
      table: subRes.ok ? subRes.table : EMPTY_TABLE,
      events: (evRes.events ?? []) as unknown[],
      handlers: (evRes.handlers ?? {}) as Record<string, unknown[]>,
      // ★★P1-3 / B5：生命周期绑定（模板 `@vue:mounted` + 脚本 `onMounted`/`onUnmounted`）——
      //   运行期在"首帧 mount 后"（mounted）/ "宿主卸载时"（unmounted）跑其动作表。缺省省略（既有产物不变）。
      ...(evRes.lifecycle ? { lifecycle: evRes.lifecycle } : {}),
      ...(evRes.scriptLifecycle ? { scriptLifecycle: evRes.scriptLifecycle } : {}),
      data: (() => {
        const names = new Set<string>()
        collectIconNames(statics, names)
        if (names.size === 0) return statics
        const table: Record<string, { d: string; viewBox: number[] }> = {}
        for (const nm of names) {
          const r = iconResolver(nm)
          if (r) table[nm] = { d: r.d, viewBox: (r.viewBox ?? '0 0 24 24').trim().split(/\s+/).map(Number) }
        }
        return Object.keys(table).length > 0 ? { ...statics, __iconPath: table } : statics
      })(),
      // ★★★数据泵表（`v-pump`）：随屏产物带出（宿主周期驱动）；无声明 ⇒ 省略（既有产物不变）。
      ...((tplRes.template as { pumps?: ScreenRuntimeArtifact['pumps'] }).pumps
        ? { pumps: (tplRes.template as { pumps: ScreenRuntimeArtifact['pumps'] }).pumps }
        : {}),
      // ★dev：屏源文件（相对项目根）——面板据节点 loc 拼 `file:line:col`
      ...(dev ? { file: filename } : {}),
    }
    compiled++
    for (const d of tplRes.diagnostics) diagnostics.push(`${r.name}: ${d.code} ${d.message}`)
    if (!subRes.ok) diagnostics.push(`${r.name}: 订阅表编译未就绪（降级空表——无响应式）`)
    for (const d of (evRes.diagnostics ?? [])) diagnostics.push(`${r.name}[ev]: ${d.message}`)
  }

  // ★★★App 组件实例化（决策 #811）：把页面用到的 `p-*` 组件编译成注册表，**按屏挂载**（该屏用到的组件）。
  //   ⇒ 运行期 `instantiateTemplate` 据此展开组件内部。无组件 ⇒ 各屏不产 `components` 字段（既有产物不变）。
  {
    const { components, diagnostics: compDiags } = buildAppComponentRegistry(pageSources, root, { tokens, globalCss, keepReactiveStructure: true })
    for (const d of compDiags) diagnostics.push(`[components] ${d}`)
    const tags = Object.keys(components)
    if (tags.length > 0) {
      // 该屏的模板里是否用到某组件标签（粗匹配：标签出现即挂——注册表可共用，多余键不影响实例化）
      const usedBy = (src: string): Record<string, AppComponentDef> => {
        const sub: Record<string, AppComponentDef> = {}
        for (const t of tags) if (new RegExp(`<${t}[\\s/>]`).test(src)) sub[t] = components[t]
        return sub
      }
      for (const r of routes) {
        const art = out[r.name]
        if (!art) continue
        const sub = usedBy(srcByName.get(r.name)?.src ?? '')
        if (Object.keys(sub).length > 0) (art as ScreenRuntimeArtifact).components = sub
      }
    }
  }

  const outDir = path.join(root, 'dist', 'app', platform)
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, 'runtime-content.json')
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2))
  if (compiled === 0) throw new Error('零页面编译成功——运行期屏内容产物为空（路由格式/编译器有问题？）')
  return { ok: true, platform, outFile, compiled, skipped, diagnostics }
}

/**
 * ★★★决策 #907：给运行期屏内容包一层**视口高 `app-root`**（对齐静态通路 `app-content.ts` 的结构）。
 *
 * 【为什么必须（悬浮导航 fixed 缺口）】运行期通路的根 = **页面本身**（`minHeight` = 内容高，常 > 视口），
 *   而引擎里 `position:fixed` 的 containing block = **根**（决策 #907）⇒ fixed 的 `bottom` 相对**页面高**
 *   （落到内容底部、屏外）。静态通路有 `app-root`（`heightRatio:1` = 视口高）包一层 ⇒ fixed 相对视口。
 *   ⇒ 运行期也补同款包层（不动既有节点 id：新根插在数组末尾，改旧根 `parentId`），fixed 即相对视口。
 *   ★旧根改为 `absolute` + **top/left/right**（**不设 bottom**）：脱离流 ⇒ 可超出视口高根（内容仍可滚动），
 *     但高度**由内容撑开**（auto）。
 *   ★★★（2026-10-18 修 · 用户「首页列表项看着被压缩了那么多、每一个都非常窄」）：**这里原本写了 `bottom:0`**
 *     ⇒ 页面根被钉成「视口高」的定高盒；而内核默认 `display:flex; flex-direction:column`，
 *     flex 子项默认 `flex-shrink:1` ⇒ 内容超高时 **31 个列表项被等比压缩**（真机实测项高 132→72，
 *     CSS 24px vs Web 42.5px）。Web 端页面是 block 流（不压缩）⇒ 纯属本包层引入的回归。
 *     ★为什么会有 `bottom:0`：当时只想着"四边铺满"，没意识到它把高度从 auto 变成了 definite。
 *     ⇒ 与 `position:absolute; inset:0` 的差异是**语义级**的：`inset` 是「铺满父盒」，
 *       而这里要的是「脱离文档流 + 内容撑高」。
 */
function wrapViewportRoot(tpl: unknown): unknown {
  const t = tpl as { nodes?: Array<Record<string, unknown>>; roots?: number[] } | null
  if (!t || !Array.isArray(t.nodes) || t.nodes.length === 0) return tpl
  const oldRoots = Array.isArray(t.roots) && t.roots.length > 0
    ? t.roots.slice()
    : t.nodes.filter((n) => n.parentId === null || n.parentId === undefined).map((n) => n.id as number)
  if (oldRoots.length === 0) return tpl
  const newId = t.nodes.reduce((m, n) => Math.max(m, Number(n.id) || 0), 0) + 1
  for (const rid of oldRoots) {
    const node = t.nodes.find((n) => n.id === rid)
    if (!node) continue
    node.parentId = newId
    const st = (node.style ?? {}) as Record<string, unknown>
    st.position = 'absolute'
    st.left = 0
    st.top = 0
    st.right = 0
    // ★★不设 `bottom`：设了会把高度钉成视口高 ⇒ flex-shrink 压缩所有子项（决策 #1052）
    node.style = st
  }
  t.nodes.push({
    id: newId,
    parentId: null,
    tag: 'view',
    style: { widthRatio: 1, heightRatio: 1, position: 'relative' },
  })
  t.roots = [newId]
  return t
}
