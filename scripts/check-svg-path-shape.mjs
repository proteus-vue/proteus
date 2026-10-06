#!/usr/bin/env node
// scripts/check-svg-path-shape.mjs —— ★★SVG 段列表的**跨语言序列化形态**门禁（C2，2026-10-01）
//
// 【为什么需要（本仓真实教训）】`SvgPath` 的 JSON 形态由 Rust 枚举的 serde 派生**自动决定**：
//   `PathSeg::MoveTo(x,y)` → `{"MoveTo":[x,y]}`；`PathSeg::Close` → `"Close"`（单位串）。
//   两个宿主（Swift / Java）各写一份"形态假设"的翻译器 ⇒ **首版双双按臆想的
//   `{"t":"M","v":[…]}` 写** ⇒ 真机现象：内核读数全对（动画受理、进度正确）而
//   **层根本没建**（iOS `strokeEnd=-1`）。这正是本仓纪律 #22 警告的形态：
//   第 N 份手写副本 = 下一个静默缺陷。
//
// 【判据】从内核 `svg_path.rs` 的枚举定义**推出**序列化键名（变体名 = JSON 键），
//   再要求两个宿主的翻译器**都出现这些键名**（任一侧漏 = 红）。
//   ★键名从源码推出（唯一事实源），不硬编码——下次改枚举时门禁自动跟着变。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KERNEL = path.join(ROOT, 'packages/layout-core-rust/src/svg_path.rs')

function variantNames() {
  const src = fs.readFileSync(KERNEL, 'utf8')
  const m = /pub enum PathSeg\s*\{([\s\S]*?)\}/.exec(src)
  if (!m) return { error: '找不到 `pub enum PathSeg`（被改名/搬走？）' }
  const names = [...m[1].matchAll(/^\s*([A-Z][A-Za-z]+)\s*\(/gm)].map((x) => x[1])
  if (names.length === 0) return { error: '枚举里没解析到变体（带数据的变体形态变了？）' }
  return { names }
}

// ★★路径变形 v1（2026-10-01）：树里新增 **`svgPathTo`**（B 态）——两端 + 适配器都必须
//   引用该键名（漏一个 = 该端读不到 B 态 ⇒ 变形动画被内核拒且**静默**）。
const MORPH_KEY = 'svgPathTo'
const CONSUMERS = [
  {
    label: 'iOS 宿主（cgPathFromSegs + styleOf 透传）',
    file: 'hosts/ios/ProteusHost/runtime/selfdraw-scene.swift',
  },
  {
    label: 'Android 宿主（setNodeSvgStroke + CORE_KEYS）',
    file: 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/ProteusHostView.java',
  },
  // 适配器只透传顶层键（子键由宿主解析）
  { label: '自绘适配器（LAYOUT_KEYS）', file: 'packages/renderer-app/src/adapters/selfdraw.ts', onlyMorph: true },
  // Android 节目宿主的 CORE_KEYS 也要带（否则请求树不带 B 态）
  { label: 'Android 节目宿主（CORE_KEYS）', file: 'hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/LightsHost.java', onlyMorph: true },
]

const { names, error } = variantNames()
if (error) {
  console.error(`✗ SVG 段形态门禁：${error}`)
  process.exit(1)
}

let bad = 0
console.log(` 内核 PathSeg 变体（序列化键名）：${names.join(' / ')} · Close（单位串）`)
for (const c of CONSUMERS) {
  const p = path.join(ROOT, c.file)
  if (!fs.existsSync(p)) {
    console.error(`  ❌ ${c.label}：文件不存在（${c.file}）`)
    bad++
    continue
  }
  const src = fs.readFileSync(p, 'utf8')
  if (c.onlyMorph) {
    // 只要求 B 态键名（段形态翻译在宿主；适配器/节目宿主只做透传）
    if (!src.includes(`'${MORPH_KEY}'`) && !src.includes(`"${MORPH_KEY}"`)) {
      console.error(`  ❌ ${c.label}：缺 ${MORPH_KEY}（透传面）——请求树不带 B 态 ⇒ 变形被拒且静默`)
      bad++
    } else {
      console.log(`  ✅ ${c.label}：含 ${MORPH_KEY}（透传面）`)
    }
    continue
  }
  const missing = names.filter((n) => !src.includes(`"${n}"`))
  const closeOk = src.includes('"Close"')
  const morphOk = src.includes(`"${MORPH_KEY}"`) || src.includes(`'${MORPH_KEY}'`)
  if (missing.length > 0 || !closeOk || !morphOk) {
    console.error(
      `  ❌ ${c.label}：翻译器缺键名 ${missing.join(', ')}${closeOk ? '' : ' + "Close"'}${morphOk ? '' : ` + "${MORPH_KEY}"`}` +
        '——与内核序列化形态不一致（层会建不出来：真机表现为读不到 path/进度/变形）',
    )
    bad++
  } else {
    console.log(`  ✅ ${c.label}：翻译器覆盖全部键名（含 "Close" + ${MORPH_KEY}）`)
  }
}

if (bad > 0) {
  console.error('\n✗ SVG 段形态不一致（两端必须翻译内核的**真实**序列化形态）')
  process.exit(1)
}
console.log('\n✅ SVG 段列表跨语言形态一致（内核 serde 形态 ⇄ 两端翻译器）')
