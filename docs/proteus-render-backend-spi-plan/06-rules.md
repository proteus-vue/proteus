# G-37 严格规则（Rules）

> 铁律 + 补充规则。编号已避让既有规则（G-27 ~ G-36、CMP001 ~ CMP022）。

---

## 一、铁律（G-37.1 ~ G-37.6）

### G-37.1 — 语义分发铁律

> **Backend 必须基于 `ComponentIRNode.semantic` 字段分发渲染逻辑，禁止基于标签名字符串。**

```typescript
// ✅ 正确
switch (ir.semantic) {
  case 'layout.grid': return this.createGrid(ir)
  case 'ui.button':   return this.createButton(ir)
}

// ❌ 禁止
if (ir.tagName === 'view')  return this.createView()
if (ir.tagName === 'swiper') return this.createSwiper()
```

**理由**：标签名是平台绑定（小程序/Web），`semantic` 是框架语义层。基于标签名 = 退化为翻译派。

**检查**：conformance C-01 验证 `semantic` 分发；静态扫描禁止 `tagName` / `nodeName` 出现在 Backend 分发逻辑中。

---

### G-37.2 — IR 只读铁律

> **Backend 对 C-IR 是只读消费，不得修改 IR 节点。**

```typescript
// ❌ 禁止
createNode(ir: ComponentIRNode) {
  ir.props.disabled = true  // 禁止修改
  ir.semantic = 'ui.div'   // 绝对禁止
}

// ✅ 正确
createNode(ir: ComponentIRNode) {
  const native = this.createNative(ir.semantic, { ...ir.props })  // 拷贝后使用
}
```

**理由**：IR 是框架（G-29）产出的单一事实源。Backend 修改 IR 会导致：
- Diff 计算错误（框架持有的 IR ≠ Backend 持有的 IR）
- 调试困难（DevTools 显示的 IR 不反映真实状态）
- 多 Backend 间状态不一致

**例外**：Backend 可创建**派生数据**（如从 IR 计算的缓存），但不得写回 IR。

---

### G-37.3 — 能力诚实声明铁律

> **`RenderCapabilities.supports` 必须如实声明。未声明的能力视为不支持。**

```typescript
// ✅ 正确：不支持就声明 false
supports: {
  'visual.blur': false,   // 明确声明不支持
  'gesture.hover': false, // 移动端无 hover
}

// ❌ 禁止：声明支持但实际未实现
supports: {
  'gesture.pinch': true,  // 声明支持
}
// ... 但 bindGesture 中 case 'pinch' 未处理 → conformance C-05 失败
```

**理由**：G-30 Tier 降级机制依赖 `capabilities`。声明不实 → 框架编译期降级判断错误 → 运行时崩溃。

**检查**：conformance C-05 对每个声明 `true` 的能力执行实际调用，未实现 → FAIL。

---

### G-37.4 — 线程一致性铁律

> **所有 SPI 方法必须从同一线程调用。Backend 内部多线程须自行同步。**

```
[REQUIRE]  createNode / updateNode / deleteNode / setAttribute / setStyle / bindGesture
          → 全部由框架从同一线程调用
[REQUIRE]  Backend 内部如需多线程（如 Flutter UI/GPU 分离），自行同步
[PROHIBIT] SPI 方法内执行网络 / 磁盘 IO（阻塞 UI 线程）
[PROHIBIT] NodeHandle 跨线程传递（除非 Backend 明确支持）
```

**理由**：跨线程调用 → 竞态条件 → UI 不一致 / 崩溃。框架保证单线程调用，Backend 只需关注内部同步。

---

### G-37.5 — Conformance 准入铁律

> **Conformance 测试必须 0 失败。声明支持的能力必须全部通过。**

```
[PASS 条件]  C-01 ~ C-10 全部通过，0 失败
[FAIL 后果] 不得宣称 "Proteus Compatible"
[例外机制]  capabilities 中声明不支持的能力 → 对应测试自动跳过
```

**理由**：conformance 是「合规」的客观门槛。降低门槛 → 生态碎片化 → "Proteus Compatible" 失去意义。

**检查**：`proteus conformance --backend <path>` 退出码 0 = PASS，非 0 = FAIL。

---

### G-37.6 — 降级可见铁律

> **能力不支持时的降级行为必须可见（开发期警告 + 生产期日志）。**

| 模式 | 降级表现 |
|------|---------|
| 开发 | 红色占位框 + 控制台警告（含缺失能力名 + Backend ID） |
| 生产 | 静默占位节点 + 日志上报（不崩溃） |

```typescript
// ✅ 正确
createNode(ir: ComponentIRNode) {
  if (ir.degradation?.['capability.scan-qr'] === 'unsupported') {
    if (import.meta.env.DEV) {
      return this.createRedBox('scanQR unsupported on ' + this.id)
    }
    return this.createPlaceholder()
  }
}
```

**理由**：降级不可见 → 开发者不知道某端缺失能力 → 线上 bug。G-30 Tier 降级的核心是「显式」，不是「静默」。

---

## 二、补充规则（CMP023 ~ CMP028）

### CMP023 — 最小接口原则

> **SPI 方法数 ≤ 20。新增方法须经「组合性审查」，能用现有方法组合则不得新增。**

当前方法数：**18**（含 1 个可选 `applyLayout`）。

**检查**：静态扫描接口定义，方法数 > 20 → 拒绝合并。

---

### CMP024 — NodeHandle 不透明原则

> **NodeHandle 对框架是不透明的。框架不得解读其内容、不得假设其类型。**

```typescript
// ✅ 正确：框架只做传递
const handle = backend.createNode(ir)
backend.insertChild(parent, handle, 0)

// ❌ 禁止：框架假设 NodeHandle 是数字
if (typeof handle === 'number') { ... }  // 禁止
```

**理由**：NodeHandle 的具体类型由 Backend 决定（对象 / 数字 / symbol）。框架假设类型 → 跨 Backend 不兼容。

---

### CMP025 — 差分完整性原则

> **`updateNode` 必须处理所有 `IRDiff` 类型。新增 Diff 类型须同步更新所有 Backend。**

```typescript
updateNode(handle: NodeHandle, changes: IRDiff[]): void {
  for (const change of changes) {
    switch (change.type) {
      case 'set-attr':    ...
      case 'remove-attr': ...
      case 'set-style':   ...
      case 'insert-child':...
      case 'remove-child':...
      case 'set-text':    ...
      case 'replace':     ...
      default:
        // exhaustive check（TypeScript 编译期保证）
        const _exhaustive: never = change
        throw new Error(`Unhandled IRDiff: ${JSON.stringify(change)}`)
    }
  }
}
```

**理由**：遗漏 Diff 类型 → 增量更新丢失 → UI 不一致。

---

### CMP026 — 资源释放原则

> **`dispose()` 必须释放所有原生资源。调用后任何 SPI 方法必须抛错（不得崩溃进程）。**

```typescript
dispose(): void {
  // 1. 解绑所有手势
  for (const binding of this.gestureBindings) binding.unbind()
  // 2. 销毁原生节点树
  this.rootNode.destroy()
  // 3. 释放渲染管线
  this.pipeline.release()
  // 4. 标记已销毁
  this.destroyed = true
}

createNode(ir: ComponentIRNode): NodeHandle {
  if (this.destroyed) throw new Error('Backend already disposed')
  // ...
}
```

**理由**：资源泄漏 → 内存溢出（尤其热重载场景）。

---

### CMP027 — 手势映射完备原则

> **Backend 必须处理所有声明支持的手势类型。未声明的手势 bindGesture 返回 no-op binding。**

```typescript
bindGesture(handle: NodeHandle, gesture: GestureIR): GestureBinding {
  if (!this.capabilities.supports[`gesture.${gesture.type}`]) {
    // 未声明 → no-op（不抛错，不崩溃）
    return { unbind: () => {} }
  }
  // 已实现 → 正常绑定
  return this.bindNative(handle, gesture)
}
```

**理由**：抛错 → 运行时崩溃。no-op + 警告 → 优雅降级。

---

### CMP028 — 首帧预算原则

> **`initialize()` + 首帧渲染必须在 16ms（60fps）内完成（低端机放宽至 33ms / 30fps）。**

| 设备等级 | 首帧预算 | 备注 |
|---------|---------|------|
| 旗舰 | 16ms | 60fps |
| 中端 | 20ms | 50fps |
| 低端 | 33ms | 30fps（含 TV / 车机） |

**检查**：conformance C-10 性能测试测量首帧耗时，超标 → FAIL。

**理由**：首帧是用户体验的第一印象。超预算 → 感知卡顿。

---

## 三、编号避让记录

| 规则 | 编号 | 避让说明 |
|------|------|---------|
| 铁律 | G-37.1 ~ G-37.6 | 避让 G-27 ~ G-36 铁律 |
| 补充 | CMP023 ~ CMP028 | 避让 CMP001 ~ CMP022 |

**校验**：编号冲突检测由规约 G 表 + `check-consistency` 门禁确认无重复（详见 `00-architecture-update.md` §2.3）。

---

> **Related**：01-render-backend-spi.md（主文档）· 02-conformance-suite.md（测试套件）· 03-implementation-guide.md（实现指南）
