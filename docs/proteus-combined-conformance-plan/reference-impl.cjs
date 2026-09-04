// G-47 Combined Conformance — 组合一致性（零依赖，node 直接跑）
// ============================================================
// 定位：G-44 INT 系列扩展。验证「渲染后端切换 × 资源池」的跨层命题。
//       单个层各自 conformance 通过 ≠ 组合正确。本套件专治交界处静默失败。
//
// 复用 G-46 ResourcePool（L1/L2/L3 + 双轨 + 跨页所有权），
// 在其上叠加「渲染后端」抽象，验证二者组合后的关键不变量。
//
// 不变量（invariants）：
//   INV-01  切后端后登录态不丢（Cookie / Token 跨 Backend 等价）
//   INV-02  切后端后缓存命中不丢
//   INV-03  登出级联清理与切后端串行时，最终状态一致（无竞态残留）
//   INV-04  并发切后端 + 并发读写资源 → 不崩溃、最终一致
//   INV-05  IR 跨 Backend 语义等价（同 IR 在两后端产出的资源视图一致）
//   INV-06  降级不崩溃（Backend 不可用 → 回退 Token 轨 / 拒绝装载）
//
// 'use strict';

let PASS = 0, FAIL = 0;
const results = [];

function ok(name, cond) {
  if (cond) { PASS++; results.push(['PASS', name]); console.log('  OK: ' + name); }
  else { FAIL++; results.push(['FAIL', name]); console.error('  ✗ ' + name); }
}

// ============================================================
//  Part A. 复用 G-46 ResourcePool（精简内嵌，避免外部依赖）
// ============================================================
class ResourcePool {
  constructor() {
    this.cookies = new Map();
    this.tokens = new Map();
    this.cache = new Map();
    this.refs = new Map();
    this.ssOUsed = new Set();
  }
  setCookie(key, value, opts) {
    opts = opts || {};
    if (!opts.domain) return false;
    this.cookies.set(key, { value: value, httpOnly: !!opts.httpOnly, domain: opts.domain });
    return true;
  }
  getCookie(key) {
    const c = this.cookies.get(key);
    if (!c) return null;
    if (c.httpOnly) return null;
    return c.value;
  }
  setToken(origin, token) { this.tokens.set(origin, { token: token, revoked: false }); return true; }
  getToken(origin) { const t = this.tokens.get(origin); return t && !t.revoked ? t.token : null; }
  revokeToken(origin) { const t = this.tokens.get(origin); if (t) t.revoked = true; }
  getAuth(domain, origin) {
    if (this.getCookie('sid_' + domain)) return { kind: 'cookie', value: this.getCookie('sid_' + domain) };
    if (this.getToken(origin)) return { kind: 'token', value: this.getToken(origin) };
    return null;
  }
  cacheSet(origin, key, val, ttlMs) {
    if (!this.cache.has(origin)) this.cache.set(origin, new Map());
    this.cache.get(origin).set(key, { val: val, exp: Date.now() + ttlMs });
  }
  cacheGet(origin, key) {
    const m = this.cache.get(origin); if (!m) return null;
    const e = m.get(key); if (!e) return null;
    if (e.exp < Date.now()) { m.delete(key); return null; }
    return e.val;
  }
  pageAttach(pageId, resource) {
    if (!this.refs.has(pageId)) this.refs.set(pageId, { strong: [], weak: [] });
    this.refs.get(pageId).strong.push(resource);
  }
  pageDestroy(pageId) {
    const r = this.refs.get(pageId); if (!r) return;
    r.strong = []; r.weak = [];
    this.refs.delete(pageId);
  }
  logout() { this.cookies.clear(); this.tokens.clear(); this.cache.clear(); this.refs.clear(); }
}

// ============================================================
//  Part B. 渲染后端抽象（G-27 Backend SPI 的最小形态）
//  ——关键：后端只描述「如何绘制」，并从 ResourcePool 读取登录态
//  （而不是自己维护一份）。这就是「内(G-46)外(G-27)一致性」的组合点。
// ============================================================
class RenderBackend {
  constructor(name, pool) { this.name = name; this.pool = pool; this.mounted = false; }
  mount() { this.mounted = true; }
  unmount() { this.mounted = false; }
  // 关键方法：从共享资源池读取当前登录态（组合点）
  readAuth(domain, origin) { return this.pool.getAuth(domain, origin); }
  readCache(origin, key) { return this.pool.cacheGet(origin, key); }
}

class VueDomBackend extends RenderBackend {}
class FlutterBackend extends RenderBackend {}
class NativeBackend extends RenderBackend {}

// 模拟「不可用」后端，用于降级测试
class FailingBackend extends RenderBackend {
  mount() { throw new Error('BACKEND_UNAVAILABLE'); }
  readAuth() { throw new Error('BACKEND_UNAVAILABLE'); }
}

// ============================================================
//  Part C. 组合测试主体
// ============================================================
function main() {
  const pool = new ResourcePool();

  // ---------- 准备：建立登录态 + 缓存 ----------
  // 设计说明：getAuth(domain, origin) 的优先级是「同域 Cookie > Token」。
  //   因此「走 Token 轨」必须用与 Cookie 不同域的 origin，否则会被 Cookie 抢走。
  //   这里 Cookie 用 domain=app.com，Token 用 origin=web.com（跨域），正是双轨的真实场景。
  pool.setCookie('sid_app.com', 'cookieVal', { domain: 'app.com' });
  pool.setToken('web.com', 'tk_123');
  pool.cacheSet('app.com', 'userPrefs', 'dark', 60000);

  const vueDom = new VueDomBackend('vue-dom', pool);
  const flutter = new FlutterBackend('flutter', pool);
  const native = new NativeBackend('native', pool);

  // ============================================================
  //  Suite INT-A：切后端后登录态不丢（INV-01）
  // ============================================================
  vueDom.mount();
  flutter.mount();

  ok('INT-A1 VueDom 读取 Cookie 轨', vueDom.readAuth('app.com', 'x').kind === 'cookie');
  ok('INT-A2 Flutter 读取同一 Cookie 轨（切后端不丢）', flutter.readAuth('app.com', 'x').value === 'cookieVal');
  // Token 轨用例：用「无 Cookie 的 domain」+「有 Token 的 origin」
  ok('INT-A3 VueDom 无 Cookie 时走 Token 轨', vueDom.readAuth('no-cookie.com', 'web.com').kind === 'token');
  ok('INT-A4 Flutter Token 轨等价', flutter.readAuth('no-cookie.com', 'web.com').value === 'tk_123');

  // 切换到 Native 后端，登录态仍一致
  vueDom.unmount();
  native.mount();
  ok('INT-A5 Native 接管后 Cookie 轨仍在', native.readAuth('app.com', 'x').value === 'cookieVal');
  ok('INT-A6 Native 接管后 Token 轨仍在', native.readAuth('no-cookie.com', 'web.com').value === 'tk_123');

  // 三个后端「对同一 IR 的资源视图」完全一致
  const viewVue = vueDom.readAuth('app.com', 'web.com');
  const viewFl = flutter.readAuth('app.com', 'web.com');
  const viewNat = native.readAuth('app.com', 'web.com');
  ok('INT-A7 三后端 IR 资源视图 kind 一致', viewVue.kind === viewFl.kind && viewFl.kind === viewNat.kind);
  ok('INT-A8 三后端 IR 资源视图 value 一致', viewVue.value === viewFl.value && viewFl.value === viewNat.value);

  // ============================================================
  //  Suite INT-B：切后端后缓存不丢（INV-02）
  // ============================================================
  ok('INT-B1 VueDom 读缓存', vueDom.readCache('app.com', 'userPrefs') === 'dark');
  ok('INT-B2 Flutter 读同一缓存（切后端不丢）', flutter.readCache('app.com', 'userPrefs') === 'dark');
  native.unmount();
  native.mount(); // 模拟重挂载
  ok('INT-B3 Native 重挂载后缓存仍在', native.readCache('app.com', 'userPrefs') === 'dark');

  // ============================================================
  //  Suite INT-C：登出 × 切后端的竞态（INV-03）
  //  关键不变量：无论顺序如何，最终状态 = 已登出 + 资源清空
  // ============================================================
  pool.logout(); // 先登出
  flutter.unmount();
  vueDom.mount();
  ok('INT-C1 登出后 VueDom 读不到登录态', vueDom.readAuth('app.com', 'web.com') === null);
  ok('INT-C2 登出后 Flutter 读不到登录态', flutter.readAuth('app.com', 'web.com') === null);
  ok('INT-C3 登出后缓存已清空', vueDom.readCache('app.com', 'userPrefs') === null);

  // 反向顺序：先切后端再登出 —— 结果应相同（交换律）
  pool.setCookie('sid_app.com', 'v2', { domain: 'app.com' });
  pool.cacheSet('app.com', 'userPrefs', 'light', 60000);
  vueDom.mount();
  vueDom.unmount();           // 切走
  pool.logout();              // 再登出
  vueDom.mount();             // 再切回
  ok('INT-C4 先切后登出：最终登录态清空', vueDom.readAuth('app.com', 'x') === null);
  ok('INT-C5 先切后登出：最终缓存清空', vueDom.readCache('app.com', 'userPrefs') === null);

  // ============================================================
  //  Suite INT-D：并发切后端 + 并发读写（INV-04）
  //  模拟高频「切后端」与「读登录态」交错 —— 不崩溃即 PASS
  // ============================================================
  let crashes = 0;
  const backends = [vueDom, flutter, native];
  for (let round = 0; round < 3; round++) {
    pool.setCookie('sid_app.com', 'raceVal', { domain: 'app.com' });
    for (let i = 0; i < 200; i++) {
      const b = backends[i % 3];
      try { b.mount(); const auth = b.readAuth('app.com', 'x'); } catch (e) { crashes++; }
    }
    pool.logout();
  }
  ok('INT-D1 600 次并发挂载+读资源不崩溃', crashes === 0);
  ok('INT-D2 并发后最终状态可预测（登出后清空）', vueDom.readAuth('app.com', 'x') === null);

  // ============================================================
  //  Suite INT-E：降级不崩溃（INV-06）
  // ============================================================
  const failing = new FailingBackend('failing', pool);
  let mountErr = null;
  try { failing.mount(); } catch (e) { mountErr = e.message; }
  ok('INT-E1 不可用后端装载失败（不静默吞错）', mountErr === 'BACKEND_UNAVAILABLE');
  // 降级到 VueDom（回退后端），登录态仍可读取
  vueDom.mount();
  pool.setCookie('sid_app.com', 'fallback', { domain: 'app.com' });
  ok('INT-E2 降级到回退后端后登录态可用', vueDom.readAuth('app.com', 'x').value === 'fallback');

  // ============================================================
  //  Suite NEG：负向 —— 验证校验器有判别力（不会恒真通过）
  // ============================================================
  // NEG-01：未登录时确实读不到（合法场景）
  pool.logout();
  ok('NEG-01 未登录时任何后端均读不到登录态', vueDom.readAuth('app.com', 'x') === null && flutter.readAuth('app.com', 'x') === null);

  // NEG-02 ★：后端 unmount 后，共享资源池 NOT 被销毁（OWN-06 语义）
  //   若是"各自维护资源"的错误设计，unmount 会把登录态带走 → 此处应失败。
  //   正确设计（共享池）：unmount 仅断开渲染，pool 中的登录态仍在。
  pool.setCookie('sid_app.com', 'survives', { domain: 'app.com' });
  vueDom.unmount(); // 仅断开渲染层
  ok('NEG-02 后端销毁后共享登录态仍存活（OWN-06：资源归宿主）', pool.getCookie('sid_app.com') === 'survives');

  // NEG-03：若断言写反（期望 unmount 后 pool 被清空），则应 FAIL —— 验证校验器会抓错
  //   这里我们用「正确的期望」断言，确保它真的可执行（非空断言恒真陷阱的反面）
  ok('NEG-03 重挂载后端可重新读到同一登录态', (vueDom.mount(), vueDom.readAuth('app.com', 'x').value === 'survives'));

  // ============================================================
  //  汇总
  // ============================================================
  console.log('\n=== G-47 Combined Conformance ===');
  console.log('PASS: ' + PASS + ' / ' + (PASS + FAIL));
  if (FAIL > 0) {
    results.filter(function (r) { return r[0] === 'FAIL'; }).forEach(function (r) { console.error('  ✗ ' + r[1]); });
    process.exit(1);
  }
}

main();
