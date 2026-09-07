# @proteus-vue/devtools-runtime

Proteus DevTools 运行时（devtools-plan B1）：统一 trace 事件流 + 数据层收集器。**UI 无关纯逻辑**（`@proteus-vue/devtools` 面板消费）；**ES5-safe → MP 共享模块可用**。

## 用法

```ts
import { createTraceBus } from '@proteus-vue/devtools-runtime'

// 应用侧单例（开发开启，生产默认关闭 → emit 零开销）
export const bus = createTraceBus({ enabled: import.meta.env.DEV, bufferSize: 10000 })

bus.emit('router', 'point', 'router.beforeEach', { from: '/a', to: '/b' }, 'trace-123')
bus.emit('component', 'point', 'component.render', { tag: 'p-list-view', itemCount: 12 })

// 订阅 / 面板推送
const off = bus.on((e) => console.log(e.source, e.phase, e.name))
const batch = bus.flush() // 取出并清空缓冲
```

## ★惰性单例（一键接入收口）

router/api/capability 发射端与 `installProteusDevtools` 共享同一实例，避免业务侧手动建 bus 传参：

```ts
import { getProteusTraceBus } from '@proteus-vue/devtools-runtime'
const bus = getProteusTraceBus()
if (import.meta.env.DEV || __PROTEUS_DEBUG__) bus.setEnabled(true) // 门控：生产零开销
```

> ⚠ enabled 必须由**应用侧源码**控制（本包 dist 是编译产物，vite 不转换 node_modules——内部引用全局常量会恒为 undefined）。

## TraceBus 能力

| 能力 | 说明 |
|------|------|
| TraceEvent 协议 | source（lifecycle/router/store/api/capability/compiler/component/hmr）× phase（start/end/point/error）× payload/timestamp/traceId |
| 环形缓冲 | 满丢最旧（缺省 10000）；`buffer` 只读快照 / `flush()` 取出清空 |
| 脱敏 `redactValue` | 递归（嵌套对象/数组/Map/Set/Date），键名大小写不敏感（token/Token/TOKEN），缺省 password/token/authorization/idcard/phone |
| 采样 | traceId hash 取模（同链路同采弃）；`phase:'error'` 强制全采（tail sampling） |
| 零开销门控 | `setEnabled(false)` → emit noop |
| 链路 ID | `createTraceId()`（时间戳 + 随机 hex，跨源串联） |

## 数据层收集器（面板各视图的数据源，UI 无关）

| API | 能力 |
|-----|------|
| `createTimelineCollector` | 事件 → span 泳道（inclusive/exclusive + pending/point；万级 span 预算） |
| `createFlamegraphCollector` | start/end 事件 → **全局嵌套栈父子树**（跨 source）+ 录制控制 + `compare` 两次录制 diff（±10% regression/improvement） |
| `createStateSnapshotter` | 兼容 Pinia 形态 store 快照（`serializeState/deserializeState`） |
| `createRouteBacktracker` | 导航记录 + 守卫瀑布（NavRecord/GuardRecord） |
| `createErrorDiagnoser` | 错误链构建 + 根因归因（RootCauseReport/ErrorPattern） |
| `createStoreTracer` | Pinia 插件形态 store 变更追踪（action/patch → 事件流） |

```ts
import { createFlamegraphCollector } from '@proteus-vue/devtools-runtime'
const flame = createFlamegraphCollector()
flame.start()                 // 录制（清空 + 基线）
bus.on((e) => flame.ingest(e))
flame.stop()
flame.roots()                 // 嵌套树（渲染必须用 roots——nodes() 是扁平列表）
flame.compare(previousRoots)  // 对比模式
```

## 约束

- **ES5-safe（决策 #32/#36）**：无 `??` / `?.` / 对象展开 / 数组解构 → 可进 MP 共享模块（`_proteus/devtools-runtime.js`）
- 所有 payload 必须 JSON-safe（节点引用转 handle）；脱敏在 emit 时递归执行
