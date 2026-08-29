// packages/capabilities/src/check.ts
// ★platform-plan B3（M3 编译期分叉 §7）：能力缺失编译期可见——
//   useCapability('id') 业务引用扫描 → 对照 manifest 平台覆盖 → 缺失报告（编译期报错/警告，可配置）
//   平台裁剪原则：业务代码不变，产物只含当前平台 adapter（运行时 registry 已按平台探测选择）
import fs from 'node:fs'
import path from 'node:path'
import type { CapabilityManifest, ManifestCapabilityEntry } from './scan'

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.proteus', '.transform-debug', 'coverage'])

export interface CapabilityUsage {
  file: string
  /** 业务引用的能力 id（useCapability('share') / resolveCapability('share')） */
  ids: string[]
}

export interface CapabilityCheckResult {
  usages: CapabilityUsage[]
  /** 缺失：业务引用但当前平台无 adapter 的能力 */
  missing: Array<{ id: string; usedBy: string[] }>
  /** 平台覆盖缺口：manifest 有能力但当前平台无 adapter */
  gaps: ManifestCapabilityEntry[]
}

/** 扫描业务代码 useCapability('id') / resolveCapability('id') 引用（.vue script / .ts 业务文件） */
export function scanCapabilityUsage(root: string): CapabilityUsage[] {
  const out: CapabilityUsage[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(vue|ts)$/.test(entry.name)) continue
      const src = fs.readFileSync(full, 'utf-8')
      const script = entry.name.endsWith('.vue') ? (src.match(/<script[^>]*>([\s\S]*?)<\/script>/i)?.[1] ?? '') : src
      const ids = [...new Set(Array.from(script.matchAll(/\b(?:useCapability|resolveCapability)<?[A-Za-z_$]*>?\(['"]([^'"]+)['"]/g), (m) => m[1]))]
      if (ids.length) out.push({ file: path.relative(root, full).replace(/\\/g, '/'), ids })
    }
  }
  walk(root)
  return out
}

/** ★B3：业务引用 vs 平台覆盖——缺失报告（纯函数） */
export function checkCapabilityUsage(manifest: CapabilityManifest, usages: CapabilityUsage[], platform: 'web' | 'skyline' | 'app'): CapabilityCheckResult {
  const byId = new Map(manifest.capabilities.map((c) => [c.id, c]))
  const missing = new Map<string, string[]>()
  for (const u of usages) {
    for (const id of u.ids) {
      const entry = byId.get(id)
      if (!entry || !entry.platforms.includes(platform)) {
        const list = missing.get(id) ?? []
        list.push(u.file)
        missing.set(id, list)
      }
    }
  }
  const gaps = manifest.capabilities.filter((c) => !c.platforms.includes(platform))
  return {
    usages,
    missing: [...missing.entries()].map(([id, usedBy]) => ({ id, usedBy })),
    gaps,
  }
}

// ==================== ★B5：平台原生模块规范（§6 禁止清单 + §7 静态检查） ====================

/** 平台文件判定：文件名含 .web./.skyline./.app./.mp.（MP 入口）或位于 adapters/ platforms/ 目录 */
const PLATFORM_FILE_RE = /\.(web|skyline|app|mp)\.|\/(adapters|platforms)\//

/** 业务目录（禁止平台 API 裸调用）；capabilities/adapters/platforms/shims 除外 */
const BUSINESS_EXCLUDE = ['capabilities', 'adapters', 'platforms', 'shims', 'node_modules', 'dist']

/** 平台 API 裸调用（wx.setStorageSync( / window.location = 等；非 declare 类型声明） */
const PLATFORM_API_RE = /\b(?:wx|window)\.[A-Za-z_$][\w$]*\s*(\(|=|;|\.)/g

export interface PlatformViolation {
  file: string
  match: string
  rule: string
}

/**
 * ★B5 §7 静态检查：平台原生能力只能在指定目录（铁律）
 * - 平台文件（*.skyline.ts / adapters/ 等）：skyline/app 文件禁 window.；web 文件禁 wx.
 * - 业务目录（pages/components/stores 等）：禁 wx.* / window.* 裸调用（走 capability）
 */
export function scanPlatformViolations(root: string): PlatformViolation[] {
  const out: PlatformViolation[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(vue|ts)$/.test(entry.name)) continue
      const rel = path.relative(root, full).replace(/\\/g, '/')
      const src = fs.readFileSync(full, 'utf-8')
      const script = entry.name.endsWith('.vue') ? (src.match(/<script[^>]*>([\s\S]*?)<\/script>/i)?.[1] ?? '') : src
      const isPlatformFile = PLATFORM_FILE_RE.test(rel)
      if (isPlatformFile) {
        // 平台文件：skyline/app 禁 window；web 禁 wx
        if (/\.(skyline|app|mp)\./.test(rel) || rel.includes('/platforms/skyline') || rel.includes('/platforms/app')) {
          for (const m of script.matchAll(/\bwindow\.[A-Za-z_$][\w$]*\s*(\(|=|;|\.)/g)) {
            out.push({ file: rel, match: m[0].trim(), rule: '平台文件（skyline/app）禁止 window.*（web API 泄漏）' })
          }
        }
        if (/\.web\./.test(rel) || rel.includes('/platforms/web')) {
          for (const m of script.matchAll(/\bwx\.[A-Za-z_$][\w$]*\s*(\(|=|;|\.)/g)) {
            out.push({ file: rel, match: m[0].trim(), rule: '平台文件（web）禁止 wx.*（MP API 泄漏）' })
          }
        }
      } else if (!BUSINESS_EXCLUDE.some((seg) => rel.split('/').includes(seg))) {
        // 业务目录：禁 wx.* / window.* 裸调用
        for (const m of script.matchAll(PLATFORM_API_RE)) {
          out.push({ file: rel, match: m[0].trim(), rule: '业务目录禁止平台 API 裸调用（走 capability/useCapability，platform-plan B5 §6）' })
        }
      }
    }
  }
  walk(root)
  return out
}
