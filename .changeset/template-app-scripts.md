---
'@proteus-vue/create-proteus': patch
---

模板 scripts 补齐 App 三端入口（dev / build / package）

- 新增 `dev:android|ios|harmony`、`build:android|ios|harmony`、`package:android|ios|harmony`
  —— 之前模板只有 Web / 小程序脚本，App 三端命令在工程里完全不可见（新手需去翻文档才知道
  `proteus dev/build --target android` 的存在）。
- 严格遵循「scripts = CLI 命令别名」原则：`build:<端>` = `proteus build --target <端>`，
  `package:<端>` = 追加 `--package`，`dev:<端>` = `proteus dev --target <端>`；与仓库自家工程
  （examples / superapp / css-conformance）的 `build:<端>` 一致。
- 回归锁：`tests/create-proteus.test.ts` 断言模板 scripts 覆盖三端且逐字等于 CLI 别名（防漏加/漂移）。
- 文档：guides/05「模板 scripts」表补三端行（zh + EN），并提示 App 端依赖各自工具链与设备。
