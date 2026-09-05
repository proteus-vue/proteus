---
title: Compile rule catalog
order: 41
group: 工程命令
generated: true
---

# Compile rule catalog

> 76 compile rules — every rule ships its own AI explainer (id / when / before → after / why). SSOT = `@proteus-vue/compiler` TRANSFORM_RULES, same source as `npx proteus rules` and the Playground trace.

## Template transforms (42)

### `tag/div-to-view`

**div → view**

block-level container div → view (the universal Mini Program container)

```
before: <div class="home">…</div>
after:  <view class="home">…</view>
```

> why: Mini Programs have no div; view is the most general-purpose container tag, so business code keeps writing standard HTML (§0.3 Principle 1)

### `tag/inline-to-text`

**span → text**

inline text span → text (the minimal Mini Program text node)

```
before: <span>hi</span>
after:  <text>hi</text>
```

> why: Mini Programs have no span; text is the inline text container: it does not wrap by default and text can be nested inside text

### `tag/heading-to-text`

**h1–h6 → text**

headings h1-h6 → text, automatically appending the proteus-h1~h6 base classes (see semantic/base-class)

```
before: <h1>标题</h1>
after:  <text class="proteus-h1">标题</text>
```

> why: Mini Programs have no heading tags; the semantics (larger size/bold) are restored by the base classes (#58), aligning the visuals with Web UA styles

### `tag/para-to-text`

**p → text**

paragraph p → text, automatically appending the proteus-p base class (paragraph spacing aligned with Web)

```
before: <p>段落</p>
after:  <text class="proteus-p">段落</text>
```

> why: once p is mapped to text there is no UA default paragraph spacing, so the base class injects margin: 0 0 1em to restore the Web collapsing spacing (#59)

### `tag/link-to-view`

**a → view**

link a → view (upgraded to a navigation link when it carries href; see nav/navigate-link)

```
before: <a href="/pages/user/index">用户</a>
after:  <view class="proteus-a" data-url="/pages/user/index" bindtap="proteusNavigateTo">用户</view>
```

> why: Mini Programs have no a tag; the navigation semantics are carried by data-url + bindtap="proteusNavigateTo", and the styling semantics by the proteus-a base class

### `tag/image`

**img → image**

image img → image; the :src binding is converted to src="{{url}}" via directive/v-bind

```
before: <img :src="url" />
after:  <image src="{{url}}" />
```

> why: the Mini Program image tag is image

### `tag/passthrough`

**same-name tags are kept as-is**

button / input / textarea / video / canvas / scroll-view / slot keep the same name (native to Mini Programs)

```
before: <button>go</button>
after:  <button>go</button>
```

> why: these tags already exist natively in Mini Programs, so no mapping is needed; input/textarea are also the v-model targets (directive/v-model)

### `tag/router-link`

**router-link → view**

Vue Router router-link → view + navigation link (the to attribute → data-url)

```
before: <router-link to="/pages/user/index">用户</router-link>
after:  <view data-url="/pages/user/index" bindtap="proteusNavigateTo">用户</view>
```

> why: Mini Programs have no Vue Router component; they are uniformly converted to navigation links (decision #24: <a href> / <router-link> are both navigation entry points)

### `tag/rich-text`

**v-html container → rich-text**

container elements with v-html → rich-text (nodes="{{expr}}")

```
before: <div v-html="html"></div>
after:  <rich-text nodes="{{html}}" />
```

> why: Mini Programs have no innerHTML; rich text is rendered as HTML nodes by the rich-text component

### `tag/unknown-kebab`

**unregistered tags are emitted as-is in kebab-case**

tags not covered by TAG_MAP are emitted as-is in kebab-case (the escape hatch for components / custom elements)

```
before: <custom-comp foo="bar" />
after:  <custom-comp foo="bar" />
```

> why: whitelist mapping + conservative retention of unknown tags: the standard Vue component system (Principle 9) and the native-component escape hatch (the pain point #11 countermeasure) rely on this channel

### `semantic/base-class`

**semantic tags automatically get proteus-* base classes appended**

when h1-h6/p/a are mapped, the proteus-h1~h6 / proteus-p / proteus-a classes are appended automatically (merged with the user class and concatenated with :class interpolation)

```
before: <h1 class="title">a</h1>
after:  <text class="proteus-h1 title">a</text>
```

> why: on the Web, h1-h6/p/a carry browser UA default styles, while Mini Program text/view have none; the base classes + base WXSS (style/semantic-base-wxss) restore visual parity across both ends (#58)

### `event/click-to-tap`

**@click → bindtap (the full EVENT_MAP table)**

standard events → Mini Program events: click→tap, while input/change/submit/focus/blur/touch*/longpress/confirm keep the same name

```
before: <button @click="handleTap">go</button>
after:  <button bindtap="handleTap">go</button>
```

> why: Mini Programs have no click; the tap event is the click counterpart; the other events keep the same names (EVENT_MAP is centralized in tags.ts and shared with the style side)

### `event/modifier-catch`

**.stop / .prevent modifiers → the catch prefix**

@click.stop / @click.prevent → catchtap (prevents bubbling); the other modifiers are ignored

```
before: <a @click.stop="stopFn">s</a>
after:  <a catchtap="stopFn">s</a>
```

> why: Mini Programs have no event-modifier syntax; catch* events natively stop propagation, which is equivalent to .stop; .prevent has no counterpart, so it is mapped to catch as a fallback

### `event/modifier-self-once`

**.self / .once modifiers → wrapper methods (late v0.3)**

@click.self="fn" → bindtap="proteusSelfFn" (fires only when e.target === e.currentTarget); @click.once="fn" → bindtap="proteusOnceFn" (a data flag prevents firing after the first trigger); only handlers with a simple method name are wrapped

```
before: @click.self="handleTap" / @click.once="handleTap"
after:  bindtap="proteusSelfHandleTap" / bindtap="proteusOnceHandleTap"（包装方法生成于 Page methods）
```

> why: Mini Programs have no native .self/.once semantics, so wrapper methods are generated at compile time (on the script side): self uses a source-event check and once uses a data flag; key modifiers (@keyup.enter) have no equivalent keyboard event → a compile-time warning (use @confirm on input)

### `event/handler-simple-ref`

**event handlers support only simple method references**

only handleTap / handleTap($event) are supported; complex expressions raise a compile-time warning and are emitted as-is

```
before: @click="count > 0 ? go() : back()"
after:  编译期警告：不是简单方法引用，原样输出（产物需人工处理）
```

> why: MVP contraction (Principle 10): Mini Program event handlers must be method names in Page methods; inline expressions cannot be statically compiled

### `directive/v-if`

**v-if → wx:if**

v-if="show" → wx:if="{{show}}"

```
before: <p v-if="show">a</p>
after:  <p wx:if="{{show}}">a</p>
```

> why: the Mini Program conditional-rendering directive is wx:if

### `directive/v-else-if`

**v-else-if → wx:elif**

v-else-if="cond" → wx:elif="{{cond}}"

```
before: <p v-else-if="b">c</p>
after:  <p wx:elif="{{b}}">c</p>
```

> why: the Mini Program conditional-chain directive is wx:elif

### `directive/v-else`

**v-else → wx:else**

v-else → wx:else (takes no value)

```
before: <p v-else>b</p>
after:  <p wx:else>b</p>
```

> why: the Mini Program conditional-chain directive is wx:else

### `directive/v-for`

**v-for → wx:for / wx:for-item / wx:for-index**

v-for="(item, idx) in list" → wx:for="{{list}}" + wx:for-item + wx:for-index (supports in/of)

```
before: <div v-for="(item, idx) in list" :key="idx">{{ item }}</div>
after:  <view wx:for="{{list}}" wx:for-item="item" wx:for-index="idx" wx:key="idx">{{ item }}</view>
```

> why: the Mini Program loop directive is wx:for, and the item/index variable names must be declared explicitly

### `directive/v-bind`

**plain :prop binding → prop="{{expr}}"**

:src / :href / any attribute binding → attribute="{{expression}}"; static attributes are kept as-is

```
before: <img :src="url" />
after:  <image src="{{url}}" />
```

> why: Mini Program attribute-binding syntax is {{expr}}; static attributes (e.g. placeholder="x") are passed through directly

### `directive/v-bind-class`

**:class binding (object/array syntax → ternary concatenation)**

:class="{ active: on }" → {{(on?'active ':'')}}; the array syntax (v0.3) → item-by-item concatenation (string/object/simple variable/ternary)

```
before: <p :class="[activeClass, { active: on }]">b</p>
after:  <text class="proteus-p {{((activeClass)?(activeClass)+' ':'')+(on?'active ':'')}}">b</text>
```

> why: Mini Programs have no object/array class syntax, so the compiler concatenates ternary expressions; the array syntax was completed in v0.3 (splitTopLevel splits at top-level commas, skipping commas inside strings/parentheses)

### `directive/v-bind-style`

**:style binding (object syntax → prop:{{expr}} concatenation)**

:style="{ color: c }" → style="color:{{c}}"; camelCase property names → kebab-case

```
before: :style="{ backgroundColor: bg }"
after:  style="background-color:{{bg}}"
```

> why: the Mini Program style attribute supports inline interpolation, so compiling per-property can be statically validated

### `directive/v-bind-key`

**:key → wx:key (simple identifiers only)**

:key="idx" → wx:key="idx"; identifiers that are not simple trigger a compile-time warning and are ignored

```
before: :key="idx"
after:  wx:key="idx"
```

> why: the Mini Program list-reuse key is wx:key, which accepts only simple identifiers

### `directive/v-model`

**v-model → value + an automatic bindinput handler**

v-model="x" on input/textarea → value="{{x}}" + bindinput="proteusOnXInput" (the handler that performs the setData is injected by the script phase)

```
before: <input v-model="name" />
after:  <input value="{{name}}" bindinput="proteusOnNameInput" />
```

> why: Mini Programs have no v-model syntax; the two halves of two-way binding are needed: a value binding + a write-back on the input event (script/vmodel-handler)

### `directive/v-html`

**v-html → rich-text nodes**

v-html="html" → rich-text nodes="{{html}}" (the container tag is mapped to rich-text)

```
before: <div v-html="html"></div>
after:  <rich-text nodes="{{html}}" />
```

> why: Mini Programs have no innerHTML; rich text uses the rich-text component (native capability as the fallback, the pain point #11 countermeasure)

### `directive/v-show`

**v-show → the hidden attribute**

v-show="show" → hidden="{{!show}}" (the Mini Program hidden attribute equals display:none, and the element is always rendered)

```
before: <p v-show="show">a</p>
after:  <p hidden="{{!show}}">a</p>
```

> why: Mini Programs have no v-show directive; the hidden attribute is its semantic equivalent (toggling display:none); the element stays in the document flow, unlike v-if which removes it (completed in v0.3; previously an MVP limitation)

### `directive/custom`

**custom directives are stripped (warning when there is no equivalent)**

custom directives such as v-focus have no equivalent mechanism in Mini Programs — warned at compile time and stripped (the logic never executes), no longer silently

```
before: <input v-focus />
after:  <input /> + 警告（已剥离）
```

> why: anti-black-box (vue-compat Batch A, decision #116): when the platform has no equivalent capability, it must warn explicitly at compile time

### `template/is-component`

**dynamic component <component :is> has no equivalent — warning**

the <component :is> dynamic component has no equivalent mechanism in Mini Programs — a warning is raised (the output would be an invalid tag); conditional rendering with v-if/v-else is recommended

```
before: <component :is="which" />
after:  警告 + 原样输出（无效标签）
```

> why: anti-black-box (vue-compat Batch A, decision #116): no longer silently emitting invalid output

### `event/inline-expression`

**inline event expressions → wrapper methods (vue-compat Batch B)**

@click="count++" (increment/decrement) and @click="fn(1)" (a simple method call) → a proteusInlineXxx wrapper method is generated (setData update / this.fn(1)), keeping the output runnable; complex expressions still warn

```
before: @click="count++"
after:  bindtap="proteusInlineIncCount" + 方法 setData({ count: this.data.count + 1 })
```

> why: support for common Vue patterns (decision #116 Batch B): no longer emitting an invalid bindtap as-is; aligned with the ref rewriting (this.data.x ± 1, decision #36)

### `slot/scoped-slot`

**scoped-slot warning (★Batch 7: MP/Skyline platform-limitation confirmation + alternative pattern)**

<slot :item="x"> scoped slots have no equivalent mechanism in Mini Programs (the parent cannot access child data) — ★platform limitation: WeChat has no template parameter-passing mechanism (webview template import cannot dynamically pick among multiple parent templates, and Skyline does not support cross-file templates); the uni-app/Taro MP sides are likewise incomplete — compile-time warning + alternative pattern: the child component receives data via props and reports it back through custom-event callbacks (<MyList :items :item-tap>)

```
before: <slot :item="item" />
after:  <slot /> + 警告（替代：props 传子 + triggerEvent 事件回调）
```

> why: anti-black-box (vue-compat-advance Batch 1/7, decision #117): no longer silently emitting invalid attributes; runtime equivalence is limited by MP platform capabilities (not a TODO — the props + events alternative is fully supported by the component system)

### `transition/component`

**<transition> → decorative enter animation (an animation class is injected into the child element)**

<transition name="fade"> is handled decoratively: the transition tag itself is not emitted, and the child element is injected with class="proteus-transition-{name}" (the enter animation replays automatically on re-mount); wxss injects keyframes on demand according to usesTransition (fade/slide-up/scale)

```
before: <transition name="fade"><view v-if="on">X</view></transition>
after:  <view class="proteus-transition-fade" wx:if="{{__tv0}}">X</view>
```

> why: the runtime equivalent of Vue <transition> (vue-compat-advance Batch 2, decision #117): MP has no native Transition, so the compiler injects an animation class + keyframes to fill the gap; it complements route routeType transitions (element-level vs page-level)

### `transition/leave-state`

**<transition> leave-animation state machine (bare-ref v-if removed with a delay)**

the leave animation is enabled when the v-if on a direct child of transition is a bare ref name: v-if is rewritten to wx:if="{{__tv{i}}}" (the visible state, initially equal to the ref initial value) plus the class interpolation {{__tl{i} ? "...-leave" : ""}} (switching to the leave animation while leaving); the script generates proteusTransitionToggle{i}() (injected at the ref write points: when on turns false → __tl{i}=true plays the leave animation and, after a setTimeout of that duration, __tv{i}=false delays the removal; when on turns true → the timer is cancelled and the enter animation resumes); wxss injects the leave class and keyframes on demand (forwards keeps the last frame)

```
before: <transition name="fade"><view v-if="on">X</view></transition>
after:  <view wx:if="{{__tv0}}" class="proteus-transition-fade {{__tl0 ? 'proteus-transition-fade-leave' : ''}}">X</view> + data __tv0/__tl0 + proteusTransitionToggle0()
```

> why: the Vue transition leave semantics: when v-if turns false, the leave animation plays first and only then is the element removed (vue-compat-advance Batch 5); MP wx:if removes immediately without animation — a compile-time state machine fills the gap; only bare-ref v-if is supported (complex expressions keep the Batch 2 behavior)

### `template/template-ref`

**template ref has no equivalent — warning**

a template ref such as ref="el" has no equivalent binding in Mini Programs (never assigned) — a warning is raised; this.selectComponent("#id") is recommended

```
before: <input ref="el" />
after:  <input /> + 警告
```

> why: anti-black-box (vue-compat Batch A, decision #116): no longer silent about having no effect

### `template/no-peer`

**warnings for platform components with no equivalent (Transition/Teleport, etc.)**

transition/transition-group/teleport/suspense/keep-alive have no equivalent in Mini Programs — a warning is raised (kept as-is, without effect)

```
before: <transition name="fade">…</transition>
after:  警告 + 原样输出
```

> why: anti-black-box (vue-compat Batch A, decision #116): use the routeType transition for transitions; remove keep-alive/teleport usage

### `nav/navigate-link`

**<a href> / <router-link to> → navigation link**

navigation links with href/to → data-url + data-route-type + bindtap="proteusNavigateTo" (the handler is injected by script/nav-handler)

```
before: <a href="/pages/user/index">用户</a>
after:  <view class="proteus-a" data-url="/pages/user/index" bindtap="proteusNavigateTo">用户</view>
```

> why: on the Web <a> relies on browser navigation, while on Mini Programs it must become data-url + a tap-based jump (decision #24); the leading / is kept as an absolute path (#30 real-device lesson: without the leading / the path resolves against the current page directory and doubles the prefix)

### `nav/route-type`

**navigation-link route-type attribute → data-route-type**

<a route-type="halfScreen"> → data-route-type="halfScreen" (proteusNavigateTo forwards it as the routeType of wx.navigateTo)

```
before: <a href="/pages/user/profile" route-type="halfScreen">资料</a>
after:  <view data-url="/pages/user/profile" data-route-type="halfScreen" bindtap="proteusNavigateTo">资料</view>
```

> why: when a Skyline custom route transition is initiated from a navigation link, routeType must reach the runtime (decision #44: routeType shares the same API on both ends)

### `node/interpolation`

**interpolations {{ expr }} are preserved**

{{ title }} → {{ title }} (the expression is passed through as-is; text nodes are emitted compactly on a single line)

```
before: <p>tapped {{ count }} times</p>
after:  <text class="proteus-p">tapped {{ count }} times</text>
```

> why: the Mini Program interpolation syntax is also {{expr}}, so no conversion is needed; text-only child nodes are compacted onto a single line to keep the output readable (decision #15)

### `annotation/line-note`

**PROTEUS_DEBUG source-line comments**

when annotateLines=true, a <!-- @line tag --> comment is injected before every WXML element so the output can be traced back to a source location

```
before: 第 26 行 <h1>{{ title }}</h1>
after:  <!-- @26 h1 -->
<text class="proteus-h1">{{ title }}</text>
```

> why: anti-black-box mechanism (#17): off by default, turned on by npm run debug:mp — whoever gets the output (AI/human) can locate the source line

### `template/scope-attr`

**scoped CSS: user class and scopeId merged into one class (★2026-08 real-device refactor: class-name suffix)**

when <style scoped> is present, every class-value token on a template element gets -scopeId appended (.box → box-data-v-xxx); :class string literals and object keys are suffixed the same way (dynamic variable class names warn at compile time); the selector .box-data-v-xxx then matches on the style side

```
before: <div class="card">…</div>
after:  <view class="card-data-v-abc123">…</view>
```

> why: Mini Programs have no native scoped-CSS mechanism, so a compile-time class-name suffix is the equivalent (v0.3, decision #77); ★2026-08 real-device refactor: Skyline does not support attribute selectors/compound class selectors → the class is merged into a single unique single-class-selector path

### `component/root-class`

**component-tag class pass-through: root-class attribute → {{rootClass}} on the component root node (Vue class-inheritance semantics)**

the class of a custom component tag (a non-native base tag) — scope class + user class + :class binding — is merged and emitted as a single root-class attribute; {{rootClass}} is appended to the class of the component template root node; on the script side, the component is injected with a rootClass property (value: "")

```
before: <p-view class="box">…</p-view>
after:  <p-view root-class="data-v-abc123 box" />（组件根节点 class="… {{rootClass}}"）
```

> why: Vue class-inheritance semantics (the parent class applies to the child root node) has no native equivalent in WeChat — once the class is merged onto the component host node, page wxss cannot reliably apply (real-device test: the box style on the p-view outer container does not take effect, even with styleIsolation: apply-shared) — the compile-time equivalent: the class enters the component via the root-class attribute, the root node binds {{rootClass}}, and together with apply-shared page styles reach the component root node

### `layout/auto-flex-row`

**inline scenarios automatically become flex row (Skyline has no inline layout)**

when the direct children of a container mix text with inline controls (switch/slider/icon/image/button/input/textarea/checkbox/radio/label/navigator/progress) → the proteus-flex-row class is appended automatically (display:flex;row;align-items:center); BASE injects the matching rule

```
before: <view><switch/><text>开关</text></view>
after:  <view class="proteus-flex-row"><switch/><text>开关</text></view>
```

> why: the Skyline engine does not support inline layout (officially Inline is under development) — text is block by nature and takes a full line, so the only way to arrange items inline (text + switch on one line) is flex row (verified by users); the automatic detection saves developers from manually wrapping in flex (consistent on both ends)

### `component/progress-degrade`

**progress downgrades to a custom view progress bar (Skyline officially does not support progress)**

the native Mini Program <progress> element is compiled into a custom view structure (three nodes: track/inner/info) — percent → width, active-color/color → fill color, stroke-width → height, show-info (no value means true) → the percentage text; static attributes are emitted directly and bindings become interpolations; BASE injects the .proteus-progress styles

```
before: <progress :percent="70" show-info />
after:  <view class="proteus-progress"><view class="proteus-progress-track"><view class="proteus-progress-inner" style="width:{{70}}%;background-color:#07c160"></view></view><text wx:if="{{true}}" class="proteus-progress-info">{{70}}%</text></view>
```

> why: progress is not currently on the Skyline component-support list (real-device tests show it does not render) — the downgraded custom structure keeps both ends consistent and is usable on Skyline (16-progress-skyline-degrade)

## Script transforms (23)

### `script/const-to-data`

**Top-level const (ref/reactive/literal) → data**

Zero-indent top-level const → data field; ref(0)/reactive({...})/literals are statically evaluated at build time, and multiline array/object literals are fully extracted

```
before: const count = ref(0)
const cards = ref([{ title: "a" }])
after:  data: {
  count: 0,
  cards: [{ "title": "a" }],
}
```

> why: Mini program page state lives in data; reactive declarations (ref/reactive) are evaluated to their initial values at compile time (decision #60: parenthesis-balanced scanning supports multiline literals; only zero-indent top-level const is extracted, so local consts inside function bodies are not picked up)

### `script/computed-to-data`

**computed read path → derived data field (v0.3)**

Top-level const x = computed(() => expr) → not stored in data: initialized in onLoad and recomputed synchronously when a dependency ref is written to setData (x.value within expr → this.data.x)

```
before: const double = computed(() => count.value * 2)
after:  data 不含 double；this.setData({ count: ..., double: this.data.count * 2 })（count 写入时合并，onLoad 初始化一次）
```

> why: Mini programs have no computed concept, so the compiler turns the getter into a data derivation: the ref dependencies in the getter are statically extracted, and when a dependency is written the recompute expression is merged into the same setData (v0.3 implements the read path first; watch/write paths come later)

### `script/watch-to-methods`

**watch → proteusWatchX method (v0.3)**

watch(ref, (newVal, oldVal) => { body }) → generates proteusWatchX in methods; automatically invoked after the dependency ref is written to setData (the old value is saved before the write); immediate: true → invoked once during onLoad initialization

```
before: watch(count, (n, o) => {
  log(n, o)
})
after:  proteusWatchCount(n, o) {
  log(n, o)
},
// count 写入：const oldCount = this.data.count; ...setData(...); this.proteusWatchCount(this.data.count, oldCount)
```

> why: Mini programs have no watch concept, so the compiler simulates it: static dependency extraction (single ref) + write-point linkage (the callback runs after setData, with newVal/oldVal saved by the compiler); MVP: direct single-ref references + arrow-function callbacks only (array sources/function sources/function callbacks warn)

### `script/watch-props`

**watch props source → WeChat observers (component property listening)**

watch(props.x, (n, o) => { body }) or watch(() => props.x, ...) → Component observers: { x(n, o) { body } } (a property change triggers the callback; on the Web it is a standard Vue watch, fully reactive); immediate: true → additionally generates a proteusWatchPropX method invoked once during attached initialization

```
before: watch(() => props.items, () => {
  calc()
})
after:  observers: {
  items(n, o) {
    calc()
  },
}
```

> why: Components must react to their own property changes (list items pagination/load-more, overlay visible v-model, form value sync, etc.); mini programs have no reactive system, so observers are the only channel for property changes

### `script/module-import`

**Cross-module reference: import → require conversion (module-plan B0) / stripping warning**

Top-level setup imports: relative-path shared modules (matched by moduleImports) are hoisted to the top of the output as `const { x } = require(...)` with the compiled relative module path appended (named/default/namespace/side, four forms); vue/@proteus-vue/*/type/.vue are skipped (compiler-static/usingComponents/pure types); unresolvable paths are stripped with a warning

```
before: import { formatTime } from "../utils/format"
after:  const { formatTime } = require("../utils/format.js")（moduleImports 命中）；未收录路径 → 警告 + 剥离
```

> why: Anti-black-box (vue-compat Batch A, decision #116): import stripping is no longer silent, and undefined references in the output are explicitly flagged; ★module-plan B0: relative-path shared modules are compiled into standalone outputs with require conversion, making cross-module references actually usable (the foundation for the later Pinia/API/Component infrastructure)

### `script/runtime-init`

**Function-call initialization → runtime-initialized instance property (module-plan B0)**

Top-level const x = fn() (static evaluation failed) → data does not contain the field; onLoad/attached injects this.x = fn() (instance property, ES5-safe); template binding is unsupported (reading this.data.x is undefined) — use module import for shared logic

```
before: const store = usePlayerStore()
after:  onLoad: this.store = usePlayerStore()（data 不含 store）
```

> why: Old behavior: when static evaluation of a function-call initializer failed, data.x became undefined and the call was silently dropped; with cross-module require, B0 makes useStore()/createX() actually execute

### `script/store-binding`

**Pinia store template binding (pinia-plan 12 P1: $subscribe → setData sync)**

Template {{ store.<field> }} references (storeBindings collected in template) → onLoad injection: initial setData({ field: this.store.field }) + store.$subscribe subscription (changes → setData, template fields sync in real time); the store variable is the runtimeInit instance property of useXxxStore(); nested store.current.title → current.title (store prefix stripped)

```
before: {{ store.current.title }}
after:  {{ current.title }} + onLoad: this.store.$subscribe(() => this.setData({ current: this.store.current }))
```

> why: MP template bindings read this.data, and a store instance property is unreachable from there; Pinia $subscribe subscription + setData sync (aligned with the connectPageStore store-bridge pattern) makes state display work on the pinia-demo MP side (pinia-plan 12)

### `script/define-props`

**defineProps → Component properties (v0.3 component system + v0.3 trailing generics)**

Component mode: defineProps({ label: String, initial: { type: Number, default: 0 } }) or TS-generic defineProps<{ label: string; count?: number }>() → properties (type + default value); props.xxx accesses are rewritten to this.data.xxx

```
before: const props = defineProps<{ initial: number; label: string }>()
after:  properties: {
  initial: { type: Number, value: 0 },
  label: { type: String, value: "" },
}
```

> why: Mini program components declare external properties with Component({ properties }); Vue component props are mapped at compile time (v0.3, decision #79); object form (type/default) + TS generic form (string/number/boolean/object/Array/union mapping)

### `script/define-emits`

**defineEmits + emit() → triggerEvent (v0.3 component system)**

Component mode: emit("xxx", payload) → this.triggerEvent("xxx", payload); parent @xxx (not in EVENT_MAP) → bind:xxx

```
before: emit('change', count.value)
after:  this.triggerEvent('change', this.data.count)
```

> why: Mini program components use triggerEvent to communicate with the parent; Vue emit is mapped at compile time (v0.3, decision #79); MVP: the emit variable name follows a convention

### `script/define-expose`

**defineExpose → no-op + validation (v0.3 wrap-up)**

Component mode: defineExpose({ ... }) is a compile-time no-op — mini program component methods are natively accessible via selectComponent; declared members are validated: exposing a ref value has no equivalent mechanism → warning

```
before: defineExpose({ reset })
after:  no-op（reset 已在 methods，外部 selectComponent 可调）
```

> why: External access to mini program components (selectComponent + method calls) natively covers the method-exposure semantics of Vue defineExpose; exposing a ref value would require method wrapping (v0.3 wrap-up, decision #91)

### `script/function-to-methods`

**Top-level function declarations → methods**

Top-level function handleTap() {...} → object shorthand handleTap() {...} in methods

```
before: function handleTap() {
  count.value++
}
after:  handleTap() {
  this.setData({ count: (this.data.count === undefined || this.data.count === null ? 0 : this.data.count) + 1 })
},
```

> why: Mini program page logic lives in methods; bare function declarations cannot be emitted inside an object literal (decision #14: output methods use object shorthand)

### `script/arrow-to-methods`

**Const arrow functions → methods**

const fn = (params) => {...} → fn(params) {...} in methods (async supported)

```
before: const load = async () => {
  const r = await fetchData()
}
after:  load() {
  const r = await fetchData()
},
```

> why: Mini program page logic lives in methods; const arrow functions are extracted as methods the same way

### `script/lifecycle-map`

**Lifecycle mapping: onMounted → onReady / onUnmounted → onUnload**

onMounted(() => {...}) → onReady() {...}; onUnmounted → onUnload; onLoad is passed through

```
before: onMounted(() => { doInit() })
after:  onReady() {
  doInit()
},
```

> why: Vue component lifecycles and mini program page lifecycles have different names, so the compiler maps them onto mini program hooks

### `script/ref-read`

**In-method ref reads → this.data.name**

name.value reads in method/lifecycle hook bodies → this.data.name

```
before: const v = count.value
after:  const v = this.data.count
```

> why: Mini program runtime state lives in this.data, so the compiler rewrites setup ref accesses into data accesses (decision #22)

### `script/ref-write`

**In-method ref assignment → this.setData**

name.value = expr in method/lifecycle hook bodies → this.setData({ name: expr })

```
before: count.value = count.value + 1
after:  this.setData({ count: this.data.count + 1 })
```

> why: setData is the only channel for updating the view in mini programs, so the compiler rewrites assignments into setData calls (decision #22; ==/===/compound assignments are excluded)

### `script/ref-incdec`

**In-method ref increment/decrement → this.setData**

name.value++ / -- / ++name.value → this.setData({ name: (null check ? 0 : this.data.name) + 1 })

```
before: count.value++
after:  this.setData({ count: (this.data.count === undefined || this.data.count === null ? 0 : this.data.count) + 1 })
```

> why: Increment/decrement leaves no expression to extract, so the compiler emits an explicit setData with a null fallback (decision #22; the ?? operator is avoided — real-device preview throws SyntaxError, decision #36)

### `script/vmodel-handler`

**Automatic v-model handler injection**

When v-model="x" appears in the template, inject proteusOnXInput(e) { this.setData({ x: e.detail.value }) }

```
before: （模板）<input v-model="name" />
after:  proteusOnNameInput(e) { this.setData({ name: e.detail.value }) },
```

> why: Mini programs have no v-model; the auto-generated handler covers the write-back direction (decision #29: method names avoid the __ prefix, since WeChat reserves the _ prefix and bindings may break)

### `script/nav-handler`

**Navigation-link auto handler injection (proteusNavigateTo)**

When a navigation link appears in the template, inject proteusNavigateTo(e): read data-url → wx.navigateTo (routeType is passed through; fail falls back to a normal navigation)

```
before: （模板）<a href="/pages/user/index">用户</a>
after:  proteusNavigateTo(e) {
  const ds = e.currentTarget.dataset
  const url = String(ds.url || "")
  if (!url) return
  const nav = { url: url, fail: ... }
  if (ds.routeType) nav.routeType = ds.routeType
  wx.navigateTo(nav)
},
```

> why: Mini program navigation uniformly goes through wx.navigateTo; a leading / is kept as an absolute path (decision #30, real-device root cause); the fail fallback keeps navigation working when a custom route fails (#28); method names avoid the __ prefix (#29)

### `page/scroll-bridge`

**Page scroll API bridging (15-page-scroll-container: Skyline pages do not scroll; page hooks fire through scroll-view events)**

When the page declares onPageScroll/onReachBottom/onPullDownRefresh: automatically wrap scroll-view to bind the corresponding events (template side) and generate a bridge method (payload normalization: scroll-view e.detail.scrollTop → onPageScroll { scrollTop }); manual scroll-view scenarios raise a compile-time ambiguity warning

```
before: function onPageScroll(e) { … }
after:  自动包装 scroll-view bindscroll="proteusPageScroll" + proteusPageScroll(e) 载荷归一调用 onPageScroll
```

> why: Skyline pages themselves do not scroll (scrolling requires scroll-view), so page-level scroll hooks would never fire; after bridging, the semantics of onPageScroll/onReachBottom/onPullDownRefresh are preserved (consistent with the Web side)

### `script/onload-params`

**Automatic decoding of default onLoad parameters**

With no explicit onLoad, inject the default implementation: iterate options → decodeURIComponent → JSON.parse structured values (starting with {/[) → setData

```
before: （无 onLoad）
after:  onLoad(options) {
  const params = {}
  const keys = Object.keys(options || {})
  for (let i = 0; i < keys.length; i++) {
    ...
  }
  this.setData(params)
},
```

> why: Route params are passed through the query string, so the page must restore their original types (decision #19: JSON.parse only for structured values; plain scalars stay strings — aligned with the P3 contract options.id === "1")

### `script/component-mode`

**Component mode → Component() constructor**

isComponent=true (under the components/ directory) → Component({ data, methods, ... }); a page → Page({ ... })

```
before: （组件 SFC）
after:  Component({ data: {...}, ... })
```

> why: Mini program pages use Page() and components use Component() (different constructor shapes; the isComponent branch is already passed through in compiler/index.ts)

### `script/es5-safe`

**Generated code is ES5-safe**

Generated output avoids ?? / ?. / array destructuring / object spread (explicit null-check ternaries, index loops over Object.keys, direct property assignment)

```
before: // 禁止出现在产物中
const [a, b] = arr
const v = x ?? 0
after:  // 产物实际形态
const a = arr[0], b = arr[1]
const v = (x === undefined || x === null ? 0 : x)
```

> why: When WeChat DevTools transpiles page JS to ES5 it depends on babel helper modules, and a helper missing from the package causes an error (#32: arrayWithHoles is undefined); real-device preview reports a direct ?? syntax error (#36)

### `script/provide-inject`

**provide/inject → getApp().__proteusProvides global registry bridge (vue-compat-advance Batch 3/4)**

Top-level provide("key", expr) / const x = inject("key"[, default]) compile to registry reads and writes: pages use a single merged onLoad block (pageId namespace resolved once + provide registration + inject setData); component provide goes into created (before child components attach-inject), inject into attached; provide value expressions rewrite bare ref names / ref.value → this.data.<name>; inject supports default values (the default applies when undefined); ★Batch 4 reactive linkage: providing a bare ref (provide("key", refName)) → proteusSyncProvide is injected at ref write points (syncs the registry value + notifies subscribers), and the inject side subscribes to __subs[key] (setData refresh on value change) with cancellation on detached/onUnload; ★Batch 6 page-level isolation: the registry is namespaced per pageId (pages generate __seq in onLoad + components resolve via the top of the getCurrentPages stack; onUnload deletes the namespace to prevent leaks); providing .value/literals keeps a static snapshot (aligned with Vue semantics: passing a ref links it, passing a value snapshots it)

```
before: provide("user", userInfo)
const theme = inject("theme", "light")
after:  onLoad: const provides = (getApp().__proteusProvides || (getApp().__proteusProvides = {})); provides["user"] = this.data.userInfo; if (!provides.__subs) provides.__subs = {}; ...; this.setData({ theme: (provides["theme"] === undefined ? "light" : provides["theme"]) })；userInfo 写入点追加 this.proteusSyncProvide("user", "userInfo")（通知订阅者 setData 刷新）
```

> why: The mini program component tree has no provide/inject mechanism (decision #117): the global registry bridge lets a page pass values down to components (including deeply nested ones); MVP is value snapshots (no reactive linkage) + a global registry (duplicate keys are overwritten by the later write); page-level isolation/reactive linkage come later

## Style transforms (8)

### `style/px-to-rpx`

**px → rpx (MP-side only, compile-time)**

CSS numeric px → rpx (rpxRatio defaults to 2: 48px → 96rpx); never converted on the Web side (handled natively by Vite)

```
before: padding: 48px;
after:  padding: 96rpx;
```

> why: Mini Program rpx is a screen-proportional unit (750 design draft); this is a compile-time absorption for cross-end CSS consistency (decision #9: px→rpx on the MP side while the Web side keeps standard CSS)

### `style/selector-tag`

**Selector HTML tags → Mini Program tags**

Tag names in selectors are rewritten to Mini Program tags (.links a → .links view, div > p → view > .proteus-p); attribute selectors/class names/IDs/long identifiers are never touched (no false positives)

```
before: .links a { color: #1a7af8; }
after:  .links .proteus-a { color: #1a7af8; }
```

> why: The template already maps div/a/h1 etc. to view/text; if the style selectors were not rewritten, they would not match any element (a bug fixed by decision #57); match condition = the tag sits at the start of the selector or right after a combinator, avoiding false hits on .a/#input/tag-a

### `style/selector-semantic`

**Semantic tag selectors → proteus-* class selectors**

h1-h6/p/a selectors are mapped to base class selectors (.card h3 → .card .proteus-h3, .links a → .links .proteus-a) instead of tags

```
before: .card h3 { font-weight: 700; }
after:  .card .proteus-h3 { font-weight: 700; }
```

> why: Both h3 and p map to text; mapping both to tags would let later rules of equal specificity override earlier ones (decision #61 fix: .card p's color once leaked into h3); the template side already appends proteus-* classes, so matching is exact

### `style/semantic-base-wxss`

**Inject semantic base WXSS (h1-h6/p/a visual restoration)**

Injects .proteus-h1~h6/.proteus-p/.proteus-a base styles at the head of the output WXSS (aligned with HTML standard Appendix D: font-size/font-weight/one-sided em paragraph spacing/link color), before user styles

```
before: // 源码无样式时产物仍含
after:  .proteus-h1 { display: block; font-size: 64rpx; font-weight: 700; margin: 0 0 0.67em; }
.proteus-p { display: block; margin: 0 0 1em; }
.proteus-a { color: #1a7af8; text-decoration: underline; }
```

> why: Web browsers have UA default styles while Mini Program text/view do not; injecting base classes restores visual parity between the two sides (decision #58); margins use a one-sided bottom + em relative to the element's own font-size — the self-developed Skyline engine does not collapse margins, so one-sided em and Web collapsing are visually consistent under the main-flow combination (decision #59)

### `style/default-scoped`

**Scoped by default: <style> without a marker is treated as local scope (★2026-08 user decision)**

Style blocks other than <style global> are treated as scoped (class-name suffix concatenation); a compile-time warning fires when <style> carries neither a scoped nor a global marker; <style global> (a Proteus extension) is explicitly global (scoped isolation is off); scoped + global blocks in the same file are emitted as groups (global first)

```
before: <style>.box { color: red; }</style>
after:  按 scoped 处理（.box-data-v-x）+ 警告提示全局出口 <style global>
```

> why: Vue standard <style> is global, leaking to every page on the Web side (real-device test: config-demo's unscoped gray background bled into the built-in component demo page); the user decision makes local the safer default (cross-end consistent: the Web-side Vite plugin rewrites <style> → <style scoped> in sync)

### `style/skyline-unsupported`

**Compile-time warning for Skyline-unsupported properties**

Emits a compile-time warning when float or position: fixed appears (does not block the build)

```
before: .banner { position: fixed; }
after:  警告：WXSS 检测到 Skyline 不支持的属性：position: fixed（编译期警告）
```

> why: The self-developed Skyline rendering engine does not support these layout properties; a compile-time warning lets developers know in advance (anti-black-box principle: warnings are visible and countable)

### `style/scoped-css`

**scoped CSS: selector class-name suffixing (★2026-08 real-device refactor: single-class selectors)**

When <style scoped> is present: every class token in a selector gets -scopeId appended (.box → .box-data-v-xxx, a single class selector); :deep(X) is unwrapped then suffixed uniformly; @keyframes frames/pseudo-classes, pseudo-elements, and @rules are left untouched; comma-separated lists are handled item by item

```
before: .card { color: red; }
after:  .card-data-v-abc123 { color: red; }
```

> why: Mini Program has no native scoped-CSS mechanism, so compile-time class-name suffixing is the equivalent (v0.3, decision #77); ★2026-08 real-device refactor: Skyline glass-easel does not support attribute selectors [data-v] (commit f48460c switched to compound class selectors but they still did not match — .a.b compound selectors were silently dropped, so even a component's own wxss failed to match its own root node) → class-name suffixing is the only path Skyline is confirmed to support (single-class selector ✓)

### `transition/animation-wxss`

**<transition> enter-animation keyframes injection**

Injects proteus-transition-* enter animations at the tail of the wxss (fade/slide-up/scale keyframes) — matching the transition decoration classes on the template side

```
before: <transition name="fade">…
after:  wxss 含 .proteus-transition-fade + @keyframes proteus-fade-in
```

> why: vue-compat-advance Batch 2 (decision #117): runtime equivalence of <transition> enter animations (the animation auto-plays when the element is rebuilt via wx:if); leave animations have no hook on the MP side

## Output validation (3)

### `validate/js-syntax`

**JS output syntax self-check**

new Function(js) is parsed only and never executed; a syntax error → validation fails and carries the error message

```
before: // 若产物 js 含语法错误
after:  CompilerError: [proteus-compiler] xxx.vue: js 产物语法错误：Unexpected token ...
```

> why: Anti-black-box mechanism (decision #17): broken output errors out on the spot and names the file; it never silently emits unusable output (unlike uni-app, whose artifacts make problems impossible to locate)

### `validate/wxml-pairing`

**WXML tag pairing self-check**

Stack-based scan of WXML tag pairing (comments are stripped first to keep line-number comments from interfering); unclosed/mismatched tags → validation fails

```
before: // 若产物 wxml 标签不配对
after:  CompilerError: [proteus-compiler] xxx.vue: wxml 产物结构错误：</view> 与 <text> 不匹配（位置 N）
```

> why: Anti-black-box mechanism (decision #17): a common way template conversion breaks is unpaired tags; catching it at compile time is easier to locate than a real-device runtime error

### `validate/compiler-error`

**Broken output throws CompilerError naming the file**

Validation failure → throws CompilerError (carrying the source file name; the message includes the [proteus-compiler] prefix)

```
before: // 静默输出坏产物（反模式）
after:  throw new CompilerError(filename, message)
```

> why: Anti-black-box unified error channel: once AI/developers receive the error they can locate the exact file (error = actionable feedback, not a black-box failure)

<!-- generated by website/scripts/gen-reference.mjs (en overlay) · source SSOT: packages/compiler/src/transforms/registry.ts TRANSFORM_RULES -->