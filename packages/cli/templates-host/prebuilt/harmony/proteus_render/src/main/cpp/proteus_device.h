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

  return std::string("{\"ok\":false,\"missing\":true,\"reason\":\"未实现的设备方法：") + method + "\"}";
}

/** 是否属于设备域（供 `screenInvokeDispatch` 的前缀判定）。 */
inline bool isDeviceMethod(const std::string& method) {
  return method.rfind("device.", 0) == 0 || method == "clipboard.read" || method == "clipboard.write";
}

}  // namespace device
}  // namespace proteus
