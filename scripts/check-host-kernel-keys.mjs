#!/usr/bin/env node
// scripts/check-host-kernel-keys.mjs —— ★★★宿主「内核键白名单」与内核契约一致性门禁（2026-10-06）
//
// 【为什么需要（本仓第三次同款缺陷）】内核 `NodeDto` 的字段由**宿主**逐键转发；Android
//   `VaporRenderHost.LAYOUT_KEYS` 是**白名单**（刻意：新内核字段不得把绘制属性静默塞进去）。
//   白名单的代价：**漏登记 = 请求树不带该键 = 内核静默用默认值**——无报错、无日志。
//   已发生三次（前两次都已写进注释当"教训"）：
//     · clipPath / glow / mask（2026-10-01/03）——"白名单必须跟新字段走"纪律的由来；
//     · borderRadiusCorners（2026-10-05，iOS styleOf 白名单，静默失效 3 个月）；
//     · **justifySelf + gridColumn/gridRow（2026-10-06 · 本轮）**——真机截图逐像素量测才抓到
//       （Android center/end 案全落 start，而内核/Web 都正确）。
//   ⇒ 这类"漏登记"只有**工具层**能兜住（记忆/注释已证明无效）。
//
// 【判据（机器推导，不手写清单）】
//   ① 从内核 `ffi.rs` 的 `style_from_dto` **推出**「内核真正消费的 DTO 键」（`dto.<field>` 引用）
//      ——这是唯一事实源：新增内核字段 = 本门禁自动要求转发。
//   ② 每个消费键必须出现在 `VaporRenderHost.LAYOUT_KEYS`，**或在 EXCUSED 表显式豁免**（带理由）。
//   ③ 豁免表陈旧检测：EXCUSED 的键若不再被内核消费 ⇒ 红（逼着删，不留过期豁免）。
//
// 【诚实边界】只覆盖 **Android 自绘宿主**（VaporRenderHost —— screen-content 上屏路径，
//   superapp/验收项目共用）。iOS/鸿蒙宿主把 nodes **原样**转发（无白名单，不存在该缺陷形态）；
//   JsRenderHost 是更早的窄通路（其键集与内核契约本就不同面，另行评估）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FFI = path.join(ROOT, 'packages/layout-core-rust/src/ffi.rs')
const HOST = path.join(ROOT, 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/VaporRenderHost.java')

/**
 * 显式豁免（内核消费但宿主**刻意不转发**的键——每条必须带理由）。
 * ★写豁免 = 承诺"该键不经白名单进入内核是**有意**的"；拿不准就转发（默认安全方向）。
 */
const EXCUSED = {
  // 颜色轨道：内核读它但**由宿主侧决定是否注入**（lights/动画路径专用；
  //   屏幕内容 JSON 本就不带该键——宿主转发与否都无值可传。且 blob 形态暂无）。
  backgroundColor: '颜色轨道路径（宿主按需注入，屏幕内容不含该键；blob 形态亦无）',
  color: '同上（文本颜色轨道）',
  // 渐变/遮罩：内核持有为动画基态，宿主侧另有**自绘直读**路径（fillGradient → 画布渐变）；
  //   本条转发与否不影响静态渲染（真机动效路径由 LightsHost/动画通道另行喂入）。
  fillGradient: '绘制属性：宿主自绘直读（不经内核布局）；动画基态由专通道注入',
  fillGradientTo: '同上（B 态）',
  mask: '同上（遮罩由宿主动效通道注入）',
  // 变换原点：宿主绘制侧消费（矩阵换算）——内核布局不使用该键。
  transformOrigin: '绘制属性（宿主矩阵换算用）；内核布局不消费',
}

const { camel, fail } = {
  camel: (s) => s.split('_').map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1))).join(''),
  fail: (m) => { console.error(`✗ ${m}`); process.exitCode = 1 },
}

/* ── ① 内核消费键（从 style_from_dto 推出） ── */
const ffiSrc = fs.readFileSync(FFI, 'utf-8')
const fnBody = /pub\(crate\) fn style_from_dto\(dto: &NodeDto\) -> Result<LStyle, String> \{([\s\S]*?)\n\}/.exec(ffiSrc)
if (!fnBody) {
  console.error('✗ 找不到 `style_from_dto`（被改名/搬走？）——门禁失效，先修门禁')
  process.exit(2)
}
const consumed = [...new Set([...fnBody[1].matchAll(/dto\.(\w+)/g)].map((m) => camel(m[1])))].sort()
if (consumed.length < 10) {
  console.error(`✗ 只解析到 ${consumed.length} 个消费键（形态变了？）——门禁失效，先修门禁`)
  process.exit(2)
}

/* ── ② 宿主白名单（从 Java 源码提取） ── */
const hostSrc = fs.readFileSync(HOST, 'utf-8')
// ★★★修（2026-10-08）：正则原要求 `\)\)\);`（**3** 个右括号）——而真实代码是 `asList(...))`（2 个右括号）
//   ⇒ 原正则**永不匹配真实收尾**，一路吞到后面代码里的 `)));`，把无关字符串字面量当键（假绿：白名单虚高到 101）。
//   改为精确匹配 `asList(...));`。
  const listMatch = /LAYOUT_KEYS = new java\.util\.HashSet<>\(java\.util\.Arrays\.asList\(([\s\S]*?)\)\);/.exec(hostSrc)
if (!listMatch) {
  console.error('✗ 找不到 VaporRenderHost.LAYOUT_KEYS（被改名/改造？）——门禁失效，先修门禁')
  process.exit(2)
}
// 只取**字符串字面量**（注释里的词会被 `//` 行剔除——逐行先剥注释）
const codeOnly = listMatch[1].split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
const whitelist = new Set([...codeOnly.matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map((m) => m[1]))

/* ── ③ 判据 ── */
console.log('宿主内核键门禁（Android VaporRenderHost ⊇ 内核 style_from_dto 消费键）')
console.log(`  内核消费键 ${consumed.length} · 宿主白名单 ${whitelist.size} · 显式豁免 ${Object.keys(EXCUSED).length}`)

const missing = consumed.filter((k) => !whitelist.has(k) && !(k in EXCUSED))
if (missing.length) {
  fail(`${missing.length} 个内核消费键既不在宿主白名单、也未显式豁免（漏登记 ⇒ 请求树不带 ⇒ 内核静默用默认）：\n` +
    missing.map((k) => `      - ${k}`).join('\n') +
    `\n    ⇒ 修法：加进 ${path.relative(ROOT, HOST)} 的 LAYOUT_KEYS；` +
    `确有意不转发的，在 scripts/check-host-kernel-keys.mjs 的 EXCUSED 写明理由。`)
}

const stale = Object.keys(EXCUSED).filter((k) => !consumed.includes(k))
if (stale.length) {
  fail(`豁免表陈旧 ${stale.length} 条（内核已不消费这些键——从 EXCUSED 删除）：\n` + stale.map((k) => `      - ${k}`).join('\n'))
}

if (!process.exitCode) {
  console.log('✅ 宿主白名单覆盖内核全部消费键（豁免均已具名）')
}
