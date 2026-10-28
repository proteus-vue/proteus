// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_vm_session.h
// ★★★#1344 B-1：**会话式 VM**（`SessionOpen / SessionTick / SessionClose`）。
//
// 【它解决什么（一句话）】
//   把"每次 napi 调用新建一个 VM"换成"**一个 VM 跨调用存活**"，从而让异步回推有接收方。
//   ⇒ `http.cancel` 能真取消、`stream` 能逐块回推、WebSocket 能收事件（这三项的根因都是
//     "请求完成时 JS 上下文已经销毁"，见决策 #1343）。
//
// 【前提已由真机证据支撑（决策 #1343，10500 轮零崩溃）】
//   · `plain` 5000 轮 · `nav`（#540 的崩溃路径）3000 轮 · `ref` 3000 轮 · **整包 Vue bundle 4000 轮**
//   ⇒ 「跨 napi 复用 JSVM 必崩」在当前 SDK（API 24 / 6.1.1）**不成立**。
//
// 【★★★单线程纪律（整套设计的地基，违反必崩）】
//   `JSVM_Env` **只能由创建它的线程使用**（`jsvm.h` 的锁 API 只做互斥，不提供并行执行）。
//   ⇒ 本文件的**所有** JS 操作只允许发生在：
//     `sessionOpen()` / `sessionTick()` / `sessionClose()` 内，且由 **ArkTS 主线程串行调用**。
//   ⇒ **网络线程绝对不能碰 `env`**：它只允许 `pushResolve()`（写 C++ 队列）。
//      队列 → JS 的搬运只发生在 `sessionTick()` 里。这是整个异步化的关键分界。
//
// 【与一次性 VM 的关系（不是替换，是并存）】
//   一次性入口（`hostAppBoot/Drive/Render/PumpTick/Eval`）**保持原样不动**——
//   它们是已验证的生产路径。会话式是**新增**通道，先由一个判据场景驱动，
//   稳定后再逐屏切换。这样"改造期间生产路径零风险"。
//
// 【诚实边界】
//   · 会话持有整包 + Vue 运行期常驻 ⇒ 内存基线约 4.4MB（#1343 的 bundle 探针实测）。
//   · 会话态是**进程级单例**（一个 App 一个会话）；多业务隔离属 P3 多租户阶段。
//   · 本文件只做「生命周期 + tick + 回推搬运」；**能力落地（cancel/stream/ws）在后续批次**。
#pragma once
#include <string>
#include <vector>
#include <mutex>
#include <cstdio>
#include <cstring>
#include <cstdlib>

#include "proteus_host_helpers.h"
#include "invoke_bytes_bridge.h"
#include <ark_runtime/jsvm.h>
#include <ark_runtime/jsvm_types.h>

namespace proteus {
namespace vmsess {

/* ══════════════════════ 会话状态 ══════════════════════ */

/** 会话状态（进程级单例；★JS 相关字段只由 ArkTS 主线程访问） */
struct SessionState {
    JSVM_VM vm = nullptr;
    JSVM_VMScope vmScope = nullptr;
    JSVM_Env env = nullptr;
    /** ★外层 HandleScope：**全程不关**（与 `proteus_host.cpp` 的持久壳 VM 同形态） */
    JSVM_HandleScope outerScope = nullptr;
    bool open = false;
    int ticks = 0;
    int resolvedPushed = 0;
    int pendingDepth = 0;
    int maxPendingDepth = 0;
    double heapKB = 0;
    std::string lastError;
    /** boot 状态（`booted` / `boot-failed:…` / `skipped` / `no-hook(…)`）——如实记录，不伪造 */
    std::string bootState = "none";

    /** ★待回推队列：**网络线程写、tick 读**（唯一跨线程数据结构，必须加锁） */
    std::mutex mu;
    std::vector<std::string> pendingFrames;

    /**
     * 复位到初始态（**不能**用 `S = SessionState()`：本结构含 `std::mutex`，
     * 拷贝/移动赋值被隐式删除 ⇒ 编译红三条。手写复位是唯一干净做法。）
     */
    void reset() {
        vm = nullptr;
        vmScope = nullptr;
        env = nullptr;
        outerScope = nullptr;
        open = false;
        ticks = 0;
        resolvedPushed = 0;
        pendingDepth = 0;
        maxPendingDepth = 0;
        heapKB = 0;
        lastError.clear();
        bootState = "none";
        {
            std::lock_guard<std::mutex> lk(mu);
            pendingFrames.clear();
        }
    }
};

inline SessionState& state() {
    static SessionState s;
    return s;
}

/* ══════════════════════ 工具（顺序：先定义后使用） ══════════════════════ */

inline double heapUsedKB(JSVM_VM vm) {
    JSVM_HeapStatistics st;
    memset(&st, 0, sizeof(st));
    if (OH_JSVM_GetHeapStatistics(vm, &st) != JSVM_OK) return -1;
    return static_cast<double>(st.usedHeapSize) / 1024.0;
}

/** 读并清当前 JS 异常 */
inline std::string vmsExc(JSVM_Env env) {
    JSVM_Value exc = nullptr;
    if (OH_JSVM_GetAndClearLastException(env, &exc) != JSVM_OK || exc == nullptr) return "(none)";
    JSVM_Value str = nullptr;
    if (OH_JSVM_CoerceToString(env, exc, &str) != JSVM_OK || str == nullptr) return "(unstringable)";
    size_t len = 0;
    if (OH_JSVM_GetValueStringUtf8(env, str, nullptr, 0, &len) != JSVM_OK) return "(nolength)";
    std::string out(len + 1, '\0');
    OH_JSVM_GetValueStringUtf8(env, str, &out[0], out.size(), &len);
    out.resize(len);
    return out;
}

/**
 * eval 一段 JS（失败带 JS 异常文本）。
 * ★★★必须照抄的三点（都在 #1343 踩过，见该决策）：
 *   ① `CreateStringUtf8` 用 `JSVM_AUTO_LENGTH`（传 `strlen` 会静默失败）；
 *   ② `CompileScript` 第 6 参数 `bool* cacheRejected` 是**输出**参数（缓存是否被拒），
 *      **不是**编译成功标志 ⇒ 判据是 `status==JSVM_OK && script!=nullptr`；
 *   ③ 失败时读 `GetAndClearLastException`，否则只知道"失败"不知道"哪错"。
 */
inline bool vmsEval(JSVM_Env env, const char* js, std::string& why) {
    JSVM_Script s = nullptr;
    JSVM_Value src = nullptr;
    if (OH_JSVM_CreateStringUtf8(env, js, JSVM_AUTO_LENGTH, &src) != JSVM_OK) {
        why = "CreateString 失败";
        return false;
    }
    bool cacheRejected = false;
    const JSVM_Status cs = OH_JSVM_CompileScript(env, src, nullptr, 0, false, &cacheRejected, &s);
    if (cs != JSVM_OK || s == nullptr) {
        why = "CompileScript 失败 status=" + std::to_string(static_cast<int>(cs)) + " exc=" + vmsExc(env);
        return false;
    }
    JSVM_Value rr = nullptr;
    if (OH_JSVM_RunScript(env, s, &rr) != JSVM_OK) {
        why = "RunScript 失败 exc=" + vmsExc(env);
        return false;
    }
    return true;
}

/** eval 并取字符串结果 */
inline bool vmsToString(JSVM_Env env, const char* js, std::string& out, std::string& why) {
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
        why = "RunScript 失败 exc=" + vmsExc(env);
        return false;
    }
    if (rr == nullptr) { out = ""; return true; }
    JSVM_Value str = nullptr;
    if (OH_JSVM_CoerceToString(env, rr, &str) != JSVM_OK || str == nullptr) { out = ""; return true; }
    size_t len = 0;
    if (OH_JSVM_GetValueStringUtf8(env, str, nullptr, 0, &len) != JSVM_OK) { out = ""; return true; }
    out.resize(len + 1, '\0');
    OH_JSVM_GetValueStringUtf8(env, str, &out[0], out.size(), &len);
    out.resize(len);
    return true;
}

inline void jsArgStr(JSVM_Env env, JSVM_Value v, std::string& out) {
    if (v == nullptr) return;
    size_t len = 0;
    if (OH_JSVM_GetValueStringUtf8(env, v, nullptr, 0, &len) != JSVM_OK) return;
    out.resize(len + 1, '\0');
    OH_JSVM_GetValueStringUtf8(env, v, &out[0], out.size(), &len);
    out.resize(len);
}

/** 字节串 → JS 数组字面量元素（`12,0,255`） */
inline std::string bytesToJsArray(const std::string& bytes) {
    std::string out;
    out.reserve(bytes.size() * 4);
    for (size_t i = 0; i < bytes.size(); i++) {
        if (i) out += ',';
        out += std::to_string(static_cast<unsigned int>(static_cast<unsigned char>(bytes[i])));
    }
    return out;
}

inline JSVM_Value NoopCbS(JSVM_Env env, JSVM_CallbackInfo info) {
    (void)info;
    JSVM_Value u = nullptr;
    OH_JSVM_GetUndefined(env, &u);
    return u;
}

inline JSVM_Value ZeroCbS(JSVM_Env env, JSVM_CallbackInfo info) {
    (void)info;
    JSVM_Value n = nullptr;
    OH_JSVM_CreateDouble(env, 0.0, &n);
    return n;
}

/** `proteusHost.invoke`（JSON 腿）转调已注册的通用分发（与一次性 VM 同一份能力语义） */
inline JSVM_Value InvokeCbJson(JSVM_Env env, JSVM_CallbackInfo info) {
    size_t argc = 2;
    JSVM_Value args[2] = {nullptr, nullptr};
    OH_JSVM_GetCbInfo(env, info, &argc, args, nullptr, nullptr);
    std::string method, argsJson;
    jsArgStr(env, argc > 0 ? args[0] : nullptr, method);
    jsArgStr(env, argc > 1 ? args[1] : nullptr, argsJson);
    const std::string out = g_proteusGenericInvoke
                                ? g_proteusGenericInvoke(method, argsJson)
                                : "{\"ok\":false,\"missing\":true,\"reason\":\"no generic handler\"}";
    JSVM_Value r = nullptr;
    OH_JSVM_CreateStringUtf8(env, out.c_str(), out.size(), &r);
    return r;
}

/** 读数 JSON（open / tick / stats 共用口径） */
inline std::string statsJson(bool ok) {
    SessionState& S = state();
    std::string out = "{\"ok\":";
    out += ok ? "true" : "false";
    out += ",\"open\":";
    out += S.open ? "true" : "false";
    out += ",\"ticks\":" + std::to_string(S.ticks);
    out += ",\"pushed\":" + std::to_string(S.resolvedPushed);
    out += ",\"pendingDepth\":" + std::to_string(S.pendingDepth);
    out += ",\"maxPendingDepth\":" + std::to_string(S.maxPendingDepth);
    {
        char hb[32];
        snprintf(hb, sizeof(hb), "%.1f", S.heapKB);
        out += ",\"heapKB\":" + std::string(hb);
    }
    out += ",\"boot\":\"" + jsonEscape(S.bootState) + "\"";
    if (!S.lastError.empty()) out += ",\"lastError\":\"" + jsonEscape(S.lastError) + "\"";
    out += "}";
    return out;
}

/* ══════════════════════ 回推搬运（唯一跨线程入口） ══════════════════════ */

/**
 * 把一个完整回程帧（PRSP 原始字节）排队，等下一次 `sessionTick()` 推给 JS。
 *
 * ★**为什么不能在这里直接推**：本函数会被**网络线程**调用，而 `JSVM_Env` 只能在主线程用。
 *   ⇒ 只入队。这是"网络线程绝不碰 JS"这条纪律的唯一入口。
 * ★返回当前队列深度（诊断用）。
 */
inline int pushResolve(const std::string& frameBytes) {
    SessionState& S = state();
    int depth = 0;
    {
        std::lock_guard<std::mutex> lk(S.mu);
        S.pendingFrames.push_back(frameBytes);
        depth = static_cast<int>(S.pendingFrames.size());
        if (depth > S.maxPendingDepth) S.maxPendingDepth = depth;
    }
    S.pendingDepth = depth;
    return depth;
}

/* ══════════════════════ 生命周期 ══════════════════════ */

/**
 * 打开会话：建 VM → 注入 `proteusHost` → eval 整包 → boot。**不销毁**。
 *
 * ★与 `HostAppBoot` 的唯一区别就是**不销毁**（其余顺序逐项照抄，包括
 *   `SetMicrotaskPolicy(EXPLICIT)` 与"读数必须在销毁前取"的纪律）。
 * @param bundleJs 整包源码（1.5MB；ArkTS 从 rawfile 读入后原样传入，**不走 JSON 转义**）
 * @param doBoot `true` ⇒ eval 后调 `__proteusHostAppBootJson()`（生产形态）；
 *               `false` ⇒ 只 eval（"只验 VM 存活"的诊断形态）
 */
inline std::string sessionOpen(const std::string& bundleJs, bool doBoot = true) {
    SessionState& S = state();
    if (S.open) return "{\"ok\":false,\"error\":\"会话已打开（先 close）\"}";
    S.reset();   // ★重置（含清空 pending / 计数）

    std::string err;
    OH_JSVM_Init(nullptr);
    JSVM_CreateVMOptions vo;
    memset(&vo, 0, sizeof(vo));

    if (OH_JSVM_CreateVM(&vo, &S.vm) != JSVM_OK || S.vm == nullptr) err = "CreateVM 失败";
    if (err.empty() && OH_JSVM_OpenVMScope(S.vm, &S.vmScope) != JSVM_OK) err = "OpenVMScope 失败";
    if (err.empty() && OH_JSVM_CreateEnv(S.vm, 0, nullptr, &S.env) != JSVM_OK) err = "CreateEnv 失败";
    // ★外层 scope 全程不关（跨 tick 的 JS 值要活在这里）
    if (err.empty() && OH_JSVM_OpenHandleScope(S.env, &S.outerScope) != JSVM_OK) err = "OpenHandleScope 失败";
    if (err.empty() && OH_JSVM_SetMicrotaskPolicy(S.vm, JSVM_MICROTASK_EXPLICIT) != JSVM_OK) err = "SetMicrotaskPolicy 失败";

    if (err.empty()) {
        std::string why;
        if (!vmsEval(S.env,
                     "globalThis.__PROTEUS_HOST_ID__ = 'harmony';"
                     "globalThis.__PROTEUS_HOST_FRAME_DRIVER__ = 'postFrameCallback';"
                     "globalThis.__proteusSessionTicks = 0;",
                     why)) {
            err = "环境预置失败：" + why;
        }
    }
    // 注入 proteusHost（invoke + invokeBytes 两条腿；与一次性 VM 同一实现）
    if (err.empty()) {
        JSVM_Value host = nullptr;
        OH_JSVM_CreateObject(S.env, &host);
        struct NamedFn { const char* name; JSVM_CallbackStruct cb; };
        NamedFn fns[] = {
            {"invoke", {InvokeCbJson, nullptr}},
            {"invokeBytes", {InvokeBytesCb, nullptr}},
            {"mount", {NoopCbS, nullptr}},
            {"applyOps", {NoopCbS, nullptr}},
            {"getScroll", {ZeroCbS, nullptr}},
            {"setScroll", {NoopCbS, nullptr}},
            {"onGesture", {NoopCbS, nullptr}},
        };
        for (auto& f : fns) {
            JSVM_Value fn = nullptr;
            if (OH_JSVM_CreateFunction(S.env, f.name, JSVM_AUTO_LENGTH, &f.cb, &fn) != JSVM_OK) {
                err = "CreateFunction 失败";
                break;
            }
            OH_JSVM_SetNamedProperty(S.env, host, f.name, fn);
        }
        if (err.empty() && !installInvokeBytes(S.env, host)) err = "installInvokeBytes 失败";
        if (err.empty()) {
            JSVM_Value global = nullptr;
            OH_JSVM_GetGlobal(S.env, &global);
            OH_JSVM_SetNamedProperty(S.env, global, "proteusHost", host);
        }
    }
    // eval 整包
    if (err.empty()) {
        std::string why;
        if (!vmsEval(S.env, bundleJs.c_str(), why)) err = "bundle eval 失败：" + why;
    }
    // boot（★会话开一次 —— 这是生产形态；每轮重复 boot 会累积应用实例，见 #1343 的教训）
    if (err.empty() && doBoot) {
        std::string hook, why;
        if (!vmsToString(S.env, "typeof globalThis.__proteusHostAppBootJson", hook, why)) {
            S.bootState = "probe:" + why;
        } else if (hook != "function") {
            S.bootState = "no-hook(" + hook + ")";
        } else {
            std::string bootWhy;
            if (vmsEval(S.env, "String(globalThis.__proteusHostAppBootJson())", bootWhy)) {
                S.bootState = "booted";
            } else {
                // ★boot 失败**不等于**会话不可用（整包可能还需要更多宿主方法）：
                //   如实记录，会话仍打开（供 tick 验证"VM 存活 + 状态保留"）。
                S.bootState = "boot-failed:" + bootWhy;
            }
        }
    } else if (err.empty()) {
        S.bootState = "skipped";
    }

    if (!err.empty()) {
        // 建会话失败 ⇒ 反序清理（不留半开的 VM）
        if (S.env != nullptr && S.outerScope != nullptr) OH_JSVM_CloseHandleScope(S.env, S.outerScope);
        if (S.env != nullptr) OH_JSVM_DestroyEnv(S.env);
        if (S.vm != nullptr && S.vmScope != nullptr) OH_JSVM_CloseVMScope(S.vm, S.vmScope);
        if (S.vm != nullptr) OH_JSVM_DestroyVM(S.vm);
        S.reset();
        S.lastError = err;
        return statsJson(false);
    }

    S.open = true;
    S.heapKB = heapUsedKB(S.vm);
    return statsJson(true);
}

/**
 * 会话节拍：**唯一允许操作 JS 的地方**（ArkTS 主线程串行调用）。
 *
 * 每拍固定四步：
 *   ① 取走队列里的待回推帧（网络线程放进去的）
 *   ② 逐个推给 JS：`__proteusHostResolveBytes(Uint8Array([...]))`
 *   ③ `PerformMicrotaskCheckpoint`（EXPLICIT 策略下只有宿主推进才跑 Promise）
 *   ④ 读堆 + JS 侧计数，返回读数
 *
 * ★**为什么"先推帧、后 checkpoint"**：推帧会 resolve 一个 Promise，它的 `.then` 是微任务
 *   ⇒ 必须紧跟 checkpoint，否则回调要等下一拍（延迟 +1 frame）。
 */
inline std::string sessionTick(int maxPush = 64) {
    SessionState& S = state();
    if (!S.open || S.env == nullptr) return "{\"ok\":false,\"error\":\"会话未打开\"}";

    // ① 取帧（锁内只搬运，不在锁内碰 JS）
    std::vector<std::string> batch;
    {
        std::lock_guard<std::mutex> lk(S.mu);
        const size_t want = static_cast<size_t>(maxPush > 0 ? maxPush : 0);
        const size_t n = S.pendingFrames.size() < want ? S.pendingFrames.size() : want;
        batch.assign(S.pendingFrames.begin(), S.pendingFrames.begin() + static_cast<long>(n));
        S.pendingFrames.erase(S.pendingFrames.begin(), S.pendingFrames.begin() + static_cast<long>(n));
        S.pendingDepth = static_cast<int>(S.pendingFrames.size());
    }

    std::string err;
    int pushed = 0;
    JSVM_HandleScope inner = nullptr;
    if (OH_JSVM_OpenHandleScope(S.env, &inner) != JSVM_OK) {
        return "{\"ok\":false,\"error\":\"OpenHandleScope(inner) 失败\"}";
    }
    // ② 推帧
    for (const std::string& frame : batch) {
        const std::string js = "typeof globalThis.__proteusHostResolveBytes === 'function'"
                               " ? (globalThis.__proteusHostResolveBytes(Uint8Array.from([" +
                               bytesToJsArray(frame) + "])), 1) : 0";
        std::string why;
        if (!vmsEval(S.env, js.c_str(), why)) {
            err = "推回推帧失败：" + why;
            break;
        }
        pushed++;
    }
    // ③ checkpoint（推帧失败也要跑：让已 resolve 的 Promise 前进）
    if (err.empty() && OH_JSVM_PerformMicrotaskCheckpoint(S.vm) != JSVM_OK) {
        err = "PerformMicrotaskCheckpoint 失败";
    }
    // 灌 tick 计数（判据用它证明**同一 JS 上下文**在跨调用存活）
    if (err.empty()) {
        std::string why;
        if (!vmsEval(S.env, "globalThis.__proteusSessionTicks = (globalThis.__proteusSessionTicks || 0) + 1", why)) {
            err = "tick 计数失败：" + why;
        }
    }
    OH_JSVM_CloseHandleScope(S.env, inner);

    S.ticks++;
    S.resolvedPushed += pushed;
    S.heapKB = heapUsedKB(S.vm);

    // ④ 读数（附 JS 侧计数器 —— 跨调用看到它递增 = 会话态真的保留了）
    std::string jsTicks = "-1";
    if (err.empty()) {
        std::string out, why;
        if (vmsToString(S.env, "String(globalThis.__proteusSessionTicks)", out, why)) jsTicks = out;
    }
    std::string res = "{\"ok\":";
    res += err.empty() ? "true" : "false";
    res += ",\"ticks\":" + std::to_string(S.ticks);
    res += ",\"pushed\":" + std::to_string(pushed);
    res += ",\"pendingDepth\":" + std::to_string(S.pendingDepth);
    res += ",\"maxPendingDepth\":" + std::to_string(S.maxPendingDepth);
    {
        char hb[32];
        snprintf(hb, sizeof(hb), "%.1f", S.heapKB);
        res += ",\"heapKB\":" + std::string(hb);
    }
    res += ",\"jsTicks\":" + jsTicks;
    res += ",\"boot\":\"" + jsonEscape(S.bootState) + "\"";
    if (!err.empty()) res += ",\"error\":\"" + jsonEscape(err) + "\"";
    res += "}";
    return res;
}

/** 关闭会话（反序销毁；幂等） */
inline std::string sessionClose() {
    SessionState& S = state();
    if (!S.open) return "{\"ok\":true,\"already\":true}";
    const int ticks = S.ticks;
    const int resolved = S.resolvedPushed;
    if (S.env != nullptr && S.outerScope != nullptr) OH_JSVM_CloseHandleScope(S.env, S.outerScope);
    if (S.env != nullptr) OH_JSVM_DestroyEnv(S.env);
    if (S.vm != nullptr && S.vmScope != nullptr) OH_JSVM_CloseVMScope(S.vm, S.vmScope);
    if (S.vm != nullptr) OH_JSVM_DestroyVM(S.vm);
    S.reset();
    return "{\"ok\":true,\"closed\":true,\"ticks\":" + std::to_string(ticks) +
           ",\"pushed\":" + std::to_string(resolved) + "}";
}

}  // namespace vmsess
}  // namespace proteus

/* ══════════════════════ napi 入口（注册在 proteus_host.cpp） ══════════════════════ */

/**
 * ★★★#1344 B-1：会话式 VM 的四个 napi 入口。
 *
 * ★**为什么 napi 入口要单独一组（不复用 `hostAppRender`）**：
 *   一次性入口的语义是"调一次 = 完整跑一遍"（建 VM → eval → 销毁）；
 *   会话入口的语义是"开一次会话，之后每拍只推微任务"。两者**生命周期模型不同**，
 *   混在同一个函数里用标志位切换会让两条路径都难以理解。
 * ★**为什么 open 收 bundle 原文而不是 JSON**：1.5MB 走 JSON 要全量转义（慢且易踩引号/换行）。
 */
inline napi_value HostVmSessionOpen(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value args[2] = {nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string out;
    if (argc < 1 || args[0] == nullptr) {
        out = "{\"ok\":false,\"error\":\"需要 (bundleJs, doBoot?)\"}";
    } else {
        size_t blen = 0;
        if (napi_get_value_string_utf8(env, args[0], nullptr, 0, &blen) != napi_ok) {
            out = "{\"ok\":false,\"error\":\"bundleJs 读取失败\"}";
        } else {
            std::string bundleJs(blen + 1, '\0');
            napi_get_value_string_utf8(env, args[0], &bundleJs[0], bundleJs.size(), &blen);
            bundleJs.resize(blen);
            bool doBoot = true;
            if (argc >= 2 && args[1] != nullptr) {
                bool b = true;
                if (napi_get_value_bool(env, args[1], &b) == napi_ok) doBoot = b;
            }
            out = proteus::vmsess::sessionOpen(bundleJs, doBoot);
        }
    }
    napi_value r;
    napi_create_string_utf8(env, out.c_str(), out.size(), &r);
    return r;
}

/** `hostVmSessionTick(maxPush?)` → 读数 JSON */
inline napi_value HostVmSessionTick(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    int maxPush = 64;
    if (argc >= 1 && args[0] != nullptr) {
        int32_t v = 0;
        if (napi_get_value_int32(env, args[0], &v) == napi_ok && v > 0 && v <= 10000) maxPush = v;
    }
    const std::string out = proteus::vmsess::sessionTick(maxPush);
    napi_value r;
    napi_create_string_utf8(env, out.c_str(), out.size(), &r);
    return r;
}

/**
 * `hostVmSessionPushResolve(frameHex?)` —— **诊断用**：从 ArkTS 侧塞一个假回推帧进队列，
 * 验证"队列 → tick → JS"这条搬运链真的通了（不必等真网络请求）。
 * 入参是**十六进制字符串**（ArkTS 侧拼一个 PRSP 帧即可）。
 */
inline napi_value HostVmSessionPushResolve(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string hex, out;
    if (argc >= 1 && args[0] != nullptr) {
        size_t len = 0;
        napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
        hex.resize(len + 1, '\0');
        napi_get_value_string_utf8(env, args[0], &hex[0], hex.size(), &len);
        hex.resize(len);
    }
    // hex → 原始字节（奇数长度/非法字符 ⇒ 如实报错，不猜）
    std::string bytes;
    bool bad = (hex.size() % 2) != 0;
    for (size_t i = 0; !bad && i + 1 < hex.size(); i += 2) {
        auto nib = [](char c) -> int {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            return -1;
        };
        const int hi = nib(hex[i]);
        const int lo = nib(hex[i + 1]);
        if (hi < 0 || lo < 0) { bad = true; break; }
        bytes.push_back(static_cast<char>((hi << 4) | lo));
    }
    if (bad) {
        out = "{\"ok\":false,\"error\":\"frameHex 非法（需偶数长度十六进制）\"}";
    } else {
        const int depth = proteus::vmsess::pushResolve(bytes);
        out = "{\"ok\":true,\"queued\":true,\"pendingDepth\":" + std::to_string(depth) + "}";
    }
    napi_value r;
    napi_create_string_utf8(env, out.c_str(), out.size(), &r);
    return r;
}

/** `hostVmSessionClose()` / `hostVmSessionStats()` */
inline napi_value HostVmSessionClose(napi_env env, napi_callback_info info) {
    (void)info;
    const std::string out = proteus::vmsess::sessionClose();
    napi_value r;
    napi_create_string_utf8(env, out.c_str(), out.size(), &r);
    return r;
}

inline napi_value HostVmSessionStats(napi_env env, napi_callback_info info) {
    (void)info;
    const std::string out = proteus::vmsess::statsJson(proteus::vmsess::state().open);
    napi_value r;
    napi_create_string_utf8(env, out.c_str(), out.size(), &r);
    return r;
}
