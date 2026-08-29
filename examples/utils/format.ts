// examples/utils/format.ts —— 共享工具模块（module-plan B0 演示：跨模块引用）
// 页面 import { formatTime } from '../utils/format'：
//   Web 端 → Vite ESM 原生；MP 端 → 编译为 require('../utils/format.js')（本文件由插件 esbuild bundle 为 CJS 独立产物）
export function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n)
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.getHours() + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
}
