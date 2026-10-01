// platform/android/proteus-jni/src/lib.rs
// ★★**Android 平台绑定层：JNI 导出**（原 `packages/layout-core-rust/src/jni.rs`，HA2 迁出）
//
// 【为什么单独成 crate（HA2 的硬性判据）】Host ABI 方案 §2.6 要求「**内核中不得出现平台分支**」
//   ——判据是"内核 crate 不得有 `target_os` 条件编译"。而 JNI 绑定天然是 Android 专属
//   （`jni` crate + `System.loadLibrary`）⇒ 它留在内核里就必然要 `#[cfg(target_os = "android")]`
//   包一层 ⇒ **内核被迫认识平台**。搬出来之后：内核零平台分支，本 crate 是这个分支的**唯一住所**
//   （`#![cfg]` 在这里是**正确**的：它本来就是平台代码）。
//
// 【边界归属（Host ABI §0.4.8 的判断标准）】"这段代码换到同平台的另一个 App 里，需要改吗？"
//   · 本 crate —— **不用改**（换壳时它随 SDK 一起发布）⇒ **平台适配**，归 `platform/`
//   · 宿主集成（Surface / 生命周期 / 输入 / 调度 / 能力注册）—— 要改 ⇒ 归 `hosts/`
//
// 【与 iOS 的对称性】两端共用同一份内核（`engine`/`node`/`taffy_engine`），只是**边界形态**不同：
//   · iOS：内核的 **C ABI**（`ffi.rs`，Swift 用 `@_silgen_name` 直接调；静态库）
//   · Android：**本 crate**（Java 用 `external fun` 调；把同一批 C ABI 函数转成 JNI 符号）——动态库
//   两边都只做「JSON 进 / JSON 出」，复杂度留在内核。
//
// 【JNI 函数名规则】`Java_<包名下划线化>_<类名>_<方法名>`
//   本文件对应 Java 侧：
//     package dev.proteus.layoutcore · class RustLayout · private static native … 等
//   → `Java_dev_proteus_layoutcore_RustLayout_nativeVersion`
//
// 【产物】`libproteus_jni.so`（`System.loadLibrary("proteus_jni")`）——
//   静态链接内核（rlib），所以**一个 .so 里既有内核代码也有 JNI 符号**。
#![cfg(target_os = "android")]

use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;

// ★内核（path 依赖）：平台无关的核心
use proteus_layout_core::ffi::{json_str, run_bench, run_conformance};

// ★HA5：Host ABI 的 JNI 绑定（客户 App 嵌入用；见该文件头的"回调穿梭"说明）
mod host;
use proteus_layout_core::{ffi, recycle, LayoutEngine, TaffyEngine};

/// 把 Rust 字符串交给 JNI 侧（分配 Java String）。
///
/// 【为什么在本 crate 而不是内核（HA2）】这个函数存在的唯一理由是"Java 侧要一个 jstring"——
///   那是**平台绑定**的事；内核不该知道 `JNIEnv` 是什么（原实现放在内核 `ffi.rs` 并用
///   `#[cfg(target_os = "android")]` 包着，正是"内核被平台污染"的实例）。
fn into_java_string(env: &mut JNIEnv, s: String) -> jstring {
    match env.new_string(s) {
        Ok(js) => js.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// `RustLayout.nativeVersion(): String`
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeVersion<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
) -> jstring {
    let text = format!(
        "proteus-layout-core {} · engine={} · taffy 锁定 0.14（0.13 有 measure 指数退化）",
        env!("CARGO_PKG_VERSION"),
        TaffyEngine::new().name()
    );
    into_java_string(&mut env, text)
}

/// `RustLayout.nativeConformance(goldenJson: String): String`
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeConformance<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    golden: JString<'local>,
) -> jstring {
    // ★panic 防护：跨 FFI panic 是 UB（与 iOS 侧同款纪律）
    let out = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> String {
        let raw: String = match env.get_string(&golden) {
            Ok(s) => s.into(),
            Err(e) => return format!("{{\"ok\":false,\"error\":\"golden 参数读取失败：{e}\"}}"),
        };
        match run_conformance(&raw) {
            Ok(s) => s,
            Err(e) => format!("{{\"ok\":false,\"error\":{}}}", json_str(&e)),
        }
    }))
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string());
    into_java_string(&mut env, out)
}

/// `RustLayout.nativeBench(nodeCount: Int, iterations: Int): String`
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeBench<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    node_count: jni::sys::jint,
    iterations: jni::sys::jint,
) -> jstring {
    let out = std::panic::catch_unwind(|| -> String {
        let n = if node_count <= 0 { 4050u32 } else { node_count as u32 };
        let it = if iterations <= 0 { 1u32 } else { iterations as u32 };
        match run_bench(n, it) {
            Ok(s) => s,
            Err(e) => format!("{{\"ok\":false,\"error\":{}}}", json_str(&e)),
        }
    })
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string());
    into_java_string(&mut env, out)
}

/// `RustLayout.nativeRecycleBench(rows: Int, frames: Int): String`
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeRecycleBench<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    rows: jni::sys::jint,
    frames: jni::sys::jint,
) -> jstring {
    let out = std::panic::catch_unwind(|| -> String {
        let r = if rows <= 0 { 4000usize } else { rows as usize };
        let f = if frames <= 0 { 400usize } else { frames as usize };
        match recycle::run_recycle_bench(r, f) {
            Ok(s) => s,
            Err(e) => format!("{{\"ok\":false,\"error\":{}}}", json_str(&e)),
        }
    })
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string());
    into_java_string(&mut env, out)
}

/// `RustLayout.nativeCreate(requestJson: String): Long` —— 建树并**保留**（返回句柄）
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeCreate<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    request: JString<'local>,
) -> jni::sys::jlong {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> i64 {
        let raw: String = match env.get_string(&request) {
            Ok(s) => s.into(),
            Err(_) => return 0,
        };
        let c = match std::ffi::CString::new(raw) {
            Ok(c) => c,
            Err(_) => return 0,
        };
        unsafe { ffi::proteus_layout_create(c.as_ptr()) as i64 }
    }))
    .unwrap_or(0)
}

/// `RustLayout.nativeDestroy(handle: Long): Boolean`
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeDestroy<'local>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
) -> jni::sys::jboolean {
    let ok = std::panic::catch_unwind(|| ffi::proteus_layout_destroy(handle as u64)).unwrap_or(false);
    if ok { 1 } else { 0 }
}

/// `RustLayout.nativeHandleCount(): Int`
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeHandleCount<'local>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
) -> jni::sys::jint {
    std::panic::catch_unwind(|| ffi::proteus_layout_handle_count()).unwrap_or(0) as i32
}

/// `RustLayout.nativeReadRects(handle: Long): String`
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeReadRects<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
) -> jstring {
    let out = std::panic::catch_unwind(|| -> String {
        let p = unsafe { ffi::proteus_layout_rects(handle as u64) };
        if p.is_null() {
            return "{\"ok\":false,\"error\":\"null\"}".to_string();
        }
        let s = unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned();
        unsafe { ffi::proteus_layout_free_string(p) };
        s
    })
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string());
    into_java_string(&mut env, out)
}

/// `RustLayout.nativeHitTest(handle: Long, x: Float, y: Float): String`
///
/// ★★为什么不经过 Java 侧的几何镜像（本仓 M3 事件系统的关键决策）：
///   宿主 View 拿到触摸点后**直接把坐标交给核心**，由核心用自己算出的几何判定命中。
///   Java 侧不保留第二份矩形表 —— 那份镜像必然与核心漂移（滚动偏移、裁剪、后续增量布局），
///   且要在 Java 里重写「逆绘制序 + 裁剪感知」的语义，正是「引擎语义泄漏到三端」的反例。
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeHitTest<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
    x: jni::sys::jfloat,
    y: jni::sys::jfloat,
) -> jstring {
    let out = std::panic::catch_unwind(|| -> String {
        let p = unsafe { ffi::proteus_layout_hit_test(handle as u64, x, y) };
        if p.is_null() {
            return "{\"ok\":false,\"error\":\"null\"}".to_string();
        }
        let s = unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned();
        unsafe { ffi::proteus_layout_free_string(p) };
        s
    })
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string());
    into_java_string(&mut env, out)
}

/// `RustLayout.nativeUpdate(handle: Long, patchesJson: String): String`
///
/// ★增量重排（生产路径）。此前宿主只能 destroy+create（整树重建）——
///   实测改 10 个列表项要重发 561KB、重建 1407 个节点。本入口走核心的 `layout_incremental`（边界内 30–566×）。
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeUpdate<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
    patches: JString<'local>,
) -> jstring {
    // ★JNIEnv 不是 UnwindSafe ⇒ 必须**先在闭包外**把 Java 字符串取成 Rust String，
    //   闭包内只处理纯 Rust 数据（否则 E0277：may not be safely transferred across an unwind boundary）
    let raw: String = match env.get_string(&patches) {
        Ok(s) => s.into(),
        Err(e) => return into_java_string(&mut env, format!("{{\"ok\":false,\"error\":\"patches 读取失败：{e}\"}}")),
    };
    let out = std::panic::catch_unwind(|| -> String {
        let c = match std::ffi::CString::new(raw) {
            Ok(c) => c,
            Err(_) => return "{\"ok\":false,\"error\":\"patches 含 NUL\"}".to_string(),
        };
        let p = unsafe { ffi::proteus_layout_update(handle as u64, c.as_ptr()) };
        if p.is_null() {
            return "{\"ok\":false,\"error\":\"null\"}".to_string();
        }
        let ret = unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned();
        unsafe { ffi::proteus_layout_free_string(p) };
        ret
    })
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string());
    into_java_string(&mut env, out)
}

/* ══════════ ★★列表复用池（§12.6）：与 iOS 同一套核心决策，Android 只执行动作 ══════════ */
//
// 【为什么必须由核心给决策（本仓实测的设计纠正）】Android 侧此前在 `MainActivity` 里
//   **手写**了一份方向敏感预载逻辑（`backward ? 8 : 2` 的 above/below 三元式）——
//   那是 `recycle.rs` 的**第二份副本**，而 iOS 侧走的是核心决策。
//   两份副本的漂移是**静默的**（只是多建或少建几行对象），且正是本仓反复记下的
//   "各端各写必然分叉"风险。⇒ 本组出口让 Android 与 iOS 共用同一份决策。

/// `RustLayout.nativeRecycleCreate(itemCount: Int, leadingRows: Int, followingRows: Int): Long`
///
/// 传 0 表示用核心默认（leading=8 / following=2）。
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeRecycleCreate<'local>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
    item_count: jni::sys::jint,
    leading_rows: jni::sys::jint,
    following_rows: jni::sys::jint,
) -> jni::sys::jlong {
    std::panic::catch_unwind(|| unsafe {
        ffi::proteus_recycle_create(
            item_count.max(0) as u32,
            leading_rows.max(0) as u32,
            following_rows.max(0) as u32,
        ) as i64
    })
    .unwrap_or(0)
}

/// `RustLayout.nativeRecycleUpdate(handle: Long, firstVisible: Int, lastVisible: Int): String`
///
/// 出参：`{ok, direction, first_visible, last_visible, first_preload, last_preload,
///        acquire:[行号], release:[行号], demoted, live, acquire_events, release_events, updates}`
///
/// ★宿主执行顺序：**先 release 再 acquire**（反了 ⇒ 本帧要建的对象无法复用刚释放的）。
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeRecycleUpdate<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
    first_visible: jni::sys::jint,
    last_visible: jni::sys::jint,
) -> jstring {
    let out = std::panic::catch_unwind(|| -> String {
        let p = unsafe {
            ffi::proteus_recycle_update(
                handle as u64,
                first_visible.max(0) as u32,
                last_visible.max(0) as u32,
            )
        };
        if p.is_null() {
            return "{\"ok\":false,\"error\":\"null\"}".to_string();
        }
        let s = unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned();
        unsafe { ffi::proteus_layout_free_string(p) };
        s
    })
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string());
    into_java_string(&mut env, out)
}

/// `RustLayout.nativeRecycleStats(handle: Long): String`
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeRecycleStats<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
) -> jstring {
    let out = std::panic::catch_unwind(|| -> String {
        let p = unsafe { ffi::proteus_recycle_stats(handle as u64) };
        if p.is_null() {
            return "{\"ok\":false,\"error\":\"null\"}".to_string();
        }
        let s = unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned();
        unsafe { ffi::proteus_layout_free_string(p) };
        s
    })
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string());
    into_java_string(&mut env, out)
}

/// `RustLayout.nativeRecycleDestroy(handle: Long): Boolean`
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeRecycleDestroy<'local>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
) -> jni::sys::jboolean {
    std::panic::catch_unwind(|| unsafe { ffi::proteus_recycle_destroy(handle as u64) })
        .map(|_| 1)
        .unwrap_or(0)
}

/* ══════════ ★结构变更（splice）+ 度量注入 + Vapor 指令流：补齐与 iOS 同等的生产能力 ══════════ */

/// `RustLayout.nativeSetTextMeasures(handle: Long, measuresJson: String): String`
///
/// 【为什么必须有】文本尺寸只能由平台度量，而增量重排会**重新度量**范围内的文本叶子。
///   不注入 ⇒ 核心按零尺寸算 ⇒ **文本塌成 0 高**（首帧对、更新后错——静态用例发现不了）。
///   详情见 `ffi.rs` 的 `TreeEntry::measures` 注释。
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeSetTextMeasures<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
    measures: JString<'local>,
) -> jstring {
    let raw: String = match env.get_string(&measures) {
        Ok(s) => s.into(),
        Err(e) => return into_java_string(&mut env, format!("{{\"ok\":false,\"error\":\"measures 读取失败：{e}\"}}")),
    };
    let out = std::panic::catch_unwind(|| -> String {
        let c = match std::ffi::CString::new(raw) {
            Ok(c) => c,
            Err(_) => return "{\"ok\":false,\"error\":\"measures 含 NUL\"}".to_string(),
        };
        let p = unsafe { ffi::proteus_layout_set_text_measures(handle as u64, c.as_ptr()) };
        if p.is_null() {
            return "{\"ok\":false,\"error\":\"null\"}".to_string();
        }
        let s = unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned();
        unsafe { ffi::proteus_layout_free_string(p) };
        s
    })
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string());
    into_java_string(&mut env, out)
}

/// `RustLayout.nativeSplice(handle: Long, spliceJson: String): String`
///
/// 结构变更（增删行）：`{removes:[id], inserts:[{parentId, nodes:[…], index}], textMeasures:{}}`
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeSplice<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
    splice: JString<'local>,
) -> jstring {
    let raw: String = match env.get_string(&splice) {
        Ok(s) => s.into(),
        Err(e) => return into_java_string(&mut env, format!("{{\"ok\":false,\"error\":\"splice 读取失败：{e}\"}}")),
    };
    let out = std::panic::catch_unwind(|| -> String {
        let c = match std::ffi::CString::new(raw) {
            Ok(c) => c,
            Err(_) => return "{\"ok\":false,\"error\":\"splice 含 NUL\"}".to_string(),
        };
        let p = unsafe { ffi::proteus_layout_splice(handle as u64, c.as_ptr()) };
        if p.is_null() {
            return "{\"ok\":false,\"error\":\"null\"}".to_string();
        }
        let s = unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned();
        unsafe { ffi::proteus_layout_free_string(p) };
        s
    })
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string());
    into_java_string(&mut env, out)
}

/// `RustLayout.nativeApplyOps(handle: Long, opsBytes: ByteArray): String`
///
/// ★★Vapor IR 的二进制指令流入口（与 iOS 的 `applyOps` 同一路径）——
///   JSON 补丁每帧要文本解析（实测占布局耗时 95%+）；二进制是顺序读 + 定长字段。
///   ★JNI 原生支持 `jbyteArray` ⇒ **无需**像 iOS（JSExport 不支持 ArrayBuffer）那样套 JSON 数组。
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeApplyOps<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
    ops: jni::objects::JByteArray<'local>,
) -> jstring {
    // ★先在闭包外把字节取出来（JNIEnv 非 UnwindSafe —— 与 nativeUpdate 同一纪律）
    let bytes: Vec<u8> = match env.convert_byte_array(&ops) {
        Ok(v) => v,
        Err(e) => return into_java_string(&mut env, format!("{{\"ok\":false,\"error\":\"ops 读取失败：{e}\"}}")),
    };
    let out = std::panic::catch_unwind(|| -> String {
        if bytes.is_empty() {
            return "{\"ok\":false,\"error\":\"空指令流\"}".to_string();
        }
        let p = unsafe {
            ffi::proteus_layout_apply_ops(handle as u64, bytes.as_ptr(), bytes.len() as u32)
        };
        if p.is_null() {
            return "{\"ok\":false,\"error\":\"null\"}".to_string();
        }
        let s = unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned();
        unsafe { ffi::proteus_layout_free_string(p) };
        s
    })
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string());
    into_java_string(&mut env, out)
}

/* ────────────────────────── ★★MA0-RT：平台零参与路径（Android） ────────────────────────── */

/// ★★**曲线的贝塞尔近似**（Android `PathInterpolator` 用）——曲线知识只在引擎一处
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeCurveBezier<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    curve: jni::sys::jint,
) -> jstring {
    let out = std::panic::catch_unwind(|| -> String {
        let p = ffi::proteus_anim_curve_bezier(curve as u32);
        if p.is_null() {
            return "{\"ok\":false,\"error\":\"null\"}".to_string();
        }
        let s = unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned();
        unsafe { ffi::proteus_layout_free_string(p) };
        s
    })
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string());
    into_java_string(&mut env, out)
}

/// ★★**提交规格**（平台零参与路径的数据面：合成属性判定 + 节点级采样）
///
/// ★**Android 侧的诚实边界**：本入口返回的是**逐节点**规格（与 iOS 同一份内核数据），
///   而 Android 生产绘制是"单 ViewGroup + Canvas 指令"（**无 per-node 平台对象**）
///   ⇒ 逐节点平台动画需引入 per-node `RenderNode`（改绘制架构，另案评估）；
///   本端当前落地的是**容器级**（`ProteusHostView.animatePageComposited`）。
///   该入口保留：① 判定能力可测；② 未来接 per-node RenderNode 时数据面已就绪。
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeAnimCommitSpec<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
    json: JString<'local>,
) -> jstring {
    // ★先在闭包外取字符串（JNIEnv 非 UnwindSafe —— 与 nativeUpdate 同一纪律）
    let s: String = match env.get_string(&json) {
        Ok(v) => v.into(),
        Err(e) => {
            return into_java_string(&mut env, format!("{{\"ok\":false,\"error\":\"入参读取失败：{e}\"}}"))
        }
    };
    let out = std::panic::catch_unwind(|| -> String {
        let cs = match std::ffi::CString::new(s) {
            Ok(c) => c,
            Err(_) => return "{\"ok\":false,\"error\":\"入参含 NUL\"}".to_string(),
        };
        let p = unsafe { ffi::proteus_layout_anim_commit_spec(handle as u64, cs.as_ptr()) };
        if p.is_null() {
            return "{\"ok\":false,\"error\":\"null\"}".to_string();
        }
        let o = unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned();
        unsafe { ffi::proteus_layout_free_string(p) };
        o
    })
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string());
    into_java_string(&mut env, out)
}

/* ────────────────────────── ★★内核驱动动画（tick 路径：Android 侧补齐） ────────────────────────── */

/// 通用「JSON 进 / JSON 出」转发（**五个内核动画入口共用**——避免五份手写副本，本仓纪律 #22）
///
/// ★JNIEnv 非 `UnwindSafe` ⇒ 入参字符串必须在闭包**外**取出（与 `nativeAnimCommitSpec` 同一纪律）。
fn forward_cstr<'local>(
    mut env: JNIEnv<'local>,
    json: JString<'local>,
    call: impl FnOnce(*const std::ffi::c_char) -> *mut std::ffi::c_char,
) -> jstring {
    let s: String = match env.get_string(&json) {
        Ok(v) => v.into(),
        Err(e) => {
            return into_java_string(&mut env, format!("{{\"ok\":false,\"error\":\"入参读取失败：{e}\"}}"))
        }
    };
    // ★`AssertUnwindSafe`：闭包只持有 `CString` + 一个 `FnOnce` 转发器（**无可共享可变状态**），
    //   panic 被捕获后只产出错误字符串、不把破坏状态带出去 ⇒ 断言成立（并在注释里写明理由，
    //   而不是无条件地"为了编译过"而断言——本仓纪律：豁免必须给出理由）。
    let out = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> String {
        let cs = match std::ffi::CString::new(s) {
            Ok(c) => c,
            Err(_) => return "{\"ok\":false,\"error\":\"入参含 NUL\"}".to_string(),
        };
        let p = call(cs.as_ptr());
        if p.is_null() {
            return "{\"ok\":false,\"error\":\"null\"}".to_string();
        }
        let o = unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned();
        unsafe { ffi::proteus_layout_free_string(p) };
        o
    }))
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string());
    into_java_string(&mut env, out)
}

/// ★★**启动动画**（Android 侧入口）——与 iOS `anim_start` 同一份内核语义
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeAnimStart<'local>(
    env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
    json: JString<'local>,
) -> jstring {
    forward_cstr(env, json, move |p| unsafe { ffi::proteus_layout_anim_start(handle as u64, p) })
}

/// ★★**每帧推进（二进制通道）**——返回 **28B/条**定长记录（`id u32 + 五值 f32 + rgba u32`，全小端）
///   （2026-10-01 由 24B 扩至 28B：颜色。末 4 字节 `0xAARRGGBB`，`0xFFFFFFFF` = 无内核底色）
///
/// 空数组 = 本帧无变化。★宿主按偏移直读、**无 JSON 解析**（与 iOS 同一条性能纪律；
/// 记录长度**只在本处定义**，Java 侧以常量对齐——iOS 曾因两处各写步长而错位，本端从简：单入口）。
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeAnimTickBin<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
    dt_ms: jni::sys::jfloat,
) -> jni::sys::jbyteArray {
    let buf = std::panic::catch_unwind(|| -> Vec<u8> {
        let mut len: u32 = 0;
        let p = unsafe { ffi::proteus_layout_anim_tick_bin(handle as u64, dt_ms as f32, &mut len) };
        if p.is_null() || len == 0 {
            return Vec::new();
        }
        let v = unsafe { std::slice::from_raw_parts(p, len as usize) }.to_vec();
        unsafe { ffi::proteus_rects_free(p, len) };
        v
    })
    .unwrap_or_default();
    match env.byte_array_from_slice(&buf) {
        Ok(a) => a.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// **停动画**（Android 侧）——`{"nodeIds":[…]}` 或 `{"all":true}`
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeAnimStop<'local>(
    env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
    json: JString<'local>,
) -> jstring {
    forward_cstr(env, json, move |p| unsafe { ffi::proteus_layout_anim_stop(handle as u64, p) })
}

/// ★★**滚动驱动**（MA5）：滚动位置 → 全部窗口动画（换算在内核，宿主零数学）
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeAnimSeekScroll<'local>(
    env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
    json: JString<'local>,
) -> jstring {
    forward_cstr(env, json, move |p| unsafe { ffi::proteus_layout_anim_seek_scroll(handle as u64, p) })
}

/// ★★**共享元素**（几何原语）：源矩形 + 目标节点 ⇒ dx/dy/scale（内核算，宿主零几何数学）
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeSharedElement<'local>(
    env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
    json: JString<'local>,
) -> jstring {
    forward_cstr(env, json, move |p| unsafe { ffi::proteus_layout_shared_element(handle as u64, p) })
}

/// `RustLayout.nativeNodeRect(handle: Long, nodeId: Int): String`
///
/// ★★**单节点绝对矩形**（2026-10-01：跨页面共享元素所需的"稳态几何回传"）——
///   页面栈层的共享元素编排要在**目标页刚 mount 后**取它的节点矩形，作为飞行的终点基准；
///   与 `proteus_layout_node_rect`（内核唯一实现，与 FLIP 走同一套偏移+吸附收集）同源。
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeNodeRect<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
    node_id: jni::sys::jint,
) -> jstring {
    let out = std::panic::catch_unwind(|| -> String {
        let p = unsafe { ffi::proteus_layout_node_rect(handle as u64, node_id as u32) };
        if p.is_null() {
            return "{\"ok\":false,\"error\":\"null\"}".to_string();
        }
        let s = unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned();
        unsafe { ffi::proteus_layout_free_string(p) };
        s
    })
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string());
    into_java_string(&mut env, out)
}
