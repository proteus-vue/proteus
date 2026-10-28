// hosts/harmony/host-app/proteus_render/src/main/cpp/vm_session_probe.h
// ★★★#1342-A：**#540 决策门探针** —— 持久 VM 在当前 SDK（API 24 / HarmonyOS 6.1.1）到底还崩不崩？
//
// 【为什么先做这个探针，而不是直接改 App runtime】
//   `host_app_runtime_impl.h:19-21` 断言：
//     「跨 napi 调用复用同一 JSVM ⇒ V8 微任务排空 HandleScope 溢出/SIGSEGV（决策 #540 实测）
//      ⇒ 每次调用新建 VM → eval → destroy；这是本机唯一稳定的形态。」
//   但**同一个 HAR 里存在反例**：`proteus_host.cpp:23-28` 的持久壳 VM
//   （`hostRtShellInstall` 建立后**不销毁**，跨事件存活），且真机 C 组已跑通。
//   ⇒ "JSVM 不能跨调用复用"很可能是 #540 当时的 **HandleScope / 微任务纪律**问题，
//     而不是平台边界。**不重验就改造 = 在未证实的前提上投入**（本仓「先取证再断言」纪律）。
//
// 【本探针的设计：只验一个变量】
//   严格复刻 `HostAppBoot` 的 VM 建立顺序（CreateVM → OpenVMScope → CreateEnv →
//   OpenHandleScope → SetMicrotaskPolicy(EXPLICIT)），然后：
//     **每轮开/关一个内层 HandleScope + 显式 checkpoint，但 VM/Env 一直不销毁**
//   这正好隔离出"持久"这一个变量（其余全同）。
//
// 【三种负载（对应 #540 崩溃路径的三个可能触发条件）】
//   `plain`  —— 纯 Promise 链（微任务排空，最基础）
//   `nav`    —— 模拟"跨启动新导航"的重入（`entry-superapp.ts:255` 记的崩溃路径）
//   `ref`    —— 跨轮持有 JS 对象（走 `OH_JSVM_CreateReference`；不这么做句柄会长）
//
// 【诚实边界】
//   · 本探针**不复刻完整 App runtime**（不 eval 整包 Vue bundle）——那会把"VM 持久性"
//     与"运行期自身的微任务重入 bug"混在一起，反而定位不了。
//   · 若探针通过，只证明"**这个负载形态下**持久 VM 可行"；接入 App runtime 前仍须再验一轮。
//   · 若探针崩溃，说明 #540 在当前 SDK 仍成立 ⇒ 停下来评估 Worker / 维持一次性 + 策略补偿。
#pragma once
#include <string>
#include <cstring>
#include <cstdio>

#include "proteus_host_helpers.h"
// ★JSVM 头的正确引用形态是 `<ark_runtime/jsvm.h>`（见 `proteus_host_helpers.h:23`）——
//   写成 `"jsvm.h"` 只在 CMake 显式加了 sysroot include 时才能找到，单文件 `-fsyntax-only` 会假红。
#include <ark_runtime/jsvm.h>
#include <ark_runtime/jsvm_types.h>
#include "node_api.h"
#include <hilog/log.h>

namespace proteus {
namespace vmsession {

/** 探针读数（逐轮累积，最后一次性返回） */
struct ProbeResult {
    int rounds = 0;
    int roundsOk = 0;
    int firstFailureRound = -1;
    std::string firstFailureWhy;
    double heapBeforeKB = 0;
    double heapAfterKB = 0;
    double heapPeakKB = 0;
    /** 每 100 轮一个采样点（用于判断"线性增长 ⇒ 泄漏"） */
    std::string heapSamplesJson = "[";
    std::string mode = "plain";
};

/**
 * ★注意 API 签名（SDK 实测，别按 V8 直觉写）：
 *   `OH_JSVM_GetHeapStatistics(JSVM_VM vm, JSVM_HeapStatistics* result)`
 *   —— 第一个参数是 **VM** 不是 Env；字段是 **`usedHeapSize`**（驼峰，不是 `used_heap_size`）。
 *   （首次写成 `(env, …)` + `used_heap_size` ⇒ 编译红两条，正是"按直觉写 API"的代价。）
 */
inline double heapUsedKB(JSVM_VM vm) {
    JSVM_HeapStatistics st;
    memset(&st, 0, sizeof(st));
    if (OH_JSVM_GetHeapStatistics(vm, &st) != JSVM_OK) return -1;
    return static_cast<double>(st.usedHeapSize) / 1024.0;
}

/** 一次 checkpoint（推进 Promise 微任务）；返回是否成功 */
inline bool checkpoint(JSVM_VM vm) {
    return OH_JSVM_PerformMicrotaskCheckpoint(vm) == JSVM_OK;
}

/**
 * 读出并清掉当前 JS 异常，转成可读文本。
 * ★没有它，`RunScript != JSVM_OK` 只能报"执行失败"，看不出 JS 层错在哪
 *   （实测第一条报告就是 `ok=false roundsOk=0 firstFail=-1` 而没有任何原因——正是缺这个）。
 */
inline std::string jsvmExceptionText(JSVM_Env env) {
    JSVM_Value exc = nullptr;
    if (OH_JSVM_GetAndClearLastException(env, &exc) != JSVM_OK || exc == nullptr) return "(no-exception)";
    JSVM_Value str = nullptr;
    if (OH_JSVM_CoerceToString(env, exc, &str) != JSVM_OK || str == nullptr) return "(unstringable)";
    size_t len = 0;
    if (OH_JSVM_GetValueStringUtf8(env, str, nullptr, 0, &len) != JSVM_OK) return "(no-length)";
    std::string out(len + 1, '\0');
    if (OH_JSVM_GetValueStringUtf8(env, str, &out[0], out.size(), &len) != JSVM_OK) return "(no-read)";
    out.resize(len);
    return out;
}

/**
 * eval 并把结果当字符串读回（诊断用）。
 * ★`checkpointOrEval` 只做"跑通/没跑通"，**不返回结果值**——用它读 `typeof x` 会拿到空串
 *   （实测：自检报 "得到 "，看起来像 JS 返回空，实际是我根本没读返回值）。
 */
inline bool evalToString(JSVM_Env env, const char* js, std::string& out, std::string& why) {
    JSVM_Script s = nullptr;
    JSVM_Value src = nullptr;
    if (OH_JSVM_CreateStringUtf8(env, js, JSVM_AUTO_LENGTH, &src) != JSVM_OK) {
        why = "CreateString 失败";
        return false;
    }
    bool cacheRejected = false;
    const JSVM_Status cs = OH_JSVM_CompileScript(env, src, nullptr, 0, false, &cacheRejected, &s);
    if (cs != JSVM_OK || s == nullptr) {
        why = "CompileScript 失败 status=" + std::to_string(static_cast<int>(cs));
        return false;
    }
    JSVM_Value rr = nullptr;
    if (OH_JSVM_RunScript(env, s, &rr) != JSVM_OK) {
        why = "RunScript 失败 exc=" + jsvmExceptionText(env);
        return false;
    }
    if (rr == nullptr) {
        out = "(undefined)";
        return true;
    }
    JSVM_Value str = nullptr;
    if (OH_JSVM_CoerceToString(env, rr, &str) != JSVM_OK || str == nullptr) {
        out = "(unstringable)";
        return true;
    }
    size_t len = 0;
    if (OH_JSVM_GetValueStringUtf8(env, str, nullptr, 0, &len) != JSVM_OK) {
        out = "(no-length)";
        return true;
    }
    out.resize(len + 1, '\0');
    if (OH_JSVM_GetValueStringUtf8(env, str, &out[0], out.size(), &len) != JSVM_OK) {
        out = "(no-read)";
        return true;
    }
    out.resize(len);
    return true;
}

/**
 * eval 一段 JS 并 checkpoint；失败时给出原因。
 *
 * ★★★两个必须照抄的点（都是实测踩出来的）：
 *   ① `CreateStringUtf8(env, js, JSVM_AUTO_LENGTH, &src)` —— 传 `strlen(js)` 会静默失败；
 *   ② **第 6 个参数 `bool* cacheRejected` 是输出参数**（"缓存是否被拒绝"），
 *      **不是**"编译是否成功"！我第一版把它当成功标志判断 ⇒ 永远判成失败
 *      （status=JSM_OK、script 已生成，却因为 ok=0 被报"CompileScript 失败"）。
 *      ⇒ 正确判据 = `status == JSVM_OK && result != nullptr`。
 */
inline bool checkpointOrEval(JSVM_Env env, const char* js, std::string& why) {
    JSVM_Script s = nullptr;
    JSVM_Value src = nullptr;
    if (OH_JSVM_CreateStringUtf8(env, js, JSVM_AUTO_LENGTH, &src) != JSVM_OK) {
        why = "CreateString 失败";
        return false;
    }
    bool cacheRejected = false;
    const JSVM_Status cs = OH_JSVM_CompileScript(env, src, nullptr, 0, false, &cacheRejected, &s);
    if (cs != JSVM_OK || s == nullptr) {
        why = "CompileScript 失败 status=" + std::to_string(static_cast<int>(cs)) + " exc=" + jsvmExceptionText(env);
        return false;
    }
    JSVM_Value rr = nullptr;
    if (OH_JSVM_RunScript(env, s, &rr) != JSVM_OK) {
        why = "RunScript 失败 exc=" + jsvmExceptionText(env);
        return false;
    }
    return true;
}

/**
 * 跑探针。
 * @param rounds 轮数（建议 1000）
 * @param mode `plain` / `nav` / `ref`
 */
inline std::string run(int rounds, const std::string& mode) {
    ProbeResult R;
    R.mode = mode;
    R.rounds = rounds;

    OH_JSVM_Init(nullptr);
    JSVM_CreateVMOptions vo;
    memset(&vo, 0, sizeof(vo));
    JSVM_VM vm = nullptr;
    JSVM_VMScope vmScope = nullptr;
    JSVM_Env env = nullptr;
    JSVM_HandleScope outer = nullptr;
    std::string err;

    if (OH_JSVM_CreateVM(&vo, &vm) != JSVM_OK || vm == nullptr) err = "CreateVM 失败";
    if (err.empty() && OH_JSVM_OpenVMScope(vm, &vmScope) != JSVM_OK) err = "OpenVMScope 失败";
    if (err.empty() && OH_JSVM_CreateEnv(vm, 0, nullptr, &env) != JSVM_OK) err = "CreateEnv 失败";
    // ★外层 HandleScope **全程不关**（与 `proteus_host.cpp:75` 的持久壳 VM 同形态）
    if (err.empty() && OH_JSVM_OpenHandleScope(env, &outer) != JSVM_OK) err = "OpenHandleScope 失败";
    const bool policyOk = err.empty() && (OH_JSVM_SetMicrotaskPolicy(vm, JSVM_MICROTASK_EXPLICIT) == JSVM_OK);

    if (err.empty()) {
        // 种一个计数器 + 一个可增长对象（跨轮复用，验证"跨轮持有"）
        // ★严格照抄既有 `jsvmEvalStr` 形态（见 checkpointOrEval 的注释——传 strlen 会静默失败）
        const char* seed =
            "globalThis.__probe = { n: 0, arr: [] };"
            "globalThis.__probeTick = function () { globalThis.__probe.n = globalThis.__probe.n + 1; return globalThis.__probe.n; };";
        std::string seedWhy;
        if (!checkpointOrEval(env, seed, seedWhy)) err = "seed 失败：" + seedWhy;
        // ★自检：seed 必须真的把函数挂上 globalThis
        //   （否则后续每轮报 "is not a function"，而这会被误读成"VM 有问题"——
        //    实测就踩过：真实原因是 seed 只在第 0 轮生效而我却按"每轮重建"写负载）
        if (err.empty()) {
            std::string chk, chkWhy;
            if (!evalToString(env, "typeof globalThis.__probeTick", chk, chkWhy)) {
                err = "seed 自检失败：" + chkWhy;
            } else if (chk != "function") {
                err = "seed 未挂上 __probeTick（typeof=" + chk + "）";
            }
        }
    }

    if (err.empty()) {
        R.heapBeforeKB = heapUsedKB(vm);
        R.heapPeakKB = R.heapBeforeKB;
        // 跨轮持有的 JS 对象引用（`ref` 模式用）
        JSVM_Ref heldRef = nullptr;

        for (int i = 0; i < rounds; i++) {
            // ★★关键：**每轮只开/关一个内层 HandleScope**，VM/Env 不动
            JSVM_HandleScope inner = nullptr;
            if (OH_JSVM_OpenHandleScope(env, &inner) != JSVM_OK) {
                R.firstFailureRound = i;
                R.firstFailureWhy = "OpenHandleScope(inner) 失败";
                break;
            }
            std::string why;
            // —— 负载 ——
            if (mode == "plain") {
                // 纯 Promise 链：每轮 16 个 then（模拟微任务排空压力）
                const char* js =
                    "globalThis.__probe.arr.push(Promise.resolve(1).then(v=>v+1).then(v=>v+1)"
                    ".then(v=>v+1).then(v=>v+1).then(v=>v+1).then(v=>v+1)"
                    ".then(v=>v+1).then(v=>v+1).then(v=>v+1).then(v=>v+1)"
                    ".then(v=>v+1).then(v=>v+1).then(v=>v+1).then(v=>v+1)"
                    ".then(v=>v+1).then(v=>{ globalThis.__probeTick()(); return v; }));"
                    // 每 50 轮清一次 arr（否则数组本身会撑爆堆，掩盖 VM 问题）
                    "if (globalThis.__probe.arr.length > 50) globalThis.__probe.arr.length = 0;";
                if (!checkpointOrEval(env, js, why)) {
                    R.firstFailureRound = i;
                    R.firstFailureWhy = why;
                    OH_JSVM_CloseHandleScope(env, inner);
                    break;
                }
            } else if (mode == "nav") {
                // 模拟"启动新导航 + 微任务重入"（#540 记的崩溃路径）
                const char* js =
                    "(async () => {"
                    "  await Promise.resolve();"
                    "  globalThis.__probeTick()();"
                    "  await Promise.resolve();"
                    "  await Promise.resolve();"
                    "  globalThis.__probeTick()();"
                    "})();";
                if (!checkpointOrEval(env, js, why)) {
                    R.firstFailureRound = i;
                    R.firstFailureWhy = why;
                    OH_JSVM_CloseHandleScope(env, inner);
                    break;
                }
                // 重入：再 eval 一次（模拟导航回调里又发起新调用）
                if (!checkpointOrEval(env, "globalThis.__probeTick()();", why)) {
                    R.firstFailureRound = i;
                    R.firstFailureWhy = why;
                    OH_JSVM_CloseHandleScope(env, inner);
                    break;
                }
            } else { // ref
                // 跨轮持有：建一个对象 → CreateReference → 下一轮取出 → 删除上一轮的
                JSVM_Value obj = nullptr;
                OH_JSVM_CreateObject(env, &obj);
                JSVM_Value num = nullptr;
                OH_JSVM_CreateDouble(env, static_cast<double>(i), &num);
                OH_JSVM_SetNamedProperty(env, obj, "i", num);
                JSVM_Ref nextRef = nullptr;
                if (OH_JSVM_CreateReference(env, obj, 1, &nextRef) != JSVM_OK) {
                    R.firstFailureRound = i;
                    R.firstFailureWhy = "CreateReference 失败";
                    OH_JSVM_CloseHandleScope(env, inner);
                    break;
                }
                if (heldRef != nullptr) {
                    // ★必须显式删：否则引用永不释放 ⇒ 堆线性增长（这正是 #540 可能的真因之一）
                    OH_JSVM_DeleteReference(env, heldRef);
                }
                heldRef = nextRef;
            }

            // ★显式 checkpoint（EXPLICIT 策略下只有宿主推进才跑微任务）
            if (policyOk && !checkpoint(vm)) {
                R.firstFailureRound = i;
                R.firstFailureWhy = "PerformMicrotaskCheckpoint 失败";
                OH_JSVM_CloseHandleScope(env, inner);
                break;
            }
            if (OH_JSVM_CloseHandleScope(env, inner) != JSVM_OK) {
                R.firstFailureRound = i;
                R.firstFailureWhy = "CloseHandleScope(inner) 失败";
                break;
            }
            R.roundsOk = i + 1;

            // 每 100 轮采样堆（判"线性增长 ⇒ 泄漏"）
            if ((i + 1) % 100 == 0) {
                const double kb = heapUsedKB(vm);
                if (kb > R.heapPeakKB) R.heapPeakKB = kb;
                char buf[64];
                snprintf(buf, sizeof(buf), "%s[%d,%.1f]", (i + 1) > 100 ? "," : "", i + 1, kb);
                R.heapSamplesJson += buf;
            }
        }
        if (heldRef != nullptr) OH_JSVM_DeleteReference(env, heldRef);
        R.heapAfterKB = heapUsedKB(vm);
        if (R.heapAfterKB > R.heapPeakKB) R.heapPeakKB = R.heapAfterKB;
    }

    // ★清理顺序与 `HostAppBoot` 一致（外层 scope → env → vmScope → vm）
    if (env != nullptr && outer != nullptr) OH_JSVM_CloseHandleScope(env, outer);
    if (env != nullptr) OH_JSVM_DestroyEnv(env);
    if (vm != nullptr && vmScope != nullptr) OH_JSVM_CloseVMScope(vm, vmScope);
    if (vm != nullptr) OH_JSVM_DestroyVM(vm);

    R.heapSamplesJson += "]";
    const bool allOk = err.empty() && R.firstFailureRound < 0 && R.roundsOk == rounds;
    // 堆增长判据：超过 20% 视为可疑（线性泄漏）
    const double growthPct = R.heapBeforeKB > 0 ? ((R.heapAfterKB - R.heapBeforeKB) / R.heapBeforeKB) * 100.0 : 0;

    char head[512];
    snprintf(head, sizeof(head),
             "{\"ok\":%s,\"mode\":\"%s\",\"rounds\":%d,\"roundsOk\":%d,\"firstFailureRound\":%d,\"firstFailureWhy\":\"%s\","
             "\"heapBeforeKB\":%.1f,\"heapAfterKB\":%.1f,\"heapPeakKB\":%.1f,\"heapGrowthPct\":%.1f,\"samples\":",
             allOk ? "true" : "false", R.mode.c_str(), R.rounds, R.roundsOk, R.firstFailureRound,
             jsonEscape(R.firstFailureWhy).c_str(), R.heapBeforeKB, R.heapAfterKB, R.heapPeakKB, growthPct);
    std::string out = head;
    out += R.heapSamplesJson;
    if (!err.empty()) out += ",\"error\":\"" + jsonEscape(err) + "\"";
    out += "}";
    return out;
}

}  // namespace vmsession
}  // namespace proteus

/* ══════════════════════ napi 入口（注册在 proteus_host.cpp） ══════════════════════ */

/**
 * ★★★#1342-A：**#540 决策门** —— 持久 VM 探针的 napi 入口。
 *
 * 入参：`{ rounds?: number, mode?: 'plain'|'nav'|'ref' }`（JSON 字符串）
 * 返回：探针读数 JSON（见上面的 `ProbeResult`）
 *
 * 【为什么归 runtime 而不是 dev 装置】它要回答的是"**App runtime 能不能改成持久 VM**"，
 *   属运行时架构决策（与 #1067 把设备域归位同一个理由）。
 * 【为什么只加导出、不改现有入口】决策门的意义是**先取证**：
 *   若探针崩了，现有一次性 VM 路径必须完好无损。
 * 【★为什么放在本文件而不是 host_app_runtime_impl.h】反巨型化：后者已 1130 行（基线只减不增），
 *   加 53 行会破门禁。探针的入口与实现同处一文件，职责也更内聚。
 */
inline napi_value HostVmSessionProbe(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string argsJson;
    if (argc >= 1 && args[0] != nullptr) {
        size_t len = 0;
        napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
        argsJson.resize(len + 1);
        napi_get_value_string_utf8(env, args[0], &argsJson[0], len + 1, &len);
        argsJson.resize(len);
    }
    int rounds = 1000;
    std::string mode = "plain";
    // 极简字段读取（探针不接受复杂入参；避免把 jstr 的语义带进来）
    {
        const char* rk = "\"rounds\"";
        const size_t at = argsJson.find(rk);
        if (at != std::string::npos) {
            const size_t colon = argsJson.find(':', at + strlen(rk));
            if (colon != std::string::npos) {
                int v = atoi(argsJson.c_str() + colon + 1);
                if (v > 0 && v <= 100000) rounds = v;
            }
        }
        const char* mk = "\"mode\"";
        const size_t mt = argsJson.find(mk);
        if (mt != std::string::npos) {
            const size_t q1 = argsJson.find('"', mt + strlen(mk) + 1);
            const size_t q2 = q1 == std::string::npos ? std::string::npos : argsJson.find('"', q1 + 1);
            if (q1 != std::string::npos && q2 != std::string::npos && q2 > q1) mode = argsJson.substr(q1 + 1, q2 - q1 - 1);
        }
    }
    const std::string out = proteus::vmsession::run(rounds, mode);
    napi_value r;
    napi_create_string_utf8(env, out.c_str(), out.size(), &r);
    return r;
}
