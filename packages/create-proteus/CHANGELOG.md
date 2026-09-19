# @proteus-vue/create-proteus

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
