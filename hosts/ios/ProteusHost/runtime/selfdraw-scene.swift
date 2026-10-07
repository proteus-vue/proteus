// hosts/ios/ProteusHost/runtime/selfdraw-scene.swift
// ★★★**Vue 渲染 → Rust 自绘管线**（用户点名要验的那一环，2026-09-29）
//
// 【它补的是哪个缺口】
//   此前有两条互不相连的链路（本仓核实）：
//     · Vue → render-backend → NativeBackend → **UIView 树**（`bridge/entry.ts`，布局靠 UIKit）
//     · **手写 JSON** → Rust 排版核心 → 几何 → Canvas/CALayer
//   本文件把两者接上：**标准 Vue 应用** → Vue 自定义渲染器 → 渲染树 → **Rust 核心算几何**
//   → 宿主按几何建 **CALayer 树**（自绘，无 per-node UIView）。
//
// 【分工（也是本场景要证明的「一份语义多引擎」）】
//   JS 侧：业务逻辑 + Vue diff + 产出语义树（**不含几何**）
//   宿主侧：CoreText 度量（平台注入）+ 调 Rust 核心算几何 + 建 CALayer 树
//   ⇒ **几何只在一处产生**（Rust 核心），JS 与宿主都不自行计算布局。
//
// 【与既有 calayer-scene.swift 的差别】
//   那个是「手写 12 行 JSON → CALayer」，验证的是几何通道；
//   本文件是「真实 Vue 应用 → CALayer」，验证的是**整条 App 链路**（含 Vue 运行时与 diff）。
import UIKit
import CoreText
import JavaScriptCore
// ★mach_absolute_time（高分辨率单调时钟）——测量用，见 SelfDrawBridge.nowUs()
import Darwin

/* ────────────────────────── Rust C ABI ────────────────────────── */

@_silgen_name("proteus_layout_create")
func proteus_layout_create(_ requestJson: UnsafePointer<CChar>) -> UInt64

@_silgen_name("proteus_layout_rects")
func proteus_layout_rects(_ handle: UInt64) -> UnsafeMutablePointer<CChar>

@_silgen_name("proteus_layout_destroy")
func proteus_layout_destroy(_ handle: UInt64) -> Bool

@_silgen_name("proteus_layout_version")
func proteus_layout_version() -> UnsafeMutablePointer<CChar>

@_silgen_name("proteus_layout_free_string")
func proteus_layout_free_string(_ ptr: UnsafeMutablePointer<CChar>)

@_silgen_name("proteus_layout_update")
func proteus_layout_update(_ handle: UInt64, _ patchesJson: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>

/// ★★结构变更（插入/摘除子树）——「增删行」的增量路径（此前只能重发整棵树）
@_silgen_name("proteus_layout_splice")
func proteus_layout_splice(_ handle: UInt64, _ spliceJson: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>

/// ★★**命中测试**（核心算：target + 冒泡链 chain）——触摸派发的依据
@_silgen_name("proteus_layout_hit_test")
func proteus_layout_hit_test(_ handle: UInt64, _ x: Float, _ y: Float) -> UnsafeMutablePointer<CChar>

/// ★★注入/更新文本度量（宿主度量后推入；不触发重排）
@_silgen_name("proteus_layout_set_text_measures")
func proteus_layout_set_text_measures(_ handle: UInt64, _ measuresJson: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>
/// ★Vapor IR V3：二进制指令流入口（字节指针 + 长度）
@_silgen_name("proteus_layout_apply_ops")
func proteus_layout_apply_ops(_ handle: UInt64, _ ptr: UnsafePointer<UInt8>, _ len: UInt32) -> UnsafeMutablePointer<CChar>

// ★★RT2（2026-09-30）：指令驱动动画（曲线求值在 Rust 侧；宿主只负责"每帧推进 + 应用变换"）
@_silgen_name("proteus_layout_anim_start")
func proteus_layout_anim_start(_ handle: UInt64, _ json: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>
@_silgen_name("proteus_layout_anim_seek")
func proteus_layout_anim_seek(_ handle: UInt64, _ json: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>
/// ★MA5：滚动驱动（位置 → 全部窗口动画；换算在内核）
@_silgen_name("proteus_layout_anim_seek_scroll")
func proteus_layout_anim_seek_scroll(_ handle: UInt64, _ json: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>
/// ★共享元素（跨元素飞行；几何原语——中心差 + 宽度比在内核）
@_silgen_name("proteus_layout_bg_nodes")
func proteus_layout_bg_nodes(_ handle: UInt64) -> UnsafeMutablePointer<CChar>
/// ★★C1：带裁剪形状的节点清单（与 bg_nodes 同一取样纪律——id 动态分配，必须问内核）
@_silgen_name("proteus_layout_clip_nodes")
func proteus_layout_clip_nodes(_ handle: UInt64) -> UnsafeMutablePointer<CChar>
/// ★★C2：带 SVG 路径的节点清单（描边动画的取样入口——同取样纪律）
@_silgen_name("proteus_layout_svg_nodes")
func proteus_layout_svg_nodes(_ handle: UInt64) -> UnsafeMutablePointer<CChar>
/// ★★路径变形 v1：按当前因子**算好**的变形段列表（宿主零插值——见内核 `SvgPath::morphed`）
@_silgen_name("proteus_layout_svg_morph_path")
func proteus_layout_svg_morph_path(_ handle: UInt64, _ json: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>
/// ★★路径变形（**二进制版**——每帧路径：一次拷贝 + 定长字段，无 JSON 解析。
///   真机读数：JSON 版把 moonGlow 幕 p95 抬到 2.57ms——见内核同函数的注释）
@_silgen_name("proteus_layout_svg_morph_path_bin")
func proteus_layout_svg_morph_path_bin(_ handle: UInt64, _ nodeId: UInt32, _ outLen: UnsafeMutablePointer<UInt32>) -> UnsafeMutablePointer<UInt8>
@_silgen_name("proteus_layout_text_color_nodes")
func proteus_layout_text_color_nodes(_ handle: UInt64) -> UnsafeMutablePointer<CChar>
@_silgen_name("proteus_layout_shared_element")
func proteus_layout_shared_element(_ handle: UInt64, _ json: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>
@_silgen_name("proteus_layout_anim_commit_spec")
func proteus_layout_anim_commit_spec(_ handle: UInt64, _ json: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>
@_silgen_name("proteus_layout_flip")
func proteus_layout_flip(_ handle: UInt64, _ json: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>
@_silgen_name("proteus_layout_anim_stop")
func proteus_layout_anim_stop(_ handle: UInt64, _ json: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>
// ★仍在动的动画条数（0 = 全部结束）——幕切换的权威判据（见内核 anim_active 注释）
@_silgen_name("proteus_layout_anim_active")
func proteus_layout_anim_active(_ handle: UInt64) -> UInt64
/// ★★A3 播放控制（时间因子/暂停）
@_silgen_name("proteus_layout_anim_control")
func proteus_layout_anim_control(_ handle: UInt64, _ json: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>
@_silgen_name("proteus_layout_anim_tick_bin")
func proteus_layout_anim_tick_bin(_ handle: UInt64, _ dtMs: Float, _ outLen: UnsafeMutablePointer<UInt32>) -> UnsafeMutablePointer<UInt8>?
/// ★Vapor IR V4：**不带 rects 的 apply**（二进制通道场景——省掉 JSON 序列化与宿主解析）
@_silgen_name("proteus_layout_apply_ops_norects")
func proteus_layout_apply_ops_norects(_ handle: UInt64, _ ptr: UnsafePointer<UInt8>, _ len: UInt32) -> UnsafeMutablePointer<CChar>
/// ★Vapor IR V4：变化集二进制返回（整流矩形）
@_silgen_name("proteus_layout_rects_bin")
func proteus_layout_rects_bin(_ handle: UInt64, _ outLen: UnsafeMutablePointer<UInt32>) -> UnsafeMutablePointer<UInt8>
/// 释放上面返回值
@_silgen_name("proteus_rects_free")
func proteus_rects_free(_ ptr: UnsafeMutablePointer<UInt8>, _ len: UInt32)

/* ★★列表复用池（§12.6）：核心给**决策**（哪些行该 acquire/release），宿主执行**动作** */

@_silgen_name("proteus_recycle_create")
func proteus_recycle_create(_ itemCount: UInt32, _ leadingRows: UInt32, _ followingRows: UInt32) -> UInt64

@_silgen_name("proteus_recycle_update")
func proteus_recycle_update(_ handle: UInt64, _ firstVisible: UInt32, _ lastVisible: UInt32) -> UnsafeMutablePointer<CChar>

@_silgen_name("proteus_recycle_stats")
func proteus_recycle_stats(_ handle: UInt64) -> UnsafeMutablePointer<CChar>

@_silgen_name("proteus_recycle_destroy")
func proteus_recycle_destroy(_ handle: UInt64)

/* ══════════ ★★Host ABI v1（HA1：现有宿主接入抽象层）══════════ */

/// ★**为什么宿主也要接 ABI（HA0.5 的收益兑现）**：宿主集成（Surface/生命周期/输入/调度/能力注册）
///   改为经契约驱动 ⇒ **换宿主不用重写平台适配**；本文件用"双路对照"验证抽象正确性：
///   同一棵树分别走 [直连 FFI] 与 [Host ABI]，几何必须**逐字节一致**（等价性判据，不是"看起来对"）。

struct ProteusVersionInfo {
    var abi_version: UInt32 = 0
    var ir_version: UInt32 = 0
    var ops_wire_version: UInt32 = 0
    var min_shell_version: UInt32 = 0
}

struct ProteusTextInput {
    var text: UnsafePointer<CChar>?
    var node_id: UInt32
    var style_key: UInt32
    var font_size: Float
    var font_weight: Int32
    var font_family: UnsafePointer<CChar>?
    var max_width: Float
}

struct ProteusTextMetrics {
    var width: Float = 0
    var height: Float = 0
}

/// ★★**回调签名必须用"ObjC 可表示类型"**（本仓实测的 Swift 限制）
///
/// 【为什么不是 `UnsafePointer<ProteusTextInput>?`】Swift 要求 `@convention(c)` 的参数类型
///   **在 ObjC 里可表示**；而 `ProteusTextInput` 是含 `UnsafePointer<CChar>?` 的 Swift 结构体
///   ⇒ 报 `is not representable in Objective-C`。
/// 【正解】按 C ABI 的真实形态：结构体指针在 C 侧就是一个**地址** ⇒ 用 `UnsafeRawPointer?`
///   接收，回调内 `assumingMemoryBound(to:)` 还原。★这不是"绕过类型系统"——
///   C 侧本来就是这样传的（`const ProteusTextInput*`），Swift 的严格类型在**跨语言边界**上
///   表达不出来，按底层宽度声明才忠实。
typealias ProteusMeasureTextFn = @convention(c) (UnsafeRawPointer?, UnsafeMutableRawPointer?, UnsafeMutableRawPointer?) -> Int32
typealias ProteusRequestFrameFn = @convention(c) (UnsafeMutableRawPointer?) -> Void

/// ★★**为什么函数指针字段用 `UnsafeMutableRawPointer?`（而不是 `@convention(c)` Optional）**
///
/// 【本仓实测的 Swift 类型系统限制】`@convention(c)` 的函数**可选类型**放进结构体**字面量**时，
///   编译器要求"上下文类型"但在混合 `nil` 时不稳（报 `'nil' requires a contextual type`）——
///   连逐字段赋值也躲不掉（结构体初始化器本身要推全部字段）。
/// 【正解】按 **C ABI 的真实形态**声明：C 的函数指针就是**指针宽度**的值 ⇒ 用
///   `UnsafeMutableRawPointer?` 承载，传参时经 `unsafeBitCast` 还原成 `@convention(c)` 类型。
///   ★这不是绕开类型检查：C 侧本来就是 `void*`-等价的可空函数指针，Swift 的严格类型在这层
///     表达不出来 ⇒ 按底层形态声明才是**忠实**的。
struct ProteusHostVTable {
    var user_data: UnsafeMutableRawPointer?
    var request_frame: UnsafeMutableRawPointer?
    var measure_text: UnsafeMutableRawPointer?
    var decode_image: UnsafeMutableRawPointer?
    var native_view_create: UnsafeMutableRawPointer?
    var native_view_update: UnsafeMutableRawPointer?
    var native_view_destroy: UnsafeMutableRawPointer?
}

@_silgen_name("proteus_abi_version_info")
func proteus_abi_version_info() -> ProteusVersionInfo
@_silgen_name("proteus_check_versions")
func proteus_check_versions(_ host: UnsafePointer<ProteusVersionInfo>?, _ hint: UnsafeMutablePointer<CChar>?, _ len: Int) -> Int32
@_silgen_name("proteus_engine_create")
func proteus_engine_create(_ host: UnsafePointer<ProteusHostVTable>?, _ ver: UnsafePointer<ProteusVersionInfo>?, _ hint: UnsafeMutablePointer<CChar>?, _ len: Int) -> UnsafeMutableRawPointer?
@_silgen_name("proteus_engine_destroy")
func proteus_engine_destroy(_ engine: UnsafeMutableRawPointer?) -> UnsafeMutableRawPointer?
@_silgen_name("proteus_load_tree")
func proteus_load_tree(_ engine: UnsafeMutableRawPointer?, _ treeJson: UnsafePointer<CChar>?) -> Int32
@_silgen_name("proteus_submit_frame")
func proteus_submit_frame(_ engine: UnsafeMutableRawPointer?, _ ops: UnsafePointer<UInt8>?, _ byteLen: Int) -> Int32
@_silgen_name("proteus_frame")
func proteus_frame(_ engine: UnsafeMutableRawPointer?, _ frameTimeNs: Int64) -> Int32
@_silgen_name("proteus_frame_updates")
func proteus_frame_updates(_ engine: UnsafeMutableRawPointer?, _ outLen: UnsafeMutablePointer<UInt32>?) -> UnsafePointer<UInt8>?
@_silgen_name("proteus_rects")
func proteus_rects(_ engine: UnsafeMutableRawPointer?, _ outLen: UnsafeMutablePointer<UInt32>?) -> UnsafePointer<UInt8>?
@_silgen_name("proteus_stats_json")
func proteus_stats_json(_ engine: UnsafeMutableRawPointer?) -> UnsafePointer<CChar>?
@_silgen_name("proteus_dispatch_pointers")
func proteus_dispatch_pointers(_ engine: UnsafeMutableRawPointer?, _ events: UnsafeRawPointer?, _ count: Int) -> Int64
@_silgen_name("proteus_register_capability")
func proteus_register_capability(_ engine: UnsafeMutableRawPointer?, _ name: UnsafePointer<CChar>?, _ fn: (@convention(c) (UnsafePointer<CChar>?, UnsafeMutablePointer<CChar>?, Int, UnsafeMutableRawPointer?) -> Int32)?, _ userData: UnsafeMutableRawPointer?) -> Int32
@_silgen_name("proteus_has_capability")
func proteus_has_capability(_ engine: UnsafeMutableRawPointer?, _ name: UnsafePointer<CChar>?) -> Int32
@_silgen_name("proteus_call_capability")
func proteus_call_capability(_ engine: UnsafeMutableRawPointer?, _ name: UnsafePointer<CChar>?, _ argJson: UnsafePointer<CChar>?, _ out: UnsafeMutablePointer<CChar>?, _ outLen: Int) -> Int32
@_silgen_name("proteus_surface_changed")
func proteus_surface_changed(_ engine: UnsafeMutableRawPointer?, _ surface: UnsafeMutableRawPointer?)
@_silgen_name("proteus_lifecycle")
func proteus_lifecycle(_ engine: UnsafeMutableRawPointer?, _ state: UInt32)
@_silgen_name("proteus_anim_start")
func proteus_anim_start(_ engine: UnsafeMutableRawPointer?, _ animsJson: UnsafePointer<CChar>?) -> Int32
@_silgen_name("proteus_anim_stop")
func proteus_anim_stop(_ engine: UnsafeMutableRawPointer?, _ json: UnsafePointer<CChar>?) -> Int32
@_silgen_name("proteus_prewarm")
func proteus_prewarm()

func takeCString(_ ptr: UnsafeMutablePointer<CChar>) -> String {
    defer { proteus_layout_free_string(ptr) }
    return String(cString: ptr)
}

/// 当前进程的**实际内存占用**（MB）
///
/// ★用 `phys_footprint`：这是 iOS 上最贴近「真实占用」的口径（含 dirty + compressed），
///   也是系统 OOM 杀进程时看的那个数。加压测试要给出「内存天花板」，不能用估算值。
func physFootprintMB() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
    }
    guard kr == KERN_SUCCESS else { return -1 }
    return Double(info.phys_footprint) / 1024.0 / 1024.0
}

/* ────────────────────────── JS ↔ 宿主 协议 ────────────────────────── */

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

/* ────────────────────────── 宿主（自绘） ────────────────────────── */

/// bench 完成标志（由 JS 链尾的 `done()` 置位；宿主据此收尾）
enum BenchDone { static var flag = false }

/// ★★C2 诊断计数（文件级全局——见 `SelfDrawView` 里"为什么不用类内 static"的注释）
enum SvgDiag {
    static var attachStats = 0
    static var skipNoId = 0
    static var skipNoLayer = 0
    static var skipNoSegs = 0
    static var built = 0
}

/// 启动白屏诊断读数（**runtime 自持**）——壳在 viewDidLoad 填充，发动机在 bench 报告里读出。
/// ★第三刀解耦：原先它挂在壳的视图控制器上，导致 runtime 反向引用 shell；现移入 runtime 自持。
enum ProteusLaunchDiag {
    static var data: [String: Any] = [:]
}

/// ★★★行高修复（2026-10-08 · 用户抓出「iOS 行高比其他端矮」）：CATextLayer 对**多行文本**完全忽略段落
///   的 `minimumLineHeight/maximumLineHeight`（实测：显式 `\n`、CTParagraphStyle 都不行，恒用字体自然行高）
///   ⇒ 声明 `line-height` 的多行文本行距偏小（与 Web/Android/鸿蒙不一致）。
///   修：声明行高的多行文本改用本子类——`draw(in:)` 用 CoreText `CTFrameDraw` 渲染（**遵守** NSPS 行高，
///   本机实测 pitch 精确 = 声明值）；其余情形仍走 CATextLayer 原生路径（零行为变化）。
final class ProteusTextLayer: CATextLayer {
    /// true ⇒ 用 CoreText 绘制（`string` 须为 NSAttributedString）；false ⇒ 原生 CATextLayer 绘制。
    var useCoreText = false
    override func draw(in ctx: CGContext) {
        guard useCoreText, let attributed = string as? NSAttributedString else { super.draw(in: ctx); return }
        let framesetter = CTFramesetterCreateWithAttributedString(attributed)
        let path = CGPath(rect: CGRect(origin: .zero, size: bounds.size), transform: nil)
        let frame = CTFramesetterCreateFrame(framesetter, CFRangeMake(0, 0), path, nil)
        ctx.saveGState()
        ctx.textMatrix = .identity
        // ★★CALayer 的 `draw(in:)` 上下文是 **y 向下**（CA 坐标系）⇒ CoreText（y 向上）必须翻转，
        //   否则文本上下颠倒（真机实测：A/B/C 三段全镜像——独立 CGContext 上恰好相反，不能照搬）。
        ctx.translateBy(x: 0, y: bounds.height)
        ctx.scaleBy(x: 1, y: -1)
        CTFrameDraw(frame, ctx)
        ctx.restoreGState()
    }
}

final class SelfDrawView: UIView {

    /// 当前 CALayer 树（★自绘：每节点一个 CALayer，**不创建 UIView**）
    private var layerNodes: [CALayer] = []
    private(set) var builtLayerCount = 0
    /// 节点 id → 几何（供 hit test 与诊断）
    private(set) var rectsByNodeId: [Int: CGRect] = [:]
    /// 节点 id → 语义（供截图核验与后续事件接入）
    private(set) var metaByNodeId: [Int: [String: Any]] = [:]
    /// 节点 id → **绝对原点**（用于把核心的绝对坐标换算为 CALayer 的父相对坐标）
    private var absOriginByNodeId: [Int: CGPoint] = [:]
    /// ★节点 id → 已建好的 CALayer（**增量更新的前提**：有它才能只改frame、不重建）
    private var layersById: [Int: CALayer] = [:]
    /// 节点 id → 层深度（建层时预计算，供增量更新的父序排序 O(1) 查询）
    private var depthById: [Int: Int] = [:]
    /// 节点 id → 父 id（增量更新时判断父子关系用）
    private var parentById: [Int: Int] = [:]
    /// 节点 id → **子 id 列表**（结构变更的层维护用）
    ///
    /// 【为什么需要（结构增量的必要簿记）】`layer.sublayers` 虽是现成的，但结构变更时：
    ///   ① 摘除要按**节点 id** 递归清理各字典（`layersById`/`depthById`/…）——
    ///      直接从 CALayer 反查 id 需要反查表，绕一圈且易漏；
    ///   ② 插入落点需要知道"父的当前子列表"以判定末尾位置。
    ///   ⇒ 与 `layersById` 同处维护一份 **id 级的子列表**（O(1) 增删）。
    ///   ⚠ 纪律：**本表与 CALayer 树必须同步更新**（两者是同一事实的两份视图，
    ///     分叉 ⇒ 层树与 id 簿记不一致 ⇒ 后续所有增量操作都在错的基础上做）。
    private var childrenById: [Int: [Int]] = [:]
    /// 实际下发的 CALayer frame（**父相对**）与父 id —— 供核验脚本对照核心几何
    private(set) var builtFrames: [Int: CGRect] = [:]
    private(set) var builtParents: [Int: Int] = [:]

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        // ★关掉 CALayer 的隐式动画：自绘管线每帧重建层，动画会让测量结果失真
        //   （CALayer 默认对 bounds/position 变化做 0.25s 隐式动画——本仓实测踩到过类似问题）
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        CATransaction.commit()
        // ★★真手势滚动**接线**（2026-10-01 收诚实边界）：此前 `scrollBy`/`scrollAnimSync` 只有
        //   **合成调用者**（判据与入口），真手指没有人接（边界原文："真机手指拖拽手势未接线"）。
        //   ⇒ 装**平台识别器**（UIPanGestureRecognizer）：识别出拖拽 ⇒ 唯一出口
        //     `driveScrollDrag` ⇒ 桥的生产通路（内容偏移 + 内核滚动联动 + 刷层，一次完成）。
        //   ★与 tap 共存：点击/长按时 pan 识别**失败**⇒ 不取消 touches ⇒ `touchesEnded` 的 tap
        //     判定照常（两条手势互不吞并）。
        let pan = UIPanGestureRecognizer(target: self, action: #selector(handleScrollPan(_:)))
        pan.maximumNumberOfTouches = 1
        addGestureRecognizer(pan)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    /// 清空当前层树
    func clearLayers() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for l in layerNodes { l.removeFromSuperlayer() }
        layerNodes.removeAll(keepingCapacity: true)
        builtLayerCount = 0
        rectsByNodeId.removeAll(keepingCapacity: true)
        metaByNodeId.removeAll(keepingCapacity: true)
        absOriginByNodeId.removeAll(keepingCapacity: true)
        layersById.removeAll(keepingCapacity: true)
        // ★★C2（2026-10-01）：描边形状层也要清——**它与 `layersById` 是同一份层的两份簿记**：
        //   只清前者 ⇒ 全量重建后 `attachSvgStroke` 的幂等检查（`layerStrokeShapes[id] != nil`）
        //   会命中**已被丢弃的旧层**的登记 ⇒ 新层上永远没有描边子层
        //   （真机现象：diag built=1 而探针 subLayers=0——建在了别处）。
        //   ★纪律：**一张层上挂了两份簿记时，清理必须成对**（与"层树与簿记是同一事实的两份视图"
        //     的历史教训同源）。
        layerStrokeShapes.removeAll(keepingCapacity: true)
        // ★★渐变层同款成对清理（与描边同一教训：只清一份簿记 ⇒ 重建后幂等检查命中旧层）
        layerGradients.removeAll(keepingCapacity: true)
        // ★★发光子层同款成对清理（与描边/渐变同一教训：只清一份簿记 ⇒ 重建后命中旧层）
        layerGlowShapes.removeAll(keepingCapacity: true)
        layerGlowSpec.removeAll(keepingCapacity: true)
        // ★★遮罩层同款成对清理（与描边/渐变/发光同一教训）
        layerMasks.removeAll(keepingCapacity: true)
        // ★★裁剪形状同款成对清理（★★A/B 实测抓出的漏项，2026-10-03）：
        //   漏清它 ⇒ A 树（id=5）的 clip 登记**残留在表里**，B 树（id=9）mount 后
        //   两棵树的登记同时在表里 ⇒ `probeChannels` 读到 2 个 clip（A 1 / B 2 的假差异）。
        //   ★与描边/渐变/发光是**同一个教训的第四次复现**：新增一份层簿记就要在 clearLayers
        //     里同款清理（本处已列全：stroke/gradient/glow/spec/mask/clip/base/transformOrigin）。
        layerClipShape.removeAll(keepingCapacity: true)
        layerClipBase.removeAll(keepingCapacity: true)
        layerTransformOrigin.removeAll(keepingCapacity: true)
        parentById.removeAll(keepingCapacity: true)
        childrenById.removeAll(keepingCapacity: true)
        builtFrames.removeAll(keepingCapacity: true)
        builtParents.removeAll(keepingCapacity: true)
        // ★建新树 ⇒ 滚动偏移归零（见 resetContentOffset 的说明：视图状态会跨用例泄漏）
        resetContentOffset()
        CATransaction.commit()
    }

    /// 建层：按 style 造一个层（文本 ⇒ CATextLayer；否则 CALayer）
    ///
    /// 【为什么抽成方法（本仓纪律：同一语义一处实现）】全量重建（`buildLayers`）与
    ///   **结构增量**（`insertLayers`）都要造层——两份实现必然分叉 ⇒
    ///   新插入的行会与全量树**外观不一致**（静默错，且只有像素比对能发现）。
    /// @param nodeId 节点 id（**仅用于记底色快照** `layerOriginalBg`——复位目标，见其注释）
    private func makeLayer(style: [String: Any], nodeId: Int, boxWidth: CGFloat = 0) -> CALayer {
        let text = style["text"] as? String
        let fontSize = style["fontSize"] as? CGFloat
        if let text = text, !text.isEmpty {
            // 文本叶子 → CATextLayer（GPU 加速；不创建 UIView，也不自栅格化）。
            // ★★★行高修复（2026-10-08）：用子类 ProteusTextLayer——声明 line-height 的多行文本走 CoreText 绘制
            let tl = ProteusTextLayer()
            // ★★★line-clamp 项（2026-10-08）：多行截断——按盒宽预截断（尾省略号）后再绘制
            // ★★★word-break:normal（2026-10-09）：`effectiveWrap` 在 wrap 判定上叠加「无断点长串溢出 ⇒ 不折行」（须先于 clamped/string）
            let wrapMode = SelfDrawView.effectiveWrap(style, text: text, boxWidth: boxWidth)
            let clamped = SelfDrawView.clampedText(text, style: style, boxWidth: boxWidth)
            tl.string = clamped
            let fs = fontSize ?? 14
            let fw = (style["fontWeight"] as? CGFloat) ?? 400
            // ★字体由统一构造器给出（与度量同源——见 `font(size:weight:family:)` 注释）
            let ufont = ProteusTextAdapter.font(size: fs, weight: fw,
                                            family: (style["fontFamily"] as? String) ?? "system")
            tl.font = ProteusTextAdapter.cgFont(of: ufont)
            tl.fontSize = fs
            let textCg = (style["color"] as? String).flatMap(parseHexColor)?.cgColor ?? UIColor.white.cgColor
            tl.foregroundColor = textCg
            tl.string = textLayerString(clamped, style: style, font: ufont, color: textCg,
                                         wrapOverride: wrapMode)
            // ★记文字色快照（复位目标；见 `layerOriginalTextColor` 注释）
            layerOriginalTextColor[nodeId] = textCg
            tl.alignmentMode = alignmentMode(style["textAlign"] as? String)
            // ★★全端对齐批（2026-10-05 · white-space 五端对齐）：wrap ⇒ 换行不截断；
            //   nowrap ⇒ 单行（ellipsis 截断 / overflow:hidden 裁切 / 其余原样溢出）。
            // ★★★行高修复（2026-10-08）：声明行高的**多行**文本 ⇒ CoreText 绘制（CATextLayer 忽略段落行高）
            // ★★★word-break:normal（2026-10-09）：CoreText 会**硬折**长词 ⇒ 仅在实际换行(wrapMode)时启用
            tl.useCoreText = SelfDrawView.needsCoreText(style) && wrapMode
            tl.truncationMode = (!wrapMode && (style["textOverflow"] as? String) == "ellipsis") ? .end : .none
            tl.masksToBounds = isClipTextStyle(style)   // nowrap 溢出的裁切（Web overflow:hidden 语义）
            // ★contentsScale 必须显式设置：否则 Retina 上文本模糊（CATextLayer 不继承自动缩放）
            tl.contentsScale = UIScreen.main.scale
            tl.isWrapped = wrapMode
            applyBorder(tl, style: style)
            applyOutline(tl, style: style)
            applyShadow(tl, style: style)
            // ★★★text-shadow 项（2026-10-08）：文本投影（CATextLayer.shadow* 作用于**文本内容**= 字形阴影）
            applyTextShadow(tl, style: style)
            SelfDrawBridge.applyPaintHint(tl, style: style)
            applyVisibility(tl, style: style)
            return tl
        }
        let layer = CALayer()
        if let bg = (style["backgroundColor"] as? String).flatMap(parseHexColor) {
            layer.backgroundColor = bg.cgColor
            // ★记底色快照（复位目标；见 `layerOriginalBg` 注释）——id 在调用方（makeLayer）不可见，
            //   故由 `id` 参数写入（`makeLayer` 已带 nodeId）
            layerOriginalBg[nodeId] = bg.cgColor
        }
        // ★批次 5（CSS 兼容对齐 · 边框）：uniform 边框（borderWidth + borderColor）——CALayer 原生边框。
        applyBorder(layer, style: style)
        applyOutline(layer, style: style)
        // ★批次 10：盒阴影（在 masksToBounds 之前——CORNER 圆角裁剪会裁掉阴影，见下方）
        let hasShadow = (style["boxShadow"] as? [String: Any]) != nil
        applyShadow(layer, style: style)
        if let r = style["borderRadius"] as? CGFloat, r > 0 {
            layer.cornerRadius = r
        }
        // ★★★overflow-x 项（2026-10-06 · 与 Web 对齐的真缺陷修复）：**圆角不再隐含 masksToBounds**——
        //   CALayer 的 backgroundColor/border 始终按 cornerRadius 圆角化（无需 mask）；而 mask 会裁
        //   **子层**（把 overflow:visible 的溢出内容也裁掉——本轮实锤：B 案红块被圆角卡片裁到卡缘，
        //   内核 rects 给的 120 是正确的）。Web 的 border-radius **不裁内容**（除非 overflow 非 visible）
        //   ⇒ 裁剪只由 overflow/clipText 决定。★代价（诚实边界）：CATextLayer 的**文字本体**也不再被
        //   圆角裁——需裁走 overflow: hidden（与 Web 同语义）。
        layer.masksToBounds = Self.isOverflowClipped(style) || isClipTextStyle(style)
        // ★批次 34：逐角圆角（非统一时用 maskedCorners；会覆盖上面的 masksToBounds）
        applyRadiusCorners(layer, style: style)
        // ★（阴影互斥）：圆角不再开 mask ⇒ 与 boxShadow 天然共存（旧注释的互斥已不适用）
        // ★★★overflow-x 项（2026-10-06）：overflow 裁剪子内容（CSS Overflow 3——裁剪盒 = padding box）。
        //   本端层是**真嵌套**（parent.addSublayer）⇒ masksToBounds 天然裁整棵子树（无需内核算 clip 矩形）。
        //   ★放在 applyRadiusCorners **之后**：圆角路径会设 masksToBounds=true（圆角需裁），此处只做"开"，
        //     不做"关"（避免与圆角/阴影合并判定打架——三处都是"要裁就开"的单调操作）。
        //   ★诚实边界：maskedCorners（有圆角时）限定裁剪形状为圆角矩形；纯矩形 overflow 裁剪与之一致
        //     （圆角盒的裁剪本就是圆角矩形——Web 同语义）。
        if Self.isOverflowClipped(style) { layer.masksToBounds = true }
        // ★B 批 3D：透视快照（建层时读一次——动画期 applyTransform 只查表，不回读树样式）
        if let d = style["perspective"] as? CGFloat, d > 0 {
            layerPerspective[nodeId] = d
        }
        // ★★变换原点快照（transform-origin v1：同款"建层读一次"纪律）
        if let o = style["transformOrigin"] as? [String: Any],
           let ox = (o["x"] as? Double) ?? (o["x"] as? CGFloat).map(Double.init),
           let oy = (o["y"] as? Double) ?? (o["y"] as? CGFloat).map(Double.init) {
            layerTransformOrigin[nodeId] = CGPoint(x: ox, y: oy)
        }
        // ★★C2：SVG 描边的**建层**走 `attachSvgStroke(fromKernelPaths:)`（全量挂载后调用）——
        //   段列表**只能从内核拿**（解析在内核；请求树里只有 `d` 字符串——见内核
        //   `proteus_layout_svg_nodes` 的注释：宿主不解析，只翻译）。
        //   本函数（makeLayer）在建层时**不碰** SVG（无段列表可用）。
        // ★★渐变填充（v1 静态 paint——2026-10-01）：声明了 fillGradient ⇒ 挂一个 CAGradientLayer
        //   子层（几何在本层 bounds 内铺满；端点换算见 `applyGradient` 的注释——与 TS
        //   `linearGradientEndpoints` / Kotlin 同式：0°=向上，端点 = 中心 ± 半程向量）。
        //   ★静态 paint：不参与动画（v1 边界，见 animation/gradient.ts 文件头）。
        if let fg = style["fillGradient"] as? [String: Any] {
            // ★★★背景定位家族（2026-10-07）：渐变放进**裁剪容器**（`clip` = 元素盒 + masksToBounds
            //   ⇒ 图像盒超出元素时被裁，与 Web 背景绘制区一致）。实际 frame 在布局后由
            //   `syncGradientFrames` 统一设（多条建层路径同享一次）。
            //   ★★平铺（repeat）：CAGradientLayer **无 tile 模式** ⇒ 用**栅格化 tile**
            //     （`CGContextDrawTiledImage`，相位 = position 偏移）——与 Android TileMode.REPEAT 等效。
            let clip = CALayer()
            clip.masksToBounds = true
            if (style["backgroundRepeat"] as? String) == "repeat" {
                let tile = CALayer()
                tile.contentsScale = UIScreen.main.scale
                clip.addSublayer(tile)
                layer.addSublayer(clip)
                layerGradientTiles[nodeId] = tile
            } else {
                let g = CAGradientLayer()
                g.contentsScale = UIScreen.main.scale
                clip.addSublayer(g)
                if Self.applyGradient(g, spec: fg, bounds: layer.bounds) {
                    layer.addSublayer(clip)
                    layerGradients[nodeId] = g
                }
            }
        }
        // ★★软边遮罩（mask v1）：`CAGradientLayer` 作 `layer.mask`（软边渐隐的通用原语）。
        //   ★揭示色标由**内核唯一实现**（这里是**静态基态的初值**；动画期由 `applyMaskTick` 更新）。
        //   ★与 clip 的 mask 冲突处理：**嵌套**——clip 的 CAShapeLayer 也是 mask，两者不能同层共存
        //     ⇒ 本引擎 v1 约定：同节点同时声明 clip 与 mask 时，**clip 优先、遮罩退化**（诚实边界，
        //       列在文档）。多遮罩合成（shape+gradient 串联）不在 v1。
        if let mk = style["mask"] as? [String: Any],
           let kindS = mk["kind"] as? String {
            let mkind = kindS == "linear" ? 1 : kindS == "radial" ? 2 : 0
            if mkind != 0 {
                if layerClipShape[nodeId] != nil {
                    // ★clip 优先（诚实边界：见上）
                    NSLog("[proteus] 节点 %d 同时声明 clip 与 mask——v1 约定 clip 优先（遮罩退化）", nodeId)
                } else {
                    let gm = CAGradientLayer()
                    gm.frame = layer.bounds
                    gm.contentsScale = UIScreen.main.scale
                    if mkind == 1 {
                        let angle = (mk["angle"] as? Double) ?? 180
                        // ★同一 CSS 规范式（见 linearEndpoints）——遮罩渐变与填充渐变同轴
                        let ep = Self.linearEndpoints(angleDeg: angle, width: Double(gm.bounds.width), height: Double(gm.bounds.height))
                        gm.startPoint = CGPoint(x: ep.x0, y: ep.y0)
                        gm.endPoint = CGPoint(x: ep.x1, y: ep.y1)
                        gm.type = .axial
                    } else {
                        let cx = (mk["cx"] as? Double) ?? 0.5
                        let cy = (mk["cy"] as? Double) ?? 0.5
                        let r = (mk["r"] as? Double) ?? 0.75
                        gm.type = .radial
                        gm.startPoint = CGPoint(x: cx, y: cy)
                        gm.endPoint = CGPoint(x: cx + r, y: cy)
                    }
                    // 基态揭示色标（与内核 `reveal_stops` 同式——静态初值；动画期由内核逐帧下发）
                    let soft = (mk["softness"] as? Double) ?? 0.25
                    let p0 = (mk["progress"] as? Double) ?? 1.0
                    let (oa, aa, ob, ab) = Self.maskStopsLocal(softness: soft, progress: p0)
                    gm.colors = [
                        UIColor.white.withAlphaComponent(CGFloat(aa)).cgColor,
                        UIColor.white.withAlphaComponent(CGFloat(ab)).cgColor,
                    ]
                    gm.locations = [NSNumber(value: oa), NSNumber(value: ob)]
                    CATransaction.begin()
                    CATransaction.setDisableActions(true)
                    layer.mask = gm
                    CATransaction.commit()
                    layerMasks[nodeId] = gm
                }
            }
        }
        // ★★发光（glow v1）：**分层描边子层**——N 层（宽度梯度 + alpha 平方衰减，见 TS `glowLayers`）。
        //   ★与 Android 同式（不用 iOS 原生 `shadow*`：那是高斯阴影、与 Android 不同形——
        //     本仓"跨端一致优先"）。子层几何 = 本层 bounds；描边色/宽在每帧"发光明暗"时更新。
        if let gl = style["glow"] as? [String: Any],
           let colorHex = gl["color"] as? String,
           let radius = gl["radius"] as? Double,
           let alpha = gl["alpha"] as? Double,
           let baseColor = parseHexColor(colorHex), radius > 0, alpha > 0 {
            var shapes: [CAShapeLayer] = []
            let n = Self.glowLayerCount
            for k in 1...n {
                let t = Double(k - 1) / Double(n)
                let a = alpha * (1 - t) * (1 - t)
                let boost = radius * (Double(k) / Double(n))
                let sh = CAShapeLayer()
                sh.fillColor = nil
                sh.strokeColor = baseColor.withAlphaComponent(CGFloat(a)).cgColor
                sh.lineWidth = CGFloat(boost * 2.0)
                sh.lineCap = .round
                sh.lineJoin = .round
                // 形状在"发光明暗/draw 时"按内容设（线条用 svg path + 进度；色块用圆角矩形）
                sh.path = CGPath(
                    roundedRect: layer.bounds, cornerWidth: (style["borderRadius"] as? CGFloat) ?? 0,
                    cornerHeight: (style["borderRadius"] as? CGFloat) ?? 0, transform: nil)
                sh.contentsScale = UIScreen.main.scale
                layer.addSublayer(sh)
                shapes.append(sh)
            }
            layerGlowShapes[nodeId] = shapes
            layerGlowSpec[nodeId] = (baseColor, CGFloat(alpha))
        }
        // ★★C1：裁剪形状快照（树里声明的静态类型 + 基态参数；动画只改参数不改类型）
        //   ★并**立即应用基态遮罩**——静态裁剪（声明了但未动画）也必须渲染
        //     （内核只上报"值变化"的节点 ⇒ 未动的裁剪节点不会出现在每帧记录里；
        //      首版只从每帧记录取参数 ⇒ 静态裁剪完全不生效——本仓纪律：判据要覆盖静/动两态）。
        // ★★数值类型兼容（2026-10-03 A/B 实测抓出）：JSON 数组 `[0, 0, 0.45, 0]` 经
        //   JSONSerialization 解析后是 **`[NSNumber]` 混合类型**（前两个是 Int、中间是 Double）
        //   ——`as? [Double]` 在 Swift 里**不做元素级隐式转换** ⇒ 转换失败 ⇒ **clip 静默不建**
        //   （A/B 通道签名对照：A 4/5 个通道 vs B 5/5 —— 跨端对照就是这块的探针）。
        //   ⇒ 逐元素转 Double（`NSNumber` 与数值类型都吃）。
        if let cp = style["clipPath"] as? [String: Any],
           let kindS = cp["kind"] as? String,
           let psAny = cp["params"] as? [Any] {
            let ps: [Double] = psAny.compactMap { ($0 as? NSNumber)?.doubleValue ?? ($0 as? Double) }
            let kind = kindS == "inset" ? 1 : kindS == "circle" ? 2 : kindS == "polygon" ? 3 : 0
            if kind != 0 {
                layerClipShape[nodeId] = (kind, ps.map { CGFloat($0) })
                // 基态参数（补足 16 槽）——与每帧记录同形，直接走 applyClip
                var base = [Float](repeating: 0, count: 16)
                for (i, v) in ps.enumerated() where i < 16 { base[i] = Float(v) }
                layerClipBase[nodeId] = base
                applyClip(nodeId: nodeId, layer: layer, params: base)
            }
        }
        applyVisibility(layer, style: style)
        return layer
    }

    /// 按几何建 CALayer 树
    ///
    /// - Parameter flat: `[(nodeId, parentId, rect, style)]` —— 已按树序拍平（父在前）
    func buildLayers(
        flat: [(id: Int, parentId: Int?, rect: CGRect, style: [String: Any])]
    ) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        var byId: [Int: CALayer] = [:]
        for item in flat {
            let layer = makeLayer(style: item.style, nodeId: item.id, boxWidth: item.rect.width)
            // ★几何**完全来自 Rust 核心**（位置/尺寸都不是 UIKit 算的）
            //
            // ★★坐标系换算（本仓实测踩到，是本场景最关键的一处）：
            //   核心给的 rects 是**绝对坐标**（相对根原点），而 CALayer 的子层 frame 是
            //   **相对父层**的坐标 —— 直接把绝对坐标赋给子层会**二次叠加父偏移**。
            //   现象：所有嵌套内容整体下移/右移（文字跑到卡片外、卡片看起来盖住标题），
            //   而几何报告本身是**正确的**（所以只查报告发现不了，必须看图）。
            //   ⇒ 子层 frame = 绝对 rect − 父层绝对原点。
            let parentOrigin: CGPoint
            if let pid = item.parentId, let parentAbs = absOriginByNodeId[pid] {
                parentOrigin = parentAbs
            } else {
                parentOrigin = .zero
            }
            absOriginByNodeId[item.id] = item.rect.origin
            // ★批次 13：文本层若声明 lineHeight ⇒ 可视 frame 居中收缩（CSS 半行距居中）
            layer.frame = lineBoxFrame(CGRect(x: item.rect.minX - parentOrigin.x,
                                 y: item.rect.minY - parentOrigin.y,
                                 width: item.rect.width, height: item.rect.height), style: item.style)
            applyRadiusPct(layer, style: item.style, size: item.rect.size)
            builtFrames[item.id] = layer.frame
            builtParents[item.id] = item.parentId ?? -1
            layersById[item.id] = layer
            parentById[item.id] = item.parentId ?? -1
            if let pid = item.parentId {
                childrenById[pid, default: []].append(item.id)
            }
            if let pid = item.parentId, let parent = byId[pid] {
                parent.addSublayer(layer)
            } else {
                self.layer.addSublayer(layer)
            }
            byId[item.id] = layer
            layerNodes.append(layer)
            rectsByNodeId[item.id] = item.rect
            metaByNodeId[item.id] = item.style
            // ★建树时**顺带算深度**（本仓实测的性能修复）：`depthOf` 每次沿父链上溯 O(深度)，
            //   而排序要 O(n log n) 次比较 ⇒ 4003 节点实测 sort 段 **19.38ms**（占 layers 段 88%）。
            //   建层时父必已建好 ⇒ 直接 parent 深度 +1，O(1)。
            depthById[item.id] = item.parentId.flatMap { depthById[$0] }.map { $0 + 1 } ?? 0
        }
        // ★批次 39：**静态变换**（编译期 CSS transform）——建层后应用（此时 layer.bounds 已定）。
        //   位移分 px（直接用）与**盒比例**（txPct/tyPct × 盒尺寸：translate(-50%,-50%) 居中刚需）；
        //   缩放取等比（编译器已拒绝非等比）。与动画同一条 `applyTransform` 通道（静态是基态，动画覆盖之）。
        for item in flat {
            guard let t = Self.staticTransform(style: item.style),
                  let lyr = layersById[item.id] else { continue }
            let b = lyr.bounds
            let tx = CGFloat(t.txPx) + CGFloat(t.txPct) * b.width
            let ty = CGFloat(t.tyPx) + CGFloat(t.tyPct) * b.height
            _ = applyTransform(nodeId: item.id, tx: tx, ty: ty, scale: CGFloat(t.scale), rotate: CGFloat(t.rotate))
        }
        builtLayerCount = layerNodes.count
        // ★V4：建层后清延迟更新簿记（新树 ⇒ 旧簿记失效）
        pendingOffscreen.removeAll(keepingCapacity: true)
        CATransaction.commit()
        // ★★★逐边 border 批（2026-10-05）：建层后按父 bounds 同步边框子层 frame（iOS 无自动布局）
        syncAllSideBorders()
        syncGradientFrames()
    }

    /* ────────────────────────── ★V7：结构变更的层维护 ────────────────────────── */

    /* ────────────────────────── ★★RT2：帧驱动（CADisplayLink） ────────────────────────── */

    /// 帧循环回调（由 DisplayLink 每 vsync 调一次）——入参为**单调帧间隔毫秒**
    var onFrame: ((Double) -> Void)?
    /// ★★**行回收回调**（§7.3 动画解绑）：Bridge 注入，入参 = 该行全部节点 id
    var onRowDematerialized: (([Int]) -> Void)?
    private var displayLink: CADisplayLink?
    private var lastFrameTs: CFTimeInterval = 0

    /// 帧统计（判据：`frames` 真在增长 = 驱动真的在跑，而不是"设了没动"）
    private(set) var frameCount = 0
    private(set) var lastFrameMs: Double = 0

    /// 启动帧循环（幂等：重复调用不重复建 Link）
    ///
    /// 【为什么用 CADisplayLink（而不是 Timer / DispatchSourceTimer）】
    ///   ① 它**跟随真实 vsync**（120Hz 屏 ⇒ 120 次/秒）——与"掉帧率/帧耗时"的测量口径直接对齐；
    ///   ② 系统会自动在暂停/后台时停掉它（省电且不会积压）；
    ///   ③ `targetTimestamp - timestamp` 给出**本帧预算**（可用于判断是否掉帧）。
    ///   ★不用固定 sleep/定时器：那测出来的"帧率"是定时器的频率，不是屏幕的（本仓纪律）。
    @discardableResult
    func startFrameLoop() -> Bool {
        if displayLink != nil { return true }
        lastFrameTs = 0
        let link = CADisplayLink(target: self, selector: #selector(onDisplayLink(_:)))
        link.add(to: .main, forMode: .common)   // .common：滚动/手势期间也继续（动画不能被滚动掐停）
        displayLink = link
        return true
    }

    func stopFrameLoop() {
        displayLink?.invalidate()
        displayLink = nil
        lastFrameTs = 0
    }

    var frameLoopRunning: Bool { displayLink != nil }

    @objc private func onDisplayLink(_ link: CADisplayLink) {
        let now = link.timestamp
        // ★首帧 dt = 0（没有"上一帧"）；此后用**真实 timestamp 差**（不是假设 16.67ms）
        let dtMs = lastFrameTs == 0 ? 0.0 : (now - lastFrameTs) * 1000.0
        lastFrameTs = now
        lastFrameMs = dtMs
        frameCount += 1
        onFrame?(dtMs)
    }

    /// ★★**层变换探针**（RT2 判据用）：从 **CALayer 真读**当前 transform——不是回显我们写入的值
    ///
    /// 【为什么必须"真读"（本仓纪律）】若判据比对我们自己传下去的参数，那是**自证**：
    ///   宿主可能收了参数但没写层（静默失效），比对仍会绿。⇒ 判据必须从**层的实际状态**读，
    ///   这样才覆盖"写入路径真的生效"。
    ///
    /// 返回：`[{"id":N,"tx":x,"ty":y,"scale":s}, …]`（从 CATransform3D 反解：tx/ty 取 m41/m42，
    ///   scale 取 m11——因为我们的构造是「平移 ∘ 中心缩放 ∘ 反平移」，m11 即缩放系数）
    func layerTransformProbe(_ idsJson: String) -> String {
        guard let data = idsJson.data(using: .utf8),
              let ids = (try? JSONSerialization.jsonObject(with: data)) as? [Int] else {
            return "{\"ok\":false,\"error\":\"入参需为 id 数组 JSON\"}"
        }
        var parts: [String] = []
        for id in ids {
            guard let layer = layersById[id] else {
                parts.append("{\"id\":\(id),\"missing\":true}")
                continue
            }
            let t = layer.transform
            // ★RT2 扩展：rotate 从变换矩阵反解（`atan2(m12, m11)`——对本仓的"中心旋转+缩放"构造成立）
            let rotateDeg = atan2(t.m12, t.m11) * 180 / .pi
            // ★★B 批 3D：rotateX/rotateY 同样**从层矩阵真读反解**（不用"我写入的值"）。
            //   纯 X 轴旋转：m22=cosθ, m23=sinθ ⇒ θ=atan2(m23, m22)；
            //   纯 Y 轴旋转：m33=cosθ, m31=sinθ ⇒ θ=atan2(m31, m33)。
            //   ★诚实边界：多轴+Z 旋转复合时读数会耦合（数值如实，不做伪单轴分解）。
            let rotateXDeg = atan2(t.m23, t.m22) * 180 / .pi
            let rotateYDeg = atan2(t.m31, t.m33) * 180 / .pi
            // ★★倾斜（skew v1）：**层矩阵反解**（m21 = tan(skewX) / m12 = tan(skewY)——
            //   与 Android Canvas.skew 同式）——判据据此断言"倾斜真的落到层上"
            let skewXDeg = atan(Double(t.m21)) * 180 / .pi
            let skewYDeg = atan(Double(t.m12)) * 180 / .pi
            // ★★C1：**真读**裁剪遮罩的路径包围盒（判据据此断言"形变真的落到层上"——
            //   不回显我们写入的参数；bbox 是 CoreGraphics 对 path 的实际计算结果）。
            var clipBox = ""
            if let mask = layer.mask as? CAShapeLayer, let p = mask.path {
                let bb = p.boundingBox
                clipBox = String(format: "%.3f,%.3f,%.3f,%.3f", bb.origin.x, bb.origin.y, bb.width, bb.height)
            }
            // ★★C2：**真读**描边形状层的 strokeEnd（判据据此断言画线进度真的落到层上）
            var strokeEndV = -1.0
            var subCount = 0
            for sub in layer.sublayers ?? [] {
                subCount += 1
                if let shape = sub as? CAShapeLayer, shape.strokeEnd >= 0 {
                    strokeEndV = Double(shape.strokeEnd)
                    break
                }
            }
            // ★★颜色（2026-10-01）：从 **CALayer 真读** `backgroundColor` 反解打包色
            //   （判据纪律：真读层上状态，不回显我们写入的参数）
            let bgStr = Self.packedHexFromCGColor(layer.backgroundColor)
            // ★★渐变（v1 · 2026-10-01）：**真读层上真源**（`layerGradients` 表的层 +
            //   该层自身的 type/色标数）——判据据此断言"渐变真的建出来了"（不回显声明参数）。
            //   形态 `"linear:2"` / `"radial:3"`；无渐变 ⇒ 空串（与 bg/textColor 的空串语义同款）。
            var gradStr = ""
            if let g = layerGradients[id] {
                let t = g.type == .radial ? "radial" : g.type == .axial ? "linear" : "?"
                // ★几何也真读（判据据此断言"光的几何真的在动"）：径向报 r（start→end 距离）、
                //   线性报角度（由 startPoint→endPoint 反解）——与 Kotlin 同口径
                var geo = ""
                if let sp = g.startPoint as CGPoint?, let ep = g.endPoint as CGPoint? {
                    if g.type == .radial {
                        let rr = hypot(Double(ep.x - sp.x), Double(ep.y - sp.y))
                        geo = String(format: "%.4f", rr)
                    } else {
                        let dx = Double(ep.x - sp.x)
                        let dy = Double(ep.y - sp.y)
                        let ang = atan2(dx, -dy) * 180 / .pi
                        geo = String(format: "%.2f", ang)
                    }
                }
                gradStr = "\(t):\(g.colors?.count ?? 0):\(geo)"
            }
            // ★★遮罩（mask v1）：**真读**层上真源（mask 的 type/位置/色标数）——判据据此断言揭示在变
            var maskStr = ""
            if let gm = layerMasks[id] {
                let t = gm.type == .radial ? "radial" : "linear"
                let offs = (gm.locations ?? []).map { ($0 as? NSNumber)?.doubleValue ?? 0 }
                let locStr = offs.count >= 2 ? String(format: "%.3f,%.3f", offs[0], offs[1]) : "?"
                maskStr = "\(t):\(locStr)"
            }
            // ★★发光（v1）：**真读**子层数与首层 alpha（判据据此断言"发光真的建出来了/真的在变"）
            var glowStr = ""
            if let shapes = layerGlowShapes[id], let first = shapes.first,
               let c = first.strokeColor {
                let a = c.alpha
                glowStr = String(format: "%d:%.3f", shapes.count, a)
            }
            // ★文字色（2026-10-01）：CATextLayer 才有 `foregroundColor`；非文本层报空串
            let textStr = Self.packedHexFromCGColor((layer as? CATextLayer)?.foregroundColor)
            // ★诊断串**先算成变量**（2026-10-01）：把多个 `\(…)` 插值直接续在拼接链的
            //   最后一段上时，`\""`（转义引号 + 字符串结束）与后续 `}` 让 Swift 解析器
            //   产生歧义（实测：错误被报成相距 400 行的 "static properties may only be
            //   declared on a type"——**误导性极强**）。变量化后错误消失。
            //   ★教训：拼接链的最后一段含"转义引号收尾 + 多插值"时，先落变量再拼。
            let diagStr = "\(SvgDiag.attachStats)/\(SvgDiag.built)/\(SvgDiag.skipNoId)/\(SvgDiag.skipNoLayer)/\(SvgDiag.skipNoSegs)"
            parts.append(
                "{\"id\":\(id),\"tx\":\(t.m41),\"ty\":\(t.m42),\"scale\":\(t.m11),"
                    + "\"rotate\":\(rotateDeg),\"rotateX\":\(rotateXDeg),\"rotateY\":\(rotateYDeg),"
                    + "\"skewX\":\(skewXDeg),\"skewY\":\(skewYDeg),"
                    + "\"opacity\":\(layer.opacity),\"bg\":\"\(bgStr)\","
                    + "\"textColor\":\"\(textStr)\",\"clipBox\":\"\(clipBox)\","
                    + "\"strokeEnd\":\(strokeEndV),\"subLayers\":\(subCount),"
                    + "\"gradient\":\"\(gradStr)\","
                    + "\"glow\":\"\(glowStr)\","
                    + "\"mask\":\"\(maskStr)\","
                    + "\"svgDiag\":\"\(diagStr)\"}"
            )
        }
        return "{\"ok\":true,\"layers\":[\(parts.joined(separator: ","))]}"
    }

    /// ★★A/B：**绘制通道探针**（与 Android `probeChannels` 同族——**从层上真读**，不回显声明参数）。
    ///
    /// 【六个通道的读数来源（全部为宿主侧实际持有的状态）】
    ///   · `radius`：`layer.cornerRadius`（>0 = 圆角生效）
    ///   · `grad`：`layerGradients` 表的层 + 类型/色标数（`1:2` = 线性 2 色标）
    ///   · `glow`：`layerGlowShapes` 的层数:首层 alpha（分层同心描边）
    ///   · `clip`：`layerClipShape` 的 kind（0=无 / 1=inset / 2=circle / 3=polygon）
    ///   · `stroke_len`：`layerStrokeShapes` 路径的**真实弧长**（CGPath 逐段累加——真算非回显）
    ///   · `mask`：`layerMasks` 的 kind（0=无 / 1=linear / 2=radial）
    ///
    /// 【为什么 stroke_len 要真算】Android 用 `PathMeasure.getLength()`（系统真值）；
    ///   iOS 无等价 API ⇒ 逐段累加（直线精确 + 贝塞尔 16 段采样近似）——**仍是真算**。
    func channelProbe(_ idsJson: String) -> String {
        guard let data = idsJson.data(using: .utf8),
              let ids = (try? JSONSerialization.jsonObject(with: data)) as? [Int] else {
            return "{\"ok\":false,\"error\":\"入参需为 id 数组 JSON\"}"
        }
        var parts: [String] = []
        for id in ids {
            var radius = 0.0
            var gradStr = ""
            var glowStr = ""
            var clipKind = 0
            var strokeLen = 0.0
            var maskKind = 0
            if let layer = layersById[id] {
                radius = Double(layer.cornerRadius)
                if let g = layerGradients[id] {
                    let k = g.type == .radial ? 2 : 1
                    gradStr = "\(k):\(g.colors?.count ?? 0)"
                }
                if let shapes = layerGlowShapes[id], let first = shapes.first,
                   let c = first.strokeColor {
                    glowStr = String(format: "%d:%.3f", shapes.count, Double(c.alpha))
                }
                if let cs = layerClipShape[id] { clipKind = cs.kind }
                if let shape = layerStrokeShapes[id], let p = shape.path {
                    strokeLen = Self.cgPathLength(p)
                }
                if let m = layerMasks[id] { maskKind = m.type == .radial ? 2 : 1 }
            }
            let r3 = (radius * 1000).rounded() / 1000
            let s3 = (strokeLen * 1000).rounded() / 1000
            var fields = "\"id\":\(id),\"radius\":\(r3)"
            if !gradStr.isEmpty { fields += ",\"grad\":\"\(gradStr)\"" }
            if !glowStr.isEmpty { fields += ",\"glow\":\"\(glowStr)\"" }
            fields += ",\"clip\":\(clipKind)"
            if s3 > 0 { fields += ",\"stroke_len\":\(s3)" }
            fields += ",\"mask\":\(maskKind)"
            parts.append("{\(fields)}")
        }
        return "{\"ok\":true,\"channels\":[\(parts.joined(separator: ","))]}"
    }

    /// CGPath **真实弧长**（直线精确 + 贝塞尔 16 段采样——判据读它证明"描边层真的建出来了"）
    static func cgPathLength(_ path: CGPath) -> Double {
        var len = 0.0
        var cur = CGPoint.zero
        var start = CGPoint.zero
        path.applyWithBlock { elPtr in
            let el = elPtr.pointee
            switch el.type {
            case .moveToPoint:
                cur = el.points[0]; start = cur
            case .addLineToPoint:
                let p = el.points[0]
                len += hypot(Double(p.x - cur.x), Double(p.y - cur.y)); cur = p
            case .addQuadCurveToPoint:
                let c = el.points[0], p = el.points[1]
                var prev = cur
                for i in 1...16 {
                    let t = Double(i) / 16.0
                    let mt = 1 - t
                    let q = CGPoint(x: mt * mt * cur.x + 2 * mt * t * c.x + t * t * p.x,
                                    y: mt * mt * cur.y + 2 * mt * t * c.y + t * t * p.y)
                    len += hypot(Double(q.x - prev.x), Double(q.y - prev.y)); prev = q
                }
                cur = p
            case .addCurveToPoint:
                let c1 = el.points[0], c2 = el.points[1], p = el.points[2]
                var prev = cur
                for i in 1...16 {
                    let t = Double(i) / 16.0
                    let mt = 1 - t
                    let cx = mt * mt * mt * cur.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p.x
                    let cy = mt * mt * mt * cur.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p.y
                    let q = CGPoint(x: cx, y: cy)
                    len += hypot(Double(q.x - prev.x), Double(q.y - prev.y)); prev = q
                }
                cur = p
            case .closeSubpath:
                len += hypot(Double(start.x - cur.x), Double(start.y - cur.y)); cur = start
            @unknown default:
                break
            }
        }
        return len
    }


    /// ★★**复位所有层的变换与透明度**（相位间状态清理；见 `animStopAll`）
    ///
    /// ★★**颜色（2026-10-01）**：内核侧的 `stop_all` 会把 `bg` 复位回底色（`bg_base`），
    ///   宿主这一侧必须**跟同一件事**——否则层上留着动画末帧的颜色（内核已回、层未回 ⇒ 分叉）。
    ///   ⇒ 把 `backgroundColor` 一并按底色重建（底色的字符串形态在建层时已持有，见 `layerOriginalBg`）。
    func resetAllTransforms() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for (id, layer) in layersById {
            layer.transform = CATransform3DIdentity
            layer.opacity = 1
            // ★回底色（`layerOriginalBg` 是建层时记下的静态值；缺省 nil = 本层本来无底色）
            if let orig = layerOriginalBg[id] {
                layer.backgroundColor = orig
            }
            // ★回原文字色（与底色同一义务——见 `layerOriginalTextColor`）
            if let tl = layer as? CATextLayer, let orig = layerOriginalTextColor[id] {
                tl.foregroundColor = orig
            }
            // ★★C1：裁剪遮罩回**基态形状**（2026-10-01）——stop/复位后遮罩不能停在末帧
            //   （首版漏此步：动画停止后 mask 留在末帧路径 ⇒ 层被永久裁到错误形状）。
            if layerClipShape[id] != nil {
                let base = layerClipBase[id] ?? [Float](repeating: 0, count: 16)
                applyClip(nodeId: id, layer: layer, params: base)
            }
            // ★★C2：描边进度回**声明的基态**（缺省 0 = 未画；静态已画成 = 1——2026-10-01
            //   修正：此前硬编码 0 会把"生来已画成"的静态描边抹掉）——与遮罩同一条
            //   "stop 必须清值"的义务（真机判据 W14f 抓到首版漏此步：stop 后 strokeEnd 停在 1）。
            if let shape = layerStrokeShapes[id] {
                shape.strokeEnd = CGFloat(layerStrokeBase[id] ?? 0)
            }
        }
        CATransaction.commit()
    }

    /// 建层时的**底色快照**（复位目标；与内核 `bg_base` 同一件事的宿主侧副本）
    ///
    /// 【为什么必须存（不是"重新解析一遍 style"）】建层后 `style` 不再保留在层上
    ///   （`makeLayer` 只把值写进 CALayer）；而复位需要"原始值" ⇒ 建层时记一份。
    ///   ★与内核 `bg_base` 的一致性由判据守（同一条 stop 语义两端都要回底色）。
    private(set) var layerOriginalBg: [Int: CGColor] = [:]
    /// 建层时的**文字色快照**（复位目标；与 `layerOriginalBg` 同一条约定，只是落到文字）
    private(set) var layerOriginalTextColor: [Int: CGColor] = [:]
    /// ★★**透视距离快照**（B 批 3D；建层时从树样式读一次——动画期只读不查树）
    private(set) var layerPerspective: [Int: CGFloat] = [:]
    /// ★★**变换原点快照**（transform-origin v1）：盒分数（缺省 0.5/0.5 = 层中心）
    private(set) var layerTransformOrigin: [Int: CGPoint] = [:]
    /**
     * ★★**裁剪形状快照**（C1；建层时从树样式读一次）——`(kind, params16)`。
     * kind：1=inset 2=circle 3=polygon（与内核 `LStyle.clip_kind` 同编码）；
     * params 是**盒分数**（inset 四边 / circle cx,cy,r / polygon 顶点对）。
     */
    private(set) var layerClipShape: [Int: (kind: Int, params: [CGFloat])] = [:]
    /** ★C1 基态参数（16 槽；stop/复位时回它——与 layerOriginalBg 同一义务） */
    private(set) var layerClipBase: [Int: [Float]] = [:]
    /** 当前层的裁剪遮罩（复用；每帧只更新 path——不重建 layer） */
    private var layerClipMasks: [Int: CAShapeLayer] = [:]
    /**
     * ★★**SVG 描边快照**（C2）：**只存形状层**（段列表与样式是建层时的输入，不需留存）——
     * 与 `animStroke` 的每帧进度分开（前者是静态前提，后者是动态值）。
     * ★首版曾加一个 `[Int: (path:color:width:)]` 元组属性且**从未使用**——
     *   元组 + `private(set)` 触发了 Swift 解析器问题（报错原文 `static properties may only be
     *   declared on a type` ——紧跟其后的 static 字段全报错）；删掉未用属性即恢复。
     *   本仓纪律：**未使用的声明不留**（它们不只是噪音，还会以意外方式影响编译）。
     */
    /**
     * ★★**描边声明基态**（2026-10-01 · 手卷浏览抓出的缺口）：`svgPath.progress`（缺省 0 = 未画；
     *   静态浏览的路径 = 1 已画成）。建层时记下；复位（stop）与探针回落都用它——
     *   此前两处硬编码 0 ⇒ 静态 `progress:1` 的路径**生来就画不出来**（57 条描边节点全不可见）。
     */
    private var layerStrokeBase: [Int: Float] = [:]

    /** 描边形状层（复用；每帧只改 `strokeEnd`——不重建 path） */
    private var layerStrokeShapes: [Int: CAShapeLayer] = [:]
    /**
     * ★★**渐变填充层**（2026-10-01 · 渐变 v1）——`fillGradient` 声明 ⇒ 本节点挂一个
     *   `CAGradientLayer` 作**子层**（在底色之上、内容之下）。
     *   ★为什么不用 `mask`/`backgroundColor`：渐变是本层的 **fill**（与底色同语义的替换），
     *     不是裁剪；`CAGradientLayer` 的 `type = .axial/.radial` 与声明的两种 kind 一一对应。
     *   ★探针真读（`gradient` 字段）读的就是这一张表 ⇒ 判据断言"渐变真的建出来了"。
     */
    private var layerGradients: [Int: CAGradientLayer] = [:]
    /// ★★★背景定位家族（2026-10-07）：repeat 平铺的**栅格化 tile 层**（CAGradientLayer 无 tile）
    private var layerGradientTiles: [Int: CALayer] = [:]
    /**
     * ★★**发光分层描边子层**（glow v1）：节点 id → N 个 CAShapeLayer（由内到外）。
     *   与 Android 的 `GLOW_LAYERS` / TS `GLOW_LAYERS` **同值**（分层不一致 = 两端光晕形状不同）。
     */
    private var layerGlowShapes: [Int: [CAShapeLayer]] = [:]
    /// 发光的**声明规格快照**（色 + alpha）——每帧强度变化时从它重算（★不从"当前层值"反推：
    /// 那会随每次写入累积失真——"读回自己写的值"是本仓既有教训）。
    private var layerGlowSpec: [Int: (color: UIColor, alpha: CGFloat)] = [:]
    /** ★★软边遮罩层（mask v1）：节点 id → CAGradientLayer（作 `layer.mask`；动画期只改 colors/locations） */
    private var layerMasks: [Int: CAGradientLayer] = [:]

    /// ★★本地揭示色标（**仅用于建层静态初值**——动画期由内核逐帧下发；与内核 `reveal_stops` 同式）
    static func maskStopsLocal(softness: Double, progress: Double) -> (Double, Double, Double, Double) {
        let p = max(0, min(1, progress))
        let s = max(0, min(1, softness))
        if p <= 0 { return (0, 0, 1, 0) }
        if p >= 1 { return (0, 1, 1, 1) }
        let front = p * (1 + s) - s * 0.5
        if front + s * 0.5 <= 0 { return (0, 0, 1, 0) }
        if front - s * 0.5 >= 1 { return (0, 1, 1, 1) }
        let oa = max(0, min(1, front - s * 0.5))
        let ob = max(0, min(1, front + s * 0.5))
        return (oa, 1, ob, 0)
    }

    /// ★★**每帧遮罩揭示**（mask v1）——把内核**已算好**的色标写给 `CAGradientLayer` 的 colors/locations
    func applyMaskTick(nodeId: Int, kind: Int, oA: Float, aA: Float, oB: Float, aB: Float) {
        guard let gm = layerMasks[nodeId] else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        gm.colors = [
            UIColor.white.withAlphaComponent(CGFloat(max(0, min(1, aA)))).cgColor,
            UIColor.white.withAlphaComponent(CGFloat(max(0, min(1, aB)))).cgColor,
        ]
        gm.locations = [NSNumber(value: oA), NSNumber(value: oB)]
        CATransaction.commit()
    }
    /// ★跨语言常数（glow v1）：与 TS `GLOW_LAYERS` / Kotlin `GLOW_LAYERS` 同值——改必须三处同批
    static let glowLayerCount = 5
    // ★诊断计数改为**文件级全局**（真机接通排查用；见文件尾 `SvgDiag`）：
    //   ★为什么不用类内 static：首版写在类内且 swiftc 报 "static properties may only be
    //     declared on a type"（紧跟其后的一串字段全红）——而类在 L2508 才闭合（结构正常）。
    //     为避免与解析器纠缠，诊断量（非产品状态）直接放文件级。

    /* ────────────────── ★★MA0-RT：平台渲染线程零参与路径（§5-bis） ────────────────── */

    /// ★★**读"正在屏幕上显示的值"**（`presentationLayer`）——证明**平台在自己插值**
    ///
    /// 【为什么必须读 presentation（判据设计）】`layer.transform` 是 **model 值**（动画结束后
    ///   要显示的值）；而屏幕上**此刻**显示的是 `presentationLayer` 的值。
    ///   ⇒ 走"提交一次 + 平台自主插值"路径时，**主线程不再写值** ⇒ 只有 presentation 层
    ///     能证明"动画真的在跑"（若只读 model，会得到静止的终值，看起来像"没动"）。
    func layerPresentedProbe(_ idsJson: String) -> String {
        guard let data = idsJson.data(using: .utf8),
              let ids = (try? JSONSerialization.jsonObject(with: data)) as? [Int] else {
            return "{\"ok\":false,\"error\":\"入参需为 id 数组 JSON\"}"
        }
        var parts: [String] = []
        for id in ids {
            guard let layer = layersById[id] else {
                parts.append("{\"id\":\(id),\"missing\":true}")
                continue
            }
            // ★presentation() 在**无动画时返回 nil**（或与 model 相同）⇒ 回落到 model
            let p = layer.presentation()
            let t = (p ?? layer).transform
            let op = (p ?? layer).opacity
            let rotateDeg = atan2(t.m12, t.m11) * 180 / .pi
            parts.append(
                "{\"id\":\(id),\"tx\":\(t.m41),\"ty\":\(t.m42),\"scale\":\(t.m11),"
                    + "\"rotate\":\(rotateDeg),\"opacity\":\(op),\"hasPresentation\":\(p != nil)}"
            )
        }
        return "{\"ok\":true,\"layers\":[\(parts.joined(separator: ","))]}"
    }

    /// ★★**提交一次 ⇒ 平台自主插值**（`CAKeyframeAnimation`）——主线程之后**零参与**
    ///
    /// 【为什么用 `CAKeyframeAnimation` 而不是 `CABasicAnimation`】我们的曲线是**任意采样表**
    ///   （easeOutCubic / 弹簧积分结果），而 `CABasicAnimation` 的 timingFunction 只有三次贝塞尔
    ///   ⇒ 用**关键帧数组**表达才能**精确复现**本引擎的曲线（采样值与 `tick` 路径同源，
    ///   见 `commit_specs`）。⇒ 两条路径观感一致（这是"换实现不是重做"的判据）。
    ///
    /// 【Swift 侧没有任何曲线数学】采样值全部来自内核（`proteus_layout_anim_commit_spec`）；
    ///   本方法只负责"翻译成 CoreAnimation 的 API 形状"。
    @discardableResult
    func commitKeyframeAnimation(spec: [String: Any]) -> Bool {
        guard let nodeId = spec["nodeId"] as? Int,
              let layer = layersById[nodeId],
              let durMs = spec["durMs"] as? Double,
              let keyTimes = spec["keyTimes"] as? [Double],
              let samples = spec["samples"] as? [[Double]],
              samples.count == keyTimes.count, samples.count >= 2 else {
            return false
        }
        let delayS = ((spec["delayMs"] as? Double) ?? 0) / 1000.0
        let duration = max(durMs, 1) / 1000.0

        // ① 构造 CATransform3D 序列（与 applyTransform **同一构造**：中心锚点缩放/旋转）
        let b = layer.bounds
        var transforms: [CATransform3D] = []
        var opacities: [Float] = []
        var opacityChanges = false
        for s in samples {
            let tx = CGFloat(s[0]), ty = CGFloat(s[1]), sc = CGFloat(s[2])
            let rot = CGFloat(s[3]), op = Float(s[4])
            var t = CATransform3DTranslate(CATransform3DIdentity, tx, ty, 0)
            if sc != 1 || rot != 0 {
                t = CATransform3DTranslate(t, b.midX, b.midY, 0)
                if rot != 0 { t = CATransform3DRotate(t, rot * .pi / 180, 0, 0, 1) }
                if sc != 1 { t = CATransform3DScale(t, sc, sc, 1) }
                t = CATransform3DTranslate(t, -b.midX, -b.midY, 0)
            }
            transforms.append(t)
            opacities.append(op)
            if abs(op - 1) > 1e-6 { opacityChanges = true }
        }
        let last = samples[samples.count - 1]

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        // ② model 值先设成**终值**（动画移除后显示它 ⇒ 不会回弹）
        layer.transform = transforms[transforms.count - 1]
        layer.opacity = Float(last[4])

        let kt = keyTimes.map { NSNumber(value: $0) }
        let begin = CACurrentMediaTime() + delayS

        // ③ transform 关键帧（一条覆盖整个变换——平台的 transform 是整体，拆子属性会互相覆盖）
        let anim = CAKeyframeAnimation(keyPath: "transform")
        anim.values = transforms.map { NSValue(caTransform3D: $0) }
        anim.keyTimes = kt
        anim.duration = duration
        anim.beginTime = begin
        anim.fillMode = .forwards
        anim.isRemovedOnCompletion = false // 动画保留到结束（配合 model 值=终值；显式撤销由调用方/clearTree 负责）
        layer.add(anim, forKey: "proteus.anim.transform")

        // ④ opacity 仅在**真的变化**时提交（省一条动画）
        if opacityChanges {
            let oa = CAKeyframeAnimation(keyPath: "opacity")
            oa.values = opacities.map { NSNumber(value: $0) }
            oa.keyTimes = kt
            oa.duration = duration
            oa.beginTime = begin
            oa.fillMode = .forwards
            oa.isRemovedOnCompletion = false
            layer.add(oa, forKey: "proteus.anim.opacity")
        }
        CATransaction.commit()
        return true
    }

    /// **撤销平台动画**（回落 model 值）——相位间清理 / 节点复用时调用
    func removePlatformAnimations(_ ids: [Int]) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let keys = ["proteus.anim.transform", "proteus.anim.opacity"]
        for id in ids {
            guard let layer = layersById[id] else { continue }
            for k in keys { layer.removeAnimation(forKey: k) }
        }
        CATransaction.commit()
    }

    /// ★**层级提升 / 复位**（`zPosition`）：把若干层抬到同层序最前（或复位到 0）
    ///
    /// 【为什么需要（共享元素的必需配套）】飞行元素会越过容器边界压过中间内容；
    ///   CALayer 绘制顺序由 sublayer 顺序决定 ⇒ 需临时抬 `zPosition`。
    ///   ★`zPosition` 是**持久状态**：调用方必须在飞行结束后复位（否则后续相位里该层一直压着兄弟）。
    /// - Returns: 实际设置成功的层数
    @discardableResult
    func setLayerZ(ids: [Int], z: Float) -> Int {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        var n = 0
        for id in ids {
            guard let layer = layersById[id] else { continue }
            layer.zPosition = CGFloat(z)
            n += 1
        }
        CATransaction.commit()
        return n
    }

    /// 读层的 `zPosition`（判据用：证明飞行元素**真的**在别人之上）
    func layerZProbe(_ idsJson: String) -> String {
        guard let data = idsJson.data(using: .utf8),
              let ids = (try? JSONSerialization.jsonObject(with: data)) as? [Int] else {
            return "{\"ok\":false,\"error\":\"入参需为 id 数组 JSON\"}"
        }
        var parts: [String] = []
        for id in ids {
            guard let layer = layersById[id] else {
                parts.append("{\"id\":\(id),\"missing\":true}")
                continue
            }
            parts.append("{\"id\":\(id),\"z\":\(Double(layer.zPosition))}")
        }
        return "{\"ok\":true,\"layers\":[\(parts.joined(separator: ","))]}" 
    }

    /// ★★**RT2：把内核算出的变换写到层上**（translate/scale 是绘制层变换——不改几何、不触发布局）
    ///
    /// 【为什么必须显式应用（本仓纪律：静默不更新是最危险的失效模式）】内核改 `style.translate_*`
    ///   只是内核状态；`CALayer.transform` 不会自己变。不应用 ⇒ **屏幕完全不动**
    ///   （几何/日志/单测全对，只有肉眼能发现）——与 `text_updates`（V6 教训）同源的第二例。
    ///
    /// 实现：`CATransform3D` 以**层中心**为锚点做缩放（等价 CSS `transform: scale()` 默认 origin=center）。
    @discardableResult
    /// ★批次 39：解析节点样式里的**静态变换** `{"txPx","tyPx","sx","rotate","txPct","tyPct"}`（编译期 CSS transform）。
    ///   返回 nil ⇔ 无 transform / 单位变换（不应用）。缩放取 sx（编译器已保证 sx===sy）。
    static func staticTransform(style: [String: Any]) -> (txPx: Double, tyPx: Double, scale: Double, rotate: Double, txPct: Double, tyPct: Double)? {
        guard let t = style["transform"] as? [String: Any] else { return nil }
        func num(_ k: String, _ d: Double) -> Double { (t[k] as? NSNumber)?.doubleValue ?? d }
        let txPx = num("txPx", 0), tyPx = num("tyPx", 0), txPct = num("txPct", 0), tyPct = num("tyPct", 0)
        let scale = num("sx", 1), rotate = num("rotate", 0)
        if txPx == 0 && tyPx == 0 && txPct == 0 && tyPct == 0 && scale == 1 && rotate == 0 { return nil }
        return (txPx, tyPx, scale, rotate, txPct, tyPct)
    }

    func applyTransform(
        nodeId: Int, tx: CGFloat, ty: CGFloat, scale: CGFloat,
        rotate: CGFloat = 0, rotateX: CGFloat = 0, rotateY: CGFloat = 0,
        // ★★skew v1（2026-10-01）：倾斜（度；`x' = x + tan(skewX)·y`——CSS skewX 同式）
        skewX: CGFloat = 0, skewY: CGFloat = 0,
        opacity: CGFloat = 1,
        rgba: UInt32? = nil, textRgba: UInt32? = nil,
        // ★★C1：裁剪参数（16 槽；nil = 本节点无裁剪声明 —— 不做任何遮罩操作）
        clipParams: [Float]? = nil,
        // ★★C2：描边进度（nil = 本节点无描边路径 —— 不动）
        strokeProgress: Float? = nil
    ) -> Bool {
        guard let layer = layersById[nodeId] else { return false }
        // ★RT2 扩展：位移 + 缩放 + 旋转（**以层中心为锚点**——等价 CSS transform 默认 origin）
        // ★B 批 3D（2026-10-01）：rotateX/rotateY 与 Z 旋转同栈、同锚点；透视来自节点
        //   `perspective`（建层时快照在 `layerPerspective`——见 makeLayer）。
        var t = CATransform3DTranslate(CATransform3DIdentity, tx, ty, 0)
        let b = layer.bounds
        if scale != 1.0 || rotate != 0 || rotateX != 0 || rotateY != 0 || skewX != 0 || skewY != 0 {
            // ★★变换原点（transform-origin v1）：旋转/缩放/倾斜/3D **全部**绕它——
            //   缺省 (0.5, 0.5) = 层中心（既有行为零变化）；放底部（0.5, 1.0）= "从根部弯折"。
            //   ★为什么在宿主解：宿主是**执行变换的那一端**（内核只透传语义——它不算矩阵）。
            //   ★快照在 `layerTransformOrigin`（建层时从树样式读一次——与 perspective 同一形态）。
            let org = layerTransformOrigin[nodeId] ?? CGPoint(x: 0.5, y: 0.5)
            let px = b.width * org.x
            let py = b.height * org.y
            t = CATransform3DTranslate(t, px, py, 0)
            if rotate != 0 {
                t = CATransform3DRotate(t, rotate * .pi / 180, 0, 0, 1) // 度 → 弧度
            }
            // ★3D 轴（度 → 弧度）。顺序与 CSS transform 列表一致（X → Y → Z 逐轴叠加）。
            if rotateX != 0 {
                t = CATransform3DRotate(t, rotateX * .pi / 180, 1, 0, 0)
            }
            if rotateY != 0 {
                t = CATransform3DRotate(t, rotateY * .pi / 180, 0, 1, 0)
            }
            // ★★倾斜（skew v1）：CGAffineTransform 的 shear 语义（`x' = x + tan·y`）——
            //   CATransform3D 没有现成 skew ⇒ 自组 shear 矩阵（m21 = tan(skewX) / m12 = tan(skewY)）。
            //   ★与 Android `Canvas.skew(tan(sx), tan(sy))` **同式**（跨端一致的依据：数学同式）。
            if skewX != 0 || skewY != 0 {
                var sh = CATransform3DIdentity
                if skewX != 0 {
                    sh.m21 = tan(skewX * .pi / 180)
                }
                if skewY != 0 {
                    sh.m12 = tan(skewY * .pi / 180)
                }
                t = CATransform3DConcat(t, sh)
            }
            if scale != 1.0 {
                t = CATransform3DScale(t, scale, scale, 1)
            }
            t = CATransform3DTranslate(t, -px, -py, 0)
            // ★透视（CSS `perspective(d)` 语义：m34 = -1/d；只有带透视的层才不是正交投影）
            if let d = layerPerspective[nodeId], rotateX != 0 || rotateY != 0 {
                t.m34 = -1.0 / d
            }
        }
        layer.transform = t
        // ★opacity 只在非 1 时设（避免对无谓层写属性；且 1 是 CALayer 缺省）
        if opacity != 1 {
            layer.opacity = Float(opacity)
        }
        // ★★颜色（2026-10-01）：`nil` = 该节点无内核基色 ⇒ **保持本层静态绘制**（不动）
        if let packed = rgba {
            layer.backgroundColor = Self.cgColorFromPacked(packed)
        }
        // ★★文字色（2026-10-01）：落到 CATextLayer 的 `foregroundColor`
        //   （与底色两条独立轨道——同一条记录里各占一个 u32）
        if let packed = textRgba, let tl = layer as? CATextLayer {
            tl.foregroundColor = Self.cgColorFromPacked(packed)
        }
        // ★★C1：裁剪形变（每帧参数原子更新——遮罩走 CAShapeLayer，见 applyClip 注释）
        if let cp = clipParams {
            applyClip(nodeId: nodeId, layer: layer, params: cp)
        }
        // ★★C2：描边进度（`strokeEnd` 0..1——路径本体建层时定死，此处只改进度）
        if let sp = strokeProgress, let shape = layerStrokeShapes[nodeId] {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            // ★clamp 到 0..1（内核已 clamp；此处兜底防御——Swift 不能在函数内声明类型扩展）
            shape.strokeEnd = CGFloat(Swift.max(0, Swift.min(1, sp)))
            CATransaction.commit()
        }
        return true
    }

    /// ★★**全量挂载后：按内核返回的段列表补建 SVG 描边子层**（C2，2026-10-01）
    ///
    /// 【为什么必须在"挂载后"（本仓设计缺口的修复）】段列表由内核解析（单一实现）⇒
    ///   宿主建层时**没有**它（请求树只有 `d`）。⇒ 流程：内核收到树 → `svgNodes()` 查询
    ///   回带段列表 → 宿主据此建 `CAShapeLayer`。★与"度量先注入再建树"同款顺序纪律。
    func attachSvgStroke(fromKernelPaths json: String) {
        guard let data = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            NSLog("[proteus] attachSvgStroke: JSON 解析失败（%d 字节）", json.count)
            return
        }
        guard let paths = o["paths"] as? [String: [String: Any]] else {
            NSLog("[proteus] attachSvgStroke: paths 形态不符（raw=%d 字节）", json.count)
            return
        }
        SvgDiag.attachStats += paths.count
        NSLog("[proteus] attachSvgStroke: 收到 %d 个 SVG 路径", paths.count)
        for (idS, info) in paths {
            // ★分段诊断（真机接通排查用）：三个 continue 各自归因，不静默跳过
            guard let id = Int(idS) else {
                SvgDiag.skipNoId += 1
                continue
            }
            guard let layer = layersById[id] else {
                SvgDiag.skipNoLayer += 1
                continue
            }
            guard let segs = info["segs"] as? [Any] else {
                SvgDiag.skipNoSegs += 1
                continue
            }
            if layerStrokeShapes[id] != nil { continue } // 已建（幂等——全量重建时先清理）
            SvgDiag.built += 1
            let packed = (info["strokeColor"] as? NSNumber)?.uint32Value ?? 0xFFFFFFFF
            let strokeColor = Self.cgColorFromPacked(packed)
            let sw = CGFloat((info["strokeWidth"] as? Double) ?? 2)
            let shape = CAShapeLayer()
            shape.path = self.cgPathFromSegs(segs)
            shape.strokeColor = strokeColor
            shape.fillColor = nil
            shape.lineWidth = sw
            shape.lineCap = .round
            shape.lineJoin = .round
            // ★基态 = **声明的** `svgPath.progress`（缺省 0 = 未画；浏览模式 1 = 已画成）
            let pbase = Float((info["progressBase"] as? Double) ?? 0)
            shape.strokeEnd = CGFloat(Swift.max(0, Swift.min(1, pbase)))
            layerStrokeBase[id] = pbase
            shape.contentsScale = UIScreen.main.scale
            layer.addSublayer(shape)
            layerStrokeShapes[id] = shape
        }
    }

    /**
     * ★★**渐变规格 → CAGradientLayer**（2026-10-01 · 渐变 v1）——与 TS/Kotlin **同式**：
     *   · 线性：`angle`（CSS 语义）→ 端点 = 盒中心 ± 半程方向向量（单位空间，再乘 bounds）；
     *   · 径向：`cx/cy/r`（单位空间）→ `type = .radial`，`startPoint = 圆心`，
     *     `endPoint = 圆上一点`（`x + r` 方向——CoreAnimation 用 start→end 的距离作半径，
     *     故 endPoint 取 `(cx + r, cy)`）。
     *   · 色标：`colors`（CGColor 数组）+ `locations`（0..1 数组）。
     *
     * @returns 是否成功应用（false = 规格非法/零点 ⇒ 不挂层；★不静默挂一个空渐变）
     */
    /** ★★★背景定位家族（2026-10-07）：背景**图像盒**（相对元素 bounds）——nil = 未声明（恒填满）。
     *   size：长度/百分比/auto（1–2 值；%=相对盒）；position：关键字/长度/百分比（%= pct×(盒−图)，★减图尺寸）。
     *    与 Android `GradSpec.imageBox` / Web 几何同式。 */
    static func bgImageFrame(size: String?, pos: String?, bounds: CGRect) -> CGRect? {
        guard size != nil || pos != nil else { return nil }
        var iw = bounds.width, ih = bounds.height
        if let sz = size {
            let st = sz.split(separator: " ").map(String.init)
            if st.count >= 1 { iw = bgLen(st[0], base: bounds.width, auto: bounds.width) }
            if st.count >= 2 { ih = bgLen(st[1], base: bounds.height, auto: bounds.height) }
        }
        if !(iw > 0) { iw = bounds.width }
        if !(ih > 0) { ih = bounds.height }
        var ix: CGFloat = 0, iy: CGFloat = 0
        if let ps = pos {
            let pt = ps.split(separator: " ").map(String.init)
            if pt.count == 1 {
                if pt[0] == "top" || pt[0] == "bottom" { ix = bgPos1("center", box: bounds.width, img: iw); iy = bgPos1(pt[0], box: bounds.height, img: ih) }
                else { ix = bgPos1(pt[0], box: bounds.width, img: iw); iy = bgPos1("center", box: bounds.height, img: ih) }
            } else if pt.count >= 2 {
                ix = bgPos1(pt[0], box: bounds.width, img: iw); iy = bgPos1(pt[1], box: bounds.height, img: ih)
            }
        }
        return CGRect(x: bounds.minX + ix, y: bounds.minY + iy, width: iw, height: ih)
    }
    private static func bgLen(_ t: String, base: CGFloat, auto: CGFloat) -> CGFloat {
        if t == "auto" { return auto }
        if t.hasSuffix("%") { return (CGFloat(Double(t.dropLast()) ?? 0) / 100) * base }
        if t.hasSuffix("px") { return CGFloat(Double(t.dropLast(2)) ?? 0) }
        return CGFloat(Double(t) ?? 0)
    }
    private static func bgPos1(_ t: String, box: CGFloat, img: CGFloat) -> CGFloat {
        if t == "left" || t == "top" { return 0 }
        if t == "right" || t == "bottom" { return box - img }
        if t == "center" { return (box - img) / 2 }
        if t.hasSuffix("%") { return (CGFloat(Double(t.dropLast()) ?? 0) / 100) * (box - img) }
        if t.hasSuffix("px") { return CGFloat(Double(t.dropLast(2)) ?? 0) }
        return CGFloat(Double(t) ?? 0)
    }

    @discardableResult
    /// ★★★线性渐变端点（CSS 规范式 · 2026-10-08 修）：**渐变线长度 = |W·sinθ| + |H·cosθ|**
    ///   （从起始角到结束角的投影跨度）。旧式 `hypot(W·sinθ,H·cosθ)` 只在 0/90/180/270 与 CSS 一致——
    ///   对角角度下渐变线偏短 ⇒ 色带偏粗（45° 正方砖实色占比 0.42 vs CSS 0.25，用户实测「案例 C 与 Web 有差异」）。
    ///   ★与 TS `linearGradientEndpoints(angle, w, h)` / Android / 鸿蒙 **同式**（一处语义多处实现，须同改）。
    ///   ★单位空间（0..1 归一）——CAGradientLayer 的 startPoint/endPoint 语义；调用方传**像素或逻辑尺寸均可**（比值不变）。
    static func linearEndpoints(angleDeg: Double, width: Double, height: Double)
      -> (x0: CGFloat, y0: CGFloat, x1: CGFloat, y1: CGFloat) {
        let rad = angleDeg * .pi / 180
        let s = sin(rad), c = cos(rad)
        let w = width > 0 ? width : 1
        let h = height > 0 ? height : 1
        let L = abs(w * s) + abs(h * c)
        return (CGFloat(0.5 - (L / (2 * w)) * s), CGFloat(0.5 + (L / (2 * h)) * c),
                CGFloat(0.5 + (L / (2 * w)) * s), CGFloat(0.5 - (L / (2 * h)) * c))
    }

    static func applyGradient(_ layer: CAGradientLayer, spec: [String: Any], bounds: CGRect) -> Bool {
        guard let kind = spec["kind"] as? String,
              let stops = spec["stops"] as? [[String: Any]], stops.count >= 2 else { return false }
        var colors: [CGColor] = []
        var locations: [NSNumber] = []
        for st in stops {
            guard let off = (st["offset"] as? Double) ?? (st["offset"] as? CGFloat).map(Double.init),
                  let hex = st["color"] as? String else { return false }
            let alpha = (st["alpha"] as? Double) ?? (st["alpha"] as? CGFloat).map(Double.init) ?? 1.0
            guard let base = parseHexColor(hex) else { return false }
            guard let c = base.withAlphaComponent(CGFloat(max(0, min(1, alpha)))).cgColor as CGColor? else { return false }
            colors.append(c)
            locations.append(NSNumber(value: off))
        }
        layer.colors = colors
        layer.locations = locations
        if kind == "linear" {
            guard let angle = (spec["angle"] as? Double) ?? (spec["angle"] as? CGFloat).map(Double.init) else { return false }
            // ★单位空间端点 = CSS 规范式（见 linearEndpoints；bounds 供宽高比——正方时 45°=角到角）
            let ep = Self.linearEndpoints(angleDeg: angle, width: Double(bounds.width), height: Double(bounds.height))
            layer.startPoint = CGPoint(x: ep.x0, y: ep.y0)
            layer.endPoint = CGPoint(x: ep.x1, y: ep.y1)
            layer.type = .axial
        } else if kind == "radial" {
            let cx = (spec["cx"] as? Double) ?? (spec["cx"] as? CGFloat).map(Double.init) ?? 0.5
            let cy = (spec["cy"] as? Double) ?? (spec["cy"] as? CGFloat).map(Double.init) ?? 0.5
            let r = (spec["r"] as? Double) ?? (spec["r"] as? CGFloat).map(Double.init) ?? 1.0
            guard r > 0 else { return false }
            layer.type = .radial
            layer.startPoint = CGPoint(x: cx, y: cy)
            // CoreAnimation 径向：半径 = |end - start| ⇒ 取 (cx + r, cy) 与 TS/Kotlin 的"r 相对盒宽"对齐
            layer.endPoint = CGPoint(x: cx + r, y: cy)
        } else {
            return false
        }
        return true
    }

    /// ★★**段列表 → CGPath**（C2，2026-10-01）——**只做翻译**（解析在内核，见 `svg_path` 模块）
    ///
    /// ★★段形态 = **内核 `PathSeg` 的 serde 序列化形态**（2026-10-01 · C2 真机接通时修正）：
    ///   `{"MoveTo":[x,y]}` / `{"LineTo":[x,y]}` / `{"CubicTo":[x1,y1,x2,y2,x,y]}` /
    ///   `{"QuadTo":[x1,y1,x,y]}` / `"Close"`（单位串）。
    ///   ★首版按 `{"t":"M","v":[…]}` 写（**臆想的形态**）⇒ 真机 strokeEnd=-1（层根本没建）
    ///     而内核侧读数全对——两端各写一份"形态假设"正是本仓纪律 #22 警告的形态。
    ///   ⇒ 期望值以内核 `svg_dump2` 实测输出为准（见 `scripts/check-svg-path-shape.mjs` 门禁）。
    func cgPathFromSegs(_ segs: [Any]) -> CGPath {
        let p = CGMutablePath()
        for item in segs {
            if let s2 = item as? String, s2 == "Close" {
                p.closeSubpath()
                continue
            }
            guard let seg = item as? [String: Any] else { continue }
            for (k, vAny) in seg {
                let v = (vAny as? [Double]) ?? []
                switch k {
                case "MoveTo":
                    if v.count >= 2 { p.move(to: CGPoint(x: v[0], y: v[1])) }
                case "LineTo":
                    if v.count >= 2 { p.addLine(to: CGPoint(x: v[0], y: v[1])) }
                case "CubicTo":
                    if v.count >= 6 {
                        p.addCurve(to: CGPoint(x: v[4], y: v[5]),
                                   control1: CGPoint(x: v[0], y: v[1]),
                                   control2: CGPoint(x: v[2], y: v[3]))
                    }
                case "QuadTo":
                    if v.count >= 4 {
                        p.addQuadCurve(to: CGPoint(x: v[2], y: v[3]), control: CGPoint(x: v[0], y: v[1]))
                    }
                default:
                    break
                }
            }
        }
        return p
    }

    /// ★★**应用裁剪形状**（C1，2026-10-01）——`CAShapeLayer` 作 `mask`（iOS 的裁剪原语）
    ///
    /// 【为什么用 mask 而不是 `layer.mask(toBounds:)`】后者只支持矩形；形状裁剪必须用
    ///   `CAShapeLayer` 的 `path` 作 `mask`（CoreAnimation 通用做法，路径任意）。
    /// 【性能】遮罩层**复用**（首次建、之后只改 `path`）——每帧只重建贝塞尔路径
    ///   （与 Android `canvas.clipPath` 的重建成本同量级：几十个点到 Path 的构建）。
    /// 【坐标系】参数是**盒分数** ⇒ 用 `layer.bounds`（局部坐标）换算成 px。
    /// ★★**每帧渐变更新**（渐变 v2 · 2026-10-01）——把内核**已混合**的色标写进 `CAGradientLayer`。
    ///   ★只更新已存在的层（静态声明时建；没有 ⇒ 忽略——内核不会再拒绝过"无渐变节点"的混合动画）。
    ///   ★`CATransaction` 已在调用方（`animTickApply`）的批量事务里——此处不再自建。
    func applyGradientTick(nodeId: Int, colors: [CGColor], locations: [NSNumber],
                           kind: Int, angle: Float, cx: Float, cy: Float, r: Float) {
        guard let g = layerGradients[nodeId] else { return }
        g.colors = colors
        g.locations = locations
        // ★★几何（渐变 v2 扩展——"光本身在动"）：与建树时的 `applyGradient` **同式**
        //   （线性：端点 = 中心 ± 半程方向；径向：半径 = r（start→end 距离））
        if kind == 1 {
            // ★与建树同式（CSS 规范式；节点盒尺寸 = 渐变层的 bounds）
            let ep = Self.linearEndpoints(angleDeg: Double(angle), width: Double(g.bounds.width), height: Double(g.bounds.height))
            g.startPoint = CGPoint(x: ep.x0, y: ep.y0)
            g.endPoint = CGPoint(x: ep.x1, y: ep.y1)
        } else if kind == 2, r > 0 {
            g.startPoint = CGPoint(x: CGFloat(cx), y: CGFloat(cy))
            g.endPoint = CGPoint(x: CGFloat(cx) + CGFloat(r), y: CGFloat(cy))
        }
    }

    /// ★★**接收内核已变形、已翻译的 CGPath**（路径变形 v1/v2）——**只设 path**
    ///   （查内核 + 二进制解析在桥类：本类没有 tree handle）。
    ///   ★v2 起直接收 `CGPath`（二进制通道的宿主侧一步到位——不再过 `cgPathFromSegs`）。
    func setMorphedPathDirect(nodeId: Int, path: CGPath) {
        guard let shape = layerStrokeShapes[nodeId] else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        shape.path = path
        CATransaction.commit()
    }

    /// ★★**每帧发光强度**（glow v1）——按 `"intensity"` 乘子重算每层 alpha（同式：a0×intensity×(1-t)²）。
    ///   契约键名（与 TS `GRADIENT_CONTRACT_KEYS` 同表）：`"glow"` / `"radius"` / `"alpha"` / `"intensity"`。
    ///   ★只改 alpha（不重建层）——与 `applyGradientTick` 同一形态。
    func applyGlowTick(nodeId: Int, intensity: Float) {
        guard let shapes = layerGlowShapes[nodeId], let spec = layerGlowSpec[nodeId] else { return }
        let n = shapes.count
        let a0 = spec.alpha * CGFloat(intensity) // 声明 alpha × 当前强度（**从快照算**——不累积）
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for (i, sh) in shapes.enumerated() {
            let t = CGFloat(i) / CGFloat(n)
            let declA = max(0, min(1, a0 * (1 - t) * (1 - t)))
            sh.strokeColor = spec.color.withAlphaComponent(declA).cgColor
        }
        CATransaction.commit()
    }

    private func applyClip(nodeId: Int, layer: CALayer, params: [Float]) {
        guard let shape = layerClipShape[nodeId] else { return } // 无声明 ⇒ 不裁剪（内核也会拒）
        let b = layer.bounds
        let w = b.width
        let h = b.height
        // ★opacity=0 或尺寸为 0 的退化情形：不建遮罩（避免除零与无效路径）
        guard w > 0, h > 0 else { return }
        let path = CGMutablePath()
        switch shape.kind {
        case 1: // inset(top, right, bottom, left)——盒分数，可负（外扩）
            let top = CGFloat(params.count > 0 ? params[0] : 0) * h
            let right = CGFloat(params.count > 1 ? params[1] : 0) * w
            let bottom = CGFloat(params.count > 2 ? params[2] : 0) * h
            let left = CGFloat(params.count > 3 ? params[3] : 0) * w
            path.addRect(CGRect(x: left, y: top, width: max(0, w - left - right), height: max(0, h - top - bottom)))
        case 2: // circle(cx, cy, r)——r 相对 min(w,h)（圆在非方形盒里仍是圆）
            let cx = CGFloat(params.count > 0 ? params[0] : 0.5) * w
            let cy = CGFloat(params.count > 1 ? params[1] : 0.5) * h
            let r = CGFloat(params.count > 2 ? params[2] : 0.5) * min(w, h)
            path.addEllipse(in: CGRect(x: cx - r, y: cy - r, width: 2 * r, height: 2 * r))
        default: // polygon(pairs) —— 顶点按盒分数换算；至少 3 点
            let n = min(params.count / 2, 8)
            guard n >= 3 else { break }
            path.move(to: CGPoint(x: CGFloat(params[0]) * w, y: CGFloat(params[1]) * h))
            for i in 1..<n {
                path.addLine(to: CGPoint(x: CGFloat(params[2 * i]) * w, y: CGFloat(params[2 * i + 1]) * h))
            }
            path.closeSubpath()
        }
        let mask: CAShapeLayer
        if let m = layerClipMasks[nodeId] {
            mask = m
        } else {
            mask = CAShapeLayer()
            layerClipMasks[nodeId] = mask
            // ★在隐式动画关闭的前提下挂 mask（与 applyTransform 同一纪律：每帧显式赋值）
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layer.mask = mask
            CATransaction.commit()
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true) // ★不做隐式动画（每帧显式设）——见 applyTransform
        mask.path = path
        CATransaction.commit()
    }

    /// 打包色 `0xAARRGGBB` → `CGColor`（颜色动画的落点；与内核 `LStyle.bg` 同编码）
    ///
    /// 【为什么不用 `parseHexColor`（那是对字符串的）】内核通道以 **u32** 下发（每帧二进制），
    ///   再转成字符串解析一遍纯属白付（本仓每帧通道的纪律：不做可避免的编解码）。
    /// ★访问级别：internal（`SelfDrawBridge` 的每帧渐变段解析要用它——同文件跨类型）
    static func cgColorFromPacked(_ v: UInt32) -> CGColor {
        CGColor(
            red: CGFloat((v >> 16) & 0xFF) / 255.0,
            green: CGFloat((v >> 8) & 0xFF) / 255.0,
            blue: CGFloat(v & 0xFF) / 255.0,
            alpha: CGFloat((v >> 24) & 0xFF) / 255.0
        )
    }

    /// `CGColor` → 打包色 `0xAARRGGBB`（探针用：**真读层**，把值报给判据）
    ///
    /// ★取不到分量（颜色空间非 RGB / `nil`）⇒ 返回 `""`（空串）——判据据此判"读不到"，
    ///   而不是伪装成某个颜色（本仓纪律：判据要能区分"没做"与"做了值为 0"）。
    private static func packedHexFromCGColor(_ c: CGColor?) -> String {
        guard let c, let comps = c.components, comps.count >= 3 else { return "" }
        // I2-ALLOW: 颜色通道量化（0..1 浮点 → 0..255 整数）——不是几何舍入；
        //   CGColor 分量天然是归一化浮点，进位到 8 位色深的最近整数是**格式定义**（探针报色用），
        //   与卡 I2（几何坐标吸附只在内核发生）无关。
        let r = UInt32((comps[0] * 255).rounded())
        // I2-ALLOW: 同上（颜色通道量化，非几何）
        let g = UInt32((comps[1] * 255).rounded())
        // I2-ALLOW: 同上（颜色通道量化，非几何）
        let b = UInt32((comps[2] * 255).rounded())
        // I2-ALLOW: 同上（alpha 通道量化，非几何）
        let a = comps.count >= 4 ? UInt32((comps[3] * 255).rounded()) : 255
        return String(format: "%08X", (a << 24) | (r << 16) | (g << 8) | b)
    }

    /// ★★**摘除子树**（递归清理层与全部 id 簿记）
    ///
    /// 【为什么必须递归清理（本仓纪律：不留下"半死"状态）】层树与簿记表是**同一事实的两份视图**
    ///   （见 `childrenById` 注释）。若只 `removeFromSuperlayer` 而不清表：
    ///   ① 后续更新会命中"存在但已不可见"的层（几何改了却看不见 ⇒ 静默错）；
    ///   ② `pendingOffscreen` 里的旧账会在滚动时把孤层刷回来；
    ///   ③ `layerNodes.count` 成为虚数（内存读数与层数读数失真）。
    ///   ⇒ 一次性把该子树在**所有**表里清干净。
    func removeLayersSubtree(rootId: Int) {
        // ★父 id **先取**：下面的循环会把它从表里清掉（顺序错了就摘不出父子链）
        let pid0 = builtParents[rootId] ?? parentById[rootId] ?? -1
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        var stack = [rootId]
        var removedLayers = 0
        var removedObjects = Set<ObjectIdentifier>()
        while let id = stack.popLast() {
            for c in childrenById[id] ?? [] { stack.append(c) }
            if let l = layersById[id] {
                l.removeFromSuperlayer()
                removedObjects.insert(ObjectIdentifier(l))
                removedLayers += 1
            }
            layersById.removeValue(forKey: id)
            depthById.removeValue(forKey: id)
            parentById.removeValue(forKey: id)
            childrenById.removeValue(forKey: id)
            builtFrames.removeValue(forKey: id)
            builtParents.removeValue(forKey: id)
            rectsByNodeId.removeValue(forKey: id)
            metaByNodeId.removeValue(forKey: id)
            absOriginByNodeId.removeValue(forKey: id)
            pendingOffscreen.removeValue(forKey: id)   // ★旧账一并作废
        }
        // ★从父的子列表里摘掉（否则父的 childrenById 永远指着死 id）
        if pid0 >= 0, var sibs = childrenById[pid0] {
            sibs.removeAll { $0 == rootId }
            childrenById[pid0] = sibs
        }
        // ★layerNodes 是清空/计数用的扁平列表——必须同步（否则 clearLayers 漏摘、计数失真）
        layerNodes.removeAll { removedObjects.contains(ObjectIdentifier($0)) }
        builtLayerCount = layerNodes.count
        lastSpliceRemoved += removedLayers
        CATransaction.commit()
    }

    /// ★★**插入子树**（按 `(parentId, index=末尾)` 落点建层；节点**父在前**）
    ///
    /// 【输入从哪来】splice 响应里的 `inserts` 明细（JS 侧 `takeSplice()` 产出）——
    ///   含新节点的**完整样式**（tag/style/text），与全量树的规格同源（`fillSpec` 单实现）。
    ///
    /// 【为什么不在这里设 frame】新节点的几何在**同一批**的 rects 里返回；
    ///   由调用方随后走 `updateLayersIncremental`（按父链深度排序 ⇒ 父原点先算好）统一设帧。
    ///   在此设帧会用到**尚未更新**的父原点（顺序错误 ⇒ 几何错，本仓已踩过坐标系双重偏移）。
    func insertLayers(_ inserts: [[String: Any]]) -> Int {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        var created = 0
        lastInsertedIds.removeAll(keepingCapacity: true)
        for ins in inserts {
            guard let parentId = ins["parentId"] as? Int,
                  let nodes = ins["nodes"] as? [[String: Any]] else { continue }
            // ★★**插入位置**（2026-09-28：splice 支持中间插入）
            //
            // 【为什么必须有】CALayer 的 `addSublayer` **恒为追加**（层序 = 绘制顺序）
            //   ⇒ 中间插入若不按 index 放，**层序与核心的 children 序不一致**
            //   ⇒ 后续 z-order/重叠绘制与命中测试都会与核心不符（且几何断言发现不了）。
            //   做法：把块根按 index 依次 `insertSublayer(at:)`，并把 id 插进 `childrenById`
            //   的同一位置（两份表示保持一致——本仓纪律）。
            let insertAt = (ins["index"] as? Int) ?? -1
            // ★块根的落点位（逐块递增：同一块里若有多棵子树，它们**依次**插在 index 之后）
            var rootSlot = insertAt
            for n in nodes {
                guard let id = n["id"] as? Int else { continue }
                // 该节点在块内的父（缺省/非块内 ⇒ 落点父）
                let rawPid = n["parentId"] as? Int
                let isBlockRoot = !(rawPid != nil && layersById[rawPid!] != nil)
                let pid = isBlockRoot ? parentId : rawPid!
                let parentLayer: CALayer = layersById[pid] ?? self.layer
                let style = spliceStyleOf(n)
                let layer = makeLayer(style: style, nodeId: id, boxWidth: nodeRects[id]?.width ?? 0)
                if isBlockRoot && rootSlot >= 0 {
                    // ★★块根按 `index` 插（层序 = 绘制顺序 = 核心 children 序）
                    //
                    // 【为什么不能一律 append（本仓实测）】`addSublayer` 恒为追加
                    //   ⇒ 中间插入会让**层序与核心的 children 序不一致** ⇒ 重叠绘制/z-order
                    //     与命中测试与核心不符（几何断言发现不了，属静默错显示）。
                    //   ⇒ 用 `insertSublayer(at:)` 按落点插，并把 id 插进 `childrenById` 同位（两份表示一致）。
                    let sibs = childrenById[pid] ?? []
                    let at = min(max(rootSlot, 0), sibs.count)
                    let before: CALayer? = at < sibs.count ? layersById[sibs[at]] : nil
                    if let b = before {
                        parentLayer.insertSublayer(layer, below: b)
                    } else {
                        parentLayer.addSublayer(layer)
                    }
                    childrenById[pid, default: []].insert(id, at: at)
                    rootSlot += 1
                } else {
                    parentLayer.addSublayer(layer)
                    childrenById[pid, default: []].append(id)
                }
                layersById[id] = layer
                parentById[id] = pid
                depthById[id] = (depthById[pid] ?? 0) + 1
                metaByNodeId[id] = style
                layerNodes.append(layer)
                lastInsertedIds.append(id)
                created += 1
            }
        }
        builtLayerCount = layerNodes.count
        lastSpliceInserted += created
        CATransaction.commit()
        return created
    }

    /// 从 splice 的节点描述符里取**绘制字段**
    ///
    /// ★本方法是 `SelfDrawView.styleOf` 的**转发**（本仓纪律：同一语义一处实现）——
    ///   两份实现必然分叉，且分叉表现为"增量插入的行与全量重建的行外观不一致"（静默错，只有像素比对能发现）。
    private func spliceStyleOf(_ n: [String: Any]) -> [String: Any] {
        SelfDrawView.styleOf(n)
    }

    /// ★★最近一次 splice 的层维护读数（诊断 + 判据："层真的被增删了"）
    private(set) var lastSpliceRemoved = 0
    private(set) var lastSpliceInserted = 0
    /// ★最近一次 splice 插入的节点 id（供"插入文本的度量是否真的生效"自检）
    private(set) var lastInsertedIds: [Int] = []
    func resetSpliceCounters() { lastSpliceRemoved = 0; lastSpliceInserted = 0; lastInsertedIds.removeAll() }

    /// ★★**插入文本的度量自检**（设备侧不变量）
    ///
    /// 【为什么必须有（本仓实测的静默错几何缺陷）】核心的重排引擎曾用 `NullTextMeasurer`
    ///   ⇒ 范围内文本被塌成 0 高（**首帧正确、更新后错**，静态用例发现不了）。
    ///   修法（度量表随句柄持久化 + splice 带 textMeasures）已在 Rust 单测覆盖，
    ///   但**宿主这条注入路径**（`fontSize ?? 14` 就地度量 → 塞进请求）此前**无任何判据**。
    ///
    /// 【★首版自检写错了（本仓实测的测量装置缺陷，被自检自身暴露）】首版只看 `layer.frame.height`：
    ///   而插入的行在**列表末尾（视口外）** ⇒ 200 个文本层全部走"延后记账"
    ///   （`visibleOnly=true` 下不可见层不设 frame）⇒ frame 仍是默认 0
    ///   ⇒ 报"200/200 零高"——**是测量口径的假象，不是度量失败**（差点误导我）。
    ///   ⇒ 正解：几何来源是**二者之一**——① 已应用 ⇒ `layer.frame`；
    ///     ② 未应用（视口外延后）⇒ `pendingOffscreen` 的记账 rect。
    ///     两者都没有 = 该节点**不在核心变化集里**（这才是真缺陷）⇒ 单列 `missing`。
    /// - Returns: (文本层数, 已知几何里高≈0 的条数, 无任何几何的条数)
    func insertedTextZeroHeight() -> (text: Int, zero: Int, missing: Int) {
        var text = 0
        var zero = 0
        var missing = 0
        for id in lastInsertedIds {
            guard let style = metaByNodeId[id],
                  let t = style["text"] as? String, !t.isEmpty else { continue }
            text += 1
            if let q = pendingOffscreen[id] {
                if q.height < 0.5 { zero += 1 }
            } else if let l = layersById[id] {
                if l.frame.height < 0.5 { zero += 1 }
            } else {
                missing += 1
            }
        }
        return (text, zero, missing)
    }

    /* ────────────────────────── ★V4：可见区判定 + 延迟更新簿记 ────────────────────────── */

    /// 内容滚动偏移（= 根层被移动了多少；滚动 = 移动内容，**视口固定**）
    ///
    /// 【★本仓实测的模型错误（滚动用例 FAIL 暴露的）】首版把「可见区」写成 `self.bounds`
    ///   并让 `scrollBy` 去平移 `self.bounds` —— 但层的坐标是**内容坐标**（绝对），
    ///   平移 bounds 会让「视口」和「内容」一起移动 ⇒ **永远判不出"滚入"** ⇒ 补刷恒为 0。
    ///   ⇒ 正确模型：**视口固定在屏幕 `[0,0,W,H]`**，滚动 = 移动**内容**（根层位置偏移）。
    ///   判可见性 = 「内容坐标 r」与「屏幕窗口 + 偏移」相交判定。
    private(set) var contentOffset = CGPoint.zero

    /// ★★重置滚动偏移（**建新树时必须调用**——本仓实测的测试间状态泄漏）
    ///
    /// 【故障链】`contentOffset` 是**视图属性**而非树属性 ⇒ 上一个用例滚动后，
    ///   下一个用例 `mount` 新树时偏移**仍在** ⇒ 采样/可见性判定都基于错误的视口位置。
    ///   实测症状：像素用例 mount 后采样点颜色全不对（因为屏幕显示的是「已上移 1200px」的内容），
    ///   而**几何断言全对** ⇒ 极易误判成"渲染 bug"。
    ///   ⇒ 纪律：**跨用例共享的视图状态，必须在新树建立时显式归零**。
    func resetContentOffset() {
        contentOffset = .zero
        self.layer.sublayerTransform = CATransform3DIdentity
    }

    /// 屏幕固定视口（可见区判定的基准）
    var visibleBounds: CGRect { CGRect(origin: .zero, size: self.bounds.size) }

    /// 应用滚动偏移：移动内容（根层的 sublayerTransform 平移），并记录偏移量
    ///
    /// - Returns: 新的内容偏移
    @discardableResult
    func applyContentOffset(dx: CGFloat, dy: CGFloat) -> CGPoint {
        contentOffset.x += dx
        contentOffset.y += dy
        // ★★垂直**范围钳制**（2026-10-02 —— 与 Android `scrollDragBy` 同源的修复）：
        //   「用户实测安卓内容页可一直上下滚」的 iOS 侧同缺陷（`applyContentOffset` 无界）。
        //   仅当场景**显式设置过**范围（`setVerticalScrollRange`，由内容高 − 视口高推导）时钳制；
        //   默认未设置 ⇒ 与改前逐位一致（既有 pan/滚动用例零影响）。
        if verticalRangeSet {
            let clamped = max(0, min(CGFloat(verticalRange), contentOffset.y))
            contentOffset.y = clamped
            // ★★★批次 48 修复（用户：「iOS 页面内容能一直拖着来回动」——一直存在的现象）：
            //   **横向 x 从不钳制** ⇒ 横拖可无限位移（内容跑出屏幕）。内容滚动模式下页面不横滚
            //   （与 Web `overflow-x` 同义）⇒ x 恒钳到 0。★门禁与 y 同源（`verticalRangeSet`）：
            //   未开内容滚动的既有场景（手卷 offsetScroll 等）保持"无界拖拽"（零行为变化）。
            contentOffset.x = 0
        }
        // ★用 sublayerTransform 平移（不动各层 frame ⇒ 不破坏「内容坐标」语义）
        var t = CATransform3DIdentity
        t.m41 = -contentOffset.x
        t.m42 = -contentOffset.y
        self.layer.sublayerTransform = t
        return contentOffset
    }

    /// ★★垂直滚动范围（物理/点；内容高 − 视口高）。由**场景**从内核几何推导后设置
    ///   （`nodeRects` 的最大 maxY − bounds 高）；未设置 ⇒ 不钳制（默认，保持既有行为）。
    private(set) var verticalRange = 0
    private(set) var verticalRangeSet = false

    func setVerticalScrollRange(_ range: Int) {
        verticalRange = max(0, range)
        verticalRangeSet = true
    }

    /// 视口外的待更新层（id → 目标绝对 rect）——滚入视野前必须刷上
    ///
    /// 【为什么不直接丢弃（正确性红线）】CALayer.frame 是**持久状态**：若因为「当前不可见」
    ///   就不更新，滚动到该位置时会显示**旧几何**（错位）。⇒ 必须**记账**，
    ///   在滚入视野前补刷（见 `flushPendingIfVisible`）。
    private var pendingOffscreen: [Int: CGRect] = [:]

    /// 本次更新里「因不可见被延迟」的层数（诊断；同时是正确性的可观测点）
    private(set) var lastDeferredCount = 0
    /// 本次更新里「补刷」的层数
    private(set) var lastFlushedCount = 0
    /// 当前待补刷（视口外延后）的层数
    var pendingCount: Int { pendingOffscreen.count }
    /// 本次更新里「因节点转为可见而作废的旧账」数（>0 说明确实发生过这条故障链的修复）
    private(set) var lastStalePendingCleared = 0
    /// 不变量自检：可见节点与待补刷表的重叠数（**必须恒为 0**）
    private(set) var lastPendingVisibleOverlap = 0

    /// ★★滚动/几何变化钩子：视图 bounds 变化时补刷「已滚入视野」的待更新层
    ///
    /// 【为什么必须有（正确性红线）】`updateLayersIncremental` 会把**不可见**层的更新
    ///   记进 `pendingOffscreen` 延后处理（见其注释）。若没有这个钩子，滚动后那些层
    ///   仍显示**旧几何**（错位）。⇒ 必须在此补刷。
    ///
    /// 【为什么放 layoutSubviews（而不是加 UIScrollView 代理）】本视图的自绘层树
    ///   **不依赖 UIScrollView**（滚动由 native-host 跟随 + 本视图 bounds 平移表达），
    ///   故 `layoutSubviews` 就是「可见区变了」的统一入口——一处实现覆盖全部触发源。
    override func layoutSubviews() {
        super.layoutSubviews()
        // ★只在有待更新项时才动（热路径：每次 layout 都遍历一遍会白花）
        if !pendingOffscreen.isEmpty {
            flushPendingIfVisible()
        }
    }

    /// 判断矩形是否与可见区相交（含少量余量：预取一屏，避免滚动时才补刷）
    private func intersectsVisible(_ r: CGRect) -> Bool {
        // ★把**内容坐标**矩形换算到**屏幕坐标**（减去内容偏移），再与固定视口相交判定
        let onScreen = r.offsetBy(dx: -contentOffset.x, dy: -contentOffset.y)
        // ★预取**半屏**（首版用了「上下各一屏」= 三屏高 ⇒ 803 节点的树几乎全算可见）
        //   ⇒ 优化形同失效，且滚动用例没有待补刷项可验证。半屏兼顾「滚动不抖」与「真剔除」。
        let vb = visibleBounds.insetBy(dx: 0, dy: -visibleBounds.height / 2)
        return vb.intersects(onScreen)
    }

    /// ★补刷：把当前已可见的待更新层应用掉（滚动前后调用）
    @discardableResult
    func flushPendingIfVisible() -> Int {
        guard !pendingOffscreen.isEmpty else { return 0 }
        var flushed = 0
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        let ready = pendingOffscreen.filter { intersectsVisible($0.value) }
        // ★★必须**按父链深度升序**补刷（本仓实测的隐患）
        //   `applyOneLayer` 用 `absOriginByNodeId[父]` 换算父相对坐标——若子先于父被刷，
        //   用的就是父的**旧原点** ⇒ frame 错位。
        //   字典遍历顺序不确定 ⇒ 必须显式排序（与 `updateLayersIncremental` 同一条纪律）。
        var depthCache: [Int: Int] = [:]
        for id in ready.keys where depthCache[id] == nil {
            depthCache[id] = depthOf(id)
        }
        for (id, abs) in ready.sorted(by: { (depthCache[$0.key] ?? 0) < (depthCache[$1.key] ?? 0) }) {
            pendingOffscreen.removeValue(forKey: id)
            applyOneLayer(id: id, abs: abs)
            flushed += 1
        }
        lastFlushedCount = flushed
        return flushed
    }

    /// ★★把**文本更新**落到层上（CATextLayer.string）
    ///
    /// 【为什么必须有（本仓实测的静默错显示缺陷）】增量路径此前只改 frame，
    ///   而文本内容在 `CATextLayer.string` 上 ⇒ 改文案后**核心几何已变、屏幕文字还是旧的**
    ///   （几何断言全绿，只有肉眼能发现）。Rust 侧现已回报 `text_updates`（见 ApplyOutcome）。
    func applyTextUpdates(_ updates: [String: Any]) -> Int {
        var applied = 0
        for (k, v) in updates {
            guard let id = Int(k), let text = v as? String, let layer = layersById[id] else { continue }
            if let tl = layer as? CATextLayer {
                // ★批次 20：按 meta 样式重建（声明字距时用带 kern 的富文本，避免纯文本清掉 kern）
                let m = metaByNodeId[id] ?? [:]
                let uf = ProteusTextAdapter.font(size: (m["fontSize"] as? CGFloat) ?? 14,
                                                 weight: (m["fontWeight"] as? CGFloat) ?? 400,
                                                 family: (m["fontFamily"] as? String) ?? "system")
                tl.string = textLayerString(text, style: m, font: uf, color: tl.foregroundColor ?? UIColor.white.cgColor)
                applied += 1
            }
            // 更新 meta（层 dump / 诊断读它）
            if var m = metaByNodeId[id] {
                m["text"] = text
                metaByNodeId[id] = m
            }
        }
        return applied
    }

    /// 应用单个层的 frame（供即时更新与补刷共用——★同一语义一处实现）
    private func applyOneLayer(id: Int, abs: CGRect) {
        guard let layer = layersById[id] else { return }
        let pid = parentById[id] ?? -1
        let parentOrigin = pid >= 0 ? (absOriginByNodeId[pid] ?? .zero) : .zero
        absOriginByNodeId[id] = abs.origin
        let f = CGRect(x: abs.minX - parentOrigin.x, y: abs.minY - parentOrigin.y,
                       width: abs.width, height: abs.height)
        // ★批次 13：文本层声明 lineHeight ⇒ 可视 frame 居中收缩（从 meta 取样式，与建层同源）
        layer.frame = metaByNodeId[id].map { lineBoxFrame(f, style: $0) } ?? f
        if let st = metaByNodeId[id] { applyRadiusPct(layer, style: st, size: f.size) }
        builtFrames[id] = layer.frame
        rectsByNodeId[id] = abs
    }

    /// ★★**增量更新层**：只改「核心报告变化的那些节点」的 frame（不重建、不销毁任何层）
    ///
    /// 【为什么这是关键优化（真机实测）】此前每次更新都 `clearLayers + buildLayers`：
    ///   3507 节点实测 **build_layers = 80.7ms**（占宿主总耗时的一半以上）。
    ///   而核心现在能返回**变化集**（`proteus_layout_update` 的 `rects` 字段，
    ///   实测只改 1 行时仅 41 个节点）⇒ 这里就只改这 41 个层的 frame。
    ///
    /// 【坐标系】核心给的是**绝对**rect；CALayer 的 frame 是**父相对** ⇒ 需减去父的绝对原点。
    ///   父的绝对原点从 `absOriginByNodeId` 取（该表在增量过程中被**就地更新**——
    ///   故必须按**树序（父在前）**处理：父的原点先更新完，子才能用对）。
    ///   核心返回的顺序是 JSON 对象（无序）⇒ 本函数按节点 id 排序不安全，
    ///   改为**按父链深度排序**（深度小的先处理）。
    ///
    /// - Returns: 实际更新的层数；有任何一个节点在本地找不到对应 layer 则返回 -1（调用方应退回全量重建）
    /// 最近一次层更新的**三段分解**（V4 下半：定位 `layers` 段残余）
    ///
    /// 【为什么必须拆（本仓实测）】原先只报一个 `layers_ms`，把三件不同的事混在一起：
    ///   · 排序/可见性过滤（纯 Swift 计算）
    ///   · `layer.frame = ...` 逐层赋值（含 CA 内部簿记）
    ///   · `CATransaction.commit()` —— **隐式布局与提交**（含 GPU 侧准备，异步部分不可测）
    ///   4003 个子层改 frame 时，第三段往往才是大头——不拆就永远查不到。
    private(set) var lastLayerTiming: [String: Double] = [:]

    func updateLayersIncremental(
        changed: [(id: Int, abs: CGRect)],
        /// ★V4：是否**只更新可见层**（不可见的记账延后）。false = 旧行为（全部更新），用于 A/B
        visibleOnly: Bool = true
    ) -> Int {
        lastLayerTiming = [:]
        guard !changed.isEmpty else { return 0 }
        // 逐节点检查是否都有对应的已有层；缺任何一个 ⇒ 退回全量（正确性优先）
        for c in changed where layersById[c.id] == nil { return -1 }

        // ★★V4：**只更新可见层的 frame**，不可见的记账延后（V3 类B 的第二优化项）
        //
        // 【为什么能省（V3 真机读数）】类B 场景 `layers` 段 **13.34ms / 4003 层**；
        //   而视口 844px ÷ 行高 56px ≈ **15 行可见**（共 1000 行）⇒ 绝大多数层不在屏上。
        //   layer.frame 的赋值成本与「是否可见」无关（CA 仍要处理），故按可见性分流能直接砍掉大头。
        //
        // 【正确性红线】不可见的**不能丢**（frame 是持久状态，滚入时会显示旧几何）
        //   ⇒ 记进 `pendingOffscreen`，由 `flushPendingIfVisible()` 在滚入前补刷。
        //   ⚠ 本里程碑**尚无滚动钩子**：调用方需在滚动时自行调用补刷（诚实边界，见文档）。
        let visible: [(id: Int, abs: CGRect)]
        let offscreen: [(id: Int, abs: CGRect)]
        // 父链深度升序（保证用到父的**已更新**原点）——两个集合各自排
        // ★★按父链深度升序（保证用到父的**已更新**原点）——但**先建一次深度表**
        //
        // 【为什么（本仓实测的回退）】首版直接 `sorted { depthOf($0.id) < depthOf($1.id) }`：
        //   `depthOf` 每次都沿父链上溯 O(深度) ⇒ 4003 节点排序变成 O(n·深度·log n)
        //   ⇒ 实测类A（只动 **1 个**节点）`layers` 段从 0.09ms **涨到 5.99ms**——
        //   优化反而制造了新热点。⇒ 先 O(n) 建表，排序只查表。
        let tSortStart = CFAbsoluteTimeGetCurrent()
        // ★★先**过滤**（O(n)、只需可见性判定）再**排序**（只排留下的）
        //
        // 【本仓实测的第三处顺序错误】首版是「先排序全部 4003，再过滤出可见的 ~180」
        //   ⇒ 白花 O(n log n) 次比较 + O(n) 次深度查询 ⇒ `sort` 段 **18.4ms**，
        //   而真正要排序的只有约 180 个（O(k log k) 可忽略）。
        //   ⇒ 顺序反过来：过滤不需要深度信息，排序才需要。
        var vis: [(id: Int, abs: CGRect)] = []
        var off: [(id: Int, abs: CGRect)] = []
        if visibleOnly {
            vis.reserveCapacity(changed.count / 8)
            for c in changed {
                if intersectsVisible(c.abs) { vis.append(c) } else { off.append(c) }
            }
        } else {
            vis = changed
        }
        let sortedVisible = vis.sorted { depthOf($0.id) < depthOf($1.id) }
        let sortedOff = visibleOnly ? off : []
        visible = sortedVisible
        offscreen = sortedOff

        let tSortDone = CFAbsoluteTimeGetCurrent()
        lastLayerTiming["sort_ms"] = (tSortDone - tSortStart) * 1000

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        var updated = 0
        var staleCleared = 0
        for c in visible {
            // ★★必须先清**该节点的待补刷旧账**（本仓实测的静默错几何缺陷）
            //
            // 【故障链】① 更新1：节点不可见 ⇒ 记账 `pendingOffscreen[X] = rect1`
            //          ② 更新2：用户已滚动、节点变可见 ⇒ 立即应用 rect2（正确）
            //             但旧账未清 ⇒ ③ 再滚动时 `flushPendingIfVisible` 用 **rect1 覆盖回退**！
            //   ⇒ 格子**回到旧位置**，且只在滚动后可见 ⇒ 静态用例完全发现不了。
            // ⇒ 纪律：**「立即应用」与「延后记账」对同一节点互斥**——应用即作废旧账。
            if pendingOffscreen.removeValue(forKey: c.id) != nil {
                staleCleared += 1
            }
            applyOneLayer(id: c.id, abs: c.abs)
            updated += 1
        }
        lastStalePendingCleared = staleCleared
        // ★不变量自检：**已应用的可见节点不得仍在待补刷表里**（重叠 = 会出现旧几何回退）
        //   正常应恒为 0；非 0 即说明「应用」与「记账」的互斥被破坏（静默错几何的前兆）。
        var overlap = 0
        for c in visible where pendingOffscreen[c.id] != nil {
            overlap += 1
        }
        lastPendingVisibleOverlap = overlap
        let tFramesDone = CFAbsoluteTimeGetCurrent()
        lastLayerTiming["frames_ms"] = (tFramesDone - tSortDone) * 1000
        for c in offscreen {
            pendingOffscreen[c.id] = c.abs // ★记账（不是丢弃）
        }
        let tBookDone = CFAbsoluteTimeGetCurrent()
        // ★提交单独计时（含隐式布局 + 提交；GPU 异步部分不计入——宿主同步路径到此为止）
        CATransaction.commit()
        lastLayerTiming["commit_ms"] = (CFAbsoluteTimeGetCurrent() - tBookDone) * 1000
        lastLayerTiming["total_ms"] = (CFAbsoluteTimeGetCurrent() - tSortStart) * 1000
        lastLayerTiming["count"] = Double(updated)
        lastDeferredCount = offscreen.count
        // ★★★逐边 border 批：增量更新后同样同步边框子层（父 frame 变了 ⇒ 边框跟着走）
        syncAllSideBorders()
        syncGradientFrames()
        return updated
    }

    /* ────────────────────────── ★V9：触摸 → 命中 → 派发 ────────────────────────── */

    /// 触摸回调（由桥接层注入：把「内容坐标 + 语义类型」交给桥接层）
    ///
    /// 【为什么用回调而不是直接持有 JSContext / 核心句柄（本仓设计）】`SelfDrawView` 是纯 UI 层：
    ///   不应知道 JS 的存在、也不该持有排版核心句柄（否则 UI / 运行时 / 核心三层耦合）。
    ///   ⇒ 视图只负责「把触摸转成内容坐标 + 限定时序（tap 判定）」；
    ///     命中测试（核心）与 JS 派发（桥接层）都在上层完成。
    var onGesture: ((Double, Double, String) -> Void)?

    /// 最近一次触摸的起点（用于判定 tap / longpress 与提供坐标）
    private var touchStart: (x: Double, y: Double, t: CFAbsoluteTime)?

    /// 触摸结束到派发的**最大位移**（超过则不算 tap——与 gesture 层的 threshold 同口径）
    private let tapSlop: Double = 10.0
    /// tap 的最长时长（超过则按 longpress 分流——见 touchesEnded）
    private let tapMaxDuration: Double = 0.5
    /// longpress 的最短时长（与 `packages/gesture` 的 longpressDuration 默认 500ms 对齐）
    private let longpressMinDuration: Double = 0.5
    /// swipe 的最小释放速度（px/ms——与 `packages/gesture` 的 swipeVelocity 默认 0.3 同口径）
    private let swipeMinVelocity: Double = 0.3

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = touches.first else { return }
        let p = t.location(in: self)
        touchStart = (Double(p.x), Double(p.y), CFAbsoluteTimeGetCurrent())
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        defer { touchStart = nil }
        guard let t = touches.first, let start = touchStart else { return }
        let p = t.location(in: self)
        let dt = CFAbsoluteTimeGetCurrent() - start.t
        classifyAndEmit(startX: start.x, startY: start.y,
                        endX: Double(p.x), endY: Double(p.y), dt: dt)
    }

    /// ★★★触摸分流器（tap / longpress / swipe）——**真触摸与宿主注入共用同一实现**（一处逻辑）。
    ///
    /// 【为什么抽出来】「真实触摸事件对齐」（2026-10-04）要求三端都能由**真事件序列**驱动交互，
    ///   而 iOS 的 `UITouch` 无法从 JS/宿主伪造（见 `tapAt` 诚实边界）⇒ 宿主改为按**真实时长**
    ///   喂入 down→held→up（`feedTouchSequence`），并**复用本分流器**——不再是 `tapAt` 那样
    ///   直接声明类型、完全绕过时序判定。⇒ 三端一致：Android 平台 `GestureDetector`、
    ///   iOS 本分流器、鸿蒙 ArkTS `.onTouch`（真时间戳）。
    private func classifyAndEmit(startX: Double, startY: Double,
                                endX: Double, endY: Double, dt: TimeInterval) {
        let dx = endX - startX
        let dy = endY - startY
        let dist = (dx * dx + dy * dy).squareRoot()
        // ★★V10/V17：按「位移 + 时长 + 速度」**三分流**（此前大位移被静默丢弃）：
        //   · 小位移 + 短时（≤ tapMaxDuration）      → tap
        //   · 小位移 + 长时（≥ longpressMinDuration） → longpress
        //   · **大位移 + 高速（≥ swipeMinVelocity）**  → **swipe**（矩阵 #7 补齐：此前只到
        //     "不派发（滚动由 pan 识别器负责）"——swipe 语义事件从未产生）
        //   ★阈值与 `packages/gesture` 对齐：longpressDuration 默认 500ms ·
        //     swipeVelocity 默认 **0.3 px/ms**（本处同口径换算 px/s：300 px/s）；
        //     两时长阈值相等不留空档：tapMaxDuration == longpressMinDuration。
        // ★用**绝对内容坐标**（核心的 rects 是内容坐标；self.bounds 是视口）
        //   ⇒ 加上滚动偏移（内容被移了，但核心坐标不动）
        let ax = endX + Double(contentOffset.x)
        let ay = endY + Double(contentOffset.y)
        if dist > tapSlop {
            // 大位移：按**释放速度**判 swipe（px/ms，与 gesture 层同量纲）
            let speed = dt > 0 ? dist / (dt * 1000) : 0
            guard speed >= swipeMinVelocity else { return }   // 慢拖 = 拖动（pan 负责），不派发
            let dir: String
            if abs(dx) > abs(dy) { dir = dx > 0 ? "right" : "left" }
            else { dir = dy > 0 ? "down" : "up" }
            emitGesture(x: ax, y: ay, type: "swipe:" + dir)
            return
        }
        let type: String
        if dt <= tapMaxDuration {
            type = "tap"
        } else if dt >= longpressMinDuration {
            type = "longpress"
        } else {
            return   // 理论不可达（两阈值相等）；保留以免将来改阈值时静默
        }
        emitGesture(x: ax, y: ay, type: type)
    }

    /// ★★★宿主喂入一次**真触摸序列**（down → held → up）——走 `classifyAndEmit`（与 `touchesEnded` 同一分流器）。
    ///
    /// 【与 `tapAt` 的分界】`tapAt` **直接声明类型 "tap"**（绕过时序判定）；本入口按**真实时长/位移**分流
    ///   ⇒ 覆盖「时长/速度 → 语义手势」这一环（此前 iOS 侧唯一未覆盖处）。
    ///   与 Android 注入真 `MotionEvent`（平台 GestureDetector）、鸿蒙 `uitest uiInput`（系统输入栈）同族。
    /// - Parameters: x/y 内容坐标；heldMs 按住时长；dx/dy 位移（判 swipe）
    @discardableResult
    func feedTouchSequence(x: Double, y: Double, heldMs: Double, dx: Double = 0, dy: Double = 0) -> Int {
        touchFeedCount += 1
        classifyAndEmit(startX: x, startY: y, endX: x + dx, endY: y + dy, dt: heldMs / 1000.0)
        return touchFeedCount
    }

    /// 宿主喂入的真触摸序列计数（判据：证明"事件确实进过分流器"）
    private(set) var touchFeedCount = 0

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        touchStart = nil
    }

    /// 发一次语义手势（内容坐标）——桥接层在此回调里做**核心命中测试 + JS 派发**
    func emitGesture(x: Double, y: Double, type: String) {
        onGesture?(x, y, type)
    }

    // ────────────────────────── ★★真手势滚动（pan 识别器） ──────────────────────────

    /// 拖拽滚动回调（**真手势的唯一出口**）：pan 识别 ⇒ 交桥的生产通路
    ///   （内容偏移 + 内核滚动联动 + 刷层在宿主内一次完成——与 `scrollAnimSync` 同一条路径）。
    /// - Returns: 桥的应答 JSON（判据探针收读数用；pan 处理器忽略返回值）
    var onScrollDrag: ((CGFloat, CGFloat) -> String)?

    /// 拖拽出口被驱动的次数（判据读它证明"这条路径真的走过"——不区分来源）
    private(set) var scrollDragDriveCount = 0

    /// pan 识别器回调：把**增量**送进唯一出口（`setTranslation(.zero)` 后每步即增量）
    ///
    /// 【★符号（自然滚动方向）】pan 的 translation 是**手指位移**（向下拖 = +y）；
    ///   而出口的参数空间是**内容位移**（+y = 内容下移 = 看到更早的内容 = 偏移减小）。
    ///   ⇒ 取负：手指向下拖 100 ⇒ 内容位移 -100 ⇒ `contentOffset` 减小（与 UIScrollView 同向）。
    ///   本函数是**唯一**做这个换算的地方（出口与探针都不重复换算）。
    @objc private func handleScrollPan(_ g: UIPanGestureRecognizer) {
        let t = g.translation(in: self)
        g.setTranslation(.zero, in: self)
        driveScrollDrag(dx: -t.x, dy: -t.y)
    }

    /// 拖拽出口（**唯一**）：pan 处理器与判据探针**都走这里** ⇒ 两条路径不可能分叉。
    ///
    /// 参数空间 = **内容位移**（与 `scrollDragBy` 同——pan 处理器负责"手指位移 → 内容位移"的换算）。
    @discardableResult
    func driveScrollDrag(dx: CGFloat, dy: CGFloat) -> String {
        scrollDragDriveCount += 1
        return onScrollDrag?(dx, dy) ?? "{\"ok\":false,\"error\":\"未接线\"}"
    }

    /// 真识别器是否已安装（判据读——"接线"的第一条证据）
    var hasScrollPanRecognizer: Bool {
        (gestureRecognizers ?? []).contains { $0 is UIPanGestureRecognizer }
    }

    /// 节点在层树中的深度（沿 `parentById` 上溯；带防环保护）
    /// 节点深度（★建层时预计算，见 buildLayers；查表 O(1)）
    ///
    /// 【为什么不再沿父链上溯（本仓实测）】上溯版在「4003 个节点排序」时被调用 O(n log n) 次，
    ///   实测 `sort` 段 **19.38ms**，而 `frames` 段只有 0.46ms
    ///   ——瓶颈根本不在 CA 提交，而在这个自制的上溯循环。
    ///   建层时父必已建好 ⇒ 递推即可（`depthById` 由 buildLayers 填充）。
    private func depthOf(_ id: Int) -> Int {
        depthById[id] ?? 0
    }

    /// 取某节点建层时记录的 **fontSize**（文本补丁的度量要用它——与全量渲染同源）
    func fontSizeOf(id: Int) -> Double? {
        if let fs = metaByNodeId[id]?["fontSize"] as? CGFloat { return Double(fs) }
        if let fs = metaByNodeId[id]?["fontSize"] as? Double { return fs }
        return nil
    }

    /// 取某节点建层时记录的 **fontWeight**（文本度量要用它——与绘制同源）
    func fontWeightOf(id: Int) -> Double? {
        if let fw = metaByNodeId[id]?["fontWeight"] as? CGFloat { return Double(fw) }
        if let fw = metaByNodeId[id]?["fontWeight"] as? Double { return fw }
        return nil
    }

    /// ★批次 13：取某节点建层时记录的 `lineHeight`（文本度量用——与绘制同源）
    func lineHeightOf(id: Int) -> String? {
        metaByNodeId[id]?["lineHeight"] as? String
    }

    /// ★批次 20：字距（px）——度量与绘制同源。
    func letterSpacingOf(id: Int) -> CGFloat {
        (metaByNodeId[id]?["letterSpacing"] as? Double).map { CGFloat($0) } ?? 0
    }

    /// ★★**层序对账**（⚠ **设计有误，仅作诊断读数——勿当判据**，见下）
    ///
    /// 【为什么要做它】像素判据**证明不了层序**——把 `insertLayers` 退化为"恒追加"后
    ///   它仍全绿（行不重叠 ⇒ 层序差异在屏幕上不可见）。而层序错是**真错**
    ///   （重叠/半透明/z-order/命中测试都会与核心不符）。
    ///
    /// 【★为什么当前实现比不了（本仓实测的自我纠错）】两侧的"子序"**来源不同源**：
    ///   · 核心 `child_order` = 内部 `children` 字段的顺序
    ///   · 宿主 `childrenById` = 按**每个节点的 parentId 归类**得到的（全量建层路径如此填充）
    ///   当上游给的 `parentId` 与核心的 `children` 结构不一致时（实测差异@51：
    ///   宿主在该位是**圆点**、核心是**行根**），两边天然对不上——
    ///   **这是"两份表示本来就不等价"，不是"层序错了"**。
    ///   ⇒ 正解（未做）：宿主应**以核心的 `child_order` 为准**重建 `childrenById`
    ///     （单一事实来源），而不是自行从 parentId 归类。属后续工作。
    ///   ⇒ 当前：本函数的结果只作**诊断读数**落盘，**不得**用于 PASS/FAIL 断言。
    ///
    /// - Parameter coreChildren: 核心返回的 `{parentId: [childId, ...]}` 映射
    /// - Returns: `(checked, mismatches)`——mismatches 非空即层序与核心不符
    /// ★★**以核心的 `child_order` 为准**，重建 `childrenById` 并重排 CALayer 子层
    ///
    /// 【为什么必须有（本仓实测的设计纠正）】此前 `childrenById` 是宿主**自行**按每个节点的
    ///   `parentId` 归类出来的（见 `buildLayers`），而**层序**（= 绘制顺序）应以核心的
    ///   `children` 为准——两者是**同一事实的两份表示**，自行推导就会分叉
    ///   （实测：对账报 `首个差异@51: 宿主 6 vs 核心 5260`）。
    ///   ⇒ 正解：**核心说什么就是什么**——按 `child_order` 重建簿记 + 重排层。
    ///
    /// 【重排手法】`addSublayer` 对**已在层的子层**是**移到末尾**（subarrays[0] 先绘制=底层）
    ///   ⇒ 按核心顺序**依次** `addSublayer` 即得目标顺序（无需 remove 再 add）。
    ///   ★前提：核心给的 `kids` 是该父的**全部**子节点（Core 侧如此产出）。
    ///
    /// - Returns: `(applied, missing)`——missing 非空即"核心提到了但宿主没有该层"（层树缺节点）
    func applyChildOrder(_ coreChildren: [String: [Int]]) -> (applied: Int, missing: [String]) {
        var applied = 0
        var missing: [String] = []
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for (pidStr, kids) in coreChildren {
            guard let pid = Int(pidStr) else { continue }
            let absent = kids.filter { layersById[$0] == nil }
            if !absent.isEmpty {
                // ★不静默：核心提到了、宿主没有 ⇒ 层树缺节点（必须可观测——否则后续所有
                //   顺序/几何操作都在不完整的基础上做）
                missing.append("parent \(pid): 缺 \(Array(absent.prefix(4)))")
                continue
            }
            let parentLayer: CALayer = layersById[pid] ?? self.layer
            childrenById[pid] = kids
            for k in kids {
                if let l = layersById[k] { parentLayer.addSublayer(l) }
            }
            applied += 1
        }
        CATransaction.commit()
        return (applied, missing)
    }

    /// ★★**应用绘制补丁**（颜色 / 圆角 / 字号 / 字重 / 透明度）——**几何之外的第二条通道**
    ///
    /// 【为什么单独一条通道（本仓实测的功能缺口）】`takePatches()` 只发布**布局**字段
    ///   （要经核心重排）；绘制属性与几何无关 ⇒ 直接改层即可，**绕核心是纯粹的多余**
    ///   （核心不认识 paint 字段，送过去只会白跑一轮）。
    ///
    /// 【形态】`{id: {paint...}}`；键值为 `null` ⇒ **清除**（如移除 borderRadius ⇒ 归零）
    ///   ⇒ 这与"只发改动键"不同：宿主无需维护旧值，逻辑平凡。
    ///
    /// - Returns: 实际应用的层数（诊断读数：证明 paint 通道真的生效）
    func applyPaintPatches(_ patches: [[String: Any]]) -> Int {
        var applied = 0
        var deferred = 0
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for p in patches {
            guard let id = p["id"] as? Int, let paint = p["paint"] as? [String: Any] else { continue }
            guard let layer = layersById[id] else {
                // ★★虚拟化：层不存在（屏外未物化）⇒ 写进**真源**，物化时自然带上
                //
                // 【为什么不能直接跳过（本仓纪律：更新与物化解耦）】跳过 ⇒ 滚入时
                //   该行显示**旧颜色**（几何/文本都对，只有颜色错）⇒ 只有像素比对能发现。
                if nodesById[id] != nil {
                    var m = nodesById[id]!
                    for (k, v) in paint { m[k] = v }
                    nodesById[id] = m
                    deferred += 1
                }
                continue
            }
            configurePaint(layer, paint: paint, id: id)
            applied += 1
        }
        CATransaction.commit()
        lastPaintDeferred = deferred
        return applied
    }

    /// ★最近一次 paint 补丁里**因未物化而落真源**的条数（诊断：证明"屏外不被丢弃"）
    private(set) var lastPaintDeferred = 0

    /// 把 paint 快照应用到层上（**同一语义一处实现**：即时应用与物化时都走它）
    private func configurePaint(_ layer: CALayer, paint: [String: Any], id: Int) {
        // ① 背景色（CALayer）
        if let bgAny = paint["backgroundColor"] {
            layer.backgroundColor = (bgAny as? String).flatMap(parseHexColor)?.cgColor
        }
        // ② 文本层专有：string / 字号 / 字重 / 前景色
        if let tl = layer as? CATextLayer {
            if let colorAny = paint["color"] {
                tl.foregroundColor = (colorAny as? String).flatMap(parseHexColor)?.cgColor
                    ?? UIColor.white.cgColor
            }
            let fs = (paint["fontSize"] as? CGFloat) ?? tl.fontSize
            let fw = (paint["fontWeight"] as? CGFloat) ?? 400
            // ★字族也是字体维度：paint 里带它（或带 fontSize/weight）都要重建字体
            let fam = (paint["fontFamily"] as? String) ?? metaByNodeId[id]?["fontFamily"] as? String ?? "system"
            if paint["fontSize"] != nil || paint["fontWeight"] != nil || paint["fontFamily"] != nil {
                let ufont = ProteusTextAdapter.font(size: fs, weight: fw, family: fam)
                // ★字体变了 ⇒ 必须同时更新 `font` 与 `fontSize`（CATextLayer 两者独立）
                tl.font = ProteusTextAdapter.cgFont(of: ufont)
                tl.fontSize = fs
            }
        }
        // ③ 圆角（null ⇒ 归零）
        if let brAny = paint["borderRadius"] {
            let r = (brAny as? CGFloat) ?? 0
            layer.cornerRadius = r
            layer.masksToBounds = r > 0
        }
        applyRadiusCorners(layer, style: paint)   // ★批次 34：逐角圆角（paint 表）
        // ④ 透明度
        if let opAny = paint["opacity"] {
            let op = (opAny as? CGFloat) ?? 1
            layer.opacity = Float(op)
        }
        // ⑤ 更新 meta（后续度量/诊断读它——保持"层 = meta"一致）
        var m = metaByNodeId[id] ?? [:]
        for (k, v) in paint where !(v is NSNull) { m[k] = v }
        for (k, v) in paint where v is NSNull { m.removeValue(forKey: k) }
        metaByNodeId[id] = m
    }

    /// ★★**层序对账（对真实层序）**：把「CALayer 子层顺序」与「核心的 children 顺序」比较
    ///
    /// 【为什么对"真实层序"而不是对 `childrenById`（本仓实测的判据强度教训）】若拿
    ///   `childrenById`（宿主自己的簿记）去比，`applyChildOrder` 刚按核心写过它 ⇒ **必然相等**
    ///   ⇒ 判据恒绿、毫无信息量。而对**真实 `sublayers`** 比较才验证了
    ///   "层树真的按核心顺序排好了"——这正是 z-order/重叠绘制/命中测试所依赖的那份事实。
    func reconcileChildOrderLegacy(coreChildren: [String: [Int]]) -> (checked: Int, mismatches: [String]) {
        // 层身份 → 节点 id 的反查表（用对象身份，避免依赖 layersById 的遍历顺序）
        var idByLayer: [ObjectIdentifier: Int] = [:]
        for (i, l) in layersById { idByLayer[ObjectIdentifier(l)] = i }
        var checked = 0
        var mismatches: [String] = []
        var mismatch_detail: [String] = []
        for (pidStr, coreKids) in coreChildren {
            guard let pid = Int(pidStr) else { continue }
            // ★真实层序（本判据的核心：不是宿主自报的簿记）
            let parentLayer: CALayer = layersById[pid] ?? self.layer
            let mine: [Int] = (parentLayer.sublayers ?? []).compactMap { idByLayer[ObjectIdentifier($0)] }
            checked += 1
            if mine != coreKids {
                // ★诊断必须够**定位**（本仓实测：只打印前 6 项时"看起来完全一样"，
                //   而差异在后面 ⇒ 打印**首个差异位置 + 两侧该位置的值**
                // ★完整对照（只对**前几个**动过的父做，避免报告爆炸）
                if let d = coreChildren["__debug_ids"]  { _ = d }
                let head = min(8, max(mine.count, coreKids.count))
                mismatch_detail.append("parent \(pid) 前\(head)项：宿主 \(Array(mine.prefix(head))) 核心 \(Array(coreKids.prefix(head)))")
                let n = min(mine.count, coreKids.count)
                var firstDiff = -1
                for i in 0..<n where mine[i] != coreKids[i] { firstDiff = i; break }
                let hint: String
                if firstDiff >= 0 {
                    hint = "首个差异@\(firstDiff): 宿主 \(mine[firstDiff]) vs 核心 \(coreKids[firstDiff])"
                } else {
                    hint = "前缀相同但长度不同: 宿主 \(mine.count) vs 核心 \(coreKids.count)"
                }
                mismatches.append("parent \(pid): \(hint)")
            }
        }
        // 细节并入 mismatches（报告只带一个数组）
        return (checked, mismatches + mismatch_detail)
    }

    /// ★实际 CALayer frame 清单（宿主侧读数）——与核心 rects 对照，证明「几何真的被用上了」
    ///
    /// `parentId` 一并导出：三端坐标口径不同（核心 rects = **绝对**；CALayer frame = **父相对**），
    /// 核验脚本必须按 parentId 逐级累加才能对照 —— 少了它就无法判定，
    /// 甚至会把「正确的父相对」误判成「不一致」。
    func layerFrameDump() -> [String: Any] {
        var out: [String: Any] = [:]
        for (id, f) in builtFrames {
            out["\(id)"] = ["x": f.minX, "y": f.minY, "w": f.width, "h": f.height,
                             "parentId": builtParents[id] ?? -1]
        }
        return out
    }

    func snapshot(named name: String) -> String? {
        let size = bounds.size
        guard size.width > 0, size.height > 0 else { return nil }
        let renderer = UIGraphicsImageRenderer(size: size)
        let img = renderer.image { ctx in
            self.layer.render(in: ctx.cgContext)
        }
        guard let data = img.pngData() else { return nil }
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent("\(name).png")
        try? data.write(to: url)
        return url.path
    }

    /* ═══════════════════ ★★虚拟化：按行物化 / 回收 layer（§12.5 materialize · §12.7 P1） ═══════════════════ */

    /// 一行（虚拟化的最小粒度）——来自实例化产物的 `virtual.rows`
    struct VirtualRow {
        let index: Int
        let key: String
        let root: Int
        /// 该行全部节点 id（**父在前** ⇒ 可顺序建层）
        let ids: [Int]
    }

    /// 行表（按行号升序——宿主对可见区做二分/扫描的前提）
    private var virtualRows: [VirtualRow] = []
    /// 行根节点 id → 行号（插入定位用：兄弟中找"下一个更大的行号"）
    private var rowIndexByRoot: [Int: Int] = [:]
    /// 任意行内节点 id → 行号（回收时按节点找行）
    private var rowOfNode: [Int: Int] = [:]
    /// 已物化的行号集合（**池的账本**：acquire/release 的作用域）
    private var materializedRows = Set<Int>()
    /// ★★**层对象池**（free list）——release 的行把层**归还**，acquire 的行优先取用
    private var layerPool: [CALayer] = []
    /// 池容量（可由用例调小做**破坏性验证**：容量 0 ⇒ 复用必然发生不了）
    private(set) var layerPoolCapacity = 96
    func setLayerPoolCapacity(_ n: Int) {
        layerPoolCapacity = max(0, n)
        if layerPool.count > layerPoolCapacity {
            layerPool.removeLast(layerPool.count - layerPoolCapacity)
        }
    }
    private(set) var layersCreated = 0
    private(set) var layersReused = 0
    /// 归还进池的次数（与 reuse 对照：**归还 > 0 而复用 = 0** 说明池没起作用）
    private(set) var layersReturned = 0
    /// 池满被丢弃的层数（诊断"池容量是否成为瓶颈"）
    private(set) var layersDropped = 0
    /// 节点 id → 节点规格（物化时建层/填内容用；**虚拟化下这是内容的唯一真源**）
    private var nodesById: [Int: [String: Any]] = [:]
    /// 节点 id → 绝对 rect（物化时设帧用；与核心同口径）
    private var nodeRects: [Int: CGRect] = [:]
    /// 行表状态下测得的**物化事件**读数（供 A/B 与判据）
    private(set) var lastMaterializeFrontier = 0

    var isVirtual: Bool { !virtualRows.isEmpty }

    /// 初始化虚拟化（由桥在 mountVirtual 里调用一次）
    func setupVirtual(rows: [VirtualRow], nodes: [[String: Any]], rects: [Int: CGRect], poolCapacity: Int) {
        virtualRows = rows.sorted { $0.index < $1.index }
        rowIndexByRoot = [:]
        rowOfNode = [:]
        for r in virtualRows {
            rowIndexByRoot[r.root] = r.index
            for id in r.ids { rowOfNode[id] = r.index }
        }
        nodesById = [:]
        for n in nodes {
            if let id = n["id"] as? Int { nodesById[id] = n }
        }
        nodeRects = rects
        layerPoolCapacity = max(0, poolCapacity)
        layerPool.removeAll()
        materializedRows.removeAll()
        layersCreated = 0
        layersReused = 0
        layersReturned = 0
        layersDropped = 0
    }

    /// 更新虚拟化下的**真源**（**不触碰层**）——未物化的行在下次物化时自然拿到新值
    ///
    /// 【为什么必须有（虚拟化最容易出的静默错）】行在视口外时若"更新被丢弃"，
    ///   滚入时会显示**旧内容/旧几何**——而所有几何断言都对着核心（正确的）⇒ 全绿。
    ///   ⇒ 纪律：**更新必须落到真源（本表），与是否物化解耦**。
    func updateVirtualSource(changed: [(id: Int, abs: CGRect)], textUpdates: [String: Any]) {
        for c in changed {
            nodeRects[c.id] = c.abs
        }
        for (k, v) in textUpdates {
            guard let id = Int(k), let t = v as? String else { continue }
            nodesById[id]?["text"] = t
        }
    }

    /// ★从核心几何 + 内容偏移推导**可见行区间**（不假设行高——行高由核心算）
    ///
    /// 【为什么用几何推导而不是 `offsetY / rowHeight`】行高在本仓可被样式/文本改变
    ///   （flexShrink、字重、换行）⇒ 任何"常量行高"的假设都会在某个用例上错位。
    ///   本函数扫描行根 rect（行表有序）⇒ 与核心始终同口径。
    func visibleRowRange() -> (first: Int, last: Int)? {
        guard !virtualRows.isEmpty else { return nil }
        let top = contentOffset.y
        let bottom = contentOffset.y + bounds.height
        var first = -1
        var last = -1
        for r in virtualRows {
            guard let rect = nodeRects[r.root] else { continue }
            if rect.maxY < top { continue }        // 完全在视口上方
            if rect.minY > bottom { break }        // 行号有序 ⇒ 后面都在下方
            if first < 0 { first = r.index }
            last = r.index
        }
        if first < 0 {   // 全空（视口落在了列表外）⇒ 取最近的一行，避免 acquire 空集
            let nearest = virtualRows.min(by: { abs(($0.index == 0 ? 0 : nodeRects[$0.root]?.minY ?? 0) - top)
                                              < abs(($1.index == 0 ? 0 : nodeRects[$1.root]?.minY ?? 0) - top) })
            return nearest.map { ($0.index, $0.index) }
        }
        return (first, last)
    }

    /// 在兄弟层（父的已物化子层）中找到**应插在**第 `index` 行之前的位置
    ///
    /// 【为什么必须做（层序 = 绘制顺序 = 命中顺序）】`addSublayer` 恒为追加 ⇒
    ///   乱序 acquire（回滚时先补下面的行）会让**层序与核心 children 序不一致**
    ///   ⇒ z-order/重叠绘制/命中测试与核心不符，且几何断言发现不了（本仓已踩过同款）。
    private func insertRowLayer(_ layer: CALayer, rowIndex: Int, parentId: Int) {
        let parentLayer: CALayer = layersById[parentId] ?? self.layer
        let sibs = childrenById[parentId] ?? []
        var inserted = false
        for sid in sibs {
            // 兄弟里第一个"行号更大"的行根 ⇒ 插到它前面
            if let si = rowIndexByRoot[sid], si > rowIndex, let sl = layersById[sid] {
                parentLayer.insertSublayer(layer, below: sl)
                inserted = true
                break
            }
        }
        if !inserted { parentLayer.addSublayer(layer) }
        _ = parentId
    }

    /// 物化一行（建/取层 + 填内容 + 设帧 + 插到正确层序位）
    @discardableResult
    func materializeRow(_ rowIndex: Int) -> Int {
        guard let row = virtualRows.first(where: { $0.index == rowIndex }) else { return 0 }
        guard !materializedRows.contains(rowIndex) else { return 0 }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        var made = 0
        for id in row.ids {
            guard let spec = nodesById[id] else { continue }
            guard layersById[id] == nil else { continue }   // 已物化（防御：重复 acquire）
            let style = SelfDrawView.styleOf(spec)
            let (layer, reused) = acquireLayer(style: style, nodeId: id, boxWidth: nodeRects[id]?.width ?? 0)
            if !reused { made += 1 }
            // ★帧 = 节点绝对 rect − 父绝对原点（父的 rect 也在核心几何里 ⇒ 与物化顺序无关）
            let abs = nodeRects[id] ?? .zero
            let pid = (spec["parentId"] as? Int) ?? -1
            let parentOrigin = pid >= 0 ? (nodeRects[pid]?.origin ?? .zero) : .zero
            let f = CGRect(x: abs.minX - parentOrigin.x, y: abs.minY - parentOrigin.y,
                           width: abs.width, height: abs.height)
            layer.frame = lineBoxFrame(f, style: style)
            applyRadiusPct(layer, style: style, size: f.size)
            if let pidAny = spec["parentId"] as? Int, pidAny >= 0 {
                if id == row.root {
                    insertRowLayer(layer, rowIndex: rowIndex, parentId: pidAny)
                } else {
                    (layersById[pidAny] ?? self.layer).addSublayer(layer)
                }
                childrenById[pidAny, default: []].append(id)
                parentById[id] = pidAny
            } else {
                self.layer.addSublayer(layer)
                parentById[id] = -1
            }
            layersById[id] = layer
            depthById[id] = depthOf(id)
            builtFrames[id] = f
            builtParents[id] = pid
            rectsByNodeId[id] = abs
            metaByNodeId[id] = style
            layerNodes.append(layer)
            made += 0
        }
        materializedRows.insert(rowIndex)
        builtLayerCount = layerNodes.count
        CATransaction.commit()
        return made
    }

    /// 回收一行（层归还池 + 清空该行全部簿记）
    @discardableResult
    func dematerializeRow(_ rowIndex: Int) -> Int {
        guard let row = virtualRows.first(where: { $0.index == rowIndex }),
              materializedRows.contains(rowIndex) else { return 0 }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        var returned = 0
        // ★父 id 先取（下面会把表清掉）
        let rootParent = parentById[row.root] ?? (nodesById[row.root]?["parentId"] as? Int) ?? -1
        // 逆序回收（子先于父：避免父的 childrenById 被提前清空导致子找不到落点）
        // ★★§7.3（Morpheus 方案）：**节点回收必须解绑动画**
        //
        // 【不做的后果（两重，都是静默错）】① 动画仍绑在旧 node id 上 ⇒ 该行重新物化时会
        //   显示"半路的变换"（错误位置）；② 动画永不结束 ⇒ 每帧白算。
        //   ⇒ 在回收点**成批解绑**（机制保证，不靠"记得调"）。
        //   ★经回调转给 Bridge（句柄在那边）——与本文件 onGesture/onFrame 同一模式。
        onRowDematerialized?(row.ids)
        for id in row.ids.reversed() {
            if let l = layersById[id] {
                l.removeFromSuperlayer()
                // ★★层进池前**重置变换**（与 configureLayer 的格式重配同源——本仓 paint-hint 教训）：
                //   否则池里取出的层会带着上一个节点的动画变换 ⇒ **新内容错位**（静默错显示）
                l.transform = CATransform3DIdentity
                if layerPool.count < layerPoolCapacity {
                    layerPool.append(l)
                    layersReturned += 1
                    returned += 1
                } else {
                    layersDropped += 1
                }
                layerNodes.removeAll { $0 === l }
            }
            layersById.removeValue(forKey: id)
            depthById.removeValue(forKey: id)
            parentById.removeValue(forKey: id)
            childrenById.removeValue(forKey: id)
            builtFrames.removeValue(forKey: id)
            builtParents.removeValue(forKey: id)
            rectsByNodeId.removeValue(forKey: id)
            metaByNodeId.removeValue(forKey: id)
            absOriginByNodeId.removeValue(forKey: id)
            pendingOffscreen.removeValue(forKey: id)
        }
        if rootParent >= 0, var sibs = childrenById[rootParent] {
            sibs.removeAll { $0 == row.root }
            childrenById[rootParent] = sibs
        }
        materializedRows.remove(rowIndex)
        builtLayerCount = layerNodes.count
        CATransaction.commit()
        return returned
    }

    /// 取一个层：**同类型**优先从池里复用（类型不匹配不复用——CATextLayer 当容器会残留 string）
    private func acquireLayer(style: [String: Any], nodeId: Int, boxWidth: CGFloat = 0) -> (CALayer, Bool) {
        let wantsText = !((style["text"] as? String) ?? "").isEmpty
        if let i = layerPool.firstIndex(where: { wantsText ? ($0 is CATextLayer) : !($0 is CATextLayer) }) {
            let l = layerPool.remove(at: i)
            configureLayer(l, style: style, boxWidth: boxWidth)
            layersReused += 1
            return (l, true)
        }
        layersCreated += 1
        return (makeLayer(style: style, nodeId: nodeId, boxWidth: boxWidth), false)
    }

    /// ★批次 4（CSS 兼容对齐）：`text-align` → `CATextLayer.alignmentMode`（left/center/right；缺省 left）。
    ///   iOS 对齐常量 `.left`/`.center`/`.right`（非自然语言语义）。
    private func alignmentMode(_ v: String?) -> CATextLayerAlignmentMode {
        switch v {
        case "center": return .center
        case "right": return .right
        default: return .left
        }
    }

    /// ★★全端对齐批（2026-10-05 · white-space 五端对齐）：该 style 是否为 wrap 模式
    ///   （normal/pre-wrap/pre-line/pre ⇒ 盒宽折行；nowrap ⇒ 单行）。
    static func isWrapStyle(_ style: [String: Any]) -> Bool {
        // ★★第三轮复评修复（2026-10-05）：**缺省 = CSS `normal`（可折行）**——
        //   此前"缺省=单行"让未声明 white-space 的文本不折行（与 Web 缺省语义相反）。
        //   只有显式 `nowrap`/`pre` 才是单行。
        let ws = (style["whiteSpace"] as? String) ?? "normal"
        return ws == "normal" || ws == "pre-wrap" || ws == "pre-line" || ws == "pre"
    }

    /// ★★★word-break:normal（2026-10-09 · 全端一致）：**无断点长串**判据——不含空白且不含 CJK/假名/谚文。
    ///   与鸿蒙 `WORD_BREAK_TYPE_NORMAL` / Android `isUnbreakableToken` 同语义。
    static func isUnbreakableToken(_ t: String) -> Bool {
        if t.isEmpty { return false }
        for scalar in t.unicodeScalars {
            let v = scalar.value
            if v == 0x20 || v == 0x09 || v == 0x0A || v == 0x0D { return false }
            if (0x3000...0x303F).contains(v) || (0x3040...0x30FF).contains(v)
                || (0x4E00...0x9FFF).contains(v) || (0xAC00...0xD7A3).contains(v)
                || (0xFF00...0xFFEF).contains(v) { return false }
        }
        return true
    }

    /// ★★★有效换行判定（2026-10-09）：在 `isWrapStyle` 上叠加 word-break:normal 的
    ///   「**无断点长串溢出 ⇒ 不折行（单行溢出，与 Web 一致）**」——CoreText `byWordWrapping`
    ///   会**硬折**超宽行（与 Web normal 不符），须显式抑制。
    static func effectiveWrap(_ style: [String: Any], text: String, boxWidth: CGFloat) -> Bool {
        guard isWrapStyle(style) else { return false }
        if (style["wordBreak"] as? String) == "break-all" { return true }
        guard boxWidth > 1, isUnbreakableToken(text) else { return true }
        var cw = boxWidth
        if let p = style["padding"] as? [String: Any] {
            func e(_ k: String) -> CGFloat { (p[k] as? Double).map { CGFloat($0) } ?? (p[k] as? CGFloat) ?? 0 }
            cw = max(1, boxWidth - e("left") - e("right"))
        }
        let fs = (style["fontSize"] as? CGFloat) ?? 14
        let fw = (style["fontWeight"] as? CGFloat) ?? 400
        let fam = (style["fontFamily"] as? String) ?? "system"
        let w = ProteusTextAdapter.measureText(text, fontSize: fs, fontWeight: fw, fontFamily: fam).width
        return w <= cw + 0.5
    }

    /// ★★★行高修复（2026-10-08）：该 style 是否需 CoreText 绘制——**多行（wrap）且声明了 line-height**。
    ///   （CATextLayer 忽略段落行高 ⇒ 只有这种形态才需要；单行/未声明行高仍走原生路径，零行为变化。）
    static func needsCoreText(_ style: [String: Any]) -> Bool {
        guard isWrapStyle(style) else { return false }
        guard let lh = style["lineHeight"] as? String, !lh.isEmpty else { return false }
        return true
    }

    /// ★★★line-clamp 项（2026-10-08 · CSS Overflow）：按 `lineClamp` 预截断文本（尾省略号）。
    ///   无 clamp / 无需截断 ⇒ 原串（零行为变化）。度量（wrapRemeasure）与绘制（makeLayer/configureLayer）
    ///   **同源**调适配器 `truncateToLines`。
    static func clampedText(_ text: String, style: [String: Any], boxWidth: CGFloat) -> String {
        let n = (style["lineClamp"] as? CGFloat).map { Int($0) } ?? (style["lineClamp"] as? Double).map { Int($0) } ?? 0
        if n <= 0 || boxWidth <= 1 { return text }
        // ★★★text 内间距批（2026-10-09）：预截断按**内容盒宽**（与绘制同源）
        let padW: CGFloat = { guard let p = style["padding"] as? [String: Any] else { return 0 }
            func e(_ k: String) -> CGFloat { (p[k] as? Double).map { CGFloat($0) } ?? (p[k] as? CGFloat) ?? 0 }
            return e("left") + e("right") }()
        let contentW = max(1, boxWidth - padW)
        let fs = (style["fontSize"] as? CGFloat) ?? 14
        let fw = (style["fontWeight"] as? CGFloat) ?? 400
        let fam = (style["fontFamily"] as? String) ?? "system"
        let ls = (style["letterSpacing"] as? Double).map({ CGFloat($0) }) ?? (style["letterSpacing"] as? CGFloat) ?? 0
        return ProteusTextAdapter.truncateToLines(text, fontSize: fs, fontWeight: fw, fontFamily: fam,
            lineWidth: contentW, lineHeight: style["lineHeight"] as? String, letterSpacing: ls,
            wordBreak: style["wordBreak"] as? String, maxLines: n)
    }

    /// ★★全端对齐批：nowrap 且溢出裁切（overflow:hidden 且非 ellipsis）——Web 裁切语义。
    private func isClipTextStyle(_ style: [String: Any]) -> Bool {
        guard (style["text"] as? String)?.isEmpty == false else { return false }
        if SelfDrawView.isWrapStyle(style) { return false }
        if (style["textOverflow"] as? String) == "ellipsis" { return false }
        return (style["overflow"] as? String) == "hidden"
    }
    /// ★★★overflow-x 项（2026-10-06）：该 style 是否触发**子内容裁剪**（CSS Overflow 3。
    ///   折叠器已把 Web 归一+形态收敛做完（x==y ⇒ 统一 \`overflow\`；x≠y ⇒ 仍写统一 hidden + 逐轴保真）
    ///   ⇒ 本判据读统一 \`overflow\`（与内核/其他端同一口径）；visible/缺省 ⇒ 不裁。
    static func isOverflowClipped(_ style: [String: Any]) -> Bool {
        guard let ov = style["overflow"] as? String else { return false }
        return ov == "hidden" || ov == "scroll" || ov == "auto"
    }

    /// 把节点规格里的绘制字段取出来（与全量路径同款；单一实现避免分叉）
    static func styleOf(_ n: [String: Any]) -> [String: Any] {
        var style: [String: Any] = [:]
        // ★★全端对齐批（2026-10-05）：whiteSpace/overflow 也必须透传——层配置按其分流（折行/截断/裁切）
        // ★★★overflow-x 项（2026-10-06）：overflowX/overflowY 也透传（层配置按其开裁剪）
        // ★★★word-break 项（2026-10-06）：wordBreak 也透传（段落样式按其设 lineBreakMode）
        for k in ["backgroundColor", "color", "text", "fontFamily", "textAlign", "borderColor", "lineHeight", "whiteSpace", "wordBreak", "overflow", "textOverflow", "overflowX", "overflowY"] {
            if let v = n[k] as? String { style[k] = v }
        }
        if let bw = n["borderWidth"] as? Double { style["borderWidth"] = CGFloat(bw) }
        if let bw = n["borderWidth"] as? CGFloat { style["borderWidth"] = bw }
        // ★★I3：绘制提示必须**透传**——本函数是 `acquireLayer`/`buildLayers` 的必经之路，
        //   不透传则 `applyPaintHint` 永远读不到 hint（接线断在这里，且**无任何报错**）。
        if let h = n["paintHint"] as? [String: Any] { style["paintHint"] = h }
        // ★★★line-clamp 项（2026-10-08）：多行截断行数必须透传（本函数是建层必经之路；
        //   漏透传 ⇒ 宿主读不到 ⇒ 静默不截断——与 clipPath/glow/mask 同款教训）。
        if let lc = n["lineClamp"] as? Double { style["lineClamp"] = CGFloat(lc) }
        if let lc = n["lineClamp"] as? CGFloat { style["lineClamp"] = lc }
        if let fs = n["fontSize"] as? Double { style["fontSize"] = CGFloat(fs) }
        if let fs = n["fontSize"] as? CGFloat { style["fontSize"] = fs }
        if let fw = n["fontWeight"] as? Double { style["fontWeight"] = CGFloat(fw) }
        if let fw = n["fontWeight"] as? CGFloat { style["fontWeight"] = fw }
        if let br = n["borderRadius"] as? Double { style["borderRadius"] = CGFloat(br) }
        if let br = n["borderRadius"] as? CGFloat { style["borderRadius"] = br }
        // ★★★边框族收口批（2026-10-05 · 子代理终评抓出的 major）：**逐角掩码必须透传**——
        //   styleOf 是建层必经之路；漏透传 ⇒ applyRadiusCorners 的 guard 读不到掩码直接 return
        //   ⇒ maskedCorners 保持缺省（全四角）+ cornerRadius>0 ⇒ 声明"仅 TL/BR"的盒画成**四角全圆**
        //   （填充与边框皆错，与 Web 不符）。与 clipPath/glow/mask 同款教训第三次：**白名单必须跟新字段走**。
        if let rc = n["borderRadiusCorners"] as? [String: Any] { style["borderRadiusCorners"] = rc }
        // ★★★逐边 border 批（2026-10-05）：**逐边字段必须透传**（本函数是建层必经之路；
        //   漏透传 ⇒ 声明在树里而宿主读不到 ⇒ 静默不渲染——clipPath/glow/mask 的同款教训）。
        // ★★★边框族收口批（2026-10-05）：**线型也必须透传**（本函数是建层必经之路；
        //   漏透传 ⇒ 声明在树里而宿主读不到 ⇒ 静默画实线——与 clipPath/glow/mask 同款教训）。
        for k in ["borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle"] {
            if let v = n[k] as? String { style[k] = v }
        }
        for k in ["borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor"] {
            if let v = n[k] as? String { style[k] = v }
        }
        for k in ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"] {
            if let v = n[k] as? Double { style[k] = CGFloat(v) }
            if let v = n[k] as? CGFloat { style[k] = v }
        }
        // ★★★text 内间距批（2026-10-09 · 用户抓出「App 端 text 的 padding-left 被丢弃」）：
        //   `padding` 必须透传——本函数是建层必经之路；漏透传 ⇒ 宿主读不到 ⇒ 文本 padding 静默丢弃。
        if let pd = n["padding"] as? [String: Any] { style["padding"] = pd }
        // ★批次 10（CSS 兼容对齐 · 超级应用视觉）：盒阴影（结构化对象）透传——本函数是建层必经之路
        if let bs = n["boxShadow"] as? [String: Any] { style["boxShadow"] = bs }
        // ★★★text-shadow 项（2026-10-08）：文本阴影（结构化对象）透传——本函数是建层必经之路
        if let ts = n["textShadow"] as? [String: Any] { style["textShadow"] = ts }
        // ★★C1/B（2026-10-01）：两个**内核动画的静态基态**必须透传（本函数是建层必经之路）——
        //   `clipPath`（裁剪形状：类型 + 基态参数，mask 的来源）/ `perspective`（3D 透视距离）。
        //   ★漏透传的后果（真机实测抓到）：内核里动画被受理（started=4）但宿主读不到声明 ⇒
        //     mask 根本不建 ⇒ 探针 clipBox 全空；且透视此前同样漏（3D 立体感缺失，无人发现）。
        //   ⇒ 本函数"一处实现"的白名单必须跟着**内核新增的静态样式**走。
        if let cp = n["clipPath"] as? [String: Any] { style["clipPath"] = cp }
        if let pp = n["perspective"] as? Double { style["perspective"] = CGFloat(pp) }
        // ★★渐变（v1 静态 paint——2026-10-01）：同"必须透传"纪律（本函数是建层必经之路）
        //   ★漏透传的后果与 clipPath 同款：声明在请求树里而宿主读不到 ⇒ **静默不渲染**。
        if let fg = n["fillGradient"] as? [String: Any] { style["fillGradient"] = fg }
        // ★★★背景定位家族（2026-10-07）：size/position/repeat 必须透传（本函数=建层必经之路；
        //   漏透传 ⇒ 渐变层 frame 拿不到图像盒 ⇒ 静默按元素盒（clipPath/fillGradient 同款教训）。
        // ★★★outline 族项（2026-10-08）：轮廓四键必须透传（建层必经之路；漏 ⇒ 静默不画）
        for k in ["outlineWidth", "outlineColor", "outlineStyle"] {
            if let v = n[k] as? String { style[k] = v }
        }
        if let ow = n["outlineWidth"] as? Double { style["outlineWidth"] = CGFloat(ow) }
        if let ow = n["outlineWidth"] as? CGFloat { style["outlineWidth"] = ow }
        if let oo = n["outlineOffset"] as? Double { style["outlineOffset"] = CGFloat(oo) }
        if let oo = n["outlineOffset"] as? CGFloat { style["outlineOffset"] = oo }
        for k in ["backgroundSize", "backgroundPosition", "backgroundRepeat"] {
            if let v = n[k] as? String { style[k] = v }
        }
        // ★v2：B 态（两态混合的终点）——同"必须透传"纪律
        if let fg2 = n["fillGradientTo"] as? [String: Any] { style["fillGradientTo"] = fg2 }
        // ★★C2：SVG 描边三键（路径段列表 / 描边色 / 线宽）——同"必须透传"纪律
        if let sp = n["svgPath"] as? [String: Any] { style["svgPath"] = sp }
        // ★★路径变形 v1：B 态（`svgPathTo`）——同"必须透传"纪律（漏 ⇒ 内核拒变形且静默）
        if let sp2 = n["svgPathTo"] as? [String: Any] { style["svgPathTo"] = sp2 }
        if let sc = n["strokeColor"] as? NSNumber { style["strokeColor"] = sc }
        if let sw = n["strokeWidth"] as? Double { style["strokeWidth"] = CGFloat(sw) }
        // ★★A/B 实测抓出的**白名单漏项**（2026-10-03）：`glow` 与 `mask` 声明在请求树里而
        //   `styleOf` 未透传 ⇒ **静默不渲染**（与 clipPath/fillGradient 曾经的同款缺陷——
        //   "白名单必须跟着内核新增的静态样式走"这条纪律此处又漏了两项）。
        //   ★抓出方式：A/B 的通道签名对照（iOS 4/5 vs Android 5/5）——**跨端对照就是这块的探针**。
        if let gl = n["glow"] as? [String: Any] { style["glow"] = gl }
        if let mk = n["mask"] as? [String: Any] { style["mask"] = mk }
        return style
    }

    /// ★取某节点建层时记录的 **fontFamily**（文本补丁的度量要用它——与绘制同源）
    func fontFamilyOf(id: Int) -> String? {
        metaByNodeId[id]?["fontFamily"] as? String
    }

    /// ★★★逐边 border 批：同步**全部**已物化层的边框子层（render 出口调用一次；O(层数)，只碰有子层的）。
    /// ★★★背景定位家族（2026-10-07）：把每个渐变子层的 frame 设为**图像盒**（size/position）；
    ///   未声明 ⇒ 整个节点盒。★这是 iOS 渐变可见性的关键：CAGradientLayer 端点/径向是**单位空间**，
    ///   只认本层 bounds；建层时父 bounds 尚为 0 ⇒ 必须在**布局后**统一重设（多条建层路径同享一次）。
    func syncGradientFrames() {
        // ① 非平铺（CAGradientLayer）：frame = 图像盒
        for (id, g) in layerGradients {
            // g.superlayer = 裁剪容器 clip；clip.superlayer = 节点层（元素盒尺寸）
            guard let clip = g.superlayer, let node = clip.superlayer else { continue }
            let element = CGRect(origin: .zero, size: node.bounds.size)
            clip.frame = element
            let st = metaByNodeId[id]
            g.frame = Self.bgImageFrame(size: st?["backgroundSize"] as? String,
                                        pos: st?["backgroundPosition"] as? String, bounds: element) ?? element
        }
        // ② 平铺（repeat）：tile 层 = 元素盒；内容 = 栅格化渐变砖按 size/position 平铺
        for (id, tile) in layerGradientTiles {
            guard let clip = tile.superlayer, let node = clip.superlayer else { continue }
            let element = CGRect(origin: .zero, size: node.bounds.size)
            clip.frame = element
            tile.frame = CGRect(origin: .zero, size: element.size)
            let st = metaByNodeId[id]
            let iw = Self.bgLenOf(st?["backgroundSize"] as? String, axis: 0, base: element.width)
            let ih = Self.bgLenOf(st?["backgroundSize"] as? String, axis: 1, base: element.height)
            guard iw > 0, ih > 0 else { continue }
            let pos = Self.bgOffsetOf(st?["backgroundPosition"] as? String, box: element.size, img: CGSize(width: iw, height: ih))
            let img = Self.rasterTile(spec: st?["fillGradient"] as? [String: Any] ?? [:], size: CGSize(width: iw, height: ih), scale: UIScreen.main.scale)
            UIGraphicsBeginImageContextWithOptions(element.size, false, UIScreen.main.scale)
            if let ctx = UIGraphicsGetCurrentContext(), let tileImg = img, let cg = tileImg.cgImage {
                // 相位 = position 偏移（CTM 平移后从原点平铺 ⇒ 砖栅格对齐到偏移处，铺满 clip 区）
                ctx.saveGState()
                ctx.translateBy(x: pos.x, y: pos.y)
                ctx.draw(cg, in: CGRect(x: 0, y: 0, width: iw, height: ih), byTiling: true)
                ctx.restoreGState()
            }
            let composed = UIGraphicsGetImageFromCurrentImageContext()
            UIGraphicsEndImageContext()
            tile.contents = composed?.cgImage
        }
    }

    /// 取 size 的某轴长度（0=w 1=h；% = 相对 base；auto/缺省 = base）
    static func bgLenOf(_ size: String?, axis: Int, base: CGFloat) -> CGFloat {
        guard let s = size else { return base }
        let toks = s.split(separator: " ").map(String.init)
        let t: String
        if axis == 0 { t = toks.first ?? "auto" } else { t = toks.count >= 2 ? toks[1] : "auto" }
        if t == "auto" { return base }
        if t.hasSuffix("%") { return (CGFloat(Double(t.dropLast()) ?? 0) / 100) * base }
        if t.hasSuffix("px") { return CGFloat(Double(t.dropLast(2)) ?? 0) }
        return CGFloat(Double(t) ?? 0)
    }
    /// 取 position 偏移（%= pct×(盒−图)；关键字；px）
    static func bgOffsetOf(_ pos: String?, box: CGSize, img: CGSize) -> CGPoint {
        guard let p = pos else { return .zero }
        let toks = p.split(separator: " ").map(String.init)
        var x = "0", y = "0"
        if toks.count == 1 {
            if toks[0] == "top" || toks[0] == "bottom" { x = "center"; y = toks[0] }
            else { x = toks[0]; y = "center" }
        } else if toks.count >= 2 { x = toks[0]; y = toks[1] }
        func one(_ t: String, _ b: CGFloat, _ i: CGFloat) -> CGFloat {
            if t == "left" || t == "top" { return 0 }
            if t == "right" || t == "bottom" { return b - i }
            if t == "center" { return (b - i) / 2 }
            if t.hasSuffix("%") { return (CGFloat(Double(t.dropLast()) ?? 0) / 100) * (b - i) }
            if t.hasSuffix("px") { return CGFloat(Double(t.dropLast(2)) ?? 0) }
            return CGFloat(Double(t) ?? 0)
        }
        return CGPoint(x: one(x, box.width, img.width), y: one(y, box.height, img.height))
    }
    /// 把渐变栅格化成一张 `size`(pt) 的图（tile 源；applyGradient 复用同一几何公式）
    static func rasterTile(spec: [String: Any], size: CGSize, scale: CGFloat) -> UIImage? {
        guard size.width > 0, size.height > 0 else { return nil }
        UIGraphicsBeginImageContextWithOptions(size, false, scale)
        defer { UIGraphicsEndImageContext() }
        let gl = CAGradientLayer()
        gl.frame = CGRect(origin: .zero, size: size)
        if applyGradient(gl, spec: spec, bounds: gl.bounds) {
            let c = UIGraphicsGetCurrentContext()!
            // ★★★必须翻转 CTM 再 render（2026-10-08 · 用户抓出「App 案例 C：iOS 平铺方向反了」）：
            //   CoreGraphics 原点在**左下**（y 向上），UIKit/图层坐标在**左上**（y 向下）——
            //   `UIGraphicsBeginImageContextWithOptions` 给的上下文**未翻转**，直接 `layer.render` 会把像素
            //   **上下颠倒**。对 `linear-gradient(45deg, …)` 这类**非对称**砖块 ⇒ 相位镜面（"\" 变 "/"），
            //   棋盘平铺方向随之反了。与下方手建 CGContext 的同款修复（本仓既有实测）。
            c.translateBy(x: 0, y: size.height)
            c.scaleBy(x: 1, y: -1)
            gl.render(in: c)
        }
        return UIGraphicsGetImageFromCurrentImageContext()
    }

    func syncAllSideBorders() {
        for (_, layer) in layersById {
            guard layer.sublayers != nil else { continue }
            SelfDrawView.syncSideBorderFrames(layer)
            // ★★★outline 族项（2026-10-08）：轮廓环随父 bounds 重算（同逐边 border 的集中同步机制）
            let b = layer.bounds
            for sub in layer.sublayers ?? [] {
                if let sh = sub as? CAShapeLayer, (sh.name?.hasPrefix("proteus-outline-") ?? false) {
                    SelfDrawView.syncOutlineFrame(sh, bounds: b)
                }
            }
            for sub in layer.sublayers ?? [] {
                if let sh = sub as? CAShapeLayer, (sh.name?.hasPrefix("proteus-border-uniform-dot-") ?? false) {
                    SelfDrawView.syncBorderUniformDot(sh, bounds: b, radius: layer.cornerRadius)
                }
            }
        }
    }

    /// 全部已物化节点 id（探针缺省作用域）
    func allNodeIds() -> [Int] { Array(layersById.keys).sorted() }

    /// 取节点对应的层（探针用——`layersById` 是 private）
    func layerFor(id: Int) -> CALayer? { layersById[id] }

    /// ★节点在**屏幕坐标**下的 rect（内容坐标 − 内容偏移）——供像素/布局探针
    func screenRect(of id: Int) -> CGRect? {
        guard let abs = rectsByNodeId[id] else { return nil }
        return abs.offsetBy(dx: -contentOffset.x, dy: -contentOffset.y)
    }

    /// ★★**复用层时必须清空全部可绘制属性**（本仓纪律：复用 = 完全重配，不是"覆盖部分字段"）
    ///
    /// 【为什么（复用池最容易出的静默错）】被复用的层带着**上一个节点的外观**：
    ///   容器层若原带 `cornerRadius=18`，而新节点没有 borderRadius ⇒ 若不清零，
    ///   新行会**多出圆角**（几何全对、像素错）——而"多圆角"这种差异只有像素比对能发现。
    private func configureLayer(_ layer: CALayer, style: [String: Any], boxWidth: CGFloat = 0) {
        let text = (style["text"] as? String) ?? ""
        if let tl = layer as? CATextLayer {
            if text.isEmpty {
                tl.string = ""            // 防御：文本层被复用成容器（类型已在 acquireLayer 过滤）
            } else {
                let fs = (style["fontSize"] as? CGFloat) ?? 14
                let fw = (style["fontWeight"] as? CGFloat) ?? 400
                // ★★全端对齐批（2026-10-05 · white-space 五端对齐）：复用路径同配（复用 = 完全重配）
                // ★★★word-break:normal（2026-10-09）：effectiveWrap 须先于 clamped/string
                let wrapMode2 = SelfDrawView.effectiveWrap(style, text: text, boxWidth: boxWidth)
                // ★★★line-clamp 项（2026-10-08）：多行截断——按盒宽预截断（与 makeLayer 同源）
                let clamped = SelfDrawView.clampedText(text, style: style, boxWidth: boxWidth)
                tl.string = clamped
                tl.font = ProteusTextAdapter.cgFont(of: ProteusTextAdapter.font(
                    size: fs, weight: fw,
                    family: (style["fontFamily"] as? String) ?? "system"))
                tl.fontSize = fs
                tl.foregroundColor = (style["color"] as? String).flatMap(parseHexColor)?.cgColor
                    ?? UIColor.white.cgColor
                tl.string = textLayerString(clamped, style: style, font: ProteusTextAdapter.font(size: fs, weight: fw, family: (style["fontFamily"] as? String) ?? "system"), color: (style["color"] as? String).flatMap(parseHexColor)?.cgColor ?? UIColor.white.cgColor, wrapOverride: wrapMode2)
                tl.alignmentMode = alignmentMode(style["textAlign"] as? String)
                tl.truncationMode = (!wrapMode2 && (style["textOverflow"] as? String) == "ellipsis") ? .end : .none
                tl.isWrapped = wrapMode2
                // ★★★行高修复（复用 = 完全重配：useCoreText 也必须重配，否则复用层残留上一节点的绘制方式）
                // ★★★word-break:normal（2026-10-09）：同上——仅在实际换行时用 CoreText
                (tl as? ProteusTextLayer)?.useCoreText = SelfDrawView.needsCoreText(style) && wrapMode2
                tl.contentsScale = UIScreen.main.scale
            }
            // ★★复用路径**必须同样重配**（纪律：复用 = 完全重配）——否则池里取出的层会
            //   保留**上一个节点**的存储格式（紧凑 ⇄ 通用不一致，且只在复用率高的滚动场景显形）
            SelfDrawBridge.applyPaintHint(tl, style: style)
        }
        // 非文本属性：**缺省即清零**（不留上一个节点的痕迹）
        layer.backgroundColor = (style["backgroundColor"] as? String).flatMap(parseHexColor)?.cgColor
        // ★批次 5：边框复用路径同样重配（缺省清零）
        applyBorder(layer, style: style)
        applyOutline(layer, style: style)
        // ★批次 10：盒阴影复用路径同样重配（缺省清零）
        let hasShadow2 = (style["boxShadow"] as? [String: Any]) != nil
        applyShadow(layer, style: style)
        let r = (style["borderRadius"] as? CGFloat) ?? 0
        layer.cornerRadius = r
        // ★★★overflow-x 项（2026-10-06）：裁剪判据 = overflow/clipText（**圆角不隐含 mask**——见
        //   makeLayer 的同款注释：圆角 mask 会误裁 overflow:visible 的溢出子层，与 Web 不符）
        layer.masksToBounds = Self.isOverflowClipped(style) || isClipTextStyle(style)
        applyRadiusCorners(layer, style: style)   // ★批次 34：逐角圆角（部分角需 mask——内部处理）
        layer.opacity = 1
    }

    /// ★批次 13（line-height，CSS **半行距居中**）：CATextLayer 是**顶对齐**绘制的
    ///   （实测：层高 100/200、字号 20 ⇒ 墨迹都固定 [5,23]，不随层高居中）——
    ///   要实现 Web/Skyline 的真 CSS 语义（行盒变高 ⇒ 字形内容区垂直居中），
    ///   需把**文本层的可视 frame 居中收缩**：可视高 = 字形内容高，中心与行盒一致
    ///   （中心不变 ⇒ 以**层中心为锚**的 transform 动画不受影响；rects 探针仍报原始行盒）。
    ///   `lineHeight<=0`（未声明）⇒ 原样返回（既有路径零行为变化）。
    private func lineBoxFrame(_ f: CGRect, style: [String: Any]) -> CGRect {
        // ★★★text 内间距批（2026-10-09 · 用户抓出「App 端 text 的 padding-left 被丢弃」）：
        //   文本可视/折行盒 = **内容盒**（border 盒内缩 padding）——文字自 padding 内缘起排、
        //   折行宽 = 盒宽 − padding-left − padding-right（Web 真值）。此前从**盒原点**绘制
        //   ⇒ padding 静默丢弃（与 Web 不符）。
        //   ★**只对文本节点**内缩（非文本节点的 padding 是容器内部布局，不移动其自身 frame——
        //     否则容器被内缩 ⇒ 透出宿主底/尺寸错，真机抓出）。
        guard let text = style["text"] as? String, !text.isEmpty else { return f }
        let cbf = SelfDrawView.contentBox(f, style: style)
        // ★★★word-break:normal（2026-10-09 · 独立复评抓出 iOS 裁切）：CATextLayer **只在自身 bounds 内绘制**
        //   ⇒ 单行溢出（normal 长串 / nowrap 无 clip/ellipsis）若不**加宽可视 frame**，溢出部分被裁掉
        //   （与 Web「溢出不裁」不符；Android/鸿蒙在共享画布上绘制故无此问题）。
        //   判据：单行渲染（非 effectiveWrap）∧ 非裁切/省略 ∧ 自然宽 > 内容盒宽 ⇒ 加宽到自然宽（按对齐锚点）。
        if !isClipTextStyle(style), (style["textOverflow"] as? String) != "ellipsis",
           !SelfDrawView.effectiveWrap(style, text: text, boxWidth: f.width) {
            let fs0 = (style["fontSize"] as? CGFloat) ?? 14
            let fw0 = (style["fontWeight"] as? CGFloat) ?? 400
            let fam0 = (style["fontFamily"] as? String) ?? "system"
            let kern0 = (style["letterSpacing"] as? Double).map({ CGFloat($0) }) ?? (style["letterSpacing"] as? CGFloat) ?? 0
            let natW = ProteusTextAdapter.measureText(text, fontSize: fs0, fontWeight: fw0, fontFamily: fam0, letterSpacing: kern0).width
            if natW > cbf.width + 0.5 {
                let am = alignmentMode(style["textAlign"] as? String)
                let ox: CGFloat = am == .center ? cbf.midX - natW / 2 : (am == .right ? cbf.maxX - natW : cbf.minX)
                return CGRect(x: ox, y: cbf.origin.y, width: natW, height: cbf.height)
            }
        }
        // ★★第三轮复评修复（2026-10-05）：半行距居中收缩**只对实际单行**生效——
        //   判据不看声明（缺省=normal 后大多数文本都算 wrap），而是**量**：单行文本宽 ≤ 盒宽
        //   ⇒ 收缩居中（与既有 batch 13 行为一致）；超宽的（真的会折行）⇒ 保持整盒
        //   （多行行距由段落样式控，收缩会裁掉后续行）。
        if !text.isEmpty {
            if text.contains("\n") { return cbf }
            let fs2 = (style["fontSize"] as? CGFloat) ?? 14
            let fw2 = (style["fontWeight"] as? CGFloat) ?? 400
            let fam2 = (style["fontFamily"] as? String) ?? "system"
            let kern2 = (style["letterSpacing"] as? Double).map({ CGFloat($0) }) ?? (style["letterSpacing"] as? CGFloat) ?? 0
            var attrs2: [NSAttributedString.Key: Any] = [.font: ProteusTextAdapter.font(size: fs2, weight: fw2, family: fam2)]
            if kern2 != 0 { attrs2[.kern] = kern2 }
            let single = (text as NSString).size(withAttributes: attrs2).width
            if single > cbf.width + 0.5 { return cbf }
        }
        guard let lhTok = style["lineHeight"] as? String,
              let boxH = ProteusTextAdapter.lineHeightPx(lhTok, fontSize: (style["fontSize"] as? CGFloat) ?? 14),
              boxH > 0 else { return cbf }
        let fw = (style["fontWeight"] as? CGFloat) ?? 400
        let fam = (style["fontFamily"] as? String) ?? "system"
        let contentH = ProteusTextAdapter.font(size: (style["fontSize"] as? CGFloat) ?? 14, weight: fw, family: fam).lineHeight
        guard contentH > 0 else { return cbf }
        let cy = cbf.origin.y + boxH * 0.5   // 行盒中心（= 内容盒 minY + boxH/2）
        return CGRect(x: cbf.origin.x, y: cy - contentH * 0.5, width: cbf.width, height: contentH)
    }

    /// ★★★text 内间距批（2026-10-09）：**内容盒** = border 盒内缩 `padding`。
    ///   文本层可视/折行盒据此内缩（padding 为 0/缺省 ⇒ 原样，零行为变化）。
    static func contentBox(_ f: CGRect, style: [String: Any]) -> CGRect {
        guard let p = style["padding"] as? [String: Any] else { return f }
        func edge(_ k: String) -> CGFloat {
            if let d = p[k] as? Double { return CGFloat(d) }
            if let c = p[k] as? CGFloat { return c }
            return 0
        }
        let l = edge("left"), t = edge("top"), r = edge("right"), b = edge("bottom")
        if l == 0 && t == 0 && r == 0 && b == 0 { return f }
        let w = max(1, f.width - l - r), h = max(1, f.height - t - b)
        return CGRect(x: f.origin.x + l, y: f.origin.y + t, width: w, height: h)
    }

    /// ★批次 18（CSS 兼容对齐 · 以 Web 为基准）：`border-radius` **百分比** → `cornerRadius`。
    ///   半径 = `pct × min(w, h)`：正方盒 = 精确内切圆（与 Web `border-radius:50%` 一致）；
    ///   非正方盒为统一圆角（Web 为椭圆——如实近似边界）。仅在**声明了** `borderRadiusPct` 时生效（零行为变化）。
    private func applyRadiusPct(_ layer: CALayer, style: [String: Any], size: CGSize) {
        guard let pct = style["borderRadiusPct"] as? CGFloat, pct > 0 else { return }
        let r = pct * min(size.width, size.height)
        layer.cornerRadius = r
        // ★★★overflow-x 项（2026-10-06）：不再隐含 mask（同 borderRadius——圆角只作用于背景/边框；
        //   裁剪由 overflow/clipText 决定，与 Web 对齐）
        layer.masksToBounds = Self.isOverflowClipped(style) || isClipTextStyle(style)
    }

    /// ★批次 34（对齐 Web）：逐角圆角——`borderRadiusCorners` 掩码（bit0=TL/1=TR/2=BR/3=BL）→ CALayer.maskedCorners。
    ///   缺省（无掩码）⇒ 保持全部四角（既有行为）；调用方须已设 `cornerRadius`。
    private func applyRadiusCorners(_ layer: CALayer, style: [String: Any]) {
        guard let m = style["borderRadiusCorners"] as? [String: Any] else {
            // ★★★边框族收口批（2026-10-05）：**缺省即复位**（"复用 = 完全重配"纪律）——
            //   此前 guard 直接 return ⇒ 复用的层会残留**上一节点**的 maskedCorners（掩码静默串台）。
            layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner, .layerMaxXMaxYCorner, .layerMinXMaxYCorner]
            return
        }
        var c: CACornerMask = []
        if (m["topLeft"] as? Bool) == true { c.insert(.layerMinXMinYCorner) }
        if (m["topRight"] as? Bool) == true { c.insert(.layerMaxXMinYCorner) }
        if (m["bottomRight"] as? Bool) == true { c.insert(.layerMaxXMaxYCorner) }
        if (m["bottomLeft"] as? Bool) == true { c.insert(.layerMinXMaxYCorner) }
        layer.maskedCorners = c
        layer.masksToBounds = true   // 部分圆角需要裁剪
    }

    /// ★批次 20（CSS 兼容对齐 · 以 Web 为基准）：文本层的 `string` 值——声明 `letterSpacing` 时用
    ///   带 `kern` 的 `NSAttributedString`（字距真生效）；未声明 ⇒ 返回原字符串（零行为变化）。
    private func textLayerString(_ text: String, style: [String: Any], font: UIFont, color: CGColor, wrapOverride: Bool? = nil) -> Any {
        // ★批次 35：文本装饰（underline / line-through）也走富文本属性
        let deco = style["textDecoration"] as? String
        let kern = (style["letterSpacing"] as? Double).map({ CGFloat($0) }) ?? (style["letterSpacing"] as? CGFloat) ?? 0
        // ★★全端对齐批（2026-10-05 · white-space 五端对齐）：wrap + line-height ⇒ **段落样式**
        //   行盒高 = lineHeight（CoreText 的 minimum/maximumLineHeight 即 CSS line-height 语义：
        //   字形在行盒内居中）；同时把对齐写进段落（多行的对齐由段落样式决定）。
        // ★★★word-break:normal（2026-10-09）：换行判定可由调用方传入（含"无断点长串溢出"抑制）
        let wrapMode = wrapOverride ?? SelfDrawView.isWrapStyle(style)
        var para: NSMutableParagraphStyle? = nil
        if wrapMode {
            let ps = NSMutableParagraphStyle()
            let fs = (style["fontSize"] as? CGFloat) ?? font.pointSize
            if let lhTok = style["lineHeight"] as? String,
               let boxH = ProteusTextAdapter.lineHeightPx(lhTok, fontSize: fs), boxH > 0 {
                ps.minimumLineHeight = boxH
                ps.maximumLineHeight = boxH
            }
            let am = alignmentMode(style["textAlign"] as? String)
            if am == .center { ps.alignment = .center }
            else if am == .right { ps.alignment = .right }
            else { ps.alignment = .left }
            // ★★★word-break 项（2026-10-06）：断词策略 → CoreText 段落 lineBreakMode。
            //   break-all ⇒ byCharWrapping（任意字符处可断）；其余（normal/break-word/缺省）⇒ byWordWrapping
            //   （词边界断；超长不可断词由 CoreText 自然溢出——与 Web normal 语义一致）。
            ps.lineBreakMode = (style["wordBreak"] as? String) == "break-all" ? .byCharWrapping : .byWordWrapping
            para = ps
        }
        if kern == 0 && (deco == nil || deco == "none") && para == nil { return text }
        var attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor(cgColor: color)]
        if kern != 0 { attrs[.kern] = kern }
        if let para = para { attrs[.paragraphStyle] = para }
        if deco == "underline" { attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue }
        else if deco == "line-through" { attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
        return NSAttributedString(string: text, attributes: attrs)
    }

    /// ★批次 25（CSS 兼容对齐 · 以 Web 为基准）：`visibility:hidden` ⇒ 层**仍占位、不显示**。
    ///   编译器已按继承把 hidden 传到全部后代 ⇒ 只需看本节点自身；CALayer 子层随父隐藏。
    private func applyVisibility(_ layer: CALayer, style: [String: Any]) {
        layer.isHidden = (style["visibility"] as? String) == "hidden"
    }

    /// ★批次 5（CSS 兼容对齐 · 边框）：uniform 边框 → `CALayer.borderWidth/borderColor`。
    ///   `borderWidth<=0` 或缺颜色 ⇒ 清零（缺省无边框，与既有路径零行为变化）。
    /// ★★★outline 族项（2026-10-08）：轮廓环 → 独立 CAShapeLayer 子层（画在盒 ± offset，可外扩/内缩）。
    ///   CALayer.border 是内缩边框，装不下 outline 的「盒外偏移」⇒ 单独子层 + 集中 sync（同逐边 border 机制）。
    private func applyOutline(_ layer: CALayer, style: [String: Any]) {
        removeOutline(layer)
        let ow = (style["outlineWidth"] as? CGFloat) ?? ((style["outlineWidth"] as? Double).map { CGFloat($0) } ?? 0)
        let oc = (style["outlineColor"] as? String).flatMap(parseHexColor)
        let os = (style["outlineStyle"] as? String) ?? "solid"
        guard ow > 0, let col = oc, os != "none" else { return }
        let sub = CAShapeLayer()
        // ★★★名字编码健壮化（2026-10-08 · 独立评审实测抓出 iOS offset 失效）：
        //   旧名 `proteus-outline-<ow>-<style>-<offset>` 用 `split("-")` 解析 ⇒ **两处缺陷**：
        //   ① 索引错位（读到 style 当 offset）；② 负 offset 的 "--" 被 split 吞掉 ⇒ 丢符号。
        //   ⇒ offset 编成 **无连字符**令牌 `op<abs>`（正）/ `om<abs>`（负），符号不丢。
        let ooff0 = (style["outlineOffset"] as? CGFloat) ?? ((style["outlineOffset"] as? Double).map { CGFloat($0) } ?? 0)
        let offKey = (ooff0 < 0 ? "om" : "op") + String(Int(abs(ooff0)))
        sub.name = "proteus-outline-\(ow)-\(os == "dashed" ? 1 : os == "dotted" ? 2 : 0)-\(offKey)"
        sub.strokeColor = col.cgColor
        sub.fillColor = nil
        sub.lineWidth = ow
        // ★★★dotted 沿**闭合周界均分**（周期在 sync 里按真实周长定——见 evenDashPeriod）；
        //   ★dashed 同理（原先也硬编码 3w/2w，接缝处同样不整除 ⇒ 一并均分）。
        if os == "dotted" { sub.lineCap = .round }
        else if os == "dashed" { sub.lineCap = .butt }
        layer.addSublayer(sub)
        Self.syncOutlineFrame(sub, bounds: layer.bounds)
    }
    private func removeOutline(_ layer: CALayer) {
        layer.sublayers?.filter { ($0.name?.hasPrefix("proteus-outline-") ?? false) }.forEach { $0.removeFromSuperlayer() }
    }
    /// 按父 bounds 重算轮廓环路径（frame 变化后由 render 出口集中调用）。
    static func syncOutlineFrame(_ sub: CAShapeLayer, bounds: CGRect) {
        // 名字：proteus-outline-<ow>-<style>-<offKey>（offKey = op2 / om3，无连字符 ⇒ 解析无歧义）
        //   parts[2]=ow · parts[3]=style(0/1/2) · parts[4]=offKey
        let parts = (sub.name ?? "").split(separator: "-")
        guard parts.count >= 5 else { return }
        let style = Int(parts[3]) ?? 0
        let ok = String(parts[4])
        let off: CGFloat = !ok.isEmpty && (ok.hasPrefix("op") || ok.hasPrefix("om"))
            ? ((ok.hasPrefix("om") ? -1 : 1) * (Double(ok.dropFirst(2)) ?? 0)) : 0
        sub.frame = bounds
        // ★★★outline 圆角跟随（2026-10-08 用户抓出）：环路径 = **圆角矩形**（半径 = 盒圆角 + offset − 线宽/2），
        //   与 Web 真值一致（Chrome outline 随 border-radius 圆角化）。
        let parentRadius = sub.superlayer?.cornerRadius ?? 0
        let rad = max(0, parentRadius + off - sub.lineWidth * 0.5)
        let r = CGRect(x: -off + sub.lineWidth * 0.5, y: -off + sub.lineWidth * 0.5,
                       width: bounds.width + off * 2 - sub.lineWidth, height: bounds.height + off * 2 - sub.lineWidth)
        // ★★★dotted/dashed 沿闭合周界均分（周期 = 周长/N ⇒ 起点处整除闭合、无「接缝双点」）
        if style == 2 {
            let per = SelfDrawView.evenDashPeriod(r.width, r.height, rad, sub.lineWidth * 2)
            let on = min(0.01, per * 0.25)
            sub.lineDashPattern = [NSNumber(value: Double(on)), NSNumber(value: Double(per - on))]
        } else if style == 1 {
            let per = SelfDrawView.evenDashPeriod(r.width, r.height, rad, sub.lineWidth * 5)
            let on = min(sub.lineWidth * 3, per * 0.5)
            sub.lineDashPattern = [NSNumber(value: Double(on)), NSNumber(value: Double(per - on))]
        } else {
            sub.lineDashPattern = nil
        }
        sub.path = CGPath(roundedRect: r, cornerWidth: rad, cornerHeight: rad, transform: nil)
    }

    /// 圆角矩形周长（解析式；r 钳到 min(w,h)/2）——dotted/dashed 均分的分母。
    static func roundedRectPerimeter(_ w: CGFloat, _ h: CGFloat, _ r: CGFloat) -> CGFloat {
        let rr = max(0, min(r, min(w, h) * 0.5))
        return 2 * (w + h) - 8 * rr + 2 * CGFloat.pi * rr
    }
    /// 周期 = 周长/N（N = round(周长/目标间距)）⇒ 闭合处整除、无接缝重影（同 Android evenDashPeriod）。
    static func evenDashPeriod(_ w: CGFloat, _ h: CGFloat, _ r: CGFloat, _ spacing: CGFloat) -> CGFloat {
        let per = roundedRectPerimeter(w, h, r)
        // I2-ALLOW: **装饰纹理离散计数**（非几何换算）——dotted/dashed 的**点数 N**取整（整数离散计数，
        //   用于让 dash 周期整除闭合周长；不流经排版几何，与坐标吸附无关）。
        let n = max(1, (per / max(0.1, spacing)).rounded())
        return per / n
    }

    private func applyBorder(_ layer: CALayer, style: [String: Any]) {
        // ★★★逐边 border 批（2026-10-05）：有逐边声明 ⇒ 走**四子层**通道（CALayer 原生只有 uniform）。
        //   子层用 `autoresizingMask` 随父 bounds 变化自适配（建造时父 bounds 可能为 0——
        //   初始 frame 只给"固定边界"（厚度），flexible 维度由 autoresizing 撑开）。
        let sides = SelfDrawView.sideBordersOf(style)
        if sides != nil {
            layer.borderWidth = 0 // 逐边时关闭 uniform（避免双画）
            // ★★★统一 dotted 边 → **单一（圆角）周界布点**（2026-10-08 用户抓出「dotted 四角重叠」）：
            //   四边各一子层逐点会在角上各放一点 ⇒ 两圆叠成斑块；改为沿一条圆角周界连续布点。
            let s = sides!
            var uniform = s.count == 4
            if uniform { for e in s { if e.0 <= 0 || e.1 == nil || e.2 != "dotted" { uniform = false } } }
            if uniform { for e in s { if e.0 != s[0].0 || (e.1?.components) != (s[0].1?.components) { uniform = false } } }
            if uniform {
                removeSideBorderSublayers(layer)
                let bw = s[0].0
                let sub = CAShapeLayer()
                sub.name = "proteus-border-uniform-dot-\(bw)"
                sub.strokeColor = s[0].1
                sub.fillColor = nil
                sub.lineWidth = bw
                sub.lineCap = .round   // dotted 的 dash 周期在 sync 里按真实周长均分（见 syncBorderUniformDot）
                layer.addSublayer(sub)
                Self.syncBorderUniformDot(sub, bounds: layer.bounds, radius: layer.cornerRadius)
                return
            }
            applySideBorderSublayers(layer, sides: sides!)
            return
        }
        removeSideBorderSublayers(layer)
        let bw = (style["borderWidth"] as? CGFloat) ?? 0
        if bw > 0, let bc = (style["borderColor"] as? String).flatMap(parseHexColor) {
            layer.borderWidth = bw
            layer.borderColor = bc.cgColor
        } else {
            layer.borderWidth = 0
        }
    }

    /// ★★★逐边 border 批：读逐边字段 → 四元组（nil = 无逐边声明）。
    ///   值 = (width, colorHex?)；width ≤ 0 或颜色缺 ⇒ 该边不画。
    static func sideBordersOf(_ style: [String: Any]) -> [(CGFloat, CGColor?, String)]? {
        // ★★★边框族收口批（2026-10-05）：三键（宽/色/线型）
        let keys: [(String, String, String)] = [
            ("borderTopWidth", "borderTopColor", "borderTopStyle"), ("borderRightWidth", "borderRightColor", "borderRightStyle"),
            ("borderBottomWidth", "borderBottomColor", "borderBottomStyle"), ("borderLeftWidth", "borderLeftColor", "borderLeftStyle"),
        ]
        var any = false
        for (wk, _, _) in keys where style[wk] != nil { any = true; break }
        if !any { for (_, ck, _) in keys where style[ck] != nil { any = true; break } }
        if !any { for (_, _, sk) in keys where style[sk] != nil { any = true; break } }
        guard any else { return nil }
        // ★★★回落（2026-10-05 · 真机抓到"线型全不显示"）：逐边键缺省 ⇒ **回落 uniform**——
        //   `border: 2px dashed #5b5bd6` 只落 `borderWidth/borderColor` + 逐边 **Style**，
        //   逐边 Width/Color 键**不存在** ⇒ 首版把 w 读成 0 ⇒ `continue` 跳过 ⇒ 边框不画。
        let defW = (style["borderWidth"] as? CGFloat) ?? ((style["borderWidth"] as? Double).map { CGFloat($0) } ?? 0)
        let defCol = (style["borderColor"] as? String).flatMap(parseHexColor)?.cgColor
        return keys.map { (wk, ck, sk) in
            let w = (style[wk] as? CGFloat) ?? ((style[wk] as? Double).map { CGFloat($0) } ?? defW)
            let col = (style[ck] as? String).flatMap(parseHexColor)?.cgColor ?? defCol
            let st = (style[sk] as? String) ?? "solid"
            return (w, col, st)
        }
    }

    /// ★★★逐边 border 批：更新四个边框子层（幂等：先移除旧的再建）。
    ///   【为什么不用 `autoresizingMask`（首版编译红：iOS 上该 API **不可用**——那是 macOS 的）】
    ///   iOS 的 CALayer 没有自动布局 ⇒ 子层 frame 由 `syncSideBorderFrames` **集中同步**：
    ///   厚度存进 `sub.bounds`（与方向无关的立方体），frame 由父 bounds 每次重算。
    /// ★★★统一 dotted 边：单条圆角周界布点（四角不重叠）。frame 随父 bounds/圆角由 syncAllSideBorders 集中重算。
    static func syncBorderUniformDot(_ sub: CAShapeLayer, bounds: CGRect, radius: CGFloat) {
        sub.frame = bounds
        let parts = (sub.name ?? "").split(separator: "-")
        let bw = parts.count >= 5 ? CGFloat(Double(parts[4]) ?? 0) : sub.lineWidth
        let r = max(0, radius - bw * 0.5)
        let ins = bw * 0.5
        let pw = bounds.width - bw, ph = bounds.height - bw
        // ★★★dotted 沿闭合周界均分（周期 = 周长/N ⇒ 起点处整除闭合、无「接缝双点」）
        let per = SelfDrawView.evenDashPeriod(pw, ph, r, bw * 2)
        let on = min(0.01, per * 0.25)
        sub.lineDashPattern = [NSNumber(value: Double(on)), NSNumber(value: Double(per - on))]
        sub.path = CGPath(roundedRect: CGRect(x: ins, y: ins, width: pw, height: ph), cornerWidth: r, cornerHeight: r, transform: nil)
    }

    private func applySideBorderSublayers(_ layer: CALayer, sides: [(CGFloat, CGColor?, String)]) {
        removeSideBorderSublayers(layer)
        // 顺序：0=top 1=right 2=bottom 3=left；用 name 前缀标记（层复用/重建时清理）
        for i in 0..<4 {
            let (w, col, st) = sides[i]
            if w <= 0 || col == nil { continue }
            // ★★★45° 斜接改造 v2（2026-10-05 · 用户抓出「案例E没有封边」）：CAShapeLayer 多边形。
            //   【为什么】前一版用矩形子层（重叠式）⇒ 角上「横线延伸超出竖线」（与 Web 的 45° 斜接不同）；
            //   且 iOS 无自动布局 ⇒ frame/path 都靠 sync 集中更新。厚度编码进 name（见前版注释的教训）。
            let sub = CAShapeLayer()
            // 名字承载 idx / 厚度 / 线型（1=dashed / 2=dotted）
            let stCode = st == "dashed" ? 1 : st == "dotted" ? 2 : 0
            sub.name = "proteus-side-border-\(i)-\(w)-\(stCode)"
            sub.fillColor = col
            // ★★★边框族收口批：颜色存进 **fillColor（solid 填充）与 strokeColor（dash 描边）**；
            //   ★不得用 `backgroundColor`（它会**填充整个 bounds** ⇒ E 案例被整块填色——真机抓到）。
            sub.strokeColor = col
            layer.addSublayer(sub)
        }
        Self.syncSideBorderFrames(layer)
    }

    /// ★★★逐边 border 批：按父 bounds 重算边框子层 frame（i=0..3 ⇒ top/right/bottom/left）。
    ///   【为什么必须有】iOS CALayer 无自动布局（见上）⇒ 父层 frame 变化后由宿主**集中调用**
    ///   （`render` 的两个出口：增量回包前 / 全量建层后——覆盖全部 frame 变更路径）。
    static func syncSideBorderFrames(_ layer: CALayer) {
        guard let subs = layer.sublayers else { return }
        let b = layer.bounds
        // ★★★45° 斜接：先收集四边厚度（未声明的边 = 0），再给每块画多边形。
        //   几何与 Android/Web 同一口径：外框 (x0,y0)-(x1,y1)；内角 = (x0+wl, y0+wt) / (x1-wr, y1-wb)。
        var ws: [CGFloat] = [0, 0, 0, 0]
        var stCodes: [Int] = [0, 0, 0, 0]
        var shapes: [(Int, CAShapeLayer)] = []
        for sub in subs {
            guard let nm = sub.name, nm.hasPrefix("proteus-side-border-") else { continue }
            let parts = nm.split(separator: "-")
            guard parts.count >= 5, let idx = Int(parts[3]), let tv = Double(parts[4]), idx >= 0, idx < 4 else { continue }
            ws[idx] = CGFloat(tv)
            stCodes[idx] = parts.count >= 6 ? (Int(parts[5]) ?? 0) : 0
            if let sh = sub as? CAShapeLayer { shapes.append((idx, sh)) }
        }
        let (wt, wr, wb, wl) = (ws[0], ws[1], ws[2], ws[3])
        let x0 = b.minX, y0 = b.minY, x1 = b.maxX, y1 = b.maxY
        let ix0 = x0 + wl, iy0 = y0 + wt
        let ix1 = x1 - wr, iy1 = y1 - wb
        for (idx, sh) in shapes {
            sh.frame = b
            let st = stCodes[idx]
            let wI = ws[idx]
            let p = UIBezierPath()
            if st == 0 {
                // solid：梯形填充（45° 斜接——与 Web/Android 同构）
                switch idx {
                case 0:
                    p.move(to: CGPoint(x: x0, y: y0)); p.addLine(to: CGPoint(x: x1, y: y0))
                    p.addLine(to: CGPoint(x: ix1, y: iy0)); p.addLine(to: CGPoint(x: ix0, y: iy0))
                case 1:
                    p.move(to: CGPoint(x: x1, y: y0)); p.addLine(to: CGPoint(x: x1, y: y1))
                    p.addLine(to: CGPoint(x: ix1, y: iy1)); p.addLine(to: CGPoint(x: ix1, y: iy0))
                case 2:
                    p.move(to: CGPoint(x: x1, y: y1)); p.addLine(to: CGPoint(x: x0, y: y1))
                    p.addLine(to: CGPoint(x: ix0, y: iy1)); p.addLine(to: CGPoint(x: ix1, y: iy1))
                default:
                    p.move(to: CGPoint(x: x0, y: y1)); p.addLine(to: CGPoint(x: x0, y: y0))
                    p.addLine(to: CGPoint(x: ix0, y: iy0)); p.addLine(to: CGPoint(x: ix0, y: iy1))
                }
                p.close()
                // ★★★幂等修复（2026-10-05 · 真机抓到 E 案例四边消失）：**不得清 strokeColor**——
                //   它是颜色的**唯一存储**（fillColor 从它取）；首版清了 ⇒ 第二次 sync 时
                //   `fillColor = strokeColor(nil)` ⇒ 边框全消失（紫线只 sync 过一次才幸存）。
                //   ⇒ strokeColor 保持不变；solid 只把 lineWidth 置 0（不描边、纯填充）。
                sh.fillColor = sh.strokeColor
                sh.lineWidth = 0
                sh.lineDashPattern = nil
            } else if st == 2 {
                // ★★★dotted ⇒ **圆点网格**（决策 #559 修复轮——ROUND-cap 虚线端点外溢 w/2 且与封角块
                //   叠成合并斑块，独立评审逐像素 profile 抓出）：首末点**贴边**（圆心距端 w/2）、
                //   中段等距（step ≈ 2w）；单层多圆 path 填充（颜色仍存 strokeColor，幂等纪律）。
                //   对齐 mp/鸿蒙"贴边单圆点"形态（用户选定的标准蓝本）。
                var ax = x0, ay = y0 + wI * 0.5, bx = x1, by = y0 + wI * 0.5
                switch idx {
                case 1: ax = x1 - wI * 0.5; ay = y0; bx = x1 - wI * 0.5; by = y1
                case 2: ax = x0; ay = y1 - wI * 0.5; bx = x1; by = y1 - wI * 0.5
                case 3: ax = x0 + wI * 0.5; ay = y0; bx = x0 + wI * 0.5; by = y1
                default: break
                }
                let ddx = bx - ax, ddy = by - ay
                let len = (ddx * ddx + ddy * ddy).squareRoot()
                var r = wI * 0.5
                var dots = UIBezierPath()
                if len <= wI {
                    dots.append(UIBezierPath(ovalIn: CGRect(x: ax + ddx * 0.5 - r, y: ay + ddy * 0.5 - r, width: wI, height: wI)))
                } else {
                    // I2-ALLOW: **装饰纹理离散计数**（非几何换算）——dotted 点数取整（决策 #559 圆点网格）；
                    //   几何坐标均来自内核未再舍入，此处仅决定纹理离散分布。
                    let nSeg = max(1, Int(((len - wI) / (wI * 2)).rounded()))
                    let step = (len - wI) / CGFloat(nSeg)
                    let ux = ddx / len, uy = ddy / len
                    for k in 0...nSeg {
                        let d = r + CGFloat(k) * step
                        dots.append(UIBezierPath(ovalIn: CGRect(x: ax + ux * d - r, y: ay + uy * d - r, width: wI, height: wI)))
                    }
                }
                sh.path = dots.cgPath
                sh.fillColor = sh.strokeColor
                sh.lineWidth = 0
                sh.lineDashPattern = nil
                continue
            } else {
                // ★★★dashed（Chrome 角部真值=实心起笔）：中线描边 + lineDashPattern（相位 0，BUTT cap）
                switch idx {
                case 0:
                    p.move(to: CGPoint(x: x0, y: y0 + wI * 0.5)); p.addLine(to: CGPoint(x: x1, y: y0 + wI * 0.5))
                case 1:
                    p.move(to: CGPoint(x: x1 - wI * 0.5, y: y0)); p.addLine(to: CGPoint(x: x1 - wI * 0.5, y: y1))
                case 2:
                    p.move(to: CGPoint(x: x0, y: y1 - wI * 0.5)); p.addLine(to: CGPoint(x: x1, y: y1 - wI * 0.5))
                default:
                    p.move(to: CGPoint(x: x0 + wI * 0.5, y: y0)); p.addLine(to: CGPoint(x: x0 + wI * 0.5, y: y1))
                }
                sh.path = p.cgPath
                sh.fillColor = nil
                // （strokeColor 已在创建时设；此处不动）
                sh.lineWidth = wI
                sh.lineCap = .butt
                sh.lineDashPattern = [NSNumber(value: Double(wI) * 3), NSNumber(value: Double(wI) * 2)]
                sh.lineDashPhase = 0
                continue
            }
            sh.path = p.cgPath
        }
    }

    /// ★★★逐边 border 批：移除全部边框子层（幂等清理；uniform 路径与复用路径都调）。
    private func removeSideBorderSublayers(_ layer: CALayer) {
        guard let subs = layer.sublayers else { return }
        for sub in subs where (sub.name ?? "").hasPrefix("proteus-side-border-") {
            sub.removeFromSuperlayer()
        }
    }

    /// ★批次 10（CSS 兼容对齐 · 超级应用视觉）：盒阴影 → `CALayer.shadow*`（系统原生）。
    ///   结构化字段 `{dx, dy, blur, spread, color}`（编译期折出）。缺省/非法 ⇒ 清零（零行为变化）。
    ///   ★`spread` 用 `shadowPath` 外扩近似（CALayer 无原生 spread）。
    private func applyShadow(_ layer: CALayer, style: [String: Any]) {
        guard let sh = style["boxShadow"] as? [String: Any],
              let color = (sh["color"] as? String).flatMap(parseHexColor) else {
            layer.shadowOpacity = 0
            return
        }
        let dx = (sh["dx"] as? CGFloat) ?? ((sh["dx"] as? Double).map { CGFloat($0) } ?? 0)
        let dy = (sh["dy"] as? CGFloat) ?? ((sh["dy"] as? Double).map { CGFloat($0) } ?? 0)
        let blur = (sh["blur"] as? CGFloat) ?? ((sh["blur"] as? Double).map { CGFloat($0) } ?? 0)
        // CALayer.shadowRadius ≈ blur/2（Core Animation 半径 ≈ 视觉模糊半径的一半）
        layer.shadowColor = color.cgColor
        layer.shadowOffset = CGSize(width: dx, height: dy)
        layer.shadowRadius = max(0, blur / 2)
        layer.shadowOpacity = 1
    }

    /// ★★★text-shadow 项（2026-10-08）：文本阴影 → `CATextLayer.shadow*`（作用于文本内容 = 字形投影）。
    ///   `{dx,dy,blur,color}`；无声明 ⇒ 不设（零行为变化）。
    private func applyTextShadow(_ layer: CALayer, style: [String: Any]) {
        guard let sh = style["textShadow"] as? [String: Any],
              let color = (sh["color"] as? String).flatMap(parseHexColor) else { return }
        let dx = (sh["dx"] as? CGFloat) ?? ((sh["dx"] as? Double).map { CGFloat($0) } ?? 0)
        let dy = (sh["dy"] as? CGFloat) ?? ((sh["dy"] as? Double).map { CGFloat($0) } ?? 0)
        let blur = (sh["blur"] as? CGFloat) ?? ((sh["blur"] as? Double).map { CGFloat($0) } ?? 0)
        // CALayer.shadowRadius ≈ blur/2（与 applyShadow 同口径）
        layer.shadowColor = color.cgColor
        layer.shadowOffset = CGSize(width: dx, height: dy)
        layer.shadowRadius = max(0, blur / 2)
        layer.shadowOpacity = 1
    }

    /// 虚拟化读数（判据 + 诊断）
    func virtualStats() -> [String: Any] {
        [
            "is_virtual": isVirtual,
            "node_count": nodesById.count,
            "row_count": virtualRows.count,
            "materialized_rows": materializedRows.count,
            "materialized_row_list": materializedRows.sorted().prefix(40).map { $0 },
            "layer_count": layerNodes.count,
            "layers_created": layersCreated,
            "layers_reused": layersReused,
            "layers_returned": layersReturned,
            "layers_dropped": layersDropped,
            "pool_size": layerPool.count,
            "pool_capacity": layerPoolCapacity,
            "content_offset_y": contentOffset.y,
        ]
    }

    /// 某行根节点在**屏幕坐标**下的 rect（供像素采样——坐标由几何推导，不手算）
    func rowScreenRect(_ rowIndex: Int) -> CGRect? {
        guard let row = virtualRows.first(where: { $0.index == rowIndex }),
              let abs = nodeRects[row.root] else { return nil }
        return abs.offsetBy(dx: -contentOffset.x, dy: -contentOffset.y)
    }

    /// 某行内**指定序号节点**（`ids` 下标）在屏幕坐标下的 rect —— 例如 `1` 通常是行内首个绘制元素
    func rowChildScreenRect(_ rowIndex: Int, childAt: Int) -> CGRect? {
        guard let row = virtualRows.first(where: { $0.index == rowIndex }),
              childAt >= 0, childAt < row.ids.count,
              let abs = nodeRects[row.ids[childAt]] else { return nil }
        return abs.offsetBy(dx: -contentOffset.x, dy: -contentOffset.y)
    }

    /// 该行根在**内容坐标**下的 rect（供命中测试——与核心 rects 同口径）
    func contentRect(of rowIndex: Int) -> CGRect? {
        guard let row = virtualRows.first(where: { $0.index == rowIndex }) else { return nil }
        return nodeRects[row.root]
    }

    /// 该行内某节点在**内容坐标**下的 rect（供命中测试）
    func rowChildContentRect(_ rowIndex: Int, childAt: Int) -> CGRect? {
        guard let row = virtualRows.first(where: { $0.index == rowIndex }),
              childAt >= 0, childAt < row.ids.count else { return nil }
        return nodeRects[row.ids[childAt]]
    }

    /// 该行是否已物化（像素判据的前置：未物化的行采样必然是空白）
    func isRowMaterialized(_ rowIndex: Int) -> Bool { materializedRows.contains(rowIndex) }

    /// 某行的节点数（探针按 `0..<n` 枚举行内元素）
    func rowNodeCount(_ rowIndex: Int) -> Int {
        virtualRows.first(where: { $0.index == rowIndex })?.ids.count ?? 0
    }

    /// ★某行各节点的**实际呈现文本**（层上的 `string`，不是真源）——验证"复用后是否串内容"
    ///
    /// 【为什么读层而不读真源（判据强度）】复用池最经典的静默错是**串内容**：
    ///   层被复用了，但文本/颜色没被完全重配 ⇒ 显示上一行的内容
    ///   （几何/结构全对，只有肉眼/像素能发现）。读真源只会读到我刚写进去的值 ⇒ **空判据**。
    func rowNodeTexts(_ rowIndex: Int) -> [String] {
        guard let row = virtualRows.first(where: { $0.index == rowIndex }) else { return [] }
        return row.ids.map { id in
            if let tl = layersById[id] as? CATextLayer { return tl.string as? String ?? "" }
            // 未物化 ⇒ 明确标注（不返回真源值——那会掩盖"层根本没建"）
            return layersById[id] == nil ? "<no-layer>" : ""
        }
    }

    /// ★物化**静态部分**（不属于任何行的节点：根容器 / 标题 / 页脚 …）
    ///
    /// 【为什么必须（虚拟化最容易出的层树错误）】行层挂到 `layersById[pid] ?? self.layer`——
    ///   若容器从未物化，行层会**挂到根层**（几何仍对，因为帧是从核心 rect 算的），
    ///   但**层序**变成"行先于静态节点"或反之 ⇒ 与核心 children 序不符
    ///   ⇒ 重叠绘制/z-order 与核心不一致（本仓踩过同款，几何断言发现不了）。
    ///   ⇒ 静态节点（数量恒定且极少）直接全量物化。
    ///
    /// - Parameter nodes: 实例化产物的完整节点表（**父在前**）
    @discardableResult
    func materializeStaticNodes(_ nodes: [[String: Any]]) -> Int {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        var made = 0
        for n in nodes {
            guard let id = n["id"] as? Int, rowOfNode[id] == nil, layersById[id] == nil else { continue }
            let style = SelfDrawView.styleOf(n)
            let (layer, reused) = acquireLayer(style: style, nodeId: id, boxWidth: nodeRects[id]?.width ?? 0)
            if !reused { made += 1 }
            let abs = nodeRects[id] ?? .zero
            let pid = (n["parentId"] as? Int) ?? -1
            let parentOrigin = pid >= 0 ? (nodeRects[pid]?.origin ?? .zero) : .zero
            let f = CGRect(x: abs.minX - parentOrigin.x, y: abs.minY - parentOrigin.y,
                           width: abs.width, height: abs.height)
            layer.frame = lineBoxFrame(f, style: style)
            applyRadiusPct(layer, style: style, size: f.size)
            if pid >= 0 {
                (layersById[pid] ?? self.layer).addSublayer(layer)
                childrenById[pid, default: []].append(id)
            } else {
                self.layer.addSublayer(layer)
            }
            layersById[id] = layer
            parentById[id] = pid
            depthById[id] = (depthById[pid] ?? -1) + 1
            builtFrames[id] = f
            builtParents[id] = pid
            rectsByNodeId[id] = abs
            metaByNodeId[id] = style
            layerNodes.append(layer)
        }
        builtLayerCount = layerNodes.count
        CATransaction.commit()
        return made
    }

    /// ★★**虚拟化下的更新**：先落**真源**（与物化解耦），再只刷**已物化**的行
    ///
    /// 【为什么不能用 `updateLayersIncremental`（虚拟化下的静默错）】该函数要求
    ///   **每个变化节点都有层**，缺一个就返回 -1（调用方退回全量重建）——
    ///   而虚拟化下**大部分行根本没有层** ⇒ 每次更新都会退回全量（层数爆炸，虚拟化形同失效）。
    ///   反过来"只刷有层的、其余丢弃"更糟：屏外行在滚入时会显示**旧内容/旧几何**，
    ///   而所有断言都对着核心（正确的）⇒ 全绿。
    ///   ⇒ 正解：变化**一律写进真源**（`nodesById`/`nodeRects`），已物化的行立即重刷。
    func applyVirtualUpdate(changed: [(id: Int, abs: CGRect)], textUpdates: [String: Any]) -> (updatedRows: Int, deferredNodes: Int, textApplied: Int) {
        // ★先落真源（含文本）——屏外行滚入时读它（与物化解耦，见 updateVirtualSource 注释）
        updateVirtualSource(changed: changed, textUpdates: textUpdates)
        if !textUpdates.isEmpty {
            _ = applyTextUpdates(textUpdates)   // 已物化的层立即落字
        }
        var touched = Set<Int>()
        for c in changed { if let r = rowOfNode[c.id] { touched.insert(r) } }
        var refreshed = 0
        for r in touched where materializedRows.contains(r) {
            refreshRow(r)
            refreshed += 1
        }
        // 未物化的变化节点数（诊断：>0 说明确实存在"屏外待生效"的内容）
        let deferred = changed.reduce(0) { $0 + (rowOfNode[$1.id] != nil && !materializedRows.contains(rowOfNode[$1.id]!) ? 1 : 0) }
        return (refreshed, deferred, textUpdates.count)
    }

    /// 重刷一行（层已存在 ⇒ 只改帧与内容；层序不动）
    private func refreshRow(_ rowIndex: Int) {
        guard let row = virtualRows.first(where: { $0.index == rowIndex }) else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for id in row.ids {
            guard let layer = layersById[id], let abs = nodeRects[id] else { continue }
            let pid = parentById[id] ?? -1
            let parentOrigin = pid >= 0 ? (nodeRects[pid]?.origin ?? .zero) : .zero
            let f = CGRect(x: abs.minX - parentOrigin.x, y: abs.minY - parentOrigin.y,
                           width: abs.width, height: abs.height)
            // ★批次 13：文本层声明 lineHeight ⇒ 可视 frame 居中收缩（从 meta 取样式，与建层同源）
            layer.frame = metaByNodeId[id].map { lineBoxFrame(f, style: $0) } ?? f
            if let st = metaByNodeId[id] { applyRadiusPct(layer, style: st, size: f.size) }
            builtFrames[id] = layer.frame
            rectsByNodeId[id] = abs
            if let spec = nodesById[id] {
                let style = SelfDrawView.styleOf(spec)
                configureLayer(layer, style: style, boxWidth: f.width)
                metaByNodeId[id] = style
            }
        }
        CATransaction.commit()
    }
}

/// `#RGB` / `#RRGGBB` / `#RRGGBBAA` → UIColor
///
/// ★★★批次 48 修复（iOS 整屏偏色，由独立子代理视觉验收抓出）：
///   8 位 hex 原按 **AARRGGBB** 解析（`alpha = v>>24`），而**编译器产物 / 内核 / Web 都是 CSS4 序
///   `#RRGGBBAA`**（低 8 位 = alpha；见 layout-core-rust ffi.rs 的 `8 => ((v & 0xFF) << 24) | ...`）。
///   ⇒ 字节序错位：实测 `#5b5bd61a`（紫 10%）被读成 A=0x5b/R=0x5b/G=0xd6/B=0x1a ⇒ 混白底渲染出
///   **(196,240,174) 绿色**——同源编译却三端异色（Android/鸿蒙按 CSS 序 ⇒ 紫）。现改为 CSS 序。
func parseHexColor(_ s: String) -> UIColor? {
    var hex = s.trimmingCharacters(in: .whitespaces)
    if hex.hasPrefix("#") { hex.removeFirst() }
    guard let v = UInt32(hex, radix: 16) else { return nil }
    if hex.count == 3 {
        // #RGB：各通道重复一位（#f0a → #ff00aa，alpha = FF）——与内核/Web 同
        let r = (v >> 8) & 0xF, g = (v >> 4) & 0xF, b = v & 0xF
        return UIColor(red: CGFloat(r * 17) / 255, green: CGFloat(g * 17) / 255,
                       blue: CGFloat(b * 17) / 255, alpha: 1)
    }
    if hex.count == 8 {
        // ★CSS4 序 #RRGGBBAA（低 8 位 = alpha）——与内核/Web 同源
        return UIColor(red: CGFloat((v >> 24) & 0xFF) / 255, green: CGFloat((v >> 16) & 0xFF) / 255,
                       blue: CGFloat((v >> 8) & 0xFF) / 255, alpha: CGFloat(v & 0xFF) / 255)
    }
    if hex.count == 6 {
        return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                       blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }
    return nil
}

/* ────────────────────────── 桥（JSExport 实现） ────────────────────────── */

final class SelfDrawBridge: NSObject, SelfDrawExports {
    /* ══════════ ★★平台适配：文本与字体已抽到 platform/ios（HA0.5）══════════ */
    ///
    /// 抽取目标：`platform/ios/ProteusPlatform/ProteusTextAdapter.swift`
    ///
    /// 【为什么宿主不再自带它（Host ABI 方案 §0.4.8）】文本度量 / 字体映射是**平台适配**——
    ///   同平台换壳（Proteus App → 客户 App）时**一行不用改**，故归 `platform/`；
    ///   宿主（本文件）只保留**宿主集成**部分（Surface / 生命周期 / 输入 / 调度 / 能力注册）。
    ///
    /// 【宿主如何用】经类型别名引用（保持既有调用点 `SelfDrawBridge.measureText(...)` 不变，
    ///   把"改调用点"的回归面降到零——机械抽取的第一原则是不改语义）：
    typealias TextAdapter = ProteusTextAdapter


    /// CoreText 度量（★平台注入：核心不自研文本，Profile §L4）
    /// ★★**字体构造（唯一实现）**——绘制（CATextLayer）与度量必须用**同一支字体**
    ///
    /// 【为什么必须同源（本仓实测）】若绘制用粗体、度量用常规体 ⇒ 文本**显示**与实际
    ///   **占位**不符（字被裁或留白），且几何断言全绿（几何是按度量算的）。
    ///   本仓已有同族教训（坐标口径、层序）：**同一事实只认一个来源**。
    ///   ★放在 `SelfDrawBridge`（而非 View）：**度量在这里**（`measureText`）——
    ///     字体构造与度量同处一类，`makeLayer` 经 `SelfDrawBridge.font` 取同一支字体。
    ///
    /// - Parameter weight: CSS 口径字重（400 = normal，700 = bold）
    /// - Parameter family: **语义角色**（`system`/`serif`/`monospace`/`rounded`/`condensed`）
    ///
    ///   ★★**为什么收角色而不是 CSS 原始清单**：见适配器 `SelfDrawNodeSpec.fontFamily` 注释——
    ///   CSS 是候选清单且平台字体名不同，解析与回退规则必须**只写一遍**（在适配器里），
    ///   宿主只做「角色 → 平台字体」这一件平台相关的事。
    ///
    ///   ★iOS 的角色映射（不确定的名字一律**不猜**——用系统 API 查，查不到回退 system 并计数）：
    ///   | 角色 | iOS 映射 |
    ///   |---|---|
    ///   | `system` | `UIFont.systemFont(ofSize:weight:)`（含 weight 变体） |
    ///   | `serif` | `UIFont(name: "Times New Roman", size:)`；缺则 `UIFontDescriptor.withDesign(.serif)` |
    ///   | `monospace` | `UIFont.monospacedSystemFont(ofSize:weight:)`（iOS 13+，最稳） |
    ///   | `rounded` | `UIFontDescriptor.withDesign(.rounded)` |
    ///   | `condensed` | `UIFontDescriptor.withDesign(.condensed)` |
    ///   ⚠ 设计族（serif/rounded/condensed）经 descriptor 拿到的字体**可能不带 weight 变体**
    ///     ⇒ 实现里**先试设计族、再用 `withSymbolicTraits` 叠字重**，失败则按角色回退系统族
    ///     ——不静默混用（混用 = 度量与绘制看着都对但字长得不对，属像素级差异）。
    /// ★★I3：把**编译期推导的绘制提示**落到层的存储格式上（`contentsFormat`）。
    ///
    /// 【为什么这是"内存优化接线"而非可选项】
    ///   自绘路径下每个文本层默认按 **sRGB 全通道**分配 backing store，而系统 `UILabel`
    ///   对单色字符串做了单通道优化 ⇒ 实测每个文本层多耗约 4 倍内存
    ///   （内存诊断：2000 层 186.9MB vs 紧凑格式 114.9MB = **−39%**）。
    ///   ⇒ 对**确实单色**的文本层设 `gray8Uint`，是把那 39% 拿回来的唯一手段。
    ///
    /// 【为什么判据在编译期、这里只"照做"（Profile §12.4）】
    ///   平台层运行时"猜"正是 iOS 曾出现 **+78% 内存**的根因（按最贵格式分配）。
    ///   ⇒ hint 由推导器给出（判据见 `component-ir/src/paint-hint.ts`；适配器侧派生实现
    ///     与其逐形态对拍，见 `tests/selfdraw-paint-hint.test.ts`），本函数只读 hint 照做。
    ///
    /// 【为什么必须保守（拿不准 = 保持系统默认）】
    ///   紧凑格式**只有亮度、没有色相**，且**没有 alpha 通道**：
    ///   · 彩色文字写进 gray8Uint ⇒ **变灰字**（画面错、无报错）
    ///   · 半透明内容 ⇒ alpha 丢失
    ///   ⇒ 判据侧已排除这两类；本函数再兜一道：只认显式 `isMonochrome == true`。
    ///
    /// 【★诚实边界】`isPureBackground` **不需要这里动手**：CALayer 的纯底色走
    ///   `backgroundColor` 属性、**天然不进 backing store**（实测仅色块 4.9MB）。
    ///   故本函数只处理 `isMonochrome`；该字段的价值在诊断/对账（证明推导链路通了）。
    static func applyPaintHint(_ layer: CALayer, style: [String: Any]) {
        guard let tl = layer as? CATextLayer else { return }
        // ★★A/B 开关（**仅用于内存复测**）：`PROTEUS_PAINT_HINT=off` ⇒ 完全不设 contentsFormat。
        //
        // 【为什么必须有】I3 的验收是「iOS 内存增量复测」——那要求**同一场景、同一设备的两个变体**，
        //   而不是"设了 hint 之后的绝对值"（绝对值里混着场景/设备的固有占用，隔离不出 hint 的贡献）。
        //   关闭态（系统默认格式）与开启态（判据生效）配对，差值才是 I3 的净收益。
        //   ★默认**开启**（生产行为）；只有显式 `off` 才关——避免"忘了设环境变量导致优化静默失效"。
        if ProcessInfo.processInfo.environment["PROTEUS_PAINT_HINT"] == "off" {
            paintHintDisabled = true
            return
        }
        let hint = style["paintHint"] as? [String: Any]
        let mono = (hint?["isMonochrome"] as? Bool) ?? (hint?["isMonochrome"] as? NSNumber)?.boolValue ?? false
        if #available(iOS 13.0, *) {
            if mono {
                tl.contentsFormat = .gray8Uint
                paintHintCompact += 1
            } else {
                // ★非单色**必须显式复位**为默认格式——层会被池复用，
                //   否则它带着上一个节点的紧凑格式继续用（复用 = 完全重配，不是"覆盖部分字段"）
                tl.contentsFormat = .RGBA8Uint
                paintHintGeneric += 1
            }
        }
    }

    /// ★I3 读数：应用了紧凑格式 / 通用格式的文本层数。
    ///   【为什么要有读数】"设了没设"必须可观测——内存差 39% 只在这两个计数上体现；
    ///   无读数时只能靠"看起来生效了"（本仓纪律：判据落在结果上）。
    private(set) static var paintHintCompact = 0
    private(set) static var paintHintGeneric = 0
    /// ★A/B 开关状态（`PROTEUS_PAINT_HINT=off` 时置位）——报告里必须可读，
    ///   否则"关了 hint 测出来的数字"与"开了 hint"分不清（本仓纪律：读数名与含义一致）
    private(set) static var paintHintDisabled = false
    /// ★诊断：宿主**实际看到**的 PROTEUS_PAINT_HINT 值（空 = 未注入）。
    ///   【为什么要有它】A/B 复测时"关闭态没关掉"会表现为差值恒 0，而**看不出是注入失败**
    ///     （本仓实测：装置自证抓到 disabled 不为 true，但说不出是"没注入"还是"读了没用"）。
    ///     ⇒ 把原始值原样带进报告，问题一眼可归因。
    static var paintHintEnvRaw: String {
        ProcessInfo.processInfo.environment["PROTEUS_PAINT_HINT"] ?? ""
    }
    static func paintHintStats() -> String {
        "{\"compact\":\(paintHintCompact),\"generic\":\(paintHintGeneric)}"
    }
    static func resetPaintHintStats() { paintHintCompact = 0; paintHintGeneric = 0 }

    weak var view: SelfDrawView?
    var jsReport: [String: Any] = [:]
    /// ★句柄常驻：Vue 的后续更新复用同一棵 Rust 树（与 §5.1「节点树页面存活期间常驻」一致）
    private var handle: UInt64 = 0
    /// ★★复用池句柄（§12.6：核心给决策、宿主执行动作）——`mountVirtual` 时创建
    private var recycleHandle: UInt64 = 0
    /// 上一帧的节点数组（**增量 diff 的基线**）——只有它才能算出「哪些节点真的变了」
    private var lastNodes: [[String: Any]] = []

    /// 最近一次布局的分段耗时（供报告）
    private(set) var lastTiming: [String: Double] = [:]
    /// ★★上一次更新提交的几何快照（id → "x,y,w,h"）——用于**自检「几何真的变了吗」**
    ///
    /// 【为什么必须自检（本仓实测的第八个测量装置缺陷）】类B 基准树少了 `flexShrink: 0`，
    ///   1001 行被 flexbox 压缩到内容高度 ⇒ 「改行高 56→80」**根本没产生几何变化**，
    ///   但用例仍报了 47.9ms 的漂亮数字（全量重排 + 全量传输 + 全量层更新，
    ///   全都作用在一棵"没有变化"的树上）。⇒ 计时**必须配变化量自检**，否则又在测空气。
    private var lastGeom: [Int: String] = [:]
    /// 最近一次更新里几何**真的变了**的节点数（自检读数）
    private(set) var lastGeomChanged = 0
    private(set) var lastNodeCount = 0
    private(set) var lastTreeHash = ""


    /// 报告 / 快照文件名（自绘场景 vs 逻辑层基准各自独立，避免互相覆盖）
    /// ★由控制器按启动参数（`--bench`）设置。
    /// 进程内存峰值（MB）——加压测试的「内存天花板」读数
    static var memPeakMB: Double = 0
    static var reportFileName = "selfdraw-report"
    static var snapshotName = "selfdraw-final"
    /// ★★内容滚动范围钳制开关（2026-10-02 —— 与 Android `VaporRenderHost.contentScrollRangeEnabled` 同源）：
    ///   内容页语义 = 装不下才滚、最多滚到内容底（与 Web 页面一致）；
    ///   **仅内容页场景开启**（`--stress`），既有 pan/滚动探针用例保持"无界拖拽"（零行为变化）。
    static var contentScrollRangeEnabled = false

    deinit {
        if handle != 0 { _ = proteus_layout_destroy(handle) }
    }

    func mount(_ treeJson: String) -> String {
        // ★每次 mount 重置内存峰值：加压是**逐档递增**的，峰值必须按档记，
        //   否则高档位的数字里混着低档位的占用，无法判断"哪一档越线"
        SelfDrawBridge.memPeakMB = physFootprintMB()
        // ★重置几何快照（新树 ⇒ 旧快照无意义；否则首帧会把全部节点算成"刚变化"）
        lastGeom.removeAll(keepingCapacity: true)
        lastGeomChanged = 0
        return render(treeJson: treeJson, phase: "mount")
    }

    func update(_ treeJson: String) -> String {
        return render(treeJson: treeJson, phase: "update")
    }

    /* ═══════════════════ ★★虚拟化：挂载 / 滚动 / 读数 ═══════════════════ */

    /// 见协议声明（`mountVirtual`）
    ///
    /// 流程（顺序敏感）：
    ///   ① 全量几何：整棵树进核心（**不裁剪节点树**）—— 这是「命中测试/增量更新/行内分发」
    ///      全部保持原口径的前提；虚拟化省的是**层**，不是树。
    ///   ② 建复用池句柄：行数来自 `rows.count`（核心据此夹取预载区）。
    ///   ③ 可见行 → 物化（含预载区：由**核心**的 `first_preload/last_preload` 决定，
    ///      宿主不自己算预载——方向敏感规则属平台无关逻辑，已在核心单测锁定）。
    func mountVirtual(_ requestJson: String) -> String {
        guard let view = view else { return "{\"ok\":false,\"error\":\"view 未设置\"}" }
        // ★§7.3：安装「行回收 ⇒ 动画解绑」（幂等；虚拟化是节点复用的唯一入口 ⇒ 在此接线）
        attachRowRecycleUnbind()
        let t0 = CFAbsoluteTimeGetCurrent()
        guard let d = requestJson.data(using: .utf8),
              let root = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let nodes = root["nodes"] as? [[String: Any]],
              let rowsRaw = root["rows"] as? [[String: Any]] else {
            return "{\"ok\":false,\"error\":\"mountVirtual 入参解析失败（需 {viewport,nodes,rows}）\"}"
        }
        var rows: [SelfDrawView.VirtualRow] = []
        for r in rowsRaw {
            guard let index = r["index"] as? Int, let rootId = r["root"] as? Int,
                  let ids = r["ids"] as? [Int] else { continue }
            rows.append(.init(index: index, key: (r["key"] as? String) ?? "\(index)", root: rootId, ids: ids))
        }
        guard !rows.isEmpty else { return "{\"ok\":false,\"error\":\"rows 为空（虚拟化无意义）\"}" }

        // ① 文本度量 + ② 核心建树（与全量 mount 同一条路——几何口径必须完全一致）
        ProteusTextAdapter.resetMeasureStats()
        ProteusTextAdapter.resetFontFamilyStats()
        var textMeasures: [String: [String: Double]] = [:]
        for n in nodes {
            guard let text = n["text"] as? String, !text.isEmpty, let id = n["id"] as? Int else { continue }
            let fs = (n["fontSize"] as? Double).map { CGFloat($0) } ?? 14
            let fw = (n["fontWeight"] as? Double).map { CGFloat($0) } ?? 400
            let fam = (n["fontFamily"] as? String) ?? "system"
            let sz = ProteusTextAdapter.measureText(text, fontSize: fs, fontWeight: fw, fontFamily: fam, letterSpacing: (n["letterSpacing"] as? Double).map { CGFloat($0) } ?? 0)
            textMeasures["\(id)"] = ["width": Double(sz.width), "height": Double(sz.height)]
        }
        let req: [String: Any] = [
            "viewport": root["viewport"] as? [String: Any] ?? ["width": 390, "height": 844],
            "nodes": nodes, "textMeasures": textMeasures,
        ]
        guard let reqData = try? JSONSerialization.data(withJSONObject: req),
              let reqJson = String(data: reqData, encoding: .utf8) else {
            return "{\"ok\":false,\"error\":\"核心请求组装失败\"}"
        }
        if handle != 0 { _ = proteus_layout_destroy(handle); handle = 0 }
        handle = reqJson.withCString { proteus_layout_create($0) }
        guard handle > 0 else {
            return "{\"ok\":false,\"error\":\"proteus_layout_create 失败（节点数 \(nodes.count)）\"}"
        }
        let layoutMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000

        // 几何（全量读一次——物化要用整棵树的 rect 设帧，与可见性无关）
        let rectsStr = takeCString(proteus_layout_rects(handle))
        guard let rd = rectsStr.data(using: .utf8),
              let ro = (try? JSONSerialization.jsonObject(with: rd)) as? [String: Any],
              let rectsJson = ro["rects"] as? [String: [String: Double]] else {
            return "{\"ok\":false,\"error\":\"几何解析失败\"}"
        }
        var rects: [Int: CGRect] = [:]
        for (k, r) in rectsJson {
            guard let id = Int(k) else { continue }
            rects[id] = CGRect(x: r["x"] ?? 0, y: r["y"] ?? 0, width: r["width"] ?? 0, height: r["height"] ?? 0)
        }

        // ③ 虚拟化初始化（清层 + 真源表 + 空池）
        view.clearLayers()
        let poolCap = (root["poolCapacity"] as? Int) ?? 96
        view.setupVirtual(rows: rows, nodes: nodes, rects: rects, poolCapacity: poolCap)
        // ★静态部分（容器/标题等，不属于任何行）全量物化——否则行层会挂到根层
        //   （几何仍对但层序错 ⇒ 重叠绘制/z-order 与核心不符；见 materializeStaticNodes 注释）
        view.materializeStaticNodes(nodes)

        // ④ 复用池句柄
        if recycleHandle != 0 { proteus_recycle_destroy(recycleHandle) }
        recycleHandle = proteus_recycle_create(UInt32(rows.count), 0, 0)

        // ⑤ 首帧：可见区 → 核心决策 → 物化（含预载区）
        let scrolled = applyVirtualScroll(dx: 0, dy: 0, explicitRange: view.visibleRowRange())
        lastNodes = nodes
        lastNodeCount = nodes.count
        lastTreeHash = String(format: "%08x", requestJson.hashValue)
        let st = view.virtualStats()
        let totalMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        return jsonString([
            "ok": true, "path": "mountVirtual", "node_count": nodes.count,
            "layer_count": view.builtLayerCount,
            "materialized_rows": st["materialized_rows"] ?? 0,
            "measure_ms": 0, "layout_ms": round(layoutMs * 100) / 100, "host_total_ms": round(totalMs * 100) / 100,
            "request_bytes": reqJson.count,
            "first_frame": scrolled,
            "mem_mb": round(physFootprintMB() * 10) / 10,
            "virtual": st,
        ])
    }

    /// 见协议声明（`scrollRows`）
    func scrollRows(_ dx: Double, _ dy: Double) -> String {
        guard let view = view, recycleHandle != 0 else {
            return "{\"ok\":false,\"error\":\"未做虚拟化挂载\"}"
        }
        let t0 = CFAbsoluteTimeGetCurrent()
        let out = applyVirtualScroll(dx: CGFloat(dx), dy: CGFloat(dy), explicitRange: nil)
        let ms = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        var o = out
        o["scroll_ms"] = round(ms * 100) / 100
        o["virtual"] = view.virtualStats()
        // ★★**内存读数**（S2 收敛判据：滚动几个来回后内存应**收敛**，不持续增长）
        //
        // 【为什么必须由宿主在**每个滚动步**里报（而不是只在结束时取一次）】"收敛"是**趋势**，
        //   单点读数无法判定（本仓纪律：对自报状态/单点读数比较是空判据）。
        //   由宿主在滚动动作的同一处取，保证"读数与该步的层状态同源"。
        //   ★用 `phys_footprint`（iOS 上最贴近真实占用，也是 OOM 杀进程看的那个数）。
        o["mem_mb"] = round(physFootprintMB() * 10) / 10
        return jsonString(o)
    }

    /// ★★本帧的虚拟化执行（挂载首帧与滚动共用——**同一语义一处实现**）
    ///
    /// 顺序（每步都有本仓踩过的理由）：
    ///   ① 先应用内容偏移（可见区判定必须用**新**偏移）
    ///   ② 可见行由**几何**推导（不假设行高——行高由核心算，可被样式/文本改变）
    ///   ③ 向核心复用池要决策（acquire/release 含**方向敏感预载区**）
    ///   ④ **先 release 再 acquire**（反了 ⇒ 本帧要建的层无法复用刚释放的 ⇒ 复用率虚低）
    ///   ⑤ acquire 的行物化（层从池里取；内容/帧/层序都按当前真源填）
    private func applyVirtualScroll(dx: CGFloat, dy: CGFloat, explicitRange: (first: Int, last: Int)?) -> [String: Any] {
        guard let view = view else { return ["ok": false, "error": "无视图"] }
        if dx != 0 || dy != 0 {
            _ = view.applyContentOffset(dx: dx, dy: dy)
        }
        guard let range = explicitRange ?? view.visibleRowRange() else {
            return ["ok": false, "error": "无可见行（行表为空）"]
        }
        let dec = takeCString(proteus_recycle_update(recycleHandle, UInt32(range.first), UInt32(range.last)))
        guard let dd = dec.data(using: .utf8),
              let d = (try? JSONSerialization.jsonObject(with: dd)) as? [String: Any],
              (d["ok"] as? Bool) == true else {
            return ["ok": false, "error": "核心复用池决策失败", "raw": String(dec.prefix(200))]
        }
        let acquire = (d["acquire"] as? [Int]) ?? []
        let release = (d["release"] as? [Int]) ?? []

        var released = 0
        for r in release { released += view.dematerializeRow(r) }
        var createdRows = 0
        for r in acquire {
            view.materializeRow(r)
            createdRows += 1
        }
        _ = view.flushPendingIfVisible()
        return [
            "ok": true,
            "direction": d["direction"] ?? "idle",
            "first_visible": d["first_visible"] ?? -1,
            "last_visible": d["last_visible"] ?? -1,
            "first_preload": d["first_preload"] ?? -1,
            "last_preload": d["last_preload"] ?? -1,
            "acquired": acquire,
            "released": release,
            "acquired_rows": createdRows,
            "released_rows": released,
            "demoted": d["demoted"] ?? 0,       // ★核心直接解码（避免在 Swift 里重解 JSON 字符串）
            "live_rows": d["live"] ?? 0,
        ]
    }

    /// 见协议声明（`virtualStats`）
    func virtualStats() -> String {
        guard let view = view else { return "{\"ok\":false,\"error\":\"无视图\"}" }
        var st = view.virtualStats()
        if recycleHandle != 0 {
            let s = takeCString(proteus_recycle_stats(recycleHandle))
            if let sd = s.data(using: .utf8),
               let so = (try? JSONSerialization.jsonObject(with: sd)) as? [String: Any] {
                st["recycle"] = so
            }
        }
        st["ok"] = true
        return jsonString(st)
    }

    /// 见协议声明（`setPoolCapacity`）——破坏性验证：容量 0 ⇒ 复用必然为 0
    func setPoolCapacity(_ n: Double) -> String {
        guard let view = view else { return "{\"ok\":false,\"error\":\"无视图\"}" }
        view.setLayerPoolCapacity(Int(n))
        return jsonString(["ok": true, "pool_capacity": view.layerPoolCapacity])
    }

    /// 见协议声明（`measureProbe`）——节点几何 + **层上实际字体名**
    ///
    /// 【为什么要读"层上"的字体名】见协议注释：几何宽度只能证明度量侧；
    ///   本仓已有"度量与绘制分叉 ⇒ 字被裁而报告全绿"的同族教训。
    func measureProbe(_ json: String) -> String {
        guard let view = view else { return "{\"ok\":false,\"error\":\"无视图\"}" }
        var ids: [Int] = []
        if let d = json.data(using: .utf8),
           let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
           let raw = o["nodes"] as? [Int] {
            ids = raw
        }
        if ids.isEmpty { ids = view.allNodeIds() }
        var out: [String: Any] = [:]
        for id in ids {
            guard let layer = view.layerFor(id: id) else { out["\(id)"] = ["layer_missing": true]; continue }
            var e: [String: Any] = [
                "layer_w": Double(layer.frame.width), "layer_h": Double(layer.frame.height),
            ]
            if let tl = layer as? CATextLayer {
                e["string"] = (tl.string as? String) ?? ""
                // ★层上**实际**字体（CGFont 描述含字体名）——"绘制侧真的用了这个字体"的硬证据
                e["font_name"] = tl.font.map { String(describing: $0) } ?? ""
                e["font_size"] = Double(tl.fontSize)
            }
            if let screen = view.screenRect(of: id) {
                e["screen_x"] = Double(screen.minX); e["screen_y"] = Double(screen.minY)
                e["screen_w"] = Double(screen.width); e["screen_h"] = Double(screen.height)
            }
            out["\(id)"] = e
        }
        return jsonString(["ok": true, "nodes": out, "content_offset_y": Double(view.contentOffset.y)])
    }

    /// 见协议声明（`virtualProbe`）
    func virtualProbe(_ rowIndex: Double) -> String {
        guard let view = view, view.isVirtual else {
            return "{\"ok\":false,\"error\":\"非虚拟化\"}"
        }
        let ri = Int(rowIndex)
        guard let rowRect = view.rowScreenRect(ri) else {
            return "{\"ok\":false,\"error\":\"无该行几何（行号越界）\"}"
        }
        let n = view.rowNodeCount(ri)
        var childRects: [[String: Double]] = []
        for i in 0..<n {
            if let r = view.rowChildScreenRect(ri, childAt: i) {
                childRects.append(["x": Double(r.minX), "y": Double(r.minY),
                                   "w": Double(r.width), "h": Double(r.height),
                                   "cx": Double(r.midX), "cy": Double(r.midY)])
            }
        }
        // ★★**同时给出屏幕坐标与内容坐标**（本仓实测的坐标系口径分叉）
        //
        // 【为什么必须要两套】本探针历史上只给**屏幕坐标**（`abs - contentOffset`），
        //   供**像素采样**用（`samplePixels` 吃屏幕坐标）；而 `tapAt` 吃**内容坐标**
        //   （核心的命中测试与 rects 同口径）。
        //   实测踩到：拿 `child_rects.cy` 去 `tapAt` ⇒ 命中到**第 1 行**（因为内容坐标里
        //   600 行的 y≈37000，而我传的是它减掉偏移后的 ~449 ⇒ 那是第 1 行的位置）。
        //   ⇒ 纪律：**跨接口传坐标前先确认两端口径**；探针一次给全两套，调用方各取所需。
        let rowContent = view.contentRect(of: ri)
        var contentCenters: [[String: Double]] = []
        for i in 0..<n {
            if let c = view.rowChildContentRect(ri, childAt: i) {
                contentCenters.append(["cx": Double(c.midX), "cy": Double(c.midY)])
            }
        }
        return jsonString([
            "ok": true,
            "row_index": ri,
            "materialized": view.isRowMaterialized(ri),
            "row_rect": ["x": Double(rowRect.minX), "y": Double(rowRect.minY),
                         "w": Double(rowRect.width), "h": Double(rowRect.height),
                         "cx": Double(rowRect.midX), "cy": Double(rowRect.midY)],
            // ★**内容坐标**（供 `tapAt`/命中测试用；与核心 rects 同口径）
            "row_content": rowContent == nil ? [:] : [
                "x": Double(rowContent!.minX), "y": Double(rowContent!.minY),
                "w": Double(rowContent!.width), "h": Double(rowContent!.height),
                "cy": Double(rowContent!.midY)],
            "child_content_centers": contentCenters,
            "child_rects": childRects,
            // ★行内各节点的**当前文本**（来自真源/层的实际呈现）——用于验证
            //   "屏外更新滚入后是否生效"（复用池最经典的静默错：显示上一行的内容）
            "child_texts": view.rowNodeTexts(ri),
            "layer_count": view.builtLayerCount,
        ])
    }

    /// ★★增量更新：把 JS 侧的**样式补丁**直接转给核心（不经过宿主 diff、不解析整树）
    ///
    /// 【为什么这条路径能省掉大头（真机实测分解，3507 节点只改 1 行）
    ///   · 旧路径（整树）：JS 序列化整树 → **跨 JSExport 编组 280KB ≈ 70ms** → 宿主解析 8.6ms
    ///     → 宿主 diff 9.5ms → 核心重排 **0.07ms** ⇒ 99.9% 花在「搬运整树」，与布局无关
    ///   · 新路径（补丁）：几十字节跨越 → 核心重排 0.07ms → 只改变化的 layer
    ///   ★关键观察：**「改了什么」是 JS 侧已知的**（Vue 的 patchProp 直接告诉了我们），
    ///     让宿主再 diff 一遍整树是纯粹的重复劳动。
    func updatePatches(_ patchesJson: String) -> String {
        guard let view = view, handle != 0 else {
            return "{\"ok\":false,\"error\":\"未建树或未接入核心\"}"
        }
        let t0 = CFAbsoluteTimeGetCurrent()

        // ── ★★文本补丁：**先度量再注入**（本仓实测的闭环缺口）──
        //
        // 【为什么必须在这里做（真机 S4 的根因链）】文本尺寸只能由宿主度量，而核心的
        //   `TableTextMeasurer` 是**按 nodeId 查表**（内容不同 ⇒ 表里的旧尺寸就是错的）。
        //   ⇒ 补丁里带 `text` 时必须：① 用该节点的 fontSize 重新度量 ② `set_text_measures`
        //     注入 ③ 再发补丁 ⇒ 核心才会用**新文本的新尺寸**重排。
        //   ★漏掉任何一步的症状：核心几何按旧尺寸算（字被裁/留白），而**没有任何报错**。
        var measures: [String: [String: Double]] = [:]
        if let d = patchesJson.data(using: .utf8),
           let arr = (try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]] {
            for p in arr {
                // ★形状：`{id, style:{text}}`（与适配器产出、Rust StylePatch **三处同形状**）
                //   本仓实测：首版在此找顶层 `text` ⇒ 度量**一条都没注入** ⇒ 核心按旧尺寸算几何
                //   （字变长了盒子没变 ⇒ 字被裁），而 applied 照数 300 —— 又一处静默形状分叉。
                guard let id = p["id"] as? Int,
                      let style = p["style"] as? [String: Any],
                      let text = style["text"] as? String else { continue }
                // fontSize / fontWeight 取宿主建层时留下的 meta（与全量渲染同源，不猜默认值）
                let fs = (view.fontSizeOf(id: id)).map { CGFloat($0) } ?? 14
                let fw = (view.fontWeightOf(id: id)).map { CGFloat($0) } ?? 400
                // ★字族也取宿主 meta（与绘制同源）——漏了它 ⇒ 度量的字体与绘制的字体不同
                let fam = view.fontFamilyOf(id: id) ?? "system"
                let sz = ProteusTextAdapter.measureText(text, fontSize: fs, fontWeight: fw, fontFamily: fam, lineHeight: view.lineHeightOf(id: id), letterSpacing: view.letterSpacingOf(id: id))
                measures["\(id)"] = ["width": Double(sz.width), "height": Double(sz.height)]
            }
        }
        if !measures.isEmpty {
            let mj = jsonString2(measures)
            _ = mj.withCString { takeCString(proteus_layout_set_text_measures(handle, $0)) }
        }

        let out = patchesJson.withCString { takeCString(proteus_layout_update(handle, $0)) }
        let updateMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        guard out.contains("\"ok\":true") else {
            return "{\"ok\":false,\"error\":\"update 失败\",\"raw\":\(jsonEscape(String(out.prefix(200))))}"
        }
        let o = (try? JSONSerialization.jsonObject(with: Data(out.utf8))) as? [String: Any]
        let applied = (o?["applied"] as? Int) ?? 0
        let relayout = (o?["relayout_count"] as? Int) ?? 0

        // 无有效补丁 ⇒ 什么都不用做（例如只改了颜色）
        if applied == 0 {
            let m0 = physFootprintMB()
            SelfDrawBridge.memPeakMB = max(SelfDrawBridge.memPeakMB, m0)
            return jsonString(["ok": true, "path": "updatePatches", "incremental": true,
                               "patch_count": 0, "relayout_count": 0, "changed_rects": 0,
                               // ★A/B 判据键名别名（见 applyOps 同款注释）
                               "applied": 0, "relayout": 0, "text_layers_applied": 0,
                               "updated_layers": 0, "mem_mb": round(m0 * 10) / 10,
                               "mem_peak_mb": round(SelfDrawBridge.memPeakMB * 10) / 10,
                               "update_ms": round(updateMs * 100) / 100])
        }

        var changed: [(id: Int, abs: CGRect)] = []
        if let rm = o?["rects"] as? [String: [String: Double]] {
            for (k, r) in rm {
                guard let nid = Int(k) else { continue }
                changed.append((id: nid, abs: CGRect(x: r["x"] ?? 0, y: r["y"] ?? 0,
                                                    width: r["width"] ?? 0, height: r["height"] ?? 0)))
            }
        }
        // ★★文本落层（与 applyOps 同一条路：`text_updates` → CATextLayer.string）
        //   见 applyTextUpdates 注释（不落层 = 屏幕文字停留旧值，几何断言发现不了）
        let textUpdates = (o?["text_updates"] as? [String: Any]) ?? [:]
        let textApplied = textUpdates.isEmpty ? 0 : view.applyTextUpdates(textUpdates)

        let tL = CFAbsoluteTimeGetCurrent()
        // ★遗留路径（S2/V0/J 用例走这条）**保持全量更新**：它的语义已进历史读数，
        //   若在此启用「只更可见层」会静默改变那些基线（本仓纪律：改变已发布读数必须显式）。
        //   Vapor 新路径（applyOps）才用 visibleOnly——见其实现。
        let updated = view.updateLayersIncremental(changed: changed, visibleOnly: false)
        let layersMs = (CFAbsoluteTimeGetCurrent() - tL) * 1000
        if updated < 0 {
            return "{\"ok\":false,\"error\":\"变化集与本地层不匹配（需全量重建）\"}"
        }
        let totalMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        let mem = physFootprintMB()
        SelfDrawBridge.memPeakMB = max(SelfDrawBridge.memPeakMB, mem)
        lastTiming = ["measure_ms": 0, "layout_ms": (updateMs * 100).rounded() / 100,
                      "build_layers_ms": (layersMs * 100).rounded() / 100,
                      "host_total_ms": (totalMs * 100).rounded() / 100]
        return jsonString(["ok": true, "path": "updatePatches", "incremental": true,
                           "in_bytes": patchesJson.count,
                           "patch_count": applied, "relayout_count": relayout,
                           "text_updates": textUpdates.count,
                           "text_layers_applied": textApplied,
                           // ★A/B 判据键名别名（与 applyOps 同款——共享 bundle 读 applied/relayout）
                           "applied": applied, "relayout": relayout,
                           "measures_injected": measures.count,
                           // ★核心分段（本仓纪律：relayout 是文本补丁的主成本，必须可直读——
                           //   否则"优化有没有生效"只能靠推理，而推理在本仓已坑过多次）
                           "relayout_ms": round((((o?["_timing"] as? [String: Any])?["engine_and_relayout_ms"] as? Double) ?? 0) * 100) / 100,
                           // ★引擎内部相位（判定是否真走持久树；键名与 Rust 侧一致）
                           "engine_phases": (o?["_timing"] as? [String: Any])?["phases"] as? [String: Any] ?? [:],
                           // ★度量回调读数（判定"整树重排 19ms 是否花在度量上"的唯一途径）
                           "measure_calls": (o?["measure_calls"] as? Int) ?? 0,
                           "measure_hits": (o?["measure_hits"] as? Int) ?? 0,
                           "engine_diag": (o?["_timing"] as? [String: Any])?["engine_diag"] ?? [:],
                           // ★**整块透传**核心分段（不再逐个字段搬运——本仓实测已漏 3 次）
                           "_timing": o?["_timing"] as? [String: Any] ?? [:],
                           "idmap_ms": round((((o?["_timing"] as? [String: Any])?["idmap_ms"] as? Double) ?? 0) * 100) / 100,
                           "collect_ms": round((((o?["_timing"] as? [String: Any])?["collect_changed_ms"] as? Double) ?? 0) * 100) / 100,
                           "changed_rects": changed.count, "updated_layers": updated,
                           "update_ms": round(updateMs * 100) / 100,
                           "layers_ms": round(layersMs * 100) / 100,
                           // ★三段分解（sort/frames/commit）——定位 layers 残余的唯一依据
                           "host_total_ms": round(totalMs * 100) / 100])
    }

    /// 见协议声明（`paintPatches`）：**不经核心**，直接改层
    func paintPatches(_ patchesJson: String) -> String {
        guard let view = view else { return "{\"ok\":false,\"error\":\"无视图\"}" }
        guard let d = patchesJson.data(using: .utf8),
              let arr = (try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]] else {
            return "{\"ok\":false,\"error\":\"paintPatches 解析失败（需数组）\"}"
        }
        let t0 = CFAbsoluteTimeGetCurrent()
        let applied = view.applyPaintPatches(arr)
        let ms = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        return jsonString(["ok": true, "path": "paintPatches", "incremental": true,
                           "in_bytes": patchesJson.count, "paint_patches": arr.count,
                           "paint_layers_applied": applied,
                           // ★虚拟化：层不存在（屏外）的补丁落**真源**（诊断读数——
                           //   0 说明本用例没有屏外节点，非 0 说明这条路径真的被走到过）
                           "paint_deferred_to_source": view.lastPaintDeferred,
                           "paint_ms": round(ms * 100) / 100])
    }

    /// ★★**结构变更（增删行）**：把 splice 明细交给核心 + **宿主层树增量增删**
    ///
    /// 【与 updatePatches 的关系】同一条层更新通道（`updateLayersIncremental`），
    ///   差别在**先**增删层子树（核心的响应里给了变化集，新节点的几何就在其中）。
    ///   顺序敏感：① 摘除（先把"死"的层拿掉）→ ② 插入（建出"活"的层）→ ③ 统一设帧
    ///   （按父链深度排序 ⇒ 新节点的父原点一定是**更新过的**；
    ///    若在 ② 里直接设帧，用的是**旧**父原点 ⇒ 几何错，本仓已踩过坐标系双重偏移）。
    ///
    /// 【返回值】`{ ok, removed, inserted, relayout_count, changed_rects, updated_layers, ... }`
    ///   —— `inserted_layers`/`removed_layers` 是**宿主侧实际增删的层数**（与核心的
    ///   removed/inserted 对账：两者不等即"层树与树结构分叉"，必须可观测）。
    func splice(_ spliceJson: String) -> String {
        guard let view = view, handle != 0 else {
            return "{\"ok\":false,\"error\":\"未建树或未接入核心\"}"
        }
        // ★虚拟化下 splice 一律拒绝（**宁可拒绝不可静默错**）
        //
        // 【为什么不能直接跑】splice 的增删是**按节点 id 的层级操作**，而虚拟化下大部分行
        //   **根本没有层**（未物化）⇒ 它会对着"不存在的层"增删 ⇒ 层树与核心结构静默分叉
        //   （现象：滚动到某处突然多/少内容，而所有几何断言都对着核心 ⇒ 全绿）。
        //   ⇒ 正解：虚拟化下的行数变化走**重新 `mountVirtual`**（真源与池一起重建，语义明确）。
        if view.isVirtual {
            return "{\"ok\":false,\"error\":\"虚拟化下不支持 splice（层未全量物化）——请重新 mountVirtual\",\"virtual\":true}"
        }
        let t0 = CFAbsoluteTimeGetCurrent()

        // ── ⓪ ★宿主度量新插入的文本（文本尺寸只能由宿主算：CoreText / StaticLayout）──
        //
        // 【为什么必须在这里做（本仓实测的静默错几何）】插入的行**必然含文本**，
        //   而文本尺寸不在 style 里——它是 `textMeasures` 表（建树时注入）。新节点不在
        //   任何表里 ⇒ 若不带度量，核心要么按 0 高（修复前：文字消失）、要么按旧表（几何偏）。
        //   ⇒ 本方法把 `inserts[].nodes` 里的文本**就地度量**，并塞进请求的 `textMeasures`。
        //   ★度量规则与全量路径 `render` **逐字一致**（`fontSize ?? 14`）——
        //     两份规则分叉 ⇒ 增量插入的行与全量重建的行**尺寸不同**（且只差在不显眼处）。
        var req = (try? JSONSerialization.jsonObject(with: Data(spliceJson.utf8))) as? [String: Any] ?? [:]
        var measures: [String: [String: Double]] = [:]
        if let inserts = req["inserts"] as? [[String: Any]] {
            for ins in inserts {
                guard let nodes = ins["nodes"] as? [[String: Any]] else { continue }
                for n in nodes {
                    guard let text = n["text"] as? String, !text.isEmpty, let id = n["id"] as? Int else { continue }
                    let fontSize = (n["fontSize"] as? Double).map { CGFloat($0) } ?? 14
                    let fw = (n["fontWeight"] as? Double).map { CGFloat($0) } ?? 400
                    let fam = (n["fontFamily"] as? String) ?? "system"
                    let lh = n["lineHeight"] as? String
                    let sz = ProteusTextAdapter.measureText(text, fontSize: fontSize, fontWeight: fw, fontFamily: fam, lineHeight: lh, letterSpacing: (n["letterSpacing"] as? Double).map { CGFloat($0) } ?? 0)
                    measures["\(id)"] = ["width": Double(sz.width), "height": Double(sz.height)]
                }
            }
        }
        if !measures.isEmpty { req["textMeasures"] = measures }
        let effectiveJson: String = measures.isEmpty
            ? spliceJson
            : (jsonString2(req) as String)

        let out = effectiveJson.withCString { takeCString(proteus_layout_splice(handle, $0)) }
        let spliceMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        guard out.contains("\"ok\":true") else {
            return "{\"ok\":false,\"error\":\"splice 失败\",\"raw\":\(jsonEscape(String(out.prefix(300))))}"
        }
        let o = (try? JSONSerialization.jsonObject(with: Data(out.utf8))) as? [String: Any]
        let removed = (o?["removed"] as? Int) ?? 0
        let inserted = (o?["inserted"] as? Int) ?? 0
        let relayout = (o?["relayout_count"] as? Int) ?? 0

        // ★请求明细（removes/inserts）——宿主层维护的依据（核心只看几何，不看层）
        let reqObj = (try? JSONSerialization.jsonObject(with: Data(spliceJson.utf8))) as? [String: Any]
        let reqRemoves = (reqObj?["removes"] as? [Int]) ?? []
        let reqInserts = (reqObj?["inserts"] as? [[String: Any]]) ?? []

        // ① 摘除层子树
        view.resetSpliceCounters()
        for rid in reqRemoves { view.removeLayersSubtree(rootId: rid) }
        // ② 插入新层（几何由 ③ 统一设）
        let insertedLayers = view.insertLayers(reqInserts)

        // ③ 变化集 → 统一设帧（含新节点；按父链深度排序在 updateLayersIncremental 内）
        var changed: [(id: Int, abs: CGRect)] = []
        if let rm = o?["rects"] as? [String: [String: Double]] {
            for (k, r) in rm {
                guard let nid = Int(k) else { continue }
                changed.append((id: nid, abs: CGRect(x: r["x"] ?? 0, y: r["y"] ?? 0,
                                                    width: r["width"] ?? 0, height: r["height"] ?? 0)))
            }
        }
        // ★★**以核心为准收口层序**（见 applyChildOrder 注释：自行推导会分叉）
        let coreChildren = (o?["child_order"] as? [String: [Int]]) ?? [:]
        let co = view.applyChildOrder(coreChildren)
        // ★对**真实层序**对账（不是对宿主自报的簿记——后者刚被写过，必然相等 = 空判据）
        let recon = view.reconcileChildOrderLegacy(coreChildren: coreChildren)

        let tL = CFAbsoluteTimeGetCurrent()
        let updated = view.updateLayersIncremental(changed: changed, visibleOnly: SelfDrawBridge.optMode == "v4")
        let layersMs = (CFAbsoluteTimeGetCurrent() - tL) * 1000
        if updated < 0 {
            // ★层树与树结构分叉 ⇒ 必须重发整树（调用方据 full_required 走全量）
            return "{\"ok\":false,\"full_required\":true,\"error\":\"变化集与本地层不匹配（需全量重建）\"}"
        }
        let totalMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        let mem = physFootprintMB()
        SelfDrawBridge.memPeakMB = max(SelfDrawBridge.memPeakMB, mem)
        let t = (o?["timing"] as? [String: Any]) ?? [:]
        // ★插入文本的度量自检（见 insertedTextZeroHeight 的说明）——**设备侧判据**
        let tx = view.insertedTextZeroHeight()
        lastTiming = ["measure_ms": 0, "layout_ms": (spliceMs * 100).rounded() / 100,
                      "build_layers_ms": (layersMs * 100).rounded() / 100,
                      "host_total_ms": (totalMs * 100).rounded() / 100]
        return jsonString(["ok": true, "path": "splice", "incremental": true,
                           "in_bytes": spliceJson.count,
                           "removed": removed, "inserted": inserted,
                           "removed_layers": view.lastSpliceRemoved,
                           "inserted_layers": insertedLayers,
                           // ★内存回收读数（孤点压实：`[前, 后]` / 当前孤点数 / 节点总数）
                           "compacted": o?["compacted"] ?? NSNull(),
                           "orphans": o?["orphans"] ?? 0,
                           "core_node_count": o?["node_count"] ?? 0,
                           "child_order_applied": co.applied,
                           "child_order_missing": co.missing,
                           "child_order_checked": recon.checked,
                           "child_order_mismatches": recon.mismatches,
                           "inserted_text_layers": tx.text,
                           "inserted_text_zero_height": tx.zero,
                           "inserted_text_missing_geom": tx.missing,
                           "relayout_count": relayout,
                           "changed_rects": changed.count, "updated_layers": updated,
                           "splice_ms": round(spliceMs * 100) / 100,
                           "relayout_ms": round(((t["relayout_ms"] as? Double) ?? 0) * 100) / 100,
                           "layers_ms": round(layersMs * 100) / 100,
                           "layer_count": view.builtLayerCount,
                           "mem_mb": round(mem * 10) / 10,
                           "mem_peak_mb": round(SelfDrawBridge.memPeakMB * 10) / 10,
                           "host_total_ms": round(totalMs * 100) / 100])
    }

    /* ────────────────────────── ★V9：命中测试 → JS 派发 ────────────────────────── */

    /// ★★**触摸 → 命中（核心）→ 派发（JS）** 的唯一落点
    ///
    /// 【分工（本仓分层设计）】
    ///   · `SelfDrawView`：触摸 → **内容坐标** + tap 时序判定（不碰核心/JS）
    ///   · **本方法**：调核心 `proteus_layout_hit_test` 拿 `target` + **冒泡链 `chain`**
    ///   · JS 适配器 `dispatchEvent`：沿 chain 派发（DOM 冒泡语义，见其注释）
    ///
    /// 【为什么命中在核心而不是宿主自己算】本仓已有教训（层序/坐标系）：**同一事实只认一个来源**。
    ///   几何与可见性都在核心（含 `display:none`、overflow 裁剪）⇒ 宿主自己按 rectangle 叠层
    ///   判断必然与核心分歧（且分歧只在特定布局下暴露）。
    ///
    /// 【为什么把 chain 原样传下去】DOM 语义要求沿祖先链冒泡；核心已算好（含"子级溢出父盒"的
    ///   特例，见 hit.rs 模块头）⇒ 宿主与 JS 都**不该自己推**。
    func emitGesture(x: Double, y: Double, type: String) {
        guard handle != 0 else { return }
        let out = takeCString(proteus_layout_hit_test(handle, Float(x), Float(y)))
        guard let d = out.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              (o["ok"] as? Bool) == true else {
            gestureStats["hit_errors"] = (gestureStats["hit_errors"] as? Int ?? 0) + 1
            return
        }
        gestureStats["hits"] = (gestureStats["hits"] as? Int ?? 0) + 1
        // 未命中：只记账（不派发——没有 target 就没有 event.target）
        guard let target = o["target"] as? Int else {
            gestureStats["misses"] = (gestureStats["misses"] as? Int ?? 0) + 1
            return
        }
        let chain = (o["chain"] as? [Int]) ?? [target]
        // ★记录本次命中的 target/链长（诊断：见 tapAt 注释）
        gestureStats["last_target"] = target
        gestureStats["last_chain_len"] = chain.count
        // ★交给 JS（经 JSContext 从控制器注入；桥接层不直接持有 ctx，避免循环引用）
        // ★★A/B（矩阵 #14 续）：派发计数（`tapAt` 回传 `gestures_fired` 用——与 Android 同形，
        //   证明"这次注入真的触发了派发"而不是读到了上一次的陈旧值）。
        gestureDispatchCount += 1
        onDispatchToJS?(target, chain, type, x, y)
    }

    /// 派发次数（A/B 判据的 `gestures_fired` 来源；计的是**真的调了 JS 派发**的次数）
    private(set) var gestureDispatchCount = 0

    /// JS 派发回调（由控制器注入：调 `__proteus_dispatch`）
    var onDispatchToJS: ((Int, [Int], String, Double, Double) -> Void)?

    /// 手势统计（诊断：命中/未命中/错误——证明"触摸真的走到了核心"）
    private(set) var gestureStats: [String: Int] = [:]

    /// 见协议声明（`tapAt`）
    func tapAt(_ x: Double, _ y: Double) -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未建树\"}" }
        let before = gestureDispatchCount
        emitGesture(x: x, y: y, type: "tap")
        // ★回传**本次命中的 target/chain**（诊断必需——本仓实测：没有它就无法定位
        //   "宿主命中但 JS 没收到"是命中错节点、还是派发链断了）
        let lastTarget = gestureStats["last_target"] ?? -1
        let lastChain = gestureStats["last_chain_len"] ?? 0
        // ★★A/B（矩阵 #14 续）：与 Android `tapAt` 回执**同形**——共享 bundle 的判据读
        //   `gestures_fired`（本次是否真派发 ⇒ 防"读到陈旧 last"假读数）+ `last`（命中详情）。
        var out: [String: Any] = ["ok": true, "x": x, "y": y, "target": lastTarget,
                                  "chain_len": lastChain, "stats": gestureStats]
        out["gestures_fired"] = gestureDispatchCount - before
        out["last"] = lastTarget >= 0 ? ["target": lastTarget, "chain_len": lastChain] : NSNull()
        return jsonString(out)
    }

    /// 见协议声明（`longpressAt`）
    func longpressAt(_ x: Double, _ y: Double) -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未建树\"}" }
        emitGesture(x: x, y: y, type: "longpress")
        let lastTarget = gestureStats["last_target"] ?? -1
        let lastChain = gestureStats["last_chain_len"] ?? 0
        return jsonString(["ok": true, "x": x, "y": y, "target": lastTarget,
                           "chain_len": lastChain, "stats": gestureStats])
    }

    /// 见协议声明（`simulateTouch`）——★真触摸序列：喂 down→held→up 走 `classifyAndEmit`（按真实时长分流）。
    func simulateTouch(_ x: Double, _ y: Double, _ heldMs: Double) -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未建树\"}" }
        guard let v = view else { return "{\"ok\":false,\"error\":\"视图未建\"}" }
        let before = gestureDispatchCount
        _ = v.feedTouchSequence(x: x, y: y, heldMs: heldMs)
        let lastTarget = gestureStats["last_target"] ?? -1
        let lastChain = gestureStats["last_chain_len"] ?? 0
        return jsonString(["ok": true, "x": x, "y": y, "held_ms": heldMs,
                           "target": lastTarget, "chain_len": lastChain,
                           "touch_feeds": v.touchFeedCount,
                           "gestures_fired": gestureDispatchCount - before,
                           "stats": gestureStats])
    }

    /// ★矩阵 #7：**注入一次 swipe**（类型 = `swipe:<dir>`——与真实触摸路径的编码同形）。
    ///
    /// 【为什么不注入"down→moves→up"序列】本入口与 iOS/Android 的注入族同构（注入即声明类型，
    ///   见 `tapAt` 的诚实边界注释）；**真实时长/速度分流**由 `touchesEnded` 三分支承担
    ///   （真实触摸时按位移+速度判型）。参数 `dx/dy` 用于**方向推导**（与用户手势语义一致）。
    func swipeAt(_ x: Double, _ y: Double, _ dx: Double, _ dy: Double) -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未建树\"}" }
        let dir: String
        if abs(dx) > abs(dy) { dir = dx > 0 ? "right" : "left" }
        else { dir = dy > 0 ? "down" : "up" }
        emitGesture(x: x, y: y, type: "swipe:" + dir)
        let lastTarget = gestureStats["last_target"] ?? -1
        let lastChain = gestureStats["last_chain_len"] ?? 0
        return jsonString(["ok": true, "x": x, "y": y, "dx": dx, "dy": dy,
                           "direction": dir, "target": lastTarget,
                           "chain_len": lastChain, "stats": gestureStats])
    }

    /// 见协议声明（`gestureStatsJson`）
    func gestureStatsJson() -> String {
        jsonString(["ok": true, "stats": gestureStats])
    }

    /// ★高分辨率单调时钟（微秒）。用 mach_absolute_time + timebase 换算——
    ///   比 `CFAbsoluteTimeGetCurrent` 更适合**测量**（不受系统时间调整影响）。
    private static let timebase: mach_timebase_info_data_t = {
        var tb = mach_timebase_info_data_t()
        mach_timebase_info(&tb)
        return tb
    }()

    func scrollBy(_ dx: Double, _ dy: Double) -> String {
        guard let view = view else { return "{\"ok\":false,\"error\":\"无视图\"}" }
        // ★滚动 = 移动**内容**（视口固定）：根层的 sublayerTransform/position 平移 + 记账偏移
        //   （不用 UIScrollView——本自绘层树由 native-host 跟随，滚动是根层偏移）
        let off = view.applyContentOffset(dx: CGFloat(dx), dy: CGFloat(dy))
        // 显式触发补刷（确定性：测试里不依赖 UIKit 的回调时机）
        view.setNeedsLayout()
        view.layoutSubviews()
        return "{\"ok\":true,\"flushed\":\(view.lastFlushedCount),\"offsetY\":\(Double(off.y))}"
    }

    /// ★★**真手势滚动一步**（生产通路，2026-10-01）：拖拽增量 ⇒ ① 内容偏移 ② 内核按新位置驱动
    ///    ③ 当帧刷层 ④ 补刷滚入视野的待更新层。
    ///
    /// 【为什么这就是生产形态】真实产品里由**手指拖拽**触发（pan 识别器 → `driveScrollDrag` →
    ///   本方法）；JS 全程不在链路上。`scrollAnimSync` 只是它的 JSON 入口（同一实现，不分叉）。
    @discardableResult
    func scrollDragBy(dx: Double, dy: Double) -> String {
        guard let view = view, handle != 0 else { return "{\"ok\":false,\"error\":\"未接入\"}" }
        // ① 内容偏移（与 scrollBy 同一条路径）
        let off = view.applyContentOffset(dx: CGFloat(dx), dy: CGFloat(dy))
        // ② 内核按当前位置驱动窗口动画（**宿主只报位置**——换算在内核）
        let req = "{\"scroll\":\(Double(off.y))}"
        let out = req.withCString { takeCString(proteus_layout_anim_seek_scroll(handle, $0)) }
        // ③ 当帧刷层（与 animSeek 同一通道）
        let applied = applyAnimUpdates(fromJson: out)
        // ④ 与 scrollBy 一样补刷滚入视野的待更新层
        view.setNeedsLayout()
        view.layoutSubviews()
        let parsed = (try? JSONSerialization.jsonObject(with: out.data(using: .utf8) ?? Data())) as? [String: Any]
        let changed = (parsed?["changed"] as? NSNumber)?.intValue ?? 0
        return "{\"ok\":true,\"offsetY\":\(Double(off.y)),\"changed\":\(changed),\"applied\":\(applied)}"
    }

    /// ★★**MA5：滚动 + 动画同步**（生产形态——宿主滚动通路里直接驱动，零 JS 参与）
    ///
    /// 入参：`{"dx":0,"dy":120}`（滚动增量，px）。出参：`{ok, offsetY, changed, applied}`
    /// （实现 = `scrollDragBy`——同一语义一处实现）。
    func scrollAnimSync(_ json: String) -> String {
        guard view != nil, handle != 0 else { return "{\"ok\":false,\"error\":\"未接入\"}" }
        guard let data = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return "{\"ok\":false,\"error\":\"入参解析失败（需 {dx,dy}）\"}"
        }
        let dx = (o["dx"] as? NSNumber)?.doubleValue ?? 0
        let dy = (o["dy"] as? NSNumber)?.doubleValue ?? 0
        return scrollDragBy(dx: dx, dy: dy)
    }

    /// ★★**真手势滚动探针**（判据用）——驱动到 pan 处理器的**同一条出口**（`driveScrollDrag`）。
    ///
    /// 【证明什么 / 不证明什么（诚实边界）】iOS 没有公开 API 合成 `UITouch` ⇒ 判据无法伪造
    ///   "真手指"。本探针证明的是：① 真 `UIPanGestureRecognizer` **已装在视图上**
    ///   （`recognizer_installed`）；② 它的**唯一出口**（`driveScrollDrag → onScrollDrag →
    ///   scrollDragBy`）被驱动 N 次后，内容偏移与**内核滚动联动**都真实推进（逐次读数）。
    ///   "手指产生 pan 事件"是 UIKit 的契约（Android 腿用**真实 MotionEvent 序列**走
    ///   `onTouchEvent` 覆盖到触摸层——见 check-kernel-anim.py M6）。
    ///
    /// 入参 `{"dy":25,"steps":8}`；出参含逐次 `changed` 与端点 offset/层位读法给判据。
    func panDragProbe(_ json: String) -> String {
        guard let view = view, handle != 0 else { return "{\"ok\":false,\"error\":\"未接入\"}" }
        guard let data = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return "{\"ok\":false,\"error\":\"入参解析失败（需 {dy,steps}）\"}"
        }
        let dy = (o["dy"] as? NSNumber)?.doubleValue ?? 25
        let steps = max(1, (o["steps"] as? NSNumber)?.intValue ?? 8)
        let installed = view.hasScrollPanRecognizer
        let wired = view.onScrollDrag != nil
        let before = Double(view.contentOffset.y)
        var changedTotal = 0
        var appliedTotal = 0
        var perStepChanged: [Int] = []
        for _ in 0..<steps {
            let stepOut = parseObject(view.driveScrollDrag(dx: 0, dy: CGFloat(dy)))
            perStepChanged.append((stepOut?["changed"] as? NSNumber)?.intValue ?? 0)
            changedTotal += (stepOut?["changed"] as? NSNumber)?.intValue ?? 0
            appliedTotal += (stepOut?["applied"] as? NSNumber)?.intValue ?? 0
        }
        let after = Double(view.contentOffset.y)
        return jsonString([
            "ok": true,
            "recognizer_installed": installed,
            "wired": wired,
            "steps": steps,
            "dy": dy,
            "drive_count": view.scrollDragDriveCount,
            "offset_y_before": before,
            "offset_y_after": after,
            "changed_total": changedTotal,
            "applied_total": appliedTotal,
            "per_step_changed": perStepChanged,
        ])
    }

    /// 小工具：解析对象（探针/判据读数用；非对象 ⇒ nil，不抛）
    private func parseObject(_ s: String) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: s.data(using: .utf8) ?? Data())) as? [String: Any]
    }

    /// 小工具：字典 → JSON 串（探针返回用；失败 ⇒ 兜底错误串，不静默）
    private func jsonString(_ o: [String: Any]) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: o),
              let s = String(data: d, encoding: .utf8) else { return "{\"ok\":false,\"error\":\"json 序列化失败\"}" }
        return s
    }

    /// 小工具：数组 → JSON 串（`samplePixels` 吃裸数组——见其签名）
    private func jsonStringList(_ a: [[String: Double]]) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: a),
              let s = String(data: d, encoding: .utf8) else { return "[]" }
        return s
    }

    /// ★★V5：批量像素采样（渲染一次 → 读 N 个点）
    ///
    /// 【为什么"渲染一次读多点"】逐点调用会各渲染一次（每次 `layer.render` 都不便宜）；
    ///   采样点通常十几个 ⇒ 一次渲染 + 多次读取，成本降一个量级。
    func samplePixels(_ json: String) -> String {
        guard let view = view else { return "{\"ok\":false,\"error\":\"无视图\"}" }
        guard let data = json.data(using: .utf8),
              let pts = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Double]] else {
            return "{\"ok\":false,\"error\":\"points 解析失败（需数组）\"}"
        }
        let size = view.bounds.size
        guard size.width > 0, size.height > 0 else {
            return "{\"ok\":false,\"error\":\"视图尺寸为 0\"}"
        }
        // ★渲染一次（与 snapshot 同款：layer.render —— UIKit 的 snapshotView 不含 CALayer 子层）
        //
        // ★★**自己建位图上下文 + 显式指定像素格式**（不再读系统给的那个）
        //
        // 【为什么（本仓实测的第十个测量装置缺陷）】首版直接用 `UIGraphicsImageRenderer`
        //   产出的 CGImage、按 `(ptr[0],ptr[1],ptr[2])` 当 RGB 读。作者当时**确实做了三色标定**，
        //   标定读数也正确（纯红→`#0000FF`），但**结论推反了**：那组读数证明的是 **BGRA 布局**
        //   （byte0=蓝），却被写成了"本机是 RGBA 布局"⇒ R/B 至今互换。
        //   ★为什么长期没被发现：**此前所有像素判据都用纯绿**（`#00FF00`），而绿在 R/B 互换下
        //   **不变** ⇒ 判据恒绿。本轮的紫色圆点（`#6F4AE8`）第一次让互换暴露为 `#E84A6F`。
        //   ⇒ 正解：不猜系统格式，`CGBitmapInfo` 显式声明 `byteOrder32Big | premultipliedLast`
        //     （= 内存里恒为 R,G,B,A），与设备/系统无关。
        // I2-ALLOW: 像素缓冲尺寸（测量装置自身的位图；非布局几何）
        let w = Int(size.width.rounded())
        let h = Int(size.height.rounded())
        guard w > 0, h > 0 else { return "{\"ok\":false,\"error\":\"视图尺寸为 0\"}" }
        let bpr = w * 4
        var buf = [UInt8](repeating: 0, count: bpr * h)
        let cgOut: CGImage? = buf.withUnsafeMutableBytes { raw -> CGImage? in
            guard let base = raw.baseAddress,
                  let ctx = CGContext(data: base, width: w, height: h, bitsPerComponent: 8,
                                      bytesPerRow: bpr, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                                          | CGBitmapInfo.byteOrder32Big.rawValue) else { return nil }
            // 与 UIGraphicsImageRenderer 同一条渲染路径（只是目标上下文由我们指定）
            UIGraphicsPushContext(ctx)
            // ★★**必须翻转 CTM**（本仓实测：自建上下文的第一版就踩了，被 V5 标定判据当场抓出）
            //
            // 【为什么】CoreGraphics 的原点在**左下**（y 向上），UIKit 在**左上**（y 向下）——
            //   `UIGraphicsImageRenderer` 给的是**已翻转**的上下文，而手建 CGContext **不是**。
            //   ⇒ 不翻转则渲染结果**上下颠倒**（现象：采样 y 越大命中的行越靠上）。
            //   ★实测证据：期望行 24/28/32（屏幕 y 递增）却读到 30/26/22 —— 正是翻转的特征；
            //     按 `raster_y ↦ UIKit_y = H − raster_y` 反推可**逐点命中**（不是玄学，是可验证的）。
            ctx.translateBy(x: 0, y: CGFloat(h))
            ctx.scaleBy(x: 1, y: -1)
            view.layer.render(in: ctx)
            UIGraphicsPopContext()
            return ctx.makeImage()
        }
        guard cgOut != nil else { return "{\"ok\":false,\"error\":\"位图上下文创建失败\"}" }
        var out: [String] = []
        for p in pts {
            let x = Int(p["x"] ?? 0)
            let y = Int(p["y"] ?? 0)
            guard x >= 0, y >= 0, x < w, y < h else {
                out.append("out-of-bounds")
                continue
            }
            // ★格式已显式声明为 byteOrder32Big|premultipliedLast ⇒ 内存序恒为 R,G,B,A
            let off = y * bpr + x * 4
            let r = buf[off], g = buf[off + 1], b = buf[off + 2]
            out.append(String(format: "#%02X%02X%02X", r, g, b))
        }
        let payload: [String: Any] = ["ok": true, "pixels": out, "size": ["w": Double(w), "h": Double(h)]]
        return jsonString(payload)
    }

    /// ★★**像素格式自检**（测量装置必须先自测——本仓纪律）
    ///
    /// 在**同一个上下文配置**下画三块纯色并读回，返回"期望 → 实得"的映射。
    /// 判据：`ok == true`（三色全对 **且** 方向正确）。这不是"顺手加的"，而是**像素判据的前置**——
    /// 采样装置错了，它给的一切读数都是错的（本轮连踩两处：R/B 互换 + 自建上下文未翻转）。
    ///
    /// ★为什么还要测**方向**（色标定测不出来）：色标定只验证"通道映射"，而**垂直翻转**
    ///   会让"通道全对、位置全错"——现象是"每个点都取到了另一个位置的合法颜色"
    ///   （本轮实测：期望行 24/28/32 读到 30/26/22）。
    ///   ⇒ 加一块"上红下蓝"的竖条：栅格 y=0 必须是红、y=h-1 必须是蓝。
    func pixelFormatSelfTest() -> String {
        var probes: [String: Any] = [:]
        var allOk = true
        for (name, color) in [("red", UIColor.red), ("green", UIColor.green), ("blue", UIColor.blue)] {
            let w = 4, h = 4, bpr = 16
            var buf = [UInt8](repeating: 0, count: bpr * h)
            buf.withUnsafeMutableBytes { raw in
                guard let base = raw.baseAddress,
                      let ctx = CGContext(data: base, width: w, height: h, bitsPerComponent: 8,
                                          bytesPerRow: bpr, space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                                              | CGBitmapInfo.byteOrder32Big.rawValue) else { return }
                ctx.setFillColor(color.cgColor)
                ctx.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
            }
            let got = String(format: "#%02X%02X%02X", buf[0], buf[1], buf[2])
            let expect = name == "red" ? "#FF0000" : (name == "green" ? "#00FF00" : "#0000FF")
            let pass = got == expect
            allOk = allOk && pass
            probes[name] = ["expect": expect, "got": got, "pass": pass]
        }
        // ★方向自检：上红下蓝（用与 samplePixels **完全同一条**建上下文+翻转代码路径）
        let w = 4, h = 8, bpr = 16
        var buf2 = [UInt8](repeating: 0, count: bpr * h)
        buf2.withUnsafeMutableBytes { raw in
            guard let base = raw.baseAddress,
                  let ctx = CGContext(data: base, width: w, height: h, bitsPerComponent: 8,
                                      bytesPerRow: bpr, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                                          | CGBitmapInfo.byteOrder32Big.rawValue) else { return }
            // ★与 samplePixels 一致的翻转（漏了这步 ⇒ 上下颠倒）
            ctx.translateBy(x: 0, y: CGFloat(h))
            ctx.scaleBy(x: 1, y: -1)
            ctx.setFillColor(UIColor.red.cgColor)                 // UIKit 上半（y 小）
            ctx.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
            ctx.setFillColor(UIColor.blue.cgColor)                // UIKit 下半（y 大）
            ctx.fill(CGRect(x: 0, y: 4, width: 4, height: 4))
        }
        let top = String(format: "#%02X%02X%02X", buf2[0], buf2[1], buf2[2])
        let bottom = String(format: "#%02X%02X%02X", buf2[(h - 1) * bpr], buf2[(h - 1) * bpr + 1], buf2[(h - 1) * bpr + 2])
        let orientOk = top == "#FF0000" && bottom == "#0000FF"
        allOk = allOk && orientOk
        probes["orientation"] = ["expect": "top=#FF0000 bottom=#0000FF",
                                 "got": "top=\(top) bottom=\(bottom)", "pass": orientOk,
                                 "note": "栅格 y 递增必须对应 UIKit y 递增（上红下蓝）"]
        return jsonString(["ok": allOk, "probes": probes,
                           "format": "byteOrder32Big|premultipliedLast + CTM 翻转（显式声明）"])
    }

    /// 见协议声明（`clearTree`）
    func clearTree() -> String {
        if handle != 0 { _ = proteus_layout_destroy(handle); handle = 0 }
        if recycleHandle != 0 { proteus_recycle_destroy(recycleHandle); recycleHandle = 0 }
        view?.clearLayers()
        lastNodes = []
        lastGeom.removeAll(keepingCapacity: true)
        return "{\"ok\":true,\"cleared\":true}"
    }

    /// 见协议声明（`registerFont`）——支持 `path`（打包字体）或 `systemName`（系统字体名）
    func registerFont(_ json: String) -> String {
        guard let d = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let family = o["family"] as? String else {
            return "{\"ok\":false,\"error\":\"入参需 {family, path|systemName}\"}"
        }
        let path = o["path"] as? String ?? ""
        let systemName = o["systemName"] as? String ?? ""
        var ok = false
        if !path.isEmpty { ok = ProteusTextAdapter.registerFont(family: family, path: path) }
        if !ok && !systemName.isEmpty { ok = ProteusTextAdapter.registerSystemFont(family: family, systemName: systemName) }
        return jsonString(["ok": ok, "registered": ok,
                           "registered_fonts": ProteusTextAdapter.registeredFontCount,
                           "family": family, "path": path, "system_name": systemName])
    }

    /// 见协议声明（`customFontStats`）
    func customFontStats() -> String {
        jsonString([
            "ok": true,
            "registered_fonts": ProteusTextAdapter.registeredFontCount,
            "custom_font_misses": ProteusTextAdapter.customFontMisses,
            "last_missing_custom_font": ProteusTextAdapter.lastMissingCustomFont,
            "font_family_fallbacks": ProteusTextAdapter.fontFamilyFallbackCount,
        ])
    }

    func pendingStats() -> String {
        guard let view = view else { return "{\"ok\":false}" }
        return "{\"ok\":true,\"pending\":\(view.pendingCount),\"last_flushed\":\(view.lastFlushedCount),\"last_deferred\":\(view.lastDeferredCount)}"
    }

    /// V4 优化开关（默认开；A/B 时置 'v3'）
    static var optMode = "v4"

    func setOptMode(_ mode: String) -> String {
        SelfDrawBridge.optMode = (mode == "v3") ? "v3" : "v4"
        return "{\"ok\":true,\"mode\":\"\(SelfDrawBridge.optMode)\"}"
    }

    /* ────────────────────────── ★★RT2：指令驱动动画（宿主侧） ────────────────────────── */

    /// ★★**启动动画**（一次性批量）：入参透传给内核（`{anims:[{nodeId,kind,curve,from,to,durMs,drive?}]}`）
    ///
    /// 【为什么"批量"很重要】转场经常一次启动几十~几百条（每行一个元素）；逐条跨边界调用
    ///   会把"每帧 1 次"的收益又还回去。
    /// ★批次 42：上一棵树里带 CSS animation 的节点数（读数）
    var cssAnimNodes = 0

    /// ★批次 42（动效）：启动编译期折叠的 **CSS animation**（与 Android 同一报文形态）。
    @discardableResult
    func startCssAnimations(flat: [(id: Int, parentId: Int?, rect: CGRect, style: [String: Any])]) -> Int {
        var anims: [[String: Any]] = []
        var nodes = 0
        for item in flat {
            guard let chans = item.style["animation"] as? [[String: Any]] else { continue }
            var any = false
            for ch in chans {
                guard let kf = ch["keyframes"] as? [[String: Any]], !kf.isEmpty else { continue }
                var total = 0.0
                var lastTo = (ch["from"] as? NSNumber)?.doubleValue ?? 0
                for seg in kf {
                    total += (seg["durMs"] as? NSNumber)?.doubleValue ?? 0
                    if let t = seg["to"] as? NSNumber { lastTo = t.doubleValue }
                }
                anims.append(["nodeId": item.id, "kind": (ch["kind"] as? NSNumber)?.intValue ?? 0,
                              "from": (ch["from"] as? NSNumber)?.doubleValue ?? 0, "to": lastTo,
                              "durMs": total, "keyframes": kf])
                any = true
            }
            if any { nodes += 1 }
        }
        guard !anims.isEmpty, let data = try? JSONSerialization.data(withJSONObject: ["anims": anims]),
              let json = String(data: data, encoding: .utf8) else { return 0 }
        _ = animStart(json)
        _ = animStartFrameLoop()
        return nodes
    }

    func animStart(_ json: String) -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未接入核心\"}" }
        let out = json.withCString { takeCString(proteus_layout_anim_start(handle, $0)) }
        return out
    }

    /// 内核绝对几何（见协议注释：编舞要基于**当前**位置）
    func rects() -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未接入核心\"}" }
        return takeCString(proteus_layout_rects(handle))
    }

    /// ★★A/B：与 Android `readRects()` **同形**——内核几何真源的别名（判据用；两处同名便于判据对照）
    func readRects() -> String {
        rects()
    }

    /// ★★**离屏像素自检**（2026-10-03 · 三端对齐：判据 ④ 的 iOS 腿）——
    ///   把层树渲染到离屏位图，数"与背景色不同"的像素。
    ///
    /// 【为什么需要】判据 ④ 要"渲染真的发生了"的**宿主侧独立证据**（不信 JS 自报）。
    ///   Android 用 `onDraw` 期间的绘制采样数、鸿蒙用 `host_painted_samples`；
    ///   iOS 无同款计数器 ⇒ **离屏渲染一遍数像素**：`CALayer.render(in:)` 走的是 Core Animation
    ///   的真实绘制路径——层上真画了内容才计数（空层/没建层 ⇒ 恒 0 ⇒ 判据能红）。
    /// 【背景判定】本模式把 view 底色设为 #14141c（见 `driveVapor`）——与背景差超容差的即计"画过"
    ///   （抗锯齿边缘也计入 ⇒ 下限 1000 极易满足、不会假红；而"什么都没画"必红）。
    func paintedPixelProbe() -> (samples: Int, colors: Int) {
        guard let view = view, view.bounds.width >= 1, view.bounds.height >= 1 else { return (0, 0) }
        view.layoutIfNeeded()
        // I2-ALLOW: 离屏位图缓冲尺寸（CGContext 分配必须整数像素）——测量/位图，非几何指令
        let w = Int(view.bounds.width.rounded()), h = Int(view.bounds.height.rounded())
        let cs = CGColorSpaceCreateDeviceRGB()
        guard let bctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8,
                                   bytesPerRow: w * 4, space: cs,
                                   bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return (0, 0) }
        view.layer.render(in: bctx)
        guard let raw = bctx.data else { return (0, 0) }
        let px = raw.bindMemory(to: UInt8.self, capacity: w * h * 4)
        var painted = 0
        var colors = Set<UInt32>()
        for i in stride(from: 0, to: w * h * 4, by: 4) {
            let r = Int(px[i]), g = Int(px[i + 1]), b = Int(px[i + 2]), a = Int(px[i + 3])
            if a <= 0 { continue }
            let nearBg = abs(r - 0x14) < 8 && abs(g - 0x14) < 8 && abs(b - 0x1C) < 8
            if !nearBg {
                painted += 1
                colors.insert(UInt32(r) << 16 | UInt32(g) << 8 | UInt32(b))
            }
        }
        return (painted, colors.count)
    }

    /// ★★A/B：绘制通道探针（转发给视图；见 `SelfDrawView.channelProbe`）
    ///
    /// 【为什么经 View 读（而不是 Bridge 自己算）】层与各通道表都在 View 上
    ///   （`layersById`/`layerGradients`/…）——**判据要读的是层上的实际状态**，
    ///   Bridge 侧没有这些真源（与 `layerTransformProbe` 同款转发模式）。
    func probeChannels(_ idsJson: String) -> String {
        guard let view else { return "{\"ok\":false,\"error\":\"未接入视图\"}" }
        return view.channelProbe(idsJson)
    }

    /// ★★A/B：**注册手势回调名**（与 Android `onGesture(name)` 同语义——宿主 tapAt 时反向调用它）
    ///
    /// 【为什么是"注册名字"而不是"传函数"】JSExport 不能跨边界传闭包（Android 用 JNI 反向调用
    ///   全局函数 `__proteusVaporGesture` 也是同一个模式：**宿主持名字，事件时按名查全局函数**）。
    ///   存储后由 `tapAt` 经 JSContext 调 `globalThis[name](type, nodeId, chainJson)`。
    /// ★`private(set)`：VC 注入的派发闭包要**读**它（首版 `private` ⇒ 跨类不可见）
    private(set) var gestureCallbackName: String?

    func onGesture(_ name: String) -> String {
        gestureCallbackName = name
        return "{\"ok\":true,\"registered\":\"\\(name)\"}"
    }

    /// ★★**停全部动画 + 复位变换**（相位间状态清理用；见 bench 注释）
    func animStopAll() -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未接入核心\"}" }
        let out = "{\"all\":true}".withCString { takeCString(proteus_layout_anim_stop(handle, $0)) }
        // 顺带把层上的变换复位（否则层还显示上一次相位留下的姿态）
        view?.resetAllTransforms()
        return out
    }

    /// ★★**按节点停动画**（§7.3）：宿主行回收自动调用；也暴露给判据做破坏性验证
    func animStopNodes(_ idsJson: String) -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未接入核心\"}" }
        return idsJson.withCString { takeCString(proteus_layout_anim_stop(handle, $0)) }
    }

    /* ────────────────── ★★MA0-RT：平台零参与路径（Bridge 层） ────────────────── */

    /// ★★**提交一次 ⇒ 平台自主插值**（MA0-RT 的核心入口）
    ///
    /// 流程：① 调内核拿**提交规格**（含合成属性判定 `plan` + 节点级采样）；
    ///      ② `plan.composited=false` ⇒ **明确返回错误**（不静默降级——Morpheus §5-bis.2 要求）；
    ///      ③ 逐 spec 构造 `CAKeyframeAnimation` 提交给 CoreAnimation render server；
    ///      ④ 交接：内核已把这些动画**摘出**（`detach_nodes`，见 FFI 注释）⇒ 之后 tick 不再碰它们。
    ///
    /// ★此后**主线程零参与**：动画由 **CoreAnimation render server（独立进程）** 自主插值。
    func animCommit(_ json: String) -> String {
        guard handle != 0, let view else { return "{\"ok\":false,\"error\":\"未接入\"}" }
        let specJson = json.withCString { takeCString(proteus_layout_anim_commit_spec(handle, $0)) }
        guard let d = specJson.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else {
            return "{\"ok\":false,\"error\":\"规格解析失败\",\"raw\":\(jsonEscape(String(specJson.prefix(200))))}"
        }
        guard (o["ok"] as? Bool) == true else {
            return "{\"ok\":false,\"error\":\"内核拒绝\",\"raw\":\(jsonEscape(String(specJson.prefix(300))))}"
        }
        let plan = (o["plan"] as? [String: Any]) ?? [:]
        let composited = (plan["composited"] as? Bool) ?? false
        if !composited {
            // ★**不静默降级**（§5-bis.2）：非合成属性必须由上层显式处理
            let bad = (plan["nonCompositedKinds"] as? [Int]) ?? []
            return "{\"ok\":false,\"error\":\"含非合成属性，不能走平台零参与路径\",\"nonCompositedKinds\":\(bad)}"
        }
        let specs = (o["specs"] as? [[String: Any]]) ?? []
        var committed = 0
        for sp in specs where view.commitKeyframeAnimation(spec: sp) {
            committed += 1
        }
        // ★采样极值（scale 分量 = samples[i][2]）：让判据能证明"提交出去的采样**真的经过**了
        //   序列的各段"——只断言 "committed=1" 无法区分"三段序列"与"退化成单段"（MA6 J4）
        var scaleMin = Double.greatestFiniteMagnitude
        var scaleMax = -Double.greatestFiniteMagnitude
        for sp in specs {
            for row in (sp["samples"] as? [[Double]]) ?? [] where row.count >= 5 {
                scaleMin = Swift.min(scaleMin, row[2])
                scaleMax = Swift.max(scaleMax, row[2])
            }
        }
        let rangeJson = scaleMax > scaleMin
            ? "\"scaleMin\":\(scaleMin),\"scaleMax\":\(scaleMax)"
            : "\"scaleMin\":null,\"scaleMax\":null"
        // ★把 plan 一并返回（判据要断言"合成属性判定"，见 check-anim-rt2.py G1）
        return "{\"ok\":true,\"committed\":\(committed),\"specs\":\(specs.count),\(rangeJson),"
            + "\"plan\":{\"composited\":true,"
            + "\"nodeCount\":\(plan["nodeCount"] ?? 0),\"animCount\":\(plan["animCount"] ?? 0)}}"
    }

    /// **presentation 层探针**（证明"平台自己在插值"——见 `SelfDrawView.layerPresentedProbe`）
    func layerPresentedProbe(_ idsJson: String) -> String {
        guard let view else { return "{\"ok\":false,\"error\":\"未接入视图\"}" }
        return view.layerPresentedProbe(idsJson)
    }

    /// **撤销平台动画**（相位间清理）
    func animRemovePlatform(_ idsJson: String) -> String {
        guard let view else { return "{\"ok\":false,\"error\":\"未接入视图\"}" }
        guard let d = idsJson.data(using: .utf8),
              let ids = (try? JSONSerialization.jsonObject(with: d)) as? [Int] else {
            return "{\"ok\":false,\"error\":\"入参需为 id 数组\"}"
        }
        view.removePlatformAnimations(ids)
        return "{\"ok\":true,\"removed\":\(ids.count)}"
    }

    /// ★★**FLIP 布局动画**（招牌能力）：`op=capture` 记快照 / `op=start` 启动补间
    ///
    /// ★为什么这是招牌（Morpheus §5）：几何本来就在内核 ⇒ 两次快照都是内部读，
    ///   **零跨边界几何查询**（传统 FLIP 要前后各读一次）。
    func animFlip(_ json: String) -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未接入核心\"}" }
        let out = json.withCString { takeCString(proteus_layout_flip(handle, $0)) }
        // ★★`start` 的初始位置必须**立即上屏**（否则首帧跳变——见 FlipOutcome.updates 注释）：
        //   本方法把返回里的 updates 当帧应用（与 animSeek 同一通道）。
        applyAnimUpdates(fromJson: out)
        return out
    }

    /// 层变换探针（转发给视图；见 `SelfDrawView.layerTransformProbe`）
    func layerTransformProbe(_ idsJson: String) -> String {
        guard let view else { return "{\"ok\":false,\"error\":\"未接入视图\"}" }
        return view.layerTransformProbe(idsJson)
    }

    /// ★★**接线：行回收 ⇒ 动画解绑**（§7.3；由 `attachRowRecycleUnbind()` 一次性安装）
    ///
    /// 【为什么用回调注入而不是让 View 直接调 FFI】句柄（handle）在 Bridge 上；View 不该持有它
    ///   （职责分离，且句柄生命周期由 Bridge 管）。与本文件 onGesture/onFrame 同一模式。
    private var recycleUnbindInstalled = false

    /// 安装「行回收 ⇒ 动画解绑」（幂等；`mountVirtual` 时自动调用）
    func attachRowRecycleUnbind() {
        guard !recycleUnbindInstalled, let view else { return }
        recycleUnbindInstalled = true
        view.onRowDematerialized = { [weak self] ids in
            guard let self, self.handle != 0, !ids.isEmpty else { return }
            let json = "{\"nodeIds\":[" + ids.map { String($0) }.joined(separator: ",") + "]}"
            _ = json.withCString { takeCString(proteus_layout_anim_stop(self.handle, $0)) }
        }
    }

    /// ★★**启动帧循环**（把 CADisplayLink 的 dt 直接喂给内核 tick）
    ///
    /// 【接线语义（一句话）】屏幕每 vsync 一次 ⇒ 内核 tick 一次 ⇒ 变换写回层。
    ///   全过程**不经 JS**（这正是 RT0 验证的"指令驱动"在宿主侧的落地点）。
    func animStartFrameLoop() -> String {
        guard let view else { return "{\"ok\":false,\"error\":\"未接入视图\"}" }
        view.onFrame = { [weak self] dtMs in
            _ = self?.animTick(dtMs)
        }
        _ = view.startFrameLoop()
        return "{\"ok\":true,\"running\":\(view.frameLoopRunning)}"
    }

    func animStopFrameLoop() -> String {
        guard let view else { return "{\"ok\":false,\"error\":\"未接入视图\"}" }
        view.stopFrameLoop()
        view.onFrame = nil
        return "{\"ok\":true,\"running\":\(view.frameLoopRunning)}"
    }

    /// 帧循环读数（`frames` 与 `frame_ms`：证明驱动真的在跑、且 dt 是真实 vsync 间隔）
    func animFrameStats() -> String {
        guard let view else { return "{\"ok\":false,\"error\":\"未接入视图\"}" }
        return "{\"ok\":true,\"running\":\(view.frameLoopRunning),\"frames\":\(view.frameCount),\"frame_ms\":\(view.lastFrameMs)}"
    }

    /// ★★带底色的节点清单（颜色动画的取样入口；2026-10-01）
    ///
    /// 【为什么必须有（真机判据抓出的取样缺陷）】节点 id 由适配器/Vue 动态分配，
    ///   调用方无法预知哪个 id 有底色 ⇒ 盲试 + 兜底 `?? 2` 会让判据判红且原因误导。
    ///   本入口把"谁有底色"的问答案交回**内核**（唯一事实源）。
    func bgNodes() -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未接入核心\"}" }
        return takeCString(proteus_layout_bg_nodes(handle))
    }

    /// ★★带文字色的节点清单（与 `bgNodes` 对称：两条轨道各自的取样入口）
    func textColorNodes() -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未接入核心\"}" }
        return takeCString(proteus_layout_text_color_nodes(handle))
    }

    /// ★★C1：带裁剪形状的节点清单（同款取样纪律——见内核 `proteus_layout_clip_nodes` 注释）
    func clipNodes() -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未接入核心\"}" }
        return takeCString(proteus_layout_clip_nodes(handle))
    }

    /// ★★C2：带 SVG 路径的节点清单（描边动画的取样入口）
    func svgNodes() -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未接入核心\"}" }
        return takeCString(proteus_layout_svg_nodes(handle))
    }

    /// ★仍在推进的动画条数（0 = 全部结束）——**幕切换的权威判据**
    func animControl(_ json: String) -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未接入核心\"}" }
        return json.withCString { takeCString(proteus_layout_anim_control(handle, $0)) }
    }

    func animActiveCount() -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未接入核心\"}" }
        return "{\"ok\":true,\"active\":\(proteus_layout_anim_active(handle))}"
    }

    /// ★★**手势驱动进度**（方案 §4.2 的 ANIM_SEEK）：手指到哪，值到哪
    ///
    /// ★语义关键：内核**立即求值并写字段**（不等下一帧）+ 返回 `updates` ⇒ 本方法应用变换后
    ///   当帧即可见 ⇒ "手势跟随延迟 ≤ 1 帧"由宿主刷新时机决定，不引入内核侧累积。
    func animSeek(_ json: String) -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未接入核心\"}" }
        let out = json.withCString { takeCString(proteus_layout_anim_seek(handle, $0)) }
        applyAnimUpdates(fromJson: out)
        return out
    }

    /// ★★**MA5 滚动驱动**：滚动位置 → 内核（窗口换算 + 曲线 + 写字段）→ 当帧刷层
    ///
    /// 【生产语义（一句话）】滚动回调用**原始滚动位置**调这里 ⇒ 视差/吸顶/渐显全部当帧更新，
    ///   JS 与曲线数学都不在链路上（换算唯一实现在内核 `AnimEngine::seek_scroll`）。
    func animSeekScroll(_ json: String) -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未接入核心\"}" }
        let out = json.withCString { takeCString(proteus_layout_anim_seek_scroll(handle, $0)) }
        applyAnimUpdates(fromJson: out)
        return out
    }

    /// ★★**共享元素（跨元素飞行）**：源 → 目标（几何在内核）→ **层级提升** → 当帧写层
    ///
    /// 【为什么在这里做层级提升】飞行中的元素会**越过**它所在的容器边界（缩略图飞向大图的路上
    ///   会压过中间的内容）。CALayer 的绘制顺序由 sublayer 顺序决定 ⇒ 必须临时抬 `zPosition`。
    ///   内核只管**几何**（它不知道层序）；层序是宿主的知识 ⇒ 这一半落在宿主（职责边界）。
    ///
    /// 【为什么结束时复位】`zPosition` 是**持久状态**：不复位的话，该元素在后续所有相位里
    ///   都压着兄弟节点（典型的"看起来对、交互错位"）。⇒ 飞行结束后 `setLayerZ(ids, z=0)` 复位。
    func sharedElement(_ json: String) -> String {
        guard handle != 0, let view else { return "{\"ok\":false,\"error\":\"未接入\"}" }
        let out = json.withCString { takeCString(proteus_layout_shared_element(handle, $0)) }
        // ★★**内核错误必须原样透传**（真机 K5 抓出的宿主缺陷）：首版无脑 `"ok": true`，
        //   把内核的 `{ok:false,error}` 吞掉 ⇒ "目标节点不存在"被伪装成"飞行成功但 dx=0"。
        //   本仓红线是"不静默降级"——宿主的职责是**通道**，不是把失败改写成成功。
        if let d = out.data(using: .utf8),
           let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
           (o["ok"] as? Bool) != true {
            let err = (o["error"] as? String) ?? "内核拒绝（无错误详情）"
            return "{\"ok\":false,\"error\":\(jsonEscape(err))}"
        }
        // ① 首帧起点当帧上屏（否则首帧跳变——与 FLIP 同一条教训）
        let applied = applyAnimUpdates(fromJson: out)
        // ② 层级提升（飞行期间浮在最上）
        var targetId = 0
        var zLifted = 0
        if let d = out.data(using: .utf8),
           let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
           let tid = (o["targetId"] as? NSNumber)?.intValue {
            targetId = tid
            zLifted = view.setLayerZ(ids: [tid], z: 2)
        }
        var result: [String: Any] = [
            "ok": true, "applied": applied, "targetId": targetId, "zLifted": zLifted,
        ]
        // 透传内核几何（判据要用 dx/dy/scale 对账）
        if let d = out.data(using: .utf8),
           let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
            for k in ["dx", "dy", "scale", "fromRect", "toRect"] where o[k] != nil {
                result[k] = o[k]
            }
        }
        return jsonString(result)
    }

    /// **层级提升 / 复位**（见协议声明）
    func setLayerZ(_ json: String) -> String {
        guard let view else { return "{\"ok\":false,\"error\":\"无视图\"}" }
        guard let d = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let ids = o["ids"] as? [Int] else {
            return "{\"ok\":false,\"error\":\"入参需为 {ids:[…], z?}\"}"
        }
        let z = (o["z"] as? NSNumber)?.floatValue ?? 1
        let n = view.setLayerZ(ids: ids, z: z)
        return "{\"ok\":true,\"set\":\(n)}"
    }

    /// **读层的 zPosition**（判据用：证明飞行元素**真的**在别人之上——见 view 上的同名方法）
    func layerZProbe(_ idsJson: String) -> String {
        guard let view else { return "{\"ok\":false,\"error\":\"无视图\"}" }
        return view.layerZProbe(idsJson)
    }

    /// 每帧动画更新记录的字节长度：
    /// `id u32 + tx/ty/scale/rotate/opacity（五个 f32）+ bg u32 + textColor u32`
    ///
    /// ★★2026-10-01 由 **24B → 28B（底色）→ 32B（文字色）→ 40B（3D 旋转）→ 108B（裁剪）**
    ///   **→ 112B（描边）→ 184B（渐变 v2）→ 188B（路径变形 v1）→ 192B（发光 v1）→ 208B（渐变几何）**：末两个 u32 都是**打包色**
    ///   `0xAARRGGBB`，值 `0xFFFFFFFF` = **本节点无该基色**（忽略该字段，保持静态绘制）。
    ///   ★唯一事实源 = 内核 `ffi.rs::proteus_layout_anim_tick_bin` 的 8 个 `extend_from_slice`；
    ///     两端宿主 / SDK / embed-demo 的常量必须与它同批更新（本仓历史上因两处各写步长
    ///     而错位解析过：24B 记录被按 16B 读 ⇒ 层上留下错位残值）。
    ///     `scripts/check-anim-record-bytes.mjs` 从内核推出宽度并与各消费端对账。
    private static let animUpdateRecordBytes = 236

    /// ★★**每帧推进的唯一解析点**（探针 / 帧循环两条入口共用）
    ///
    /// 内核 tick（曲线求值）→ 二进制返回 → 逐条写层；返回 `(applied, bytes)`，**不做 JSON 格式化**
    ///   （探针入口自己包；帧循环路径对返回值毫无兴趣，不应为它付格式化成本，更不能污染帧耗时测量）。
    @discardableResult
    private func animTickApply(_ dtMs: Double) -> (applied: Int, bytes: Int) {
        guard handle != 0 else { return (0, 0) }
        var outLen: UInt32 = 0
        let ptr = proteus_layout_anim_tick_bin(handle, Float(dtMs), &outLen)
        guard let ptr, outLen > 0 else { return (0, 0) }
        defer { proteus_rects_free(ptr, outLen) }
        let stride = Self.animUpdateRecordBytes
        let n = Int(outLen) / stride
        let buf = UnsafeRawBufferPointer(start: ptr, count: Int(outLen))
        var applied = 0
        CATransaction.begin()
        CATransaction.setDisableActions(true)   // ★关掉隐式动画：我们每帧自己给值，不能再让 CA 补间
        for i in 0..<n {
            let base = i * stride
            let nodeId = buf.loadUnaligned(fromByteOffset: base, as: UInt32.self)
            let tx = buf.loadUnaligned(fromByteOffset: base + 4, as: Float.self)
            let ty = buf.loadUnaligned(fromByteOffset: base + 8, as: Float.self)
            let sc = buf.loadUnaligned(fromByteOffset: base + 12, as: Float.self)
            let rot = buf.loadUnaligned(fromByteOffset: base + 16, as: Float.self)
            let op = buf.loadUnaligned(fromByteOffset: base + 20, as: Float.self)
            // ★颜色（2026-10-01）：末两个 u32 = 底色 + 文字色（均打包 `0xAARRGGBB`）；
            //   `UInt32.max` = 无该基色（保持静态绘制）
            let rgba = buf.loadUnaligned(fromByteOffset: base + 24, as: UInt32.self)
            let textRgba = buf.loadUnaligned(fromByteOffset: base + 28, as: UInt32.self)
            // ★B 批 3D（2026-10-01）：末尾追加 rotateX/rotateY（@32/@36——40B 记录）
            let rotateX = buf.loadUnaligned(fromByteOffset: base + 32, as: Float.self)
            let rotateY = buf.loadUnaligned(fromByteOffset: base + 36, as: Float.self)
            // ★★C2（2026-10-01）：描边进度（@108 的 f32；NaN/非有限 = 无描边路径——112B 记录）
            let strokeRaw = buf.loadUnaligned(fromByteOffset: base + 108, as: Float.self)
            let strokeProgress: Float? = strokeRaw.isFinite ? strokeRaw : nil
            // ★★路径变形 v1（2026-10-01）：当前因子（@184 的 f32；NaN = 无 B 态——188B 记录）。
            //   因子变化时向内核要**变形后的段列表**（按需查询：段是变长数据，不进定长记录），
            //   然后重建该节点的描边 shape path（"变形真的落到画面上"）。
            let morphRaw = buf.loadUnaligned(fromByteOffset: base + 184, as: Float.self)
            if morphRaw.isFinite {
                applyPathMorphTick(nodeId: Int(nodeId), factor: morphRaw)
            }
            // ★★发光强度（glow v1，@188 的 f32；NaN = 无发光——192B 记录）：变化时更新每层 alpha
            let glowRaw = buf.loadUnaligned(fromByteOffset: base + 188, as: Float.self)
            if glowRaw.isFinite {
                view?.applyGlowTick(nodeId: Int(nodeId), intensity: glowRaw)
            }
            // ★★倾斜（skew v1，@228/@232：2×f32——236B 记录，在遮罩段**之后**）
            //   ★顺序纪律（见下方遮罩段的注释）：读取顺序必须与内核写入顺序逐字节一致。
            let skewX = buf.loadUnaligned(fromByteOffset: base + 228, as: Float.self)
            let skewY = buf.loadUnaligned(fromByteOffset: base + 232, as: Float.self)
            // ★★软边遮罩（mask v1，@208：kind u32 + oA/aA/oB/aB 4×f32——236B 记录）：
            //   揭示色标是**内核已算好**的结果（宿主零数学）；变化时重建 mask 层的渐变。
            let mKind = buf.loadUnaligned(fromByteOffset: base + 208, as: UInt32.self)
            if mKind != 0 {
                let mOA = buf.loadUnaligned(fromByteOffset: base + 212, as: Float.self)
                let mAA = buf.loadUnaligned(fromByteOffset: base + 216, as: Float.self)
                let mOB = buf.loadUnaligned(fromByteOffset: base + 220, as: Float.self)
                let mAB = buf.loadUnaligned(fromByteOffset: base + 224, as: Float.self)
                view?.applyMaskTick(nodeId: Int(nodeId), kind: Int(mKind),
                                    oA: mOA, aA: mAA, oB: mOB, aB: mAB)
            }
            // ★★渐变 v2（2026-10-01）：混合后的色标（@112 起：kind u32 + n u32 + 8×colors u32
            //   + 8×offsets f32——184B 记录）。`kind=0` = 本节点无渐变/未变化（忽略）。
            //   ★这些是**内核已混合**的结果（唯一 lerp 实现在内核——宿主零插值数学）。
            let gradKind = buf.loadUnaligned(fromByteOffset: base + 112, as: UInt32.self)
            if gradKind != 0 {
                let gn = Int(buf.loadUnaligned(fromByteOffset: base + 116, as: UInt32.self))
                var gColors = [CGColor]()
                var gLocs = [NSNumber]()
                for gi in 0..<min(gn, 8) {
                    let c = buf.loadUnaligned(fromByteOffset: base + 120 + gi * 4, as: UInt32.self)
                    gColors.append(SelfDrawView.cgColorFromPacked(c))
                    let off = buf.loadUnaligned(fromByteOffset: base + 152 + gi * 4, as: Float.self)
                    gLocs.append(NSNumber(value: off))
                }
                // ★★渐变几何（@192 起 4×f32 = angle/cx/cy/r——渐变 v2 扩展）："光本身在动"
                let gAngle = buf.loadUnaligned(fromByteOffset: base + 192, as: Float.self)
                let gCx = buf.loadUnaligned(fromByteOffset: base + 196, as: Float.self)
                let gCy = buf.loadUnaligned(fromByteOffset: base + 200, as: Float.self)
                let gR = buf.loadUnaligned(fromByteOffset: base + 204, as: Float.self)
                view?.applyGradientTick(nodeId: Int(nodeId), colors: gColors, locations: gLocs,
                                        kind: Int(gradKind), angle: gAngle, cx: gCx, cy: gCy, r: gR)
            }
            // ★★C1（2026-10-01）：裁剪形状（@40 起：kind u32 + 16×f32——108B 记录）
            let clipKindRaw = buf.loadUnaligned(fromByteOffset: base + 40, as: UInt32.self)
            var clipParams: [Float]? = nil
            if clipKindRaw != 0 {
                var ps = [Float](repeating: 0, count: 16)
                for i in 0..<16 {
                    ps[i] = buf.loadUnaligned(fromByteOffset: base + 44 + i * 4, as: Float.self)
                }
                clipParams = ps
            }
            if view?.applyTransform(
                nodeId: Int(nodeId), tx: CGFloat(tx), ty: CGFloat(ty), scale: CGFloat(sc),
                rotate: CGFloat(rot), rotateX: CGFloat(rotateX), rotateY: CGFloat(rotateY),
                skewX: CGFloat(skewX), skewY: CGFloat(skewY),
                opacity: CGFloat(op),
                rgba: rgba == UInt32.max ? nil : rgba,
                textRgba: textRgba == UInt32.max ? nil : textRgba,
                clipParams: clipParams,
                strokeProgress: strokeProgress
            ) == true {
                applied += 1
            }
        }
        CATransaction.commit()
        return (applied, Int(outLen))
    }

    /// ★★**每帧路径变形**（路径变形 v1）——因子变化时向内核取**已变形**的段列表
    ///   （唯一 lerp 实现在内核 `SvgPath::morphed`），交给 view 重建描边 path。
    ///   ★按需查询 + 因子缓存（段是变长数据：因子不变时不重复搬运）。
    ///   ★查询失败静默跳过（下一帧再试）——变形是视觉增强，不阻断帧循环。
    private var layerMorphFactor: [Int: Float] = [:]
    private func applyPathMorphTick(nodeId: Int, factor: Float) {
        if let cached = layerMorphFactor[nodeId], cached == factor { return }
        layerMorphFactor[nodeId] = factor
        guard handle != 0, let view else { return }
        // ★★二进制通道（性能修正）：JSON 版在此把 moonGlow 幕 p95 抬到 2.57ms
        //   （每帧 JSON 编解码）——与 tick_bin 同源理由。格式见内核
        //   `proteus_layout_svg_morph_path_bin`（u32 count + 每条 u32 tag + f32 坐标）。
        var len: UInt32 = 0
        let ptr = proteus_layout_svg_morph_path_bin(handle, UInt32(nodeId), &len)
        // ★返回值非 Optional（C 侧空指针时 len=0）——按长度判定，不写 `guard let`
        guard len >= 4 else { return }
        defer { proteus_rects_free(ptr, len) }
        let buf = UnsafeRawBufferPointer(start: ptr, count: Int(len))
        let count = Int(buf.loadUnaligned(fromByteOffset: 0, as: UInt32.self))
        let path = CGMutablePath()
        var off = 4
        for _ in 0..<count {
            guard off + 4 <= Int(len) else { return }
            let tag = buf.loadUnaligned(fromByteOffset: off, as: UInt32.self)
            off += 4
            switch tag {
            case 0: // MoveTo
                let x = buf.loadUnaligned(fromByteOffset: off, as: Float.self)
                let y = buf.loadUnaligned(fromByteOffset: off + 4, as: Float.self)
                off += 8
                path.move(to: CGPoint(x: CGFloat(x), y: CGFloat(y)))
            case 1: // LineTo
                let x = buf.loadUnaligned(fromByteOffset: off, as: Float.self)
                let y = buf.loadUnaligned(fromByteOffset: off + 4, as: Float.self)
                off += 8
                path.addLine(to: CGPoint(x: CGFloat(x), y: CGFloat(y)))
            case 2: // CubicTo
                let x1 = buf.loadUnaligned(fromByteOffset: off, as: Float.self)
                let y1 = buf.loadUnaligned(fromByteOffset: off + 4, as: Float.self)
                let x2 = buf.loadUnaligned(fromByteOffset: off + 8, as: Float.self)
                let y2 = buf.loadUnaligned(fromByteOffset: off + 12, as: Float.self)
                let x = buf.loadUnaligned(fromByteOffset: off + 16, as: Float.self)
                let y = buf.loadUnaligned(fromByteOffset: off + 20, as: Float.self)
                off += 24
                path.addCurve(to: CGPoint(x: CGFloat(x), y: CGFloat(y)),
                              control1: CGPoint(x: CGFloat(x1), y: CGFloat(y1)),
                              control2: CGPoint(x: CGFloat(x2), y: CGFloat(y2)))
            case 3: // QuadTo
                let x1 = buf.loadUnaligned(fromByteOffset: off, as: Float.self)
                let y1 = buf.loadUnaligned(fromByteOffset: off + 4, as: Float.self)
                let x = buf.loadUnaligned(fromByteOffset: off + 8, as: Float.self)
                let y = buf.loadUnaligned(fromByteOffset: off + 12, as: Float.self)
                off += 16
                path.addQuadCurve(to: CGPoint(x: CGFloat(x), y: CGFloat(y)),
                                  control: CGPoint(x: CGFloat(x1), y: CGFloat(y1)))
            case 4: // Close
                path.closeSubpath()
            default:
                return // 未知 tag ⇒ 停（格式不匹配——不静默画错）
            }
        }
        view.setMorphedPathDirect(nodeId: nodeId, path: path)
    }

    /// ★★**每帧推进（探针入口）**：内核 tick → 写层 → 返回可读 JSON（JS 探针用；帧循环走 `animTickLean`）
    ///
    /// 【为什么二进制而不复用 JSON 通道】每帧 O(N) 条走 JSON 的编解码是白付；记录格式见
    ///   `animUpdateRecordBytes`（定长，全小端）。
    ///
    /// 【★回执里的 `active`（2026-10-01）】= tick 后仍在推进的动画条数（内核 `anim_active`）——
    ///   调用方（炫技场幕调度）据此**逐帧**判定"本幕动画结束于何时"⇒ 与名义跨度对账可抓
    ///   "动画提前结束 / 加速播放"（当时真机实证的"双帧驱动 ⇒ 2× 速"缺陷就靠这一项现形；
    ///   见 showcase-scene.swift 的 `actAnimEndMs`）。
    func animTick(_ dtMs: Double) -> String {
        guard handle != 0 else { return "{\"ok\":false,\"error\":\"未接入核心\"}" }
        let r = animTickApply(dtMs)
        let active = proteus_layout_anim_active(handle)
        return "{\"ok\":true,\"applied\":\(r.applied),\"bytes\":\(r.bytes),\"active\":\(active)}"
    }

    /* ────────────────── ★★RT2：持续帧率测席（§9 帧率/帧耗时指标的测量装置） ────────────────── */

    /// E4 诊断：末次 seek 的原始回执（见 finishBench）
    private var benchSeekRaw: String?
    /// 帧率测席的运行状态（跨帧累积；由 CADisplayLink 驱动）
    private struct AnimBenchRun {
        let durationMs: Double
        var elapsedMs: Double = 0
        var frames: Int = 0
        /// 每帧**被测工作**耗时（ms）：`tickLean + seekLean`（不含 CADisplayLink 自身的空闲等待）
        var workMs: [Double] = []
        /// 每个 vsync 间隔（ms）：证明"帧是否掉"的依据（超过标称 1.5× 视为掉帧）
        var vsyncMs: [Double] = []
        let gestureNodeId: Int
        let gestureTo: Double
        let yNodeIds: [Int]
        let yTo: Double
        var timedOut = false
    }

    private var benchRun: AnimBenchRun?
    private var benchResult: [String: Any]?
    /// 相位链的**续链回调**（由控制器注入；测量跑满 ⇒ 宿主回调 resume——事件驱动，非盲等）
    var animBenchPhaseDone: (() -> Void)?

    /// ★★**每帧推进（精简路径）**：只回计数，**不建 JSON 字符串**
    ///
    /// 【为什么保留两条入口（本仓纪律：测量要测生产路径）】`animTick` 面向 JS 探针（要返回可读
    ///   JSON）；生产帧循环对返回值**毫无兴趣** ⇒ 为它格式化字符串是纯浪费（且会**污染帧耗时测量**
    ///   ——测出来的是"生产 + 探针格式化"）。⇒ 只有"包 JSON"这一步分开；**解析/写层已合并**为
    ///   `animTickApply`（唯一步长来源，见 `animUpdateRecordBytes`）。
    @discardableResult
    private func animTickLean(_ dtMs: Double) -> (applied: Int, bytes: Int) {
        animTickApply(dtMs)
    }

    /// **seek 精简路径**（生产手势跟随形态：宿主侧直接 seek，不经 JS）
    @discardableResult
    private func seekLean(nodeId: Int, kind: Int, progress: Double) -> Int {
        guard handle != 0 else { return 0 }
        let json = "{\"nodeId\":\(nodeId),\"kind\":\(kind),\"progress\":\(progress)}"
        let out = json.withCString { takeCString(proteus_layout_anim_seek(handle, $0)) }
        return applyAnimUpdates(fromJson: out)
    }

    /// ★★**启动帧率测席**（§9：转场帧率 / 帧耗时 P95 / 掉帧率的测量）
    ///
    /// 入参 JSON：`{durationMs, nodeIds:[ids], amp, gestureNodeId, gestureFrom, gestureTo}`
    /// ・`nodeIds`：做**持续 Y 动画**（时长 = 测席时长 ⇒ 全程保持活动集恒定）
    /// ・`gestureNodeId`：每帧被 `seek` 驱动（**模拟手指跟随**——把手势路径也纳入每帧成本）
    ///
    /// 【判据设计】见 `hosts/ios/check-anim-rt2.py` 的 E 组——fps / work p95 / 掉帧率 / 端点钉死。
    /// 【诚实边界】① 本测席量的是**宿主侧每帧工作**（tick+seek+写层）；JS 侧成本为 0 是**设计目标**
    ///   （曲线求值在内核）⇒ 这就是完整口径；② 帧率上限受**设备刷新率**约束（iPhone 12 = 60Hz
    ///   ⇒ 120Hz 目标需 ProMotion 设备验证，本轮如实标注）。
    func animBenchStart(_ json: String) -> String {
        guard handle != 0, let view else { return "{\"ok\":false,\"error\":\"未接入\"}" }
        guard let data = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return "{\"ok\":false,\"error\":\"入参解析失败\"}"
        }
        let durationMs = (o["durationMs"] as? Double) ?? 3000
        let nodeIds = (o["nodeIds"] as? [Int]) ?? []
        let amp = (o["amp"] as? Double) ?? 60
        let gestureNodeId = (o["gestureNodeId"] as? Int) ?? (nodeIds.first ?? 2)
        let gestureTo = (o["gestureTo"] as? Double) ?? 80

        // 先停旧循环（幂等），再播种持续动画
        view.stopFrameLoop()
        // ★★相位间状态清理（本仓纪律：不假设"上一步留下的还能用"）——
        //   animComplex 相位会在同一批节点上留动画/变换（spring/接管/FLIP/rotate）⇒ 不清掉会污染本测席的
        //   E4/E5 终值判据（实测：tx=697 而非 80）。⇒ 测席启动前**清空全部动画状态**。
        _ = animStopAll()
        // ★★探针缺陷修正（真机抓出，第二次同类）：手势节点上可能**残留上一相位的动画**
        //   （animProbe 给节点 2 起过 translateX 0→120）⇒ bench 的 seek 驱动的是那条旧动画
        //   ⇒ 终值 =120 而非本测席期望的 gestureTo ⇒ 判据 E4 假红。
        //   ⇒ 正解：**本测席自己给手势节点起一条明确的 X 动画**（同 (node,kind) 会**替换**旧的
        //     ——见 AnimEngine::start 的替换语义），使 seek 驱动的目标确定。
        if !nodeIds.isEmpty {
            // ★★探针纪律（同类第四次）：本测席必须**显式声明自己的播种**，且用 `takeover:false`
            //   硬重启——否则 `start` 的接管语义会从**上一相位残留动画的当前位置**继续
            //   （真机实测：gesture_tx=697 而非 80、y_ty=287 而非 60 —— 都是被 complex 相位的
            //   接管/F2 弹簧动画"夺走"了起点）。⇒ 硬重启让本测席的起点**确定**。
            var anims: [[String: Any]] = nodeIds.map { id -> [String: Any] in
                [
                    "nodeId": id, "kind": 1, "curve": 3, "from": -amp, "to": amp,
                    "durMs": durationMs, "takeover": false,
                ]
            }
            // 手势节点：明确起一条 translateX 0 → gestureTo（**长时长**，全程可被 seek 驱动）
            anims.append([
                "nodeId": gestureNodeId, "kind": 0, "curve": 3, "from": 0, "to": gestureTo,
                "durMs": durationMs, "takeover": false,
            ])
            let seed = (try? JSONSerialization.data(withJSONObject: ["anims": anims]))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            let seedOut = animStart(seed)
            if !seedOut.contains("\"ok\":true") {
                return "{\"ok\":false,\"error\":\"播种动画失败\",\"seed\":\(jsonEscape(seedOut))}"
            }
        }
        benchRun = AnimBenchRun(
            durationMs: durationMs, gestureNodeId: gestureNodeId,
            gestureTo: gestureTo, yNodeIds: nodeIds, yTo: amp,
        )
        benchResult = nil
        view.onFrame = { [weak self] dtMs in self?.benchFrame(dtMs) }
        view.startFrameLoop()
        // ★看门狗（**不是盲等**）：只在"测量卡死"（如屏幕熄灭导致 DisplayLink 停摆）时兜底，
        //   正常路径由 CADisplayLink 跑满时长后自行收尾。超时结果会被标 `timed_out` ⇒ 判据判红。
        let wdMs = durationMs * 3
        DispatchQueue.main.asyncAfter(deadline: .now() + wdMs / 1000.0) { [weak self] in
            guard let self, self.benchRun != nil else { return }
            self.benchRun?.timedOut = true
            self.finishBench()
        }
        return "{\"ok\":true,\"duration_ms\":\(durationMs),\"anims\":\(nodeIds.count),\"gesture_node\":\(gestureNodeId)}"
    }

    /// 每帧：**被测工作**（tick + seek + 写层）+ 帧计时记录
    private func benchFrame(_ dtMs: Double) {
        guard var b = benchRun, let view else { return }
        let t0 = CACurrentMediaTime()
        _ = animTickLean(dtMs)                                  // ← 被测：每帧推进 + 写层
        let p = min(1.0, max(0.0, b.elapsedMs / max(b.durationMs, 1)))
        _ = seekLean(nodeId: b.gestureNodeId, kind: 0, progress: p) // ← 被测：模拟手指跟随
        let workMs = (CACurrentMediaTime() - t0) * 1000
        b.workMs.append(workMs)
        b.frames += 1
        if b.frames > 1 { b.vsyncMs.append(view.lastFrameMs) }
        b.elapsedMs += dtMs
        if b.elapsedMs >= b.durationMs || b.timedOut {
            benchRun = b
            finishBench()
        } else {
            benchRun = b
        }
    }

    /// 收尾：终值读数（端点钉死）+ 统计 → 存结果 → **回调续链**
    private func finishBench() {
        guard let b = benchRun, let view else { return }
        view.stopFrameLoop()
        view.onFrame = nil
        // ★终值：把手势驱动显式 seek 到 1.0（端点钉死）⇒ 判据可断言"精确等于 to"
        //   ★诊断（2026-10-01 · E4 间歇红取证）：把 seek 回执留下——若 updates 为空
        //     说明**没命中动画**（层上残留的是别处的值），不是"求值错"。
        let seekJson = "{\"nodeId\":\(b.gestureNodeId),\"kind\":0,\"progress\":1.0}"
        let seekRaw = seekJson.withCString { takeCString(proteus_layout_anim_seek(handle, $0)) }
        _ = applyAnimUpdates(fromJson: seekRaw)
        self.benchSeekRaw = String(seekRaw.prefix(300))
        let gLayer = safeJsonLayers(view.layerTransformProbe("[\(b.gestureNodeId)]")).first
        let yId = b.yNodeIds.first ?? 0
        let yLayer = yId != 0 ? safeJsonLayers(view.layerTransformProbe("[\(yId)]")).first : nil

        func pct(_ arr: [Double], _ p: Double) -> Double {
            guard !arr.isEmpty else { return 0 }
            if arr.count == 1 { return arr[0] }
            let pos = p * Double(arr.count - 1)
            let lo = Int(pos.rounded(.down))
            let hi = min(lo + 1, arr.count - 1)
            let frac = pos - Double(lo)
            return arr[lo] * (1 - frac) + arr[hi] * frac
        }
        let workSorted = b.workMs.sorted()
        let vsyncSorted = b.vsyncMs.sorted()
        let nominal = vsyncSorted.isEmpty ? 0 : vsyncSorted[vsyncSorted.count / 2]
        let dropped = nominal > 0 ? b.vsyncMs.filter { $0 > nominal * 1.5 }.count : 0
        let totalVsync = b.vsyncMs.reduce(0, +)
        let fps = totalVsync > 0 ? Double(max(b.frames - 1, 0)) * 1000.0 / totalVsync : 0

        var out: [String: Any] = [
            "ok": true,
            "duration_ms": b.durationMs,
            "frames": b.frames,
            "elapsed_ms": (b.elapsedMs * 100) / 100,
            "fps": (fps * 100).rounded() / 100,
            "vsync_p50_ms": (nominal * 1000).rounded() / 1000,
            "work_p50_ms": (pct(workSorted, 0.5) * 1000).rounded() / 1000,
            "work_p95_ms": (pct(workSorted, 0.95) * 1000).rounded() / 1000,
            "work_max_ms": (workSorted.last.map { ($0 * 1000).rounded() / 1000 }) ?? 0,
            "dropped": dropped,
            "dropped_ratio": b.vsyncMs.isEmpty ? 0 : (Double(dropped) / Double(b.vsyncMs.count) * 10000).rounded() / 10000,
            "gesture_to": b.gestureTo,
            "y_to": b.yTo,
            "timed_out": b.timedOut,
            // ★诊断（2026-10-01 · E4 间歇红取证）：seek 回执 + 目标节点
            "seek_raw": benchSeekRaw ?? "",
            "gesture_node": b.gestureNodeId,
        ]
        if let g = gLayer { out["gesture_tx"] = (g["tx"] as? Double).map { ($0 * 10000).rounded() / 10000 } ?? 0 }
        if let y = yLayer { out["y_ty"] = (y["ty"] as? Double).map { ($0 * 10000).rounded() / 10000 } ?? 0 }
        benchResult = out
        benchRun = nil
        // ★事件驱动续链：测量完成 ⇒ 通知相位驱动继续（不是让 JS/脚本轮询）
        animBenchPhaseDone?()
    }

    /// 帧率测席结果（供 finalize2 带进报告）
    func animBenchResults() -> String {
        guard let r = benchResult else { return "{\"ok\":false,\"error\":\"未运行测席\"}" }
        return (try? JSONSerialization.data(withJSONObject: r))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{\"ok\":false}"
    }

    /* ────────────── ★★主线程零唤醒：OS 级 CPU 会计（xctrace 不可达时的机器判据） ────────────── */

    /// 本线程累计 CPU 时间（微秒；user + system）
    ///
    /// ★单位说明：`thread_info(THREAD_BASIC_INFO)` 的 user/system 时间是**微秒**
    ///   （与 `task_info` 的绝对时间单位不同——后者需乘 timebase 换算）。
    private func threadCpuUs() -> Double {
        var info = thread_basic_info_data_t()
        var count = mach_msg_type_number_t(
            MemoryLayout<thread_basic_info_data_t>.stride / MemoryLayout<integer_t>.stride)
        let th = mach_thread_self()
        defer { mach_port_deallocate(mach_task_self_, th) }   // ★采样会创建 send right，必须释放（否则反复采样泄漏端口权）
        let kr = withUnsafeMutablePointer(to: &info) { p -> kern_return_t in
            p.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { ip in
                thread_info(th, thread_flavor_t(THREAD_BASIC_INFO), ip, &count)
            }
        }
        guard kr == KERN_SUCCESS else { return -1 }
        return Double(info.user_time.seconds) * 1_000_000 + Double(info.user_time.microseconds)
            + Double(info.system_time.seconds) * 1_000_000 + Double(info.system_time.microseconds)
    }

    private var cpuProbeResult: [String: Any]?
    private var cpuProbeBusy = false
    /// **异步相位续链回调**（两段测量共 ~2×windowMs；跑完回调——事件驱动，非盲等）
    var animCpuProbeDone: (() -> Void)?

    /// ★★**两段对照测量**：① 平台路径（提交一次 ⇒ 主线程应零参与）② tick 路径（阳性对照）
    ///
    /// 判据（`check-anim-rt2.py` 的 L 组）：
    ///   L0 **提交必须成功**（否则"零 CPU"是"什么都没发生"——不是证据）；
    ///   L1 阳性对照**必须有显著 CPU**（tick 路径 < 5ms ⇒ 探针失效，不得判绿）；
    ///   L2 平台路径 CPU 显著低于 tick 路径（比值判据，不是绝对阈值——设备差异大）。
    func animCpuProbeStart(_ json: String) -> String {
        guard handle != 0, let view else { return "{\"ok\":false,\"error\":\"未接入\"}" }
        guard let data = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return "{\"ok\":false,\"error\":\"入参解析失败\"}"
        }
        let windowMs = (o["windowMs"] as? Double) ?? 600
        let targetId = (o["targetId"] as? Int) ?? 2
        var out: [String: Any] = ["ok": true, "window_ms": windowMs, "target": targetId]
        // 相位间清场（不假设上一步残留可用——本仓纪律）
        view.stopFrameLoop()
        view.onFrame = nil
        _ = animStopAll()
        view.removePlatformAnimations([targetId])
        cpuProbeResult = nil
        cpuProbeBusy = true

        // ── 阶段 1：平台路径（提交一次 → render server 自主插值）──
        let c0 = threadCpuUs()
        let commitOut = animCommit(jsonString([
            "anims": [["nodeId": targetId, "kind": 0, "curve": 1, "from": 0.0, "to": 120.0, "durMs": windowMs]],
        ]))
        out["commit"] = commitOut
        // ★窗口二分（2026-10-01，L2 回归诊断后固化）：提交自身 vs 提交后空闲——
        //   平台路径的"零参与"承诺指的是**空闲段**（窗口内主线程应无工作）；
        //   提交段是一次性的调用成本，二者混在一根读数里无法区分"路径变慢"与"提交变贵"。
        let c1 = threadCpuUs()
        out["commit_cpu_us"] = c1 - c0
        let committedOk = commitOut.contains("\"committed\":1")
        // ★★**分段采样**（2026-10-01 · L2 间歇定位）：把 600ms 窗口切成 6×100ms 子段——
        //   一次跑就能定性"idle 段被什么污染"：
        //     · 某一段独大（如 18ms 在中间）⇒ **一次性卡顿**（CA flush / 系统活动）——
        //       结论"平台路径不每帧参与"仍然成立，判据应容忍单段尖峰；
        //     · 六段均匀（各 ~3ms）⇒ **每帧都有主线程工作** ⇒ 真回归（该判红）。
        //   此前只有 18.9ms 这一个总数，无法区分两种形态（本仓纪律：读数要能归因）。
        var segs: [Double] = []
        let segCount = 6
        let segMs = windowMs / Double(segCount)
        var lastCpu = c1
        func collectSeg(_ k: Int) {
            let now = threadCpuUs()
            segs.append(now - lastCpu)
            lastCpu = now
        }
        // ★递归步进：k 达到段数即完成（**不再多记一段**——首版多记了一个 0 值尾巴）
        func segStep(_ k: Int, _ done: @escaping () -> Void) {
            if k >= segCount {
                done()
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + segMs / 1000.0) { [weak self] in
                guard let self else { return }
                collectSeg(k)
                segStep(k + 1, done)
            }
        }
        segStep(0) { [weak self] in
            guard let self else { return }
            let c2 = self.threadCpuUs()
            out["platform_cpu_us"] = c2 - c0
            out["idle_cpu_us"] = c2 - c1
            out["idle_segments_us"] = segs
            out["frame_loop_running"] = self.view?.frameLoopRunning ?? false
            out["committed_ok"] = committedOk
            self.view?.removePlatformAnimations([targetId])
            _ = self.animStopAll()

            // ── 阶段 2：tick 路径（阳性对照——CADisplayLink 每帧推进 ⇒ 主线程必然有开销）──
            let t0 = self.threadCpuUs()
            let seedOut = self.animStart(jsonString([
                "anims": [["nodeId": targetId, "kind": 0, "curve": 3, "from": -60.0, "to": 60.0,
                           "durMs": windowMs, "takeover": false]],
            ]))
            out["seed"] = seedOut
            self.view?.onFrame = { [weak self] dtMs in self?.animTickLean(dtMs) }
            self.view?.startFrameLoop()
            DispatchQueue.main.asyncAfter(deadline: .now() + windowMs / 1000.0) { [weak self] in
                guard let self else { return }
                out["tick_cpu_us"] = self.threadCpuUs() - t0
                self.view?.stopFrameLoop()
                self.view?.onFrame = nil
                _ = self.animStopAll()
                self.cpuProbeResult = out
                self.cpuProbeBusy = false
                self.animCpuProbeDone?()   // ★事件驱动续链（与 animBench 同法）
            }
        }
        return jsonString(out)
    }

    /// CPU 探针结果（供 finalize2 带进报告）
    func animCpuProbeResults() -> String {
        guard let r = cpuProbeResult else {
            return cpuProbeBusy
                ? "{\"ok\":false,\"error\":\"测量进行中（应已由相位链等完）\"}"
                : "{\"ok\":false,\"error\":\"未运行探针\"}"
        }
        return jsonString(r)
    }


    /* ══════════ ★★Host ABI v1 接入（HA1）══════════ */

    /// ABI 度量回调：**引擎回调宿主**去量文本（能力注入的宿主侧实现）
    ///
    /// 【★为什么必须在宿主侧（方案 §0.4.8）】文本度量是**平台适配**（CoreText / StaticLayout）——
    ///   各端各写一份是正确设计；ABI 只定义"何时调、怎么传"。
    ///   ★入参由引擎组装（text/fontSize/fontWeight/fontFamily），宿主只做度量本身。
    private static let abiMeasureCallback: ProteusMeasureTextFn = { input, out, _ in
        guard let input, let out else { return -1 }
        let i = input.assumingMemoryBound(to: ProteusTextInput.self).pointee
        let text = i.text.map { String(cString: $0) } ?? ""
        if text.isEmpty {
            out.assumingMemoryBound(to: ProteusTextMetrics.self).pointee = ProteusTextMetrics(width: 0, height: 0)
            return 0
        }
        let fam = i.font_family.map { String(cString: $0) } ?? "system"
        let sz = ProteusTextAdapter.measureText(
            text,
            fontSize: CGFloat(i.font_size > 0 ? i.font_size : 14),
            fontWeight: CGFloat(i.font_weight > 0 ? i.font_weight : 400),
            fontFamily: fam
        )
        out.assumingMemoryBound(to: ProteusTextMetrics.self).pointee =
            ProteusTextMetrics(width: Float(sz.width), height: Float(sz.height))
        return 0
    }

    /// 引擎请求宿主 schedule 下一帧（本测席是**同步驱动**，只计数——不真的排帧）
    private static var abiFrameRequests = 0
    private static let abiRequestFrameCallback: ProteusRequestFrameFn = { _ in
        abiFrameRequests += 1
    }

    /// ★★**HA1 双路对照**：同一棵树分别走 [直连 FFI] 与 [Host ABI] ⇒ 比对几何 + 计数
    ///
    /// 【为什么要"双路"（判据设计）】"ABI 能跑"不足以证明抽象正确——必须证明
    ///   **两条路产出同一个东西**。几何逐字节比对是最强的等价判据（不是"看起来差不多"）。
    ///   同时验证：度量**经 vtable 注入**（宿主不再自己遍历树量文本）、批处理红线、
    ///   能力插件（未注册明确报错）、帧驱动（`proteus_frame` 推进动画）。
    ///
    /// 入参 JSON：`{"tree": <核心请求 JSON 字符串>}`
    /// 出参：两路的 rects 字节数 + hash、差异字节数、各计数读数
    func abiProbe(_ json: String) -> String {
        guard let d = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let tree = o["tree"] as? String else {
            return "{\"ok\":false,\"error\":\"入参需为 {tree: <JSON 字符串>}\"}"
        }
        var out: [String: Any] = ["ok": true]

        // ★★**探针设计的关键（首版踩到，真机 N1 报 195 字节差）**：两条路必须吃**同一份输入**。
        //   · 适配器产出的树**不含** `textMeasures`（生产里是宿主在 mount 时补的）
        //     ⇒ 若直接拿它比：直连路会用 `NullTextMeasurer`（文本零尺寸），而 ABI 路会**回调宿主度量**
        //       ⇒ 两条路输入不同，几何必然不同（**那是探针的错，不是抽象的错**）。
        //   ⇒ 正解：宿主在这里按生产同法预算度量（与 `mount` 的循环一致）⇒ 两路等价性才可判定；
        //     而"注入能力"另设**独立**子项（拿无度量表的树单跑 ABI，验回调确实发生）。
        let treeWithMeasures: String = {
            guard let d = tree.data(using: .utf8),
                  var root = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
                  let nodes = root["nodes"] as? [[String: Any]] else { return tree }
            var measures: [String: [String: Double]] = [:]
            for n in nodes {
                guard let text = n["text"] as? String, !text.isEmpty, let id = n["id"] as? Int else { continue }
                let fs = (n["fontSize"] as? Double).map { CGFloat($0) } ?? 14
                let fw = (n["fontWeight"] as? Double).map { CGFloat($0) } ?? 400
                let fam = (n["fontFamily"] as? String) ?? "system"
                let lh = n["lineHeight"] as? String
                let sz = ProteusTextAdapter.measureText(text, fontSize: fs, fontWeight: fw, fontFamily: fam, lineHeight: lh, letterSpacing: (n["letterSpacing"] as? Double).map { CGFloat($0) } ?? 0)
                measures["\(id)"] = ["width": Double(sz.width), "height": Double(sz.height)]
            }
            root["textMeasures"] = measures
            out["probe_measure_count"] = measures.count
            guard let dd = try? JSONSerialization.data(withJSONObject: root),
                  let s = String(data: dd, encoding: .utf8) else { return tree }
            return s
        }()

        // ── ① 直连 FFI 路（现有生产路径；输入 = 含度量表的树，与 ABI 路**同一份**）──
        let directStart = CFAbsoluteTimeGetCurrent()
        let h = treeWithMeasures.withCString { proteus_layout_create($0) }
        guard h > 0 else { return "{\"ok\":false,\"error\":\"直连建树失败\"}" }
        var directLen: UInt32 = 0
        let directPtr = proteus_layout_rects_bin(h, &directLen)
        // ★`UnsafeMutablePointer<UInt8>.withUnsafeBufferPointer` 不存在（那是 Array 的方法）
        //   ⇒ 用 `UnsafeBufferPointer(start:count:)` 显式构造
        //   （`proteus_layout_rects_bin` 返回**非可选**指针 ⇒ 不需要 nil 判断；本仓实测：
        //    多写那个判断会触发 "comparing non-optional to nil" 警告）
        let directBytes = Array(UnsafeBufferPointer(start: directPtr, count: Int(directLen)))
        let directMs = (CFAbsoluteTimeGetCurrent() - directStart) * 1000
        _ = proteus_layout_destroy(h)
        out["direct_bytes"] = directBytes.count
        out["direct_hash"] = fnv1a(directBytes)
        out["direct_ms"] = round(directMs * 1000) / 1000

        // ── ② Host ABI 路（版本协商 → 创建引擎 → 装树 → 取几何）──
        var hint = [CChar](repeating: 0, count: 256)
        var ver = proteus_abi_version_info()
        let checkRC = proteus_check_versions(&ver, &hint, hint.count)
        out["version_check_rc"] = Int(checkRC)
        out["version"] = [
            "abi": Int(ver.abi_version), "ir": Int(ver.ir_version),
            "ops_wire": Int(ver.ops_wire_version), "min_shell": Int(ver.min_shell_version),
        ]
        // 版本不兼容的**可操作性**（非静默）：拿一个错的版本去协商，提示里必须有"升级方式"
        var badVer = ver
        badVer.abi_version = 99
        var badHint = [CChar](repeating: 0, count: 512)
        let badRC = proteus_check_versions(&badVer, &badHint, badHint.count)
        out["version_mismatch_rc"] = Int(badRC)
        out["version_mismatch_hint"] = String(cString: badHint)

        // ★逐字段赋值（不用字面量构造）：可选函数指针字段在字面量里需要上下文类型，
        //   而 `@convention(c)` 别名的推断在混合 nil 时不稳 ⇒ 显式赋值最清晰
        var vt = ProteusHostVTable(user_data: nil, request_frame: nil, measure_text: nil,
                                   decode_image: nil, native_view_create: nil,
                                   native_view_update: nil, native_view_destroy: nil)
        // ★函数指针按 C ABI 的真实形态传递（见结构体注释）：unsafeBitCast 到指针宽度
        vt.request_frame = unsafeBitCast(SelfDrawBridge.abiRequestFrameCallback, to: UnsafeMutableRawPointer?.self)
        vt.measure_text = unsafeBitCast(SelfDrawBridge.abiMeasureCallback, to: UnsafeMutableRawPointer?.self)
        SelfDrawBridge.abiFrameRequests = 0
        let abiStart = CFAbsoluteTimeGetCurrent()
        let engine = withUnsafePointer(to: &vt) { vtPtr in
            proteus_engine_create(vtPtr, &ver, &hint, hint.count)
        }
        guard let engine else {
            return "{\"ok\":false,\"error\":\"引擎创建失败\",\"hint\":\(jsonEscape(String(cString: hint)))}"
        }
        let loadRC = treeWithMeasures.withCString { proteus_load_tree(engine, $0) }
        out["abi_load_rc"] = Int(loadRC)
        var abiLen: UInt32 = 0
        var abiBytes: [UInt8] = []
        if let p = proteus_rects(engine, &abiLen), abiLen > 0 {
            abiBytes = Array(UnsafeBufferPointer(start: p, count: Int(abiLen)))
        }
        let abiMs = (CFAbsoluteTimeGetCurrent() - abiStart) * 1000
        out["abi_bytes"] = abiBytes.count
        out["abi_hash"] = fnv1a(abiBytes)
        out["abi_ms"] = round(abiMs * 1000) / 1000

        // ── ③ ★核心等价判据：几何**逐字节一致** ──
        out["geometry_identical"] = (abiBytes == directBytes)
        out["geometry_diff_bytes"] = zip(abiBytes, directBytes).filter { $0 != $1 }.count
            + abs(abiBytes.count - directBytes.count)
        // ★差异**定位**（不是只报个数）：首差偏移 + 两侧十六进制上下文（归因必须有依据）
        //   记录二进制格式 = 头 + N×20B 矩形（x,y,w,h f32 + id u32）——见 rects_bin.rs
        if abiBytes != directBytes {
            var first = -1
            for i in 0..<min(abiBytes.count, directBytes.count) where abiBytes[i] != directBytes[i] {
                first = i; break
            }
            if first >= 0 {
                let lo = max(0, first - 8), hi = min(min(abiBytes.count, directBytes.count), first + 12)
                out["diff_first_offset"] = first
                // 二进制格式（`rects_bin.rs`）：头 **16B**（magic+version+count+reserved）+ N×**20B**（id u32 + 4×f32）
                out["diff_record_index"] = first >= 16 ? (first - 16) / 20 : -1
                out["diff_direct_hex"] = (lo..<hi).map { String(format: "%02x", directBytes[$0]) }.joined()
                out["diff_abi_hex"] = (lo..<hi).map { String(format: "%02x", abiBytes[$0]) }.joined()
            }
        }

        // ── ④ 能力注入读数：引擎**回调宿主**量了几次文本 ──
        //   ★独立子项：用**无度量表**的树**另建一个引擎** ⇒ 度量必须由引擎回调宿主产生
        //     （与 ① 的等价性判据分开：等价性要"同输入"，注入能力要"缺度量时能补"）
        if let sp = proteus_stats_json(engine) {
            out["abi_stats"] = safeParseObject(String(cString: sp))
        }
        if let engine2 = withUnsafePointer(to: &vt, { proteus_engine_create($0, &ver, &hint, hint.count) }) {
            let rc2 = tree.withCString { proteus_load_tree(engine2, $0) }
            out["inject_load_rc"] = Int(rc2)
            if let sp2 = proteus_stats_json(engine2) {
                out["inject_stats"] = safeParseObject(String(cString: sp2))
            }
            _ = proteus_engine_destroy(engine2)
        }

        // ── ⑤ 批处理红线：一帧多条指令 ⇒ **一次** submit_frame ──
        //    指令流线格式（与 slot-runtime/buffer.ts 逐字节对齐）：20B 头 + 指令体
        //    头：magic u32("PVOP") + version u32(2) + opCount u32 + keyCount u32 + strCount u32
        //    体：TOGGLE_VIS(0x05) = op u8 + nodeId u32 + visible u8
        if let firstId = (try? JSONSerialization.jsonObject(with: tree.data(using: .utf8) ?? Data()))
            .flatMap({ $0 as? [String: Any] })?["nodes"] as? [[String: Any]],
           let id0 = firstId.first?["id"] as? Int {
            var ops: [UInt8] = []
            func u32(_ v: UInt32) { ops.append(contentsOf: withUnsafeBytes(of: v.littleEndian) { Array($0) }) }
            u32(0x504F5650); u32(2); u32(2); u32(0); u32(0)  // 头（2 条指令、无键池/字符串池）
            ops.append(0x05); u32(UInt32(id0)); ops.append(1)
            ops.append(0x05); u32(UInt32(id0)); ops.append(1)
            let submitRC = ops.withUnsafeBufferPointer { proteus_submit_frame(engine, $0.baseAddress, $0.count) }
            out["submit_rc"] = Int(submitRC)
            if let sp = proteus_stats_json(engine) {
                out["stats_after_submit"] = safeParseObject(String(cString: sp))
            }
        }

        // ── ⑥ 帧驱动：ABI 的 `proteus_frame` 推进动画（内核求值 → 更新缓冲）──
        let animRC = "{\"anims\":[{\"nodeId\":1,\"kind\":0,\"curve\":1,\"from\":0,\"to\":50,\"durMs\":200,\"takeover\":false}]}"
            .withCString { proteus_anim_start(engine, $0) }
        out["anim_start_rc"] = Int(animRC)
        var updatesSeen = 0
        for i in 0..<8 {
            _ = proteus_frame(engine, Int64(1_000_000_000 + i * 33_000_000))
            var ul: UInt32 = 0
            if let up = proteus_frame_updates(engine, &ul), ul > 0 { updatesSeen += Int(ul) / Self.animUpdateRecordBytes }
        }
        out["frame_updates_records"] = updatesSeen
        out["frame_requests"] = SelfDrawBridge.abiFrameRequests
        if let sp = proteus_stats_json(engine) {
            out["stats_final"] = safeParseObject(String(cString: sp))
        }

        // ── ⑦ 能力插件：未注册 ⇒ **明确报错**；注册后可用 ──
        var capOut = [CChar](repeating: 0, count: 512)
        let missRC = "network.request".withCString { name in
            proteus_call_capability(engine, name, nil, &capOut, capOut.count)
        }
        out["capability_missing_rc"] = Int(missRC)
        out["capability_missing_msg"] = String(cString: capOut)
        let echo: @convention(c) (UnsafePointer<CChar>?, UnsafeMutablePointer<CChar>?, Int, UnsafeMutableRawPointer?) -> Int32 = { arg, o, n, _ in
            guard let o, n > 0 else { return -1 }
            let s = arg.map { String(cString: $0) } ?? "{}"
            let reply = "{\"ok\":true,\"echo\":\(s)}"
            _ = reply.withCString { src in strncpy(o, src, n - 1) }
            return 0
        }
        let regRC = "network.request".withCString { proteus_register_capability(engine, $0, echo, nil) }
        out["capability_register_rc"] = Int(regRC)
        var capOut2 = [CChar](repeating: 0, count: 512)
        let callRC = "network.request".withCString { name in
            "{\"u\":1}".withCString { arg in proteus_call_capability(engine, name, arg, &capOut2, capOut2.count) }
        }
        out["capability_call_rc"] = Int(callRC)
        out["capability_call_out"] = String(cString: capOut2)

        _ = proteus_engine_destroy(engine)
        out["ok"] = true
        return jsonString(out)
    }

    /// FNV-1a 64 位哈希（几何等价判据用——比"逐字段比"更快且不依赖解析）
    private func fnv1a(_ bytes: [UInt8]) -> String {
        var hash: UInt64 = 0xcbf29ce484222325
        for b in bytes {
            hash ^= UInt64(b)
            hash = hash &* 0x100000001b3
        }
        return String(format: "%016llx", hash)
    }

    /// 宽松解析成对象（诊断读数；失败不抛）
    private func safeParseObject(_ s: String) -> [String: Any] {
        guard let d = s.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return [:] }
        return o
    }

    /// `layerTransformProbe` 的 JSON → 层数组（仅收尾用，不在每帧路径）
    private func safeJsonLayers(_ json: String) -> [[String: Any]] {
        guard let d = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return [] }
        return (o["layers"] as? [[String: Any]]) ?? []
    }

    /// 解析 JSON 形态的 updates（`animSeek` 用——它的频率低于 tick 且需带 changed 等元信息）
    @discardableResult
    private func applyAnimUpdates(fromJson out: String) -> Int {
        guard let data = out.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let updates = o["updates"] as? [[Double]] else { return 0 }
        var applied = 0
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for u in updates where u.count >= 4 {
            // 兼容 4 值（RT0 形态）/ 6 值（RT2：rotate/opacity）/ 7 值（2026-10-01：+ 打包色）
            let rot: CGFloat = u.count >= 6 ? CGFloat(u[4]) : 0
            let op: CGFloat = u.count >= 6 ? CGFloat(u[5]) : 1
            // ★颜色：第 7/8 项是打包色（底色 / 文字色）；缺省 / 越界 / **u32::MAX 哨兵**
            //   （JSON 形态 4294967295 = "无该基色"）⇒ nil（保持静态绘制）。
            //   ★哨兵必须**排除**（2026-10-01 判据抓出的口径缺陷）：写成 `raw < 4_294_967_296`
            //     会把 4294967295 当合法色 ⇒ 层上被涂成**不透明白**（该节点本来保持静态色）。
            let packedOpt = { (idx: Int) -> UInt32? in
                guard u.count > idx else { return nil }
                let raw = u[idx]
                return (raw >= 0 && raw < 4_294_967_295) ? UInt32(raw) : nil
            }
            // ★B 批 3D：第 9/10 项是 rotateX/rotateY（40B 记录的 JSON 形态）
            let rx: CGFloat = u.count >= 10 ? CGFloat(u[8]) : 0
            let ry: CGFloat = u.count >= 10 ? CGFloat(u[9]) : 0
            // ★C1：第 11 项 = 裁剪类型（0=无），第 12..27 项 = 16 个参数（108B 记录的 JSON 形态）
            // ★C2：第 28 项 = 描边进度（u32::MAX = 无描边路径；否则是 f32 的位模式）
            var strokeP: Float? = nil
            if u.count >= 28 {
                let raw = u[27]
                if raw >= 0 && raw < 4_294_967_295 {
                    strokeP = Float(bitPattern: UInt32(raw))
                }
            }
            var clipP: [Float]? = nil
            if u.count >= 27, u[10] != 0 {
                var ps = [Float](repeating: 0, count: 16)
                for i in 0..<16 {
                    let idx = 11 + i
                    if idx < u.count { ps[i] = Float(u[idx]) }
                }
                clipP = ps
            }
            if view?.applyTransform(
                nodeId: Int(u[0]), tx: CGFloat(u[1]), ty: CGFloat(u[2]), scale: CGFloat(u[3]),
                rotate: rot, rotateX: rx, rotateY: ry,
                opacity: op, rgba: packedOpt(6), textRgba: packedOpt(7),
                clipParams: clipP, strokeProgress: strokeP
            ) == true {
                applied += 1
            }
        }
        CATransaction.commit()
        return applied
    }

    func nowUs() -> String {
        let tb = Self.timebase
        let ticks = mach_absolute_time()
        // 纳秒 = ticks * numer / denom；微秒 = 纳秒 / 1000
        let nanos = Double(ticks) * Double(tb.numer) / Double(tb.denom)
        let micros = nanos / 1000.0
        // %.3f：微秒级分辨率留小数点后 3 位（纳秒级尾数），实测可达
        return String(format: "%.3f", micros)
    }

    /// ★Vapor IR V3：应用二进制指令流（字节数组 JSON → Rust 侧解码 + 应用 + 多范围重排）
    ///
    /// 【诚实边界】本方法**只做通道**：几何由 Rust 的 `proteus_layout_apply_ops` 算，
    ///   layer 更新复用既有的 `updateLayersIncremental`（与 updatePatches 同一条路径）。
    ///   V3 交付的是「二进制指令流能驱动真机几何」这条**通路**，不改既有绘制逻辑。
    func applyOps(_ opsBytesJson: String) -> String {
        guard let view = view, handle != 0 else {
            return "{\"ok\":false,\"error\":\"未建树或未接入核心\"}"
        }
        let t0 = CFAbsoluteTimeGetCurrent()
        // 字节数组 JSON → [UInt8]（如 "[2,0,0,0,1,0,...]"）
        guard let data = opsBytesJson.data(using: .utf8),
              let arr = (try? JSONSerialization.jsonObject(with: data)) as? [Int] else {
            return "{\"ok\":false,\"error\":\"opsBytes 解析失败（需字节数组 JSON）\"}"
        }
        var bytes = [UInt8](repeating: 0, count: arr.count)
        for (i, v) in arr.enumerated() where v >= 0 && v <= 255 { bytes[i] = UInt8(v) }

        // ★v4 模式走 **norects** 入口：矩形已由二进制通道取，JSON 里不再冗余携带
        //   （本仓实测：4003 条的序列化 ~10ms + 宿主解析 ~19ms 全是白付）
        let useV4ForOut = (SelfDrawBridge.optMode == "v4")
        let out: String = bytes.withUnsafeBufferPointer { buf in
            guard let base = buf.baseAddress else { return "{\"ok\":false,\"error\":\"空指令流\"}" }
            if useV4ForOut {
                return takeCString(proteus_layout_apply_ops_norects(handle, base, UInt32(buf.count)))
            }
            return takeCString(proteus_layout_apply_ops(handle, base, UInt32(buf.count)))
        }
        let applyMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        guard out.contains("\"ok\":true") else {
            return "{\"ok\":false,\"error\":\"applyOps 失败\",\"raw\":\(jsonEscape(String(out.prefix(300))))}"
        }
        let tParse0 = CFAbsoluteTimeGetCurrent()
        let o = (try? JSONSerialization.jsonObject(with: Data(out.utf8))) as? [String: Any]
        let applied = (o?["applied"] as? Int) ?? 0
        let relayout = (o?["relayout_count"] as? Int) ?? 0
        let scopes = (o?["scopes"] as? [Int]) ?? []
        let unsupported = (o?["unsupported"] as? [[String: Any]]) ?? []

        // ★矩形解析单独计时（本题材实测：类B 场景 4003 条矩形，JSON 解析 **19.35ms**——最大单项）
        let rectsParseMs = (CFAbsoluteTimeGetCurrent() - tParse0) * 1000

        // ★★V4：变化集走**二进制**（不再解析 JSON 的 rects 字段）
        //
        // 【为什么（V3 真机读数）】类B 分解：rects_parse 19.35ms · apply 15.43ms · layers 13.34ms
        //   ⇒ 返回通道的 JSON 解析是最大单项。格式见 `rects_bin.rs`（16B 头 + 20B/条，全小端）。
        //   体积对照：4003 条 222KB(JSON) → 80KB(本格式)，且解码是顺序读。
        let tBin0 = CFAbsoluteTimeGetCurrent()
        var outLen: UInt32 = 0
        var changed: [(id: Int, abs: CGRect)] = []
        let useV4 = (SelfDrawBridge.optMode == "v4")
        if !useV4, let rm = o?["rects"] as? [String: [String: Double]] {
            // 'v3' 模式：走 JSON 矩形（与优化前一致；用于 A/B 对照）
            for (k, r) in rm {
                guard let nid = Int(k) else { continue }
                changed.append((id: nid, abs: CGRect(x: r["x"] ?? 0, y: r["y"] ?? 0,
                                                    width: r["width"] ?? 0, height: r["height"] ?? 0)))
            }
        }
        let binPtr: UnsafeMutablePointer<UInt8>? = useV4 ? proteus_layout_rects_bin(handle, &outLen) : nil
        // ★判据用 outLen（Rust 侧失败时把它置 0）+ 指针存在性
        if let bp = binPtr, outLen >= 16 {
            let buf = UnsafeBufferPointer(start: bp, count: Int(outLen))
            // 顺序读：magic(4) version(4) count(4) reserved(4) 之后是 count × (id u32 + 4 × f32)
            let u32at: (Int) -> UInt32 = { o in
                UInt32(buf[o]) | (UInt32(buf[o + 1]) << 8) | (UInt32(buf[o + 2]) << 16) | (UInt32(buf[o + 3]) << 24)
            }
            let f32at: (Int) -> Float = { o in Float(bitPattern: u32at(o)) }
            let count = Int(u32at(8))
            if count > 0 && 16 + count * 20 <= Int(outLen) {
                changed.reserveCapacity(count)
                for i in 0..<count {
                    let o = 16 + i * 20
                    changed.append((id: Int(u32at(o)),
                                    abs: CGRect(x: CGFloat(f32at(o + 4)), y: CGFloat(f32at(o + 8)),
                                                width: CGFloat(f32at(o + 12)), height: CGFloat(f32at(o + 16)))))
                }
            }
            proteus_rects_free(bp, outLen)
        }
        let rectsBinMs = (CFAbsoluteTimeGetCurrent() - tBin0) * 1000

        // ★★文本更新落层（见 applyTextUpdates 注释）
        let textUpdates = (o?["text_updates"] as? [String: Any]) ?? [:]
        let textApplied = textUpdates.isEmpty ? 0 : view.applyTextUpdates(textUpdates)

        // ★★几何变化量自检：与上一帧快照比对，统计**真的移动/改尺寸**的节点数
        //
        // 【判据意义】若这个数为 0，说明本次"更新"对几何无影响
        //   ⇒ 此时报告的耗时**不能**用来论证"重排有多快"（可能全在搬运空变化）
        var geomChanged = 0
        for c in changed {
          let sig = "\(c.abs.origin.x),\(c.abs.origin.y),\(c.abs.size.width),\(c.abs.size.height)"
          if lastGeom[c.id] != sig { geomChanged += 1 }
          lastGeom[c.id] = sig
        }
        lastGeomChanged = geomChanged
        let updated: Int
        var virtualOut: [String: Any] = [:]
        if view.isVirtual {
            // ★★虚拟化路径：变化先落**真源**，只刷已物化的行（见 applyVirtualUpdate 注释；
            //   走 updateLayersIncremental 会因"屏外行没有层"而每次退回全量 ⇒ 虚拟化失效）
            let r = view.applyVirtualUpdate(changed: changed, textUpdates: textUpdates)
            updated = changed.count
            virtualOut = ["virtual": true, "refreshed_rows": r.updatedRows,
                          "deferred_nodes": r.deferredNodes]
        } else {
            updated = view.updateLayersIncremental(changed: changed, visibleOnly: useV4)
        }
        let layerTiming = view.lastLayerTiming
        let layersMs = layerTiming["total_ms"] ?? 0
        let totalMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        let mem = physFootprintMB()
        SelfDrawBridge.memPeakMB = max(SelfDrawBridge.memPeakMB, mem)
        lastTiming = ["measure_ms": 0, "layout_ms": (applyMs * 100).rounded() / 100,
                      "build_layers_ms": (layersMs * 100).rounded() / 100,
                      "host_total_ms": (totalMs * 100).rounded() / 100]
        // ★★拆成分步赋值（2026-09-29 修：整块字典字面量让 Swift 类型检查器超时）
        //
        // 【现象】`swiftc -typecheck` 报 `unable to type-check this expression in reasonable time`
        //   ⇒ **整个 iOS 宿主编译不过**——而 `check:ios-selfdraw-compile` 是"改 Swift 后本地
        //   唯一的判据"（该脚本自述的覆盖盲区修补），它长期红着 = 门禁等于不存在。
        // 【成因】单表达式内 25+ 键 × 混合数值类型（Int/Double/Any）× 两层 `as?` 动态转换
        //   ⇒ 类型推断组合爆炸。
        // 【修法】编译器自己给的建议（break up into distinct sub-expressions）：
        //   先建字典，再逐组赋值（每组类型清晰、可独立推断）。
        var res: [String: Any] = [:]
        res["ok"] = true
        res["path"] = "applyOps"
        res["incremental"] = true
        res["in_bytes"] = bytes.count
        res["patch_count"] = applied
        res["relayout_count"] = relayout
        res["scopes"] = scopes
        res["changed_rects"] = changed.count
        res["updated_layers"] = updated
        res["unsupported_count"] = unsupported.count
        res["text_updates"] = textUpdates.count
        res["text_layers_applied"] = textApplied
        // ★★A/B（矩阵 #14 续）：判据（与 Android 共用）读的键名别名——iOS 用 patch_count/
        //   text_layers_applied，而共享的 bundle-vapor.js 读 applied/text_synced/relayout/rects。
        //   ⇒ 在**宿主侧**补别名（不在共享 bundle 里改——那要三端重新生成，且会动已验证的读数）。
        res["applied"] = applied
        res["relayout"] = relayout
        res["text_synced"] = textApplied
        // ★★P2-2 ⑩b（2026-10-03 · 三端对齐）：`text_probe` = 本轮**最后一次**文本更新的
        //   {id,text}（与 Android `VaporRenderHost.lastTextProbe` / 鸿蒙 `PROTEUS_VAPOR_TEXTPROBE`
        //   同形）——判据 ⑩b 靠它核"更新后的文本仍是完整拼接串"（缺它 ⇒ iOS 在混合文本更新上无读数）。
        // ★`textUpdates` 是 `[String: Any]`（**字典没有 `.last`**——首版按数组写，编译期即红）；
        //   取任一非空条目作"最后一次更新"的代表（判据只核"是完整拼接串"，不核具体哪一条）。
        for (k, v) in textUpdates {
            if let txt = v as? String, let pid = Int(k) {
                res["text_probe"] = ["id": pid, "text": txt]
                break
            }
        }
        // rects：判据只数**键数**（changed_rects 的几何真源形态）——构轻量 id 集合（值不打）
        var rectsMap: [String: [String: Double]] = [:]
        for c in changed { rectsMap["\(c.id)"] = ["x": 0, "y": 0, "width": 0, "height": 0] }
        res["rects"] = rectsMap
        res["apply_ms"] = round(applyMs * 100) / 100
        // ★Rust 侧分段（本仓实测：总账 72ms 里约 40ms 曾"去向不明"——
        //   因为 apply_ms 只覆盖「指令应用」，**不含重排**（relayout_ms 在 timing 里没被浮出）
        let timing = o?["timing"] as? [String: Any]
        res["relayout_ms"] = round(((timing?["relayout_ms"] as? Double) ?? 0) * 100) / 100
        res["collect_ms"] = round(((timing?["collect_ms"] as? Double) ?? 0) * 100) / 100
        res["rects_parse_ms"] = round(rectsParseMs * 100) / 100
        res["rects_bin_ms"] = round(rectsBinMs * 100) / 100
        res["opt_mode"] = SelfDrawBridge.optMode
        // ★layers 三段分解（V4 下半：定位残余的唯一依据）
        res["layers_sort_ms"] = round((layerTiming["sort_ms"] ?? 0) * 100) / 100
        res["layers_frames_ms"] = round((layerTiming["frames_ms"] ?? 0) * 100) / 100
        res["layers_commit_ms"] = round((layerTiming["commit_ms"] ?? 0) * 100) / 100
        res["geom_changed"] = geomChanged
        res["geom_total"] = changed.count
        res["deferred"] = view.lastDeferredCount
        res["flushed"] = view.lastFlushedCount
        res["stale_cleared"] = view.lastStalePendingCleared
        res["pending_visible_overlap"] = view.lastPendingVisibleOverlap
        res["layers_ms"] = round(layersMs * 100) / 100
        res["host_total_ms"] = round(totalMs * 100) / 100
        res.merge(virtualOut) { _, new in new }
        return jsonString(res)
    }

    /// ★★全端对齐批（2026-10-05 · white-space 五端对齐）：**wrap 文本的第二遍测量**。
    ///   返回**新请求 JSON**（有 wrap 文本且折行后尺寸变化时）；无需重建 ⇒ nil。
    private func wrapRemeasure(handle: UInt64, req: [String: Any], nodes: [[String: Any]]) -> String? {
        let rectsStr = takeCString(proteus_layout_rects(handle))
        guard let rd = rectsStr.data(using: .utf8),
              let ro = (try? JSONSerialization.jsonObject(with: rd)) as? [String: Any],
              let rects = ro["rects"] as? [String: [String: Double]] else { return nil }
        guard var measures = req["textMeasures"] as? [String: [String: Double]] else { return nil }
        var changed = false
        for n in nodes {
            guard let text = n["text"] as? String, !text.isEmpty, let id = n["id"] as? Int else { continue }
            guard let r = rects["\(id)"], let boxW = r["width"], boxW > 1 else { continue }
            // ★★★word-break:normal（2026-10-09）：无断点长串溢出 ⇒ 不折行（不增长盒高——与绘制同步）
            guard SelfDrawView.effectiveWrap(n, text: text, boxWidth: CGFloat(boxW)) else { continue }
            let fs = (n["fontSize"] as? Double).map { CGFloat($0) } ?? 14
            let fw = (n["fontWeight"] as? Double).map { CGFloat($0) } ?? 400
            let fam = (n["fontFamily"] as? String) ?? "system"
            let lh = n["lineHeight"] as? String
            let ls = (n["letterSpacing"] as? Double).map { CGFloat($0) } ?? 0
            let wb = n["wordBreak"] as? String
            // ★★★line-clamp 项（2026-10-08）：测量封顶——盒高 = min(自然行数, clamp) × 行盒高
            let maxLines = (n["lineClamp"] as? Double).map { Int($0) } ?? (n["lineClamp"] as? Int) ?? 0
            let sz = ProteusTextAdapter.measureTextWrapped(text, fontSize: fs, fontWeight: fw, fontFamily: fam,
                                                             lineWidth: CGFloat(boxW), lineHeight: lh, letterSpacing: ls, wordBreak: wb, maxLines: maxLines)
            let prevH = measures["\(id)"]?["height"] ?? 0
            if Double(sz.height) > prevH + 0.5 {
                measures["\(id)"] = ["width": Double(min(boxW, Double(sz.width))), "height": Double(sz.height)]
                changed = true
            }
        }
        guard changed else { return nil }
        var req2 = req
        req2["textMeasures"] = measures
        guard let d = try? JSONSerialization.data(withJSONObject: req2) else { return nil }
        return String(data: d, encoding: .utf8)
    }

    /// 核心：渲染树 → (CoreText 度量) → Rust 核心 → CALayer 树
    /**
     * ★★★内置环境变量表（2026-10-08 · 决策 #593）：`--pf-*` → **逻辑点（pt）**。
     * iOS 用官方 `view.safeAreaInsets`（含状态栏/刘海/底部 Home Indicator）；无厂商私有 API。
     * nav-mode 恒 gesture（iOS 无三键导航）；键盘不接（不参与布局）。
     */
    private func envVarTable() -> [String: Double] {
        var t: [String: Double] = [:]
        guard let v = view else { return t }
        let s = v.safeAreaInsets
        t["--pf-inset-top"] = Double(s.top)
        t["--pf-inset-bottom"] = Double(s.bottom)
        t["--pf-inset-left"] = Double(s.left)
        t["--pf-inset-right"] = Double(s.right)
        t["--pf-status-bar-height"] = Double(s.top)   // iOS：状态栏/刘海含于 safeArea.top
        t["--pf-nav-bar-height"] = 0                  // iOS 无三键导航
        t["--pf-indicator-height"] = Double(s.bottom) // 底部 Home Indicator
        t["--pf-nav-bar-total"] = Double(s.bottom)
        t["--pf-cutout-top"] = Double(s.top)
        t["--pf-cutout-left"] = Double(s.left)
        t["--pf-cutout-right"] = Double(s.right)
        t["--pf-keyboard-height"] = 0
        // ★视口逻辑尺寸（决策 #595）：`vw`/`vh` 单位与流式布局用
        t["--pf-vw"] = Double(v.bounds.width)
        t["--pf-vh"] = Double(v.bounds.height)
        return t
    }

    /// 解析 `env:<name>[+N|-N][~F]` token → 逻辑点；未知名/无表项 ⇒ fallback（缺省 0）。非 token ⇒ nil。
    private static func resolveEnvToken(_ tok: String, _ table: [String: Double]) -> Double? {
        guard tok.hasPrefix("env:") else { return nil }
        var rest = String(tok.dropFirst(4))
        var fallback = 0.0
        if let ti = rest.firstIndex(of: "~") {
            fallback = Double(rest[rest.index(after: ti)...]) ?? 0
            rest = String(rest[..<ti])
        }
        // ★缩放（决策 #595）：`*<scale>`（名/偏移之后）
        var scale = 1.0
        if let si = rest.firstIndex(of: "*") {
            scale = Double(rest[rest.index(after: si)...]) ?? 1
            rest = String(rest[..<si])
        }
        var off = 0.0; var name = rest
        if rest.count > 1 {
            let chars = Array(rest)
            // ★偏移符号 = 后随**数字**的 +/-（变量名自带连字符 '-'——不能见 '-' 就当分隔符）
            for i in 1..<(chars.count - 1) where (chars[i] == "+" || chars[i] == "-") && chars[i + 1].isNumber {
                name = String(chars[0..<i])
                let sign = chars[i] == "-" ? -1.0 : 1.0
                off = sign * (Double(String(chars[(i + 1)...])) ?? 0)
                break
            }
        }
        return (table[name] ?? fallback) * scale + off
    }

    /// 把 nodes 里所有 `env:` token 字符串就地替换为逻辑点数值（顶层标量 + margin/padding 四边）。
    private func resolveEnvTokens(in nodes: inout [[String: Any]]) {
        let table = envVarTable()
        let sides = ["top", "right", "bottom", "left"]
        for i in nodes.indices {
            for (k, v) in nodes[i] {
                if let s = v as? String, let d = Self.resolveEnvToken(s, table) { nodes[i][k] = d }
            }
            for edge in ["margin", "padding"] {
                if var obj = nodes[i][edge] as? [String: Any] {
                    for side in sides {
                        if let s = obj[side] as? String, let d = Self.resolveEnvToken(s, table) { obj[side] = d }
                    }
                    nodes[i][edge] = obj
                }
            }
        }
    }

    private func render(treeJson: String, phase: String) -> String {
        guard let view = view else { return "{\"ok\":false,\"error\":\"view 未设置\"}" }
        let t0 = CFAbsoluteTimeGetCurrent()

        let tParse0 = CFAbsoluteTimeGetCurrent()
        guard let data = treeJson.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              var nodes = root["nodes"] as? [[String: Any]] else {
            return "{\"ok\":false,\"error\":\"渲染树 JSON 解析失败\"}"
        }
        // ★★★内置环境变量（2026-10-08 · 决策 #593）：把编译期发射的 `env:<name>` token 解析为逻辑点（pt）
        resolveEnvTokens(in: &nodes)
        let parseMs = (CFAbsoluteTimeGetCurrent() - tParse0) * 1000

        // ── ① 注入文本度量（平台职责：CoreText；命中内容寻址缓存）──
        ProteusTextAdapter.resetMeasureStats()
        ProteusTextAdapter.resetFontFamilyStats()
        let tMeasure0 = CFAbsoluteTimeGetCurrent()
        var textMeasures: [String: [String: Double]] = [:]
        for n in nodes {
            guard let text = n["text"] as? String, !text.isEmpty, let id = n["id"] as? Int else { continue }
            let fontSize = (n["fontSize"] as? Double).map { CGFloat($0) } ?? 14
            let fw = (n["fontWeight"] as? Double).map { CGFloat($0) } ?? 400
            let fam = (n["fontFamily"] as? String) ?? "system"
            let lh = n["lineHeight"] as? String
            let sz = ProteusTextAdapter.measureText(text, fontSize: fontSize, fontWeight: fw, fontFamily: fam, lineHeight: lh, letterSpacing: (n["letterSpacing"] as? Double).map { CGFloat($0) } ?? 0)
            textMeasures["\(id)"] = ["width": Double(sz.width), "height": Double(sz.height)]
        }
        let measureMs = (CFAbsoluteTimeGetCurrent() - tMeasure0) * 1000

        // ── ② 组装核心请求（只保留核心认识的字段）──
        var req: [String: Any] = ["viewport": root["viewport"] as? [String: Any] ?? ["width": 390, "height": 844],
                                 "nodes": nodes, "textMeasures": textMeasures]
        // 删掉纯绘制字段（核心只管几何——传了也无害，但保持请求最小便于诊断）
        //
        // ★★例外：`backgroundColor` **不再删**（2026-10-01，颜色通道的前提）。
        //   【为什么（真机判据抓出的真缺陷）】它从此是**内核字段**：颜色动画的**底色**
        //   （`LStyle.bg_base`）= 起点基准 + 复位目标（见内核 `style_from_dto`）。
        //   此前它被当作"纯绘制字段"删掉 ⇒ 内核收不到底色 ⇒ **所有颜色动画被内核拒绝**
        //   （真机现象：`bg_ids_from_kernel: []` 而请求里明明有 8 个节点带底色）。
        //   其余两项（fontSize/borderRadius）确实只用于宿主度量与绘制，仍然删。
        //   ★★`color`（文字色）**同样不再删**（2026-10-01）：它也是内核字段了
        //     （文字色动画的基色 `text_color_base`）——与 `backgroundColor` 同源的理由。
        if var ns = req["nodes"] as? [[String: Any]] {
            for i in ns.indices {
                ns[i].removeValue(forKey: "fontSize")
                ns[i].removeValue(forKey: "borderRadius")
            }
            req["nodes"] = ns
        }

        guard let reqData = try? JSONSerialization.data(withJSONObject: req),
              let reqJson = String(data: reqData, encoding: .utf8) else {
            return "{\"ok\":false,\"error\":\"核心请求组装失败\"}"
        }
        let tLayout0 = CFAbsoluteTimeGetCurrent()

        // ── ③ 调 Rust 核心（★几何的唯一来源）──
        //
        // ★★增量路径（本仓 2026-09-29 打通）：
        //   · **首帧**走 `create`（建树 + 全量布局）
        //   · **后续**走 `update`（把本帧与上帧的差异算成**样式补丁**，核心按布局边界局部重排）
        //   此前每次更新都 `destroy + create`（整树重建）——实测改 10 个列表项要重发 561KB、
        //   重建 1407 个节点。核心侧 `layout_incremental` 早已实现（边界内 30–566×），
        //   缺的只是 FFI 出口与宿主接线。
        //
        // ★兼容边界（诚实标注）：`proteus_layout_update` 当前**不带文本度量表**，
        //   故只在「纯样式变更」时走增量；一旦**节点增删**或文本集合变化，
        //   就退回 `create`（正确性优先——宁可重建，也不要用错的度量算几何）。
        let tRenderStart = CFAbsoluteTimeGetCurrent()
        let memStart = physFootprintMB()
        // ★峰值随行就市更新（increment 场景下内存不回落，峰值才有意义）
        SelfDrawBridge.memPeakMB = max(SelfDrawBridge.memPeakMB, memStart)
        var usedIncremental = false
        var patchCount = 0
        var relayoutCount = 0
        var changedCount = 0
        var updatedLayerCount = 0
        var layoutMs = 0.0
        var rectsJsonStr = ""

        // ★★增量更新（本题的核心优化路径）
        //
        // 【两处「整树操作」都要消掉（真机实测定位）】
        //   ① `proteus_layout_rects` —— 读**全量** rects（3507 条 → 280KB JSON → 解析），实测 ~9ms
        //   ② `clearLayers + buildLayers` —— 销毁并重建**全部** CALayer，实测 **80.7ms**（占宿主一半以上）
        //   ⇒ 现在改为：核心只回**变化集**（`rects` 字段，实测只改 1 行时 41 个节点），
        //     宿主只改这些层的 frame（不重建、不销毁）。
        //   ★顺序很关键：先算变化集与补丁（都在内存里），**再**决定要不要碰层树 ——
        //     若变化集缺失/与本地层不匹配，就退回全量（正确性优先）。
        let tDiff0 = CFAbsoluteTimeGetCurrent()
        let maybePatches = handle != 0 ? diffPatches(from: lastNodes, to: nodes) : nil
        let diffMs = (CFAbsoluteTimeGetCurrent() - tDiff0) * 1000
        if let patches = maybePatches {
            let pj = jsonString2(patches)
            let tUpd0 = CFAbsoluteTimeGetCurrent()
            let out = pj.withCString { takeCString(proteus_layout_update(handle, $0)) }
            let updateMs = (CFAbsoluteTimeGetCurrent() - tUpd0) * 1000
            if out.contains("\"ok\":true") {
                let o = (try? JSONSerialization.jsonObject(with: Data(out.utf8))) as? [String: Any]
                patchCount = (o?["applied"] as? Int) ?? 0
                relayoutCount = (o?["relayout_count"] as? Int) ?? 0

                // ★变化集 → 只在层树上改这几个
                var changed: [(id: Int, abs: CGRect)] = []
                if let rm = o?["rects"] as? [String: [String: Double]] {
                    for (k, r) in rm {
                        guard let nid = Int(k) else { continue }
                        changed.append((id: nid, abs: CGRect(x: r["x"] ?? 0, y: r["y"] ?? 0,
                                                            width: r["width"] ?? 0, height: r["height"] ?? 0)))
                    }
                }
                let tLayers0 = CFAbsoluteTimeGetCurrent()
                // ★遗留路径（整树 diff 的 update()）同样保持全量更新——理由见 updatePatches
                let updatedLayers = view.updateLayersIncremental(changed: changed, visibleOnly: false)
                let layersMs = (CFAbsoluteTimeGetCurrent() - tLayers0) * 1000
                if updatedLayers >= 0 {
                    usedIncremental = true
                    changedCount = changed.count
                    updatedLayerCount = updatedLayers
                    layoutMs = (CFAbsoluteTimeGetCurrent() - tLayout0) * 1000
                    // ★不再读全量 rects、不再重建层 —— 这就是省下来的部分
                    lastNodes = nodes
                    let el = (CFAbsoluteTimeGetCurrent() - tRenderStart) * 1000
                    let t = ["measure_ms": measureMs, "layout_ms": layoutMs,
                             "build_layers_ms": 0.0, "host_total_ms": el]
                    lastTiming = t
                    lastNodeCount = nodes.count
                    lastTreeHash = String(format: "%08x", treeJson.hashValue)
                    return jsonString([
                        "ok": true, "path": phase, "node_count": nodes.count,
                        "layer_count": view.builtLayerCount, "request_bytes": reqJson.count,
                        "measure_ms": round(measureMs * 100) / 100,
                        "layout_ms": round(layoutMs * 100) / 100,
                        "build_layers_ms": 0, "host_total_ms": round(el * 100) / 100,
                        "incremental": true, "patch_count": patchCount,
                        "relayout_count": relayoutCount,
                        "changed_rects": changed.count, "updated_layers": updatedLayers,
                        "mem_mb": round(physFootprintMB() * 10) / 10,
                        "mem_peak_mb": round(SelfDrawBridge.memPeakMB * 10) / 10,
                        // ★宿主侧分段（定位剩余耗时；本仓纪律：不靠推断）
                        "parse_ms": round(parseMs * 100) / 100,
                        "in_bytes": treeJson.count,
                        "measure_cache_hits": ProteusTextAdapter.measureCacheHits,
                        "measure_cache_misses": ProteusTextAdapter.measureCacheMisses,
                        // ★★I3 读数：绘制提示实际落到了多少层（"设了没设"必须可观测——
                        //   内存差 39% 只体现在这里；无读数就只能靠"看起来生效了"）
                        //   ★★重复键会让 Swift **运行时崩溃**（实测：本行曾被插两次，
                        //     模拟器闪退 `EXC_BREAKPOINT in Dictionary.init(dictionaryLiteral:)`
                        //     ——字典字面量重复键是 fatalError，不是"后者覆盖前者"）。
                        "paint_hint_compact": SelfDrawBridge.paintHintCompact,
                        "paint_hint_generic": SelfDrawBridge.paintHintGeneric,
                        "paint_hint_disabled": SelfDrawBridge.paintHintDisabled,
                        "paint_hint_env": SelfDrawBridge.paintHintEnvRaw,
                        // ★字体族契约读数（两端词汇表是否一致：非零即为契约分叉）
                        "font_family_fallbacks": ProteusTextAdapter.fontFamilyFallbackCount,
                        "unknown_font_family": ProteusTextAdapter.lastUnknownFontFamily,
                        // ★CGFont 解析失败 ⇒ **度量/绘制分叉**的前兆（必须可观测，不能静默）
                        "cgfont_fallbacks": ProteusTextAdapter.cgFontFallbackCount,
                        "cgfont_failure": ProteusTextAdapter.lastCGFontFailure,
                        "_host_timing": ["diff_ms": round(diffMs * 100) / 100,
                                         "update_ffi_ms": round(updateMs * 100) / 100,
                                         "layers_ms": round(layersMs * 100) / 100,
                                         "measure_ms": round(measureMs * 100) / 100],
                    ])
                }
            }
        }
        if !usedIncremental {
            // 首帧 / 结构变化 → 全量重建
            if handle != 0 {
                _ = proteus_layout_destroy(handle)
                handle = 0
            }
            let h = reqJson.withCString { proteus_layout_create($0) }
            handle = h
            guard h > 0 else {
                return "{\"ok\":false,\"error\":\"proteus_layout_create 失败（节点数 \(nodes.count)）\"}"
            }
            // ★★全端对齐批（2026-10-05 · white-space 五端对齐）：**第二遍测量**——
            //   wrap 类文本在解析后的盒宽下折行 ⇒ 高度=多行高（首遍只有单行度量 ⇒ 盒高偏小）。
            //   流程：首遍 create → 读 rects 得盒宽 → 按盒宽重测 wrap 文本 → 有变化则 destroy+重建。
            if let req2 = wrapRemeasure(handle: h, req: req, nodes: nodes) {
                _ = proteus_layout_destroy(h)
                handle = 0
                handle = req2.withCString { proteus_layout_create($0) }
                guard handle > 0 else {
                    return "{\"ok\":false,\"error\":\"核心重建树失败（wrap 第二遍测量后）\"}"
                }
            }
            rectsJsonStr = takeCString(proteus_layout_rects(handle))
            layoutMs = (CFAbsoluteTimeGetCurrent() - tLayout0) * 1000
        }
        lastNodes = nodes
        if !rectsJsonStr.contains("\"ok\":true") {
            return "{\"ok\":false,\"error\":\"rects 读取失败\",\"raw\":\(jsonEscape(String(rectsJsonStr.prefix(200))))}"
        }

        // ── ④ 几何 → CALayer 树 ──
        guard let rd = rectsJsonStr.data(using: .utf8),
              let ro = try? JSONSerialization.jsonObject(with: rd) as? [String: Any],
              let rects = ro["rects"] as? [String: [String: Double]] else {
            return "{\"ok\":false,\"error\":\"几何解析失败\"}"
        }
        let tBuild0 = CFAbsoluteTimeGetCurrent()
        // ★★矩阵 #10：把**核心真源**透传给调用方（`native_hosts` 清单 + 全量 rects）——
        //   Swift 侧建原生 UIView 的 frame 要读**核心几何**（"位置由核心决定"），
        //   而此前回执里没有这两个字段（JS 侧 `renderNativeMix` 拿不到 ⇒ ok:false）。
        //   ★与 Android 同纪律：IR 判定谁是 native-host 与宿主建 View **同源**（读核心回传，不维护本地表）。
        let nativeHostIds = (ro["native_hosts"] as? [Int]) ?? []
        // 几何按 nodeId 键返回（只含本次树内节点——与 rects 同源，不额外计算）
        var rectsOut: [String: [String: Double]] = [:]
        for (id, r) in rects {
            rectsOut[id] = ["x": r["x"] ?? 0, "y": r["y"] ?? 0,
                            "width": r["width"] ?? 0, "height": r["height"] ?? 0]
        }
        // ★★内容滚动范围（2026-10-02 —— 与 Android `applyContentScrollRange` **同源同口径**）：
        //   内容高 = 内核 rects 的**最大 maxY**；范围 = max(0, 内容高 − 视图高) ⇒
        //   交给视图后 `applyContentOffset` 钳到 [0, range]（装得下 ⇒ 0 ⇒ 不可滚）。
        //   ★★只有**显式开启**的场景才设置（`SelfDrawBridge.contentScrollRangeEnabled`）——
        //     既有 pan/滚动探针用例依赖"无界拖拽"（M6/panDragProbe 押大位移读数），
        //     默认钳制会静默改变它们的读数（历史教训：改默认行为 = 改既有判据）。
        //   ★首版把范围推导挂在 `nodeRects`（**只虚拟化路径填充**）⇒ SFC stress（全量路径）
        //     读到空表 ⇒ range 未设置 ⇒ 真机实测 `scroll_after_drag=120`（内容被拖走）。
        //     ⇒ 修正：**在全量路径的 rects 处**就地推导（那时几何已在手，零额外读取）。
        //   ★读数去向：范围设进视图后，由 `driveStress` 的 `scroll_probe`（`verticalRange`）如实报出
        //     —— 本处不再另存一份（同值两处存 = 迟早分叉）。
        if SelfDrawBridge.contentScrollRangeEnabled {
            var maxBottom: CGFloat = 0
            for (_, r) in rects {
                let bottom = CGFloat(r["y"] ?? 0) + CGFloat(r["height"] ?? 0)
                if bottom > maxBottom { maxBottom = bottom }
            }
            // I2-ALLOW: 滚动**交互约束**取整（钳制上限读数——不进绘制指令流；几何仍走内核吸附值）
            var range = max(0, Int((maxBottom - view.bounds.height).rounded()))
            // ★★★页面滚动锁定（2026-10-08）：页根声明 `overflow-y: hidden` ⇒ **整页不滚**（range=0）。
            //   App 的「页面滚动」= 整树滚动 ⇒ 页根 overflow 即页面滚动开关。
            let locked = (nodes.first?["overflowY"] as? String) == "hidden"
            if locked { range = 0 }
            view.setVerticalScrollRange(range)
        }
        // 按树序拍平（父在前）——CALayer 树要求先建父
        var flat: [(id: Int, parentId: Int?, rect: CGRect, style: [String: Any])] = []
        let sortedNodes = nodes.compactMap { n -> (Int, Int?, [String: Any])? in
            guard let id = n["id"] as? Int else { return nil }
            return (id, n["parentId"] as? Int, n)
        }
        for (id, pid, n) in sortedNodes {
            guard let r = rects["\(id)"] else { continue }
            let rect = CGRect(x: r["x"] ?? 0, y: r["y"] ?? 0, width: r["width"] ?? 0, height: r["height"] ?? 0)
            // ★绘制字段经**单一实现**抽取（`SelfDrawView.styleOf`）
            //   此前这里是**第三份手写副本**（只认 backgroundColor/color/text/fontSize/fontWeight/
            //   borderRadius）⇒ 新增 `fontFamily` 时**必然漏改这里** ⇒ 全量挂载的文本没有字族，
            //   而增量/虚拟化路径有 —— 分叉且静默（本仓纪律：同一语义一处实现）。
            flat.append((id: id, parentId: pid, rect: rect, style: SelfDrawView.styleOf(n)))
        }
        view.clearLayers()
        view.buildLayers(flat: flat)
        // ★批次 42（动效 · 对齐 Web）：**CSS animation**（编译期折叠）——建层后启动（各节点 style["animation"] → anims → 内核 anim_start + 帧循环）
        cssAnimNodes = startCssAnimations(flat: flat)
        // ★★C2：全量挂载后，按**内核解析好的段列表**补建 SVG 描边子层（见 attachSvgStroke 注释）
        let svgJson = handle != 0 ? takeCString(proteus_layout_svg_nodes(handle)) : "{}"
        view.attachSvgStroke(fromKernelPaths: svgJson)
        let buildMs = (CFAbsoluteTimeGetCurrent() - tBuild0) * 1000
        let totalMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000

        lastTiming = ["measure_ms": measureMs, "layout_ms": layoutMs, "build_layers_ms": buildMs, "host_total_ms": totalMs]
        lastNodeCount = flat.count
        lastTreeHash = String(format: "%08x", treeJson.hashValue)

        let out: [String: Any] = [
            "ok": true,
            "phase": phase,
            "node_count": flat.count,
            "layer_count": view.builtLayerCount,
            "request_bytes": reqJson.count,
            "measure_ms": round(measureMs * 100) / 100,
            "layout_ms": round(layoutMs * 100) / 100,
            "build_layers_ms": round(buildMs * 100) / 100,
            "host_total_ms": round(totalMs * 100) / 100,
            // ★增量路径读数（0 = 走了全量重建）
            "incremental": usedIncremental,
            "patch_count": patchCount,
            "relayout_count": relayoutCount,
            "changed_rects": changedCount,
            "updated_layers": updatedLayerCount,
            // ★度量读数（跨节点复用的判据：同文案应只真实度量少数次）
            "measure_cache_hits": ProteusTextAdapter.measureCacheHits,
            "measure_cache_misses": ProteusTextAdapter.measureCacheMisses,
            // ★★I3 读数（**全量路径也要**——首帧 mount 走的就是这条路；
            //   只给增量路径加 ⇒ 最该被验证的首帧反而看不见，本仓实测踩到）
            "paint_hint_compact": SelfDrawBridge.paintHintCompact,
            "paint_hint_generic": SelfDrawBridge.paintHintGeneric,
            "paint_hint_disabled": SelfDrawBridge.paintHintDisabled,
            "paint_hint_env": SelfDrawBridge.paintHintEnvRaw,
            "font_family_fallbacks": ProteusTextAdapter.fontFamilyFallbackCount,
            "unknown_font_family": ProteusTextAdapter.lastUnknownFontFamily,
            "cgfont_fallbacks": ProteusTextAdapter.cgFontFallbackCount,
            "cgfont_failure": ProteusTextAdapter.lastCGFontFailure,
            "mem_mb": round(physFootprintMB() * 10) / 10,
            "mem_peak_mb": round(SelfDrawBridge.memPeakMB * 10) / 10,
            // ★★矩阵 #10：**核心真源**几何透传（native_hosts 清单 + 全量 rects）——
            //   宿主建原生 UIView 的 frame 读它（"位置由核心决定"）；与 Android
            //   `MainActivity` 从 rectsJson 读 `native_hosts` 同纪律（IR 判定与宿主建 View 同源）。
            //   ★只在有 native_host 时带（无 host 的场景零开销：不塞 3500 条几何进回执）。
            "native_hosts": nativeHostIds,
            "rects": nativeHostIds.isEmpty ? [:] : rectsOut,
        ]
        return jsonString(out)
    }

    func snapshot(_ name: String) -> String {
        // ★名以宿主注入的 `SelfDrawBridge.snapshotName` 为准（JS 侧传参仅作兼容）——
        //   两端各命名会让产物散落；命名权收归宿主一处。
        let effective = SelfDrawBridge.snapshotName.isEmpty ? name : SelfDrawBridge.snapshotName
        guard let view = view, let path = view.snapshot(named: effective) else {
            return "{\"ok\":false,\"error\":\"截图失败\"}"
        }
        return jsonString(["ok": true, "path": path])
    }

    func report(_ json: String) {
        if let d = json.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            jsReport = o
        }
    }

    func done(_ summaryJson: String) {
        BenchDone.flag = true
        var out: [String: Any] = [:]
        out["engine"] = takeCString(proteus_layout_version())
        out["js_report"] = jsReport
        out["host_timing_last"] = lastTiming
        out["host_node_count"] = lastNodeCount
        out["tree_hash"] = lastTreeHash
        out["layer_count"] = view?.builtLayerCount ?? -1
        // ★★设备刷新率（2026-10-01 加：与 Android 侧 M4e 同一口径）
        //   判据据此断言"帧率是否达到显示器刷新率"——本机 iPhone 12 为 60Hz（受硬件限制），
        //   换 ProMotion 设备后**自动变严**（无需改判据；不硬编码 60/120）。
        out["screen_max_fps"] = UIScreen.main.maximumFramesPerSecond
        // ★白屏诊断（写点 = 壳在 viewDidLoad 填 ProteusLaunchDiag；发动机只读，不再引用壳类型）
        out["launch_diag"] = ProteusLaunchDiag.data
        // ★本轮报告写出时刻（Unix 秒）——A/B 测量脚本的**内容级新鲜度判据**：
        //   只认「run_ts ≥ 本次 launch 时刻」的报告。实测踩到：轮询只查"字段存在"
        //   ⇒ 上一轮的残留报告同样满足 ⇒ 两个变体其实在同一份旧数据上比，差值恒 0。
        out["run_ts"] = Date().timeIntervalSince1970
        if let d = summaryJson.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            for (k, v) in o { out["js_\(k)"] = v }
        }
        // ★全量几何（供宿主机**独立核验**：不依赖 app 自报的正确性）
        //   初版只导出前 12 个 → 核验脚本无法覆盖全部卡片；
        //   而「抽样核验」在几何 bug 面前会被绕过（本仓纪律：判定要覆盖被测对象的全体）。
        if let view = view {
            var all: [String: Any] = [:]
            for (id, r) in view.rectsByNodeId.sorted(by: { $0.key < $1.key }) {
                let mx = view.metaByNodeId[id]
                all["\(id)"] = [
                    "x": r.minX, "y": r.minY, "w": r.width, "h": r.height,
                    "text": mx?["text"] ?? "",
                    "bg": mx?["backgroundColor"] ?? "",
                    "color": mx?["color"] ?? "",
                ]
            }
            out["geometry_all"] = all
            out["layer_frames"] = view.layerFrameDump()
        }

        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent("\(SelfDrawBridge.reportFileName).json")
        if let d = try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys]) {
            try? d.write(to: url)
        }
        NSLog("[proteus] selfdraw 报告: %@", url.path)
        // ★★事件驱动的完成信号（2026-09-30 用户红线："要么让 App 主动报告，禁止任何盲等"）
        //   脚本侧等待报告 = 盲等（轮询 + sleep + 超时）；本行把「等」变成「收事件」：
        //   ① 标记先打（日志流里可见，供 --console 消费）；
        //   ② `PROTEUS_EXIT_AFTER_REPORT=1` ⇒ 报告写完立即退出进程 ⇒
        //      `devicectl device process launch --console` 的**返回**就是完成信号
        //      （零轮询 / 零 sleep / 零 timeout——脚本里不存在"等"这个动作）。
        //   ★为什么退在 done() 而不是别处：done() 是报告**已落盘**后的唯一收尾点
        //     （写文件 → NSLog → 本块），退出后数据完整性不受影响。
        NSLog("[proteus] SELFDRAW_REPORT_READY path=%@", url.path)
        if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" {
            exit(0)
        }
    }
}

/* ────────────────────────── 工具 ────────────────────────── */

/// ★★树 diff：把「上一帧 → 本帧」的**样式变化**算成补丁数组（增量更新的输入）
///
/// 【为什么需要它（而不是把整树发过去）】`proteus_layout_update` 的入参是**补丁**，
///   而宿主手上是两帧完整节点数组 —— 差异必须由宿主算（核心不知道上一帧是什么）。
///
/// 【返回 nil 的情形 = 退回全量重建】（正确性优先：宁可重建，也不要用错的前提算几何）
///   · 节点**增删**（id 集合不同）—— 核心的 update 入口不处理结构变化
///   · 某节点的文本变化 —— 度量需重新注入，而当前 update 入口不带度量表
///
/// 【只比布局字段】绘制属性（圆角/字号/文字色）**不影响几何** ⇒ 不进补丁，
///   避免用「无关变化」触发重排（这是增量能否真正省下来的关键）。
///   ★`backgroundColor` 的特殊性（2026-10-01）：它**也不进补丁**（底色变化不该触发重排），
///   但**必须进全量请求**（它是内核颜色动画的 `bg_base`——见 `buildFullRequest` 注释）。
///   两条要求不矛盾：补丁管"几何变更"，全量请求管"内核需要的样式事实"。
/// 上一帧全量请求的字节数（诊断：证明增量路径确实没走整树序列化）
private var lastFullRequestBytes = 0

/// 组装**全量**核心请求（只在首帧 / 结构变更时调用——见调用点的成本说明）
func buildFullRequest(nodes: [[String: Any]], textMeasures: [String: [String: Double]], root: [String: Any]) -> String {
    var req: [String: Any] = ["viewport": root["viewport"] as? [String: Any] ?? ["width": 390, "height": 844],
                             "nodes": nodes, "textMeasures": textMeasures]
    if var ns = req["nodes"] as? [[String: Any]] {
        for i in ns.indices {
            // ★★`backgroundColor` / `color` **都不删**（2026-10-01）：两者都已是内核字段
            //   （底色 / 文字色的基色）。与 `render(treeJson:)` 里的同类过滤**同源**——
            //   两处都要放行，否则"首帧全量路径"与"结构变更后的全量路径"行为不同
            //   （一有一无基色 ⇒ 颜色动画时灵时不灵）。
            ns[i].removeValue(forKey: "fontSize")
            ns[i].removeValue(forKey: "borderRadius")
        }
        req["nodes"] = ns
    }
    guard let d = try? JSONSerialization.data(withJSONObject: req),
          let str = String(data: d, encoding: .utf8) else { return "{}" }
    lastFullRequestBytes = str.count
    return str
}

/// 树 diff：把「上一帧 → 本帧」的**样式变化**算成补丁数组（增量更新的输入）
func diffPatches(from prev: [[String: Any]], to next: [[String: Any]]) -> [[String: Any]]? {
    if prev.isEmpty { return nil }
    if prev.count != next.count { return nil }                 // 结构变化 → 全量
    let prevById = Dictionary(uniqueKeysWithValues: prev.compactMap { n -> (Int, [String: Any])? in
        guard let id = n["id"] as? Int else { return nil }
        return (id, n)
    })
    // ★只比这些**布局字段**（其余字段改了对几何没有影响）
    let layoutKeys = ["width", "height", "flexGrow", "flexShrink", "flexBasis", "gap"]
    var patches: [[String: Any]] = []
    for n in next {
        guard let id = n["id"] as? Int, let p = prevById[id] else { return nil }  // 新节点 → 全量
        // 文本变了 → 度量要重算，当前 update 入口不支持 → 全量
        let pt = p["text"] as? String
        let nt = n["text"] as? String
        if pt != nt { return nil }
        var style: [String: Any] = [:]
        for k in layoutKeys {
            let a = p[k] as? Double
            let b = n[k] as? Double
            if a != b { style[k] = b ?? NSNull() }             // NSNull = 显式置空（回 auto）
        }
        // margin/padding：对象比较（浅比足够——字段固定四边）
        for k in ["margin", "padding"] {
            let a = p[k] as? [String: Double]
            let b = n[k] as? [String: Double]
            if !edgesEqual(a, b) { style[k] = b ?? [:] }
        }
        if !style.isEmpty { patches.append(["id": id, "style": style]) }
    }
    return patches
}

private func edgesEqual(_ a: [String: Double]?, _ b: [String: Double]?) -> Bool {
    let la = a ?? [:], lb = b ?? [:]
    for k in ["top", "right", "bottom", "left"] {
        if (la[k] ?? 0) != (lb[k] ?? 0) { return false }
    }
    return true
}

/// 供 `jsonString` 之外的调用点使用（同实现；命名区分以免与既有重载混淆）
func jsonString2(_ o: Any) -> String {
    guard let d = try? JSONSerialization.data(withJSONObject: o),
          let s = String(data: d, encoding: .utf8) else { return "[]" }
    return s
}

func jsonString(_ o: [String: Any]) -> String {
    guard let d = try? JSONSerialization.data(withJSONObject: o),
          let s = String(data: d, encoding: .utf8) else { return "{}" }
    return s
}

func jsonEscape(_ s: String) -> String {
    let escaped = s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
    return "\"\(escaped)\""
}

