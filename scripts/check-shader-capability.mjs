#!/usr/bin/env node
// scripts/check-shader-capability.mjs —— ★★★ShaderBackend 能力门禁（决策 #834）
//
// 【为什么需要（新架构的核心防线）】"材质算法"从**各端手写**改为 **Rust 的 WGSL 单一真源**
//   （经 naga 落地到 MSL/AGSL）。这消除漂移的前提是：**没有人在宿主里偷偷再手写一份着色器**——
//   而"手写"正是旧架构的形态（`GlassMaterial.GLASS_AGSL` / `glass-material.swift` 的 kernel 字符串）。
//   ⇒ 本门禁钉三条：
//     ① **真源齐**：Rust 发生器能落全 glass × {msl,agsl,glsl}（调 `proteus-shader-gen --verify`）；
//     ② **生成物不飘**：`packages/shader/src/generated/materials.ts` 与真源一致（`gen-shaders --check`）；
//     ③ **宿主无残留手写算法**：宿主目录里**不得再出现**已知的旧手写着色器标记
//        （如 `GLASS_AGSL`、`kernel vec4 glassFace`、`sdRoundRect(` 之类）——命中即红（防复辟）。
//
// 【判据形态】本脚本只做"文件级/字符串级"静态判据（CI 可跑，无需 GPU）；真机像素等价是另一道
//   （B6 的 `shaderPixelConformance`），两者互补。
//
// 用法：node scripts/check-shader-capability.mjs   退出码 0/1
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const cargo = (() => {
  const p = path.join(process.env.HOME || '', '.cargo/bin/cargo')
  return fs.existsSync(p) ? p : 'cargo'
})()

// ① 真源能落地（Rust 发生器 --verify）
function generateCheck() {
  const offline = process.env.PROTEUS_CARGO_OFFLINE !== '0'
  try {
    const args = ['run', '--release', '--quiet', ...(offline ? ['--offline'] : []), '--', '--verify']
    const out = execFileSync(cargo, args, {
      cwd: path.join(ROOT, 'packages/shader-codegen-rust'),
      env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` },
      encoding: 'utf8',
    })
    if (!out.includes('全部材质 × 目标落地通过')) {
      problems.push('shader-gen --verify 未报"全部通过"')
    }
  } catch (e) {
    problems.push(`shader-gen --verify 失败：${String(e).split('\n')[0]}`)
  }
}

// ② 生成物不飘（gen-shaders --check）
function driftCheck() {
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/gen-shaders.mjs'), '--check'], {
      cwd: ROOT,
      env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` },
      stdio: 'pipe',
    })
  } catch {
    problems.push('生成物与 Rust 真源不一致（跑 `node scripts/gen-shaders.mjs` 重生成并提交）')
  }
}

// ③ 宿主无残留手写算法（防复辟到"各端手写"的旧形态）
//   ★判据：宿主源码里**不得出现算法本身的指纹**（SDF/倒角函数名等）——除非那正是**生成物文件**
//     （GeneratedMaterials.java / generated-materials.swift，它们就是"落地"本身，另由漂移门禁守）。
//   ★指纹取算法函数名（新旧两种拼写）：新生成物用 `sd_round_rect`；旧手写用 `sdRoundRect`/`circleMap`。
//     宿主自己写一段玻璃算法必然出现其中之一 ⇒ 命中即红。
const ALGO_FINGERPRINTS = ['sd_round_rect', 'sdRoundRect', 'circle_map(', 'circleMap(', 'fs_glass(', 'glassFace(']
const GENERATED_WHITELIST = new Set([
  'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/GeneratedMaterials.java',
  'hosts/ios/ProteusHost/runtime/generated-materials.swift',
  // ★决策 #841：鸿蒙 SPIR-V 生成物（C 头）——落地本身（由漂移门禁守），非手写算法。
  'hosts/harmony/host-app/proteus_render/src/main/cpp/generated_materials_spirv.h',
])
function noHandwrittenCheck() {
  const hosts = path.join(ROOT, 'hosts')
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'build', 'dist', '.git', 'results', 'target'].includes(e.name)) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(java|kt|swift|m|mm|ets|cpp|cc|c|h|hpp)$/.test(e.name)) continue
      const rel = path.relative(ROOT, p)
      if (GENERATED_WHITELIST.has(rel)) continue   // 生成物（落地本身）——由漂移门禁守
      const src = fs.readFileSync(p, 'utf8')
      for (const fp of ALGO_FINGERPRINTS) {
        if (src.includes(fp)) problems.push(`宿主残留手写算法 —— ${rel}：含 "${fp}"（算法应只在 WGSL 真源，落地只引用生成物）`)
      }
    }
  }
  if (fs.existsSync(hosts)) walk(hosts)
}

// ④ 能力对齐：@proteus-vue/shader 生成物齐 + 后端 ≥2（原则 #13）
function packageCheck() {
  const gen = path.join(ROOT, 'packages/shader/src/generated/materials.ts')
  if (!fs.existsSync(gen)) {
    problems.push('缺 packages/shader/src/generated/materials.ts（跑 node scripts/gen-shaders.mjs）')
    return
  }
  const src = fs.readFileSync(gen, 'utf8')
  for (const key of ['glass.agsl.frag.glsl', 'glass.msl.frag.metal', 'glass.glsl.frag.glsl']) {
    if (!src.includes(key)) problems.push(`生成物缺 ${key}`)
  }
  // ★决策 #841：SPIR-V 生成物（鸿蒙 Vulkan 载体）—— base64 键须在生成物里（`SHADER_SPIRV`）
  for (const key of ['glass.spirv.vert.spv', 'glass.spirv.frag.spv']) {
    if (!src.includes(key)) problems.push(`生成物缺 ${key}（SPIR-V / 鸿蒙 Vulkan 载体）`)
  }
}

generateCheck()
driftCheck()
noHandwrittenCheck()
packageCheck()

if (problems.length) {
  console.error(`✗ ShaderBackend 能力门禁未过（${problems.length}）：`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('✅ ShaderBackend（真源可落地 · 生成物无漂移 · 宿主无残留手写算法 · 生成物齐）')
