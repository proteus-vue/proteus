// packages/consistency/src/pixel.ts
// ★★VC7（一致性校验任务卡 · L4 像素兜底）：**非门禁**的观察模式——感知算法 + 样本量记录 + 噪声基线。
//
// 【🔴 本模块的定位（卡片原文）】「明确声明**不追求零噪声**，仅作兜底」。
//   L4 只覆盖 L1–L3 够不到的四项：圆角裁剪边界 / 阴影合成 / 渐变 / 字形栅格化。
//   ⇒ 硬门禁由 L1（编译期）+ L2/L3（数值比对）承担；本模块**只产出观察报告**，
//     任何调用方都不得把它的结论当"通过/失败"闸门（`pixelObservation` 的返回值里
//     `gate: false` 是给调用方的**显式提醒字段**）。
//
// 【为什么用感知算法而不是纯像素比对（卡片硬性要求）】
//   纯逐像素精确比对 = Flutter golden 的做法，官方自己承认跨端 flaky（标准 §5.1）。
//   ⇒ 用 **pHash（DCT 感知哈希）**做全局"看起来是不是同一张图"判据 +
//     **差异区域定位**（分块）给出"变了哪一块"——报告形态对人类与 AI 都可读。
//
// 【★诚实的边界（本模块最重要的注释）】
//   pHash 是**全局低频**特征：**小面积的颜色微变（如 §7.4 的按钮变色，1/255）它必然抓不到**
//   ——这不是缺陷，是"感知哈希"的定义决定的性质（全局下采样抹掉局部细节）。
//   ⇒ 这正是 L4 必须是"非门禁"的原因：**捕捉小缺陷是 L3 的职责**（我们有专门的必过用例）。
//   本模块的 `channelThreshold` 默认 8（抗抗锯齿/亚像素噪声），进一步说明为什么 1/255 级
//   差异在 L4 不可判——文档里写清，防止未来有人用它当 gate 然后被"漏报"坑到。
//
// 【🔴 必须记录每次失败的样本量（卡片原文）】`PixelObservation` 每项都带
//   `sampleCount`（比较了多少像素）与 `diffPixels`（多少像素被判差异）——用于验证
//   "L1–L3 过滤后 L4 的样本量下降一个数量级"这一假设（标准 §10.1 的收益论证）。

/** 观测结论（★注意：不是"通过/失败"——L4 非门禁） */
export type PixelVerdict =
  | 'identical'      // pHash 相同且无超阈值像素
  | 'noise-level'    // 差异在噪声带内（抗锯齿/子像素级）
  | 'changed'        // 检出超噪声带的差异（**报告用**，不阻断）
  | 'size-mismatch'  // 尺寸不同（无法逐像素比——如实报，不猜）

/** 差异区域（分块聚合——"变了哪一块"） */
export interface PixelDiffRegion {
  x: number
  y: number
  w: number
  h: number
  /** 该区域内超阈值的像素数 */
  pixels: number
  /** 该区域内超阈值的像素占比（0..1） */
  ratio: number
}

export interface PixelObservation {
  /** ★显式声明：本结论**不是门禁**（卡片要求"明确声明不追求零噪声"） */
  gate: false
  verdict: PixelVerdict
  /** 图像尺寸（两侧；size-mismatch 时不同） */
  sizeA: { width: number; height: number }
  sizeB: { width: number; height: number }
  /** ★样本量（卡片硬性要求） */
  sampleCount: number
  diffPixels: number
  /** 差异像素占比（0..1；size-mismatch 时为 -1） */
  diffRatio: number
  /** pHash 汉明距离（0..64；越小越像） */
  hashDistance: number
  /** 差异区域（按像素数降序，最多 8 块——报告用） */
  regions: PixelDiffRegion[]
  /** 本次观测的参数（可复现——报告里要能看出"用什么阈值判的"） */
  params: { channelThreshold: number; blockSize: number; noiseRatio: number; noiseHashDistance: number }
}

export interface PixelCompareOptions {
  /** 单通道差超过它才算"差异像素"（默认 8——抗抗锯齿/亚像素噪声） */
  channelThreshold?: number
  /** 差异区域分块尺寸（默认 16） */
  blockSize?: number
  /** 噪声带：diffRatio ≤ 它且 hashDistance 很小 ⇒ noise-level（默认 0.005） */
  noiseRatio?: number
  /**
   * 感知同形的 hash 距离上限（默认 16）。
   * 【为什么不是 0（实测）：pHash 对整幅均匀色偏敏感（+4/255 ⇒ 距离 14），而那属色差/抗锯齿噪声；
   *   16 是业界 pHash"同图"常用带宽。**只对"无超阈值像素"的观测生效**——
   *   有超阈值像素时仍走严格判据（changed），不会因此漏报。】
   */
  noiseHashDistance?: number
}

export interface RgbaImage {
  width: number
  height: number
  /** RGBA，行优先；长度 = width×height×4 */
  rgba: Uint8Array
}

export interface ImageSize {
  width: number
  height: number
}

/* ══════════════════ pHash（DCT 感知哈希） ══════════════════ */

/** 亮度（Rec.601——与主流 pHash 实现同系数） */
function luminance(rgba: Uint8Array, i: number): number {
  return 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!
}

/** 下采样为 n×n 灰度（盒式平均——确定性，无插值抖动） */
function downscaleGray(img: RgbaImage, n: number): Float64Array {
  const out = new Float64Array(n * n)
  for (let by = 0; by < n; by++) {
    const y0 = Math.floor((by * img.height) / n)
    const y1 = Math.max(y0 + 1, Math.floor(((by + 1) * img.height) / n))
    for (let bx = 0; bx < n; bx++) {
      const x0 = Math.floor((bx * img.width) / n)
      const x1 = Math.max(x0 + 1, Math.floor(((bx + 1) * img.width) / n))
      let sum = 0
      let count = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += luminance(img.rgba, (y * img.width + x) * 4)
          count++
        }
      }
      out[by * n + bx] = count > 0 ? sum / count : 0
    }
  }
  return out
}

/** 2D DCT-II（n×n，可分离：行变换 + 列变换） */
function dct2d(input: Float64Array, n: number): Float64Array {
  const cos = new Float64Array(n * n)
  for (let u = 0; u < n; u++) {
    for (let x = 0; x < n; x++) {
      cos[u * n + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n))
    }
  }
  const tmp = new Float64Array(n * n)
  // 行
  for (let y = 0; y < n; y++) {
    for (let u = 0; u < n; u++) {
      let s = 0
      for (let x = 0; x < n; x++) s += input[y * n + x]! * cos[u * n + x]!
      tmp[y * n + u] = s
    }
  }
  // 列
  const out = new Float64Array(n * n)
  for (let u = 0; u < n; u++) {
    for (let v = 0; v < n; v++) {
      let s = 0
      for (let y = 0; y < n; y++) s += tmp[y * n + u]! * cos[v * n + y]!
      out[v * n + u] = s
    }
  }
  return out
}

/**
 * pHash（64 位，DCT 低频 + 中位数阈值）——**确定性**：同图 ⇒ 同哈希（含下采样/舍入全确定）。
 * 返回 BigInt（便于汉明距离）。
 */
export function pHash(img: RgbaImage): bigint {
  const N = 32
  const gray = downscaleGray(img, N)
  const dct = dct2d(gray, N)
  // 取左上 8×8（含 DC，DC 置 0——亮度整体偏移不应影响形似度）
  const low: number[] = []
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) low.push(v === 0 && u === 0 ? 0 : dct[v * N + u]!)
  const sorted = [...low].sort((a, b) => a - b)
  const median = (sorted[31]! + sorted[32]!) / 2
  let hash = 0n
  for (let i = 0; i < 64; i++) {
    if (low[i]! > median) hash |= 1n << BigInt(i)
  }
  return hash
}

/** 汉明距离（0..64） */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b
  let d = 0
  while (x > 0n) {
    if (x & 1n) d++
    x >>= 1n
  }
  return d
}

/* ══════════════════ 观测（非门禁） ══════════════════ */

/**
 * 像素级观察（L4）：**产出报告，不做门禁判定**（见文件头注的定位声明）。
 *
 * 判据分两层（都对人类/AI 可解释）：
 *   ① 全局形似度：pHash 汉明距离（≤2 视为"形似"）
 *   ② 局部差异：逐像素单通道差 > channelThreshold 的像素数 + 分块定位
 * 两者都干净 ⇒ identical；差异在噪声带内 ⇒ noise-level；否则 ⇒ changed（**报告，不阻断**）。
 */
export function pixelObservation(a: RgbaImage, b: RgbaImage, opts: PixelCompareOptions = {}): PixelObservation {
  const channelThreshold = opts.channelThreshold ?? 8
  const blockSize = opts.blockSize ?? 16
  const noiseRatio = opts.noiseRatio ?? 0.005
  const noiseHashDistance = opts.noiseHashDistance ?? 16
  const params = { channelThreshold, blockSize, noiseRatio, noiseHashDistance }
  const sizeA = { width: a.width, height: a.height }
  const sizeB = { width: b.width, height: b.height }
  if (a.width !== b.width || a.height !== b.height) {
    return {
      gate: false, verdict: 'size-mismatch', sizeA, sizeB,
      sampleCount: 0, diffPixels: 0, diffRatio: -1, hashDistance: -1, regions: [], params,
    }
  }
  const sampleCount = a.width * a.height
  const hashDistance = hammingDistance(pHash(a), pHash(b))
  // 逐像素 + 分块统计（单遍）
  const blocksX = Math.ceil(a.width / blockSize)
  const blocksY = Math.ceil(a.height / blockSize)
  const blockCounts = new Uint32Array(blocksX * blocksY)
  let diffPixels = 0
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4
      const d = Math.max(
        Math.abs(a.rgba[i]! - b.rgba[i]!),
        Math.abs(a.rgba[i + 1]! - b.rgba[i + 1]!),
        Math.abs(a.rgba[i + 2]! - b.rgba[i + 2]!),
        Math.abs(a.rgba[i + 3]! - b.rgba[i + 3]!),
      )
      if (d > channelThreshold) {
        diffPixels++
        blockCounts[Math.floor(y / blockSize) * blocksX + Math.floor(x / blockSize)]!++
      }
    }
  }
  const diffRatio = sampleCount > 0 ? diffPixels / sampleCount : 0
  // ★★"完全一致"的判据必须含**逐字节相等**（本模块两轮实测抓出的语义缺陷）：
  //   ① 首版只看 `channelThreshold` 过滤后的 diffPixels ⇒ **1/255 级差异被判 'identical'**
  //      ——"identical" 是强断言（"两边一样"），而实际有未捕获的差异 ⇒ 误导消费方。
  //   ⇒ 真判据：逐字节比。`byteEqual` 才允许 'identical'；否则（存在任何字节差）
  //      要么 noise-level（在阈值内/感知同形）要么 changed。
  let byteEqual = true
  for (let i = 0; i < a.rgba.length; i++) {
    if (a.rgba[i] !== b.rgba[i]) { byteEqual = false; break }
  }
  // 差异区域：块内差异像素占比 ≥ 10% 或块内像素数 ≥ 100 才收录（滤掉孤立噪点）
  const regions: PixelDiffRegion[] = []
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const n = blockCounts[by * blocksX + bx]!
      if (n === 0) continue
      const w = Math.min(blockSize, a.width - bx * blockSize)
      const h = Math.min(blockSize, a.height - by * blockSize)
      const ratio = n / (w * h)
      if (ratio >= 0.1 || n >= 100) {
        regions.push({ x: bx * blockSize, y: by * blockSize, w, h, pixels: n, ratio: Math.round(ratio * 1000) / 1000 })
      }
    }
  }
  regions.sort((x, y) => y.pixels - x.pixels)
  // ★判据口径（第二处缺陷的修正）："感知同形"**不要求 hashDistance 恰为 0**——
  //   pHash 对**整幅均匀亮度变化**敏感（实测：整幅 +4/255 ⇒ 距离 14），而那正是抗锯齿/色差
  //   级噪声。⇒ 分层判：字节全等 ⇒ identical；无超阈值像素且感知同形（dist ≤ noiseHash）
  //   ⇒ noise-level；否则 changed。`noiseHash` 默认 16（业界 pHash 常用 10~16 作为"同图"带宽）。
  const noiseHash = opts.noiseHashDistance ?? 16
  const verdict: PixelVerdict = byteEqual
    ? 'identical'
    : diffPixels === 0 && hashDistance <= noiseHash
      ? 'noise-level'
      : hashDistance <= 2 && diffRatio <= noiseRatio
        ? 'noise-level'
        : 'changed'
  return {
    gate: false, verdict, sizeA, sizeB,
    sampleCount, diffPixels,
    diffRatio: Math.round(diffRatio * 100000) / 100000,
    hashDistance,
    regions: regions.slice(0, 8),
    params,
  }
}

/* ══════════════════ 噪声基线（人工确认为"已知噪声"并留痕） ══════════════════ */

/** 一条"已知噪声"记录（**必须留痕**：理由 + 记录人 + 时间 + 当时的观测读数） */
export interface PixelNoiseEntry {
  id: string
  /** 为什么它是噪声而非缺陷（必填——卡片的"需留痕"） */
  reason: string
  /** 容忍上限：diffRatio 不超过它且 hashDistance 不超过它 ⇒ 视为已知噪声 */
  maxDiffRatio: number
  maxHashDistance: number
  /** 留痕：谁在何时确认的 + 当时的观测摘要 */
  recordedBy: string
  recordedAt: string
  evidence: { diffPixels: number; sampleCount: number; hashDistance: number }
}

export interface PixelNoiseBaseline {
  note: string
  entries: PixelNoiseEntry[]
}

/** 校验噪声基线（schema：id/reason/留痕字段必填且唯一；reason 过短视为未写理由） */
export function validatePixelNoiseBaseline(baseline: unknown): string[] {
  const errs: string[] = []
  if (!baseline || typeof baseline !== 'object') return ['基线不是对象']
  const b = baseline as Partial<PixelNoiseBaseline>
  const entries = b.entries
  if (!Array.isArray(entries)) return ['entries 应为数组']
  const seen = new Set<string>()
  for (const [i, e] of entries.entries()) {
    for (const k of ['id', 'reason', 'recordedBy', 'recordedAt'] as const) {
      if (typeof e?.[k] !== 'string' || (e[k] as string).trim().length === 0) errs.push(`entries[${i}] 缺/空字段：${k}`)
    }
    if (typeof e?.reason === 'string' && e.reason.trim().length < 12) errs.push(`entries[${i}] reason 过短（须说明为什么是噪声而非缺陷）：${e.reason}`)
    if (e?.id && seen.has(e.id)) errs.push(`id 重复：${e.id}`)
    if (e?.id) seen.add(e.id)
    if (typeof e?.maxDiffRatio !== 'number' || e.maxDiffRatio < 0 || e.maxDiffRatio > 0.05) {
      errs.push(`entries[${i}].maxDiffRatio 应为 0..0.05（噪声容忍不应超过 5%——超过就该查清而不是登记）`)
    }
    // ★上限按**实测依据**定（不是凭直觉）：整幅 +4/255 的色差噪声实测 pHash 距离 14
    //   （和 pixel.ts 的 noiseHashDistance 默认 16 同源）⇒ 上限取 16 与之一致。
    //   首版写 8 与实测带宽矛盾（测试抓出：观测判 noise-level 而基线条目存不进）。
    //   ★超过 16 说明两张图已明显不同——那不是噪声，该查。
    if (typeof e?.maxHashDistance !== 'number' || e.maxHashDistance < 0 || e.maxHashDistance > 16) {
      errs.push(`entries[${i}].maxHashDistance 应为 0..16（与 noiseHashDistance 同带宽；更大说明两张图已明显不同）`)
    }
  }
  return errs
}

/** 观测结论 ⇄ 噪声基线匹配（命中 ⇒ 标注为"已知噪声"，留痕条目随报告带出） */
export function matchPixelNoise(
  obs: PixelObservation,
  baseline: PixelNoiseBaseline,
): { known: boolean; entry?: PixelNoiseEntry } {
  if (obs.verdict === 'identical' || obs.verdict === 'size-mismatch') return { known: false }
  const entry = baseline.entries.find(
    (e) => obs.diffRatio >= 0 && obs.diffRatio <= e.maxDiffRatio && obs.hashDistance <= e.maxHashDistance,
  )
  return entry ? { known: true, entry } : { known: false }
}

/* ══════════════════ 观测报告（★记录样本量——验证"样本下降一个数量级"假设） ══════════════════ */

export interface PixelObservationReport {
  format: 'proteus-pixel-observation'
  version: 1
  /** ★显式声明（卡片要求）：非门禁，仅观察 */
  gate: false
  note: string
  pairs: Array<{
    id: string
    a: string
    b: string
    observation: PixelObservation
    knownNoise?: PixelNoiseEntry
  }>
  /** ★样本量汇总（卡片硬性要求："记录每次失败的样本量"） */
  totals: {
    /** 全部比较的像素数（L4 实际需要看的量——用于与全页面对比） */
    sampleCount: number
    /** 检出差异的像素数 */
    diffPixels: number
    /** 判 changed 的样本数（"失败的样本量"） */
    changedSamples: number
    /** 判 noise-level / identical 的样本数 */
    cleanSamples: number
    /** 命中已知噪声的样本数（留痕计数） */
    knownNoiseSamples: number
  }
}

/** 生成观测报告（纯函数——调用方负责把 pairs 收集齐） */
export function buildPixelReport(
  pairs: Array<{ id: string; a: string; b: string; observation: PixelObservation; knownNoise?: PixelNoiseEntry }>,
): PixelObservationReport {
  const totals = { sampleCount: 0, diffPixels: 0, changedSamples: 0, cleanSamples: 0, knownNoiseSamples: 0 }
  for (const p of pairs) {
    totals.sampleCount += p.observation.sampleCount
    totals.diffPixels += p.observation.diffPixels
    if (p.observation.verdict === 'changed') totals.changedSamples++
    else if (p.observation.verdict !== 'size-mismatch') totals.cleanSamples++
    if (p.knownNoise) totals.knownNoiseSamples++
  }
  return {
    format: 'proteus-pixel-observation',
    version: 1,
    gate: false,
    note: 'L4 像素观察——**非门禁**（标准 §8.1）：不追求零噪声，仅作 L1–L3 够不到的四项（圆角/阴影/渐变/字形）的兜底观察。',
    pairs,
    totals,
  }
}
