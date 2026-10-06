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
})
