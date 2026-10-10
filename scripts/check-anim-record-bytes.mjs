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
  // ★★2026-10-10：编码器抽成 `encode_visuals_bin`（anim tick 与 Dactyl 场跟手共用）——
  //   门禁须指向**新家**（否则切片落到别的函数 ⇒ 假红/假绿；本仓纪律：解析器对着**实际形态**写）。
  const start = src.indexOf('fn encode_visuals_bin')
  if (start < 0) return { error: '找不到 encode_visuals_bin（编码器被改名/移动？）' }
  // ★切片边界：从**函数体开始**到**调用序列结束**——用"`let mut buf` 起 → `Ok(buf)` 止"，
  //   而不是"到下一个 `#[no_mangle]`"（首版这么写时，函数**内部**的 `unsafe` 块与注释里
  //   出现的 `#[no_mangle]` 文本让切片退化成空 ⇒ 解析恒失败；本仓纪律：解析器要对着**实际形态**写）。
  const bodyStart = src.indexOf('let mut buf = Vec::with_capacity', start)
  if (bodyStart < 0) return { error: '未找到 `let mut buf = Vec::with_capacity`（写入序列被重构？）' }
  const bodyEnd = src.indexOf('\n    buf\n}', bodyStart)
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
  // ★★**多循环**（2026-10-01 · 渐变 v2）：v2 在 clip 的 `0..16` 之后又加了两个 `0..8`
  //   （colors / offsets）⇒ **首版只识别第一个循环**的写法会漏掉后两个（实测读成 128B）。
  //   ⇒ 收集**全部** `for … in 0..N {` 并用花括号配对各自的范围（支持任意个计数循环）。
  const loopMatches = [...body.matchAll(/for\s+\w+\s+in\s+0\.\.(\d+)\s*\{/g)]
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
  let fields = []
  if (loopMatches.length > 0) {
    // 每个循环的体范围（花括号配对；只收最外层——本处循环不嵌套，沿用"最内层优先"亦安全）
    const loops = loopMatches.map((m) => {
      const braceStart = (m.index ?? 0) + m[0].length - 1
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
      return { braceStart, braceEnd, n: Number(m[1]) }
    })
    // 每个写入归入**包含它的最内层循环**（没有 ⇒ 直计），再按源码位置排序展开
    const expanded = []
    for (const w of writesWithPos) {
      const inner = loops
        .filter((l) => w.pos > l.braceStart && w.pos < l.braceEnd)
        .sort((a, b) => a.braceEnd - a.braceStart - (b.braceEnd - b.braceStart))[0]
      if (inner) {
        for (let k = 0; k < inner.n; k++) expanded.push({ pos: w.pos, expr: `${w.expr}#${k}` })
      } else {
        expanded.push(w)
      }
    }
    expanded.sort((a, b) => a.pos - b.pos)
    fields = expanded.map((w) => w.expr)
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
    file: 'hosts/ios/ProteusHost/runtime/selfdraw-scene.swift',
    re: /animUpdateRecordBytes\s*=\s*(\d+)/,
  },
  {
    label: 'Android 宿主（ANIM_RECORD_BYTES）',
    file: 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/ProteusHostView.java',
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

// ══════════════════════════════════════════════════════════════════
// ★★追加检查（2026-10-01）：**每段的消费**（不只是总宽度）
//
// 【为什么需要（两次真机缺陷的直接教训）】总宽度一致 ≠ 解析正确：
//   ① 首版 Android 把新段（geo）**写在 morph/glow 之前**读 ⇒ 全部错位（"geo[0]"读到 NaN
//      ⇒ 传给 shader ⇒ **绘制线程崩溃**，真机黑屏）；
//   ② 后又出现"**读了但没入表**"（gradKind/gColors 解析了却从未 put 进 animGrad ⇒
//      探针永远读到静态回落值 0.55——**看起来一切正常**，只有真机读数对不上）。
//   总宽度门禁对两者都无感（宽度没变/没错）。
//   ⇒ 本检查：从内核写入序列提取**每个字段名**，要求两端宿主的解析源码里都出现
//     （顺序也检查：出现位置的先后必须与内核写入顺序一致——错位会被抓出）。
//
// 诚实边界：名字匹配是**启发式**（变量名可能改），但它已能抓住"漏读/乱序"这两类真实缺陷；
//   更强的形态（字节级往返）需要设备，见 `check:android-kernel-anim` 的真机判据。
// ══════════════════════════════════════════════════════════════════
{
  const { fields } = kernelRecordBytes() // 复用上面的推导（含循环展开后的顺序）
  // 内核字段名 → 两端宿主应有的**可辨识 token**（变量/注释里出现即可——不强制命名）
  // ★映射是"语义等价"而非"字面相同"（宿主用自己的命名合理；要抓的是"整段缺失"）
  // ★★判据形态（首版写成"任一 token 命中" ⇒ **无牙**：改名后别的 token 仍在别处命中，
  //   破坏性验证当场证明它抓不到——本仓纪律：门禁必须被破坏性验证钉住）。
  //   ⇒ 改为**要求"该段被读取"的语义证据**：每个消费端必须出现
  //      `read:<该段的读取 token>`（正则），即"用这些 token 之一真正读取了字节流"。
  //   ★诚实边界：仍是**源码级**证据（不能证明运行期正确）——运行期由真机判据守；
  //     它要抓的是"整段没读/读了没用"这两类**已在真机发生过的**缺陷形态。
  const SEGMENTS = [
    { field: 'v.bg', read: /(getInt|loadUnaligned)[^\n]*\b(rgba|textRgba|animatedBg)\b|\b(rgba|textRgba|animatedBg)\s*=\s*(bb\.getInt|buf\.loadUnaligned)/ },
    { field: 'ck', read: /\b(clipKind|clipKindRaw)\s*=\s*(bb\.getInt|buf\.loadUnaligned)/ },
    { field: 'v.stroke_progress', read: /\b(strokeRaw)\s*=\s*(bb\.getFloat|buf\.loadUnaligned)/ },
    { field: 'gk', read: /\bgradKind\s*=\s*(bb\.getInt|buf\.loadUnaligned)/ },
    // ★iOS 形态是 `let gn = Int(buf.loadUnaligned(…))`（Swift 的显式转换）——正则要覆盖两种写法：
    //   "赋值号右侧出现读取调用" 即可（不强制变量名在左）
    { field: 'gn', read: /\b(gn|gradN)\b[^\n]*?(bb\.getInt|loadUnaligned\(fromByteOffset)/ },
    // ★gc/go 是循环读（8 槽）——要求"读取 + 入表"两处（"读了没入表"正是真机缺陷形态）
    { field: 'gc', read: /gColors\[(k|i|gi|idx)\]\s*=|gColors\.append/ },
    { field: 'go', read: /gOffsets\[(k|i|gi|idx)\]\s*=|gLocs\.append/ },
    { field: 'v.path_morph', read: /\bmorphRaw\s*=\s*(bb\.getFloat|buf\.loadUnaligned)/ },
    { field: 'v.glow_intensity', read: /\bglowRaw\s*=\s*(bb\.getFloat|buf\.loadUnaligned)/ },
    // ★geo 段：读取 + **必须被使用**（入表 / 传给 applyGradientTick / 用于 shader 端点——
    //   "读了没入表"与"读了但绘制不用"是同一类缺陷的两个面，真机都实证过）
    {
      field: 'geo',
      read: /(gAngle|gCx)\s*=\s*(bb\.getFloat|buf\.loadUnaligned)/,
      use: /(animGrad\.put|applyGradientTick|tg\.geo)/,
    },
    // ★渐变段整体：色标+几何必须**进入绘制**（入表或被应用——"读了没入表"的实锤处）
    { field: 'gk', read: /\bgradKind\s*=\s*(bb\.getInt|buf\.loadUnaligned)/, use: /(animGrad\.put|applyGradientTick|layerGradients)/ },
    // ★★倾斜（skew v1）：读取 + **必须被使用**（Android 写进 animTx / iOS 传给 applyTransform）
    {
      field: 'v.skew_x',
      read: /\bskewX\s*=\s*(bb\.getFloat|buf\.loadUnaligned)/,
      use: /(txArr\[7\]|skewX:\s*CGFloat\(skewX\)|applyTransform)/,
    },
    // ★★遮罩（mask v1）：读取 + 必须被使用（入 animMask / 传给 applyMaskTick）
    {
      field: 'mk',
      read: /\b(mk|mKind)\s*=\s*(bb\.getInt|buf\.loadUnaligned)/,
      use: /(animMask\.put|applyMaskTick|layerMasks)/,
    },
  ]
  const CONSUMERS = [
    { label: 'iOS', file: 'hosts/ios/ProteusHost/runtime/selfdraw-scene.swift' },
    { label: 'Android', file: 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/ProteusHostView.java' },
  ]
  let bad = 0
  for (const c of CONSUMERS) {
    const src = fs.readFileSync(path.join(ROOT, c.file), 'utf8')
    for (const seg of SEGMENTS) {
      // 内核确实写了这一段才要求。
      // ★匹配形态（首版写成 `f === field || f.startsWith(field + '#')` ⇒ 漏掉了**数组下标**形态：
      //   内核写的是 `geo[i]`（循环展开成 `geo[i]#0`）⇒ 两个条件都不命中 ⇒ **该段被静默跳过**
      //   （注入①的破坏性验证当场证明门禁无牙）。⇒ 用**词边界包含**匹配（覆盖 `v.tx` / `cp[i]` /
      //   `geo[i]#0` 等所有实际形态）。
      const segField = seg.field
      const re = new RegExp(`(^|[^A-Za-z0-9_.])${segField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`)
      if (!fields.some((f) => re.test(f))) continue
      if (!seg.read.test(src)) {
        console.error(`  ❌ ${c.label} 宿主**未见「${seg.field}」段的读取**（应形如 ${seg.read}）——`)
        console.error('     该段没被读（真机表现：动画看起来没生效，而不是报错）')
        bad++
        continue
      }
      if (seg.use && !seg.use.test(src)) {
        console.error(`  ❌ ${c.label} 宿主**读了「${seg.field}」但没用**（应形如 ${seg.use}）——`)
        console.error('     这正是真机实证过的缺陷形态："读了但没入表" ⇒ 探针/绘制仍用静态值')
        bad++
      }
    }
  }
  if (bad === 0) console.log('\n✅ 每帧记录的**每段**都被两端宿主消费（宽度之外的第二道门）')
  else {
    console.error('\n✗ 存在"未消费的记录段"——总宽度对但值错，属最隐蔽的一类')
    process.exitCode = 1
  }
}
