#!/usr/bin/env node
// scripts/check-platform-layering.mjs —— ★★HA0.5 门禁：**分层依赖方向**
//
// 【为什么需要（Host ABI 方案 §0.4.5，原文硬性要求）】
//   ```
//   hosts/*      ──→  platform/*      ✅ 允许（宿主调用平台能力）
//   platform/*   ──→  hosts/*         ❌ 禁止
//   platform/*   ──→  Host ABI        ❌ 禁止（平台层不感知宿主契约）
//   ```
//   原文："**强制规则**：`platform/` 层的任何文件**不得 import / include** `hosts/` 层的任何符号。
//   需在 CI 中加入静态检查，违反即阻断。"
//
// 【为什么这条不能靠人记（本仓纪律）】分层是**架构约束**，而架构约束只写在文档里就会漂移：
//   某人为了让平台层"顺手"拿到宿主的一个工具函数而 import 一下 ⇒ 分层塌了，且**编译照过**。
//   ⇒ 与「三条红线要工具层管」同源：机器判据才拦得住。
//
// 【判据（四条，都能变红）】
//   A. `platform/**` 不得 import / include `hosts/**`（相对路径与包名两种形态都查）
//   B. ★**平台适配**不得引用 Host ABI（`proteus_host_abi.h` / `proteus_abi_` / `proteus_engine_` 等符号）
//      ★但 `platform/` 下有**两小类**，规则不同（2026-09-30 修正——原二分法漏了"绑定层"）：
//        · **平台适配**（文本度量 / 绘制执行 / 图片解码）：只该知道平台 API ⇒ 引 ABI **即红**
//          （它一旦知道宿主契约，换宿主就连带重写它 —— 这正是 B 组要防的）
//        · **绑定层**（JNI / NAPI / C-ABI 桥）：职责**就是**"契约 ↔ 平台机制"的翻译
//          ⇒ **必须**知道两端；若不许它引 ABI，它就无法工作
//      ⇒ 判据形态：绑定层需在文件头写 `ABI-BINDING:` + 理由（与 `I2-ALLOW` 同款——**豁免必须显式
//        且给出理由**，而不是"这个目录一律放过"）；没标记却引了 ⇒ 红。
//   C. `platform/**` 必须**真的存在**且含**实质平台代码**（防"建个空目录就算完成 HA0.5"）
//      ——判据：每个 platform/<端>/ 下至少有 1 个源码文件，且文件里出现该端特征 API
//   D. ★**内核不得出现平台分支**（HA2 硬性判据：Host ABI §2.6「清除内核中的平台分支」）
//      ——扫 `packages/layout-core-rust/`：源码里的 `#[cfg(target_os …)]` / `cfg!(target_os …)`
//        与 Cargo.toml 的 `[target.'cfg(target_os …)'.dependencies]` 都算违规。
//      ★注释与文档提及**不算**（我们自己的注释就在解释"为什么搬走了"）⇒ 只扫**代码**形态。
//
// 用法：node scripts/check-platform-layering.mjs [--verbose]
// 退出码：0 通过 / 1 违规 / 0（platform/ 不存在时**诚实跳过** —— CI 干净克隆的中间态）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const PLATFORM = path.join(ROOT, 'platform')
const VERBOSE = process.argv.includes('--verbose')

// ★HA2 修正：补 `rs`（平台绑定层是 Rust crate —— 原表只覆盖 Swift/Java，扫描面漏了一整类语言）
const SRCEXT = /\.(swift|java|kt|rs|ts|tsx|mjs|c|cc|cpp|h|hpp|ets)$/
const SKIP = new Set(['node_modules', 'dist', 'build', 'target', '.git'])

/** 递归收集源码文件 */
function collect(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collect(p, acc)
    else if (SRCEXT.test(e.name)) acc.push(p)
  }
  return acc
}

/** 该端应有的特征 API（证明 platform/<端> 里是**真平台代码**，不是空壳/占位） */
const PLATFORM_SIGNATURE = {
  ios: /UIKit|CoreText|CALayer|UIFont|Foundation/,
  // ★Android 特征（HA2 起也认 Rust 绑定层）：Java 侧 android.*/StaticLayout；Rust 侧 jni crate / JNI 符号名
  android: /android\.|StaticLayout|Canvas|Typeface|use jni::|JNIEnv|Java_dev_proteus_/,
  harmony: /@ohos\.|ArkUI|ArkTS/,
}

function main() {
  if (!fs.existsSync(PLATFORM)) {
    console.log('[platform-layering] ⚠ `platform/` 不存在 ⇒ 诚实跳过（HA0.5 未开始或已回退）')
    return 0
  }

  const files = collect(PLATFORM)
  const violations = []

  // ── A/B：依赖方向 ──
  for (const f of files) {
    const rel = path.relative(ROOT, f)
    const src = fs.readFileSync(f, 'utf-8')
    src.split('\n').forEach((line, i) => {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('#')) return
      // A. hosts/** 引用（相对路径形态）
      if (/(?:import|#include|require)\b[^\n]*["'<][^"'<>]*hosts\//.test(t)) {
        violations.push({ rel, line: i + 1, rule: 'A', text: t })
      }
      // B. Host ABI 引用（★绑定层豁免：文件头有 `ABI-BINDING:` 标记 + 理由）
      if (/proteus_host_abi|proteus_abi_|proteus_engine_|proteus_submit_frame|proteus_load_tree/.test(t)) {
        // 豁免判据（三条同时满足，防"随便写个标记就过"）：
        //   ① 文件**头部 25 行内**有 `ABI-BINDING:`（不能藏在文件中间）
        //   ② 标记后**有实际理由文字**（长度 ≥ 10，`ABI-BINDING:` 光秃秃不算）
        //   ③ 该文件所在路径含 "jni" / "napi" / "binding"（**绑定层的物理特征**——
        //      防止有人把"平台适配"文件也加上标记蒙混过关）
        const head = src.split('\n').slice(0, 25).join('\n')
        // ★`[ \t]*` 而不是 `\s*`：后者在 JS 里**包含换行** ⇒ 空理由会"吃"到下一行内容
        //   当理由（本轮破坏性验证抓出：标记后什么都不写，判据却放行了）。
        const m = head.match(/ABI-BINDING:[ \t]*(.+)/)
        const hasReason = !!(m && m[1].trim().length >= 10)
        const looksBinding = /(jni|napi|binding)/i.test(rel)
        if (hasReason && looksBinding) return // 绑定层：显式声明 + 理由 ⇒ 放行（forEach 回调内用 return，不是 continue）
        violations.push({ rel, line: i + 1, rule: 'B', text: t })
      }
    })
  }

  // ── C：实质内容 ──
  const ends = fs
    .readdirSync(PLATFORM, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
  if (ends.length === 0) {
    violations.push({ rel: 'platform/', line: 0, rule: 'C', text: 'platform/ 下没有任何端目录（空壳）' })
  }
  for (const end of ends) {
    const endFiles = collect(path.join(PLATFORM, end))
    if (endFiles.length === 0) {
      violations.push({ rel: `platform/${end}/`, line: 0, rule: 'C', text: '端目录下没有源码文件' })
      continue
    }
    const sig = PLATFORM_SIGNATURE[end]
    if (sig) {
      const joined = endFiles.map((f) => fs.readFileSync(f, 'utf-8')).join('\n')
      if (!sig.test(joined)) {
        violations.push({
          rel: `platform/${end}/`,
          line: 0,
          rule: 'C',
          text: `未发现该平台特征 API（${sig}）—— 疑似空壳/占位（"建个目录"不等于完成 HA0.5）`,
        })
      }
    }
  }

  // ── D：内核不得出现平台分支（HA2） ──
  const KERNEL = path.join(ROOT, 'packages', 'layout-core-rust')
  const kernelFiles = []
  collect(path.join(KERNEL, 'src'), kernelFiles)
  // 只扫**代码**形态：`#[cfg(...target_os...)]` 属性 / `cfg!(...target_os...)` 宏
  //   ★不提注释里的提及：本仓注释正在解释"为什么把 JNI 搬走"，那是**应该**存在的文字
  const CFG_ATTR = /#\[cfg\([^)]*target_os[^)]*\)\]/
  const CFG_MACRO = /cfg!\([^)]*target_os[^)]*\)/
  for (const f of kernelFiles) {
    const src = fs.readFileSync(f, 'utf-8')
    src.split('\n').forEach((line, i) => {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return  // 注释豁免
      if (CFG_ATTR.test(line) || CFG_MACRO.test(line)) {
        violations.push({ rel: path.relative(ROOT, f), line: i + 1, rule: 'D', text: t })
      }
    })
  }
  // Cargo.toml 的平台条件依赖
  const kCargo = path.join(KERNEL, 'Cargo.toml')
  if (fs.existsSync(kCargo)) {
    fs.readFileSync(kCargo, 'utf-8')
      .split('\n')
      .forEach((line, i) => {
        const t = line.trim()
        if (t.startsWith('#')) return
        if (/^\[target\..*target_os/.test(t)) {
          violations.push({ rel: 'packages/layout-core-rust/Cargo.toml', line: i + 1, rule: 'D', text: t })
        }
      })
  }
  if (VERBOSE) {
    console.log(
      `[platform-layering] 扫描 ${files.length} 个 platform 源码文件 · 端目录 ${ends.join(', ')}` +
        ` · 内核 ${kernelFiles.length} 个源码文件（D 组）`,
    )
  }
  if (violations.length > 0) {
    console.error('[platform-layering] ✗ 分层依赖违规：')
    for (const v of violations) {
      const rules = {
        A: 'platform 不得引用 hosts/',
        B: '平台适配不得引用 Host ABI（绑定层需在文件头写 ABI-BINDING: 理由）',
        C: 'platform 必须有实质平台代码',
        D: '内核不得出现平台分支（HA2：JNI 等平台绑定归 platform/）',
      }
      console.error(`    [${v.rule}] ${v.rel}${v.line ? `:${v.line}` : ''} — ${rules[v.rule]}\n         ${v.text}`)
    }
    console.error('  ⇒ 平台适配（文本度量/绘制/解码）与宿主集成（Surface/生命周期/调度/能力）必须分开：')
    console.error('     平台层不知道宿主契约的存在，否则换宿主会连带重写平台适配（HA0.5 的收益就没了）。')
    console.error('  ⇒ B 组两类：**平台适配**不该知道宿主契约；**绑定层**（JNI/NAPI）必须知道 ——')
    console.error('     若你写的是绑定层，在文件头加：`// ABI-BINDING: <为什么本文件必须知道宿主契约>`')
    console.error('  ⇒ D 组的理由（HA2）：内核一旦带平台分支，换平台就要动内核 ——')
    console.error('     平台绑定（JNI/NAPI/…）应各成一个 platform/<端>/ crate（内核只做平台无关的布局）。')
    return 1
  }
  console.log(
    `[platform-layering] ✅ 分层依赖正确（platform ${files.length} 文件 · 端：${ends.join(', ')}` +
      ` · 内核 ${kernelFiles.length} 文件零平台分支）`,
  )
  return 0
}

process.exit(main())
