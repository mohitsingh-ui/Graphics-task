/**
 * Browser test: drives the real pages end-to-end in headless Chromium and
 * screenshots them at desktop, tablet and mobile widths (scenario 12).
 * Run: node test/ui.test.js [outDir]
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { startHarness } = require('./ui-harness');

const OUT = process.argv[2] || path.join(__dirname, 'screens');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8765, BASE = 'http://localhost:' + PORT;
const LEADER = 'owner@rosierfoods.com', A = 'asha@rosierfoods.com';
let sharp; try { sharp = require('sharp'); } catch (e) { sharp = require('/opt/npm-tools/node_modules/sharp'); }
function bannerPng(label, hue) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hue},70%,22%)"/><stop offset="1" stop-color="hsl(${hue + 20},75%,38%)"/></linearGradient></defs>
    <rect width="1600" height="1200" fill="url(#g)"/><circle cx="1180" cy="620" r="300" fill="#FFF5AD" opacity=".9"/>
    <rect x="1080" y="470" width="200" height="300" rx="30" fill="#A56312"/><text x="120" y="520" font-family="Georgia" font-size="110" fill="#FEFCF6">Diwali Sale</text>
    <text x="120" y="640" font-family="Arial" font-size="56" fill="#FEFCF6">${label}</text><rect x="120" y="740" width="360" height="96" rx="48" fill="#FEFCF6"/>
    <text x="180" y="805" font-family="Arial" font-size="40" fill="#7f4a0b">Shop now</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
const future = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

(async () => {
  const { env, server } = await startHarness(PORT);
  env.state.currentUser = LEADER; env.ctx.setup();
  env.call(LEADER, 'api_saveUser', { email: A, name: 'Asha Verma', role: 'designer' });
  env.call(LEADER, 'api_saveUser', { email: 'bilal@rosierfoods.com', name: 'Bilal Khan', role: 'designer' });
  env.call(LEADER, 'api_saveSettings', { publicUrl: 'https://script.google.com/macros/s/PUB/exec' });

  const browser = await pw.chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const shot = async (name, p = page) => p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
  const steps = [];
  const step = async (name, fn) => { await fn(); steps.push('  ✓ ' + name); };

  try {
    await step('Requester fills and submits the public form (no login)', async () => {
      await page.goto(BASE + '/page');
      await page.waitForSelector('#f');
      await page.fill('#requesterName', 'Meera Sharma');
      await page.fill('#email', 'meera@gmail.com');               // any email is accepted
      await page.selectOption('#department', 'Marketing');
      await page.fill('#preferredDate', future(7));
      await page.fill('#preferredTime', '17:30');
      await page.fill('#quantity', '2');
      await page.fill('#brief', 'Diwali homepage banner\nWarm festive banner, ghee jar hero, diya glow. 1600 x 1200.');
      await page.fill('#referenceUrls', 'https://example.com/moodboard');
      const png = await bannerPng('Moodboard reference', 30);
      await page.setInputFiles('#fileIn', { name: 'moodboard.png', mimeType: 'image/png', buffer: png });
      await shot('01-form-desktop');
      await page.click('#submitBtn');
      await page.waitForSelector('.ref-id', { timeout: 15000 });
      const id = await page.textContent('.ref-id');
      assert.match(id, /^REQ-\d{4}-0001$/);
      await shot('02-form-confirmation');
    });

    await step('Leader sees the requirement, assigns it from the task page', async () => {
      await page.goto(BASE + '/page?as=' + LEADER);
      await page.waitForSelector('.kpis');
      await page.waitForSelector('text=Diwali homepage banner');
      await shot('03-leader-overview');
      await page.click('[data-r="requirements"]');
      await page.waitForSelector('text=Review & assign');
      await shot('04-requirements');
      await page.click('text=Review & assign');
      await page.waitForSelector('#aAssign');
      await page.click('#aAssign');
      await page.selectOption('#asg', A);
      await page.fill('#add', future(5));
      await page.click('.modal-f >> text=Assign task');
      await page.waitForSelector('text=Reassign');
      await shot('05-task-detail-leader');
    });

    let taskUrl;
    await step('Designer sees only their task, uploads V1 and sends for approval', async () => {
      await page.goto(BASE + '/page?as=' + A);
      await page.waitForSelector('.tcard');
      await shot('06-designer-dashboard');
      await page.click('.tcard');
      await page.waitForSelector('#aUpload');
      await page.click('[data-progress="50"]');
      await page.waitForSelector('[data-progress="50"].on');
      await page.click('#aUpload');
      await page.fill('#u_title', 'Homepage banner — desktop');
      const fc = page.waitForEvent('filechooser');
      await page.click('#u_drop');
      const chooser = await fc;
      await chooser.setFiles({ name: 'banner.png', mimeType: 'image/png', buffer: await bannerPng('Pure A2 Desi Ghee · up to 25% off', 18) });
      await page.click('.modal-f >> text=Upload');
      await page.waitForSelector('.ver', { timeout: 20000 });
      await page.waitForSelector('text=Submitted for Approval');
      await shot('07-designer-task-after-upload');
      assert.strictEqual(await page.locator('#notes').count(), 0, 'designer must not see internal notes panel');
      assert.strictEqual(await page.locator('#aAssign').count(), 0, 'designer must not see assign');
    });

    await step('Reviewer opens the link with no login and requests changes', async () => {
      const mail = env.state.mail.filter(m => /Please review/.test(m.subject)).pop();
      const token = /t=([A-Za-z0-9_-]{40,60})/.exec(mail.body)[1];
      await page.goto(BASE + '/page?p=review&t=' + token);
      await page.waitForSelector('#okBtn');
      const text = await page.textContent('body');
      assert.ok(!/Asha|asha@/.test(text), 'designer identity leaked on review page');
      await shot('08-review-desktop');
      const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
      await mob.goto(BASE + '/page?p=review&t=' + token);
      await mob.waitForSelector('#okBtn');
      await shot('09-review-mobile', mob);
      await mob.close();
      await page.fill('#rn', 'Meera Sharma');
      await page.fill('#re', 'meera@rosierfoods.com');
      await page.fill('#cm', 'Make the jar bigger and add ₹ offer price');
      await page.click('#chgBtn');
      await page.click('.modal-f >> text=Send feedback');
      await page.waitForSelector('text=Changes requested');
      await shot('10-review-decided');
    });

    await step('Designer sees feedback; leader sees approvals, reports, team, settings', async () => {
      await page.goto(BASE + '/page?as=' + A);
      await page.waitForSelector('.tcard');
      await page.click('.tcard');
      await page.waitForSelector('.alert.bad');
      assert.ok((await page.textContent('.alert.bad')).includes('Make the jar bigger'));
      await shot('11-designer-feedback');
      await page.goto(BASE + '/page?as=' + LEADER);
      await page.waitForSelector('.kpis');
      for (const [r, name] of [['tasks', '12-task-board'], ['approvals', '13-approvals'], ['reports', '14-reports'], ['team', '15-team'], ['settings', '16-settings']]) {
        await page.click('[data-r="' + r + '"]');
        await page.waitForSelector('.page-h');
        await page.waitForTimeout(150);
        await shot(name);
      }
      await page.click('[data-r="tasks"]');
      await page.waitForSelector('#viewSeg');
      await page.click('[data-v="board"]');
      await page.waitForSelector('.board');
      await shot('17-board-view');
    });

    await step('Requester sees the creative in My requests; leader rewards, then deletes the task', async () => {
      await page.goto(BASE + '/page');
      await page.waitForSelector('#f');
      await page.click('[data-tab="my"]');
      await page.waitForSelector('.cr .ph');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.cr .ph')).backgroundImage.startsWith('url('));
      assert.ok((await page.textContent('.cr')).includes('Being revised'));
      await shot('19-my-requests-creatives');
      await page.click('.cr .ph');
      await page.waitForSelector('.lightbox img');
      await shot('20-my-requests-view');
      await page.click('.lightbox [data-close]');

      await page.goto(BASE + '/page?as=' + LEADER);
      await page.waitForSelector('.kpis');
      await page.click('[data-r="tasks"]');
      await page.waitForSelector('[data-go^="task/"]');
      await page.click('[data-go^="task/"]');
      await page.waitForSelector('#aReward');
      await page.click('#aReward');
      await page.waitForSelector('.badge-pick');
      await page.click('.badge-pick label:nth-child(2)');
      assert.strictEqual(await page.inputValue('#rw_p'), '30');
      await page.fill('#rw_r', 'Quick turnaround on the Diwali banner');
      await shot('21-give-reward');
      await page.click('.modal-f >> text=Give reward');
      await page.waitForSelector('text=gave a reward');
      await page.click('[data-r="rewards"]');
      await page.waitForSelector('.lboard');
      await shot('22-rewards-leader');

      await page.goto(BASE + '/page?as=' + A);
      await page.waitForSelector('.reward-pill');
      assert.ok((await page.textContent('.reward-pill')).includes('30'));
      await page.click('[data-r="rewards"]');
      await page.waitForSelector('.reward-list');
      await shot('23-rewards-designer');

      await page.goto(BASE + '/page?as=' + LEADER);
      await page.waitForSelector('.kpis');
      await page.click('[data-r="tasks"]');
      await page.waitForSelector('[data-go^="task/"]');
      await page.click('[data-go^="task/"]');
      await page.waitForSelector('#aDelete');
      await page.click('#aDelete');
      await page.waitForSelector('text=Delete task');
      await shot('24-delete-confirm');
      await page.click('.modal-f >> text=Delete task');
      await page.waitForSelector('text=Task deleted');
      await page.goto(BASE + '/page');
      await page.waitForSelector('#f');
      await page.click('[data-tab="my"]');
      await page.waitForSelector('text=No requests yet');
    });

    await step('Leader divides 10 creatives 5 + 5 from the Assign window; whole-request card; report counts', async () => {
      const r = env.call('', 'api_submitRequirement', { requesterName: 'Rohit', department: 'Sales', brief: 'Ten Diwali posts for Instagram', preferredDate: future(6), quantity: 10 });
      assert.ok(r.ok);
      await page.goto(BASE + '/page?as=' + LEADER);
      await page.waitForSelector('.kpis');
      await page.click('[data-r="tasks"]');
      await page.waitForSelector('text=Ten Diwali posts for Instagram');
      await page.click('text=Ten Diwali posts for Instagram');
      await page.waitForSelector('#aAssign');
      await page.click('#aAssign');
      await page.waitForSelector('#toDivide');
      await shot('25-assign-offers-divide');
      await page.click('#toDivide');
      await page.waitForSelector('#dvRows select');
      const sels = page.locator('#dvRows select');
      await sels.nth(0).selectOption(A);
      await sels.nth(1).selectOption('bilal@rosierfoods.com');
      await shot('26-divide-5-5');
      await page.click('.modal-f >> text=Divide & assign');
      await page.waitForSelector('text=Whole request');
      assert.ok((await page.textContent('body')).includes('0 of 10'));
      await shot('27-whole-request-card');
      await page.click('[data-r="reports"]');
      await page.waitForSelector('text=Creatives done');
      await shot('28-report-creatives-done');
    });

    await step('Bulk approve: leader selects several on Approvals; requester approves all in My requests', async () => {
      const crypto = require('crypto');
      const mk = (qty, name) => {
        const s = env.call('', 'api_submitRequirement', { requesterName: name, department: 'Sales', brief: name + ' set of ' + qty, preferredDate: future(4), quantity: qty }).data;
        const tid = env.call(LEADER, 'api_listTasks', {}).data.find(x => x.requirementId === s.requirementId).taskId;
        env.call(LEADER, 'api_assignTask', tid, { assigneeEmail: A, dueDate: future(4), priority: 'High' });
        const ids = [];
        for (let i = 0; i < qty; i++) {
          const b = crypto.randomBytes(600); b[0] = 0x89; b[1] = 0x50; b[2] = 0x4E; b[3] = 0x47;
          const st = env.call(A, 'api_startUpload', { kind: 'version', taskId: tid, title: name + ' post ' + (i + 1), fileName: 'p.png', size: b.length }).data;
          ids.push(env.call(A, 'api_uploadChunk', st.uploadId, 0, b.toString('base64')).data.versionId);
        }
        env.call(A, 'api_submitForApproval', tid, ids);
        return s;
      };
      mk(3, 'Leader bulk');
      await page.goto(BASE + '/page?as=' + LEADER);
      await page.waitForSelector('.kpis');
      await page.click('[data-r="approvals"]');
      await page.waitForSelector('#selAll');
      await page.check('#selAll');
      assert.ok((await page.textContent('#bulkOk')).includes('(3)'));
      await shot('29-approvals-select-all');
      await page.click('#bulkOk');
      await page.waitForSelector('text=Approve all 3');
      await page.click('.modal-f >> text=Approve all 3');
      await page.waitForSelector('text=Approved 3 creatives');
      await page.waitForSelector('text=Nothing waiting for a decision.');

      const s = mk(2, 'Requester bulk');
      await page.goto(BASE + '/page?p=my&t=' + s.trackToken);
      await page.waitForSelector('[data-approveall]');
      await shot('30-requester-approve-all');
      await page.click('[data-approveall]');
      await page.click('.modal-f >> text=Approve all 2');
      await page.waitForSelector('text=Approved 2 creatives');
      await page.waitForSelector('.req-card >> text=Completed');
    });

    await step('Responsive: no horizontal overflow at tablet and phone widths', async () => {
      for (const [w, hgt, tag] of [[820, 1180, 'tablet'], [390, 844, 'mobile']]) {
        for (const [as, extra, name] of [[LEADER, '', 'leader'], [A, '', 'designer'], ['', '', 'form']]) {
          const p = await browser.newPage({ viewport: { width: w, height: hgt } });
          p.on('pageerror', e => errors.push(tag + ' pageerror: ' + e.message));
          await p.goto(BASE + '/page' + (as ? '?as=' + as : '') + extra);
          await p.waitForSelector(as ? '.kpis' : '#f');
          await p.waitForTimeout(200);
          const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          assert.ok(overflow <= 1, name + ' @' + w + 'px overflows by ' + overflow + 'px');
          await shot('18-' + name + '-' + tag, p);
          await p.close();
        }
      }
    });

    assert.deepStrictEqual(errors, [], 'browser errors');
    console.log('\nBrowser walkthrough\n' + steps.join('\n') + '\n\nScreenshots: ' + OUT);
  } catch (e) {
    console.log(steps.join('\n'));
    console.error('  ✗ ' + (e.stack || e));
    if (errors.length) console.error('Browser errors:\n' + errors.join('\n'));
    try { await shot('zz-failure'); } catch (x) { /* ignore */ }
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
