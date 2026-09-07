# 11 分批策略（B1-B3）

> 执行位：**G-21（Compiler CSS 处理管线）**，与 Compiler（B1）、Component（布局语义）、Glass（L3）、App Renderer（Renderer）协同。
> 优先级：B1 可与 G-01 地基三联同期启动（纯逻辑、零依赖、可单测）。

## 一、里程碑

### B1：CSS 校验 + 重写原型（Compiler 内）

**目标**：跑通 `--strict-css` + 编译期重写，验证「统一语义」哲学可落地。

**范围**：
- postcss / css-tree 解析 SFC `<style>`
- `02-strict-css-lint.md` 全部规则（CSS001-012）
- `03-compile-time-rewrite.md`：calc / vh / rgba → ARGB / 选择器展开
- `--css-compat-report` 输出
- 单测：违规检测 + 自动修复

**验收**：
- 给定含 `float`、`*`、裸 `backdrop-filter` 的 SFC → 报错码准确
- `proteus compile --fix` 正确重写 calc/vh/rgba
- 报告 JSON 结构符合 09 定义

**Prompt 模板**：
```
在 Compiler 包新增 CSS 处理管线（G-21, B1）：
1. 接入 postcss，遍历 SFC <style> AST
2. 实现 --strict-css 校验（CSS001-012，报错码见 02）
3. 实现编译期重写（calc/vh/rgba/选择器，见 03）
4. 产出 css-compat-report.json（结构见 09）
5. 单测覆盖：每个报错码一个 case + 每个重写规则一个 case
不实现 Renderer 映射（B2），只产出 Style IR。
```

### B2：Style IR → 五端 Renderer

**目标**：Style IR 被各端 Renderer 消费，原生属性正确下发。

**范围**：
- `05-five-end-mapping.md` 全部映射表
- Web：CSSOM 赋值
- Skyline：WXSS + 原生组件样式
- App：iOS/Android/鸿蒙 JSI 属性赋值（接 App Renderer）
- `<p-glass>` `<p-sticky>` `<p-scroll>` `<p-shadow>` `<p-bg-gradient>` 映射（04）

**验收**：
- 同一份 SFC 在五端渲染**结构/语义一致**（允许原生视觉差异）
- DevTools 三栏对照（源 → IR → 产物）
- 真机矩阵采集 FSP（见 10）

### B3：优化 + CI 门禁

**目标**：预算落地 + CI 卡口 + DevTools 可视化。

**范围**：
- `10-benchmark-budgets.md` 全部指标 + `check-css-report.mjs`
- 接入 `consistency.yml`
- DevTools「编译透明」样式面板
- 语义组件占比激励（>=70%）

**验收**：
- CI 门禁阻断违规 PR
- 预算超阈值报警
- 性能预算回归防护（对接 Performance plan）

## 二、依赖关系

```
B1 (校验+重写)  ──→  B2 (五端 Renderer)  ──→  B3 (CI + DevTools)
   ↑                  ↑                        ↑
   │                  │                        │
Compiler B1       App Renderer M2-M3       consistency.yml
                   Component (p-* 语义)
                   Glass (p-glass 映射)
```

**关键路径**：B1 不依赖任何运行时，**可立刻开工**，是验证原则 #10 最快的最小原型。

## 三、与全局执行序的关系

- G-01~G-03（Types/Compiler/Platform 地基）稳定后启动 G-21
- **B1 可与 G-01 部分并行**：CSS 校验是纯 AST 变换，不依赖 Renderer 落地
- Memory plan（G-24）的 Style IR 生命周期需在 B2 阶段对齐（IR 对象复用/销毁）

## 四、风险与缓解

| 风险 | 缓解 |
|------|------|
| Skyline/ArkUI transform 差异导致动画不一致 | B2 阶段逐个能力验收，超纲的 rotate/skew 走原生动画 API |
| calc 复杂表达式无法编译期求值 | 报错 + 引导用 `p-*` 语义组件，不硬撑 |
| 选择器展开导致产物膨胀 | 配合 scoped + 摇树，监控 IR 对象数（10 的预算） |
| 业务改造阻力 | 提供 `--fix` 自动修复 + 迁移指南（06 §七） |

## 五、验收总表

| 里程碑 | 核心交付 | 验证方式 |
|--------|---------|---------|
| B1 | `--strict-css` + 重写 + 报告 | 单测 + 违规 SFC 样例 |
| B2 | 五端 Renderer 映射 | 真机五端渲染对照 |
| B3 | CI 门禁 + DevTools | PR 阻断 + 面板可视化 |

全部完成 → CSS 跨端兼容性方案落地，原则 #10 在样式层闭环。
