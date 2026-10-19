// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_capture.h
#include <hilog/log.h>
// ★★★决策 #1083（`useScreenCapture` · C71）：录屏/截屏状态（鸿蒙腿）——**快照 + 动作队列**。
//
// 【鸿蒙是三端里 API 最全的（实测 SDK API 26 可用）】
//   · `display.isCaptured()` — **@since 12**：设备是否被截屏/投屏/录屏（真值，不是猜）
//   · `display.on('captureStatusChange', cb)` — @since 12：状态变化**系统事件**
//   · `PiPWindow.isPiPEnabled()` — @since 11/12：系统 PiP 是否启用
//   · **没有**公开的"用户截屏"事件（`display` 只报"当前是否被捕获"，不报"刚刚截了一次"）
//     ⇒ `onUserCapture` 在本端**如实不可用**（不伪造事件）。
//
// 【形态：为什么是"快照 + 动作队列"（与设备域其余项同源）】鸿蒙是一次性 VM（决策 #540）：
//   napi 调用返回后 VM 即销毁，ArkTS 侧的系统事件回调**没有存活的 JS 环境**。
//   ⇒ 读类由 ArkTS 采集**快照**（`setCaptureSnapshot`）回答；事件由 ArkTS 缓存，下次渲染时推 JS。
//   ★与 Android/iOS 的"事件即时推"语义不同——**如实登记，不粉饰为三端一致**。
#pragma once
#include <string>
#include "proteus_host_helpers.h"

namespace proteus {
namespace capture {

/** 快照与事件队列的状态（**函数内静态** ⇒ 跨 TU 唯一实例；见下方注释的踩坑）。 */
struct CaptureState {
    bool haveRecording = false;
    bool recording = false;
    bool havePip = false;
    bool pip = false;
    int pendingEvents = 0;
};

/**
 * ★★★**必须函数内静态**（真机抓到的真缺陷）：文件级 `static` 在**每个编译单元各一份**——
 *   `setDeviceSnapshot`（proteus_host.cpp）写入自己那份、`stateJson()`（本头被
 *   `host_app_runtime_impl.h` 包含进另一 TU）读另一份 ⇒ 快照"采到了但读不到"。
 *   与设备域 `proteus_device.h::snapshot()` 同款修法（`inline` 函数内静态 = 跨 TU 唯一）。
 */
inline CaptureState& state() {
    static CaptureState s;
    return s;
}

static inline void setCaptureSnapshot(bool haveRecording, bool recording, bool havePip, bool pip) {
    state().haveRecording = haveRecording;
    state().recording = recording;
    state().havePip = havePip;
    state().pip = pip;
}

/** ArkTS 报"发生了事件"（录屏变化 / 截屏）——攒起来，下次渲染的 VM 内推给 JS。 */
static inline void noteCaptureEvent(int kind) { state().pendingEvents |= kind; }
static constexpr int EVT_RECORDING = 1;
static constexpr int EVT_USER_CAPTURE = 2;

/** 取走待推事件（消费式；返回位掩码）。 */
static inline int takeCaptureEvents() { int v = state().pendingEvents; state().pendingEvents = 0; return v; }

/** `device.capture` 回执：只写**本端真能查**的字段（缺字段 = 该能力不可用，桥给 unsupported）。 */
static inline std::string stateJson() {
    std::string o = "{";
    if (state().haveRecording) o += std::string("\"recording\":") + (state().recording ? "true" : "false") + ",";
    if (state().havePip) o += std::string("\"pip\":") + (state().pip ? "true" : "false") + ",";
    // ★诊断：**如实反映**本端这次有没有拿到值（硬编码 true 会与"字段缺失"自相矛盾）
    o += std::string("\"recordingSupported\":") + (state().haveRecording ? "true" : "false") + ",";
    o += std::string("\"pipSupported\":") + (state().havePip ? "true" : "false") + ",";
    o += "\"userCaptureSupported\":false";
    o += "}";
    return o;
}

}  // namespace capture
}  // namespace proteus
