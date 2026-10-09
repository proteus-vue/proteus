# Proteus 新宿主实现语义（New Host Implementation Semantics）

> **定位**：给"要新写/移植一个 Proteus 宿主（壳）"的人（或 AI）一份**可执行语义**——不是教程，
>   是把 iOS / Android 两套**已落地**宿主（决策 #692–#724）一路踩出来的**硬约束、失败形态、对齐基准、门禁**
>   固化成清单。**目标：新宿主不再"一步一坑"**（每加一环就在真机上发现漏一环，重来一遍）。
>
> **适用范围**：`proteus dev/build --target <端>` 背后那个**宿主工程**（CLI 从 `templates-host/<端>` 生成）。
>   iOS = 框架最全参照（`templates-host/ios/shell/`）；Android = 次新参照（`templates-host/android/src/dev/`）。
> **不适用**：runtime 内核本身（那是 `hosts/<端>/.../runtime` 或 AAR/HAR，另一层）、纯项目业务代码。
>
> **关联**：`AGENTS.md` §2 门禁 · `docs/proteus-host-runtime-package-plan.md`（runtime 独立发布，规划态）·
>   `docs/harmony-dev-channel-plan.md`（鸿蒙立项：**其壳无运行期，须先升运行期壳**）·
>   决策链 `docs/project-memory-archive/decisions.md` #692/#694/#698/#701/#704/#705/#706/#712–#724。

---

## 0. 三个必须先想清楚的问题（顺序反了必返工）

1. **"这端有运行期吗？"** —— 宿主渲染的是**构建期静态内容**（`app-screen-content.json`）还是**运行期 bundle**
   （`bundle-superapp.js`，含 router/events/响应式）？**没有运行期的壳，"热重载 / 事件上报"对它没有对象**
   （鸿蒙 CLI 模板即此形态——见 `docs/harmony-dev-channel-plan.md`）。
2. **"JS 引擎是持久还是一次性？"** —— iOS JSC = 持久上下文；鸿蒙 JSVM = **一次性 VM**（跨调用复用会崩）。
   一次性 VM 下 `eval`/实时 `/tree` 触不到"活着的 App 状态"，dev 命令语义要按此重设。
3. **"这端 runtime 以什么形态分发？"** —— iOS = **源集**（`runtime/*.swift` 随壳一起编译）；
   Android = **AAR 产物**（`prebuilt/.../proteus-runtime.aar`，已入库二进制）；鸿蒙 = HAR（源）。
   决定了它要"编译期一起编"还是"构建期拷产物"，以及**它怎么自愈**（§2）。

---

## 1. 核心心智模型：**壳归框架，项目归项目；宿主是一次性 scaffold**

- **宿主工程 = 框架产物的副本**。`createHost` 把 `templates-host/<端>` 整树拷进
  `dist/app/<端>/host/`，做 `{{appName}}`/`{{bundleName}}` 替换。**用户改的是项目 `src/`，不是生成的宿主**。
- **一次性 scaffold 的代价（本仓反复栽的根因）**：`createHost` 只在宿主不存在时跑 ⇒ **框架改了模板/runtime，
  已生成的宿主不会自动拿到** ⇒ 症状全是"**改了没生效**"（且**零报错**）。⇒ **每一个"框架拥有、但落在宿主里"的
  东西，都必须有自愈路径**（§2）。
- **落地判据（问自己）**：这个文件/产物是"**框架所有**"还是"**项目所有**"？
  - 框架所有（壳 `.swift/.java/.ets`、runtime 源/AAR、manifest 主题、native 配置注入）⇒ **打包前自愈覆盖**。
  - 项目所有（`src/`、路由、页面 SFC、`proteus.config`）⇒ **绝不覆盖**。

---

## 2. 自愈清单（★新宿主必须让"老宿主"自动拿到最新的一切）

**触发时机**：每次 `build --package` / `dev` 打包**之前**（`host-package.ts` 各端 `packageXxxHost`）。
**总原则**：**覆盖式**（不是"只补缺"）——模板是框架的；**幂等**（内容相同则不动、不计入变更）。

| 自愈对象 | 落点 | 判据/机制 | 本仓决策 |
|---|---|---|---|
| runtime **源集**（iOS/harmony） | `syncRuntimeUnits(hostDir, 端)` | 按 `PLATFORM_SPECS` 重拷源目录 | #692 |
| runtime **产物**（Android AAR） | `packageAndroidHost` 内 AAR 自愈：CLI 随包 prebuilt ⇄ 宿主 `libs/*.aar` **字节比对**，不同即覆盖 | #685 |
| **AAR 新鲜度**（防"源改了 AAR 没重建"） | `build-runtime-aar.sh` 写 `runtime/*.java` **内容哈希** → 门禁 `check:android-runtime-aar-fresh` 重算比对 | #721 |
| 壳**模板**（iOS `shell/*`） | `syncShellTemplates(hostDir, 端)` | 覆盖 `templates-host/<端>/shell/` | #692 |
| 壳**源**（Android `src/dev/**`，**不在 shell/**） | `syncAndroidShell(hostDir)` | 覆盖 `templates-host/android/src/**`（**注意：Android 壳不在 `shell/`，`syncShellTemplates` 结构性失效**） | #721 |
| **manifest 主题** | `packageAndroidHost` 内定向迁移（幂等字符串替换） | `NoTitleBar.Fullscreen` / `Material.NoActionBar` ⇒ **`Material.Light.NoActionBar`** | #670 / #724 |
| **native 配置**（权限/包名/版本/深色…） | `applyNativeConfigFromProject(hostDir, 端, root)` | 从 `proteus.config` 的 `native.<端>` 幂等写入 | #635 |
| **dev 变体常量** | `packageXxxHost(dev:true)` 就地覆写 `ProteusBuildConfig`（DEV/DEV_URL），构建后**还原** | #690 |

> ★**自愈事件要显形**：`dev`/`build` 打包后把 `ℹ …自愈…` 日志打出来（否则"宿主被更新了"静默发生，
>   用户以为"改了没生效"）。**静默自愈 = 用户以为没生效**。

---

## 3. dev 通道能力清单（**必接**——缺一即"面板少一块/点了没反应"）

**dev server 端点端无关**（`packages/cli/src/app-dev-server.ts`），宿主按方向对接：

### 3.1 宿主 → dev server（上报）
| 端点 | 时机 | 载荷 | 面板 |
|---|---|---|---|
| `GET /ping?screen=&env=&perf=` | **每 tick**（1–1.5s） | 当前屏 / 设备环境 / 性能 | 设备在线 + 指标卡 + Profiler |
| `GET /log?channel=project\|native&level=&text=` | 有日志即推 | 项目 `console.*` + 宿主 dev 事件 | Console |
| `POST /tree`（body=节点树 JSON） | 渲染/切屏后（**变更才推**） | 实例化节点树（含内核 rect） | Elements |
| `GET /trace?type=&id=&chain=&handled=&fired=[&src=]` | 手势后（排空式） | 手势派发链路 | Events |
| `GET /inspect?id=` | 命中元素后 | 被点节点 id | 元素高亮联动 |
| `GET /bridge?method=&ok=&ms=` | JS→原生 invoke 后 | 桥调用 | Network·项目通道 |

### 3.2 dev server → 宿主（下发）
| 端点 | 时机 | 语义 |
|---|---|---|
| `GET /version` | 每 tick 轮询 | 版本变 ⇒ **热重载**（重拉 `/bundle` → 重 eval → **保留当前屏**） |
| `GET /bundle` | 版本变 / 首启 | 拉运行期 bundle |
| `GET /cmd` | 每 tick 轮询（one-shot） | 面板命令（下 §3.3） |

### 3.3 面板 → 设备命令（`/cmd`，**键名以 dev server 为准**）
| type | 字段 | 语义 | 对齐基准 |
|---|---|---|---|
| `highlight` | **`nodeId`** | 高亮节点：**填充(alpha 0.18) + 描边**（两 Paint/Layer），色 = 品牌系统蓝 | iOS `highlightNode` |
| `edit` | `nodeId/key/value` | 就地编辑：**改树 + 全量重挂**（见 §3.4）+ **即时 toast** | iOS `applyLiveEdit` |
| `reset` | — | 重置为项目代码：**强制重挂**（`remount`）+ 清编辑态 + 重推树 | iOS `restoreProject` |
| `eval` | `expr` | REPL 求值（**一次性 VM 端语义受限**） | iOS `evalExpr` |

> ★**键名 bug 是静默失效高发区**：本仓实测——`highlight` 读 `id`（而 dev server 下发 `nodeId`）⇒ 恒收 0 ⇒
>   **高亮实质永不生效**。**认键名前先 grep dev server 的 `CmdEvent`**。

### 3.4 ★就地编辑：**必须"改树 + 全量重挂"**，不能走"增量改样式"
- **为什么**：增量通路的可改字段集是**窄子集**（Android 内核 `PatchStyle` 只有 width/height/flexGrow/padding/
  margin/display/…）；`flexDirection`/`justifyContent`/`alignItems`/`position`/`top`/… **不在其中**，而
  `#[serde(default)]` 对未知字段**静默忽略（不报错）** ⇒ "改了 flex 方向布局不动"（本仓实测）。
- **正解**：改宿主保存的**原始节点树**某字段 ⇒ **全量重建**（iOS `render(force:true)` / Android `mount(tree)`），
  走"完整字段"的建树通路 ⇒ **任意字段生效**。
- **值强转**必须做（`coerceLiveEdit`）：颜色按 hex、padding/margin 单值或 JSON、枚举按**内核封闭集**、
  其余"能解析数字则数字否则原串"；**非法值拒绝（不静默）**。禁改 `id/parentId/rect/tag/semantic`。
- **编辑后要推树**（`/tree`）：几何变了，面板得刷新，否则面板停在旧几何。

### 3.5 命令执行必须回执
每条命令执行后 `devLog(info/warn, "edit #id key=value …")` ⇒ 面板 Console 可见。**"回显 ≠ 生效"**——
`ok` 只代表"执行了这条通路"，**几何真变了没有要另证**（见 §5 判据）。

---

## 4. 启动语义（**不黑屏 + 有加载提示**）

**用户验收级要求**：启动**不能黑屏一下**，且要有**加载提示**（对齐 iOS #694）。三件事缺一不可：

1. **窗口/主题底色 = 页面同族浅色**：`onCreate` **之前**的**启动窗口**用的是 **theme 的 `windowBackground`**——
   运行期 `setBackgroundDrawable` **管不到**。⇒ 主题用**浅色变体**（Android：`Theme.Material.Light.NoActionBar`），
   否则启动窗口**闪黑一下**（`Theme.Material.NoActionBar` 是深色变体，本仓实测）。
2. **启动占位层**：内容就绪前遮住底（**项目背景色 + App 名 + 转圈 + 状态文案**；dev 文案"正在连接开发服务器…"）。
   首帧渲染完成即移除。失败态：**停转圈 + 改文案，保留占位**（不露黑底，用户看到"明确失败"）。
   ★**内容居中**（水平+垂直）——对齐 iOS `centerX/centerY` 约束。
3. **bundle 拉取不阻塞主线程**：dev 首拉走网络（含**有界重试**覆盖"App 先于 server ready"）⇒ **后台线程拉 +
   主线程回调**（占位期间转圈可见）。**主线程同步拉 + `Thread.sleep` 盲等** = 整个启动窗口主线程被占死 ⇒
   **占位不转、屏幕黑住**（本仓实测：最多 ~3s 黑屏）。

---

## 5. 读数语义（**防"恒定/不可能"的假读数**）

★★★**本仓三次栽在"口径错"上**（#710 恒定掉帧 / #714 归因 / #723 冻结），铁律：

1. **周期量必须"每 tick drain"，绝不烤进缓存**：
   - 帧统计（fps/帧间隔/掉帧）——**每 tick** drain（iOS 在 `perfJson()` 里；Android 在 UI 泵 `pumpFrames()`）。
     ★只在"**渲染后**" drain 会把一次切屏的 `dropped` **烤进缓存** ⇒ 之后每个心跳重发同一值 ⇒ **面板恒红**（#723 实测）。
   - 渲染分段（measure/layout/build_layers）——**排空式**（"真有渲染"的那一次才发，取用即清）；否则空闲窗口
     反复报上次的 65ms（#718）。
   - 波动量（console/trace/profile）——**排空式**（宿主取走即清）。
2. **"恒定读数"几乎必是口径错**（帧率必然抖动）；**"物理不可能"更直接**（`avg 5.7ms` ⇒ 175fps，120Hz 屏也到不了
   ⇒ 一眼假）。**先算物理上限，再信读数**。
3. **判据用"设备真值"，不用阈值近似**：掉帧 = 设备实测跳过 vsync 的帧数（`dropped`），**不是** `frameMs > 16.7`
   （59.4fps ⇒ 16.85ms 会被误判）。
4. **`frameMs` 两义要分清**：`frameMs` = **帧间隔**（多久出一帧，≈16.67ms）；**渲染成本**是另一个量（`drawCostMs`）。
   别拿"画一帧花多久"当"帧率"。
5. **两端键名必须逐字一致**（Android 要与 iOS `perfJson()` 同键名）⇒ 面板端无关；否则又是"静默端偏"。
6. **同语义两端 drain 时机必须一致**（都每 tick 或都排空——不能一端每 tick、一端只在事件后）。

### ★★★重绘语义（**2026-10-09 · 决策 #726 补**——"改了状态但画面没变、点一下才变"）

★**症状**（用户实测）：「二级页**滑动返回**页面没回到上一页，**点一下屏幕就更新**了」。
★**根因**：宿主重建了内容（`clearRoot`+重建树 / `mount`），但**没有帧被请求**——
**触摸事件自带一帧**（点击/拖动 ⇒ 画面刷新），而**返回键 / 边缘滑返 / 程序化导航**这类**非触摸**路径
重建后**无新帧** ⇒ 画面停在旧树。

| 端 | 重建内容 | 谁触发重绘 |
|---|---|---|
| iOS | 原生视图（`UIView`/`CALayer` 树） | **原生自带 invalidate**（view 变更即置脏 ⇒ 下一 runloop 合成） |
| Android | 原生 `View` 树 | **原生自带 invalidate** |
| **鸿蒙** | **`OH_ArkUI_RenderNodeUtils_*` 建的 RenderNode 子树** | **不自带** ⇒ 必须**显式**：① CAPI `OH_ArkUI_RenderNodeUtils_Invalidate(host)`（mark dirty）② ArkTS `getUIContext().postFrameCallback(<FrameCallback 实例>)`（请求一帧） |

★**铁律**：**非触摸驱动的重绘必须显式"请求一帧"**。自检问句：「这条重绘路径有没有触摸事件？」
没有 ⇒ 务必 `postFrameCallback`（鸿蒙）/ 对应端的 invalidate（其它端自带可省略）。
★与「瞬态只在一处 drain ⇒ 烤成常量」（Android #723）**同族**：都是**"重建了数据却没触发下游刷新"**。
★验证要**机器可判**：返回后**不触碰屏幕**截图 = 目标页（不是停旧页）。

---

## 6. 两端对齐检查表（**iOS 为基准**）

★**"三端内部自洽"不等于"与 iOS 一致"**（各端都可能集体走偏）。**判据只认 iOS 基准**。

| 面 | iOS 基准 | 新宿主须一致 |
|---|---|---|
| 高亮 | `fill(systemBlue α0.18) + stroke`（两元素） | 填充 + 描边（不是只有描边） |
| 启动占位 | 浅底 + App 名 + 转圈 + **居中** + 失败保留 | 同 |
| DEV 角标 | 可点展开底部菜单（渲染状态 + 一键重置 + 面板 URL） | 同（不是只有角标/toast） |
| 就地编辑 | 改树 + 全量重挂 + 即时 toast | 同 |
| 热重载提示 | 瞬时 toast（"⟳ 已热重载 · vN · 屏名"） | 同 |
| 重置 | 强制重挂 + 清编辑态 + 重推树 | 同 |
| dev 地址解析 | "启动注入优先 + 编译期 `DEV_URL` 兜底" | **同契约、不同实现**（iOS argv / Android intent extra / harmony want.parameters） |

### ★★★"平台体感"逐项对齐表（**2026-10-09 · 决策 #726 补**——"先让宿主跑起来"≠"宿主对齐"）

★★★**基准纪律（用户校正 · 2026-10-09）**：「**你不能用原来鸿蒙的参考宿主做基准啊，原来的参考宿主本身就有问题，你要看安卓 iOS 的 dev 宿主怎么实现的啊**」。
⇒ **对齐基准 = 该能力的 `packages/cli/templates-host/{android,ios}`（dev 宿主 · 产品壳）**，
**不是** `hosts/<端>/host-app`（**验证装置**——它有自己的坑，照它对齐 = 把装置的病搬进产品）。
下表右列"参考宿主"仅作**鸿蒙腿已落地能力**的线索，**判定一律回到 dev 宿主/平台标准原语**。

★**教训（用户实测反复）**：把运行期/上屏/导航接通后，**壳的"平台体感"仍可能整片缺**——
用户原话「鸿蒙 dev 宿主和开始安卓 iOS 一样的问题：**状态栏和底部安全区都是黑色的**，**没有滑动返回**，**滚动惯性没有**」。
⇒ **这三项（连同启动占位/状态栏）是"独立于渲染"的壳职责，必须逐项搬**。

| 体感面 | **平台标准做法（dev 宿主用的是这个）** | 新宿主须搬 |
|---|---|---|
| **状态栏/安全区不黑** | edge-to-edge + 窗口浅底 + 系统栏控制（iOS/Android 均如此；鸿蒙 `setWindowLayoutFullScreen`） | 同（否则状态栏/底部导航区成**黑带**——"窗口背景"问题，非"页面背景"） |
| **安全区内边距** | 平台避免区 API → `env`（`--pf-inset-*`）（Android `WindowInsets` / iOS `safeAreaInsets` / 鸿蒙 `getWindowAvoidArea`） | 同（随 `appScreenCommands` 的 `env` 下发 ⇒ 页面自让位）；★异步采集 ⇒ 取到后**再渲染一次** |
| **滚动惯性** | **平台 vsync 帧源**驱动减速（iOS `CADisplayLink` / Android `Choreographer` / 鸿蒙 **`displaySync`**） | 同（**绝不用 `setInterval`**——不与 vsync 对齐 ⇒ 主线程一忙就**攒批跳变**"卡一下再瞬间过去"）；★留 `momentumFrames/moved` 计数（机器证据） |
| **滑动返回** | 系统边缘滑返/返回键 → 返回栈（iOS `UIScreenEdgePanGesture`+`onBackPressed` / Android `onBackPressed` / 鸿蒙 `onBackPress`）；**禁叠自定义边缘手势**（与系统"最近任务"冲突） | 同 |

★**这些通路的验证要"可机器判定"**：状态栏/安全区看截图（黑带消失）；惯性看计数（`MOMENTUM_END frames/moved`）；
返回看日志（`BACK current=… depth=…`）。**只有手感 = 无法回归**（本仓纪律）。

---

## 7. 门禁清单（改宿主/模板后**必跑**，零设备）

| 门禁 | 抓什么 |
|---|---|
| `pnpm check:android-host-compile`（javac，含 `templates-host/android/src`） | 宿主编译错（含模板） |
| `bash hosts/ios/check-cli-host-compile.sh`（swiftc -typecheck 模板壳） | CLI iOS 宿主模板编译错 |
| `bash hosts/ios/check-selfdraw-compile.sh` | 框架 iOS runtime 编译错 |
| `pnpm check:android-runtime-aar-fresh` | **源改了 AAR 没重建**（内容哈希） |
| `pnpm check:bridge-sync` | `entry-superapp.ts` 真源 ⇄ CLI 随包副本漂移 |
| `pnpm check:host-layering` | runtime 不得反依赖 shell/dev；shell 不得反依赖 dev |
| `pnpm check:host-invoke-contract` / `check:host-tab-spec` | `screen.*` 三端一致 / tab 规格共享 |
| `pnpm test:coupled` | 内核源改动 ↔ 配套断言 |
| `pnpm check:hook-wiring` | 三条红线（sleep/重复测试/重复 verify）hook 接线 |

---

## 8. 反模式总账（#692→#724 逐个映射"症状 ⇒ 根因 ⇒ 铁律"）

| 症状（用户可见） | 根因 | 铁律 |
|---|---|---|
| 改了壳/runtime **没生效**（零报错） | 宿主是一次性 scaffold，模板改动不落老宿主 | §2 自愈清单，每样都要 |
| **点元素没高亮** | `highlight` 读 `id`，dev server 下发 `nodeId` ⇒ 恒 0 | §3.3 键名以 dev server 为准 |
| **改了 flex 方向布局不动** | 走增量 `PatchStyle`（字段子集 + 未知静默忽略） | §3.4 改树+全量重挂 |
| **启动黑屏一下** | theme `windowBackground` 深色（启动窗口）+ 主线程同步拉 bundle | §4 浅色主题 + 占位 + 异步 |
| **切屏后一直掉帧 / 掉帧率 100%** | 帧统计只在 render 时 drain ⇒ 烤进缓存 ⇒ 染色全部样本 | §5.1 每 tick drain |
| **掉帧率恒 100%（静止）** | `frameMs` 取"最近一次渲染成本"（非帧间隔）⇒ 恒 > 16.7 | §5.4 两义分清 |
| 面板**打不开/空白** | 面板 JS 住在**模板字面量**里，正则 `\/` 被吞 ⇒ 整段脚本语法错 | 面板/内联代码别写带反斜杠的正则 |
| 面板**Elements 停旧屏** | 树只在 render 时推；交互/切屏绕过 render | §3.1 每 tick 现取树 |
| `adb install` 报 **device offline** 但 doctor 全绿 | doctor devices 组 `slow` 默认跳过（"没查"≠"正常"） | "工具全绿"先问"查了没查" |

---

## 9. 新宿主 Checklist（逐项打勾 = 对齐 iOS 的最小完整集）

**架构**
- [ ] 确认**有运行期**（渲染 `bundle-superapp.js`，非静态 JSON）；无则先升运行期壳
- [ ] JS 引擎模型确认（持久 / 一次性）；一次性 VM 的 dev 命令语义按此重设
- [ ] runtime 形态确认（源集 / 产物），选对应自愈路径（§2）

**自愈（打包前）**
- [ ] runtime 源自愈 + AAR 新鲜度门禁
- [ ] 壳源自愈（**注意壳可能不在 `shell/`**——Android 在 `src/dev/`）
- [ ] manifest 主题自愈（浅色变体）
- [ ] native 配置注入；自愈事件显形（打日志）

**dev 通道**
- [ ] dev/release 变体常量（DEV/DEV_URL）；dev 地址解析（注入优先 + 编译期兜底）
- [ ] 上报：`/ping`(每 tick) `/log` `/tree`(变更才推) `/trace` `/inspect` `/bridge`
- [ ] 下发：`/version`→`/bundle` 热重载（**保留当前屏**）；`/cmd` 轮询
- [ ] 命令：`highlight`(nodeId·填充+描边) / `edit`(改树+全量重挂+toast) / `reset`(remount) / `eval`
- [ ] 命令回执（`devLog`）

**启动**
- [ ] 主题 `windowBackground` = 浅色（不闪黑）
- [ ] 启动占位（浅底 + App 名 + 转圈 + 文案，**居中**；失败保留）
- [ ] bundle 异步拉（后台 + 主线程回调 + 有界重试，**不阻塞主线程**）；首帧后撤占位

**读数**
- [ ] 帧统计**每 tick** drain（不烤缓存）
- [ ] 渲染分段**排空式**；波动量**排空式**
- [ ] 掉帧用**设备真值** `dropped`；`frameMs`(帧间隔) 与 `drawCostMs`(成本) 分开
- [ ] 两端**键名逐字一致**

**Chrome / 对齐**
- [ ] DEV 角标可点菜单（状态 + 重置 + 面板 URL）
- [ ] 高亮填充+描边；编辑 toast；热重载 toast
- [ ] tab 栏读共享规格（`TAB_BAR_SPEC`）

**门禁**
- [ ] §7 全部门禁绿（改宿主/模板后先跑，再上真机）

---

## 10. 一句话心法

- **壳归框架，项目归项目**；**框架拥有的东西必须有自愈路径**（否则"改了没生效"）。
- **"改了没生效"先查三件事**：① 跑的是新代码吗（宿主/runtime/AAR 陈旧？）② 这条通路认这个字段吗（增量 vs 全量）
  ③ 键名/事件名对得上吗。
- **读数三戒**：恒定量 = 口径错 · 不可能值 = 口径错 · 单次事件别进缓存。
- **对齐只认 iOS 基准**，"三端自洽"是假绿。
- **每一步都要有"设备端证据"**（真机读数 / 截图 / logcat），别停在上屏前的假设。
