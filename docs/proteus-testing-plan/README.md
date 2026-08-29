# Proteus Testing Infrastructure

> **★实现状态（2026-08）**：✅ 已实现——四层金字塔测试体系（L1 单元 508 个 + L2 集成快照 + 跨层契约 + e2e 8 个），CI 门禁（stores 铁律/能力体系/模板快照）；本规划文档为蓝图。

> 透明编译框架的统一测试基建 —— 四层金字塔 + 三端矩阵 + 跨层契约

## 防撑爆规则（必读）

每份 `.md` = 一个独立上下文单元。LLM 执行单批时**只加载**：
- `00-overview.md`（本档定位 + 关系表）
- 当前批次对应的 1-2 份模块文档
- `11-execution-batches.md`（取该批 Prompt 模板）

**禁止一次加载全部 13 份。**

## 目录

```
00-overview.md            架构 + 铁律 + 里程碑 + 依赖
01-m1-unit.md             L1 单元测试
02-m2-component.md        L2 组件测试
03-m3-compile-snapshot.md L3 编译产物快照
04-m4-e2e-real-device.md  L4 E2E 真机
05-m5-cross-layer-contract.md 跨层契约（核心）
06-m6-super-app.md        stress / 内存 / 稳定性
07-m7-observability.md    traceId + 失败录制
08-m8-audit-gate.md       audit --fix + CI 门禁
09-migration.md           从现有测试迁移
10-ci-matrix.md           GitHub Actions 矩阵
11-execution-batches.md   分批 + Prompt 模板
```

## 快速定位

| 你想做 | 看哪份 |
|--------|--------|
| 理解整体 | 00-overview |
| 写单测 | 01 |
| 测组件/Transform | 02 |
| 快照回归 | 03 |
| 真机 E2E | 04 |
| 验证层间接口 | 05 |
| 性能压测 | 06 |
| 排查失败 | 07 |
| CI 门禁 | 08, 10 |
| 迁移旧测试 | 09 |
| 执行分批 | 11 |
