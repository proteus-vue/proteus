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

### 🎉 第十五里程碑：**帧率追踪（hitrace）—— 矩阵 22/22 全项完成**（2026-10-03，矩阵 #22）

> **`hitrace`（OpenHarmony 的 ftrace 前端，与 Android Perfetto 同族）**：后台采活动期 trace
> （App 启动 + 全探针链约 8.4s 窗口）→ `FrameS-BeginScene` 帧标记序列 → 帧区间统计。

| 口径 | 读数 |
|---|---|
| **p50（全窗口）** | **16.67ms —— 60Hz 精确** |
| **活跃期（连续出帧段 151 帧）** | avg **18.02ms → 55.5fps** |
| raw（含空闲间隔） | 19.64fps（如实并列——trace 窗口含空闲段） |

**三判据 PASS**：帧数 ≥30（166）· p50 在 8–40ms 带 · fps > 10。
**★与 Android Perfetto 的诚实差异**：Android 由系统直接给帧区间（Atrace + gfxinfo）；
鸿蒙从 ftrace 标记序列算（**量纲同、来源同族、解析层不同**）。

**采集**：`bash scripts/shoot-perfetto-harmony.sh`（零轮询：`&` 后台 trace + 内建 `wait`）；
证据 `results/perfetto.json` + `results/trace-frames.txt`。

---

## 🎉 鸿蒙腿 22/22 全项完成（2026-10-03）

| 阶段 | 覆盖 | 说明 |
|---|---|---|
| 起点（2026-10-02） | **4/22** | 仅"装机 + RenderNode 直绘 + 4050 基准"三件事 |
| 终点（2026-10-03） | **22/22** | ✅21 + 架构性不适用 1（#3 L2 光栅级——鸿蒙无宿主 CPU 光栅通路，**如实标注非"缺"**） |

**缺口的 18 项全部补齐**：命中/复用池/结构变更/文本/滚动（含 A/B 对照）/内核动画/内存/App 路由栈/
一致性快照（六端报告）/JSVM（Vapor + 宿主运行时，同一份 bundle 零移植）/平台动画/整树虚拟化/
手势（真注入·真时长分流）/字体族/原生组件混用/帧率追踪。

**贯穿全部 18 项的三条方法论**（都来自实测踩坑，非纸面原则）：
1. **先取证再断言**（设备列表 / SDK 头文件 / `uitest dumpLayout`——比截图快且准）；
2. **判据建错靶**是系统性风险（本轮抓出 4 例：核心窗口 vs 硬算 / 命中抽样窗口 / 期望值多算偏移 /
   bounds 字符串）——**判据侧的坐标系推导必须与实现侧一致**；
3. **同源材料零移植**优先：`bundle-vapor.js` / `bundle-host-runtime.js` / `vapor-tree.json` /
   `stress-44.json` 全部从 Android 侧复制（`gen-fixtures.mjs` 构建期刷新）——"两端跑的是同一份文件"
   比"两端各写一份等价实现"强得多。

### ✅ 第十四里程碑：**原生组件混用**（2026-10-03，矩阵 #10）

> ArkUI **原生组件**（Row/Text）与 Proteus 自绘内容**共存**——**三判据 PASS**
> （与 Android `native-host-verify.py` 三件事同族）：

| # | 判据 | 读数 |
|---|---|---|
| ① | **位置由核心决定** | 原生组件 bounds `[56,210][336,378]` == `nodeRect` 核心几何 (16,60) 80×48 ×3.5（**逐位相同**） |
| ② | 原生真的在渲染 | 目标区原生色占 **93.8%** |
| ③ | **z-order 实测** | 重叠区自绘蓝 = **0** ⇒ ArkUI 原生在上 |

**★定位语义四轮收敛（全部记进代码注释）**：
① Stack 默认**居中** ⇒ `.position` 从居中位置起算 ⇒ 偏下；
② `alignContent(TopStart)` 单独用 ⇒ **ContentSlot（自绘层）也跟着错位**（自绘全丢）；
③ 包全屏 TopStart 容器 ⇒ 自绘层仍丢；
④ **正解**：`.position` 相对**页面 Stack**（其 bounds `[0,168][1320,2758]` = 从状态栏下方起）
⇒ 补偿 `NATIVE_MIX_Y_COMP = 168px ÷ 3.5 = 48vp`（**状态栏占位，可复算，不是 magic number**）。
★另一个坑：`@State` 触发页面重建会**把 ContentSlot 重挂载** ⇒ 自绘内容随旧挂载点丢失
⇒ **分两帧**（先 setState、下一帧再渲染自绘）。

**★判据自检抓出的一处"判据建错靶"**：首版期望值又加了一次 Stack 偏移 ⇒ 把完全正确的组件判成错位
（第四例同类教训——**判据侧的坐标系推导要与实现侧一致**）。另：`dumpLayout` 的 bounds 是**字符串**
`'[56,210][336,378]'`，按数组解构会得 NaN ⇒ 恒判错。

**采集**：`bash scripts/shoot-native-mix-harmony.sh`（安装→场景→dumpLayout→截图→判据，零盲等）；
证据 `results/native-mix.json` + `results/native-mix.png` + `results/native-mix-layout.json`。

### ✅ 第十三里程碑：**字体族映射**（2026-10-03，矩阵 #9）

> typography 字族解析（`OH_Drawing_SetTextStyleFontFamilies`）——与 iOS V13 **同款样本文本**
> （`MMMM iii WWWW` / 32px）**四判据 PASS**。

| 字族 | 宽度 | 说明 |
|---|---|---|
| HarmonyOS Sans（默认） | **274.34** | 基线 |
| HarmonyOS Sans **Condensed** | **236.67** | 窄体分流 ✓ |
| HarmonyOS Sans **Digit** | **295.78** | 数字字体分流 ✓ |
| HarmonyOS Sans SC / Condensed Italic | 274.34 | ★如实：与默认同宽——**拉丁字形指标相同的真实行为**（非未生效） |

**判据**：① 六族宽度全正 ② 同族两次调用**完全一致**（反例对照防噪声）③ **≥2 族与默认显著不同**（实际 2 族）④ 高度合理。

**采集**：探针集（`PROTEUS_FONTFAMILY_PROBE`）；证据 `results/font-family.json`。

### ✅ 第十二里程碑：**手势（真注入 · 真时长分流）**（2026-10-03，矩阵 #7）

> **`uitest uiInput`（系统输入栈真注入）** → ArkTS `.onTouch`（标准触摸链，含真时间戳）
> → 样本落盘 JSONL（每段 down 点附核心 hitTest 结果）→ **三端中立识别器**（`packages/gesture`）分类。

| 段 | 注入方式 | 样本 | 按住时长（样本时间戳算） | 分类 | 命中（核心 hitTest） |
|---|---|---|---|---|---|
| 1 | `click` | 2 | **106ms** | **tap** | target 22 · chain 3 |
| 2 | `longClick` | 2 | **1517ms** | **longpress** | target 14 · chain 3 |
| 3 | `swipe` | 22 | 339ms | **swipe-up** | target 22 · chain 3 |

**判据 8/8 PASS**：段数 3 · tap/longpress/swipe 分类全对 · **零串扰** · 每段有命中 ·
命中 target 非空 · **时长由样本时间戳算出**（非声明）。

**★★本腿对 iOS V16 的关键超越**：iOS 的 `tapAt`/`longpressAt` 是"注入即声明类型"，
其报告诚实标注 `not_covered: UITouch->duration-classification`；鸿蒙经**系统输入栈真注入**，
分类器按**真实按压时长**判型（106ms→tap / 1517ms→longpress）——该缺口在此闭合。

**★实测两个坑**：① `addNodeEventReceiver(NODE_TOUCH_EVENT)` 在 customNode 上**收不到**
注入事件（rc=0 但零回调；hit test 模式也设了）⇒ 改用 **ArkTS `.onTouch`**（标准触摸链）；
② 分段不能按时间间隔切（**longpress 的 down→up 间隔就是按住时长 1517ms**——按 gap 切会把它劈成两段）
⇒ 按 **down/up 配对**切分。

**采集**：`bash scripts/shoot-gesture-harmony.sh`（安装→场景→三种注入→等样本→分类，零盲等）；
证据 `results/touch-samples.jsonl` + `results/gesture.json`。

### ✅ 第十一里程碑：**滚动深度接线（scroll-core，含原生 A/B 对照）**（2026-10-03，矩阵 #5）

> **Proteus 渲染路径滚动**：`scrollRoot(y)` 平移**根 RenderNode**（内容整体位移——与 Android
> "整层 translate" / iOS V12 载体位移同语义），SFC 夹具内容上滚 60 帧；
> **ArkUI 原生滚动**（Scroll 容器）同帧数对照——两路**串行**采集。

| 路径 | avg | p50 | p95 | fps |
|---|---|---|---|---|
| **Proteus**（RenderNode 根平移） | 16.64ms | 16.64 | 16.64 | **60.1** |
| **原生**（ArkUI Scroll 容器） | 16.64ms | 16.64 | 16.64 | **60.1** |

**★★实测抓出的编排缺陷（比读数本身更值钱）**：首版让滚动探针与 4050 原生基准**并发**跑 ⇒
两者抢同一主线程 ⇒ Proteus 滚动 p95 冲到 **200ms / max 615ms**（"滚动卡顿"假象）。
**串行化后（native bench 热读完成 → Proteus 滚动 → 原生滚动）全部归零**——
与"一条命令内不并行两件写同一产物的事"同纪律：**不并行两件抢同一主线程的事**。
（该缺陷藏得深：p50 一直是对的 16.66ms，只有 p95/max 暴露并发——**分布不是均值，长尾才是证据**。）

**采集**：`bash hosts/harmony/run-host-app.sh`（探针集里 SCROLL_CORE + SCROLL_DONE 两行）；
证据 `results/scroll-ab.json`。

### ✅ 第十里程碑：**整树级虚拟化（mount-virtual）**（2026-10-03，矩阵 #12）

> 同一份 SFC 产物 `vapor-tree.json`（与 Android/iOS 同源夹具）——**全树进核**（1502 节点；
> 虚拟化省的是**层**，不是树）+ 复用池（核心侧窗口决策）+ 宿主真执行层物化/回收 + 命中一致性。

| 判据（8/8 PASS） | 读数（真机，对照 Android） |
|---|---|
| 行数有界 | live 23（核心池窗口含预载边距；Android 17） |
| 复用生效 | created 26 / reused 956 / **复用率 0.9735**（Android 0.9744） |
| 决策全执行（不重建） | platform 982 == core_acquire 982 |
| 账目自洽 | acquire 982 = release 959 + live 23 |
| 可见行零缺失 | max_missing_in_visible = 0 |
| 命中全 OK 且落在已物化行 | 3/3（unmaterialized = 0） |
| 每帧处理 | 0.03ms（同步循环口径；Android 8.4ms 为 Choreographer 真帧） |

**★判据口径修正（本轮真机抓出）**：① 行数上界以"**核心池实际窗口**"为准——宿主硬算
`vph/rowH+1` 去卡核心的预载策略 = 拿宿主猜数否掉核心真数（判据建错靶）；② 命中抽样只抽
**当前窗口内**的行（抽窗口外 ⇒ 误报"命中了未物化行"——那正是设计意图）。

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
