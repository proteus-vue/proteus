// tests/code-outline.test.ts
// ★★★决策 #1142：**代码结构大纲**的判据（`scripts/outline-code.mjs`）。
//
// 【它守什么】
//   大纲声称"改这段只读 33 行，不是 834 行"。若解析器算错（块边界偏、段落漏），
//   AI 会照着错行号去读，**然后漏掉真正要改的地方** —— 比不给大纲更糟。
//
// 【判据（每条都对应解析器实际踩过的坑）】
//   ① **遮罩注释/字符串后再配对**：`renderCommandsImpl` 必须是 **834 行**（不是 6 行）。
//      首版直接数花括号 ⇒ 注释里那句「首版用第一个 '}' 截断」把配对提前闭合 ⇒ 836/834 行算成 6 行。
//   ② **缩进基准要跳过声明行**：段注释缩进 4，而首版把声明行的 0 当基准 ⇒ 834 行判成"无段落"（假绿）。
//   ③ 段落行号必须**落在函数范围内**且递增；
//   ④ 重块清单必须列出最大的那个（834 行 renderCommandsImpl）；
//   ⑤ 块不重叠（否则"只读这一段"会漏或重复）。
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { outline, sectionsOf, HEAVY_BLOCK_LINES } from '../scripts/outline-code.mjs'

const ROOT = path.resolve(__dirname, '..')
const TOOL = path.join(ROOT, 'scripts', 'outline-code.mjs')
const RENDER_CPP = path.join(ROOT, 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_render.cpp')

function run(args: string[]): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('node', [TOOL, ...args], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }) }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

describe('★#1142 代码结构大纲（C++ 巨型函数的最小读面）', () => {
  it('★★① 遮罩注释/字符串后再配对：renderCommandsImpl 是 834 行（首版算成 6 行）', () => {
    const { blocks } = outline(fs.readFileSync(RENDER_CPP, 'utf8'))
    const fn = blocks.find((b) => b.name === 'renderCommandsImpl')
    expect(fn, '应解析出 renderCommandsImpl').toBeTruthy()
    const n = fn!.end - fn!.start + 1
    expect(n, `★应为 ~834 行（实得 ${n}）——若为 6，说明注释里的 } 把配对提前闭合了`).toBeGreaterThan(700)
    // 且必须宣告为"重块"
    expect(n).toBeGreaterThan(HEAVY_BLOCK_LINES)
  })

  it('★★② 缩进基准跳过声明行：834 行函数必须能抽出内部段落', () => {
    const src = fs.readFileSync(RENDER_CPP, 'utf8')
    const { lines, blocks } = outline(src)
    const fn = blocks.find((b) => b.name === 'renderCommandsImpl')!
    const secs = sectionsOf(lines, fn.start - 1, fn.end - 1)
    expect(secs.length, '★应有段落（实得 0 ⇒ 缩进基准取到了声明行的 0）').toBeGreaterThanOrEqual(3)
    // 段落行号落在函数内、递增
    for (let i = 0; i < secs.length; i++) {
      expect(secs[i].line).toBeGreaterThan(fn.start)
      expect(secs[i].line).toBeLessThan(fn.end)
      if (i > 0) expect(secs[i].line).toBeGreaterThan(secs[i - 1].line)
    }
  })

  it('★③ 块不重叠且有序（否则"只读这一段"会漏或重复）', () => {
    const { blocks } = outline(fs.readFileSync(RENDER_CPP, 'utf8'))
    expect(blocks.length).toBeGreaterThan(20)
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].start, `块 ${blocks[i].name} 起点应大于前块`).toBeGreaterThan(blocks[i - 1].start)
      expect(blocks[i - 1].end, `块 ${blocks[i - 1].name} 不应越过下一块起点`).toBeLessThanOrEqual(blocks[i].start + 1)
    }
  })

  it('④ --list-heavy 必须列出最大的重块（834 行 renderCommandsImpl）', () => {
    const { code, out } = run(['--list-heavy'])
    expect(code).toBe(0)
    expect(out).toContain('renderCommandsImpl')
    // 最大块行数应 ≥700（若 parse 崩了会显示 6）
    const m = /(\d+) 行\s+renderCommandsImpl/.exec(out)
    expect(m, '重块清单应含 renderCommandsImpl').toBeTruthy()
    expect(Number(m![1])).toBeGreaterThan(700)
  })

  it('⑤ --fn 输出"改第一段只读 N 行"且 N 远小于函数总行数', () => {
    const { code, out } = run([path.relative(ROOT, RENDER_CPP), '--fn', 'renderCommandsImpl'])
    expect(code).toBe(0)
    const m = /读 L\d+-(\d+)（(\d+) 行），不是 (\d+) 行/.exec(out)
    expect(m, `应给出"只读 N 行"的结论：\n${out.slice(-400)}`).toBeTruthy()
    const firstSeg = Number(m![2])
    const total = Number(m![3])
    expect(firstSeg, `首段 ${firstSeg} 行应远小于总 ${total} 行`).toBeLessThan(total * 0.2)
  })
})
