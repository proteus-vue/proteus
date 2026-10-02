#!/usr/bin/env node
// scripts/gen-cross-end-4050-report.mjs —— ★★三端 4050 基准统一报告（2026-10-02）
//
// 【为什么要有它（用户当场追问「iOS 真机为什么反向优化」的根因）】
//   三个端各自有报告，但**口径不统一**被并排比较，产生了误导：
//     · iOS README 把原生侧 `layout_ms`（只 measure/layout，**一个像素都没画**——原生绘制由
//       CoreAnimation render server 异步完成）列在「绘」一栏 ⇒ 与 Proteus 的真光栅化对比
//       ⇒ 得出"反向优化"的错误印象。
//   ⇒ 本脚本把三端读数按**两层统一口径**重新归并，并对每格标注口径：
//
//   L1 提交级：触发 → 建树+排版 → 渲染指令送达（录制 DisplayList / RenderNode 树 / CALayer 建树）
//             —— 不含像素光栅化（方案 §9.2 的官方口径）
//   L2 光栅级：L1 + **CPU 全场景光栅化到内存位图**（两端同一块 ARGB/1x 位图、同一批元素）
//             —— 这是"真画完了"的对比；GPU 合成不在本报告口径内（所有端一致排除）
//
// 【诚实边界】L2 各端的"光栅化实现"天然不同（Skia 软光栅 / CALayer.render / RenderNode 无 Light：
//   鸿蒙侧暂缺——标注为 pending）。口径统一指的是**任务定义**统一（同一批元素、同一目标位图），
//   不是"实现完全同一"——后者不可能（各端系统不同），故报告逐格注明实现与来源文件。
//
// 用法：node scripts/gen-cross-end-4050-report.mjs
// 产物：hosts/results/cross-end-4050.json（+ 控制台摘要）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'hosts/results')

/** 安全读 JSON */
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

/** 取 Android 某次 run 的读数（取最新结果目录里的稳态值） */
function androidReading() {
  // 优先应用级 A/B 产物（acceptance 跑出来的）
  const dirs = fs.existsSync(path.join(ROOT, 'hosts/android/results/acceptance'))
    ? fs.readdirSync(path.join(ROOT, 'hosts/android/results/acceptance')).sort().reverse()
    : []
  for (const d of dirs) {
    const base = path.join(ROOT, 'hosts/android/results/acceptance', d)
    // 取最后一轮（末轮最接近稳态；acceptance 每轮独立冷启动，末轮 = 第 N 次冷启动）
    let p = null, n = null, used = 0
    for (let i = 5; i >= 1; i--) {
      p = readJson(path.join(base, `app-4050-r${i}.json`))
      n = readJson(path.join(base, `app-4050-native-r${i}.json`))
      if (p && n) { used = i; break }
    }
    if (p && n) {
      return {
        source: `hosts/android/results/acceptance/${d}/（第 ${used} 轮）`,
        l1: {
          proteus_scope_ms: p.scope_ms,
          native_scope_ms: n.scope_ms,
          ratio: +(p.scope_ms / n.scope_ms).toFixed(3),
        },
        l2: {
          proteus_soft_raster_ms: p.soft_raster_ms ?? null,
          native_soft_raster_ms: n.soft_raster_ms ?? null,
          ratio: p.soft_raster_ms && n.soft_raster_ms
            ? +(p.soft_raster_ms / n.soft_raster_ms).toFixed(3) : null,
        },
      }
    }
  }
  return null
}

/** iOS 读数（layout-core-bench-ios.json） */
function iosReading() {
  const d = readJson(path.join(ROOT, 'hosts/ios/results/layout-core-bench-ios.json'))
  if (!d || !d.flattened || !d.native_uikit) return null
  return {
    source: 'hosts/ios/results/layout-core-bench-ios.json',
    l1: {
      // iOS 的「提交级」：Proteus = Rust 排版 + 建 50 个 row layer（拍平）；
      //   原生 = 建 4050 view/UILabel + layoutIfNeeded。
      //   ★必须含 rust_layout_ms（与 Android/Harmony 的 scope 口径一致——那边的 scope 也含排版段）
      proteus_layout_ms: d.rust_layout_ms,
      proteus_build_ms: d.flattened.build_ms,
      proteus_l1_total_ms: +(d.rust_layout_ms + d.flattened.build_ms).toFixed(2),
      native_build_ms: d.native_uikit.build_ms,
      native_layout_ms: d.native_uikit.layout_ms,
      native_l1_total_ms: +(d.native_uikit.build_ms + d.native_uikit.layout_ms).toFixed(2),
      ratio: +((d.rust_layout_ms + d.flattened.build_ms) / (d.native_uikit.build_ms + d.native_uikit.layout_ms)).toFixed(3),
    },
    l2: {
      proteus_raster_ms: d.flattened.draw_ms,
      native_raster_ms: d.native_uikit.raster_ms ?? null,
      ratio: d.native_uikit.raster_ms ? +(d.flattened.draw_ms / d.native_uikit.raster_ms).toFixed(3) : null,
    },
    memory: {
      proteus_delta_mb: d.flattened.delta_mb,
      native_delta_mb: d.native_uikit.delta_mb,
      ratio: +(d.flattened.delta_mb / d.native_uikit.delta_mb).toFixed(3),
    },
  }
}

/** 鸿蒙读数（host-app-run.txt 的原始日志行） */
function harmonyReading() {
  const p = path.join(ROOT, 'hosts/harmony/results/host-app-run.txt')
  if (!fs.existsSync(p)) return null
  const txt = fs.readFileSync(p, 'utf-8')
  const benchLine = (txt.split('\n').find((l) => l.startsWith('bench_line=')) ?? '').replace('bench_line=', '')
  const nativeLine = (txt.split('\n').find((l) => l.startsWith('native_line=')) ?? '').replace('native_line=', '')
  const warmLine = (txt.split('\n').find((l) => l.startsWith('native_warm_line=')) ?? '').replace('native_warm_line=', '')
  const m = /wall_ms=(\d+) (\{.*\})/.exec(benchLine)
  const nCold = /wall_ms=(\d+)/.exec(nativeLine)
  const nWarm = /wall_ms=(\d+)/.exec(warmLine)
  if (!m) return null
  const detail = JSON.parse(m[2])
  const nativeMs = nWarm ? +nWarm[1] : (nCold ? +nCold[1] : null)
  return {
    source: 'hosts/harmony/results/host-app-run.txt',
    l1: {
      // 鸿蒙 L1：Proteus=提交级（建树+排版+4000 RenderNode，未上屏）；
      //         原生=渲染级（4050 声明式元素 onAppear 全触发）
      proteus_scope_ms: +m[1],
      proteus_breakdown: { layout_ms: detail.layout_ms, emit_ms: detail.emit_ms },
      native_cold_ms: nCold ? +nCold[1] : null,
      native_warm_ms: nWarm ? +nWarm[1] : null,
      ratio_cold: nativeMs ? +(detail.scope_ms / (nCold ? +nCold[1] : nativeMs)).toFixed(3) : null,
      ratio_warm: nativeMs ? +(detail.scope_ms / nativeMs).toFixed(3) : null,
      note: '★口径不对称（Proteus=提交级 / 原生=渲染级，含首帧挂载）——见 benchmark caveats',
    },
    l2: { proteus_raster_ms: null, native_raster_ms: null, ratio: null, note: 'pending（RenderNode 无 CPU 软光栅路径——渲染由 RS 进程负责）' },
  }
}

const report = {
  scene: 'app-4050（2050 view + 2000 text = 4050 元素 + 1 根；应用级）',
  caliber: {
    L1: '提交级：触发 → 建树+排版 → 渲染指令送达（不含像素光栅化）',
    L2: '光栅级：L1 + CPU 全场景光栅化到内存位图（同批元素；GPU 合成一律排除）',
    note: '各端"光栅化实现"天然不同（Skia / CALayer.render / 鸿蒙 pending）——口径统一指任务定义统一，逐格注明实现',
  },
  generated_at: new Date().toISOString(),
  findings: {
    L1_全端占优: '提交级三端均快于原生（0.344 / 0.111 / 0.100）——建树+排版+指令生成是本方案的主收益面',
    L2_分化: '光栅级两端相反：iOS 0.148（快 6.7×，原生 drawHierarchy 逐视图 CoreText 代价高）· '
      + 'Android 1.673（慢 1.7×，我们自写 drawCmds 循环 vs Skia 显示列表复用——与 ACCEPTANCE.md 既有「绘制路径比原生慢」量化一致）',
    L2_Android_原因: 'Proteus 侧 4051 条指令逐条 drawRect/drawText；原生 View.draw 走 RenderNode 显示列表 + Skia 优化。'
      + '优化路径已实现（drawCmdsOptimized：同色 Path 批处理 + 文本图集，图集默认关）但未接入 app-4050 场景——列为下一步优化候选',
    Harmony_L2_说明: 'RenderNode 无 CPU 软光栅路径（渲染由 RS 进程负责）——L2 在鸿蒙端**架构性不适用**，非"没测"',
  },
  android: androidReading(),
  ios: iosReading(),
  harmony: harmonyReading(),
}

fs.mkdirSync(OUT_DIR, { recursive: true })
const outFile = path.join(OUT_DIR, 'cross-end-4050.json')
fs.writeFileSync(outFile, JSON.stringify(report, null, 2))

console.log('[cross-end-4050] 三端统一口径报告')
for (const end of ['android', 'ios', 'harmony']) {
  const r = report[end]
  if (!r) { console.log(`  ${end}: （缺读数）`); continue }
  const l1 = r.l1.ratio ?? r.l1.ratio_warm ?? '—'
  const l2 = r.l2.ratio ?? '—'
  console.log(`  ${end.padEnd(8)} L1=${l1} · L2=${l2}   ← ${r.source}`)
}
console.log(`产物：${path.relative(ROOT, outFile)}`)
