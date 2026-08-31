# 12 分批策略（M1-M6）

> 对齐 Architecture G-01~G-30，本 plan 执行位 **G-29**，与 Component（G-06）、App Renderer（G-22）协同。

## 依赖图

```
Component (M7.x) ──▶ Glass M1（L1 组件）
Platform (能力注册表) ──▶ Glass M2（映射）
Compiler (IR) ──▶ Glass M3（IR + trace）
       ↓
Glass M4 (iOS/鸿蒙原生)
Glass M5 (audit + 性能)
Glass M6 (Website 演示)
```

## M1：L1 基础玻璃（Web + Skyline）

**目标**：`<pg-glass>` 在双端可跑，blur+tint+radius+border 一致。

**任务**：
- [ ] `pg-glass` 组件 + props schema
- [ ] Web backend（CSS）
- [ ] Skyline backend（CSS + worklet 骨架）
- [ ] preset 清单实现
- [ ] 单元测试（Vitest）

**验收**：双端 demo 页面玻璃渲染一致，快照入库。

**Prompt 模板**：
```
实现 <pg-glass> 的 Web/Skyline 后端，支持 preset/tint/radius/border/noise，
对齐 02-architecture.md Props 规范，写 Vitest 单测 + 编译快照。
```

## M2：平台映射（iOS/鸿蒙/Android）

**目标**：三端原生玻璃映射可用。

**任务**：
- [ ] iOS `UIGlassEffect` + 回退链
- [ ] 鸿蒙 `backdropBlur` + fractal（NEXT）
- [ ] Android `RenderEffect`
- [ ] CapabilityRegistry 接入

**验收**：5 端各 preset 渲染截图入库。

## M3：Compiler IR + trace

对齐 Compiler plan：
- [ ] `GlassNode` IR
- [ ] `--trace-glass`
- [ ] 产物快照 `glass-manifest.json`

## M4：降级 + 无障碍

- [ ] 三级降级
- [ ] `prefers-reduced-transparency`
- [ ] 低端机自动降级

## M5：audit + 性能门禁

- [ ] `proteus audit glass`
- [ ] 性能预算 CI 校验
- [ ] 基准测试 `glass-bench.json`

## M6：Website 演示

- [ ] Playground 实时 transform 玻璃
- [ ] 5 端效果对比页
- [ ] preset 可视化

## 每批验收（对齐既有规范）

每批 = PR + 测试 + 快照 + trace + audit 全绿，方可进下一批。

## 执行顺序要点

**M1 优先**：Web/Skyline 纯逻辑、无原生依赖，可立即跑通，
验证 `<pg-glass>` API 设计是否成立——**这是整个 plan 的风险最低起点**。
M2-M6 依赖 M1 的 API 稳定。
