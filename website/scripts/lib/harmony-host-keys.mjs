// website/scripts/lib/harmony-host-keys.mjs
// ★★鸿蒙宿主「真接线」派生（生成器 ↔ 源码 的显式契约 · 第二份）—— 2026-10-19 · 决策 #1067
//
// 【为什么需要（本轮实证的"文档说谎"形态，方向与 #881 相反）】
//   `app-bridge-keys.mjs` 只能证明**JS 桥有这个方法**（App 三端共享同一份平台中立 TS）⇒
//   鸿蒙列此前一律写「App 桥已就绪（平台中立）——鸿蒙宿主壳未接线」。
//   本轮把设备与系统域 12 项真的落到了鸿蒙宿主（`proteus_device.h` + ArkTS 快照）后，
//   那句话就**从"保守"变成"说谎"**——代码做了、文档仍报未接线。
//   ⇒ 本模块从**宿主源码**派生「鸿蒙到底认哪些方法」，让该列按事实分档。
//
// 【做法（两侧都是源码事实）】
//   ① 用 `ts-source-scan.mjs::returnObjectMembers` 抽 `createAppDeviceCapabilities` **返回对象的方法名**
//      ——那才是能力页 `refs` 用的**真实桥方法名**（★不是 `APP_DEVICE_METHODS` 的键：那边是内部标签，
//      `info` 对应的桥方法叫 `getDevice`——本条是本模块首版踩过的坑）；
//   ② `BRIDGE_TO_HOST` 显式登记每个桥方法 → 宿主方法名（`null` = 该桥方法**不由宿主回答**：
//      纯 JS 实现或壳推通道 ⇒ 留在 🟡。这类映射纯文本推不出来，写死并在此登记是唯一诚实的做法）；
//   ③ 从鸿蒙宿主 C++ 源码扫已实现的方法名（`method == "device.xxx"` 等形态）；
//   ④ 三者交集 = 鸿蒙**真的回答得了**的桥方法集。
//
// 【★硬失败（不静默）】返回对象里出现了 `BRIDGE_TO_HOST` 未登记的桥方法 ⇒ 抛错。
//   否则新增的桥方法会**永远**在文档上显示 🟡（代码做了、文档不认），正是本轮要消灭的形态。
//
// 【诚实边界】本模块只覆盖设备与系统域（`capability-app-device.ts`）。其余能力族在鸿蒙落地时，
//   须把对应工厂/映射登记进来——**不登记 = 文档保守标 🟡**（宁可少说，不多说）。

import fs from 'node:fs'
import path from 'node:path'
import { maskNonCode, returnObjectMembers } from './ts-source-scan.mjs'

/** 承载设备域桥的工厂函数（`packages/api/src/capability-app-device.ts`）。 */
export const DEVICE_BRIDGE_FACTORY = 'createAppDeviceCapabilities'

/**
 * 桥方法 → 鸿蒙宿主方法名。`null` = **不由宿主回答**（纯 JS / 壳推通道），页面保持 🟡。
 * ★新增设备域桥方法必须在此登记（否则本模块硬失败）。
 */
export const BRIDGE_TO_HOST = {
  vibrate: 'device.vibrate',
  getNetwork: 'device.network',
  readClipboard: 'clipboard.read',
  setClipboard: 'clipboard.write',
  getScreen: 'device.screen',
  getDevice: 'device.info',
  getBattery: 'device.battery',
  getOrientation: 'device.orientation',
  getBrightness: 'device.brightness.get',
  setBrightness: 'device.brightness.set',
  setKeepScreenOn: 'device.keepScreenOn',
  getDeviceCapability: 'device.hevc',
  // ★★决策 #1080（补齐 #1081 门禁抓出的漏登记）：C5 传感器三条直连宿主方法；
  //   `subscribeSensor` 是**纯 JS**（订阅本地回调集合，采样经壳推 `__proteusHostSensor`）
  //   ⇒ 不由宿主方法回答 ⇒ null（与 getKeyboard 同类：推送证据不在"method 分支"里）。
  readSensor: 'device.sensor.read',
  startSensor: 'device.sensor.start',
  stopSensor: 'device.sensor.stop',
  subscribeSensor: null,
  // ★不由宿主**方法分派**回答（两条都走专门通道判定，见下方 KEYBOARD_PUSH_SOURCES）：
  //   · getKeyboard：壳**主动推** `__proteusHostKeyboard`——是否有推送能力要读**壳源码**，
  //     不是读"宿主有没有某个 method 分支"。三端此前都只有 JS 接收侧、没人推（决策 #1069 修）。
  //   · createMediaQuery：纯 JS 求值（但读 `device.screen`；本模块按"桥方法级"判定，故不长绿）
  getKeyboard: null,
  createMediaQuery: null,
}

/**
 * ★★★决策 #1081：**元素查询域**的桥工厂与方法映射（`capability-app-element.ts`）。
 *   `createElementQuery` → 宿主 `element.rect`（三端都实现了：Android `ElementRectProbe` /
 *   iOS `element-rect.swift` / 鸿蒙 `host_app_runtime_impl.h`）。
 *   `createIntersection` → `null`：桥方法存在但**如实不支持**（缺帧级几何变化事件源）⇒ 页面保持 🟡。
 */
export const ELEMENT_BRIDGE_FACTORY = 'createAppElementBridge'
export const ELEMENT_BRIDGE_TO_HOST = {
  createElementQuery: 'element.rect',
  createIntersection: null,
}

/**
 * ★★★决策 #1083：**录屏 / 截屏状态**域（C71）。
 *   `getScreenCapture` → 宿主 `device.capture`（三端都实现了；**各端能查的字段不同**）。
 *   ★字段级诚实边界（方法级本表判 ✅）：Android 无公开录屏查询、iOS 无全局 PiP 查询、
 *     鸿蒙无用户截屏事件——差异在能力页正文与桥的 unsupported 分档里如实体现。
 */
export const CAPTURE_BRIDGE_FACTORY = 'createAppCaptureCapabilities'
export const CAPTURE_BRIDGE_TO_HOST = {
  getScreenCapture: 'device.capture',
}

/**
 * ★★★决策 #1163：**网络域**（C26 `useFetch`）的桥工厂与方法映射。
 *
 * 【为什么必须登记（用户实测："鸿蒙怎么一直都是未接线状态"）】
 *   `request` 是 `createAppNativeCapabilities` 的返回成员，而该工厂**从未登记**在
 *   `HARMONY_BRIDGE_SOURCES` 里 ⇒ `harmonyEndStatus` 连"鸿蒙认不认这个桥方法"都无从判定
 *   ⇒ fetch 页永远 🟡「App 桥已就绪——鸿蒙宿主壳未接线」。
 *   而事实上鸿蒙宿主**早就实现了**（`proteus_http.h` 的 `handle()`，经 `invoke_bytes_bridge.h`
 *   的 `if (f.method == "http.request")` 分派，真机 `run-transport-probe.sh` 跑通过）。
 *   ⇒ 这是「代码做了、文档不认」的形态，与被 #1067 修掉的那批同源。
 *
 * ★诚实边界（逐条写清，不做统一 ✅）：
 *   · `request` → `http.request`：**已接线**（真机取证：h2/1.1 协商、3 请求/1 连接、体长/Content-Type）；
 *   · `request` 之外的网络语义（取消/传输读数）走**独立方法**，鸿蒙当前**未实现**：
 *     `http.cancel` / `http.cancelStats` / `http.tlsStats` 在鸿蒙源码里查无分派
 *     ⇒ JS 侧 `abort` 在鸿蒙上**只 reject 本地**、宿主传输不停（`capability-invoke.ts:441` 已如实登记）。
 *     ★这几条**不登记为 null 蒙混**：它们是真实缺口，已登记为独立任务（`T-harmony-http-cancel`）。
 */
/** ★#1239：KV 存储（#1209）的桥成员 → 鸿蒙宿主方法（经 `proteus_fs.h` 的 `dispatch`）*/
export const APP_KV_FACTORY = 'createAppFileStorage'
export const APP_KV_TO_HOST = { getStorage: 'fs.readBytes' }   // KV 落盘用 fs.readBytes/writeBytes/remove

/** ★#1239：日志（#1225）的桥成员 → 鸿蒙宿主方法 */
export const APP_LOG_FACTORY = 'createAppLog'
export const APP_LOG_TO_HOST = { log: 'log' }

/** ★#1239：文件系统（#1226~#1232）的桥成员 → 鸿蒙宿主方法 */
export const APP_FS_FACTORY = 'createAppFileSystem'
export const APP_FS_TO_HOST = {
  getFileSystem: 'fs.exists',   // 基础面以 fs.exists 为代表（read/write/remove 同一分派）
}

export const NATIVE_BRIDGE_FACTORY = 'createAppNativeCapabilities'
export const NATIVE_BRIDGE_TO_HOST = {
  request: 'http.request',
  // ★以下成员在鸿蒙宿主里**没有**对应分派（如实 null ⇒ 页面保持 🟡，不假装 ✅）：
  //   navigateMiniProgram / getHostContext / loadExtension / getUpdateManager / createWorker /
  //   getPreload / getIdle / getWindow / getNavigationGuard / getWebAssembly
  //   —— 它们不属 fetch 能力页的 refs，登记 null 只为让"未登记 ⇒ 硬失败"的判据通过。
  navigateMiniProgram: null,
  getHostContext: null,
  loadExtension: null,
  getUpdateManager: null,
  createWorker: null,
  getPreload: null,
  getIdle: null,
  getWindow: null,
  getNavigationGuard: null,
  getWebAssembly: null,
}

/**
 * 参与鸿蒙分档的**全部**桥源（新增域必须登记——否则该域在文档上永远 🟡）。
 * ★map 的值类型显式写 `Record<string, string | null>`：`null` = 该桥方法不由宿主方法回答
 *   （纯 JS 或壳推通道）。不标注的话两个 map 的字面量形状不同，数组元素会被推成联合类型，
 *   消费方读 `.map[...]` 时类型对不上（vue-tsc 实测）。
 * @type {Array<{file: string, factory: string, map: Record<string, string | null>}>}
 */
/** ★#1285：拨号（C21）的桥成员 → 鸿蒙宿主方法
 *  ★真机取证（2026-10-27）：`proteus_device.h` 的 `isDeviceMethod` + 分派里有 `phone.call`；
 *    实际拉起由 ArkTS `DeviceSnapshot.ets` 的 `runDeviceActions` 执行
 *    —— 用 `ohos.want.action.viewData` + `tel:` scheme（**不是** `ohos.want.action.dial`，
 *    本机 nova 15 Pro 的拨号器没声明那个 action，真机报 `16000019 ABILITY_NOT_FOUND`）。 */
export const APP_PHONE_FACTORY = 'createAppPhone'
export const APP_PHONE_TO_HOST = { makePhoneCall: 'phone.call' }

/** ★#1336：系统分享面板（C22）的桥成员 → 鸿蒙宿主方法
 *  ★真机取证（2026-10-28）：`proteus_device.h` 的 `isDeviceMethod` + 分派里有 `share`（走动作队列）；
 *    实际拉起由 ArkTS `DeviceSnapshot.ets` 的 `runDeviceActions` 执行
 *    —— 用 `systemShare.ShareController.show(ctx, …)`（HMS `@kit.ShareKit`，API 11+）。
 *    设备日志 `PROTEUS_SHARE_OK` 已取证（`hosts/harmony/run-share-probe.sh` 11/11）。 */
export const APP_SHARE_FACTORY = 'createAppShare'
export const APP_SHARE_TO_HOST = { share: 'share' }

export const HARMONY_BRIDGE_SOURCES = [
  { file: 'packages/api/src/capability-app-device.ts', factory: DEVICE_BRIDGE_FACTORY, map: BRIDGE_TO_HOST },
  { file: 'packages/api/src/capability-app-element.ts', factory: ELEMENT_BRIDGE_FACTORY, map: ELEMENT_BRIDGE_TO_HOST },
  { file: 'packages/api/src/capability-app-capture.ts', factory: CAPTURE_BRIDGE_FACTORY, map: CAPTURE_BRIDGE_TO_HOST },
  // ★#1163：网络域（request → http.request）
  { file: 'packages/api/src/capability-app.ts', factory: NATIVE_BRIDGE_FACTORY, map: NATIVE_BRIDGE_TO_HOST },
  // ★#1239：批 1 新落地的三个域（KV 存储 / 日志 / 文件系统）——不登记则永远 🟡
  { file: 'packages/api/src/capability-app-storage.ts', factory: APP_KV_FACTORY, map: APP_KV_TO_HOST },
  { file: 'packages/api/src/capability-app-log.ts', factory: APP_LOG_FACTORY, map: APP_LOG_TO_HOST },
  { file: 'packages/api/src/capability-app-filesystem.ts', factory: APP_FS_FACTORY, map: APP_FS_TO_HOST },
  // ★#1285：拨号域（makePhoneCall → phone.call）——不登记则永远 🟡
  { file: 'packages/api/src/capability-app-phone.ts', factory: APP_PHONE_FACTORY, map: APP_PHONE_TO_HOST },
  // ★#1336：分享域（share → share）——不登记则永远 🟡（代码做了、文档不认，与 #1285 同族）
  { file: 'packages/api/src/capability-app-share.ts', factory: APP_SHARE_FACTORY, map: APP_SHARE_TO_HOST },
]

/** 鸿蒙宿主里承载能力分发的源码（新增承载文件必须登记——否则该能力在文档上永远 🟡）。 */
export const HARMONY_HOST_SOURCES = [
  'hosts/harmony/host-app/proteus_render/src/main/cpp/host_app_runtime_impl.h',
  'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_device.h',
  // ★#1239：日志（`log` 分派在 impl 里一行，实现在 proteus_log.h）· fs.*（proteus_fs.h 的 dispatch）
  'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_log.h',
  'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_fs.h',
  // ★★★#1163：**字节桥是网络能力的真实分派点**——`http.request` 的分支在这里
  //   （`if (f.method == "http.request") proteus::http::handle(f)`），
  //   而实现体在 `proteus_http.h`。两份都登记：
  //   · 分派形态 `f.method == "..."` 与 `method == "..."` 不同 ⇒ 抽取器已同时支持；
  //   · `proteus_http.h` 里的追加证据是 `f.method = "http.request"`（探针构造帧），
  //     不作为"已实现"的主要证据，登记它是为了让 grep 能定位实现。
  'hosts/harmony/host-app/proteus_render/src/main/cpp/invoke_bytes_bridge.h',
  'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http.h',
]

/**
 * 从宿主 C++ 源码抽出**已实现的方法名字面量**。
 *
 * ★#1163 更正：此前以为字节桥的 `if (f.method == "http.request")` 需要额外正则——
 *   **实测不需要**：`/method\s*==\s*"…"/` 对 `f.method == "…"` 同样命中（`.` 只是前一字符）。
 *   fetch 页原先报 🟡 的真因是**两处清单没登记**（`createAppNativeCapabilities` 未进
 *   `HARMONY_BRIDGE_SOURCES`、`invoke_bytes_bridge.h` 未进 `HARMONY_HOST_SOURCES`），
 *   不是抽取器不认形态。⇒ 保留一个正则即可，不写冗余分支（写了会让"变异测试打不红"）。
 */
export function extractHarmonyHostMethods(src) {
  const out = new Set()
  for (const m of src.matchAll(/method\s*==\s*"([^"]+)"/g)) out.add(m[1])
  for (const m of src.matchAll(/method\s*==\s*std::string\("([^"]+)"\)/g)) out.add(m[1])
  return out
}

/**
 * 加载：返回鸿蒙**真的回答得了**的桥方法名集合。
 * @param {string} root 仓库根
 * @returns {{keys:Set<string>, bridgeMethods:string[], hostMethods:Set<string>, misses:string[]}}
 */
export function loadHarmonyBridgeKeys(root) {
  const misses = []
  /** 全部桥源的方法名（并集；用于"鸿蒙认不认这个桥方法"的交集判定） */
  let bridgeMethods = []
  for (const source of HARMONY_BRIDGE_SOURCES) {
    const abs = path.join(root, source.file)
    if (!fs.existsSync(abs)) {
      misses.push(`缺 ${source.file}（数据源缺失 = 硬失败）`)
      continue
    }
    const masked = maskNonCode(fs.readFileSync(abs, 'utf8'))
    const { names, miss } = returnObjectMembers(masked, source.factory)
    if (miss) { misses.push(miss); continue }
    bridgeMethods = bridgeMethods.concat(names)
    // ★硬失败（不静默）：新增桥方法而忘了登记 ⇒ 文档永远 🟡（代码做了、文档不认）
    const unregistered = names.filter((n) => !(n in source.map))
    if (unregistered.length) {
      misses.push(
        `${source.file}：桥方法未登记主机映射：${unregistered.join(', ')}（新增桥方法必须登记，否则文档永远标 🟡）`,
      )
    }
  }
  const hostMethods = new Set()
  for (const rel of HARMONY_HOST_SOURCES) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) { misses.push(`缺鸿蒙宿主源 ${rel}`); continue }
    for (const m of extractHarmonyHostMethods(fs.readFileSync(abs, 'utf8'))) hostMethods.add(m)
  }
  const keys = new Set()
  for (const bridge of bridgeMethods) {
    // ★同一桥方法名可能在多个域出现（当前没有）；按**先登记的域**取映射（与源码阅读顺序一致）
    const map = HARMONY_BRIDGE_SOURCES.find((x) => bridge in x.map)?.map ?? {}
    const host = map[bridge]
    if (host && hostMethods.has(host)) keys.add(bridge)
  }
  return { keys, bridgeMethods, hostMethods, misses }
}

/**
 * ★★★「壳主动推」类通道的**源码证据**（决策 #1069）——键盘是第一个消费者。
 *
 * 【为什么不能用桥方法判】\`getKeyboard\` 的实现是"返回一个订阅句柄"，任何端只要装了 JS 侧通道
 *   就**看起来**有这个方法——而高度恒为 0。本轮实测：三端都只装了接收侧、**没有一端真的推**，
 *   官网却因为"桥方法存在"判了 ✅。⇒ 这类能力必须按**壳里有没有推送代码**判。
 *
 * 【判据（每端一条真实的推送调用形态）】
 *   · Android：\`SuperappActivity\` 里出现 \`__proteusHostKeyboard\`（eval 推送）+ \`ime()\` insets 监听
 *   · iOS：\`superapp-scene.swift\` 里出现 \`__proteusHostKeyboard\` + \`keyboardWillShowNotification\`
 *   · 鸿蒙：\`Superapp.ets\` 里有 \`keyboardHeightChange\` 监听，且 C++ 在 VM 内注入（\`invokeKeyboardSnapshot\`）
 *
 * 【诚实边界】鸿蒙是**一次性 VM**（#540）⇒ 键盘事件到达时无存活 JS 环境，只能"下次渲染时注入一次"
 *   ——与 Android/iOS 的即时推**语义不同**（如实记账，不粉饰为一致）。
 */
export const KEYBOARD_PUSH_SOURCES = {
  // ★2026-10-19（#1082）：实现已由 #1075 抽到 `runtime/KeyboardWatcher.java`——
  //   证据必须跟到**实现所在文件**（只判壳会误报"未推送"：#1075 之后此处一直红）。
  android: [
    { file: 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/KeyboardWatcher.java', tokens: ['Type.ime()', '__proteusHostKeyboard'] },
    { file: 'hosts/android/app/src/main/java/dev/proteus/layoutcore/shell/SuperappActivity.java', tokens: ['KeyboardWatcher.install'] },
  ],
  ios: [
    // 推送实现与装配点**两处都要**（只判装配会漏"装了但实现没推"，只判实现会漏"实现了但没人装"）
    { file: 'hosts/ios/ProteusHost/shell/superapp-scene.swift', tokens: ['KeyboardWatch.install'] },
    { file: 'hosts/ios/ProteusHost/runtime/keyboard-watch.swift', tokens: ['__proteusHostKeyboard', 'keyboardWillShowNotification'] },
  ],
  harmony: [
    { file: 'hosts/harmony/host-app/entry/src/main/ets/shell/Superapp.ets', tokens: ['keyboardHeightChange'] },
    { file: 'hosts/harmony/host-app/proteus_render/src/main/cpp/host_app_runtime_impl.h', tokens: ['invokeKeyboardSnapshot', '__proteusHostKeyboard'] },
  ],
}

/**
 * 该端是否**真的会推**键盘事件（读源码，不看文档、不看桥方法）。
 * @param {string} root 仓库根
 * @param {'android'|'ios'|'harmony'} end
 * @returns {boolean}
 */
export function hasKeyboardPush(root, end) {
  const specs = KEYBOARD_PUSH_SOURCES[end]
  if (!specs) return false
  for (const spec of specs) {
    const abs = path.join(root, spec.file)
    if (!fs.existsSync(abs)) return false
    const src = fs.readFileSync(abs, 'utf8')
    if (!spec.tokens.every((t) => src.includes(t))) return false
  }
  return true
}


/**
 * 鸿蒙端在能力页上的分档（生成器唯一的鸿蒙判定入口）。
 *
 * 【为什么放在 lib 而不是 gen-content.mjs】后者是存量棘轮文件（只减不增）——把 20 行判定
 *   塞回去会被 `check:file-size` 判红；而"能力页怎么描述鸿蒙"本就属本模块职责。
 *
 * @param {string} root 仓库根
 * @param {string[]} refs 该能力页引用的桥方法名（空 = 该能力不依赖桥方法）
 * @param {Set<string>} appBridgeKeys App 桥全集（平台中立 TS）
 * @param {boolean} en 英文文案
 * @returns {{status:string, note:string}}
 */
export function harmonyEndStatus(root, refs, appBridgeKeys, en = false) {
  const r = loadHarmonyBridgeKeys(root)
  if (r.misses.length) throw new Error('[harmony-host-keys] ' + r.misses.join('；'))
  if (refs.length && refs.every((k) => r.keys.has(k))) {
    // ★★★#1163：说明要指出**真实的分派文件**，不能笼统写"宿主已接线"——
    //   网络能力的分派在 `invoke_bytes_bridge.h`（`f.method == "http.request"`），
    //   不在 scre/device 那两个文件里。按 refs 的实际宿主方法反查源文件。
    const hosts = refs.map((k) => HARMONY_BRIDGE_SOURCES.find((x) => k in x.map)?.map[k]).filter(Boolean)
    const files = new Set()
    for (const h of hosts) {
      for (const rel of HARMONY_HOST_SOURCES) {
        const src = fs.readFileSync(path.join(root, rel), 'utf8')
        if (src.includes(`"${h}"`)) files.add(path.basename(rel))
      }
    }
    const where = files.size ? [...files].join(' / ') : 'host'
    /**
     * ★★★#1165：网络域的 ✅ 必须带**真机证据**与**真实的调度语义差异**，否则 ✅ 会被读成"三端一致"。
     *
     * 【★本轮更正了 #1163 的一处错误描述（重要）】
     *   #1163 写的是「`http.cancel` 未实现 ⇒ `abort()` 只 reject 本地、宿主传输不停」——
     *   **前半句对、后半句错**。取证（`capability-invoke.ts:853-885` + `proteus_http.h` 头注）：
     *     · 鸿蒙 `handle()` 是**同步阻塞**（一次性 VM：napi 返回时 VM 已销毁，异步回推没有接收方）；
     *     · JS 侧 `invokeHostAsyncBytes` 也是 `out = fn(frame)` **同步取结果**；
     *     · ⇒ 请求进行中 JS 线程**被占**，`signal.onabort` 根本**没有机会执行**
     *       （而且 App 精简引擎无 `setTimeout`，也没法"稍后取消"）。
     *   ⇒ 准确说法：**鸿蒙上 `abort()` 是 no-op（连 JS 侧 reject 都不会发生）**，
     *     而**不存在"后台还在下载"**——因为没有后台：请求就在调用线程里同步跑完。
     *     鸿蒙上"别等太久"的手段是 **`timeout`**（宿主有界等待），不是 `abort()`。
     *   ★为什么必须改这一段：#1163 的写法会让业务以为"取消至少能 reject"，去写 `try { abort() }` 兜底；
     *     而真实是"取消什么都不做，请求照常返回成功"。**夸大与贬低都是假信息。**
     */
    const isNet = hosts.includes('http.request')
    /**
     * ★★★#1187：网络域的 ✅ 必须带**三处受限**（否则 ✅ 会被读成"三端一致"）。
     *   · `abort()` no-op（一次性 VM + 同步 napi）⇒ 用 `timeout`；
     *   · `stream: true` **如实拒绝**（`fetch.unsupported`，因为 onChunk 无法回推）⇒ 用 `savePath`；
     *   · SPKI pinning **未接**（RCP 只提供 CA 配置，不做 fingerprint 校验）。
     *   ★这三条各有判据守着：`tests/harmony-http-gaps.test.ts`。
     */
    const netNote = en
      ? 'device-verified (transport-probe 3/3 200 · 3 req/1 conn; fetch-limit both gates → `fetch.tooLarge`); ' +
        '**#1344 session VM brings real cancel & streaming**: `abort()` → host `hostCancelCalls=1`, transport ends 2ms after abort (a 10s slow response is really cut); ' +
        '`stream: true` → 8 chunks × 4096B delivered one by one, `seq` contiguous, `spreadMs=433` (chunks arrive over time, not all at the end); ' +
        '**two honest boundaries**: ① cancel/stream availability **depends on call shape** — **session mode** works, while the **one-shot VM production path** keeps the old semantics (`abort()` is a no-op, `stream` honestly rejected) ⇒ on that path use `timeout` / `savePath`; ' +
        '② **SPKI pinning not wired** (RCP exposes CA config only, no fingerprint verification)'
      : '真机已验证（transport-probe 3/3 200 · 3 请求/1 连接 · fetch-limit 两道闸均 `fetch.tooLarge`）· ' +
        '★★★**#1344 会话式 VM 起：`abort()` 与 `stream` 均已真机打通**——取消：`hostCancelCalls=1` + 传输在 abort 后 2ms 结束（慢响应 10s 被真的掐断）；' +
        '流式：8 块 × 4096B 逐块到达、`seq` 连续、`spreadMs=433`（块陆续到而非末尾整包）· ' +
        '★**两处诚实边界**：① **`abort()` / `stream` 的可用性取决于调用形态**——**会话模式**（当前宿主已验证的形态）真取消 + 真流式；' +
        '**一次性 VM 生产路径仍是旧语义**（同步 napi 期间 JS 无执行机会，连本地 reject 都不会发生）⇒ 那条路径要限时请用 `timeout`、要边收边处理请用 `savePath`；' +
        '② **SPKI pinning 未接**（RCP 只提供 CA 配置，不做 fingerprint 校验）⇒ 本端 pin 不生效，请勿据此判断安全策略已成立'
    return {
      status: '✅',
      note: en ? `Harmony host wired (${where})${isNet ? ' · ' + netNote : ''}` : `鸿蒙宿主已接线（${where}）${isNet ? ' · ' + netNote : ''}`,
    }
  }
  if (refs.length && refs.every((k) => appBridgeKeys.has(k))) {
    return {
      status: '🟡',
      note: en
        ? 'App bridge ready (platform-neutral TS) — Harmony host shell not wired'
        : 'App 桥已就绪（平台中立）——鸿蒙宿主壳未接线',
    }
  }
  return {
    status: '🟡',
    note: en ? 'render core shipped — capability bridge not wired' : '渲染核心已落地——能力桥未接线',
  }
}

/**
 * ★★★「壳主动推」类能力的端分档（决策 #1069）——键盘是第一个消费者。
 *
 * 【为什么必须有这条】`getKeyboard` 这类桥方法只返回"订阅句柄"，**任何端装了 JS 侧通道就长得像有**；
 *   而高度要靠壳主动推。本轮实测：三端都只装了接收侧、**没有一端真的推**，
 *   官网却因"桥方法存在"判了 ✅（对外谎报可用）。⇒ 判据必须读**壳里有没有推送代码**。
 *
 * @param {string} root 仓库根
 * @param {'android'|'ios'|'harmony'} end 端
 * @returns {{supported:boolean, note:string}}
 */
export function pushChannelStatus(root, end) {
  const ok = hasKeyboardPush(root, end)
  const label = {
    android: ok ? '壳推送已接线（WindowInsets.ime → __proteusHostKeyboard）' : '壳未推键盘事件——高度恒 0',
    ios: ok ? '壳推送已接线（UIKeyboard 通知 → __proteusHostKeyboard）' : '壳未推键盘事件——高度恒 0',
    harmony: ok
      ? '壳推送已接线（keyboardHeightChange → 渲染时注入；一次性 VM ⇒ 非即时推送）'
      : '壳未推键盘事件——高度恒 0',
  }[end]
  return { supported: ok, note: label }
}

/**
 * ★★★App 三端（iOS/Android/鸿蒙）能力分档的**唯一判定入口**（决策 #1067/#1069）。
 *
 * 【为什么收在 lib】\`gen-content.mjs\` 是存量棘轮文件（只减不增）；分档规则越写越长，
 *   留在生成器里只能靠"每次压缩注释"换行数。判定属"文档契约"职责，放 lib 更合适。
 *
 * @param {string} root 仓库根
 * @param {'ios'|'android'|'harmony'} end
 * @param {string[]} refs 该能力页引用的桥方法名
 * @param {Set<string>} appBridgeKeys App 桥全集（平台中立 TS）
 * @param {{capSlug:string, pushCapabilities:Set<string>, verified:Set<string>, en?:boolean}} opts
 * @returns {{status:string, note:string}}
 */
export function appEndStatus(root, end, refs, appBridgeKeys, opts) {
  const { capSlug, pushCapabilities, verified, en = false } = opts
  const hasBridge = refs.length > 0 && refs.every((r) => appBridgeKeys.has(r))
  if (end === 'harmony') {
    // ★推送型能力（决策 #1069）：鸿蒙走**快照注入**、不走宿主方法分派 ⇒ 不能靠
    //   `harmonyEndStatus`（它按"有没有 method 分支"判）。先按**推送证据**判，再回落三档。
    if (pushCapabilities.has(capSlug) && refs.length && appBridgeKeys.has(refs[0])) {
      const p = pushChannelStatus(root, 'harmony')
      if (!p.supported) return { status: '🟡', note: en ? PUSH_MISS_EN : p.note }
      return { status: '✅', note: en ? 'Harmony host wired (keyboard height injected per render)' : '鸿蒙宿主已接线（键盘高度随渲染注入）' }
    }
    return harmonyEndStatus(root, refs, appBridgeKeys, en)
  }
  if (!hasBridge) {
    return {
      status: '🟡',
      note: en ? 'render core shipped — capability bridge not wired' : '渲染核心已落地——能力桥未接线',
    }
  }
  if (pushCapabilities.has(capSlug)) {
    const p = pushChannelStatus(root, end)
    if (!p.supported) return { status: '🟡', note: en ? PUSH_MISS_EN : p.note }
    return {
      status: '✅',
      note: en
        ? 'App host bridge (capability-app.ts) · shell pushes keyboard events'
        : `App 宿主桥（capability-app.ts）· ${p.note}`,
    }
  }
  // ★#1092：JS 桥有方法还不够——宿主源码里必须真的有对应分派（否则桥写了、壳没实现会被标 ✅）。
  //   纯 JS 桥成员（查不到宿主方法名）不算缺：导航守卫 / 键盘推送 / 媒体查询求值等本就在 JS 侧。
  const ev = appHostEvidence(root, end, refs)
  if (!ev.ok) {
    return {
      status: '🟡',
      note: en
        ? `App bridge present but the host has no dispatch for ${ev.missing.join('/')} — capability bridge not wired`
        : `App 桥有该方法，但宿主未实现 ${ev.missing.join('/')} 的分派 → 能力桥未接线`,
    }
  }
  if (en) {
    return {
      status: '✅',
      note: `App host bridge (capability-app.ts) · ${verified.has(capSlug) ? 'device-verified on both ends (check:host-runtime)' : 'bridge method wired'}`,
    }
  }
  return {
    status: '✅',
    note: `App 宿主桥（capability-app.ts）· ${verified.has(capSlug) ? '真机双端验证（check:host-runtime）' : '桥方法已接入'}`,
  }
}

/** 推送型能力缺壳推送时的英文说明（与中文口径对齐）。 */
export const PUSH_MISS_EN = 'host bridge present but the shell does not notify the keyboard — height stays 0'

// ══════════════════════════════════════════════════════════════════
// App 端（iOS/Android）「宿主证据」判定（#1092）
//   ★#1090 只管 Web/MP 的"纯空壳"；App 端仍只看「JS 桥工厂里有这个方法名」。
//   用户追问口径后实测：30 个 ✅ 里 **29 个**在宿主源码里找得到对应分派
//   （唯一例外是 iOS webassembly——JSC 内建，契约里已是合法省略）。
//   ⇒ 把"宿主真的实现了"变成判据，而不是靠人工核对。
//
//   ★判定两步（缺一不可）：
//     ① 桥方法 → 宿主方法名：扫 App 桥工厂体内的 `invokeHost('x.y')` / `APP_*_METHODS.k`
//        （后者查常量表）+ 三张显式表（设备/元素/录屏域）。
//     ② 宿主方法名 → 该端源码里有没有分派（四种形态，与 check:host-invoke-contract 同一套）。
//   ★纯 JS 桥成员（查不到任何宿主方法名）**不算缺**——它们本来就在 JS 侧实现
//     （navigation-guard / 键盘推送 / media-query 求值等）。
// ══════════════════════════════════════════════════════════════════

/** 桥成员 → 宿主方法名（扫工厂体 + 常量表 + 显式映射；带缓存）。 */
const bridgeHostMapCache = new Map()

function bridgeHostMap(root) {
  if (bridgeHostMapCache.has(root)) return bridgeHostMapCache.get(root)
  const files = [
    'packages/api/src/capability-app.ts',
    'packages/api/src/capability-app-device.ts',
    'packages/api/src/capability-app-element.ts',
    'packages/api/src/capability-app-capture.ts',
  ]
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
  const tables = {}
  for (const f of files) {
    const src = read(f)
    for (const m of src.matchAll(/export const (\w+)\s*=\s*\{([\s\S]*?)\}\s*as const/g)) {
      const t = {}
      for (const kv of m[2].matchAll(/(\w+):\s*'([^']+)'/g)) t[kv[1]] = kv[2]
      if (Object.keys(t).length) tables[m[1]] = t
    }
  }
  // 显式表（bridge 成员名 → 宿主方法名；null 表示不由宿主方法回答）
  const explicit = { ...BRIDGE_TO_HOST, ...ELEMENT_BRIDGE_TO_HOST, ...CAPTURE_BRIDGE_TO_HOST }
  const src = files.map(read).join('\n')
  const starts = []
  for (const m of src.matchAll(/^ {4}(?:async\s+)?(\w+)\s*[:(]/gm)) starts.push({ name: m[1], at: m.index })
  const map = {}
  for (let i = 0; i < starts.length; i++) {
    const { name, at } = starts[i]
    const end = i + 1 < starts.length ? starts[i + 1].at : Math.min(at + 6000, src.length)
    const body = src.slice(at, end)
    const hosts = new Set()
    for (const h of body.matchAll(/invokeHost(?:Async)?(?:<[^>]*>)?\(\s*'([^']+)'/g)) hosts.add(h[1])
    for (const h of body.matchAll(/\b(APP_\w+_METHODS)\.(\w+)/g)) {
      const t = tables[h[1]]
      if (t && t[h[2]]) hosts.add(t[h[2]])
    }
    if (typeof explicit[name] === 'string') hosts.add(explicit[name])
    map[name] = [...hosts]
  }
  // 显式表里、但工厂体扫不到名字的也要收（如 createElementQuery 在返回对象里）
  for (const [k, v] of Object.entries(explicit)) {
    if (typeof v !== 'string') continue
    if (!map[k]) map[k] = []
    if (!map[k].includes(v)) map[k].push(v)
  }
  bridgeHostMapCache.set(root, map)
  return map
}

/** 宿主源码里实现了哪些方法名（四种分派形态；排除 probe/tools/selftest）。 */
const hostMethodCache = new Map()

function hostMethodsOf(root, end) {
  const key = root + '::' + end
  if (hostMethodCache.has(key)) return hostMethodCache.get(key)
  const spec = end === 'ios'
    ? { dirs: ['hosts/ios/ProteusHost'], ext: /\.swift$/ }
    : { dirs: ['hosts/android/app/src/main/java/dev/proteus/layoutcore'], ext: /\.(java|kt)$/ }
  const out = new Set()
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const p = rel + '/' + e.name
      if (e.isDirectory()) { if (!/(^|\/)(tools?|probe|selftest)(\/|$)/i.test(p)) walk(p) }
      else if (spec.ext.test(p) && !/probe|selftest|tools?\//i.test(p)) {
        const s = fs.readFileSync(path.join(root, p), 'utf8')
        for (const re of [/case\s+"([^"]+)"/g, /"([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)"\.equals\(\s*method\s*\)/g, /method\.equals\(\s*"([^"]+)"\s*\)/g, /\bmethod\s*==\s*"([^"]+)"/g]) {
          for (const m of s.matchAll(re)) out.add(m[1])
        }
      }
    }
  }
  for (const d of spec.dirs) walk(d)
  hostMethodCache.set(key, out)
  return out
}

/**
 * App 端（iOS/Android）的宿主证据：refs 里每个桥成员要么是纯 JS（无宿主方法），
 * 要么其宿主方法在该端源码里真的被分派。
 *
 * @returns {{ ok: boolean, pureJs: string[], missing: string[] }}
 */
export function appHostEvidence(root, end, refs) {
  const map = bridgeHostMap(root)
  const impl = hostMethodsOf(root, end)
  const pureJs = []
  const missing = []
  for (const r of refs) {
    const hosts = map[r] ?? []
    if (!hosts.length) { pureJs.push(r); continue }
    const builtin = APP_ENGINE_BUILTIN[end] ?? []
    for (const h of hosts) if (!impl.has(h) && !builtin.includes(h)) missing.push(h)
  }
  return { ok: missing.length === 0, pureJs, missing: [...new Set(missing)] }
}

/**
 * ★#1092：App 端**引擎自带**的方法（宿主不实现是合法的）——宿主证据判据据此豁免。
 * iOS JSC **内建标准 WebAssembly**（实测 `typeof WebAssembly === 'object'`，validate/add 都能跑）
 *   ⇒ 壳不需要也不应该实现 `webassembly.*`。与 `render-backend` 的 `HOST_METHOD_OPTIONAL.ios` 同源。
 */
export const APP_ENGINE_BUILTIN = {
  ios: ['webassembly.instantiate', 'webassembly.validate', 'webassembly.call', 'webassembly.release'],
  android: [],
}
