# @proteus-vue/slot-runtime

## 0.3.0-beta.39

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/agent`
  - `@proteus-vue/animation`
  - `@proteus-vue/api`
  - `@proteus-vue/app-config`
  - `@proteus-vue/built-in-components`
  - `@proteus-vue/capabilities`
  - `@proteus-vue/compat-miniprogram`
  - `@proteus-vue/compiler-backend`
  - `@proteus-vue/compiler-backend-rust`
  - `@proteus-vue/component-ir`
  - `@proteus-vue/components`
  - `@proteus-vue/consistency`
  - `@proteus-vue/contracts`
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
  - `@proteus-vue/icons`
  - `@proteus-vue/layout-core`
  - `@proteus-vue/mcp`
  - `@proteus-vue/module`
  - `@proteus-vue/pinia-sync`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/renderer-app`
  - `@proteus-vue/request`
  - `@proteus-vue/router`
  - `@proteus-vue/runtime`
  - `@proteus-vue/security`
  - `@proteus-vue/shader`
  - `@proteus-vue/shared`
  - `@proteus-vue/slot-runtime`
  - `@proteus-vue/style-safety`
  - `@proteus-vue/test-ir`
  - `@proteus-vue/tokens`
  - `@proteus-vue/types`
  - `@proteus-vue/web`
  - `@proteus-vue/worklet`

## 0.3.0-beta.34

### Minor Changes

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

- 3492f53: 修 App 文本归一化把混排（元素/文本交错）的首尾空格 trim 掉（判据 ㉑ 三端红）

  背景（用户：「刚才的 iOS 21 问题能修复吗？」）：Vapor 三端门禁判据 ㉑（元素/文本混排）
  在 iOS 真机失败，且是**共享实例化**的回归（Android/鸿蒙同样受影响、只是证据陈旧未暴露）。

  根因：`packages/slot-runtime/src/instantiate.ts` 的 `normalizeWhiteSpace`（`a982c849` 加，
  为修"案例 C：`\n` 应折叠为空格"）在 **normal 分支里对每个文本叶 `.trim()`**：

  ```
  return text.replace(/\s+/g, ' ').trim()   // ✗ 逐叶 trim
  ```

  混排的合成叶 `"mix "` / `" tail"` / 独立空格叶 `" "` 的**首尾空格是行内内容**（Web 里与相邻
  inline 之间存在一个空格）——逐叶 trim 把它删掉 ⇒ 渲染成 `mixMIXBtail`、空格叶变空（实测同源
  leaf 全部无空格、宽度变满宽 390）。

  修法：**collapse-only，不 trim**——`return text.replace(/\s+/g, ' ')`。
  理由：编译期已按 Vue `condense` 归一**模板**空白（并把它切成**有意保留**的合成叶）；
  数据里的 `\n`/连续空格/制表在运行期**折叠**即可。Web 的"行首尾空白移除"是**行级**语义
  （依赖整行 inline 上下文），不该由**逐节点**归一化承担（错误的责任层级）。★ 案例 C 的
  `\n` 折叠**不变**，无回归。

  验证（真机）：三端 `results/vapor.json` **重新真机生成**——iOS/Android/鸿蒙 ㉑ 全绿
  （`mix |MIXB| tail|int=4 |MIXI|SPA| |SPB`，8/8 叶有宽度）；`check:vapor-three-end` 三端
  指纹一致；`tests/whitespace-normalize.test.ts` +⑥（混排首尾空格保留）+ 全量 5620 通过。
  ★ 并更正：此前三端门禁的绿灯**倚在陈旧 iOS 证据**上（iOS 从未复跑），现为**真机新证据**。

- c9d830b: 补齐运行期事件/产物契约的两个字段（修根 `vue-tsc` 长期 11 条红 · 类型面漂移）

  背景：根 `npx vue-tsc --noEmit` 长期 11 条红（CI「类型检查（vue-tsc 全项目）」步骤恒失败），
  非新改动引入。根因是**决策 #712/#713（source map）给运行期加了字段、却没同步**该字段所在的**类型面**：

  - `@proteus-vue/slot-runtime` `EventBinding` 缺 `loc?`：编译器 `compileEvents` **发射** `loc`
    （模板源位置），运行期 `screen-runtime` 也**读取**它（`locByHandler`）；消费方（测试）读
    `ev.loc` 报 `Property 'loc' does not exist`。⇒ 补 `loc?: { line: number; column: number }`。
  - `@proteus-vue/render-backend` `ScreenRuntimeArtifact` 缺 `file?`：CLI `app-runtime-content.ts`
    产该字段（dev 屏源路径），本接口注释写"与 CLI 同形"却漏了它 ⇒ 消费方读 `art.file` 报
    `Property 'file' does not exist`。⇒ 补 `file?: string`。

  （另修 3 处测试自身的类型问题：`cli-doctor` 假 ctx 补 `findIosProfile`（`DoctorContext` 的
  required 原语，`#688` 加入）；`mcp-stdio` 的 `resultText` 收窄 + `process.env` 过滤 undefined；
  `vapor-events` 一处 `as unknown as` 中转。）

  验证：根 `vue-tsc --noEmit` 0 error（原 11）；examples/showcase/css-conformance 三个 typecheck
  域 0 error；全量 5620 通过；`test:coupled` 绿。

## 0.3.0-beta.31

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/cli`
  - `@proteus-vue/compiler`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/slot-runtime`

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
