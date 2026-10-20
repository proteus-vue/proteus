// tests/host-probe-registry.test.ts
// ★★★决策 #1134：**宿主探针登记必须三处同集**——静态判据。
//
// 【它守的是什么（本轮真机抓出来的真缺陷）】
//   给 iOS 加一个新探针，要在 `hosts/ios/run-selfdraw.sh` 里改**三处**（互相正交）：
//     ① 参数解析分支：`--xxx-probe=*|...`（否则参数被当"设备 UDID"吞掉）
//     ② `case "$PN"` 赋值：`xxx-probe) XXX_PROBE_ARG="$PV" ;;`（否则变量是空的）
//     ③ 转发清单 `for pv in ...` + `ANY_PROBE`（否则参数不传给 App）
//   漏任意一处 ⇒ 参数根本没到 App ⇒ App 走**常驻模式永不退出** ⇒
//   **现象是"报告永远是旧的"**，而不是报错。
//
//   ★本轮实测：`redirect-probe` **三处全漏** ⇒ 服务端一个请求都没收到，
//     连续两轮 iOS 跑空（每轮 ≈5 分钟），最后靠"服务端 `/__seen` 只有我自己的记录"才定位。
//
// 【判据口径】从脚本源码里抽出三处的探针名集合，断言三者**相等**。
//   ★这是"清单腐化"类判据的通用形态：新增一项时人只会记得一处，机器负责核对另外两处。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const SCRIPT = path.join(ROOT, 'hosts/ios/run-selfdraw.sh')

/** ① 参数解析分支里列出的探针名（`--a-probe=*|--b-probe=*`） */
function parseBranchNames(src: string): string[] {
  const m = /--([a-z-]+-probe)=\*\|([^\n]*?)\)/.exec(src)
  if (!m) return []
  const line = m[0]
  return [...line.matchAll(/--([a-z-]+-probe)=\*/g)].map((x) => x[1]!)
}

/** ② `case "$PN"` 的赋值分支（`xxx-probe) XXX_PROBE_ARG=`） */
function caseNames(src: string): string[] {
  const at = src.indexOf('case "$PN" in')
  if (at < 0) return []
  const line = src.slice(at, src.indexOf('\n', at))
  // ★允许数字、且不要求 `)` 后空格（本仓 case 写成紧凑单行）
  // ★变量名不一定是 `*_PROBE_ARG`（`fetch-limit-probe` 存进 `FETCH_LIMIT_ARG`）⇒ 只要求 `_ARG=`
  return [...line.matchAll(/([a-z0-9-]+-probe)\)\s*[A-Z_]+ARG=/g)].map((x) => x[1]!)
}

/** ③ 转发清单（`for pv in A:xxx-probe ...`） */
function forwardNames(src: string): string[] {
  const m = /for pv in ([^\n]*?); do/.exec(src)
  if (!m) return []
  return [...m[1]!.matchAll(/:([a-z-]+-probe)/g)].map((x) => x[1]!)
}

describe('★★#1134 宿主探针登记：三处必须同集（漏一处 = 报告永远是旧的）', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8')

  it('三处都能解析出探针（解析器自证：0 个 = 源码形态变了，判据会退化成空跑）', () => {
    const a = parseBranchNames(src)
    const b = caseNames(src)
    const c = forwardNames(src)
    expect(a.length, `① 解析分支抽到 0 个（源码形态变了？）`).toBeGreaterThan(3)
    expect(b.length, `② case 赋值抽到 0 个`).toBeGreaterThan(3)
    expect(c.length, `③ 转发清单抽到 0 个`).toBeGreaterThan(3)
  })

  it('★① 解析分支 ⊆ ③ 转发清单（新探针漏加转发 ⇒ 参数不传 App）', () => {
    const parsed = new Set(parseBranchNames(src))
    const forwarded = new Set(forwardNames(src))
    const missing = [...parsed].filter((n) => !forwarded.has(n))
    expect(missing, `★这些探针在解析分支里有、但没进转发清单：${missing.join(', ')}`).toEqual([])
  })

  it('★② case 赋值 ⊆ ① 解析分支（新探针漏加 case ⇒ 变量恒空）', () => {
    const parsed = new Set(parseBranchNames(src))
    const assigned = new Set(caseNames(src))
    const missing = [...assigned].filter((n) => !parsed.has(n))
    expect(missing, `★这些探针有 case 赋值但解析分支收不到：${missing.join(', ')}`).toEqual([])
  })

  it('★① 解析分支 ⊆ ② case 赋值（漏 case ⇒ 参数解析了却没存下来）', () => {
    const parsed = new Set(parseBranchNames(src))
    const assigned = new Set(caseNames(src))
    const missing = [...parsed].filter((n) => !assigned.has(n))
    expect(missing, `★这些探针解析了但没有 case 赋值：${missing.join(', ')}`).toEqual([])
  })

  it('★★`ANY_PROBE` 覆盖全部转发项（漏一个 ⇒ 该探针不加 --console ⇒ 永不退出）', () => {
    const fwd = forwardNames(src)
    const m = /ANY_PROBE="([^"]*)"/.exec(src)
    expect(m, '没找到 ANY_PROBE 定义').toBeTruthy()
    const anyExpr = m![1]!
    // 转发项 `FOO_PROBE_ARG:foo-probe` ⇒ ANY_PROBE 里必须有 `${FOO_PROBE_ARG:-}`
    const missing = fwd.filter((name) => {
      const varM = new RegExp(`([A-Z_]+)_PROBE_ARG:${name}\\b`, 'g') // 占位，下面按变量名核对
      if (varM.test('')) return false
      return false
    })
    // 直接按"转发项对应的变量名"核对（从 for 循环文本里取 VAR:name）
    const pairs = [.../for pv in ([^\n]*?); do/.exec(src)![1]!.matchAll(/([A-Z_]+_ARG):([a-z-]+-probe)/g)].map(
      (x) => ({ v: x[1]!, name: x[2]! }),
    )
    const missingVars = pairs.filter((p) => !anyExpr.includes(`\${${p.v}:-}`))
    expect(missingVars.map((p) => `${p.v}(${p.name})`), '★ANY_PROBE 漏了这些变量').toEqual([])
    // 顺带保证上面的占位循环没被优化掉（保持判据可读）
    expect(missing).toEqual([])
  })

  it('★redirect-probe（#1134）三处齐全（防回归：本轮就是漏了它）', () => {
    expect(parseBranchNames(src)).toContain('redirect-probe')
    expect(caseNames(src)).toContain('redirect-probe')
    expect(forwardNames(src)).toContain('redirect-probe')
  })
})
