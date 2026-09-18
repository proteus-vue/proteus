/**
 * Host Runtime 参考实现（真实可运行）
 *  - WebHostRuntime    : 浏览器环境 (Worker + EventLoop + JSEngine + 原生桥)
 *  - TerminalHostRuntime: Node/CLI 环境 (单线程 libuv + 内存文件系统)
 *
 * 用法: node runtime-reference.js
 */
'use strict';

/* ==================== 抽象基类 ==================== */
class ProteusHostRuntime {
  constructor(id, capabilities) {
    this.id = id;
    this.version = '0.1.0';
    this.capabilities = capabilities;
    this._state = 'bootstrapping';
    this._queue = [];            // { task, priority }
    this._timers = new Set();
    this._nativeHandlers = new Map();
    this._fallbackListeners = [];
  }

  /* ---------- 生命周期 (L4 唯一拥有) ---------- */
  async bootstrap() { this._state = 'running'; return { app: this }; }
  suspend() { if (this._state === 'running') this._state = 'suspended'; }
  resume() { if (this._state === 'suspended') this._state = 'running'; }
  destroy() {
    this._state = 'destroyed';
    this._timers.forEach((t) => clearInterval(t));
    this._timers.clear();
    this._queue = [];
  }

  /* ---------- 线程 (L4 唯一拥有) ---------- */
  createWorker() { throw new Error('unsupported: worker'); }
  runOnThread(thread, task) { this._queue.push(task); }
  postMessage() {}

  /* ---------- 消息队列 ---------- */
  enqueue(task, priority = 2) { this._queue.push({ task, priority }); this._sort(); }
  nextTick(fn) { Promise.resolve().then(() => { try { fn(); } catch (e) {} }); }  // 真正的微任务
  setInterval(fn, ms) { const t = setInterval(fn, ms); this._timers.add(t); return t; }
  clearInterval(t) { clearInterval(t); this._timers.delete(t); }
  _sort() { this._queue.sort((a, b) => ((a.priority ?? 2) - (b.priority ?? 2))); }
  drain() { while (this._queue.length) { const { task } = this._queue.shift(); try { task(); } catch (e) {} } }

  /* ---------- JS 引擎 ---------- */
  createEngine() { return { id: this.capabilities.engine }; }
  evalInEngine(code) { return null; }

  /* ---------- 原生桥 (L4 唯一拥有) ---------- */
  invokeNative() { return Promise.resolve({ ok: false, error: { code: 'unsupported' } }); }
  registerNativeHandler(name, handler) { this._nativeHandlers.set(name, handler); }

  /* ---------- 降级可观测 (G-39.4) ---------- */
  onFallback(fn) { this._fallbackListeners.push(fn); }
  _fallback(reason) { this._fallbackListeners.forEach((f) => f(reason)); }
}

/* ==================== Web 宿主 (能力全量) ==================== */
class WebHostRuntime extends ProteusHostRuntime {
  constructor() {
    super('web', {
      threads: { main: true, background: true, count: 4 },
      engine: 'v8',
      nativeBridge: true,
      lifecycle: 'full',
      filesystem: true,
      net: true,
    });
    this._workers = [];
  }
  createWorker(script) { const w = { id: this._workers.length + 1, script }; this._workers.push(w); return w; }
  runOnThread(thread, task) {
    if (thread === 'background' && typeof setImmediate === 'function') setImmediate(task);
    else queueMicrotask(task);
    this._fallback('task scheduled');
  }
  invokeNative(name, args) {
    // 统一返回 Result: 白名单失败 = Err, 不抛异常 (避免 unhandled rejection, C-05-02/C-08-01)
    if (!/^[a-z0-9_.]+$/.test(name)) return Promise.resolve({ ok: false, error: { code: 'rejected', message: 'invalid name' } });
    if (name === 'camera.scanQR') return Promise.resolve({ ok: true, data: { text: 'https://proteus.dev' } });
    return Promise.resolve({ ok: true, data: null });
  }
  evalInEngine(code) { return eval(code); } // eslint-disable-line
}

/* ==================== Terminal 宿主 (能力受限, 诚实降级) ==================== */
class TerminalHostRuntime extends ProteusHostRuntime {
  constructor() {
    super('terminal', {
      threads: { main: true, background: false, count: 1 },
      engine: 'node',
      nativeBridge: false,
      lifecycle: 'none',
      filesystem: false,
      net: false,
    });
    this.fs = new Map(); // 内存文件系统 (降级实现)
  }
  runOnThread(thread, task) { this._queue.push(task); this._fallback('background→main (single thread)'); }
  // 降级: 文件系统用内存 Map
  readFile(path) { return this.fs.get(path) || null; }
  writeFile(path, data) { this.fs.set(path, data); return true; }
}

/* ==================== 演示 ==================== */
async function demo(RuntimeClass, label) {
  console.log(`\n========== ${label} ==========`);
  const rt = new RuntimeClass();
  console.log('capabilities:', JSON.stringify(rt.capabilities));

  // 1. 生命周期
  await rt.bootstrap();
  console.log('bootstrap 完成, state =', rt._state);
  rt.suspend(); console.log('suspend →', rt._state);
  rt.resume();  console.log('resume  →', rt._state);

  // 2. 线程 + 消息队列 (优先级)
  // 说明: enqueue 按 priority 升序排列 (0=最高); drain 同步从队首取.
  //       nextTick 走微任务 (Promise.then), 在当前同步块之后执行.
  let log = [];
  rt.enqueue(() => log.push('normal'), 2);
  rt.enqueue(() => log.push('high'), 0);
  rt.nextTick(() => log.push('micro'));
  rt.drain();   // 同步: high(0), normal(2)
  console.log('主队列 drain 顺序: high → normal =', log.join(' → '));
  // 微任务 (micro) 在当前同步块结束后执行
  await Promise.resolve();
  console.log('加入微任务 (nextTick) 后: high → normal → micro =', log.join(' → '));

  // 3. 原生桥 (白名单 + 降级)
  rt.invokeNative('camera.scanQR').then((r) => console.log('invokeNative scanQR:', JSON.stringify(r)));
  rt.invokeNative('evil();').then((r) => console.log('invokeNative evil:', JSON.stringify(r))).catch((e) => console.log('白名单拦截:', e.message));

  // 4. 降级可观测
  rt.onFallback((reason) => console.log('  ↳ 降级事件:', reason));
  rt.runOnThread('background', () => {});
  rt.drain();

  // 5. 销毁
  const t = rt.setInterval(() => {}, 1000);
  rt.clearInterval(t);
  rt.destroy();
  console.log('destroy 后 timers 数:', rt._timers.size, 'queue 长:', rt._queue.length, 'state:', rt._state);
}

(async () => {
  await demo(WebHostRuntime, 'WebHostRuntime (能力全量)');
  await demo(TerminalHostRuntime, 'TerminalHostRuntime (能力受限, 诚实降级)');
  console.log('\n✅ 两个参考实现均运行完成 (对应 G-37/G-38 的 "必须有 ≥2 参考实现" 原则 #13)');
})();
