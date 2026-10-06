// platform/android/proteus-jni/src/host.rs
// ABI-BINDING: 本文件是**绑定层**（不是平台适配）——职责就是"Host ABI ↔ JNI"的翻译，
//   因此**必须**引用 `proteus_host_abi`（否则无法把契约接到 Java 上）。
//   ★与"平台适配"的区别（`check:platform-layering` B 组的两小类）：
//     平台适配（如 `platform/ios/ProteusTextAdapter.swift`）只知道 UI 框架 API；
//     绑定层知道契约——那是它的工作。豁免需显式声明（本行）+ 理由（下面这段）。
// ★★**Android 侧的 Host ABI 绑定**（HA5：让**客户 App** 能用 Java 直接嵌入 Proteus）
//
// 【这个文件补的是哪个缺口（本轮取证发现）】`lib.rs` 里 32 处绑定全部是**内核** C ABI
//   （`proteus_layout_*` / `proteus_recycle_*`）——那是给"自绘宿主"用的**低层**接口；
//   而 **Host ABI（`proteus_engine_*`）零绑定** ⇒ iOS 侧已经能"按 ABI 实现宿主"（HA1），
//   Android 侧却做不到（客户拿不到 `proteus_engine_create` 这类入口）。
//   ⇒ 本文件把 Host ABI 的**引擎侧入口**逐个绑成 JNI 符号。
//
// 【与 iOS 侧的对称性】iOS 用 `@_silgen_name` 直调 C ABI（HA1 已落地，双路几何逐字节一致）；
//   Android 走 JNI ⇒ 一一对应：
//     `proteus_engine_create`        ↔ `ProteusEngine.nativeCreate(host)`
//     `proteus_load_tree`            ↔ `ProteusEngine.nativeLoadTree(json)`
//     `proteus_frame`                ↔ `ProteusEngine.nativeFrame(frameTimeNs)`
//     `proteus_frame_updates`        ↔ `ProteusEngine.nativeFrameUpdates(): byte[]`
//     `proteus_rects`                ↔ `ProteusEngine.nativeRects(): byte[]`
//
// 【★本文件最难的一处：C → Java 的**回调穿梭**（vtable 是 C 函数指针，而宿主是 Java 对象）】
//   Host ABI 的 vtable 收 `extern "C"` 函数指针；Android 的宿主却是 Java 对象
//   ⇒ 需要**C 蹦床**：Rust 侧缓存 `JavaVM`（`JNI_OnLoad` 时抓）+ 宿主的 `GlobalRef`，
//     蹦床里 `vm.get_env()`（Java 起源的线程已 attach）→ `call_method` 回 Java。
//   ★三条约束（都写进注释，因为它们各自对应一种真实故障）：
//     ① `GlobalRef` 必须**全局持有**（局部引用出了 JNI 调用即失效）；
//     ② 回调里**不得再取** `JNIEnv` 的临时局部引用而不释放（JNI 局部引用表有上限，
//        超了会 abort 且**没有 Rust 侧错误**——静默崩溃）；
//     ③ 蹦床内 panic **不得跨 FFI 边界**（`catch_unwind` 兜底，否则 ub）。
//
// 【诚实边界】本文件只绑**引擎侧**入口（宿主 → 引擎）；
//   反向（引擎 → 宿主）经上文的蹦床；能力插件与原生组件的 Java 回调同法暂未绑（见文件末尾）。

use std::collections::HashMap;
use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};

use jni::objects::{GlobalRef, JClass, JLongArray, JObject, JString, JValue};
use jni::sys::{jbyteArray, jint, jlong, jstring};
use jni::{JNIEnv, JavaVM};

use proteus_host_abi as abi;

/* ────────────────────────── 全局：JavaVM + 宿主回调对象 ────────────────────────── */

static JAVA_VM: OnceLock<JavaVM> = OnceLock::new();
/// 宿主的回调对象（**全局引用**——见文件头约束 ①）
static HOST_OBJ: Mutex<Option<GlobalRef>> = Mutex::new(None);

/// ★HA4：原生 View 句柄注册表——**C handle = 索引**（usize，非 0），对象经 GlobalRef 全局持有。
///   【为什么需要它】C ABI 的 handle 是 *mut c_void；而 Java 的 View 是 GC 对象，**不能**当裸指针传
///   （会被 GC 回收/移动）⇒ 用"全局引用 + 索引"做不透明句柄（引擎只透传，不解释）。
static NATIVE_VIEWS: OnceLock<Mutex<HashMap<usize, GlobalRef>>> = OnceLock::new();
/// 句柄序号（从 1 起——0/NULL 在 C 侧表示"无/失败"）
static NATIVE_VIEW_SEQ: AtomicUsize = AtomicUsize::new(1);

fn native_views() -> &'static Mutex<HashMap<usize, GlobalRef>> {
    NATIVE_VIEWS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// ★`JNI_OnLoad`：抓住 `JavaVM`（**唯一可靠的获取时机**——回调里现取不可靠，
///   因为回调可能由"Java 起源但已被 JNI 包装"的线程触发，那时 `env` 不在手边）。
///
/// # Safety
/// 由 JVM 调用；`vm` 为有效 `JavaVM` 指针。
#[no_mangle]
pub unsafe extern "system" fn JNI_OnLoad(vm: *mut jni::sys::JavaVM, _reserved: *mut c_void) -> jint {
    let Ok(vm) = (unsafe { JavaVM::from_raw(vm) }) else {
        return jni::sys::JNI_ERR;
    };
    let _ = JAVA_VM.set(vm);
    jni::sys::JNI_VERSION_1_6
}

/// 取当前线程的 `JNIEnv`（Java 起源的线程已 attach ⇒ `get_env` 成立）
fn with_env<R>(f: impl FnOnce(&mut JNIEnv) -> Option<R>) -> Option<R> {
    let vm = JAVA_VM.get()?;
    let mut env = vm.get_env().ok()?;
    f(&mut env)
}

/// 读宿主的回调对象（克隆一份 GlobalRef 出来用——避免持锁跨调用）
fn host_ref() -> Option<GlobalRef> {
    HOST_OBJ.lock().ok().and_then(|g| g.clone())
}

/* ────────────────────────── C 蹦床：引擎 → Java ────────────────────────── */

/// 文本度量蹦床：引擎要量文本 ⇒ 调 Java 的 `measureText`
///
/// 【为什么用 `long` 回传两个 float】`float[]` 每次分配一个数组对象（GC 压力），
///   而度量**每棵树每个文本节点一次**；两个 f32 恰好塞进一个 i64 ⇒ 零分配。
///   Java 侧：`(Float.floatToRawIntBits(w) & 0xFFFFFFFFL) | (floatToRawIntBits(h) << 32)`。
unsafe extern "C" fn trampoline_measure_text(
    input: *const abi::ProteusTextInput,
    out: *mut abi::ProteusTextMetrics,
    _ud: *mut c_void,
) -> i32 {
    // ★约束 ③：panic 不得跨 FFI
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> i32 {
        if input.is_null() || out.is_null() {
            return -1;
        }
        let i = unsafe { &*input };
        let text = if i.text.is_null() {
            String::new()
        } else {
            unsafe { CStr::from_ptr(i.text) }.to_string_lossy().into_owned()
        };
        let family = if i.font_family.is_null() {
            String::new()
        } else {
            unsafe { CStr::from_ptr(i.font_family) }.to_string_lossy().into_owned()
        };
        let Some(host) = host_ref() else { return -1 };
        let r = with_env(|env| -> Option<jlong> {
            let jtext = env.new_string(&text).ok()?;
            let jfam = env.new_string(&family).ok()?;
            let v = env
                .call_method(
                    host.as_obj(),
                    "measureText",
                    "(Ljava/lang/String;FILjava/lang/String;)J",
                    &[
                        JValue::Object(jtext.as_ref()),
                        JValue::Float(i.font_size),
                        JValue::Int(i.font_weight),
                        JValue::Object(jfam.as_ref()),
                    ],
                )
                .ok()?;
            v.j().ok()
        });
        let Some(packed) = r else { return -1 };
        let w = f32::from_bits((packed & 0xFFFF_FFFF) as u32);
        let h = f32::from_bits(((packed >> 32) & 0xFFFF_FFFF) as u32);
        unsafe {
            (*out).width = w;
            (*out).height = h;
        }
        abi::PROTEUS_OK
    }))
    .unwrap_or(-1)
}

/// 帧请求蹦床：引擎"有事要做" ⇒ 通知 Java 排下一帧（内核不自建线程，调度归宿主）
unsafe extern "C" fn trampoline_request_frame(_ud: *mut c_void) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let Some(host) = host_ref() else { return };
        let _ = with_env(|env| -> Option<()> {
            let _ = env.call_method(host.as_obj(), "requestFrame", "()V", &[]);
            Some(())
        });
    }));
}

/// ★HA4 蹦床：引擎要建原生 View ⇒ 调 Java nativeViewCreate，把返回的 View 存成 GlobalRef、
///   回传**索引**作不透明句柄（见 NATIVE_VIEWS）。返回 NULL ⇒ 宿主**拒绝**（engine 记为拒绝并报错）。
unsafe extern "C" fn trampoline_native_view_create(
    kind: *const c_char,
    frame: *const abi::ProteusRect,
    _ud: *mut c_void,
) -> *mut c_void {
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> *mut c_void {
        if frame.is_null() {
            return std::ptr::null_mut();
        }
        let k = if kind.is_null() {
            String::from("native")
        } else {
            unsafe { CStr::from_ptr(kind) }.to_string_lossy().into_owned()
        };
        let f = unsafe { &*frame };
        let Some(host) = host_ref() else { return std::ptr::null_mut() };
        let obj = with_env(|env| -> Option<GlobalRef> {
            let jk = env.new_string(&k).ok()?;
            let v = env
                .call_method(
                    host.as_obj(),
                    "nativeViewCreate",
                    "(Ljava/lang/String;FFFF)Ljava/lang/Object;",
                    &[
                        JValue::Object(jk.as_ref()),
                        JValue::Float(f.x),
                        JValue::Float(f.y),
                        JValue::Float(f.width),
                        JValue::Float(f.height),
                    ],
                )
                .ok()?;
            let o = v.l().ok()?;
            if o.is_null() {
                return None; // 宿主拒绝（kind 不支持）——engine 记为拒绝并报错
            }
            env.new_global_ref(&o).ok()
        });
        match obj {
            Some(g) => {
                let id = NATIVE_VIEW_SEQ.fetch_add(1, Ordering::SeqCst);
                if let Ok(mut m) = native_views().lock() {
                    m.insert(id, g);
                }
                id as *mut c_void
            }
            None => std::ptr::null_mut(),
        }
    }));
    r.unwrap_or(std::ptr::null_mut())
}

/// 更新原生 View 几何（句柄 = create 回传的索引）
unsafe extern "C" fn trampoline_native_view_update(handle: *mut c_void, frame: *const abi::ProteusRect, _ud: *mut c_void) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if handle.is_null() || frame.is_null() {
            return;
        }
        let id = handle as usize;
        let f = unsafe { &*frame };
        let Some(host) = host_ref() else { return };
        // 先克隆出 GlobalRef（避免持锁跨 JNI 调用）
        let g = native_views().lock().ok().and_then(|m| m.get(&id).cloned());
        let Some(g) = g else { return };
        let _ = with_env(|env| -> Option<()> {
            let _ = env.call_method(
                host.as_obj(),
                "nativeViewUpdate",
                "(Ljava/lang/Object;FFFF)V",
                &[
                    JValue::Object(g.as_obj()),
                    JValue::Float(f.x),
                    JValue::Float(f.y),
                    JValue::Float(f.width),
                    JValue::Float(f.height),
                ],
            );
            Some(())
        });
    }));
}

/// 销毁原生 View（移除注册表项 ⇒ GlobalRef 释放；并调 Java nativeViewDestroy）
unsafe extern "C" fn trampoline_native_view_destroy(handle: *mut c_void, _ud: *mut c_void) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if handle.is_null() {
            return;
        }
        let id = handle as usize;
        let g = native_views().lock().ok().and_then(|mut m| m.remove(&id));
        let Some(g) = g else { return };
        if let Some(host) = host_ref() {
            let _ = with_env(|env| -> Option<()> {
                let _ = env.call_method(
                    host.as_obj(),
                    "nativeViewDestroy",
                    "(Ljava/lang/Object;)V",
                    &[JValue::Object(g.as_obj())],
                );
                Some(())
            });
        }
    }));
}

/* ────────────────────────── 引擎入口（Java → 引擎） ────────────────────────── */

/// 建引擎。`host` 为宿主回调对象（实现 `ProteusHost`）；返回引擎句柄（`0` = 失败）。
///
/// 【版本协商】宿主版本由**本层**用 SDK 自己的版本填（SDK 与 ABI 同包发布，不可能不匹配）；
///   真正需要协商的是"**产物** vs **SDK**"——那由 `load_tree` 时的能力校验 + 版本三件套覆盖
///   （见 `checkCapabilities` 与 `packages/slot-runtime/src/version.ts`）。
#[no_mangle]
pub extern "system" fn Java_dev_proteus_sdk_ProteusEngine_nativeCreate<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    host: JObject<'local>,
) -> jlong {
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> jlong {
        // ① 全局引用（约束 ①）——局部引用出本次调用即失效，回调在**之后**才发生
        let Ok(g) = env.new_global_ref(&host) else { return 0 };
        if let Ok(mut slot) = HOST_OBJ.lock() {
            *slot = Some(g);
        } else {
            return 0;
        }
        // ② vtable：函数指针指向蹦床
        let mut vt = abi::ProteusHostVTable {
            user_data: std::ptr::null_mut(),
            request_frame: None,
            measure_text: None,
            decode_image: None,
            native_view_create: None,
            native_view_update: None,
            native_view_destroy: None,
        };
        vt.measure_text = Some(trampoline_measure_text);
        vt.request_frame = Some(trampoline_request_frame);
        // ★HA4：原生组件三回调（引擎驱动生命周期）；宿主未 override 其 Java 缺省实现 ⇒
        //   create 返回 null ⇒ engine 记为"宿主拒绝创建"并报错（不静默）。
        vt.native_view_create = Some(trampoline_native_view_create);
        vt.native_view_update = Some(trampoline_native_view_update);
        vt.native_view_destroy = Some(trampoline_native_view_destroy);
        // ③ 版本：用 SDK 自己的（同包发布，必然一致）
        let ver = abi::proteus_abi_version_info();
        let mut hint = [0 as c_char; 256];
        let e = unsafe { abi::proteus_engine_create(&vt, &ver, hint.as_mut_ptr(), hint.len()) };
        if e.is_null() {
            let msg = unsafe { CStr::from_ptr(hint.as_ptr()) }.to_string_lossy().into_owned();
            eprintln!("[proteus] 引擎创建失败：{msg}");
            return 0;
        }
        e as usize as jlong
    }))
    .unwrap_or(0);
    r
}

/// 引擎**预热**（方案 §8.5）——客户在 `Application.onCreate` 调；幂等、零副作用
#[no_mangle]
pub extern "system" fn Java_dev_proteus_sdk_ProteusEngine_nativePrewarm(_env: JNIEnv, _class: JClass) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        abi::proteus_prewarm();
    }));
}

#[no_mangle]
pub extern "system" fn Java_dev_proteus_sdk_ProteusEngine_nativeDestroy(
    _env: JNIEnv,
    _class: JClass,
    engine: jlong,
) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if engine != 0 {
            unsafe { abi::proteus_engine_destroy(engine as usize as *mut abi::ProteusEngine) };
        }
        if let Ok(mut slot) = HOST_OBJ.lock() {
            *slot = None;
        }
    }));
}

/// 加载树（JSON）。返回 `0` = 成功，负 = 错误码（见头文件 `PROTEUS_ERR_*`）
#[no_mangle]
pub extern "system" fn Java_dev_proteus_sdk_ProteusEngine_nativeLoadTree<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    engine: jlong,
    json: JString<'local>,
) -> jint {
    let s: String = match env.get_string(&json) {
        Ok(v) => v.into(),
        Err(_) => return abi::PROTEUS_ERR_INVALID_ARG,
    };
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let Ok(cs) = CString::new(s) else { return abi::PROTEUS_ERR_INVALID_ARG };
        unsafe { abi::proteus_load_tree(engine as usize as *mut abi::ProteusEngine, cs.as_ptr()) }
    }))
    .unwrap_or(abi::PROTEUS_ERR_INTERNAL)
}

/// 一帧指令流（**批处理红线**：一帧**一次**调用）
#[no_mangle]
pub extern "system" fn Java_dev_proteus_sdk_ProteusEngine_nativeSubmitFrame<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    engine: jlong,
    ops: jni::sys::jbyteArray,
) -> jint {
    let bytes = match env.convert_byte_array(unsafe { jni::objects::JByteArray::from_raw(ops) }) {
        Ok(v) => v,
        Err(_) => return abi::PROTEUS_ERR_INVALID_ARG,
    };
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        unsafe {
            abi::proteus_submit_frame(
                engine as usize as *mut abi::ProteusEngine,
                bytes.as_ptr(),
                bytes.len(),
            )
        }
    }))
    .unwrap_or(abi::PROTEUS_ERR_INTERNAL)
}

/// 推进一帧（`frame_time_ns` = 系统单调时钟纳秒）
#[no_mangle]
pub extern "system" fn Java_dev_proteus_sdk_ProteusEngine_nativeFrame(
    _env: JNIEnv,
    _class: JClass,
    engine: jlong,
    frame_time_ns: jlong,
) -> jint {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
        abi::proteus_frame(engine as usize as *mut abi::ProteusEngine, frame_time_ns)
    }))
    .unwrap_or(abi::PROTEUS_ERR_INTERNAL)
}

/// 本帧视觉更新（**32B/条**：`id u32 + 五值 f32 + bg u32 + textColor u32`，小端；
///   2026-10-01 由 24B → 28B → 32B——末两个 u32 为打包色 `0xAARRGGBB`，`0xFFFFFFFF` = 无该基色。
///   本层**只透传字节**，不解析)
///
/// 【为什么是 `byte[]` 而不是让 Java 侧读指针】引擎的内部缓冲**有效期到下次同类调用**；
///   跨 JNI 传指针会让 Java 侧持有失效引用（"看起来能用、某天崩"）。
///   ⇒ 拷贝成 `byte[]`（每帧一次拷贝，换来明确的生存期语义）。Java 侧用
///     `ByteBuffer.order(LITTLE_ENDIAN)` 直读，**无 JSON 解析**。
#[no_mangle]
pub extern "system" fn Java_dev_proteus_sdk_ProteusEngine_nativeFrameUpdates<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    engine: jlong,
) -> jbyteArray {
    let buf = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Vec<u8> {
        let mut len: u32 = 0;
        let p = unsafe { abi::proteus_frame_updates(engine as usize as *mut abi::ProteusEngine, &mut len) };
        if p.is_null() || len == 0 {
            return Vec::new();
        }
        unsafe { std::slice::from_raw_parts(p, len as usize) }.to_vec()
    }))
    .unwrap_or_default();
    match env.byte_array_from_slice(&buf) {
        Ok(a) => a.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// 当前几何（二进制矩形流：头 16B + N×20B）
#[no_mangle]
pub extern "system" fn Java_dev_proteus_sdk_ProteusEngine_nativeRects<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    engine: jlong,
) -> jbyteArray {
    let buf = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Vec<u8> {
        let mut len: u32 = 0;
        let p = unsafe { abi::proteus_rects(engine as usize as *mut abi::ProteusEngine, &mut len) };
        if p.is_null() || len == 0 {
            return Vec::new();
        }
        unsafe { std::slice::from_raw_parts(p, len as usize) }.to_vec()
    }))
    .unwrap_or_default();
    match env.byte_array_from_slice(&buf) {
        Ok(a) => a.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// 诊断读数（JSON：帧数 / 批处理计数 / 度量回调数 / last_error …）——**接入时先看它**
#[no_mangle]
pub extern "system" fn Java_dev_proteus_sdk_ProteusEngine_nativeStats<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    engine: jlong,
) -> jstring {
    let s = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> String {
        let p = unsafe { abi::proteus_stats_json(engine as usize as *mut abi::ProteusEngine) };
        if p.is_null() {
            return "{\"ok\":false,\"error\":\"引擎句柄无效\"}".to_string();
        }
        unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned()
    }))
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string());
    into_java_string(&mut env, s)
}

/// ★设置壳的**能力清单**（接受 CLI `capability-manifest.json` 的同形；HA3）
#[no_mangle]
pub extern "system" fn Java_dev_proteus_sdk_ProteusEngine_nativeSetShellCapabilities<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    engine: jlong,
    json: JString<'local>,
) -> jint {
    let s: String = match env.get_string(&json) {
        Ok(v) => v.into(),
        Err(_) => return abi::PROTEUS_ERR_INVALID_ARG,
    };
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let Ok(cs) = CString::new(s) else { return abi::PROTEUS_ERR_INVALID_ARG };
        unsafe { abi::proteus_set_shell_capabilities(engine as usize as *mut abi::ProteusEngine, cs.as_ptr()) }
    }))
    .unwrap_or(abi::PROTEUS_ERR_INTERNAL)
}

/// ★**端上校验**（产物所需 ⊆ 壳提供）；缺失 ⇒ 返回负码 + `out` 写可操作报告
#[no_mangle]
pub extern "system" fn Java_dev_proteus_sdk_ProteusEngine_nativeCheckCapabilities<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    engine: jlong,
    required_json: JString<'local>,
) -> jint {
    // ★形态说明：Java 的 String 不可变 ⇒ 报告**不从这里回传**，而是
    //   ① 打到 logcat（人类排查）；② 留在 `stats()` 的 `last_error`（程序化读取）。
    //   ⇒ 签名简单 + 两条可观测路径都有。
    let s: String = match env.get_string(&required_json) {
        Ok(v) => v.into(),
        Err(_) => return abi::PROTEUS_ERR_INVALID_ARG,
    };
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let Ok(cs) = CString::new(s) else { return abi::PROTEUS_ERR_INVALID_ARG };
        let mut buf = [0 as c_char; 1024];
        let rc = unsafe {
            abi::proteus_check_capabilities(
                engine as usize as *mut abi::ProteusEngine,
                cs.as_ptr(),
                buf.as_mut_ptr(),
                buf.len(),
            )
        };
        // 报告无条件打到日志（Java 侧要看细节可读 `stats()` 的 last_error）
        let msg = unsafe { CStr::from_ptr(buf.as_ptr()) }.to_string_lossy().into_owned();
        eprintln!("[proteus] 能力校验 → rc={rc}：{msg}");
        rc
    }))
    .unwrap_or(abi::PROTEUS_ERR_INTERNAL)
}

/// 指针事件**批处理**（一帧的所有事件一次提交；返回命中的节点 id，`0` = 未命中）
///
/// 【入参形态】三个平行数组（`xs`/`ys`/`types`）——不用"每个事件一个对象"：
///   那会让 Java 侧每帧建 N 个临时对象（GC 压力），而触摸是**每帧**发生的。
#[no_mangle]
pub extern "system" fn Java_dev_proteus_sdk_ProteusEngine_nativeDispatchPointers(
    mut env: JNIEnv,
    _class: JClass,
    engine: jlong,
    xs: jni::sys::jfloatArray,
    ys: jni::sys::jfloatArray,
    types: jni::sys::jintArray,
    ts_ns: jni::sys::jlongArray,
) -> jlong {
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> jlong {
        use jni::objects::{JFloatArray, JIntArray, JLongArray};
        // ★jni 0.21 对**非 byte** 基本类型数组**没有** `convert_*_array`（只有 byte 有）
        //   ⇒ 正解：先 `get_array_length`，再 `get_*_array_region` 读进预分配缓冲。
        //   （首版按直觉写了 `convert_float_array` ⇒ 编译期 E0599 当场拦下。）
        let (xa, ya, ta, sa) = unsafe {
            (
                JFloatArray::from_raw(xs),
                JFloatArray::from_raw(ys),
                JIntArray::from_raw(types),
                JLongArray::from_raw(ts_ns),
            )
        };
        let n = match env.get_array_length(&xa) {
            Ok(v) => v as usize,
            Err(_) => return -1,
        };
        // 三个数组必须**等长**（调用方契约；不等长 ⇒ 明确失败，不按最短截断）
        match (env.get_array_length(&ya), env.get_array_length(&ta), env.get_array_length(&sa)) {
            (Ok(b), Ok(c), Ok(d)) if b as usize == n && c as usize == n && d as usize == n => {}
            _ => return -1,
        }
        if n == 0 {
            return -1;
        }
        let mut xs_v = vec![0f32; n];
        let mut ys_v = vec![0f32; n];
        let mut types_v = vec![0i32; n];
        let mut ts_v = vec![0i64; n];
        if env.get_float_array_region(&xa, 0, &mut xs_v).is_err()
            || env.get_float_array_region(&ya, 0, &mut ys_v).is_err()
            || env.get_int_array_region(&ta, 0, &mut types_v).is_err()
            || env.get_long_array_region(&sa, 0, &mut ts_v).is_err()
        {
            return -1;
        }
        let (xs, ys, types, ts) = (xs_v, ys_v, types_v, ts_v);
        let events: Vec<abi::ProteusPointerEvent> = (0..n)
            .map(|i| abi::ProteusPointerEvent {
                type_: types[i] as u32,
                pointer_id: 0,
                x: xs[i],
                y: ys[i],
                timestamp_ns: ts[i],
            })
            .collect();
        unsafe {
            abi::proteus_dispatch_pointers(
                engine as usize as *mut abi::ProteusEngine,
                events.as_ptr(),
                events.len(),
            )
        }
    }))
    .unwrap_or(-1);
    r
}

/// 启动动画（声明格式与内核 `anim_start` 一致；曲线/弹簧/序列/滚动窗口）
#[no_mangle]
pub extern "system" fn Java_dev_proteus_sdk_ProteusEngine_nativeAnimStart<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    engine: jlong,
    anims_json: JString<'local>,
) -> jint {
    let s: String = match env.get_string(&anims_json) {
        Ok(v) => v.into(),
        Err(_) => return abi::PROTEUS_ERR_INVALID_ARG,
    };
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let Ok(cs) = CString::new(s) else { return abi::PROTEUS_ERR_INVALID_ARG };
        unsafe { abi::proteus_anim_start(engine as usize as *mut abi::ProteusEngine, cs.as_ptr()) }
    }))
    .unwrap_or(abi::PROTEUS_ERR_INTERNAL)
}

/// 停动画（`{"all":true}` / `{"nodeIds":[…]}`；含清值语义）
#[no_mangle]
pub extern "system" fn Java_dev_proteus_sdk_ProteusEngine_nativeAnimStop<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    engine: jlong,
    json: JString<'local>,
) -> jint {
    let s: String = match env.get_string(&json) {
        Ok(v) => v.into(),
        Err(_) => return abi::PROTEUS_ERR_INVALID_ARG,
    };
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let Ok(cs) = CString::new(s) else { return abi::PROTEUS_ERR_INVALID_ARG };
        unsafe { abi::proteus_anim_stop(engine as usize as *mut abi::ProteusEngine, cs.as_ptr()) }
    }))
    .unwrap_or(abi::PROTEUS_ERR_INTERNAL)
}

/// 渲染线程 / 滚动 / 动画帧**之后**的手动同步（原生组件几何；HA4）
#[no_mangle]
pub extern "system" fn Java_dev_proteus_sdk_ProteusEngine_nativeSyncNativeViews(
    _env: JNIEnv,
    _class: JClass,
    engine: jlong,
) -> jint {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
        abi::proteus_sync_native_views(engine as usize as *mut abi::ProteusEngine)
    }))
    .unwrap_or(abi::PROTEUS_ERR_INTERNAL)
}

/// 复用 `lib.rs` 的同名工具（跨模块引用——避免两份实现）
use crate::into_java_string;
