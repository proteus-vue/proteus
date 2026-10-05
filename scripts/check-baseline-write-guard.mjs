#!/usr/bin/env node
// scripts/check-baseline-write-guard.mjs —— ★★★G-61 B5：**基准写入守卫**（D5「基准不得由被测端自证」）
//
// 【它守什么（plan `03-consistency-gates.md` §6 第 4 行）】
//   「采集器与比对器**分离**：App/Skyline 侧脚本**无写基准权限**（路径白名单校验）」
//   动机：基准（`docs/generated/style-baseline/**`）是 **expected 的唯一来源**——若被测端
//   （App / Skyline 的验收脚本）也能写它，就能"把自己的产出当基准"⇒ 一致性判据**自证**（假绿的根）。
//
// 【判据】
//   ① **写入者白名单**：扫描全仓脚本，**只有** `scripts/collect-style-baseline.mjs`（唯一采集器）
//      允许写 `docs/generated/style-baseline/**`；其余任何脚本/宿主代码出现对该路径的**写操作**即红。
//   ② **被测端零引用**：`hosts/**` 里的脚本**不得引用**基准目录（读写都不行——被测端只通过
//      一致性比对引擎消费快照，不直接碰基准文件）。
//   ③ **白名单自身有效**：采集器存在且确实写该目录（防"白名单指向一个不存在的文件"⇒ 门禁空转）。
//
// 【"写操作"的判定（静态扫描面）】`writeFileSync` / `createWriteStream` / `fs.write` / `>` 重定向 /
//   `cp`/`mv` 的目标 / `tee`。★诚实边界：静态扫描抓的是**形态**，不是语义（动态拼接路径抓不到）——
//   但"写入者白名单 + 被测端零引用"两条已覆盖本仓全部基准写入路径（grep 可复核）。
//
// 用法：node scripts/check-baseline-write-guard.mjs
// 退出码：0 通过 / 1 违约
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 基准目录（相对仓根；采集与比对的唯一寻址面） */
const BASELINE_DIR = 'docs/generated/style-baseline'
/**
 * ★允许写基准的脚本（**框架侧**白名单——plan §6「采集器与比对器分离」）：
 *   · 采集器：写**基准样本**（computed.json / geometry.json / png——真浏览器采集）
 *   · 清单生成器：写**基准清单**（manifest.json——从样本产物**机器读取**指纹登记；
 *     它不产数据、只登记数据 ⇒ 属框架侧工具，不是"自证"）
 * ★被禁的是**被测端**（hosts/**）——它们对基准只能经比对引擎远程消费，见判据 ②。
 */
const WRITER_ALLOW = new Set(['scripts/collect-style-baseline.mjs', 'scripts/gen-style-baseline-manifest.mjs'])
/**
 * 写入形态（JS/TS：fs API；shell：重定向 / cp / mv / tee）。
 * ★★B5 修正（本仓实测）：首版对**整份文件**做 pattern 匹配 ⇒ 把"只读脚本里出现任意
 *   `fs.writeFileSync`"也判成"写基准"（`check-baseline-approval` 只是**读** manifest 就被红）。
 *   ⇒ 改为**邻域判定**：写调用与基准路径字面量必须在**同一行或紧邻上下 3 行**内
 *   （目标与调用写在一起的形态覆盖 99%：`writeFileSync(path.join(BASE, …))` / `> docs/…/baseline`）。
 */
const WRITE_PATTERNS = [
  /writeFileSync\s*\(/,
  /createWriteStream\s*\(/,
  /fs\.write(File)?\s*\(/,
  /writeFile\s*\(/,
  /(^|\s|&)>{1,2}\s*\S/, // shell 重定向（> / >>）
  /\btee\s+\S*baseline/i,
  /copyFileSync\s*\(/,
]
/**
 * 基准路径的**引用形态**：只认**基准目录的字面量**（`style-baseline` —— 采集器与门禁都这么写）。
 * ★★B5 修正三连（本仓实测，如实记录）：
 *   ① 首版按"文件含 style-baseline ⇒ 查整份 src 有无任何写调用" ⇒ 只读脚本被误判（邻域判定修）
 *   ② 二版加变量名（\`OUT_DIR\`/\`BASELINE\`）⇒ 与**通用局部变量**同名（report-gaps 的
 *      `BASELINE = benchmarks/gap-baseline.json`）⇒ 又误判（本步修：**不认变量名**）
 *   ③ 结论：**只认路径字面量**——代价是"用变量拼路径写基准"抓不到（诚实边界：本仓无此形态，
 *      grep `style-baseline` 可复核全部引用点）
 */
const BASELINE_REF = /style-baseline/
/** 扫描面（脚本 + 宿主） */
const SCAN_DIRS = ['scripts', 'hosts', '.agents']
const EXTS = ['.mjs', '.js', '.ts', '.sh', '.bash', '.py']

const problems = []

/* ③ 白名单自身有效 */
for (const f of WRITER_ALLOW) {
  const p = path.join(ROOT, f)
  if (!fs.existsSync(p)) problems.push(`③ 白名单指向不存在的采集器：${f}`)
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (/^(node_modules|dist|build|\.git|target|\.tools)/.test(e.name)) continue
      walk(p, acc)
      continue
    }
    if (EXTS.some((x) => e.name.endsWith(x))) acc.push(p)
  }
  return acc
}

let scanned = 0
for (const dir of SCAN_DIRS) {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) continue
  for (const file of walk(abs)) {
    // ★跳过宿主**构建产物**（bundle-*.js / assets/**）：它们由框架产物链生成、不是源脚本
    //   （本仓实测：产物里出现无关大写常量 ⇒ 被"写基准"误判；产物本身也无"写基准"的语义）
    if (/bundle-.*\.js$|\/assets\//.test(file)) continue
    scanned++
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    const src = fs.readFileSync(file, 'utf-8')
    // ① 写入者白名单
    // ★自豁免：本门禁**源码**里以字符串/正则描述被拦形态（同 check-safe-edit 的"注释自污染"处理）
    if (rel === 'scripts/check-baseline-write-guard.mjs') continue
    if (src.includes(BASELINE_DIR) || BASELINE_REF.test(src)) {
      // ★邻域判定（见 WRITE_PATTERNS 注释）：逐行找写调用，检查该行 ±3 行内是否引用基准
      const lines = src.split('\n')
      let writes = false
      for (let i = 0; i < lines.length; i++) {
        if (!WRITE_PATTERNS.some((re) => re.test(lines[i]))) continue
        const lo = Math.max(0, i - 3)
        const hi = Math.min(lines.length, i + 4)
        if (lines.slice(lo, hi).some((l) => BASELINE_REF.test(l))) {
          writes = true
          break
        }
      }
      if (writes && !WRITER_ALLOW.has(rel)) {
        problems.push(`① 非白名单脚本写基准目录：\`${rel}\`（只有采集器 \`${[...WRITER_ALLOW][0]}\` 可写——plan §6）`)
      }
      // ② 被测端零引用（hosts/** 不得出现基准路径——读写都不行）
      if (rel.startsWith('hosts/')) {
        problems.push(`② 被测端（hosts/**）引用基准目录：\`${rel}\`——被测端不得直接碰基准（只经比对引擎消费快照）`)
      }
    }
  }
}

console.log('基准写入守卫（G-61 B5 · D5 基准不得由被测端自证）')
console.log(`  扫描 ${scanned} 个脚本（${SCAN_DIRS.join(' / ')}）· 白名单写入者 ${[...WRITER_ALLOW].join(', ')}`)
if (problems.length) {
  console.log('')
  console.log(`❌ ${problems.length} 项违约：`)
  for (const p of problems) console.log(`    - ${p}`)
  process.exit(1)
}
console.log('')
console.log('✅ 基准写入受控（唯一采集器可写；被测端零引用）')
