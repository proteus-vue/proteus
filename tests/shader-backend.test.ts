// tests/shader-backend.test.ts —— ★★★G-62 ShaderBackend（决策 #834）
//
// 【它防什么】新架构下"玻璃算法"是 **Rust 的 WGSL 单一真源**（`packages/shader-codegen-rust`，
//   经 naga 落地）；各端只是"落地后端"。本测试钉住：
//   ① 生成物齐（glass × {agsl,msl,glsl} 都有源码——缺 ⇒ 宿主无从落地）；
//   ② 每个后端 conformance 全绿（SPI 合规、land 出源码、uniform 布局自洽）；
//   ③ **算法不漂移**：生成的着色器里**不再出现**任何一端的"手写算法标记"（如旧的 `_group_0_binding`
//      mangled 名、或旧手写器特有的常量拼写）——防止有人又把算法塞回宿主；
//   ④ AGSL 方言不变量（入口签名 / 无 sampler2D / 无 std140 / 用 .eval）——由 Rust 侧单测也覆盖，
//      此处从**生成物**侧再钉一次（双保险：Rust 单测 + 生成物内容）。
import { describe, it, expect } from 'vitest'
import {
  ALL_BACKENDS,
  backendById,
  generatedReady,
  material,
  MATERIALS,
  runShaderConformance,
  SHADER_SOURCES,
} from '@proteus-vue/shader'

describe('★★G-62 ShaderBackend（材质着色器可插拔落地）', () => {
  it('① 生成物齐：glass × {agsl,msl,glsl} 都有源码', () => {
    expect(generatedReady('glass')).toBe(true)
    expect(SHADER_SOURCES['glass.agsl.frag.glsl']?.length ?? 0).toBeGreaterThan(100)
    expect(SHADER_SOURCES['glass.msl.frag.metal']?.length ?? 0).toBeGreaterThan(100)
    expect(SHADER_SOURCES['glass.glsl.frag.glsl']?.length ?? 0).toBeGreaterThan(100)
    // MSL 片元 + 顶点（Metal 需要配套顶点）
    expect(SHADER_SOURCES['glass.msl.vert.metal']?.length ?? 0).toBeGreaterThan(50)
  })

  it('② 三个真实端后端 conformance 全绿', () => {
    for (const id of ['shader-agsl', 'shader-msl', 'shader-glsl']) {
      const b = backendById(id)!
      const r = runShaderConformance(b)
      expect(r.ok, `${id} 失败项：${JSON.stringify(r.checks.filter((c) => !c.ok))}`).toBe(true)
    }
  })

  it('②b 无头端合规（不产可编译源，不假装成功）', () => {
    const r = runShaderConformance(backendById('shader-headless')!)
    expect(r.ok).toBe(true)
  })

  it('③ 算法只在真源：AGSL 落地物里不含"手写算法标记"', () => {
    // ★GLSL 中间形态保留 naga 的 mangled 绑定名（那是 naga 的规范命名）——只在 **AGSL** 端要求
    //   稳定改名（宿主按稳定名 setInputShader）；这里针对 AGSL 断言。
    const agsl = Object.entries(SHADER_SOURCES).filter(([k]) => k.includes('.agsl.'))
    expect(agsl.length).toBeGreaterThan(0)
    for (const [k, src] of agsl) {
      expect(src.includes('_group_0_binding_'), `${k} 残留 mangled 绑定名`).toBe(false)
    }
  })

  it('④ AGSL 方言不变量（从生成物侧双保险）', () => {
    const s = SHADER_SOURCES['glass.agsl.frag.glsl']
    expect(s.includes('half4 main(float2 coord)')).toBe(true)
    expect(s.includes('#version')).toBe(false)
    expect(s.includes('sampler2D')).toBe(false)
    expect(s.includes('std140')).toBe(false)
    expect(s.includes('backdrop_tex.eval(')).toBe(true)
    expect(s.includes('uniform vec4 tint;')).toBe(true)
  })

  it('④b MSL 落地不变量', () => {
    const s = SHADER_SOURCES['glass.msl.frag.metal']
    expect(s.includes('fragment')).toBe(true)
    expect(s.includes('fs_glass')).toBe(true)
    // Metal 下采样是 texture.sample(sampler, uv)
    expect(s.includes('.sample(')).toBe(true)
  })

  it('⑤ 目录与 uniform 布局自洽（覆盖到结构尾部）', () => {
    for (const m of MATERIALS) {
      const last = m.uniformLayout[m.uniformLayout.length - 1]
      expect(last.offset + last.size).toBeLessThanOrEqual(m.uniformSize)
      // 每个后端 land 出的布局与该材质目录同源
      const b = backendById('shader-agsl')!
      const out = b.land(m.id)
      expect(out.uniformStruct).toBe(m.uniformStruct)
      expect(out.uniformLayout).toEqual(m.uniformLayout)
    }
    expect(material('glass')!.uniformSize).toBe(80)
  })

  it('⑥ 后端能力声明如实（AGSL 版本门 = API 31）', () => {
    expect(backendById('shader-agsl')!.capabilities.minSystemVersion).toBe('31')
    expect(backendById('shader-headless')!.isAvailable()).toBe(false)
  })

  it('⑦ 未知材质 land 抛错（不静默）', () => {
    expect(() => backendById('shader-agsl')!.land('__nope__')).toThrow()
  })

  it('⑧ ALL_BACKENDS ≥2 参考实现（原则 #13）', () => {
    expect(ALL_BACKENDS.length).toBeGreaterThanOrEqual(2)
  })

  it('⑨ 多材质：glass + backdropBlur 全端生成物齐（B4）', () => {
    for (const id of ['glass', 'backdropBlur']) {
      expect(generatedReady(id), `${id} 生成物不齐`).toBe(true)
      for (const tgt of ['agsl.frag.glsl', 'msl.frag.metal', 'glsl.frag.glsl']) {
        expect((SHADER_SOURCES[`${id}.${tgt}`] ?? '').length, `${id}.${tgt}`).toBeGreaterThan(50)
      }
      // 后端能 land
      const out = backendById('shader-agsl')!.land(id)
      expect(out.fragment.includes('half4 main(float2 coord)'), `${id} AGSL 入口`).toBe(true)
    }
    // 目录里有两种材质
    expect(MATERIALS.map((m) => m.id).sort()).toEqual(['backdropBlur', 'glass'])
    // backdropBlur uniform = 64（glass = 80）
    expect(material('backdropBlur')!.uniformSize).toBe(64)
    expect(material('glass')!.uniformSize).toBe(80)
  })
})
