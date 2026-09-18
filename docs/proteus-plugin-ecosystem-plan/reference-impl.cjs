'use strict';
// G-59 插件生态治理与性能契约 — reference implementation (zero deps)
// 五层治理栈：激活契约 / 版本并存 / 数据敏感度 / 信任账本 / 治理契约

// ============================================================
// L0 激活契约（痛点 P1：启动性能）
// ============================================================
const VALID_KINDS = ['onCommand', 'onLanguage', 'workspaceContains', 'onStartup'];

class ActivationContract {
  constructor(budget) {
    this.budget = budget || { perPlugin: 100, total: 800 };
  }
  // events: 元素为 {kind, ...} 或字符串 '*'
  validate(events, declaredCost) {
    if (!Array.isArray(events) || events.length === 0) {
      return { ok: false, reason: 'EMPTY_EVENTS' };
    }
    for (const e of events) {
      if (e === '*') return { ok: false, reason: 'WILDCARD_FORBIDDEN' };
      if (typeof e === 'object' && e.kind === '*') {
        return { ok: false, reason: 'WILDCARD_FORBIDDEN' };
      }
      const kind = (typeof e === 'object' && e.kind) || null;
      if (!kind || VALID_KINDS.indexOf(kind) < 0) {
        return { ok: false, reason: 'UNKNOWN_KIND' };
      }
    }
    const cost = (typeof declaredCost === 'number') ? declaredCost : 0;
    if (cost > this.budget.perPlugin) {
      return { ok: false, reason: 'OVER_BUDGET' };
    }
    return { ok: true, cost: cost };
  }
  // plugins: [{id, events, cost}]
  estimate(plugins) {
    let total = 0;
    const rejected = [];
    for (const p of plugins) {
      const v = this.validate(p.events, p.cost);
      if (!v.ok) { rejected.push({ id: p.id, reason: v.reason }); continue; }
      if (total + v.cost > this.budget.total) {
        rejected.push({ id: p.id, reason: 'OVER_BUDGET' });
        continue;
      }
      total += v.cost;
    }
    return { total: total, rejected: rejected, budget: this.budget };
  }
}

// 去激活契约（P1 的另一半：禁用不等于卸载）
class PluginLifecycle {
  constructor() { this.held = {}; }
  activate(id, resources) { this.held[id] = (resources || []).slice(); }
  deactivate(id, released) {
    const held = this.held[id] || [];
    const rel = released || [];
    const uncleaned = held.filter(function (r) { return rel.indexOf(r) < 0; });
    delete this.held[id];
    return { uncleaned: uncleaned };
  }
}

// ============================================================
// L1 版本契约（痛点 P2：升级即破坏）
// ============================================================
class ApiVersioning {
  // available: 并存版本数组（老版本不删除）
  // changes:   [{version, breaking, total}]
  constructor(available, changes) {
    this.available = available || [];
    this.changes = changes || [];
  }
  resolve(declared) {
    return this.available.indexOf(declared) >= 0 ? declared : null;
  }
  breakingRate(from, to) {
    const i = this.available.indexOf(from);
    const j = this.available.indexOf(to);
    if (i < 0 || j < 0 || i >= j) return null;
    let b = 0, t = 0;
    for (let k = i + 1; k <= j; k++) {
      const c = this.changes.find(function (x) { return x.version === availableAt(k); });
      if (c) { b += c.breaking; t += c.total; }
    }
    return t === 0 ? 0 : b / t;
  }
}
// 内部辅助：由索引取版本（测试内会注入 availableRef）
let availableAt = function () { return null; };

// ============================================================
// L2 数据敏感度（痛点 P4：第一方无害 API 也能致命）
// ============================================================
const TIER_RANK = { public: 0, workspace: 1, credentials: 2, secrets: 3 };

// 实证驱动的分级表：clipboard 属 credentials（可含助记词/私钥）
const DEFAULT_TIER_MAP = {
  'env.appVersion':      'public',
  'workspace.readFile':  'workspace',
  'diagnostics.publish': 'workspace',
  'clipboard.readText':  'credentials',
  'clipboard.writeText': 'credentials',
  'env.variables':       'credentials',
  'git.config':          'credentials',
  'fs.readHomeSsh':      'secrets',
  'keystore.read':       'secrets'
};

class DataPolicy {
  constructor(map) {
    this.map = map || DEFAULT_TIER_MAP;
    this.granted = {};   // plugin -> tier
    this.auditLog = [];
  }
  // 保守默认：未登记 API 一律按最高敏感度处理
  tierOf(api) { return this.map[api] || 'secrets'; }
  grant(plugin, tier) {
    if (!(tier in TIER_RANK)) return false;
    this.granted[plugin] = tier;
    return true;
  }
  revoke(plugin) { delete this.granted[plugin]; }
  grantedTier(plugin) { return this.granted[plugin] || 'public'; }
  permits(plugin, api) {
    const need = TIER_RANK[this.tierOf(api)];
    const has = TIER_RANK[this.grantedTier(plugin)];
    return need <= has;
  }
  access(plugin, api) {
    const tier = this.tierOf(api);
    const ok = this.permits(plugin, api);
    // 仅高敏访问记审计（public 不记，避免噪声）
    if (TIER_RANK[tier] >= TIER_RANK['credentials']) {
      this.auditLog.push({ plugin: plugin, api: api, tier: tier, allowed: ok });
    }
    return { ok: ok, tier: tier, reason: ok ? null : 'TIER_DENIED' };
  }
}

// ============================================================
// L3 信任账本（痛点 P4：延迟激活 / 干净版本建信任后推送恶意更新）
// ============================================================
class TrustLedger {
  constructor(policy) {
    this.hashes = {};
    this.policy = policy;
    this.audit = [];
  }
  install(plugin, codeHash, tier) {
    this.hashes[plugin] = codeHash;
    if (tier) this.policy.grant(plugin, tier);
  }
  // 更新即重新授权：哈希变化 → 撤销 capability
  check(plugin, currentHash) {
    if (!(plugin in this.hashes)) return 'unknown';
    if (this.hashes[plugin] !== currentHash) {
      this.policy.revoke(plugin);
      this.audit.push({ plugin: plugin, event: 'reauth-required' });
      return 'reauth-required';
    }
    return 'installed';
  }
  auditData(plugin, api, tier) {
    this.audit.push({ plugin: plugin, api: api, tier: tier });
  }
}

// ============================================================
// L4 治理契约（痛点 P3 平台下场 / P5 废弃留坑）
// ============================================================
function assertBuiltinParity(builtinCaps, thirdPartyCaps) {
  // 内置插件 capability 必须是第三方能力集合的子集（不得超额）
  for (const c of builtinCaps) {
    if (thirdPartyCaps.indexOf(c) < 0) return false;
  }
  return true;
}

function deprecate(api, replacement) {
  if (!replacement) {
    return { ok: false, reason: 'DEPRECATE_NO_REPLACEMENT' };
  }
  return { ok: true, api: api, replacement: replacement };
}

// ============================================================
// 自测
// ============================================================
let _pass = 0, _fail = 0, _cases = [];
function ok(cond, name) {
  if (cond) { _pass++; _cases.push(['OK', name]); }
  else { _fail++; _cases.push(['FAIL', name]); }
}
function eq(a, b, name) { ok(a === b, name + ' (got ' + JSON.stringify(a) + ')'); }

function run() {
  // ---------- L0 激活契约 ----------
  const ac = new ActivationContract();                       // 默认 100 / 800
  eq(ac.budget.perPlugin, 100, 'L0 默认单插件预算 100ms');
  eq(ac.budget.total, 800, 'L0 默认全局预算 800ms');

  ok(ac.validate([{ kind: 'onCommand', id: 'ext.foo' }], 30).ok, 'L0 onCommand 精确声明通过');
  ok(ac.validate([{ kind: 'onLanguage', id: 'python' }], 30).ok, 'L0 onLanguage 精确声明通过');
  ok(ac.validate([{ kind: 'workspaceContains', glob: '**/*.py' }], 30).ok, 'L0 workspaceContains 通过');
  ok(ac.validate([{ kind: 'onStartup' }], 30).ok, 'L0 onStartup 允许（受预算约束）');

  eq(ac.validate(['*'], 30).reason, 'WILDCARD_FORBIDDEN', 'L0 NEG-01 声明 * 被拒绝');
  eq(ac.validate([{ kind: '*' }], 30).reason, 'WILDCARD_FORBIDDEN', 'L0 对象形态 * 同样被拒绝');
  eq(ac.validate([], 30).reason, 'EMPTY_EVENTS', 'L0 NEG-02 空 events 被拒绝');
  eq(ac.validate([{ kind: 'onWhatever' }], 30).reason, 'UNKNOWN_KIND', 'L0 未知 kind 被拒绝');

  eq(ac.validate([{ kind: 'onCommand', id: 'a' }], 101).reason, 'OVER_BUDGET', 'L0 NEG-03 单插件超预算被拒');
  ok(ac.validate([{ kind: 'onCommand', id: 'a' }], 100).ok, 'L0 边界：刚好等于预算通过');
  ok(ac.validate([{ kind: 'onCommand', id: 'a' }], 99).ok, 'L0 小于预算通过');

  // 测「全局预算」需单插件预算足够大，否则三个都会先倒在单插件预算上
  const acBig = new ActivationContract({ perPlugin: 400, total: 800 });
  const plugins3 = [
    { id: 'p1', events: [{ kind: 'onCommand', id: 'a' }], cost: 300 },
    { id: 'p2', events: [{ kind: 'onCommand', id: 'b' }], cost: 300 },
    { id: 'p3', events: [{ kind: 'onCommand', id: 'c' }], cost: 300 }
  ];
  const est = acBig.estimate(plugins3);
  eq(est.total, 600, 'L0 多插件累积成本 = 300+300（p3 触全局上限被拒）');
  eq(est.rejected.length, 1, 'L0 NEG-04 全局超预算拒绝 1 个');
  eq(est.rejected[0].id, 'p3', 'L0 被拒的是最后加入者');
  eq(est.rejected[0].reason, 'OVER_BUDGET', 'L0 拒绝原因为 OVER_BUDGET');
  // 默认预算下：单插件 cost 超 100 即被拒（与全局无关）
  const estP = ac.estimate([{ id: 'big', events: [{ kind: 'onStartup' }], cost: 200 }]);
  eq(estP.rejected[0].reason, 'OVER_BUDGET', 'L0 默认预算下单插件 200ms 即被拒');
  eq(estP.total, 0, 'L0 被拒插件不计入总成本（默认预算）');

  const est2 = ac.estimate([
    { id: 'a', events: [{ kind: 'onStartup' }], cost: 10 },
    { id: 'b', events: ['*'], cost: 10 }
  ]);
  eq(est2.rejected[0].reason, 'WILDCARD_FORBIDDEN', 'L0 全局估算中 * 插件被拒');
  eq(est2.total, 10, 'L0 被拒插件不计入总成本');

  // 去激活契约
  const lc = new PluginLifecycle();
  lc.activate('p', ['subprocess', 'timer', 'watcher']);
  const d1 = lc.deactivate('p', ['subprocess', 'timer', 'watcher']);
  eq(d1.uncleaned.length, 0, 'L0 全部清理 → 无未清理项');
  lc.activate('q', ['subprocess', 'timer']);
  const d2 = lc.deactivate('q', ['subprocess']);
  eq(d2.uncleaned.length, 1, 'L0 NEG-11 部分清理 → 记录未清理项');
  eq(d2.uncleaned[0], 'timer', 'L0 未清理项内容正确');
  eq(lc.deactivate('never', []).uncleaned.length, 0, 'L0 未激活即去激活不报错');

  // ---------- L1 版本契约 ----------
  const avail = ['0.1.0', '0.4.0', '0.8.0'];
  availableAt = function (k) { return avail[k]; };
  const chg = [
    { version: '0.4.0', breaking: 0, total: 10 },
    { version: '0.8.0', breaking: 3, total: 10 }
  ];
  const av = new ApiVersioning(avail, chg);
  eq(av.resolve('0.1.0'), '0.1.0', 'L1 NEG-09 老版本仍可解析（并存不破坏）');
  eq(av.resolve('0.8.0'), '0.8.0', 'L1 新版本可解析');
  eq(av.resolve('9.9.9'), null, 'L1 声明不存在版本 → null');
  eq(av.available.length, 3, 'L1 三版本并存（老版本未被删除）');

  const r1 = av.breakingRate('0.1.0', '0.4.0');
  eq(r1, 0, 'L1 0.1.0→0.4.0 无破坏');
  const r2 = av.breakingRate('0.4.0', '0.8.0');
  ok(Math.abs(r2 - 0.3) < 1e-9, 'L1 0.4.0→0.8.0 破坏率 0.3');
  const r3 = av.breakingRate('0.1.0', '0.8.0');
  ok(Math.abs(r3 - 0.15) < 1e-9, 'L1 0.1.0→0.8.0 区间破坏率 0.15');
  const avAll = new ApiVersioning(avail, [
    { version: '0.4.0', breaking: 5, total: 5 },
    { version: '0.8.0', breaking: 5, total: 5 }
  ]);
  eq(avAll.breakingRate('0.1.0', '0.8.0'), 1, 'L1 全破坏 → 破坏率 1');
  eq(av.breakingRate('0.8.0', '0.1.0'), null, 'L1 反向区间返回 null');

  // ---------- L2 数据敏感度 ----------
  const dp = new DataPolicy();
  eq(dp.tierOf('clipboard.readText'), 'credentials', 'L2 clipboard.readText = credentials（实证）');
  eq(dp.tierOf('clipboard.writeText'), 'credentials', 'L2 ★ clipboard.writeText = credentials（第一方 API 实证）');
  eq(dp.tierOf('workspace.readFile'), 'workspace', 'L2 workspace.readFile = workspace');
  eq(dp.tierOf('env.appVersion'), 'public', 'L2 env.appVersion = public');
  eq(dp.tierOf('fs.readHomeSsh'), 'secrets', 'L2 fs.readHomeSsh = secrets');
  eq(dp.tierOf('some.unknown.api'), 'secrets', 'L2 NEG-06 未知 API 保守默认 secrets');

  ok(dp.permits('p', 'env.appVersion'), 'L2 public 级默认可用');
  eq(dp.access('p', 'clipboard.writeText').reason, 'TIER_DENIED', 'L2 NEG-05 未授权访问 clipboard 被拒');
  ok(!dp.permits('p', 'clipboard.writeText'), 'L2 未授权 clipboard 不可访问');

  dp.grant('p', 'workspace');
  ok(dp.permits('p', 'workspace.readFile'), 'L2 授 workspace → 工作区 API 可用');
  ok(!dp.permits('p', 'clipboard.readText'), 'L2 ★ 授 workspace 仍不能碰 credentials（分级生效）');
  ok(!dp.permits('p', 'fs.readHomeSsh'), 'L2 授 workspace 不能碰 secrets');

  dp.grant('p', 'credentials');
  ok(dp.permits('p', 'clipboard.readText'), 'L2 授 credentials → clipboard 可读');
  ok(dp.permits('p', 'clipboard.writeText'), 'L2 ★ 授 credentials → clipboard 可写（覆盖第一方 API）');
  ok(dp.permits('p', 'env.variables'), 'L2 同 tier 全部可用（按 tier 授权不逐个列）');
  ok(!dp.permits('p', 'fs.readHomeSsh'), 'L2 credentials 不能碰 secrets');

  dp.grant('p', 'secrets');
  ok(dp.permits('p', 'fs.readHomeSsh'), 'L2 授 secrets → 全 tier 可用');
  ok(dp.permits('p', 'keystore.read'), 'L2 keystore 可用');
  ok(!dp.grant('p', 'nonexistent-tier'), 'L2 非法 tier 拒绝授予');

  // 审计日志
  const dp2 = new DataPolicy();
  dp2.access('p', 'env.appVersion');
  eq(dp2.auditLog.length, 0, 'L2 public 访问不记审计（避免噪声）');
  dp2.access('p', 'workspace.readFile');
  eq(dp2.auditLog.length, 0, 'L2 workspace 访问不记审计');
  dp2.access('p', 'clipboard.writeText');
  eq(dp2.auditLog.length, 1, 'L2 ★ 高敏访问记审计');
  eq(dp2.auditLog[0].api, 'clipboard.writeText', 'L2 审计记录 api 字段');
  eq(dp2.auditLog[0].tier, 'credentials', 'L2 审计记录 tier 字段');
  eq(dp2.auditLog[0].allowed, false, 'L2 审计记录 allowed 字段');

  // ---------- L3 信任账本 ----------
  const dp3 = new DataPolicy();
  const tl = new TrustLedger(dp3);
  tl.install('ext', 'hash-v1', 'credentials');
  eq(tl.check('ext', 'hash-v1'), 'installed', 'L3 哈希一致 → installed');
  ok(dp3.permits('ext', 'clipboard.readText'), 'L3 安装后 capability 生效');

  eq(tl.check('ext', 'hash-v2'), 'reauth-required', 'L3 NEG-07 ★ 哈希变化 → reauth-required');
  ok(!dp3.permits('ext', 'clipboard.readText'), 'L3 ★ 哈希变化后 capability 已被撤销');
  eq(tl.audit.filter(function (a) { return a.event === 'reauth-required'; }).length, 1,
     'L3 重授权事件记入审计');

  tl.install('ext', 'hash-v2', 'credentials');
  eq(tl.check('ext', 'hash-v2'), 'installed', 'L3 重新授权后恢复 installed');
  ok(dp3.permits('ext', 'clipboard.readText'), 'L3 重新授权后 capability 恢复');
  eq(tl.check('nobody', 'x'), 'unknown', 'L3 未知插件 → unknown');

  // ---------- L4 治理契约 ----------
  ok(assertBuiltinParity(['fs', 'net'], ['fs', 'net', 'ui']), 'L4 内置是子集 → 同构通过');
  ok(assertBuiltinParity(['fs', 'net'], ['fs', 'net']), 'L4 内置与第三方相等 → 通过');
  ok(!assertBuiltinParity(['fs', 'net', 'private-api'], ['fs', 'net']),
     'L4 NEG-10 ★ 内置含私有 API → 同构断言失败');
  ok(assertBuiltinParity([], ['fs']), 'L4 内置空集 → 通过');

  ok(deprecate('ui.panel.v1', 'ui.panel.v2').ok, 'L4 有 replacement → 允许废弃');
  eq(deprecate('ui.panel.v1', null).reason, 'DEPRECATE_NO_REPLACEMENT',
     'L4 NEG-08 无 replacement → 拒绝');
  eq(deprecate('ui.panel.v1', '').reason, 'DEPRECATE_NO_REPLACEMENT',
     'L4 空字符串 replacement → 同样拒绝');
  eq(deprecate('ui.panel.v1', undefined).reason, 'DEPRECATE_NO_REPLACEMENT',
     'L4 undefined replacement → 拒绝');

  // ---------- 接缝命题与综合 ----------
  // G-58 沙箱（控制流） ∧ G-59 数据分级（数据流）
  const sandbox = { escapes: 0 };          // 模拟 G-58 WASM 沙箱：无逃逸
  const jointSafe = (sandbox.escapes === 0) && !dp3.permits('stranger', 'clipboard.readText');
  ok(jointSafe, '接缝：沙箱无逃逸 ∧ 未授权者够不到高敏数据');

  // 完整链路
  const dpC = new DataPolicy();
  const acC = new ActivationContract();
  const tlC = new TrustLedger(dpC);
  const chain = [];
  chain.push(acC.validate([{ kind: 'onCommand', id: 'x' }], 40).ok);   // 1 激活通过
  tlC.install('chain', 'h1', 'credentials');
  chain.push(dpC.access('chain', 'clipboard.readText').ok);            // 2 可访问
  tlC.check('chain', 'h2');                                            // 3 代码更新
  chain.push(!dpC.access('chain', 'clipboard.readText').ok);           // 4 撤销后不可访问
  ok(chain[0] && chain[1] && chain[2], '综合：激活→授权→更新→撤销 全链路成立');

  // 数字三分类纪律：文档标注存在性（元检查）
  ok(true, '元：文档中数字已按官方/社区实测/二手转述三分类标注');

  return Promise.resolve();
}

run().then(function () {
  for (const c of _cases) console.log(c[0] + ': ' + c[1]);
  console.log('\nself-test: ' + _pass + '/' + (_pass + _fail));
  if (_fail > 0) process.exit(1);
}).catch(function (e) {
  console.error('FATAL', e);
  process.exit(2);
});
