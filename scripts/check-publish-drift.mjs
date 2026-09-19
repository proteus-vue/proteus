#!/usr/bin/env node
// scripts/check-publish-drift.mjs —— ★npm 发布漂移检测（「同版本号 ⇒ 内容须一致」）
//
// 背景（2026-09-19 实战事故）：另一个项目用 npm 上的 `@proteus-vue/cli@0.3.0-beta.2` **启动即崩**——
//   它顶层 import `createFlamegraphCollector`（来自 devtools-runtime），而 npm 上的
//   `devtools-runtime@0.1.0` **只有 8 个导出**（本地源码有 30+）。根因是 `scripts/publish-all.sh`：
//   「registry 已有该版本 → 跳过」无法区分「幂等重跑」与「改了源码但忘了 bump 版本号」，
//   后者会让新内容永远发不出去，而依赖方 bump 后声明旧版本号 → 拿到的仍是旧包。
//
// ★判据（两层，先快后准）：
//   ① 快判：本地 `npm pack` 的 **tarball integrity** ↔ registry 的 `dist.integrity`。
//      相同 → 判「内容一致」，不再下载（绝大多数包走这条路径）。
//   ② 慢判（integrity 不同时）：**下载 npm tarball → 逐文件语义比对**。
//      ★为什么需要第二层（2026-09-19 实测教训）：tarball 字节含**打包元数据**——
//        npm 发布时会**注入 LICENSE**（本仓各包本地均无该文件，根 LICENSE 被 npm 带上）、
//        并**规范化 package.json**（字段顺序 + 去尾换行）。于是「代码完全一致」的包
//        integrity 也会不同 → 纯字节比对会造成**假阳性**（实测发布成功后 36 包全被误报漂移）。
//      语义比对规则：本地要发布的**每个文件**都必须存在于 npm tarball 且内容一致
//        （`package.json` 按 **JSON 语义**比较——忽略字段顺序与空白）；
//        npm 侧多出的文件（如 LICENSE）**忽略**（npm 注入属正常）。
//   ③ 结论三态：identical（一致）/ packaging-noise（仅打包元数据差异，代码一致）/ real-drift（真漂移）。
//
// 用法：
//   node scripts/check-publish-drift.mjs            # 全量报告
//   node scripts/check-publish-drift.mjs --check    # 仅 real-drift → exit 1（发布前/发布后核验）
//   node scripts/check-publish-drift.mjs --json     # 机器可读
//   node scripts/check-publish-drift.mjs --only <pkg>   # 只查一个包
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')
const asJson = process.argv.includes('--json')
const TAG = 'proteus-publish-drift'
const only = (() => {
  const i = process.argv.indexOf('--only')
  return i >= 0 ? process.argv[i + 1] : null
})()

/** workspace 内的 @proteus-vue/* 包 */
function listPackages() {
  const dir = path.join(ROOT, 'packages')
  const out = []
  for (const d of fs.readdirSync(dir)) {
    const pj = path.join(dir, d, 'package.json')
    if (!fs.existsSync(pj)) continue
    let j
    try {
      j = JSON.parse(fs.readFileSync(pj, 'utf8'))
    } catch {
      continue
    }
    if (!j.name || !j.name.startsWith('@proteus-vue/')) continue
    out.push({ dir: path.join(dir, d), short: j.name.replace('@proteus-vue/', ''), full: j.name, version: j.version })
  }
  return out.sort((a, b) => a.short.localeCompare(b.short))
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

/** 本地 `npm pack --dry-run`：integrity + 将发布的文件清单 */
function localPack(pkgDir) {
  try {
    const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: pkgDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 120_000,
    })
    const j = JSON.parse(raw)
    const e = Array.isArray(j) ? j[0] : j
    return { integrity: e.integrity ?? null, files: (e.files ?? []).map((f) => f.path) }
  } catch {
    return null
  }
}

async function registryVersionInfo(full, version) {
  const url = 'https://registry.npmjs.org/' + encodeURIComponent(full) + '/' + encodeURIComponent(version)
  try {
    const r = await fetch(url, { headers: { 'user-agent': TAG } })
    if (r.status === 404) return null
    if (!r.ok) return { error: `HTTP ${r.status}` }
    const d = await r.json()
    return { integrity: (d.dist && d.dist.integrity) ?? null, tarball: d.dist && d.dist.tarball }
  } catch (e) {
    return { error: String(e).slice(0, 80) }
  }
}

/** 递归读取目录 → Map<相对路径, sha256>（用于比对 npm tarball 解压结果与本地） */
function hashTree(dir, base = '') {
  const out = new Map()
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) for (const [k, v] of hashTree(abs, rel)) out.set(k, v)
    else out.set(rel, sha(fs.readFileSync(abs)))
  }
  return out
}

/** 对象 → 稳定字符串（递归排序键；用于 package.json 语义比较） */
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}

/** 慢判：下载 npm tarball → 逐文件语义比对（返回真漂移明细） */
async function semanticCompare(pkgDir, packFiles, tarballUrl) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-pubcmp-'))
  try {
    const res = await fetch(tarballUrl, { headers: { 'user-agent': TAG } })
    if (!res.ok) return { error: `tarball HTTP ${res.status}` }
    const tgz = path.join(tmp, 'pkg.tgz')
    fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()))
    execFileSync('tar', ['xzf', tgz, '-C', tmp], { stdio: 'ignore' })
    const npmRoot = path.join(tmp, 'package')
    if (!fs.existsSync(npmRoot)) return { error: 'tarball 内无 package/ 目录' }
    const npmFiles = hashTree(npmRoot)

    const missing = []
    const different = []
    for (const rel of packFiles) {
      const abs = path.join(pkgDir, rel)
      if (!fs.existsSync(abs)) {
        missing.push(`${rel}（本地缺失）`)
        continue
      }
      if (!npmFiles.has(rel)) {
        missing.push(rel)
        continue
      }
      const localBuf = fs.readFileSync(abs)
      if (sha(localBuf) === npmFiles.get(rel)) continue
      // 内容不同：package.json 按 JSON 语义再判一次（npm 会规范化字段顺序/空白/尾换行）
      if (rel === 'package.json') {
        try {
          // ★两侧都须 JSON.parse 后再比（此前只 parse 了本地侧，npm 侧直接塞字符串 →
          //   语义比对形同虚设，所有包都被误报「package.json 内容不同」，实测踩到）
          const a = stable(JSON.parse(localBuf.toString('utf8')))
          const b = stable(JSON.parse(fs.readFileSync(path.join(npmRoot, rel), 'utf8')))
          if (a === b) continue
        } catch {
          /* 解析失败按内容差异处理 */
        }
      }
      different.push(rel)
    }
    const extraInNpm = [...npmFiles.keys()].filter((k) => !packFiles.includes(k))
    return { missing, different, extraInNpm }
  } catch (e) {
    return { error: String(e).slice(0, 120) }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

const pkgs = only ? listPackages().filter((p) => p.short === only) : listPackages()
if (!pkgs.length) {
  console.error(`[${TAG}] 未找到匹配的包${only ? `（--only ${only}）` : ''}`)
  process.exit(2)
}

const report = { checked: 0, identical: [], noise: [], drift: [], unpublished: [], errors: [] }

for (const p of pkgs) {
  report.checked++
  const local = localPack(p.dir)
  const remote = await registryVersionInfo(p.full, p.version)
  if (!remote) {
    report.unpublished.push({ name: p.short, version: p.version })
    continue
  }
  if (remote.error) {
    report.errors.push({ name: p.short, version: p.version, error: remote.error })
    continue
  }
  if (!local) {
    report.errors.push({ name: p.short, version: p.version, error: '本地 pack 失败（dist 未构建？）' })
    continue
  }
  if (local.integrity && local.integrity === remote.integrity) {
    report.identical.push({ name: p.short, version: p.version })
    continue
  }
  // integrity 不同 → 慢判（区分「打包元数据噪声」与「真漂移」）
  if (!remote.tarball) {
    report.errors.push({ name: p.short, version: p.version, error: 'registry 未返回 tarball 地址' })
    continue
  }
  const cmp = await semanticCompare(p.dir, local.files, remote.tarball)
  if (cmp.error) {
    report.errors.push({ name: p.short, version: p.version, error: cmp.error })
    continue
  }
  if (cmp.missing.length === 0 && cmp.different.length === 0) {
    report.noise.push({ name: p.short, version: p.version, extraInNpm: cmp.extraInNpm })
  } else {
    report.drift.push({
      name: p.short,
      version: p.version,
      missing: cmp.missing,
      different: cmp.different,
      extraInNpm: cmp.extraInNpm,
    })
  }
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`[${TAG}] 已核 ${report.checked} 个包`)
  console.log(`  内容一致（字节级）：${report.identical.length}`)
  console.log(`  内容一致（仅打包元数据差异：npm 注入 LICENSE / 规范化 package.json）：${report.noise.length}`)
  console.log(`  本地领先（未发布，正常）：${report.unpublished.length}`)
  if (report.drift.length) {
    console.log(`\n★真漂移（${report.drift.length} 个）——npm 上的版本缺少/不同于本地内容，依赖方拿到的是旧包：`)
    for (const d of report.drift) {
      console.log(`  ✗ ${d.name}@${d.version}`)
      if (d.missing.length) console.log(`      npm 缺失：${d.missing.slice(0, 6).join(', ')}${d.missing.length > 6 ? ' …' : ''}`)
      if (d.different.length) console.log(`      内容不同：${d.different.slice(0, 6).join(', ')}${d.different.length > 6 ? ' …' : ''}`)
    }
    console.log('\n  → 修复：给这些包 bump 版本（同版本无法覆盖发布），并同步 bump 依赖它们的包。')
  } else {
    console.log('\n✅ 无真漂移')
  }
  if (report.errors.length) {
    console.log(`\n⚠ 未能判定 ${report.errors.length} 个：`)
    for (const e of report.errors) console.log(`  - ${e.name}@${e.version}: ${e.error}`)
  }
}

// --check：仅「真漂移」判失败（打包元数据差异/本地领先/网络错误均不判失败）
process.exitCode = report.drift.length > 0 && checkOnly ? 1 : 0
