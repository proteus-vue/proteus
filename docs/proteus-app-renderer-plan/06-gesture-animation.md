# 06 原生手势与动画

## 1. 手势（对标 iOS UIGestureRecognizer / Android GestureDetector）

```vue
<p-view
  :gesture="[
    { type: 'pan', onUpdate: onPan },
    { type: 'tap', onEnd: onTap }
  ]"
/>
```

| 手势类型 | iOS | Android | 鸿蒙 |
|---------|-----|---------|------|
| tap | UITapGestureRecognizer | GestureDetector | TapGesture |
| pan | UIPanGestureRecognizer | PanGestureDetector | PanGesture |
| pinch | UIPinchGestureRecognizer | ScaleGestureDetector | PinchGesture |
| longPress | UILongPressGestureRecognizer | LongPressGesture | LongPressGesture |
| swipe | UISwipeGestureRecognizer | FlingGesture | SwipeGesture |

## 2. 手势在 Worklet 执行

```ts
function onPan(e: PanEvent) {
  'worklet'  // ← 标记：在 Worklet 线程执行
  translateX.value = e.translationX
}
```

- 手势回调不跨线程 → 60fps 流畅
- SharedValue 驱动 UI 直接更新

## 3. 动画系统

### 3.1 声明式（推荐）

```ts
import { withTiming, Easing } from '@proteus-vue/app-renderer'

opacity.value = withTiming(0, {
  duration: 300,
  easing: Easing.out(Easing.cubic)
})
```

### 3.2 转场

```vue
<router-view v-slot="{ Component }">
  <transition-native :name="'slide'">
    <component :is="Component" />
  </transition-native>
</router-view>
```

底层走原生转场：`UINavigationController` push / `Activity` overridePendingTransition / ArkUI 页面转场。

## 4. 与 Glass 联动

玻璃动效（如 `p-glass` 跟随滚动改变模糊强度）走 Worklet：

```ts
scroll.onUpdate((e) => {
  'worklet'
  glassIntensity.value = 20 + (e.offsetY / 10)
})
```

## 5. 性能保证

- 手势/动画**全部在 UI/Worklet 线程** → 不阻塞 JS
- 借鉴 NativeScript 的同步调用 + Reanimated 的 Worklet 思路
- 目标：复杂交互动画 ≥ 55fps
