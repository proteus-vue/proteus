# 15 JS 引擎与逻辑层性能（Android 缺口调查 + 实测数据）

> Status: **Draft · 2026-09-29**（spike 已跑，结论待决策）
> 上游：`05-thread-model.md`（JSI 线程模型）· `02-native-binding.md`（绑定规范）· `14-reference-nativescript-vue.md`（对标）

---

## 1. 为什么需要这一篇：两条链路各自成立，但**从未接上**

「Vue 整套在 App 端跑通」拆成两问，本轮一并处理：

| 问 | 本轮结论 |
|---|---|
| ① Vue 自定义渲染器 → **Rust 自绘管线** | ✅ **已跑通**（真机 + 四层独立核验，见 `hosts/ios/README-SELFDRAW.md`） |
| ② **JS 逻辑层性能** | ✅ **已量化**（iPhone 12 · JSC：Vue 自身 1–3ms；宿主 8–10ms；纯 JS 0.9ms/次） |

**但 ② 只在 iOS 成立** —— 因为 iOS 有**系统自带** JavaScriptCore。**Android 侧目前没有任何 JS 引擎**
（实测核实：`hosts/android/` 下无 JSC / V8 / QuickJS / Hermes 接入），
而现有计划**默认 JSI 存在**却**从未指定引擎选型**。这是「Vue 整套跑通」在 Android 上的**前置缺口**。

---

## 2. Android 的引擎选项（本轮 spike 实测，非纸面推断）

用户提示可参考 **NativeScript-Vue**。先明确 NS 的做法与边界：

| | NativeScript | 本仓现状的差别 |
|---|---|---|
| iOS 引擎 | **系统 JavaScriptCore** | 相同（已跑通） |
| Android 引擎 | **打包 V8**（约 8–12MB/ABI，用于完整 Node 风格 API） | **我们还没有** |
| JS↔原生 | **FFI 直调**（无序列化） | 现阶段 JSON 字符串（实测 ≈0ms/小树，见 §4） |
| 构建期元数据 | `metadata-generator` 生成绑定 | 未做 |

★NS 的「打包 V8」对我们是**过重的选择**：它换来的是完整 Node 兼容层，而 Proteus 的
逻辑层只需要「跑 Vue 运行时 + 调宿主注入的函数」。故本轮 spike 探了更轻的路。

### ★实测：QuickJS 随 Rust 一起编进 Android `.so`（复用既有 NDK 工具链）

| 项 | 读数 |
|---|---|
| 引擎 | QuickJS-**ng** 0.8.0（`rquickjs` 0.9 / `rquickjs-sys`） |
| 许可证 | **MIT**（QuickJS-ng：Fabrice Bellard / Charlie Gordon / Ben Noordhuis）——无 GPL 阻碍 |
| Android `.so`（含引擎，arm64） | **1597 KB**（对比：Rust 排版核心 `.so` 已 1124 KB） |
| **净增体积** | **≈473 KB**（引擎打进既有 `.so`，不新增文件） |
| 交叉编译 | ✅ 用**仓库既有 NDK**（`.tools/ndk`）通过；唯一前置是给 bindgen 传 `--sysroot` |
| iOS 侧 | 系统 JSC → **0 字节**（`-framework JavaScriptCore`） |

**★语言特性逐项探测（Vue 运行时的硬前提，全部 ✓）**

| 特性 | 为何关键 | 结果 |
|---|---|---|
| `Promise` + microtask | Vue 更新调度（`queueJob` → `Promise.then`） | ✓ |
| `Proxy` | Vue 3 响应式核心 | ✓ |
| `Reflect` | 响应式 handler | ✓ |
| `Object.defineProperty` | computed / 兼容路径 | ✓ |
| `Map` / `Set` / `WeakMap` | 依赖收集容器 | ✓ |
| `Symbol` | 内部标记 | ✓ |
| `Object.assign` | patch / 合并 | ✓ |
| `Array.from` / 模板串 | 渲染产物 | ✓ |
| `class` / 箭头函数 | 编译产物形态 | ✓ |
| `async` / `await` | 异步组件 / nextTick | ✓ |

> 探针：`/tmp/qjs-spike`（临时，未入库）用 Swift `dlopen` 宿主 dylib 逐项求值。
> 引擎无预生成 Android 绑定 → 必须开 `bindgen`；bindgen 需 NDK sysroot
> （`BINDGEN_EXTRA_CLANG_ARGS_aarch64_linux_android="--sysroot=... --target=aarch64-linux-android24"`）。

### 候选对比（含诚实代价）

| 方案 | 体积 | iOS/Android 一致性 | 代价与风险 |
|---|---|---|---|
| **A. iOS 系统 JSC + Android QuickJS** | iOS 0 / Android +473KB | ★**引擎不同** → 需 conformance 兜住语义差异 | 两套引擎的行为差异（见下「未验证项」） |
| B. 两端都打包 QuickJS | 两端各 +473KB（iOS 还需换掉现成的 JSC 链路） | 一致 | 放弃 iOS 系统引擎（体积/性能双输） |
| C. 两端都打包 V8（NS 路线） | 每 ABI 8–12MB | 一致 | 对只有 Vue 逻辑层的场景**过重** |
| D. Android 用系统 WebView 跑 JS | 0 | 差 | WebView 是异步边界 + 有 UI 依赖，违背「同步直调」铁律 A-02 |

**本轮倾向 A**（务实：iOS 不为已知可行的事付体积），
且**方案 A 的核心风险（两引擎语义分叉）已在本场景实测未出现**（见 §6 已补验表）。
★但**仍不是终局**：对拍只覆盖一个应用，且 QuickJS 在 **Android 真机**上的性能未测。

---

## 3. 逻辑层在整条链路里的位置（本轮的实测口径）

```
Vue 运行时（QuickJS/JSC）── diff/patch ──→ 语义树
        │  ↑ 更新由**事件驱动**（微任务）
        │  ①  适配器：树 → 引擎就绪布局请求（数值折叠 + 拍平）
        ↓  ②  【边界】JSON 字符串 或 JSI 直调 ←── 引擎选型影响的就是这一步
宿主（CoreText 度量 + **Rust 核心算几何** + 建 CALayer）
```

**★铁律 A-02（视图操作同步）在 QuickJS 下如何成立**：宿主注入的 `mount/update` 是
**同步 C 函数**（`rquickjs::Function::call`），调用即返回 —— 与 JSC 的 JSExport 同性质。
异步只出现在 **JS 内部**（Vue 的微任务调度），这与引擎无关（见 §4 发现 1）。

---

## 4. ★★本轮三条发现（都会影响其他端的接线方式）

### 发现 1：`evaluateScript` **不排空微任务** —— 而 Vue 的更新调度正是微任务

用最小 JSC 程序实测确认：`Promise.resolve().then(f)` 的 `f` 要等该次 `evaluateScript`
**返回**后才执行。后果：把「mount + 改 ref + 量结果」写在**一个**脚本里时，
`ref` 变更触发的重渲染**永远不会发生**（实测 `patch=0`、节点数不变），
看起来像「响应式失效」，实际是**宿主集成方式**的问题。

⇒ **正解：宿主逐相位驱动**（每次 `evaluateScript` 之间返回主线程，微任务排空）。
★这也解释了 NativeScript-Vue 为何不必处理：它跑在**完整集成的 runloop** 上，
VM 事件循环被持续泵动；而「一次性 evaluateScript 一个 bundle」不是。

### 发现 2：JSExport 方法**不能当裸值传递**（丢接收者）

`proteusSelfDraw.update` 裸传 → `self type check failed for Objective-C instance method`。
必须 `(j) => proteusSelfDraw.update(j)`。★症状是「该相位静默不记录」——
因为异常被 `catch` 吞了 ⇒ **异常必须可观测**（进报告，不吞）。

### 发现 3：嵌套 `style` 必须**显式展开**

Vue 把整个 `style` 对象作为一个 prop key 传下来（key === `'style'`），不是摊平。
不展开 → 全部落进「未知键」（实测 `unknown_keys: {style: 2646}`），
现象是**文字画出来了、卡片/圆角/强调色全没有**。

---

## 5. JS 逻辑层性能（iPhone 12 · 系统 JSC · 91–217 节点小树）

| 相位 | Vue 自身 | 适配器 | 序列化 | 宿主 | 合计 | 节点 | patch |
|---|---|---|---|---|---|---|---|
| mount（12 项列表） | 2ms | 0ms | 0ms | 10ms | **12ms** | 91 | 152 |
| update 结构路径（12→30） | 3ms | 0ms | 0ms | 8ms | **11ms** | 217 | 280 |
| update 纯样式路径 | 1ms | 1ms | 0ms | 8ms | **10ms** | 217 | 153 |
| **纯 JS 吞吐**（不调宿主） | — | — | — | — | **0.9ms/次** | — | — |

**三条读法**：
1. **Vue 自身只占 1–3ms** ⇒ 逻辑层**不是**瓶颈（连「要不要上 JSI」都可以先不急）
2. **宿主侧 8–10ms 是大头**（CoreText 度量 + Rust 布局 + 建层）⇒ 优化该往这里看
3. **序列化 ≈0ms**（请求仅 3.4–5.6KB）⇒ 本仓既有「JSON 通道慢」的担心**在小树上不成立**

> ★★**对照 NS-Vue 的口径**：NS 走 FFI 直调、**无序列化项**。我们走 JSON 字符串，
> 但实测该成本在小/中树上可忽略。**大树上必须重测**——这是明确的诚实边界，
> 不能拿小树数字宣布「不需要 JSI」。

---

## 6. 未验证项（**不允许**当成已验证）

### ✅ 已补验（原 1/2/3，本轮 spike 用**真 bundle** 跑出来的）

**同一个 Vue 应用（351KB bundle）在两端引擎上跑通，且渲染产物逐节点一致：**

| 相位 | JSC（系统） | QuickJS-ng | 一致？ |
|---|---|---|---|
| mount（12 项） | `nodes=91 texts=26 checksum=78548.00` | 同左 | ✅ |
| update 结构路径（12→30） | `nodes=217 texts=62 checksum=160367.00` | 同左 | ✅ |
| update 纯样式路径 | `nodes=217 texts=62 checksum=160367.00` | 同左 | ✅ |
| 收尾（回到 12 项） | `nodes=91 texts=26 checksum=78548.00` | 同左 | ✅ |
| 纯 JS 吞吐（40 次） | **1.0 ms/次** | **3.15 ms/次** | — |

**三条结论**：
1. **QuickJS 能跑真实 Vue 运行时**（`createApp().mount()` + 响应式更新全通，非仅语言特性探测）
2. **两引擎渲染产物逐节点一致**（节点数、文本数、几何指纹**逐位相同**）
   ⇒ 方案 A 的**核心风险面（语义分叉）在本场景下未被观测到**
3. **QuickJS 慢约 3×**（3.15 vs 1.0 ms/次纯 JS 吞吐）——与「无 JIT」的预期相符，
   **但绝对值仍很小**（3.15ms/次），且 iOS 侧不受影响（用系统 JSC）

★**同时暴露一件重要的事：QuickJS 需要显式泵动微任务**。
`rquickjs` 必须调用 `ctx.execute_pending_job()`；不调用则 Vue 的更新**同样不会落地**
（与 JSC 的 `evaluateScript` 不排空微任务是**同一个坑的两种表现**）。
⇒ 宿主集成规范必须写明这条，否则两端会各踩一次。

★**诚实边界（对拍未覆盖的面）**：本对拍只覆盖**一个应用**（列表 + 增删 + 样式变更）。
已知高风险面仍在，需更广用例才能下结论：`Date`/时区精度、`Number` 格式化与舍入、
正则行为、`Object.keys` 顺序、浮点显示、`Intl`（QuickJS 缺失）。**不能凭一次通过宣布等价。**

### 仍未验证

4. **JSI 本身未落地**：`02-native-binding.md` 的 JSI 规范目前无实现，现走 JSON 字符串。
   **是否真的需要 JSI** 应由**大树实测**决定，而不是默认要做。
5. **Android 宿主自绘未接**：Android 侧连「自绘管线」都还没与 Vue 接（iOS 本轮才跑通）。
6. **QuickJS 在 Android 真机上的性能未测**：上表是**桌面 macOS** 的数字。
   设备（尤其无 JIT 的 ARM）上的绝对耗时与相对倍率都可能不同 —— 需真机重测。
7. **`.vue` SFC 未走**：本场景是手写 render 函数，编译器链路仍未参与。

---

## 7. 建议的下一步（按依赖顺序）

1. **QuickJS 跑真实 Vue 应用**（spike → 真机）：验证 §6.1，产出 QuickJS 的数字与 JSC 对比
2. **两套引擎 conformance 对拍**：同应用 → 两引擎渲染树逐节点比对（§6.2）
3. **宿主集成规范**：把「微任务泵动」「JSExport 接收者」「style 展开」三条写成
   两端共用的接线清单（本轮的坑不该被第二次踩到）
4. **大树重测**：4050 元素场景下量边界成本，用数据决定 JSI 是否必要（§6.4）
