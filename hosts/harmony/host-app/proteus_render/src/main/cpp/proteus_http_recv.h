// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_recv.h
// ★★★#1344 B-3：**逐块接收闸**（限额 / 落盘 / 流式回推 —— 三种"逐块"语义的**唯一**分流点）
//   （从 `proteus_http.h` 抽出——那个文件在 `check:file-size` 的 1000 行硬上限上）
//
// 【为什么这三种语义必须在一个函数里分流】
//   RCP 的 `Rcp_OnBinaryReceiveCallback` **只有一个回调槽**（`HMS_Rcp_SetRequestOnBinaryDataRecvCallback`）。
//   也就是说"响应体怎么处理"不是三个可叠加的选项，而是**一次三选一**：
//     · 默认      ⇒ 累积到 `gate.body`（整包返回，受 `MAX_BODY_BYTES` 约束）
//     · `savePath` ⇒ 逐块直写文件（`SaveSession`，不受内存上限约束）
//     · `stream`   ⇒ 逐块 `pushResolve` 回推给 JS（会话模式；JS 侧 `onChunk` 消费）
//   分到三个文件里就会变成"谁先注册谁生效"，而**静默生效顺序**正是本仓最怕的缺陷形态。
//   ⇒ 三条分支写在一起，优先级显式：save > stream > 累积。
//
// 【诚实边界（勿删，判据守着）】
//   · 落盘/流式只消除**本层**的 body 累积；RCP 的 `Rcp_Response.body` 是否整包驻留**未取证**
//     ⇒ 不宣称"内存有界"（#1192 更正）。
//   · 流式的 seq 由**宿主**分配（从 0 起）；JS 侧跳号即判丢帧（不静默拼接半截数据）。
#pragma once
#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>

#include "proteus_http_guard.h"   // ★流式回推钩子（setHttpStreamHandler / g_proteusHttpStream）
#include "proteus_http_save.h"    // ★落盘会话（SaveSession）
#if defined(__has_include)
#if __has_include(<RemoteCommunicationKit/rcp.h>)
#include <RemoteCommunicationKit/rcp.h>
#define PROTEUS_RECV_HAVE_H 1
#endif
#endif
#ifndef PROTEUS_RECV_HAVE_H
#define PROTEUS_RECV_HAVE_H 0
#endif

#if PROTEUS_RECV_HAVE_H

namespace proteus {
namespace http {
namespace detail {

/**
 * 逐块接收闸的状态（栈上，生命周期 = 一次 `FetchSync`）。
 * ★`body` 只在**未越线**时增长 ⇒ 内存峰值 ≤ MAX_BODY_BYTES + 单块大小。
 */
struct RecvGate {
  std::vector<uint8_t> body;
  size_t limit = 0;
  bool exceeded = false;
  bool cancelCalled = false;
  unsigned int cancelRc = 0;
  int chunks = 0;
  unsigned long long seen = 0;
  Rcp_Session* session = nullptr;
  const Rcp_Request* req = nullptr;
  unsigned int (*cancelFn)(Rcp_Session*, const Rcp_Request*) = nullptr;
  /**
   * ★★★#1187：**落盘会话**（实现见 `proteus_http_save.h`）。非 null ⇒ 逐块直写文件、body 不累积。
   */
  SaveSession* save = nullptr;
  /**
   * ★★★#1344 B-3：**流式回推**（会话模式才有）。非空 ⇒ 每块经它入队（JS 侧 `onChunk` 消费），
   *   而**不是**累积到 `body`。与 `save` 互斥由调用方保证（两者都要"逐块"，但目的不同）。
   */
  const std::string* streamReqId = nullptr;
  uint32_t streamSeq = 0;
  unsigned long long streamPushed = 0;
};

/**
 * `Rcp_OnBinaryReceiveCallbackFunc`：越线即停止累积并尽力中止传输。
 * 返回值语义（HMS 头文件："the length of binary data"）= 本次已处理字节数；一律回 `n`，
 * 让 RCP 认为数据已被消费（越线后丢弃但不阻塞内部泵），由 cancel 真正掐断。
 */
inline size_t recvGate(void* usr, Rcp_Buffer* buf) {
  if (usr == nullptr) return 0;
  RecvGate* g = static_cast<RecvGate*>(usr);
  if (buf == nullptr || buf->buffer == nullptr || buf->length == 0) return 0;
  const size_t n = static_cast<size_t>(buf->length);
  g->chunks++;
  g->seen += n;
  if (g->exceeded) return n;  // 已越线：丢弃其余块（等 cancel 生效），内存不再增长
  if (g->limit != 0 && g->body.size() + n > g->limit) {
    g->exceeded = true;
    // ★越线后**不再累积**：内存峰值锁在 limit + 本块之前。
    if (!g->cancelCalled && g->cancelFn != nullptr && g->session != nullptr) {
      g->cancelCalled = true;
      g->cancelRc = g->cancelFn(g->session, g->req);
    }
    return n;
  }
  const uint8_t* p = reinterpret_cast<const uint8_t*>(buf->buffer);
  // ★#1187：落盘模式 ⇒ 交给 SaveSession 直写。★#1192 更正：这只消除**本层**的 body 累积；
  //   RCP 的 Rcp_Response.body 是否整包驻留未取证 ⇒ **不宣称"内存有界"**。
  if (g->save != nullptr) {
    if (!g->save->write(p, n)) {
      // 写失败 / 超限 ⇒ 同样按"越线"处理并 cancel（不能静默继续下载然后丢数据）
      g->exceeded = true;
      if (!g->cancelCalled && g->cancelFn != nullptr && g->session != nullptr) {
        g->cancelCalled = true;
        g->cancelRc = g->cancelFn(g->session, g->req);
      }
    }
    return n;
  }
  /**
   * ★★★#1344 B-3：**流式模式 ⇒ 逐块回推**（会话模式才有；一次性 VM 下 `streamReqId` 恒 nullptr）。
   *   ★不累积到 `body`：调用方按块消费，内存不随响应体增长（这正是流式的意义）。
   *   ★seq **从 0 起连续**：JS 侧跳号即判丢帧（`capability-invoke.settleHostCallBytes`）。
   *   ★即使入队失败也不在这里 cancel —— 入队只是加锁 push_back，
   *     失败只有 OOM；真出问题由 JS 侧的超时/`MAX_STREAM_CHUNKS` 兜底，不在网络线程做决策。
   */
  if (g->streamReqId != nullptr && g_proteusHttpStream != nullptr) {
    g_proteusHttpStream(*g->streamReqId, g->streamSeq++, p, n);
    g->streamPushed++;
    return n;
  }
  g->body.insert(g->body.end(), p, p + n);
  return n;
}

}  // namespace detail
}  // namespace http
}  // namespace proteus

#endif  // PROTEUS_RECV_HAVE_H
