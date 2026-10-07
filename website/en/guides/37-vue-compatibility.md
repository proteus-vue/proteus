---
title: Vue compatibility
order: 37
group: 渲染与能力
---

# Vue compatibility

You write **standard Vue SFC**, but cross-target output goes through the compiler. Every Vue capability must get a definite verdict — nothing silently produces a broken artifact. This page lists **only what you need to know**: of `128` capabilities, `57` work directly (no need to enumerate them); the `71` below are restricted or rejected.

| Verdict | Count | Meaning |
|---|---|---|
| **❌ Compile error** | **53** | The compiler `fail-closed`s and stops — **this is what you most need to know in advance** |
| ⚠️ Compile warning | 18 | Compiles, but behaviour may differ from the Web (noted per entry below) |

> **Scope (important)**: this table constrains the **mini-program compile path** (`compileVueSfc`). **The Web side is not affected** — it runs standard Vite + Vue, executed by the browser.
>
> **Relation to the "Vapor update path" page**: that one is about whether the **update mechanism** can use Vue's official implementation (answer: not on App/mini-program, because the framework is built on a custom renderer — see [Vapor update path](/docs/framework/43-vapor-update-path)); this page is about how far **language capabilities** are supported. Different questions.

★**This page is generated from code** (`VUE_COMPAT_MATRIX` is the SSOT; the `check:vue-compat-doc` gate compares them) — the table cannot drift from the implementation.

## Unsupported / restricted capabilities

### Reactivity

| Capability | Status | Verdict | Notes & alternatives |
|---|---|---|---|
| `effect` | Unsupported | **❌ Compile error** | Bare effect has no equivalent — use watchEffect/computed |
| `stop` | Unsupported | **❌ Compile error** | Stopping an effect has no mini-program equivalent |
| `triggerRef` | Partial | ⚠️ Compile warning | triggerRef(ref) needs shallowRef to be a runtime ref object — shallowRef is currently inlined at compile time (this.data.x holds a value), so there is no ref to pass; only works for runtime refs from toRef/toRefs/factory |
| `getCurrentScope` | Unsupported | **❌ Compile error** | effectScope is runtime-only; no mini-program equivalent |
| `effectScope` | Unsupported | **❌ Compile error** | Scope has no mini-program equivalent |
| `onScopeDispose` | Unsupported | **❌ Compile error** | Scope cleanup has no mini-program equivalent — use onUnmounted |
| `onWatcherCleanup` | Unsupported | **❌ Compile error** | watch cleanup has no mini-program equivalent |
| `getCurrentWatcher` | Unsupported | **❌ Compile error** | Current watcher has no mini-program equivalent |
| `EffectScope` | Unsupported | **❌ Compile error** | effectScope class (runtime scope) has no mini-program equivalent — clean up with onUnmounted |

### Component & runtime

| Capability | Status | Verdict | Notes & alternatives |
|---|---|---|---|
| `defineComponent` | Partial | ⚠️ Compile warning | SFCs are already components; the defineComponent(...) wrapper is stripped (no-op). Options/setup inside the wrapper are not compiled — use <script setup> or the template directly |
| `defineOptions` | Partial | ⚠️ Compile warning | Macro stripped as a no-op (compileScript is authoritative); name/inheritAttrs have no component-level mini-program equivalent and do not take effect — pass component attributes through the properties/attrs channel |
| `defineSlots` | Partial | ⚠️ Compile warning | Type-only declaration, handled as slot passthrough (macro stripped; no artifact side effects) |
| `defineModel` | Partial | ⚠️ Compile warning | compileScript expands it to _useModel(__props, name): registers the prop and rewrites m.value access (read → data.prop / write → triggerEvent update-prop); model modifiers and nesting are not fully wired — explicit props+emit gives you both |
| `useModel` | Partial | ⚠️ Compile warning | Same as defineModel (runtime model state via _useModel expansion; modifiers/nesting not fully wired) — explicit props+emit gives you both |
| `queuePostFlushCb` | Unsupported | **❌ Compile error** | Internal scheduler; no mini-program equivalent |
| `h` | Unsupported | **❌ Compile error** | Runtime rendering (explicitly out of scope, §0.4) — use the template DSL |
| `createVNode` | Unsupported | **❌ Compile error** | Same as h — use the template DSL |
| `cloneVNode` | Unsupported | **❌ Compile error** | Same as h |
| `isVNode` | Unsupported | **❌ Compile error** | Runtime node predicate; no mini-program equivalent |
| `createApp` | Unsupported | **❌ Compile error** | Runtime rendering (out of scope) — use proteus.build / the route table |
| `getCurrentInstance` | Unsupported | **❌ Compile error** | Internal runtime API — a dedicated framework semantic API (e.g. useMpInstance/adapter.selectorQuery) will cover it; do not use it directly on mini-program |
| `useSlots` | Unsupported | **❌ Compile error** | Internal runtime API — inside a component use <slot> passthrough + the slots prop |
| `useAttrs` | Unsupported | **❌ Compile error** | Internal runtime API — attrs flow through the $attrs artifact surface |
| `useTemplateRef` | Partial | ⚠️ Compile warning | useTemplateRef(name) → this.<var> = this.selectComponent('#name') (component instance ref) with .value stripped in method bodies; at onLoad the child may not be mounted yet (null) — available after onReady (honest timing boundary) |
| `useId` | Unsupported | **❌ Compile error** | Runtime id; no mini-program equivalent |
| `useSSRContext` | Unsupported | **❌ Compile error** | SSR; no mini-program equivalent |
| `hasInjectionContext` | Unsupported | **❌ Compile error** | SSR injection check; no mini-program equivalent |
| `resolveComponent` | Unsupported | **❌ Compile error** | Vue internal render helper — users should not import it; components resolve statically via usingComponents. Currently emitted as a bare call → not defined |
| `resolveDirective` | Unsupported | **❌ Compile error** | Custom directives have no equivalent (Batch A) — use a method call |
| `resolveDynamicComponent` | Unsupported | **❌ Compile error** | <component :is> has no equivalent — use v-if |
| `renderSlot` | Unsupported | **❌ Compile error** | Vue internal render helper — <slot> is compiled by the template compiler; do not call it manually. Currently emitted as a bare call → not defined |
| `mergeProps` | Unsupported | **❌ Compile error** | Vue internal render helper — props are normalised at compile time; do not call it manually. Currently emitted as a bare call → not defined |
| `toHandlers` | Unsupported | **❌ Compile error** | Vue internal render helper — events are normalised at compile time; do not call it manually. Currently emitted as a bare call → not defined |
| `withCtx` | Unsupported | **❌ Compile error** | Vue internal render helper — scoped slots are generated by the template compiler (advance Batch 7); do not call it manually. Currently emitted as a bare call → not defined |
| `withDirectives` | Unsupported | **❌ Compile error** | Custom directives have no equivalent (Batch A) |
| `withScopeId` | Unsupported | **❌ Compile error** | Vue internal render helper — scoped CSS is injected by the compiler via scope attributes; do not call it manually. Currently emitted as a bare call → not defined |
| `warn` | Unsupported | **❌ Compile error** | Vue internal warn; no mini-program equivalent — use console.warn |
| `devtools` | Unsupported | **❌ Compile error** | Vue devtools API — on mini-program use @proteus-vue/devtools |
| `defineAsyncComponent` | Unsupported | ⚠️ Compile warning | Async components have no equivalent (no runtime component loading on mini-program) — declare them statically in usingComponents and load them via subpackage lazy loading |
| `useCssVars` | Unsupported | ⚠️ Compile warning | Runtime CSS-variable injection has no equivalent (neither Skyline nor WebView supports writing CSS vars at runtime) — use :style bindings or a static class |
| `useCssModule` | Unsupported | **❌ Compile error** | CSS Modules have no equivalent — use scoped classes (Proteus is scoped by default) |
| `createSSRApp` | Unsupported | **❌ Compile error** | SSR app factory; no mini-program equivalent — pages are declared in app.json and generated from the route table |
| `render` | Unsupported | **❌ Compile error** | Runtime render entry (explicitly out of scope, §0.4) — use the template DSL |
| `hydrate` | Unsupported | **❌ Compile error** | SSR hydration; no mini-program equivalent |
| `compile` | Unsupported | **❌ Compile error** | Runtime template compilation (a bundle-size cost); Proteus compiles ahead of time — use SFCs |
| `defineCustomElement` | Unsupported | **❌ Compile error** | Web Components custom elements have no equivalent — use a .vue component (statically registered via usingComponents) |
| `defineSSRCustomElement` | Unsupported | **❌ Compile error** | SSR + Custom Elements; no mini-program equivalent |
| `useHost` | Unsupported | **❌ Compile error** | Custom Elements host; no mini-program equivalent |
| `useShadowRoot` | Unsupported | **❌ Compile error** | Shadow DOM; no mini-program equivalent |
| `VueElement` | Unsupported | **❌ Compile error** | Custom Elements base class; no mini-program equivalent |
| `createRenderer` | Unsupported | **❌ Compile error** | Custom renderer entry — Proteus uses @proteus-vue/renderer-app (G-41 host runtime SPI) |
| `nodeOps` | Unsupported | **❌ Compile error** | Vue internal DOM ops — Proteus uses @proteus-vue/render-backend (G-37 SPI) |
| `patchProp` | Unsupported | **❌ Compile error** | Vue internal prop patching — Proteus uses render-backend |

### Lifecycle

| Capability | Status | Verdict | Notes & alternatives |
|---|---|---|---|
| `onBeforeMount` | Partial | ⚠️ Compile warning | Maps to before attached (no beforeMount equivalent) — use the pre-onMounted slot |
| `onBeforeUnmount` | Partial | ⚠️ Compile warning | Maps to before detached — use the pre-onUnmounted slot |
| `onUpdated` | Partial | ⚠️ Compile warning | No mini-program equivalent — use watch / after setData |
| `onBeforeUpdate` | Partial | ⚠️ Compile warning | No mini-program equivalent — use watch before |
| `onActivated` | Unsupported | **❌ Compile error** | keep-alive has no equivalent — use onShow |
| `onDeactivated` | Unsupported | **❌ Compile error** | keep-alive has no equivalent — use onHide |
| `onErrorCaptured` | Partial | ⚠️ Compile warning | No equivalent hook; Web keeps native semantics (stripped + warned) |
| `onRenderTracked` | Unsupported | **❌ Compile error** | devtools debug hook; no mini-program equivalent |
| `onRenderTriggered` | Unsupported | **❌ Compile error** | Same as onRenderTracked |
| `onServerPrefetch` | Unsupported | **❌ Compile error** | SSR; no mini-program equivalent |

### Template & directives

| Capability | Status | Verdict | Notes & alternatives |
|---|---|---|---|
| `v-pre` | Partial | ⚠️ Compile warning | Stripping pure static content is equivalent; with {{ }} interpolation WXML has no raw mode and still interpolates (skipping compilation for v-pre is not implementable) — honest warning |
| `v-once` | Partial | ⚠️ Compile warning | Stripping pure static content is equivalent (static content renders once anyway); with {{ }} interpolation the mini-program data flow has no "render once" laziness — honest warning |
| `<transition-group>` | Partial | ⚠️ Compile warning | List transitions have no equivalent — use a component-level transition |
| `<keep-alive>` | Unsupported | **❌ Compile error** | No equivalent — use v-if with explicit caching, or a subpackage |
| `<suspense>` | Unsupported | **❌ Compile error** | No equivalent |
| `<component :is>` | Unsupported | **❌ Compile error** | Dynamic components have no equivalent — use v-if |
| `自定义指令` | Unsupported | **❌ Compile error** | Custom directives have no equivalent (Batch A already warns on v-) — use a method call |

### SFC compilation

| Capability | Status | Verdict | Notes & alternatives |
|---|---|---|---|
| `模板 ref="x"` | Partial | ⚠️ Compile warning | ref="x" → injects id="x" and collects it (useTemplateRef(name) → this.selectComponent('#name') for a component instance; may be null at onLoad) |

## What to do

1. **Check this page first** before writing — especially common-but-unsupported forms like `<keep-alive>` / `<component :is>` / custom directives;
2. **Read the alternatives**: most entries give an equivalent (e.g. `onActivated` → `onShow`, `<component :is>` → `v-if`, custom directives → method calls);
3. **Do not work around compile errors**: `❌` entries are **deliberate** failures (anti-black-box red line) — working around them only yields behaviourally wrong output;
4. **Test restricted items**: `⚠️` entries compile, but may behave differently from the Web (the difference is noted per entry).

## Section navigation

- [Introduction](/docs/01-intro): get something running
- [Components intro](/docs/12-components-intro): components and capabilities
- [Vapor update path](/docs/framework/43-vapor-update-path): update mechanism and why it is in-house
