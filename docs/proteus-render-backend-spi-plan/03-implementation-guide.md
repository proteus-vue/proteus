# G-37 实现指南（Implementation Guide）

> **目标**：一个工程师拿到本文档，能在 3 天内写出最小可用 Backend。

---

## 概览：5 个步骤

| 步骤 | 内容 | 耗时 |
|------|------|------|
| Step 1 | 声明 Backend（id / version / capabilities） | 0.5 天 |
| Step 2 | 实现节点操作（createNode / updateNode / ...） | 1 天 |
| Step 3 | 实现手势映射（bindGesture） | 0.5 天 |
| Step 4 | 处理降级（degradation / StubBackend） | 0.5 天 |
| Step 5 | 跑 Conformance + 性能调优 | 0.5 天 |
| | **合计** | **3 天** |

---

## Step 1：声明 Backend

### 1.1 创建项目

```bash
mkdir proteus-my-backend
cd proteus-my-backend
npm init -y
npm install @proteus-vue/core
```

### 1.2 实现骨架

```typescript
// src/index.ts
import {
  ProteusRenderBackend,
  ComponentIRNode,
  NodeHandle,
  IRDiff,
  StyleIR,
  GestureIR,
  GestureBinding,
  RenderCapabilities,
  NativeViewHandle,
  LayoutConstraintIR
} from '@proteus-vue/core'

export class MyBackend implements ProteusRenderBackend {
  readonly id = 'my-engine'
  readonly version = '1.0.0'
  
  readonly capabilities: RenderCapabilities = {
    layoutMode: 'backend',  // 自己算布局
    supports: {
      'layout.box': true,
      'layout.stack': true,
      'layout.grid': true,
      'layout.fluid': false,
      'layout.adaptive': true,
      'layout.scroll': true,
      'layout.draggable': false,
      'ui.button': true,
      'ui.input': true,
      'ui.text': true,
      'ui.image': true,
      'ui.list': true,
      'ui.media': false,
      'gesture.tap': true,
      'gesture.longpress': true,
      'gesture.pan': true,
      'gesture.pinch': false,
      'gesture.swipe': true,
      'gesture.hover': false,
      'gesture.focus': false,
      'gesture.crown': false,
      'visual.opacity': true,
      'visual.blur': false,
      'visual.svg': false,
      'visual.sticky': false,
      'visual.virtual-list': true,
    },
    tier: 2,
    threadModel: 'main',
    hotReload: true,
    animation: true
  }
  
  // ===== 待实现的方法 =====
  async initialize(ctx: any): Promise<void> {}
  dispose(): void {}
  createNode(ir: ComponentIRNode): NodeHandle { throw new Error('not implemented') }
  updateNode(handle: NodeHandle, changes: IRDiff[]): void {}
  deleteNode(handle: NodeHandle): void {}
  insertChild(parent: NodeHandle, child: NodeHandle, at: number): void {}
  removeChild(parent: NodeHandle, child: NodeHandle): void {}
  clearChildren(parent: NodeHandle): void {}
  setAttribute(handle: NodeHandle, key: string, value: unknown): void {}
  removeAttribute(handle: NodeHandle, key: string): void {}
  setStyle(handle: NodeHandle, style: StyleIR): void {}
  setText(handle: NodeHandle, text: string): void {}
  bindGesture(handle: NodeHandle, gesture: GestureIR): GestureBinding { 
    return { unbind: () => {} }
  }
  getRootContainer(): NodeHandle { throw new Error('not implemented') }
  attachToHost(host: NativeViewHandle): void {}
}
```

### 1.3 capabilities 填写指南

| 字段 | 怎么填 |
|------|--------|
| `layoutMode` | 有内置布局系统（DOM/UIKit/ViewGroup）→ `'framework'`，需实现 `applyLayout`。纯自绘（Skia）→ `'backend'` |
| `supports['layout.*']` | 能渲染对应语义 → `true`，否则 `false` |
| `supports['ui.*']` | 有原生控件 → `true` |
| `supports['gesture.*']` | 平台支持该输入方式 → `true` |
| `tier` | 有 R+C+J → 1，缺一个 → 2，仅 R → 3，仅 J → 4 |
| `threadModel` | 渲染在 UI 线程 → `'main'`，有独立线程 → `'background'` / `'dedicated'` |
| `hotReload` | 支持热重载 → `true` |
| `animation` | 支持动画 → `true` |

**诚实原则**：不确定就填 `false`。声明 `false` 的能力会被 conformance 跳过，不影响兼容性。

---

## Step 2：实现节点操作

### 2.1 节点存储

```typescript
export class MyBackend implements ProteusRenderBackend {
  private nodes = new Map<string, MyNativeNode>()
  private rootHandle: NodeHandle | null = null
  private destroyed = false
  
  // ... capabilities / 构造 ...
  
  createNode(ir: ComponentIRNode): NodeHandle {
    this.assertNotDestroyed()
    
    // 基于 semantic 分发（G-37.1）
    const native = this.createNativeFor(ir.semantic, ir.props)
    this.nodes.set(ir.id, native)
    
    // 处理降级标记（G-37.6）
    if (ir.degradation) {
      this.applyDegradation(native, ir.degradation)
    }
    
    // 处理子节点（初始树）
    if (ir.children) {
      for (const childIR of ir.children) {
        const childHandle = this.createNode(childIR)
        this.insertChild({ id: ir.id }, childHandle, -1)
      }
    }
    
    // 处理文本
    if (ir.text !== undefined) {
      this.setText({ id: ir.id }, ir.text)
    }
    
    return { __id: ir.id }
  }
  
  private createNativeFor(semantic: string, props?: Record<string, unknown>): MyNativeNode {
    switch (semantic) {
      case 'layout.box':    return this.createBox(props)
      case 'layout.stack':  return this.createStack(props)
      case 'layout.grid':   return this.createGrid(props)
      case 'ui.button':     return this.createButton(props)
      case 'ui.text':       return this.createText(props)
      // ... 每个声明 true 的能力都需要实现
      default:
        // 未知语义 → 降级为容器（不抛错）
        console.warn(`[Proteus] Unknown semantic: ${semantic}, fallback to box`)
        return this.createBox(props)
    }
  }
}
```

### 2.2 更新与差分

```typescript
updateNode(handle: NodeHandle, changes: IRDiff[]): void {
  const native = this.nodes.get(handle.__id)
  if (!native) throw new Error(`Node ${handle.__id} not found`)
  
  for (const change of changes) {
    switch (change.type) {
      case 'set-attr':
        native.setAttribute(change.key, change.value)
        break
      case 'remove-attr':
        native.removeAttribute(change.key)
        break
      case 'set-style':
        native.applyStyle(change.style)
        break
      case 'insert-child':
        native.insertChild(change.child, change.at)
        break
      case 'remove-child':
        native.removeChild(change.child)
        break
      case 'set-text':
        native.setText(change.text)
        break
      case 'replace':
        // 替换整个节点
        const newNative = this.createNativeFor(change.newIR.semantic, change.newIR.props)
        this.nodes.set(handle.__id, newNative)
        break
      default:
        // exhaustive check
        const _exhaustive: never = change
        throw new Error(`Unhandled IRDiff: ${JSON.stringify(change)}`)
    }
  }
}
```

### 2.3 树操作

```typescript
deleteNode(handle: NodeHandle): void {
  const native = this.nodes.get(handle.__id)
  if (!native) return  // 幂等
  
  native.destroy()
  this.nodes.delete(handle.__id)
}

insertChild(parent: NodeHandle, child: NodeHandle, at: number): void {
  const parentNative = this.nodes.get(parent.__id)
  const childNative = this.nodes.get(child.__id)
  if (!parentNative || !childNative) return
  
  if (at === -1) {
    parentNative.addChild(childNative)
  } else {
    parentNative.insertChildAt(childNative, at)
  }
}

removeChild(parent: NodeHandle, child: NodeHandle): void {
  const parentNative = this.nodes.get(parent.__id)
  if (!parentNative) return
  parentNative.removeChild(child.__id)
}

clearChildren(parent: NodeHandle): void {
  const parentNative = this.nodes.get(parent.__id)
  if (!parentNative) return
  parentNative.clearChildren()
}
```

### 2.4 属性与样式

```typescript
setAttribute(handle: NodeHandle, key: string, value: unknown): void {
  const native = this.nodes.get(handle.__id)
  if (!native) return
  native.setAttribute(key, value)
}

removeAttribute(handle: NodeHandle, key: string): void {
  const native = this.nodes.get(handle.__id)
  if (!native) return
  native.removeAttribute(key)
}

setStyle(handle: NodeHandle, style: StyleIR): void {
  const native = this.nodes.get(handle.__id)
  if (!native) return
  
  // layoutMode = 'backend' 时，Backend 自己解析语义约束
  if (style.layout) {
    this.applyLayoutConstraints(native, style.layout)
  }
  if (style.width !== undefined) native.setWidth(style.width)
  if (style.height !== undefined) native.setHeight(style.height)
  if (style.padding !== undefined) native.setPadding(style.padding)
  if (style.gap !== undefined) native.setGap(style.gap)
  if (style.opacity !== undefined) native.setOpacity(style.opacity)
  if (style.backgroundColor !== undefined) native.setBackgroundColor(style.backgroundColor)
}

private applyLayoutConstraints(native: MyNativeNode, layout: StyleIR['layout']): void {
  if (!layout) return
  
  switch (layout.display) {
    case 'stack':
      native.setLayout({ type: 'flex', direction: layout.direction || 'vertical' })
      break
    case 'grid':
      native.setLayout({ type: 'grid', columns: layout.columns })
      break
    case 'box':
      native.setLayout({ type: 'block' })
      break
    // ... 对应 G-32 布局原语
  }
}
```

### 2.5 文本

```typescript
setText(handle: NodeHandle, text: string): void {
  const native = this.nodes.get(handle.__id)
  if (!native) return
  native.setText(text)
}
```

---

## Step 3：实现手势映射

```typescript
bindGesture(handle: NodeHandle, gesture: GestureIR): GestureBinding {
  const native = this.nodes.get(handle.__id)
  if (!native) return { unbind: () => {} }
  
  // 检查是否声明支持（CMP027）
  const capKey = `gesture.${gesture.type}` as keyof RenderCapabilities['supports']
  if (!this.capabilities.supports[capKey]) {
    // 未声明 → no-op（不抛错）
    console.warn(`[Proteus] ${gesture.type} not supported on ${this.id}`)
    return { unbind: () => {} }
  }
  
  // 映射到原生事件
  const recognizer = this.createNativeRecognizer(native, gesture)
  return { unbind: () => recognizer.destroy() }
}

private createNativeRecognizer(native: MyNativeNode, gesture: GestureIR): NativeRecognizer {
  switch (gesture.type) {
    case 'tap':
      return native.onTap(() => this.invokeHandler(gesture.handler, { type: 'tap' }))
    case 'longpress':
      return native.onLongPress(gesture.duration || 500, 
        () => this.invokeHandler(gesture.handler, { type: 'longpress' }))
    case 'pan':
      return native.onPan(gesture.direction || 'all',
        (delta) => this.invokeHandler(gesture.handler, { type: 'pan', delta }))
    case 'pinch':
      return native.onPinch(
        (scale) => this.invokeHandler(gesture.handler, { type: 'pinch', scale }))
    case 'swipe':
      return native.onSwipe(gesture.direction,
        () => this.invokeHandler(gesture.handler, { type: 'swipe', direction: gesture.direction }))
    default:
      throw new Error(`Unhandled gesture: ${gesture.type}`)
  }
}

private invokeHandler(handlerId: string, event: GestureEvent): void {
  // 通过 JSI 回调 JS 逻辑层
  this.jsBridge.invoke(handlerId, event)
}
```

---

## Step 4：处理降级

### 4.1 degradation 标记

```typescript
private applyDegradation(native: MyNativeNode, degradation: Record<string, string>): void {
  for (const [cap, mode] of Object.entries(degradation)) {
    switch (mode) {
      case 'unsupported':
        // dev: 红色占位框 + 警告
        if (import.meta.env?.DEV) {
          native.replaceWith(this.createRedBox(`⚠ ${cap} unsupported on ${this.id}`))
        } else {
          native.replaceWith(this.createPlaceholder())
        }
        break
      case 'fallback':
        // 渲染降级实现（如 scanQR → 手动输入）
        native.replaceWith(this.createFallback(cap))
        break
      case 'stub':
        // 最小占位（不报错，不崩溃）
        native.replaceWith(this.createStub(cap))
        break
    }
  }
}
```

### 4.2 StubBackend（初始化失败时的兜底）

```typescript
class StubBackend implements ProteusRenderBackend {
  readonly id = 'stub'
  readonly version = '1.0.0'
  readonly capabilities: RenderCapabilities = {
    layoutMode: 'backend',
    supports: {
      'layout.box': false, 'layout.stack': false, 'layout.grid': false,
      'layout.fluid': false, 'layout.adaptive': false, 'layout.scroll': false,
      'layout.draggable': false,
      'ui.button': false, 'ui.input': false, 'ui.text': false,
      'ui.image': false, 'ui.list': false, 'ui.media': false,
      'gesture.tap': false, 'gesture.longpress': false, 'gesture.pan': false,
      'gesture.pinch': false, 'gesture.swipe': false,
      'gesture.hover': false, 'gesture.focus': false, 'gesture.crown': false,
      'visual.opacity': false, 'visual.blur': false, 'visual.svg': false,
      'visual.sticky': false, 'visual.virtual-list': false,
    },
    tier: 4,
    threadModel: 'main',
    hotReload: false,
    animation: false
  }
  
  // 所有方法 no-op
  async initialize(): Promise<void> {}
  dispose(): void {}
  createNode(): NodeHandle { return { __stub: true } }
  updateNode(): void {}
  deleteNode(): void {}
  insertChild(): void {}
  removeChild(): void {}
  clearChildren(): void {}
  setAttribute(): void {}
  removeAttribute(): void {}
  setStyle(): void {}
  setText(): void {}
  bindGesture(): GestureBinding { return { unbind: () => {} } }
  getRootContainer(): NodeHandle { return { __stub: true } }
  attachToHost(): void {}
}
```

---

## Step 5：跑 Conformance

### 5.1 配置

```json
// proteus.config.json
{
  "backend": "./dist/index.js",
  "conformance": {
    "categories": ["C-01", "C-02", "C-03", "C-04", "C-05", "C-06", "C-07", "C-08", "C-09", "C-10"],
    "performance": {
      "firstFrameBudgetMs": 16,
      "incrementalBudgetMs": 8,
      "memoryBudgetMB": 50
    }
  }
}
```

### 5.2 运行

```bash
proteus conformance --backend ./dist/index.js --verbose
```

### 5.3 常见失败与修复

| 失败 | 原因 | 修复 |
|------|------|------|
| C-01-8 未知 semantic 抛错 | createNode 未处理 default case | 返回占位节点 |
| C-05-6 不支持手势抛错 | bindGesture 未检查 capabilities | 返回 no-op binding |
| C-06-5 dispose 后崩溃 | 未抛错 / 未标记 destroyed | 加 assertNotDestroyed |
| C-10-1 首帧超时 | 初始化太重 | 懒加载 / 分帧 |
| C-02-4 布局约束无效 | setStyle 未解析 layout | 实现 applyLayoutConstraints |

### 5.4 性能调优

```typescript
// 技巧 1：节点池（避免频繁创建/销毁）
private nodePool: MyNativeNode[] = []

// 技巧 2：批量更新（合并 IRDiff）
private pendingChanges: IRDiff[] = []
flushChanges(): void {
  if (this.pendingChanges.length === 0) return
  this.applyBatch(this.pendingChanges)
  this.pendingChanges = []
}

// 技巧 3：懒初始化（首帧只创建可见节点）
createNode(ir: ComponentIRNode): NodeHandle {
  if (ir.props?.deferred && !this.isVisible(ir)) {
    return this.createLazyPlaceholder(ir)
  }
  return this.createRealNode(ir)
}
```

---

## 附录 A：最小完整 Backend（terminal）

参见 `examples/terminal-backend.ts`（ASCII 字符渲染，用于 conformance 测试）。

---

> **Related**：01-render-backend-spi.md（主文档 §11）· 02-conformance-suite.md · rules.md
