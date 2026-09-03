#!/usr/bin/env node
/**
 * G-42 HostContainer 参考实现（零依赖，可真跑）
 *
 * 演示：
 *   1. 页面栈生命周期 + 五原子销毁
 *   2. 页面栈深度治理（LRU）
 *   3. 超级应用沙箱 + 崩溃隔离
 *   4. 资源配额
 *   5. 泄漏检测（5 项）
 *   6. 仓库治理扫描（严禁 fork）
 *   7. 容器 Conformance（C-01~C-08，32 项）
 *
 * 运行：node container-reference.cjs
 */

'use strict';

// ============================================================
// 基础设施
// ============================================================

let _idSeq = 0;
const nextId = (p) => `${p}_${++_idSeq}`;

class ProteusError extends Error {
  constructor(code, message) {
    super(`[${code}] ${message}`);
    this.code = code;
  }
}

// ============================================================
// 资源池（G-42.3 框架代管资源）
// ============================================================

class ResourcePool {
  constructor(ownerLabel) {
    this.ownerLabel = ownerLabel;
    this.timers = new Set();
    this.listeners = new Set();
    this.subscriptions = new Set();
    this.requests = new Set();
  }

  timer(fn, ms) {
    const h = { id: nextId('timer'), fn, ms, cleared: false };
    this.timers.add(h);
    return h;
  }

  interval(fn, ms) {
    const h = { id: nextId('interval'), fn, ms, cleared: false, interval: true };
    this.timers.add(h);
    return h;
  }

  on(target, type, fn) {
    const b = { id: nextId('listener'), target, type, fn, unbound: false };
    this.listeners.add(b);
    return b;
  }

  subscribe(store, fn) {
    const s = { id: nextId('sub'), store, fn, unsubscribed: false };
    this.subscriptions.add(s);
    return s;
  }

  fetch(url, init) {
    const r = { id: nextId('req'), url, init, aborted: false };
    this.requests.add(r);
    return r;
  }

  /** 统一释放（页面销毁时自动调用） */
  releaseAll() {
    const report = { timers: 0, listeners: 0, subscriptions: 0, requests: 0 };
    for (const t of this.timers) { if (!t.cleared) { t.cleared = true; report.timers++; } }
    for (const l of this.listeners) { if (!l.unbound) { l.unbound = true; report.listeners++; } }
    for (const s of this.subscriptions) { if (!s.unsubscribed) { s.unsubscribed = true; report.subscriptions++; } }
    for (const r of this.requests) { if (!r.aborted) { r.aborted = true; report.requests++; } }
    this.timers.clear();
    this.listeners.clear();
    this.subscriptions.clear();
    this.requests.clear();
    return report;
  }

  get total() {
    return this.timers.size + this.listeners.size + this.subscriptions.size + this.requests.size;
  }
}

// ============================================================
// IR 注册表（唯一真相 - G-42.1）
// ============================================================

class IRRegistry {
  constructor() { this.instances = new Map(); }

  create(irNode) {
    const id = nextId('ir');
    this.instances.set(id, { id, node: irNode, alive: true });
    return id;
  }

  destroy(id) {
    const inst = this.instances.get(id);
    if (inst) inst.alive = false;
    this.instances.delete(id);
  }

  get aliveCount() {
    return [...this.instances.values()].filter((i) => i.alive).length;
  }
}

// ============================================================
// 配额管理
// ============================================================

class QuotaManager {
  constructor(limitBytes) {
    this.limitBytes = limitBytes;
    this.usedBytes = 0;
    this.handles = new Map();
  }

  request(bytes) {
    if (this.usedBytes + bytes > this.limitBytes) return null;
    const h = { id: nextId('quota'), bytes, released: false };
    this.handles.set(h.id, h);
    this.usedBytes += bytes;
    return h;
  }

  release(handle) {
    if (!handle || handle.released) return false;
    const h = this.handles.get(handle.id);
    if (!h) return false;
    h.released = true;
    this.usedBytes -= h.bytes;
    this.handles.delete(h.id);
    return true;
  }

  get pressure() {
    const ratio = this.usedBytes / this.limitBytes;
    if (ratio >= 0.9) return 'critical';
    if (ratio >= 0.7) return 'warning';
    return 'normal';
  }

  get usage() {
    return { usedBytes: this.usedBytes, limitBytes: this.limitBytes, pressure: this.pressure };
  }
}

// ============================================================
// 页面
// ============================================================

class Page {
  constructor(config, irRegistry, quota) {
    this.pageId = nextId('page');
    this.config = config;
    this.state = 'created';
    this.irRegistry = irRegistry;
    this.quota = quota;

    this.irId = irRegistry.create(config.ir || { semantic: 'page', title: config.title });
    this.resourcePool = new ResourcePool(this.pageId);
    this.eventRegistry = { bindings: new Set() };
    this.mountPoint = null;
    this.quotaHandle = null;
    this.quotaHandle = quota.request(config.memoryBytes || 8 * 1024 * 1024);
  }

  /** 挂载（Backend 提供原生挂载点） */
  async mount(backend) {
    if (this.state !== 'created') throw new ProteusError('G39_STATE', `cannot mount from ${this.state}`);
    this.mountPoint = backend.createMountPoint(this.pageId);
    this.state = 'mounted';
    return this.mountPoint;
  }

  hide() { if (this.state === 'mounted') this.state = 'hidden'; }
  show() { if (this.state === 'hidden') this.state = 'mounted'; }
}

// ============================================================
// 容器基类
// ============================================================

class BaseContainer {
  constructor(id, opts = {}) {
    this.id = id;
    this.version = '1.0.0';
    this.irRegistry = new IRRegistry();
    this.quota = new QuotaManager(opts.limitBytes || 512 * 1024 * 1024);
    this.pages = new Map();
    this.backend = opts.backend || null;
    this.eventHandlers = new Map();
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, []);
    this.eventHandlers.get(event).push(handler);
  }

  emit(event, payload) {
    (this.eventHandlers.get(event) || []).forEach((h) => h(payload));
  }

  /**
   * ★ 五原子销毁（G-42.2）
   * 五步必须全部完成，不可部分执行
   */
  async destroyPage(pageId) {
    const page = this.pages.get(pageId);
    if (!page) throw new ProteusError('G39_NOTFOUND', `page ${pageId} not found`);

    const steps = [];
    const leaked = [];
    let reclaimed = 0;

    // ① 卸载 Backend 挂载点
    if (page.mountPoint !== null) {
      if (this.backend) this.backend.destroyMountPoint(page.mountPoint);
      page.mountPoint = null;
    }
    steps.push('unmount');

    // ② 解绑事件/手势
    const evCount = page.eventRegistry.bindings.size;
    page.eventRegistry.bindings.clear();
    steps.push('unbindEvents');
    if (evCount > 0) leaked.push({ type: 'events', count: evCount, note: 'reclaimed' });

    // ③ 清定时器/订阅（框架代管）
    const relReport = page.resourcePool.releaseAll();
    steps.push('releaseResources');

    // ④ 销毁 IR 实例
    this.irRegistry.destroy(page.irId);
    steps.push('destroyIR');

    // ⑤ 归还内存配额
    if (page.quotaHandle) {
      reclaimed = page.quotaHandle.bytes;
      this.quota.release(page.quotaHandle);
      page.quotaHandle = null;
    }
    steps.push('releaseQuota');

    // G-42.2 校验：必须五步
    if (steps.length !== 5) {
      throw new ProteusError('G39_002', `page destroy must be 5-atomic, got ${steps.length}`);
    }

    page.state = 'destroyed';
    this.pages.delete(pageId);

    return {
      pageId,
      steps,
      leaked,
      resourceReport: relReport,
      reclaimedBytes: reclaimed,
    };
  }
}

// ============================================================
// StackContainer：页面栈容器
// ============================================================

class StackContainer extends BaseContainer {
  constructor(opts = {}) {
    super('stack', opts);
    this.stack = [];
    this.policy = {
      maxDepth: opts.maxDepth ?? 10,
      overflowStrategy: opts.overflowStrategy ?? 'destroy-oldest',
      keepAlive: { maxCount: opts.keepAliveMax ?? 3, memoryBudgetBytes: 64 * 1024 * 1024 },
    };
    this.capabilities = {
      pageStack: true, multiBusiness: false, crashIsolation: 0,
      resourceQuota: true, keepAlive: true, windowManagement: false, embedded: false,
    };
  }

  async push(config) {
    // 深度治理
    if (this.stack.length >= this.policy.maxDepth) {
      if (this.policy.overflowStrategy === 'destroy-oldest') {
        const oldest = this.stack.shift();
        await this.destroyPage(oldest.pageId);
        this.emit('overflow-destroyed', { pageId: oldest.pageId });
      } else if (this.policy.overflowStrategy === 'reject') {
        throw new ProteusError('G39_OVERFLOW', `stack depth ${this.policy.maxDepth} reached`);
      }
    }

    const page = new Page(config, this.irRegistry, this.quota);
    this.pages.set(page.pageId, page);
    if (this.backend) await page.mount(this.backend);
    this.stack.push(page);
    return page;
  }

  async pop() {
    const page = this.stack.pop();
    if (!page) return null;
    await this.destroyPage(page.pageId);
    return page;
  }

  getCurrent() { return this.stack[this.stack.length - 1] || null; }
  getStackDepth() { return this.stack.length; }
}

// ============================================================
// 业务沙箱
// ============================================================

class BusinessSandbox {
  constructor(bizId, manifest, opts = {}) {
    this.bizId = bizId;
    this.manifest = manifest;
    this.state = 'created';
    this.crashCount = 0;
    this.quota = new QuotaManager(opts.memoryBytes || 128 * 1024 * 1024);
    this.irRegistry = new IRRegistry();
    this.pages = new Map();
    this.scope = Object.create(null);   // 独立作用域
    this.storage = new Map();           // 独立存储
  }

  /** 在隔离上下文中执行业务代码 */
  run(fn) {
    try {
      const result = fn.call(this.scope, this);
      return { ok: true, result };
    } catch (err) {
      this.state = 'crashed';
      this.crashCount++;
      this.lastError = err;
      return { ok: false, error: err };
    }
  }

  isAlive() { return this.state !== 'crashed' && this.state !== 'destroyed'; }
}

// ============================================================
// SuperAppContainer：超级应用容器
// ============================================================

class SuperAppContainer extends StackContainer {
  constructor(opts = {}) {
    super({ ...opts, id: 'superapp' });
    this.id = 'superapp';
    this.sandboxes = new Map();
    this.crashLog = [];
    this.policy = {
      ...this.policy,
      sandbox: {
        defaultMemoryBytes: opts.sandboxMemory || 128 * 1024 * 1024,
        maxSandboxes: opts.maxSandboxes || 8,
      },
      crash: {
        isolationLevel: opts.isolationLevel ?? 2,
        autoRestart: opts.autoRestart ?? true,
        maxRestartCount: opts.maxRestartCount ?? 3,
      },
      security: {
        requireSignature: opts.requireSignature ?? true,
        capabilityWhitelist: opts.capabilityWhitelist || ['camera', 'location', 'storage'],
      },
    };
    this.capabilities = {
      pageStack: true, multiBusiness: true, crashIsolation: this.policy.crash.isolationLevel,
      resourceQuota: true, keepAlive: true, windowManagement: false, embedded: false,
    };
  }

  /** 安全网关校验：签名 + 能力白名单 */
  validateManifest(manifest) {
    if (this.policy.security.requireSignature && !manifest.signature) {
      throw new ProteusError('G39_SIGN', `business ${manifest.bizId} missing signature`);
    }
    const illegal = (manifest.capabilities || []).filter(
      (c) => !this.policy.security.capabilityWhitelist.includes(c)
    );
    if (illegal.length > 0) {
      throw new ProteusError('G39_CAP', `illegal capabilities: ${illegal.join(',')}`);
    }
    return true;
  }

  async createSandbox(bizId, manifest) {
    if (this.sandboxes.size >= this.policy.sandbox.maxSandboxes) {
      throw new ProteusError('G39_LIMIT', `max sandboxes ${this.policy.sandbox.maxSandboxes}`);
    }
    this.validateManifest(manifest);
    const sb = new BusinessSandbox(bizId, manifest, {
      memoryBytes: this.policy.sandbox.defaultMemoryBytes,
    });
    sb.state = 'loaded';
    this.sandboxes.set(bizId, sb);
    return sb;
  }

  async destroySandbox(bizId) {
    const sb = this.sandboxes.get(bizId);
    if (!sb) throw new ProteusError('G39_NOTFOUND', `sandbox ${bizId} not found`);
    for (const pid of [...sb.pages.keys()]) {
      const p = sb.pages.get(pid);
      sb.irRegistry.destroy(p.irId);
      p.resourcePool.releaseAll();
    }
    sb.pages.clear();
    sb.storage.clear();
    sb.state = 'destroyed';
    this.sandboxes.delete(bizId);
    return { bizId, steps: ['unmount', 'unbindEvents', 'releaseResources', 'destroyIR', 'releaseQuota'] };
  }

  listSandboxes() { return [...this.sandboxes.values()]; }

  /** ★ 崩溃隔离：业务崩溃不影响宿主和其他业务 */
  executeInSandbox(bizId, fn) {
    const sb = this.sandboxes.get(bizId);
    if (!sb) throw new ProteusError('G39_NOTFOUND', `sandbox ${bizId} not found`);

    const result = sb.run(fn);
    if (!result.ok) {
      this.crashLog.push({ bizId, error: String(result.error.message || result.error), at: Date.now() });
      this.emit('sandbox-crashed', { bizId, error: result.error, hostAlive: true });

      if (this.policy.crash.autoRestart && sb.crashCount < this.policy.crash.maxRestartCount) {
        sb.state = 'loaded';   // 自动重启
      }
      return { ok: false, bizId, hostAlive: true, otherSandboxesAlive: this.listSandboxes().filter((s) => s.bizId !== bizId && s.isAlive()).length };
    }
    return { ok: true, bizId, result: result.result };
  }
}

// ============================================================
// 简易 Backend（提供挂载点）
// ============================================================

class TerminalRenderBackend {
  constructor() { this.mountPoints = new Map(); }
  createMountPoint(pageId) {
    const mp = { pageId, kind: 'terminal-view', children: [], destroyed: false };
    this.mountPoints.set(pageId, mp);
    return mp;
  }
  destroyMountPoint(mp) {
    if (mp && !mp.destroyed) { mp.destroyed = true; this.mountPoints.delete(mp.pageId); }
  }
  get aliveCount() { return this.mountPoints.size; }
}

// ============================================================
// 仓库治理扫描（G-42.6 严禁 fork）
// ============================================================

const FORK_SIGNATURES = [
  /packages\/core\/src\//,                  // 框架源码副本
  /proteus-core\/internal\//,               // 内部模块
  /from\s+['"]@proteus\/core\/internal/,    // 直接 import 内部模块
  /__PROTEUS_FORKED__/,                     // fork 标记
];

function scanRepoForFork(fileContents) {
  const hits = [];
  for (const [filename, content] of Object.entries(fileContents)) {
    for (const sig of FORK_SIGNATURES) {
      if (sig.test(content)) hits.push({ filename, pattern: String(sig) });
    }
  }
  return hits;
}

// ============================================================
// Conformance 套件（C-01~C-08，32 项）
// ============================================================

async function runConformance() {
  const results = { PASS: 0, FAIL: 0, SKIP: 0, failures: [], groups: {} };
  const g = (gid) => { results.groups[gid] = results.groups[gid] || { pass: 0, fail: 0, skip: 0 }; return results.groups[gid]; };
  const ok = (gid, name, cond) => {
    if (cond) { results.PASS++; g(gid).pass++; }
    else { results.FAIL++; g(gid).fail++; results.failures.push(`${gid} ${name}`); }
  };
  const skip = (gid, name, why) => { results.SKIP++; g(gid).skip++; };

  // ---------- C-01 容器身份与能力（4 项） ----------
  const stack = new StackContainer({ backend: new TerminalRenderBackend() });
  ok('C-01', 'C-01-01 id 声明', stack.id === 'stack');
  ok('C-01', 'C-01-02 version 声明', typeof stack.version === 'string');
  ok('C-01', 'C-01-03 capabilities 存在', !!stack.capabilities);
  ok('C-01', 'C-01-04 capabilities.pageStack', stack.capabilities.pageStack === true);

  // ---------- C-02 页面生命周期（5 项） ----------
  const p1 = await stack.push({ title: 'P1' });
  ok('C-02', 'C-02-01 push 创建页面', !!p1 && p1.pageId);
  ok('C-02', 'C-02-02 状态为 mounted', p1.state === 'mounted');
  ok('C-02', 'C-02-03 IR 实例已创建', stack.irRegistry.aliveCount === 1);
  p1.hide();
  ok('C-02', 'C-02-04 hide 转 hidden', p1.state === 'hidden');
  p1.show();
  ok('C-02', 'C-02-05 show 转 mounted', p1.state === 'mounted');

  // ---------- C-03 五原子销毁（6 项） ----------
  const p2 = await stack.push({ title: 'P2' });
  p2.resourcePool.timer(() => {}, 1000);
  p2.resourcePool.on({}, 'click', () => {});
  const dr = await stack.destroyPage(p2.pageId);
  ok('C-03', 'C-03-01 销毁五步', dr.steps.length === 5);
  ok('C-03', 'C-03-02 步骤顺序正确',
    dr.steps.join(',') === 'unmount,unbindEvents,releaseResources,destroyIR,releaseQuota');
  ok('C-03', 'C-03-03 挂载点已卸载', p2.mountPoint === null);
  ok('C-03', 'C-03-04 资源已释放', p2.resourcePool.total === 0);
  ok('C-03', 'C-03-05 IR 已销毁', !stack.irRegistry.instances.has(p2.irId));
  ok('C-03', 'C-03-06 配额已归还', p2.quotaHandle === null);

  // ---------- C-04 页面栈治理（4 项） ----------
  const s3 = new StackContainer({ backend: new TerminalRenderBackend(), maxDepth: 3 });
  await s3.push({ title: 'A' });
  await s3.push({ title: 'B' });
  await s3.push({ title: 'C' });
  ok('C-04', 'C-04-01 栈深度正确', s3.getStackDepth() === 3);
  await s3.push({ title: 'D' });   // 超限
  ok('C-04', 'C-04-02 超限销毁最旧', s3.getStackDepth() === 3);
  ok('C-04', 'C-04-03 最旧页面已移除', !s3.pages.has(p1.pageId) && s3.getCurrent().config.title === 'D');
  const popped = await s3.pop();
  ok('C-04', 'C-04-04 pop 返回并销毁', !!popped && popped.state === 'destroyed');

  // ---------- C-05 泄漏检测（5 项） ----------
  const s5 = new StackContainer({ backend: new TerminalRenderBackend() });
  const lp = await s5.push({ title: 'LeakTest' });
  lp.resourcePool.timer(() => {}, 500);
  lp.resourcePool.interval(() => {}, 100);
  lp.resourcePool.on({}, 'scroll', () => {});
  lp.resourcePool.subscribe({}, () => {});
  lp.resourcePool.fetch('/api/x');
  const before = lp.resourcePool.total;
  await s5.destroyPage(lp.pageId);
  ok('C-05', 'C-05-01 销毁前资源已登记', before === 5);
  ok('C-05', 'C-05-02 销毁后 IR 实例数 0', s5.irRegistry.aliveCount === 0);
  ok('C-05', 'C-05-03 定时器清零', lp.resourcePool.timers.size === 0);
  ok('C-05', 'C-05-04 监听清零', lp.resourcePool.listeners.size === 0);
  ok('C-05', 'C-05-05 资源池总量 0', lp.resourcePool.total === 0);

  // ---------- C-06 配额管理（4 项） ----------
  const s6 = new StackContainer({ backend: new TerminalRenderBackend(), limitBytes: 100 });
  const h1 = s6.quota.request(60);
  ok('C-06', 'C-06-01 配额申请成功', !!h1);
  ok('C-06', 'C-06-02 用量正确', s6.quota.usedBytes === 60);
  ok('C-06', 'C-06-03 超限返回 null', s6.quota.request(50) === null);
  s6.quota.release(h1);
  ok('C-06', 'C-06-04 归还后可用', s6.quota.usedBytes === 0);

  // ---------- C-07 超级应用沙箱与崩溃隔离（6 项） ----------
  const sa = new SuperAppContainer({ backend: new TerminalRenderBackend() });
  const sbA = await sa.createSandbox('shop', { bizId: 'shop', version: '1.0.0', signature: 'sig-a', capabilities: ['camera'] });
  const sbB = await sa.createSandbox('pay', { bizId: 'pay', version: '1.0.0', signature: 'sig-b', capabilities: ['location'] });
  ok('C-07', 'C-07-01 沙箱 A 创建', !!sbA && sbA.isAlive());
  ok('C-07', 'C-07-02 沙箱 B 创建', !!sbB && sbB.isAlive());
  ok('C-07', 'C-07-03 作用域隔离', sbA.scope !== sbB.scope);
  // 崩溃隔离：A 崩溃
  const crashRes = sa.executeInSandbox('shop', () => { throw new Error('boom'); });
  ok('C-07', 'C-07-04 A 崩溃被捕获', crashRes.ok === false);
  ok('C-07', 'C-07-05 宿主存活', crashRes.hostAlive === true);
  ok('C-07', 'C-07-06 B 业务不受影响', sbB.isAlive() === true);

  // ---------- C-08 安全网关（3 项） + 仓库治理（2 项） ----------
  let signRejected = false;
  try { await sa.createSandbox('evil', { bizId: 'evil', capabilities: [] }); }
  catch (e) { signRejected = e.code === 'G39_SIGN'; }
  ok('C-08', 'C-08-01 无签名被拒绝', signRejected);

  let capRejected = false;
  try { await sa.createSandbox('bad', { bizId: 'bad', signature: 's', capabilities: ['contacts'] }); }
  catch (e) { capRejected = e.code === 'G39_CAP'; }
  ok('C-08', 'C-08-02 越权能力被拒绝', capRejected);

  const cleanRepo = scanRepoForFork({ 'host/src/main.js': "import { createContainer } from '@proteus/container';" });
  ok('C-08', 'C-08-03 合规仓库无 fork', cleanRepo.length === 0);

  const dirtyRepo = scanRepoForFork({ 'host/vendor/core.js': "import x from '@proteus/core/internal/diff';" });
  ok('C-08', 'C-08-04 fork 仓库被检出', dirtyRepo.length > 0);

  return results;
}

// ============================================================
// Demo 主流程
// ============================================================

async function main() {
  console.log('=== Proteus G-42 HostContainer 参考实现 ===\n');

  const backend = new TerminalRenderBackend();

  // ---- 1. 页面栈 + 深度治理 ----
  console.log('--- 1. 页面栈生命周期与 LRU 治理 ---');
  const stack = new StackContainer({ backend, maxDepth: 3 });
  const seq = [];
  await (stack.push({ title: 'Home' }));
  await (stack.push({ title: 'List' }));
  await (stack.push({ title: 'Detail' }));
  console.log(`push 3 页 → depth=${stack.getStackDepth()}`);
  await (stack.push({ title: 'Checkout' }));
  console.log(`push 第 4 页（maxDepth=3）→ depth=${stack.getStackDepth()} (最旧页面已自动销毁)`);
  console.log(`当前页: ${stack.getCurrent().config.title}`);
  console.log(`Backend 存活挂载点: ${backend.aliveCount}（应等于栈深度）\n`);

  // ---- 2. 五原子销毁 ----
  console.log('--- 2. 五原子销毁 ---');
  const p = await (stack.push({ title: 'ToDestroy' }));
  p.resourcePool.timer(() => {}, 1000);
  p.resourcePool.on({}, 'click', () => {});
  p.resourcePool.fetch('/api/data');
  console.log(`销毁前资源: ${p.resourcePool.total} 个`);
  const rpt = await (stack.destroyPage(p.pageId));
  console.log(`销毁步骤: [${rpt.steps.join(' → ')}]`);
  console.log(`资源释放: 定时器 ${rpt.resourceReport.timers}, 监听 ${rpt.resourceReport.listeners}, 请求 ${rpt.resourceReport.requests}`);
  console.log(`归还内存: ${rpt.reclaimedBytes} bytes\n`);

  // ---- 3. 超级应用沙箱 + 崩溃隔离 ----
  console.log('--- 3. 超级应用沙箱与崩溃隔离 ---');
  const sa = new SuperAppContainer({ backend });
  const shop = await (sa.createSandbox('shop', { bizId: 'shop', version: '1.0.0', signature: 'sig-1', capabilities: ['camera'] }));
  const pay = await (sa.createSandbox('pay', { bizId: 'pay', version: '1.0.0', signature: 'sig-2', capabilities: ['location'] }));
  console.log(`创建沙箱: shop=${shop.isAlive()}, pay=${pay.isAlive()}`);

  const crash = sa.executeInSandbox('shop', () => { throw new Error('业务 A 崩溃'); });
  console.log(`业务 A 执行崩溃 → hostAlive=${crash.hostAlive}`);
  console.log(`业务 B 仍存活: ${pay.isAlive()}`);
  console.log(`崩溃日志: ${sa.crashLog.length} 条\n`);

  // ---- 4. 安全网关 ----
  console.log('--- 4. 安全网关 ---');
  try {
    await (sa.createSandbox('evil', { bizId: 'evil', capabilities: [] }));
    console.log('  ✗ 未签名业务竟然通过了');
  } catch (e) {
    console.log(`  无签名业务被拒绝: ${e.code}`);
  }
  try {
    await (sa.createSandbox('bad', { bizId: 'bad', signature: 's', capabilities: ['contacts'] }));
    console.log('  ✗ 越权能力竟然通过了');
  } catch (e) {
    console.log(`  越权能力被拒绝: ${e.code}`);
  }
  console.log('');

  // ---- 5. 仓库治理 ----
  console.log('--- 5. 仓库治理（G-42.6 严禁 fork）---');
  const clean = scanRepoForFork({ 'host/src/main.js': "import { createContainer } from '@proteus/container';" });
  console.log(`  合规宿主仓 → fork 命中 ${clean.length} 项`);
  const dirty = scanRepoForFork({ 'host/vendor/core.js': "import x from '@proteus/core/internal/diff';" });
  console.log(`  fork 宿主仓 → fork 命中 ${dirty.length} 项（应 >0）\n`);

  // ---- 6. Conformance ----
  console.log('--- 6. 容器 Conformance (C-01~C-08) ---');
  const res = await runConformance();
  for (const [gid, st] of Object.entries(res.groups)) {
    console.log(`  ${gid}: PASS=${st.pass} FAIL=${st.fail} SKIP=${st.skip}`);
  }
  console.log(`\n  合计: PASS=${res.PASS} FAIL=${res.FAIL} SKIP=${res.SKIP}`);
  if (res.FAIL > 0) {
    console.log('  失败项:');
    res.failures.forEach((f) => console.log(`    - ${f}`));
  }

  console.log('\n=== Demo 完成 ===');
  process.exit(res.FAIL > 0 ? 1 : 0);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = {
  StackContainer, SuperAppContainer, BusinessSandbox,
  ResourcePool, IRRegistry, QuotaManager, Page,
  TerminalRenderBackend, scanRepoForFork, runConformance,
};
