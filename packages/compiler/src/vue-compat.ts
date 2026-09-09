// packages/compiler/src/vue-compat.ts
// ★★2026-09-08 立项（proteus-compiler-vue-align-plan）：「Vue 全能力」基准线 SSOT。
// 开发者写的是标准 Vue SFC 去跨端——编译器对每一个标准 Vue 能力必须给出三类之一：
//   aligned（正确翻译）/ partial（受限 + 编译期警告）/ unsupported（明确报错），绝不静默输出坏产物/未定义引用。
// ★基准线来源：权威拉取 @vue/runtime-core@3.5.42 + @vue/reactivity + @vue/shared 的公共导出 + SFC 模板/指令/内置组件面。
// ★状态赋值来源：vue-compat-plan §1（✅主路径=aligned / ⚠️=partial / ❌=unsupported）+ vue-compat-advance Batch + roadmap #2。
// ★用户规则（2026-09-08）：unsupported + 有降级策略 → **warning**；无降级策略 → **error**。partial 恒 warning。
// 消费方：compiler script.ts（扫描 <script setup> 的 vue 命名导入 → 对照本矩阵）；tests/vue-compat-matrix.test.ts（门禁）。

/** 对齐状态 */
export type VueCompatStatus = 'aligned' | 'partial' | 'unsupported'

/** Vue 能力类别 */
export type VueCompatGroup = 'reactivity' | 'component' | 'lifecycle' | 'template' | 'sfc'

export interface VueCompatEntry {
  /** Vue 公共 API / SFC 特性名（对齐 @vue/* 导出名或模板能力名） */
  name: string
  group: VueCompatGroup
  /** 对齐状态 */
  status: VueCompatStatus
  /** unsupported/partial 时：有降级策略 → true（编译期 warning）；无 → false/undefined（编译期 error） */
  degrade?: boolean
  /** 说明 / 替代建议（unsupported/partial 必填） */
  note?: string
  /** 状态来源（vue-compat §1 / advance batch / roadmap / 实测评估） */
  source: string
}

/**
 * ★Vue 全能力基准线（SSOT）。随 Vue 版本演进：重拉 @vue/* 导出 + 复评状态（版本变更流程）。
 * 不可置疑性：name 集 = @vue/runtime-core + @vue/reactivity + @vue/shared 公共导出 + SFC 模板/指令/内置组件面。
 */
export const VUE_COMPAT_MATRIX: VueCompatEntry[] = [
  // ===== reactivity / 核心 =====
  { name: 'ref', group: 'reactivity', status: 'aligned', source: 'vue-compat §1 主路径' },
  // ★2026-09-08 reactivity-runtime spke：reactive 走运行时 @vue/reactivity 真 Proxy（ReactiveFlags 标记位）——isReactive 语义为真
  { name: 'reactive', group: 'reactivity', status: 'aligned', note: 'reactive(x) → runtime-init @vue/reactivity 真 Proxy + setData 桥（effect→setData，视图刷新）——非普通 data 内联，isReactive 语义保持', source: 'reactivity-runtime（运行时 @vue/reactivity）' },
  { name: 'computed', group: 'reactivity', status: 'aligned', source: 'vue-compat §1 主路径（读写，proteusSetX）' },
  { name: 'shallowRef', group: 'reactivity', status: 'aligned', source: 'const-to-data' },
  // ★2026-09-08 reactivity-runtime spke：shallowReactive/shallowReadonly 与 reactive/readonly 同走运行时 @vue/reactivity（浅层 Proxy 语义保留）
  { name: 'shallowReactive', group: 'reactivity', status: 'aligned', note: 'shallowReactive(x) → runtime-init @vue/reactivity 浅 Proxy + setData 桥；isReactive 语义保持', source: 'reactivity-runtime（运行时 @vue/reactivity）' },
  { name: 'shallowReadonly', group: 'reactivity', status: 'aligned', note: 'shallowReadonly(x) → runtime-init @vue/reactivity 浅 readonly Proxy；isReadonly 语义保持', source: 'reactivity-runtime（运行时 @vue/reactivity）' },
  { name: 'readonly', group: 'reactivity', status: 'aligned', note: 'readonly(x) → runtime-init @vue/reactivity readonly Proxy（只读约束 runtime 强制）+ setData 桥；isReadonly 语义保持', source: 'reactivity-runtime（运行时 @vue/reactivity）' },
  // ★2026-09-08 reactivity-runtime spke：markRaw/triggerRef/customRef/proxyRefs 走运行时 @vue/reactivity（逻辑层真语义）——customRef 返回真 ref（.value 逻辑层），proxyRefs 返回自动解包代理
  { name: 'customRef', group: 'reactivity', status: 'aligned', note: 'customRef(factory) → runtime-init @vue/reactivity 真 ref（逻辑层 .value 读写 + isRef=true）；工厂 track/trigger 回调语义保留', source: 'reactivity-runtime（运行时 @vue/reactivity）' },
  // ★2026-09-08 reactivity-runtime spke：toRef/toRefs 走运行时 @vue/reactivity——返回真 ref（.value 在逻辑层有效，isRef(toRef())=true）
  //   模板层诚实降级：toRef 的 runtime-init 变量仅逻辑层 .value（模板 {{ ref }} 读对象非值——请用 ref.value 或 reactive）；不静默（note）
  { name: 'toRef', group: 'reactivity', status: 'aligned', note: 'toRef(obj, key) → runtime-init @vue/reactivity 真 ref（语义同官方，isRef=true；.value 逻辑层读写 obj[key]）；模板直接 {{ ref }} 读的是 ref 对象——请用 ref.value 或 reactive', source: 'reactivity-runtime（运行时 @vue/reactivity）' },
  { name: 'toRefs', group: 'reactivity', status: 'aligned', note: 'toRefs(obj) → runtime-init @vue/reactivity ref 映射（每键一 ref，.value 读 obj 对应字段）；解构 const { a } = toRefs(obj) 暂未接（声明为 ObjectPattern 跳过）——请用 const r = toRefs(obj); r.a.value', source: 'reactivity-runtime（运行时 @vue/reactivity）' },
  { name: 'toValue', group: 'reactivity', status: 'aligned', note: 'toValue(x) 编译期内联：同 unref——x 为 ref → this.data.x；非 ref → x 本身；MP 无运行时 toValue', source: '增强（编译期内联改写）' },
  { name: 'proxyRefs', group: 'reactivity', status: 'aligned', note: 'proxyRefs(x) → runtime-init @vue/reactivity 代理（成员 ref 访问自动解包 .value）；逻辑层可用，模板直接 {{ proxy }.[key] } 读解包值需 .value 约定', source: 'reactivity-runtime（运行时 @vue/reactivity）' },
  { name: 'effect', group: 'reactivity', status: 'unsupported', note: '裸 effect 无对等——请用 watchEffect/computed', source: '评估' },
  { name: 'stop', group: 'reactivity', status: 'unsupported', note: 'effect 关闭，MP 无对等', source: '评估' },
  { name: 'triggerRef', group: 'reactivity', status: 'partial', degrade: true, note: 'triggerRef(ref) 需 shallowRef 为运行时 ref 对象——当前 shallowRef 编译期内联（this.data.x 为值）无 ref 可传；仅对 toRef/toRefs/factory 等运行时 ref 有效', source: 'reactivity-runtime（运行时 @vue/reactivity，局限）' },
  { name: 'markRaw', group: 'reactivity', status: 'aligned', note: 'markRaw(x) → runtime-init @vue/reactivity（返回原对象标记跳过代理；isReactive(markRaw(x))=false）', source: 'reactivity-runtime（运行时 @vue/reactivity）' },
  // ★2026-09-08 增强：unref(x)/toValue(x) 编译期内联为 x.value（x 为已知 ref → this.data.x；非 ref → x 本身）——MP 无运行时 unref，编译期取值等价
  { name: 'unref', group: 'reactivity', status: 'aligned', note: 'unref(x) 编译期内联：x 为 ref → this.data.x；非 ref → x 本身（unref 恒等）；MP 无运行时 unref，编译期取值', source: '增强（编译期内联改写）' },
  // ★2026-09-08 Step2 校准：isRef/isReactive/isReadonly/isProxy/isShallow 实测被当「函数调用初始化」译为 this.x=isX(…)，
  //   产物为裸标识符且无 vue import → 运行时 not defined（getCurrentInstance 同类）——标记 aligned 是假，降 unsupported（无降级→error）
  // ★2026-09-08 reactivity-runtime spke：isReactive/isReadonly/isProxy/isShallow/toRaw 走运行时 @vue/reactivity（随 reactive 族真 Proxy，守卫读 ReactiveFlags 标记位）——非编译期内联
  // ★isRef 保持编译期内联（MP 保留 ref 概念，无需运行时）
  { name: 'isRef', group: 'reactivity', status: 'aligned', note: 'isRef(x) 编译期内联：x 来源 ref/shallowRef/computed → true；否则 false（MP 保留 ref 概念）+ 依赖 constSourceTypes 追踪', source: '增强（守卫内联）' },
  { name: 'isReactive', group: 'reactivity', status: 'aligned', note: 'isReactive(x) → runtime @vue/reactivity 守卫（读 ReactiveFlags.IS_REACTIVE）；需 reactive 走运行时真 Proxy 才为真', source: 'reactivity-runtime（运行时 @vue/reactivity）' },
  { name: 'isReadonly', group: 'reactivity', status: 'aligned', note: 'isReadonly(x) → runtime @vue/reactivity 守卫（读 ReactiveFlags.IS_READONLY）', source: 'reactivity-runtime（运行时 @vue/reactivity）' },
  { name: 'isProxy', group: 'reactivity', status: 'aligned', note: 'isProxy(x) → runtime @vue/reactivity 守卫（reactive/readonly proxy 为真）', source: 'reactivity-runtime（运行时 @vue/reactivity）' },
  { name: 'isShallow', group: 'reactivity', status: 'aligned', note: 'isShallow(x) → runtime @vue/reactivity 守卫（读 reactive/shallow 标记）', source: 'reactivity-runtime（运行时 @vue/reactivity）' },
  { name: 'toRaw', group: 'reactivity', status: 'aligned', note: 'toRaw(x) → runtime @vue/reactivity（去 proxy 返回原始对象）', source: 'reactivity-runtime（运行时 @vue/reactivity）' },
  { name: 'getCurrentScope', group: 'reactivity', status: 'unsupported', note: 'effectScope 运行时，MP 无对等', source: '评估' },
  { name: 'effectScope', group: 'reactivity', status: 'unsupported', note: '作用域，MP 无对等', source: '评估' },
  { name: 'onScopeDispose', group: 'reactivity', status: 'unsupported', note: '作用域清理，MP 无对等——用 onUnmounted', source: '评估' },
  { name: 'onWatcherCleanup', group: 'reactivity', status: 'unsupported', note: 'watch 清理，MP 无对等', source: '评估' },
  { name: 'getCurrentWatcher', group: 'reactivity', status: 'unsupported', note: '当前 watcher，MP 无对等', source: '评估' },
  // watch 族
  { name: 'watch', group: 'reactivity', status: 'aligned', source: 'vue-compat §1 主路径（ref/数组/函数/props 源）' },
  // ★2026-09-08 增强：watchEffect 族改写为 watch(deps, cb, {immediate:true})（deps 从 cb 提取 x.value 的 ref）——MP 无 watchEffect，watch immediate 等价
  { name: 'watchEffect', group: 'reactivity', status: 'aligned', note: 'watchEffect(cb) 改写为 watch([deps], cb, {immediate:true})——deps = cb 内访问的 ref（x.value → x）；MP 无 watchEffect，watch(immediate) 等价', source: '增强（watchEffect→watch 改写）' },
  { name: 'watchPostEffect', group: 'reactivity', status: 'aligned', note: '同 watchEffect（flush post 无对等，按 watch immediate 处理）', source: '增强（watchEffect→watch 改写）' },
  { name: 'watchSyncEffect', group: 'reactivity', status: 'aligned', note: '同 watchEffect（flush sync 无对等，按 watch immediate 处理）', source: '增强（watchEffect→watch 改写）' },

  // ===== component API =====
  // ★2026-09-08 P1 校准：defineComponent 在 <script setup> 为冗余包装（SFC 已自动组件化）——编译器识别并剥离为 no-op（不落 data/不裸注入 onLoad），矩阵 partial（警告：包装 options 未编译，请用 <script setup>）；对内 setup 逻辑不翻译（非 SFC 范式）
  { name: 'defineComponent', group: 'component', status: 'partial', degrade: true, note: 'SFC 已自动组件化，defineComponent(...) 包装剥离（no-op）；包装内 options/setup 不编译——请直接用 <script setup> 或模板', source: 'P1 校准（no-op 剥离）' },
  { name: 'defineProps', group: 'component', status: 'aligned', source: 'vue-compat §1（define-props）' },
  { name: 'defineEmits', group: 'component', status: 'aligned', source: 'vue-compat §1（define-emits）' },
  { name: 'defineExpose', group: 'component', status: 'aligned', source: 'define-expose（no-op+校验）' },
  // ★2026-09-08 defineOptions 对齐：compileScript 权威语义（name/inheritAttrs）——剥离 no-op（不裸注入 onLoad→not defined），
  //   name/inheritAttrs 在 MP 无组件级对等（微信 Component 无组件级 name/inheritAttrs 字段）→ partial（诚实说明不生效）
  { name: 'defineOptions', group: 'component', status: 'partial', degrade: true, note: '宏剥离 no-op（compileScript 权威源）；name/inheritAttrs MP 无组件级对等不生效——组件属性请走 properties/attrs 通道', source: 'defineOptions 对齐（compileScript 权威源）' },
  { name: 'defineSlots', group: 'component', status: 'partial', degrade: true, note: '类型声明按 slot 透传处理（宏剥离，无产物副作用）', source: '评估' },
  // ★2026-09-08 P1（地基）：defineModel 经 @vue/compiler-sfc 权威展开（_useModel）→ 注册 prop + .value 读写重写 + 模板改名；useModel 同（运行时态，_useModel 产物）
  { name: 'defineModel', group: 'component', status: 'partial', degrade: true, note: 'compileScript 展开为 _useModel(__props, name)：注册 prop + m.value 读写重写（读→data.prop / 写→triggerEvent update-prop）；模型修饰符/嵌套未全接——用 props+emit 显式可兼得', source: 'P1 地基（compileScript 权威源）' },
  { name: 'useModel', group: 'component', status: 'partial', degrade: true, note: '同 defineModel（运行时模型态，_useModel 展开；模型修饰符/嵌套未全接）——用 props+emit 显式可兼得', source: 'P1 地基（compileScript 权威源）' },
  // ★2026-09-08 P1 对齐：withDefaults(defineProps<T>(), D) 已识别为宏（早退不落 data）+ extractProps 合并默认值 D（字面量）
  { name: 'withDefaults', group: 'component', status: 'aligned', note: 'withDefaults(defineProps<T>(), D) 宏剥离 + 默认值 D 合并到 properties.value（函数默认值仍忽略/警告）', source: 'P1 对齐（宏识别+默认值合并）' },
  // ★2026-09-08 P1 对齐：nextTick 已翻译——nextTick(cb)→wx.nextTick(cb)；nextTick()/await nextTick()→new Promise(r=>wx.nextTick(r))
  { name: 'nextTick', group: 'component', status: 'aligned', note: 'nextTick(cb)→wx.nextTick(cb)；nextTick()/await nextTick()→new Promise(r=>wx.nextTick(r))（wx.nextTick 返回 undefined，await 需 Promise 包装）', source: 'P1 对齐（脚本体翻译）' },
  { name: 'queuePostFlushCb', group: 'component', status: 'unsupported', note: '内部调度，MP 无对等', source: '评估' },
  { name: 'h', group: 'component', status: 'unsupported', note: '运行时渲染（框架非目标 §0.4）——用模板 DSL', source: 'L0 非目标' },
  { name: 'createVNode', group: 'component', status: 'unsupported', note: '同上——用模板 DSL', source: 'L0 非目标' },
  { name: 'cloneVNode', group: 'component', status: 'unsupported', note: '同上', source: 'L0 非目标' },
  { name: 'isVNode', group: 'component', status: 'unsupported', note: '运行时节点判断，MP 无对等', source: '评估' },
  { name: 'createApp', group: 'component', status: 'unsupported', note: '运行时渲染（框架非目标）——用 proteus.build / 路由表', source: 'L0 非目标' },
  // ★运行时对内 API（用户决策 1：走 b——单独立项框架语义 API，不翻译 Vue 运行时 API；此处 unsupported 反黑盒）
  { name: 'getCurrentInstance', group: 'component', status: 'unsupported', note: '运行时对内 API——单独立项框架语义 API（如 useMpInstance/adapter.selectorQuery）承接；MP 下勿直接用', source: '用户决策 1（b）' },
  { name: 'useSlots', group: 'component', status: 'unsupported', note: '运行时对内 API——组件内用 <slot> 透传 + slots prop', source: '用户决策 1（b）' },
  { name: 'useAttrs', group: 'component', status: 'unsupported', note: '运行时对内 API——attrs 走 $attrs 产物面', source: '用户决策 1（b）' },
  { name: 'useTemplateRef', group: 'component', status: 'partial', degrade: true, note: 'useTemplateRef(name) → this.<var> = this.selectComponent(\'#name\')（组件实例引用）+ 方法体 .value 剥除；onLoad 时子组件可能未挂载（null）——onReady 后可取（诚实时序边界）', source: 'useTemplateRef 对齐（selectComponent 承接）' },
  { name: 'useId', group: 'component', status: 'unsupported', note: '运行时 id，MP 无对等', source: '评估' },
  { name: 'useSSRContext', group: 'component', status: 'unsupported', note: 'SSR，MP 无对等', source: '评估' },
  { name: 'hasInjectionContext', group: 'component', status: 'unsupported', note: 'SSR 注入判断，MP 无对等', source: '评估' },
  { name: 'provide', group: 'component', status: 'aligned', source: 'vue-compat-advance Batch 3/4/6' },
  { name: 'inject', group: 'component', status: 'aligned', source: 'vue-compat-advance Batch 3/4/6' },
  // 渲染工具（编译期处理）
  // ★Step2 校准：resolveComponent/renderSlot/mergeProps/toHandlers/withCtx/withScopeId 为 Vue 内部渲染助手，
  //   用户不应在 <script setup> 手动 import——实测译为裸标识符调用 → not defined；相关能力由模板编译/静态解析承接，标 aligned 是假
  { name: 'resolveComponent', group: 'component', status: 'unsupported', note: 'Vue 内部渲染助手，用户不应手动 import——组件用 usingComponents 静态解析；当前译为裸调用 → not defined', source: '评估（Step2 实测校准）' },
  { name: 'resolveDirective', group: 'component', status: 'unsupported', note: '自定义指令无对等（Batch A）——用方法调用', source: 'vue-compat Batch A' },
  { name: 'resolveDynamicComponent', group: 'component', status: 'unsupported', note: '<component :is> 无对等——用 v-if 条件渲染', source: 'vue-compat Batch A' },
  { name: 'renderSlot', group: 'component', status: 'unsupported', note: 'Vue 内部渲染助手——<slot> 由模板编译透传，勿手动调用；当前译为裸调用 → not defined', source: '评估（Step2 实测校准）' },
  { name: 'mergeProps', group: 'component', status: 'unsupported', note: 'Vue 内部渲染助手——props 归一由编译期完成；当前译为裸调用 → not defined', source: '评估（Step2 实测校准）' },
  { name: 'toHandlers', group: 'component', status: 'unsupported', note: 'Vue 内部渲染助手——事件归一由编译期完成；当前译为裸调用 → not defined', source: '评估（Step2 实测校准）' },
  { name: 'withCtx', group: 'component', status: 'unsupported', note: 'Vue 内部渲染助手——作用域插槽由模板编译生成（advance Batch 7）；勿手动调用；当前译为裸调用 → not defined', source: '评估（Step2 实测校准）' },
  { name: 'withDirectives', group: 'component', status: 'unsupported', note: '自定义指令无对等（Batch A）', source: 'vue-compat Batch A' },
  { name: 'withScopeId', group: 'component', status: 'unsupported', note: 'Vue 内部渲染助手——scoped CSS 由编译器注入 scope-attr；勿手动调用；当前译为裸调用 → not defined', source: '评估（Step2 实测校准）' },
  // 调试/内部
  { name: 'warn', group: 'component', status: 'unsupported', note: 'Vue 内部 warn，MP 无对等——用 console.warn', source: '评估' },
  { name: 'devtools', group: 'component', status: 'unsupported', note: 'Vue devtools API，MP 走 @proteus-vue/devtools', source: '评估' },
  // ★2026-09-08 P1 对齐：version 已内联——const v = version → data.v = '3.5.42'（VUE_PUBLIC_CONSTS，与 Vue 全集基线 SSOT @vue/runtime-core@3.5.42 对齐）
  { name: 'version', group: 'component', status: 'aligned', note: 'const v = version 内联为版本号字符串（VUE_PUBLIC_CONSTS，随 Vue 演进同步）；产物 data.v=版本号而非 undefined', source: 'P1 对齐（VUE_PUBLIC_CONSTS 内联）' },

  // ===== ★2026-09-09 全集覆盖补齐（用户可见 API）=====
  // 背景（真机复测发现）：对比 Vue 运行时导出 171 项，矩阵原 112 项漏登以下用户可见 API——
  //   未登记落 VUE_COMPAT_UNKNOWN（error 但无替代建议），违反「基准线是全集 + 每个能力给替代建议」。
  //   以下显式登记；纯内部/编译期导出由 VUE_INTERNAL_EXPORTS 集合统一归类（见下）。
  { name: 'defineAsyncComponent', group: 'component', status: 'unsupported', degrade: true, note: '异步组件无对等（MP 无运行时组件加载）——请改静态 usingComponents 声明 + 分包按需加载', source: '评估（MP 无异步组件加载）' },
  { name: 'useCssVars', group: 'component', status: 'unsupported', degrade: true, note: '运行时 CSS 变量注入无对等（Skyline/WebView 均不支持运行时写 CSS var）——请改 :style 绑定或静态 class', source: '评估（无运行时 CSS 变量通道）' },
  { name: 'useCssModule', group: 'component', status: 'unsupported', note: 'CSS Modules 无对等——请用 scoped class（Proteus 默认 scoped）', source: '评估（无 CSS Modules）' },
  { name: 'createSSRApp', group: 'component', status: 'unsupported', note: 'SSR 应用工厂，MP 无对等——页面由 app.json 声明 + 路由表生成', source: '评估（SSR）' },
  { name: 'render', group: 'component', status: 'unsupported', note: '运行时渲染入口（框架非目标 §0.4）——请用模板 DSL', source: '评估（框架非目标）' },
  { name: 'hydrate', group: 'component', status: 'unsupported', note: 'SSR 水合，MP 无对等', source: '评估（SSR）' },
  { name: 'compile', group: 'component', status: 'unsupported', note: '运行时模板编译（体积代价），Proteus 为编译期转换——请用 SFC', source: '评估（编译期已转换）' },
  { name: 'defineCustomElement', group: 'component', status: 'unsupported', note: 'Web Components 自定义元素无对等——请用 .vue 组件（usingComponents 静态注册）', source: '评估（无 Custom Elements）' },
  { name: 'defineSSRCustomElement', group: 'component', status: 'unsupported', note: 'SSR + Custom Elements，MP 无对等', source: '评估（SSR）' },
  { name: 'useHost', group: 'component', status: 'unsupported', note: 'Custom Elements 宿主，MP 无对等', source: '评估（无 Custom Elements）' },
  { name: 'useShadowRoot', group: 'component', status: 'unsupported', note: 'Shadow DOM，MP 无对等', source: '评估（无 Shadow DOM）' },
  { name: 'VueElement', group: 'component', status: 'unsupported', note: 'Custom Elements 基类，MP 无对等', source: '评估（无 Custom Elements）' },
  { name: 'createRenderer', group: 'component', status: 'unsupported', note: '自定义渲染器入口——Proteus 走 @proteus-vue/renderer-app（G-41 宿主运行时 SPI）', source: '评估（走框架 SPI）' },
  { name: 'nodeOps', group: 'component', status: 'unsupported', note: 'Vue 内部 DOM 操作集——Proteus 走 @proteus-vue/render-backend（G-37 SPI）', source: '评估（走框架 SPI）' },
  { name: 'patchProp', group: 'component', status: 'unsupported', note: 'Vue 内部属性补丁——Proteus 走 render-backend', source: '评估（走框架 SPI）' },
  { name: 'EffectScope', group: 'reactivity', status: 'unsupported', note: 'effectScope 类（运行时作用域），MP 无对等——用 onUnmounted 清理', source: '评估（无 effectScope）' },

  // ===== lifecycle =====
  { name: 'onMounted', group: 'lifecycle', status: 'aligned', source: 'vue-compat §1（onReady）' },
  { name: 'onUnmounted', group: 'lifecycle', status: 'aligned', source: 'vue-compat §1（onUnload）' },
  { name: 'onBeforeMount', group: 'lifecycle', status: 'partial', degrade: true, note: '映射 attached 前（无对等 beforeMount）——用 onMounted 前置', source: '评估' },
  { name: 'onBeforeUnmount', group: 'lifecycle', status: 'partial', degrade: true, note: '映射 detached 前——用 onUnmounted 前置', source: '评估' },
  { name: 'onUpdated', group: 'lifecycle', status: 'partial', degrade: true, note: 'MP 无对等——用 watch/setData 后', source: '评估' },
  { name: 'onBeforeUpdate', group: 'lifecycle', status: 'partial', degrade: true, note: 'MP 无对等——用 watch 前置', source: '评估' },
  { name: 'onActivated', group: 'lifecycle', status: 'unsupported', note: 'keep-alive 无对等——用 onShow', source: '评估' },
  { name: 'onDeactivated', group: 'lifecycle', status: 'unsupported', note: 'keep-alive 无对等——用 onHide', source: '评估' },
  { name: 'onErrorCaptured', group: 'lifecycle', status: 'partial', degrade: true, note: '无对等钩子，Web 保留原生语义（已剥离+警告）', source: 'p-error-boundary' },
  { name: 'onRenderTracked', group: 'lifecycle', status: 'unsupported', note: 'devtools 调试钩子，MP 无对等', source: '评估' },
  { name: 'onRenderTriggered', group: 'lifecycle', status: 'unsupported', note: '同上', source: '评估' },
  { name: 'onServerPrefetch', group: 'lifecycle', status: 'unsupported', note: 'SSR，MP 无对等', source: '评估' },

  // ===== 模板指令 / 内置组件（约定由 template.ts 处理，这里登记对齐状态） =====
  { name: 'v-if', group: 'template', status: 'aligned', source: 'vue-compat §1' },
  { name: 'v-else', group: 'template', status: 'aligned', source: 'vue-compat §1' },
  { name: 'v-else-if', group: 'template', status: 'aligned', source: 'vue-compat §1' },
  { name: 'v-for', group: 'template', status: 'aligned', source: 'vue-compat §1' },
  { name: 'v-show', group: 'template', status: 'aligned', source: 'vue-compat §1（hidden=）' },
  { name: 'v-bind', group: 'template', status: 'aligned', source: 'vue-compat §1' },
  { name: 'v-on', group: 'template', status: 'aligned', source: 'vue-compat §1' },
  { name: 'v-model', group: 'template', status: 'aligned', source: 'v-model 组件/input 契约' },
  { name: 'v-html', group: 'template', status: 'aligned', source: 'vue-compat §1（rich-text）' },
  // ★2026-09-08 v-text 对齐：v-text="expr" → 元素内容覆盖为文本插值 {{ expr }}（Vue 语义：覆盖子节点输出文本）——消除「剥离导致文本丢失」真 bug
  { name: 'v-text', group: 'template', status: 'aligned', note: 'v-text="expr" → <tag>{{ expr }}</tag>（元素内容覆盖为文本插值；v-text 覆盖子节点——Vue 语义）', source: 'v-text 对齐（模板指令→文本插值）' },
  { name: 'v-pre', group: 'template', status: 'partial', degrade: true, note: '纯静态内容剥离等价；含 {{ }} 插值时 WXML 无 raw 模式仍会插值（v-pre 跳过编译无法实现）——诚实警告', source: 'v-pre 诚实对齐（静态等价/响应式警告）' },
  { name: 'v-once', group: 'template', status: 'partial', degrade: true, note: '纯静态内容剥离等价（静态天然只渲染一次）；含 {{ }} 插值时 MP 数据驱动无「渲染一次」惰性——诚实警告', source: 'v-once 诚实对齐（静态等价/响应式警告）' },
  { name: 'v-cloak', group: 'template', status: 'aligned', source: 'vue-compat §1（MP 无首帧未编译闪烁——剥离保留正常插值，语义等价 noop）' },
  { name: 'v-slot', group: 'template', status: 'aligned', source: 'vue-compat §1（具名）' },
  { name: ':class', group: 'template', status: 'aligned', source: 'vue-compat §1（数组+对象简写）' },
  { name: ':style', group: 'template', status: 'aligned', source: 'v-bind-style 派生序列化（#500）' },
  { name: '<transition>', group: 'template', status: 'aligned', source: 'advance Batch 2/5（进入+离开动画）' },
  { name: '<transition-group>', group: 'template', status: 'partial', degrade: true, note: '列表过渡无对等——用组件级 transition', source: 'advance Batch 2' },
  { name: '<keep-alive>', group: 'template', status: 'unsupported', note: '无对等——用 v-if + 显式缓存，或分包', source: '评估' },
  { name: '<teleport>', group: 'template', status: 'aligned', note: '<teleport> → <root-portal>（Skyline 官方：子树脱离页面类似 fixed，用于弹窗/弹出层——弹层层叠正解）；to 目标 MP 无对等（root-portal 恒脱离页面）已忽略', source: 'teleport→root-portal 对齐（Skyline 官方组件）' },
  { name: '<suspense>', group: 'template', status: 'unsupported', note: '无对等', source: '评估' },
  { name: '<component :is>', group: 'template', status: 'unsupported', note: '动态组件无对等——用 v-if 条件渲染', source: 'vue-compat Batch A' },
  { name: '<slot>', group: 'template', status: 'aligned', source: 'vue-compat §1（默认/具名）' },
  { name: '自定义指令', group: 'template', status: 'unsupported', note: '无对等（Batch A 已警告 v-）——用方法调用', source: 'vue-compat Batch A' },

  // ===== SFC 特性 =====
  { name: '<script setup>', group: 'sfc', status: 'aligned', source: '主线（script.ts 转换）' },
  { name: '<style scoped>', group: 'sfc', status: 'aligned', source: 'vue-compat §1（scope-attr + :deep）' },
  { name: ':deep()', group: 'sfc', status: 'aligned', source: 'vue-compat §1' },
  { name: '<style lang=scss>', group: 'sfc', status: 'aligned', source: 'vue-compat §1（scss 预处理器）' },
  { name: '<template #slot>', group: 'sfc', status: 'aligned', source: 'vue-compat §1（具名）' },
  { name: '模板 ref="x"', group: 'sfc', status: 'partial', degrade: true, note: 'ref="x" → 注入 id="x" + 收集（useTemplateRef(name) → this.selectComponent(\'#name\') 组件实例引用；onLoad 可能 null）', source: 'useTemplateRef 对齐（ref id 注入 + 收集）' },
  { name: 'TS 类型注解', group: 'sfc', status: 'aligned', source: 'vue-compat §1（TS 剥除）' },
]

/** ★Vue 公共常量导出（编译期内联值）：`const v = <name>` 时把裸标识符内联为字面量（替代运行时轮询 undefined）。
 *  版本号与 02-api-gap 基线「Vue 全集权威来源」的 @vue/runtime-core@3.5.42 对齐；随 Vue 版本演进同步。 */
export const VUE_PUBLIC_CONSTS: Record<string, unknown> = {
  version: '3.5.42',
}

/** ★2026-09-09 别名机制（真机复测发现的命名错配）：矩阵 template 组按**模板形态**登记（`<teleport>`/`<keep-alive>`…），
 *  而开发者按 Vue 官方文档常写 PascalCase 组件导入（`import { Teleport } from 'vue'`）——同一能力两种写法，
 *  未登记形态落 VUE_COMPAT_UNKNOWN 报「可能为 Vue 内部导出」= 矛盾结论（`<teleport>` 明明 aligned）。
 *  别名表：PascalCase 导出名 → 已登记模板形态名。查询先查矩阵，未命中再查别名（返回同一 entry，状态一致）。 */
export const VUE_COMPAT_ALIASES: Record<string, string> = {
  Teleport: '<teleport>',
  KeepAlive: '<keep-alive>',
  Suspense: '<suspense>',
  Transition: '<transition>',
  TransitionGroup: '<transition-group>',
}

/** ★2026-09-09 Vue 内部导出集合（@vue/runtime-core + @vue/reactivity + @vue/shared 的非用户面导出）。
 *  这些符号开发者不应手写（编译期已生成对等结构 / 运行时内部机制 / SSR / 自定义渲染器）——
 *  统一归 unsupported 并给出准确说明，替代「可能是 Vue 内部导出」的模糊兜底。
 *  维护：Vue 版本升级后跑 tests/vue-compat-coverage.test.ts（对比运行时导出，新增未分类项即红）。 */
export const VUE_INTERNAL_EXPORTS = new Set<string>([
  // VNode 类型常量 / 过渡基类
  'Fragment', 'Text', 'Comment', 'Static', 'BaseTransition', 'BaseTransitionPropsValidators',
  // VNode 创建与 block 机制（模板编译期生成）
  'createVNodeHelper', 'createBlock', 'createCommentVNode', 'createElementBlock', 'createElementVNode',
  'createStaticVNode', 'createTextVNode', 'openBlock', 'setBlockTracking', 'isMemoSame', 'withMemo',
  'transformVNodeArgs', 'createPropsRestProxy', 'guardReactiveProps', 'createSlots', 'renderList',
  // 属性/事件/文本归一（编译期已处理）
  'normalizeClass', 'normalizeStyle', 'normalizeProps', 'toDisplayString', 'toHandlerKey',
  'withModifiers', 'withKeys', 'mergeDefaults', 'mergeModels',
  // v-model / v-show 指令实现（模板编译期处理）
  'vModelText', 'vModelCheckbox', 'vModelRadio', 'vModelSelect', 'vModelDynamic', 'vShow',
  // 过渡内部
  'useTransitionState', 'getTransitionRawChildren', 'resolveTransitionHooks', 'setTransitionHooks',
  // 作用域 id / 运行时编译器 / devtools 内部
  'pushScopeId', 'popScopeId', 'registerRuntimeCompiler', 'isRuntimeOnly', 'setDevtoolsHook',
  'initCustomFormatter', 'compatUtils',
  // SSR 内部
  'createHydrationRenderer', 'initDirectivesForSSR', 'ssrContextKey', 'ssrUtils',
  'hydrateOnIdle', 'hydrateOnVisible', 'hydrateOnInteraction', 'hydrateOnMediaQuery',
  'withAsyncContext',
  // 错误处理内部
  'callWithErrorHandling', 'callWithAsyncErrorHandling', 'handleError', 'assertNumber',
  // 响应式内部类型/枚举
  'ReactiveEffect', 'TrackOpTypes', 'TriggerOpTypes', 'DeprecationTypes', 'ErrorCodes', 'ErrorTypeStrings',
  // @vue/shared 字符串工具
  'camelize', 'capitalize',
  // Vue 2 遗留
  'resolveFilter',
  // ESM 命名空间噪声
  '__esModule',
])

/** ★矩阵外/未知的 Vue 命名导入处理：默认按 unsupported（无降级→error）——反黑盒兜底，防静默未定义引用 */
export const VUE_COMPAT_UNKNOWN: VueCompatEntry = {
  name: '<unknown-vue-api>',
  group: 'component',
  status: 'unsupported',
  note: '未在「Vue 全能力基准线」登记——可能为 Vue 内部导出；若在 MP 使用将输出未定义引用——请在 02-api-gap 对照，避免使用或提交通知对齐',
  source: '评估（未知默认 unsupported）',
}

/** ★内部导出条目（VUE_INTERNAL_EXPORTS 命中时返回——准确说明替代「可能为内部导出」的模糊兜底） */
export const VUE_COMPAT_INTERNAL: VueCompatEntry = {
  name: '<vue-internal>',
  group: 'component',
  status: 'unsupported',
  note: 'Vue 内部导出（编译期已生成对等结构 / 运行时内部机制 / SSR / 自定义渲染器）——用户代码不应直接使用；请用模板 DSL 或框架语义 API',
  source: '评估（Vue 内部导出集合）',
}

/** 查询 Vue 能力的对齐状态；未登记 → 别名表 → 内部导出集合 → VUE_COMPAT_UNKNOWN（均 unsupported 无降级 → error） */
export function vueCompatStatus(name: string): VueCompatEntry {
  const direct = VUE_COMPAT_MATRIX.find((e) => e.name === name)
  if (direct) return direct
  // ★别名：PascalCase 组件导入（Teleport/KeepAlive…）→ 已登记的模板形态（<teleport>/<keep-alive>…）
  const alias = VUE_COMPAT_ALIASES[name]
  if (alias) {
    const target = VUE_COMPAT_MATRIX.find((e) => e.name === alias)
    if (target) return target
  }
  // ★内部导出集合：给出准确说明（仍是 unsupported + error——反黑盒不放松）
  if (VUE_INTERNAL_EXPORTS.has(name)) return { ...VUE_COMPAT_INTERNAL, name }
  return VUE_COMPAT_UNKNOWN
}

/** 根据状态 + degrade 判断编译期提示级别：aligned=null（无提示）；partial 或 (unsupported+degrade)=(warning)；unsupported 无 degrade=(error) */
export function vueCompatLevel(entry: VueCompatEntry): 'none' | 'warning' | 'error' {
  if (entry.status === 'aligned') return 'none'
  // partial 恒 warning；unsupported 有降级策略 → warning，无 → error（用户规则）
  if (entry.status === 'partial') return 'warning'
  return entry.degrade ? 'warning' : 'error'
}
