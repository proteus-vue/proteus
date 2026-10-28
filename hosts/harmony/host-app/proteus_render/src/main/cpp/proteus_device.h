// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_device.h
// ★★★App 端「设备与系统」域能力（鸿蒙宿主）—— 2026-10-19 · 决策 #1067
//
// 【覆盖（12 项）】device.vibrate / device.network / clipboard.read / clipboard.write /
//   device.screen / device.info / device.battery / device.orientation /
//   device.brightness.get / device.brightness.set / device.keepScreenOn / device.hevc
//
// 【★为什么是"快照 + 动作队列"而不是直接调系统 API（鸿蒙一次性 VM 的结构性约束）】
//   本宿主的 `invokeBytes` 在 `hostAppRender` 的 napi 调用**内部**同步执行（见 invoke_bytes_bridge.h 头注）；
//   而鸿蒙的设备 API 分两类：
//     · **同步可读**（`display.getDefaultDisplaySync` / `deviceInfo.*` / `batteryInfo.*` /
//       `connection.getDefaultNetSync` / `pasteboard.getDataSync`）——值由 **ArkTS 侧采集**后
//       经 `setSnapshot(json)` 交进来（napi 同步调用，毫秒级）；
//     · **异步动作**（`vibrator.startVibration` / `window.setWindowBrightness` /
//       `setWindowKeepScreenOn`）——**不能**在同步 napi 内 await（会把 JS 线程卡住/回推无接收方），
//       ⇒ 入队，由 ArkTS 在渲染返回后 `drainActions()` 取走并逐条执行。
//
// 【★诚实边界（逐条）】
//   · **剪贴板读**：值是**快照时**的内容（不是读取瞬间）——一次性 VM 无法在同步调用里取系统剪贴板。
//     ArkTS 每次渲染前都会刷新快照 ⇒ 延迟上界 = 一次渲染间隔。
//   · **亮度读**：窗口亮度（`window.getWindowProperties().brightness`），不是系统全局亮度。
//   · **动作类**：回 `{accepted:true}` 表示**已受理**，不代表已生效（执行在 ArkTS 主线程异步完成）。
//   · **HEVC**：快照字段缺失 ⇒ 诚实 `missing`（不谎报 false——"没探测"与"不支持"必须分得开）。
#pragma once
#include <string>
#include <vector>

#include "proteus_host_helpers.h"

namespace proteus {
namespace device {

/** ArkTS 采集的设备快照（原样 JSON；空 = 尚未采集） */
inline std::string& snapshot() {
  static std::string s;
  return s;
}

/** 待执行动作队列（ArkTS 渲染后 drain）。 */
inline std::vector<std::string>& actions() {
  static std::vector<std::string> v;
  return v;
}

/** 受理动作（返回给 JS 的 accepted 计数）。 */
inline int enqueue(const std::string& actionJson) {
  actions().push_back(actionJson);
  return static_cast<int>(actions().size());
}

/** 取并清空动作队列（JSON 数组字符串）。 */
inline std::string drainActions() {
  std::string out = "[";
  for (size_t i = 0; i < actions().size(); i++) {
    if (i) out += ",";
    out += actions()[i];
  }
  out += "]";
  actions().clear();
  return out;
}

/** 从快照取子对象（`{}`/`[]` 配对切片）；缺失 ⇒ 空串（调用方据此回 missing）。 */
inline std::string snapshotObj(const char* key, char openCh = '{', char closeCh = '}') {
  return extractValueAfterKey(snapshot(), key, openCh, closeCh);
}

/** 从快照取数值（缺失 ⇒ false）。 */
inline bool snapshotNum(const char* key, double* out) {
  return jnum(snapshot().c_str(), snapshot().size(), key, out);
}

/** 从快照取字符串（缺失 ⇒ false）。 */
inline bool snapshotStr(const char* key, std::string* out) {
  return jstr(snapshot().c_str(), snapshot().size(), key, out);
}

/** 从快照取布尔（`"key":true` 文本判定；够用且零依赖）。 */
inline bool snapshotBool(const char* key, bool* out) {
  std::string needle = std::string("\"") + key + "\":";
  size_t p = snapshot().find(needle);
  if (p == std::string::npos) return false;
  p += needle.size();
  while (p < snapshot().size() && (snapshot()[p] == ' ' || snapshot()[p] == '\t')) p++;
  if (snapshot().compare(p, 4, "true") == 0) { *out = true; return true; }
  if (snapshot().compare(p, 5, "false") == 0) { *out = false; return true; }
  return false;
}

/**
 * 分发一条设备能力调用（与 Android `DeviceCapability.invoke` / iOS `DeviceCapability.invoke` 同形）。
 * 返回**既有 `invoke()` 的 JSON 串**（`{"ok":true,"data":…}` / `{"ok":false,"missing":true,…}`），
 * 与字节腿的通用分发契约一致（回程 body = 该串）。
 */
inline std::string dispatch(const std::string& method, const std::string& argsJson) {
  // ── 读类：快照 ──
  if (method == "device.screen" || method == "device.info" || method == "device.battery" ||
      method == "device.network" || method == "device.orientation") {
    const char* key = method == "device.screen" ? "screen"
                    : method == "device.info" ? "info"
                    : method == "device.battery" ? "battery"
                    : method == "device.network" ? "network"
                    : "orientation";
    std::string obj = snapshotObj(key);
    if (obj.empty()) {
      return std::string("{\"ok\":false,\"missing\":true,\"reason\":\"") + method +
             ": 设备快照未采集（宿主未注入 snapshot）\"}";
    }
    return std::string("{\"ok\":true,\"data\":") + obj + "}";
  }
  if (method == "device.brightness.get") {
    double v = 0;
    if (!snapshotNum("brightness", &v)) {
      return "{\"ok\":false,\"missing\":true,\"reason\":\"device.brightness.get: 快照无亮度（宿主未采集）\"}";
    }
    char b[96];
    snprintf(b, sizeof(b), "{\"ok\":true,\"data\":%.4f}", v);
    return b;
  }
  if (method == "clipboard.read") {
    std::string text;
    if (!snapshotStr("clipboard", &text)) {
      return "{\"ok\":false,\"missing\":true,\"reason\":\"clipboard.read: 快照无剪贴板（宿主未采集）\"}";
    }
    // 复用 helpers 的转义（拼 JSON 必须转义，否则正文会破坏帧）
    std::string quoted = jsonEscape(text);
    return std::string("{\"ok\":true,\"data\":{\"text\":\"") + quoted + "\"}}";
  }
  // ★★决策 #1080：C5 传感器（鸿蒙 sensor.on 是订阅式 ⇒ 走"快照 + 动作队列"形态）
  if (method == "device.sensor.read") {
    std::string kind;
    jstr(argsJson.c_str(), argsJson.size(), "kind", &kind);
    std::string obj = snapshotObj(("sensor_" + kind).c_str());
    if (obj.empty()) {
      return std::string("{\"ok\":false,\"missing\":true,\"reason\":\"device.sensor.read: 快照无 ") + kind +
             " 读数（宿主未采集——鸿蒙订阅式 API，由 ArkTS 在渲染前采集）\"}";
    }
    return std::string("{\"ok\":true,\"data\":") + obj + "}";
  }
  if (method == "device.sensor.start" || method == "device.sensor.stop") {
    std::string kind;
    jstr(argsJson.c_str(), argsJson.size(), "kind", &kind);
    std::string action = (method == "device.sensor.start") ? "sensor.start" : "sensor.stop";
    int n = enqueue("{\"action\":\"" + action + "\",\"kind\":\"" + jsonEscape(kind) + "\"}");
    char out[160];
    snprintf(out, sizeof(out), "{\"ok\":true,\"data\":{\"accepted\":true,\"queued\":%d}}", n);
    return out;
  }
  if (method == "device.hevc") {
    bool supported = false;
    if (!snapshotBool("hevc", &supported)) {
      return "{\"ok\":false,\"missing\":true,\"reason\":\"device.hevc: 快照无 HEVC 探测结果\"}";
    }
    return std::string("{\"ok\":true,\"data\":{\"supported\":") + (supported ? "true" : "false") + "}}";
  }

  // ── 动作类：入队（ArkTS 在渲染后 drain 执行）──
  if (method == "device.vibrate") {
    double ms = 15;
    jnum(argsJson.c_str(), argsJson.size(), "durationMs", &ms);
    char b[128];
    snprintf(b, sizeof(b), "{\"action\":\"vibrate\",\"durationMs\":%d}", static_cast<int>(ms));
    int n = enqueue(b);
    char out[160];
    snprintf(out, sizeof(out), "{\"ok\":true,\"data\":{\"accepted\":true,\"queued\":%d}}", n);
    return out;
  }
  if (method == "clipboard.write") {
    std::string text;
    jstr(argsJson.c_str(), argsJson.size(), "text", &text);
    std::string quoted = jsonEscape(text);
    int n = enqueue(std::string("{\"action\":\"clipboard.write\",\"text\":\"") + quoted + "\"}");
    char out[160];
    snprintf(out, sizeof(out), "{\"ok\":true,\"data\":{\"accepted\":true,\"queued\":%d}}", n);
    return out;
  }
  if (method == "device.brightness.set") {
    double v = 0.5;
    jnum(argsJson.c_str(), argsJson.size(), "value", &v);
    char b[128];
    snprintf(b, sizeof(b), "{\"action\":\"brightness.set\",\"value\":%.4f}", v);
    int n = enqueue(b);
    char out[160];
    snprintf(out, sizeof(out), "{\"ok\":true,\"data\":{\"accepted\":true,\"queued\":%d}}", n);
    return out;
  }
  if (method == "device.keepScreenOn") {
    bool on = true;
    std::string hay = argsJson;
    size_t p = hay.find("\"on\":");
    if (p != std::string::npos) {
      size_t q = p + 5;
      while (q < hay.size() && hay[q] == ' ') q++;
      on = hay.compare(q, 5, "false") != 0;
    }
    int n = enqueue(std::string("{\"action\":\"keepScreenOn\",\"on\":") + (on ? "true" : "false") + "}");
    char out[160];
    snprintf(out, sizeof(out), "{\"ok\":true,\"data\":{\"accepted\":true,\"queued\":%d}}", n);
    return out;
  }
  /**
   * ★★★#1258 C21 `phone.call` —— 拨号盘唤起（鸿蒙侧）。
   *
   * 【为什么走动作队列而不是直接返回值】
   *   拉起拨号盘要用 ArkTS 的 `startAbility`（异步 Promise），而本函数的调用点是**同步 napi**
   *   （在 `hostAppRender` 内部）——不能在同步 napi 里 await。⇒ 与震动/亮度同一形态：
   *   C++ 入队 `{action:'phone.call', number}`，ArkTS 在渲染后 `drainDeviceActions()` 取走执行。
   *   ★这与本文件头的既有解释一致（`device.h` 顶部的"动作入队"设计），不是本案特例。
   *
   * 【★★号码校验（与 Android/iOS **同一白名单**）】
   *   未校验字符串拼进 want 的 uri 就是注入面。白名单：`0-9 + - ( ) 空格 # * ,`，至少 1 位数字。
   *   ★非法**直接报错**（不入队）——静默清洗会让业务打到错的号。
   *
   * 【诚实语义】返回 `{accepted:true}` = **已入队**，不是"已拉起"；ArkTS 侧失败只记日志
   *   （与震动/亮度的既有语义一致，见 DeviceSnapshot.ets 的头注释）。
   */
  if (method == "phone.call") {
    std::string number;
    if (!jstr(argsJson.c_str(), argsJson.size(), "number", &number)) {
      return "{\"ok\":false,\"missing\":false,\"reason\":\"phone.call 需要 { number }\"}";
    }
    if (number.empty() || number.size() > 32) {
      return "{\"ok\":false,\"missing\":false,\"reason\":\"phone.call: 号码为空或过长\"}";
    }
    int digits = 0;
    for (char c : number) {
      const bool ok = (c >= '0' && c <= '9') || c == '+' || c == '-' || c == '(' || c == ')' ||
                      c == ' ' || c == '#' || c == '*' || c == ',';
      if (!ok) {
        return "{\"ok\":false,\"missing\":false,\"reason\":\"phone.call: 号码非法（只允许 0-9 + - ( ) 空格 # * ,）\"}";
      }
      if (c >= '0' && c <= '9') digits++;
    }
    if (digits == 0) {
      return "{\"ok\":false,\"missing\":false,\"reason\":\"phone.call: 号码里没有数字\"}";
    }
    int n = enqueue(std::string("{\"action\":\"phone.call\",\"number\":\"") + jsonEscape(number) + "\"}");
    char out[192];
    snprintf(out, sizeof(out), "{\"ok\":true,\"data\":{\"accepted\":true,\"queued\":%d,\"uri\":\"tel:%s\"}}", n,
             jsonEscape(number).c_str());
    return out;
  }

  /**
   * ★★★#1336 C22 `share` —— 系统分享面板（鸿蒙侧）。
   *
   * 【★★★为什么不是"直接调 systemShare"】鸿蒙的 `systemShare.ShareController.show()`
   *   需要 `common.UIAbilityContext` + 是一次 **Promise** 调用，而本函数在**同步 napi** 内执行
   *   （与 `phone.call` 同一约束）⇒ 入队 `{action:'share', ...}`，ArkTS 渲染后 drain 执行。
   *   ★回执 `{accepted:true}` = **已入队**，不是"面板已拉起"（与震动/拨号同一语义）。
   *
   * 【★API 出处（本次取证纠正了上一单的一个错误结论）】
   *   上一轮（#1285 选型时）记录「鸿蒙 SDK 里没有 systemShare」——**那是搜错了目录**：
   *   `systemShare` 在 **HMS kit**（`hms/ets/api/@hms.collaboration.systemShare.d.ts`，
   *   经 `@kit.ShareKit` 导出，`@since 4.1.0(11)`），不在 `openharmony/ets/api` 下。
   *   ★教训与「常量存在 ≠ 有人声明」（#1285 鸿蒙 `dial`）同族但方向相反：
   *     **"搜不到" ≠ "不存在"**——下否定结论前要把搜索面覆盖全（这里要多搜一层 `hms/`）。
   *
   * 【输入校验（与 Android/iOS **同一集**）】
   *   ① 至少一项内容；② 文本 8 KiB / 标题 256 / URL 2 KiB；
   *   ③ URL scheme 只允许 http/https（分享会把链接递给别的应用）。
   *   ★非法**直接报错**（不入队）——静默清洗等于把业务没写过的链接发出去。
   */
  if (method == "share") {
    std::string title, text, url;
    jstr(argsJson.c_str(), argsJson.size(), "title", &title);
    jstr(argsJson.c_str(), argsJson.size(), "text", &text);
    jstr(argsJson.c_str(), argsJson.size(), "url", &url);
    /* ★★★#1336 真机剖出：宿主层此前**不 trim 标题**，而 JS 层 `assertShareOptions` 会 trim
       ⇒ 直调宿主传 `{"title":"   "}` 被判"有内容"而受理（拉起一个空面板）。
       ★三端同一缺陷（Android/iOS 同样只在判空时看原始串）⇒ 三端一起补 trim。
       口径与 JS 层一致：**标题 trim**（空白标题等于没给），**正文不 trim**（首尾空白可能有意为之）。 */
    {
      const auto notSpace = [](unsigned char c) { return c != ' ' && c != '\t' && c != '\n' && c != '\r'; };
      auto b = title.begin(), e = title.end();
      while (b != e && !notSpace(static_cast<unsigned char>(*b))) ++b;
      while (b != e && !notSpace(static_cast<unsigned char>(*(e - 1)))) --e;
      title = std::string(b, e);
    }
    if (title.size() > 256) {
      return "{\"ok\":false,\"missing\":false,\"reason\":\"share: title 过长（上限 256）\"}";
    }
    if (text.size() > 8192) {
      return "{\"ok\":false,\"missing\":false,\"reason\":\"share: text 过长（上限 8192）\"}";
    }
    if (url.size() > 2048) {
      return "{\"ok\":false,\"missing\":false,\"reason\":\"share: url 过长（上限 2048）\"}";
    }
    if (!url.empty()) {
      /* http/https 前缀判定。★大小写不敏感（`HTTP://` 也是合法 scheme），
         且必须带 `://` —— 否则 `httpfoo:` 这种自定义 scheme 会被误放行（前缀匹配的经典穿帮）。 */
      std::string low;
      low.reserve(url.size());
      for (char c : url) low += static_cast<char>((c >= 'A' && c <= 'Z') ? (c - 'A' + 'a') : c);
      const bool httpLike = (low.rfind("http://", 0) == 0) || (low.rfind("https://", 0) == 0);
      if (!httpLike) {
        return "{\"ok\":false,\"missing\":false,\"reason\":\"share: url 只允许 http/https\"}";
      }
    }
    if (title.empty() && text.empty() && url.empty()) {
      return "{\"ok\":false,\"missing\":false,\"reason\":\"share: 内容为空（title/text/url 至少给一项）\"}";
    }
    int n = enqueue(std::string("{\"action\":\"share\",\"title\":\"") + jsonEscape(title) + "\",\"text\":\"" +
                    jsonEscape(text) + "\",\"url\":\"" + jsonEscape(url) + "\"}");
    char out[128];
    snprintf(out, sizeof(out), "{\"ok\":true,\"data\":{\"accepted\":true,\"queued\":%d}}", n);
    return out;
  }

  return std::string("{\"ok\":false,\"missing\":true,\"reason\":\"未实现的设备方法：") + method + "\"}";
}

/** 是否属于设备域（供 `screenInvokeDispatch` 的前缀判定）。 */
inline bool isDeviceMethod(const std::string& method) {
  // ★★★#1285：`phone.call` 也走本文件的分派（动作队列机制），所以必须进这个白名单——
  //   否则 `host_app_runtime_impl.h` 会在进 dispatch 之前就回落成 `missing`（"写了没人调"）。
  return method.rfind("device.", 0) == 0 || method == "clipboard.read" || method == "clipboard.write" ||
         method == "phone.call" ||
         // ★★★#1336：`share` 与 `phone.call` 同因——走本文件的分派（动作队列），
         //   不进这个白名单就会在 dispatch 前回落 `missing`（"写了没人调"）。
         method == "share";
}

}  // namespace device
}  // namespace proteus
