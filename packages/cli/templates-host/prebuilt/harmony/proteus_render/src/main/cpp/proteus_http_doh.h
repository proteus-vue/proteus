// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_doh.h
// ★★★#1202：**鸿蒙 DoH 落点真机取证的探针通道**（从 `proteus_http.h` 分出——那里 969 行贴 1000 上限）。
//
// 【为什么要这段】矩阵 §3（#1166）记着「`rcp.h` 有 `Rcp_DnsOverHttps`，但**只做了头文件取证**」。
//   头文件写着 "If set, the address resolved by the DOH dns server is **preferred**"——
//   `preferred` 这句话本身有两种可能语义，必须真机分辨：
//     · 强语义：DoH 给了答案就用它（含"答案不可达 ⇒ 请求失败"）；
//     · 弱语义：DoH 只是先试，失败/无答案 ⇒ **静默回落**系统 DNS。
//   ⇒ 本探针用「只 DoH 才可能给出的答案」把两者分开（见 `hosts/harmony/run-doh-probe.sh` 的四组对照）。
//
// 【★为什么走进程级状态而不是帧字段（与 #1169 `dnsProbe` 同手法）】
//   DoH 目前**不是**业务 API（`useFetch({httpDns})` 的语义是"域名→IP 表"，与 DoH 不是一回事，
//   见 `02-ios-httpdns-industry-survey.md` 结论 5）。
//   ⇒ 若为取证往线格式加 tag，就要按纪律同步**五端**（常量/编/解 × 5 + golden 向量），
//     而本单只是回答"这条路通不通"。故用探针专用状态：**线格式零改动、生产零影响**
//     （`enabled=false` 时 `handle()` 完全不碰 `cfg.dnsConfiguration.dnsOverHttps`）。
//   ★若日后决定把 DoH 做成业务能力，再单列一单走线格式五端同步。
//
// 【诚实边界】自签证书 + `skipCertificatesValidation=true` ⇒ 证明"配置路径接通"，
//   **不**证明"真实 CA 校验下同样成立"（判据里用真实公网 DoH 做一条补充 smoke，但无法归因）。
#pragma once
#include <string>

namespace proteus {
namespace http {

/**
 * `Rcp_DnsOverHttps` 的探针侧投影（不带 HMS 类型 ⇒ 无 HMS 头也能编译）。
 * ★`url` 用 `std::string` 存进程级静态：`c_str()` 必须在整个请求期间稳定，
 *   所以**不能**指向 ArkTS 传来的临时缓冲区（那是 napi 调用栈上的）。
 */
struct DohProbe {
  bool enabled = false;
  /** DoH 服务端 URL（如 `https://127.0.0.1:18443/dns-query`） */
  std::string url;
  /** 自签证书测试需要；生产语义下应为 false（本单不涉及生产） */
  bool skipCertificatesValidation = false;
  /** ★读数：本次请求是否真的把 dnsOverHttps 挂上了（探针回执用它证明"配了"） */
  bool installed = false;
};

inline DohProbe& dohProbe() {
  static DohProbe p;
  return p;
}

/** 任何出口复位"本次已挂上"标记（探针状态本身由下一次探针覆盖，防跨请求串味） */
struct DohInstalledGuard {
  ~DohInstalledGuard() { dohProbe().installed = false; }
};

}  // namespace http
}  // namespace proteus
