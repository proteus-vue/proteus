#!/usr/bin/env node
// scripts/check-glass-capability.mjs —— ★★★玻璃材质能力门禁（自研液态玻璃 · 决策 #818）
//
// 【为什么需要】「自研液态玻璃材质」让**即使 OS 没有玻璃能力**也能近似最新系统的液态玻璃：
//   构建期 `<pg-glass>` 折成内核 `style.glass`（材质参数唯一真源 = `@proteus-vue/glass`），
//   三端宿主据 `glass` 字段自绘/映射。这有两条静默失效面：
//     ① **值漂移**：`TAB_BAR_SPEC.glass` 与 `@proteus-vue/glass` 的 preset 不一致（#803 教训：规格须钉"值==基准源"）；
//     ② **接缝丢失**：`glass` 字段名的跨语言接缝（编译器键表 / 自绘适配器 / 内核 NodeDto / Android 宿主白名单）
//        任一缺失 ⇒ 请求树不带 glass ⇒ 内核不解析 ⇒ **宿主画不出玻璃且静默**（同 check-svg-path-shape 的教训）。
//
// 【判据】
//   ① **值一致**：`TAB_BAR_SPEC.glass` == `@proteus-vue/glass` 的 `tabBar` preset（blur/tint/border/borderSide）。
//   ② **接缝齐**：`glass` 字段名出现在全部必须知道它的地方（编译器 PAINT_DECL_KEY / selfdraw LAYOUT_KEYS /
//      内核 NodeDto / Android VaporRenderHost.LAYOUT_KEYS）。
//
// 用法：node scripts/check-glass-capability.mjs   退出码 0/1
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const problems = []

// ① 值一致：TAB_BAR_SPEC.glass == glass 包的 tabBar preset
async function valueCheck() {
  const rbEntry = path.join(ROOT, 'packages/render-backend/dist/index.js')
  const glassEntry = path.join(ROOT, 'packages/glass/dist/index.js')
  if (!fs.existsSync(rbEntry) || !fs.existsSync(glassEntry)) {
    problems.push('缺 dist（先跑 node scripts/build-packages.mjs）')
    return
  }
  const { TAB_BAR_SPEC } = await import(pathToFileURL(rbEntry).href)
  const { getGlassPreset } = await import(pathToFileURL(glassEntry).href)
  const g = TAB_BAR_SPEC.glass
  if (!g) {
    problems.push('TAB_BAR_SPEC.glass 缺失（期 B 起 tab 栏玻璃的单源规格）')
    return
  }
  const p = getGlassPreset('tabBar')
  if (g.blur !== p.blur) problems.push(`TAB_BAR_SPEC.glass.blur=${g.blur} ≠ glass.tabBar.blur=${p.blur}`)
  if (g.tint !== p.tint) problems.push(`TAB_BAR_SPEC.glass.tint="${g.tint}" ≠ glass.tabBar.tint="${p.tint}"`)
  if (g.border !== p.border) problems.push(`TAB_BAR_SPEC.glass.border=${g.border} ≠ glass.tabBar.border=${p.border}`)
  if (g.borderSide !== p.borderSide) problems.push(`TAB_BAR_SPEC.glass.borderSide="${g.borderSide}" ≠ glass.tabBar.borderSide="${p.borderSide}"`)
}

// ② 接缝齐：glass 字段名在全部"必须知道它"的地方出现
const SEAMS = [
  { label: '编译器属性折叠表（PAINT_DECL_KEY）', file: 'packages/compiler/src/vapor/template.ts', needle: 'glass' },
  { label: '自绘适配器（LAYOUT_KEYS）', file: 'packages/renderer-app/src/adapters/selfdraw.ts', needle: "'glass'" },
  { label: '内核 NodeDto（serde）', file: 'packages/layout-core-rust/src/ffi.rs', needle: 'glass' },
  { label: 'Android 宿主白名单（LAYOUT_KEYS）', file: 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/VaporRenderHost.java', needle: '"glass"' },
  // ★★★鸿蒙腿（决策 #838）：cmd 发射（proteus_host.cpp 里 snprintf 的 `,\"glass\":{...}` 模板）
  //   + 渲染层解析（proteus_render.cpp 的 `extractObjectField(it, "glass")`）——miss 任一 ⇒ 鸿蒙玻璃静默丢失。
  { label: '鸿蒙 cmd 发射（proteus_host.cpp）', file: 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_host.cpp', needle: '\\"glass\\":{' },
  { label: '鸿蒙渲染层解析（proteus_render.cpp）', file: 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_render.cpp', needle: 'extractObjectField(it, "glass")' },
]
function seamCheck() {
  for (const s of SEAMS) {
    const p = path.join(ROOT, s.file)
    if (!fs.existsSync(p)) {
      problems.push(`${s.label}：文件不存在（${s.file}）`)
      continue
    }
    if (!fs.readFileSync(p, 'utf8').includes(s.needle)) {
      problems.push(`${s.label}：缺 "${s.needle}"（接缝丢失 ⇒ 请求树不带 glass ⇒ 宿主画不出玻璃且静默）`)
    }
  }
}

// ③ 半径/模糊**单位换算**齐（★★决策 #890 · G0-B）：IR 的 `glass.{blur,radius}` 是 **CSS 逻辑 px**
//   （=`resolveGlass` 的 `blurPx/radiusPx`，不乘密度；Web 端 `radiusPx → borderRadius:12px`），
//   而三端着色器都在**设备像素空间**（`size_px` 已 ×密度/半分辨率）⇒ 每个宿主**必须**把 glass 的
//   radius/blur 换算到同尺度。任一端漏换算 ⇒ 圆角/模糊停在逻辑值（真机应显的 1/density）⇒ **静默三端不一致**
//   （本门禁建立前实测：Android 漏 ×密度，圆角/模糊为应显的 1/3；见决策 #890）。
const UNIT_SEAMS = [
  { label: 'Android 宿主（physicalizeSpec ×密度）', file: 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/VaporRenderHost.java', needle: 'for (String gk : new String[]{"blur", "radius"})' },
  { label: 'iOS 宿主（makeUniforms ×outScale）', file: 'hosts/ios/ProteusHost/runtime/glass-metal.swift', needle: 'Float(spec.radius * outScale)' },
  { label: '鸿蒙宿主（cmd 发射 ×density）', file: 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_host.cpp', needle: 'grad * density' },
]
function unitCheck() {
  for (const s of UNIT_SEAMS) {
    const p = path.join(ROOT, s.file)
    if (!fs.existsSync(p)) {
      problems.push(`${s.label}：文件不存在（${s.file}）`)
      continue
    }
    if (!fs.readFileSync(p, 'utf8').includes(s.needle)) {
      problems.push(`${s.label}：缺 "${s.needle}"（glass 半径/模糊单位换算丢失 ⇒ 该端停在逻辑 px，三端不一致且静默）`)
    }
  }
}

await valueCheck()
seamCheck()
unitCheck()

if (problems.length) {
  console.error(`✗ 玻璃材质能力门禁未过（${problems.length}）：`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('✅ 玻璃材质能力（值 == glass 包预设单源 · glass 字段跨端接缝齐 · 半径/模糊单位三端换算齐）')
