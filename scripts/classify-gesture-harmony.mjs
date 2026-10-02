#!/usr/bin/env node
// scripts/classify-gesture-harmony.mjs —— ★★★矩阵 #7：鸿蒙真触摸样本 → **三端中立识别器**分类
//
// 【要证明什么】uitest uiInput 注入的**真触摸**（系统输入栈）产生的样本序列（down/move/up + 真时间戳）
//   → `packages/gesture` 的 `createGestureRecognizer`（**与 Web/MP 同一条识别器**）——分类结果
//   必须与注入方式一一对应：click ⇒ tap（时长 <500ms）· longClick ⇒ longpress（≥500ms）·
//   swipe ⇒ swipe（方向 up）。**真实时长分流**是本腿对 iOS V16 的关键超越
//   （iOS 报告诚实标注 `not_covered: UITouch->duration-classification`）。
//
// 【判据（8 条 → verdict）】
//   按段切分（样本间间隔 > 500ms 即新段）→ 每段独立喂一个识别器：
//   ① 段数 = 3 ② 段 1 = tap（时长证据 <500ms）③ 段 2 = longpress（≥500ms）
//   ④ 段 3 = swipe-up ⑤ 总语义事件 = 3（零串扰）⑥ 每段有命中行（touch → core hitTest）
//   ⑦ 命中 target 非空（命中落在节点上）⑧ 时长从**样本时间戳**算（不是我们声明的类型）
//
// 用法：node scripts/classify-gesture-harmony.mjs <touch-samples.jsonl> [out.json]
import fs from 'node:fs'
import { createGestureRecognizer } from '../packages/gesture/dist/index.js'

const file = process.argv[2]
const out = process.argv[3]
if (!file) {
  console.error('用法：node scripts/classify-gesture-harmony.mjs <touch-samples.jsonl> [out.json]')
  process.exit(2)
}
const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const samples = lines.filter((l) => typeof l.t === 'string')
const hits = lines.filter((l) => l.hit !== undefined)
if (samples.length === 0) {
  console.error('✗ 无触摸样本')
  process.exit(1)
}
// ★时间戳单位标定：鸿蒙 UIInput 事件时间戳实测为 **ns**（15535313497000 ⇒ 15535s ≈ 4.3h 开机时长）；
//   识别器吃 ms ⇒ /1e6。用"量级检测"而不是写死（>1e12 ⇒ ns），并对标定结果如实记录。
const NS = samples[0].ts > 1e12
const toMs = (ts) => (NS ? ts / 1e6 : ts)
const pts = samples.map((s) => ({ kind: s.t, x: s.x, y: s.y, t: toMs(s.ts) }))

// ── 按段切分（★不能按时间间隔切：longpress 的 down→up 间隔就是按住时长 1555ms！
//   首版按 gap>500ms 切 ⇒ longpress 被切成两段。正解：**按 down/up 配对**切——
//   新 down 到来时，若当前段已有 up/cancel ⇒ 前一段闭合、开新段）──
const segs = []
let cur = []
for (const p of pts) {
  if (p.kind === 'down' && cur.some((s) => s.kind === 'up' || s.kind === 'cancel')) {
    segs.push(cur)
    cur = []
  }
  cur.push(p)
}
if (cur.length) segs.push(cur)

// ── 每段独立识别（三端中立识别器——与 Web/MP 同一条）──
const results = segs.map((seg, idx) => {
  const events = []
  const rec = createGestureRecognizer({
    tap: (e) => events.push({ type: 'tap', ...e }),
    longpress: (e) => events.push({ type: 'longpress', ...e }),
    swipe: (e) => events.push({ type: 'swipe', ...e }),
    pan: (e) => events.push({ type: e.type }),
  })
  for (const s of seg) {
    rec.feed({ kind: s.kind, point: { x: s.x, y: s.y, t: s.t, id: 1 } })
  }
  const down = seg.find((s) => s.kind === 'down')
  const up = seg.find((s) => s.kind === 'up')
  const heldMs = down && up ? Math.round(up.t - down.t) : -1
  const semantic = events.filter((e) => ['tap', 'longpress', 'swipe'].includes(e.type))
  return {
    seg: idx + 1,
    samples: seg.length,
    start_kind: seg[0]?.kind,
    held_ms: heldMs,
    x: Math.round((down?.x ?? 0) * 100) / 100,
    y: Math.round((down?.y ?? 0) * 100) / 100,
    semantic,
    semantic_types: semantic.map((e) => e.type),
    pan_events: events.filter((e) => String(e.type).startsWith('pan')).length,
  }
})

// ── 命中行（touch → core hitTest 的证据）──
const hitRecs = hits.map((h) => ({
  target: h.hit?.target ?? null,
  chain_len: Array.isArray(h.hit?.chain) ? h.hit.chain.length : -1,
  x: h.hx,
  y: h.hy,
  ok: h.hit?.ok === true,
}))

// ── 判据（8 条）──
const s1 = results[0] ?? { semantic_types: [], held_ms: -1 }
const s2 = results[1] ?? { semantic_types: [], held_ms: -1 }
const s3 = results[2] ?? { semantic_types: [], held_ms: -1 }
const sw = (s3.semantic ?? []).find((e) => e.type === 'swipe')
const checks = {
  seg_count_ok: results.length === 3,
  seg1_tap: s1.semantic_types.length === 1 && s1.semantic_types[0] === 'tap' && s1.held_ms >= 0 && s1.held_ms < 500,
  seg2_longpress: s2.semantic_types.length === 1 && s2.semantic_types[0] === 'longpress' && s2.held_ms >= 500,
  seg3_swipe_up: s3.semantic_types.length === 1 && s3.semantic_types[0] === 'swipe' && sw?.direction === 'up',
  no_crosstalk: results.reduce((n, r) => n + r.semantic_types.length, 0) === 3,
  hits_present: hitRecs.length >= 3,
  hits_have_target: hitRecs.length > 0 && hitRecs.every((h) => h.target !== null && h.ok),
  duration_from_samples: s1.held_ms > 0 && s2.held_ms > 0,   // 时长由样本时间戳算出（非声明）
}
const verdict = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'
const report = {
  ok: verdict === 'PASS',
  path: 'gesture',
  host_id: 'harmony',
  note: '鸿蒙腿：uitest uiInput 真注入（系统输入栈）→ ArkTS onTouch 真触摸链 → 样本落盘 → 三端中立识别器分类；'
    + '★覆盖 iOS V16 明确未覆盖的 "UITouch->duration-classification"（真实时长分流）',
  ts_unit: NS ? 'ns(已换算 ms)' : 'ms',
  segments: results,
  hits: hitRecs,
  checks,
  verdict,
}
console.log(JSON.stringify(report, null, 1))
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n')
process.exit(report.ok ? 0 : 1)
