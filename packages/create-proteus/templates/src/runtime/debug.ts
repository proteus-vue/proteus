// src/runtime/debug.ts
// 全链路调试机制（★反"猜问题"机制）
// PROTEUS_DEBUG=1 构建时，vite define 注入 __PROTEUS_DEBUG__ = true
// 统一日志格式：[proteus][环节] 详情 <时间戳>
// 环节标签：app（启动/注册）/ page（页面生命周期）/ nav（导航链路）/ error（全局错误）
import { DEBUG } from './debug-flag'

/** 链路日志（debug 构建才输出） */
export function trace(tag: string, ...args: unknown[]): void {
  if (!DEBUG) return
  console.log(`[proteus][${tag}]`, ...args, Date.now())
}

/** 链路错误日志 */
export function traceError(tag: string, err: unknown): void {
  if (!DEBUG) return
  console.error(`[proteus][${tag}]`, err, Date.now())
}
