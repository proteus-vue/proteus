# 编译 IR 契约草案（CompileIR Contract Draft）

> **状态：评审稿 v0.1（2026-09-07）** · 只含设计与证据，未动任何代码。
> 评审通过后才进入里程碑实施（见 §6）。
> 背景决策：#290（语义 IR + 可插拔后端定案）、#504（方法论：「不自研成熟工具链，只自建语义层」）、
> 用户 2026-09-07 方向确认（自研边界应收敛为**一份语义层**，而非每端一套文本转换器）。
>
> **★#505 平台语义参考附录**：`docs/compiler-platform-alignment.md`（glass-easel 官方 WXML 语义模型——
> 不再自造 IR 语义，官方 parser 即平台语义真相；含 wx:key 自造限制实证 G1）。

---

## 0. TL;DR

1. **问题**：MP 主编译路径（`packages/compiler` 的 `compileVueSfc`）至今是「三份文本直出 + 一份旁路字典」——Vue 官方 parse 后直接拼 wxml/js/wxss 字符串，**中间没有框架定义的 IR**。跨阶段契约靠 `TemplateTransformResult` 的 15 个字段手抄传递。规则注册表 83 条是「旁注」，不在执行路径上。结果：#497–#504 每个语义缺口只能对文本/AST 打点状补丁，且**端越多、补丁面越大**——这就是「无底洞」的结构根源。
2. **方案**：把主编译路径提升为「**框架 IR（CompileIR）→ 规则在 IR 上变换 → codegen 后端**」三阶段，与既有 C-IR / CompilerIR **打通**（不建第三套独立语义体系），让 conformance 对准**真实主编译产物**。
3. **不推翻**：#497–#504 的资产全部保留（AST 化发现层、83 条双语规则说明书、ES5 babel、87 文件门禁）；Web/App 仍走成熟工具链（真 Vue / 官方 createRenderer），**不重建三端 codegen**。
4. **每步验收铁律**：产物由 IR 生成（非直出）+ 语义快照进 conformance 门禁；重构期产物与现状**逐字节等价**（保 87 门禁与 golden 全绿）。

---

## 1. 事实基线（2026-09-07 取证，只读）

### 1.1 主编译路径数据流（现状）

```
Vue SFC
  │  sfcParse（@vue/compiler-sfc，成熟工具）
  ▼
descriptor.{template,scriptSetup/script,styles}（三块文本 + 少量属性）
  │
  ├─ transformTemplateToWxml  → domParse（@vue/compiler-dom）→ serializeNode 递归
  │                              ★直接拼 wxml 字符串（无节点级输出 IR）
  │                              ★顺带收集 11 个旁路集合/数组（见 1.2）→ TemplateTransformResult
  ├─ transformScriptToPage    → topLevelAst（@babel/parser，#497）做「发现/提取/切片」
  │                              ★产物语句 = 源码文本片段 + 生成字符串（无合成 AST）
  │                              ★重写靠文本正则（rewriteRefAccess 等）→ babel ES5（#504）
  ├─ transformStyleToWxss     → 全正则（无 CSS AST）
  ▼
CompileResult = { wxml, js, wxss, warnings, trace, sourcemap }   ← 100% 文本
```

证据：`packages/compiler/src/index.ts` L52-158；`template.ts` serializeNode → string（L1026-1040）；`script.ts` AST 只做发现/切片；`style.ts` 全正则。

### 1.2 「准 IR」已经以旁路字典形式存在

`TemplateTransformResult` 15 字段（`packages/types/src/compiler-types.ts` L85-114）中，除 `wxml` 外 14 个全是模板→脚本的**跨阶段契约**，且与 `ScriptTransformOptions`（L117-141）**双份手抄、类型上无连接**（index.ts L91-111 逐字段搬运，改一侧另一侧静默漂移）：

| 字段 | 类型 | 语义概念 |
|---|---|---|
| `vModelBindings` | `string[]` | v-model 字段名（**丢失 arg/修饰符/元素类别**） |
| `vModelComponentHandlers` | `{name,model}[]` | 自定义组件 v-model 回写（prop+update:arg） |
| `styleBindings` | `string[]` | `:style` 动态裸标识符（需字符串化） |
| `templateRefs` | `string[]` | 模板表达式对实例属性依赖面（**采集不全**） |
| `storeBindings` | `string[]` | `store.<field>` 引用 |
| `inlineHandlers` | `{name,code}[]` | 内联事件包装方法（**code 是 template 拼的 JS 串直进产物**） |
| `selfHandlers`/`onceHandlers` | `string[]` | .self/.once 包装 |
| `transitions` | `{ref,tName,index}[]` | 动画状态机（**duration 表在 script 硬编码、style 注释各一份**） |
| `semanticGrids` | `{minColWidth,gap,index,defaultStyle}[]` | p-grid 语义元素（**flex-basis 公式三处复制**） |
| `usesNavigate`/`usesTransition`/`pageScrollWrapped` | `boolean` | 页面能力开关 |

**结论**：编译器不是"没有 IR"，而是"IR 以裸数组 + 字符串引用存在、无结构、无双侧类型连接、无校验"。升级为结构 IR 的原料已经齐全。

### 1.3 规则注册表：描述层 81/83，执行层 2/83

- 实测 **83 条**（template 45 / script 26 / style 9 / validate 3），82 implemented + 1 limitation；
- 仅 2 条带 `apply` 且接真实路径：`style/px-to-rpx`（style.ts L154）、`template/scope-attr`（template.ts L685）——其余 81 条不在任何执行路径；
- `executeRule` / `RuleContext` **未从包公开导出**（index.ts 只导出 list/get/format），但 README/changeset 已宣称"分派层落地"（文档超前于代码）；
- 真实驱动是**反向漂移门禁**（registry-drift.test.ts）：先改实现 → 忘登记 → 红。即「登记规则」是实现的**下游义务**，不是能力入口——与"补规则 = 唯一修 bug 通道"正好相反；
- 门禁盲区：`rule.verify` 是自由文本（无测试解析它指向的用例存在）；`check-script-compile.mjs` 只验语法 + ES5 tripwire，**验不了语义对错**。

### 1.4 既有两套 IR 对本弧缺口的覆盖（对照 #497-504 修过的语义）

| IR | 包 | 本质 | 覆盖 #497-504 缺口语义 |
|---|---|---|---|
| C-IR | `component-ir` | p-* 组件语义规范化树（SEMANTIC_ENUM 62 + TAG_SEMANTIC_MAP + SEMANTIC_BACKEND_MAP），SSOT 在 schema.ts | **几乎全覆盖不到**：只收 p-* 元素；无 slot/指令/表达式/style 面 |
| CompilerIR | `compiler-backend` | 编译后端产物契约容器（version + render 树 + semantic 树 + bindings） | **覆盖不到**：只读 template 块（node.ts L184-185）；class/style/id/key/ref **整组剔除**（node.ts L75）；children 只收 ELEMENT（插值/文本不进树）；script/data 域完全不可见 |

**9 类缺口（v-model 组件契约 / 具名插槽 / :style 派生 / computed 链 / v-show 括号 / 赋值事件 / Infinity / usingComponents / ES5）全部落在两套 IR 的盲区**：指令级组件契约、模板表达式格式化、以及**整个 script/数据域**（后者的结构性缺失最重——G-29/G-38 设计里就没有 script 面）。

### 1.5 最关键的断裂：conformance 世界与 transforms 世界零共享

- `compileVueSfc`（真实主编译）**不 import 任何 IR 包**，产物不进任何 conformance；
- `compiler-backend` 的 conformance 用 `DEFAULT_CONFORMANCE_SFC` fixture **自测自的**（与真实产物无关联）；
- `component-ir` 的六端快照门禁消费的是 fixture 驱动的 C-IR 树，与 `compileVueSfc` 无关。

→ 「修一次、多端 conformance 受益」**至今没有机器通道**——这正是本草案要补的核心一环。

---

## 2. 设计目标（可判定）

| # | 目标 | 判定标准 |
|---|---|---|
| G1 | 主编译路径经过框架 IR | `compileVueSfc` 内部存在可校验的 CompileIR；产物由 IR 快照 + codegen 生成（非直出） |
| G2 | 补规则 = 唯一修 bug 通道（正向） | 新语义缺口 = 新增一条规则（含 apply + 产物断言绑定）；无「改 if 分支 + 事后补登记」路径 |
| G3 | 修一次、多端受益 | 同一 CompileIR 语义快照进既有 conformance 矩阵（component-ir 六端 / compiler-backend 双后端） |
| G4 | 不建第三套独立语义体系 | CompileIR 的语义词表引用 C-IR（SEMANTIC_ENUM/TAG_SEMANTIC_MAP），产物快照与 CompilerIR 形状对齐 |
| G5 | 不推翻现有、不重建三端 codegen | 重构期产物逐字节等价（golden/87 门禁不动）；Web/App 仍走成熟工具链 |
| G6 | 与 #504 方法论一致 | 框架自研边界 = CompileIR 定义 + 语义变换规则；parse（sfc/dom/babel）、ES5（babel）全用成熟工具 |

---

## 3. IR 家族定位（本草案 IR 与 C-IR / CompilerIR 的关系）

项目已有 IR 是一族而非一套，各自服务不同消费者；本草案新增的是**主编译管线的阶段间语义 IR**：

| IR | 归属 | 是什么 | 消费者 | 状态 |
|---|---|---|---|---|
| C-IR | `component-ir` | 组件语义规范化树（p-* 语义词表 SSOT） | render-backend 六端快照、MCP、Agent | 已落地（独立管线） |
| CompilerIR | `compiler-backend` | 编译后端**产物契约**容器（render/semantic/bindings 树） | dual-check（Node/Rust 等价）、G-38、Playground IR Tab | 已落地（旁路管线） |
| **CompileIR**（本草案） | `packages/compiler`（新模块） | **主编译管线阶段间 IR**：TemplateIR（节点树 + 指令契约声明）+ ScriptIR（data/computed/watch/props/lifecycle 语义声明） | codegen 后端（wxml/js/wxss）+ conformance 快照 | **缺失——本草案补** |

**三者关系（不重复建设的关键）**：

```
Vue SFC
  │ 成熟工具 parse（sfc/dom/babel）
  ▼
CompileIR  ←── 框架自研边界 #1：语义声明层（本草案）
  │ 规则注册表在 IR 上变换（补规则 = 补变换，分派即 trace）
  ▼
codegen 后端（薄）→ wxml / js / wxss（与现状逐字节等价）
  │
  └─ 语义快照 emit（序列化）──► CompilerIR 形状（semantic 树复用 C-IR 词表）
                                   │
                                   ▼
                       既有 conformance 矩阵（六端快照 / 双后端等价）
```

- **CompileIR 复用 C-IR 的语义词表**（SEMANTIC_ENUM/TAG_SEMANTIC_MAP），不新造 p-* 语义；
- CompileIR 的「语义快照」序列化后与 CompilerIR.semantic 同构 → 真实主编译产物进入既有 conformance；
- 命名避免蓝图旧称 `IRProgram`（7 类节点覆盖 route/store/capability…领域，超出编译管线职责且无真实消费方）；本 IR 从 1.2 的 15 字段真实契约升级而来——**先有事实、后有名字**。

---

## 4. CompileIR 契约 v0.1 范围

### 4.1 结构（两棵 + 一个容器）

```
CompileIR {
  version: 1
  template: TemplateIR        // 模板语义树
  script: ScriptIR            // 脚本语义声明
  pageCapabilities: { navigate, transition, scrollContainer, ... }
  sourcemap / loc 引用        // 每节点可回源
}

TemplateIR = {
  root: TemplateNode          // { type: element|text|interpolation|comment, tag, loc }
                              // element 节点 = 语义标签?（引用 TAG_SEMANTIC_MAP）：原生标签
  declarations: {             // ← 由 1.2 的 14 个旁路字段提升为结构（每条带 loc + 规则 id）
    vModels:        TwoWayBinding[]          // { target, arg?, elementKind: input|component, modifiers }
    slotRoutes:     SlotDeclaration[]        // 具名/默认/作用域
    styleBindings:  StyleBinding[]           // { target, kind: literal|derived, valueKind: string-only }
    eventAdapters:  EventAdapter[]           // inline|self|once|vmodel-write
    transitionStates: TransitionStateMachine[] // { ref, tName, durationMs }（duration 单点）
    semanticLayout: SemanticLayoutElement[]  // p-grid 等（flex-basis 公式单点）
    templateReads:  IdentifierDep[]          // 模板→组件状态依赖闭包（补全 1.2 采集缺口）
  }
}

ScriptIR = {
  data:        DataDecl[]        // ref/reactive/顶层 let → data 声明 + init
  computeds:   ComputedDecl[]    // 表达式/块体/getter/setter + 依赖（x.value 引用）
  watchers:    WatchDecl[]       // 源/回调/options（observers 参数归一在 IR 上做）
  props:       PropsDecl[]       // defineProps 对象/泛型 → properties
  lifecycles:  LifecycleHook[]   // onLoad/onReady/onUnload/onMounted→... 映射
  methods:     MethodDecl[]      // 方法体（含来自 template 的包装方法）
  providesInject: ...
}
```

> v0.1 **只先落 TemplateIR + ScriptIR 的类型与「旁路字段 → 声明节点」的搬迁**（行为零变化）；
> 表达式级分析（识别依赖/归一参数）逐语义迁入，不从第一天做全量表达式 IR。

### 4.2 规则注册表挂载方式（G2 的机器基础）

```
规则（83 条现有 + 新增）           CompileIR
  id = <phase>/<name>          每条规则声明：
  description/why/example         appliesTo: TemplateIR.declarations.vModels | ScriptIR.computeds | ...
  apply(ctx)  ← 迁入            产出 = IR 变换 + 代码段声明（不再拼裸文本串）
```

- **分派即 trace**：规则执行 = 在 IR 上变换；trace 事件由分派层自动产生（替代手工 `trace.add`）；
- 每规则强制绑定：`verify` 指向的产物断言用例必须存在（补 §1.3 门禁盲区①）；`example.before → compile → 断言含 after 语义标记` 机器可执行；
- 删除「改 if 分支」路径的方式：变换入口收敛为规则分派点（可枚举），drift 门禁从"查 ID 字面量"升级为"查变换点覆盖率"。

### 4.3 codegen 后端（薄，行为零变化）

- 现有 `template.ts`/`script.ts`/`style.ts` 的**序列化逻辑**归位为 codegen 后端，消费 CompileIR 而非裸文本/旁路数组；
- 重构第一里程碑产物必须与现状**逐字节等价**（spi-first：先保行为再谈演进）；
- 三端 codegen 不建（Web=真 Vue、App=官方 createRenderer；见 §0.3）。

### 4.4 conformance 对准真实产物（G3 的机器基础）

- `compileVueSfc` 每次编译**同时 emit CompileIR 语义快照**（默认开，可关）；
- 快照经「CompilerIR 形状适配器」进既有两套门禁：
  1. component-ir 六端快照（语义树同构比较）——语义缺口修复后**所有端**的 readback 一次验证；
  2. compiler-backend dual-check（Node/Rust）——将来主编译产物的 IR 与旁路双编译 IR 对齐，消除"旁路校验 ≠ 真实产物"的现状。

---

## 5. 试点（第一个语义缺口端到端）

### 候选（推荐）：`:style` 派生对象自动序列化（决策 #500）

**为什么选它**：
1. **跨层契约现形**：一个语义横跨 template（收集 `styleBindings`）与 script（computed 派生值包 `__proteusStyleString` + helper 注入），今天靠 `compiler-types.ts` L106-110 与 L133-137 两处**同名旁路数组**手拉手——没有结构时两通道各自为政（曾出 #496b「WebView 亦静默失效」修正）；
2. **平台序列化契约**：「style 值域 = string-only」是双渲染器硬约束，天然写进 IR 的 `valueKind` 字段——最能展示"平台约束入 IR"；
3. **回归面真实**：20+ 组件（p-split/p-sidebar/p-modal…）真机在吃这条规则；
4. **现成测试可迁移**：`tests/mp-transform.test.ts` L1365-1382 四条断言（含正负两形态）；
5. 规则 `directive/v-bind-style` 已有完整双语说明书（transforms/template.ts L322-337）。

**试点验收**：
- 同一 SFC：新管线产物与旧实现**逐字节等价**；
- CompileIR 快照含该 style 绑定声明（`valueKind: string-only` + 派生 computed 引用）；
- 既有 mp-transform 断言 + 87 门禁全绿；
- 删除/绕过一条语义规则 → 快照门禁红（证明"规则在 IR 上、缺了会死"）。

**候选备选**：v-model 自定义组件契约（#501，契约性最强、可对齐 Web 真实 Vue 语义，但跨 script 方法体生成，范围略大）；v-show 括号化（最小冒烟，价值上限低）。

---

## 6. 里程碑与退出标准

| 里程碑 | 内容 | 退出标准（机器可验） |
|---|---|---|
| M0 | 契约评审定稿 | 本草案定稿 + 决策点拍板 |
| M1 | **骨架搬迁**：CompileIR 类型落地 + `compileVueSfc` 内部"旁路字段 → IR 声明节点"（codegen 出口暂不变） | 产物与现状**逐字节等价**（golden 4 + 87 门禁 + 全量 2287 测试全绿）；`CompileIR` 单测覆盖 15 字段搬迁 |
| M2 | **试点语义挂 IR**：`:style` 序列化改为 IR 声明 + 规则 apply（`directive/v-bind-style` 从描述层迁执行层） | 试点验收 4 条全过；**反向验证**：删规则 → 红 |
| M3 | **conformance 对准真实产物**：CompileIR 语义快照 → CompilerIR 形状 → component-ir 六端矩阵 + dual-check | 快照门禁接入 CI；语义缺口修复用例进矩阵（修一次、多端一次过） |
| M4 | **ScriptIR 语义逐条迁入**（computed 链 / watch / props / observers 归一…） | 每条 = 一条规则 apply + 产物断言；drift 门禁升级为变换点覆盖 |
| M5 | 规则治理补全：verify 解析 + example 编译断言 + 总数快照门禁 + executeRule 公开导出 | transforms 世界与 conformance 世界共享门禁，无盲区 |

每里程碑独立可停可审；任何一步与 §2 目标冲突即停，不悄悄滑回"直出 + 旁注"。

---

## 7. 风险与诚实边界

1. **行为等价风险（M1 最大）**：搬迁期任何一处语义漂移都会被 golden 抓到——用逐字节等价做安全网；若某字段无法无损搬迁（如 1.2 中采集不全的 `templateRefs`），**先记录差距、不顺手修**（M4 再补），保证 M1 纯净。
2. **范围风险**：CompileIR 只覆盖**编译管线职责**（模板/脚本/样式语义），**不**把 route/store/capability 等领域 IR 拉进来（那是蓝图 IRProgram 的过度设计教训）；语义词表一律引用 C-IR，禁止新造 p-* 语义。
3. **性能**：IR 化增加编译期内存与一次序列化。编译期非运行期热点，但需实测：M1 后跑 `scripts/benchmark.ts` 对比，`measured: false` 时不宣称任何数字。
4. **适用边界**：本 IR 服务于"语义缺口会随端增多而复现"的 MP 编译族（微信/支付宝/抖音同源端）；一次性小页面、纯展示型页面不需要也不应该走全量声明化——规则仍可按需触发。
5. **诚实声明**：M1 只证明"IR 能承载现状"，**不**证明"多端受益"——后者要 M3 conformance 对准后才成立；试点验收语里不夸大。

---

## 8. 待拍板决策点

| # | 决策 | 选项 | 建议 |
|---|---|---|---|
| D1 | CompileIR 归属与命名 | A. `packages/compiler` 内新模块（与 C-IR/CompilerIR 平级第三套，但复用其词表）B. 直接扩 CompilerIR | A（编译器产物契约与主编译管线 IR 消费者不同，硬合并会拖累 compiler-backend 独立性） |
| D2 | 试点选材 | A. `:style` 序列化（推荐）B. v-model 组件契约 C. 两者都做（一个 M2 内） | A 先做，B 作 M4 首条对照 |
| D3 | 重构期产物兼容 | A. 逐字节等价是硬约束（golden 4 不动）B. 允许 golden 快照更新 | **A（强烈建议）**：等价是"不推翻"承诺的机器证明；golden 更新会掩盖漂移 |
| D4 | M1-M5 节奏 | 一次评审后连续做 / 每 M 评审一次 | 每 M 评审一次（M1 后先看字节等价证据再放行 M2） |
| D5 | 命名（若 D1=A） | CompileIR / PipelineIR / StageIR | CompileIR（与 CompilerIR 区分清晰、表意直白） |

---

*本草案为评审稿；批准后更新 PROJECT_MEMORY 决策链并进入 M1。*

---

## 9. M3 收口遗留决策 D6（2026-09-07，批 5 后唯一开放项——待拍板）

**事实基线**（M3 批 1-5 已落地，见 PROJECT_MEMORY）：semanticCount 已改渲染树全树口径（compat 根页面语义如实计入）；conformance 的 countMatch 仅在 C-IR 树存在时适用；`ir.semantic.unrooted` 信息核对说明「compat 根有语义 = 合法主形态」。**遗留**：compat 根页面（真实页面主形态：`<view>` 壳 + 嵌套 p-*）的 `semantic.tree` 恒为 null——单根 C-IR 契约表达不了「页面 = 兼容壳 + 语义内容」；component-ir 六端矩阵（renderComponentSnapshot 读 C-IR）因此只能 fixture 级验证，真实页面语义内容读不回六端。

**决策**：compat 根页面语义内容如何进入六端矩阵读回？

| 方案 | 内容 | 优点 | 代价/风险 |
|---|---|---|---|
| A. **C-IR forest（多根）**：`SemanticIR.tree` 扩为 `ComponentIR | ComponentIR[] | null`，compat 根页面返回语义根数组（各顶层语义元素平铺） | 语义内容无丢失地进入消费方；六端矩阵可对每个语义根读回 | 破单根契约（spi/rust/conformance/六端消费全联动）；页面级根顺序语义需定义；改动面最大 |
| B. **合成容器根**：compat 根页面合成伪根 `{ tag: null, semantic: 'layout.page-shell', children: [顶层语义...] }`（新语义入 SEMANTIC_ENUM/SEMANTIC_BACKEND_MAP） | 保持单根契约（tree 恒非空）；六端零改造读回 | 引入**自造语义**（'layout.page-shell' 非平台标准——违背 glass-easel 官方语义对齐方法论）；伪根在各渲染端无真实对等物 |
| C. **现状 + 显式声明**：tree 保持 null；六端矩阵维持 fixture/组件级；文档+conformance unrooted 检查显式声明「页面级语义读回 = 渲染树遍历（cross-gate 已覆盖），六端矩阵只管组件语义树」 | 零契约改动；cross-gate（M3 门禁① R1/R2/R3）已覆盖真实页面的编译语义↔语义树一致性 | 真实页面的语义内容仍不进六端控件映射矩阵（页面 p-* 组件的语义控件在各渲染端的 readback 无机器验证） |

**建议：先 A 后收口，但砍范围**——不动 `SemanticIR.tree` 契约（C 的保守面），改在 **compiler-backend 层新增旁路 `semanticForest`**（`{ tree 单根保留现状 + forest: ComponentIR[] 顶层语义根平铺 }`，Node/Rust 双端 + conformance 计数核对）；六端读回按 forest 逐根 renderComponentSnapshot。理由：①不破既有单根契约与 Rust 等价（tree 语义不变）；②页面「compat 壳 + 语义内容」用 forest 如实表达，无自造语义（对齐 B 的反对点）；③消费方（六端矩阵）增量接入，不阻塞。若选 C 则 M3 就此收口（语义森林登记为远期项）。

**✅ D6 已采纳（A' 砍范围版，2026-09-07 批 6 落地）**：`SemanticIR.forest`（可选）Node/Rust 双端产出 + conformance forestRooted/forestNonEmpty 核对 + 84 真实文件双端 forest 序列等价 + capabilities 从 forest 逐根收集（compat 根页能力声明不再空白）。遗留：六端矩阵按 forest 逐根 readback 的消费接线（render-backend 侧增量，下一小批）。
