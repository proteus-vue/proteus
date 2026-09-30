#!/usr/bin/env node
// scripts/check-capability-golden.mjs —— ★HA3 跨语言 golden **新鲜度**门禁
//
// 【为什么需要（本仓纪律：跨语言契约只能有一份来源）】`packages/host-abi/tests/golden/
//   capability-manifest.json` 是**TS 侧真实产出**的冻结副本（来源 = `scanCapabilities`，
//   即 CLI `proteus capabilities:manifest` 调用的同一个函数），供 Rust 侧消费。
//
//   Rust 侧的消费判据（`capability_manifest_golden_is_accepted`）只能证明"**冻结的那一刻**
//   两边一致"——若之后 TS 侧改了 manifest 形状（字段改名/增删）而 golden 没重新生成：
//     · Rust 侧测试**照样绿**（它读的是旧 golden）⇒ **静默失效**；
//     · 真正的不一致要等到端上"能力校验永远通过/永远失败"才暴露。
//   ⇒ 本门禁在**每次跑门禁时重新生成**并与冻结副本逐字节比对——**TS 侧一动，这里就红**。
//
// 【与 golden 生成器同源】比对用的就是 README 里那段生成命令的**同一个调用**
//   （`scanCapabilities` + 相同序列化），否则"新鲜度"就是自己跟自己对。
//
// 用法：node scripts/check-capability-golden.mjs [--update]
//   无参数 = 校验（不一致 ⇒ exit 1，并提示 --update）；
//   --update = 重新生成（改了 examples/capabilities 或 scan.ts 的 manifest 形状后跑一次）。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const GOLDEN = path.join(ROOT, 'packages/host-abi/tests/golden/capability-manifest.json')
const UPDATE = process.argv.includes('--update')

// ── 用 tsx 求值真实 scanCapabilities（与 golden README 的生成命令逐字一致）──
const probe = `
import { scanCapabilities } from ${JSON.stringify(path.join(ROOT, 'packages/capabilities/src/scan.ts'))}
scanCapabilities(${JSON.stringify(path.join(ROOT, 'examples'))}).then(({ manifest }) => {
  process.stdout.write(JSON.stringify(manifest))
})
`
const raw = execFileSync('npx', ['tsx', '-e', probe], { cwd: ROOT, encoding: 'utf-8', timeout: 180000 })
// execFileSync 的输出可能带 tsx 的旁路日志 ⇒ 取最后一个 JSON 对象所在行
const jsonLine = raw
  .trim()
  .split('\n')
  .reverse()
  .find((l) => l.trim().startsWith('{'))
if (!jsonLine) {
  console.error('[cap-golden] ✗ 未能从 tsx 输出中解析出 manifest')
  process.exit(1)
}
const fresh = JSON.stringify(JSON.parse(jsonLine.trim()), null, 2) + '\n'

if (UPDATE) {
  fs.writeFileSync(GOLDEN, fresh)
  console.log(`[cap-golden] ✅ 已更新 golden（${path.relative(ROOT, GOLDEN)}）`)
  process.exit(0)
}

const frozen = fs.existsSync(GOLDEN) ? fs.readFileSync(GOLDEN, 'utf-8') : ''
if (frozen !== fresh) {
  console.error('[cap-golden] ✗ golden 与 TS 侧**当前产出**不一致（跨语言契约漂移）：')
  console.error(`    冻结：${path.relative(ROOT, GOLDEN)}`)
  console.error('    来源：scanCapabilities(examples) —— 即 CLI `proteus capabilities:manifest` 的同一个函数')
  console.error('  ⇒ 若刚改了 capabilities/*.capability.ts 或 scan.ts 的 manifest 形状，跑：')
  console.error('     node scripts/check-capability-golden.mjs --update')
  console.error('  ⇒ 并把 host-abi 侧的消费判据（capability_manifest_golden_is_accepted）一并确认')
  // 差异摘要（只报前几行，避免输出爆炸）
  const a = frozen.split('\n')
  const b = fresh.split('\n')
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.error(`    首个差异 @ 第 ${i + 1} 行：`)
      console.error(`      冻结：${(a[i] ?? '(缺行)').trim()}`)
      console.error(`      当前：${(b[i] ?? '(缺行)').trim()}`)
      break
    }
  }
  process.exit(1)
}
console.log(`[cap-golden] ✅ 跨语言 golden 与 TS 侧产出一致（${JSON.parse(fresh).capabilities.length} 项能力）`)
