#!/usr/bin/env node
// scripts/gen-vue-compat-doc.mjs —— ★★从 SSOT 生成「Vue 兼容性」官网页（zh + en）
//
// 【为什么必须生成（本仓纪律 #22）】兼容矩阵 `VUE_COMPAT_MATRIX` 是 **128 项的 SSOT**
//   （带机器门禁 `tests/vue-compat-matrix.test.ts`）。若官网手抄一份 ⇒ 那就是**第 2 份副本**，
//   而矩阵会随 Vue 版本演进（重拉导出 + 复评状态）⇒ 手抄的表必然漂移，且漂移是静默的
//   （读者按过期文档写代码，撞上编译期报错才知道）。
//   ⇒ 本脚本从**代码**生成页面；`--check` 纳入 CI ⇒ 表与矩阵不可能不一致。
//
// 【范围（用户决策 2026-09-29）】只列**非 aligned 的 71 项**（55 unsupported + 16 partial）。
//   理由：aligned 是默认预期（`ref`/`computed` 不必逐个声明）；非 aligned 的必须说清楚——
//   其中 **53 项直接中断编译**（error），用户最需要提前知道。
//
// 【中英双语】两份产物共享同一份数据；英文侧的「说明」用**矩阵原文**（不翻译 note——
//   它们是给开发者的技术判定，翻译会引入偏差；英文读者看代码注释口径即可）。
//
// 用法：
//   node scripts/gen-vue-compat-doc.mjs          # 生成
//   node scripts/gen-vue-compat-doc.mjs --check  # 校验（CI；漂移 exit 1）
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const CHECK = process.argv.includes('--check')

const ZH = path.join(ROOT, 'website/guides/37-vue-compatibility.md')
const EN = path.join(ROOT, 'website/en/guides/37-vue-compatibility.md')

// ── 从 SSOT 取数（求值真实模块，不解析源码文本）──────────────────────────
const probe = `
import { VUE_COMPAT_MATRIX, vueCompatLevel } from ${JSON.stringify(path.join(ROOT, 'packages/compiler/src/vue-compat.ts'))}
const off = VUE_COMPAT_MATRIX.filter((e) => e.status !== 'aligned')
const out = off.map((e) => ({
  name: e.name, group: e.group, status: e.status,
  level: vueCompatLevel(e), note: e.note ?? '', noteEn: e.noteEn ?? '', source: e.source,
}))
const aligned = VUE_COMPAT_MATRIX.filter((e) => e.status === 'aligned').length
process.stdout.write(JSON.stringify({ total: VUE_COMPAT_MATRIX.length, aligned, off: out }))
`
const raw = execFileSync('npx', ['tsx', '-e', probe], { cwd: ROOT, encoding: 'utf-8', timeout: 120000 })
const data = JSON.parse(raw.trim().split('\n').pop())
const { total, aligned, off } = data

const GROUPS = [
  ['reactivity', '响应式', 'Reactivity'],
  ['component', '组件与运行时', 'Component & runtime'],
  ['lifecycle', '生命周期', 'Lifecycle'],
  ['template', '模板与指令', 'Template & directives'],
  ['sfc', 'SFC 编译', 'SFC compilation'],
]

const byGroup = (g) => off.filter((e) => e.group === g)
const nError = off.filter((e) => e.level === 'error').length
const nWarn = off.filter((e) => e.level === 'warning').length
const nUnsup = off.filter((e) => e.status === 'unsupported').length
const nPartial = off.filter((e) => e.status === 'partial').length

// zigzag 描述（中英各自的静/动态文字；表体数据共享）
const zig = (zh, en) => ({ zh, en })

function levelText(level, lang) {
  if (level === 'error') return lang === 'zh' ? '**❌ 编译报错**' : '**❌ Compile error**'
  return lang === 'zh' ? '⚠️ 编译警告' : '⚠️ Compile warning'
}

function statusText(status, lang) {
  if (status === 'unsupported') return lang === 'zh' ? '不支持' : 'Unsupported'
  return lang === 'zh' ? '受限' : 'Partial'
}

function build(lang) {
  const zh = lang === 'zh'
  const L = []
  L.push('---')
  L.push(zh ? 'title: Vue 兼容性' : 'title: Vue compatibility')
  L.push('order: 37')
  L.push(zh ? 'group: 渲染与能力' : 'group: 渲染与能力')
  L.push('---')
  L.push('')
  L.push(zh ? '# Vue 兼容性' : '# Vue compatibility')
  L.push('')
  L.push(
    zh
      ? `写的是**标准 Vue SFC**，但跨端要经编译器落到各端。编译器对**每一个** Vue 能力都必须给出明确结果——不静默输出坏产物。本页列出**需要你知道的那部分**：\`${total}\` 项里有 \`${aligned}\` 项直接可用（不必逐个声明），下面 \`${off.length}\` 项会受限制或报错。`
      : `You write **standard Vue SFC**, but cross-target output goes through the compiler. Every Vue capability must get a definite verdict — nothing silently produces a broken artifact. This page lists **only what you need to know**: of \`${total}\` capabilities, \`${aligned}\` work directly (no need to enumerate them); the \`${off.length}\` below are restricted or rejected.`,
  )
  L.push('')
  L.push(
    zh
      ? `| 判级 | 数量 | 含义 |\n|---|---|---|\n| **❌ 编译报错** | **${nError}** | 编译期 \`fail-closed\` 直接中断——**这是本页最需要提前知道的部分** |\n| ⚠️ 编译警告 | ${nWarn} | 能编译，但行为可能与 Web 不同（页面里逐条注明） |`
      : `| Verdict | Count | Meaning |\n|---|---|---|\n| **❌ Compile error** | **${nError}** | The compiler \`fail-closed\`s and stops — **this is what you most need to know in advance** |\n| ⚠️ Compile warning | ${nWarn} | Compiles, but behaviour may differ from the Web (noted per entry below) |`,
  )
  L.push('')
  L.push(
    zh
      ? `> **适用范围（重要）**：本表约束的是**小程序端编译路径**（\`compileVueSfc\`）。**Web 端不受这些限制**——Web 走标准 Vite + Vue，由浏览器直接运行。\n>\n> **与「Vapor 更新路径」的关系**：那讲的是**更新机制**能不能用 Vue 官方实现（答案：App/小程序端不能，因为框架建立在自定义渲染器上——见 [Vapor 更新路径](/docs/framework/43-vapor-update-path)）；本页讲的是**语言能力**支持到什么程度。两者是不同层面的问题。`
      : `> **Scope (important)**: this table constrains the **mini-program compile path** (\`compileVueSfc\`). **The Web side is not affected** — it runs standard Vite + Vue, executed by the browser.\n>\n> **Relation to the "Vapor update path" page**: that one is about whether the **update mechanism** can use Vue's official implementation (answer: not on App/mini-program, because the framework is built on a custom renderer — see [Vapor update path](/docs/framework/43-vapor-update-path)); this page is about how far **language capabilities** are supported. Different questions.`,
  )
  L.push('')
  L.push(
    zh
      ? `★**本页由代码生成**（\`VUE_COMPAT_MATRIX\` 是 SSOT，配套门禁 \`check:vue-compat-doc\` 比对）——表与实现不可能漂移。`
      : `★**This page is generated from code** (\`VUE_COMPAT_MATRIX\` is the SSOT; the \`check:vue-compat-doc\` gate compares them) — the table cannot drift from the implementation.`,
  )
  L.push('')
  L.push(zh ? '## 不受支持 / 受限的能力' : '## Unsupported / restricted capabilities')
  L.push('')
  for (const [key, labelZh, labelEn] of GROUPS) {
    const items = byGroup(key)
    if (!items.length) continue
    L.push(`### ${zh ? labelZh : labelEn}`)
    L.push('')
    L.push(zh ? '| 能力 | 状态 | 判级 | 说明与替代 |' : '| Capability | Status | Verdict | Notes & alternatives |')
    L.push('|---|---|---|---|')
    for (const e of items) {
      // ★英文页用 `noteEn`（来自 SSOT）——不是把中文搬过去（双语站惯例：内容全译）
      const noteText = (zh ? e.note : e.noteEn || e.note).replace(/\|/g, '\\|')
      L.push(`| \`${e.name}\` | ${statusText(e.status, lang)} | ${levelText(e.level, lang)} | ${noteText} |`)
    }
    L.push('')
  }
  L.push(zh ? '## 我需要做什么' : '## What to do')
  L.push('')
  if (zh) {
    L.push('1. **先查本页**再动手写——尤其 `<keep-alive>` / `<component :is>` / 自定义指令这类常用但不受支持的写法；')
    L.push('2. **看替代建议**：大多数项都给了对等写法（如 `onActivated` → `onShow`、`<component :is>` → `v-if`、自定义指令 → 方法调用）；')
    L.push('3. **编译报错时不要绕过**：`❌` 类的报错是**有意**的失败（反黑盒红线）——绕过去只会得到行为错误的产物；')
    L.push('4. **受限项要实测**：`⚠️` 类能编译，但行为可能与 Web 不同（每条注明了差异）。');
  } else {
    L.push('1. **Check this page first** before writing — especially common-but-unsupported forms like `<keep-alive>` / `<component :is>` / custom directives;')
    L.push('2. **Read the alternatives**: most entries give an equivalent (e.g. `onActivated` → `onShow`, `<component :is>` → `v-if`, custom directives → method calls);')
    L.push('3. **Do not work around compile errors**: `❌` entries are **deliberate** failures (anti-black-box red line) — working around them only yields behaviourally wrong output;')
    L.push('4. **Test restricted items**: `⚠️` entries compile, but may behave differently from the Web (the difference is noted per entry).')
  }
  L.push('')
  L.push(zh ? '## 本组导航' : '## Section navigation')
  L.push('')
  if (zh) {
    L.push('- [快速开始](/docs/01-intro)：从零跑起来')
    L.push('- [渲染与能力](/docs/12-components-intro)：组件与能力体系')
    L.push('- [Vapor 更新路径](/docs/framework/43-vapor-update-path)：更新机制与自研理由')
  } else {
    L.push('- [Introduction](/docs/01-intro): get something running')
    L.push('- [Components intro](/docs/12-components-intro): components and capabilities')
    L.push('- [Vapor update path](/docs/framework/43-vapor-update-path): update mechanism and why it is in-house')
  }
  L.push('')
  return L.join('\n')
}

const zhDoc = build('zh')
const enDoc = build('en')

if (CHECK) {
  const problems = []
  for (const [file, content] of [[ZH, zhDoc], [EN, enDoc]]) {
    const rel = path.relative(ROOT, file)
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : ''
    if (existing.trim() !== content.trim()) problems.push(rel)
  }
  if (problems.length) {
    console.error(`✗ Vue 兼容性页与 SSOT 不一致：\n  - ${problems.join('\n  - ')}`)
    console.error('  ⇒ 跑 `node scripts/gen-vue-compat-doc.mjs` 重新生成（矩阵变更后必须重生成）')
    process.exit(1)
  }
  console.log(`✅ Vue 兼容性页与 SSOT 一致（${total} 项中非 aligned ${off.length}：error ${nError} / warning ${nWarn}）`)
} else {
  for (const [file, content] of [[ZH, zhDoc], [EN, enDoc]]) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  console.log(`[vue-compat-doc] ✅ 生成 ${path.relative(ROOT, ZH)} + ${path.relative(ROOT, EN)}`)
  console.log(`    SSOT ${total} 项 · 非 aligned ${off.length}（unsupported ${nUnsup} / partial ${nPartial}）· error ${nError} / warning ${nWarn}`)
}
