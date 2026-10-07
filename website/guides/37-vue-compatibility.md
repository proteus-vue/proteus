---
title: Vue 兼容性
order: 37
group: 渲染与能力
---

# Vue 兼容性

写的是**标准 Vue SFC**，但跨端要经编译器落到各端。编译器对**每一个** Vue 能力都必须给出明确结果——不静默输出坏产物。本页列出**需要你知道的那部分**：`128` 项里有 `57` 项直接可用（不必逐个声明），下面 `71` 项会受限制或报错。

| 判级 | 数量 | 含义 |
|---|---|---|
| **❌ 编译报错** | **53** | 编译期 `fail-closed` 直接中断——**这是本页最需要提前知道的部分** |
| ⚠️ 编译警告 | 18 | 能编译，但行为可能与 Web 不同（页面里逐条注明） |

> **适用范围（重要）**：本表约束的是**小程序端编译路径**（`compileVueSfc`）。**Web 端不受这些限制**——Web 走标准 Vite + Vue，由浏览器直接运行。
>
> **与「Vapor 更新路径」的关系**：那讲的是**更新机制**能不能用 Vue 官方实现（答案：App/小程序端不能，因为框架建立在自定义渲染器上——见 [Vapor 更新路径](/docs/framework/43-vapor-update-path)）；本页讲的是**语言能力**支持到什么程度。两者是不同层面的问题。

★**本页由代码生成**（`VUE_COMPAT_MATRIX` 是 SSOT，配套门禁 `check:vue-compat-doc` 比对）——表与实现不可能漂移。

## 不受支持 / 受限的能力

### 响应式

| 能力 | 状态 | 判级 | 说明与替代 |
|---|---|---|---|
| `effect` | 不支持 | **❌ 编译报错** | 裸 effect 无对等——请用 watchEffect/computed |
| `stop` | 不支持 | **❌ 编译报错** | effect 关闭，MP 无对等 |
| `triggerRef` | 受限 | ⚠️ 编译警告 | triggerRef(ref) 需 shallowRef 为运行时 ref 对象——当前 shallowRef 编译期内联（this.data.x 为值）无 ref 可传；仅对 toRef/toRefs/factory 等运行时 ref 有效 |
| `getCurrentScope` | 不支持 | **❌ 编译报错** | effectScope 运行时，MP 无对等 |
| `effectScope` | 不支持 | **❌ 编译报错** | 作用域，MP 无对等 |
| `onScopeDispose` | 不支持 | **❌ 编译报错** | 作用域清理，MP 无对等——用 onUnmounted |
| `onWatcherCleanup` | 不支持 | **❌ 编译报错** | watch 清理，MP 无对等 |
| `getCurrentWatcher` | 不支持 | **❌ 编译报错** | 当前 watcher，MP 无对等 |
| `EffectScope` | 不支持 | **❌ 编译报错** | effectScope 类（运行时作用域），MP 无对等——用 onUnmounted 清理 |

### 组件与运行时

| 能力 | 状态 | 判级 | 说明与替代 |
|---|---|---|---|
| `defineComponent` | 受限 | ⚠️ 编译警告 | SFC 已自动组件化，defineComponent(...) 包装剥离（no-op）；包装内 options/setup 不编译——请直接用 <script setup> 或模板 |
| `defineOptions` | 受限 | ⚠️ 编译警告 | 宏剥离 no-op（compileScript 权威源）；name/inheritAttrs MP 无组件级对等不生效——组件属性请走 properties/attrs 通道 |
| `defineSlots` | 受限 | ⚠️ 编译警告 | 类型声明按 slot 透传处理（宏剥离，无产物副作用） |
| `defineModel` | 受限 | ⚠️ 编译警告 | compileScript 展开为 _useModel(__props, name)：注册 prop + m.value 读写重写（读→data.prop / 写→triggerEvent update-prop）；模型修饰符/嵌套未全接——用 props+emit 显式可兼得 |
| `useModel` | 受限 | ⚠️ 编译警告 | 同 defineModel（运行时模型态，_useModel 展开；模型修饰符/嵌套未全接）——用 props+emit 显式可兼得 |
| `queuePostFlushCb` | 不支持 | **❌ 编译报错** | 内部调度，MP 无对等 |
| `h` | 不支持 | **❌ 编译报错** | 运行时渲染（框架非目标 §0.4）——用模板 DSL |
| `createVNode` | 不支持 | **❌ 编译报错** | 同上——用模板 DSL |
| `cloneVNode` | 不支持 | **❌ 编译报错** | 同上 |
| `isVNode` | 不支持 | **❌ 编译报错** | 运行时节点判断，MP 无对等 |
| `createApp` | 不支持 | **❌ 编译报错** | 运行时渲染（框架非目标）——用 proteus.build / 路由表 |
| `getCurrentInstance` | 不支持 | **❌ 编译报错** | 运行时对内 API——单独立项框架语义 API（如 useMpInstance/adapter.selectorQuery）承接；MP 下勿直接用 |
| `useSlots` | 不支持 | **❌ 编译报错** | 运行时对内 API——组件内用 <slot> 透传 + slots prop |
| `useAttrs` | 不支持 | **❌ 编译报错** | 运行时对内 API——attrs 走 $attrs 产物面 |
| `useTemplateRef` | 受限 | ⚠️ 编译警告 | useTemplateRef(name) → this.<var> = this.selectComponent('#name')（组件实例引用）+ 方法体 .value 剥除；onLoad 时子组件可能未挂载（null）——onReady 后可取（诚实时序边界） |
| `useId` | 不支持 | **❌ 编译报错** | 运行时 id，MP 无对等 |
| `useSSRContext` | 不支持 | **❌ 编译报错** | SSR，MP 无对等 |
| `hasInjectionContext` | 不支持 | **❌ 编译报错** | SSR 注入判断，MP 无对等 |
| `resolveComponent` | 不支持 | **❌ 编译报错** | Vue 内部渲染助手，用户不应手动 import——组件用 usingComponents 静态解析；当前译为裸调用 → not defined |
| `resolveDirective` | 不支持 | **❌ 编译报错** | 自定义指令无对等（Batch A）——用方法调用 |
| `resolveDynamicComponent` | 不支持 | **❌ 编译报错** | <component :is> 无对等——用 v-if 条件渲染 |
| `renderSlot` | 不支持 | **❌ 编译报错** | Vue 内部渲染助手——<slot> 由模板编译透传，勿手动调用；当前译为裸调用 → not defined |
| `mergeProps` | 不支持 | **❌ 编译报错** | Vue 内部渲染助手——props 归一由编译期完成；当前译为裸调用 → not defined |
| `toHandlers` | 不支持 | **❌ 编译报错** | Vue 内部渲染助手——事件归一由编译期完成；当前译为裸调用 → not defined |
| `withCtx` | 不支持 | **❌ 编译报错** | Vue 内部渲染助手——作用域插槽由模板编译生成（advance Batch 7）；勿手动调用；当前译为裸调用 → not defined |
| `withDirectives` | 不支持 | **❌ 编译报错** | 自定义指令无对等（Batch A） |
| `withScopeId` | 不支持 | **❌ 编译报错** | Vue 内部渲染助手——scoped CSS 由编译器注入 scope-attr；勿手动调用；当前译为裸调用 → not defined |
| `warn` | 不支持 | **❌ 编译报错** | Vue 内部 warn，MP 无对等——用 console.warn |
| `devtools` | 不支持 | **❌ 编译报错** | Vue devtools API，MP 走 @proteus-vue/devtools |
| `defineAsyncComponent` | 不支持 | ⚠️ 编译警告 | 异步组件无对等（MP 无运行时组件加载）——请改静态 usingComponents 声明 + 分包按需加载 |
| `useCssVars` | 不支持 | ⚠️ 编译警告 | 运行时 CSS 变量注入无对等（Skyline/WebView 均不支持运行时写 CSS var）——请改 :style 绑定或静态 class |
| `useCssModule` | 不支持 | **❌ 编译报错** | CSS Modules 无对等——请用 scoped class（Proteus 默认 scoped） |
| `createSSRApp` | 不支持 | **❌ 编译报错** | SSR 应用工厂，MP 无对等——页面由 app.json 声明 + 路由表生成 |
| `render` | 不支持 | **❌ 编译报错** | 运行时渲染入口（框架非目标 §0.4）——请用模板 DSL |
| `hydrate` | 不支持 | **❌ 编译报错** | SSR 水合，MP 无对等 |
| `compile` | 不支持 | **❌ 编译报错** | 运行时模板编译（体积代价），Proteus 为编译期转换——请用 SFC |
| `defineCustomElement` | 不支持 | **❌ 编译报错** | Web Components 自定义元素无对等——请用 .vue 组件（usingComponents 静态注册） |
| `defineSSRCustomElement` | 不支持 | **❌ 编译报错** | SSR + Custom Elements，MP 无对等 |
| `useHost` | 不支持 | **❌ 编译报错** | Custom Elements 宿主，MP 无对等 |
| `useShadowRoot` | 不支持 | **❌ 编译报错** | Shadow DOM，MP 无对等 |
| `VueElement` | 不支持 | **❌ 编译报错** | Custom Elements 基类，MP 无对等 |
| `createRenderer` | 不支持 | **❌ 编译报错** | 自定义渲染器入口——Proteus 走 @proteus-vue/renderer-app（G-41 宿主运行时 SPI） |
| `nodeOps` | 不支持 | **❌ 编译报错** | Vue 内部 DOM 操作集——Proteus 走 @proteus-vue/render-backend（G-37 SPI） |
| `patchProp` | 不支持 | **❌ 编译报错** | Vue 内部属性补丁——Proteus 走 render-backend |

### 生命周期

| 能力 | 状态 | 判级 | 说明与替代 |
|---|---|---|---|
| `onBeforeMount` | 受限 | ⚠️ 编译警告 | 映射 attached 前（无对等 beforeMount）——用 onMounted 前置 |
| `onBeforeUnmount` | 受限 | ⚠️ 编译警告 | 映射 detached 前——用 onUnmounted 前置 |
| `onUpdated` | 受限 | ⚠️ 编译警告 | MP 无对等——用 watch/setData 后 |
| `onBeforeUpdate` | 受限 | ⚠️ 编译警告 | MP 无对等——用 watch 前置 |
| `onActivated` | 不支持 | **❌ 编译报错** | keep-alive 无对等——用 onShow |
| `onDeactivated` | 不支持 | **❌ 编译报错** | keep-alive 无对等——用 onHide |
| `onErrorCaptured` | 受限 | ⚠️ 编译警告 | 无对等钩子，Web 保留原生语义（已剥离+警告） |
| `onRenderTracked` | 不支持 | **❌ 编译报错** | devtools 调试钩子，MP 无对等 |
| `onRenderTriggered` | 不支持 | **❌ 编译报错** | 同上 |
| `onServerPrefetch` | 不支持 | **❌ 编译报错** | SSR，MP 无对等 |

### 模板与指令

| 能力 | 状态 | 判级 | 说明与替代 |
|---|---|---|---|
| `v-pre` | 受限 | ⚠️ 编译警告 | 纯静态内容剥离等价；含 {{ }} 插值时 WXML 无 raw 模式仍会插值（v-pre 跳过编译无法实现）——诚实警告 |
| `v-once` | 受限 | ⚠️ 编译警告 | 纯静态内容剥离等价（静态天然只渲染一次）；含 {{ }} 插值时 MP 数据驱动无「渲染一次」惰性——诚实警告 |
| `<transition-group>` | 受限 | ⚠️ 编译警告 | 列表过渡无对等——用组件级 transition |
| `<keep-alive>` | 不支持 | **❌ 编译报错** | 无对等——用 v-if + 显式缓存，或分包 |
| `<suspense>` | 不支持 | **❌ 编译报错** | 无对等 |
| `<component :is>` | 不支持 | **❌ 编译报错** | 动态组件无对等——用 v-if 条件渲染 |
| `自定义指令` | 不支持 | **❌ 编译报错** | 无对等（Batch A 已警告 v-）——用方法调用 |

### SFC 编译

| 能力 | 状态 | 判级 | 说明与替代 |
|---|---|---|---|
| `模板 ref="x"` | 受限 | ⚠️ 编译警告 | ref="x" → 注入 id="x" + 收集（useTemplateRef(name) → this.selectComponent('#name') 组件实例引用；onLoad 可能 null） |

## 我需要做什么

1. **先查本页**再动手写——尤其 `<keep-alive>` / `<component :is>` / 自定义指令这类常用但不受支持的写法；
2. **看替代建议**：大多数项都给了对等写法（如 `onActivated` → `onShow`、`<component :is>` → `v-if`、自定义指令 → 方法调用）；
3. **编译报错时不要绕过**：`❌` 类的报错是**有意**的失败（反黑盒红线）——绕过去只会得到行为错误的产物；
4. **受限项要实测**：`⚠️` 类能编译，但行为可能与 Web 不同（每条注明了差异）。

## 本组导航

- [快速开始](/docs/01-intro)：从零跑起来
- [渲染与能力](/docs/12-components-intro)：组件与能力体系
- [Vapor 更新路径](/docs/framework/43-vapor-update-path)：更新机制与自研理由
