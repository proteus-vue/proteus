# Proteus Session Memory（会话记忆）

> 跨会话交接用的精简记忆。每次收尾把「成果 / 教训 / 待办 / 环境」追加到顶部一节。
> 详细台账：`docs/proteus-test-framework-plan/15-mp-e2e-console-gate.md`（页面健康台账 + 实证教训）、
> `docs/proteus-semantic-primitives-plan/07-popover-skyline-floating-special.md`（popover 专项）。

## 2026-09-07 · 弹层族 Skyline 回归（当日收尾）

### 成果（全量 vitest 2544/2544 绿；HEAD 306df623 已推送；工作区干净）

- **弹层族 5 组件 skyline 全部验证通过**：p-drawer（左/右定位 + 遮罩点关）、p-action-sheet、
  p-modal、p-popup（底部定位 + 滑入滑出动画）、p-popover（锚定 + 开关 + 遮罩）
- **框架修复①**：`packages/plugin-vite/src/gen-routes.ts`（writeComponentJsons）给**组件 json 补
  `componentFramework: glass-easel`**（此前只给页面加 → 组件内悬浮/portal 全不渲染，V4 实证）
- **框架修复②**：实证编译器「模板内动态拼接类字面量」插 scope 后缀插半截
  （`'x--' + phase` → 产物 `---data-v-x` 畸形类**永不命中**）——弹层位置/动画丢失根因
- **p-popover 终案**：浮层**弃 `wx:if` 子树**（glass-easel 不渲染）与 **`root-portal`**（脱离破锚定
  → 面板左上角），改**常驻 overlay + visibility 类切换**（对齐 p-drawer 常驻模式）
- **自动化固化**：15 号门禁 0-7 链路（进页先 console 零错门禁）；产物契约探针
  `tests/compiler-mp-probe.test.ts` P7/P8（17 项，含 drawer 双分支/popup 静态类/popover 终案结构）
- **官网**：`website/guides/22-skyline-render-constraints.md`（Skyline 渲染约束与组件写法）+ EN overlay；
  **`check:en-drift`（双语 zh/en 结构漂移门禁）已挂入 root `verify` 链**

### 已知限制 / 待办

- **P2**：p-popover skyline 层叠——面板(absolute)按 DOM 序绘制，会被**其后**内容遮挡（layer fixed
  正常上浮，点外关闭不受影响）；方案 = 组件内 `createSelectorQuery` 测 trigger rect → 面板
  `position: fixed` + 像素坐标（需过 no-platform-api 审计）。Web 无此问题。文档见 07 §7。
- **巡检待办**：mp-semantics-demo / forms / fluid-system-demo 页面按门禁链路过，扩大健康台账

### 教训（当天 3 次同因）

1. **交互异常先「重编译页面 / 重启开发者工具」再动代码**——当日 3 次（p-popup 动画、右抽屉关不掉、
   `uv_cwd ENOENT` 预览失败）全是陈旧 IDE 进程/产物假象
2. `get_simulator_console` **漏抓运行时 console.log**（GUI Console 可见）——探针判定看 GUI 或状态断言
3. **自动化边界**：wechatide 元素树无自定义组件内部节点、无页面坐标点击 → 渲染命中层 bug 需一次性
   人工实证，结论用**产物契约测试**（P7/P8）固化，回归 vitest 拦
4. 官网内容改动提交前必须跑 `check:en-drift`（已入 verify 链，不再漏）

### 环境备忘

- Electron 版开发者工具：`/Volumes/data1/applications/wechatwebdevtools.app`（wechatide CLI，client=zed）
- MP 产物：`examples/dist/mp-weixin`；**每次 `build:mp` 后须重写**
  `dist/mp-weixin/project.private.config.json` 为 `{"setting":{"skylineRenderEnable":true}}` 锁 skyline
- 编译后页面常回退 `pages/index` → 二次 `simulator_open_page` + sleep 8 再 evaluate
