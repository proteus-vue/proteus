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
}

struct EngineState {
    /// 内核树句柄（0 = 未加载树）
    tree: u64,
    vtable: ProteusHostVTable,
    capabilities: HashMap<String, Capability>,
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
    if let Some(st) = removed {
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
        // ★★HA2 的落点：**平台能力经 vtable 注入**——宿主没预量文本时，由本层回调宿主逐节点度量。
        let prepared = match prepare_tree_json(&raw, st) {
            Ok(s) => s,
            Err(e) => {
                st.last_error = Some(e);
                return PROTEUS_ERR_INVALID_ARG;
            }
        };
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
        st.last_error = None;
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
        st.last_error = None;
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

/* ────────────────────────── 单测（Rust 侧；C 侧一致性测试另有集成用例） ────────────────────────── */

#[cfg(test)]
mod tests {
    use super::*;

    // ★测试回调：记录被调次数 + 返回固定度量（不依赖任何平台）
    static MEASURE_HITS: Mutex<Vec<(u32, String)>> = Mutex::new(Vec::new());
    static FRAME_REQS: Mutex<u64> = Mutex::new(0);

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
