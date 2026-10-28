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
/** ③ 参数分派所在文件（`switch cfg.argPrefix`）——#1179 补的第三处 */
const SCENE = path.join(ROOT, 'hosts/ios/ProteusHost/shell/superapp-scene.swift')

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

/**
 * 在 bridge 源码里找 `__proteusHostXxxProbe` 对应的 JS 函数签名（用于判"有没有额外参数"）。
 * ★判据只关心**参数个数**（`base` 之外还有没有），所以取 `function appXxxProbe(...)` 的形参列表即可。
 */
function findBridgeFnSig(hostFnName: string): string | null {
  const dir = path.join(ROOT, 'hosts/shared/bridge')
  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))
  } catch {
    return null
  }
  // 宿主 globalThis 名 → JS 函数名：`AppHttpDnsB` → `appHttpDnsBProbe`
  //   ★注意 `__proteusHost(\w+)Probe` 的 `\w+` 拿不到尾部 `Probe`（它被字面量吃掉）
  //   ⇒ 必须自己补回来，否则永远匹配不到函数（本判据首版就在这里退化成空跑、被 size>2 断言抓到）
  const jsName = hostFnName.charAt(0).toLowerCase() + hostFnName.slice(1) + 'Probe'
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    const m = new RegExp(`export function ${jsName}\\s*\\(([^)]*)\\)`).exec(src)
    if (m) return m[1]!
  }
  return null
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

  /**
   * ★★★#1179 真机抓出的**第二类静默失效**（原判据只比两方 ⇒ 漏掉这一处）：
   *   `superapp-scene.swift` 用 `switch cfg.argPrefix` 把探针参数拼成 JS 调用的实参，
   *   新探针只加 `ProbeConfig` 而不加 `case` ⇒ 走 `default: extra = ""`
   *   ⇒ **publicUrl / rounds 被静默丢弃**。
   *   ★现场表现极具欺骗性：`public_statuses: []` + 公网经代理"全失败"，
   *     看起来像功能坏了，真因只是参数没传进去。
   *   ★为什么原判据漏了：它只比 `IOS_PROBES` ⇄ `ProbeConfig`（两方），
   *     而参数分派是**第三处**——覆盖面必须跟着实际形态走（本仓反复踩的形态）。
   */
  it('★★★#1179 第三处：Swift 参数分派（switch argPrefix）必须覆盖每个探针', () => {
    const sceneSrc = fs.readFileSync(SCENE, 'utf8')
    const dispatched = [...sceneSrc.matchAll(/case\s+"--([a-z-]+-probe)=":/g)].map((x) => x[1]!)
    expect(dispatched.length, 'superapp-scene.swift 里抽不到探针分派（源码形态变了？）').toBeGreaterThan(3)
    // ★只判「**有额外参数**的探针」：`cache-probe` / `stale-probe` 的 JS 函数只接 base
    //   （`appStaleProbe(base)` / `appCacheProbe(base)`）⇒ 走 `default: extra = ""` 是**正确的**，
    //   把它们也算进"必须有 case"会产生假红（本判据首版就是在这里红的）。
    //   判据取"额外参数"的唯一事实来源：Swift 的 kickFormat **形状**——
    //   形如 `__proteusHostAppXxxProbe(%@)` 且 JS 侧函数除 base 外还有参数。
    const extraParamProbes = new Set<string>()
    // ★★★#1336 修一条**既存判据 bug**：`matchAll()` 返回 `RegExpStringIterator`（**没有** `.map`），
    //   原写法 `swiftSrc.matchAll(...).map(...)` 一执行就抛 `TypeError: ... .map is not a function`。
    //   之所以长期没暴露：#1336 加 `--share-probe` 之前，这段循环从未真正跑到
    //   （它是本单第一条让 `extraParamProbes` 可能非空的路径）⇒ "判据自己崩了"被埋着。
    //   ⇒ 先 `[...]` 展开成数组再 map。
    for (const [full, name] of [...swiftSrc.matchAll(/argPrefix:\s*"--([a-z-]+-probe)=/g)].map(
      (m) => [m[0], m[1]!] as const,
    )) {
      // 在该 argPrefix 之后的 200 字符内找 kickFormat
      const at = swiftSrc.indexOf(full)
      const kick = /kickFormat:\s*"([^"]+)"/.exec(swiftSrc.slice(at, at + 400))
      if (!kick) continue
      const jsFn = /__proteusHost(\w+)Probe/.exec(kick[1]!)?.[1]
      if (!jsFn) continue
      // 在 bridge 源码里找该函数的签名，看是否有第二个参数
      const bridge = findBridgeFnSig(jsFn)
      if (bridge && bridge.split(',').length > 1) extraParamProbes.add(name)
    }
    expect(extraParamProbes.size, '一个"有额外参数"的探针都没识别出来（判据会退化成空跑）').toBeGreaterThan(2)
    const missing = [...extraParamProbes].filter((n) => !dispatched.includes(n))
    expect(
      missing,
      `★★这些探针有额外参数但没有在 superapp-scene.swift 的 switch 里分派：${missing.join(', ')}` +
        `——走 default ⇒ 额外参数被静默丢弃（表现为"功能失败"，真因只是参数没传进去）`,
    ).toEqual([])
  })

  /**
   * ★★★#1153 真机抓出的**静默失效**：lib/probe-args.sh 曾用 `arg##*=` 取值
   *   ⇒ 值里含 `=` 时取到"最后一个 ="之后的**空串**（bash 的 ## 是贪婪前缀删除）。
   *   而 #1153 的 `--tls-probe=<baseA>,<baseB>,<pinA>,<pinB>` 里 pin 是 base64、末尾带 `=` 填充
   *   ⇒ 整个探针参数被吞 ⇒ App 走常驻模式、报告永不落盘（"报告未取回"，与 #1134 同族）。
   * ★为什么之前没暴露：其它探针的值都是 URL / 数字，不含 `=`。
   */
  it('★★参数值里含 = （如 base64 填充）也必须正确解析', () => {
    const lib = fs.readFileSync(LIB, 'utf8')
    /**
     * ★★★#1191（独立验证 J9 修复）：原来写的是 `lib.split("\\n")` —— JS 字符串里
     *   `"\\n"` 是**两个字符**（反斜杠 + n），不是换行 ⇒ `assignLines` **恒为空数组**
     *   ⇒ 这条用例实际只执行了下面那句 `toContain`，等于没验。
     *   ⇒ 改成 `split('\n')`，并**断言确实找到了赋值行**（自证判据没退化成空跑）。
     */
    const assignLines = lib.split('\n').filter((l) => /^\s*value=/.test(l))
    expect(assignLines.length, '★一行 value= 都没找到（判据退化）').toBeGreaterThan(0)
    // 断言用的是"取第一个 ="的写法，而不是贪婪的 ##*=
    expect(lib, '★probe-args.sh 缺少按第一个 = 切值的写法').toContain('${arg#*=}')
  })

  it('★脚本确实走表驱动（防止有人回退成三处手写清单）', () => {    // 解析：`--*probe=*)` 分支必须调 lib 的函数
    expect(scriptSrc, '解析分支没调用 ios_probe_parse_arg（回退成手写清单了？）').toContain('ios_probe_parse_arg "$a"')
    // 转发：必须调 ios_probe_forward_args，且不再有手写 `for pv in ...:xxx-probe` 清单
    expect(scriptSrc, '转发没调用 ios_probe_forward_args').toContain('ios_probe_forward_args SA_ARGS')
    expect(scriptSrc, '仍存在手写的探针转发清单（应为表驱动）').not.toMatch(/for pv in [^\n]*:[a-z-]+-probe/)
    // 旧形态的 `case "$PN"` 赋值块不该再出现
    expect(scriptSrc, '仍存在手写 case 赋值块（应为表驱动）').not.toMatch(/case "\$PN" in [^\n]*-probe\)/)
  })
})
