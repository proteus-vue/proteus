#!/usr/bin/env node
// scripts/gen-profile-baseline.mjs —— VC2-b 存量基线生成 / 漂移检查（棘轮：只减不增）
//
// 【为什么需要基线（首扫实测账）】Profile 边界校验（`profile-boundary-plugin`）首次全仓扫描
//   抓出 60+ 条**存量**违规（组件库的 Web 实现分支：`display: inline-flex` / `grid` /
//   `-webkit-box`、示例页的 `white-space: pre-wrap` 等）。直接全拦 ⇒ 全仓构建红、机制无法上线；
//   直接放过 ⇒ 存量成永久噪音。⇒ 基线把存量**钉住**（构建放行 + 如实计数），新增违规当场红。
//   **修一条从基线删一条**（棘轮只减不增——与 `check:mp-attrs` / `no-blind-wait` 同款纪律）。
//
// 【产物位置】`<project root>/profile-boundary-baseline.json`（**入库**——跨机器/CI 生效；
//   注意不能放 `.proteus/`：那是 gitignore 的本地目录，CI 上不存在 ⇒ 基线失效 ⇒ 构建红）。
//
// 【键口径（必须与插件运行时一致）】插件里 `rel = relative(viteRoot, id)`（vite root = 项目根），
//   键 = `${rel}:${prop}:${value}`。本脚本对每个项目根分别扫描、分别生成。
//
// 用法：
//   node scripts/gen-profile-baseline.mjs            # 生成/刷新两个项目的基线
//   node scripts/gen-profile-baseline.mjs --check    # 漂移检查（重算 vs 已提交；不一致 exit 1）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')

// 项目根（vite root）→ 需扫描的目录（相对 repo；与 vite 实际处理的 .vue 集合对齐）
const PROJECTS = {
  examples: [
    'examples/pages', 'examples/components', 'examples/subpackages',
    'packages/components',
  ],
  showcase: [
    'showcase/pages', 'showcase/components', 'showcase/subpackages',
    'packages/components',
  ],
  // ★2026-10-02：官网加入基线覆盖——VC2 边界门禁对**所有 vite 构建**生效（含 Web 目标，
  //   卡片硬性要求"否则问题延迟到 App 端暴露"），而官网只有 Web 构建、此前无基线文件
  //   ⇒ 今早门禁上线后官网构建**直接红**（既有 App.vue 6 条 + 组件库 5 条存量样式）。
  //   ★`packages/components` 也要扫：官网 vite 把 `@proteus-vue/components` 别名到**工作区源码**
  //     （dogfooding 直引），构建时这些 .vue 也过同一插件 ⇒ 键口径 = 相对 website 根的
  //     `../packages/components/...`（构建报错实测的形态）。
  //   官网是 dogfooding 验证场：语义组件 + 柔性布局本应零违规——存量按棘轮钉住待专项清理。
  website: ['website/src', 'packages/components'],
  // ★css-conformance（CSS 一致性验收项目）：页面**有意**使用待验收/边界值（如 pre-wrap 保留空白）——
  //   存量按棘轮钉住；新增违规同样当场红（该项目的价值恰是"如实暴露边界"）。
  'css-conformance': ['css-conformance/pages', 'css-conformance/components', 'packages/components'],
}

const { checkProfileBoundary } = await import(
  path.join(ROOT, 'packages', 'css-compat', 'dist', 'index.js')
).catch(() => {
  console.error('[gen-profile-baseline] ✗ 需要 packages/css-compat/dist（先跑 pnpm -r build 或包内 build）')
  process.exit(2)
})

function scan(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!/^(node_modules|dist|\.)/.test(e.name)) out.push(...scan(full))
      continue
    }
    if (e.name.endsWith('.vue')) out.push(full)
  }
  return out
}

const REASON = '存量待专项评估（VC2-b 首扫，2026-10-02）——修一条从基线删一条（棘轮只减不增）'

/**
 * ★逐条自定义理由（键 = `<rel>:<prop>:<value>`，按项目分组）——"非首扫"的**显式理解型登记**。
 * 【为什么需要】首扫之后新出现的违规按纪律应当"修"；确实要保留的（如**演示页有意演示某端不支持
 *   的能力**）走门禁允许的「显式理解后刷新基线」通道——但默认理由写死"VC2-b 首扫，2026-10-02"，
 *   对这类条目是**失实**的 ⇒ 用本表给它们写准确理由。表**放生成器里**（= 机器可复算；手改产物
 *   会被 --check 判漂移）。
 * 【棘轮】本表的键若不再出现在扫描结果（条目被修掉）⇒ --check 判「陈旧登记」红——逼着删掉，
 *   不留过期的"已理解"豁免。
 */
const REASON_OVERRIDES = {
  examples: {
    'pages/index.vue:display:grid':
      '演示页（批次 41 grid-column/grid-row 线号放置）——**演示对象本身**：Web / App（自研 Rust 引擎支持 grid）可渲染，' +
      'Skyline 端不支持 grid（该端是本仓唯一刚性外部约束）⇒ 按同类先例（glass-demo / devtools demo 两页）钉住；' +
      '待专项评估：该演示按端条件渲染或改柔性布局。棘轮只减不增。',
  },
  'css-conformance': {
    // ★★★justify-self 项（2026-10-06）：验收页**有意**使用 grid（justify-self 仅对 grid 项生效）——
    //   与 examples/index.vue:display:grid 同类：App 端（自研内核 taffy 原生支持 grid+justify_self）可承载，
    //   Skyline 无 Grid 容器（官方属性表无 grid/justify-self）。该页价值恰是**如实暴露该边界**（页面顶部已具名）。
    'pages/justify-self.vue:display:grid':
      '验收页（justify-self 项）——**验收对象本身要求 grid 上下文**（justify-self 仅对 grid 项生效，flex 下被忽略）：' +
      'Web / App（自研 Rust 引擎：taffy grid + justify_self 原生）可渲染，Skyline 端无 Grid 容器' +
      '（官方属性表无 grid/justify-self）⇒ 按 examples/index.vue:display:grid 先例显式理解后钉住；' +
      'Skyline 差异在验收页顶部具名（引擎锁死边界，不作缺陷）。棘轮只减不增。',
    // ★★★grid-auto-flow 项（2026-10-08）：同 justify-self——验收页**有意**用 grid（grid-auto-flow 仅对 grid 容器生效）。
    'pages/grid-auto-flow.vue:display:grid':
      '验收页（grid-auto-flow 项）——**验收对象本身要求 grid 容器**：Web / App（自研 Rust 引擎 taffy GridAutoFlow 原生）' +
      '可渲染，Skyline 端无 Grid 容器（官方属性表无 grid 族）⇒ 按 justify-self.vue 先例显式理解后钉住；' +
      'Skyline 差异在验收页顶部具名（引擎锁死边界，不作缺陷）。棘轮只减不增。',
    // ★★★grid-template-areas 项（2026-10-08）：同 grid-auto-flow——验收页**有意**用 grid（命名区仅对 grid 容器生效）。
    'pages/grid-template-areas.vue:display:grid':
      '验收页（grid-template-areas 项）——**验收对象本身要求 grid 容器**：Web / App（自研 Rust 引擎 taffy GridTemplateAreas/NamedLine 原生）' +
      '可渲染，Skyline 端无 Grid 容器（官方属性表无 grid 族）⇒ 按 grid-auto-flow.vue 先例显式理解后钉住；' +
      'Skyline 差异在验收页顶部具名（引擎锁死边界，不作缺陷）。棘轮只减不增。',
  },
}

let drift = 0
const summary = []
for (const [proj, dirs] of Object.entries(PROJECTS)) {
  const projRoot = path.join(ROOT, proj)
  const baseline = {}
  for (const d of dirs) {
    for (const file of scan(path.join(ROOT, d))) {
      const src = fs.readFileSync(file, 'utf-8')
      const re = /<style\b([^>]*)>([\s\S]*?)<\/style>/g
      let m
      while ((m = re.exec(src)) !== null) {
        if (/\blang\s*=/.test(m[1])) continue
        const r = checkProfileBoundary(m[2])
        for (const v of r.violations) {
          const rel = path.relative(projRoot, file).replace(/\\/g, '/')
          const key = `${rel}:${v.prop}:${v.value}`
          if (!baseline[key]) baseline[key] = REASON_OVERRIDES[proj]?.[key] ?? REASON
        }
      }
    }
  }
  const file = path.join(projRoot, 'profile-boundary-baseline.json')
  const json = JSON.stringify(Object.fromEntries(Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n'
  const n = Object.keys(baseline).length
  summary.push(`${proj}: ${n} 条`)
  // ★棘轮的另一半：**陈旧登记检测**——REASON_OVERRIDES 里的键若已不在扫描结果（违规被修掉），
  //   登记必须删掉，否则"已理解"的豁免会永久滞留（与"修一条从基线删一条"同源纪律）。
  const staleOverrides = Object.keys(REASON_OVERRIDES[proj] ?? {}).filter((k) => !(k in baseline))
  if (staleOverrides.length) {
    drift++
    console.error(`  ✗ ${proj} 陈旧登记 ${staleOverrides.length} 条（违规已不在扫描结果——从 REASON_OVERRIDES 删除）：`)
    for (const k of staleOverrides.slice(0, 5)) console.error(`      - ${k}`)
  }
  if (CHECK) {
    const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : ''
    if (prev !== json) {
      drift++
      // 差集诊断（新增哪些 / 已修哪些）
      const prevKeys = new Set(Object.keys(JSON.parse(prev || '{}')))
      const newKeys = new Set(Object.keys(baseline))
      const added = [...newKeys].filter((k) => !prevKeys.has(k))
      const removed = [...prevKeys].filter((k) => !newKeys.has(k))
      console.error(`  ✗ ${proj} 基线漂移：新增 ${added.length} 条（新增违规必须修或显式理解后刷新基线）；已修 ${removed.length} 条（应从基线删除）`)
      for (const k of added.slice(0, 5)) console.error(`      + ${k}`)
      for (const k of removed.slice(0, 5)) console.error(`      - ${k}`)
    } else {
      console.log(`  ✅ ${proj} 基线一致（${n} 条）`)
    }
  } else {
    fs.writeFileSync(file, json)
    console.log(`[gen-profile-baseline] ✅ ${path.relative(ROOT, file)}（${n} 条）`)
  }
}
if (CHECK) {
  console.log(`  ▸ ${summary.join(' · ')}`)
  if (drift) process.exit(1)
  console.log('✅ Profile 边界基线无漂移')
}
