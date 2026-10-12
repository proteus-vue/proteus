// packages/shader/src/backends/index.ts
// ★G-62 落地后端集合（参考实现，原则 #13 要求 ≥2）——全部由 `makeBackend` 统一构造。
//
// 【三个真实端 + 一个无头端】
//   · agsl   —— Android `RuntimeShader`（API 31+）
//   · msl    —— iOS/鸿蒙 Metal（MTLDevice 离屏 → 自绘）
//   · glsl   —— 标准 GLES3 承载（调试/兜底；鸿蒙 GLES 路径亦复用）
//   · headless —— 无 GPU 的参考/CI 端：不带可编译源码，只暴露 uniform 布局（供单元测试/一致性校验）
import { makeBackend } from './factory'
import type { ProteusShaderBackend } from '../spi'
import { material } from '../catalog'
import { SHADER_SOURCES } from '../generated/materials'

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
export const ALL_BACKENDS: readonly ProteusShaderBackend[] = [agslBackend, mslBackend, glslBackend, headlessBackend]

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
