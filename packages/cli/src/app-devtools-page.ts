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
  :root{
    /* 设计令牌（8px 间距尺度 / 统一圆角 / 字号尺度 / 语义色）——"大厂生产"观感的基础 */
    --bg:#0a0b0f; --surface:#12141b; --surface-2:#181b24; --surface-3:#1e222c;
    --line:#232734; --line-2:#2c3140;
    --ink:#eef1f7; --ink-2:#b6bdcc; --dim:#727c90; --faint:#4b5464;
    --brand:#6b7cff; --brand-soft:rgba(107,124,255,.14);
    --ok:#3ddc84; --ok-soft:rgba(61,220,132,.14);
    --warn:#f4b740; --warn-soft:rgba(244,183,64,.14);
    --err:#ff6262; --err-soft:rgba(255,98,98,.14);
    --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px;
    --r-sm:8px; --r:12px; --r-lg:16px;
    --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
    --sans:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    --sh:0 1px 2px rgba(0,0,0,.4),0 8px 24px -12px rgba(0,0,0,.6);
  }
  *{box-sizing:border-box}
  html{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  body{margin:0;background:radial-gradient(1200px 600px at 50% -200px,#141826 0%,var(--bg) 60%) no-repeat,var(--bg);
       color:var(--ink);font:13px/1.55 var(--sans)}
  ::-webkit-scrollbar{width:10px;height:10px}
  ::-webkit-scrollbar-thumb{background:#242936;border-radius:8px;border:2px solid transparent;background-clip:padding-box}
  ::-webkit-scrollbar-thumb:hover{background:#333a4a;background-clip:padding-box}

  /* ── 顶部应用栏 ── */
  header{display:flex;align-items:center;gap:var(--s3);padding:0 var(--s5);height:56px;
         border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20;
         background:rgba(10,11,15,.72);backdrop-filter:saturate(160%) blur(12px);-webkit-backdrop-filter:saturate(160%) blur(12px)}
  .brand{display:flex;align-items:center;gap:10px}
  .mark{width:26px;height:26px;border-radius:7px;display:grid;place-items:center;font-size:14px;color:#fff;
        background:linear-gradient(140deg,var(--brand),#8b5cf6);box-shadow:0 2px 8px -2px rgba(107,124,255,.6)}
  .btitle{font-weight:650;font-size:14px;letter-spacing:.1px}
  .btitle b{color:var(--brand);font-weight:750}
  .crumbs{display:flex;align-items:center;gap:var(--s2);color:var(--dim);font-size:12px;min-width:0}
  .crumbs .proj{color:var(--ink-2);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .crumbs .sep{color:var(--faint)}
  .crumbs .plat{font-family:var(--mono);color:var(--dim);text-transform:lowercase}
  .grow{flex:1}
  .pill{display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border:1px solid var(--line-2);
        border-radius:999px;font-size:12px;color:var(--ink-2);background:var(--surface);font-weight:500;white-space:nowrap;flex:none}
  .dot{width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px var(--ok-soft);flex:none}
  .dot.off{background:var(--err);box-shadow:0 0 0 3px var(--err-soft)}

  main{padding:var(--s5) var(--s5) var(--s6);max-width:1200px;margin:0 auto}
  .blk{margin-bottom:var(--s6)}
  /* 双栏区块（Elements｜Console · Events｜Network）——窄屏塌成单栏 */
  .two{display:grid;grid-template-columns:1fr 1fr;gap:var(--s5);align-items:start}
  @media(max-width:880px){.two{grid-template-columns:1fr}}

  /* ── 指标卡 ── */
  .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s4);margin-bottom:var(--s6)}
  @media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:520px){.grid{grid-template-columns:1fr}}
  @media(max-width:520px){header{padding:0 var(--s4);gap:var(--s2)} .crumbs .sep,.crumbs .plat{display:none} main{padding:var(--s4) var(--s4) var(--s6)}}
  .card{position:relative;background:linear-gradient(var(--surface-2),var(--surface));border:1px solid var(--line);
        border-radius:var(--r);padding:var(--s3) var(--s4) 14px;overflow:hidden;transition:border-color .15s,transform .15s}
  .card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--line-2)}
  .card[data-kind=build]::before{background:linear-gradient(var(--brand),#8b5cf6)}
  .card[data-kind=nav]::before{background:var(--ok)}
  .card[data-kind=perf]::before{background:var(--warn)}
  .card:hover{border-color:var(--line-2)}
  .card .k{color:var(--dim);font-size:11px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;margin:0 0 6px}
  .card .v{font-size:24px;line-height:1.15;font-weight:680;font-variant-numeric:tabular-nums;letter-spacing:-.4px}
  .card .v small{font-size:12px;color:var(--dim);font-weight:500;margin-left:3px;letter-spacing:0}
  .host{display:flex;align-items:center;gap:var(--s2)}
  .screen{font-family:var(--mono);font-size:18px;color:var(--brand);font-weight:600}

  /* ── 区块标题 ── */
  h2{display:flex;align-items:center;gap:10px;margin:0 0 var(--s3);font-size:12px;font-weight:650;
     letter-spacing:.5px;text-transform:uppercase;color:var(--ink-2)}
  h2::before{content:"";width:3px;height:13px;border-radius:2px;background:var(--brand);opacity:.85}
  h2 .flt{margin-left:auto}

  /* ── 分段控件（过滤）── */
  .flt{display:inline-flex;gap:2px;padding:2px;background:var(--surface-2);border:1px solid var(--line);border-radius:9px}
  .flt b{cursor:pointer;padding:3px 10px;border-radius:6px;color:var(--dim);font-weight:550;font-size:11px;
         letter-spacing:0;text-transform:none;transition:background .12s,color .12s;user-select:none}
  .flt b:hover{color:var(--ink-2)}
  .flt b.on{background:var(--brand);color:#fff;box-shadow:0 1px 4px -1px rgba(107,124,255,.6)}

  /* ── 通道标 ── */
  .ch{display:inline-block;font-weight:650;padding:1px 6px;border-radius:5px;font-size:10px;letter-spacing:.2px;vertical-align:middle}
  .ch-native{color:var(--warn);background:var(--warn-soft)}
  .ch-project{color:var(--brand);background:var(--brand-soft)}

  /* ── 通用面板（带"外框"观感）── */
  .panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);overflow:auto;max-height:340px}
  /* ★REPL 输入（决策 #701）：在设备上求值 */
  .repl{display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-bottom:none;border-radius:var(--r) var(--r) 0 0;padding:7px 10px}
  .repl-p{color:var(--brand2);font-weight:700;font-family:ui-monospace,Menlo,monospace}
  .repl input{flex:1;min-width:0;background:transparent;border:none;outline:none;color:var(--ink);font-size:12.5px;font-family:ui-monospace,Menlo,monospace}
  .repl input::placeholder{color:var(--faint)}
  /* REPL 紧邻的 Console 面板：上圆角去掉，与输入框连成一体 */
  .repl + .panel{border-radius:0 0 var(--r) var(--r)}
  .empty{display:flex;align-items:center;gap:10px;color:var(--dim);padding:var(--s5) var(--s4);font-size:12.5px}
  .empty::before{content:"○";color:var(--faint);font-size:15px}

  /* ── 重建时间线 ── */
  .tl{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}
  .row{display:grid;grid-template-columns:52px 1fr auto;gap:var(--s3);align-items:center;padding:11px var(--s4);border-top:1px solid var(--line);font-size:12.5px}
  .row:first-child{border-top:0}
  .row .ver{font-family:var(--mono);color:var(--brand);font-weight:650;font-size:12px}
  .row .why{color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .row .meta{color:var(--dim);font-family:var(--mono);font-size:11.5px;white-space:nowrap;text-align:right}

  /* ── Network ── */
  .nrow{display:grid;grid-template-columns:auto 1fr auto auto;gap:var(--s3);align-items:center;padding:9px var(--s3);
        border-top:1px solid var(--line);font-size:12px;font-family:var(--mono)}
  .nrow:first-child{border-top:0}
  .nrow .m{color:var(--ink-2);font-weight:600;white-space:nowrap}
  .nrow .p{color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.92}
  .nrow .st{font-weight:700;font-size:11.5px}
  .st.ok{color:var(--ok)} .st.warn{color:var(--warn)} .st.err{color:var(--err)}
  .nrow .ms{color:var(--dim);text-align:right;min-width:56px;font-size:11.5px}

  /* ── Console / Events ── */
  .crow{display:grid;grid-template-columns:62px 1fr;gap:var(--s3);padding:8px var(--s3);border-top:1px solid var(--line);
        font-size:12px;font-family:var(--mono);white-space:pre-wrap;word-break:break-word;line-height:1.5}
  .crow:first-child{border-top:0}
  .crow .t{color:var(--faint);font-size:11px}
  .crow .x{color:var(--ink-2)}
  .crow.lv-info .x{color:var(--brand)}
  .crow.lv-warn{background:var(--warn-soft)} .crow.lv-warn .x{color:var(--warn)}
  .crow.lv-error{background:var(--err-soft)} .crow.lv-error .x{color:var(--err)}

  .new{animation:flash 1.3s cubic-bezier(.2,.7,.3,1)}
  @keyframes flash{0%{background:var(--brand-soft)}100%{background:transparent}}

  /* ── Elements 树 + 盒模型 ── */
  .trow{display:grid;grid-template-columns:1fr auto;gap:var(--s2);align-items:baseline;padding:6px var(--s3);
        border-top:1px solid var(--line);font-size:12px;font-family:var(--mono);cursor:pointer}
  .trow:first-child{border-top:0}
  .trow:hover{background:rgba(255,255,255,.025)}
  .trow .tag{color:var(--brand);font-weight:650}
  .trow .tx{color:var(--ink-2)}
  .trow .st{color:var(--faint);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:54%;font-size:11px}
  .trow.sel{background:var(--brand-soft);box-shadow:inset 3px 0 0 var(--brand)}
  .box{margin-top:var(--s3);border:1px solid var(--line-2);border-radius:var(--r);overflow:hidden;background:var(--surface)}
  .box .bh{padding:9px var(--s3);background:var(--surface-3);font-size:12px;font-family:var(--mono);color:var(--ink);border-bottom:1px solid var(--line)}
  .bm{display:grid;grid-template-columns:auto 1fr;gap:5px var(--s4);padding:var(--s3);font-size:12px;font-family:var(--mono)}
  .bm .k{color:var(--dim)} .bm .v{color:var(--ink);text-align:right;overflow-wrap:anywhere}
  /* ★就地编辑输入（决策 #702） */
  .bedit{width:100%;background:var(--surface-3);border:1px solid var(--line-2);border-radius:4px;color:var(--ink);font:inherit;font-size:12px;padding:2px 6px;text-align:right;outline:none}
  .bedit:focus{border-color:var(--brand)}
  /* ★重置样式（恢复项目代码；决策 #704） */
  .bh{position:relative}
  .breset{margin-left:auto}
  .box .bh{display:flex;align-items:center;gap:8px}
  .breset{background:none;border:1px solid var(--line-2);border-radius:5px;color:var(--brand2);font-size:11px;padding:2px 8px;cursor:pointer;flex:none}
  .breset:hover{border-color:var(--brand2)}
  .mbox{position:relative;margin:var(--s3);border:1px dashed var(--brand);background:var(--brand-soft);border-radius:5px;min-height:22px}
  .mbox .lbl{position:absolute;top:-8px;left:8px;background:var(--surface);padding:0 5px;font-size:10px;color:var(--brand);letter-spacing:.3px}

  /* ── 设备环境 ── */
  .envrow{display:flex;justify-content:space-between;gap:var(--s3);padding:7px var(--s3);border-top:1px solid var(--line);font-size:12px;font-family:var(--mono)}
  .envrow:first-child{border-top:0}
  .envrow .k{color:var(--dim);white-space:nowrap} .envrow .v{color:var(--ink-2);text-align:right;overflow-wrap:anywhere}
  .envgrp{display:flex;align-items:center;gap:8px;padding:8px var(--s3);background:var(--surface-2);
          color:var(--brand);font-size:11px;font-weight:650;letter-spacing:.5px;text-transform:uppercase}
  .envgrp::before{content:"";width:5px;height:5px;border-radius:2px;background:var(--brand)}

  /* ── 端点 ── */
  .eps{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:var(--s2)}
  .ep{display:flex;align-items:baseline;gap:8px;font-family:var(--mono);font-size:11.5px;color:var(--dim);
      border:1px solid var(--line);border-radius:var(--r-sm);padding:8px 11px;background:var(--surface)}
  .ep b{color:var(--ink-2);font-weight:650;white-space:nowrap}

  a{color:var(--brand);text-decoration:none}
  footer{color:var(--faint);font-size:11.5px;text-align:center;padding:var(--s5) var(--s4) var(--s6);border-top:1px solid var(--line);margin-top:var(--s5)}
  footer code{font-family:var(--mono);color:var(--dim)}
</style></head>
<body>
<header>
  <div class="brand"><span class="mark">◈</span><span class="btitle"><b>Proteus</b> DevTools</span></div>
  <div class="crumbs"><span class="sep">/</span><span class="proj">${esc(info.projectName)}</span><span class="sep">·</span><span class="plat">${esc(info.platform)}</span></div>
  <div class="grow"></div>
  <span class="pill" id="host-pill"><span class="dot off" id="host-dot"></span><span id="host-txt">设备离线</span></span>
</header>
<main>
  <div class="grid">
    <div class="card" data-kind="build"><div class="k">Bundle 版本</div><div class="v" id="c-ver">—</div></div>
    <div class="card" data-kind="build"><div class="k">Bundle 体积</div><div class="v" id="c-size">—<small>KB</small></div></div>
    <div class="card" data-kind="build"><div class="k">重建耗时</div><div class="v" id="c-ms">—<small>ms</small></div></div>
    <div class="card" data-kind="nav"><div class="k">当前屏</div><div class="v host"><span class="screen" id="c-screen">—</span></div></div>
    <div class="card" data-kind="perf"><div class="k">渲染耗时</div><div class="v" id="c-render">—<small>ms</small></div></div>
    <div class="card" data-kind="perf"><div class="k">逐帧耗时</div><div class="v" id="c-frame">—<small>ms</small></div></div>
    <div class="card" data-kind="perf"><div class="k">重排计数</div><div class="v" id="c-relayout">—</div></div>
    <div class="card" data-kind="perf"><div class="k">Patch 总数</div><div class="v" id="c-patches">—</div></div>
  </div>

  <div class="blk">
    <h2>重建时间线 · 实时</h2>
    <div class="tl" id="tl"><div class="empty">等待事件…改一次源码即出现。</div></div>
  </div>

  <div class="blk two">
    <div>
      <h2>Elements · 当前屏节点树</h2>
      <div class="panel" id="tree"><div class="empty">暂无节点树…宿主渲染后上报。</div></div>
      <div class="box" id="box" style="display:none"></div>
    </div>
    <div>
      <h2>Console · 设备日志<span class="flt" data-flt="con"><b class="on" data-ch="all">全部</b><b data-ch="project">项目</b><b data-ch="native">原生</b></span></h2>
      <!-- ★REPL 输入（决策 #701）：在**设备** JSContext 上求值，结果回 Console -->
      <div class="repl"><span class="repl-p">›</span><input id="repl" type="text" placeholder="在设备上求值表达式（如 __proteusSuperappRuntimeCurrent()）…" spellcheck="false" autocomplete="off" /></div>
      <div class="panel" id="con"><div class="empty">暂无日志…在页面里 console.log、上面输入框求值、或改源码即出现。</div></div>
    </div>
  </div>

  <div class="blk two">
    <div>
      <h2>Events · 手势派发 trace</h2>
      <div class="panel" id="events"><div class="empty">暂无手势…在设备上点一下屏幕即出现。</div></div>
    </div>
    <div>
      <h2>Network · 通道<span class="flt" data-flt="net"><b class="on" data-ch="all">全部</b><b data-ch="native">原生</b><b data-ch="project">项目</b></span></h2>
      <div class="panel" id="net"><div class="empty">暂无请求。</div></div>
    </div>
  </div>

  <div class="blk">
    <h2>设备环境 · 含内核 / 引擎</h2>
    <div class="panel" id="env"><div class="empty">等待宿主心跳…</div></div>
  </div>

  <div class="blk">
    <h2>端点</h2>
    <div class="eps">
      <span class="ep"><b>GET /</b>本面板</span>
      <span class="ep"><b>GET /version</b>bundle 版本号</span>
      <span class="ep"><b>GET /bundle</b>bundle-superapp.js</span>
      <span class="ep"><b>GET /health</b>探活</span>
      <span class="ep"><b>GET /events</b>SSE 事件流</span>
      <span class="ep"><b>GET /ping</b>心跳 · 环境 · 性能</span>
      <span class="ep"><b>POST /tree</b>元素内省（含 rect）</span>
      <span class="ep"><b>GET /inspect</b>被点元素</span>
      <span class="ep"><b>GET /trace</b>事件 trace</span>
      <span class="ep"><b>GET /log</b>宿主日志</span>
      <span class="ep"><b>GET /bridge</b>桥调用</span>
      <span class="ep"><b>GET /panelcmd</b>面板→设备命令（入队）</span>
      <span class="ep"><b>GET /cmd</b>宿主取命令（轮询）</span>
    </div>
  </div>
</main>
<footer>Proteus DevTools · dev server <code>${esc(info.url)}</code> · 数据来自 dev server（重建 / 网络 / 宿主心跳 + 环境 + 性能 / 元素树 + 盒模型 / 事件 trace / 日志 / 桥调用）</footer>
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
  let boxEditing = false;   // ★就地编辑进行中（暂停树重渲染，防抢焦点；决策 #704）
  let pendingTree = null;   // 编辑期间到达的新树（焦点离开后补刷）
  const rows = [];
  function addRow(e, isNew) {
    const r = document.createElement('div');
    r.className = 'row' + (isNew ? ' new' : '');
    r.innerHTML = '<span class="ver">v' + e.version + '</span>'
      + '<span class="why">' + (e.reason || '') + '</span>'
      + '<span class="meta">' + (e.bytes ? Math.round(e.bytes / 1024) + ' KB · ' : '') + (e.ms || 0) + 'ms · ' + fmtTime(e.time) + '</span>';
    return r;
  }
  const stCls = (s) => s >= 500 ? 'err' : s >= 400 ? 'warn' : 'ok';  const chTag = (ch) => '<span class="ch ch-' + (ch === 'project' ? 'project' : 'native') + '">' + (ch === 'project' ? '项目' : '原生') + '</span>';
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
    // ★编辑中：保留输入框（勿被新树替换），把新树挂起，待焦点离开再刷（决策 #704）
    if (boxEditing) { pendingTree = t || { nodes: [] }; return; }
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
  // ★进入输入框 ⇒ 暂停树重渲染（否则新树会替换掉正在编辑的输入框 ⇒ 抢焦点/丢输入）；离开 ⇒ 提交并恢复。
  //   （决策 #704：用户「修改后要回车才生效，习惯是点别处失焦」——失焦即提交，且不被刷新打断）
  boxEl.addEventListener('focusin', function (ev) { if (ev.target.classList && ev.target.classList.contains('bedit')) boxEditing = true; });
  boxEl.addEventListener('focusout', function (ev) {
    var t = ev.target;
    if (t && t.classList && t.classList.contains('bedit')) commitEdit(t);   // ★失焦即提交
    boxEditing = false;
    if (pendingTree) { var p = pendingTree; pendingTree = null; renderTree(p); }
  });
  function selectNode(id) { selId = id; renderBox(findNode(id)); renderTree(treeData); sendHighlight(id); }
  // 盒模型：内核 rect（x/y/w/h）+ 关键样式
  function renderBox(n) {
    if (!n) { boxEl.style.display = 'none'; return; }
    const r = n.rect || {};
    const rc = n.rect ? 'x=' + Math.round(r.x) + '  y=' + Math.round(r.y) + '  ' + Math.round(r.width) + '×' + Math.round(r.height) : '（无内核几何）';
    const styles = Object.keys(n).filter((k) => k !== 'id' && k !== 'parentId' && k !== 'tag' && k !== 'text' && k !== 'rect' && !Array.isArray(n[k]))
      .map((k) => {
        var v = typeof n[k] === 'object' ? JSON.stringify(n[k]) : String(n[k]);
        // ★就地编辑（决策 #702）：可编辑的绘制属性 ⇒ 渲染输入框（回车提交到设备）
        if (EDITABLE.indexOf(k) >= 0) {
          return '<div class="k">' + escapeHtml(k) + '</div><div class="v"><input class="bedit" data-id="' + n.id + '" data-key="' + escapeHtml(k) + '" value="' + escapeHtml(v) + '"></div>';
        }
        return '<div class="k">' + escapeHtml(k) + '</div><div class="v">' + escapeHtml(v) + '</div>';
      }).join('');
    boxEl.style.display = 'block';
    boxEl.innerHTML = '<div class="bh">#' + n.id + ' &lt;' + escapeHtml(n.tag || n.semantic || '?') + '&gt;' + (n.text ? ' “' + escapeHtml(String(n.text).slice(0, 40)) + '”' : '')
      + '<button class="breset" title="恢复项目代码的实时效果（清除就地编辑）">重置样式</button></div>'
      + '<div class="mbox"' + (r.width ? ' style="width:' + Math.max(4, Math.min(560, r.width)) + 'px;height:' + Math.max(4, Math.min(200, r.height)) + 'px"' : '') + '><span class="lbl">内核 rect</span></div>'
      + '<div class="bm"><div class="k">rect</div><div class="v">' + escapeHtml(rc) + '</div>' + styles + '</div>';
    var rb = boxEl.querySelector('.breset');
    if (rb) rb.addEventListener('click', function () { sendCmd('reset', {}); });
  }
  // ★就地编辑：**回车或失焦**都提交到设备（决策 #704）——失焦是"改完点别处"的惯性动作，不能要求回车。
  //   提交后把值同步回内存树（n[key]），使"失焦提交 → 焦点离开补刷"不会被旧值回滚。
  function commitEdit(t) {
    var id = Number(t.dataset.id), key = t.dataset.key, val = t.value;
    var n = findNode(id);
    if (n) n[key] = val;                    // 本地记账（防补刷回滚）
    sendEdit(id, key, val);
  }
  boxEl.addEventListener('keydown', function (ev) {
    var t = ev.target;
    if (!t || !t.classList || !t.classList.contains('bedit')) return;
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    commitEdit(t);
    t.blur();                               // 回车等价"提交并离开"（blur 会触发上面的 focusout 提交，幂等）
  });
  // ── 事件 trace（决策 #675）──
  // ★面板→设备命令（决策 #701）：选中节点 ⇒ 下发 highlight（设备屏上高亮该节点）
  function sendCmd(type, params) {
    const q = new URLSearchParams(Object.assign({ type: type }, params || {}));
    fetch('/panelcmd?' + q.toString()).catch(function () {});
  }
  function sendHighlight(id) { sendCmd('highlight', { id: id }); }
  // ★就地编辑 v1（决策 #702）：改某节点的**绘制属性**（设备上实时预览，重新渲染即还原）
  const EDITABLE = ['backgroundColor', 'color', 'opacity', 'borderRadius', 'borderWidth', 'borderColor'];
  function sendEdit(id, key, value) { sendCmd('edit', { id: id, key: key, value: value }); }
  // ★REPL（决策 #701）：输入表达式 ⇒ 设备 JSContext 求值 ⇒ 结果回 Console
  const replEl = $('repl');
  if (replEl) {
    replEl.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      var expr = replEl.value.trim(); if (!expr) return;
      sendCmd('eval', { expr: expr });
      replEl.value = '';
    });
  }
  function addEvent(e, isNew) {
    const r = document.createElement('div');
    r.className = 'crow lv-info' + (isNew ? ' new' : '');    const chain = (e.chain || []).join(' → ');
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
      const h = document.createElement('div'); h.className = 'envgrp';
      h.textContent = g.t;
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
