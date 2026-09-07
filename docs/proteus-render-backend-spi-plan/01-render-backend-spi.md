# G-37 RenderBackend SPI 规范与实现指南

> **一句话**：G-27 定义了「UI 渲染可插拔」的方向，G-37 定义「插拔的插头长什么样」——任何渲染后端只要实现本规范定义的接口、跑通 conformance 测试套件，即可接入 Proteus，成为与 VueDomBackend、iOSUIKitBackend、FlutterBackend 平等的一等公民。

---

## 1. 动机：为什么必须有这份文档

### 1.1 现状缺口

G-27（渲染后端可插拔）确立了原则：

> 「不自研渲染引擎，UI 渲染做插拔」——VueDom / iOS UIKit / Android View / Flutter / Skia 都是可替换的 Backend。

但截至 G-36，体系内**从未定义过**：

- 一个 Backend 具体要实现哪些接口？方法签名是什么？
- 生命周期如何管理（初始化 / 首帧 / 增量更新 / 热重载 / 销毁）？
- Backend 拿到 Component IR 后如何解析 `semantic` 字段？
- 布局谁算——框架还是 Backend？
- 原生事件如何桥接为语义手势？
- Backend 跑在哪个线程？与 JSI 逻辑层如何通信？
- 渲染失败时的降级策略是什么？
- **怎么验证一个 Backend 实现「合规」？**

**结果**：我们说「可以插拔」，但没有告诉实现者「插拔的插头长什么样」。这是整套插拔架构里最该有、却一直缺失的一环。

### 1.2 目标

| 目标 | 说明 |
|------|------|
| **可操作** | 一个工程师拿到本文档，能在 3 天内写出最小可用 Backend |
| **最小化** | 接口方法 ≤ 20 个，不是 50+（对比 Lynx PAPI 上百个） |
| **IR 驱动** | 所有输入是 IR 节点，不是字符串标签名 |
| **能力自描述** | Backend 声明 `capabilities`，框架编译期决定降级 |
| **可验证** | conformance 测试套件是准入门槛，不是建议 |

### 1.3 设计原则（源自方法论五支柱）

```
支柱① 语义优先    → Backend 消费 C-IR 的 semantic 字段，不是 <p-grid> 字符串
支柱② 接口/实现解耦 → 框架只依赖 ProteusRenderBackend 接口，不依赖具体后端
支柱③ 验证先于运行  → conformance 测试 + 编译期 capability 检查
支柱④ 渐进式覆盖   → L1 基础能力必须实现，L2/L3 可选（对应 Tier）
支柱⑤ 方法论可泛化  → SPI 模式与 G-28 NativeBackend / G-29 CompilerBackend 一致
```

---

## 2. 架构定位

### 2.1 在四层中的位置

```
┌─────────────────────────────────────────────────────────┐
│  G-31 语义入口层  ← 开发者写 <p-grid> / useFetch()       │
├─────────────────────────────────────────────────────────┤
│  G-32 原语层     ← 128 语义原语 + 属性 IR 约束          │
├─────────────────────────────────────────────────────────┤
│  G-29 编译层     ← SFC → C-IR → RenderIR（优化/校验）    │
├─────────────────────────────────────────────────────────┤
│  ★ G-37 RenderBackend SPI ← 本规范                       │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Component IR ──→ ProteusRenderBackend 接口 ──→   │  │
│  │                  具体 Backend 实现                  │  │
│  └───────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│  G-30 端接入层   ← Platform (R, C, J) Tier 1-4         │
└─────────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
SFC 源码
  ↓ [G-29 CompilerBackend]
Component IR (C-IR)  ← 含 semantic / props / Tier 降级标记
  ↓ [G-29 优化 + G-37 接口调用]
RenderIR             ← 框架算好的布局 + 差分指令
  ↓ [ProteusRenderBackend 接口]
Backend 内部节点树    ← UIView / ViewGroup / Widget / Canvas 命令 / DOM
  ↓ [原生渲染管线]
像素 / GPU 帧
```

### 2.3 与 G-27 的关系

| G-27 | G-37 |
|------|------|
| 定义「渲染可插拔」的方向和原则 | 定义「插拔的具体契约」 |
| 列出已知 Backend（VueDom / UIKit / Android / Flutter / Skia） | 定义每个 Backend 必须实现什么 |
| 高层架构 | **工程规范（接口 + 生命周期 + conformance）** |

**G-37 是 G-27 的「可执行落地」**——没有 G-37，G-27 只是愿景；有了 G-37，任何人都能实现一个合规 Backend。

---

## 3. 核心接口定义

### 3.1 `ProteusRenderBackend`

```typescript
/**
 * Proteus Render Backend SPI
 * 
 * 任何渲染后端必须实现此接口才能接入 Proteus。
 * 框架只依赖此接口，不依赖任何具体后端。
 * 
 * 实现指南见：03-implementation-guide.md
 * Conformance 测试见：02-conformance-suite.md
 */
interface ProteusRenderBackend {
  // ============================================================
  //  身份与能力
  // ============================================================
  
  /** 后端唯一标识（如 'ios-uikit' / 'android-view' / 'flutter' / 'skia' / 'vue-dom'） */
  readonly id: string
  
  /** 后端版本（语义化版本，如 '1.0.0'） */
  readonly version: string
  
  /** 能力声明（Backend 自报告能做什么，框架编译期据此降级） */
  readonly capabilities: RenderCapabilities

  // ============================================================
  //  生命周期
  // ============================================================
  
  /**
   * 初始化后端
   * - 框架调用一次，在首次 createNode 之前
   * - 后端在此创建渲染管线、初始化原生视图层级
   */
  initialize(ctx: RenderContext): Promise<void>
  
  /**
   * 销毁后端
   * - 释放所有原生资源
   * - 调用后不得再使用任何 NodeHandle
   */
  dispose(): void

  // ============================================================
  //  节点操作（最小化原语集）
  // ============================================================
  
  /**
   * 创建节点
   * @param ir - Component IR 节点（含 semantic 类型 + props）
   * @returns NodeHandle（不透明句柄，框架不解读其内容）
   */
  createNode(ir: ComponentIRNode): NodeHandle
  
  /**
   * 批量更新节点（差分）
   * @param handle - 目标节点
   * @param changes - IR 差分（仅变更部分，非全量）
   */
  updateNode(handle: NodeHandle, changes: IRDiff): void
  
  /**
   * 删除节点
   */
  deleteNode(handle: NodeHandle): void
  
  /**
   * 插入子节点
   * @param at - 插入位置索引（0 = 开头，-1 = 末尾）
   */
  insertChild(parent: NodeHandle, child: NodeHandle, at: number): void
  
  /**
   * 移除子节点
   */
  removeChild(parent: NodeHandle, child: NodeHandle): void
  
  /**
   * 清空所有子节点
   */
  clearChildren(parent: NodeHandle): void

  // ============================================================
  //  属性 / 样式
  // ============================================================
  
  /**
   * 设置属性
   * @param key - 属性名（来自 C-IR props 的 key）
   * @param value - 属性值（已通过 G-31 属性 IR 约束校验）
   */
  setAttribute(handle: NodeHandle, key: string, value: unknown): void
  
  /**
   * 移除属性
   */
  removeAttribute(handle: NodeHandle, key: string): void
  
  /**
   * 设置样式
   * @param style - StyleIR（含布局约束 + 视觉属性）
   *                如果后端实现 applyLayout，框架已算好布局；
   *                否则 style 含语义约束，后端自行解析。
   */
  setStyle(handle: NodeHandle, style: StyleIR): void

  // ============================================================
  //  文本
  // ============================================================
  
  /**
   * 设置文本内容
   * - 对应 <p-text> 或节点的文本子节点
   */
  setText(handle: NodeHandle, text: string): void

  // ============================================================
  //  布局（可选委托）
  // ============================================================
  
  /**
   * 应用布局约束（可选）
   * 
   * 两种模式：
   * - 实现此方法：框架（G-29）负责布局计算，输出 LayoutConstraintIR，
   *   Backend 只需「执行」布局结果
   *   → 适合：DOM / UIKit / ViewGroup（有成熟布局系统）
   * 
   * - 不实现此方法：Backend 自行解析 StyleIR 中的语义约束，
   *   自己完成布局
   *   → 适合：Skia / 自绘引擎（无内置布局系统）
   * 
   * 选择哪种模式在 RenderCapabilities.layoutMode 中声明。
   */
  applyLayout?(handle: NodeHandle, layout: LayoutConstraintIR): void

  // ============================================================
  //  事件 / 手势桥接
  // ============================================================
  
  /**
   * 绑定语义手势
   * @param gesture - GestureIR（语义级别：tap / longpress / pan / pinch / swipe）
   * @returns 绑定句柄（用于后续解绑）
   * 
   * Backend 负责将原生事件映射为语义手势：
   *   iOS  : UITapGestureRecognizer → 'tap'
   *   Android: OnClickListener → 'tap'
   *   Web  : pointerdown/up → 'tap'
   *   TV   : 遥控器确认键 → 'tap'
   */
  bindGesture(handle: NodeHandle, gesture: GestureIR): GestureBinding

  // ============================================================
  //  挂载点
  // ============================================================
  
  /**
   * 获取根容器节点
   * - 框架将此节点挂载到原生宿主 View
   */
  getRootContainer(): NodeHandle
  
  /**
   * 附加到原生宿主
   * @param host - 平台提供的原生容器（如 Activity 的 ViewGroup / UIViewController 的 view）
   */
  attachToHost(host: NativeViewHandle): void
}
```

### 3.2 配套类型定义

```typescript
// ---------- NodeHandle：不透明句柄 ----------
/** 
 * 后端节点句柄（不透明）
 * 框架不解读其内部，只作为引用传递
 * 后端可自行定义为指针、ID、WeakRef 等
 */
type NodeHandle = object | number | symbol

// ---------- ComponentIRNode：C-IR 节点 ----------
interface ComponentIRNode {
  /** 语义类型（来自 G-32 原语表，如 'layout.grid' / 'ui.button' / 'capability.scan-qr'） */
  semantic: SemanticType
  
  /** 节点唯一 ID（框架分配，Backend 用于 diff） */
  id: string
  
  /** 属性（已通过 G-31 属性 IR 约束校验） */
  props?: Record<string, unknown>
  
  /** 子节点（初始树，后续变更通过 insertChild/removeChild） */
  children?: ComponentIRNode[]
  
  /** 文本内容（如果有） */
  text?: string
  
  /** Tier 降级标记（G-30，如 { 'capability.scan-qr': 'unsupported' }） */
  degradation?: Record<string, 'unsupported' | 'fallback' | 'stub'>
}

// ---------- IRDiff：差分指令 ----------
type IRDiff =
  | { type: 'set-attr'; key: string; value: unknown }
  | { type: 'remove-attr'; key: string }
  | { type: 'set-style'; style: Partial<StyleIR> }
  | { type: 'insert-child'; child: NodeHandle; at: number }
  | { type: 'remove-child'; child: NodeHandle }
  | { type: 'set-text'; text: string }
  | { type: 'replace'; newIR: ComponentIRNode }

// ---------- StyleIR ----------
interface StyleIR {
  // 布局约束（来自 G-22 柔性布局）
  layout?: {
    display?: 'box' | 'stack' | 'grid' | 'fluid' | 'adaptive'
    direction?: 'horizontal' | 'vertical'
    wrap?: boolean
    columns?: number | { minWidth: number; max: number }
    // ... 对应 G-32 布局原语属性
  }
  // 尺寸
  width?: number | 'auto' | 'fill'
  height?: number | 'auto' | 'fill'
  // 间距
  padding?: number | { top: number; right: number; bottom: number; left: number }
  margin?: number | { top: number; right: number; bottom: number; left: number }
  gap?: number
  // 视觉
  opacity?: number
  backgroundColor?: string  // 设计 token 引用，如 'var(--bg)'，非裸 hex
  borderRadius?: number
  // ... 更多由 G-32 属性 IR 约束定义
}

// ---------- LayoutConstraintIR（框架算好的布局结果） ----------
interface LayoutConstraintIR {
  /** 节点 ID → 帧（绝对坐标，后端直接应用） */
  frames: Map<string, { x: number; y: number; width: number; height: number }>
  /** 节点 ID → 变换（旋转 / 缩放，可选） */
  transforms?: Map<string, { rotate?: number; scale?: number }>
}

// ---------- GestureIR ----------
type GestureIR =
  | { type: 'tap'; count?: 1 | 2; handler: string }
  | { type: 'longpress'; duration?: number; handler: string }
  | { type: 'pan'; direction?: 'horizontal' | 'vertical' | 'all'; handler: string }
  | { type: 'pinch'; handler: string }
  | { type: 'swipe'; direction: 'left' | 'right' | 'up' | 'down'; handler: string }
  | { type: 'hover'; handler: string }       // PC 特有
  | { type: 'focus'; handler: string }       // TV / 车机 特有
  | { type: 'crown'; handler: string }       // 手表 特有

interface GestureBinding {
  /** 解绑手势 */
  unbind(): void
}

// ---------- RenderCapabilities ----------
interface RenderCapabilities {
  /** 布局模式：'framework' = 框架算好（applyLayout），'backend' = 后端自己算 */
  layoutMode: 'framework' | 'backend'
  
  /** 支持的原语集合（对应 G-32 L1 原语） */
  supports: {
    // 布局
    'layout.box': boolean
    'layout.stack': boolean
    'layout.grid': boolean
    'layout.fluid': boolean
    'layout.adaptive': boolean
    'layout.scroll': boolean
    'layout.draggable': boolean
    // UI
    'ui.button': boolean
    'ui.input': boolean
    'ui.text': boolean
    'ui.image': boolean
    'ui.list': boolean
    'ui.media': boolean
    // 手势
    'gesture.tap': boolean
    'gesture.longpress': boolean
    'gesture.pan': boolean
    'gesture.pinch': boolean
    'gesture.swipe': boolean
    'gesture.hover': boolean
    'gesture.focus': boolean
    'gesture.crown': boolean
    // 视觉
    'visual.opacity': boolean
    'visual.blur': boolean
    'visual.svg': boolean
    'visual.sticky': boolean
    'visual.virtual-list': boolean
  }
  
  /** Tier 等级（G-30） */
  tier: 1 | 2 | 3 | 4
  
  /** 运行线程 */
  threadModel: 'main' | 'background' | 'dedicated'
  
  /** 是否支持热重载 */
  hotReload: boolean
  
  /** 是否支持动画 */
  animation: boolean
}
```

---

## 4. 生命周期状态机

```
┌──────────┐    initialize()     ┌──────────┐    attachToHost()    ┌──────────┐
│  Created  │ ──────────────────→ │ Initializing │ ────────────────→ │ Attached │
└──────────┘                     └──────────────┘                   └────┬─────┘
                                                                         │
                                                              createNode()│
                                                              updateNode()│
                                                              insertChild()│
                                                              bindGesture()│
                                                                         │
                                                                         ↓
                                                                   ┌──────────┐
                                                                   │ Rendering │
                                                                   └────┬─────┘
                                                                        │
                                                           hot-reload  │
                                                              (可选循环) │
                                                                        │
                                                                        ↓
                                                                   ┌──────────┐
                                                                   │ Disposing │
                                                                   └────┬─────┘
                                                                        │
                                                                  dispose()
                                                                        ↓
                                                                   ┌──────────┐
                                                                   │ Destroyed │
                                                                   └──────────┘
```

### 4.1 阶段说明

| 阶段 | 入口 | 后端职责 | 允许的操作 |
|------|------|---------|-----------|
| Created | （构造） | 分配 ID | 无 |
| Initializing | `initialize(ctx)` | 创建渲染管线、初始化原生层级 | 无（节点树为空） |
| Attached | `attachToHost(host)` | 将根节点挂载到宿主 View | createNode / setStyle |
| Rendering | （框架驱动） | 响应所有节点操作 | **全部接口方法** |
| Disposing | `dispose()` | 释放原生资源、解绑手势 | deleteNode / 清理 |
| Destroyed | （dispose 返回） | — | 无（调用任何方法 → 抛错） |

### 4.2 异常转换

```
initialize() 抛错 → 框架重试 N 次（N = capabilities.retryCount || 3）→ 仍失败 → 降级为 StubBackend
attachToHost() 抛错 → 框架记录错误 + 开发期红色占位框 → 生产期静默降级
Rendering 中 createNode 抛错 → 该节点渲染为占位（dev: 红色框 + 错误文案，prod: 静默空节点）
dispose() 抛错 → 吞掉 + 日志（不阻塞后续流程）
```

---

## 5. Component IR 消费契约

### 5.1 Backend 如何解析 `semantic`

`ComponentIRNode.semantic` 是 G-32 定义的语义类型字符串。Backend **必须**基于 `semantic` 决定渲染行为，**禁止**基于标签名字符串。

```typescript
// ✅ 正确：基于 semantic 分发
function createNode(ir: ComponentIRNode): NodeHandle {
  switch (ir.semantic) {
    case 'layout.grid':  return this.createGrid(ir)
    case 'ui.button':    return this.createButton(ir)
    case 'capability.scan-qr': return this.createScanQR(ir)
    default:
      // 未知语义 → 降级为容器节点 + 开发期警告
      return this.createFallback(ir)
  }
}

// ❌ 错误：基于标签名（这是小程序/翻译派思维）
function createNode(ir: ComponentIRNode): NodeHandle {
  if (ir.tagName === 'view')  return this.createView()   // 禁止
  if (ir.tagName === 'swiper') return this.createSwiper() // 禁止
}
```

### 5.2 `semantic` 命名空间

```
layout.*     → 布局原语（G-32 ①类）
ui.*         → UI 原语（G-32 ②类）
shell.*      → 壳原语（G-32 ③类）
gesture.*    → 手势（G-32 ④类）
capability.* → 能力入口（G-32 ⑤类，内部调用 G-28 NativeBackend）
engineering.*→ 工程原语（G-32 ⑥类）
```

### 5.3 `degradation` 字段处理

当 G-30 编译期判定某能力在当前端不支持时，会在 IR 中标记 `degradation`：

```typescript
// C-IR 示例（车机端，scanQR 不支持）
{
  semantic: 'capability.scan-qr',
  id: 'node-42',
  degradation: { 'capability.scan-qr': 'unsupported' }
}
```

Backend 行为：
- `unsupported` → 渲染占位节点（dev: 红色框 "scanQR unsupported on car"，prod: 空 div）
- `fallback` → 渲染降级实现（如 scanQR 降级为手动输入）
- `stub` → 渲染最小占位（不报错，不崩溃）

**Backend 不得忽略 `degradation` 标记**——这是 G-30 Tier 降级机制的核心。

---

## 6. 布局分工边界

### 6.1 两种模式

| 模式 | `capabilities.layoutMode` | 谁算布局 | 谁应用布局 | 适合 |
|------|--------------------------|---------|-----------|------|
| **Framework-driven** | `'framework'` | G-29 编译器 | Backend 实现 `applyLayout()` | DOM / UIKit / ViewGroup |
| **Backend-driven** | `'backend'` | Backend 自己 | Backend 自己 | Skia / 自绘引擎 |

### 6.2 Framework-driven 流程

```
G-29 编译器读 C-IR + StyleIR
  ↓ 布局计算（Yoga / 自研约束求解器）
LayoutConstraintIR（每个节点的绝对帧）
  ↓ ProteusRenderBackend.applyLayout(handle, layout)
Backend 将帧应用到原生节点
  ↓
原生渲染管线
```

### 6.3 Backend-driven 流程

```
G-29 编译器读 C-IR + StyleIR
  ↓ 仅校验（不计算具体帧）
StyleIR（含语义约束：columns / minWidth / direction）
  ↓ ProteusRenderBackend.setStyle(handle, style)
Backend 自己解析约束 + 计算布局
  ↓ 后端自有布局系统
原生渲染管线
```

### 6.4 明确分界线

```
┌─────────────────────────────────────────────────────────┐
│  框架职责（G-29）                                        │
│  - C-IR 生成与校验                                       │
│  - 属性 IR 约束（G-31）                                  │
│  - 差分计算（新旧 C-IR → IRDiff）                        │
│  - Framework 模式下：布局计算                             │
├─────────────────────────────────────────────────────────┤
│  Backend 职责（G-37）                                    │
│  - 节点创建 / 销毁 / 树操作                              │
│  - 属性 / 样式应用到原生节点                              │
│  - 手势原生事件 → 语义手势映射                            │
│  - Backend 模式下：布局计算                               │
│  - 像素输出 / GPU 帧提交                                 │
└─────────────────────────────────────────────────────────┘
```

**禁止跨界**：框架不得直接操作原生节点（必须走 SPI）；Backend 不得修改 C-IR（只读消费）。

---

## 7. 事件 / 手势桥接协议

### 7.1 映射规则

Backend 将**原生事件**映射为**语义手势**（GestureIR）：

| 语义手势 | iOS | Android | Web | TV (10ft) | Watch |
|---------|-----|---------|-----|-----------|-------|
| `tap` | UITapGestureRecognizer | OnClickListener | pointerdown+up | 遥控器确认键 | 触控 / 表冠按压 |
| `longpress` | UILongPressGestureRecognizer | OnLongClickListener | pointerdown 延迟 | — | — |
| `pan` | UIPanGestureRecognizer | OnTouchListener MOVE | pointermove | 方向键持续 | 触控滑动 |
| `pinch` | UIPinchGestureRecognizer | ScaleGestureDetector | wheel+ctrl | — | — |
| `swipe` | UISwipeGestureRecognizer | — | pointer 快速移动 | 方向键 | — |
| `hover` | UIHoverGestureRecognizer (iPadOS) | — | mouseenter/leave | — | — |
| `focus` | — | — | — | 焦点进入/离开 | — |
| `crown` | — | — | — | — | 数码表冠旋转 |

### 7.2 映射实现

```typescript
class iOSUIKitBackend implements ProteusRenderBackend {
  bindGesture(handle: NodeHandle, gesture: GestureIR): GestureBinding {
    const view = this.nodes.get(handle) as UIView
    switch (gesture.type) {
      case 'tap': {
        const recognizer = UITapGestureRecognizer(target, gesture.handler)
        if (gesture.count === 2) recognizer.numberOfTapsRequired = 2
        view.addGestureRecognizer(recognizer)
        return { unbind: () => view.removeGestureRecognizer(recognizer) }
      }
      case 'longpress': {
        const recognizer = UILongPressGestureRecognizer(target, gesture.handler)
        recognizer.minimumPressDuration = gesture.duration || 0.5
        view.addGestureRecognizer(recognizer)
        return { unbind: () => view.removeGestureRecognizer(recognizer) }
      }
      // ... pan / pinch / swipe
      default:
        // 不支持的手势 → 返回 no-op binding + 开发期警告
        console.warn(`[Proteus] ${gesture.type} not supported on iOS`)
        return { unbind: () => {} }
    }
  }
}
```

### 7.3 不支持的手势处理

- Backend `capabilities.supports` 中声明 `false` 的手势 → `bindGesture` 返回 no-op binding
- **不得抛错**（避免运行时崩溃）
- 开发期打印警告（框架收集后展示在 DevTools）
- 业务层可通过 `useCapability()` 检测后条件渲染（G-28）

---

## 8. 线程模型

### 8.1 三种模式

| 模式 | 说明 | 示例 |
|------|------|------|
| `main` | 所有操作在主线程（UI 线程） | UIKit / Android View |
| `background` | 节点操作在后台线程，提交到 UI 线程 | Flutter（UI Thread + GPU Thread） |
| `dedicated` | 独立渲染线程 + 与 JS 通信 | Skia + JSI |

### 8.2 与 JSI 逻辑层通信

```
┌──────────────┐     JSI Bridge     ┌──────────────┐
│  JS 逻辑层    │ ←──────────────→ │  Render Backend │
│  (G-29 编译)  │   同步调用 /      │  (本 SPI)      │
└──────────────┘   异步回调         └───────┬──────┘
                                            ↓
                                    原生渲染管线
```

- **同步调用**：JS → Backend（createNode / updateNode / setAttribute）
- **异步回调**：Backend → JS（手势事件 / 布局完成 / 生命周期）
- **禁止死锁**：Backend 回调 JS 时不得持有 UI 锁

### 8.3 线程安全约束

```
[REQUIRE] 所有 SPI 方法必须从同一线程调用（框架保证）
[REQUIRE] Backend 内部如需多线程，自行同步
[REQUIRE] NodeHandle 不得跨线程传递（除非 Backend 明确支持）
[PROHIBIT] SPI 方法内执行网络 / 磁盘 IO（阻塞 UI）
```

---

## 9. 错误处理与降级

### 9.1 分级策略

| 场景 | 开发模式 | 生产模式 |
|------|---------|---------|
| createNode 失败 | 红色占位框 + 错误栈 | 静默空节点 |
| setAttribute 未知属性 | 警告 + 忽略 | 忽略 |
| bindGesture 不支持 | 警告 | no-op |
| initialize 失败 | 抛错 + 重试 | 降级 StubBackend |
| 渲染管线崩溃 | 红色屏 + 重载按钮 | 重载 + 日志上报 |

### 9.2 StubBackend

当 Backend 初始化失败时，框架自动切换为 `StubBackend`：

```typescript
class StubBackend implements ProteusRenderBackend {
  readonly id = 'stub'
  readonly version = '1.0.0'
  readonly capabilities: RenderCapabilities = {
    layoutMode: 'backend',
    supports: { /* 全部 false */ },
    tier: 4,
    threadModel: 'main',
    hotReload: false,
    animation: false
  }
  
  // 所有方法 no-op，不崩溃
  createNode(ir: ComponentIRNode): NodeHandle { return { __stub: true } }
  updateNode() {}
  deleteNode() {}
  // ... 其余方法同理
}
```

**保证**：即使 Backend 完全不可用，应用也不会崩溃——只是渲染为空。

---

## 10. Conformance 测试套件

### 10.1 测试分类

| 类别 | 测试数 | 说明 |
|------|--------|------|
| **C-01 节点操作** | 8 | create / update / delete / insert / remove / clear |
| **C-02 属性样式** | 5 | setAttribute / removeAttribute / setStyle |
| **C-03 文本** | 2 | setText / 空文本 |
| **C-04 布局** | 4 | applyLayout（如声明）/ setStyle 约束解析 |
| **C-05 手势** | 6 | 8 种手势的 bind / unbind / 映射 |
| **C-06 生命周期** | 5 | initialize / attach / dispose / 状态转换 |
| **C-07 降级** | 4 | degradation 三态 / StubBackend |
| **C-08 差分** | 3 | IRDiff 全部指令类型 |
| **C-09 线程安全** | 2 | 同步 / 回调死锁检测 |
| **C-10 性能** | 3 | 首帧 / 增量 / 内存 |
| **合计** | **42** | **必须全部 PASS** |

### 10.2 准入门槛

```
[PASS 条件]  C-01 ~ C-10 全部通过，0 失败
[FAIL 后果] 不得宣称 "Proteus Compatible"
[例外机制]  capabilities 中声明不支持的能力 → 对应测试自动跳过（不算失败）
```

### 10.3 测试运行

```bash
# Backend 实现后运行
proteus conformance --backend ./my-backend.js

# 输出
✓ C-01 节点操作 (8/8)
✓ C-02 属性样式 (5/5)
✓ C-05 手势 (6/6)
  ⚠ C-06 生命周期: 'gesture.crown' 声明支持但未通过
✗ C-10 性能: 首帧 > 16ms (实测 23ms)

结果: FAIL (1 警告, 1 失败)
```

详细测试用例见 `02-conformance-suite.md`。

---

## 11. 实现指南（5 步）

### Step 1：声明 Backend

```typescript
import { ProteusRenderBackend, RenderCapabilities } from '@proteus-vue/core'

export class MyBackend implements ProteusRenderBackend {
  readonly id = 'my-engine'
  readonly version = '1.0.0'
  readonly capabilities: RenderCapabilities = {
    layoutMode: 'backend',  // 自己算布局
    supports: {
      'layout.box': true,
      'layout.stack': true,
      'layout.grid': true,
      'layout.fluid': false,   // 不支持 → conformance 跳过
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
    tier: 2,  // 缺 J（无 JS 运行时）→ Tier 2
    threadModel: 'main',
    hotReload: true,
    animation: true
  }
  // ... 实现接口方法
}
```

### Step 2：实现节点操作

```typescript
private nodes = new Map<string, MyNativeNode>()

createNode(ir: ComponentIRNode): NodeHandle {
  // 基于 semantic 分发
  const native = this.createNativeFor(ir.semantic, ir.props)
  this.nodes.set(ir.id, native)
  return { id: ir.id }
}

updateNode(handle: NodeHandle, changes: IRDiff): void {
  const native = this.nodes.get(handle.id)
  if (!native) throw new Error(`Node ${handle.id} not found`)
  
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
      // ... 其余 IRDiff 类型
    }
  }
}
```

### Step 3：实现手势映射

```typescript
bindGesture(handle: NodeHandle, gesture: GestureIR): GestureBinding {
  const native = this.nodes.get(handle.id)
  const handler = this.createNativeHandler(gesture.type, gesture.handler)
  native.addGestureHandler(handler)
  return { unbind: () => native.removeGestureHandler(handler) }
}
```

### Step 4：处理降级

```typescript
createNode(ir: ComponentIRNode): NodeHandle {
  // 检查 degradation 标记
  if (ir.degradation) {
    for (const [cap, mode] of Object.entries(ir.degradation)) {
      if (mode === 'unsupported') {
        return this.createPlaceholder(ir, `⚠ ${cap} unsupported`)
      }
      if (mode === 'fallback') {
        return this.createFallback(ir)
      }
    }
  }
  // 正常创建
  return this.createNativeFor(ir.semantic, ir.props)
}
```

### Step 5：跑 Conformance

```bash
proteus conformance --backend ./my-backend.js
# 全部 PASS → 宣称 "Proteus Compatible"
# 部分 PASS → 检查 capabilities 声明是否诚实
```

详细指南见 `03-implementation-guide.md`。

---

## 12. 已知 Backend 清单

| Backend | 渲染目标 | 布局模式 | Tier | 状态 |
|---------|---------|---------|------|------|
| `vue-dom` | 浏览器 DOM + CSS | framework | 1 | ✅ 参考实现 |
| `ios-uikit` | UIKit (UIView/UIStackView/UICollectionView) | framework | 1 | 📋 规划 |
| `android-view` | ViewGroup (RecyclerView/ConstraintLayout) | framework | 1 | 📋 规划 |
| `flutter` | Widget Tree (Row/Column/GridView) | backend | 1 | 📋 规划 |
| `skia` | Canvas 绘制命令 | backend | 1 | 📋 规划 |
| `harmony-arkui` | ArkUI 组件树 | framework | 1 | 📋 规划 |
| `tv-10ft` | 大屏焦点导航 UI | framework | 2 | 📋 规划 |
| `watch-os` | SwiftUI / watchOS | framework | 2 | 📋 规划 |
| `terminal` | 终端字符渲染（conformance 测试用） | backend | 3 | ✅ 参考实现 |

**`terminal` Backend** 是本规范的最小完整实现——用 ASCII 字符渲染 UI，用于：
- conformance 测试（不依赖图形环境）
- 文档示例
- CI 验证

---

## 13. 与既有体系协同矩阵

| 模块 | 协同点 | G-37 职责 |
|------|--------|-----------|
| G-27 渲染可插拔 | G-27 定义方向，G-37 定义契约 | **落地 SPI** |
| G-28 能力后端 | `<p-scan-qr>` 内部调用 `useNative()` → G-28 NativeBackend | Backend 内部可调用 G-28 SPI |
| G-29 编译层 | C-IR 生产者 = G-29，消费者 = G-37 | **消费 C-IR** |
| G-30 端接入 | Tier 等级 → capabilities.tier | **声明 Tier** |
| G-31 语义入口 | `<p-grid>` → C-IR → Backend | **消费语义** |
| G-32 原语 | `semantic` 命名空间 = G-32 原语表 | **实现 128 原语** |
| G-36 AI Agent | Agent 生成符合 IR 的代码 → Backend 渲染 | **渲染 Agent 输出** |

---

## 14. 铁律（Rules）

详见 `rules.md`（G-37.1-6 + CMP023-028）。

核心铁律预览：

- **G-37.1**：Backend 必须基于 `semantic` 字段分发，**禁止**基于标签名字符串
- **G-37.2**：Backend 不得修改 C-IR（只读消费）
- **G-37.3**：`capabilities` 必须诚实声明，未声明的能力视为不支持
- **G-37.4**：所有 SPI 方法必须从同一线程调用（框架保证）
- **G-37.5**：Conformance 测试必须 0 失败（声明的能力全部通过）
- **G-37.6**：降级必须可见（dev: 警告，prod: 日志）

---

## 15. 分批落地（B1-B5）

详见 `batches.md`。

| 批次 | 内容 | 里程碑 | DoD |
|------|------|--------|-----|
| B1 | SPI 接口定义 + TypeScript 类型 | M1 | `.d.ts` 稳定，vue-dom / terminal 两参考实现 |
| B2 | Conformance 测试套件（42 测试） | M1 | 测试可运行，参考实现全 PASS |
| B3 | 实现指南 + terminal Backend 完整示例 | M2 | 新人 3 天可写出最小 Backend |
| B4 | iOS / Android / Flutter Backend | M2-M3 | 三端 conformance 全 PASS |
| B5 | Skia / Harmony / TV / Watch Backend | M3 | Tier 1-4 全覆盖 |

---

## 16. 总结

**G-37 让「渲染可插拔」从愿景变成工程事实：**

```
之前：  "我们支持任意渲染后端"（但没有人知道怎么写一个）
之后：  "实现 ProteusRenderBackend 接口 + 跑通 42 项 conformance = 合规"
```

这份规范 + conformance 套件 = **接入门槛明确、验证客观、生态可扩展**。任何人都能写一个合规 Backend，且框架能保证其行为一致——这正是「统一语义收敛」方法论在渲染层的最终兑现。

---

> **Related**：G-27（渲染可插拔方向）· G-29（编译层 / C-IR）· G-30（端接入 / Tier）· G-31（语义入口）· G-32（128 原语）· G-36（AI Agent 生成符合 IR 的代码）
>
> **Design principle**：`PROTEUS-METHODOLOGY` 原则 #0（统一语义收敛）+ 五支柱
