// tests/capability-app-unzip.test.ts —— ★★★#1232 ZIP 容器解析（三端共用的唯一实现）
//
// 【为什么这些判据重要】ZIP 解析是**安全逻辑**：zip slip（写到沙箱外）、zip bomb（解压爆炸）、
//   尺寸撒谎（中央目录说 10 字节实际解出 1GB）—— 每一条都靠这里的判定拦。而它现在只有**一份实现**
//   （三端共用），所以这 16 条判据护的是三端。
//
// 【判据构造方式】**手工构造 ZIP 字节**（不依赖第三方库）—— 这样能精确造出**畸形/攻击样本**：
//   正常 stored / 正常 deflate / zip slip 条目名 / 绝对路径 / 盘符 / 反斜杠逃逸 /
//   加密标志 / ZIP64 哨兵 / 中央目录签名坏 / 尺寸不符。
import { describe, it, expect } from 'vitest'
import {
  parseZipCentralDirectory,
  safeEntryPath,
  inflateEntry,
  UNZIP_MAX_ENTRIES,
} from '../packages/api/src/capability-app-unzip'

/* ───────────── 最小 ZIP 构造器（只为测试造样本） ───────────── */

interface BuildEntry {
  name: string
  data: Uint8Array
  /** 0 = stored / 8 = deflate（deflate 需调用方给压缩后字节） */
  method?: number
  compressed?: Uint8Array
  /** 中央目录里声明的大小（可与真实不同，用于造"撒谎"样本） */
  declaredUncompressed?: number
  flags?: number
  /** 局部头签名写坏 */
  badLocalSig?: boolean
  /** ZIP64 尺寸哨兵 */
  zip64?: boolean
}

function u16le(v: number): number[] { return [v & 0xff, (v >> 8) & 0xff] }
function u32le(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]
}

/** 造一个 ZIP（无注释、无 ZIP64 的常规形态；必要时按 build 参数破坏它） */
export function buildZip(entries: BuildEntry[]): Uint8Array {
  const out: number[] = []
  const central: Array<{ name: Uint8Array; offset: number; e: BuildEntry; comp: Uint8Array }> = []

  for (const e of entries) {
    const nameBytes = Uint8Array.from(Array.from(e.name).map((c) => c.charCodeAt(0)))
    const comp = e.compressed ?? e.data
    const offset = out.length
    // local header
    out.push(...(e.badLocalSig ? [0x00, 0x00, 0x03, 0x04] : [0x50, 0x4b, 0x03, 0x04]))
    out.push(...u16le(20))                       // version needed
    out.push(...u16le(e.flags ?? 0))             // flags
    out.push(...u16le(e.method ?? 0))            // method
    out.push(...u16le(0), ...u16le(0))           // time/date
    out.push(...u32le(0))                        // crc (测试不校验)
    out.push(...u32le(comp.length))              // comp size
    out.push(...u32le(e.declaredUncompressed ?? e.data.length))
    out.push(...u16le(nameBytes.length))
    out.push(...u16le(0))                        // extra len
    out.push(...Array.from(nameBytes))
    out.push(...Array.from(comp))
    central.push({ name: nameBytes, offset, e, comp })
  }

  const cdOffset = out.length
  for (const c of central) {
    const e = c.e
    out.push(0x50, 0x4b, 0x01, 0x02)
    out.push(...u16le(20), ...u16le(20))          // version made by / needed
    out.push(...u16le(e.flags ?? 0))             // flags
    out.push(...u16le(e.method ?? 0))            // method
    out.push(...u16le(0), ...u16le(0))           // time/date
    out.push(...u32le(0))                        // crc
    out.push(...u32le(e.zip64 ? 0xffffffff : c.comp.length))
    out.push(...u32le(e.zip64 ? 0xffffffff : (e.declaredUncompressed ?? e.data.length)))
    out.push(...u16le(c.name.length))
    out.push(...u16le(0), ...u16le(0))           // extra len / comment len
    out.push(...u16le(0))                        // disk start
    out.push(...u16le(0))                        // internal attrs
    out.push(...u32le(0))                        // external attrs
    out.push(...u32le(c.offset))                 // local header offset
    out.push(...Array.from(c.name))
  }
  const cdSize = out.length - cdOffset
  // EOCD
  out.push(0x50, 0x4b, 0x05, 0x06)
  out.push(...u16le(0), ...u16le(0))
  out.push(...u16le(central.length), ...u16le(central.length))
  out.push(...u32le(cdSize), ...u32le(cdOffset))
  out.push(...u16le(0))
  return Uint8Array.from(out)
}

const bytes = (s: string) => Uint8Array.from(Array.from(s).map((c) => c.charCodeAt(0)))

describe('★★★#1232 ZIP 容器解析（三端共用唯一实现）', () => {
  it('① stored 条目：解析 + 取数据原样', () => {
    const zip = buildZip([{ name: 'a.txt', data: bytes('hello') }])
    const es = parseZipCentralDirectory(zip)
    expect(es.length).toBe(1)
    expect(es[0]!.name).toBe('a.txt')
    expect(es[0]!.method).toBe(0)
    expect(Array.from(inflateEntry(zip, es[0]!))).toEqual(Array.from(bytes('hello')))
  })

  it('② 目录条目（尾随 /）被标记 isDirectory', () => {
    const zip = buildZip([
      { name: 'd/', data: new Uint8Array(0) },
      { name: 'd/x.txt', data: bytes('x') },
    ])
    const es = parseZipCentralDirectory(zip)
    expect(es[0]!.isDirectory).toBe(true)
    expect(es[1]!.isDirectory).toBe(false)
  })

  it('③ ★zip slip：条目名逃出目标目录 ⇒ safeEntryPath 返回 null', () => {
    // 这是本文件最重要的一条：ZIP 里写 ../../../evil 就能写到沙箱外
    expect(safeEntryPath('../evil.txt')).toBeNull()
    expect(safeEntryPath('a/../../evil.txt')).toBeNull()
    expect(safeEntryPath('a/b/../../../evil.txt')).toBeNull()
    expect(safeEntryPath('/etc/passwd'), '绝对路径').toBeNull()
    expect(safeEntryPath('C:/Windows/evil.txt'), '盘符').toBeNull()
    expect(safeEntryPath('..\\..\\evil.txt'), '反斜杠逃逸').toBeNull()
    // 合法路径要放行
    expect(safeEntryPath('a.txt')).toBe('a.txt')
    expect(safeEntryPath('d/x.txt')).toBe('d/x.txt')
    expect(safeEntryPath('./a.txt'), '前置 ./ 剥掉').toBe('a.txt')
    expect(safeEntryPath('a//b.txt'), '空段忽略').toBe('a/b.txt')
  })

  it('④ 加密条目 ⇒ 解析阶段就报错（不静默产出空文件）', () => {
    const zip = buildZip([{ name: 'e.txt', data: bytes('x'), flags: 0x0001 }])
    expect(() => parseZipCentralDirectory(zip)).toThrow(/已加密/)
  })

  it('⑤ ZIP64 哨兵 ⇒ 明确报错（不猜，猜错会解出垃圾）', () => {
    const zip = buildZip([{ name: 'z.txt', data: bytes('x'), zip64: true }])
    expect(() => parseZipCentralDirectory(zip)).toThrow(/ZIP64/)
  })

  it('⑥ EOCD / 中央目录签名坏 ⇒ 报错（不是"解析出 0 条"）', () => {
    const zip = buildZip([{ name: 'a.txt', data: bytes('hi') }])
    // 破坏中央目录签名（cdOffset 处）
    const bad = Uint8Array.from(zip)
    const cdOff = bad.length - 22 - (46 + 5)      // 单条目：EOCD 前就是该中央记录
    bad[cdOff] = 0x00
    expect(() => parseZipCentralDirectory(bad)).toThrow(/中央目录.*签名非法/)
  })

  it('⑦ 不支持的压缩方法（如 bzip2=12）⇒ 解压阶段报错', () => {
    const zip = buildZip([{ name: 'b.txt', data: bytes('x'), method: 12 }])
    const es = parseZipCentralDirectory(zip)
    expect(() => inflateEntry(zip, es[0]!)).toThrow(/压缩方法 12 不支持/)
  })

  it('⑧ ★尺寸撒谎：中央目录声明的大小与解压结果不符 ⇒ 报错（zip bomb 的探测手段）', () => {
    const zip = buildZip([{ name: 's.txt', data: bytes('abc'), declaredUncompressed: 999 }])
    const es = parseZipCentralDirectory(zip)
    expect(es[0]!.uncompressedSize, '解析出的是声明值 999').toBe(999)
    // stored 方法：实际 3 字节 ≠ 声明 999 ⇒ 报错
    expect(() => inflateEntry(zip, es[0]!)).toThrow(/尺寸不符/)
  })

  it('⑨ 局部头签名坏 ⇒ 报错（不能拿中央目录的偏移硬解）', () => {
    const zip = buildZip([{ name: 'l.txt', data: bytes('x'), badLocalSig: true }])
    expect(() => parseZipCentralDirectory(zip)).toThrow(/局部头签名非法/)
  })

  it('⑩ 上限常量存在且量级合理（条目数 4096 —— 防"几万个小文件"型炸弹）', () => {
    expect(UNZIP_MAX_ENTRIES).toBe(4096)
  })

  it('⑪ 文件被截断 ⇒ 明确报错（不是读到一堆 0）', () => {
    const zip = buildZip([{ name: 'a.txt', data: bytes('hello') }])
    const cut = zip.subarray(0, 40)               // 截到局部头中间
    expect(() => parseZipCentralDirectory(cut)).toThrow(/不是合法 ZIP|越界/)
  })
})
