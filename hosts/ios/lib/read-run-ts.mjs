#!/usr/bin/env node
// hosts/ios/lib/read-run-ts.mjs —— 读出报告里的 run_ts（A/B 脚本的 baseline 用）
// 用法：node read-run-ts.mjs <report.json>   → 打印数字；无该字段时打印 none
import fs from 'node:fs'
try {
  const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  const ts = Number(d?.run_ts)
  console.log(Number.isFinite(ts) ? String(ts) : 'none')
} catch {
  console.log('none')
}
