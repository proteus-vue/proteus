# Proteus Session Memory（会话记忆）

## 2026-09-08 立 · ★★立项：编译器 Vue API 能力对齐（严重框架缺口——用户裁定先立项）

### 起因
p-popover 方案 A 用 `getCurrentInstance()`（拿组件实例作 `.in(组件)` scope）→ MP 编译产物 `getCurrentInstance is not defined`（ReferenceError，真机 console 实抓）。用户裁定：**这是编译器连基础 Vue API 都没对齐的严重问题，先立项解决**，不再在 popover 上打补丁。

### 立项（docs/proteus-compiler-vue-align-plan/）
- 根因：编译器**逐 API 白名单语义翻译**（ref→data/watch→observers/computed→proteusCalcX/onMounted→onReady/defineProps→properties/provide-inject→注册表/Pinia→$subscribe 桥……register 在 `transforms/script.ts` SCRIPT_RULES）；**没注册的 Vue API 无处理路径，且编译器不留 `import 'vue'`（响应式内联编译）** → 未翻译的 Vue 导出在产物裸奔/not defined。
- 差距面（02-api-gap）：P0 会崩 = `getCurrentInstance`/`useSlots`/`useAttrs`/`nextTick`/`watchEffect*`；P1 = `computed` setter/`toRef*`/`isRef` 等/生命周期不全/`useModel`；P2 = `h`/`createApp`/`render`/`EffectScope`/`markRaw`/`defineOptions`/`onErrorCaptured` 等（动态渲染=框架非目标应显式报错）。
- 修复方向（04）：A 逐项补翻译（对齐 SCRIPT_RULES）→ B 统一「未支持 Vue API 编译期显式报错」反黑盒兜底（**最低成本、兜底全部 gap、可测**）→ C 对标（uni-app 条件编译+polyfill / Taro 运行时 DOM 模拟=框架非目标 #515 排除，Proteus 走编译期为主+补翻译+反黑盒）。
- 优先级（05）：先 B（编译期报错兜底）→ 再 P0（getCurrentInstance/nextTick/watchEffect）→ P1/P2 按需或标 unsupported。

### 待用户拍板（已拍板 2026-09-08）
- ✅ 决策 1（b）：`getCurrentInstance` 等运行时对内 API → 单独立项**框架语义 API**（useMpInstance/adapter.selectorQuery(组件)）承接，不翻译 Vue 运行时 API。SSOT 已把 `getCurrentInstance`/`useSlots`/`useAttrs`/`watchEffect`/`h`/`createApp` 等标 `unsupported` 反黑盒。
- ✅ 决策 2：unsupported+降级策略→**warning**；无降级→**error**（已固化 `vueCompatLevel`）。
- ✅ 决策 3：SSOT 放 **compiler 内**（`packages/compiler/src/vue-compat.ts`）。
- 决策 4（Vue 版本演进重拉）：待纳入版本变更流程（默认）。

### P0 Step 1 + Step 3 均已落地（2026-09-08）
- **SSOT** `packages/compiler/src/vue-compat.ts`：VUE_COMPAT_MATRIX（Vue 全集 A-D，含 degrade 标志）+ vueCompatStatus/vueCompatLevel + VUE_COMPAT_UNKNOWN 反黑盒兜底；导出 index.ts。
- **矩阵门禁** `tests/vue-compat-matrix.test.ts` 8 用例（完整性/规则/代表性状态/漂移护栏）。
- **编译器接线** `packages/compiler/src/script.ts`（vue import 分支）：vue 命名导入逐 API 查矩阵 → aligned 静默 / partial·unsupported+degrade 警告 / **unsupported 无降级 抛 CompilerError**（getCurrentInstance/h/createApp/useSlots 编译期报错）。
- **接线测试** `tests/vue-compat-compile.test.ts` 5 用例（aligned 正常 / getCurrentInstance 等 error / partial onErrorCaptured warning / provide 正常）。
- 现有项目零破坏：现有 .vue 用 aligned（ref/computed/watch/onMounted/onUnmounted/provide）+ partial（onErrorCaptured/onBeforeUnmount 既有警告）；无 unsupported 无降级 API → build:mp/web 通过。
- 全量 **2553/2553 绿**（2548 + 接线 5）。

## 2026-09-08 · 弹层族/方案 A 相关——已查明但未最终修的（供交接）
- **root-portal 逃逸层叠已验证生效**（popover 面板不再被"打开动作面板"遮——官方层叠解药，符合 07 文档 A 路线）。
- **定位仍失败**（面板落视口顶）：measureRect 的 `.in(组件)` scope 拿不到组件实例——因 `getCurrentInstance` MP not defined → `.in(undefined)` → 页面级查不到组件内 trigger → null → 回退 .p-popover-bottom（portal 脱离 containing block → top:100% = 顶部）。**依赖本立项 P0 getCurrentInstance 翻译**。
- **Skyline 页面滚动**：编译器给页面（非组件）自动包 `<scroll-view scroll-y class="proteus-page-scroll">`（15-page-scroll-container）；页面级滚动（wx.pageScrollTo/pageScrollTo/viewport.pageScrollTo）无效；**页面声明 `onPageScroll`+调 `wx.pageScrollTo`** 才生成 `scroll-top="{{__proteusPageScrollTop}}"`+`proteusPageScrollTo` 桥接（实测能滚 scroll-view）。semantic-primitives-demo 已加 onPageScroll+goPopoverSection（wx.pageScrollTo 桥接）。

> 跨会话交接用的精简记忆。每次收尾把「成果 / 教训 / 待办 / 环境」追加到顶部一节。
> 详细台账：`docs/proteus-test-framework-plan/15-mp-e2e-console-gate.md`（页面健康台账 + 实证教训）、
> `docs/proteus-semantic-primitives-plan/07-popover-skyline-floating-special.md`（popover 专项）。

## 2026-09-08 续 · ★★Skyline 页滚 + measureRect scope 修复（用户三连纠错）

### 三个真问题（用户逐一纠正）
1. **webview 页空白 ≠ DOM 隔离**：webview 下 glass-easel 组件降级不渲染（页面空白→automator 拿不到元素）。我曾误判"页面 DOM 全隔离"。切 skyline 后页面正常渲染、页面级 `view` **可查**；但 `p-popover` **自定义组件内部**（`[data-role]`）页面级查不到（glass-easel 组件边界），只有原生 `view` 可查。
2. **Skyline 页滚必须在 scroll-view 内**：编译器给页面（非组件、非 scroll-view 根）自动包 `<scroll-view scroll-y class="proteus-page-scroll">`（15-page-scroll-container）。**页面级滚动（wx.pageScrollTo/pageScrollTo/automation_viewport.pageScrollTo）都无效**——skyline 页面本身不滚。
3. **页面滚动桥接条件**：编译器只在页面**声明 `onPageScroll`** + **调用 `wx.pageScrollTo`** 时才给 scroll-view 生成 `scroll-top="{{__proteusPageScrollTop}}"` + `bindscroll`/`proteusPageScrollTo` 桥接（template.ts `hooks.hasOnPageScroll`/`hasPageScrollTo`；script.ts `wx.pageScrollTo`→`this.proteusPageScrollTo`）。`semantic-primitives-demo` 原本都没有→滚不动；给页面加 `onPageScroll`+`wx.pageScrollTo` 后 **`wx.pageScrollTo`（经页面方法）能滚 scroll-view**（实测 `__proteusPageScrollTop` 设 2600/1700 成功）。

### 真机实测
- 到达 popover 区（scroll-view 滚到 1350-1700），`popoverOpen:true` → 面板"气泡内容"渲染（未被完全遮挡，比最初"被完全遮盖"改善）。
- `.p-popover-panel` 仍页面级不可读（组件隔离）→ 无法从页面 query 读面板 panelStyle/是否 fixed。
- popover MP E2E（scope 修复 + demo 页 onPageScroll 改动）**通过**；全量 **2540/2540 绿**。

### measureRect scope 修复
- `PlatformAdapter.measureRect(selector, scope?)`：mp `.in(scope)` / web `scope.querySelector`——下探到 p-popover 组件内部 trigger（页面级查不到）。
- 组件 `openMeasure` 传 `getCurrentInstance().proxy`（`__scopeInst` 编译器保留为 `this.__scopeInst = getCurrentInstance()`；scopeRef ref 初始化值被丢弃→改直接传 `__scopeInst?.proxy`）。
- P8e4 探针锁 `measureRect(TRIGGER_SELECTOR, this.__scopeInst.proxy)` 调用面。

### 遗留/待用户
- demo 页加了 `onPageScroll`+`goPopoverSection`（pageScrollTop）——`onPageScroll` 是页面滚动钩子（合理），`goPopoverSection` 是测试脚手（是否保留待用户）。
- 面板是否真 `position: fixed` 逃离层叠：受组件隔离（读不到 `.p-popover-panel`）→ 需 GUI/或组件内 `console.error`（get_simulator_console 不可靠）；视觉已见渲染未完全遮挡。

## 2026-09-08 · ★★MP E2E 后端重构：miniprogram-automator → wechatide skill-CLI（唯一标准）

### 起因
用户实测 `proteus test e2e:mp`（automator）launch 失败 `Failed to launch ... http port is open`——**服务端口一直开着仍连不上** = automator 0.12.1 与新版 Electron IDE 的 automation WS 协议/端口不可发现**不兼容**。用户裁定：**唯一标准 = 小程序开发者工具 Electron 版（官方 wechatide skill-CLI 规范）**，以它为标**重新做自动化测试框架**。

### 成果
- **新 `packages/test-core/src/driver/wxide.ts`**：`createWxideMini(opts)` 实现 `AutomatorMiniLike` 形状 → `createMpDriver(wxideMini, debugger)` 无缝复用；`callWxide(tool, args, opts)` 内部 spawn `wechatide -c <client> <tool> --project <path> ...` + 解析嵌套 JSON。导出 `createWxideMini`/`callWxide`/`WxideMiniOptions`（driver/index.ts）。
- **工具映射**：reLaunch/navigate→`automation_navigate`；currentPage/systemInfo→`automation_runtime_info`；evaluate→`automation_evaluate`；screenshot→`simulator_screenshot`；element tap/input/text/attribute→`automation_element_action`；consoleGrep→`get_simulator_console`；refresh→`simulator_refresh`；clearCache→`debug_clear_cache`。
- **`driver/mp.ts` waitFor 改造**：ms 烘成**无参箭头函数字面量**（`new Function(...)`）——wechatide evaluate 不支持带参（`--args` 实测不生效），无参+字面量两端兼容。
- **`tests/e2e-mp-popover.test.ts`**（framework 规范，`PROTEUS_MP_E2E_WXIDE=1` 启用）：reLaunch demo 页 → console 零错门禁 → evaluate 开/关 popover（p-button 组件内不可 tap → evaluate setData 驱动）→ **开完 console 零错（方案 A measureRect→setData panelStyle 运行时路径 Skyline 无崩溃）**。

### 验证（Skyline + wechatide framework）
- `tests/e2e-mp-popover.test.ts` **12.3s 通过**（开/关 popover + console 零错 + `popoverOpen` 正确开合）。
- 适配器单测探针：currentPage/evaluate/systemInfo/reLaunch 全部跑通（`(function(){})()` IIFE 会 exit 1 → 必须**裸函数源码** `function(){...}`；`wx.getSystemInfoSync().renderer` 本 IDE 版本返回 **undefined** 不能作 skyline 判据）。
- 全量 **2540/2540 绿**；`check:pkg` 38 包 0 error；test-core build ✓。

### 遗留/下一步
- ✅ CLI `proteus test e2e:mp` 已迁 wechatide（2026-09-08 同批）：`packages/cli/src/index.ts` e2e:mp 分支改 `open_project_window(fullMode)+skyline config + env PROTEUS_MP_E2E_WXIDE=1` + `tests/e2e-mp-smoke.test.ts` 加 `WXIDE_ENABLED` 分支（`createWxideMini`）；`proteus test e2e:mp examples --ide <cli>` 实测通过（runSharedSmoke OK + Tests 1 passed）。
- ⚠ `npx proteus`（bin）解析到发布版 `@proteus-vue/cli`（旧 automator）——本仓源码用 `npx tsx packages/cli/src/index.ts test e2e:mp`；对外发布需 rebuild+publish cli 才切 wechatide。
- `automation_evaluate` 不支持带参/IIFE——只支持裸函数源码（无参）+ 返回字面量/Promise。
- `systemInfo` 嵌套提取（`result.systemInfo.result`）已解包；console 返回 string 需 split。
- 产物副本 `.proteus/e2e-mp` 与 real-dist 是不同 runtime——popover 测试用 real-dist 需先 `open_project_window`（automation_navigate 依赖 runtime）。

## 2026-09-07 续 · popover 方案 A spike + platform L2 measureRect（为 P2 拆审计卡点）

## 2026-09-07 续 · popover 方案 A spike + platform L2 measureRect（为 P2 拆审计卡点）

### 成果
- **L2 `measureRect` 抽象（`packages/shared/src/platform/`）**：`PlatformAdapter` 加可选 `measureRect?(selector): Promise<Rect|null>`
  ——mp 用 `wx.createSelectorQuery`、web 用 `document.querySelector + getBoundingClientRect`；失败/不支持 resolve null。
  新增 `Rect` 类型 + shared index 导出。**审计合规**：wx/document 直调只在平台层（no-platform-api allow: platforms/**）。
- **方案 A spike（p-popover）**：打开时 `adapter.measureRect('#'+uid)` 测 trigger → `computePopoverPosition`（`src/components/runtime/popover-position.ts` 纯函数）
  算 fixed 视口坐标 → `panelStyle` 字符串（`position:fixed;left:Xpx;top:Ypx;right:auto;bottom:auto`）→ 面板浮到层叠顶层（Skyline 层叠解药）。
  降级契约：measureRect 缺失/失败/不支持 → panelStyle='' → 回退静态 `.p-popover-{placement}` 绝对锚定（终案行为不变）。
- **产品契约/测试**：`tests/popover.test.ts` 10 用例（纯函数四向 + 组件 mock measureRect：fixed 命中/空回退/抛错回退/无方法回退/关闭清空）+ platform-adapter +5 用例。
- **产物实证**：p-popover mp 产物 `setData({ panelStyle: 'position:fixed;left:'+pos.left+... })` 正确重化；wxml `id="{{uid}}"` + 静态 placement 类保留。

### 自动化验证（用项目自有框架，不含手工）
- **单测**：`tests/popover.test.ts`（纯函数四向 + 组件 mock measureRect 五种态）+ `tests/platform-adapter.test.ts`（measureRect web/mp/null/SSR 守卫）。
- **产物契约探针**：`tests/compiler-mp-probe.test.ts` P8e 新增 4 断言（trigger triggerId / panel style 绑定 / measureRect+setData / triggerId 生成）。
- **Web e2e**：`tests/e2e-overlay-family.test.ts` p-popover 改写（opens via overlay--on → panel fixed+coords 定位 → layer 关闭）——真实浏览器（Chromium）验证 fixed+coords 渲染。
- **命门诚实边界**：Skyline 是否渲染「fixed 像素坐标」无法在无设备 CI 完全自动化，但 Web 真实浏览器已验 fixed+coords 渲染；Skyline 层叠需 final 真机（一次）——但**非每次手工**：改结构即被 P8e 产物契约红 + e2e 红拦截。

### 重点教训（自动化抓到并修复的真 bug）
- **`src/components` 组件不能 import `@proteus-vue/shared` 直接依赖根 node_modules**——shared 未 hoist 到根（只有 fluid/devtools-runtime 在根）→ 需**同时**在 examples `tsconfig paths` + `proteus.config` vite `resolve.alias` 补 `@proteus-vue/shared`（类型侧 + 打包器侧两处）。
- **MP 编译器丢弃顶层 const/ref 含函数调用/计数器**：`const uid = '...' + ++uidCounter` 整行丢（uid→undefined→measureRect('#undefined')）；`getCurrentInstance().uid` 同样丢。**解法 = 模块级 `let popoverSeq`（不衍生成 const）+ 方法内 `triggerId.value = '...' + popoverSeq`**（模块 let + data ref 赋值编译器保留）。
- **`:id` 绑定是异步 flush**：`ensureTriggerId()` 后必须 `await nextTick()` 再 measureRect——否则 querySelector('#...') 在 id 落地前拿 null → 误回退（Web/MP 双端同坑，e2e 抓到）。
- **组件定位 style**：MP 只收字符串（#500）；且 computed 依赖 async 方法内 ref 赋值**未**被 computed 链 patch 重化（如 p-popover panelStyle）——改成**字符串 ref 直接赋值**（`setData({ panelStyle: 'position:fixed;left:'+... })`）+ 字符串拼接即可重化 + MP 原生可用。p-modal 的 form 走 applyForm 才被重化，这是编译缺口非通用。
- **注释勿含 `*/`**：JSDoc 里 `wx.*/document.*` 会提前闭合块注释 → TS 语法错误。
- **happy-dom 字符串 `:style`**：`getAttribute('style')` 返回规范化带空格（`'position: fixed; ...'`），空串为 `''` 非 null。
- **正则断言脆弱**：产物引号形态不定（setData({ triggerId: '...' })）→ 用宽松子串 `.toContain` 更稳。

## 2026-09-07 · 弹层族 Skyline 回归（当日收尾）

### 成果（全量 vitest 2544/2544 绿；HEAD 306df623 已推送；工作区干净）

- **弹层族 5 组件 skyline 全部验证通过**：p-drawer（左/右定位 + 遮罩点关）、p-action-sheet、
  p-modal、p-popup（底部定位 + 滑入滑出动画）、p-popover（锚定 + 开关 + 遮罩）
- **框架修复①**：`packages/plugin-vite/src/gen-routes.ts`（writeComponentJsons）给**组件 json 补
  `componentFramework: glass-easel`**（此前只给页面加 → 组件内悬浮/portal 全不渲染，V4 实证）
- **框架修复②**：实证编译器「模板内动态拼接类字面量」插 scope 后缀插半截
  （`'x--' + phase` → 产物 `---data-v-x` 畸形类**永不命中**）——弹层位置/动画丢失根因
- **p-popover 终案**：浮层**弃 `wx:if` 子树**（glass-easel 不渲染）与 **`root-portal`**（脱离破锚定
  → 面板左上角），改**常驻 overlay + visibility 类切换**（对齐 p-drawer 常驻模式）
- **自动化固化**：15 号门禁 0-7 链路（进页先 console 零错门禁）；产物契约探针
  `tests/compiler-mp-probe.test.ts` P7/P8（17 项，含 drawer 双分支/popup 静态类/popover 终案结构）
- **官网**：`website/guides/22-skyline-render-constraints.md`（Skyline 渲染约束与组件写法）+ EN overlay；
  **`check:en-drift`（双语 zh/en 结构漂移门禁）已挂入 root `verify` 链**

### 已知限制 / 待办

- **P2**：p-popover skyline 层叠——面板(absolute)按 DOM 序绘制，会被**其后**内容遮挡（layer fixed
  正常上浮，点外关闭不受影响）；方案 = 组件内 `createSelectorQuery` 测 trigger rect → 面板
  `position: fixed` + 像素坐标（需过 no-platform-api 审计）。Web 无此问题。文档见 07 §7。
- **巡检待办**：mp-semantics-demo / forms / fluid-system-demo 页面按门禁链路过，扩大健康台账

### 教训（当天 3 次同因）

1. **交互异常先「重编译页面 / 重启开发者工具」再动代码**——当日 3 次（p-popup 动画、右抽屉关不掉、
   `uv_cwd ENOENT` 预览失败）全是陈旧 IDE 进程/产物假象
2. `get_simulator_console` **漏抓运行时 console.log**（GUI Console 可见）——探针判定看 GUI 或状态断言
3. **自动化边界**：wechatide 元素树无自定义组件内部节点、无页面坐标点击 → 渲染命中层 bug 需一次性
   人工实证，结论用**产物契约测试**（P7/P8）固化，回归 vitest 拦
4. 官网内容改动提交前必须跑 `check:en-drift`（已入 verify 链，不再漏）

### 环境备忘

- Electron 版开发者工具：`/Volumes/data1/applications/wechatwebdevtools.app`（wechatide CLI，client=zed）
- MP 产物：`examples/dist/mp-weixin`；**每次 `build:mp` 后须重写**
  `dist/mp-weixin/project.private.config.json` 为 `{"setting":{"skylineRenderEnable":true}}` 锁 skyline
- 编译后页面常回退 `pages/index` → 二次 `simulator_open_page` + sleep 8 再 evaluate
