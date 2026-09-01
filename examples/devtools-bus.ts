// examples/devtools-bus.ts —— devtools 事件总线单例（main.ts 与 router 单例共享，避免循环依赖）
// 生产零开销：createTraceBus enabled 门控（发射端 in this repo 的 router/defineApp 均为可选调用，bus 关闭时 noop）
import { createTraceBus } from '@proteus-vue/devtools-runtime'

export const traceBus = createTraceBus({ enabled: true })
