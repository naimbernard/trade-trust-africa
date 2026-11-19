const { chromium } = require('playwright');
require('fs').mkdirSync(process.env.SHOTS_DIR || 'e2e-shots', { recursive: true });
const B = process.env.BASE_URL || 'http://localhost:3000';
const PW = 'DemoTrade2026';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function ctxFor(email, viewport) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(`${email}: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`${email} PAGEERROR: ${e.message}`));
    await page.goto(B + '/#/');
    if (email) {
      await page.goto(B + '/#/login');
      await page.fill('input[name=email]', email); await page.fill('input[name=password]', PW);
      await page.click('form[data-form=login] button'); await page.waitForTimeout(600);
    }
    return page;
  }
  const shot = async (p, n) => { await p.waitForTimeout(400); await p.screenshot({ path: require('path').join(process.env.SHOTS_DIR || 'e2e-shots', `${n}.png`), fullPage: true }); };
  const desk = { width: 1366, height: 860 };
  const mob = { width: 390, height: 844 };

  let p = await ctxFor(null, desk); await shot(p, '01-landing');
  await p.goto(B + '/#/market?q=surimi'); await shot(p, '02-market-search');

  const buyer = await ctxFor('buyer@demo.tta', desk); await shot(buyer, '03-buyer-dashboard');
  await buyer.goto(B + '/#/deals'); await buyer.waitForTimeout(400);
  await buyer.click('a.card[href^="#/deal/"]'); await buyer.waitForTimeout(700); await shot(buyer, '04-trade-room-before');
  // respond to pricing
  await buyer.click('button[data-key=pricing]'); await buyer.waitForTimeout(300); await shot(buyer, '05-stage-modal');
  await buyer.click('button[data-action=stage-accept]'); await buyer.waitForTimeout(700);
  // propose payment
  await buyer.click('button[data-key=payment]'); await buyer.waitForTimeout(300);
  await buyer.selectOption('select[name=f_method]', 'lc_sight'); await buyer.fill('textarea[name=f_terms]', 'Irrevocable LC at sight, confirmed by a first class bank');
  await buyer.click('form[data-form=stage] button'); await buyer.waitForTimeout(700); await shot(buyer, '06-trade-room-after');
  const dealUrl = buyer.url();
  for (const tab of ['documents', 'logistics', 'finance', 'activity', 'messages']) { await buyer.goto(dealUrl.split('?')[0] + '?tab=' + tab); await buyer.waitForTimeout(500); }
  await shot(buyer, '07-messages');

  const seller = await ctxFor('seller@demo.tta', mob);
  await seller.goto(dealUrl.split('?')[0]); await seller.waitForTimeout(700); await shot(seller, '08-mobile-trade-room');
  await seller.goto(B + '/#/company?tab=verification'); await seller.waitForTimeout(600); await shot(seller, '09-mobile-verification');
  await seller.goto(B + '/#/market'); await seller.waitForTimeout(500); await shot(seller, '10-mobile-market');

  const admin = await ctxFor('admin@demo.tta', desk); await admin.goto(B + '/#/admin'); await admin.waitForTimeout(700); await shot(admin, '11-admin');
  await admin.goto(B + '/#/admin?tab=audit'); await admin.waitForTimeout(600); await shot(admin, '12-admin-audit');
  const rev = await ctxFor('reviewer@demo.tta', desk); await rev.goto(B + '/#/review'); await rev.waitForTimeout(600); await shot(rev, '13-review');
  const lg = await ctxFor('logistics@demo.tta', mob); await shot(lg, '14-mobile-logistics-dash');
  const fin = await ctxFor('finance@demo.tta', desk); await fin.goto(B + '/#/finance'); await fin.waitForTimeout(500);
  for (const route of ['#/billing', '#/company', '#/company?tab=team', '#/company?tab=documents', '#/listings', '#/listings/new', '#/enquiries']) { await buyer.goto(B + '/' + route); await buyer.waitForTimeout(450); }
  await shot(buyer, '15-enquiries');
  await buyer.goto(B + '/#/billing'); await buyer.waitForTimeout(500); await shot(buyer, '16-billing');
  // registration on mobile
  const reg = await ctxFor(null, mob); await reg.goto(B + '/#/register'); await reg.waitForTimeout(400);
  await reg.fill('input[name=full_name]', 'Esi Test'); await reg.fill('input[name=email]', `esi${Date.now()}@example.com`); await reg.fill('input[name=password]', 'Strongpass123');
  await reg.fill('input[name=org_name]', 'Esi Foods'); await reg.selectOption('select[name=org_type]', 'importer'); await reg.check('input[name=accept_terms]');
  await reg.click('form[data-form=register] button'); await reg.waitForTimeout(900); await shot(reg, '17-mobile-after-register');
  console.log('URL after register', reg.url());
  // overflow check on mobile pages
  for (const [pg, name] of [[seller, 'seller'], [lg, 'logistics'], [reg, 'reg']]) {
    const w = await pg.evaluate(() => document.documentElement.scrollWidth); console.log(name, 'scrollWidth', w);
  }
  console.log('ERRORS', JSON.stringify(errors, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
