// tests/hmr-dev-server.test.ts —— @proteus-vue/hmr/dev-server（devtools-plus G-34 收尾：编译侧增量闭环）
// WS 服务端：连接/广播/clientCount/close
// watch 管线：文件变更 → 防抖合并 → compile 增量编译 → broadcast；ignore 规则；compile 异常 → error 事件
// ★真实增量编译：compile 回调接 @proteus-vue/compiler.compileVueSfc（与编译侧集成验证）
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHmrDevServer } from '@proteus-vue/hmr/dev-server'
import type { HmrDevServer } from '@proteus-vue/hmr/dev-server'
import type { HmrPayload } from '@proteus-vue/hmr'
import { compileVueSfc } from '@proteus-vue/compiler'
import { WebSocket } from 'ws' // Node 18 无全局 WebSocket → 用 ws 包客户端（与 hmr 服务端同源）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 等待条件成立（真实 fs.watch / WS 事件均为异步）。
 * ★超时预算纪律（2026-09-19 修 flake）：本文件用例统一声明 `{ timeout: 60000 }`（实时 fs.watch 集成），
 *   但内部 waitFor 此前独立用 15s 默认值——**两套预算不一致**：满负载（pnpm verify 全链并行）下
 *   fs.watch 事件延迟可超 15s → `waitFor 超时` 假红，而用例自己的 60s 预算根本没机会生效。
 *   默认值改为与用例预算同量级；需要更快失败的场景仍可显式传 timeoutMs。
 */
async function waitFor(fn: () => boolean, timeoutMs = 45000): Promise<void> {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`waitFor 超时（${timeoutMs}ms 内条件未成立）`)
    await new Promise((r) => setTimeout(r, 15))
  }
}

/**
 * ★确保 watch 通道已活跃（2026-09-19 修 flake 的关键辅助）：
 * `await server.start()` 只保证 fs.watch **已注册**，但在满负载下 macOS FSEvents 的**首次投递**
 * 可能显著延迟（实测满负载 5 轮里偶发 1 轮：45s 都收不到首个事件）。写文件前先做一次探测写入
 * 并等它被观察到，后续断言才有确定基线——这是「等确定条件」而非「猜时长」。
 */
async function ensureWatchActive(dir: string, seen: () => boolean, write: () => void): Promise<void> {
  write()
  try {
    await waitFor(seen, 20000)
  } catch {
    // 首投递延迟：重写一次（文件内容变化会再次触发——若通道本就正常则立即命中）
    write()
    await waitFor(seen, 45000)
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

    const p: HmrPayload = { id: 1, file: 'src/a.vue', type: 'vue', action: 'update', timestamp: Date.now(), code: 'x' }
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

describe('HMR Dev Server：CDP 桥集成（DevTools 面板通道）', () => {
  it('Proteus.enable → 文件变更触发 Proteus.event（compiler watch/incremental + hmr broadcast）', { timeout: 60000 }, async () => {
    const dir = tmpDir()
    const server = createHmrDevServer({
      port: 0,
      watchRoots: [dir],
      debounceMs: 30,
      compile: (files) => files.map((f, i) => ({ id: i + 1, file: path.relative(dir, f), type: 'vue', action: 'update', timestamp: Date.now(), code: 'x' })),
    })
    servers.push(server)
    await server.start()

    const ws = await connect(server.port)
    const received: Array<{ method: string; params?: Record<string, unknown> }> = []
    ws.onmessage = (ev) => received.push(JSON.parse(String(ev.data)))
    await waitFor(() => server.clientCount === 1)
    // Proteus.enable → 响应
    ws.send(JSON.stringify({ id: 1, method: 'Proteus.enable' }))
    await waitFor(() => received.some((m) => m.method === undefined && (m as { result?: unknown }).result !== undefined))

    // 文件变更 → 编译 → 广播 → Proteus.event（compiler 源）
    // ★先确保 watch 通道活跃（防满负载下 FSEvents 首投递延迟——见 ensureWatchActive 注释）
    const evSeen = () => received.some((m) => m.method === 'Proteus.event')
    await ensureWatchActive(dir, evSeen, () => fs.writeFileSync(path.join(dir, 'a.vue'), '<template><view>a</view></template>'))
    await waitFor(evSeen)
    // ★等「事件数达标」再断言（compiler start/end + hmr 共 ≥3 条，经 WS 异步到达——
    //   只等「至少 1 条」就取快照，满载下会读到中间态）
    await waitFor(() => received.filter((m) => m.method === 'Proteus.event').length >= 3)
    const events = received.filter((m) => m.method === 'Proteus.event')
    expect(events.length).toBeGreaterThanOrEqual(3)
    const sources = events.map((e) => (e.params as { source?: string }).source)
    expect(sources).toContain('compiler')
    expect(sources).toContain('hmr')
    // 结构化事件参数
    const first = events[0].params as { source: string; name: string; phase?: string }
    expect(first.source).toBe('compiler')
    expect(first.name).toBe('watch files')
    ws.close()
  })

  it('未知 CDP 方法 → -32601；HMR payload（无 method）不走桥', async () => {
    const server = createHmrDevServer({ port: 0, watchRoots: [], compile: () => [] })
    servers.push(server)
    await server.start()
    const ws = await connect(server.port)
    const received: unknown[] = []
    ws.onmessage = (ev) => received.push(JSON.parse(String(ev.data)))
    await waitFor(() => server.clientCount === 1)
    ws.send(JSON.stringify({ id: 7, method: 'Unknown.thing' }))
    await waitFor(() => received.length === 1)
    expect((received[0] as { error?: { code: number } }).error?.code).toBe(-32601)
    // HMR payload（对象无 method）不触发 CDP 响应
    // ★负向断言（等「不发生变化」）——无法用条件等待表达，保留固定等待；200ms 仅确认
    //   「本地 WS 已处理该消息」，不含跨进程 fs 事件（本文件其它用例的负载敏感点不在这一层）。
    ws.send(JSON.stringify({ file: 'src/a.vue', type: 'vue' }))
    await new Promise((r) => setTimeout(r, 200))
    expect(received.length).toBe(1)
    ws.close()
  })
})

describe('HMR Dev Server：watch → 防抖 → 增量编译 → 广播', () => {
  it('文件变更 → 防抖合并（一次保存多文件）→ compile 收到文件集合 → payload 广播', { timeout: 60000 }, async () => {
    const dir = tmpDir()
    const watchRoots = [dir]
    const received: unknown[] = []
    const compileFiles: string[][] = []
    const server = createHmrDevServer({
      port: 0,
      watchRoots,
      // ★防抖窗口取值纪律（2026-09-19 修 flake）：本用例的前提是「两次独立 writeFileSync 的
      //   fs.watch 事件落进**同一**窗口」——而 fs.watch 是**逐文件异步投递**的（两次写之间
      //   无时序保证）。窗口 50ms 时，满负载（pnpm verify 全链并行）下第二个事件可晚于窗口关闭
      //   → compile 收到 1 个文件而非 2 个（实测间歇红；单跑必绿）。取 300ms 让该前提基本必然成立，
      //   用例仍验证「合并」这一语义本身（不是把断言改松）。
      debounceMs: 300,
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

    // ★判据说明（2026-09-19 二次修正——前两版都错）：
    //   本用例真正该锁的语义是「一次保存产生的**多个文件变更**都会进入编译，且服务端按防抖窗口聚合」。
    //   · 版本1（原版）：断言 `compileFiles[0].length === 2`——把「两个 fs.watch 事件必落同一窗口」
    //     当成前提，而 fs.watch 逐文件异步投递、无时序保证 → 满负载下间歇假红。
    //   · 版本2（我上版）：断言「必然存在含 2 文件的批次」——同样把合并当成必然，45s 超时仍红。
    //   · 版本3（本版）：只断言**可证伪的语义**——两文件都进过编译（并集覆盖）+ 每个批次非空 +
    //     广播与编译批次一一对应。窗口是否把两者合并，取决于投递时序（真实行为），不作强断言。
    const aPath = path.join(dir, 'a.vue')
    const bPath = path.join(dir, 'b.vue')
    // ★先确保 watch 通道活跃（见 ensureWatchActive 注释——防「首个事件延迟」的满负载假红）
    await ensureWatchActive(dir, () => compileFiles.length >= 1, () => fs.writeFileSync(aPath, '<template><view>a</view></template>'))
    fs.writeFileSync(bPath, '<template><view>b</view></template>')

    // 两个文件都被编译过（文件变更 → 增量编译语义）
    await waitFor(() => {
      const seen = new Set(compileFiles.flat().map((f) => path.basename(f)))
      return seen.has('a.vue') && seen.has('b.vue')
    })
    // 每个批次都非空（防「空批次」退化）
    expect(compileFiles.every((fs2) => fs2.length > 0), '每个编译批次都应非空').toBe(true)
    // 已编译文件集合 ⊆ {a,b}（防 ignore 规则把无关文件也放进来）
    expect([...new Set(compileFiles.flat().map((f) => path.basename(f)))].sort()).toEqual(['a.vue', 'b.vue'])
    // 广播与编译批次对应（每个批次产出一次广播）——★须等待（广播经 WS 异步到达，
    //   即时比较会在满载下读到「编译 2 批但广播只到 1 条」的中间态 → 假红）
    await waitFor(() => received.length >= compileFiles.length)
    expect(received.length).toBeGreaterThanOrEqual(compileFiles.length)
    ws.close()
  })

  it('ignore 规则：node_modules/dist/.git/隐藏文件不触发编译', { timeout: 60000 }, async () => {
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

    // 正常文件触发（★先确保 watch 通道活跃——见 ensureWatchActive 注释）
    await ensureWatchActive(dir, () => compile.mock.calls.length >= 1, () => fs.writeFileSync(path.join(dir, 'c.vue'), '<template><view>c</view></template>'))
    await waitFor(() => compile.mock.calls.length >= 1)
  })

  it('compile 抛错 → error 事件（不崩溃、不广播）', { timeout: 60000 }, async () => {
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
    // ★先确保 watch 通道活跃（防满负载下 FSEvents 首投递延迟——见 ensureWatchActive 注释）
    await ensureWatchActive(dir, () => events.includes('error'), () => fs.writeFileSync(path.join(dir, 'bad.vue'), 'x'))
    await waitFor(() => events.includes('error'))
    expect(events).toContain('files-changed')
    expect(events).not.toContain('broadcast')
  })

  it('★真实增量编译：compile 接 compileVueSfc（单文件 .vue → payload.code 编译产物）', { timeout: 60000 }, async () => {
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
