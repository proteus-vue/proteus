#!/usr/bin/env node
/**
 * check-consistency.js —— Proteus 跨层一致性校验（proteus-architecture 规约 CI 门禁）
 *
 * 仅依赖 Node 内置模块。被 .github/workflows/consistency.yml 调用。
 *
 * 检查项：
 *  1. scope 残留扫描：`@proteus/<pkg>`（非 `@proteus-vue/<pkg>`）→ 失败（铁律 scope 统一）
 *  2. G 表跨文件一致：规约层三份文件的 G-xx 行集合必须一致（G-01~G-28，无缺口无重复）→ 失败
 *  3. 包注册表对照：00-architecture.md 注册表 vs packages/* 实际包名 → 报告（不失败，文档描述未来态）
 *  4. contracts 检查：packages/contracts 存在性 → 报告
 *
 * 用法：
 *  node scripts/check-consistency.js
 *  node scripts/check-consistency.js --focus=contracts   # 仅 contracts 检查
 *  node scripts/check-consistency.js --layering          # 分层检查（包名合法 + 类型包零运行时依赖）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FACADE_DIR = path.join(ROOT, 'docs', 'proteus-architecture-facade-plan');
const FACADE_FILES = ['00-architecture.md', 'ARCHITECTURE.md', '01-optimization-log.md'];

let failures = 0;
let warnings = 0;

function fail(msg) {
  failures++;
  console.error(`  ❌ ${msg}`);
}
function warn(msg) {
  warnings++;
  console.log(`  ⚠️  ${msg}`);
}
function ok(msg) {
  console.log(`  ✅ ${msg}`);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.github', '.proteus', 'dist'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** 从规约文件提取 G-xx 行集合 */
function extractGSet(file) {
  const content = fs.readFileSync(file, 'utf8');
  const set = new Set();
  for (const line of content.split('\n')) {
    const m = line.match(/^\|\s*\*{0,2}G-(\d{2})\*{0,2}\s*\|/);
    if (m) set.add(parseInt(m[1], 10));
  }
  return set;
}

/* ---------- 1. scope 残留扫描 ---------- */
function checkScope() {
  console.log('\n[1/4] scope 残留扫描（@proteus/ 应为 @proteus-vue/）');
  const exts = new Set(['.md', '.ts', '.json', '.js', '.mjs', '.vue']);
  // 注意：@proteus-vue/ 中 @proteus 后是 '-'，不会被 @proteus\/ 命中，天然豁免
  const scopeRe = /@proteus\/([a-zA-Z0-9-]+)/g;
  let bad = [];
  for (const file of walk(ROOT)) {
    if (!exts.has(path.extname(file))) continue;
    const content = fs.readFileSync(file, 'utf8');
    const re = new RegExp(scopeRe.source, 'g');
    let m;
    while ((m = re.exec(content)) !== null) {
      const lineNo = content.slice(0, m.index).split('\n').length;
      bad.push(`${path.relative(ROOT, file)}:${lineNo} ${m[0]}`);
      break; // 每文件只记一次
    }
  }
  if (bad.length) {
    bad.forEach((b) => fail(`遗留旧 scope: ${b}`));
  } else {
    ok('无 @proteus/ 残留');
  }
}

/* ---------- 2. G 表跨文件一致 ---------- */
function checkGTable() {
  console.log('\n[2/4] G 表跨文件一致（规约层三份文件必须同集合）');
  let sets = [];
  let missing = [];
  for (const f of FACADE_FILES) {
    const p = path.join(FACADE_DIR, f);
    if (!fs.existsSync(p)) {
      fail(`规约文件缺失: docs/proteus-architecture-facade-plan/${f}`);
      continue;
    }
    const set = extractGSet(p);
    sets.push({ file: f, set });
    ok(`${f}: ${[...set].sort((a, b) => a - b).map((n) => `G-${String(n).padStart(2, '0')}`).join(' ')}`);
  }
  if (sets.length === 0) return;
  const first = sets[0].set;
  for (const { file, set } of sets.slice(1)) {
    const a = [...first].sort((x, y) => x - y);
    const b = [...set].sort((x, y) => x - y);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      fail(`G 表不一致: ${sets[0].file} 与 ${file} 集合不同`);
      const onlyA = a.filter((n) => !set.has(n));
      const onlyB = b.filter((n) => !first.has(n));
      if (onlyA.length) fail(`  仅在 ${sets[0].file}: ${onlyA.map((n) => 'G-' + String(n).padStart(2, '0')).join(', ')}`);
      if (onlyB.length) fail(`  仅在 ${file}: ${onlyB.map((n) => 'G-' + String(n).padStart(2, '0')).join(', ')}`);
    }
  }
  // 序列完整性：G-01..G-N 无缺口无重复
  const nums = [...first].sort((a, b) => a - b);
  for (let i = 1; i <= nums.length; i++) {
    if (nums[i - 1] !== i) {
      fail(`G 表序列不连续（期望 G-${String(i).padStart(2, '0')}，实际 ${nums.map((n) => 'G-' + String(n).padStart(2, '0')).join(', ')}）`);
      break;
    }
  }
  if (nums.length) ok(`G 表序列完整：G-01 ~ G-${String(nums.length).padStart(2, '0')}`);
}

/* ---------- 3. 包注册表对照 ---------- */
function checkRegistry() {
  console.log('\n[3/4] 包注册表对照（规约 vs packages/*）');
  const doc = fs.readFileSync(path.join(FACADE_DIR, '00-architecture.md'), 'utf8');
  const docPackages = new Set();
  for (const m of doc.matchAll(/`@proteus-vue\/([a-zA-Z0-9-]+)`/g)) docPackages.add(m[1]);

  const actual = new Set();
  for (const entry of fs.readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJson = path.join(ROOT, 'packages', entry.name, 'package.json');
    if (fs.existsSync(pkgJson)) {
      try {
        const name = JSON.parse(fs.readFileSync(pkgJson, 'utf8')).name;
        if (name) actual.add(name.replace(/^@proteus-vue\//, ''));
      } catch (e) {
        warn(`packages/${entry.name}/package.json 解析失败`);
      }
    }
  }
  const docOnly = [...docPackages].filter((p) => !actual.has(p)).sort();
  const actualOnly = [...actual].filter((p) => !docPackages.has(p)).sort();
  if (docOnly.length) warn(`规约注册表有但未落地（规划中）: ${docOnly.join(', ')}`);
  if (actualOnly.length) warn(`已落地但规约注册表未登记: ${actualOnly.join(', ')}`);
  ok(`规约注册表 ${docPackages.size} 项 / 实际包 ${actual.size} 项（差异仅报告，文档描述未来态）`);
}

/* ---------- 4. contracts 检查 ---------- */
function checkContracts() {
  console.log('\n[4/4] contracts 检查');
  const contractsDir = path.join(ROOT, 'packages', 'contracts');
  if (fs.existsSync(contractsDir)) {
    ok('packages/contracts 存在');
  } else {
    warn('packages/contracts 未落地（规划中，跨层 DTO 契约先行）');
  }
}

/* ---------- 分层检查（--layering） ---------- */
function checkLayering() {
  console.log('\n[layering] 分层检查');
  const typesPkg = path.join(ROOT, 'packages', 'types', 'package.json');
  if (fs.existsSync(typesPkg)) {
    const json = JSON.parse(fs.readFileSync(typesPkg, 'utf8'));
    const deps = { ...(json.dependencies || {}), ...(json.peerDependencies || {}) };
    const runtimeDeps = Object.keys(deps).filter((d) => !d.startsWith('@types/') && !d.startsWith('typescript'));
    if (runtimeDeps.length) {
      warn(`types 包含运行时依赖（铁律：types 零运行时依赖）: ${runtimeDeps.join(', ')}`);
    } else {
      ok('types 包零运行时依赖');
    }
  } else {
    fail('packages/types/package.json 缺失');
  }
  // 每个包应具名 @proteus-vue/* 且含 tsconfig.build.json
  // 例外：create-proteus 按 npm 脚手架惯例使用无 scope 的 create-* 名（npm create 解析约定）
  for (const entry of fs.readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = entry.name;
    if (dir.startsWith('.') || dir === 'node_modules') continue;
    const pkgJson = path.join(ROOT, 'packages', dir, 'package.json');
    if (!fs.existsSync(pkgJson)) continue;
    const name = JSON.parse(fs.readFileSync(pkgJson, 'utf8')).name || '';
    if (/^@proteus-vue\//.test(name)) {
      ok(`${dir} 包名合规（@proteus-vue/*）`);
    } else if (/^create-/.test(name)) {
      ok(`${dir} 包名合规（create-* 脚手架惯例例外）`);
    } else {
      fail(`包名未用 @proteus-vue scope: ${dir} → ${name}`);
    }
    if (!fs.existsSync(path.join(ROOT, 'packages', dir, 'tsconfig.build.json'))) {
      warn(`packages/${dir} 缺 tsconfig.build.json`);
    }
  }
  ok('分层检查完成');
}

const args = process.argv.slice(2);
const focusContracts = args.includes('--focus=contracts');
const layering = args.includes('--layering');

if (focusContracts) {
  checkContracts();
} else if (layering) {
  checkLayering();
} else {
  checkScope();
  checkGTable();
  checkRegistry();
  checkContracts();
}

console.log(`\n${failures ? `✗ 失败 ${failures} 项 / 警告 ${warnings} 项` : `✅ 全部通过（警告 ${warnings} 项）`}`);
process.exit(failures ? 1 : 0);
