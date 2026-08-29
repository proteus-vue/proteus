# CI 矩阵 (GitHub Actions)

## 1. 矩阵维度
- Node: 18, 20
- OS: ubuntu-latest, macos-latest (小程序 E2E)
- 端: web, mp, app(host)
- 层: 7 运行时 + 4 基建

## 2. Job 拆分
- `lint`：ESLint + audit
- `unit`：L1 矩阵 (web/mp/app × node 版本)
- `component`：L2
- `compile-snapshot`：L3
- `e2e-web`：Playwright
- `e2e-mp`：macos + miniprogram-ci (可选)
- `contract`：C1-C10
- `perf-budget`：性能预算

## 3. 缓存
- pnpm store
- vitest 快照缓存
- turbo remote cache (可选)

## 4. 产物
- coverage: Codecov
- junit: GitHub Actions summary
- 快照 diff: PR 评论

## 5. 验收
- [ ] PR 全矩阵 < 15min
- [ ] 失败 job 可快速定位
- [ ] 小程序 E2E 有降级标记
