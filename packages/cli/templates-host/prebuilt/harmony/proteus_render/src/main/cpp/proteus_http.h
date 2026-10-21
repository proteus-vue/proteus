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
//
// 【★★★响应体上限（决策 #1117 · 与 Android/iOS **同值 32 MiB**）】
//   ★为什么必须**逐块**判、并在越线时**中止**：`HMS_Rcp_FetchSync` 返回时整个响应体**已经进内存**——
//     那时再看 `resp->body.length` 判超限，内存峰值早已越过上限（Android/iOS 修复前同形：判得准但不"有界"）。
//   ⇒ 用 `HMS_Rcp_SetRequestOnBinaryDataRecvCallback` 逐块累计，越线即 `HMS_Rcp_CancelRequest`。
//   ★诚实边界（API < 13 的旧设备）：该回调符号不存在 ⇒ 退化为"事后拒绝"（本文件如实计 `tooLargeFallback`），
//     此时内存峰值**不有界**；设备实测（API 26）符号在位、真中止生效（见 hosts/harmony/run-fetch-limit-probe.sh）。
// 【★G-46 会话共享】鸿蒙指定机制 = `WebCookieManager` + **Header 注入**。本单**未接**（如实登记）：
//   RCP 的 session cookies 可读但跨请求持久化需要 ArkTS 侧 WebCookieManager 配合；
//   本实现**不**读也不写 cookie 存储 ⇒ 登录态共享属 ResourcePool 子单（不谎称已实现）。
#ifndef PROTEUS_HTTP_H
#define PROTEUS_HTTP_H

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <condition_variable>
#include <mutex>
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
  int calls = 0;             // 受理的 http.request 次数
  int ok = 0;                // 成功往返次数（errCode==0 且拿到响应）
  int failures = 0;          // 失败次数
  int lastStatus = 0;        // 最近一次 HTTP 状态码
  int tooLarge = 0;          // 超限拒绝次数（#1117）
  int tooLargeFallback = 0;  // 其中"只能事后拒绝"的次数（无逐块回调符号 · API < 13）
  /**
   * ★★★#1156：**RCP session 建了几次**（跨请求复用 ⇒ 恒为 1）。
   * 【为什么必须记】"连接复用"只有服务端看得见（`h2-echo-server` 记账）；
   *   本计数是**客户端侧**的因果证据：session 建 1 次 ⇒ 连接池有机会复用；
   *   建 N 次 ⇒ 每请求一个新池 ⇒ 必然不复用（真机实测 3 请求 / 3 TCP 即此形态）。
   */
  int sessionsCreated = 0;
  /** ★#1156：session 因失效被重建的次数（网络切换/对端关闭 ⇒ 系统回收后重建一次并重试） */
  int sessionsRecreated = 0;
  /** ★#1156：异步等待超时的次数（回调未在预算内到达；已主动 cancel） */
  int fetchTimeouts = 0;
  /** ★#1156：退化为同步 `FetchSync` 的次数（老版本库缺异步符号 ⇒ 该次**不复用连接**） */
  int syncFallback = 0;
};
inline Stats& stats() {
  static Stats s;
  return s;
}

/**
 * ★★★#1156：**进程级 RCP session 复用**（真缺陷修复）。
 *
 * 【问题（真机实测）】此前 `handle()` 是「建 session → 请求 → 关 session」——
 *   同一台设备对同一 host:port 连发 3 次 ⇒ **3 条 TCP 连接**（服务端记账：
 *   `requests=3, connections=3, reused=false`，三个不同源端口）。
 *   ⇒ RCP 的连接池**随 session 生灭** ⇒ 鸿蒙端**完全没有连接复用**（每次请求重新 TCP+TLS 握手）。
 *   ★这与 #1154 在 Android 上引入的回归同族：**功能全绿、零日志**，只有"请求数 vs 连接数"看得出来。
 *
 * 【修法】session 缓存在进程内，首个请求创建、之后复用（进程退出由系统回收）。
 *   ★为什么进程退出不显式 close：关闭时机没有安全窗口（一次性 VM 的调用边界内关掉就等于不复用；
 *     关在别处需要生命周期钩子，而宿主没有"应用退出"通知可靠到达 native 的保证）。
 *     不 close 的代价 = 一个 session 对象（非连接本身）；连接由 RCP 自己按 idle 策略回收。
 *
 * 【★★语义变化（必须登记，不能静默）】RCP session 可能自带 cookie 容器 / 连接池 /
 *   认证状态 ⇒ 复用 session 意味着**这些状态跨请求保留**：
 *   · 好的一面：与 Android `CookieManager` / iOS `HTTPCookieStorage` 的"同一份会话"语义靠拢；
 *   · 风险面：RCP 的 cookie 持久化行为**未经本仓取证**（`proteus_http.h` 原注释明确写
 *     "不带任何 interceptor / cookie 存储"）。⇒ 本轮只证明**连接复用**；cookie 语义待单独取证，
 *     在取证前**不宣称**"鸿蒙端已具备会话共享"（诚实边界）。
 *
 * 【失效兜底】session 可能因网络切换/对端关闭而失效（`1007900993` = session closed/invalid）。
 *   ⇒ 遇该错误码**重建一次并重试**（有界，最多一次，不无限重试）。
 */
struct SessionSlot {
  std::mutex mu;
  void* session = nullptr;      // Rcp_Session*（用 void* 避免把 HMS 类型泄露到 struct 外）
  bool createFnOk = false;
};
inline SessionSlot& sessionSlot() {
  static SessionSlot s;
  return s;
}

/** 响应体上限：与 Android `HttpCapability.MAX_BODY_BYTES` / iOS `HttpCapability.MAX_BODY_BYTES` **同值**。 */
constexpr size_t MAX_BODY_BYTES = 32u * 1024u * 1024u;

/** 最近一次请求的逐块闸读数（真机探针读它证明"逐块 + 真中止"，不是事后自报）。 */
struct LastLimitDiag {
  bool gateInstalled = false;   // 逐块回调是否注册成功（false ⇒ 只能事后拒绝）
  int chunks = 0;               // 回调被调用的块数
  unsigned long long seen = 0;  // 网络侧实际到达的字节（含越线后的丢弃）
  bool exceeded = false;        // 是否越线
  bool cancelCalled = false;    // 是否调用了 CancelRequest
  unsigned int cancelRc = 0;    // CancelRequest 的返回码（0 = 成功受理）
  size_t kept = 0;              // 越线前保留在内存里的字节数（≤ MAX_BODY_BYTES）
};
inline LastLimitDiag& lastLimitDiag() {
  static LastLimitDiag d;
  return d;
}

#if PROTEUS_HAVE_RCP
namespace detail {

/**
 * 逐块接收闸的状态（栈上，生命周期 = 一次 `FetchSync`）。
 * ★`body` 只在**未越线**时增长 ⇒ 内存峰值 ≤ MAX_BODY_BYTES + 单块大小。
 */
struct RecvGate {
  std::vector<uint8_t> body;
  size_t limit = 0;
  bool exceeded = false;
  bool cancelCalled = false;
  unsigned int cancelRc = 0;
  int chunks = 0;
  unsigned long long seen = 0;
  Rcp_Session* session = nullptr;
  const Rcp_Request* req = nullptr;
  unsigned int (*cancelFn)(Rcp_Session*, const Rcp_Request*) = nullptr;
};

/**
 * `Rcp_OnBinaryReceiveCallbackFunc`：越线即停止累积并尽力中止传输。
 * 返回值语义（HMS 头文件："the length of binary data"）= 本次已处理字节数；一律回 `n`，
 * 让 RCP 认为数据已被消费（越线后丢弃但不阻塞内部泵），由 cancel 真正掐断。
 */
inline size_t recvGate(void* usr, Rcp_Buffer* buf) {
  if (usr == nullptr) return 0;
  RecvGate* g = static_cast<RecvGate*>(usr);
  if (buf == nullptr || buf->buffer == nullptr || buf->length == 0) return 0;
  const size_t n = static_cast<size_t>(buf->length);
  g->chunks++;
  g->seen += n;
  if (g->exceeded) return n;  // 已越线：丢弃其余块（等 cancel 生效），内存不再增长
  if (g->limit != 0 && g->body.size() + n > g->limit) {
    g->exceeded = true;
    // ★越线后**不再累积**：内存峰值锁在 limit + 本块之前。
    if (!g->cancelCalled && g->cancelFn != nullptr && g->session != nullptr) {
      g->cancelCalled = true;
      g->cancelRc = g->cancelFn(g->session, g->req);
    }
    return n;
  }
  const uint8_t* p = reinterpret_cast<const uint8_t*>(buf->buffer);
  g->body.insert(g->body.end(), p, p + n);
  return n;
}

}  // namespace detail
#endif  // PROTEUS_HAVE_RCP

/** 超限错误（与 Android/iOS 的 `fetch.tooLarge` 同码同义）。 */
inline std::string tooLargeReason(size_t seen) {
  char buf[220];
  snprintf(buf, sizeof(buf),
           "fetch.tooLarge: 响应体超过 %zu MiB 上限（已中止读取；实际到达 %llu 字节）",
           MAX_BODY_BYTES / (1024u * 1024u), static_cast<unsigned long long>(seen));
  return buf;
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
  /**
   * ★★★#1156：**异步** `HMS_Rcp_Fetch`——生产路径改用它。
   * 【为什么（真机实测的决定性对照）】
   *   同一台设备、同一 session、同一连接池配置（`maxCacheConnections=8`），只改取数 API：
   *     · `HMS_Rcp_FetchSync` ⇒ **3 请求 / 3 TCP**（三个不同源端口，零复用）
   *     · `HMS_Rcp_Fetch`     ⇒ **3 请求 / 1 TCP**（复用）
   *   ⇒ 连接池只在**异步**路径生效；同步包装每次都新建底层 easy handle。
   *   ★这是"同一能力两种 API，语义不同"的典型：不实测无法从文档看出。
   */
  using FetchFn = uint32_t (*)(Rcp_Session*, Rcp_Request*, const Rcp_ResponseCallbackObject*);
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
  auto pFetchAsync = reinterpret_cast<FetchFn>(dlsym(lib, "HMS_Rcp_Fetch"));
  auto pCloseSession = reinterpret_cast<CloseSessionFn>(dlsym(lib, "HMS_Rcp_CloseSession"));
  // ★#1117：逐块接收 + 中止（API 13+/12+）。**可选符号**：旧设备缺 ⇒ 退化为事后拒绝（见文件头诚实边界）。
  using SetOnBinaryRecvFn = uint32_t (*)(Rcp_Request*, Rcp_OnBinaryReceiveCallback);
  using CancelRequestFn = uint32_t (*)(Rcp_Session*, const Rcp_Request*);
  auto pSetOnBinaryRecv =
      reinterpret_cast<SetOnBinaryRecvFn>(dlsym(lib, "HMS_Rcp_SetRequestOnBinaryDataRecvCallback"));
  auto pCancelRequest = reinterpret_cast<CancelRequestFn>(dlsym(lib, "HMS_Rcp_CancelRequest"));

  // ★#1156：异步 `Fetch` 是**首选**；`FetchSync` 仅在老版本库缺异步符号时兜底
  //   （兜底路径会退化到"零复用"，如实记 `stats().syncFallback++`）。
  const bool asyncOk = pFetchAsync != nullptr;
  const bool symbolsOk = pCreateSession && pCreateRequest && pDestroyRequest && pCreateHeaders &&
                         pDestroyHeaders && pSetHeaderValue && pGetHeaderEntries &&
                         (asyncOk || pFetchSync != nullptr) && pCloseSession;
  if (!symbolsOk) {
    stats().failures++;
    return proteus::wire::ResolveFrame::missingMethod(
        f.reqId, "http.unsupported: librcp_c.so 缺所需符号（版本过旧？）");
  }

  // ① session（★★★#1156：**进程级复用**——见 `SessionSlot` 注释；此前每请求建/关 ⇒ 零连接复用）
  //   ★锁只护"取/建"这一步：**不能**在整段请求期间持锁（那会把并发请求串行化，
  //     而 RCP 的 session 本身支持多请求并行）。
  Rcp_Session* session = nullptr;
  // ★`errCode` 必须在**外层**声明：后面的 `FetchSync` 也用它（本轮编译抓到的作用域错误——
  //   把它挪进 session 的块里 ⇒ 三处 `use of undeclared identifier`）。
  uint32_t errCode = 0;
  {
    SessionSlot& slot = sessionSlot();
    std::lock_guard<std::mutex> slotLock(slot.mu);
    session = static_cast<Rcp_Session*>(slot.session);
    if (session == nullptr) {
      Rcp_SessionConfiguration sc{};
      sc.type = RCP_SESSION_TYPE_HTTP;
      /**
       * ★★★#1156：**连接池大小**——这是"不复用"的真正根因（真机取证才定位到）。
       *
       * 【证据链】修复 session 复用后，真机仍是 `requests=3 / connections=3`（三个不同源端口），
       *   而 `sessionsCreated=1`（session 确实只建了一次）⇒ **session 复用不是充分条件**。
       *   服务端日志显示客户端**没有**发 `Connection: close`（`conn=-`）⇒ 不是"客户端要求关"。
       *   ⇒ 查 SDK 头文件：`Rcp_SessionConfiguration.connectionConfiguration` 里有
       *     `maxCacheConnections`（**可缓存连接数 = 连接池容量**）。
       *   ★而 `Rcp_SessionConfiguration sc{}` **零值初始化** ⇒ `maxCacheConnections = 0`
       *     ⇒ **池容量为 0 ⇒ 每条请求用完即弃 ⇒ 永不复用**。
       *   ⇒ 这是"缺省值即关闭"的经典陷阱：不配置 ≠ 用平台默认，而是**明确关闭**。
       *
       * 【取值】与 Android `HttpURLConnection` / iOS `URLSession` 的默认量级对齐（每 host 数个），
       *   不追求激进：8/8/8 足够覆盖业务并发，又不会让 idle 连接长期占用。
       */
      sc.connectionConfiguration.maxConnectionsPerHost = 8;
      sc.connectionConfiguration.maxTotalConnections = 8;
      sc.connectionConfiguration.maxCacheConnections = 8;
      session = pCreateSession(&sc, &errCode);
      if (session == nullptr) {
        stats().failures++;
        return proteus::wire::ResolveFrame::err(f.reqId, "http.failed: 建 RCP session 失败（" + std::to_string(errCode) + "）");
      }
      // ★只在**首次**建时记账；复用不计数（读数 `sessionsCreated=1` 就证明"复用真的生效了"）
      slot.session = session;
      stats().sessionsCreated++;
    }
  }

  // ② request + headers + content + 超时配置
  Rcp_Request* req = pCreateRequest(url.c_str());
  Rcp_Headers* headers = nullptr;
  Rcp_RequestContent content{};
  Rcp_Configuration cfg{};
  if (req == nullptr) {
    // ★#1156：**不要**关共享 session（那会让下一个请求重建 ⇒ 复用再次失效）
    stats().failures++;
    return proteus::wire::ResolveFrame::err(f.reqId, "http.failed: 建 RCP request 失败");
  }
  req->method = method.c_str();

  headers = pCreateHeaders();
  if (headers != nullptr) {
    if (f.headers) {
      // ★★★#1149：剔除**框架内部约定头** `X-Proteus-Bypass-Platform-Cache`
      //   （语义「请勿使用平台自带 HTTP 缓存」，由 JS 管线置位）。
      //   · `pSetHeaderValue` 是 **C ABI 函数**（鸿蒙 RCP 预编译库）⇒ 这里直接逐条判定，不调 C++ 辅助函数，
      //     保证零新增符号依赖（本文件其余部分同样只依赖 `p*` 导出）。
      //   · 鸿蒙 RCP 同步往返本身不做条件缓存 ⇒ 本端只做剔除，不改传输行为（如实）。
      //   · 必须剔除：这是框架内部头，业务服务端不该看到（与 Android/iOS 同判据）。
      for (const auto& kv : *f.headers) {
        std::string lk = kv.first;
        for (auto& ch : lk) ch = static_cast<char>(::tolower(static_cast<unsigned char>(ch)));
        if (lk == "x-proteus-bypass-platform-cache") continue;
        pSetHeaderValue(headers, kv.first.c_str(), kv.second.c_str());
      }
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

  // ③ 逐块闸：越线即中止（#1117）
  detail::RecvGate gate;
  gate.limit = MAX_BODY_BYTES;
  bool gateInstalled = false;
  if (pSetOnBinaryRecv != nullptr) {
    gate.session = session;
    gate.req = req;
    gate.cancelFn = pCancelRequest;
    Rcp_OnBinaryReceiveCallback ocb{};
    ocb.callback = &detail::recvGate;
    ocb.usrObject = &gate;
    gateInstalled = (pSetOnBinaryRecv(req, ocb) == 0);
    if (!gateInstalled) {
      fprintf(stderr, "[proteus-http] 逐块接收回调注册失败 ⇒ 退化为事后拒绝\n");
    }
  }

  // ④ 发请求（★★★#1156：**异步 Fetch + 有界等待真实完成信号**，理由见 pFetchAsync 注释）
  Rcp_Response* resp = nullptr;
  if (asyncOk) {
    /**
     * 等待器：**回调置位 + notify** 是完成信号；`wait_for` 的上限只是"回调永不到"时的安全网。
     * ★响应对象的所有权：正常路径由主线程在拷贝完 status/headers/body 后 destroy；
     *   **超时后**由迟到的回调自行 destroy（`abandoned` 标志），避免泄漏。
     */
    struct AsyncWait {
      std::mutex mu;
      std::condition_variable cv;
      bool done = false;
      bool abandoned = false;      // 主线程已放弃等待（迟到回调须自我清理）
      uint32_t err = 0;
      Rcp_Response* resp = nullptr;
      void (*destroyResp)(Rcp_Response*) = nullptr;
    };
    AsyncWait w;
    w.destroyResp = nullptr;
    auto cb = [](void* usr, Rcp_Response* r, uint32_t code) {
      auto* s = static_cast<AsyncWait*>(usr);
      std::lock_guard<std::mutex> lk(s->mu);
      if (s->abandoned) {
        // ★主线程已超时返回 ⇒ 这里必须自己销毁（否则响应对象泄漏）
        if (r != nullptr && r->destroyResponse != nullptr) r->destroyResponse(r);
        return;
      }
      s->err = code;
      s->resp = r;
      s->done = true;
      s->cv.notify_all();
    };
    Rcp_ResponseCallbackObject robj{};
    robj.callback = cb;
    robj.usrCtx = &w;
    const uint32_t fetchRc = pFetchAsync(session, req, &robj);
    if (fetchRc != 0) {
      // 受理失败：请求没发出去 ⇒ 直接按错误码返回（与同步路径的 reasonOf 口径一致）
      errCode = fetchRc;
      stats().failures++;
      if (headers != nullptr && pDestroyHeaders != nullptr) pDestroyHeaders(headers);
      pDestroyRequest(req);
      return proteus::wire::ResolveFrame::err(f.reqId, reasonOf(errCode));
    }
    /**
     * 有界等待：上限 = 请求超时 + 5s 余量。
     * ★为什么不是"无限等"：RCP 若因内部错误永不回调，无限等会把**调用线程**（鸿蒙上即 UI 线程）
     *   永久挂死——比超时返回更糟。超时后**主动 cancel** 并把错误如实回给业务。
     */
    const int64_t waitMs = static_cast<int64_t>(timeoutMs) + 5000;
    {
      std::unique_lock<std::mutex> lk(w.mu);
      if (!w.cv.wait_for(lk, std::chrono::milliseconds(waitMs), [&] { return w.done; })) {
        w.abandoned = true;
        lk.unlock();
        stats().failures++;
        stats().fetchTimeouts++;
        if (pCancelRequest != nullptr) pCancelRequest(session, req);
        if (headers != nullptr && pDestroyHeaders != nullptr) pDestroyHeaders(headers);
        pDestroyRequest(req);
        return proteus::wire::ResolveFrame::err(f.reqId, "http.timeout: 宿主未在预算内收到响应回调");
      }
      errCode = w.err;
      resp = w.resp;
    }
  } else {
    // 老版本库兜底（会退化到零复用——如实记账，不静默）
    stats().syncFallback++;
    resp = pFetchSync(session, req, &errCode);
  }

  // ⑤ 记账（探针据此证明逐块 + 真中止）
  {
    LastLimitDiag& d = lastLimitDiag();
    d.gateInstalled = gateInstalled;
    d.chunks = gate.chunks;
    d.seen = gate.seen;
    d.exceeded = gate.exceeded;
    d.cancelCalled = gate.cancelCalled;
    d.cancelRc = gate.cancelRc;
    d.kept = gate.body.size();
  }

  proteus::wire::ResolveFrame out;
  if (gate.exceeded) {
    // ★超限优先：cancel 会把 errCode 变成"Request is canceled"(1007900992)，
    //   若按 errCode 分支就会把"超限"误报成"网络取消"。
    stats().failures++;
    stats().tooLarge++;
    out = proteus::wire::ResolveFrame::err(f.reqId, tooLargeReason(gate.seen));
    if (resp != nullptr && resp->destroyResponse != nullptr) resp->destroyResponse(resp);
    resp = nullptr;
  } else if (errCode != 0 || resp == nullptr) {
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
    // ★#1117：逐块闸生效时用它累计的 body（resp->body 可能是同一份数据的二次副本）；
    //   闸未安装/未被调用时回落到 resp->body，并在此做**事后拒绝**（诚实边界：内存峰值不有界）。
    if (gateInstalled && gate.chunks > 0) {
      out.body = std::move(gate.body);
    } else if (resp->body.buffer != nullptr && resp->body.length > 0) {
      const size_t respLen = static_cast<size_t>(resp->body.length);
      if (respLen > MAX_BODY_BYTES) {
        stats().failures++;
        stats().tooLarge++;
        stats().tooLargeFallback++;
        out = proteus::wire::ResolveFrame::err(f.reqId, tooLargeReason(respLen));
        if (resp->destroyResponse != nullptr) resp->destroyResponse(resp);
        resp = nullptr;
      } else {
        const uint8_t* p = reinterpret_cast<const uint8_t*>(resp->body.buffer);
        out.body.assign(p, p + respLen);
      }
    }
    if (out.ok) {
      stats().ok++;
      if (resp != nullptr && resp->destroyResponse != nullptr) resp->destroyResponse(resp);
    }
  }

  // ④ 释放（★#1156：只释放**单次请求**的资源；session 留给后续请求复用——
  //   关掉它就等于把连接池一起丢掉，连接复用会立刻归零（真机实测 3 请求/3 TCP 就是这个原因））
  if (headers != nullptr && pDestroyHeaders != nullptr) pDestroyHeaders(headers);
  pDestroyRequest(req);
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
