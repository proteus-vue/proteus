# 语义编译落地（#496：p-grid 回归编译器通道）

> 本文件记录 #496 的 M1 实现与 Skyline 实测结论——01/02/04 文档的「实现现状」修订参照此文件；后续 M2（其他原语/组件退役）以此为准更新。

## 1. 为什么改方向

用户方向批评（2026-09-06，获认同）：柔性系统最初承诺「Compiler 将 p-* 语义编译为**布局约束 AST**、各端按端求解」（02-compiler-implementation.md），实际却退化成 `src/components` 手写组件 + CSS + 运行时能力探测降级——跨端差异（Skyline 无 grid/clamp/通配/style 对象/默认 column）逐补丁追不完。布局求解权应收回编译器。

## 2. 实现（compiler 语义通道）

- 模板层（template.ts `serializeSemanticGrid`）：识别 `<p-grid>`（仅页面，`isPage`）→ 产物 codegen：
  - 容器：`<view id="pgrid{index}" style="display:flex;flex-wrap:wrap;gap:{gap}px">`
  - 直接子元素逐包档位容器：`<view wx:for… class="p-grid-item …子类" style="{{pgridStyle{index}}}">`——v-for/v-if/key 指令迁移到包装层、class 合并、scope 后缀自动继承；动态 props → 警告回退运行时组件
- 脚本层（script.ts）：data 默认档（设计稿） + onLoad 屏宽近似档 + onReady SelectorQuery 实测容器宽精修 + onWindowResize 重算（onUnload 注销）
- 档位 = 整 px `flex-basis`（见 §3 实证教训）

## 3. Skyline 实测结论（五轮，均为用户复测暴露）

| # | 现象 | 根因 | 结论 |
|---|------|------|------|
| #496b | 卡片上下间距消失、标签独占行 | style **对象**绑定 Skyline 不认（仅字符串） | :style 统一字符串（`styleToString`，fluid 包） |
| #496c | 320 宽出 3 列内容宽并排 | `calc()` 百分比在 Skyline flex-basis **不可靠** | 回 px 档；列数基准 = SelectorQuery **实测容器宽**（非屏宽——页面 padding 下 px 溢出换行） |
| #496d | 中间档一列不满（拖宽后） | onLoad/onReady 不重跑，px 档停留旧小宽 | onWindowResize 实时重算 + onUnload 注销 |
| #496e | Skyline 430 下 1 列不满 | onReady 首帧 rect 不稳（测量/时机） | 产物日志 `[proteus][pgridN] w/cols/basis` + setTimeout 150ms 二次重测 |
| #496f | 最终根因 | 日志实证 `w=393.4 cols=2 basis=190.7px`（档位全对）——小数 basis 两卡+gap 恰=容器宽，Skyline 小数 px **取整方向不定**（向上→溢出 wrap 单列） | basis 一律 `Math.floor` 整 px（默认/近似/实测三处口径一致，cols×basis+gap 严格≤容器） |

**方法论沉淀**：跨端渲染引擎差异只能靠「编译器按端 codegen + 产物实证」收敛；每轮以用户复测产物为准，先出日志实证再改，禁止组件层逐补丁。

## 4. 组件状态与退役决策

- `src/components/p-grid`：**MP 产物已不引用**（语义编译在产物层展开）。Web 端仍需（CSS Grid auto-fill，真实 Vue 直跑最优）→ 标记 **Web-only + 兼容别名**，不删除；头注声明 #496。
- `p-stack`：flex 双端一致直接映射 → **保持运行时组件**（组件即最简表达，不迁语义编译）。
- `p-fit`：Skyline 无 `fit-content`/块级 inline-block → 上限 maxRatio 生效、内容宽退块宽（诚实降级）→ **保持运行时组件**（语义编译受同一平台限制，迁移无增益）。
- 未来需断点/多形态求解的原语（如分栏、masonry 类）→ 沿用 p-grid 语义编译通道。

## 5. 遗留边界（诚实清单）

- ★M3 已落地：p-fluid MP 产物 calc 线性（`calc(intercept + slope vw)`）——Skyline/WebView 均流式零运行时；clamp 边界夹取仅 Web 保留（超界屏 ±1-2px，小程序宽度域可忽略）。
- 语义编译 MVP：动态 props（非字面量 min-col-width/gap）回退运行时组件；多子项各自静态 style 警告剥离（改用 class）。
- 组件模板内 p-grid 回退运行时组件（SelectorQuery 需页面 onReady）。
