# 分批执行策略

## 分批原则（沿用全局）

- 单批 = 1 PR，≤ 3 个文件，可独立 review
- LLM 单次只喂 `00-overview + 当前模块 + 直接依赖`
- 每批交付：代码 + 单测 + 一份 ADR + 验收清单

## 批次

### B1 — TraceBus 骨架（地基，无依赖）
**输入**：`00-overview.md`, `01-m1-trace-bus.md`
**产出**：`@proteus-vue/devtools-runtime` 包骨架 + `TraceBus` + `useTrace` + 采样 + 脱敏 + 环形缓冲
**验收**：emit noop 开销 < 0.1ms；redact 单测全绿
**依赖**：无（仅 Types 事件类型）

### B2 — 六源接入
**输入**：`02-m2-6-sources.md`, `00-overview.md`
**产出**：六源 `install*(bus)` 函数 + 事件清单
**验收**：mock 六层对象，bus 缓冲分组条数正确；traceId 跨源一致

### B3 — 时间轴泳道
**输入**：`03-m3-timeline.md`, `01-m1-trace-bus.md`
**产出**：span 构建 + 泳道 UI + 虚拟滚动 + canvas 降级
**验收**：万级 span 200ms 内首屏；点击定位源码

### B4 — 状态快照与时间旅行
**输入**：`04-m4-state-snapshot.md`, `02-m2-6-sources.md`
**产出**：snapshot export/import + `$patch` 记录 + timeTravel
**验收**：导出→刷新→导入状态一致；1000 步回放 < 1s

### B5 — 路由回溯
**输入**：`05-m5-route-backtrack.md`, `02-m2-6-sources.md`
**产出**：NavRecord 采集 + 路由树 UI + 守卫瀑布
**验收**：redirect/cancel 场景还原正确

### B6 — 性能火焰图
**输入**：`06-m6-perf-flamegraph.md`, `03-m3-timeline.md`
**产出**：火焰图渲染 + 对比模式 + 预算线
**验收**：5000 span < 100ms；regression 识别正确

### B7 — 异常根因
**输入**：`07-m7-error-rootcause.md`, `02-m2-6-sources.md`
**产出**：错误链构建 + 根因面板 + 复现脚本
**验收**：401 场景根因指向 token 刷新

### B8 — 设备面板
**输入**：`08-m8-device-panel.md`, `02-m2-6-sources.md`
**产出**：环境信息 + Skyline 能力表格 + 资源曲线 + 真机连接
**验收**：能力状态与 `isSupported()` 一致

### B9 — 插件扩展
**输入**：`09-m9-plugin-extension.md`, `01-m1-trace-bus.md`
**产出**：PluginRegistry + PanelAPI + 沙箱 + 3 个内置插件
**验收**：第三方插件加泳道不污染核心；循环依赖报错

### B10 — 超级应用加固 + 可观测 + 测试迁移
**输入**：`10-m7-super-app.md`, `11-m8-observability.md`, `12-testing-migration.md`
**产出**：持久化 + 降级 + 远程上报 + SessionBundle replay + 四层测试 + codemod
**验收**：30 分钟稳定性 + CI budget 全绿 + 存量迁移 ≤ 10 行

## Prompt 模板

```
你正在实现 Proteus DevTools 的 [B?]。
只读以下文件（其余视为不存在）：
- proteus-devtools-plan/00-overview.md
- proteus-devtools-plan/[当前模块].md
- proteus-devtools-plan/[直接依赖模块].md（如有）
- 对应的运行时层计划（如 B2 → proteus-lifecycle-plan/...）

约束：
1. 遵循 00-overview 的四条铁律
2. 函数 ≤ 80 行，文件 ≤ 500 行
3. 每个公共 API 写单测
4. 产物需能被 `--trace-transform` 定位源码
5. 不要实现本批范围外的内容，标记 TODO 即可

产出：包代码 + 单测 + ADR + 验收清单。
```

## 进度追踪

| 批 | 模块 | 状态 | PR |
|----|------|------|-----|
| B1 | TraceBus | ✅（2026-08，@proteus-vue/devtools-runtime：协议/环形缓冲/脱敏/采样/零开销门控，8 用例） | — |
| B2 | 六源接入 | ✅（2026-08，lifecycle + componentRender 两源示范，type-only 注入，6 用例；router/store/api/capability/compiler 同模式后续） | — |
| B3 | 时间轴 | ⬜ v1.0+（面板 UI） | — |
| B4 | 快照/时间旅行 | ⬜ v1.0+ | — |
| B5 | 路由回溯 | ⬜ v1.0+ | — |
| B6 | 火焰图 | ⬜ v1.0+ | — |
| B7 | 根因 | ⬜ v1.0+ | — |
| B8 | 设备面板 | ⬜ v1.0+ | — |
| B9 | 插件 | ⬜ | — |
| B10 | 加固+可观测+测试 | ⬜ | — |
