// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_rcpapi.h
// ★★★#1204：**RCP 动态符号表 + 进程级 session 槽**（从 `proteus_http.h` 的 `handle()` 分出）。
//
// 【为什么抽这两块（`handle()` 曾是 480 行 / 占文件 51%，#1201 点名的遗留）】
//   它们是 `handle()` 里**最独立、且本来就该独立**的两段：
//     · **动态符号表**：一屏 `dlsym` + 类型别名散落在函数体里，把"请求流程"淹没了。
//       函数指针**无状态、无生命周期**，收成结构体是纯机械搬迁（漏参数直接编译错，编译器兜底）。
//     · **session 槽**：`SessionSlot` + 获取逻辑职责内聚（都是"进程级 session 生命周期"），
//       且 `handle()` 里那段带一把锁、一个首次创建分支、一个失败早退，读起来像"函数里的小函数"。
//
// 【★本次是**纯搬迁**，行为零变化（与 #870 的 capability.ts 拆层同纪律）】
//   逐条保持的既有语义（动这段时对照）：
//     ① `symbolsOk` 的组合判定**一字未改**（含"异步 Fetch 优先、FetchSync 兜底"）；
//     ② session 锁**只护"取/建"**，绝不在整个请求期间持锁（否则并发被串行化）；
//     ③ 失败时**不关共享 session**（关掉会让下一个请求重建 ⇒ 连接复用归零，#1156 真机实测）；
//     ④ `stats().sessionsCreated++` **只在首次创建**时计（读数用来证明"复用真的生效"）；
//     ⑤ 连接池容量 8/8/8 的取值理由见 `acquireSession` 注释（**缺省值 0 = 明确关闭**，
//        这是 #1156 定位到的"不复用"真根因）。
//
// 【★为什么不把这两个把 `stats()` 也搬进来】`Stats` 是跨能力的宿主级记账，
//   归 `proteus_http.h`；本头只**通过出参**告诉调用方"这次新建了 session"，由调用方记账。
//   ⇒ 依赖方向单一：本头不反向依赖宿主主体（否则会形成 include 环）。
#pragma once

#include <cstdint>
#include <dlfcn.h>   // ★dlsym（符号表解析；本头是这个职责的唯一落点）
#include <mutex>

#if defined(__has_include)
#if __has_include(<RemoteCommunicationKit/rcp.h>)
#include <RemoteCommunicationKit/rcp.h>
#define PROTEUS_RCPAPI_HAVE_H 1
#endif
#endif
#ifndef PROTEUS_RCPAPI_HAVE_H
#define PROTEUS_RCPAPI_HAVE_H 0
#endif

namespace proteus {
namespace http {

/** 进程级 session 槽（`handle()` 十余个出口共享；★只护"取/建"这一步）。 */
struct SessionSlot {
  std::mutex mu;
  void* session = nullptr;      // Rcp_Session*（用 void* 避免把 HMS 类型泄露到 struct 外）
  bool createFnOk = false;
};

inline SessionSlot& sessionSlot() {
  static SessionSlot s;
  return s;
}

#if PROTEUS_RCPAPI_HAVE_H
/* ★★★没有 HMS 头时整段不编译（`Rcp_Session` 等类型不存在）——
 *   与 `proteus_http.h` 的 `#if !PROTEUS_HAVE_RCP` 同一策略：缺库就诚实回 unsupported，不伪造。 */

/**
 * RCP 动态符号表。
 *
 * ★**为什么用 `dlsym` 而不是直接链接 `librcp_c.so`**：见 `proteus_http.h` 文件头（三条理由：
 *   sysroot 不在默认搜索路径 / 设备上库在 `/system/lib64/ndk` / 缺库时能诚实降级）。
 */
struct RcpApi {
  using CreateSessionFn = Rcp_Session* (*)(const Rcp_SessionConfiguration*, uint32_t*);
  using CreateRequestFn = Rcp_Request* (*)(const char*);
  using DestroyRequestFn = void (*)(Rcp_Request*);
  using CreateHeadersFn = Rcp_Headers* (*)();
  // ★HMS 侧是**单指针**（`void HMS_Rcp_DestroyHeaders(Rcp_Headers *)`）。
  using DestroyHeadersFn = void (*)(Rcp_Headers*);
  using SetHeaderValueFn = uint32_t (*)(Rcp_Headers*, const char*, const char*);
  using GetHeaderEntriesFn = Rcp_HeaderEntry* (*)(Rcp_Headers*);
  // ★真机实测：HMS 侧是**单指针**（`void HMS_Rcp_DestroyHeaderEntries(Rcp_HeaderEntry *)`，
  //   与 OHOS `OH_Http_DestroyHeaderEntries(…**)` 不同）——按双指针调会把栈地址当对象释放 ⇒ SIGSEGV。
  using DestroyHeaderEntriesFn = void (*)(Rcp_HeaderEntry*);
  using FetchSyncFn = Rcp_Response* (*)(Rcp_Session*, Rcp_Request*, uint32_t*);
  /**
   * ★★★#1156：**异步** `HMS_Rcp_Fetch`——生产路径改用它。
   * 【为什么（真机实测的决定性对照）】同一台设备、同一 session、同一连接池配置，只改取数 API：
   *   · `HMS_Rcp_FetchSync` ⇒ **3 请求 / 3 TCP**（三个不同源端口，零复用）
   *   · `HMS_Rcp_Fetch`     ⇒ **3 请求 / 1 TCP**（复用）
   * ⇒ 连接池只在**异步**路径生效；同步包装每次都新建底层 easy handle。
   * ★"同一能力两种 API，语义不同"的典型：不实测无法从文档看出。
   */
  using FetchFn = uint32_t (*)(Rcp_Session*, Rcp_Request*, const Rcp_ResponseCallbackObject*);
  using CloseSessionFn = uint32_t (*)(Rcp_Session**);
  // ★#1117：逐块接收 + 中止（API 13+/12+）。**可选符号**：旧设备缺 ⇒ 退化为事后拒绝。
  using SetOnBinaryRecvFn = uint32_t (*)(Rcp_Request*, Rcp_OnBinaryReceiveCallback);
  using CancelRequestFn = uint32_t (*)(Rcp_Session*, const Rcp_Request*);
  // ★★★#1205：multipart 上传（API 12+）。**可选符号**：缺 ⇒ upload 如实回 unsupported。
  using CreateMultipartFormFn = Rcp_MultipartForm* (*)(void);
  using DestroyMultipartFormFn = void (*)(Rcp_MultipartForm*);
  using SetMultipartFormValueFn = uint32_t (*)(Rcp_MultipartForm*, const char*, const Rcp_MultipartFormFieldValue*);

  CreateSessionFn createSession = nullptr;
  CreateRequestFn createRequest = nullptr;
  DestroyRequestFn destroyRequest = nullptr;
  CreateHeadersFn createHeaders = nullptr;
  DestroyHeadersFn destroyHeaders = nullptr;
  SetHeaderValueFn setHeaderValue = nullptr;
  GetHeaderEntriesFn getHeaderEntries = nullptr;
  DestroyHeaderEntriesFn destroyHeaderEntries = nullptr;
  FetchSyncFn fetchSync = nullptr;
  FetchFn fetchAsync = nullptr;
  CloseSessionFn closeSession = nullptr;
  SetOnBinaryRecvFn setOnBinaryRecv = nullptr;   // 可选（旧库缺）
  CancelRequestFn cancelRequest = nullptr;       // 可选（旧库缺）
  CreateMultipartFormFn createMultipartForm = nullptr;        // 可选（#1205）
  DestroyMultipartFormFn destroyMultipartForm = nullptr;      // 可选（#1205）
  SetMultipartFormValueFn setMultipartFormValue = nullptr;    // 可选（#1205）

  /** 必需符号是否齐备（`symbolsOk` 的判据与 #1156 时**一字不差**）。 */
  bool ok() const {
    const bool asyncOk = fetchAsync != nullptr;
    return createSession && createRequest && destroyRequest && createHeaders && destroyHeaders &&
           setHeaderValue && getHeaderEntries && (asyncOk || fetchSync != nullptr) && closeSession;
  }
};

/** 一次性解析全部符号（`lib` 必须是已成功 `dlopen` 的句柄）。 */
inline RcpApi loadRcpApi(void* lib) {
  RcpApi api;
  api.createSession = reinterpret_cast<RcpApi::CreateSessionFn>(dlsym(lib, "HMS_Rcp_CreateSession"));
  api.createRequest = reinterpret_cast<RcpApi::CreateRequestFn>(dlsym(lib, "HMS_Rcp_CreateRequest"));
  api.destroyRequest = reinterpret_cast<RcpApi::DestroyRequestFn>(dlsym(lib, "HMS_Rcp_DestroyRequest"));
  api.createHeaders = reinterpret_cast<RcpApi::CreateHeadersFn>(dlsym(lib, "HMS_Rcp_CreateHeaders"));
  api.destroyHeaders = reinterpret_cast<RcpApi::DestroyHeadersFn>(dlsym(lib, "HMS_Rcp_DestroyHeaders"));
  api.setHeaderValue = reinterpret_cast<RcpApi::SetHeaderValueFn>(dlsym(lib, "HMS_Rcp_SetHeaderValue"));
  api.getHeaderEntries = reinterpret_cast<RcpApi::GetHeaderEntriesFn>(dlsym(lib, "HMS_Rcp_GetHeaderEntries"));
  api.destroyHeaderEntries =
      reinterpret_cast<RcpApi::DestroyHeaderEntriesFn>(dlsym(lib, "HMS_Rcp_DestroyHeaderEntries"));
  api.fetchSync = reinterpret_cast<RcpApi::FetchSyncFn>(dlsym(lib, "HMS_Rcp_FetchSync"));
  api.fetchAsync = reinterpret_cast<RcpApi::FetchFn>(dlsym(lib, "HMS_Rcp_Fetch"));
  api.closeSession = reinterpret_cast<RcpApi::CloseSessionFn>(dlsym(lib, "HMS_Rcp_CloseSession"));
  // ★符号名逐字照抄（写错只会静默退化成"事后拒绝"，不会报错）
  api.setOnBinaryRecv = reinterpret_cast<RcpApi::SetOnBinaryRecvFn>(
      dlsym(lib, "HMS_Rcp_SetRequestOnBinaryDataRecvCallback"));
  api.cancelRequest = reinterpret_cast<RcpApi::CancelRequestFn>(dlsym(lib, "HMS_Rcp_CancelRequest"));
  // ★#1205：multipart（可选——缺则 upload 如实回 unsupported，不伪造成功）
  api.createMultipartForm =
      reinterpret_cast<RcpApi::CreateMultipartFormFn>(dlsym(lib, "HMS_Rcp_CreateMultipartForm"));
  api.destroyMultipartForm =
      reinterpret_cast<RcpApi::DestroyMultipartFormFn>(dlsym(lib, "HMS_Rcp_DestroyMultipartForm"));
  api.setMultipartFormValue =
      reinterpret_cast<RcpApi::SetMultipartFormValueFn>(dlsym(lib, "HMS_Rcp_SetMultipartFormValue"));
  return api;
}

/**
 * 取（或首次创建）进程级 session。
 *
 * @param api     已解析的符号表（`api.ok()` 必须为 true，调用方负责先判）
 * @param errCode 出参：失败时的 RCP 错误码（调用方拼进错误文案）
 * @param created 出参：本次是否**新建**了 session（调用方据此记 `stats().sessionsCreated`）
 * @return session 指针；`nullptr` = 建失败（调用方须 `stats().failures++` 并回错误帧）
 *
 * ★**锁只护"取/建"**：`Rcp_Session` 本身支持多请求并行，整段请求期间持锁会把并发串行化。
 */
inline Rcp_Session* acquireSession(const RcpApi& api, uint32_t* errCode, bool* created) {
  *created = false;
  *errCode = 0;
  SessionSlot& slot = sessionSlot();
  std::lock_guard<std::mutex> slotLock(slot.mu);
  Rcp_Session* session = static_cast<Rcp_Session*>(slot.session);
  if (session != nullptr) return session;
  /**
   * ★★★#1204：**session 配置必须是 static（进程寿命）——不能是栈局部**。
   *
   * 【真机崩溃取证（本轮）】重构后请求一发出就 `SIGSEGV(SEGV_MAPERR)`，栈是：
   *   `handle() → RcpSessionBasedFetchHandle → RcpToCppRequest(const Rcp_SessionConfiguration*, …)`
   *   `→ std::string(char const*) → strlen`。
   *  ⇒ **RCP 是在 fetch 时才去读 session 配置里的 `char*` 字段**（CA 内容/文件路径/DoH url 等），
   *    而不是在 `CreateSession` 时拷一份。
   *  ⇒ 原实现的 `Rcp_SessionConfiguration sc{}` 是 **`handle()` 栈上的局部变量**：
   *     `CreateSession` 返回后它就可能被覆盖 ⇒ **悬垂指针**。之前没崩只是栈布局恰好还留着旧值，
   *     重构（栈帧变了）当场暴露。
   *  ★这是"以前没崩 ≠ 正确"的典型：**跨调用存活的对象，其配置也必须在同一寿命层**。
   *  ⇒ 改为函数内 `static`（进程级、零初始化一次），生命周期与 `sessionSlot()` 里的 session 一致。
   *  ★线程安全：整段在 `slot.mu` 保护下，且只在**首次创建**时写（之后直接返回早退）。
   */
  static Rcp_SessionConfiguration sc{};
  static bool scInit = false;
  if (!scInit) {
    scInit = true;
    sc.type = RCP_SESSION_TYPE_HTTP;
    /**
     * ★★★#1156：**连接池大小**——这是"不复用"的真正根因（真机取证才定位到）。
     *
     * 【证据链】修复 session 复用后，真机仍是 `requests=3 / connections=3`（三个不同源端口），
     *   而 `sessionsCreated=1`（session 确实只建了一次）⇒ **session 复用不是充分条件**。
     *   服务端日志显示客户端**没有**发 `Connection: close` ⇒ 不是"客户端要求关"。
     *   ⇒ 查 SDK 头文件：`Rcp_SessionConfiguration.connectionConfiguration` 里有
     *     `maxCacheConnections`（**可缓存连接数 = 连接池容量**）。
     *   ★而 `Rcp_SessionConfiguration sc{}` **零值初始化** ⇒ `maxCacheConnections = 0`
     *     ⇒ **池容量为 0 ⇒ 每条请求用完即弃 ⇒ 永不复用**。
     *   ⇒ "缺省值即关闭"的经典陷阱：不配置 ≠ 用平台默认，而是**明确关闭**。
     *
     * 【取值】与 Android `HttpURLConnection` / iOS `URLSession` 的默认量级对齐（每 host 数个），
     *   不追求激进：8/8/8 足够覆盖业务并发，又不会让 idle 连接长期占用。
     */
    sc.connectionConfiguration.maxConnectionsPerHost = 8;
    sc.connectionConfiguration.maxTotalConnections = 8;
    sc.connectionConfiguration.maxCacheConnections = 8;
  }
  session = api.createSession(&sc, errCode);
  if (session == nullptr) return nullptr;
  slot.session = session;
  *created = true;
  return session;
}

#endif  // PROTEUS_RCPAPI_HAVE_H

}  // namespace http
}  // namespace proteus
