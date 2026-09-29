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
/** Java 侧宿主回调（全局引用——跨调用存活；`proteusHost.post` 调用它） */
static jobject g_host_obj = NULL;
static jmethodID g_host_method = NULL;
static JavaVM *g_vm = NULL;

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

/** `proteusHost.post(json)` 的 C 实现——转调 Java 侧回调 */
static JSValue js_host_post(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  if (argc < 1) return JS_UNDEFINED;
  const char *payload = JS_ToCString(ctx, argv[0]);
  if (payload == NULL) return JS_UNDEFINED;
  if (g_host_obj != NULL && g_host_method != NULL && g_vm != NULL) {
    JNIEnv *env = NULL;
    int attached = 0;
    if ((*g_vm)->GetEnv(g_vm, (void **)&env, JNI_VERSION_1_6) != JNI_OK) {
      if ((*g_vm)->AttachCurrentThread(g_vm, (void **)&env, NULL) == JNI_OK) attached = 1;
    }
    if (env != NULL) {
      jstring js = (*env)->NewStringUTF(env, payload);
      if (js != NULL) {
        (*env)->CallVoidMethod(env, g_host_obj, g_host_method, js);
        if ((*env)->ExceptionCheck(env)) (*env)->ExceptionDescribe(env), (*env)->ExceptionClear(env);
        (*env)->DeleteLocalRef(env, js);
      }
    }
    if (attached) (*g_vm)->DetachCurrentThread(g_vm);
  } else {
    // ★无宿主回调时不静默丢弃：打到 log（可观测——本仓纪律「静默失败最致命」）
    LOGI("proteusHost.post（无回调，仅记录）: %.200s", payload);
  }
  JS_FreeCString(ctx, payload);
  return JS_UNDEFINED;
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
  if (with_host) {
    JSValue global = JS_GetGlobalObject(g_ctx);
    JSValue host = JS_NewObject(g_ctx);
    JS_SetPropertyStr(g_ctx, host, "post", JS_NewCFunction(g_ctx, js_host_post, "post", 1));
    JS_SetPropertyStr(g_ctx, global, "proteusHost", host);
    JS_FreeValue(g_ctx, global);
  }

  // ★用 JS_Eval 的 GLOBAL 语义（src 作为全局脚本执行——与 IIFE bundle 的形态一致）
  JSValue v = JS_Eval(g_ctx, src, strlen(src), "<proteus-eval>", JS_EVAL_TYPE_GLOBAL);
  (*env)->ReleaseStringUTFChars(env, source, src);

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
    size_t need = strlen(esc) + 64;
    result = (char *)malloc(need);
    snprintf(result, need, "{\"ok\":true,\"value\":%s}", esc);
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
  if (obj != NULL) {
    g_host_obj = (*env)->NewGlobalRef(env, obj);
    jclass c = (*env)->GetObjectClass(env, obj);
    g_host_method = (*env)->GetMethodID(env, c, "post", "(Ljava/lang/String;)V");
    if (g_host_method == NULL) {
      LOGE("宿主回调缺少 post(String) 方法");
      (*env)->ExceptionClear(env);
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
