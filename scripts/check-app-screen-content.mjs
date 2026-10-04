#!/usr/bin/env node
// scripts/check-app-screen-content.mjs —— ★★★App 屏内容产物门禁（2026-10-04）
//
// 【为什么需要（本轮真机缺陷的机器版）】C1 铺开 class 样式后，折叠面把 CSS `display: block`
//   等**内核不认的值**原样透传 ⇒ 真机 `RustLayout.create` 失败 ⇒ **整棵树建不起来**
//   （页面全崩）。这一类"非法值/坏形状"缺陷**构建期零告警**，只在真机暴露。
//   ⇒ 本门禁对**产物**做静态校验（零设备、可进 CI）：把内核契约（枚举封闭集 + 树结构不变量）
//     当判据，任何违反当场红——正是"声明引用闭环"在 **App 内容产物**上的孪生。
//
// 【判据】
//   ① JSON 可解析；每个屏的 nodes 非空数组
//   ② 节点 id 为正整数、**页内唯一**（内核建树按 id 对齐）
//   ③ parentId ∈ {null, 已存在 id}；**无自环、无环**（拓扑可达根）
//   ④ 枚举键（display/position/overflow/flexDirection）的值 ∈ `APP_ENUM_VALUES`（**契约 SSOT**）
//   ⑤ 数值键为有限数；padding/margin 形如 {top/right/bottom/left:number}
//
// 用法：
//   node scripts/check-app-screen-content.mjs [json...]     # 缺省扫 examples/dist/app/*/screen-content.json
// 退出码：0 通过 / 1 有违反
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requireFromRepo = createRequire(import.meta.url)

// 契约 SSOT（编译器导出）——避免在门禁里写第二份枚举清单（本仓"同一事实一处"纪律）
let APP_ENUM_VALUES
try {
  // 优先用源码（tsx 运行），否则用已构建 dist
  const src = path.join(ROOT, 'packages/compiler/src/vapor/template.ts')
  if (process.argv[1]?.endsWith('.mjs') && fs.existsSync(path.join(ROOT, 'packages/compiler/dist/index.js'))) {
    APP_ENUM_VALUES = requireFromRepo(path.join(ROOT, 'packages/compiler/dist/index.js')).APP_ENUM_VALUES
  }
  if (!APP_ENUM_VALUES && fs.existsSync(src)) {
    // 从源码里静态取（避免引入 tsx 依赖）：解析 `export const APP_ENUM_VALUES = { ... }`
    const m = /APP_ENUM_VALUES\s*=\s*\{([\s\S]*?)\n\}/.exec(fs.readFileSync(src, 'utf-8'))
    if (m) {
      APP_ENUM_VALUES = {}
      for (const line of m[1].split('\n')) {
        const mm = /(\w+):\s*\[([^\]]*)\]/.exec(line)
        if (mm) APP_ENUM_VALUES[mm[1]] = [...mm[2].matchAll(/'([^']*)'/g)].map((x) => x[1])
      }
    }
  }
} catch {
  /* 下面兜底 */
}
if (!APP_ENUM_VALUES) {
  APP_ENUM_VALUES = {
    display: ['flex', 'none'],
    position: ['static', 'relative', 'absolute'],
    overflow: ['visible', 'hidden', 'scroll', 'auto'],
    flexDirection: ['row', 'column', 'row-reverse', 'column-reverse'],
  }
}

/** 已知的数值键（内核读顶层数值） */
const NUMERIC_KEYS = ['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'top', 'left', 'gap', 'flexGrow', 'flexShrink', 'flexBasis', 'fontSize', 'borderRadius', 'borderWidth', 'opacity', 'widthRatio', 'heightRatio']
const EDGE_KEYS = ['margin', 'padding']
/** 颜色键（内核 parse_css_color 只认 #RGB/#RRGGBB/#RRGGBBAA——rgb()/rgba() 会致整树建不起来） */
const COLOR_KEYS = ['color', 'backgroundColor', 'borderColor']
const HEX_COLOR_RE = /^#[0-9a-f]{3}$|^#[0-9a-f]{6}$|^#[0-9a-f]{8}$/i

/* ── ★★★设备腿（鸿蒙 executor）：hosts/harmony/results/app-stack-executor.json ——
 *   鸿蒙跑同一份 bundle-app-stack.js（注入 proteusHost.invoke → C++ screen.* 真内核树）的读数。
 *   判据：exec_content_nodes>0（内容→内核树）+ exec_commands>0（编排链跑了）+ exec_errors 空。── */
{
  const exFile = path.join(ROOT, 'hosts', 'harmony', 'results', 'app-stack-executor.json')
  if (fs.existsSync(exFile)) {
    try {
      const d = JSON.parse(fs.readFileSync(exFile, 'utf-8'))
      const cn = Number(d.exec_content_nodes ?? 0)
      const cmds = Number(d.exec_commands ?? 0)
      const errs = Array.isArray(d.exec_errors) ? d.exec_errors : []
      if (cn <= 0 || cmds <= 0) {
        problems.push(`[hosts/harmony/results/app-stack-executor.json] 鸿蒙 executor 未跑通（content_nodes=${cn} commands=${cmds}）`)
      } else if (errs.length > 0) {
        problems.push(`[hosts/harmony/results/app-stack-executor.json] 鸿蒙 executor 报错：${JSON.stringify(errs)}`)
      } else {
        console.log(`  ✅ 鸿蒙 executor 设备腿：内容 ${cn} 节点 · ${cmds} 命令 · 零错误`)
      }
    } catch (e) {
      problems.push(`[hosts/harmony/results/app-stack-executor.json] 读取失败：${e.message}`)
    }
  }
}

/* ── ★★★设备腿（视觉合成）：把 App 屏内容真画到屏上 ──
 *   Android：hosts/android/results/app-screen-composite.json（复用 VaporRenderHost 树→指令→自绘；
 *            判据 painted_samples>0 + content_nodes>0）
 *   iOS：hosts/ios/results/app-screen-composite.json（proteusSelfDraw.mount → CALayer + snapshot；
 *        判据 ok + content_nodes>0 + layer_count>0 + snapshot）── */
for (const [label, rel, ok] of [
  ['Android', 'hosts/android/results/app-screen-composite.json', (d) => d.ok && Number(d.painted_samples ?? 0) > 0 && Number(d.content_nodes ?? 0) > 0],
  ['iOS', 'hosts/ios/results/app-screen-composite.json', (d) => d.ok && Number(d.content_nodes ?? 0) > 0 && Number(d.layer_count ?? 0) > 0 && d.snapshot === true],
]) {
  const cf = path.join(ROOT, rel)
  if (!fs.existsSync(cf)) continue
  try {
    const d = JSON.parse(fs.readFileSync(cf, 'utf-8'))
    if (!ok(d)) {
      problems.push(`[${rel}] ${label} 视觉合成未真上屏（${JSON.stringify(d)}）`)
    } else {
      const extra = label === 'Android'
        ? `${Number(d.painted_samples)} 采样像素`
        : `${Number(d.layer_count)} 层 + PNG`
      console.log(`  ✅ ${label} 视觉合成设备腿：真画屏（${Number(d.content_nodes)} 内容节点 → ${extra}）`)
    }
  } catch (e) {
    problems.push(`[${rel}] 读取失败：${e.message}`)
  }
}

const files = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const targets = files.length
  ? files
  : (() => {
      const base = path.join(ROOT, 'examples', 'dist', 'app')
      if (!fs.existsSync(base)) return []
      return fs
        .readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(base, e.name, 'screen-content.json'))
        .filter((f) => fs.existsSync(f))
    })()

if (targets.length === 0) {
  console.log('App 屏内容产物门禁：未找到产物（examples/dist/app/*/screen-content.json）——跳过（无产物不判红）')
  process.exit(0)
}

const problems = []
let checkedPages = 0
let checkedNodes = 0

/* ── ★★★设备腿（B4 鸿蒙）：hosts/harmony/results/app-screen-content.json ——
 *   鸿蒙宿主消费 App 屏内容建内核树的真机读数（run-host-app.sh 捕获）。
 *   判据：pages_mounted == pages（全部页建树成功）+ content_nodes_total > 0 + failed 为空。── */
{
  const devFile = path.join(ROOT, 'hosts', 'harmony', 'results', 'app-screen-content.json')
  if (fs.existsSync(devFile)) {
    try {
      const d = JSON.parse(fs.readFileSync(devFile, 'utf-8'))
      const pages = Number(d.pages ?? 0)
      const mounted = Number(d.pages_mounted ?? 0)
      const nodes = Number(d.content_nodes_total ?? 0)
      const failed = Array.isArray(d.failed) ? d.failed : []
      if (pages <= 0 || nodes <= 0) {
        problems.push(`[hosts/harmony/results/app-screen-content.json] 鸿蒙屏内容建树为空（pages=${pages} nodes=${nodes}）——App 内容→鸿蒙内核树这条链没通`)
      } else if (mounted !== pages || failed.length > 0) {
        problems.push(`[hosts/harmony/results/app-screen-content.json] 鸿蒙有 ${failed.length} 页建树失败（${failed.join(',')}）——${mounted}/${pages} 页成功`)
      } else {
        console.log(`  ✅ 鸿蒙设备腿：${pages} 页全部建树（${nodes} 节点）`)
      }
    } catch (e) {
      problems.push(`[hosts/harmony/results/app-screen-content.json] 读取失败：${e.message}`)
    }
  }
}


for (const f of targets) {
  const rel = path.relative(ROOT, f)
  let data
  try {
    data = JSON.parse(fs.readFileSync(f, 'utf-8'))
  } catch (e) {
    problems.push(`[${rel}] JSON 解析失败：${e.message}`)
    continue
  }
  for (const [page, sc] of Object.entries(data)) {
    checkedPages++
    const nodes = sc && Array.isArray(sc.nodes) ? sc.nodes : null
    if (!nodes || nodes.length === 0) {
      problems.push(`[${rel}] ${page}: nodes 缺失/为空`)
      continue
    }
    const ids = new Set()
    const idList = []
    for (const n of nodes) {
      checkedNodes++
      // ② id
      if (!Number.isInteger(n.id) || n.id < 0) {
        problems.push(`[${rel}] ${page}: 节点 id 非法（${JSON.stringify(n.id)}）`)
        continue
      }
      if (ids.has(n.id)) problems.push(`[${rel}] ${page}: 节点 id 重复（${n.id}）`)
      ids.add(n.id)
      idList.push(n.id)
    }
    // ③ parentId 引用 + 无环
    for (const n of nodes) {
      if (!Number.isInteger(n.id)) continue
      if (n.parentId === null || n.parentId === undefined) continue
      if (n.parentId === n.id) problems.push(`[${rel}] ${page}: 节点 ${n.id} parent 指向自己（自环）`)
      else if (!ids.has(n.parentId)) problems.push(`[${rel}] ${page}: 节点 ${n.id} parent ${n.parentId} 不存在（悬空）`)
    }
    // 环检测（有限步可达根）
    const byId = new Map(nodes.filter((n) => Number.isInteger(n.id)).map((n) => [n.id, n]))
    for (const n of nodes) {
      if (!Number.isInteger(n.id)) continue
      let cur = n
      let steps = 0
      const seen = new Set()
      while (cur && cur.parentId !== null && cur.parentId !== undefined) {
        if (seen.has(cur.id)) {
          problems.push(`[${rel}] ${page}: 节点 ${n.id} 所在链存在环`)
          break
        }
        seen.add(cur.id)
        cur = byId.get(cur.parentId)
        if (++steps > nodes.length) {
          problems.push(`[${rel}] ${page}: 节点 ${n.id} 的父链过长（疑似环）`)
          break
        }
      }
    }
    // ④ 枚举值（内核封闭集——本门禁的**核心判据**）
    for (const n of nodes) {
      for (const [key, allowed] of Object.entries(APP_ENUM_VALUES)) {
        if (key in n && n[key] !== undefined) {
          if (!allowed.includes(n[key])) {
            problems.push(
              `[${rel}] ${page}: 节点 ${n.id} ${key}="${n[key]}" 不在内核封闭集（${allowed.join('/')}）——真机建树会失败`,
            )
          }
        }
      }
      // ⑤ 数值键
      for (const k of NUMERIC_KEYS) {
        if (k in n && n[k] !== undefined && !(typeof n[k] === 'number' && Number.isFinite(n[k]))) {
          // backgroundColor/color 是字符串键，不在 NUMERIC_KEYS；这里只查数值键
          problems.push(`[${rel}] ${page}: 节点 ${n.id} ${k}=${JSON.stringify(n[k])} 非有限数`)
        }
      }
      // ⑤b 颜色键：必须为 hex（内核只认 #RGB/#RRGGBB/#RRGGBBAA——rgb()/rgba() 致整树建不起来）
      for (const k of COLOR_KEYS) {
        if (k in n && n[k] !== undefined) {
          if (typeof n[k] !== 'string' || !HEX_COLOR_RE.test(n[k])) {
            problems.push(`[${rel}] ${page}: 节点 ${n.id} ${k}=${JSON.stringify(n[k])} 非 hex 颜色（内核只认 #RGB/#RRGGBB/#RRGGBBAA）——真机建树会失败`)
          }
        }
      }
      for (const k of EDGE_KEYS) {
        if (k in n && n[k] !== undefined) {
          if (typeof n[k] !== 'object' || n[k] === null) {
            problems.push(`[${rel}] ${page}: 节点 ${n.id} ${k} 非对象`)
          } else {
            for (const side of ['top', 'right', 'bottom', 'left']) {
              if (side in n[k] && !(typeof n[k][side] === 'number' && Number.isFinite(n[k][side]))) {
                problems.push(`[${rel}] ${page}: 节点 ${n.id} ${k}.${side} 非有限数`)
              }
            }
          }
        }
      }
    }
  }
}

console.log('App 屏内容产物门禁（内核契约：枚举封闭集 + 树结构不变量）')
console.log(`  产物 ${targets.length} 份 · 页 ${checkedPages} · 节点 ${checkedNodes}`)
if (problems.length === 0) {
  console.log('  ✅ 全部合规（id 唯一 / parent 可达无环 / 枚举值在内核封闭集 / 颜色为 hex / 数值有限）')
  process.exit(0)
}
console.log(`  ❌ ${problems.length} 项：`)
for (const p of problems.slice(0, 30)) console.log(`    - ${p}`)
if (problems.length > 30) console.log(`    …另有 ${problems.length - 30} 项`)
process.exit(1)
