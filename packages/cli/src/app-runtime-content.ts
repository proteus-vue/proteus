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
import { extractRefLiterals, reorderNodesByZ } from './app-content'
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
  let compiled = 0
  let skipped = 0
  for (const r of routes) {
    const rel = r.component
    if (!rel) { diagnostics.push(`${r.name}: 无 component 字段`); skipped++; continue }
    const abs = path.resolve(routerDir, rel)
    if (!fs.existsSync(abs)) { diagnostics.push(`${r.name}: 缺 SFC（${rel}）`); skipped++; continue }
    const sfcSrc = fs.readFileSync(abs, 'utf-8')
    const filename = path.relative(root, abs)

    // 静态初值（`ref(<字面量>)`）——作模板 `statics`（编译期折常量插值）+ `data` 运行期源初值
    const statics = { ...extractRefLiterals(sfcSrc) }
    const tplRes = buildLayoutTemplate(sfcSrc, filename, undefined, tokens, statics, globalCss, dev)
    if (!tplRes.ok) { diagnostics.push(`${r.name}: 模板编译失败`); skipped++; continue }

    const subRes = buildVaporSubscriptions(sfcSrc, filename)
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
      tpl: tplRes.template,
      table: subRes.ok ? subRes.table : EMPTY_TABLE,
      events: (evRes.events ?? []) as unknown[],
      handlers: (evRes.handlers ?? {}) as Record<string, unknown[]>,
      // ★★P1-3 / B5：生命周期绑定（模板 `@vue:mounted` + 脚本 `onMounted`/`onUnmounted`）——
      //   运行期在"首帧 mount 后"（mounted）/ "宿主卸载时"（unmounted）跑其动作表。缺省省略（既有产物不变）。
      ...(evRes.lifecycle ? { lifecycle: evRes.lifecycle } : {}),
      ...(evRes.scriptLifecycle ? { scriptLifecycle: evRes.scriptLifecycle } : {}),
      data: statics,
      // ★dev：屏源文件（相对项目根）——面板据节点 loc 拼 `file:line:col`
      ...(dev ? { file: filename } : {}),
    }
    compiled++
    for (const d of tplRes.diagnostics) diagnostics.push(`${r.name}: ${d.code} ${d.message}`)
    if (!subRes.ok) diagnostics.push(`${r.name}: 订阅表编译未就绪（降级空表——无响应式）`)
    for (const d of (evRes.diagnostics ?? [])) diagnostics.push(`${r.name}[ev]: ${d.message}`)
  }

  const outDir = path.join(root, 'dist', 'app', platform)
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, 'runtime-content.json')
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2))
  if (compiled === 0) throw new Error('零页面编译成功——运行期屏内容产物为空（路由格式/编译器有问题？）')
  return { ok: true, platform, outFile, compiled, skipped, diagnostics }
}
