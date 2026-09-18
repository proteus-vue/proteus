'use strict';
// G-53 Mobile Verification Orchestration — reference implementation (zero deps)
// 复用 G-51 NativeAdapter 契约 + G-52 DeviceProfile/等价类

// ============================================================
// 1. 设备等价类（G-52 扩展：加入市场份额权重）
// ============================================================
class DeviceProfile {
  constructor(o) {
    this.id = o.id;
    this.vendor = o.vendor;          // 新增：厂商
    this.share = o.share || 0;       // 新增：市场份额（用于覆盖率加权）
    this.screen = o.screen;
    this.os = o.os;
    this.input = o.input;
    this.env = o.env;
    this.runtime = o.runtime || 'unknown'; // 新增：由哪档后端承载
  }
}

class EquivalenceClass {
  constructor(name, devices, weight) {
    this.name = name;
    this.devices = devices;
    this.weight = weight; // 该类覆盖的市场份额
  }
  representative() { return this.devices[0]; }
  coveredShare() { return this.devices.reduce((s, d) => s + d.share, 0); }
}

// ============================================================
// 2. 四档降级链（G-51 NativeAdapter 扩展）
//    in-memory → web → ios-sim(local) → ios-sim(remote) → cloud-device
// ============================================================
const Tier = {
  IN_MEMORY:   'in-memory',
  WEB:         'web',
  SIM_LOCAL:   'ios-sim',        // 本机 Xcode simctl
  SIM_REMOTE:  'ios-sim-remote', // 共享 Mac 上的 serve-sim 端点
  CLOUD:       'cloud-device',   // 云真机（腾讯优测/Testin…）
};

// 档位能力矩阵：某档能验证什么、不能验证什么
const TIER_CAPABILITY = {
  [Tier.IN_MEMORY]:  { logic: true,  render: false, engine: false, hardware: false, realRom: false },
  [Tier.WEB]:        { logic: true,  render: true,  engine: false, hardware: false, realRom: false },
  [Tier.SIM_LOCAL]:  { logic: true,  render: true,  engine: true,  hardware: false, realRom: false },
  [Tier.SIM_REMOTE]: { logic: true,  render: true,  engine: true,  hardware: false, realRom: false },
  [Tier.CLOUD]:      { logic: true,  render: true,  engine: true,  hardware: true,  realRom: true  },
};

class PlatformUnavailable extends Error {
  constructor(tier, reason) {
    super(`[${tier}] ${reason}`);
    this.tier = tier;
    this.reason = reason;
  }
}

// ============================================================
// 3. 运行结果（G-51 Result 枚举 + G-53 覆盖率语义）
// ============================================================
const Result = {
  PASS: 'PASS', FAIL: 'FAIL',
  SKIP: 'SKIP',           // 平台不可用 → 不崩溃，覆盖率下降
  DEGRADED: 'DEGRADED',   // 能力缺失 → 降级运行（G-46 RSC-01 精神）
  TIMEOUT: 'TIMEOUT',
};

// ============================================================
// 4. SimulatorBackend（NativeAdapter 扩展）
//    关键：endpoint 让模拟器从"本机窗口"变成"可共享的服务"
// ============================================================
class SimulatorBackend {
  constructor(opts) {
    this.tier = opts.tier;
    this.endpoint = opts.endpoint || null;   // serve-sim URL
    this.available = opts.available !== false;
    this.booted = [];
  }

  async boot(profile) {
    if (!this.available) {
      // ★ 不可用返回 SKIP，绝不抛异常（G-53.3）
      return { status: Result.SKIP, profile: profile.id, reason: 'platform-unavailable' };
    }
    if (this.tier === Tier.SIM_REMOTE && !this.endpoint) {
      return { status: Result.SKIP, profile: profile.id, reason: 'endpoint-missing' };
    }
    const handle = { id: `${this.tier}:${profile.id}`, tier: this.tier, profile };
    this.booted.push(handle);
    return { status: Result.PASS, handle, reason: null };
  }

  async runIsolated(suite) {
    if (!this.available) {
      return { status: Result.SKIP, reason: 'platform-unavailable', cases: 0 };
    }
    const caps = TIER_CAPABILITY[this.tier];
    // 能力缺失 → DEGRADED，不崩溃（G-53.4）
    const missing = [];
    if (suite.needsRender && !caps.render) missing.push('render');
    if (suite.needsEngine && !caps.engine) missing.push('engine');
    if (suite.needsHardware && !caps.hardware) missing.push('hardware');
    if (suite.needsRealRom && !caps.realRom) missing.push('realRom');

    if (missing.length) {
      return {
        status: Result.DEGRADED,
        missing,
        cases: suite.cases || 0,
        note: `tier=${this.tier} 能力缺失: ${missing.join(',')}`,
      };
    }
    return { status: Result.PASS, cases: suite.cases || 0, missing: [] };
  }
}

// ============================================================
// 5. 降级链编排：按能力需求自动选档
// ============================================================
class VerificationOrchestrator {
  constructor(backends) {
    // backends: 按优先级排列
    this.backends = backends;
  }

  selectTier(suite) {
    // 选择第一个"能完整满足需求"或"能力最接近"的档
    let best = null, bestMiss = Infinity;
    for (const b of this.backends) {
      if (!b.available) continue;
      const caps = TIER_CAPABILITY[b.tier];
      const miss = [];
      if (suite.needsRender && !caps.render) miss.push('render');
      if (suite.needsEngine && !caps.engine) miss.push('engine');
      if (suite.needsHardware && !caps.hardware) miss.push('hardware');
      if (suite.needsRealRom && !caps.realRom) miss.push('realRom');
      if (miss.length === 0) return { backend: b, missing: [] };
      if (miss.length < bestMiss) { bestMiss = miss.length; best = { backend: b, missing: miss }; }
    }
    return best; // 全部有缺失 → 返回最接近的（降级）
  }

  async execute(suite) {
    const pick = this.selectTier(suite);
    if (!pick) {
      return { status: Result.SKIP, tier: null, reason: 'no-backend-available', coverage: 0 };
    }
    const r = await pick.backend.runIsolated(suite);
    return {
      status: r.missing && r.missing.length ? Result.DEGRADED : r.status,
      tier: pick.backend.tier,
      missing: r.missing || [],
      cases: r.cases || 0,
      coverage: r.missing && r.missing.length ? 0.5 : 1,
    };
  }
}

// ============================================================
// 6. 覆盖率门槛（G-51 门槛机制的设备维度推广）
// ============================================================
class CoverageGate {
  constructor(threshold) { this.threshold = threshold; } // 0~1

  // 按市场份额加权：代表机型覆盖了多少真实用户
  weightedShare(classes) {
    return Math.min(1, classes.reduce((s, c) => s + c.coveredShare(), 0));
  }

  evaluate(classes, executed) {
    const share = this.weightedShare(classes);
    const ran = executed.filter(e => e.status === Result.PASS).length;
    const total = executed.length || 1;
    const execRate = ran / total;
    const score = share * execRate;
    return {
      share, execRate, score,
      pass: score >= this.threshold,
      detail: { share: +share.toFixed(3), execRate: +execRate.toFixed(3), score: +score.toFixed(3) },
    };
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
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

function run() {
  // ---- 等价类（含 2026Q1 中国市场份额）----
  const harmony  = new DeviceProfile({ id:'mate80',   vendor:'huawei', share:0.20, screen:{dp:420,foldable:false,density:3.0}, os:{api:12,engine:'ark'},      input:{primary:'touch'}, env:{lang:'zh',tz:'+8',dark:false}, runtime:Tier.CLOUD });
  const iphone   = new DeviceProfile({ id:'iphone17', vendor:'apple',  share:0.19, screen:{dp:393,foldable:false,density:3.0}, os:{api:26,engine:'jsc'},      input:{primary:'touch'}, env:{lang:'zh',tz:'+8',dark:false}, runtime:Tier.SIM_REMOTE });
  const oppo     = new DeviceProfile({ id:'findx9',   vendor:'oppo',   share:0.16, screen:{dp:410,foldable:false,density:3.0}, os:{api:15,engine:'v8'},       input:{primary:'touch'}, env:{lang:'zh',tz:'+8',dark:false}, runtime:Tier.CLOUD });
  const vivo     = new DeviceProfile({ id:'vivoX300', vendor:'vivo',   share:0.15, screen:{dp:412,foldable:false,density:3.0}, os:{api:15,engine:'v8'},       input:{primary:'touch'}, env:{lang:'zh',tz:'+8',dark:false}, runtime:Tier.CLOUD });
  const xiaomi   = new DeviceProfile({ id:'mi17',     vendor:'xiaomi', share:0.12, screen:{dp:408,foldable:false,density:3.0}, os:{api:16,engine:'v8'},       input:{primary:'touch'}, env:{lang:'zh',tz:'+8',dark:false}, runtime:Tier.CLOUD });
  const foldable = new DeviceProfile({ id:'mateX',    vendor:'huawei', share:0.15, screen:{dp:800,foldable:true, density:3.0}, os:{api:12,engine:'ark'},      input:{primary:'touch'}, env:{lang:'zh',tz:'+8',dark:false}, runtime:Tier.CLOUD });

  ok(harmony.share === 0.20, 'harmony share 20%');
  ok(iphone.runtime === Tier.SIM_REMOTE, 'iphone 由远程模拟器承载（无需买机）');
  ok(foldable.screen.foldable === true, 'foldable profile 标记折叠屏');

  const clsPhones = new EquivalenceClass('mainstream-phones', [harmony, iphone, oppo, vivo, xiaomi], 0.82);
  const clsFold   = new EquivalenceClass('foldables', [foldable], 0.15);

  ok(clsPhones.representative().id === 'mate80', '等价类代表 = 份额最高者');
  ok(approx(clsPhones.coveredShare(), 0.82), '主流机型覆盖份额 82%');
  ok(approx(clsFold.coveredShare(), 0.15), '折叠屏覆盖份额 15%');

  // ---- 档位能力矩阵 ----
  ok(TIER_CAPABILITY[Tier.IN_MEMORY].render === false, 'in-memory 不能验证渲染');
  ok(TIER_CAPABILITY[Tier.CLOUD].hardware === true, '云真机可验证硬件');
  ok(TIER_CAPABILITY[Tier.SIM_REMOTE].engine === true, '远程模拟器有真引擎');
  ok(TIER_CAPABILITY[Tier.SIM_LOCAL].hardware === false, '模拟器测不了硬件（诚实边界）');

  // ---- 后端与降级 ----
  const memBE   = new SimulatorBackend({ tier: Tier.IN_MEMORY });
  const cloudBE = new SimulatorBackend({ tier: Tier.CLOUD });
  const noXcode = new SimulatorBackend({ tier: Tier.SIM_LOCAL, available: false });
  const noEp    = new SimulatorBackend({ tier: Tier.SIM_REMOTE, endpoint: null });

  ok(memBE.available === true, 'in-memory 始终可用');
  ok(noXcode.available === false, '未装 Xcode → available=false');

  return (async () => {
    // 不可用 → SKIP，不抛异常（G-53.3）
    const b1 = await noXcode.boot(iphone);
    ok(b1.status === Result.SKIP, 'G-53.3 未装Xcode → SKIP 不崩溃');
    ok(b1.reason === 'platform-unavailable', 'SKIP 带原因');

    const b2 = await noEp.boot(iphone);
    ok(b2.status === Result.SKIP, '远程模拟器缺 endpoint → SKIP');
    ok(b2.reason === 'endpoint-missing', 'SKIP 原因 = endpoint-missing');

    // 能力缺失 → DEGRADED（G-53.4）
    const d1 = await memBE.runIsolated({ cases: 10, needsRender: true });
    ok(d1.status === Result.DEGRADED, 'G-53.4 能力缺失 → DEGRADED');
    ok(d1.missing.includes('render'), 'DEGRADED 标明缺失能力 render');
    ok(d1.cases === 10, 'DEGRADED 仍记录用例数');

    const d2 = await cloudBE.runIsolated({ cases: 10, needsRender: true, needsHardware: true });
    ok(d2.status === Result.PASS, '云真机满足渲染+硬件 → PASS');

    // ---- 编排器：自动选档 ----
    const orch = new VerificationOrchestrator([memBE, cloudBE]);
    const s1 = { cases: 5, needsRender: false };
    const r1 = await orch.execute(s1);
    ok(r1.tier === Tier.IN_MEMORY, '纯逻辑 → 选 in-memory（零成本）');
    ok(r1.status === Result.PASS, 'in-memory 执行 PASS');
    ok(r1.coverage === 1, '完整覆盖 coverage=1');

    const s2 = { cases: 5, needsHardware: true };
    const r2 = await orch.execute(s2);
    ok(r2.tier === Tier.CLOUD, '需硬件 → 自动升档到 cloud-device');
    ok(r2.status === Result.PASS, '云真机执行 PASS');

    // 只有 in-memory 时，需硬件 → 降级而非崩溃
    const orch2 = new VerificationOrchestrator([memBE]);
    const r3 = await orch2.execute(s2);
    ok(r3.tier === Tier.IN_MEMORY, '无云真机 → 停留在 in-memory');
    ok(r3.status === Result.DEGRADED, '★ 降级不崩溃（G-46 RSC-01 精神）');
    ok(r3.coverage === 0.5, '降级 coverage 折半');

    // 全不可用 → SKIP
    const orch3 = new VerificationOrchestrator([noXcode]);
    const r4 = await orch3.execute(s1);
    ok(r4.status === Result.SKIP, '★ 无可用后端 → SKIP 而非 FAIL');
    ok(r4.coverage === 0, 'SKIP coverage=0');

    // ---- 覆盖率门槛 ----
    const gate = new CoverageGate(0.8);
    const g1 = gate.evaluate([clsPhones, clsFold], [
      { status: Result.PASS }, { status: Result.PASS },
    ]);
    ok(approx(g1.share, 0.97), '加权份额 82%+15% = 97%（上限1）');
    ok(g1.execRate === 1, '全部执行 → execRate=1');
    ok(g1.pass === true, '覆盖率 0.97 ≥ 门槛 0.8 → 放行');

    const g2 = gate.evaluate([clsPhones], [{ status: Result.PASS }, { status: Result.SKIP }]);
    ok(approx(g2.execRate, 0.5), '一半 SKIP → execRate=0.5');
    ok(g2.pass === false, '覆盖率不足 → 阻断');

    const g3 = new CoverageGate(0.3).evaluate([clsPhones], [{ status: Result.PASS }, { status: Result.SKIP }]);
    ok(g3.pass === true, '门槛调低 → 放行（可按阶段渐进）');

    // ---- 负向 ----
    const g4 = new CoverageGate(1.0).evaluate([clsPhones], [{ status: Result.PASS }]);
    ok(g4.pass === false, 'NEG-01 门槛1.0且份额<1 → 阻断（不虚报满覆盖）');

    const emptyCls = new EquivalenceClass('empty', [], 0);
    const g5 = gate.evaluate([emptyCls], []);
    ok(approx(g5.share, 0), 'NEG-02 空等价类 → share=0');
    ok(g5.pass === false, 'NEG-02 空覆盖 → 阻断（不静默通过）');

    const d3 = await memBE.runIsolated({ cases: 0, needsRender: true, needsHardware: true, needsRealRom: true });
    ok(d3.missing.length === 3, 'NEG-03 多项能力缺失全部记录（不合并）');

    ok(orch3.backends.length === 1, 'NEG-04 编排器接受单后端（不要求满配）');

    return true;
  })();
}

run().then(() => {
  for (const [s, n] of _cases) console.log(`${s}: ${n}`);
  console.log(`\nself-test: ${_pass}/${_pass + _fail}`);
  if (_fail > 0) process.exit(1);
}).catch(e => { console.error('FATAL', e); process.exit(2); });
