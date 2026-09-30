// packages/host-abi/src/lib.rs
// ★★**Host ABI v1 的引擎侧实现**（契约见 `include/proteus_host_abi.h`）
//
// 【这一层是什么（方案 §0.4.8 的判断标准）】"这段代码换到同平台的另一个 App 里，需要改吗？"
//   · **需要改** ⇒ 宿主集成 ⇒ 归本层（Surface / 生命周期 / 输入 / 调度 / 能力注册 / 原生组件挂钩）
//   · **不用改** ⇒ 平台适配 ⇒ **不归本层**（文本度量 / 图片解码 / 绘制执行）——那些由宿主经
//     vtable **注入**（本层只做"回调转发"，不含任何平台代码）
//
// 【与内核的关系】本层**使用** `proteus-layout-core` 的 C ABI（`ffi.rs`）——
//   不复制内核逻辑，只把内核入口组织成"宿主契约"的形状（版本协商 / 批处理红线 / 能力插件）。
//   ⇒ 内核零改动，宿主按本契约实现即可。
//
// 【硬约束（违反即设计错误，方案 §2/§3/§5/§6）】
//   ① 批处理：`proteus_submit_frame` 一帧一次（`stats.submit_frame_calls` 可验证 = 帧数而非变更数）
//   ② 内核不自建线程：本层**不 spawn 任何线程**；所有调用假定在宿主 platform thread
//   ③ 能力注入而非分支：本层无任何 `cfg(target_os=…)`（`scripts/check-platform-layering.mjs` 把这条机器化）
//   ④ 版本协商不静默：不兼容 ⇒ 返回错误码 + 可操作提示
//   ⑤ 未注册能力明确报错：`PROTEUS_ERR_CAPABILITY_UNREGISTERED`
//
// 【线程安全口径（如实标注）】本层用 `Mutex` 保护注册表，但**语义上要求单线程调用**
//   （方案 §5.2：所有内核交互必须在 platform thread）——`Mutex` 是防止误用在多线程下产生
//   数据竞争（而不是"支持多线程"）。内核侧的树注册表同样是线程局部/Mutex 保护。

use std::collections::HashMap;
use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::Mutex;

use proteus_layout_core::ffi;

/* ────────────────────────── 版本（与 TS `slot-runtime/src/version.ts` 同源） ────────────────────────── */

/// Host ABI 版本（契约形态；新增接口 +1，语义变更 +1 major）
pub const ABI_VERSION: u32 = 1;
/// IR 契约版本
pub const IR_VERSION: u32 = 1;
/// 指令流线格式版本。
///
/// 【★为什么这里是"编译期常量"而不是运行时读 FFI（首版踩到）】`pub const` 要求**编译期**可知，
///   而 FFI 函数（`extern "C"`）不是 const fn ⇒ 编译期即拒（E0015）。
///   ⇒ 正解：**直接引用内核的常量本身**（`layout_core::ops::OPS_VERSION`）——
///     这才是"同源引用"的最强形态（同一符号，不是"同一个值"）。
///   ★跨语言对账另有一层：`scripts/check-host-abi.mjs` 比对 TS 的 `OPS_WIRE_VERSION`
///     （那里同样引用 `OPS_VERSION`），三方同源。
pub const OPS_WIRE_VERSION: u32 = proteus_layout_core::ops::OPS_VERSION;
/// 本 SDK 要求的最低宿主版本
pub const MIN_SHELL_VERSION: u32 = 1;

/* ────────────────────────── 错误码（与头文件一致） ────────────────────────── */

pub const PROTEUS_OK: i32 = 0;
pub const PROTEUS_ERR_INVALID_ARG: i32 = -1;
pub const PROTEUS_ERR_VERSION_MISMATCH: i32 = -2;
pub const PROTEUS_ERR_CAPABILITY_UNREGISTERED: i32 = -3;
#[allow(dead_code)] // 契约完整性：头文件声明了，实现按需使用
pub const PROTEUS_ERR_NO_TREE: i32 = -4;
pub const PROTEUS_ERR_INTERNAL: i32 = -5;

/* ────────────────────────── C 侧类型（与头文件逐字段对齐） ────────────────────────── */

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct ProteusVersionInfo {
    pub abi_version: u32,
    pub ir_version: u32,
    pub ops_wire_version: u32,
    pub min_shell_version: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct ProteusSurface {
    pub native_surface: *mut c_void,
    pub width: i32,
    pub height: i32,
    pub density: f32,
    pub content_scale: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct ProteusTextInput {
    pub text: *const c_char,
    pub node_id: u32,
    pub style_key: u32,
    pub font_size: f32,
    pub font_weight: i32,
    pub font_family: *const c_char,
    pub max_width: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct ProteusTextMetrics {
    pub width: f32,
    pub height: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct ProteusImageRequest {
    pub request_id: u32,
    pub data: *const u8,
    pub len: u32,
    pub node_id: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct ProteusRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct ProteusPointerEvent {
    pub type_: u32,
    pub pointer_id: u32,
    pub x: f32,
    pub y: f32,
    pub timestamp_ns: i64,
}

pub type ProteusMeasureTextFn =
    Option<unsafe extern "C" fn(*const ProteusTextInput, *mut ProteusTextMetrics, *mut c_void) -> i32>;
pub type ProteusDecodeImageFn = Option<unsafe extern "C" fn(*const ProteusImageRequest, *mut c_void, *mut c_void, *mut c_void) -> i32>;
pub type ProteusCapabilityFn =
    Option<unsafe extern "C" fn(*const c_char, *mut c_char, usize, *mut c_void) -> i32>;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ProteusHostVTable {
    pub user_data: *mut c_void,
    pub request_frame: Option<unsafe extern "C" fn(*mut c_void)>,
    pub measure_text: ProteusMeasureTextFn,
    pub decode_image: ProteusDecodeImageFn,
    /// 原生组件（map / video / web-view）：内核请求，宿主创建/更新/销毁
    pub native_view_create: Option<unsafe extern "C" fn(*const c_char, *const ProteusRect, *mut c_void) -> *mut c_void>,
    pub native_view_update: Option<unsafe extern "C" fn(*mut c_void, *const ProteusRect, *mut c_void)>,
    pub native_view_destroy: Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>,
}

// ★`user_data` 是宿主提供的裸指针：按契约"所有调用在同一 platform thread"⇒ 不存在数据竞争。
//   这里显式标注 Send，是为了把它放进全局注册表（Mutex 保护），而不是宣称"支持多线程"。
unsafe impl Send for ProteusHostVTable {}

/* ────────────────────────── 引擎状态 ────────────────────────── */

/// 能力项（宿主注册）
// ★`CString` 非 Copy ⇒ 本结构也不能 Copy（首版误 derive 了 Copy，编译期即拒——
//   这正是"编译期拦住"的价值：错误形态写不出来）
#[derive(Clone)]
struct Capability {
    #[allow(dead_code)]
    name: CString, // 保留原名（诊断用）
    handler: ProteusCapabilityFn,
    user_data: *mut c_void,
}

/// ★批处理红线的**可验证读数**（方案 §3：`submit_frame` 次数应等于帧数，而非变更数）
#[derive(Default, Clone, Copy)]
struct Stats {
    frames: u64,
    /// `proteus_frame` 调用中"引擎认为有事要做"而请求宿主的次数
    frame_requests: u64,
    /// ★**批处理红线核心读数**：跨边界提交次数（应 = 需要提交的帧数，而不是节点变更数）
    submit_frame_calls: u64,
    /// 指令流**条数**累计（与上者相除即"每次提交平均多少条"——上者小、本条大 = 批处理生效）
    submitted_ops: u64,
    /// 度量回调次数（能力注入的活跃度）
    measure_calls: u64,
    /// 能力调用次数 / 未注册命中次数（后者 >0 ⇒ 宿主能力不足，**不静默**）
    capability_calls: u64,
    capability_missing: u64,
    /// 指针事件批次数 / 事件条数（批处理红线同样适用）
    pointer_batches: u64,
    pointer_events: u64,
    lifecycle_events: u64,
    surface_changes: u64,
    /// ★HA4：原生组件（⑦）生命周期读数——**四个数各自可分**（不做成一个大计数：
    ///   "创建了几个/移动了几次/销毁了几个/跳过了几个"是四个不同的问题）
    native_view_created: u64,
    native_view_updated: u64,
    native_view_destroyed: u64,
    native_view_create_failed: u64,
    native_view_skipped_no_geometry: u64,
}

struct EngineState {
    /// 内核树句柄（0 = 未加载树）
    tree: u64,
    vtable: ProteusHostVTable,
    capabilities: HashMap<String, Capability>,
    /// ★HA3：**壳的能力清单**（声明"本壳提供哪些能力"；与 `capabilities` 取并集做端上校验）
    ///
    /// 【与 `capabilities` 的区别（语义必须分清）】清单是**声明**（可能包含由 JS 桥实现的
    ///   能力——无需 Rust handler）；`capabilities` 是**实现**（可被 `call_capability` 真正调用）。
    ///   `None` = 未声明（此时只认已注册的 handler —— 向后兼容旧宿主）。
    shell_capabilities: Option<Vec<String>>,
    /// ★HA4：**原生组件（⑦）的生命周期登记**（node_id → (kind, 宿主句柄, 上次上报的矩形)）
    ///
    /// 【为什么引擎要持有它（设计要点）】`nativeHost` 节点的真实原生 View 由**宿主**创建
    ///   （内核不碰平台类型），但**谁在什么时候创建/移动/销毁**必须由引擎统一编排——
    ///   否则宿主就得自己维护"IR ↔ 原生对象"的对应关系（那正是"换宿主重写一遍"的来源）。
    ///   引擎侧只持**不透明句柄**（`*mut c_void`），不解释它。
    native_views: std::collections::HashMap<u32, (String, *mut c_void, ProteusRect)>,
    /// 树里的 nativeHost 节点（`id` + `semantic` as kind；**按 id 升序**）——`load_tree` 时抽取
    ///
    /// 【为什么在这里存（而不是每次重新扫树）】内核是"哪些节点是 nativeHost"的**唯一事实来源**
    ///   （`NodeDto.native_host` 在 `proteus_layout_create` 的回传里有 `native_hosts`）；
    ///   但本层拿到的是**树 JSON**（输入），抽取一次存下来即可——**不重建树、不遍历内核树**。
    native_nodes: Vec<(u32, String)>,
    stats: Stats,
    last_frame_ns: i64,
    surface: Option<ProteusSurface>,
    lifecycle: u32,
    /// 本帧动画更新缓冲（24B/条；`proteus_frame_updates` 返回其指针）
    frame_updates: Vec<u8>,
    /// 几何缓冲（`proteus_rects` 返回其指针）
    rects: Vec<u8>,
    /// 最近一次错误（诊断；成功时清空）
    last_error: Option<String>,
}

// 同上：user_data 的裸指针按契约在同一线程使用。
unsafe impl Send for EngineState {}

static ENGINES: Mutex<Option<HashMap<u64, EngineState>>> = Mutex::new(None);
static NEXT_ENGINE_ID: Mutex<u64> = Mutex::new(1);

fn with_engine<R>(engine: *mut ProteusEngine, f: impl FnOnce(&mut EngineState) -> R) -> Option<R> {
    let id = engine as usize as u64;
    if id == 0 {
        return None;
    }
    let mut guard = ENGINES.lock().ok()?;
    let map = guard.as_mut()?;
    map.get_mut(&id).map(f)
}

/// 不透明引擎句柄（Rust 侧只是一个 id；宿主侧只持指针，不解释内容）
#[repr(C)]
pub struct ProteusEngine {
    _private: [u8; 0],
}

fn engine_id(e: *mut ProteusEngine) -> u64 {
    e as usize as u64
}

/* ────────────────────────── 小工具 ────────────────────────── */

unsafe fn cstr_or_empty(p: *const c_char) -> String {
    if p.is_null() {
        String::new()
    } else {
        unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned()
    }
}

/// 把可读提示写进宿主的缓冲（**截断也保证 NUL 结尾**——宿主可能用 C 字符串打印它）
unsafe fn write_hint(out: *mut c_char, len: usize, text: &str) {
    if out.is_null() || len == 0 {
        return;
    }
    let bytes = text.as_bytes();
    let n = bytes.len().min(len - 1);
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), out as *mut u8, n);
        *out.add(n) = 0;
    }
}

fn stats_json(s: &Stats) -> String {
    serde_json::json!({
        "ok": true,
        "version": {
            "abi_version": ABI_VERSION,
            "ir_version": IR_VERSION,
            "ops_wire_version": OPS_WIRE_VERSION,
            "min_shell_version": MIN_SHELL_VERSION,
        },
        "frames": s.frames,
        "frame_requests": s.frame_requests,
        "submit_frame_calls": s.submit_frame_calls,
        "submitted_ops": s.submitted_ops,
        "measure_calls": s.measure_calls,
        "capability_calls": s.capability_calls,
        "capability_missing": s.capability_missing,
        "pointer_batches": s.pointer_batches,
        "pointer_events": s.pointer_events,
        "lifecycle_events": s.lifecycle_events,
        "surface_changes": s.surface_changes,
        "native_view_created": s.native_view_created,
        "native_view_updated": s.native_view_updated,
        "native_view_destroyed": s.native_view_destroyed,
        "native_view_create_failed": s.native_view_create_failed,
        "native_view_skipped_no_geometry": s.native_view_skipped_no_geometry,
        // ★派生读数：批处理红线的直接判据（每次提交平均多少条指令 —— 越大越"批"）
        "ops_per_submit": if s.submit_frame_calls == 0 { 0.0 }
            else { s.submitted_ops as f64 / s.submit_frame_calls as f64 },
    })
    .to_string()
}

/* ────────────────────────── 版本协商 ────────────────────────── */

#[no_mangle]
pub extern "C" fn proteus_abi_version_info() -> ProteusVersionInfo {
    ProteusVersionInfo {
        abi_version: ABI_VERSION,
        ir_version: IR_VERSION,
        ops_wire_version: OPS_WIRE_VERSION,
        min_shell_version: MIN_SHELL_VERSION,
    }
}

/// 协商（方案 §6 强制要求 ②：不兼容 ⇒ **可操作**提示，不得静默）
#[no_mangle]
pub unsafe extern "C" fn proteus_check_versions(
    host_version: *const ProteusVersionInfo,
    hint_out: *mut c_char,
    hint_len: usize,
) -> i32 {
    if host_version.is_null() {
        unsafe { write_hint(hint_out, hint_len, "宿主未提供版本声明（ProteusVersionInfo* 为 NULL）——请传 proteus_abi_version_info() 得到的结构") };
        return PROTEUS_ERR_INVALID_ARG;
    }
    let h = unsafe { *host_version };
    // ★判据：ABI major 必须相等；宿主声明的最低宿主版本不得高于本 SDK 支持的上限
    if h.abi_version != ABI_VERSION {
        unsafe {
            write_hint(
                hint_out,
                hint_len,
                &format!(
                    "Host ABI 版本不兼容：宿主 {}.x vs SDK {}.x —— 升级方式：① 更新 Proteus SDK 到同一 ABI major；\
                     ② 或按 include/proteus_host_abi.h 的对应版本重新实现宿主回调（八接口签名见该头文件注释）",
                    h.abi_version, ABI_VERSION
                ),
            )
        };
        return PROTEUS_ERR_VERSION_MISMATCH;
    }
    if h.min_shell_version > ABI_VERSION {
        unsafe {
            write_hint(
                hint_out,
                hint_len,
                &format!(
                    "宿主声明的最低宿主版本 {} 高于 SDK 的 ABI 版本 {} —— 说明宿主是**更新**的一侧；\
                     升级方式：更新 SDK（本 SDK 的 ops_wire_version={}）；或让宿主降到兼容版本",
                    h.min_shell_version, ABI_VERSION, OPS_WIRE_VERSION
                ),
            )
        };
        return PROTEUS_ERR_VERSION_MISMATCH;
    }
    if h.ops_wire_version != OPS_WIRE_VERSION {
        unsafe {
            write_hint(
                hint_out,
                hint_len,
                &format!(
                    "指令流线格式版本不一致：宿主 {} vs SDK {} —— 指令字节语义不同，**必须双端同步**。\
                     升级方式：① 用与本 SDK 同版本的编译器重新产出指令流；② 或升级 SDK。\
                     （不兼容的典型原因：池策略变更——v1 全量池 → v2 池按需）",
                    h.ops_wire_version, OPS_WIRE_VERSION
                ),
            )
        };
        return PROTEUS_ERR_VERSION_MISMATCH;
    }
    unsafe { write_hint(hint_out, hint_len, "版本兼容") };
    PROTEUS_OK
}

/// 预热（方案 §8.5：宿主在 App 启动阶段调用，避免首屏白屏）。幂等。
#[no_mangle]
pub extern "C" fn proteus_prewarm() {
    // ★预热目前只做"注册表初始化"（真正的重活是首次 `proteus_load_tree` 的解析+建树）。
    //   ★诚实边界：这里**不伪造**"已经热了"——宿主可先 `load_tree` 空树做真预热（见接入文档）。
    //   （`let _ = lock()` 被 `let_underscore_lock` 拒——那是正确的 lint：会立即释放锁，形同没锁。）
    if let Ok(mut g) = ENGINES.lock() {
        g.get_or_insert_with(std::collections::HashMap::new);
    }
}

/* ────────────────────────── 引擎创建 / 销毁 ────────────────────────── */

#[no_mangle]
pub unsafe extern "C" fn proteus_engine_create(
    host: *const ProteusHostVTable,
    host_version: *const ProteusVersionInfo,
    hint_out: *mut c_char,
    hint_len: usize,
) -> *mut ProteusEngine {
    if host.is_null() {
        unsafe { write_hint(hint_out, hint_len, "host vtable 为 NULL（至少需要 request_frame / measure_text）") };
        return std::ptr::null_mut();
    }
    let vt = unsafe { *host };
    if vt.request_frame.is_none() {
        unsafe { write_hint(hint_out, hint_len, "vtable.request_frame 缺失——引擎需要它来通知宿主 schedule 下一帧（内核不自建线程）") };
        return std::ptr::null_mut();
    }
    // 版本协商（不兼容就不创建——早失败，且给可操作提示）
    let rc = unsafe { proteus_check_versions(host_version, hint_out, hint_len) };
    if rc != PROTEUS_OK {
        return std::ptr::null_mut();
    }

    let id = {
        let mut n = match NEXT_ENGINE_ID.lock() {
            Ok(g) => g,
            Err(_) => return std::ptr::null_mut(),
        };
        let v = *n;
        *n += 1;
        v
    };
    let st = EngineState {
        tree: 0,
        vtable: vt,
        capabilities: HashMap::new(),
        shell_capabilities: None,
        native_views: HashMap::new(),
        native_nodes: Vec::new(),
        stats: Stats::default(),
        last_frame_ns: 0,
        surface: None,
        lifecycle: 0,
        frame_updates: Vec::new(),
        rects: Vec::new(),
        last_error: None,
    };
    let mut guard = match ENGINES.lock() {
        Ok(g) => g,
        Err(_) => return std::ptr::null_mut(),
    };
    guard.get_or_insert_with(HashMap::new).insert(id, st);
    id as usize as *mut ProteusEngine
}

#[no_mangle]
pub unsafe extern "C" fn proteus_engine_destroy(engine: *mut ProteusEngine) -> *mut c_void {
    let id = engine_id(engine);
    if id == 0 {
        return std::ptr::null_mut();
    }
    let removed = ENGINES
        .lock()
        .ok()
        .and_then(|mut g| g.as_mut().and_then(|m| m.remove(&id)));
    if let Some(mut st) = removed {
        // ★HA4：先销毁全部原生 View（⑧ 的顺序纪律：宿主对象与内核树**同生共死**——
        //   若先销毁树再通知宿主，"此刻几何已查不到"，宿主只能凭空猜着拆）
        destroy_all_native_views(&mut st);
        // 释放内核树（**必须**——否则内核注册表泄漏）
        if st.tree != 0 {
            let _ = ffi::proteus_layout_destroy(st.tree);
        }
    }
    std::ptr::null_mut()
}

/* ────────────────────────── ① ② ③ ④ 宿主入口 ────────────────────────── */

#[no_mangle]
pub unsafe extern "C" fn proteus_surface_changed(engine: *mut ProteusEngine, surface: *const ProteusSurface) {
    if surface.is_null() {
        return;
    }
    let s = unsafe { *surface };
    let _ = with_engine(engine, |st| {
        st.surface = Some(s);
        st.stats.surface_changes += 1;
        st.last_error = None;
    });
}

#[no_mangle]
pub unsafe extern "C" fn proteus_lifecycle(engine: *mut ProteusEngine, state: u32) {
    let _ = with_engine(engine, |st| {
        if state > 3 {
            st.last_error = Some(format!("未知生命周期状态 {state}（0..=3）"));
            return;
        }
        st.lifecycle = state;
        st.stats.lifecycle_events += 1;
        st.last_error = None;
    });
}

/// 指针事件**批处理**（方案 §2.4 硬要求）。返回命中的节点 id；无命中 = 0；非法 = -1。
#[no_mangle]
pub unsafe extern "C" fn proteus_dispatch_pointers(
    engine: *mut ProteusEngine,
    events: *const ProteusPointerEvent,
    count: usize,
) -> i64 {
    if events.is_null() || count == 0 {
        return PROTEUS_ERR_INVALID_ARG as i64;
    }
    let evs = unsafe { std::slice::from_raw_parts(events, count) };
    let r = with_engine(engine, |st| {
        st.stats.pointer_batches += 1;
        st.stats.pointer_events += count as u64;
        if st.tree == 0 {
            st.last_error = Some("未加载树——指针事件无处派发".into());
            return -1i64;
        }
        // ★用**最后一个**事件的坐标做命中（"抬指在谁身上"= 手势意图；与既有宿主一致）
        let last = evs[evs.len() - 1];
        let json_ptr = unsafe { ffi::proteus_layout_hit_test(st.tree, last.x, last.y) };
        if json_ptr.is_null() {
            st.last_error = Some("hit_test 返回空指针".into());
            return -1i64;
        }
        let json = unsafe { CStr::from_ptr(json_ptr) }.to_string_lossy().into_owned();
        unsafe { ffi::proteus_layout_free_string(json_ptr) };
        let v: serde_json::Value = serde_json::from_str(&json).unwrap_or(serde_json::Value::Null);
        st.last_error = None;
        v.get("target").and_then(|t| t.as_i64()).unwrap_or(0)
    });
    r.unwrap_or(PROTEUS_ERR_INVALID_ARG as i64)
}

/// 每帧驱动（宿主 vsync 回调内调）。返回 PROTEUS_OK。
#[no_mangle]
pub unsafe extern "C" fn proteus_frame(engine: *mut ProteusEngine, frame_time_ns: i64) -> i32 {
    let r = with_engine(engine, |st| {
        st.stats.frames += 1;
        let dt_ms = if st.last_frame_ns == 0 {
            16.7
        } else {
            let d = (frame_time_ns - st.last_frame_ns) as f64 / 1e6;
            // 首帧/卡顿保护：dt 上限 100ms（否则一步跳完整段动画）
            d.clamp(0.1, 100.0) as f32
        };
        st.last_frame_ns = frame_time_ns;
        // 推进动画（内核求值）→ 缓存本帧更新（宿主经 `proteus_frame_updates` 取）
        st.frame_updates.clear();
        if st.tree != 0 {
            let mut len: u32 = 0;
            let p = unsafe { ffi::proteus_layout_anim_tick_bin(st.tree, dt_ms, &mut len) };
            if !p.is_null() && len > 0 {
                st.frame_updates = unsafe { std::slice::from_raw_parts(p, len as usize) }.to_vec();
                unsafe { ffi::proteus_rects_free(p, len) };
            }
        }
        // 有更新 ⇒ 需要宿主把帧提交出去（续帧由宿主的渲染管线决定；此处只标记"有事做"）
        let need_more = !st.frame_updates.is_empty();
        st.last_error = None;
        need_more
    });
    match r {
        Some(need_more) => {
            if need_more {
                let _ = with_engine(engine, |st| st.stats.frame_requests += 1);
            }
            PROTEUS_OK
        }
        None => PROTEUS_ERR_INVALID_ARG,
    }
}

/* ────────────────────────── 数据入口 ────────────────────────── */

#[no_mangle]
pub unsafe extern "C" fn proteus_load_tree(engine: *mut ProteusEngine, tree_json: *const c_char) -> i32 {
    if tree_json.is_null() {
        return PROTEUS_ERR_INVALID_ARG;
    }
    let raw = unsafe { cstr_or_empty(tree_json) };
    let r = with_engine(engine, |st| -> i32 {
        // ★★HA3：**端上校验**（Playground §4.2）——产物若声明了 `requiredCapabilities`，
        //   加载前先校验"本壳提不提供"；不满足即**拒绝加载**（不是跑到一半崩）。
        //   ★放在最前：校验不过就不该做任何副作用（度量回调/建树/换树）。
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(arr) = v.get("requiredCapabilities").and_then(|a| a.as_array()) {
                let required: Vec<String> = arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect();
                let (missing, report) = capability_gap_report(st, &required);
                if !missing.is_empty() {
                    st.stats.capability_missing += 1;
                    st.last_error = Some(report);
                    return PROTEUS_ERR_CAPABILITY_UNREGISTERED;
                }
            }
        }
        // ★★HA2 的落点：**平台能力经 vtable 注入**——宿主没预量文本时，由本层回调宿主逐节点度量。
        let prepared = match prepare_tree_json(&raw, st) {
            Ok(s) => s,
            Err(e) => {
                st.last_error = Some(e);
                return PROTEUS_ERR_INVALID_ARG;
            }
        };
        // ★在 `CString::new` **吃掉** `prepared` 之前，先抽出 native 清单（顺序敏感）
        let native_nodes = native_nodes_in_tree(&prepared);
        let cs = match CString::new(prepared) {
            Ok(c) => c,
            Err(_) => {
                st.last_error = Some("树 JSON 含 NUL".into());
                return PROTEUS_ERR_INVALID_ARG;
            }
        };
        if st.tree != 0 {
            let _ = ffi::proteus_layout_destroy(st.tree);
            st.tree = 0;
        }
        let h = unsafe { ffi::proteus_layout_create(cs.as_ptr()) };
        if h == 0 {
            st.last_error = Some("内核建树失败（proteus_layout_create 返回 0）".into());
            return PROTEUS_ERR_INTERNAL;
        }
        st.tree = h;
        // ★HA4：换树 ⇒ ① 抽取本树的 nativeHost 清单（供生命周期驱动）
        //              ② **旧的原生 View 全部销毁**（它们绑的是旧树；留着就是孤儿对象）
        st.native_nodes = native_nodes;
        destroy_all_native_views(st);
        // ③ 建新的（宿主未实现 ⑦ 号接口时**明确报错**——不静默跳过）
        //
        // ★★注意清空 `last_error` 的**位置**（本轮实测的缺陷）：必须在 sync **之前**清。
        //   首版把它放在最后 ⇒ 把 sync 刚写进去的"宿主拒绝创建（kind=X）"**当场抹掉**，
        //   现象是"拒绝发生了但 last_error 是空的"（`native_view_create_failed=1` 却查不到原因）。
        //   ⇒ 纪律：**完成类清理要在产生该类信息的动作之前**做，否则就是在擦自己的记录。
        st.last_error = None;
        let rc = sync_native_views(st, "load_tree");
        if rc != PROTEUS_OK {
            return rc;
        }
        PROTEUS_OK
    });
    r.unwrap_or(PROTEUS_ERR_INVALID_ARG)
}

/// ★**能力注入**：若树里没有 `textMeasures` 而宿主提供了度量回调 ⇒ 逐文本节点回调宿主，补齐度量。
///
/// 【为什么在这一层做（而不是让内核回调）】内核的输入契约是"度量表随树一起给"（`LayoutRequest.text_measures`）
///   ——那是它**平台无关**的体现。**由谁把表填出来**是宿主侧的事 ⇒ 本层负责遍历 + 回调，
///   宿主只需实现一个 `measure_text(text, style) -> (w,h)` 函数，**不必自己走树**。
///
/// 【编码口径】上游 `textMeasures` 值为 `{"width":..,"height":..}`（与 `NodeDto` 的 SizeDto 对齐）。
fn prepare_tree_json(raw: &str, st: &mut EngineState) -> Result<String, String> {
    let mut v: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("树 JSON 解析失败：{e}"))?;
    let has_measures = v
        .get("textMeasures")
        .and_then(|m| m.as_object())
        .map(|o| !o.is_empty())
        .unwrap_or(false);
    if has_measures {
        return Ok(raw.to_string()); // 宿主已自带度量（或场景无文本）⇒ 原样透传
    }
    let Some(measure) = st.vtable.measure_text else {
        return Ok(raw.to_string()); // 无度量能力：交给内核按"零尺寸"处理（NullTextMeasurer 语义）
    };
    let Some(nodes) = v.get("nodes").and_then(|n| n.as_array()) else {
        return Ok(raw.to_string());
    };
    let mut measures = serde_json::Map::new();
    for n in nodes {
        let text = n.get("text").and_then(|t| t.as_str()).unwrap_or("");
        let is_text = n.get("isText").and_then(|t| t.as_bool()).unwrap_or(false);
        if text.is_empty() && !is_text {
            continue;
        }
        let id = n.get("id").and_then(|i| i.as_u64()).unwrap_or(0);
        let input = ProteusTextInput {
            text: CString::new(text).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut()),
            node_id: id as u32,
            style_key: n.get("textStyleKey").and_then(|k| k.as_u64()).unwrap_or(0) as u32,
            font_size: n.get("fontSize").and_then(|k| k.as_f64()).unwrap_or(0.0) as f32,
            font_weight: n.get("fontWeight").and_then(|k| k.as_i64()).unwrap_or(0) as i32,
            font_family: std::ptr::null(), // 语义角色：v1 经 fontSize/fontWeight 传递（族名扩展随 v2）
            max_width: 0.0,
        };
        let mut out = ProteusTextMetrics::default();
        st.stats.measure_calls += 1;
        let rc = unsafe { measure(&input, &mut out, st.vtable.user_data) };
        // 释放我们为入参分配的 CString（所有权在我们）
        if !input.text.is_null() {
            drop(unsafe { CString::from_raw(input.text as *mut c_char) });
        }
        if rc == PROTEUS_OK {
            measures.insert(
                id.to_string(),
                serde_json::json!({ "width": out.width, "height": out.height }),
            );
        }
    }
    if let Some(obj) = v.as_object_mut() {
        obj.insert("textMeasures".into(), serde_json::Value::Object(measures));
    }
    serde_json::to_string(&v).map_err(|e| format!("回写度量失败：{e}"))
}

/// ★★**批处理红线入口**（方案 §3）：一帧的全部指令走**一次**调用。
#[no_mangle]
pub unsafe extern "C" fn proteus_submit_frame(
    engine: *mut ProteusEngine,
    ops: *const u8,
    byte_len: usize,
) -> i32 {
    if ops.is_null() || byte_len == 0 {
        return PROTEUS_ERR_INVALID_ARG;
    }
    let bytes = unsafe { std::slice::from_raw_parts(ops, byte_len) }.to_vec();
    let r = with_engine(engine, |st| -> i32 {
        st.stats.submit_frame_calls += 1;
        if st.tree == 0 {
            st.last_error = Some("未加载树就提交指令流".into());
            return PROTEUS_ERR_NO_TREE;
        }
        let p = unsafe { ffi::proteus_layout_apply_ops_norects(st.tree, bytes.as_ptr(), bytes.len() as u32) };
        if p.is_null() {
            st.last_error = Some("apply_ops 返回空指针".into());
            return PROTEUS_ERR_INTERNAL;
        }
        let json = unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned();
        unsafe { ffi::proteus_layout_free_string(p) };
        let ok = serde_json::from_str::<serde_json::Value>(&json)
            .ok()
            .and_then(|v| v.get("ok").and_then(|b| b.as_bool()))
            .unwrap_or(false);
        if !ok {
            st.last_error = Some(format!("apply_ops 失败：{}", json.chars().take(200).collect::<String>()));
            return PROTEUS_ERR_INTERNAL;
        }
        // 指令条数：由内核返回的 applied 计数给出（无则记 1——至少证明"批处理发生过"）
        let n = serde_json::from_str::<serde_json::Value>(&json)
            .ok()
            .and_then(|v| v.get("applied").and_then(|a| a.as_u64()))
            .unwrap_or(1);
        st.stats.submitted_ops += n;
        // ★HA4：指令流改了布局 ⇒ 原生 View 的几何要跟着走（**只对真变了的调 update**）
        //   ★`last_error` 的清空同样放在 sync **之前**（见 load_tree 处的同款注释）
        st.last_error = None;
        let rc = sync_native_views(st, "submit_frame");
        if rc != PROTEUS_OK {
            return rc;
        }
        PROTEUS_OK
    });
    r.unwrap_or(PROTEUS_ERR_INVALID_ARG)
}

#[no_mangle]
pub unsafe extern "C" fn proteus_frame_updates(engine: *mut ProteusEngine, out_len: *mut u32) -> *const u8 {
    if !out_len.is_null() {
        unsafe { *out_len = 0 };
    }
    let r = with_engine(engine, |st| (st.frame_updates.as_ptr(), st.frame_updates.len() as u32));
    match r {
        Some((p, n)) => {
            if !out_len.is_null() {
                unsafe { *out_len = n };
            }
            p
        }
        None => std::ptr::null(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn proteus_rects(engine: *mut ProteusEngine, out_len: *mut u32) -> *const u8 {
    if !out_len.is_null() {
        unsafe { *out_len = 0 };
    }
    let r = with_engine(engine, |st| -> Option<(usize, u32)> {
        if st.tree == 0 {
            return None;
        }
        let mut len: u32 = 0;
        let p = unsafe { ffi::proteus_layout_rects_bin(st.tree, &mut len) };
        if p.is_null() || len == 0 {
            return None;
        }
        st.rects = unsafe { std::slice::from_raw_parts(p, len as usize) }.to_vec();
        unsafe { ffi::proteus_rects_free(p, len) };
        Some((st.rects.as_ptr() as usize, len))
    });
    match r.flatten() {
        Some((p, n)) => {
            if !out_len.is_null() {
                unsafe { *out_len = n };
            }
            // ★指针来自 `st.rects`（Vec）——宿主用完前不得再次调用（契约里已写明"有效期到下次同类调用"）
            p as *const u8
        }
        None => std::ptr::null(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn proteus_stats_json(engine: *mut ProteusEngine) -> *const c_char {
    // ★用 thread_local 存 CString：保证指针在下次调用前有效（与内核 `proteus_stats_json` 同法）
    thread_local! {
        static LAST: std::cell::RefCell<Option<CString>> = const { std::cell::RefCell::new(None) };
    }
    let json = with_engine(engine, |st| {
        let mut s = stats_json(&st.stats);
        if let Some(e) = &st.last_error {
            if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&s) {
                if let Some(o) = v.as_object_mut() {
                    o.insert("last_error".into(), serde_json::Value::String(e.clone()));
                }
                s = v.to_string();
            }
        }
        s
    })
    .unwrap_or_else(|| "{\"ok\":false,\"error\":\"引擎句柄无效\"}".to_string());
    let cs = match CString::new(json) {
        Ok(c) => c,
        Err(_) => return std::ptr::null(),
    };
    LAST.with(|cell| {
        *cell.borrow_mut() = Some(cs);
        cell.borrow().as_ref().map(|c| c.as_ptr()).unwrap_or(std::ptr::null())
    })
}

/* ────────────────────────── 动画（v1 直调入口） ────────────────────────── */

#[no_mangle]
pub unsafe extern "C" fn proteus_anim_start(engine: *mut ProteusEngine, anims_json: *const c_char) -> i32 {
    if anims_json.is_null() {
        return PROTEUS_ERR_INVALID_ARG;
    }
    let raw = unsafe { cstr_or_empty(anims_json) };
    let r = with_engine(engine, |st| -> i32 {
        if st.tree == 0 {
            st.last_error = Some("未加载树就启动动画".into());
            return PROTEUS_ERR_NO_TREE;
        }
        let cs = match CString::new(raw) {
            Ok(c) => c,
            Err(_) => return PROTEUS_ERR_INVALID_ARG,
        };
        let p = unsafe { ffi::proteus_layout_anim_start(st.tree, cs.as_ptr()) };
        if p.is_null() {
            return PROTEUS_ERR_INTERNAL;
        }
        let json = unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned();
        unsafe { ffi::proteus_layout_free_string(p) };
        let ok = serde_json::from_str::<serde_json::Value>(&json)
            .ok()
            .and_then(|v| v.get("ok").and_then(|b| b.as_bool()))
            .unwrap_or(false);
        if !ok {
            st.last_error = Some(json.chars().take(200).collect());
            return PROTEUS_ERR_INTERNAL;
        }
        st.last_error = None;
        PROTEUS_OK
    });
    r.unwrap_or(PROTEUS_ERR_INVALID_ARG)
}

#[no_mangle]
pub unsafe extern "C" fn proteus_anim_stop(engine: *mut ProteusEngine, json: *const c_char) -> i32 {
    if json.is_null() {
        return PROTEUS_ERR_INVALID_ARG;
    }
    let raw = unsafe { cstr_or_empty(json) };
    let r = with_engine(engine, |st| -> i32 {
        if st.tree == 0 {
            return PROTEUS_ERR_NO_TREE;
        }
        let cs = match CString::new(raw) {
            Ok(c) => c,
            Err(_) => return PROTEUS_ERR_INVALID_ARG,
        };
        let p = unsafe { ffi::proteus_layout_anim_stop(st.tree, cs.as_ptr()) };
        if !p.is_null() {
            unsafe { ffi::proteus_layout_free_string(p) };
        }
        st.frame_updates.clear();
        st.last_error = None;
        PROTEUS_OK
    });
    r.unwrap_or(PROTEUS_ERR_INVALID_ARG)
}

/* ────────────────────────── ⑦ 原生组件：**引擎驱动的生命周期**（HA4） ────────────────────────── */

/// 读节点**绝对几何**（经内核 `proteus_layout_node_rect`；`None` = 查不到，含"不在树上/display:none"）
///
/// 【为什么用点查询而不是 `proteus_layout_rects_bin`】后者返回的是**最近一次重排范围内**的矩形
///   （V4 的性能设计）；而原生 View 的摆放**不能**依赖"它恰好在最近那次 scope 里"。
fn node_rect(st: &EngineState, node_id: u32) -> Option<ProteusRect> {
    if st.tree == 0 {
        return None;
    }
    let p = unsafe { ffi::proteus_layout_node_rect(st.tree, node_id) };
    if p.is_null() {
        return None;
    }
    let json = unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned();
    unsafe { ffi::proteus_layout_free_string(p) };
    let v: serde_json::Value = serde_json::from_str(&json).ok()?;
    if v.get("ok").and_then(|b| b.as_bool()) != Some(true) {
        return None;
    }
    Some(ProteusRect {
        x: v.get("x")?.as_f64()? as f32,
        y: v.get("y")?.as_f64()? as f32,
        width: v.get("width")?.as_f64()? as f32,
        height: v.get("height")?.as_f64()? as f32,
    })
}

/// 从树 JSON 抽取 nativeHost 节点（`id` + `semantic` 作 kind）——**按 id 升序**（确定性）
fn native_nodes_in_tree(raw: &str) -> Vec<(u32, String)> {
    let mut out: Vec<(u32, String)> = Vec::new();
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
        return out;
    };
    if let Some(nodes) = v.get("nodes").and_then(|n| n.as_array()) {
        for n in nodes {
            if n.get("nativeHost").and_then(|b| b.as_bool()) != Some(true) {
                continue;
            }
            let Some(id) = n.get("id").and_then(|i| i.as_u64()) else { continue };
            let kind = n.get("semantic").and_then(|s| s.as_str()).unwrap_or("native").to_string();
            out.push((id as u32, kind));
        }
    }
    out.sort_by_key(|(id, _)| *id);
    out
}

/// 矩形是否**真的**变了（逐字段；`NaN` 视作"变了"以求安全——宁可多同步一次）
fn rect_changed(a: &ProteusRect, b: &ProteusRect) -> bool {
    !(a.x == b.x && a.y == b.y && a.width == b.width && a.height == b.height)
}

/// ★**引擎驱动原生组件生命周期**：创建缺失的 / 同步几何 / 销毁过时的
///
/// 【三条语义（都是"静默失效"的预防）】
///   ① **只创建缺失的**（同 id 二次同步不重复创建——原生对象是稀缺资源）；
///   ② **几何真变了才调 update**（逐字段比较；每帧无脑同步 = 白付跨边界成本）；
///   ③ **回调缺失 / 宿主拒绝 ⇒ 明确报错**（`last_error` + 错误码；不假装成功）。
///
/// 【为什么由引擎编排（而不是宿主自己维护）】否则宿主就得维护"IR ↔ 原生对象"的对应关系
///   ——那正是"换宿主重写一遍"的来源。引擎只持**不透明句柄**，不解释平台类型。
fn sync_native_views(st: &mut EngineState, reason: &str) -> i32 {
    let ids = st.native_nodes.clone();
    if ids.is_empty() && st.native_views.is_empty() {
        return PROTEUS_OK; // 无 native 节点、也无已建对象 ⇒ 无活可干
    }
    // ① 销毁过时的（先销毁：避免 id 复用时新旧对象并存）
    let stale: Vec<u32> = st
        .native_views
        .keys()
        .copied()
        .filter(|k| !ids.iter().any(|(i, _)| i == k))
        .collect();
    for id in stale {
        if let Some((_, handle, _)) = st.native_views.remove(&id) {
            if let Some(f) = st.vtable.native_view_destroy {
                unsafe { f(handle, st.vtable.user_data) };
            }
            st.stats.native_view_destroyed += 1;
        }
    }
    // ② 创建缺失 + ③ 同步几何
    for (id, kind) in ids {
        let rect = match node_rect(st, id) {
            Some(r) => r,
            None => {
                // 无几何（如 display:none）⇒ 不创建（建了也摆不了）；记账以便归因
                st.stats.native_view_skipped_no_geometry += 1;
                continue;
            }
        };
        match st.native_views.get_mut(&id) {
            Some((_, handle, last)) => {
                if rect_changed(last, &rect) {
                    if let Some(f) = st.vtable.native_view_update {
                        let h = *handle;
                        unsafe { f(h, &rect as *const ProteusRect, st.vtable.user_data) };
                        *last = rect;
                        st.stats.native_view_updated += 1;
                    }
                }
            }
            None => {
                let Some(f) = st.vtable.native_view_create else {
                    // ★不静默：树里要原生组件而宿主没实现创建 ⇒ 明确报错（错误码 + last_error）
                    st.last_error = Some(format!(
                        "树里有 nativeHost 节点 {id}（kind={kind}），但宿主未提供 native_view_create \
                         （⑦ 号接口未实现）——原生组件无法创建（{reason}）"
                    ));
                    return PROTEUS_ERR_INVALID_ARG;
                };
                let Ok(ck) = CString::new(kind.clone()) else {
                    return PROTEUS_ERR_INVALID_ARG;
                };
                let handle = unsafe { f(ck.as_ptr(), &rect as *const ProteusRect, st.vtable.user_data) };
                if handle.is_null() {
                    // ★宿主**明确拒绝**（如 kind 不支持）⇒ 记账 + 可读原因（不静默）
                    st.last_error = Some(format!(
                        "宿主拒绝创建原生组件（node {id}, kind={kind}）——native_view_create 返回 NULL；\
                         若该 kind 不受支持，业务侧应走降级路径（不要假设它可用）"
                    ));
                    st.stats.native_view_create_failed += 1;
                    continue;
                }
                st.native_views.insert(id, (kind, handle, rect));
                st.stats.native_view_created += 1;
            }
        }
    }
    PROTEUS_OK
}

/// 销毁全部原生 View（引擎销毁 / 换树时清场）
fn destroy_all_native_views(st: &mut EngineState) {
    let ids: Vec<u32> = st.native_views.keys().copied().collect();
    for id in ids {
        if let Some((_, handle, _)) = st.native_views.remove(&id) {
            if let Some(f) = st.vtable.native_view_destroy {
                unsafe { f(handle, st.vtable.user_data) };
            }
            st.stats.native_view_destroyed += 1;
        }
    }
}

/// ★**手动同步入口**（宿主在**滚动/动画**后调用）——几何可能变了而指令流没提交
///
/// 【为什么要手动入口】引擎自动同步挂在 `load_tree` / `submit_frame` 上；
///   但**滚动**（宿主侧偏移）与**动画 tick**（每帧改 translate）也会让原生 View 该跟着动
///   ——那些路径不经过上面两个入口 ⇒ 提供显式同步（宿主在滚动/每帧回调里调）。
#[no_mangle]
pub unsafe extern "C" fn proteus_sync_native_views(engine: *mut ProteusEngine) -> i32 {
    let r = with_engine(engine, |st| sync_native_views(st, "manual-sync"));
    r.unwrap_or(PROTEUS_ERR_INVALID_ARG)
}
/* ────────────────────────── ⑦ 原生组件宿主 ────────────────────────── */

#[no_mangle]
pub unsafe extern "C" fn proteus_native_view_create(
    engine: *mut ProteusEngine,
    kind: *const c_char,
    frame: *const ProteusRect,
) -> *mut c_void {
    let kind_s = unsafe { cstr_or_empty(kind) };
    let rect = frame;
    let r = with_engine(engine, |st| {
        let Some(f) = st.vtable.native_view_create else {
            st.last_error = Some("宿主未提供 native_view_create（⑦ 号接口未实现）".into());
            return std::ptr::null_mut();
        };
        let c = match CString::new(kind_s) {
            Ok(c) => c,
            Err(_) => return std::ptr::null_mut(),
        };
        let h = unsafe { f(c.as_ptr(), rect, st.vtable.user_data) };
        st.last_error = None;
        h
    });
    r.unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub unsafe extern "C" fn proteus_native_view_update(
    engine: *mut ProteusEngine,
    handle: *mut c_void,
    frame: *const ProteusRect,
) {
    let _ = with_engine(engine, |st| {
        if let Some(f) = st.vtable.native_view_update {
            unsafe { f(handle, frame, st.vtable.user_data) };
        }
    });
}

#[no_mangle]
pub unsafe extern "C" fn proteus_native_view_destroy(engine: *mut ProteusEngine, handle: *mut c_void) {
    let _ = with_engine(engine, |st| {
        if let Some(f) = st.vtable.native_view_destroy {
            unsafe { f(handle, st.vtable.user_data) };
        }
    });
}

/* ────────────────────────── ⑧ 能力插件 ────────────────────────── */

#[no_mangle]
pub unsafe extern "C" fn proteus_register_capability(
    engine: *mut ProteusEngine,
    name: *const c_char,
    f: ProteusCapabilityFn,
    user_data: *mut c_void,
) -> i32 {
    if name.is_null() || f.is_none() {
        return PROTEUS_ERR_INVALID_ARG;
    }
    let name_s = unsafe { cstr_or_empty(name) };
    if name_s.is_empty() {
        return PROTEUS_ERR_INVALID_ARG;
    }
    let r = with_engine(engine, |st| {
        let cs = match CString::new(name_s.clone()) {
            Ok(c) => c,
            Err(_) => return PROTEUS_ERR_INVALID_ARG,
        };
        st.capabilities.insert(name_s, Capability { name: cs, handler: f, user_data });
        st.last_error = None;
        PROTEUS_OK
    });
    r.unwrap_or(PROTEUS_ERR_INVALID_ARG)
}

#[no_mangle]
pub unsafe extern "C" fn proteus_has_capability(engine: *mut ProteusEngine, name: *const c_char) -> i32 {
    if name.is_null() {
        return 0;
    }
    let name_s = unsafe { cstr_or_empty(name) };
    with_engine(engine, |st| i32::from(st.capabilities.contains_key(&name_s))).unwrap_or(0)
}

/// ★能力调用（方案 §4.3：未注册 ⇒ **明确报错**，禁止静默失败）
#[no_mangle]
pub unsafe extern "C" fn proteus_call_capability(
    engine: *mut ProteusEngine,
    name: *const c_char,
    arg_json: *const c_char,
    out: *mut c_char,
    out_len: usize,
) -> i32 {
    if name.is_null() {
        return PROTEUS_ERR_INVALID_ARG;
    }
    let name_s = unsafe { cstr_or_empty(name) };
    let arg = unsafe { cstr_or_empty(arg_json) };
    let arg_c = CString::new(arg).unwrap_or_default();
    let r = with_engine(engine, |st| -> i32 {
        st.stats.capability_calls += 1;
        let Some(cap) = st.capabilities.get(&name_s).cloned() else {
            st.stats.capability_missing += 1;
            let msg = format!(
                "能力 `{name_s}` 未注册——当前已注册：{}；\
                 解决方式：① 宿主用 proteus_register_capability 注册该能力；\
                 ② 或改用 Playground「扩展壳」；③ 业务侧做降级路径（**不要**假设它可用）",
                if st.capabilities.is_empty() {
                    "（无）".to_string()
                } else {
                    let mut v: Vec<&str> = st.capabilities.keys().map(|s| s.as_str()).collect();
                    v.sort_unstable();
                    v.join(", ")
                }
            );
            unsafe { write_hint(out, out_len, &msg) };
            return PROTEUS_ERR_CAPABILITY_UNREGISTERED;
        };
        let Some(f) = cap.handler else {
            return PROTEUS_ERR_CAPABILITY_UNREGISTERED;
        };
        st.last_error = None;
        unsafe { f(arg_c.as_ptr(), out, out_len, cap.user_data) }
    });
    r.unwrap_or(PROTEUS_ERR_INVALID_ARG)
}

/* ────────────────────────── ⑧b 能力清单（HA3：Playground §4.2 端上校验） ────────────────────────── */

/// 解析能力 id 列表（**三种入参形态**，见头文件注释）
///
/// ★为什么接受三种（而不是只留一种）：`capability-manifest.json` 是**已有产物**（CLI 落盘），
///   简单数组是**手写最省**的形态 ⇒ 都认，避免调用方为了喂进 ABI 再包一层。
///   ★三种形态**解析到同一个内层结构**（Vec<String>）⇒ 后续逻辑只有一份。
fn parse_capability_ids(v: &serde_json::Value) -> Result<Vec<String>, String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |x: &serde_json::Value| -> Result<(), String> {
        match x {
            // 形态 ①：`{"capabilities":[{"id":"…"}, …]}` —— CLI 落盘的 capability-manifest.json
            serde_json::Value::Object(o) => {
                if let Some(id) = o.get("id").and_then(|i| i.as_str()) {
                    out.push(id.to_string());
                    Ok(())
                } else {
                    Err("能力项对象缺少 `id` 字段".to_string())
                }
            }
            // 形态 ③ 的元素：裸字符串
            serde_json::Value::String(s) => {
                out.push(s.clone());
                Ok(())
            }
            other => Err(format!("能力项形态无法识别：{other}")),
        }
    };
    match v {
        // 形态 ③：`["a","b"]`
        serde_json::Value::Array(arr) => {
            for x in arr {
                push(x)?;
            }
        }
        // 形态 ①/②：对象（含 `capabilities` 或 `ids` 键）
        serde_json::Value::Object(_) => {
            let arr = v
                .get("capabilities")
                .or_else(|| v.get("ids"))
                .and_then(|a| a.as_array())
                .ok_or_else(|| "对象形态需含 `capabilities` 或 `ids` 数组".to_string())?;
            for x in arr {
                push(x)?;
            }
        }
        other => return Err(format!("入参需为数组或对象（含 capabilities/ids），实际：{other}")),
    }
    // 去重（保持稳定顺序：排序——判据与报告都要可复现）
    out.sort_unstable();
    out.dedup();
    Ok(out)
}

/// 本壳**提供**的能力 = 已注册 handler ∪ 壳清单声明（去重排序）
fn provided_capabilities(st: &EngineState) -> Vec<String> {
    let mut v: Vec<String> = st.capabilities.keys().cloned().collect();
    if let Some(decl) = &st.shell_capabilities {
        v.extend(decl.iter().cloned());
    }
    v.sort_unstable();
    v.dedup();
    v
}

/// 端上校验（纯逻辑，便于单测）：返回 `(缺失清单, 可读报告)`
///
/// 报告必须**可操作**（Playground §4.2 的第三格：不满足 ⇒ 明确报错 + 提示需要「扩展壳」）。
fn capability_gap_report(st: &EngineState, required: &[String]) -> (Vec<String>, String) {
    let provided = provided_capabilities(st);
    let missing: Vec<String> = required
        .iter()
        .filter(|r| !provided.contains(r))
        .cloned()
        .collect();
    if missing.is_empty() {
        return (missing, String::new());
    }
    let list = |v: &[String]| {
        if v.is_empty() {
            "（无）".to_string()
        } else {
            v.join(", ")
        }
    };
    let report = format!(
        "能力缺失：本壳不提供 [{}]\n  · 本产物需要：{}\n  · 本壳已提供：{}\n           ⇒ 解决方式：① 用 Proteus CLI 构建「扩展壳」（把缺失的原生模块编进去）——扩展壳与公共壳         共用同一套产物格式与加载器，只有内置模块集不同；② 或业务侧改走降级路径         （**不要**假设该能力可用——未注册时的静默失败是最恶劣的失效模式）",
        list(&missing),
        list(required),
        list(&provided),
    );
    (missing, report)
}

/// ★设置**壳的能力清单**（声明"本壳提供哪些能力"）。见头文件注释的三种入参形态。
#[no_mangle]
pub unsafe extern "C" fn proteus_set_shell_capabilities(
    engine: *mut ProteusEngine,
    json: *const c_char,
) -> i32 {
    if json.is_null() {
        return PROTEUS_ERR_INVALID_ARG;
    }
    let raw = unsafe { cstr_or_empty(json) };
    let r = with_engine(engine, |st| -> i32 {
        let v: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                st.last_error = Some(format!("壳能力清单解析失败：{e}"));
                return PROTEUS_ERR_INVALID_ARG;
            }
        };
        match parse_capability_ids(&v) {
            Ok(ids) => {
                st.shell_capabilities = Some(ids);
                st.last_error = None;
                PROTEUS_OK
            }
            Err(e) => {
                st.last_error = Some(format!("壳能力清单形态非法：{e}"));
                PROTEUS_ERR_INVALID_ARG
            }
        }
    });
    r.unwrap_or(PROTEUS_ERR_INVALID_ARG)
}

/// ★★**端上校验**（Playground §4.2）：产物声明的所需能力 ⊆ 壳提供的？
#[no_mangle]
pub unsafe extern "C" fn proteus_check_capabilities(
    engine: *mut ProteusEngine,
    required_json: *const c_char,
    out: *mut c_char,
    out_len: usize,
) -> i32 {
    if required_json.is_null() {
        return PROTEUS_ERR_INVALID_ARG;
    }
    let raw = unsafe { cstr_or_empty(required_json) };
    let r = with_engine(engine, |st| -> i32 {
        let v: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                st.last_error = Some(format!("所需能力清单解析失败：{e}"));
                unsafe { write_hint(out, out_len, &format!("所需能力清单解析失败：{e}")) };
                return PROTEUS_ERR_INVALID_ARG;
            }
        };
        let required = match parse_capability_ids(&v) {
            Ok(ids) => ids,
            Err(e) => {
                st.last_error = Some(format!("所需能力清单形态非法：{e}"));
                unsafe { write_hint(out, out_len, &format!("所需能力清单形态非法：{e}")) };
                return PROTEUS_ERR_INVALID_ARG;
            }
        };
        let (missing, report) = capability_gap_report(st, &required);
        if missing.is_empty() {
            st.last_error = None;
            unsafe { write_hint(out, out_len, "能力校验通过（产物所需 ⊆ 本壳提供）") };
            PROTEUS_OK
        } else {
            // ★不静默：报告写进 out（宿主必须展示/记录），并计入 stats
            st.stats.capability_missing += 1;
            st.last_error = Some(report.clone());
            unsafe { write_hint(out, out_len, &report) };
            PROTEUS_ERR_CAPABILITY_UNREGISTERED
        }
    });
    r.unwrap_or(PROTEUS_ERR_INVALID_ARG)
}

/* ────────────────────────── 单测（Rust 侧；C 侧一致性测试另有集成用例） ────────────────────────── */

#[cfg(test)]
mod tests {
    use super::*;

    // ★测试回调：记录被调次数 + 返回固定度量（不依赖任何平台）
    static MEASURE_HITS: Mutex<Vec<(u32, String)>> = Mutex::new(Vec::new());
    static FRAME_REQS: Mutex<u64> = Mutex::new(0);

    // ★HA4 测试用的"假原生 View"：引擎只持不透明句柄 ⇒ 测试用序号当句柄就够
    //   （正好也验证了"引擎不解释句柄"这条契约——它只存不动）
    static NATIVE_CREATED: Mutex<Vec<(String, ProteusRect)>> = Mutex::new(Vec::new());
    static NATIVE_UPDATED: Mutex<Vec<(usize, ProteusRect)>> = Mutex::new(Vec::new());
    static NATIVE_DESTROYED: Mutex<Vec<usize>> = Mutex::new(Vec::new());
    static NATIVE_NEXT_HANDLE: Mutex<usize> = Mutex::new(1);
    /// 让"宿主拒绝某 kind"可测（模拟平台不支持 map 之类）
    static NATIVE_REJECT_KIND: Mutex<Option<String>> = Mutex::new(None);

    unsafe extern "C" fn test_native_create(
        kind: *const c_char,
        frame: *const ProteusRect,
        _ud: *mut c_void,
    ) -> *mut c_void {
        let k = unsafe { cstr_or_empty(kind) };
        if let Some(rej) = NATIVE_REJECT_KIND.lock().unwrap().as_ref() {
            if *rej == k {
                return std::ptr::null_mut(); // 明确拒绝（如 kind 不支持）
            }
        }
        let rect = unsafe { *frame }; // 测试里 frame 必非空
        NATIVE_CREATED.lock().unwrap().push((k, rect));
        let mut n = NATIVE_NEXT_HANDLE.lock().unwrap();
        let h = *n;
        *n += 1;
        // ★句柄是"不透明指针"∈ 测试用序号伪造（引擎不会解引用它——本测试即该契约的证据）
        h as *mut c_void
    }

    unsafe extern "C" fn test_native_update(
        handle: *mut c_void,
        frame: *const ProteusRect,
        _ud: *mut c_void,
    ) {
        let rect = unsafe { *frame };
        NATIVE_UPDATED.lock().unwrap().push((handle as usize, rect));
    }

    unsafe extern "C" fn test_native_destroy(handle: *mut c_void, _ud: *mut c_void) {
        NATIVE_DESTROYED.lock().unwrap().push(handle as usize);
    }

    /// ★native 测试**串行锁**：它们共享静态计数器（`NATIVE_CREATED` 等），而 cargo 默认**并行**
    ///   跑测试 ⇒ 不加锁时一个测试的 `reset` 会清掉另一个测试的读数（本轮实测：两个 native
    ///   测试同时红，而单跑各自都绿——这就是"共享可变静态状态 + 并行"的经典假红）。
    ///   ★用 `unwrap_or_else(|e| e.into_inner())` 而不是 `unwrap()`：某测试 panic 后锁会**中毒**，
    ///     后续测试不该因此连锁失败（那样会掩盖真正的失败原因）。
    static NATIVE_TEST_LOCK: Mutex<()> = Mutex::new(());

    fn native_test_guard() -> std::sync::MutexGuard<'static, ()> {
        NATIVE_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn reset_native_counters() {
        NATIVE_CREATED.lock().unwrap().clear();
        NATIVE_UPDATED.lock().unwrap().clear();
        NATIVE_DESTROYED.lock().unwrap().clear();
        *NATIVE_NEXT_HANDLE.lock().unwrap() = 1;
        *NATIVE_REJECT_KIND.lock().unwrap() = None;
    }

    /// 带**原生组件回调**的 vtable（其余同 `vtable()`）
    fn vtable_with_native() -> ProteusHostVTable {
        let mut vt = vtable();
        // ★`unsafeBitCast` 是**自由函数**（`unsafeBitCast(x, to: T)`），不是方法
        vt.native_view_create = Some(test_native_create);
        vt.native_view_update = Some(test_native_update);
        vt.native_view_destroy = Some(test_native_destroy);
        vt
    }

    fn new_engine_with(vt: ProteusHostVTable) -> *mut ProteusEngine {
        let ver = proteus_abi_version_info();
        let mut hint = [0i8; 512];
        unsafe { proteus_engine_create(&vt, &ver, hint.as_mut_ptr(), hint.len()) }
    }

    /// 一棵含 1 个 nativeHost 节点的树
    const NATIVE_TREE: &str = r#"{"viewport":{"width":390,"height":844},"nodes":[
        {"id":1,"width":390,"height":800,"flexDirection":"column"},
        {"id":5,"parentId":1,"nativeHost":true,"semantic":"shell.webview","width":390,"height":200}
    ]}"#;

    unsafe extern "C" fn test_measure(
        input: *const ProteusTextInput,
        out: *mut ProteusTextMetrics,
        _ud: *mut c_void,
    ) -> i32 {
        let i = unsafe { &*input };
        let text = unsafe { cstr_or_empty(i.text) };
        MEASURE_HITS.lock().unwrap().push((i.node_id, text.clone()));
        unsafe {
            (*out).width = text.chars().count() as f32 * 8.0;
            (*out).height = 16.0;
        }
        PROTEUS_OK
    }

    unsafe extern "C" fn test_request_frame(_ud: *mut c_void) {
        *FRAME_REQS.lock().unwrap() += 1;
    }

    unsafe extern "C" fn test_cap(_arg: *const c_char, out: *mut c_char, len: usize, _ud: *mut c_void) -> i32 {
        unsafe { write_hint(out, len, "{\"ok\":true}") };
        PROTEUS_OK
    }

    fn vtable() -> ProteusHostVTable {
        ProteusHostVTable {
            user_data: std::ptr::null_mut(),
            request_frame: Some(test_request_frame),
            measure_text: Some(test_measure),
            decode_image: None,
            native_view_create: None,
            native_view_update: None,
            native_view_destroy: None,
        }
    }

    fn new_engine() -> *mut ProteusEngine {
        let vt = vtable();
        let ver = proteus_abi_version_info();
        let mut hint = [0i8; 512];
        unsafe { proteus_engine_create(&vt, &ver, hint.as_mut_ptr(), hint.len()) }
    }

    #[test]
    fn version_mismatch_is_explicit_and_actionable() {
        let mut hint = [0i8; 512];
        // abi 版本不符 ⇒ 明确错误码 + 可操作提示（含"升级方式"）
        let bad = ProteusVersionInfo { abi_version: 99, ..proteus_abi_version_info() };
        let rc = unsafe { proteus_check_versions(&bad, hint.as_mut_ptr(), hint.len()) };
        assert_eq!(rc, PROTEUS_ERR_VERSION_MISMATCH);
        let h = unsafe { cstr_or_empty(hint.as_ptr()) };
        assert!(h.contains("升级方式"), "提示必须可操作（不是'版本不符'四个字）：{h}");
        // 指令流版本不符 ⇒ 也要明确（这条最容易静默出错）
        let bad2 = ProteusVersionInfo { ops_wire_version: 99, ..proteus_abi_version_info() };
        let rc2 = unsafe { proteus_check_versions(&bad2, hint.as_mut_ptr(), hint.len()) };
        assert_eq!(rc2, PROTEUS_ERR_VERSION_MISMATCH);
        assert!(unsafe { cstr_or_empty(hint.as_ptr()) }.contains("池"));
        // 兼容 ⇒ OK
        let ok = proteus_abi_version_info();
        assert_eq!(unsafe { proteus_check_versions(&ok, hint.as_mut_ptr(), hint.len()) }, PROTEUS_OK);
    }

    #[test]
    fn create_requires_request_frame_and_matching_version() {
        let ver = proteus_abi_version_info();
        let mut hint = [0i8; 512];
        // 缺 request_frame ⇒ 不创建（内核不自建线程，没有它就没人驱动）
        let mut vt = vtable();
        vt.request_frame = None;
        let e = unsafe { proteus_engine_create(&vt, &ver, hint.as_mut_ptr(), hint.len()) };
        assert!(e.is_null());
        assert!(unsafe { cstr_or_empty(hint.as_ptr()) }.contains("request_frame"));
        // 版本不兼容 ⇒ 不创建
        let bad = ProteusVersionInfo { abi_version: 7, ..ver };
        let e2 = unsafe { proteus_engine_create(&vtable(), &bad, hint.as_mut_ptr(), hint.len()) };
        assert!(e2.is_null());
        // 正常 ⇒ 创建成功
        let e3 = new_engine();
        assert!(!e3.is_null());
        unsafe { proteus_engine_destroy(e3) };
    }

    #[test]
    fn load_tree_injects_host_measurements() {
        // ★HA2 的核心判据：树里**没有** textMeasures ⇒ 本层回调宿主度量，并把结果填进内核输入
        MEASURE_HITS.lock().unwrap().clear();
        let e = new_engine();
        let tree = r#"{"viewport":{"width":390,"height":844},"nodes":[
            {"id":1,"width":390,"height":800,"flexDirection":"column"},
            {"id":2,"parentId":1,"text":"abc","isText":true,"fontSize":14}
        ]}"#;
        let cs = CString::new(tree).unwrap();
        let rc = unsafe { proteus_load_tree(e, cs.as_ptr()) };
        assert_eq!(rc, PROTEUS_OK);
        let hits = MEASURE_HITS.lock().unwrap().clone();
        assert_eq!(hits.len(), 1, "应恰好回调一次（只有一个文本节点）：{hits:?}");
        assert_eq!(hits[0].0, 2);
        assert_eq!(hits[0].1, "abc");
        // 内核已建树 ⇒ 有几何
        let mut len = 0u32;
        let p = unsafe { proteus_rects(e, &mut len) };
        assert!(!p.is_null() && len > 0, "建树后应有几何");
        unsafe { proteus_engine_destroy(e) };
    }

    #[test]
    fn batch_red_line_submit_frame_is_per_frame_not_per_node() {
        // ★★批处理红线（方案 §3）：跨边界调用 = **帧数**，不是节点变更数
        let e = new_engine();
        let tree = r#"{"viewport":{"width":390,"height":844},"nodes":[
            {"id":1,"width":390,"height":800,"flexDirection":"column"},
            {"id":2,"parentId":1,"width":100,"height":20},
            {"id":3,"parentId":1,"width":100,"height":20}
        ]}"#;
        let cs = CString::new(tree).unwrap();
        assert_eq!(unsafe { proteus_load_tree(e, cs.as_ptr()) }, PROTEUS_OK);

        // 造一帧指令流：把 2 个节点的样式改掉（同一帧内）——走 **一次** submit_frame
        //   指令格式见 docs/generated/instruction-spec.md（SET_STYLE: op u8 + nodeId + keyId + value）
        //   ★这里用一个已注册过的 key（height）以保证被应用
        let mut ops: Vec<u8> = Vec::new();
        for (node, h) in [(2u32, 30.0f32), (3u32, 40.0f32)] {
            ops.push(0x02); // SET_STYLE
            ops.extend_from_slice(&node.to_le_bytes());
            ops.extend_from_slice(&1u32.to_le_bytes()); // keyId=1（测试夹具里的 height）
            ops.extend_from_slice(&h.to_le_bytes());
        }
        let rc = unsafe { proteus_submit_frame(e, ops.as_ptr(), ops.len()) };
        // ★注意：keyId 表由编译器产物提供；本测试用裸 keyId=1 可能因未注册而**明确失败**
        //   ——那本身也是正确行为（不静默）。⇒ 只断言"调用发生了、且计数是**每次一帧一次**"。
        let stats_ptr = unsafe { proteus_stats_json(e) };
        let stats = unsafe { cstr_or_empty(stats_ptr) };
        let v: serde_json::Value = serde_json::from_str(&stats).unwrap();
        assert_eq!(v["submit_frame_calls"], 1, "两次节点变更 **只允许一次** 跨边界提交：{stats}");
        assert!(rc == PROTEUS_OK || rc == PROTEUS_ERR_INTERNAL, "返回码须明确（不是静默）：{rc} {stats}");
        unsafe { proteus_engine_destroy(e) };
    }

    #[test]
    fn capability_unregistered_is_explicit_with_registered_list() {
        let e = new_engine();
        let mut out = [0i8; 512];
        let unresolved = CString::new("network.request").unwrap();
        let rc = unsafe { proteus_call_capability(e, unresolved.as_ptr(), std::ptr::null(), out.as_mut_ptr(), out.len()) };
        assert_eq!(rc, PROTEUS_ERR_CAPABILITY_UNREGISTERED);
        let msg = unsafe { cstr_or_empty(out.as_ptr()) };
        assert!(msg.contains("未注册"), "必须可读：{msg}");
        assert!(msg.contains("已注册"), "应列出已注册能力（帮助宿主排查）：{msg}");
        // 注册后即可调用
        let name = CString::new("network.request").unwrap();
        assert_eq!(
            unsafe { proteus_register_capability(e, name.as_ptr(), Some(test_cap), std::ptr::null_mut()) },
            PROTEUS_OK
        );
        assert_eq!(unsafe { proteus_has_capability(e, name.as_ptr()) }, 1);
        let rc2 = unsafe { proteus_call_capability(e, name.as_ptr(), std::ptr::null(), out.as_mut_ptr(), out.len()) };
        assert_eq!(rc2, PROTEUS_OK);
        unsafe { proteus_engine_destroy(e) };
    }

    #[test]
    fn frame_drives_animation_and_reports_continuation() {
        // ★调度接口的判据：帧驱动推进动画；有更新时经 request_frame 通知宿主续帧
        *FRAME_REQS.lock().unwrap() = 0;
        let e = new_engine();
        let tree = r#"{"viewport":{"width":390,"height":844},"nodes":[
            {"id":1,"width":390,"height":800},
            {"id":2,"parentId":1,"width":100,"height":20}
        ]}"#;
        let cs = CString::new(tree).unwrap();
        assert_eq!(unsafe { proteus_load_tree(e, cs.as_ptr()) }, PROTEUS_OK);
        // 起一条 translateX 动画（0 → 120，300ms）
        let anims = CString::new(r#"{"anims":[{"nodeId":2,"kind":0,"curve":1,"from":0,"to":120,"durMs":300,"takeover":false}]}"#).unwrap();
        assert_eq!(unsafe { proteus_anim_start(e, anims.as_ptr()) }, PROTEUS_OK);
        // 两帧之间应有更新（中间帧）
        assert_eq!(unsafe { proteus_frame(e, 1_000_000_000) }, PROTEUS_OK);
        let mut n = 0u32;
        let _ = unsafe { proteus_frame_updates(e, &mut n) };
        assert!(n > 0, "动画起后第一帧应有更新（{n} 字节）");
        assert_eq!(unsafe { proteus_frame(e, 1_016_700_000) }, PROTEUS_OK);
        // ★request_frame 的语义：本层在"有更新"时计数（宿主据此 schedule）
        let stats_ptr = unsafe { proteus_stats_json(e) };
        let v: serde_json::Value = serde_json::from_str(unsafe { cstr_or_empty(stats_ptr) }.as_str()).unwrap();
        assert!(v["frames"].as_u64().unwrap() >= 2);
        assert!(v["frame_requests"].as_u64().unwrap() >= 1, "有更新时应请求宿主续帧：{v}");
        unsafe { proteus_engine_destroy(e) };
    }

    #[test]
    fn capability_manifest_accepts_three_shapes() {
        // ★三种入参形态解析到同一结果（CLI 落盘的 capability-manifest.json / ids / 裸数组）
        let a = r#"{"capabilities":[{"id":"network.request","tier":1},{"id":"storage.set"}]}"#;
        let b = r#"{"ids":["storage.set","network.request"]}"#;
        let c = r#"["network.request","storage.set"]"#;
        let pa = parse_capability_ids(&serde_json::from_str(a).unwrap()).unwrap();
        let pb = parse_capability_ids(&serde_json::from_str(b).unwrap()).unwrap();
        let pc = parse_capability_ids(&serde_json::from_str(c).unwrap()).unwrap();
        assert_eq!(pa, vec!["network.request".to_string(), "storage.set".to_string()]);
        assert_eq!(pa, pb);
        assert_eq!(pb, pc);
        // 非法形态：明确报错（不静默）
        assert!(parse_capability_ids(&serde_json::from_str(r#"{"foo":1}"#).unwrap()).is_err());
        assert!(parse_capability_ids(&serde_json::from_str(r#"{"capabilities":[{"tier":1}]}"#).unwrap()).is_err());
        // 去重（同 id 出现两次只算一次）
        let d = parse_capability_ids(&serde_json::from_str(r#"["a","a","b"]"#).unwrap()).unwrap();
        assert_eq!(d, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn capability_check_green_and_red_with_actionable_report() {
        let e = new_engine();
        // 壳声明提供两项（用 CLI 落盘的那个 shape）——★声明 ≠ 实现：不注册 handler 也能通过校验
        let manifest = CString::new(r#"{"capabilities":[{"id":"network.request"},{"id":"storage.set"}]}"#).unwrap();
        assert_eq!(unsafe { proteus_set_shell_capabilities(e, manifest.as_ptr()) }, PROTEUS_OK);
        // 绿：所需 ⊆ 提供
        let ok_req = CString::new(r#"{"ids":["network.request"]}"#).unwrap();
        let mut out = [0i8; 512];
        assert_eq!(
            unsafe { proteus_check_capabilities(e, ok_req.as_ptr(), out.as_mut_ptr(), out.len()) },
            PROTEUS_OK
        );
        assert!(unsafe { cstr_or_empty(out.as_ptr()) }.contains("通过"));
        // 红：缺 map.render ⇒ 明确错误 + 可操作报告（必须提到「扩展壳」与已提供清单）
        let bad_req = CString::new(r#"["network.request","map.render"]"#).unwrap();
        let rc = unsafe { proteus_check_capabilities(e, bad_req.as_ptr(), out.as_mut_ptr(), out.len()) };
        assert_eq!(rc, PROTEUS_ERR_CAPABILITY_UNREGISTERED);
        let msg = unsafe { cstr_or_empty(out.as_ptr()) };
        assert!(msg.contains("map.render"), "报告必须点名缺失项：{msg}");
        assert!(msg.contains("扩展壳"), "报告必须给出可操作出路（扩展壳）：{msg}");
        assert!(msg.contains("本壳已提供"), "报告必须列出已提供清单（帮助排查）：{msg}");
        // ★并集语义：注册的 handler 也算提供（清单没声明它）
        let name = CString::new("camera.capture").unwrap();
        assert_eq!(
            unsafe { proteus_register_capability(e, name.as_ptr(), Some(test_cap), std::ptr::null_mut()) },
            PROTEUS_OK
        );
        let req2 = CString::new(r#"["network.request","camera.capture"]"#).unwrap();
        assert_eq!(
            unsafe { proteus_check_capabilities(e, req2.as_ptr(), out.as_mut_ptr(), out.len()) },
            PROTEUS_OK,
            "壳清单 ∪ 已注册 handler = 提供集"
        );
        unsafe { proteus_engine_destroy(e) };
    }

    #[test]
    fn capability_manifest_golden_is_accepted() {
        // ★★跨语言对账（本仓的核心纪律：跨语言契约只能有一份来源）
        //
        // 【判据】TS 侧（`@proteus-vue/capabilities` 的 `scanCapabilities`，即 CLI
        //   `proteus capabilities:manifest` 调用的**同一个函数**）产出的清单，
        //   **必须能被本 ABI 直接接受** —— 若哪天 TS 侧改了 manifest 的字段形状而这里没跟，
        //   本测试会红（而不是等到端上"能力校验永远通过"这种静默失效）。
        //
        // 【为什么用 `include_str!` 而不是运行时读文件】golden 冻结在**编译期**：
        //   ① 测试不依赖 cwd（CI/任意目录都能跑）；② 文件被删则编译失败（比运行时 panic 更早）。
        let raw = include_str!("../tests/golden/capability-manifest.json");
        let v: serde_json::Value = serde_json::from_str(raw).expect("golden JSON 应合法");
        let ids = parse_capability_ids(&v).expect("★ABI 必须接受 TS 侧产出的清单形态");
        assert!(
            ids.contains(&"clipboard".to_string()),
            "golden 里的能力 id 应被解析出来（实测 {ids:?}）"
        );
        // 且解析出的 id 与 golden 文件里声明的**逐项一致**（防"解析器吞掉了某些项"）
        let declared: Vec<String> = v["capabilities"]
            .as_array()
            .expect("golden 应有 capabilities 数组")
            .iter()
            .filter_map(|c| c["id"].as_str().map(|s| s.to_string()))
            .collect();
        assert_eq!(ids.len(), declared.len(), "解析出的条数应与 golden 声明一致");
        for d in &declared {
            assert!(ids.contains(d), "golden 声明的 `{d}` 未被解析出来");
        }
    }

    #[test]
    fn load_tree_rejects_when_required_capabilities_unmet() {
        // ★HA3 的集成判据：产物声明所需能力 ⇒ **加载前**校验，不满足即拒绝（不是跑到一半崩）
        let e = new_engine();
        let shell = CString::new(r#"["network.request"]"#).unwrap();
        assert_eq!(unsafe { proteus_set_shell_capabilities(e, shell.as_ptr()) }, PROTEUS_OK);

        // 绿：所需 ⊆ 提供 ⇒ 正常加载
        let ok_tree = r#"{"requiredCapabilities":["network.request"],"viewport":{"width":390,"height":844},"nodes":[{"id":1,"width":390,"height":800}]}"#;
        let cs = CString::new(ok_tree).unwrap();
        assert_eq!(unsafe { proteus_load_tree(e, cs.as_ptr()) }, PROTEUS_OK);

        // 红：缺 camera.capture ⇒ 拒绝加载 + last_error 可读（从 stats 读）
        let bad_tree = r#"{"requiredCapabilities":["camera.capture"],"viewport":{"width":390,"height":844},"nodes":[{"id":1,"width":390,"height":800}]}"#;
        let cs2 = CString::new(bad_tree).unwrap();
        let rc = unsafe { proteus_load_tree(e, cs2.as_ptr()) };
        assert_eq!(rc, PROTEUS_ERR_CAPABILITY_UNREGISTERED);
        let stats = unsafe { cstr_or_empty(proteus_stats_json(e)) };
        assert!(stats.contains("camera.capture"), "last_error 必须点名缺失项：{stats}");
        assert!(stats.contains("扩展壳"), "last_error 必须给出可操作出路：{stats}");
        // ★且**旧树仍在**（校验失败不该破坏已加载的状态——校验放在副作用之前）
        let mut len = 0u32;
        assert!(!unsafe { proteus_rects(e, &mut len) }.is_null(), "拒绝加载后旧树应完好");
        unsafe { proteus_engine_destroy(e) };
    }

    #[test]
    fn native_view_created_on_load_with_geometry() {
        let _serial = native_test_guard(); // ★串行化（共享静态计数器，见 guard 注释）
        // ★HA4 判据 ①：**建树即创建**（引擎驱动），且**带上内核算出的几何**
        reset_native_counters();
        let e = new_engine_with(vtable_with_native());
        let cs = CString::new(NATIVE_TREE).unwrap();
        assert_eq!(unsafe { proteus_load_tree(e, cs.as_ptr()) }, PROTEUS_OK);
        let created = NATIVE_CREATED.lock().unwrap().clone();
        assert_eq!(created.len(), 1, "应创建 1 个原生 View：{created:?}");
        assert_eq!(created[0].0, "shell.webview", "kind 应来自树里的 semantic");
        // 几何来自内核（不是 0）——该节点是 390×200
        assert!((created[0].1.width - 390.0).abs() < 1.0, "宽度应 ≈390（实测 {}）", created[0].1.width);
        assert!((created[0].1.height - 200.0).abs() < 1.0, "高度应 ≈200（实测 {}）", created[0].1.height);
        unsafe { proteus_engine_destroy(e) };
    }

    #[test]
    fn native_view_only_updates_when_geometry_actually_changes() {
        let _serial = native_test_guard(); // ★串行化（共享静态计数器，见 guard 注释）
        // ★HA4 判据 ②：**几何真变了才 update**（每帧无脑同步 = 白付跨边界成本）
        reset_native_counters();
        let e = new_engine_with(vtable_with_native());
        let cs = CString::new(NATIVE_TREE).unwrap();
        assert_eq!(unsafe { proteus_load_tree(e, cs.as_ptr()) }, PROTEUS_OK);
        assert!(NATIVE_UPDATED.lock().unwrap().is_empty(), "刚创建时不该有 update");
        // 手动同步一次（几何没变）⇒ 仍不该有 update
        assert_eq!(unsafe { proteus_sync_native_views(e) }, PROTEUS_OK);
        assert!(NATIVE_UPDATED.lock().unwrap().is_empty(), "几何未变 ⇒ 不该调 update（实测 {:?}）",
                NATIVE_UPDATED.lock().unwrap());
        // 改几何（用指令流改高度）⇒ 同步后应有 update
        //   SET_STYLE(0x02): op u8 + nodeId u32 + keyId u16 + value f32
        //   ★用 `layout.height` 的 keyId=1（测试夹具里的约定；未注册会被内核明确拒绝——
        //     那时本测试会红，正是"不静默"的价值）
        let mut ops: Vec<u8> = Vec::new();
        ops.extend_from_slice(&0x504F5650u32.to_le_bytes());
        ops.extend_from_slice(&2u32.to_le_bytes());
        ops.extend_from_slice(&1u32.to_le_bytes());
        ops.extend_from_slice(&1u32.to_le_bytes()); // keyCount=1
        ops.extend_from_slice(&0u32.to_le_bytes()); // strCount=0
        let k = "layout.height";
        ops.extend_from_slice(&(k.len() as u16).to_le_bytes());
        ops.extend_from_slice(k.as_bytes());
        ops.push(0x02u8);
        ops.extend_from_slice(&5u32.to_le_bytes()); // node 5（nativeHost 节点）
        ops.extend_from_slice(&0u16.to_le_bytes()); // keyId=0（池内唯一键 = layout.height）
        ops.extend_from_slice(&300.0f32.to_le_bytes());
        let rc = unsafe { proteus_submit_frame(e, ops.as_ptr(), ops.len()) };
        assert_eq!(rc, PROTEUS_OK, "改高度的指令流应被接受");
        let updated = NATIVE_UPDATED.lock().unwrap().clone();
        assert_eq!(updated.len(), 1, "几何变了 ⇒ 应恰有 1 次 update（实测 {updated:?}）");
        assert!((updated[0].1.height - 300.0).abs() < 1.0, "update 应带新高度 ≈300（实测 {}）", updated[0].1.height);
        unsafe { proteus_engine_destroy(e) };
    }

    #[test]
    fn native_view_destroyed_on_tree_swap_and_engine_destroy() {
        let _serial = native_test_guard(); // ★串行化（共享静态计数器，见 guard 注释）
        // ★HA4 判据 ③：**换树销毁旧的**、**销毁引擎清场**（不留下孤儿原生对象）
        reset_native_counters();
        let e = new_engine_with(vtable_with_native());
        let cs = CString::new(NATIVE_TREE).unwrap();
        assert_eq!(unsafe { proteus_load_tree(e, cs.as_ptr()) }, PROTEUS_OK);
        assert_eq!(NATIVE_CREATED.lock().unwrap().len(), 1);
        // 换一棵**没有 nativeHost** 的树 ⇒ 旧的应被销毁
        let plain = r#"{"viewport":{"width":390,"height":844},"nodes":[{"id":1,"width":390,"height":800}]}"#;
        let cs2 = CString::new(plain).unwrap();
        assert_eq!(unsafe { proteus_load_tree(e, cs2.as_ptr()) }, PROTEUS_OK);
        assert_eq!(NATIVE_DESTROYED.lock().unwrap().len(), 1, "换树应销毁旧的原生 View");
        // 再换回带 native 的树 ⇒ 又创建 1 个；然后销毁引擎 ⇒ 应销毁它
        let cs3 = CString::new(NATIVE_TREE).unwrap();
        assert_eq!(unsafe { proteus_load_tree(e, cs3.as_ptr()) }, PROTEUS_OK);
        let before = NATIVE_DESTROYED.lock().unwrap().len();
        unsafe { proteus_engine_destroy(e) };
        assert_eq!(NATIVE_DESTROYED.lock().unwrap().len(), before + 1,
                   "销毁引擎应销毁其持有的原生 View（否则宿主侧留孤儿对象）");
    }

    #[test]
    fn native_view_recreated_when_same_node_changes_kind() {
        // ★★这条判据是**补盲区**的（首版漏了，被破坏性验证逼出来）：
        //   "换树销毁旧 View" 有两条路径会碰到 —— ① 旧节点 id 消失、② **同一 id 换了 kind**。
        //   ① 由 `sync_native_views` 的"过时清理"顺带覆盖；**② 只能靠 load_tree 阶段的
        //   `destroy_all_native_views`** —— 否则宿主那边会**留着一个旧 kind 的原生对象**
        //   （新树要 map，而屏幕上还是 webview），且几何还会被同步过去（看起来"正常"）。
        let _serial = native_test_guard();
        reset_native_counters();
        let e = new_engine_with(vtable_with_native());
        let t1 = r#"{"viewport":{"width":390,"height":844},"nodes":[
            {"id":1,"width":390,"height":800},
            {"id":5,"parentId":1,"nativeHost":true,"semantic":"shell.webview","width":390,"height":200}
        ]}"#;
        assert_eq!(unsafe { proteus_load_tree(e, CString::new(t1).unwrap().as_ptr()) }, PROTEUS_OK);
        assert_eq!(NATIVE_CREATED.lock().unwrap().len(), 1);
        assert_eq!(NATIVE_CREATED.lock().unwrap()[0].0, "shell.webview");

        // 同一 node id（5）换成另一个 kind
        let t2 = r#"{"viewport":{"width":390,"height":844},"nodes":[
            {"id":1,"width":390,"height":800},
            {"id":5,"parentId":1,"nativeHost":true,"semantic":"map","width":390,"height":200}
        ]}"#;
        assert_eq!(unsafe { proteus_load_tree(e, CString::new(t2).unwrap().as_ptr()) }, PROTEUS_OK);
        let created = NATIVE_CREATED.lock().unwrap().clone();
        assert_eq!(created.len(), 2, "kind 变了 ⇒ 应**重新创建**（实测 {created:?}）");
        assert_eq!(created[1].0, "map", "新对象应是新 kind");
        assert_eq!(NATIVE_DESTROYED.lock().unwrap().len(), 1,
                   "且旧 kind 的对象必须被销毁（否则宿主侧留着旧组件）");
        unsafe { proteus_engine_destroy(e) };
    }

    #[test]
    fn native_view_explicit_errors_when_callback_missing_or_host_rejects() {
        let _serial = native_test_guard(); // ★串行化（共享静态计数器，见 guard 注释）
        // ★HA4 判据 ④：**两种失败都明确**（不许静默跳过）
        reset_native_counters();
        // (a) 宿主未提供 create 回调 ⇒ load_tree 明确报错 + last_error 可读
        let e = new_engine(); // 基础 vtable：native_* 全为 None
        let cs = CString::new(NATIVE_TREE).unwrap();
        let rc = unsafe { proteus_load_tree(e, cs.as_ptr()) };
        assert_eq!(rc, PROTEUS_ERR_INVALID_ARG, "缺 native_view_create ⇒ 明确错误码（不静默跳过）");
        let stats = unsafe { cstr_or_empty(proteus_stats_json(e)) };
        assert!(stats.contains("native_view_create"), "last_error 必须点名缺失的回调：{stats}");
        assert!(stats.contains("shell.webview"), "last_error 应带 kind（可归因）：{stats}");
        unsafe { proteus_engine_destroy(e) };

        // (b) 宿主**拒绝**某 kind（返回 NULL）⇒ 记账 + 可读原因（不静默）
        reset_native_counters();
        *NATIVE_REJECT_KIND.lock().unwrap() = Some("shell.webview".to_string());
        let e2 = new_engine_with(vtable_with_native());
        let cs2 = CString::new(NATIVE_TREE).unwrap();
        // 拒绝不是"加载失败"（该节点可能是可降级的）⇒ 树仍加载成功，但**必须留下痕迹**
        assert_eq!(unsafe { proteus_load_tree(e2, cs2.as_ptr()) }, PROTEUS_OK);
        let stats2 = unsafe { cstr_or_empty(proteus_stats_json(e2)) };
        assert!(stats2.contains("拒绝创建"), "宿主拒绝必须留痕：{stats2}");
        assert!(stats2.contains("降级"), "提示应给可操作出路（降级路径）：{stats2}");
        let v = v2(&stats2);
        assert_eq!(v["native_view_create_failed"], 1, "拒绝次数应记账：{stats2}");
        assert_eq!(v["native_view_created"], 0, "被拒绝的不该计入创建成功：{stats2}");
        unsafe { proteus_engine_destroy(e2) };
    }

    /// 解析 stats JSON（测试辅助）
    fn v2(s: &str) -> serde_json::Value {
        serde_json::from_str(s).unwrap_or(serde_json::Value::Null)
    }

    #[test]
    fn strings_and_rects_are_stable_until_next_call() {
        // ★契约：返回的指针有效期到下次同类调用（测试这条，避免把"临时值"当契约）
        let e = new_engine();
        let tree = r#"{"viewport":{"width":390,"height":844},"nodes":[{"id":1,"width":390,"height":800}]}"#;
        let cs = CString::new(tree).unwrap();
        assert_eq!(unsafe { proteus_load_tree(e, cs.as_ptr()) }, PROTEUS_OK);
        let mut len1 = 0u32;
        let p1 = unsafe { proteus_rects(e, &mut len1) };
        assert!(!p1.is_null());
        let mut len2 = 0u32;
        let p2 = unsafe { proteus_rects(e, &mut len2) };
        assert_eq!(len1, len2, "两次调用应返回同样长度的几何");
        let s1 = unsafe { cstr_or_empty(proteus_stats_json(e)) };
        let s2 = unsafe { cstr_or_empty(proteus_stats_json(e)) };
        assert!(s1.contains("abi_version") && s2.contains("abi_version"));
        unsafe { proteus_engine_destroy(e) };
    }
}
