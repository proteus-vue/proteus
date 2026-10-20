#!/usr/bin/env node
// scripts/glass-weave-metric.mjs —— ★★★玻璃**织纹（weave）**判据：捕获降采样是否引入周期性伪影
//
// 【为什么需要（决策 #1013 / #1105 / #1111 的串联）】
//   · Android #1013 的真实事故：DIV=2（/2 降采样 → shader 放大）时，蓝色笔画周围出现
//     **网格状插值织纹**（周期 ≈5-6px 斜向条纹），用户肉眼描述「获取的映射感觉有点儿脏」，
//     最终 Android 把 DIV 从 2 改回 **1（全分辨率）**。
//   · iOS #1105 想靠降密度省 25%，但当时的画质判据只有「逐点最大通道差」——
//     ★**它结构上测不出织纹**（周期性小偏差会被逐点差平均掉）。⇒ 默认值保持 2，机会留在桌上。
//   · 本脚本补上那个缺的判据：**空间自相关**（与 #1013 定位织纹用的是同一方法）。
//
// 【判据原理】
//   织纹 = **周期性**结构。做法：
//     ① 取区域内亮度，减 3×3 均值得到**高通残差**（去掉缓变明暗，只留细节/伪影）；
//     ② 对残差做**归一化自相关** r(L) = Σ(r_i·r_{i+L}) / sqrt(Σr_i²·Σr_{i+L}²)；
//     ③ 看 **lag ≥ 2** 的峰值：平滑内容 ⇒ 近 0；周期性织纹 ⇒ 在织纹周期处出现明显峰。
//   ★为什么 lag 从 2 起算：lag=1 是任何平滑图的自然相关（相邻像素本来就相似），不构成伪影证据。
//
// 【★能力边界（必须说清）】
//   本判据只能回答「区域内是否存在**周期性**结构」，**不能**判定"这个周期性就是坏观感"——
//   后者是人眼/参照对比的事。它的用途是**横向对比**（同一屏、同一区域、不同降采样密度，
//   看织纹分数是否显著上升），而不是给单张图下"画质合格"的结论。
//
// 用法：
//   node scripts/glass-weave-metric.mjs <png> [--region x,y,w,h] [--json] [--verbose]
//   node scripts/glass-weave-metric.mjs a.png b.png --region ...   # 多图对比（打印差值）
// 退出码：0 成功 / 2 参数或解码错误
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

/* ────────────────────────── 纯函数（可单测） ────────────────────────── */

/**
 * RGBA → 亮度数组（Rec.601，与业界灰度口径一致）
 * @param {Uint8Array} rgba
 * @param {number} w
 * @param {number} h
 * @returns {Float64Array}
 */
export function luminance(rgba, w, h) {
  const out = new Float64Array(w * h)
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]
  }
  return out
}

/**
 * 3×3 均值高通残差（可分离：先横向再纵向，O(n)）
 * @param {Float64Array} lum
 */
export function highPass(lum, w, h) {
  const tmp = new Float64Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const a = lum[x > 0 ? i - 1 : i]
      const c = lum[x < w - 1 ? i + 1 : i]
      tmp[i] = (a + lum[i] + c) / 3
    }
  }
  const out = new Float64Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const a = tmp[y > 0 ? i - w : i]
      const c = tmp[y < h - 1 ? i + w : i]
      out[i] = lum[i] - (a + tmp[i] + c) / 3
    }
  }
  return out
}

/**
 * 归一化自相关（沿方向 dir），返回 lags[0..maxLag]（lags[0] 恒 1）
 * @param {Float64Array} res 高通残差（整幅，含 padding 为 0）
 * @param {number} w
 * @param {number} h
 * @param {{x:number,y:number,w:number,h:number}} r 分析区域
 * @param {'h'|'v'|'d1'|'d2'} dir
 * @param {number} maxLag
 * @returns {number[]}
 */
export function autocorr(res, w, h, r, dir, maxLag = 16) {
  const step = dir === 'h' ? 1 : dir === 'v' ? w : dir === 'd1' ? w + 1 : w - 1
  const x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h
  const out = [1]
  for (let L = 1; L <= maxLag; L++) {
    let num = 0, da = 0, db = 0
    let n = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        // 端点检查（避免跨行/跨区）
        if (dir === 'h' && x + L >= x1) continue
        if (dir === 'v' && y + L >= y1) continue
        if ((dir === 'd1' || dir === 'd2') && (y + L >= y1 || x + L >= x1 || x - L < x0)) continue
        const a = res[y * w + x]
        const b = res[y * w + x + step * L]
        num += a * b
        da += a * a
        db += b * b
        n++
      }
    }
    out.push(n > 0 && da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0)
  }
  return out
}

/**
 * 织纹分数：lag ≥ minLag 的最大自相关（取四方向最大）
 * @returns {{score:number, lag:number, dir:string, perDir:Record<string, number[]>}}
 */
export function weaveScore(res, w, h, region, opts = {}) {
  const maxLag = opts.maxLag ?? 16
  const minLag = opts.minLag ?? 2
  const perDir = {}
  let best = { score: -1, lag: 0, dir: '' }
  for (const dir of ['h', 'v', 'd1', 'd2']) {
    const ac = autocorr(res, w, h, region, dir, maxLag)
    perDir[dir] = ac
    for (let L = minLag; L <= maxLag; L++) {
      if (ac[L] > best.score) best = { score: ac[L], lag: L, dir }
    }
  }
  return { ...best, perDir }
}

/* ────────────────────────── PNG 解码（内置 zlib，零依赖） ────────────────────────── */

/**
 * 最小 PNG 解码器：8-bit、非隔行、colorType 0/2/6（灰度 / RGB / RGBA）。
 * ★为什么自己写而不依赖 pngjs：pngjs 在本仓只是**传递依赖**（.pnpm 里未提升到根），
 *   直接 require 会 `MODULE_NOT_FOUND`；而截图解码只需要这么点能力 ⇒ 内置实现更稳
 *   （与「判据工具不应被别的包的依赖变动搞坏」同纪律）。
 * @returns {{w:number,h:number,rgba:Uint8Array}}
 */
export function decodePng(file) {
  const zlib = require('node:zlib')
  const buf = fs.readFileSync(file)
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10]
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error(`${file}: 不是 PNG`)
  let pos = 8
  let w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      bitDepth = data[8]; colorType = data[9]; interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8) throw new Error(`${file}: 只支持 8-bit（实际 ${bitDepth}）`)
  if (interlace !== 0) throw new Error(`${file}: 不支持隔行扫描`)
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0
  if (!ch) throw new Error(`${file}: 不支持的 colorType=${colorType}`)

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const out = new Uint8Array(w * h * 4)
  let prev = new Uint8Array(stride)
  for (let y = 0, p = 0; y < h; y++) {
    const f = raw[p++]
    const line = Uint8Array.prototype.slice.call(raw, p, p + stride)
    p += stride
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0
      const b = prev[x]
      const c = x >= ch ? prev[x - ch] : 0
      let v = line[x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[x] = v & 0xff
    }
    // 展开到 RGBA
    for (let x = 0; x < w; x++, p === p) {
      const o = (y * w + x) * 4
      const s = x * ch
      if (ch === 4) { out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = line[s + 3] }
      else if (ch === 3) { out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = 255 }
      else { out[o] = out[o + 1] = out[o + 2] = line[s]; out[o + 3] = 255 }
    }
    prev = line
  }
  return { w, h, rgba: out }
}

/* ────────────────────────── CLI ────────────────────────── */

function parseArgs(argv) {
  const files = []
  let region = null
  let json = false
  let verbose = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--region') {
      const p = (argv[++i] ?? '').split(',').map(Number)
      if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) {
        console.error('✗ --region 需 x,y,w,h 四个数字')
        process.exit(2)
      }
      region = { x: p[0], y: p[1], w: p[2], h: p[3] }
    } else if (a === '--json') json = true
    else if (a === '--verbose') verbose = true
    else if (!a.startsWith('--')) files.push(a)
  }
  return { files, region, json, verbose }
}

function analyze(file, region) {
  const { w, h, rgba } = decodePng(file)
  const lum = luminance(rgba, w, h)
  const res = highPass(lum, w, h)
  const reg = region ?? { x: 0, y: 0, w, h }
  if (reg.x < 0 || reg.y < 0 || reg.x + reg.w > w || reg.y + reg.h > h) {
    console.error(`✗ region 越界：图 ${w}×${h}，region ${JSON.stringify(reg)}`)
    process.exit(2)
  }
  const r = weaveScore(res, w, h, reg)
  return { file, w, h, region: reg, ...r }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const { files, region, json, verbose } = parseArgs(process.argv.slice(2))
  if (files.length === 0) {
    console.error('用法：node scripts/glass-weave-metric.mjs <png...> [--region x,y,w,h] [--json]')
    process.exit(2)
  }
  const results = files.map((f) => analyze(f, region))
  if (json) {
    console.log(JSON.stringify(results.map((r) => ({
      file: path.basename(r.file), region: r.region, score: +r.score.toFixed(4), lag: r.lag, dir: r.dir,
    })), null, 2))
  } else {
    console.log('[glass-weave-metric] 织纹判据（lag≥2 的归一化自相关峰值；越低越干净）')
    for (const r of results) {
      const tag = r.score < 0.2 ? '✅ 干净' : r.score < 0.4 ? '⚠️ 轻微' : '❌ 明显'
      console.log(
        `  ${tag}  ${path.basename(r.file)}  分数 ${r.score.toFixed(4)} @lag=${r.lag}(${r.dir})` +
          `  区域 ${r.region.w}×${r.region.h} @${r.region.x},${r.region.y}`,
      )
      if (verbose) {
        for (const [d, ac] of Object.entries(r.perDir)) {
          console.log(`      ${d}: ${ac.slice(1, 13).map((v) => v.toFixed(2)).join(' ')}`)
        }
      }
    }
    if (results.length > 1) {
      const base = results[0]
      console.log('\n  相对首张的差值（正 = 织纹更强）：')
      for (const r of results.slice(1)) {
        const d = r.score - base.score
        console.log(`    ${path.basename(r.file)}  Δ=${d >= 0 ? '+' : ''}${d.toFixed(4)}`)
      }
    }
    console.log(
      '\n  ★能力边界：本判据只回答「区域内是否存在周期性结构」，不判「观感是否合格」；' +
        '\n    用途是**同屏同区域横向对比**（不同降采样密度），不是单张图的画质结论。',
    )
  }
}
