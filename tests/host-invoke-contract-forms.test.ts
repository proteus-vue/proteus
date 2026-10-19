// tests/host-invoke-contract-forms.test.ts
// ★★★决策 #1090（2026-10-19）：宿主方法分派「形态覆盖」的判据。
//
// 【为什么（用户追问 ✅ 口径后顺带查出）】
//   `check:host-invoke-contract` 统计各端**能力覆盖率**，但它只认两种分派写法：
//     ① `case "x.y":`  ② `"x.y".equals(method)`
//   于是第三种真实形态 —— Swift 的 `if f.method == "http.request"` —— **压根抽不到**，
//   门禁长期报「ios 缺 http.request」，而 `hosts/ios/ProteusHost/runtime/http-capability.swift`
//   早已实现（字节腿 + 真机跑过）。更糟的是它扫的是**具体文件清单**，
//   `host-runtime-bridge.swift`（真正的分发点）根本不在清单里 ⇒ 换文件名就静默漏判。
//   ⇒ 这与 #1080（业务 switch 被当成方法）、#1081（漏 `"x".equals(method)`）是**同一族**：
//     **门禁的覆盖面必须跟着实际实现形态走**；形态一变，门禁静默失效，而它输出的数字看起来仍权威。
//
// 【判据】
//   ① 抽取器覆盖四种真实形态（switch / Java 前缀 / Java 反向 / Swift 属性比较）；
//   ② 覆盖率统计**扫目录**而不是写死文件清单（新增实现文件不必记得来改门禁）；
//   ③ 行为验证：跑一次门禁，`ios` 的缺项里**不得**出现 `http.request`（它已实现）；
//   ④ 排除探针/工具/自测目录（它们不是运行期实现，混进来会造成虚高）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE = path.join(ROOT, 'scripts/check-host-invoke-contract.mjs')
const SRC = fs.readFileSync(GATE, 'utf8')

describe('★#1090 ① 抽取器覆盖四种真实分派形态', () => {
  it('源码里四种形态的匹配式都在', () => {
    // ★比对的是**源码里的正则原文**（含转义反斜杠），所以用 String.raw 写字面片段，
    //   避免在测试里再叠一层转义（首版就是被这层转义弄红的）。
    expect(SRC.includes(String.raw`case\s+"([^"]+)"`), '缺 switch 分支形态').toBe(true)
    expect(SRC.includes(String.raw`"\.equals\(\s*method`), '缺 Java 前缀判定 `"x".equals(method)`').toBe(true)
    expect(SRC.includes(String.raw`method\.equals\(`), '缺 Java 反向 `method.equals("x")`').toBe(true)
    expect(SRC.includes(String.raw`\bmethod\s*==\s*"`), '缺 Swift 属性比较 `method == "x"`').toBe(true)
  })
})

describe('★#1090 ② 覆盖率扫目录而非写死文件清单', () => {
  it('iOS/Android 的能力覆盖用 extractCasesInDir 且扫运行期目录', () => {
    expect(SRC.includes('function extractCasesInDir'), '缺目录扫描原语').toBe(true)
    expect(SRC.includes("extractCasesInDir('hosts/ios/ProteusHost/runtime'"), 'iOS 仍用写死文件清单').toBe(true)
    expect(
      SRC.includes("extractCasesInDir('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime'"),
      'Android 仍用写死文件清单',
    ).toBe(true)
  })
  it('目录扫描排除探针/工具/自测（否则覆盖率虚高）', () => {
    expect(SRC).toMatch(/probe|selftest|tools/)
  })
})

describe('★#1090 ③ 行为验证：已实现的方法不得报缺', () => {
  it('运行门禁，ios 缺项里不得出现 http.request', () => {
    const out = execFileSync('node', [GATE], { cwd: ROOT, encoding: 'utf8' })
    const iosLine = out.split('\n').find((l) => l.includes('ios: 能力覆盖')) ?? ''
    expect(iosLine, '门禁没输出 ios 覆盖率行').toBeTruthy()
    expect(
      iosLine,
      'iOS 的 http.request 已实现（http-capability.swift），门禁仍报缺 ⇒ 形态覆盖又漏了',
    ).not.toContain('http.request')
  })
  it('门禁本身仍然通过（退出码 0）', () => {
    expect(() => execFileSync('node', [GATE], { cwd: ROOT, encoding: 'utf8' })).not.toThrow()
  })
})
