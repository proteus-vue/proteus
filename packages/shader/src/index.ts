// packages/shader/src/index.ts
// @proteus-vue/shader —— ★★★G-62 ShaderBackend（决策 #834）公共出口。
//
// 定位：Proteus 的**着色器可插拔落地层**。算法真源 = Rust 的 WGSL（`packages/shader-codegen-rust`，
//   经 naga 落地到 MSL/AGSL/GLSL）；本包 = 落地后端 SPI + 材质目录 + conformance。
//   ⇒ 宿主只做"编译生成物 + 设 uniform + 跑 pass"，**不再手写材质算法**。
export type {
  ProteusShaderBackend,
  LandedShader,
  MaterialId,
  ShaderCapabilities,
  ShaderTarget,
  UniformField,
} from './spi'
export { MATERIALS, material, type MaterialInfo } from './catalog'
/** 材质 id 常量（与 Rust `materials::MaterialSpec.id` 同源）。 */
export { GLASS_ID, BACKDROP_BLUR_ID } from './catalog'
export {
  ALL_BACKENDS,
  backendById,
  generatedReady,
  agslBackend,
  mslBackend,
  glslBackend,
  headlessBackend,
} from './backends'
export { runShaderConformance, type ConformanceCheck, type ConformanceResult } from './conformance'
export { SHADER_SOURCES } from './generated/materials'
