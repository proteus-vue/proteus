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
const HARMONY_HEADER = path.join(ROOT, 'hosts/harmony/host-app/proteus_render/src/main/cpp/generated_materials_spirv.h')
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
    const binaries = {}   // ★决策 #841：SPIR-V 是**二进制** ⇒ 单独收集（不入文本 TS 模块）
    for (const f of fs.readdirSync(tmp)) {
      if (f === 'catalog.json' || f === 'README.md') continue
      if (f.endsWith('.spv')) { binaries[f] = fs.readFileSync(path.join(tmp, f)) }
      else files[f] = fs.readFileSync(path.join(tmp, f), 'utf8')
    }
    return { catalog, files, binaries }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/** 把 catalog + files 组装成 TS 模块文本（稳定的确定性输出——键排序）。 */
function toTsModule(catalog, files, binaries) {
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
  lines.push('/** ★★★SPIR-V 二进制（base64；键形如 `glass.spirv.frag.spv`）——Vulkan 载体（决策 #841）。 */')
  lines.push('export const SHADER_SPIRV: Readonly<Record<string, string>> = {')
  for (const k of Object.keys(binaries).sort()) {
    lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(binaries[k].toString('base64'))},`)
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
  // ★★★决策 #900：材质字典——宿主按 `style.glass.material` 查表选 AGSL 源 + uniform 分派。
  lines.push('')
  lines.push('    /** ★#900：材质定义（AGSL 无顶点阶段；入口恒 `main`）。uniformStruct 是宿主 uniform 分派的判别键。 */')
  lines.push('    static final class Def {')
  lines.push('        final String frag; final String uniformStruct; final int uniformSize;')
  lines.push('        Def(String frag, String uniformStruct, int uniformSize) {')
  lines.push('            this.frag = frag; this.uniformStruct = uniformStruct; this.uniformSize = uniformSize;')
  lines.push('        }')
  lines.push('    }')
  lines.push('    /** ★#900：材质字典（id → 片元源 + uniform 元信息）。 */')
  lines.push('    static final java.util.Map<String, Def> MATERIALS = new java.util.LinkedHashMap<>();')
  lines.push('    static {')
  for (const m of catalog.materials) {
    const constName = m.id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase() + '_AGSL'
    lines.push(`        MATERIALS.put(${JSON.stringify(m.id)}, new Def(${constName}, ${JSON.stringify(m.uniformStruct)}, ${m.uniformSize}));`)
  }
  lines.push('    }')
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
  // ★★★决策 #900：材质字典——宿主按 `style.glass.material` 查此表**建/选管线**（数据驱动，加材质零改宿主）。
  //   uniformStruct 是宿主 uniform 分派的判别键（GlassUniforms → 玻璃 builder；其余 → 模糊族 builder）。
  lines.push('')
  lines.push('    /// ★#900：材质字典（id → 源码/入口/uniform）；宿主据此建管线注册表。')
  lines.push('    struct MaterialSource { let frag: String; let vert: String; let entry: String; let uniformStruct: String; let uniformSize: Int }')
  lines.push('    static let materials: [String: MaterialSource] = [')
  for (const m of catalog.materials) {
    lines.push(`        ${JSON.stringify(m.id)}: MaterialSource(frag: ${m.id}FragmentMSL, vert: ${m.id}VertexMSL, entry: ${JSON.stringify(m.entry)}, uniformStruct: ${JSON.stringify(m.uniformStruct)}, uniformSize: ${m.uniformSize}),`)
  }
  lines.push('    ]')
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}

/**
 * ★★★鸿蒙：生成 `generated_materials_spirv.h`（SPIR-V 二进制 → C 数组常量；决策 #841）。
 *
 * 【为什么是 C 头而不是源码】SPIR-V 是**二进制**（`vkCreateShaderModule` 吃字节流）——
 *   嵌成 `static const uint32_t[]`（每元素 4 字节，小端对齐 Vulkan 契约）。宿主 Vulkan pass
 *   直接引用这两个数组，**不手写着色器算法**（与 Android/iOS 同源：同一份 WGSL 落地）。
 */
function toHarmonyHeader(catalog, binaries) {
  const lines = []
  lines.push('// hosts/harmony/host-app/proteus_render/src/main/cpp/generated_materials_spirv.h')
  lines.push('// ★★★本文件由 `node scripts/gen-shaders.mjs` **自动生成**——请勿手改。')
  lines.push('//   算法真源 = packages/shader-codegen-rust/src/materials/*.wgsl（Rust WGSL + naga 落地 SPIR-V）。')
  lines.push('//   鸿蒙宿主离屏 Vulkan pass 只引用本常量（编译管线 + 设 uniform + 跑 pass），不写算法。')
  lines.push('//   ★真机取证（决策 #841）：鸿蒙 libvulkan 1.3 + 计算/图形队列（Maleoon 920C）⇒ 可跑本 SPIR-V。')
  lines.push('#pragma once')
  lines.push('#include <cstdint>')
  lines.push('#include <cstddef>')
  lines.push('')
  lines.push('namespace proteus_shaders {')
  for (const m of catalog.materials) {
    const vName = `${m.id}.spirv.vert.spv`
    const fName = `${m.id}.spirv.frag.spv`
    const vert = binaries[vName]
    const frag = binaries[fName]
    if (!vert || !frag) continue
    const toWords = (buf) => {
      const words = []
      for (let i = 0; i < buf.length; i += 4) {
        // 小端 4 字节 → uint32（SPIR-V magic 应成 0x07230203）
        words.push(buf.readUInt32LE(i) >>> 0)
      }
      return words
    }
    const vw = toWords(vert)
    const fw = toWords(frag)
    const name = m.id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()
    lines.push(`// ${m.id} 顶点 SPIR-V（${vert.length} 字节）`)
    lines.push(`static const uint32_t ${name}_VERT_SPV[] = {`)
    lines.push('    ' + vw.map((w) => '0x' + w.toString(16).padStart(8, '0')).join(', '))
    lines.push('};')
    lines.push(`static const size_t ${name}_VERT_SPV_LEN = sizeof(${name}_VERT_SPV);`)
    lines.push(`// ${m.id} 片元 SPIR-V（${frag.length} 字节）`)
    lines.push(`static const uint32_t ${name}_FRAG_SPV[] = {`)
    lines.push('    ' + fw.map((w) => '0x' + w.toString(16).padStart(8, '0')).join(', '))
    lines.push('};')
    lines.push(`static const size_t ${name}_FRAG_SPV_LEN = sizeof(${name}_FRAG_SPV);`)
  }
  // ★★★决策 #900：材质字典——宿主（C++）按 `style.glass.material` 查表选 SPIR-V + uniform 分派。
  lines.push('')
  lines.push('/// ★#900：材质定义（SPIR-V 顶点/片元 + uniform 判别键 + 片元入口名）。')
  lines.push('struct MaterialDef {')
  lines.push('    const char* id;')
  lines.push('    const uint32_t* vert; size_t vertLen;')
  lines.push('    const uint32_t* frag; size_t fragLen;')
  lines.push('    const char* entry;')
  lines.push('    const char* uniformStruct;')
  lines.push('};')
  lines.push('static const MaterialDef MATERIALS[] = {')
  for (const m of catalog.materials) {
    if (!binaries[`${m.id}.spirv.vert.spv`] || !binaries[`${m.id}.spirv.frag.spv`]) continue
    const name = m.id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()
    lines.push(`    { ${JSON.stringify(m.id)}, ${name}_VERT_SPV, ${name}_VERT_SPV_LEN, ${name}_FRAG_SPV, ${name}_FRAG_SPV_LEN, ${JSON.stringify(m.entry)}, ${JSON.stringify(m.uniformStruct)} },`)
  }
  lines.push('};')
  lines.push('static const size_t MATERIALS_COUNT = sizeof(MATERIALS) / sizeof(MATERIALS[0]);')
  lines.push('}  // namespace proteus_shaders')
  lines.push('')
  return lines.join('\n').replace(/\n+$/, '\n')
}

const { catalog, files, binaries } = generate()
const writes = binaries ? Object.keys(binaries).length : 0
const outputs = [
  [OUT_TS, toTsModule(catalog, files, binaries)],
  [ANDROID_JAVA, toJavaModule(catalog, files)],
  [IOS_SWIFT, toSwiftModule(catalog, files)],
  [HARMONY_HEADER, toHarmonyHeader(catalog, binaries)],
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
  console.log('✓ 着色器生成物与 Rust 真源一致（无漂移：TS + Android + iOS + 鸿蒙 SPIR-V）')
  process.exit(0)
}

for (const [f, content] of outputs) {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, content)
  console.log(`✓ 已生成 ${path.relative(ROOT, f)}`)
}
console.log(`  （${Object.keys(files).length} 个着色器源 + ${writes} 个 SPIR-V 二进制）`)
