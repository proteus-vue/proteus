# Vue 绑定架构（G-41 核心）

> 回答：**为什么开发者始终写 Vue，而渲染引擎可以自由切换？**

---

## 1. 结论先行

> **Vue 在 Proteus 里是「编译器 + 响应式引擎」，不是「渲染引擎」。**
> 渲染的最后一步（nodeOps）是 SPI，RenderBackend 插进去就行。
> **切换引擎 = 换 nodeOps 的转发目标，Vue 与业务代码完全不感知。**

---

## 2. 完整链路

```
┌────────────────────────────────────────────────────────┐
│ 业务 SFC（永远不变）                                     │
│   <template><p-grid :min-col-width="160">…</p-grid></template> │
└──────────────────────┬─────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────────┐
│ Vue 编译器（永远不变）                                   │
│   @vue/compiler-sfc → render() 函数                     │
└──────────────────────┬─────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────────┐
│ Vue 响应式 + renderer 内核（永远不变）                   │
│   reactive / effect / VNode diff                        │
└──────────────────────┬─────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────────┐
│ ★ ProteusNodeOpsDispatcher（唯一的变量）                 │
│   createElement → currentBackend.createNode(IR)         │
│   insert        → currentBackend.insertChild(…)         │
│   patchProp     → currentBackend.setAttribute(…)        │
└──────────────────────┬─────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────────┐
│ ProteusRenderBackend（可插拔）                           │
│   VueDom / iOS-UIKit / Android-View / Flutter / Skia    │
└──────────────────────┬─────────────────────────────────┘
                       ↓
                   原生 UI 树
```

**关键点：上面三层永远不变，只有 Dispatcher 的转发目标在变。**

---

## 3. Dispatcher 设计（方案 B）

### 3.1 为什么选方案 B

**方案 A（每页面一个 renderer）** 在"同页面混合渲染"时无解：

```html
<!-- 同一页面：主体原生 + 内嵌 Skia 图表 -->
<p-box>
  <p-list>…</p-list>                  <!-- NativeBackend -->
  <p-canvas engine="skia">…</p-canvas> <!-- SkiaBackend -->
</p-box>
```

方案 A 下 renderer 与 Backend 一对一绑定，无法在同一页面内分派两个引擎。

**方案 B（全局 renderer + 转发层）** 天然支持，且开销只多一次间接调用。

### 3.2 接口

```ts
interface ProteusNodeOpsDispatcher {
  currentBackend: ProteusRenderBackend
  switchBackend(b: ProteusRenderBackend): void
}

// Vue 侧的 nodeOps（转发到 currentBackend）
const proteusNodeOps = {
  createElement(type, props) {
    // type 是 'p-grid' 这类语义标签 → 转成 IR 再下发
    return currentBackend.createNode(toIRNode(type, props))
  },
  insert(child, parent, anchor) {
    currentBackend.insertChild(parent, child, anchor)
  },
  patchProp(el, key, prev, next) {
    if (key === 'class') currentBackend.setAttribute(el, 'class', next)
    else if (isStyleKey(key)) currentBackend.setStyle(el, { [key]: next })
    else currentBackend.setAttribute(el, key, next)
  },
  remove(child) { currentBackend.deleteNode(child) },
  setElementText(el, text) { currentBackend.setText(el, text) },
  createText(text) { return currentBackend.createNode(toTextNode(text)) },
  createComment(text) { return currentBackend.createNode(toCommentNode(text)) },
  parentNode(node) { return currentBackend.getParent(node) },
  nextSibling(node) { return currentBackend.getNextSibling(node) },
}
```

**注意**：`createElement` 收到的是 `'p-grid'` 这样的**语义标签字符串**，Dispatcher 负责 `toIRNode()` 转成 `ComponentIRNode`。这一步是 G-31/G-32 语义原语表驱动的——**标签必须在 128 原语表内，否则编译期就报错**（不在运行期才发现）。

### 3.3 标签 → IR 的转换

```ts
function toIRNode(type: string, props: Record<string, unknown>): ComponentIRNode {
  const spec = PRIMITIVE_TABLE[type]   // G-32 的 128 原语表
  if (!spec) {
    // 编译期就该拦下；运行期兜底
    throw new ProteusError('unknown.primitive', { type })
  }
  return {
    id: nextId(),
    semantic: spec.semantic,        // 'layout.grid' —— ★ 后端按 semantic 分发
    tag: type,                      // 仅调试用，后端不得依赖
    props: normalizeProps(spec, props),
    degradation: spec.degradation,  // G-30 Tier 降级策略
  }
}
```

**再次强调（对齐 G-37.1）**：后端读的是 `semantic: 'layout.grid'`，**不是** `'p-grid'` 这个字符串。这是与 Lynx `__CreateElement('view', …)` 的分界线。

---

## 4. 引擎切换的三种触发方式

| 方式 | 场景 | 代码 |
|------|------|------|
| **静态配置** | 构建期决定 | `defineConfig({ render: { backend: 'native' } })` |
| **路由守卫** | 不同页面不同引擎 | `router.beforeEach(to => switchBackend(createBackend(to.meta.backend)))` |
| **DevTools 热切换** | 开发期对比 | DevTools 下拉 → `switchBackend(b)` |

**路由守卫示例：**

```ts
const routes = defineRoutes({
  '/product/:id':    { component: ProductDetail, meta: { backend: 'native' } },
  '/brand-campaign': { component: Campaign,      meta: { backend: 'flutter' } },
  '/dashboard':      { component: Dashboard,     meta: { backend: 'skia' } },
})

router.beforeEach(async (to) => {
  await switchBackend(createBackend(to.meta.backend))
})
```

**业务代码完全一样**——都是 `<p-grid>` / `<p-card>`，只是运行时加载不同 Backend。

---

## 5. 切换时的节点处理

`switchBackend` 触发后，已渲染节点有三种处理策略，由 Backend 的 `capabilities.rehydrate` 决定：

| 策略 | 条件 | 行为 |
|------|------|------|
| **rehydrate** | `rehydrate: true` | 旧节点树 → IR → 新 Backend 重建（保状态） |
| **rebuild** | `rehydrate: false` | 销毁重建（状态丢失，开发期可接受） |
| **hybrid** | 混合渲染 | 保留未受影响子树，只重建目标区域 |

**开发期（DevTools 热切换）用 rebuild**（快、无副作用）；**生产期（路由切换）用 rehydrate**（保状态）。

---

## 6. 与 Vue 生态的兼容

| Vue 能力 | 是否可用 | 说明 |
|---------|---------|------|
| SFC / `<script setup>` | ✅ | 编译层不变 |
| Composition API | ✅ | 响应式不变 |
| `v-if` / `v-for` / `v-model` | ✅ | 编译成 render 函数，与平台无关 |
| 自定义指令 | ⚠️ 部分 | 涉及 DOM 的指令需 Backend 提供等价能力 |
| `v-html` | ⚠️ | 需 Backend 支持富文本（G-32 `<p-richtext>`） |
| Teleport | ✅ | 映射到 Backend 的 portal 能力 |
| Suspense | ✅ | 框架层实现，与平台无关 |
| Transition | ⚠️ | 需 Backend 提供动画能力（G-27 capabilities 声明） |

**原则**：凡是"框架层可实现"的 Vue 能力全部可用；凡是"依赖 DOM"的需 Backend 声明支持，**不支持则编译期报错**（不是运行期崩）。

---

## 7. 为什么竞品做不到

| 框架 | 绑定 | 能否换引擎 |
|------|------|-----------|
| **uni-app / Taro** | 编译期翻译到各端组件 | ❌ 编译完就锁定 |
| **React Native** | JSI → 原生组件 | ❌ 锁死原生 |
| **Flutter** | Dart → Skia/Impeller | ❌ 锁死自绘 |
| **Lynx** | 双线程 → 原生渲染引擎 | ❌ 锁死 Lynx 引擎 |
| **Proteus** | Vue → nodeOps SPI → 任意 Backend | ✅ **运行时可切换** |

**根本差异**：竞品把"渲染引擎"写进了框架本体；Proteus 把它外置成了 SPI 插槽。

---

## 8. 机器可检查的断言

`host-conformance.md` 的 H-03 组会实际执行：

```js
// 同一份 SFC，两个引擎，断言 IR 完全一致
const irA = compile(sfcSource)   // 编译一次
renderWith(backendA, irA)
renderWith(backendB, irA)        // ★ 复用同一份 IR
assert(irSnapshotEqual(irA, irB))
```

**只要"同一份 IR 在两个引擎下都能渲染"，就证明了"Vue 代码不变、引擎可换"。**
