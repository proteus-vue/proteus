// scripts/showcase-shot.mjs —— showcase 页面截图（框架自动化通道，可复现）
// ★不截桌面：走 wechatide simulator_screenshot（框架 TestDriver 底层通道）——返回图片路径，不依赖窗口位置/尺寸。
// 用法：node scripts/showcase-shot.mjs <页面名...> [--out <dir>]
//   例：node scripts/showcase-shot.mjs component-button component-input
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PROJECT = path.join(ROOT, 'showcase/dist/mp-weixin')
const CLI = process.env.PROTEUS_IDE_CLI || '/Volumes/data1/work/office-applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
const PORT = process.env.PROTEUS_AUTOMATOR_PORT || '9439'

const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const outDir = outIdx >= 0 ? args[outIdx + 1] : '/tmp/showcase-shots'
const pages = args.filter((a, i) => !a.startsWith('--') && i !== outIdx + 1)
fs.mkdirSync(outDir, { recursive: true })

function wxide(tool, extra = {}) {
  const argv = ['-c', 'zed', tool, '--project', PROJECT]
  for (const [k, v] of Object.entries(extra)) argv.push(`--${k}`, String(v))
  const r = spawnSync(CLI, argv, { encoding: 'utf8', timeout: 90_000 })
  const m = (r.stdout || '').match(/\{[\s\S]*\}/)
  if (!m) throw new Error(`${tool} 无 JSON 输出：${(r.stderr || r.stdout || '').slice(0, 200)}`)
  const body = JSON.parse(m[0])
  const res = body.result ?? body
  if (res.success === false) throw new Error(`${tool} 失败：${res.error ?? res.message ?? JSON.stringify(res)}`)
  return res
}

for (const p of pages) {
  const route = p.startsWith('/') ? p : `/pages/${p}`
  // 1) 导航（reLaunch + 重试：IDE 首次可能仍在编译 → 页面未就绪）
  let landed = false
  for (let attempt = 0; attempt < 5 && !landed; attempt++) {
    spawnSync(CLI, ['-c', 'zed', 'automation_navigate', '--project', PROJECT, '--action', 'reLaunch', '--url', route], { encoding: 'utf8', timeout: 90_000 })
    await new Promise((r) => setTimeout(r, 2500))
    // 确认 currentPage 已到目标路由（框架稳通道）
    try {
      const info = wxide('automation_runtime_info', { action: 'currentPage' })
      const cp = info.currentPage ?? {}
      landed = String(cp.path ?? cp.route ?? '').includes(p.replace(/^\//, ''))
    } catch { landed = false }
    if (!landed) console.log(`  … 等待页面就绪（第 ${attempt + 1} 次）`)
  }
  if (!landed) console.warn(`  ⚠ ${route} 未确认到达目标页（仍截图）`)
  // 2) 截图（框架通道）
  const out = path.join(outDir, `${p.replace(/\//g, '_')}.png`)
  const res = wxide('simulator_screenshot', { path: out })
  console.log(`✓ ${route} → ${res.path ?? out}（${res.imageWidth}×${res.imageHeight}）`)
}
