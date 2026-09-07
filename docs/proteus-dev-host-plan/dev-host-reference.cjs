#!/usr/bin/env node
/**
 * dev-host-reference.cjs —— G-45 调试基座即宿主（Install-Once Host）可运行参考实现
 *
 * 纯 Node 模拟器（零依赖），模拟传统「自定义基座循环」被打破的完整闭环：
 *   1. 基座常驻：DevHost 只认 SPI 不认插件，baseRebuildCount 恒为 0（C-01）
 *   2. 转发桩 pending 语义：后端未装载 → 调用进 pending 队列，禁止同步抛异常（CMP083）
 *   3. 动态装载：插件模块 push → 签名门禁 → conformance 快检 → 注册能力（装载即验证）
 *   4. 就绪回放：装载成功 → pending 调用按序回放，业务零感知（C-02）
 *   5. 热升级：插件 v1 → v2 热替换，JS 侧 stub 不变，调用持续可用（C-03）
 *   6. 拒绝与降级：conformance FAIL / 坏签名 → 拒绝装载 + fallback 降级不崩溃（C-04/C-05）
 *   7. 卸载语义：unload → 调用重回 pending；再装载 → 恢复（C-06）
 *   8. 双层构建缓存：基座 cacheKey 与业务/插件独立——页面 20→150 基座构建 0 次（C-07，CMP086）
 *   9. 语义等价快检：同能力实现必须产出同 shape 结果（C-08，CMP074 思想延伸）
 *  10. 全链可观测：loaded/upgraded/rejected/fallback/pending/replay 事件齐全（C-09/C-10）
 *
 * 运行：node dev-host-reference.cjs            # 演示模式
 *       node dev-host-reference.cjs --self-test # 自检模式（verify.sh 调用）
 */
'use strict';

/* ================= 工具 ================= */

function hashCode(str) {
  // FNV-1a 简化版：稳定 cache key 用
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 语义等价检查：两个值必须产出相同的 JSON shape（键集合递归一致，忽略值） */
function shapeOf(v) {
  if (v === null || typeof v !== 'object') return typeof v;
  if (Array.isArray(v)) return v.length ? [shapeOf(v[0])] : [];
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = shapeOf(v[k]);
  return out;
}
function shapeEquals(a, b) {
  return JSON.stringify(shapeOf(a)) === JSON.stringify(shapeOf(b));
}

/** conformance 快检用例工厂：结果 shape 契约（CMP074 思想：同语义同 shape） */
function checkResultShape(capability, method, sampleArgs, shapeContract) {
  return {
    name: `${capability}.${method} 结果 shape 契约`,
    async check(backend) {
      const fn = backend[method];
      if (typeof fn !== 'function') return false;
      const result = await fn.apply(backend, sampleArgs);
      return shapeEquals(result, shapeContract);
    },
  };
}

/* ================= ForwardingStub（转发桩，编译器生成形态） ================= */

class ForwardingStub {
  constructor(host, capability, method) {
    this.host = host;
    this.capability = capability;
    this.method = method;
    this.pendingCount = 0;
    this.directCalls = 0;
  }

  /** 业务调用唯一入口。后端就绪 → 直调；未就绪 → pending（G-45.2 禁止同步抛异常） */
  call(...args) {
    const target = this.host._resolve(this.capability);
    if (target) {
      this.directCalls++;
      return this.host._invoke(target, this.method, args);
    }
    return new Promise((resolve, reject) => {
      this.host._pendings.push({
        capability: this.capability,
        method: this.method,
        args,
        resolve,
        reject,
        seq: ++this.host._seq,
        at: Date.now(),
      });
      this.pendingCount = this.host._pendings.length;
      this.host._emit('stub:pending', {
        capability: this.capability,
        method: this.method,
        pendingCount: this.host._pendings.length,
      });
    });
  }
}

/* ================= DevHost（调试基座：Install-Once Host） ================= */

class DevHost {
  constructor(opts = {}) {
    this._modules = new Map(); // id -> { manifest, module, report }
    this._caps = new Map(); // capability -> { id, version, source }
    this._fallbacks = new Map(); // capability -> degraded impl（内置兜底）
    this._pendings = [];
    this._stubs = new Map();
    this._events = [];
    this._seq = 0;
    this._metrics = {
      loadedModules: 0,
      rejectedModules: 0,
      upgrades: 0,
      unloads: 0,
      replayedTotal: 0,
      fallbacks: 0,
      pendingPeak: 0,
    };
    this.createdAt = Date.now();
    this.baseRebuildCount = 0; // ★ 基座重打次数：动态装载路径下恒为 0
    this.quiet = !!opts.quiet;
  }

  _emit(type, payload) {
    this._events.push({ type, payload, at: Date.now() });
  }

  onEvent(type) {
    return this._events.filter((e) => e.type === type);
  }

  /** 内置降级后端：能力缺失/装载失败时兜底（降级不崩溃，对齐 L3→L2→L1→solid 铁律） */
  registerFallback(capability, impl) {
    this._fallbacks.set(capability, impl);
  }

  /** 编译器为业务生成的转发桩（useNative().scanQR() 的运行时形态） */
  createStub(capability, method) {
    const key = `${capability}.${method}`;
    if (!this._stubs.has(key)) {
      this._stubs.set(key, new ForwardingStub(this, capability, method));
    }
    return this._stubs.get(key);
  }

  _resolve(capability) {
    const rec = this._caps.get(capability);
    if (!rec) return null;
    const entry = this._modules.get(rec.id);
    return { manifest: entry.manifest, module: entry.module };
  }

  _invoke(target, method, args) {
    const backend = target.module.factory({ host: this });
    const fn = backend[method];
    if (typeof fn !== 'function') {
      return Promise.reject(
        new Error(`G45_METHOD_MISSING: ${target.manifest.id}.${method}`)
      );
    }
    return Promise.resolve().then(() => fn.apply(backend, args));
  }

  _fallbackInvoke(capability, method, args) {
    const impl = this._fallbacks.get(capability);
    this._metrics.fallbacks++;
    this._emit('fallback', { capability, method, reason: 'backend-unavailable' });
    if (!impl) {
      return Promise.reject(new Error(`G45_NO_FALLBACK: ${capability}`));
    }
    return Promise.resolve().then(() => impl.apply(null, args));
  }

  /**
   * 动态装载插件模块（模拟 dev server push）。
   * 门禁链：manifest 完整性 → 签名 → conformance 覆盖率 → conformance 快检 → 注册 → 回放。
   */
  async loadModule(mod) {
    const m = mod.manifest || {};
    const report = {
      id: m.id || null,
      version: m.version || null,
      ok: false,
      reason: null,
      conformance: [],
      replayed: 0,
    };

    // 门禁 1：manifest 完整性（CMP084）
    if (!m.id || !m.version || !Array.isArray(m.capabilities) || m.capabilities.length === 0) {
      report.reason = 'G45_MANIFEST_INCOMPLETE';
      this._metrics.rejectedModules++;
      this._emit('module:rejected', report);
      return report;
    }

    // 门禁 2：签名（CMP084，与 G-42 安全网关同源）
    if (typeof m.signature !== 'string' || !/^sig-[a-z0-9]+$/.test(m.signature)) {
      report.reason = 'G45_SIGN';
      this._metrics.rejectedModules++;
      this._emit('module:rejected', report);
      return report;
    }

    // 门禁 3：conformance 覆盖率——每能力至少一例（CMP087）
    if (!Array.isArray(mod.conformance) || mod.conformance.length < m.capabilities.length) {
      report.reason = 'G45_CONFORMANCE_COVERAGE';
      this._metrics.rejectedModules++;
      this._emit('module:rejected', report);
      return report;
    }

    // 门禁 4：装载即验证（CMP085）——任一 FAIL 拒绝装载
    let backend;
    try {
      backend = mod.factory({ host: this });
    } catch (e) {
      report.reason = `G45_FACTORY_THROWN: ${e.message}`;
      this._metrics.rejectedModules++;
      this._emit('module:rejected', report);
      return report;
    }
    for (const c of mod.conformance) {
      let pass = false;
      let detail = '';
      try {
        pass = await c.check(backend);
      } catch (e) {
        detail = e.message;
      }
      report.conformance.push({ name: c.name, pass });
      if (!pass) {
        report.reason = `G45_CONFORMANCE_FAIL: ${c.name}${detail ? ` (${detail})` : ''}`;
        this._metrics.rejectedModules++;
        this._emit('module:rejected', report);
        this._drainPendingToFallback(m.capabilities);
        return report;
      }
    }

    // 装载 / 热升级
    const existing = this._modules.get(m.id);
    if (existing) {
      this._metrics.upgrades++;
      this._emit('module:upgraded', { id: m.id, from: existing.manifest.version, to: m.version });
    } else {
      this._metrics.loadedModules++;
    }
    this._modules.set(m.id, { manifest: m, module: mod, report });
    for (const cap of m.capabilities) {
      this._caps.set(cap, { id: m.id, version: m.version, source: 'dynamic' });
    }
    this._emit('module:loaded', { id: m.id, version: m.version, capabilities: m.capabilities });

    // 就绪回放：pending 调用按 seq 序回放（CMP083 的另一半）
    report.replayed = this._replayPending(m.capabilities);
    report.ok = true;
    return report;
  }

  /** 卸载：能力退回 pending 语义（等待再推送），已注册 stub 调用不断（C-06） */
  unloadModule(id) {
    const entry = this._modules.get(id);
    if (!entry) return false;
    for (const cap of entry.manifest.capabilities) {
      // 只清本模块占用的能力（升级场景下同能力可能被新版本占用）
      const rec = this._caps.get(cap);
      if (rec && rec.id === id) this._caps.delete(cap);
    }
    this._modules.delete(id);
    this._metrics.unloads++;
    this._emit('module:unloaded', { id });
    return true;
  }

  capabilityOf(cap) {
    return this._caps.get(cap) || null;
  }

  listBackends() {
    return [...this._modules.values()].map((e) => ({
      id: e.manifest.id,
      version: e.manifest.version,
      capabilities: e.manifest.capabilities,
    }));
  }

  getMetrics() {
    return {
      ...this._metrics,
      pendingNow: this._pendings.length,
      baseRebuildCount: this.baseRebuildCount,
      uptimeMs: Date.now() - this.createdAt,
      events: this._events.length,
    };
  }

  /* ---- 内部：pending 管理 ---- */

  _replayPending(capabilities) {
    const mine = this._pendings.filter((p) => capabilities.includes(p.capability));
    if (!mine.length) return 0;
    this._pendings = this._pendings.filter((p) => !capabilities.includes(p.capability));
    for (const p of mine) {
      const target = this._resolve(p.capability);
      this._invoke(target, p.method, p.args).then(p.resolve, p.reject);
      this._metrics.replayedTotal++;
      this._emit('stub:replay', {
        capability: p.capability,
        method: p.method,
        waitedMs: Date.now() - p.at,
        seq: p.seq,
      });
    }
    return mine.length;
  }

  /** 装载失败时：该能力的 pending 调用转内置降级后端（降级不崩溃） */
  _drainPendingToFallback(capabilities) {
    const mine = this._pendings.filter((p) => capabilities.includes(p.capability));
    if (!mine.length) return;
    this._pendings = this._pendings.filter((p) => !capabilities.includes(p.capability));
    for (const p of mine) {
      this._fallbackInvoke(p.capability, p.method, p.args).then(p.resolve, p.reject);
    }
  }
}

function createDevHost(opts) {
  return new DevHost(opts);
}

/* ================= 双层构建计划器（C-07：构建时间随改动而非规模伸缩） ================= */

class BuildCache {
  constructor() {
    this._built = new Map(); // cacheKey -> builtAt
    this.buildCounts = { base: 0, js: 0, plugin: 0 };
  }

  /** 命中缓存返回 skip；未命中 build 并记账。cacheKey 层间独立（CMP086） */
  plan(layer, cacheKey) {
    if (this._built.has(cacheKey)) {
      return { layer, cacheKey, action: 'skip' };
    }
    this._built.set(cacheKey, Date.now());
    this.buildCounts[layer] = (this.buildCounts[layer] || 0) + 1;
    return { layer, cacheKey, action: 'build' };
  }
}

/**
 * 双层产物构建计划：
 *   base  cacheKey = f(框架版本, ABI)         —— 与页面数/插件无关
 *   js    cacheKey = f(业务源码哈希)           —— 增量
 *   plugin cacheKey = f(插件id, 插件版本)      —— 每插件独立
 */
function planBuild(cache, state) {
  return {
    base: cache.plan('base', `base:${state.frameworkVersion}:${state.abi}`),
    js: cache.plan('js', `js:${state.jsHash}`),
    plugins: Object.entries(state.pluginVersions).map(([id, ver]) => ({
      id,
      ...cache.plan('plugin', `plugin:${id}:${ver}`),
    })),
  };
}

/* ================= 自检（verify.sh 调用） ================= */

async function selfTest() {
  const results = [];
  const check = (id, name, cond, detail) => {
    results.push({ id, name, pass: !!cond, detail: detail || '' });
    console.log(`${cond ? 'PASS' : 'FAIL'} ${id} ${name}${cond ? '' : ` —— ${detail || '条件不成立'}`}`);
  };

  /* 场景搭建：模拟 dev server + 插件开发循环 */
  const host = createDevHost({ quiet: true });
  host.registerFallback('scanQR', async () => ({ text: null, degraded: true, reason: 'backend-not-loaded' }));
  host.registerFallback('takePhoto', async () => ({ path: null, degraded: true, reason: 'backend-not-loaded' }));

  // C-01 基座常驻：DevHost 创建即就绪，业务可立刻生成 stub
  const stub = host.createStub('scanQR', 'scanQR');
  check('C-01', '基座常驻可独立启动（Install-Once）', !!stub && host.baseRebuildCount === 0, 'stub/baseRebuildCount 异常');

  // C-02 转发桩 pending → 装载 → 回放
  const p1 = stub.call({ format: 'qr' });
  const m0 = host.getMetrics();
  const modV1 = {
    manifest: { id: 'scanner', version: '1.0.0', capabilities: ['scanQR'], signature: 'sig-abc123' },
    conformance: [checkResultShape('scanQR', 'scanQR', [{ format: 'qr' }], { text: 'string' })],
    factory: () => ({ scanQR: async () => ({ text: 'CODE-123' }) }),
  };
  const rep1 = await host.loadModule(modV1);
  const r1 = await p1;
  const m1 = host.getMetrics();
  check(
    'C-02',
    '未装载调用进 pending，装载后按序回放',
    m0.pendingNow === 1 && rep1.ok === true && rep1.replayed === 1 && r1.text === 'CODE-123' && m1.replayedTotal === 1,
    `pending=${m0.pendingNow} replayed=${rep1.replayed} r1=${JSON.stringify(r1)}`
  );

  // C-02b 装载后调用直通（不再 pending）
  const r2 = await stub.call({ format: 'qr' });
  check('C-02b', '装载后调用直通后端', r2.text === 'CODE-123', `r2=${JSON.stringify(r2)}`);

  // C-03 热升级：v1 → v2，stub 对象不变，语义结果更新
  const modV2 = {
    manifest: { id: 'scanner', version: '2.0.0', capabilities: ['scanQR'], signature: 'sig-abc123' },
    conformance: [checkResultShape('scanQR', 'scanQR', [{ format: 'qr' }], { text: 'string' })],
    factory: () => ({ scanQR: async () => ({ text: 'CODE-V2' }) }),
  };
  const rep2 = await host.loadModule(modV2);
  const r3 = await stub.call({ format: 'qr' });
  const m2 = host.getMetrics();
  check(
    'C-03',
    '插件热升级（零基座重打、零 JS 重启）',
    rep2.ok === true && m2.upgrades === 1 && r3.text === 'CODE-V2' && host.baseRebuildCount === 0,
    `upgrades=${m2.upgrades} r3=${JSON.stringify(r3)}`
  );

  // C-04 装载即验证：conformance FAIL → 拒绝 + pending 转 fallback（降级不崩溃）
  const badMod = {
    manifest: { id: 'badcam', version: '1.0.0', capabilities: ['takePhoto'], signature: 'sig-abc123' },
    conformance: [checkResultShape('takePhoto', 'takePhoto', [], { path: 'string' })],
    factory: () => ({ takePhoto: async () => ({ code: 7 }) }), // shape 错误
  };
  const pBad = host.createStub('takePhoto', 'takePhoto').call();
  const repBad = await host.loadModule(badMod);
  const rBad = await pBad;
  check(
    'C-04',
    'conformance FAIL 拒绝装载 + pending 转降级',
    repBad.ok === false && /G45_CONFORMANCE_FAIL/.test(repBad.reason) && rBad.degraded === true,
    `reason=${repBad.reason} rBad=${JSON.stringify(rBad)}`
  );

  // C-05 签名门禁：坏签名/缺签名拒绝（装载前置）
  const noSig = {
    manifest: { id: 'evil', version: '1.0.0', capabilities: ['scanQR'], signature: 'hacked' },
    conformance: [checkResultShape('scanQR', 'scanQR', [{}], { text: 'string' })],
    factory: () => ({ scanQR: async () => ({ text: 'x' }) }),
  };
  const repSig = await host.loadModule(noSig);
  check('C-05', '坏签名模块拒绝装载（能力注册表不被污染）', repSig.ok === false && repSig.reason === 'G45_SIGN' && host.capabilityOf('scanQR').version === '2.0.0', `reason=${repSig.reason}`);

  // C-05b conformance 覆盖率：每能力至少一例（CMP087）
  const noCases = {
    manifest: { id: 'lazy', version: '1.0.0', capabilities: ['useNFC'], signature: 'sig-abc123' },
    conformance: [],
    factory: () => ({}),
  };
  const repCover = await host.loadModule(noCases);
  check('C-05b', 'conformance 覆盖率不足拒绝装载', repCover.ok === false && repCover.reason === 'G45_CONFORMANCE_COVERAGE', `reason=${repCover.reason}`);

  // C-06 卸载语义：unload → 调用重回 pending；再装载恢复
  const unloadOk = host.unloadModule('scanner');
  const pRe = stub.call({ format: 'qr' });
  const mRe = host.getMetrics();
  const repRe = await host.loadModule(modV2);
  const rRe = await pRe;
  check(
    'C-06',
    '卸载后调用重回 pending，再装载即恢复',
    unloadOk === true && mRe.pendingNow === 1 && repRe.ok === true && rRe.text === 'CODE-V2' && host.capabilityOf('scanQR').source === 'dynamic',
    `pending=${mRe.pendingNow} replayed=${repRe.replayed}`
  );

  // C-07 双层构建缓存：页面 20→80→150 + 插件迭代，基座构建恒为 1 次
  const cache = new BuildCache();
  const s1 = planBuild(cache, { frameworkVersion: 'v1.0', abi: 'arm64', jsHash: 'src-r1', pluginVersions: { scanner: '2.0.0' } });
  const s2 = planBuild(cache, { frameworkVersion: 'v1.0', abi: 'arm64', jsHash: 'src-r2', pluginVersions: { scanner: '2.0.0' } });
  const s3 = planBuild(cache, { frameworkVersion: 'v1.0', abi: 'arm64', jsHash: 'src-r3', pluginVersions: { scanner: '3.0.0' } });
  const counts = cache.buildCounts;
  check(
    'C-07',
    '基座 cacheKey 与业务规模/插件独立（构建 O(改动) 非 O(规模)）',
    s1.base.action === 'build' && s2.base.action === 'skip' && s3.base.action === 'skip' && counts.base === 1 && counts.js === 3 && counts.plugin === 2,
    `base=${counts.base} js=${counts.js} plugin=${counts.plugin}`
  );

  // C-08 语义等价快检：同能力两实现必须同 shape（CMP074 思想）
  const shapeContract = { text: 'string' };
  const caseA = checkResultShape('scanQR', 'scanQR', [{}], shapeContract);
  const mockImpl = { scanQR: async () => ({ text: 'MOCK' }) };
  const nativeImpl = { scanQR: async () => ({ text: 'REAL' }) };
  const eqA = await caseA.check(mockImpl);
  const eqB = await caseA.check(nativeImpl);
  const eqBad = await caseA.check({ scanQR: async () => ({ code: 1 }) });
  check('C-08', '语义等价快检：mock/native 同 shape 过、异 shape 拒', eqA && eqB && !eqBad, `A=${eqA} B=${eqB} bad=${eqBad}`);

  // C-09 能力注册表可查询
  const list = host.listBackends();
  const cap = host.capabilityOf('scanQR');
  check(
    'C-09',
    '能力注册表可查询（capability → backend/version/source）',
    list.length >= 1 && list.some((b) => b.id === 'scanner' && b.version === '2.0.0') && cap && cap.id === 'scanner' && cap.source === 'dynamic',
    `list=${JSON.stringify(list)} cap=${JSON.stringify(cap)}`
  );

  // C-10 全链事件可观测
  const types = new Set(host._events.map((e) => e.type));
  const need = ['stub:pending', 'module:loaded', 'module:upgraded', 'module:rejected', 'fallback', 'module:unloaded', 'stub:replay'];
  const missing = need.filter((t) => !types.has(t));
  check('C-10', '装载/升级/拒绝/降级/回放事件全链可观测', missing.length === 0, `missing=${missing.join(',')}`);

  // 汇总
  const pass = results.filter((r) => r.pass).length;
  console.log(`\nG-45 dev-host self-test: ${pass}/${results.length} PASS`);
  if (pass !== results.length) process.exit(1);
}

/* ================= 演示模式 ================= */

async function demo() {
  console.log('G-45 调试基座即宿主 —— Install-Once Host 演示\n');

  const host = createDevHost();
  host.registerFallback('scanQR', async () => ({ text: null, degraded: true, reason: 'backend-not-loaded' }));

  // 1) 业务先写好（转发桩由编译器生成）
  const stub = host.createStub('scanQR', 'scanQR');
  console.log('[1] 业务调用 scanQR（原生插件还没推送）——进 pending');
  const p = stub.call({ format: 'qr' });

  // 2) dev server 推送插件模块 v1
  console.log('[2] dev server push scanner@1.0.0 —— 装载即验证 → 回放 pending');
  const rep = await host.loadModule({
    manifest: { id: 'scanner', version: '1.0.0', capabilities: ['scanQR'], signature: 'sig-abc123' },
    conformance: [checkResultShape('scanQR', 'scanQR', [{ format: 'qr' }], { text: 'string' })],
    factory: () => ({ scanQR: async () => ({ text: 'CODE-123' }) }),
  });
  console.log(`    load report: ok=${rep.ok} replayed=${rep.replayed}`);
  console.log(`    业务拿到结果（零重启零重打）:`, await p);

  // 3) 插件改了 → push v2 热升级
  console.log('[3] 插件改动 → push scanner@2.0.0 —— 热升级');
  await host.loadModule({
    manifest: { id: 'scanner', version: '2.0.0', capabilities: ['scanQR'], signature: 'sig-abc123' },
    conformance: [checkResultShape('scanQR', 'scanQR', [{ format: 'qr' }], { text: 'string' })],
    factory: () => ({ scanQR: async () => ({ text: 'CODE-V2' }) }),
  });
  console.log('    业务再调:', await stub.call({ format: 'qr' }));

  // 4) 构建计划：页面翻了 7 倍，基座重打 0 次
  const cache = new BuildCache();
  planBuild(cache, { frameworkVersion: 'v1.0', abi: 'arm64', jsHash: 'r1', pluginVersions: { scanner: '2.0.0' } });
  planBuild(cache, { frameworkVersion: 'v1.0', abi: 'arm64', jsHash: 'r2', pluginVersions: { scanner: '2.0.0' } });
  planBuild(cache, { frameworkVersion: 'v1.0', abi: 'arm64', jsHash: 'r3', pluginVersions: { scanner: '2.0.0' } });
  console.log('[4] 构建计划（20 → 80 → 150 页 + 插件两轮迭代）:', JSON.stringify(cache.buildCounts), '—— base 恒为 1 次首建，之后全 skip');

  const m = host.getMetrics();
  console.log('\nmetrics:', JSON.stringify(m));
  console.log('\n★ 传统循环：改插件 → 云打包基座（分钟级）→ 安装 → 验证 → 再改');
  console.log('★ G-45 循环：改插件 → push（秒级）→ 装载即验证 → pending 回放 —— 基座 0 次重打');
}

/* ================= 入口 ================= */

if (require.main === module) {
  if (process.argv.includes('--self-test')) {
    selfTest().catch((e) => {
      console.error('self-test crashed:', e);
      process.exit(1);
    });
  } else {
    demo().catch((e) => {
      console.error('demo crashed:', e);
      process.exit(1);
    });
  }
}

module.exports = {
  createDevHost,
  DevHost,
  ForwardingStub,
  BuildCache,
  planBuild,
  checkResultShape,
  shapeOf,
  shapeEquals,
  hashCode,
};
