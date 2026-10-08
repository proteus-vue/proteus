#!/usr/bin/env node
// hosts/ios/lib/ios-signing.selftest.mjs —— resolveForPin 纯逻辑自测（**不碰**钥匙串/描述文件/网络）
//
// 【测什么】把"续签后同名两张证书"这类真实场景做成**注入数据**的用例，钉住解析判据：
//   ① 描述文件授权 ∩ 钥匙串 的交集优先（即使不是 pin 指定的那张）；
//   ② 续签场景（同名两张）：交集决定用哪张——**不是**按名字、也不是无脑取最新；
//   ③ 无描述文件 ⇒ 回退 pin 证书 / 同团队最新，且**必须带告警**；
//   ④ 无档（pin 缺失）⇒ active=false（脚本落回自动逻辑）。
// 运行：node hosts/ios/lib/ios-signing.selftest.mjs（exit 0 全过 / 1 有失败）
import { resolveForPin } from './ios-signing.mjs'

const d = (s) => new Date(s)
const mkId = (sha1, account, team, notBefore) => ({
  sha1,
  name: `Apple Development: ${account}`,
  account,
  team,
  notBefore: d(notBefore),
  notAfter: d('2027-10-01'),
})
const mkProf = (bundleId, team, certSha1s, expiry = '2026-10-15') => ({
  file: `/tmp/${bundleId}.mobileprovision`,
  name: `profile ${bundleId}`,
  appId: `${team}.${bundleId}`,
  team,
  bundleId,
  certSha1s,
  expiry: d(expiry),
  devices: 1,
})

const OLD = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const NEW = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const OTHER = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
const TEAM = 'XKH568R7A5'

let failed = 0
function check(name, fn) {
  try {
    fn()
    console.log(`  ✅ ${name}`)
  } catch (e) {
    failed++
    console.error(`  ❌ ${name}\n     ${e.message}`)
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

console.log('ios-signing 自测（纯逻辑）')

check('无档 ⇒ active=false（脚本落回自动逻辑）', () => {
  const r = resolveForPin(null, [mkId(NEW, 'a@b.c', TEAM, '2026-10-08')], [mkProf('x', TEAM, [NEW])])
  assert(r.active === false, '应 active=false')
  assert(r.warnings.length === 0, '无档不应有告警')
})

check('常规：档证书 = 描述文件授权的那张 ⇒ 直接选中、零告警', () => {
  const ids = [mkId(NEW, 'a@b.c', TEAM, '2026-10-08')]
  const pin = { team: TEAM, certSha1: NEW, bundleId: 'cn.shxuxi.proteus.experiments' }
  const r = resolveForPin(pin, ids, [mkProf('cn.shxuxi.proteus.experiments', TEAM, [NEW])])
  assert(r.identity && r.identity.sha1 === NEW, '应选 NEW')
  assert(r.bundleId === 'cn.shxuxi.proteus.experiments', 'bundle 应来自档')
  assert(r.warnings.length === 0, `不应有告警：${r.warnings.join(' | ')}`)
})

check('续签：描述文件授权旧证（交集=旧）⇒ 按交集选旧证，且告警（不按名字/不盲目取新）', () => {
  const ids = [mkId(OLD, 'a@b.c', TEAM, '2026-09-28'), mkId(NEW, 'a@b.c', TEAM, '2026-10-08')]
  const pin = { team: TEAM, certSha1: NEW, bundleId: 'cn.shxuxi.proteus.experiments' }
  const r = resolveForPin(pin, ids, [mkProf('cn.shxuxi.proteus.experiments', TEAM, [OLD])])
  assert(r.identity && r.identity.sha1 === OLD, '应选被描述文件授权的 OLD（不是 pin 指定的 NEW）')
  assert(
    r.warnings.some((w) => w.includes('描述文件')),
    `应有"按交集走"的告警：${r.warnings.join(' | ')}`,
  )
})

check('续签：描述文件授权新证 ⇒ 取新证（同名两张不影响）', () => {
  const ids = [mkId(OLD, 'a@b.c', TEAM, '2026-09-28'), mkId(NEW, 'a@b.c', TEAM, '2026-10-08')]
  const r = resolveForPin({ team: TEAM, bundleId: 'cn.shxuxi.proteus.experiments' }, ids, [
    mkProf('cn.shxuxi.proteus.experiments', TEAM, [NEW]),
  ])
  assert(r.identity && r.identity.sha1 === NEW, '应选 NEW（交集里最新的）')
})

check('无描述文件 + 同名两张 ⇒ 回退"同团队最新"，且必须带告警', () => {
  const ids = [mkId(OLD, 'a@b.c', TEAM, '2026-09-28'), mkId(NEW, 'a@b.c', TEAM, '2026-10-08')]
  const r = resolveForPin({ team: TEAM, bundleId: 'cn.shxuxi.proteus.experiments' }, ids, [])
  assert(r.identity && r.identity.sha1 === NEW, '应回退取最新')
  assert(r.profile === null, '不应有描述文件')
  assert(
    r.warnings.some((w) => w.includes('描述文件')),
    `应提示缺描述文件：${r.warnings.join(' | ')}`,
  )
})

check('描述文件授权不在本机钥匙串（他机签发）⇒ 告警 + 回退档里证书', () => {
  const ids = [mkId(NEW, 'a@b.c', TEAM, '2026-10-08')]
  const pin = { team: TEAM, certSha1: NEW, bundleId: 'cn.shxuxi.proteus.experiments' }
  const r = resolveForPin(pin, ids, [mkProf('cn.shxuxi.proteus.experiments', TEAM, [OTHER])])
  assert(r.identity && r.identity.sha1 === NEW, '应回退到档里证书')
  assert(
    r.warnings.some((w) => w.includes('不在本机钥匙串')),
    `应提示交集为空：${r.warnings.join(' | ')}`,
  )
})

check('bundle 回填：档里没写 bundle ⇒ 用描述文件的', () => {
  const ids = [mkId(NEW, 'a@b.c', TEAM, '2026-10-08')]
  const r = resolveForPin({ team: TEAM, certSha1: NEW, bundleId: '' }, ids, [mkProf('cn.shxuxi.proteus.experiments', TEAM, [NEW])])
  assert(r.bundleId === 'cn.shxuxi.proteus.experiments', '应从描述文件回填 bundle')
})

if (failed) {
  console.error(`\n✗ 自测失败 ${failed} 项`)
  process.exit(1)
}
console.log('\n✅ 自测全过（7 项）')
