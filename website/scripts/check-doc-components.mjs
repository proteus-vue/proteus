#!/usr/bin/env node
// website/scripts/check-doc-components.mjs —— ★文档组件名对账门禁（2026-09-27 新增）
//
// 背景：`p-card` 这个**从不存在的组件**在文档里出现了 3 处（zh 总览/zh 柔性网格/en 柔性网格），
//   一路无人发现——因为既有的文档门禁只校验「生成物与源一致」「双语结构对齐」「数字与源码一致」，
//   **没有一道校验「文档里写的 p-* 组件是否真的存在」**。读者照抄示例会直接报错。
//
// 判据：扫描 website 全部 markdown 中的 `p-xxx` 标签引用，凡不在「已注册组件」集合内的即报错。
//   例外：`p-fluid`（是属性/指令形态 `v-p-fluid`，非组件）、显式白名单（如示例占位）。
//
// 用法：node scripts/check-doc-components.mjs [--json]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WEBSITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(WEBSITE, '..')

/** 已注册组件名（SSOT = packages/components/index.ts 的 import + 导出） */
function registeredComponents() {
  const src = fs.readFileSync(path.join(ROOT, 'packages', 'components', 'index.ts'), 'utf8')
  const names = new Set()
  // import PView from './p-view/index.vue'  →  p-view
  for (const m of src.matchAll(/from\s+'(\.\/(p-[a-z0-9-]+)\/index\.vue)'/g)) names.add(m[2])
  return names
}

/** 非组件但形如 p-xxx、且可能出现在 vue 代码块里的合法标记 */
const ALLOWED = new Set([
  'p-fluid', // 属性式（编译期改写为 v-p-fluid 指令）
])

/** 收集 website 下的 md 文件（content/en/guides/framework 等） */
function mdFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) mdFiles(p, out)
    else if (e.name.endsWith('.md')) out.push(p)
  }
  return out
}

const components = registeredComponents()
const files = mdFiles(WEBSITE).filter((f) => !f.includes('/scripts/'))

/**
 * ★判据收窄（首版 81 处误报的教训）：只校验**读者会照抄的 `vue` 代码块内的标签**。
 *   散文/表格里的 `p-xxx` 可能是：指令名（`v-p-shortcut` 的 `p-shortcut` 写法）、
 *   CSS 类名（`p-sidebar-collapsed` 是 p-sidebar 发出的根类）、拒用示例（「拒绝 <p-swiper>」）、
 *   规则反例（`p-buttn` 打字错误示例）——这些都不是「读者照抄会报错的组件引用」。
 *   真正有害的是**可复制代码块**里引用了不存在的组件（`p-card` 正是如此潜伏的）。
 */
function vueFenceLines(text) {
  const out = []
  const lines = text.split('\n')
  let inVue = false
  let lang = ''
  lines.forEach((line, i) => {
    const open = line.match(/^```(\w+)?/)
    if (open && !inVue) {
      lang = (open[1] ?? '').toLowerCase()
      inVue = true
      return
    }
    if (/^```\s*$/.test(line) && inVue) {
      inVue = false
      lang = ''
      return
    }
    if (inVue && (lang === 'vue' || lang === 'html')) out.push({ line: i + 1, text: line })
  })
  return out
}

const problems = []
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8')
  for (const { line, text: src } of vueFenceLines(text)) {
    for (const m of src.matchAll(/<([a-z][a-z0-9-]*)[\s/>]/g)) {
      const name = m[1]
      if (!name.startsWith('p-')) continue
      if (ALLOWED.has(name) || components.has(name)) continue
      problems.push({ file: path.relative(ROOT, f), line, name, text: src.trim().slice(0, 100) })
    }
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ components: [...components].sort(), problems }, null, 2))
} else if (problems.length) {
  console.error(`❌ vue 代码块里引用了**不存在的组件** ${problems.length} 处（读者照抄会报错）：`)
  for (const p of problems) console.error(`  ${p.file}:${p.line}  ${p.name}  →  ${p.text}`)
  console.error(`\n已注册组件 ${components.size} 个；若该名字是新组件请先在 packages/components 落地，`)
  console.error('若它是属性/指令（非组件）请在脚本的 ALLOWED 集合中登记。')
  process.exit(1)
} else {
  console.log(`OK: 文档组件名对账通过（${files.length} 个 md 的 vue 代码块，已注册组件 ${components.size} 个，零处引用不存在组件）`)
}
