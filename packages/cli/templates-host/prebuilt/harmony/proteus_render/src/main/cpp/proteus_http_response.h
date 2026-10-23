// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_response.h
// ★★★#1204：**成功响应的装配**（从 `proteus_http.h` 的 `handle()` 分出）。
//
// 【为什么只抽这一段（其余没抽的理由同样是纪律）】
//   `handle()` 里另两大块（请求装配 / DNS 配置）**故意没抽**：它们引用的
//   `content` / `dnsRule` / `doh` / `cfg` 都是**栈上对象、彼此取地址**，
//   一搬出函数就会变成"返回栈变量的引用/指针"这类悬垂（本仓记过的形态）。
//   ⇒ 只抽**不持有这些指针**的部分：成功响应的装配（只依赖 resp + gate + out + 记账）。
//
// 【★行为必须逐字等价（与 #870 拆 capability.ts 同纪律）】
//   ① 响应头：同名多值用 `", "` 连接（与 Android `collectHeaders` 同口径）；
//      `getHeaderEntries` 拿到的链表用完必须 `destroyHeaderEntries`（否则泄漏）；
//   ② 传输读数：先给探针留一份（`lastTransport() = tp`）再 `std::move` 进回程帧
//      ——**顺序不能反**（move 之后 tp 已空）；
//   ③ 响应体三条路径的**优先级**：落盘摘要 > 逐块闸累计 > 整包（含事后超限拒绝）。
//      落盘前要补齐"闸未装时"的 `resp->body`；超限必须销毁 resp（否则泄漏）。
//   ④ `stats()` 记账口径不变：`failures/tooLarge/tooLargeFallback/ok` 各自打点位置照搬。
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>

#include "invoke_wire.h"
#include "proteus_http_transport.h"   // appendTimeReadouts / appendDnsSource

#if defined(__has_include)
#if __has_include(<RemoteCommunicationKit/rcp.h>)
#include <RemoteCommunicationKit/rcp.h>
#define PROTEUS_RESP_HAVE_H 1
#endif
#endif
#ifndef PROTEUS_RESP_HAVE_H
#define PROTEUS_RESP_HAVE_H 0
#endif

#if PROTEUS_RESP_HAVE_H

namespace proteus {
namespace http {

/** 「本次响应是否还要被销毁」——用返回值表达，避免调用方误用 move 后的对象。 */
enum class RespDisposition {
  Keep,      // 调用方负责 destroy（成功路径）
  Consumed,  // 本函数已销毁（超限路径）
};

/**
 * 把一次**成功**响应装配进 `out`。
 *
 * @param api          RCP 符号表（只用到 `getHeaderEntries` / `destroyHeaderEntries`）
 * @param f            去程帧（取 `reqId`）
 * @param resp         RCP 响应（非 null；调用方保证 `resp->statusCode` 可读）
 * @param out          回程帧（进来时已 `okOf(reqId)`）
 * @param gate         逐块闸（`save` 非 null ⇒ 落盘模式）
 * @param gateInstalled 逐块回调是否注册成功（false ⇒ 只能事后判）
 * @param maxBodyBytes 整包上限
 * @param tooLargeReason 超限文案生成器
 * @param lastStatusOut 出参：真实状态码（调用方记 `stats().lastStatus`）
 * @param dnsSource    本次请求的解析来源（`table`/`miss`/空）——**由调用方传入**，
 *                     这样本头不必反向依赖 `callDnsSource()`（访问器住在宿主主体里，include 会成环）
 * @param transportOut 出参：装配好的传输读数（调用方负责留一份给探针）
 * @return 调用方是否需要 destroy `resp`
 *
 * ★`stats()` 的记账由调用方做（本头不反向依赖宿主主体，避免 include 环）：
 *   本函数通过 `SaveOutcome` 告诉调用方"落盘是否失败 / 是否超限"，由调用方打点。
 */
struct ResponseStats {
  bool saveFailed = false;      // 落盘失败（failures++，且 exceeded ⇒ tooLarge++）
  bool saveExceeded = false;
  bool tooLargeFallback = false; // 整包路径超限（tooLargeFallback++ + tooLarge++）
};

template <typename ApiT, typename GateT>
inline RespDisposition assembleSuccessResponse(const ApiT& api,
                                              const proteus::wire::InvokeFrame& f,
                                              Rcp_Response* resp,
                                              proteus::wire::ResolveFrame* out,
                                              GateT& gate,   // ★非 const：要 move 出 body
                                              bool gateInstalled,
                                              size_t maxBodyBytes,
                                              std::string (*tooLargeReason)(size_t),
                                              int* lastStatusOut,
                                              const std::string& dnsSource,
                                              proteus::wire::NameValues* transportOut,
                                              ResponseStats* rs) {
  *lastStatusOut = static_cast<int>(resp->statusCode);
  // ① 响应头（同名多值用逗号连接——与 Android `collectHeaders` 同口径）
  if (resp->headers != nullptr) {
    Rcp_HeaderEntry* entries = api.getHeaderEntries(resp->headers);
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
    if (api.destroyHeaderEntries != nullptr && entries != nullptr) api.destroyHeaderEntries(entries);
    out->headers = std::move(nv);
  }
  // ② 传输读数（量纲与减法口径见 proteus_http_transport.h）
  if (resp->timeInfo != nullptr) {
    proteus::wire::NameValues tp;
    appendTimeReadouts(&tp, resp->timeInfo);
    appendDnsSource(&tp, dnsSource);
    if (!tp.empty()) {
      if (transportOut != nullptr) *transportOut = tp;   // 调用方先留一份给探针
      out->transport = std::move(tp);                    // ★顺序不能反（move 之后 tp 已空）
    }
  }
  // ③ 响应体三条路径（优先级：落盘摘要 > 逐块闸 > 整包）
  if (gate.save != nullptr) {
    if ((!gateInstalled || gate.chunks == 0) && resp->body.buffer != nullptr && resp->body.length > 0) {
      gate.save->write(reinterpret_cast<const uint8_t*>(resp->body.buffer),
                       static_cast<size_t>(resp->body.length));
    }
    bool saveOk = false;
    std::string saveErr;
    const std::string summary = gate.save->finish(&saveOk, &saveErr);
    if (!saveOk) {
      rs->saveFailed = true;
      rs->saveExceeded = gate.save->exceeded;
      *out = proteus::wire::ResolveFrame::err(f.reqId, saveErr);
    } else {
      out->body.assign(summary.begin(), summary.end());
    }
    return RespDisposition::Keep;
  }
  if (gateInstalled && gate.chunks > 0) {
    out->body = std::move(gate.body);
    return RespDisposition::Keep;
  }
  if (resp->body.buffer != nullptr && resp->body.length > 0) {
    const size_t respLen = static_cast<size_t>(resp->body.length);
    if (respLen > maxBodyBytes) {
      rs->tooLargeFallback = true;
      *out = proteus::wire::ResolveFrame::err(f.reqId, tooLargeReason(respLen));
      if (resp->destroyResponse != nullptr) resp->destroyResponse(resp);
      return RespDisposition::Consumed;
    }
    const uint8_t* p = reinterpret_cast<const uint8_t*>(resp->body.buffer);
    out->body.assign(p, p + respLen);
  }
  return RespDisposition::Keep;
}

}  // namespace http
}  // namespace proteus

#endif  // PROTEUS_RESP_HAVE_H
