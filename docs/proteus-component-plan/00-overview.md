# Proteus 内置组件规划（P0）

> 状态：Draft v1  
> 关联：`proteus-pinia-plan/`（状态层）、`proteus-router-plan/`（路由层）、`proteus-api-plan/`（API 层）  
> 范围：**基础组件 + 高频业务组件**  
> 首期优先级：**兼容与原生映射**（Web ↔ Skyline/glass-easel）

---

## 0. 目标与非目标

### 目标
1. 提供一套 **Proteus 内置组件**，Web 与微信小程序（Skyline）双端语义一致。
2. 内置组件是 **“平台原生能力的类型化封装”**，不是 UI 样式库。
3. 每个组件都能追溯到：Vue 用法 → IR → 平台产物（DOM / WXML+glass-easel）。
4. 组件层不重复造业务样式，业务组件只组合基础组件 + 规范插槽。

### 非目标
- 不做“覆盖所有 antd-mobile / Vant 组件”的庞大组件库。
- 不做纯 CSS 主题皮肤包（主题走 `theme` 能力域，后续独立规划）。
- 不做跨小程序厂商抹平（支付宝/抖音不在 P0；架构预留，但不承诺语义一致）。

---

## 1. 设计原则（铁律）

| # | 原则 | 说明 |
|---|------|------|
| C1 | **Web 优先映射 DOM，Skyline 优先映射 glass-easel 原生能力** | 不为了“写法一致”牺牲原生性能 |
| C2 | **Props 是跨端契约，事件是跨端契约，插槽是跨端契约** | 三端不一致时，以“Web 语义 + Skyline 能力”取交集，缺失能力显式降级 |
| C3 | **组件不包含业务接口调用** | 数据获取一律走 `api`（见 `proteus-api-plan`），组件只接收 props / emit |
| C4 | **状态不内聚全局单例** | 必要全局态（如 Toast 队列）走 Pinia store，组件只消费 |
| C5 | **编译产物可审计** | 每个组件映射一份 `IR → 双端产物` 文档，纳入 `--trace-transform` |
| C6 | **降级显式** | Skyline 不支持能力必须 `console.warn` + 提供 fallback，禁止静默失效 |
| C7 | **无障碍优先** | ARIA（Web）/ `aria-*`、focus、语义标签成对实现 |
| C8 | **性能预算** | 基础组件不引入重型依赖；长列表组件默认虚拟滚动 |

---

## 2. 四层架构

```
L4  业务页面 (.vue)
       ↓ 使用 <p-view> / <p-scroll-view> / <p-player-bar>
L3  内置组件 (@proteus/components)
       ├─ 基础组件 (Base)
       └─ 业务组件 (Business)
       ↓ Props/Slots/Events 标准化
L2  平台渲染抽象 (@proteus/runtime)
       ├─ Web Renderer (DOM)
       ├─ Skyline Renderer (glass-easel + Worklet)
       └─ App Renderer (Custom Renderer，未来)
       ↓
L1  平台原生能力
    DOM / CSSOM  |  Skyline WXML/glass-easel/Worklet  |  Native UI
```

要点：
- **L3 不允许直接调用 `wx.*`、`document.*`、`plus.*`** —— 必须走 L2 抽象。
- L2 提供 `PlatformCapability` 探测（见 `03-platform-capability.md`）。
- 业务组件只能依赖 Base 组件 + `api` + `store`，禁止绕过。

---

## 3. 组件清单（P0）

### 3.1 基础组件（Base）
| 名称 | 说明 | Skyline 映射要点 |
|------|------|------------------|
| `p-view` | 通用容器（div→view） | flex 默认；`block`/`content-box` 语义对齐 |
| `p-text` | 文本 | 不支持 `white-space` 部分值时降级 |
| `p-image` | 图片（懒加载、占位、webp） | `lazy-load` + `recycleManager` |
| `p-scroll-view` | 滚动容器 | Skyline 必须，页面滚动禁全局滚动 |
| `p-list-view` | 长列表（虚拟滚动） | `recycleManager` + `lazyMount` |
| `p-input` / `p-textarea` | 表单 | Skyline `input` 组件 + Worklet focus |
| `p-button` | 按钮 | 原生 `button` + 防重复点击 |
| `p-swiper` | 轮播 | Skyline `swiper` + 手势 |
| `p-mask` | 遮罩 | `fixed` → Skyline `cover-view`/全屏容器 |
| `p-popup` | 弹层（过渡/手势） | `routeType` + Worklet 转场（见 Router M7.4） |
| `p-toast` / `p-loading` | 反馈 | **Worklet 自定义组件**（API 层 A9 同源） |
| `p-nav-bar` | 导航栏 | appBar 集成（Router M5） |

### 3.2 业务组件（Business，P0 仅高频）
| 名称 | 说明 | 依赖 |
|------|------|------|
| `p-player-bar` | 全局播放控制条 | Pinia `player` store + appBar |
| `p-payment-sheet` | 支付面板 | `api.payment` + `p-popup` |
| `p-login-gate` | 登录拦截占位 | `api.auth` + Router guard |
| `p-error-boundary` | 错误兜底 | Router M8.5 + 上报 |
| `p-skeleton` | 骨架屏 | 与数据加载状态联动 |

> P0 业务组件 **控制在 ≤ 5 个**，其余进 P1 backlog，避免范围膨胀。

---

## 4. 统一组件契约（Component Contract）

每个组件必须实现：

### Props 规范
```ts
// 伪代码：基础 Props 约定
interface BaseProps {
  /** 跨端唯一标识，自动生成，可用于埋点 */
  pid?: string
  /** 是否禁用，统一语义 */
  disabled?: boolean
  /** 主题令牌，覆盖全局 theme */
  theme?: ThemeToken
  /** 无障碍标签 */
  ariaLabel?: string
}
```

### 事件规范
- 事件名统一 `kebab-case`：`@change`、`@scroll-to-lower`。
- Skyline 事件对象与 Web `Event` 不一致时，L2 归一化为 `ProteusEvent<T>`。

### 插槽规范
- 默认插槽 + 具名插槽（`header`/`footer`/`content`）。
- Skyline 用 `slot` 节点，不支持动态插槽名时降级为条件渲染并 warn。

### v-model 规范
- `v-model` 绑定 `value` + `update:value`；`v-model:visible` 绑定 `visible` + `update:visible`。
- Skyline 双向绑定走 `props + triggerEvent`，禁止直接改父。

---

## 5. 编译与运行时职责

| 职责 | 编译期（transforms/） | 运行期（runtime） |
|------|------------------------|-------------------|
| 标签映射 | `p-view → view`（Skyline） | — |
| Props 映射 | 静态 prop → WXML attr | 动态 prop → setData / node API |
| 事件绑定 | `@click → bindtap` | 事件归一化对象 |
| 插槽 | 具名 slot 静态分析 | 运行时分发 |
| Worklet 动画 | 识别 `:animated` / transition | 调用 `applyAnimatedStyle` |
| 降级 warn | 能力探测 + 静态报告 | 运行时 feature detect |

- 组件 **自带 transform 规则**（放在组件目录 `transform.ts`），与主编译器解耦。
- 符合 Pinia/Router 的“规则模块化 + AI 可读”原则。

---

## 6. 与既有层的关系

| 层 | 依赖方向 | 说明 |
|----|----------|------|
| Pinia | ← 组件可读 store | 组件不持有全局态 |
| Router | ← `p-nav-bar`、`p-player-bar` 用 navigate | Navigator（API A8）是路由的唯一调用入口 |
| API | ← 业务组件调用 `api.*` | 组件不直接 `wx.request` |
| Skyline | ← 所有组件映射目标 | appBar / Worklet / recycleManager |

---

## 7. 里程碑

| 阶段 | 内容 | 依赖 |
|------|------|------|
| M1 | 组件规范 + 渲染抽象 + 能力探测 | — |
| M2 | 基础组件（View/Text/Image/ScrollView/Button） | M1 |
| M3 | 长列表 + 虚拟滚动 + 懒加载 | M2, Pinia M1 |
| M4 | 弹层体系（Mask/Popup/Toast）+ Worklet 转场 | M2, Router M7.4 |
| M5 | 导航栏 + appBar 集成 | M2, Router M5 |
| M6 | 业务组件（PlayerBar/PaymentSheet/LoginGate/ErrorBoundary/Skeleton） | M3-M5, Pinia M7, API A4/A5 |
| M7 | 超级应用加固（性能/内存/降级/可观测） | M1-M6 |
| M8 | DevTools + trace + 错误边界 + CI 审计 | M6, Router M8, API M8 |

---

## 8. 验收标准（P0）
1. 每个基础组件：Web 与 Skyline **行为与视觉差异 < 约定阈值**，清单见 `02-component-matrix.md`。
2. 每个组件一份 `IR → 双端产物` 映射文档，可通过 `--trace-transform` 复现。
3. `p-list-view` 渲染 10,000 节点：Skyline 60fps、Web 不掉帧（基准见 `06-m7-performance.md`）。
4. 所有组件在 Skyline 下不出现 `document is not defined` / 全局滚动警告。
5. CI：`proteus audit component` 检测业务组件是否违反 C3/C4/C8。

---

## 9. 目录约定（待与仓库对齐）

```
packages/
  components/
    src/
      base/
        PView/{ PView.vue, transform.ts, ir.md, index.ts }
        ...
      business/
        PPlayerBar/{ ... }
      runtime/
        capability.ts
        web/{...}
        skyline/{...}
        app/{...}
      contracts/
        props.ts
        events.ts
        slots.ts
  compiler/
    transforms/
      component-mapping.ts
      worklet-animation.ts
```

---

## 10. 后续文档
- `01-component-matrix.md`：Props/事件/插槽三端对照矩阵（**P0 首期重点**）
- `02-platform-capability.md`：能力探测 + 降级策略
- `03-base-components.md`：基础组件详细 IR 契约
- `04-business-components.md`：业务组件 + 依赖约束
- `05-worklet-animation.md`：动画/手势/转场映射
- `06-m7-performance.md`：长列表/内存/懒加载
- `07-m8-observability.md`：trace/错误边界/DevTools
- `08-testing-migration.md`：快照测试 + 迁移 codemod
- `09-execution-batches.md`：分批策略 + LLM Prompt
- `10-ci-audit.md`：组件层审计规则
