// src/shims/import-meta.d.ts —— vite 注入的 import.meta.env 类型声明
// shared 包是「源码直发」（消费者经 alias/源引用），但 packages/* 自身的 tsc（声明构建）
// 也要过：web-adapter 用 import.meta.env.BASE_URL 读子路径 base（PROTEUS_BASE 注入，
// 构建期被 vite 内联为字面量）——无此声明 tsc 报 TS2339。
interface ImportMeta {
  readonly env?: {
    readonly BASE_URL?: string
    readonly MODE?: string
    readonly DEV?: boolean
    readonly PROD?: boolean
  }
}
