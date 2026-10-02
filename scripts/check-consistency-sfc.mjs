#!/usr/bin/env node
// scripts/check-consistency-sfc.mjs —— ★★★**SFC 压力夹具**的多端一致性报告（2026-10-02）
//
// 【与 check-consistency-pixel.mjs 的分工（两份报告，两种夹具）】
//   · `-pixel`：**四元素手写夹具**（L4）——六端各自手写同一声明，观测**系统光栅化**差异
//     （圆角 AA / 阴影合成 / 渐变 / 字形——L1–L3 够不到的四项）。
//   · `-sfc`（本脚本）：**真 SFC**（examples/pages/consistency-stress.vue）——**一份源码**经
//     三条编译/实例化链渲染（Web/MP 走 Proteus 编译器；iOS/Android 走 Vapor 产物），
//     观测**语义渲染一致性**（布局/尺寸/内容——44 节点 + 10 行 v-for + 行内动态绑定）。
//   ⇒ 两份报告证明的是**两件事**，都需要（前者证明"系统管线近似"，后者证明"一份源码一致"）。
//
// 【归一公式（来自夹具自身声明——不是猜）】stress SFC 根声明 375×800、锚点在 (16,60) 80×48
//   ⇒ 锚定归一的目标：outSize = 375×800（**SFC 的逻辑尺寸**）、blockTarget = (16,60) w=80。
//   各端截图（640×1386 / 780×1688 / 1200×2608 / 1206×2622）由其锚块**定标 + 定位**到同一坐标系。
//
// 【非门禁】与 L4 同款：观测结论不阻断（`gate:false`）；差异率超噪声带 ⇒ 报告 + 需人工判断。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  pixelObservation, buildPixelReport, decodePng, encodePng, anchorNormalize, convertToSrgb, cropImage,
} from '../packages/consistency/dist/index.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SAMPLES = path.join(ROOT, 'docs/generated/consistency-samples/sfc')
const OUT = path.join(ROOT, 'docs/generated/consistency-sfc-report.json')
const CHECK = process.argv.includes('--check')

/** SFC 夹具的归一目标（锚定坐标系仍是设计宽 375×800；锚块在 (16,60)）
 *  ★注意：2026-10-02 流式改造后，**内容宽随屏宽**（行宽 = 屏宽 − 32，左右留白恒 16）——
 *  归一输出的 375 宽窗口在窄屏端覆盖不到行盒右缘、宽屏端会把行盒右侧裁掉：
 *  该"流式右带"**跨端天然不同（设计意图）**，不入像素比较（见 SFC_NORM_ROI）。 */
const SFC_ANCHOR_SPEC = { probe: [47, 111, 237], outSize: { w: 375, h: 800 }, blockTarget: { x: 16, y: 60, w: 80 } }
/** 归一后的观测窗口（锚块顶部起，含 10 行全部内容；避开四周设备 chrome）。
 *  ★右界 340（不是 375）：流式内容宽 = 屏宽 − 32，各端不同（web 358 / MP ~361 / Android 368 /
 *  iOS 370）——所有**固定几何**元素（锚块 / chip ≤ 88+10 / 文本 / 蓝点，最远 ~284）都在
 *  340 以内；[340,375] 只剩行盒右缘与圆角（位置随屏宽 ⇒ 跨端比较无意义，由 gaps 指标单列）。
 *  ⇒ ROI 内是"一份源码里确定会被跨端复现的几何"；流式带则验证"留白恒定"这条设计意图。
 *  ★左界 10（不是 0）——**2026-10-02 独立审计抓出的设备 chrome 污染**（夹具内容都从 x≥16 起，
 *  左 0–10 是纯画布区，排除零损失）：
 *   · Android 真机：左侧一条系统悬浮竖条（实测 x6.0–9.0 · y193–259，圆头灰条 (208,208,209)，
 *     疑为侧边面板手柄；**旧截图逐字节同存** ⇒ 存量设备 chrome，非夹具/非本轮引入）；
 *   · MP 模拟器：自身 1px 左缘框线（x=0，色 39,39,44）。
 *  二者若在窗口内会稳定污染 diff（每次采集都差同样几百像素）。 */
const SFC_NORM_ROI = { x: 10, y: 56, w: 330, h: 744 }

/** 端显示名（报告用） */
const END_LABEL = {
  'mp.skyline': '微信 Skyline（编译产物）',
  web: '浏览器 Web（编译产物）',
  android: 'Android 真机（Vapor）',
  ios: 'iOS 模拟器（Vapor）',
  'ios-device': 'iOS 真机（Vapor）',
}

/**
 * 屏幕边缘留白（gaps）——直接量化「内容距屏幕左右边缘的间距」（设计单位）。
 *
 * 【为什么单列（用户 2026-10-02 目视发现的问题）】流式改造前：根定宽 375、左对齐 ⇒
 *   左留白恒 16、右留白 = 屏宽 − 359（实测 web 31 / MP 31.4 / Android 41 / iOS 43）——
 *   **留白随屏宽漂移**。流式改造后：左右各 16 恒定。本函数从**原始截图**量这件事
 *   （不依赖归一窗口——窗口只 375 宽，窄屏端的右留白落在窗口外量不到）。
 *
 * 量法：行盒底色（#1b1b21）逐行的**最长横段** = 行宽；两级过滤（minRun + maxRun×0.6）
 *   与 anchorNormalize 同款（滤掉圆角端点/边缘伪影），再取所有行段的 min-left / max-right。
 *   winX = 设计 0 在源图的物理 x（anchorNormalize 的 srcWindow.x）；scale = 输出 px / 源 px。
 */
function measureEdgeGaps(img, winX, scale) {
  const [tr, tg, tb] = [27, 27, 33]
  const tol = 5
  const match = (i) =>
    Math.abs(img.rgba[i] - tr) <= tol && Math.abs(img.rgba[i + 1] - tg) <= tol && Math.abs(img.rgba[i + 2] - tb) <= tol
  const segs = []
  for (let y = 0; y < img.height; y++) {
    let run = 0
    for (let x = 0; x <= img.width; x++) {
      const hit = x < img.width && match((y * img.width + x) * 4)
      if (hit) { run++; continue }
      if (run >= 10) segs.push({ x0: x - run, x1: x - 1, len: run })
      run = 0
    }
  }
  if (segs.length === 0) return null
  const maxRun = Math.max(...segs.map((s) => s.len))
  let left = Number.POSITIVE_INFINITY
  let right = -1
  for (const s of segs) {
    if (s.len < maxRun * 0.6) continue
    if (s.x0 < left) left = s.x0
    if (s.x1 > right) right = s.x1
  }
  if (!Number.isFinite(left) || right < 0) return null
  const d = (v) => Math.round(v * 10) / 10
  return {
    left: d((left - winX) * scale),
    right: d((img.width - (right + 1)) * scale),
    rowW: d((right - left + 1) * scale),
    screenW: d((img.width - winX) * scale),
  }
}

async function main() {
  if (!fs.existsSync(SAMPLES)) {
    console.error(`[sfc] ✗ 缺样本目录：${path.relative(ROOT, SAMPLES)}（先跑五个采集脚本：web / mp / android / ios-sim / ios-device）`)
    process.exit(2)
  }
  const files = fs.readdirSync(SAMPLES)
    .filter((f) => f.startsWith('sfc.') && f.endsWith('.png')
      // ★排除派生文件（本仓实测：`sfc.ios.snapshot.png` 是 App 内渲染自存的**补充证据**，
      //   不是独立端——误收会变成"ios 出现两次"的重复配对）
      && !f.includes('.tmp.') && !f.includes('.snapshot.'))
    .sort()
  if (files.length < 2) {
    console.error(`[sfc] ✗ 样本不足（${files.length} 个）——SFC 报告需要 ≥2 端`)
    process.exit(2)
  }
  const ends = []
  for (const f of files) {
    // 命名：sfc.<end>.png（end 可含点，如 mp.skyline）
    const end = f.replace(/^sfc\./, '').replace(/\.png$/, '').replace(/\.snapshot$/, '')
    const raw = await decodePng(new Uint8Array(fs.readFileSync(path.join(SAMPLES, f))))
    const srgb = convertToSrgb(raw)
    try {
      const r = anchorNormalize(srgb, SFC_ANCHOR_SPEC)
      ends.push({
        end, file: f, img: cropImage(r.img, SFC_NORM_ROI),
        gaps: measureEdgeGaps(srgb, r.srcWindow.x, r.scale),
        norm: {
          srcSize: { width: raw.width, height: raw.height },
          colorSpace: raw.colorSpace ?? 'undeclared',
          block: r.block,
          // ★亚像素边缘（定标真实来源——见 pixel.ts 的 refineEdges；整数 bbox 对分数倍率端
          //   有 0.9% 级误差，会把整幅拉伸成假差异）
          edges: {
            l: Math.round(r.edges.l * 1000) / 1000,
            t: Math.round(r.edges.t * 1000) / 1000,
            r: Math.round(r.edges.r * 1000) / 1000,
            b: Math.round(r.edges.b * 1000) / 1000,
          },
          scale: Math.round(r.scale * 1000000) / 1000000,
        },
      })
    } catch (e) {
      console.error(`[sfc] ✗ ${f} 锚定归一失败：${e.message}（该端不参与比较——如实报出，不静默跳过）`)
      ends.push({ end, file: f, error: String(e.message) })
    }
  }
  const ok = ends.filter((e) => e.img)
  const pairs = []
  for (let i = 0; i < ok.length; i++) {
    for (let j = i + 1; j < ok.length; j++) {
      const A = ok[i]
      const B = ok[j]
      const mp = new Set(['mp.skyline', 'mp.webview'])
      const iosFam = new Set(['ios', 'ios-device'])
      const mode = mp.has(A.end) && mp.has(B.end)
        ? 'same-runtime'
        : iosFam.has(A.end) && iosFam.has(B.end)
          ? 'same-platform'
          : 'cross-runtime'
      pairs.push({
        id: `sfc:${A.end}-vs-${B.end}`,
        a: path.relative(ROOT, path.join(SAMPLES, A.file)),
        b: path.relative(ROOT, path.join(SAMPLES, B.file)),
        mode,
        norm: { a: A.norm, b: B.norm, outSize: SFC_ANCHOR_SPEC.outSize },
        observation: pixelObservation(A.img, B.img),
      })
    }
  }
  const report = buildPixelReport(pairs)
  // 端清单（报告头部列出——含失败端，如实）
  const withEnds = {
    ...report,
    note: report.note + '｜★SFC 压力夹具（一份源码三链渲染）：examples/pages/consistency-stress.vue'
      + '｜宽流式（width:100% + 左右 padding 16）⇒ 边缘留白恒 16、内容随屏宽（见每端 gaps）',
    source: 'examples/pages/consistency-stress.vue（真 SFC：44 节点 · 10 行 v-for · 行内动态绑定）',
    ends: ends.map((e) => ({
      end: e.end,
      label: END_LABEL[e.end] ?? e.end,
      file: e.file,
      ...(e.gaps ? { gaps: e.gaps } : {}),
      ...(e.norm ? { norm: e.norm } : { error: e.error }),
    })),
  }
  const json = JSON.stringify(withEnds, null, 2) + '\n'

  if (CHECK) {
    const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : ''
    const same = prev === json
    console.log(`  consistency-sfc --check → docs/generated/consistency-sfc-report.json${same ? ' ✅ 一致' : ' ❌ 漂移'}`)
    console.log(
      `  ▸ SFC ${ok.length} 端 / ${pairs.length} 对：changed ${report.totals.changedSamples} · clean ${report.totals.cleanSamples}`,
    )
    for (const e of ends) {
      if (e.gaps) console.log(`  ▸ ${e.end.padEnd(11)} 屏宽 ${e.gaps.screenW} · 留白 左 ${e.gaps.left} / 右 ${e.gaps.right} · 行宽 ${e.gaps.rowW}`)
    }
    console.log('  ★SFC 观测非门禁：结论不影响退出码（仅报告）')
    if (!same) process.exit(1)
    console.log('✅ SFC 一致性报告与基线一致（非门禁）')
    return
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, json)

  console.log(`[consistency-sfc] ✅ ${path.relative(ROOT, OUT)}（**非门禁** SFC 观测报告）`)
  console.log(`  SFC 端（${ok.length}）：${ok.map((e) => e.end).join(' · ')}`)
  for (const p of pairs) {
    const o = p.observation
    const l = p.mode === 'same-runtime' ? '同运行时' : p.mode === 'same-platform' ? '真机⇄模拟器' : '跨运行时'
    console.log(`  ${l.padEnd(11)} ${p.id.replace('sfc:', '').padEnd(28)} ${(o.diffRatio * 100).toFixed(2)}% hash=${o.hashDistance}`)
  }
}

main().catch((e) => {
  console.error('[consistency-sfc] ✗', e?.message ?? e)
  process.exit(2)
})
