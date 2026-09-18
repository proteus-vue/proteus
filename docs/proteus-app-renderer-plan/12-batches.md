# 12 分批策略与 Prompt 模板

> 执行位 **G-22**（组件体系 G-06 之后，Testing G-07 之前）。对齐 `proteus-architecture` G-01~G-28。

## 1. 里程碑

| 批次 | 内容 | 依赖 | 产出 |
|------|------|------|------|
| M1 | JSI 骨架 + 首个 View 创建 | Types B1 | 能同步创建 UIView |
| M2 | Custom Renderer 骨架 | Compiler IR | diff/commit 跑通 |
| M3 | 基础组件映射（04 上半） | Component | p-view/text/image |
| M4 | 布局/列表 + 长列表优化 | Module | ≥ 55fps |
| M5 | 手势/动画 Worklet | — | 原生手势 |
| M6 | Glass L3 对接 | Glass plan | UIGlassEffect 真机 |
| M7 | 类型自动生成 | Types | SDK → .d.ts |
| M8 | 降级 + 审计 + CI | Testing | audit app 绿 |

## 2. 关键路径

```
M1(JSI) → M2(Renderer) → M3(组件) → M4(列表) → M5(手势) → M6(Glass)
                                                       ↘ M7(类型) → M8(审计)
```

M1 是最该优先验证的——它决定整条链路是否成立。

## 3. Prompt 模板（喂 LLM 用）

### B1：JSI 骨架

```
你在实现 Proteus App Renderer 的 JSI 绑定骨架（M1）。
目标：从 JS 同步调用 Native，创建首个 UIView/View。
约束：对齐 02-native-binding.md 的 Host Object 接口。
产出：C++ HostObject + Swift/Kotlin 注册 + JS 入口。
验收：JS 调用 createView('UIView') 返回 viewId，Native 侧 View 出现在视图树。
```

### B2：Custom Renderer

```
你在实现 Vue 3 Custom Renderer（M2）。
目标：把 IR 节点 diff 成 Native 指令序列。
约束：对齐 03-renderer-pipeline.md，nodeOps 调 JSI bridge。
产出：createRenderer 配置 + diff/commit 流程。
验收：<p-view> 渲染为原生 View，updateProp 同步生效。
```

### B3：Glass L3

```
你在对接 Glass 系统级能力（M6）。
目标：<pg-glass preset="regular"> 在 iOS 真机走 UIGlassEffect。
约束：对齐 07-glass-l3-integration.md + proteus-glass-plan。
产出：invokeCapability('glass') + 版本守门 + 降级。
验收：iOS 26 真机出现系统玻璃，iOS 17 降级 blur。
```

## 4. 验收门槛（G-22 完成定义）

- [ ] JSI 骨架跑通（M1）
- [ ] `p-view` / `p-text` / `p-image` 映射可用（M3）
- [ ] Glass `regular` 在 iOS 真机走 `UIGlassEffect`（M6）
- [ ] 长列表 1000 条 ≥ 55fps（M4）
- [ ] `proteus audit app` 通过（M8）
- [ ] 三端（Web / Skyline / App）同一 SFC 渲染一致
