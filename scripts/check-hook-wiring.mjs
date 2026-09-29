#!/usr/bin/env node
// scripts/check-hook-wiring.mjs —— ★★门禁：本仓的**工具层红线 hook** 是否已接线
//
// 【为什么需要（与其它门禁同源，但这次是"门禁自己"没被门禁管）】
//   本仓三条红线靠 **PreToolUse hook** 强制（sleep 盲等 / 全量测试重复跑 / 全量门禁链重复跑）——
//   而它们都依赖 `.zcode/config.json`（**gitignored 的本地配置**）。
//   ⇒ 新机器 / 新 worktree 上**三个 hook 一个都不存在**，而"没人会收到任何提示"：
//     红线静默失效，直到下一次有人又跑一小时没结果。
//   ★这与「接线不靠记忆」是同一条纪律——**只是这次要接的线是 hook 自己**。
//
// 【判据（分两种情况，语义不同）】
//   · `.zcode/config.json` **不存在** ⇒ **不判红**（CI / 干净克隆的正常状态），
//     但打印**可直接粘贴的安装片段**（并说明"补齐后需重启会话才生效"）。
//   · **存在** ⇒ 必须满足三条，否则红（这是本地配置"接了一半"的真实缺陷）：
//       ① `hooks.enabled === true`（否则配置文件的 hooks **默认不运行**——实测踩过）
//       ② PreToolUse 里挂上了**全部三个** hook 脚本（缺一个 = 一条红线失效）
//       ③ 每个被引用的脚本文件**确实存在**（引用已删除的脚本 = 静默失效）
//
// 用法：node scripts/check-hook-wiring.mjs
// 退出码：0 通过（含"未安装但已给出指引"）/ 1 本地配置有缺陷
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = path.join(ROOT, '.zcode', 'config.json')

/** 红线 hook 清单（**唯一事实来源**：加新 hook 时改这里，门禁与安装片段一起更新） */
const REQUIRED_HOOKS = [
  ['deny-sleep.mjs', '固定 sleep 盲等'],
  ['deny-blind-tests.mjs', '全量测试无目的重复跑'],
  ['deny-blind-verify.mjs', '全量门禁链无目的重复跑'],
]

/** 生成可直接粘贴的安装片段（★必须是**合法 JSON**——注释放在块外，
 *  因为 JSON 不支持行尾注释；首版把 `← why` 写在行内 ⇒ 粘进去就是语法错误） */
const snippet = () => {
  const hooks = REQUIRED_HOOKS.map(
    ([f], i) =>
      `        { "type": "process", "command": "node",\n` +
      `          "args": ["\${ZCODE_PROJECT_DIR}/scripts/hooks/${f}"], "timeoutMs": ${5000 + i * 2000} }` +
      (i === REQUIRED_HOOKS.length - 1 ? '' : ','),
  ).join('\n')
  const legend = REQUIRED_HOOKS.map(([f, why], i) => `    · ${f}${' '.repeat(Math.max(0, 22 - f.length))}← ${why}`).join('\n')
  return (
    '    { "hooks": { "enabled": true, "events": { "PreToolUse": [\n' +
    '      { "matcher": "Bash", "hooks": [\n' +
    `${hooks}\n` +
    '      ] } ] } } }\n' +
    '    （逐条含义：\n' + legend + '）'
  )
}

if (!fs.existsSync(CONFIG)) {
  console.log('hook 接线检查：`.zcode/config.json` 不存在（CI / 干净克隆的正常状态，不判红）')
  console.log('  ⚠ 但请注意：本仓**三条工具层红线**（sleep 盲等 / 全量测试重复跑 / 全量门禁链重复跑）')
  console.log('    依赖该文件才生效 ⇒ 当前**未受保护**。要启用，把下面这段写进 `.zcode/config.json`：')
  console.log()
  console.log(snippet())
  console.log()
  console.log('  ★写完后**必须重启会话**（ZCode 在会话启动时读取 hooks 源，中途创建不生效）。')
  process.exit(0)
}

let cfg
try {
  cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
} catch (e) {
  console.error(`❌ .zcode/config.json 不是合法 JSON：${e.message}`)
  process.exit(1)
}

const fails = []
const hooksCfg = cfg.hooks

if (!hooksCfg) {
  fails.push('缺少 `hooks` 段（该文件存在但没有任何 hook 配置 ⇒ 三条红线全部失效）')
} else {
  if (hooksCfg.enabled !== true) {
    fails.push('`hooks.enabled` 不是 true —— 本仓实测：**不设它，配置文件的 hooks 默认不运行**')
  }
  // 收集所有被引用的 hook 脚本（PreToolUse 及其它事件都算——顺序不限）
  const referenced = new Set()
  const events = hooksCfg.events ?? {}
  for (const [event, matchers] of Object.entries(events)) {
    if (!Array.isArray(matchers)) continue
    for (const m of matchers) {
      for (const h of Array.isArray(m?.hooks) ? m.hooks : []) {
        for (const arg of Array.isArray(h?.args) ? h.args : []) {
          if (typeof arg === 'string') referenced.add(path.basename(arg))
        }
      }
    }
  }
  for (const [file, why] of REQUIRED_HOOKS) {
    if (!referenced.has(file)) {
      fails.push(`未接线：${file}（红线「${why}」当前**没有**工具层拦截）`)
    } else if (!fs.existsSync(path.join(ROOT, 'scripts', 'hooks', file))) {
      fails.push(`引用了不存在的脚本：${file}（配置指向已删除的文件 ⇒ 静默失效）`)
    }
  }
}

if (fails.length) {
  console.error('❌ hook 接线检查未通过：\n')
  for (const f of fails) console.error(`  - ${f}`)
  console.error('\n  修法（把三条件齐的配置写入 `.zcode/config.json`，然后**重启会话**）：\n')
  console.error(snippet())
  process.exit(1)
}

console.log(`✅ hook 接线检查通过（${REQUIRED_HOOKS.length} 条工具层红线全部生效：${REQUIRED_HOOKS.map(([f]) => f.replace(/^deny-|\.mjs$/g, '')).join(' / ')}）`)
