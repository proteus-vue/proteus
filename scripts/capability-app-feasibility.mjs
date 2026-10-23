#!/usr/bin/env node
// scripts/capability-app-feasibility.mjs —— ★能力端 App 缺口**可行性三分类**（排期输入）
//
// 【它回答什么问题】`capability-app-gap.mjs` 给出"桥方法缺什么"，但不回答
//   **"这项要写多少原生代码"**——而后者才是排期真正需要的。
//   按 useFetch 的成功标准（#1171/#1206）：**底层平台栈本来就有，只差接线 + 线格式 + 判据** ⇒ 一批能做。
//   反之，"三端各写一个平台子系统（权限申请/相机/蓝牙/支付）" ⇒ 那不是一批，是每项一个小项目。
//
// 【三分类口径（★第二版修正，全部来自源码事实）】
//   · **A 零原生**：所需宿主方法**已存在**，JS 侧组合即可
//     （例：`getStorage` 复用早已存在的 `fs.readBytes/writeBytes/remove`）。
//   · **B 需新增宿主方法**：方法不存在，但三端平台 API 都有 ⇒ **三端各加一个方法** + 登记契约。
//   · **C 平台子系统**：平台 API 也不是三端都有（定位/相机/蓝牙/支付/相册…）。
//   ★第一版把"平台有 API"当成 A 类判据，误把 `log`/`getCookieJar` 判成零原生——
//     而宿主根本没有 `log.*`/`cookie.*` 方法。**A 类的判据只能是"方法真的存在"。**
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
 * **宿主已实现的能力方法名**（从三端源码里抽 `"<ns>.<verb>"` 形式的字符串常量）。
 * ★这是 A 类（零原生）的唯一判据——"方法真的存在"比"平台有 API"强得多。
 */
const HOST_METHODS = (() => {
  const re = /"((?:fs|http|device|clipboard|screen|update|window|worker|idle|preload|extension|mini-program|host|webassembly|native|dev|keyboard|cookie|log|storage)\.[A-Za-z][A-Za-z0-9.]*)"/g
  const set = new Set()
  for (const txt of Object.values(ENDS)) {
    for (const m of txt.matchAll(re)) set.add(m[1])
  }
  return set
})()

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

/**
 * ★★★#1210 口径修正（本工具第二版）：**"平台有 API" ≠ "能力通道可用"**。
 *
 * 第一版直接拿"平台 API 是否出现"当 A 类判据 ⇒ 把 `log` / `getCookieJar` 判成"零原生可做"，
 * 而实际上**宿主根本没有 `log.*` / `cookie.*` 能力方法** ⇒ 接入能力通道**必须三端各写一个方法**
 * （还要登记契约 + 过 `check:host-invoke-contract`）。那不是"零原生"。
 *
 * 真正的"零原生"只有一种形态：**所需的宿主能力方法已经存在**，JS 侧组合即可
 * （`getStorage` 就是 —— 它复用早已存在的 `fs.readBytes/writeBytes/remove`）。
 *
 * ⇒ 三层判据（顺序即成本从低到高）：
 *   **A 零原生**：所需的宿主方法**已存在**（`HOST_EXISTING` 命中）
 *   **B 需新增宿主方法**：方法不存在，但三端平台 API 都有（探针命中 3 端）⇒ 三端各加一个方法
 *   **C 平台子系统**：平台 API 也不是三端都有（或没可靠线索）⇒ 每项一个小项目
 */
const HOST_EXISTING = new Set(HOST_METHODS)

/**
 * 缺失方法 → **可复用的既有宿主方法**（若有）。
 *
 * ★★★#1210 第二处修正（同样来自自我纠正）：**必须要求"桥接口所需的方法全部被覆盖"**，
 *   不能只看"有至少一个能复用"。
 *   反例（本工具第二版踩到）：`getFileSystem` 需要实现 `FSAdapter`/`FileSystemBridge` 的
 *   **13 个方法**（readFile/writeFile/appendFile/copyFile/rename/remove/exists/stat/mkdir/
 *   rmdir/readdir/getFileInfo），而宿主 `fs.*` 只有 **3 个**
 *   （readBytes/writeBytes/remove）⇒ 覆盖 3/13 ⇒ **不是零原生**，仍要三端新增大量宿主方法。
 *   ★反过来 `getStorage`（`CompatStorage` 的同步 get/set/remove/clear + 异步/批量/info）
 *     能**全部**由 `fs.*` 三件套组合出来 ⇒ 真零原生（已落地，#1209）。
 *
 * ⇒ 判据：**接口全覆盖**才算 A；部分覆盖一律按"仍需新增宿主方法"处理。
 *   `log` 不能由 `dev.console` 替代（后者是"页面 console 回收"的反向通道），故不登记。
 */
const REUSE = {
  getStorage: ['fs.readBytes', 'fs.writeBytes', 'fs.remove'],
  // ★getFileSystem 故意**不登记**：13 个接口方法里宿主只有 3 个（覆盖不足 ⇒ 不是零原生）
}

const rows = []
for (const [method, hooks] of methods) {
  const probe = PROBES[method]
  const hits = probe ? Object.entries(ENDS).filter(([, txt]) => probe.test(txt)).map(([k]) => k) : []
  const reuse = REUSE[method] ?? []
  const reuseOk = reuse.length > 0 && reuse.every((m) => HOST_EXISTING.has(m))
  let cls
  if (reuseOk) cls = 'A'
  else if (hits.length === 3) cls = 'B'
  else cls = 'C'
  rows.push({ method, hooks, hits, cls, reuse, hasProbe: !!probe })
}

rows.sort((a, b) => (a.cls === b.cls ? b.hooks.length - a.hooks.length : a.cls < b.cls ? -1 : 1))

if (JSON_OUT) {
  console.log(JSON.stringify({ rows, summary: { A: rows.filter(r => r.cls === 'A').length, B: rows.filter(r => r.cls === 'B').length, C: rows.filter(r => r.cls === 'C').length } }, null, 2))
  process.exit(0)
}

const A = rows.filter((r) => r.cls === 'A')
const B = rows.filter((r) => r.cls === 'B')
const C = rows.filter((r) => r.cls === 'C')
console.log('[capability-app-feasibility] App 缺口可行性三分类（按"要写多少原生代码"）')
console.log(`  宿主已有能力方法: ${HOST_METHODS.size} 个（A 类的复用来源）`)
console.log(`  A 零原生（复用**已有**宿主方法，JS 侧组合即可）: ${A.length} 个方法`)
console.log(`  B 需新增宿主方法（三端平台 API 都有 ⇒ 三端各加一个）: ${B.length} 个方法`)
console.log(`  C 平台子系统（平台 API 也不是三端都有）: ${C.length} 个方法`)
const show = (name, list) => {
  if (!list.length) return
  console.log(`\n  ── ${name} ──`)
  for (const r of list) {
    const note = r.reuse.length ? '复用 ' + r.reuse.join('+') : r.hits.join(',') || '无线索'
    console.log(`   · ${r.method.padEnd(24)} [${note}] ← ${r.hooks.join(', ')}`)
  }
}
show('A 零原生（可成一批，最接近 useFetch 形态）', A)
show('B 需新增宿主方法（三端各加一个方法 + 登记契约）', B)
show('C 平台子系统（每项一个小项目）', C)
console.log('\n  ★口径（第二版修正）：**"平台有 API" ≠ "能力通道可用"**——接入能力通道必须有')
console.log('    宿主方法（且登记进契约）。⇒ A 类只认「所需方法已存在」，B/C 都要写原生代码。')
console.log('    ★线索仍是保守判定：出现 ≠ 完整可用（权限/UI/回调可能还要写）。')
