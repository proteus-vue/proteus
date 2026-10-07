// tests/superapp-runtime.test.ts —— ★★★B1：App 壳运行期驱动（createSuperappRuntime）判据（2026-10-09）
//
// 【锁什么】壳级编排：导航到某屏 → 实例化 → `host.mount`；手势（宿主报内核 id + 链）→ 当前屏派发。
//   ★用**真编译产物**（buildAppRuntimeContent 编临时工程）+ **mock host**（记录 mount/applyOps）——
//     不依赖设备即可端到端验证"App 壳走统一运行期"这条链。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildAppRuntimeContent } from '../packages/cli/src/app-runtime-content'
import { createSuperappRuntime } from '@proteus-vue/render-backend'
import type { ScreenRuntimeArtifact } from '@proteus-vue/render-backend'

function makeTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-sar-'))
  fs.mkdirSync(path.join(dir, 'router'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true })
  // 两屏：home（点自己计数 + 点 $nav 去 detail）；detail（点返回计数）
  fs.writeFileSync(
    path.join(dir, 'pages', 'home.vue'),
    `<template>
  <view class="home" @tap="count++"><text>{{ count }}</text><view @tap="$nav('detail')"><text>去详情</text></view></view>
</template>
<script setup lang="ts">
import { ref } from 'vue'
const count = ref(0)
</script>
`,
  )
  fs.writeFileSync(
    path.join(dir, 'pages', 'detail.vue'),
    `<template><view @tap="n++"><text>{{ n }}</text></view></template>
<script setup lang="ts">
import { ref } from 'vue'
const n = ref(0)
</script>
`,
  )
  fs.writeFileSync(
    path.join(dir, 'router', 'auto-routes.ts'),
    `export const routes = [
  { name: "home", path: "pages/home", component: "../pages/home.vue" },
  { name: "detail", path: "pages/detail", component: "../pages/detail.vue" },
]
`,
  )
  fs.writeFileSync(path.join(dir, 'proteus.config.ts'), `export default { pagesDir: 'pages' }\n`)
  return dir
}

describe('★B1 · 壳级运行期驱动（createSuperappRuntime）', () => {
  it('导航挂载 + 手势派发 + $nav 导航出口', async () => {
    const dir = makeTempProject()
    const build = await buildAppRuntimeContent(dir, 'android')
    const artifacts = JSON.parse(fs.readFileSync(build.outFile, 'utf-8')) as Record<string, ScreenRuntimeArtifact>

    const mounts: string[] = []
    const ops: string[] = []
    const navTargets: string[] = []
    const host = {
      mount: (tree: string) => { mounts.push(tree); return '{"ok":true}' },
      applyOps: (o: string) => { ops.push(o); return '{"ok":true}' },
      onGesture: (cb: string) => { (host as unknown as { cb: string }).cb = cb },
    }

    const rt = createSuperappRuntime({
      artifacts, host, viewport: { width: 390, height: 844 },
      navigate: (t) => navTargets.push(t),
    })
    expect((host as unknown as { cb: string }).cb, '应注册手势回调名').toBeTruthy()

    // 挂载 home
    expect(rt.mountScreen('home')).toBe(true)
    expect(mounts.length).toBe(1)
    const tree = JSON.parse(mounts[0]!) as { viewport: unknown; nodes: Array<{ id: number }> }
    expect(tree.nodes.length).toBeGreaterThan(0)

    // 派发：home 的第一个 @tap 节点（local id）→ count++ 应生效
    const homeEv = artifacts['home']!.events[0]!
    const r1 = rt.dispatchGesture('tap', [homeEv.nodeId])
    expect(r1.handled).toBe(true)

    // 派发第二个 @tap（$nav detail）→ 导航出口收到 'detail'
    const navEv = artifacts['home']!.events.find((e) => {
      const acts = artifacts['home']!.handlers[e.handler] ?? []
      return acts.some((a) => (a as { op?: string }).op === 'nav')
    })!
    expect(navEv, 'home 应有 $nav 事件').toBeTruthy()
    rt.dispatchGesture('tap', [navEv.nodeId])
    expect(navTargets, '$nav 应交导航出口').toContain('detail')

    // 切到 detail：挂载 + 其手势
    expect(rt.mountScreen('detail')).toBe(true)
    expect(rt.current()).toBe('detail')
    const dev = artifacts['detail']!.events[0]!
    const r2 = rt.dispatchGesture('tap', [dev.nodeId])
    expect(r2.handled).toBe(true)
  })

  it('★返回保留滚动 / 前进重置（系统 App 语义）', async () => {
    const dir = makeTempProject()
    const build = await buildAppRuntimeContent(dir, 'android')
    const artifacts = JSON.parse(fs.readFileSync(build.outFile, 'utf-8')) as Record<string, ScreenRuntimeArtifact>
    let scroll = 0
    const rt = createSuperappRuntime({
      artifacts,
      host: { mount: () => '{"ok":true}', applyOps: () => '{"ok":true}',
        getScroll: () => scroll, setScroll: (o) => { scroll = o } },
      viewport: { width: 390, height: 844 },
    })
    rt.mountScreen('home')
    scroll = 300                       // 用户在 home 滚到 300
    rt.mountScreen('detail')           // 前进 ⇒ 重置
    expect(scroll, '前进应重置到 0').toBe(0)
    rt.mountScreen('home')             // 返回 ⇒ 恢复 home 的 300
    expect(scroll, '返回应恢复 home 的滚动').toBe(300)
    rt.mountScreen('detail')           // 再前进 ⇒ detail 上次的 0
    expect(scroll, '再前进 detail 应回到它上次的 0').toBe(0)
  })

  // ★★★宿主 mount 失败必须**可观测**（2026-10-08 · 用户抓出「iOS/鸿蒙背景页导航后仍是首页」）。
  //   【防什么】宿主 `mount` 是**有回执的**（`{ok:true,…}` / `{ok:false,error}`），旧实现**丢弃**它 ⇒
  //   内核建树失败（`proteus_layout_create` 返回 0）时**整屏保持旧内容却仍报 ok:true**——用户看到的是
  //   "点背景还是首页"，且无任何日志。本用例钉住：失败 ⇒ mountScreen 返 false + lastHostReply 带原话。
  it('★宿主 mount 失败 ⇒ 返 false 且 lastHostReply 暴露原话（不静默）', async () => {
    const dir = makeTempProject()
    const build = await buildAppRuntimeContent(dir, 'android')
    const artifacts = JSON.parse(fs.readFileSync(build.outFile, 'utf-8')) as Record<string, ScreenRuntimeArtifact>
    const notes: string[] = []
    const rt = createSuperappRuntime({
      artifacts,
      host: { mount: () => '{"ok":false,"error":"proteus_layout_create 失败（节点数 18）"}', applyOps: () => '{"ok":true}' },
      viewport: { width: 390, height: 844 },
      onNote: (n) => notes.push(n),
    })
    expect(rt.mountScreen('home'), '宿主回 ok:false ⇒ 不得报成功').toBe(false)
    expect(rt.lastHostReply(), '应暴露宿主原话供报告落盘').toContain('proteus_layout_create 失败')
    expect(notes.some((n) => n.includes('宿主 mount 失败')), '失败必须有 note（不静默）').toBe(true)
  })

  it('缺该屏产物 ⇒ 不挂载、明确 note（不静默）', async () => {
    const dir = makeTempProject()
    const build = await buildAppRuntimeContent(dir, 'android')
    const artifacts = JSON.parse(fs.readFileSync(build.outFile, 'utf-8')) as Record<string, ScreenRuntimeArtifact>
    const notes: string[] = []
    const rt = createSuperappRuntime({
      artifacts,
      host: { mount: () => '{"ok":true}', applyOps: () => '{"ok":true}' },
      viewport: { width: 390, height: 844 },
      onNote: (n) => notes.push(n),
    })
    expect(rt.mountScreen('nope')).toBe(false)
    expect(notes.some((n) => n.includes('nope'))).toBe(true)
  })
})
