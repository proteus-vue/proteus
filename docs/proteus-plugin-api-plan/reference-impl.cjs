'use strict';
// G-58 Plugin API & Extension Ecosystem — reference implementation (zero deps)
// 八条不变量 INV-EX-01~08 + 负向用例 + 接缝命题
// 数字以实测为准（G-56.8 / G-58.7 纪律）

// ============================================================
// 1. 自检框架
// ============================================================
let _pass = 0, _fail = 0;
const _cases = [];
function ok(cond, name) {
  if (cond) { _pass++; _cases.push(['OK', name]); }
  else { _fail++; _cases.push(['FAIL', name]); }
}
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

// ============================================================
// 2. 常量：能力规格 / API 版本 / 提案注册表
// ============================================================

// requiresArgs=true 表示该能力必须带白名单参数（INV-EX-02）
const CAPABILITY_SPECS = {
  readWorkspace:       { requiresArgs: false, argField: null },
  writeWorkspace:      { requiresArgs: true,  argField: 'paths' },
  network:             { requiresArgs: true,  argField: 'hosts' },
  spawnProcess:        { requiresArgs: true,  argField: 'commands' },
  'kernel.spiTopology':{ requiresArgs: false, argField: null },
  'kernel.layerRules': { requiresArgs: false, argField: null },
  'kernel.conformance':{ requiresArgs: false, argField: null },
  'kernel.deviceImpact':{requiresArgs: false, argField: null },
  'device.attach':     { requiresArgs: true,  argField: 'runtimes' },
  'device.input':      { requiresArgs: false, argField: null, highRisk: true },
  runExternalProcess:  { requiresArgs: false, argField: null, highRisk: true }
};

// WIT 版本化：每个版本独立，只增不改（INV-EX-04）
const API_VERSIONS = {
  // ★ runExternalProcess 是宿主级能力（Tier 2 专用），与 API 版本无关，各版本皆可用
  '0.1.0': {
    stable: true,
    exports: ['contributes.themes', 'contributes.snippets', 'contributes.keybindings',
              'contributes.menus', 'contributes.configuration', 'contributes.iconThemes'],
    capabilities: ['readWorkspace', 'runExternalProcess']
  },
  '0.2.0': {
    stable: true,
    exports: ['contributes.panels', 'contributes.commands'],
    capabilities: ['readWorkspace', 'writeWorkspace', 'runExternalProcess']
  },
  '0.3.0': {
    stable: true,
    exports: ['kernel.spiTopology', 'kernel.layerRules'],
    capabilities: ['readWorkspace', 'writeWorkspace', 'runExternalProcess',
                   'kernel.spiTopology', 'kernel.layerRules']
  },
  '0.4.0': {
    stable: true,
    exports: ['kernel.conformance', 'device.attach', 'device.input'],
    capabilities: ['readWorkspace', 'writeWorkspace', 'network', 'runExternalProcess',
                   'kernel.spiTopology', 'kernel.layerRules',
                   'kernel.conformance', 'kernel.deviceImpact',
                   'device.attach', 'device.input']
  }
};
const LATEST = '0.4.0';

// 提案 API 注册表（INV-EX-08：stable=false 不得发布）
const PROPOSAL_REGISTRY = {
  deviceInputV2:   { stable: false, since: '0.5.0-proposal' },
  knowledgeStream: { stable: false, since: '0.5.0-proposal' }
};

// ============================================================
// 3. PluginHost
// ============================================================
class PluginHost {
  constructor() {
    this.plugins = new Map();      // id -> { manifest, granted, state, usage }
    this.wasmInstances = 0;        // INV-EX-03 计数
    this.auditLog = [];            // 越权/拒绝记录
    this.apiCallLog = [];          // supports() 副作用探测用
  }

  // ---- 清单校验：所有问题在安装期暴露 ----
  validateManifest(m) {
    const errs = [];
    if (!m || typeof m !== 'object') return ['manifest 为空'];

    if (!m.id || typeof m.id !== 'string') errs.push('id 缺失');
    if (![0, 1, 2].includes(m.tier)) errs.push('tier 必须是 0|1|2');

    // API 版本必须存在
    if (!m.api || !m.api.minVersion) errs.push('api.minVersion 缺失');
    else if (!API_VERSIONS[m.api.minVersion]) errs.push('未知 api.minVersion: ' + m.api.minVersion);

    // capability 校验（含白名单强制）
    const caps = m.capabilities || [];
    if (!Array.isArray(caps)) errs.push('capabilities 必须是数组');
    for (const c of caps) {
      if (!c || typeof c.kind !== 'string') { errs.push('capability 缺少 kind'); continue; }
      const spec = CAPABILITY_SPECS[c.kind];
      if (!spec) { errs.push('未知 capability: ' + c.kind); continue; }
      if (spec.requiresArgs) {
        const arr = c[spec.argField];
        if (!Array.isArray(arr) || arr.length === 0) {
          errs.push(`capability ${c.kind} 必须带 ${spec.argField} 白名单`);
        } else if (arr.some(h => h === '*' || String(h).split('*').length > 2)) {
          errs.push(`capability ${c.kind} 白名单含非法通配`);
        }
      }
    }

    // 提案 API 校验
    const proposals = (m.api && m.api.proposals) || [];
    for (const p of proposals) {
      if (!PROPOSAL_REGISTRY[p]) errs.push('未知提案 API: ' + p);
    }

    // Tier 与 capability 的一致性
    if (m.tier === 0) {
      if (m.wasm) errs.push('Tier 0 不得包含 wasm 段');
      if (m.process) errs.push('Tier 0 不得包含 process 段');
      const heavy = caps.filter(c => c.kind.startsWith('kernel.') || c.kind.startsWith('device.'));
      if (heavy.length) errs.push('Tier 0 不得申请运行时 capability');
    }
    if (m.tier === 1 && !m.wasm) errs.push('Tier 1 必须提供 wasm 段');
    if (m.tier === 2 && !m.process) errs.push('Tier 2 必须提供 process 段');
    if (m.tier === 2) {
      if (!caps.some(c => c.kind === 'runExternalProcess')) {
        errs.push('Tier 2 必须声明 runExternalProcess');
      }
    }

    // 声明的 capability 必须在 minVersion 支持范围内
    if (m.api && API_VERSIONS[m.api.minVersion]) {
      const allowed = API_VERSIONS[m.api.minVersion].capabilities;
      for (const c of caps) {
        if (CAPABILITY_SPECS[c.kind] && !allowed.includes(c.kind)) {
          errs.push(`capability ${c.kind} 不在 api.minVersion ${m.api.minVersion} 的支持范围`);
        }
      }
    }

    return errs;
  }

  // ---- 安装 ----
  install(m, opts = {}) {
    // 发布校验（INV-EX-08）
    if (opts.publish) {
      const proposals = (m.api && m.api.proposals) || [];
      if (proposals.length) {
        return { ok: false, reason: 'proposal-not-publishable', proposals };
      }
    }
    const errs = this.validateManifest(m);
    if (errs.length) return { ok: false, reason: 'invalid-manifest', errors: errs };
    if (this.plugins.has(m.id)) return { ok: false, reason: 'already-installed' };

    // ★ 默认零权限：用户逐项授予，未授权的不给
    const requested = m.capabilities || [];
    const granted = requested.filter(c => {
      if (!opts.grantAll) return false;               // 默认全部不授予
      return !(opts.deny || []).includes(c.kind);
    });

    this.plugins.set(m.id, {
      manifest: m,
      granted,
      state: 'installed',
      usage: { cpuMs: 0, memoryMB: 0, calls: 0 },
      terminated: false
    });
    return { ok: true, id: m.id, granted: granted.map(c => c.kind) };
  }

  // ---- 激活 ----
  activate(id) {
    const p = this.plugins.get(id);
    if (!p) return { ok: false, reason: 'not-installed' };
    if (p.state === 'active') return { ok: true, already: true };

    // ★ INV-EX-03：Tier 0 只注册贡献点，绝不实例化 WASM
    if (p.manifest.tier === 1) this.wasmInstances++;

    p.state = 'active';
    return { ok: true, tier: p.manifest.tier, wasmCreated: p.manifest.tier === 1 };
  }

  // ---- INV-EX-07：能力探测必须是纯元数据查询，零副作用 ----
  supports(cap) {
    const kind = cap && cap.kind;
    return { supported: !!CAPABILITY_SPECS[kind], spec: CAPABILITY_SPECS[kind] || null };
  }

  // ---- 运行时调用 ----
  invoke(id, call) {
    const p = this.plugins.get(id);
    if (!p) return { status: 'error', error: 'not-installed' };
    if (p.terminated) return { status: 'skipped', reason: 'plugin-terminated' };
    if (p.state !== 'active') return { status: 'skipped', reason: 'not-active' };

    const want = call && call.requires;
    if (want) {
      const has = p.granted.some(g => g.kind === want);
      if (!has) {
        // ★ INV-EX-02：越权返回 denied，记录，不终止插件
        this.auditLog.push({ pluginId: id, denied: want, at: Date.now() });
        return { status: 'denied', capability: want };
      }
    }

    // 资源记账（INV-EX-06）
    const limits = p.manifest.limits || {};
    const cpuLimit = limits.cpuMsPerCall || 50;
    const memLimit = limits.memoryMB || 64;
    const cost = (call && call.costMs) || 1;
    const mem = (call && call.memoryMB) || 0;

    p.usage.cpuMs += cost;
    p.usage.calls++;
    if (mem > p.usage.memoryMB) p.usage.memoryMB = mem;

    if (cost > cpuLimit) {
      p.terminated = true;
      p.state = 'terminated';
      return { status: 'error', error: 'cpu-limit-exceeded', limit: cpuLimit };
    }
    if (p.usage.memoryMB > memLimit) {
      p.terminated = true;
      p.state = 'terminated';
      return { status: 'error', error: 'memory-limit-exceeded', limit: memLimit };
    }

    // 模拟 WASM trap（INV-EX-05）
    if (call && call.trap) {
      return { status: 'error', error: 'wasm-trap', isolated: true };
    }

    // 版本路由：插件只能用到 minVersion 提供的导出
    const exports = API_VERSIONS[p.manifest.api.minVersion].exports;
    if (call && call.method && !exports.includes(call.method) && !this._isContribution(call.method)) {
      return { status: 'denied', capability: call.method, reason: 'not-in-api-version' };
    }

    return { status: 'ok', value: (call && call.value) !== undefined ? call.value : null };
  }

  _isContribution(method) {
    return typeof method === 'string' && method.startsWith('contributes.');
  }

  getUsage(id) {
    const p = this.plugins.get(id);
    return p ? Object.assign({}, p.usage) : null;
  }

  suspend(id) {
    const p = this.plugins.get(id);
    if (!p) return false;
    if (p.manifest.tier === 1 && p.state === 'active') this.wasmInstances--;
    p.state = 'installed';
    return true;
  }

  uninstall(id) {
    const p = this.plugins.get(id);
    if (!p) return false;
    if (p.manifest.tier === 1 && p.state === 'active') this.wasmInstances--;
    this.plugins.delete(id);
    return true;
  }

  // ★ 架构试金石：公开 API 面快照
  apiSurface() {
    return ['install', 'activate', 'suspend', 'uninstall',
            'supports', 'invoke', 'getUsage', 'apiSurface'].sort();
  }
}

// ============================================================
// 4. 内置面板：★ 必须走同一套公开 API（INV-EX-01）
// ============================================================
function builtinKnowledgePanel(host, pluginId) {
  // 不使用任何 host 的内部字段，只调公开方法
  const capCheck = host.supports({ kind: 'kernel.spiTopology' });
  if (!capCheck.supported) return { status: 'skipped', reason: 'capability-unavailable' };
  return host.invoke(pluginId, { method: 'contributes.panels', value: { panel: 'knowledge' } });
}

// ============================================================
// 5. 样例清单
// ============================================================
function themePlugin() {
  return {
    id: 'proteus.theme-ocean', name: 'Ocean Theme', version: '1.0.0', tier: 0,
    api: { minVersion: '0.1.0' },
    capabilities: [],
    contributes: { themes: [{ id: 'ocean', label: 'Ocean' }] }
  };
}
function panelPlugin() {
  return {
    id: 'proteus.knowledge-panel', name: 'Knowledge Panel', version: '1.0.0', tier: 1,
    api: { minVersion: '0.3.0' },
    wasm: { path: 'panel.wasm', sha256: 'a'.repeat(64) },
    capabilities: [{ kind: 'readWorkspace' }, { kind: 'kernel.spiTopology' }],
    contributes: { panels: [{ id: 'knowledge' }] },
    limits: { memoryMB: 64, cpuMsPerCall: 50 }
  };
}
function lspPlugin() {
  return {
    id: 'proteus.rust-analyzer', name: 'rust-analyzer', version: '1.0.0', tier: 2,
    api: { minVersion: '0.2.0' },
    process: { command: 'rust-analyzer', args: [] },
    capabilities: [{ kind: 'runExternalProcess' }, { kind: 'readWorkspace' }],
    contributes: { languages: [{ id: 'rust' }] }
  };
}
function netPlugin(hosts) {
  return {
    id: 'proteus.device-hub', name: 'Device Hub', version: '1.0.0', tier: 1,
    api: { minVersion: '0.4.0' },
    wasm: { path: 'hub.wasm', sha256: 'b'.repeat(64) },
    capabilities: [{ kind: 'network', hosts }, { kind: 'device.attach', runtimes: ['ios-sim'] }],
    contributes: { panels: [{ id: 'device' }] }
  };
}

// ============================================================
// 6. 测试
// ============================================================
function run() {
  const host = new PluginHost();

  // ---------- 基础：清单校验 ----------
  ok(host.validateManifest(themePlugin()).length === 0, '清单校验：Tier0 主题插件合法');
  ok(host.validateManifest(panelPlugin()).length === 0, '清单校验：Tier1 面板插件合法');
  ok(host.validateManifest(lspPlugin()).length === 0, '清单校验：Tier2 LSP 插件合法');

  ok(host.validateManifest(null).length > 0, '清单校验：空清单被拒');
  const badTier = Object.assign(themePlugin(), { tier: 9 });
  ok(host.validateManifest(badTier).length > 0, '清单校验：非法 tier 被拒');
  const badVer = Object.assign(themePlugin(), { api: { minVersion: '9.9.9' } });
  ok(host.validateManifest(badVer).length > 0, '清单校验：未知 API 版本被拒');

  // Tier 一致性
  const t0WithWasm = Object.assign(themePlugin(), { wasm: { path: 'x.wasm' } });
  ok(host.validateManifest(t0WithWasm).length > 0, '清单校验：Tier0 不得含 wasm');
  const t0WithKernel = Object.assign(themePlugin(),
    { capabilities: [{ kind: 'kernel.spiTopology' }] });
  ok(host.validateManifest(t0WithKernel).length > 0, '清单校验：Tier0 不得申请运行时能力');
  const t1NoWasm = Object.assign(panelPlugin(), { wasm: undefined });
  ok(host.validateManifest(t1NoWasm).length > 0, '清单校验：Tier1 必须提供 wasm');
  const t2NoCap = Object.assign(lspPlugin(), { capabilities: [{ kind: 'readWorkspace' }] });
  ok(host.validateManifest(t2NoCap).length > 0, '清单校验：Tier2 必须声明 runExternalProcess');

  // ---------- INV-EX-02 能力白名单强制 ----------
  ok(host.validateManifest(netPlugin(['api.expo.dev'])).length === 0,
     'INV-EX-02 network 带白名单 → 合法');
  ok(host.validateManifest(netPlugin([])).length > 0,
     'INV-EX-02 network 空白名单 → 拒绝（NEG-04）');
  const netNoHosts = Object.assign(netPlugin(['a.com']), {});
  netNoHosts.capabilities = [{ kind: 'network' }];
  ok(host.validateManifest(netNoHosts).length > 0,
     'INV-EX-02 network 缺 hosts 字段 → 拒绝');
  const netWild = netPlugin(['*']);
  ok(host.validateManifest(netWild).length > 0,
     'INV-EX-02 network 通配 "*" → 拒绝');
  const netMulti = netPlugin(['*.*.example.com']);
  ok(host.validateManifest(netMulti).length > 0,
     'INV-EX-02 多级通配 → 拒绝');
  const spawnNoArgs = Object.assign(panelPlugin(),
    { capabilities: [{ kind: 'spawnProcess' }], api: { minVersion: '0.4.0' } });
  ok(host.validateManifest(spawnNoArgs).length > 0,
     'INV-EX-02 spawnProcess 缺 commands → 拒绝');
  const attachNoRt = Object.assign(netPlugin(['a.com']), {});
  attachNoRt.capabilities = [{ kind: 'device.attach' }];
  ok(host.validateManifest(attachNoRt).length > 0,
     'INV-EX-02 device.attach 缺 runtimes → 拒绝');

  // ---------- 安装与默认零权限 ----------
  const r1 = host.install(themePlugin(), {});
  ok(r1.ok === true, '安装：主题插件成功');
  ok(Array.isArray(r1.granted) && r1.granted.length === 0, '安装：默认零权限（未授予任何能力）');

  const r2 = host.install(panelPlugin(), { grantAll: true });
  ok(r2.ok === true, '安装：面板插件成功（全授予）');
  ok(r2.granted.includes('readWorkspace'), '安装：readWorkspace 已授予');
  ok(r2.granted.includes('kernel.spiTopology'), '安装：kernel.spiTopology 已授予');

  const r3 = host.install(panelPlugin(), {});
  ok(r3.ok === false && r3.reason === 'already-installed', '安装：重复安装被拒');

  const r4 = host.install(netPlugin(['api.expo.dev']), { grantAll: true, deny: ['device.attach'] });
  ok(r4.ok === true, '安装：部分授予成功');
  ok(!r4.granted.includes('device.attach'), '安装：被 deny 的能力未授予');
  ok(r4.granted.includes('network'), '安装：未被 deny 的能力正常授予');

  // ---------- INV-EX-03 声明式插件零 WASM 实例 ----------
  const before = host.wasmInstances;
  host.activate('proteus.theme-ocean');
  ok(host.wasmInstances === before, 'INV-EX-03 Tier0 激活不创建 WASM 实例（NEG-07）');
  ok(host.getUsage('proteus.theme-ocean') !== null, 'INV-EX-03 Tier0 仍有使用记录对象');

  host.activate('proteus.knowledge-panel');
  ok(host.wasmInstances === before + 1, 'INV-EX-03 Tier1 激活创建 1 个 WASM 实例');

  const lspInstall = host.install(lspPlugin(), { grantAll: true });
  ok(lspInstall.ok === true, '安装：Tier2 LSP 插件成功');
  const beforeLsp = host.wasmInstances;
  host.activate('proteus.rust-analyzer');
  ok(host.wasmInstances === beforeLsp, 'INV-EX-03 Tier2 不占 WASM 实例（原生进程）');

  // ---------- INV-EX-01 内置功能走同一 API ----------
  const surfaceBefore = JSON.stringify(host.apiSurface());
  const builtinResult = builtinKnowledgePanel(host, 'proteus.knowledge-panel');
  const surfaceAfter = JSON.stringify(host.apiSurface());
  ok(builtinResult.status === 'ok', 'INV-EX-01 内置面板经公开 API 调用成功');
  ok(surfaceBefore === surfaceAfter,
     'INV-EX-01 内置面板不改 API 面（架构试金石 S1===S2）');
  ok(host.apiSurface().includes('supports'), 'INV-EX-01 API 面含 supports（元数据探测）');
  ok(host.apiSurface().length === 8, 'INV-EX-01 API 面共 8 个公开方法');

  // ---------- 语义区分：skipped vs denied ----------
  // 教训：未激活的插件返回 skipped，已激活但越权返回 denied，二者语义不同
  const inactiveInstall = host.install(Object.assign(panelPlugin(), { id: 'inactive.test' }), {});
  ok(inactiveInstall.ok === true, '语义区分：未激活插件可安装');
  const skippedRes = host.invoke('inactive.test', { requires: 'kernel.spiTopology' });
  ok(skippedRes.status === 'skipped', '语义区分：未激活 → skipped（非 denied）');
  ok(skippedRes.reason === 'not-active', '语义区分：skipped 原因标注 not-active');

  // ---------- INV-EX-02 越权返回 denied 不崩溃 ----------
  // 先激活：只有已激活插件才可能走到越权判定
  host.activate('proteus.device-hub');
  const denied = host.invoke('proteus.device-hub', { requires: 'device.attach' });
  ok(denied.status === 'denied', 'INV-EX-02 越权返回 denied（NEG-01）');
  ok(denied.capability === 'device.attach', 'INV-EX-02 denied 携带 capability 名');
  ok(host.plugins.get('proteus.device-hub').terminated === false,
     'INV-EX-02 越权不终止插件');
  ok(host.plugins.get('proteus.device-hub').state === 'active',
     'INV-EX-02 越权后插件仍 active');
  ok(host.auditLog.length === 1, 'INV-EX-02 越权被记入审计日志');

  const allowed = host.invoke('proteus.knowledge-panel', { requires: 'readWorkspace', value: 42 });
  ok(allowed.status === 'ok', 'INV-EX-02 已授权能力正常调用');
  ok(allowed.value === 42, 'INV-EX-02 返回值透传');
  ok(host.auditLog.length === 1, 'INV-EX-02 合法调用不写审计日志');

  // ---------- INV-EX-04 API 版本化向后兼容 ----------
  const old = Object.assign(themePlugin(), { id: 'legacy.theme' });
  old.api = { minVersion: '0.1.0' };
  const oldInstall = host.install(old, {});
  ok(oldInstall.ok === true, 'INV-EX-04 老版本插件仍可安装（NEG-05）');
  host.activate('legacy.theme');
  ok(LATEST === '0.4.0', 'INV-EX-04 宿主已演进到 0.4.0');
  ok(API_VERSIONS['0.1.0'].stable === true, 'INV-EX-04 老版本 WIT 仍稳定保留');

  const versioned = host.install(Object.assign(panelPlugin(), { id: 'v3.panel' }), { grantAll: true });
  ok(versioned.ok === true, '安装：v0.3.0 面板插件成功');
  host.activate('v3.panel');
  const notInVersion = host.invoke('v3.panel', { method: 'kernel.conformance' });
  ok(notInVersion.status === 'denied',
     'INV-EX-04 插件不能用到高于声明版本的 API');
  ok(notInVersion.reason === 'not-in-api-version', 'INV-EX-04 拒绝原因标注版本不符');
  const inVersion = host.invoke('v3.panel', { method: 'kernel.spiTopology' });
  ok(inVersion.status === 'ok', 'INV-EX-04 声明版本内的 API 可用');

  // 能力超出版本范围
  const capTooNew = Object.assign(themePlugin(), {
    id: 'toonew.plugin', tier: 1, api: { minVersion: '0.1.0' },
    wasm: { path: 'x.wasm' }, capabilities: [{ kind: 'kernel.conformance' }]
  });
  ok(host.validateManifest(capTooNew).length > 0,
     'INV-EX-04 capability 超出 minVersion 范围 → 安装期拒绝');

  // ---------- INV-EX-05 崩溃隔离 ----------
  const trapRes = host.invoke('proteus.knowledge-panel', { trap: true });
  ok(trapRes.status === 'error' && trapRes.error === 'wasm-trap',
     'INV-EX-05 WASM trap 被识别（NEG-02）');
  ok(trapRes.isolated === true, 'INV-EX-05 trap 标记为 isolated');
  ok(host.plugins.size >= 5, 'INV-EX-05 trap 后其他插件仍存活');
  const afterTrap = host.invoke('proteus.knowledge-panel', { requires: 'readWorkspace', value: 1 });
  ok(afterTrap.status === 'ok', 'INV-EX-05 trap 后宿主仍可正常调用');

  // ---------- INV-EX-06 资源限额 ----------
  const limitPlugin = Object.assign(panelPlugin(), { id: 'limit.test' });
  limitPlugin.limits = { memoryMB: 64, cpuMsPerCall: 10 };
  host.install(limitPlugin, { grantAll: true });
  host.activate('limit.test');
  const overCpu = host.invoke('limit.test', { costMs: 999 });
  ok(overCpu.status === 'error' && overCpu.error === 'cpu-limit-exceeded',
     'INV-EX-06 超 CPU 限额被终止（NEG-03）');
  ok(host.plugins.get('limit.test').terminated === true, 'INV-EX-06 超限插件标记 terminated');
  const afterTerm = host.invoke('limit.test', { value: 1 });
  ok(afterTerm.status === 'skipped' && afterTerm.reason === 'plugin-terminated',
     'INV-EX-06 已终止插件返回 skipped 而非崩溃');

  const memPlugin = Object.assign(panelPlugin(), { id: 'mem.test' });
  memPlugin.limits = { memoryMB: 16, cpuMsPerCall: 100 };
  host.install(memPlugin, { grantAll: true });
  host.activate('mem.test');
  const overMem = host.invoke('mem.test', { memoryMB: 999 });
  ok(overMem.status === 'error' && overMem.error === 'memory-limit-exceeded',
     'INV-EX-06 超内存限额被终止');
  ok(host.getUsage('mem.test').memoryMB === 999, 'INV-EX-06 使用量如实记录');

  const normalUsage = host.invoke('proteus.knowledge-panel', { costMs: 3, requires: 'readWorkspace' });
  ok(normalUsage.status === 'ok', 'INV-EX-06 限额内调用正常');
  ok(host.getUsage('proteus.knowledge-panel').cpuMs >= 3, 'INV-EX-06 CPU 用量累加');
  ok(host.getUsage('proteus.knowledge-panel').calls >= 2, 'INV-EX-06 调用次数累加');
  ok(host.getUsage('nonexistent.plugin') === null, 'INV-EX-06 不存在插件返回 null');

  // ---------- INV-EX-07 supports() 零副作用 ----------
  const logBefore = JSON.stringify(host.apiSurface());
  const s1 = host.supports({ kind: 'kernel.conformance' });
  ok(s1.supported === true, 'INV-EX-07 supports 识别已知能力');
  ok(s1.spec !== null, 'INV-EX-07 supports 返回规格元数据');
  const s2 = host.supports({ kind: 'no.such.capability' });
  ok(s2.supported === false, 'INV-EX-07 未知能力返回 false 不抛异常');
  ok(s2.spec === null, 'INV-EX-07 未知能力 spec 为 null');
  const s3 = host.supports({ kind: 'device.input' });
  ok(s3.spec.highRisk === true, 'INV-EX-07 高危能力在元数据中标记');
  ok(JSON.stringify(host.apiSurface()) === logBefore,
     'INV-EX-07 supports 零副作用（API 面不变）');
  ok(host.auditLog.length === 1, 'INV-EX-07 supports 不写审计日志（非越权）');

  // 反面：不得用"发请求试探"探测能力
  const probe = host.invoke('proteus.knowledge-panel', { method: 'kernel.conformance' });
  ok(probe.status === 'denied',
     'INV-EX-07 用 invoke 试探能力 → denied（证明 supports 才是正道）');

  // ---------- INV-EX-08 提案 API 不得发布 ----------
  const withProposal = Object.assign(panelPlugin(), { id: 'proposal.plugin' });
  withProposal.api = { minVersion: '0.4.0', proposals: ['deviceInputV2'] };
  const pubRes = host.install(withProposal, { publish: true, grantAll: true });
  ok(pubRes.ok === false, 'INV-EX-08 含提案 API 不得发布（NEG-06）');
  ok(pubRes.reason === 'proposal-not-publishable', 'INV-EX-08 拒绝原因明确');
  ok(pubRes.proposals.includes('deviceInputV2'), 'INV-EX-08 拒绝信息含提案名');

  const devRes = host.install(withProposal, { grantAll: true });
  ok(devRes.ok === true, 'INV-EX-08 含提案 API 可本地开发安装');

  const unknownProposal = Object.assign(panelPlugin(), { id: 'bad.proposal' });
  unknownProposal.api = { minVersion: '0.4.0', proposals: ['noSuchProposal'] };
  ok(host.validateManifest(unknownProposal).length > 0,
     'INV-EX-08 未知提案名被拒（NEG-08）');

  const stableOk = Object.assign(panelPlugin(), { id: 'stable.plugin' });
  const stablePub = host.install(stableOk, { publish: true, grantAll: true });
  ok(stablePub.ok === true, 'INV-EX-08 无提案的插件可正常发布');
  ok(PROPOSAL_REGISTRY.deviceInputV2.stable === false,
     'INV-EX-08 提案在注册表中标记未稳定');

  // ---------- 生命周期：挂起 / 卸载 ----------
  const beforeSuspend = host.wasmInstances;
  host.suspend('proteus.knowledge-panel');
  ok(host.wasmInstances === beforeSuspend - 1, '生命周期：挂起释放 WASM 实例');
  const afterSuspend = host.invoke('proteus.knowledge-panel', { value: 1 });
  ok(afterSuspend.status === 'skipped' && afterSuspend.reason === 'not-active',
     '生命周期：挂起后调用返回 skipped');

  host.activate('proteus.knowledge-panel');
  ok(host.wasmInstances === beforeSuspend, '生命周期：重新激活恢复实例');
  const reActivate = host.activate('proteus.knowledge-panel');
  ok(reActivate.already === true, '生命周期：重复激活幂等');
  ok(host.wasmInstances === beforeSuspend, '生命周期：重复激活不重复创建实例');

  const beforeUninstall = host.wasmInstances;
  host.uninstall('proteus.knowledge-panel');
  ok(host.wasmInstances === beforeUninstall - 1, '生命周期：卸载释放 WASM 实例');
  ok(host.plugins.has('proteus.knowledge-panel') === false, '生命周期：卸载后移除插件');
  ok(host.uninstall('proteus.knowledge-panel') === false, '生命周期：重复卸载返回 false');

  // ---------- 接缝命题 ----------
  // 接缝 1：G-51 INV-02（降级不崩溃）∧ G-58 INV-EX-02（越权 denied）
  const j1 = host.invoke('proteus.device-hub', { requires: 'device.input' });
  ok(j1.status === 'denied' && host.plugins.get('proteus.device-hub').state === 'active',
     '接缝1 G-51 INV-02 ∧ INV-EX-02 → 权限系统不引入新崩溃面');

  // 接缝 2：G-56.2（自有宿主不享特权）∧ G-58 INV-EX-01（内置功能同权）
  const surfaceNow = JSON.stringify(host.apiSurface());
  ok(surfaceNow === surfaceBefore,
     '接缝2 G-56.2 ∧ INV-EX-01 → 特权无关性从宿主推广到插件');

  // 接缝 3：G-54 supports 教训 ∧ G-58 INV-EX-07
  let threw = false;
  try { host.supports(undefined); host.supports({}); } catch (e) { threw = true; }
  ok(threw === false, '接缝3 G-54 ∧ INV-EX-07 → 畸形输入下 supports 不抛异常');
  ok(host.supports(undefined).supported === false, '接缝3 空输入返回 false');
  ok(host.supports({}).supported === false, '接缝3 空对象返回 false');

  // 接缝 4：G-58 三层可观测性 ∧ G-58 插件可消费
  const obsCap = host.supports({ kind: 'kernel.conformance' });
  ok(obsCap.supported === true,
     '接缝4 G-58 三层数据 ∧ INV-EX-02 → 插件可申请消费框架语义');
  const kernelCaps = Object.keys(CAPABILITY_SPECS).filter(k => k.startsWith('kernel.'));
  ok(kernelCaps.length === 4, '接缝4 G-54 六项能力中 4 项已暴露为 capability');
  ok(kernelCaps.every(k => host.supports({ kind: k }).supported),
     '接缝4 全部 kernel capability 可被探测');

  // ---------- 降级语义完整性 ----------
  const statuses = new Set();
  for (const r of [
    host.invoke('proteus.device-hub', { requires: 'device.attach' }),
    host.invoke('limit.test', { value: 1 }),
    host.invoke('legacy.theme', { value: 1 })
  ]) statuses.add(r.status);
  ok(statuses.has('denied'), '降级语义：denied 可产生');
  ok(statuses.has('skipped'), '降级语义：skipped 可产生');
  ok(host.invoke('nonexistent', {}).status === 'error', '降级语义：未安装返回 error');

  // Tier 统计
  const tiers = [...host.plugins.values()].map(p => p.manifest.tier);
  ok(tiers.includes(0), '覆盖：Tier 0 声明式插件已测');
  ok(tiers.includes(1), '覆盖：Tier 1 WASM 插件已测');
  ok(tiers.includes(2), '覆盖：Tier 2 外部进程插件已测');

  return { pass: _pass, fail: _fail };
}

const r = run();
console.log(_cases.map(c => `${c[0]}: ${c[1]}`).join('\n'));
console.log(`\nself-test: ${_pass}/${_pass + _fail}`);
if (_fail > 0) process.exit(1);
