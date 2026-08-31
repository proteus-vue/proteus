# 性能预算与验收矩阵（G-35）

## 1. 性能预算

| 指标 | 预算 | 说明 |
|------|------|------|
| 配置对象内存占用 | < 10 KB | 典型配置 KB 级 |
| 启动读取 L1（同步） | < 2 ms | 不阻塞首屏 |
| 远端拉取（异步） | 不计入首屏 | 后台执行 |
| 校验耗时 | < 1 ms | Schema 校验 |
| `setConfig()` 触发重渲 | < 16 ms | 60fps |
| 远端配置缓存大小 | < 50 KB | L1 磁盘 |

## 2. 五端真机验收矩阵

| 端 | 场景 | 预期 | 验收 |
|----|------|------|------|
| Web | 启动读取 L1 | < 2ms | ☐ |
| Web | 远端更新触发重渲 | < 16ms | ☐ |
| Skyline | 启动读取 storage | < 5ms | ☐ |
| iOS | UserDefaults 读写 | < 1ms | ☐ |
| iOS | Codable 编解码 | < 2ms | ☐ |
| Android | DataStore 读写 | < 3ms | ☐ |
| 鸿蒙 | preferences 读写 | < 3ms | ☐ |
| 全端 | 非法配置降级 | 不崩溃 | ☐ |
| 全端 | 远端失败降级链 | 用缓存/默认 | ☐ |

## 3. 边界场景验收

| 场景 | 预期行为 |
|------|---------|
| 远端返回 null | 用本地缓存，不崩溃 |
| 远端超时（>10s） | 中止，用缓存 |
| 配置包含 NaN | Schema 拒绝，告警 |
| `features` key 拼错 | TS 报错（编译期） |
| 平台覆盖冲突 | 优先级：remote > platform > env > default |
| 内存不足 | L1 缓存自动清理（对接 Memory G-09） |

## 4. CI 门禁

```yaml
# .github/workflows/ci.yml
- name: App Config checks
  run: |
    pnpm proteus check config
    pnpm proteus check config --no-secrets  # CFG004
    pnpm vitest run app-config
```

**阻断条件**：
- `check config` 报 error
- `--no-secrets` 发现敏感信息
- 单元测试覆盖率 < 90%
