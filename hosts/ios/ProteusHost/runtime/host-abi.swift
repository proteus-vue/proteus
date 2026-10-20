// hosts/ios/ProteusHost/runtime/host-abi.swift
// ★★★#1100：Rust 排版核心的 **C ABI 绑定声明**——从 `selfdraw-scene.swift` 机械搬迁（零行为变化）。
//
// 【职责单一】只有 `@_silgen_name` 声明 + 与之配套的结构体（版本/VTable/度量）。
//   不实现任何逻辑、不持有状态 ⇒ 任何宿主场景（自绘/逻辑基准/夹具）都能共用这一份「内核长什么样」。
//   ★真源在 Rust 侧 `packages/layout-core-rust/src/ffi.rs`；本文件是它的 Swift 侧镜像，
//     签名漂移由 `bash hosts/ios/check-selfdraw-compile.sh`（类型检查）与链接期共同把关。
import Foundation

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
@_silgen_name("proteus_layout_text_policy")
func proteus_layout_text_policy(_ handle: UInt64, _ nodeIdsJson: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>
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

/* ★★★B4（决策 #834）：材质几何/曲线的**内核单源**查询——宿主不再各写一份公式 */
/// 线性渐变端点（单位空间；CSS 规范式）——入参 `{"nodeId":N}` ⇒ `{ok,x0,y0,x1,y1,cx,cy,r}`
@_silgen_name("proteus_layout_gradient_endpoints")
func proteus_layout_gradient_endpoints(_ handle: UInt64, _ json: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>
/// 发光分层参数——入参 `{"nodeId":N,"intensity":0..1}` ⇒ `{ok,layers:[[boostPx,alpha],…]}`
@_silgen_name("proteus_layout_glow_layers")
func proteus_layout_glow_layers(_ handle: UInt64, _ json: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>
/// 遮罩揭示色标——入参 `{"nodeId":N}` ⇒ `{ok,kind,stops:[oA,aA,oB,aB]}`
@_silgen_name("proteus_layout_mask_stops")
func proteus_layout_mask_stops(_ handle: UInt64, _ json: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>

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

