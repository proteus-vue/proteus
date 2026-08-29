# Proteus 内置组件规划

> **目标**：为 Proteus 提供一套 **Web + 微信 Skyline（glass-easel）双端语义一致**的内置组件，遵循"编译透明化 + AI 可读"原则。
> **范围**：P0 = 基础组件 + 高频业务组件（≤5 个）
> **首期重点**：兼容与原生映射（Web DOM ↔ Skyline 原生能力）

---

## 为什么需要

Proteus 已有 Pinia（状态）、Router（路由）、API（接口）三层规划，但**缺少"跨端 UI 原语层"**：
- 业务直接写 `div/view` 会绕过 Skyline 优化（如全局滚动、recycleManager）
- antd-mini / Vant 等是"样式库 + WebView 假设"，非 Skyline 满血
- `<a-config>`、全局播放条等"全局挂载一次"能力需要组件层 + Router/appBar 协同

本规划补齐这一层，且与前三层**共用同一套架构哲学**：
> 规则模块化、产物可审计、AI 可读可改、降级显式不静默。

---

## 架构速览

```
L4  业务页面
L3  @proteus/components { Base, Business }
L2  Runtime { capability, web, skyline, app }
L1  平台原生（DOM / Skyline / Native）
```

铁律（详见 `00-overview.md`）：
- C1 优先映射原生能力，不为写法一致牺牲性能
- C3 组件不含业务逻辑（数据走 `api`，状态走 Pinia）
- C5 每个组件一份 `IR → 双端产物` 映射，纳入 `--trace-transform`
- C6 降级显式 `warn`，禁止静默失效

---

## 文档导航

| 文件 | 内容 |
|------|------|
| `00-overview.md` | 目标/原则/四层架构/里程碑/验收 |
| `01-component-matrix.md` | **P0 首期重点**：Props/事件/插槽三端对照矩阵 |
| `02-platform-capability.md` | 能力探测 + 降级策略 |
| `03-base-components.md` | 基础组件 IR 模板 + P0 首批 |
| `04-business-components.md` | 业务组件（含全局挂载机制）|
| `05-worklet-animation.md` | Worklet 动画/手势/转场映射 |
| `06-m7-performance.md` | 超级应用加固：长列表/内存/渲染 |
| `07-m8-observability.md` | trace/错误边界/DevTools/CI 审计 |
| `08-testing-migration.md` | 测试矩阵 + codemod |
| `09-execution-batches.md` | 8 批执行策略 + LLM Prompt |

---

## P0 组件清单

**基础（Base）**：`p-view` `p-text` `p-image` `p-scroll-view` `p-list-view` `p-input` `p-button` `p-swiper` `p-mask` `p-popup` `p-toast` `p-nav-bar`

**业务（Business，≤5）**：`p-player-bar`（appBar 全局） `p-payment-sheet` `p-login-gate` `p-error-boundary` `p-skeleton`

---

## 与既有层的关系

| 层 | 职责 | 组件层依赖 |
|----|------|-----------|
| Pinia | 状态 | 组件只读 store，不内聚全局态 |
| Router | 路由 | `p-nav-bar`/`p-player-bar` 用 appBar；转场共用枚举 |
| API | 接口 | 业务组件只 emit，由页面调 `api.*` |
| **Component（本规划）** | UI 原语 | 顶层，依赖上述三层 |

四层共用：`traceId` + `--trace-*` + `proteus audit` → 统一 Observability。

---

## 执行顺序建议

1. **先稳定下层**：Pinia M1-M2 → Router B1-B5 → API A1
2. **再起组件 B1**：capability + 渲染抽象（地基，可并行但风险自担）
3. **按 B1→B8 推进**，每批 = 1 PR，LLM 单次 ≤ 24k tokens
4. **M7/M8 留到最后**：等基础组件稳定后再做性能/可观测加固

---

## 范围外（明确不做）
- 覆盖所有 UI 样式库（对标 antd-mobile 全套）
- 跨小程序厂商抹平（支付宝/抖音，架构预留不承诺）
- 纯 CSS 主题皮肤包（独立 `theme` 规划）
- 3D/WebGPU 组件（属 Babylon 集成层，另立规划）

---

## 状态
- v1 Draft：架构 + 矩阵 + 分批已定
- **v2 落地评估（2026-08，`11-landing-evaluation.md`）**：对照当前代码库现实修正 —— ① 取消「L2 渲染器目录」（组件 = 标准 SFC + 既有编译管线）；② 命名统一 `p-` 前缀（virtual-list 兼容保留）；③ 批次重排 B1-B8（B4/B5/B6 中依赖 appBar/Worklet/支付的部分降级或移出 P0 首期）；④ 能力探测改轻量 runtime 模块（不全局注入）
- 待确认：`chunk` 默认值策略（按目录自动推断 vs 显式声明）
