---
'@proteus-vue/agent': patch
'@proteus-vue/app-config': patch
'@proteus-vue/capabilities': patch
'@proteus-vue/compat-miniprogram': patch
'@proteus-vue/compiler-backend': patch
'@proteus-vue/contracts': patch
'@proteus-vue/create-proteus': patch
'@proteus-vue/css-compat': patch
'@proteus-vue/desktop': patch
'@proteus-vue/devtools': patch
'@proteus-vue/devtools-runtime': patch
'@proteus-vue/docs': patch
'@proteus-vue/fluid': patch
'@proteus-vue/glass': patch
'@proteus-vue/hmr': patch
'@proteus-vue/i18n': patch
'@proteus-vue/mcp': patch
'@proteus-vue/module': patch
'@proteus-vue/render-backend': patch
'@proteus-vue/renderer-app': patch
'@proteus-vue/security': patch
'@proteus-vue/web': patch
'@proteus-vue/worklet': patch
---

发布同步：修复「同版本号、内容不同」的发布漂移

上述包在 npm 上的最新版本与本地源码**内容不一致**（版本号相同）——根因是
`scripts/publish-all.sh` 旧逻辑「registry 已有该版本 → 跳过」无法区分「幂等重跑」与
「改了源码但忘了 bump 版本号」，后者会让新内容永远发不出去。已实测：41 包中 36 个存在该漂移。

后果（真实事故）：`@proteus-vue/cli@0.3.0-beta.2` 顶层 import `createFlamegraphCollector`，
而 npm 上的 `devtools-runtime@0.1.0` 是旧构建（只有 8 个导出）→ 使用方**启动即崩**
（`SyntaxError: ... does not provide an export named 'createFlamegraphCollector'`）。

本次 bump 为**发布同步**（不含破坏性变更）；防复发改造见 `scripts/check-publish-drift.mjs`
与 `publish-all.sh` 的内容校验（发布前自动拦截同类漂移）。
