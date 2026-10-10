# Vapor v-model 回写（B4）落地方案（v1）

> 类型：plan（B4 双向绑定族 + 分批）
> 触发：用户 2026-10-10「继续」→ 接内核文本线（B-T1/T2/T3）后的下一项 = B4 v-model 回写
> 关联：`docs/vapor-vue-alignment-plan.md`（B4 · 22 页）· `packages/compiler/src/vapor/{template,events,deps}.ts` · `packages/slot-runtime/src/handler.ts`
> 状态：**B4-T1 已交付；T2/T3 待做**

---

## 0. 结论先行

`v-model` 在 Vapor 路**下行**（值 → 文本槽位）一直有；缺的是**回写**（输入 → 源）。B4 分三步：

| 批次 | 内容 | 状态 |
|---|---|---|
| **B4-T1** | **回写契约（编译期 + 运行期）**：`v-model="x"` ⇒ 编译成 `input` 事件 + `set x = $event` 动作；`$event` 运行时语义 | ✅ **已交付（2026-10-10）** |
| **B4-T2a** | **框架前置**：`ScreenRuntimeInstance.dispatchInputValue(nodeId, value)`——宿主编译控件值 → 查 `input` 绑定 → 跑回写 handler（`$event`=值）→ 数据变 → 下行随之。三端宿主共用、可 JSON 测 | ✅ **已交付（2026-10-10）** |
| **B4-T2b** | **三端宿主原生输入控件**：Android `EditText`/`AppCompatEditText` · iOS `UITextField`/`UITextView` · 鸿蒙 `TextInput`——按可编辑节点创建控件、编辑值经 `dispatchInputValue` 下发 | ❌ 未做 |
| **B4-T3**（原 T3） | **修饰符 + 组件 v-model + 成员路径**：`.lazy/.trim/.number`（宿主值转换）· 组件 `v-model`（`update:modelValue`）· `v-model="o.x"`（成员写） | ❌ 未做 |

**诚实边界**：B4-T1 只交付**回写契约**（产物含 `input` 绑定 + 动作）；**控件未接前 `input` 事件无源 ⇒ 端上输入暂不生效**——故 `VAPOR_VMODEL_NO_INPUT_CONTROL` 诊断**保留**（如实标注缺口，不静默半支持）。

---

## 1. 现状取证

- **下行**：`deps.ts` 把 `v-model="x"` 编成 `text.content` 槽位（`:value`/`:modelValue` → `text.content`）——值→文本可用。
- **回写**：此前**无**（宿主手势层只有 tap/longpress，无输入控件）⇒ 元素上 v-model 产 `VAPOR_VMODEL_NO_WRITEBACK` 诊断。
- **`$event`**：`compileExpr` 把 `$event` 编成 `root('$event')`；`runHandlerActions` 的 `HandlerRunContext.event` 注入其值——**已具备**（组件 emit 用过）。缺的只是"谁来把输入值放进 event"。
- **输入控件**：三端宿主**均无**（iOS 的 `ProteusTextInput` 是**度量输入结构**，非编辑控件）。

---

## 2. B4-T1 设计（已交付）

**编译期**（`packages/compiler/src/vapor/events.ts` 的 `collectEvents`）：扫元素上的 `v-model` ⇒ 除下行（deps 负责）外，**追加一条 `input` 事件绑定**，handler = `[{op:'set', source:<标识符>, program:{k:'root',name:'$event'}}]`。
- **形态限定**（其余诊断，不静默）：**原生元素 + 纯标识符 + 无修饰符**；
  · 组件上 v-model ⇒ 诊断（走组件事件通道，T3）；
  · 成员路径 `o.x` ⇒ 诊断（需成员写，T3）；
  · 修饰符 ⇒ 诊断（需宿主值转换，T3）。
- **命名/位置**：与既有事件同用 `handlerSeq`（`h<N>`，确定性）；`loc` 带源位置。

**运行期**：`runHandlerActions` 已有 `set`/`$event` 语义，**零改动**——`$event` = 输入值即可。

**诊断**（`template.ts`）：`VAPOR_VMODEL_NO_WRITEBACK` → 改名 `VAPOR_VMODEL_NO_INPUT_CONTROL`，措辞更正为"已编成双向，但**端上原生输入控件未接**"（回写契约有了，缺的是控件）。

**验证**：`vapor-events.test.ts`（v-model ⇒ input 绑定 + `set x=$event`；组件/成员/修饰符 ⇒ 诊断不产回写）；`mp-transform.test.ts` 改名对齐；`app-runtime-content` 端到端（产物 `events`/`handlers` 含回写）。

---

## 3. B4-T2 设计（宿主输入控件 · 待做）

### B4-T2a（框架前置 · 已交付）
`ScreenRuntimeInstance.dispatchInputValue(nodeId, value)`：入参**内核 id**（宿主在内核节点上建控件）→ 翻回**内容局部 id**
→ 查 `input` 绑定（`indexEventBindings`）→ 跑 handler（`runHandlerActions`，`$event`=value）→ `refreshData()`（下行随之）。
★不冒泡（输入事件无冒泡语义）。三端宿主共用、可 JSON 测（`screen-runtime.test.ts`：v-model ⇒ `dispatchInputValue` 写回源 + 下行文本更新）。

### B4-T2b（三端原生控件 · 需要）
**需要**：三端宿主在遇到**可编辑文本节点**时创建**原生编辑控件**（Android `EditText` · iOS `UITextField`/`UITextView` · 鸿蒙 `TextInput`），
编辑值变化时调 `dispatchInputValue`（经 JS 侧 `proteusHost` 通道）。

**分工（与既有 native-host / 手势链同构）**：
- 内核/编译期**不改**（回写契约已定；输入节点可由 `semantic`/`kind` 或新的"editable"标记识别）。
- 宿主：识别可编辑节点 → 建控件（复用既有 native-host View 机制 `addNativeHost`/`setNativeHostGeometry`）→ 文本/焦点/IME
  → 编辑值经 `proteusHost.input(nodeId, value)`（新宿主入口，三端同形）→ JS 侧 `rt.instance(cur).dispatchInputValue(nodeId, value)`。
- **判据**：真机编辑输入框 ⇒ 数据变（可核 `data`）+ **下行文本随之变**（几何/文本判据）。

**估时**：≈ 3–5 人日（三端原生控件 + IME/焦点 + 真机判据）。

---

## 4. B4-T3 设计（修饰符/组件/成员 · 待做）

- **修饰符**：`.lazy`（改 `change` 事件）/`.trim`/`.number`（值转换）——转换在**宿主**做（编辑控件最清楚原始值）或编译期加 `transform` 字段。
- **组件 v-model**：`<Kid v-model="x">` ⇒ 编译成 `:model-value="x"` + `@update:model-value="x = $event"`（复用既有组件事件通道 `componentEmit`）。
- **成员路径**：`v-model="o.x"` ⇒ 需**成员写**动作（`setPath`）——运行期 `write` 目前只按标量名。

---

## 5. 顺序 / 边界

1. **B4-T1**（已交付）：回写契约。
2. **B4-T2**：原生输入控件（最高价值，端上真双向）。
3. **B4-T3**：修饰符 / 组件 / 成员。

**不推进**：富文本内联编辑（`contenteditable` 类）——独立大课题，见 B6/能力清单。
