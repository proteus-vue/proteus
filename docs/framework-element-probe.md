# 框架元素探针（Framework Element Probe）—— 跨端 E2E 的元素信息降级通道

> 2026-09-14 落地。解决「自动化工具查不到自定义组件内部节点」导致的一整类**测试盲区**。

## 1. 问题（真机实证）

自动化工具（wechatide / miniprogram-automator）**只能查页面拥有的节点**：

| 尝试 | 结果 |
|---|---|
| `wx.createSelectorQuery().select('.p-scroll-view')`（页面级） | **null** —— 组件内部节点查不到 |
| `page.selectComponent('p-scroll-view')` | false |
| `page.selectAllComponents('.x')` | **0**（Skyline 下**该 API 不存在**） |
| 页面 own slot 内容（`<p-scroll-view>` 里写的 `<view>`） | ✅ 可达 |

**后果**：本轮 scroll-view 横向 bug（容器 `height` 缺失 → 塌成细线）**两轮漏检**——
子项量得到（页面 own）、容器量不到（组件内部），而缺陷恰在容器。

## 2. 解法：测量必须从**组件内部**发起

组件自己能拿组件作用域（`.in(this)`），于是：

```
组件 ready()  →  wx.createSelectorQuery().in(this).select(根选择器).boundingClientRect()
              →  写全局注册表 globalThis.__PROTEUS_PROBES__[pid] = { pid, tag, rect, ts }
测试        →  driver.probes()（底层 automation_evaluate）读同一 JS 上下文
```

**关键**：测试读的是 **框架产出的数据**，不经工具的元素查询——所以工具的隔离限制不再是障碍。

## 3. 组成

| 层 | 位置 | 职责 |
|---|---|---|
| **注册表** | `packages/runtime/src/probe.ts` | `recordProbe/readProbes/clearProbes/probeEnabled`（跨端、纯 JSON） |
| **组件注入** | `packages/compiler/src/script.ts` `probeReadyCode()` | 组件 `ready()` 内自测量（`.in(this)`，根选择器 = `.<tag>-<scopeId>`） |
| **页面复位** | 同上 `probeResetLine` | 页面 `onLoad` 复位注册表（同页 key 稳定）；`debug` 构建下**默认开启**探针 |
| **测试驱动** | `packages/test-core/src/driver/{mp,web}.ts` | `driver.probes(pid?)` / `driver.enableProbes()`（双端同 API） |
| **框架 API 回落** | `packages/api/src/capability.ts` `createElementQuery` | `useElement` 查不到时回落读注册表（**框架 API 也能读组件内部**） |

## 4. 门控（零成本）

探针**编译期总是注入**，**运行时**门控：

- 组件声明了 `pid`（显式要可观测）→ 采集
- 或全局 `__PROTEUS_PROBE_ALL__ = true`：
  - 测试：`driver.enableProbes()`
  - 构建：`PROTEUS_DEBUG=1 pnpm run build:mp`（**测试/调试构建默认开启**）

生产构建 + 无 pid → 组件 `ready` 里一句 `if` 直接 return（零开销）。

## 5. 用法

```ts
// E2E（真机）
const driver = createDriver({ platform: 'mp', mini })
await driver.enableProbes()
await driver.reLaunch('/pages/xxx')
const probes = await driver.probes()                       // 全部
const one = await driver.probes('my-scroll')               // 指定 pid
expect(one[0].rect!.height).toBeGreaterThan(20)            // 组件**内部**几何断言
// 或用断言原语（推荐）：assertProbeScrollable / assertProbeGeometry / assertProbeVisible

// 框架 API（应用代码）
const el = useElement()                                    // C58
const r = await el.boundingClientRect('my-scroll')         // 查不到 → 自动回落探针
```

## 6. 诚实边界

- **只测框架声明要测的**（组件根节点），不是任意 DOM 抓取——契约稳定，但不是全量 DOM 快照
- **读到的是框架在组件内测出的值**，不是工具直读的同一渲染层数据（时序：`ready` + 150ms 二次重测兜底首帧未稳）
- **修不了原生手势**：横向滑动/fling 这类原生交互仍须页面方法调用或真机手动验证
- **组件必须编译期经过 Proteus 编译器**才会注入探针（手写原生组件不覆盖）

## 6.5 断言原语（`@proteus-vue/test-core`）

探针把数据送到测试侧后，配套**契约化断言**（`probe-assert.ts`）——把「几何/可见/可滚」变成可复用门禁：

```ts
import { assertProbeScrollable, assertProbeGeometry, assertProbeVisible, getProbe } from '@proteus-vue/test-core'

await assertProbeScrollable(driver, pid, 'x')          // ★内容溢出 → 真的可横向滚
await assertProbeGeometry(driver, pid, { minHeight: 20 })  // 高度不塌陷
await assertProbeVisible(driver, pid)                  // display/visibility/opacity 均可见
const rec = await getProbe(driver, pid)                // 原始记录（rect/scroll/style）
```

**为什么关键**：`assertProbeScrollable` 是本轮 bug 的**直接判据**——
`scrollWidth > width` 才叫可滚。容器 `height` 缺失时，实测探针给出 `height: 2.1px`（=「一条线」），
断言立即红并打印精确数字；而**工具元素查询根本无法表达这个断言**。

**破坏性验证**（已入 CI）：把 `height` 删掉 → `assertProbeGeometry` 报
`height 2.09 不满足 min 20`；恢复 → 绿。另有一条反向用例：对纵向容器用 `x` 轴断言 → **如实抛「不可滚」**（证明断言有判别力，不是恒真）。

## 6.9 运行方式（spec 项目感知）

`e2e:mp` 默认全家桶在 **examples**（内部测试全家桶）上跑；而**组件对齐 spec**（`e2e-mp-components` /
`e2e-mp-probe`）打的是 **showcase**（对外演示小程序）的分包页。两份 spec 都带**项目感知**：

```ts
function projectHasRoute(route) { /* 读 app.json 的 pages/subPackages */ }
const HAS_SCROLL_PAGE = projectHasRoute('subpackages/components/pages/p-scroll-view')
describe.skipIf(!ENABLED || !HAS_SCROLL_PAGE)(...)
```

→ 目标项目无该页时**跳过**（而非全红）——测试自身可移植。

| 目标 | 结果 |
|---|---|
| `test e2e:mp examples`（canonical） | smoke + vue-compat + popover 通过；组件/探针 spec **跳过**（examples 无 showcase 分包页） |
| `test e2e:mp showcase` | 组件 + 探针 spec 通过（`e2e-vue-compat` 等 **pre-existing** 需 examples 页，与本通道无关） |

## 7. 回归锁

- `tests/runtime-probe.test.ts`（6 例）：注册表读写/清理/门控/空 pid 防护/键稳定
- `tests/p-batch2-contract.test.ts`：编译器注入契约（探针在 ready、`.in(this)`、根选择器带 scopeId、规则可关）
- `tests/e2e-mp-probe.test.ts`（真机 2 例）：探针读到**工具查不到**的组件内部几何；清空注册表 → 读数归零（破坏性）

## 8. 与既有能力的关系

- **不是**替代 `useElement`（C58）——是它的**回落后端**；工具能查到的仍走工具
- **不是**替代 test-core driver 的元素 API——是 `driver.probes()` 这个**新通道**
- 与 `devtools` 的组件元素 registry 同宗（那里面向面板高亮，这里面向**测试断言**）
