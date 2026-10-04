#!/usr/bin/env node
// scripts/check-host-rounding.mjs —— ★卡 I2「平台层零舍入」静态门禁
//
// 【卡 I2 的硬性规则】内核产出指令时完成舍入（`packages/layout-core/src/pixel-snap.ts` /
//   `packages/layout-core-rust/src/snap.rs`），**平台层不得再舍入**。
//   风险（卡原文）：各平台层各自舍入 ⇒ 三端策略不同 ⇒ golden 全绿但三端差 1px。
//
// 【本门禁在防什么（本仓实测的真实缺陷）】写本门禁时当场抓到 Android 宿主两处：
//   · `ProteusHostView.onMeasure` → `Math.round(rect.width())`
//   · `ProteusHostView.onLayout`  → `Math.round(rect.left)`
//   （还有 `MirrorHit.layoutRec`）——几何来自内核，宿主**再舍入一次**就是策略分叉的入口。
//   这类缺陷不会让任何既有测试变红（几何仍是"合理的整数"），只有真机上差 1px。
//
// 【判定口径（区分"几何舍入"与合法用法）】
//   · **几何换算** = 把内核给的坐标/尺寸转成平台 API 需要的类型 ⇒ **违规**
//     （内核已吸附 ⇒ 转换必须无损：`(int) v` / `Int(v)`）
//   · 合法例外（每条必须在源码写 `I2-ALLOW:` 注释说明理由）：
//       - 文本**测量**（平台度量文本后交给内核；度量本身允许亚像素→整数）
//       - 位图/像素缓冲尺寸（纹理必须整数像素）
//       - 统计与报告（p95 / 平均帧率 / 内存 MB —— 与人看的数字，不是几何）
//
// 用法：node scripts/check-host-rounding.mjs
// 退出码：0 通过 / 1 存在未登记的几何舍入
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 扫描面：宿主绘制/几何代码（Java/Swift/ObJ-C++/Rust JNI/ArkTS） */
const TARGETS = [
  'hosts/android/app/src/main/java/dev/proteus/layoutcore',
  'hosts/ios/ProteusHost',
  'hosts/ios/experiments',
  // ★2026-10-04（App 三端对齐 · D3）：鸿蒙宿主 ArkTS 源码——此前不在扫描面 ⇒ 三端舍入纪律**缺一端**。
  //   ★只扫 `src/main/ets`（不含 `entry/build/**` 生成物）；扩展名见下方 walk 的 .ets/.ts。
  'hosts/harmony/host-app/entry/src/main/ets',
]

/** 舍入调用形态（跨语言） */
const ROUNDING = [
  /\bMath\.round\s*\(/,
  /\bMath\.ceil\s*\(/,
  /\bMath\.floor\s*\(/,
  /\.rounded\s*\(\s*\)/,
  /\bceil\s*\(/,      // Swift 全局 ceil / floor / round
  /\bfloor\s*\(/,
  /\bround\s*\(/,
]

/** 例外关键词（注释里写 I2-ALLOW: 说明理由即放行——「每个例外都要有名有姓」）
 *  ★生效窗口 = 该行**之前 5 行内**（一条注释覆盖其后的语句组：
 *    实测有 4 行组，如"x/y/w/h 四个报告字段"；首版 1 行、次版 3 行都漏掉组内后续行） */
const ALLOW_MARK = 'I2-ALLOW:'
const ALLOW_WINDOW = 5

/** ★「报告精度取整」惯用式：`round(v * 10^n) / 10^n` / `(v * 100).rounded() / 100`
 *  —— 这是把读数写成人类可读小数位，**不是几何舍入**（几何用的是嵌入指令的那份值）。
 *  按**模式**判定而不是按词判定：词表会漏（首版实测漏掉 8 处）也会误伤。 */
const REPORT_ROUND = [
  /(Math\.round|round)\s*\([^()]*(\*|\/)\s*\d+(\.\d+)?\s*\)\s*\/\s*\d+/,
  /\(\s*[^()]*\*\s*\d+(\.\d+)?\s*\)\.rounded\s*\(\s*\)\s*\/\s*\d+/,
]

/** 与几何无关的行（计时/统计/报告）——按"该行含这些词"放行 */
const STAT_WORDS = [
  'ms', 'MS', 'Mem', 'mem', 'mb', 'MB', 'fps', 'FPS', 'p50', 'p95', 'p99',
  'ratio', 'Ratio', 'avg', 'Avg', 'Median', 'median', 'byte', 'Byte',
  'physFootprint', 'duration', 'elapsed', 'Percent', 'percent', 'px/s',
]

function walk(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(java|swift|mm|m|h|kt|ets|ts)$/.test(e.name)) out.push(p)
  }
  return out
}

const failures = []
const allowed = []
let scanned = 0

for (const target of TARGETS) {
  for (const file of walk(path.join(ROOT, target))) {
    scanned++
    const lines = fs.readFileSync(file, 'utf-8').split('\n')
    lines.forEach((line, i) => {
      // 注释行/纯文档：跳过（但注释里的 I2-ALLOW 是给**下一行**用的）
      const trimmed = line.trim()
      const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
      const looksRounding = ROUNDING.some((re) => re.test(line))
      if (!looksRounding || isComment) return

      const prevWindow = lines.slice(Math.max(0, i - ALLOW_WINDOW), i).join('\n')
      const hasAllow = line.includes(ALLOW_MARK) || prevWindow.includes(ALLOW_MARK)
      const reportLike = STAT_WORDS.some((w) => line.includes(w))
        || REPORT_ROUND.some((re) => re.test(line))
      const rel = path.relative(ROOT, file)

      if (hasAllow) { allowed.push(`${rel}:${i + 1}`); return }
      if (reportLike) { allowed.push(`${rel}:${i + 1}（统计/报告）`); return }
      failures.push({ file: rel, line: i + 1, text: trimmed })
    })
  }
}

console.log('卡 I2 · 平台层零舍入检查（内核已吸附 ⇒ 平台不得再舍入）')
console.log(`  扫描 ${scanned} 个宿主源文件（Android layoutcore / iOS ProteusHost / iOS experiments / 鸿蒙 ArkTS ets）`)
console.log(`  已登记例外 ${allowed.length} 处（I2-ALLOW 或统计/报告行）`)

if (failures.length) {
  console.error(`\n❌ 发现 ${failures.length} 处**未登记的几何舍入**（卡 I2 硬性规则禁止）：\n`)
  for (const f of failures) console.error(`  ${f.file}:${f.line}\n      ${f.text}`)
  console.error('\n  处置（二选一）：')
  console.error('    ① 几何换算 ⇒ 去掉舍入，改用无损转换（内核已保证整数：`(int) v` / `Int(v)`）')
  console.error(`    ② 确属合法例外（测量/位图/报告）⇒ 在**上一行**加注释说明：\`// ${ALLOW_MARK} 理由\``)
  process.exit(1)
}
console.log('\n✅ 平台层零几何舍入（每个例外都有登记理由）')
