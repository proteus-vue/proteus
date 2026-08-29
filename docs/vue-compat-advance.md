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
| 5 | Transition **离开动画** / 作用域插槽运行时等价（规划候选） | 中高 | ⬜ |

依赖：1 → 2 → 3（顺序按工程量递增，各自独立可测）

## 4. 验收标准

- [x] 作用域插槽编译期显式警告（反黑盒）
- [x] `<transition>` 编译为装饰式动画（class + keyframes），fade/slide-up/scale 进入动画可运行
- [x] 页面 provide + 组件 inject 运行时取值（getApp().__proteusProvides 全局注册表，MVP 值快照）
- [x] 3 条新规则登记（slot/scoped-slot、transition/component、script/provide-inject），防漂移
- [x] 全量测试全绿 + 双端构建

## 5. 遗留（后续批次）

- 作用域插槽**运行时等价**（props 传子 + 事件回调自动包装）——当前仅编译期警告
- Transition **离开动画**（transitionend 控制延迟移除）——当前仅进入动画
- provide/inject **响应式联动**（注册表存 ref 引用，inject 读到同一 ref）与**页面级隔离**（pageId）——当前值快照 + 全局注册表

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
