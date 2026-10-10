#!/usr/bin/env node
// scripts/check-interaction-folding.mjs —— ★★★S3-T4 **交互折叠契约棘轮**（2026-10-10 · 输入延迟专项 #767）
//
// 【要证明什么（§16 S3 风险 R1：「折叠误判」）】编译期把声明式交互**折叠**成内核可执行指令，其
//   正确性靠一条**契约**：可折叠的**必须折**（不静默丢）、不可折叠的**必须诊断**（不静默当已支持）。
//   这与 S3 的风险 R1 同源——"把有副作用的 handler 当纯函数折"会静默改变语义；反之"能折却回 JS"
//   会让延迟悄悄回到逻辑层。⇒ 用一份**锁定语料**（合法/非法 `v-follow` 形态）把契约钉死：
//     · 合法 ⇒ 折出 `follow*` 字段且 **0 条** `VAPOR_FOLLOW_SHAPE` 诊断；
//     · 非法 ⇒ **≥1 条** `VAPOR_FOLLOW_SHAPE` 诊断（不静默）。
//   ★"折叠率"= 折出数 / 语料总数；本表即**棘轮**（改折叠行为必须显式改本表——逼出"意图"）。
//
// 【为什么是门禁而不是单测】契约一旦被静默破坏（编译器改动把某合法形态漏折、或把非法形态放行），
//   单测可能刚好没覆盖到该形态；本门禁用**封闭枚举**的同族形态覆盖（每条一个 case）⇒ 结构性兜底。
//   与 `check:no-json-wire` / `check:no-blind-wait` 同族：**结构性问题只有工具层能兜住**。
//
// 【诚实边界】本门禁只覆盖 `v-follow` 的**编译期折叠契约**（App 端）。"三端同形"（MP/Skyline 走
//   `wx.worklet`）与"宿主侧跟手行为"由真机判据（㉞/㉟/㊱）与 `check:vapor-three-end` 覆盖，不在本门禁。
//
// 用法：node scripts/check-interaction-folding.mjs [--list]
// 退出码：0 通过 / 1 命中
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIST_ONLY = process.argv.includes('--list')

/**
 * ★★★**折叠契约语料（SSOT —— 改折叠行为必须显式改本表）**。
 * 每条 = `v-follow="<value>"` 的一个形态；`fold` = 期望折出（true）或诊断（false）。
 * `fields` = fold=true 时期望出现在节点 style 里的键（子集断言）。
 */
const CASES = [
  // ── 合法：折出 follow* 字段 ──
  { name: "axis:x", value: "{ axis: 'x' }", fold: true, fields: { followAxis: 1 } },
  { name: "axis:y", value: "{ axis: 'y' }", fold: true, fields: { followAxis: 2 } },
  { name: "axis:both", value: "{ axis: 'both' }", fold: true, fields: { followAxis: 3 } },
  { name: "axis:number", value: '{ axis: 2 }', fold: true, fields: { followAxis: 2 } },
  { name: "axis:default", value: "{ gain: 0.5 }", fold: true, fields: { followAxis: 1, followGain: 0.5 } },
  { name: "gain", value: "{ axis: 'x', gain: 1.5 }", fold: true, fields: { followAxis: 1, followGain: 1.5 } },
  { name: "clamp", value: "{ axis: 'x', clamp: [-100, 100] }", fold: true, fields: { followAxis: 1, followClampMin: -100, followClampMax: 100 } },
  { name: "spring", value: "{ axis: 'x', spring: { stiffness: 300, damping: 30, mass: 1 } }", fold: true, fields: { followAxis: 1, followSpringStiffness: 300, followSpringDamping: 30, followSpringMass: 1 } },
  { name: "snap", value: "{ axis: 'x', snap: { threshold: 60, target: 200 } }", fold: true, fields: { followAxis: 1, followSnapThreshold: 60, followSnapTarget: 200 } },
  { name: "full", value: "{ axis: 'x', gain: 1, clamp: [-160, 0], spring: { stiffness: 300, damping: 30, mass: 1 }, snap: { threshold: 60, target: 200 } }", fold: true, fields: { followAxis: 1, followClampMin: -160, followSnapTarget: 200 } },
  // ── 非法：必须诊断（不静默） ──
  { name: "axis:unknown", value: "{ axis: 'z' }", fold: false },
  { name: "axis:range", value: '{ axis: 9 }', fold: false },
  { name: "axis:wrongtype", value: "{ axis: '1' }", fold: false },
  { name: "gain:nonnum", value: "{ axis: 'x', gain: 'fast' }", fold: false },
  { name: "clamp:shape", value: "{ axis: 'x', clamp: [-100] }", fold: false },
  { name: "clamp:order", value: "{ axis: 'x', clamp: [100, -100] }", fold: false },
  { name: "spring:incomplete", value: "{ axis: 'x', spring: { stiffness: 300 } }", fold: false },
  { name: "snap:incomplete", value: "{ axis: 'x', snap: { threshold: 60 } }", fold: false },
  { name: "unknownkey", value: '{ axis: 1, beta: 2 }', fold: false },
  { name: "variable", value: 'followSpec', fold: false },   // 非对象字面量（变量）
  { name: "empty", value: '', fold: false },                 // 无值
]

/** 生成一个最小 SFC（页面 + 一个 v-follow 节点），供编译器折叠。 */
function sfcFor(value) {
  return `<template>\n  <p-view style="width: 400px; height: 200px">\n    <p-view v-follow="${value}" style="width: 120px; height: 60px; background-color: #2f6fed"></p-view>\n  </p-view>\n</template>`
}

function main() {
  console.log('═══ 交互折叠契约棘轮（S3-T4 · 输入决策专项 #767 · §16 R1）═══')
  if (LIST_ONLY) {
    console.log(`语料 ${CASES.length} 条：`)
    for (const c of CASES) console.log(`  · ${c.name.padEnd(18)} ${c.fold ? '折出' : '诊断'}  ${c.value || '<空>'}`)
    return 0
  }

  // 用 tsx 跑真实编译器（与 gen-vapor-fixture 同一手法：临时脚本 + src 直连）
  const script = `
import { buildLayoutTemplate } from ${JSON.stringify(path.join(ROOT, 'packages/compiler/src/vapor/template.ts'))}
const cases = ${JSON.stringify(CASES.map((c) => ({ name: c.name, sfc: sfcFor(c.value) })))}
const out = []
for (const c of cases) {
  const r = buildLayoutTemplate(c.sfc, c.name + '.vue')
  const node = (r.template?.nodes ?? []).find((n) => n && n.style && typeof n.style.followAxis === 'number')
  const diags = (r.diagnostics ?? []).filter((d) => d.code === 'VAPOR_FOLLOW_SHAPE').map((d) => d.message)
  out.push({ name: c.name, ok: r.ok, style: node ? node.style : null, followDiags: diags })
}
process.stdout.write(JSON.stringify(out))
`
  const tmpDir = fs.mkdtempSync(path.join(ROOT, '.tmp-fold-'))
  const tmpScript = path.join(tmpDir, 'fold.ts')
  fs.writeFileSync(tmpScript, script)
  let raw
  try {
    raw = execFileSync('npx', ['tsx', tmpScript], { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 })
  } catch (e) {
    console.error('✗ 编译器调用失败（npx tsx）：', String(e?.message ?? e).slice(0, 400))
    return 1
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
  const got = JSON.parse(raw)
  const byName = new Map(got.map((g) => [g.name, g]))

  let failed = false
  const fail = (m) => { console.error(`  ✗ ${m}`); failed = true }
  let folded = 0
  for (const c of CASES) {
    const g = byName.get(c.name)
    if (!g) { fail(`${c.name}：无编译结果（语料错位？）`); continue }
    if (!g.ok) { fail(`${c.name}：模板编译失败（tpl.ok=false）`); continue }
    const isFold = g.style !== null
    const hasDiag = (g.followDiags ?? []).length > 0
    if (c.fold) {
      if (!isFold) { fail(`${c.name}：**应折出**但未折（合法形态被漏折——延迟会静默回到 JS）`); continue }
      if (hasDiag) { fail(`${c.name}：合法形态却报了诊断（${g.followDiags[0]}）`); continue }
      // 字段子集断言
      for (const [k, v] of Object.entries(c.fields ?? {})) {
        if (Math.abs(Number(g.style[k]) - Number(v)) > 1e-6) {
          fail(`${c.name}：字段 ${k} 期望 ${v} 实得 ${g.style[k]}`)
        }
      }
      folded++
    } else {
      if (isFold) { fail(`${c.name}：**应诊断**却静默折出（非法形态被当已支持——R1 误判）`); continue }
      if (!hasDiag) { fail(`${c.name}：应诊断却**零** VAPOR_FOLLOW_SHAPE（静默丢弃）`); continue }
    }
  }

  const rate = ((folded / CASES.length) * 100).toFixed(1)
  if (failed) {
    console.error(`\n✗ 交互折叠契约被破坏（折叠 ${folded}/${CASES.length} = ${rate}%）——见上`)
    console.error('  正确做法：合法形态必须折出 follow* 字段；非法形态必须报 VAPOR_FOLLOW_SHAPE 诊断。')
    console.error('  ★若是有意改变折叠能力，请同步更新本脚本的 CASES 语料（它就是棘轮 SSOT）。')
    return 1
  }
  console.log(`  ✓ 契约成立：合法 ${folded} 条全折出（0 诊断）· 非法 ${CASES.length - folded} 条全诊断（0 静默）`)
  console.log(`  折叠率（锁定语料）= ${folded}/${CASES.length} = ${rate}%`)
  console.log('\n✅ 交互折叠契约棘轮通过（可折叠必折 · 不可折叠必诊 · 无静默）')
  return 0
}

process.exit(main())
