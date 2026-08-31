# 11 审计与性能预算

## `proteus audit glass`

新增子命令，检测：

| 检查项 | 规则 | 严重级 |
|--------|------|--------|
| 裸玻璃写法 | 页面出现 `backdrop-filter` 但非 `<pg-glass>` | warn |
| preset 一致性 | 同类场景是否复用 preset | info |
| 降级覆盖 | 所有 `<pg-glass>` 是否声明 fallback | warn |
| 性能预算 | 单页玻璃节点数 ≤ 10 | warn |
| 嵌套深度 | `<pg-glass>` 嵌套 ≤ 2 层 | error |
| 无障碍 | 是否依赖 `prefers-reduced-transparency` | info |

输出示例：
```
$ proteus audit glass
  src/pages/home.vue:42  warn  裸 backdrop-filter，建议用 <pg-glass>
  src/pages/list.vue      info  preset 'card' 出现 15 次，考虑抽取
  ✔ 0 error, 1 warning, 1 info
```

## 性能预算

| 指标 | 预算 | 测量方式 |
|------|------|---------|
| 单页玻璃节点数 | ≤ 10 | 编译期统计 |
| 嵌套深度 | ≤ 2 | IR 校验 |
| 模糊半径 | ≤ 50px | props 校验 |
| 滚动帧率 (L3) | ≥ 55fps | E2E 真机 |
| 滚动帧率 (L1) | ≥ 58fps | E2E 真机 |
| 内存增量 | ≤ 15MB | 真机 Instruments/Profiler |

对齐 Build plan「体积预算 + 性能门禁」。

## 预算超限处理

```
编译期：节点数 > 10 → warn，> 20 → error（阻断 CI）
运行时：帧率 < 阈值 → 自动降级（见 08-degradation.md）
```

## 基准测试

对齐 Blueprint 性能基线：

- 首页（navigationBar + 3 card）：目标 60fps
- 长列表（100 card）：目标 55fps+
- 弹窗（modal）：目标 60fps

每个 preset 在 5 端跑基准，结果入库 `glass-bench.json`。

## E2E 验证

对齐 Test Framework plan：

- L4 E2E：真机截图对比（iOS/鸿蒙/Android）
- 降级：强制 `?glass=force-solid` 截图
- 无障碍：`prefers-reduced-transparency` 模拟

Blueprint 关键路径含玻璃场景：`home → list`（card 列表）。
