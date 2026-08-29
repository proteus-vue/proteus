# 分批执行策略

## 防撑爆规则
每批 = 1 PR = LLM 单次 ≤ 3 文件。按此文档喂料：
- 该批对应模块文档 (01-10)
- 00-overview.md (定位)
- 本文件 (Prompt 模板)

## 批次

| 批 | 内容 | 依赖 | 文件 |
|----|------|------|------|
| B1 | M1 单元测试 (vitest + mock) | 无 | 01 |
| B2 | M2 组件 + Transform | 无 | 02 |
| B3 | M3 编译快照 | Compiler M3 | 03 |
| B4 | M4 E2E | Cli dev | 04 |
| B5 | M5 跨层契约 (核心) | 所有层稳定 | 05 |
| B6 | M6 超级应用加固 | B1-B4 | 06 |
| B7 | M7 可观测 | B1 | 07 |
| B8 | M8 audit + CI | Cli M3, Types M2 | 08, 10 |
| B9 | 迁移 + 收尾 | 全部 | 09 |

## Prompt 模板 (B1 示例)
```
你正在实现 Proteus Testing M1 (L1 单元测试)。
只读：00-overview.md, 01-m1-unit.md, 11-execution-batches.md (B1 段)。
产出：vitest 配置 + test/setup.ts + capability mock 工具。
约束：不读 wx/window 真实 SDK；所有平台 API 走 mock。
```

## 依赖图
B1 ┬→ B2 → B3 → B6
   └→ B7
B4 (需 Cli)
B5 (需全部稳定，放最后)
B8 (需 Cli + Types)
B9 (收尾)

## 进度追踪
- [ ] B1 单元
- [ ] B2 组件
- [ ] B3 快照
- [ ] B4 E2E
- [ ] B5 契约
- [ ] B6 加固
- [ ] B7 可观测
- [ ] B8 门禁
- [ ] B9 迁移
