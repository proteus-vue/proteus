// tests/hmr-dev-server.test.ts —— @proteus-vue/hmr/dev-server（devtools-plus G-34 收尾：编译侧增量闭环）
// WS 服务端：连接/广播/clientCount/close
// watch 管线：文件变更 → 防抖合并 → compile 增量编译 → broadcast；ignore 规则；compile 异常 → error 事件
// ★真实增量编译：compile 回调接 @proteus-vue/compiler.compileVueSfc（与编译侧集成验证）
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHmrDevServer } from '@proteus-vue/hmr/dev-server'
import type { HmrDevServer } from '@proteus-vue/hmr/dev-server'
import { compileVueSfc } from '@proteus-vue/compiler'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 等待条件成立（真实 fs.watch / WS 事件均为异步） */
async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor 超时')
    await new Promise((r) => setTimeout(r, 15))
  }
}

/** 建立 WS 连接（open 确认后返回，避免连接事件竞争） */
async function connect(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('WS 连接失败'))
  })
  return ws
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-hmr-'))
}

const servers: HmrDevServer[] = []

// ★真实 WS + fs.watch 时序测试：放宽文件级超时（vitest 默认 5s 在并行负载下可能不够）
vi.setConfig({ testTimeout: 15000 })

afterEach(async () => {
  for (const s of servers) await s.close().catch(() => {})
  servers.length = 0
})

describe('HMR Dev Server：WS 服务端', () => {
  it('start → 客户端连接（clientCount）+ broadcast 单/批量 payload 接收', async () => {
    const server = createHmrDevServer({ port: 0, watchRoots: [], compile: () => [] })
    servers.push(server)
    await server.start()
    expect(server.port).toBeGreaterThan(0)

    const ws = await connect(server.port)
    const received: unknown[] = []
    ws.onmessage = (ev) => received.push(JSON.parse(String(ev.data)))
    await waitFor(() => server.clientCount === 1)

    const p = { id: 1, file: 'src/a.vue', type: 'vue', action: 'update', timestamp: Date.now(), code: 'x' }
    server.broadcast([p])
    await waitFor(() => received.length === 1)
    expect(received[0]).toEqual(p)

    // 批量（数组）广播——单条消息携带 2 个 payload
    server.broadcast([{ ...p, id: 2 }, { ...p, id: 3, type: 'css' }])
    await waitFor(() => received.length === 2)
    expect(Array.isArray(received[1])).toBe(true)
    ws.close()
  })

  it('close → 客户端断开', async () => {
    const server = createHmrDevServer({ port: 0, watchRoots: [], compile: () => [] })
    servers.push(server)
    await server.start()
    const ws = await connect(server.port)
    await waitFor(() => server.clientCount === 1)
    await server.close()
    expect(server.clientCount).toBe(0)
    ws.close()
  })
})

describe('HMR Dev Server：watch → 防抖 → 增量编译 → 广播', () => {
  it('文件变更 → 防抖合并（一次保存多文件）→ compile 收到文件集合 → payload 广播', async () => {
    const dir = tmpDir()
    const watchRoots = [dir]
    const received: unknown[] = []
    const compileFiles: string[][] = []
    const server = createHmrDevServer({
      port: 0,
      watchRoots,
      debounceMs: 50,
      compile: (files) => {
        compileFiles.push(files)
        return files.map((f, i) => ({ id: i + 1, file: path.relative(dir, f), type: 'vue', action: 'update', timestamp: Date.now(), code: 'x' }))
      },
    })
    servers.push(server)
    await server.start()

    const ws = await connect(server.port)
    ws.onmessage = (ev) => received.push(JSON.parse(String(ev.data)))
    await waitFor(() => server.clientCount === 1)

    // 同一防抖窗口内写入两个文件（模拟一次保存触发多文件）
    fs.writeFileSync(path.join(dir, 'a.vue'), '<template><view>a</view></template>')
    fs.writeFileSync(path.join(dir, 'b.vue'), '<template><view>b</view></template>')

    await waitFor(() => compileFiles.length === 1)
    expect(compileFiles[0].length).toBe(2)
    await waitFor(() => received.length === 1)
    expect(received[0]).toEqual([
      { id: 1, file: 'a.vue', type: 'vue', action: 'update', timestamp: expect.any(Number), code: 'x' },
      { id: 2, file: 'b.vue', type: 'vue', action: 'update', timestamp: expect.any(Number), code: 'x' },
    ])
    ws.close()
  })

  it('ignore 规则：node_modules/dist/.git/隐藏文件不触发编译', async () => {
    const dir = tmpDir()
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true })
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true })
    const compile = vi.fn(() => [])
    const server = createHmrDevServer({ port: 0, watchRoots: [dir], debounceMs: 30, compile })
    servers.push(server)
    await server.start()

    fs.writeFileSync(path.join(dir, 'node_modules', 'dep.js'), 'x')
    fs.writeFileSync(path.join(dir, '.git', 'config'), 'x')
    fs.writeFileSync(path.join(dir, 'dist', 'out.js'), 'x')
    await new Promise((r) => setTimeout(r, 150))
    expect(compile).not.toHaveBeenCalled()

    // 正常文件触发
    fs.writeFileSync(path.join(dir, 'c.vue'), '<template><view>c</view></template>')
    await waitFor(() => compile.mock.calls.length === 1)
  })

  it('compile 抛错 → error 事件（不崩溃、不广播）', async () => {
    const dir = tmpDir()
    const events: string[] = []
    const server = createHmrDevServer({
      port: 0,
      watchRoots: [dir],
      debounceMs: 30,
      compile: () => {
        throw new Error('boom')
      },
      onEvent: (e) => events.push(e.type),
    })
    servers.push(server)
    await server.start()
    fs.writeFileSync(path.join(dir, 'bad.vue'), 'x')
    await waitFor(() => events.includes('error'))
    expect(events).toContain('files-changed')
    expect(events).not.toContain('broadcast')
  })

  it('★真实增量编译：compile 接 compileVueSfc（单文件 .vue → payload.code 编译产物）', async () => {
    const dir = tmpDir()
    const source = `<script setup lang="ts">
import { ref } from 'vue'
const count = ref(1)
</script>
<template><view><text>{{ count }}</text></view></template>`
    const vueFile = path.join(dir, 'pages', 'index.vue')
    fs.mkdirSync(path.dirname(vueFile), { recursive: true })
    fs.writeFileSync(vueFile, source)

    const received: Array<{ id: number; file: string; code?: string }> = []
    const server = createHmrDevServer({
      port: 0,
      watchRoots: [dir],
      debounceMs: 30,
      compile: (files) =>
        files
          .filter((f) => f.endsWith('.vue'))
          .map((f, i) => {
            const result = compileVueSfc(fs.readFileSync(f, 'utf-8'))
            return {
              id: i + 1,
              file: path.relative(dir, f),
              type: 'vue' as const,
              action: 'update' as const,
              timestamp: Date.now(),
              code: result.js,
            }
          }),
    })
    servers.push(server)
    await server.start()

    const ws = await connect(server.port)
    ws.onmessage = (ev) => received.push(JSON.parse(String(ev.data)))
    await waitFor(() => server.clientCount === 1)

    // 变更页面 → 增量编译 → payload.code 为编译产物 JS
    fs.writeFileSync(vueFile, source.replace('const count = ref(1)', 'const count = ref(2)'))
    await waitFor(() => received.length === 1)
    expect(received[0].file).toBe(path.join('pages', 'index.vue'))
    expect(received[0].code).toContain('count') // 编译产物逻辑层 JS
    expect(received[0].code?.length).toBeGreaterThan(10)
    ws.close()
  })
})
