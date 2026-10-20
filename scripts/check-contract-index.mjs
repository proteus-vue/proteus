#!/usr/bin/env node
// scripts/check-contract-index.mjs —— ★★★决策 #1137：**跨端契约索引的自检门禁**
//
// 【为什么索引本身需要判据（这是本仓第 9 次同族教训）】
//   本仓已经踩过 8 次「判据/文档腐化后静默失效」：
//     生成器源集合过期（#1123）· 抽取器贪婪正则（#1129）· 门禁路径指向已搬迁文件（#1131）·
//     探针登记三处漏改（#1134）· hook 判据覆盖面（#1132）……
//   索引比这些**更危险**：它是"我该跑什么门禁"的唯一入口，
//   一旦它过期，AI 会**以为查过了**然后漏跑关键门禁 —— **比没有索引更糟**。
//   ⇒ 索引必须有机器判据，且必须是**白名单制**（新增跨端门禁不登记 ⇒ 红）。
//
// 【判据三条】
//   ① 索引里引用的每个**文件路径**真实存在（防改名/删除后索引静默过期）；
//   ② 索引里引用的每条 `check:*` / 测试文件真实存在（防命令名写错）；
//   ③ **每条"跨端一致性类"门禁都必须在索引里出现**（白名单，见 CONTRACT_GATES）。
//
// 【用法】
//   node scripts/check-contract-index.mjs              # 全量校验（CI / verify）
//   node scripts/check-contract-index.mjs --for <path> # 给定改动路径 ⇒ 打印命中的契约节
// 退出码：0 通过 / 1 有缺口 / 2 环境错误
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// ★#1139：「最小可闭环单元」探针表（一条 tag → 五端三处定位）
import { endsFor, FETCH_LAYERS, NOT_IN_META_FIELDS, VAPOR_SLOT_LAYERS, VAPOR_THREE_ENDS, VAPOR_SLOT_GATES, VAPOR_SLOT_FINGERPRINT_HINT } from './lib/contract-units.mjs'
// ★#1139：`endsFor(name)` 按**方向**返回端点集（去程 TAG_* / 回程 RTAG_*）——
//   首版只认 TAG_* ⇒ 查 StreamSeq/HttpStatus 时 encode/decode 全 `—`（探针自身缺陷）。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INDEX = path.join(ROOT, 'docs', 'contract-index.md')

/**
 * **跨端一致性门禁白名单**（每条都必须在索引里出现）。
 * ★新增此类门禁时，加进本清单 —— 漏加 ⇒ 门禁红（而不是"索引悄悄少一节"）。
 * ★判定口径：改动一处即要求"同步 N 端"的门禁（parity / sync / three-end / golden / contract）。
 */
const CONTRACT_GATES = [
  'check:invoke-wire-parity', // 线格式五端
  'check:host-invoke-contract', // Invoke 方法契约
  'check:vapor-three-end', // Vapor 三端
  'check:bridge-sync', // 桥源真源 ⇄ 副本
  'check:harmony-runtime-prebuilt', // 鸿蒙 runtime 副本
  'check:cross-end-golden', // 布局 golden
  'check:capability-golden', // 能力 golden
  'check:anim-color-golden', // 动画颜色 golden
  'check:style-ir-golden', // StyleIR golden
  'check:glass-pixel-parity', // 玻璃像素
  'check:glass-parity-harmony', // 玻璃鸿蒙对齐
  'check:content', // 文档生成器（源集合）
  'check:docs-stats', // 文档数字
  'check:reference', // 参考页
  'check:file-size', // 文件大小棘轮
  'check:repo-hygiene', // 构建产物不得入库
  'check:vapor-capability', // Vapor 能力面
]

/** 索引里也会引用这些**测试文件**（不是 package script）。 */
const TEST_SCRIPTS = [
  'tests/fetch-wire-fields.test.ts',
  'tests/host-probe-registry.test.ts',
]

const argv = process.argv.slice(2)
const forArg = argv.indexOf('--for')
const unitArg = argv.indexOf('--unit')

if (!fs.existsSync(INDEX)) {
  console.error(`✗ 索引不存在：${INDEX}`)
  process.exit(2)
}
const text = fs.readFileSync(INDEX, 'utf8')

// ── ① 索引里引用的文件路径必须存在 ─────────────────────────────────────────────
/** 从 markdown 里抽反引号包裹的"像路径"的 token。 */
function pathsIn(md) {
  const out = new Set()
  for (const m of md.matchAll(/`([^`\n]+)`/g)) {
    const t = m[1].trim()
    // 只认"仓库内路径"形态：不以 http/命令开头、含 / 或以已知扩展名结尾
    if (/^(https?:|pnpm |npx |node |bash |git |brew )/.test(t)) continue
    if (!/^[A-Za-z0-9_.\-/]+$/.test(t)) continue
    if (!(t.includes('/') || /\.(ts|mjs|java|swift|rs|h|cpp|json|md)$/.test(t))) continue
    out.add(t)
  }
  return [...out]
}

/**
 * 索引里有些是**目录**（以 `/` 结尾）、有些是**通配**（`*`）、有些是 `.md` 页面路径。
 * ⇒ 只校验"看起来是具体文件"的：有扩展名、不含 `*`、不以 `/` 结尾。
 */
function isConcretePath(t) {
  if (t.includes('*')) return false
  if (t.endsWith('/')) return false
  return /\.(ts|mjs|java|swift|rs|h|cpp|json|md)$/.test(t)
}

// ── ③ 白名单：每条跨端门禁都必须在索引里出现 ───────────────────────────────────
const missingGates = CONTRACT_GATES.filter((g) => !text.includes(g))

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const scripts = pkg.scripts ?? {}
const badGateNames = CONTRACT_GATES.filter((g) => !(g in scripts))

const referenced = pathsIn(text)
const concrete = referenced.filter(isConcretePath)
const missingPaths = concrete.filter((p) => !fs.existsSync(path.join(ROOT, p)))
const missingTests = TEST_SCRIPTS.filter((t) => !text.includes(t) || !fs.existsSync(path.join(ROOT, t)))

/** 超过这个行数就算"巨型文件"，必须有区段锚点（否则读面失控）。 */
const LARGE_FILE_LINES = 1000

// ── --unit：给定契约点 ⇒ 打印"改它要读哪几个文件的哪几段"（最小可闭环单元）──
//
// ★#1139：这是"下次会话能不能只读 3 个文件就改对"的直接落地。
//   实测：改一个线格式 tag，五端编解码器各 500~590 行（合计 2734 行），
//   但每端**真正要动的只有三处**（常量 / encode / decode），合计约 50 行。
//   瓶颈不是代码总量，而是**不知道那三处在哪** ⇒ 本模式把定位机器化。
if (unitArg >= 0) {
  const spec = argv[unitArg + 1]
  // ★#1141：`vapor-slot` 是**无参数**单元（它没有"哪个槽位"这一层——整类一起看）
  if (!spec) {
    console.error('✗ 用法：--unit tag:<Name> | fetch-field:<Name> | vapor-slot')
    process.exit(2)
  }
  const colonAt = spec.indexOf(':')
  const kind = colonAt >= 0 ? spec.slice(0, colonAt) : spec
  const name = colonAt >= 0 ? spec.slice(colonAt + 1) : ''
  // tag / fetch-field 需要名字；vapor-slot 不需要
  if (colonAt < 0 && kind !== 'vapor-slot') {
    console.error(`✗ 单元 \`${kind}\` 需要参数（例：--unit ${kind}:<Name>）`)
    process.exit(2)
  }
  if (kind === 'fetch-field') {
    // ★#1140：useFetch 四层字段链——#1134 的 redirectManual 就是漏在第③层
    console.log(`═══ 最小可闭环单元：useFetch 字段 \`${name}\`（四层链）═══`)
    let missing = 0
    for (const layer of FETCH_LAYERS) {
      const abs = path.join(ROOT, layer.file)
      if (!fs.existsSync(abs)) {
        console.error(`  ✗ ${layer.name}: 文件不存在 ${layer.file}`)
        missing++
        continue
      }
      const lines = fs.readFileSync(abs, "utf8").split("\n")
      const re = layer.re(name)
      let hit = 0
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) { hit = i + 1; break }
      }
      if (hit) {
        console.log(`  ✓ ${layer.name}`)
        console.log(`      ${layer.file}:${hit}  （读 L${Math.max(1, hit - 6)}-${hit + 6}）`)
      } else if (NOT_IN_META_FIELDS.has(name) && layer.name.startsWith("④")) {
        // 正当：该字段由别的通道承载（流式/参数），不落 meta
        console.log(`  ○ ${layer.name} —— \`${name}\` 不落 meta（走流式/参数通道，正当）`)
      } else {
        console.error(`  ✗ ${layer.name}: 未命中 ⇒ **该层吃掉这个字段**（功能会静默失效）`)
        missing++
      }
    }
    console.log("")
    if (missing) {
      console.error(`✗ ${missing} 层缺失——补上后重跑；这是 #1134 「漏一层 = 静默失效」的形态`)
      console.error("  定向判据：npx vitest run tests/fetch-wire-fields.test.ts")
      process.exit(1)
    }
    console.log("★必须跑：npx vitest run tests/fetch-wire-fields.test.ts（断言四层齐全 + 管线字段不下传）")
    console.log("★纪律：管线字段（retry/priority/maxRedirects/onRedirect/redirect）**不下传** App 线格式")
    process.exit(0)
  }

  if (kind === 'vapor-slot') {
    // ★#1141：Vapor 槽位——三类单元里最复杂（三端 + 17 项指纹）
    console.log('═══ 最小可闭环单元：Vapor 槽位（三端 + 17 项指纹）═══')
    console.log('  ★这一类**不能一条命令闭环**：三端要真机/模拟器（CI 跑不了）')
    console.log('')
    let bad = 0
    console.log('【① 要改的层（按数据流顺序）】')
    for (const layer of VAPOR_SLOT_LAYERS) {
      const abs = path.join(ROOT, layer.file)
      if (!fs.existsSync(abs)) {
        console.error(`  ✗ ${layer.name}: 文件不存在 ${layer.file}`)
        bad++
        continue
      }
      const lines = fs.readFileSync(abs, "utf8").split("\n")
      console.log(`  ✓ ${layer.name}`)
      console.log(`      ${layer.file}（${lines.length} 行）`)
      // ★巨型文件必须给区段：否则"5 层"会退化成读 1 万行（那就失去意义了）
      // ★★#1141 实测缺陷：首版只在 anchors 存在时检查是否命中 ⇒ **删掉 anchors 后静默通过**
      //   （探针 exit 0、判据全绿）。⇒ 现在：**行数超阈值却没有 anchors ⇒ 直接判红**。
      if (!layer.anchors?.length && lines.length > LARGE_FILE_LINES) {
        console.error(`      ✗ ${layer.file} 有 ${lines.length} 行却未定义区段锚点（须给 anchors）`)
        bad++
      }
      if (layer.anchors?.length) {
        const hits = []
        for (const re of layer.anchors) {
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) { hits.push(i + 1); break }
          }
        }
        if (hits.length) {
          const ranges = hits.map((n) => `L${Math.max(1, n - 12)}-${n + 12}`)
          console.log(`      ★只需读 ${ranges.join(" / ")}（锚点 ${hits.join(", ")}）`)
        } else {
          console.error(`      ✗ 区段锚点未命中（源码形态变了？）——该层可能已重构`)
          bad++
        }
      }
      console.log(`      ${layer.note}`)
    }
    console.log("")
    console.log('【② 三端必须重跑并提交证据（CI 复算判据）】')
    for (const e of VAPOR_THREE_ENDS) {
      const abs = path.join(ROOT, e.evidence)
      const ok = fs.existsSync(abs)
      console.log(`  ${ok ? "✓" : "✗"} ${e.end.padEnd(8)} ${e.evidence}`)
      console.log(`      $ ${e.run}`)
      if (!ok) {
        console.error(`      ✗ 证据缺失 ⇒ 该端未重跑（★陈旧证据会冒充新证据）`)
        bad++
      }
    }
    console.log("")
    console.log('【③ 必须跑的门禁】')
    for (const g of VAPOR_SLOT_GATES) console.log(`  $ ${g}`)
    console.log("")
    console.log('【④ 会被比对出的指纹项（改槽位最可能影响这些）】')
    for (const f of VAPOR_SLOT_FINGERPRINT_HINT) console.log(`  · ${f}`)
    console.log("")
    if (bad) {
      console.error(`✗ ${bad} 处不完整——补齐后重跑`)
      process.exit(1)
    }
    console.log('★纪律：三端证据必须**同一轮**跑出（陈旧证据冒充新证据是本仓实测过的形态）')
    process.exit(0)
  }

  if (kind !== 'tag') {
    console.error(`✗ 未知单元类型：${kind}（支持：tag / fetch-field）`)
    process.exit(2)
  }

  console.log(`═══ 最小可闭环单元：线格式 tag \`${name}\` ═══`)
  let totalLines = 0
  let missing = 0
  for (const end of endsFor(name)) {
    const abs = path.join(ROOT, end.file)
    if (!fs.existsSync(abs)) {
      console.error(`  ✗ ${end.name}: 文件不存在 ${end.file}`)
      missing++
      continue
    }
    const lines = fs.readFileSync(abs, "utf8").split("\n")
    const find = (re) => {
      for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1
      return 0
    }
    // ★按端转换常量名：TS 用帕斯卡（MetaTagInvoke.Redirect），四端用大写下划线（TAG_REDIRECT）
    const key = end.key(name)
    const c = find(end.constRe(key))
    const e = find(end.encodeRe(key))
    const d = find(end.decodeRe(key))
    const hits = [c, e, d].filter((x) => x > 0)
    if (hits.length < 2) {
      console.error(`  ✗ ${end.name}: 三处只命中 ${hits.length} 处（该端未实现 \`${name}\`？或查错方向）`)
      console.error(`      ★去程 tag 用 \`tag:<Name>\`（TAG_*）；若它是回程 tag，应已在 RESOLVE_TAG_NAMES 里`)
      missing++
      continue
    }
    // 只读区段：每处上下各扩 8 行（够看清上下文而不通读整文件）
    const ranges = hits.map((n) => `L${Math.max(1, n - 8)}-${n + 8}`)
    totalLines += hits.length * 17
    console.log(`  · ${end.name}`)
    console.log(`      ${end.file}`)
    console.log(`      常量 ${c || "—"} · encode ${e || "—"} · decode ${d || "—"}  （读 ${ranges.join(" / ")}）`)
  }
  console.log("")
  if (missing) {
    console.error(`✗ ${missing} 端缺该 tag（半同步状态——按各端提示补齐后重跑）`)
    process.exit(1)
  }
  console.log(`★最小读面：约 ${totalLines} 行（而非整文件 2734 行）`)
  console.log("★必须跑：`pnpm check:invoke-wire-parity`（五端逐字节对拍，36 条向量）")
  console.log("★纪律：新 tag 的向量必须**成对**（true 写 tag / false 不写 tag），否则漏网实现")
  process.exit(0)
}

// ── --for：给定改动路径 ⇒ 打印命中的契约节 ────────────────────────────────────
if (forArg >= 0) {
  const target = argv[forArg + 1]
  if (!target) {
    console.error('✗ --for 需要一个路径参数')
    process.exit(2)
  }
  // 按 "## " 切节（跳过前言）
  const sections = text.split(/^## /m).slice(1)
  const hit = sections.filter((sec) => sec.includes(target) || sec.includes(path.basename(target)))
  if (!hit.length) {
    console.log(`[contract-index] 路径 ${target} 未命中任何契约节（可能确实不涉及跨端契约）`)
    console.log('  ★若它属于某条契约但表里没有 ⇒ 补表（这不是"没问题"，是"索引不全"）')
    process.exit(0)
  }
  for (const sec of hit) {
    const title = sec.split('\n')[0].trim()
    console.log(`\n═══ 命中契约：${title} ═══`)
    const mustRun = sec.match(/\*\*必须跑\*\*[：:]\s*([\s\S]*?)(?:\n\n|$)/)
    if (mustRun) console.log(mustRun[1].trim())
    else console.log('（该节没有"必须跑"清单——请补）')
  }
  process.exit(0)
}

// ── 常规校验 ────────────────────────────────────────────────────────────────
console.log(`契约索引自检（${path.relative(ROOT, INDEX)} · 白名单 ${CONTRACT_GATES.length} 条跨端门禁）`)
let bad = 0

if (missingGates.length) {
  bad++
  console.error(`\n❌ 这些跨端门禁**没有**出现在索引里（AI 无从知道该跑它）：`)
  for (const g of missingGates) console.error(`  - ${g}`)
  console.error('  修法：在 docs/contract-index.md 对应小节补上该门禁（并写清触发条件与后果）')
}

if (badGateNames.length) {
  bad++
  console.error(`\n❌ 白名单里有 package.json 中不存在的门禁（判据自身写错）：`)
  for (const g of badGateNames) console.error(`  - ${g}`)
}

if (missingPaths.length) {
  bad++
  console.error(`\n❌ 索引引用的文件/目录**不存在**（改名或删除后索引已过期）：`)
  for (const p of missingPaths.slice(0, 20)) console.error(`  - ${p}`)
  if (missingPaths.length > 20) console.error(`  …另有 ${missingPaths.length - 20} 个`)
  console.error('  修法：更新索引路径（★索引过期比没有索引更糟——AI 会以为查过了）')
}

if (missingTests.length) {
  bad++
  console.error(`\n❌ 索引引用的测试文件缺失或未提及：`)
  for (const t of missingTests) console.error(`  - ${t}`)
}

if (bad) {
  console.error(`\n✗ 契约索引不自洽（${bad} 类问题）`)
  process.exit(1)
}

console.log(`  ✓ ${concrete.length} 个路径引用全部存在`)
console.log(`  ✓ ${CONTRACT_GATES.length} 条跨端门禁全部在表内且命令名有效`)
console.log(`  ✓ ${TEST_SCRIPTS.length} 个判据文件在位`)
console.log('\n✅ 跨端契约索引自洽（AI 可据此一次查到"改这里要跑什么"）')
process.exit(0)
