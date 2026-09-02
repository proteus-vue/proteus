# G-37 RenderBackend SPI — 快速参考卡

> 一页速查。完整内容见 [01-render-backend-spi.md](./01-render-backend-spi.md)。

---

## 1. 接口速览（18 + 1 可选）

```
身份     id · version · capabilities
生命周期  initialize · dispose
节点     createNode · updateNode · deleteNode
         insertChild · removeChild · clearChildren
属性     setAttribute · removeAttribute · setStyle · setText
布局(可选) applyLayout
手势     bindGesture
挂载     getRootContainer · attachToHost
```

---

## 2. 生命周期状态机

```
Created → Initializing → Attached → Rendering ⇄ HotReload → Disposing → Destroyed
              ↑                                        ↓
         initialize()                            dispose()
```

**异常转换**：
- `initialize()` 失败 → 重试 N 次 → 降级 StubBackend
- 节点操作失败 → 占位节点（dev: 红色框 / prod: 静默）
- `dispose()` 后调用方法 → 抛错（不崩溃进程）

---

## 3. semantic 分发（G-37.1）

```typescript
switch (ir.semantic) {
  case 'layout.grid':  return createGrid(ir)
  case 'ui.button':    return createButton(ir)
  case 'capability.scan-qr': return createScanQR(ir)
  default:             return createFallback(ir)  // 不抛错
}
```

**命名空间**：`layout.*` `ui.*` `shell.*` `gesture.*` `capability.*` `engineering.*`

---

## 4. 降级处理（G-37.6）

| degradation | Backend 行为 |
|-------------|-------------|
| `unsupported` | dev: 红色框 + 警告 / prod: 空节点 |
| `fallback` | 渲染降级实现（如 scanQR → 手动输入） |
| `stub` | 最小占位 |

---

## 5. capabilities 声明

```typescript
supports: {
  'layout.grid': true,    // 必须实现
  'gesture.hover': false, // 声明 false → conformance 跳过
  // ...
}
tier: 1 | 2 | 3 | 4
layoutMode: 'framework' | 'backend'
threadModel: 'main' | 'background' | 'dedicated'
```

**诚实原则**：不确定 → `false`。声明 `true` 但未实现 → conformance 失败。

---

## 6. Conformance（G-37.5）

```bash
proteus conformance --backend ./my-backend.js
```

| 类别 | 测试数 | 说明 |
|------|--------|------|
| C-01 | 8 | 节点操作 |
| C-02 | 5 | 属性样式 |
| C-03 | 2 | 文本 |
| C-04 | 4 | 布局 |
| C-05 | 6 | 手势 |
| C-06 | 5 | 生命周期 |
| C-07 | 4 | 降级 |
| C-08 | 3 | 差分 |
| C-09 | 2 | 线程安全 |
| C-10 | 3 | 性能 |
| | **42** | **0 失败 = 兼容** |

---

## 7. 铁律速记

| # | 铁律 |
|---|------|
| G-37.1 | 基于 `semantic` 分发，禁标签名 |
| G-37.2 | C-IR 只读，不得修改 |
| G-37.3 | capabilities 诚实声明 |
| G-37.4 | 同一线程调用 |
| G-37.5 | Conformance 0 失败 |
| G-37.6 | 降级可见 |

---

## 8. 已知 Backend

| Backend | 目标 | 布局 | Tier | 状态 |
|---------|------|------|------|------|
| vue-dom | 浏览器 DOM | framework | 1 | ✅ 参考 |
| terminal | ASCII 字符 | backend | 3 | ✅ 参考 |
| ios-uikit | UIKit | framework | 1 | 📋 B4 |
| android-view | ViewGroup | framework | 1 | 📋 B4 |
| flutter | Widget Tree | backend | 1 | 📋 B4 |
| skia | Canvas | backend | 1 | 📋 B5 |
| harmony-arkui | ArkUI | framework | 1 | 📋 B5 |
| tv-10ft | 焦点导航 | framework | 2 | 📋 B5 |
| watch-os | SwiftUI | framework | 2 | 📋 B5 |

---

> **Full docs**：[README](./README.md) · [主文档](./01-render-backend-spi.md) · [规则](./06-rules.md) · [conformance](./02-conformance-suite.md) · [实现指南](./03-implementation-guide.md) · [分批](./batches.md)
