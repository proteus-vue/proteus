// hosts/harmony/host-app/proteus_render/src/main/cpp/http_probe.h
// ★★★真机 HTTP 通路判据（T-app-fetch）—— `hostHttpProbe(url)`: 在**一次性 VM 里**用真实的
//   `proteusHost.invokeBytes` 走完整条能力通道，真发一次网络请求，并把**回程帧真实解出的**状态码/载荷回执。
//
// 【为什么不能只测 C++ 侧 `proteus_http::handle`】那只证明"宿主能发 HTTP"，
//   完全绕过了 **JS → C++ 的字节交接**（`Uint8Array` 进出、安装点、帧编码语义）。
//   本探针刻意把帧交给 **JS**，由 JS 调 `proteusHost.invokeBytes`，再把回执字节交回来——
//   与真机上 `useFetch` 走的是**同一条链**（差别只在 JS 侧那层能力封装，它已有单测覆盖）。
//
// 【为什么 JS 侧只是 hex↔Uint8Array 转换（不 eval 业务代码）】
//   探针要在**不依赖应用 bundle** 的前提下单独跑通（应用没装/没 boot 也能验）。
//   故本探针建一个**空 VM**，只注入 `invokeBytes`，eval 一段固定的转换脚本。
//   ★诚实边界：这证明"桥 + 线格式 + 宿主 HTTP"三段真实；**不**证明 `useFetch` 的业务封装
//     （那由 `tests/capability-app-fetch.test.ts` + `capability-invoke-bytes.test.ts` 覆盖）。
//   ★★#1117：回执额外带 `limit`（逐块闸读数）——超限判据要看的是
//     "回调真被逐块调用过 + cancelRequest 真被调用"，而不是只看最终错误码
//     （只看错误码的话，"读完 64 MiB 再拒绝"与"读到 32 MiB 就掐断"完全同形）。
#pragma once
#include <string>
#include <vector>

#include "invoke_bytes_bridge.h"
#include "invoke_wire.h"
#include "proteus_host_helpers.h"

/** JS 侧转换脚本：hex → Uint8Array → invokeBytes → Uint8Array → hex。
 *  ★用双引号包住 hex 字面量（单引号曾被真实换行击穿——见 host_app_runtime_impl.h 的白屏根因）。 */
static const char* kInvokeBytesBridgeScript =
    "(function(frameHex){"
    "  var n = frameHex.length / 2;"
    "  var a = new Uint8Array(n);"
    "  for (var i = 0; i < n; i++) a[i] = parseInt(frameHex.substr(i * 2, 2), 16);"
    "  var out = proteusHost.invokeBytes(a);"
    "  if (!out || typeof out.length !== 'number') return 'NO_OUTPUT';"
    "  var s = '';"
    "  for (var j = 0; j < out.length; j++) s += (out[j] < 16 ? '0' : '') + out[j].toString(16);"
    "  return s;"
    "})";

static std::string toHex(const std::vector<uint8_t>& b) {
    static const char* k = "0123456789abcdef";
    std::string out;
    out.reserve(b.size() * 2);
    for (uint8_t v : b) {
        out.push_back(k[v >> 4]);
        out.push_back(k[v & 0x0f]);
    }
    return out;
}

static std::vector<uint8_t> fromHex(const std::string& s) {
    std::vector<uint8_t> out;
    out.reserve(s.size() / 2);
    for (size_t i = 0; i + 1 < s.size(); i += 2) {
        out.push_back(static_cast<uint8_t>(std::stoul(s.substr(i, 2), nullptr, 16)));
    }
    return out;
}

/**
 * `hostHttpProbe(argsJson {url, method?, timeoutMs?, expect?})` → JSON
 *   `{ok, host:'harmony', bridge:'invokeBytes', reqId, status, bodyBytes, preview, wire, error?}`
 *
 * 【判据口径（写进回执，脚本据此断言）】
 *   · `bridge == 'invokeBytes'` ⇒ 走的是二进制腿（不是 JSON 回落）；
 *   · `status` = 服务器真实状态码；`bodyBytes` > 0；`preview` 含响应体前若干字符。
 */
static napi_value HostHttpProbe(napi_env env, napi_callback_info info) {
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
    if (url.empty()) url = "https://httpbin.org/get";
    // ★★★跨语言实测点：ArkTS 侧可以**自己编码**一帧交进来（frameHex 入参）——
    //   这样真机上验的是「ArkTS 编出的字节 → C++ 解」这条真实的跨语言契约
    //   （parity 门禁在本机验同一性质；真机上再验一次，防"本机绿、设备端不一致"）。
    std::string frameHexIn;
    jstr(argsJson.c_str(), argsJson.size(), "frameHex", &frameHexIn);
    // ★★★#1169：HTTPDNS 注入参数（域名 + 强制 IP）——见帧构造处注释
    std::string dnsHostIn, dnsIpIn;
    jstr(argsJson.c_str(), argsJson.size(), "dnsHost", &dnsHostIn);
    jstr(argsJson.c_str(), argsJson.size(), "dnsIp", &dnsIpIn);
    /**
     * ★★★#1169：**DNS 探针参数**（只有给了才安装假解析器；缺省生产路径零影响）。
     * · `dnsForceIp`：强制把目标 host 解析到这个 IP（给空串 ⇒ 让解析失败）。
     *   判据用"不可达 IP（203.0.113.1 = TEST-NET-3）⇒ 请求必失败"来证明**这条 DNS 路真的接通**。
     */
    {
      std::string v;
      jstr(argsJson.c_str(), argsJson.size(), "dnsForceIp", &v);
      /**
       * ★★★#1169：**表注入优先**——`dnsHost`+`dnsIp` 给了就**不装**假解析器。
       * 【为什么必须互斥】两者都走 `RCP_DNS_RULE_DYNAMIC`（同一条 `Rcp_DnsRule`）⇒
       *   后设的覆盖先设的；若同时装，测出来的永远是 `lastSource='probe'`（假解析器），
       *   **业务表根本没被验证**（本轮实测踩到：`tableRules=0 · lastSource='probe'`）。
       */
      std::string hostV, ipV;
      jstr(argsJson.c_str(), argsJson.size(), "dnsHost", &hostV);
      jstr(argsJson.c_str(), argsJson.size(), "dnsIp", &ipV);
      const bool tableInject = !hostV.empty() && !ipV.empty();
      if (!tableInject && argsJson.find("\"dnsForceIp\"") != std::string::npos) {
        proteus::http::DnsProbe& dp = proteus::http::dnsProbe();
        dp = proteus::http::DnsProbe{};    // 复位上一次读数
        dp.installed = true;
        dp.forcedIp = v;
      }
    }

    // ① 帧：优先用入参（ArkTS 编）；缺省由 C++ 用 SSOT 语义自编
    std::vector<uint8_t> frame;
    if (!frameHexIn.empty()) {
        frame = fromHex(frameHexIn);
    } else {
        proteus::wire::InvokeFrame f;
        f.method = "http.request";
        f.reqId = "probe-http-1";
        f.url = url;
        f.httpMethod = "GET";
        f.responseType = proteus::wire::RESPONSE_TEXT;
        /**
         * ★★★#1169：`dnsHost` + `dnsIp` ⇒ 往帧里塞 HTTPDNS 表（name-values，域名 → 逗号分隔 IP）。
         * 用途：真机验证"宿主的表解析真的生效"（同 Android 探针的注入手法：
         * 把目标域名解析到不可达 IP ⇒ 请求必失败）。
         * ★ArkTS 编帧时不走这条（它自己编 frameHex）⇒ 本参数只对 C++ 自编路径有效。
         */
        if (!dnsHostIn.empty() && !dnsIpIn.empty()) {
            f.httpDns = proteus::wire::NameValues{ { dnsHostIn, dnsIpIn } };
        }
        frame = proteus::wire::encodeInvoke(f);
    }
    const std::string frameHex = toHex(frame);

    // ② 一次性 VM：空环境 + 只注入 invokeBytes（见文件头"为什么"）
    std::string err;
    std::string hexOut;
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
    // ③ 在 VM 内真正调 `proteusHost.invokeBytes`（字节进出全走 JS）
    if (err.empty()) {
        std::string expr = std::string(kInvokeBytesBridgeScript) + "(\"" + frameHex + "\")";
        if (!jsvmEvalStr(jenv, expr.c_str(), &hexOut)) {
            std::string desc = "unknown";
            JSVM_Value exc = nullptr;
            OH_JSVM_GetAndClearLastException(jenv, &exc);
            if (exc != nullptr) {
                std::string s;
                jsvmStr(jenv, exc, &s);
                desc = s;
            }
            err = "invokeBytes 调用失败：" + desc;
        }
    }
    if (jenv != nullptr && scope != nullptr) OH_JSVM_CloseHandleScope(jenv, scope);
    if (jenv != nullptr) OH_JSVM_DestroyEnv(jenv);
    if (vm != nullptr && vmScope != nullptr) OH_JSVM_CloseVMScope(vm, vmScope);
    if (vm != nullptr) OH_JSVM_DestroyVM(vm);

    // ③ 解回程帧（真实状态码/载荷；不是宿主自报）
    std::string body = "{\"ok\":false";
    body += ",\"host\":\"harmony\",\"bridge\":\"invokeBytes\",\"url\":\"" + jsonEscape(url) + "\"";
    // ★#1117：逐块闸读数。★必须拼在**两条回执路径**上——成功/失败分支会 `body = head` **整串覆盖**，
    //   只在初始 body 拼一次的话，真正解码成功的那条路径上它会**静默消失**（本轮实测踩到：
    //   超限回执里没有 limit 字段，判据只能看错误码 ⇒ 又退化成"分不出边读边掐 vs 读完再拒"）。
    std::string limitJson;
    {
        const proteus::http::LastLimitDiag& d = proteus::http::lastLimitDiag();
        char lb[320];
        snprintf(lb, sizeof(lb),
                 ",\"limit\":{\"gateInstalled\":%s,\"chunks\":%d,\"seen\":%llu,\"exceeded\":%s,"
                 "\"cancelCalled\":%s,\"cancelRc\":%u,\"kept\":%zu,\"cap\":%zu}",
                 d.gateInstalled ? "true" : "false", d.chunks,
                 static_cast<unsigned long long>(d.seen), d.exceeded ? "true" : "false",
                 d.cancelCalled ? "true" : "false", d.cancelRc, d.kept,
                 proteus::http::MAX_BODY_BYTES);
        limitJson = lb;
    }
    body += limitJson;
    /**
     * ★★★#1169：DNS 探针读数（同样必须拼在**两条回执路径**上——见上面 limit 的教训）。
     * `calls > 0` = 假解析器真被 RCP 调用过 ⇒ `RCP_DNS_RULE_DYNAMIC` 这条路接通。
     */
    std::string dnsJson;
    {
        const proteus::http::DnsProbe& dp = proteus::http::dnsProbe();
        char db[640];
        snprintf(db, sizeof(db),
                 ",\"dns\":{\"installed\":%s,\"calls\":%d,\"host\":\"%s\",\"port\":%u,\"forcedIp\":\"%s\","
                 "\"tableRules\":%d,\"tableHits\":%d,\"lastSource\":\"%s\"}",
                 dp.installed ? "true" : "false", dp.calls,
                 jsonEscape(dp.lastHost).c_str(), dp.lastPort, jsonEscape(dp.forcedIp).c_str(),
                 dp.tableRules, dp.tableHits, jsonEscape(dp.lastSource).c_str());
        dnsJson = db;
    }
    body += dnsJson;
    /**
     * ★★★#1186：**传输读数**（`transport`：proto/reused/dnsMs/... + `dnsSource`/`dnsTableHit`）。
     *
     * 【为什么必须在探针里也输出一份】回程帧里的 `transport` 只有业务（`useFetch` 的
     *   `meta.transport`）看得到；而这个探针走的是**原生直调**（ArkTS 自编帧 → C++ 执行），
     *   JS 侧拿不到 `meta` ⇒ 没有这份读数就**无法在鸿蒙真机验证 `dnsSource`**。
     * ★同样必须拼在**两条回执路径**上（见 #1117 的 limit 教训：`body = head` 会整串覆盖）。
     */
    std::string transportJson;
    {
        const proteus::wire::NameValues& tp = proteus::http::lastTransport();
        if (!tp.empty()) {
            transportJson = ",\"transport\":{";
            bool first = true;
            for (const auto& kv : tp) {
                if (!first) transportJson += ",";
                first = false;
                transportJson += "\"" + jsonEscape(kv.first) + "\":\"" + jsonEscape(kv.second) + "\"";
            }
            transportJson += "}";
        }
    }
    body += transportJson;
    if (!err.empty()) {
        body += ",\"error\":\"" + jsonEscape(err) + "\"}";
    } else if (hexOut == "NO_OUTPUT" || hexOut.empty()) {
        body += ",\"error\":\"JS 侧未拿到 Uint8Array 回执（桥未生效）\"}";
    } else {
        try {
            proteus::wire::ResolveFrame rf = proteus::wire::decodeResolve(fromHex(hexOut));
            std::string preview;
            if (!rf.body.empty()) {
                size_t n = rf.body.size() < 400 ? rf.body.size() : 400;
                for (size_t i = 0; i < n; i++) {
                    // ★预览是"人可读摘要"⇒ 不可打印字符一律换成 '.'（二进制响应别把回执撑成乱码）。
                    //   （JSON 合法性由 jsonEscape 兜住；这里只管可读性。）
                    const unsigned char uc = static_cast<unsigned char>(rf.body[i]);
                    preview.push_back((uc < 0x20 || uc >= 0x7f) ? '.' : static_cast<char>(uc));
                }
            }
            char head[320];
            snprintf(head, sizeof(head),
                     "{\"ok\":%s,\"host\":\"harmony\",\"bridge\":\"invokeBytes\",\"frameSource\":\"%s\",\"reqId\":\"%s\","
                     "\"status\":%u,\"bodyBytes\":%zu,\"reason\":\"%s\"",
                     rf.ok ? "true" : "false", frameHexIn.empty() ? "cpp" : "arkts", jsonEscape(rf.reqId).c_str(),
                     rf.status ? *rf.status : 0u, rf.body.size(),
                     rf.reason ? jsonEscape(*rf.reason).c_str() : "");
            body = head;
            body += limitJson;   // ★同上：head 覆盖后必须重新拼
            body += dnsJson;     // ★#1169：DNS 读数同理（覆盖后必须重拼）
            body += transportJson; // ★#1186：传输读数同理
            body += ",\"preview\":\"" + jsonEscape(preview) + "\"}";
        } catch (const std::exception& e) {
            body += ",\"error\":\"" + jsonEscape(std::string("回程帧解码失败：") + e.what()) + "\"}";
        }
    }
    OH_LOG_INFO(LOG_APP, "PROTEUS_HTTP_PROBE %{public}s", body.c_str());
    napi_value r;
    napi_create_string_utf8(env, body.c_str(), body.size(), &r);
    return r;
}
