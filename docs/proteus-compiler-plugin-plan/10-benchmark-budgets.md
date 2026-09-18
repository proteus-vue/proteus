# 性能预算与可观测性（G-21）

> 对齐全局性能预算原则，插件是**可观测的开销单元**。

## 一、预算阈值

| 指标 | 阈值 | 触发 |
|------|------|------|
| 单钩子/文件 | 500ms | warn + 跳过（soft）/ error（fail-fast） |
| 单插件/全量构建 | 2s | warn（Top N 报告） |
| 全部插件总开销 | ≤ 20% 总编译时 | CI 门禁 warn |
| 插件数量 | ≤ 30（建议） | > 30 warn（组合复杂度） |

## 二、可观测性：TraceBus 上报

每个钩子调用自动上报：
```ts
traceBus.emit('plugin:hook:start', { plugin, hook, file, ts });
traceBus.emit('plugin:hook:end',   { plugin, hook, file, duration, cached });
```

DevTools (G-19) 消费 → 可视化插件顺序、耗时、产物 diff。

## 三、报告示例

```bash
$ proteus build --profile-plugins

Plugin Performance Report
========================
plugin                      parse   transform   codegen   post    total
@proteus-vue/plugin-i18n    12ms    340ms       8ms       0ms     360ms
proteus-plugin-permission     3ms     45ms       0ms       0ms      48ms
proteus-plugin-analytics      0ms      0ms       120ms     8ms     128ms

[warn] proteus-plugin-analytics codegen=120ms (>100ms budget)
[info] total plugin overhead: 536ms (14% of 3.8s build)
```

## 四、真机/构建验收矩阵

| 端 | 验证项 | 预算 |
|----|--------|------|
| Web | 插件不破坏 HMR 增量 | 增量 < 200ms |
| Skyline | 插件产出的 WXML 合法 | 构建成功 + 预览通过 |
| iOS/Android/Harmony | codegen 产物编译通过 | 原生工程构建成功 |

## 五、CI 门禁

```yaml
- run: proteus build --profile-plugins --junit plugin-report.xml
- run: proteus build --strict-plugin
# 阻断：PLG 错误 / 超时 / 预算超
```

## 六、验收

- [ ] 预算阈值触发正确（warn/error）
- [ ] TraceBus 上报完整（DevTools 可查）
- [ ] `--profile-plugins` 报告准确
- [ ] 五端构建验收通过
