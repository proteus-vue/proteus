// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_transport.h
// ★★★#1191：**鸿蒙传输读数装配**（从 `proteus_http.h` 抽出——那里已越 1000 行上限）。
//
// 【职责边界】只做一件事：把 `Rcp_TimeInfo` 转成线格式 name-values（+ 补 DNS 来源）。
//   请求流程归 `proteus_http.h`，落盘归 `proteus_http_save.h`，三个 http.* 归 `proteus_http_stubs.h`。
//
// 【★单位坑（真机交叉验证得出的结论，勿改回毫秒）】
//   `Rcp_TimeInfo` 各字段实际是**微秒**，而 SDK 头注释写的是 "The time in milliseconds"。
//   证据：真机首跑把值当毫秒 ⇒ `ttfbMs=26785`、`connectMs=12542`，而同轮**探针墙钟**是
//   `39ms`/`16ms`/`9ms` ⇒ 若真是毫秒，TTFB 比整轮耗时还长 26 倍（不可能）。
//   按 µs 换算后 `26.8ms`（占墙钟 69%）/ `7.3ms` / `6.7ms` —— 三次都自洽。
//   ★这类"文档说 A、实际是 B"只能靠**跟独立读数对账**发现。
#pragma once
#include <cmath>
#include <cstdio>
#include <string>

#include "invoke_wire.h"

namespace proteus {
namespace http {

/**
 * 把 `Rcp_TimeInfo` 的四个累计时间转成**区间**读数（写进 `out`）。
 *
 * 【为什么必须做减法】`timeInfo` 给的是从请求开始算的**累计毫秒/微秒**：
 *   dnsMs = nameLookUpTime
 *   connectMs = connectTime − nameLookUpTime     （TCP 建连本身）
 *   tlsMs     = tlsHandshakeTime − connectTime   （握手本身）
 *   ttfbMs    = startTransferTime
 * ★不做减法 ⇒ `connectMs` 里含 DNS、`tlsMs` 里含 DNS+TCP——与 iOS 的区间语义**不一致**，
 *   三端读数就没法横向比（本仓"三端同判据"的前提）。
 */
template <typename TimeInfo>
inline void appendTimeReadouts(proteus::wire::NameValues* out, const TimeInfo* ti) {
  if (out == nullptr || ti == nullptr) return;
  constexpr double US_PER_MS = 1000.0;
  auto putMs = [out](const char* k, double vUs) {
    const double v = vUs / US_PER_MS;
    if (!(vUs > 0.0) || vUs != vUs) return;   // 0 / NaN / 负数 ⇒ 不写（0 = 该阶段没发生）
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%.1f", v);
    out->emplace_back(k, buf);
  };
  putMs("dnsMs", ti->nameLookUpTime);
  putMs("connectMs", ti->connectTime - ti->nameLookUpTime);
  /**
   * `tlsMs`：`tlsHandshakeTime <= 0` ⇒ **不写**。
   * 【为什么】明文 HTTP 上它恒 0 ⇒ `0 - connectTime` 会算出负数（被 putMs 挡掉），
   *   但**复用连接**时两者都是 0 ⇒ 减出来是 0，会被写成 `tlsMs:"0.0"`。
   *   而"没有握手"与"握手耗时 0ms"是两件事——后者会让业务以为"TLS 很快"，实际是**没走 TLS**。
   */
  if (ti->tlsHandshakeTime > 0.0) putMs("tlsMs", ti->tlsHandshakeTime - ti->connectTime);
  putMs("ttfbMs", ti->startTransferTime);
}

/**
 * 追加 DNS 来源（`dnsSource` / `dnsTableHit`）。
 *
 * @param internalSource 宿主内部值：`table` / `miss` / 空
 *
 * ★★★#1191（独立验证 B7）：**内部 `miss` 必须映射成公开契约的 `system`**。
 *   内部用 `miss` 表示"表未命中"（比 `system` 更精确），但消费端
 *   `parseTransportReadout` 的白名单只认 `table|system|literal|resolver`
 *   ⇒ 直接发 `miss` 会被**静默丢弃**（实测：只剩 `dnsTableHit:false`），
 *   而 Android 同一场景写 `system` ⇒ 三端契约不一致。
 * ★空 = 本次没发生解析（URL 是 IP / 连接复用）⇒ **不写**，绝不填默认值冒充。
 */
inline void appendDnsSource(proteus::wire::NameValues* out, std::string internalSource) {
  if (out == nullptr) return;
  if (internalSource == "miss") internalSource = "system";
  if (internalSource.empty()) return;
  out->emplace_back("dnsSource", internalSource);
  out->emplace_back("dnsTableHit", internalSource == "table" ? "1" : "0");
}

}  // namespace http
}  // namespace proteus
