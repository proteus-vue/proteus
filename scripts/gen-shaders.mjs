#!/usr/bin/env node
// scripts/gen-shaders.mjs —— ★★★着色器生成桥（决策 #834）
//
// 【做什么】调用 Rust 生成器 `proteus-shader-gen`（算法真源 = WGSL + naga 落地），
//   把产物写成 TS 包 `@proteus-vue/shader` 内的**可提交生成物** `src/generated/materials.ts`：
//   各材质 × 各目标的着色器源码（字符串常量）+ 材质目录（uniform 布局）。
//
// 【为什么中间要过一层 Node】① 仓库是 pnpm/TS 主导，宿主（Java/Swift）与 TS 侧都要能引用"生成的源码"；
//   ② 生成的源码**入库**（可 diff、可审）⇒ 漂移可被门禁抓（`--check` 重生成并比对）。
//
// 【用法】
//   node scripts/gen-shaders.mjs            # 生成/更新 generated/materials.ts
//   node scripts/gen-shaders.mjs --check    # 只校验：与现有一致则 0，不一致则 1（CI 门禁用）
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const CRATE = path.join(ROOT, 'packages/shader-codegen-rust')
const OUT_TS = path.join(ROOT, 'packages/shader/src/generated/materials.ts')
const ANDROID_JAVA = path.join(ROOT, 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/GeneratedMaterials.java')
const IOS_SWIFT = path.join(ROOT, 'hosts/ios/ProteusHost/runtime/generated-materials.swift')
const CHECK = process.argv.includes('--check')

/** 找 cargo（rustup 默认位） */
function cargoBin() {
  const home = process.env.HOME || ''
  for (const p of [path.join(home, '.cargo/bin/cargo'), '/usr/local/bin/cargo']) {
    if (fs.existsSync(p)) return p
  }
  return 'cargo'
}

/** 跑 Rust 生成器，产出到临时目录；返回 { catalog, files: {rel→content} } */
function generate() {
  const tmp = fs.mkdtempSync(path.join(ROOT, '.shader-gen-'))
  try {
    // ★离线优先（本地快），但 CI 首次需联网拉 crates.io ⇒ 可用 PROTEUS_CARGO_OFFLINE=0 关闭。
    const offline = process.env.PROTEUS_CARGO_OFFLINE !== '0'
    const cargoArgs = ['run', '--release', '--quiet', ...(offline ? ['--offline'] : []), '--', '--out-dir', tmp]
    execFileSync(cargoBin(), cargoArgs, {
      cwd: CRATE,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` },
    })
    const catalog = JSON.parse(fs.readFileSync(path.join(tmp, 'catalog.json'), 'utf8'))
    const files = {}
    for (const f of fs.readdirSync(tmp)) {
      if (f === 'catalog.json' || f === 'README.md') continue
      files[f] = fs.readFileSync(path.join(tmp, f), 'utf8')
    }
    return { catalog, files }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/** 把 catalog + files 组装成 TS 模块文本（稳定的确定性输出——键排序）。 */
function toTsModule(catalog, files) {
  const fileKeys = Object.keys(files).sort()
  const lines = []
  lines.push('// packages/shader/src/generated/materials.ts')
  lines.push('// ★★★本文件由 `node scripts/gen-shaders.mjs` **自动生成**——请勿手改（改算法请改')
  lines.push('//   packages/shader-codegen-rust/src/materials/*.wgsl，再重生成）。门禁 `check:shader-generated`')
  lines.push('//   会重生成并比对，手改即红。')
  lines.push('')
  lines.push('/* eslint-disable */')
  lines.push('')
  lines.push('/** 材质 × 目标 → 着色器源码（键形如 `glass.msl.frag.metal`）。 */')
  lines.push('export const SHADER_SOURCES: Readonly<Record<string, string>> = {')
  for (const k of fileKeys) {
    lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(files[k])},`)
  }
  lines.push('}')
  lines.push('')
  lines.push('/** 材质目录（uniform 布局等）——与 Rust `materials::catalog_json` 同源。 */')
  lines.push('export const MATERIAL_CATALOG = ' + JSON.stringify(catalog, null, 2) + ' as const')
  lines.push('')
  return lines.join('\n')
}

/** Android：生成 `GeneratedMaterials.java`（AGSL 常量；宿主 `GlassMaterial` 引用它，不再手写算法）。 */
function toJavaModule(catalog, files) {
  const agsl = files['glass.agsl.frag.glsl'] ?? ''
  const esc = (s) => JSON.stringify(s) // JSON 转义对 Java 字符串字面量同样合法（无 \u 例外）
  const lines = []
  lines.push('package dev.proteus.layoutcore;')
  lines.push('')
  lines.push('// ★★★本文件由 `node scripts/gen-shaders.mjs` **自动生成**——请勿手改。')
  lines.push('//   算法真源 = packages/shader-codegen-rust/src/materials/*.wgsl（Rust WGSL + naga 落地 AGSL）。')
  lines.push('//   宿主只引用本常量做落地（编译 + 设 uniform + 跑 pass），不写算法。')
  lines.push('final class GeneratedMaterials {')
  lines.push('    private GeneratedMaterials() {}')
  lines.push('')
  for (const m of catalog.materials) {
    const src = files[`${m.id}.agsl.frag.glsl`] ?? ''
    // 常量名：glass → GLASS_AGSL；backdropBlur → BACKDROP_BLUR_AGSL（驼峰→下划线大写）
    const constName = m.id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase() + '_AGSL'
    lines.push(`    /** ${m.id} 材质片元（AGSL · 由 WGSL 真源落地）。 */`)
    lines.push(`    static final String ${constName} = ${esc(src)};`)
  }
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}

/** iOS：生成 `generated-materials.swift`（MSL 片元 + 顶点常量；宿主 Metal pass 引用它）。 */
function toSwiftModule(catalog, files) {
  const esc = (s) => JSON.stringify(s) // Swift 普通字符串字面量的转义与 JSON 一致（本处无 \u）
  const lines = []
  lines.push('// hosts/ios/ProteusHost/runtime/generated-materials.swift')
  lines.push('// ★★★本文件由 `node scripts/gen-shaders.mjs` **自动生成**——请勿手改。')
  lines.push('//   算法真源 = packages/shader-codegen-rust/src/materials/*.wgsl（Rust WGSL + naga 落地 MSL）。')
  lines.push('//   宿主 Metal pass 只编译本常量（不手写 CoreImage/Metal 着色器）。')
  lines.push('')
  lines.push('import Foundation')
  lines.push('')
  lines.push('enum GeneratedMaterials {')
  for (const m of catalog.materials) {
    const frag = files[`${m.id}.msl.frag.metal`] ?? ''
    const vert = files[`${m.id}.msl.vert.metal`] ?? ''
    // 属性名：glass → glassFragmentMSL；backdropBlur → backdropBlurFragmentMSL
    lines.push(`    /// ${m.id} 材质片元（MSL）。`)
    lines.push(`    static let ${m.id}FragmentMSL = ${esc(frag)}`)
    lines.push(`    /// ${m.id} 材质顶点（MSL）。`)
    lines.push(`    static let ${m.id}VertexMSL = ${esc(vert)}`)
  }
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}

const { catalog, files } = generate()
const outputs = [
  [OUT_TS, toTsModule(catalog, files)],
  [ANDROID_JAVA, toJavaModule(catalog, files)],
  [IOS_SWIFT, toSwiftModule(catalog, files)],
]

if (CHECK) {
  let drift = false
  for (const [f, next] of outputs) {
    const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
    if (cur !== next) {
      console.error(`✗ 生成物与源码不一致（漂移）：${path.relative(ROOT, f)}`)
      drift = true
    }
  }
  if (drift) {
    console.error('  ⇒ 跑 `node scripts/gen-shaders.mjs` 重生成并提交')
    process.exit(1)
  }
  console.log('✓ 着色器生成物与 Rust 真源一致（无漂移：TS + Android + iOS）')
  process.exit(0)
}

for (const [f, content] of outputs) {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, content)
  console.log(`✓ 已生成 ${path.relative(ROOT, f)}`)
}
console.log(`  （${Object.keys(files).length} 个着色器源）`)
