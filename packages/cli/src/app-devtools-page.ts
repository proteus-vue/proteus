// packages/cli/src/app-devtools-page.ts —— ★★★App DevTools 面板（浏览器可视化，2026-10-08 · 决策 #672）
//
// 【为什么有它（用户：「dev server 只有简单提示感觉有点儿浪费，能真正把 dev server 可视化做起来、
//   同时承担 App DevTools 的体验」）】dev server 此前对浏览器的响应只有一行纯文本
//   （`proteus dev server: /health /version /bundle`）。本模块把它升级为**自包含的单页面板**：
//   · 设备在线状态（宿主心跳 `/ping`）· 当前屏名 · bundle 版本/体积/最近重建耗时与原因（`/events` SSE 实时）
//   · 端点速查与"复制 dev URL"。零依赖、零构建（内联 HTML/CSS/JS，深色，与 `ui.ts` 的终端观感一致）。
//
// 【诚实边界】面板数据来自 **dev server 侧**（重建事件 + 宿主心跳）——不是完整的 App 内省
//   （没有节点的 box/样式树 / 事件派发 trace / 渲染耗时逐帧）。那些属"真·App DevTools"的后续批次；
//   本版先把"服务器可视化 + 设备/构建实时状态"这层做扎实（对应浏览器 DevTools 的 Network/Console 层）。
export interface DevtoolsPageInfo {
  platform: string
  projectName: string
  projectRoot: string
  /** dev server 基址（局域网，宿主用） */
  url: string
}

const esc = (s: string): string => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string))

/** 渲染 DevTools 单页（内联一切；`__PROTEUS_UI__` 注入项目信息，其余走 SSE 实时更新）。 */
export function renderDevtoolsPage(info: DevtoolsPageInfo): string {
  const meta = JSON.stringify({ platform: info.platform, projectName: info.projectName, url: info.url })
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Proteus DevTools · ${esc(info.projectName)}</title>
<style>
  :root{--bg:#0e1016;--surface:#171a23;--surface2:#1e2230;--line:#2a2f3d;--ink:#e7e9ef;--dim:#8b93a7;
        --brand:#5b7cff;--ok:#35d07f;--warn:#f5b544;--err:#ff5c5c;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC",sans-serif}
  header{display:flex;align-items:center;gap:12px;padding:16px 22px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
  .logo{font-weight:700;font-size:16px;letter-spacing:.2px}
  .logo b{color:var(--brand)}
  .proj{color:var(--dim);font-size:13px}
  .grow{flex:1}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 4px rgba(53,208,127,.16);display:inline-block;margin-right:6px;vertical-align:middle}
  .dot.off{background:var(--err);box-shadow:0 0 0 4px rgba(255,92,92,.16)}
  .pill{padding:3px 10px;border:1px solid var(--line);border-radius:999px;font-size:12px;color:var(--dim)}
  main{padding:22px;max-width:960px;margin:0 auto}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px}
  .card .k{color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px}
  .card .v{font-size:22px;font-weight:650;font-variant-numeric:tabular-nums}
  .card .v small{font-size:13px;color:var(--dim);font-weight:400;margin-left:4px}
  h2{font-size:13px;color:var(--dim);text-transform:uppercase;letter-spacing:.7px;margin:26px 0 12px}
  .tl{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .row{display:grid;grid-template-columns:64px 1fr auto;gap:12px;align-items:center;padding:11px 16px;border-top:1px solid var(--line);font-size:13px}
  .row:first-child{border-top:0}
  .row .ver{font-family:var(--mono);color:var(--brand);font-weight:600}
  .row .why{color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .row .meta{color:var(--dim);font-family:var(--mono);font-size:12px;white-space:nowrap}
  .row.new{animation:flash 1.4s ease-out}
  @keyframes flash{from{background:rgba(91,124,255,.22)}to{background:transparent}}
  .empty{color:var(--dim);padding:18px 16px;font-size:13px}
  .eps{display:flex;flex-wrap:wrap;gap:10px}
  .ep{font-family:var(--mono);font-size:12px;color:var(--dim);border:1px solid var(--line);border-radius:8px;padding:6px 10px}
  .ep b{color:var(--ink)}
  a{color:var(--brand);text-decoration:none}
  .host{display:flex;align-items:center;gap:10px}
  .screen{font-family:var(--mono);color:var(--ink)}
  footer{color:var(--dim);font-size:12px;text-align:center;padding:26px}
</style></head>
<body>
<header>
  <div class="logo">◈ <b>Proteus</b> DevTools</div>
  <span class="proj">${esc(info.projectName)} · ${esc(info.platform)}</span>
  <div class="grow"></div>
  <span class="pill" id="host-pill"><span class="dot off" id="host-dot"></span><span id="host-txt">设备离线</span></span>
</header>
<main>
  <div class="grid">
    <div class="card"><div class="k">Bundle 版本</div><div class="v" id="c-ver">—</div></div>
    <div class="card"><div class="k">Bundle 体积</div><div class="v" id="c-size">—<small>KB</small></div></div>
    <div class="card"><div class="k">最近重建</div><div class="v" id="c-ms">—<small>ms</small></div></div>
    <div class="card"><div class="k">当前屏</div><div class="v host"><span class="screen" id="c-screen">—</span></div></div>
  </div>

  <h2>重建时间线（实时）</h2>
  <div class="tl" id="tl"><div class="empty">等待事件…改一次源码即出现。</div></div>

  <h2>端点</h2>
  <div class="eps">
    <span class="ep"><b>GET /</b> 本面板</span>
    <span class="ep"><b>GET /version</b> bundle 版本号</span>
    <span class="ep"><b>GET /bundle</b> bundle-superapp.js</span>
    <span class="ep"><b>GET /health</b> 探活</span>
    <span class="ep"><b>GET /events</b> SSE 事件流</span>
    <span class="ep"><b>GET /ping</b> 宿主心跳</span>
  </div>
</main>
<footer>Proteus DevTools · dev server <span style="font-family:var(--mono)">${esc(info.url)}</span> · 数据来自 dev server（重建事件 + 宿主心跳）</footer>
<script>
  const META = ${meta};
  const $ = (id) => document.getElementById(id);
  const fmtTime = (t) => new Date(t).toLocaleTimeString('en-GB', { hour12: false });
  const tl = $('tl');
  const rows = [];
  function addRow(e, isNew) {
    const r = document.createElement('div');
    r.className = 'row' + (isNew ? ' new' : '');
    r.innerHTML = '<span class="ver">v' + e.version + '</span>'
      + '<span class="why">' + (e.reason || '') + '</span>'
      + '<span class="meta">' + (e.bytes ? Math.round(e.bytes / 1024) + ' KB · ' : '') + (e.ms || 0) + 'ms · ' + fmtTime(e.time) + '</span>';
    return r;
  }
  function setSnapshot(s) {
    $('c-ver').textContent = 'v' + (s.version ?? 0);
    if (s.bytes) $('c-size').innerHTML = Math.round(s.bytes / 1024) + '<small>KB</small>';
    if (s.lastMs != null) $('c-ms').innerHTML = s.lastMs + '<small>ms</small>';
    tl.innerHTML = '';
    const evs = (s.events || []).slice().reverse();
    if (!evs.length) { tl.innerHTML = '<div class="empty">等待事件…改一次源码即出现。</div>'; }
    else evs.forEach((e, i) => tl.appendChild(addRow(e, false)));
    applyHost(s.host);
  }
  function applyHost(h) {
    window.__lastHost = h;
    const on = h && (Date.now() - h.time) < 6000;
    $('host-dot').className = 'dot' + (on ? '' : ' off');
    $('host-txt').textContent = on ? '设备在线' : '设备离线';
    $('c-screen').textContent = (on && h.screen) ? h.screen : '—';
  }
  function pushRebuild(e) {
    if (tl.querySelector('.empty')) tl.innerHTML = '';
    tl.insertBefore(addRow(e, true), tl.firstChild);
    while (tl.children.length > 40) tl.removeChild(tl.lastChild);
    $('c-ver').textContent = 'v' + e.version;
    $('c-size').innerHTML = Math.round(e.bytes / 1024) + '<small>KB</small>';
    $('c-ms').innerHTML = e.ms + '<small>ms</small>';
  }
  const es = new EventSource('/events');
  es.onmessage = (m) => {
    let d; try { d = JSON.parse(m.data); } catch { return; }
    if (d.type === 'snapshot') setSnapshot(d);
    else if (d.type === 'rebuild') pushRebuild(d);
    else if (d.type === 'host') applyHost(d);
  };
  es.onerror = () => { /* 浏览器自动重连 */ };
  setInterval(() => applyHost(window.__lastHost), 2000);   // 心跳超时 ⇒ 自动转"离线"
</script>
</body></html>`
}
