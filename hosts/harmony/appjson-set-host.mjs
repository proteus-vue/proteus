// hosts/harmony/appjson-set-host.mjs —— safe-edit 变换：把 AppScope/app.json5 切回默认宿主应用（superapp）
//
// 【用途】`build-host-app.sh --css` 在构建「CSS 验收」应用前把 app.json5 换成 `dev.proteus.cssconf`，
//   构建后**必须还原**为 `dev.proteus.host`（否则下次默认构建会以 cssconf 的 bundleName 去签名 ⇒
//   与 default 的 profile 不匹配 ⇒ 报 00303074）。本变换即"还原"。
export default (src) =>
  src
    .replace(/"bundleName":\s*"[^"]*"/, '"bundleName": "dev.proteus.host"')
    .replace(/"label":\s*"\$string:[^"]*"/, () => '"label": "$string:app_name"')
