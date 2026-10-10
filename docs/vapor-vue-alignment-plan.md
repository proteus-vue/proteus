# Vapor ⇄ Vue 对齐 · 剩余缺口与推进计划

> **状态**：立项（2026-10-10）。承接「事件-方法」线 T1/T2/T3（决策 #740/#749/#750，**已收口**）。
> **一句话**：Vapor 运行时的**事件/处理器**已基本对齐 Vue；余下缺口集中在**样式动态应用 / 宿主输入 /
> 脚本钩子 / 渲染面**四类，均为**跨内核协议 + 三端宿主**的批次，需逐个立项、不得半做。

---

## 1. 证据（不凭印象——`check:vapor-capability` 棘轮，29 样例页 / 105 条诊断）

| code | 条数 | 本质 | 是否可在**纯 JS**内闭环 |
|---|---|---|---|
| `VAPOR_DYNCLASS_LAYOUT_UNSUPPORTED` | **28** | 动态 `:class` 命中**布局字段**（width/padding/display…）端上不重排 | ❌ 需内核 + 宿主 |
| `VAPOR_KEY_IS_ROW_IDENTITY` | 22 | `:key` 非可更新属性（**info 级，非缺口**） | —（正常） |
| `VAPOR_VMODEL_NO_WRITEBACK` | **22** | App 端 `v-model` **无回写通道**（输入→源） | ❌ 需宿主输入通道 |
| `VAPOR_SCRIPT_LIFECYCLE_NOT_RUN` | 8 | `onMounted` 等**脚本钩子端上不跑**（端上不执行 script） | ◐ 部分（可降级简单钩子体） |
| `VAPOR_DIRECTIVE_NOT_REGISTERED` | 6 | 自定义指令体不执行（架构边界） | ❌ 架构 |
| `VAPOR_DYNCLASS_PLAN_UNMAPPED` | 5 | 动态类计划未映射（**退化到线性回退**，非正确性） | ✅（JS，但仅提速） |
| `VAPOR_TEMPLATE_UNSUPPORTED` | 5 | `v-html`（富文本通道缺失）×3 + `clip-path` 非 JSON ×2 | ❌ 需富文本通道 |
| `VAPOR_STYLE_SELECTOR_UNSUPPORTED` | 3 | `.foo:hover` 等（触摸无 hover） | ❌ 平台语义 |
| `CSE_DYNCLASS_VALUE_EXPLOSION` | 2 | 动态类组合爆炸（生成端拒绝） | ◐ |
| `VAPOR_BUILTIN_PARTIAL` | 2 | `<Teleport>` 传送语义 | ❌ 需宿主多渲染面 |
| `VAPOR_EXPR_UNSUPPORTED` | 1 | 表达式含**白名单外调用**（`!hasAnyEvent()`） | ◐（可加 `@proteus-pure`） |
| `VAPOR_STYLE_DYNAMIC_OBJECT` | 1 | `:style="变量"`（键名编译期不可知） | ◐ 诊断如实 |

---

## 2. 逐项：根因（已探针核实）+ 依赖 + 估时

### B3 · 动态 `:class` **布局字段**端上生效（最高价值 · 28 页）——★**B3a 数值字段已交付（2026-10-10）**
- **B3a 交付（判据 ㉕ · 三端全过）**：**数值型布局字段**（width/height/min|max/flex*/gap/top/left/right/bottom/margin*/padding*/aspectRatio——见 `slot-runtime` 的 `NUMERIC_LAYOUT_FIELDS`）改走**内核二进制 `SET_STYLE`**（host-agnostic：内核重排 ⇒ **三端零宿主改动**即生效）。含**清除回退**（plan 关闭返回 `null` ⇒ 发 UNSET）。内核 `ops_apply::apply_style_key` 补登记 right/bottom/padding 四向/aspectRatio。能力棘轮 28→18。
- **B3b 待做（枚举 / grid 类）**：`display`/`flexDirection`/`position`/`justifyContent`/`alignItems`/`gridTemplateColumns` 等**枚举/字符串**字段——无二进制通道 ⇒ 需**新内核 op（字符串/枚举载荷）+ 三端宿主**（或扩展 `PatchStyle`）。**单独立项。**
- 探针实证依据：plan 产出字段值为 **StyleIR 描述符**（`{kind:'absolute',dp:N}`）+ `padding` **被摊平**成 `paddingTop/…`；运行期此前误统一走 `onPaintProp`（宿主绘制补丁通道，不认布局/描述符）⇒ 端上不生效。
- 估时：B3a **≈1.5 人日（已交付）**；B3b **≈3–4 人日（需内核 + 三端宿主）**。

### B4 · `v-model` 回写（22 页）
- 依赖：宿主**输入通道**（Android EditText / iOS UITextField / 鸿蒙 TextInput）×3 + 双向协议（text→source）。
- 估时：**大（≈4–5 人日）**。

### B5 · 脚本钩子端上执行（8 页）
- 形态实测：`onMounted(() => { … })` 体多为**宿主 API / 循环 / WebSocket**（不在封闭集）。
- 可行子集：把钩子体**降级为动作表**（与事件 handler 同族——复用 `runHandlerActions`），
  在**首帧 mount 后**跑（与 `@vue:mounted` 同一时机）；不可降级体产诊断。
- 估时：**中（≈2 人日）**（复用事件-方法线的降级器；`onUnmounted` 无"卸载时点"，仍诊断）。

### B6·架构边界（**永久具名**，不在路线图内推进）
- `<Teleport>` 真传送（需宿主多渲染面）· `v-html` 富文本（内核单串 + 宿主单次 drawText）·
  自定义指令**体**（端上不执行 script）· `.foo:hover`（触摸无 hover）· `async`/循环事件体。
- 这些是**设计收窄**，诊断如实（不静默），非"待做"。

---

## 3. 建议顺序

1. **B5（脚本钩子，≈2 人日）** —— ✅ **已交付（2026-10-10 · 判据 ㉔ 三端全过）**：复用事件-方法线降级器，
   纯编译期 + 共享执行器（`compileEvents` 产 `scriptLifecycle` → 运行期 `instance.markMounted()/markUnmounted()`）。
2. **B3（动态 class 布局，≈4–6 人日）** —— 价值最高（28 页），但需内核 + 三端宿主，**单独立项**。
3. **B4（v-model 回写，≈4–5 人日）** —— 需三端输入通道，**单独立项**。

**不做**（永久边界，见 §2 B6）。**更上层**（组件实例系统 / JSX / SSR / vdom 互通）见能力清单 P4——
**独立大里程碑**，前置为「组件实例系统」（KeepAlive / composable 的地基）。

---

## 4. 每项的验收定义（模板）

- **证据**：该 code 在 `check:vapor-capability` 基线里的计数**下降**（棘轮只减不增）。
- **三端**：Vapor 面改动 ⇒ 三端重跑 `check:vapor-three-end`（判据 + 指纹逐项一致）。
- **判据**：① 编译期正反（可支持形态编出 / 不可支持诊断带修法）② 运行期共享执行器单测
  ③ **真机**（改写夹具 + 新判据，如判据 ㉓ 的 t2 探针）④ 既有产物逐字节不变（golden）。
- **文档**：能力清单对应行 + guides（中英）+ 计划/决策。
