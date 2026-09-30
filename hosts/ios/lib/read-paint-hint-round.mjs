#!/usr/bin/env node
// hosts/ios/lib/read-paint-hint-round.mjs —— 读一轮报告的 paint-hint 读数（单行摘要 + 变体自证）
//
// 【为什么独立成脚本】内联 `python3 -c "…"` 嵌在 shell 函数里时，与 shell 的引号规则冲突
//   （实测：把 `"$i"` 追加到 `python3 -c "…"` 之后 ⇒ 引号错配、整个脚本 unexpected EOF）。
//   独立脚本无嵌套问题，且能单独跑（对已有报告复读）。
//
// 用法：node read-paint-hint-round.mjs <report.json> <轮次标签> [expect_disabled: true|false]
//   传 expect 时：disabled ≠ expect ⇒ 退出码 3（装置自证失败——如"关闭态"其实没关，
//   或"开启态"没开）。paint_hint_env 一并打印：环境变量注入是否真的到达宿主，有读数可查。
import fs from 'node:fs'
const [file, label, expect] = process.argv.slice(2)
try {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'))
  const ph = (d?.js_report?.host_raw_by_phase) ?? {}
  let peak = 0
  let compact = 0
  let disabled = null
  let envRaw = null
  for (const r of Object.values(ph)) {
    if (!r) continue
    peak = Math.max(peak, Number(r.mem_peak_mb ?? 0))
    if ('paint_hint_compact' in r) {
      compact = r.paint_hint_compact
      disabled = r.paint_hint_disabled
      envRaw = r.paint_hint_env
    }
  }
  console.log(
    `    轮 ${label}：mem_peak=${peak}MB · compact=${compact} · disabled=${disabled} · env=${JSON.stringify(envRaw)}`
  )
  if (expect !== undefined && String(disabled) !== expect) {
    process.exit(3)
  }
} catch (e) {
  console.log(`    轮 ${label} 报告解析失败：${e.message}`)
  process.exit(1)
}
