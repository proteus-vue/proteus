# 编译器平台化拆分（proteus-compiler-platform-plan）

> **立项：2026-09-08**。记录一项**架构债 / 后续拆分立项**——因为框架是**全端目标**（Web / MP(Skyline·WebView) / App(iOS·Android·Harmony)…），而当前编译器是「MP 专属后端」，平台区分发生在编译器之外，Skyline 特有规则散点硬编码。**本计划只做记录与方向，不涉及当前动工。**

## ✅ 已落地：阶段 1「薄接缝」（2026-09-08）

按「现在拆薄接缝即可，全量平台矩阵留到有 app 编译侧消费者时」的判断，已落地最小接缝：
- **`CompileOptions.renderer?: 'skyline' | 'webview'`**（`packages/types/src/compiler-types.ts`，导出 `Renderer`）——缺省 `undefined` 沿现行为（Skyline 特判全开，产物不变）；显式 `'webview'` 关 Skyline-only 特判。
- **下钻**：`index.ts` styleOpts → `StyleTransformOptions.renderer` → `style.ts` 用 `opts.renderer === 'webview'` 门禁「Skyline 不支持属性警告（position:fixed/float）」与「Skyline 选择器剔除」。
- **缓存 key**：`plugin-vite/cache.ts` `compileCacheKey` 纳入 `renderer`（防同源码跨渲染引擎命中错缓存）。
- **接线**：`plugin-vite/plugin.ts` 从 `config.skyline` 派生 `renderer`（skyline→'skyline'；未开→'webview'）传入两处 `compileVueSfc` + 缓存 key。
- **测试**：`tests/compiler-renderer.test.ts`（5 用例：缺失沿现行为 / skyline 警告开 / webview 关 / 产物稳定）。
- **验证**：全量 **2570/2570 绿**；`build:mp`/`build:web` 通过。

> 阶段 2（全量平台矩阵 / 按 target 多 codegen）留待 app 端编译侧真正接入时按接缝扩展（见下方「后续拆分方向」）。当前无需为无消费者的端建矩阵（YAGNI）。

## 一句话

编译器目前**没有平台参数**（`compileVueSfc` 无 `target/platform/renderer` 字段），它把「目标 = MP」当作默认前提（输出 wxml/js/wxss、ES5 平台校验、px2rpx、Skyline 降级规则全部硬编码）。Web 端不走这个编译器（走标准 Vite + 真 Vue 运行时）；「web/skyline/all」的平台选择发生在**构建编排层**（plugin-vite / cli）。全端目标下，这需要拆分出「平台感知的编译器」。

## 现状（以代码为准，2026-09-08 核实）

### 1. 编译器无平台参数，是「MP 专属后端」
`compileVueSfc(source, CompileOptions)` 的选项只有（见 `packages/types/src/compiler-types.ts:167`）：
`filename / isComponent / px2rpx / rpxRatio / annotateLines / debug / rules / fluidLayout / preprocessStyle / moduleImports / autoScrollContainer`。

**没有 `target` / `platform` / `renderer` / `skyline`**。产物恒为 .wxml / .js / .wxss（MP 面），`validate.ts` 恒按 **MP ES5 平台标准**校验。

### 2. 平台区分在编排层，只流入少量选项
`packages/plugin-vite/src/plugin.ts:579-648` 调用编译器时，`config.skyline` 只在编排层用于：
- `page.json renderer='skyline'` / `componentFramework='glass-easel'`
- `app.json rendererOptions` / `lazyCodeLoading=requiredComponents`
- 注入 `__PROTEUS_SKYLINE__` 宏

**但 `skyline` 布尔本身不传进 `compileVueSfc`**。真正流入编译器的只有 `px2rpx` / `autoScrollContainer` / `isComponent` 三项（+`rules`）。

### 3. Skyline / WebView 差异靠「散点规则」处理，非平台抽象
Skyline 特有行为（`progress` 降级、作用域插槽/组件传参警告、`<root-portal>`、page-scroll 容器、`position:fixed` 警告等）散布在各 `transforms/*` 规则里**无条件触发**，编译器不知道自己在编 Skyline 还是 WebView，无法按目标微调（只能靠 `rules` 覆盖 + 编排层传参）。

### 4. CLI 的 target 概念
`packages/cli/src/dev.ts:23`：`TARGETS = ['web','skyline','ios','android','harmony']`。`--target skyline` → MP watch/build；`web` → Vite；app 端待 M3。即**平台选择在 CLI/编排层**，属于框架基建而非编译器内部能力。

## 为什么这是债（全端目标）

- **Web**：真 Vue 运行时，不需编译器对齐（Vue 能力天然可用）。
- **MP(Skyline/WebView)**：编译器唯一真正服务的端；但 Skyline 与 WebView 在层叠（root-portal/fixed）、滚动、组件支持差异大，当前靠散点规则「打地鼠」式救（popover 层叠、page-scroll、getCurrentInstance 均踩过）——**无平台感知** → 无法按目标精准降级/不降级。
- **App(iOS/Android/Harmony)**：由 app-renderer / render-backend 承接（`@proteus-vue/compiler-backend`、`native-backend`、`platform/` 适配），编译器当前不产出 app 面产物，也无平台参数支撑。

**结论**：编译器把「MP 默认」写死进单一后端 + 平台选择推给编排层 + Skyline 特判散点——这在双端（web/mp）下可工作，但在**全端目标**下会随端数增长不断加「特判规则」，缺乏可演进的平台抽象。

## 后续拆分方向（立项输入，非当前实施）

1. **给 `CompileOptions` 增加 `target`/`renderer?: 'skyline' | 'webview' | ...`（或 `platform`）**，让 Skyline 特有的降级规则 / 警告按目标启用；编译器据此选择 codegen 分支（wxml/js/wxss vs web DOM vs app 产物）。
2. **把 Skyline 散点特判收敛为「平台能力面」**（参考 `docs/compiler-platform-alignment.md` 已有 glass-easel WXML 语义模型——可作平台语义基准），按 `(capability × platform)` 建矩阵，替代无条件触发。
3. **平台适配层**：把 `px2rpx`/`autoScrollContainer`/`componentFramework`/`rendererOptions` 等编排层决策下沉为编译器可消费的「平台 profile」，避免编译内核 vs 编排层职责割裂。
4. **缓存 key**：compileCacheKey 需纳入 `target/renderer`（否则同源码不同平台命中错误缓存）。
5. **双编译不等价（G-29.1）** 已在 plugin.ts 有 gate，平台化后需扩到「跨平台语义不等价」门禁。

## 影响评估

- **不影响当前 `proteus-compiler-vue-align-plan`（Vue 能力对齐）收尾**——对齐对象是「MP 编译器对每个 Vue 能力的处理」，Web 用真 Vue 无需对齐；矩阵 `VUE_COMPAT_MATRIX` 描述的就是 MP 后端行为，不含平台维度。
- 属**独立立项**规模：牵动大量现有 `transforms` 规则 + 缓存 key + 编排层，需专批推进。

## 关联
- `docs/compiler-platform-alignment.md`：glass-easel WXML 语义模型（可作平台语义基准）。
- `docs/proteus-compiler-plan`：蓝图已提「三端 codegen（Web/Skyline/App）」，本计划是把它从蓝图落到「平台化拆分」的落地记录。
- `docs/proteus-platform-plan` / `docs/proteus-app-renderer-plan`：app 端承接。
- `docs/proteus-compiler-vue-align-plan/README.md`：发现本债（vue-compat 全端定位触发）。
