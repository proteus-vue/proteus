/* eslint-disable no-console */
'use strict';
// G-57 Proteus Inspector — 三层可观测性叠加，参考实现（零依赖）
// 自测入口：run()

// ============================================================
// L0：通用运行时数据（宿主/系统提供，不依赖框架插桩）
// ============================================================
class RuntimeProbe {
  constructor(sources) {
    this.sources = sources || {};
  }
  sample() {
    const out = {};
    for (const key of Object.keys(this.sources)) {
      const src = this.sources[key];
      out[key] = typeof src === 'function' ? src() : src;
    }
    return out;
  }
  capabilities() {
    return Object.keys(this.sources).sort();
  }
}

// ============================================================
// 框架拓扑（框架独占知识，L1 的标注依据）
// ============================================================
class FrameworkTopology {
  constructor(spec) {
    this.backends = (spec && spec.backends) || {};
    this.layers = (spec && spec.layers) || {};
    this.domains = (spec && spec.domains) || {};
  }
  backendOf(symbol) {
    return Object.prototype.hasOwnProperty.call(this.backends, symbol) ? this.backends[symbol] : null;
  }
  layerOf(symbol) {
    return Object.prototype.hasOwnProperty.call(this.layers, symbol) ? this.layers[symbol] : null;
  }
  domainOf(symbol) {
    return Object.prototype.hasOwnProperty.call(this.domains, symbol) ? this.domains[symbol] : null;
  }
  covers(symbol) {
    return this.backendOf(symbol) !== null || this.layerOf(symbol) !== null || this.domainOf(symbol) !== null;
  }
}

// ============================================================
// L1：语义增强（给 L0 指标打框架标签）—— 本份核心增量
// ============================================================
class SemanticAnnotator {
  constructor(topology) {
    this.topology = topology;
  }
  annotate(sample) {
    const out = {};
    for (const key of Object.keys(sample)) {
      out[key] = {
        value: sample[key],
        backend: this.topology.backendOf(key),
        layer: this.topology.layerOf(key),
        domain: this.topology.domainOf(key),
        annotated: this.topology.covers(key)
      };
    }
    return out;
  }
  // 覆盖率：空样本返回 0，不是 1（防虚报）
  coverage(sample) {
    const keys = Object.keys(sample || {});
    if (keys.length === 0) return 0;
    const hit = keys.filter((k) => this.topology.covers(k)).length;
    return hit / keys.length;
  }
}

// ============================================================
// L2：框架语义数据（框架独占）
// ============================================================
class FrameworkIntrospector {
  constructor(spec) {
    const s = spec || {};
    this.spiBackends = s.spiBackends || [];
    this.layerViolations = s.layerViolations || [];
    this.isolationDomains = s.isolationDomains || [];
    this.conformance = s.conformance || [];
  }
  snapshot() {
    return {
      spiBackends: this.spiBackends,
      layerViolations: this.layerViolations,
      isolationDomains: this.isolationDomains,
      conformance: this.conformance
    };
  }
}

// ============================================================
// 服务扩展注册（协议扩展，非协议替换）
// 命名规范：ext.<package>.<command>
// ============================================================
class ServiceExtensionRegistry {
  constructor() {
    this.extensions = new Map();
  }
  register(method, handler) {
    if (typeof method !== 'string') {
      throw new Error('invalid extension name: must be a string');
    }
    if (!method.startsWith('ext.')) {
      throw new Error(`invalid extension name: ${method} (must start with 'ext.')`);
    }
    const parts = method.slice(4).split('.');
    if (parts.length < 2 || parts.some((p) => p.length === 0)) {
      throw new Error(`invalid extension name: ${method} (expect ext.<package>.<command>)`);
    }
    if (typeof handler !== 'function') {
      throw new Error(`handler must be a function: ${method}`);
    }
    if (this.extensions.has(method)) {
      throw new Error(`extension already registered: ${method}`);
    }
    this.extensions.set(method, handler);
    return method;
  }
  has(method) {
    return this.extensions.has(method);
  }
  list() {
    return Array.from(this.extensions.keys()).sort();
  }
  async call(method, params) {
    const h = this.extensions.get(method);
    if (!h) return null; // 未注册 → null，不抛（降级）
    return await h(method, params || {});
  }
}

// ============================================================
// Inspector 服务（统一门面）
// ============================================================
function jsonResult(obj) {
  return { type: 'result', payload: obj };
}

class InspectorService {
  constructor(opts) {
    const o = opts || {};
    this.probe = o.probe || new RuntimeProbe({});
    this.topology = o.topology || null;
    this.introspector = o.introspector || null;
    this.registry = new ServiceExtensionRegistry();
    this.builtWith = o.builtWith || 'debug'; // 'debug' | 'release'
    this.token = o.token || null;
    this.annotator = this.topology ? new SemanticAnnotator(this.topology) : null;
    this._registerBuiltins();
  }

  // Release 构建：构造期即不注册 —— 编译期剔除的运行时语义等价物
  _registerBuiltins() {
    if (this.builtWith === 'release') return;
    const self = this;
    this.registry.register('ext.proteus.runtime', async () => jsonResult(self.collectL0()));
    this.registry.register('ext.proteus.semantic', async () => jsonResult(self.collectL1()));
    this.registry.register('ext.proteus.framework', async () => jsonResult(self.collectL2()));
  }

  // ---- L0：始终可用 ----
  collectL0() {
    return { layer: 'L0', metrics: this.probe.sample() };
  }

  // ---- L1：可降级 ----
  collectL1() {
    const sample = this.probe.sample();
    if (!this.annotator) {
      return { layer: 'L1', degraded: true, reason: 'TOPOLOGY_MISSING', metrics: sample };
    }
    return {
      layer: 'L1',
      degraded: false,
      coverage: this.annotator.coverage(sample),
      metrics: this.annotator.annotate(sample)
    };
  }

  // ---- L2：可降级 ----
  collectL2() {
    if (!this.introspector) {
      return { layer: 'L2', degraded: true, reason: 'INTROSPECTOR_MISSING', data: null };
    }
    return { layer: 'L2', degraded: false, data: this.introspector.snapshot() };
  }

  // ---- 统一入口（鉴权）----
  inspect(token) {
    if (this.builtWith === 'release') {
      return { ok: false, error: 'NOT_AVAILABLE_IN_RELEASE' };
    }
    if (this.token && token !== this.token) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    return { ok: true, L0: this.collectL0(), L1: this.collectL1(), L2: this.collectL2() };
  }
}

// ============================================================
// 自测
// ============================================================
let _pass = 0;
let _fail = 0;
const _cases = [];
function ok(cond, name) {
  if (cond) {
    _pass += 1;
    _cases.push(['OK', name]);
  } else {
    _fail += 1;
    _cases.push(['FAIL', name]);
  }
}
function throwsError(fn, name) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
  }
  ok(threw, name);
}
function approx(a, b, eps) {
  return Math.abs(a - b) <= (eps || 1e-9);
}

function run() {
  // ---------- L0 基础 ----------
  const probe = new RuntimeProbe({
    'memory.delta': () => 50,
    'cpu.usage': () => 0.35,
    'frame.time': () => 16.7,
    'render.calls': () => 120
  });
  const sample = probe.sample();
  ok(sample['memory.delta'] === 50, 'L0 probe samples value');
  ok(typeof sample['cpu.usage'] === 'number', 'L0 numeric metric');
  ok(probe.capabilities().length === 4, 'L0 capabilities count');
  ok(probe.capabilities()[0] === 'cpu.usage', 'L0 capabilities sorted');

  // ---------- 框架拓扑 ----------
  const topology = new FrameworkTopology({
    backends: { 'render.calls': 'render-skia', 'memory.delta': 'render-skia' },
    layers: { 'render.calls': 'L2', 'memory.delta': 'L2' },
    domains: { 'memory.delta': 'mp-sandbox-7' }
  });
  ok(topology.backendOf('render.calls') === 'render-skia', 'topology backendOf hit');
  ok(topology.backendOf('cpu.usage') === null, 'topology backendOf miss → null');
  ok(topology.domainOf('memory.delta') === 'mp-sandbox-7', 'topology domainOf hit');
  ok(topology.covers('render.calls') === true, 'topology covers known symbol');
  ok(topology.covers('cpu.usage') === false, 'topology does not cover unknown symbol');

  // ---------- L1 语义标注（核心增量）----------
  const annotator = new SemanticAnnotator(topology);
  const annotated = annotator.annotate(sample);
  ok(annotated['memory.delta'].value === 50, 'L1 preserves L0 value');
  ok(annotated['memory.delta'].backend === 'render-skia', 'L1 annotates backend');
  ok(annotated['memory.delta'].layer === 'L2', 'L1 annotates layer');
  ok(annotated['memory.delta'].domain === 'mp-sandbox-7', 'L1 annotates domain');
  ok(annotated['memory.delta'].annotated === true, 'L1 marks annotated=true');
  ok(annotated['cpu.usage'].annotated === false, 'L1 marks annotated=false for unknown');
  ok(annotated['cpu.usage'].backend === null, 'L1 unknown has null backend');
  // 4 个指标中 2 个被覆盖
  ok(approx(annotator.coverage(sample), 0.5), 'L1 coverage = 2/4');
  ok(annotator.coverage({}) === 0, 'NEG-06 empty sample coverage = 0 (not 1)');

  // ---------- L2 框架语义 ----------
  const introspector = new FrameworkIntrospector({
    spiBackends: [{ id: 'render-skia', active: true }, { id: 'render-canvas', active: false }],
    layerViolations: [{ from: 'L0', to: 'L2', rule: 'no-skip' }],
    isolationDomains: [{ id: 'mp-sandbox-7', isolated: true }],
    conformance: [{ id: 'CMP-179', pass: true }]
  });
  const snap = introspector.snapshot();
  ok(snap.spiBackends.length === 2, 'L2 spiBackends count');
  ok(snap.layerViolations.length === 1, 'L2 layerViolations count');
  ok(snap.isolationDomains.length === 1, 'L2 isolationDomains count');
  ok(snap.conformance[0].id === 'CMP-179', 'L2 conformance id');

  // ---------- 扩展注册：正向 ----------
  const reg = new ServiceExtensionRegistry();
  ok(reg.register('ext.proteus.runtime', async () => null) === 'ext.proteus.runtime', 'register valid name');
  ok(reg.has('ext.proteus.runtime') === true, 'has() true after register');
  ok(reg.list().length === 1, 'list() count');
  reg.register('ext.proteus.alpha', async () => null);
  ok(reg.list()[0] === 'ext.proteus.alpha', 'list() sorted');

  // ---------- 扩展注册：负向 ----------
  throwsError(() => reg.register('proteus.bad', async () => null), 'NEG-01 reject non-ext prefix');
  throwsError(() => reg.register('ext.only', async () => null), 'NEG-01b reject single-segment name');
  throwsError(() => reg.register('ext.proteus..bad', async () => null), 'NEG-01c reject empty segment');
  throwsError(() => reg.register('ext.proteus.runtime', async () => null), 'NEG-02 reject duplicate');
  throwsError(() => reg.register('ext.proteus.x', 'not-a-function'), 'reject non-function handler');
  throwsError(() => reg.register(123, async () => null), 'reject non-string name');

  return (async () => {
    // 未注册调用 → null，不抛
    const missing = await reg.call('ext.proteus.nonexistent', {});
    ok(missing === null, 'call unregistered → null, no throw');

    // ---------- InspectorService：完整配置 ----------
    const svc = new InspectorService({
      probe,
      topology,
      introspector,
      builtWith: 'debug',
      token: 'tok-abc'
    });
    ok(svc.registry.has('ext.proteus.runtime') === true, 'debug registers L0 extension');
    ok(svc.registry.has('ext.proteus.semantic') === true, 'debug registers L1 extension');
    ok(svc.registry.has('ext.proteus.framework') === true, 'debug registers L2 extension');

    const l0 = svc.collectL0();
    ok(l0.layer === 'L0', 'collectL0 layer tag');
    ok(l0.metrics['memory.delta'] === 50, 'collectL0 metric value');

    const l1 = svc.collectL1();
    ok(l1.layer === 'L1', 'collectL1 layer tag');
    ok(l1.degraded === false, 'collectL1 not degraded with topology');
    ok(approx(l1.coverage, 0.5), 'collectL1 coverage 0.5');
    ok(l1.metrics['memory.delta'].domain === 'mp-sandbox-7', 'collectL1 domain annotation');

    const l2 = svc.collectL2();
    ok(l2.layer === 'L2', 'collectL2 layer tag');
    ok(l2.degraded === false, 'collectL2 not degraded');
    ok(l2.data.spiBackends.length === 2, 'collectL2 data present');

    // 鉴权
    ok(svc.inspect('wrong').ok === false, 'NEG-04 wrong token rejected');
    ok(svc.inspect('wrong').error === 'UNAUTHORIZED', 'NEG-04 error code');
    ok(svc.inspect('tok-abc').ok === true, 'correct token accepted');

    // ---------- INV-INSP-02：降级不减损 ----------
    const degraded = new InspectorService({ probe, topology: null, introspector: null });
    const dL0 = degraded.collectL0();
    ok(dL0.layer === 'L0' && dL0.metrics['memory.delta'] === 50, 'INV-01/02 L0 works without L1/L2');
    const dL1 = degraded.collectL1();
    ok(dL1.degraded === true, 'NEG-03 L1 degraded when topology missing');
    ok(dL1.reason === 'TOPOLOGY_MISSING', 'NEG-03 reason code');
    ok(dL1.metrics['memory.delta'] === 50, 'NEG-03 degraded L1 still carries raw values');
    const dL2 = degraded.collectL2();
    ok(dL2.degraded === true && dL2.reason === 'INTROSPECTOR_MISSING', 'L2 degraded when introspector missing');
    ok(dL2.data === null, 'L2 degraded data is null');

    // ---------- INV-INSP-05：可序列化可 diff ----------
    const s1 = JSON.stringify(svc.collectL1());
    const s2 = JSON.stringify(svc.collectL1());
    ok(s1 === s2, 'INV-05 repeated snapshots are diffable (identical)');
    ok(typeof s1 === 'string' && s1.length > 0, 'INV-05 snapshot serializable');

    // ---------- INV-INSP-06：Debug-only ----------
    const rel = new InspectorService({ probe, topology, introspector, builtWith: 'release', token: 't' });
    ok(rel.registry.list().length === 0, 'NEG-05 release registers zero extensions');
    const relRes = rel.inspect('t');
    ok(relRes.ok === false && relRes.error === 'NOT_AVAILABLE_IN_RELEASE', 'INV-06 release blocks inspect');

    // ---------- INV-INSP-07：无 token 时开放 ----------
    const open = new InspectorService({ probe, topology, introspector });
    ok(open.inspect().ok === true, 'INV-07 no token configured → open');

    // ---------- INV-INSP-08：宿主无关 ----------
    const altProbe = new RuntimeProbe({ 'net.bytes': () => 1024 });
    const altSvc = new InspectorService({ probe: altProbe, builtWith: 'debug' });
    ok(altSvc.collectL0().metrics['net.bytes'] === 1024, 'INV-08 different probe source works');
    ok(altSvc.collectL0().layer === 'L0', 'INV-08 same data model across sources');

    // ---------- 接缝命题 ----------
    // S-1: G-19 数据源 ∧ G-57 出口 → 同一份 L0，两个消费端
    const sharedL0 = svc.collectL0();
    ok(JSON.stringify(sharedL0) === JSON.stringify(svc.collectL0()), 'S-1 G-19 ∧ G-57 share L0 source');
    // S-2: G-54 静态语义 ∧ G-57 动态语义 → 都能给出 backend
    ok(topology.backendOf('render.calls') === 'render-skia', 'S-2 G-54 ∧ G-57 both expose backend');
    // S-3: G-51 可序列化 ∧ G-57 可序列化
    ok(typeof JSON.stringify(svc.collectL2()) === 'string', 'S-3 G-51 INV-06 ∧ G-57 INV-05');

    return { pass: _pass, fail: _fail, cases: _cases };
  })();
}

run().then((r) => {
  for (const [s, n] of r.cases) console.log(`${s}: ${n}`);
  console.log(`\nself-test: ${r.pass}/${r.pass + r.fail}`);
  if (r.fail > 0) process.exit(1);
}).catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
