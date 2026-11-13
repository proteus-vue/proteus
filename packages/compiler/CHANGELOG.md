# @proteus-vue/compiler

## 0.3.0-beta.39

### Patch Changes

- Updated dependencies
  - @proteus-vue/component-ir@0.3.0-beta.39
  - @proteus-vue/contracts@0.3.0-beta.39
  - @proteus-vue/slot-runtime@0.3.0-beta.39
  - @proteus-vue/types@0.3.0-beta.39

## 0.3.0-beta.37

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/compiler`

## 0.3.0-beta.35

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/compiler`
  - `@proteus-vue/plugin-vite`

## 0.3.0-beta.34

### Minor Changes

- af67734: Vapor 事件处理器「方法引用 / 方法体」支持（T1）——编译期内联方法体 → 动作表

  背景（承接 #740 立项）：App 端（Vapor）事件编译 `compileEvents` 此前**只接受内联单语句**
  （`@click="count++"`），**拒绝方法引用** `@click="handleTap"`——而真实业务页面几乎都写方法。
  于是同一份 `.vue`，Web/小程序能跑、**App 端点不动**（`runtime-content.json` 的 `events` 为空），
  属**三端分叉的劝退级缺口**。

  - **编译期降级（不引入 JS 解释器，守「纯数据 / 无 eval / 封闭集」纪律）**：
    `packages/compiler/src/vapor/events.ts` 的 `compileStatement` 由「只认单条赋值/自增」升级为
    **babel 解析整串 → 逐语句降级为动作**：
    - ✅ **方法引用 / 无参调用**（`@click="handleTap"` / `handleTap()`）⇒ 在 `<script setup>`
      里**内联方法体**并降级（`function` 与 `const fn = () => {}` 都识别）；
    - ✅ **多语句**（`a++; b++`）⇒ 多动作**按序**（运行期本就按序执行）；
    - ✅ 方法体内的 `$emit` / `$nav`（与内联模板**同一套 action，单点实现**）。
  - **ref `.value` 解包**（关键正确性）：方法体写 `count.value++`，而 Vapor 端上 `count` 就是值
    ⇒ 原样编成 `mem(root('count'),'value')` 会**静默算错**（undefined）。`expr.ts` 增 `refNames`
    注入 ⇒ 已知 ref 源（`ref/shallowRef/computed/customRef/toRef/defineModel`）上的 `.value`
    解包为裸源；非 ref 的 `.value` **不受影响**。新增 `compileExprNode` 免二次解析。
  - **整条拒绝纪律**：任一语句降级失败 ⇒ **整条 handler 不产出动作**（绝不「部分动作」用错值静默跑）。
  - **仍拒绝（精确诊断 + 修法，T2 待做）**：带实参调用 `add(2)`、方法形参 `$event`、
    方法内**局部变量声明**、`if/else`、循环 / async / 任意函数。
  - **验证**：`tests/vapor-events.test.ts` +14（含端到端 runHandler 语义）· 真实 App 管线
    `tests/app-runtime-content.test.ts` ③（方法引用 ⇒ 真产出 `events` + `add` 动作）·
    `test:coupled` 全绿 · golden 全绿（**既有内联产物逐字节不变**）。
  - **文档**：能力清单 #16「❌ 诊断拒绝」→「◐ 部分支持（#740 T1）」；guides 09（zh + EN）
    事件写法段列出支持/仍不支持边界。

  去端：改动**只在编译期**，端上执行的动作集不变（`set/add/emit/nav`）⇒ 共享设备夹具产物**逐字节不变**
  （已用 clean-tree 复算取证），三端 `results/vapor.json` 不失效。

- 90cdec6: Vapor 事件处理器 T2：带参调用 / 方法形参 / 方法内局部变量 / `if-else`（编译期降级 + 共享执行器）

  承接决策 #740 T1（方法引用/无参）。T2 把**真实业务方法体**再补一档，四端行为对齐：

  - **带实参调用** `@click="add(2)"`：实参（纯表达式）降级为 **`let` 形参绑定**（方法级作用域）；
  - **方法形参**：`function add(n) {…}` 的形参在编译期绑为 `let n = <实参>`；
  - **方法内局部变量** `const step = n * 2` ⇒ `let step`；
  - **`if (cond) {…} else {…}`** ⇒ **`if` 条件动作**（两臂降级为动作子列表 + 条件程序）。

  【★ 契约与执行器下沉到消费端（一处实现）】动作**契约**（`HandlerAction`，含 `let`/`if`）与
  **执行器**（`runHandlerActions`）下沉到 `@proteus-vue/slot-runtime`（编译器 import 契约、
  `render-backend/screen-runtime` 与 `entry-vapor` 共用执行器）——避免两处手写 set/add 循环漂移。
  执行器用**作用域链**承接 `let`（方法级在外层、`if` 臂各成子层——与 JS 块级一致），
  `$event` 由 `event` 注入（`read('$event')`）。

  【仍「明确不做」（编译期诊断，不静默）】循环 / `async`·`await`（有微任务时序语义，同步执行器不建模）/
  任意函数（`console.log(...)`）。

  验证：

  - 单测：`tests/handler-actions.test.ts`（执行器：set/add/let 遮蔽/if 两臂/$event/emit-nav，8 例）·
    `vapor-events`（+ T2 编译期 6 例：带参 let 绑定 / 局部 let / if 两臂 / 实参个数不符诊断 / 循环·async 拒）·
    `app-runtime-content` ④（真实 App 管线编出 `let`/`if`）。
  - 三端真机判据 **㉓**（`check-vapor-device.py`）：t2 夹具连跑 3 次，源值 + **内核几何宽**走过
    `[0,6,12,0]`（else→else→then）——Android/鸿蒙/iOS **三端全过** + `check:vapor-three-end` 指纹一致。
  - 全量 5646 通过；`test:coupled` 绿。

- fe645a6: Vapor 事件 T3：`console.*` 转面板日志（新 `log` 动作）+ 补齐方法调方法/模板串判据

  承接 T1/T2（方法引用/方法体）。T3 收口「事件-方法」这条线向 Vue 对齐：

  - **`console.{log,info,warn,error,debug}(…)`** —— 编译期降级为 **`log` 动作**（`programs` 各实参
    的求值程序，运行期求值交 `onLog` 出口）。真实方法体几乎都带 `console` 调试，而 App 端不执行
    script ⇒ 此前整条调用被拒（**点了没反应**）。
    - `screen-runtime` / `superapp-runtime` 增 `onLog` 出口（缺省转 `onNote`——面板可归类；dev 面板
      可另接到 Console 页，保留 level）。
    - 其余 `console.*`（`table`/`time`/…）⇒ 明确诊断（封闭集）。
  - **方法调方法 / 模板串**：核验后**本已可用**（递归内联 / `compileExpr`），补判据锁定（不再只靠"没有诊断"）。

  验证：`tests/handler-actions.test.ts` ⑦（log 求值交 onLog）· `vapor-events` T3 组（log 动作 / 各级别 /
  `console.table` 诊断 / 方法调方法）· **三端真机判据 ㉓**（T2 夹具方法体加 `console.log`；`t2_probe.logs`
  逐次 3 条，Android/鸿蒙/iOS 全过 + `check:vapor-three-end` 指纹一致）· 全量 5651 · vue-tsc 0。
  文档：能力清单 #16 / guides 09（中英）/ 计划（T3 收口）。

- 037281a: Vapor B5：脚本级生命周期钩子 `onMounted` / `onUnmounted` 降级为动作表（端上真执行）

  背景（对齐计划 B5，承接事件-方法线 T1/T2/T3）：App 端**不执行 script** ⇒ 此前 `<script setup>` 的
  `onMounted(() => { … })` 里的逻辑**永不运行**（只产 `VAPOR_SCRIPT_LIFECYCLE_NOT_RUN` 诊断）。
  真实页面用 `onMounted` 做初始化很常见 ⇒ 这是「点了/进了页面没反应」的一类。

  - **编译期**（`compileEvents`）：`<script setup>` 顶层 `onMounted(() => {…})` / `onUnmounted(() => {…})`
    的**回调体降级为动作表**（复用事件-方法线同一降级器 `degradeStatements` + 同一执行器 `runHandlerActions`），
    发射新产物 **`scriptLifecycle`**（`{phase:'mounted'|'unmounted', handler}`；缺省省略 ⇒ 既有产物不变）。
    可降级体 ⇒ 端上真跑；**不可降级体**（循环 / async / 宿主 API）⇒ **精确诊断**（不静默）。空体 ⇒ 不产出、无诊断。
  - **运行期**（`render-backend`）：`screen-runtime` 的 `ScreenRuntimeInstance` 增 `markMounted()`（首帧 mount 后，
    **幂等**）与 `markUnmounted()`；`superapp-runtime` 在 `mountScreen`/`mountScreenInto` 成功后自动 `markMounted()`，
    并暴露 `markUnmounted(screen?)`。同时**打通 App 壳的 `@vue:mounted`**（此前壳路径完全没接 lifecycle）。
  - **产物**（`cli/app-runtime-content`）：`lifecycle` + `scriptLifecycle` 随 `runtime-content.json` 下发。
  - **诊断修正**：`onMounted`/`onUnmounted` 从「不会运行」诊断列表移除（它们现在会运行）；其余钩子保留。

  验证：`vapor-events` B5 组（mounted/unmounted 降级 / 空体 no-op / 循环诊断 / 与 `@vue:mounted` 同形态）·
  `vapor-lifecycle`（不再报 NOT_RUN + 其余钩子仍报）· `screen-runtime` ⑤（markMounted 改数据 0→99、幂等、
  markUnmounted 0）· **三端真机判据 ㉔**（b5 夹具 `b5x` 值/几何 `[0,88,0]`，Android/鸿蒙/iOS 全过 +
  `check:vapor-three-end` 指纹一致）· 全量 5657 · vue-tsc 0。

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/agent`
  - `@proteus-vue/animation`
  - `@proteus-vue/api`
  - `@proteus-vue/built-in-components`
  - `@proteus-vue/cli`
  - `@proteus-vue/compiler`
  - `@proteus-vue/component-ir`
  - `@proteus-vue/components`
  - `@proteus-vue/consistency`
  - `@proteus-vue/contracts`
  - `@proteus-vue/create-proteus`
  - `@proteus-vue/devtools`
  - `@proteus-vue/glass`
  - `@proteus-vue/layout-core`
  - `@proteus-vue/mcp`
  - `@proteus-vue/plugin-vite`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/renderer-app`
  - `@proteus-vue/router`
  - `@proteus-vue/runtime`
  - `@proteus-vue/shared`
  - `@proteus-vue/slot-runtime`
  - `@proteus-vue/types`

- 外部实战报告第 13-15 轮缺陷收口（F-36~F-43，8 条）：

  **compiler**

  - F-39：`p-fluid` 表达式支持 `var()` / 百分比 / auto 实参（原样透传，不再静默剥离）。
    根因是 `parseFluidExpr` 有两处完全相同的实现（`fluid-layout.ts` + `template.ts`），
    模板用的是后者——已收敛为唯一实现。
  - F-40：MP 产物从裸 `calc()` 改为 `clamp(min, calc(...), max)` 两端夹取。
    实测依据：1600 宽原出 33.8px（应 32）；`designWidth=1280` 时 390 宽只有 3.31px（应 ≥20）。
  - F-38A：`defineEmits<泛型>()` 不再被当普通初始化落 `data.emit=undefined`
    （组件事件此前在 MP 端全部静默失效）。
  - F-38B：`v-for` 作用域内的参数化 handler（`run(a.key)` / `run(a)` / `(e)=>run(a)`）
    改用 `data-*` 传参包装方法，产物不再是非法处理器名。

  **components**

  - F-36：三个组件不再直连平台全局 `getCurrentPages`，收敛到 `runtime/page-route.ts`
    的 `currentPageRoute()`（只依赖 `adapter` 抽象）——消费者 `vue-tsc` 不再报 TS2304。
  - F-42/F-43：`p-adaptive` 在 MP 端接线尺寸测量（`mpContainerObserverFactory`）。
    此前 onMounted 首行「元素空就 return」在 MP 端必然命中 ⇒ controller 从不创建 ⇒ 整段逻辑被跳过。
  - F-41：`p-grid` 新增 `minColWidthMin` + `minColWidthVw`，支持 `max(96px, min(142px, 22vw))`
    式流式下限（纯 CSS、零运行时），窄屏列数可与手写断点方案对齐。

  **plugin-vite**

  - F-37：`cse-lint` / `profile-boundary` 两道样式门禁不再检查 `node_modules`。
    此前消费者引用任一 `p-*` 组件都会被框架自家组件判 error ⇒ 构建被封死。
    语义边界：门禁约束消费者源码写法，已发布依赖的合规由框架仓库 CI 保证。

- 6d737f1: Vapor B3b：动态 `:class` 的**枚举布局字段**端上真生效（索引编码走内核二进制 SET_STYLE）

  承接 B3a（数值字段）。B3b 把**枚举布局字段**也用同一条 host-agnostic 通道生效：

  - `display`/`flexDirection`/`flexWrap`/`position`/`overflow`/`alignItems`（`ENUM_LAYOUT_FIELDS`）的
    字符串值 → **索引编码**（f32），走内核二进制 `SET_STYLE`（与 `:width` 等同通道，零宿主改动）。
  - **内核**（`layout-core-rust/ops_apply::apply_style_key`）：新增按索引解码的臂（display 升级为
    0=flex/1=grid/2=none；flexDirection/flexWrap/position/overflow/alignItems 各自索引表，**与 JS
    `ENUM_LAYOUT_FIELDS` 同序**——跨语言契约）。
  - **清除回退**：plan 关闭该类 ⇒ 枚举发**默认索引**（如 alignItems→stretch、flexDirection→column）。
  - **编译器**：诊断收窄——数值 + 枚举（白名单）不再诊断；仅无二进制通道的（grid 模板 / lineClamp /
    whiteSpace / wordBreak / overflowX/Y / justify\* / alignContent / alignSelf）诊断。

  验证：`vapor-sfc-to-tree` ⑦（display grid=1 / flexDirection row=0 / alignItems center=7 发内核
  SET_STYLE）+ Rust 单测（索引解码臂）· **三端真机判据 ㉖**（`.hrow{flex-direction:row}` 子 2 x
  `[0,120,0]`：column→row→column，Android/鸿蒙/iOS 全过 + `check:vapor-three-end` 指纹一致）·
  全量 5659 · vue-tsc 0。能力棘轮 `VAPOR_DYNCLASS_LAYOUT_UNSUPPORTED` **18→10**（已落账）。
  ★B3c（grid/whiteSpace/wordBreak/overflowX-Y 等）留后续。

- 0245809: Vapor B3c：动态 `:class` 补 `justifyContent`/`alignContent`/`alignSelf`（索引编码走内核 SET_STYLE）

  承接 B3a（数值）/ B3b（枚举）。B3c 把内核**字符串布局字段** `justify-content`/`align-content`/
  `align-self` 也索引编码（同一 host-agnostic 二进制通道）：

  - `ENUM_LAYOUT_FIELDS` 增三项（值表含 CSS 别名 `start`/`end`；`alignSelf` 0=auto ⇒ 清空回落父）。
  - 内核 `apply_style_key` 加索引解码臂（与 JS 表逐字同序，值 = `taffy_engine::parse_justify`/
    `parse_align_content`/`parse_align_items` 接受的字符串）。
  - 编译器诊断收窄（`justifyContent`/`alignContent`/`alignSelf` 不再诊断）。

  验证：`vapor-sfc-to-tree` ⑦（justify-content center=4 / align-self end=4 发内核 SET_STYLE）+
  Rust 单测 · **三端真机判据 ㉖ 扩展**（`.hrow{flex-direction:row; justify-content:center}` 子 2 x
  `[0,200,0]`——含 justify-content 居中；Android/鸿蒙/iOS 全过 + `check:vapor-three-end` 指纹一致）·
  全量 5659 · vue-tsc 0。能力棘轮 `VAPOR_DYNCLASS_LAYOUT_UNSUPPORTED` **10→8**（已落账）。
  ★ 仍待做：grid 模板（字符串 token 串，需新内核 op）· whiteSpace/wordBreak · overflowX/Y（内核无轴级字段）。

- c5a6e5f: Vapor B3a：动态 `:class` 的**数值布局字段**端上真生效（走内核二进制 SET_STYLE · 零宿主改动）

  背景（对齐计划 B3）：动态 `:class` 命中的**布局字段**端上不生效（诊断 `DYNCLASS_LAYOUT_UNSUPPORTED`，
  28 页命中）。探针实证根因：plan 产出字段值为 **StyleIR 描述符**（`{kind:'absolute',dp:N}`），
  运行期把它们统一经 `onPaintProp` 交给宿主**绘制**补丁通道——而该通道不认布局/描述符 ⇒ 不重排。

  - **运行期**（`slot-runtime/runtime`）：`paint.class` 字段**分流**——**数值布局字段**
    （`NUMERIC_LAYOUT_FIELDS`：width/height/min|max/flex*/gap/top/left/right/bottom/margin*/padding\*/
    aspectRatio）改走**内核二进制 `SET_STYLE`**（host-agnostic：内核重排 ⇒ **三端零宿主改动**即生效）；
    其余（绘制色/字号/圆角…）仍走 `onPaintProp`。★**清除回退**：plan 关闭该类返回 `null` ⇒ 发 `UNSET`
    （NaN ⇒ 内核 `None`）。`layoutNumber` 解包描述符/原始数。class 块守卫**不再要求 `onPaintProp`**。
  - **内核**（`layout-core-rust/ops_apply::apply_style_key`）：补登记 `right`/`bottom`/`padding` 四向/
    `aspectRatio`（`LStyle` 早已有这些字段，指令映射表此前漏登记）。
  - **编译器**（`vapor/build`）：诊断收窄——**数值布局字段不再诊断**；仅对**无二进制通道**的布局字段
    （枚举 `display`/`flexDirection`… · grid）诊断（`padding`/`margin` 对象在 plan 里已摊平为数值 ⇒ 视为支持）。

  验证：`vapor-sfc-to-tree` ⑥（数值字段发内核 SET_STYLE、**不进** onPaintProp；数值无诊断/枚举仍诊断）·
  `layout-core-rust` Rust 单测（新映射臂）· **三端真机判据 ㉕**（动态 :class 数值布局字段几何 `[0,200,0]`：
  关 → 开 → 关，Android/鸿蒙/iOS 全过 + `check:vapor-three-end` 指纹一致）· 全量 5658 · vue-tsc 0。
  能力棘轮改善：`VAPOR_DYNCLASS_LAYOUT_UNSUPPORTED` **28→18**（已 `--update` 落账）。
  ★B3b（枚举/grid 类布局字段）需**新内核 op + 三端宿主**，留后续。

- Updated dependencies
- Updated dependencies [3492f53]
- Updated dependencies [c9d830b]
- Updated dependencies [6d737f1]
- Updated dependencies [0245809]
- Updated dependencies [c5a6e5f]
- Updated dependencies [90cdec6]
- Updated dependencies [fe645a6]
  - @proteus-vue/component-ir@0.3.0-beta.34
  - @proteus-vue/contracts@0.3.0-beta.34
  - @proteus-vue/slot-runtime@0.3.0-beta.34
  - @proteus-vue/types@0.3.0-beta.34

## 0.3.0-beta.31

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/cli`
  - `@proteus-vue/compiler`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/slot-runtime`

- Updated dependencies
  - @proteus-vue/slot-runtime@0.3.0-beta.31
  - @proteus-vue/component-ir@0.3.0-beta.31

## 0.3.0-beta.28

### Patch Changes

- 全量重发（scripts/release.mjs --all）：把全部包的 `latest` tag 归位到当前版本。
  动机——npm 强制每包须有 `latest`，而事后改 tag（npm dist-tag）属包管理操作、
  会被要求交互式 2FA；发布时设置 tag 不受此限，故重发是零手工的归位路径。

  - `@proteus-vue/agent`
  - `@proteus-vue/animation`
  - `@proteus-vue/api`
  - `@proteus-vue/app-config`
  - `@proteus-vue/built-in-components`
  - `@proteus-vue/capabilities`
  - `@proteus-vue/cli`
  - `@proteus-vue/compat-miniprogram`
  - `@proteus-vue/compiler`
  - `@proteus-vue/compiler-backend`
  - `@proteus-vue/compiler-backend-rust`
  - `@proteus-vue/component-ir`
  - `@proteus-vue/components`
  - `@proteus-vue/consistency`
  - `@proteus-vue/contracts`
  - `@proteus-vue/create-proteus`
  - `@proteus-vue/css-compat`
  - `@proteus-vue/desktop`
  - `@proteus-vue/dev-host`
  - `@proteus-vue/devtools`
  - `@proteus-vue/devtools-runtime`
  - `@proteus-vue/docs`
  - `@proteus-vue/fluid`
  - `@proteus-vue/gesture`
  - `@proteus-vue/glass`
  - `@proteus-vue/hmr`
  - `@proteus-vue/i18n`
  - `@proteus-vue/layout-core`
  - `@proteus-vue/mcp`
  - `@proteus-vue/module`
  - `@proteus-vue/pinia-sync`
  - `@proteus-vue/plugin-vite`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/renderer-app`
  - `@proteus-vue/router`
  - `@proteus-vue/runtime`
  - `@proteus-vue/security`
  - `@proteus-vue/shared`
  - `@proteus-vue/slot-runtime`
  - `@proteus-vue/style-safety`
  - `@proteus-vue/test-core`
  - `@proteus-vue/test-ir`
  - `@proteus-vue/types`
  - `@proteus-vue/web`
  - `@proteus-vue/worklet`

- Updated dependencies
  - @proteus-vue/component-ir@0.3.0-beta.28
  - @proteus-vue/contracts@0.3.0-beta.28
  - @proteus-vue/slot-runtime@0.3.0-beta.28
  - @proteus-vue/types@0.3.0-beta.28

## 0.3.0-beta.24

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/cli`
  - `@proteus-vue/compiler`
  - `@proteus-vue/plugin-vite`

## 0.3.0-beta.23

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/agent`
  - `@proteus-vue/api`
  - `@proteus-vue/app-config`
  - `@proteus-vue/built-in-components`
  - `@proteus-vue/capabilities`
  - `@proteus-vue/cli`
  - `@proteus-vue/compiler`
  - `@proteus-vue/compiler-backend-rust`
  - `@proteus-vue/component-ir`
  - `@proteus-vue/components`
  - `@proteus-vue/contracts`
  - `@proteus-vue/create-proteus`
  - `@proteus-vue/css-compat`
  - `@proteus-vue/devtools`
  - `@proteus-vue/fluid`
  - `@proteus-vue/layout-core`
  - `@proteus-vue/mcp`
  - `@proteus-vue/plugin-vite`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/renderer-app`
  - `@proteus-vue/router`
  - `@proteus-vue/runtime`
  - `@proteus-vue/shared`
  - `@proteus-vue/slot-runtime`
  - `@proteus-vue/style-safety`
  - `@proteus-vue/types`
  - `@proteus-vue/web`
  - `@proteus-vue/worklet`

- Updated dependencies
  - @proteus-vue/component-ir@0.3.0-beta.23
  - @proteus-vue/contracts@0.3.0-beta.23
  - @proteus-vue/slot-runtime@0.3.0-beta.23
  - @proteus-vue/types@0.3.0-beta.23

## 0.3.0-beta.21

### Patch Changes

- Updated dependencies
  - @proteus-vue/component-ir@0.3.0-beta.21

## 0.3.0-beta.19

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/compiler`

## 0.3.0-beta.15

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/compiler`
  - `@proteus-vue/components`

## 0.3.0-beta.12

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/built-in-components`
  - `@proteus-vue/compiler`
  - `@proteus-vue/types`

- Updated dependencies
  - @proteus-vue/types@0.3.0-beta.12

## 0.3.0-beta.11

### Patch Changes

- @proteus-vue/component-ir@0.3.0-beta.11
- @proteus-vue/contracts@0.3.0-beta.11
- @proteus-vue/types@0.3.0-beta.11

## 0.3.0-beta.10

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/compiler`
  - @proteus-vue/component-ir@0.3.0-beta.10
  - @proteus-vue/contracts@0.3.0-beta.10
  - @proteus-vue/types@0.3.0-beta.10

## 0.3.0-beta.9

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/compiler`
  - @proteus-vue/component-ir@0.3.0-beta.9
  - @proteus-vue/contracts@0.3.0-beta.9
  - @proteus-vue/types@0.3.0-beta.9

## 0.3.0-beta.8

### Patch Changes

- Updated dependencies
  - @proteus-vue/types@0.3.0-beta.8
  - @proteus-vue/component-ir@0.3.0-beta.8
  - @proteus-vue/contracts@0.3.0-beta.8

## 0.3.0-beta.7

### Patch Changes

- 全量重发（scripts/release.mjs --all）：把全部包的 `latest` tag 归位到当前版本。
  动机——npm 强制每包须有 `latest`，而事后改 tag（npm dist-tag）属包管理操作、
  会被要求交互式 2FA；发布时设置 tag 不受此限，故重发是零手工的归位路径。

  - `@proteus-vue/agent`
  - `@proteus-vue/api`
  - `@proteus-vue/app-config`
  - `@proteus-vue/built-in-components`
  - `@proteus-vue/capabilities`
  - `@proteus-vue/cli`
  - `@proteus-vue/compat-miniprogram`
  - `@proteus-vue/compiler`
  - `@proteus-vue/compiler-backend`
  - `@proteus-vue/compiler-backend-rust`
  - `@proteus-vue/component-ir`
  - `@proteus-vue/components`
  - `@proteus-vue/contracts`
  - `@proteus-vue/create-proteus`
  - `@proteus-vue/css-compat`
  - `@proteus-vue/desktop`
  - `@proteus-vue/dev-host`
  - `@proteus-vue/devtools`
  - `@proteus-vue/devtools-runtime`
  - `@proteus-vue/docs`
  - `@proteus-vue/fluid`
  - `@proteus-vue/gesture`
  - `@proteus-vue/glass`
  - `@proteus-vue/hmr`
  - `@proteus-vue/i18n`
  - `@proteus-vue/mcp`
  - `@proteus-vue/module`
  - `@proteus-vue/pinia-sync`
  - `@proteus-vue/plugin-vite`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/renderer-app`
  - `@proteus-vue/router`
  - `@proteus-vue/runtime`
  - `@proteus-vue/security`
  - `@proteus-vue/shared`
  - `@proteus-vue/style-safety`
  - `@proteus-vue/test-core`
  - `@proteus-vue/test-ir`
  - `@proteus-vue/types`
  - `@proteus-vue/web`
  - `@proteus-vue/worklet`

- Updated dependencies
  - @proteus-vue/component-ir@0.3.0-beta.7
  - @proteus-vue/contracts@0.3.0-beta.7
  - @proteus-vue/types@0.3.0-beta.7

## 0.3.0-beta.3

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @proteus-vue/component-ir@0.2.0-beta.1
  - @proteus-vue/contracts@0.1.1-beta.0
  - @proteus-vue/types@0.2.0-beta.2

## 0.3.0-beta.2

### Patch Changes

- Updated dependencies
  - @proteus-vue/types@0.2.0-beta.1

## 0.3.0-beta.1

### Minor Changes

- 编译器静默陷阱治理 + 事件名单段归一（真机驱动）

  - **静默陷阱告警**：顶层 `let x = <非 null 初值>` 被丢弃（→ 方法体引用抛 `ReferenceError`）、模板表达式内函数调用（WXML 不支持，崩事件链）、`:class` 通道漏后缀等此前**完全静默**的失败，现编译期告警并全仓扫修。
  - **事件名单段归一**：父级手写 `@update:{arg}` 归一为 `bind:update-{arg}`（与子组件 `triggerEvent('update-{arg}')` 同口径）——此前产出双冒号 `bind:update:show`，与子组件**永不匹配**（真机弹层遮罩点击关不掉的根因）。
  - 新规则登记：`script/element-probe`（元素探针注入，见对应 changeset）。

- 框架元素探针：打通「框架 API ↔ 测试数据屏障」（跨端自动化测试降级通道）

  - **`@proteus-vue/runtime`**：新增元素探针注册表（`recordProbe` / `readProbes` / `clearProbes` / `probeEnabled`，全局 `__PROTEUS_PROBES__`，跨端纯 JSON）。
  - **`@proteus-vue/compiler`**：组件 `ready()` 注入自测量——`wx.createSelectorQuery().in(this).select(.<tag>-scopeId)` 取 `boundingClientRect` + `scrollOffset` + `computedStyle` 写注册表（+150ms 二次重测兜首帧）；页面 `onLoad` 复位注册表（同页 key 稳定），`PROTEUS_DEBUG` 构建默认开启。新规则 `script/element-probe`（可禁用）。`ScriptTransformOptions` 增 `scopeId`。
  - **`@proteus-vue/test-core`**：`driver.probes(pid?)` / `driver.enableProbes()`（MP + Web 双端同 API）+ 契约断言原语 `assertProbeScrollable` / `assertProbeGeometry` / `assertProbeVisible` / `getProbe`。
  - **`@proteus-vue/api`**：`useElement`（C58）在工具查询落空时**回落读探针注册表**——框架 API 也能读组件内部节点。
  - **起因**：自动化工具只能查页面拥有的节点（glass-easel 组件内部隔离；Skyline 无 `selectAllComponents`）→ 组件内部几何/可见性/可滚性无法断言（本项目一个横向 scroll-view 容器塌陷漏检两轮）。测量必须从组件内部发起，本通道让断言面不再受运行时 DOM 隔离限制。

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @proteus-vue/types@0.1.1-beta.0
  - @proteus-vue/component-ir@0.1.1-beta.0

## 0.3.0-beta.0

### Minor Changes

- ae60825: 底线整改：AI-native 透明框架分派层 + 漂移门禁 + 路由透明化

  - `@proteus-vue/compiler`：规则注册表升级为**分派层**（阶段三落地）——`executeRule(id, ctx)` + 规则 `apply()`（style/px-to-rpx、template/scope-attr 已登记示范）；AI 覆盖规则实现 → 编译输出即时变化（底线循环 ① 完全形态）
  - 实现 ↔ 注册表**反向漂移门禁**（tests/registry-drift）：实现引用的规则 ID 必须全部已登记，新转换决策漏登记当场报错
  - `@proteus-vue/router`：路由生成规则注册表（route/scan、path-derive、parent-explicit 等 7 条 AI 说明书）+ `--trace-router` 闭环（buildRouteTree/runGenRoutes 输出嵌套推导决策链）

## 0.2.0

### Minor Changes

- v0.2 工程化基线完成：编译引擎独立包（monorepo）、CLI（build/explain/rules）、脚手架、CI、贡献设施。
