# @proteus-vue/devtools-runtime

Proteus DevTools 运行时（devtools-plan B1）：统一 trace 事件流。

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

## 能力（B1）

- TraceEvent 协议：source（lifecycle/router/store/api/capability/compiler/component）× phase（start/end/point/error）
- 环形缓冲（满丢最旧）/ 订阅取消 / flush
- 脱敏 redactValue：递归（嵌套对象/数组/Map/Set/Date），键名大小写不敏感（token/Token/TOKEN）
- 采样：traceId hash 取模（同链路同采弃）；`phase:'error'` 强制全采（tail sampling）
- 零开销门控：`setEnabled(false)` → emit noop
- ES5-safe → MP 共享模块可用

## 规划

六源接入（B2）、面板（时间轴/快照/火焰图/根因，v1.0+）见 `docs/proteus-devtools-plan/14-landing-evaluation.md`
