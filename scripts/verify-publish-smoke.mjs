#!/usr/bin/env node
// scripts/verify-publish-smoke.mjs —— ★发布后冒烟验证：在干净目录里跑**真实用户旅程**
//
// 为什么需要它（2026-09-19 事故的最后一环）：
//   那次「CLI 启动即崩」漏到用户侧，正因为发布后**只看了 publish 命令的退出码 0**。
//   「命令成功」≠「用户装到的东西能用」。本脚本把这个手工动作固化成可重复的断言。
//
// ★判据（按用户旅程顺序，前一步失败则后续无意义）：
//   ⓪ **脚手架旅程**：`npm create @proteus-vue/proteus` → 装依赖 → 检查依赖树上**没有重复副本**
//      （这是最关键的一步：2026-09-19 的第二层根因——模板的 prerelease caret 范围够不到新版本
//       → 装到旧 cli → 旧 cli exact-pin 旧 shared → npm 无法提升 → **嵌套第二份副本**
//       → 模块级单例被拆散（路由变了视图不更新，且**无任何报错**）。单看 CLI 启动发现不了它。）
//   ① registry 安装（cli + shared + devtools-runtime，从 npm 拉，不含本仓任何本地状态）
//   ② CLI 启动 `proteus --help` 退出码 0（原事故暴露点：顶层 import 了未发布的导出）
//   ③ 关键导出面（devtools-runtime 曾缺失的 8 个导出 + shared.adapter 的成员）
//   ④ 版本一致（装到的 == 本仓要发的，防「发的是旧版」）
//
// ★与 check-publish-drift 的分工：那个管「发布前，本地 pack ↔ registry 同版本内容一致」；
//   本脚本管「发布后，用户真装真跑真的能用」。前者防发不出去，后者防装到不能用。
//
// 用法：node scripts/verify-publish-smoke.mjs [--tag beta|latest] [--keep] [--skip-journey]
//   默认 tag：beta（本仓处于 changesets pre-release 模式）。--keep 保留临时目录便于排查。
// 退出码：0 全部通过 / 1 有失败项
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const keep = argv.includes('--keep')
const skipJourney = argv.includes('--skip-journey')
const tagIdx = argv.indexOf('--tag')
const TAG = tagIdx >= 0 ? argv[tagIdx + 1] : 'beta'

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const note = (msg) => console.log(`  · ${msg}`)

/** 本仓某包的版本（用于核对「装到的 == 本仓要发的」） */
function localVersion(short) {
  const f = path.join(ROOT, 'packages', short, 'package.json')
  if (!fs.existsSync(f)) return null
  return JSON.parse(fs.readFileSync(f, 'utf8')).version
}

/** 在指定目录跑命令，返回 { ok, out, err }（不抛） */
function run(cmd, args, cwd, timeoutMs = 300_000) {
  try {
    const out = execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      env: { ...process.env, npm_config_yes: 'true', CI: 'true' },
    })
    return { ok: true, out: out.trim(), err: '' }
  } catch (e) {
    return { ok: false, out: String(e.stdout ?? '').trim(), err: String(e.stderr ?? '').trim() }
  }
}

/**
 * 同步等待 ms（不 spawn 子进程，跨平台）。
 * 仅用于下方**有界重试**的退避——不是通用 sleep 工具。
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * ★带归因的有限重试：registry 发布后存在**传播窗口**（实测踩到——发布后立刻安装报
 *   `ETARGET No matching version found`，几十秒后同一命令成功）。
 *   只对「版本暂时查不到」这一类错误重试，其余错误立即返回（不掩盖真实缺陷）。
 *   上限 6 次 / 线性退避，总等待 ≤ 75s —— 有退出条件、有归因，不是盲等。
 */
function runWithPropagation(retryName, cmd, args, cwd, timeoutMs = 300_000) {
  const isPropagation = (r) => /ETARGET|notarget|No matching version found|E404|443|ECONNRESET/i.test(r.err + r.out)
  let last
  for (let attempt = 1; attempt <= 6; attempt++) {
    last = run(cmd, args, cwd, timeoutMs)
    if (last.ok) return last
    if (!isPropagation(last) || attempt === 6) break
    const waitMs = attempt * 5000
    note(`${retryName}：疑似 registry 传播窗口（第 ${attempt}/6 次），${waitMs / 1000}s 后重试`)
    sleepSync(waitMs)
  }
  return last
}

console.log(`[publish-smoke] 发布后冒烟验证（tag=${TAG}）`)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-smoke-'))
console.log(`[publish-smoke] 干净目录：${dir}`)

try {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'proteus-smoke', private: true, version: '1.0.0' }, null, 2))

  // ── ⓪ 脚手架旅程：真实用户从 0 建工程 → 装依赖 → 检查依赖树自洽性 ──
  if (!skipJourney) {
    console.log('\n── ⓪ 脚手架旅程（npm create → 装依赖，真实用户路径）──')
    const appDir = path.join(dir, 'my-app')
    // 用发布出去的 create-proteus（不从本仓读模板）——这正是「用户拿到的那份模板」的检验
    const created = runWithPropagation('npm create', 'npm', ['create', `@proteus-vue/proteus@${TAG}`, 'my-app'], dir, 300_000)
    if (!created.ok) {
      record(`npm create @proteus-vue/proteus@${TAG}`, false, (created.err || created.out).slice(0, 240))
    } else {
      record(`npm create @proteus-vue/proteus@${TAG}`, true)
      const inst = runWithPropagation('模板 npm install', 'npm', ['install', '--no-audit', '--no-fund'], appDir, 600_000)
      if (!inst.ok) {
        record('模板工程 npm install', false, (inst.err || inst.out).slice(0, 240))
      } else {
        record('模板工程 npm install', true)
        // ★核心断言：依赖树上每个 @proteus-vue/* 包只能有一个版本——多份副本 = 单例拆散风险
        const lockFile = path.join(appDir, 'package-lock.json')
        if (!fs.existsSync(lockFile)) {
          record('依赖树重复副本检查', false, '未生成 package-lock.json，无法核对')
        } else {
          const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'))
          const byName = new Map()
          for (const [loc, meta] of Object.entries(lock.packages ?? {})) {
            const m = loc.match(/@proteus-vue\/([^/]+)$/)
            if (!m) continue
            if (!byName.has(m[1])) byName.set(m[1], new Set())
            byName.get(m[1]).add(meta.version)
          }
          const dupes = [...byName.entries()].filter(([, v]) => v.size > 1)
          record(
            '依赖树无重复副本（@proteus-vue/* 每包单一版本）',
            dupes.length === 0,
            dupes.length ? dupes.map(([n, v]) => `${n}=${[...v].join('|')}`).join(', ') : `已核 ${byName.size} 个包`,
          )
          // 模板解析出的 cli 版本必须 == 本仓版本（否则用户装到旧 CLI）
          const cliVer = [...(byName.get('cli') ?? [])][0]
          const localCli = localVersion('cli')
          record('脚手架装到的 cli 版本 == 本仓', !cliVer || !localCli || cliVer === localCli, `装到 ${cliVer ?? '(缺)'} · 本仓 ${localCli}`)
        }
      }
    }
  }

  // ── ① registry 安装 ──
  // ★devtools-runtime 显式安装（不能只靠 cli 的传递依赖）：它是 cli 的依赖，npm 可能把它
  //   嵌套在 cli 目录下而非顶层 → 从顶层探针文件 import 会 ERR_MODULE_NOT_FOUND，
  //   那是**测试写法问题**而非发布问题（早期版本因此产生过假阳性）。显式装到顶层后，
  //   探针解析的是「用户能直接拿到的那份」，语义也更正确。
  console.log('\n── ① 干净目录安装 ──')
  const install = runWithPropagation(
    '直接安装',
    'npm',
    ['install', '--no-audit', '--no-fund', `@proteus-vue/cli@${TAG}`, `@proteus-vue/shared@${TAG}`, `@proteus-vue/devtools-runtime@${TAG}`],
    dir,
  )
  record(`npm install @proteus-vue/{cli,shared,devtools-runtime}@${TAG}`, install.ok, install.ok ? '' : install.err.slice(0, 200))
  if (!install.ok) throw new Error('安装失败——后续检查跳过')

  // ── ② CLI 启动（原崩溃点）──
  console.log('\n── ② CLI 启动（原事故崩溃点）──')
  const cliBin = path.join(dir, 'node_modules', '.bin', 'proteus')
  const help = run(cliBin, ['--help'], dir, 120_000)
  record('proteus --help 退出码 0', help.ok, help.ok ? '' : (help.err || help.out).slice(0, 240))

  // ── ③ 关键导出面 ──
  console.log('\n── ③ 关键导出面 ──')
  // ★为什么要注入 location：`@proteus-vue/shared` 的 web-adapter 目标运行时是**浏览器/小程序**，
  //   在纯 Node（无 DOM）下导入可能立即读 `location` 而抛错。这是**环境不匹配**，不是发布缺陷——
  //   故注入最小 shim 让导出面检查能在 Node 里进行；同时用 try/catch 把**导入失败本身**作为
  //   独立发现上报（旧版 shared 曾在此崩溃——那确实是用户会遇到的缺陷，只是报错信息需归因清楚）。
  const probe = `
    globalThis.location = globalThis.location ?? { pathname: '/', search: '', hash: '', href: 'http://localhost/' }
    globalThis.window = globalThis.window ?? globalThis
    let dt = null, sh = null, dtErr = '', shErr = ''
    try { dt = await import('@proteus-vue/devtools-runtime') } catch (e) { dtErr = String(e).slice(0, 160) }
    try { sh = await import('@proteus-vue/shared') } catch (e) { shErr = String(e).slice(0, 160) }
    const need = ['createFlamegraphCollector','createTimelineCollector','createStoreTracer','createRouteBacktracker','createErrorDiagnoser','createStateSnapshotter','serializeState','deserializeState']
    const missing = dt ? need.filter((k) => typeof dt[k] !== 'function') : need
    const a = sh && sh.adapter
    const adapterOk = !!a && typeof a.isMP === 'boolean' && typeof a.navigateTo === 'function' && typeof a.onPageLoad === 'function'
    console.log(JSON.stringify({
      missing, dtErr, shErr, adapterOk,
      dtCount: dt ? Object.keys(dt).length : 0,
      shCount: sh ? Object.keys(sh).length : 0,
    }))
  `
  const probeFile = path.join(dir, 'probe.mjs')
  fs.writeFileSync(probeFile, probe)
  const pr = run('node', [probeFile], dir, 60_000)
  if (pr.ok) {
    try {
      const j = JSON.parse(pr.out)
      record(
        'devtools-runtime 可导入',
        j.dtErr === '',
        j.dtErr ? `导入失败：${j.dtErr}` : `共 ${j.dtCount} 个导出`,
      )
      record(
        'devtools-runtime 8 个曾缺失导出齐全',
        j.missing.length === 0,
        j.missing.length ? `缺：${j.missing.join(', ')}` : `共 ${j.dtCount} 个导出`,
      )
      record(
        'shared 可导入 + adapter 单例可用（isMP/navigateTo/onPageLoad）',
        j.shErr === '' && j.adapterOk === true,
        j.shErr ? `导入失败：${j.shErr}` : `shared 共 ${j.shCount} 个导出`,
      )
    } catch {
      record('导出面探测输出可解析', false, pr.out.slice(0, 160))
    }
  } else {
    record('导出面探测执行', false, (pr.err || pr.out).slice(0, 200))
  }

  // ── ④ 版本一致 ──
  console.log('\n── ④ 版本一致（防「发的是旧版」）──')
  for (const short of ['cli', 'shared', 'devtools-runtime']) {
    const pkgJson = path.join(dir, 'node_modules', '@proteus-vue', short, 'package.json')
    if (!fs.existsSync(pkgJson)) {
      record(`${short} 版本`, true, '未在顶层（非直接依赖，跳过）')
      continue
    }
    const installed = JSON.parse(fs.readFileSync(pkgJson, 'utf8')).version
    const local = localVersion(short)
    record(`${short} 装到的版本 == 本仓`, local === null || installed === local, `registry=${installed} 本仓=${local}`)
  }
} catch (e) {
  record('冒烟流程', false, String(e).slice(0, 200))
} finally {
  if (keep) console.log(`\n[publish-smoke] 临时目录保留：${dir}`)
  else fs.rmSync(dir, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log('')
if (failed.length === 0) {
  console.log(`[publish-smoke] ✅ 全部通过（${results.length} 项）——脚手架可用、可安装、可运行、依赖树自洽、导出齐全`)
  process.exitCode = 0
} else {
  console.log(`[publish-smoke] ❌ ${failed.length}/${results.length} 项失败：`)
  for (const f of failed) console.log(`  - ${f.name}：${f.detail}`)
  console.log('\n  → 用户装到的包不可用。常见成因：')
  console.log('     · 「依赖树有重复副本」→ 模板 package.json 的版本声明与已发布版本不一致（prerelease 的')
  console.log('       caret 范围够不到新版本 → 装到旧包 → 旧包 exact-pin 旧依赖 → npm 嵌套第二份副本）')
  console.log('     · 「版本不一致」→ 该包漏发/被跳过（跑 publish:check 核对）')
  console.log('     · 「安装报 ETARGET」且重试后仍失败 → 依赖的版本确实不存在（漏发）')
  process.exitCode = 1
}
