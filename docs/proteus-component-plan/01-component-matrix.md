# 组件三端对照矩阵（P0 首期重点）

> 本文是「兼容与原生映射」的**唯一真相源**：每个内置组件在这里逐条声明 Props / 事件 / 插槽在 Web 与 Skyline 下的映射及降级行为。
> 新增组件必须同步追加本章节，否则 CI 阻断。

---

## 0. 矩阵符号约定

| 标记 | 含义 |
|------|------|
| ✅ | 双端语义一致，可直接映射 |
| 🔶 | 语义近似，存在可接受的差异（注明） |
| ⚠️ | Skyline 不支持或行为不同，**必须降级 + warn** |
| ❌ | Skyline 无对应能力，**不提供该 Prop**（改用替代方案） |
| N/A | 该端不适用 |

---

## 1. `p-view`（通用容器）

| Prop / 事件 | Web | Skyline | 状态 | 降级说明 |
|-------------|-----|---------|------|----------|
| `class` / `style` | ✅ | ✅ | | scoped 哈希一致 |
| `:style` 动态绑定 | ✅ | ✅ | 走 setData / node API | |
| `display` | ✅ | 🔶 默认 `block` | | 未声明时 Skyline=block，Web=inline，统一在 runtime 注入默认值 |
| `box-sizing` | ✅ | 🔶 默认 `content-box` | | Skyline 默认 content-box，Web 默认 border-box → **统一为 content-box** |
| `position: fixed` | ✅ | ⚠️ → `absolute` + 视口容器 | | 编译期 transform 自动转换并 warn |
| `overflow-x` | ✅ | ⚠️ 受限 | | 横向滚动必须 `scroll-view` |
| `@click` | ✅ | ✅ → `tap` | | 事件归一化为 `ProteusEvent` |
| 默认插槽 | ✅ | ✅ | | |

---

## 2. `p-text`

| Prop | Web | Skyline | 状态 | 说明 |
|------|-----|---------|------|------|
| `text` / 插值 | ✅ | ✅ | | |
| `white-space` | ✅ | ⚠️ 部分值不支持 | | `nowrap` ✅，其余降级 |
| `user-select` | ✅ | ⚠️ | | 长按时用 `selectable` 替代 |
| `aria-label` | ✅ | ✅ | | |

---

## 3. `p-image`

| Prop | Web | Skyline | 状态 | 说明 |
|------|-----|---------|------|------|
| `src` | ✅ | ✅ | | |
| `lazy-load` | ✅（IntersectionObserver） | ✅（原生 `lazy-load`） | | 统一封装 |
| `placeholder` | ✅ | ✅ `lazy-load` 占位 | | |
| `webp` | ✅ | 🔶 依赖基础库版本 | | 低版本 fallback jpg |
| `mode`（裁剪） | ✅（object-fit） | ✅ `mode` | | `aspectFill`/`widthFix` 等一一映射 |
| `@load` / `@error` | ✅ | ✅ | | |
| `recycle`（长列表） | ✅ | ✅ `recycleManager` | | 见 M3 |

---

## 4. `p-scroll-view`（Skyline 必备）

| Prop | Web | Skyline | 状态 | 说明 |
|------|-----|---------|------|------|
| `scroll-x` / `scroll-y` | ✅ | ✅ | | |
| `scroll-top` / `scroll-left` | ✅ | ✅ | | v-model 双向 |
| `refresher-enabled` | ✅ | ✅ | | |
| `lower-threshold` | ✅ | ✅ | | `@scroll-to-lower` |
| `bounces` | ✅ | ⚠️ `overscroll-behavior` | | transform 映射 |
| **页面全局滚动** | ✅ | ❌ 不支持 | | **Skyline 必须包 scroll-view**，编译期检查 |

---

## 5. `p-list-view`（虚拟长列表，M3）

| Prop | Web | Skyline | 状态 | 说明 |
|------|-----|---------|------|------|
| `items` | ✅ | ✅ | | |
| `item-key` | ✅ | ✅（必需） | | Skyline `recycleManager` 强制 |
| `virtual` | ✅ | ✅ | | 默认开启 |
| `lazy-mount` | ✅ | ✅ | | |
| `buffer-size` | ✅ | ✅ | | |
| `item-size` 预估 | ✅ | ✅ | | 动态高度策略见 M3 |

---

## 6. `p-input` / `p-textarea`

| Prop | Web | Skyline | 状态 | 说明 |
|------|-----|---------|------|------|
| `value` (v-model) | ✅ | ✅ | | |
| `type` | ✅ | 🔶 部分 type 受限 | | `password`/`number` 映射 |
| `maxlength` | ✅ | ✅ | | |
| `focus` | ✅ | ✅（Worklet） | | 焦点事件归一 |
| `@input` / `@confirm` | ✅ | ✅ | | |
| `placeholder` | ✅ | ✅ | | |

---

## 7. `p-button`

| Prop | Web | Skyline | 状态 | 说明 |
|------|-----|---------|------|------|
| `type` / `size` | ✅ | ✅ | | |
| `disabled` | ✅ | ✅ | | |
| `loading` | ✅ | ✅ | | |
| `open-type`（授权等） | N/A | ✅ | ⚠️ | Web 端该能力不可用，降级 warn |
| `throttle`（防重复） | ✅ | ✅ | | runtime 内置 |

---

## 8. `p-popup`（弹层，M4）

| Prop | Web | Skyline | 状态 | 说明 |
|------|-----|---------|------|------|
| `visible` (v-model) | ✅ | ✅ | | |
| `position` | ✅ | ✅（routeType 衍生） | | `bottom`/`center`/`halfScreen` |
| `mask` | ✅ | ✅ | | |
| `close-on-mask` | ✅ | ✅ | | |
| **转场动画** | CSS transition | Worklet `applyAnimatedStyle` | 🔶 | 见 `05-worklet-animation.md` |
| `gesture-close`（下滑关闭） | ✅ | ✅ Worklet 手势 | | |

> `p-toast` / `p-loading` 复用 Popup 渲染管线，但**走 Worklet 自定义组件**以避开 Skyline 原生 `showToast` 限制（对齐 API 层 A9）。

---

## 9. `p-nav-bar`（M5）

| Prop | Web | Skyline | 状态 | 说明 |
|------|-----|---------|------|------|
| `title` | ✅ | ✅ | | |
| `back` | ✅ | ✅（集成 appBar） | | |
| `fixed` | ✅ | ✅（appBar 天然全局） | | |
| 插槽 `left`/`right` | ✅ | ✅ | | |

---

## 10. 业务组件（M6，仅声明依赖，详细 IR 见 `04`）

| 组件 | 关键约束 |
|------|----------|
| `p-player-bar` | 全局常驻 → 走 **appBar**（Router M5），禁止逐页包裹 |
| `p-payment-sheet` | 只用 `api.payment`，组件无业务逻辑 |
| `p-login-gate` | 读 `api.auth` + Router guard 结果 |
| `p-error-boundary` | Vue `errorCaptured` + Skyline 兜底，上报统一 traceId |
| `p-skeleton` | 绑定加载态（Pinia），不自带定时器 |

---

## 11. 降级策略总原则
1. **能力探测优先**：`PlatformCapability.has('worklet-animation')` → 决定走 Web 动画还是 Worklet。
2. **静态可检测项** → 编译期 transform warn（如 `position:fixed`）。
3. **运行时才知项** → 运行时 warn + fallback（如 `webp` 支持）。
4. **禁止静默失效**：所有 ⚠️/❌ 必须 `console.warn('[Proteus][p-xxx] ...')`，并出现在 `--trace-transform` 报告。
5. **降级行为可覆盖**：通过 `proteus.config.ts` 的 `components.degradation` 全局关闭 warn（生产环境）。

---

## 12. 验收
- 每个组件的矩阵条目覆盖率 = 100%（CI 校验脚本）。
- 每个 ⚠️/❌ 必须有对应的单元测试 + 快照。
- 矩阵变更必须 PR 评审，禁止业务 PR 直接改此文件（走 RFC 流程）。
