# iOS 宿主（竖切 M1）

> **一句话**：标准 Vue render 函数 → Dispatcher → `native-ios` 后端 → JavaScriptCore 桥 → **真实 UIKit 视图树**。
> 这是 `docs/proteus-app-renderer-plan/` 的 M1（「JSI 骨架 + 首个 View 创建」）在 **iOS 上的第一段真实链路**。

## 怎么跑

```bash
# ① 验收（不依赖模拟器——真实 JavaScriptCore 跑同一份 bundle，16 项断言）
node hosts/ios/bridge/build.mjs     # 打 JS bundle（Vue 运行时 + render-backend + 入口）
node hosts/ios/verify.mjs           # → ✅ iOS 竖切链路验收通过

# ② 构建可运行的模拟器 App（需 iOS Simulator runtime，见下）
bash hosts/ios/build.sh             # → hosts/ios/build/ProteusHost.app
xcrun simctl boot "iPhone 16" && xcrun simctl install booted hosts/ios/build/ProteusHost.app
xcrun simctl launch --console-pty booted dev.proteus.host   # 控制台可见 PROTEUS_IOS_SNAPSHOT
```

`verify.mjs` 的三层断言（每层可独立证伪，破坏性验证过）：

| 层 | 断言 | 证什么 |
|---|---|---|
| JS 层 | bundle 在纯 JSC 中执行无异常；`backendId=native-ios`；轨迹 >0 | bundle 无 DOM/window 假设；走的是 native 后端而非 mock；nodeOps 真的经过 Dispatcher 转发层 |
| 桥层 | createView/insertView/setViewText 调用计数；**insert 全部先于 ready** | 视图操作**同步**（铁律 A-02）——不存在「先返回后补画」的异步竞态 |
| 树层 | 节点数一致；`p-view→UIView`/`p-text→UILabel`/`p-stack→UIStackView`；文本（含中文）透传；背景色/字号/圆角解析 | `SEMANTIC_NATIVE_MAPS.ios` 生效；**JS 语义树与宿主对象树逐节点对得上** |

## 目录

```
hosts/ios/
├── bridge/entry.ts        # JS 入口：适配器（ProteusNative adapter）+ 业务 render 函数（零平台判断）
├── bridge/build.mjs       # esbuild → 单文件 IIFE（JSC 无模块加载器，必须预打包）
├── bridge/dist/bundle.js  # 产物（约 452 KB：Vue 运行时 + render-backend + 入口）
├── ProteusHost/main.swift # Swift 宿主：JSExport 桥 + UIView 注册表 + 快照落盘（@main，无 storyboard）
├── build.sh               # ①bundle ②swiftc ③组装 .app（无 .xcodeproj——纯文本，CI 可跑）
├── verify-jsc.swift       # JSC 宿主桩：跑同一份 bundle，输出 CALL/SUMMARY/SNAPSHOT
└── verify.mjs             # 验收脚本（编译 + 运行 + 三层断言）
```

## 桥契约（改名要同步三处）

```
entry.ts 的 interface ProteusNative
  ⇅  （必须逐方法同名同参）
main.swift 的 protocol ProteusNativeExports
verify-jsc.swift 的同名 protocol（验证器替身）
```

| 方法 | 语义 | 同步性 |
|---|---|---|
| `createView(type, propsJson) -> Int` | 建视图，返回 handle | **同步**（diff 阶段要立刻拿到句柄） |
| `updateView(handle, key, valueJson)` | 改属性/样式 | 同步 |
| `insertView(child, parent, anchor)` | 挂子树（anchor ≥0 为插入位） | 同步 |
| `removeView(handle)` | 移除 | 同步 |
| `setViewText(handle, text)` | 文本通道 | 同步 |
| `ready(summaryJson)` | 链路完成回调（宿主据此落快照——**避免轮询等待**） | — |

## 诚实边界（M1 骨架，**不是**完成品）

1. **只映射「看得见的少数属性」**：背景色 / 文字色 / 字号 / 圆角 / 固定高度 / 文本。
   其余 style 键（padding/margin/width/gap/flex…）**保留在样式袋里但不静默假装生效**——
   `Layout` 交给 UIKit 缺省（纵向栈式排布），**不实现 flex/grid 求解**（M3+）。
2. **一处真实缺陷已暴露并修复**：初版快照从宿主 `root`（id 0）找子节点，而 JS 创建的根是 `#1`、
   从未挂到宿主 root 上 → 快照 `topLevel: []`（视图创建了却「看不见」）。
   现 `mountRoots(into:)` 在 `ready` 时把无父节点的视图挂进宿主层级；快照的「根」=
   **无父节点者**（不是宿主 root 的子视图）。**这正是竖切的价值**：mock 永远测不出这类挂载缺口。
3. **无手势/动画/玻璃**（M5/M6）；**无热切换演示**（Dispatcher 的 rebuild/rehydrate/hybrid 已具备，
   本步只跑单后端）。
4. **无真实 JSI（C++ HostObject）**：M1 用 **JSExport** 建立同步通道（JavaScriptCore 原生能力，
   零 C++ 编译复杂度）。真 JSI（共享同一 V8/JSC 运行时对象、跨引擎统一）属后续——
   当前契约（`ProteusNative`）与真 JSI 版**同形**，替换成本可控。
5. **无 iOS Simulator runtime 时的验证口径**：`verify.mjs` 用 macOS 上的真实 JavaScriptCore +
   宿主桩证明链路；UIView 的最终外观需模拟器（`build.sh` + `simctl`）人工确认。两者互补。
   本机首次需 `xcodebuild -downloadPlatform iOS`（约 8 GB）。

## 与既有计划的关系

| 计划 | 本竖切对应 |
|---|---|
| `proteus-app-renderer-plan/12-batches.md` M1 | **本目录**（JSI 骨架 + 首个 View 创建） |
| `proteus-app-renderer-plan/02-native-binding.md` | 桥契约来源（铁律 A-02 同步边界） |
| `proteus-host-integration-plan/`（G-41） | 上层契约：Dispatcher（方案 B）+ Vue createRenderer 绑定——**已落地，本竖切直接消费** |
| `proteus-host-integration-plan/host-conformance.md` | H-01~H-08 共 32 项；本竖切是其中「真实宿主注入」的第一步（当前仍用 stub 跑） |

## 下一步（未做，勿当已完成）

- M2：Custom Renderer 的 diff/commit 落原生指令序列（当前已由 Vue + Dispatcher 承担，M2 主要是
  把 `ParentNode`/`NextSibling`/`measure` 等 SPI 缺口补齐）
- M3：组件映射扩面（`packages/render-backend/src/native.ts` 的 SEMANTIC_NATIVE_MAPS.ios 已有
  全量映射表，但宿主侧 `makeView` 仅实现 6 类——扩到全量需按优先级排）
- 布局：flex/grid/流式求解（当前完全依赖 UIKit 缺省）
- 真机（非模拟器）+ H-01~H-08 conformance 在真实宿主上跑满 32/32
