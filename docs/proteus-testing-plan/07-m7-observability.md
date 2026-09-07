# M7 — 可观测性 (traceId + 失败录制)

## 1. traceId 统一传播
- 测试上下文注入 traceId
- 失败用例 → 全链路日志聚合

## 2. 失败录制 (replay)
- 失败 fixture 序列化为 JSON
- 附带 traceId + 环境信息
- 本地一键重放：`proteus test --replay <file>`

## 3. 测试 Dashboard
- vitest --reporter=junit → 聚合
- 三端覆盖率合并 (v8 + istanbul)
- 快照漂移告警（超 10% 变更需审批）

## 4. 与运行时统一
- 测试 traceId 格式 = 运行时 traceId (API M8)
- `--trace-test` 输出 = `--trace-transform` 子集

## 5. 验收
- [ ] 每个失败用例有 replay 包
- [ ] 覆盖率报告三端合并
- [ ] CI 上传 junit + coverage
