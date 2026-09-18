#!/usr/bin/env node
/**
 * check-css-report.mjs —— CSS 预算门禁（G-21 css-compat B3，10-benchmark-budgets.md §四）
 * 读 `proteus css:check --report <path>` 产出的 JSON，断言预算指标；任一超限 → exit 1（CI 阻断 PR）
 *
 * 用法：
 *   node scripts/check-css-report.mjs <css-report.json>
 *   node scripts/check-css-report.mjs --budgets   # 打印预算表
 */
import fs from 'fs';

const BUDGETS = [
  { key: 'forbiddenCount', label: '--strict-css 违规（CSS001-007）', limit: 0, direction: 'max' },
  { key: 'bundleCssBytes', label: '全量样式字节数 (gzip)', limit: 60_000, direction: 'max' },
  { key: 'criticalCssBytes', label: '首屏关键 CSS 字节数', limit: 14_000, direction: 'max' },
  { key: 'styleIRObjects', label: 'Style IR 运行时对象数', limit: 1500, direction: 'max' },
  { key: 'selectors', label: '选择器数量（编译前）', limit: 800, direction: 'max' },
  { key: 'semanticRatio', label: '语义组件占比', limit: 0.7, direction: 'min' },
];

if (process.argv.includes('--budgets')) {
  for (const b of BUDGETS) console.log(`${b.key}: ${b.direction === 'max' ? '<=' : '>='} ${b.limit}（${b.label}）`);
  process.exit(0);
}

const file = process.argv[2];
if (!file) {
  console.error('用法：node scripts/check-css-report.mjs <css-report.json>');
  process.exit(2);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`[check-css-report] 报告读取失败：${e.message}`);
  process.exit(2);
}

const global = report.global;
if (!global) {
  console.error('[check-css-report] 报告缺 global 聚合字段（需 proteus css:check --report 产出）');
  process.exit(2);
}

let failures = 0;
for (const b of BUDGETS) {
  const actual = global[b.key] ?? 0;
  const pass = b.direction === 'max' ? actual <= b.limit : actual >= b.limit;
  if (pass) {
    console.log(`  ✅ ${b.label}：${actual} ${b.direction === 'max' ? '<=' : '>='} ${b.limit}`);
  } else {
    failures++;
    console.error(`  ❌ ${b.label}：${actual} 超预算（${b.direction === 'max' ? '>' : '<'} ${b.limit}）`);
  }
}

console.log(failures ? `\n✗ CSS 预算门禁失败 ${failures} 项` : '\n✅ CSS 预算门禁全部通过');
process.exit(failures ? 1 : 0);
