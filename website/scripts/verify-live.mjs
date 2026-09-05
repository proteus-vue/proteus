#!/usr/bin/env node
// website/scripts/verify-live.mjs —— 部署后核验（★#465）：线上产物 hash == 本次构建 hash
//   读 website/dist/index.html 的 main-*.js（期望）→ 拉取线上首页比对（重试抗 CDN 传播）
//   用法：node website/scripts/verify-live.mjs [--expect-main <hash>]；npm run check:live
//   env：PROTEUS_LIVE_URL（缺省 https://proteus-vue.cn）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WEBSITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST_INDEX = path.join(WEBSITE, 'dist', 'index.html')
const LIVE_URL = process.env.PROTEUS_LIVE_URL ?? 'https://proteus-vue.cn'
const MAIN_RE = /main-[A-Za-z0-9_-]+\.js/

function expectFlag(argv) {
  const i = argv.indexOf('--expect-main')
  return i >= 0 ? argv[i + 1] : undefined
}
const expectMain = expectFlag(process.argv.slice(1))

/** 期望 main hash：优先旗标，否则读本地 dist（本次构建产物） */
function resolveExpected() {
  if (expectMain) return expectMain
  if (!fs.existsSync(DIST_INDEX)) {
    console.error(`[verify-live] 未找到 ${DIST_INDEX}——先构建 website（npm run build --filter website）再核验`)
    process.exit(2)
  }
  const html = fs.readFileSync(DIST_INDEX, 'utf8')
  const m = html.match(MAIN_RE)
  if (!m) {
    console.error(`[verify-live] dist/index.html 未解析到 main-*.js（${DIST_INDEX}）`)
    process.exit(2)
  }
  return m[0]
}

/** 拉取线上首页 main hash（失败/未解析 → null） */
async function fetchLiveMain() {
  try {
    const res = await fetch(LIVE_URL, { redirect: 'follow', headers: { 'user-agent': 'proteus-verify-live' } })
    if (!res.ok) return null
    const html = await res.text()
    return html.match(MAIN_RE)?.[0] ?? null
  } catch {
    return null
  }
}

const expected = resolveExpected()
const ATTEMPTS = 15
const INTERVAL_MS = 10_000

for (let i = 1; i <= ATTEMPTS; i++) {
  const live = await fetchLiveMain()
  if (live === expected) {
    console.log(`[verify-live] ✅ 线上同步：${LIVE_URL} main = ${live}`)
    process.exit(0)
  }
  console.log(`[verify-live] 第 ${i}/${ATTEMPTS} 次：期望 ${expected} · 线上 ${live ?? '不可达/未解析'}——等待 CDN 传播…`)
  if (i < ATTEMPTS) await new Promise((r) => setTimeout(r, INTERVAL_MS))
}

console.error(`[verify-live] ❌ 线上产物与本次构建不一致（期望 ${expected}）——部署未生效或缓存异常，请人工检查 Pages run`)
process.exit(1)
