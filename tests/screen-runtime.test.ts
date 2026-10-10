// tests/screen-runtime.test.ts —— ★★★B1：App 壳统一运行期（createScreenRuntime）判据（2026-10-09）
//
// 【锁什么】`@proteus-vue/render-backend` 的 `createScreenRuntime`——
//   ① 实例化（tpl+data → nodes）；
//   ② 手势派发（内核命中 id → content-local id 反查 → handler 跑 → 数据变）；
//   ③ 增量（handler 改数据后 → relink → 指令经 applyOps 下发）。
//   ★用**真编译产物**（`buildAppRuntimeContent` 编一个临时工程），不是手写夹具——
//     保证"编译面 (events/handlers) ↔ 运行面 (dispatch/runtime) 的契约"真的接得上。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildAppRuntimeContent } from '../packages/cli/src/app-runtime-content'
import { createScreenRuntime } from '@proteus-vue/render-backend'
import type { ScreenRuntimeArtifact } from '@proteus-vue/render-backend'

function makeTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-srt-'))
  fs.mkdirSync(path.join(dir, 'router'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'pages', 'idx.vue'),
    `<template>
  <view class="box" @tap="count++">
    <text>{{ count }}</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue'
const count = ref(0)
</script>
`,
  )
  fs.writeFileSync(
    path.join(dir, 'router', 'auto-routes.ts'),
    `export const routes = [{ name: "idx", path: "pages/idx", component: "../pages/idx.vue" }]\n`,
  )
  fs.writeFileSync(path.join(dir, 'proteus.config.ts'), `export default { pagesDir: 'pages' }\n`)
  return dir
}

describe('★B1 · 统一运行期（createScreenRuntime）', () => {
  it('① 实例化 + 派发（含内核 id → content-local id 反查）+ 增量指令', async () => {
    const dir = makeTempProject()
    const build = await buildAppRuntimeContent(dir, 'android')
    const artifacts = JSON.parse(fs.readFileSync(build.outFile, 'utf-8')) as Record<string, ScreenRuntimeArtifact>

    const ops: string[] = []
    const rt = createScreenRuntime({
      artifacts,
      applyOps: (o) => ops.push(o),
      viewport: { width: 390, height: 844 },
      contentIdBase: 1000,
    })

    const inst = rt.instance('idx')
    // ① 实例化：有节点
    const content = inst.content()
    expect(content.viewport).toEqual({ width: 390, height: 844 })
    expect(content.nodes.length).toBeGreaterThan(0)

    // 事件绑定在 content-local id 空间——取第一个 @tap 节点的 local id
    const ev = artifacts['idx']!.events[0]!
    const localId = ev.nodeId
    // ② 派发：宿主报的是**内核 id**（= base + 数组序）——模拟宿主命中该节点
    const nodesArr = content.nodes as Array<{ id: number }>
    const idx = nodesArr.findIndex((n) => n.id === localId)
    expect(idx, '事件节点应在实例化节点里').toBeGreaterThanOrEqual(0)
    const kernelId = 1000 + idx

    const before = inst.data()['count']
    const r = inst.dispatch('tap', [kernelId])
    expect(r.handled, '应命中并跑 handler').toBe(true)
    expect(inst.data()['count'], 'count 应 +1').toBe(Number(before) + 1)
  })

  it('①b 缺省 = 恒等（VaporRenderHost 路径）：kernelId === localId 直接派发', async () => {
    const dir = makeTempProject()
    const build = await buildAppRuntimeContent(dir, 'android')
    const artifacts = JSON.parse(fs.readFileSync(build.outFile, 'utf-8')) as Record<string, ScreenRuntimeArtifact>
    const rt = createScreenRuntime({ artifacts, applyOps: () => {}, viewport: { width: 390, height: 844 } })
    const inst = rt.instance('idx')
    const ev = artifacts['idx']!.events[0]!
    const r = inst.dispatch('tap', [ev.nodeId])   // 直接用 local id（恒等）
    expect(r.handled, '恒等模式应命中').toBe(true)
    expect(Number(inst.data()['count'])).toBe(1)
  })

  it('② R6 破坏性：contentIdBase 错位 ⇒ 反查失败、不误跑别人 handler', async () => {
    const dir = makeTempProject()
    const build = await buildAppRuntimeContent(dir, 'android')
    const artifacts = JSON.parse(fs.readFileSync(build.outFile, 'utf-8')) as Record<string, ScreenRuntimeArtifact>
    const rt = createScreenRuntime({ artifacts, applyOps: () => {}, viewport: { width: 390, height: 844 }, contentIdBase: 1000 })
    const inst = rt.instance('idx')
    // 故意用一个不可能命中的内核 id（远超节点数）
    const r = inst.dispatch('tap', [999999])
    expect(r.handled, '无该节点 ⇒ 不跑 handler（不静默乱跑）').toBe(false)
    expect(Number(inst.data()['count']), 'count 不变').toBe(0)
  })

  it('③ 一次性 VM 状态回灌（snapshot→seedData）：跨 VM 保留 count（鸿蒙「点击计数不动」的修法）', async () => {
    const dir = makeTempProject()
    const build = await buildAppRuntimeContent(dir, 'android')
    const artifacts = JSON.parse(fs.readFileSync(build.outFile, 'utf-8')) as Record<string, ScreenRuntimeArtifact>
    const ev = artifacts['idx']!.events[0]!

    // VM A：派发 count++ → 导出 snapshot（宿主持有）
    const rtA = createScreenRuntime({ artifacts, applyOps: () => {}, viewport: { width: 390, height: 844 } })
    rtA.instance('idx').dispatch('tap', [ev.nodeId])
    expect(Number(rtA.instance('idx').data()['count'])).toBe(1)
    const snap = rtA.snapshot()

    // VM B（新实例）——回灌 snapshot ⇒ count 从 1 起（不是 0）
    const rtB = createScreenRuntime({ artifacts, applyOps: () => {}, viewport: { width: 390, height: 844 }, seedData: snap })
    const instB = rtB.instance('idx')
    expect(Number(instB.data()['count']), 'snapshot 回灌 ⇒ count 保留 1').toBe(1)
    instB.dispatch('tap', [ev.nodeId])   // 1→2
    expect(Number(instB.data()['count'])).toBe(2)
  })

  it('③b refresh()：数据变后 content() 反映新值（applyOps 为 no-op 的宿主整树重挂上屏）', async () => {
    const dir = makeTempProject()
    const build = await buildAppRuntimeContent(dir, 'android')
    const artifacts = JSON.parse(fs.readFileSync(build.outFile, 'utf-8')) as Record<string, ScreenRuntimeArtifact>
    const ev = artifacts['idx']!.events[0]!
    const rt = createScreenRuntime({ artifacts, applyOps: () => {}, viewport: { width: 390, height: 844 } })
    const inst = rt.instance('idx')
    const textsOf = (nodes: unknown[]): string =>
      (nodes as Array<Record<string, unknown>>).map((n) => String(n.text ?? '')).join('|')
    const before = textsOf(inst.content().nodes)   // count=0 渲染
    expect(before).toContain('0')
    inst.dispatch('tap', [ev.nodeId])              // count 0→1；dispatch 内部已 rebuild
    const after = textsOf(inst.content().nodes)
    expect(after, 'content() 文本应随 count 变化（无需 applyOps）').not.toBe(before)
    expect(after).toContain('1')
  })

  it('④ ★页面处理器 source map（决策 #712）：handler 运行期出错 ⇒ 报**模板源位置**且不炸掉整次手势', async () => {
    const dir = makeTempProject()
    const build = await buildAppRuntimeContent(dir, 'android')
    const artifacts = JSON.parse(fs.readFileSync(build.outFile, 'utf-8')) as Record<string, ScreenRuntimeArtifact>
    const ev = artifacts['idx']!.events[0]!
    // 事件绑定应带模板源位置（编译器 loc 透传——本项的地基）
    expect(ev.loc, '事件绑定须带 loc（模板源位置）').toBeTruthy()
    expect(ev.loc!.line, '模板行应为文件第 2 行').toBe(2)

    // 把 handler 换成一个**运行期会抛**的程序（非白名单方法——evalExpr 兜底抛错）
    artifacts['idx']!.handlers['h0'] = [
      { op: 'set', source: 'count', sourceText: 'count = count.bogus()', program: { k: 'mcall', recv: { k: 'root', name: 'count' }, method: '__nope__', args: [] } },
    ] as never

    const errors: string[] = []
    const rt = createScreenRuntime({
      artifacts,
      applyOps: () => {},
      viewport: { width: 390, height: 844 },
      onError: (e) => errors.push(e),
    })
    const inst = rt.instance('idx')
    // ★不炸：dispatch 应正常返回（一个坏表达式不该让页面"点了完全没反应"）
    expect(() => inst.dispatch('tap', [ev.nodeId])).not.toThrow()
    // ★错误如实记 + 带模板源位置（可定位到模板哪一句）
    const drained = inst.handlerErrors()
    expect(drained.length, 'handler 错误应被记录').toBeGreaterThan(0)
    expect(drained.join('\n')).toContain('idx.vue:2')
    expect(drained.join('\n'), 'onError 出口应同步收到').toContain('__nope__')
    expect(errors.join('\n')).toContain('idx.vue:2')
    // 排空式：再取为空
    expect(inst.handlerErrors()).toHaveLength(0)
  })

  it('★⑤ B5：脚本钩子 onMounted/onUnmounted 经 markMounted/markUnmounted 真改数据', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-srt-b5-'))
    fs.mkdirSync(path.join(dir, 'router'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'pages'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'pages', 'idx.vue'),
      `<template>
  <view class="box" :width="w"><text>{{ w }}</text></view>
</template>
<script setup lang="ts">
import { ref } from 'vue'
const w = ref(10)
onMounted(() => { w.value = 99 })
onUnmounted(() => { w.value = 0 })
</script>
`,
    )
    fs.writeFileSync(path.join(dir, 'router', 'auto-routes.ts'), `export const routes = [{ name: "idx", path: "pages/idx", component: "../pages/idx.vue" }]\n`)
    fs.writeFileSync(path.join(dir, 'proteus.config.ts'), `export default { pagesDir: 'pages' }\n`)

    const build = await buildAppRuntimeContent(dir, 'android')
    const artifacts = JSON.parse(fs.readFileSync(build.outFile, 'utf-8')) as Record<string, ScreenRuntimeArtifact>
    // 产物带 scriptLifecycle（mounted + unmounted）
    expect((artifacts['idx'] as { scriptLifecycle?: unknown[] }).scriptLifecycle, 'B5 产物须带 scriptLifecycle').toHaveLength(2)

    const rt = createScreenRuntime({ artifacts, applyOps: () => {}, viewport: { width: 390, height: 844 } })
    const inst = rt.instance('idx')
    expect(inst.data().w).toBe(10) // 初始（script 不执行；data 快照）
    expect(inst.markMounted(), 'mounted 钩子应跑 1 条').toBe(1)
    expect(inst.data().w).toBe(99) // onMounted 生效
    expect(inst.markMounted(), 'mounted 幂等（不重跑）').toBe(0)
    expect(inst.data().w).toBe(99)
    expect(inst.markUnmounted(), 'unmounted 钩子应跑 1 条').toBe(1)
    expect(inst.data().w).toBe(0) // onUnmounted 生效
  })
})

describe('★★★B4-T2 · 输入回写（dispatchInput：v-model ⇒ input handler ⇒ 数据变 ⇒ 下行随之）', () => {
  function makeVModelProject(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-vm-'))
    fs.mkdirSync(path.join(dir, 'router'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'pages'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'pages', 'idx.vue'),
      `<template>
  <input v-model="name" />
  <text>{{ name }}</text>
</template>
<script setup lang="ts">
import { ref } from 'vue'
const name = ref('')
</script>
`,
    )
    fs.writeFileSync(
      path.join(dir, 'router', 'auto-routes.ts'),
      `export const routes = [{ name: "idx", path: "pages/idx", component: "../pages/idx.vue" }]\n`,
    )
    fs.writeFileSync(path.join(dir, 'proteus.config.ts'), `export default { pagesDir: 'pages' }\n`)
    return dir
  }

  it('v-model ⇒ input 回写：编辑值写回源（$event）+ 下行文本更新', async () => {
    const dir = makeVModelProject()
    const build = await buildAppRuntimeContent(dir, 'android')
    const artifacts = JSON.parse(fs.readFileSync(build.outFile, 'utf-8')) as Record<string, ScreenRuntimeArtifact>
    const rt = createScreenRuntime({ artifacts, applyOps: () => {}, viewport: { width: 390, height: 844 }, contentIdBase: 1000 })
    const inst = rt.instance('idx')
    const content = inst.content()

    // v-model 编成一条 input 回写绑定
    const ev = artifacts['idx']!.events.find((e) => e.event === 'input')!
    expect(ev, 'v-model 必须产出 input 回写绑定').toBeTruthy()
    const nodesArr = content.nodes as Array<{ id: number }>
    const idx = nodesArr.findIndex((n) => n.id === ev.nodeId)
    expect(idx, '输入节点应在实例化节点里').toBeGreaterThanOrEqual(0)
    const kernelId = 1000 + idx

    expect(inst.data()['name'], '初值为空').toBe('')
    // 模拟宿主输入控件编辑 ⇒ dispatchInput（值 = 输入框内容）
    const r = inst.dispatchInputValue(kernelId, 'hello 世界')
    expect(r.handled, '应命中 input 回写 handler').toBe(true)
    expect(inst.data()['name'], '输入值应写回源（$event）').toBe('hello 世界')

    // 下行：{{ name }} 的文本槽位随之更新
    const txt = (inst.content().nodes as Array<{ text?: string }>).map((n) => n.text ?? '').join('|')
    expect(txt, '文本节点应反映新值（下行随之）').toContain('hello 世界')
  })

  it('无 input 绑定的节点 ⇒ dispatchInput 不误跑（handled=false）', async () => {
    const dir = makeVModelProject()
    const build = await buildAppRuntimeContent(dir, 'android')
    const artifacts = JSON.parse(fs.readFileSync(build.outFile, 'utf-8')) as Record<string, ScreenRuntimeArtifact>
    const rt = createScreenRuntime({ artifacts, applyOps: () => {}, viewport: { width: 390, height: 844 } })
    const inst = rt.instance('idx')
    const r = inst.dispatchInputValue(999999, 'x')
    expect(r.handled).toBe(false)
    expect(inst.data()['name']).toBe('')
  })

  it('★★v-pump：数据泵（宿主按帧驱动 → 内建生成器 → 写数据源 → 文本增量）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-pump-'))
    fs.mkdirSync(path.join(dir, 'router'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'pages'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'pages', 'idx.vue'),
      `<template>
  <view class="boil" v-pump="{ src: 'p0', hz: 100, gen: { kind: 'int', min: 1, max: 99 } }">
    <text class="cell">{{ p0 }}</text>
  </view>
</template>
`,
    )
    fs.writeFileSync(path.join(dir, 'router', 'auto-routes.ts'), `export const routes = [{ name: "idx", path: "pages/idx", component: "../pages/idx.vue" }]\n`)
    fs.writeFileSync(path.join(dir, 'proteus.config.ts'), `export default { pagesDir: 'pages' }\n`)
    const build = await buildAppRuntimeContent(dir, 'android')
    const artifacts = JSON.parse(fs.readFileSync(build.outFile, 'utf-8')) as Record<string, ScreenRuntimeArtifact>
    // ① 产物带泵表 + 泵源（kind:'pump'）
    expect(artifacts['idx']!.pumps, '屏产物带泵表').toHaveLength(1)
    const srcs = (artifacts['idx']!.table as { sources: Array<{ sourceName: string; sourceKind: string }> }).sources
    expect(srcs.some((s) => s.sourceName === 'p0' && s.sourceKind === 'pump'), 'p0 是 pump 源').toBe(true)

    const ops: string[] = []
    const rt = createScreenRuntime({ artifacts, applyOps: (o) => ops.push(o), viewport: { width: 390, height: 844 } })
    const inst = rt.instance('idx')
    expect(inst.pumpCount(), '泵数 1').toBe(1)
    expect(inst.pumpHzList()).toEqual([100])
    expect(inst.data()['p0'], '首帧初值 = gen.min').toBe(1)

    // ② 驱动：100Hz ⇒ 间隔 10ms。首帧累加不足 ⇒ 不触发；跨过 10ms ⇒ 触发一次并写数据源。
    const fired0 = inst.pumpTick(5)
    expect(fired0, '5ms < 10ms 间隔 ⇒ 未触发').toBe(0)
    const fired1 = inst.pumpTick(8)   // 累计 13ms ≥ 10ms ⇒ 触发
    expect(fired1, '13ms ≥ 10ms ⇒ 触发一次').toBe(1)
    const v = inst.data()['p0']
    expect(typeof v === 'number' && v >= 1 && v <= 99, `泵值在 [1,99]：${String(v)}`).toBe(true)
    // ③ 增量：泵写入触发 applyOps（既有 slot-runtime 通路）——★O(1) 源级增量，不整树重建
    expect(ops.length, '泵写入产生增量指令').toBeGreaterThan(0)
  })
})

describe('★★★"跳变驱动动画"（App 壳运行期：v-animate / <Transition> → opts.animStart）', () => {
  /** 一页含两段触发：`v-animate`（值变化）+ `<Transition>`（v-show 可见性翻转）。 */
  function makeAnimProject(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-anim-'))
    fs.mkdirSync(path.join(dir, 'router'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'pages'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'pages', 'idx.vue'),
      `<template>
  <view class="box">
    <text class="pulse" v-animate:fade="lit">{{ n }}</text>
    <view class="toggle" @tap="flip">flip</view>
    <Transition name="fade">
      <text class="panel" v-show="shown">panel</text>
    </Transition>
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue'
const n = ref(0)
const lit = ref(false)
const shown = ref(false)
function flip() { shown.value = !shown.value }
</script>
`,
    )
    fs.writeFileSync(path.join(dir, 'router', 'auto-routes.ts'), `export const routes = [{ name: "idx", path: "pages/idx", component: "../pages/idx.vue" }]\n`)
    fs.writeFileSync(path.join(dir, 'proteus.config.ts'), `export default { pagesDir: 'pages' }\n`)
    return dir
  }

  it('① v-animate：值变化 ⇒ 报 animStart（通道来自编译产物）', async () => {
    const dir = makeAnimProject()
    const build = await buildAppRuntimeContent(dir, 'android')
    const artifacts = JSON.parse(fs.readFileSync(build.outFile, 'utf-8')) as Record<string, ScreenRuntimeArtifact>
    // 产物：指令节点带 channels（预设 → 通道在编译期解析）
    const animNodes = artifacts['idx']!.tpl.nodes.filter((n) => (n as { directives?: unknown[] }).directives?.length)
    expect(animNodes.length, '模板应有 v-animate 指令节点').toBeGreaterThan(0)

    const calls: Array<{ anims: Array<{ nodeId: number; kind: number; from: number; to: number }> }> = []
    const rt = createScreenRuntime({
      artifacts,
      applyOps: () => {},
      viewport: { width: 390, height: 844 },
      animStart: (j) => calls.push(JSON.parse(j)),
    })
    const inst = rt.instance('idx')
    inst.markMounted()
    // `lit` 首值 false（falsy）⇒ 首评不播
    expect(calls.length, 'falsy 首评 ⇒ 不播').toBe(0)

    // 改 lit=true（走数据变更出口 dispatch 的同类通路——用 writeSource 直接驱动源，等价于页面数据变化）
    inst.writeSource('lit', true)
    expect(calls.length, '值变化(true) ⇒ 播一次').toBe(1)
    expect(calls[0]!.anims.length, 'fade 预设至少一条通道').toBeGreaterThan(0)
    expect(calls[0]!.anims[0]!.nodeId, '动画打在指令节点上').toBe(animNodes[0]!.id)

    // 再改回 false（falsy）⇒ 不播
    inst.writeSource('lit', false)
    expect(calls.length, 'falsy ⇒ 不播').toBe(1)
    // 再改回 true ⇒ 又播
    inst.writeSource('lit', true)
    expect(calls.length, '再次变化 ⇒ 再播').toBe(2)
  })

  it('② <Transition>：v-show 可见性翻转 ⇒ 报 animStart（enter/leave 通道）', async () => {
    const dir = makeAnimProject()
    const build = await buildAppRuntimeContent(dir, 'android')
    const artifacts = JSON.parse(fs.readFileSync(build.outFile, 'utf-8')) as Record<string, ScreenRuntimeArtifact>
    // 产物：可见性槽位（v-show）+ 过渡声明的节点
    const trNodes = artifacts['idx']!.tpl.nodes.filter((n) => (n as { transition?: unknown }).transition)
    expect(trNodes.length, '模板应有 <Transition> 规格节点').toBeGreaterThan(0)

    const calls: Array<{ anims: Array<{ nodeId: number; kind: number }> }> = []
    const rt = createScreenRuntime({
      artifacts,
      applyOps: () => {},
      viewport: { width: 390, height: 844 },
      animStart: (j) => calls.push(JSON.parse(j)),
    })
    const inst = rt.instance('idx')
    inst.markMounted()
    calls.length = 0   // 清掉挂载期的任何触发（本用例只看可见性翻转）

    // shown: false→true ⇒ 可见性翻转 ⇒ enter 通道
    inst.writeSource('shown', true)
    expect(calls.length, '可见性翻转 ⇒ 播一次').toBe(1)
    expect(calls[0]!.anims.length, 'enter 至少一条通道').toBeGreaterThan(0)

    // true→false ⇒ leave 通道
    const before = calls.length
    inst.writeSource('shown', false)
    expect(calls.length, '再次翻转 ⇒ 再播（leave）').toBe(before + 1)
  })

  it('③ 未接 animStart ⇒ 如实 note（不静默），且不炸', async () => {
    const dir = makeAnimProject()
    const build = await buildAppRuntimeContent(dir, 'android')
    const artifacts = JSON.parse(fs.readFileSync(build.outFile, 'utf-8')) as Record<string, ScreenRuntimeArtifact>
    const notes: string[] = []
    const rt = createScreenRuntime({ artifacts, applyOps: () => {}, viewport: { width: 390, height: 844 }, onNote: (n) => notes.push(n) })
    const inst = rt.instance('idx')
    inst.markMounted()
    expect(() => inst.writeSource('lit', true)).not.toThrow()
    expect(notes.join('\n'), '未接 animStart ⇒ 记 note').toContain('animStart')
  })
})

