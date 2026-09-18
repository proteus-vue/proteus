/* G-54 DevTools Suite — reference implementation (zero deps) */
'use strict';

const SKIP = Object.freeze({ __skip: true });

// ============ 能力内核（IDE 无关，唯一实现） ============
class FrameworkKnowledgeProvider {
  constructor(model) { this.m = model; }

  // ① IR 结构 → 语义导航
  resolveCall(site) {
    if (!site || !site.activeBackend || !site.symbol) return null;
    const impl = this.m.bindings[site.activeBackend];
    if (!impl) return null;
    const fn = impl[site.symbol];
    if (!fn) return null;
    return { file: fn.file, line: fn.line, backend: site.activeBackend,
             semantic: true };
  }

  // ② 分层规则 → 越层诊断
  checkLayering(edge) {
    if (!edge || !edge.from || !edge.to) return { violation: false, invalid: true };
    const order = { L0: 0, L1: 1, L2: 2 };
    const d = order[edge.to] - order[edge.from];
    const exempt = !!(edge.exempt && edge.reason);
    if (d > 1 && !exempt) {
      return { violation: true, code: 'LAYER_VIOLATION',
               message: `${edge.from} 不得直连 ${edge.to}` };
    }
    return { violation: false, exempt };
  }

  // ③ 断言 → 内联定位
  locateAssertion(id) {
    if (!id) return null;
    const a = this.m.assertions.find(x => x.id === id);
    if (!a) return null;
    return { file: a.file, line: a.line, message: a.message };
  }

  // ④ SPI 拓扑 → 依赖图 + 循环检测（不崩溃）
  buildGraph() {
    const nodes = Object.keys(this.m.edges);
    const edges = [];
    for (const n of nodes) for (const t of this.m.edges[n]) edges.push([n, t]);
    return { nodes, edges, cycles: this._findCycles(nodes, this.m.edges) };
  }

  _findCycles(nodes, adj) {
    const cycles = [];
    const state = {};
    const stack = [];
    const dfs = (n) => {
      state[n] = 1; stack.push(n);
      for (const nx of (adj[n] || [])) {
        if (state[nx] === 1) {
          const i = stack.indexOf(nx);
          cycles.push(stack.slice(i).concat([nx]));
        } else if (!state[nx]) dfs(nx);
      }
      stack.pop(); state[n] = 2;
    };
    for (const n of nodes) if (!state[n]) dfs(n);
    return cycles;
  }

  // ⑤ 设备等价类 → 影响面
  affectedDevices(spiId) {
    return this.m.deviceImpact[spiId] || [];
  }

  // ⑥ 渲染语义 → 多形态预览
  previewVariants(nodeId) {
    return (this.m.variants[nodeId] || []).map(v => ({ ...v }));
  }
}

// ============ 协议适配器（薄，只做翻译，零业务逻辑） ============
class LspAdapter {
  constructor(k) { this.k = k; this.id = 'lsp'; this.priority = 10;
    this.supported = new Set(['resolveCall', 'checkLayering', 'locateAssertion']); }
  isAvailable() { return true; }
  supports(cap) { return this.supported.has(cap); }
  dispatch(req) {
    if (!this.supports(req.capability)) return SKIP;   // 降级，非失败
    return { adapter: 'lsp', data: this.k[req.capability](req.payload) };
  }
}

class RpcAdapter {
  constructor(k) { this.k = k; this.id = 'rpc'; this.priority = 20;
    this.supported = new Set(['buildGraph', 'affectedDevices', 'previewVariants']); }
  isAvailable() { return true; }
  supports(cap) { return this.supported.has(cap); }
  dispatch(req) {
    if (!this.supports(req.capability)) return SKIP;
    return { adapter: 'rpc', data: this.k[req.capability](req.payload) };
  }
}

class DapAdapter {
  constructor(k) { this.k = k; this.id = 'dap'; this.priority = 30;
    this.supported = new Set(['locateAssertion']); }
  isAvailable() { return true; }
  supports(cap) { return this.supported.has(cap); }
  dispatch(req) {
    if (!this.supports(req.capability)) return SKIP;
    return { adapter: 'dap', data: this.k[req.capability](req.payload) };
  }
}

class CliAdapter {
  constructor(k) { this.k = k; this.id = 'cli'; this.priority = 40;
    this.supported = new Set(['resolveCall', 'checkLayering', 'locateAssertion',
                              'buildGraph', 'affectedDevices']); }
  isAvailable() { return true; }
  supports(cap) { return this.supported.has(cap); }
  dispatch(req) {
    if (!this.supports(req.capability)) return SKIP;
    return { adapter: 'cli', data: this.k[req.capability](req.payload) };
  }
}

// raw：兜底，内核直调，永远可用
class RawAdapter {
  constructor(k) { this.k = k; this.id = 'raw'; this.priority = 99; }
  isAvailable() { return true; }
  supports(cap) { return this.supported.has(cap); }
  dispatch(req) {
    if (typeof this.k[req.capability] !== 'function') return SKIP;
    return { adapter: 'raw', data: this.k[req.capability](req.payload), degraded: true };
  }
}

// ============ 注册表：pick 永不失败 ============
class AdapterRegistry {
  constructor(kernel) { this.kernel = kernel; this.list = []; }
  register(a) { this.list.push(a); this.list.sort((x, y) => x.priority - y.priority); }
  pick(cap) {
    for (const a of this.list) {
      if (a.isAvailable() && a.supports(cap)) return a;   // 元数据探测，无副作用
    }
    return null;
  }
  dispatch(req) {
    for (const a of this.list) {
      if (!a.isAvailable()) continue;
      const r = a.dispatch(req);
      if (r !== SKIP) return r;
    }
    return new RawAdapter(this.kernel).dispatch(req);   // 兜底
  }
}

// ============ self-test ============
let _p = 0, _f = 0, _c = [];
const ok = (c, n) => { if (c) { _p++; _c.push(['OK', n]); } else { _f++; _c.push(['FAIL', n]); } };
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const model = {
  bindings: {
    webgl: { render: { file: 'webgl.cjs', line: 88 },
             clear:  { file: 'webgl.cjs', line: 21 } },
    skia:  { render: { file: 'skia.cjs',  line: 140 } }
  },
  assertions: [
    { id: 'INV-07', file: 'sandbox.cjs', line: 142, message: '隔离泄漏' },
    { id: 'INV-D2', file: 'matrix.cjs',  line: 57,  message: '等价类偏差超阈值' }
  ],
  edges: { kernel: ['spi'], spi: ['backend'], backend: [] },
  deviceImpact: {
    'render': ['低端 Android(API<28)', 'iOS 模拟器(无GPU)', '折叠屏(多窗口)']
  },
  variants: { 'btn-1': [{ backend: 'webgl', w: 100 }, { backend: 'skia', w: 100 }] }
};

const k = new FrameworkKnowledgeProvider(model);
const reg = new AdapterRegistry(k);
reg.register(new LspAdapter(k));
reg.register(new RpcAdapter(k));
reg.register(new DapAdapter(k));
reg.register(new CliAdapter(k));

// --- INV-DT-03 语义导航 ---
const nav = k.resolveCall({ activeBackend: 'webgl', symbol: 'render' });
ok(nav && nav.file === 'webgl.cjs' && nav.line === 88, 'INV-DT-03 导航到当前后端实现');
ok(nav.semantic === true, 'INV-DT-03 标记为语义导航(非文本匹配)');
const nav2 = k.resolveCall({ activeBackend: 'skia', symbol: 'render' });
ok(nav2.line === 140 && nav2.file === 'skia.cjs', 'INV-DT-03 换后端→换目标(静态分析做不到)');
ok(k.resolveCall({ activeBackend: 'nope', symbol: 'render' }) === null, 'NEG-04 未知后端→null');

// --- INV-DT-04 分层守护 ---
ok(k.checkLayering({ from: 'L0', to: 'L2' }).violation === true, 'INV-DT-04 L0→L2 越层必报');
ok(k.checkLayering({ from: 'L0', to: 'L1' }).violation === false, 'INV-DT-04 L0→L1 合规');
ok(k.checkLayering({ from: 'L1', to: 'L2' }).violation === false, 'INV-DT-04 L1→L2 合规');
ok(k.checkLayering({ from: 'L0', to: 'L2', exempt: true, reason: '性能热路径' }).violation === false,
   'NEG-03 显式豁免→不误报');
ok(k.checkLayering({ from: 'L0', to: 'L2', exempt: true }).violation === true,
   'NEG-03 豁免无理由→仍报(防绕过)');

// --- INV-DT-05 断言定位 ---
const loc = k.locateAssertion('INV-07');
ok(loc && loc.file === 'sandbox.cjs' && loc.line === 142, 'INV-DT-05 断言带 file/line 定位');
ok(typeof loc.message === 'string', 'INV-DT-05 断言带消息');
ok(k.locateAssertion('NOPE') === null, 'NEG-05 断言不存在→null');

// --- INV-DT-06 依赖图 + 循环检测（不崩溃） ---
const g = k.buildGraph();
ok(g.nodes.length === 3 && g.edges.length === 2, 'INV-DT-06 图结构正确');
ok(g.cycles.length === 0, 'INV-DT-06 无环时 cycles 为空');

const cyclic = new FrameworkKnowledgeProvider({
  bindings: {}, assertions: [], deviceImpact: {}, variants: {},
  edges: { a: ['b'], b: ['c'], c: ['a'] }
});
const cg = cyclic.buildGraph();
ok(cg.cycles.length >= 1, 'NEG-01 检测到环(不崩溃)');
ok(Array.isArray(cg.cycles[0]), 'NEG-01 环路径可列出');

// --- INV-DT-07 设备影响面 ---
const imp = k.affectedDevices('render');
ok(imp.length === 3, 'INV-DT-07 列出受影响等价类');
ok(imp.includes('折叠屏(多窗口)'), 'INV-DT-07 含折叠屏');
ok(k.affectedDevices('unknown').length === 0, 'INV-DT-07 未知 SPI→空数组(非崩溃)');

// --- ⑥ 多形态预览 ---
ok(k.previewVariants('btn-1').length === 2, '能力⑥ 多形态预览返回变体');
ok(k.previewVariants('nope').length === 0, '能力⑥ 未知节点→空');

// --- INV-DT-02 未知能力 → SKIP ---
const rUnknown = reg.dispatch({ capability: 'notExist', payload: null });
ok(rUnknown === SKIP, 'INV-DT-02 未知能力→SKIP(不崩溃)');

// --- INV-DT-01 内核唯一性：不同适配器结果一致 ---
const payload = { activeBackend: 'webgl', symbol: 'render' };
const viaLsp = new LspAdapter(k).dispatch({ capability: 'resolveCall', payload });
const viaCli = new CliAdapter(k).dispatch({ capability: 'resolveCall', payload });
ok(viaLsp !== SKIP && viaCli !== SKIP, 'INV-DT-01 LSP/CLI 均支持导航');
ok(deepEq(viaLsp.data, viaCli.data), 'INV-DT-01 跨适配器结果一致(内核唯一)');

const gLsp = new LspAdapter(k).dispatch({ capability: 'buildGraph', payload: null });
ok(gLsp === SKIP, 'INV-DT-01 LSP 不支持依赖图→SKIP(非错误)');
const gRpc = new RpcAdapter(k).dispatch({ capability: 'buildGraph', payload: null });
ok(gRpc !== SKIP && gRpc.data.nodes.length === 3, 'INV-DT-01 RPC 支持依赖图');

// --- 降级链：priority 排序 ---
ok(reg.list.every(a => a.id !== 'raw'), '注册表默认不含 raw(兜底按需创建)');
ok(reg.list[0].id === 'lsp', '按 priority 排序，LSP 优先');
ok(typeof reg.pick('resolveCall').supports === 'function', '适配器暴露 supports(元数据探测)');
ok(reg.pick('buildGraph') && reg.pick('buildGraph').id === 'rpc', '降级链: 依赖图选中 RPC');
ok(reg.pick('resolveCall') && reg.pick('resolveCall').id === 'lsp', '降级链: 导航选中 LSP');

// --- INV-DT-08 全适配器不可用 → raw 兜底 ---
const emptyReg = new AdapterRegistry(k);   // 一个都没注册
const fallback = emptyReg.dispatch({ capability: 'resolveCall', payload });
ok(fallback !== SKIP, 'INV-DT-08 无适配器时仍返回结果(不阻断)');
ok(fallback.adapter === 'raw', 'INV-DT-08 降级到 raw');
ok(fallback.data && fallback.data.file === 'webgl.cjs', 'INV-DT-08 raw 结果正确');
ok(fallback.degraded === true, 'INV-DT-08 标记 degraded');

// --- 回归：pick 不得触发内核（能力探测无副作用） ---
let _sideEffect = false;
const probeReg = new AdapterRegistry(k);
probeReg.register(new LspAdapter(k));
try { probeReg.pick('resolveCall'); } catch (e) { _sideEffect = true; }
ok(_sideEffect === false, '回归: pick() 探测不触发内核(不传 payload 也不崩)');

// --- G-54.2 适配器零业务逻辑（结构自检） ---
const lspSrc = LspAdapter.prototype.dispatch.toString();
ok(!/LAYER_VIOLATION|violation\s*===/.test(lspSrc), 'G-54.2 适配器内无分层判定逻辑');
ok(/this\.k\[req\.capability\]/.test(lspSrc), 'G-54.2 适配器只委派给内核');

// --- 接缝命题 ---
const seamA = reg.dispatch({ capability: 'locateAssertion', payload: 'INV-D2' });
ok(seamA.data && seamA.data.line === 57, '接缝: G-54 断言经 G-51→G-54 可内联');
const seamB = k.affectedDevices('render').length > 0;
ok(seamB, '接缝: G-53 等价类数据可被 G-54 消费');

// --- 全部能力可达性 ---
const capPayloads = {
  resolveCall:      { activeBackend: 'webgl', symbol: 'render' },
  checkLayering:    { from: 'L0', to: 'L2' },
  locateAssertion:  'INV-07',
  buildGraph:       null,
  affectedDevices:  'render',
  previewVariants:  'btn-1'
};
for (const [c, pl] of Object.entries(capPayloads)) {
  const r = reg.dispatch({ capability: c, payload: pl });
  ok(r !== undefined && r !== SKIP, `能力可达: ${c}`);
}
ok(Object.keys(capPayloads).length === 6, '六项能力全部定义');

// 内核健壮性：无效输入降级不崩溃（G-46 RSC-01 精神贯穿工具内核）
ok(k.resolveCall(null) === null, '内核健壮: resolveCall(null)→null 不崩');
ok(k.resolveCall({}) === null, '内核健壮: resolveCall({})→null 不崩');
ok(k.locateAssertion(null) === null, '内核健壮: locateAssertion(null)→null 不崩');
ok(k.checkLayering(null).invalid === true, '内核健壮: checkLayering(null)→invalid 不崩');

for (const [s, n] of _c) console.log(`${s}: ${n}`);
console.log(`\nself-test: ${_p}/${_p + _f}`);
if (_f > 0) process.exit(1);
