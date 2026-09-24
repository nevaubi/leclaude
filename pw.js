const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  let errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 240)}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e).slice(0, 240)}`));
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`[http ${r.status()}] ${r.url()}`); });
  for (const path of ['/', '/workflows', '/workflows/wf_tpl_chronology', '/ediscovery?matter=m_afff_2873&tab=timeline']) {
    errors = [];
    try {
      await page.goto(`http://localhost:3177${path}`, { waitUntil: 'load', timeout: 300000 });
      await page.waitForTimeout(6000);
      const text = (await page.textContent('body')) || '';
      console.log(`${path} → "${await page.title()}" errors=${errors.length}${path.includes('chronology') ? ` verify=${/Verify events/i.test(text)} dedupe=${/Drop events already/i.test(text)} review=${/Trust review/i.test(text)}` : ''}`);
      for (const e of errors) console.log('   ', e);
    } catch (e) { console.log(`${path} FAILED: ${String(e).slice(0, 200)}`); }
  }
  await browser.close();
})().catch((e) => { console.error('PW FAIL', e); process.exit(1); });
