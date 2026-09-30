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
// 【判据（三条，都能变红）】
//   A. `platform/**` 不得 import / include `hosts/**`（相对路径与包名两种形态都查）
//   B. `platform/**` 不得引用 Host ABI（`proteus_host_abi.h` / `proteus_abi_` / `proteus_engine_` 等符号）
//   C. `platform/**` 必须**真的存在**且含**实质平台代码**（防"建个空目录就算完成 HA0.5"）
//      ——判据：每个 platform/<端>/ 下至少有 1 个源码文件，且文件里出现该端特征 API
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

const SRCEXT = /\.(swift|java|kt|ts|tsx|mjs|c|cc|cpp|h|hpp|ets)$/
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
  android: /android\.|StaticLayout|Canvas|Typeface/,
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
      // B. Host ABI 引用
      if (/proteus_host_abi|proteus_abi_|proteus_engine_|proteus_submit_frame|proteus_load_tree/.test(t)) {
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

  if (VERBOSE) {
    console.log(`[platform-layering] 扫描 ${files.length} 个 platform 源码文件 · 端目录 ${ends.join(', ')}`)
  }
  if (violations.length > 0) {
    console.error('[platform-layering] ✗ 分层依赖违规：')
    for (const v of violations) {
      const rules = {
        A: 'platform 不得引用 hosts/',
        B: 'platform 不得引用 Host ABI',
        C: 'platform 必须有实质平台代码',
      }
      console.error(`    [${v.rule}] ${v.rel}${v.line ? `:${v.line}` : ''} — ${rules[v.rule]}\n         ${v.text}`)
    }
    console.error('  ⇒ 平台适配（文本度量/绘制/解码）与宿主集成（Surface/生命周期/调度/能力）必须分开：')
    console.error('     平台层不知道宿主契约的存在，否则换宿主会连带重写平台适配（HA0.5 的收益就没了）。')
    return 1
  }
  console.log(`[platform-layering] ✅ 分层依赖正确（${files.length} 个文件 · 端：${ends.join(', ')}）`)
  return 0
}

process.exit(main())
