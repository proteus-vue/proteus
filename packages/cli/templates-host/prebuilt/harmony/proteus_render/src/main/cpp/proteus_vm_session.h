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
#include <map>
#include <mutex>
#include <thread>
#include <cstdio>
#include <cstring>
#include <cstdlib>

#include "proteus_host_helpers.h"
#include "invoke_bytes_bridge.h"
#include "proteus_http.h"   // ★B-2c：读 stats()（取消记账 = 判据的唯一直接证据）
#include <hilog/log.h>
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
    /** 微任务策略（诊断：EXPLICIT 崩、AUTO 待验） */
    bool microtaskAuto = false;

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
        microtaskAuto = false;
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
    // ★诊断：boot 期一定会走这条（整包启动要调 invoke）；崩在这里会看到这条日志但看不到下一条
    OH_LOG_Print(LOG_APP, LOG_INFO, 0x0003, "ProteusSession",
                 "SESSION_INVOKE method=%{public}s handler=%{public}s out=%{public}.80s",
                 method.c_str(), g_proteusGenericInvoke ? "yes" : "no", out.c_str());
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

/* ══════════════════════ B-2c：在途表 + 真取消 ══════════════════════ */

/** 一条在途请求（`reqId` → 可取消的 RCP 句柄） */
struct InflightEntry {
    void* session = nullptr;
    void* req = nullptr;
};

/**
 * 在途表（`reqId` → 句柄）。★加锁：`handle()` 在**工作线程**登记/注销，`cancel` 在**主线程**查表。
 *
 * 【为什么必须加锁而不是"主线程独占"】登记发生在工作线程（`httpAsyncDispatch` 起的那个），
 *   而 `abort()` 在主线程到达 ⇒ 两侧并发访问同一张表。
 */
inline std::map<std::string, InflightEntry>& inflightTable() {
    static std::map<std::string, InflightEntry> t;
    return t;
}
inline std::mutex& inflightMu() {
    static std::mutex m;
    return m;
}

/** 登记（由 `proteus_http.h` 在 createRequest 之后调用） */
inline void registerInflight(const std::string& reqId, void* session, void* req) {
    std::lock_guard<std::mutex> lk(inflightMu());
    inflightTable()[reqId] = InflightEntry{session, req};
}

/** 注销（成功/失败/超时都调） */
inline void unregisterInflightEntry(const std::string& reqId) {
    std::lock_guard<std::mutex> lk(inflightMu());
    inflightTable().erase(reqId);
}

/**
 * ★★★B-2c：**真取消**（`http.cancel`）。
 *
 * 【它做了什么】查在途表 → 拿到该请求的 `Rcp_Session*` + `Rcp_Request*`
 *   → 调 `HMS_Rcp_CancelRequest` ⇒ **宿主传输真的中止**（不是只 reject 本地 Promise）。
 *
 * 【诚实边界】
 *   · 只在**会话模式**有在途表（一次性 VM 不登记）⇒ 一次性路径仍回 `supported:false`（如实）。
 *   · 取消后那条请求的回推帧**不会再来**（工作线程会拿到 cancel 的错误码并 pushResolve 一个 err 帧）。
 *     JS 侧 `abort()` 已在本地 reject，那个迟到帧会因 reqId 不在 pending 表而被丢弃（无害）。
 *   · 返回 `{cancelled:true}` = **已向宿主发出取消**，不是"确认已经停了"（传输层异步）。
 */
inline std::string cancelInflight(const std::string& reqId) {
    void* session = nullptr;
    void* req = nullptr;
    {
        std::lock_guard<std::mutex> lk(inflightMu());
        auto it = inflightTable().find(reqId);
        if (it == inflightTable().end()) {
            // ★诊断：**帧到了但表里没有** ⇒ 单独记账（否则与"帧没到"同形，见 Stats 注释）。
            //   ★这条读数同时告诉我们"JS 侧的 reqId 与登记时用的 reqId 是否同一个"。
            proteus::http::stats().cancelNoInflight++;
            OH_LOG_Print(LOG_APP, LOG_INFO, 0x0003, "ProteusSession",
                         "SESSION_CANCEL_NO_INFLIGHT req=%{public}s depth=%{public}d",
                         reqId.c_str(), static_cast<int>(inflightTable().size()));
            return "{\"ok\":true,\"data\":{\"cancelled\":false,\"reason\":\"no-inflight\","
                   "\"note\":\"该 reqId 不在在途表中（可能已完成 / 或本端未经会话通道）\"}}";
        }
        session = it->second.session;
        req = it->second.req;
    }
    // ★调 RCP 的 cancel（符号缺 ⇒ 如实报 unsupported，不假装成功）
    const bool called = proteus::http::cancelRcpRequest(session, req);
    if (!called) {
        return "{\"ok\":true,\"data\":{\"cancelled\":false,\"reason\":\"rcp-cancel-unavailable\","
               "\"note\":\"本机 RCP 库缺 HMS_Rcp_CancelRequest 符号\"}}";
    }
    OH_LOG_Print(LOG_APP, LOG_INFO, 0x0003, "ProteusSession",
                 "SESSION_CANCEL req=%{public}s called=1", reqId.c_str());
    return "{\"ok\":true,\"data\":{\"cancelled\":true,\"note\":\"已向宿主发出取消（传输层异步生效）\"}}";
}

/** 在途表深度（诊断） */
inline int inflightDepth() {
    std::lock_guard<std::mutex> lk(inflightMu());
    return static_cast<int>(inflightTable().size());
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

/**
 * ★★★#1344 B-3：**流式块入队**（注册进 `proteus_http_guard.h` 的 `setHttpStreamHandler`）。
 *
 * 【它做什么】把 RCP 逐块回调送来的一个数据块编成 **PRSP 块帧**（带 `streamSeq`）入队，
 *   由下一次 `sessionTick()` 推给 JS 的 `__proteusHostResolveBytes` ⇒
 *   `capability-invoke.settleHostCallBytes` 按 `onChunk` 交给业务。
 *   语义与 Android/iOS 的流式对齐（**同一套 seq 连续性判据**：JS 侧跳号即报丢帧）。
 *
 * 【★★★线程纪律（本函数由 RCP 的**网络线程**调用）】
 *   只能做纯内存操作 + 加锁入队，**绝不能碰 `JSVM_Env`**（那会随机崩）。
 *   `pushResolve` 本身就是"唯一跨线程入口"，所以这里就是它的一个调用点。
 *
 * 【诚实边界】
 *   · 块在**入队时拷贝**（`std::string`）⇒ 回调返回后 RCP 复用缓冲区不影响我们。
 *   · 入队不做背压：JS 侧 `sessionTick(maxPush)` 每次最多推 64 帧，队列可能短期增长；
 *     真正的上限由 JS 侧 `MAX_STREAM_CHUNKS`（超限即 reject）与宿主 `MAX_BODY_BYTES` 守。
 *     ★"推得快、消费慢"的场景（高频大流）应换有界队列 + 反压（后续项，本轮先打通语义）。
 *
 * @return 已处理字节数（`recvGate` 契约：一律回 `len`）
 */
inline size_t pushStreamChunk(const std::string& reqId, uint32_t seq, const uint8_t* data, size_t len) {
    proteus::wire::ResolveFrame f = proteus::wire::ResolveFrame::okOf(reqId);
    f.streamSeq = seq;
    if (data != nullptr && len > 0) f.body.assign(data, data + len);
    const std::vector<uint8_t> enc = proteus::wire::encodeResolve(f);
    pushResolve(std::string(enc.begin(), enc.end()));
    return len;
}

/**
 * ★★★B-2：**HTTP 异步分派**（注册进 `invoke_bytes_bridge.h` 的 `setHttpAsyncHandler`）。
 *
 * 做三件事：
 *   ① 立即返回 **pending 帧**（JS 侧 `invokeHostAsyncBytes` 收到 `pending:true` 就等，不结算）
 *   ② 起一个工作线程跑 `proteus::http::handle(f)`（**纯 HTTP，不碰 JSVM**）
 *   ③ 跑完把 resolve 帧 `pushResolve()` 入队，等下一次 `sessionTick()` 推给 JS
 *
 * 【★★★线程边界（本函数唯一需要小心的地方）】
 *   · 工作线程里**只**调 `http::handle`（不碰 `JSVM_Env`）+ `pushResolve`（加锁入队）
 *   · **绝不在工作线程里碰 `env`** —— 那会随机崩（`JSVM_Env` 只能由创建它的线程用）
 *   · 帧字节在入队时交出所有权（`pushResolve` 存 `std::string` 副本）⇒ 无悬垂
 *
 * 【诚实边界】
 *   · 每个请求起一个线程并 detach。量小可接受；高频场景应换有界线程池（后续项，本轮先打通）。
 */
inline std::string httpAsyncDispatch(const proteus::wire::InvokeFrame& f) {
    // ① 立即回 pending（让 JS 侧知道"已受理，等回推"）
    const proteus::wire::ResolveFrame pf = proteus::wire::ResolveFrame::pendingOf(f.reqId);
    const std::vector<uint8_t> pendingBytes = proteus::wire::encodeResolve(pf);

    // ② 拷一份帧（调用方栈上的 `f` 在返回后失效）
    auto* frameCopy = new proteus::wire::InvokeFrame(f);
    // ③ 起工作线程（detach：会话关闭时若还有在飞请求，让它跑完自然退出；
    //    `pushResolve` 在会话关闭后仍安全——只是入队没人取，下次 open 会 reset 清掉）
    std::thread([frameCopy]() {
        std::string outBytes;
        try {
            const proteus::wire::ResolveFrame rf = proteus::http::handle(*frameCopy);
            const std::vector<uint8_t> enc = proteus::wire::encodeResolve(rf);
            outBytes.assign(enc.begin(), enc.end());
            OH_LOG_Print(LOG_APP, LOG_INFO, 0x0003, "ProteusSession",
                         "SESSION_HTTP_DONE req=%{public}s ok=%{public}d status=%{public}u",
                         rf.reqId.c_str(), rf.ok ? 1 : 0, rf.status ? *rf.status : 0u);
        } catch (const std::exception& e) {
            // ★异常必须转成错误帧（否则请求永远挂着，JS 侧等到超时）
            const proteus::wire::ResolveFrame rf =
                proteus::wire::ResolveFrame::err(frameCopy->reqId, std::string("http.request 宿主异常：") + e.what());
            const std::vector<uint8_t> enc = proteus::wire::encodeResolve(rf);
            outBytes.assign(enc.begin(), enc.end());
            OH_LOG_Print(LOG_APP, LOG_ERROR, 0x0003, "ProteusSession",
                         "SESSION_HTTP_THROW req=%{public}s err=%{public}s", frameCopy->reqId.c_str(), e.what());
        } catch (...) {
            const proteus::wire::ResolveFrame rf =
                proteus::wire::ResolveFrame::err(frameCopy->reqId, "http.request 宿主未知异常");
            const std::vector<uint8_t> enc = proteus::wire::encodeResolve(rf);
            outBytes.assign(enc.begin(), enc.end());
        }
        delete frameCopy;
        // ★只入队，不碰 JS（本线程不是 JS 线程）
        pushResolve(outBytes);
    }).detach();

    std::string out(pendingBytes.begin(), pendingBytes.end());
    return out;
}

/**
 * 把一个完整回程帧（PRSP 原始字节）排队，等下一次 `sessionTick()` 推给 JS。
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
inline std::string sessionOpen(const std::string& bundleJs, bool doBoot = true, bool jsStubHost = false, bool autoMicrotask = true) {
    SessionState& S = state();
    if (S.open) return "{\"ok\":false,\"error\":\"会话已打开（先 close）\"}";
    S.reset();   // ★重置（含清空 pending / 计数）
    // ★★★逐步 hilog：会话崩溃时 hilog 是唯一能定位"崩在哪一步"的通道
    //   （实测：进程 HandleAppDied 且 `faultlog Unsupported` ⇒ 拿不到崩溃栈）。
    #define VMS_LOG(step) do { OH_LOG_Print(LOG_APP, LOG_INFO, 0x0003, "ProteusSession", "SESSION_STEP %{public}s", step); } while (0)
    VMS_LOG("enter");

    std::string err;
    OH_JSVM_Init(nullptr);
    JSVM_CreateVMOptions vo;
    memset(&vo, 0, sizeof(vo));

    if (OH_JSVM_CreateVM(&vo, &S.vm) != JSVM_OK || S.vm == nullptr) err = "CreateVM 失败";
    VMS_LOG(err.empty() ? "vm-created" : "vm-failed");
    if (err.empty() && OH_JSVM_OpenVMScope(S.vm, &S.vmScope) != JSVM_OK) err = "OpenVMScope 失败";
    if (err.empty() && OH_JSVM_CreateEnv(S.vm, 0, nullptr, &S.env) != JSVM_OK) err = "CreateEnv 失败";
    VMS_LOG(err.empty() ? "env-created" : "env-failed");
    /* ★★★#1344 关键修正：**不再长期持有外层 HandleScope**。
       实测（真机）：长期开着一个 scope + 跨调用 checkpoint 真实 Vue 微任务
       ⇒ 崩在 `OH_JSVM_PerformMicrotaskCheckpoint`（与本仓 #540 记的 `HandleScope::Extend` 溢出同族）。
       根因：scope 长期不关 ⇒ checkpoint 期间 Vue 调度器创建的所有临时句柄都堆在这一个 scope 里，
       只增不减 ⇒ 撑爆。
       ⇒ 正确形态：**open 阶段用一个内层 scope 包住整段（预置+注入+eval+boot），结束后立刻关掉**；
         需要跨 tick 存活的状态全部放在 `globalThis` 上（JS 侧本来就在全局，不依赖 C++ 句柄）。
         每次 tick 再各自开/关自己的 scope ⇒ 句柄有了明确的生命周期。 */
    JSVM_HandleScope openScope = nullptr;
    if (err.empty() && OH_JSVM_OpenHandleScope(S.env, &openScope) != JSVM_OK) err = "OpenHandleScope 失败";
    /* ★★★微任务策略 = **AUTO**（默认）。
       【这是本轮最重要的发现，推翻了 #540 的一半】
       真机 A/B 矩阵（同一 VM、同一 bundle、都 boot）：
         · `EXPLICIT` + C++ napi 回调 + 真实 Vue 微任务 ⇒ **第一拍 checkpoint 就崩**
         · `EXPLICIT` + C++ 回调 + 不 boot                ⇒ 通过
         · `EXPLICIT` + JS 桩    + boot                   ⇒ 通过
         · **`AUTO`   + C++ 回调 + boot                   ⇒ 通过**（1000 拍零崩溃）
       ⇒ 崩的不是"持久 VM"，也不是"napi 回调"，而是 **EXPLICIT 策略下由宿主显式 checkpoint
         真实 Vue 调度器的微任务**（与 #540 记的 `HandleScope::Extend` 溢出同族）。
       ★当年为了规避 #540 选了 EXPLICIT，恰恰是它导致了崩溃 —— 这是个"规避方案成了病因"的案例。
       ★`autoMicrotask=false` 仍保留（诊断用）；生产路径一律 AUTO。 */
    if (err.empty()) {
        const JSVM_MicrotaskPolicy pol = autoMicrotask ? JSVM_MICROTASK_AUTO : JSVM_MICROTASK_EXPLICIT;
        if (OH_JSVM_SetMicrotaskPolicy(S.vm, pol) != JSVM_OK) err = "SetMicrotaskPolicy 失败";
        S.microtaskAuto = autoMicrotask;
    }
    VMS_LOG(err.empty() ? "scope+policy" : "scope-failed");

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
    /* ★★★诊断模式（`jsStubHost=true`）：用 **JS 侧桩** 代替 C++ napi 回调。
       为什么需要它：bundle 探针（用 JS 桩）200 轮零崩溃，而会话（用 C++ 回调）第一拍
       checkpoint 就崩 —— 两者 eval 同一个 bundle、都 boot、都 checkpoint。**唯一结构差异就是
       `proteusHost` 是 JS 函数还是 napi 回调**。这个开关就是把该变量单独隔离出来验。 */
    VMS_LOG(jsStubHost ? "pre-inject-jsstub" : "pre-inject");
    if (err.empty() && jsStubHost) {
        std::string why;
        if (!vmsEval(S.env,
                     "globalThis.__probeHostCalls = 0;"
                     "globalThis.proteusHost = {"
                     "  invoke: function (m, a) { globalThis.__probeHostCalls++;"
                     "    return JSON.stringify({ ok: false, missing: true, reason: 'session js-stub: ' + m }); },"
                     "  invokeBytes: function () { return null; },"
                     "  mount: function () {}, applyOps: function () {}, getScroll: function () { return 0; },"
                     "  setScroll: function () {}, onGesture: function () {}"
                     "};",
                     why)) {
            err = "JS 桩注入失败：" + why;
        }
        VMS_LOG("host-jsstub-attached");
    }
    // 注入 proteusHost（invoke + invokeBytes 两条腿；与一次性 VM 同一实现）
    if (err.empty() && !jsStubHost) {
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
                err = std::string("CreateFunction 失败：") + f.name;
                break;
            }
            OH_JSVM_SetNamedProperty(S.env, host, f.name, fn);
        }
        VMS_LOG("host-fns-created");
        if (err.empty() && !installInvokeBytes(S.env, host)) err = "installInvokeBytes 失败";
        VMS_LOG(err.empty() ? "invoke-bytes-installed" : "invoke-bytes-failed");
        if (err.empty()) {
            JSVM_Value global = nullptr;
            OH_JSVM_GetGlobal(S.env, &global);
            OH_JSVM_SetNamedProperty(S.env, global, "proteusHost", host);
        }
        VMS_LOG("host-attached");
    }
    // eval 整包
    VMS_LOG("pre-bundle-eval");
    if (err.empty()) {
        std::string why;
        if (!vmsEval(S.env, bundleJs.c_str(), why)) err = "bundle eval 失败：" + why;
    }
    VMS_LOG(err.empty() ? "bundle-evaled" : "bundle-eval-failed");
    // boot（★会话开一次 —— 这是生产形态；每轮重复 boot 会累积应用实例，见 #1343 的教训）
    if (err.empty() && doBoot) {
        VMS_LOG("pre-boot-typeof");
        std::string hook, why;
        if (!vmsToString(S.env, "typeof globalThis.__proteusHostAppBootJson", hook, why)) {
            S.bootState = "probe:" + why;
        } else if (hook != "function") {
            S.bootState = "no-hook(" + hook + ")";
        } else {
            VMS_LOG("pre-boot-call");
            std::string bootWhy;
            if (vmsEval(S.env, "String(globalThis.__proteusHostAppBootJson())", bootWhy)) {
                S.bootState = "booted";
            } else {
                // ★boot 失败**不等于**会话不可用（整包可能还需要更多宿主方法）：
                //   如实记录，会话仍打开（供 tick 验证"VM 存活 + 状态保留"）。
                S.bootState = "boot-failed:" + bootWhy;
            }
            VMS_LOG("post-boot-call");
        }
    } else if (err.empty()) {
        S.bootState = "skipped";
    }

    if (!err.empty()) {
        // 建会话失败 ⇒ 反序清理（不留半开的 VM）
        if (S.env != nullptr && openScope != nullptr) OH_JSVM_CloseHandleScope(S.env, openScope);
        if (S.env != nullptr) OH_JSVM_DestroyEnv(S.env);
        if (S.vm != nullptr && S.vmScope != nullptr) OH_JSVM_CloseVMScope(S.vm, S.vmScope);
        if (S.vm != nullptr) OH_JSVM_DestroyVM(S.vm);
        S.reset();
        S.lastError = err;
        return statsJson(false);
    }

    S.open = true;
    S.heapKB = heapUsedKB(S.vm);
    /* ★★★B-2：注册 HTTP 异步钩子 —— 之后 `http.request` 走 pending + 工作线程 + tick 回推。
       ★只在会话打开期间注册（close 时注销）⇒ 一次性 VM 生产路径零影响。 */
    setHttpAsyncHandler(&httpAsyncDispatch);
    // ★B-2c：登记/注销钩子 —— `handle()` 借此把 (session, req) 交出来，cancel 才能真中止
    proteus::http::setHttpRegisterHandler(&registerInflight);
    proteus::http::setHttpUnregisterHandler(&unregisterInflightEntry);
    // ★B-2c：`http.cancel` 的分派钩子（一次性 VM 下为 nullptr ⇒ 仍是原来的 no-op 文案）
    proteus::http::setSessionCancelHandler(&cancelInflight);
    // ★B-3：流式块回推钩子（注册后 `stream:true` 才被放行 —— 见 `proteus_http_guard.h`）
    proteus::http::setHttpStreamHandler(&pushStreamChunk);
    // ★关掉 open 阶段的内层 scope（状态全在 globalThis，句柄可以回收）
    if (openScope != nullptr) OH_JSVM_CloseHandleScope(S.env, openScope);
    VMS_LOG("open-scope-closed");
    VMS_LOG("pre-stats");
    {
        const std::string js = statsJson(true);
        VMS_LOG("pre-return");
        #undef VMS_LOG
        return js;
    }
}

/**
 * ★★★#1344 B-2：**在会话内 eval 一段 JS**（业务入口的统一接线点）。
 *
 * 【为什么需要它】会话打开后，要让 JS 侧发起真实请求（`useFetch(...)`）、注册回调、读状态，
 *   都必须**在这个长活的 VM 里**跑。没有它，`http.request` 的异步链路就无法从 JS 侧发起
 *   （只能在 C++ 侧伪造帧，验不到业务链）。
 *
 * 【语义】eval → `PerformMicrotaskCheckpoint`（AUTO 策略下 JSVM 自己也会跑，但显式推一次
 *   让"刚 eval 出的 Promise 的 .then"立刻前进）→ 返回**结果字符串**。
 * ★只能由 ArkTS 主线程调用（与 open/tick/close 同纪律）。
 * ★返回值上限：结果太长会拖慢日志；调用方自己控制（本函数不截断，如实返回）。
 */
inline std::string sessionEval(const std::string& js) {
    SessionState& S = state();
    if (!S.open || S.env == nullptr) return "{\"ok\":false,\"error\":\"会话未打开\"}";
    JSVM_HandleScope inner = nullptr;
    if (OH_JSVM_OpenHandleScope(S.env, &inner) != JSVM_OK) {
        return "{\"ok\":false,\"error\":\"OpenHandleScope(inner) 失败\"}";
    }
    std::string out, why;
    const bool ok = vmsToString(S.env, js.c_str(), out, why);
    // ★checkpoint 在**关闭 scope 之前**（与 sessionTick 同纪律：句柄必须有活着的 scope）
    if (ok) OH_JSVM_PerformMicrotaskCheckpoint(S.vm);
    OH_JSVM_CloseHandleScope(S.env, inner);
    if (!ok) return "{\"ok\":false,\"error\":\"" + jsonEscape(why) + "\"}";
    // ★结果包成 JSON 字符串返回（避免调用方猜格式）
    return "{\"ok\":true,\"value\":\"" + jsonEscape(out) + "\"}";
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
    #define VTK_LOG(step) do { OH_LOG_Print(LOG_APP, LOG_INFO, 0x0003, "ProteusSession", "TICK_STEP %{public}s", step); } while (0)
    VTK_LOG("enter");
    if (OH_JSVM_OpenHandleScope(S.env, &inner) != JSVM_OK) {
        return "{\"ok\":false,\"error\":\"OpenHandleScope(inner) 失败\"}";
    }
    VTK_LOG("inner-opened");
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
    VTK_LOG("pre-checkpoint");
    if (err.empty() && OH_JSVM_PerformMicrotaskCheckpoint(S.vm) != JSVM_OK) {
        err = "PerformMicrotaskCheckpoint 失败";
    }
    VTK_LOG(err.empty() ? "checkpoint-ok" : "checkpoint-failed");
    // 灌 tick 计数（判据用它证明**同一 JS 上下文**在跨调用存活）
    if (err.empty()) {
        std::string why;
        if (!vmsEval(S.env, "globalThis.__proteusSessionTicks = (globalThis.__proteusSessionTicks || 0) + 1", why)) {
            err = "tick 计数失败：" + why;
        }
    }
    VTK_LOG(err.empty() ? "tickcount-ok" : "tickcount-failed");
    /* ★★★读 JS 侧计数器**必须在关闭 inner scope 之前**。
       实测踩过（进程 HandleAppDied、且 faultlog 不支持 ⇒ 没有崩溃栈，只能靠逐步日志定位）：
       我先 `CloseHandleScope(inner)` 再 `vmsToString(...)` ⇒ 在**已关闭的 scope 里创建新句柄**
       ⇒ 第一次 tick 就崩。这是 JSVM 的硬性纪律：任何创建句柄的 API 都必须在**活着的** scope 内调用。 */
    std::string jsTicks = "-1";
    if (err.empty()) {
        std::string out, why;
        if (vmsToString(S.env, "String(globalThis.__proteusSessionTicks)", out, why)) jsTicks = out;
    }
    OH_JSVM_CloseHandleScope(S.env, inner);
    VTK_LOG("inner-closed");
    #undef VTK_LOG

    S.ticks++;
    S.resolvedPushed += pushed;
    S.heapKB = heapUsedKB(S.vm);

    // ④ 读数（jsTicks 已在关闭 scope 前读好）
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
    // ★B-2：注销 HTTP 异步钩子（恢复一次性 VM 的同步语义）
    setHttpAsyncHandler(nullptr);
    // ★B-2c：注销登记钩子 + 清空在途表（会话关闭后没有"在途"可言）
    proteus::http::setHttpRegisterHandler(nullptr);
    proteus::http::setHttpUnregisterHandler(nullptr);
    proteus::http::setSessionCancelHandler(nullptr);
    // ★B-3：注销流式回推钩子（之后 stream 会恢复"如实拒绝"——不留下"看起来支持"的假象）
    proteus::http::setHttpStreamHandler(nullptr);
    {
        std::lock_guard<std::mutex> lk(inflightMu());
        inflightTable().clear();
    }
    // ★不再需要关 outerScope（#1344 修正后 open 阶段的内层 scope 已当次关闭）
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
    size_t argc = 4;
    napi_value args[4] = {nullptr, nullptr, nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string out;
    if (argc < 1 || args[0] == nullptr) {
        out = "{\"ok\":false,\"error\":\"需要 (bundleJs, doBoot?, jsStubHost?)\"}";
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
            bool jsStub = false;
            if (argc >= 3 && args[2] != nullptr) {
                bool b2 = false;
                if (napi_get_value_bool(env, args[2], &b2) == napi_ok) jsStub = b2;
            }
            // ★缺省 AUTO（生产路径）；显式传 false 才退回 EXPLICIT（诊断用）
            bool autoMt = true;
            if (argc >= 4 && args[3] != nullptr) {
                bool b3 = false;
                if (napi_get_value_bool(env, args[3], &b3) == napi_ok) autoMt = b3;
            }
            out = proteus::vmsess::sessionOpen(bundleJs, doBoot, jsStub, autoMt);
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

/** `hostVmSessionEval(js)` → `{ok, value}` / `{ok:false, error}`（会话内 eval，业务接线点） */
inline napi_value HostVmSessionEval(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string js, out;
    if (argc < 1 || args[0] == nullptr) {
        out = "{\"ok\":false,\"error\":\"需要 (js)\"}";
    } else {
        size_t len = 0;
        if (napi_get_value_string_utf8(env, args[0], nullptr, 0, &len) != napi_ok) {
            out = "{\"ok\":false,\"error\":\"js 读取失败\"}";
        } else {
            js.resize(len + 1, '\0');
            napi_get_value_string_utf8(env, args[0], &js[0], js.size(), &len);
            js.resize(len);
            out = proteus::vmsess::sessionEval(js);
        }
    }
    napi_value r;
    napi_create_string_utf8(env, out.c_str(), out.size(), &r);
    return r;
}

/**
 * ★★★B-2c：`hostVmSessionCancelStats()` → `{ok:true,value:'{"calls":N,"hits":N,"misses":N}'}`
 *
 * 【为什么单独一个 napi 入口，而不是让 JS 调 `proteusHost.invoke('http.cancelStats')`】
 *   实测：在会话里用 `hostVmSessionEval("proteusHost.invoke('http.cancelStats',...)")`
 *   **会崩**（会话内再触发一次宿主回调 = 重入，与 #540 那类微任务重入同族）。
 *   ⇒ 由宿主侧**直接读** `stats()`，绕开 JS 那一圈。这条也是判据的**唯一直接证据**
 *     （"宿主真的调了 HMS_Rcp_CancelRequest"），JS 侧读数证明不了。
 */
inline napi_value HostVmSessionCancelStats(napi_env env, napi_callback_info info) {
    (void)info;
    const proteus::http::Stats& st = proteus::http::stats();
    /* ★★★#1344 B-2c：**三个分支各一个计数**（`calls=0` 本身是三义的——见 `Stats` 注释）。
       `noInflight` / `unsupported` 任一非 0 ⇒ 取消没落地，且**直接指出是哪一步断的**。 */
    const std::string payload = "{\"calls\":" + std::to_string(st.cancelCalls) +
                                ",\"hits\":" + std::to_string(st.cancelHits) +
                                ",\"misses\":" + std::to_string(st.cancelMisses) +
                                ",\"noInflight\":" + std::to_string(st.cancelNoInflight) +
                                ",\"unsupported\":" + std::to_string(st.cancelUnsupported) + "}";
    const std::string out = "{\"ok\":true,\"value\":\"" + jsonEscape(payload) + "\"}";
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
