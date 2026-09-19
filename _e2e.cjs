// 用真实 Chromium 跑完整用户流程（rAF 正常，不受 in-app browser 限制）
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e.message).slice(0, 100)));
  const log = [];

  // ① 作品列表
  await p.goto('http://127.0.0.1:5273/pages/index');
  await p.waitForTimeout(2600);
  const list = await p.evaluate(() => ({
    items: [...document.querySelectorAll('.item')].map(i => i.textContent.replace(/\s+/g,' ').trim()),
    cls: document.querySelector('.page')?.className,
  }));
  log.push(['作品列表', `${list.items.length} 本`, list.cls]);

  // ② 进默者工作台
  await p.evaluate(() => [...document.querySelectorAll('.item')].find(i => i.textContent.includes('默者'))?.click());
  await p.waitForTimeout(3200);
  const wb = await p.evaluate(() => ({
    url: location.pathname,
    title: document.querySelector('.page-title')?.textContent?.trim(),
    sub: document.querySelector('.topbar .xs')?.textContent?.replace(/\s+/g,' ').trim(),
    acts: document.querySelectorAll('.act').length,
    cont: [...document.querySelectorAll('.btn')].find(b => b.textContent.includes('继续写'))?.textContent?.trim(),
    cls: document.querySelector('.page')?.className,
  }));
  log.push(['工作台', `${wb.title} / ${wb.acts} 幕 / ${wb.cont}`, wb.cls]);

  // ③ 点"写作"进编辑器
  await p.evaluate(() => [...document.querySelectorAll('.chip-acts .chip-btn')].find(b => b.textContent.trim() === '写作')?.click());
  await p.waitForTimeout(3200);
  const ed = await p.evaluate(() => ({
    url: location.pathname,
    title: document.querySelector('.ed-title')?.textContent?.replace(/\s+/g,' ').trim(),
    words: document.querySelector('.ed-words')?.textContent?.trim(),
    len: (document.querySelector('.ed-text')?.value || '').length,
    anns: [...document.querySelectorAll('.ed-ann > summary')].map(s => s.textContent.trim()),
    cls: document.querySelector('.page')?.className,
  }));
  log.push(['写作页', `${ed.title} / ${ed.words}字 / 正文${ed.len}字符`, ed.cls]);

  // ④ 真的写一行 → 自动保存
  const ta = p.locator('.ed-text');
  const cur = await ta.inputValue();
  await ta.fill(cur.trimEnd() + '\n\nProteus 真实浏览器实测写入。\n');
  await p.waitForTimeout(700);
  const mid = await p.evaluate(() => ({
    words: document.querySelector('.ed-words')?.textContent?.trim(),
    delta: document.querySelector('.ed-delta')?.textContent?.trim(),
    state: document.querySelector('.ed-bar .badge')?.textContent?.replace(/\s+/g,' ').trim(),
  }));
  await p.waitForTimeout(3600);
  const saved = await p.evaluate(() => ({
    state: document.querySelector('.ed-bar .badge')?.textContent?.replace(/\s+/g,' ').trim(),
    warn: document.querySelector('.ed-warn')?.textContent?.trim().slice(0,60),
  }));
  log.push(['输入→未保存', `${mid.words}字 delta=${mid.delta} ${mid.state}`, '']);
  log.push(['自动保存', `${saved.state}${saved.warn ? ' / 警告:'+saved.warn : ''}`, '']);

  await p.screenshot({ path: '/tmp/e2e_editor.png' });
  await b.close();
  for (const [k, v, cls] of log) console.log(`  ${k.padEnd(12)} ${v}${cls ? '  [class='+cls+']' : ''}`);
  if (errs.length) console.log('  页面错误:', errs.slice(0,3));
})().catch(e => console.log('失败:', e.message.slice(0,200)));
