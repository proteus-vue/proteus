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
  h2{font-size:13px;color:var(--dim);text-transform:uppercase;letter-spacing:.7px;margin:26px 0 12px;display:flex;align-items:center;gap:10px}
  .flt{display:inline-flex;gap:2px;text-transform:none;letter-spacing:0;font-size:11px}
  .flt b{cursor:pointer;padding:2px 8px;border:1px solid var(--line);border-radius:6px;color:var(--dim);font-weight:500}
  .flt b.on{background:var(--brand);border-color:var(--brand);color:#fff}
  .ch{font-weight:600;padding:0 4px;border-radius:4px;font-size:10px}
  .ch-native{color:#c9a227;background:rgba(201,162,39,.13)}
  .ch-project{color:#5b7cff;background:rgba(91,124,255,.15)}
  .tl{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .row{display:grid;grid-template-columns:64px 1fr auto;gap:12px;align-items:center;padding:11px 16px;border-top:1px solid var(--line);font-size:13px}
  .row:first-child{border-top:0}
  .row .ver{font-family:var(--mono);color:var(--brand);font-weight:600}
  .row .why{color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .row .meta{color:var(--dim);font-family:var(--mono);font-size:12px;white-space:nowrap}
  .row.new{animation:flash 1.4s ease-out}
  @keyframes flash{from{background:rgba(91,124,255,.22)}to{background:transparent}}
  .empty{color:var(--dim);padding:18px 16px;font-size:13px}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
  @media(max-width:760px){.two{grid-template-columns:1fr}}
  .panel{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;max-height:320px;overflow-y:auto}
  .nrow{display:grid;grid-template-columns:52px 1fr auto auto;gap:10px;align-items:center;padding:8px 12px;border-top:1px solid var(--line);font-size:12px;font-family:var(--mono)}
  .nrow:first-child{border-top:0}
  .nrow .m{color:var(--dim);font-weight:600}
  .nrow .p{color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .nrow .st{font-weight:600}
  .st.ok{color:var(--ok)}.st.warn{color:var(--warn)}.st.err{color:var(--err)}
  .nrow .ms{color:var(--dim);text-align:right;min-width:52px}
  .nrow.new{animation:flash 1.2s ease-out}
  .crow{padding:7px 12px;border-top:1px solid var(--line);font-size:12px;font-family:var(--mono);display:grid;grid-template-columns:60px 1fr;gap:10px;white-space:pre-wrap;word-break:break-word}
  .crow:first-child{border-top:0}
  .crow .t{color:var(--dim)}
  .crow.lv-warn{background:rgba(245,181,68,.08)}.crow.lv-warn .x{color:var(--warn)}
  .crow.lv-error{background:rgba(255,92,92,.10)}.crow.lv-error .x{color:var(--err)}
  .crow.lv-info .x{color:var(--brand)}
  .crow.new{animation:flash 1.2s ease-out}
  .devbar{display:flex;flex-wrap:wrap;gap:8px;padding:10px 22px;border-bottom:1px solid var(--line);background:var(--surface);font-size:12px}
  .devbar:empty{display:none}
  .chip{border:1px solid var(--line);border-radius:8px;padding:4px 9px;color:var(--dim)}
  .chip b{color:var(--ink);font-weight:600}
  .trow{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:baseline;padding:5px 12px;border-top:1px solid var(--line);font-size:12px;font-family:var(--mono)}
  .trow:first-child{border-top:0}
  .trow .tag{color:var(--brand);font-weight:600}
  .trow .tx{color:var(--ink)}
  .trow .st{color:var(--dim);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:52%}
  .trow.sel{background:rgba(91,124,255,.18);outline:1px solid rgba(91,124,255,.5)}
  .trow:hover{background:rgba(255,255,255,.03)}
  .box{margin-top:10px;border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .box .bh{padding:8px 12px;background:var(--surface2);font-size:12px;font-family:var(--mono);color:var(--ink)}
  .bm{padding:10px 12px;display:grid;grid-template-columns:repeat(2,1fr);gap:6px 16px;font-size:12px;font-family:var(--mono)}
  .bm .k{color:var(--dim)}
  .bm .v{color:var(--ink);text-align:right}
  .mbox{position:relative;margin:12px;border:1px dashed var(--brand);background:rgba(91,124,255,.06);border-radius:4px;min-height:24px}
  .mbox .lbl{position:absolute;top:-9px;left:6px;background:var(--bg);padding:0 4px;font-size:10px;color:var(--brand)}
  .envrow{display:flex;justify-content:space-between;gap:12px;padding:6px 12px;border-top:1px solid var(--line);font-size:12px;font-family:var(--mono)}
  .envrow:first-child{border-top:0}
  .envrow .k{color:var(--dim);white-space:nowrap}
  .envrow .v{color:var(--ink);text-align:right;overflow-wrap:anywhere}
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
    <div class="card"><div class="k">重建耗时</div><div class="v" id="c-ms">—<small>ms</small></div></div>
    <div class="card"><div class="k">当前屏</div><div class="v host"><span class="screen" id="c-screen">—</span></div></div>
    <div class="card"><div class="k">渲染耗时</div><div class="v" id="c-render">—<small>ms</small></div></div>
    <div class="card"><div class="k">逐帧耗时</div><div class="v" id="c-frame">—<small>ms</small></div></div>
    <div class="card"><div class="k">重排计数</div><div class="v" id="c-relayout">—</div></div>
    <div class="card"><div class="k">patch 总数</div><div class="v" id="c-patches">—</div></div>
  </div>

  <h2>重建时间线（实时）</h2>
  <div class="tl" id="tl"><div class="empty">等待事件…改一次源码即出现。</div></div>

  <div class="two">
    <div>
      <h2>Elements（当前屏节点树 · 点节点看盒模型）</h2>
      <div class="panel" id="tree"><div class="empty">暂无节点树…宿主渲染后上报。</div></div>
      <div class="box" id="box" style="display:none"></div>
    </div>
    <div>
      <h2>Console（设备日志）<span class="flt" data-flt="con"><b class="on" data-ch="all">全部</b><b data-ch="project">项目</b><b data-ch="native">原生</b></span></h2>
      <div class="panel con" id="con"><div class="empty">暂无日志…在页面里 <b>console.log</b> 或改源码即出现。</div></div>
    </div>
  </div>

  <div class="two">
    <div>
      <h2>Events（手势派发 trace）</h2>
      <div class="panel con" id="events"><div class="empty">暂无手势…在设备上点一下屏幕即出现。</div></div>
    </div>
    <div>
      <h2>Network（通道）<span class="flt" data-flt="net"><b class="on" data-ch="all">全部</b><b data-ch="native">原生</b><b data-ch="project">项目</b></span></h2>
      <div class="panel" id="net"><div class="empty">暂无请求。</div></div>
    </div>
  </div>

  <h2>设备环境（含内核/引擎）</h2>
  <div class="panel" id="env"><div class="empty">等待宿主心跳…</div></div>

  <h2>端点</h2>
  <div class="eps">
    <span class="ep"><b>GET /</b> 本面板</span>
    <span class="ep"><b>GET /version</b> bundle 版本号</span>
    <span class="ep"><b>GET /bundle</b> bundle-superapp.js</span>
    <span class="ep"><b>GET /health</b> 探活</span>
    <span class="ep"><b>GET /events</b> SSE 事件流</span>
    <span class="ep"><b>GET /ping</b> 心跳 + 设备环境 + 性能</span>
    <span class="ep"><b>POST /tree</b> 元素内省（含内核 rect）</span>
    <span class="ep"><b>GET /inspect</b> 被点元素</span>
    <span class="ep"><b>GET /trace</b> 事件 trace</span>
    <span class="ep"><b>GET /log</b> 宿主日志</span>
  </div>
</main>
<footer>Proteus DevTools · dev server <span style="font-family:var(--mono)">${esc(info.url)}</span> · 数据来自 dev server（重建 / 网络 / 宿主心跳 + 设备环境 + 性能 / 元素树 + 盒模型 / 事件 trace / 日志）</footer>
<script>
  const META = ${meta};
  const $ = (id) => document.getElementById(id);
  const fmtTime = (t) => new Date(t).toLocaleTimeString('en-GB', { hour12: false });
  const escapeHtml = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const tl = $('tl');
  const netEl = $('net');
  const conEl = $('con');
  const treeEl = $('tree');
  const envEl = $('env');
  const boxEl = $('box');
  const eventsEl = $('events');
  let treeData = null;   // 最近一次元素树（含 rect）
  let selId = null;      // 当前选中节点 id
  const rows = [];
  function addRow(e, isNew) {
    const r = document.createElement('div');
    r.className = 'row' + (isNew ? ' new' : '');
    r.innerHTML = '<span class="ver">v' + e.version + '</span>'
      + '<span class="why">' + (e.reason || '') + '</span>'
      + '<span class="meta">' + (e.bytes ? Math.round(e.bytes / 1024) + ' KB · ' : '') + (e.ms || 0) + 'ms · ' + fmtTime(e.time) + '</span>';
    return r;
  }
  const stCls = (s) => s >= 500 ? 'err' : s >= 400 ? 'warn' : 'ok';
  const chTag = (ch) => '<span class="ch ch-' + (ch === 'project' ? 'project' : 'native') + '">' + (ch === 'project' ? '项目' : '原生') + '</span>';
  function addNet(e, isNew) {
    const r = document.createElement('div');
    r.className = 'nrow' + (isNew ? ' new' : '');
    r.innerHTML = '<span class="m">' + chTag(e.channel) + ' ' + e.method + '</span>'
      + '<span class="p">' + escapeHtml(e.path || '') + '</span>'
      + '<span class="st ' + stCls(e.status) + '">' + e.status + '</span>'
      + '<span class="ms">' + (e.bytes ? Math.round(e.bytes / 1024) + 'KB · ' : '') + e.ms + 'ms</span>';
    return r;
  }
  function addCon(e, isNew) {
    const lv = ['log','info','warn','error'].includes(e.level) ? e.level : 'log';
    const r = document.createElement('div');
    r.className = 'crow lv-' + lv + (isNew ? ' new' : '');
    r.innerHTML = '<span class="t">' + fmtTime(e.time) + '</span><span class="x">' + chTag(e.channel) + ' ' + escapeHtml(e.text || '') + '</span>';
    return r;
  }
  // 渠道过滤（决策 #679）：全部 / 项目(project) / 原生(native)
  const filt = { net: 'all', con: 'all' };
  let lastNet = [], lastCon = [];
  const passF = (ch, f) => f === 'all' || ch === f;
  function fillNet(list) {
    lastNet = list || [];
    const shown = lastNet.filter((e) => passF(e.channel, filt.net));
    netEl.innerHTML = '';
    if (!shown.length) { netEl.innerHTML = '<div class="empty">暂无请求' + (filt.net === 'all' ? '' : '（该通道）') + '。</div>'; return; }
    shown.slice().reverse().forEach((e) => netEl.appendChild(addNet(e, false)));
  }
  function fillCon(list) {
    lastCon = list || [];
    const shown = lastCon.filter((e) => passF(e.channel, filt.con));
    conEl.innerHTML = '';
    if (!shown.length) { conEl.innerHTML = '<div class="empty">暂无日志' + (filt.con === 'all' ? '…在页面里 <b>console.log</b> 或改源码即出现。' : '（该通道）。') + '</div>'; return; }
    shown.slice().reverse().forEach((e) => conEl.appendChild(addCon(e, false)));
  }
  // 过滤按钮接线
  document.querySelectorAll('.flt').forEach((box) => {
    const which = box.dataset.flt;   // 'net' | 'con'
    box.addEventListener('click', (ev) => {
      const b = ev.target.closest('b'); if (!b) return;
      filt[which] = b.dataset.ch;
      box.querySelectorAll('b').forEach((x) => x.classList.toggle('on', x === b));
      if (which === 'net') fillNet(lastNet); else fillCon(lastCon);
    });
  });
  // ── 元素树（决策 #674/#675）：实例化节点树（含内核 rect）+ 点选高亮 + 盒模型 ──
  function renderTree(t) {
    treeData = t || { nodes: [] };
    treeEl.innerHTML = '';
    const nodes = treeData.nodes || [];
    if (!nodes.length) { treeEl.innerHTML = '<div class="empty">暂无节点树…宿主渲染后上报。</div>'; boxEl.style.display = 'none'; return; }
    const kids = {};
    nodes.forEach((n) => { (kids[n.parentId ?? 'root'] = kids[n.parentId ?? 'root'] || []).push(n); });
    const rowOf = (n, depth) => {
      const r = document.createElement('div');
      r.className = 'trow' + (n.id === selId ? ' sel' : '');
      r.dataset.id = n.id;
      const keyStyles = ['width', 'widthRatio', 'height', 'minHeight', 'backgroundColor', 'color', 'fontSize', 'fontWeight', 'display', 'flexDirection', 'justifyContent', 'alignItems', 'padding', 'margin', 'position', 'top', 'left', 'borderRadius', 'textAlign', 'opacity']
        .filter((k) => n[k] !== undefined)
        .map((k) => k + ':' + (typeof n[k] === 'object' ? JSON.stringify(n[k]) : n[k]))
        .join('; ');
      const rc = n.rect ? Math.round(n.rect.x) + ',' + Math.round(n.rect.y) + ' ' + Math.round(n.rect.width) + '×' + Math.round(n.rect.height) : '';
      r.innerHTML = '<span style="padding-left:' + (depth * 14) + 'px"><span class="tag">' + escapeHtml(n.tag || n.semantic || '?') + '</span>'
        + (n.text ? ' <span class="tx">' + escapeHtml(String(n.text).slice(0, 34)) + '</span>' : '') + '</span>'
        + '<span class="st" title="' + escapeHtml(keyStyles) + '">' + escapeHtml(rc || keyStyles) + '</span>';
      r.addEventListener('click', () => selectNode(n.id));
      return r;
    };
    const walk = (parent, depth) => { for (const n of (kids[parent] || [])) { treeEl.appendChild(rowOf(n, depth)); walk(n.id, depth + 1); } };
    walk('root', 0);
    walk(undefined, 0);
    if (selId != null) renderBox(findNode(selId));
  }
  function findNode(id) {
    const nodes = (treeData && treeData.nodes) || [];
    return nodes.find((n) => n.id === id) || null;
  }
  function selectNode(id) { selId = id; renderBox(findNode(id)); renderTree(treeData); }
  // 盒模型：内核 rect（x/y/w/h）+ 关键样式
  function renderBox(n) {
    if (!n) { boxEl.style.display = 'none'; return; }
    const r = n.rect || {};
    const rc = n.rect ? 'x=' + Math.round(r.x) + '  y=' + Math.round(r.y) + '  ' + Math.round(r.width) + '×' + Math.round(r.height) : '（无内核几何）';
    const styles = Object.keys(n).filter((k) => k !== 'id' && k !== 'parentId' && k !== 'tag' && k !== 'text' && k !== 'rect' && !Array.isArray(n[k]))
      .map((k) => '<div class="k">' + escapeHtml(k) + '</div><div class="v">' + escapeHtml(typeof n[k] === 'object' ? JSON.stringify(n[k]) : String(n[k])) + '</div>').join('');
    boxEl.style.display = 'block';
    boxEl.innerHTML = '<div class="bh">#' + n.id + ' &lt;' + escapeHtml(n.tag || n.semantic || '?') + '&gt;' + (n.text ? ' “' + escapeHtml(String(n.text).slice(0, 40)) + '”' : '') + '</div>'
      + '<div class="mbox"' + (r.width ? ' style="width:' + Math.max(4, Math.min(560, r.width)) + 'px;height:' + Math.max(4, Math.min(200, r.height)) + 'px"' : '') + '><span class="lbl">内核 rect</span></div>'
      + '<div class="bm"><div class="k">rect</div><div class="v">' + escapeHtml(rc) + '</div>' + styles + '</div>';
  }
  // ── 事件 trace（决策 #675）──
  function addEvent(e, isNew) {
    const r = document.createElement('div');
    r.className = 'crow lv-info' + (isNew ? ' new' : '');
    const chain = (e.chain || []).join(' → ');
    r.innerHTML = '<span class="t">' + fmtTime(e.time) + '</span><span class="x">'
      + escapeHtml(e.gesture) + '  target=#' + e.id + (chain ? '  chain[' + escapeHtml(chain) + ']' : '')
      + '  ' + (e.handled ? '✅handled' : '∅') + ((e.fired || []).length ? '  fired[' + (e.fired || []).join(',') + ']' : '') + '</span>';
    return r;
  }
  function fillEvents(list) {
    eventsEl.innerHTML = '';
    if (!list.length) { eventsEl.innerHTML = '<div class="empty">暂无手势…在设备上点一下屏幕即出现。</div>'; return; }
    list.slice().reverse().forEach((e) => eventsEl.appendChild(addEvent(e, false)));
  }
  function pushEvent(e) {
    if (eventsEl.querySelector('.empty')) eventsEl.innerHTML = '';
    eventsEl.insertBefore(addEvent(e, true), eventsEl.firstChild);
    while (eventsEl.children.length > 80) eventsEl.removeChild(eventsEl.lastChild);
    // 点选联动：手势命中该节点即高亮
    if (e.id) selectNode(e.id);
  }
  // ── 设备环境（决策 #674/#676）：分组展示（设备 / 屏幕 / 内核·引擎） ──
  function renderEnv(env) {
    if (!env || !Object.keys(env).length) { envEl.innerHTML = '<div class="empty">等待宿主心跳…</div>'; return; }
    const groups = [
      { t: '设备', keys: ['platform', 'model', 'brand', 'manufacturer', 'androidRelease', 'sdkInt', 'abi', 'locale', 'theme'] },
      { t: '屏幕', keys: ['screen', 'screenPx', 'density'] },
      { t: '内核 / 引擎', keys: ['layoutCore', 'jsEngine', 'hostBuild', 'appVersion'] },
    ];
    const known = new Set(groups.flatMap((g) => g.keys));
    const extra = Object.keys(env).filter((k) => !known.has(k));
    if (extra.length) groups.push({ t: '其它', keys: extra });
    envEl.innerHTML = '';
    for (const g of groups) {
      const rows = g.keys.filter((k) => env[k] !== undefined);
      if (!rows.length) continue;
      const h = document.createElement('div'); h.className = 'envrow'; h.style.color = 'var(--dim)'; h.style.flex = 'none';
      h.innerHTML = '<span class="k" style="color:var(--brand)">' + g.t + '</span>';
      envEl.appendChild(h);
      for (const k of rows) {
        const row = document.createElement('div'); row.className = 'envrow';
        row.innerHTML = '<span class="k">' + escapeHtml(k) + '</span><span class="v">' + escapeHtml(String(env[k])) + '</span>';
        envEl.appendChild(row);
      }
    }
  }
  function setSnapshot(s) {
    $('c-ver').textContent = 'v' + (s.version ?? 0);
    if (s.bytes) $('c-size').innerHTML = Math.round(s.bytes / 1024) + '<small>KB</small>';
    if (s.lastMs != null) $('c-ms').innerHTML = s.lastMs + '<small>ms</small>';
    tl.innerHTML = '';
    const evs = (s.events || []).slice().reverse();
    if (!evs.length) { tl.innerHTML = '<div class="empty">等待事件…改一次源码即出现。</div>'; }
    else evs.forEach((e, i) => tl.appendChild(addRow(e, false)));
    fillNet(s.net || []);
    fillCon(s.console || []);
    renderTree(s.tree);
    fillEvents(s.trace || []);
    if (s.inspect && s.inspect.id) { selId = s.inspect.id; if (treeData) renderTree(treeData); }
    renderEnv(s.host && s.host.env);
    applyHost(s.host);
  }
  function applyPerf(p) {
    if (!p) return;
    if (p.renderMs != null) $('c-render').innerHTML = p.renderMs + '<small>ms</small>';
    if (p.frameMs != null) $('c-frame').innerHTML = p.frameMs + '<small>ms</small>';
    if (p.relayout != null) $('c-relayout').textContent = p.relayout;
    if (p.patches != null) $('c-patches').textContent = p.patches;
  }
  function applyHost(h) {
    window.__lastHost = h;
    const on = h && (Date.now() - h.time) < 6000;
    $('host-dot').className = 'dot' + (on ? '' : ' off');
    $('host-txt').textContent = on ? '设备在线' : '设备离线';
    $('c-screen').textContent = (on && h.screen) ? h.screen : '—';
    if (h && h.env) renderEnv(h.env);
    if (h && h.perf) applyPerf(h.perf);
  }
  function pushRebuild(e) {
    if (tl.querySelector('.empty')) tl.innerHTML = '';
    tl.insertBefore(addRow(e, true), tl.firstChild);
    while (tl.children.length > 40) tl.removeChild(tl.lastChild);
    $('c-ver').textContent = 'v' + e.version;
    $('c-size').innerHTML = Math.round(e.bytes / 1024) + '<small>KB</small>';
    $('c-ms').innerHTML = e.ms + '<small>ms</small>';
  }
  function pushNet(e) {
    lastNet.push(e); if (lastNet.length > 200) lastNet.shift();
    if (!passF(e.channel, filt.net)) return;   // 被过滤掉 ⇒ 不入当前视图（切回"全部"时会补上）
    if (netEl.querySelector('.empty')) netEl.innerHTML = '';
    netEl.insertBefore(addNet(e, true), netEl.firstChild);
    while (netEl.children.length > 80) netEl.removeChild(netEl.lastChild);
  }
  function pushCon(e) {
    lastCon.push(e); if (lastCon.length > 400) lastCon.shift();
    if (!passF(e.channel, filt.con)) return;
    if (conEl.querySelector('.empty')) conEl.innerHTML = '';
    conEl.insertBefore(addCon(e, true), conEl.firstChild);
    while (conEl.children.length > 200) conEl.removeChild(conEl.lastChild);
  }
  const es = new EventSource('/events');
  es.onmessage = (m) => {
    let d; try { d = JSON.parse(m.data); } catch { return; }
    if (d.type === 'snapshot') setSnapshot(d);
    else if (d.type === 'rebuild') pushRebuild(d);
    else if (d.type === 'host') applyHost(d);
    else if (d.type === 'net') pushNet(d);
    else if (d.type === 'console') pushCon(d);
    else if (d.type === 'tree') renderTree(d.tree);
    else if (d.type === 'trace') pushEvent(d);
    else if (d.type === 'inspect') { selId = d.id; if (treeData) renderTree(treeData); }
  };
  es.onerror = () => { /* 浏览器自动重连 */ };
  setInterval(() => applyHost(window.__lastHost), 2000);   // 心跳超时 ⇒ 自动转"离线"
</script>
</body></html>`
}
