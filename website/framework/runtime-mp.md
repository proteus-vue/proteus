---
title: 小程序运行时
order: 12
group: 运行期
---

# 小程序运行时

小程序端的运行时由框架生成与接管——业务不写 `App()`、不手拼 `app.json`、不直接调 `setData`。

## 应用骨架自动生成

`src/main.mp.ts` 是极简入口：**不写 `App()`**。构建时由 `appSkeleton` 模板自动拼装 `app.js` 骨架（应用生命周期 / 全局注册表 / 插件位），产物经插件直出。

## 页面运行时

编译器把每页 SFC 的 `<script setup>` 重写为 `Page()` 构造器：

- `ref` 读写 → `this.data` + `setData`
- `onMounted` 等生命周期映射到小程序页面生命周期
- `computed` → data 派生（onLoad 初始化 + 写入联动）
- `watch` → `proteusWatchX` methods（写入点联动）

## setDataBridge（16ms 批量合并）

`@proteus-vue/runtime` 的 `setDataBridge` 按页面粒度收集脏路径，在 **16ms（≈ 1 帧）批量窗口**内合并多次变更为一次 `setData`：

- 路径合并：`a.b` / `a[0].c` 等点号与数组路径精确合并
- 值去重：同值写入跳过
- `flushSync`：需要立即上屏的场景显式冲刷

## 事件与生命周期

模板事件（`@click` / `@tap`）映射为 `bindtap` 等并归一到统一事件对象；页面生命周期（`onLoad` / `onShow` / `onReady` / `onUnload`）由 `pageLifecycle` 统一管理，Vue 钩子在对应时机触发。

## 调试

- `npm run debug:mp`：全链路调试构建，产物注入 `[proteus][环节]` 日志与决策链文件
- 微信开发者工具正常断点调试逻辑层

## 下一步

- [启动流程与更新机制](/docs/framework/startup)
