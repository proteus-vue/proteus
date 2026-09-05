---
title: 编译规则目录
order: 41
group: 工程命令
generated: true
---

# 编译规则目录

> 76 条编译规则——每条自带 AI 说明书（id / when / before → after / why）。SSOT = `@proteus-vue/compiler` TRANSFORM_RULES，与 `npx proteus rules` / Playground Trace 同源。

## 模板转换（42）

### `tag/div-to-view`

**div → view**

块级容器 div → view（小程序通用容器）

```
before: <div class="home">…</div>
after:  <view class="home">…</view>
```

> why: 小程序没有 div，view 是最通用容器标签；业务代码照写标准 HTML（§0.3 原则 1）

### `tag/inline-to-text`

**span → text**

行内文本 span → text（小程序最小文本节点）

```
before: <span>hi</span>
after:  <text>hi</text>
```

> why: 小程序无 span，text 是行内文本容器；text 默认不换行、可被 text 嵌套

### `tag/heading-to-text`

**h1–h6 → text**

标题 h1-h6 → text，并自动附加 proteus-h1~h6 基础类（见 semantic/base-class）

```
before: <h1>标题</h1>
after:  <text class="proteus-h1">标题</text>
```

> why: 小程序无标题标签；语义（大字号/加粗）由基础类还原（#58），视觉对齐 Web UA 样式

### `tag/para-to-text`

**p → text**

段落 p → text，并自动附加 proteus-p 基础类（段距对齐 Web）

```
before: <p>段落</p>
after:  <text class="proteus-p">段落</text>
```

> why: p 映射为 text 后无 UA 默认段距，基础类注入 margin: 0 0 1em 还原 Web 折叠间距（#59）

### `tag/link-to-view`

**a → view**

链接 a → view（带 href 时升级为导航链接，见 nav/navigate-link）

```
before: <a href="/pages/user/index">用户</a>
after:  <view class="proteus-a" data-url="/pages/user/index" bindtap="proteusNavigateTo">用户</view>
```

> why: 小程序无 a 标签；导航语义由 data-url + bindtap="proteusNavigateTo" 承担，样式语义由 proteus-a 基础类承担

### `tag/image`

**img → image**

图片 img → image；:src 绑定经 directive/v-bind 转为 src="{{url}}"

```
before: <img :src="url" />
after:  <image src="{{url}}" />
```

> why: 小程序图片标签是 image

### `tag/passthrough`

**同名标签保留**

button / input / textarea / video / canvas / scroll-view / slot 同名保留（小程序原生即有）

```
before: <button>go</button>
after:  <button>go</button>
```

> why: 这些标签在小程序原生存在，无需映射；input/textarea 同时是 v-model 的目标（directive/v-model）

### `tag/router-link`

**router-link → view**

Vue Router 的 router-link → view + 导航链接（to 属性 → data-url）

```
before: <router-link to="/pages/user/index">用户</router-link>
after:  <view data-url="/pages/user/index" bindtap="proteusNavigateTo">用户</view>
```

> why: 小程序无 Vue Router 组件；统一转导航链接（决策 #24：<a href> / <router-link> 同为导航入口）

### `tag/rich-text`

**v-html 容器 → rich-text**

带 v-html 的容器元素 → rich-text（nodes="{{expr}}"）

```
before: <div v-html="html"></div>
after:  <rich-text nodes="{{html}}" />
```

> why: 小程序无 innerHTML，富文本用 rich-text 组件渲染 HTML 节点

### `tag/unknown-kebab`

**未注册标签 kebab-case 原样输出**

TAG_MAP 未覆盖的标签按 kebab-case 原样输出（组件 / 自定义元素逃生舱）

```
before: <custom-comp foo="bar" />
after:  <custom-comp foo="bar" />
```

> why: 白名单映射 + 未知标签保守保留：标准 Vue 组件体系（原则 9）与原生组件逃生舱（痛点 #11 对策）依赖此通道

### `semantic/base-class`

**语义标签自动附加 proteus-* 基础类**

h1-h6/p/a 映射时自动附加 proteus-h1~h6 / proteus-p / proteus-a 类（与用户 class 合并、与 :class 插值拼接）

```
before: <h1 class="title">a</h1>
after:  <text class="proteus-h1 title">a</text>
```

> why: Web 端 h1-h6/p/a 有浏览器 UA 默认样式，小程序 text/view 没有；基础类 + 基础 WXSS（style/semantic-base-wxss）还原两端视觉一致（#58）

### `event/click-to-tap`

**@click → bindtap（EVENT_MAP 全表）**

标准事件 → 小程序事件：click→tap、input/change/submit/focus/blur/touch*/longpress/confirm 同名保留

```
before: <button @click="handleTap">go</button>
after:  <button bindtap="handleTap">go</button>
```

> why: 小程序无 click，点击事件是 tap；其余事件命名一致（EVENT_MAP 集中在 tags.ts 与样式侧共用）

### `event/modifier-catch`

**.stop / .prevent 修饰符 → catch 前缀**

@click.stop / @click.prevent → catchtap（阻止冒泡）；其余修饰符忽略

```
before: <a @click.stop="stopFn">s</a>
after:  <a catchtap="stopFn">s</a>
```

> why: 小程序无事件修饰符语法，catch* 事件天然阻止冒泡，等价 .stop 语义；.prevent 无对等机制，映射为 catch 兜底

### `event/modifier-self-once`

**.self / .once 修饰符 → 包装方法（v0.3 尾）**

@click.self="fn" → bindtap="proteusSelfFn"（e.target === e.currentTarget 才触发）；@click.once="fn" → bindtap="proteusOnceFn"（data 标记首次触发后不再触发）；仅对简单方法名 handler 包装

```
before: @click.self="handleTap" / @click.once="handleTap"
after:  bindtap="proteusSelfHandleTap" / bindtap="proteusOnceHandleTap"（包装方法生成于 Page methods）
```

> why: 小程序无 .self/.once 原生语义，编译期生成包装方法（script 侧）：self 用事件源判断、once 用 data 标记；键位修饰符（@keyup.enter）无对等键盘事件 → 编译期警告（input 请用 @confirm）

### `event/handler-simple-ref`

**事件处理器仅支持简单方法引用**

仅支持 handleTap / handleTap($event)；复杂表达式编译期警告并原样输出

```
before: @click="count > 0 ? go() : back()"
after:  编译期警告：不是简单方法引用，原样输出（产物需人工处理）
```

> why: MVP 收缩（原则 10）：小程序事件处理器必须是 Page methods 中的方法名，内联表达式无法静态编译

### `directive/v-if`

**v-if → wx:if**

v-if="show" → wx:if="{{show}}"

```
before: <p v-if="show">a</p>
after:  <p wx:if="{{show}}">a</p>
```

> why: 小程序条件渲染指令是 wx:if

### `directive/v-else-if`

**v-else-if → wx:elif**

v-else-if="cond" → wx:elif="{{cond}}"

```
before: <p v-else-if="b">c</p>
after:  <p wx:elif="{{b}}">c</p>
```

> why: 小程序条件链指令是 wx:elif

### `directive/v-else`

**v-else → wx:else**

v-else → wx:else（无值）

```
before: <p v-else>b</p>
after:  <p wx:else>b</p>
```

> why: 小程序条件链指令是 wx:else

### `directive/v-for`

**v-for → wx:for / wx:for-item / wx:for-index**

v-for="(item, idx) in list" → wx:for="{{list}}" + wx:for-item + wx:for-index（支持 in/of）

```
before: <div v-for="(item, idx) in list" :key="idx">{{ item }}</div>
after:  <view wx:for="{{list}}" wx:for-item="item" wx:for-index="idx" wx:key="idx">{{ item }}</view>
```

> why: 小程序循环指令是 wx:for，且需显式声明 item/index 变量名

### `directive/v-bind`

**普通 :prop 绑定 → prop="{{expr}}"**

:src / :href / 任意属性绑定 → 属性="{{表达式}}"，静态属性原样保留

```
before: <img :src="url" />
after:  <image src="{{url}}" />
```

> why: 小程序属性绑定语法是 {{expr}}；静态属性（如 placeholder="x"）直接透传

### `directive/v-bind-class`

**:class 绑定（对象/数组语法 → 三元拼接）**

:class="{ active: on }" → {{(on?'active ':'')}}；数组语法（v0.3）→ 逐项拼接（字符串/对象/简单变量/三元）

```
before: <p :class="[activeClass, { active: on }]">b</p>
after:  <text class="proteus-p {{((activeClass)?(activeClass)+' ':'')+(on?'active ':'')}}">b</text>
```

> why: 小程序无 class 对象/数组语法，编译期为三元表达式拼接；数组语法 v0.3 补齐（splitTopLevel 顶层逗号分割，跳过字符串/括号内逗号）

### `directive/v-bind-style`

**:style 绑定（对象语法 → prop:{{expr}} 拼接）**

:style="{ color: c }" → style="color:{{c}}"；属性名 camelCase → kebab-case

```
before: :style="{ backgroundColor: bg }"
after:  style="background-color:{{bg}}"
```

> why: 小程序 style 属性支持内联插值，逐属性编译可静态验证

### `directive/v-bind-key`

**:key → wx:key（仅简单标识符）**

:key="idx" → wx:key="idx"；非简单标识符编译期警告并忽略

```
before: :key="idx"
after:  wx:key="idx"
```

> why: 小程序列表复用标识是 wx:key，仅接受简单标识符

### `directive/v-model`

**v-model → value + bindinput 自动 handler**

input/textarea 的 v-model="x" → value="{{x}}" + bindinput="proteusOnXInput"（handler 由 script 阶段注入 setData）

```
before: <input v-model="name" />
after:  <input value="{{name}}" bindinput="proteusOnNameInput" />
```

> why: 小程序无 v-model 语法，需双向绑定的两半：value 绑定 + 输入事件回写（script/vmodel-handler）

### `directive/v-html`

**v-html → rich-text nodes**

v-html="html" → rich-text nodes="{{html}}"（容器标签映射为 rich-text）

```
before: <div v-html="html"></div>
after:  <rich-text nodes="{{html}}" />
```

> why: 小程序无 innerHTML，富文本用 rich-text 组件（原生能力兜底，痛点 #11 对策）

### `directive/v-show`

**v-show → hidden 属性**

v-show="show" → hidden="{{!show}}"（小程序 hidden 属性 = display:none，元素始终渲染）

```
before: <p v-show="show">a</p>
after:  <p hidden="{{!show}}">a</p>
```

> why: 小程序无 v-show 指令，hidden 属性语义对齐（display:none 切换）；元素保留在文档流中，与 v-if 的移除不同（v0.3 补齐，原为 MVP 限制）

### `directive/custom`

**自定义指令剥离（无对等警告）**

v-focus 等自定义指令在小程序无对等机制——编译期警告并剥离（逻辑不执行），不再静默

```
before: <input v-focus />
after:  <input /> + 警告（已剥离）
```

> why: 反黑盒（vue-compat Batch A，决策 #116）：平台无对等能力必须编译期显式警告

### `template/is-component`

**动态组件 <component :is> 无对等警告**

<component :is> 动态组件在小程序无对等机制——警告（产物为无效标签），建议 v-if/v-else 条件渲染

```
before: <component :is="which" />
after:  警告 + 原样输出（无效标签）
```

> why: 反黑盒（vue-compat Batch A，决策 #116）：不再静默输出无效产物

### `event/inline-expression`

**内联事件表达式 → 包装方法（vue-compat Batch B）**

@click="count++"（自增/自减）与 @click="fn(1)"（简单方法调用）→ 生成 proteusInlineXxx 包装方法（setData 更新 / this.fn(1)），产物可运行；复杂表达式仍警告

```
before: @click="count++"
after:  bindtap="proteusInlineIncCount" + 方法 setData({ count: this.data.count + 1 })
```

> why: Vue 常见写法支持（决策 #116 Batch B）：不再原样输出无效 bindtap；对齐 ref 重写（this.data.x ± 1，决策 #36）

### `slot/scoped-slot`

**作用域插槽警告（★Batch 7：MP/Skyline 平台限制确认 + 替代模式）**

<slot :item="x"> 作用域插槽在小程序无对等机制（父侧拿不到子数据）——★平台限制：微信无模板传参机制（webview 的 template import 无法动态选择多父模板，Skyline 不支持跨文件模板），uni-app/Taro MP 端同样不完整——编译期警告 + 替代模式：子组件 props 接收数据 + 自定义事件回调传数据（<MyList :items :item-tap>）

```
before: <slot :item="item" />
after:  <slot /> + 警告（替代：props 传子 + triggerEvent 事件回调）
```

> why: 反黑盒（vue-compat-advance Batch 1/7，决策 #117）：不再静默输出无效属性；运行时等价受 MP 平台能力限制（非待办，替代模式 props+事件已由组件系统完整支持）

### `transition/component`

**<transition> → 装饰式进入动画（子元素注入动画 class）**

<transition name="fade"> 装饰式处理：过渡标签不输出，子元素注入 class="proteus-transition-{name}"（进入动画由重建自动播放）；wxss 按 usesTransition 按需注入 keyframes（fade/slide-up/scale）

```
before: <transition name="fade"><view v-if="on">X</view></transition>
after:  <view class="proteus-transition-fade" wx:if="{{__tv0}}">X</view>
```

> why: Vue <transition> 运行时等价（vue-compat-advance Batch 2，决策 #117）：MP 无原生 Transition，编译注入动画 class + keyframes 补位；与路由 routeType 转场互补（元素级 vs 页面级）

### `transition/leave-state`

**<transition> 离开动画状态机（裸 ref v-if 延迟移除）**

transition 直接子元素 v-if 为裸 ref 名时启用离开动画：v-if 改写 wx:if="{{__tv{i}}}"（显示状态，初始 = ref 初始值）+ class 插值 {{__tl{i} ? "...-leave" : ""}}（离开中切换 leave 动画）；script 生成 proteusTransitionToggle{i}()（ref 写入点注入：on 变 false → __tl{i}=true 播离开动画 + setTimeout 时长后 __tv{i}=false 延迟移除；on 变 true → 取消定时器恢复进入动画）；wxss 按需注入 leave class + keyframes（forwards 保持末帧）

```
before: <transition name="fade"><view v-if="on">X</view></transition>
after:  <view wx:if="{{__tv0}}" class="proteus-transition-fade {{__tl0 ? 'proteus-transition-fade-leave' : ''}}">X</view> + data __tv0/__tl0 + proteusTransitionToggle0()
```

> why: Vue transition 离开语义：v-if 变 false 先播离开动画再移除（vue-compat-advance Batch 5）；MP wx:if 立即移除无动画——编译期状态机补位；仅裸 ref v-if 支持（复杂表达式保持 Batch 2 现状）

### `template/template-ref`

**模板 ref 无对等警告**

ref="el" 模板 ref 在小程序无对等绑定（永不赋值）——警告，建议 this.selectComponent("#id")

```
before: <input ref="el" />
after:  <input /> + 警告
```

> why: 反黑盒（vue-compat Batch A，决策 #116）：不再静默无效

### `template/no-peer`

**平台无对等组件警告（Transition/Teleport 等）**

transition/transition-group/teleport/suspense/keep-alive 在小程序无对等组件——警告（原样输出不生效）

```
before: <transition name="fade">…</transition>
after:  警告 + 原样输出
```

> why: 反黑盒（vue-compat Batch A，决策 #116）：转场请用路由 routeType，缓存/传送请移除

### `nav/navigate-link`

**<a href> / <router-link to> → 导航链接**

带 href/to 的导航链接 → data-url + data-route-type + bindtap="proteusNavigateTo"（handler 由 script/nav-handler 注入）

```
before: <a href="/pages/user/index">用户</a>
after:  <view class="proteus-a" data-url="/pages/user/index" bindtap="proteusNavigateTo">用户</view>
```

> why: Web 端 <a> 走浏览器导航，小程序端需转 data-url + 点击跳转（决策 #24）；保留前导 / 为绝对路径（#30 真机教训：无前导 / 会相对当前页目录解析导致双重前缀）

### `nav/route-type`

**导航链接 route-type 属性 → data-route-type**

<a route-type="halfScreen"> → data-route-type="halfScreen"（proteusNavigateTo 透传为 wx.navigateTo 的 routeType）

```
before: <a href="/pages/user/profile" route-type="halfScreen">资料</a>
after:  <view data-url="/pages/user/profile" data-route-type="halfScreen" bindtap="proteusNavigateTo">资料</view>
```

> why: Skyline 自定义路由转场从导航链接发起时，需把 routeType 传到运行期（决策 #44：routeType 双端同 API）

### `node/interpolation`

**插值 {{ expr }} 保留**

{{ title }} → {{ title }}（表达式原样透传，文本节点紧凑单行输出）

```
before: <p>tapped {{ count }} times</p>
after:  <text class="proteus-p">tapped {{ count }} times</text>
```

> why: 小程序插值语法同为 {{expr}}，无需转换；纯文本子节点紧凑单行保证产物可读（决策 #15）

### `annotation/line-note`

**PROTEUS_DEBUG 源码行号注释**

annotateLines=true 时 WXML 每个元素前注入 <!-- @行号 标签 -->，产物可反查源码位置

```
before: 第 26 行 <h1>{{ title }}</h1>
after:  <!-- @26 h1 -->
<text class="proteus-h1">{{ title }}</text>
```

> why: 反编译黑盒机制（#17）：默认关闭，npm run debug:mp 开启——AI/人拿到产物即可定位到源码行

### `template/scope-attr`

**scoped CSS：用户 class 与 scopeId 拼接为单一类（★2026-08 真机重构：类名后缀）**

<style scoped> 存在时，模板元素 class 值 token 追加 -scopeId（.box → box-data-v-xxx）；:class 字符串字面量/对象键同样后缀（动态变量类名编译期警告）；样式侧选择器 .box-data-v-xxx 匹配

```
before: <div class="card">…</div>
after:  <view class="card-data-v-abc123">…</view>
```

> why: 小程序无 scoped CSS 原生机制，编译期类名后缀等价（v0.3，决策 #77）；★2026-08 真机重构：Skyline 不支持属性选择器/复合类选择器 → 类名拼接为唯一单类选择器路径

### `component/root-class`

**组件标签 class 透传：root-class 属性 → 组件根节点 {{rootClass}}（Vue class 继承语义）**

自定义组件标签（非原生基础标签）的 class（scope class + 用户 class + :class 绑定）合并为单个 root-class 属性发射；组件模板根节点 class 追加 {{rootClass}}；script 侧组件注入 rootClass property（value: ""）

```
before: <p-view class="box">…</p-view>
after:  <p-view root-class="data-v-abc123 box" />（组件根节点 class="… {{rootClass}}"）
```

> why: Vue 的 class 继承语义（父组件 class 作用于子组件根节点）在微信无原生对等——组件 host 节点 class 合并后，页面 wxss 无法可靠作用（真机实测：p-view 外层容器 box 样式不生效，即使 styleIsolation: apply-shared）——编译期等价：class 经 root-class 属性传入组件，根节点绑定 {{rootClass}}，配合 apply-shared 让页面样式作用组件根节点

### `layout/auto-flex-row`

**行内场景自动 flex row（Skyline 无 inline 布局）**

容器直接子元素同时含 text 与行内控件（switch/slider/icon/image/button/input/textarea/checkbox/radio/label/navigator/progress）→ 自动附加 proteus-flex-row 类（display:flex;row;align-items:center）；BASE 注入对应规则

```
before: <view><switch/><text>开关</text></view>
after:  <view class="proteus-flex-row"><switch/><text>开关</text></view>
```

> why: Skyline 引擎不支持 inline 布局（官方 Inline × 开发中）——text 天生 block 占满一行，行内排布（text + switch 同行）唯一路径是 flex row（用户实测）；自动检测免开发者手动包 flex（双端一致）

### `component/progress-degrade`

**progress 降级自定义 view 进度条（Skyline 官方不支持 progress）**

小程序语义 <progress> 编译为自定义 view 结构（track/inner/info 三节点）——percent→宽度、active-color/color→填充色、stroke-width→高度、show-info（无值=真）→百分比文字；静态属性直出、绑定插值；BASE 注入 .proteus-progress 样式

```
before: <progress :percent="70" show-info />
after:  <view class="proteus-progress"><view class="proteus-progress-track"><view class="proteus-progress-inner" style="width:{{70}}%;background-color:#07c160"></view></view><text wx:if="{{true}}" class="proteus-progress-info">{{70}}%</text></view>
```

> why: Skyline 组件支持表 progress 暂不考虑（真机实测不渲染）——降级自定义结构双端一致 + Skyline 可用（16-progress-skyline-degrade）

## 脚本转换（23）

### `script/const-to-data`

**顶层 const（ref/reactive/字面量）→ data**

零缩进顶层 const → data 字段；ref(0)/reactive({...})/字面量在构建期静态求值，多行数组/对象字面量完整提取

```
before: const count = ref(0)
const cards = ref([{ title: "a" }])
after:  data: {
  count: 0,
  cards: [{ "title": "a" }],
}
```

> why: 小程序页面状态在 data 中，响应式声明（ref/reactive）编译期为初始值求值（决策 #60：括号平衡扫描支持多行字面量；只提取零缩进顶层 const，不误取函数体内局部 const）

### `script/computed-to-data`

**computed 读路径 → data 派生字段（v0.3）**

顶层 const x = computed(() => expr) → data 不存；onLoad 初始化 + 依赖 ref 写入 setData 时同步重算（expr 中 x.value → this.data.x）

```
before: const double = computed(() => count.value * 2)
after:  data 不含 double；this.setData({ count: ..., double: this.data.count * 2 })（count 写入时合并，onLoad 初始化一次）
```

> why: 小程序无 computed 概念，编译期把 getter 转 data 派生：静态提取 getter 中的 ref 依赖 → 依赖写入时把重算表达式合并进同一 setData（v0.3 先做读路径，watch/写路径后续）

### `script/watch-to-methods`

**watch → proteusWatchX 方法（v0.3）**

watch(ref, (newVal, oldVal) => { body }) → methods 生成 proteusWatchX；依赖 ref 写入 setData 后自动调用（旧值在写入前保存）；immediate: true → onLoad 初始化调用一次

```
before: watch(count, (n, o) => {
  log(n, o)
})
after:  proteusWatchCount(n, o) {
  log(n, o)
},
// count 写入：const oldCount = this.data.count; ...setData(...); this.proteusWatchCount(this.data.count, oldCount)
```

> why: 小程序无 watch 概念，编译期模拟：依赖静态提取（单 ref）+ 写入点联动（setData 后调用回调，newVal/oldVal 由编译期保存）；MVP：仅单 ref 直接引用 + 箭头函数回调（数组源/函数源/function 回调警告）

### `script/watch-props`

**watch props 源 → WeChat observers（组件属性监听）**

watch(props.x, (n, o) => { body }) 或 watch(() => props.x, ...) → Component observers: { x(n, o) { body } }（属性变化触发回调；Web 端即标准 Vue watch，全响应式）；immediate: true → 另生成 proteusWatchPropX 方法 + attached 初始化调用一次

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

> why: 组件需要响应自身属性变化（列表 items 分页/加载更多、弹层 visible v-model、表单 value 同步等）；小程序无响应式系统，属性变化唯一通道是 observers

### `script/module-import`

**跨模块引用：import → require 转换（module-plan B0）/ 剥离警告**

setup 顶层 import：相对路径共享模块（moduleImports 命中）→ 产物顶部 const { x } = require("<相对产物路径>.js")（named/default/namespace/side 四形态）；vue/@proteus-vue/*/type/.vue 跳过（编译器静态/usingComponents/纯类型）；无法解析的路径 → 剥离 + 警告

```
before: import { formatTime } from "../utils/format"
after:  const { formatTime } = require("../utils/format.js")（moduleImports 命中）；未收录路径 → 警告 + 剥离
```

> why: 反黑盒（vue-compat Batch A，决策 #116）：import 剥离不再静默，产物未定义引用显式提示；★module-plan B0：相对路径共享模块编译为独立产物 + require 转换，跨模块引用真正可用（后续 Pinia/API/Component 基建的地基）

### `script/runtime-init`

**函数调用初始化 → 运行时初始化实例属性（module-plan B0）**

顶层 const x = fn()（静态求值失败）→ data 不含该字段；onLoad/attached 注入 this.x = fn()（实例属性，ES5 安全）；模板绑定不支持（读 this.data.x undefined）——共享逻辑请用模块 import

```
before: const store = usePlayerStore()
after:  onLoad: this.store = usePlayerStore()（data 不含 store）
```

> why: 旧行为：函数调用初始化静态求值失败 → data.x = undefined 且调用丢失（静默坏）；B0 配合跨模块 require 让 useStore()/createX() 真实执行

### `script/store-binding`

**Pinia store 模板绑定（pinia-plan 12 P1：$subscribe → setData 同步）**

模板 {{ store.<field> }} 引用（template 收集 storeBindings）→ onLoad 注入：初始 setData({ field: this.store.field }) + store.$subscribe 订阅（变更 → setData，模板字段实时同步）；store 变量 = useXxxStore() 的 runtimeInit 实例属性；嵌套 store.current.title → current.title（store 前缀剥离）

```
before: {{ store.current.title }}
after:  {{ current.title }} + onLoad: this.store.$subscribe(() => this.setData({ current: this.store.current }))
```

> why: MP 模板绑定读 this.data——store 是实例属性读不到；Pinia $subscribe 订阅 + setData 同步（对齐 store 桥 connectPageStore 模式），让 pinia-demo MP 端状态显示可用（pinia-plan 12）

### `script/define-props`

**defineProps → Component properties（v0.3 组件系统 + v0.3 尾泛型）**

组件模式：defineProps({ label: String, initial: { type: Number, default: 0 } }) 或 TS 泛型 defineProps<{ label: string; count?: number }>() → properties（type + 默认值 value）；props.xxx 访问重写为 this.data.xxx

```
before: const props = defineProps<{ initial: number; label: string }>()
after:  properties: {
  initial: { type: Number, value: 0 },
  label: { type: String, value: "" },
}
```

> why: 小程序组件用 Component({ properties }) 声明外部属性；Vue 组件 props 编译期映射（v0.3，决策 #79）；对象形式（type/default）+ TS 泛型形式（string/number/boolean/object/Array/联合映射）

### `script/define-emits`

**defineEmits + emit() → triggerEvent（v0.3 组件系统）**

组件模式：emit("xxx", payload) → this.triggerEvent("xxx", payload)；父组件 @xxx（非 EVENT_MAP）→ bind:xxx

```
before: emit('change', count.value)
after:  this.triggerEvent('change', this.data.count)
```

> why: 小程序组件向父组件通信用 triggerEvent；Vue emit 编译期映射（v0.3，决策 #79）；MVP：约定 emit 变量名

### `script/define-expose`

**defineExpose → no-op + 校验（v0.3 尾）**

组件模式：defineExpose({ ... }) 编译期 no-op——小程序组件 methods 天然可被 selectComponent 访问；校验声明成员：ref 值暴露无对等机制 → 警告

```
before: defineExpose({ reset })
after:  no-op（reset 已在 methods，外部 selectComponent 可调）
```

> why: 小程序组件外部访问（selectComponent + 方法调用）天然覆盖 Vue 的 defineExpose 方法暴露语义；ref 值暴露需方法包装（v0.3 尾，决策 #91）

### `script/function-to-methods`

**顶层 function 声明 → methods**

顶层 function handleTap() {...} → methods 中的对象简写 handleTap() {...}

```
before: function handleTap() {
  count.value++
}
after:  handleTap() {
  this.setData({ count: (this.data.count === undefined || this.data.count === null ? 0 : this.data.count) + 1 })
},
```

> why: 小程序页面逻辑在 methods 中；对象字面量内不能输出裸 function 声明（决策 #14：产物方法用对象简写）

### `script/arrow-to-methods`

**const 箭头函数 → methods**

const fn = (params) => {...} → methods 中的 fn(params) {...}（支持 async）

```
before: const load = async () => {
  const r = await fetchData()
}
after:  load() {
  const r = await fetchData()
},
```

> why: 小程序页面逻辑在 methods 中；const 箭头函数同样提取为方法

### `script/lifecycle-map`

**生命周期映射 onMounted → onReady / onUnmounted → onUnload**

onMounted(() => {...}) → onReady() {...}；onUnmounted → onUnload；onLoad 透传

```
before: onMounted(() => { doInit() })
after:  onReady() {
  doInit()
},
```

> why: Vue 组件生命周期与小程序页面生命周期不同名，编译期映射到小程序钩子

### `script/ref-read`

**方法内 ref 读取 → this.data.name**

方法/生命周期体内的 name.value 读取 → this.data.name

```
before: const v = count.value
after:  const v = this.data.count
```

> why: 小程序运行期状态在 this.data 中，编译期把 setup ref 访问重写为 data 访问（决策 #22）

### `script/ref-write`

**方法内 ref 赋值 → this.setData**

方法/生命周期体内的 name.value = expr → this.setData({ name: expr })

```
before: count.value = count.value + 1
after:  this.setData({ count: this.data.count + 1 })
```

> why: 小程序更新视图的唯一通道是 setData，编译期把赋值重写为 setData 调用（决策 #22；排除 ==/===/复合赋值）

### `script/ref-incdec`

**方法内 ref 自增/自减 → this.setData**

name.value++ / -- / ++name.value → this.setData({ name: (null 检查 ? 0 : this.data.name) + 1 })

```
before: count.value++
after:  this.setData({ count: (this.data.count === undefined || this.data.count === null ? 0 : this.data.count) + 1 })
```

> why: 自增/自减无表达式可提取，编译期为显式 setData 并做 null 兜底（决策 #22；不用 ?? 运算符——真机预览报 SyntaxError，决策 #36）

### `script/vmodel-handler`

**v-model 自动 handler 注入**

模板出现 v-model="x" 时注入 proteusOnXInput(e) { this.setData({ x: e.detail.value }) }

```
before: （模板）<input v-model="name" />
after:  proteusOnNameInput(e) { this.setData({ name: e.detail.value }) },
```

> why: 小程序无 v-model，回写方向由自动 handler 承担（决策 #29：方法名避免 __ 前缀，微信保留 _ 前缀可能导致绑定失效）

### `script/nav-handler`

**导航链接自动 handler 注入（proteusNavigateTo）**

模板出现导航链接时注入 proteusNavigateTo(e)：读 data-url → wx.navigateTo（routeType 透传，fail 降级普通跳转）

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

> why: 小程序导航统一走 wx.navigateTo；保留前导 / 为绝对路径（决策 #30 真机根因）；fail 降级保证自定义路由失败仍可跳转（#28）；方法名避开 __ 前缀（#29）

### `page/scroll-bridge`

**页面滚动 API 桥接（15-page-scroll-container：Skyline 页面不滚动，页面钩子靠 scroll-view 事件触发）**

页面声明 onPageScroll/onReachBottom/onPullDownRefresh 时：自动包装 scroll-view 绑定对应事件（template 侧）+ 生成桥接方法（载荷归一：scroll-view e.detail.scrollTop → onPageScroll { scrollTop }）；手动 scroll-view 场景编译期歧义警告

```
before: function onPageScroll(e) { … }
after:  自动包装 scroll-view bindscroll="proteusPageScroll" + proteusPageScroll(e) 载荷归一调用 onPageScroll
```

> why: Skyline 页面本身不滚动（滚动必须 scroll-view）——页面级滚动钩子不会被触发；桥接后 onPageScroll/onReachBottom/onPullDownRefresh 语义保留（与 Web 端一致）

### `script/onload-params`

**默认 onLoad 参数自动 decode**

无显式 onLoad 时注入默认实现：遍历 options → decodeURIComponent → 结构化值（{/[ 开头）JSON.parse → setData

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

> why: 路由参数经 query 传递，页面需还原为原始类型（决策 #19：仅对结构化值 JSON.parse，普通标量保持字符串——对齐 P3 契约 options.id === "1"）

### `script/component-mode`

**组件模式 → Component() 构造器**

isComponent=true（components 目录下）→ Component({ data, methods, ... })，页面 → Page({ ... })

```
before: （组件 SFC）
after:  Component({ data: {...}, ... })
```

> why: 小程序页面用 Page()，组件用 Component()（不同构造器形态，isComponent 分支已在 compiler/index.ts 透传）

### `script/es5-safe`

**生成代码 ES5 安全**

产物规避 ?? / ?. / 数组解构 / 对象展开（显式 null 检查三元、索引循环 Object.keys、直接属性赋值）

```
before: // 禁止出现在产物中
const [a, b] = arr
const v = x ?? 0
after:  // 产物实际形态
const a = arr[0], b = arr[1]
const v = (x === undefined || x === null ? 0 : x)
```

> why: 微信开发者工具将页面 JS 转 ES5 时依赖 babel helper 模块，helper 不在包内会报错（#32：arrayWithHoles 未定义）；真机预览直接报 ?? 语法错误（#36）

### `script/provide-inject`

**provide/inject → getApp().__proteusProvides 全局注册表桥（vue-compat-advance Batch 3/4）**

顶层 provide("key", expr) / const x = inject("key"[, default]) 编译为注册表读写：页面 onLoad 单函数合并块（pageId 命名空间解析一次 + provide 注册 + inject setData）；组件 provide 放 created（先于子组件 attached 注入）、inject 放 attached；provide 值表达式重写裸 ref 名 / ref.value → this.data.<name>；inject 支持默认值（undefined 时取默认）；★Batch 4 响应式联动：裸 ref 提供（provide("key", refName)）→ ref 写入点注入 proteusSyncProvide（同步注册表值 + 通知订阅者），inject 侧订阅 __subs[key]（值变化 setData 刷新）+ detached/onUnload 取消；★Batch 6 页面级隔离：注册表按 pageId 命名空间（页面 onLoad __seq 生成 + 组件 getCurrentPages 栈顶解析，onUnload 删除命名空间防泄漏）；.value/字面量提供保持静态快照（对齐 Vue 语义：传 ref 联动、传值快照）

```
before: provide("user", userInfo)
const theme = inject("theme", "light")
after:  onLoad: const provides = (getApp().__proteusProvides || (getApp().__proteusProvides = {})); provides["user"] = this.data.userInfo; if (!provides.__subs) provides.__subs = {}; ...; this.setData({ theme: (provides["theme"] === undefined ? "light" : provides["theme"]) })；userInfo 写入点追加 this.proteusSyncProvide("user", "userInfo")（通知订阅者 setData 刷新）
```

> why: 小程序组件树无 provide/inject 机制（决策 #117）：全局注册表桥让页面向组件传值（含深层嵌套组件）；MVP 值快照（非响应式联动）+ 全局注册表（重名 key 后写覆盖），页面级隔离/响应式为后续

## 样式转换（8）

### `style/px-to-rpx`

**px → rpx（仅 MP 端编译期生效）**

CSS 数值 px → rpx（rpxRatio 默认 2：48px → 96rpx）；Web 端永不转换（Vite 原生处理）

```
before: padding: 48px;
after:  padding: 96rpx;
```

> why: 小程序 rpx 是屏幕等比单位（750 设计稿），跨端 CSS 一致性的编译期吸收（决策 #9：MP 端 px→rpx，Web 端保持标准 CSS）

### `style/selector-tag`

**选择器 HTML 标签 → 小程序标签**

选择器中的标签名重写为小程序标签（.links a → .links view、div > p → view > .proteus-p）；属性选择器/类名/ID/长标识符不误伤

```
before: .links a { color: #1a7af8; }
after:  .links .proteus-a { color: #1a7af8; }
```

> why: 模板已把 div/a/h1 等映射为 view/text，若样式选择器不重写则匹配不到元素（决策 #57 修复的 bug）；命中条件=标签位于选择器起始或组合器之后，避免 .a/#input/tag-a 误伤

### `style/selector-semantic`

**语义标签选择器 → proteus-* 类选择器**

h1-h6/p/a 选择器映射为基础类选择器（.card h3 → .card .proteus-h3、.links a → .links .proteus-a），而非标签

```
before: .card h3 { font-weight: 700; }
after:  .card .proteus-h3 { font-weight: 700; }
```

> why: h3 与 p 都映射为 text，若都映射为标签，同特异性规则后写覆盖先写（决策 #61 修复：.card p 的 color 曾污染 h3）；模板侧已附加 proteus-* 类故精确匹配

### `style/semantic-base-wxss`

**注入语义基础 WXSS（h1-h6/p/a 视觉还原）**

产物 WXSS 头部注入 .proteus-h1~h6/.proteus-p/.proteus-a 基础样式（对齐 HTML 标准附录 D：字号/字重/单边 em 段距/链接色），位于用户样式之前

```
before: // 源码无样式时产物仍含
after:  .proteus-h1 { display: block; font-size: 64rpx; font-weight: 700; margin: 0 0 0.67em; }
.proteus-p { display: block; margin: 0 0 1em; }
.proteus-a { color: #1a7af8; text-decoration: underline; }
```

> why: Web 浏览器有 UA 默认样式，小程序 text/view 没有；注入基础类还原两端视觉一致（决策 #58）；margin 用单边 bottom + em 相对自身字号——Skyline 自研引擎不折叠 margin，单边 em 与 Web 折叠在主流程组合下视觉一致（决策 #59）

### `style/default-scoped`

**默认 scoped：<style> 无标记按局部作用域处理（★2026-08 用户决策）**

非 <style global> 的 style 块均按 scoped 处理（类名后缀拼接）；<style> 无 scoped/global 标记时编译期警告；<style global>（Proteus 扩展）显式全局（不作用域化）；同文件 scoped+global 分组输出（global 在前）

```
before: <style>.box { color: red; }</style>
after:  按 scoped 处理（.box-data-v-x）+ 警告提示全局出口 <style global>
```

> why: Vue 标准 <style> 为全局——Web 端泄漏到所有页面（真机实测：config-demo 无 scoped 的灰色背景串到内置组件演示页）；用户决策默认局部更安全（跨端一致：Web 端 vite 插件同步改写 <style> → <style scoped>）

### `style/skyline-unsupported`

**Skyline 不支持属性编译期警告**

float、position: fixed 出现时编译期警告（不阻断构建）

```
before: .banner { position: fixed; }
after:  警告：WXSS 检测到 Skyline 不支持的属性：position: fixed（编译期警告）
```

> why: Skyline 自研渲染引擎不支持这些布局属性，编译期警告让开发者提前知道（反黑盒原则：警告可见、可统计）

### `style/scoped-css`

**scoped CSS：选择器类名后缀拼接（★2026-08 真机重构：单类选择器）**

<style scoped> 存在时：选择器内每个类 token 追加 -scopeId（.box → .box-data-v-xxx 单一类选择器）；:deep(X) 去包装后统一后缀；@keyframes 帧/伪类伪元素/@规则不处理；逗号列表逐条

```
before: .card { color: red; }
after:  .card-data-v-abc123 { color: red; }
```

> why: 小程序无 scoped CSS 原生机制，编译期类名后缀等价（v0.3，决策 #77）；★2026-08 真机重构：Skyline glass-easel 不支持属性选择器 [data-v]（f48460c 改 class 复合仍不匹配——.a.b 复合类选择器也静默丢弃，组件自身 wxss 匹配自身根节点都失效）→ 类名后缀是唯一 Skyline 确定支持的路径（单类选择器 ✓）

### `transition/animation-wxss`

**<transition> 进入动画 keyframes 注入**

wxss 尾部注入 proteus-transition-* 进入动画（fade/slide-up/scale keyframes）——配合模板侧 transition 装饰 class

```
before: <transition name="fade">…
after:  wxss 含 .proteus-transition-fade + @keyframes proteus-fade-in
```

> why: vue-compat-advance Batch 2（决策 #117）：<transition> 进入动画运行时等价（元素 wx:if 重建时 animation 自动播放）；离开动画 MP 无钩子

## 产物校验（3）

### `validate/js-syntax`

**JS 产物语法自校验**

new Function(js) 仅解析不执行，语法错误 → 校验失败并携带错误信息

```
before: // 若产物 js 含语法错误
after:  CompilerError: [proteus-compiler] xxx.vue: js 产物语法错误：Unexpected token ...
```

> why: 反编译黑盒机制（决策 #17）：坏产物当场报错指明文件，绝不静默输出不可用的产物（对比 uni-app 产物无法定位问题）

### `validate/wxml-pairing`

**WXML 标签配对自校验**

栈式扫描 WXML 标签配对（先剥离注释，避免行号注释干扰），未闭合/错配 → 校验失败

```
before: // 若产物 wxml 标签不配对
after:  CompilerError: [proteus-compiler] xxx.vue: wxml 产物结构错误：</view> 与 <text> 不匹配（位置 N）
```

> why: 反编译黑盒机制（决策 #17）：模板转换出错的常见形态就是标签不配对，编译期拦截比真机报错好定位

### `validate/compiler-error`

**坏产物抛 CompilerError 指明文件**

校验失败 → 抛 CompilerError（携带源文件名，消息含 [proteus-compiler] 前缀）

```
before: // 静默输出坏产物（反模式）
after:  throw new CompilerError(filename, message)
```

> why: 反黑盒机制的统一错误通道：AI/开发者拿到错误即可定位到具体文件（错误 = 可操作的反馈，而非黑盒失败）

<!-- generated by website/scripts/gen-reference.mjs · 源码 SSOT：packages/compiler/src/transforms/registry.ts TRANSFORM_RULES -->