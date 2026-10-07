// hosts/harmony/appjson-set-cssconf.mjs —— safe-edit 变换：把 AppScope/app.json5 切到「CSS 验收」应用
//
// 【为什么存在（2026-10-08 · 用户点破）】鸿蒙的 **bundleName 落在 `AppScope/app.json5`**（不是
//   build-profile 的 product）——DevEco 的"自动签名"按 app.json5 的 bundleName 签发 profile，
//   hvigor 打包/签名也以它为准（实测：product.bundleName 只管打包时的同名覆盖，签名校验比对的是
//   app.json5）。⇒ 要出「CSS 验收」独立桌面应用 = 把 app.json5 换成 `dev.proteus.cssconf` + 该标签。
//   本变换经 `scripts/safe-edit.mjs`（唯一合法编辑通道）调用，只改这两个字段、保留其余（版本/图标等）。
export default (src) =>
  src
    .replace(/"bundleName":\s*"[^"]*"/, '"bundleName": "dev.proteus.cssconf"')
    .replace(/"label":\s*"\$string:[^"]*"/, () => '"label": "$string:app_name_cssconf"')
