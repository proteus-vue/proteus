# hosts/ —— 宿主层关注点分离规约（L-Hosts，2026-10-07）

> **本目录是什么**：各端**宿主集成**代码。与 `platform/`（平台适配，换 App 不用改）相对，
> `hosts/` 里的东西**每个宿主/应用不同**（见 `platform/README.md` 的判断标准）。
>
> **本文件解决什么**：`hosts/` 内部此前把**三件不同寿命的东西**混在同一目录树——
> 项目无关的**引擎/运行时实现**、绑定某个应用身份的**项目壳**、以及**验证装置**。
> 混装对"CLI 生成宿主 / 正式打包构建 / 安全维护"都是负担（改一处引擎牵扯全目录、换项目要动引擎文件）。

## 1. 三层（每端目录下一致）

| 层 | 目录 | 住什么 | 判断标准：换一个 App，需要改吗？ |
|---|---|---|---|
| **runtime** | `runtime/` | 渲染器 / 自绘管线 / 运行时桥 / 内核绑定（JNI·C ABI）/ 文本度量 / 能力桥 | **不用改**（项目无关） |
| **shell** | `shell/` | 应用入口（Activity / Ability / main）/ 壳 UI（tab·启动页）/ **身份引用**（包名·图标·Bundle ID·AppID） | **要改**（每个应用不同） |
| **dev** | `dev/` | 验证装置：各 Demo / 基准页 / 压力页 / 探针 / 夹具及其生成器 | 不发布（仅本仓研发用） |

**平台规范位置不进 `shell/`**：Android 的 `AndroidManifest.xml` + `res/`、鸿蒙的 `AppScope/` +
`module.json5` 各留在其**平台规定的工程位置**（那本就是"身份/壳"的落点，再套一层反而绕）。

**各端落点**：
```
hosts/android/app/src/main/java/dev/proteus/layoutcore/
  runtime/   shell/   dev/        ← ★同 Java 包（dev.proteus.layoutcore），仅**源码分目录**
hosts/ios/ProteusHost/
  runtime/   shell/   dev/        ← Swift 纯目录（无包约束）
hosts/harmony/host-app/
  proteus_render/   ← ★runtime 已抽为 **HAR 模块**（可依赖单元；含 C++ 源 + CMake + Rust 核）
  entry/src/main/ets/{shell,dev}/  entry/src/main/cpp/{runtime,dev}/   ← ArkTS / C++ 子目录
hosts/shared/bridge/            ← 跨端共享的**运行时入口**（entry-host-runtime 等，属 runtime）
```

★**Android 采用「同一 Java 包 + 源码分目录」**（2026-10-07 实测定的方案）：Java 的**包私有可见性默认**让
"跨包子包"代价极高——一次拆分暴露 **93 处**跨类 API 需改 `public`（且方法体内易误伤）。而按关注点分**目录**
（包名仍 `dev.proteus.layoutcore`）零可见性改动、零 FQN 变动（Manifest 的 `.XxxActivity` 不变），
`javac` 用显式源清单编译（本就如此）⇒ 目录即分层、编译照过。**iOS/鸿蒙无此约束**（无强包-目录耦合）⇒ 真子目录。

## 2. 硬性规则（`pnpm check:host-layering` 机器化，违反即红）

1. **三端三层目录齐备**（不为"看起来分层"建空目录；缺层即该端还未分层）。
2. **`runtime/**` 不得反向依赖 `shell/**` 或 `dev/**`**——引擎/运行时实现里**不得出现**：
   - 具体应用的模块名 / 路由表 / 屏名（如 `superapp`、`examples/router`、`app-screen-content`）；
   - 具体项目/装置的专名（`showcase` / `lights` / `morpheus` / Android `*DemoActivity` / iOS `*-scene`）；
   - ★**判据只扫代码行**（注释里提及不算依赖）。
   - ★**混装登记**（诚实边界）：个别文件是"壳+引擎混装"（本轮整文件归位、不拆段——见 §4），
     对这些文件降级为**命中数棘轮**（`RUNTIME_MIXED_FILES`，不得超过登记值；超限逼拆分）。
3. **不得把构建产物提交入库**——`hosts/**` 下被 git 跟踪的文件里，不得出现"由 `hosts/*/*.mjs` /
   `.sh` 在构建期生成"的产物（bundle / 夹具 json / 生成代码）。**豁免白名单**（`TRACKED_ARTIFACT_ALLOW`，
   每条都有"刻意入库"的硬理由）：
   - `hosts/android/.../dev/OpsFixture.java`：供克隆后**免构建即编译**宿主编译检查（带 `--check` 门禁防漂移）。
   - `hosts/android/bridge/vapor-ab-render.generated.ts`：`entry-vapor.ts` 的**类型检查输入**，而类型检查
     （build-batch 的 tsc）**先于**其生成器（build-and-run）。
   - `hosts/android/app/src/main/assets/browser-layout.json`：canonical 同步副本（`check:cross-end-golden`
     在**非构建期**读它）。
   新增豁免须写进本文件 + 该脚本白名单并说明理由。

★**产物移除后的复现性**（2026-10-07 实测）：删掉全部被移除产物后，三端构建脚本**各自从头再生**通过
（Android `build-and-run` 生成 ops/vapor/4050 夹具 + bundle；鸿蒙 `gen-fixtures` 从 Android 同源复制/生成 rawfile；
`gen-app-screen-content` 生成共享屏内容）⇒ 干净克隆 + 构建即可复现，无需入库产物。
★**共享生成的构建顺序纪律**：`app-screen-content.generated.ts` 是**单一共享文件**，被三端各自按当前
`PROTEUS_APP_PROJECT`+`--platform` **重生成**后立即打包 ⇒ **顺序构建自洽**；**禁止并发构建同一 checkout**
（已是仓库既有禁令——"一条命令内不并行两件写同一产物的事"）。

★**为什么必须机器化**：分层只写在文档里必然漂移——某人图省事让 `runtime` 里 `import` 一下
项目路由，分层就塌了，而**编译照过**。与「三条红线要工具层管」同源（决策 #559 / #561 的纪律）。

## 3. 与仓库治理的关系（G-42.6）

本规约是 **G-42.6（仓库与工程治理：严禁 fork 框架源码）** 在 `hosts/` 内部的落地：
L1 框架主仓（本仓）发独立包 → L2 宿主 App 仓**只依赖不 fork**。`hosts/` 的 `runtime/` 就是
"L2 该依赖的那部分"、`shell/`+`dev/` 是"L2 自己的东西"。**分层是后续"CLI 生成宿主 / runtime 抽包"的地基**
（第二刀：把 `runtime/` 抽成可发布单元、`shell/` 收敛为最小壳 + CLI 脚手架）。

## 4. 诚实边界

- **壳+引擎混装文件**（本轮整文件归位 + 登记，不拆内部分段）：iOS `selfdraw-scene.swift`（内含
  `SelfDrawViewController` 应用入口/场景分发，与自绘管线同文件）、`main.swift`。
  ★在 `check:host-layering.mjs` 的 `RUNTIME_MIXED_FILES` 登记，按**命中数棘轮**守（不得新增）；
  第二刀拆分时移出该表。
- **鸿蒙 `ets/dev/app-stack*.ts` 是上游 `packages/router/src/app-stack.ts` 的移植副本**（`sync-core.sh` 逐字节
  防漂移）——本轮归入 `dev/` 并登记，**去 vendoring**（改为依赖发布包）列为后续专项。
- **「CLI 生成宿主 / runtime 抽包」（第二刀 · 2026-10-07 鸿蒙样板已打通）**：
  **第一刀**（目录分层 + 门禁 + 止血）见 §1–§3；**第二刀**在**鸿蒙**身上把整条模式跑通并真机验证：
  · **runtime 抽为可依赖单元**：`hosts/harmony/host-app/proteus_render/` 是一个 **HAR** 模块
    （`harTasks` + `module.json5 type har` + `src/main/cpp/CMakeLists.txt` 携带 C++ 源 + Rust 核）。
    消费者经 ohpm `file:` 依赖引入，hvigor 跨模块 native 聚合（`PACKAGE_FIND_FILE` → `find_package`）
    编译/链接并打进自己的 HAP（**本仓首次实测 HAR-native 跨模块编译**）。
  · **最小壳**：`templates-host/harmony`——`EntryAbility` 只做"加载页 + 把真实 Ability 生命周期交给 runtime
    （`hostRtShellEvent`）+ 上报 `PROTEUS_HOST_READY`"；`MainPage` 只做"读 rawfile 编译产物 →
    `appScreenCommands` → `renderCommands`"。**壳里零项目身份**（无 superapp / dev 装置）。
  · **CLI**：`proteus create host harmony <dir>`（生成最小宿主工程：模板 + runtime HAR 同源复制 + 拷产物）·
    `proteus build --target harmony --package --host-dir <dir>`（编译产物 → hvigorw 打包 .hap）。
  · **真机判据**：生成的独立工程 zero-device 构建出 `.hap`（`ohpm install` + `hvigorw assembleHap`），
    装机（复用本机华为 CA 签名）→ 启动 → 渲染项目真实内容（`HOST_PAGE_RENDER page=index nodes_rendered=73`）。
  ★**只做鸿蒙样板**：Android（AAR）/ iOS（SwiftPM）抽包按同一套复制，**留下一轮**（Android 93 处可见性 +
  iOS 混装文件拆分各是一摊）。★runtime 的**发布形态**仍是"从框架 checkout 同源复制"（可注入
  `PROTEUS_HOST_RUNTIME_DIR`）；拆成独立发布包列为后续——**已登记** `docs/proteus-host-runtime-package-plan.md`（触发条件：外部 L2 消费者 / API 冻结 / 特性流收敛）。

- **第三刀 · iOS 样板（2026-10-07 打通）**：把同一模式在 **iOS** 跑通并真机验证。
  · **runtime 抽为"源集单元"**：iOS 宿主是 **pure swiftc 直出**（无 Xcode 工程/SPM）——故 runtime 不是
    独立包，而是 **源集**（`hosts/ios/ProteusHost/runtime/*.swift` + `platform/ios/ProteusPlatform/*.swift`），
    与内核两 `.a`（layout-core-rust + host-abi，cargo 交叉编译）一起**由消费方 swiftc 编译进同一模块**
    （= 鸿蒙 HAR"携带源、消费方编译"的 iOS 同形）。★**为何不用 SwiftPM**：独立模块会逼 runtime 全部 API
    `public` 化（引擎与壳共用大量 internal 符号）——与 #563 记录的 Android 93 处可见性同款代价；源集零改动。
  · **混装拆分（必需，非可选）**：原 `runtime/selfdraw-scene.swift` 尾部（`SelfDrawViewController` + `@main`
    delegate + 场景分发引 `ShowcaseScene/SuperappScene/HostRuntimeScene/AppStackScene`）迁到
    `shell/selfdraw-app.swift`；`HostRuntimeBridge`（runtime 形状聚合器）从 dev 迁入 `runtime/host-runtime-bridge.swift`。
    新增运行时门面 `runtime/proteus-host-controller.swift`（起视图/JSContext/桥 → `mountPage` 挂载屏内容）。
    `RUNTIME_MIXED_FILES` 的 selfdraw-scene 登记**已移除**（runtime 现零反向依赖）。
  · **最小壳** `packages/cli/templates-host/ios`：`shell/ProteusApp.swift`（`@main` + `ProteusHostController`
    → 读 `app-screen-content.json` 挂首页 → 上报 `PROTEUS_HOST_READY`/`HOST_PAGE_RENDER`）+ `Info.plist` 模板。
  · **CLI**：`proteus create host ios <dir>`（模板 + runtime 源集复制 + 拷产物）·
    `proteus build --target ios --package --host-dir <dir>`（cargo 建核 → swiftc 编译 → 组装 .app → 签名）。
  · **真机判据**：生成的独立工程 zero-device 构建出签名 `.app` → 装机 → 启动 → **渲染项目真实内容**
    （`HOST_PAGE_RENDER page=index ok=true`，73 节点，截图核对）。
  ★**诚实边界**：a) iOS runtime **发布形态**仍是"从框架 checkout 同源复制"（`PROTEUS_HOST_RUNTIME_DIR` 可注入）；
  b) **签名（provisioning profile / identity）属机器本地**（模板占位；打包时从本机 profile 取 entitlements）；
  c) 参考宿主壳仍分发到 dev 装置场景（`SHELL_MIXED_FILES` 具名棘轮），**最小壳不含**。
  ★**下一刀**：Android（AAR·**保持同包** `dev.proteus.layoutcore` ⇒ Java 包访问按包名跨 artifact 仍有效 ⇒
  零可见性改动，避开 #563 的 93 处 public 化）。

- **第四刀 · Android 样板（2026-10-07 打通）**：同一模式在 **Android** 跑通并真机验证。
  · **runtime 抽为 AAR（★保持同包）**：`hosts/android/build-runtime-aar.sh` 把 `.../layoutcore/runtime/`（11 类）
    编成 `classes.jar` + `libproteus_jni.so`（+ 可选的 quickjs/wasm .so），打成 `hosts/android/build/proteus-runtime.aar`。
    ★**包名仍是 `dev.proteus.layoutcore`**（同包 + 源码分目录，见 §1）⇒ 消费壳（同包名）仍可访问包私有成员，
    **零可见性改动**（对比：换包名会逼 ~93 处 public 化——#563）。AAR 结构 = `AndroidManifest.xml`(同包) +
    `classes.jar` + `jni/arm64-v8a/*.so`(16 KB 对齐) + `R.txt`（同 `platform/android/build-aar.sh`）。
  · **最小壳**：`packages/cli/templates-host/android`——`AndroidManifest.xml`（同包 launcher `.AppActivity`）+
    `src/dev/proteus/layoutcore/AppActivity.java`（建 FrameLayout → `VaporRenderHost` → 读 asset
    `app-screen-content.json` → `mount` 上屏 → 报 `PROTEUS_HOST_READY`/`HOST_PAGE_RENDER`）。**零项目身份**
    （起始页从 Manifest `ProteusHomePage` 读）。★最小静态宿主只需 `VaporRenderHost` + `libproteus_jni.so`
    （**不需** QuickJS/wasm/HostBridge——那是交互/路由路径）。
  · **CLI**：`proteus create host android <dir>`（模板 + runtime **AAR** 复制到 `libs/`）·
    `proteus build --target android --package --host-dir <dir>`（javac → d8 → aapt2 → zip → zipalign → apksigner）。
  · **真机判据**：生成的独立工程 zero-device 构建出签名 `.apk` → `adb install` → 启动 → **渲染项目真实内容**
    （`HOST_PAGE_RENDER page=index ok=true nodes=73`，截图核对）。
  ★**诚实边界**：a) Android runtime **发布形态**是"本仓构建期产出 AAR"（可注入预建件）——独立发布包见 `docs/proteus-host-runtime-package-plan.md`；b) **签名用调试
  keystore**（自动生成，机器本地）；c) 无 Gradle——沿用本仓"手工链 + 断言"哲学（见 hosts/android/README.md）。

- 分层**不改任何运行期行为**：只搬文件 + 改编译源清单，三端零设备编译 + 一次真实构建截图黑盒验证。
