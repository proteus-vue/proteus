// scripts/check-all-target-wording.mjs —— 文档「全端视角」写作门禁（★#487，C1/C2/C3 防回潮）
//   把 Proteus 世界观写成「一套语义 → 各端产物」：Web / 小程序是**已接线的两类形态**，
//   原生/Flutter 渲染后端直食同一语义 IR——禁止把「双端」当作框架的完整答案来表述。
//   扫描 website/guides + website/framework（zh 与 en 镜像各自模式集）。
//   放行：确为话题限定/工具流页面的行可加行尾标记 ` <!--all-target-ok-->`（md 注释，不渲染）。
// 用法：node scripts/check-all-target-wording.mjs [--fix-list]（--fix-list 输出清单便于定位）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIRS = ['website/guides', 'website/framework']
const ALLOW = ' <!--all-target-ok-->'

const ZH_PATTERNS = [
  '双端工程', '双端配置', '双端 codegen', '双端各自', '双端不漂移',
  '分别生成双端', '两端产物', '双端就都', 'Web 与小程序两端', '两端同时生效',
  '只(?:面向|针对) (?:Web|小程序)', '仅(?:面向|针对) (?:Web|小程序)',
  '框架的答案.*双端', '答案.*双端',
]
const EN_PATTERNS = [
  'dual-end (?:codegen|generation|configs?)',
  'dual-target (?:project|configs?|codegen)',
  'generates both targets', 'both targets.*config',
]

function scan(dir) {
  const hits = []
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const isEn = dir.includes('/en/')
    const pats = isEn ? EN_PATTERNS : ZH_PATTERNS
    if (!pats.length) continue
    const re = new RegExp(pats.map((p) => `(?:${p})`).join('|'))
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (!re.test(line)) return
      if (line.trimEnd().endsWith(ALLOW)) return
      hits.push({ file: `${dir}/${f}`, line: i + 1, text: line.trim().slice(0, 90) })
    })
  }
  return hits
}

const hits = DIRS.flatMap((d) => [scan(path.join(ROOT, d)), scan(path.join(ROOT, 'website/en', d.split('/')[1]))])
  .flat()

if (process.argv.includes('--fix-list')) {
  for (const h of hits) console.log(`${h.file}:${h.line}: ${h.text}`)
}
if (hits.length) {
  console.error(`❌ 全端视角写作门禁：${hits.length} 处疑似「双端世界观」句式（Web/小程序被当作框架完整答案）。`)
  console.error('   修法：改写为「按端 codegen / 已接线 Web·小程序 + 其余端直食语义 IR」；确为话题限定页请行尾加 ' + ALLOW)
  process.exit(1)
}
console.log('OK — 全端视角写作门禁通过（guides/framework zh+en 零违规）')
