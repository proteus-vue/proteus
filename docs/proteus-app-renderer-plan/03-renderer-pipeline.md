# 03 Custom Renderer 渲染管线

## 1. 基于 Vue 3 createRenderer

```ts
import { createRenderer } from '@vue/runtime-core'
import { nativeBridge } from './bridge'

const renderer = createRenderer({
  // 节点操作
  createElement(type) {
    return nativeBridge.createView(type)  // → JSI
  },
  insert(child, parent) {
    nativeBridge.appendChild(parent, child)
  },
  remove(child) {
    nativeBridge.removeView(child)
  },
  patchProp(el, key, prev, next) {
    nativeBridge.updateProp(el, key, next)
  },
  // ... 其余 nodeOps
})

export function render(app: Component, rootViewId: number) {
  renderer.createApp(app).mount(rootViewId)
}
```

## 2. p-* → Native View 映射（核心）

| p-* 组件 | iOS | Android | 鸿蒙 |
|---------|-----|---------|------|
| `p-view` | UIView | ViewGroup | StackLayout |
| `p-text` | UILabel | TextView | Text |
| `p-image` | UIImageView | ImageView | Image |
| `p-scroll-view` | UIScrollView | RecyclerView | ScrollView |
| `p-list` | UITableView | RecyclerView | List |
| `p-input` | UITextField | EditText | TextInput |
| `p-glass` | UIGlassEffect | RenderEffect | blur modifier |

详见 `04-component-mapping.md`。

## 3. diff 与 commit 阶段

```
1. render() → VNode tree
2. diff（JS 线程）  → 产出 ViewInstruction[]
     - CREATE viewId type
     - UPDATE viewId prop value
     - INSERT parentId childId
     - REMOVE viewId
3. commit（UI 线程）→ JSI 同步执行指令
4. Native 渲染树提交
```

**关键**：diff 在 JS 线程、commit 到 UI 线程，但通过 JSI 同步派发，无序列化。

## 4. 事件系统

```ts
// Vue 模板
<p-view @tap="onTap" @scroll="onScroll">

// Compiler 转换：事件名 → Native 事件
{ onTap: 'click', onScroll: 'scroll' }
```

Native 事件 → JSI 回调 → Vue 事件总线 → 组件 handler。

## 5. 长列表优化

- **Cell 复用池**：`p-list` 对应 UITableView / RecyclerView，自动复用
- **Lazy mount**：可视区外节点不创建 Native View
- **Windowed rendering**：对齐 Web 端的虚拟滚动

目标：1000 条列表 ≥ 55fps（详见 10-audit-performance）。
