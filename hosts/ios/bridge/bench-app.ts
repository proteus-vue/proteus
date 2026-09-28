// hosts/ios/bridge/bench-app.ts —— 加压测试的**被测应用工厂**（真机 bundle 与桌面自检共用）
//
// 【为什么抽成独立模块（而不是留在 entry-bench.ts 里）】
//   V0 探针（《Vapor for Proteus IR 设计方案》§9）要回答「Vue 原生手段能否抹平组件级重渲染」，
//   它的读数只有在**同一棵树、同一操作、只换 Vue 用法**时才有意义。
//   本仓纪律「同一语义只允许一处实现」⇒ 三种用法必须共用同一个行构造器；
//   且探针的接线（策略是否真的跳过了 VNode 创建）要在**桌面**先被验证，
//   不能在真机上用 3–4 分钟一轮的构建去调试测量装置（本仓已四次踩到"测量装置缺陷误导结论"）。
//   ⇒ 真机 bundle（entry-bench.ts）与桌面自检（tests/v0-probe-mechanism.test.ts）都从这里取。

import { h, ref, computed, reactive, withMemo } from '@vue/runtime-core'
import { createAppRenderer, createSelfDrawAdapter } from '@proteus-vue/renderer-app'

/** 视口（宿主按模式注入；桌面自检走默认值） */
export const VP = (globalThis as unknown as { __PROTEUS_VIEWPORT__?: { width: number; height: number } })
  .__PROTEUS_VIEWPORT__ ?? { width: 390, height: 844 }

/** 三种 Vue 用法（V0 探针的自变量；既有用例一律 'plain' ⇒ 行为不变） */
export type BenchStrategy = 'plain' | 'memo' | 'comp'

export interface BenchApp {
  adapter: ReturnType<typeof createSelfDrawAdapter>
  setCount: (n: number) => void
  reverse: () => void
  setItems: (items: { id: number; title: string; sub: string; tint?: string }[]) => void
  mutateDeep: () => void
  setScaleBase: (n: number) => void
  /** ★类B 平级变更：改**第 i 行**的 margin（改变主轴占用 ⇒ **兄弟行全部移位** ⇒ 范围=父级） */
  setRowMargin: (i: number, px: number) => void
  /** ★类A 局部变更：改**第 i 行内子节点**的尺寸（行高显式 ⇒ 行尺寸不变 ⇒ 兄弟不动 ⇒ 范围应止于该行） */
  setDotSize: (i: number, px: number) => void
  /**
   * ★V0 探针：只改首屏标题的**布局样式**（margin.bottom）——**零行变更**，
   *   用于归因「父组件 render + 整棵 patch 遍历」本身的固定成本。
   *   （不用文本内容变更：当前管线里文本变更不产生布局补丁，宿主侧读不到效果）
   */
  setHeaderMargin: (v: number) => void
  /** ★V0 探针：行子组件（comp 策略）的累计渲染次数——验证「更新是否真的止于该行」 */
  rowRenderCount: () => number
  /** ★文本变更：改前 k 行的文案（**击穿内容寻址的度量缓存**，逼出文本度量成本） */
  churnText: (k: number, tag: string) => void
  renderCount: () => number
  /**
   * ★释放该应用（加压用例之间必须调用）
   *
   * 【为什么必须（真机实测）】S 组初版每个用例建一个应用且从不释放 ⇒
   *   到 S1_4000 时进程已达 **1.3GB**，后续用例的读数混进了 GC 风暴与内存压力，
   *   无法判断"慢是因为算法还是因为内存"。加压测试要给出**可归因**的数字。
   */
  dispose: () => void
  items: () => { id: number; title: string; sub: string; tint?: string }[]
}

/**
 * ★★V0 探针：行 vnode 的**唯一构造器**（plain / memo / comp 三种策略共用）
 *
 * 【为什么要共用】V0 的结论形式是「**同一棵树、同一操作**，只换 Vue 用法」——
 *   若探针各写一份树，数字差异就可能来自"树不一样"而不是"用法不一样"。
 *   共用构造器 + 宿主侧 `relayout/updated_layers` 与基线逐位等价断言，两重保证可比。
 */
export function buildBenchRow(
  it: { id: number; title: string; sub: string; tint?: string },
  dot: number, margin: number, c: string, extra: string | null,
): ReturnType<typeof h> {
  return h('p-view', {
    key: it.id,
    style: {
      flexDirection: 'row', alignItems: 'center',
      height: 56, flexShrink: 0, margin: { bottom: margin }, padding: { left: 16, right: 16 },
      // ★`tint`：供像素判据用（新插入的行给专用底色 ⇒ 采样序列有区分力——本仓实测的教训：
      //   若新行与既有行同色，三行采样必然同色 ⇒ 判据无区分力，等于没验）
      backgroundColor: it.tint ?? '#1b1b21', borderRadius: 12,
    },
  }, [
    h('p-view', { style: { width: 36, height: dot, backgroundColor: c, borderRadius: 18 } }),
    h('p-view', { style: { flexGrow: 1, margin: { left: 12 } } }, [
      h('p-text', { style: { fontSize: 16, color: '#ffffff' } }, it.title),
      h('p-text', { style: { fontSize: 13, color: '#9aa3b2' } }, it.sub),
    ]),
    // ★深层 + computed 的消费点：只在「第一行」引用，便于观测细粒度更新
    ...(extra === null ? [] : [h('p-text', { style: { fontSize: 11, color: '#666' } }, extra)]),
  ])
}

/** ★V0 探针 comp 策略的行子组件（累计渲染次数用于验证「更新止于该行」） */
let v0RowRenders = 0
export const v0RowRenderTotal = (): number => v0RowRenders

export const V0Row = {
  name: 'V0Row',
  props: ['row', 'dot', 'margin', 'accent', 'extra'],
  render(this: Record<string, unknown>) {
    v0RowRenders++
    return buildBenchRow(
      this.row as { id: number; title: string; sub: string },
      this.dot as number, this.margin as number, this.accent as string, this.extra as string | null,
    )
  },
}

/**
 * 构建被测应用（规模参数化）。
 *
 * ★同时支持「列表项」与「深层嵌套 + computed 链」两种数据形态：
 *   前者用于规模扫描与 diff 类用例；后者用于 B/C 两条响应式形态用例。
 *
 * ★strategy（**V0 探针专用**，默认 'plain' ⇒ 既有全部用例行为不变）：
 *   · 'plain' 手写 render，每次整树重建（既有用例走这条）
 *   · 'memo'  逐行 `withMemo`（编译器把 `v-memo` 展开成的正是它）
 *   · 'comp'  逐行独立子组件（组件边界 = props 浅比较构成的更新屏障）
 */
export function makeApp(initial: number, strategy: BenchStrategy = 'plain'): BenchApp {
  const n = ref(initial)
  const accent = ref('#6f4ae8')
  // ★深响应式：ref 包裹对象 → Vue 会深度 reactive 化（改叶子应只影响用到它的那部分）
  const deep = reactive({ a: { b: { c: { v: 1 } } } })
  // ★computed 链（3 级）：base → mid → top，渲染只读 top
  const scaleBase = ref(1)
  const scaleMid = computed(() => scaleBase.value * 2)
  const scaleTop = computed(() => scaleMid.value + 100)
  // ★列表数据（keyed diff 用）：独立数组，支持 reverse / 结构变更
  const items0: { id: number; title: string; sub: string; tint?: string }[] = []
  for (let i = 0; i < initial; i++) items0.push({ id: i, title: `列表项 ${i + 1}`, sub: i % 3 === 0 ? '分组标题' : '说明文字' })
  const items = ref(items0)
  let renders = 0

  const adapter = createSelfDrawAdapter()
  const renderer = createAppRenderer(adapter)
  const container = adapter.createElement('p-view')
  adapter.root.children.push(container)
  container.parent = adapter.root

  const size = ref(initial)          // 外部直接驱动规模（避免每次改 items 清空）
  // ★逐行 margin：改**单行**属于「局部布局样式变更」⇒ 走增量路径且**范围应限于该行**
  //   （踩坑：初版用**共享**的 rowMargin → 所有行的 margin 一起变 → patch=500、
  //    重排覆盖所有行 ⇒ 看起来像「增量退化」，实际是**用例本身不是局部变更**）
  const rowMargins = ref<Record<number, number>>({})
  // ★行内子节点的尺寸（类A 局部变更的靶子）：行高显式 ⇒ 改它不该影响兄弟
  const dotSizes = ref<Record<number, number>>({})
  // ★文本版本号（击穿度量缓存用）
  const textTag = ref(0)
  // ★V0 探针：标题 margin（**零行变更**的靶子——用于归因"整树重建+遍历"的固定成本）
  const headerMargin = ref(12)
  // ★V0 探针：`withMemo` 的缓存槽（编译器会把它作为 `_cache` 传入，这里手工持有）
  const memoCache: ReturnType<typeof h>[] = []
  // ★V0 探针：行子组件的累计渲染次数（模块级计数器 → 取本应用创建时的偏移）
  const rowRendersStart = v0RowRenders

  const App = {
    name: 'BenchApp',
    render() {
      renders++
      const count = n.value
      const c = accent.value
      const hm = headerMargin.value
      const firstId = items.value[0]?.id
      const rows = items.value.slice(0, Math.max(count, items.value.length)).map((it, i) => {
        const dot = dotSizes.value[it.id] ?? 36
        const margin = rowMargins.value[it.id] ?? 8
        // ★深层 + computed 的消费点：只在「第一行」引用，便于观测细粒度更新
        const extra = it.id === firstId ? `d${deep.a.b.c.v}/s${scaleTop.value}` : null
        if (strategy === 'memo') {
          // ★编译器把 `v-memo="[...]"` 展开成的正是 withMemo(memo, render, _cache, index)
          return withMemo([it.title, it.sub, dot, margin, c, extra], () => buildBenchRow(it, dot, margin, c, extra), memoCache, i)
        }
        if (strategy === 'comp') {
          return h(V0Row, { key: it.id, row: it, dot, margin, accent: c, extra })
        }
        return buildBenchRow(it, dot, margin, c, extra)
      })
      return h('p-view', {
        style: {
          flexDirection: 'column', width: VP.width, height: VP.height,
          backgroundColor: '#101020', padding: { top: 60, left: 16, right: 16 },
        },
      }, [
        h('p-text', { style: { fontSize: 24, color: '#ffffff', margin: { bottom: hm } } }, `bench ${size.value}`),
        ...rows,
      ])
    },
  }
  const app = renderer.createApp(App)
  app.mount(container)

  return {
    adapter,
    setCount: (v) => { n.value = v; size.value = v },
    reverse: () => { items.value = [...items.value].reverse() },
    setItems: (v) => { items.value = v },
    mutateDeep: () => { deep.a.b.c.v = deep.a.b.c.v + 1 },
    setScaleBase: (v) => { scaleBase.value = v },
    setRowMargin: (i, px) => { rowMargins.value = { ...rowMargins.value, [i]: px } },
    setDotSize: (i, px) => { dotSizes.value = { ...dotSizes.value, [i]: px } },
    setHeaderMargin: (v) => { headerMargin.value = v },
    rowRenderCount: () => v0RowRenders - rowRendersStart,
    churnText: (k, tag) => {
      // 改文案前缀 ⇒ 内容寻址缓存**必然未命中**
      items.value = items.value.map((it, idx) => (idx < k ? { ...it, title: `${tag} ${it.title}` } : it))
      void textTag.value
    },
    renderCount: () => renders,
    items: () => items.value,
    dispose: () => {
      // Vue 侧销毁（解绑响应式、释放组件实例）
      try { app.unmount() } catch { /* 已卸载或未挂载 */ }
      // 断开容器与根的联系（让 NativeElementNode 树可回收）
      adapter.root.children.length = 0
      // ★探针的 memo 缓存持有整棵旧树 ⇒ 必须清（否则加压组的内存累积）
      memoCache.length = 0
    },
  }
}
