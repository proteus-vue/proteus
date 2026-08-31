// packages/types/src/utils.ts
// ★types-plus-plan B1（01 §2/§6）：条件类型工具（M1 核心类型）
// 验收项：IfPlatform / ExtractByPlatform 在调用点正确收窄（新增平台成员后应自动报错提醒）

import type { Platform } from './index-shared'

/** 条件类型：平台为 P 时取 T，否则 never（01 §2） */
export type IfPlatform<P extends Platform, T> = P extends Platform ? T : never

/** 按平台从带 platform 字段的联合中抽取成员（01 §6） */
export type ExtractByPlatform<T, P extends Platform> = Extract<
  T extends { platform: infer Plat } ? (Plat extends P ? T : never) : never,
  unknown
>

/** 指定键必选（01 §6） */
export type RequiredBy<T, K extends keyof T> = T & { [P in K]-?: T[P] }
