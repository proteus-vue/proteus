# @proteus-vue/cli

## 0.3.0-beta.39

### Patch Changes

- Updated dependencies
  - @proteus-vue/app-config@0.3.0-beta.39
  - @proteus-vue/capabilities@0.3.0-beta.39
  - @proteus-vue/compiler-backend@0.3.0-beta.39
  - @proteus-vue/component-ir@0.3.0-beta.39
  - @proteus-vue/consistency@0.3.0-beta.39
  - @proteus-vue/css-compat@0.3.0-beta.39
  - @proteus-vue/dev-host@0.3.0-beta.39
  - @proteus-vue/devtools-runtime@0.3.0-beta.39
  - @proteus-vue/fluid@0.3.0-beta.39
  - @proteus-vue/glass@0.3.0-beta.39
  - @proteus-vue/icons@0.3.0-beta.39
  - @proteus-vue/mcp@0.3.0-beta.39
  - @proteus-vue/module@0.3.0-beta.39
  - @proteus-vue/render-backend@0.3.0-beta.39
  - @proteus-vue/router@0.3.0-beta.39
  - @proteus-vue/runtime@0.3.0-beta.39
  - @proteus-vue/slot-runtime@0.3.0-beta.39
  - @proteus-vue/types@0.3.0-beta.39
  - @proteus-vue/plugin-vite@0.3.0-beta.39
  - @proteus-vue/compiler@0.3.0-beta.39

## 0.3.0-beta.37

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.37
  - @proteus-vue/plugin-vite@0.3.0-beta.37

## 0.3.0-beta.35

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.35
  - @proteus-vue/plugin-vite@0.3.0-beta.35

## 0.3.0-beta.34

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

- 8a19fa5: 修 5 条长期红测的工具链漂移（doctor 分组 / host signing 注册 / check-deps 误报 / 鸿蒙 App 合成证据）

  背景：全量测试长期 5 条红（`gate.test` ×4 + `app-screen-content-gate` ×1），非新改动引入，
  是**特性提交改了 CLI/产物但漏同步元测试/证据**留下的漂移债。逐条根因 + 修法：

  - **`doctor` 分组漂移**（`packages/cli/src/gate.ts`）：#686 把 `doctor` 误登记进「仓库治理」
    （该族语义 = **无 CLI 面**的 npm/CI 治理门禁，不入 HELP）——而 `doctor` 有 CLI 面、在 HELP
    「检查与门禁」组，且它吸收的 `health` 在「专项检查」⇒ 改为 `group: '专项检查'`。
  - **`host signing` 漏登记**（`gate.ts`）：#688 把它加进 HELP 却漏登 Gate 注册表 ⇒ B4-lite
    （HELP↔ 注册表 usage 双向一致）红。补一条 ○（未接线）入口。
  - **`check-deps` 误报**（`scripts/check-deps.mjs`）：website playground 把一份 SFC demo
    整段放进**模板串**，其中 `import { nanoid } from 'nanoid'` 是**示例字符串内容**、不是依赖。
    既有"行内含 `${` 即跳过"的启发式看不到这种形态 ⇒ 误报。改为**代码掩码**（字符串/模板串/
    注释内的 import 形态一律不算）——探针复核：全仓仅少报该 1 处误报、零真实依赖被隐藏。
    同批给 `website` 补上真实依赖 `@vue/compiler-sfc`（playground 编 SFC 用）。
  - **鸿蒙 App 合成证据失效**（`hosts/harmony`，设备证据 `results/app-screen-composite.json`）：
    #658（2026-10-08）把 App 屏内容切到 css-conformance 展示页后**引入了 `env:` token**，而
    Harmony **dev 探针** `ScreenContentProbe` 未接 env 解析（运行期 `AppScreenCommands` 早已接）
    ⇒ `proteus_layout_create` 返 0 ⇒ App 屏内容整体挂载失败、合成页无输出 ⇒ 入库产物陈旧
    （`real_touch_hits:0`）。修：dev 探针复用运行期同一 helper（`substituteEnvTokens`）。
    ★ 并修出**第二个**真缺陷：`Index.ets` 仍从 `libproteus_bench.so` 导入 `appScreenCommands`/
    `appScreenHitAt`/`appScreenAnimTick`——而 hosts 关注点分层（811e0524）已把它们迁到
    `proteus_render` ⇒ 运行时 import 抛错（composite 块整段不执行）。改导入来源 + 同步 d.ts。
    真机复跑：`real_touch_hits 0 → 6`，三端合成门禁复绿。

  验证：`gate.test` 14/14 · `app-screen-content-gate.test` 全绿 · `check-deps` 零缺失 ·
  `check:app-screen-content` 全部合规 · `check:harmony-runtime-prebuilt`（prebuilt 已随源再生）·
  `check:host-layering`/`bridge-sync`/`host-variant-parity`/`gates-sync` 绿 · 鸿蒙真机复跑通过。
  （`check:host-invoke-contract` 的 `dev.console` 违反在**干净树上同样存在**，属另一 pre-existing 问题，不在本批。）

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

- Updated dependencies
- Updated dependencies
- Updated dependencies [3492f53]
- Updated dependencies [c9d830b]
- Updated dependencies [6d737f1]
- Updated dependencies [0245809]
- Updated dependencies [c5a6e5f]
- Updated dependencies [af67734]
- Updated dependencies [90cdec6]
- Updated dependencies [fe645a6]
- Updated dependencies [037281a]
  - @proteus-vue/compiler@0.3.0-beta.34
  - @proteus-vue/component-ir@0.3.0-beta.34
  - @proteus-vue/consistency@0.3.0-beta.34
  - @proteus-vue/glass@0.3.0-beta.34
  - @proteus-vue/mcp@0.3.0-beta.34
  - @proteus-vue/plugin-vite@0.3.0-beta.34
  - @proteus-vue/render-backend@0.3.0-beta.34
  - @proteus-vue/router@0.3.0-beta.34
  - @proteus-vue/runtime@0.3.0-beta.34
  - @proteus-vue/slot-runtime@0.3.0-beta.34
  - @proteus-vue/types@0.3.0-beta.34
  - @proteus-vue/compiler-backend@0.3.0-beta.34
  - @proteus-vue/capabilities@0.3.0-beta.34

## 0.3.0-beta.31

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/cli`
  - `@proteus-vue/compiler`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/slot-runtime`

- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.31
  - @proteus-vue/render-backend@0.3.0-beta.31
  - @proteus-vue/slot-runtime@0.3.0-beta.31
  - @proteus-vue/plugin-vite@0.3.0-beta.31
  - @proteus-vue/mcp@0.3.0-beta.31
  - @proteus-vue/component-ir@0.3.0-beta.31
  - @proteus-vue/compiler-backend@0.3.0-beta.31

## 0.3.0-beta.29

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/agent`
  - `@proteus-vue/cli`

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
  - @proteus-vue/app-config@0.3.0-beta.28
  - @proteus-vue/capabilities@0.3.0-beta.28
  - @proteus-vue/compiler@0.3.0-beta.28
  - @proteus-vue/compiler-backend@0.3.0-beta.28
  - @proteus-vue/component-ir@0.3.0-beta.28
  - @proteus-vue/consistency@0.3.0-beta.28
  - @proteus-vue/css-compat@0.3.0-beta.28
  - @proteus-vue/dev-host@0.3.0-beta.28
  - @proteus-vue/devtools-runtime@0.3.0-beta.28
  - @proteus-vue/fluid@0.3.0-beta.28
  - @proteus-vue/mcp@0.3.0-beta.28
  - @proteus-vue/module@0.3.0-beta.28
  - @proteus-vue/plugin-vite@0.3.0-beta.28
  - @proteus-vue/render-backend@0.3.0-beta.28
  - @proteus-vue/router@0.3.0-beta.28
  - @proteus-vue/runtime@0.3.0-beta.28
  - @proteus-vue/slot-runtime@0.3.0-beta.28
  - @proteus-vue/types@0.3.0-beta.28

## 0.3.0-beta.26

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/cli`
  - `@proteus-vue/render-backend`

- Updated dependencies
  - @proteus-vue/render-backend@0.3.0-beta.26

## 0.3.0-beta.24

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/cli`
  - `@proteus-vue/compiler`
  - `@proteus-vue/plugin-vite`

- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.24
  - @proteus-vue/plugin-vite@0.3.0-beta.24

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
  - @proteus-vue/app-config@0.3.0-beta.23
  - @proteus-vue/capabilities@0.3.0-beta.23
  - @proteus-vue/compiler@0.3.0-beta.23
  - @proteus-vue/component-ir@0.3.0-beta.23
  - @proteus-vue/css-compat@0.3.0-beta.23
  - @proteus-vue/fluid@0.3.0-beta.23
  - @proteus-vue/plugin-vite@0.3.0-beta.23
  - @proteus-vue/render-backend@0.3.0-beta.23
  - @proteus-vue/router@0.3.0-beta.23
  - @proteus-vue/runtime@0.3.0-beta.23
  - @proteus-vue/slot-runtime@0.3.0-beta.23
  - @proteus-vue/types@0.3.0-beta.23
  - @proteus-vue/compiler-backend@0.3.0-beta.23

## 0.3.0-beta.21

### Patch Changes

- Updated dependencies
  - @proteus-vue/capabilities@0.3.0-beta.21
  - @proteus-vue/compiler-backend@0.3.0-beta.21
  - @proteus-vue/component-ir@0.3.0-beta.21
  - @proteus-vue/fluid@0.3.0-beta.21
  - @proteus-vue/render-backend@0.3.0-beta.21
  - @proteus-vue/plugin-vite@0.3.0-beta.21
  - @proteus-vue/compiler@0.3.0-beta.21
  - @proteus-vue/router@0.3.0-beta.21
  - @proteus-vue/runtime@0.3.0-beta.21

## 0.3.0-beta.19

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.19
  - @proteus-vue/plugin-vite@0.3.0-beta.19

## 0.3.0-beta.17

### Patch Changes

- Updated dependencies
  - @proteus-vue/plugin-vite@0.3.0-beta.17

## 0.3.0-beta.15

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.15
  - @proteus-vue/plugin-vite@0.3.0-beta.15

## 0.3.0-beta.14

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/cli`
  - `@proteus-vue/create-proteus`
  - `@proteus-vue/plugin-vite`

- Updated dependencies
  - @proteus-vue/plugin-vite@0.3.0-beta.14

## 0.3.0-beta.13

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler-backend@0.3.0-beta.13
  - @proteus-vue/runtime@0.3.0-beta.13
  - @proteus-vue/plugin-vite@0.3.0-beta.13

## 0.3.0-beta.12

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.12
  - @proteus-vue/types@0.3.0-beta.12
  - @proteus-vue/plugin-vite@0.3.0-beta.12
  - @proteus-vue/capabilities@0.3.0-beta.12
  - @proteus-vue/router@0.3.0-beta.12

## 0.3.0-beta.11

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/cli`
  - `@proteus-vue/create-proteus`
  - @proteus-vue/app-config@0.3.0-beta.11
  - @proteus-vue/capabilities@0.3.0-beta.11
  - @proteus-vue/compiler@0.3.0-beta.11
  - @proteus-vue/compiler-backend@0.3.0-beta.11
  - @proteus-vue/component-ir@0.3.0-beta.11
  - @proteus-vue/css-compat@0.3.0-beta.11
  - @proteus-vue/dev-host@0.3.0-beta.11
  - @proteus-vue/devtools-runtime@0.3.0-beta.11
  - @proteus-vue/fluid@0.3.0-beta.11
  - @proteus-vue/module@0.3.0-beta.11
  - @proteus-vue/plugin-vite@0.3.0-beta.11
  - @proteus-vue/render-backend@0.3.0-beta.11
  - @proteus-vue/router@0.3.0-beta.11
  - @proteus-vue/runtime@0.3.0-beta.11
  - @proteus-vue/types@0.3.0-beta.11

## 0.3.0-beta.10

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.10
  - @proteus-vue/plugin-vite@0.3.0-beta.10
  - @proteus-vue/app-config@0.3.0-beta.10
  - @proteus-vue/capabilities@0.3.0-beta.10
  - @proteus-vue/compiler-backend@0.3.0-beta.10
  - @proteus-vue/component-ir@0.3.0-beta.10
  - @proteus-vue/css-compat@0.3.0-beta.10
  - @proteus-vue/dev-host@0.3.0-beta.10
  - @proteus-vue/devtools-runtime@0.3.0-beta.10
  - @proteus-vue/fluid@0.3.0-beta.10
  - @proteus-vue/module@0.3.0-beta.10
  - @proteus-vue/render-backend@0.3.0-beta.10
  - @proteus-vue/router@0.3.0-beta.10
  - @proteus-vue/runtime@0.3.0-beta.10
  - @proteus-vue/types@0.3.0-beta.10

## 0.3.0-beta.9

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.9
  - @proteus-vue/plugin-vite@0.3.0-beta.9
  - @proteus-vue/app-config@0.3.0-beta.9
  - @proteus-vue/capabilities@0.3.0-beta.9
  - @proteus-vue/compiler-backend@0.3.0-beta.9
  - @proteus-vue/component-ir@0.3.0-beta.9
  - @proteus-vue/css-compat@0.3.0-beta.9
  - @proteus-vue/dev-host@0.3.0-beta.9
  - @proteus-vue/devtools-runtime@0.3.0-beta.9
  - @proteus-vue/fluid@0.3.0-beta.9
  - @proteus-vue/module@0.3.0-beta.9
  - @proteus-vue/render-backend@0.3.0-beta.9
  - @proteus-vue/router@0.3.0-beta.9
  - @proteus-vue/runtime@0.3.0-beta.9
  - @proteus-vue/types@0.3.0-beta.9

## 0.3.0-beta.8

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/built-in-components`
  - `@proteus-vue/cli`
  - `@proteus-vue/compiler-backend-rust`
  - `@proteus-vue/components`
  - `@proteus-vue/create-proteus`
  - `@proteus-vue/plugin-vite`
  - `@proteus-vue/test-ir`
  - `@proteus-vue/types`

- Updated dependencies
  - @proteus-vue/plugin-vite@0.3.0-beta.8
  - @proteus-vue/types@0.3.0-beta.8
  - @proteus-vue/capabilities@0.3.0-beta.8
  - @proteus-vue/compiler@0.3.0-beta.8
  - @proteus-vue/compiler-backend@0.3.0-beta.8
  - @proteus-vue/router@0.3.0-beta.8
  - @proteus-vue/runtime@0.3.0-beta.8
  - @proteus-vue/app-config@0.3.0-beta.8
  - @proteus-vue/component-ir@0.3.0-beta.8
  - @proteus-vue/css-compat@0.3.0-beta.8
  - @proteus-vue/dev-host@0.3.0-beta.8
  - @proteus-vue/devtools-runtime@0.3.0-beta.8
  - @proteus-vue/fluid@0.3.0-beta.8
  - @proteus-vue/module@0.3.0-beta.8
  - @proteus-vue/render-backend@0.3.0-beta.8

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
  - @proteus-vue/app-config@0.3.0-beta.7
  - @proteus-vue/capabilities@0.3.0-beta.7
  - @proteus-vue/compiler@0.3.0-beta.7
  - @proteus-vue/compiler-backend@0.3.0-beta.7
  - @proteus-vue/component-ir@0.3.0-beta.7
  - @proteus-vue/css-compat@0.3.0-beta.7
  - @proteus-vue/dev-host@0.3.0-beta.7
  - @proteus-vue/devtools-runtime@0.3.0-beta.7
  - @proteus-vue/fluid@0.3.0-beta.7
  - @proteus-vue/module@0.3.0-beta.7
  - @proteus-vue/plugin-vite@0.3.0-beta.7
  - @proteus-vue/render-backend@0.3.0-beta.7
  - @proteus-vue/router@0.3.0-beta.7
  - @proteus-vue/runtime@0.3.0-beta.7
  - @proteus-vue/types@0.3.0-beta.7

## 0.3.0-beta.6

### Patch Changes

- Updated dependencies [dff6e4f]
  - @proteus-vue/plugin-vite@0.2.0-beta.6

## 0.3.0-beta.5

### Patch Changes

- 发布同步：有状态单例挂 globalThis（修「包副本分裂 → 静默失效」）+ Web 路由表/路由参数

  **核心修复（来自外部实战报告，最隐蔽的一个）**：依赖树出现两份同一包时，模块被求值两次 →
  **有状态单例分裂** → 订阅方与发布方各持一个实例 → **静默失效（无任何报错）**。
  真实表现：URL 变了但视图永不更新。修复：单例经 `globalThis` 共享（键存在即复用）——
  `shared` 的 adapter（`__PROTEUS_ADAPTER_{WEB,MP}__`）、`app-config` 的 store
  （`configRef` **与 `listeners` 同槽**）、`devtools-runtime` 的 traceBus（`__PROTEUS_TRACE_BUS__`）。

  **其余同期修复**：

  - `plugin-vite` / `cli`：web 目标也更新**应用侧路由表**（`auto-routes.ts` 双端共用；此前只在
    MP 目标生成 → `proteus build --target web` 新增页面 **404**）；并提供 `routesOutput: ''`
    显式关闭语义（文档站等自带路由的工程）。
  - `shared`：Web 端 **路由参数**双路补齐——`PageInstance.query`（对齐 MP `Page.options`）
    - `adapter` 当前页保留 query（此前 query 只传给 listeners，页内读不到）。
  - `create-proteus`：模板 `RouterView` 把 query `v-bind` 给页面（页面 `defineProps` 即收到）。

  **★ 为何 `api` / `capabilities` / `devtools` / `web` / `worklet` 也在内**（源码未改但须重发）：
  这些包用 esbuild `--bundle` 构建，把 `shared` 的代码**内联**进了自身产物——`shared` 一变，
  它们的 `dist` 随之变化。不重发则用户拿到的仍是旧行为。

  （上述包均为**发布同步**，无破坏性变更。）

- Updated dependencies
  - @proteus-vue/app-config@0.1.1-beta.1
  - @proteus-vue/devtools-runtime@0.1.1-beta.1
  - @proteus-vue/plugin-vite@0.2.0-beta.5
  - @proteus-vue/capabilities@0.1.1-beta.4
  - @proteus-vue/router@0.2.0-beta.5
  - @proteus-vue/runtime@0.2.0-beta.4

## 0.3.0-beta.4

### Patch Changes

- @proteus-vue/capabilities@0.1.1-beta.3
- @proteus-vue/router@0.2.0-beta.4
- @proteus-vue/runtime@0.2.0-beta.3
- @proteus-vue/plugin-vite@0.2.0-beta.4

## 0.3.0-beta.3

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @proteus-vue/component-ir@0.2.0-beta.1
  - @proteus-vue/plugin-vite@0.2.0-beta.3
  - @proteus-vue/app-config@0.1.1-beta.0
  - @proteus-vue/capabilities@0.1.1-beta.2
  - @proteus-vue/compiler-backend@0.1.1-beta.1
  - @proteus-vue/css-compat@0.1.1-beta.0
  - @proteus-vue/devtools-runtime@0.1.1-beta.0
  - @proteus-vue/fluid@0.1.1-beta.0
  - @proteus-vue/module@0.1.1-beta.0
  - @proteus-vue/render-backend@0.1.1-beta.1
  - @proteus-vue/compiler@0.3.0-beta.3
  - @proteus-vue/runtime@0.2.0-beta.2
  - @proteus-vue/types@0.2.0-beta.2
  - @proteus-vue/router@0.2.0-beta.3

## 0.3.0-beta.2

### Minor Changes

- 组件库拆包：`@proteus-vue/components`（p-\* 语义组件）成为真实包，退役 alias 与 frameworkComponentsDir

  **新包 `@proteus-vue/components`**（第 41 包）：73 个 `p-*` 语义组件 + `pg-glass` + `virtual-list` + `runtime/contracts/theme`（90 文件）从仓库根 `src/components/` 迁入。**发源码**（`publishSource: true`）：① MP 编译器需在磁盘上扫 `.vue`（`<dir>/<tag>/index.vue`）；② 与「一份源码双端」一致（Web 由消费方 `@vitejs/plugin-vue` 编译）。

  **`@proteus-vue/plugin-vite`**：新增 `resolveComponentsRoot(projectRoot)`（`resolve-components.ts`，已导出）——自项目 node_modules 解析 `@proteus-vue/components` 包根；`mpTransform` / `runGenRoutes` 默认走该解析（不再需要配置项）；包缺失时显式**告警**（写明后果：`p-*` 不被注册 → WXML 整块不渲染），不再静默；产物路径 `proteus/<name>/index` **不变**（对外契约）。

  **`@proteus-vue/types` / `@proteus-vue/cli`**：删除 `frameworkComponentsDir` 配置项（config / config-layers / config-validate / build / dev 全链退役）——容器库已可从 node_modules 自解析。

  **端到端效果**：外部用户 `npm i @proteus-vue/components` 后，Web 直接 `import`、小程序标签 `<p-button>` 开箱可用（无需任何 alias 或配置）。

  **破坏性验证**（已入流程）：临时移走包 → `gen-routes` 报「未找到语义组件库 + p-\* 组件将不被注册（页面 usingComponents 缺失 → WXML 整块不渲染）」，而非静默不渲染。

### Patch Changes

- Updated dependencies
  - @proteus-vue/plugin-vite@0.2.0-beta.2
  - @proteus-vue/types@0.2.0-beta.1
  - @proteus-vue/capabilities@0.1.1-beta.1
  - @proteus-vue/compiler@0.3.0-beta.2
  - @proteus-vue/router@0.2.0-beta.2

## 0.3.0-beta.1

### Minor Changes

- a8633e9: MP E2E 后端迁移：miniprogram-automator → wechatide skill-CLI（官方 Electron 版唯一标准）

  - **起因**：`miniprogram-automator@0.12.1` 与新版 Electron 版微信开发者工具的 automation WS 协议/端口不可发现不兼容（`proteus test e2e:mp` launch 报 `Failed to launch ... http port is open`，服务端口一直开着也连不上）。
  - **`@proteus-vue/test-core`**：新增 `@proteus-vue/test-core/driver` 的 `createWxideMini`（实现 `AutomatorMiniLike`，内部 spawn `wechatide -c <client> <tool> --project` + 解析嵌套 JSON）与 `callWxide`；`createMpDriver` 无缝复用。`waitFor` 改烘字面量无参函数（wechatide `automation_evaluate` 只认裸函数源码，不支持带参/IIFE）。
  - **`@proteus-vue/cli`**：`proteus test e2e:mp` 改为 wechatide 装配——`open_project_window`（fullMode）+ skyline render config + 设 `PROTEUS_MP_E2E_WXIDE=1` 让 spec 走 `createWxideMini`；不再打 automator 兼容补丁 / 不 launch automator。
  - **兼容**：`tests/e2e-mp-smoke.test.ts` 加 `WXIDE_ENABLED` 分支——设 `PROTEUS_MP_E2E_WXIDE=1` 走 wechatide，否则保留 automator（向后兼容）。
  - 工具映射：`automation_navigate`（reLaunch/back）、`automation_runtime_info`（currentPage/systemInfo）、`automation_evaluate`、`automation_element_action`、`get_simulator_console`、`simulator_screenshot`、`simulator_refresh`、`debug_clear_cache`。

  ★ 环境前置：微信开发者工具（Electron 版）已安装 + 小程序产物 `dist/mp-weixin` + `build:mp` 通过；`--ide <cli>`（或 `PROTEUS_IDE_CLI`）指定 wechatide CLI 路径。工具签名/输出见 `docs/wechatide-skill`。

### Patch Changes

- Web 模拟层与端对齐修复 + CLI 小程序 E2E 二进制归一

  - **`@proteus-vue/built-in-components`**（Web 小程序语义模拟层）：多词属性 kebab+camel 双读（`:scroll-y` / `:hover-class` 此前静默失效）；`view` 按压反馈支持 `hover-start-time` / `hover-stay-time` / `hover-stop-propagation`；`scroll-view` 事件改发**裸载荷**并支持受控 `scroll-top/left`；`text` 支持 `user-select` / `overflow` / `max-lines`；`image` 支持 `show-menu-by-longpress`（长按/右键自绘菜单）。
  - **`@proteus-vue/cli`**：`proteus test e2e:mp` 的 IDE 路径**归一到同目录 `wechatide` 二进制**——此前探测到的是已弃用的 automator `cli`，导致整条 MP E2E 链路静默失败（报「输出非 JSON」）。
  - **`@proteus-vue/component-ir`**：端对齐批次 1/2 的属性语义登记（view/text/icon/image/page-container/scroll-view/picker/nav/router-link 的 IR props 同步）。

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.1
  - @proteus-vue/runtime@0.2.0-beta.1
  - @proteus-vue/types@0.1.1-beta.0
  - @proteus-vue/component-ir@0.1.1-beta.0
  - @proteus-vue/plugin-vite@0.2.0-beta.1
  - @proteus-vue/capabilities@0.1.1-beta.0
  - @proteus-vue/compiler-backend@0.1.1-beta.0
  - @proteus-vue/router@0.2.0-beta.1
  - @proteus-vue/render-backend@0.1.1-beta.0

## 0.2.1-beta.0

### Patch Changes

- Updated dependencies [7cf0406]
- Updated dependencies [00c9fb7]
- Updated dependencies [a501441]
- Updated dependencies [ae60825]
  - @proteus-vue/router@0.2.0-beta.0
  - @proteus-vue/compiler@0.3.0-beta.0

## 0.2.0

### Minor Changes

- v0.2 工程化基线完成：编译引擎独立包（monorepo）、CLI（build/explain/rules）、脚手架、CI、贡献设施。

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler@0.2.0
