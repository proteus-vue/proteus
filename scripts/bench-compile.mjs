#!/usr/bin/env node
// scripts/bench-compile.mjs —— ★卡 C3「超级应用规模编译期性能基线」（零设备 · 零网络 · 秒级）
//
// 【卡 C3 要求】上百页面级项目的**编译耗时、产物体积、增量编译**实测 + **瓶颈识别**。
//
// 【为什么用真项目而不是合成样本（本仓纪律：别用假数据自证）】
//   载体 = `showcase/`（**真项目**：129 个 SFC / 612 KB 源码 / 121 个页面级文件，
//   覆盖 subpackages 分包、多端产物、真实业务组件）。合成样本会漏掉真实代码形状
//   （如 `<p-*>` 语义标签密度、slot 嵌套、scss 变量、长模板）带来的编译成本。
//
// 【四个读数（每个都能单独复算）】
//   ① 全量：首遍（冷 JIT）/ 次遍（热 JIT）总耗时 + 每文件均值 + 吞吐 KB/s
//   ② 增量：单文件"改一处 → 重编译"耗时（本项目语义：编译无跨文件缓存，
//      增量 = Vite 层的模块失效 + 单文件重编译；故这里测**单文件重编译**的冷/热）
//   ③ 体积：wxml + js + wxss 产物总字节 / 源码字节（膨胀比）
//   ④ 瓶颈：按阶段（template/script/style）事件数 + 最热规则 + 最慢文件清单
//
// 【诚实边界（读这些数字前必须知道）】
//   · **绝对毫秒不跨机可比**（本仓既有认识：异构 CI 同机实测可达 1.6×）⇒ 只做**同机对比/趋势**；
//     机器无关的判据用**比值**（如产物体积比、阶段事件占比）。
//   · 这里的"编译"= **Proteus 编译器**（SFC → 小程序产物）的纯编译耗时，
//     **不含** Vite 打包 / Babel 转译 / 依赖预构建 —— 那是构建链的其它段，
//     完整构建耗时见 `time pnpm build:showcase:web`（另在文档记录）。
//   · 读数为**单进程串行**；真实构建是 Vite 多模块并行 ⇒ 只作**编译器单核成本**的上界估计。
//
// 用法：
//   npx tsx scripts/bench-compile.mjs               # 打印基线（人读）
//   npx tsx scripts/bench-compile.mjs --json        # JSON（供门禁/CI 消费）
//   npx tsx scripts/bench-compile.mjs --check       # 与 benchmarks/compile-baseline.json 比对（回归即红）
//   npx tsx scripts/bench-compile.mjs --update      # 写回基线（★人工确认后）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileVueSfc } from '@proteus-vue/compiler'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = path.join(ROOT, 'benchmarks', 'compile-baseline.json')
const TARGET = path.join(ROOT, 'showcase')

const argv = process.argv.slice(2)
const AS_JSON = argv.includes('--json')
const CHECK = argv.includes('--check')
const UPDATE = argv.includes('--update')

// ── 收集真项目源码 ──────────────────────────────────────────────────────────
const files = []
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.vue')) files.push(p)
  }
})(TARGET)

/** 已知不参与纯编译的文件（诚实标注原因，而非静默跳过） */
const SKIP = [
  {
    match: 'showcase/router/RouterView.vue',
    why: '产物含 `import.meta` —— 纯编译模式下 `assertValidResult` 的语法校验会拒（真构建里由 Vite 处理该语法）⇒ 本基线不含它',
  },
]
const skipReasons = []
const sources = []
for (const f of files) {
  const rel = path.relative(ROOT, f)
  const skip = SKIP.find((s) => rel === s.match)
  if (skip) { skipReasons.push(`${rel}：${skip.why}`); continue }
  sources.push([rel, fs.readFileSync(f, 'utf-8')])
}

// ── ① 全量编译 ─────────────────────────────────────────────────────────────
function compileAll() {
  const t0 = performance.now()
  let outBytes = 0
  const perFile = []
  for (const [rel, src] of sources) {
    const f0 = performance.now()
    const r = compileVueSfc(src, { filename: rel })
    perFile.push({ file: rel, ms: performance.now() - f0, srcBytes: Buffer.byteLength(src) })
    outBytes += Buffer.byteLength(r.wxml) + Buffer.byteLength(r.js) + Buffer.byteLength(r.wxss)
  }
  return { totalMs: performance.now() - t0, outBytes, perFile }
}

const cold = compileAll() // 首遍：冷 JIT
const hot = compileAll()  // 次遍：热 JIT（★基线判据用这一遍——冷启动噪声大）

const srcBytes = sources.reduce((a, [, s]) => a + Buffer.byteLength(s), 0)
const fileCount = sources.length

// ── ② 增量：单文件"改一处 → 重编译"（取真项目里最大的文件，最坏情形）──
const biggest = [...sources].sort((a, b) => Buffer.byteLength(b[1]) - Buffer.byteLength(a[1]))[0]
const bigSrc = biggest[1]
const bigRel = biggest[0]
const mutated = bigSrc.includes('</template>')
  ? bigSrc.replace('</template>', '\n</template>')
  : bigSrc + '\n'
compileVueSfc(bigSrc, { filename: bigRel })       // 预热
const incSamples = []
for (let i = 0; i < 5; i++) {
  const t0 = performance.now()
  compileVueSfc(mutated, { filename: bigRel })
  incSamples.push(performance.now() - t0)
}
incSamples.sort((a, b) => a - b)
const incMedian = incSamples[Math.floor(incSamples.length / 2)]

// ── ④ 瓶颈：阶段事件数 + 最热规则（从产物 trace 统计）──
const ruleCount = new Map()
const phaseCount = new Map()
for (const [rel, src] of sources) {
  const r = compileVueSfc(src, { filename: rel })
  for (const ev of r.trace ?? []) {
    ruleCount.set(ev.ruleId, (ruleCount.get(ev.ruleId) ?? 0) + 1)
    phaseCount.set(ev.phase, (phaseCount.get(ev.phase) ?? 0) + 1)
  }
}
const topRules = [...ruleCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  .map(([ruleId, count]) => ({ ruleId, count }))
const slowest = [...hot.perFile].sort((a, b) => b.ms - a.ms).slice(0, 8)

const result = {
  target: 'showcase（真项目）',
  fileCount,
  srcKB: +(srcBytes / 1024).toFixed(1),
  coldTotalMs: +cold.totalMs.toFixed(1),
  hotTotalMs: +hot.totalMs.toFixed(1),
  hotMsPerFile: +(hot.totalMs / fileCount).toFixed(3),
  hotThroughputKBs: +(srcBytes / 1024 / (hot.totalMs / 1000)).toFixed(0),
  incrementalMedianMs: +incMedian.toFixed(2),
  incrementalFile: bigRel,
  outKB: +(hot.outBytes / 1024).toFixed(1),
  /** ★体积膨胀比（机器无关 —— 可作为跨机判据） */
  sizeRatio: +(hot.outBytes / srcBytes).toFixed(3),
  phases: Object.fromEntries([...phaseCount.entries()].sort()),
  topRules,
  slowest: slowest.map((p) => ({ file: p.file, ms: +p.ms.toFixed(1), srcKB: +(p.srcBytes / 1024).toFixed(1) })),
  skipped: skipReasons,
}

// ── 输出 / 校验 ────────────────────────────────────────────────────────────
if (AS_JSON || CHECK || UPDATE) {
  if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true })
    fs.writeFileSync(BASELINE, JSON.stringify({ updatedAt: new Date().toISOString(), result }, null, 2) + '\n')
    console.log(`[bench-compile] ✅ 基线已写回 ${path.relative(ROOT, BASELINE)}`)
    process.exit(0)
  }
  if (CHECK) {
    if (!fs.existsSync(BASELINE)) {
      console.error('[bench-compile] ✗ 基线缺失——先跑 `npx tsx scripts/bench-compile.mjs --update`')
      process.exit(2)
    }
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf-8')).result
    const failures = []
    // ★判据取向：**比值/结构量为主**（跨机可比），绝对毫秒只作宽松上界（本仓既有纪律）
    if (result.sizeRatio > base.sizeRatio * 1.15) {
      failures.push(`体积膨胀比 ${result.sizeRatio} > 基线 ${base.sizeRatio} × 1.15（产物显著变大）`)
    }
    if (result.fileCount !== base.fileCount) {
      failures.push(`文件数 ${result.fileCount} ≠ 基线 ${base.fileCount}（目标项目变了 ⇒ 基线需重设，不是回归）`)
    }
    if (result.hotTotalMs > base.hotTotalMs * 3) {
      failures.push(`全量热编译 ${result.hotTotalMs}ms > 基线 ${base.hotTotalMs}ms × 3（宽松上界；绝对耗时跨机不可比）`)
    }
    if (result.incrementalMedianMs > base.incrementalMedianMs * 3) {
      failures.push(`增量中位 ${result.incrementalMedianMs}ms > 基线 ${base.incrementalMedianMs}ms × 3`)
    }
    if (failures.length) {
      console.error('[bench-compile] ✗ 编译期基线回归：')
      for (const f of failures) console.error(`  - ${f}`)
      process.exit(1)
    }
    console.log(`[bench-compile] ✅ 编译期基线通过（膨胀比 ${result.sizeRatio} · 全量热 ${result.hotTotalMs}ms · 增量中位 ${result.incrementalMedianMs}ms）`)
    process.exit(0)
  }
  console.log(JSON.stringify(result, null, 2))
  process.exit(0)
}

// 人读输出
console.log(`[bench-compile] 载体：${result.target} · ${fileCount} 文件 / ${result.srcKB} KB 源码`)
console.log(`  ① 全量：冷 ${result.coldTotalMs}ms · 热 **${result.hotTotalMs}ms**（${result.hotMsPerFile} ms/文件 · ${result.hotThroughputKBs} KB/s）`)
console.log(`  ② 增量：单文件改一处重编译中位 **${result.incrementalMedianMs}ms**（${result.incrementalFile}，最大文件）`)
console.log(`  ③ 体积：产物 ${result.outKB} KB / 源码 ${result.srcKB} KB = **${result.sizeRatio}x**`)
console.log(`  ④ 瓶颈：阶段事件 ${Object.entries(result.phases).map(([k, v]) => `${k}=${v}`).join(' · ')}`)
console.log('     最热规则：')
for (const r of result.topRules.slice(0, 6)) console.log(`       ${String(r.count).padStart(5)}  ${r.ruleId}`)
console.log('     最慢文件：')
for (const p of result.slowest.slice(0, 5)) console.log(`       ${String(p.ms).padStart(6)}ms  ${p.srcKB}KB  ${p.file}`)
if (skipReasons.length) console.log(`  跳过（已标注原因）：${skipReasons.length} 个`)
for (const s of skipReasons) console.log(`       · ${s}`)
