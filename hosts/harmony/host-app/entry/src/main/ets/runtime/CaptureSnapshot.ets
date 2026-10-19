// hosts/harmony/host-app/entry/src/main/ets/runtime/CaptureSnapshot.ets
// ★★★决策 #1083（`useScreenCapture` · C71）：录屏 / 画中画状态**快照**（鸿蒙腿）。
//
// 【为什么是快照（与设备域其余项同源）】鸿蒙是一次性 VM（决策 #540）：napi 调用返回后 VM 即销毁，
//   系统事件回调没有存活的 JS 环境。⇒ 读类由 ArkTS 采**当前值**写进 C++ 静态（`setDeviceSnapshot`
//   里带上），渲染时由 VM 内的 `device.capture` 回答。
//
// 【本端真能查的（实测 SDK API 26）】
//   · `display.isCaptured()` — @since 12：设备是否被截屏/投屏/录屏（**真值**）
//   · `PiPWindow.isPiPEnabled()` — @since 11/12：系统 PiP 是否启用
//   · **没有**公开的"用户截屏"事件 ⇒ `onUserCapture` 在本端如实不可用。
//
// 【一个必须说清的差异】`PiPWindow.isPiPEnabled()` 报的是**系统 PiP 能力是否启用**，
//   不是"当前是否有一个 PiP 窗口在显示"——后者鸿蒙也没有全局查询。
//   ⇒ 本端 `pip` 字段语义 = "PiP 已启用"。与 Android（本应用是否在 PiP）/ iOS（查不了）**三端语义不同**，
//   在能力页如实标注（不假装一致）。

import { display } from '@kit.ArkUI';
import { PiPWindow } from '@kit.ArkUI';

/** 采集结果（`-1` = 本端查不了，不写该字段） */
export interface CaptureSnapshotData {
  recording: number;
  pip: number;
}

/**
 * 采集录屏/画中画状态。
 * ★任何一项查询失败 ⇒ 该项回 `-1`（**不写字段**，桥据此给 unsupported，绝不伪造 false）。
 */
export function readCaptureSnapshot(): CaptureSnapshotData {
  let recording: number = -1;
  let pip: number = -1;
  try {
    recording = display.isCaptured() ? 1 : 0;
  } catch (e) {
    recording = -1;   // 服务异常（1400003）⇒ 如实不可用
  }
  try {
    pip = PiPWindow.isPiPEnabled() ? 1 : 0;
  } catch (e) {
    pip = -1;
  }
  return { recording: recording, pip: pip };
}
