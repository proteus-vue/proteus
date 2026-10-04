// tests/global-layer-memory-gp7.test.ts —— ★★★GP7：Global 层内存常驻监控（2026-10-04）
//
// 【这张卡解决什么（任务卡 GP7 原文）】Global 层**永不销毁**——若塞入全局 IM 会话列表 /
//   埋点缓冲 / 图片预缓存，会形成一块永不释放的内存。MP 端**更重**：每页一份实例
//   ⇒ 内存是 O(页面栈深度) 而不是 O(1)。本卡要求：
//     ① 内存占用**可观测**（分端口径：自绘端 1 份 / MP N 份）② `unmountGlobal(id)` 显式卸载
//     ③ 超阈值运行时告警 ④ 与 GP2-d 编译期告警**双层防护**。
//
// 【本测试锁的判据（三层，缺一即可能是假绿）】
//   · **编译期层**（GP2-d 补齐）：
//       ① App 壳声明大数组（≥16）⇒ 警告；小数组/页面大数组 ⇒ 不误报
//       ② App 壳脚本引用 useRoute/usePageParam ⇒ 编译期报错（C3 的 script 侧）；useRouter 不拦
//   · **产物层**（编译期事实如何落到产物）：
//       ③ 共享模块"分端估算"的烘焙值来自**真实壳片段**（fieldCount/perPageBytes 由 plugin 传，
//          不在模块里写死）；模块含 stats/unmount/setBudget/__resetForTest API + 预算常量同源
//       ④ 页面产物含 GP7 桥（__proteusGlStats/__proteusGlUnmount）+ 全局句柄（globalThis.__proteusGlobal）
//   · **运行时层**（真跑模块——不是"字符串里有"就算数）：
//       ⑤ 模块在 Node 里真实执行：set/get、unmount（释放 + 墓碑 + 通知）、stats（keys/bytes/预算判定）
//       ⑥ **预算告警真的触发**（console.warn 被调用；且**不刷屏**——只告警一次）
//       ⑦ **分端口径**：stats().residentEstimateBytes = 共享状态 + 每页字节 × 页面栈
//          （`getCurrentPages` 模拟 MP 页面栈；无页面栈环境 = 1 份）
//       ⑧ `unmount` 后内存**确实释放**（前后对比数据——任务卡验收项）
//
// 【与既有测试的关系（勿混）】`mp-global-layer-inject.test.ts` 验注入/合并/共享通道；
//   本文件只验 GP7 增量（内存记账/卸载/告警/编译期集合告警）。

import { describe, it, expect, vi } from 'vitest'
import vm from 'node:vm'
import { compileVueSfc } from '@proteus-vue/compiler'
import { GLOBAL_LAYER_MEMORY_BUDGET_BYTES, GLOBAL_LAYER_COLLECTION_WARN_LENGTH } from '@proteus-vue/contracts'
import { globalLayerStateCode, GLOBAL_LAYER_STATE_CODE } from '../packages/plugin-vite/src/appSkeleton'

const SHELL_SRC = `<script setup lang="ts">
import { ref } from 'vue'
const barVisible = ref(false)
const imUnread = ref(3)
function toggleBar() { barVisible.value = !barVisible.value }
</script>
<template>
  <app-root>
    <global-layer>
      <view class="bar" @tap="toggleBar">{{ imUnread }}</view>
    </global-layer>
  </app-root>
</template>`

const PAGE_SRC = `<script setup lang="ts">
import { ref } from 'vue'
const title = ref('页面')
</script>
<template><view class="page"><text>{{ title }}</text></view></template>`

const compileShell = (src = SHELL_SRC, filename = 'App.vue') =>
  compileVueSfc(src, { filename, isComponent: false, appShell: true, px2rpx: false, rpxRatio: 2, platform: 'mp' })

const compilePage = (shellSrc = SHELL_SRC) => {
  const snippet = compileShell(shellSrc).globalLayerSnippet!
  return compileVueSfc(PAGE_SRC, {
    filename: 'pages/index.vue',
    isComponent: false,
    px2rpx: false,
    rpxRatio: 2,
    platform: 'mp',
    globalLayer: { ...snippet, requirePath: '../_proteus/global-layer.js' },
  })
}

/** 在隔离环境里**真跑**一次状态模块（模拟小程序沙箱：module/exports + globalThis 可调） */
function runStateModule(code: string, opts: { pageStack?: number } = {}): {
  mod: {
    get: (k: string) => unknown
    set: (k: string, v: unknown) => void
    has: (k: string) => boolean
    all: () => Record<string, unknown>
    unmount: (k: string) => void
    unmounted: (k: string) => boolean
    stats: () => {
      keys: number
      bytes: number
      budgetBytes: number
      overBudget: boolean
      fieldCount: number
      perPageBytes: number
      pageStack: number
      residentEstimateBytes: number
    }
    setBudget: (b: number) => boolean
    __resetForTest: () => boolean
  }
  warns: string[]
} {
  const warns: string[] = []
  const sandbox: Record<string, unknown> = {
    console: { warn: (m: string) => warns.push(String(m)) },
    module: { exports: {} as Record<string, unknown> },
    getCurrentPages: () => new Array(opts.pageStack ?? 1).fill({}),
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  return { mod: (sandbox.module as { exports: Record<string, unknown> }).exports as never, warns }
}

describe('★GP7 ① 编译期层（GP2-d 补齐）：Global 层持有业务数据集合 ⇒ 警告', () => {
  it('★大数组（≥16 项）⇒ 编译期警告（含"N 项"与分端口径说明）', () => {
    const src = `<script setup lang="ts">
import { ref } from 'vue'
const sessions = ref(Array.from({ length: 20 }, (_, i) => ({ id: i, name: 'c' + i })))
</script>
<template><app-root><global-layer><view>{{ sessions.length }}</view></global-layer></app-root></template>`
    const r = compileShell(src)
    const all = r.warnings.join('\n')
    expect(all, '★应告警大数组').toContain('大数组')
    // ★编译期告警须点名分端成本（MP N 份）——否则开发者不知道代价是什么
    expect(all, '告警应说明 MP 端 × 页面栈成本').toMatch(/页面栈/)
  })

  it('小数组（<16 项）/ 标量 ⇒ 不误报（误报面要可控）', () => {
    const src = `<script setup lang="ts">
import { ref } from 'vue'
const tabs = ref(['a', 'b', 'c'])
const n = ref(1)
</script>
<template><app-root><global-layer><view>{{ n }}</view></global-layer></app-root></template>`
    const r = compileShell(src)
    expect(r.warnings.join('\n'), '小数组不应告警').not.toContain('大数组')
  })

  it('Map/Set ⇒ 专属告警（无小程序侧模板绑定通道）', () => {
    const src = `<script setup lang="ts">
import { ref } from 'vue'
const cache = ref(new Map())
</script>
<template><app-root><global-layer><view>{{ cache.size }}</view></global-layer></app-root></template>`
    const r = compileShell(src)
    expect(r.warnings.join('\n'), 'Map 字段应告警').toContain('Map')
  })

  it('页面自己的大数组 ⇒ 不告警（那不是 Global 层常驻；页面随销毁回收）', () => {
    const r = compileVueSfc(
      `<script setup lang="ts">
import { ref } from 'vue'
const list = ref(Array.from({ length: 100 }, (_, i) => i))
</script>
<template><view class="p"><text>{{ list.length }}</text></view></template>`,
      { filename: 'pages/list.vue', isComponent: false, px2rpx: false, rpxRatio: 2, platform: 'mp' },
    )
    expect(r.warnings.join('\n'), '页面大数组不归 Global 层管').not.toContain('大数组')
  })
})

describe('★GP7 ② 编译期层（GP2-d 补齐）：App 壳脚本引用页面路由状态 ⇒ 报错（C3 script 侧）', () => {
  it('★useRoute() 在 App 壳 ⇒ 编译期 CompilerError（Global 层不参与路由栈）', () => {
    const src = `<script setup lang="ts">
import { useRoute } from '@proteus-vue/api'
const r = useRoute()
</script>
<template><app-root><global-layer><view/></global-layer></app-root></template>`
    expect(() => compileShell(src), '应抛编译错误').toThrow(/不参与路由栈|useRoute/)
  })

  it('★usePageParam() 在 App 壳 ⇒ 同样报错（全局层没有页面参数）', () => {
    const src = `<script setup lang="ts">
import { usePageParam } from '@proteus-vue/api'
const id = usePageParam('id')
</script>
<template><app-root><global-layer><view/></global-layer></app-root></template>`
    expect(() => compileShell(src)).toThrow(/usePageParam|不参与路由栈/)
  })

  it('useRouter()（事件回调用法）⇒ **不拦**（C3 明确的替代路径）', () => {
    const src = `<script setup lang="ts">
import { useRouter } from '@proteus-vue/api'
const router = useRouter()
function goSupport() { router.push('/pages/verify') }
</script>
<template><app-root><global-layer><view @tap="goSupport">客服</view></global-layer></app-root></template>`
    expect(() => compileShell(src), 'useRouter 允许（不依赖页面上下文）').not.toThrow()
  })

  it('页面里用 useRoute ⇒ 不受影响（约束只对 App 壳）', () => {
    const r = compileVueSfc(
      `<script setup lang="ts">
import { useRoute } from '@proteus-vue/api'
const r = useRoute()
</script>
<template><view class="p"><text>{{ r ? 1 : 0 }}</text></view></template>`,
      { filename: 'pages/detail.vue', isComponent: false, px2rpx: false, rpxRatio: 2, platform: 'mp' },
    )
    expect(r.wxml).toContain('class="p"')
  })
})

describe('★GP7 ③ 产物层：共享状态模块的内存记账面', () => {
  it('模块含 GP7 API（stats/unmount/setBudget/__resetForTest）+ 预算常量同源', () => {
    const code = GLOBAL_LAYER_STATE_CODE
    for (const api of ['stats:', 'unmount:', 'unmounted:', 'setBudget:', '__resetForTest:']) {
      expect(code, `状态模块应有 ${api}`).toContain(api)
    }
    expect(code, '预算常量来自 contracts（SSOT 同源）').toContain(String(GLOBAL_LAYER_MEMORY_BUDGET_BYTES))
    // 既有 API 不回归
    for (const api of ['get:', 'set:', 'has:', 'all:', 'subscribe:']) {
      expect(code, `既有 API 不回归：${api}`).toContain(api)
    }
  })

  it('★烘焙值来自真实壳片段（fieldCount/perPageBytes 是参数而非写死）', () => {
    const a = globalLayerStateCode({ fieldCount: 3, perPageBytes: 120 })
    const b = globalLayerStateCode({ fieldCount: 7, perPageBytes: 999 })
    expect(a, 'a 含 3 字段').toContain('__fieldCount = 3')
    expect(a).toContain('__perPageBytes = 120')
    expect(b).toContain('__fieldCount = 7')
    expect(b).toContain('__perPageBytes = 999')
  })

  it('★插件侧用真实壳片段调 globalLayerStateCode（源码级证据：不是 GLOBAL_LAYER_STATE_CODE 常量占位）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, '../packages/plugin-vite/src/plugin.ts'), 'utf-8')
    expect(src, '★调用点应传字段数/字节（运行时探测不到编译期事实）').toMatch(/globalLayerStateCode\(\{[\s\S]{0,200}fieldCount/)
    expect(src, '★perPageBytes 从壳片段 data 计算（JSON 长度）').toMatch(/globalLayerSnippet\.data[\s\S]{0,200}perPageBytes[\s\S]{0,120}JSON\.stringify/)
  })

  it('页面产物含 GP7 桥方法 + 全局句柄（诊断/e2e 可读）', () => {
    const js = compilePage().js
    expect(js, '页面桥：stats').toContain('__proteusGlStats')
    expect(js, '页面桥：unmount').toContain('__proteusGlUnmount')
    expect(js, '全局句柄（同探针注册表模式）').toContain('globalThis.__proteusGlobal = __proteusGlobal')
  })
})

describe('★GP7 ④ 运行时层（真跑模块——不是"字符串里有"就算数）', () => {
  it('set/get/has/all 基本语义（既有行为不回归）', () => {
    const { mod } = runStateModule(GLOBAL_LAYER_STATE_CODE)
    mod.set('theme', 'dark')
    expect(mod.get('theme')).toBe('dark')
    expect(mod.has('theme')).toBe(true)
    expect(mod.all()).toEqual({ theme: 'dark' })
  })

  it('★unmount：内存**确实释放**（前后对比）+ 墓碑语义 + 订阅者收 undefined', () => {
    const { mod } = runStateModule(GLOBAL_LAYER_STATE_CODE)
    const got: unknown[] = []
    ;(mod as unknown as { subscribe: (k: string, fn: (v: unknown) => void) => () => void }).subscribe('cache', (v) => got.push(v))
    mod.set('cache', { big: 'x'.repeat(4000) })
    const before = mod.stats().bytes
    expect(before, '写入后占用 > 0').toBeGreaterThan(4000)
    mod.unmount('cache')
    const after = mod.stats().bytes
    expect(after, '★unmount 后内存确实释放（前后对比）').toBeLessThan(before)
    expect(mod.get('cache'), 'unmount 后读 undefined').toBeUndefined()
    expect(mod.unmounted('cache'), '墓碑可查（区分"从未写"与"已卸载"）').toBe(true)
    expect(got[got.length - 1], '订阅者收到 undefined（视觉联动信号）').toBeUndefined()
    // 重新 set ⇒ 复活
    mod.set('cache', 1)
    expect(mod.unmounted('cache'), '重新写入即复活').toBe(false)
  })

  it('★预算告警真的触发（超限 console.warn；且只告警一次不刷屏）', () => {
    const { mod, warns } = runStateModule(globalLayerStateCode({ budgetBytes: 100 }))
    mod.set('big', 'y'.repeat(500))
    expect(warns.length, '超预算必须有告警').toBeGreaterThan(0)
    expect(warns[0], '告警说明分端成本（MP × 页面栈）').toMatch(/Global 层.*预算/)
    mod.set('big2', 'z'.repeat(500))
    expect(warns.length, '★不刷屏：同预算只告警一次').toBe(1)
    // setBudget 显式调大 ⇒ 不再告警（显式确认更大常驻）
    expect(mod.setBudget(100000), 'setBudget 生效').toBe(true)
    expect(mod.stats().overBudget).toBe(false)
  })

  it('★分端口径：residentEstimateBytes = 共享状态 + 每页字节 × 页面栈（MP 形态）', () => {
    const code = globalLayerStateCode({ fieldCount: 5, perPageBytes: 200, budgetBytes: 999999 })
    const { mod } = runStateModule(code, { pageStack: 5 })
    mod.set('theme', 'dark') // 'dark' → JSON 6 字节
    const s = mod.stats()
    expect(s.pageStack, '页面栈深度被读到').toBe(5)
    expect(s.fieldCount, '每页字段数（编译期烘焙）').toBe(5)
    expect(s.perPageBytes, '每页初值字节（编译期烘焙）').toBe(200)
    expect(s.residentEstimateBytes, '★分端口径：一份状态 + 每页 × 5').toBe(s.bytes + 200 * 5)
    expect(s.bytes, '共享状态字节 = JSON 长度').toBe(6)
    expect(s.overBudget, '未超预算').toBe(false)
  })

  it('无页面栈环境（Web/自绘端）⇒ 1 份（不是 0，也不报 N）', () => {
    const code = globalLayerStateCode({ fieldCount: 3, perPageBytes: 50 })
    const { mod } = runStateModule(code, { pageStack: 1 })
    // getCurrentPages 返回 1 项 ⇒ 1 份；契约语义：Web/自绘端 Global 层恒 1 份
    expect(mod.stats().pageStack).toBe(1)
    expect(mod.stats().residentEstimateBytes).toBe(mod.stats().bytes + 50 * 1)
  })

  it('__resetForTest：状态/墓碑/告警去重全部归零（e2e"先归一"纪律）', () => {
    const { mod } = runStateModule(globalLayerStateCode({ budgetBytes: 10 }))
    mod.set('a', 'x'.repeat(100))
    mod.unmount('a')
    mod.__resetForTest()
    expect(mod.stats().keys, 'keys 归零').toBe(0)
    expect(mod.stats().bytes, 'bytes 归零').toBe(0)
    expect(mod.unmounted('a'), '墓碑清空').toBe(false)
  })
})

describe('★GP7 ⑤ 契约常量（SSOT——两处不硬编码）', () => {
  it('预算 64KiB / 集合告警长度 16（与任务卡"阈值待实测校准"口径一致）', () => {
    expect(GLOBAL_LAYER_MEMORY_BUDGET_BYTES).toBe(65536)
    expect(GLOBAL_LAYER_COLLECTION_WARN_LENGTH).toBe(16)
  })

  it('模块默认参数与契约同值（不传参形态 = 契约缺省）', () => {
    const code = GLOBAL_LAYER_STATE_CODE
    expect(code).toContain(`__budget = ${GLOBAL_LAYER_MEMORY_BUDGET_BYTES}`)
  })
})
