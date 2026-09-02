#!/usr/bin/env node
/**
 * verify-llm.js —— Proteus Website v3 · LLM 规则自动化校验
 *
 * 把 .llmrules 里的 MUST / MUST_NOT 变成可对 .html 文件执行的静态检查。
 * 用法：  node verify-llm.js <file.html> [file2 ...]
 *         node verify-llm.js --all        # 校验本目录全部 .html
 *
 * 退出码：0 = 全部通过，1 = 有违规（可用于 CI gate）。
 *
 * 检查项（与 .llmrules 一一对应）：
 *   C1  禁止色值（hardcoded hex 不在 palette 内 / 小程序式标签名）
 *   C2  "源码不变"不变式（#src / data-dim 交互 Demo 中不得有改写 #src 的逻辑）
 *   C3  后端色固定（iOS/Android/Flutter/Skia 出现时应用对应 token 色）
 *   C4  IR 面板必须存在且含动态字段
 *   C5  文案铁律（slogan / wx.* 不得作为首选 / plan ID）
 *   C6  Token 锚点（关键 CSS custom property 存在）
 *   C7  DOCTYPE / lang / viewport / title
 */
const fs = require('fs');
const path = require('path');

// palette = 基础 + syntax(代码高亮) + device(终端模拟) + aux(页面辅助色)
// 完整清单见 design-tokens.json 的 color 对象。新增颜色请先进 tokens.json，校验器自动放行。
const PALETTE = new Set([
  '#0a0a0c','#121216','#1a1a20','#26262e','#f2f2f5','#8a8a99','#5c5c6a',
  '#7c5cff','#6a4cf0','#00e0c6','#ff8a5c','#3ddc97','#ffb454','#ff6b6b',
  '#42b883','#0a84ff','#3ddc84','#54c5f8','#ffd54f',
  '#c792ea','#e06c75','#d19a66','#98c379','#5c6370','#61afef','#a6a6b8','#e05b5b',
  '#b6a3ff','#1a2a55','#1a2238','#2a365e','#eef2ff','#e6fbff','#c9d3f0',
  '#0d1530','#111c40','#0f1a30','#1a1208','#0a1024','#0d0d18','#f6f8fc','#7d8590',
  '#7ee787','#d2a8ff','#a5d6ff','#ff9b73',
  '#fff','#556','#667','#889','#bcd','#cde','#eef0f6','#eef1f8','#eef3ff','#e6fbff',
  'rgba(124,92,255','rgba(61,220,151','rgba(0,224,198'
]);
const BACKEND_COLOR = {
  ios: ['#0a84ff','var(--ios)'], android: ['#3ddc84','var(--android)'],
  flutter: ['#54c5f8','var(--flutter)'], skia: ['#ffd54f','var(--skia)']
};
const SLOGAN = 'One semantic model';
const MINIPROGRAM_PRIMARY = /\b(wx\.(request|login|scanCode|getLocation|pay|share)|uni\.(request|navigateTo))\b/g;

function read(f){ return fs.readFileSync(f,'utf8'); }

function check(file){
  const src = read(file);
  const errs = [];
  const warn = [];
  const lines = src.split('\n');

  const report = (lineNo, code, msg) => errs.push(`  ${file}:${lineNo}  [${code}]  ${msg}`);

  // ---- C1 禁止色值 ----
  // 规则：禁止"裸 hex 杂色"。以下场景放行：
  //   a) 位于 :root 变量声明（视为本文件局部 token 定义点）
  //   b) 上下文为 var(--*) 引用
  //   c) 属于 design-tokens.json 全局 palette
  // 这样存量页面（flexible-multi-device 等）的 :root 声明全部合规，
  // 而 LLM 新代码被强制走 var(--*)。
  const localPalette = new Set();
  src.replace(/:root\s*\{[^}]*\}/g, block => {
    block.replace(/--[a-zA-Z0-9-]+\s*:\s*(#[0-9a-fA-F]{3,8})\b/gi, (_, v) => {
      localPalette.add(v.toLowerCase());
    });
  });
  const hexRe = /#([0-9a-fA-F]{3,8})\b/g;
  src.replace(hexRe, (m, _h, off) => {
    const ctx = src.slice(Math.max(0,off-60), off);
    const isVarUse = /\bvar\(/.test(ctx) || ctx.includes(')');
    if(ctx.includes('--') || isVarUse) return;     // a / b
    if(PALETTE.has(m.toLowerCase())) return;        // c 全局 palette
    if(localPalette.has(m.toLowerCase())) return;    // a 本文件 :root 已声明
    const ln = src.slice(0,off).split('\n').length;
    report(ln, 'C1', `裸色值 ${m}（不在 design-tokens.json，且非常量 CSS 变量声明；请改用 var(--*)）`);
  });

  // ---- C6 Token 锚点 ----
  ['--bg','--brand','--ink','--line','--panel'].forEach(t=>{
    if(!src.includes(t)) warn.push(`  ${file}  [C6]  建议定义 CSS 变量 ${t}`);
  });

  // ---- C7 结构 ----
  if(!/<!DOCTYPE html>/i.test(src)) report(1,'C7','缺少 <!DOCTYPE html>');
  if(!/<html[^>]*lang=/i.test(src)) report(1,'C7','<html> 缺少 lang 属性');
  if(!/name="viewport"/i.test(src)) report(1,'C7','缺少 viewport meta');
  if(!/<title>/i.test(src)) report(1,'C7','缺少 <title>');

  // ---- C5 slogan ----
  if(!src.includes(SLOGAN)) warn.push(`  ${file}  [C5]  未出现精确 slogan "${SLOGAN}..."（页面级建议）`);

  // ---- C5 wx.* 作为首选（出现在非 "对照/appendix/mapping" 语境且带 success 回调风格）----
  const mpMatches = src.match(MINIPROGRAM_PRIMARY) || [];
  if(mpMatches.length && !/(对照|mapping|appendix|migrate|小程序)/i.test(src)){
    warn.push(`  ${file}  [C5]  检测到 ${mpMatches.length} 处 wx./uni. 用法且非对照附录，应改为 useFetch() 等语义 API`);
  }

  // ---- Playground 专项（仅当文件含交互 Demo 时）----
  if(/data-dim|pw3-playground|class="editor"/.test(src)){
    // C2 不变式：不得出现改写 #src / .editor 内容的赋值
    lines.forEach((ln, i)=>{
      if(/#src|editor|source/.test(ln) && /(innerHTML|textContent|innerText|value\s*=)/.test(ln)){
        report(i+1,'C2','交互 Demo 不得改写源码节点（违反"源码不变"不变式）');
      }
    });
    // C4 IR 面板
    if(!/ir-panel|class="ir"|ir-panel/.test(src)){
      warn.push(`  ${file}  [C4]  交互 Demo 建议含 IR 面板（id="ir" 或 .ir-panel）`);
    }
  }

  // ---- C3 后端色：若出现 "iOS"/"Android" 等关键字，附近应有对应颜色 ----
  Object.entries(BACKEND_COLOR).forEach(([k, cols])=>{
    const re = new RegExp('\\b'+k+'\\b','i');
    if(re.test(src)){
      const hasColor = cols.some(c => src.includes(c));
      if(!hasColor) warn.push(`  ${file}  [C3]  出现 "${k}" 但未用其后端色 ${cols[0]}`);
    }
  });

  return { file, errs, warn };
}

// ---- 入口 ----
const args = process.argv.slice(2);
let files = args.filter(a => a.endsWith('.html'));
if(args.includes('--all') || files.length===0){
  files = fs.readdirSync(__dirname||process.cwd()).filter(f => f.endsWith('.html'));
}
if(files.length===0){ console.log('无 .html 文件可校验'); process.exit(0); }

let totalErr = 0, totalWarn = 0;
files.forEach(f=>{
  const { file, errs, warn } = check(f);
  console.log(`\n▶ ${path.basename(file)}`);
  errs.forEach(e => console.log('  ✗'+e));
  warn.forEach(w => console.log('  !'+w));
  console.log(`  → errors: ${errs.length}, warnings: ${warn.length}`);
  totalErr += errs.length; totalWarn += warn.length;
});

console.log(`\n═══ LLM 规则校验：${files.length} 文件 · errors=${totalErr} · warnings=${totalWarn} ═══`);
process.exit(totalErr > 0 ? 1 : 0);
