# 跨端断言一致性

## 问题
同一份 SFC，两端 DOM 结构不同：
- Web: `<div class="btn">`
- 小程序: `<view class="btn">`

**如果断言写结构，一份用例无法两端复用。**

## 解决方案：断言只碰"逻辑 + 状态 + 语义"

```ts
// ✅ 好：跨端通用
expect(wrapper.vm.count).toBe(1)
expect(page.data.count).toBe(1)

// ❌ 坏：端专属
expect(wrapper.find('div.btn').exists()).toBe(true)   // 小程序是 view
```

## 分层断言策略

| 层级 | Web | 小程序 | 是否共用 |
|---|---|---|---|
| 状态（Pinia） | ✅ | ✅ | ✅ 完全共用 |
| 计算属性 | ✅ | ✅ | ✅ 完全共用 |
| 事件触发 | `@vue/test-utils` | automator | **封装统一 helper** |
| DOM 结构 | happy-dom | WXML AST | ❌ 各自断言 |
| 视觉 | Playwright 截图 | automator 截图 | ❌ 各自截图 |

## 统一事件 helper

```ts
// test-core/events.ts
import { tap } from '@proteus-vue/test-core'

export async function tap(el: WebEl | MpEl) {
  if ('trigger' in el) el.trigger('click')      // Web
  else await el.tap()                            // 小程序
}
```

## 统一状态/文本读取（stateOf / textOf，决策 #204）

跨端用例的状态断言只写一份（分层断言表「状态完全共用」的落地）：

```ts
import { stateOf, textOf } from '@proteus-vue/test-core'

// ★状态：Web 读 vm.$.setupState（公开代理无 own keys，走 has/get trap）+ $data；MP 读 data 快照
// ★文本：Web wrapper.text()（渲染文本）；MP wxml 规范化（结构文本，语义近似）
expect(stateOf(webHost).count).toBe(1) // Web：vm.$.setupState.count（ref 已解包）
expect(stateOf(mpHost).count).toBe(1)  // MP：data.count
```

★Web 注意：脚本绑定在 `vm.$.setupState`（`Object.keys(vm)` 为空）；options API 数据在 `$data`；内部属性（`$`/`__` 前缀）自动排除。

## 统一测试 API（E2E 层）TestDriver（决策 #205）

一套能力接口多端自动化（能力域对照 wechatide-skill automator「意图→工具」表）：

```ts
import { createDriver } from '@proteus-vue/test-core/driver'
import type { TestDriver } from '@proteus-vue/test-core/driver'

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

- 能力接口：`navigate/reLaunch/back` · `currentPage/systemInfo` · `element(tap/input/longPress/text/value/attribute/waitFor/exists)` · `evaluate` · `screenshot` · `waitFor` · `close`
- 注入句柄 + 结构类型（PlaywrightPageLike/AutomatorMiniLike）——test-core 零硬依赖，句柄由用户或 CLI（proteus test e2e:mp）装配
- ★MP 经验内化（§05）：元素每次操作重新解析（导航后失效重查）、reLaunch 全链路最稳、断言走 currentPage/systemInfo/evaluate
- 分层衔接：组件层统一挂载（§03b）管「组件状态」，driver 管「整页交互」——组件用例用 mountComponent，E2E 用例用 TestDriver

## DOM 差异收敛点（对齐 Component plan `p-*`）

`p-*` 组件映射表是**唯一的端差异来源**，测试只校验映射结果：
- Web: `p-button` → `<button>`
- 小程序: `p-button` → `<button type="default">`

映射表本身有独立快照用例（§02），业务用例不再重复。

## 铁律
- 禁止跨端用例直接写 `div` / `view` 字面量
- DOM 断言一律下沉到 `p-*` 组件测试 + 编译快照
- 业务逻辑用例 100% 跨端复用

---
