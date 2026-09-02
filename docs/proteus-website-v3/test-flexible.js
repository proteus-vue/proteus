const fs = require('fs');
const path = require('path');

// 尝试用 jsdom 做真实 DOM 驱动；若无则退化到静态文本断言
let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch(e) {}

const file = '/data/workspace/proteus-website-v3/flexible-multi-device.html';
const html = fs.readFileSync(file, 'utf8');

let pass = 0, fail = 0;
const errors = [];
function ok(cond, msg){
  if(cond){ pass++; }
  else { fail++; errors.push(msg); }
}

/* ===== 静态结构断言（不依赖 jsdom） ===== */
const devices = ['phone','tablet','pc','car','tv','watch'];
ok(devices.every(k => html.includes(`nm:"${ {phone:'手机',tablet:'平板',pc:'PC / Mac',car:'车机',tv:'TV / 大屏',watch:'手表'}[k] }`)), '六端齐全(中文名)');
ok(devices.every(k => html.includes(`"${k}"`)) || devices.every(k => html.includes(`data-k="${k}"`)) , '六端 key 存在');

// 统一业务场景：云端商城 · 商品详情页
ok(html.includes('云端商城'), '统一场景: 云端商城');
ok(html.includes('无线降噪耳机') || html.includes('ProductDetail'), '统一场景: 商品详情(耳机)');
ok(html.includes('相关推荐'), '统一场景: 相关推荐');
ok(html.includes('加入购物车'), '统一场景: 加购 CTA');

// 一套代码多端: p-adaptive 语义 + 源码冻结证据
ok(html.includes('p-adaptive'), '一套代码: p-adaptive 语义原语');
ok(html.includes('frozenTag') || html.includes('已冻结') || html.includes('SOURCE UNCHANGED'), '一套代码: 源码冻结证据');
ok(/v-if="touch"/.test(html) && /v-if="wide"/.test(html), '一套代码: 形态守卫(无 ifdef)');

// 响应式帧（溢出修复）: 不再固定 px，改用 aspect-ratio + max-width
ok(html.includes('aspect-ratio:var(--ar'), '溢出修复: frame 用 aspect-ratio 变量');
ok(html.includes('maxWidth = d.maxW'), '溢出修复: JS 只设 max-width');
ok(!html.includes('f.style.width = d.frame.w+"px"'), '溢出修复: 已移除固定 px 宽高赋值');
ok(html.includes('.frame-host'), '溢出修复: 居中宿主容器');
ok(html.includes('notch') && html.includes('has-notch'), '溢出修复: 刘海按端条件(手机有/其余无)');

// IR 面板字段
ok(html.includes('renderBackend'), 'IR: renderBackend 字段');
ok(html.includes('BackendCapabilities'), 'IR: BackendCapabilities');
ok(html.includes('@conditional') || html.includes('conditional'), 'IR: 降级机制');

// 降级/守卫证据
ok(html.includes('focusTree') || html.includes('focus-tree') || html.includes('焦点树'), '降级: 车机焦点树');
ok(html.includes('crown'), '降级: 手表表冠');
ok(html.includes('sku') && html.includes('退化') || html.includes('单选'), '降级: SKU 退化说明');

// 设计契约文本
ok(html.includes('layout') && html.includes('contextual'), '契约: layout=auto / nav=contextual');

/* ===== DOM 级断言（若 jsdom 可用） ===== */
const summary = { pass, fail, errors };
if(JSDOM){
  const dom = new JSDOM(html, { runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  const doc = window.document;

  // 执行脚本：提取 inline script 并 eval（捕获 __PROTEUS__）
  const scripts = [...doc.querySelectorAll('script')].map(s=>s.textContent);
  const sandbox = `(${scripts.join('\n;\n')})`;
  try {
    window.eval(scripts.join('\n;\n'));
  } catch(e){
    // 部分 DOM API 缺失时忽略，仍跑自测
  }
  const P = window.__PROTEUS__;
  if(P && typeof P.runSelfTest === 'function'){
    try { const out = P.runSelfTest(); console.log('\n[runSelfTest]\n' + out); }
    catch(e){ console.log('\n[runSelfTest ERROR] ' + e.message); summary.fail++; summary.errors.push('runSelfTest threw: '+e.message); }
  }

  // 关键不变式：切换六端后源码面板文本不变
  if(P){
    const src0 = doc.getElementById('source').textContent;
    let unchanged = true;
    for(const k of Object.keys(P.DEVICES)){
      P.selectDevice(k);
      if(doc.getElementById('source').textContent !== src0){ unchanged = false; break; }
    }
    ok(unchanged, '★ 核心不变式: 切换六端，源码文本完全相同');
  }

  // 无溢出：各端 frame 宽度不超过 stage 容器（通过 max-width 约束）
  ok(doc.querySelector('.frame-host'), 'DOM: .frame-host 存在');
  ok(doc.querySelector('.devices').children.length === 6, 'DOM: 6 个设备按钮');

  // 刘海仅在手机端显示
  P.selectDevice('phone');
  ok(doc.getElementById('notch').style.display !== 'none', 'DOM: 手机端 notch 显示');
  P.selectDevice('tv');
  ok(doc.getElementById('notch').style.display === 'none', 'DOM: TV 端 notch 隐藏');
}

console.log('\n=== Flexible Layout Test ===');
console.log(`PASS: ${summary.pass}  FAIL: ${summary.fail}`);
if(summary.errors.length) console.log('ERRORS:\n - ' + summary.errors.join('\n - '));
process.exit(summary.fail ? 1 : 0);
