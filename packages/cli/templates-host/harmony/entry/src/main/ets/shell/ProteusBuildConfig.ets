// {{appName}} —— Proteus 鸿蒙构建变体常量（CLI 生成；**构建期由 CLI 覆写**）
//
// 【为什么需要它（hvigor 直编，无 Gradle BuildConfig）】本宿主由 CLI 用 hvigorw 直编（见
//   `packages/cli/src/host-package.ts` 的 `packageHarmonyHost`），不经 DevEco 的构建变体 ⇒ 无自动
//   BuildConfig。而 dev/release 两变体需要区分（bundle 走 HTTP 还是内嵌 rawfile）⇒ 用这份**显式常量**：
//     · `proteus build --target harmony --package`（release）⇒ DEV=false（本文件默认值）
//     · `proteus dev --target harmony`（dev）⇒ CLI 在编译前把 DEV 覆写为 true、DEV_URL 填 dev server 基址
//   ★变体隔离：release 不注入 dev 通道（DEV=false ⇒ dev 分支不可达，读内嵌 rawfile）。
//   ★与 Android/iOS 的 `ProteusBuildConfig` **同模型**（`check:host-variant-parity` 三端一起盯）。
//     诚实边界：ArkTS 无 `#if` 死代码消除 ⇒ dev 分支的代码仍在包里（只是不可达）；彻底剥离需构建期裁剪（本仓未做）。
export const DEV: boolean = false;
/** dev server 基址（如 `http://192.168.1.5:54789`）；release 恒空。启动参数 `--ps proteusDev <url>` 可覆盖。 */
export const DEV_URL: string = '';
