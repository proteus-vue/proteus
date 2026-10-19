// hosts/android/tools/ws-echo-server.mjs
// ★★★决策 #1093：WebSocket 真机判据用的**本地 echo 服务**（`run-ws-probe.sh` 起它）。
//
// 【为什么自带服务端（而不是连公网 echo）】
//   判据要可复现：公网 echo 会限流、会断、内容会变；而"连不上"与"宿主腿有 bug"在读数上无法区分。
//   本地服务让每个失败点都能归因（服务日志 + 探针报告两侧都有）。
//
// 【它回什么（与探针的六步一一对应）】
//   · 收到**文本** ⇒ 原样回文本（探针验 `echo_ok`）
//   · 收到**二进制** ⇒ 原样回二进制（探针验逐字节相等——掩码/长度编码错了这里必炸）
//   · 收到文本 `__close__` ⇒ 服务端主动关（探针验 close code；本次探针走的是客户端 close）
//   · 任何消息都在 stderr 记一行（服务日志可归因）
//
// 【端口】参数 1；缺省 8787。就绪后打印 `ws-echo-ready`（脚本用 --port 探活，不依赖本行，但便于人看）。

import { WebSocketServer } from 'ws'

const port = Number(process.argv[2] ?? 8787)
const wss = new WebSocketServer({ port, host: '127.0.0.1' })

wss.on('listening', () => {
  console.log(`ws-echo-ready port=${port}`)
})

let connSeq = 0
wss.on('connection', (ws, req) => {
  const id = ++connSeq
  console.error(`[echo] conn#${id} open from ${req.socket.remoteAddress}`)
  ws.on('message', (data, isBinary) => {
    const label = isBinary ? `binary(${data.length}B)` : `text(${String(data).length}B)`
    console.error(`[echo] conn#${id} recv ${label}`)
    if (isBinary) {
      ws.send(data, { binary: true })   // ★二进制原样回（不转字符串）
    } else {
      const s = String(data)
      if (s === '__close__') {
        // 服务端主动关闭（探针未用到，留给人工排查）
        ws.close(1000, 'server-close')
        return
      }
      ws.send(s, { binary: false })
    }
  })
  ws.on('close', (code, reason) => {
    console.error(`[echo] conn#${id} close code=${code} reason=${String(reason)}`)
  })
  ws.on('error', (e) => {
    console.error(`[echo] conn#${id} error ${e?.message ?? e}`)
  })
})

// 有界退出：父脚本 kill 时干净收尾（不留端口占用）
process.on('SIGTERM', () => { wss.close(() => process.exit(0)) })
process.on('SIGINT', () => { wss.close(() => process.exit(0)) })
