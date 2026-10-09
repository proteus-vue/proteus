// tests/cli-ios-device.test.ts —— ★★★iOS 设备状态解析（2026-10-09 · 真机实测缺陷）
//
// 【这张测试锁什么】`devicectl list devices` 的 State 列对可用设备有**两种**形态——
//   · `connected`（USB 直连）
//   · **`available (paired)`**（已配对可用；本机 iPhone 12 实测就是这个）
//   本轮真缺陷：`proteus dev --target ios` 打包成功却报「未找到已连接 iOS 设备」——因为代码
//   只匹配字面量 `connected`，设备明明在线却匹配不到那行。⇒ 判据：两种形态都算可用，`unavailable` 排除。
//
// 【为什么单列】与 #691（工具链路径）、#690（多 Xcode）同源——**"设备在，但探测口径不认"**
//   属"看起来没设备、其实有"的静默失败；解析逻辑是纯函数，值得零设备钉死。

import { describe, it, expect } from 'vitest'
import { parseIosDeviceId, usableIosDeviceRows } from '../packages/cli/src/host-package'

// 本机真机实测的原始输出（Xcode 26.5）——注意 State = `available (paired)`
const REAL_AVAILABLE = `Name            Hostname                          Identifier                             State                Model
-------------   -------------------------------   ------------------------------------   ------------------   ----------------------
yunlai的iPhone   yunlaideiPhone.coredevice.local   F02622D7-29CC-5E75-9AF9-A3AB36BC5C55   available (paired)   iPhone 12 (iPhone13,2)`

const CONNECTED = `Name   Hostname             Identifier                             State       Model
-----  -------------------  ------------------------------------   ---------   -----
iPhone  foo.coredevice.local  AAAA1111-BBBB-2222-CCCC-333344445555   connected   iPhone 15`

const UNAVAILABLE = `Name   Hostname             Identifier                             State         Model
-----  -------------------  ------------------------------------   -----------   -----
iPhone  bar.coredevice.local  DDDD1111-BBBB-2222-CCCC-333344445555   unavailable   iPhone 15`

describe('★iOS 设备状态解析（connected 与 available (paired) 都算可用）', () => {
  it('① 真实 `available (paired)` ⇒ 解析出设备标识（本轮真缺陷的直接判据）', () => {
    const id = parseIosDeviceId(REAL_AVAILABLE)
    expect(id, 'available (paired) 必须被认作可用设备').toBeTruthy()
    expect(id).toMatch(/coredevice\.local$|^[0-9A-Fa-f-]{20,}$/)
  })

  it('② `connected` ⇒ 解析出设备标识（旧行为不回归）', () => {
    expect(parseIosDeviceId(CONNECTED)).toBeTruthy()
  })

  it('③ `unavailable` ⇒ 判为无可用设备（词边界：unavailable 不得命中）', () => {
    expect(parseIosDeviceId(UNAVAILABLE)).toBeNull()
    expect(usableIosDeviceRows(UNAVAILABLE)).toHaveLength(0)
  })

  it('④ 表头 / 分隔线 / 空输出 ⇒ 不误判为设备', () => {
    expect(parseIosDeviceId('')).toBeNull()
    expect(usableIosDeviceRows('')).toHaveLength(0)
    // 纯表头（无设备行）
    const headerOnly = `Name   Hostname   Identifier   State   Model\n-----  --------   ----------   -----   -----`
    expect(parseIosDeviceId(headerOnly)).toBeNull()
  })

  it('⑤ usableIosDeviceRows：真实输出恰 1 行设备；多设备取首个', () => {
    expect(usableIosDeviceRows(REAL_AVAILABLE)).toHaveLength(1)
    const two = `${CONNECTED}\nsecond  two.coredevice.local  BBBB1111-2222-3333-4444-555566667777   available   iPhone 14`
    expect(usableIosDeviceRows(two).length).toBeGreaterThanOrEqual(2)
  })
})
