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
