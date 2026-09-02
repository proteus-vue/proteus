/**
 * test-flexible.js —— 柔性框架多端展示 逻辑级自测
 * 对标 G-27 conformance：同一份源码(key) → Backend 推导出确定拓扑
 * 运行：node test-flexible.js  （需要 jsdom：npm i jsdom -g 或本地）
 */
const path = require('path');
const fs = require('fs');

let window;
try {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'flexible-multi-device.html'), 'utf8'), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://proteus.dev/'
  });
  window = dom.window;
} catch (e) {
  // jsdom 不可用时做纯逻辑提取验证（至少校验源码面板与拓扑契约）
  console.log('[skip] jsdom 不可用，退化为静态契约校验\n');
}

const asserts = [];
function ok(cond, msg){ asserts.push([!!cond, msg]); }

if (window && window.__PROTEUS__) {
  const { DEVICES, selectDevice } = window.__PROTEUS__;
  const keys = Object.keys(DEVICES);

  // ① 六端齐全
  ok(keys.length === 6, `设备目录 = 6 端 (实际 ${keys.length})`);
  ['phone','tablet','pc','car','tv','watch'].forEach(k=>{
    ok(!!DEVICES[k], `含 ${k}`);
  });

  // ② 拓扑契约：大屏必有侧栏，手机必有 FAB，TV/车机必走 dpad
  keys.forEach(k=>{
    selectDevice(k);
    const d = DEVICES[k];
    const uiNodes = window.document.getElementById('ui').children.length;
    ok(uiNodes > 0, `${k}: UI 已渲染 (${uiNodes} 节点)`);
    ok(window.document.getElementById('devName').textContent === d.nm, `${k}: 名称正确`);

    if (k === 'pc' || k === 'tablet') ok(d.showSidebar === true, `${k}: 侧栏展开`);
    if (k === 'phone')              ok(d.showFab === true, `${k}: FAB 呈现`);
    if (k === 'tv' || k === 'car')  ok(d.caps.dpad === 1, `${k}: dpad 方向键导航`);
    if (k === 'watch')              ok(d.caps.crown === 1, `${k}: 表冠输入`);
    if (k === 'tv')                 ok(d.cols === 4, `${k}: 4 列海报流`);
  });

  // ③ 源码不可变（核心：切换端，源码面板内容不变）
  const src1 = window.document.getElementById('source').textContent;
  selectDevice('watch');
  const src2 = window.document.getElementById('source').textContent;
  ok(src1 === src2, '切换终端 → 源码面板零改动');
  ok(/p-adaptive/.test(src1), '源码含 p-adaptive');
  ok(/v-if="touch"/.test(src1), '源码含 touch 守卫');

  // ④ IR 派生一致性：cols 反映到 IR 面板
  selectDevice('pc');
  ok(/renderBackend/.test(window.document.getElementById('ir').textContent), 'IR 面板含 renderBackend');

} else {
  // 纯静态退化校验：HTML 里六个 dev-btn + 拓扑描述齐全
  const html = fs.readFileSync(path.join(__dirname, 'flexible-multi-device.html'), 'utf8');
  ['phone','tablet','pc','car','tv','watch'].forEach(k=>{
    ok(html.includes(`data-k="${k}"`), `静态含 ${k} 按钮`);
  });
  ['UICollectionView','GridView','SkCanvas','RECORDED ON DEVICE','@conditional'].forEach(t=>{
    ok(html.includes(t), `静态含关键词 ${t}`);
  });
}

const pass = asserts.filter(a=>a[0]).length;
console.log('═════════════════════════════════════════════');
console.log(`  Flexible Layout Self-Test: ${pass}/${asserts.length} PASS`);
console.log('═════════════════════════════════════════════');
asserts.forEach(([o,m])=>console.log(`  ${o?'✓':'✗'} ${m}`));
if (pass !== asserts.length) process.exit(1);
