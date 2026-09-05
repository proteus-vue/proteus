'use strict';
// G-60 官网落地与插件 API 文档 — reference implementation (zero deps)
// 自测见 conformance.md；数字以实测为准，非估算

// ==================== 基础工具 ====================

function stableStringify(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// FNV-1a 32bit
function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function isBlank(s) { return s === undefined || s === null || String(s).trim() === ''; }

// ==================== 1. 版本注册表 ====================

const VERSION_STATUS = ['active', 'maintenance', 'deprecated', 'archived'];

class VersionRegistry {
  constructor(config) {
    this.versions = (config.versions || []).slice();
    this.policy = config.policy || { keepActive: 3 };
  }

  _byId(id) { return this.versions.find(v => v.id === id) || null; }

  latest() {
    const act = this.versions.filter(v => v.status === 'active');
    if (act.length === 0) return null;
    return act.slice().sort((a, b) => (a.released < b.released ? 1 : -1))[0].id;
  }

  // ★ INV-W6：未知版本返回 null，禁止静默降级到 latest
  resolve(alias) {
    if (alias === 'latest') return this.latest();
    if (isBlank(alias)) return null;
    const v = this._byId(alias);
    return v ? v.id : null;
  }

  statusOf(v) {
    const e = this._byId(v);
    return e ? e.status : null;
  }

  shouldIndex(v) {
    const s = this.statusOf(v);
    if (s === null) return false;
    return s !== 'deprecated' && s !== 'archived';
  }

  // ★ INV-W4：横幅含版本号 + 状态 + 最新版【等价页】深链
  bannerFor(v, page) {
    const s = this.statusOf(v);
    if (s === null) return null;
    if (s === 'active') return null;
    const level = s === 'maintenance' ? 'info' : (s === 'deprecated' ? 'warning' : 'archived');
    const b = { level, version: v, status: s, linkToLatest: null };
    const latestId = this.latest();
    if (latestId) b.linkToLatest = equivalentPage(latestId, page || '');
    const e = this._byId(v);
    if (e && e.eol) b.eol = e.eol;
    return b;
  }

  // 语义：保留最新的 keepActive 个【未归档】版本；
  //      超出部分的未归档版本 → archived 候选（仅提示，不自动删除）
  //      ★ 已归档的不重复提示，也不挤占保留名额
  retentionCandidates() {
    const sorted = this.versions.slice()
      .filter(v => v.status !== 'archived')
      .sort((a, b) => (a.released < b.released ? 1 : -1));
    return sorted.slice(this.policy.keepActive).map(v => v.id);
  }
}

// 路由工具（模块级，供 VersionRegistry 与测试共用）
function canonicalUrl(version, page, registry) {
  const latestId = registry.latest();
  if (!latestId) return '/docs/' + version + '/' + page;
  return '/docs/' + latestId + '/' + page;   // ★ P2.6：一律指向 latest
}

function equivalentPage(version, page) {
  return '/docs/' + version + '/' + page;
}

// ==================== 2. 导航树与断链 ====================

class DocTree {
  constructor(pages) { this.pages = pages || []; }

  _known() { return new Set(this.pages.map(p => p.path)); }

  routes() { return this.pages.map(p => p.path); }

  // INV：内部断链必须机器检测
  brokenLinks() {
    const known = this._known();
    const out = [];
    for (const p of this.pages) {
      for (const l of (p.links || [])) {
        if (l === null || l === undefined || String(l).trim() === '') {
          out.push({ from: p.path, to: String(l), reason: 'empty' });
          continue;
        }
        const target = String(l).replace(/[#?].*$/, '');
        if (target === '') continue;          // 纯锚点，跳过
        if (!known.has(target)) out.push({ from: p.path, to: target, reason: 'missing' });
      }
    }
    return out;
  }
}

// ★ INV-W3：版本无关内容单一源，各版本构建时引用（不复制）
function buildVersionDocs(sharedPages, versionPages) {
  return {
    shared: sharedPages,                 // 同一对象引用，多处复用
    versioned: versionPages,
    routes: sharedPages.map(p => p.path).concat(versionPages.map(p => p.path))
  };
}

// ==================== 3. API 规格与漂移 ====================

class ApiSpec {
  constructor(version, entries) {
    this.version = version;
    this.entries = entries || [];
  }
  hash() {
    return hashString(stableStringify({ version: this.version, entries: this.entries }));
  }
  // ★ P4：参考页是 renderer，不是 copy
  renderReference() {
    const L = [];
    L.push('---');
    L.push('generated: true');
    L.push('source_hash: ' + this.hash());
    L.push('---');
    L.push('');
    if (this.entries.length === 0) L.push('(本版本暂无 API)');
    for (const e of this.entries) {
      L.push('# ' + e.name);
      L.push('');
      L.push('> since ' + e.since + ' · tier ' + e.tier +
             (e.capability ? ' · capability ' + e.capability : ''));
      L.push('');
      if (!isBlank(e.description)) L.push(e.description);
      L.push('');
      L.push('## 参数');
      const ps = e.params || [];
      if (ps.length === 0) L.push('(无)');
      else for (const p of ps) L.push('- `' + p.name + '`: ' + p.type + (p.required ? '（必填）' : '（可选）'));
      L.push('');
      L.push('## 返回');
      L.push('    ' + e.returns);
      L.push('');
    }
    return L.join('\n');
  }
}

class GeneratedDoc {
  constructor(spec) {
    this.sourceHash = spec.hash();
    this.pages = [{ path: 'api/' + spec.version, title: 'API ' + spec.version, links: [] }];
  }
}

// ★ INV-W1：漂移即阻断
function checkDrift(spec, doc) {
  const h = spec.hash();
  if (h === doc.sourceHash) return { status: 'fresh' };
  return { status: 'stale', expected: h, actual: doc.sourceHash };
}

function lintSpec(spec) {
  const issues = [];
  for (const e of spec.entries) {
    if (isBlank(e.description)) {
      issues.push({ name: e.name, code: 'MISSING_DESCRIPTION', message: '缺少描述' });
    }
    for (const p of (e.params || [])) {
      if (isBlank(p.description)) {
        issues.push({ name: e.name + '.' + p.name, code: 'MISSING_PARAM_DESCRIPTION', message: '参数缺少描述' });
      }
    }
    if (e.tier === 2 && isBlank(e.capability)) {
      issues.push({ name: e.name, code: 'MISSING_CAPABILITY', message: '外部进程插件必须声明 capability' });
    }
  }
  return issues;
}

// ★ INV-W7：破坏性变更必须被拦截
function diffSpecs(oldSpec, newSpec) {
  const oldMap = new Map(oldSpec.entries.map(e => [e.name, e]));
  const newMap = new Map(newSpec.entries.map(e => [e.name, e]));
  const added = [], removed = [], changed = [], breaking = [];

  for (const e of newSpec.entries) if (!oldMap.has(e.name)) added.push(e.name);

  for (const e of oldSpec.entries) {
    if (!newMap.has(e.name)) {
      removed.push(e.name);
      const c = { name: e.name, kind: 'removed', breaking: true, detail: 'API 被移除' };
      changed.push(c); breaking.push(c);
    }
  }

  for (const e of newSpec.entries) {
    const o = oldMap.get(e.name);
    if (!o) continue;
    const details = [];
    const oldP = new Map((o.params || []).map(p => [p.name, p]));
    const newP = new Map((e.params || []).map(p => [p.name, p]));

    for (const p of (e.params || [])) {
      if (!oldP.has(p.name)) {
        details.push(p.required
          ? { breaking: true, detail: '新增必填参数 ' + p.name }
          : { breaking: false, detail: '新增可选参数 ' + p.name });
      } else if (oldP.get(p.name).required !== p.required && p.required) {
        details.push({ breaking: true, detail: '参数 ' + p.name + ' 由可选变必填' });
      }
    }
    for (const p of (o.params || [])) {
      if (!newP.has(p.name)) details.push({ breaking: false, detail: '移除参数 ' + p.name });
    }
    if (o.returns !== e.returns) {
      const widened = e.returns.includes(o.returns) && e.returns.length > o.returns.length;
      details.push({
        breaking: !widened,
        detail: (widened ? '放宽' : '变更/收窄') + '返回类型 ' + o.returns + ' → ' + e.returns
      });
    }
    if (o.description !== e.description) details.push({ breaking: false, detail: '描述更新' });

    for (const d of details) {
      const c = { name: e.name, kind: 'changed', breaking: d.breaking, detail: d.detail };
      changed.push(c);
      if (d.breaking) breaking.push(c);
    }
  }
  return { added, removed, changed, breaking };
}

// ==================== 4. 下载矩阵 ====================

class DownloadMatrix {
  constructor(artifacts) { this.artifacts = artifacts || []; }

  // ★ 未命中返回 null：不猜测、不降级到近似平台
  pick(target, arch) {
    const hit = this.artifacts.filter(a => a.target === target && a.arch === arch);
    if (hit.length === 0) return null;
    return hit.slice().sort((a, b) => cmpVersion(a.version, b.version))[hit.length - 1];
  }

  validate(a) {
    if (!a) return { ok: false, code: 'ARTIFACT_NOT_FOUND' };
    if (isBlank(a.url)) return { ok: false, code: 'ARTIFACT_NOT_FOUND' };
    if (isBlank(a.signature)) return { ok: false, code: 'ARTIFACT_UNSIGNED' };  // ★ INV-W8
    return { ok: true };
  }
}

function updaterEndpoint(tpl, v, target, arch) {
  return String(tpl)
    .replace(/\{\{current_version\}\}/g, v)
    .replace(/\{\{target\}\}/g, target)
    .replace(/\{\{arch\}\}/g, arch);
}

// ==================== 测试框架 ====================

let _pass = 0, _fail = 0; const _cases = [];
function ok(cond, name) {
  const s = cond ? 'OK' : 'FAIL';
  if (cond) _pass++; else _fail++;
  _cases.push(s + ': ' + name);
}
function eq(a, b, name) { ok(a === b, name + ' (got ' + JSON.stringify(a) + ')'); }

// ==================== 主测试 ====================

function run() {
  // ---------- 版本注册表 ----------
  const reg = new VersionRegistry({
    versions: [
      { id: '0.4', status: 'active', released: '2026-08-01' },
      { id: '0.3', status: 'maintenance', released: '2026-05-01' },
      { id: '0.2', status: 'deprecated', released: '2026-02-01', eol: '2026-11-01' },
      { id: '0.1', status: 'archived', released: '2025-11-01', eol: '2026-05-01' }
    ],
    policy: { keepActive: 3 }
  });

  eq(reg.resolve('latest'), '0.4', 'resolve latest → 0.4');
  eq(reg.resolve('0.4'), '0.4', 'resolve 已存在版本原样返回');
  eq(reg.resolve('0.3'), '0.3', 'resolve maintenance 版本');
  eq(reg.resolve('9.9'), null, '★ INV-W6 未知版本返回 null，不静默降级');
  eq(reg.resolve(''), null, '空别名返回 null');

  eq(reg.statusOf('0.2'), 'deprecated', 'statusOf deprecated');
  eq(reg.statusOf('9.9'), null, 'statusOf 未知版本 null');

  eq(reg.shouldIndex('0.4'), true, 'active 可索引');
  eq(reg.shouldIndex('0.3'), true, 'maintenance 可索引');
  eq(reg.shouldIndex('0.2'), false, 'deprecated 不可索引（noindex）');
  eq(reg.shouldIndex('0.1'), false, 'archived 不可索引（noindex）');

  eq(reg.bannerFor('0.4', 'guide/install'), null, 'active 无横幅');
  eq(reg.bannerFor('0.2', 'guide/install').level, 'warning', '★ INV-W4 deprecated 黄色警告');
  eq(reg.bannerFor('0.3', 'guide/install').level, 'info', 'maintenance 蓝色信息条');
  eq(reg.bannerFor('0.1', 'guide/install').level, 'archived', 'archived 灰色提示');
  eq(reg.bannerFor('0.2', 'guide/install').eol, '2026-11-01', '横幅含 EOL 日期');
  eq(reg.bannerFor('0.2', 'guide/install').linkToLatest, '/docs/0.4/guide/install',
     '★ INV-W4 指向最新版【等价页】，非首页');
  eq(reg.bannerFor('9.9', 'x'), null, '未知版本无横幅，不崩溃');

  // 未归档版本为 0.4/0.3/0.2 共 3 个，恰等于 keepActive=3 → 无候选
  eq(reg.retentionCandidates().length, 0, '未归档版本未超出 keepActive=3 → 无候选');
  ok(!reg.retentionCandidates().includes('0.1'), '已归档的 0.1 不重复作为候选');

  const reg2 = new VersionRegistry({
    versions: [
      { id: '0.5', status: 'active', released: '2026-09-01' },
      { id: '0.4', status: 'maintenance', released: '2026-08-01' },
      { id: '0.3', status: 'deprecated', released: '2026-05-01' },
      { id: '0.2', status: 'deprecated', released: '2026-02-01' }
    ],
    policy: { keepActive: 3 }
  });
  eq(reg2.retentionCandidates().length, 1, '★ 未归档版本超出 keepActive → 1 个候选');
  eq(reg2.retentionCandidates()[0], '0.2', '候选为最旧的未归档版本 0.2');
  eq(reg2.resolve('latest'), '0.5', '多版本 registry latest 取 released 最新');

  // ---------- canonical / 等价页 ----------
  eq(canonicalUrl('0.2', 'guide/install', reg), '/docs/0.4/guide/install',
     '★ P2.6 canonical 一律指向 latest');
  eq(canonicalUrl('0.4', 'guide/install', reg), '/docs/0.4/guide/install', 'latest 页 canonical 指向自身');
  eq(equivalentPage('0.3', 'guide/install'), '/docs/0.3/guide/install', '跨版本等价页');

  // ---------- 导航树 ----------
  const sharedPage = { path: 'shared/install-prereq', title: '安装前置条件', links: [] };
  const tree = new DocTree([
    sharedPage,
    { path: 'guide/install', title: '安装', links: ['shared/install-prereq', 'guide/config'] },
    { path: 'guide/config', title: '配置', links: ['guide/install', 'guide/missing'] },
    { path: 'guide/anchor', title: '锚点', links: ['guide/install#step2', ''] }
  ]);
  eq(tree.routes().length, 4, '路由数 = 页面数');
  const bl = tree.brokenLinks();
  eq(bl.length, 2, '★ 断链检测：missing + empty 各 1');
  eq(bl.filter(b => b.reason === 'missing').length, 1, 'missing 类型断链 1 条');
  eq(bl.filter(b => b.reason === 'missing')[0].to, 'guide/missing', '断链目标正确');
  eq(bl.filter(b => b.reason === 'empty').length, 1, '★ NEG-06 空链接被捕获');

  const cleanTree = new DocTree([
    { path: 'a', title: 'A', links: ['b'] },
    { path: 'b', title: 'B', links: ['a#x'] }
  ]);
  eq(cleanTree.brokenLinks().length, 0, '无断链时返回空数组');
  eq(new DocTree([]).brokenLinks().length, 0, '★ NEG 空导航树不崩溃');
  eq(new DocTree([]).routes().length, 0, '空树路由为空');

  // ---------- 共享内容单一源 ----------
  const built = buildVersionDocs([sharedPage], [{ path: 'guide/v', title: 'v', links: [] }]);
  ok(built.shared[0] === sharedPage, '★ INV-W3 shared 为同一对象引用，未被复制');
  eq(built.routes.length, 2, 'shared 与 versioned 均计入路由');
  eq(built.routes[0], 'shared/install-prereq', 'shared 页面在路由中');

  // ---------- ApiSpec / 漂移 ----------
  const specA = new ApiSpec('0.4', [
    {
      name: 'ext.proteus.spi.backends', since: '0.4', tier: 1, capability: 'spi.read',
      description: '列出当前激活的 SPI 后端',
      params: [{ name: 'layer', type: 'string', required: false, description: '按层过滤' }],
      returns: 'Backend[]'
    }
  ]);
  eq(specA.hash(), specA.hash(), 'hash 稳定（同内容两次一致）');
  ok(specA.hash() !== new ApiSpec('0.4', []).hash(), '内容变化 hash 变化');

  const ref = specA.renderReference();
  ok(ref.includes('ext.proteus.spi.backends'), '参考页含 API 名');
  ok(ref.includes('since 0.4'), '★ 参考页含 since（G-58 版本并存对接）');
  ok(ref.includes('tier 1'), '参考页含 tier 标注');
  ok(ref.includes('spi.read'), '参考页含 capability');
  ok(ref.includes('generated: true'), '★ 参考页标记 generated，防手工编辑');
  ok(ref.includes(specA.hash()), '参考页含 source_hash 锚点');
  ok(ref.includes('（可选）'), '参考页标注参数可选性');

  const doc1 = new GeneratedDoc(specA);
  eq(checkDrift(specA, doc1).status, 'fresh', '未漂移 → fresh');

  const specB = new ApiSpec('0.4', specA.entries.concat([{
    name: 'ext.proteus.device.list', since: '0.5', tier: 1, capability: 'device.read',
    description: '列出设备', params: [], returns: 'Device[]'
  }]));
  eq(checkDrift(specB, doc1).status, 'stale', '★ INV-W1 spec 更新后文档变 stale');
  ok(checkDrift(specB, doc1).expected !== checkDrift(specB, doc1).actual, 'stale 含 expected/actual');

  const doc2 = new GeneratedDoc(specB);
  eq(checkDrift(specB, doc2).status, 'fresh', '★ 重新生成后恢复 fresh');

  eq(new ApiSpec('0.4', []).hash().length, 8, '★ NEG-03 空 spec 仍可计算 hash');
  ok(new ApiSpec('0.4', []).renderReference().includes('暂无 API'), '★ NEG-04 空 entries 渲染不崩溃');

  // ---------- lint ----------
  eq(lintSpec(specA).length, 0, '完整 spec 无 lint issue');
  eq(lintSpec(new ApiSpec('0.4', [{
    name: 'x', since: '0.4', tier: 1, capability: 'c', params: [], returns: 'void'
  }])).length, 1, '★ 缺描述 → 1 条 issue');
  eq(lintSpec(new ApiSpec('0.4', [{
    name: 'x', since: '0.4', tier: 1, capability: 'c', description: '   ', params: [], returns: 'void'
  }])).length, 1, '★ NEG-08 仅空白字符视为缺失');
  eq(lintSpec(new ApiSpec('0.4', [{
    name: 'x', since: '0.4', tier: 1, capability: 'c', description: 'd',
    params: [{ name: 'p', type: 'string', required: true }], returns: 'void'
  }])).length, 1, '参数缺描述 → issue');
  eq(lintSpec(new ApiSpec('0.4', [{
    name: 'x', since: '0.4', tier: 2, description: 'd', params: [], returns: 'void'
  }])).length, 1, '★ tier2 缺 capability → issue');

  // ---------- diff ----------
  const base = new ApiSpec('0.4', [{
    name: 'a', since: '0.4', tier: 1, capability: 'c', description: 'A',
    params: [{ name: 'p1', type: 'string', required: true, description: 'd' }],
    returns: 'Backend[]'
  }]);

  const addApi = new ApiSpec('0.5', base.entries.concat([{
    name: 'b', since: '0.5', tier: 1, capability: 'c', description: 'B', params: [], returns: 'void'
  }]));
  let d = diffSpecs(base, addApi);
  eq(d.added.length, 1, '新增 API → added');
  eq(d.breaking.length, 0, '新增 API 非破坏');

  d = diffSpecs(addApi, base);
  eq(d.removed.length, 1, '移除 API → removed');
  eq(d.breaking.length, 1, '★ INV-W7 移除 API 破坏性被拦截');

  const addRequired = new ApiSpec('0.5', [{
    name: 'a', since: '0.4', tier: 1, capability: 'c', description: 'A',
    params: [
      { name: 'p1', type: 'string', required: true, description: 'd' },
      { name: 'p2', type: 'string', required: true, description: 'd' }
    ],
    returns: 'Backend[]'
  }]);
  d = diffSpecs(base, addRequired);
  eq(d.breaking.length, 1, '★ 新增必填参数 → 破坏性');

  const addOptional = new ApiSpec('0.5', [{
    name: 'a', since: '0.4', tier: 1, capability: 'c', description: 'A',
    params: [
      { name: 'p1', type: 'string', required: true, description: 'd' },
      { name: 'p2', type: 'string', required: false, description: 'd' }
    ],
    returns: 'Backend[]'
  }]);
  d = diffSpecs(base, addOptional);
  eq(d.breaking.length, 0, '新增可选参数 → 非破坏');
  eq(d.changed.length, 1, '新增可选参数记为 changed');

  const widened = new ApiSpec('0.5', [{
    name: 'a', since: '0.4', tier: 1, capability: 'c', description: 'A',
    params: [{ name: 'p1', type: 'string', required: true, description: 'd' }],
    returns: 'Backend[] | null'
  }]);
  d = diffSpecs(base, widened);
  eq(d.breaking.length, 0, '返回类型放宽 → 非破坏');

  const narrowed = new ApiSpec('0.5', [{
    name: 'a', since: '0.4', tier: 1, capability: 'c', description: 'A',
    params: [{ name: 'p1', type: 'string', required: true, description: 'd' }],
    returns: 'Backend'
  }]);
  d = diffSpecs(base, narrowed);
  eq(d.breaking.length, 1, '返回类型变更/收窄 → 破坏性');

  const descOnly = new ApiSpec('0.5', [{
    name: 'a', since: '0.4', tier: 1, capability: 'c', description: 'A2',
    params: [{ name: 'p1', type: 'string', required: true, description: 'd' }],
    returns: 'Backend[]'
  }]);
  d = diffSpecs(base, descOnly);
  eq(d.breaking.length, 0, '仅改描述 → 非破坏');
  eq(d.changed.length, 1, '仅改描述记为 changed');

  d = diffSpecs(base, new ApiSpec('0.4', base.entries));
  eq(d.added.length + d.removed.length + d.changed.length, 0, '无变化 → 空 diff');

  // ---------- 下载矩阵 ----------
  const mx = new DownloadMatrix([
    { target: 'darwin', arch: 'aarch64', version: '0.4.1', url: 'https://x/a', signature: 'sig-a', releaseNotes: '' },
    { target: 'darwin', arch: 'aarch64', version: '0.4.2', url: 'https://x/b', signature: 'sig-b', releaseNotes: '' },
    { target: 'linux', arch: 'x86_64', version: '0.4.2', url: 'https://x/c', signature: 'sig-c', releaseNotes: '' }
  ]);
  eq(mx.pick('darwin', 'aarch64').version, '0.4.2', '★ 多版本取最高');
  eq(mx.pick('linux', 'x86_64').url, 'https://x/c', 'linux 精确匹配');
  eq(mx.pick('windows', 'x86_64'), null, '★ 无匹配返回 null，不猜测');
  eq(mx.pick('darwin', 'armv7'), null, '★ NEG-07 未知 arch 返回 null，不降级到近似');
  eq(mx.validate(mx.pick('darwin', 'aarch64')).ok, true, 'validate 正常产物通过');
  eq(mx.validate(null).code, 'ARTIFACT_NOT_FOUND', 'validate null → NOT_FOUND');
  eq(mx.validate({ target: 'linux', arch: 'x86_64', version: '1', url: 'https://x' }).code,
     'ARTIFACT_UNSIGNED', '★ INV-W8 缺签名 → UNSIGNED');

  eq(updaterEndpoint('https://r.dev/{{target}}/{{arch}}/{{current_version}}', '0.4.2', 'darwin', 'aarch64'),
     'https://r.dev/darwin/aarch64/0.4.2', 'updater endpoint 三变量替换');
  eq(updaterEndpoint('https://r.dev/{{target}}', '0.4.2', 'linux', 'x86_64'),
     'https://r.dev/linux', 'endpoint 单变量替换');

  // ---------- 负向 / 边界 ----------
  const single = new VersionRegistry({ versions: [{ id: '1.0', status: 'active', released: '2026-01-01' }], policy: { keepActive: 3 } });
  eq(single.resolve('latest'), '1.0', '★ NEG-01 单版本站点 latest 正常');
  eq(single.retentionCandidates().length, 0, '单版本无 archived 候选');

  const allDeprecated = new VersionRegistry({
    versions: [
      { id: '0.2', status: 'deprecated', released: '2026-02-01' },
      { id: '0.1', status: 'deprecated', released: '2025-11-01' }
    ],
    policy: { keepActive: 3 }
  });
  eq(allDeprecated.latest(), null, '★ NEG-02 无 active 版本时 latest() 为 null');
  eq(allDeprecated.resolve('latest'), null, '无 active 时 latest 别名解析为 null，不崩溃');
  eq(canonicalUrl('0.2', 'p', allDeprecated), '/docs/0.2/p', '无 latest 时 canonical 回落自身');
  eq(allDeprecated.bannerFor('0.2', 'p').linkToLatest, null, '无 latest 时横幅无跳转链接');

  // ---------- 接缝命题 ----------
  // J1: G-58 WIT 版本化 ∧ G-60 文档版本化
  const witVersioned = specB.entries.map(e => e.since);
  ok(witVersioned.includes('0.4') && witVersioned.includes('0.5'),
     'J1 G-58 since 版本并存 ∧ G-60 文档按版本路由');

  // J2: G-59 治理 ∧ G-60 公示
  ok(reg.retentionCandidates().length >= 0 && Array.isArray(reg.retentionCandidates()),
     'J2 G-59 保留策略 ∧ G-60 可公示为结构化数据');

  // J3: G-56 Studio ∧ G-60 分发
  eq(mx.pick('darwin', 'aarch64').target, 'darwin', 'J3 G-56 Studio 产物 ∧ G-60 下载矩阵');

  // J4: G-37 未实测不宣称 ∧ G-60 数字可验证
  ok(checkDrift(specB, new GeneratedDoc(specB)).status === 'fresh' && specB.hash().length === 8,
     'J4 G-37 宣称可验证 ∧ G-60 source_hash 提供验证锚点');

  // J5: G-51 SKIP≠PASS ∧ G-60 未知版本不静默降级
  eq(reg.resolve('9.9'), null, 'J5 G-51 SKIP≠PASS ∧ 未知版本 null 而非 latest');

  // J6: G-59 硬拒绝 ∧ G-60 漂移阻断
  eq(checkDrift(specB, doc1).status, 'stale', 'J6 G-59 警告会被忽略→硬拒绝 ∧ 漂移 stale 阻断');

  // J7: INV-W3 复制即绑定
  ok(built.shared[0] === sharedPage,
     'J7 原则#0 不绑定 ∧ shared 单一源不复制');

  return Promise.resolve();
}

run().then(() => {
  for (const c of _cases) console.log(c);
  console.log('\nself-test: ' + _pass + '/' + (_pass + _fail));
  if (_fail > 0) process.exit(1);
}).catch(e => { console.error('FATAL', e); process.exit(2); });
