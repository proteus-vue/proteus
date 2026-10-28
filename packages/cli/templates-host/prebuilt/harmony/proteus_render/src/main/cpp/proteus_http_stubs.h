// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_stubs.h
// ★★★#1187：鸿蒙 **`http.cancel` / `http.cancelStats` / `http.tlsStats` 的诚实分派**
//   （从 `host_app_runtime_impl.h` 抽出——那个文件在 `check:file-size` 的存量棘轮上）。
//
// 【为什么必须有这三个方法】#1163 起它们**查无分派** ⇒ 字节桥回 `missing` 帧 ⇒
//   `host_stats` 恒为 null、传输探针的归因链断（#1165 已如实登记为缺口）。
//
// 【★为什么不能照抄 Android 的语义】鸿蒙 `handle()` 是**同步阻塞**（一次性 VM + 同步 napi）：
//   请求进行中 JS 线程被占 ⇒ `signal.onabort` **根本没有执行机会** ⇒ `abort()` 是 **no-op**
//   （连 JS 侧的 reject 都不会发生，请求照常跑完返回成功）。
//   ⇒ 这里回的是**结构完整但如实**的读数：方法存在（不再是 missing），但**绝不报"取消成功"**。
//
// 【诚实边界（勿改文案，判据守着）】
//   · `http.cancel`：`{ok:false, reason:'harmony-sync-napi'}` —— 调用方能看到
//     "这条路在本端不成立、请用 timeout"，而不是"取消完成"。
//   · `http.tlsStats`：全 0 + note "鸿蒙未接 SPKI pinning 回调" ——
//     RCP 只提供 CA 配置（`Rcp_CertificateAuthority`），**不做 fingerprint 校验**
//     ⇒ 别让业务以为 pin 生效了（安全策略假成立比没有更危险）。
#pragma once
#include <string>

namespace proteus {
namespace http {

/** 三个 http.* 方法的分派结果（避免返回 `std::string` 的额外拷贝语义歧义） */
inline std::string httpStubResult;

/**
 * ★★★#1344 B-2c：**会话模式的真取消钩子**。
 *   `g_sessionCancel(reqId)` ⇒ 查在途表 → `HMS_Rcp_CancelRequest`。
 *   ★一次性 VM（生产路径）下为 nullptr ⇒ 仍如实回"同步模型 no-op"（**与改造前逐字节等价**）。
 */
typedef std::string (*ProteusSessionCancelFn)(const std::string& reqId);
static ProteusSessionCancelFn g_sessionCancel = nullptr;
static inline void setSessionCancelHandler(ProteusSessionCancelFn fn) { g_sessionCancel = fn; }

/** 从 argsJson 里取 `reqId`（`{"reqId":"..."}`；取不到返回空） */
inline std::string stubReqId(const std::string& argsJson) {
  const char* key = "\"reqId\"";
  const size_t at = argsJson.find(key);
  if (at == std::string::npos) return std::string();
  const size_t colon = argsJson.find(':', at + 7);
  if (colon == std::string::npos) return std::string();
  const size_t q1 = argsJson.find('"', colon + 1);
  if (q1 == std::string::npos) return std::string();
  const size_t q2 = argsJson.find('"', q1 + 1);
  if (q2 == std::string::npos || q2 <= q1) return std::string();
  return argsJson.substr(q1 + 1, q2 - q1 - 1);
}

/**
 * @param argsJson 能力参数（`http.cancel` 用它取 `reqId`；其余方法可忽略）
 * @return true = 已处理（结果在 `out`）；false = 不是这三个方法，交回调用方继续分派
 */
inline bool httpStubDispatch(const std::string& method, const std::string& argsJson, std::string* out) {
  if (method == "http.cancel") {
    /* ★★★#1344 B-2c：会话模式 ⇒ **真取消**（查在途表 → HMS_Rcp_CancelRequest）。 */
    if (g_sessionCancel != nullptr) {
      *out = g_sessionCancel(stubReqId(argsJson));
      return true;
    }
    *out =
        "{\"ok\":false,\"reason\":\"harmony-sync-napi\","
        "\"note\":\"鸿蒙请求在同步 napi 内跑完，abort() 是 no-op（连 JS 侧 reject 都不会发生）；"
        "请用 timeout 限时\"}";
    return true;
  }
  if (method == "http.cancelStats") {
    /**
     * ★★★#1191（独立验证 B6）：**限制必须放进 `data`**。
     *   桥的结算处是 `p.resolve(parsed?.data ?? parsed)` ⇒ 有 `data` 时 `reason`/`note`
     *   **整段被丢掉**。原来把限制写在顶层 ⇒ 业务只拿到 `{calls:0,hits:0,misses:0}`，
     *   无法区分"没发生取消"与"本端取消不可用"（后者正是事实）。
     *   ⇒ 限制字段一律塞进 `data`。
     *
     * ★★★#1344 B-2c：**会话模式下改为真实读数**（`stats().cancelCalls/Hits/Misses`）。
     *   ★这条读数是"宿主真的调了 HMS_Rcp_CancelRequest"的**唯一直接证据** ——
     *     JS 侧的 `settle_ms_after_abort` 只证明"本地 Promise 立刻 reject 了"，
     *     它**不能**证明传输真的停了（实测：把 RCP 调用摘掉，JS 侧读数一模一样）。
     *     ⇒ 判据必须读这里（破坏性验证 M7 就是靠它抓住的）。
     */
    if (g_sessionCancel != nullptr) {
      const proteus::http::Stats& st = proteus::http::stats();
      *out = "{\"ok\":true,\"data\":{\"calls\":" + std::to_string(st.cancelCalls) +
             ",\"hits\":" + std::to_string(st.cancelHits) +
             ",\"misses\":" + std::to_string(st.cancelMisses) +
             ",\"supported\":true,"
             "\"note\":\"会话模式：calls = 调到 HMS_Rcp_CancelRequest 的次数（>0 证明宿主真取消）\"}}";
      return true;
    }
    *out =
        "{\"ok\":true,\"data\":{\"calls\":0,\"hits\":0,\"misses\":0,"
        "\"supported\":false,\"reason\":\"harmony-sync-napi\","
        "\"note\":\"鸿蒙无在途请求表（同步模型）⇒ 取消统计恒 0，abort() 是 no-op；要限时请用 timeout\"}}";
    return true;
  }
  if (method == "http.tlsStats") {
    /**
     * ★B6：同上（限制塞进 `data`）。安全语义尤其不能丢：
     *   业务看到 `challenges:0` 会以为"没配 pin"，实际是"本端 pin 根本不生效"。
     */
    *out =
        "{\"ok\":true,\"data\":{\"challenges\":0,\"withPins\":0,\"accepted\":0,\"rejected\":0,"
        "\"defaultHandled\":0,\"pinning\":\"unsupported\","
        "\"note\":\"鸿蒙未接 SPKI pinning（RCP 只提供 CA 配置，不做 fingerprint 校验）"
        "⇒ 本端 pin 不生效，请勿据此判断安全策略已成立\"}}";
    return true;
  }
  return false;
}

}  // namespace http
}  // namespace proteus
