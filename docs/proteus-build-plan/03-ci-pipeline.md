# M6 CI 矩阵 + M7 发布流程 + Security

## M6：CI 矩阵（GitHub Actions）

### 12 任务矩阵
```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  # 1. 类型检查（全 workspace）
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  # 2-4. 三端构建（矩阵并行）
  build:
    needs: typecheck
    strategy:
      matrix:
        platform: [web, mp, app]
    runs-on: ubuntu-latest
    steps:
      - run: pnpm build:${{ matrix.platform }}
      - uses: actions/upload-artifact@v4
        with:
          name: dist-${{ matrix.platform }}
          path: dist/${{ matrix.platform }}

  # 5-8. 三端测试 + 快照
  test:
    needs: build
    strategy:
      matrix:
        platform: [web, mp, app]
    steps:
      - run: pnpm test:${{ matrix.platform }}
      - run: pnpm test:compile-snapshot  # Testing plan B3

  # 9. 契约测试（跨层，Testing plan B5）
  contract:
    needs: build
    steps:
      - run: pnpm test:contract

  # 10. 体积预算检查
  size-budget:
    needs: build
    steps:
      - run: pnpm proteus audit size --budget=.proteus/budget.json

  # 11. 安全审计
  security:
    steps:
      - run: pnpm audit --prod
      - run: pnpm dlx snyk test

  # 12. 构建可观测性（M8）
  build-measure:
    needs: build
    steps:
      - run: pnpm build:web --measure
      - uses: actions/upload-artifact@v4
        with:
          name: build-metrics
          path: .proteus/metrics.json
```

### PR 门禁
- 体积预算超限 → 阻断
- 契约测试失败 → 阻断
- 快照不一致 → 需 `pnpm test:update-snapshots` 显式更新
- `proteus audit all`（CLI M3）全绿

## M7：发布流程

### Changeset（版本管理）
```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]

jobs:
  release:
    steps:
      - uses: changesets/action@v1
        with:
          publish: pnpm release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Canary 发布
```bash
# 合并前预发布，供消费方验证
pnpm changeset publish --tag canary
# 验证通过后 promotion 到 latest
pnpm changeset publish --tag latest
```

### 多包版本策略
```
packages/
  compiler/    → @proteus-vue/compiler
  cli/         → @proteus-vue/cli
  types/       → @proteus-vue/types
  ...
```
- 独立版本号（semver）
- changeset 自动推导版本 + 生成 CHANGELOG
- 内部依赖通过 workspace protocol（`workspace:*`）

### Tag 策略
- `latest`：稳定版
- `canary`：主分支每 commit
- `next`：下一个大版本预览

## Security（供应链安全）

### 依赖审计
```bash
pnpm audit --prod          # CI 阻断高危
pnpm dlx snyk test         # 深度漏洞扫描
pnpm dlx osv-scanner .     # Google OSV
```

### 签名与完整性
- npm 包：provenance 签名（`--provenance`）
- 产物：SBOM 生成（`pnpm dlx @cyclonedx/cyclonedx-npm`）
- 小程序上传：`miniprogram-ci` 用私钥签名

### Secret 管理
- CI secret 通过 GitHub Actions Secrets / Vault
- 构建期不硬编码 key（Platform plan M7.6 `encrypted` 字段走安全存储）
- `.env` 不进产物（Vite `define` 注入，treeshake 掉未用）

### 回滚策略
- 发布失败 → changeset `rollback` 自动回退上一版本
- 小程序：保留最近 3 个可回滚版本（微信后台）
- Web：CDN 版本化 + 边缘回源到上一版本

## 分批归属

- B6：M6 CI 矩阵
- B7：M7 发布（changeset/canary/tag）
- B9：M7 超级应用（见 04-super-app.md）
- 12-security：Security（可并入 B7/B9）

## 验收

- CI 全绿 ≤ 15 分钟（三端并行）
- PR 门禁阻断体积/契约/快照违规
- `changeset publish` 一键发版，CHANGELOG 自动生成
- canary → latest promotion 无手动步骤
- 依赖漏洞 24h 内告警
- 任意版本可 1 键回滚
