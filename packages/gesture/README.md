# @proteus-vue/gesture

> **G-32 B4 ④ 手势原语**（`docs/proteus-semantic-primitives-plus-plan/G-32-complete-semantic-architecture.md` §6）

## 一句话

**手势 = 声明式约束**——开发者写 `v-gesture:tap="onTap"`（G1-G7）或 `useGesture()`（G10），**不暴露 `bindtouchstart` 这类事件名**：事件是 Backend 实现细节（Web Pointer Events / iOS UIGestureRecognizer / Android GestureDetector / 鸿蒙手势系统）。

## 内容

| 模块 | 说明 |
|------|------|
| `recognizers.ts` | 纯手势识别器（零依赖可单测）：`createGestureRecognizer(handlers, config)` 状态机——feed(GestureInput) → 语义手势事件（tap 连击 / longpress / pan(轴锁定) / swipe(方向+速度) / pinch(双点缩放) / rotate(双点旋转) / press(力度)）；时间源/定时器可注入（测试确定性） |
| `use-gesture.ts` | Web 官方接线：`useGesture(handlers)`（G10 组合 Hook——bind(el) 绑定 Pointer Events）+ `createGestureDirective()`（G1-G7：`v-gesture:tap` / `v-gesture:pan` 等指令工厂） |

## 用法

```ts
// Hook 形式（G10）
import { useGesture } from '@proteus-vue/gesture'
const { bind } = useGesture({
  tap: (e) => console.log('tap', e.count),
  pan: (e) => console.log('拖拽', e.dx, e.dy),
  swipe: (e) => console.log('滑', e.direction),
})
onMounted(() => bind(el.value))

// 指令形式（G1-G7）
const vGesture = createGestureDirective()
app.directive('gesture', vGesture)
// <div v-gesture:tap="onTap" v-gesture:swipe="onSwipe" />
```

## 严格规则

- **G-32.5**：手势原语属性是「约束描述」（count/duration/direction/threshold/axis/scale/angle/force），禁止暴露平台事件名（bindtouchstart 等）
- **事件归一**：Web Pointer / MP touch / 原生识别器 → `GestureInput` 单一输入，Backend 只做事件接线

## 路线

B4 ④ ✅ 纯识别器 + Web 接线 + p-draggable/p-scrollable → 原生识别器映射（iOS/Android/鸿蒙）→ G-31 B7 API Hook 化协同