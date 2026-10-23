#!/usr/bin/env node
// scripts/capability-app-feasibility.mjs —— ★能力端 App 缺口**可行性三分类**（排期输入）
//
// 【它回答什么问题】`capability-app-gap.mjs` 给出"桥方法缺什么"，但不回答
//   **"这项要写多少原生代码"**——而后者才是排期真正需要的。
//   按 useFetch 的成功标准（#1171/#1206）：**底层平台栈本来就有，只差接线 + 线格式 + 判据** ⇒ 一批能做。
//   反之，"三端各写一个平台子系统（权限申请/相机/蓝牙/支付）" ⇒ 那不是一批，是每项一个小项目。
//
// 【三分类口径（全部来自源码事实，不靠印象）】
//   · **A 零原生**：三端宿主**已能**用既有方法组合实现（例：`getStorage` 可由 `fs.*` 适配，
//     Android/iOS 已有 `fs.readBytes/writeBytes/remove`）。
//   · **B 需补原生（单端/局部）**：宿主**部分**具备（例：某端有、某端无）。
//   · **C 平台子系统**：三端都要新写平台集成（定位/相机/蓝牙/支付/相册…）。
//
// ★诚实边界：本工具只按"方法名/关键字在宿主源码里出现"做**保守**判定——
//   出现 ≠ 完整可用（权限、UI 交互、回调模型都可能还要做）。它的用途是**排除**
//   "以为只差接线、实际要写大工程"的误判，不是给"能直接做"背书。
//
// 用法：node scripts/capability-app-feasibility.mjs [--json]
// 退出码：0（缺口存在不是错误——这是排期输入，不是门禁）
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JSON_OUT = process.argv.includes('--json')

/** 收集某目录下所有源码文本（按端） */
function readTree(dir, exts, maxFiles = 400) {
  const out = []
  const walk = (d) => {
    let ents = []
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      if (out.length >= maxFiles) return
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'build' || e.name === '.git') continue
        walk(p)
      } else if (exts.some((x) => e.name.endsWith(x))) {
        try {
          out.push(fs.readFileSync(p, 'utf8'))
        } catch {
          /* 读不了就跳过 */
        }
      }
    }
  }
  walk(path.join(ROOT, dir))
  return out.join('\n')
}

const ENDS = {
  android: readTree('hosts/android/app/src/main/java', ['.java']),
  ios: readTree('hosts/ios/ProteusHost', ['.swift']),
  harmony: readTree('hosts/harmony/host-app', ['.h', '.cpp', '.ets']),
}

/**
 * 每个缺失方法 → 探测线索（正则）。
 * ★★★**探针必须锚定到"平台 API 标识符"，不能用泛词**——
 *   本文件第一版用 `/map/`、`/live/`、`/push/` 之类泛词 ⇒ `createMap`/`joinLiveRoom`/
 *   `createLivePusher`/`getTranslation` 全被误判成"零原生可做"（那些词在渲染内核/注释里到处都有）。
 *   这与本仓反复记的教训同源：**正则命中注释/无关代码 ≠ 能力存在**。
 *   ⇒ 现在的口径更窄：**宁可把"其实能做"误归到 C（需要人工核），也不要把"要大工程"误报成"一批能做"**。
 *   ★没有可靠锚点的方法一律**不设探针** ⇒ 归 C（"未知"按"要写工程"对待）。
 */
const PROBES = {
  // ── 可靠锚点（平台 API 标识符明确）──
  getStorage: /\bfs\.(readBytes|writeBytes|remove)\b/,
  log: /\blogcat\b|\bNSLog\b|\bos_log\b|\bhilog\b/,
  share: /UIActivityViewController|ACTION_SEND|shareService/,
  getCookieJar: /CookieManager|HTTPCookieStorage|WebCookieManager/,
  getFileSystem: /\bfs\.(readBytes|writeBytes|remove)\b/,
  // ── 以下**故意不设探针**（第一版误判过的 / 没有可靠锚点的）──
  // createMap / joinLiveRoom / createLivePusher / getTranslation / createCacheManager /
  // createCanvas / getWifi / getLocation / getPermission / track … 全部归 C，由人工核。
}

const gapJson = (() => {
  const out = execSync(`node ${path.join(ROOT, 'scripts/capability-app-gap.mjs')} --json`, {
    encoding: 'utf8',
  })
  return JSON.parse(out)
})()

const methods = new Map()
for (const g of gapJson.gaps) {
  for (const m of g.missing) {
    if (!methods.has(m)) methods.set(m, [])
    methods.get(m).push(g.hook)
  }
}

const rows = []
for (const [method, hooks] of methods) {
  const probe = PROBES[method]
  const hits = probe ? Object.entries(ENDS).filter(([, txt]) => probe.test(txt)).map(([k]) => k) : []
  // A：三端都有线索（可用既有能力组合）
  // B：部分端有线索
  // C：都没有线索（要新写平台子系统）——或没有探针（未知，保守归 C）
  let cls = 'C'
  if (hits.length === 3) cls = 'A'
  else if (hits.length > 0) cls = 'B'
  rows.push({ method, hooks, hits, cls, hasProbe: !!probe })
}

rows.sort((a, b) => (a.cls === b.cls ? b.hooks.length - a.hooks.length : a.cls < b.cls ? -1 : 1))

if (JSON_OUT) {
  console.log(JSON.stringify({ rows, summary: { A: rows.filter(r => r.cls === 'A').length, B: rows.filter(r => r.cls === 'B').length, C: rows.filter(r => r.cls === 'C').length } }, null, 2))
  process.exit(0)
}

const A = rows.filter((r) => r.cls === 'A')
const B = rows.filter((r) => r.cls === 'B')
const C = rows.filter((r) => r.cls === 'C')
console.log('[capability-app-feasibility] App 缺口可行性三分类（按"底层平台栈是否已有"）')
console.log(`  A 零原生（三端都有线索，可用既有方法组合）: ${A.length} 个方法`)
console.log(`  B 需补原生（部分端有）: ${B.length} 个方法`)
console.log(`  C 平台子系统（三端都要新写）: ${C.length} 个方法`)
const show = (name, list) => {
  if (!list.length) return
  console.log(`\n  ── ${name} ──`)
  for (const r of list) {
    console.log(`   · ${r.method.padEnd(24)} [${r.hits.join(',') || '无线索'}] ← ${r.hooks.join(', ')}`)
  }
}
show('A 零原生（可成一批，最接近 useFetch 形态）', A)
show('B 需补原生', B)
show('C 平台子系统（每项一个小项目）', C)
console.log('\n  ★口径：线索 = 平台既有能力在宿主源码里出现，**不代表该能力已完整可用**')
console.log('    （权限申请/UI 交互/回调模型可能仍要写）。本工具用于**排除误判**，不是给"能直接做"背书。')
