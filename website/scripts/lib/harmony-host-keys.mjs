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
 * 参与鸿蒙分档的**全部**桥源（新增域必须登记——否则该域在文档上永远 🟡）。
 * ★map 的值类型显式写 `Record<string, string | null>`：`null` = 该桥方法不由宿主方法回答
 *   （纯 JS 或壳推通道）。不标注的话两个 map 的字面量形状不同，数组元素会被推成联合类型，
 *   消费方读 `.map[...]` 时类型对不上（vue-tsc 实测）。
 * @type {Array<{file: string, factory: string, map: Record<string, string | null>}>}
 */
export const HARMONY_BRIDGE_SOURCES = [
  { file: 'packages/api/src/capability-app-device.ts', factory: DEVICE_BRIDGE_FACTORY, map: BRIDGE_TO_HOST },
  { file: 'packages/api/src/capability-app-element.ts', factory: ELEMENT_BRIDGE_FACTORY, map: ELEMENT_BRIDGE_TO_HOST },
]

/** 鸿蒙宿主里承载能力分发的源码（新增承载文件必须登记——否则该能力在文档上永远 🟡）。 */
export const HARMONY_HOST_SOURCES = [
  'hosts/harmony/host-app/proteus_render/src/main/cpp/host_app_runtime_impl.h',
  'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_device.h',
]

/** 从宿主 C++ 源码抽出**已实现的方法名字面量**。 */
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
    return {
      status: '✅',
      note: en
        ? 'Harmony host wired (proteus_device.h / host_app_runtime_impl.h)'
        : '鸿蒙宿主已接线（proteus_device.h / host_app_runtime_impl.h）',
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
