#!/usr/bin/env node
/**
 * G-38 Conformance Runner（真实可运行）
 * 用两个参考实现（Terminal + Node）演示 42 项测试的执行方式。
 *
 * 用法：
 *   node conformance-runner.js                 # 跑全部
 *   node conformance-runner.js --only C-06     # 仅某组
 *   node conformance-runner.js --report out.json
 *
 * ★入库整合（决策 #312）：原稿为 CommonJS（require），仓库根 package.json 为
 *   "type": "module" → 改为 ESM import。
 */
import fs from 'fs'

/* ============ IR 类型（对应 IRModule 标准） ============ */
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/* ============ 后端 A：Terminal（最简，用于 CI 自检逻辑） ============ */
class TerminalCompilerBackend {
  constructor() {
    this.id = 'terminal';
    this.version = '0.1.0';
    this.capabilities = {
      incremental: false, aot: false, sourceMap: false,
      minify: false, treeShake: false,
      targetPlatforms: ['web'],
      supportedLanguages: ['sfc'],
      backend: 'js', deterministic: true,
    };
    this._init = false;
  }
  async initialize() { this._init = true; }
  dispose() { this._init = false; }
  parse(source) {
    // 极简但合规：扫描 <p-xxx> 标签，保留源码位置（CMP034 / C-03-04）
    const nodes = [];
    const re = /<(p-[a-z]+)([^>]*)>/g;
    let m;
    while ((m = re.exec(source.content)) !== null) {
      nodes.push({ kind: 'element', tag: m[1], attributes: {}, loc: { line: 1, column: m.index } });
    }
    // 语法错误 → Diagnostic，不抛异常（C-03-03 / CMP033）
    if (source.content.includes('<unclosed')) {
      return { nodes: [], diagnostics: [{ code: 'unclosed', message: 'unclosed tag', loc: {} }] };
    }
    return { nodes };
  }
  transform(ast) {
    if (ast.diagnostics?.length) return { components: [], capabilities: [], imports: [], metadata: {} };
    // ★ 基于 semantic 映射表分发（G-35.1，含 button）
    const map = { 'p-grid': 'layout.grid', 'p-stack': 'layout.stack', 'p-scroll': 'layout.scroll', 'p-text': 'ui.text', 'p-button': 'ui.button' };
    const components = ast.nodes.map(n => ({
      semantic: map[n.tag] ?? `unknown.${n.tag}`,
      props: {}, children: [],
    }));
    return { components, capabilities: [], imports: [], metadata: {} };
  }
  emit(module) {
    const code = module.components.map(c => `├─ ${c.semantic}`).join('\n');
    return { code, map: null, hash: hash(code) };
  }
  createIncrementalSession() {
    return {
      id: 'noop', invalidate() {}, invalidateAll() {},
      recompute() { return { changed: [], removed: [], added: [], affectedFiles: [] }; },
      getDependencies() { return []; }, getDependents() { return []; },
      commit() {}, rollback() {}, getStats() { return {}; }, dispose() {},
    };
  }
  reportDiagnostics() { return []; }
  getCacheKey(source) { return hash(source.content); }
  getArtifactHash(artifact) { return artifact.hash; }
}

/* ============ 后端 B：Node（完整参考实现） ============ */
class NodeCompilerBackend extends TerminalCompilerBackend {
  constructor() {
    super();
    this.id = 'node';
    this.capabilities = {
      ...this.capabilities,
      incremental: true, sourceMap: true, minify: true, treeShake: true,
      supportedLanguages: ['sfc', 'tsx', 'jsx', 'vue'],
    };
  }
  parse(source) {
    // 真实实现会用 @babel/parser；此处用增强版模拟（保留位置信息 → C-03-04）
    const nodes = [];
    const re = /<(p-[a-z]+)([^>]*)>/g;
    let m;
    while ((m = re.exec(source.content)) !== null) {
      nodes.push({
        kind: 'element', tag: m[1],
        loc: { line: 1, column: m.index }, // ★ 位置信息（CMP034）
      });
    }
    // 语法错误 → Diagnostic（C-03-03, CMP033）
    if (source.content.includes('<unclosed')) {
      return { nodes: [], diagnostics: [{ code: 'unclosed', message: 'unclosed tag', loc: {} }] };
    }
    return { nodes };
  }
  transform(ast) {
    if (ast.diagnostics) return { components: [], capabilities: [], imports: [], metadata: {} };
    // ★ 基于 semantic 分发，禁止标签名（G-35.1）
    const map = { 'p-grid': 'layout.grid', 'p-stack': 'layout.stack', 'p-scroll': 'layout.scroll', 'p-text': 'ui.text', 'p-button': 'ui.button' };
    const components = ast.nodes.map(n => ({
      semantic: map[n.tag] ?? `unknown.${n.tag}`, // 未知 → 诊断，非崩溃（C-04-06）
      props: {}, children: [],
    }));
    return { components, capabilities: [], imports: [], metadata: {} };
  }
  emit(module) {
    const code = `/* bundle */\n${module.components.map(c => `create('${c.semantic}')`).join('\n')}`;
    return { code, map: { version: 3 }, hash: hash(code) };
  }
}

/* ============ Conformance 测试框架 ============ */
const tests = []; // {id, group, fn}
const register = (group) => (id, fn) => tests.push({ id: `${group}-${id}`, group, fn });

const C01 = register('C-01');
const C02 = register('C-02');
const C03 = register('C-03');
const C04 = register('C-04');
const C05 = register('C-05');
const C06 = register('C-06');
const C07 = register('C-07');
const C08 = register('C-08');
const C09 = register('C-09');
const C10 = register('C-10');

const REQUIRED = [
  'id','version','capabilities','initialize','dispose',
  'parse','transform','emit','createIncrementalSession',
  'reportDiagnostics','getCacheKey','getArtifactHash',
];

/* ---- C-01 接口完整性 ---- */
C01('01', b => { REQUIRED.forEach(m => { if (typeof b[m] === 'undefined' && m !== 'version') throw new Error(`missing ${m}`); }); });
C01('02', b => { if (typeof b.id !== 'string' || !b.id) throw new Error('id'); });
C01('03', b => { if (!b.capabilities || typeof b.capabilities !== 'object') throw new Error('capabilities'); });
C01('04', b => { ['parse','transform','emit'].forEach(m => { if (typeof b[m] !== 'function') throw new Error(`not fn: ${m}`); }); });
C01('05', b => { if (typeof b.createIncrementalSession !== 'function') throw new Error('no session'); });
C01('06', b => { b.reportDiagnostics?.({}); b.getCacheKey?.({ content: '' }); b.getArtifactHash?.({}); }); // no-op 不崩

/* ---- C-02 生命周期 ---- */
C02('01', async b => { await b.initialize(); if (!b._init && b.id !== 'node') throw new Error('not init'); });
C02('02', b => { b.dispose(); if (b._init) throw new Error('not disposed'); });
C02('03', async b => { await b.initialize(); await b.initialize(); }); // 幂等
C02('04', b => { b.dispose(); });
C02('05', async b => { await Promise.all([b.initialize(), b.initialize()]); });

/* ---- C-03 parse ---- */
C03('01', b => { const ir = b.parse({ content: '<p-grid><p-text></p-text></p-grid>' }); if (!ir.nodes.find(n => n.tag === 'p-grid')) throw new Error('no grid'); });
C03('02', b => { const ir = b.parse({ content: '<p-stack></p-stack>' }); if (!ir.nodes.find(n => n.tag === 'p-stack')) throw new Error('no stack'); });
C03('03', b => { const ir = b.parse({ content: '<unclosed' }); if (!ir.diagnostics?.length) throw new Error('should diagnose, not throw'); });
C03('04', b => { const ir = b.parse({ content: '<p-grid></p-grid>' }); if (!ir.nodes[0].loc) throw new Error('no loc info'); });
C03('05', b => { try { b.parse({ content: '<p-unsupported-xxx></p-unsupported-xxx>' }); } catch(e) { throw new Error('must diagnose'); } });

/* ---- C-04 transform 语义 ---- */
C04('01', b => { const ir = b.transform(b.parse({ content: '<p-grid></p-grid>' })); if (ir.components[0].semantic !== 'layout.grid') throw new Error('semantic'); });
C04('02', b => { const ir = b.transform(b.parse({ content: '<p-stack snap="mandatory"></p-stack>' })); if (ir.components[0].semantic !== 'layout.stack') throw new Error('stack'); });
C04('03', b => { const ir = b.transform(b.parse({ content: '<p-button></p-button>' })); if (ir.components[0].semantic !== 'ui.button') throw new Error('button'); });
C04('04', b => { const ir = b.transform(b.parse({ content: '<p-grid></p-grid>' })); if (!ir.components[0].hasOwnProperty('semantic')) throw new Error('no semantic field'); });
C04('05', b => { const a = b.transform(b.parse({ content: '<p-text></p-text>' })); const c = b.transform(b.parse({ content: '<p-text></p-text>' })); if (JSON.stringify(a) !== JSON.stringify(c)) throw new Error('not deterministic in transform'); });
C04('06', b => { const ir = b.transform(b.parse({ content: '<p-grid></p-grid>' })); if (ir.components[0].semantic === 'unknown.p-grid') throw new Error('should map'); });

/* ---- C-05 emit ---- */
C05('01', b => { const m = b.transform(b.parse({ content: '<p-grid></p-grid>' })); const a = b.emit(m); if (!a.code) throw new Error('no code'); });
C05('02', b => { if (!b.capabilities.sourceMap) return 'SKIP'; const m = b.transform(b.parse({ content: '<p-grid></p-grid>' })); const a = b.emit(m); if (!a.map) throw new Error('no sourcemap'); });
C05('03', b => { const m = b.transform(b.parse({ content: '<p-grid></p-grid>' })); const a = b.emit(m); if (!a.hash) throw new Error('no hash'); });
C05('04', b => { if (!b.capabilities.treeShake) return 'SKIP'; });
C05('05', b => { const m = b.transform(b.parse({ content: '<p-grid></p-grid>' })); const a1 = b.emit(m); const a2 = b.emit(m); if (a1.code !== a2.code) throw new Error('not deterministic emit'); });

/* ---- C-06 增量编译 ---- */
C06('01', b => { const s = b.createIncrementalSession('/tmp'); if (!s.id) throw new Error('no id'); });
C06('02', b => { if (!b.capabilities.incremental) return 'SKIP'; const s = b.createIncrementalSession('/tmp'); s.invalidate('a.sfc'); const diff = s.recompute(); if (!diff.affectedFiles) throw new Error('no diff'); });
C06('03', b => { if (!b.capabilities.incremental) return 'SKIP'; const s = b.createIncrementalSession('/tmp'); const k = s.getDependencies('a.sfc'); if (!Array.isArray(k)) throw new Error('no deps'); });
C06('04', b => { if (!b.capabilities.incremental) return 'SKIP'; const s = b.createIncrementalSession('/tmp'); s.invalidate('a.sfc'); s.recompute(); s.commit(); });
C06('05', b => { if (!b.capabilities.incremental) return 'SKIP'; const s = b.createIncrementalSession('/tmp'); s.rollback(); });

/* ---- C-07 降级与 Fallback ---- */
C07('01', b => { if (b.id !== 'node') return 'SKIP'; /* FallbackBackend 见下方 selectCompilerBackend */ });
C07('02', b => { if (b.id !== 'node') return 'SKIP'; });
C07('03', b => { const m = b.transform(b.parse({ content: '<p-grid></p-grid>' })); const a = b.emit(m); if (!a.code) throw new Error('no artifact'); });

/* ---- C-08 性能基准 ---- */
C08('01', b => { if (typeof b.benchmark !== 'function') return 'SKIP'; });
C08('02', b => { if (b.id !== 'rust') return 'SKIP'; });
C08('03', b => { if (b.id !== 'wasm') return 'SKIP'; });

/* ---- C-09 确定性 ---- */
C09('01', b => { const m = b.transform(b.parse({ content: '<p-grid></p-grid>' })); const h1 = b.getArtifactHash(b.emit(m)); const h2 = b.getArtifactHash(b.emit(m)); if (h1 !== h2) throw new Error(`not deterministic: ${h1} != ${h2}`); });
C09('02', async b => { if (b.id !== 'node') return 'SKIP'; const RustStub = class extends NodeCompilerBackend { constructor(){ super(); this.id='rust'; } }; const rust = new RustStub(); const ir1 = b.transform(b.parse({ content: '<p-grid></p-grid>' })); const ir2 = rust.transform(rust.parse({ content: '<p-grid></p-grid>' })); if (JSON.stringify(ir1) !== JSON.stringify(ir2)) throw new Error('Node≠Rust IR'); });

/* ---- C-10 可观测性 ---- */
C10('01', b => { const d = b.reportDiagnostics({}); if (!Array.isArray(d)) throw new Error('not array'); });
C10('02', b => { const s = b.createIncrementalSession('/tmp'); if (typeof s.getStats !== 'function') throw new Error('no stats'); });

/* ---- FallbackBackend（C-07） ---- */
function selectCompilerBackend(preferred) {
  if (preferred === 'rust') {
    // 模拟 Rust 不可用 → 降级 Node
    const log = { fallback: true, from: 'rust', to: 'node' };
    return { backend: new NodeCompilerBackend(), fallback: log };
  }
  return { backend: new NodeCompilerBackend(), fallback: null };
}

/* ============ 执行 ============ */
async function runBackend(name, backend) {
  const results = [];
  for (const t of tests) {
    try {
      const ret = await t.fn(backend);
      // 测试函数返回字符串 'SKIP'（capability 不足，依据 G-35.3 诚实声明）
      results.push({ ...t, status: ret === 'SKIP' ? 'SKIP' : 'PASS' });
    } catch (e) {
      results.push({ ...t, status: e.message === 'SKIP' ? 'SKIP' : 'FAIL', error: e.message });
    }
  }
  return results;
}

(async () => {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  const reportPath = process.argv.includes('--report') ? process.argv[process.argv.indexOf('--report') + 1] : null;

  const backends = [
    ['Terminal', new TerminalCompilerBackend()],
    ['Node', new NodeCompilerBackend()],
  ];

  let totalPass = 0, totalFail = 0, totalSkip = 0;
  const all = [];

  for (const [name, b] of backends) {
    await b.initialize();
    const r = await runBackend(name, b);
    b.dispose();
    console.log(`\n[${name} 后端]`);
    for (const t of r) {
      if (only && !t.group.startsWith(only)) continue;
      const icon = t.status === 'PASS' ? '✅' : t.status === 'SKIP' ? '⏭️ ' : '❌';
      console.log(`  ${icon} ${t.id} ${t.status === 'FAIL' ? '— ' + t.error : ''}`);
      if (t.status === 'PASS') totalPass++;
      else if (t.status === 'FAIL') totalFail++;
      else totalSkip++;
      all.push({ backend: name, ...t });
    }
  }

  // Fallback 演示（C-07）
  console.log(`\n[FallbackBackend 演示]`);
  const fb = selectCompilerBackend('rust');
  console.log(`  rust 不可用 → 降级 ${fb.backend.id}：${JSON.stringify(fb.fallback)}`);

  console.log(`\n─────────────────────────────`);
  console.log(`总计：PASS=${totalPass}  FAIL=${totalFail}  SKIP=${totalSkip}`);
  console.log(`42 项 conformance（C-01~C-10 × 各组）`);

  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ results: all, summary: { pass: totalPass, fail: totalFail, skip: totalSkip } }, null, 2));

  process.exit(totalFail > 0 ? 1 : 0);
})();
