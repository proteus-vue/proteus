#!/usr/bin/env node
// hosts/ios/lib/check-report-build-id.mjs —— 报告的 build_id 是否等于本次构建（内容级断言）
// 用法：node check-report-build-id.mjs <report.json> <build_id>   （退出码 0 = 匹配）
import fs from 'node:fs'
const [file, want] = process.argv.slice(2)
try {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'))
  const got = (d?.js_report ?? {}).build_id
  if (got === want) process.exit(0)
  console.log(`build_id 不符：报告=${JSON.stringify(got)} 期望=${JSON.stringify(want)}`)
  process.exit(1)
} catch (e) {
  console.log(`报告解析失败：${e.message}`)
  process.exit(1)
}
