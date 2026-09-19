---
'@proteus-vue/shared': patch
'@proteus-vue/pinia-sync': patch
---

发布同步：shared / pinia-sync 的 npm 版本与本地内容不一致（补 bump）

这两个包在 `sync-publish-drift` 批次中未被推进版本号——原因是它们此前已把 minor 提升
消耗在 `0.2.0-beta.0` 上（pre 模式下同一 minor 只应用一次），本轮无新 minor 声明。

但**内容**确实与 npm 上的 `0.2.0-beta.0` 不同（实测 integrity 不一致），故补 patch bump
使新内容可发布。`shared` 被 7 个包依赖（api/router/runtime/worklet/…），本 patch 同时
驱使其依赖方在 `changeset version` 中同步精确依赖（仓内内部依赖均为 exact pin）。
