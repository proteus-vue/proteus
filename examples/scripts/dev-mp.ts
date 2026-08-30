// examples/scripts/dev-mp.ts
// ★dev 体验：微信小程序开发 watch 模式 —— 改代码自动重建产物，微信开发者工具（导入 dist/mp-weixin）自动刷新
// 机制：监听 pages/subpackages/src/框架组件/配置 → 防抖 → 重跑 gen-routes + vite build（M8 编译缓存增量）
// 说明：小程序页面不在 vite 模块图（transform 不触发），故不能用 vite dev/build --watch，需自定义文件监听
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DEBOUNCE_MS = 300

/** 监听清单：页面/分包/共享模块/配置/框架内置组件（仓库根 src/components） */
const MONITOR = [
  'pages',
  'subpackages',
  'src',
  'proteus.config.ts',
  'vite.config.ts',
  path.resolve(ROOT, '../src/components'), // 框架内置组件（monorepo 根）
].map((p) => path.resolve(ROOT, p))

let timer: ReturnType<typeof setTimeout> | null = null
let building = false
let pending = false

function runStep(step: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    console.log(`[dev-mp] ${step} ...`)
    const child = spawn('npx', args, { cwd: ROOT, shell: true, stdio: 'inherit' })
    child.on('close', (code) => {
      if (code !== 0) console.warn(`[dev-mp] ⚠ ${step} 退出码 ${code}`)
      resolve()
    })
    child.on('error', (err) => {
      console.error(`[dev-mp] ✗ ${step} 启动失败：${err.message}`)
      resolve()
    })
  })
}

async function rebuild(): Promise<void> {
  if (building) {
    pending = true
    return
  }
  building = true
  try {
    await runStep('gen-routes（路由表/app.json/page.json）', ['tsx', 'scripts/gen-routes.ts'])
    await runStep('vite build（页面/组件/共享模块 → dist/mp-weixin）', ['vite', 'build', '--mode', 'mp-weixin'])
    console.log('[dev-mp] ✅ 产物已更新（微信开发者工具将自动刷新；M8 缓存只重编译变更文件）')
  } finally {
    building = false
    if (pending) {
      pending = false
      void rebuild()
    }
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    console.log('\n[dev-mp] 检测到文件变更 → 防抖重建产物...')
    void rebuild()
  }, DEBOUNCE_MS)
}

void rebuild().then(() => {
  for (const dir of MONITOR) {
    if (!fs.existsSync(dir)) continue
    try {
      fs.watch(dir, { recursive: true }, (_ev, file) => {
        if (file) schedule()
      })
    } catch {
      // 个别目录 watch 失败不阻塞（如不存在）
    }
  }
  console.log(`[dev-mp] 监听中（变更 ${DEBOUNCE_MS}ms 防抖自动重建）：
  ${MONITOR.filter((d) => fs.existsSync(d)).join('\n  ')}
按 Ctrl+C 退出；微信开发者工具导入 examples/dist/mp-weixin 即可自动刷新`)
})
