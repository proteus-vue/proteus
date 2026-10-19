// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http.h
// ★★★C26 `useFetch` 的**鸿蒙宿主 HTTP 实现**（`http.request`）—— T-app-fetch · 三端能力对齐样板
//
// 【它做什么】把 `PINV` 去程帧里的一次 HTTP 请求**真实发出去**，并把结果编成 `PRSP` 回程帧。
//
// 【★为什么是同步（与 Android/iOS 的异步腿不同——如实登记，不粉饰为"三端一致"）】
//   鸿蒙 superapp 路径是**一次性 VM**（`hostAppRender` 每次新建 VM、同步跑完、返回即销毁）。
//   JS 侧 `useFetch` 的 `invokeBytes` 调用发生在该 napi 调用**内部**：
//     · 此时 ArkTS 线程被 napi 占用，无法把帧交回 ArkTS 去发异步请求；
//     · 等 napi 返回时 VM 已销毁，异步回推**没有接收方**。
//   ⇒ 唯一合法形态 = 在 napi 调用内**同步完成往返**（`HMS_Rcp_FetchSync`）。
//   ★代价（诚实边界）：请求期间 ArkTS 线程被阻塞（不冻结渲染线程之外的 UI？——**会**阻塞调用线程）。
//     这与 Android/iOS 的"受理即返、网络线程完成再回推"语义不同；三端**错误码/取数形状**一致，
//     调度语义不一致。等鸿蒙宿主换成"可重入 VM"后应改为异步（已登记为后续项）。
//
// 【★为什么 dlopen 而不是链接 librcp_c.so】
//   ① HMS native SDK 的 sysroot 不在 OpenHarmony 默认 CMake 搜索路径里（`sdk/default/hms/native/sysroot`），
//      显式链接需要把该路径写进每个消费方工程的 CMake（CLI 生成的宿主也要改）⇒ 脆；
//   ② 设备上该库位于 `/system/lib64/ndk/librcp_c.so`（非默认命名空间搜索路径）⇒ 按绝对路径探测更稳；
//   ③ 缺库时**诚实降级**（回 `http.unsupported`），不因一条能力把宿主带崩 —— 与 `vkProbe` 同策略。
//   ★头文件按 `__has_include` 条件包含：有 HMS 头 ⇒ 用真实结构体（ABI 由 SDK 保证）；
//     无 ⇒ 整个实现编译为"未接线"（返回 unsupported），**不伪造成功**。
//
// 【★零 JSON】响应体**原样回字节**，由 JS 侧按 `responseType` 解释（`interpretBody`）——宿主不猜业务语义。
// 【★G-46 会话共享】鸿蒙指定机制 = `WebCookieManager` + **Header 注入**。本单**未接**（如实登记）：
//   RCP 的 session cookies 可读但跨请求持久化需要 ArkTS 侧 WebCookieManager 配合；
//   本实现**不**读也不写 cookie 存储 ⇒ 登录态共享属 ResourcePool 子单（不谎称已实现）。
#ifndef PROTEUS_HTTP_H
#define PROTEUS_HTTP_H

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "invoke_wire.h"

#if defined(__has_include)
#if __has_include(<RemoteCommunicationKit/rcp.h>)
#include <RemoteCommunicationKit/rcp.h>
#define PROTEUS_HAVE_RCP 1
#endif
#endif
#ifndef PROTEUS_HAVE_RCP
#define PROTEUS_HAVE_RCP 0
#endif

#if PROTEUS_HAVE_RCP
#include <dlfcn.h>
#endif

namespace proteus {
namespace http {

/** 宿主记账（判据/报告读它：证明"请求真的发出去过"，而非桥自造结果）。 */
struct Stats {
  int calls = 0;      // 受理的 http.request 次数
  int ok = 0;         // 成功往返次数（errCode==0 且拿到响应）
  int failures = 0;   // 失败次数
  int lastStatus = 0; // 最近一次 HTTP 状态码
};
inline Stats& stats() {
  static Stats s;
  return s;
}

/** `librcp_c.so` 的探测顺序（设备实测：`/system/lib64/ndk/librcp_c.so`；其余为本机/其它布局兜底）。 */
inline void* openRcp() {
#if PROTEUS_HAVE_RCP
  static void* lib = nullptr;
  static bool tried = false;
  if (!tried) {
    tried = true;
    const char* names[] = {
        "librcp_c.so",
        "/system/lib64/ndk/librcp_c.so",
        "/system/lib64/librcp_c.so",
    };
    for (const char* n : names) {
      lib = dlopen(n, RTLD_NOW | RTLD_LOCAL);
      if (lib != nullptr) break;
    }
    if (lib == nullptr) {
      fprintf(stderr, "[proteus-http] librcp_c.so 未找到（http.request 将诚实回 unsupported）\n");
    }
  }
  return lib;
#else
  return nullptr;
#endif
}

/* ────────────────────────── 小工具 ────────────────────────── */

/** query 参数百分号编码（RFC 3986 unreserved 之外一律 %XX）。 */
inline std::string percentEncode(const std::string& s) {
  static const char* kHex = "0123456789ABCDEF";
  std::string out;
  out.reserve(s.size() * 3);
  for (unsigned char c : s) {
    const bool unreserved = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
                            c == '-' || c == '_' || c == '.' || c == '~';
    if (unreserved) {
      out.push_back(static_cast<char>(c));
    } else {
      out.push_back('%');
      out.push_back(kHex[c >> 4]);
      out.push_back(kHex[c & 0x0f]);
    }
  }
  return out;
}

/** 追加 query 参数（已有 `?` ⇒ 用 `&`；空参数列表 ⇒ 原样返回）。 */
inline std::string appendParams(const std::string& url, const proteus::wire::NameValues& params) {
  if (params.empty()) return url;
  std::string out = url;
  out += (out.find('?') == std::string::npos) ? '?' : '&';
  bool first = true;
  for (const auto& kv : params) {
    if (!first) out += '&';
    first = false;
    out += percentEncode(kv.first);
    out += '=';
    out += percentEncode(kv.second);
  }
  return out;
}

/** RCP 错误码 → 与 Android/iOS 同口径的 reason 前缀（`timeout:` / `network.unreachable:` / `http.failed:`）。 */
inline std::string reasonOf(uint32_t errCode) {
  if (errCode == 1007900028u) return "timeout: 请求超时（RCP 1007900028）";
  if (errCode == 1007900006u || errCode == 1007900007u) {
    return "network.unreachable: 无法解析主机/连接服务器（RCP " + std::to_string(errCode) + "）";
  }
  if (errCode == 201u) return "permission.denied: 缺 INTERNET 权限（RCP 201）";
  return "http.failed: RCP 错误 " + std::to_string(errCode);
}

/* ────────────────────────── 主实现 ────────────────────────── */

/**
 * 处理一次 `http.request`（去程帧已解码）。
 * @return 回程帧（正常 = `ok` + status/headers/body；参数非法或失败 = `err`）。
 */
inline proteus::wire::ResolveFrame handle(const proteus::wire::InvokeFrame& f) {
  stats().calls++;
  if (!f.url || f.url.v.empty()) {
    stats().failures++;
    return proteus::wire::ResolveFrame::err(f.reqId, "http.request 需要 url（meta 里没带）");
  }
  const std::string url = appendParams(*f.url, f.params ? *f.params : proteus::wire::NameValues{});
  const std::string method = f.httpMethod ? *f.httpMethod : "GET";
  const uint32_t timeoutMs = f.timeoutOrDefault();

#if !PROTEUS_HAVE_RCP
  stats().failures++;
  return proteus::wire::ResolveFrame::missingMethod(
      f.reqId, "http.unsupported: 本构件未包含 HMS RCP 头（鸿蒙 HTTP 腿未编译进来）");
#else
  void* lib = openRcp();
  if (lib == nullptr) {
    stats().failures++;
    return proteus::wire::ResolveFrame::missingMethod(
        f.reqId, "http.unsupported: librcp_c.so 不可加载（鸿蒙 HTTP 腿不可用）");
  }

  using CreateSessionFn = Rcp_Session* (*)(const Rcp_SessionConfiguration*, uint32_t*);
  using CreateRequestFn = Rcp_Request* (*)(const char*);
  using DestroyRequestFn = void (*)(Rcp_Request*);
  using CreateHeadersFn = Rcp_Headers* (*)();
  // ★同 DestroyHeaderEntries：HMS 侧是**单指针**（`void HMS_Rcp_DestroyHeaders(Rcp_Headers *)`）。
  using DestroyHeadersFn = void (*)(Rcp_Headers*);
  using SetHeaderValueFn = uint32_t (*)(Rcp_Headers*, const char*, const char*);
  using GetHeaderEntriesFn = Rcp_HeaderEntry* (*)(Rcp_Headers*);
  // ★真机实测：HMS 侧是**单指针**（`void HMS_Rcp_DestroyHeaderEntries(Rcp_HeaderEntry *)`，
  //   与 OHOS `OH_Http_DestroyHeaderEntries(…**)` 不同）——按双指针调会把栈地址当对象释放 ⇒ SIGSEGV。
  using DestroyHeaderEntriesFn = void (*)(Rcp_HeaderEntry*);
  using FetchSyncFn = Rcp_Response* (*)(Rcp_Session*, Rcp_Request*, uint32_t*);
  using CloseSessionFn = uint32_t (*)(Rcp_Session**);

  auto pCreateSession = reinterpret_cast<CreateSessionFn>(dlsym(lib, "HMS_Rcp_CreateSession"));
  auto pCreateRequest = reinterpret_cast<CreateRequestFn>(dlsym(lib, "HMS_Rcp_CreateRequest"));
  auto pDestroyRequest = reinterpret_cast<DestroyRequestFn>(dlsym(lib, "HMS_Rcp_DestroyRequest"));
  auto pCreateHeaders = reinterpret_cast<CreateHeadersFn>(dlsym(lib, "HMS_Rcp_CreateHeaders"));
  auto pDestroyHeaders = reinterpret_cast<DestroyHeadersFn>(dlsym(lib, "HMS_Rcp_DestroyHeaders"));
  auto pSetHeaderValue = reinterpret_cast<SetHeaderValueFn>(dlsym(lib, "HMS_Rcp_SetHeaderValue"));
  auto pGetHeaderEntries = reinterpret_cast<GetHeaderEntriesFn>(dlsym(lib, "HMS_Rcp_GetHeaderEntries"));
  auto pDestroyHeaderEntries = reinterpret_cast<DestroyHeaderEntriesFn>(dlsym(lib, "HMS_Rcp_DestroyHeaderEntries"));
  auto pFetchSync = reinterpret_cast<FetchSyncFn>(dlsym(lib, "HMS_Rcp_FetchSync"));
  auto pCloseSession = reinterpret_cast<CloseSessionFn>(dlsym(lib, "HMS_Rcp_CloseSession"));

  const bool symbolsOk = pCreateSession && pCreateRequest && pDestroyRequest && pCreateHeaders &&
                         pDestroyHeaders && pSetHeaderValue && pGetHeaderEntries && pFetchSync &&
                         pCloseSession;
  if (!symbolsOk) {
    stats().failures++;
    return proteus::wire::ResolveFrame::missingMethod(
        f.reqId, "http.unsupported: librcp_c.so 缺所需符号（版本过旧？）");
  }

  // ① session（§诚实边界：不带任何 interceptor / cookie 存储）
  Rcp_SessionConfiguration sc{};
  sc.type = RCP_SESSION_TYPE_HTTP;
  uint32_t errCode = 0;
  Rcp_Session* session = pCreateSession(&sc, &errCode);
  if (session == nullptr) {
    stats().failures++;
    return proteus::wire::ResolveFrame::err(f.reqId, "http.failed: 建 RCP session 失败（" + std::to_string(errCode) + "）");
  }

  // ② request + headers + content + 超时配置
  Rcp_Request* req = pCreateRequest(url.c_str());
  Rcp_Headers* headers = nullptr;
  Rcp_RequestContent content{};
  Rcp_Configuration cfg{};
  if (req == nullptr) {
    pCloseSession(&session);
    stats().failures++;
    return proteus::wire::ResolveFrame::err(f.reqId, "http.failed: 建 RCP request 失败");
  }
  req->method = method.c_str();

  headers = pCreateHeaders();
  if (headers != nullptr) {
    if (f.headers) {
      for (const auto& kv : *f.headers) pSetHeaderValue(headers, kv.first.c_str(), kv.second.c_str());
    }
    // ★contentType 只在调用方没显式给 Content-Type 时补（调用方语义优先，与 Android 同）
    if (f.contentType) {
      bool hasCt = false;
      if (f.headers) {
        for (const auto& kv : *f.headers) {
          std::string k = kv.first;
          for (auto& ch : k) ch = static_cast<char>(::tolower(static_cast<unsigned char>(ch)));
          if (k == "content-type") { hasCt = true; break; }
        }
      }
      if (!hasCt) pSetHeaderValue(headers, "Content-Type", f.contentType.v.c_str());
    }
    req->headers = headers;
  }
  if (!f.body.empty()) {
    content.type = RCP_CONTENT_TYPE_STRING;
    content.data.contentStr.buffer = reinterpret_cast<const char*>(f.body.data());
    content.data.contentStr.length = static_cast<uint32_t>(f.body.size());
    req->content = &content;
  }
  cfg.transferConfiguration.autoRedirect = true;
  cfg.transferConfiguration.timeout.connectMs = timeoutMs;
  cfg.transferConfiguration.timeout.transferMs = timeoutMs;
  req->configuration = &cfg;

  // ③ 同步发请求（见文件头「为什么是同步」）
  Rcp_Response* resp = pFetchSync(session, req, &errCode);

  proteus::wire::ResolveFrame out;
  if (errCode != 0 || resp == nullptr) {
    stats().failures++;
    out = proteus::wire::ResolveFrame::err(f.reqId, reasonOf(errCode));
  } else {
    out = proteus::wire::ResolveFrame::okOf(f.reqId);
    out.status = static_cast<uint32_t>(resp->statusCode);
    stats().lastStatus = static_cast<int>(resp->statusCode);
    // 响应头（同名多值用逗号连接——与 Android `collectHeaders` 同口径）
    if (resp->headers != nullptr) {
      Rcp_HeaderEntry* entries = pGetHeaderEntries(resp->headers);
      proteus::wire::NameValues nv;
      for (Rcp_HeaderEntry* e = entries; e != nullptr; e = e->next) {
        if (e->key == nullptr) continue;
        std::string val;
        for (Rcp_HeaderValue* v = e->value; v != nullptr; v = v->next) {
          if (v->value == nullptr) continue;
          if (!val.empty()) val += ", ";
          val += v->value;
        }
        nv.emplace_back(e->key, val);
      }
      if (pDestroyHeaderEntries != nullptr && entries != nullptr) pDestroyHeaderEntries(entries);
      out.headers = std::move(nv);
    }
    // 响应体原样回字节（不解析）
    if (resp->body.buffer != nullptr && resp->body.length > 0) {
      const uint8_t* p = reinterpret_cast<const uint8_t*>(resp->body.buffer);
      out.body.assign(p, p + resp->body.length);
    }
    stats().ok++;
    if (resp->destroyResponse != nullptr) resp->destroyResponse(resp);
  }

  // ④ 释放
  if (headers != nullptr && pDestroyHeaders != nullptr) pDestroyHeaders(headers);
  pDestroyRequest(req);
  pCloseSession(&session);
  return out;
#endif
}

/** 探针用：在**不启 VM**的情况下直接发一次 GET（验证库/网络可用性）。 */
inline std::string probe(const std::string& url) {
  proteus::wire::InvokeFrame f;
  f.method = "http.request";
  f.reqId = "probe-0";
  f.url = url;
  f.httpMethod = "GET";
  f.responseType = proteus::wire::RESPONSE_TEXT;
  proteus::wire::ResolveFrame r = handle(f);
  char buf[320];
  snprintf(buf, sizeof(buf), "{\"ok\":%s,\"status\":%u,\"bodyBytes\":%zu,\"reason\":\"%s\"}",
           r.ok ? "true" : "false", r.status ? *r.status : 0u, r.body.size(),
           r.reason ? r.reason.v.c_str() : "");
  return buf;
}

}  // namespace http
}  // namespace proteus

#endif  // PROTEUS_HTTP_H
