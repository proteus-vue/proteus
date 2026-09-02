import { pathToFileURL } from 'node:url'

/**
 * G-40 执行载体参考实现
 *
 * 提供两个可运行的执行载体，证明 ProteusExecutionCarrier SPI 可执行：
 *   1. JSICarrier      —— 模拟 JSI 路径（有线程亲和性、跨界成本、无真并发）
 *   2. AOTCarrier      —— 模拟 AOT 原生路径（无边界、真并发、支持实时）
 *
 * 对照原则 #11：可插拔必须有 ≥2 个参考实现。
 *
 * 运行：node carrier-reference.js
 */

'use strict';

// ============================================================
// 结果类型（对齐 G-28 的 Result<T>）
// ============================================================
const Ok = (value) => ({ ok: true, value });
const Err = (code, message) => ({ ok: false, error: { code, message } });

// ============================================================
// 共享缓冲区（G-40-C 零拷贝）
// ============================================================
class SharedBuffer {
  constructor(byteLength, isShared) {
    this._buf = new ArrayBuffer(byteLength);
    this._view = new Uint8Array(this._buf);
    this._isShared = isShared;
    this._released = false;
    this._refs = 1;
  }

  get byteLength() { return this._buf.byteLength; }
  get isShared() { return this._isShared; }
  get released() { return this._released; }

  /** CMP047：不得 slice，必须返回底层视图 */
  asArrayBuffer() {
    if (this._released) throw new Error('SharedBuffer already released');
    return this._buf;   // 直接返回底层，无拷贝
  }

  view() {
    if (this._released) throw new Error('SharedBuffer already released');
    return this._view;
  }

  retain() { this._refs++; return this; }

  release() {
    if (this._released) return;
    this._refs--;
    if (this._refs <= 0) this._released = true;
  }
}

// ============================================================
// 指标收集（G-40.6）
// ============================================================
class Metrics {
  constructor() {
    this.crossBoundaryCalls = 0;
    this.batchCommits = 0;
    this.batchedOps = 0;
    this.zeroCopyRequests = 0;
    this.zeroCopyHits = 0;
    this.rtJsDrivenViolations = 0;
  }

  /** 平均批量：每次批处理提交包含多少操作（= 一次跨界干了多少活） */
  get avgBatchSize() {
    return this.batchCommits === 0 ? 0 : this.batchedOps / this.batchCommits;
  }

  /**
   * 跨界降频比 = 完成的操作总数 / 实际跨界次数
   *   操作总数 = 单次调用(crossBoundaryCalls) + 批处理内操作(batchedOps)
   *   跨界次数 = 单次调用(crossBoundaryCalls) + 批处理提交(batchCommits)
   * 纯批处理场景：100 ops / 1 次跨界 = 100
   */
  get reductionRatio() {
    const ops = this.crossBoundaryCalls + this.batchedOps;
    const crossings = this.crossBoundaryCalls + this.batchCommits;
    return crossings === 0 ? 0 : ops / crossings;
  }

  get zeroCopyHitRate() {
    return this.zeroCopyRequests === 0 ? 0 : this.zeroCopyHits / this.zeroCopyRequests;
  }

  snapshot() {
    return {
      crossBoundaryCalls: this.crossBoundaryCalls,
      batchCommits: this.batchCommits,
      batchedOps: this.batchedOps,
      avgBatchSize: Number(this.avgBatchSize.toFixed(2)),
      reductionRatio: Number(this.reductionRatio.toFixed(2)),
      zeroCopyRequests: this.zeroCopyRequests,
      zeroCopyHits: this.zeroCopyHits,
      zeroCopyHitRate: Number(this.zeroCopyHitRate.toFixed(2)),
      rtJsDrivenViolations: this.rtJsDrivenViolations,
    };
  }
}

// ============================================================
// 基类：通用能力
// ============================================================
class BaseCarrier {
  constructor(id) {
    this.id = id;
    this._modules = new Map();
    this._nextHandle = 1;
    this._metrics = new Metrics();
    this._initialized = false;
  }

  get metrics() { return this._metrics; }
  getMetrics() { return this._metrics.snapshot(); }

  _recordBoundary() { this._metrics.crossBoundaryCalls++; }

  async initialize() {
    if (this._initialized) return Ok(true);
    this._initialized = true;
    return Ok(true);
  }

  dispose() {
    this._modules.clear();
    this._initialized = false;
    return Ok(true);
  }

  /** 装载产物 */
  load(artifact) {
    if (!this._initialized) throw new Error('carrier not initialized');
    const handle = { id: `mod_${this._nextHandle++}`, carrier: this.id };
    this._modules.set(handle.id, { artifact, exports: artifact.exports || {} });
    return handle;
  }

  unload(handle) {
    this._modules.delete(handle.id);
    return Ok(true);
  }

  // 子类必须实现
  /* eslint-disable no-unused-vars */
  invoke(handle, exportName, args) { throw new Error('not implemented'); }
  invokeBatch(ops) { throw new Error('not implemented'); }
  allocShared(size) { throw new Error('not implemented'); }
  /* eslint-enable no-unused-vars */
}

// ============================================================
// 载体 1：JSI（模拟 JS 引擎路径）
// 特征：有跨界成本、有线程亲和性、无真并发、不支持实时
// ============================================================
class JSICarrier extends BaseCarrier {
  constructor(opts = {}) {
    super('jsi-hermes');
    // 模拟跨界成本（ns/次），默认取实测中位
    this._scalarCost = opts.scalarCost ?? 27;
    this._objectCost = opts.objectCost ?? 181;
    this._workers = new Map();
    this._maxWorkers = 4;
  }

  get capabilities() {
    return {
      costProfile: { scalarCall: this._scalarCost, objectProperty: this._objectCost, measured: true },
      zeroCopy: { supported: true, mechanism: 'arraybuffer', maxSize: 64 * 1024 * 1024 },
      concurrency: {
        trueConcurrency: false,
        threadAffinity: true,     // ★ 批评三：线程亲和性
        workers: true,
        maxWorkers: this._maxWorkers,
      },
      realtime: { capable: false, realtimePriority: false },  // ★ 不支持实时
      dynamism: { hotReload: true, eval: true, dynamicImport: true },
      artifactTypes: ['js-bundle', 'bytecode'],
      tier: 1,
    };
  }

  invoke(handle, exportName, args = []) {
    this._recordBoundary();
    const mod = this._modules.get(handle.id);
    if (!mod) return Err('module_not_found', `no module ${handle.id}`);
    const fn = mod.exports[exportName];
    if (typeof fn !== 'function') return Err('export_not_found', exportName);
    try {
      return Ok(fn(...args));
    } catch (e) {
      return Err('invoke_failed', e.message);
    }
  }

  async invokeAsync(handle, exportName, args = []) {
    return this.invoke(handle, exportName, args);
  }

  /**
   * 批处理：一次跨界执行多个操作
   * 关键：只计 1 次跨界，但记录 N 个操作
   */
  invokeBatch(ops) {
    if (!Array.isArray(ops)) return [Err('invalid_ops', 'ops must be array')];
    this._metrics.batchCommits++;
    this._metrics.batchedOps += ops.length;

    const results = [];
    for (const op of ops) {
      switch (op.kind) {
        case 'load': {
          const h = this.load(op.artifact);
          results.push(Ok(h));
          break;
        }
        case 'invoke': {
          results.push(this.invoke(op.handle, op.exportName, op.args || []));
          break;
        }
        case 'write': {
          // ★ 批处理内部操作不再单独跨界（整批只算 1 次，已在开头计入 batchCommits）
          const mod = this._modules.get(op.handle.id);
          if (!mod) { results.push(Err('module_not_found', op.handle.id)); break; }
          mod.exports[op.prop] = op.value;
          results.push(Ok(true));
          break;
        }
        case 'read': {
          // ★ 同上：批处理内部不额外跨界
          const mod = this._modules.get(op.handle.id);
          if (!mod) { results.push(Err('module_not_found', op.handle.id)); break; }
          results.push(Ok(mod.exports[op.prop]));
          break;
        }
        case 'binary': {
          const r = this.invokeBinary(op.handle, op.exportName, op.buf);
          results.push(r ? Ok(r) : Err('binary_failed', 'null result'));
          break;
        }
        default:
          results.push(Err('unknown_op', op.kind));
      }
    }
    return results;
  }

  /** 零拷贝分配 */
  allocShared(size) {
    this._metrics.zeroCopyRequests++;
    const cap = this.capabilities.zeroCopy;
    if (!cap.supported) { return null; }        // CMP048：禁止静默拷贝
    if (size > cap.maxSize) { return null; }    // 超限，返回 null 让调用方降级
    this._metrics.zeroCopyHits++;
    return new SharedBuffer(size, true);
  }

  invokeBinary(handle, exportName, buf) {
    this._recordBoundary();
    if (!buf || typeof buf.asArrayBuffer !== 'function') {
      return null;
    }
    // 零拷贝：直接传递底层 buffer，不 slice
    const ab = buf.asArrayBuffer();
    const mod = this._modules.get(handle.id);
    if (!mod) return null;
    const fn = mod.exports[exportName];
    if (typeof fn !== 'function') return null;
    try {
      const out = fn(new Uint8Array(ab));
      if (out == null) return null;
      // 回传也走共享缓冲
      const ret = new SharedBuffer(out.byteLength || out.length || 0, true);
      if (out.length) ret.view().set(out);
      return ret;
    } catch (_) {
      return null;
    }
  }

  /** Worker：独立 Runtime，不能共享 jsi::Value */
  createWorker(entry) {
    if (this._workers.size >= this._maxWorkers) return null;
    const h = { id: `worker_${this._workers.size + 1}`, entry };
    this._workers.set(h.id, { ...h, alive: true });
    return h;
  }

  postWorker(worker, msg) {
    const w = this._workers.get(worker.id);
    if (!w || !w.alive) return Err('worker_dead', worker.id);
    // Worker 间不能共享 jsi::Value → 引用类型必须序列化，标量可直接传
    const needsSerialize = typeof msg === 'object' && msg !== null;
    return Ok({ delivered: true, serialized: needsSerialize });
  }

  terminateWorker(worker) {
    const w = this._workers.get(worker.id);
    if (w) w.alive = false;
    return Ok(true);
  }
}

// ============================================================
// 载体 2：AOT（模拟原生编译路径）
// 特征：无跨界成本、无线程亲和性、真并发、支持实时
// ============================================================
class AOTCarrier extends BaseCarrier {
  constructor() {
    super('aot-llvm');
    this._threads = new Map();
    this._rtLoops = new Map();
  }

  get capabilities() {
    return {
      costProfile: { scalarCall: 0, objectProperty: 0, measured: true },
      zeroCopy: { supported: true, mechanism: 'native-pointer', maxSize: Infinity },
      concurrency: {
        trueConcurrency: true,      // ★ 真并发
        threadAffinity: false,      // ★ 无线程亲和性
        workers: true,
        maxWorkers: 32,
      },
      realtime: { capable: true, realtimePriority: true },  // ★ 支持实时
      dynamism: { hotReload: false, eval: false, dynamicImport: false },
      artifactTypes: ['aot-native'],
      tier: 1,
    };
  }

  invoke(handle, exportName, args = []) {
    // 无跨界成本，但仍记录调用次数以便对比
    const mod = this._modules.get(handle.id);
    if (!mod) return Err('module_not_found', handle.id);
    const fn = mod.exports[exportName];
    if (typeof fn !== 'function') return Err('export_not_found', exportName);
    try {
      return Ok(fn(...args));
    } catch (e) {
      return Err('invoke_failed', e.message);
    }
  }

  async invokeAsync(handle, exportName, args = []) {
    return this.invoke(handle, exportName, args);
  }

  invokeBatch(ops) {
    if (!Array.isArray(ops)) return [Err('invalid_ops', 'ops must be array')];
    this._metrics.batchCommits++;
    this._metrics.batchedOps += ops.length;
    // AOT 路径批处理仍有意义（减少调度开销），但收益低于 JSI 路径
    return ops.map(op => this._execOne(op));
  }

  _execOne(op) {
    switch (op.kind) {
      case 'load': return Ok(this.load(op.artifact));
      case 'invoke': return this.invoke(op.handle, op.exportName, op.args || []);
      case 'write': {
        const mod = this._modules.get(op.handle.id);
        if (!mod) return Err('module_not_found', op.handle.id);
        mod.exports[op.prop] = op.value;
        return Ok(true);
      }
      case 'read': {
        const mod = this._modules.get(op.handle.id);
        if (!mod) return Err('module_not_found', op.handle.id);
        return Ok(mod.exports[op.prop]);
      }
      case 'binary': {
        const r = this.invokeBinary(op.handle, op.exportName, op.buf);
        return r ? Ok(r) : Err('binary_failed', 'null');
      }
      default: return Err('unknown_op', op.kind);
    }
  }

  allocShared(size) {
    this._metrics.zeroCopyRequests++;
    this._metrics.zeroCopyHits++;   // AOT 路径始终支持
    return new SharedBuffer(size, true);
  }

  invokeBinary(handle, exportName, buf) {
    if (!buf || typeof buf.asArrayBuffer !== 'function') return null;
    const ab = buf.asArrayBuffer();
    const mod = this._modules.get(handle.id);
    if (!mod) return null;
    const fn = mod.exports[exportName];
    if (typeof fn !== 'function') return null;
    try {
      const out = fn(new Uint8Array(ab));
      if (out == null) return null;
      const ret = new SharedBuffer(out.byteLength || out.length || 0, true);
      if (out.length) ret.view().set(out);
      return ret;
    } catch (_) {
      return null;
    }
  }

  /** 真并发：多线程共享状态 */
  createWorker(entry) {
    const h = { id: `thread_${this._threads.size + 1}`, entry };
    this._threads.set(h.id, { ...h, alive: true });
    return h;
  }

  postWorker(worker, msg) {
    const t = this._threads.get(worker.id);
    if (!t || !t.alive) return Err('thread_dead', worker.id);
    // AOT 路径：可共享内存，无需序列化
    return Ok({ delivered: true, serialized: false, sharedMemory: true });
  }

  terminateWorker(worker) {
    const t = this._threads.get(worker.id);
    if (t) t.alive = false;
    return Ok(true);
  }

  // ---- ★ 实时能力（G-40-B）----
  /**
   * 注册实时闭环：JS 只下发配置，循环在原生侧运行
   * @returns {RealtimeCapability}
   */
  createRealtime(id, opts = {}) {
    const state = { phase: 'idle', ticks: 0 };
    let timer = null;
    const listeners = new Set();
    const maxHz = opts.maxHz ?? 30;      // 事件节流上限

    return {
      id,
      realtime: {
        period: opts.period ?? 10,
        jitterTolerance: opts.jitter ?? 1,
        throughput: opts.throughput ?? 0,
      },
      configure: (config) => {
        if (state.phase === 'running') return Err('busy', 'stop first');
        state.config = config;
        return Ok(true);
      },
      start: () => {
        if (state.phase === 'running') return Err('already_running', id);
        state.phase = 'running';
        // ★ 循环在"原生侧"（此处用 timer 模拟），JS 不再参与每帧
        timer = setInterval(() => {
          state.ticks++;
          // 每 N 个 tick 才回传一次事件（节流）
          if (state.ticks % Math.max(1, Math.round(1000 / maxHz / (opts.period ?? 10))) === 0) {
            for (const fn of listeners) fn({ ticks: state.ticks, phase: state.phase });
          }
        }, opts.period ?? 10);
        return Ok(true);
      },
      stop: () => {
        if (timer) clearInterval(timer);
        timer = null;
        state.phase = 'stopped';
        return Ok(true);
      },
      onEvent: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      getState: () => state.phase,
      _state: state,
    };
  }
}

// ============================================================
// 演示
// ============================================================
async function demo() {
  console.log('=== G-40 执行载体参考实现演示 ===\n');

  // ---------- 1. JSI 载体 ----------
  console.log('--- 载体 1: JSICarrier ---');
  const jsi = new JSICarrier();
  await jsi.initialize();

  const caps = jsi.capabilities;
  console.log('costProfile:', JSON.stringify(caps.costProfile));
  console.log('threadAffinity:', caps.concurrency.threadAffinity, '(批评三：JSI 的硬约束)');
  console.log('trueConcurrency:', caps.concurrency.trueConcurrency);
  console.log('realtime.capable:', caps.realtime.capable, '(JSI 不支持实时)');

  // 装载模块
  const mod = jsi.load({
    type: 'js-bundle',
    exports: {
      add: (a, b) => a + b,
      double: (arr) => arr.map(x => x * 2),
      counter: 0,
    },
  });
  console.log('\ninvoke add(2,3):', JSON.stringify(jsi.invoke(mod, 'add', [2, 3])));

  // ---------- 2. 批处理降频 ----------
  console.log('\n--- 批处理降频（G-40.5）---');
  const before = jsi.getMetrics();
  console.log('批处理前 crossBoundaryCalls:', before.crossBoundaryCalls);

  // 模拟一帧 100 次属性更新
  const ops = [];
  for (let i = 0; i < 100; i++) {
    ops.push({ kind: 'write', handle: mod, prop: `p${i}`, value: i });
  }
  const results = jsi.invokeBatch(ops);
  console.log('批处理 ops:', ops.length, '| 结果数:', results.length);
  const after = jsi.getMetrics();
  console.log('批处理次数 batchCommits:', after.batchCommits);
  console.log('包含操作数 batchedOps:', after.batchedOps);
  console.log('★ 跨界降频比 reductionRatio:', after.reductionRatio, '(100 ops / 少数几次跨界)');

  // ---------- 3. 零拷贝 ----------
  console.log('\n--- 零拷贝通道（G-40.4）---');
  const buf = jsi.allocShared(8 * 1024 * 1024);   // 8MB
  console.log('allocShared(8MB):', buf ? `ok, isShared=${buf.isShared}` : 'null (降级)');
  if (buf) {
    buf.view()[0] = 42;
    const ab = buf.asArrayBuffer();
    console.log('asArrayBuffer() 是否同一底层:', new Uint8Array(ab)[0] === 42);
    buf.release();
  }
  console.log('zeroCopyHitRate:', jsi.getMetrics().zeroCopyHitRate);

  // 超限降级
  const tooBig = jsi.allocShared(200 * 1024 * 1024);  // 200MB > 64MB 上限
  console.log('超限(200MB) →', tooBig === null ? 'null (CMP048 显式降级，不静默拷贝)' : 'allocated');

  // ---------- 4. Worker ----------
  console.log('\n--- Worker（JSI 路径隔离）---');
  const w = jsi.createWorker(mod);
  console.log('createWorker:', w ? w.id : 'null');
  console.log('postWorker:', JSON.stringify(jsi.postWorker(w, { a: 1 })), '(需 serialized: true)');

  console.log('\nJSI 指标:', JSON.stringify(jsi.getMetrics(), null, 2));

  // ---------- 5. AOT 载体 ----------
  console.log('\n--- 载体 2: AOTCarrier ---');
  const aot = new AOTCarrier();
  await aot.initialize();
  const acaps = aot.capabilities;
  console.log('costProfile:', JSON.stringify(acaps.costProfile), '(无边界)');
  console.log('threadAffinity:', acaps.concurrency.threadAffinity, '(★ 无亲和性限制)');
  console.log('trueConcurrency:', acaps.concurrency.trueConcurrency, '(★ 真并发)');
  console.log('realtime.capable:', acaps.realtime.capable, '(★ 支持实时)');

  const w2 = aot.createWorker(null);
  console.log('postWorker:', JSON.stringify(aot.postWorker(w2, { shared: [1, 2, 3] })),
    '(sharedMemory: true，无需序列化)');

  // ---------- 6. 实时能力逃逸（G-40-B）----------
  console.log('\n--- 实时能力逃逸（G-40.3）---');
  const rt = aot.createRealtime('audio-engine', { period: 10, maxHz: 30 });
  let events = 0;
  const unsub = rt.onEvent(() => { events++; });
  console.log('configure:', JSON.stringify(rt.configure({ sampleRate: 48000, bufferSize: 1024 })));
  console.log('start:', JSON.stringify(rt.start()));
  console.log('getState:', rt.getState());

  await new Promise(r => setTimeout(r, 300));
  rt.stop();
  unsub();
  console.log('300ms 后 ticks:', rt._state.ticks, '| JS 收到事件:', events,
    `(节流到 ~${Math.round(events / 0.3)}Hz，原生侧 ${Math.round(rt._state.ticks / 0.3)}Hz)`);
  console.log('stop 后 getState:', rt.getState());

  console.log('\nAOT 指标:', JSON.stringify(aot.getMetrics(), null, 2));
  console.log('\n=== 演示结束 ===');
}

const isMain = typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  demo().catch(e => { console.error('DEMO FAILED:', e); process.exit(1); });
}

export { JSICarrier, AOTCarrier, SharedBuffer, Metrics, Ok, Err };
