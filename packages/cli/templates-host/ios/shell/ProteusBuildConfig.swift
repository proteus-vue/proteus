// {{appName}} —— Proteus 构建变体常量（CLI 生成；**构建期由 CLI 覆写**）
//
// 【为什么需要它（swiftc 直编，无 Xcode 构建配置）】本宿主由 CLI 用 **swiftc 直编**（见
//   `packages/cli/src/host-package.ts`），不经 Xcode/xcconfig ⇒ 没有 `#if DEBUG` 的构建设置来源。
//   而 dev/release 两变体需要区分（bundle 走 HTTP 还是内嵌）⇒ 用这份**显式常量**：
//     · `proteus build --target ios --package`（release）⇒ DEV=false（本文件默认值）
//     · `proteus dev --target ios`（dev）⇒ CLI 在编译前把 DEV 覆写为 true、DEV_URL 填 dev server 基址
//   ★变体隔离：release 不注入 dev 通道（DEV=false ⇒ dev 分支不可达，读内嵌资产）。
//     诚实边界：swiftc -O 有死代码消除，但常量字符串仍可能在二进制里（只是不可达）。
enum ProteusBuildConfig {
    /// dev 变体 = true（bundle 走 HTTP dev server + 开启热刷）；release = false（读内嵌资产）。
    static let DEV = false
    /// dev server 基址（如 `http://192.168.1.5:51789`）；release 恒空。启动参数 `--proteusDev <url>` 可覆盖。
    static let DEV_URL = ""
}
