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
import { vibrator, sensor } from '@kit.SensorServiceKit';
import { media } from '@kit.MediaKit';
// ★★★#1336：本文件此前只用 `console.*`，而**该宿主里 console 不进 hilog 缓冲区**
//   （实测：share 动作执行后 `hilog -x | grep PROTEUS_SHARE` 零命中 ⇒ 无法取证"面板是否真拉起"）。
//   ⇒ 关键动作路径改用 `hilog.info/error`（与 HttpProbe.ets 同款），让 `hdc ... hilog` 可验。
import { hilog } from '@kit.PerformanceAnalysisKit';
// ★★★#1285 C21：拨号盘靠 want 拉起（`ohos.want.action.dial`）⇒ 要 AbilityKit 的 Context/Want 类型
import { common, Want } from '@kit.AbilityKit';
// ★★★#1336 C22：系统分享面板 —— `systemShare` 在 **HMS kit**（`@kit.ShareKit`），
//   不在 `openharmony/ets/api` 下。★这是本次取证纠正的一处错误结论：
//   上一轮记「鸿蒙 SDK 没有 systemShare」是**只搜了 openharmony 目录**导致的误判（"搜不到" ≠ "不存在"）。
import { systemShare } from '@kit.ShareKit';
// ★★★#1384 C84：文档预览 —— `filePreview` 在 **HMS kit**（`@kit.PreviewKit`），
//   同样不在 `openharmony/ets/api` 下（与 #1336 的 systemShare 同一条取证教训）。
//   `fileUri` 用来把沙箱绝对路径转成 `file://` URI（`PreviewInfo.uri` 要 URI 不是路径）。
import { filePreview } from '@kit.PreviewKit';
import { fileUri } from '@kit.CoreFileKit';
import { setDeviceSnapshot, drainDeviceActions } from 'proteus_render';
// ★★决策 #1083：录屏/画中画状态（C71）——快照随设备快照一起交给 C++
import { readCaptureSnapshot, CaptureSnapshotData } from './CaptureSnapshot';

/** 一次动作（C++ 侧 proteus_device.h 入队的形状） */
interface DeviceAction {
  action: string;
  /** ★决策 #1080：传感器动作的 kind（sensor.start / sensor.stop） */
  kind?: string;
  durationMs?: number;
  text?: string;
  value?: number;
  on?: boolean;
  /** ★#1285 `phone.call`：已由 C++ 白名单校验过的号码（只含 0-9 + - ( ) 空格 # * ,） */
  number?: string;
  /** ★#1336 `share`：标题/URL 均已由 C++ 白名单校验（长度上限 + URL 只允许 http/https）
   *  ★正文复用上面的 `text` 字段（与 `clipboard.write` 同名字段，都是"文本载荷"） */
  title?: string;
  url?: string;
  /** ★#1384 `document.open`：沙箱相对路径 + 已由 C++ 推出的 MIME（白名单校验已过） */
  path?: string;
  mimeType?: string;
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

    // ★★决策 #1080：C5 传感器读数（鸿蒙 sensor.on 是订阅式 ⇒ 由本文件的缓存提供；
    //   未 start 过的 kind 不写字段 ⇒ C++ 侧如实回 missing）
    // ★只在有读数时写字段（null 不写 ⇒ C++ 侧如实回 missing，不伪造 0）
    const sensorFields: Record<string, Object> = {};
    const acc = lastSensor('accelerometer');
    if (acc !== null) sensorFields['sensor_accelerometer'] = acc;
    const gyr = lastSensor('gyroscope');
    if (gyr !== null) sensorFields['sensor_gyroscope'] = gyr;
    const cmp = lastSensor('compass');
    if (cmp !== null) sensorFields['sensor_compass'] = cmp;

    // ★#1083：录屏/画中画快照（query 失败 ⇒ 该项 -1，C++ 侧据此不写字段）
    const capture: CaptureSnapshotData = readCaptureSnapshot();
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
      // ★#1083 录屏/画中画：`-1` = 本端查不了 ⇒ **不写该字段**（C++ 侧据此回 missing，不伪造 false；见下方条件赋值）
    };
    if (brightness >= 0) payload['brightness'] = brightness;
    for (const k of Object.keys(sensorFields)) {
      const v = sensorFields[k];
      if (v !== null) payload[k] = v;
    }
    // ★#1083：条件写入（ArkTS 禁对象展开）——`-1` 表示本端查不了 ⇒ 不写字段
    if (capture.recording >= 0) payload['recording'] = capture.recording;
    if (capture.pip >= 0) payload['pip'] = capture.pip;
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
    } else if (a.action === 'sensor.start') {
      startSensor(a.kind ?? 'accelerometer');
    } else if (a.action === 'sensor.stop') {
      stopSensor(a.kind ?? 'accelerometer');
    } else if (a.action === 'keepScreenOn') {
      if (win !== undefined) {
        win.setWindowKeepScreenOn(a.on ?? true).catch((err: BusinessError) => {
          console.error('PROTEUS_KEEP_ON_FAIL ' + JSON.stringify(err));
        });
      }
    } else if (a.action === 'phone.call') {
      /**
       * ★★★#1285 C21：拨号盘唤起。
       *
       * 【★★★为什么是 `viewData` 而不是 `dial`——真机取证推翻了我的第一版】
       *   第一版按 SDK 里存在的 `wantConstant.ACTION_DIAL = 'ohos.want.action.dial'` 写，
       *   真机回执 `startAbility` 失败 `code:16000019`（ABILITY_NOT_FOUND）。
       *   **在设备上取证**（`bm dump -n com.ohos.contacts` 逐 ability 读 skills）：
       *     拨号盘 = `com.ohos.contacts.MainAbility`，
       *     **actions = `['action.system.home', 'ohos.want.action.viewData']`**，
       *     **uris.scheme = `tel`** —— 它**没有**声明 `ohos.want.action.dial`。
       *   再用 `aa start -A ohos.want.action.dial -U 'tel:10086'` 直接验 ⇒ 同样
       *   `Failed to find a matching application for implicit launch`。
       *   ⇒ **常量"存在"≠"有人声明"**：SDK 里有那个常量只说明期望名存在，设备上的拨号器
       *     实现的是通用的 `viewData` + `tel:` scheme。这与本仓「能查询到 ≠ 能解析到」
       *     （#1285 Android 的包可见性）是同一族教训。
       *
       * 【为什么用 startAbility + want，而不是某个"拨号 API"】
       *   鸿蒙没有专属拨号模块 API；拨号盘是系统应用，靠 want 拉起。
       *   ★`uri` 里的号码已由 C++ 白名单校验（只含 0-9 + - ( ) 空格 # * ,）
       *     ⇒ 不会被解析成别的 URI 结构（注入面已封）。
       *
       * 【★语义边界】只是**拉起拨号盘并预填号码**，不发起通话、不需要权限。
       *   ★失败只记日志（与震动/亮度同一"已受理"语义）；这一层的诚实性由
       *     `PROTEUS_PHONE_CALL_FAIL` 日志 + 真机判据（查前台应用）共同保证。
       */
      try {
        const ctx = getContext() as common.UIAbilityContext;
        // ★两个候选都试：先 `viewData`（本机 nova 15 Pro 的拨号器实际声明的），
        //   失败再退 `dial`（`wantConstant.ACTION_DIAL` 的规范名；部分设备/版本可能用它）。
        //   ★不并发、不静默吞：第二个也失败就记 FAIL 日志（判据据此判红）。
        const candidates: Want[] = [
          { action: 'ohos.want.action.viewData', uri: 'tel:' + (a.number ?? '') },
          { action: 'ohos.want.action.dial', uri: 'tel:' + (a.number ?? '') },
        ];
        const tryStart = (i: number): void => {
          if (i >= candidates.length) {
            console.error('PROTEUS_PHONE_CALL_FAIL all-wants-failed');
            return;
          }
          ctx.startAbility(candidates[i]).then(() => {
            console.info('PROTEUS_PHONE_CALL_OK action=' + candidates[i].action);
          }).catch((err: BusinessError) => {
            console.error('PROTEUS_PHONE_CALL_TRY_FAIL action=' + candidates[i].action +
                          ' code=' + JSON.stringify(err));
            tryStart(i + 1);
          });
        };
        tryStart(0);
      } catch (e) {
        console.error('PROTEUS_PHONE_CALL_THROW ' + JSON.stringify(e));
      }
    } else if (a.action === 'share') {
      /**
       * ★★★#1336 C22：系统分享面板（鸿蒙侧）。
       *
       * 【API 出处（本次取证纠正了上一单的错误结论）】
       *   `systemShare.ShareController` 在 **HMS kit** 里，经 `@kit.ShareKit` 导出
       *   （`@hms.collaboration.systemShare.d.ts`，`@since 4.1.0(11)`）。
       *   上一轮选型时记的「鸿蒙 SDK 里没有 systemShare」是**搜错目录**（只搜了
       *   `openharmony/ets/api`，没搜 `hms/ets/api`）⇒ **"搜不到" ≠ "不存在"**。
       *
       * 【为什么走 `systemShare` 而不是自定义 want】
       *   分享面板是系统 UI，`ShareController.show()` 是官方入口；自定义 want 需要自己实现
       *   目标选择 UI 与投递协议（等于重写系统面板，且各接收方兼容性都得上）。
       *
       * 【★语义边界】
       *   `show()` 只**拉起面板**；用户选谁、是否真的发出去由系统决定。
       *   本层失败只记日志（与震动/拨号同一"已受理"语义）——
       *   诚实性由 `PROTEUS_SHARE_FAIL` 日志 + 真机判据（查前台是分享面板）共同保证。
       *
       * 【★ArkTS 约束（本项目实测过的两条）】
       *   ① 不允许裸对象字面量当跨 HAR 接口类型 ⇒ `SharedData`/`SharedRecord` 用具名常量；
       *   ② udi 用 UDMF 标准类型名 `general.plain-text` / `general.hyperlink`（不是 MIME）。
       */
      try {
        const ctx = getContext() as common.UIAbilityContext;
        /* ★★★`SharedData` 构造器只收**单条** record（`constructor(record: SharedRecord)`），
           不是数组——首版传 `SharedRecord[]` 被真编译当场拦下（ArkTS 10505001：
           "Argument of type 'SharedRecord[]' is not assignable to parameter of type 'SharedRecord'"）。
           ★这也说明**C++ 编译门禁不覆盖 ArkTS**：这条错误只有真跑 hvigor 才看得见。 */
        const hasText: boolean = (a.text ?? '') !== '';
        const hasUrl: boolean = (a.url ?? '') !== '';
        const hasTitle: boolean = (a.title ?? '') !== '';
        // 正文优先 text；只有链接时用链接本身（`general.hyperlink` 让系统按链接渲染）
        const body: string = hasText ? (a.text as string) : (a.url ?? '');
        const utd: string = (!hasText && hasUrl) ? 'general.hyperlink' : 'general.plain-text';
        const content: string = body !== '' ? body : (a.title ?? '');
        const seed: systemShare.SharedRecord = { utd: utd, content: content, title: hasTitle ? (a.title as string) : '' };
        const data: systemShare.SharedData = new systemShare.SharedData(seed);
        const controller = new systemShare.ShareController(data);
        controller.on('dismiss', () => {
          hilog.info(0x0000, 'proteus-share', 'PROTEUS_SHARE_DISMISS');
        });
        controller.show(ctx, { previewMode: systemShare.SharePreviewMode.DEFAULT, selectionMode: systemShare.SelectionMode.SINGLE })
          .then(() => {
            hilog.info(0x0000, 'proteus-share', 'PROTEUS_SHARE_OK');
          })
          .catch((err: BusinessError) => {
            hilog.error(0x0000, 'proteus-share', 'PROTEUS_SHARE_FAIL code=%{public}s', JSON.stringify(err) ?? '');
          });
      } catch (e) {
        hilog.error(0x0000, 'proteus-share', 'PROTEUS_SHARE_THROW %{public}s', JSON.stringify(e) ?? '');
      }
    } else if (a.action === 'document.open') {
      /**
       * ★★★#1384 C84：文档预览（鸿蒙侧）。
       *
       * 【API 出处（已取证）】`filePreview` 在 **HMS kit**
       *   `hms/ets/api/@hms.filemanagement.filepreview.d.ts`，经 `@kit.PreviewKit` 导出，
       *   `@since 4.1.0(11)`；本机 SDK API 24。
       *     · `openPreview(context, { uri, mimeType, title? })` → `Promise<void>`
       *     · `canPreview(context, uri)` → `Promise<boolean>`
       *
       * 【★路径 → URI】C++ 已做完沙箱校验（拒绝对路径 / `..` / 非白名单扩展名），
       *   这里把**沙箱相对路径**拼到 `ctx.filesDir` 后用 `fileUri.getUriFromPath()` 转成
       *   `file://` URI —— `PreviewInfo.uri` 要的是 URI，不是文件路径。
       *   ★`getUriFromPath` 是同步的（`@ohos.file.fileuri`），所以这里不引入额外 await 链。
       *
       * 【★为什么先 `canPreview` 再 `openPreview`】
       *   设备上没有对应预览能力时 `openPreview` 会 reject（错误码含义在 ROM 间不稳），
       *   分两步能让失败**有明确归因**（`PROTEUS_DOC_PREVIEW_UNSUPPORTED`），
       *   而不是一个笼统的 THROW —— 判据据此能区分"本机不支持"与"代码坏了"。
       *
       * 【★语义边界】只**拉起预览器**。`openPreview` 的 Promise resolve 只代表"预览器已显示"，
       *   不等待用户关闭，也没有"用户看完了"的回调（与 Android/iOS 同一语义）。
       *   失败只记日志（与震动/拨号/分享同一"已受理"语义）——诚实性由日志 + 真机判据共同保证。
       */
      try {
        const ctx = getContext() as common.UIAbilityContext;
        const rel: string = a.path ?? '';
        const abs: string = ctx.filesDir + '/' + rel;
        /* ★不能用 `return` 提前退出：本函数是整个动作队列的循环，
             一个动作失败不该跳过后面排队的动作（与其它分支一致，只记日志）。
           ⇒ 用 `uri` 是否为空来表达"本动作失败"。 */
        let uri: string = '';
        try {
          uri = fileUri.getUriFromPath(abs);
        } catch (e) {
          hilog.error(0x0000, 'proteus-document', 'PROTEUS_DOC_PREVIEW_URI_FAIL %{public}s', JSON.stringify(e) ?? '');
        }
        if (uri !== '') {
          const info: filePreview.PreviewInfo = {
            uri: uri,
            mimeType: a.mimeType ?? 'application/octet-stream',
            title: a.title ?? '',
          };
          filePreview.canPreview(ctx, uri).then((ok: boolean) => {
            if (!ok) {
              hilog.error(0x0000, 'proteus-document', 'PROTEUS_DOC_PREVIEW_UNSUPPORTED mime=%{public}s',
                a.mimeType ?? '');
              return;
            }
            filePreview.openPreview(ctx, info).then(() => {
              hilog.info(0x0000, 'proteus-document', 'PROTEUS_DOC_PREVIEW_OK mime=%{public}s', a.mimeType ?? '');
            }).catch((err: BusinessError) => {
              hilog.error(0x0000, 'proteus-document', 'PROTEUS_DOC_PREVIEW_FAIL code=%{public}s',
                JSON.stringify(err) ?? '');
            });
          }).catch((err: BusinessError) => {
            hilog.error(0x0000, 'proteus-document', 'PROTEUS_DOC_PREVIEW_CAN_FAIL code=%{public}s',
              JSON.stringify(err) ?? '');
          });
        }
      } catch (e) {
        hilog.error(0x0000, 'proteus-document', 'PROTEUS_DOC_PREVIEW_THROW %{public}s', JSON.stringify(e) ?? '');
      }
    }
  }
}

/* ══════════════════════ C5 传感器（决策 #1080） ══════════════════════ */

/** 最近一次各 kind 的采样（sensor.on 回调写入；refreshDeviceSnapshot 读它进快照） */
const sensorCache: Map<string, Record<string, Object>> = new Map();
/** 正在监听的 kind（start 幂等 / stop 精确取消） */
const sensorActive: Set<string> = new Set();

/** SensorKind → 鸿蒙 SensorId */
function harmonySensorId(kind: string): sensor.SensorId | null {
  if (kind === 'accelerometer') return sensor.SensorId.ACCELEROMETER;
  if (kind === 'gyroscope') return sensor.SensorId.GYROSCOPE;
  // ★鸿蒙无"罗盘"传感器：ORIENTATION 给的是设备朝向（alpha/beta/gamma），
  //   与 Web DeviceOrientation 同族；heading 语义用 alpha（绕 Z 轴，0-360）——如实标注差异
  if (kind === 'compass') return sensor.SensorId.ORIENTATION;
  return null;
}

/** 读缓存（无则 null ⇒ 调用方不写该字段 ⇒ C++ 侧如实 missing） */
function lastSensor(kind: string): Record<string, Object> | null {
  const v = sensorCache.get(kind);
  return v === undefined ? null : v;
}

/**
 * 开始监听（幂等）。
 * ★★诚实边界（一次性 VM）：本 VM 随渲染销毁 ⇒ 监听在此刻注册的 VM 里可能随之失效；
 *   本函数**尽力而为**（同进程的持久监听由 ArkTS 侧维持），缓存跨调用保留（模块级 Map）。
 *   未采集到读数时 C++ 侧回 missing（不伪造）。
 */
function startSensor(kind: string): void {
  if (sensorActive.has(kind)) return;
  const id = harmonySensorId(kind);
  if (id === null) { return; }
  try {
    // ★ArkTS 的 `sensor.on` 是**按 SensorId 逐类型重载**的（联合类型不匹配）⇒ 必须字面量分支。
    // ★每类传感器有**各自的回调接口**（AccelerometerResponse / GyroscopeResponse /
    //   OrientationResponse），不能共用一个宽类型形参——ArkTS 重载按精确类型匹配。
    if (kind === 'accelerometer') {
      sensor.on(sensor.SensorId.ACCELEROMETER, (data: sensor.AccelerometerResponse) => {
        sensorCache.set(kind, { 'kind': kind, 'x': data.x, 'y': data.y, 'z': data.z, 'timestamp': Date.now() });
      });
    } else if (kind === 'gyroscope') {
      sensor.on(sensor.SensorId.GYROSCOPE, (data: sensor.GyroscopeResponse) => {
        sensorCache.set(kind, { 'kind': kind, 'x': data.x, 'y': data.y, 'z': data.z, 'timestamp': Date.now() });
      });
    } else {
      sensor.on(sensor.SensorId.ORIENTATION, (data: sensor.OrientationResponse) => {
        // ★alpha = 绕 Z 轴角度（0-360），与 Web DeviceOrientation.alpha 同族；
        //   与 iOS 的 yaw 归一口径一致（如实标注：三端罗盘语义不完全相同）
        sensorCache.set(kind, { 'kind': kind, 'heading': data.alpha, 'timestamp': Date.now() });
      });
    }
    sensorActive.add(kind);
  } catch (e) {
    console.error('PROTEUS_SENSOR_START_FAIL ' + JSON.stringify(e));
  }
}

/** 停止监听（幂等）。 */
function stopSensor(kind: string): void {
  if (!sensorActive.has(kind)) return;
  const id = harmonySensorId(kind);
  try {
    if (kind === 'accelerometer') { sensor.off(sensor.SensorId.ACCELEROMETER); }
    else if (kind === 'gyroscope') { sensor.off(sensor.SensorId.GYROSCOPE); }
    else { sensor.off(sensor.SensorId.ORIENTATION); }
  } catch (e) {
    console.error('PROTEUS_SENSOR_STOP_FAIL ' + JSON.stringify(e));
  }
  sensorActive.delete(kind);
}
