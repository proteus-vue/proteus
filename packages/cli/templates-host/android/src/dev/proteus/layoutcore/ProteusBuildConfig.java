// {{appName}} —— Proteus 构建变体常量（CLI 生成；**构建期由 CLI 覆写**）
//
// 【为什么需要它（没有 AGP，故无 BuildConfig）】本宿主由 CLI 用 **javac 直编**（见
//   `packages/cli/src/host-package.ts`），不经 Android Gradle Plugin ⇒ 没有自动生成的 `BuildConfig`。
//   而 dev/release 两变体需要区分（bundle 走 HTTP 还是内嵌）⇒ 用这份**显式常量**：
//     · `proteus build --target android --package`（release）⇒ DEV=false（本文件默认值）
//     · `proteus dev --target android`（dev）⇒ CLI 在编译前把 DEV 覆写为 true、DEV_URL 填 dev server 基址
//   ★变体隔离：release 的 Manifest 不含 INTERNET（见 AndroidManifest.xml），且 DEV=false ⇒ dev 分支不可达。
//     诚实边界：javac 不做死代码消除 ⇒ dev 分支的**字节码仍在**（只是不可达）；彻底剥离需 R8（本仓未用）。
package dev.proteus.layoutcore;

public final class ProteusBuildConfig {
    /** dev 变体 = true（bundle 走 HTTP dev server + 开启热刷）；release = false（读内嵌 assets）。 */
    public static final boolean DEV = false;

    /** dev server 基址（如 `http://192.168.1.5:51789`）；release 恒空。启动参数 `--es proteusDev <url>` 可覆盖。 */
    public static final String DEV_URL = "";

    private ProteusBuildConfig() { }
}
