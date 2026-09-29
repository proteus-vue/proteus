// packages/render-backend/src/selfdraw-batch.ts
// ★★C1：**selfdraw 批量宿主桥** —— 把真机的批量协议接进 SPI（`NativeBatchAdapter` 的生产实现）
//
// 【为什么需要（卡 C1 的实质：把已有真机链路接进 SPI）】
//   I6 评估查明 App 端有两条路径：
//     · SPI 层 `render-backend/native.ts` —— 接口形态（此前缺省 mock 适配器）
//     · 真机链路 `renderer-app/adapters/selfdraw.ts` + 宿主 `mount/updatePatches/applyOps`
//   两者未在代码上统一。本文件补的就是这条**桥**：让 SPI 的批量语义（`commit(ops)`）
//   落到真机宿主的**一次**调用上。
//
// 【真机协议（宿主侧实测形态，见 hosts/ios/ProteusHost/selfdraw-scene.swift）】
//   · `mount(treeJson)`        —— 首帧建树（入参 `{viewport, nodes:[spec]}`）
//   · `update(treeJson)`       —— 结构变化时整树重发（宿主重建/增量应用）
//   · `updatePatches(patches)` —— 纯样式/文本变化（入参 `[{id, style:{…}}]`）
//   ★三者**每次都是一次跨边界调用** ⇒ 这正是 Host ABI §3「跨边界调用 = 帧数」的落点。
//
// 【本桥的判据（批处理红线的机器化）】`hostCalls() === commit 次数`
//   —— 与批次内**操作条数无关**（100 条 op 的批次仍只 1 次调用）。
//
// 【诚实边界（本文件不做什么）】
//   ① **props 归一化不在本层**：SPI 的 props 是 IR/Vue 形态（`'56px'` / `{kind:'absolute',dp:42}`），
//      而宿主 spec 期望数值字段——归一化由 renderer-app 的既有实现负责
//      （`foldLength`/`paintOf`/`normalizeFontWeight`…）。
//      ⇒ 本桥提供 `normalizeProps` **注入钩子**（缺省原样透传），**不复制**那份归一化
//      （复制 = 第 N 份手写副本，必漂移——本仓纪律）。
//   ② **不做 diff 决策**：结构变化 → 整树 `update`（与真机既有自绘路径同策略：
//      宿主侧 `takePatches() === null` 时同样整树重发）。行级增量属 Vapor 槽位路径（另一条）。
//   ③ **不实现 `applyOps`**（二进制指令流）：那是 Vapor 增量通道，与「全量语义树渲染」不同族
//      —— 两者可以在同一宿主上共存（宿主两个入口都有），但语义不混用。
import type { NativeBatchAdapter, NativeHostOp } from './native'

/** 真机宿主桥（iOS/Android/鸿蒙 同形——三端宿主都实现这三个入口） */
export interface SelfDrawHostBridge {
  /** 首帧建树：`{viewport:{width,height}, nodes:[spec]}` */
  mount(treeJson: string): string
  /** 结构变化：整树重发 */
  update(treeJson: string): string
  /** 样式/文本增量：`[{id, style:{…}}]`（宿主同通道处理 text——`style:{text}`） */
  updatePatches(patchesJson: string): string
}

/** 本桥的诊断面（判据/可观测性——不含在 SPI 契约里） */
export interface SelfDrawBatchAdapter extends NativeBatchAdapter {
  /** 已发生的**宿主调用次数**（★批处理红线判据：应恒等于 commit 次数） */
  hostCalls(): number
  /** 最近一次走的是哪个宿主入口（诊断：mount / update / updatePatches） */
  lastCallKind(): 'mount' | 'update' | 'updatePatches' | null
  /** 镜像树的节点表（判据用：节点数 / 树形 / 文本） */
  nodeSpecs(): Array<Record<string, unknown>>
}

export interface SelfDrawBatchOptions {
  viewport: { width: number; height: number }
  /**
   * props 归一化钩子（IR props → 宿主 spec 字段）。
   *
   * ★缺省 = **原样透传**（宿主自行解释；测试/简单宿主够用）。
   * ★真机接线建议传入 renderer-app 的既有归一化（`paintOf` 等），
   *   而**不要**在本文件里再写一份——复制必然漂移（本仓纪律 #22）。
   */
  normalizeProps?: (props: Record<string, unknown>) => Record<string, unknown>
}

/** 镜像节点（本桥只用于**结构判定与树形产出**，不持有句柄） */
interface MirrorNode {
  id: number
  type: string
  props: Record<string, unknown>
  text?: string
  parentId: number | null
  children: number[]
}

/**
 * 创建 selfdraw 批量宿主适配器。
 *
 * 用法（真机接线）：
 * ```ts
 * const backend = createNativeBackend(
 *   createSelfDrawBatchAdapter(proteusSelfDraw, { viewport: { width: 390, height: 844 } }),
 *   'ios',
 * )
 * // …正常走 SPI nodeOps…
 * backend.flush()   // ← 一次 flush = 一次宿主调用
 * ```
 */
export function createSelfDrawBatchAdapter(
  host: SelfDrawHostBridge,
  opts: SelfDrawBatchOptions,
): SelfDrawBatchAdapter {
  /** 镜像树：id → 节点（结构判定 + 产出 spec 用） */
  const mirror = new Map<number, MirrorNode>()
  /** 插入顺序（roots 的产出顺序——保证确定性，与真机自绘适配器的遍历顺序同源） */
  const rootOrder: number[] = []
  let calls = 0
  let lastKind: 'mount' | 'update' | 'updatePatches' | null = null
  let mounted = false

  const normalize = opts.normalizeProps ?? ((p: Record<string, unknown>) => p)

  /** 删除节点及其全部后代（镜像一致性——宿主侧同样是整子树移除） */
  function removeSubtree(id: number): void {
    const n = mirror.get(id)
    if (!n) return
    for (const c of n.children) removeSubtree(c)
    mirror.delete(id)
    const at = rootOrder.indexOf(id)
    if (at >= 0) rootOrder.splice(at, 1)
  }

  /** 深度优先产出 spec 列表（roots 按插入顺序） */
  function specs(): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = []
    const visit = (id: number): void => {
      const n = mirror.get(id)
      if (!n) return
      const spec: Record<string, unknown> = { id: n.id, parentId: n.parentId, ...normalize(n.props) }
      if (n.text !== undefined) spec.text = n.text
      out.push(spec)
      for (const c of n.children) visit(c)
    }
    for (const r of rootOrder) visit(r)
    return out
  }

  return {
    commit(ops: readonly NativeHostOp[]): void {
      let structural = false
      /** 本批次的样式/文本补丁（id → style；同节点多条 op 合并——这正是"批量"的语义） */
      const patched = new Map<number, Record<string, unknown>>()
      const patch = (id: number, key: string, value: unknown): void => {
        const s = patched.get(id) ?? {}
        if (value === null || value === undefined) delete s[key]
        else s[key] = value
        patched.set(id, s)
      }

      for (const op of ops) {
        switch (op.op) {
          case 'create': {
            mirror.set(op.id, {
              id: op.id,
              type: op.type,
              props: { ...op.props },
              parentId: null,
              children: [],
            })
            rootOrder.push(op.id)
            structural = true
            break
          }
          case 'insert': {
            const n = mirror.get(op.id)
            if (!n) break
            // 先摘（与 nodeOps 语义一致：insert 到新父前先离开旧父）
            if (n.parentId !== null) {
              const old = mirror.get(n.parentId)
              if (old) {
                const i = old.children.indexOf(n.id)
                if (i >= 0) old.children.splice(i, 1)
              }
            } else {
              const i = rootOrder.indexOf(n.id)
              if (i >= 0) rootOrder.splice(i, 1)
            }
            n.parentId = op.parentId
            if (op.parentId === null) {
              rootOrder.push(n.id)
            } else {
              const p = mirror.get(op.parentId)
              if (p) {
                const at = op.anchorId === undefined ? -1 : p.children.indexOf(op.anchorId)
                if (at >= 0) p.children.splice(at, 0, n.id)
                else p.children.push(n.id)
              }
            }
            structural = true
            break
          }
          case 'remove': {
            removeSubtree(op.id)
            structural = true
            break
          }
          case 'patch': {
            const n = mirror.get(op.id)
            if (!n) break
            if (op.next === null || op.next === undefined) delete n.props[op.key]
            else n.props[op.key] = op.next
            patch(op.id, op.key, op.next)
            break
          }
          case 'text': {
            const n = mirror.get(op.id)
            if (!n) break
            n.text = op.text
            // ★文本走**样式同通道**（宿主 `updatePatches` 支持 `{id, style:{text}}`——
            //   见 selfdraw-scene.swift 的 patch 解析：`style` 里带 `text` 时重度量并注入）
            patch(op.id, 'text', op.text)
            break
          }
        }
      }

      // ── 一次批次 = 一次宿主调用（★批处理红线的落点） ──
      if (!mounted) {
        host.mount(JSON.stringify({ viewport: opts.viewport, nodes: specs() }))
        mounted = true
        lastKind = 'mount'
      } else if (structural) {
        host.update(JSON.stringify({ viewport: opts.viewport, nodes: specs() }))
        lastKind = 'update'
      } else {
        // 纯样式/文本：`[{id, style}]`（与宿主 updatePatches 的入参形状一致）
        const arr = [...patched.entries()].map(([id, style]) => ({ id, style }))
        host.updatePatches(JSON.stringify(arr))
        lastKind = 'updatePatches'
      }
      calls++
    },

    hostCalls(): number {
      return calls
    },
    lastCallKind(): 'mount' | 'update' | 'updatePatches' | null {
      return lastKind
    },
    nodeSpecs(): Array<Record<string, unknown>> {
      return specs()
    },
    commitCount(): number {
      return calls
    },
  }
}
