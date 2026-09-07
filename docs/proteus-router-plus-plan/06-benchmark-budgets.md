# 路由性能预算与验收矩阵

## 1. 性能预算

| 指标 | 预算 | 测量方式 |
|------|------|---------|
| 路由解析耗时 | < 2ms | 基准测试 |
| `router.push` 调用到原生 API 调用 | < 5ms | TraceBus |
| 转场帧率 | ≥ 120fps (ProMotion) | Instruments / Systrace |
| 转场主线程耗时 | < 16ms | 各端 profiler |
| 转场内存增量 | < 5MB | MemoryPanel |
| 手势响应延迟 | < 8ms | 触控采样 |
| 冷启动 Deep Link 直达 | < 500ms | 端到端 |

## 2. 真机五端验收矩阵

| 端 | 设备 | 转场帧率 | 手势返回 | 安全区 | 玻璃 |
|----|------|---------|---------|--------|------|
| iOS | iPhone 15 Pro (灵动岛) | ≥120 | ✅ | ✅ 避让岛 | ✅ 融合 |
| 鸿蒙 | Mate 60 | ≥120 | ✅ | ✅ | ✅ |
| Android | Pixel 8 | ≥120 | ✅ SwipeBack | ✅ | ✅ |
| Web | Chrome desktop | 60 | ✅ | ✅ | ✅ |
| Skyline | 微信 8.0.49+ | ≥60 | ✅ | ✅ | ✅ backdrop-filter |

## 3. 内存验证（联动 Memory Plan G-06）

- 转场前/后内存差 < 5MB
- 快速连续 push/pop 10 次无泄漏（LeakRegistry 无残留）
- 模态 present → dismiss 后页面实例销毁（PageTeardownTransaction）

## 4. CI 门禁

```yaml
- name: router benchmark
  run: pnpm bench:router
  env:
    ROUTER_FRAME_DROP_THRESHOLD: 5  # 允许 5% 掉帧
- name: memory leak check
  run: pnpm test:router-memory
```
