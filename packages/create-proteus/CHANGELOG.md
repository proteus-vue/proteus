# @proteus-vue/create-proteus

## 0.3.0-beta.33

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/create-proteus`
  - `@proteus-vue/docs`

- e111cb2: 模板 scripts 补齐 App 三端入口（dev / build / package）

  - 新增 `dev:android|ios|harmony`、`build:android|ios|harmony`、`package:android|ios|harmony`
    —— 之前模板只有 Web / 小程序脚本，App 三端命令在工程里完全不可见（新手需去翻文档才知道
    `proteus dev/build --target android` 的存在）。
  - 严格遵循「scripts = CLI 命令别名」原则：`build:<端>` = `proteus build --target <端>`，
    `package:<端>` = 追加 `--package`，`dev:<端>` = `proteus dev --target <端>`；与仓库自家工程
    （examples / superapp / css-conformance）的 `build:<端>` 一致。
  - 回归锁：`tests/create-proteus.test.ts` 断言模板 scripts 覆盖三端且逐字等于 CLI 别名（防漏加/漂移）。
  - 文档：guides/05「模板 scripts」表补三端行（zh + EN），并提示 App 端依赖各自工具链与设备。

- 18205f0: 模板首页重做：从「裸 Hello Proteus」到四端一致的可交互展示页

  背景（用户）：「默认创建的模板项目实在太 low 了」+「点击按钮无效……一定要功能正常才行」——
  原首页只有一个 `Hello Proteus` + 一个点不动的按钮，作为产品「第一印象」不合格。

  - **首页 `src/pages/index.vue` 重做**为展示页：品牌区（badge/主标题/副标题）、关键数字卡
    （5 端 / 1 份源码 / 0 条件编译）、**交互演示**（计数器）、下一步卡片。**全部用原始标签**
    （`div / h1 / p / button`，不依赖内置组件——组件三端尚未对齐）。
  - **新增 `src/styles/global.css`**（`:root` 设计令牌 + 根重置 + `.page/.card/.section-title` 骨架）
    ——**四端同源**：小程序走 `targets.mp.globalStyle`、Web 在 `src/main.ts` import、
    App 构建期折进节点样式（`var(--x)` 编译期展开为具体值）。**改主题只改 `:root`**。
  - ★**修「按钮点不动」**：App 的事件编译（`compileEvents`）**只支持内联动作**
    （`@click="count++"`），**不支持方法引用**（`@click="handleTap"`）——后者在 Web/小程序可用，
    但 **App 端不产出事件**（`runtime-content.json` 的 `events` 为空）⇒ 看得见点不动。
    模板统一改用内联写法，并**真机验证**（Android 自绘：点击 → `已点击 N 次` 递增）。
  - **跨端一致性**（基准 = 仓库 `css-conformance`）：静态 class + 设计令牌；页根 `width:100%` +
    安全区避让（`--pf-inset-*`）；不用 `:hover`/伪类；不用 `inline-block`（Skyline 门禁不接受）。
  - **回归锁**：`tests/create-proteus.test.ts` 断言首页为展示页、不含 `p-*`/`:hover`、
    事件用内联 `@click="count++"`，且 global.css 三处接线齐全。
  - **文档**：guides/05 模板清单、guides/09「页面构成」同步（含**事件写法**提示：App 只认内联），zh + EN。

  去端验：Android 真机（release APK，自绘）四端一致 + 点击计数生效；web/mp/android 构建通过。

## 0.3.0-beta.32

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/create-proteus`

## 0.3.0-beta.30

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/create-proteus`

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

## 0.3.0-beta.27

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/create-proteus`

## 0.3.0-beta.25

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/create-proteus`

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

## 0.3.0-beta.20

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/create-proteus`

## 0.3.0-beta.18

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/create-proteus`

## 0.3.0-beta.16

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/create-proteus`

## 0.3.0-beta.14

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/cli`
  - `@proteus-vue/create-proteus`
  - `@proteus-vue/plugin-vite`

## 0.3.0-beta.13

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/compiler-backend`
  - `@proteus-vue/create-proteus`
  - `@proteus-vue/hmr`
  - `@proteus-vue/runtime`

## 0.3.0-beta.11

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/cli`
  - `@proteus-vue/create-proteus`

## 0.3.0-beta.10

## 0.3.0-beta.9

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

## 0.2.1-beta.2

### Patch Changes

- dff6e4f: **发布链修复续（2026-09-19 事故的第二层根因：模板依赖声明导致用户装到旧包 + 重复副本）**

  发版成功后的**发布后冒烟**（干净目录跑真实用户旅程）抓到第二层根因，**第一轮修复并未覆盖它**：

  - **`@proteus-vue/create-proteus`**：脚手架模板的内部依赖此前用 **caret 范围**且版本陈旧
    （`^0.2.1-beta.0` / `^0.1.0` / `^0.2.0-beta.0`）。但 caret 对**预发布版**的规则是「仅当
    (major,minor,patch) 元组完全相同才匹配该元组的预发布版」——`^0.1.0` **永远**匹配不到
    `0.1.1-beta.1`，`^0.2.1-beta.0` 也够不到 `0.3.0-beta.5`。实测用户旅程后果：装到
    `cli@0.2.1-beta.0` + **崩溃版** `devtools-runtime@0.1.0`（只有 8 个导出），且因旧 cli
    exact-pin 旧 `shared@0.2.0-beta.0` 与顶层 `0.2.0-beta.2` 冲突 → npm 嵌套第二份副本 →
    **7 个包出现重复副本**（`shared`/`router`/`runtime`/`compiler`/`module`/`contracts`/`types`）
    → 模块级单例被拆散（URL 变了视图不更新，**无任何报错**）。
    **修法**：模板内部依赖全部改为**精确版本**（= workspace 实际版本）。
    ★ 这也解释了外部实战报告里的「重复副本」现象——它与 CLI 崩溃是**同一根因的两个表现**。

  - **`@proteus-vue/plugin-vite`**：`gen-routes` 的「未找到语义组件库」警告此前**无条件**触发，
    而默认脚手架工程**不使用 `p-*` 组件**（模板仅在 `mp.d.ts` 注释里提到 `p-button`）——
    每个新用户首次构建都会收到误导性警告。**修法**：改为条件触发（仅当工程内确有 `.vue` 引用
    `<p-*>`/`<P*>` 时才提示；未解析的具体标签另有更精确的逐标签警告）。

  **配套门禁与工具（防复发）**：

  - `scripts/check-package-health.js` 新增 `checkTemplateAlignment()`——模板的 `@proteus-vue/*`
    依赖必须精确等于 workspace 版本且**禁止范围写法**（此前该文件只扫 `packages/*`，
    模板是发布链上唯一无人看守的一环）。
  - 新增 `scripts/sync-internal-versions.mjs`（`check:internal-versions`）——把 workspace 实际版本
    同步到 changesets 管不到的模板与 examples；`changeset:version` 已自动调用。已接入 CI 与 `pnpm verify`。
  - 新增 `scripts/verify-publish-smoke.mjs`（`publish:smoke`）——**发布后冒烟**，在干净目录跑真实
    用户旅程：`npm create` → `npm install` → **依赖树无重复副本** + 装到的版本 == 本仓 → `proteus --help`
    → 导出面 → 版本一致。已接入 `changeset:publish` 与 `publish-all.sh` 末尾。
    实测：修复前 **5/10 失败**（精确指认 7 个重复副本包），修复后全绿。
  - 新增 `.github/workflows/publish.yml`——OIDC trusted publishing 发布工作流（**需在 npmjs.com
    逐包配置 trusted publisher 后方可启用**；见文件内「启用步骤」与已知限制）。

## 0.2.1-beta.1

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

## 0.2.1-beta.0

### Patch Changes

- 发布同步：修复「同版本号、内容不同」的发布漂移

  上述包在 npm 上的最新版本与本地源码**内容不一致**（版本号相同）——根因是
  `scripts/publish-all.sh` 旧逻辑「registry 已有该版本 → 跳过」无法区分「幂等重跑」与
  「改了源码但忘了 bump 版本号」，后者会让新内容永远发不出去。已实测：41 包中 36 个存在该漂移。

  后果（真实事故）：`@proteus-vue/cli@0.3.0-beta.2` 顶层 import `createFlamegraphCollector`，
  而 npm 上的 `devtools-runtime@0.1.0` 是旧构建（只有 8 个导出）→ 使用方**启动即崩**
  （`SyntaxError: ... does not provide an export named 'createFlamegraphCollector'`）。

  本次 bump 为**发布同步**（不含破坏性变更）；防复发改造见 `scripts/check-publish-drift.mjs`
  与 `publish-all.sh` 的内容校验（发布前自动拦截同类漂移）。

## 0.2.0

### Minor Changes

- v0.2 工程化基线完成：编译引擎独立包（monorepo）、CLI（build/explain/rules）、脚手架、CI、贡献设施。
