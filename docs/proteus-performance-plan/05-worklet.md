# UI 线程 Worklet 隔离

> 对齐：`02-strategy.md` 机制 (4)、`proteus-app-renderer-plan/05-thread-model.md`
> 批次：G-30 B3

---

## 1. 问题

Vue 响应式默认运行在 **JS 主线程**。高频操作（滚动、手势、动画）若在 JS 线程执行：
- 复杂计算阻塞 → 掉帧
- JSI 调用排队 → 延迟累积

**目标**：手势/动画等高频路径运行在 **UI 线程**，直接 JSI 同步调 Native。

---

## 2. Worklet 原语

```ts
// 业务声明
const onScroll = worklet((offset: number) => {
  'use worklet'  // ← Compiler 标记, 提取到 UI runtime
  nativeView.setTranslationY(offset)  // 直接 JSI 调 Native
})

// 手势绑定
<pg-scroll @scroll="onScroll" />
```

### Compiler 处理

```ts
// Compiler 识别 'use worklet' + worklet() 包裹
// 把函数体提取为独立片段, 运行时注册到 UI 线程的 JSI runtime
function extractWorklets(ast: AST): Worklet[] {
  return ast.filter(node => node.hasWorkletDirective())
            .map(node => ({ id: genId(), code: node.body }))
}
```

---

## 3. 线程模型

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  JS 线程     │────────▶│  JSI Bridge  │────────▶│  UI 线程     │
│  Vue/响应式  │         │  (同步调用)   │         │  Native View │
└─────────────┘         └─────────────┘         └─────────────┘
       │                       │                       │
       │  runOnJS()            │  worklet()            │
       ▼                       ▼                       ▼
  业务逻辑              高频操作直落 Native       手势/动画/滚动
```

- **默认**：`worklet` 函数在 **UI 线程** 执行
- **副作用**：通过 `runOnJS()` 回到 JS 线程（如触发 Vue 状态更新）

```ts
const onScroll = worklet((offset) => {
  // UI 线程: 直接改 Native
  nativeView.setTranslationY(offset)

  if (offset > 100) {
    runOnJS(() => {          // 回到 JS 线程
      store.setHeaderCollapsed(true)
    })
  }
})
```

---

## 4. `p-*` 组件内置 Worklet

业务**零感知**——高频属性自动包成 worklet：

```vue
<!-- 自动: scroll 事件走 worklet -->
<pg-scroll :on-scroll="handleScroll" />

<!-- 自动: 手势拖拽走 worklet -->
<pg-view :on-pan="handlePan" />
```

Component plan 的 `p-*` 映射表标注哪些事件默认走 worklet。

---

## 5. 性能预算

| 场景 | 无 Worklet | 有 Worklet (目标) |
|------|-----------|------------------|
| 长列表 (1000 条) 滚动 | 30-45fps | **≥58fps** |
| 手势拖拽跟手 | 掉帧 | **120fps (ProMotion)** |
| Glass 动态形变 | JS 卡顿 | **UI 线程直接改** |

---

## 6. 约束与规则

1. **Worklet 内不可访问 Vue 响应式对象**（不同 runtime）
2. **Worklet 参数/返回值必须可序列化**（跨线程边界）
3. **`runOnJS` 谨慎使用**（回 JS 线程有成本，批量合并）

DevTools TraceBus 可视化 Worklet 执行（对齐 DevTools plan）。

---

## 7. 验收

- [ ] Worklet 函数在 UI 线程执行（线程断言）
- [ ] 长列表滚动 ≥58fps（真机测量）
- [ ] 手势跟手 120fps
- [ ] `p-*` 组件默认事件走 worklet
- [ ] TraceBus 可视化 worklet 调用链
