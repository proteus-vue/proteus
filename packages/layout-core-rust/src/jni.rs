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
