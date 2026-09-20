# @proteus-vue/plugin-vite

## 0.3.0-beta.13

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler-backend@0.3.0-beta.13

## 0.3.0-beta.12

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.12
  - @proteus-vue/types@0.3.0-beta.12
  - @proteus-vue/router@0.3.0-beta.12

## 0.3.0-beta.11

### Patch Changes

- @proteus-vue/compiler@0.3.0-beta.11
- @proteus-vue/compiler-backend@0.3.0-beta.11
- @proteus-vue/module@0.3.0-beta.11
- @proteus-vue/router@0.3.0-beta.11
- @proteus-vue/types@0.3.0-beta.11

## 0.3.0-beta.10

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.10
  - @proteus-vue/compiler-backend@0.3.0-beta.10
  - @proteus-vue/module@0.3.0-beta.10
  - @proteus-vue/router@0.3.0-beta.10
  - @proteus-vue/types@0.3.0-beta.10

## 0.3.0-beta.9

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.9
  - @proteus-vue/compiler-backend@0.3.0-beta.9
  - @proteus-vue/module@0.3.0-beta.9
  - @proteus-vue/router@0.3.0-beta.9
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
  - @proteus-vue/types@0.3.0-beta.8
  - @proteus-vue/compiler@0.3.0-beta.8
  - @proteus-vue/compiler-backend@0.3.0-beta.8
  - @proteus-vue/router@0.3.0-beta.8
  - @proteus-vue/module@0.3.0-beta.8

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
  - @proteus-vue/compiler@0.3.0-beta.7
  - @proteus-vue/compiler-backend@0.3.0-beta.7
  - @proteus-vue/module@0.3.0-beta.7
  - @proteus-vue/router@0.3.0-beta.7
  - @proteus-vue/types@0.3.0-beta.7

## 0.2.0-beta.6

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

## 0.2.0-beta.5

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

  - @proteus-vue/router@0.2.0-beta.5

## 0.2.0-beta.4

### Patch Changes

- @proteus-vue/router@0.2.0-beta.4

## 0.2.0-beta.3

### Patch Changes

- 端对齐批次 3（宿主能力）全部收口 + 标尺精度修复

  - **批次 3 八组件对齐官方属性 100%**（+88 属性）：
    - `p-media`（video）6→47/47：播放控制 / 控件显隐族（show-\*）/ 手势族 / 弹幕族 / 画中画族 /
      投屏·截屏·后台播放 / **DRM 族**（is-drm·provision-url·certificate-url·license-url）
    - `p-map` 7→29/29：缩放族 / 图层族（polyline·circles·polygons·include-points）/ 个性化 / 视角 / 交互族 / setting
    - `p-camera` 2→5/5：mode·resolution·frame-size（+ stop/scancode 事件）
    - `p-canvas` 0→3/3：官方 `type` **归一**为框架 `engine` + canvas-id·disable-scroll
    - `p-webview` 1/1：补 load 事件（跨端同名）
    - `p-ad` 3→4/4：ad-theme
    - `p-rich-text` 0→4/4：nodes·space·user-select·mode（source 保留为别名）
    - `p-draggable` 0→13/13：**能力真升级**——此前 MP 端仅 `capabilityWarnOnce('元素静态')` 静默降级
      （Web-only 实现），改为原生 `<movable-area>`+`<movable-view>` 双端同语义（含 area 侧 scale-area）
  - **标尺精度修复（生成器）**：官方页把**子对象 schema**（map 的 marker/polyline/polygon/circle/control/
    position、rich-text 的 node/text 字段）与组件属性混在同页不同 h2 区块——全页扫描误计入清单
    （map 61→43、rich-text 8→4；官方属性总数 793→771），制造虚假缺口并诱导把端私有结构固化成框架语义
    （违反 G-31 铁律）。改为只采四类属性区块（通用属性/属性说明/Skyline 特有属性/WebView 特有属性）。
  - **属性归一按 tag 限定**（`SEMANTIC_ALIAS_BY_TAG`）：同名不同义不进全局别名表
    （官方 `canvas.type`=渲染上下文 vs `button/scroll-view.type`=视觉模式；`movable-view.scale` 布尔 → `scaleEnabled`）。
  - `@proteus-vue/plugin-vite`：`MP_ONLY_TAGS` 补宿主能力原生标签（rich-text/map/camera/canvas/ad/web-view），
    消除 Web 端死分支的 resolveComponent 告警。

- Updated dependencies
  - @proteus-vue/compiler-backend@0.1.1-beta.1
  - @proteus-vue/module@0.1.1-beta.0
  - @proteus-vue/compiler@0.3.0-beta.3
  - @proteus-vue/types@0.2.0-beta.2
  - @proteus-vue/router@0.2.0-beta.3

## 0.2.0-beta.2

### Minor Changes

- 组件库拆包：`@proteus-vue/components`（p-\* 语义组件）成为真实包，退役 alias 与 frameworkComponentsDir

  **新包 `@proteus-vue/components`**（第 41 包）：73 个 `p-*` 语义组件 + `pg-glass` + `virtual-list` + `runtime/contracts/theme`（90 文件）从仓库根 `src/components/` 迁入。**发源码**（`publishSource: true`）：① MP 编译器需在磁盘上扫 `.vue`（`<dir>/<tag>/index.vue`）；② 与「一份源码双端」一致（Web 由消费方 `@vitejs/plugin-vue` 编译）。

  **`@proteus-vue/plugin-vite`**：新增 `resolveComponentsRoot(projectRoot)`（`resolve-components.ts`，已导出）——自项目 node_modules 解析 `@proteus-vue/components` 包根；`mpTransform` / `runGenRoutes` 默认走该解析（不再需要配置项）；包缺失时显式**告警**（写明后果：`p-*` 不被注册 → WXML 整块不渲染），不再静默；产物路径 `proteus/<name>/index` **不变**（对外契约）。

  **`@proteus-vue/types` / `@proteus-vue/cli`**：删除 `frameworkComponentsDir` 配置项（config / config-layers / config-validate / build / dev 全链退役）——容器库已可从 node_modules 自解析。

  **端到端效果**：外部用户 `npm i @proteus-vue/components` 后，Web 直接 `import`、小程序标签 `<p-button>` 开箱可用（无需任何 alias 或配置）。

  **破坏性验证**（已入流程）：临时移走包 → `gen-routes` 报「未找到语义组件库 + p-\* 组件将不被注册（页面 usingComponents 缺失 → WXML 整块不渲染）」，而非静默不渲染。

### Patch Changes

- Updated dependencies
  - @proteus-vue/types@0.2.0-beta.1
  - @proteus-vue/compiler@0.3.0-beta.2
  - @proteus-vue/router@0.2.0-beta.2

## 0.2.0-beta.1

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.1
  - @proteus-vue/types@0.1.1-beta.0
  - @proteus-vue/compiler-backend@0.1.1-beta.0
  - @proteus-vue/router@0.2.0-beta.1

## 0.2.0-beta.0

### Minor Changes

- ecdcfdb: 拆包步骤 5：Vite 插件 + gen-routes 归 @proteus-vue/plugin-vite

  - `mpTransform` 插件 config 解耦：`PluginOptions.config` 由 vite.config 注入（不再 import 项目 config）
  - `ProteusConfig` 类型契约迁入包内 `config.ts`
  - gen-routes 双形态：纯函数 `runGenRoutes({ config, root })` + CLI 入口 `cli.ts`
  - appSkeleton（构建期 app.js 骨架模板）从 runtime 迁入 plugin-vite
  - 内置预设 builders 路径随 router 拆包同步（packages/router/src/presets）

- a501441: 拆包步骤 7：create-proteus 模板重构（npm 包形态）

  - 模板不再复制框架本体（src/platform|runtime|router 框架代码 + 插件），改依赖 `@proteus-vue/{router,runtime,shared,plugin-vite,compiler}` npm 包
  - `@proteus-vue/router` exports 补类型子路径（`./types`/`./schema`/`./scan`/`./tree`/`./merge`）+ `./package.json`；预设源码随包发布（`src/presets`，插件内联需要）
  - `@proteus-vue/plugin-vite` 插件支持 `node_modules/` 包内预设路径解析（resolvePkgPath，含 scoped 包）
  - snapshot-template 改为只快照应用壳；模板应用侧自带 shims 全局类型

- ae60825: 底线整改：AI-native 透明框架分派层 + 漂移门禁 + 路由透明化

  - `@proteus-vue/compiler`：规则注册表升级为**分派层**（阶段三落地）——`executeRule(id, ctx)` + 规则 `apply()`（style/px-to-rpx、template/scope-attr 已登记示范）；AI 覆盖规则实现 → 编译输出即时变化（底线循环 ① 完全形态）
  - 实现 ↔ 注册表**反向漂移门禁**（tests/registry-drift）：实现引用的规则 ID 必须全部已登记，新转换决策漏登记当场报错
  - `@proteus-vue/router`：路由生成规则注册表（route/scan、path-derive、parent-explicit 等 7 条 AI 说明书）+ `--trace-router` 闭环（buildRouteTree/runGenRoutes 输出嵌套推导决策链）

### Patch Changes

- 00c9fb7: 拆包步骤 6：别名与引用面全量切换

  - vite alias / tsconfig paths 全量精确映射 `@proteus-vue/{router,runtime,shared,compiler,plugin-vite,components}`，删除泛化 `@proteus-vue` → `src/`（防误匹配）
  - 新增 `@proteus-vue/components` 精确别名（框架内置组件暂留 `src/components`，组件库 v2.0 方向）
  - create-proteus 模板 alias 同步精确化（vendored 结构）

- Updated dependencies [7cf0406]
- Updated dependencies [00c9fb7]
- Updated dependencies [a501441]
- Updated dependencies [ae60825]
  - @proteus-vue/router@0.2.0-beta.0
  - @proteus-vue/compiler@0.3.0-beta.0
