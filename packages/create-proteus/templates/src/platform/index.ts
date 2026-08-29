// src/platform/index.ts
// 平台适配器出口（P3-5）：按构建 mode 选择实现，业务代码只 import 这个实例
import config from '../../proteus.config'
import type { PlatformAdapter } from './adapter'
import { createMpAdapter } from './mp-adapter'
import { createWebAdapter } from './web-adapter'

// import.meta.env.MODE 由 Vite 按 --mode 静态替换（web / mp-weixin）
const mode = import.meta.env.MODE as string
const platform = mode === 'mp-weixin' || mode === 'web' ? mode : config.platform

/** 全局唯一适配器实例 */
export const adapter: PlatformAdapter =
  platform === 'mp-weixin' ? createMpAdapter() : createWebAdapter()
