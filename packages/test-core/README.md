# @proteus-vue/test-core

Proteus 测试核心（test-framework M3 + B7 + 统一测试 API）——L1-L3 标准件。

## 能力

| API | 说明 |
|-----|------|
| `createMockContext(options?)` | **唯一 wx 来源**：wx 全局 mock（storage/router/ui 内存实现 + vi.fn 可断言）+ Page/Component/App 构造器捕获 + getApp/getCurrentPages + 内存存储。`afterEach` 调 `cleanup()` 恢复全局 |
| `mountMpComponent(sfc, options?)` | SFC → 真实编译（`compileVueSfc`）→ 执行逻辑层 JS → 返回 `{ instance, wxml, js, context, config }`——**逻辑 + WXML 双断言**（不真实渲染，真机行为下沉 L4）；★方法已摊平（组件 methods + 页面顶层函数绑定实例），setData 合并进 data（真实语义） |
| `mountComponent(sfc, { platform: 'web' \| 'mp' })` | **统一挂载**：同一份 SFC → Web（@vue/test-utils 真实渲染，需 happy-dom 环境）或 MP（逻辑层归一化 host：instance 摊平 + wxml 顶层暴露）——配合 `stateOf`/`textOf`/`tap` 跨端复用同一份断言 |
| `createDriver({ platform: 'web' \| 'mp', page/mini })` | **统一测试 API（E2E 层）**：一套 `TestDriver` 能力接口（navigate/reLaunch/back · currentPage/systemInfo · element · evaluate · screenshot · waitFor）→ web（注入 playwright Page）/ mp（注入 automator miniProgram）；能力域对照 wechatide-skill automator「意图→工具」表；零硬依赖（结构类型 + 注入句柄） |
| `mountWebComponent(sfc)` / `sfcToComponent(sfc)` | Web 分支底层：SFC → 组件对象（compileScript + compileTemplate 双段编译 + esbuild 剥离 TS + __VUE__ 注入执行）→ mount |
| `stateOf(host)` / `textOf(host)` | **统一断言**：状态读取（Web `vm.$.setupState`+`$data` / MP `data` 快照）与文本读取（Web `wrapper.text()` / MP wxml 规范化）——06 铁律：状态跨端完全共用、DOM 各自断言 |
| `tap(el, selector?)` / `isWebElement` / `isMpElement` | 统一事件分发（Web `trigger('click')` / 小程序 automator `tap()`）+ 类型守卫 |

## 使用

### MP 逻辑 + WXML 双断言

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { createMockContext, mountMpComponent } from '@proteus-vue/test-core'

describe('p-button 逻辑 + WXML', () => {
  let ctx: ReturnType<typeof createMockContext>
  afterEach(() => ctx?.cleanup())

  it('渲染 + disabled 态', () => {
    const { instance, wxml, context } = mountMpComponent(`
      <template><button class="p-btn" :disabled="disabled">{{ label }}</button></template>
      <script setup>
      import { ref } from 'vue'
      const disabled = ref(true)
      const label = '确认'
      </script>
    `)
    expect(wxml).toContain('button') // 结构断言
    expect(instance.data).toHaveProperty('disabled', true) // 逻辑断言
    // wx 断言（唯一来源）
    context.wx.storage.setStorageSync('k', 1)
    expect(context.wx.storage.getStorageSync('k')).toBe(1)
  })
})
```

### 统一测试 API：同一份 SFC 双端挂载 + 跨端复用断言

```ts
// @vitest-environment happy-dom  ← 必须（esbuild TextEncoder instanceof 检查在 jsdom 跨 realm 崩）
import { describe, it, expect } from 'vitest'
import { mountComponent, stateOf, textOf, tap } from '@proteus-vue/test-core'

const COUNTER = `<script setup lang="ts">
import { ref } from 'vue'
const count = ref(1)
const label = 'counter'
function increment() { count.value++ }
</script>
<template><view><text>{{ label }}: {{ count }}</text><button @click="increment">+1</button></view></template>`

describe('双端同一断言', () => {
  it('状态断言只写一份（06 分层断言）', async () => {
    const web = await mountComponent(COUNTER, { platform: 'web' })
    const mp = await mountComponent(COUNTER, { platform: 'mp' })
    for (const host of [web, mp]) {
      expect(stateOf(host).count).toBe(1)
      ;(host as any).vm?.increment?.() ?? (host as any).increment()
      expect(stateOf(host).count).toBe(2)
    }
  })
})
```

★Web 分支注意：increment 后同步读 `stateOf` 已变（ref 同步），但渲染更新在微任务队列——文本断言前需 `await host.vm.$nextTick()`。

### 统一测试 API（E2E 层）：一套能力接口多端自动化

```ts
// ★注入句柄：playwright page / automator miniProgram 由用户或 CLI（proteus test e2e:mp）装配
import { createDriver } from '@proteus-vue/test-core/driver'
import type { TestDriver } from '@proteus-vue/test-core/driver'

// 跨端业务用例：只碰统一能力接口（不写 page./mini. 平台 API）
async function runShared(driver: TestDriver): Promise<void> {
  await driver.reLaunch('/pages/index')
  const btn = driver.element('button')
  await btn.waitFor()
  await btn.tap()
  expect((await driver.currentPage()).path).toContain('pages/index')
  expect((await driver.systemInfo()).platform).toBeTruthy()
  await driver.screenshot()
}

const web = createDriver({ platform: 'web', page })   // playwright Page
const mp = createDriver({ platform: 'mp', mini })     // automator miniProgram
await runShared(web)
await runShared(mp)
```

★能力域对照 wechatide-skill automator：`automation_navigate → navigate/reLaunch/back`、`automation_runtime_info → currentPage/systemInfo`、`automation_element_action → element(tap/input/longPress/text/value)`、`automation_evaluate → evaluate`、`simulator_screenshot → screenshot`、`waitForSelector/wait → waitFor`。★MP 经验内化：元素每次操作重新解析（导航后失效重查）、reLaunch 是全链路最稳通道。

## 铁律（03-component-integration.md + 06-cross-platform-assert.md）

- 测试环境只 mock wx，禁止真实引用
- 小程序用例只校验"逻辑 + WXML"，不校验视觉样式
- `createMockContext` 是唯一 wx 来源
- 跨端用例只碰逻辑/状态/语义，DOM 差异各自断言（06 铁律）
