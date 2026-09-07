# 业务组件规范（M6）

> P0 业务组件仅 5 个，且**只做“组合 + 规范插槽”，不内聚业务逻辑**。业务逻辑一律在 store / service 层。

---

## 0. 铁律
1. 业务组件 **不得** 直接调用 `wx.*`、`fetch`、`wx.requestPayment`。
2. 数据通过 Props 传入；动作通过 Emit 上抛；副作用通过 `api` + store。
3. 全局态（播放进度、登录态）走 Pinia store，组件只 `useXxxStore()`。
4. 组件目录自带 `*.ir.md`（IR 契约）+ `transform.ts` + `index.ts`。

---

## 1. `p-player-bar`（全局播放控制条）

**定位**：音乐 App 那种“跨页常驻、状态不丢、页面零标签”。
**实现**：走 **Skyline `appBar` 全局层**（Router M5），Web 走 SPA 根挂载。
**依赖**：Pinia `player` store（audioContext 单例 + reactive state）。

```vue
<!-- 业务页面：零标签，仅声明 appBar -->
<!-- 在路由配置或 mountMpApp({ appBar: PPlayerBar }) 注册一次 -->
```

**Props**
| Name | Type | 说明 |
|------|------|------|
| `theme` | ThemeToken | 覆盖主题 |

**内部实现要点**
- 播放状态读 `usePlayerStore()`（currentTrack / progress / isPlaying）
- 进度更新走 `requestAnimationFrame` + 节流，避免高频 `setData`
- seek 操作调用 `playerStore.seek()` → store 调 `audioContext`
- 切页不销毁：appBar 实例常驻（Skyline）/ SPA 根节点（Web）

**禁止**
- 在组件内 `new AudioContext()` → 必须由 store 单例管理
- 用页面级 state 存当前歌曲 → 切页丢失

---

## 2. `p-payment-sheet`（支付面板）

**Props**
| Name | Type | 说明 |
|------|------|------|
| `order` | Order | 订单信息（来自业务） |
| `visible` (v-model) | boolean | |

**Events**：`@success`、`@fail`、`@cancel`

**规则**
- 点击确认 → emit `confirm` → 页面调用 `api.payment.pay(order)` → 结果回传显式
- 组件本身**不请求支付接口**、不处理金额计算

---

## 3. `p-login-gate`（登录拦截占位）

**Props**
| Name | Type | 说明 |
|------|------|------|
| `require` | `'login'\|'auth'` | 拦截级别 |

**规则**
- 读 `useAuthStore()` 的 `isAuthenticated`
- 未登录 → 渲染登录入口插槽 + emit `unauthenticated`
- 不自行跳转：跳转由 Router guard 或页面处理（对齐 Router M6）

---

## 4. `p-error-boundary`（错误兜底，M8.5）

**Slots**：`default`（正常内容）、`fallback`（错误态）

**规则**
- Vue `errorCaptured` + `onErrorCaptured` 捕获子树错误
- Skyline 侧：全局 `App.onError` + 组件级 try 兜底
- 上报统一 `traceId`（与 API/Router Observability 打通）
- 开发态显示错误栈；生产态只显示 fallback 插槽

---

## 5. `p-skeleton`（骨架屏）

**Props**
| Name | Type | 说明 |
|------|------|------|
| `loading` | boolean | 是否加载中 |
| `shape` | `'text'\|'rect'\|'circle'` | 形状 |
| `count` | number | 数量 |

**规则**
- 绑定 store 的 `loading` 标志，不自管定时器
- 长列表骨架配合 `p-list-view` 的 `item-placeholder`

---

## 6. 全局组件注册（对齐前面讨论）

| 类型 | 注册方式 | 页面是否写标签 |
|------|----------|----------------|
| **内置基础组件**（`p-*`） | 编译期自动全局（`usingComponents` 自动注入） | 否 |
| **业务组件** | `mountMpApp({ components: { PPlayerBar } })` → app.json | 否（appBar 类）或按需在页面引用 |
| **框架原语**（`proteus-*`） | `ComponentSpace.setGlobalUsingComponent` | 否 |

> 这与 Pinia / Router 的“挂载一次、全局生效”原则一致，且产物可审计（`app.json.usingComponents`）。

---

## 7. 验收
- 5 个业务组件均可在“不写任何 `wx.*`”前提下完成功能。
- `p-player-bar` 跨 3 个页面切页，播放不中断、进度不归零。
- CI：`proteus audit component` 扫描业务组件 import 违规。
