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
