// examples/open-api-types.ts —— 开放 API 演示的事件记录类型（纯类型模块；页面 import type 运行时剥离，MP 安全）
export interface EventRec {
  id: number
  source: string
  phase: string
  name: string
  timestamp: number
}
