// tests/capability-app-fs-encoding.test.ts —— ★★★#1231 文件编码器（对齐 wx encoding 语义）
//
// 【判据锚点（用户 2026-10-25 给出的 wx 规则）】
//   「指定读取文件的字符编码，**如果不传 encoding，则以 ArrayBuffer 格式读取文件的二进制内容**」
//   ⇒ ① 不传 encoding ⇒ ArrayBuffer；② 传了 ⇒ 字符串；③ 未知编码 ⇒ **抛错**（不静默当 utf8）。
//
// 【为什么编码器必须逐编码验】编码错误的最坏形态是"看起来读了、内容全错"（比如 GBK 当 UTF-8 读出乱码
//   但不报错）。所以每种编码都做**往返验证**（encode → decode 得回原文），并对非 ASCII 做定点值断言。
import { describe, it, expect } from 'vitest'
import {
  decodeBytes,
  encodeString,
  normalizeEncoding,
  toArrayBuffer,
} from '../packages/api/src/capability-app-fs-encoding'

const enc = (s: string, e: Parameters<typeof encodeString>[1]) => Uint8Array.from(encodeString(s, e))

describe('★★★#1231 文件编码器（wx encoding 语义）', () => {
  it('① 编码别名归一（utf-8→utf8 · binary→latin1 · utf16le→ucs2）', () => {
    expect(normalizeEncoding('utf-8')).toBe('utf8')
    expect(normalizeEncoding('UTF8')).toBe('utf8')
    expect(normalizeEncoding('binary')).toBe('latin1')
    expect(normalizeEncoding('utf16le')).toBe('ucs2')
    expect(normalizeEncoding('ucs-2')).toBe('ucs2')
    expect(normalizeEncoding(undefined), '缺省 = utf8（写场景）').toBe('utf8')
  })

  it('② 未知编码 ⇒ 抛错（不静默当 utf8 —— 那是"读了但内容全错"的最坏形态）', () => {
    expect(() => normalizeEncoding('gbk')).toThrow(/未知编码/)
    expect(() => normalizeEncoding('big5')).toThrow(/file-system\.unsupported/)
  })

  it('③ utf8 往返：中文 / emoji（代理对）/ 混合', () => {
    for (const s of ['hello', '中文测试', '😀🎉', 'a中😀z']) {
      expect(decodeBytes(enc(s, 'utf8'), 'utf8'), `utf8 往返: ${s}`).toBe(s)
    }
    // 定点：'中' = U+4E2D ⇒ UTF-8 三字节 E4 B8 AD
    expect(Array.from(enc('中', 'utf8'))).toEqual([0xe4, 0xb8, 0xad])
    // 定点：'😀' = U+1F600 ⇒ 四字节 F0 9F 98 80
    expect(Array.from(enc('😀', 'utf8'))).toEqual([0xf0, 0x9f, 0x98, 0x80])
  })

  it('④ latin1 往返（含 0xFF 边界）；超出 U+00FF ⇒ 抛错（不静默截断）', () => {
    expect(Array.from(enc('hi', 'latin1'))).toEqual([0x68, 0x69])
    const hi = '\u00ff'                       // ÿ = U+00FF
    expect(Array.from(enc(hi, 'latin1'))).toEqual([0xff])
    expect(decodeBytes(Uint8Array.from([0xff]), 'latin1')).toBe(hi)
    expect(() => enc('中', 'latin1'), '中 超出 latin1 ⇒ 抛错').toThrow(/latin1 无法表示/)
  })

  it('⑤ ascii：高位清零（Node 语义）；写入非 ASCII ⇒ 抛错', () => {
    // 解码：0xC1 ⇒ &0x7F = 0x41 = 'A'
    expect(decodeBytes(Uint8Array.from([0xc1]), 'ascii')).toBe('A')
    expect(() => enc('é', 'ascii'), 'é 超出 ascii ⇒ 抛错').toThrow(/ascii 无法表示/)
  })

  it('⑥ base64 / hex 往返 + 定点值', () => {
    // 'hello' 的 base64 是 aGVsbG8=
    expect(decodeBytes(enc('hello', 'utf8'), 'base64')).toBe('aGVsbG8=')
    // 反向：base64 文本 → 字节（用 encodeString 的 base64 分支）
    expect(Array.from(encodeString('aGVsbG8=', 'base64'))).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f])
    // hex
    expect(decodeBytes(enc('hi', 'utf8'), 'hex')).toBe('6869')
    expect(Array.from(encodeString('6869', 'hex')), 'hex 文本 → 字节').toEqual([0x68, 0x69])
    // 非法 hex 长度 / 字符 ⇒ 抛错
    expect(() => encodeString('abc', 'hex')).toThrow(/偶数/)
    expect(() => encodeString('zz', 'hex')).toThrow(/非法 hex/)
  })

  it('⑦ ucs2(UTF-16LE)：BMP 与代理对往返；奇数尾巴丢弃（不补 0 造出多余字符）', () => {
    expect(decodeBytes(enc('中', 'ucs2'), 'ucs2')).toBe('中')
    // '中' = U+4E2D ⇒ LE 是 2D 4E
    expect(Array.from(enc('中', 'ucs2'))).toEqual([0x2d, 0x4e])
    expect(decodeBytes(enc('😀', 'ucs2'), 'ucs2'), '代理对往返').toBe('😀')
    // 奇数长度：3 字节 ⇒ 只解前 2 字节
    expect(decodeBytes(Uint8Array.from([0x41, 0x00, 0x42]), 'ucs2').length, '丢掉半个码元').toBe(1)
  })

  it('⑧ toArrayBuffer 返回**精确长度**的 buffer（不是大 slab 的视图）', () => {
    const big = new Uint8Array(64)
    const view = big.subarray(8, 11)          // 3 字节视图
    const ab = toArrayBuffer(view)
    expect(ab.byteLength, '精确 3 字节，不是 64').toBe(3)
    expect(Array.from(new Uint8Array(ab))).toEqual([0, 0, 0])
  })
})
