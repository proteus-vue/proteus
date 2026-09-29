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

| 步 | 内容 | 判据 | 状态 |
|---|---|---|---|
| **S1** | QuickJS 源码纳入 `.tools/`（**gitignored**，同 JDK/NDK 惯例）+ 构建脚本 | `libquickjs.so` 产出 + 架构断言（`file` 验 ARM aarch64） | ✅ **已完成** |
| **S2** | JNI 桥：`evaluateScript` + 宿主回调桩（`proteusHost.post`） | JNI 导出符号在场（`llvm-nm` 断言）+ 零设备跑通 bundle | ✅ **已完成** |
| **S3** | 在 `hosts/android` 跑通**最小闭环**（建 1 个节点 + commit 一次） | 宿主侧收到 1 次 `mount` 调用、批次内容正确 | ✅ **已完成（真机）** |
| **S3b** | 把**真实 render-backend bundle** 打进 Android 并执行（不只手写等价 JS） | 真实适配器跑通：三相位各走对入口 + hostCalls=3 | ✅ **已完成（真机）** |
| **S4** | 接 HA0 八接口（Host ABI）——把 JNI 桥规范化到 C ABI | `proteus_submit_frame` 等接口可被 Android 调用 | ⏳ 待做（依赖 HA0） |
| **S5-①** | **Java 侧真正消费批次**（JS → 适配器 → 宿主 → Rust 几何 → 自绘） | `host_mode=java` + 15 条判据（含**屏幕像素**） | ✅ **已完成（真机，2026-09-29）** |
| **S5-②** | 三项复测（4050 / 长列表 / 内存）+ C2 宿主侧耗时 | 按卡内口径 | ⏳ 待做 |

### 5.1 S1/S2 落地记录（2026-09-29）

**产物（本机实测）**：
- `.tools/quickjs/`（源码，**gitignored**）· 本机 `qjs` **1075 KB**
- `hosts/android/build/js-engine/libquickjs.so` **1084 KB**（ARM aarch64）
- `hosts/android/build/js-engine/libquickjs_jni.so` **1089 KB**（含 QuickJS + JNI 桥，架构+导出符号双断言）

**新增文件**：
- `scripts/setup-android-js-engine.sh`（S1+S2 构建；`--host` 只建本机 qjs · `--check` 只验产物）
- `hosts/android/js-engine/quickjs_jni.c`（JNI 桥：`nativeEval` / `nativeEvalWithHost` / `nativeSetHostCallback`）
- `hosts/android/app/.../QuickJsEngine.java`（Java 门面，对齐 `RustLayout` 的「JSON 进 / JSON 出」惯例）
- `scripts/verify-js-engine.mjs`（**零设备验证**：引擎可用 + 解析 + 完整执行三判据）
- 门禁：`check:js-engine-build`（产物 + 架构 + 导出符号）· `check:js-engine`（三判据）

**★两处供应链/工程纪律（如实记录）**：
1. **QuickJS 官方发布页不提供校验和/签名**（实测）⇒ 脚本**无法验证下载完整性**。
   缓解：首次获取后**人工核对 sha256 并钉死**在脚本 `PINNED_SHA256`（本次已钉：
   `b376e839…a70ad2a`，后续下载会校验）。★未钉死时脚本会**明确报告"未校验"**——不假装通过。
2. **中文注释里的 `$VAR<全角字符>` 会被 bash 当作变量名一部分**（实测报 unbound variable）
   ⇒ 已系统性扫描并改为 `${VAR}<全角>`（一次修 3 处）。★与"第 N 份手写副本"同族：
   **语言边界的隐式规则要靠工具/扫描兜住**（本次用正则扫描全文，不靠肉眼）。

### 5.3 S3b：真实 bundle 在 Android 上跑（2026-09-29）

**为什么还要 S3b**：S3 用**手写的等价 JS** 验「QuickJS → JNI → 宿主回调」链路通；
但那是 20 行脚本，**不是仓库里真正会被产品使用的代码**。S3b 打进的是
`createSelfDrawBatchAdapter` + `createNativeBackend` 的**真实 esbuild 产物**。

**跑法**：`bash hosts/android/run-js-batch.sh`（可复跑 · 9 条判据）

**实测报告**（`js-batch.json`）：
```json
{ "engine_available": true, "bundle_chars": 116718, "bundle_load_ok": true,
  "run_ok": true, "run_ms": 6, "host_post_count": 1,
  "phase1_mount": true, "phase2_updates": true, "phase3_update": true,
  "host_calls": 3, "mount_nodes": 4, "update_nodes": 5, "ok": true }
```

**判据全绿**：bundle 加载 ✅ · 三相位各走对宿主入口（首帧 mount → 纯样式 updatePatches →
结构变化 update）✅ · **hostCalls=3**（批处理红线）✅ · 结构规模 4→5 ✅ · 执行 **6ms**

**新增文件**：`hosts/android/bridge/{entry-batch.ts,build-batch.mjs}`（bundle 构建，镜像 iOS 做法）·
`hosts/android/run-js-batch.sh`（可复跑验收）· `MainActivity#jsBatchRun`（读 assets → eval → 断言）·
门禁 `check:android-bundle`

**★产物策略**：`bundle-batch.js` **不入库**（与 iOS `dist/` 同款——已被 gitignore）；
⇒ `build-and-run.sh` **构建时自动生成**（本仓纪律「生成物必须在构建路径上」，
否则 clone 后静默跳过 ⇒ 测试路径不可用）。

**★边界（写进脚本输出）**：宿主桥在本链路是"上报给 Java"（`proteusHost.post`）
⇒ 证明 **适配器 → 宿主入口** 这段真实；**Java 侧真正消费批次去渲染**属 C1 后续
（三项真机复测时接）。本步**不**声称"端上已经会画了"。

### 5.4 S5-① Java 侧真正消费批次（端上真的会画）· 2026-09-29

**跑法**：`bash hosts/android/run-js-render.sh`（可复跑 · 15 条判据 · 含截图留证）

**这条链路（与 S3b 的本质差别）**：S3b 的宿主是 **JS 本地桩**（只证"调用发生了"）；
S5 的宿主是 **`JsRenderHost`（Java，实现 mount/update/updatePatches）** ⇒ 批次被**真正消费**：
解析 spec → 注入文本度量 → 调 Rust 核心算几何 → 指令 → `ProteusHostView` 自绘。

**实测报告**（真机 `d67e31a3` · 4050 夹具全部 4051 节点）：
```json
{ "host_mode": "java", "nodes": 4051, "text_nodes": 2000,
  "mount_calls": 1, "patch_calls": 1, "host_calls": 2, "patch_call_kind": "updatePatches",
  "host_cmds": 4000, "expect_cmds": 4000,
  "host_painted_samples": 3640, "host_painted_colors": 59, "host_view_on_draw": 2,
  "host_layout_ms": 25.7, "host_measure_ms": 11.9, "host_emit_ms": 40.0,
  "host_tree_shape": "4051/2000/1", "host_error": "", "ok": true }
```
★**屏幕像素**（截图判据）：非背景色种类 **162**（截图入库 `hosts/android/results/js-render/<时间戳>/screen.png`）

**判据 15 条**：host_mode=java · 批处理红线（3 个调用数）· 增量不重发整树 · 指令数 = JS 侧独立算的期望值 ·
离屏像素 · **真实分发走了 onDraw** · 颜色多样性 · **屏幕像素** · 两侧树一致 · 宿主无错。

---

**★★过程中挖出的 5 个真实缺陷（每个都"读数全绿却看不见"，值得逐条记住）**

1. **`createText` 在批量模式丢文本**（库缺陷，`packages/render-backend/src/native.ts`）——
   它入队的 create op 只带 `props:{}`、**不带 text** ⇒ 宿主收到的首帧树种里文本节点是空的。
   而"节点数"读数照样正确 ⇒ **部分读数掩盖整块数据丢失**。已修（补一条 text op）+ 加 2 条单测。
2. **夹具形态不是 IR 形态**——`app-4050-tree.json` 是**核心请求**形状（样式平铺在节点上），
   而 `createElement({props})` 期待样式装在 `props` 桶里 ⇒ 直传则**整棵树样式全丢**。
   已修（`flattenCoreNodes` 显式归一）。
3. **`ViewGroup` 默认 `WILL_NOT_DRAW`** ⇒ 真实分发**跳过 `onDraw`**，屏幕上什么都没画。
   既有场景靠 `setBackgroundColor(...)` 的副作用侥幸能画（那会清掉该标志）；
   而**离屏路径 `view.drawCmds(canvas)` 绕过分发** ⇒ 离屏检查全绿、屏幕一片空白。
   实测：离屏 3640 采样点有像素 vs 设备截图整屏背景色、`onDrawCount()==0`。
   ⇒ 两处修复：`setWillNotDraw(false)` + **离屏检查改走 `view.draw()` 真实分发**。
4. **度量必须随建树请求一起给**（顺序缺陷）——`setTextMeasures` 只换表**不重排**，
   故"先 create（空度量）→ 再注入"的几何是按零尺寸算的（屏幕上没有字）。
   已修（度量 → 请求 → create，与 iOS 同顺序）。
5. **构建路径上两个静默陷阱**（`build-and-run.sh` + `build-batch.mjs`）：
  ① `node build-batch.mjs || true` **吞掉**构建失败（本仓明令禁止的形态）；
  ② `if [ ! -f "$BUNDLE" ]` 只在**缺失**时重建 ⇒ 改了入口却装**旧 bundle**（stale 陷阱）。
  已修：失败即 `exit 3`；重建条件加"入口比产物新"。

**★新增的可观测性（本次教训的直接产物）**
- `ProteusHostView.onDrawCount()` —— **真实帧计数**：0 = 屏幕一帧都没画（缺它就分不清"没走到"与"画在屏外"）
- `host_painted_colors` —— 离屏重放的**颜色多样性**（只有 3 个采样点那次，单看"非透明>0"会放过）
- `screen_colors` —— **屏幕像素**里非背景色的种类（判据落在屏幕上，不落在"我发出了指令"上）
- `expect_cmds` —— JS 侧**独立算**的期望指令数（两侧各算一次 ⇒ props 丢失当场暴露）

**★门禁补强**：`build-batch.mjs` 现在**先做类型检查**（`tsconfig.bridge.json`）。
理由：esbuild 只擦除类型不校验，而 `hosts/**` 不在根 tsconfig 的 include 里
⇒ 本入口曾有一个 `Expected 2 arguments, but got 0` 一路绿灯出 bundle，直到真机才炸。
（已破坏性验证：注入类型错误 ⇒ 退出码 3。）

**★同时修掉的一处潜伏缺陷**：`scripts/setup-android-js-engine.sh:149` 的 `/** … */`
（**JSDoc 风格注释写在 bash 里**）每次运行都被当命令执行（`/**` glob 展开成 `/Applications`）。
⇒ 已修为 `#`，并把该类纳入门禁 `check:shell-i18n-vars`（新增"非 bash 注释语法"判据 + heredoc 跳过 + 破坏性验证）。

**★边界（如实标注）**：字号按**布局单位**（与 `app-4050` 对照通路的 px 口径不同 ⇒ 不与它比耗时）；
`update`（结构变化）走整树重建（适配器策略），本步只验增量补丁那条。

---

### 5.2 S3 真机最小闭环（2026-09-29 · 真机 `d67e31a3`）

**跑法**：`bash hosts/android/run-js-engine.sh`（可复跑；安装 → 触发 → 取报告 → 6 条判据）

**实测报告**（`js-engine.json`）：
```json
{ "engine_available": true, "engine_version": "quickjs:2026-06-04",
  "eval_ok": true, "eval_value": "4",
  "host_post_count": 1, "batch_call_kind": "mount", "batch_op_count": 4,
  "batch_ok": true, "ok": true }
```

**判据（6 条全绿）**：引擎加载 ✅ · JS **真的执行**（回读 `eval_value=4`）✅ ·
宿主回调**收到 1 次** `mount` ✅ · 批次 **4 个 op** 内容正确（create×2 + insert + text，
含 `"Hello from QuickJS"`）✅

★**链路已通**：QuickJS → JNI 桥 → 宿主回调 → 报告落盘（**Android 首次有 JS 执行环境**）。

★**S3 过程中抓到的两个真缺陷（都已修 + 断言化）**：
1. **"45 字节 APK 报构建成功"**（静默失败）——`build-and-run.sh` 组装完 APK **不看产物**
   就进签名 ⇒ 空包（aapt2 失败/残留）也能"成功"，直到真机发现"代码没生效"才暴露。
   ⇒ 新增 **APK 产物断言**（≥100KB + 含 `classes.dex` + 含 Rust 核心 `.so`）；
   **破坏性验证**：注入空包 ⇒ `exit 3` 并准确报"仅 0 字节"。
2. **脚本判据的解析器假红**——首版 `get()` 用 `grep -o` 多层转义，在嵌套引号下失配
   ⇒ 报告内容明明正确却报 **6 条全红**。改为 `sed -n` 解析。
   ★**教训**：判据红了先怀疑**装置**（本仓纪律），别先怀疑被测对象。

**★边界（写进脚本输出）**：本闭环证明**链路通**；把真实 esbuild bundle
（`render-backend` 的 IIFE 产物）接进来是**同一接口的下一次调用**（S3b）——
当前 APK 只打进引擎 + JNI 桥，未打进 TS bundle。

**★零设备验证的边界（写进 `verify-js-engine.mjs` 输出）**：本机 qjs 是 **x86_64**，
Android `.so` 是 **arm64**——两者**同一份源码**（同版本同配置）⇒ 语义等价，差异只在 ABI/架构
（由 setup 脚本的架构断言覆盖）。⇒ 该验证证明"**引擎能力足够**"，
**不**证明"JNI 编组正确"（后者需 S3 真机）。

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
