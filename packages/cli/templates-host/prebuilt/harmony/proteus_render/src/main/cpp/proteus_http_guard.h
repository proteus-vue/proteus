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
#include <string>

#include "invoke_wire.h"

namespace proteus {
namespace http {

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
   * ① `stream: true` —— 一次性 VM + 同步 napi ⇒ 无回推接收方。
   *   （#1187 起如实拒绝；此处保留原文案，判据 `fetch.unsupported` + 根因关键词守着）
   */
  if (f.stream && *f.stream) {
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
   * ③ `upload`（multipart 流式上传）—— 鸿蒙**未实现**。
   *   ★此前同样是**静默忽略**：帧里带了 `upload`，但宿主只发 `f.body`（通常为空）
   *     ⇒ 服务端收到一个**没有文件的请求**，业务以为上传成功了（比报错更糟：
   *     可能写入一条空记录）。
   *   ★RCP 有 multipart 结构体（`Rcp_MultipartFormFieldValue` / `Rcp_FormFieldFileValue`），
   *     但完整实现要构表单树 + 沙箱读文件 + 分段回调，属**独立工作量**
   *     ⇒ 本单先如实拒绝，把"静默发空请求"这个坑堵上；实现另立单。
   */
  if (f.upload.has && !f.upload.path.empty()) {
    return "fetch.unsupported: 鸿蒙宿主暂不支持 multipart 上传（upload）。"
           "为避免『静默发出不带文件的请求』（服务端可能写入空记录），本请求已被拒绝、未发出任何流量。"
           "请改用整包 body 上传，或改用已支持的端（Android/iOS）";
  }
  return std::string();
}

}  // namespace http
}  // namespace proteus
