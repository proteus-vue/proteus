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

/**
 * ★★★#1344 B-2c 缺陷修复：**`PROTEUS_HAVE_RCP` 必须在 `proteus_http_rcpapi.h` 之前定义**。
 *
 * 【真机症状】`abort()` 后 JS 侧四项全对（`inPending/encoded/sent=true`、169 字节回执），
 *   而宿主 `cancelStats.calls=0`、`unsupported=1` ⇒ 判据 `stage=host:rcp-cancel-symbol-missing`。
 *
 * 【根因】这段 `__has_include` 判定原先写在**所有子头 include 之后**，而 `proteus_http_rcpapi.h`
 *   在**它之前**就被 include 了 ⇒ `rcpapi.h` 里的 `#if PROTEUS_HAVE_RCP` 在预处理时
 *   看到的是**未定义**（C 预处理规则：#if 里未定义标识符 = 0）⇒
 *   `cancelRcpRequestRaw` 的函数体整个被编成 `return false`。
 *   ★注意：HTTP 请求本身正常，因为它的 `#if PROTEUS_HAVE_RCP`（本文件 266 行起）在定义**之后**。
 *   ⇒ 同一份代码里同一宏有**两种取值**，只有"取消"这一条路径静默失效。
 *   ★这是"宏的可见性随时间变化"型缺陷：单元测试与 `-fsyntax-only` 都看不见
 *     （两个分支都能编译），只有真机跑到那条分支才暴露。
 *
 * ⇒ 定义/包含顺序必须是：先探 RCP 头 → 再 include 依赖该宏的子头。
 */
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

#include "proteus_http_save.h"   // ★#1187：savePath 落盘（沙箱路径校验 + 逐块直写）
#include "proteus_http_recv.h"   // ★#1344 B-3：逐块接收闸（累积 / 落盘 / 流式回推 三选一分流）
#include "proteus_http_diag.h"   // ★#1194：VmHWM 读取（读数记账）
#include "proteus_http_transport.h"   // ★#1191：传输读数装配（区间换算 + DNS 来源映射）
#include "proteus_http_doh.h"         // ★#1202：DoH 落点探针状态（取证专用，生产零影响）
#include "proteus_http_guard.h"       // ★#1203：不支持能力的**前置拒绝**（stream / tlsPins）
#include "proteus_http_rcpapi.h"      // ★#1204：RCP 符号表 + 进程级 session 槽（从 handle() 分出）
#include "proteus_http_response.h"    // ★#1204：成功响应装配（从 handle() 分出）
#include "proteus_http_upload.h"      // ★#1205：multipart 上传（路径交给平台流式读）

namespace proteus {
namespace http {

/* ══════════════════════ 会话式 VM 的钩子（#1344 B-2 / B-2c / B-3） ══════════════════════
 *
 * 【为什么用函数指针】`proteus_vm_session.h` **包含**本文件；本文件不能反向 include 它
 *   （循环依赖）。钩子让"会话模式"由会话模块注册，本文件只负责在正确时机调用。
 * 【一次性 VM（生产路径）下全部是 nullptr】⇒ 行为与改造前**逐字节等价**。
 */
/**
 * ★B-2c：**在途登记**（`reqId` → 可取消的 RCP 请求）。
 *   `handle()` 在 `createRequest` 之后立刻调用；在 `destroyRequest` 之前注销。
 *   ★为什么需要：`HMS_Rcp_CancelRequest(session, req)` 需要**那个 req 指针**，
 *     而它只活在 `handle()` 的栈上 ⇒ 不登记就永远拿不到，`abort()` 只能是 no-op。
 */
typedef void (*ProteusHttpRegisterFn)(const std::string& reqId, void* session, void* req);
static ProteusHttpRegisterFn g_proteusHttpRegister = nullptr;
static inline void setHttpRegisterHandler(ProteusHttpRegisterFn fn) { g_proteusHttpRegister = fn; }

/** 注销在途登记（成功/失败/超时都要调，否则表泄漏） */
typedef void (*ProteusHttpUnregisterFn)(const std::string& reqId);
static ProteusHttpUnregisterFn g_proteusHttpUnregister = nullptr;
static inline void setHttpUnregisterHandler(ProteusHttpUnregisterFn fn) { g_proteusHttpUnregister = fn; }

/** 统一注销入口（各处 `destroyRequest` 前调；未注册时是 no-op） */
static inline void unregisterInflight(const std::string& reqId) {
  if (g_proteusHttpUnregister != nullptr) g_proteusHttpUnregister(reqId);
}

/**
 * ★★★#1344 B-3：流式块回推钩子的**声明在 `proteus_http_guard.h`**（那里才有"可用性判据"
 *   需要它；而本文件在本头之后才定义 ⇒ 写在会这里看不见）。这里只补一句指针说明。
 */

/* ★B-2c 的 `cancelRcpRequest` 定义在文件末尾（它要用 `stats()`）；RCP 类型相关的实现在
   `proteus_http_rcpapi.h` 的 `cancelRcpRequestRaw`（本文件已 include 它）。 */
inline bool cancelRcpRequestRaw(void* session, void* req, uint32_t* outRc);
inline bool cancelRcpRequest(void* session, void* req);


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
  /** ★★★#1344 B-2c：真取消的记账（`calls` = 调到 cancel 的次数；`hits` = RCP 回 0 的次数） */
  int cancelCalls = 0;
  int cancelHits = 0;
  int cancelMisses = 0;
  /**
   * ★★★#1344 B-2c 诊断：`http.cancel` **到了宿主但没调 cancel 符号**的两种成因。
   *
   * 【为什么必须分开记（本轮真机踩的坑）】此前判据只看 `cancelCalls`，而它是 **0 的三义**：
   *   ① 帧根本没到宿主（JS 侧抛错被吞 / 通道没接）② 到了但 `reqId` 不在在途表
   *   ③ 到了、命中表、但 RCP 库缺 `HMS_Rcp_CancelRequest` 符号。
   *   三者对 `cancelCalls=0` **完全同形** ⇒ 只能靠"再跑一次"逐条排除（浪费真机轮次）。
   *   ⇒ 每个分支各记一个数，一次运行就能定位（本仓纪律：读数必须可归因）。
   */
  int cancelNoInflight = 0;    // ② 请求不在在途表（已完成 / 非会话通道 / reqId 对不上）
  int cancelUnsupported = 0;   // ③ RCP 库缺 cancel 符号（`cancelRcpRequest` 提前 return）
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
 *
 * ★★★#1204：`SessionSlot` / `sessionSlot()` 已搬到 `proteus_http_rcpapi.h`
 *   （与 `RcpApi` 符号表、`acquireSession()` 放在一起——都是"进程级 RCP 资源"）。
 */

/** 响应体上限：与 Android `HttpCapability.MAX_BODY_BYTES` / iOS `HttpCapability.MAX_BODY_BYTES` **同值**。 */
constexpr size_t MAX_BODY_BYTES = 32u * 1024u * 1024u;

/** 最近一次请求的逐块闸读数（真机探针读它证明"逐块 + 真中止"，不是事后自报）。 */

/* ══════════════ ★★★#1169：HTTPDNS 的**鸿蒙落点取证**（仅探针启用，生产零影响） ══════════════
 *
 * 【为什么要这段（用户「继续」后接着收 HTTPDNS）】
 *   `rcp.h` 的 `Rcp_DnsConfiguration` 提供**四条**域名解析定制路径：
 *     · `Rcp_DnsOverHttps`（DoH：给一个 HTTPS DNS 服务端 URL）
 *     · `RCP_DNS_RULE_DNS_SERVERS`（指定 DNS 服务器 IP:port）
 *     · `RCP_DNS_RULE_STATIC`（host → IP 的静态映射表）
 *     · `RCP_DNS_RULE_DYNAMIC`（`Rcp_IpAddress* (*)(const char* host, uint16_t port)` 回调）
 *   ★★★**第四条与 Android 的 `Dns.lookup(host) → List<InetAddress>` 语义同构**——
 *     都是"框架调我们给的函数要 IP"。⇒ 矩阵里"鸿蒙需自建解析器"这个判断偏了：
 *     鸿蒙**有**函数注入点，且形状与 Android 一致 ⇒ HTTPDNS 的线格式可以**两端同一套**。
 *   ★但"头文件里有"≠"真生效"（本仓纪律：先取证再断言）⇒ 下面这段给探针用：
 *     注入一个"假解析器"，把目标 host 解析到**一个不可达 IP**，若请求因此失败
 *     且回调被调用过 ⇒ 证明这条路真的接通。
 *
 * 【★生产零影响】`installed=false` 时 `handle()` 完全不碰 `cfg.dnsConfiguration`；
 *   探针改完会复位。默认走系统 DNS 的行为一字未变。
 */
struct DnsProbe {
  bool installed = false;        // 探针是否安装假解析器
  int calls = 0;                 // 假解析器被调用次数（>0 ⇒ 这条路真的接通）
  std::string lastHost;          // 最后被解析的 host（判据核对"解析的是目标域名"）
  unsigned int lastPort = 0;     // 最后被解析的 port
  std::string forcedIp;          // 强制返回的 IP；空 ⇒ 返回 nullptr（让解析失败）
  /** ★#1169：本次请求装了几条表规则（判据可证"表真被装上"，>0 即装上） */
  int tableRules = 0;
  /** ★#1169：表命中的次数（>0 ⇒ 业务的表真的被用于解析） */
  int tableHits = 0;
  /** ★#1169：最后一次解析的来源（`table` / `probe` / `miss`） */
  std::string lastSource;
};
inline DnsProbe& dnsProbe() {
  static DnsProbe p;
  return p;
}

/**
 * ★★★#1169：**当前请求的 HTTPDNS 表**（`handle()` 栈上对象的地址；请求结束即失效）。
 * ★只在 `handle()` 内有效——所以 `handle()` 必须在退出前清空（见 finally）。
 */
inline const proteus::wire::NameValues*& httpDnsTable() {
  static const proteus::wire::NameValues* t = nullptr;
  return t;
}

/**
 * ★★★#1183：**本次请求**的域名解析来源（`table` / `miss`）。
 *
 * 【为什么不能复用 `dnsProbe().lastSource`】那是**进程级**最后一次——并发/连续请求时
 *   会被别的请求覆盖（与 Android 的 `lastDnsSource` 同一个坑）。
 * ★空串 = 本次没有发生解析（URL 本身是 IP、或连接复用）⇒ 上层**不写**该字段
 *   （"没解析" ≠ "走了系统 DNS"，本仓纪律：不拿缺省值冒充已知）。
 */
inline std::string& callDnsSource() {
  static std::string s;
  return s;
}

/** ★#1183：请求开始时清空（由 `handle()` 的 RAII 守卫一并负责） */
struct CallDnsSourceGuard {
  ~CallDnsSourceGuard() { callDnsSource().clear(); }
};

/**
 * ★★★#1186：**最近一次请求的传输读数**（供 `http_probe.h` 的探针回执读取）。
 *
 * 【为什么需要一份进程级副本】回程帧里的 `transport` 只有走 `useFetch` 的业务看得到；
 *   而鸿蒙 HTTP 探针走**原生直调**（ArkTS 自编帧 → C++ 执行），JS 侧拿不到 `meta` ⇒
 *   没有这份副本就**无法在鸿蒙真机验证 `dnsSource`**（#1185 的诚实边界 b）。
 * ★只用于取证探针，**不参与**业务读数生成（业务仍读回程帧）。
 */
inline proteus::wire::NameValues& lastTransport() {
  static proteus::wire::NameValues t;
  return t;
}

/**
 * ★★★#1169：**RAII 守卫**——`handle()` 有十余个 return 出口，逐个加清理太脆
 * （漏一个就是"表指针悬垂 ⇒ 下一个请求读到已析构对象"）。
 * ⇒ 用析构函数清空：无论从哪个出口返回、还是抛异常，都会执行。
 */
struct HttpDnsTableGuard {
  ~HttpDnsTableGuard() { httpDnsTable() = nullptr; }
};


#if PROTEUS_HAVE_RCP
namespace detail {

/**
 * ★★★#1169：**探针用的假解析器**（`RCP_DNS_RULE_DYNAMIC` 的回调）。
 *
 * 形状与 Android `okhttp3.Dns.lookup` 同构：`(host, port) → IP 地址链`。
 * · `forcedIp` 非空 ⇒ 返回它（用于"解析到不可达 IP ⇒ 请求必失败"的因果实验）；
 * · `forcedIp` 为空 ⇒ 返回 `nullptr`（RCP 视为解析失败）。
 * ★返回的是 `static` 存储：RCP 在本次请求内读取，生命周期足够；且探针串行执行。
 */
inline Rcp_IpAddress* probeDnsLookup(const char* host, uint16_t port) {
  DnsProbe& p = dnsProbe();
  p.calls++;
  p.lastHost = host != nullptr ? host : "";
  p.lastPort = port;
  p.lastSource = "probe";
  if (p.forcedIp.empty()) return nullptr;
  static Rcp_IpAddress ip;
  ::memset(&ip, 0, sizeof(ip));
  ::snprintf(ip.ipAddress, sizeof(ip.ipAddress), "%s", p.forcedIp.c_str());
  ip.next = nullptr;
  return &ip;
}

/**
 * ★★★#1169：**按业务给的表解析**（`RCP_DNS_RULE_DYNAMIC` 回调，生产路径用）。
 *
 * · 表里**没有**该域名 ⇒ 返回 `nullptr` ⇒ RCP 回落系统 DNS（**不改变无关请求的行为**）；
 * · 表里有且 IP 可解析 ⇒ 返回链头（多 IP 用 `next` 串起来，按序尝试）；
 * · 表里有但 IP 全非法 ⇒ 也返回 `nullptr`（RCP 会当解析失败）——**不静默用系统 DNS**，
 *   否则业务给的错 IP 会被掩盖。
 *
 * 【★返回的链表存在 `static` 池里】RCP 在本次请求内读取；探针/生产都串行执行（一次 handle 一个），
 *   池在每次调用时重置 ⇒ 不会跨请求串味。
 * ★域名匹配**大小写不敏感**（DNS 语义；业务可能传大写）。
 */
inline Rcp_IpAddress* tableDnsLookup(const char* host, uint16_t port) {
  DnsProbe& p = dnsProbe();
  p.calls++;
  p.lastHost = host != nullptr ? host : "";
  p.lastPort = port;
  const proteus::wire::NameValues* table = httpDnsTable();
  // ★#1183：per-request 来源（miss 也要记——"回落系统"本身是可观测事实）
  if (table == nullptr) { callDnsSource() = "miss"; p.lastSource = "miss"; return nullptr; }
  std::string want = host != nullptr ? host : "";
  for (auto& ch : want) ch = static_cast<char>(::tolower(static_cast<unsigned char>(ch)));
  std::string ipsCsv;
  for (const auto& kv : *table) {
    std::string k = kv.first;
    for (auto& ch : k) ch = static_cast<char>(::tolower(static_cast<unsigned char>(ch)));
    if (k == want) { ipsCsv = kv.second; break; }
  }
  if (ipsCsv.empty()) { callDnsSource() = "miss"; p.lastSource = "miss"; return nullptr; }
  // 静态池：每次调用重置（一次 handle 内只有一个域名在被解析）
  static std::vector<Rcp_IpAddress> pool;
  pool.clear();
  size_t start = 0;
  while (start <= ipsCsv.size()) {
    const size_t comma = ipsCsv.find(',', start);
    const size_t end = (comma == std::string::npos) ? ipsCsv.size() : comma;
    std::string ip = ipsCsv.substr(start, end - start);
    while (!ip.empty() && (ip.front() == ' ' || ip.front() == '\t')) ip.erase(ip.begin());
    while (!ip.empty() && (ip.back() == ' ' || ip.back() == '\t')) ip.pop_back();
    if (!ip.empty()) {
      Rcp_IpAddress a{};
      ::snprintf(a.ipAddress, sizeof(a.ipAddress), "%s", ip.c_str());
      a.next = nullptr;
      pool.push_back(a);
    }
    if (comma == std::string::npos) break;
    start = comma + 1;
  }
  if (pool.empty()) { callDnsSource() = "miss"; p.lastSource = "miss"; return nullptr; }
  for (size_t i = 0; i + 1 < pool.size(); i++) pool[i].next = &pool[i + 1];
  p.tableHits++;
  p.lastSource = "table";
  callDnsSource() = "table";
  return &pool[0];
}

/* ★★★#1344 B-3：`RecvGate` + `recvGate()` 已抽到 `proteus_http_recv.h`。
   理由：它们是"响应体怎么处理"的**唯一三选一分流点**（累积 / 落盘 / 流式回推），
   单独成文件才不会被"谁先注册谁生效"的隐式顺序吞掉；也把本文件拉回 1000 行以内。 */
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

/**
 * `librcp_c.so` 的探测 —— ★★★#1344 B-2c：**唯一实现在 `proteus_http_rcpapi.h` 的 `openRcp()`**。
 *
 * 【为什么下沉】本函数是"RCP 库句柄的唯一探测点"，而 `cancelRcpRequestRaw` 也需要同一个句柄。
 *   此前它写在本文件（**晚于** `rcpapi.h` 的 include）⇒ `rcpapi.h` 里的 cancel
 *   只能自己 `dlopen("librcp_c.so")` 裸名 ⇒ 设备上库在 `/system/lib64/ndk/` ⇒
 *   取消永远拿不到句柄。⇒ 探测点下沉到 `rcpapi.h`（RCP 句柄与符号的职责落点），
 *   这里与 `rcpapi.h` 同在 `namespace proteus::http` ⇒ 直接可见，无需转发。
 */

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
  /**
   * ★★★#1191（独立验证 J8）：**每个请求开始时清空上次的 transport 副本**。
   *   原实现从不清 ⇒ 本次是"复用连接/早退（没走到 timeInfo）"时，`lastTransport()` 仍留着
   *   **上一个请求**的读数 ⇒ 探针会把旧值当新值（真机上靠 `aa force-stop` 冷启动掩盖了）。
   */
  lastTransport().clear(); lastLimitDiag() = LastLimitDiag{};   // ★#1196：入口重置（防早退路径带上一次读数）

  // ★#1193（B4）：记录请求前的进程峰值 RSS（落盘内存是否与文件大小无关，靠前后差值判）
  const unsigned long long vmHwmBefore = readVmHwmKb();
  if (!f.url || f.url.v.empty()) {
    stats().failures++;
    return proteus::wire::ResolveFrame::err(f.reqId, "http.request 需要 url（meta 里没带）");
  }
  /**
   * ★★★#1187 / #1203：**「本端结构上不支持的能力」一律前置拒绝**（实现见 `proteus_http_guard.h`）。
   *
   * 【为什么必须显式拒绝而不是静默忽略】"帧里解出来了但宿主不用"是本仓最坏的缺陷形态：
   *   业务以为某能力生效了，实际一次都没执行。鸿蒙两条都踩过——
   *   `stream` 曾静默忽略（#1187 修）· `tlsPins` 曾静默忽略（#1203 修，且**安全面**更严重：
   *   业务配了 pin 以为多了防 MITM 一道防线，而请求不带任何校验照常发出）。
   * 【为什么放在这里】必须在**发请求之前**拒绝——尤其 pin：不能先发出一段未受保护的流量再说。
   */
  {
    const std::string unsupported = unsupportedFeatureReason(f);
    if (!unsupported.empty()) {
      stats().failures++;
      return proteus::wire::ResolveFrame::err(f.reqId, unsupported);
    }
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

  /**
   * ★★★#1204：**符号解析搬到 `proteus_http_rcpapi.h`**（原先是约 50 行 `using` + `dlsym`
   *   散落在 `handle()` 里，把请求流程淹没了）。逐条语义原样保留：
   *   · 单指针 `DestroyHeaders` / `DestroyHeaderEntries`（双指针会 SIGSEGV，真机实测）；
   *   · **异步 `Fetch` 优先、`FetchSync` 兜底**（#1156：只有异步路径才复用连接）；
   *   · 逐块接收/取消是**可选符号**（旧库缺 ⇒ 退化为事后拒绝，#1117）。
   */
  RcpApi api = loadRcpApi(lib);
  if (!api.ok()) {
    stats().failures++;
    return proteus::wire::ResolveFrame::missingMethod(
        f.reqId, "http.unsupported: librcp_c.so 缺所需符号（版本过旧？）");
  }
  const bool asyncOk = api.fetchAsync != nullptr;

  // ① session（★★★#1156：**进程级复用**；#1204 把"取/建"搬到 `acquireSession`）
  //   ★锁只护"取/建"这一步：**不能**在整段请求期间持锁（那会把并发请求串行化，
  //     而 RCP 的 session 本身支持多请求并行）。
  // ★`errCode` 必须在**外层**声明：后面的取数也用它（本轮编译抓到的作用域错误——
  //   把它挪进 session 的块里 ⇒ 三处 `use of undeclared identifier`）。
  uint32_t errCode = 0;
  bool sessionCreated = false;
  Rcp_Session* session = acquireSession(api, &errCode, &sessionCreated);
  if (session == nullptr) {
    stats().failures++;
    return proteus::wire::ResolveFrame::err(
        f.reqId, "http.failed: 建 RCP session 失败（" + std::to_string(errCode) + "）");
  }
  // ★只在**首次**建时记账；复用不计数（读数 `sessionsCreated=1` 就证明"复用真的生效了"）
  if (sessionCreated) stats().sessionsCreated++;

  // ② request + headers + content + 超时配置
  Rcp_Request* req = api.createRequest(url.c_str());
  /* ★★★#1344 B-2c：**在途登记**（会话模式才有钩子；一次性 VM 下为 nullptr ⇒ 零行为变化）。
     登记 `reqId → (session, req)`，让 `http.cancel` 能真的调 `HMS_Rcp_CancelRequest`。
     ★必须在这里登记（req 刚建、还没发出）—— 太晚会漏掉"发出后立刻取消"的时序。
     ★注销点在各处 `destroyRequest(req)` 之前（成功/失败/超时都要，否则表泄漏）。 */
  if (g_proteusHttpRegister != nullptr) g_proteusHttpRegister(f.reqId, session, req);
  Rcp_Headers* headers = nullptr;
  Rcp_RequestContent content{};
  Rcp_Configuration cfg{};
  /**
   * ★★★#1205：multipart 上传构件。★**必须声明在这里（`handle()` 作用域）**——
   *   RCP 可能在发送时才去读 form 里的 `char*`（路径/文件名）与 `Rcp_Buffer`，
   *   放内层块会悬垂（#1204 的 session 配置崩溃就是同一类错误：**跨调用存活的对象不能是栈局部**）。
   */
  MultipartUpload uploadParts;
  /**
   * ★#1205：**RAII 销毁**——`handle()` 有十余个 return 出口，逐个补销毁太脆
   *   （本仓在 `SaveSession` / `HttpDnsTableGuard` 上都是这个教训）。
   *   ★析构顺序：本守卫在 `uploadParts` 之后声明 ⇒ **先析构**，此时 `uploadParts` 仍有效。
   *   ★必须在 `pDestroyRequest(req)` 之前销毁 form？——不必：RCP 的 request 只持有指针，
   *     `HMS_Rcp_DestroyRequest` 不负责销毁调用方创建的 form（form 由创建者销毁）。
   */
  struct UploadGuard {
    const RcpApi* api;
    MultipartUpload* m;
    ~UploadGuard() { destroyMultipartUpload(*api, m); }
  };
  UploadGuard uploadGuard{&api, &uploadParts};
  const bool isUpload = f.upload.has && !f.upload.path.empty();
  if (req == nullptr) {
    // ★#1156：**不要**关共享 session（那会让下一个请求重建 ⇒ 复用再次失效）
    stats().failures++;
    return proteus::wire::ResolveFrame::err(f.reqId, "http.failed: 建 RCP request 失败");
  }
  req->method = method.c_str();

  headers = api.createHeaders();
  /**
   * ★★★#1205：**先构造 multipart**（失败要**在发请求之前**如实报错，不能降级成发空体）。
   * ★构造放在建 headers 之后、设头的循环之前，是为了让下面的"剔除 Content-Type"知道 isUpload。
   */
  if (isUpload) {
    uploadParts = buildMultipartUpload(api, f.upload);
    if (!uploadParts.ok) {
      stats().failures++;
      // ★清理：req 已建（headers 可能也建了）⇒ 按既有出口纪律销毁，不碰共享 session
      if (headers != nullptr && api.destroyHeaders != nullptr) api.destroyHeaders(headers);
      unregisterInflight(f.reqId);   // ★B-2c：注销在途登记（防表泄漏）
      api.destroyRequest(req);
      return proteus::wire::ResolveFrame::err(f.reqId, uploadParts.err);
    }
    content.type = RCP_CONTENT_TYPE_MULTIPARTFORM;
    content.data.multipartForm = uploadParts.form;
    req->content = &content;
    // upload 的体由平台按 form 生成 ⇒ 帧里的整包 body 不应再发（与 Android 清 cfg.body 同源）
  }
  if (headers != nullptr) {
    if (f.headers) {
      // ★★★#1149：剔除**框架内部约定头** `X-Proteus-Bypass-Platform-Cache`
      //   （语义「请勿使用平台自带 HTTP 缓存」，由 JS 管线置位）。
      //   · `api.setHeaderValue` 是 **C ABI 函数**（鸿蒙 RCP 预编译库）⇒ 这里直接逐条判定，不调 C++ 辅助函数，
      //     保证零新增符号依赖（本文件其余部分同样只依赖 `p*` 导出）。
      //   · 鸿蒙 RCP 同步往返本身不做条件缓存 ⇒ 本端只做剔除，不改传输行为（如实）。
      //   · 必须剔除：这是框架内部头，业务服务端不该看到（与 Android/iOS 同判据）。
      for (const auto& kv : *f.headers) {
        std::string lk = kv.first;
        for (auto& ch : lk) ch = static_cast<char>(::tolower(static_cast<unsigned char>(ch)));
        if (lk == "x-proteus-bypass-platform-cache") continue;
        /**
         * ★★★#1205：**上传时必须剔除调用方的 `Content-Type`**。
         *   鸿蒙用 RCP 的 multipart API ⇒ **boundary 由平台生成**，而 JS 传下来的头里
         *   写的是 JS 自己生成的 boundary（Android/iOS 用它拼体，头体同源）。
         *   若把头原样透传 ⇒ 头里一个 boundary、体里另一个 ⇒ **服务端必然解析失败**
         *   （Android 侧踩过同族："两处 boundary 必须同源"）。
         *   ⇒ 让平台自己写 `Content-Type: multipart/form-data; boundary=<它自己的>`。
         *   ★这是与 Android/iOS 的**语义差异**（boundary 谁生成），已登记在
         *     `proteus_http_upload.h` 文件头。
         */
        if (isUpload && lk == "content-type") continue;
        api.setHeaderValue(headers, kv.first.c_str(), kv.second.c_str());
      }
    }
    // ★contentType 只在调用方没显式给 Content-Type 时补（调用方语义优先，与 Android 同）
    // ★上传时不补：由平台按 multipart 生成（见上一条）
    if (f.contentType && !isUpload) {
      bool hasCt = false;
      if (f.headers) {
        for (const auto& kv : *f.headers) {
          std::string k = kv.first;
          for (auto& ch : k) ch = static_cast<char>(::tolower(static_cast<unsigned char>(ch)));
          if (k == "content-type") { hasCt = true; break; }
        }
      }
      if (!hasCt) api.setHeaderValue(headers, "Content-Type", f.contentType.v.c_str());
    }
    req->headers = headers;
  }
  /**
   * ★★★#1205：**upload 时不再走整包 body 分支**——`content` 已被上面的 multipart 占用
   *   （`Rcp_RequestContent.type` 是判别式联合，后写会覆盖前一个）。
   *   ★这正是 Android 侧 `cfg.body = null` 的同源约束：上传的体由平台按 form 生成，
   *     帧里的 `f.body`（通常为空）若再挂上去会覆盖 multipart ⇒ 文件根本没被发送。
   */
  if (!isUpload && !f.body.empty()) {
    content.type = RCP_CONTENT_TYPE_STRING;
    content.data.contentStr.buffer = reinterpret_cast<const char*>(f.body.data());
    content.data.contentStr.length = static_cast<uint32_t>(f.body.size());
    req->content = &content;
  }
  /**
   * ★★★#1203：**`redirectManual` 必须生效**（此前硬编码 `true` ⇒ `useFetch({redirect:'manual'})`
   *   在鸿蒙上会**照常跟随重定向**，业务以为拦住了、实际没拦）。
   *   `Rcp_TransferConfiguration.autoRedirect` 就是开关 ⇒ 直接照帧里的意图设。
   *   ★与 Android `followRedirects(!manual)` / iOS `willPerformHTTPRedirection` 同语义：
   *     manual ⇒ **不跟随**，把 3xx 原样回给框架（后续的 `error` 判定、跨域剥离凭据、
   *     RFC 方法改写全在 TS 层 `capability-fetch-redirect.ts`，跨端同一份）。
   *   ★缺省（帧里没有该 tag）= 跟随，与平台默认一致。
   */
  cfg.transferConfiguration.autoRedirect = !(f.redirectManual && *f.redirectManual);
  cfg.transferConfiguration.timeout.connectMs = timeoutMs;
  cfg.transferConfiguration.timeout.transferMs = timeoutMs;
  /**
   * ★★★#1158：打开**分段计时采集**（`resp->timeInfo` 只有在打开后才有值）。
   * 【为什么不总是开】RCP 文档注明"是否采集由 `collectTimeInfo` 决定"——采集本身有成本
   *   （每次请求多记一组时间点）。但本仓要的就是**可观测性**，且读数会进 `FetchMeta.transport`
   *   供业务排障 ⇒ 默认打开。★若将来要关，必须同时把 `transport` 的对应键**不写**
   *   （不能留着上一次的读数 —— 那会成为"用旧值冒充新值"，本仓记过的形态）。
   */
  cfg.tracingConfiguration.collectTimeInfo = true;
  /**
   * ★★★#1169：**只有探针安装时才接自定义 DNS**（生产默认走系统 DNS，行为一字未变）。
   *   `RCP_DNS_RULE_DYNAMIC` 的回调形状 = `(host, port) → Rcp_IpAddress*`，
   *   与 Android `Dns.lookup(host) → List<InetAddress>` **语义同构** ⇒ HTTPDNS 可两端同一套语义。
   * ★`dnsRule` 必须活到请求结束 ⇒ 声明在这里（与 `cfg` 同栈帧），不放进 if 块内。
   */
  /**
   * ★★★#1169：**per-call HTTPDNS 表**（走 `RCP_DNS_RULE_DYNAMIC`，该路径已真机证实生效）。
   *
   * 【为什么用 Dynamic 而不是 Static】
   *   `Rcp_StaticDnsRule` 是**指针链**（rule→item→ipAddresses→next），在栈上构链要保证
   *   每个节点的生命周期覆盖整个请求、且 `vector` 扩容会让先前取的指针失效——
   *   而 Dynamic 只需一个函数指针，表放在**栈上对象**里由回调读取，生命周期天然正确。
   *   两者同在一条 `Rcp_DnsRule` 联合体上，语义等价；Dynamic 已被 #1169 真机证实。
   *
   * 【★只影响表内域名】回调返回 `nullptr` ⇒ RCP 回落系统 DNS（**不改变无关请求的行为**）。
   *   这是"表里没有该域名"的正确语义；而"表里有但 IP 全非法"⇒ 由我们显式判失败（不静默回退）。
   */
  Rcp_DnsRule dnsRule{};
  HttpDnsTableGuard dnsGuard;   // ★#1169：任何出口都清空表指针（防悬垂）
  CallDnsSourceGuard srcGuard;  // ★#1183：任何出口都清空 per-request 解析来源（防跨请求串味）
  /**
   * ★★★#1202：DoH 读数必须按**本次请求**重算——`installed` 的语义是"这一请求真的挂上了
   *   `dnsConfiguration.dnsOverHttps`"。若沿用上一次的 true，回执会拿旧值冒充新值。
   */
  dohProbe().installed = false;
  if (f.httpDns.has && !f.httpDns.v.empty()) {   // ★`Opt<T>` 用 `.has` / `.v`（不是指针）
    // 表放到栈上（lifecycle = 本次 handle），回调通过全局指针读取
    httpDnsTable() = &f.httpDns.v;
    dnsRule.type = RCP_DNS_RULE_DYNAMIC;
    dnsRule.data.dynamicDnsRule = &detail::tableDnsLookup;
    cfg.dnsConfiguration.dnsRules = &dnsRule;
    DnsProbe& dp = dnsProbe();
    dp.tableRules = static_cast<int>(f.httpDns.v.size());
  } else if (dnsProbe().installed) {
    dnsRule.type = RCP_DNS_RULE_DYNAMIC;
    dnsRule.data.dynamicDnsRule = &detail::probeDnsLookup;
    cfg.dnsConfiguration.dnsRules = &dnsRule;
  } else if (dohProbe().enabled && !dohProbe().url.empty()) {
    /**
     * ★★★#1202：**DoH 落点探针**（与上面两支互斥——同属 `dnsConfiguration`，后设覆盖先设）。
     * `Rcp_DnsOverHttps` 是**结构体值**（不是指针）⇒ 直接赋进 cfg 即可；
     * `url` 指向 `dohProbe().url` 的**进程级静态** `c_str()`，生命周期覆盖整个请求
     * （不能指向 napi 栈上的临时串——那正是本仓记过的悬垂形态）。
     * ★头文件原文 "the address resolved by the DOH dns server is **preferred**"：
     *   是否"无答案即静默回落系统 DNS"必须实测，见 `hosts/harmony/run-doh-probe.sh` 的 T3。
     */
    Rcp_DnsOverHttps doh{};
    doh.url = dohProbe().url.c_str();
    doh.skipCertificatesValidation = dohProbe().skipCertificatesValidation;
    cfg.dnsConfiguration.dnsOverHttps = doh;
    dohProbe().installed = true;
  }
  req->configuration = &cfg;

  // ③ 逐块闸：越线即中止（#1117）
  detail::RecvGate gate;
  gate.limit = MAX_BODY_BYTES;
  /**
   * ★★★#1187：**`savePath` ⇒ 逐块落盘**。★#1192 更正：本层不累积 body，但 RCP 侧是否整包驻留
   *   **未取证**（`Rcp_Response.body` + 无关闭驻留开关）⇒ 不宣称"峰值 = 单块"。
   *   ★非法路径必须**如实报错**（不得回落到"写到别处"或静默忽略）。
   *   ★实现已抽到 `proteus_http_save.h`（本文件 1000 行上限）。
   */
  SaveSession save;
  if (f.savePath.has && !f.savePath.v.empty()) {
    std::string err;
    if (!save.open(f.savePath.v, &err)) {
      stats().failures++;
      return proteus::wire::ResolveFrame::err(f.reqId, err);
    }
    gate.save = &save;
    gate.limit = 0;   // 落盘不受内存上限约束（磁盘配额由 SaveSession::limit 守）
  }
  bool gateInstalled = false;
  if (api.setOnBinaryRecv != nullptr) {
    gate.session = session;
    gate.req = req;
    gate.cancelFn = api.cancelRequest;
    /* ★★★#1344 B-3：流式模式 ⇒ 装回推目标（与 save 互斥：savePath 优先落盘，见下）。
       ★`streamReqId` 指向 `f.reqId`（`handle()` 的入参，活到请求结束）⇒ 无悬垂。 */
    const bool wantStream = f.stream && *f.stream;
    if (wantStream && save.fp == nullptr && g_proteusHttpStream != nullptr) {
      gate.streamReqId = &f.reqId;
    }
    Rcp_OnBinaryReceiveCallback ocb{};
    ocb.callback = &detail::recvGate;
    ocb.usrObject = &gate;
    gateInstalled = (api.setOnBinaryRecv(req, ocb) == 0);
    if (!gateInstalled) {
      fprintf(stderr, "[proteus-http] 逐块接收回调注册失败 ⇒ 退化为事后拒绝\n");
    }
  }

  // ④ 发请求（★★★#1156：**异步 Fetch + 有界等待真实完成信号**，理由见 `RcpApi::fetchAsync` 注释）
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
    const uint32_t fetchRc = api.fetchAsync(session, req, &robj);
    if (fetchRc != 0) {
      // 受理失败：请求没发出去 ⇒ 直接按错误码返回（与同步路径的 reasonOf 口径一致）
      errCode = fetchRc;
      stats().failures++;
      if (headers != nullptr && api.destroyHeaders != nullptr) api.destroyHeaders(headers);
      unregisterInflight(f.reqId);   // ★B-2c
      api.destroyRequest(req);
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
        if (api.cancelRequest != nullptr) api.cancelRequest(session, req);
        if (headers != nullptr && api.destroyHeaders != nullptr) api.destroyHeaders(headers);
        unregisterInflight(f.reqId);   // ★B-2c
        api.destroyRequest(req);
        return proteus::wire::ResolveFrame::err(f.reqId, "http.timeout: 宿主未在预算内收到响应回调");
      }
      errCode = w.err;
      resp = w.resp;
    }
  } else {
    // 老版本库兜底（会退化到零复用——如实记账，不静默）
    stats().syncFallback++;
    resp = api.fetchSync(session, req, &errCode);
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
    // ★#1191（J4/J5）：落盘模式的可核对读数（kept==0 是恒真式，不能当证据）
    d.saveMode = (gate.save != nullptr);
    d.saveLimit = (gate.save != nullptr) ? static_cast<unsigned long long>(gate.save->limit) : 0ULL;
    // ★#1193（B4）：请求后的峰值 RSS（差值就是"这次落盘把内存顶了多少"）
    d.vmHwmBeforeKb = vmHwmBefore;
  }

  proteus::wire::ResolveFrame out;
  if (gate.exceeded) {
    // ★超限优先：cancel 会把 errCode 变成"Request is canceled"(1007900992)，
    //   若按 errCode 分支就会把"超限"误报成"网络取消"。
    stats().failures++;
    stats().tooLarge++;
    /**
     * ★★★#1191（独立验证 B2）：**落盘模式的上限是 1 GiB，不是 32 MiB**。
     *   原实现所有越线都回 `tooLargeReason(gate.seen)`（"超过 32 MiB"）⇒ 下 1.1 GiB 文件会得到
     *   自相矛盾的错误。⇒ 落盘模式改由 `SaveSession::finish` 给它的真实原因（含实际上限）。
     *   ★顺带解决 B1：`finish` 会走 `abortUnfinished` 删临时文件。
     */
    std::string tooLargeMsg = tooLargeReason(gate.seen);
    if (gate.save != nullptr) {
      bool saveOk = false;
      std::string saveErr;
      gate.save->finish(&saveOk, &saveErr);
      if (!saveErr.empty()) tooLargeMsg = saveErr;
    }
    out = proteus::wire::ResolveFrame::err(f.reqId, tooLargeMsg);
    if (resp != nullptr && resp->destroyResponse != nullptr) resp->destroyResponse(resp);
    resp = nullptr;
  } else if (errCode != 0 || resp == nullptr) {
    stats().failures++;
    out = proteus::wire::ResolveFrame::err(f.reqId, reasonOf(errCode));
  } else {
    out = proteus::wire::ResolveFrame::okOf(f.reqId);
    out.status = static_cast<uint32_t>(resp->statusCode);
    // ★★★#1204：响应装配（响应头 / 传输读数 / 响应体三条路径）已搬到
    //   `proteus_http_response.h`——`handle()` 曾 480 行占文件 51%（#1201 遗留）。
    //   ★只搬了这一段：请求装配与 DNS 配置引用的 `content`/`dnsRule`/`doh`/`cfg`
    //     都是**栈上对象且彼此取地址**，搬出函数即悬垂 ⇒ 故意留在原处。
    ResponseStats rs;
    int lastStatus = 0;
    proteus::wire::NameValues transportForProbe;
    const RespDisposition disp = assembleSuccessResponse(
        api, f, resp, &out, gate, gateInstalled, MAX_BODY_BYTES, &tooLargeReason,
        &lastStatus, proteus::http::callDnsSource(), &transportForProbe, &rs);
    // ★#1186：留一份给取证探针（必须在装配函数把 tp move 出去**之后**用副本写，
    //   所以装配函数用出参把副本交回来，而不是自己写 `lastTransport()`）。
    if (!transportForProbe.empty()) proteus::http::lastTransport() = transportForProbe;
    stats().lastStatus = lastStatus;
    if (rs.saveFailed) {
      stats().failures++;
      if (rs.saveExceeded) stats().tooLarge++;
    }
    if (rs.tooLargeFallback) {
      stats().failures++;
      stats().tooLarge++;
      stats().tooLargeFallback++;
    }
    if (disp == RespDisposition::Consumed) resp = nullptr;
    if (out.ok) {
      stats().ok++;
      if (resp != nullptr && resp->destroyResponse != nullptr) resp->destroyResponse(resp);
    }
  }

  // ④ 释放（★#1156：只释放**单次请求**的资源；session 留给后续请求复用——
  //   关掉它就等于把连接池一起丢掉，连接复用会立刻归零（真机实测 3 请求/3 TCP 就是这个原因））
  if (headers != nullptr && api.destroyHeaders != nullptr) api.destroyHeaders(headers);
  unregisterInflight(f.reqId);   // ★B-2c：注销在途登记（防表泄漏）
  api.destroyRequest(req);
  /**
   * ★★★#1194（独立验证第三轮 R3 修复）：**读数必须在 finish() 之后取**。
   *   原实现把 `saveWritten` / `vmHwmAfterKb` 在 `finish()` **之前**快照；
   *   而"闸未安装 / chunks==0"时有一支 `resp->body` 回填（`gate.save->write(...)`）
   *   发生在快照**之后** ⇒ 那批字节会**漏计** ⇒ `saveWritten == seen` 判据红成"实现坏了"，
   *   而真因只是读数取早了（本仓最怕的"装置让人误诊"）。
   *   ★验证者更正了我先前的判断：这不是"minSdk 17 下不可达"——注册回调失败
   *   （逐块回调注册返回非 0）是**运行时降级路径**，代码本身就实现了它。
   */
  {
    LastLimitDiag& d = lastLimitDiag();
    d.saveWritten = (gate.save != nullptr) ? static_cast<unsigned long long>(gate.save->written) : 0ULL;
    d.vmHwmAfterKb = readVmHwmKb();
  }
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

/**
 * ★★★B-2c：**对在途请求发真取消**（薄封装 + 记账）。
 *   RCP 类型相关的实现在 `proteus_http_rcpapi.h` 的 `cancelRcpRequestRaw`（那层才看得见 RCP 类型）；
 *   本函数只负责**记账**（`http.cancelStats` 读它 —— 判据的唯一直接证据）。
 */
inline bool cancelRcpRequest(void* session, void* req) {
  uint32_t rc = 0;
  if (!cancelRcpRequestRaw(session, req, &rc)) {
    // ★诊断：符号缺失 ⇒ 单独记账（否则与"帧没到"在 cancelCalls 上不可区分）——见 Stats 注释
    stats().cancelUnsupported++;
    return false;
  }
  stats().cancelCalls++;
  if (rc == 0) stats().cancelHits++;
  else stats().cancelMisses++;
  return true;
}

}  // namespace http
}  // namespace proteus

#endif  // PROTEUS_HTTP_H
