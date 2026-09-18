# CI/CD 与质量门禁

> 配套：`G-44-testing-framework.md` §6 铁律

---

## 1. 分层执行

```
PR 阶段     单元 + SPI conformance          (< 3 min)
合并前     全量 conformance + 跨层集成       (< 15 min)
发布前     E2E 矩阵 + 性能基准回归          (< 30 min)
```

---

## 2. 质量门禁（阻断合并）

| 门禁 | 条件 | 依据 |
|------|------|------|
| G-44.2 | 任一 Backend conformance FAIL | 铁律 |
| G-44.3 | 跨层集成 FAIL（无跳过） | 铁律 |
| G-44.5 | 性能基准退化 > 5% | 铁律 |
| G-44.6 | 失败报告缺 trace | 铁律 |
| AI005 | Agent 产物未过 TestBackend | G-23 |

---

## 3. 性能基准

- 基准值固化在 `.proteus/benchmark.json`
- 每次跑 `proteus test --bench`，对比基准
- 退化 > 5% 自动开 issue，需 Owner 确认

---

## 4. 报告归档

- 每次 CI 产出 `test-report.json`（SuiteReport 标准格式）
- 上传至 DevTools 面板，可对比历史趋势
- **跨层集成**结果单独高亮（这是体系正确性的核心指标）

---

## 5. 本地等价命令

```bash
proteus test              # 跑全部 Backend
proteus test --backend node,jsi
proteus test --layer integration   # 仅跨层
proteus test --bench
```

---

*编排脚本由 `testing-reference.js` 的 `ConformanceRunner` 实现，可直接接入 GitHub Actions / GitLab CI。*
