// hosts/harmony/doh-probe-server.mjs
// ★★★#12xx：鸿蒙 DoH 真机对照的**本地 DoH 服务端**（判据装置，不是产品代码）。
//
// 【为什么要它】矩阵 §3 记着「RCP 内置 DoH，但只做了头文件取证，未实测」。
//   要证明「配了 `doh.url` ⇒ 解析真的走 DoH」，必须让**只有 DoH 才能给出的答案**出现：
//   · 目标域名用 `.invalid`（RFC 2606 保留 TLD，系统 DNS **必然**解析不出来）；
//   · 本服务端把它解析到 **127.0.0.1**（经 `hdc rport` 就是这台 Mac）；
//   ⇒ 请求能成功 = 只可能是 DoH 起作用（系统 DNS 无路可走）。
//
// 【对照的另一半】`mode=unreachable` 时回 `203.0.113.1`（TEST-NET-3，不可达）：
//   若请求**失败**，证明 DoH 给的答案真的被采用（不是"配了但不生效"）。
//
// 【模式】由 `/control?mode=…&ip=…` 热切换（不重启进程，避免每轮重建端口转发）：
//   · `a`           ⇒ A 查询回 `ip`（缺省 127.0.0.1），AAAA 回空 NOERROR
//   · `nxdomain`    ⇒ RCODE=3（用于取证「DoH 无答案时是否回落系统 DNS」）
//   · `unreachable` ⇒ 同 `a`，但 ip=203.0.113.1（语义等价的显式别名）
//
// 【读数】`/stats` 回 `{queries, qnames, lastMode}`——**服务端侧**的查询计数是"DoH 真的被用了"
//   的第三方证据（不依赖设备端自报）。落盘 `doh-probe-server.json` 供判据脚本读取。
//
// 【诚实边界】本服务端用**自签证书**（`skipCertificatesValidation=true` 才连得上）
//   ⇒ 它证明的是「DoH 这条配置路径真的接通」，**不**证明「真实 CA 校验下同样成立」。
import { createSecureServer } from 'node:http2';
import { createServer as createHttpServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';

const PORT = Number(process.env.DOH_PORT || 18443);
const HTTP_PORT = Number(process.env.DOH_TARGET_PORT || 18080);
const CERT = process.env.DOH_CERT || '/tmp/proteus-doh/cert.pem';
const KEY = process.env.DOH_KEY || '/tmp/proteus-doh/key.pem';
const STATS = process.env.DOH_STATS || '/tmp/proteus-doh/doh-probe-server.json';

let mode = 'a';
let ip = '127.0.0.1';
let queries = 0;
/** @type {string[]} */
const qnames = [];
/** @type {number[]} qtype 与 qnames 同序（1=A · 28=AAAA）——用于核对"是不是 A+AAAA 两查" */
const qtypes = [];

/** 解析 DNS 查询：取出 ID + question 原文 + QTYPE（够用即可，不做全量 RR 解析）。 */
function parseQuery(buf) {
  if (buf.length < 12) return null;
  const id = buf.readUInt16BE(0);
  const qdcount = buf.readUInt16BE(4);
  if (qdcount < 1) return null;
  let off = 12;
  const labels = [];
  while (off < buf.length) {
    const len = buf[off];
    if (len === 0) {
      off += 1;
      break;
    }
    if ((len & 0xc0) !== 0) return null; // 查询里不应出现压缩指针
    labels.push(buf.toString('ascii', off + 1, off + 1 + len));
    off += 1 + len;
  }
  if (off + 4 > buf.length) return null;
  const qtype = buf.readUInt16BE(off);
  const qclass = buf.readUInt16BE(off + 2);
  const questionEnd = off + 4;
  return { id, labels, qtype, qclass, question: buf.subarray(12, questionEnd) };
}

/** 构响应：回显 question，按 mode 决定 ANSWER。 */
function buildResponse(q) {
  const question = q.question;
  const header = Buffer.alloc(12);
  q.id && header.writeUInt16BE(q.id, 0);
  // flags: QR=1 · Opcode=0 · AA=0 · TC=0 · RD=1 · RA=1 · RCODE
  const rcode = mode === 'nxdomain' ? 3 : 0;
  header.writeUInt16BE(0x8180 | rcode, 2);
  header.writeUInt16BE(1, 4); // QDCOUNT
  const wantA = q.qtype === 1 || q.qtype === 255; // A 或 ANY
  const answer = wantA && rcode === 0;
  header.writeUInt16BE(answer ? 1 : 0, 6); // ANCOUNT
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);
  const parts = [header, question];
  if (answer) {
    const rr = Buffer.alloc(16);
    rr.writeUInt16BE(0xc00c, 0); // NAME = 指向 question 的压缩指针
    rr.writeUInt16BE(1, 2); // TYPE = A
    rr.writeUInt16BE(1, 4); // CLASS = IN
    rr.writeUInt32BE(0, 6); // TTL = 0（不缓存，保证每轮都真查）
    rr.writeUInt16BE(4, 10); // RDLENGTH
    const octets = ip.split('.').map((n) => Number(n) & 0xff);
    for (let i = 0; i < 4; i++) rr[12 + i] = octets[i] ?? 0;
    parts.push(rr);
  }
  return Buffer.concat(parts);
}

function persist() {
  try {
    writeFileSync(
      STATS,
      JSON.stringify({ mode, ip, queries, qnames: qnames.slice(-50), qtypes: qtypes.slice(-50) }, null, 2),
    );
  } catch {
    /* 落盘失败不阻断请求 */
  }
}

function handleBody(buf, send) {
  const q = parseQuery(buf);
  if (!q) {
    send(400, null);
    return;
  }
  queries++;
  const name = q.labels.join('.');
  if (qnames.length < 200) {
    qnames.push(name);
    qtypes.push(q.qtype);
  }
  persist();
  // qtype 28 = AAAA；`a` 模式下回空 NOERROR（让客户端只用 A 记录）
  send(200, buildResponse(q));
}

const server = createSecureServer(
  { key: readFileSync(KEY), cert: readFileSync(CERT), allowHTTP1: true },
  (req, res) => {
    const url = new URL(req.url, 'https://127.0.0.1');
    const reply = (status, code, body, ctype) => {
      const headers = { 'content-type': ctype || 'text/plain; charset=utf-8' };
      if (res.writeHead) {
        res.writeHead(status, headers);
        res.end(body);
      } else {
        res.stream.respond({ ':status': status, ...headers });
        res.stream.end(body);
      }
    };
    // 仅探测用：切模式（不重启进程）
    if (url.pathname === '/control') {
      const m = url.searchParams.get('mode') || 'a';
      const v = url.searchParams.get('ip');
      mode = m;
      if (v) ip = v;
      if (m === 'unreachable') ip = '203.0.113.1';
      persist();
      reply(200, 0, JSON.stringify({ ok: true, mode, ip }));
      return;
    }
    if (url.pathname === '/stats') {
      reply(200, 0, JSON.stringify({ mode, ip, queries, qnames }), 'application/json');
      return;
    }
    if (url.pathname !== '/dns-query') {
      reply(404, 0, 'not found');
      return;
    }
    // RFC 8484：GET ?dns=<base64url> 或 POST body=application/dns-message
    if (req.method === 'GET') {
      const dns = url.searchParams.get('dns');
      if (!dns) {
        reply(400, 0, 'missing dns param');
        return;
      }
      const b64 = dns.replace(/-/g, '+').replace(/_/g, '/');
      handleBody(Buffer.from(b64, 'base64'), (st, body) =>
        reply(st, 0, body, 'application/dns-message'),
      );
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () =>
      handleBody(Buffer.concat(chunks), (st, body) =>
        reply(st, 0, body, 'application/dns-message'),
      ),
    );
  },
);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`PROTEUS_DOH_SERVER_READY port=${PORT} mode=${mode} ip=${ip} stats=${STATS}`);
  persist();
});

/**
 * 同进程的**明文目标服务端**（`DOH_TARGET_PORT`，缺省 18080）。
 * 【为什么合在一个进程里】T1 要请求 `http://<假域名>:18080/`（经 DoH 解析到 127.0.0.1 后
 *   必须有一个**真的在监听**的目标，否则"请求成功"无从判定）。一个进程两个监听口 ⇒
 *   判据脚本只需起一次、等一次就绪信号（少一个装置状态，少一种假红来源）。
 */
const target = createHttpServer((req, res) => {
  if (req.url === '/stats') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ mode, ip, queries, qnames, qtypes }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('PROTEUS_RPORT_OK');
});
target.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`PROTEUS_DOH_TARGET_READY port=${HTTP_PORT}`);
});
