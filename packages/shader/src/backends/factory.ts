// packages/shader/src/backends/factory.ts
// 落地后端**统一构造器**（避免三个后端各写一份相同逻辑——本仓纪律：同一语义一处实现）。
import { SHADER_SOURCES } from '../generated/materials'
import { material } from '../catalog'
import type { LandedShader, MaterialId, ProteusShaderBackend, ShaderCapabilities, ShaderTarget } from '../spi'

export interface BackendConfig {
  id: string
  target: ShaderTarget
  /** 生成物键后缀（如 `msl.frag.metal`）与对应的顶点键后缀（可空）。 */
  fragSuffix: string
  vertSuffix?: string
  entry: string
  capabilities: ShaderCapabilities
}

/** 由配置造一个"纯打包"落地后端（算法在 WGSL 真源，后端只取生成物 + uniform 布局）。 */
export function makeBackend(cfg: BackendConfig): ProteusShaderBackend {
  return {
    id: cfg.id,
    version: '1.0.0',
    capabilities: cfg.capabilities,
    isAvailable: () => true,
    land(materialId: MaterialId): LandedShader {
      const fkey = `${materialId}.${cfg.fragSuffix}`
      const frag = SHADER_SOURCES[fkey]
      if (!frag) throw new Error(`未找到落地物：${fkey}（请跑 node scripts/gen-shaders.mjs）`)
      const info = material(materialId)
      if (!info) throw new Error(`未知材质：${materialId}`)
      let vertex: string | undefined
      if (cfg.vertSuffix) {
        const vkey = `${materialId}.${cfg.vertSuffix}`
        vertex = SHADER_SOURCES[vkey]
      }
      return {
        fragment: frag,
        vertex,
        entry: cfg.entry,
        uniformStruct: info.uniformStruct,
        uniformLayout: info.uniformLayout,
        uniformSize: info.uniformSize,
      }
    },
  }
}
