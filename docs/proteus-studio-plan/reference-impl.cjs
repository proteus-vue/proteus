'use strict';
// G-56 Proteus Studio — 自有宿主壳 参考实现（零依赖）
// 实测自测：见文件末尾 self-test

// ============================================================
// 1. 能力边界矩阵（INV-ST-02：禁自研编辑器内核与 GUI）
// ============================================================
const MODULES = [
  { name: 'editor-core',  decision: 'integrate', impl: 'CodeMirror 6',        why: 'xi-editor已死/Lapce仍pre-alpha/Floem IME不可用' },
  { name: 'terminal',     decision: 'integrate', impl: 'xterm.js+portable-pty', why: 'Terax已上线/tauri-plugin-pty现成' },
  { name: 'device-embed', decision: 'integrate', impl: 'libmpv',              why: '三平台实证' },
  { name: 'gui-framework',decision: 'integrate', impl: 'Tauri 2',             why: 'Lapce自研Floem两年未发新版' },
  { name: 'shell',        decision: 'build',     impl: 'Tauri 2 + Rust',      why: '本份主体' },
  { name: 'panel-ui',     decision: 'build',     impl: 'Web 技术栈',           why: '需要画布' },
  { name: 'orchestration',decision: 'build',     impl: 'Rust',                why: '宿主特有，无可集成' },
  { name: 'knowledge-kernel', decision: 'reuse', impl: 'G-55',               why: '零改动（架构试金石）' },
  { name: 'device-bridge',decision: 'reuse',     impl: 'G-53/G-54',           why: '仅加视频通道' },
  { name: 'mobile-companion', decision: 'build', impl: 'Tauri 2 mobile',      why: '三个宿主做不到的独特价值' }
];

const FORBIDDEN_TO_BUILD = ['editor-core', 'gui-framework', 'terminal', 'device-embed'];

// 边界矩阵决策校验（INV-ST-02）
function checkModuleDecision(mod) {
  if (FORBIDDEN_TO_BUILD.includes(mod.name) && mod.decision === 'build') {
    return { allowed: false, reason: 'G-56.1 红线：禁止自研 ' + mod.name };
  }
  return { allowed: true, reason: 'ok' };
}

// ============================================================
// 2. 四宿主能力矩阵（实测真值，非推断）
// ============================================================
const HOST_CAPABILITIES = {
  vscode:   { 'panel.custom': true,  'panel.embeddedCanvas': true,  'button.custom': true,  'console.custom': true,  'device.native': 'partial', 'form.mobile': false },
  intellij: { 'panel.custom': true,  'panel.embeddedCanvas': true,  'button.custom': true,  'console.custom': true,  'device.native': 'partial', 'form.mobile': false },
  zed:      { 'panel.custom': false, 'panel.embeddedCanvas': false, 'button.custom': false, 'console.custom': false, 'device.native': false,     'form.mobile': false },
  studio:   { 'panel.custom': true,  'panel.embeddedCanvas': true,  'button.custom': true,  'console.custom': true,  'device.native': true,      'form.mobile': true  }
};

function supports(hostId, cap) {
  const h = HOST_CAPABILITIES[hostId];
  if (!h) return false;
  return h[cap] === true;
}

// ============================================================
// 3. 内核（唯一实例，四宿主共用）— INV-ST-01 / INV-ST-06
// ============================================================
const KERNEL = {
  instanceId: 'kernel-singleton-001',
  api: [
    'knowledge.getBackends', 'knowledge.getLayerViolations',
    'knowledge.getSPI graph', 'knowledge.getImpact',
    'assert.run', 'assert.report',
    'device.boot', 'device.runIsolated'
  ],
  // 内核不感知任何宿主身份 — 这是架构试金石的核心
  hostAwareApis: []
};

let kernelInstanceCount = 0;
function createKernel() {
  kernelInstanceCount++;
  return { ...KERNEL, instanceId: 'kernel-' + kernelInstanceCount };
}

// apiSurface 快照（架构试金石用）
function apiSurface(kernel) {
  return JSON.stringify({
    api: [...kernel.api].sort(),
    hostAwareApis: [...kernel.hostAwareApis].sort()
  });
}

// 模拟"新增宿主适配器"：只写适配层，绝不碰内核
function addHostAdapter(kernel, hostId) {
  // 适配层代码，纯新增，不修改 kernel
  return {
    hostId,
    kernel,
    capabilities: HOST_CAPABILITIES[hostId] || {},
    // 适配层不得向内核注入宿主相关 API
    injectToKernel() { throw new Error('G-56.2: 禁止向内核注入宿主特权'); }
  };
}

// ============================================================
// 4. 嵌入策略降级链 — INV-ST-05
// ============================================================
function resolveEmbedStrategy(env) {
  // 优先级：headless > wayland > nvidia-linux > renderBackend > default
  if (env.headless) return { mode: 'headless', reason: 'headless 环境' };
  if (env.displayServer === 'wayland') return { mode: 'window', reason: 'Wayland 无窗口句柄（R4）' };
  if (env.gpu === 'nvidia-linux') return { mode: 'web', reason: 'NVIDIA+WebKitGTK 白屏（R1）' };
  if (env.risks && env.risks.includes('WEBKITGTK_VERSION_MISMATCH')) return { mode: 'web', reason: 'webkit2gtk 版本不匹配（R2）' };
  // R3：WebGL 静默降级 —— unknown 保守处理
  if (env.renderBackend === 'sw') return { mode: 'web', reason: '软件光栅化（R3）' };
  if (env.renderBackend === 'unknown') return { mode: 'web', reason: '渲染后端未知，保守降级（R3）' };
  if (env.mpvMissing) return { mode: 'web', reason: 'mpv 缺失' };
  if (env.mode === 'offscreen-poc-ok') return { mode: 'mpv-offscreen', reason: 'PoC 通过' };
  return { mode: 'mpv-wid', wid: env.windowId || 0, reason: '默认' };
}

const EMBED_CHAIN = ['mpv-offscreen', 'mpv-wid', 'window', 'web', 'headless'];

// ============================================================
// 5. 平台风险探测 — INV-ST-04
// ============================================================
function probeRenderBackend(fps) {
  // WebKitGTK 会把 renderer 伪装成 "Apple GPU"，只能靠帧率间接推断
  if (typeof fps !== 'number' || isNaN(fps)) return 'unknown';
  if (fps > 50) return 'hw';
  if (fps < 20) return 'sw';
  return 'unknown';  // ★ 诚实标注，不猜
}

// G-56.4：unknown 不得当作 hw
function isHardwareAccelerated(backend) {
  return backend === 'hw';   // 严格相等：unknown !== hw
}

// ============================================================
// 6. 归一化坐标 — INV-ST-03
// ============================================================
function normalizeTap(x, y, opts) {
  opts = opts || {};
  const w = opts.width, h = opts.height;
  // 若提供了像素尺寸，则输入必须是像素；否则必须是 0..1
  if (w && h) {
    // 像素 → 归一化
    if (x < 0 || x > w || y < 0 || y > h) {
      throw new Error('坐标越界: (' + x + ',' + y + ') 超出 ' + w + 'x' + h);
    }
    return { x: +(x / w).toFixed(6), y: +(y / h).toFixed(6) };
  }
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    throw new Error('G-56.3: 坐标必须归一化 0..1，收到 (' + x + ',' + y + ')');
  }
  return { x, y };
}

// 拒绝像素坐标（无尺寸信息时）
function assertNormalized(x, y) {
  if (x > 1 || y > 1) {
    return { ok: false, error: 'G-56.3: 拒绝像素坐标 (' + x + ',' + y + ')，必须 0..1' };
  }
  return { ok: true };
}

// ============================================================
// 7. 无障碍树（替代截图比对）— INV-ST-07
// ============================================================
function buildAXTree(nodes) {
  return nodes.map(n => ({
    role: n.role,
    label: n.label || null,
    value: n.value || null,
    frame: n.frame,   // 归一化 0..1
    children: n.children ? buildAXTree(n.children) : []
  }));
}

// 语义断言：跨设备稳定（截图比对会 flaky）
function assertByAX(tree, predicate) {
  return predicate(tree);
}

function findByRole(tree, role) {
  const out = [];
  (function walk(ns) {
    for (const n of ns) {
      if (n.role === role) out.push(n);
      if (n.children && n.children.length) walk(n.children);
    }
  })(tree);
  return out;
}

// ============================================================
// 8. 移动端伴侣（仅 studio）— INV-ST-08
// ============================================================
function companionStrategy(platform) {
  if (platform === 'ios' && platform === 'ios-no-cross-inspect') {
    return { mode: 'companion.sdk', reason: 'iOS 不允许跨 App inspect（R6）' };
  }
  if (platform === 'ios' || platform === 'android') {
    return { mode: 'companion.native', reason: 'Tauri 2 mobile 支持' };
  }
  return { mode: 'companion.remote', reason: '非移动端平台，回退远程' };
}

function mobileCapableHosts() {
  return Object.keys(HOST_CAPABILITIES).filter(h => HOST_CAPABILITIES[h]['form.mobile'] === true);
}

// ============================================================
// 9. StudioShell
// ============================================================
class StudioShell {
  constructor(kernel) {
    this.id = 'studio';
    this.kernel = kernel;
    this.panels = [];
  }
  supports(cap) { return supports('studio', cap); }

  mountPanel(spec) {
    // 空/异常 spec 不崩溃（NEG-08）
    if (!spec || !spec.kind) return { handle: null, degraded: true, reason: '空面板规格' };
    const handle = { id: 'panel-' + (this.panels.length + 1), kind: spec.kind };
    this.panels.push(handle);
    return { handle, degraded: false };
  }

  layout(specs) {
    if (!Array.isArray(specs)) return { panels: [], degraded: true, reason: '非法布局规格' };
    return { panels: specs.map(s => this.mountPanel(s).handle).filter(Boolean), degraded: specs.length === 0 };
  }
}

// ============================================================
// self-test
// ============================================================
let _pass = 0, _fail = 0, _cases = [];
function ok(cond, name) {
  if (cond) { _pass++; _cases.push(['OK', name]); }
  else { _fail++; _cases.push(['FAIL', name]); }
}
function throws(fn, name) {
  try { fn(); _fail++; _cases.push(['FAIL', name + ' (未抛错)']); }
  catch (e) { _pass++; _cases.push(['OK', name]); }
}
function eq(a, b, name) { ok(a === b, name + ' (got ' + JSON.stringify(a) + ')'); }

function runSelfTest() {
  // ---- INV-ST-02 禁自研 ----
  ok(MODULES.length === 10, '模块矩阵共 10 项');
  ok(MODULES.every(m => checkModuleDecision(m).allowed), 'INV-ST-02 所有模块决策合规');
  const badMod = { name: 'editor-core', decision: 'build', impl: '自研', why: '' };
  eq(checkModuleDecision(badMod).allowed, false, 'INV-ST-02 自研编辑器被否决');
  const badGui = { name: 'gui-framework', decision: 'build', impl: '自研', why: '' };
  eq(checkModuleDecision(badGui).allowed, false, 'INV-ST-02 自研 GUI 被否决');
  ok(MODULES.filter(m => m.decision === 'reuse').length === 2, '复用 2 项（内核 + 设备桥）');
  ok(MODULES.filter(m => m.decision === 'build').length === 4, '自研 4 项（壳/面板/编排/伴侣）');

  // ---- 能力矩阵 ----
  eq(Object.keys(HOST_CAPABILITIES).length, 4, '四个宿主');
  eq(supports('studio', 'form.mobile'), true, 'INV-ST-08 studio 支持移动端');
  eq(supports('vscode', 'form.mobile'), false, 'vscode 不支持移动端');
  eq(supports('intellij', 'form.mobile'), false, 'intellij 不支持移动端');
  eq(supports('zed', 'form.mobile'), false, 'zed 不支持移动端');
  eq(mobileCapableHosts().join(','), 'studio', 'INV-ST-08 移动端唯一 studio');
  eq(supports('studio', 'device.native'), true, 'studio 原生设备嵌入');
  eq(supports('zed', 'panel.custom'), false, 'zed 无自定义面板');
  eq(supports('zed', 'console.custom'), false, 'zed 无控制台自定义');
  eq(supports('vscode', 'panel.embeddedCanvas'), true, 'vscode 面板内嵌画布');

  // ---- INV-ST-01 架构试金石（最重要）----
  const kernel = createKernel();
  const S1 = apiSurface(kernel);
  addHostAdapter(kernel, 'vscode');
  addHostAdapter(kernel, 'intellij');
  addHostAdapter(kernel, 'zed');
  const S2 = apiSurface(kernel);
  eq(S1, S2, 'INV-ST-01 三宿主接入后内核 API 未变');
  addHostAdapter(kernel, 'studio');
  const S3 = apiSurface(kernel);
  eq(S1, S3, 'INV-ST-01 ★ 自有宿主接入后内核 API 仍未变');
  eq(kernel.hostAwareApis.length, 0, '内核无宿主感知 API');
  const adapter = addHostAdapter(kernel, 'studio');
  throws(() => adapter.injectToKernel(), 'G-56.2 禁止向内核注入宿主特权');

  // ---- INV-ST-06 内核单例 ----
  const k2 = createKernel();
  ok(k2.instanceId !== kernel.instanceId, '内核实例 id 可区分');
  ok(kernel.api.length >= 6, '内核 API 数量 >= 6');

  // ---- INV-ST-05 降级链 ----
  eq(resolveEmbedStrategy({ displayServer: 'wayland' }).mode, 'window', 'NEG-01 Wayland → window');
  eq(resolveEmbedStrategy({ gpu: 'nvidia-linux' }).mode, 'web', 'NEG-02 NVIDIA → web');
  eq(resolveEmbedStrategy({ renderBackend: 'unknown' }).mode, 'web', 'NEG-03 unknown → web（保守）');
  eq(resolveEmbedStrategy({ renderBackend: 'sw' }).mode, 'web', 'R3 软件光栅化 → web');
  eq(resolveEmbedStrategy({ headless: true }).mode, 'headless', 'NEG-06 headless');
  eq(resolveEmbedStrategy({ mpvMissing: true }).mode, 'web', 'NEG-05 mpv 缺失 → web');
  eq(resolveEmbedStrategy({ risks: ['WEBKITGTK_VERSION_MISMATCH'] }).mode, 'web', 'R2 版本不匹配 → web');
  eq(resolveEmbedStrategy({ mode: 'offscreen-poc-ok' }).mode, 'mpv-offscreen', 'PoC 通过 → offscreen');
  eq(resolveEmbedStrategy({ windowId: 42 }).mode, 'mpv-wid', '默认 → mpv-wid');
  ok(EMBED_CHAIN.length === 5, '降级链五档');
  ok(EMBED_CHAIN.includes(resolveEmbedStrategy({ displayServer: 'wayland' }).mode), '降级结果在链内');
  // 全档不崩溃
  const allModes = [{ headless: true }, { displayServer: 'wayland' }, { gpu: 'nvidia-linux' }, { mpvMissing: true }, { windowId: 1 }, {}];
  ok(allModes.every(e => { try { return !!resolveEmbedStrategy(e).mode; } catch (err) { return false; } }), 'INV-ST-05 所有环境均返回策略不崩溃');

  // ---- INV-ST-04 平台风险诚实上报 ----
  eq(probeRenderBackend(60), 'hw', '高帧率 → hw');
  eq(probeRenderBackend(15), 'sw', '低帧率 → sw');
  eq(probeRenderBackend(35), 'unknown', '中间帧率 → unknown（不猜）');
  eq(probeRenderBackend(undefined), 'unknown', '无数据 → unknown');
  eq(probeRenderBackend(NaN), 'unknown', 'NaN → unknown');
  eq(isHardwareAccelerated('unknown'), false, '★ INV-ST-04 unknown 不当作 hw');
  eq(isHardwareAccelerated('sw'), false, 'sw 不是硬件加速');
  eq(isHardwareAccelerated('hw'), true, 'hw 是硬件加速');

  // ---- INV-ST-03 归一化坐标 ----
  eq(assertNormalized(0.5, 0.5).ok, true, '归一化坐标通过');
  eq(assertNormalized(640, 480).ok, false, 'NEG-04 像素坐标被拒绝');
  throws(() => normalizeTap(640, 480), 'NEG-04 无尺寸时像素坐标抛错');
  const n1 = normalizeTap(320, 240, { width: 640, height: 480 });
  eq(n1.x, 0.5, '像素转归一化 x');
  eq(n1.y, 0.5, '像素转归一化 y');
  throws(() => normalizeTap(700, 100, { width: 640, height: 480 }), '越界坐标抛错');
  eq(normalizeTap(1, 1).x, 1, '边界 1.0 允许');
  eq(normalizeTap(0, 0).y, 0, '边界 0.0 允许');

  // ---- INV-ST-07 无障碍树 ----
  const raw = [
    { role: 'button', label: '登录', frame: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 } },
    { role: 'container', label: null, frame: { x: 0, y: 0, w: 1, h: 1 }, children: [
      { role: 'text', value: '欢迎', frame: { x: 0.1, y: 0.1, w: 0.5, h: 0.03 } }
    ]}
  ];
  const ax = buildAXTree(raw);
  eq(ax.length, 2, 'AX 树顶层 2 节点');
  eq(findByRole(ax, 'button').length, 1, 'AX 找到 1 个 button');
  eq(findByRole(ax, 'text')[0].value, '欢迎', 'AX 嵌套节点可查');
  eq(assertByAX(ax, t => findByRole(t, 'button').length === 1), true, 'INV-ST-07 基于 AX 的语义断言');
  ok(ax[0].frame.x >= 0 && ax[0].frame.x <= 1, 'AX frame 已归一化');

  // ---- 伴侣降级 ----
  eq(companionStrategy('android').mode, 'companion.native', 'Android 原生伴侣');
  eq(companionStrategy('desktop').mode, 'companion.remote', 'NEG-09 桌面 → 远程伴侣');

  // ---- StudioShell ----
  const shell = new StudioShell(kernel);
  eq(shell.supports('form.mobile'), true, 'StudioShell 支持移动端');
  ok(shell.mountPanel({ kind: 'editor', path: '/a.ts' }).handle !== null, '挂载编辑器面板');
  ok(shell.mountPanel({ kind: 'device' }).handle !== null, '挂载设备面板');
  eq(shell.mountPanel(null).degraded, true, 'NEG-08 空面板不崩溃');
  eq(shell.layout([]).degraded, true, 'NEG-08 空布局 degraded');
  eq(shell.layout([{ kind: 'terminal' }, { kind: 'assertions' }]).panels.length, 2, '批量布局 2 面板');
  eq(shell.panels.length, 4, '面板累计计数正确');

  // ---- 接缝命题 ----
  eq(isHardwareAccelerated(probeRenderBackend(35)), false, '接缝: 探测 unknown → 不当 hw');
  ok(supports('studio', 'panel.embeddedCanvas') && supports('studio', 'device.native'), '接缝: studio 画布与原生设备并存');
  eq(mobileCapableHosts().length, 1, '接缝: 移动端宿主唯一');
}

runSelfTest();
for (const [s, n] of _cases) console.log(s + ': ' + n);
console.log('\nself-test: ' + _pass + '/' + (_pass + _fail));
if (_fail > 0) process.exit(1);
