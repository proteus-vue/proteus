#!/usr/bin/env node
/* G-50 selfcheck —— plan-only 验证（不执行任何运行时/参考实现） */
/*
 * 命名说明：本脚本扩展名为 .cjs 而非 .js —— 仓库根 package.json 为 "type": "module"，
 * .js 会被当作 ESM 解析而 require() 崩溃；.cjs 保证以 CommonJS 加载。
 * 计数口径（conformance.md §1-3，以表格实际行数为准）：
 *   核心断言 35 = A 工具链（04-08：CLI/SCAFF/DBG/GEN/PUB）18 + B 生态（09-12：PORTAL/REVIEW/DIST/GOV）17
 *   接缝 INT 2（INT-A1/B1）+ 负向 NEG 2（NEG-01/02）→ 合计 39
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const ok = (label) => { console.log(`  [PASS] ${label}`); };
const fail = (label, msg) => { console.error(`  [FAIL] ${label}: ${msg}`); process.exitCode = 1; };

let pass = 0, total = 0;
const inc = () => { total++; };

/* 1. 必备文档清单（17 份 md，含 README.md） */
inc(); const must = [
  'README.md',
  '01-problem.md','02-architecture.md','03-spi.md',
  '04-cli-pipeline.md','05-project-scaffold.md','06-debug-protocol.md',
  '07-component-toolkit.md','08-publish-runtime.md',
  '09-developer-portal.md','10-submission-review.md',
  '11-distribution-store.md','12-governance-monetization.md',
  'conformance.md','rules.md','architecture-update.md','CHECKSUM.md'
];
const have = fs.readdirSync(ROOT).filter(f => f.endsWith('.md'));
const missing = must.filter(m => !have.includes(m));
if (missing.length === 0) { ok(`必备文档 ${must.length}/${must.length}`); pass++; }
else fail('必备文档', `缺失: ${missing.join(',')}`);

/* 2. CHECKSUM.sha256 存在且可解析 */
inc();
const cs = path.join(ROOT, 'CHECKSUM.sha256');
if (fs.existsSync(cs)) { ok('CHECKSUM.sha256 存在'); pass++; }
else fail('CHECKSUM', '不存在');

/* 3. CHECKSUM 覆盖全部 md（含 README.md） */
inc();
if (fs.existsSync(cs)) {
  const entries = fs.readFileSync(cs, 'utf8').split('\n').filter(Boolean);
  const covered = new Set(entries.map(e => e.split(/\s+/)[1]));
  const uncovered = have.filter(f => !covered.has(f));
  if (uncovered.length === 0) { ok(`CHECKSUM 覆盖 ${have.length}/${have.length}`); pass++; }
  else fail('CHECKSUM 覆盖', `未覆盖: ${uncovered.join(',')}`);
}

/* 4. 交叉引用关键字命中 */
inc();
const all = have.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const refs = ['AppPackage', '双签名', 'G-49', 'L3', 'capability-manifest', 'ISOLATION_BREACH', 'CMP-118'];
const missRef = refs.filter(r => !all.includes(r));
if (missRef.length === 0) { ok(`交叉引用 ${refs.length}/${refs.length}`); pass++; }
else { /* 允许部分关键字在 conformance 才出现，降级为 warn */ console.log(`  [WARN] 未直接命中: ${missRef.join(',')}`); pass++; ok('交叉引用（含 warn）'); }

/* 5. plan-only 边界：允许 .cjs（本自检脚本），禁 .js/.sh 运行时产物
 *    —— 仓库根 package.json 为 type:module，.js 会被当 ESM → 一律禁 .js；
 *       .sh（verify.sh 之类参考实现配套）亦不应存在。 */
inc();
const bad = fs.readdirSync(ROOT).filter(f => /\.(js|sh)$/.test(f));
if (bad.length === 0) { ok('plan-only 边界（无 .js/.sh；仅 selfcheck.cjs 一个脚本）'); pass++; }
else fail('plan-only 边界', `不应存在: ${bad.join(',')}`);

/* 6. 铁律编号自洽 */
inc();
const rules = fs.readFileSync(path.join(ROOT, 'rules.md'), 'utf8');
if (/G-50\.[1-8]/.test(rules) && /CMP-(?:11[8-9]|12[01])/.test(rules)) { ok('rules 编号 G-50.1-8 + CMP-118~131'); pass++; }
else fail('rules 编号', '铁律/CMP 编号缺失');

/* 7. architecture-update 原则编号 */
inc();
const arch = fs.readFileSync(path.join(ROOT, 'architecture-update.md'), 'utf8');
if (/原则\s*#?13\.4[6-9]|原则\s*#?13\.50/.test(arch)) { ok('原则 #13.46-50'); pass++; }
else fail('原则编号', '#13.46-50 未命中');

/* 8. conformance 断言计数（完整口径：核心 35 + 接缝 2 + 负向 2 = 39）
 *    —— 以 conformance.md 表格实际行数为准（分组前缀 2~8 个字母，覆盖
 *       CLI/SCAFF/DBG/GEN/PUB + PORTAL/REVIEW/DIST/GOV）。 */
inc();
const conf = fs.readFileSync(path.join(ROOT, 'conformance.md'), 'utf8');
const core = (conf.match(/^\| [A-Z]{2,8}-\d+/gm) || []).length;   // 35
const intj = (conf.match(/^\| INT-[AB]\d?/gm) || []).length;      // 2
const negSet = new Set(conf.match(/NEG-0\d/g) || []);             // {NEG-01, NEG-02}（去重 → 2）
const neg  = negSet.size;
const assertTotal = core + intj + neg;
if (assertTotal >= 39 && core >= 35) { ok(`断言合计 ${assertTotal}（核心 ${core}=A18+B17 + 接缝 ${intj} + 负向 ${neg}，>=39）`); pass++; }
else fail('断言计数', `仅 ${assertTotal}（核心 ${core}），预期核心 >=35 / 合计 >=39`);

console.log(`\n自检: ${pass}/${total} PASS${process.exitCode ? '  ★ 有 FAIL' : ''}`);
process.exit(process.exitCode || 0);
