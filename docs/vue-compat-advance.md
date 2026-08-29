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

### Batch 2：Transition 运行时等价（框架组件，工程量中）

**目标**：`<transition name="fade">` → 框架内置 `proteus-transition` 组件（进入/离开动画）

**设计**：
1. **框架组件** `src/components/transition/index.vue`：
   - props：`name`（fade/slide-up/scale，映射 CSS 动画）、`visible`（显隐切换触发动画）
   - 内部：`wx:if` 控制显隐 + CSS `animation` class（enter：挂载时播放进入动画；leave：先播离开动画再延迟移除元素——定时器控制）
   - 语义对齐 Vue transition：单元素包裹 + 条件切换
2. **编译映射**（template.ts）：
   - `<transition>` → `<transition>` 标签经 usingComponents 注入框架组件（proteus/transition）
   - `v-if` 子元素 → 转 `visible` 驱动：`<transition :visible="on">`（编译读取 v-if 表达式）
   - Batch A 的 `template/no-peer` 警告改为"已编译为框架组件"（transition 不再警告，teleport/suspense/keep-alive 保留警告）
3. **规则**：`transition/component`（transition 编译为框架组件）
4. **产物**：transition 子元素显隐 + 动画 class

**范围**：单元素包裹 + 常见动画（fade/slide-up/scale）；leave 延迟移除用定时器（≈transition 时长）；多元素/多动画组合后续

**验收**：`<transition name="fade"><view v-if="on">X</view></transition>` → 产物使用 proteus-transition + visible 绑定 + 动画；MP 构建通过

---

### Batch 3：provide/inject 页面级注入桥（运行时，工程量中高）

**目标**：页面 provide → 组件/页面 inject（跨层级取值）

**设计**：
1. **运行时桥** `@proteus/runtime`（runtime/src/provide-inject.ts）：
   - `registerProvide(key, value, pageId?)` / `readInject(key)`：全局注册表（按页面隔离，页面 onUnload 清理）
   - 页面 `provide(key, value)` → onLoad 注册；组件 `inject(key)` → attached 读取
   - 响应式：注册表存 ref 引用，inject 侧读到同一 ref（读写联动）
2. **编译**（script.ts）：
   - `provide("key", val)` 调用 → 编译为运行时注册（onLoad 注入）+ 剥离原始调用
   - `inject("key")` → 编译为运行时读取（attached/data 初始化）
   - 产物：引用 @proteus/runtime 的桥（组件模式 attached、页面模式 onLoad）
3. **规则**：`script/provide-inject`（提供者注册 + 注入读取）
4. **边界**：
   - 仅支持**页面级 provide**（页面 → 其组件子树 inject）——组件间 provide（跨组件层级）后续
   - inject 值非响应式快照或 ref 传递（MVP：ref 引用）
   - 未 provide 的 key → 警告

**验收**：页面 provide + 组件 inject 编译产物调用运行时桥；单测覆盖注册/读取/清理/未注册警告

---

## 3. 分批执行

| Batch | 内容 | 工程量 | 状态 |
|-------|------|--------|------|
| 1 | 作用域插槽警告 + 规则 + 文档 | 小 | ⬜ |
| 2 | Transition 框架组件 + 编译映射 | 中 | ⬜ |
| 3 | provide/inject 页面级桥（运行时 + 编译） | 中高 | ⬜ |

依赖：1 → 2 → 3（顺序按工程量递增，各自独立可测）

## 4. 验收标准

- [ ] 作用域插槽编译期显式警告（反黑盒）
- [ ] `<transition>` 编译为框架组件，fade/slide-up/scale 动画可运行
- [ ] 页面 provide + 组件 inject 运行时取值（ref 引用，页面级隔离）
- [ ] 3 条新规则登记（slot/scoped-slot、transition/component、script/provide-inject），防漂移
- [ ] 全量测试全绿 + 双端构建
