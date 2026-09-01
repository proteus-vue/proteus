---
title: "Vue DevTools 接入策略（G-19 补充）"
plan: G-19 / DevTools
status: draft-ready
---

# Vue DevTools 接入策略

> **结论**：Proteus DevTools 采用「**Vue DevTools 前端复用 + 自研 Backend 适配**」策略——UI 面板直接用 Vue DevTools
> 现成的（Components + 自定义 Inspector 标签页），Proteus 运行时数据通过 `@vue/devtools-api` 的
> `setupDevtoolsPlugin` 接进后端。**不 fork Vue DevTools 源码**，只依赖公共 API。

---

## 1. 分层结论（一句话版）

| Target | Frontend（UI 面板） | Backend（数据来源） | 成本 |
|--------|--------------------|--------------------|----|
| **Web** | Vue DevTools 浏览器扩展（原生） | Vue 运行时自动注入 | **零成本** |
| **App（iOS/Android/鸿蒙 JSI）** | 复用 Vue DevTools Frontend（Electron shell / 嵌入小程序开发者工具） | **自研 Backend**：Debug 包起 WS Bridge | 需实现 Backend 适配层 |
| **Skyline（小程序）** | 同 App 端 | 同上，WS Bridge | 需实现 Backend 适配层 |

**关键洞察**：Vue DevTools 6+ 是 **client-server 架构**——前端 UI 是固定面板，后端通过
`@vue/devtools-api` 的 `setupDevtoolsPlugin()` 注册。**任何 Vue 插件/运行时都可注册自定义 inspector，
往里塞任意树 + 任意 state。** Vue Router、Pinia 都是这么接的——它们也不是 Vue DevTools 内置的。

---

## 2. Web 端：开箱即用

Vue DevTools 原生就认 Vue 3 的 Custom Renderer。Proteus 用 `createRenderer` 出来的组件树、props、
响应式状态，**Components 面板直接能看到，不需要写一行后端代码**。

只需在开发模式挂载：

```ts
// runtime/devtools.ts（仅 __DEV__ 引入）
import { setupDevtoolsPlugin } from '@vue/devtools-api'
import { proteusRuntime } from './runtime'

export function installDevtools(app: any) {
  setupDevtoolsPlugin(
    { id: 'proteus-runtime', label: 'Proteus', app,
      packageName: '@proteus-vue/runtime', homepage: '...' },
    (api) => registerAll(api),
  )
}

function registerAll(api: DevtoolsPluginApi) { /* 见第 3 节 */ }
```

---

## 3. 四个自定义 Inspector（核心接入）

```ts
function registerAll(api: DevtoolsPluginApi) {
  // ① Proteus Native Tree：原生 View 层级（替代 DOM 树）
  api.addInspector({ id: 'proteus-native-tree', label: 'Proteus Native Tree', icon: 'stack' })
  api.on.getInspectorTree((p) => {
    if (p.inspectorId !== 'proteus-native-tree') return
    p.rootNodes = proteusRuntime.getNativeTree()
  })
  api.on.getInspectorState((p) => {
    if (p.inspectorId !== 'proteus-native-tree') return
    p.state = proteusRuntime.getNodeState(p.nodeId)
  })

  // ② Style Safety：运行时拦截记录（对接 G-16）
  api.addInspector({ id: 'proteus-style-safety', label: 'Style Safety', icon: 'shield' })
  api.on.getInspectorState((p) => {
    if (p.inspectorId !== 'proteus-style-safety') return
    p.state = [{ key: 'rejected', value: styleSafety.getRejectedRecords() }]
  })

  // ③ App Config：当前生效值（对接 G-20）
  api.addInspector({ id: 'proteus-app-config', label: 'App Config', icon: 'settings' })
  api.on.getInspectorState((p) => {
    if (p.inspectorId !== 'proteus-app-config') return
    p.state = [{ key: 'resolved', value: appConfig.getResolved() }]
  })

  // ④ Timeline：JSI 调用 / AOT·IFR 首帧
  api.addTimelineLayer({ id: 'proteus-jsi', label: 'Proteus JSI', color: 0x2d8cf0 })
  api.addTimelineLayer({ id: 'proteus-ifr', label: 'Proteus AOT/IFR', color: 0x19be6b })
  proteusRuntime.onJsiCall((e) => api.addTimelineEvent({
    layerId: 'proteus-jsi', event: { time: Date.now(), title: e.op, data: e },
  }))
  aot.onFirstFrame((t) => api.addTimelineEvent({
    layerId: 'proteus-ifr', event: { time: Date.now(), title: 'IFR ready', data: { ms: t } },
  }))
}
```

**覆盖**：Native View 层级树 / 每个节点的 `p-flex` · `p-safe-*` · `<p-glass>` 实参 / Style Safety 拦截记录 /
JSI 调用时序 / AOT·IFR 首帧耗时 / App Config 当前值。

---

## 4. App / Skyline 端：自研 Backend 适配层

```
┌────────────────────┐         WebSocket          ┌────────────────────┐
│  Proteus Runtime    │  ─────────────────────▶   │  Vue DevTools      │
│  (iOS/Android/鸿蒙) │     Bridge Protocol        │  Frontend          │
│  - IR Tree          │     （devtools-api         │  - Components      │
│  - JSI Calls        │      event 名复用）        │  - Timeline        │
│  - Style Safety     │                            │  - 自定义 Inspector │
└────────────────────┘                            └────────────────────┘
                                                      ↑
                                            Electron shell / Chrome 插件
                                            / 嵌入小程序开发者工具
```

- **协议**：直接复用 `@vue/devtools-api` 的 Bridge 消息格式（event 名一致），Frontend 无感知。
- **编辑回写**：监听 `editInspectorState`，经 JSI 下发改原生 View（见第 6 节）。

---

## 5. 三个边界（G-19 铁律）

| # | 边界 | 说明 |
|---|------|------|
| 1 | **Web 白嫖，非 Web 自建 Backend** | Components 面板原生可用；原生子树走自定义 inspector |
| 2 | **Components 只看 Vue 组件层** | 组件下原生 View（UIView/ArkUI Node）需走 `proteus-native-tree` |
| 3 | **编辑回写需自研** | `editInspectorState` 改响应式数据白给；改 `p-flex` gap 需自己监听 + JSI 下发 |

---

## 6. 编辑回写（双向调试）

```ts
api.on.editInspectorState((p) => {
  if (p.inspectorId !== 'proteus-native-tree') return
  // 开发者在面板改 gap → 经 JSI 下发到原生 View
  proteusRuntime.applyEdit(p.nodeId, p.path, p.state.value)
})
```

这是 G-19「双向调试」的落地方式，不是 Vue DevTools 白给的。

---

## 7. 对齐 Architecture 原则

- **原则 #10（统一语义 + 原生实现）**：DevTools 同样——框架定义 Inspector 语义（IR 树 / JSI 事件 / Safety 记录），
  各端用 Vue DevTools Frontend 呈现。
- **原则 #11（插件化，G-21）**：DevTools 后端本身实现为 Compiler Plugin，开发模式自动注入，生产模式 tree-shake。

## 8. 严格规则

- `DEV001`：禁止在生产包内保留 DevTools Backend（体积 + 安全）
- `DEV002`：Backend 必须通过 WS 桥接，禁止直接耦合 Frontend DOM
- `DEV003`：自定义 Inspector 的 state 必须是可序列化结构（不可传原生句柄）

## 9. 验收

- Web：Chrome 扩展连上，Components 看到 SFC 组件树 + 三个自定义 Inspector 有数据
- App：Electron shell 连 WS，Native Tree 实时刷新，编辑 gap 原生 View 同步变化
- 性能：Backend 序列化开销 < 3%（对齐 Style Safety 预算）

---

## 10. 对外话术（positioning.md 引用）

> **调试体验复用 Vue DevTools 生态**：Proteus 不重新发明调试器，而是把原生层（IR 树 / JSI 调用 /
> Style Safety 拦截 / 安全区实参）通过自定义 Inspector 暴露给 Vue DevTools；Web 端零成本，
> App / 小程序端复用其 Frontend + 自研 Backend 适配层。
