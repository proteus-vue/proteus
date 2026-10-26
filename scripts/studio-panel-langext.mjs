// scripts/studio-panel-langext.mjs —— 语言覆盖表（判据 ⑳ 的采集段，决策 #1265 从门禁拆出）
//
// 【它回答什么】树里出现的每个扩展名，都必须有归属（语言包 or 显式登记为纯文本）。
//   这是"防静默掉队"的判据：新增一个 .tsx 却没人接语言包时，⑲ 系列不会红
//   （它只测已打开的那几个文件），但 ⑳ 会。
// 【基准】取 `ui/src/languages.json` —— 与 UI 同一份数据，不另立一份清单。
import fs from 'node:fs'
import path from 'node:path'

/**
 * @param {string} studio packages/studio 绝对路径
 * @returns {{ missing: string[], seen: number }}
 */
export function langExtCoverage(studio) {
  const map = JSON.parse(fs.readFileSync(path.join(studio, 'ui', 'src', 'languages.json'), 'utf8'))
  const known = new Set([...Object.keys(map.languages ?? {}), ...Object.keys(map.plain ?? {})])
  const ROOTS = ['ui/src', 'src', 'native'] // ★必须与 CodePanel 的 ROOTS 一致
  const seen = new Set()
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else {
        const dot = e.name.lastIndexOf('.')
        if (dot > 0) seen.add(e.name.slice(dot).toLowerCase())
      }
    }
  }
  for (const r of ROOTS) walk(path.join(studio, r))
  return { missing: [...seen].filter((e) => !known.has(e)).sort(), seen: seen.size }
}
