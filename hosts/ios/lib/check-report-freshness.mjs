#!/usr/bin/env node
// hosts/ios/lib/check-report-freshness.mjs —— 「报告是不是**本轮**写出来的」内容级判据
//
// 【为什么必须有（2026-09-30 实测踩到的装置缺陷）】原轮询只查"paint_hint 字段存在"
//   ⇒ 设备上**上一轮（甚至上一版二进制）留下的残留报告**同样满足：两个变体其实在同一份
//   旧数据上比 ⇒ 差值恒 0，且 `disabled=false` 被误读成"环境变量未生效"。
//   run-selfdraw.sh 用 `build_id` 防旧**构建**，但同一二进制连跑多轮时 build_id 不变
//   ⇒ A/B 脚本需要**每轮唯一**的痕迹：宿主在报告里写 `run_ts`（写出时刻，Unix 秒）。
//
// 【为什么对照设备上旧报告的 run_ts（baseline），而不是对照本机 launch 时刻】
//   Mac 与 iPhone 的墙钟**未取证前不得假定一致**（跨机器时钟比较是自找的假判据）。
//   与设备自己上一份报告比"变了没有"，完全不涉跨机器时钟。
//   baseline=none（设备上无旧报告）⇒ 任何带 run_ts 的报告都算新。
//
// 【为什么独立成脚本（不内联 node -e）】内联脚本嵌进 shell 函数体时与引号规则冲突
//   （本仓实测教训）；独立文件无嵌套问题，且能单独跑（夹具自测见文件尾注释）。
//
// 退出码：0 = 新鲜；2 = 仍为 baseline 的旧报告；3 = 缺 run_ts 字段（旧二进制产物）；
//   1 = 解析失败（可能拷贝到写入中途的半截文件）。非 0 时 stdout 打一行可归因说明。
// 用法：node check-report-freshness.mjs <report.json> <baseline_ts|none>
import fs from 'node:fs'
const [file, baseArg] = process.argv.slice(2)
let d
try {
  d = JSON.parse(fs.readFileSync(file, 'utf8'))
} catch {
  process.exit(1)
}
const ts = Number(d?.run_ts)
const base = baseArg === undefined || baseArg === 'none' ? null : Number(baseArg)
if (!Number.isFinite(ts)) {
  console.log(`缺 run_ts（旧二进制写的报告？）——baseline=${baseArg}`)
  process.exit(3)
}
if (base !== null && ts === base) {
  console.log(`run_ts=${ts} 与 baseline 相同 ⇒ 仍是旧报告`)
  process.exit(2)
}
process.exit(0)
