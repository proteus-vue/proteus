# @proteus-vue/hmr

Proteus HMR 运行时（devtools-plus **G-34 M1**）——HMR payload 协议 + 运行时 + Vue `import.meta.hot` 适配 + WebSocket 客户端 + 安全 reload。**开发期工具链**，不随业务产物发布；**零依赖**（全部接口注入式），纯逻辑可单测（Web 端优先）。

## 导出

| API | 说明 |
|-----|------|
| `createHmrRuntime(options)` | **HMR Runtime 核心**：接收增量 payload → 分派（vue/js 热替换 / native-binding 安全 reload / css-asset 资源替换）+ 按 id 防乱序 + 状态保留 + 严格规则 + 可观测事件；**`applyBatch` 批量接口**（同文件合并只保留最终状态 + 按 id 排序） |
| `createHmrClient(options)` | **WebSocket 客户端**：连接 Dev Server → payload 分发到 runtime；断线指数退避重连（maxAttempts 上限）；`createSocket` 注入可单测 |
| `createVueHotAdapter(options)` | **Vue `import.meta.hot` 适配**：accept/dispose/invalidate 语义面 + `applyWithState` 状态保留（dispose 快照 → 新模块恢复，Flutter Hot Reload 体验）；无 hot 环境安全降级 no-op |
| `createSafeReload(options)` | **安全 reload**（HMR002）：保存状态（collect 注入；M3 原生侧联动 Router G-32 栈序列化）→ reload → 恢复；Web 实现用 sessionStorage + location.reload |

## 子路径：`@proteus-vue/hmr/dev-server`（Node 侧，G-34 收尾）

| API | 说明 |
|-----|------|
| `createHmrDevServer(options)` | **HMR Dev Server**：WS 服务端（host 缺省 127.0.0.1）+ 文件 watch 防抖管线 + **增量编译回调注入**（`compile(files) → HmrPayload[]`）→ 广播；链路：保存文件 → watch 收集 → 防抖合并 → 增量编译 → WS 广播 → 客户端 Runtime 应用；`port 0` 随机端口 + 实际端口 getter |

```ts
import { createHmrDevServer } from '@proteus-vue/hmr/dev-server'

const server = createHmrDevServer({
  port: 5174,
  watchRoots: ['pages', 'src'],
  debounceMs: 300,
  compile: (files) => files.filter((f) => f.endsWith('.vue')).map((f) => ({
    id: ++id, file: relative(root, f), type: 'vue', action: 'update', timestamp: Date.now(),
    code: compileVueSfc(readFileSync(f, 'utf-8')).js, // 单文件增量编译
  })),
  onEvent: (e) => console.log('[hmr]', e.type),
})
await server.start() // WS 监听 + watch 启动
```

★生产接入参考 `examples/scripts/dev-mp.ts`（dev-mp 已内置 HMR dev server：改 .vue → compileVueSfc 增量 → WS 广播，E2E 实测闭环通过）。

## 类型

- `HmrPayload`：`{ id, file, type: 'vue'|'js'|'css'|'asset'|'native-binding', code?, timestamp, action: 'update'|'reload' }`——一次增量更新的传输单元
- `HmrEvent`：可观测事件（connected/disconnected/reconnecting/payload/apply/rule/error）——**原则 #3 编译透明的 DevTools 数据源**
- `HmrTransport` / `HmrWebSocketLike` / `SafeReload`：结构类型，注入式零硬依赖

## 严格规则

| 编号 | 规则 | 处理 |
|------|------|------|
| HMR001 | 替换前存在未清理的模块实例（副作用未 dispose） | warn（`checkSideEffects` 可关） |
| HMR002 | 原生 binding 变更无法热替换 | 自动安全 reload |
| HMR003 | 状态丢失检测（reload/应用失败/缺 code） | warn + 降级安全 reload（`checkStateLoss` 可关） |

## 使用

```ts
import { createHmrRuntime, createHmrClient, createSafeReload } from '@proteus-vue/hmr'

// 1. 运行时（模块应用器 + 安全 reload + 可观测）
const runtime = createHmrRuntime({
  applyModule(file, code) {
    // vue/js：应用新模块（Vite import.meta.hot / 编译产物替换）
    return applyVueModule(file, code) // 失败返回 false → 自动降级安全 reload
  },
  reload: safeReload.reload,
  onEvent: (e) => console.log('[hmr]', e), // DevTools 面板数据源
})

// 2. Dev Server 推送 → WS 客户端（自动重连）
const client = createHmrClient({
  url: 'ws://localhost:5174/__proteus_hmr__',
  runtime,
})
client.connect()
```

## 性能预算（G-34 §6）

| 指标 | 预算 | 现状 |
|------|------|------|
| HMR 编译耗时 | < 50ms | 🔶 编译侧增量未落地（dev-mp 全量重建 + M8 缓存） |
| 推送到渲染 | < 100ms | ✅ 1000 payload 批量应用实测 < 100ms（单测基准断言） |
| 安全 reload | < 2s | 🔶 未验证（Web 实现为 location.reload） |
| DevTools 开销 | < 5% CPU | 🔶 M2 面板未落地 |

**运行时侧已做优化**：批量 payload 同文件合并（一次保存多文件变更 → 只保留最终状态，中间态丢弃）+ 乱序 batch 按 id 全局排序 + 单条消息可带 payload 数组（client 自动走 `applyBatch`）。

## 后续里程碑

- **M2** DevTools 桥接（CDP + Style Safety 可视化）
- **M3** 原生侧安全 reload（iOS/Android/鸿蒙，联动 App Renderer + Router G-32）
- **M4** 原生视图检查器 + LeakRegistry 集成
