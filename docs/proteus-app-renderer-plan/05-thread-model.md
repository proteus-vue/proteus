# 05 线程模型

## 1. 三线程架构

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  JS 线程     │────→│  UI 线程     │────→│  Worklet 线程 │
│  diff/逻辑   │ JSI │  视图操作    │ 共享│  手势/动画   │
└─────────────┘     └─────────────┘     └─────────────┘
                        │
                        ▼
                   Native 渲染树
```

| 线程 | 职责 | 禁止 |
|------|------|------|
| JS 线程 | diff、状态、网络 | 直接操作 View |
| UI 线程（主线程） | 所有 View 操作 | 耗时计算 |
| Worklet 线程 | 手势、动画、转场 | 网络 IO |

## 2. 跨线程规则

**铁律 A-05**：跨线程访问必须显式标注。

```ts
// ✅ 正确：自动派发到 UI 线程
native.updateProp(viewId, 'opacity', 0.5)

// ✅ 正确：Worklet 中直接执行
runOnUI(() => { ... })

// ❌ 错误：JS 线程直接操作 View（会抛警告）
// view.setAlpha(0.5)
```

## 3. 数据传递

- **JS → UI**：JSI 同步调用（零序列化）
- **UI → JS**：回调注册（事件）
- **Worklet 共享**：通过 SharedValue（借鉴 Reanimated）

```ts
import { useSharedValue, withTiming } from '@proteus-vue/app-renderer'

const opacity = useSharedValue(1)
opacity.value = withTiming(0.5, { duration: 300 })  // 直接在 UI 线程执行
```

## 4. 手势系统

```ts
// 手势在 Worklet 线程处理，60fps 不掉帧
gesture.onUpdate((e) => {
  'worklet'
  opacity.value = 1 - e.translationY / 300
})
```

手势状态机：POSSIBLE → BEGIN → ACTIVE → END / CANCEL。

## 5. 性能预算

| 指标 | 目标 |
|------|------|
| JS→UI 调用延迟 | < 1ms（JSI 保证） |
| 一帧 diff+commit | < 8ms |
| 长列表滚动 | ≥ 55fps |
| UI 线程阻塞 | < 16ms |

详见 `10-audit-performance.md`。
