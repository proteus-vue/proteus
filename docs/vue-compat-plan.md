# Vue 能力兼容修复规划（vue-compat）

> 版本：v1（2026-08）
> 背景：Vue 能力完整度实测（19+ 样本编译验证）——主路径覆盖率高，但存在**静默失败**（编译零警告产物坏）违反反黑盒底线（决策 #65/#66）
> 执行原则：每批独立提交、全绿后下一步；涉及 compiler 核心（script.ts/template.ts），规则注册表同步登记防漂移

---

## 1. 实测结论（评估基线）

### ✅ 主路径完整支持（零警告 + 产物正确）
模板（v-if/v-for/v-show/v-bind/v-model/v-html/v-once/slot）、响应式（ref/computed 读写/watch 全源/生命周期）、组件（props/emits/expose/slot/usingComponents/TS 泛型）、CSS（scoped/:deep/scss）、类型（TS 剥离）、生态（Pinia/路由）

### ⚠️ 警告降级（产物可能失效）
1. **事件处理器仅简单方法引用**：`@click="count++"` → 原样输出 + 警告
2. **`:class` 数组对象简写** `{ on }` → 跳过 + 警告
3. **跨模块/函数调用初始化**：`const store = usePlayerStore()` → `data.store: undefined` + 警告（机制已存在，文案不够 actionable）

### ❌ 静默失败（★反黑盒违规，本轮修复重点）
1. **平台无对等能力零警告**：`<component :is>` → 无效标签；自定义指令 `v-focus` → 剥离无痕；模板 `ref="el"` → 永不绑定；`Transition/Teleport/Suspense/keep-alive` → 未拦截
2. **import 剥离无提示**：`import { useV } from './util'` → 单文件产物无模块系统，import 被剥但无警告（引用未定义符号）

---

## 2. 修复目标（分级）

| 批次 | 内容 | 工程评估 | 风险 |
|------|------|----------|------|
| **A（P0 反黑盒）** | 平台无对等能力 + import 剥离 → **编译期显式警告**（清单 + 文案增强） | 轻（template/script 检测 + 警告） | 低 |
| **B（P1 事件内联）** | 事件处理器内联表达式支持（自增/自减/简单方法调用） | 中（template 收集 + script 生成包装，复用 .self/.once 模式决策 #88） | 中 |
| **C（P2 补全）** | `:class` 对象简写、跨模块初始化警告文案 actionable | 轻 | 低 |

> B 依赖 A 的警告机制（内联表达式兜底仍警告）；C 为收尾。

---

## 3. 详细设计

### Batch A：平台无对等能力编译期警告清单（★反黑盒）

**目标**：`<component :is>` / 自定义指令 / 模板 ref / Transition 系组件 → 编译期警告（不再静默）

**template.ts 检测**（serializeElement 内新增）：
- `<component>` 标签（非组件）→ `component/is` 规则：警告「小程序无动态组件（<component :is>），产物为无效标签——请用 v-if/v-else 条件渲染」
- 自定义指令（`v-[a-z-]+` 不在白名单：if/else/show/for/model/html/text/on/bind/slot/pre/once/cloak）→ `directive/custom` 规则：警告「自定义指令 v-focus 小程序无对等机制，已剥离且不执行」
- `ref="xxx"` 属性（模板 ref）→ `node/template-ref` 规则：警告「模板 ref 小程序无对等（用 this.selectComponent('#id')）」
- 标签 `transition/transition-group/teleport/suspense/keep-alive` → `node/no-peer` 规则：警告「小程序无对等组件，已原样输出」

**script.ts**：
- import 剥离时警告：检测 setup 顶层 import → `script/module-import` 规则：警告「import 在小程序单文件产物中不支持（模块未内联），引用将 undefined——请内联共享逻辑或用框架 store 桥」
- 函数调用初始化警告文案增强（现有"无法静态求值" → 补充跨模块提示）

**规则注册表**：登记 5 条新规则（template/is-component、template/custom-directive、template/template-ref、template/no-peer、script/module-import），transforms.test 防漂移

**测试**：tests/vue-compat.test.ts（每类警告出现 + 产物不崩 + 规则登记校验）

**验收**：实测 4 类静默失败 → 全部变显式警告；350 测试全绿 + 双端构建

---

### Batch B：事件处理器内联表达式支持

**目标**：`@click="count++"` / `@click="fn(1)"` → 生成包装方法（产物可运行）

**设计**（复用 .self/.once 包装模式，决策 #88）：
- template.ts：serializeElement 收集"非简单方法引用的内联表达式 handler"（`expr` 非 `ident` 形式）→ 分类：
  - **自增/自减**：`count++` / `--count` / `count--` / `++count` → `proteusInlineTapCountPlus(e) { this.setData({ count: this.data.count + 1 }) }`（对齐 ref 重写，决策 #36）
  - **方法调用带字面量参数**：`fn(1)` / `fn('a')` → `proteusInlineTapFn1(e) { this.fn(1) }`（参数序列化到方法名避免冲突）
  - 其余（复杂表达式/含 store 引用）→ 保留警告（Batch A 的警告清单）
- script.ts：收集 inlineHandlers（Set）→ 生成包装方法（与 proteusSelf 同位置）
- 产物：wxml `bindtap="proteusInlineTapCountPlus"` + 方法定义

**范围控制**：仅 自增/自减 + 简单方法调用（1-2 个字面量参数）；不做完整表达式求值

**测试**：tests/vue-compat.test.ts（产物含包装方法 + 调用正确 + 复杂表达式仍警告）

**验收**：常见写法（count++/toggle()）产物可运行；350+ 测试全绿

---

### Batch C：收尾补全

1. **`:class` 数组对象简写** `[a, { on }]`：支持对象简写（`{ on }` → `{ on: true }`）→ 对齐完整对象形式
2. **跨模块初始化警告文案 actionable**：`const store = usePlayerStore()` → 提示「小程序端跨模块初始化不支持（store 将 undefined）——改用框架 store 桥或内联逻辑，见 docs/pinia-migration.md」

**测试**：对应用例补全

---

## 4. 分批执行（防上下文爆）

| Batch | 文件（LLM 输入） | 产出 | 状态 |
|-------|------------------|------|------|
| A | 本文件 + script.ts/template.ts 现状 | 警告清单 + 5 规则 + 测试 | ⬜ |
| B | 本文件 + template.ts handler 段 + script.ts 方法生成 | 内联表达式包装 | ⬜ |
| C | 本文件 | :class 简写 + 文案 | ⬜ |

**依赖**：A → B → C（B 兜底警告复用 A 清单）

## 5. 验收标准

- [ ] 4 类静默失败（component :is / 自定义指令 / 模板 ref / import 剥离）全部编译期显式警告
- [ ] `@click="count++"` 产物可运行（包装方法）
- [ ] `:class="[a, { on }]"` 对象简写支持
- [ ] 规则注册表新增规则全部登记（transforms.test 防漂移）
- [ ] 全量测试（350+）全绿 + 双端构建
