// 逻辑级验证：证明 index.html 的四维度切换真实可交互
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const values = {};
const cache = {};

function makeEl(id){
  const el = {
    _children: [],
    get value(){ return values[id] ?? ''; },
    set value(v){ values[id] = v; },
    innerHTML: '', textContent: '', style: {},
    appendChild(child){ el._children.push(child); },
    removeChild(){}, setAttribute(){}, addEventListener(){}, querySelectorAll(){ return []; },
    set innerHTML(v){ el._html = v; },
    set textContent(v){ el._text = v; },
  };
  return el;
}

const documentStub = {
  getElementById: (id) => { if(!cache[id]) cache[id] = makeEl(id); return cache[id]; },
  createElement: () => makeEl('dynamic-created'),
  querySelectorAll: () => [],
};

// 初始值
values['sel-render']='vue'; values['sel-compiler']='node';
values['sel-device']='web'; values['sel-cap']='native';

const sandbox = { document: documentStub, window: {}, console, setTimeout:(fn)=>fn() };
const fn = new Function('document','window','console','setTimeout',
  script + '\n;return { RENDER, DEVICE, COMPILER, CAP, update };');
const api = fn.call(sandbox, documentStub, sandbox.window, console, sandbox.setTimeout);

const ok = {};

// [1] 初始态
api.update();
ok.initialRender = cache['lbl-render']._text === 'VueDomBackend (Web)';
ok.initialIR = (cache['ir-code']._html || '').includes('"layout.grid"');
ok.initialScan = (cache['ir-foot']._html || '').includes('NativeBackend 已声明支持');
console.log('[1] 初始态:', ok.initialRender?'✓ render':'✗', ok.initialIR?'✓ IR':'✗', ok.initialScan?'✓ scanQR':'✗');

// [2] 切换 render=ios / compiler=rust / device=harmony / cap=mock
values['sel-render']='ios'; values['sel-compiler']='rust';
values['sel-device']='harmony'; values['sel-cap']='mock';
api.update();
const ir = cache['ir-code']._html || '';
const irText = ir.replace(/<[^>]+>/g, ''); // 剥离高亮 span，取纯文本
ok.switchRender = cache['lbl-render']._text === 'NativeBackend · iOS';
ok.switchCompiler = cache['lbl-compiler']._text === 'Rust (SWC / rolldown)';
ok.switchDevice = cache['lbl-device']._text === 'Harmony';
ok.switchCap = cache['lbl-cap']._text === 'Mock (Dev)';
ok.irRender = /"renderBackend":\s*"ios"/.test(irText);
ok.irCompiler = /"compilerBackend":\s*"rust"/.test(irText);
ok.irDevice = /"device":\s*"harmony"/.test(irText);
console.log('[2] 切换:', ok.switchRender?'✓ render':'✗', ok.switchCompiler?'✓ compiler':'✗',
  ok.switchDevice?'✓ device':'✗', ok.switchCap?'✓ cap':'✗');
console.log('    IR 字段:', ok.irRender?'✓ renderBackend':'✗', ok.irCompiler?'✓ compilerBackend':'✗', ok.irDevice?'✓ device':'✗');
if(!ok.irRender) console.log('    ! irText:', irText.slice(0,140));

// [3] 车机 Tier 2 降级
values['sel-device']='car';
api.update();
ok.carDegrade = (cache['ir-foot']._html || '').includes('需外接扫码设备');
console.log('[3] 车机降级:', ok.carDegrade?'✓ 正确触发':'✗');

// [4] render=ska → 2 列（cols 逻辑）
values['sel-render']='ska';
api.update();
const ir4 = (cache['ir-code']._html || '').replace(/<[^>]+>/g, '');
ok.skaCols = /"maxCols":\s*2/.test(ir4);
console.log('[4] Skia 2列:', ok.skaCols?'✓ maxCols=2':'✗', '| note=', (cache['note']._html||'').slice(0,50));

const allPass = Object.values(ok).every(Boolean);
console.log('\n=== 汇总 (12 项) ===');
for(const [k,v] of Object.entries(ok)) console.log(`  ${v?'✓':'✗'} ${k}`);
console.log('\n' + (allPass
  ? '✅ 四维度切换全部联动正确，IR 实时反映 render/compiler/device/capability 变化，车机降级正确'
  : '❌ 存在失败项'));
process.exit(allPass ? 0 : 1);
