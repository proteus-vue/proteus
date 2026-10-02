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
  /** 差异区域（按像素数降序，最多 8 块——**坐标按原图口径**，已含 ROI 偏移） */
  regions: PixelDiffRegion[]
  /** 本次观测的参数（可复现——报告里要能看出"用什么阈值判的"） */
  params: { channelThreshold: number; blockSize: number; noiseRatio: number; noiseHashDistance: number }
  /** 本次观测区域（缺省 = 整图；声明后 sampleCount 只计区域面积——报告要能看出"比的是哪一块"） */
  roi?: ImageRoi
  /**
   * 平移拟合结果（仅 `alignTranslation` 开启时存在）——**跨运行时截图的坐标系原点差**可度量。
   * ★注意：报告里的 `sampleCount`/`diffPixels`/`regions` 都是**对齐后窗口内**的口径
   *   （窗口 = ROI 再四边各让开 `max` 像素，让开的部分不参与统计）；
   *   `diffPixelsRaw` = 同一窗口内**未对齐**的差异数（两者之差 = 平移解释掉的差异量）。
   */
  translation?: TranslationFit
}

/**
 * ★★**观测前置断言**（防"截图全是错误页/白屏"的假绿——本仓实测抓出）：
 *   若两张图都是同一个错误页（模拟器启动失败/白屏），`pixelObservation` 会判 `identical`
 *   并让调用方以为"两端一致"——**这是最危险的假绿**（截图错了两遍看起来反而"最一致"）。
 *   ⇒ 调用方应在观测前用本函数检查"图里有没有该有的东西"（颜色探针）。
 *
 * @param img 待检查图像
 * @param probes 期望出现的颜色（rgba 数值 + `tolerance` 单通道容差）
 * @returns 命中的探针数 / 未命中的清单（调用方据此判"截图是否有效"）
 */
export function assertPixelsPresent(
  img: RgbaImage,
  probes: Array<{ name: string; rgb: [number, number, number]; tolerance?: number }>,
): { ok: boolean; hit: string[]; missed: string[] } {
  const hit: string[] = []
  const missed: string[] = []
  for (const p of probes) {
    const tol = p.tolerance ?? 12
    let found = false
    for (let i = 0; i < img.rgba.length && !found; i += 4) {
      if (
        Math.abs(img.rgba[i]! - p.rgb[0]) <= tol &&
        Math.abs(img.rgba[i + 1]! - p.rgb[1]) <= tol &&
        Math.abs(img.rgba[i + 2]! - p.rgb[2]) <= tol
      ) {
        found = true
      }
    }
    if (found) hit.push(p.name)
    else missed.push(p.name)
  }
  return { ok: missed.length === 0, hit, missed }
}

/** 感兴趣区域（截图的**应用内容区**——排除设备 chrome，见 `roi` 选项注释） */
export interface ImageRoi {
  x: number
  y: number
  w: number
  h: number
}

export interface PixelCompareOptions {
  /** 单通道差超过它才算"差异像素"（默认 8——抗抗锯齿/亚像素噪声） */
  channelThreshold?: number
  /** 差异区域分块尺寸（默认 16） */
  blockSize?: number
  /** 噪声带：diffRatio ≤ 它且 hashDistance 很小 ⇒ noise-level（默认 0.005） */
  noiseRatio?: number
  /**
   * ★★观测区域（默认整图）——**排除设备 chrome**。
   *
   * 【为什么必须有（L4 真截图实测抓出）】整屏截图里有一类**与 App 无关**的像素：
   *   状态栏时钟（每张截图都不同——12:37 vs 12:38）、Home 指示条、模拟器圆角透出的
   *   窗口底色、截图左缘 1px 伪影。它们让"任意两张截图必然 changed"——
   *   这是**系统性假差异源**（不是随机抖动，是确定性污染）。
   *   ⇒ 只比**应用内容区**：调用方显式声明 ROI，随报告带出（可复现）。
   *   ROI 坐标按**对齐后**尺寸计（先 `alignSize` 再裁剪）；报告的 region 坐标按原图口径。
   */
  roi?: ImageRoi
  /**
   * ★尺寸对齐（默认 false）：true 时把 **B 重采样到 A 的尺寸**后再比。
   *   跨 DPR 截图（小程序物理像素 vs Web CSS 像素）必须开——见 `resampleTo` 注释。
   */
  alignSize?: boolean
  /**
   * ★平移对齐（默认 false；数字 = 搜索半径 ±N）：先求**最优整数平移**再观测。
   *   跨运行时截图（浏览器 vs 小程序）必开——两端设备坐标系原点约定不同
   *   （实测内容差 dy=−1，原始残差 0.530% → 对齐后 0.381%）。
   *   拟合结果随报告回传（`translation` 字段）。见 `alignTranslation` 的诚实边界。
   */
  alignTranslation?: boolean | number
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
  /**
   * PNG 内嵌 ICC 色彩空间（`decodePng` 探测；缺省 = 未声明，按 sRGB 处理）。
   *
   * 【★为什么必须带上（Android 真机截图实测抓出的跨端颜色假差异）】
   *   Android 设备截图（Skia 编码）内嵌 **Display P3** ICC：同一声明色 `#2f6fed`，
   *   截图像素是 **(64,110,229)** 而非 (47,111,237)——这正是标准 §13 第 6 项
   *   "广色域（P3/sRGB）对同色值视觉差异"的**真数据**（此前标注"无公开量化"）。
   *   手算验证：sRGB(47,111,237) → Display P3 = (64.3, 109.6, 228.9)，与实测三通道全中。
   *   ⇒ 不先归一色彩空间就比颜色，会把**色域编码差**读成"某端画错了"（假阳性）。
   *   归一动作在 `convertToSrgb`（显式调用——解码本身**不改像素**，不静默改变语义）。
   */
  colorSpace?: 'srgb' | 'display-p3' | 'unknown'
}

/* ══════════════════ 色彩空间归一（P3 → sRGB） ══════════════════ */

/** sRGB 传递函数：编码值 → 线性（两空间同用这条曲线——Display P3 沿用 sRGB TRC） */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
/** sRGB 传递函数：线性 → 编码值 */
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

/**
 * Display P3 编码值 → sRGB 编码值（单通道输入 0..255，返回 0..255；超色域裁剪）。
 *
 * 数学：解码 gamma → 线性 P3 →（P3→XYZ D65）（XYZ D65→线性 sRGB）→ 编码 gamma。
 * 矩阵取自 CSS Color 4 规范（与浏览器 `color(display-p3 …)` 转换同源）。
 * 实测校准：P3 输出 (64,110,229) ↔ sRGB 输入 (47,111,237)（本仓 Android 真机数据）。
 */
export function p3ToSrgbChannel(r255: number, g255: number, b255: number): [number, number, number] {
  const r = srgbToLinear(r255 / 255)
  const g = srgbToLinear(g255 / 255)
  const b = srgbToLinear(b255 / 255)
  // P3 线性 → XYZ (D65)
  const X = 0.4865709486482162 * r + 0.26566769316909306 * g + 0.1982172852343625 * b
  const Y = 0.2289745640697488 * r + 0.6917385218365064 * g + 0.079286914093745 * b
  const Z = 0.0 * r + 0.04511338185890264 * g + 1.043944368900976 * b
  // XYZ (D65) → sRGB 线性
  const lr = 3.2409699419045226 * X - 1.537383177570094 * Y - 0.4986107602930034 * Z
  const lg = -0.9692436362808796 * X + 1.8759675015077202 * Y + 0.04155505740717559 * Z
  const lb = 0.05563007969699366 * X - 0.20397695888897652 * Y + 1.0569715142428786 * Z
  const enc = (v: number) => Math.max(0, Math.min(255, Math.round(linearToSrgb(Math.max(0, Math.min(1, v))) * 255)))
  return [enc(lr), enc(lg), enc(lb)]
}

/**
 * 把图归一为 sRGB（**仅当 `colorSpace === 'display-p3'` 时转换**；其余原样返回同一对象）。
 *
 * 【调用方纪律】跨端像素比较（L4）在 `decodePng` 之后、任何探针/比较之前调用本函数——
 *   否则 P3 端与 sRGB 端的"同一声明色"像素值天然不同（实测 #2f6fed 差到 (64,110,229)）。
 */
export function convertToSrgb(img: RgbaImage): RgbaImage {
  if (img.colorSpace !== 'display-p3') return img
  const out = new Uint8Array(img.rgba.length)
  for (let i = 0; i < img.rgba.length; i += 4) {
    const [r, g, b] = p3ToSrgbChannel(img.rgba[i]!, img.rgba[i + 1]!, img.rgba[i + 2]!)
    out[i] = r
    out[i + 1] = g
    out[i + 2] = b
    out[i + 3] = img.rgba[i + 3]!
  }
  return { width: img.width, height: img.height, rgba: out, colorSpace: 'srgb' }
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

/* ══════════════════ 尺寸对齐（跨 DPR 截图的前提） ══════════════════ */

/**
 * 盒式平均重采样（把 `src` 缩放到 `dstW × dstH`）。
 *
 * 【为什么必须做（本仓实测）】跨端截图的分辨率天然不同——小程序模拟器截的是**物理像素**
 *   （591×1280），Playwright 截的是**CSS 像素**（390×844）⇒ 直接逐像素比会得到
 *   "尺寸不同"（`size-mismatch`）而**无法观察内容差异**。
 *   ⇒ 归一到同一尺寸再比：重采样会引入少量噪声，但 `channelThreshold`（默认 8）
 *     本就是这个量级的设计（L4 是"观察"非门禁）。
 *
 * 【为什么用盒式平均而不是最近邻】最近邻在缩小场景会**丢整行/整列**（采样偏差）；
 *   盒式平均覆盖全部源像素（面积平均），对"颜色/渐变"类观察更稳。
 */
export function resampleTo(src: RgbaImage, dstW: number, dstH: number): RgbaImage {
  if (dstW <= 0 || dstH <= 0) throw new Error(`resampleTo: 目标尺寸非法 ${dstW}x${dstH}`)
  if (src.width === dstW && src.height === dstH) return src
  const out = new Uint8Array(dstW * dstH * 4)
  for (let dy = 0; dy < dstH; dy++) {
    const y0 = Math.floor((dy * src.height) / dstH)
    const y1 = Math.max(y0 + 1, Math.floor(((dy + 1) * src.height) / dstH))
    for (let dx = 0; dx < dstW; dx++) {
      const x0 = Math.floor((dx * src.width) / dstW)
      const x1 = Math.max(x0 + 1, Math.floor(((dx + 1) * src.width) / dstW))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * src.width + x) * 4
          r += src.rgba[i]!
          g += src.rgba[i + 1]!
          b += src.rgba[i + 2]!
          a += src.rgba[i + 3]!
          n++
        }
      }
      const o = (dy * dstW + dx) * 4
      out[o] = Math.round(r / n)
      out[o + 1] = Math.round(g / n)
      out[o + 2] = Math.round(b / n)
      out[o + 3] = Math.round(a / n)
    }
  }
  return { width: dstW, height: dstH, rgba: out }
}

/**
 * 裁剪到 ROI（**越界即报错，不静默截断**——静默截断会让"观测区写错"变成看不出的小区域观测）。
 * ROI 与图边界允许恰好贴合；超出 1px 都不行（此时应改 ROI 而不是让引擎猜）。
 */
export function cropImage(img: RgbaImage, roi: ImageRoi): RgbaImage {
  if (roi.x < 0 || roi.y < 0 || roi.w <= 0 || roi.h <= 0 || roi.x + roi.w > img.width || roi.y + roi.h > img.height) {
    throw new Error(`cropImage: ROI ${JSON.stringify(roi)} 越界（图 ${img.width}x${img.height}）`)
  }
  const out = new Uint8Array(roi.w * roi.h * 4)
  for (let y = 0; y < roi.h; y++) {
    const src = ((roi.y + y) * img.width + roi.x) * 4
    out.set(img.rgba.subarray(src, src + roi.w * 4), y * roi.w * 4)
  }
  return { width: roi.w, height: roi.h, rgba: out }
}

/* ══════════════════ 锚定归一（五端同坐标系比较的前提） ══════════════════ */

export interface AnchorNormalizeSpec {
  /** 锚点块的特征色（夹具里唯一的大色块——实测用于定位与定标） */
  probe: [number, number, number]
  /** 特征色容差（默认 12） */
  tolerance?: number
  /**
   * 行内最小连续段（默认 10）——只统计**同一行连续 ≥ minRun 像素**的匹配段。
   * 【为什么需要（实测）】模拟器截图左缘有 1px 蓝色伪影（与锚点同族）⇒ 裸色匹配 bbox 被拉到 (0,0)。
   * 锚块是 ≥100px 实心矩形 ⇒ 该过滤零误伤（伪影 1px 宽必被滤掉）。
   */
  minRun?: number
  /** 输出图尺寸（全部端统一——跨端逐像素比较的前提） */
  outSize: { w: number; h: number }
  /** 输出图中锚点块的**目标矩形**：`w` 定标（输出像素宽）、`x/y` 定位（锚块左上角应落在此处） */
  blockTarget: { x: number; y: number; w: number }
}

export interface AnchorNormalizeResult {
  img: RgbaImage
  /** 源图中实测的锚点块 bbox（诊断/报告用） */
  block: { x: number; y: number; w: number; h: number }
  /** 缩放系数（输出像素 / 源像素） */
  scale: number
  /** 源窗口（诊断用） */
  srcWindow: ImageRoi
}

/**
 * ★★**锚定归一**（L4 五端比较的统一坐标系）——把任意分辨率/DPR 的截图，
 *   按"夹具锚点块"对齐并缩放到**同一输出尺寸**。
 *
 * 【为什么必须有（用户点名"把一致性标准全部拉齐"到 iOS/Android 的前提）】
 *   五端的截图分辨率天然互不可比：
 *   · 小程序模拟器 640×1386（窗口缩放 ≈1.625×逻辑）
 *   · Web（DPR2）780×1688 · iOS 模拟器（@3x）≈1179×2556 · Android 真机（density≈3）1080×2400
 *   ⇒ 逐像素比较**必须先落到同一坐标系**。锚定块（夹具的蓝块）同时给出两个量：
 *     **位置**（把它对齐 ⇒ 吸收设备坐标系原点差）与**尺寸**（拿它定标 ⇒ 吸收 DPR/缩放差）。
 *   比 `alignTranslation`（只对齐位置、假设尺寸一致）更强：单函数覆盖位置 + 尺度两个自由度。
 *
 * 【纯整数平移的字节确定性（单测断言）】源窗口坐标经 `Math.round` 整数化：
 *   内容整体平移**整数像素**时，两次裁剪出的源区域**逐字节相同** ⇒ 输出逐字节相同。
 *
 * 【诚实边界】锚定会**吸收真实的位置与尺寸差异**（若某端整体偏移或缩放错，归一后看不出）——
 *   "位置/尺寸是否正确"由 L2 几何数值比对承担；L4 只管"画出来像不像"（与 `alignTranslation` 同款纪律）。
 */
export function anchorNormalize(src: RgbaImage, spec: AnchorNormalizeSpec): AnchorNormalizeResult {
  const tol = spec.tolerance ?? 12
  const minRun = spec.minRun ?? 10
  const [pr, pg, pb] = spec.probe
  const matches = (i: number): boolean =>
    Math.abs(src.rgba[i]! - pr) <= tol && Math.abs(src.rgba[i + 1]! - pg) <= tol && Math.abs(src.rgba[i + 2]! - pb) <= tol
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = -1
  let y1 = -1
  let n = 0
  // ★**两级过滤**（实测抓出的必要步骤——模拟器截图有两类与锚点同族的伪影，裸色匹配会把 bbox 拉到 (0,0)）：
  //   ① 行内连续段过滤（minRun）：滤掉 1px 宽的左缘伪影；
  //   ② **最长段启发**（maxRun × 0.6）：锚块是夹具里最宽的蓝色实心物 ⇒ 只保留长度 ≥ 最长段 60%
  //      的段——滤掉圆角处的 71px 宽角块（实测 (0,0) 有一块，块本体 ~130px）。
  //   两道过滤都**零误伤**：锚块的实心行长度 ≈ 块宽（最大），圆角首末行也 > 0.6×块宽。
  const segs: Array<{ y: number; x0: number; x1: number; len: number }> = []
  for (let y = 0; y < src.height; y++) {
    let run = 0
    for (let x = 0; x <= src.width; x++) {
      const hit = x < src.width && matches((y * src.width + x) * 4)
      if (hit) {
        run++
        continue
      }
      if (run >= minRun) segs.push({ y, x0: x - run, x1: x - 1, len: run })
      run = 0
    }
  }
  // ★找不到锚 ⇒ 报错，**不静默**（那意味着截图错了/夹具缺件——正是最该红的形态）
  if (segs.length === 0) {
    throw new Error(`anchorNormalize: 未找到锚点色 rgb(${pr},${pg},${pb})±${tol}（截图无效或夹具特征色不符——不静默）`)
  }
  const maxRun = Math.max(...segs.map((s) => s.len))
  for (const s of segs) {
    if (s.len < maxRun * 0.6) continue
    n += s.len
    if (s.x0 < x0) x0 = s.x0
    if (s.x1 > x1) x1 = s.x1
    if (s.y < y0) y0 = s.y
    if (s.y > y1) y1 = s.y
  }
  const block = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
  // 定标：输出像素 / 源像素（用锚块宽度——宽度比高度对边缘 AA 更稳健，块是长边横块）
  const s = spec.blockTarget.w / block.w
  const winW = Math.round(spec.outSize.w / s)
  const winH = Math.round(spec.outSize.h / s)
  const winX = Math.round(block.x - spec.blockTarget.x / s)
  const winY = Math.round(block.y - spec.blockTarget.y / s)
  if (winX < 0 || winY < 0 || winX + winW > src.width || winY + winH > src.height) {
    throw new Error(
      `anchorNormalize: 归一窗口越界（源 ${src.width}x${src.height}；窗口 ${winX},${winY},${winW},${winH}）` +
        '——夹具内容须离屏幕边缘足够远（或锚块尺寸异常）',
    )
  }
  const srcWindow: ImageRoi = { x: winX, y: winY, w: winW, h: winH }
  const cropped = cropImage(src, srcWindow)
  const img = resampleTo(cropped, spec.outSize.w, spec.outSize.h)
  return { img, block, scale: s, srcWindow }
}

/* ══════════════════ 观测（非门禁） ══════════════════ */

/** 平移对齐结果（"两边差了整数像素"的可度量形态——见 `alignTranslation` 选项注释） */
export interface TranslationFit {
  /** 使残差最小的整数平移（B 侧采样点 = (x−dx, y−dy)） */
  dx: number
  dy: number
  /** 对齐后的差异像素数（与未对齐时的对比即"平移解释了多少差异"） */
  diffPixels: number
  /** 未对齐时的差异像素数 */
  diffPixelsRaw: number
  /** 搜索半径（可复现：结果只在此范围内最优） */
  max: number
}

/**
 * 整数平移对齐搜索（±`max`，步长 1）——**跨运行时截图的"坐标系原点差"是可度量的**。
 *
 * 【为什么需要（实测）】Web 端与小程序端的**设备坐标系原点约定不同**：
 *   Web 截图的 (0,0) = 视口左上；小程序模拟器截图的 (0,0) = 设备外框左上
 *   （含状态栏/圆角/Home 条区域）。实测：内容包围盒 dx=0 / dy=−1 ⇒ 原始残差 0.530%，
 *   纯整数平移对齐后 0.381%——**同一个 1px 原点是 0.15 个百分点差异的来源**。
 *   ⇒ 不先对齐就报"changed"，会把"坐标系差"读成"绘制不一致"（假阳性）；
 *     先对齐再观测，剩下的残差才是**真正值得看的绘制差异**。
 *
 * 【为什么是整数平移】跨端截图的 DPR 缩放由 `resampleTo`（盒式平均）归一到同尺寸，
 *   归一是连续变换；原点差是**离散整数像素的事**（实测 dy=±1 的最优值隔位读数 2643 vs 4713/3597）。
 *   整数搜索零插值、零参数、结果可复现——比"图像配准"的一堆可调参数更符合本仓"判据要能解释"的纪律。
 *
 * 【诚实边界】平移对齐会**吸收真实的位置差异**（若某端整体真的偏了 3px，对齐后看不出来）。
 *   ⇒ 本函数**只做观测对齐**，产出 `dx/dy` 随报告回传；"位置是否正确"由 L2 几何数值比对
 *     承担（L4 不是判几何对错的地方，见文件头注的定位声明）。
 *
 * @returns 最优点（`diffPixels` 最小；同值时取半径更小者 → 确定性）
 */
export function alignTranslation(
  a: RgbaImage,
  b: RgbaImage,
  opts: { max?: number; channelThreshold?: number } = {},
): TranslationFit {
  const max = opts.max ?? 4
  const th = opts.channelThreshold ?? 8
  // ★计数判据与 `pixelObservation` 主循环**逐字一致**（含 alpha 通道、同一窗口）——
  //   否则"拟合最优值"与"报告 diffPixels"会差几个像素，两个数打架（本仓纪律：口径必须唯一）
  const count = (dx: number, dy: number): number => {
    let n = 0
    for (let y = max; y < a.height - max; y++) {
      for (let x = max; x < a.width - max; x++) {
        const sx = x - dx
        const sy = y - dy
        const i = (y * a.width + x) * 4
        const j = (sy * b.width + sx) * 4
        const d = Math.max(
          Math.abs(a.rgba[i]! - b.rgba[j]!),
          Math.abs(a.rgba[i + 1]! - b.rgba[j + 1]!),
          Math.abs(a.rgba[i + 2]! - b.rgba[j + 2]!),
          Math.abs(a.rgba[i + 3]! - b.rgba[j + 3]!),
        )
        if (d > th) n++
      }
    }
    return n
  }
  let best: TranslationFit | null = null
  for (let r = 0; r <= max; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue
        const n = count(dx, dy)
        // ★同值时取半径更小者（外层 r 递增 ⇒ 先到者胜）——确定性，不受枚举顺序影响
        if (!best || n < best.diffPixels) best = { dx, dy, diffPixels: n, diffPixelsRaw: 0, max }
      }
    }
  }
  const fit = best!
  // ★-0 归一（单测抓出的字节确定性缺陷——与 VC3 快照格式同款问题）：
  //   r=0 时循环变量 `dx = -r` 就是 `-0` ⇒ 拟合结果带负零，
  //   序列化/深比较/git diff 都会把它当"另一个值"（`Object.is(-0, 0) === false`）。
  //   `+ 0` 把 -0 归一为 +0（`-0 + 0 === +0`）——唯一舍入点之外不做任何数值加工。
  fit.dx = fit.dx + 0
  fit.dy = fit.dy + 0
  fit.diffPixelsRaw = count(0, 0)
  return fit
}

/**
 * 像素级观察（L4）：**产出报告，不做门禁判定**（见文件头注的定位声明）。
 *
 * 判据分两层（都对人类/AI 可解释）：
 *   ① 全局形似度：pHash 汉明距离（≤2 视为"形似"）
 *   ② 局部差异：逐像素单通道差 > channelThreshold 的像素数 + 分块定位
 * 两者都干净 ⇒ identical；差异在噪声带内 ⇒ noise-level；否则 ⇒ changed（**报告，不阻断**）。
 */
export function pixelObservation(a: RgbaImage, bIn: RgbaImage, opts: PixelCompareOptions = {}): PixelObservation {
  let b = bIn
  const channelThreshold = opts.channelThreshold ?? 8
  const blockSize = opts.blockSize ?? 16
  const noiseRatio = opts.noiseRatio ?? 0.005
  const noiseHashDistance = opts.noiseHashDistance ?? 16
  const params = { channelThreshold, blockSize, noiseRatio, noiseHashDistance }
  const sizeA = { width: a.width, height: a.height }
  const sizeB0 = { width: bIn.width, height: bIn.height }
  if (a.width !== b.width || a.height !== b.height) {
    if (!opts.alignSize) {
      return {
        gate: false, verdict: 'size-mismatch', sizeA, sizeB: sizeB0,
        sampleCount: 0, diffPixels: 0, diffRatio: -1, hashDistance: -1, regions: [], params,
      }
    }
    // ★尺寸对齐：B → A 的尺寸（跨 DPR 截图的可比化——见 resampleTo 注释）
    b = resampleTo(b, a.width, a.height)
  }
  const sizeB = { width: b.width, height: b.height }
  // ★ROI（可选）：裁掉设备 chrome（状态栏时钟/Home 条）——先对齐再裁（ROI 按对齐后尺寸计）
  //   ★顺序（实测定的）：尺寸对齐 → ROI → 平移对齐。平移在 **ROI 内**搜索——
  //     否则状态栏时钟等 chrome 差异会污染搜索（它们不参与观测，也不应影响拟合）。
  const roiOffset = { x: 0, y: 0 }
  if (opts.roi) {
    a = cropImage(a, opts.roi)
    b = cropImage(b, opts.roi)
    roiOffset.x = opts.roi.x
    roiOffset.y = opts.roi.y
  }
  // ★平移对齐（可选）：求最优整数平移，并把 **B 的移位采样版写回 b**——
  //   这样后续逐像素/分块/哈希/字节相等**全部自动走对齐后口径**（一处变换，全链一致）。
  //   `diffPixels`/`diffPixelsRaw` 由 `alignTranslation` 在**同一窗口**（四边各让开 max 像素）内算好；
  //   下方主循环用同一窗口 ⇒ 报告里的 diffPixels 与拟合最优值**逐位相等**（口径一致，两个数不打架）。
  let translation: TranslationFit | undefined
  if (opts.alignTranslation) {
    const max = typeof opts.alignTranslation === 'number' ? opts.alignTranslation : 4
    translation = alignTranslation(a, b, { max, channelThreshold })
    const winW = a.width - 2 * max
    const winH = a.height - 2 * max
    if (winW <= 0 || winH <= 0) throw new Error(`alignTranslation: 半径 ${max} 大于图尺寸 ${a.width}x${a.height}`)
    const winA: RgbaImage = { width: winW, height: winH, rgba: new Uint8Array(winW * winH * 4) }
    const winB: RgbaImage = { width: winW, height: winH, rgba: new Uint8Array(winW * winH * 4) }
    for (let y = 0; y < winH; y++) {
      for (let x = 0; x < winW; x++) {
        const src = ((y + max) * a.width + (x + max)) * 4
        const dst = (y * winW + x) * 4
        winA.rgba.set(a.rgba.subarray(src, src + 4), dst)
        const ssrc = ((y + max - translation.dy) * b.width + (x + max - translation.dx)) * 4
        winB.rgba.set(b.rgba.subarray(ssrc, ssrc + 4), dst)
      }
    }
    a = winA
    b = winB
    roiOffset.x += max
    roiOffset.y += max
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
  // ★坐标回到**原图口径**（+ROI 偏移）——报告消费方看的是整屏截图坐标，不是裁剪后坐标
  const regions: PixelDiffRegion[] = []
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const n = blockCounts[by * blocksX + bx]!
      if (n === 0) continue
      const w = Math.min(blockSize, a.width - bx * blockSize)
      const h = Math.min(blockSize, a.height - by * blockSize)
      const ratio = n / (w * h)
      if (ratio >= 0.1 || n >= 100) {
        regions.push({ x: bx * blockSize + roiOffset.x, y: by * blockSize + roiOffset.y, w, h, pixels: n, ratio: Math.round(ratio * 1000) / 1000 })
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
    ...(opts.roi ? { roi: opts.roi } : {}),
    ...(translation ? { translation } : {}),
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

/** 单端截图的锚定归一记录（诊断用——报告里能看出"每端是怎么归到统一坐标系的"） */
export interface EndNormRecord {
  /** 源截图尺寸（归一**前**——各端 DPR/分辨率差异的原始证据） */
  srcSize: { width: number; height: number }
  /** PNG 内嵌色彩空间（'undeclared' = 未声明；'display-p3' 已在比较前转 sRGB） */
  colorSpace: string
  /** 源图中实测的锚块 bbox */
  block: { x: number; y: number; w: number; h: number }
  /** 缩放系数（归一输出 / 源像素） */
  scale: number
}

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
    /**
     * ★配对形态（L4 真截图用）：`same-runtime` = 同运行时长跑（小程序双渲染器）；
     *   `cross-runtime` = 跨运行时（浏览器/Android/iOS ⇄ 小程序）。
     *   为什么必须标注：两种形态的残差**天然不可比**（跨运行时多一个坐标系对齐残差 + 字形光栅化差异），
     *   混在一起读会把"跨运行时本来就更大"误读成"某端画坏了"。
     */
    mode?: 'same-runtime' | 'cross-runtime'
    /** 锚定归一记录（两端的源尺寸/色彩空间/锚块/缩放系数——"怎么归到统一坐标系"的可复现证据） */
    norm?: { a: EndNormRecord; b: EndNormRecord; outSize: { width: number; height: number } }
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
  pairs: Array<{
    id: string
    a: string
    b: string
    observation: PixelObservation
    knownNoise?: PixelNoiseEntry
    mode?: 'same-runtime' | 'cross-runtime'
    norm?: { a: EndNormRecord; b: EndNormRecord; outSize: { width: number; height: number } }
  }>,
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
