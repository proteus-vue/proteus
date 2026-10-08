// packages/cli/src/targets.ts —— ★构建目标 SSOT（2026-10-04）
//
// 【为什么单独一个模块】构建目标名要在**三处**一致（args 解析 / build 调度 / app-content 平台），
//   分散定义会漂。★命名与**全仓一致**（`CONCRETE_PLATFORMS`：web/mp/ios/android/harmony）——
//   不自造笼统的 "app"（那是三端合一，不符合跨端框架的按端构建标准做法）。
//
// 【App 端 = 三个**具体平台**】`ios`/`android`/`harmony` → 产物分目录 `dist/app/<platform>/`。
//   当前三端内容由同一编译器产出（结构一致），但按平台分目录是标准做法：平台专属编译就绪后
//   各端产物自然分叉，宿主各取各的产物。
export const APP_PLATFORMS = ['ios', 'android', 'harmony'] as const
export type AppPlatform = (typeof APP_PLATFORMS)[number]

/** Web/MP（走 vite 管线，spawn 工程脚本） */
export const VITE_TARGETS = ['web', 'skyline'] as const
export type ViteTarget = (typeof VITE_TARGETS)[number]

/** 全部合法构建目标（`all` = 逐端全构建） */
export const BUILD_TARGETS = ['web', 'skyline', 'ios', 'android', 'harmony', 'all'] as const
export type BuildTarget = (typeof BUILD_TARGETS)[number]

export function isAppPlatform(t: string): t is AppPlatform {
  return (APP_PLATFORMS as readonly string[]).includes(t)
}

export function isViteTarget(t: string): t is ViteTarget {
  return (VITE_TARGETS as readonly string[]).includes(t)
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ★★★完整宿主工程落点（2026-10-08 · 用户「dist/app 里三端只有三个简单文件，没有完整宿主项目」）
 *
 * 【为什么放在 dist/app 下】既有 `dist/app/<platform>/` 只有 3 个 JSON（screen/runtime/app-config）
 *   ——那是**内容产物**，不是可编译工程。用户要的是：`dist` 里直接有**完整宿主工程** + **打包好的安装包**，
 *   一条命令产出，不再每次手动拼一个内部壳。
 *
 * 【目录约定】`dist/app/<platform>/` 下：
 *   · `host/`              完整可编译宿主工程（CLI `create host` 生成，含项目包名/runtime/资源）
 *   · `bundle-superapp.js` 项目侧运行期 bundle（App 壳运行期入口；见 app-bundle.ts）
 *   · `proteus-host.{apk,app,hap}` 打包产物（`build --package` 输出）
 *   · `screen-content.json` / `runtime-content.json` / `app-config.json` 内容产物（既有）
 *   ★`dist/` 已在 `.gitignore` ⇒ 宿主工程/安装包**不入库**（它们是构建产物；项目身份来自 proteus.config）。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 完整宿主工程目录：`<root>/dist/app/<platform>/host` */
export function appHostDir(root: string, platform: AppPlatform): string {
  return `${root}/dist/app/${platform}/host`
}

/** 项目侧运行期 bundle 落点：`<root>/dist/app/<platform>/bundle-superapp.js` */
export function appBundleFile(root: string, platform: AppPlatform): string {
  return `${root}/dist/app/${platform}/bundle-superapp.js`
}

/** 打包产物名（各端）：`proteus-host.<ext>` */
export const APP_PACKAGE_NAME: Record<AppPlatform, string> = {
  android: 'proteus-host.apk',
  ios: 'proteus-host.app',
  harmony: 'proteus-host.hap',
}

