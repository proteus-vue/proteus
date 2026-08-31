# 性能优化策略总纲：四大机制

> 对齐：`01-research.md`、`proteus-app-renderer-plan`
> 执行位：G-30（性能优化阶段）

---

## 0. 目标

将 App 端冷启动首帧从 **~400ms（串行链路）** 压至 **<200ms**，逼近 Lynx IFR，对齐 RN Fabric 调用性能 + 超越其首帧表现。

---

## 1. 机制矩阵

| # | 机制 | 解决的瓶颈 | 收益 | 复杂度 | 落地批次 |
|---|------|----------|------|-------|---------|
| 1 | **AOT 预编译** | T5 模板解析 | 30-80ms → <5ms | 中 | G-30 B1 |
| 2 | **静态首帧 (IFR)** | 串行启动链 | 400ms → <200ms | 高 | G-30 B2 |
| 3 | **JSI 预热 + 懒注册** | T1+T3 启动 | 60-120ms → ~20ms | 低 | G-30 B1 |
| 4 | **UI Worklet 隔离** | 高频掉帧 | 30fps → 60fps | 中 | G-30 B3 |

**优先级**：B1（AOT + 预热）→ B2（IFR）→ B3（Worklet）。B1 见效最快，B2 收益最大。

---

## 2. 机制 (1)：AOT 预编译

### 设计

```ts
// 构建期 (Compiler)
function compileAOT(sfc: SFC): NativeInstruction[] {
  const ir = compileToIR(sfc)          // 已有 --trace-transform
  return ir.nodes.map(node => ({
    op: 'createView',                  // 操作码 (1 byte)
    type: node.tag,                    // p-view → Native View 类型
    props: encodeProps(node.props),    // 紧凑编码
    children: node.children.map(...)   // 递归
  }))
}
// 产物: dist/pages/home.aot (二进制或 JSON)
```

### 运行时

```ts
// 运行时 (App Renderer)
function mountAOT(instructions: NativeInstruction[], root: NativeRoot) {
  for (const instr of instructions) {
    const view = jsi.call('createView', instr.type)  // 同步直调
    applyProps(view, instr.props)
    root.appendChild(view)
  }
}
// T5 ≈ 数组遍历耗时, <5ms
```

### 指令格式（紧凑二进制）

```
[opcode: u8][type: u16][propsLen: u16][props...][childCount: u16]...
```

对齐 `proteus-app-renderer-plan/09-compiler-ir-integration.md`。

---

## 3. 机制 (2)：静态首帧 (IFR)

### 阶段协议

```
┌─────────────────────────────────────────────────────┐
│ 阶段 A: 首帧直出 (主线程, ~80-120ms)                  │
│  AOT 指令 → JSI → Native View (绕过 Vue)             │
├─────────────────────────────────────────────────────┤
│ 阶段 B: 运行时初始化 (后台线程, 与 A 并行)             │
│  Vue 启动 + bundle 解析 + 响应式                      │
├─────────────────────────────────────────────────────┤
│ 阶段 C: 接管 (A/B 都完成后)                           │
│  Vue 树 diff → 增量 JSI 更新 Native View              │
└─────────────────────────────────────────────────────┘
```

### 接管协议（避免闪烁）

```ts
interface TakeoverProtocol {
  // C 阶段: Vue 渲染结果与 A 的静态 View 树做 key 匹配
  reconcile(existing: NativeViewTree, fromVue: VNodeTree): Patch[]
  // 仅差异部分走 JSI, 最小化抖动
}
```

**关键约束**：A 阶段渲染的 View 树必须与 C 阶段 Vue 首屏结构 **key 一致**，否则接管时闪烁。Compiler 保证 AOT 与 Vue 模板产物结构一致（同一份 SFC 编译，天然一致）。

---

## 4. 机制 (3)：JSI 预热 + 懒注册

```ts
// App 启动早期 (闪屏阶段)
function preheat() {
  engine.fork()                    // 提前 fork JS 引擎
  jsi.registerCoreBindings()       // 只注册核心 HostObject
  // T1+T3 分摊到闪屏期, 首帧时不计
}

// 非首屏模块按需
jsi.lazyRegister('camera', () => import('./bindings/camera'))
```

---

## 5. 机制 (4)：UI Worklet 隔离

```ts
// 业务声明 (自动被 Compiler 提取)
const onScroll = worklet((offset: number) => {
  'use worklet'  // Compiler 标记 → 提取到 UI runtime
  nativeView.setTranslationY(offset)  // JSI 同步调 Native
})

// 手势绑定 (p-* 组件内置)
<pg-scroll @scroll="onScroll" />  // onScroll 运行在 UI 线程
```

**线程归属**：
- 默认：`worklet` 函数在 **UI 线程** 执行（可直接 JSI 同步改 Native）
- 副作用：通过 `runOnJS()` 回到 JS 线程

对齐 `proteus-app-renderer-plan/05-thread-model.md`（JS/UI/Worklet 三线程）。

---

## 6. 性能预算（对齐 `app-renderer/10-audit-performance`）

| 指标 | 当前 | 目标 | 测量方式 |
|------|------|------|---------|
| 冷启动首帧 | ~400ms | **<200ms** | `proteus audit app --startup` |
| TTI | ~600ms | **<300ms** | Lighthouse 移动端 |
| 长列表滚动 | 30-45fps | **≥58fps** | 真机 1000 条 + DevTools FPS |
| JSI 调用 P99 | <2ms | **<0.5ms** | TraceBus 采样 |
| AOT 产物体积 | - | **<首屏 JS 的 30%** | bundle 分析 |

---

## 7. 验收（G-30 完成标准）

- [ ] AOT 产物可序列化/反序列化，指令执行正确
- [ ] 静态首帧 <200ms（真机 3 端：iOS/Android/鸿蒙）
- [ ] 接管无闪烁（key 一致性 100%）
- [ ] Worklet 手势 60fps
- [ ] `proteus audit app --startup` 纳入 CI 门禁
- [ ] 三端（Web/Skyline/App）启动性能均达标（见 `04-per-end-startup.md`）
