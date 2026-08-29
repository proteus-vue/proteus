# Proteus DevTools 落地执行文档 — 总览

## 定位

Proteus 的"透明化"哲学落到**开发者界面**上的一份计划：把 Compiler / CLI / Types / Testing 以及运行时十层产生的 `--trace-*` 汇聚成一个可交互的调试面板。

> 前面十份计划都约定"产物可审计、trace 可追溯"，但没人定义**谁来把 trace 呈现给开发者**。DevTools 就是那个汇聚点。

## 六源汇聚架构

```
Lifecycle  ─┐
Router     ─┤
Pinia      ─┼──→ TraceBus（单一汇聚）→ DevTools UI
API        ─┤       │
Capability ─┘       ├── 时间轴（泳道）
Compiler   ─────────┤── 状态快照 / 时间旅行
                      ├── 路由回溯
                      ├── 性能火焰图
                      └── 异常根因
```

- **TraceBus**：进程内的事件总线，六层通过 `useTrace()` 上报，UI 只订阅，零耦合。
- **事件协议**：统一 `{ source, phase, name, payload, timestamp, traceId, spanId }`。
- **采样**：默认全量；生产环境按 `sampleRate` 降采样，异常自动全量（tail sampling）。

## 与其他计划的关系

| 计划 | DevTools 消费什么 |
|------|------------------|
| Lifecycle | 五阶段耗时、阶段状态 |
| Router | 导航记录、守卫耗时、`<route>` 映射 |
| Pinia | state diff、`$patch` 序列、快照导入/导出 |
| API | request/response、耗时、失败链 |
| Platform | capability 探测结果、降级路径 |
| Compiler | transform 耗时、产物映射、分包体积 |
| Testing | 快照 diff、失败录制 |
| CLI | `audit` 结果、`--explain` 执行计划 |

## 铁律

1. **TraceBus 是唯一入口**：运行时层不得直接操作 UI DOM，只通过 `useTrace()` 上报。
2. **生产零开销**：`NODE_ENV=production` 下默认关闭采集，开关由 `proteus.config.ts.devtools`。
3. **可序列化**：所有 payload 必须 JSON-safe；含 DOM/节点对象需转 handle（`{ __handle: 'node', id }`）。
4. **隐私脱敏**：自动剔除 `password/token/Authorization/idCard/phone` 字段（对齐 Pinia M7.6）。

## 里程碑

- **M1** TraceBus + 事件协议（B1）
- **M2** 六源接入（B2）
- **M3** 时间轴 + 泳道（B3）
- **M4** 状态快照 / 时间旅行（B4）
- **M5** 路由回溯（B5）
- **M6** 性能火焰图（B6）
- **M7** 异常根因分析（B7）
- **M8** 设备面板 + Skyline 能力（B8）
- **M9** 插件扩展机制（B9）
- **M10** 超级应用加固（持久化/大数据/性能预算）
- **M11** 可观测性（导出/远程/CI）
- **M12** 测试 + 迁移

## 验收

- 六层各跑一次，DevTools 面板时间轴完整呈现 6 条泳道，无遗漏事件。
- 状态快照导出 → 刷新 → 导入，应用恢复到同一 UI 状态。
- 一次导航 + 一次失败请求，根因面板能定位到具体 store action 与守卫。
- 生产包 `useTrace` 调用开销 < 0.1ms/次（微基准）。
