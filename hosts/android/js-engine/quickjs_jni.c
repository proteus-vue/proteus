// hosts/android/js-engine/quickjs_jni.c
// ★★S2：QuickJS 的 JNI 桥（Android JS 执行载体）
//
// 【为什么需要（本会话核实的结构事实）】Android 宿主无 JS 引擎
//   （`hosts/android` = Java + Rust `.so` 直连 JNI）⇒ 卡 C1「可运行 Android 实现」与
//   C2「JSI 通路」都受阻于此。选型见 `docs/proteus-android-js-engine-selection.md`（QuickJS）。
//
// 【为什么用 C 而不是 Rust（本仓惯例的例外，理由明确）】
//   QuickJS 是 **C 库**（`JS_NewRuntime`/`JS_Eval` 等），JNI 头是 C。
//   本仓 Rust 侧的 `jni.rs` 走 `jni` crate，但那是 **Rust 调 Rust**；
//   此处要调 **C 库**，用 C 写桥最直接（零 FFI 层次）。
//   ★若将来要并入 Rust 核心，可加一层 C ABI（`extern "C"`）再让 Rust 调——但当前不需要。
//
// 【接口设计（对齐本仓既有 JNI 门面：JSON 进 / JSON 出）】
//   `nativeEval(source)`                → 执行 JS，返回 JSON `{"ok":true,"value":"…"}` 或错误
//   `nativeEvalWithHost(source)`        → 执行 JS，并注入 `proteusHost.post(json)` 桩
//   `nativeSetHostCallback(obj)`        → 注册 Java 侧回调（供 JS 调 `proteusHost.*`）
//
// 【★诚实边界（本桥不做什么）】
//   ① **不做能力注入的实现**：只提供 `evaluateScript` + 一个宿主回调桩；
//      `proteusNative`（createView/updateView/…）等具体能力由宿主自己决定暴露什么
//      —— 本桥不假定 Proteus 的接口形状（那是 HA0 的职责，尚未实现）。
//   ② **不做模块加载**：bundle 是 IIFE（本仓产物形态），无 `import`/`require`。
//   ③ **单运行时（无隔离）**：一个进程一个 `JSRuntime`；多实例/沙箱属后续（插件场景才需要）。
//   ④ **不做 JIT**：QuickJS 是纯解释器（Android W^X 限制下 JIT 不可靠——见选型文档 §3.2）。
#include <jni.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>   // sprintf（json_escape_alloc 用）
#include <android/log.h>

// ★QuickJS 头（由 scripts/setup-android-js-engine.sh 获取到 .tools/quickjs/）
#include "quickjs.h"

#define LOG_TAG "ProteusJS"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

/** 进程级单运行时（见文件头边界③） */
static JSRuntime *g_rt = NULL;
static JSContext *g_ctx = NULL;
/** Java 侧宿主回调（全局引用——跨调用存活；`proteusHost.*` 调用它） */
static jobject g_host_obj = NULL;

/**
 * ★★★**反向调用通道**（Java → JS；2026-10-01 交互闭环）。
 *
 * 【为什么需要（本仓此前的形态全是单向）】既有全部桥入口都是 **JS → Java**（`proteusHost.xxx()`
 *   同步取返回值）。而"宿主手势 → 通知 JS 跑 handler"必须**反向**：宿主先拿到手势，
 *   JS 才知道该跑哪个 handler。
 *
 * 【为什么用"注册函数名 + 全局查函数"而不是保存 JSValue 引用】QuickJS 的 `JSValue`
 *   在 `JS_FreeContext` 前必须显式释放，跨 eval 保存需要自建引用计数（易泄漏）；
 *   而"JS 侧注册一个**全局函数名**，宿主按名查"是零引用计数的形态
 *   （函数挂在 globalThis 上，随上下文生命周期管理）——与"声明与实现分离"同一取向。
 */
static char g_gesture_cb[128] = {0};   /* JS 侧注册的回调名（空 = 未注册） */
static JavaVM *g_vm = NULL;

/**
 * ★★宿主方法表（S5：**按 Java 侧实际实现条件注入**）。
 *
 * 【为什么不无条件注入三个入口（本文件的设计要点）】JS 侧的批量桥用
 *   `typeof proteusHost.mount === 'function'` 判定"宿主是否能真正消费批次"：
 *   · 能 ⇒ 走真机消费（S5 的 js-render 路径：Java → Rust 排版 → 自绘）；
 *   · 不能 ⇒ 退化到本地桩（S3b 的 js-batch 路径：只证明「适配器 → 宿主入口」）。
 *   若 C 侧**无条件**注入这三个函数，判定恒为真 ⇒ 宿主会收到它没实现的调用。
 *   ⇒ 一律以 Java 对象的**真实方法**为准（`GetMethodID` 失败 = 没实现 = 不注入）。
 */
static struct {
  jmethodID post;
  jmethodID mount;
  jmethodID update;
  jmethodID update_patches;
  /* ★★G-39：引擎内存读数 / GC（宿主"内存账本"两个入口——见 nativeMemoryUsage 注释） */
  jmethodID mem_usage;
  jmethodID gc;
  /* ★★App 端原生能力通道（`proteusHost.invoke(method, argsJson)` —— capability-app.ts 的 invokeHost 消费） */
  jmethodID invoke;
  /* ★★动画桥（2026-10-01 · 灯光秀）：内核动画从 JS 侧驱动——逐帧 tick / 起停 / active 查询。
   *   与 mount/update 同一"按 Java 实现条件注入"原则（宿主未实现 ⇒ 不注入 ⇒ JS 侧探测为 undefined，
   *   走诚实降级而不是静默拿到 undefined）。 */
  jmethodID anim_start;
  jmethodID anim_tick;
  jmethodID anim_stop;
  jmethodID anim_active;
  /* ★★灯光秀计量/几何桥（2026-10-01）：nowUs/rects/probe/report——JS 侧计时与几何现读。
   *   同一条件注入原则（Java 未实现 ⇒ 不注入）。 */
  jmethodID now_us;
  jmethodID rects;
  jmethodID probe;
  jmethodID report;
  /* ★★A3 播放控制（2026-10-01 · 第三节目）：animControl(String)->String */
  jmethodID anim_control;
  /* ★★★Vapor 设备端（2026-10-01）：二进制指令流 + 内核几何真源读
   *   ——「真实 SFC 编译产物 → 设备端实例化 → 订阅驱动更新」那条链的宿主入口。
   *   同一条件注入原则（Java 未实现 ⇒ 不注入 ⇒ JS 侧探测为 undefined，走诚实降级）。 */
  jmethodID apply_ops;
  jmethodID read_rects;
  /* ★★★B-T2（2026-10-10）：文本策略回读（`proteusHost.textPolicy(idsJson)`——内核=SSOT）。
   *   同一条件注入原则（Java 未实现 ⇒ 不注入 ⇒ JS 侧探测为 undefined）。 */
  jmethodID text_policy;
  /* ★★★长列表虚拟化（2026-10-01）：整树在内核、宿主只物化可见区。
   *   同一条件注入原则（Java 未实现 ⇒ 不注入 ⇒ JS 侧探测为 undefined）。 */
  jmethodID mount_virtual;
  jmethodID scroll_rows;
  /* ★★绘制通道探针（2026-10-01）：逐通道报「宿主真源里建出来了没」（判据用） */
  jmethodID probe_channels;
  /* ★★交互闭环（2026-10-01）：手势探针 + 进程内注入 tap（判据驱动；真机 input tap 无权限） */
  jmethodID probe_gesture;
  jmethodID tap_at;
  /* ★B1：新屏挂载前重置滚动偏移（void 无参） */
  /* ★B1：每屏滚动进度记忆（getScroll 无参返 double；setScroll 一参 void） */
  jmethodID get_scroll;
  jmethodID set_scroll;
} g_host_methods = { NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL };

/* ★前向声明：eval_impl 之后要泵 job（定义在下方；C 里调用点必须先可见） */
static int pump_jobs_bounded(void);

/** 惰性初始化运行时 + 上下文 */
static int ensure_ctx(void) {
  if (g_ctx != NULL) return 0;
  g_rt = JS_NewRuntime();
  if (g_rt == NULL) { LOGE("JS_NewRuntime 失败"); return -1; }
  // ★内存上限（选型实测：8MB 即可跑通 368KB bundle ⇒ 给 64MB 余量，防失控脚本拖垮宿主）
  JS_SetMemoryLimit(g_rt, 64 * 1024 * 1024);
  g_ctx = JS_NewContext(g_rt);
  if (g_ctx == NULL) { LOGE("JS_NewContext 失败"); return -1; }
  // ★栈上限（防递归爆栈打死宿主——QuickJS 默认无上限）
  JS_SetMaxStackSize(g_rt, 1024 * 1024);
  return 0;
}

/** 把 JS 值转成人类可读字符串（返回的 C 字符串需 JS_FreeCString） */
static const char *js_to_utf8(JSContext *ctx, JSValueConst v) {
  return JS_ToCString(ctx, v);
}

/**
 * 宿主调用的**公共实现**——取 `env`（必要时 attach）、调 Java、取回字符串结果。
 *
 * 【为什么统一成一处（本仓纪律：同一语义一处实现）】四个入口（post / mount / update /
 *   updatePatches）的 JNI 样板完全相同，差别只在方法 id 与「有无返回值」。
 *   第二份副本必然漂移——本仓已多次吃过（见 ffi.rs 的 with_engine 注释同款教训）。
 */
static JSValue host_call_impl(JSContext *ctx, jmethodID mid, int has_ret,
                              JSValueConst this_val, int argc, JSValueConst *argv) {
  (void)this_val;
  if (mid == NULL || g_host_obj == NULL || g_vm == NULL) return JS_UNDEFINED;
  if (argc < 1) return JS_UNDEFINED;
  const char *payload = JS_ToCString(ctx, argv[0]);
  if (payload == NULL) return JS_UNDEFINED;

  JSValue out = JS_UNDEFINED;
  JNIEnv *env = NULL;
  int attached = 0;
  if ((*g_vm)->GetEnv(g_vm, (void **)&env, JNI_VERSION_1_6) != JNI_OK) {
    if ((*g_vm)->AttachCurrentThread(g_vm, (void **)&env, NULL) == JNI_OK) attached = 1;
  }
  if (env != NULL) {
    jstring js = (*env)->NewStringUTF(env, payload);
    if (js != NULL) {
      if (has_ret) {
        jstring ret = (jstring)(*env)->CallObjectMethod(env, g_host_obj, mid, js);
        if ((*env)->ExceptionCheck(env)) {
          // ★异常不吞：转成 JS 异常抛出（否则 JS 侧拿到 undefined 而**以为宿主没实现**，
          //   真因被掩盖——本仓纪律「静默失败最致命」）
          (*env)->ExceptionDescribe(env);
          (*env)->ExceptionClear(env);
          JS_FreeCString(ctx, payload);
          (*env)->DeleteLocalRef(env, js);
          if (attached) (*g_vm)->DetachCurrentThread(g_vm);
          return JS_ThrowInternalError(ctx, "宿主回调抛出异常（见 logcat: %s）", "ProteusJS");
        }
        if (ret != NULL) {
          const char *rs = (*env)->GetStringUTFChars(env, ret, NULL);
          out = JS_NewString(ctx, rs != NULL ? rs : "");
          if (rs != NULL) (*env)->ReleaseStringUTFChars(env, ret, rs);
          (*env)->DeleteLocalRef(env, ret);
        }
      } else {
        (*env)->CallVoidMethod(env, g_host_obj, mid, js);
        if ((*env)->ExceptionCheck(env)) (*env)->ExceptionDescribe(env), (*env)->ExceptionClear(env);
      }
      (*env)->DeleteLocalRef(env, js);
    }
  }
  if (attached) (*g_vm)->DetachCurrentThread(g_vm);
  JS_FreeCString(ctx, payload);
  return out;
}

/** `proteusHost.post(json)` 的 C 实现——转调 Java 侧回调（无返回值） */
static JSValue js_host_post(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  if (g_host_methods.post == NULL) {
    // ★无宿主回调时不静默丢弃：打到 log（可观测——本仓纪律「静默失败最致命」）
    if (argc >= 1) {
      const char *p = JS_ToCString(ctx, argv[0]);
      if (p != NULL) { LOGI("proteusHost.post（无回调，仅记录）: %.200s", p); JS_FreeCString(ctx, p); }
    }
    return JS_UNDEFINED;
  }
  return host_call_impl(ctx, g_host_methods.post, 0, this_val, argc, argv);
}

/**
 * 无参宿主调用的公共实现（`proteusHost.memUsage()` / `proteusHost.gc()`）。
 *
 * 【为什么单列（不能复用 host_call_impl）】那个实现以「第一个参数是 payload 字符串」为前提
 *   （`JS_ToCString(argv[0])`）⇒ 无参调用会直接 `argc<1` 返回 undefined（**静默**）。
 *   两个入口的签名不同 ⇒ 分开实现，各自明确（本仓教训：形似而同名语义不同最危险）。
 */
static JSValue host_call_noarg_impl(JSContext *ctx, jmethodID mid, int has_ret) {
  if (mid == NULL || g_host_obj == NULL || g_vm == NULL) return JS_UNDEFINED;
  JSValue out = JS_UNDEFINED;
  JNIEnv *env = NULL;
  int attached = 0;
  if ((*g_vm)->GetEnv(g_vm, (void **)&env, JNI_VERSION_1_6) != JNI_OK) {
    if ((*g_vm)->AttachCurrentThread(g_vm, (void **)&env, NULL) == JNI_OK) attached = 1;
  }
  if (env != NULL) {
    if (has_ret) {
      jstring ret = (jstring)(*env)->CallObjectMethod(env, g_host_obj, mid);
      if ((*env)->ExceptionCheck(env)) {
        (*env)->ExceptionDescribe(env);
        (*env)->ExceptionClear(env);
        if (attached) (*g_vm)->DetachCurrentThread(g_vm);
        return JS_ThrowInternalError(ctx, "宿主回调抛出异常（无参调用，见 logcat）");
      }
      if (ret != NULL) {
        const char *rs = (*env)->GetStringUTFChars(env, ret, NULL);
        out = JS_NewString(ctx, rs != NULL ? rs : "");
        if (rs != NULL) (*env)->ReleaseStringUTFChars(env, ret, rs);
        (*env)->DeleteLocalRef(env, ret);
      }
    } else {
      (*env)->CallVoidMethod(env, g_host_obj, mid);
      if ((*env)->ExceptionCheck(env)) (*env)->ExceptionDescribe(env), (*env)->ExceptionClear(env);
    }
  }
  if (attached) (*g_vm)->DetachCurrentThread(g_vm);
  return out;
}

/**
 * `proteusHost.invoke(method, argsJson)` —— ★★App 端原生能力通道（真实 Java 实现）。
 *
 * 【为什么两个参数、返回字符串】与 Java 侧 `HostCapabilities.invoke(String, String): String` 一一对应；
 *   同步调用（G-39 同线程契约）——壳内完成，不在别的线程回调。
 * 【未实现的方法】Java 侧**抛 UnsupportedOperationException** ⇒ 本函数转成 JS 异常
 *   （见 host_call_impl 的异常处理）⇒ 桥侧识别为 missing ⇒ `*.unsupported`（诚实分档）。
 */
static JSValue js_host_invoke(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  (void)this_val;
  if (g_host_methods.invoke == NULL || g_host_obj == NULL || g_vm == NULL) {
    return JS_ThrowInternalError(ctx, "宿主未实现 invoke（App 能力通道不可用）");
  }
  if (argc < 1) return JS_ThrowTypeError(ctx, "proteusHost.invoke 需要 (method, argsJson)");
  const char *method = JS_ToCString(ctx, argv[0]);
  if (method == NULL) return JS_ThrowTypeError(ctx, "invoke: method 转码失败");
  const char *args = argc >= 2 ? JS_ToCString(ctx, argv[1]) : NULL;

  JSValue out = JS_UNDEFINED;
  JNIEnv *env = NULL;
  int attached = 0;
  if ((*g_vm)->GetEnv(g_vm, (void **)&env, JNI_VERSION_1_6) != JNI_OK) {
    if ((*g_vm)->AttachCurrentThread(g_vm, (void **)&env, NULL) == JNI_OK) attached = 1;
  }
  if (env != NULL) {
    jstring jm = (*env)->NewStringUTF(env, method);
    jstring ja = (*env)->NewStringUTF(env, args != NULL ? args : "{}");
    jstring ret = (jstring)(*env)->CallObjectMethod(env, g_host_obj, g_host_methods.invoke, jm, ja);
    if ((*env)->ExceptionCheck(env)) {
      // ★异常不吞：转成 JS 异常抛出（Java 侧 UnsupportedOperationException ⇒ 桥识别 missing）
      jthrowable exc = (*env)->ExceptionOccurred(env);
      (*env)->ExceptionClear(env);
      jclass excCls = (*env)->GetObjectClass(env, exc);
      jmethodID getMsg = (*env)->GetMethodID(env, excCls, "getMessage", "()Ljava/lang/String;");
      jstring jmsg = getMsg != NULL ? (jstring)(*env)->CallObjectMethod(env, exc, getMsg) : NULL;
      const char *cmsg = jmsg != NULL ? (*env)->GetStringUTFChars(env, jmsg, NULL) : NULL;
      const char *full = cmsg != NULL ? cmsg : "宿主抛异常";
      if (attached) (*g_vm)->DetachCurrentThread(g_vm);
      if (jm != NULL) (*env)->DeleteLocalRef(env, jm);
      if (ja != NULL) (*env)->DeleteLocalRef(env, ja);
      if (jmsg != NULL && cmsg != NULL) (*env)->ReleaseStringUTFChars(env, jmsg, cmsg);
      if (jmsg != NULL) (*env)->DeleteLocalRef(env, jmsg);
      if (excCls != NULL) (*env)->DeleteLocalRef(env, excCls);
      if (exc != NULL) (*env)->DeleteLocalRef(env, exc);
      JS_FreeCString(ctx, method);
      if (args != NULL) JS_FreeCString(ctx, args);
      // ★消息前缀标记：桥侧按 'unsupported|missing|not implemented' 识别"无此能力"
      return JS_ThrowInternalError(ctx, "host-invoke: %s", full);
    }
    if (ret != NULL) {
      const char *rs = (*env)->GetStringUTFChars(env, ret, NULL);
      out = JS_NewString(ctx, rs != NULL ? rs : "{}");
      if (rs != NULL) (*env)->ReleaseStringUTFChars(env, ret, rs);
      (*env)->DeleteLocalRef(env, ret);
    }
    if (jm != NULL) (*env)->DeleteLocalRef(env, jm);
    if (ja != NULL) (*env)->DeleteLocalRef(env, ja);
  }
  if (attached) (*g_vm)->DetachCurrentThread(g_vm);
  JS_FreeCString(ctx, method);
  if (args != NULL) JS_FreeCString(ctx, args);
  return out;
}

/** `proteusHost.memUsage()` —— 引擎内存读数（返回 JSON 串；见 nativeMemoryUsage） */
static JSValue js_host_mem_usage(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  (void)this_val;
  (void)argc;
  (void)argv;
  return host_call_noarg_impl(ctx, g_host_methods.mem_usage, 1);
}

/** `proteusHost.gc()` —— 触发 GC（宿主"内存管理"主动回收入口） */
static JSValue js_host_gc(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  (void)this_val;
  (void)argc;
  (void)argv;
  return host_call_noarg_impl(ctx, g_host_methods.gc, 0);
}

/** `proteusHost.getScroll()` —— 读当前滚动偏移（返 double）；运行期用于"返回时恢复"。 */
static JSValue js_host_get_scroll(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  (void)this_val; (void)argc; (void)argv;
  jmethodID mid = g_host_methods.get_scroll;
  if (mid == NULL || g_host_obj == NULL || g_vm == NULL) return JS_NewFloat64(ctx, 0);
  JNIEnv *env = NULL; int attached = 0;
  if ((*g_vm)->GetEnv(g_vm, (void **)&env, JNI_VERSION_1_6) != JNI_OK) {
    if ((*g_vm)->AttachCurrentThread(g_vm, (void **)&env, NULL) == JNI_OK) attached = 1;
    else return JS_NewFloat64(ctx, 0);
  }
  double v = (*env)->CallDoubleMethod(env, g_host_obj, mid);
  if ((*env)->ExceptionCheck(env)) { (*env)->ExceptionClear(env); v = 0; }
  if (attached) (*g_vm)->DetachCurrentThread(g_vm);
  return JS_NewFloat64(ctx, v);
}

/** `proteusHost.setScroll(offset)` —— 设滚动偏移（前进=0 / 返回=该页上次的值）。 */
static JSValue js_host_set_scroll(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  (void)this_val;
  jmethodID mid = g_host_methods.set_scroll;
  if (mid == NULL || g_host_obj == NULL || g_vm == NULL || argc < 1) return JS_UNDEFINED;
  double off = 0; JS_ToFloat64(ctx, &off, argv[0]);
  JNIEnv *env = NULL; int attached = 0;
  if ((*g_vm)->GetEnv(g_vm, (void **)&env, JNI_VERSION_1_6) != JNI_OK) {
    if ((*g_vm)->AttachCurrentThread(g_vm, (void **)&env, NULL) == JNI_OK) attached = 1;
    else return JS_UNDEFINED;
  }
  (*env)->CallVoidMethod(env, g_host_obj, mid, off);
  if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
  if (attached) (*g_vm)->DetachCurrentThread(g_vm);
  return JS_UNDEFINED;
}

/** `proteusHost.mount(treeJson)` —— 首帧建树（**有返回**：Java 侧回执 JSON） */
static JSValue js_host_mount(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  return host_call_impl(ctx, g_host_methods.mount, 1, this_val, argc, argv);
}

/** `proteusHost.update(treeJson)` —— 结构变化整树重发（有返回） */
static JSValue js_host_update(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  return host_call_impl(ctx, g_host_methods.update, 1, this_val, argc, argv);
}

/** `proteusHost.updatePatches(patchesJson)` —— 样式/文本增量（有返回） */
static JSValue js_host_update_patches(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  return host_call_impl(ctx, g_host_methods.update_patches, 1, this_val, argc, argv);
}

/* ★★动画桥（2026-10-01 · 灯光秀）：JS 侧逐帧驱动内核动画——
 *   `animStart(json)` 起幕 / `animTick(dtMs)` 逐帧推进 / `animStop(json)` 停 / `animActive()` 查询。
 *   与 mount/update 同一条件注入（宿主未实现时这些属性不存在）。 */
static JSValue js_host_anim_start(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  return host_call_impl(ctx, g_host_methods.anim_start, 1, this_val, argc, argv);
}
/** `animTick(dtMs)`：数字入参经 JS_ToCString 转成字符串（"16.7"）再过桥——Java 侧解析 Double。 */
static JSValue js_host_anim_tick(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  return host_call_impl(ctx, g_host_methods.anim_tick, 1, this_val, argc, argv);
}
static JSValue js_host_anim_stop(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  return host_call_impl(ctx, g_host_methods.anim_stop, 1, this_val, argc, argv);
}
static JSValue js_host_anim_active(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  (void)this_val;
  (void)argc;
  (void)argv;
  return host_call_noarg_impl(ctx, g_host_methods.anim_active, 1);
}

/* ★★灯光秀计量/几何桥：nowUs()/rects()（无参返回）· probe(idsJson)（一参返回）· report(json)（一参无返回） */
static JSValue js_host_now_us(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  (void)this_val; (void)argc; (void)argv;
  return host_call_noarg_impl(ctx, g_host_methods.now_us, 1);
}
static JSValue js_host_rects(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  (void)this_val; (void)argc; (void)argv;
  return host_call_noarg_impl(ctx, g_host_methods.rects, 1);
}
static JSValue js_host_probe(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  return host_call_impl(ctx, g_host_methods.probe, 1, this_val, argc, argv);
}
static JSValue js_host_report(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  return host_call_impl(ctx, g_host_methods.report, 0, this_val, argc, argv);
}
/** ★★A3 播放控制：`proteusHost.animControl(json)`——时间因子 / 暂停（回显生效值） */
static JSValue js_host_anim_control(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  return host_call_impl(ctx, g_host_methods.anim_control, 1, this_val, argc, argv);
}

/**
 * `proteusHost.applyOps(bytesJson)` —— ★★★**二进制指令流**入口（Vapor 设备端）。
 * 入参是 `number[]`（0..255）的 JSON 串（QuickJS 侧无 ArrayBuffer 直传——与 iOS 同约定）。
 */
static JSValue js_host_apply_ops(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  return host_call_impl(ctx, g_host_methods.apply_ops, 1, this_val, argc, argv);
}

/**
 * `proteusHost.onGesture(cbName)` —— ★★**注册手势回调**（反向通道的注册端，JS 调）。
 * 记录函数名（≤127 字符）；宿主分发时按名查全局函数并调用。
 */
static JSValue js_host_on_gesture(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  (void)this_val;
  if (argc < 1 || !JS_IsString(argv[0])) {
    return JS_ThrowTypeError(ctx, "proteusHost.onGesture 需要 (cbName: string)");
  }
  const char *n = JS_ToCString(ctx, argv[0]);
  if (n == NULL) return JS_UNDEFINED;
  size_t len = strlen(n);
  if (len >= sizeof(g_gesture_cb)) {
    JS_FreeCString(ctx, n);
    return JS_ThrowRangeError(ctx, "回调名过长");
  }
  memcpy(g_gesture_cb, n, len + 1);
  JS_FreeCString(ctx, n);
  LOGI("反向通道就绪：手势回调已注册为 %s", g_gesture_cb);
  return JS_NewBool(ctx, 1);
}

/** `proteusHost.readRects()` —— **内核几何真源**读（判据用；不是从参数复述） */
static JSValue js_host_read_rects(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  (void)this_val; (void)argc; (void)argv;
  return host_call_noarg_impl(ctx, g_host_methods.read_rects, 1);
}

/** `proteusHost.textPolicy(idsJson)` —— ★★★B-T2：**文本策略回读**（whiteSpace/wordBreak/lineClamp；内核=SSOT） */
static JSValue js_host_text_policy(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  return host_call_impl(ctx, g_host_methods.text_policy, 1, this_val, argc, argv);
}

/** `proteusHost.mountVirtual(treeJson)` —— ★★★**虚拟化挂载**（长列表：整树在内核、只物化可见区） */
static JSValue js_host_mount_virtual(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  return host_call_impl(ctx, g_host_methods.mount_virtual, 1, this_val, argc, argv);
}

/** `proteusHost.scrollRows(argsJson)` —— 虚拟化滚动一帧（核心给决策、宿主执行动作） */
static JSValue js_host_scroll_rows(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  return host_call_impl(ctx, g_host_methods.scroll_rows, 1, this_val, argc, argv);
}

/** `proteusHost.probeChannels(idsJson)` —— ★★绘制通道探针（读宿主真源） */
static JSValue js_host_probe_channels(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  return host_call_impl(ctx, g_host_methods.probe_channels, 1, this_val, argc, argv);
}

/** `proteusHost.probeGesture()` —— 交互探针（手势真的到宿主了吗） */
static JSValue js_host_probe_gesture(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  (void)this_val; (void)argc; (void)argv;
  return host_call_noarg_impl(ctx, g_host_methods.probe_gesture, 1);
}

/** `proteusHost.tapAt({x,y})` —— 进程内注入一次 tap（判据驱动） */
static JSValue js_host_tap_at(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  return host_call_impl(ctx, g_host_methods.tap_at, 1, this_val, argc, argv);
}

/** 组装 JSON 字符串结果（转义 `"` `\` 与换行；最小实现，不引第三方） */
static char *json_escape_alloc(const char *s) {
  if (s == NULL) return strdup("\"\"");
  size_t n = strlen(s);
  // 最坏情形：每个字符都需转义 + 引号 + NUL
  char *out = (char *)malloc(n * 2 + 3);
  if (out == NULL) return NULL;
  size_t o = 0;
  out[o++] = '"';
  for (size_t i = 0; i < n; i++) {
    unsigned char c = (unsigned char)s[i];
    switch (c) {
      case '"': out[o++] = '\\'; out[o++] = '"'; break;
      case '\\': out[o++] = '\\'; out[o++] = '\\'; break;
      case '\n': out[o++] = '\\'; out[o++] = 'n'; break;
      case '\r': out[o++] = '\\'; out[o++] = 'r'; break;
      case '\t': out[o++] = '\\'; out[o++] = 't'; break;
      default:
        if (c < 0x20) { o += (size_t)sprintf(out + o, "\\u%04x", c); }
        else out[o++] = (char)c;
    }
  }
  out[o++] = '"';
  out[o] = '\0';
  return out;
}

/**
 * 执行 JS 源码。返回 JSON：
 *   `{"ok":true,"value":"<结果字符串化>","ms":<耗时>}`
 *   `{"ok":false,"error":"<消息>","ms":<耗时>}`
 */
static jstring eval_impl(JNIEnv *env, jstring source, jboolean with_host) {
  if (ensure_ctx() != 0) {
    return (*env)->NewStringUTF(env, "{\"ok\":false,\"error\":\"运行时初始化失败\"}");
  }
  const char *src = (*env)->GetStringUTFChars(env, source, NULL);
  if (src == NULL) {
    return (*env)->NewStringUTF(env, "{\"ok\":false,\"error\":\"源码转码失败\"}");
  }

  // ★注入宿主桩（仅 with_host 时）——`proteusHost.post(json)` → Java 回调
  //   ★★S5：`mount`/`update`/`updatePatches` **按 Java 侧是否实现条件注入**
  //   （见 g_host_methods 注释：无条件注入会让 JS 侧的"宿主能否消费批次"判定失效）
  if (with_host) {
    JSValue global = JS_GetGlobalObject(g_ctx);
    JSValue host = JS_NewObject(g_ctx);
    JS_SetPropertyStr(g_ctx, host, "post", JS_NewCFunction(g_ctx, js_host_post, "post", 1));
    if (g_host_methods.mount != NULL) {
      JS_SetPropertyStr(g_ctx, host, "mount", JS_NewCFunction(g_ctx, js_host_mount, "mount", 1));
      JS_SetPropertyStr(g_ctx, host, "update", JS_NewCFunction(g_ctx, js_host_update, "update", 1));
      JS_SetPropertyStr(g_ctx, host, "updatePatches",
                        JS_NewCFunction(g_ctx, js_host_update_patches, "updatePatches", 1));
      LOGI("宿主已实现 mount/update/updatePatches ⇒ JS 侧走**真机消费**路径");
    } else {
      LOGI("宿主仅实现 post ⇒ JS 侧走本地桩（适配器→宿主入口 链路验证）");
    }
    // ★★App 端原生能力通道（按 Java 侧是否实现条件注入——同 mount 原则）
    if (g_host_methods.invoke != NULL) {
      JS_SetPropertyStr(g_ctx, host, "invoke", JS_NewCFunction(g_ctx, js_host_invoke, "invoke", 2));
      LOGI("宿主已实现 invoke ⇒ JS 侧可调 App 原生能力（update/window/worker/idle/preload…）");
    }
    // ★★灯光秀计量/几何桥（条件注入——同 mount 原则）
    if (g_host_methods.now_us != NULL) {
      JS_SetPropertyStr(g_ctx, host, "nowUs", JS_NewCFunction(g_ctx, js_host_now_us, "nowUs", 0));
    }
    if (g_host_methods.rects != NULL) {
      JS_SetPropertyStr(g_ctx, host, "rects", JS_NewCFunction(g_ctx, js_host_rects, "rects", 0));
    }
    if (g_host_methods.probe != NULL) {
      JS_SetPropertyStr(g_ctx, host, "probe", JS_NewCFunction(g_ctx, js_host_probe, "probe", 1));
    }
    if (g_host_methods.report != NULL) {
      JS_SetPropertyStr(g_ctx, host, "report", JS_NewCFunction(g_ctx, js_host_report, "report", 1));
    }
    // ★★A3 播放控制（条件注入——同 mount 原则）
    if (g_host_methods.anim_control != NULL) {
      JS_SetPropertyStr(g_ctx, host, "animControl", JS_NewCFunction(g_ctx, js_host_anim_control, "animControl", 1));
    }
    // ★★★Vapor 设备端（条件注入——同 mount 原则）：二进制指令流 + 内核几何真源
    if (g_host_methods.apply_ops != NULL) {
      JS_SetPropertyStr(g_ctx, host, "applyOps", JS_NewCFunction(g_ctx, js_host_apply_ops, "applyOps", 1));
      LOGI("宿主已实现 applyOps ⇒ JS 侧可发**二进制指令流**（订阅驱动增量）");
    }
    if (g_host_methods.read_rects != NULL) {
      JS_SetPropertyStr(g_ctx, host, "readRects", JS_NewCFunction(g_ctx, js_host_read_rects, "readRects", 0));
    }
    // ★★★B-T2（条件注入——同 mount 原则）：文本策略回读
    if (g_host_methods.text_policy != NULL) {
      JS_SetPropertyStr(g_ctx, host, "textPolicy", JS_NewCFunction(g_ctx, js_host_text_policy, "textPolicy", 1));
    }
    // ★★★长列表虚拟化（条件注入——同 mount 原则）
    if (g_host_methods.mount_virtual != NULL) {
      JS_SetPropertyStr(g_ctx, host, "mountVirtual", JS_NewCFunction(g_ctx, js_host_mount_virtual, "mountVirtual", 1));
      LOGI("宿主已实现 mountVirtual ⇒ JS 侧可跑**虚拟化**（整树在内核、只物化可见区）");
    }
    if (g_host_methods.scroll_rows != NULL) {
      JS_SetPropertyStr(g_ctx, host, "scrollRows", JS_NewCFunction(g_ctx, js_host_scroll_rows, "scrollRows", 1));
    }
    if (g_host_methods.probe_channels != NULL) {
      JS_SetPropertyStr(g_ctx, host, "probeChannels", JS_NewCFunction(g_ctx, js_host_probe_channels, "probeChannels", 1));
    }
    // ★★交互闭环（条件注入——同 mount 原则）：手势探针 + 进程内 tap
    if (g_host_methods.probe_gesture != NULL) {
      JS_SetPropertyStr(g_ctx, host, "probeGesture", JS_NewCFunction(g_ctx, js_host_probe_gesture, "probeGesture", 0));
    }
    if (g_host_methods.tap_at != NULL) {
      JS_SetPropertyStr(g_ctx, host, "tapAt", JS_NewCFunction(g_ctx, js_host_tap_at, "tapAt", 1));
      if (g_host_methods.get_scroll != NULL)
        JS_SetPropertyStr(g_ctx, host, "getScroll", JS_NewCFunction(g_ctx, js_host_get_scroll, "getScroll", 0));
      if (g_host_methods.set_scroll != NULL)
        JS_SetPropertyStr(g_ctx, host, "setScroll", JS_NewCFunction(g_ctx, js_host_set_scroll, "setScroll", 1));
      LOGI("宿主已实现 tapAt ⇒ JS 侧可在进程内注入真触摸（交互闭环判据）");
    }
    // ★★★反向通道注册端（交互闭环）：无条件注入（它只写一个全局名，不需要宿主实现什么）
    JS_SetPropertyStr(g_ctx, host, "onGesture", JS_NewCFunction(g_ctx, js_host_on_gesture, "onGesture", 1));
    // ★★动画桥（条件注入——同 mount 原则；灯光秀的 JS 侧驱动依赖它）
    if (g_host_methods.anim_start != NULL && g_host_methods.anim_tick != NULL) {
      JS_SetPropertyStr(g_ctx, host, "animStart", JS_NewCFunction(g_ctx, js_host_anim_start, "animStart", 1));
      JS_SetPropertyStr(g_ctx, host, "animTick", JS_NewCFunction(g_ctx, js_host_anim_tick, "animTick", 1));
      if (g_host_methods.anim_stop != NULL) {
        JS_SetPropertyStr(g_ctx, host, "animStop", JS_NewCFunction(g_ctx, js_host_anim_stop, "animStop", 1));
      }
      if (g_host_methods.anim_active != NULL) {
        JS_SetPropertyStr(g_ctx, host, "animActive", JS_NewCFunction(g_ctx, js_host_anim_active, "animActive", 0));
      }
      LOGI("宿主已实现动画桥 ⇒ JS 侧可驱动内核动画（animStart/animTick/animStop/animActive）");
    }
    // ★★G-39：内存账本两入口（按 Java 侧是否实现条件注入——同 mount 的条件注入原则）
    if (g_host_methods.mem_usage != NULL) {
      JS_SetPropertyStr(g_ctx, host, "memUsage", JS_NewCFunction(g_ctx, js_host_mem_usage, "memUsage", 0));
    }
    if (g_host_methods.gc != NULL) {
      JS_SetPropertyStr(g_ctx, host, "gc", JS_NewCFunction(g_ctx, js_host_gc, "gc", 0));
    }
    JS_SetPropertyStr(g_ctx, global, "proteusHost", host);
    JS_FreeValue(g_ctx, global);
  }

  // ★用 JS_Eval 的 GLOBAL 语义（src 作为全局脚本执行——与 IIFE bundle 的形态一致）
  JSValue v = JS_Eval(g_ctx, src, strlen(src), "<proteus-eval>", JS_EVAL_TYPE_GLOBAL);
  (*env)->ReleaseStringUTFChars(env, source, src);

  // ★★G-39：eval 后**泵掉挂起 job**（await / Promise 续体）。
  //   此前不泵 ⇒ 任何 await 代码在设备上"半执行"（同步段跑了、续体静默丢失）——本轮取证发现的实缺。
  //   泵在结果判定**之前**：续体可能抛错（未捕获 rejection）⇒ 一并走下方异常分支（不静默）。
  int jobs = pump_jobs_bounded();

  char *result = NULL;
  if (JS_IsException(v)) {
    JSValue exc = JS_GetException(g_ctx);
    const char *msg = js_to_utf8(g_ctx, exc);
    char *esc = json_escape_alloc(msg != NULL ? msg : "（无消息）");
    size_t need = strlen(esc) + 64;
    result = (char *)malloc(need);
    snprintf(result, need, "{\"ok\":false,\"error\":%s}", esc);
    free(esc);
    if (msg != NULL) JS_FreeCString(g_ctx, msg);
    JS_FreeValue(g_ctx, exc);
    LOGE("JS 执行异常: %.200s", result);
  } else {
    const char *s = js_to_utf8(g_ctx, v);
    char *esc = json_escape_alloc(s);
    size_t need = strlen(esc) + 96;
    result = (char *)malloc(need);
    // ★`jobs` 读数随结果返回（诊断：await 稳定性——0 = 无续体，>0 = 事件循环确实推进过）
    snprintf(result, need, "{\"ok\":true,\"value\":%s,\"jobs\":%d}", esc, jobs);
    free(esc);
    if (s != NULL) JS_FreeCString(g_ctx, s);
    JS_FreeValue(g_ctx, v);
  }

  jstring out = (*env)->NewStringUTF(env, result != NULL ? result : "{\"ok\":false,\"error\":\"内部错误\"}");
  free(result);
  return out;
}

/* ────────────────────────── JNI 导出（与 Java 侧 QuickJsEngine 一一对应） ────────────────────────── */

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *reserved) {
  g_vm = vm;
  (void)reserved;
  return JNI_VERSION_1_6;
}

JNIEXPORT jstring JNICALL
Java_dev_proteus_layoutcore_QuickJsEngine_nativeEval(JNIEnv *env, jclass cls, jstring source) {
  (void)cls;
  return eval_impl(env, source, JNI_FALSE);
}

JNIEXPORT jstring JNICALL
Java_dev_proteus_layoutcore_QuickJsEngine_nativeEvalWithHost(JNIEnv *env, jclass cls, jstring source) {
  (void)cls;
  return eval_impl(env, source, JNI_TRUE);
}

JNIEXPORT void JNICALL
Java_dev_proteus_layoutcore_QuickJsEngine_nativeSetHostCallback(JNIEnv *env, jclass cls, jobject obj) {
  (void)cls;
  if (g_host_obj != NULL) {
    (*env)->DeleteGlobalRef(env, g_host_obj);
    g_host_obj = NULL;
  }
  g_host_methods.post = g_host_methods.mount = g_host_methods.update = g_host_methods.update_patches = NULL;
  g_host_methods.mem_usage = g_host_methods.gc = NULL;
  g_host_methods.invoke = NULL;
  g_host_methods.anim_start = g_host_methods.anim_tick = g_host_methods.anim_stop = g_host_methods.anim_active = NULL;
  g_host_methods.now_us = g_host_methods.rects = g_host_methods.probe = g_host_methods.report = NULL;
  g_host_methods.anim_control = NULL;
  g_host_methods.apply_ops = g_host_methods.read_rects = NULL;
  g_host_methods.text_policy = NULL;
  g_host_methods.mount_virtual = g_host_methods.scroll_rows = NULL;
  g_host_methods.probe_channels = NULL;
  g_host_methods.probe_gesture = g_host_methods.tap_at = NULL;
  if (obj != NULL) {
    g_host_obj = (*env)->NewGlobalRef(env, obj);
    jclass c = (*env)->GetObjectClass(env, obj);
    // ★逐一探测（查不到 = 该入口未实现 ⇒ 保持 NULL ⇒ 不注入；并清掉查找抛的异常）
    g_host_methods.post = (*env)->GetMethodID(env, c, "post", "(Ljava/lang/String;)V");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    g_host_methods.mount = (*env)->GetMethodID(env, c, "mount", "(Ljava/lang/String;)Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    g_host_methods.update = (*env)->GetMethodID(env, c, "update", "(Ljava/lang/String;)Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    g_host_methods.update_patches = (*env)->GetMethodID(env, c, "updatePatches", "(Ljava/lang/String;)Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    // ★★G-39：内存账本两入口（无参签名——与上面四个不同，各自探测）
    g_host_methods.mem_usage = (*env)->GetMethodID(env, c, "memUsage", "()Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    g_host_methods.gc = (*env)->GetMethodID(env, c, "gc", "()V");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    /* ★★App 端原生能力通道（两参：method + argsJson；返回 String） */
    g_host_methods.invoke = (*env)->GetMethodID(env, c, "invoke", "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    /* ★★动画桥（灯光秀）：animStart/animTick/animStop 为 (String)->String；animActive 为 ()->String */
    g_host_methods.anim_start = (*env)->GetMethodID(env, c, "animStart", "(Ljava/lang/String;)Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    g_host_methods.anim_tick = (*env)->GetMethodID(env, c, "animTick", "(Ljava/lang/String;)Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    g_host_methods.anim_stop = (*env)->GetMethodID(env, c, "animStop", "(Ljava/lang/String;)Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    g_host_methods.anim_active = (*env)->GetMethodID(env, c, "animActive", "()Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    /* ★★灯光秀计量/几何桥（nowUs/rects 无参返回串；probe 一参返回串；report 一参无返回） */
    g_host_methods.now_us = (*env)->GetMethodID(env, c, "nowUs", "()Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    g_host_methods.rects = (*env)->GetMethodID(env, c, "rects", "()Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    g_host_methods.probe = (*env)->GetMethodID(env, c, "probe", "(Ljava/lang/String;)Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    g_host_methods.report = (*env)->GetMethodID(env, c, "report", "(Ljava/lang/String;)V");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    /* ★★A3 播放控制（一参：json；返回 String） */
    g_host_methods.anim_control = (*env)->GetMethodID(env, c, "animControl", "(Ljava/lang/String;)Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    /* ★★★Vapor 设备端（applyOps 一参返回串；readRects 无参返回串） */
    g_host_methods.apply_ops = (*env)->GetMethodID(env, c, "applyOps", "(Ljava/lang/String;)Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    g_host_methods.read_rects = (*env)->GetMethodID(env, c, "readRects", "()Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    /* ★★★B-T2：文本策略回读（一参返回串） */
    g_host_methods.text_policy = (*env)->GetMethodID(env, c, "textPolicy", "(Ljava/lang/String;)Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    /* ★★★长列表虚拟化（各一参返回串） */
    g_host_methods.mount_virtual = (*env)->GetMethodID(env, c, "mountVirtual", "(Ljava/lang/String;)Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    g_host_methods.scroll_rows = (*env)->GetMethodID(env, c, "scrollRows", "(Ljava/lang/String;)Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    g_host_methods.probe_channels = (*env)->GetMethodID(env, c, "probeChannels", "(Ljava/lang/String;)Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    /* ★★交互闭环：probeGesture 无参返串；tapAt 一参返串 */
    g_host_methods.probe_gesture = (*env)->GetMethodID(env, c, "probeGesture", "()Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    g_host_methods.tap_at = (*env)->GetMethodID(env, c, "tapAt", "(Ljava/lang/String;)Ljava/lang/String;");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    /* ★B1：每屏滚动进度记忆（getScroll/setScroll）——运行期宿主桥暴露时才有 */
    g_host_methods.get_scroll = (*env)->GetMethodID(env, c, "getScroll", "()D");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    g_host_methods.set_scroll = (*env)->GetMethodID(env, c, "setScroll", "(D)V");
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    if (g_host_methods.post == NULL) {
      LOGE("宿主回调缺少 post(String) 方法（其余入口仍按各自实现条件注入）");
    }
  }
}

/**
 * ★★★重置引擎上下文（新 Activity 启动前调）：释放持久上下文/运行时 ⇒ 下次 eval 重建**全新**上下文。
 *
 * 【为什么必须有（用户 2026-10-08「安卓有时点开应用直接空白，杀后台重开正常」）】
 *   本桥的 `g_ctx/g_rt` 是**进程级 static**（跨 Activity 实例存活）。旧实例的 JS 全局态
 *   （路由栈 / 当前屏 / 屏实例）**不随 Activity 销毁而清** —— 新实例 `boot()` 在同一**脏上下文中**
 *   再 `eval` bundle + `bootSuperapp` ⇒ 路由/启动判定异常 ⇒ **空白**；**杀进程（清 static）即恢复**
 *   （与用户观察完全一致）。⇒ 每个 Activity 启动前显式重置 = **每次全新上下文**
 *   （与 iOS 的"每 Activity 新 JSContext"对齐）。
 *
 * 【为什么也清 guest 回调名】`g_gesture_cb` 指向旧上下文里的全局函数 —— 重置后必须失效。
 * 【不 DeleteGlobalRef 宿主对象】紧接的 `nativeSetHostCallback` 会替换它（重置后旧对象已无引用路径）。
 */
JNIEXPORT void JNICALL
Java_dev_proteus_layoutcore_QuickJsEngine_nativeResetEngine(JNIEnv *env, jclass cls) {
  (void)env; (void)cls;
  if (g_ctx != NULL) { JS_FreeContext(g_ctx); g_ctx = NULL; }
  if (g_rt != NULL) { JS_FreeRuntime(g_rt); g_rt = NULL; }
  g_gesture_cb[0] = '\0';
}

/** 引擎版本（诊断：确认 .so 真的加载了 QuickJS） */
JNIEXPORT jstring JNICALL
Java_dev_proteus_layoutcore_QuickJsEngine_nativeVersion(JNIEnv *env, jclass cls) {
  (void)cls;
  JSRuntime *rt = JS_NewRuntime();
  if (rt == NULL) return (*env)->NewStringUTF(env, "quickjs:unknown");
  JSContext *ctx = JS_NewContext(rt);
  const char *v = ctx != NULL ? JS_ToCString(ctx, JS_NewString(ctx, "")) : NULL;
  (void)v;
  jstring out = (*env)->NewStringUTF(env, "quickjs:2026-06-04");
  if (ctx != NULL) JS_FreeContext(ctx);
  JS_FreeRuntime(rt);
  return out;
}

/**
 * ★★G-39：**挂起 job 泵**（事件循环归属的落地）。
 *
 * 【为什么必须有（本轮取证发现的真实缺口）】QuickJS 的 `await` / Promise 续体不进「待执行 job 队列」
 *   就永远不会跑——此前本桥 eval 完**从不调 `JS_ExecutePendingJob`**
 *   ⇒ 任何 `await`/`.then()` 的 JS 代码在设备上都是**半执行**（同步段跑了，续体静默丢失）。
 *   G-39 说「事件循环由运行时的唯一拥有者管」——本函数就是这条所有权在 QuickJS 宿主上的落点：
 *   **只有 runtime（宿主壳）能推进 job 队列**，JS 自己无法让续体跑起来。
 *
 * 【为什么限次】恶意的/错误的 promise 链可能无限自续（每次续体又建新 promise）
 *   ⇒ 上限 `PROTEUS_MAX_JOBS_PER_PUMP`（10000）防死循环拖死宿主（诚实截断，返回实际执行数）。
 */
#define PROTEUS_MAX_JOBS_PER_PUMP 10000
static int pump_jobs_bounded(void) {
  if (g_rt == NULL) return 0;
  int n = 0;
  JSContext *c1 = NULL;
  while (n < PROTEUS_MAX_JOBS_PER_PUMP && JS_ExecutePendingJob(g_rt, &c1) > 0) n++;
  return n;
}

/** 泵掉全部可跑 job（含 eval 之后的续体）——返回执行数；未初始化 -1 */
/**
 * ★★★**分发手势到 JS**（Java 调；反向通道的分发端）——`nativeDispatchGesture(type, nodeId, chainJson)`。
 *
 * 出参：JS 回调的返回串（宿主记账用）；未注册 / 异常 ⇒ `{"ok":false,"reason":…}`。
 * ★**必须在同一线程调用**（QuickJS 非线程安全；宿主从主线程的 GestureListener 调）。
 *
 * 【为什么带 chain（2026-10-02 · 冒泡链批次）】内核 `bubble_chain` 早就算好了
 *   「target 自身 + 全部祖先（自深到浅）」——宿主 `GestureListener` 也拿到了，
 *   但本函数此前只把 `(type, nodeId)` 递给 JS ⇒ **冒泡链在最后一环被丢掉**：
 *   A/B 两路都只能对 target 本身派发，"祖先 handler"永不触发（本仓的静默丢件同族）。
 *   ⇒ 第三个参数 `chain_json`（如 `"[10,9,0]"`）原样转给 JS 回调；调用方保证非 NULL。
 */
JNIEXPORT jstring JNICALL
Java_dev_proteus_layoutcore_QuickJsEngine_nativeDispatchGesture(JNIEnv *env, jclass cls,
                                                                jstring type, jint node_id,
                                                                jstring chain_json) {
  (void)cls;
  if (g_ctx == NULL) return (*env)->NewStringUTF(env, "{\"ok\":false,\"reason\":\"ctx 未就绪\"}");
  if (g_gesture_cb[0] == 0) return (*env)->NewStringUTF(env, "{\"ok\":false,\"reason\":\"未注册回调\"}");
  const char *t = (*env)->GetStringUTFChars(env, type, NULL);
  if (t == NULL) return (*env)->NewStringUTF(env, "{\"ok\":false,\"reason\":\"type 转码失败\"}");
  const char *cj = (*env)->GetStringUTFChars(env, chain_json, NULL);
  if (cj == NULL) {
    (*env)->ReleaseStringUTFChars(env, type, t);
    return (*env)->NewStringUTF(env, "{\"ok\":false,\"reason\":\"chain 转码失败\"}");
  }
  JSValue global = JS_GetGlobalObject(g_ctx);
  JSValue fn = JS_GetPropertyStr(g_ctx, global, g_gesture_cb);
  JSValue out = JS_UNDEFINED;
  if (JS_IsFunction(g_ctx, fn)) {
    JSValue args[3] = {JS_NewString(g_ctx, t), JS_NewInt32(g_ctx, node_id), JS_NewString(g_ctx, cj)};
    out = JS_Call(g_ctx, fn, global, 3, args);
    JS_FreeValue(g_ctx, args[0]);
    JS_FreeValue(g_ctx, args[1]);
    JS_FreeValue(g_ctx, args[2]);
    if (JS_IsException(out)) {
      JSValue exc = JS_GetException(g_ctx);
      const char *em = JS_ToCString(g_ctx, exc);
      LOGE("手势回调抛异常：%s", em ? em : "?");
      JS_FreeCString(g_ctx, em);
      JS_FreeValue(g_ctx, exc);
      JS_FreeValue(g_ctx, out);
      out = JS_UNDEFINED;
    }
  }
  // 泵掉回调里产生的微任务（宿主侧同步执行语义——与 eval 后同一纪律）
  pump_jobs_bounded();
  jstring ret;
  if (JS_IsString(out)) {
    const char *r = JS_ToCString(g_ctx, out);
    ret = (*env)->NewStringUTF(env, r ? r : "{\"ok\":false,\"reason\":\"空返回\"}");
    JS_FreeCString(g_ctx, r);
  } else {
    ret = (*env)->NewStringUTF(env, "{\"ok\":true,\"reason\":\"回调已调用（无返回串）\"}");
  }
  JS_FreeValue(g_ctx, out);
  JS_FreeValue(g_ctx, fn);
  JS_FreeValue(g_ctx, global);
  (*env)->ReleaseStringUTFChars(env, chain_json, cj);
  (*env)->ReleaseStringUTFChars(env, type, t);
  return ret;
}

JNIEXPORT jint JNICALL
Java_dev_proteus_layoutcore_QuickJsEngine_nativeRunPendingJobs(JNIEnv *env, jclass cls) {
  (void)env;
  (void)cls;
  if (ensure_ctx() != 0) return -1;
  return pump_jobs_bounded();
}

/** 是否还有挂起 job（诊断：await 未完成 = 还有 pending） */
JNIEXPORT jboolean JNICALL
Java_dev_proteus_layoutcore_QuickJsEngine_nativeHasPendingJobs(JNIEnv *env, jclass cls) {
  (void)env;
  (void)cls;
  if (g_rt == NULL) return JNI_FALSE;
  return JS_IsJobPending(g_rt) ? JNI_TRUE : JNI_FALSE;
}

/**
 * ★★G-39/G-43：**引擎内存读数**（真实 JS 堆，不是宿主 PSS 估算）。
 *
 * 【为什么需要（"内存管理"要有账本）】G-43 所有权模型是 TS 侧承诺；端上验证需要
 *   **引擎自己的内存读数**：分配前后、GC 前后的差值就是"内存管理是否真的在起作用"的机器证据
 *   （`memory_used_size` / `malloc_size` / 对象数）。此前 Android 侧只有宿主 PSS（粗粒度、
 *   含 native/Java/图形 → 分不出 JS 堆变化）。
 */
JNIEXPORT jstring JNICALL
Java_dev_proteus_layoutcore_QuickJsEngine_nativeMemoryUsage(JNIEnv *env, jclass cls) {
  (void)cls;
  if (ensure_ctx() != 0) {
    return (*env)->NewStringUTF(env, "{\"ok\":false,\"error\":\"运行时初始化失败\"}");
  }
  JSMemoryUsage u;
  memset(&u, 0, sizeof(u));
  JS_ComputeMemoryUsage(g_rt, &u);
  char buf[768];
  snprintf(buf, sizeof(buf),
           "{\"ok\":true,\"malloc_size\":%lld,\"malloc_limit\":%lld,\"memory_used_size\":%lld,"
           "\"malloc_count\":%lld,\"obj_count\":%lld,\"str_count\":%lld,\"str_size\":%lld,"
           "\"js_func_count\":%lld,\"js_func_size\":%lld,\"js_func_code_size\":%lld,"
           "\"atom_count\":%lld,\"array_count\":%lld}",
           (long long)u.malloc_size, (long long)u.malloc_limit, (long long)u.memory_used_size,
           (long long)u.malloc_count, (long long)u.obj_count, (long long)u.str_count,
           (long long)u.str_size, (long long)u.js_func_count, (long long)u.js_func_size,
           (long long)u.js_func_code_size, (long long)u.atom_count, (long long)u.array_count);
  return (*env)->NewStringUTF(env, buf);
}

/** ★触发 GC（返回 0 成功；`JS_RunGC` 后内存读数应下降——GC 有效性的机器证据） */
JNIEXPORT jint JNICALL
Java_dev_proteus_layoutcore_QuickJsEngine_nativeRunGC(JNIEnv *env, jclass cls) {
  (void)env;
  (void)cls;
  if (ensure_ctx() != 0) return -1;
  JS_RunGC(g_rt);
  return 0;
}
