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

/** Android 侧的宿主桥：把批次上报给 Java（`proteusHost.post`，见 quickjs_jni.c） */
interface PostHost {
  post(json: string): void
}

declare const proteusHost: PostHost | undefined

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
  const counts = { mount: 0, update: 0, updatePatches: 0 }
  // ★两个**分开**的读数（首版把它们写成同一个字段 ⇒ update 覆盖了 mount 的值，
  //   导致 mountNodes 报的是"最后一次整树重发的节点数"、名字与含义不符——
  //   本仓纪律：读数名与含义必须一致，否则读的人会误判）
  const seen: { mountNodes: number; updateNodes: number; lastPatch: unknown } = {
    mountNodes: -1,
    updateNodes: -1,
    lastPatch: null,
  }

  const host = {
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

// ★挂到全局，供 Java 侧直接 eval 调用（IIFE 无模块系统）
;(globalThis as unknown as { __proteusBatchRun: typeof __proteusBatchRun }).__proteusBatchRun = __proteusBatchRun
