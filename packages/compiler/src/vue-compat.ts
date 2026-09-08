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
  { name: 'reactive', group: 'reactivity', status: 'aligned', source: 'vue-compat §1 主路径' },
  { name: 'computed', group: 'reactivity', status: 'aligned', source: 'vue-compat §1 主路径（读写，proteusSetX）' },
  { name: 'shallowRef', group: 'reactivity', status: 'aligned', source: 'const-to-data' },
  // ★2026-09-08 P1 校准：shallowReactive/shallowReadonly 实测被当函数调用译为 this.x=shallowX(…) 裸标识符 → not defined（假降级）→ unsupported·error；readonly 实测字面量→data（可用降级）→ 保持 partial
  { name: 'shallowReactive', group: 'reactivity', status: 'unsupported', note: '深层浅响应 MP 无对等——当前译为 this.x=shallowReactive(…) 裸标识符 → not defined；请用 ref/普通对象', source: 'P1 校准' },
  { name: 'shallowReadonly', group: 'reactivity', status: 'unsupported', note: '只读约束未校验且译为裸调用 → not defined；请用 ref/普通对象', source: 'P1 校准' },
  { name: 'readonly', group: 'reactivity', status: 'partial', degrade: true, note: '只读约束编译期不校验（对象字面量→data 可用，只读语义丢失）；需只读请用属性只读约定', source: 'const-to-data' },
  { name: 'customRef', group: 'reactivity', status: 'unsupported', note: '自定义 ref 需运行时钩子，MP 无对等——请用 ref + watch/computed', source: '评估' },
  // ★2026-09-08 P1 校准：toRef/toRefs/toValue 实测译为 this.x=toRef(…) 裸标识符 → not defined（假降级）→ unsupported·error（与 isRef 等运行时守卫同批反黑盒）
  { name: 'toRef', group: 'reactivity', status: 'unsupported', note: '运行时引用重定向无对等——当前译为裸调用 → not defined；请用 ref 直接建模', source: 'P1 校准' },
  { name: 'toRefs', group: 'reactivity', status: 'unsupported', note: '同上——裸调用 → not defined；请用 ref 直接建模', source: 'P1 校准' },
  { name: 'toValue', group: 'reactivity', status: 'unsupported', note: '运行时取值无对等——裸调用 → not defined；请直接用 .value 读取', source: 'P1 校准' },
  { name: 'proxyRefs', group: 'reactivity', status: 'unsupported', note: '运行时代理，MP 无对等——直接用 .value', source: '评估' },
  { name: 'effect', group: 'reactivity', status: 'unsupported', note: '裸 effect 无对等——请用 watchEffect/computed', source: '评估' },
  { name: 'stop', group: 'reactivity', status: 'unsupported', note: 'effect 关闭，MP 无对等', source: '评估' },
  { name: 'triggerRef', group: 'reactivity', status: 'unsupported', note: '手动触发 shallowRef，MP 无对等——用 ref 替代', source: '评估' },
  { name: 'markRaw', group: 'reactivity', status: 'unsupported', note: '运行时标记，MP 无对等', source: '评估' },
  { name: 'unref', group: 'reactivity', status: 'unsupported', note: '运行时取值无对等——裸调用 → not defined；请直接用 .value 读取', source: 'P1 校准' },
  // ★2026-09-08 Step2 校准：isRef/isReactive/isReadonly/isProxy/isShallow 实测被当「函数调用初始化」译为 this.x=isX(…)，
  //   产物为裸标识符且无 vue import → 运行时 not defined（getCurrentInstance 同类）——标记 aligned 是假，降 unsupported（无降级→error）
  { name: 'isRef', group: 'reactivity', status: 'unsupported', note: '运行时类型守卫无对等——isRef 编译期可内联 true/false 但未实现；当前译为 this.x=isRef(…) 裸标识符 → not defined；请改用框架语义 API 或直接判别', source: '评估（Step2 实测校准）' },
  { name: 'isReactive', group: 'reactivity', status: 'unsupported', note: '同上——运行时守卫未内联，产物裸标识符 → not defined；请改用框架语义 API', source: '评估（Step2 实测校准）' },
  { name: 'isReadonly', group: 'reactivity', status: 'unsupported', note: '同上——运行时守卫未内联，产物裸标识符 → not defined', source: '评估（Step2 实测校准）' },
  { name: 'isProxy', group: 'reactivity', status: 'unsupported', note: '同上——运行时守卫未内联，产物裸标识符 → not defined', source: '评估（Step2 实测校准）' },
  { name: 'isShallow', group: 'reactivity', status: 'unsupported', note: '同上——运行时守卫未内联，产物裸标识符 → not defined', source: '评估（Step2 实测校准）' },
  { name: 'toRaw', group: 'reactivity', status: 'unsupported', note: '运行时去代理，MP 无对等', source: '评估' },
  { name: 'getCurrentScope', group: 'reactivity', status: 'unsupported', note: 'effectScope 运行时，MP 无对等', source: '评估' },
  { name: 'effectScope', group: 'reactivity', status: 'unsupported', note: '作用域，MP 无对等', source: '评估' },
  { name: 'onScopeDispose', group: 'reactivity', status: 'unsupported', note: '作用域清理，MP 无对等——用 onUnmounted', source: '评估' },
  { name: 'onWatcherCleanup', group: 'reactivity', status: 'unsupported', note: 'watch 清理，MP 无对等', source: '评估' },
  { name: 'getCurrentWatcher', group: 'reactivity', status: 'unsupported', note: '当前 watcher，MP 无对等', source: '评估' },
  // watch 族
  { name: 'watch', group: 'reactivity', status: 'aligned', source: 'vue-compat §1 主路径（ref/数组/函数/props 源）' },
  { name: 'watchEffect', group: 'reactivity', status: 'unsupported', note: '立即执行+依赖追踪——请用 watch(源, cb, {immediate:true}) 或 computed', source: '评估' },
  { name: 'watchPostEffect', group: 'reactivity', status: 'unsupported', note: '同上；flush post 无对等', source: '评估' },
  { name: 'watchSyncEffect', group: 'reactivity', status: 'unsupported', note: '同上；flush sync 无对等', source: '评估' },

  // ===== component API =====
  // ★2026-09-08 P1 校准：defineComponent 在 <script setup> 为冗余包装（SFC 已自动组件化）——编译器识别并剥离为 no-op（不落 data/不裸注入 onLoad），矩阵 partial（警告：包装 options 未编译，请用 <script setup>）；对内 setup 逻辑不翻译（非 SFC 范式）
  { name: 'defineComponent', group: 'component', status: 'partial', degrade: true, note: 'SFC 已自动组件化，defineComponent(...) 包装剥离（no-op）；包装内 options/setup 不编译——请直接用 <script setup> 或模板', source: 'P1 校准（no-op 剥离）' },
  { name: 'defineProps', group: 'component', status: 'aligned', source: 'vue-compat §1（define-props）' },
  { name: 'defineEmits', group: 'component', status: 'aligned', source: 'vue-compat §1（define-emits）' },
  { name: 'defineExpose', group: 'component', status: 'aligned', source: 'define-expose（no-op+校验）' },
  // ★2026-09-08 P1 校准：defineOptions 被当顶层副作用裸注入 onLoad → not defined；defineModel/useModel 产物 data.x=undefined（假降级）→ unsupported·error
  { name: 'defineOptions', group: 'component', status: 'unsupported', note: '组件选项（name/inheritAttrs）无对等——当前裸注入 onLoad → not defined；请用 <script> options', source: 'P1 校准' },
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
  { name: 'useTemplateRef', group: 'component', status: 'unsupported', note: '模板 ref 无对等（Batch A 已警告 ref=）——用 selectComponent', source: 'vue-compat Batch A' },
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
  // ★Step2 校准：v-text/v-once 实测被当自定义指令剥离+警告（文本内容丢失/语义丢失）；v-pre 剥离但 {{ }} 仍插值（未生效）——均降 partial
  { name: 'v-text', group: 'template', status: 'partial', degrade: true, note: '被当自定义指令剥离且不执行，文本内容丢失——请用 {{ }} 插值', source: '评估（Step2 实测校准）' },
  { name: 'v-pre', group: 'template', status: 'partial', degrade: true, note: '剥离但 {{ }} 仍插值（v-pre 应跳过编译）——当前不生效', source: '评估（Step2 实测校准）' },
  { name: 'v-once', group: 'template', status: 'partial', degrade: true, note: '剥离+警告，丢失只渲染一次语义——MP 数据驱动无对应惰性，请用模板内联', source: '评估（Step2 实测校准）' },
  { name: 'v-cloak', group: 'template', status: 'aligned', source: 'vue-compat §1（MP 无首帧未编译闪烁——剥离保留正常插值，语义等价 noop）' },
  { name: 'v-slot', group: 'template', status: 'aligned', source: 'vue-compat §1（具名）' },
  { name: ':class', group: 'template', status: 'aligned', source: 'vue-compat §1（数组+对象简写）' },
  { name: ':style', group: 'template', status: 'aligned', source: 'v-bind-style 派生序列化（#500）' },
  { name: '<transition>', group: 'template', status: 'aligned', source: 'advance Batch 2/5（进入+离开动画）' },
  { name: '<transition-group>', group: 'template', status: 'partial', degrade: true, note: '列表过渡无对等——用组件级 transition', source: 'advance Batch 2' },
  { name: '<keep-alive>', group: 'template', status: 'unsupported', note: '无对等——用 v-if + 显式缓存，或分包', source: '评估' },
  { name: '<teleport>', group: 'template', status: 'unsupported', note: 'MP 无对等——root-portal（Skyline）或固定容器', source: '评估' },
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
  { name: '模板 ref="x"', group: 'sfc', status: 'unsupported', note: '无对等（Batch A 已警告）——用 selectComponent', source: 'vue-compat Batch A' },
  { name: 'TS 类型注解', group: 'sfc', status: 'aligned', source: 'vue-compat §1（TS 剥除）' },
]

/** ★Vue 公共常量导出（编译期内联值）：`const v = <name>` 时把裸标识符内联为字面量（替代运行时轮询 undefined）。
 *  版本号与 02-api-gap 基线「Vue 全集权威来源」的 @vue/runtime-core@3.5.42 对齐；随 Vue 版本演进同步。 */
export const VUE_PUBLIC_CONSTS: Record<string, unknown> = {
  version: '3.5.42',
}

/** ★矩阵外/未知的 Vue 命名导入处理：默认按 unsupported（无降级→error）——反黑盒兜底，防静默未定义引用 */
export const VUE_COMPAT_UNKNOWN: VueCompatEntry = {
  name: '<unknown-vue-api>',
  group: 'component',
  status: 'unsupported',
  note: '未在「Vue 全能力基准线」登记——可能为 Vue 内部导出；若在 MP 使用将输出未定义引用——请在 02-api-gap 对照，避免使用或提交通知对齐',
  source: '评估（未知默认 unsupported）',
}

/** 查询 Vue 能力的对齐状态；未登记 → VUE_COMPAT_UNKNOWN（unsupported，无降级，error） */
export function vueCompatStatus(name: string): VueCompatEntry {
  return VUE_COMPAT_MATRIX.find((e) => e.name === name) ?? VUE_COMPAT_UNKNOWN
}

/** 根据状态 + degrade 判断编译期提示级别：aligned=null（无提示）；partial 或 (unsupported+degrade)=(warning)；unsupported 无 degrade=(error) */
export function vueCompatLevel(entry: VueCompatEntry): 'none' | 'warning' | 'error' {
  if (entry.status === 'aligned') return 'none'
  // partial 恒 warning；unsupported 有降级策略 → warning，无 → error（用户规则）
  if (entry.status === 'partial') return 'warning'
  return entry.degrade ? 'warning' : 'error'
}
