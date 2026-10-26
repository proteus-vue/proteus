#!/usr/bin/env node
// scripts/studio-panel-serve.mjs —— 把构建产物用 http 端出来（决策 #1247 从门禁拆出）
//
// ★为什么必须走 http 而不是 `file://`：Vite 产物是 ES module，file:// 下 origin 为 null
//   会被 CORS 挡掉；而且 http 更接近真实运行（Tauri 用 tauri:// 自定义协议，同样是"有 origin"）。
// ★只监听 127.0.0.1 + 端口 0（内核分配）：不占固定端口，也不会被同机另一个门禁实例撞掉。
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

/**
 * @param {string} distDir 构建产物目录
 * @returns {Promise<{ port: number, close: () => void }>}
 */
export async function serveDist(distDir) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0])
    const file = path.join(distDir, rel === '/' ? 'index.html' : rel)
    // 目录穿越防护：解析后的路径必须仍在 distDir 内
    if (!file.startsWith(distDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { port: server.address().port, close: () => server.close() }
}
