// hosts/android/bridge/entry-batch.ts —— ★S3b：Android 侧跑**真实的 render-backend 批量桥**
//
// 【与 S3 手写等价 JS 的差别（为什么还要做 S3b）】
//   S3 用**手写的等价 JS** 验证了「QuickJS → JNI → 宿主回调」这条**链路**是通的；
//   但那是**我手写的 20 行脚本**，不是仓库里真正会被产品使用的代码。
//   ⇒ 本 bundle 打进的是 **`createSelfDrawBatchAdapter` + `createNativeBackend` 的真实 dist 产物**
//     （与 iOS 链路同一份 TS 源）⇒ 证明的是「**真实适配器能在 Android 的 QuickJS 上跑**」。
//
// 【镜像 iOS 的形态】iOS 是 `entry-selfdraw.ts`（Vue → 自绘适配器 → proteusSelfDraw）；
//   Android 本 bundle 走**更薄的一条**：不接 Vue（Vue 运行时的端上链路在 iOS 已验，
//   且 Android 侧 JS 引擎刚落地，先验"适配器本身"），只验：
//     createNativeBackend（真实 SPI 实现）→ createSelfDrawBatchAdapter（真实批量桥）
//     → commit(ops) → 宿主桥（三次入口 mount/update/updatePatches）→ `proteusHost.post`
//
// 【宿主桥在这条链路里的角色】Android 宿主是 Java + Rust（无原生渲染入口），
//   故 `SelfDrawHostBridge` 的实现在**测试期**就是"把收到的 JSON 上报给 Java"
//   （与 S3 的手写版同一契约）。真实渲染（Java 侧消费批次）属后续（C1 的真机三项复测）。
//
// 【产物】`hosts/android/bridge/dist/bundle-batch.js`（IIFE；由 build-batch.mjs 生成）
// 【调用】Java 侧：eval(bundle) 定义 `globalThis.__proteusBatchRun`，再 eval 调用它
import {
  createNativeBackend,
  createSelfDrawBatchAdapter,
} from '@proteus-vue/render-backend'
import type { SelfDrawHostBridge } from '@proteus-vue/render-backend'

/** Android 侧的宿主桥：把批次上报给 Java（`proteusHost.post`，见 quickjs_jni.c） */
interface PostHost {
  post(json: string): void
}

/**
 * ★★S5：**实现了三个渲染入口**的宿主（Java 侧 `JsRenderHost`）。
 *
 * 【与 `PostHost` 的关键差别】`post` 只是"上报"（S3b 用它证明「适配器 → 宿主入口」这段真实）；
 *   本接口是**真消费**：宿主收到批次后走「Rust 排版核心算几何 → 自绘」——端上真的会画。
 *   ⇒ JS 侧据此判定走哪条路（见 `pickHost`）。
 */
interface RenderHost {
  mount(treeJson: string): string
  update(treeJson: string): string
  updatePatches(patchesJson: string): string
}

declare const proteusHost: (PostHost & Partial<RenderHost>) | undefined

/** 取全局 `proteusHost`（无宿主环境为 null） */
function globalHost(): (PostHost & Partial<RenderHost>) | null {
  if (typeof proteusHost === 'undefined' || proteusHost === undefined) return null
  return proteusHost
}

/**
 * 选宿主：Java 侧实现了 `mount`/`update`/`updatePatches` ⇒ 走**真机消费**；否则退化到本地桩。
 *
 * ★为什么必须探测而不是假定（本仓纪律：读数名与含义必须一致）：
 *   两条路径的结论完全不同——
 *     · `host_mode === 'java'` ⇒ 批次被宿主**消费并渲染**（S5 要证明的事）；
 *     · `host_mode === 'stub'` ⇒ 只证明「适配器 → 宿主入口」被调用（S3b 的结论）。
 *   报告里带 `host_mode`，判据脚本据此断言，**不允许把 stub 的绿当成渲染的绿**。
 */
function pickHost(): { host: SelfDrawHostBridge; mode: 'java' | 'stub'; stub: StubStats | null } {
  const ph = globalHost()
  if (ph && typeof ph.mount === 'function' && typeof ph.update === 'function' && typeof ph.updatePatches === 'function') {
    const real = ph as PostHost & RenderHost
    return {
      mode: 'java',
      stub: null,
      host: {
        mount: (t) => real.mount(t),
        update: (t) => real.update(t),
        updatePatches: (p) => real.updatePatches(p),
      },
    }
  }
  const stub = createStubHost()
  return { mode: 'stub', host: stub.host, stub }
}

/** 上报（无 `proteusHost` 时退化为全局数组——便于桌面/无宿主环境调试） */
function report(payload: unknown): void {
  const json = JSON.stringify(payload)
  if (typeof proteusHost !== 'undefined' && proteusHost !== undefined && typeof proteusHost.post === 'function') {
    proteusHost.post(json)
  } else {
    const g = globalThis as unknown as { __proteusReports?: string[] }
    g.__proteusReports = g.__proteusReports ?? []
    g.__proteusReports.push(json)
  }
}

/**
 * S3b 主入口：用**真实适配器**跑一次完整的最小闭环，返回判据读数。
 *
 * 判据（供 Java 侧断言）：
 *   · mountCalls / updateCalls / patchCalls —— 三次入口各调了几次（首帧 mount；结构变化 update；
 *     纯样式 updatePatches）
 *   · hostCalls —— ★批处理红线读数：应等于 commit 次数（不随节点/操作数增长）
 *   · mountedNodes —— mount 时批次的节点数（应等于我们建的结构规模）
 *   · patchStyle —— 最后一次 updatePatches 的内容（应含我们改的键值）
 */
export function __proteusBatchRun(): string {
  // ★两个**分开**的读数（首版把它们写成同一个字段 ⇒ update 覆盖了 mount 的值，
  //   导致 mountNodes 报的是"最后一次整树重发的节点数"、名字与含义不符——
  //   本仓纪律：读数名与含义必须一致，否则读的人会误判）
  const stub = createStubHost()
  const { counts, seen, host } = stub

  // ★真实适配器（render-backend dist）+ 真实 SPI 后端
  const adapter = createSelfDrawBatchAdapter(host, { viewport: { width: 390, height: 844 } })
  const backend = createNativeBackend(adapter, 'android')

  // ① 建一棵小树：view > (view > text) + text（4 节点，含两处文本）
  const root = backend.createElement({ type: 'view', props: { backgroundColor: '#101020' }, children: [] })
  const inner = backend.createElement({ type: 'view', props: {}, children: [] })
  backend.insert(inner, root)
  const t1 = backend.createText('Hello from real adapter')
  backend.insert(t1, inner)
  const t2 = backend.createText('second')
  backend.insert(t2, root)
  backend.flush() // ← 首帧 ⇒ mount（一次跨边界调用）

  const afterMount = { ...counts }

  // ② 纯样式改动 ⇒ 第二次 flush 应走 updatePatches（不重发整树）
  backend.patchProp(inner, 'backgroundColor', null, '#ff0000')
  backend.patchProp(inner, 'borderRadius', null, 8)
  backend.flush()

  const afterPatch = { ...counts }

  // ③ 结构改动（插一个新文本）⇒ 应走 update（整树重发）
  const t3 = backend.createText('third')
  backend.insert(t3, root)
  backend.flush()

  const result = {
    ok: true,
    phase1_mount: afterMount.mount === 1 && afterMount.update === 0 && afterMount.updatePatches === 0,
    phase2_updates: afterPatch.updatePatches === 1 && afterPatch.update === 0,
    phase3_update: counts.update === 1,
    mountedNodes: seen.mountNodes,
    updatedNodes: seen.updateNodes,
    lastPatch: seen.lastPatch,
    counts,
    hostCalls: adapter.hostCalls(),
    lastCallKind: adapter.lastCallKind(),
    nodeSpecs: adapter.nodeSpecs().length,
  }
  report({ from: 'real-adapter', ...result })
  return JSON.stringify(result)
}

/** 桩宿主的计数器（`__proteusBatchRun` 的判据来自它） */
interface StubStats {
  counts: { mount: number; update: number; updatePatches: number }
  seen: { mountNodes: number; updateNodes: number; lastPatch: unknown }
}

/**
 * 本地桩宿主（**不消费批次**，只统计/记录）——用于 `host_mode === 'stub'` 路径：
 * 证明「适配器 → 宿主入口」这段真实，但**不**声称端上已渲染（见 `pickHost` 的说明）。
 */
function createStubHost(): StubStats & { host: SelfDrawHostBridge } {
  const counts = { mount: 0, update: 0, updatePatches: 0 }
  const seen: StubStats['seen'] = { mountNodes: -1, updateNodes: -1, lastPatch: null }
  const host: SelfDrawHostBridge = {
    mount(treeJson: string): string {
      counts.mount++
      const t = JSON.parse(treeJson) as { nodes?: unknown[] }
      seen.mountNodes = Array.isArray(t.nodes) ? t.nodes.length : -1
      return '{"ok":true}'
    },
    update(treeJson: string): string {
      counts.update++
      const t = JSON.parse(treeJson) as { nodes?: unknown[] }
      seen.updateNodes = Array.isArray(t.nodes) ? t.nodes.length : -1
      return '{"ok":true}'
    },
    updatePatches(patchesJson: string): string {
      counts.updatePatches++
      seen.lastPatch = JSON.parse(patchesJson)
      return '{"ok":true}'
    },
  }
  return { counts, seen, host }
}

/** 语义树节点（`__proteusRenderRun` 的输入形态——由 Java 侧或本文件内的场景生成器产出） */
interface SceneNode {
  id: number
  parentId: number | null
  /** IR 风格的样式桶（适配器把整桶透传给宿主） */
  props: Record<string, unknown>
  text?: string
}

/**
 * ★★把**核心请求风格**的扁平节点表（`{id, parentId, width, height, backgroundColor, …}`）
 * 归一成**IR 风格**（`{id, parentId, props:{…}, text}`）。
 *
 * 【为什么必须做（本仓实测踩到的静默丢数据）】`app-4050-tree.json` 是**核心请求**的形态
 *   ——样式键**平铺在节点上**（那是 Rust `NodeDto` 的形状）；
 *   而 `createElement({props})` 期待的是 IR 形状（样式装在 `props` 桶里）。
 *   初版直接把扁平节点当 IR 用 ⇒ `props` 恒 undefined ⇒ **整棵树的样式全部丢失**，
 *   而"节点数"读数照样是 4051（**部分读数掩盖了整块数据丢失**）。
 *   ⇒ 显式归一（扁平 → props 桶），并把 `text` 留在节点外层（它是内容，不是样式）。
 */
function flattenCoreNodes(raw: Array<Record<string, unknown>>): SceneNode[] {
  return raw.map((n) => {
    const { id, parentId, text, ...style } = n as { id: number; parentId: number | null; text?: string } & Record<string, unknown>
    return {
      id,
      parentId: parentId ?? null,
      props: style,
      text: typeof text === 'string' && text.length > 0 ? text : undefined,
    }
  })
}

/** `__proteusRenderRun` 的入参 */
interface RenderArgs {
  scene: string
  rows?: number
  viewport: { width: number; height: number }
  /** 4050 场景的节点表 JSON（`{nodes:[...], spec:{...}}`；Java 侧从 assets 读出传进来） */
  treeJson?: string
  /** ★稳态逐帧的帧数（>0 时跑相位③；卡 C2「宿主侧耗时 1ms 量级」的判据载体） */
  frames?: number
}

/**
 * ★★S5 主入口：**端上真正会画**的那条链路（JS 产语义树 → 真实适配器 → 宿主消费批次渲染）。
 *
 * 【与 `__proteusBatchRun`（S3b）的差别】
 *   S3b 的宿主是本地桩（只证明调用发生）；本入口要求宿主**实现了三个渲染入口**，
 *   批次会被真正消费（Java `JsRenderHost` → Rust 核心算几何 → 自绘）。
 *
 * 【两个相位（判据都在报告里）】
 *   ① 建树 + 一次 `flush` ⇒ `mount`（★批处理红线：**N 个节点仍只 1 次跨边界调用**）
 *   ② 改一行文本 + 一次 `flush` ⇒ `updatePatches`（★长列表增量：**不重发整树**）
 *
 * 【★为什么"建树"这一步也由 JS 做】真机自绘路径的分工是
 *   「JS 产语义树（不含几何）→ 宿主注入度量 + 调核心算几何」（见 ios/selfdraw-scene.swift 的分工表）。
 *   本入口遵守同一分工：JS **不**算任何几何，也不传坐标——几何只由宿主侧的核心产出。
 */
export function __proteusRenderRun(argsJson: string): string {
  const args = JSON.parse(argsJson) as RenderArgs
  const picked = pickHost()

  const t0 = Date.now()
  const adapter = createSelfDrawBatchAdapter(picked.host, { viewport: args.viewport })
  const backend = createNativeBackend(adapter, 'android')

  // ── 场景：节点表（parent 先于 child——单趟即可挂树，保证确定性）──
  let nodes: SceneNode[]
  if (args.treeJson) {
    const fixture = JSON.parse(args.treeJson) as { nodes: Array<Record<string, unknown>> }
    // ★夹具是**核心请求**形态（样式平铺）⇒ 必须归一成 IR 形态（见 flattenCoreNodes 的实测记录）
    nodes = flattenCoreNodes(fixture.nodes)
  } else if (args.scene === 'list') {
    nodes = buildListScene(args.rows ?? 4000, args.viewport.width)
  } else {
    nodes = buildListScene(50, args.viewport.width)
  }

  const handles = new Map<number, unknown>()
  let textNodes = 0
  for (const n of nodes) {
    let h: unknown
    const hasText = typeof n.text === 'string' && n.text.length > 0
    // ★★为什么**统一走 createElement 再 setText**（而不是 `createText(text)`）——
    //   `createText` 的 descriptor **props 恒为 `{}`**（见 native.ts 的实现），
    //   而 4050 夹具的文本节点自带 `backgroundColor`（那个格子的底色）⇒ 用它会丢底色。
    //   ⇒ 逐节点携带 props + 用 setText 补文本（SPI 的文本语义仍由 setText 表达）。
    h = backend.createElement({ type: hasText ? 'text' : 'view', props: n.props, children: [] })
    if (hasText) {
      backend.setText(h, n.text as string)
      textNodes++
    }
    handles.set(n.id, h)
    if (n.parentId !== null) {
      const p = handles.get(n.parentId)
      if (p !== undefined) backend.insert(h, p)
    }
  }
  const buildMs = Date.now() - t0

  // ── 相位 ①：一次 flush ⇒ 宿主 mount（真实渲染）──
  const tMount = Date.now()
  backend.flush()
  const mountMs = Date.now() - tMount
  const afterMount = adapter.hostCalls()
  const mountKind = adapter.lastCallKind()

  // ── 相位 ②：改一行文本 ⇒ updatePatches（不重发整树）──
  const textNode = nodes.find((n) => typeof n.text === 'string' && n.text.length > 0)
  let patchMs = -1
  let patchedId = -1
  if (textNode) {
    const h = handles.get(textNode.id)
    if (h !== undefined) {
      backend.setText(h, 'updated-by-js')
      const tPatch = Date.now()
      backend.flush()
      patchMs = Date.now() - tPatch
      patchedId = textNode.id
    }
  }
  const afterPatch = adapter.hostCalls()

  // ── 相位 ③：**稳态逐帧**（卡 C2「宿主侧耗时仍为 1ms 量级」的判据载体）──
  //
  // 【为什么需要这一段（判据要的是分布，不是单点）】卡 C2 原判据写的是"宿主侧耗时 1ms 量级"——
  //   单点读数无法区分"稳定 1ms"与"偶尔 40ms + 其余 0.1ms"。
  //   ⇒ 用与真实使用相同的形态打 N 帧**纯样式增量**（每帧改一行文本 ⇒ 走 updatePatches 增量路径），
  //     每帧的宿主耗时由 Java 侧记录（`JsRenderHost.hostCallMs`），出 p50/p95/max 分布。
  //   ★为什么用"改一行文本"当负载：那是列表滚动/计数的真实形态（局部更新），
  //     也正是"跨边界调用=帧数"红线所约束的负载。
  const frameEdits = args.frames ?? 0
  let framesRun = 0
  if (frameEdits > 0 && textNode) {
    const textHandles = nodes.filter((n) => typeof n.text === 'string' && n.text.length > 0)
    for (let i = 0; i < frameEdits; i++) {
      const target = textHandles[i % textHandles.length]
      if (!target) break
      const h = handles.get(target.id)
      if (h === undefined) continue
      backend.setText(h, `frame ${i}`)
      backend.flush()   // ← 一帧一次跨边界调用
      framesRun++
    }
  }
  const afterFrames = adapter.hostCalls()

  // ★期望绘制指令数（**两侧对"该画什么"的理解是否一致**的独立判据）：
  //   有背景色 或 有文本 ⇒ 有绘制内容（与宿主 `emitCmds` 的同一规则，各自独立算）
  //   若 props 在适配器里丢了，本数与宿主侧的 `host_cmds` 会**不一致**——
  //   这正是本仓实测踩到的形态（初版用 createText ⇒ props 全丢 ⇒ 宿主只剩 1 条指令，
  //   而"节点数"读数照样 4051 ⇒ **部分读数掩盖了整块丢失**）。
  const expectCmds = nodes.filter((n) => {
    const bg = n.props?.backgroundColor
    return (typeof bg === 'string' && bg.length > 0) || (typeof n.text === 'string' && n.text.length > 0)
  }).length

  const result = {
    ok: true,
    scene: args.scene,
    host_mode: picked.mode,
    nodes: nodes.length,
    text_nodes: textNodes,
    expect_cmds: expectCmds,
    build_ms: buildMs,
    mount_ms: mountMs,
    patch_ms: patchMs,
    mount_call_kind: mountKind,
    patch_call_kind: adapter.lastCallKind(),
    host_calls: afterFrames,
    mount_calls: afterMount,
    patch_calls: afterPatch - afterMount,
    // ★稳态逐帧读数（判据：帧数 = 跨边界调用数，且每帧宿主耗时 1ms 量级）
    frames_run: framesRun,
    steady_calls: afterFrames - afterPatch,
    mount_nodes: adapter.nodeSpecs().length,
    patched_id: patchedId,
    total_ms: Date.now() - t0,
  }
  report({ from: 'render-run', ...result })
  return JSON.stringify(result)
}

/** 长列表场景（`rows` 行 × 1 单元格 + 1 文本 + 根 = 2×rows+1 个节点） */
function buildListScene(rows: number, width: number): SceneNode[] {
  const out: SceneNode[] = [{ id: 0, parentId: null, props: { flexDirection: 'column', width } }]
  for (let i = 0; i < rows; i++) {
    const rowId = 1 + i * 2
    out.push({
      id: rowId,
      parentId: 0,
      props: { flexDirection: 'row', height: 18, flexShrink: 0, margin: { bottom: 1 } },
    })
    out.push({
      id: rowId + 1,
      parentId: rowId,
      props: { fontSize: 8, color: '#ffffff', backgroundColor: '#285ac8' },
      text: `row ${i}`,
    })
  }
  return out
}

// ★挂到全局，供 Java 侧直接 eval 调用（IIFE 无模块系统）
;(globalThis as unknown as { __proteusBatchRun: typeof __proteusBatchRun }).__proteusBatchRun = __proteusBatchRun
;(globalThis as unknown as { __proteusRenderRun: typeof __proteusRenderRun }).__proteusRenderRun = __proteusRenderRun
