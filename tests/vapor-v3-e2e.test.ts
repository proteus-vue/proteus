// tests/vapor-v3-e2e.test.ts
// ★★Vapor for Proteus IR · V3 **端到端**：SFC → 订阅表 → 槽位直写 → 二进制指令 → Rust 应用 → 几何
//
// 【为什么必须有这一层（前面测的都是"半条链"）】
//   v1 测了指令编解码、v2 测了编译期产物、v3 测了运行时直写——但**没有一层**把
//   「TS 产出的字节流」交给「Rust 的布局应用」跑一遍并检查几何。
//   若缺这一层，"指令能生成"与"指令能改对树"之间的接口完全没被验证过。
//
// 【本文件的判据是**几何**（而不是"没报错"）】——与 V0 探针同款纪律：
//   改宽度后节点的实际矩形必须变，且**未受影响的兄弟保持不变**。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildVaporSubscriptions } from '@proteus-vue/compiler'
import { OpCode, PropKeyTable, StringPool, SlotRuntime, VaporRuntime, encodeOps } from '@proteus-vue/slot-runtime'
import type { EvalContext, SubscriptionTable } from '@proteus-vue/slot-runtime'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CRATE = path.join(ROOT, 'packages/layout-core-rust')

/**
 * 调 Rust 侧做一个完整回合：建树 → 应用指令流 → 读回矩形
 *
 * ★为什么用 `cargo run --example`（而不是 napi/ffi 绑定）：
 *   本测试要验证的是**核心逻辑**（指令 → 树 → 几何），不是 FFI 编组。
 *   反过来，FFI 编组已有 ffi.rs 的单元测试覆盖（含空指针/垃圾流）。
 *   两条路径合起来才是完整覆盖，且都**无需真机**（毫秒级、可在 CI 跑）。
 */
function rustRoundTrip(treeJson: string, opsBytes: Uint8Array): { rects: Record<string, { x: number; y: number; width: number; height: number }>; applied: number; relayout: number; scopes: number[] } {
  const binPath = path.join(CRATE, 'target', 'debug', 'examples', 'ops_roundtrip')
  const opsPath = path.join(ROOT, 'tests', '.tmp-ops.bin')
  const treePath = path.join(ROOT, 'tests', '.tmp-tree.json')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('node:fs').writeFileSync(opsPath, opsBytes)
  require('node:fs').writeFileSync(treePath, treeJson)
  // ★缺二进制时给**可操作的错误**，而不是裸 `ENOENT`（2026-09-29 实测：CI 上 pnpm test 跑在
  //   构建该 example **之前** ⇒ 四条用例报 `spawnSync ... ops_roundtrip ENOENT`，
  //   看起来像"端到端链路坏了"，实际只是**装置没建**。装置缺失必须报装置缺失。）
  if (!fs.existsSync(binPath)) {
    throw new Error(
      `V3 端到端装置缺失：${binPath}\n` +
        '  ⇒ 先构建：cargo build --manifest-path packages/layout-core-rust/Cargo.toml --example ops_roundtrip\n' +
        '  （CI：该构建步必须排在 `pnpm test` **之前**——见 .github/workflows/ci.yml）',
    )
  }
  const out = execFileSync(binPath, [treePath, opsPath], { encoding: 'utf-8', cwd: CRATE })
  return JSON.parse(out)
}

describe('V3 · 端到端：TS 指令 → Rust 应用 → 几何变化', () => {
  it('★★SFC 的 :width 绑定 → 一条指令 → Rust 侧几何真的变了', () => {
    // ① SFC：一个 300×200 的根 + 行 + 圆点（圆点宽度绑到 ref）
    //
    // ★必须用 `:width` 而不是 `:style`（本仓实测踩到，很有代表性）：
    //   `:style="dotWidth"` 的 propKey 归一为 **`paint.style`** —— 对布局核心而言
    //   它是**不透明的样式绑定**（不知道里面是 width 还是 color）⇒ 正确地按「仅绘制」处理
    //   （不重排）。要测几何变化就必须用**明确的布局属性绑定**（`:width` → `layout.width`）。
    //   这也解释了为什么编译器要把 `:width` 与 `:style` 分成不同的 propKey。
    // ★模板与树必须**逐元素对齐**（本仓实测踩到）：
    //   nodeId 取「元素在模板序 DFS 中的序号」，故 SFC 里元素的**个数与顺序**
    //   必须与建树时的一致——否则指令会写到另一个节点上（且不报错）。
    //   这里：root=0 · row=1 · dot=2（绑定在 dot 上）。
    const sfc = `<template>
  <p-view>
    <p-view>
      <p-view :width="dotWidth" />
    </p-view>
  </p-view>
</template>

<script setup lang="ts">
const dotWidth = ref(20)
</script>
`
    const { table } = buildVaporSubscriptions(sfc, 'e2e.vue')
    expect(table.stats.l1).toBeGreaterThan(0)

    // ② 建树（与编译产物同构：id 按模板出现顺序——根=0，行=1，圆点=2）
    const treeJson = JSON.stringify({
      viewport: { width: 300, height: 200 },
      // ★字段是**扁平**的（`NodeDto` 的 `width`/`height` 在节点上，不在 `style` 里）——
      //   本测试首版按自绘适配器的 `SelfDrawNodeSpec` 形状写了嵌套 `style`，
      //   结果所有尺寸被**静默忽略**（未知字段），几何全为 0。
      //   ⇒ 这正是端到端层存在的意义：编译/运行时两侧都绿，接口对不上照样是错的。
      nodes: [
        { id: 0, parentId: null, flexDirection: 'column', width: 300, height: 200 },
        { id: 1, parentId: 0, flexDirection: 'row', height: 100 },
        { id: 2, parentId: 1, width: 20, height: 20 },
      ], // ★与上面 SFC 的元素序一一对应（root=0 / row=1 / dot=2）
    })

    // ③ 运行时：源值 → 槽位 → 指令
    const keys = new PropKeyTable()
    const strings = new StringPool()
    const captured: Uint8Array[] = []
    const rt = new SlotRuntime(keys, strings, (bytes) => captured.push(bytes))
    let dotWidth = 20
    const ctx: EvalContext = { read: (n) => (n === 'dotWidth' ? dotWidth : undefined) }
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators))
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (name, cb) => triggers.set(name, cb))
    vapor.relink(ctx)
    rt.flush()
    captured.length = 0 // 丢掉首帧

    // ④ 改圆点宽度 → 订阅触发 → 直写槽位 → 一条指令
    dotWidth = 80
    triggers.get('dotWidth')!()
    rt.flush()
    expect(captured.length).toBe(1) // ★只提交一次
    const bytes = captured[0]

    // ⑤ 交给 Rust 应用
    const res = rustRoundTrip(treeJson, bytes)
    expect(res.applied).toBeGreaterThan(0)
    // ★几何判据：**第 2 号节点**（= 模板里那个绑定元素）的宽度确实变成 80
    expect(res.rects['2'].width).toBeCloseTo(80, 1)
    // ★未受影响的祖先保持原尺寸（增量正确性）
    expect(res.rects['0'].width).toBeCloseTo(300, 1)
    expect(res.rects['0'].height).toBeCloseTo(200, 1)
  })

  it('★★批量指令（两个节点同时改）→ Rust 侧**多范围**重排，几何都对', () => {
    const treeJson = JSON.stringify({
      viewport: { width: 300, height: 300 },
      // ★行必须**显式宽高**才是布局边界（本仓实测：只给高度时宽度依赖内容
      //   ⇒ 不满足「对外尺寸与内容无关」⇒ 范围正确收敛到根，多范围退化为单范围）
      nodes: [
        { id: 0, parentId: null, flexDirection: 'column', width: 300, height: 300 },
        { id: 1, parentId: 0, flexDirection: 'row', width: 300, height: 60, flexShrink: 0 },
        { id: 2, parentId: 1, width: 20, height: 20 },
        { id: 3, parentId: 0, flexDirection: 'row', width: 300, height: 60, flexShrink: 0 },
        { id: 4, parentId: 3, width: 20, height: 20 },
      ],
    })
    // 手工构造两条 SET_STYLE（模拟"两个槽位同帧变化"）
    const keys = new PropKeyTable()
    const strings = new StringPool()
    const keyId = keys.intern('layout.width')
    const bytes = encodeOps(
      [
        { op: OpCode.SET_STYLE, nodeId: 2, keyId, value: 70 },
        { op: OpCode.SET_STYLE, nodeId: 4, keyId, value: 90 },
      ],
      keys,
      strings,
    )
    const res = rustRoundTrip(treeJson, bytes)
    expect(res.applied).toBe(2)
    // ★多范围：两个圆点各在有**显式宽高**的行下（那些行是布局边界）⇒ ≥2 个范围
    expect(res.scopes.length).toBeGreaterThanOrEqual(2)
    expect(res.rects['2'].width).toBeCloseTo(70, 1)
    expect(res.rects['4'].width).toBeCloseTo(90, 1)
  })

  it('★★nodeId 必须等于元素在模板中的序号（本仓实测的真缺陷：首版错位到根节点）', () => {
    // 三层嵌套，绑定在**最内层**（第 3 个元素）——若 nodeId 用"绑定序号"，会得到 0（根）
    const sfc = `<template>
  <p-view>
    <p-view>
      <p-view :width="w" />
    </p-view>
  </p-view>
</template>

<script setup lang="ts">
const w = ref(1)
</script>
`
    const { table } = buildVaporSubscriptions(sfc, 'a.vue')
    const slot = table.sources[0].slots[0]
    // ★模板序 DFS：0=最外层 p-view · 1=中间 · 2=最内层（绑定所在）
    expect(slot.nodeId).toBe(2)
  })

  it('★★非零偏移的中间节点：绝对坐标不得被叠加两次（本仓实测的潜伏缺陷）', () => {
    // 【为什么单列这条用例（本仓实测的教训）】
    //   `layout_incremental` 的回写公式一度是 `origin + r`——而 taffy 的 `r` **已相对范围根**
    //   ⇒ 范围自身位置被叠加两次。**该缺陷从 M1 起存活很久**，因为：
    //     · 范围 == 树根 ⇒ origin=(0,0) ⇒ 恰好正确
    //     · 目标在**偏移 0** 处 ⇒ 错误被 0 掩盖
    //     · 而此前所有测试与设备基准**都落在**这两种情形
    //   ⇒ 本用例刻意用**非零偏移**（row margin-top 50 + dot margin-top 10），
    //     并断言**绝对坐标**（沿父链累加），把整类错误钉死。
    const sfc = `<template>
  <p-view>
    <p-view>
      <p-view :width="dotWidth" />
    </p-view>
  </p-view>
</template>

<script setup lang="ts">
const dotWidth = ref(20)
</script>
`
    // ★树 id **必须等于元素序**（本仓实测的对齐纪律，我又踩了一次）：
    //   SFC 是三层嵌套 ⇒ 元素序 root=**0** · row=**1** · dot=**2**
    //   ⇒ 树里 dot 的 id 必须是 **2**（不是 1）。首版写成 id=1，于是指令打到了 row 上
    //     （现象：`scopes=[0]` 全树重排、row 的宽变成 70）——**看起来像坐标错，其实是 id 错位**。
    const treeJson = JSON.stringify({
      viewport: { width: 300, height: 300 },
      nodes: [
        { id: 0, parentId: null, flexDirection: 'column', width: 300, height: 300 },
        { id: 1, parentId: 0, flexDirection: 'column', width: 300, height: 100, margin: { top: 50 } },
        { id: 2, parentId: 1, width: 20, height: 20, margin: { top: 10 } },
      ],
    })
    const { table } = buildVaporSubscriptions(sfc, 'offset.vue')
    const keys = new PropKeyTable()
    const strings = new StringPool()
    const captured: Uint8Array[] = []
    const rt = new SlotRuntime(keys, strings, (b) => captured.push(b))
    let dotWidth = 20
    const ctx: EvalContext = { read: (n) => (n === 'dotWidth' ? dotWidth : undefined) }
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators))
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (n, cb) => triggers.set(n, cb))

    dotWidth = 70
    triggers.get('dotWidth')!()
    rt.flush()
    expect(captured.length).toBe(1)

    const res = rustRoundTrip(treeJson, captured[0])
    // ★`rects` 给的是**绝对**坐标（`collect_abs_pairs` 已沿父链累加过）
    //   ⇒ 直接断言 dot 的绝对 y = 60（row 的 50 + dot 相对的 10）。
    //   ★本条用例我写错过两次，两次都值得记：
    //     ① 树 id 与元素序不对齐（dot 写成 id=1）⇒ 指令打到 row 上，**看起来像坐标错**
    //     ② 断言里又加了一次 row.y（`dot.y + row.y`）⇒ 110，**是断言错、不是实现错**
    //   ⇒ 纪律：**绝对/相对坐标在断言里必须标明口径**，且树 id 必须等于元素序。
    const dot = res.rects['2']   // dot 的 id = 2（= 元素序）
    const row = res.rects['1']   // row 的 id = 1
    expect(row.y).toBeCloseTo(50, 1)      // row 绝对 y（margin-top 50）
    expect(dot.y).toBeCloseTo(60, 1)      // ★dot 绝对 y = 50 + 10（不得为 110）
    expect(dot.width).toBeCloseTo(70, 1)
  })

  it('★指令无法应用时必须上报（未知节点 → unsupported 非空）', () => {
    const treeJson = JSON.stringify({
      viewport: { width: 100, height: 100 },
      nodes: [{ id: 0, parentId: null, width: 100, height: 100 }],
    })
    const keys = new PropKeyTable()
    const strings = new StringPool()
    const bytes = encodeOps([{ op: OpCode.SET_STYLE, nodeId: 777, keyId: keys.intern('layout.width'), value: 5 }], keys, strings)
    const res = rustRoundTrip(treeJson, bytes) as unknown as { applied: number; unsupported?: unknown[] }
    expect(res.applied).toBe(0)
    expect(res.unsupported && res.unsupported.length).toBeGreaterThan(0)
  })
})
