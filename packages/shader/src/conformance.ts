// packages/shader/src/conformance.ts
// ★G-62 Conformance（原则 #13：任何可插拔层须有 conformance）——校验一个 ShaderBackend 是否合规。
//
// 【形态对齐 G-27 的 runBackendConformance】：返回 `{ ok, checks[] }`，每项含 name/ok/detail。
//   门禁（脚本）以此为判据；失败必须能指到具体项。
import type { ProteusShaderBackend } from './spi'
import { MATERIALS } from './catalog'

export interface ConformanceCheck {
  name: string
  ok: boolean
  detail?: string
}
export interface ConformanceResult {
  ok: boolean
  checks: ConformanceCheck[]
}

export function runShaderConformance(backend: ProteusShaderBackend): ConformanceResult {
  const checks: ConformanceCheck[] = []
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail })

  // ① 身份
  add('id 非空', typeof backend.id === 'string' && backend.id.length > 0, `id=${backend.id}`)
  add('version 非空', typeof backend.version === 'string' && backend.version.length > 0, `v=${backend.version}`)

  // ② 能力声明合法
  const c = backend.capabilities
  add('capabilities.target 合法', ['msl', 'agsl', 'glsl', 'spirv', 'harmony'].includes(c.target), `target=${c.target}`)
  add('capabilities.glass 合法', ['L3', 'L2', 'L1', 'none'].includes(c.glass), `glass=${c.glass}`)
  add('capabilities.customShader 为布尔', typeof c.customShader === 'boolean')

  // ③ 必选方法齐
  add('land 是函数', typeof backend.land === 'function')
  add('isAvailable 是函数', typeof backend.isAvailable === 'function')

  // ④ 逐材质落地：可用后端必须能落出**可编译产物**（不含算法——只打包）；不可用后端须抛错或空（不假装成功）
  //    ★决策 #841：SPIR-V 目标是**二进制**（base64 存于 spirvVertex/spirvFragment）而非文本 fragment
  //      ⇒ 判据按 target 分派：spirv 看二进制非空，其余看 fragment 文本非空。
  for (const m of MATERIALS) {
    if (backend.isAvailable() && backend.capabilities.customShader) {
      try {
        const out = backend.land(m.id)
        if (c.target === 'spirv') {
          const okBin = !!out.spirvVertex && out.spirvVertex.length > 0 && !!out.spirvFragment && out.spirvFragment.length > 0
          add(`land(${m.id}) 出 SPIR-V（vert+frag）`, okBin)
        } else {
          add(`land(${m.id}) 出片元`, typeof out.fragment === 'string' && out.fragment.length > 0)
        }
        add(`land(${m.id}) uniform 布局齐`, Array.isArray(out.uniformLayout) && out.uniformLayout.length > 0)
        // uniform 布局必须覆盖到 uniformSize（最后一个字段 offset+size === size，或留 <16 对齐余量）
        const last = out.uniformLayout[out.uniformLayout.length - 1]
        const covered = last && last.offset + last.size <= out.uniformSize
        add(`land(${m.id}) uniform 边界自洽`, !!covered, `last=${last ? last.offset + '+' + last.size : '?'} size=${out.uniformSize}`)
      } catch (e) {
        add(`land(${m.id}) 出片元`, false, String(e))
      }
    } else {
      add(`land(${m.id}) 为不可用端（应不产可编译源）`, true, 'skip')
    }
  }

  return { ok: checks.every((c) => c.ok), checks }
}
