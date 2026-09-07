# 07 · p-popover Skyline 悬浮层专项（立项设计）

> 2026-09-07 真机/模拟器实证 + 决策草案。配套台账：`docs/proteus-test-framework-plan/15-mp-e2e-console-gate.md`
> 「p-popover MP 专项」行；组件降级哲学见 `docs/proteus-component-semantics-plan/degradation.md`。

## 1. 问题定义

`p-popover`（G-32 B4 shell.popover）在 **MP Skyline** 打开后**视觉不渲染**：
触发链路全通（`onTrigger` → `triggerEvent('update-modelValue', true)` → 页面 data 已变 true），
但面板 + 关闭 layer 均不可见 → **静默失败**（违反 degradation.md「禁止该端默默失败」）。

## 2. 已排除/已实证（勿重复试错）

| 通道 | 结果 |
|---|---|
| 事件：slot 内 p-button 点击 → onTrigger | ✅ 通（探针：`onTrigger FIRED`；glass-easel 插槽边界不挡事件） |
| 事件：组件 → 页面 v-model 回写 | ✅ 通（page data 正确变化） |
| 结构① fixed 兄弟 layer + absolute 锚定面板（非 fixed 根） | ❌ 视觉不渲染 |
| 结构② 同①但面板改 fixed 固定坐标（inline style，spike V1） | ❌ 无任何视觉 |
| 结构③ 同①外包 `<root-portal>`（官方同层，spike V2） | ❌ 无任何视觉 |
| 参照系：p-drawer/p-modal/p-popup/p-action-sheet（**面板在 fixed 全屏容器内**） | ✅ 渲染+命中+动画全部正常 |
| ★2026-09-07 深挖：页面级 root-portal/plain fixed 标记 | ✅ 均渲染（V3） |
| ★组件 json 补 `componentFramework: glass-easel` 后，p-popover 内**常驻** root-portal 内容 | ✅ 渲染（V4 绿块可见） |
| ★同上但 portal 内容在 `wx:if` 内（真实浮层形态） | ❌ 仍无视觉——glass-easel 下 portal+wx:if 挂载疑仍异常 |

**根因方向**：skyline/glass-easel 下「锚定型悬浮层」（fixed 兄弟层 + 脱离 fixed 容器的
absolute 面板 / 动态坐标）可靠性不足；同类可靠组件全部满足**「组件内 fixed 全屏容器包裹内容」**。
p-popover 的面板必须锚定在 trigger 旁 → 无法直接套用 fixed 容器模式。

## 3. 候选路线

### A. 官方同层机制（root-portal / scene 语义）——中远期
- 编译器原生标签表已登记 `root-portal`（tags.ts），官方 skyline 语义为「整棵子树脱离页面，类 fixed，
  专用于弹窗/弹出层」（基础库 2.25.2+，Skyline+WebView，`enable`/`externalClass` 属性）。
- ★2026-09-07 里程碑 1 达成：**组件 json 缺 `componentFramework: glass-easel` 是 portal 在组件内失效的根因**
  ——gen-routes 只给页面加了该声明，组件漏加；修复后组件内**常驻** portal 内容渲染 ✅（V4）。
- 仍卡点：portal 内容包在 `wx:if`（真实显隐形态）内不渲染；下一步候选：a) portal 外层常驻 + 内部
  visibility/类切换（对齐 p-drawer 常驻模式）；b) 页面级 portal 用法核对；c) glass-easel 对 wx:if 子树
  与 portal 交互的官方限制。

### B. 动态定位（selectorQuery 测量 + 动态坐标）——中风险
- 触发后测 trigger rect（组件内 `wx.createSelectorQuery().in(this)`）→ 面板按坐标渲染。
- 制约：① Skyline 动态 style/动态数据坐标可靠性存疑（p-popup 定位早证「动态 style 不可靠」，
  面板定位最终靠静态类）；② 坐标不可能静态化 → 与已收敛的「静态类」模式冲突；③ 组件内平台
  API 使用需过 no-platform-api 审计。
- 结论：**不推荐作为主路线**，仅作 A 落地后的坐标补充。

### C. 形态降级（@conditional）——短期合规
- 遵循 degradation.md：p-popover 在 skyline 端显式**编译期剔除/替换**，不静默渲染空层。
  可选形态：骨架占位 + 提示 / 条件 fallback 到父受控简单浮层（开发者自选）。
- 语义损失：popover 锚定气泡在 MP skyline 暂不可用（Web/WebView 不受影响——同 p-modal
  anchor-popover 形态 Web-only 先例）。

### D. 保持现状 + 文档声明（已登记）——最小动作，非终态

## 4. 建议

1. **短期（本专项收口）**：走 C 的轻量版——p-popover 增加编译期/文档声明：skyline 端锚定
   气泡暂不支持（显式降级提示，禁静默）；demo 页相应标注。**待用户拍板**（语义取舍涉及产品决策）。
2. **中期（A 立项）**：以「官方 root-portal 页面级用法实证」为第一里程碑（需官方文档 + 页面级
   最小复现）；通过后再评估 B 坐标通道。

## 5. 终案（2026-09-07 真机/模拟器全部验证通过 ✅）

1. **gen-routes 组件 json 补 `componentFramework: glass-easel`**（Skyline）：此前只给页面加——组件内
   悬浮/portal 渲染依赖它（V4 实证）。
2. **p-popover 浮层结构终案**：**弃 `wx:if` 与 `<root-portal>`**，改**常驻 overlay + visibility 类切换**
   （对齐 p-drawer 常驻模式）：
   - `wx:if` 子树在 glass-easel 下不可靠（多轮实证不渲染）；
   - `root-portal` 可渲染但**脱离树破坏锚定**（面板落左上角，portal 内容脱离后 containing block 丢失）；
   - 常驻 overlay + `.p-popover-overlay--on` visibility（含方向性过渡保留显隐）→ **气泡锚定正常 + 遮罩点关正常**。
3. 真机/模拟器最终状态：触发 → 气泡现于按钮下 ✅；点外关闭 ✅；定位/关闭/产物契约（P8d）全部锁定。

## 6. 已知限制与后续（P2）

- **skyline 层叠**：popover 面板（absolute）按 DOM 序绘制——若页面在 popover 之后有与其重叠的内容，会盖住气泡；
  layer（fixed）正常上浮（点外关闭不受影响）。Web 无此问题（z-index 正常逃逸）。
- 尝试「根 z-index: 1000」无效（skyline 非 fixed 根不参与页面层叠提升，已回撤）。
- **P2 后续方案 A**：打开时组件内 `wx.createSelectorQuery` 测 trigger rect → 面板改 `position: fixed` + 坐标 px
  （面板随 fixed 上浮到最上层）。需过 no-platform-api 审计，排期另定。
- 使用建议（skyline）：popover 所在行之后避免紧跟重叠交互内容，或置于区块/页面靠后位置。

## 7. 决策存档（历史）

原建议 ①短期 C 显式降级 ②中期 A 官方同层实证——实际执行合并路线：A 调研 + componentFramework 修复 + 结构终案，
未走 C 降级（无需）。Web 端不受影响（portal 标签移除后 Web 结构即常驻 overlay + visibility，行为一致）。
