// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_guard.h
// ★★★#1203：鸿蒙宿主的**「能力不支持」前置拒绝**（从 `proteus_http.h` 的 `handle()` 分出）。
//
// 【为什么要有这一层：静默失效比缺能力更危险】
//   本仓反复记的同一条纪律——"帧里解出来了但宿主不用"是最坏的形态：
//   业务以为某能力生效了，实际一次都没执行。鸿蒙这两条都踩过：
//     · `stream: true` 曾是**静默忽略**（#1187 修为如实拒绝）；
//     · `tlsPins`/`tlsPinOnly` 至今仍是**静默忽略**（#1203 本单修）——
//       业务配了 pin、以为多了防 MITM 一道防线，而请求**不带任何校验照常发出**。
//       ★这一条比 stream 更严重：它让**安全策略假成立**。
//
// 【为什么 pin 在鸿蒙做不了（不是漏写，是平台边界）】
//   取证 `rcp.h` 的 `Rcp_SecurityConfiguration` 只有三样东西：
//     · `remoteValidationType`（SYSTEM / SKIP）；
//     · `certificateAuthority`（PEM 内容/文件/目录 —— **信任锚**）；
//     · `certificate` / `serverAuthentication`（客户端证书 / 服务端认证）。
//   ⇒ **没有任何"拿到对端证书后由我决定接受与否"的回调**（Android 有 `X509TrustManager`、
//     iOS 有 `URLSession` 的 challenge），因此无法实现 SPKI 指纹比对。
//   ★注意：`skipCertificatesValidation` 是**更松**的开关（跳过校验），与 pinning 语义相反，
//     不能拿来凑数——那会把"更严"变成"完全不校验"。
//
// 【拒绝口径】
//   `fetch.unsupported`（不是 `fetch.tlsError`）——后者会让业务以为"pin 配错了/证书不对"
//   而去查证书，方向就错了；`fetch.unsupported` 明确表达"本端没有这个能力"。
//   ★必须在**发请求之前**拒绝（不发出任何未受 pin 保护的流量）。
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>

#include "invoke_wire.h"

namespace proteus {
namespace http {

/**
 * ★★★#1344 B-3：**流式块回推钩子**（会话式 VM 专用；本头是它的声明落点）。
 *
 * 【为什么放在 guard 里而不是 `proteus_http.h`】本头的 `unsupportedFeatureReason()` 必须知道
 *   "本端现在**有没有**回推接收方"才能决定 stream 是拒绝还是放行。而 `proteus_http.h` 在本头
 *   **之后**才定义各钩子 ⇒ 若把声明写在那儿，这里就看不见（同一份代码里"先后顺序决定可见性"
 *   正是 #1344 B-2c 那个缺陷的形态）。⇒ 钩子与它的可用性判据同置一处。
 *
 * 【线程纪律】实现会被**网络线程**（RCP 的逐块回调）调用 ⇒ 只能入队，**绝不能碰 JSVM**。
 *
 * @param reqId 去程 reqId（JS 侧按它找回 pending 条目 + `lastStreamSeq`）
 * @param seq   块序号（**从 0 起连续**；JS 侧跳号即判丢帧，不静默拼接）
 * @param data  块字节（调用后即失效，实现必须自己拷走）
 * @param len   块长度
 * @return 已处理字节数（`recvGate` 契约：一律回 `len`）
 */
typedef size_t (*ProteusHttpStreamFn)(const std::string& reqId, uint32_t seq, const uint8_t* data, size_t len);
static ProteusHttpStreamFn g_proteusHttpStream = nullptr;
static inline void setHttpStreamHandler(ProteusHttpStreamFn fn) { g_proteusHttpStream = fn; }

/** 流式回推是否可用（`unsupportedFeatureReason` 据此决定 stream 该拒绝还是该放行）。 */
static inline bool httpStreamAvailable() { return g_proteusHttpStream != nullptr; }

/**
 * 检查帧里要求了本端**结构上不支持**的能力，若命中则给出拒绝原因（空串 = 通过）。
 *
 * @param f 去程帧
 * @return 拒绝原因；空 = 没有任何不支持的能力被要求
 *
 * ★新增这类检查时把判据加进 `tests/harmony-http-gaps.test.ts`——
 *   "帧里有字段但宿主不用"这类缺陷只有在字段与消费点之间建立可检查的联系才能防复发。
 */
inline std::string unsupportedFeatureReason(const proteus::wire::InvokeFrame& f) {
  /**
   * ① `stream: true` —— ★★★#1344 B-3：**会话式 VM 下已实现**（逐块回推，见
   *   `proteus_http.h` 的 `recvGate` 流式分支 + 会话钩子 `setHttpStreamHandler`）。
   *   · **一次性 VM（生产路径）**：`httpStreamAvailable()` 为 false（没有回推接收方）
   *     ⇒ **仍如实拒绝**，不静默降级成"看起来在流式"（那会让业务以为 `onChunk` 会跑）。
   *   · **会话模式**：钩子已注册 ⇒ 放行，语义与 Android/iOS 对齐。
   *   ★判据双口径：`tests/harmony-http-gaps.test.ts` 守着"无钩子时必须拒绝"这一条。
   */
  if (f.stream && *f.stream && !httpStreamAvailable()) {
    return "fetch.unsupported: 鸿蒙宿主暂不支持 stream（一次性 VM + 同步 napi ⇒ 无法逐块回推）。"
           "请改用 savePath（宿主逐块落盘）或默认整包";
  }
  /**
   * ② `tlsPins` / `tlsPinOnly` —— RCP 无证书校验回调（见文件头取证）。
   *   ★**不静默放行**：配了 pin 却照常发出 = 安全策略假成立。
   *   ★`tlsPinOnly` 单独出现也要拒：它同样表达了"信任判定由 pin 决定"的意图。
   */
  const bool hasPins = f.tlsPins.has && !f.tlsPins.v.empty();
  const bool pinOnly = f.tlsPinOnly.has && f.tlsPinOnly.v;
  if (hasPins || pinOnly) {
    return "fetch.unsupported: 鸿蒙宿主不支持 TLS 证书 pinning（RCP 只提供 CA 配置，"
           "无指纹校验回调 ⇒ SPKI pin 在本端无法生效）。"
           "为避免『配了 pin 但实际不校验』的假安全，本请求已被拒绝、未发出任何流量。"
           "请改用系统信任链，或改用能校验 pin 的端（Android/iOS）";
  }
  /**
   * ③ `upload`（multipart 流式上传）—— ★★★#1205 起**已实现**（见 `proteus_http_upload.h`）。
   *
   * ★历史：此前这里是"如实拒绝"分支（#1203），因为帧里带了 `upload` 但宿主只发 `f.body`
   *   （通常为空）⇒ 服务端收到**没有文件的请求**、业务以为上传成功（可能写入空记录）。
   *   现在已用 RCP 的 multipart API（`contentOrPathOrCb` 走 `RCP_FILE_VALUE_TYPE_PATH`，
   *   由平台流式读文件）实现 ⇒ **本条不再拒绝**。
   * ★若平台库缺 multipart 符号（旧设备）⇒ 由 `buildMultipartUpload` 回 `http.unsupported`
   *   （仍在**发请求之前**失败，不会静默发空体）。
   */
  return std::string();
}

}  // namespace http
}  // namespace proteus
