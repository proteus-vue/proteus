#!/usr/bin/env node
// hosts/ios/lib/has-paint-hint-field.mjs —— 报告里是否含**本轮才有**的 paint-hint 字段
//
// 【为什么单独成脚本（不内联 python -c）】内联 heredoc 嵌进函数体时与 shell 引号规则冲突
//   （实测：直接把 `python3 -c "…"` 放进 `run_variant` 里 ⇒ bash 报 unexpected end of file）。
//   独立脚本没有引号嵌套问题，且能单独跑（对已有报告复判）。
//
// 判据：`js_report.host_raw_by_phase.*` 中**至少一处**有 `paint_hint_disabled`。
//   该字段是本轮（A/B 开关）新增的 ⇒ 它的在场同时证明"报告是新二进制写的"。
// 用法：node has-paint-hint-field.mjs <report.json>   （退出码 0 = 有；1 = 无/解析失败）
import fs from 'node:fs'
try {
  const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  const ph = (d?.js_report?.host_raw_by_phase) ?? {}
  const ok = Object.values(ph).some((r) => r && 'paint_hint_disabled' in r)
  process.exit(ok ? 0 : 1)
} catch {
  process.exit(1)
}
