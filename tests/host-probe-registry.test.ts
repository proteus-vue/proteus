// tests/host-probe-registry.test.ts
// ★★★决策 #1134：#1149 重写——**宿主探针登记必须两方同集**（表驱动后从"三处"降到"两方"）。
//
// 【它守的是什么】
//   iOS 真机探针的登记过去分散在 `run-selfdraw.sh` 的**三处**（解析分支 / case 赋值 / 转发清单），
//   漏任意一处 ⇒ 参数根本没到 App ⇒ App 走常驻模式**永不退出** ⇒ 现象是"报告永远是旧的"，不报错。
//   ★实测两次：
//     · #1134：`redirect-probe` 三处全漏 ⇒ 服务端一个请求都没收到，连跑两轮 iOS 空转；
//     · #1149：`--cache-probe=` **只**加进 Swift、脚本一处没加 ⇒ 参数被当成设备 UDID
//       ⇒ 「✗ 安装失败」（而且旧脚本把安装失败原因 grep 掉了，下面一片空白）。
//
// 【为什么现在只比两方】
//   #1149 把三处合并成 `hosts/ios/lib/probe-args.sh` 的 `IOS_PROBES` **一张表**
//   （解析与转发都由它派生）⇒ "三处不同步"这个形态本身被消除了。
//   剩下的真实风险只有一项：**表里有、Swift 不认**（或反之）——参数解析了但 App 永远不认。
//   ⇒ 本判据改为：`IOS_PROBES` 集合 ⇄ `superapp-probes.swift` 的 `argPrefix` 集合必须相等。
//
// 【★判据自己的假绿教训（原版）】旧版只比 `run-selfdraw.sh` **内部**三处 ⇒
//   "只加 Swift、脚本一处不加"时三处照样相等、判据全绿。⇒ 覆盖面必须跟着实际形态走。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const LIB = path.join(ROOT, 'hosts/ios/lib/probe-args.sh')
const SWIFT = path.join(ROOT, 'hosts/ios/ProteusHost/shell/superapp-probes.swift')
const SCRIPT = path.join(ROOT, 'hosts/ios/run-selfdraw.sh')

/** ① `lib/probe-args.sh` 的 `IOS_PROBES` 表（`"VAR:probe-name"` 行） */
function tableNames(src: string): string[] {
  const m = /IOS_PROBES=\(([\s\S]*?)\n\)/.exec(src)
  if (!m) return []
  return [...m[1]!.matchAll(/"([A-Z_]+):([a-z-]+-probe)"/g)].map((x) => x[2]!)
}

/** ② Swift `ProbeConfig.argPrefix` 集合（App 真正会认的参数名） */
function swiftNames(src: string): string[] {
  return [...src.matchAll(/argPrefix:\s*"--([a-z-]+-probe)=/g)].map((x) => x[1]!)
}

describe('★★探针登记：IOS_PROBES 表 ⇄ Swift ProbeConfig 必须同集', () => {
  const libSrc = fs.readFileSync(LIB, 'utf8')
  const swiftSrc = fs.readFileSync(SWIFT, 'utf8')
  const scriptSrc = fs.readFileSync(SCRIPT, 'utf8')

  it('解析器自证：两方都抽得到探针（0 个 = 源码形态变了，判据会退化成空跑）', () => {
    expect(tableNames(libSrc).length, 'IOS_PROBES 表抽到 0 个（源码形态变了？）').toBeGreaterThan(3)
    expect(swiftNames(swiftSrc).length, 'Swift argPrefix 抽到 0 个').toBeGreaterThan(3)
  })

  it('★★表里有的，Swift 必须认（否则参数解析了但 App 永远不响应）', () => {
    const inTable = new Set(tableNames(libSrc))
    const inSwift = new Set(swiftNames(swiftSrc))
    const missing = [...inTable].filter((n) => !inSwift.has(n))
    expect(
      missing,
      `★这些探针在 IOS_PROBES 表里、Swift ProbeConfig 里没有：${missing.join(', ')}——App 永远不会响应这些参数`,
    ).toEqual([])
  })

  it('★★Swift 认的，表里必须有（否则参数被当成设备 UDID ⇒ 安装失败）', () => {
    const inTable = new Set(tableNames(libSrc))
    const inSwift = new Set(swiftNames(swiftSrc))
    const missing = [...inSwift].filter((n) => !inTable.has(n))
    expect(
      missing,
      `★★这些探针 Swift 会认、但 IOS_PROBES 表里没有：${missing.join(', ')}` +
        `——参数会被当成设备 UDID（表现为安装失败 / 报告永远是旧的）`,
    ).toEqual([])
  })

  it('★表项去重 + 变量名唯一（重复会让转发顺序/覆盖关系不可预测）', () => {
    const names = tableNames(libSrc)
    expect(new Set(names).size, '表里有重复的探针名').toBe(names.length)
    const vars = [...libSrc.matchAll(/"([A-Z_]+):[a-z-]+-probe"/g)].map((x) => x[1]!)
    expect(new Set(vars).size, '表里有重复的变量名').toBe(vars.length)
  })

  it('★脚本确实走表驱动（防止有人回退成三处手写清单）', () => {
    // 解析：`--*probe=*)` 分支必须调 lib 的函数
    expect(scriptSrc, '解析分支没调用 ios_probe_parse_arg（回退成手写清单了？）').toContain('ios_probe_parse_arg "$a"')
    // 转发：必须调 ios_probe_forward_args，且不再有手写 `for pv in ...:xxx-probe` 清单
    expect(scriptSrc, '转发没调用 ios_probe_forward_args').toContain('ios_probe_forward_args SA_ARGS')
    expect(scriptSrc, '仍存在手写的探针转发清单（应为表驱动）').not.toMatch(/for pv in [^\n]*:[a-z-]+-probe/)
    // 旧形态的 `case "$PN"` 赋值块不该再出现
    expect(scriptSrc, '仍存在手写 case 赋值块（应为表驱动）').not.toMatch(/case "\$PN" in [^\n]*-probe\)/)
  })
})
