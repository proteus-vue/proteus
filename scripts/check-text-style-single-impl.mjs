#!/usr/bin/env node
// scripts/check-text-style-single-impl.mjs —— ★★★「文本字体属性：同一平台只有一个设置点」门禁（2026-10-18）
//
// 【为什么需要（真实事故 · 决策 #1054/#1055）】鸿蒙端 `font-style` 加完后真机三段 shear **全 0**
//   （完全没生效），排查发现**同一平台内有两套字体设置实现**：
//     · 测量侧走平台层 `applyTextFont`（proteus_text_platform.h）——我在那里加了斜体枚举映射；
//     · 绘制侧（`proteus_render.cpp`）**自己内联** `OH_Drawing_SetTextStyleFontWeight/FontFamilies`，
//       从不读 `fontStyle` ⇒ 加在上游的那项永远到不了屏幕。
//   ⇒ 于是"加能力只改一半"必然发生（本轮实证：白验一轮真机）。
//   ★用户原话：「通用能力在同一个系统里面严禁每个宿主都需要实现一遍」。
//
// 【判据】对每个平台，**文本字体属性的原生设置调用**（字重/字族/斜体/字号）必须只出现在
//   **平台层**（`platform/<端>/**` 或随包 runtime 的 `proteus_text_platform.h`）；
//   宿主目录（`hosts/<端>/**`）里若**再次出现**这些原生调用 ⇒ 红（提示改调平台层唯一实现）。
//
//   · 例外（白名单，须写理由）：装饰/阴影/字距/对齐等**不属于"字体属性"**的调用（它们各只有一处，
//     且不属于本轮统一面）——不拦；本门禁只盯 weight/family/style/italic 四类。
//   · 鸿蒙的 runtime 真源在 `hosts/harmony/host-app/proteus_render/**`（既是"宿主"也是"平台实现承载"，
//     因为 HAR 是随包 runtime）⇒ 该目录下**只允许** `proteus_text_platform.h` 一个文件出现这些调用。
//
// 【用法】node scripts/check-text-style-single-impl.mjs [--json]
//   退出码：0 通过 / 1 违约
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JSON_OUT = process.argv.includes('--json')

/** 被认定为「字体属性原生设置」的调用（各端各写一份语法） */
const FONT_CALLS = [
  { re: /OH_Drawing_SetTextStyleFontWeight\s*\(/g, name: 'OH_Drawing_SetTextStyleFontWeight', platform: 'harmony' },
  { re: /OH_Drawing_SetTextStyleFontFamilies\s*\(/g, name: 'OH_Drawing_SetTextStyleFontFamilies', platform: 'harmony' },
  { re: /OH_Drawing_SetTextStyleFontStyle\s*\(/g, name: 'OH_Drawing_SetTextStyleFontStyle', platform: 'harmony' },
  { re: /Typeface\.create\s*\(/g, name: 'Typeface.create', platform: 'android' },
  { re: /withSymbolicTraits\s*\(/g, name: 'withSymbolicTraits', platform: 'ios' },
]

/** 每个平台：允许出现字体调用的**唯一文件**（相对仓库根；路径前缀匹配） */
const ALLOWED = {
  harmony: [
    'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_text_platform.h',
    // 随包副本（由 scripts/harmony-runtime-prebuilt.mjs 从真源同步，逐字节一致）
    'packages/cli/templates-host/prebuilt/harmony/proteus_render/src/main/cpp/proteus_text_platform.h',
  ],
  android: [
    'platform/android/proteus-platform/src/dev/proteus/platform/ProteusTextPlatform.java',
  ],
  ios: [
    'platform/ios/ProteusPlatform/ProteusTextAdapter.swift',
  ],
}

/** 扫描范围（只看实现目录，不扫 build/dist/node_modules） */
const SCAN = {
  harmony: ['hosts/harmony', 'packages/cli/templates-host/prebuilt/harmony'],
  android: ['hosts/android', 'platform/android', 'packages/cli/templates-host/prebuilt/android'],
  ios: ['hosts/ios', 'platform/ios', 'packages/cli/templates-host/prebuilt/ios'],
}

/**
 * 具名豁免（**必须写理由**；只允许"不是产品渲染路径"的文件）：
 *   · proteus_bench.cpp —— 鸿蒙 V13/矩阵 #9 的**字体族诊断探针**（验证"不同字族 ⇒ 度量必须不同"）。
 *     它是**测量装置**、不参与产品绘制；直接调原生族名是探针的**被测量对象**本身
 *     （改走平台层就等于用被测物去测自己，判据失去独立性）。
 *   ★新增豁免必须逐条说明"为什么它不是产品渲染路径"，否则本门禁失去意义。
 */
const EXCUSED = new Set([
  'hosts/harmony/host-app/entry/src/main/cpp/dev/proteus_bench.cpp',
])

const SKIP_DIR = new Set(['node_modules', 'build', 'dist', '.hvigor', '.cxx', 'target', '.git'])

function walk(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (SKIP_DIR.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (/\.(cpp|cc|h|hpp|java|kt|swift)$/.test(e.name)) out.push(full)
  }
  return out
}

/** 去掉注释（粗略：行注释 + 块注释）——避免"注释里提到调用"被误判 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/.*$/gm, '$1')
}

const problems = []
const stats = {}

for (const platform of Object.keys(SCAN)) {
  stats[platform] = { files: 0, calls: 0, allowedCalls: 0 }
  const allowed = ALLOWED[platform].map((p) => path.join(ROOT, p))
  for (const root of SCAN[platform]) {
    for (const file of walk(path.join(ROOT, root))) {
      const rel = path.relative(ROOT, file)
      if (rel.includes('templates-host/prebuilt/harmony') && !rel.includes('proteus_render')) continue
      if (rel.includes('templates-host/harmony') && !rel.includes('proteus_render')) continue
      if (EXCUSED.has(rel)) continue   // 具名豁免（诊断探针，非产品渲染路径）
      const src = stripComments(fs.readFileSync(file, 'utf-8'))
      const isAllowedFile = allowed.some((a) => path.resolve(a) === path.resolve(file))
      stats[platform].files++
      for (const { re, name, platform: p } of FONT_CALLS) {
        if (p !== platform) continue
        re.lastIndex = 0
        const hits = src.match(re)
        if (!hits) continue
        stats[platform].calls += hits.length
        if (isAllowedFile) { stats[platform].allowedCalls += hits.length; continue }
        // 非平台层文件里出现字体原生调用 ⇒ 违约（两套实现的温床）
        problems.push({
          platform,
          file: rel,
          call: name,
          count: hits.length,
          hint: `改用平台层唯一实现（${ALLOWED[platform].map((x) => path.relative(ROOT, x)).join(' 或 ')}）`,
        })
      }
    }
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: problems.length === 0, stats, problems }, null, 2))
} else {
  console.log('文本字体属性「单实现」门禁（同一平台严禁每个宿主实现一遍）')
  for (const [p, s] of Object.entries(stats)) {
    console.log(`  ${p.padEnd(8)} 扫描 ${String(s.files).padStart(3)} 文件 · 字体调用 ${s.calls} 处（平台层 ${s.allowedCalls}）`)
  }
  if (problems.length) {
    console.log(`\n❌ ${problems.length} 处违约（宿主里重复实现字体属性）：`)
    for (const p of problems) {
      console.log(`  [${p.platform}] ${p.file} → ${p.call} ×${p.count}`)
      console.log(`      修法：${p.hint}`)
    }
  } else {
    console.log('\n✅ 三端字体属性均只有**一个设置点**（平台层）；宿主不再各自实现')
  }
}

process.exit(problems.length === 0 ? 0 : 1)
