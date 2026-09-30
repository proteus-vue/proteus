#!/usr/bin/env node
// scripts/gen-bridge-ext.mjs —— ★NC1 生成器：声明 → 能力桥代码（`packages/api/src/generated/bridge-ext.ts`）
//
// 【为什么生成（本仓纪律：手写 = 第 N 份副本）】wx 桥的核心是**高度模板化**的
//   `wx.api({...params, success, fail})` → Promise 包装 + `unsupported`/`failed` 双态诚实降级；
//   web 桥同理。手写这段每加一个能力就抄一遍 ⇒ 加一个维度必漏一处（本仓实测过 4 份副本的教训）。
//
// 【输入】`packages/api/src/bridge-decls/index.ts` 的 `BRIDGE_DECLS`（求值真实声明，非文本解析）
// 【输出】`packages/api/src/generated/bridge-ext.ts`（导出 mpBridgeExt / webBridgeExt）
// 【判据】`--check` 比对生成物与本次生成（漂移即红；接 verify/CI）
//
// 【诚实边界】生成物只覆盖**声明过的**能力（`Partial<CapabilityBridge>`）；未声明者仍走手写桥。
//   生成物在 capability.ts 里**真实合并**（createCapabilityBridge）——不是摆设。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT = path.join(ROOT, 'packages/api/src/generated/bridge-ext.ts')
const CHECK = process.argv.includes('--check')

// ── 求值真实声明（tsx 子进程；与 gen-capability-priority.mjs 同模式）──
const probe = `
import { BRIDGE_DECLS } from ${JSON.stringify(path.join(ROOT, 'packages/api/src/bridge-decls/index.ts'))}
console.log(JSON.stringify(BRIDGE_DECLS))
`
const raw = execFileSync('npx', ['tsx', '-e', probe], { cwd: ROOT, encoding: 'utf-8', timeout: 120000 })
const decls = JSON.parse(raw.trim().split('\n').pop())

// ── 生成 ────────────────────────────────────────────────────────────────
const lines = []
lines.push('// packages/api/src/generated/bridge-ext.ts')
lines.push('// ⚠️ **本文件由 `node scripts/gen-bridge-ext.mjs` 生成，勿手改**（`--check` 接门禁，漂移即红）')
lines.push('//')
lines.push('// 来源：`packages/api/src/bridge-decls/*.ts`（声明式能力定义——「声明一下接口」就是全部工作量）')
lines.push('// 判据：声明 → 生成 → 由 capability.ts **真实合并进 bridge**（生成物在运行路径上，不是摆设）')
lines.push('')
lines.push("import type { CapabilityBridge, WxLike } from '../capability'")
lines.push("import type { BridgeErrorCtor } from '../bridge-decl'")
lines.push('')
lines.push(`/** 本文件覆盖的能力数（供门禁/测试断言"生成物非空且与声明同数"） */`)
lines.push(`export const GENERATED_BRIDGE_COUNT = ${decls.length}`)
lines.push('')

/** 生成 MP 侧实现（模板化：callback / sync / unsupported） */
function mpImpl(d) {
  const P = d.params
  const sig = P.map((p) => `${p.name}: ${p.type}${p.default ? ` = ${p.default}` : ''}`).join(', ')
  const body = []
  const mp = d.mp
  if (mp.kind === 'unsupported') {
    body.push(`    ${d.method}: async (${sig}) => {`)
    body.push(`      throw new CapErrorCtor('${d.errPrefix}.unsupported', ${JSON.stringify(mp.reason ?? `${d.hook}：MP 端无对等 API`)})`)
    body.push('    },')
  } else if (mp.kind === 'callback') {
    const mapped = Object.entries(mp.map)
      .map(([wxKey, paramName]) => `${wxKey}: ${paramName}`)
      .join(', ')
    const guardName = `wx.${mp.api}`
    body.push(`    ${d.method}: (${sig}) =>`)
    body.push('      new Promise((resolve, reject) => {')
    body.push(`        if (typeof ${guardName} !== 'function') return reject(new CapErrorCtor('${d.errPrefix}.unsupported', '${guardName} 缺失'))`)
    body.push(`        ${guardName}({`)
    body.push(`          ${mapped},`)
    body.push(`          success: () => resolve(),`)
    body.push(`          fail: (e: unknown) => reject(new CapErrorCtor('${d.errPrefix}.failed', '${guardName} 失败', e)),`)
    body.push('        })')
    body.push('      }),')
  } else if (mp.kind === 'sync') {
    body.push(`    ${d.method}: async (${sig}) => {`)
    body.push(`      if (typeof wx.${mp.api} !== 'function') throw new CapErrorCtor('${d.errPrefix}.unsupported', 'wx.${mp.api} 缺失')`)
    body.push(`      ${mp.call}`)
    body.push('    },')
  }
  return { sig, body: body.join('\n') }
}

/** 生成 Web 侧实现（模板化：direct / stateful / unsupported） */
function webImpl(d) {
  const P = d.params
  const sig = P.map((p) => `${p.name}: ${p.type}${p.default ? ` = ${p.default}` : ''}`).join(', ')
  const body = []
  const web = d.web
  if (web.kind === 'unsupported') {
    body.push(`    ${d.method}: async (${sig}) => {`)
    body.push(`      throw new CapErrorCtor('${d.errPrefix}.unsupported', ${JSON.stringify(web.reason ?? `${d.hook}：Web 端无对等 API`)})`)
    body.push('    },')
  } else if (web.kind === 'direct') {
    const guard = web.guard ? `if (!(${web.guard})) throw new CapErrorCtor('${d.errPrefix}.unsupported', '${web.guard} 不支持')` : ''
    // $0/$1… → 参数名
    const call = web.call.replace(/\$(\d+)/g, (_, i) => P[Number(i)]?.name ?? `$arg${i}`)
    body.push(`    ${d.method}: async (${sig}) => {`)
    if (guard) body.push(`      ${guard}`)
    body.push(`      await ${call}`)
    body.push('    },')
  } else if (web.kind === 'stateful') {
    const guard = web.guard ? `if (!(${web.guard})) throw new CapErrorCtor('${d.errPrefix}.unsupported', '${web.guard} 不支持')` : ''
    const main = P[0]?.name ?? 'on'
    // ★stateful 语义：开 = 取句柄并持有；关 = 释放并清空。重复开/关**幂等**（不重复获取/重复释放
    //   ——Wake Lock 重复 request 会叠加系统引用计数，不是幂等操作；这里在桥层收敛为幂等语义）
    const onExpr = web.onExpr.replace(/\$0\b/g, main)
    const offExpr = web.offExpr.replace(/\$0\b/g, main)
    body.push(`    ${d.method}: (() => {`)
    body.push('      let sentinel: unknown = null')
    body.push(`      return async (${sig}) => {`)
    if (guard) body.push(`        ${guard}`)
    body.push(`        if (${main}) {`)
    body.push('          if (sentinel) return')
    body.push(`          sentinel = ${onExpr.startsWith('await ') ? onExpr : 'await ' + onExpr}`)
    body.push('        } else {')
    body.push('          if (!sentinel) return')
    body.push(`          ${offExpr}`)
    body.push('          sentinel = null')
    body.push('        }')
    body.push('      }')
    body.push('    })(),')
  }
  return { sig, body: body.join('\n') }
}

lines.push('/** MP 侧：声明式生成的能力桥（由 createCapabilityBridge 合并进 wxBridge 结果） */')
lines.push('export function mpBridgeExt(wx: WxLike, CapErrorCtor: BridgeErrorCtor): Partial<CapabilityBridge> {')
lines.push('  return {')
for (const d of decls) {
  lines.push(`    // ${d.id} ${d.hook}：${d.doc}`)
  lines.push(mpImpl(d).body)
}
lines.push('  }')
lines.push('}')
lines.push('')

lines.push('/** Web 侧：声明式生成的能力桥（由 createCapabilityBridge 合并进 webBridge 结果） */')
lines.push('export function webBridgeExt(g: typeof globalThis, CapErrorCtor: BridgeErrorCtor): Partial<CapabilityBridge> {')
lines.push('  const nav = (g as { navigator?: { wakeLock?: { request(type?: string): Promise<unknown> } } }).navigator')
lines.push('  return {')
for (const d of decls) {
  lines.push(`    // ${d.id} ${d.hook}：${d.doc}`)
  lines.push(webImpl(d).body)
}
lines.push('  }')
lines.push('}')
lines.push('')

const content = lines.join('\n')

if (CHECK) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  if (cur !== content) {
    console.error('DRIFT: packages/api/src/generated/bridge-ext.ts 与声明不一致 —— 运行 node scripts/gen-bridge-ext.mjs 并提交')
    process.exit(1)
  }
  console.log(`CHECK OK — 能力桥生成物与声明一致（${decls.length} 个声明式能力）`)
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, content)
  console.log(`generated: ${path.relative(ROOT, OUT)}（${decls.length} 个声明式能力：${decls.map((d) => d.id + ' ' + d.hook).join(' · ')}）`)
}
