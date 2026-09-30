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
} g_host_methods = { NULL, NULL, NULL, NULL, NULL, NULL };

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
    if (g_host_methods.post == NULL) {
      LOGE("宿主回调缺少 post(String) 方法（其余入口仍按各自实现条件注入）");
    }
  }
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
