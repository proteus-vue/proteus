// examples/scripts/dev-mp.ts
// ★dev 体验：微信小程序开发 watch 模式 —— 改代码自动重建产物，微信开发者工具（导入 dist/mp-weixin）自动刷新
// 机制：监听 pages/subpackages/src/框架组件/配置 → 防抖 → 重跑 gen-routes + vite build（M8 编译缓存增量）
// ★G-34 收尾（devtools-plus）：内置 HMR dev server —— 变更 .vue → compileVueSfc 增量编译 → WS 广播 HmrPayload
//   （产物重建与 HMR 广播双通道并行：前者给微信开发者工具，后者给连接的 HMR Runtime/DevTools 面板）
// 说明：小程序页面不在 vite 模块图（transform 不触发），故不能用 vite dev/build --watch，需自定义文件监听
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createHmrDevServer } from '@proteus-vue/hmr/dev-server'
import type { HmrPayload } from '@proteus-vue/hmr'
import { compileVueSfc } from '@proteus-vue/compiler'

const ROOT = process.cwd()
const DEBOUNCE_MS = 300
const HMR_PORT = Number(process.env.PROTEUS_HMR_PORT ?? 5174)

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

/** ★G-34：变更文件 → 单文件增量编译（compileVueSfc）→ HmrPayload[]（.vue 以外类型跳过） */
function incrementalCompile(files: string[]): HmrPayload[] {
  const payloads: HmrPayload[] = []
  let id = 1
  for (const f of files) {
    if (!f.endsWith('.vue')) continue
    try {
      const result = compileVueSfc(fs.readFileSync(f, 'utf-8'))
      payloads.push({
        id: id++,
        file: path.relative(ROOT, f),
        type: 'vue',
        action: 'update',
        timestamp: Date.now(),
        code: result.js,
      })
    } catch (err) {
      console.warn(`[dev-mp] ⚠ HMR 增量编译失败：${path.relative(ROOT, f)}（${(err as Error).message}）`)
    }
  }
  return payloads
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

async function main(): Promise<void> {
  // ★G-34 收尾：HMR dev server（WS + watch + 增量编译广播）
  const hmr = createHmrDevServer({
    port: HMR_PORT,
    watchRoots: MONITOR,
    debounceMs: DEBOUNCE_MS,
    compile: incrementalCompile,
    onEvent: (e) => {
      if (e.type === 'listening') console.log(`[dev-mp] HMR dev server 就绪：ws://127.0.0.1:${e.port}（PROTEUS_HMR_PORT 可改）`)
      if (e.type === 'client-connect') console.log(`[dev-mp] HMR 客户端接入（当前 ${e.clientCount}）`)
      if (e.type === 'compiled') console.log(`[dev-mp] HMR 增量编译 ${e.payloads.length} payload（compileVueSfc 单文件）`)
      if (e.type === 'broadcast') console.log(`[dev-mp] HMR 广播 ${e.payloads.length} payload → ${hmr.clientCount} 客户端`)
    },
  })
  await hmr.start()

  await rebuild()
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
}

void main()
