# Android JS 执行载体选型（C1/C2 的共同前置）

> 日期：2026-09-29 · 触发：卡 C1/C2 剩余项的共同阻塞（见 §1）
> **证据等级**：本文所有关键结论均有**本机实测**支撑（非文档推断）——见 §4「实测记录」
> 决策状态：**建议选 QuickJS，待用户确认**

---

## 1. 为什么需要这份选型（两条卡的汇合点）

卡 C1 与 C2 的剩余验收**受阻于同一个事实**（2026-09-29 核实）：

- **C1** 剩「有可运行的 Android 实现」——`createSelfDrawBatchAdapter` 等批量桥是 **TS 代码**，
  要在 Android 上跑就得有 JS 执行环境；
- **C2** 剩「JSI 通路可用」——而 Host ABI 的 **HA0（八接口 C ABI）全仓零实现**（方案文档自标"规划态"），
  JSI 通路建在它上面。

而 **Android 宿主当前没有 JS 引擎**：`hosts/android` 是 **Java + Rust `.so` 直连 JNI**
（`MainActivity` → `RustLayout` → JNI），WebView 仅作 native-host 演示。
⇒ iOS 有 JavaScriptCore（系统自带），**Android 需要自己嵌入一个**。

---

## 2. 需求（从 iOS 链路的实际用法反推，不是凭空列）

| # | 需求 | 依据（本仓实测） |
|---|---|---|
| R1 | **ES2020 语法** | iOS bundle target = `es2020`（`hosts/ios/bridge/build.mjs` 原文） |
| R2 | **Proxy / Reflect / Symbol / WeakMap** | bundle 里 Proxy **36 处**、Reflect 12 · Symbol 45 · WeakMap 16（Vue 3 响应式核心） |
| R3 | `class` / 私有字段 / async-await / Promise | bundle 里 `class` 18 · `async` 3 · Promise 16 |
| R4 | **IIFE bundle（无模块加载器）** | esbuild `format: 'iife'`——JSC 无模块系统，Android 侧同样按 IIFE 处理即可 |
| R5 | 体积与内存敏感 | App 端（低端机 target）；且要能进 AAR |
| R6 | 可嵌入 C/C++（与 Rust 核心并存） | 宿主是 Java + Rust；引擎需 C ABI 或 JNI 桥 |
| R7 | 许可宽松 | 本仓 Apache-2.0，嵌入式依赖不宜引入传染性许可 |

---

## 3. 候选对比（★关键数据来自本机实测，见 §4）

| 维度 | **QuickJS**（Bellard） | **Hermes**（Meta） | **JSC-Android**（WebKit） |
|---|---|---|---|
| ES 支持 | **ES2025**（官方声明）· 实测 Proxy/Reflect/Symbol/WeakMap/私有字段/**async 全通过** | ES6 + Proxy（v0.7.0+）· **async / ES modules 仍在 In Progress**（官方 Features.md 原文） | 完整（与 iOS 同一引擎） |
| 解释/JIT | 纯解释器（无 JIT） | 字节码 + 可选 JIT（Android 上 JIT 默认关） | 有 JIT（**但 Android 上 WebKit 的 JIT 需可执行内存，受 W^X 限制**） |
| **体积（实测）** | **二进制 0.9MB** · **Android `.so` 0.94MB**（本机交叉编译产物） | AAR 数 MB 级（含字节码工具链） | WebKit 构建产物数十 MB（需自带浏览器内核） |
| **内存（实测）** | **8MB 上限即可解析+初始化整个 368KB bundle** | 未见同口径数据 | 未见同口径数据 |
| **能否跑本仓 bundle（实测）** | ✅ **语法解析通过 + 完整执行无错**（含 Vue 3 初始化） | 未实测（本机无 Hermes） | 未实测（需构建 WebKit-Android） |
| 许可 | **MIT** | MIT | LGPL/BSD（WebKit 混合） |
| 嵌入方式 | C API（`JSRuntime`/`JSContext`）· 源码可 vendored | C++ API · 需 CMake/预编译 AAR | 最重（需整套 WebKit 构建） |
| 维护活跃度 | 活跃（Bellard，2025-09 版） | **非常活跃**（Meta 主推，RN 默认引擎） | 活跃（但 Android 移植非主线） |

### 3.1 为什么 **不选 Hermes**（尽管它在 RN 生态最主流）

两条**硬性**理由（均有官方出处）：

1. **`async`/`await` 与 ES modules 仍在 "In Progress"**（Hermes 官方 `doc/Features.md` 原文）——
   而本仓 bundle 用了 async（3 处）、Vue 内部亦大量使用 Promise/微任务。
2. **Hermes 的卖点是"启动快 + 字节码预编译"**，代价是**必须引入它的字节码工具链**（`hermesc`）
   与 RN 生态假设；而本仓的产物是 **IIFE 纯文本 bundle**（esbuild 直出），
   用 Hermes 会把"构建链"变复杂（需额外字节码编译步骤）。

★**保留意见**：若将来**启动时间**成为主瓶颈（iOS 实测解析编译占启动 74%），
Hermes 的字节码预编译有结构性优势——**届时应重新评估**（本决策不等于永久排除）。

### 3.2 为什么 **不选 JSC-Android**

- **构建成本最高**：需构建/携带整套 WebKit（数十 MB），而本仓只需要一个 JS 引擎；
- **JIT 在 Android 受限**：JIT 需要 `mmap(PROT_EXEC)`，Android 10+ 对可写+可执行内存有 W^X 限制
  ⇒ 实际常退化为解释执行（**优势消失，只剩体积负担**）；
- **许可**：WebKit 为 LGPL/BSD 混合，嵌入商业闭源 AAR 需法务评估（本仓 Apache-2.0）。

### 3.3 为什么 **选 QuickJS**

1. **能力足够（实测而非文档）**：ES2025 + Proxy/Reflect/Symbol/WeakMap/私有字段/async **全通过**；
   **真实 368KB bundle 解析通过、完整执行无错**。
2. **体积极小且在预算内**：**Android `.so` 仅 0.94MB**（实测交叉编译产物）；
   **8MB 内存上限即可跑通**——对 App 端低端机友好。
3. **许可最干净**：**MIT**（与 Apache-2.0 项目兼容，无传染性）。
4. **嵌入简单**：C API + 源码 vendored（本仓已有 NDK 工具链，实测可直接编译）。
5. **无 JIT 反而是优点**：Android W^X 限制下 JIT 不可靠 ⇒ 纯解释器**行为确定**；
   且本仓的性能主战场在 **Rust 核心**（布局/绘制），JS 侧只做语义与指令生成。

---

## 4. 实测记录（本机，2026-09-29 · 可复算）

```
① ES 特性探测（qjs -e）：
   Proxy=function · Reflect=object · Symbol=function · WeakMap=function · Promise=function
   Symbol.asyncIterator=symbol · class 私有字段=true · Proxy trap 生效=true · async=Promise

② 真实 bundle（hosts/ios/bridge/dist/bundle-selfdraw.js，368.5KB / 375691 字符）：
   语法解析：✅ 通过（0.03s）
   完整执行：✅ 无错（含 Vue 3 初始化；无宿主桥）

③ 内存上限探测：--memory-limit 8MB ⇒ ✅ 仍可解析 + 初始化

④ Vue 响应式原语（Proxy 深层追踪 + WeakMap 依赖表）：✅ 行为正确

⑤ 交叉编译 Android arm64（NDK r27c · aarch64-linux-android24-clang）：
   6 个源文件 -fPIC 编译 → libquickjs.so = 0.94MB（ELF 64-bit ARM aarch64）
   ★途中两个可复现的移植点（文档化以免重犯）：
     · Android Bionic 无独立 -lpthread（并入 libc）⇒ 链接时去掉 -lpthread/-ldl
     · 共享库需 -fPIC（默认 build 不带）⇒ CFLAGS 加 -fPIC
```

---

## 5. 落地路径（建议，含判据与边界）

| 步 | 内容 | 判据 |
|---|---|---|
| **S1** | 把 QuickJS 源码纳入 `.tools/`（或 vendor 目录）+ 构建脚本（复用既有 NDK 路径） | `libquickjs.so` 产出 + 架构正确（`file` 验 ARM aarch64） |
| **S2** | 写 JNI 桥：`evaluateScript(source)` + 注入 `proteusNative` 等价对象（对齐 `hosts/ios/bridge/entry.ts` 的适配器形态） | 真机能执行一段 JS 并回传字符串 |
| **S3** | 在 `hosts/android` 跑通 `createSelfDrawBatchAdapter` 的**最小闭环**（建 1 个节点 + commit 一次） | 宿主侧收到 1 次 `mount` 调用、批次内容正确 |
| **S4** | 接 HA0 八接口（Host ABI）——把 JNI 桥规范化到 C ABI | `proteus_submit_frame` 等接口可被 Android 调用 |
| **S5** | 三项复测（4050 / 长列表 / 内存）+ C1/C2 剩余验收 | 按卡内口径 |

**诚实边界**：
1. **本选型不含性能预测**：QuickJS 是解释器，**JS 侧吞吐会低于 JSC 的 JIT**
   （iOS 侧 JSC 有 JIT）；需 S3 后实测，不可用 iOS 数字外推。
2. **未实测 Hermes/JSC-Android**（本机无环境）——"不选"的理由是**官方文档的硬事实**
   （Hermes async 未完成）+ **结构性成本**（WebKit 体积/JIT 受限），不是实测对比。
3. **QuickJS 的长期维护**依赖作者（Bellard）个人节奏——若需企业级 SLA，需评估 fork 维护成本。
4. **S2 的 JNI 桥形态未定**（C API 直调 vs 再包一层 C ABI）——取决于 HA0 的接口设计（尚未实现）。

---

## 6. 复算方式

```bash
# 取源 + 本机验证（macOS）
curl -O https://bellard.org/quickjs/quickjs-2025-09-13-2.tar.xz && tar -xf …
cd quickjs-2025-09-13 && make -j8          # 产出 qjs（0.9MB）
./qjs --std -e "const s=std.loadFile('<bundle.js>'); new Function(s); console.log('OK')"
# Android 交叉编译（用本仓 NDK）
CC=.tools/ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android24-clang
$CC -fPIC -O2 -D_GNU_SOURCE -c quickjs.c … && $CC -shared -o libquickjs.so *.o -lm
```
