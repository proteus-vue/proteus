#!/usr/bin/env node
// scripts/check-vapor-three-end.mjs —— ★★★**三端同步门禁**（2026-10-03 · 用户指令）
//
// 【用户原话立此门禁】「后面的 vapor 推进就**三端同步走**」。
//
// 【为什么必须是机器门禁（本仓既有教训同源）】Vapor 的能力全落在**平台无关的共享包**
//   （`packages/compiler/src/vapor/*` + `packages/slot-runtime/*` + `hosts/android/bridge` 的桥）
//   ⇒ **构造上**三端共享（三端跑同一份 `bundle-vapor.js` + 同一份 `vapor-artifacts.json`）。
//   但"构造共享"≠"端上验证"：**改完只在 Android 跑过**（本仓 2026-10-03 的真实状态）时，
//   鸿蒙/iOS 的结论是**推断**而不是**证据**——与「提交 ≠ 交付」同族：
//   没有任何机制会提醒"另外两端还没重跑"，于是旧证据会**冒充**新证据（陈旧证据陷阱）。
//   ⇒ 本脚本把「三端同步」变成可机器判定：**同一指纹 + 同一判据全过**，缺一即红。
//
// 【判据（三条，全部落在可复算的量上）】
//   ① **证据齐**：三端结果文件都在（缺一端 = 证据链断 ⇒ 红；不"诚实跳过"——
//      因为三端证据是**入库资产**（hosts/*/results/vapor.json 均已被 git 跟踪），
//      缺失只可能是"没跑"或"误删"，两者都该拦）。
//   ② **各端过判据**：对每个结果文件跑**同一份** `hosts/android/check-vapor-device.py`
//      （三端共用、按 host_id 分档）——退出码 0 才算该端过；◐（如实跳过）**计数并列出**
//      （跳过是诚实声明，但不是"过"——列表让审计者一眼看到哪端少了哪项）。
//   ③ **指纹逐项一致**：模板/源/槽位/实例化/增量/事件/混合文本/门禁轮/表达式探针
//      必须三端**逐值相同**（同一份产物驱动 ⇒ 必须同结果）；不一致 ⇒ 指出**是哪一端**、
//      哪个字段、值各是多少（"谁没重跑"当场可见）。
//
// 【为什么不在这里跑设备】CI 无真机/模拟器（与 `check:ios-host` 同因）。⇒ 本门禁消费
//   **已入库**的 results（真机跑出的产物），在 CI 复算判据 + 比对指纹。
//   真机重跑入口：`bash hosts/android/run-vapor.sh` · `bash hosts/harmony/run-vapor.sh` ·
//   `bash hosts/ios/run-selfdraw.sh --vapor`。
//
// 用法：node scripts/check-vapor-three-end.mjs
// 退出码：0 全过 / 1 有失败（证据缺 / 判据红 / 指纹不一致）/ 2 环境错（python3 缺失）
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JUDGE = path.join(ROOT, 'hosts/android/check-vapor-device.py')

/** 三端（顺序固定 ⇒ 输出可复现） */
const ENDS = [
  { id: 'android', file: 'hosts/android/results/vapor.json' },
  { id: 'harmony', file: 'hosts/harmony/results/vapor.json' },
  { id: 'ios', file: 'hosts/ios/results/vapor.json' },
]

/**
 * 指纹字段（**同一份产物驱动 ⇒ 三端必须逐值相同**）。
 *
 * 【为什么选这些（而不是"整份报告"）】报告里混有**设备相关**读数（宿主像素采样、
 *   onDraw 次数、耗时 ms、host_id…）——那些**应当**不同，整份比对必然假红。
 *   本表只取"由编译产物 + 运行时语义决定"的量：同一份 SFC/模板/订阅表 ⇒ 必然一致。
 */
const SCALAR_FIELDS = [
  'tpl_nodes', 'sub_l1', 'sub_l0',
  'inst_nodes', 'inst_reused_ids', 'inst_allocated_ids', 'inst_text_filled', 'inst_width_filled',
  'updates_run', 'ops_bytes',
  'ev_bindings', 'ev_handlers', 'ev_modifiers',
  'component_mounts', 'component_nodes',
]

/** 取一个报告的结构化指纹（顺序敏感：数组按报告内顺序拼接——同一产物顺序也同） */
function fingerprint(rep) {
  const fp = {}
  for (const k of SCALAR_FIELDS) fp[k] = rep[k]
  fp.sub_sources = JSON.stringify([...(rep.sub_sources ?? [])].sort())
  fp.mix_text = JSON.stringify((rep.mix_text_probe ?? []).map((m) => `${m.id}:${m.text}`))
  fp.gate_rounds = JSON.stringify((rep.gate_rounds ?? []).map((g) => `${g.name}|${g.ops}|${(g.texts ?? []).join('~')}`))
  fp.expr_probe = JSON.stringify((rep.expr_probe ?? []).map((e) => `${e.prefix}${e.text}`))
  // ★P1-3：组件子节点探针（props 下行值 + 上行指令值 + 上行内核真值）——同一份产物驱动，
  //   三端必须逐值相同（含内核真值：三端共用同一 Rust 布局内核 ⇒ 宽度必然一致）。
  fp.kid_probe = JSON.stringify([
    rep.component_kid_probe?.text, rep.component_kid_probe?.width,
    rep.component_kid_probe?.width_after, rep.component_kid_probe?.rect_before, rep.component_kid_probe?.rect_after,
  ])
  // ★P1-3 插槽分发（2026-10-03）：分发结果三端必须逐值相同（内容文本集/填充记录/标记残留数）——
  //   分发是纯 JS 共享代码 + 同一份产物 ⇒ 任一端不同即"没重跑"或"跑的不是同一份代码"。
  fp.slot_probe = JSON.stringify([
    [...(rep.slot_probe?.texts ?? [])].sort(),
    [...(rep.slot_probe?.fills ?? [])].map((f) => `${f.name}:${f.filled}`).sort(),
    rep.slot_probe?.markers_left,
  ])
  // ★P1-3 emits（2026-10-03）：子→父链路三端必须逐值相同（事件名/载荷/路由/父源/内核宽度）——
  //   emit 路由是共享代码 + 同一份产物 + 同一内核 ⇒ 任一端不同即可疑（不是"设备无关读数"）。
  fp.emit_probe = JSON.stringify([
    [...(rep.emit_probe?.emits ?? [])].map((e) => `${e.event}:${JSON.stringify(e.payload)}:${e.routed}`),
    rep.emit_probe?.parent_source_after,
    rep.emit_probe?.geom_before,
    rep.emit_probe?.geom_after,
  ])
  // ★P1-3 作用域插槽（2026-10-03）：内容文本 + 作用域样式（字段与内核真值）三端逐值一致——
  //   分发时求值是共享代码 + 同一份产物 ⇒ 任一端不同即"没重跑"或"跑的不是同一份代码"。
  fp.scoped_probe = JSON.stringify([
    [...(rep.scoped_probe?.texts ?? [])].sort(),
    rep.scoped_probe?.anchor_width_field,
    rep.scoped_probe?.anchor_width_rect,
    // ★解构形态（2026-10-03）：文本（dct-9）+ 样式（90——含 TS 断言覆盖）
    rep.scoped_probe?.destr_text,
    rep.scoped_probe?.destr_width_field,
    rep.scoped_probe?.destr_width_rect,
  ])
  // ★P1-3 生命周期（2026-10-03）：@vue:mounted 的三端读数（绑定/ran/源/applied/几何）逐值一致。
  fp.lifecycle_probe = JSON.stringify([
    [...(rep.lifecycle_probe?.bindings ?? [])].sort(),
    rep.lifecycle_probe?.ran_handler,
    [...(rep.lifecycle_probe?.changed_sources ?? [])].sort(),
    rep.lifecycle_probe?.applied,
    rep.lifecycle_probe?.geom_before,
    rep.lifecycle_probe?.geom_after,
  ])
  // ★P3 动态组件（2026-10-03）：`:is` 解析结果三端逐值一致（文本/解析名/摘除数）——
  //   解析是共享代码 + 同一份产物 ⇒ 任一端不同即"没重跑"或"跑的不是同一份代码"。
  fp.dyn_probe = JSON.stringify([
    [...(rep.dyn_probe?.texts ?? [])].sort(),
    [...(rep.dyn_probe?.mounts ?? [])].sort(),
    (rep.dyn_probe?.geom ?? []).map((g) => `w>0:${g.width > 0}`).sort(),
    rep.dyn_probe?.dropped,
  ])
  // ★P3-5 宿主指令（2026-10-03）：三段语义的宿主回执三端逐值一致（通道规格/逐轮 started/已播预设）——
  //   指令注册表是共享代码 + 同一份产物 ⇒ 任一端不同即"没重跑"或"跑的不是同一份代码"。
  fp.directive_probe = JSON.stringify([
    (rep.directive_probe?.nodes ?? []).map((n) => `${n.id}:${[...n.dirs].sort().join('+')}`),
    (rep.directive_probe?.rounds ?? []).map((r) => `${r.name}=${r.started}`),
    [...new Set((rep.directive_probe?.plays ?? []).filter((p) => p.started).map((p) => `${p.nodeId}:${p.preset}`))].sort(),
  ])
  // ★混排（2026-10-03）：文本段集合 + 合成叶数三端逐值一致（同一份产物 + 共享代码）
  fp.mixed_probe = JSON.stringify([
    [...(rep.mixed_probe?.texts ?? [])].sort(),
    rep.mixed_probe?.leaves,
  ])
  // ★T2（2026-10-10 · 判据 ㉓）：带参/局部变量/if 三端逐值一致（值序列 + 内核几何宽 ——
  //   同一份产物 + 共享执行器 ⇒ 三端必须同结果；不一致即"有一端没重跑"）
  fp.t2_probe = JSON.stringify([rep.t2_probe?.values ?? [], rep.t2_probe?.widths ?? [], rep.t2_probe?.logs ?? []])
  // ★B5（2026-10-10 · 判据 ㉔）：脚本生命周期钩子三端逐值一致（阶段 + 值序列 + 内核几何 —— 同一份产物 + 共享执行器）
  fp.b5_probe = JSON.stringify([rep.b5_probe?.phases ?? [], rep.b5_probe?.values ?? [], rep.b5_probe?.widths ?? []])
  // ★`:style` 对象展开（2026-10-03）：双通道读数三端逐值一致（内核宽度 + 宿主补丁内容）
  fp.styleobj_probe = JSON.stringify([
    rep.styleobj_probe?.width_before,
    rep.styleobj_probe?.width_after,
    (rep.styleobj_probe?.patch_calls ?? []).map((ps2) => ps2.join('|')),
  ])
  return fp
}

function main() {
  console.log('═══ Vapor 三端同步门禁（用户指令 2026-10-03：「后面的 vapor 推进就三端同步走」）═══')
  let ok = true

  // ── ① 证据齐 + ③ 指纹收集 ──
  const loaded = []
  for (const end of ENDS) {
    const abs = path.join(ROOT, end.file)
    if (!fs.existsSync(abs)) {
      console.log(`  ✗ ${end.id}：缺结果文件 ${end.file}`)
      console.log(`      ⇒ 三端证据是入库资产（陈旧证据会冒充新证据）——请跑真机重生成并提交`)
      ok = false
      continue
    }
    const raw = JSON.parse(fs.readFileSync(abs, 'utf-8'))
    const rep = raw.report ?? {}
    if (raw.ok !== true || rep.ok !== true) {
      console.log(`  ✗ ${end.id}：通路未成功（ok=${raw.ok} / report.ok=${rep.ok}）——见报告 error/notes`)
      ok = false
      continue
    }
    loaded.push({ end, raw, rep, fp: fingerprint(rep) })
  }
  if (loaded.length === 0) {
    console.log('\n✗ 三端无可比对证据（全缺）')
    return 1
  }

  // ── ② 各端过同一份判据（含 ◐ 跳过清单——"跳过"是诚实声明但不是"过"）──
  let pyOk = true
  for (const item of loaded) {
    const abs = path.join(ROOT, item.end.file)
    let out = ''
    let rc = 0
    try {
      out = execFileSync('python3', [JUDGE, abs], { encoding: 'utf-8' })
    } catch (e) {
      rc = typeof e.status === 'number' ? e.status : 1
      out = String(e.stdout ?? '') + String(e.stderr ?? '')
      if (e.code === 'ENOENT') pyOk = false
    }
    const pass = (out.match(/✓/g) ?? []).length
    const skip = (out.match(/◐/g) ?? []).length
    const failN = (out.match(/✗/g) ?? []).length
    const skipLines = out
      .split('\n')
      .filter((l) => l.includes('◐'))
      .map((l) => l.trim().replace(/^◐\s*/, '').slice(0, 80))
    if (rc !== 0 || failN > 0) {
      console.log(`  ✗ ${item.end.id}：判据未全过（rc=${rc} · ✓${pass} ◐${skip} ✗${failN}）`)
      for (const l of out.split('\n').filter((x) => x.includes('✗'))) console.log(`      ${l.trim().slice(0, 120)}`)
      ok = false
    } else {
      console.log(`  ✓ ${item.end.id}：判据全过（✓${pass} · ◐ 如实跳过 ${skip}${skip ? `：${skipLines.join(' / ')}` : ''}）`)
    }
  }
  if (!pyOk) {
    console.log('\n✗ 环境错：找不到 python3（本门禁需要它复算判据）')
    return 2
  }

  // ── ③ 指纹逐项一致 ──
  if (loaded.length > 1) {
    const base = loaded[0]
    const fields = Object.keys(base.fp)
    const diffs = []
    for (const item of loaded.slice(1)) {
      for (const k of fields) {
        if (item.fp[k] !== base.fp[k]) {
          diffs.push({ field: k, a: `${base.end.id}=${String(base.fp[k]).slice(0, 60)}`, b: `${item.end.id}=${String(item.fp[k]).slice(0, 60)}` })
        }
      }
    }
    if (diffs.length > 0) {
      console.log('  ✗ 指纹不一致（同一份产物 ⇒ 必须同结果；不一致 = 有一端**没重跑**）：')
      for (const d of diffs) console.log(`      ${d.field}: ${d.a} vs ${d.b}`)
      console.log('      ⇒ 请三端重跑（见脚本头注的重跑入口）并提交新结果')
      ok = false
    } else {
      console.log(`  ✓ 指纹逐项一致（${fields.length} 项 × ${loaded.length} 端：模板 ${base.fp.tpl_nodes} 节点 · `
        + `L1 ${base.fp.sub_l1} · 源 ${JSON.parse(base.fp.sub_sources).length} 个 · 实例化 ${base.fp.inst_nodes} 节点 · `
        + `门禁轮 ${JSON.parse(base.fp.gate_rounds).length} · 表达式探针 ${JSON.parse(base.fp.expr_probe).length}）`)
    }
  } else {
    console.log(`  ◐ 仅 ${loaded.length} 端有证据（其余端缺失）——指纹比对不完整`)
  }

  if (ok) {
    console.log('\n✅ Vapor 三端同步（证据齐 · 同一判据全过 · 指纹逐项一致）')
    return 0
  }
  console.log('\n✗ Vapor 三端**未同步**（见上）——「三端同步走」是用户指令，改一处就要三端重跑')
  return 1
}

process.exit(main())
