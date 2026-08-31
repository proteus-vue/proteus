# CLI 构建流水线

## 1. 多 Target 并行编译

```
src/ + proteus.config.ts
    ↓ Compiler（per target）
    ├─ Web       → Vite/Rollup → dist/
    ├─ Skyline   → SFC → WXML+WXSS
    ├─ iOS       → IR → AOT + JSI binding + .xcodeproj → .ipa
    ├─ Android   → IR → AOT + JSI binding + Gradle → .apk/.aab
    └─ Harmony   → IR → AOT + JSI binding + DevEco → .hap
```

每个 target 复用同一份 IR，只换后端（原则 #10）。

## 2. 原生工程自动同步

`.proteus/{ios,android,harmony}/` 由 CLI 根据 `proteus.config.ts` **自动生成并持续同步**：

- iOS：Xcode 工程（BundleId/TeamId/Capability）
- Android：Gradle（applicationId/signingConfigs）
- 鸿蒙：DevEco（bundleName/abilities）

开发者**不直接修改 `.proteus/`**（可删可重建），原生配置回到 `proteus.config.ts`（单一事实源）。

## 3. CI/CD 模板

`.github/workflows/release.yml`：
- `proteus check --strict`（CSS/Style/Router/CLI 全量）
- `proteus build --targets all`
- 产物归档（五端 artifacts）

## 4. 性能预算

| 指标 | 预算 |
|------|------|
| `create` 冷启动 | < 10s |
| 增量构建（单文件） | < 2s |
| 全量五端构建 | < 5min |
| 原生工程同步 | < 3s |
