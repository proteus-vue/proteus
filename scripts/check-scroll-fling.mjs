#!/usr/bin/env node
// scripts/check-scroll-fling.mjs —— ★★三端「松手惯性」接线门禁（2026-10-09 · 决策 #685）
//
// 【为什么立（用户原话：「App 三端页面滚动不跟手，松手就顿住，没有大厂那种惯性」）】
//   取证发现三端**都没有竖向松手惯性**：Android 的 `startFlingX` 只在 `horizontalScroll` 模式下接、
//   竖向 `onFling` 无人调用；iOS `handleScrollPan` **没有 `.ended` 分支**；鸿蒙 `TouchType.Up` 只处理 tap。
//   而仓库里**没有任何判据**能防止"代码在、没接线"（Android 更早有 `startFlingX` 声明却无人调的先例）。
//
// 【本门禁判什么（**结构接线**，不是行为——行为由真机验收，见 §诚实边界）】
//   三端各须证明"松手 → 启动惯性 → 逐帧推进"这条链**真的接上**：
//     · Android：`onFling` 调 `startFling*` + `stepInertia` 推进 Y + 有 `applyScrollY` 唯一入口
//     · iOS：pan 处理器含 `.ended`/`.cancelled` 分支调 `startMomentum` + `stepMomentum` 每帧推进
//     · 鸿蒙：`TouchType.Up` 调 `startMomentum` + `applyScrollBy` 去重
//
// 【诚实边界】**只判"接线存在"，不判"手感/物理曲线正确"**——后者是真机行为，须真机验收。
//   本门禁挡的是"重构把接线删了 / 又退回 dead-stop"这类回归（本仓最高频缺陷形态之一）。
//
// 用法：node scripts/check-scroll-fling.mjs [--json]
// 退出码：0 接线齐 · 1 有端缺失 · 2 前置（源文件找不到）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JSON_OUT = process.argv.includes('--json')

/** 每端：文件 + 必须命中的正则（接线证据） */
const SPECS = [
  {
    end: 'android',
    file: 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/ProteusHostView.java',
    must: [
      { name: '竖向 fling 入口 startFlingY', re: /void\s+startFlingY\s*\(/ },
      { name: 'onFling 接竖向（else startFlingY）', re: /else\s+startFlingY\s*\(/ },
      { name: 'stepInertia 推进 Y 轴（applyScrollY）', re: /getCurrY\(\)[\s\S]{0,200}?applyScrollY/ },
      { name: 'applyScrollY 唯一入口存在', re: /String\s+applyScrollY\s*\(/ },
    ],
  },
  {
    end: 'ios',
    file: 'hosts/ios/ProteusHost/runtime/selfdraw-scene.swift',
    must: [
      { name: '松手启动动量 startMomentum', re: /func\s+startMomentum\s*\(/ },
      { name: 'pan 处理器含 ended/cancelled 分支', re: /\.ended\s*,\s*\.cancelled/ },
      { name: '每帧推进 stepMomentum', re: /func\s+stepMomentum\s*\(/ },
      { name: 'momentum 帧计数器（回执证据）', re: /momentumMovedFrames/ },
    ],
  },
  {
    end: 'harmony',
    file: 'hosts/harmony/host-app/entry/src/main/ets/shell/Superapp.ets',
    must: [
      { name: '松手启动惯性 startMomentum', re: /private\s+startMomentum\s*\(/ },
      { name: 'TouchType.Up 接惯性', re: /TouchType\.Up[\s\S]{0,600}?startMomentum/ },
      { name: 'applyScrollBy 唯一入口', re: /private\s+applyScrollBy\s*\(/ },
      { name: 'momentum 帧计数器（回执证据）', re: /momentumMovedFrames/ },
    ],
  },
]

const problems = []
const results = []
for (const spec of SPECS) {
  const abs = path.join(ROOT, spec.file)
  if (!fs.existsSync(abs)) {
    problems.push(`✗ ${spec.end}：源文件不存在 ${spec.file}`)
    results.push({ end: spec.end, ok: false, missing: ['源文件'] })
    continue
  }
  const src = fs.readFileSync(abs, 'utf-8')
  const missing = spec.must.filter((m) => !m.re.test(src)).map((m) => m.name)
  results.push({ end: spec.end, ok: missing.length === 0, missing })
  for (const m of missing) problems.push(`✗ ${spec.end}：缺少「${m}」（松手惯性接线不完整）`)
}

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: problems.length === 0, ends: results }, null, 2))
  process.exit(problems.length === 0 ? 0 : 1)
}

console.log('[check-scroll-fling] 三端「松手惯性」接线门禁（结构判据；行为须真机验收）')
for (const r of results) {
  console.log(r.ok ? `  ✅ ${r.end}：接线齐（4 项）` : `  ✗ ${r.end}：缺 ${r.missing.join(' / ')}`)
}
if (problems.length) {
  console.log('\n诊断：')
  for (const p of problems) console.log(`  ${p}`)
  console.log('\n★提示：三端滚动须「手指拖拽 + 松手惯性」两段（对齐 Web/IOS UIScrollView 观感）。')
  process.exit(1)
}
console.log('\n✅ 三端松手惯性接线齐（Android startFlingY/applyScrollY · iOS startMomentum · 鸿蒙 startMomentum）')
