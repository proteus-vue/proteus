#!/usr/bin/env node
// hosts/android/check-artifact-contract.mjs —— ★验收**产物契约**静态检查（零设备、零等待）
//
// 【为什么需要（2026-09-29 实测教训）】
//   本仓反复出现的低效模式：**跑完整验收（~5 分钟）之后才发现装置有问题**——
//   一天内重复了三次，每次都白跑一遍全流程。已发生的三类缺陷：
//     ① `gfxinfo-native.txt`：汇总在**读**它，但**从来没有任何代码写它** ⇒ 原生对照永远走
//        「缺 gfxinfo」分支（**静默缺失**，不报错）；
//     ② `layout-scroll-native.json`：**两个不同场景写同一个文件名**（截图场景 + 原生滚动对照）
//        ⇒ 后跑者覆盖先跑者，run 目录里拿到的是**另一种数据**（都能解析，只是根本不是同一件事）；
//     ③ 逐轮读数不落盘 ⇒ 报告里的中位表**无法复算**。
//   三者的共同点：**产物契约（谁写、写几个、谁读）没有被机器校验**。
//   ⇒ 本脚本把该契约变成**静态判据**（解析源码 + 比对真实 run 目录，不需要设备、不需要跑测试）：
//     秒级发现问题，而不是 5 分钟后。
//
// 【判据】（任一不满足 → exit 1）
//   A. **同名多写**：一个报告名被**不同场景方法**写入 ⇒ 覆盖风险（缺陷②）
//      · 排除「同一方法的成功/错误两条分支」（那是同一个写者，不是撞名）
//   B. **读而无写**：`acceptance.sh` 的汇总在读、但没有任何写入点，也没有任何真实产物 ⇒ 静默缺失（缺陷①）
//   C. **拉了无写**：`adb pull` 清单里的文件没有任何写入点 ⇒ 永远拉不到
//
// 用法：node hosts/android/check-artifact-contract.mjs [--json]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const asJson = process.argv.includes('--json')

const JAVA_DIR = path.join(HERE, 'app/src/main/java/dev/proteus/layoutcore')
const SH = path.join(HERE, 'acceptance.sh')
const RESULTS = path.join(HERE, 'results/acceptance')

// ── 解析 ①：Java 侧的写入点（报告名 → 谁写、在哪个方法、哪一行）──────────────
/** @type {Map<string, {file: string, line: number, method: string, isErrorPath: boolean}[]>} */
const writers = new Map()
// ★★递归收集 .java（2026-10-10 修）：此前只 `readdirSync(JAVA_DIR)` **一层**，而 `.java` 全在
//   `runtime/` `dev/` `shell/` 子目录里 ⇒ 扫到 **0 个** ⇒ 「Java 产出 0 个报告名」⇒
//   下游「读而无写 / 拉了无写」**全部误报**（21 处假红），真机验收被预检**拦死**。
//   ★这是"验收门禁自己坏了"（不是项目缺产物）——递归收集后误报消失。
const javaFiles = []
;(function walkJava(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walkJava(p)
    else if (e.name.endsWith('.java')) javaFiles.push(p)
  }
})(JAVA_DIR)
for (const full of javaFiles) {
  const f = path.relative(JAVA_DIR, full)
  const lines = fs.readFileSync(full, 'utf8').split('\n')
  let method = '(top-level)'
  lines.forEach((l, i) => {
    // 方法边界：`private/public <ret> name(` —— 只取定义行（缩进 ≤4 且带访问修饰符）
    // ★★排除「写入工具方法自身」（2026-10-02 实测误报）：
    //   `private void writeReport(...)` 的**定义行**也匹配本正则，而它内部又调用 writeReport(...)
    //   ⇒ 解析器把「写入工具」当成一个独立"场景"，与真正的场景（run）撞名 ⇒ 假红
    //   （实测：stash 掉本轮全部改动后同样红 ⇒ 存量误报，不是本次引入的撞名）。
    //   修法：工具方法不进 method 集合（它是**所有场景共用的写入路径**，不构成独立写者）。
    const WRITER_HELPERS = new Set(['writeReport'])
    const decl = l.match(/^\s{0,4}(?:private|public|protected|static|final|\s)*[\w<>\[\],\s.]+\s+(\w+)\s*\([^;]*$/)
    if (decl && !/\b(new|return|if|for|while|switch|catch)\b/.test(l) && !WRITER_HELPERS.has(decl[1])) method = decl[1]
    const re = /writeReport\(\s*"([^"]+)"\s*,\s*([^)]*)/g
    let m
    while ((m = re.exec(l)) !== null) {
      const isErrorPath = /^\s*"\{\\"ok\\":false/.test(m[2]) || /ok\\":false/.test(m[2])
      if (!writers.has(m[1])) writers.set(m[1], [])
      writers.get(m[1]).push({ file: f, line: i + 1, method, isErrorPath })
    }
  })
}

// ── 解析 ②：脚本侧（pull 清单 / 脚本自产 / 汇总读取）─────────────────────────
const sh = fs.readFileSync(SH, 'utf8')

/** pull 清单：`for f in a b c; do` 之后跟 adb pull 的那一段 */
const pulled = new Set()
{
  const m = sh.match(/for f in ([^;]+); do\s*\n\s*"[^"]*ADB[^"]*"[^>]*shell "run-as/)
  if (m) for (const n of m[1].trim().split(/\s+/)) pulled.add(n)
}

/** 脚本自产：`$DEST/<名字>`；含 `$var` 的归为**模式**（变量段视作通配） */
const scriptWrites = new Set()
const scriptPatterns = [] // 形如 gfxinfo-.+-r.+\.txt
for (const m of sh.matchAll(/\$DEST\/([\w.$-]+\.(?:txt|json|pftrace))/g)) {
  const raw = m[1]
  if (/\$/.test(raw)) {
    const re = '^' + raw.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\\\$[\w]+/g, '.+') + '$'
    scriptPatterns.push(re)
  } else scriptWrites.add(raw)
}

/** 汇总读取：python 段 `join(dest, 'X')` 与 `glob.glob(... 'P')` */
const reads = new Set()
const readGlobs = []
for (const m of sh.matchAll(/join\(dest,\s*'([^']+)'\)/g)) {
  // ★含 * 的是 glob（不能当字面文件名——否则误报「读而无写」，本仓 2026-09-29 踩过）
  if (m[1].includes('*')) readGlobs.push(m[1])
  else reads.add(m[1])
}
for (const m of sh.matchAll(/glob\.glob\(os\.path\.join\(dest,\s*'([^']+)'\)\)/g)) readGlobs.push(m[1])
for (const m of sh.matchAll(/test -f [^\n]*\/files\/([\w.-]+)/g)) reads.add(m[1])

// ── ★证据面：真实 run 目录里实际产生过的文件名（比纯语法推断可靠）────────────
const observed = new Set()
if (fs.existsSync(RESULTS)) {
  for (const d of fs.readdirSync(RESULTS)) {
    const p = path.join(RESULTS, d)
    if (!fs.statSync(p).isDirectory()) continue
    for (const f of fs.readdirSync(p)) observed.add(f)
  }
}

const globToRe = (p) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
// ★注意：**不得**把「历史 run 目录里出现过」当豁免——本仓实测踩到过：
//   某文件只存在于**手工放置**的那一次（`gfxinfo-native.txt`），自动化流程从来产不出它，
//   而汇总一直在读它 ⇒ 用历史产物豁免会让这条判据**永远绿**（假绿比没有判据更糟）。
//   故判据只认**源码产出**（Java 写点 / 脚本自产 / 脚本产出的模式）。
const coveredByName = (name) =>
  writers.has(name) || scriptWrites.has(name) ||
  scriptPatterns.some((re) => new RegExp(re).test(name))

// ── 判据 A：同名多写（不同场景方法；排除错误分支）────────────────────────────
// ★显式白名单：**同一场景的「暂存写 + 最终写」**（run 派发时先写场景返回值，
//   场景的异步回调稍后用完整报告覆盖同一文件）——这是**有意为之**的分阶段写，
//   不是撞名。它与真正的撞名（两个不同场景写同一文件 ⇒ 拿到另一种数据）区别在于：
//   run 写的就是它所派发的那个场景方法的返回值。
//   ⚠ 使用前提：取回时必须等最终写（acceptance.sh 的等待循环负责）。
//   白名单要求逐条给理由——与 check-gates-sync 的 LOCAL_ONLY 同规矩（不静默豁免）。
const STAGED_WRITES = {
  'layout-shot-scroll-native.json': 'run 派发写初始报告 → setupScrollNativeScene 异步补 scroll_steps 后覆盖（同场景分阶段）',
  'layout-native-host.json': 'run 派发写初始报告 → setupNativeHostScene 异步补截图核验数据后覆盖（同场景分阶段）',
  'layout-shot-scene.json': 'run 派发写初始报告 → setupScreenshotScene 异步补期望坐标后覆盖（同场景分阶段）',
  'layout-gesture.json': 'run 派发写初始报告 → gestureRun 异步补手势轨迹后覆盖（同场景分阶段）',
}
const dup = []
for (const [name, sites] of writers) {
  const ok = sites.filter((s) => !s.isErrorPath)
  const methods = [...new Set(ok.map((s) => s.method))]
  if (methods.length > 1 && !(name in STAGED_WRITES)) dup.push({ name, methods, sites: ok })
}

// ── 判据 B：读而无写（含 glob）──────────────────────────────────────────────
const deadReads = [...reads].filter((n) => !coveredByName(n))
// 读取 glob vs 产出（具体名 + 脚本模式）——用**字面前后缀重叠**判定，
// 不靠"历史产物里有没有"（理由同上）。无法判定且确属正当的，进 GLOB_ALLOWLIST 并写明理由。
const PRODUCER_PATTERNS = scriptPatterns.map((re) => re.replace(/^\^|\$$/g, ''))
const literalParts = (pat) => {
  const norm = pat.replace(/\\\./g, '.').replace(/\.\+/g, '*').replace(/\*/g, '*')
  const first = norm.indexOf('*')
  return first < 0 ? { pre: norm, suf: norm } : { pre: norm.slice(0, first), suf: norm.slice(norm.lastIndexOf('*') + 1) }
}
const GLOB_ALLOWLIST = {}   // 形如 'pattern': '理由'；仅用于**确属正当但静态判不出**的情形
const deadGlobs = readGlobs.filter((g) => {
  const { pre, suf } = literalParts(g)
  const overlap = (other) => {
    const o = literalParts(other)
    const preOk = o.pre.startsWith(pre) || pre.startsWith(o.pre)
    const sufOk = o.suf.endsWith(suf) || suf.endsWith(o.suf)
    return preOk && sufOk
  }
  if ([...writers.keys()].some((n) => globToRe(g).test(n))) return false
  if (PRODUCER_PATTERNS.some(overlap)) return false
  return !(g in GLOB_ALLOWLIST)
})

// ── 判据 C：拉了无写 ───────────────────────────────────────────────────────
const pulledNoWriter = [...pulled].filter((n) => !coveredByName(n))

// ── 提醒 D：Java 产出了但 pull 清单里没有（可能白跑）────────────────────────
const JAVA_ONLY_OK = new Set([
  'layout-scroll-core.json', 'layout-scroll.json', 'layout-scroll-native.json',
  'layout-hit.json', 'layout-env.json', 'layout-text-paths.json',
  'layout-shot-scroll-native.json', // 截图场景：由截图核验流程单独取
])
const notPulled = [...writers.keys()].filter(
  (n) => !pulled.has(n) && !JAVA_ONLY_OK.has(n) && !scriptWrites.has(n),
)

const fail = dup.length + deadReads.length + deadGlobs.length + pulledNoWriter.length
if (asJson) {
  console.log(JSON.stringify({ dup, deadReads, deadGlobs, pulledNoWriter, notPulled, writerCount: writers.size }, null, 2))
} else {
  console.log('验收产物契约检查（静态·零设备）')
  console.log(
    `  Java 产出 ${writers.size} 个报告名 · pull 清单 ${pulled.size} 项 · 汇总读取 ${reads.size} 项 + glob ${readGlobs.length} 项 · 历史产物样本 ${observed.size} 个`,
  )
  const stagedUsed = Object.keys(STAGED_WRITES).filter((n) => writers.has(n))
  if (stagedUsed.length) {
    console.log('  ℹ 已声明的分阶段写（暂存→最终）:')
    for (const n of stagedUsed) console.log(`      ${n} —— ${STAGED_WRITES[n]}`)
  }
  if (dup.length) {
    console.log('\n❌ A. 同名多写（不同场景写同一个文件名 ⇒ run 目录里会拿到另一种数据）')
    for (const d of dup) {
      console.log(`  - ${d.name} ← 场景 ${d.methods.join(' / ')}`)
      for (const s of d.sites) console.log(`      ${s.file}:${s.line} (${s.method})`)
    }
  }
  if (deadReads.length || deadGlobs.length) {
    console.log('\n❌ B. 读而无写（汇总会静默拿到缺失/过期数据）')
    for (const n of deadReads) console.log(`  - ${n}（源码无写入点，历史产物里也不存在）`)
    for (const g of deadGlobs) console.log(`  - glob:${g}（无产物匹配）`)
  }
  if (pulledNoWriter.length) {
    console.log('\n❌ C. 拉了无写（永远拉不到）')
    for (const n of pulledNoWriter) console.log(`  - ${n}`)
  }
  if (notPulled.length) console.log(`\nℹ D. 写了没拉（提醒，不判失败）：${notPulled.join(', ')}`)
  console.log(
    fail
      ? `\n✗ 契约不成立（${fail} 处）——先修产物契约再跑验收，否则又是 5 分钟后才发现`
      : '\n✅ 产物契约成立（写 / 读 / 拉 三方一致）',
  )
}
process.exit(fail ? 1 : 0)
