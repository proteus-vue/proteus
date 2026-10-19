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
  // ★不由宿主回答：
  //   · getKeyboard：壳**主动推** `__proteusHostKeyboard`（鸿蒙壳尚未推 ⇒ 保持 🟡）
  //   · createMediaQuery：纯 JS 求值（但读 `device.screen`；本模块按"桥方法级"判定，故不长绿）
  getKeyboard: null,
  createMediaQuery: null,
}

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
  const devPath = path.join(root, 'packages/api/src/capability-app-device.ts')
  let bridgeMethods = []
  if (!fs.existsSync(devPath)) {
    misses.push(`缺 ${path.relative(root, devPath)}（数据源缺失 = 硬失败）`)
  } else {
    const masked = maskNonCode(fs.readFileSync(devPath, 'utf8'))
    const { names, miss } = returnObjectMembers(masked, DEVICE_BRIDGE_FACTORY)
    if (miss) misses.push(miss)
    bridgeMethods = names
    const unregistered = names.filter((n) => !(n in BRIDGE_TO_HOST))
    if (unregistered.length) {
      misses.push(
        `桥方法未在 BRIDGE_TO_HOST 登记：${unregistered.join(', ')}（新增桥方法必须登记，否则文档永远标 🟡）`,
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
    const host = BRIDGE_TO_HOST[bridge]
    if (host && hostMethods.has(host)) keys.add(bridge)
  }
  return { keys, bridgeMethods, hostMethods, misses }
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
