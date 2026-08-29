# Vue 能力兼容进阶规划（vue-compat-advance）

> 版本：v1（2026-08）
> 背景：vue-compat Batch A/B/C 已修复反黑盒警告 + 事件内联 + :class 简写（决策 #116）；本节推进三大运行期能力
> 前置：docs/vue-compat-plan.md（Batch A/B/C ✅）；规则注册表 64 条
> 执行原则：每批独立提交、全绿后下一步；涉及 compiler + runtime + 框架组件，规则注册表同步登记

---

## 1. 现状与平台约束（实测确认）

| 能力 | 现状产物 | 问题 |
|------|----------|------|
| `<transition>` | 原样输出 + 警告（Batch A 已拦截） | 需运行时等价（进入/离开动画） |
| 作用域插槽 `<slot :item>` | `<slot item="{{item}}" />` 零警告 | **静默失败**（MP slot 不传数据给父，item 无效） |
| `provide/inject` | 零警告，调用被剥离 | **静默失败**（组件树跨层级注入无对等机制） |

**MP 平台约束**：
- 无 Transition 组件（无 enter/leave 钩子、无 transitionend 控制延迟移除）
- 插槽支持（`<slot>` 默认/具名）但**无作用域插槽**（父侧拿不到子数据）
- 组件树关系：微信 `relations`（祖先-后代 behavior 机制）可用作跨层级通道
- 页面（Page）与组件（Component）无统一 provide/inject 语义

---

## 2. 方案设计

### Batch 1：作用域插槽编译期警告 + 文档（★反黑盒，工程量小）

**问题**：`<slot :item="item" />` 静默输出无效属性（MP slot 不传数据）

**方案**：
- 编译检测 `<slot>` 上的绑定属性（`:item` / `:data` 等 v-bind 非 class/style）→ 警告：
  「作用域插槽 `<slot :item>` 小程序无对等机制（父侧拿不到子数据）——请改用 props 传子、自定义事件回调传数据（vue-compat-advance）」
- 规则登记 `slot/scoped-slot`
- 文档：docs/compiler.md 插槽章节补作用域插槽说明

**验收**：作用域插槽编译期显式警告（不再静默）；全量测试全绿

---

### Batch 2：Transition 装饰式进入动画（编译注入 + 按需 keyframes，工程量中）

**目标**：`<transition name="fade">` → 运行时等价（进入动画）

**实际实现**（2026-08）：
1. **编译映射**（template.ts）：`<transition>` 装饰式处理——子元素注入 `class="proteus-transition-{name}"`（name 缺省 fade），过渡标签本身不输出；`v-if` 保留（显隐 + 重建自动播放进入动画）；不再报 no-peer 警告（transition-group/teleport/suspense 保留警告）
2. **样式注入**（style.ts）：按需注入 `TRANSITION_WXSS`（`usesTransition` 标记 → 仅使用 transition 的页面注入，golden 不破坏）：`.proteus-transition-fade/slide-up/scale` + 对应 `@keyframes`（fade 0.25s ease / slide-up 0.32s cubic-bezier / scale 0.4s）
3. **规则**：`transition/component`（模板映射）+ `transition/animation-wxss`（样式注入）
4. **产物**：`<view class="proteus-transition-fade" wx:if="{{on}}">` + wxss 注入动画

**范围**：进入动画（挂载即播放）；**离开动画为遗留**（无 transitionend 控制延迟移除，后续补）

**验收**：`<transition name="fade"><view v-if="on">X</view></transition>` → 子元素动画 class + wxss keyframes；5 个 golden 不破坏（按需注入）

---

### Batch 3：provide/inject 页面级注入桥（全局注册表，运行时 + 编译，工程量中高）

**目标**：页面/组件 provide → 组件 inject（跨层级取值）

**实际实现**（2026-08）：
1. **运行时桥** `@proteus/runtime`（runtime/src/provide-inject.ts）：
   - `registerProvide(key, value)` / `readInject(key)`：统一挂在 `getApp().__proteusProvides` 全局注册表（与编译产物共享同一存储；非小程序环境回退 globalThis，测试可用）
   - `clearProvides()` / `provideCount()`：测试/诊断
2. **编译**（script.ts）：
   - `extractProvideInject`：零缩进顶层 `provide("key", expr)` / `const x = inject("key"[, default])` 提取（单行）
   - `buildProvideInject`：**页面 onLoad 单函数合并块**（registry 声明一次 + provide 注册 + inject setData）；**组件 provide 放 created**（先于子组件 attached 注入）、**inject 放 attached**（computed/immediate-watch 之后）
   - provide 值表达式重写：裸 ref 名 / `ref.value` → `this.data.<name>`（ref 编译为 data 字段）；inject 默认值编译为 ES5 三元（`provides[k] === undefined ? def : provides[k]`）
   - `extractData` 对 `const x = inject(...)` 跳过“跨模块引用”误导警告（合法用法，data 初始 undefined）
   - 产物**直接读写 getApp().__proteusProvides**（MP 单文件产物无模块系统，不 import 运行时）
3. **规则**：`script/provide-inject`（提供者注册 + 注入读取）
4. **边界**：
   - MVP 全局注册表（重名 key 后写覆盖）+ **值快照**（非响应式联动）；**页面级隔离（pageId）/ 响应式联动（ref 引用传递）为遗留**
   - provide 值支持字面量 / 裸 ref / ref.value；多行/函数体/嵌套调用不提取（单行顶层约束）
   - 组件 provide → 子组件 inject：created 先于子 attached，顺序正确

**验收**：页面 provide + 组件 inject 产物读写 getApp().__proteusProvides（onLoad/created+attached）；inject 默认值；无误导警告；运行时桥与产物共享注册表；单测 + demo 页（examples/pages/provide-inject-demo.vue）

---

## 3. 分批执行

| Batch | 内容 | 工程量 | 状态 |
|-------|------|--------|------|
| 1 | 作用域插槽警告 + 规则 + 文档 | 小 | ✅ |
| 2 | Transition 装饰式进入动画（编译注入 class + 按需 keyframes） | 中 | ✅ |
| 3 | provide/inject 页面级桥（全局注册表，运行时 + 编译） | 中高 | ✅ |
| 4 | provide/inject **响应式联动**（裸 ref 订阅/通知，复用 store 桥模式） | 中 | ✅ |
| 5 | Transition **离开动画**（状态机：__tvN 延迟移除 + __tlN 离开 class） | 中 | ✅ |
| 6 | provide/inject **页面级隔离**（pageId 命名空间 + onUnload 清理） | 中 | ✅ |
| 7 | 作用域插槽**平台限制确认**（警告增强 + 替代模式，运行时等价受 MP 能力天花板） | 小 | ✅ |

依赖：1 → 2 → 3 → 4 → 5 → 6（顺序按工程量递增，各自独立可测）

---

## 8. Batch 6：provide/inject 页面级隔离（pageId 命名空间）

**目标**：页面 A 的 provide 不再污染页面 B（当前全局注册表：A 提供 key，B 的组件 inject 读到 A 的值）

**设计**（页面命名空间，编译产物与运行时桥共用）：
1. **注册表结构升级**：`__proteusProvides = { [pageId]: { key: value, __subs: {...} }, __seq: n }`（pageId 为字符串，`__seq` 保留键避让）
2. **页面 onLoad**：`__seq` 递增生成 `this.__proteusPageId = 'p' + __seq` → `const provides = (__reg[pid] || (__reg[pid] = {}))`（提供/注入/订阅都在这层）
3. **组件 created/attached**：`getCurrentPages()` 栈顶页面的 `__proteusPageId`（组件 attached 期间栈顶 = 所属页面）→ 组件 provide/inject 也落在当前页命名空间（跨页隔离）；栈顶无 pid → 回退 `global` 命名空间（手写运行时路径）
4. **辅助方法**：`proteusSyncProvide` / `proteusUnsubscribeProvide` 内按 `this.__proteusPageId`（created/onLoad 已存实例）定位命名空间
5. **onUnload 清理**：`delete __reg[this.__proteusPageId]`（页面销毁防泄漏，与订阅取消同处注入）
6. **运行时桥**：`registerProvide/readInject/subscribeProvide/notifyProvide` 加可选 `pageId` 参数（缺省从 getCurrentPages 栈顶推导，无则 'global'）；新增 `nextPageId()`（__seq 递增，编译产物 onLoad 用）；`clearProvides/provideCount` 遍历全部命名空间

**验收**：页面 A/B 各自命名空间（A 提供 key，B 组件 inject undefined）；onUnload 清理后注册表无残留；组件 provide/inject 落当前页；全量测试全绿 + 双端构建

---

## 9. Batch 7：作用域插槽平台限制确认（收尾）

**目标**：确认作用域插槽运行时等价在 MP 的可达边界，提供完整替代路径，关闭遗留

**平台调研结论**（2026-08）：
1. **微信 webview 渲染**：`<template is>` 动态引用需静态 `<import>`；组件无法动态选择多父模板（List 被 pageA/pageB 用不同插槽内容 → import 冲突）；插槽内容引用父组件 data 时子侧无访问通道
2. **Skyline（当前主渲染引擎，proteus.config skyline: true）**：不支持跨文件模板引用
3. **行业对照**：uni-app / Taro 3 在 MP 端作用域插槽同样不完整（各自渲染器/编译期降级）

**结论**：作用域插槽**运行时等价在 MP 无通用解**（模板内容跨文件 + 多父冲突 + 变量引用受限 + Skyline 天花板）——维持 Batch 1 编译期警告，**替代模式 props 传子 + triggerEvent 事件回调已由组件系统（v0.3）完整支持**

**落地**：
1. 警告增强（template.ts）：补「MP/Skyline 平台限制」定性 + 替代模式具体写法（`<MyList :items @item-tap />` + triggerEvent 回传）
2. 规则 slot/scoped-slot 说明书更新（平台限制 + 替代模式）
3. 测试断言更新（平台限制/triggerEvent）

**验收**：警告 actionable（平台限制 + 替代写法）；vue-compat-advance 遗留清单关闭作用域插槽项；全量测试全绿

---

**已落地**（2026-08）：
1. **注册表结构升级**（runtime/provide-inject.ts）：`__proteusProvides = { [pageId]: { key: value, __subs: {...} }, __seq: n }`；`nextPageId()`（__seq 递增）/ `destroyPage(pageId)` 新增；registerProvide/readInject/subscribeProvide/notifyProvide 加可选 pageId（缺省从 getCurrentPages 栈顶 `__proteusPageId` 推导，无则 'global'）；provideCount 遍历全部命名空间
2. **编译**（script.ts）：
   - 页面 onLoad 打开段：`__reg.__seq = (__reg.__seq || 0) + 1` → `this.__proteusPageId = 'p' + __reg.__seq` → `const provides = (__reg[pid] || (__reg[pid] = {}))`
   - 组件 created/attached 打开段：`getCurrentPages()` 栈顶页面 `__proteusPageId`（组件渲染期间栈顶 = 所属页面）→ `this.__proteusPageId = __pid || 'global'` → 同命名空间（跨页隔离）
   - `proteusSyncProvide` / `proteusUnsubscribeProvide` 按 `this.__proteusPageId` 定位命名空间
   - onUnload：有 provide 或 inject 时注入 `delete __reg[this.__proteusPageId]`（页面销毁清理防泄漏；与订阅取消同处）
3. **验证**：测试 +4 → 390 全绿；demo 产物确认（页面 __seq/pageId/命名空间 + onUnload 清理；组件栈顶解析）；遗留：作用域插槽运行时等价

---

---

## 7. Batch 5：Transition 离开动画（延迟移除状态机）

**目标**：`<transition name="fade"><view v-if="on">X</view></transition>` — on 变 false 时先播离开动画再移除（不再立即消失）

**设计**（编译期状态机，复用 Batch 2 装饰式模型）：
1. **模板**（template.ts）：`<transition>` 直接子元素 v-if 表达式为**裸 ref 名**时：
   - v-if 改写为 `wx:if="{{__tv{i}}}"`（显示状态，初始 = v-if 初始值）
   - 动画 class 改插值：`class="proteus-transition-{name} {{__tl{i} ? 'proteus-transition-{name}-leave' : ''}}"`
   - 收集 `ctx.transitions: [{ ref, tName, index }]`（index 从 0 递增）
   - **范围限制**：复杂表达式 / 多子元素 / 无 v-if 保持 Batch 2 现状（进入动画 + 立即移除）
2. **样式**（style.ts）：TRANSITION_WXSS 补 leave 动画 class + keyframes（fade-out 0.25s / slide-up-out 0.32s / scale-out 0.4s，`forwards` 保持末帧）
3. **脚本**（script.ts）：
   - data 加 `__tv{i}: <v-if 初始值>`、`__tl{i}: false`（离开中标记）
   - 生成 `proteusTransitionToggle{i}()`：on 为 true → 取消定时器 + `__tv{i}=true, __tl{i}=false`（快速反向切换恢复进入动画）；on 为 false → `__tl{i}=true`（播离开动画）+ `setTimeout(时长)` 后 `__tv{i}=false`（定时器 id 存实例属性 `__tlTimer{i}`，重复进入防重）；时长按动画名映射（fade 250 / slide-up 320 / scale 400）
   - ref 写入点（赋值/自增自减）追加 `; this.proteusTransitionToggle{i}()`（rewriteRefAccess 新增参数）
4. **边界**：离开中 on 变 true → 取消定时器 + class 换回进入动画（animation 重触发进入动画，行为可接受）；多 transition 引用同一 ref 仅保留首个

**验收**：on 变 false → 产物含离开动画 class + 延迟移除（setTimeout 时长对齐 keyframes）；wxml `wx:if="{{__tv0}}"` + class 插值；非裸 ref 表达式保持现状；全量测试全绿 + 双端构建

**已落地**（2026-08）：
1. **模板**（template.ts）：`<transition>` 直接子元素 v-if 为裸 ref 名 → `wx:if="{{__tv{i}}}"`（显示状态，初始 = ref 初始值）+ class 插值 `{{__tl{i} ? '...-leave' : ''}}`；`ctx.transitions`（ref/tName/index）传给 script；复杂表达式/多子元素保持 Batch 2 现状；trace 规则 `transition/leave-state`
2. **样式**（style.ts）：TRANSITION_WXSS 补 leave class + keyframes（fade-out 0.25s / slide-up-out 0.32s / scale-out 0.4s，`forwards` 保持末帧）
3. **脚本**（script.ts）：data 注入 `__tv{i}`（初始 = v-if ref 初始值）/ `__tl{i}: false`；生成 `proteusTransitionToggle{i}()`（on 为 true → clearTimeout + 恢复 `__tv{i}=true,__tl{i}=false`；on 为 false → `__tl{i}=true` + setTimeout（fade 250 / slide-up 320 / scale 400）后 `__tv{i}=false`；定时器 id 存实例属性 `__tlTimer{i}` 防重）；rewriteRefAccess 新参 `transitionToggle`（ref 写入点追加 `; this.proteusTransitionToggle{i}()`，与 provideSync 并存）
4. **★gen-routes 修复**：`<transition>` 误判为自定义组件警告（编译器已消费、产物不输出）→ NATIVE_MP_TAGS 白名单加 transition
5. **验证**：测试 +4 → 386 全绿；demo（forms.vue 过渡卡片：toggleCard 切换，产物确认 wx:if __tv0 + class 插值 + toggle 方法 + wxss leave scoped 匹配）；遗留：作用域插槽运行时等价、provide 页面级隔离（pageId）

---

## 4. 验收标准

- [x] 作用域插槽编译期显式警告（反黑盒）
- [x] `<transition>` 编译为装饰式动画（class + keyframes），fade/slide-up/scale 进入动画可运行
- [x] 页面 provide + 组件 inject 运行时取值（getApp().__proteusProvides 全局注册表，MVP 值快照）
- [x] 3 条新规则登记（slot/scoped-slot、transition/component、script/provide-inject），防漂移
- [x] 全量测试全绿 + 双端构建

## 5. 遗留（后续批次）

- ~~作用域插槽**运行时等价**~~ → **Batch 7 已确认：MP 平台能力限制**（微信无模板传参机制——webview 的 template import 无法动态选择多父模板、插槽变量跨组件引用受限；Skyline 不支持跨文件模板；uni-app/Taro MP 端同样不完整）——运行时等价在 MP 无通用解，维持编译期警告 + 替代模式（props 传子 + triggerEvent 事件回调，组件系统 v0.3 完整支持）

---

## 6. Batch 4：provide/inject 响应式联动（★首批，复用 store 桥模式）

**目标**：`provide("key", refName)` 裸 ref 形式 → 值变化自动同步到所有 inject 侧组件（不再手动刷新）

**Vue 语义对齐**（★关键区分）：
- `provide("user", userInfo)`（传 ref）→ **响应式**：inject 侧模板解包、值联动 → 本批编译为订阅/通知
- `provide("user", userInfo.value)`（传值）→ **静态快照**：不联动（与 Vue 行为一致，保持 Batch 3 现状）
- `provide("user", "literal")` → 字面量快照：不联动

**设计**：
1. **运行时桥升级**（runtime/src/provide-inject.ts）：
   - 注册表条目升级为 `{ value, subs?: Array<fn> }`（订阅集合内联在 getApp().__proteusProvides 数据结构上，产物可直接操作）
   - `registerProvide(key, value)`：注册（保留现有语义）；`readInject(key)` 不变
   - 新增 `subscribeProvide(key, cb)`（返回取消函数）与 `notifyProvide(key)`（遍历执行订阅者）——手写运行时路径用；**编译产物直接操作注册表结构，不 import 本模块**（单文件产物约束，Batch 3 已定）
2. **编译侧 provide**（script.ts）：
   - `extractProvideInject` 记录 provide 的 **key ↔ ref 名**（expr 为裸 ref 名时）
   - 提供裸 ref 时：① onLoad 注册后初始化 `provides.__subs[key] = []`；② **该 ref 的每次写入点**（rewriteRefAccess 的 setData 注入处）追加 `this.proteusNotifyProvide("key")` + `provides["key"] = this.data.<ref>`（ref 名 → 注册表同步，通知前先更新值）；`.value`/字面量形式不注入
   - 生成方法 `proteusNotifyProvide(key)`：读 `provides.__subs[key]` → 遍历执行（ES5：索引循环）
3. **编译侧 inject**（script.ts）：
   - attached 里从快照 setData 升级为**订阅**：`provides.__subs[key].push(function(){ this.setData({ x: provides[key] }) })`（闭包捕获 that，ES5）
   - 组件 `detached` 注入取消订阅（索引移除，防泄漏）；页面 onUnload 同理（页面 inject 场景）
   - 订阅回调内的 `this` 用外层 `var self = this` 捕获（ES5 安全）
4. **规则**：`script/provide-inject` 说明书补响应式联动语义（why/when/example 更新）
5. **边界**：
   - 仅**裸 ref** 触发联动；**页面级隔离（pageId）继续遗留**（本批不做）
   - 联动通知发生在 ref 写入点（编译期已知），与 computed/watch 联动共用注入点模式
   - 组件间 provide（跨组件层级）保持 Batch 3 现状（created/attached 顺序正确）

**验收**：页面 `provide("user", userInfo)` + 组件 `inject` → ref 写入后组件 setData 自动更新（产物含 proteusSyncProvide + 订阅）；`.value` 形式零联动（回归）；运行时桥 subscribeProvide/notifyProvide 单测；全量测试全绿 + 双端构建；demo 页加联动按钮验证

**已落地**（2026-08）：
1. **运行时桥**（runtime/src/provide-inject.ts）：注册表加 `__subs` 保留键（订阅集合 `{ k, fn }[]`）；`subscribeProvide(key, cb)`（返回幂等取消）/ `notifyProvide(key)`；`provideCount()` 过滤 `__subs` 保留键；结构向后兼容 Batch 3（值仍直接存 `provides[key]`，静态提供零改动）
2. **编译**（script.ts）：
   - `buildProvideInject`：裸 ref 提供（expr 在 data 中）→ `provideRefs`（ref→key）+ 注册块后初始化 `provides.__subs[key] = []`；inject 块追加订阅（`const __self = this` + 每个 key 守卫块：仅订阅已初始化 `__subs` 的 key，静态/未注册 key 保持快照；`__proteusSubs` 记录订阅供取消）
   - `rewriteRefAccess` 新增 `providedRefs` 参数：ref 写入点（赋值 + 4 种自增/自减）追加 `; this.proteusSyncProvide("key", "ref")`（setData/watch 之后，`this.data[ref]` 已同步）
   - 生成 `proteusSyncProvide(key, ref)`（同步 `p[key] = this.data[ref]` + 遍历 `__subs[key]` 通知，ES5 索引循环）与 `proteusUnsubscribeProvide()`（按引用 indexOf/splice 移除，防泄漏）
   - 挂载：组件 inject → `detached()` 取消；页面 inject → 显式 onUnload 前置取消 / 无则生成承载 onUnload；组件模式不生成 onUnload（生命周期差异）
3. **语义对齐 Vue**：`provide("k", refName)` 传 ref → 响应式联动；`provide("k", refName.value)` / 字面量 → 静态快照（`.value` 形式零联动回归测试）
4. **验证**：测试 +5 → 382 全绿；demo（provide-inject-demo）改裸 ref 联动 + 切换按钮，产物确认（onLoad __subs 初始化 + changeUser 写入点 proteusSyncProvide + 组件 attached 订阅/detached 取消）

---
