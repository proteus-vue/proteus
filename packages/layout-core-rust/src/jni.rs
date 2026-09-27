// packages/layout-core-rust/src/jni.rs
// ★★Rust 排版核心的 **JNI 导出层**（Android 侧）。
//
// 【与 iOS 侧的关系】两端共用同一份核心逻辑（`engine`/`node`/`taffy_engine`），
//   只是**边界形态**不同：
//     · iOS：`ffi.rs` 的 C ABI（Swift 用 `@_silgen_name` 直接调）
//     · Android：本文件（Kotlin 用 `external fun` 调，JNI 名字规则见下）
//   两边都只做「JSON 进 / JSON 出」，把复杂度留在核心内。
//
// 【JNI 函数名规则】`Java_<包名下划线化>_<类名>_<方法名>`
//   本文件对应 Kotlin 侧：
//     package dev.proteus.layoutcore · object RustLayout · external fun nativeVersion() 等
//   → `Java_dev_proteus_layoutcore_RustLayout_nativeVersion`
//
// 【本模块仅在 Android 目标下编译】（`cfg(target_os = "android")`）——
//   否则本机 cargo test 会因缺 JNI 头而失败。
#![cfg(target_os = "android")]

use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;

use crate::engine::LayoutEngine;
use crate::{into_java_string, run_bench, run_conformance};

/// `RustLayout.nativeVersion(): String`
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeVersion<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
) -> jstring {
    let text = format!(
        "proteus-layout-core {} · engine={} · taffy 锁定 0.14（0.13 有 measure 指数退化）",
        env!("CARGO_PKG_VERSION"),
        crate::TaffyEngine::new().name()
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
            Err(e) => format!("{{\"ok\":false,\"error\":{}}}", crate::json_str(&e)),
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
            Err(e) => format!("{{\"ok\":false,\"error\":{}}}", crate::json_str(&e)),
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
        match crate::recycle::run_recycle_bench(r, f) {
            Ok(s) => s,
            Err(e) => format!("{{\"ok\":false,\"error\":{}}}", crate::json_str(&e)),
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
        unsafe { crate::ffi::proteus_layout_create(c.as_ptr()) as i64 }
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
    let ok = std::panic::catch_unwind(|| crate::ffi::proteus_layout_destroy(handle as u64)).unwrap_or(false);
    if ok { 1 } else { 0 }
}

/// `RustLayout.nativeHandleCount(): Int`
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeHandleCount<'local>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
) -> jni::sys::jint {
    std::panic::catch_unwind(|| crate::ffi::proteus_layout_handle_count()).unwrap_or(0) as i32
}

/// `RustLayout.nativeReadRects(handle: Long): String`
#[no_mangle]
pub extern "system" fn Java_dev_proteus_layoutcore_RustLayout_nativeReadRects<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jni::sys::jlong,
) -> jstring {
    let out = std::panic::catch_unwind(|| -> String {
        let p = unsafe { crate::ffi::proteus_layout_rects(handle as u64) };
        if p.is_null() {
            return "{\"ok\":false,\"error\":\"null\"}".to_string();
        }
        let s = unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned();
        unsafe { crate::ffi::proteus_layout_free_string(p) };
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
        let p = unsafe { crate::ffi::proteus_layout_hit_test(handle as u64, x, y) };
        if p.is_null() {
            return "{\"ok\":false,\"error\":\"null\"}".to_string();
        }
        let s = unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned();
        unsafe { crate::ffi::proteus_layout_free_string(p) };
        s
    })
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string());
    into_java_string(&mut env, out)
}
