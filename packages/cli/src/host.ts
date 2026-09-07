// packages/cli/src/host.ts
// ★G-45 B3（proteus-dev-host-plan batches B3）：调试基座 CLI——`proteus host push <module-dir>`
//   插件模块目录前置校验（CMP084/087 的 CLI 侧门）+ push 信封生成（manifestHash/bundleHash 计算）
//   · proteus.plugin.json 完整性（id/version/capabilities/signature）
//   · 签名格式（sig-*，G-42 网关同源）· conformance/ 用例覆盖 ≥ 能力数（CMP087）
//   · bundle = src/ 源码聚合 → bundleHash；manifestHash = canonical JSON → FNV-1a（G-45.8）
//   · devices/logs/serve 随 B4 transport 适配器落地（本批诚实不做假实现）
import fs from 'node:fs'
import path from 'node:path'
import { computeBundleHash, computeManifestHash } from '@proteus-vue/dev-host'
import type { BackendManifest } from '@proteus-vue/dev-host'

/* ================= 参数解析 ================= */

export type HostArgs = { sub: 'push'; moduleDir: string }

export function parseHostArgs(rest: string[]): HostArgs {
  const [sub, ...opts] = rest
  if (sub === 'push') {
    const dir = opts.find((o) => !o.startsWith('--'))
    if (!dir) throw new Error('proteus host push 需要 <module-dir> 参数')
    return { sub: 'push', moduleDir: dir }
  }
  if (sub === 'devices' || sub === 'logs' || sub === 'serve') {
    throw new Error(`proteus host ${sub} 随 B4 transport 适配器（HTTP/WS）落地——本批提供 push（模块前置校验 + push 信封生成）`)
  }
  throw new Error(`未知的 host 子命令: ${sub ?? '(空)'}（支持：push）`)
}

/* ================= 模块目录校验 ================= */

export interface ModuleValidationError {
  code:
    | 'G45_MANIFEST_MISSING'
    | 'G45_MANIFEST_INCOMPLETE'
    | 'G45_SIGN'
    | 'G45_CONFORMANCE_COVERAGE'
  msg: string
}

export interface ModuleValidation {
  ok: boolean
  moduleDir: string
  errors: ModuleValidationError[]
  manifest: BackendManifest | null
  manifestHash: string | null
  bundleHash: string | null
  conformanceFiles: string[]
  bundleFiles: number
  bundleBytes: number
}

const BUNDLE_EXTS = new Set(['.ts', '.js', '.mjs', '.cjs', '.kt', '.swift', '.ets'])
const CONFORMANCE_EXTS = new Set(['.json', '.tir.json'])

function collectFiles(dir: string, exts: (p: string) => boolean, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collectFiles(full, exts, out)
    else if (exts(e.name)) out.push(full)
  }
  return out
}

/** 校验插件模块目录结构（push 前置门：server/设备门禁的 CLI 侧提前量） */
export function validateModuleDir(dir: string): ModuleValidation {
  const errors: ModuleValidationError[] = []
  const abs = path.resolve(dir)
  const conformanceFiles = collectFiles(path.join(abs, 'conformance'), (n) =>
    CONFORMANCE_EXTS.has(n.endsWith('.tir.json') ? '.tir.json' : path.extname(n))
  )

  let manifest: BackendManifest | null = null
  const pluginJsonPath = path.join(abs, 'proteus.plugin.json')
  if (!fs.existsSync(pluginJsonPath)) {
    errors.push({ code: 'G45_MANIFEST_MISSING', msg: '缺少 proteus.plugin.json（插件 manifest）' })
  } else {
    try {
      manifest = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8')) as BackendManifest
      if (!manifest.id || !manifest.version || !Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
        errors.push({ code: 'G45_MANIFEST_INCOMPLETE', msg: 'manifest 缺少 id/version/capabilities（CMP084）' })
      } else if (typeof manifest.signature !== 'string' || !/^sig-[a-z0-9]+$/.test(manifest.signature)) {
        errors.push({ code: 'G45_SIGN', msg: `signature 格式非法（须 sig-*）：${String(manifest.signature)}（CMP084）` })
      } else if (conformanceFiles.length < manifest.capabilities.length) {
        errors.push({
          code: 'G45_CONFORMANCE_COVERAGE',
          msg: `conformance 用例 ${conformanceFiles.length} < 能力数 ${manifest.capabilities.length}（CMP087 每能力 ≥1 例）`,
        })
      }
    } catch (e) {
      errors.push({ code: 'G45_MANIFEST_INCOMPLETE', msg: `proteus.plugin.json 解析失败：${e instanceof Error ? e.message : String(e)}` })
    }
  }

  // bundle：src/ 源码聚合（按相对路径排序保证确定性）
  const srcFiles = collectFiles(path.join(abs, 'src'), (n) => BUNDLE_EXTS.has(path.extname(n))).sort()
  let bundle = ''
  for (const f of srcFiles) {
    bundle += `\n// ---- ${path.relative(abs, f)} ----\n${fs.readFileSync(f, 'utf8')}`
  }

  return {
    ok: errors.length === 0,
    moduleDir: abs,
    errors,
    manifest,
    manifestHash: manifest ? computeManifestHash(manifest) : null,
    bundleHash: bundle ? computeBundleHash(bundle) : null,
    conformanceFiles,
    bundleFiles: srcFiles.length,
    bundleBytes: bundle.length,
  }
}

/* ================= 报告与执行 ================= */

export function formatHostPushReport(v: ModuleValidation): string[] {
  const lines: string[] = []
  lines.push(`[proteus host push] 模块校验：${v.moduleDir}`)
  if (v.manifest) {
    lines.push(`  插件：${v.manifest.id}@${v.manifest.version} · 能力：${v.manifest.capabilities.join(', ')}`)
    lines.push(`  manifestHash：${v.manifestHash}`)
    lines.push(`  bundle：${v.bundleFiles} 个源文件（${v.bundleBytes} bytes）→ bundleHash ${v.bundleHash}`)
    lines.push(`  conformance：${v.conformanceFiles.length} 例（能力数 ${v.manifest.capabilities.length}）`)
  }
  if (v.ok) {
    lines.push(`  ✅ PASS——push 信封就绪（dev server push 后由设备端门禁链 + NAT-C 快检兜底）`)
    lines.push(`  envelope: ${JSON.stringify({
      type: 'module-push',
      manifest: { ...(v.manifest as BackendManifest), manifestHash: v.manifestHash },
      bundleHash: v.bundleHash,
    })}`)
  } else {
    for (const e of v.errors) lines.push(`  ❌ ${e.code}：${e.msg}`)
    lines.push(`  ❌ FAIL——拒绝生成 push 信封（${v.errors.length} 项门禁未过）`)
  }
  return lines
}

/** `proteus host push <dir>` 执行：校验 + 报告；返回 exit code（FAIL → 1，CI 阻断） */
export function runHostPush(args: Extract<HostArgs, { sub: 'push' }>): number {
  const v = validateModuleDir(args.moduleDir)
  for (const line of formatHostPushReport(v)) console.log(line)
  return v.ok ? 0 : 1
}
