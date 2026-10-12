// packages/shader/src/backends/index.ts
// ★G-62 落地后端集合（参考实现，原则 #13 要求 ≥2）——全部由 `makeBackend` 统一构造。
//
// 【四个真实端 + 一个无头端】
//   · agsl   —— Android `RuntimeShader`（API 31+）
//   · msl    —— iOS Metal（MTLDevice 离屏 → 自绘）
//   · glsl   —— 标准 GLES3 承载（调试/兜底）
//   · spirv  —— Vulkan（鸿蒙离屏 compute/graphics pass；naga 产 SPIR-V · 决策 #841）
//   · headless —— 无 GPU 的参考/CI 端：不带可编译源码，只暴露 uniform 布局（供单元测试/一致性校验）
import { makeBackend } from './factory'
import type { LandedShader, MaterialId, ProteusShaderBackend } from '../spi'
import { material } from '../catalog'
import { SHADER_SOURCES, SHADER_SPIRV } from '../generated/materials'

/** Android AGSL 后端。 */
export const agslBackend: ProteusShaderBackend = makeBackend({
  id: 'shader-agsl',
  target: 'agsl',
  fragSuffix: 'agsl.frag.glsl',
  entry: 'main',
  capabilities: { target: 'agsl', customShader: true, glass: 'L2', minSystemVersion: '31' },
})

/** iOS/鸿蒙 Metal(MSL) 后端。 */
export const mslBackend: ProteusShaderBackend = makeBackend({
  id: 'shader-msl',
  target: 'msl',
  fragSuffix: 'msl.frag.metal',
  vertSuffix: 'msl.vert.metal',
  entry: 'fs_glass',
  capabilities: { target: 'msl', customShader: true, glass: 'L2' },
})

/** 标准 GLES3 后端（调试/兜底；鸿蒙 GLES 承载复用）。 */
export const glslBackend: ProteusShaderBackend = makeBackend({
  id: 'shader-glsl',
  target: 'glsl',
  fragSuffix: 'glsl.frag.glsl',
  vertSuffix: 'glsl.vert.glsl',
  entry: 'fs_glass',
  capabilities: { target: 'glsl', customShader: true, glass: 'L2' },
})

/**
 * ★★★Vulkan 后端（鸿蒙离屏 pass）——决策 #841。
 *   【为什么单独写而不复用 makeBackend】SPIR-V 是**二进制**（base64 存于 `SHADER_SPIRV`），
 *   不是 `SHADER_SOURCES` 里的文本源 ⇒ 需要取 base64 键而非源码键。落地物仍是"取生成物"（不含算法）。
 */
export const vulkanBackend: ProteusShaderBackend = {
  id: 'shader-vulkan',
  version: '1.0.0',
  capabilities: { target: 'spirv', customShader: true, glass: 'L2' },
  isAvailable: () => true,
  land(materialId: MaterialId): LandedShader {
    const vkey = `${materialId}.spirv.vert.spv`
    const fkey = `${materialId}.spirv.frag.spv`
    const spirvVertex = SHADER_SPIRV[vkey]
    const spirvFragment = SHADER_SPIRV[fkey]
    if (!spirvVertex || !spirvFragment) throw new Error(`未找到 SPIR-V 落地物：${vkey}/${fkey}（请跑 node scripts/gen-shaders.mjs）`)
    const info = material(materialId)
    if (!info) throw new Error(`未知材质：${materialId}`)
    return {
      fragment: '',
      spirvVertex,
      spirvFragment,
      entry: info.entry,
      uniformStruct: info.uniformStruct,
      uniformLayout: info.uniformLayout,
      uniformSize: info.uniformSize,
    }
  },
}

/**
 * 无头后端——无 GPU，只暴露 uniform 布局与"算法存在"（供单元测试 / 一致性校验 / CI）。
 * ★不 `land` 可编译源码（`land` 抛错），避免"假绿"。
 */
export const headlessBackend: ProteusShaderBackend = {
  id: 'shader-headless',
  version: '1.0.0',
  capabilities: { target: 'glsl', customShader: false, glass: 'L1' },
  isAvailable: () => false,
  land(materialId) {
    const info = material(materialId)
    if (!info) throw new Error(`未知材质：${materialId}`)
    return { fragment: '', entry: '', uniformStruct: info.uniformStruct, uniformLayout: info.uniformLayout, uniformSize: info.uniformSize }
  },
}

/** 全部后端（供选择器/一致性校验遍历）。 */
export const ALL_BACKENDS: readonly ProteusShaderBackend[] = [agslBackend, mslBackend, glslBackend, vulkanBackend, headlessBackend]

/** 按 id 取后端。 */
export function backendById(id: string): ProteusShaderBackend | undefined {
  return ALL_BACKENDS.find((b) => b.id === id)
}

/** 生成物是否已就绪（至少 glass 全端有源码）——供宿主/门禁快速判空。 */
export function generatedReady(materialId = 'glass'): boolean {
  return (
    !!SHADER_SOURCES[`${materialId}.agsl.frag.glsl`] &&
    !!SHADER_SOURCES[`${materialId}.msl.frag.metal`] &&
    !!SHADER_SOURCES[`${materialId}.glsl.frag.glsl`]
  )
}
