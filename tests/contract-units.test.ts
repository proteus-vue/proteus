// tests/contract-units.test.ts
// ★★★决策 #1139：**「最小可闭环单元」探针**的判据。
//
// 【它守什么】
//   `check:contract-index --unit tag:<Name>` 声称"改这个 tag 只需读 255 行（9%），不是整文件 2734 行"。
//   这个承诺若失真（比如定位模式过期、去程/回程前缀搞错），AI 会**照着错误的行号去读**，
//   然后漏掉真正要改的地方 —— 比"不给行号"更糟。
//
// 【判据（每条都对应探针实际踩过的坑）】
//   ① **去程 tag 五端三处都命中**（常量/encode/decode 全 > 0）——首版 TS 用帕斯卡、
//      四端用大写下划线，混用导致四端全 0（假绿：只有 TS 命中就报了"约 255 行"）；
//   ② **回程 tag 用 RTAG_ 前缀**——首版只认 TAG_ ⇒ StreamSeq/HttpStatus 的 encode/decode 全 `—`；
//   ③ **`snake()` 转换正确**（Redirect→REDIRECT / SavePath→SAVE_PATH / StreamSeq→STREAM_SEQ）；
//   ④ **不存在的 tag 必须响亮失败**（三处命中 0 ⇒ 退出码非 0，而不是打印一堆 `—` 后退出 0）；
//   ⑤ **读面远小于整文件**（< 20%）——这是"降低认知负载"的量化承诺。
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { snake, endsFor, INVOKE_ENDS, RESOLVE_ENDS, RESOLVE_TAG_NAMES } from '../scripts/lib/contract-units.mjs'

const ROOT = path.resolve(__dirname, '..')
const GATE = path.join(ROOT, 'scripts', 'check-contract-index.mjs')

/** 跑探针，返回 {code, out}。 */
function runUnit(spec: string): { code: number; out: string } {
  try {
    const out = execFileSync('node', [GATE, '--unit', spec], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, out }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

describe('★#1139 最小可闭环单元探针', () => {
  it('① snake() 转换正确（四端常量用大写下划线）', () => {
    expect(snake('Redirect')).toBe('REDIRECT')
    expect(snake('SavePath')).toBe('SAVE_PATH')
    expect(snake('UploadPath')).toBe('UPLOAD_PATH')
    expect(snake('StreamSeq')).toBe('STREAM_SEQ')
    expect(snake('HttpStatus')).toBe('HTTP_STATUS')
  })

  it('② 去程/回程端点集前缀正确（回程必须 RTAG_ / MetaTagResolve）', () => {
    const inv = INVOKE_ENDS.map((e) => e.file)
    const res = RESOLVE_ENDS.map((e) => e.file)
    // 两端点集覆盖同一批文件（五端）
    expect(inv.length).toBe(5)
    expect(res.length).toBe(5)
    expect(inv).toEqual(res)
    // 回程清单必须含 StreamSeq / HttpStatus（#1118 流式块 + 状态码）
    expect(RESOLVE_TAG_NAMES.has('StreamSeq')).toBe(true)
    expect(RESOLVE_TAG_NAMES.has('HttpStatus')).toBe(true)
    // 去程 tag 不该被当成回程
    expect(endsFor('Redirect')).toBe(INVOKE_ENDS)
    expect(endsFor('StreamSeq')).toBe(RESOLVE_ENDS)
  })

  it('★★③ 去程 tag（Redirect）五端三处全部命中 + 读面 < 20%', () => {
    const { code, out } = runUnit('tag:Redirect')
    expect(code, `探针应成功：\n${out}`).toBe(0)
    // 五端各一行"常量 N · encode N · decode N"
    const trio = [...out.matchAll(/常量 (\d+) · encode (\d+) · decode (\d+)/g)]
    expect(trio.length, `应命中五端（实得 ${trio.length}）`).toBe(5)
    for (const m of trio) {
      expect(Number(m[1]), '常量未命中').toBeGreaterThan(0)
      expect(Number(m[2]), 'encode 未命中（★首版在此假绿）').toBeGreaterThan(0)
      expect(Number(m[3]), 'decode 未命中（★首版在此假绿）').toBeGreaterThan(0)
    }
    // 读面承诺
    const read = Number(/约 (\d+) 行/.exec(out)?.[1] ?? 0)
    expect(read).toBeGreaterThan(0)
    expect(read, `读面 ${read} 行应远小于五端整文件 2734 行`).toBeLessThan(2734 * 0.2)
  })

  it('★★④ 回程 tag（StreamSeq / HttpStatus）也能五端三处全命中', () => {
    for (const tag of ['StreamSeq', 'HttpStatus']) {
      const { code, out } = runUnit(`tag:${tag}`)
      expect(code, `${tag} 应成功：\n${out}`).toBe(0)
      const trio = [...out.matchAll(/常量 (\d+) · encode (\d+) · decode (\d+)/g)]
      expect(trio.length, `${tag} 应命中五端`).toBe(5)
      for (const m of trio) {
        expect(Number(m[2]), `${tag} 的 encode 未命中（★首版只认 TAG_ ⇒ 回程全空）`).toBeGreaterThan(0)
        expect(Number(m[3]), `${tag} 的 decode 未命中（同因）`).toBeGreaterThan(0)
      }
      expect(out, `${tag} 不该报"查错方向"`).not.toContain('三处只命中 0 处')
    }
  })

  it('④ 不存在的 tag 必须响亮失败（不打印一堆 — 后退出 0）', () => {
    const { code, out } = runUnit('tag:NoSuchTagZZZ')
    expect(code, `不存在的 tag 应非 0 退出：\n${out}`).not.toBe(0)
    expect(out).toContain('三处只命中 0 处')
  })

  it('★★⑥ fetch-field：四层链全命中（redirectManual 是 #1134 漏传的那个）', () => {
    const { code, out } = runUnit('fetch-field:redirectManual')
    expect(code, `应成功：\n${out}`).toBe(0)
    // 四层各一行 ✓
    const hits = [...out.matchAll(/^  ✓ /gm)]
    expect(hits.length, `应命中四层（实得 ${hits.length}）：\n${out}`).toBe(4)
    // 每层都给了 文件:行号
    expect([...out.matchAll(/\.ts:\d+/g)].length).toBeGreaterThanOrEqual(4)
    expect(out).toContain('tests/fetch-wire-fields.test.ts')
  })

  it('★★⑦ fetch-field：不落 meta 的字段（onChunk/signal）在④层是**正当排除**，不判缺失', () => {
    for (const f of ['onChunk', 'signal']) {
      const { code, out } = runUnit(`fetch-field:${f}`)
      expect(code, `${f} 应成功（④层正当排除）：\n${out}`).toBe(0)
      expect(out, `${f} 的④层应标 ○ 而不是 ✗`).toContain(`\`${f}\` 不落 meta`)
    }
  })

  it('★★⑧ fetch-field：不存在的字段 ⇒ 四层全报缺失 + 非 0 退出（响亮失败）', () => {
    const { code, out } = runUnit('fetch-field:noSuchFieldZZZ')
    expect(code, `应非 0：\n${out}`).not.toBe(0)
    expect(out).toContain('该层吃掉这个字段')
    expect(out).toContain('4 层缺失')
  })

  it('⑤ 用法校验：缺参数 / 未知单元类型 ⇒ 退出 2', () => {
    expect(runUnit('').code).toBe(2)
    expect(runUnit('bogus:Foo').code).toBe(2)
  })
})
