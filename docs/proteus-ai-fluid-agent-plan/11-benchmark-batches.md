# 性能预算与分批

## 质量门禁

| 指标 | 目标 |
|------|------|
| Agent 迁移合规率（FLD + StyleSafety） | 100% |
| 单文件 scan 耗时（1k LoC） | < 200ms |
| suggest + verify 端到端 | < 2s |
| 生成代码运行时开销 | 0（p-* 编译期为原生映射） |

## 人工对照基准（示例）

| 任务 | 人工 | Agent |
|------|------|-------|
| 迁移 100 个硬编码宽度页 | ~8h | ~3min（含 verify） |
| 合规率（FLD 通过） | ~90%（易漏） | 100%（门禁强制） |

## 验收矩阵

- Web/Skyline：clamp 生成后响应式验证（320/768/1440 三档）；
- iOS/Android/鸿蒙：p-grid 列数自适应 + 折叠屏切换；
- DevTools：Inspector 显示 LayoutConstraint，一键应用后 HMR。

## 分批

- **B1**：scanHardcodedWidth + suggestFluidProp（纯逻辑，可单测，对齐 G-22 clamp 算法）；
- **B2**：applyFluidRefactor + verifyViaCompilerPlugin（接 G-21 Plugin）；
- **B3**：CLI `proteus ai fluidize` + IDE CodeLens；
- **B4**：DevTools 协同 + 对话式生成；
- **B5**：审计/回滚/CI 门禁。

## 单测用例

```
width:320px @ 断点[375,768,1440] → p-fluid="width(280,480)"  ✓
320px 匹配 token --card-max       → p-fluid="var(--card-max)" ✓
verify 失败产物                    → 拒绝 apply ✓
跨文件 rename                     → 升为人工审批 ✓
```
