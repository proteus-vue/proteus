---
'@proteus-vue/plugin-vite': patch
'@proteus-vue/create-proteus': patch
---

**发布链修复续（2026-09-19 事故的第二层根因：模板依赖声明导致用户装到旧包 + 重复副本）**

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
  ★这也解释了外部实战报告里的「重复副本」现象——它与 CLI 崩溃是**同一根因的两个表现**。

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
