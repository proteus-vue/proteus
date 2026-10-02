#!/usr/bin/env node
// scripts/check-layers.mjs —— ★★LY1 静态门禁：页面层级语义（《Proteus 页面层级规范》§3.5/§4.1）
//
// 【它补的是什么（编译期校验之外的第二个防线）】
//   `layer-safety.ts` 在 `compileVueSfc` 里拦违规——但**只覆盖被构建的页面**：
//   · 未被任何构建入口引用的 .vue 文件（新写的、临时页）不被覆盖；
//   · CI 里跑的是 `build:web` / `build:mp` 两个 target——其他 target 的页面可能漏。
//   ⇒ 本门禁**直接扫全部 .vue 源文件**（不依赖构建），与编译器校验形成"全量 + 构建"两道。
//
// 【为什么必须机器强制（规范 §3.5）】"禁止裸 z-index"是硬约束（编译期报错，不是警告）——
//   开放数值 = 收敛模型的逃生口（与"不开放任意原生调用"同理）。
//   本仓已踩过同族：sleep 红线写在 markdown 拦不住，只有工具层门禁是结构性的。
//
// 判据（与 compiler/layer-safety.ts 同一实现——**单一来源**，不复制规则）：
//   LY001 裸 z-index 数值 · LY002 非法层名 · LY003 Mask 单独用 ·
//   LY004 Popout/Mask 非根容器 · LY005 声明框架保留层
//
// 用法：node scripts/check-layers.mjs [--json]
// 退出码：0 通过 / 1 存在违规 / 2 前置缺失（dist 未构建）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JSON_OUT = process.argv.includes('--json')

// ★从**编译产物**载入校验器（与编译器编译期校验同一实现——不是复制规则）。
//   走 dist 是刻意的：本门禁在 CI 里跑，dist 由 build-packages 产出（verify 链同款）。
const distPath = path.join(ROOT, 'packages/compiler/dist/layer-safety.js')
if (!fs.existsSync(distPath)) {
  console.error(`[layers] ✗ 缺 ${path.relative(ROOT, distPath)}——先构建：node scripts/build-packages.mjs`)
  process.exit(2)
}
const { validateLayerUsage } = await import(distPath)

/**
 * 扫描面：**跨端应用代码**（必须五端一致的页面/组件）。
 *
 * ★★为什么**不含 `website/`**（2026-10-02 实测定界）：
 *   官网是**单端纯 Web 产物**（只跑在浏览器，不参与五端渲染、不进 Proteus 编译链）——
 *   CSS 的 z-index 在它那里是**普通 Web 层叠**（弹窗/导航/装饰层），不存在"跨端语义不同"
 *   的问题，也没有 `layer` 属性可用（它不是 Proteus 应用）。
 *   首版把 website 纳入 ⇒ 21 处"违规"全在官网（App.vue 5 / Home.vue 8 / DocsPage 等）——
 *   这些是**判据作用域错了**，不是代码错了（本仓纪律：判据本身错时，归因必然错）。
 *   规范 §1 的适用对象是"页面层级（跨端）"⇒ 作用域 = Proteus 应用代码。
 *   ★若未来官网也接入 Proteus 编译链（成为"第六端"），届时纳回。
 *
 * ★★`showcase` 的细粒度作用域（2026-10-03 修复死路径）：
 *   首版写的是 `showcase/src`——**该目录从未存在**（showcase 直接用 `pages/`
 *   `subpackages/` `components/`，无 `src/`）⇒ 声明"扫 showcase"而实际**一个都没扫到**
 *   （静默盲区；本仓纪律：门禁覆盖面必须跟着实际形态走）。
 *   ★仍**不含** `showcase/router/`（RouterView 的 CSS z-index 层叠是 showcase 自己的
 *     Web 导航实现——与 website 同性质：单端 Web infra、非 Proteus 五端页面）。
 */
const SCAN_DIRS = [
  'examples/pages', 'examples/subpackages', 'examples/components',
  'showcase/pages', 'showcase/subpackages', 'showcase/components',
]
const SKIP_DIR = /(?:^|[/\\])(?:node_modules|dist|\.proteus|generated)(?:[/\\]|$)/

function* walkVue(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return // 目录不存在（如 showcase 未安装）——不算错
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (SKIP_DIR.test(p)) continue
    if (e.isDirectory()) yield* walkVue(p)
    else if (e.name.endsWith('.vue')) yield p
  }
}

const findings = []
let scanned = 0
for (const rel of SCAN_DIRS) {
  for (const file of walkVue(path.join(ROOT, rel))) {
    scanned++
    const src = fs.readFileSync(file, 'utf-8')
    // 只校验 <template> 段（层级语义在模板里；<style> 里的 z-index 由 style-safety / LY001 同规则另判）
    const m = /<template[^>]*>([\s\S]*)<\/template>/.exec(src)
    const tpl = m ? m[1] : src
    for (const v of validateLayerUsage(tpl)) {
      findings.push({ file: path.relative(ROOT, file), ...v })
    }
    // ★<style> 段里的裸 z-index 也拦（LY001 同码——CSS 侧同属"裸层级数值"）
    const styleMatches = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    for (const sm of styleMatches) {
      const body = sm[1] ?? ''
      const lines = body.split('\n')
      lines.forEach((line, i) => {
        if (/^\s*(\/\*|\*)/.test(line)) return // 注释行跳过（允许引述说明）
        if (/z-index\s*:/.test(line)) {
          findings.push({
            file: path.relative(ROOT, file),
            code: 'LY001',
            rule: '规范 §3.5「禁止开发者写裸 z-index 数值」',
            message: `<style> 块里写裸 \`z-index\` 数值（层级必须语义化声明）`,
            hint: '删掉 z-index；改用 `layer="content|navigation|mask|popout"`，同层顺序用**声明顺序**（规范 §3.3）',
          })
        }
      })
    }
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ scanned, findings }, null, 2))
} else {
  console.log(`页面层级门禁（LY1 · 《页面层级规范》§3.5/§4.1）`)
  console.log(`  扫描 ${scanned} 个 .vue（${SCAN_DIRS.join(' · ')}）`)
  if (findings.length === 0) {
    console.log('  ✅ 无层级违规（裸 z-index / 非法层名 / Mask 单独用 / Popout·Mask 非根容器 / 保留层名）')
  } else {
    console.error(`\n❌ 发现 ${findings.length} 处层级违规：`)
    for (const f of findings) {
      console.error(`\n  ${f.file}${f.line ? `:${f.line}` : ''}`)
      console.error(`    [${f.code}] ${f.message}`)
      console.error(`    规则：${f.rule}`)
      console.error(`    修法：${f.hint}`)
    }
    console.error('\n  ⇒ 层级模型遵循微信 WeUI 四层语义（Content/Navigation/Mask/Popout）；')
    console.error('    数值由框架映射（contracts/layers.ts），不暴露给开发者。')
  }
}

process.exit(findings.length === 0 ? 0 : 1)
