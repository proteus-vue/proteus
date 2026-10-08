#!/usr/bin/env node
// hosts/ios/lib/ios-signing.mjs —— ★★★两台电脑 iOS 签名切换（2026-10-08）
//
// 【为什么需要】
//   本仓的工作盘在**两台 Mac 之间来回插**（家 / 办公室），而 iOS 签名资产是**每台机器各一套**：
//   · Apple Development 证书在**钥匙串**里、描述文件在 **Xcode UserData** 里、Apple ID 登录态在 Xcode 偏好里；
//   · 两边用的 Apple ID / 团队可能不同（例：办公室 = lyl@shxuxi.cn / XKH568R7A5）；
//   · 证书**续签后钥匙串里会同时留两张同名证书**（本仓实测：按名字选会命中不对的那张，装机报
//     `The identity used to sign the executable is no longer valid`）。
//   ⇒ 与其在每个脚本里重复"自动猜"，不如做成一个**按主机名记住本机该用哪套**的切换器：
//     pin 文件（hosts/ios/signing.local.json）**按主机名分档** ⇒ 同一块盘在两台机上互不覆盖。
//
// 【核心判据（本文件唯一重要的一条）】
//   从**描述文件反查证书**：描述文件的 `DeveloperCertificates` 逐张取 SHA-1，与钥匙串
//   `find-identity -v` 的有效身份做**交集**——交集里那张才是"既被描述文件授权、又在本机"的证书。
//   ★这是唯一同时躲开「同名两张证书」和「团队选错」的判据（按名字选必错其一）。
//
// 【判据 SSOT】脚本（run-selfdraw.sh / provision.sh）消费 `resolve --shell` 的输出；
//   人用 `list / use / status` 看到的也是同一套解析——不允许两边各算一遍。
//
// 用法（薄壳 hosts/ios/signing.sh 等价）：
//   node hosts/ios/lib/ios-signing.mjs list                # 钥匙串有效身份 + 本机有效描述文件 + 当前档
//   node hosts/ios/lib/ios-signing.mjs use lyl@shxuxi.cn   # 给**本机**上档（账号 / 名称 / SHA-1 前缀选一）
//   node hosts/ios/lib/ios-signing.mjs use <sel> --bundle=cn.shxuxi.proteus.experiments --label=office
//   node hosts/ios/lib/ios-signing.mjs status              # 本机当前档 + 逐项校验（含"下一步"）
//   node hosts/ios/lib/ios-signing.mjs clear               # 清除本机档（回到脚本自动模式）
//   node hosts/ios/lib/ios-signing.mjs resolve --shell     # 供脚本 eval（PROTEUS_IOS_* 变量）
//   自测（纯逻辑，不碰钥匙串）：node hosts/ios/lib/ios-signing.selftest.mjs
//
// 【环境覆盖】PROTEUS_IOS_HOST=<名字> 覆盖主机名归一结果（调试/预置用；键为小写、去域后缀）。
//   ★主机名归一规则：os.hostname() 小写化 + 去掉 `.local` 等域后缀（kagsdeiMac.local → kagsdeimac）。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url)) // hosts/ios/lib
const IOS_DIR = path.resolve(HERE, '..') // hosts/ios
const PIN_FILE = path.join(IOS_DIR, 'signing.local.json')

/** 描述文件目录（Xcode 现行位置 + 旧版遗留位置） */
const PROFILE_DIRS = [
  path.join(os.homedir(), 'Library/Developer/Xcode/UserData/Provisioning Profiles'),
  path.join(os.homedir(), 'Library/MobileDevice/Provisioning Profiles'),
]

/** 团队 → 默认 bundle id（来自本仓历史；`use --bundle=` 可覆盖，描述文件存在时以描述文件为准） */
const DEFAULT_BUNDLES = {
  XKH568R7A5: 'cn.shxuxi.proteus.experiments',
  F4R3P3L477: 'dev.proteus.experiments',
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }

const log = (...a) => console.log(...a)
const note = (s) => log(`  ℹ ${s}`)
const warn = (s) => log(`  ⚠ ${s}`)
function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  return { ok: r.status === 0, out: r.stdout ?? '' }
}

/** 本机档位键（小写 + 去域后缀；PROTEUS_IOS_HOST 可覆盖） */
export function hostKey() {
  const raw = process.env.PROTEUS_IOS_HOST || os.hostname() || 'unknown-host'
  return raw.toLowerCase().replace(/\..*$/, '')
}

/** openssl 的 `notBefore=Sep 28 01:17:01 2026 GMT` → Date（手写解析，避免 Date.parse 的实现差异） */
export function parseOpenSslDate(s) {
  const m = s.match(/^([A-Z][a-z]{2})\s+(\d+)\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})/)
  if (!m) return null
  const [hh, mm, ss] = [m[3], m[4], m[5]].map(Number)
  return new Date(Date.UTC(Number(m[6]), MONTHS[m[1]], Number(m[2]), hh, mm, ss))
}

/** 一张证书的 subject/dates（经 openssl；pem 落临时文件，用完即删） */
function certMeta(pem, tmpDir) {
  const f = path.join(tmpDir, `${createHash('sha1').update(pem).digest('hex')}.pem`)
  fs.writeFileSync(f, pem)
  const s = run('openssl', ['x509', '-in', f, '-noout', '-subject', '-dates']).out
  const cn = ((s.match(/CN=([\s\S]*?)(?=,\s*(?:OU|O|C|UID|emailAddress)=)/) || [])[1] || '').trim()
  const team = ((s.match(/,?\s*OU=([^,\n]+)/) || [])[1] || '').trim()
  return {
    cn,
    account: cn.replace(/^Apple Development:\s*/, '').replace(/\s*\([A-Z0-9]+\)\s*$/, ''),
    team,
    notBefore: parseOpenSslDate((s.match(/notBefore=([^\n]+)/) || [])[1] || ''),
    notAfter: parseOpenSslDate((s.match(/notAfter=([^\n]+)/) || [])[1] || ''),
  }
}

/**
 * 钥匙串**有效**签名身份（find-identity -v 的口径 = 证书有效且配对私钥在）。
 * 明细（账号/团队/有效期）经 find-certificate 批量 dump + openssl 解析；
 * ★只保留在"有效身份"里的 SHA-1（已吊销/无配对私钥的一律不入选）。
 */
export function collectIdentities() {
  const valid = new Map()
  const r = run('security', ['find-identity', '-v', '-p', 'codesigning'])
  for (const m of r.out.matchAll(/^\s*\d+\) ([0-9A-Fa-f]{40}) "([^"]+)"/gm)) valid.set(m[1].toUpperCase(), m[2])
  if (!valid.size) return []
  const dump = run('security', ['find-certificate', '-a', '-c', 'Apple Development', '-Z', '-p'])
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-ios-sign-'))
  const identities = []
  try {
    const re = /SHA-1 hash: ([0-9A-Fa-f]{40})\s*\n(-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----)/g
    for (const m of dump.out.matchAll(re)) {
      const sha1 = m[1].toUpperCase()
      const name = valid.get(sha1)
      if (!name) continue
      identities.push({ sha1, name, ...certMeta(m[2], tmpDir) })
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
  return identities
}

/** 本机描述文件清单（含过期项；解析失败项带 error 标记而不是静默跳过） */
export function collectProfiles() {
  const out = []
  for (const dir of PROFILE_DIRS) {
    let names = []
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.mobileprovision')).sort()
    } catch {
      continue
    }
    for (const n of names) {
      const file = path.join(dir, n)
      const r = run('security', ['cms', '-D', '-i', file])
      if (!r.ok) {
        out.push({ file, error: 'security cms -D 解析失败（文件损坏？）' })
        continue
      }
      const xml = r.out
      const str = (key) => (xml.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`)) || [])[1] || ''
      const appId = str('application-identifier')
      const team =
        (xml.match(/<key>TeamIdentifier<\/key>\s*<array>\s*<string>([^<]+)<\/string>/) || [])[1] || appId.split('.')[0] || ''
      const expiryRaw = (xml.match(/<key>ExpirationDate<\/key>\s*<date>([^<]+)<\/date>/) || [])[1] || ''
      const certsBlock = (xml.match(/<key>DeveloperCertificates<\/key>\s*<array>([\s\S]*?)<\/array>/) || [])[1] || ''
      const certSha1s = [...certsBlock.matchAll(/<data>\s*([A-Za-z0-9+/=\s]+?)\s*<\/data>/g)].map((m) =>
        createHash('sha1')
          .update(Buffer.from(m[1].replace(/\s+/g, ''), 'base64'))
          .digest('hex')
          .toUpperCase(),
      )
      const devicesBlock = (xml.match(/<key>ProvisionedDevices<\/key>\s*<array>([\s\S]*?)<\/array>/) || [])[1] || ''
      out.push({
        file,
        name: str('Name'),
        uuid: str('UUID'),
        appId,
        team,
        bundleId: team && appId.startsWith(team + '.') ? appId.slice(team.length + 1) : appId,
        expiry: expiryRaw ? new Date(expiryRaw) : null,
        certSha1s,
        devices: (devicesBlock.match(/<string>/g) || []).length,
      })
    }
  }
  return out
}

/** 按 notBefore 取最新的一张（续签场景 = 最新的那张）；空表 → null */
export function newestIdentity(list) {
  return [...list].sort((a, b) => (b.notBefore?.getTime() || 0) - (a.notBefore?.getTime() || 0))[0] || null
}

/**
 * ★解析核心（纯函数，可注入数据自测）：pin × 钥匙串身份 × 描述文件 → 本机该用哪套。
 * 优先级（每一步都带理由，不静默）：
 *   ① 描述文件授权 ∩ 本机钥匙串 —— 交集里优先 pin.certSha1（若在交集内），否则取最新；
 *   ② 无描述文件 / 交集为空 —— 回退 pin.certSha1（若仍有效），再回退"同团队最新"；
 *   ③ bundle：pin.bundleId > 描述文件的 bundle；两者冲突时**按 pin 走并告警**。
 */
export function resolveForPin(pin, identities, profiles, now = Date.now()) {
  const warnings = []
  if (!pin) return { active: false, warnings }
  const team = pin.team || ''
  const valid = profiles.filter((p) => !p.error && p.expiry && p.expiry.getTime() > now)
  const teamProfiles = team ? valid.filter((p) => p.team === team) : []
  let profile = null
  if (pin.bundleId) profile = teamProfiles.find((p) => p.bundleId === pin.bundleId) || null
  if (!profile) profile = teamProfiles[0] || null
  if (pin.bundleId && profile && profile.bundleId !== pin.bundleId) {
    warnings.push(`描述文件的 bundle（${profile.bundleId}）与档里的（${pin.bundleId}）不一致——按档里的 bundle 走`)
  }

  let identity = null
  if (profile) {
    const embedded = profile.certSha1s.filter((s) => identities.some((i) => i.sha1 === s))
    if (!embedded.length) warnings.push('描述文件授权的证书不在本机钥匙串（另一台机器签发的？装机可能失败）')
    if (pin.certSha1 && embedded.includes(pin.certSha1)) {
      identity = identities.find((i) => i.sha1 === pin.certSha1) || null
    } else {
      if (pin.certSha1) warnings.push('档里指定的证书不在该描述文件的授权列表（续签前的旧档？）——按描述文件授权的那张走')
      identity = newestIdentity(identities.filter((i) => embedded.includes(i.sha1)))
    }
  } else if (team) {
    warnings.push(`本机没有 team ${team} 的有效描述文件——装机前先跑一次 provision`)
  }

  if (!identity && pin.certSha1) {
    identity = identities.find((i) => i.sha1 === pin.certSha1) || null
    if (identity) warnings.push('按档里的证书 SHA-1 直接选用（未过描述文件反查——描述文件缺失）')
  }
  if (!identity && team) {
    identity = newestIdentity(identities.filter((i) => i.team === team))
    if (identity) warnings.push(`档里的证书不在本机钥匙串——已按团队 ${team} 回退选当前最新的有效证书`)
  }
  if (!identity) warnings.push('本机没有可用的签名证书（钥匙串里没有能匹配的有效身份）')

  const bundleId = pin.bundleId || (profile && profile.bundleId) || ''
  return { active: true, team, identity, profile, bundleId, warnings }
}

// ── pin 文件读写（本地状态；按主机名分档）────────────────────────────────────
function loadPinFile() {
  if (!fs.existsSync(PIN_FILE)) return { pins: {} }
  try {
    const j = JSON.parse(fs.readFileSync(PIN_FILE, 'utf8'))
    return { pins: j.pins && typeof j.pins === 'object' ? j.pins : {} }
  } catch (e) {
    console.error(`⚠ 无法解析 ${PIN_FILE}（按"无档"处理——修复或删除该文件后重试）：${e.message}`)
    return { pins: {} }
  }
}

function savePinFile(pins) {
  const body = {
    _comment: '本机 iOS 签名切换档（按主机名分档）——hosts/ios/signing.sh 管理，勿手改、勿提交（已 gitignore）',
    pins,
  }
  fs.writeFileSync(PIN_FILE, JSON.stringify(body, null, 2) + '\n')
}

const fmtDate = (d) => (d ? d.toISOString().slice(0, 10) : '?')
const short = (sha1) => String(sha1 || '').slice(0, 8)

// ── 输出 ─────────────────────────────────────────────────────────────────────
function printResolveHuman(pin, r) {
  log(`本机签名档（hostname ${hostKey()}）`)
  log(
    `  档位：${pin.label || pin.account || '（未命名）'} · team ${pin.team || '?'} · 证书 ${short(pin.certSha1)}… · bundle ${pin.bundleId || '—'}`,
  )
  if (r.identity) log(`  ✓ 证书：${short(r.identity.sha1)}… ${r.identity.name}（有效至 ${fmtDate(r.identity.notAfter)}）`)
  else log('  ✗ 证书：（没解析到可用身份）')
  if (r.profile) log(`  ✓ 描述文件：${r.profile.bundleId}（至 ${fmtDate(r.profile.expiry)}；设备 ${r.profile.devices} 台）`)
  else log(`  ✗ 描述文件：本机没有 team ${pin.team || '?'} 的有效描述文件`)
  log(`  ⇒ run-selfdraw.sh 将用：identity=${r.identity ? short(r.identity.sha1) : '（自动）'} bundle=${r.bundleId || '（自动）'}`)
  for (const w of r.warnings) warn(w)
  if (!r.profile) log('  下一步：bash hosts/ios/experiments/device/provision.sh   # 无参数——自动用本机档')
  else log('  下一步：bash hosts/ios/run-selfdraw.sh（已按本机档选证书/描述文件）')
}

// ── 子命令 ───────────────────────────────────────────────────────────────────
function cmdList() {
  const ids = collectIdentities()
  const profs = collectProfiles()
  const now = new Date()
  log(`== 钥匙串有效签名身份（security find-identity -v -p codesigning，${ids.length} 条）==`)
  if (!ids.length) log('  （无）——先在 Xcode → Settings → Accounts 登录 Apple ID')
  for (const i of [...ids].sort((a, b) => a.team.localeCompare(b.team) || a.sha1.localeCompare(b.sha1))) {
    const dup = ids.filter((x) => x.account === i.account && x.team === i.team).length > 1
    log(
      `  ${short(i.sha1)}  ${(i.account || i.name).padEnd(26)} ${(i.team || '?').padEnd(12)} 有效至 ${fmtDate(i.notAfter)}${dup ? '   ⚠ 同名多张（续签遗留；本工具按描述文件反查，不受影响）' : ''}`,
    )
  }
  const uniq = [...new Set(ids.map((i) => i.account))]
  log(`\n== 本机描述文件（${profs.filter((p) => !p.error && p.expiry && p.expiry > now).length} 条有效 / 共 ${profs.length}）==`)
  if (!profs.length) log('  （无）——缺失时跑：bash hosts/ios/experiments/device/provision.sh')
  for (const p of profs) {
    if (p.error) {
      log(`  ✗ ${p.file}（${p.error}）`)
      continue
    }
    const expired = p.expiry && p.expiry.getTime() <= now.getTime()
    log(`  ${expired ? '✗ 已过期' : '✓'} ${p.bundleId}  team ${p.team}  至 ${fmtDate(p.expiry)}  设备 ${p.devices} 台`)
  }
  const me = loadPinFile().pins[hostKey()]
  log(`\n== 本机签名档（hostname ${hostKey()} · ${PIN_FILE}）==`)
  log(
    me
      ? `  ${me.label || me.account}（team ${me.team}、证书 ${short(me.certSha1)}…、bundle ${me.bundleId || '—'}）`
      : '  （未设置）',
  )
  log(`\n上档（每台机器一次）：bash hosts/ios/signing.sh use <账号|SHA-1前缀>${uniq[0] ? `   （如：use ${uniq[0]}）` : ''}`)
}

function cmdUse(args) {
  const sel = args.find((a) => !a.startsWith('--'))
  if (!sel) fail('用法：use <账号|名称|SHA-1 前缀> [--bundle=<id>] [--label=<名字>]')
  const opt = (name) => {
    const p = `--${name}=`
    const hit = args.find((a) => a.startsWith(p))
    return hit ? hit.slice(p.length) : undefined
  }
  const bundleOpt = opt('bundle')
  const labelOpt = opt('label')

  const ids = collectIdentities()
  const profs = collectProfiles()
  const now = new Date()
  const validProfs = profs.filter((p) => !p.error && p.expiry && p.expiry.getTime() > now.getTime())

  const s = sel.toLowerCase()
  const isHex = /^[0-9a-f]{6,40}$/.test(s)
  let cands = ids.filter((i) =>
    isHex ? i.sha1.toLowerCase().startsWith(s) : i.name.toLowerCase().includes(s) || (i.account || '').toLowerCase().includes(s),
  )
  if (!cands.length) fail(`没有匹配「${sel}」的有效身份——先 list 看可选；或在 Xcode → Settings → Accounts 登录对应 Apple ID`)

  let pick = null
  if (cands.length === 1) {
    pick = cands[0]
  } else {
    const inProfiles = cands.filter((c) => validProfs.some((p) => p.certSha1s.includes(c.sha1)))
    if (inProfiles.length === 1) {
      pick = inProfiles[0]
      note('多个候选命中同一账号——取**描述文件授权过**的那张（最可装机）')
    } else {
      const narrowed = inProfiles.length > 1 ? inProfiles : cands
      const teams = [...new Set(narrowed.map((c) => c.team))]
      if (teams.length === 1) {
        pick = newestIdentity(narrowed)
        note(`多个候选同团队（${teams[0]}）——取**最新签发**的那张（续签场景）`)
      } else {
        fail(
          `「${sel}」匹配到多个团队（${teams.join(' / ')}）——请用 SHA-1 前缀指定：\n` +
            narrowed.map((c) => `    ${short(c.sha1)}…  ${c.account}  ${c.team}`).join('\n'),
        )
      }
    }
  }

  let bundleId = bundleOpt || null
  if (!bundleId) {
    const teamProfs = validProfs.filter((p) => p.team === pick.team)
    const pref =
      teamProfs.find((p) => p.certSha1s.includes(pick.sha1)) ||
      [...teamProfs].sort((a, b) => b.expiry - a.expiry)[0]
    bundleId = (pref && pref.bundleId) || DEFAULT_BUNDLES[pick.team] || ''
  }

  const pins = loadPinFile().pins
  pins[hostKey()] = {
    label: labelOpt || pick.account || pick.name,
    account: pick.account || '',
    team: pick.team || '',
    certSha1: pick.sha1,
    bundleId,
    updatedAt: new Date().toISOString(),
  }
  savePinFile(pins)
  log(`✅ 已给本机（${hostKey()}）上档`)
  printResolveHuman(pins[hostKey()], resolveForPin(pins[hostKey()], ids, profs))
}

function cmdStatus() {
  const me = loadPinFile().pins[hostKey()]
  if (!me) {
    log(`本机（${hostKey()}）无签名档——脚本走原有自动逻辑`)
    log('  要固定本机档：bash hosts/ios/signing.sh use <账号>（例：use lyl@shxuxi.cn）')
    return
  }
  printResolveHuman(me, resolveForPin(me, collectIdentities(), collectProfiles()))
}

function cmdClear() {
  const pins = loadPinFile().pins
  const me = pins[hostKey()]
  if (!me) {
    log(`本机（${hostKey()}）本来就没有档——脚本走原有自动逻辑`)
    return
  }
  delete pins[hostKey()]
  savePinFile(pins)
  log(`✅ 已清除本机（${hostKey()}）的签名档——脚本回到自动模式（其它机器的档不受影响）`)
}

const shellQuote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`

/** verify-pair：某描述文件是否**授权**某证书（SHA-1）——装机前的静默失效闸（0xe8008018 那类） */
function cmdVerifyPair(args) {
  const [profilePath, sha1] = args.filter((a) => !a.startsWith('--'))
  if (!profilePath || !sha1) fail('用法：verify-pair <描述文件路径> <证书SHA-1>')
  if (!fs.existsSync(profilePath)) fail(`描述文件不存在：${profilePath}`)
  const r = run('security', ['cms', '-D', '-i', profilePath])
  if (!r.ok) fail(`security cms -D 解析失败：${profilePath}`)
  const block = (r.out.match(/<key>DeveloperCertificates<\/key>\s*<array>([\s\S]*?)<\/array>/) || [])[1] || ''
  const have = [...block.matchAll(/<data>\s*([A-Za-z0-9+/=\s]+?)\s*<\/data>/g)].map((m) =>
    createHash('sha1')
      .update(Buffer.from(m[1].replace(/\s+/g, ''), 'base64'))
      .digest('hex')
      .toUpperCase(),
  )
  const want = sha1.toUpperCase()
  if (have.includes(want)) {
    log(`✓ 描述文件授权该证书（${want.slice(0, 8)}…）`)
    return
  }
  console.error(
    `✗ 描述文件未授权该证书：want ${want.slice(0, 8)}… · have ${have.map((s) => s.slice(0, 8) + '…').join(', ') || '(无)'}`,
  )
  process.exit(1)
}

function cmdResolve(args) {
  const asShell = args.includes('--shell')
  const asJson = args.includes('--json')
  const me = loadPinFile().pins[hostKey()]
  if (!me) {
    if (asShell) log('PROTEUS_IOS_PIN_ACTIVE=0')
    else if (asJson) log(JSON.stringify({ active: false, host: hostKey() }, null, 2))
    else log(`本机（${hostKey()}）无签名档——脚本将走自动逻辑`)
    return
  }
  const ids = collectIdentities()
  const profs = collectProfiles()
  const r = resolveForPin(me, ids, profs)
  if (asShell) {
    const out = {
      PROTEUS_IOS_PIN_ACTIVE: '1',
      PROTEUS_IOS_PIN_HOST: hostKey(),
      PROTEUS_IOS_PIN_LABEL: me.label || me.account || '',
      PROTEUS_IOS_ACCOUNT: me.account || '',
      PROTEUS_IOS_TEAM: me.team || '',
      PROTEUS_IOS_IDENTITY_SHA1: r.identity ? r.identity.sha1 : '',
      PROTEUS_IOS_IDENTITY_NAME: r.identity ? r.identity.name : '',
      PROTEUS_IOS_BUNDLE_ID: r.bundleId || '',
      PROTEUS_IOS_PROFILE_PATH: r.profile ? r.profile.file : '',
      PROTEUS_IOS_WARN: r.warnings.join(' | '),
    }
    for (const [k, v] of Object.entries(out)) log(`${k}=${shellQuote(v)}`)
    return
  }
  if (asJson) {
    log(
      JSON.stringify(
        {
          host: hostKey(),
          pin: me,
          identity: r.identity ? { sha1: r.identity.sha1, name: r.identity.name, team: r.identity.team } : null,
          profile: r.profile ? { file: r.profile.file, bundleId: r.profile.bundleId, expiry: r.profile.expiry } : null,
          bundleId: r.bundleId,
          warnings: r.warnings,
        },
        null,
        2,
      ),
    )
    return
  }
  printResolveHuman(me, r)
}

const USAGE = `ios-signing —— 两台电脑 iOS 签名切换（按主机名分档；实现判据见本文件头）
用法：
  list                     钥匙串有效身份 + 本机有效描述文件 + 当前档
  use <账号|SHA-1前缀>      给本机**上档**（可选 --bundle=… --label=…）
  status                   本机当前档 + 逐项校验
  clear                    清除本机档（回到脚本自动模式）
  resolve [--shell|--json] 供脚本消费（run-selfdraw.sh / provision.sh 已接线）
  verify-pair <描述文件> <SHA-1>  校验"描述文件是否授权该证书"（run-selfdraw.sh 装机前调用）`

function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  switch (cmd) {
    case 'list':
      return cmdList()
    case 'use':
      return cmdUse(rest)
    case 'status':
      return cmdStatus()
    case 'clear':
      return cmdClear()
    case 'resolve':
      return cmdResolve(rest)
    case 'verify-pair':
      return cmdVerifyPair(rest)
    default:
      log(USAGE)
      process.exit(cmd ? 1 : 0)
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()
