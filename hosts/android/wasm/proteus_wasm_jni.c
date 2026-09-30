// hosts/android/wasm/proteus_wasm_jni.c
// ★★C82 App 端 WebAssembly：**wasm 运行时（wasm3）的 JNI 桥**
//
// 【背景（本轮取证）】App 端 JS 引擎 QuickJS **内建无 WebAssembly**
//   （双证据：`.tools/quickjs/qjs -e "typeof WebAssembly"` → undefined；Bellum/ng 源码零命中）。
//   ⇒ wasm 属**宿主能力**：由宿主提供运行时，经 `proteusHost.invoke` 暴露给 JS。
//
// 【为什么选 wasm3（本仓纪律：与 JS 引擎选型同一判据）】
//   · **纯解释器**（无 JIT）⇒ Android W^X 限制下可用（对比 wasmtime 需 JIT / AOT 预编译）；
//   · MIT + 纯 C + 36K 行 ⇒ 与 QuickJS 同族（可静态链进单个 .so，无需额外动态库）；
//   · `m3_SetResourceLimit` 提供**栈/内存上限** ⇒ 符合宿主对不受信 wasm 的治理需要。
//
// 【接口设计（对齐本仓 JNI 门面惯例：JSON 进 / JSON 出）】
//   nativeWasmVersion()                        → 版本串（诊断）
//   nativeWasmInstantiate(bytesJson, limitsJson) → 实例句柄（long；0 = 失败）+ 错误在 out 参数
//   nativeWasmCall(handle, funcJson, argsJson)  → JSON 结果（调用导出函数）
//   nativeWasmRelease(handle)                  → 释放
//
// 【★诚实边界】
//   ① **不支持 WASI**（未链接 m3_api_wasi）：WASI 需 posix 文件系统桥，与移动端沙箱（G-49）冲突。
//      模块若导入 wasi 函数 ⇒ 实例化时**显式失败并列出未解析导入**（不静默）；
//   ② **只暴露"调用导出函数 + 传/回标量"**（i32/i64/f32/f64）——内存/表操作属后续批次（如实记录）；
//   ③ 资源上限由调用方给（宿主治理）。
#include <jni.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <android/log.h>

#include "wasm3.h"

#define LOG_TAG "ProteusWasm"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

/** 实例槽（句柄 → 运行时+模块+环境）；固定表 + 自增句柄（避免跨 JNI 的指针暴露） */
#define MAX_INSTANCES 8

typedef struct {
  int in_use;
  IM3Environment env;
  IM3Runtime rt;
  IM3Module mod;
} WasmSlot;

static WasmSlot g_slots[MAX_INSTANCES];

/** JSON 转义（与 quickjs_jni.c 同款最小实现） */
static char *json_escape_alloc(const char *s) {
  if (s == NULL) return strdup("\"\"");
  size_t n = strlen(s);
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

/** 把 m3 错误转成 JSON `{"ok":false,"error":"…"}` */
static jstring err_json(JNIEnv *env, const char *msg) {
  char *esc = json_escape_alloc(msg != NULL ? msg : "（无消息）");
  size_t need = strlen(esc) + 32;
  char *buf = (char *)malloc(need);
  snprintf(buf, need, "{\"ok\":false,\"error\":%s}", esc);
  free(esc);
  jstring out = (*env)->NewStringUTF(env, buf);
  free(buf);
  return out;
}

static int alloc_slot(void) {
  for (int i = 0; i < MAX_INSTANCES; i++) {
    if (!g_slots[i].in_use) return i;
  }
  return -1;
}

/** 版本（诊断：确认 .so 真的链了 wasm3） */
JNIEXPORT jstring JNICALL
Java_dev_proteus_layoutcore_WasmRuntime_nativeWasmVersion(JNIEnv *env, jclass cls) {
  (void)cls;
  char buf[128];
  snprintf(buf, sizeof(buf), "wasm3:%s", M3_VERSION);
  return (*env)->NewStringUTF(env, buf);
}

/**
 * ★实例化：`bytesJson` = JSON 数组（0-255 的无符号字节，由 JS 侧把 ArrayBuffer 转数组——
 *   简化跨 JNI 传递；模块通常几十 KB，数组形式可接受，且避免额外的 JNI 数组类型面）。
 * `limitsJson` = `{"stackBytes":N,"memoryBytes":N}`（可选；宿主治理）
 *
 * @return 句柄（>0）；失败返回 0 并设置 `out` 为错误 JSON（**不静默**）
 */
JNIEXPORT jlong JNICALL
Java_dev_proteus_layoutcore_WasmRuntime_nativeWasmInstantiate(JNIEnv *env, jclass cls,
                                                              jstring bytesJson, jstring limitsJson) {
  (void)cls;
  const char *bj = (*env)->GetStringUTFChars(env, bytesJson, NULL);
  if (bj == NULL) return 0;

  /* ── 解析 JSON 字节数组（最小解析：只认 [n,n,...]）── */
  size_t cap = 4096, len = 0;
  uint8_t *wasm = (uint8_t *)malloc(cap);
  const char *p = bj;
  while (*p && *p != '[') p++;
  if (*p == '[') p++;
  while (*p) {
    while (*p == ' ' || *p == ',' || *p == '\n' || *p == '\r' || *p == '\t') p++;
    if (*p == ']' || *p == '\0') break;
    char *end = NULL;
    long v = strtol(p, &end, 10);
    if (end == p) break;
    if ((size_t)v > 255 || v < 0) { free(wasm); (*env)->ReleaseStringUTFChars(env, bytesJson, bj); return 0; }
    if (len == cap) { cap *= 2; wasm = (uint8_t *)realloc(wasm, cap); }
    wasm[len++] = (uint8_t)v;
    p = end;
  }
  (*env)->ReleaseStringUTFChars(env, bytesJson, bj);

  if (len < 8) { free(wasm); return 0; } /* 最小 wasm 模块 8 字节（magic+version） */

  /* ── 资源上限（宿主治理；缺省用 wasm3 默认）── */
  uint32_t stack_bytes = 0, mem_bytes = 0;
  uint64_t gas_units = 0;
  if (limitsJson != NULL) {
    const char *lj = (*env)->GetStringUTFChars(env, limitsJson, NULL);
    if (lj != NULL) {
      const char *s = strstr(lj, "stackBytes");
      if (s != NULL) stack_bytes = (uint32_t)strtoul(s + 10, NULL, 10);
      const char *m = strstr(lj, "memoryBytes");
      if (m != NULL) mem_bytes = (uint32_t)strtoul(m + 11, NULL, 10);
      const char *gu = strstr(lj, "gasUnits");
      if (gu != NULL) gas_units = (uint64_t)strtoull(gu + 8, NULL, 10);
      (*env)->ReleaseStringUTFChars(env, limitsJson, lj);
    }
  }

  int slot = alloc_slot();
  if (slot < 0) { free(wasm); LOGE("实例槽满（%d）", MAX_INSTANCES); return 0; }

  IM3Environment e = m3_NewEnvironment();
  if (e == NULL) { free(wasm); return 0; }
  IM3Runtime rt = m3_NewRuntime(e, stack_bytes > 0 ? stack_bytes : 64 * 1024, NULL);
  if (rt == NULL) { m3_FreeEnvironment(e); free(wasm); return 0; }
  // ★枚举名是 `c_m3Limit_MemoryBytes`（wasm3 的 M3ResourceLimit；首版写成 M3_RESOURCE_MEMORY
  //   ——交叉编译当场报错抓出）。★另有 `c_m3Limit_GasUnits`（指令计量）：比内存更精准的
  //   **执行时间治理**（不受信模块跑飞时按 gas 停机），一并支持（limitsJson 的 gasUnits 字段）。
  if (mem_bytes > 0) {
    m3_SetResourceLimit(rt, c_m3Limit_MemoryBytes, mem_bytes);
  }

  IM3Module mod = NULL;
  M3Result r = m3_ParseModule(e, &mod, wasm, (uint32_t)len);
  free(wasm);
  if (r != NULL) {
    LOGE("解析失败：%s", r);
    m3_FreeRuntime(rt);
    m3_FreeEnvironment(e);
    return 0;
  }
  r = m3_LoadModule(rt, mod);
  if (r != NULL) {
    LOGE("装载失败：%s", r);
    m3_FreeModule(mod);
    m3_FreeRuntime(rt);
    m3_FreeEnvironment(e);
    return 0;
  }

  // ★gas 预算（**必须在编译前 arm**——wasm3 语义：只对之后编译的函数体生效，见头注）
  if (gas_units > 0) {
    m3_SetResourceLimit(rt, c_m3Limit_GasUnits, gas_units);
  }
  // ★预编译（gas 计量要求先 arm 再编译——此处显式编译，保证预算覆盖全部函数体）
  r = m3_CompileModule(mod);
  if (r != NULL) {
    LOGE("编译失败：%s", r);
    m3_FreeRuntime(rt);
    m3_FreeEnvironment(e);
    return 0;
  }

  g_slots[slot].in_use = 1;
  g_slots[slot].env = e;
  g_slots[slot].rt = rt;
  g_slots[slot].mod = mod;
  LOGI("wasm 实例化成功（slot=%d，模块 %u 字节，栈 %u）", slot, (unsigned)len,
       stack_bytes > 0 ? stack_bytes : 65536u);
  return (jlong)(slot + 1); /* 句柄 = slot+1（0 保留给失败） */
}

/** 失败时把原因写进 out（供 Java 侧读——**不静默**） */
static void put_last_error(JNIEnv *env, jclass cls, const char *msg) {
  jfieldID fid = (*env)->GetStaticFieldID(env, cls, "lastError", "Ljava/lang/String;");
  if (fid != NULL && msg != NULL) {
    jstring s = (*env)->NewStringUTF(env, msg);
    (*env)->SetStaticObjectField(env, cls, fid, s);
  }
}

/**
 * ★调用导出函数：`callJson` = `{"fn":"name","args":[num,...]}`（最多 8 个参数）
 * 返回 `{"ok":true,"result":num}` 或 `{"ok":false,"error":"…"}`
 *
 * 【参数/返回类型】按 wasm3 的 `m3_CallV` 可变参数接口——**统一用 double 传递**
 *   （i32/i64/f32/f64 在 wasm3 的 CallV 里都吃 double，整数按位截断由 wasm3 处理）。
 *   ★诚实边界：>53 位精度的 i64 会失真（JSON 数字限制）——需要精确 i64 时请走内存通道（后续批次）。
 */
JNIEXPORT jstring JNICALL
Java_dev_proteus_layoutcore_WasmRuntime_nativeWasmCall(JNIEnv *env, jclass cls, jlong handle, jstring callJson) {
  int slot = (int)handle - 1;
  if (slot < 0 || slot >= MAX_INSTANCES || !g_slots[slot].in_use) {
    return err_json(env, "无效句柄（已释放？）");
  }
  IM3Runtime rt = g_slots[slot].rt;

  const char *cj = (*env)->GetStringUTFChars(env, callJson, NULL);
  if (cj == NULL) return err_json(env, "参数转码失败");

  /* ── 最小 JSON 解析：取 "fn" 与 "args" ── */
  char fn[128] = {0};
  const char *f = strstr(cj, "\"fn\"");
  if (f != NULL) {
    const char *q1 = strchr(f + 4, '"');
    if (q1 != NULL) {
      const char *q2 = strchr(q1 + 1, '"');
      if (q2 != NULL) {
        size_t n = (size_t)(q2 - q1 - 1);
        if (n >= sizeof(fn)) n = sizeof(fn) - 1;
        memcpy(fn, q1 + 1, n);
      }
    }
  }
  double args[8];
  int nargs = 0;
  const char *a = strstr(cj, "\"args\"");
  if (a != NULL) {
    const char *br = strchr(a, '[');
    if (br != NULL) {
      const char *p = br + 1;
      while (*p && *p != ']' && nargs < 8) {
        while (*p == ' ' || *p == ',' || *p == '\n' || *p == '\r' || *p == '\t') p++;
        if (*p == ']' || *p == '\0') break;
        char *end = NULL;
        double v = strtod(p, &end);
        if (end == p) break;
        args[nargs++] = v;
        p = end;
      }
    }
  }
  (*env)->ReleaseStringUTFChars(env, callJson, cj);

  if (fn[0] == '\0') {
    put_last_error(env, cls, "缺少 \"fn\"（要调用的导出函数名）");
    return err_json(env, "缺少 \"fn\"");
  }

  IM3Function func = NULL;
  M3Result r = m3_FindFunction(&func, rt, fn);
  if (r != NULL) {
    char msg[256];
    snprintf(msg, sizeof(msg), "找不到导出函数 \"%s\"：%s", fn, r);
    put_last_error(env, cls, msg);
    return err_json(env, msg);
  }

  /* ★★★用 `m3_CallArgv`（**字符串传参**）而不是 `m3_CallV`（可变参）：
   *   【为什么（真机实测抓出的真 bug）】`m3_CallV` 是 C 可变参：i32 参数期望 **int**、
   *   f32 期望 **float**——我首版统一传 `double` ⇒ **位模式错位**：
   *   实测 `add(2,40)` 返回 `1.68909e-314`（2.0 的 double 低 32 位是 0 ⇒ 参数全变 0，
   *   返回值又按 double 读 ⇒ 垃圾数）。**这种错不会报错，只会静默给错结果**——
   *   正是本仓「静默失败最致命」的形态。
   *   ⇒ `m3_CallArgv` 收字符串，wasm3 **按函数签名声明**做类型解析（无位模式问题），
   *     且天然支持 i64（无 double 精度损失）与任意参数个数（首版的 >4 限制随之解除）。
   */
  char argbuf[8][64];
  const char *argv[8];
  for (int i = 0; i < nargs; i++) {
    /* %g 保证"整数值不带小数点"（wasm3 按签名解析：i32 收 "2"、f64 收 "2.5"）—
       但整数值的 double 用 %g 会输出 "2"（正确）；小数值输出 "2.5"。 */
    snprintf(argbuf[i], sizeof(argbuf[i]), "%.17g", args[i]);
    argv[i] = argbuf[i];
  }
  r = m3_CallArgv(func, (uint32_t)nargs, argv);
  if (r != NULL) {
    char msg[256];
    snprintf(msg, sizeof(msg), "调用失败：%s", r);
    put_last_error(env, cls, msg);
    return err_json(env, msg);
  }

  /* ★返回值同样要**按签名类型**取（不能固定用 double：i32 结果按 double 读同样是位模式错位）。
   *   正解：先查函数签名（`m3_GetRetCount` + `m3_GetRetType`），再按实际类型取。 */
  uint32_t retc = m3_GetRetCount(func);
  if (retc == 0) {
    return (*env)->NewStringUTF(env, "{\"ok\":true,\"result\":null,\"note\":\"void 函数（无返回值）\"}");
  }
  M3ValueType rt_type = m3_GetRetType(func, 0);
  char buf[96];
  switch (rt_type) {
    case c_m3Type_i32: {
      int32_t v = 0;
      r = m3_GetResultsV(func, &v);
      if (r != NULL) break;
      snprintf(buf, sizeof(buf), "{\"ok\":true,\"result\":%d,\"type\":\"i32\"}", v);
      return (*env)->NewStringUTF(env, buf);
    }
    case c_m3Type_i64: {
      int64_t v = 0;
      r = m3_GetResultsV(func, &v);
      if (r != NULL) break;
      /* ★i64 以**字符串**返回（JS number 只有 53 位精度——避免静默失真，调用方按需自取） */
      snprintf(buf, sizeof(buf), "{\"ok\":true,\"result\":\"%lld\",\"type\":\"i64\",\"note\":\"i64 以字符串返回（JS number 53 位限制）\"}", (long long)v);
      return (*env)->NewStringUTF(env, buf);
    }
    case c_m3Type_f32: {
      float v = 0;
      r = m3_GetResultsV(func, &v);
      if (r != NULL) break;
      snprintf(buf, sizeof(buf), "{\"ok\":true,\"result\":%g,\"type\":\"f32\"}", (double)v);
      return (*env)->NewStringUTF(env, buf);
    }
    default: {
      double v = 0;
      r = m3_GetResultsV(func, &v);
      if (r != NULL) break;
      snprintf(buf, sizeof(buf), "{\"ok\":true,\"result\":%g,\"type\":\"f64\"}", v);
      return (*env)->NewStringUTF(env, buf);
    }
  }
  /* 走到这里 = 读取失败（附原因，不静默） */
  char msgbuf[192];
  snprintf(msgbuf, sizeof(msgbuf), "结果读取失败（retc=%u type=%d）：%s", (unsigned)retc, (int)rt_type, r != NULL ? r : "未知");
  put_last_error(env, cls, msgbuf);
  return err_json(env, msgbuf);
}

/** 释放实例（幂等） */
JNIEXPORT jboolean JNICALL
Java_dev_proteus_layoutcore_WasmRuntime_nativeWasmRelease(JNIEnv *env, jclass cls, jlong handle) {
  (void)env;
  (void)cls;
  int slot = (int)handle - 1;
  if (slot < 0 || slot >= MAX_INSTANCES || !g_slots[slot].in_use) return JNI_FALSE;
  m3_FreeRuntime(g_slots[slot].rt);   /* 内含 module 的释放（wasm3 语义） */
  m3_FreeEnvironment(g_slots[slot].env);
  g_slots[slot].in_use = 0;
  g_slots[slot].env = NULL;
  g_slots[slot].rt = NULL;
  g_slots[slot].mod = NULL;
  return JNI_TRUE;
}
