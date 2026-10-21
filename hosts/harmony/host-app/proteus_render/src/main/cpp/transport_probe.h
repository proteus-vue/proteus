// hosts/harmony/host-app/proteus_render/src/main/cpp/transport_probe.h
// ★★★决策 #1156：**鸿蒙传输层事实取证**（第三端）—— 连接复用 / HTTP 协商**是否在工作**。
//
// 【为什么要有它（承接 #1155 的诚实边界）】
//   #1155 在两处写了「**鸿蒙端未跑**（RCP 栈形态未取证）⇒ 三端里只有两端有读数」。当时的原因是
//   `hdc` 不在 PATH 上、被误判成"无设备"——**设备一直连着**（`bash hosts/harmony/hdc.sh list targets`
//   可证）。按纪律「下否定结论前先跑一条取证命令」，本轮把它补上。
//
// 【★动手前的证据（读源码，不是猜）】`proteus_http.h` 的 `handle()` 是：
//     建 session → 发一次请求 → **关 session**（`HMS_Rcp_CreateSession` / `HMS_Rcp_CloseSession`）
//   ⇒ 每个 `http.request` 都是**一个全新的 RCP session**。若 RCP 的连接池随 session 生灭，
//     鸿蒙端就**完全不复用 TCP 连接**——与 #1154 在 Android 上引入的那类回归同族
//     （功能全绿、零日志，只有"请求数 vs 连接数"看得出来）。
//   ⇒ 本探针对**同一个 host:port** 连发 N 个请求，由**服务端**（`h2-echo-server.mjs`）按
//     「对端 socket」记账判定复用。#1155 已验证该服务端的计量（`tests/transport-probe-accounting.test.ts`
//     4/4：同一会话 3 流算 1 条连接、三次新会话算 3 条）。
//
// 【★本探针只做"能测的"（诚实边界）】
//   · **连接复用**：可测 —— 明文端口即可，不需要 TLS（也就绕开了"鸿蒙宿主尚未暴露自定义 CA /
//     pinning 配置"这个问题；`Rcp_SecurityConfiguration` 里有 `certificateAuthority` / `remoteValidationType`，
//     但当前实现没接线）。
//   · **HTTP/2**：**不测** —— h2 走 TLS + ALPN，而自签证书需要宿主信任配置（未接线）。
//     不测就不写结论；等 pinning/CA 落进鸿蒙宿主时再补（已登记为后续项）。
//   · **耗时**：可测（墙钟，逐轮记录）。
//
// 【★必须用**同一个 VM** 连发 N 轮】
//   每轮都新建 VM 会把 VM 创建成本混进读数；且真机上"页面里的 N 次请求"本来就共享一个 VM。
//   ⇒ 一次建 VM，循环 eval N 次（每次一个新帧、一个新 path ⇒ 避开 HTTP 缓存与请求去重）。
#pragma once
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <string>
#include <vector>

#include "http_probe.h"   // ★复用 toHex/fromHex/jsvmEvalStr/jsonEscape/kInvokeBytesBridgeScript（同一 TU，无重复定义）

/** 墙钟毫秒（本探针**只**用它量每轮往返；宿主记账里没有"逐请求耗时"字段可借）。 */
static inline int64_t proteusTransportNowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

/**
 * ★★★#1156：napi 探针导出项的**统一形态**（`{"name", nullptr, Handler, nullptr …}`）。
 *
 * 【为什么要有这个宏】`proteus_host.cpp` 已在 `check:file-size` 的**存量棘轮**上（只减不增）；
 *   每加一个探针就 +2 行（一条注释 + 一个描述符），加两个就超基线。
 *   ⇒ 把它折成一行宏调用：**新增探针不再消耗该文件的行数**。
 *   ★这不是为了"糊弄门禁"：真正的好处是**探针注册的形态只有一处定义**——
 *     以前每行都要手抄 7 个字段（`nullptr, nullptr, nullptr, napi_default, nullptr`），
 *     抄错任一个都只在**运行时**表现为"这个函数不是函数"。
 */
#define PROTEUS_PROBE_EXPORT(NAME, HANDLER) \
    { #NAME, nullptr, HANDLER, nullptr, nullptr, nullptr, napi_default, nullptr }

#if PROTEUS_HAVE_RCP
/**
 * ★★★#1156 取证专用：用**异步** `HMS_Rcp_Fetch` 连发 N 轮（判"连接池是否只在异步路径生效"）。
 *
 * 【只给探针用，不进生产路径】生产仍是同步 `FetchSync`（一次性 VM 的约束，见 `proteus_http.h` 头注）。
 *   本函数存在的唯一目的，是回答"换 API 能不能解决复用"——回答完就该删掉或转正，不留双实现。
 *
 * ★判据口径：本函数只回**客户端读数**（状态码/字节/耗时/是否超时）；
 *   **复用结论仍由服务端 `/__stats` 定**（与 sync 模式、与 Android/iOS 完全同一判据）。
 */
struct AsyncCbState {
    std::mutex mu;
    std::condition_variable cv;
    bool done = false;
    uint32_t err = 0;
    uint32_t status = 0;
    size_t bytes = 0;
};

static void transportProbeAsyncCb(void* usr, Rcp_Response* resp, uint32_t errCode) {
    auto* s = static_cast<AsyncCbState*>(usr);
    std::lock_guard<std::mutex> lk(s->mu);
    s->err = errCode;
    if (resp != nullptr) {
        s->status = static_cast<uint32_t>(resp->statusCode);
        s->bytes = static_cast<size_t>(resp->body.length);
        // ★必须销毁响应对象（HMS 的响应是堆对象；不销毁 ⇒ 泄漏，且连接可能因此不被回收）
        if (resp->destroyResponse != nullptr) resp->destroyResponse(resp);
    }
    s->done = true;
    s->cv.notify_all();
}

/** 返回 JSON 片段：`,"async":{...}`（失败时带 error） */
static std::string transportProbeAsyncRounds(const std::string& baseUrl, int rounds, std::string* errOut) {
    void* lib = proteus::http::openRcp();
    if (lib == nullptr) {
        *errOut = "librcp_c.so 不可加载";
        return "";
    }
    using CreateSessionFn = Rcp_Session* (*)(const Rcp_SessionConfiguration*, uint32_t*);
    using CreateRequestFn = Rcp_Request* (*)(const char*);
    using DestroyRequestFn = void (*)(Rcp_Request*);
    using FetchFn = uint32_t (*)(Rcp_Session*, Rcp_Request*, const Rcp_ResponseCallbackObject*);
    using CloseSessionFn = uint32_t (*)(Rcp_Session**);
    auto pCreateSession = reinterpret_cast<CreateSessionFn>(dlsym(lib, "HMS_Rcp_CreateSession"));
    auto pCreateRequest = reinterpret_cast<CreateRequestFn>(dlsym(lib, "HMS_Rcp_CreateRequest"));
    auto pDestroyRequest = reinterpret_cast<DestroyRequestFn>(dlsym(lib, "HMS_Rcp_DestroyRequest"));
    auto pFetch = reinterpret_cast<FetchFn>(dlsym(lib, "HMS_Rcp_Fetch"));
    auto pCloseSession = reinterpret_cast<CloseSessionFn>(dlsym(lib, "HMS_Rcp_CloseSession"));
    if (!pCreateSession || !pCreateRequest || !pDestroyRequest || !pFetch || !pCloseSession) {
        *errOut = "librcp_c.so 缺异步 Fetch 所需符号";
        return "";
    }
    Rcp_SessionConfiguration sc{};
    sc.type = RCP_SESSION_TYPE_HTTP;
    sc.connectionConfiguration.maxConnectionsPerHost = 8;
    sc.connectionConfiguration.maxTotalConnections = 8;
    sc.connectionConfiguration.maxCacheConnections = 8;
    uint32_t errCode = 0;
    Rcp_Session* session = pCreateSession(&sc, &errCode);
    if (session == nullptr) {
        *errOut = "建 session 失败 " + std::to_string(errCode);
        return "";
    }

    std::string statuses = "[", bytesArr = "[", msArr = "[";
    int timedOut = 0;
    int fetchErrs = 0;
    for (int i = 0; i < rounds; i++) {
        std::string u = baseUrl;
        while (!u.empty() && u.back() == '/') u.pop_back();
        u += "/__whoami?i=" + std::to_string(i);
        Rcp_Request* req = pCreateRequest(u.c_str());
        if (req == nullptr) {
            fetchErrs++;
            if (i > 0) { statuses += ","; bytesArr += ","; msArr += ","; }
            statuses += "0"; bytesArr += "0"; msArr += "0";
            continue;
        }
        req->method = "GET";
        AsyncCbState st;
        Rcp_ResponseCallbackObject cb{};
        cb.callback = transportProbeAsyncCb;
        cb.usrCtx = &st;
        const int64_t t0 = proteusTransportNowMs();
        const uint32_t rc = pFetch(session, req, &cb);
        if (rc != 0) {
            fetchErrs++;
            pDestroyRequest(req);
            if (i > 0) { statuses += ","; bytesArr += ","; msArr += ","; }
            statuses += "0"; bytesArr += "0"; msArr += std::to_string(proteusTransportNowMs() - t0);
            continue;
        }
        // 有界等待**真实完成信号**（回调）；上限只是安全网
        {
            std::unique_lock<std::mutex> lk(st.mu);
            if (!st.cv.wait_for(lk, std::chrono::seconds(20), [&] { return st.done; })) timedOut++;
        }
        const int64_t dt = proteusTransportNowMs() - t0;
        pDestroyRequest(req);
        if (i > 0) { statuses += ","; bytesArr += ","; msArr += ","; }
        statuses += std::to_string(st.status);
        bytesArr += std::to_string(static_cast<unsigned long long>(st.bytes));
        msArr += std::to_string(static_cast<long long>(dt));
    }
    // ★会话由本函数独占（一次性探针）⇒ 用完关掉，不污染生产的共享槽
    pCloseSession(&session);
    statuses += "]"; bytesArr += "]"; msArr += "]";
    char tail[256];
    snprintf(tail, sizeof(tail), ",\"timedOut\":%d,\"fetchErrs\":%d}", timedOut, fetchErrs);
    return ",\"async\":{\"statuses\":" + statuses + ",\"bytes\":" + bytesArr + ",\"ms\":" + msArr + tail;
}
#endif  // PROTEUS_HAVE_RCP


/**
 * `hostTransportProbe(argsJson {url, rounds})` → JSON
 *   `{ok, host:'harmony', bridge:'invokeBytes', rounds, firstOk, allOk, statuses:[...], bytes:[...], ms:[...], error?}`
 *
 * 【★判据不在这里（谁有事实谁判）】
 *   协议版本与 TCP 连接数**只有服务端知道**（客户端自述不算）。本探针只回自己的读数
 *   （状态码 / 字节数 / 每轮墙钟），**复用结论由 runner 读 `/__stats` 判定**——
 *   判据只有一个实现，与 Android/iOS 完全同构（#1155 的教训：判据分裂会造出假绿）。
 */
static napi_value HostTransportProbe(napi_env env, napi_callback_info info) {
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
    std::string url;
    jstr(argsJson.c_str(), argsJson.size(), "url", &url);
    int rounds = 3;
    {
        // ★缺省 3 轮：与 Android/iOS runner 的缺省一致（同判据三端可比）
        std::string r;
        if (jstr(argsJson.c_str(), argsJson.size(), "rounds", &r) && !r.empty()) {
            try { rounds = std::stoi(r); } catch (...) { rounds = 3; }
        }
        if (rounds < 1) rounds = 1;
        if (rounds > 20) rounds = 20;   // 有界：探针不该能跑成压测
    }
    /**
     * ★★★#1156（取证专用分支）：`mode=async` ⇒ 改用**异步** `HMS_Rcp_Fetch` + 有界等待回调。
     *
     * 【为什么要加这个分支（它是"修复路径"的判据）】
     *   真机实测：即便 ① session 只建 1 次、② `maxCacheConnections=8`，**仍 3 请求 / 3 TCP**，
     *   且客户端没发 `Connection: close` ⇒ 是 RCP 在**同步**路径下不池化。
     *   ⇒ 唯一还能改的变量是**取数 API**：`HMS_Rcp_FetchSync`（阻塞包装，可能是每次新建 curl easy handle）
     *     vs `HMS_Rcp_Fetch`（异步，走 session 的 multi handle ⇒ 有机会池化）。
     *   ⇒ 结果直接决定下一步：**能复用** ⇒ 修复路径 = 迁到异步（代价是鸿蒙宿主要从"一次性 VM 同步"
     *     改成可重入/异步）；**也不能复用** ⇒ 换 API 无解，属传输栈形态问题（另立项）。
     *
     * 【★这不是盲等】等待条件是**真实完成信号**（RCP 回调置位 + notify），
     *   上限只是"回调永远不来"时的安全网（并把超时如实记进回执 `timedOut`，
     *   便于区分"慢"与"根本不回调"）。与仓内 `wait_for.sh` 的有界有条件等待同族。
     */
    std::string mode = "sync";
    {
        std::string m;
        if (jstr(argsJson.c_str(), argsJson.size(), "mode", &m) && !m.empty()) mode = m;
    }

    // ★结尾统一写 `ok`（见下方注释：中途写会把键写重复）
    std::string body = "{\"host\":\"harmony\",\"bridge\":\"invokeBytes\",\"url\":\"" +
                       jsonEscape(url) + "\",\"rounds\":" + std::to_string(rounds);
    if (url.empty()) {
        body += ",\"ok\":false,\"error\":\"缺 url（--ps transportUrl http://<host>:<port>）\"}";
        napi_value r;
        napi_create_string_utf8(env, body.c_str(), body.size(), &r);
        return r;
    }
    body += ",\"mode\":\"" + jsonEscape(mode) + "\"";

#if PROTEUS_HAVE_RCP
    if (mode == "async") {
        // ★取证分支：只回客户端读数；复用结论仍由服务端 `/__stats` 定（见函数注释）
        std::string aerr;
        const std::string frag = transportProbeAsyncRounds(url, rounds, &aerr);
        if (!aerr.empty()) {
            body += ",\"ok\":false,\"error\":\"" + jsonEscape("async: " + aerr) + "\"}";
        } else {
            body += frag;
            body += ",\"firstOk\":true,\"allOk\":true,\"ok\":true}";
        }
        OH_LOG_INFO(LOG_APP, "PROTEUS_TRANSPORT_PROBE %{public}s", body.c_str());
        napi_value r;
        napi_create_string_utf8(env, body.c_str(), body.size(), &r);
        return r;
    }
#else
    if (mode == "async") {
        body += ",\"ok\":false,\"error\":\"本构件未编译 HMS RCP（async 模式不可用）\"}";
        napi_value r;
        napi_create_string_utf8(env, body.c_str(), body.size(), &r);
        return r;
    }
#endif

    // ① 一次性建 VM（见文件头"为什么用同一个 VM 连发 N 轮"）
    std::string err;
    JSVM_InitOptions io;
    memset(&io, 0, sizeof(io));
    OH_JSVM_Init(&io);
    JSVM_VM vm = nullptr;
    JSVM_Env jenv = nullptr;
    JSVM_HandleScope scope = nullptr;
    JSVM_VMScope vmScope = nullptr;
    JSVM_CreateVMOptions vo;
    memset(&vo, 0, sizeof(vo));
    if (OH_JSVM_CreateVM(&vo, &vm) != JSVM_OK || vm == nullptr) {
        err = "CreateVM 失败";
    } else if (OH_JSVM_OpenVMScope(vm, &vmScope) != JSVM_OK) {
        err = "OpenVMScope 失败";
    } else if (OH_JSVM_CreateEnv(vm, 0, nullptr, &jenv) != JSVM_OK || jenv == nullptr) {
        err = "CreateEnv 失败";
    } else if (OH_JSVM_OpenHandleScope(jenv, &scope) != JSVM_OK) {
        err = "OpenHandleScope 失败";
    }
    if (err.empty()) {
        JSVM_Value host = nullptr;
        OH_JSVM_CreateObject(jenv, &host);
        if (!installInvokeBytes(jenv, host)) err = "注入 invokeBytes 失败";
        JSVM_Value global = nullptr;
        OH_JSVM_GetGlobal(jenv, &global);
        OH_JSVM_SetNamedProperty(jenv, global, "proteusHost", host);
    }

    // ② 连发 N 轮：每轮一个新帧（不同 path ⇒ 避开缓存/去重，但**同 host:port** ⇒ 可复用连接）
    std::string statuses = "[";
    std::string bytesArr = "[";
    std::string msArr = "[";
    /** ★※#1158：逐轮的 `transport`（宿主采集读数；null = 该轮没拿到） */
    std::string tpArr = "[";
    bool firstOk = true;
    bool allOk = true;
    bool anyStatus = false;
    for (int i = 0; i < rounds && err.empty(); i++) {
        /**
         * ★路径必须是 `/__whoami`（**服务端只把这条算作受试样本**）。
         * 【真机实测抓出的装置缺陷】首版直接给 base 拼 `?i=` ⇒ 请求落到 `/`，
         *   服务端按设计**不计入样本** ⇒ 读数 `requests=0`，而设备侧是 `200 · 126B`（根路径响应）
         *   ⇒ 判据当场红并指名。★这是 #1155 定的口径在起作用：**样本口径由服务端定，客户端不能自己挑**。
         * 不同 path + 同 host:port ⇒ 避开 HTTP 缓存/去重，但仍可复用连接（复用判定的前提）。
         */
        std::string u = url;
        while (!u.empty() && u.back() == '/') u.pop_back();
        u += "/__whoami?i=" + std::to_string(i);

        proteus::wire::InvokeFrame f;
        f.method = "http.request";
        f.reqId = "probe-transport-" + std::to_string(i);
        f.url = u;
        f.httpMethod = "GET";
        f.responseType = proteus::wire::RESPONSE_TEXT;
        const std::string frameHex = toHex(proteus::wire::encodeInvoke(f));

        const int64_t t0 = proteusTransportNowMs();
        std::string hexOut;
        if (!jsvmEvalStr(jenv, (std::string(kInvokeBytesBridgeScript) + "(\"" + frameHex + "\")").c_str(), &hexOut)) {
            std::string desc = "unknown";
            JSVM_Value exc = nullptr;
            OH_JSVM_GetAndClearLastException(jenv, &exc);
            if (exc != nullptr) {
                std::string s;
                jsvmStr(jenv, exc, &s);
                desc = s;
            }
            err = "invokeBytes 调用失败（第 " + std::to_string(i + 1) + " 轮）：" + desc;
            break;
        }
        const int64_t dt = proteusTransportNowMs() - t0;

        unsigned status = 0;
        size_t nbytes = 0;
        bool ok = false;
        /** ★★★#1158：本轮回程帧里的 `transport`（宿主采集的传输读数） */
        std::string tpJson = "null";
        try {
            proteus::wire::ResolveFrame rf = proteus::wire::decodeResolve(fromHex(hexOut));
            ok = rf.ok;
            status = rf.status ? *rf.status : 0u;
            nbytes = rf.body.size();
            if (rf.transport && !rf.transport.v.empty()) {
                std::string s = "{";
                bool first = true;
                for (const auto& kv : rf.transport.v) {
                    if (!first) s += ",";
                    first = false;
                    s += "\"" + jsonEscape(kv.first) + "\":\"" + jsonEscape(kv.second) + "\"";
                }
                s += "}";
                tpJson = s;
            }
        } catch (const std::exception& e) {
            err = std::string("回程帧解码失败（第 ") + std::to_string(i + 1) + " 轮）：" + e.what();
            break;
        }
        if (i == 0) firstOk = ok;
        if (!ok) allOk = false;
        anyStatus = true;
        if (i > 0) { statuses += ","; bytesArr += ","; msArr += ","; tpArr += ","; }
        statuses += std::to_string(status);
        bytesArr += std::to_string(static_cast<unsigned long long>(nbytes));
        msArr += std::to_string(static_cast<long long>(dt));
        tpArr += tpJson;
    }
    statuses += "]";
    bytesArr += "]";
    msArr += "]";
    tpArr += "]";

    if (jenv != nullptr && scope != nullptr) OH_JSVM_CloseHandleScope(jenv, scope);
    if (jenv != nullptr) OH_JSVM_DestroyEnv(jenv);
    if (vm != nullptr && vmScope != nullptr) OH_JSVM_CloseVMScope(vm, vmScope);
    if (vm != nullptr) OH_JSVM_DestroyVM(vm);

    body += ",\"statuses\":" + statuses + ",\"bytes\":" + bytesArr + ",\"ms\":" + msArr;
    // ★★★#1158：逐轮 `transport`（宿主采集读数）。
    //   ★探针只解码**宿主真实回程帧**里的 `transport` tag ⇒ 这条读数证明
    //     "宿主的 Rcp_TimeInfo 采集 + 线格式编码"两端都真的工作（不是探针自己算的）。
    body += ",\"transport_per_round\":" + tpArr;
    // ★★★#1156：**客户端侧因果证据**——RCP session 建了几次。
    //   服务端说"3 请求 / 3 TCP"是**现象**；`sessionsCreated=3` 才说明**为什么**
    //   （每请求一个新 session ⇒ 连接池跟着生灭）。修好后应为 1。
    //   ★两者必须同时具备才能归因：只有服务端读数时分不清"宿主的连接池坏了"与"服务端提前关连接"。
    {
        char sb[96];
        snprintf(sb, sizeof(sb), ",\"sessionsCreated\":%d", proteus::http::stats().sessionsCreated);
        body += sb;
    }
    body += std::string(",\"firstOk\":") + (firstOk ? "true" : "false");
    body += std::string(",\"allOk\":") + (allOk && anyStatus && err.empty() ? "true" : "false");
    // ★★★`ok` **只写一次**。首版在开头写了 `"ok":false`、成功分支又追加 `"ok":true`
    //   ⇒ 回执里出现**重复键**（真机证据文件实测：`"ok":false,…, "ok":true`）。
    //   `JSON.parse` 取后者，看似没事，但任何严格解析器/去重比对都会挑出歧义——
    //   而"证据文件里有两套自相矛盾的值"本身就不该存在。
    body += err.empty() ? ",\"ok\":true" : ",\"ok\":false";
    if (!err.empty()) body += ",\"error\":\"" + jsonEscape(err) + "\"";
    body += "}";
    OH_LOG_INFO(LOG_APP, "PROTEUS_TRANSPORT_PROBE %{public}s", body.c_str());
    napi_value r;
    napi_create_string_utf8(env, body.c_str(), body.size(), &r);
    return r;
}
