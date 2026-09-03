/**
 * Proteus G-43 资源所有权模型 —— 可运行参考实现
 *
 * 零依赖，直接 `node ownership-reference.cjs` 运行。
 *
 * 验证内容：
 *   1. Owned<T> 的 Move 语义（use-after-move 拦截）
 *   2. Borrow<T> 的作用域与失效
 *   3. Weak<T> 打破循环引用
 *   4. Managed<T> 框架代管自动释放
 *   5. Drop 五阶段协议
 *   6. 所有权图与泄漏路径检测
 *   7. 跨设备所有权转移（鸿蒙分布式启发）
 *   8. PSS 借用检查规则的运行时等价验证
 *   9. 页面销毁强制回收（与 G-42 五原子销毁集成）
 */

'use strict';

// ============================================================
// 0. 错误类型
// ============================================================

class OwnershipError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'OwnershipError';
    this.code = code;
    Object.assign(this, extra);
  }
}

const Errors = {
  useAfterMove: (id, movedTo) =>
    new OwnershipError('use_after_move', `资源 ${id} 已转移给 ${movedTo}，不可再访问`, { resourceId: id, movedTo }),
  useAfterDrop: (id) =>
    new OwnershipError('use_after_drop', `资源 ${id} 已释放，不可再访问`, { resourceId: id }),
  doubleMove: (id) =>
    new OwnershipError('double_move', `资源 ${id} 已转移过，不可重复转移`, { resourceId: id }),
  hasActiveBorrows: (id, count) =>
    new OwnershipError('has_active_borrows', `资源 ${id} 有 ${count} 个活跃借用，不可释放`, { resourceId: id, count }),
  alreadyDropped: (id) =>
    new OwnershipError('already_dropped', `资源 ${id} 已释放`, { resourceId: id }),
  notTransferable: (id, reason) =>
    new OwnershipError('resource_not_transferable', `资源 ${id} 不可转移：${reason}`, { resourceId: id, reason }),
  deviceUnreachable: (deviceId) =>
    new OwnershipError('device_unreachable', `设备 ${deviceId} 不可达`, { deviceId }),
};

// ============================================================
// 1. 所有权图（DevTools 数据源）
// ============================================================

class OwnershipGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = [];
    this._nextId = 1;
  }

  nextId() { return `res_${this._nextId++}`; }

  register({ id, type, byteSize, owner, sourceLocation }) {
    this.nodes.set(id, {
      id, type, byteSize,
      owner: owner ?? null,       // null = 无主（异常，会被检测）
      state: 'alive',
      createdAt: Date.now(),
      sourceLocation: sourceLocation ?? null,
    });
    if (owner) {
      this.edges.push({ kind: 'owns', from: owner, to: id });
    }
    return this.nodes.get(id);
  }

  addEdge(edge) { this.edges.push(edge); }

  removeNode(id) {
    this.nodes.delete(id);
    this.edges = this.edges.filter(e => e.to !== id && e.from !== id);
  }

  /** 找从 owner 出发的所有资源 */
  resourcesOf(owner) {
    return [...this.nodes.values()].filter(n => n.owner === owner && n.state === 'alive');
  }

  /** 无主资源检测（V-05） */
  findOrphans() {
    return [...this.nodes.values()].filter(n => n.owner === null && n.state === 'alive');
  }

  /** 泄漏检测：页面销毁后仍存活的资源 + 反向引用链 */
  detectLeaks(destroyedScope) {
    const leaked = [...this.nodes.values()].filter(
      n => n.owner === destroyedScope && n.state === 'alive'
    );
    return leaked.map(n => ({
      resourceId: n.id,
      type: n.type,
      byteSize: n.byteSize,
      sourceLocation: n.sourceLocation,
      // 反向追踪：谁还在引用它
      referenceChain: this._backTrace(n.id),
    }));
  }

  _backTrace(resourceId) {
    const chain = [];
    const visited = new Set();
    const walk = (id) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const e of this.edges) {
        if (e.to === id && e.from !== id) {
          chain.push(`${e.from} --${e.kind}--> ${id}`);
          walk(e.from);
        }
      }
    };
    walk(resourceId);
    return chain;
  }

  stats() {
    const alive = [...this.nodes.values()].filter(n => n.state === 'alive');
    return {
      total: this.nodes.size,
      alive: alive.length,
      moved: [...this.nodes.values()].filter(n => n.state === 'moved').length,
      dropped: [...this.nodes.values()].filter(n => n.state === 'dropped').length,
      totalBytes: alive.reduce((s, n) => s + n.byteSize, 0),
      edges: this.edges.length,
    };
  }
}

// ============================================================
// 2. Owned<T> —— 唯一所有权
// ============================================================

class Owned {
  constructor({ id, type, value, byteSize, owner, graph, sourceLocation, transferable = true, releaseHook = null }) {
    this.__brand = 'Owned';
    this.id = id;
    this.resourceType = type;
    this._value = value;
    this.byteSize = byteSize;
    this.owner = owner;
    this._graph = graph;
    this._state = 'alive';
    this._activeBorrows = 0;
    this._borrows = new Set();
    this._transferable = transferable;
    this._releaseHook = releaseHook;
    this._movedTo = null;

    graph.register({ id, type, byteSize, owner, sourceLocation });
  }

  get state() { return this._state; }
  get activeBorrows() { return this._activeBorrows; }

  _assertAlive(op) {
    if (this._state === 'moved') throw Errors.useAfterMove(this.id, this._movedTo);
    if (this._state === 'dropped') throw Errors.useAfterDrop(this.id);
  }

  read() { this._assertAlive('read'); return this._value; }
  write() { this._assertAlive('write'); return this._value; }

  /** ★ Move：转移所有权 */
  transferTo(target) {
    this._assertAlive('transferTo');
    if (this._activeBorrows > 0) {
      throw Errors.hasActiveBorrows(this.id, this._activeBorrows);
    }
    this._movedTo = target;
    this._state = 'moved';

    // 所有权图：改边
    this._graph.edges = this._graph.edges.filter(
      e => !(e.kind === 'owns' && e.to === this.id)
    );
    this._graph.addEdge({ kind: 'owns', from: target, to: this.id });

    const node = this._graph.nodes.get(this.id);
    if (node) { node.owner = target; node.state = 'alive'; }
    this.owner = target;
    return { ok: true };
  }

  /** ★ Borrow：临时借用 */
  borrow(scopeName = 'anonymous') {
    this._assertAlive('borrow');
    const b = new Borrow(this, scopeName, this._graph);
    this._activeBorrows++;
    this._borrows.add(b);
    this._graph.addEdge({ kind: 'borrows', from: scopeName, to: this.id, since: Date.now() });
    return b;
  }

  /** ★ Weak：弱引用 */
  weak() { return new Weak(this); }

  /** ★ Drop：确定性释放（五阶段） */
  drop({ force = false } = {}) {
    return this._dropProtocol(force);
  }

  _dropProtocol(force) {
    // ① prepare —— 检查前置条件
    if (this._state === 'dropped') return { ok: false, error: Errors.alreadyDropped(this.id) };
    if (this._state === 'moved') return { ok: false, error: Errors.useAfterMove(this.id, this._movedTo) };
    if (!force && this._activeBorrows > 0) {
      return { ok: false, error: Errors.hasActiveBorrows(this.id, this._activeBorrows) };
    }

    // ② invalidate —— 失效所有借用
    let invalidated = 0;
    for (const b of this._borrows) {
      if (b.valid) { b._invalidate(); invalidated++; }
    }
    this._borrows.clear();
    this._activeBorrows = 0;

    // ③ release —— 实际释放
    let freedBytes = 0;
    if (this._releaseHook) {
      try { this._releaseHook(this._value); } catch (_) { /* 记录但不阻断 */ }
    }
    freedBytes = this.byteSize;

    // ④ unregister —— 从所有权图移除
    this._state = 'dropped';
    const node = this._graph.nodes.get(this.id);
    if (node) node.state = 'dropped';
    this._graph.removeNode(this.id);

    // ⑤ reclaim —— 归还配额
    const quota = QuotaTracker.release(this.owner, freedBytes);

    return { ok: true, freedBytes, freedHandles: 1, invalidatedBorrows: invalidated, quota };
  }

  /** ★ 跨设备转移（鸿蒙分布式启发） */
  async transferToDevice(deviceId, deviceRegistry) {
    this._assertAlive('transferToDevice');

    if (!this._transferable) {
      return { ok: false, error: Errors.notTransferable(this.id, '该资源与设备强绑定') };
    }
    if (!deviceRegistry.isReachable(deviceId)) {
      return { ok: false, error: Errors.deviceUnreachable(deviceId) };
    }

    // 原子性：先确认目标可接收，再释放本地
    const accepted = await deviceRegistry.receive(deviceId, {
      id: this.id, type: this.resourceType,
      byteSize: this.byteSize, payload: this._value,
    });

    if (!accepted.ok) {
      // 失败：本地保持所有权（原子性保证）
      return { ok: false, error: accepted.error };
    }

    // 成功：本地 drop（Move 语义）
    this._dropProtocol(true);
    return { ok: true, remoteHandle: { deviceId, resourceId: this.id } };
  }
}

// ============================================================
// 3. Borrow<T>
// ============================================================

class Borrow {
  constructor(source, scopeName, graph) {
    this.__brand = 'Borrow';
    this._source = source;
    this._scopeName = scopeName;
    this._graph = graph;
    this._valid = true;
    this.borrowedAt = Date.now();
  }
  get valid() { return this._valid && this._source.state === 'alive'; }
  get durationMs() { return Date.now() - this.borrowedAt; }
  get() {
    if (!this.valid) return undefined;
    return this._source.read();
  }
  release() {
    if (!this._valid) return;
    this._invalidate();
    this._source._borrows.delete(this);
    this._source._activeBorrows = Math.max(0, this._source._activeBorrows - 1);
  }
  _invalidate() { this._valid = false; }
}

// ============================================================
// 4. Weak<T>
// ============================================================

class Weak {
  constructor(source) {
    this.__brand = 'Weak';
    this._source = source;
  }
  get alive() { return this._source.state === 'alive'; }
  upgrade() {
    if (!this.alive) return undefined;
    return this._source.borrow('weak-upgrade');
  }
}

// ============================================================
// 5. Managed<T> —— 框架代管（默认路径）
// ============================================================

class ManagedResource {
  constructor({ value, disposeFn, owner, registry }) {
    this.__brand = 'Managed';
    this.value = value;
    this._disposeFn = disposeFn;
    this.owner = owner;
    this.disposed = false;
    registry.add(this);
  }
  dispose() {
    if (this.disposed) return;
    this._disposeFn?.(this.value);
    this.disposed = true;
  }
}

class ManagedRegistry {
  constructor() { this.items = []; }
  add(item) { this.items.push(item); }
  /** 页面销毁时批量释放（G-42 步骤 3） */
  releaseAll(owner) {
    let n = 0;
    for (const it of this.items) {
      if (it.owner === owner && !it.disposed) { it.dispose(); n++; }
    }
    this.items = this.items.filter(it => !(it.owner === owner && it.disposed));
    return n;
  }
  activeCount(owner) {
    return this.items.filter(it => it.owner === owner && !it.disposed).length;
  }
}

// ============================================================
// 6. 配额记账（与 G-39/G-42 联动）
// ============================================================

const QuotaTracker = {
  _used: new Map(),
  _limit: new Map(),

  setLimit(scope, bytes) { this._limit.set(scope, bytes); },
  used(scope) { return this._used.get(scope) ?? 0; },
  limit(scope) { return this._limit.get(scope) ?? Infinity; },

  acquire(scope, bytes) {
    const used = this.used(scope);
    if (used + bytes > this.limit(scope)) {
      return { ok: false, error: { code: 'quota_exceeded', limit: this.limit(scope), requested: bytes } };
    }
    this._used.set(scope, used + bytes);
    return { ok: true };
  },

  release(scope, bytes) {
    const used = this.used(scope);
    this._used.set(scope, Math.max(0, used - bytes));
    return { freedBytes: bytes, remaining: this.used(scope) };
  },
};

// ============================================================
// 7. 页面上下文（业务 API 入口）
// ============================================================

class PageContext {
  constructor(name, graph, managedRegistry) {
    this.name = name;
    this._graph = graph;
    this._managed = managedRegistry;
  }

  /** 显式所有权分配 */
  alloc(byteSize, { type = 'shared-buffer', transferable = true, sourceLocation = null } = {}) {
    const id = this._graph.nextId();
    const q = QuotaTracker.acquire(this.name, byteSize);
    if (!q.ok) throw new OwnershipError(q.error.code, `配额不足`, q.error);

    return new Owned({
      id, type, value: new ArrayBuffer(byteSize), byteSize,
      owner: this.name, graph: this._graph,
      sourceLocation,
      transferable,
      releaseHook: () => {},
    });
  }

  /** 框架代管资源（默认路径，零心智负担） */
  timer(ms, fn) {
    let disposed = false;
    // 模拟：不真跑定时器，只登记
    return new ManagedResource({
      value: { ms, fn },
      disposeFn: () => { disposed = true; },
      owner: this.name,
      registry: this._managed,
    });
  }

  subscribe(channel, fn) {
    return new ManagedResource({
      value: { channel, fn },
      disposeFn: () => {},
      owner: this.name,
      registry: this._managed,
    });
  }

  weak(resource) { return new Weak(resource); }
}

// ============================================================
// 8. 页面销毁（G-42 五原子销毁 + G-43 Drop 协议）
// ============================================================

function destroyPage(pageName, graph, managedRegistry) {
  const steps = [];

  // 1. unmount
  steps.push('unmount');

  // 2. unbindEvents
  steps.push('unbindEvents');

  // 3. releaseResources → ★ 委托给 G-43 Drop 协议
  const resources = graph.resourcesOf(pageName);
  let freedBytes = 0, freedCount = 0;
  for (const node of resources) {
    // 通过 forceDrop 强制释放（忽略活跃借用）
    const res = _findOwnedById(node.id);
    if (res) {
      const r = res.drop({ force: true });
      if (r.ok) { freedBytes += r.freedBytes; freedCount++; }
    }
  }
  steps.push('releaseResources');

  // Managed 资源自动释放
  const managedFreed = managedRegistry.releaseAll(pageName);
  steps.push('releaseManaged');

  // 4. destroyIR
  steps.push('destroyIR');

  // 5. releaseQuota
  const remaining = QuotaTracker.used(pageName);
  QuotaTracker.release(pageName, remaining);
  steps.push('releaseQuota');

  return { steps, freedBytes, freedCount, managedFreed, remainingQuota: QuotaTracker.used(pageName) };
}

// 资源实例索引（模拟框架内部持有）
const _registry = new Map();
function _findOwnedById(id) { return _registry.get(id) ?? null; }

// ============================================================
// 9. 跨设备注册表（模拟）
// ============================================================

class DeviceRegistry {
  constructor() { this.devices = new Map(); this.received = []; }
  register(id) { this.devices.set(id, { id, reachable: true }); }
  setReachable(id, v) { const d = this.devices.get(id); if (d) d.reachable = v; }
  isReachable(id) { return this.devices.get(id)?.reachable ?? false; }
  async receive(deviceId, payload) {
    if (!this.isReachable(deviceId)) return { ok: false, error: Errors.deviceUnreachable(deviceId) };
    this.received.push({ deviceId, ...payload });
    return { ok: true };
  }
}

// ============================================================
// 10. 演示 + 自检
// ============================================================

function main() {
  const results = [];
  const ok = (name, cond, detail = '') => {
    results.push({ name, pass: !!cond, detail });
    console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
  };
  const throws = (name, fn, expectCode) => {
    try {
      fn();
      results.push({ name, pass: false, detail: `期望抛错 ${expectCode}，但未抛` });
      console.log(`  ✗ ${name}  (期望抛错 ${expectCode}，但未抛)`);
    } catch (e) {
      const pass = e.code === expectCode;
      results.push({ name, pass, detail: e.code });
      console.log(`  ${pass ? '✓' : '✗'} ${name}  (${e.code})`);
    }
  };

  // ---------- 全局 ----------
  const graph = new OwnershipGraph();
  const managed = new ManagedRegistry();
  QuotaTracker.setLimit('PageA', 32 * 1024 * 1024);
  QuotaTracker.setLimit('PageB', 32 * 1024 * 1024);

  const pageA = new PageContext('PageA', graph, managed);
  const pageB = new PageContext('PageB', graph, managed);

  // 原始 alloc 包装，登记到 _registry 供 destroyPage 查找
  const origAllocA = pageA.alloc.bind(pageA);
  pageA.alloc = (...args) => { const r = origAllocA(...args); _registry.set(r.id, r); return r; };
  const origAllocB = pageB.alloc.bind(pageB);
  pageB.alloc = (...args) => { const r = origAllocB(...args); _registry.set(r.id, r); return r; };

  console.log('\n=== 1. Owned<T> Move 语义 ===');
  const buf = pageA.alloc(8 * 1024 * 1024, { sourceLocation: 'ProductCard.vue:47' });
  ok('O-00 分配成功', buf.state === 'alive' && buf.byteSize === 8 * 1024 * 1024);
  const mv = buf.transferTo('PageB');
  ok('O-01 Move 后原所有者状态 = moved', buf.state === 'moved');
  throws('O-01 use-after-move 被拦截', () => buf.read(), 'use_after_move');
  throws('O-02 重复转移被拒绝', () => buf.transferTo('PageC'), 'use_after_move');

  console.log('\n=== 2. Borrow<T> 作用域与失效 ===');
  const buf2 = pageB.alloc(2 * 1024 * 1024, { sourceLocation: 'Player.vue:12' });
  const b1 = buf2.borrow('ComponentX');
  ok('O-03 借用有效', b1.valid === true);
  ok('O-03 借用计数 = 1', buf2.activeBorrows === 1);
  const dropResult = buf2.drop();
  ok('O-05 有活跃借用时 drop 被拒', dropResult.ok === false && dropResult.error.code === 'has_active_borrows',
     `(${dropResult.error?.code})`);
  b1.release();
  ok('O-04 借用释放后计数归零', buf2.activeBorrows === 0);
  const dropResult2 = buf2.drop();
  ok('O-04 drop 成功', dropResult2.ok === true, `释放 ${dropResult2.freedBytes} bytes`);
  ok('O-04 借用失效', b1.valid === false);

  console.log('\n=== 3. Weak<T> 打破循环 ===');
  const buf3 = pageB.alloc(1 * 1024 * 1024);
  const w = buf3.weak();
  ok('O-06 Weak 存活', w.alive === true);
  const d3 = buf3.drop();
  ok('O-06 Weak 不阻止释放', d3.ok === true);
  ok('O-06 释放后 Weak 失活', w.alive === false);
  ok('O-06 Weak upgrade 返回 undefined', w.upgrade() === undefined);

  console.log('\n=== 4. Managed<T> 框架代管自动释放 ===');
  pageA.timer(1000, () => {});
  pageA.subscribe('update', () => {});
  pageA.timer(2000, () => {});
  ok('O-07 Managed 资源已登记', managed.activeCount('PageA') === 3, `3 个`);
  const freedManaged = managed.releaseAll('PageA');
  ok('O-07 页面销毁后自动释放', freedManaged === 3 && managed.activeCount('PageA') === 0,
     `释放 ${freedManaged} 个`);

  console.log('\n=== 5. Drop 五阶段协议 ===');
  const buf4 = pageB.alloc(4 * 1024 * 1024, { sourceLocation: 'Uploader.vue:88' });
  const beforeQuota = QuotaTracker.used('PageB');
  const d4 = buf4.drop();
  ok('D-01 drop 成功', d4.ok === true);
  ok('D-05 配额归还', QuotaTracker.used('PageB') === beforeQuota - 4 * 1024 * 1024,
     `${beforeQuota} → ${QuotaTracker.used('PageB')}`);
  throws('D-08 重复 drop 被拒', () => { const r = buf4.drop(); if (!r.ok) throw r.error; }, 'already_dropped');

  console.log('\n=== 6. 所有权图与泄漏检测 ===');
  const buf5 = pageA.alloc(16 * 1024 * 1024, { sourceLocation: 'Leaky.vue:23' });
  // 模拟：PageA 即将销毁，但 buf5 未释放 → 泄漏
  const leaks = graph.detectLeaks('PageA');
  const leakFound = leaks.find(l => l.resourceId === buf5.id);
  ok('V-02 泄漏路径可定位', !!leakFound && leakFound.sourceLocation === 'Leaky.vue:23',
     leakFound ? `📍 ${leakFound.sourceLocation}` : '未找到');
  ok('V-01 图统计一致', graph.stats().alive > 0, JSON.stringify(graph.stats()));

  console.log('\n=== 7. 跨设备所有权转移（鸿蒙分布式启发）===');
  const devices = new DeviceRegistry();
  devices.register('deviceB');
  devices.register('deviceC');
  devices.setReachable('deviceC', false);

  const buf6 = pageB.alloc(2 * 1024 * 1024, { transferable: true });
  buf6.transferToDevice('deviceB', devices).then(r1 => {
    ok('O-08 跨设备转移成功', r1.ok === true, r1.ok ? `→ ${r1.remoteHandle.deviceId}` : r1.error.code);
    ok('O-08 转移后原端已 drop（Move 语义）', buf6.state === 'dropped');

    // 不可达设备
    const buf7 = pageB.alloc(1 * 1024 * 1024, { transferable: true });
    return buf7.transferToDevice('deviceC', devices).then(r2 => {
      ok('O-08 不可达设备转移失败', r2.ok === false && r2.error.code === 'device_unreachable');
      ok('O-08 失败后原端保留所有权（原子性）', buf7.state === 'alive');

      // 不可转移资源
      const cam = pageB.alloc(1024, { type: 'camera-handle', transferable: false });
      return cam.transferToDevice('deviceB', devices).then(r3 => {
        ok('O-08 不可转移资源被拒绝', r3.ok === false && r3.error.code === 'resource_not_transferable');
        ok('O-08 拒绝后原端保留所有权', cam.state === 'alive');

        finishDemo();
      });
    });
  });

  function finishDemo() {
    console.log('\n=== 8. 页面销毁：G-42 五原子 + G-43 强制回收 ===');
    const buf8 = pageA.alloc(8 * 1024 * 1024, { sourceLocation: 'Gallery.vue:5' });
    const borrow8 = buf8.borrow('GalleryView');   // 故意留一个活跃借用
    ok('销毁前：PageA 有存活资源', graph.resourcesOf('PageA').length > 0,
       `${graph.resourcesOf('PageA').length} 个`);

    const destroyResult = destroyPage('PageA', graph, managed);
    ok('C-06 销毁步骤完整（五原子）', destroyResult.steps.length >= 5,
       destroyResult.steps.join(' → '));
    ok('C-06 强制回收（忽略活跃借用）', destroyResult.freedCount >= 1,
       `释放 ${destroyResult.freedCount} 个 / ${destroyResult.freedBytes} bytes`);
    ok('C-06 销毁后 PageA 资源归零', graph.resourcesOf('PageA').length === 0);
    ok('C-06 强制回收后借用失效', borrow8.valid === false);
    ok('C-06 配额完全归还', destroyResult.remainingQuota === 0);

    // ---------- 汇总 ----------
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    console.log('\n' + '='.repeat(56));
    console.log(`结果：PASS=${passed}  FAIL=${failed}`);
    console.log('='.repeat(56));
    if (failed > 0) {
      console.log('\n失败项：');
      results.filter(r => !r.pass).forEach(r => console.log(`  ✗ ${r.name}  ${r.detail}`));
    }
    console.log('\n最终所有权图统计：', JSON.stringify(graph.stats(), null, 2));
    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
