// packages/api/src/bridge-decls/index.ts —— 声明注册表（生成器的唯一输入）
//
// 【新增能力 = 写一个声明文件 + 在此登记一行 + 跑生成器】
//   （`node scripts/gen-bridge-ext.mjs`；`--check` 接门禁）
import type { CapabilityDecl } from '../bridge-decl'
import { keepScreenOn } from './keep-screen-on'

export const BRIDGE_DECLS: readonly CapabilityDecl[] = [keepScreenOn]
