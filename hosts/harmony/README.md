# hosts/harmony —— 鸿蒙真机接入（设备 + 工具链 + 首日实测记录）

> 状态：**设备已打通**（2026-10-02 首验）。宿主本体**尚未落地**——
> 落地方案见 `docs/Proteus_鸿蒙宿主落地与方舟引擎能力开放方案.md`（RenderNode 直绘路径）。
> 本目录当前只有**接入包装**（`hdc.sh`），没有宿主代码。

## 设备档案（2026-10-02 实测读数）

| 项 | 值 | 备注 |
|---|---|---|
| 厂家/型号 | HUAWEI **KLE-AL00U** | `param get const.product.model` |
| 系统 | OpenHarmony **7.0.0**（`KLE-AL00 7.0.0.109(SP6C00E105R3P3)`） | |
| **API 版本** | **26** | `const.ohos.apiversion`；★ ≥20 ⇒ 方案要求的 **RenderNode 直绘可用** |
| 屏幕 | 1320×2856 @ 120Hz（多档 120/90/72/60/45） | `hidumper -s RenderService -a screen` |
| 设备序列号 | `69F9K26126005311`（hdc connect key） | |
| 可用系统工具 | `aa` / `bm` / `uitest` / `hidumper` / `hilog` / `param` | E2E（安装/启动/UI 自动化/日志）四件套齐 |

## 工具链

| 组件 | 位置 | 版本 |
|---|---|---|
| **hdc** | `<DevEco>/Contents/sdk/default/openharmony/toolchains/hdc` | **3.2.0d**（必需） |
| 构建 | `<DevEco>/Contents/tools/hvigor/bin/hvigorw` | DevEco 6.1.1 |
| 包管理 | `<DevEco>/Contents/tools/ohpm/bin/ohpm` | DevEco 6.1.1 |
| DevEco 本体 | `/Volumes/data1/work/office-applications/DevEco-Studio.app` | 6.1.1.300 |

★旧 SDK 的 hdc 1.2.0a（`/Volumes/data1/work/office/Library/Huawei/Sdk/...`）与 HarmonyOS 7
设备**协议不兼容**（枚举为空）——一定要用 DevEco 自带的 3.2.0d。

## 接入方式

```bash
bash hosts/harmony/hdc.sh check              # 诊断（工具链/密钥/设备——只读）
bash hosts/harmony/hdc.sh list targets -v    # 透传任意 hdc 命令
bash hosts/harmony/hdc.sh shell "echo hi"
```

### ★★★ 最大的坑：密钥必须是 RSA-3072（2026-10-02 实测 40 分钟排查）

设备端按 `RSA_BIT_NUM=3072` 分配验签缓冲、声明 `rsa_3072_sha512` 方案；
而 `hdc keygen` 生成 **4096 位** ⇒ 验签必然失败 ⇒ **设备永远 `Unauthorized`**。

**症状**：设备上反复点「始终信任」都没用（每次弹窗、每次都失败）——
因为失败发生在**签名验证**阶段（你点的授权只是把公钥加入 known_hosts，随后验签就挂了）。

**修法**（手工生成 3072 位 + PEM 公钥）：
```bash
mkdir -p ~/.harmony
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out ~/.harmony/hdckey
openssl pkey -in ~/.harmony/hdckey -pubout -out ~/.harmony/hdckey.pub
chmod 600 ~/.harmony/hdckey ~/.harmony/hdckey.pub
```

其余两条：
- 公钥必须落 `~/.harmony/hdckey.pub` 且为 **PEM**（hdc 认证路径用 `PEM_read_PUBKEY` 读；keygen 旧格式是 base64 blob，会报 `read pubkey ... failed`）；
- 设备侧：开发者选项 → USB 调试 + 弹窗「允许/始终允许」——**每换一次主机密钥，设备端授权作废、要重新点**（排查期反复换密钥 = 反复失效）。

## 下一步（宿主落地，按方案文档）

1. **建最小 hap 工程**（`hvigorw` 脚手架）→ `bm install` 到本机设备 → 证明"装机+启动"链路；
2. **方舟能力侦查**：RenderNode（API 20+，本机 API 26 满足）/ NodeAdapter 复用池 / RS 指令面；
3. **宿主核心**：Proteus 指令流 → RenderNode 树（方案 §2.2 路径 B）；与 Android/iOS 同构的
   `ScreenHost` 端口（`screen.mount/visible/anim`）→ 真机跑 `check-app-stack.py` 的鸿蒙腿；
4. 鸿蒙腿进 `check-app-stack.py`（该脚本已支持两端字段形态判别——鸿蒙报告加 `engine_available` 或独立形态）。

## 与 Android/iOS 的对照（接入层）

| | Android | iOS | HarmonyOS |
|---|---|---|---|
| 设备工具 | `adb`（`~/Library/Android/sdk/platform-tools`） | `xcrun devicectl` | **`hdc`（DevEco 内）** |
| 工具位置约定 | SDK 标准路径 | Xcode 标准路径 | ★**非标准**——必须从 DevEco 解析（见 `hdc.sh`） |
| 授权机制 | USB 调试（一次性） | 开发者信任（一次性） | **RSA 密钥认证**（3072 位；换密钥需重授权） |
| 本项目包装 | `hosts/android/*.sh`（直接用 adb） | `hosts/ios/run-selfdraw.sh`（devicectl） | `hosts/harmony/hdc.sh`（本文件） |

---

## 宿主工程（host-app/）—— ✅ 第三里程碑：**4050 应用级基准（M5）· 三端数据齐**（真机）

> **2026-10-02 实测**（HUAWEI KLE-AL00U · API 26 · 与 Android **同一份夹具** `app-4050-tree.json`）：

| 路径 | 实测（3 次一致） | 备注 |
|---|---|---|
| **Proteus**（Rust 核 + RenderNode） | **66~67ms**（排版 10ms + 直绘树 48ms） | 「提交级」：建树→排版→4000 RenderNode 构建（未上屏） |
| **原生 ArkUI**（声明式 4050 元素） | **539~549ms** | 「渲染级」：onAppear 全触发（含首帧构建+挂载） |
| 比值 | **0.12** | ★口径不对称——原生含更多工作（见报告 caveats，不反推等口径倍数） |

**一键复跑**：`bash hosts/harmony/run-host-app.sh`（装机→启动→RenderNode 直绘→4050 基准，全自动零盲等）。
**报告**：`results/bench-4050.json`（含三端对照与诚实边界）· `results/host-app-run.txt`（原始日志行）。

**跨端布局核一致性**：同一份 `packages/layout-core-rust`（taffy-0.14）——
Android 走 JNI、iOS 走 staticlib、**鸿蒙走 `aarch64-unknown-linux-ohos` 交叉编译 + C ABI**（无绑定层）。
交叉编译脚本：`bash hosts/harmony/build-rust-core.sh`（产物 `cpp/thirdparty/libproteus_layout_core.a`，gitignore）。

### ✅ 第九里程碑：**宿主运行时（G-39）**（2026-10-03，矩阵 #18）

> **JSVM eval 与两端同一份 `bundle-host-runtime.js`（零移植）** + **真生命周期转发**：
> HOME 键（`uinput -K -d 1 -u 1`）→ `onBackground` → JS `__proteusHostShellLifecycle('pause')`；
> `aa start` → `onForeground` → `('resume')`——真事件源与 Android `input keyevent HOME` 同法。

**判据（与两端共用 `check-host-runtime.py`，核心组全绿）**：

| 组 | 判据 | 读数（真机） |
|---|---|---|
| A/B | 状态机 + 四条非法转换拒绝 | created→running→suspended→running→destroyed · 拒绝记账 5 条 |
| **C** | **真壳转发**（壳把生命周期交给 runtime） | pause→**HIDE** / resume→**SHOW**（逐条驱动能力总线） |
| D | 队列 + **job 泵** | 挂起不推进(0) / 恢复消费(1) / 同帧消化(2) / **EXPLICIT 微任务 + 宿主 checkpoint**：run 未解析→finish 已解析 |
| E | 职责边界 | 后台线程诚实拒绝 · 未注册调用拒绝 · 注册后 echo 成功 |
| F | 内存账本 | `GetHeapStatistics` engine 口径：+277KB 分配 / GC 回收 −476KB |
| G | G-41 conformance | **32/32 全过** |

**采集**：`bash hosts/harmony/run-host-runtime.sh`（安装→等主报告→HOME 键→回前台→取两份报告→共用判据，零盲等）。

**★三个实测坑（全记进代码注释）**：① **VM scope 缺失**（`OH_JSVM_OpenVMScope`）⇒ 逐调用报
`API Misuse: without an active VM scope`（功能不受阻但违反契约）——`jsvmProbe`/`vaporProbe`/`hostRuntimeProbe`
三处都补了；② **报告结构要对齐**（Android Java 把 run/finish 的键**合并进顶层**，我首版放成嵌套
⇒ 判据报 `ok=None`）——按 Java put 覆盖语义做顶层合并；③ **J/K 分档条件按"能力面缺失"判**
（不是"探针是否跑过"——探针会跑完 done=true 但能力为空）⇒ 将来实现自动回到严格档。

**诚实边界**：J（10 项原生能力经壳转发）/K（App 级事件源三环对齐）属能力开放批次，**如实跳过**；
鸿蒙渲染 Transform 语义差异说明见第八里程碑。

### ✅ 第八里程碑：**平台零参与动画（MA0-RT）**（2026-10-03，矩阵 #15）

> **RenderNode 变换 + VSync 帧回调逐帧写属性**——动画期间应用层**零绘制、零布局**：
> `SetTransform`(m30=x 平移) / `SetScale` / `SetOpacity` 三个属性写入 + 两个读回（GetScale/GetOpacity，
> **写→读证据链**），目标节点 = 根 RenderNode 的第一个子节点（`GetChild(root, 0)`）。

**判据（与 Android `check-platform-anim.py` A 组共用，全绿）**：

| # | 判据 | 读数（真机） |
|---|---|---|
| A1 | 贝塞尔来自内核 | Rust `anim_curve_bezier`：[0.255, 0.76, 0.515, 1.03] |
| A2 | model 值逐帧推进 | 8 个不同读数（tx 0→17.14→34.29→…→120） |
| A3 | 终态精确 | tx=**120.0** · alpha=**0.5**（scale 1→0.6） |
| A4 | **主线程零参与绘制** | **draw_delta=0**（指令构建计数全程恒定 =1） |

**采集**：`bash hosts/harmony/run-platform-anim.sh`（装机 → 启动 → 等报告落盘 → 共用判据，零盲等）。

**★语义差异（如实标注，不冒充等价）**：Android 走 `ViewPropertyAnimator`——一次性启动后
**RenderThread 自主插值**（应用零调用）；鸿蒙 C-API 无同形"启动即自插值"入口 ⇒ 本探针由
**帧回调步进**（与系统动画同一 VSync 帧源），每帧仅 3 次属性写入 + 2 次读回——"应用层零绘制、
渲染进程负责合成"成立；"插值完全归平台"在鸿蒙当前 API 下无等价物。

### ✅ 第七里程碑：**JSVM(V8) 打通 —— Vapor 设备端链与 Android 共用同一份 bundle**（2026-10-03，矩阵 #14 + #13）

> **零移植**：鸿蒙不重写 JS 链——`OH_JSVM_*`（V8 封装，SDK 自带 `libjsvm.so`）直接在设备上
> eval **与 Android 完全同一份** `bundle-vapor.js`（465KB IIFE）⇒ 设备端实例化 + 订阅驱动增量
> 全链成立，**共用同一份判据** `check-vapor-device.py`（①–⑥ 绿；⑦绘制通道/⑧tap 按 `host_id` 如实跳过）。

| 判据 | 读数（真机 HUAWEI KLE-AL00U） |
|---|---|
| JSVM 可用性（`jsvmProbe`） | init→VM→Env→Compile→Run 全 `JSVM_OK`，`6*7=42` |
| 设备端实例化 | 26 节点 / 模板 12 + 运行时分配 14 / 展开 8 行（**不是构建期烧死的**） |
| 数据回填 | 非空文本 9 · 带 width 11 |
| 宿主 mount + 离屏自检 | 26 节点 · 26 指令 · **像素采样 1,199,700 · 9 色** |
| **订阅驱动增量** | 3 轮 · 183 字节二进制指令 · 探针节点（第 2 行宽度槽位）**52 → 80** |
| 文本同步（判据⑥） | 3 处（逐轮 1——"读了没入表"缺陷的回归锁） |

**一键复跑**：`bash hosts/harmony/run-vapor.sh`（装机 → 启动 → 等 `PROTEUS_VAPOR_DONE` → 取报告 → 判据）。

**宿主桥（4 方法，全部返回 JSON 字符串）**：`mount` / `applyOps` / `readRects` / `probeChannels`
——经 `JSVM_Callback`（`JSVM_CallbackStruct{fn,data}`）反向注入 `globalThis.proteusHost`；
bundle 侧代码 `JSON.parse(proteusHost.mount(...))` **一字未改**。

**★本轮实测三个坑（都记进代码注释）**：

| # | 坑 | 现象 | 根因 | 修法 |
|---|---|---|---|---|
| 1 | **漏开 HandleScope** | 真机 CppCrash（栈回溯 `OH_JSVM_CreateObject+112`） | `jsvmProbe` 开了 scope 所以没事；`VaporProbe` 首版漏开 ⇒ 任何 JSVM 值创建都崩 | `OH_JSVM_OpenHandleScope` 必须在任何值创建前；`CloseHandleScope` 在 DestroyEnv 前 |
| 2 | **parseByteArray 丢 0 字节** | `applyOps` 三轮全 `applied=-1`（decode_ops 失败） | 条件写成 `v > 0`——而**二进制指令流里 0 是合法字节** | `v >= 0`；教训：区间过滤要对着**数据域**核（整字节 ≠ 正数） |
| 3 | 沙箱文件 hdc 读不到 | `Error opening file: permission denied`（el2 路径） | 应用沙箱对 shell 不可读 | 用 **el2 映射路径** `/data/app/el2/100/base/<bundle>/haps/.../files/`（shell 可读） |

**与 Android 的口径差异（诚实边界）**：① 内核单位 = 设计单位（Android 为物理单位），各自内部一致；判据只断言相对变化。② tapAt/onGesture 未接（手势属矩阵 #7）——JS 侧按 `typeof` 自动跳过，不造假。

### ✅ 第六里程碑：**SFC 压力夹具上屏 · 六端一致性报告入列**（2026-10-02，矩阵 #21）

> `examples/pages/consistency-stress.vue`（44 节点 · 10 行 v-for · 行内动态绑定）的编译器产物
> → 构建期实例化（`fixtures/stress-44.json`）→ Rust 排版（视口 = 真实屏幕逻辑尺寸 377.14×816）
> → **RenderNode 直绘上屏**（44/44 节点）→ `uitest screenCap` 截图 → **第六端样本 `sfc.harmony.png`**。

**采集**：`bash scripts/shoot-stress-harmony.sh`（装机 → `--ps scene stress` → 等首帧主动上报
`PROTEUS_SFCSTRESS_FRAME` → 抓读数 → 截图 → 特征色探针，全自动零盲等）。

**判据（机器判定）**：探针 `ok:true` · 节点 **44** · 上屏 **44** · 锚块几何 **[16,60,80,48] 与 SFC 声明逐位相同** ·
首行 [16,151,345,52]（行宽 = 屏宽 377.14 − 32）· 留白 **16.3/16.3** 过报告硬断言 · 跨端差异 2.44~3.09%（正常带宽）。

**★本轮实测的两个坑（都是"解析器不假设输入格式"）**：

| # | 坑 | 现象 | 根因 | 修法 |
|---|---|---|---|---|
| 1 | `"nodes":[` 精确匹配 | 探针报"夹具无 nodes"（值全对） | 夹具是 pretty-print（`"nodes": [` **带空格**） | `extractNodesArray`：定位键后跳到 `[`，括号计数取配对串（容忍任意空白） |
| 2 | `"key":"` 精确匹配 | 画面**什么都没有**（几何全对、全透明）；指令里 `"color":0` | 同上（`"backgroundColor": "#2f6fed"` **带空格**） | `jstr`：定位键 → 跳过冒号后空白 → 读引号串 |
| 3 | **宿主度量表缺位** | **色块全对、文字全消失**（行文本不显示） | 夹具行文本**无显式 height**（靠文本度量）——内核契约是"度量表随树给"，鸿蒙腿 `textMeasures:{}` ⇒ 文本节点高 0 ⇒ 画布 0px。对照：Android `TextPaint`/iOS CoreText/Web 行盒都有真实度量 | 宿主侧 `measureTextTypoPx`（typography 同引擎度量，物理字号量、换回设计单位）注入 `textMeasures` |

**上屏链（数据流）**：`sfcStressCommands(fixture, density, vpW, vpH)`（C++：排版 → 合并节点样式 × 密度
→ 渲染指令数组，物理 px）→ ArkTS `renderCommands(json)` → RenderNode 子树挂全屏根节点。
★**几何 × 样式 × 密度三合一在 C++ 一处产出**——ArkTS 只做 transport（零逻辑、零单位猜测）。

**截图工具实测**：`uitest screenCap` 出 **PNG 无损**（首选）；`snapshot_display` **只支持 .jpeg**
（压缩伪影把跨端差异率抬高 ~0.9 个百分点，实测 3.53% → 2.60%，勿用于一致性样本）。

### ★★★ 渲染树架构（2026-10-02 第二次修正，最终形态）

**一个全屏 host customNode + 一个根 RenderNode + 元素为其子节点**（`AddChild`）：

| 形态 | 结果 |
|---|---|
| 首版：每元素一个 host customNode | ❌ 每个 host 都被 **ArkUI 布局流**接管（Stack 居中）⇒ 整组色块被居中、偏离设计坐标 |
| **正解：全屏 host + 根 RenderNode + AddChild** | ✅ 元素在**屏幕绝对坐标空间**内定位（与 Android "全屏 View + Canvas 绝对坐标"同构） |

**单位模型（同批修正）**：`RenderNode.SetSize/SetPosition` 与 content modifier 的 canvas 是**物理 px**；
而 customNode 的 `NODE_WIDTH/NODE_HEIGHT` 是 **vp**。⇒ ArkTS 侧设计值 ×`vp2px(1)` 后下发（换算一处）；
host 尺寸 ÷密度。实测链：`vp2px(1)=3.5` + canvas 宽 = 下发值 ⇒ 两套单位确认。

### ★ 本轮实测坑（鸿蒙 UI 线程看门狗）

| # | 坑 | 现象 | 修法 |
|---|---|---|---|
| 1 | **THREAD_BLOCK_6S** | 主线程卡 6 秒被系统杀进程（`will exit because THREAD_BLOCK_6S`）——首版 `readFixture` 逐字符 `out += String.fromCharCode()`（435KB ⇒ O(n²)） | `util.TextDecoder` 一次解码（2ms） |
| 2 | 基准必须分档 | 4050 全量单次调用可能长时独占 UI 线程 | 分档（500/2000/4050）+ 档间 `setTimeout(16)` 让出 |
| 3 | hilog 浮点格式 | `%{public}.2f` 显示 `<private>` | 用 `%.2f`（不带隐私标记）；或只看 JSON 字段 |

---

## 宿主工程（host-app/）—— ✅ 第二里程碑达成：**RenderNode 直绘**（真机证据）

> **2026-10-02 实测**：Proteus 指令流（RenderCmd 同形 JSON）→ NAPI → C++ →
> `OH_ArkUI_RenderNodeUtils_*` **直建渲染节点树**（4 个圆角矩形，见 `results/render-node-demo.jpeg`）——
> **绕过 ArkUI measure/layout**（方案 §2.2 路径 B；本机 API 26 ≥ 20 满足）。
> 落地位置：`entry/src/main/cpp/{CMakeLists.txt,proteus_render.cpp}` + `pages/Index.ets` 接线。
>
> ★★**CAPI 初始化坑（实测 40 分钟）**：`OH_ArkUI_RenderNodeUtils_CreateNode()` 在 CAPI 未初始化时
> 返回 **null**（现象：`nodes=0` + `reason=create-node-null`）。首个 `OH_ArkUI_GetModuleInterface(...)`
> 调用会触发初始化 ⇒ **必须在任何 RenderNode API 之前调用一次**（本实现在 `attach()` 里做）。
> 另两个实测坑：① hilog 的 `LogType` 是宏第一参（用 `OH_LOG_Print(LOG_APP, LOG_LEVEL, ...)`）；
> ② ArkTS 严格模式禁 `any`/无类型对象字面量（`.d.ts` 要显式 interface）。

### 第一里程碑：装机 + 启动（已完成）

> **2026-10-02 实测结果**：`entry-default-signed.hap`（155KB）→ `bm install` **成功** →
> `aa start` **成功** → 宿主主动上报 `PROTEUS_HOST_READY model=KLE-AL00U os=OpenHarmony-7.0.0.105 api=26`
> → **界面完整渲染**（截图 `results/host-app-launch.jpeg`，1320×2856）。
> 全链纯 CLI（用户仅需在 DevEco 登录华为账号生成签名一次）。

```bash
bash hosts/harmony/build-host-app.sh          # 构建（离线 CLI，7~12 秒；自动提示签名状态）
bash hosts/harmony/run-host-app.sh            # 装机 + 启动 + 机器验证（等宿主主动上报，零盲等）
```

**工程形态**：DevEco 标准 Stage 模型（`bundleName=dev.proteus.host`）——
`EntryAbility` 启动时向 hilog 打 **`PROTEUS_HOST_READY model=... os=... api=...`**
（宿主**主动上报**启动信号；`run-host-app.sh` 用 `wait_for.sh` 条件等待它——零 sleep）。

**构建链已实测打通（2026-10-02）**：DevEco 自带全套工具（hvigor 6.24.4 + node 18 + JDK 21 + SDK API 24），
三个环境变量（`NODE_HOME` / `DEVECO_SDK_HOME` / `JAVA_HOME`，脚本已自动设置）即可纯 CLI 构建。

### ★★★ 签名：本设备需要华为账号（✅ 已完成一次——2026-10-02）

> **现状**：华为账号签名已生成（`~/.ohos/config/default_host-app_*.{p12,cer,p7b}`，profile 白名单含本机 UDID），
> `build-profile.json5` 已带 signingConfigs（machine-local）——之后全程 CLI（build→install→run）。
> 下方是踩坑记录（为何社区签名不可用），供换机/换设备时重读。

**实测结论（两层证据）**：
1. 用 SDK 自带 **OpenHarmony 社区调试材料**（p12 + profile 模板，含写入本机 UDID 的 profile）
   签出的 hap：**本地 `verify-app` 通过**（`Verify success`），但**设备拒装**：
   `error: failed to install bundle. code:9568257 error: fail to verify pkcs7 file.`
2. 设备是**华为商业版 HarmonyOS 7**（系统应用全为 `com.huawei.hmos.*`）——
   其 `bm install` 的 pkcs7 校验链只认**华为 CA** 签发的调试证书。

**⇒ 换设备/重装时需做一次（约 2 分钟，本机已做完）**：
1. 打开 DevEco Studio（本机：`/Volumes/data1/work/office-applications/DevEco-Studio.app`），
   用**华为开发者账号**登录（右上角头像 → 登录）；
2. 打开本项目：`File → Open → /Volumes/data1/work/office/debug/proteus/hosts/harmony/host-app`；
3. `File → Project Structure → Signing Configs` → 勾选 **Automatically generate signature**
   → Apply（DevEco 会自动注册本机设备 UDID 并生成 p12/cer/p7b，写入 `build-profile.json5`）；
4. 之后回到命令行：`bash hosts/harmony/build-host-app.sh && bash hosts/harmony/run-host-app.sh`
   —— 全程 CLI，不再需要 IDE。

> **纪律（已落地为 git 机制）**：`build-profile.json5` 里的 signingConfigs 含**本机凭据**
> （本机路径 + DevEco 加密口令）——属 machine-local，**不入库**。机制 = 本文件在仓库里保持
> **空 signingConfigs 模板**，本机改动用 `git update-index --skip-worktree` 隔离：
> · 本机构建正常（DevEco 写入的签名配置在本地文件里）；
> · git status 不显示该文件改动、提交不受影响。
> 换机/重克隆后：在 DevEco 重做一次自动签名，然后跑
> `git update-index --skip-worktree hosts/harmony/host-app/build-profile.json5`。
> （撤销隔离：`git update-index --no-skip-worktree <该文件>`）

### 已排除的路线（实测，勿重走）

| 路线 | 结果 |
|---|---|
| SDK 自带 OpenHarmony 调试材料 + 写入本机 UDID | 本地验签通过，**设备拒装**（pkcs7） |
| 复用 DCloud uni-app x 的签名材料（`hello-uni-app-x/harmony-configs`） | 其 profile 白名单 34 个 UDID，**不含本机设备**（`1F8CD143...`） |
| 未签名 hap 直接装 | `code:9568320 error: no signature file`（预期） |

设备 UDID（注册用）：`1F8CD143FE62DE1AD62861FAA08BBFFEC67AE75A491D3CB38FB4C830A7F2C0CD`
