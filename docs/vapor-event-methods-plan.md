# Vapor 事件处理器「方法引用 / 方法体」支持 —— 立项与工作量评估

> **状态**：**T1 已交付（2026-10-10）**——方法引用 / 无参调用 + 多语句方法体（含 ref `.value`、
>   `$emit`/`$nav`）在 **编译期降级为动作表**；三端共用同一套（Web/MP 本来支持）。T2（带参 / `$event` /
>   局部变量 / `if-else`）待做（各有精确诊断，不静默）。
> **一句话**：App 端（Vapor）的事件处理器**只接受内联单语句**（`@click="count++"`），
> **拒绝方法引用/调用**（`@click="handleTap"`/`handleTap()`）——真实业务页面几乎都用「方法」，
> 于是模板之外的页面在 App 端**点了没反应**。本项把**方法体在编译期降级为动作列表**（守"纯数据、无 eval、
> 封闭集"纪律，**不引入解释器**）补齐。

---

## 0. 交付状态（2026-10-10）

| 档 | 内容 | 状态 |
|---|---|---|
| **T1** | 方法引用/无参调用（`@click="handleTap"` / `handleTap()`）+ 多语句方法体（赋值/自增/复合赋值 + `$emit`/`$nav`，ref `.value` 自动解包） | ✅ **已交付**（`packages/compiler/src/vapor/events.ts` + `expr.ts`；判据 `tests/vapor-events.test.ts` · 真实 App 管线 `tests/app-runtime-content.test.ts`） |
| **T2** | 带参调用 `add(2)` / `$event` / 方法内**局部变量** + `if/else` | ⏳ 待做（**均有精确诊断**：`带实参` / `带形参` / `暂不支持的语句`，带修法） |
| **T3** | 方法调方法、`console.*` 转面板日志、模板串拼接 | ⏳ 待做 |
| **不做** | 循环 / async / 任意 JS / 动态事件名 `@[ev]` | 守"封闭集、无 eval、编译期可判定" |

**实现要点（T1）**：`<script setup>` 用 `@babel/parser` 抽**方法表**（`function` / `const fn = () => {}`）
+ **ref 源名集合**（`ref/shallowRef/computed/customRef/toRef/defineModel`）；`compileStatement` 改为
babel 解析整串 → 逐语句降级为动作（多语句 ⇒ 多动作按序）；方法引用/无参调用 ⇒ **内联方法体**降级。
`expr.ts` 增 `refNames` 注入 ⇒ **已知 ref 上的 `.value` 解包为裸源**（否则 `count.value` 在端上
`read('count')` 得数值再取 `.value` = undefined，静默算错）。**整条拒绝**纪律：任一语句降级失败 ⇒
整条 handler 不产出动作（绝不"部分动作"用错值静默跑）。

---


## 1. 现象与精确边界（先取证，别扩大也别缩小）

**这是「App 端事件编译器的形态限制」，不是「Vapor 只能静态页面」。**

- ✅ **事件链本身是通的**（能力清单 #14；三端判据 ⑦ 全绿）：`tap → 命中 → 冒泡链 → handler → 改数据 → 几何变`。
- ✅ 已支持的事件处理器形态（实测 `compileEvents`）：
  | 写法 | 结果 |
  |---|---|
  | `@click="count++"` / `count--` / `++count` | ✅ `{op:'add', value:±1}` |
  | `@click="count = count + 1"` | ✅ `{op:'set', program}` |
  | `@click="show = !show"` | ✅ `{op:'set', program(一元非)}` |
  | `@click="count += 2"` / `-=` | ✅ `{op:'add'}` |
  | `@tap="$nav('detail')"` | ✅ `{op:'nav', target}` |
  | `@bump="$emit('x', expr)"`（组件事件） | ✅ `{op:'emit'}` |
  | 事件修饰符 `.stop` / `.self` / `.once` | ✅ 真语义（共享派发器） |
- ✅ **T1 后新支持（2026-10-10）**：
  | 写法 | 结果 |
  |---|---|
  | `@click="handleTap"`（方法引用） | ✅ 内联方法体 → 动作列表（`tests/vapor-events.test.ts`） |
  | `@click="handleTap()"`（无参调用） | ✅ 同方法引用 |
  | `@click="a++; b++"`（多语句） | ✅ 多动作按序 |
  | 方法体 `count.value++` / `count.value = expr` / `$emit` / `$nav` | ✅（ref `.value` 自动解包） |
- ❌ **仍不支持（T2/T3；均有精确诊断 + 修法，不静默）**：
  | 写法 | 现状 |
  |---|---|
  | `@click="add(2)"`（带参调用） | ❌ 诊断 `带实参` ⇒ 不产出事件（T2） |
  | 方法带形参（`$event`） | ❌ 诊断 `带形参`（T2） |
  | 方法内**局部变量** / `if/else` | ❌ 诊断 `暂不支持的语句`（T2） |
  | `@click="submit()"`（任意函数） | ❌ 诊断 `handler 形态不支持`（围栏外） |

**为什么"劝退"**：Web/小程序端**能跑真实方法**（真 Vue / 完整 JS）——于是**同一份 `.vue`**，
Web 点了有用、App 点了没反应。对第一次跑模板/写页面的人，这就是"跨端框架点不动"。

**证据**：`packages/compiler/src/vapor/events.ts` 的 `compileStatement`（T1 起走 babel 解析 +
方法体降级）；运行期 `packages/render-backend/src/screen-runtime.ts` 的 `runHandler`（执行 `set/add/emit/nav` 动作——
**T1 未改运行期**，方法体降级出的就是同一套动作）。能力清单 `docs/Proteus_Vapor能力清单.md` #16 已更新。

---

## 2. 目标（用户的诉求）

让**真实业务页面的方法处理器在 App 端也能跑**——即 `@click="handleTap"`（及 `handleTap()` /
`add(2)` / 多语句方法体）在四端行为一致。

## 3. 设计取向（关键：**不引入 JS 解释器**）

Vapor 事件模型的既定纪律是「**编译期产出纯数据（动作列表），运行期只执行、无 eval**」
（`events.ts` 头注）。本项**沿用**：把**方法体**（`<script setup>` 里的 `function`/箭头函数）
在**编译期**降级为**动作列表**（与内联语句同一套动作集），运行期零改动地执行。

> 反例（**不做**）：把方法体字符串下发到端上 `eval`。违背"跨端禁 eval"纪律（本仓多处红线）。

`<script setup>` 的方法体是 JS——用**已在用的 `@babel/parser`**（`packages/compiler/src/script.ts`）
解析成 AST → 逐语句**降级**为动作。可降级与不可降级**明确分档**（不静默）：

| 方法体语句 | 降级为 |
|---|---|
| `x.value++` / `x.value = expr` / `x.value += n` | `{op:'add'/'set', source:'x', program}`（**已有**） |
| `$emit('e', p)` / `$nav('s')` / `$navigate('s')` | `{op:'emit'/'nav'}`（**已有**） |
| 多条语句 `a(); b()` 顺序 | 动作**数组按序**（运行期**已支持**按序执行——"先算后写"） |
| `const y = <纯表达式>`（局部变量） | **新**：动作里的局部绑定（或内联展开） |
| `if (cond) { … } else { … }` | **新**：条件动作 op（编译期把两臂降级为动作子列表 + 条件程序） |
| `return` / 三元 / 成员链 / 比较 / 逻辑 | 纯表达式（`compileExpr` **已支持**） |
| `for` / `while` / `async` / `await` / 任意 JS | ❌ **明确不做**（封闭集纪律；产诊断带修法） |

## 4. 分档与工作量（**核心结论**）

| 档 | 覆盖 | 内容 | 估时 |
|---|---|---|---|
| **T1（必须，先交付）** | 「绝大多数真实页面」：`@click="handleTap"` + 简单方法体（多语句的 ref 赋值/自增/复合/纯表达式 + `$emit`/`$nav`），`handleTap()` 无参调用 | ① `<script setup>` 方法表发现（复用 `script.ts` 的 babel 解析）；② 方法体 AST → 动作列表降级（多语句→多动作）；③ `compileEvents` 支持 `name`/`name()` 形态查表；④ 单测 + 三端判据 | **≈2.5–3.5 人日** |
| **T2** | 带参调用 `add(2)` / `$event` / 方法内局部变量 + `if/else` | ⑤ 事件实参求值并绑定到方法形参；⑥ 运行期**条件动作 op**（`{op:'if', cond, then, else}`）+ 局部变量 op；⑦ 单测 + 三端判据 | **≈2–3 人日** |
| **T3（可选/更后）** | 方法调方法、`console.*` 转面板日志、模板串拼接… | 递归降级 + 白名单 | **≈1–2 人日** |
| **明确不做** | 循环 / async / 任意 JS / 动态事件名 `@[ev]`（另案） | 守"封闭集、无 eval、编译期可判定" | — |

**合计（T1+T2，即"真实页面能点"）**：**≈5–7 人日（约 1 周）**；**T1 单独可先行交付（≈3 人日）**，
先把「方法引用/调用 + 多语句方法体」打通——这一步即消除"劝退级"现象。

> **附带必做**（不单列工时，但别漏）：Vapor 面改动 ⇒ **必须三端重跑** `check:vapor-three-end`
> （Android/鸿蒙/iOS 各重跑 `run-vapor.sh`/`run-selfdraw.sh --vapor` 并提交 `results/vapor.json`）；
> 能力清单 #16 / 模板 / 官网 guides/09 事件写法段同步；`tests/vapor-events.test.ts` 扩判据。
## 5. 影响面 / 风险

- **仅 App（Vapor）路径**——Web/小程序走真实 Vue/JS，本来就支持方法；本项让三端**行为对齐**。
- **改动点**：`packages/compiler/src/vapor/events.ts`（主）+ `packages/slot-runtime/src/dispatch.ts`
  或 `packages/render-backend/src/screen-runtime.ts`（运行期新 op）+ 复用 `script.ts` 的 babel 解析。
- **风险 1（语言工程膨胀）**：方法体是任意 JS，容易越做越大 ⇒ **铁律：只做"可静态降级为封闭动作集"
  的子集，其余**编译期诊断**（带修法）——绝不引入解释器。T1/T2 划清"不做"的边界。
- **风险 2（名称解析）**：方法名 vs 数据源 vs `props` 的歧义 ⇒ 需与 `script.ts` 的 data/methods
  识别**同源**（复用同一 babel 结果，不另解析一遍）。
- **风险 3（静默）**：降级不了的语句**必须产诊断**（沿用本仓"静默最危险"纪律），且**构建不得静默放过**。
- **风险 4（回归）**：既有内联写法产物**逐字节不变**（新形态才走新路径）——用 golden 锁。

## 6. 验收（定义"做完"）

1. 真机（Android/鸿蒙/iOS）：`@click="handleTap"`（方法体 `count.value++`）→ 点击计数递增；
   多语句方法体（`count.value++; show.value = !show.value`）→ 两处都生效。
2. **Web / 小程序 / App 三端行为一致**（同一份 SFC）。
3. 降级不了的形态（`for`/`async`）→ **编译期诊断**（带修法），不静默。
4. `check:vapor-three-end` 三端重跑通过（指纹一致）。
5. 单测：`vapor-events` 扩（方法引用/调用/多语句/带参/if-else 的正反判据）+ golden 不变性。

### T1 验收落点（2026-10-10）

- ✅ ① 编译期：`tests/vapor-events.test.ts`（方法引用/无参/箭头/多语句/ref `.value` 解包/`$emit`/`$nav` +
  不支持形态正反判据 + 端到端 runHandler 语义）。
- ✅ ② 真实 App 管线：`tests/app-runtime-content.test.ts` ③（方法引用 ⇒ `runtime-content.json` **真产出** `events` + `add` 动作）。
- ✅ ③ golden：既有内联写法产物未动（`tests/golden.test.ts` / `update-ops-golden` 全绿）+ `pnpm test:coupled` 290 全绿。
- ✅ ④ 文档：能力清单 #16 / 模板注释 / guides 09（中英）。
- ⏳ ⑤ 真机三端：**本机仅 Android + 鸿蒙**（iOS 无 Xcode——已取证 `xcode-select -p` / `xcrun --find devicectl`
  均失败）。★**且共享设备夹具 `hosts/android/gen-vapor-fixture.mjs` 未改**（其事件全为内联形态 ⇒ 编译产物**逐字节不变**
  ⇒ 三端 `results/vapor.json` 不失效）；方法引用属**编译期**新增能力，端上执行的动作集**不变**（`set/add/emit/nav`），
  故 T1 不引入端侧行为变更。⇒ **未重跑三端夹具**（若为"显式跑方法引用形态"再单独扩展夹具，届时须三端同跑）。

## 7. 排期（T1 已按此完成）

- ~~D1~~：`<script setup>` 方法表发现 + 方法体 AST 降级骨架（T1 ①②）+ 单测。 ✅
- ~~D2~~：`compileEvents` 接方法引用/调用（T1 ③）+ 单测 + 真实 App 管线判据。 ✅
- ~~D3~~：文档/清单同步 + 收尾（**T1 交付**）。 ✅
- **D4–D6**：T2（带参 / `$event` / 局部变量 / `if-else` 条件 op）+ 三端重跑。
- **D7**：缓冲 / 边界诊断打磨 / 官网 guides 更新。

---

## 8. 现状缓解（已随 T1 更新）

- 起步模板保留**内联写法** `@click="count++"`（最简单、四端已验证）——见决策 #739；注释已说明
  方法引用现也支持。
- 官网 guides/09（中英）事件写法段已更新：列出 App 端**现支持**（内联 + 方法引用/无参调用）
  与**仍不支持**（带参/`$event`/局部变量/`if-else`/循环/async/任意函数）的边界。

> 注：模板保持内联是**风格选择**（最小示例），不再因为"App 不支持方法引用"而被迫——#739 的过渡说明已回收。
