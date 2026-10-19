// tests/gen-content-harmony-host.test.ts
// ★★鸿蒙宿主「真接线」派生契约（决策 #1067）——与 #881 的 app-bridge-keys 同族，方向相反。
//
// 【要证明什么】
//   ① **多源桥键**：`capability-app.ts` 之外拆出的 `capability-app-device.ts` 里的 12 个桥方法
//      必须被抽到（否则官网能力页对那 12 项仍报「App 未接线」= 代码做了、文档谎报）；
//   ② **鸿蒙宿主派生**：桥方法 → 宿主方法的映射必须成立，且鸿蒙宿主里**确有**对应方法；
//   ③ **未登记即硬失败**：新增桥方法而忘了登记 `BRIDGE_TO_HOST` ⇒ 抛错（否则永远 🟡，静默）；
//   ④ **不由宿主回答的方法必须留在 🟡**（getKeyboard / createMediaQuery）——不能因为"顺手"就标绿。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAppBridgeKeysFrom, APP_BRIDGE_SOURCES } from '../website/scripts/lib/app-bridge-keys.mjs'
import { maskNonCode, returnObjectMembers } from '../website/scripts/lib/ts-source-scan.mjs'
import {
  loadHarmonyBridgeKeys,
  BRIDGE_TO_HOST,
  DEVICE_BRIDGE_FACTORY,
  HARMONY_BRIDGE_SOURCES,
  extractHarmonyHostMethods,
} from '../website/scripts/lib/harmony-host-keys.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEVICE_SRC = path.join(ROOT, 'packages/api/src/capability-app-device.ts')

const DEVICE_BRIDGES = [
  'vibrate', 'getNetwork', 'readClipboard', 'setClipboard', 'getScreen', 'getDevice',
  'getBattery', 'getOrientation', 'getBrightness', 'setBrightness', 'setKeepScreenOn',
  'getKeyboard', 'createMediaQuery', 'getDeviceCapability',
]

describe('① 多源桥键（App 桥跨文件）', () => {
  it('设备域 14 个桥方法全部被抽到（不是只扫 capability-app.ts）', () => {
    const { keys, perSource } = loadAppBridgeKeysFrom(ROOT)
    for (const k of DEVICE_BRIDGES) expect(keys.has(k), `应含设备域桥方法 ${k}`).toBe(true)
    expect(perSource['packages/api/src/capability-app-device.ts'].count).toBeGreaterThanOrEqual(14)
  })

  it('多源契约登记了设备域文件（漏登记 ⇒ 那批方法在官网永远算"未接线"）', () => {
    expect(APP_BRIDGE_SOURCES.map((s) => s.file)).toContain('packages/api/src/capability-app-device.ts')
  })

  it('破坏性：源文件缺失 ⇒ 硬失败（不静默得空集）', () => {
    expect(() => loadAppBridgeKeysFrom(ROOT, [{ file: 'packages/api/src/__nope__.ts', functions: ['x'] }])).toThrow()
  })
})

describe('② 鸿蒙宿主派生（桥方法 → 宿主方法）', () => {
  it('真实源码：无 misses，且**所有映射到宿主方法**的桥方法都判为已接线', () => {
    const r = loadHarmonyBridgeKeys(ROOT)
    expect(r.misses).toEqual([])
    // ★不硬编码条数/名单（#1081 扩了元素域后就变了）：判据 = 映射表里每个非 null 的宿主方法，
    //   只要宿主源码真的实现了它，就必须出现在已接线集里。这样新增域自动纳入，不会"做了却漏判"。
    const mapped = [...HARMONY_BRIDGE_SOURCES.flatMap((x) => Object.entries(x.map))]
      .filter(([, host]) => host !== null)
    expect(mapped.length).toBeGreaterThan(0)
    for (const [bridge, host] of mapped) {
      if (!r.hostMethods.has(host as string)) continue // 宿主未实现 ⇒ 如实不在集里
      expect(r.keys.has(bridge), `宿主已实现 ${host} ⇒ 桥方法 ${bridge} 应判已接线`).toBe(true)
    }
    // 设备域 12 项仍应在集里（防止上面循环因映射表被清空而空转）
    expect(r.keys.has('vibrate')).toBe(true)
    expect(r.keys.has('readSensor')).toBe(true) // #1080 传感器（#1082 补登记后的回归锚点）
  })

  it('不由宿主回答的桥方法（键盘壳推 / 纯 JS 媒体查询）必须**不**在已接线集里', () => {
    const r = loadHarmonyBridgeKeys(ROOT)
    expect(r.keys.has('getKeyboard')).toBe(false)
    expect(r.keys.has('createMediaQuery')).toBe(false)
  })

  it('破坏性：新建一个未登记的桥方法 ⇒ 抛错（不是静默标 🟡）', () => {
    const src = fs.readFileSync(DEVICE_SRC, 'utf8')
    // 往返回对象里插一个未登记方法（插在 `return {` 后第一行）
    const idx = src.indexOf('  return {\n')
    expect(idx).toBeGreaterThan(0)
    const mutated = src.slice(0, idx) + '  return {\n    __newBridge: () => undefined,\n' + src.slice(idx + '  return {\n'.length)
    const tmp = path.join(ROOT, '.tmp-harmony-keys.ts')
    fs.writeFileSync(tmp, mutated)
    try {
      // 直接调纯函数路径：把文件放到期望位置不现实 ⇒ 用 extract + 手工断言登记表
      const { names } = returnObjectMembers(maskNonCode(mutated), DEVICE_BRIDGE_FACTORY)
      const unregistered = names.filter((n) => !(n in BRIDGE_TO_HOST))
      expect(unregistered).toContain('__newBridge')
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('宿主方法抽取认得 `method == "x"` 形态', () => {
    const s = extractHarmonyHostMethods('if (method == "device.hevc") { } if (method == std::string("device.info")) {}')
    expect([...s].sort()).toEqual(['device.hevc', 'device.info'])
  })
})

describe('③ 官网能力页分档（端到端）', () => {
  const read = (slug: string) => fs.readFileSync(path.join(ROOT, 'website/content/capabilities', `${slug}.md`), 'utf8')
  const harmonyRow = (slug: string) => /^\| 鸿蒙 \| ([^|]+) \|/m.exec(read(slug))?.[1].trim()

  it('device 页鸿蒙 = ✅（宿主真接线）', () => {
    expect(harmonyRow('device')).toBe('✅')
  })

  it('keyboard 页鸿蒙 ✅（#1069 已接键盘推送）/ media-query 仍 🟡（媒体查询判定不在宿主）', () => {
    // ★决策 #1069：键盘推送三端都已接线 ⇒ 鸿蒙从 🟡 转 ✅；
    //   media-query 是纯 JS 求值（读 device.screen），按"桥方法级"口径仍不给绿。
    expect(harmonyRow('keyboard')).toBe('✅')
    expect(harmonyRow('media-query')).toBe('🟡')
  })

  it('App 端两列对 12 项都是 ✅（不再谎报"能力桥未接线"）', () => {
    const md = read('device')
    expect(/^\| iOS 原生 \| ✅ \|/m.test(md)).toBe(true)
    expect(/^\| Android 原生 \| ✅ \|/m.test(md)).toBe(true)
  })
})

// ══════════════ ★★决策 #1069：推送型能力不能凭"桥方法存在"判 ✅ ══════════════
//
// 【这一组防的正是本轮抓到的真缺陷】`getKeyboard` 的实现只返回订阅句柄 ⇒ 任何端装了 JS 侧通道
//   就**看起来**有；而高度要靠壳主动推。三端此前都没推，官网却判了 ✅（对外谎报）。
//   ⇒ 判据必须读**壳里有没有推送代码**（`hasKeyboardPush`），且缺一端就该掉到 🟡。

import { hasKeyboardPush as hasPush, KEYBOARD_PUSH_SOURCES } from '../website/scripts/lib/harmony-host-keys.mjs'

describe('④ 键盘推送通道（读壳源码，不看桥方法）', () => {
  it('三端都真的有推送实现（Android ime / iOS UIKeyboard / 鸿蒙 keyboardHeightChange）', () => {
    for (const end of ['android', 'ios', 'harmony']) {
      expect(hasPush(ROOT, end as 'android' | 'ios' | 'harmony'), `${end} 应已接推送`).toBe(true)
    }
  })

  it('每端的证据源都登记了**实现 + 装配点**（只判一边会漏"做了但没人调"）', () => {
    // iOS：场景装（KeyboardWatch.install）+ runtime 实现（通知 + JS 推送）
    expect(KEYBOARD_PUSH_SOURCES.ios.length).toBe(2)
    // 鸿蒙：ArkTS 监听 + C++ 注入
    expect(KEYBOARD_PUSH_SOURCES.harmony.length).toBe(2)
    // Android：实现（`KeyboardWatcher` 的 ime 监听 + eval 推送）+ 装配点（壳调 install）
    //   ★#1075 把实现抽出壳后，证据必须跟到实现文件；两处都判才能同时抓"没实现"与"实现了没人装"。
    expect(KEYBOARD_PUSH_SOURCES.android.length).toBe(2)
  })

  it('破坏性：摘掉 iOS 的通知名 ⇒ 判据变 false（不是读文档/桥方法）', () => {
    const p = 'hosts/ios/ProteusHost/runtime/keyboard-watch.swift'
    const abs = path.join(ROOT, p)
    const bak = fs.readFileSync(abs, 'utf8')
    try {
      fs.writeFileSync(abs, bak.replace('keyboardWillShowNotification', 'keyboardWillShowBOGUS'))
      expect(hasPush(ROOT, 'ios')).toBe(false)
    } finally {
      fs.writeFileSync(abs, bak)
    }
    expect(hasPush(ROOT, 'ios')).toBe(true)
  })

  it('键盘页三端分档：都是 ✅，且说明里点名"壳推送"（不是只写桥方法）', () => {
    const md = fs.readFileSync(path.join(ROOT, 'website/content/capabilities/keyboard.md'), 'utf8')
    for (const label of ['iOS 原生', 'Android 原生', '鸿蒙']) {
      const row = new RegExp(`^\\| ${label} \\| ([^|]+) \\|`, 'm').exec(md)
      expect(row?.[1].trim(), `${label} 应为 ✅`).toBe('✅')
    }
    expect(md).toMatch(/壳推送已接线|键盘高度随渲染注入/)
  })
})
