# Proteus 应用生命周期管理 — LLM 落地执行文档

> 版本对齐：Proteus v2.47 · Vue 3.4+ · Skyline (glass-easel) · 基础库 2.29.2+
> 配套计划：Pinia / Router / API / Component / Platform / Module

## 一、这份文档解决什么

前面六份文档（Pinia / Router / API / Component / Platform / Module）各自定义了"做什么"和"怎么做"，
但**谁来编排它们的初始化顺序**一直没有定义。本计划定义 Proteus 的 **App Lifecycle Layer**：

- 统一三端（Web / Skyline / App）的应用级 + 页面级 + 组件级生命周期
- 把启动拆成**可编排的阶段（Phase）**，而非 4 个黑盒钩子
- 每个阶段可异步、可超时、可降级、可追踪（`--trace-lifecycle`）
- 编译期映射到各端原生生命周期，**产物可审计**

## 二、设计原则（铁律）

1. **阶段化 > 钩子数量**：`bootstrap → coreReady → navigationReady → beforeFirstPaint → interactive`
2. **顺序即契约**：阶段依赖关系固定，不允许业务乱序初始化
3. **超时保护**：每阶段可配超时，超时后降级而非卡死整个 App
4. **冷热分离**：`onLaunch` 区分冷启动 / 热启动 / 恢复（recover）
5. **错误隔离**：单层失败不影响其他层，走 `onError` + 降级策略
6. **可追踪**：`--trace-lifecycle` 输出 `phase → 耗时 → 结果` 链
7. **透明编译**：每个阶段的三端映射在编译产物里可见

## 三、目录结构

```
proteus-lifecycle-plan/
├── README.md                     ← 本文件
├── 00-overview.md                ← 架构、铁律、阶段总览、里程碑
├── 01-m1-phases.md               ← 阶段定义 + defineApp API
├── 02-m2-orchestrator.md         ← LifecycleOrchestrator 编排器
├── 03-m3-web-mapping.md          ← Web 端映射
├── 04-m4-skyline-mapping.md      ← Skyline 端映射（重点）
├── 05-m5-app-mapping.md          ← App (Native) 端映射
├── 06-m6-page-component.md       ← 页面级 + 组件级生命周期
├── 07-m7-reliability.md          ← 超级应用加固（超时/隔离/恢复）
├── 08-m8-observability.md        ← trace + DevTools + CI 审计
├── 09-testing-migration.md       ← 测试矩阵 + 迁移 + 分批策略
└── 10-execution-batches.md       ← 分批 Prompt 模板
```

## 四、防止上下文撑爆

- 每份 `.md` = 一个独立上下文单元
- 每批（Batch）= 一个 PR = LLM 单次 ≤ 3 个文件
- 执行时只喂 `README + 00-overview + 当前模块 + 直接依赖`
- 永远不把 10 份全塞进一次对话

## 五、与其他计划的关系

```
Lifecycle（本次）  ← 总开关，编排以下所有层
  ├─ Platform  (capability 探测)
  ├─ Pinia     (store 创建 + hydrate)
  ├─ API       (request + auth)
  ├─ Module    (模块 init)
  ├─ Router    (路由解析 + 分包)
  └─ Component (全局组件挂载)
```

依赖方向：Lifecycle B1/B2 最先稳定 → 其他层在其阶段钩子里注册初始化逻辑。

## 六、快速导航

| 你想做什么 | 看哪个文件 |
|-----------|-----------|
| 理解整体架构 | `00-overview.md` |
| defineApp API 用法 | `01-m1-phases.md` |
| 启动顺序编排 | `02-m2-orchestrator.md` |
| Skyline 特殊处理 | `04-m4-skyline-mapping.md` |
| 页面/组件生命周期 | `06-m6-page-component.md` |
| 启动性能/容灾 | `07-m7-reliability.md` |
| 分阶段执行 | `10-execution-batches.md` |
