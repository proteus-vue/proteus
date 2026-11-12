// studio-panel-report.mjs —— 判据的**统一出口 + 自检**（决策 #1489）
//
// 【为什么单独成文件】`check-studio-panel.mjs` 已经 **998 行**、贴着 `check:file-size` 的
//   1000 行上限，**不能再加一行**。而这个自检必须挂在"所有判据都已收集完、还没打印"的位置。
//   所以把它做成模块：主脚本用 **1 行**调用，替掉原来的 4 行打印循环 —— 净减行数。
//
// 【它守的是什么】
//   ① **编号唯一**：出现两个 `㊿d` 时，人只会看到两条同号绿，**漏判无法察觉**；
//   ② **条数/编号集合与基线一致**：拆分或重构时，一条判据被顺手删掉，
//      门禁只会"少打印一行"，**依然全绿** —— 这是本仓最危险的一类退化（假绿）。
//      基线写在 `studio-panel-check-ids.json`，有意增删判据时必须**显式更新基线**。
//
// ★为什么基线要入库而不是运行时生成：运行时生成等于"现在有几条就承认几条"，
//   删掉一条后它会安静地重新生成 —— 那就不是判据，是橡皮章。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASELINE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'studio-panel-check-ids.json')

/** 判据编号 = 标签的第一个 token（`①` / `⑪c` / `㊿d`） */
export const idOf = (label) => (/^(\S+)/.exec(String(label))?.[1] ?? '?')

/**
 * 打印全部判据，并做编号自检。
 * @returns {number} 失败条数（含自检失败）—— 调用方用它决定退出码
 */
export function reportChecks(checks) {
  let bad = 0
  for (const [label, ok] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${label}`)
    if (!ok) bad++
  }

  const ids = checks.map(([label]) => idOf(label))
  const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
  const problems = []

  if (dup.length) problems.push(`判据编号重复：${dup.join('、')}（同号两条 ⇒ 其中一条被覆盖也看不出来）`)

  let base = null
  try {
    base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
  } catch {
    base = null
  }

  if (!base) {
    /* 首次运行：落一份基线，**不算失败**（否则新机器上永远是红的） */
    fs.writeFileSync(BASELINE, `${JSON.stringify({ count: ids.length, ids }, null, 2)}\n`)
    console.log(`  ↳ 已生成判据基线（${ids.length} 条）：${path.basename(BASELINE)}`)
  } else {
    const missing = base.ids.filter((id) => !ids.includes(id))
    const added = ids.filter((id) => !base.ids.includes(id))
    if (missing.length) {
      problems.push(
        `判据**丢失** ${missing.length} 条（${missing.join('、')}）—— 若是拆分搬走，请把新位置登记进基线；若是误删，门禁刚才会假绿`,
      )
    }
    if (added.length) {
      problems.push(`新增判据 ${added.length} 条（${added.join('、')}）—— 请显式更新基线：npm run check:studio-panel -- --update-ids`)
    }
  }

  if (problems.length) {
    for (const p of problems) console.log(`✗ 判据自检：${p}`)
    bad += problems.length
    /* `--update-ids`：有意增删判据时用它把基线刷成当前状态（**唯一**允许改基线的入口） */
    if (process.argv.includes('--update-ids')) {
      fs.writeFileSync(BASELINE, `${JSON.stringify({ count: ids.length, ids }, null, 2)}\n`)
      console.log(`  ↳ 基线已更新（${ids.length} 条）`)
    }
  }
  return bad
}
