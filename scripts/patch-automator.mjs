// scripts/patch-automator.mjs
// ★B5 真机实测：miniprogram-automator 0.12.1（2021 年包）与新版微信开发者工具（2.01.x）兼容补丁
// 问题：新版 IDE 的 Tool.getInfo 响应缺 SDKVersion 字段 → automator checkVersion 读 undefined.split 崩
// 补丁：SDKVersion 缺失 → 视为满足版本校验（"3.0.0"）；幂等（MARK 检测）
import fs from 'node:fs'
import path from 'node:path'

const file = path.resolve('node_modules/miniprogram-automator/out/MiniProgram.js')
const MARK = '// proteus-automator-patch'

if (!fs.existsSync(file)) {
  console.log('[patch-automator] miniprogram-automator 未安装，跳过')
  process.exit(0)
}
let src = fs.readFileSync(file, 'utf-8')
if (src.includes(MARK)) {
  console.log('[patch-automator] 已打过补丁，跳过')
  process.exit(0)
}
const from =
  'async checkVersion(){let t="";if(t=(await this.send("Tool.getInfo")).SDKVersion,"dev"!==t&&cmpVersion_1.default(t,"2.7.3")<0)'
const to =
  'async checkVersion(){let t="";const e=(await this.send("Tool.getInfo"))||{};if(t=e.SDKVersion||"3.0.0","dev"!==t&&cmpVersion_1.default(t,"2.7.3")<0)'
if (!src.includes(from)) {
  console.error(`[patch-automator] 未找到目标代码（automator 版本变化？检查 ${from.slice(0, 60)}...）`)
  process.exit(1)
}
src = src.replace(from, to).replace(/async checkVersion\(\)\{/, `async checkVersion(){${MARK}`)
fs.writeFileSync(file, src)
console.log('[patch-automator] 已应用 SDKVersion 容错补丁（新 IDE Tool.getInfo 缺 SDKVersion → 视为满足版本校验）')
