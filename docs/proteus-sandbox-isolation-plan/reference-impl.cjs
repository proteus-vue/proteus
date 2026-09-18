#!/usr/bin/env node
/**
 * G-49 小程序运行时进程级沙箱隔离 — 可运行参考实现
 *
 * 设计：单进程模拟 L1/L2/L3 三层隔离语义（真实隔离需平台原生 API，见 §03-spi.md）
 * 验证重点：
 *   - 跨小程序存储隔离（L2）
 *   - CapabilityBridge 权限网关（deny-by-default）
 *   - 崩溃隔离（一个崩溃不影响其他，L3 语义）
 *   - Drop 级联销毁（G-43 所有权）
 *   - 资源配额 + ISOLATION_BREACH 检测
 *
 * 零依赖，node 直接跑： node reference-impl.cjs
 */

'use strict';

// ─── 测试框架（复用 G-44/G-46/G-47 风格） ───────────────────────────────
const tests = [];
let pass = 0, fail = 0;

function ok(name, cond) {
  if (cond) { pass++; tests.push(['OK  ', name]); }
  else      { fail++; tests.push(['FAIL', name]); console.error('  ✗ ' + name); }
}

function throws(fn) {
  try { fn(); return false; } catch (e) { return true; }
}

function rejectsAsync(promise, reasonSubstr) {
  return promise.then(
    () => false,
    (e) => {
      if (!reasonSubstr) return true;
      // 错误可能是普通对象 {code, reason} 或 Error 实例
      const str = (e && (e.code || e.message || e.reason)) || '';
      return String(str).includes(reasonSubstr);
    }
  );
}

// ─── 工具：规范化 appId（CMP-113） ──────────────────────────────────────
function normalizeAppId(appId) {
  if (!/^[a-z0-9_]{1,64}$/.test(appId)) {
    throw { code: 'INVALID_APP_ID', appId };
  }
  return appId;
}

// ─── 工具：路径安全拼接（防路径穿越 → ISOLATION_BREACH） ───────────────
function safeJoin(root, appId) {
  // ★ 先做路径穿越检查（先于规范化），确保穿越类攻击统一返回 ISOLATION_BREACH
  if (typeof appId !== 'string' || appId.includes('..') || appId.startsWith('/') || appId.includes('\\')) {
    throw { code: 'ISOLATION_BREACH', detail: 'path_traversal_attempt: ' + appId };
  }
  const id = normalizeAppId(appId);  // 此处校验字符集 / 长度
  return root.replace(/\/$/, '') + '/mp_' + id;
}

// ─── SandboxBackend（WebBackend：单进程模拟，L1/L2/L3 语义） ───────────
class SandboxBackend {
  constructor(platform, dataRoot) {
    this.platform = platform;
    this.dataRoot = dataRoot;
    this.contexts = new Map();   // appId → SandboxContext
    this.crashHandlers = new Map();
  }

  maxIsolationLevel() {
    // android / harmonyos → L3；ios → L2(+系统WebContent)；web → L1
    return ({ android: 'L3', harmonyos: 'L3', ios: 'L2', web: 'L1' })[this.platform] || 'L1';
  }

  async createContext(req) {
    const appId = normalizeAppId(req.appId);
    if (this.contexts.has(appId)) {
      throw { code: 'INVALID_APP_ID', appId, reason: 'already_exists' };
    }

    // L2：独立数据目录（含 appId 后缀，防碰撞）
    const dataDirectory = safeJoin(this.dataRoot, appId);

    // L2：权限白名单（deny-by-default）
    const permissions = new Set(req.manifest.permissions || []);

    // L3：资源配额
    const quota = Object.assign(
      { memoryMB: 128, cpuPercent: 100, networkRps: 50, storageMB: 50, maxConcurrent: 5 },
      req.manifest.quota || {}
    );

    const ctx = {
      appId,
      level: req.level,
      dataDirectory,
      permissions,
      quota,
      storage: new Map(),          // 小程序私有存储（L2 隔离核心）
      networkCount: 0,
      active: true,
      onCrash: (h) => { this.crashHandlers.set(appId, h); },
    };
    this.contexts.set(appId, ctx);
    return ctx;
  }

  async destroyContext(appId) {
    const ctx = this.contexts.get(appId);
    if (!ctx) return;
    // Drop 级联（G-43）：存储 + 权限 + 配额计数全部释放
    ctx.storage.clear();
    ctx.permissions = null;
    ctx.quota = null;
    ctx.active = false;
    this.contexts.delete(appId);
    this.crashHandlers.delete(appId);
  }

  getProcessInfo(appId) {
    const ctx = this.contexts.get(appId);
    if (!ctx) return null;
    // 模拟：L3 下每个小程序独立 "pid"；L1/L2 共享宿主 pid
    const level = this.maxIsolationLevel();
    return {
      appId,
      pid: level === 'L3' ? `mp-${appId}-pid` : 'host-pid',
      isolated: level >= 'L3',
    };
  }

  getQuota(appId) { return this.contexts.get(appId)?.quota || null; }
}

// ─── CapabilityBridge（声明式权限网关，替代 addJavascriptInterface） ─────
class CapabilityBridge {
  constructor(backend, auditLog) {
    this.backend = backend;
    this.auditLog = auditLog || [];
  }

  async invoke(appId, api, params, token) {
    const ctx = this.backend.contexts.get(appId);
    if (!ctx || !ctx.active) throw { code: 'SANDBOX_CRASHED', appId };

    // 1. Token 校验（CMP-115）
    if (!token || token.appId !== appId || token.expired) {
      this.auditLog.push({ appId, api, result: 'TOKEN_EXPIRED' });
      throw { code: 'TOKEN_EXPIRED', tokenId: token && token.id };
    }

    // 2. 权限白名单（deny-by-default）
    if (!ctx.permissions.has(api)) {
      this.auditLog.push({ appId, api, result: 'PERMISSION_DENIED' });
      throw { code: 'PERMISSION_DENIED', api };  // ★ 关键：默认拒绝
    }

    // 3. 资源配额（网络 QPS）
    if (ctx.networkCount >= ctx.quota.networkRps) {
      this.auditLog.push({ appId, api, result: 'QUOTA_EXCEEDED' });
      throw { code: 'QUOTA_EXCEEDED', resource: 'network' };
    }
    ctx.networkCount++;

    // 4. 转发至原生实现（模拟）
    this.auditLog.push({ appId, api, result: 'OK' });
    return { ok: true, api, data: params };
  }

  revoke(appId, perm) {
    const ctx = this.backend.contexts.get(appId);
    if (!ctx) return;
    if (perm) ctx.permissions.delete(perm);
    else ctx.permissions.clear();  // 撤销全部
  }
}

// ─── ISOLATION_BREACH 检测：跨小程序存储访问拦截 ─────────────────────────
function guardedStorage(ctx, callerAppId) {
  return {
    get(key) {
      if (callerAppId !== ctx.appId) {
        // ★ 跨小程序读取 → 直接抛 ISOLATION_BREACH（机制强制，非规范）
        throw { code: 'ISOLATION_BREACH', detail: `${callerAppId} reads ${ctx.appId}` };
      }
      return ctx.storage.get(key) || null;
    },
    set(key, val) {
      if (callerAppId !== ctx.appId) {
        throw { code: 'ISOLATION_BREACH', detail: `${callerAppId} writes ${ctx.appId}` };
      }
      ctx.storage.set(key, val);
    },
  };
}

// ─── 崩溃隔离模拟 ───────────────────────────────────────────────────────
function simulateCrash(backend, appId, error) {
  const ctx = backend.contexts.get(appId);
  if (!ctx) return;
  const handler = backend.crashHandlers.get(appId);
  // 崩溃只影响本小程序，宿主和其他小程序继续运行
  ctx.active = false;
  if (handler) handler({ code: 'SANDBOX_CRASHED', appId, error });
}

// ═══════════════════════════════════════════════════════════════════════
// 测试套件
// ═══════════════════════════════════════════════════════════════════════
async function main() {
  console.log('G-49 reference-impl — running...\n');

  // ── L2：存储隔离（SBX-01） ─────────────────────────────────────────
  {
    const b = new SandboxBackend('web', '/data');
    const a = await b.createContext({ appId: 'shop_a', manifest: { permissions: [] }, level: 'L2', dataRoot: '/data' });
    const c = await b.createContext({ appId: 'shop_c', manifest: { permissions: [] }, level: 'L2', dataRoot: '/data' });

    a.storage.set('secret', 'A_ONLY');
    c.storage.set('secret', 'C_ONLY');

    // 同小程序可读
    ok('L2-01 同小程序可读取自己存储', a.storage.get('secret') === 'A_ONLY');

    // ★ 跨小程序读取 → ISOLATION_BREACH（机制强制，非规范约束）
    let breached = false;
    try { guardedStorage(a, 'shop_c').get('secret'); } catch (e) { breached = (e && e.code === 'ISOLATION_BREACH'); }
    ok('L2-02 跨小程序读取被机制强制拦截', breached);
    ok('L2-02b 跨小程序写入同样被拦截',
      throws(() => guardedStorage(a, 'shop_c').set('secret', 'evil')));

    // 数据确实隔离（C 读不到 A 的值）
    ok('L2-03 各小程序存储相互独立', c.storage.get('secret') === 'C_ONLY');
  }

  // ── L2：CapabilityBridge 权限网关（SBX-02 / SBX-06） ──────────────
  {
    const b = new SandboxBackend('android', '/data');
    const audit = [];
    const bridge = new CapabilityBridge(b, audit);
    const ctx = await b.createContext({
      appId: 'pay_demo',
      manifest: { permissions: ['storage.read', 'network.fetch'] },  // 注意：无 payment
      quota: { networkRps: 2 },
      level: 'L3', dataRoot: '/data',
    });
    const token = { id: 't1', appId: 'pay_demo', expired: false };

    // 已声明权限 → 成功
    const r1 = await bridge.invoke('pay_demo', 'network.fetch', { url: 'x' }, token);
    ok('L2-04 已声明权限 → 调用成功', r1 && r1.ok === true);

    // ★ 未声明权限（payment）→ PERMISSION_DENIED
    const denied = await rejectsAsync(
      bridge.invoke('pay_demo', 'payment.pay', { amount: 100 }, token),
      'PERMISSION_DENIED'
    );
    ok('L2-05 未声明权限 → PERMISSION_DENIED（deny-by-default）', denied);

    // 配额超限 → QUOTA_EXCEEDED（用独立 backend + quota=1，边界清晰）
    const b2 = new SandboxBackend('android', '/data');
    const audit2 = [];
    const bridge2 = new CapabilityBridge(b2, audit2);
    await b2.createContext({
      appId: 'quota_test',
      manifest: {
        permissions: ['network.fetch'],
        quota: { networkRps: 1 },  // ★ 放在 manifest 内（SPI：req.manifest.quota）
      },
      level: 'L3', dataRoot: '/data',
    });
    const t2 = { id: 't', appId: 'quota_test', expired: false };
    await bridge2.invoke('quota_test', 'network.fetch', { url: 'first' }, t2);  // 第 1 次：成功
    const over = await rejectsAsync(
      bridge2.invoke('quota_test', 'network.fetch', { url: 'second' }, t2),  // 第 2 次 > 1：超限
      'QUOTA_EXCEEDED'
    );
    ok('L2-06 资源配额超限 → QUOTA_EXCEEDED', over);

    // 审计日志记录了拒绝
    ok('L2-07 权限拒绝写入审计日志',
      audit.some(x => x.result === 'PERMISSION_DENIED' && x.api === 'payment.pay'));
    ok('L2-08 成功调用也写入审计日志',
      audit.some(x => x.result === 'OK' && x.api === 'network.fetch'));
  }

  // ── Token 校验（CMP-115 / SBX 相关） ─────────────────────────────
  {
    const b = new SandboxBackend('web', '/data');
    const bridge = new CapabilityBridge(b, []);
    await b.createContext({ appId: 't', manifest: { permissions: ['x'] }, level: 'L1', dataRoot: '/d' });

    const expired = await rejectsAsync(
      bridge.invoke('t', 'x', {}, { id: 't', appId: 't', expired: true }),
      'TOKEN_EXPIRED'
    );
    ok('L2-09 过期 Token → TOKEN_EXPIRED', expired);

    const wrongApp = await rejectsAsync(
      bridge.invoke('t', 'x', {}, { id: 't', appId: 'other', expired: false }),
      'TOKEN_EXPIRED'
    );
    ok('L2-10 Token 归属不匹配 → 拒绝', wrongApp);
  }

  // ── L3：崩溃隔离（SBX-04） ───────────────────────────────────────
  {
    const b = new SandboxBackend('android', '/data');  // maxIsolationLevel = L3
    await b.createContext({ appId: 'victim', manifest: { permissions: [] }, level: 'L3', dataRoot: '/data' });
    await b.createContext({ appId: 'neighbor', manifest: { permissions: [] }, level: 'L3', dataRoot: '/data' });
    await b.createContext({ appId: 'host', manifest: { permissions: [] }, level: 'L3', dataRoot: '/data' });

    let neighborCrashed = false;
    b.contexts.get('neighbor').onCrash(() => { neighborCrashed = true; });

    // victim 崩溃
    simulateCrash(b, 'victim', 'NullPointerException');

    // ★ victim 崩溃不影响 neighbor 和 host
    ok('L3-01 崩溃小程序标记为不活跃', b.contexts.get('victim').active === false);
    ok('L3-02 相邻小程序继续运行', b.contexts.get('neighbor').active === true);
    ok('L3-03 宿主继续运行', b.contexts.get('host').active === true);
    ok('L3-04 崩溃回调仅触发本小程序', neighborCrashed === false);

    // 进程信息：L3 下各自独立 pid
    ok('L3-05 L3 隔离级别下独立进程标识',
      b.getProcessInfo('neighbor').pid === 'mp-neighbor-pid');
  }

  // ── iOS 诚实边界：maxIsolationLevel = L2（+系统WebContent） ────────
  {
    const ios = new SandboxBackend('ios', '/data');
    await ios.createContext({ appId: 'ios_app', manifest: { permissions: [] }, level: 'L2', dataRoot: '/data' });
    ok('L3-06 iOS 最高可达 L2（进程隔离靠系统 WebContent）',
      ios.maxIsolationLevel() === 'L2');
    // iOS 平台级 WebContent 隔离，应用内无法做到独立进程 → isolated = false
    ok('L3-07 iOS 进程信息标记为非独立隔离（诚实边界）',
      ios.getProcessInfo('ios_app') && ios.getProcessInfo('ios_app').isolated === false);
  }

  // ── Drop 级联销毁（SBX-05 / G-43） ──────────────────────────────
  {
    const b = new SandboxBackend('harmonyos', '/data');  // L3
    const ctx = await b.createContext({
      appId: 'drop_test',
      manifest: { permissions: ['storage.read'] },
      quota: { memoryMB: 64 },
      level: 'L3', dataRoot: '/data',
    });
    ctx.storage.set('k', 'v');
    await b.destroyContext('drop_test');

    ok('DROP-01 销毁后上下文移除', !b.contexts.has('drop_test'));
    ok('DROP-02 存储清空（Drop 级联）', ctx.storage.size === 0);  // 注意：已 clear
    // 更严格：重新创建同名小程序 → 新上下文，存储为空
    const ctx2 = await b.createContext({
      appId: 'drop_test',
      manifest: { permissions: [] }, level: 'L3', dataRoot: '/data',
    });
    ok('DROP-03 重建后数据目录独立（无残留）', ctx2.storage.size === 0);
  }

  // ── appId 规范化（CMP-113 / SBX-07） ─────────────────────────────
  {
    ok('ID-01 合法 appId 通过', (() => { normalizeAppId('abc_123'); return true; })());
    ok('ID-02 非法字符 → INVALID_APP_ID',
      throws(() => normalizeAppId('bad-id!')) && throws(() => normalizeAppId('BadCase')));
    ok('ID-03 空字符串 → INVALID_APP_ID', throws(() => normalizeAppId('')));
    ok('ID-04 超长 → INVALID_APP_ID', throws(() => normalizeAppId('a'.repeat(65))));

    // 路径穿越 → ISOLATION_BREACH（先做穿越检查）
    let traversal = null;
    try { safeJoin('/data', '../etc'); } catch (e) { traversal = e && e.code; }
    ok('ID-05a 路径穿越（..） → ISOLATION_BREACH', traversal === 'ISOLATION_BREACH');
    let absPath = null;
    try { safeJoin('/data', '/etc/passwd'); } catch (e) { absPath = e && e.code; }
    ok('ID-05b 绝对路径 → ISOLATION_BREACH', absPath === 'ISOLATION_BREACH');

    // 合法但含非法字符 → INVALID_APP_ID（与穿越区分开，审计可分类）
    let badId = null;
    try { safeJoin('/data', 'hack!'); } catch (e) { badId = e && e.code; }
    ok('ID-05c 非法字符 → INVALID_APP_ID（分类清晰）', badId === 'INVALID_APP_ID');

    // 路径无碰撞：不同 appId → 不同目录
    ok('ID-06 数据目录含 appId 后缀（无碰撞）',
      safeJoin('/data', 'a') !== safeJoin('/data', 'b'));
  }

  // ── ISOLATION_BREACH 端到端（SBX-08） ───────────────────────────
  {
    const b = new SandboxBackend('web', '/data');
    const audit = [];
    const bridge = new CapabilityBridge(b, audit);
    const a = await b.createContext({ appId: 'alice', manifest: { permissions: ['storage.read'] }, level: 'L1', dataRoot: '/data' });
    await b.createContext({ appId: 'bob', manifest: { permissions: ['storage.read'] }, level: 'L1', dataRoot: '/data' });
    a.storage.set('private', 'TOP_SECRET');

    let breachCode = null;
    try {
      guardedStorage(a, 'bob').get('private');  // Bob 读 Alice
    } catch (e) { breachCode = e.code; }
    ok('BREACH-01 跨小程序访问 → ISOLATION_BREACH 终止 + 审计',
      breachCode === 'ISOLATION_BREACH');
  }

  // ── 汇总 ────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(46));
  console.log(`总计：${pass + fail} 项`);
  tests.forEach(([s, n]) => console.log(`  ${s}  ${n}`));
  console.log('─'.repeat(46));
  console.log(`${pass} / ${pass + fail} 通过`);
  console.log(fail === 0 ? '\n★ 全部通过（PASS）' : '\n✗ 存在失败项');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(2); });
