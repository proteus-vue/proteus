// hosts/harmony/host-app/proteus_render/src/main/cpp/invoke_wire.h
// ★★★invoke 通道二进制线格式的**鸿蒙宿主（C++）侧唯一实现** —— T-app-fetch · 决策 #903 第五端
//
// 【它是什么】`PINV`（去程）/ `PRSP`（回程）帧的编解码器。与
//   `packages/api/src/invoke-wire.ts`（TS SSOT）· `hosts/android/.../InvokeWire.java` ·
//   `hosts/ios/ProteusHost/runtime/InvokeWire.swift` ·
//   `hosts/harmony/host-app/entry/src/main/ets/runtime/InvokeWire.ts`（ArkTS）**逐字节等价**。
//
// 【★为什么宿主侧还需要 C++ 一份（而不是复用 ArkTS 那份）】
//   鸿蒙 superapp 路径是**一次性 VM**（`hostAppRender` 每次新建 VM 并同步跑完；见
//   `host_app_runtime_impl.h` 的形态说明）⇒ JS 侧 `useFetch` 的 `invokeBytes` 调用发生在
//   **同一个 napi 同步调用内部**，此时：
//     · 不可能把帧交给 ArkTS 再等回调（napi 调用返回前 ArkTS 拿不到控制权）；
//     · 更不可能异步回推（VM 在 `hostAppRender` 返回时已销毁，回推无接收方）。
//   ⇒ 唯一合法形态是**在 napi 调用内同步完成整次 HTTP 往返**（诚实边界：会阻塞调用线程，
//     与 Android/iOS 的"受理即返、网络线程完成再回推"不同——这是鸿蒙 VM 形态决定的，不粉饰）。
//   而既然要同步完成，C++ 必须自己**看得懂 PINV 帧**（method/url/headers/body 全在帧里）。
//
// 【★零 OHOS 依赖（刻意的）】本文件只 include C++ 标准库 ⇒
//   ① 可被宿主编译（aarch64-ohos clang）；
//   ② 可被**本机 clang++ 编译成 macOS 可执行文件**，由 `pnpm check:invoke-wire-parity` 的 C++ 轮
//      与 TS 黄金向量逐字节对拍（与 Java「纯 JDK」同一纪律：手写副本不可怕，没有对拍才可怕）。
//
// 【线格式】小端；20B header + 长度前缀变长区 + TLV meta + 裸字节 body。
//   去程：magic u32 · version u32 · flags u32 · metaBytes u32 · bodyBytes u32
//         · method(u16+utf8) · reqId(u16+utf8) · meta(TLV) · body
//   回程：同 header · reqId(u16+utf8) · meta(TLV) · body
//   TLV：tag u8 · len u32 · payload；未知 tag **跳过**（版本演进纪律）。
#ifndef PROTEUS_INVOKE_WIRE_H
#define PROTEUS_INVOKE_WIRE_H

#include <cstdint>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace proteus {
namespace wire {

/** 去程帧 magic = "PINV"（小端字节 50 49 4E 56） */
constexpr uint32_t INVOKE_MAGIC = 0x564e4950u;
/** 回程帧 magic = "PRSP"（小端字节 50 52 53 50） */
constexpr uint32_t RESOLVE_MAGIC = 0x50535250u;
/** 线格式版本（与 TS `INVOKE_WIRE_VERSION` 同步） */
constexpr uint32_t WIRE_VERSION = 1;
/** header 字节数 */
constexpr uint32_t HEADER_BYTES = 20;

constexpr uint32_t INVOKE_FLAG_HAS_BODY = 1u;
constexpr uint32_t RESOLVE_FLAG_HAS_BODY = 1u;
constexpr uint32_t RESOLVE_FLAG_IS_ERROR = 2u;

/* 去程 TLV tag（1–15 段） */
constexpr uint8_t TAG_URL = 1;
constexpr uint8_t TAG_HTTP_METHOD = 2;
constexpr uint8_t TAG_HEADERS = 3;
constexpr uint8_t TAG_PARAMS = 4;
constexpr uint8_t TAG_TIMEOUT_MS = 5;
constexpr uint8_t TAG_RESPONSE_TYPE = 6;
constexpr uint8_t TAG_CONTENT_TYPE = 7;
/** ★#1118：请求分块回推（1 = 流式；缺省 = 整包） */
constexpr uint8_t TAG_STREAM = 8;
/** ★#1119：落盘路径（宿主直写沙箱） */
constexpr uint8_t TAG_SAVE_PATH = 9;

/* 回程 TLV tag（16 起；与去程段不重叠） */
constexpr uint8_t RTAG_HTTP_STATUS = 16;
constexpr uint8_t RTAG_REASON = 17;
constexpr uint8_t RTAG_MISSING = 18;
constexpr uint8_t RTAG_PENDING = 19;
constexpr uint8_t RTAG_HEADERS = 20;
/** ★#1118：流式块序号（有本字段 = 本帧是数据块，不结算） */
constexpr uint8_t RTAG_STREAM_SEQ = 21;

/** 响应体解释方式（与 `RequestConfig.responseType` 同语义） */
constexpr uint8_t RESPONSE_TEXT = 0;
constexpr uint8_t RESPONSE_JSON = 1;
constexpr uint8_t RESPONSE_ARRAYBUFFER = 2;

/**
 * 「未指定」三态（代替 C++17 的 optional）：OHOS clang 15 默认 **C++14**（实测：C++17 的 optional
 * 模板报 "no member named 'optional'"），而本头要被宿主工程直接编译——不为它单方面抬高整个工程的 -std。
 * 语义与 TS 的 `=== undefined` 一一对应：`has == false` ⇒ 编码时**不写**该 TLV（**不是** 值 0）。
 */
template <typename T>
struct Opt {
  bool has = false;
  T v = T();
  Opt() = default;
  Opt& operator=(const T& val) { v = val; has = true; return *this; }
  explicit operator bool() const { return has; }
  const T& operator*() const { return v; }
  T& operator*() { return v; }
  bool operator==(const Opt& o) const { return has == o.has && (!has || v == o.v); }
};

/** 有序键值对（★**不要换成 map**：TS 侧 `Object.entries` 保插入序；换 map 会重排 ⇒ 字节不等价）。 */
using NameValues = std::vector<std::pair<std::string, std::string>>;

/** 去程帧（`PINV`）解码结果——业务无关的"请求元数据 + 裸字节体"。 */
struct InvokeFrame {
  std::string method;
  std::string reqId;
  Opt<std::string> url;
  Opt<std::string> httpMethod;
  Opt<NameValues> headers;
  Opt<NameValues> params;
  /** `has=false` = **未指定**（对应 TS `meta.timeoutMs === undefined`；**不是** 0）。 */
  Opt<uint32_t> timeoutMs;
  /** 见 `RESPONSE_*`；`has=false` = 未指定。 */
  Opt<uint8_t> responseType;
  Opt<std::string> contentType;
  /** ★#1118：`has=false` = 未指定（不写 TLV）——与 TS 侧 `meta.stream === true` 对齐 */
  Opt<bool> stream;
  /** ★#1119：宿主把响应体直接写进该沙箱路径 */
  Opt<std::string> savePath;
  std::vector<uint8_t> body;

  int responseKind() const { return responseType ? static_cast<int>(*responseType) : RESPONSE_TEXT; }
  uint32_t timeoutOrDefault() const { return timeoutMs ? *timeoutMs : 15000u; }
};

/** 回程帧（`PRSP`）——宿主填它；`ok=false` 对应既有 `{"ok":false}`。 */
struct ResolveFrame {
  std::string reqId;
  bool ok = true;
  Opt<std::string> reason;
  Opt<bool> missing;
  Opt<bool> pending;
  Opt<uint32_t> status;
  Opt<NameValues> headers;
  /** ★#1118：非空 ⇒ 本帧是流式数据块（不结算）；空且 !pending ⇒ 最终帧 */
  Opt<uint32_t> streamSeq;
  std::vector<uint8_t> body;

  static ResolveFrame okOf(std::string reqId) {
    ResolveFrame f;
    f.reqId = std::move(reqId);
    return f;
  }
  static ResolveFrame err(std::string reqId, std::string reason) {
    ResolveFrame f;
    f.reqId = std::move(reqId);
    f.ok = false;
    f.reason = std::move(reason);
    return f;
  }
  /** "无此方法"（不是失败）：桥按 `missing` 给 `*.unsupported`。 */
  static ResolveFrame missingMethod(std::string reqId, std::string reason) {
    ResolveFrame f = err(std::move(reqId), std::move(reason));
    f.missing = true;
    return f;
  }
  static ResolveFrame pendingOf(std::string reqId) {
    ResolveFrame f = okOf(std::move(reqId));
    f.pending = true;
    return f;
  }
};

/* ────────────────────────── 小端字节游标 ────────────────────────── */

/** 写入游标。 */
class Writer {
 public:
  void u8(uint32_t v) { buf_.push_back(static_cast<uint8_t>(v & 0xffu)); }
  void u16(uint32_t v) {
    buf_.push_back(static_cast<uint8_t>(v & 0xffu));
    buf_.push_back(static_cast<uint8_t>((v >> 8) & 0xffu));
  }
  void u32(uint32_t v) {
    buf_.push_back(static_cast<uint8_t>(v & 0xffu));
    buf_.push_back(static_cast<uint8_t>((v >> 8) & 0xffu));
    buf_.push_back(static_cast<uint8_t>((v >> 16) & 0xffu));
    buf_.push_back(static_cast<uint8_t>((v >> 24) & 0xffu));
  }
  /** u16 长度前缀 + UTF-8（长度按**字节**计）。 */
  void str(const std::string& s) {
    if (s.size() > 0xffffu) throw std::runtime_error("字符串过长（>65535B）");
    u16(static_cast<uint32_t>(s.size()));
    buf_.insert(buf_.end(), s.begin(), s.end());
  }
  void raw(const std::vector<uint8_t>& b) { buf_.insert(buf_.end(), b.begin(), b.end()); }
  size_t length() const { return buf_.size(); }
  /** 回填 u32（TLV 长度前缀；payload 只编码一遍）。 */
  void patchU32(size_t at, uint32_t v) {
    if (at + 4 > buf_.size()) throw std::runtime_error("回填越界");
    buf_[at] = static_cast<uint8_t>(v & 0xffu);
    buf_[at + 1] = static_cast<uint8_t>((v >> 8) & 0xffu);
    buf_[at + 2] = static_cast<uint8_t>((v >> 16) & 0xffu);
    buf_[at + 3] = static_cast<uint8_t>((v >> 24) & 0xffu);
  }
  const std::vector<uint8_t>& bytes() const { return buf_; }
  std::vector<uint8_t> take() { return std::move(buf_); }

 private:
  std::vector<uint8_t> buf_;
};

/** 读取游标（越界即抛，不静默补零）。 */
class Reader {
 public:
  Reader(const uint8_t* p, size_t n) : p_(p), n_(n) {}
  explicit Reader(const std::vector<uint8_t>& b) : p_(b.data()), n_(b.size()) {}

  size_t remaining() const { return n_ - pos_; }

  uint8_t u8() {
    need(1, "u8");
    return p_[pos_++];
  }
  uint16_t u16() {
    need(2, "u16");
    uint16_t v = static_cast<uint16_t>(p_[pos_] | (static_cast<uint16_t>(p_[pos_ + 1]) << 8));
    pos_ += 2;
    return v;
  }
  uint32_t u32() {
    need(4, "u32");
    uint32_t v = static_cast<uint32_t>(p_[pos_]) | (static_cast<uint32_t>(p_[pos_ + 1]) << 8) |
                 (static_cast<uint32_t>(p_[pos_ + 2]) << 16) | (static_cast<uint32_t>(p_[pos_ + 3]) << 24);
    pos_ += 4;
    return v;
  }
  std::string str() {
    uint32_t len = u16();
    need(len, "str");
    std::string s(reinterpret_cast<const char*>(p_ + pos_), len);
    pos_ += len;
    return s;
  }
  std::vector<uint8_t> raw(size_t n) {
    need(n, "raw");
    std::vector<uint8_t> out(p_ + pos_, p_ + pos_ + n);
    pos_ += n;
    return out;
  }

 private:
  void need(size_t n, const char* what) const {
    if (remaining() < n) throw std::runtime_error(std::string("字节流被截断（") + what + "）");
  }
  const uint8_t* p_;
  size_t n_;
  size_t pos_ = 0;
};

/* ────────────────────────── TLV ────────────────────────── */

template <typename F>
inline void writeTlv(Writer& w, uint8_t tag, F&& payload) {
  w.u8(tag);
  size_t lenAt = w.length();
  w.u32(0);
  size_t payloadAt = w.length();
  payload(w);
  w.patchU32(lenAt, static_cast<uint32_t>(w.length() - payloadAt));
}

inline void writeNameValues(Writer& w, const NameValues& nv) {
  if (nv.size() > 0xffffu) throw std::runtime_error("键值对过多（>65535）");
  w.u16(static_cast<uint32_t>(nv.size()));
  for (const auto& kv : nv) {
    w.str(kv.first);
    w.str(kv.second);
  }
}

inline NameValues readNameValues(Reader& r) {
  uint32_t n = r.u16();
  NameValues out;
  out.reserve(n);
  for (uint32_t i = 0; i < n; i++) {
    std::string k = r.str();
    out.emplace_back(std::move(k), r.str());
  }
  return out;
}

/* ────────────────────────── 去程 ────────────────────────── */

inline std::vector<uint8_t> encodeInvokeMeta(const InvokeFrame& f) {
  Writer w;
  // ★判据与三端逐字对齐：`has_value()` 才写 TLV（**不是** `!= 0`）
  if (f.url) writeTlv(w, TAG_URL, [&](Writer& x) { x.str(*f.url); });
  if (f.httpMethod) writeTlv(w, TAG_HTTP_METHOD, [&](Writer& x) { x.str(*f.httpMethod); });
  if (f.headers) writeTlv(w, TAG_HEADERS, [&](Writer& x) { writeNameValues(x, *f.headers); });
  if (f.params) writeTlv(w, TAG_PARAMS, [&](Writer& x) { writeNameValues(x, *f.params); });
  if (f.timeoutMs) writeTlv(w, TAG_TIMEOUT_MS, [&](Writer& x) { x.u32(*f.timeoutMs); });
  if (f.responseType) writeTlv(w, TAG_RESPONSE_TYPE, [&](Writer& x) { x.u8(*f.responseType); });
  if (f.contentType) writeTlv(w, TAG_CONTENT_TYPE, [&](Writer& x) { x.str(*f.contentType); });
  // ★#1118：只在**显式 true** 时写（与 TS `meta.stream === true` 逐字对齐）
  if (f.stream && *f.stream) writeTlv(w, TAG_STREAM, [&](Writer& x) { x.u8(1u); });
  if (f.savePath) writeTlv(w, TAG_SAVE_PATH, [&](Writer& x) { x.str(*f.savePath); });
  return w.take();
}

/** 编码去程帧（宿主侧一般不用；对拍门禁用）。 */
inline std::vector<uint8_t> encodeInvoke(const InvokeFrame& f) {
  std::vector<uint8_t> meta = encodeInvokeMeta(f);
  Writer w;
  w.u32(INVOKE_MAGIC);
  w.u32(WIRE_VERSION);
  w.u32(f.body.empty() ? 0u : INVOKE_FLAG_HAS_BODY);
  w.u32(static_cast<uint32_t>(meta.size()));
  w.u32(static_cast<uint32_t>(f.body.size()));
  w.str(f.method);
  w.str(f.reqId);
  w.raw(meta);
  w.raw(f.body);
  return w.take();
}

inline void decodeInvokeMeta(const std::vector<uint8_t>& bytes, InvokeFrame& f) {
  Reader r(bytes);
  while (r.remaining() > 0) {
    uint8_t tag = r.u8();
    uint32_t len = r.u32();
    if (r.remaining() < len) throw std::runtime_error("去程 meta TLV 被截断");
    std::vector<uint8_t> payload = r.raw(len);
    Reader p(payload);
    switch (tag) {
      case TAG_URL: f.url = p.str(); break;
      case TAG_HTTP_METHOD: f.httpMethod = p.str(); break;
      case TAG_HEADERS: f.headers = readNameValues(p); break;
      case TAG_PARAMS: f.params = readNameValues(p); break;
      case TAG_TIMEOUT_MS: f.timeoutMs = p.u32(); break;
      case TAG_RESPONSE_TYPE: f.responseType = p.u8(); break;
      case TAG_CONTENT_TYPE: f.contentType = p.str(); break;
      case TAG_STREAM: f.stream = (p.u8() != 0); break;
      case TAG_SAVE_PATH: f.savePath = p.str(); break;
      default: break;  // 未知 tag 跳过（版本演进）
    }
  }
}

/** 解码去程帧（宿主主用）。magic/版本不符、尾部残留、截断 ⇒ 抛异常。 */
inline InvokeFrame decodeInvoke(const std::vector<uint8_t>& bytes) {
  Reader r(bytes);
  uint32_t magic = r.u32();
  if (magic != INVOKE_MAGIC) throw std::runtime_error("去程帧 magic 不符");
  uint32_t version = r.u32();
  if (version != WIRE_VERSION) throw std::runtime_error("去程帧版本不符");
  r.u32();  // flags（body 长度已由 bodyBytes 给出）
  uint32_t metaBytes = r.u32();
  uint32_t bodyBytes = r.u32();
  InvokeFrame f;
  f.method = r.str();
  f.reqId = r.str();
  decodeInvokeMeta(r.raw(metaBytes), f);
  f.body = r.raw(bodyBytes);
  if (r.remaining() != 0) throw std::runtime_error("去程帧尾部有残留字节");
  return f;
}

/** **只读方法名**（不做全帧解码；日志路径开销与载荷无关）。失败返回 "?"。 */
inline std::string peekMethod(const std::vector<uint8_t>& bytes) {
  try {
    Reader r(bytes);
    if (r.u32() != INVOKE_MAGIC) return "?";
    r.u32();
    r.u32();
    r.u32();
    r.u32();
    return r.str();
  } catch (...) {
    return "?";
  }
}

/* ────────────────────────── 回程 ────────────────────────── */

inline std::vector<uint8_t> encodeResolveMeta(const ResolveFrame& f) {
  Writer w;
  if (f.status) writeTlv(w, RTAG_HTTP_STATUS, [&](Writer& x) { x.u32(*f.status); });
  if (f.reason) writeTlv(w, RTAG_REASON, [&](Writer& x) { x.str(*f.reason); });
  if (f.missing) writeTlv(w, RTAG_MISSING, [&](Writer& x) { x.u8(*f.missing ? 1u : 0u); });
  if (f.pending) writeTlv(w, RTAG_PENDING, [&](Writer& x) { x.u8(*f.pending ? 1u : 0u); });
  if (f.headers) writeTlv(w, RTAG_HEADERS, [&](Writer& x) { writeNameValues(x, *f.headers); });
  if (f.streamSeq) writeTlv(w, RTAG_STREAM_SEQ, [&](Writer& x) { x.u32(*f.streamSeq); });
  return w.take();
}

/** 编码回程帧（宿主主用）。 */
inline std::vector<uint8_t> encodeResolve(const ResolveFrame& f) {
  std::vector<uint8_t> meta = encodeResolveMeta(f);
  uint32_t flags = 0;
  if (!f.body.empty()) flags |= RESOLVE_FLAG_HAS_BODY;
  if (!f.ok) flags |= RESOLVE_FLAG_IS_ERROR;
  Writer w;
  w.u32(RESOLVE_MAGIC);
  w.u32(WIRE_VERSION);
  w.u32(flags);
  w.u32(static_cast<uint32_t>(meta.size()));
  w.u32(static_cast<uint32_t>(f.body.size()));
  w.str(f.reqId);
  w.raw(meta);
  w.raw(f.body);
  return w.take();
}

inline void decodeResolveMeta(const std::vector<uint8_t>& bytes, ResolveFrame& f) {
  Reader r(bytes);
  while (r.remaining() > 0) {
    uint8_t tag = r.u8();
    uint32_t len = r.u32();
    if (r.remaining() < len) throw std::runtime_error("回程 meta TLV 被截断");
    std::vector<uint8_t> payload = r.raw(len);
    Reader p(payload);
    switch (tag) {
      case RTAG_HTTP_STATUS: f.status = p.u32(); break;
      case RTAG_REASON: f.reason = p.str(); break;
      case RTAG_MISSING: f.missing = (p.u8() != 0); break;
      case RTAG_PENDING: f.pending = (p.u8() != 0); break;
      case RTAG_HEADERS: f.headers = readNameValues(p); break;
      case RTAG_STREAM_SEQ: f.streamSeq = p.u32(); break;
      default: break;
    }
  }
}

/** 解码回程帧（宿主侧一般不用；对拍门禁与诊断用）。 */
inline ResolveFrame decodeResolve(const std::vector<uint8_t>& bytes) {
  Reader r(bytes);
  uint32_t magic = r.u32();
  if (magic != RESOLVE_MAGIC) throw std::runtime_error("回程帧 magic 不符");
  uint32_t version = r.u32();
  if (version != WIRE_VERSION) throw std::runtime_error("回程帧版本不符");
  uint32_t flags = r.u32();
  uint32_t metaBytes = r.u32();
  uint32_t bodyBytes = r.u32();
  ResolveFrame f;
  f.reqId = r.str();
  f.ok = (flags & RESOLVE_FLAG_IS_ERROR) == 0;
  decodeResolveMeta(r.raw(metaBytes), f);
  f.body = r.raw(bodyBytes);
  if (r.remaining() != 0) throw std::runtime_error("回程帧尾部有残留字节");
  return f;
}

}  // namespace wire
}  // namespace proteus

#endif  // PROTEUS_INVOKE_WIRE_H
