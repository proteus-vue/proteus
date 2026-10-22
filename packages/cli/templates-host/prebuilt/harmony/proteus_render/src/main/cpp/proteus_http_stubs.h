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
 * @return true = 已处理（结果在 `out`）；false = 不是这三个方法，交回调用方继续分派
 */
inline bool httpStubDispatch(const std::string& method, std::string* out) {
  if (method == "http.cancel") {
    *out =
        "{\"ok\":false,\"reason\":\"harmony-sync-napi\","
        "\"note\":\"鸿蒙请求在同步 napi 内跑完，abort() 是 no-op（连 JS 侧 reject 都不会发生）；"
        "请用 timeout 限时\"}";
    return true;
  }
  if (method == "http.cancelStats") {
    *out =
        "{\"ok\":true,\"data\":{\"calls\":0,\"hits\":0,\"misses\":0},"
        "\"reason\":\"harmony-sync-napi\",\"note\":\"鸿蒙无在途请求表（同步模型）⇒ 取消统计恒 0\"}";
    return true;
  }
  if (method == "http.tlsStats") {
    *out =
        "{\"ok\":true,\"data\":{\"challenges\":0,\"withPins\":0,\"accepted\":0,\"rejected\":0,"
        "\"defaultHandled\":0},"
        "\"note\":\"鸿蒙未接 SPKI pinning 回调（RCP 只提供 CA 配置，不做 fingerprint 校验）"
        "⇒ 本端 pin 不生效，请勿据此判断安全策略已成立\"}";
    return true;
  }
  return false;
}

}  // namespace http
}  // namespace proteus
