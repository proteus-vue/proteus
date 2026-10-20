// hosts/ios/ProteusHost/runtime/host-exports-protocol.swift
// ★★★#1102：**JS ↔ 宿主 协议声明**（`SelfDrawExports`）——从 `selfdraw-scene.swift` 机械搬迁。
//
// 【职责单一】只有 `@objc protocol ... JSExport` 的方法声明与文档（**零实现**）。
//   它是"JS 能调宿主什么"的唯一契约面；实现体在 `selfdraw-scene.swift` 的 `SelfDrawBridge`。
//   ★搬迁原因：`check:file-size` 存量棘轮只减不增，而这块纯声明占 ~275 行。
//   ★同一 Swift 模块 ⇒ `SelfDrawBridge: SelfDrawExports` 的遵循关系与调用点零改动。
import Foundation
import JavaScriptCore

@objc protocol SelfDrawExports: JSExport {
    /// 首次挂载：渲染树 JSON → 建 Rust 树 + CALayer 树；返回耗时分解
    func mount(_ treeJson: String) -> String
    /// 更新（Vue diff 后重发整树——★**保留给结构变化**用：增删节点时必须整树）
    func update(_ treeJson: String) -> String
    /// ★★**增量更新**：只发改动过的节点的样式补丁（跨边界字节数从 280KB 降到几十字节）
    func updatePatches(_ patchesJson: String) -> String
    /// ★★**绘制补丁**（颜色/圆角/字重/字号/透明度）——**几何之外的第二条通道**
    ///
    /// 入参：`[{"id":N,"paint":{...}}]`（`paint` 是**完整快照**，缺省键为 `null` ⇒ 清除）。
    /// 与 `updatePatches`（布局，经核心重排）**互不干涉**：本入口**不碰核心**。
    func paintPatches(_ patchesJson: String) -> String
    /// ★★**结构变更（增删行）**：`{removes:[id], inserts:[{parentId,nodes:[...]}], textMeasures:{}}`
    ///
    /// 【为什么必须有（本仓实测的功能缺口）】此前增删行只能**重发整棵树**
    ///   （真机 S5：500→600 项 230ms，几乎全是搬运成本）。本入口把「结构变了什么」
    ///   直接交给核心（`proteus_layout_splice`），宿主只增删对应层的子树。
    ///   ★只支持**追加**（核心侧架构限制：中间插入会显式拒绝并提示重发整棵树——
    ///     本仓纪律「宁可拒绝不可静默错序」）。
    func splice(_ spliceJson: String) -> String
    /// ★★**Vapor IR V3：二进制指令流入口**（V1 编码 → Rust 解码 → 应用 → 多范围增量重排）
    ///
    /// 【为什么另开一个入口而不是复用 updatePatches】
    ///   · `updatePatches` 收 **JSON**（每帧跨边界要文本解析——本仓实测占布局耗时 95%+）
    ///   · 本入口收 **二进制指令流**（顺序读 + 定长字段，免解析）
    ///   两条路径并存：JSON 保持兼容，二进制给 Vapor 用。
    ///   入参 `opsJson` 是**字节数组的 JSON 表示**（JSExport 对 ArrayBuffer 支持不稳，
    ///   而指令流本就极小——实测单节点更新 45 字节，base64/数组序列化成本可忽略）。
    func applyOps(_ opsBytesJson: String) -> String
    /// ★★**RT2 动画三件套**：start（一次性批量启动）/ seek（手势驱动进度）/ tick（每帧推进）
    ///
    /// 【为什么是三个入口而不是一个】三种**频率**完全不同：
    ///   · `animStart` —— 一次（转场开始时批量启动 N 条动画）
    ///   · `animSeek` —— 手势每帧（**外部给进度**；内核立即求值，不等 tick）
    ///   · `animTick` —— 每帧（时间驱动推进；**二进制返回**，见下）
    /// 【为什么 tick 返二进制】每帧 O(N) 条的变换值若走 JSON：序列化 + 宿主解析都是白付
    ///   （RT0 对照实验证明"省掉 O(N) 编解码"正是指令路径的主要收益）⇒ 定长 16B/条，
    ///   宿主按偏移顺序读。
    func animStart(_ json: String) -> String
    func animSeek(_ json: String) -> String
    func animTick(_ dtMs: Double) -> String
    /// ★★**MA5 滚动驱动**：宿主滚动回调 → 内核按**位置**换算进度并写字段（一次驱动全部窗口动画）
    ///
    /// 【为什么单开入口（而不是复用 animSeek）】滚动的影响面是**一个位置 → N 个节点**
    ///   （视差层 + 吸顶头 + 渐显项）；而 `animSeek` 是"某个节点的某个属性"。
    ///   换算（窗口/钳制/曲线）在**内核**——宿主只报"滚到哪了"。
    func animSeekScroll(_ json: String) -> String
    /// ★★**共享元素（跨元素飞行）**：从源矩形飞到目标节点再归位
    ///
    /// 【几何在内核（与 FLIP/滚动联动同源纪律）】中心差 + 宽度比是跨页面过渡的**全部视觉语义**；
    ///   宿主只把源（系统坐标矩形 或 同树节点 id）报进去，把算出的 `updates` 当帧刷层。
    ///   本方法另外做**层级提升**（`zPosition`）——飞行中的元素必须浮在其余内容之上。
    func sharedElement(_ json: String) -> String
    /// ★层级提升（zPosition）：把若干层抬到同层序最前 / 复位（瞬时的层序调整，不改几何）
    ///
    /// 入参：`{"ids":[…],"z":2}`（`z` 缺省 1；判据用它验证"飞行元素真的在别人之上"）
    func setLayerZ(_ json: String) -> String
    /// **读层的 zPosition**（判据用：从层的**实际状态**读——不比对我们自己传下去的参数）
    func layerZProbe(_ idsJson: String) -> String
    /// ★★**滚动 + 动画同步**（生产形态：宿主滚动通路里直接驱动，**零 JS 参与**）
    ///
    /// 一次调用 = 移动内容 + 内核 seek_scroll + 把 updates 当帧写层——
    /// 真实产品的滚动回调（UIScrollView didScroll / 手势）走的就是这条路径，
    /// 本入口把它暴露给真机判据（否则"滚动联动"只能靠 JS 分步调用，测不到生产形态）。
    func scrollAnimSync(_ json: String) -> String
    /// ★★**真手势滚动探针**（判据用；驱动到 pan 处理器的**同一出口**——见其实现注释）
    ///
    /// 返回 `{ok, recognizer_installed, wired, steps, dy, drive_count, offset_y_before/after,
    /// changed_total, applied_total, per_step_changed}`。
    /// 判据用它证明：① 真 `UIPanGestureRecognizer` 在视图上；② 唯一出口被驱动后
    /// 内容偏移与内核滚动联动都真实推进。
    func panDragProbe(_ json: String) -> String
    /// ★★**层变换探针**（判据从 CALayer 真读——覆盖"写入路径真的生效"）
    /// ★★**内核几何读数**（绝对矩形）——判据与"基于真实几何编舞"的入口
    ///
    /// 【为什么必须暴露（炫技场实测抓出的缺陷）】螺旋段的位移 = 目标点 − 瓦片**当前位置**；
    ///   而位置在 **FLIP 重排后已经变了**（列数 40→10、瓦片宽 ~15→~30）⇒ 用建树时的旧几何算位移，
    ///   整幅构图会**偏向一侧**（实测：漩涡跑到右下角、大片出屏）。
    ///   ⇒ 编舞前从**内核**读一次真实 rects（几何仍然出自内核，不是 JS 自己算的）。
    func rects() -> String
    /// ★★A/B（矩阵 #14 续）：与 Android `readRects()` **同形**（几何真源读，判据用）
    func readRects() -> String
    /// ★★A/B：**绘制通道探针**（与 Android `probeChannels` 同族；从 **CALayer 真读**）
    func probeChannels(_ idsJson: String) -> String
    /// ★★★B-T2（2026-10-10）：**文本策略回读**（whiteSpace/wordBreak/lineClamp；内核 = SSOT）——与 Android `textPolicy` 同形
    func textPolicy(_ idsJson: String) -> String
    /// ★★A/B：**注册手势回调名**（宿主 tapAt 时经 JSContext 调它——与 Android JNI 反向调用同语义）
    func onGesture(_ name: String) -> String
    func layerTransformProbe(_ idsJson: String) -> String
    /// ★★**停全部动画 + 复位变换**（相位间状态清理）
    func animStopAll() -> String
    /// ★★带底色的节点清单（颜色动画的取样入口——见实现处注释）
    func bgNodes() -> String
    /// ★★带文字色的节点清单（文字色动画的取样入口——与 `bgNodes` 对称）
    func textColorNodes() -> String
    /// ★★C1：带裁剪形状的节点清单（裁剪形变动画的取样入口——与 `bgNodes` 对称）
    func clipNodes() -> String
    /// ★★C2：带 SVG 路径的节点清单（描边动画的取样入口——同款纪律）
    func svgNodes() -> String
    /// ★★**MA0-RT 平台零参与路径**：提交一次（CAKeyframeAnimation）/ presentation 探针 / 撤销
    func animCommit(_ json: String) -> String
    func layerPresentedProbe(_ idsJson: String) -> String
    func animRemovePlatform(_ idsJson: String) -> String
    /// ★★**FLIP 布局动画**（招牌能力）：capture 记快照 / start 启动补间
    func animFlip(_ json: String) -> String
    /// ★★**帧率测席**（§9 指标测量）：启动 / 取结果
    func animBenchStart(_ json: String) -> String
    func animBenchResults() -> String
    /// ★★★**玻璃滚动性能基线**（决策 #862）：程序化滚动 N 帧 + CADisplayLink 真 vsync 间隔采样
    func glassBenchStart(_ json: String) -> String
    func glassBenchResults() -> String
    /// ★★**主线程零唤醒实测**（OS 级 CPU 会计 + 阳性对照）：启动 / 取结果
    ///
    /// 【为什么不用 Instruments/xctrace（2026-09-30 取证）】本机 Xcode 26.5 的 `xctrace` **无法录制
    ///   本设备**（`Waiting for device to boot` 超时）。证据链：`ioreg` 显示 iPhone 在 USB 上、
    ///   `xcdevice list` 报 available、xctrace 在 Mac 本地录音正常、设备侧 devicectl 报
    ///   booted/DDI available/dev mode enabled/unlocked —— 唯一缺口是 **DeviceSupport 设备支持包
    ///   只有 26.3 而设备已 26.7**（补它要下 GB 级支持包）。
    ///   ⇒ 改用 **OS 级 CPU 会计**：`thread_info(THREAD_BASIC_INFO)` 两次采样之差 = 该窗口内主线程
    ///     真正消耗的 CPU——这正是"零唤醒"要证的东西，且**可机器判定**（比人看波形更可回归）。
    ///   ★配**阳性对照**（tick 路径必须有显著开销）——否则"零"无法与"探针没测到"区分。
    func animCpuProbeStart(_ json: String) -> String
    func animCpuProbeResults() -> String
    /// ★★**Host ABI 双路对照**（HA1）：同一棵树分别走直连 FFI 与 Host ABI ⇒ 几何逐字节比对
    func abiProbe(_ json: String) -> String
    /// ★★**RT2/§7.3：按节点停动画**（宿主行回收时自动调用；暴露给判据做破坏性验证）
    func animStopNodes(_ idsJson: String) -> String
    /// ★★**帧循环三件套**（RT2）：启动（接 CADisplayLink）/ 停止 / 读数
    func animStartFrameLoop() -> String
    func animStopFrameLoop() -> String
    func animFrameStats() -> String
    /// ★★★交互视觉反馈探针（Dactyl 专项）：按下态 / 场跟手 / 伪元素动画的原生计数（判据读它）
    func interactionProbe() -> String
    /// ★★★Dactyl D0（决策 #797）：触摸延迟采样（导出/探针/清空——量具契约同形）
    func dactylMetricsJson() -> String
    func dactylSampleProbe() -> String
    func dactylResetSamples()
    /// ★★★显影器数据出口（决策 #797 · 通用能力）：触摸轨迹（官方时间戳 + 内容坐标）
    func dactylTouchTrailJson() -> String
    func dactylResetTrail()
    /// ★注入三段（与真触摸同一钩子链）：判据注入按下/拖拽/抬指
    func driveTouchDown(_ x: Double, _ y: Double) -> Bool
    func driveTouchMove(_ x: Double, _ y: Double) -> Bool
    func driveTouchUp() -> Bool
    /// ★仍在推进的动画条数（0 = 全部结束）——"这一幕演完了吗"的权威判据（弹簧时长由物理决定，
    ///   调用方按名义 durMs 推算会早切或多等，见内核 `proteus_layout_anim_active` 注释）
    func animActiveCount() -> String
    /// ★★A3 播放控制：`{"timeScale":1.0,"paused":false}`（回显生效值；见内核 anim_control 注释）
    func animControl(_ json: String) -> String
    /// ★★**高分辨率单调时钟**（微秒，十进制字符串）——供 JS 侧做可靠计时
    ///
    /// 【为什么必须由宿主提供（本仓实测的第六个测量装置缺陷）】
    ///   JSC 的 `Date.now()` 是**粗粒度缓存时钟**：真机实测**连续 512 次读一次都不前进**
    ///   ⇒ 用它测出的 "p50 = 0ms / p95 = 1ms" 全是**分辨率假象**，不是成本。
    ///   桌面 JSC 有 `performance.now()`，**真机 JSC 没有**（实测 `typeof performance === 'undefined'`）。
    ///   ⇒ 唯一可靠的路径：宿主用 `mach_absolute_time`（**单调**，不受墙钟调整影响）计时，
    ///     以字符串返回微秒值（字符串而非 Double：避免 JS Number 的 53 位精度在
    ///     大时间戳上损失亚微秒分辨率）。
    func nowUs() -> String
    /// ★★**虚拟化挂载**（§12.5 materialize · §12.7 P1）：整棵树都进核心（几何/命中口径不变），
    ///   但**只物化可见区 + 预加载区的行**的 CALayer；行进出由核心复用池的决策驱动。
    ///
    /// 入参：`{viewport, nodes, textMeasures?, rows:[{index,key,root,ids}], poolCapacity?}`
    ///   `rows` 来自 `instantiateTemplate` 的 `virtual.rows`（**整行节点集合**——
    ///   宿主自己按 listId 分组只能拿到行根，见该字段注释）。
    ///
    /// 出参：`{ok, node_count, layer_count, materialized_rows, created, reused, ...}`
    ///
    /// ★为何另开入口（而不是给 mount 加开关）：全量挂载的读数（V6/V11）已进历史基线，
    ///   同一入口里改语义会让**旧读数与新读数不可比**（本仓纪律：改变已发布读数必须显式）。
    func mountVirtual(_ requestJson: String) -> String
    /// ★★虚拟化滚动：**像素量**（dx/dy）→ 宿主换算可见行 → 向核心复用池要决策（acquire/release）
    ///   → 执行层物化/回收 → 返回本帧动作明细（判据：`acquired`/`released` 与复用池对账）
    func scrollRows(_ dx: Double, _ dy: Double) -> String
    /// ★★虚拟化读数（层数/建层数/复用数/池大小/已物化行）——复用池是否真的在起作用的直接证据
    func virtualStats() -> String
    /// 设置层池容量（`0` ⇒ 完全不复用）——**破坏性验证**用：关掉复用，判据必须变红
    func setPoolCapacity(_ n: Double) -> String
    /// ★V4：滚动视图（dx/dy 像素）——触发 layoutSubviews → 补刷已滚入的待更新层
    ///
    /// 【为什么放在**容器视图**上而不是滚动视图上】本自绘层树不用 UIScrollView
    ///   （滚动由 native-host 跟随 + 根层 bounds 平移表达）⇒ 用 bounds.origin 平移即可触发
    ///   `layoutSubviews`，与真实滚动同一条代码路径。
    func scrollBy(_ dx: Double, _ dy: Double) -> String
    /// ★★**虚拟化探针**（坐标必须来自几何推导，不手算——本仓纪律）
    ///
    /// 入参：行号。出参：`{ok, materialized, row_rect(屏幕坐标), child_rects(屏幕坐标数组)}`
    ///
    /// 【为什么必须有（本仓的坐标纪律）】像素验证要用"行内某元素的中心点"采样——
    ///   任何手算坐标都会随样式/字重/行高变化而错位（本仓已因手算坐标翻车 3 次）。
    ///   ⇒ 由宿主从**核心几何 + 内容偏移**算出屏幕坐标，JS 只负责采样。
    ///   `materialized: false` 时 rect 仍给出（**核心几何是全量的**）——这本身就是判据：
    ///   屏外的行"有几何、无层"。 */
    func virtualProbe(_ rowIndex: Double) -> String
    /// ★★**几何 + 字体探针**（坐标与字体名都必须来自宿主测量，不手算——本仓纪律）
    ///
    /// 入参：`{nodes?:[节点 id]}`。出参：每个节点的**屏幕 rect**（核心绝对几何 + 内容偏移）、
    ///   **层宽高**、**层上实际字体名**（`CATextLayer.font` 反查）。
    ///
    /// 【为什么字体名要读层（判据强度）】几何宽度不同只能证明"**度量**时用了不同字体"；
    ///   "**绘制**时也用了" 是另一件事——本仓已有同族教训（度量与绘制分叉 ⇒ 字被裁而报告全绿）。
    ///   读层上的 `font`/`fontSize` 才闭环到"屏幕上真的会这样画"。
    func measureProbe(_ json: String) -> String
    /// ★★**拆掉当前树**（销毁核心句柄 + 清层 + 重置 diff 基线）——下一次 `mount` 走**真全量**
    ///
    /// 【为什么需要（本仓实测的路径语义）】`mount` 是**增量语义**：`handle != 0` 时它先做
    ///   节点 diff，且**只处理布局字段**（绘制属性在该路径上是"建层时的快照"，不参与更新）。
    ///   ⇒ 紧接着再 `mount` 一棵"只改了字体族"的树 ⇒ 布局补丁为空 ⇒ **什么都不做**
    ///   （现象：层上的字体仍是上一次的）。V13 的"全 system 反例对照"正是被这一点坑到
    ///   ——两组读数完全相同，差点被读成"字族不影响度量"。
    ///   ⇒ 需要真正重建时（对照实验、换主题）必须**显式拆树**：语义明确，不让调用方猜。
    func clearTree() -> String
    /// ★★**注册自定义字体**（`custom:<族名>` 契约，2026-09-29）——入参 JSON `{family, path}`。
    ///
    /// 与 Android `ProteusHostView.registerFont(family, path)` **同契约**；未注册的族名
    /// 在 `font(size:weight:family:)` 里**显式回退 system + 计数**（不静默）。
    /// - Returns: `{ok, registered, registered_fonts}`；路径无法解析 ⇒ `ok:false`（**不静默**）
    func registerFont(_ json: String) -> String
    /// 自定义字体诊断（未注册命中次数 + 最近缺失的族名 + 注册表规模）
    func customFontStats() -> String
    /// ★V4：待补刷统计（诊断 + 滚动用例的判据）
    func pendingStats() -> String
    /// ★★V5：**批量像素采样**（渲染一次读多点）——像素级验证的判据
    ///
    /// 【为什么需要（本仓反复标注的缺口）】此前所有验证都停在"**几何**算对了"
    ///   （rect/坐标/不变式），而"**屏幕上真的画对了**"从未验证。
    ///   延迟补刷（只更可见层）的正确性尤其需要它：几何对 ≠ 屏幕对。
    ///
    /// 入参：`[{"x":10,"y":100}, ...]`（屏幕坐标，逻辑点）
    /// 出参：`{"ok":true,"pixels":["#RRGGBB", ...]}`（与入参同序）
    ///   ★格式由**本函数显式声明**（byteOrder32Big|premultipliedLast）⇒ 不再依赖系统给的字节序；
    ///     装置自检见 `pixelFormatSelfTest()`（**像素判据的前置**，本轮 R/B 互换就是它抓出来的）。
    func samplePixels(_ json: String) -> String
    /// ★★像素格式自检（三色标定）——测量装置必须先自测（本仓纪律）
    func pixelFormatSelfTest() -> String
    /// ★★V9：**注入一次 tap**（走与真实触摸**同一条链**：`emitGesture` → 核心命中 → JS 派发）
    ///
    /// 【为什么需要它（诚实边界）】`touchesBegan/Ended` 是 UIKit 的 UI 事件，**JS 无法伪造**
    ///   ⇒ 若只靠真实触摸，设备用例无法自动验证（需人手点）。
    ///   本入口**绕过 UITouch**但**复用 `emitGesture`** ⇒ 覆盖「命中 → 派发」这两环；
    ///   唯一未覆盖的是「UITouch → 内容坐标换算」（那部分靠 `touchesEnded` 的 tap 时序判定，
    ///   需人手或 XCUITest 覆盖）。
    /// - Parameters: x/y 为**内容坐标**（与核心 rects 同口径）
    func tapAt(_ x: Double, _ y: Double) -> String
    /// ★矩阵 #7：**注入一次 swipe**（类型 = `swipe:<dir>`；dx/dy 用于方向推导）
    func swipeAt(_ x: Double, _ y: Double, _ dx: Double, _ dy: Double) -> String
    /// ★V10：**注入一次 longpress**（同 `tapAt` 的链；类型 = `longpress`）
    ///
    /// 【与手势层阈值对齐】`packages/gesture` 的 `longpressDuration` 默认 **500ms**；
    ///   宿主真实触摸判定同用 500ms（见 `SelfDrawView` 的 `longpressMinDuration`）——
    ///   注入入口绕过时序（直接声明类型），真实触摸路径由 `touchesEnded` 按实测时长分流。
    func longpressAt(_ x: Double, _ y: Double) -> String
    /// ★★★真触摸序列（「真实触摸事件对齐」2026-10-04）：宿主喂入 down→held→up，
    ///   走 `SelfDrawView.classifyAndEmit`（与 `touchesEnded` 同一分流器）⇒ 按真实时长/位移判型。
    ///   不同于 `tapAt`（直接声明类型，绕过时序）——本入口**覆盖时长/速度分流**这一环。
    func simulateTouch(_ x: Double, _ y: Double, _ heldMs: Double) -> String
    /// ★V9：手势统计（命中/未命中/错误——证明"触摸真的走到了核心"）
    func gestureStatsJson() -> String
    /// ★★V4 A/B 开关：'v4'（默认：二进制返回 + 只更可见层）| 'v3'（旧路径：JSON 返回 + 全部层）
    ///
    /// 【为什么要有它（诚实对照）】优化前后若用**不同的基准树**测，比较无意义
    ///   （本仓实测：类B 基准树因缺 flexShrink 而"没有几何变化"，旧读数与优化后不可比）。
    ///   ⇒ 提供运行时开关，**同一棵树、同一用例**里分别测两条路径。
    func setOptMode(_ mode: String) -> String
    /// 截图落盘（验证「屏幕上真的画出来了」）
    func snapshot(_ name: String) -> String
    /// JS 侧自报读数（Vue mount / update 耗时 + patch 次数）
    func report(_ json: String)
    /// 链路完成（宿主据此落盘报告）
    func done(_ summaryJson: String)
}

