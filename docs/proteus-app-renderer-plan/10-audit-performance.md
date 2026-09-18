# 10 审计与性能预算

## 1. proteus audit app

```bash
proteus audit app
```

输出（对齐 Blueprint 审计体系）：

```
✓ Native 指令覆盖率     98% (245/250)
✓ JSI 同步调用延迟       avg 0.4ms / p95 0.8ms
✓ 帧率（长列表 1000条）  58fps
✓ 内存峰值              142MB
✓ 首帧时间              320ms
✓ 线程阻塞              < 16ms
✗ 未映射组件            p-waterfall (见 04)
```

## 2. 性能预算

| 指标 | 预算 | 措施 |
|------|------|------|
| JS→UI 调用延迟 | p95 < 1ms | JSI 保证 |
| 一帧 diff+commit | < 8ms | 指令批处理 |
| 长列表滚动 | ≥ 55fps | Cell 复用（03） |
| 首帧（冷启动） | < 500ms | 懒加载 + 预编译 |
| 内存峰值 | < 150MB | View 复用池 |
| UI 线程阻塞 | < 16ms | Worklet 卸载 |

## 3. DevTools 可视化

TraceBus 记录每条 JSI 调用：

```ts
traceBus.emit('jsi:call', {
  method: 'createView',
  args: ['UIView'],
  durationMs: 0.2,
  thread: 'ui'
})
```

DevTools 面板展示：调用瀑布流 / 帧耗时分布 / 内存曲线。

## 4. 真机测试矩阵

| 设备 | 系统 | 必测 |
|------|------|------|
| iPhone 15 | iOS 26+ | Glass L3 / 手势 |
| iPhone SE | iOS 17 | 降级 L1 / 性能 |
| 华为 Mate | HarmonyOS NEXT | Glass fractal |
| 小米旗舰 | Android 14 | Glass / 动画 |
| 低端机 | Android 10 | 降级 / 内存 |

## 5. 性能回归检测

- 每次 PR 跑 `proteus audit app --compare baseline.json`
- 指标劣化 > 5% → 阻断合并（对齐 Architecture CI 门禁）
- Baseline 随版本更新

详见 `proteus-test-framework`（L4 E2E 真机测试）。
