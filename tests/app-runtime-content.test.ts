// tests/app-runtime-content.test.ts —— ★★★B1：App 端「运行期屏内容」产物测试（2026-10-09）
//
// 【锁什么】`buildAppRuntimeContent`（packages/cli/src/app-runtime-content.ts）**真的**为每屏产出
//   运行期编译产物（`tpl`/`table`/`events`/`handlers`/`data`）——这是「App 壳走统一运行期」的地基：
//   没有 `events`/`handlers` 就点不动，没有 `table` 就没有响应式，没有 `data` 就没有源初值。
//
// 【为什么用临时工程（而不是读现成产物）】断言的是"编译行为"，不是"某次产物碰巧对"——
//   临时工程给出**已知输入**（一个带 `@tap` 自增 + 插值的页面），才能断言"事件/源确实被编出来"。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildAppRuntimeContent } from '../packages/cli/src/app-runtime-content'

/** 造一个最小 App 工程（router/auto-routes.ts + pages/*.vue + proteus.config.ts） */
function makeTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-rt-'))
  fs.mkdirSync(path.join(dir, 'router'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true })
  // 页面：`count` 初值 + `@tap` 自增 + 插值显示（⇒ 事件 + handler + L1 订阅源都应被编出）
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
    `export const routes = [
  { name: "idx", path: "pages/idx", component: "../pages/idx.vue" },
]
`,
  )
  fs.writeFileSync(path.join(dir, 'proteus.config.ts'), `export default { pagesDir: 'pages' }\n`)
  return dir
}

describe('★B1 · App 运行期屏内容产物（buildAppRuntimeContent）', () => {
  it('① 每屏产出 tpl/table/events/handlers/data，且事件与源被真编出', async () => {
    const dir = makeTempProject()
    const r = await buildAppRuntimeContent(dir, 'android')
    expect(r.ok).toBe(true)
    expect(r.compiled).toBe(1)

    const art = JSON.parse(fs.readFileSync(r.outFile, 'utf-8'))
    const page = art['idx']
    expect(page, '应产出 idx 屏').toBeTruthy()
    // tpl：有节点 + 根
    expect(Array.isArray(page.tpl.nodes) && page.tpl.nodes.length > 0, 'tpl.nodes 非空').toBe(true)
    expect(Array.isArray(page.tpl.roots) && page.tpl.roots.length > 0, 'tpl.roots 非空').toBe(true)
    // events：`@tap` 被编成一条绑定
    expect(Array.isArray(page.events) && page.events.length >= 1, 'events 至少 1 条（@tap）').toBe(true)
    expect(page.events[0].event === 'tap', 'event 名为 tap').toBe(true)
    // handlers：存在命名 handler，且动作能改源（set/add）
    const handlerNames = Object.keys(page.handlers)
    expect(handlerNames.length >= 1, 'handlers 非空').toBe(true)
    const acts = handlerNames.flatMap((k) => page.handlers[k])
    expect(acts.some((a: { op?: string }) => a.op === 'set' || a.op === 'add'), 'handler 含 set/add 动作').toBe(true)
    // data：初值快照含 count
    expect('count' in page.data, 'data 快照含 count').toBe(true)
  })

  it('② 缺 router/auto-routes.ts ⇒ 明确报错（不静默）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-rt-empty-'))
    await expect(buildAppRuntimeContent(dir, 'android')).rejects.toThrow(/auto-routes/)
  })
})
