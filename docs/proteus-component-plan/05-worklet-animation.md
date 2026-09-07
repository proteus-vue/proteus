# Worklet 动画与手势映射（M4）

> Skyline 满血的核心落点之一。本文规定 Vue 动画/手势写法如何确定性映射为 Skyline Worklet（`"worklet";` + `applyAnimatedStyle` + 手势）。

---

## 1. 两条路径

| 场景 | Web | Skyline |
|------|-----|---------|
| 普通过渡（show/hide） | CSS transition | CSS transition（Skyline 支持大部分） |
| 高频动画（scroll/拖拽） | rAF | **Worklet** |
| 手势（pan/pinch） | Pointer events | **Worklet 手势** |
| 转场（page push） | `<transition>` | routeType + Worklet（Router M7.4） |

**原则**：能用 CSS 过渡就不上 Worklet；只有“每帧依赖手势/滚动”才走 Worklet。

---

## 2. 组件侧 API 设计

### 2.1 声明式动画 Props
```vue
<p-popup
  :visible="show"
  transition="slide-up"
  :gesture-close="true"
/>
```
- `transition` 枚举：`fade | slide-up | slide-down | slide-left | half-screen | scale-down`
- 映射规则统一在 `transitions.ts`（与 Router M7.4 共享枚举）

### 2.2 命令式动画（高级）
通过 `useAnimation()` composable：
```ts
const { animatedStyle, shared } = useAnimation()

// shared 值可在 UI 线程读取（对齐 Vue ref → Worklet shared 桥）
shared.progress.value = 0.5
```
- `shared` 底层：Web = reactive ref；Skyline = `wx.worklet.shared`
- 禁止把整个 reactive 对象丢进 Worklet，只传 `shared` 值

---

## 3. transform 规则

**识别**：组件 `setup()` 中调用 `useAnimation()` / 模板绑定 `:animated-style`
**生成**：
- Web：返回 `style` 对象，正常响应式
- Skyline：
  1. 将函数标记为 `"worklet";`
  2. 调用 `applyAnimatedStyle(node, workletFn)`
  3. 将 `shared` 值映射为 `wx.worklet.shared`

**约束**
- Worklet 函数内只能访问 `shared` 值 + 参数，不能访问 Vue `data`/普通 ref
- 编译期静态分析：检测到 Worklet 内访问非 shared 变量 → **报错**（不让用户白屏后自查）

---

## 4. 手势映射

| Vue/Web 写法 | Skyline Worklet |
|--------------|----------------|
| `@pointerdown/move/up` | `gesture.Pan()` / `gesture.Tap()` |
| `touchmove` | Worklet 手势（避免 JS 线程） |
| 拖拽位移 | `shared.translateX` + `applyAnimatedStyle` |

`p-popup` 的下滑关闭：
```ts
const closeGesture = gesture.Pan({
  onUpdate: (e) => { shared.translateY.value = e.translationY },
  onEnd: (e) => { if (e.velocityY > threshold) emit('close') },
})
```

---

## 5. 转场调度（与 Router 协同）
- 组件转场（popup）走 `transition` Prop → Worklet
- 页面转场走 Router `routeType` → Skyline 路由动画
- 两者共用 `transform-transition.ts` 枚举，避免命名分裂

---

## 6. 降级

| 情况 | 行为 |
|------|------|
| Skyline 不支持 Worklet（低版本） | 降级 CSS transition + warn |
| Web 端 | 始终 CSS/rAF，不引入 Worklet 依赖 |
| 手势复杂、Worklet 无法表达 | 提供 `force-fallback="js"` Prop |

---

## 7. 验收
- `p-popup` 在 Skyline 下滑关闭：60fps（DevTools Performance 验证）
- Worklet 内访问普通 ref → 编译报错 + `--trace-transform` 定位
- 转场枚举在 Router 与 Component 之间 100% 一致（CI diff 检查）
