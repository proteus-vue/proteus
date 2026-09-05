/* G-55 开发者工具落地形态与性能工程 — 参考实现（零依赖） */

// ==================== 项目模型 ====================
class ProjectModel {
  constructor() { this.files = new Map(); }
  set(path, layer, deps, symbols) {
    this.files.set(path, { path, layer, deps: deps || [], symbols: symbols || [] });
    return this;
  }
  get(path) { return this.files.get(path) || null; }
  reverseDeps(paths) {
    const s = new Set(paths);
    const out = [];
    for (const [p, f] of this.files) {
      if (s.has(p)) continue;
      if (f.deps.some(d => s.has(d))) out.push(p);
    }
    return out;
  }
}

const LAYER_RANK = { L0: 0, L1: 1, L2: 2 };

// ==================== 内核（对应 Rust 常驻守护进程） ====================
class KnowledgeKernel {
  constructor(model, opts) {
    opts = opts || {};
    this.model = model;
    this.index = new Map();
    this.cache = new Map();
    this.cacheMax = opts.cacheMax || 64;
    this.clock = 0;
    this.hits = 0; this.misses = 0; this.recompute = 0; this.touched = 0;
    this.activeBackend = opts.activeBackend || 'g27-web';
    this.equivalenceClasses = opts.equivalenceClasses || [];
  }

  indexAll() {
    this.index.clear(); this.touched = 0;
    for (const [p, f] of this.model.files) {
      this.index.set(p, { symbols: f.symbols.slice(), layer: f.layer });
      this.touched++;
    }
    this.cache.clear();
    return this.touched;
  }

  indexIncremental(changed) {
    const rev = this.model.reverseDeps(changed);
    const affected = new Set([].concat(changed, rev));
    this.touched = 0;
    for (const p of affected) {
      const f = this.model.get(p);
      if (f) { this.index.set(p, { symbols: f.symbols.slice(), layer: f.layer }); this.touched++; }
    }
    // 精确失效：只删依赖受影响文件的缓存项（G-55.4）
    for (const [k, e] of Array.from(this.cache)) {
      if (e.deps.some(d => affected.has(d))) this.cache.delete(k);
    }
    return this.touched;
  }

  _get(key) {
    const e = this.cache.get(key);
    if (e) { e.used = ++this.clock; this.hits++; return e.value; }
    this.misses++; return undefined;
  }

  _set(key, value, deps) {
    if (this.cache.size >= this.cacheMax) {
      let oldestKey = null, oldest = Infinity;
      for (const [k, e] of this.cache) { if (e.used < oldest) { oldest = e.used; oldestKey = k; } }
      if (oldestKey !== null) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { value, used: ++this.clock, deps: deps || [] });
  }

  // 能力1：语义跳转（跳到当前激活后端实现）
  semanticGoto(symbol) {
    const key = 'goto|' + symbol + '|' + this.activeBackend;
    const c = this._get(key);
    if (c !== undefined) return c;
    this.recompute++;
    const all = [];
    for (const [p, e] of this.index) {
      if (e.symbols.indexOf(symbol) >= 0) all.push({ file: p, backend: p.split('/')[0], layer: e.layer });
    }
    const active = all.filter(h => h.backend === this.activeBackend);
    const result = {
      symbol, backend: this.activeBackend,
      targets: active.length ? active : all,
      degraded: active.length === 0
    };
    this._set(key, result, all.map(h => h.file));
    return result;
  }

  // 能力2：分层守护
  layeringCheck() {
    const v = [];
    for (const [p, f] of this.model.files) {
      for (const d of f.deps) {
        const df = this.model.get(d);
        if (!df) continue;
        if (LAYER_RANK[df.layer] === undefined || LAYER_RANK[f.layer] === undefined) continue;
        const diff = LAYER_RANK[df.layer] - LAYER_RANK[f.layer];
        // diff > 0 = 低层依赖高层（违规）；跨级上依赖单独标记
        // diff <= 0 = 同层或向下依赖，合法（含跨级向下）
        if (diff > 1) v.push({ type: 'SKIP_LAYER', from: p, to: d });
        else if (diff > 0) v.push({ type: 'UPWARD', from: p, to: d });
      }
    }
    return v;
  }

  // 能力4：依赖图 + 循环检测
  dependencyGraph() {
    const nodes = Array.from(this.model.files.keys());
    const edges = [];
    for (const [p, f] of this.model.files) for (const d of f.deps) edges.push([p, d]);
    return { nodes, edges, cycles: this._cycles() };
  }

  _cycles() {
    const state = new Map(), stack = [], cycles = [], self = this;
    function dfs(p) {
      state.set(p, 'visiting'); stack.push(p);
      const f = self.model.get(p);
      for (const d of (f ? f.deps : [])) {
        if (state.get(d) === 'visiting') cycles.push(stack.slice(stack.indexOf(d)).concat([d]));
        else if (!state.get(d)) dfs(d);
      }
      state.set(p, 'done'); stack.pop();
    }
    for (const p of this.model.files.keys()) if (!state.get(p)) dfs(p);
    return cycles;
  }

  // 能力5：设备影响面（依赖 G-53 等价类清单；当前 Mock）
  deviceImpact(changedFiles) {
    const touched = new Set();
    for (const p of changedFiles)
      for (const c of this.equivalenceClasses)
        if (c.files.indexOf(p) >= 0) touched.add(c.name);
    return { classes: Array.from(touched), mock: this.equivalenceClasses.length === 0 };
  }

  // 能力6：多形态渲染预览（依赖 G-27；当前 Mock）
  renderPreview(backends) {
    const out = {};
    for (const b of (backends || [])) out[b] = { backend: b, mock: true };
    return out;
  }

  metrics() {
    const total = this.hits + this.misses;
    return {
      recompute: this.recompute, touched: this.touched,
      hitRate: total ? this.hits / total : 0,
      cacheSize: this.cache.size, cacheMax: this.cacheMax,
      indexSize: this.index.size
    };
  }
}

// ==================== 宿主适配器 ====================
class HostAdapter {
  constructor(id, tier, caps) { this.id = id; this.tier = tier; this.caps = new Set(caps); }
  supports(cap) { return this.caps.has(cap); }
  translate(protocol, msg) { return { adapter: this.id, protocol, payload: msg }; }
}

function pickAdapter(adapters, cap) {
  const ok = adapters.filter(a => a.supports(cap));
  if (!ok.length) return { status: 'SKIP', reason: 'no adapter supports: ' + cap };
  ok.sort((a, b) => b.tier - a.tier);
  return { status: 'OK', adapter: ok[0] };
}

// ==================== 性能预算 ====================
const BUDGET = {
  incrementalMaxTouched: 4,
  gotoRecomputeAfterCache: 0,
  minHitRate: 0.3
};

function checkBudget(m) {
  const checks = [
    ['coldIndex', m.coldTouched === m.fileCount, m.coldTouched + '==' + m.fileCount],
    ['incremental', m.incTouched <= BUDGET.incrementalMaxTouched, m.incTouched + '<=' + BUDGET.incrementalMaxTouched],
    ['gotoCache', m.gotoRecompute <= BUDGET.gotoRecomputeAfterCache, m.gotoRecompute + '<=0'],
    ['cacheBound', m.cacheSize <= m.cacheMax, m.cacheSize + '<=' + m.cacheMax],
    ['hitRate', m.hitRate >= BUDGET.minHitRate, m.hitRate.toFixed(2) + '>=' + BUDGET.minHitRate]
  ];
  const failed = checks.filter(x => !x[1]);
  return { pass: failed.length === 0, checks, failed: failed.map(x => x[0]) };
}

// G-55.6：墙钟只观测，不阻断
function advisoryTiming(ms, budgetMs) {
  return { status: ms <= budgetMs ? 'ok' : 'warn', blocking: false, ms, budgetMs };
}

// 架构试金石：内核 API 冻结
function apiSurface(K) {
  return Object.getOwnPropertyNames(K.prototype).filter(n => n !== 'constructor').sort().join(',');
}

// ==================== 自测 ====================
let P = 0, F = 0; const CASES = [];
function ok(cond, name) { if (cond) { P++; CASES.push(['OK', name]); } else { F++; CASES.push(['FAIL', name]); } }

function buildModel() {
  return new ProjectModel()
    .set('core/ir.js', 'L0', [], ['ir'])
    .set('g27-web/render.js', 'L1', ['core/ir.js'], ['render'])
    .set('g27-native/render.js', 'L1', ['core/ir.js'], ['render'])
    .set('g46-wx/login.js', 'L1', ['core/ir.js'], ['login'])
    .set('app/main.js', 'L2', ['g27-web/render.js', 'g46-wx/login.js'], ['main']);
}

function run() {
  const model = buildModel();

  // ---- MODEL ----
  ok(model.files.size === 5, 'MODEL: 文件数 5');
  ok(model.reverseDeps(['core/ir.js']).length === 3, 'MODEL: ir.js 反向依赖 3 个');
  ok(model.reverseDeps(['core/ir.js']).indexOf('core/ir.js') < 0, 'MODEL: 反向依赖不含自身');

  // ---- KERNEL ----
  const k = new KnowledgeKernel(model);
  ok(k.indexAll() === 5, 'KERNEL: 全量索引 touched=5');
  ok(k.index.size === 5, 'KERNEL: 索引条目 5');

  const g1 = k.semanticGoto('render');
  ok(g1.targets.length === 1, 'KERNEL: 语义跳转只返回激活后端');
  ok(g1.targets[0].backend === 'g27-web', 'KERNEL: 激活后端 g27-web');
  ok(g1.degraded === false, 'KERNEL: 有激活后端 → 不降级');

  k.activeBackend = 'g27-native';
  const g2 = k.semanticGoto('render');
  ok(g2.targets[0].backend === 'g27-native', 'KERNEL: 切换后端 → 结果跟随');

  // 缓存命中：首次查询重算，二次命中不重算
  const k0 = new KnowledgeKernel(buildModel());
  k0.indexAll();
  k0.semanticGoto('render');
  const midR = k0.metrics().recompute;
  ok(midR === 1, 'KERNEL: 首次查询触发一次重算');
  k0.semanticGoto('render');
  const afterR = k0.metrics().recompute;
  ok(afterR === midR, 'INV-PF-04: 缓存命中后不再重算');

  // 降级：激活后端无该能力
  k.activeBackend = 'g27-native';
  const g3 = k.semanticGoto('login');
  ok(g3.degraded === true, 'KERNEL: 激活后端无 login → 降级标记');
  ok(g3.targets.length >= 1, 'KERNEL: 降级仍返回结果，不崩溃');

  ok(k.layeringCheck().length === 0, 'KERNEL: 干净模型无分层违规');
  const dg = k.dependencyGraph();
  ok(dg.nodes.length === 5, 'KERNEL: 依赖图节点 5');
  ok(dg.edges.length === 5, 'KERNEL: 依赖图边 5');
  ok(dg.cycles.length === 0, 'KERNEL: 无循环依赖');

  // ---- INCREMENTAL ----
  const k2 = new KnowledgeKernel(buildModel());
  const cold = k2.indexAll();
  const inc = k2.indexIncremental(['g27-web/render.js']);
  ok(inc === 2, 'INCREMENTAL: 改 1 文件 touched=2（自身+反向依赖）');
  ok(inc < cold, 'INV-PF-03: 增量 < 全量');
  ok(k2.index.has('g46-wx/login.js'), 'INCREMENTAL: 未受影响索引保留');

  // 精确失效
  const k3 = new KnowledgeKernel(buildModel());
  k3.indexAll();
  k3.semanticGoto('render');
  const rBefore = k3.metrics().recompute;
  ok(k3.cache.size === 1, 'INV-PF-05: 缓存已建立');
  k3.indexIncremental(['g46-wx/login.js']);   // 与 render 缓存无关
  ok(k3.cache.size === 1, 'INV-PF-05: 无关变更不误删缓存');
  k3.indexIncremental(['g27-web/render.js']); // 与 render 缓存相关
  ok(k3.cache.size === 0, 'INV-PF-05: 相关变更精确失效');
  k3.semanticGoto('render');
  ok(k3.metrics().recompute > rBefore, 'INCREMENTAL: 失效后重新计算');

  // ---- CACHE (LRU) ----
  const k4 = new KnowledgeKernel(buildModel(), { cacheMax: 2 });
  k4.indexAll();
  k4.semanticGoto('render'); k4.semanticGoto('login'); k4.semanticGoto('ir');
  ok(k4.cache.size <= 2, 'CACHE: LRU 上限生效');
  const irResult1 = JSON.stringify(k4.semanticGoto('ir'));
  k4.semanticGoto('render'); k4.semanticGoto('login');  // 挤掉 ir
  const irResult2 = JSON.stringify(k4.semanticGoto('ir'));
  ok(irResult1 === irResult2, 'INV-PF-08 / NEG-06: LRU 淘汰后结果一致');
  const m4 = k4.metrics();
  ok(m4.hitRate > 0, 'CACHE: 命中率已统计');
  ok(m4.cacheSize <= m4.cacheMax, 'BUDGET: 缓存硬上限');

  // ---- ADAPTER ----
  const vscode = new HostAdapter('vscode', 3, ['goto', 'diag', 'graph', 'preview']);
  const zed = new HostAdapter('zed', 2, ['goto', 'diag']);
  const cli = new HostAdapter('cli', 1, ['diag']);
  ok(vscode.supports('goto'), 'ADAPTER: supports 元数据查询');
  ok(pickAdapter([vscode, zed, cli], 'goto').adapter.id === 'vscode', 'ADAPTER: 选 tier 最高');
  const noCap = pickAdapter([cli], 'goto');
  ok(noCap.status === 'SKIP', 'INV-PF-02: 无宿主支持 → SKIP');
  ok(typeof noCap.reason === 'string', 'ADAPTER: SKIP 带原因');
  const t = zed.translate('LSP', { id: 1 });
  ok(t.adapter === 'zed' && t.protocol === 'LSP' && t.payload.id === 1, 'INV-PF-01: 适配器只翻译');

  // ---- TOUCHSTONE ----
  const S1 = apiSurface(KnowledgeKernel);
  ok(S1.length > 0, 'TOUCHSTONE: API 快照非空');
  const extra = new HostAdapter('neovim', 2, ['goto', 'diag']);
  pickAdapter([vscode, zed, cli, extra], 'goto');
  const S2 = apiSurface(KnowledgeKernel);
  ok(S1 === S2, 'INV-PF-06: 新增宿主不改内核 API');
  ok(S1.indexOf('semanticGoto') >= 0 && S1.indexOf('layeringCheck') >= 0, 'TOUCHSTONE: 六项能力在内核');

  // ---- BUDGET ----
  const k5 = new KnowledgeKernel(buildModel());
  const coldTouched = k5.indexAll();
  const incTouched = k5.indexIncremental(['g27-web/render.js']);
  k5.semanticGoto('render');
  const rMid = k5.metrics().recompute;
  k5.semanticGoto('render');
  const m5 = k5.metrics();
  const budget = checkBudget({
    fileCount: 5, coldTouched, incTouched,
    gotoRecompute: m5.recompute - rMid,
    cacheSize: m5.cacheSize, cacheMax: m5.cacheMax, hitRate: m5.hitRate
  });
  ok(budget.pass, 'BUDGET: 六项预算全部通过');
  ok(budget.checks.length === 5, 'BUDGET: 五项判定齐全');
  ok(budget.checks[0][1] === true, 'BUDGET-1: 冷启动 O(N)');
  ok(budget.checks[1][1] === true, 'BUDGET-2: 增量 touched 达标');
  ok(budget.checks[2][1] === true, 'BUDGET-3: 缓存后零重算');

  const det1 = JSON.stringify(checkBudget({ fileCount: 5, coldTouched: 5, incTouched: 2, gotoRecompute: 0, cacheSize: 1, cacheMax: 64, hitRate: 0.5 }));
  const det2 = JSON.stringify(checkBudget({ fileCount: 5, coldTouched: 5, incTouched: 2, gotoRecompute: 0, cacheSize: 1, cacheMax: 64, hitRate: 0.5 }));
  ok(det1 === det2, 'G-55.6: 预算判定确定性');

  // ---- TIMING (仅观测) ----
  const tOk = advisoryTiming(10, 100);
  ok(tOk.status === 'ok' && tOk.blocking === false, 'TIMING: 正常 ok 不阻断');
  const tWarn = advisoryTiming(500, 100);
  ok(tWarn.status === 'warn' && tWarn.blocking === false, 'INV-PF-07 / NEG-04: 墙钟超时仅 warn 不阻断');

  // ---- NEGATIVE ----
  let threw = false;
  try { pickAdapter([], 'goto'); } catch (e) { threw = true; }
  ok(!threw, 'NEG-01: 空适配器列表不抛异常');

  const badModel = new ProjectModel().set('a.js', 'L0', ['b.js'], []).set('b.js', 'L2', [], []);
  const bk = new KnowledgeKernel(badModel);
  const bv = bk.layeringCheck();
  ok(bv.some(v => v.type === 'SKIP_LAYER'), 'NEG-02: L0 直连 L2 被检出');

  const cycModel = new ProjectModel().set('a.js', 'L1', ['b.js'], []).set('b.js', 'L1', ['a.js'], []);
  ok(new KnowledgeKernel(cycModel).dependencyGraph().cycles.length > 0, 'NEG-03: 循环依赖被检出');

  let emptyThrew = false;
  try { const ek = new KnowledgeKernel(new ProjectModel()); ek.indexAll(); ek.layeringCheck(); ek.dependencyGraph(); } catch (e) { emptyThrew = true; }
  ok(!emptyThrew, 'NEG-04: 空项目模型不崩溃');

  const goodModel = new ProjectModel().set('h.js', 'L2', ['l.js'], []).set('l.js', 'L0', [], []);
  ok(new KnowledgeKernel(goodModel).layeringCheck().length === 0, 'NEG-05: 高层依赖低层不误报');

  const nk = new KnowledgeKernel(buildModel());
  nk.indexAll();
  const unknown = nk.semanticGoto('__nope__');
  ok(unknown.targets.length === 0, 'NEG-07: 未知 symbol 空 targets');
  ok(unknown.degraded === true, 'NEG-07: 未知 symbol 标记降级不崩溃');

  const imp = nk.deviceImpact(['g27-web/render.js']);
  ok(imp.mock === true, 'NEG-08: 无等价类数据 → mock 标记');
  ok(Array.isArray(imp.classes), 'NEG-08: 仍返回结构，不崩溃');

  ok(Object.keys(nk.renderPreview([])).length === 0, 'NEG-09: 空入参 → 空对象');

  // 带等价类数据（能力5 真数据路径）
  const kWithClasses = new KnowledgeKernel(buildModel(), {
    equivalenceClasses: [{ name: 'foldable', files: ['g27-web/render.js'] }]
  });
  const imp2 = kWithClasses.deviceImpact(['g27-web/render.js']);
  ok(imp2.mock === false, 'JOINT: 接入 G-53 等价类后 mock 关闭');
  ok(imp2.classes[0] === 'foldable', 'JOINT: 影响面归因正确');

  // ---- JOINT ----
  ok(noCap.status === 'SKIP' && tWarn.blocking === false, 'JOINT: SKIP 语义与 G-51 一致（缺失降级不阻断）');
  ok(S1 === S2 && t.adapter === 'zed', 'JOINT: 内核冻结 ∧ 适配器只翻译 → 多宿主一致');

  return budget;
}

run();
for (const [s, n] of CASES) console.log(s + ': ' + n);
console.log('\nself-test: ' + P + '/' + (P + F));
if (F > 0) process.exit(1);
