#!/usr/bin/env node
// scripts/check-anim-record-bytes.mjs —— ★每帧动画记录的**线格式宽度**单一事实源门禁（2026-10-01）
//
// 【为什么要这道门禁（本仓真实教训）】每帧更新记录是**定长二进制**（`id u32 + 五值 f32 + bg u32 + textColor u32`），
//   由内核生产、**5 处消费**（iOS 宿主 / Android 宿主 / Android SDK / embed-demo / JNI 注释）。
//   它已经出过一次事故：RT2 把 16B 扩到 24B 时**只改了一处**，探针路径按 `i*16` 错位解析，
//   真机上层留下错位残值（`end ty=-0.18`）。⇒ 这是"**接线不靠记忆**"的又一次应用：
//   把"内核产出的宽度"与"每个消费者的常量"做成机器判据。
//
// 【判据】从内核 `ffi.rs::proteus_layout_anim_tick_bin` 的 `extend_from_slice` 计数推出宽度
//   （= 4 + 4×5 + 4 + 4 = 32B），再要求每个消费端声明同一个数。任一处不一致 ⇒ 红并点名。
//
// 【为什么不硬编码 32】硬编码的话，下次扩字段时门禁本身也要人记得改——那就没消除"靠记忆"。
//   宽度**从内核推出**（唯一事实源），门禁只做比对。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KERNEL = path.join(ROOT, 'packages/layout-core-rust/src/ffi.rs')

/** 从内核 tick_bin 的字节写入推出记录宽度 */
function kernelRecordBytes() {
  const src = fs.readFileSync(KERNEL, 'utf8')
  const start = src.indexOf('fn proteus_layout_anim_tick_bin')
  if (start < 0) return { error: '找不到 proteus_layout_anim_tick_bin（函数被改名/移动？）' }
  // ★切片边界：从**函数体开始**到**调用序列结束**——用"`let mut buf` 起 → `Ok(buf)` 止"，
  //   而不是"到下一个 `#[no_mangle]`"（首版这么写时，函数**内部**的 `unsafe` 块与注释里
  //   出现的 `#[no_mangle]` 文本让切片退化成空 ⇒ 解析恒失败；本仓纪律：解析器要对着**实际形态**写）。
  const bodyStart = src.indexOf('let mut buf = Vec::with_capacity', start)
  if (bodyStart < 0) return { error: '未找到 `let mut buf = Vec::with_capacity`（写入序列被重构？）' }
  const bodyEnd = src.indexOf('Ok(buf)', bodyStart)
  const body = src.slice(bodyStart, bodyEnd > 0 ? bodyEnd : bodyStart + 2000)
  // 捕获每个 `xxx.extend_from_slice(<EXPR>.to_le_bytes())`——`EXPR` 可能是
  //   `v.id`、`&v.bg.unwrap_or(u32::MAX)` 这类**含括号/逗号**的表达式 ⇒ 用非贪婪吃到 `)` 前
  //   （首版写死 `&?([a-z_]+)` ⇒ 遇到 `unwrap_or(u32::MAX)` 恒不匹配 ⇒ 解析失效；本仓纪律：
  //    解析器要对着**实际形态**写，写完必须用一个真实样本验一次）。
  const RE_WRITE_G = /\.extend_from_slice\(&?([\s\S]*?)\.to_le_bytes\(\)\)/g
  /**
   * ★★**认识"计数循环写入"**（2026-10-01 · C1 clip 16 槽）：
   *   内核里 16 个裁剪参数写成 `for i in 0..16 { buf.extend_from_slice(&cp[i].to_le_bytes()) }`
   *   ⇒ 正则只捕获 **1 次调用**，但实际写入 **16 个字段**。
   *   【为什么门禁必须跟着实际形态走（本仓纪律）】不识别循环 ⇒ 墙钟上"内核 48B"而消费端
   *   104B ⇒ 门禁判红；若为了让门禁变绿把消费端改成 48B，就会**真错位**。
   *   ⇒ 正解：读出循环次数（`for … in 0..N` 的 N），把该写入行按 N 倍计。
   */
  const loopMultiplier = (() => {
    const m = body.match(/for\s+\w+\s+in\s+0\.\.(\d+)\s*\{/)
    return m ? Number(m[1]) : 1
  })()
  // ★用**匹配位置**（m.index）判定"是否在循环体内"——不能用 indexOf（重复表达式会定位到首处，
  //   首版把它算成 108B（多算 1 条）；本仓纪律：解析器要对着实际形态写）
  const writesWithPos = [...body.matchAll(RE_WRITE_G)].map((m) => ({ expr: m[1].trim(), pos: m.index ?? 0 }))
  const writesRaw = writesWithPos.map((w) => w.expr)
  if (writesRaw.length === 0) {
    return {
      error:
        '未找到 extend_from_slice 写入序列——若内核改了写入形态（如改用 `copy_from_slice`），' +
        '请同步更新本门禁的解析（否则门禁会静默失效：它自己也得跟着"实际形态"走）',
    }
  }
  // ★循环内的写入行按循环次数展开（仅当那一行确实是"循环体"里的——此处按"出现在 for 之后的
  //   第一条写入"近似；本仓当前只有 cp[i] 一条在循环内，形态可控）
  // ★★循环体范围用**花括号配对**精确判定（2026-10-01 · C2 修正）：
  //   "for 之后全算循环内"太粗——C2 在循环**之后**还有写入（strokeProgress），
  //   会被按 16 倍误算（实测 172B 假读数）。
  //   ⇒ 从 `for … in 0..N {` 的 `{` 起配对到对应 `}`——范围内的写入 × N，范围外的原样计。
  const forMatch = /for\s+\w+\s+in\s+0\.\.\d+\s*\{/.exec(body)
  let fields = []
  if (forMatch && loopMultiplier > 1) {
    const braceStart = (forMatch.index ?? 0) + forMatch[0].length - 1
    let depth = 0
    let braceEnd = braceStart
    for (let i = braceStart; i < body.length; i++) {
      if (body[i] === '{') depth++
      else if (body[i] === '}') {
        depth--
        if (depth === 0) {
          braceEnd = i
          break
        }
      }
    }
    const inLoop = writesWithPos.filter((w) => w.pos > braceStart && w.pos < braceEnd).map((w) => w.expr)
    const outside = writesWithPos.filter((w) => !(w.pos > braceStart && w.pos < braceEnd)).map((w) => w.expr)
    fields = [...outside]
    for (let k = 0; k < loopMultiplier; k++) {
      for (const w of inLoop) fields.push(`${w}#${k}`)
    }
  } else {
    fields = writesRaw
  }
  // u32/f32 都是 4 字节（见内核注释：全小端定长）
  const width = fields.length * 4
  return { width, fields: fields.map((f) => f.replace(/#\d+$/, '')) }
}

/** 各消费端声明：文件、正则（捕获组 1 = 宽度）、人类可读名 */
const CONSUMERS = [
  {
    label: 'iOS 宿主（animUpdateRecordBytes）',
    file: 'hosts/ios/ProteusHost/selfdraw-scene.swift',
    re: /animUpdateRecordBytes\s*=\s*(\d+)/,
  },
  {
    label: 'Android 宿主（ANIM_RECORD_BYTES）',
    file: 'hosts/android/app/src/main/java/dev/proteus/layoutcore/ProteusHostView.java',
    re: /ANIM_RECORD_BYTES\s*=\s*(\d+)\s*;/,
  },
  {
    label: 'Android SDK（FRAME_UPDATE_BYTES）',
    file: 'platform/android/proteus-sdk/src/dev/proteus/sdk/ProteusEngine.java',
    re: /FRAME_UPDATE_BYTES\s*=\s*(\d+)\s*;/,
  },
]

const k = kernelRecordBytes()
if (k.error) {
  console.error(`❌ 线格式门禁：${k.error}`)
  process.exit(2)
}
console.log(`  内核唯一事实源：proteus_layout_anim_tick_bin → ${k.width}B/条（字段 ${k.fields.join(' + ')}）`)

let bad = 0
for (const c of CONSUMERS) {
  const p = path.join(ROOT, c.file)
  if (!fs.existsSync(p)) {
    console.error(`  ❌ ${c.label}：文件不存在（${c.file}）`)
    bad++
    continue
  }
  const m = fs.readFileSync(p, 'utf8').match(c.re)
  if (!m) {
    console.error(`  ❌ ${c.label}：未找到宽度常量（正则 ${c.re}）——常量被改名/删除？`)
    bad++
    continue
  }
  const got = Number(m[1])
  if (got !== k.width) {
    console.error(`  ❌ ${c.label}：${got}B ≠ 内核 ${k.width}B ——错位解析会发生（真机上层残值）`)
    bad++
  } else {
    console.log(`  ✅ ${c.label}：${got}B`)
  }
}

if (bad) {
  console.error(`\n✗ 线格式宽度不一致（${bad} 处）——四处消费端必须与内核同批更新：`)
  console.error('   iOS selfdraw-scene.swift / Android ProteusHostView.java / SDK ProteusEngine.java')
  console.error('   （另有 embed-demo 与 JNI 注释：前者按 SDK 常量遍历、后者只透传字节）')
  process.exit(1)
}
console.log(`\n✅ 每帧动画记录线格式一致：${k.width}B/条（内核 ⇄ ${CONSUMERS.length} 处消费端）`)
