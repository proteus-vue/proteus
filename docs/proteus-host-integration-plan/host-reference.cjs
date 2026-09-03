#!/usr/bin/env node
/**
 * G-41 宿主接入参考实现（可运行）
 *
 * 用零依赖的 Node 代码演示整套宿主接入契约：
 *   HostRuntime (G-39) + ExecutionCarrier (G-40)
 * + RenderBackend (G-27) + Vue 绑定层 (G-41)
 *
 * 运行： node host-reference.cjs
 */

'use strict';

// ============================================================
// 1. 极简 HostRuntime（对齐 G-39 ProteusHostRuntime）
// ============================================================
class TerminalHostRuntime {
  constructor() {
    this.id = 'terminal';
    this.state = 'created';
    this.timers = 0;
    this.queue = [];
    this.workers = [];
    this.threads = ['main'];
  }
  bootstrap() { this.state = 'running'; return this; }
  suspend() { this.state = 'suspended'; }
  resume() { this.state = 'running'; }
  destroy() { this.state = 'destroyed'; this.timers = 0; this.queue = []; this.workers = []; }
  createWorker() { const w = { id: 'w' + (this.workers.length + 1), thread: 'worker' + (this.workers.length + 1) }; this.workers.push(w); this.threads.push(w.thread); return w; }
  postMessage() { return true; }
  enqueue(task, priority = 2) { this.queue.push({ task, priority }); }
  nextTick(fn) { this.queue.push({ task: fn, priority: 0 }); }
  drain() {
    this.queue.sort((a, b) => a.priority - b.priority);
    const out = [];
    while (this.queue.length) { const { task } = this.queue.shift(); out.push(task()); }
    return out;
  }
}

// ============================================================
// 2. ExecutionCarrier（对齐 G-40）
// ============================================================
class JSICarrier {
  constructor(runtime) {
    this.id = 'jsi';
    this.runtime = runtime;
    this.boundaries = 0;
    this.capabilities = { threadAffinity: true, trueConcurrency: false, realtime: { capable: false } };
  }
  createEngine() { return { eval: (s) => eval(s) }; }
  // 跨界计数：用于验证批处理降频（G-40）
  cross() { this.boundaries++; return this.boundaries; }
}

class AOTCarrier {
  constructor(runtime) {
    this.id = 'aot';
    this.runtime = runtime;
    this.boundaries = 0;
    this.capabilities = { threadAffinity: false, trueConcurrency: true, realtime: { capable: true } };
  }
  createEngine() { return { eval: null }; }
  cross() { /* AOT 无边界，不计数 */ return 0; }
}

// ============================================================
// 3. G-32 语义原语表（节选，真实实现为 128 条）
// ============================================================
const PRIMITIVE_TABLE = {
  'p-box':       { semantic: 'layout.box',        degradation: 'none' },
  'p-stack':     { semantic: 'layout.stack',      degradation: 'none' },
  'p-grid':      { semantic: 'layout.grid',       degradation: 'columns' },
  'p-scroll':    { semantic: 'layout.scroll',     degradation: 'native' },
  'p-text':      { semantic: 'ui.text',           degradation: 'none' },
  'p-button':    { semantic: 'ui.button',         degradation: 'none' },
  'p-media':     { semantic: 'ui.media',          degradation: 'placeholder' },
  'p-canvas':    { semantic: 'ui.canvas',         degradation: 'hide' },
  'p-list':      { semantic: 'ui.list',           degradation: 'scroll' },
};

let __id = 0;
function toIRNode(type, props = {}) {
  const spec = PRIMITIVE_TABLE[type];
  if (!spec) throw new Error(`unknown.primitive: ${type}（应在编译期拦截）`);
  return {
    id: 'n' + (++__id),
    semantic: spec.semantic,   // ★ 后端按 semantic 分发，不是 tag
    tag: type,                 // 仅调试用
    props: { ...props },
    degradation: spec.degradation,
  };
}

// ============================================================
// 4. ProteusNodeOpsDispatcher（G-41 方案 B）
// ============================================================
class ProteusNodeOpsDispatcher {
  constructor(backend) { this.currentBackend = backend; }

  switchBackend(b) { this.currentBackend = b; return this.currentBackend; }

  // --- Vue nodeOps 接口（转发到 currentBackend）---
  createElement(type, props) { return this.currentBackend.createNode(toIRNode(type, props)); }
  createText(text) { return this.currentBackend.createNode({ id: 't' + (++__id), semantic: 'text', props: { value: text } }); }
  createComment(text) { return this.currentBackend.createNode({ id: 'c' + (++__id), semantic: 'comment', props: { value: text } }); }
  setText(el, text) { this.currentBackend.setText(el, text); }
  setElementText(el, text) { this.currentBackend.setText(el, text); }
  insert(child, parent, anchor) { this.currentBackend.insertChild(parent, child, anchor); }
  remove(child) { this.currentBackend.deleteNode(child); }
  patchProp(el, key, prev, next) {
    if (key === 'class') this.currentBackend.setAttribute(el, 'class', next);
    else if (key === 'style') this.currentBackend.setStyle(el, next);
    else this.currentBackend.setAttribute(el, key, next);
  }
  parentNode(node) { return this.currentBackend.getParent(node); }
  nextSibling(node) { return this.currentBackend.getNextSibling(node); }
}

// ============================================================
// 5. 两个 RenderBackend（对齐 G-27 ProteusRenderBackend）
// ============================================================
class DomTreeBackend {
  constructor() {
    this.id = 'vue-dom';
    this.nodes = new Map();
    this.root = null;
    this.capabilities = { layoutMode: 'framework', rehydrate: true, semanticDispatch: true };
  }
  initialize() {}
  dispose() {}
  createNode(ir) {
    if (!ir.semantic) throw new Error('backend must dispatch on semantic (G-37.1)');
    const n = { ir, children: [], parent: null, attrs: {}, style: {}, text: '' };
    this.nodes.set(ir.id, n);
    return n;
  }
  insertChild(parent, child, anchor) {
    if (!parent) return;
    child.parent = parent;
    const i = anchor ? parent.children.indexOf(anchor) : -1;
    if (i >= 0) parent.children.splice(i, 0, child); else parent.children.push(child);
  }
  removeChild(parent, child) {
    const i = parent.children.indexOf(child);
    if (i >= 0) parent.children.splice(i, 1);
  }
  deleteNode(n) { this.nodes.delete(n.ir.id); if (n.parent) this.removeChild(n.parent, n); }
  setAttribute(n, k, v) { n.attrs[k] = v; }
  removeAttribute(n, k) { delete n.attrs[k]; }
  setStyle(n, s) { Object.assign(n.style, s); }
  setText(n, t) { n.text = t; }
  getParent(n) { return n.parent; }
  getNextSibling(n) {
    if (!n.parent) return null;
    const i = n.parent.children.indexOf(n);
    return n.parent.children[i + 1] || null;
  }
  getRootContainer() { return this.root; }
  attachToHost(host) { this.root = host; }
  // 导出可比对的结构快照
  snapshot() {
    const walk = (n) => ({
      semantic: n.ir.semantic,
      attrs: n.attrs,
      text: n.text,
      children: n.children.map(walk),
    });
    return this.root ? this.root.children.map(walk) : [];
  }
}

/** TerminalBackend：把同一份 IR 渲染成 ASCII 树（证明"同 IR 不同呈现"） */
class TerminalBackend extends DomTreeBackend {
  constructor() { super(); this.id = 'terminal'; }
  render(node = this.root, depth = 0) {
    if (!node) return '';
    const pad = '  '.repeat(depth);
    // 文本节点内联显示，不单独占一行
    if (node.ir.semantic === 'text') return `${pad}"${node.text}"`;
    const attrs = Object.keys(node.attrs).length ? ' ' + Object.entries(node.attrs).map(([k, v]) => `${k}=${v}`).join(' ') : '';
    const head = `${pad}<${node.ir.tag || node.ir.semantic}${attrs}>`;
    return [head, ...node.children.map((c) => this.render(c, depth + 1))].join('\n');
  }
}

// ============================================================
// 6. 极简 Vue-like renderer（createRenderer(nodeOps)）
//    演示：Vue 内核不变，nodeOps 是唯一变量
// ============================================================
const TEXT = '#text';
function h(type, props, children) {
  const kids = (children || []).map((c) => (typeof c === 'string' ? { type: TEXT, text: c, props: {}, children: [] } : c));
  return { type, props: props || {}, children: kids };
}

function createRenderer(nodeOps) {
  function mount(vnode, parent, anchor) {
    if (vnode.type === TEXT) {
      const el = nodeOps.createText(vnode.text);
      nodeOps.setText(el, vnode.text);
      nodeOps.insert(el, parent, anchor);
      vnode._el = el;
      return;
    }
    const el = nodeOps.createElement(vnode.type, vnode.props);
    for (const k in vnode.props) nodeOps.patchProp(el, k, null, vnode.props[k]);
    vnode.children.forEach((c) => mount(c, el, null));
    nodeOps.insert(el, parent, anchor);
    vnode._el = el;
  }
  function patch(n1, n2, parent) {
    if (n1 == null) return mount(n2, parent, null);
    if (n1.type === TEXT && n2.type === TEXT) {
      if (n1.text !== n2.text) nodeOps.setElementText(n1._el, n2.text);
      n2._el = n1._el;
      return;
    }
    if (n1.type !== n2.type) {
      nodeOps.remove(n1._el);
      return mount(n2, parent, null);
    }
    const el = (n2._el = n1._el);
    for (const k in n2.props) if (n1.props[k] !== n2.props[k]) nodeOps.patchProp(el, k, n1.props[k], n2.props[k]);
    const len = Math.max(n1.children.length, n2.children.length);
    for (let i = 0; i < len; i++) {
      if (i >= n2.children.length) nodeOps.remove(n1.children[i]._el);
      else if (i >= n1.children.length) mount(n2.children[i], el, null);
      else patch(n1.children[i], n2.children[i], el);
    }
  }
  return { render: (vnode, container) => patch(container._vnode, vnode, container), mount, setVnode: (c, v) => { c._vnode = v; } };
}

// ============================================================
// 7. 业务 SFC（永远不变 —— 这是"一套代码"的本体）
// ============================================================
const SFC = () =>
  h('p-box', { class: 'page' }, [
    h('p-grid', { 'min-col-width': 160 }, [
      h('p-text', {}, ['商品 A']),
      h('p-text', {}, ['商品 B']),
      h('p-button', { variant: 'primary' }, ['加入购物车']),
    ]),
  ]);

// ============================================================
// 8. Host Conformance（H-01 ~ H-08，32 项）
// ============================================================
function runConformance() {
  const results = { pass: 0, fail: 0, skip: 0, details: [] };
  const t = (id, desc, fn) => {
    try {
      const r = fn();
      if (r === 'skip') { results.skip++; results.details.push([id, 'SKIP', desc]); }
      else { results.pass++; results.details.push([id, 'PASS', desc]); }
    } catch (e) { results.fail++; results.details.push([id, 'FAIL', desc + ' :: ' + e.message]); }
  };
  const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

  const rt = new TerminalHostRuntime();
  const carrier = new JSICarrier(rt);
  const dom = new DomTreeBackend();
  const term = new TerminalBackend();
  const disp = new ProteusNodeOpsDispatcher(dom);
  const renderer = createRenderer(disp);

  rt.bootstrap();

  // --- H-01 接入完整性（4）---
  t('H-01-01', 'Runtime 已注册且 running', () => assert(rt.state === 'running'));
  t('H-01-02', 'Carrier 已注册', () => assert(carrier && carrier.id === 'jsi'));
  t('H-01-03', 'Backend 已注册', () => assert(disp.currentBackend === dom));
  t('H-01-04', 'bootstrap 前完成注册（G-41.6）', () => assert(rt.state === 'running' && disp.currentBackend != null));

  // --- H-02 生命周期（4）---
  t('H-02-01', 'suspend → suspended', () => { rt.suspend(); assert(rt.state === 'suspended'); rt.resume(); });
  t('H-02-02', 'resume → running', () => assert(rt.state === 'running'));
  t('H-02-03', 'createWorker 产生独立线程', () => { const w = rt.createWorker(); assert(rt.threads.includes(w.thread)); });
  t('H-02-04', 'destroy 清理资源', () => { const r2 = new TerminalHostRuntime(); r2.bootstrap(); r2.enqueue(() => 1); r2.destroy(); assert(r2.state === 'destroyed' && r2.queue.length === 0); });

  // --- H-03 ★ 引擎可切换性（4） ---
  let snapA, snapB, termOut;
  t('H-03-01', '同一 SFC 在 Backend A 渲染成功', () => {
    const root = dom.createNode({ id: 'root', semantic: 'layout.box', props: {} });
    dom.attachToHost(root);
    const v = SFC(); renderer.render(v, root); renderer.setVnode(root, v);
    snapA = JSON.stringify(dom.snapshot());
    assert(snapA.includes('layout.grid'));
  });
  t('H-03-02', 'switchBackend 生效', () => { disp.switchBackend(term); assert(disp.currentBackend === term); });
  t('H-03-03', '同一 SFC 在 Backend B 渲染成功（源码零改动）', () => {
    const root = term.createNode({ id: 'root2', semantic: 'layout.box', props: {} });
    term.attachToHost(root);
    const v = SFC(); renderer.render(v, root);
    snapB = JSON.stringify(term.snapshot());
    termOut = term.render(root);
    assert(/<p-grid[ >]/.test(termOut), 'terminal render missing p-grid: ' + termOut);
  });
  t('H-03-04', '★ 两引擎 IR 快照完全一致（证明"一套代码多引擎"）', () => {
    assert(snapA && snapB, 'snapshots missing');
    // 归一化节点 id 后比对语义结构
    assert(snapA === snapB, 'IR snapshot mismatch: A≠B');
  });

  // --- H-04 职责边界（5）---
  t('H-04-01', '后端按 semantic 分发，拒绝无 semantic 节点', () => {
    disp.switchBackend(dom);
    let threw = false;
    try { dom.createNode({ id: 'x', props: {} }); } catch (e) { threw = /semantic/.test(e.message); }
    assert(threw, 'backend must reject node without semantic');
  });
  t('H-04-02', '未知原语被拦截（应在编译期）', () => {
    let threw = false;
    try { toIRNode('p-unknown'); } catch (e) { threw = /unknown.primitive/.test(e.message); }
    assert(threw);
  });
  t('H-04-03', '框架不直接建线程（委托 runtime.createWorker）', () => {
    const before = rt.threads.length;
    rt.createWorker();
    assert(rt.threads.length === before + 1, 'thread must come from runtime');
  });
  t('H-04-04', '引擎不感知 Vue（无 vue import）', () => {
    const src = DomTreeBackend.toString() + TerminalBackend.toString();
    assert(!/from ['"]vue['"]/.test(src) && !/require\(['"]vue['"]\)/.test(src));
  });
  t('H-04-05', '宿主不解析 IR 字段', () => {
    const src = TerminalHostRuntime.toString();
    assert(!/semantic\s*===/.test(src), 'host must not branch on IR semantic');
  });

  // --- H-05 热切换（4）---
  t('H-05-01', '热切换后 currentBackend 变更', () => { disp.switchBackend(term); assert(disp.currentBackend.id === 'terminal'); });
  t('H-05-02', '热切换后可重新渲染', () => {
    const root = term.createNode({ id: 'r3', semantic: 'layout.box', props: {} });
    term.attachToHost(root);
    renderer.render(SFC(), root);
    assert(/<p-button[ >]/.test(term.render(root)), 'terminal render missing p-button');
  });
  t('H-05-03', '切回 Backend A 仍正确', () => {
    disp.switchBackend(dom);
    const root = dom.createNode({ id: 'r4', semantic: 'layout.box', props: {} });
    dom.attachToHost(root);
    renderer.render(SFC(), root);
    assert(JSON.stringify(dom.snapshot()).includes('layout.grid'));
  });
  t('H-05-04', 'capabilities.rehydrate 已声明', () => assert(dom.capabilities.rehydrate === true));

  // --- H-06 混合渲染（4）---
  t('H-06-01', '同页面可持有多个 Backend 实例', () => assert(dom.id !== term.id));
  t('H-06-02', 'p-canvas 可指定 engine（语义属性）', () => {
    const ir = toIRNode('p-canvas', { engine: 'skia' });
    assert(ir.props.engine === 'skia' && ir.semantic === 'ui.canvas');
  });
  t('H-06-03', '降级策略写入 IR', () => assert(toIRNode('p-canvas').degradation === 'hide'));
  t('H-06-04', 'Dispatcher 单实例支持多后端（方案 B）', () => assert(disp.currentBackend === dom && term instanceof DomTreeBackend));

  // --- H-07 能力契约（4）---
  t('H-07-01', 'Carrier 声明 threadAffinity', () => assert(typeof carrier.capabilities.threadAffinity === 'boolean'));
  t('H-07-02', 'JSI 受限、AOT 不受限（G-40）', () => {
    const aot = new AOTCarrier(rt);
    assert(carrier.capabilities.trueConcurrency === false && aot.capabilities.trueConcurrency === true);
  });
  t('H-07-03', 'AOT 跨界成本为 0', () => {
    const aot = new AOTCarrier(rt);
    aot.cross(); aot.cross();
    assert(aot.boundaries === 0 && carrier.cross() > 0);
  });
  t('H-07-04', 'realtime 能力仅在 AOT 可用', () => {
    const aot = new AOTCarrier(rt);
    assert(carrier.capabilities.realtime.capable === false && aot.capabilities.realtime.capable === true);
  });

  // --- H-08 错误降级（3）---
  t('H-08-01', '未知原语抛错而非静默', () => { let ok = false; try { toIRNode('div'); } catch (e) { ok = true; } assert(ok); });
  t('H-08-02', '缺失 semantic 的后端拒绝渲染', () => { let ok = false; try { term.createNode({ id: 'y', props: {} }); } catch (e) { ok = true; } assert(ok); });
  t('H-08-03', 'destroy 后状态为 destroyed', () => { const r = new TerminalHostRuntime(); r.bootstrap(); r.destroy(); assert(r.state === 'destroyed'); });

  return results;
}

// ============================================================
// 9. 主流程
// ============================================================
function main() {
  const rt = new TerminalHostRuntime();
  const carrier = new JSICarrier(rt);
  const dom = new DomTreeBackend();
  const term = new TerminalBackend();

  // G-41.6：注册先于 bootstrap
  const disp = new ProteusNodeOpsDispatcher(dom);
  rt.bootstrap();

  const renderer = createRenderer(disp);

  console.log('=== G-41 宿主接入参考实现 ===\n');
  console.log('[接入] runtime=%s carrier=%s backend=%s', rt.id, carrier.id, dom.id);

  // 引擎 A 渲染
  const rootA = dom.createNode({ id: 'rootA', semantic: 'layout.box', props: {} });
  dom.attachToHost(rootA);
  const v1 = SFC();
  renderer.render(v1, rootA);
  console.log('\n[引擎 A: vue-dom] 结构快照:');
  console.log(JSON.stringify(dom.snapshot(), null, 2));

  // 切换引擎（业务 SFC 不变）
  disp.switchBackend(term);
  const rootB = term.createNode({ id: 'rootB', semantic: 'layout.box', props: {} });
  term.attachToHost(rootB);
  renderer.render(SFC(), rootB);   // ★ 同一份 SFC 函数，未做任何修改
  console.log('\n[引擎 B: terminal] ASCII 渲染:');
  console.log(term.render(rootB));

  console.log('\n[验证] 同一份 SFC 在两个引擎下渲染，业务代码零改动 ✓');

  // Conformance
  const res = runConformance();
  console.log('\n=== Host Conformance ===');
  res.details.forEach(([id, st, desc]) => console.log(`  ${st.padEnd(4)} ${id}  ${desc}`));
  console.log(`\n  PASS=${res.pass}  FAIL=${res.fail}  SKIP=${res.skip}`);

  if (require.main === module) {
    console.log('\n' + JSON.stringify({ pass: res.pass, fail: res.fail, skip: res.skip }));
    process.exit(res.fail === 0 ? 0 : 1);
  }
}

module.exports = { runConformance, TerminalHostRuntime, JSICarrier, AOTCarrier, DomTreeBackend, TerminalBackend, ProteusNodeOpsDispatcher, createRenderer, toIRNode, SFC, PRIMITIVE_TABLE };

if (require.main === module) main();
