const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto('file:///data/workspace/proteus-website-v3/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/data/workspace/proteus-website-v3/screenshot.png', fullPage: true });
  // 交互：切到 iOS + Rust，验证四维度切换真的生效
  await page.selectOption('#sel-render', 'ios');
  await page.selectOption('#sel-compiler', 'rust');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/data/workspace/proteus-website-v3/screenshot-ios-rust.png', fullPage: false });
  await browser.close();
  console.log('OK');
})();
