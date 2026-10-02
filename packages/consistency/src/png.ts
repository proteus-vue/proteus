// packages/consistency/src/png.ts
// ★VC7 配套：**最小 PNG 解码器**（L4 观察需要把截图变成像素）——零依赖，平台中立。
//
// 【为什么自己写（不引 pngjs 等）】
//   ① `@proteus-vue/consistency` 是**零依赖**包（三端探针/门禁共用——依赖形态必须简单）；
//   ② 需要支持的范围窄且明确：**8-bit、非隔行、RGB(2) / RGBA(6) / Grayscale(0) / GA(4)**——
//      这正是 Playwright / wechatide / 各宿主截图的实际形态；
//   ③ 解压用 **`DecompressionStream('deflate')`**（Node 18+ 与浏览器同有）——
//      避开 `node:zlib`，保持包在浏览器也能打包（Web 探针的 IIFE 与它同源）。
//
// 【★诚实边界】不支持：16-bit 深度 / 隔行（Adam7）/ 调色板(3) / 透明色块(tRNS)。
//   遇到 ⇒ **明确抛错**（不猜、不静默产出错像素——"零静默失败"）。

import type { RgbaImage } from './pixel'

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function u32(bytes: Uint8Array, off: number): number {
  return ((bytes[off]! << 24) | (bytes[off + 1]! << 16) | (bytes[off + 2]! << 8) | bytes[off + 3]!) >>> 0
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate')
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds)
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

/**
 * ★色彩空间探测（从解压后的 ICC profile 读红色原色判 P3 / sRGB）。
 *
 * 【为什么按原色判而不是按 profile 名字】名字五花八门（Skia / "Display P3" / 设备厂商串），
 *   而原色坐标是 ICC 的**硬数据**。实测（本仓 Android 真机截图）：
 *   P3 的 D50 适配红原色 X≈0.5151，sRGB 的 X≈0.4361——用红原色 X 单值即可区分（阈值 0.48）。
 *
 * ICC 布局：128B 头 + 标签表（每项 12B：sig/offset/size）。原色在 `rXYZ` 标签的
 *   XYZNumber（s15Fixed16 ×3，紧跟 8B 类型头）。
 */
function detectColorSpace(iccDecompressed: Uint8Array): 'srgb' | 'display-p3' | 'unknown' {
  try {
    const ntags = ((iccDecompressed[128]! << 24) | (iccDecompressed[129]! << 16) | (iccDecompressed[130]! << 8) | iccDecompressed[131]!) >>> 0
    for (let i = 0; i < ntags; i++) {
      const off = 132 + i * 12
      if (off + 12 > iccDecompressed.length) break
      const sig = String.fromCharCode(iccDecompressed[off]!, iccDecompressed[off + 1]!, iccDecompressed[off + 2]!, iccDecompressed[off + 3]!)
      if (sig !== 'rXYZ') continue
      const toff = ((iccDecompressed[off + 4]! << 24) | (iccDecompressed[off + 5]! << 16) | (iccDecompressed[off + 6]! << 8) | iccDecompressed[off + 7]!) >>> 0
      if (toff + 20 > iccDecompressed.length) break
      const x = ((iccDecompressed[toff + 8]! << 24) | (iccDecompressed[toff + 9]! << 16) | (iccDecompressed[toff + 10]! << 8) | iccDecompressed[toff + 11]!) / 65536
      // P3 红原色 X=0.5151 · sRGB 红原色 X=0.4361（D50 适配）⇒ 阈值 0.48
      if (x > 0.48 && x < 0.55) return 'display-p3'
      if (x > 0.40 && x <= 0.48) return 'srgb'
      return 'unknown'
    }
  } catch {
    // 解析失败 ⇒ unknown（不猜；调用方按"未声明"处理）
  }
  return 'unknown'
}

/** Paeth 预测器（PNG 规范 9.4） */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/**
 * 解码 PNG → RGBA。
 * @throws 不支持/损坏时抛错并说明（不静默产出错像素）
 */
export async function decodePng(bytes: Uint8Array): Promise<RgbaImage> {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIG[i]) throw new Error('decodePng: 不是 PNG（签名不符）')
  }
  let off = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat: Uint8Array[] = []
  /** ★iCCP（内嵌 ICC 配置）——压缩字节先收着，解压后判定色彩空间（见 detectColorSpace） */
  let iccp: Uint8Array | null = null
  while (off + 8 <= bytes.length) {
    const len = u32(bytes, off)
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!)
    const dataStart = off + 8
    if (type === 'IHDR') {
      width = u32(bytes, dataStart)
      height = u32(bytes, dataStart + 4)
      bitDepth = bytes[dataStart + 8]!
      colorType = bytes[dataStart + 9]!
      interlace = bytes[dataStart + 12]!
    } else if (type === 'iCCP') {
      // 结构：[profile name]\0[compression u8][compressed profile]
      const chunk = bytes.subarray(dataStart, dataStart + len)
      let z = 0
      while (z < chunk.length && chunk[z] !== 0) z++
      if (z + 2 <= chunk.length && chunk[z + 1] === 0) iccp = chunk.subarray(z + 2)
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(dataStart, dataStart + len))
    } else if (type === 'IEND') {
      break
    }
    off = dataStart + len + 4 // 跳 CRC
  }
  if (width === 0 || height === 0) throw new Error('decodePng: 缺 IHDR 或尺寸为 0')
  if (bitDepth !== 8) throw new Error(`decodePng: 仅支持 8-bit 深度（实际 ${bitDepth}）——16-bit 请先转码`)
  if (interlace !== 0) throw new Error('decodePng: 不支持隔行（Adam7）——导出时关闭隔行')
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : -1
  if (channels < 0) throw new Error(`decodePng: 不支持的颜色类型 ${colorType}（支持 0/2/4/6）`)
  // 拼接 IDAT 并解压
  let total = 0
  for (const c of idat) total += c.length
  const z = new Uint8Array(total)
  let zo = 0
  for (const c of idat) {
    z.set(c, zo)
    zo += c.length
  }
  const raw = await inflate(z)
  const stride = width * channels
  const expected = (stride + 1) * height
  if (raw.length < expected) throw new Error(`decodePng: 解压数据不足（${raw.length} < ${expected}）`)
  // 逐扫描线逆滤波
  const out = new Uint8Array(width * height * 4)
  const prev = new Uint8Array(stride)
  const cur = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const row = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels]! : 0
      const b = prev[x]!
      const c = x >= channels ? prev[x - channels]! : 0
      const v = row[x]!
      let r: number
      switch (filter) {
        case 0: r = v; break
        case 1: r = v + a; break
        case 2: r = v + b; break
        case 3: r = v + Math.floor((a + b) / 2); break
        case 4: r = v + paeth(a, b, c); break
        default: throw new Error(`decodePng: 未知滤波类型 ${filter}（第 ${y} 行）`)
      }
      cur[x] = r & 0xff
    }
    // 展开为 RGBA
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const s = x * channels
      if (channels === 1) {
        out[o] = cur[s]!
        out[o + 1] = cur[s]!
        out[o + 2] = cur[s]!
        out[o + 3] = 255
      } else if (channels === 2) {
        out[o] = cur[s]!
        out[o + 1] = cur[s]!
        out[o + 2] = cur[s]!
        out[o + 3] = cur[s + 1]!
      } else if (channels === 3) {
        out[o] = cur[s]!
        out[o + 1] = cur[s + 1]!
        out[o + 2] = cur[s + 2]!
        out[o + 3] = 255
      } else {
        out[o] = cur[s]!
        out[o + 1] = cur[s + 1]!
        out[o + 2] = cur[s + 2]!
        out[o + 3] = cur[s + 3]!
      }
    }
    prev.set(cur)
  }
  // ★色彩空间：iCCP 存在则解压 + 判原色（解压/解析失败 ⇒ 'unknown'，**不改像素**）
  let colorSpace: RgbaImage['colorSpace']
  if (iccp) {
    try {
      colorSpace = detectColorSpace(await inflate(iccp))
    } catch {
      colorSpace = 'unknown'
    }
  }
  return { width, height, rgba: out, ...(colorSpace ? { colorSpace } : {}) }
}

/* ══════════════════ 测试/夹具辅助：最小 PNG 编码器 ══════════════════ */
// 【为什么需要】L4 的测试要用**真实 PNG 字节**验证解码路径（不 mock 解码器）；
//   而"生成一张 PNG"在没有编码器时无法从零做——本编码器只服务测试与夹具（store 模式，合法）。

/** 最小 PNG 编码器（8-bit RGBA，无滤波——测试/夹具用） */
export function encodePng(img: RgbaImage): Uint8Array {
  const { width, height, rgba } = img
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: None
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const deflated = deflateStore(raw)
  const chunks: Uint8Array[] = []
  const sig = new Uint8Array(PNG_SIG)
  chunks.push(sig)
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 6
  chunks.push(chunk('IHDR', ihdr))
  chunks.push(chunk('IDAT', deflated))
  chunks.push(chunk('IEND', new Uint8Array(0)))
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  out[4] = type.charCodeAt(0)
  out[5] = type.charCodeAt(1)
  out[6] = type.charCodeAt(2)
  out[7] = type.charCodeAt(3)
  out.set(data, 8)
  // CRC32（PNG 规范：type + data）
  const crcInput = new Uint8Array(4 + data.length)
  crcInput.set(out.subarray(4, 8))
  crcInput.set(data, 4)
  dv.setUint32(8 + data.length, crc32(crcInput))
  return out
}

/** zlib 存储模式（无压缩 deflate）——测试用足够，且完全不依赖压缩实现 */
function deflateStore(data: Uint8Array): Uint8Array {
  const blocks: number[] = [0x78, 0x01] // zlib header（deflate, 默认压缩级别声明）
  const MAX = 65535
  for (let off = 0; off < data.length; off += MAX) {
    const len = Math.min(MAX, data.length - off)
    const final = off + len >= data.length ? 1 : 0
    blocks.push(final) // BFINAL + BTYPE=00（存储）
    blocks.push(len & 0xff, (len >> 8) & 0xff, ~len & 0xff, (~len >> 8) & 0xff)
    for (let i = 0; i < len; i++) blocks.push(data[off + i]!)
  }
  // Adler-32
  let s1 = 1
  let s2 = 0
  for (let i = 0; i < data.length; i++) {
    s1 = (s1 + data[i]!) % 65521
    s2 = (s2 + s1) % 65521
  }
  const adler = ((s2 << 16) | s1) >>> 0
  blocks.push((adler >>> 24) & 0xff, (adler >>> 16) & 0xff, (adler >>> 8) & 0xff, adler & 0xff)
  return new Uint8Array(blocks)
}

let CRC_TABLE: Uint32Array | null = null
function crc32(data: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
