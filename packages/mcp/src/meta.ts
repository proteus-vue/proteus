// packages/mcp/src/meta.ts —— 运行时元数据（真实包版本——避免 serverInfo 版本写死漂移）
//
// 【为什么有它】原 `server.ts` 把 `version` 写死为 `'0.1.0'`——与包实际版本（0.3.0-beta.x）不符，
//   MCP 客户端 `initialize` 拿到的 serverInfo.version 会误导（生产排查时会以为装错包）。
//   从包自身 package.json 读真实版本（src 与 dist 都解析 `../package.json` → 包根）。
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 读本包 package.json 的 version（src/ 与 dist/ 均解析到包根；失败退 '0.0.0'） */
export function resolveMcpVersion(): string {
  for (const rel of ['../package.json', '../../package.json']) {
    try {
      const v = JSON.parse(fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')).version
      if (typeof v === 'string' && v) return v
    } catch {
      /* 试下一个候选路径 */
    }
  }
  return '0.0.0'
}
