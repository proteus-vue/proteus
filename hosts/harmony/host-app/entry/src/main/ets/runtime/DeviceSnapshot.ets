// hosts/harmony/host-app/entry/src/main/ets/runtime/DeviceSnapshot.ets
// ★★★鸿蒙「设备与系统」域：设备快照采集 + 动作执行 —— 2026-10-19 · 决策 #1067
//
// 【为什么需要本文件（一次性 VM 的结构性约束）】
//   JS 侧设备能力（`capability-app-device.ts`）在 `hostAppRender` 的 napi 调用**内部**同步执行；
//   而设备读数在 ArkTS 的 @ohos.* 模块里、动作是异步 Promise ⇒ 两边都够不着。
//   本文件做两件事：
//     ① `refreshDeviceSnapshot()`：**渲染前**采集同步可读的读数，`setDeviceSnapshot(json)` 交给 C++；
//     ② `drainDeviceActions()`：**渲染后**取走 C++ 入队的动作（震动/亮度/常亮/剪贴板写）并执行。
//
// 【★诚实边界】
//   · 快照是**采集时刻**的读数（不是 JS 读取瞬间）——延迟上界 = 一次渲染间隔；
//   · 动作是**受理后异步执行**（JS 侧拿到 `{accepted:true}` 不代表已生效）；
//   · 亮度是**窗口亮度**（`getWindowProperties().brightness`），不是系统全局亮度；写用
//     `setWindowBrightness`（需窗口权限，失败只记日志——JS 侧已按"已受理"语义返回）。
//   · HEVC：`media.CodecMimeType.VIDEO_HEVC` 只证明**枚举里有**该 MIME；是否硬解取决于设备。
//     如实按"编码类型受支持"汇报（字段名 `supported`，与 Android/iOS 的 MediaCodecList / VideoToolbox 口径
//     不同——三端语义**不粉饰为一致**）。
import { display, window } from '@kit.ArkUI';
// ★各模块所属 kit（实测 API 24 SDK）：deviceInfo/batteryInfo/pasteboard ∈ BasicServicesKit；
//   connection ∈ NetworkKit；vibrator ∈ SensorServiceKit（不是 BasicServicesKit——首版写错，编译会红）。
import { deviceInfo, batteryInfo, pasteboard, BusinessError } from '@kit.BasicServicesKit';
import { connection } from '@kit.NetworkKit';
import { vibrator } from '@kit.SensorServiceKit';
import { media } from '@kit.MediaKit';
import { setDeviceSnapshot, drainDeviceActions } from 'proteus_render';

/** 一次动作（C++ 侧 proteus_device.h 入队的形状） */
interface DeviceAction {
  action: string;
  durationMs?: number;
  text?: string;
  value?: number;
  on?: boolean;
}

/** 采集同步可读读数并交给 C++（渲染前调用；失败不阻断渲染）。 */
export function refreshDeviceSnapshot(win: window.Window | undefined, keyboardHeightVp: number = 0): void {
  try {
    const d: display.Display = display.getDefaultDisplaySync();
    const landscape = d.width > d.height;
    // ★单位 = vp（与 Web 的 CSS px 同义）：width/height 已是 vp（display 的 width/height 单位为 px 物理，
    //   densityPixels 为 vp→px 比例）⇒ vp = px / densityPixels。
    const density: number = d.densityPixels > 0 ? d.densityPixels : 1;
    const widthVp: number = Math.round(d.width / density);
    const heightVp: number = Math.round(d.height / density);
    const rotation: number = d.rotation;
    const angle: number = rotation === 1 ? 90 : rotation === 2 ? 180 : rotation === 3 ? 270 : 0;

    // 网络：读默认网络的传输能力（同步 API）
    let online = false;
    let netType = 'none';
    try {
      const net = connection.getDefaultNetSync();
      const caps = connection.getNetCapabilitiesSync(net);
      const bearers: number[] = caps.bearerTypes ?? [];
      online = bearers.length > 0;
      // NetBearType：0=CELLULAR / 1=WIFI / 2=ETHERNET / 3=VPN
      if (bearers.indexOf(1) >= 0) netType = 'wifi';
      else if (bearers.indexOf(0) >= 0) netType = 'cellular';
      else if (online) netType = 'unknown';
    } catch (e) {
      // 无网络权限/无网络 ⇒ 保持 none（如实）
    }

    // 剪贴板（同步读；非文本类型 ⇒ 空串）
    let clip = '';
    try {
      const pd = pasteboard.getSystemPasteboard().getDataSync();
      clip = pd.getPrimaryText() ?? '';
    } catch (e) {
      clip = '';
    }

    // 电量（batteryInfo 常量：batterySOC 0-100，chargingStatus 枚举）
    const level: number = (batteryInfo.batterySOC ?? 0) / 100;
    const charging: boolean = batteryInfo.chargingStatus === batteryInfo.BatteryChargeState.ENABLE ||
      batteryInfo.chargingStatus === batteryInfo.BatteryChargeState.FULL;

    // 窗口亮度（窗口属性；拿不到 ⇒ 不写字段 ⇒ JS 侧如实 unsupported）
    let brightness: number = -1;
    try {
      if (win !== undefined) brightness = win.getWindowProperties().brightness;
    } catch (e) {
      brightness = -1;
    }

    const payload: Record<string, Object> = {
      'screen': {
        'width': widthVp,
        'height': heightVp,
        'dpr': density,
        'orientation': landscape ? 'landscape' : 'portrait',
      } as Record<string, Object>,
      'info': {
        'platform': 'harmony',
        'model': deviceInfo.marketName ?? deviceInfo.deviceType ?? 'HarmonyOS',
        'os': deviceInfo.osFullName ?? 'HarmonyOS',
        'version': deviceInfo.displayVersion ?? String(deviceInfo.sdkApiVersion ?? ''),
        'browser': 'proteus',
      } as Record<string, Object>,
      'battery': { 'level': level, 'charging': charging } as Record<string, Object>,
      'network': { 'online': online, 'type': netType } as Record<string, Object>,
      'orientation': { 'type': landscape ? 'landscape' : 'portrait', 'angle': angle } as Record<string, Object>,
      'clipboard': clip,
      // ★★决策 #1069：键盘高度（vp）——一次性 VM 无法接收键盘事件 ⇒ 由快照带入
      //   由 C++ 在**本次渲染的 VM** 内调 `__proteusHostKeyboard(...)` 注入（见 host_app_runtime_impl.h）。
      'keyboard': { 'height': keyboardHeightVp, 'visible': keyboardHeightVp > 0 } as Record<string, Object>,
      // ★HEVC：枚举里有该 MIME 即视为"编码格式受支持"（不是硬解能力证明——如实登记差异）
      'hevc': media.CodecMimeType.VIDEO_HEVC === 'video/hevc',
    };
    if (brightness >= 0) payload['brightness'] = brightness;
    setDeviceSnapshot(JSON.stringify(payload));
  } catch (e) {
    // 快照采集失败 ⇒ 不注入（JS 侧按 missing 如实 unsupported）；不阻断渲染
    console.error('PROTEUS_DEVICE_SNAPSHOT_FAIL ' + JSON.stringify(e));
  }
}

/** 取走并执行待处理动作（渲染后调用；逐条异步执行，失败只记日志）。 */
export function runDeviceActions(win: window.Window | undefined): void {
  let raw = '[]';
  try {
    raw = drainDeviceActions();
  } catch (e) {
    return;
  }
  let list: DeviceAction[] = [];
  try {
    list = JSON.parse(raw) as DeviceAction[];
  } catch (e) {
    return;
  }
  if (list.length === 0) return;
  for (const a of list) {
    if (a.action === 'vibrate') {
      try {
        // ★必须显式 usage：系统据此决定是否真的震（无马达/静音策略 ⇒ 系统侧忽略，不报错）
        vibrator.startVibration({
          'type': 'time',
          'duration': Math.max(1, a.durationMs ?? 15),
        }, { 'id': 0, 'usage': 'unknown' }).catch((err: BusinessError) => {
          console.error('PROTEUS_VIBRATE_FAIL ' + JSON.stringify(err));
        });
      } catch (e) {
        console.error('PROTEUS_VIBRATE_THROW ' + JSON.stringify(e));
      }
    } else if (a.action === 'clipboard.write') {
      try {
        const pd = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, a.text ?? '');
        pasteboard.getSystemPasteboard().setData(pd).catch((err: BusinessError) => {
          console.error('PROTEUS_CLIPBOARD_WRITE_FAIL ' + JSON.stringify(err));
        });
      } catch (e) {
        console.error('PROTEUS_CLIPBOARD_WRITE_THROW ' + JSON.stringify(e));
      }
    } else if (a.action === 'brightness.set') {
      if (win !== undefined) {
        win.setWindowBrightness(Math.max(0, Math.min(1, a.value ?? 0.5))).catch((err: BusinessError) => {
          console.error('PROTEUS_BRIGHTNESS_SET_FAIL ' + JSON.stringify(err));
        });
      }
    } else if (a.action === 'keepScreenOn') {
      if (win !== undefined) {
        win.setWindowKeepScreenOn(a.on ?? true).catch((err: BusinessError) => {
          console.error('PROTEUS_KEEP_ON_FAIL ' + JSON.stringify(err));
        });
      }
    }
  }
}
