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

const CONSUMERS = [
  {
    label: 'iOS 宿主（cgPathFromSegs）',
    file: 'hosts/ios/ProteusHost/selfdraw-scene.swift',
  },
  {
    label: 'Android 宿主（setNodeSvgStroke）',
    file: 'hosts/android/app/src/main/java/dev/proteus/layoutcore/ProteusHostView.java',
  },
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
  const missing = names.filter((n) => !src.includes(`"${n}"`))
  const closeOk = src.includes('"Close"')
  if (missing.length > 0 || !closeOk) {
    console.error(
      `  ❌ ${c.label}：翻译器缺键名 ${missing.join(', ')}${closeOk ? '' : ' + "Close"'}` +
        '——与内核序列化形态不一致（层会建不出来：真机表现为读不到 path/进度）',
    )
    bad++
  } else {
    console.log(`  ✅ ${c.label}：翻译器覆盖全部键名（含 "Close"）`)
  }
}

if (bad > 0) {
  console.error('\n✗ SVG 段形态不一致（两端必须翻译内核的**真实**序列化形态）')
  process.exit(1)
}
console.log('\n✅ SVG 段列表跨语言形态一致（内核 serde 形态 ⇄ 两端翻译器）')
