# M7 超级应用加固 + M8 可观测性

## M7：超级应用构建优化

### 并行构建
```ts
// 三端完全独立，天然并行
await Promise.all([
  buildPlatform('web'),
  buildPlatform('mp'),
  buildPlatform('app'),
])

// 单端内部：按分包并行
const subPackages = Object.keys(config.subPackages)
await Promise.all(
  subPackages.map((name) => buildSubPackage(name)),
)
```

### 分布式构建（超大项目）
- 分包多到数十个时，单机编译耗时过长
- 方案：turbo + 远程缓存 + 任务编排
  ```json
  // turbo.json
  {
    "tasks": {
      "build": {
        "dependsOn": ["^build"],
        "outputs": ["dist/**"],
        "cache": true
      }
    }
  }
  ```
- 每个分包 = 一个 turbo task，跨机器并行，命中缓存跳过

### 体积预算（CI 门禁）
```json
// .proteus/budget.json
{
  "global": {
    "maxTotalSize": "2MB",
    "maxInitialSize": "500KB"
  },
  "packages": {
    "trade": "300KB",
    "user": "200KB"
  },
  "assets": {
    "maxImageSize": "100KB",
    "maxFontSize": "150KB"
  }
}
```
- `proteus audit size --budget=.proteus/budget.json`
- 超限 → CI 失败 + 报告指出哪个 chunk 超标

### 确定性构建（可复现）
- 目标：相同源码 + 相同依赖 = 完全相同字节的产物
- 措施：
  - 固定 `lockfileVersion`
  - 剔除时间戳/随机值（source map 内联 source 路径规范化）
  - 内容哈希命名（`assets/[name].[hash].js`，hash 仅依赖内容）
  - CI 用固定 Node 版本 + Docker 镜像
- 价值：CDN 缓存命中、审计可复现、供应链攻击检测

### 构建性能预算
| 指标 | 预算 |
|------|------|
| 冷构建（全量） | < 5 分钟 |
| 增量构建（单文件改动） | < 10 秒 |
| 缓存命中率 | > 90% |
| 主包 JS gzip | < 500KB |
| 分包 JS gzip | < 300KB |

## M8：可观测性

### --measure 输出
```bash
pnpm build:web --measure
# → .proteus/metrics.json
```
```json
{
  "platform": "web",
  "duration": 42300,
  "phases": {
    "compile": 12000,
    "bundle": 18000,
    "optimize": 8000,
    "package": 4300
  },
  "chunks": [
    { "name": "shared/vue", "size": 65000, "gzip": 23000 },
    { "name": "pages/home", "size": 12000, "gzip": 4500 }
  ],
  "cacheHitRate": 0.92,
  "timestamp": "2026-08-29T10:00:00Z"
}
```

### 与 DevTools TraceBus 互通
- Build 的 `--measure` JSON 结构对齐 DevTools `BuildMetric` 事件
- DevTools UI 可直接展示"构建耗时时间轴"（DevTools plan B6 火焰图）
- 本地开发：`vite --debug build` 实时输出阶段耗时

### CI Dashboard
- 每次构建上传 `metrics.json` 到存储（S3/GCS）
- 仪表盘展示：体积趋势 / 构建时长趋势 / 缓存命中率
- 回归检测：体积突增 > 10% 自动 comment 到 PR

### 失败诊断
- 构建失败时，自动收集：
  - 完整错误栈
  - 相关源码片段（source map 定位）
  - 依赖树（`pnpm why`）
- 输出 `build-failure.json`，供 DevTools "错误根因"面板消费（DevTools plan B7）

## 分批归属

- B9：M7 超级应用（并行/分布式/预算/确定性）
- B10：M8 可观测性（--measure/CI dashboard）

## 验收

- 三端并行构建，总耗时 ≈ 单端耗时（不叠加）
- 分包 > 20 个时分布式构建线性加速
- 体积预算超限精准定位 chunk
- 两次构建字节完全一致（确定性）
- `--measure` 输出被 DevTools 正确展示
- 构建失败可一键复现
