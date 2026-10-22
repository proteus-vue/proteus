// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_diag.h
// ★★★#1194：**落盘/内存读数的记账**（从 `proteus_http.h` 抽出——那里已到 1000 行上限）。
//
// 【职责边界】只做"把一次请求的可核对读数写进 `LastLimitDiag`"：
//   · 逐块闸读数（chunks / seen / exceeded / kept）
//   · 落盘读数（saveMode / saveWritten / saveLimit）
//   · 内存峰值（vmHwmBeforeKb / vmHwmAfterKb）
//   请求流程归 `proteus_http.h`，落盘归 `proteus_http_save.h`，传输读数归 `proteus_http_transport.h`。
//
// 【★为什么"读数必须在 finish() 之后取"（独立验证第三轮 R3）】
//   原实现把 `saveWritten` / `vmHwmAfterKb` 在 `finish()` **之前**快照；
//   而"闸未安装 / chunks==0"时有一支 `resp->body` 回填（`gate.save->write(...)`）
//   发生在快照**之后** ⇒ 那批字节**漏计** ⇒ `saveWritten == seen` 判据红成"实现坏了"，
//   而真因只是读数取早了（本仓最怕的"装置让人误诊"）。
//   ★这不是"minSdk 17 下不可达"：注册回调失败（`pSetOnBinaryRecv` 返回非 0）
//   是**运行时降级路径**，`proteus_http.h` 本身就实现了它并打了日志。
#pragma once
#include <cstdio>
#include <cstring>

namespace proteus {
namespace http {

/**
 * 一次请求的逐块闸 / 落盘 / 内存读数（★#1197：从 `proteus_http.h` 搬来，那里已贴 1000 行上限）。
 * ★`saveWritten` 语义：成功 = 落盘字节；失败 = 写入后丢弃的字节。
 */
struct LastLimitDiag {
  bool gateInstalled = false;   // 逐块回调是否注册成功（false ⇒ 只能事后拒绝）
  int chunks = 0;               // 回调被调用的块数
  unsigned long long seen = 0;  // 网络侧实际到达的字节（含越线后的丢弃）
  bool exceeded = false;        // 是否越线
  bool cancelCalled = false;    // 是否调用了 CancelRequest
  unsigned int cancelRc = 0;    // CancelRequest 的返回码（0 = 成功受理）
  size_t kept = 0;              // 越线前保留在内存里的字节数（≤ MAX_BODY_BYTES）
  /**
   * ★★★#1191（独立验证 J4/J5 修复）：落盘模式的实际读数。
   *
   * 【为什么必须有】原判据拿 `kept==0` 当"逐块直写"的证据，但那是**恒真式**：
   *   落盘模式下 `recvGate` 直接走 `save->write` 且 `gate.limit=0` ⇒ `gate.body` 永不增长
   *   ⇒ `kept` 必然是 0。把 `write()` 改成 no-op 也还是 0。**证明不了任何事**。
   * ⇒ 补三个可核对的量：`saveMode`（走了落盘分支）、`saveWritten`（真的写进文件多少）、
   *   `saveLimit`（实际生效的上限——落盘是 1 GiB，不是 32 MiB）。
   */
  bool saveMode = false;
  // ★#1197：成功 = 落盘字节；失败 = 写入后丢弃的字节（判据只在 ok:true 断言 saveWritten==seen）
  unsigned long long saveWritten = 0;
  unsigned long long saveLimit = 0;
  // ★#1193/#1194（B4）：进程峰值 RSS（VmHWM，kB）；0 = 读不到（不是"内存 0"）。见本文件上方 readVmHwmKb()
  unsigned long long vmHwmBeforeKb = 0;
  unsigned long long vmHwmAfterKb = 0;
};

inline LastLimitDiag& lastLimitDiag() {
  static LastLimitDiag d;
  return d;
}

/** 读 `/proc/self/status` 的 `VmHWM`（峰值 RSS，kB）；读不到 ⇒ 0（**不可得**，不是 0 内存） */
inline unsigned long long readVmHwmKb() {
  FILE* f = std::fopen("/proc/self/status", "r");
  if (f == nullptr) return 0;
  char line[128];
  unsigned long long kb = 0;
  while (std::fgets(line, sizeof(line), f) != nullptr)
    if (std::strncmp(line, "VmHWM:", 6) == 0) { std::sscanf(line + 6, "%llu", &kb); break; }
  std::fclose(f);
  return kb;
}

}  // namespace http
}  // namespace proteus
