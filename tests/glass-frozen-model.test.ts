// tests/glass-frozen-model.test.ts
// ★★★液态玻璃「最终冻结模型」守卫（决策 #1022 · 用户 2026-10-16 验收「这个对了，固化下来不用再动了」）
//
// 【这个测试防什么】2026-10-13～16 的三日校准链（#1002 模型取证 → #1003–#1021 逐项对齐）把
//   面纱/叠加/碗形/模糊/折射/色散的**定稿值**钉在了 wgsl 真源 + oracle（reference.rs）里。
//   这些值全部由**真机逐像素验收**（亮 255/227 · 暗 24.4/75 · 鬼影三连 14→9→6），
//   任何无意改动（重构、调参手滑、复制粘贴）都会**静默改回一个已被否掉的旧状态**。
//   ★本仓纪律「规则只写 markdown 拦不住」⇒ 用本测试把定稿值钉死：改动其中任一 ⇒ **当场红**。
//
// 【红了怎么办（正规路径）】冻结模型的修改必须走：① 新决策号 → ② 改 wgsl + reference.rs **同源**
//   → ③ `node scripts/gen-shaders.mjs` → ④ `bash hosts/ios/check-glass-pixel-parity.sh`（四态 max 1/255）
//   → ⑤ 三端重跑 → ⑥ **更新本测试的定稿值** → ⑦ 真机复测。定稿全景见
//   `docs/proteus-glass-plan/16-liquid-glass-frozen-model.md`。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf-8')

const WGSL_PATH = 'packages/shader-codegen-rust/src/materials/glass.wgsl'
const REF_PATH = 'packages/shader-codegen-rust/src/reference.rs'

/** 定稿值 = [机制名（含决策号）, wgsl 片段, oracle 片段]——两侧齐备才算"同源冻结"。 */
const FROZEN: [string, string, string][] = [
  // ── 面纱（#1004 准二态窗口 · #1016 暗霜 · #1020/#1021 定稿 α/V_dark）──
  ['面纱二态窗口 0.42–0.50（#1004）', 'smoothstep(0.42, 0.50, u.bg_lum)', 'smoothstep(0.42f32, 0.50f32, p.bg_lum)'],
  ['暗端霜色 V_dark=0.124（#1021 配 α 保暗条 24）', 'let VEIL_V = mix(0.124, 1.0, veil_t);', 'let veil_v = 0.124f32 + (1.0f32 - 0.124f32) * veil_t;'],
  ['面纱 α=0.62/0.68（#1021 定稿：透射 38/32%）', 'let VEIL_A0 = mix(0.62, 0.68, veil_t);', 'let veil_a0 = 0.62f32 + (0.68f32 - 0.62f32) * veil_t;'],
  ['按下退场 ×0.06（#981 门控 press×overlay）', 'let VEIL_A_BASE = mix(VEIL_A0, VEIL_A0 * 0.06, pr_ov);', 'veil_a0 * 0.06f32'],
  ['内层跳面纱（#1004 nest=1/3）', 'select(0.0, 1.0, abs(u.nest - 1.0) < 0.5 || u.nest > 2.5)', '(p.nest - 1.0).abs() < 0.5 || p.nest > 2.5'],
  // ── 胶囊叠加（#1016 单常数反解 · #1021 定稿强度）──
  ['叠加色 C=0.683（174/255 · #1016 双态零残差）', 'let ov_l = 0.683;', 'let ov_l = 0.683f32;'],
  ['叠加强度 0.34（#1021 定稿：Δ28/Δ50）', 'clamp(u.overlay, 0.0, 1.0) * 0.34 * (1.0 - clamp(u.press, 0.0, 1.0))', 'p.overlay.clamp(0.0, 1.0) * 0.34f32 * (1.0f32 - p.press.clamp(0.0, 1.0))'],
  // ── 碗形（#1017 基线 · #1018 白端 · #1019 仅外层）──
  ['碗形增益 1.0→1.04 + 0.02·veil_t（#1017/#1018）', 'mix(1.0, 1.04, bowl_ep) + 0.02 * veil_t', '1.0 + (1.04 - 1.0) * bowl_ep + 0.02 * veil_t'],
  ['碗形仅外层（#1019 内层胶囊平直化）', 'let bowl_f = mix(1.0, bowl_gain, select(1.0, 0.0, u.nest > 2.5));', 'if p.nest > 2.5 { 0.0 } else { 1.0 }'],
  // ── 模糊（#1013 采样源 · #1015 宿主预模糊 · #1016 残差化）──
  ['shader 模糊系数 0.16（锐背板模式）', 'clamp(u.blur * 0.16, 0.0, 8.0)', '(p.blur * 0.16f32).clamp(0.0, 8.0)'],
  ['shader 残差 0.02（nest≥2 · 主模糊归宿主 #1015/#1016）', 'clamp(u.blur * 0.02, 0.0, 8.0)', '(p.blur * 0.02f32).clamp(0.0, 8.0)'],
  ['模糊键控 0.80→1.0（e 0.05–0.35 · #1013 折叠带反走样下限）', 'mix(0.80, 1.0, smoothstep(0.05, 0.35, e))', '0.80 + (1.0 - 0.80) * smoothstep(0.05, 0.35, e)'],
  ['25-tap 二项式中心权重 0.140625（#1014 等 σ 采样格）', '* 0.140625', '0.0625, 0.25, 0.375, 0.25, 0.0625'],
  // ── 折射（#998 剖面 · #1010 恢复 · #1006 带宽）──
  ['折射剖面 (1−e)³（#1010 恢复 #998/#928）', 'let prof = pow(1.0 - e, 3.0);', 'let prof = (1.0 - e).powi(3);'],
  ['折射幅度 ER=1.20（#1010）', 'let EDGE_REFRACT = 1.20;', 'prof * band * 1.20 * strength'],
  ['折射带宽 0.45·min（#1006 复核修正）', 'max(smin * 0.45, 6.0)', '(smin * 0.45).max(6.0)'],
  // ── 色散（#1011 贴边窄环）──
  ['色散窄环 rim=1−smoothstep(0,0.035,e)（#1011）', '1.0 - smoothstep(0.0, 0.035, e)', '1.0 - smoothstep(0.0, 0.035, e)'],
  ['色散幅度 mix(0.35,1.0,pr_ov)·min(band·0.015,1)（#999/#1011）', 'mix(0.35, 1.0, pr_ov) * disp_rim * min(band * 0.015, 1.0)', '(0.35 + 0.65 * pr_ov) * disp_rim * (band * 0.015).min(1.0)'],
]

describe('★液态玻璃冻结模型（决策 #1022 · 用户验收「这个对了，固化下来不用再动了」）', () => {
  const wgsl = read(WGSL_PATH)
  const ref = read(REF_PATH)

  it(`真源（glass.wgsl）${FROZEN.length} 项定稿值齐备`, () => {
    const missing = FROZEN.filter(([, needle]) => !wgsl.includes(needle)).map(([name]) => name)
    expect(missing, '冻结值在 wgsl 真源中缺失/被改——见本文件头「红了怎么办」').toEqual([])
  })

  it(`oracle（reference.rs）${FROZEN.length} 项与真源同源`, () => {
    const missing = FROZEN.filter(([, , needle]) => !ref.includes(needle)).map(([name]) => name)
    expect(missing, '冻结值在 oracle 中缺失/漂移（wgsl 与 reference.rs 必须同源）').toEqual([])
  })

  it('宿主预模糊链在位（#1015 · σ≈2.0px 背板低通——"内容清晰度"验收前提）', () => {
    // 预模糊实现文件 + 捕获末尾的调用点（背板 → 采样源之间的链路）
    const preblur = read('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/GlassPreblur.java')
    const backdrop = read('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/GlassBackdrop.java')
    expect(preblur).toContain('final class GlassPreblur')
    expect(backdrop).toContain('glassPreblur.apply(')
  })
})
