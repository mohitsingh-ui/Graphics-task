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

    await step('Gallery: arrows/keys move between creatives; approve & request changes below the image', async () => {
      const s = env.call('', 'api_submitRequirement', { requesterName: 'Gallery', department: 'Marketing', brief: 'Diwali sale set', preferredDate: future(5), quantity: 3 }).data;
      const tid = env.call(LEADER, 'api_listTasks', {}).data.find(x => x.requirementId === s.requirementId).taskId;
      env.call(LEADER, 'api_assignTask', tid, { assigneeEmail: A, dueDate: future(5), priority: 'High' });
      const ids = [];
      for (const [i, txt] of ['Biggest Diwali Sale', 'Up to 30% off', 'Freebies above Rs 2,499'].entries()) {
        const b = await bannerPng(txt, 22);
        const st = env.call(A, 'api_startUpload', { kind: 'version', taskId: tid, title: 'Diwali post ' + (i + 1), fileName: 'post' + i + '.png', size: b.length }).data;
        ids.push(env.call(A, 'api_uploadChunk', st.uploadId, 0, b.toString('base64')).data.versionId);
      }
      env.call(A, 'api_submitForApproval', tid, ids);
      await page.goto(BASE + '/page?as=' + LEADER);
      await page.waitForSelector('.kpis');
      await page.click('[data-r="approvals"]');
      await page.waitForSelector('[data-thumb]');
      await page.locator('[data-thumb]').first().click();
      await page.waitForSelector('.gal .lb-stage img:not(.hidden)');
      assert.strictEqual((await page.textContent('.gal [data-c]')).trim(), '1 / 3');
      // decision bar is below the image, not on top of it
      const imgBox = await page.locator('.gal .lb-stage').boundingBox(), barBox = await page.locator('.gal .lb-actions').boundingBox();
      assert.ok(imgBox.y + imgBox.height <= barBox.y + 1, 'actions do not cover the image');
      await shot('31-gallery-leader');
      await page.keyboard.press('ArrowRight');
      assert.strictEqual((await page.textContent('.gal [data-c]')).trim(), '2 / 3');
      await page.click('.gal [data-prev]');
      assert.strictEqual((await page.textContent('.gal [data-c]')).trim(), '1 / 3');
      await page.click('.gal [data-okk]');
      await page.waitForFunction(() => document.querySelector('.gal [data-c]').textContent.trim() === '2 / 3');
      await page.click('.gal [data-chg]');
      await page.fill('#lbFb', 'Make the 30% badge bigger');
      await shot('32-gallery-request-changes');
      await page.click('.gal [data-send]');
      await page.waitForFunction(() => document.querySelector('.gal [data-c]').textContent.trim() === '3 / 3');
      await page.click('.gal [data-close]');
      await page.waitForSelector('.gal', { state: 'detached' });
      await page.waitForFunction(() => document.querySelectorAll('[data-ok]').length === 1);

      const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
      await mob.goto(BASE + '/page?p=my&t=' + s.trackToken);
      await mob.waitForSelector('.cr .ph');
      await mob.locator('.cr .ph').first().click();
      await mob.waitForSelector('.gal .lb-stage img:not(.hidden)');
      await mob.waitForTimeout(150);
      await mob.screenshot({ path: path.join(OUT, '33-gallery-requester-mobile.png') });
      const ib = await mob.locator('.gal .lb-stage img').boundingBox();
      assert.ok(ib.x >= 0 && ib.x + ib.width <= 391, 'image fits the phone screen');
      const ov = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(ov <= 1, 'gallery overflows on phone by ' + ov);
      await mob.close();
    });

    await step('Share for review: leader makes one link; founder reviews on phone without login', async () => {
      const s = env.call('', 'api_submitRequirement', { requesterName: 'Share', department: 'Marketing', brief: 'Biggest Diwali sale meta creatives', preferredDate: future(5), quantity: 4 }).data;
      const tid = env.call(LEADER, 'api_listTasks', {}).data.find(x => x.requirementId === s.requirementId).taskId;
      env.call(LEADER, 'api_assignTask', tid, { assigneeEmail: A, dueDate: future(5), priority: 'High' });
      const ids = [];
      for (const [i, txt] of ['Biggest Diwali Sale', 'Up to 30% off', 'Freebies above Rs 2,499', 'Gir A2 Bilona Ghee'].entries()) {
        const b = await bannerPng(txt, 18 + i * 6);
        const st = env.call(A, 'api_startUpload', { kind: 'version', taskId: tid, title: 'Biggest Diwali sale meta creatives — ' + (i + 1), fileName: 'meta' + i + '.png', size: b.length }).data;
        ids.push(env.call(A, 'api_uploadChunk', st.uploadId, 0, b.toString('base64')).data.versionId);
      }
      env.call(A, 'api_submitForApproval', tid, ids);
      await page.goto(BASE + '/page?as=' + LEADER);
      await page.waitForSelector('.kpis');
      await page.click('[data-r="approvals"]');
      await page.waitForSelector('#shareSel');
      await page.check('#selAll');
      await page.locator('[data-pick]').last().uncheck();          // an older creative from another task
      assert.ok((await page.textContent('#shareSel')).includes('Share 4'));
      await page.click('#shareSel');
      await page.fill('#shT', 'Biggest Diwali Sale — Meta creatives');
      await page.click('.modal-f >> text=Create link');
      await page.waitForSelector('#shUrl');
      await shot('34-share-link-modal');
      const url = await page.inputValue('#shUrl');
      const tok = /t=([A-Za-z0-9_-]+)/.exec(url)[1];
      await page.click('.modal-f >> text=Close');

      const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
      mob.on('pageerror', e => errors.push('batch pageerror: ' + e.message));
      await mob.goto(BASE + '/page?p=batch&t=' + tok);
      await mob.waitForSelector('.it .ph');
      await mob.waitForFunction(() => [...document.querySelectorAll('.it .ph')].some(b => b.style.backgroundImage));
      await mob.fill('#whoName', 'Gaurav');
      await mob.waitForTimeout(200);
      await mob.screenshot({ path: path.join(OUT, '35-founder-link-mobile.png') });
      const ov = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(ov <= 1, 'founder page overflows on phone by ' + ov);
      await mob.locator('.it .ph').first().click();
      await mob.waitForSelector('.gal .lb-stage img:not(.hidden)');
      await mob.screenshot({ path: path.join(OUT, '36-founder-gallery-mobile.png') });
      await mob.click('.gal [data-okk]');
      await mob.waitForFunction(() => document.querySelector('.gal [data-c]').textContent.trim() === '2 / 4');
      await mob.click('.gal [data-close]');
      await mob.waitForSelector('#allBtn');
      assert.ok((await mob.textContent('#allBtn')).includes('3'));
      await mob.click('#allBtn');
      await mob.click('.modal-f >> text=Approve all 3');
      await mob.waitForSelector('text=All done');
      await mob.screenshot({ path: path.join(OUT, '37-founder-all-done.png') });
      await mob.close();
      const t = env.call(LEADER, 'api_getTask', tid).data;
      assert.strictEqual(t.task.status, 'Completed');
    });

    await step('Packaging: hold waiting on Quality, share link, Quality sends NI table, approve closes, reopen', async () => {
      const s = env.call('', 'api_submitRequirement', { requesterName: 'Rahul', department: 'Quality', email: 'rahul@example.org', brief: 'A2 Ghee 1L packaging — front and back', preferredDate: future(3), quantity: 1 }).data;
      const tid = env.call(LEADER, 'api_listTasks', {}).data.find(x => x.requirementId === s.requirementId).taskId;
      env.call(LEADER, 'api_assignTask', tid, { assigneeEmail: A, dueDate: future(3), priority: 'High' });
      const b = await bannerPng('Gir A2 Bilona Ghee 1L', 30);
      const st = env.call(A, 'api_startUpload', { kind: 'version', taskId: tid, title: 'Ghee 1L pack', fileName: 'pack.png', size: b.length }).data;
      const v1 = env.call(A, 'api_uploadChunk', st.uploadId, 0, b.toString('base64')).data.versionId;
      env.call(A, 'api_submitForApproval', tid, [v1]);

      await page.goto(BASE + '/page?as=' + A + '&r=task/' + tid);
      await page.waitForSelector('#aHold');
      await page.click('#aHold');
      await page.fill('#hdR', 'Design done. Waiting for NI table and barcode.');
      await page.fill('#hdD', 'Quality');
      await shot('38-hold-modal');
      await page.click('.modal-f >> text=Put on hold');
      await page.waitForSelector('.hold-banner');
      assert.ok((await page.textContent('.hold-banner')).includes('waiting on Quality'));
      await shot('39-task-on-hold');
      await page.click('#aShare');
      await page.fill('#shN', 'Quality team');
      await page.click('.modal-f >> text=Create link');
      await page.waitForSelector('#shUrl');
      const url = await page.inputValue('#shUrl');
      const tok = /t=([A-Za-z0-9_-]+)/.exec(url)[1];
      await page.click('.modal-f >> text=Close');

      const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
      mob.on('pageerror', e => errors.push('share pageerror: ' + e.message));
      await mob.goto(BASE + '/page?p=share&t=' + tok);
      await mob.waitForSelector('#sendBtn');
      assert.ok((await mob.textContent('main')).includes('Waiting for NI table and barcode'));
      await mob.fill('#nm', 'Rahul');
      await mob.fill('#dp', 'Quality');
      await mob.fill('#msg', 'NI table attached. Barcode: 8901234567890');
      await mob.setInputFiles('#fin', { name: 'NI-table.png', mimeType: 'image/png', buffer: await bannerPng('NI table', 120) });
      await mob.waitForTimeout(200);
      await mob.screenshot({ path: path.join(OUT, '40-share-page-mobile.png'), fullPage: true });
      const ov = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(ov <= 1, 'share page overflows on phone by ' + ov);
      await mob.click('#sendBtn');
      await mob.waitForSelector('text=Details sent by Rahul (Quality)', { timeout: 20000 });
      await mob.close();

      await page.goto(BASE + '/page?as=' + LEADER + '&r=task/' + tid);
      await page.waitForSelector('.hold-banner');
      assert.ok((await page.textContent('body')).includes('NI-table.png'));
      await page.click('[data-ok]');
      await page.click('.modal-f >> text=Approve');
      await page.waitForSelector('#aReopen');
      await shot('41-completed-after-hold');
      await page.click('#aReopen');
      await page.fill('#roR', 'Change MRP to Rs 899 on the back panel');
      await page.fill('#roD', future(2));
      await page.click('.modal-f >> text=Reopen task');
      await page.waitForSelector('text=Reopened for changes');
      await shot('42-reopened-task');
    });

    await step('Assign a task directly, reject + approve in gallery, Drive folder + zip, designations & leaderboard', async () => {
      env.call(LEADER, 'api_saveUser', { email: A, name: 'Asha Verma', role: 'designer', designation: 'Senior Graphic Designer' });
      await page.goto(BASE + '/page?as=' + LEADER);
      await page.waitForSelector('.kpis');
      await page.click('[data-r="tasks"]');
      await page.waitForSelector('[data-assign-new]');
      await page.click('[data-assign-new]');
      await page.waitForSelector('#dtT');
      await page.fill('#dtT', 'Sale — Meta ads set');
      await page.fill('#dtB', 'Two 1:1 Meta ads for the weekend sale');
      await page.selectOption('#dtA', A);
      await page.fill('#dtC', 'Meta ads');
      await page.fill('#dtD', future(3));
      await page.fill('#dtQ', '1');
      await shot('43-assign-task-modal');
      await page.click('.modal-f >> text=Assign task');
      await page.waitForSelector('#aAssign');
      const tid = (await page.textContent('#crumb')).split(' · ')[0].trim();
      const ids = [];
      for (const [i, txt] of ['Weekend sale A', 'Weekend sale B'].entries()) {
        const b = await bannerPng(txt, 40 + i * 30);
        const st = env.call(A, 'api_startUpload', { kind: 'version', taskId: tid, title: 'Meta ' + (i + 1), fileName: 'meta' + i + '.png', size: b.length }).data;
        ids.push(env.call(A, 'api_uploadChunk', st.uploadId, 0, b.toString('base64')).data.versionId);
      }
      env.call(A, 'api_submitForApproval', tid, ids);
      await page.goto(BASE + '/page?as=' + LEADER + '&r=task/' + tid);
      await page.waitForSelector('[data-rej]');
      await page.locator('[data-thumb]').first().click();
      await page.waitForSelector('.gal .lb-stage img:not(.hidden)');
      await page.click('.gal [data-rej]');
      await page.fill('#lbFb', 'Wrong product shot');
      await shot('44-gallery-reject');
      await page.click('.gal [data-send]');
      await page.waitForFunction(() => document.querySelector('.gal [data-c]').textContent.trim() === '2 / 2');
      await page.click('.gal [data-okk]');
      await page.waitForTimeout(400);
      await page.click('.gal [data-close]');
      await page.waitForSelector('.badge.s-rejected');
      await page.waitForSelector('#driveReq');
      await page.click('#driveReq');
      await page.waitForSelector('#dfShare');
      await page.click('#dfShare');
      await page.waitForSelector('#dfUrl');
      await shot('45-drive-folder-modal');
      await page.click('.modal-f >> text=Close');
      const dl = page.waitForEvent('download');
      await page.click('#zipTask');
      const file = await dl;
      assert.ok(/\.zip$/.test(file.suggestedFilename()));
      await page.click('[data-r="rewards"]');
      await page.waitForSelector('.lboard');
      await shot('46-leaderboard-leader');
      await page.click('[data-r="settings"]');
      await page.waitForSelector('#desigRows [data-dr]');
      await page.locator('text=Points & designations').scrollIntoViewIfNeeded();
      await shot('47-settings-points');
      await page.goto(BASE + '/page?as=' + A);
      await page.waitForSelector('.kpis');
      await page.click('[data-r="rewards"]');
      await page.waitForSelector('.rank-hero');
      assert.ok((await page.textContent('.rank-hero')).includes('Senior Graphic Designer'));
      await shot('48-my-points-designer');
    });

    await step('Completed requirements tab with Drive link; points & rewards report', async () => {
      await page.goto(BASE + '/page?as=' + LEADER);
      await page.waitForSelector('.kpis');
      await page.click('[data-r="requirements"]');
      await page.waitForSelector('text=Completed');
      await page.click('.tabs >> text=Completed');
      await page.waitForSelector('[data-dfolder]');
      await shot('49-completed-requirements');
      await page.fill('#dnQ', 'Meta ads set');
      await page.click('#dnGo');
      await page.waitForFunction(() => document.querySelectorAll('[data-dfolder]').length === 1);
      await page.click('[data-dfolder]');
      await page.waitForSelector('#dfUrl, #dfShare');
      await page.click('.modal-f >> text=Close');
      await page.click('[data-r="reports"]');
      await page.waitForSelector('#pointsReport');
      await page.locator('#pointsReport').scrollIntoViewIfNeeded();
      await page.locator('#pointsReport').screenshot({ path: path.join(OUT, '50-points-rewards-report.png') });
    });

    await step('Campaign: create Diwali Sale, request from Sales + leader tasks, one Drive link; theme; instant revisit', async () => {
      await page.goto(BASE + '/page?as=' + LEADER);
      await page.waitForSelector('.kpis');
      await page.click('[data-r="campaigns"]');
      await page.waitForSelector('#newCamp');
      await page.click('#newCamp');
      await page.fill('#cmN', 'Diwali Sale 2026');
      await page.click('.modal-f >> text=Create');
      await page.waitForSelector('#cpTask');
      const cid = (await page.evaluate(() => APP.route)).split('/')[1];
      // a department raises a request into the campaign from the public form
      const s = env.call('', 'api_submitRequirement', { requesterName: 'ABC', department: 'Sales', brief: 'Diwali Meta ads', preferredDate: future(5), quantity: 1, campaignId: cid }).data;
      const tAbc = env.call(LEADER, 'api_listTasks', {}).data.find(x => x.requirementId === s.requirementId).taskId;
      env.call(LEADER, 'api_assignTask', tAbc, { assigneeEmail: A, dueDate: future(5), priority: 'High' });
      env.call(LEADER, 'api_updateTask', tAbc, { creativeType: 'Meta ads' });
      // leader adds listing images to the campaign from the campaign page
      await page.click('#refreshBtn');
      await page.waitForSelector('#cpTask');
      await page.click('#cpTask');
      await page.waitForSelector('#dtTo');
      assert.ok((await page.inputValue('#dtTo')).startsWith('cmp:'), 'campaign pre-selected');
      await page.fill('#dtT', 'Diwali listing images — ghee');
      await page.selectOption('#dtA', 'bilal@rosierfoods.com');
      await page.fill('#dtC', 'Listing images');
      await page.fill('#dtD', future(4));
      await shot('51-assign-into-campaign');
      await page.click('.modal-f >> text=Assign task');
      await page.waitForSelector('#campSel');
      const tList = (await page.textContent('#crumb')).split(' · ')[0].trim();
      for (const [who, tid, title, hue] of [[A, tAbc, 'Diwali Meta 1', 20], ['bilal@rosierfoods.com', tList, 'Ghee listing', 90]]) {
        const b = await bannerPng(title, hue);
        const st = env.call(who, 'api_startUpload', { kind: 'version', taskId: tid, title, fileName: 'x.png', size: b.length }).data;
        const v = env.call(who, 'api_uploadChunk', st.uploadId, 0, b.toString('base64')).data.versionId;
        env.call(who, 'api_submitForApproval', tid, [v]); env.call(LEADER, 'api_leaderDecision', v, 'approved', '');
      }
      await page.goto(BASE + '/page?as=' + LEADER + '&r=campaigns/' + cid);
      await page.waitForSelector('.cat-chip');
      assert.ok((await page.textContent('main')).includes('Listing images'));
      await shot('52-campaign-page');
      await page.click('#cpDrive');
      await page.waitForSelector('#dfShare');
      await page.click('#dfShare');
      await page.waitForSelector('#dfUrl');
      assert.ok((await page.textContent('.modal')).includes('Campaign: Diwali Sale 2026'));
      await shot('53-campaign-drive-link');
      await page.click('.modal-f >> text=Close');
      // instant revisit: second open of the campaign list is served from memory
      await page.click('[data-r="campaigns"]');
      await page.waitForSelector('.camp-card');
      const t0 = Date.now();
      await page.click('.camp-card');
      await page.waitForSelector('#cpDrive');
      assert.ok(Date.now() - t0 < 1500);
      // theme: pick Ocean, save, reload
      await page.click('[data-r="settings"]');
      await page.waitForSelector('[data-th="ocean"]');
      await page.click('[data-th="ocean"]');
      await page.click('#saveSettings');
      await page.waitForSelector('text=Settings saved');
      await page.goto(BASE + '/page?as=' + LEADER);
      await page.waitForSelector('.kpis');
      const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
      assert.strictEqual(accent, '#1f6fb2');
      await shot('54-theme-ocean');
      env.call(LEADER, 'api_saveSettings', { theme: 'rosier', accentColor: '' });
    });

    await step('Sale picked on the form; leader chooses the folder; both departments see every creative in the campaign', async () => {
      const cid = env.call(LEADER, 'api_listCampaigns').data.find(c => c.name === 'Diwali Sale 2026').campaignId;
      const fresh = await browser.newPage();
      fresh.on('pageerror', e => errors.push('form pageerror: ' + e.message));
      await fresh.goto(BASE + '/page');
      await fresh.waitForSelector('#f');
      await fresh.fill('#requesterName', 'Priya');
      await fresh.fill('#email', 'priya@example.org');
      await fresh.selectOption('#department', 'Marketing');
      await fresh.selectOption('#campaignId', cid);
      await fresh.fill('#preferredDate', future(6));
      await fresh.fill('#quantity', '1');
      await fresh.fill('#brief', '30% off — 1 Meta creative');
      await fresh.screenshot({ path: path.join(OUT, '55-form-sale-dropdown.png') });
      await fresh.click('#submitBtn');
      await fresh.waitForSelector('.ref-id', { timeout: 15000 });
      const reqId = (await fresh.textContent('.ref-id')).trim();
      const tid = env.call(LEADER, 'api_listTasks', {}).data.find(x => x.requirementId === reqId).taskId;
      // leader assigns and picks the folder inside the campaign
      await page.goto(BASE + '/page?as=' + LEADER + '&r=task/' + tid);
      await page.waitForSelector('#aAssign');
      await page.click('#aAssign');
      await page.selectOption('#asg', A);
      await page.fill('#add', future(4));
      await page.fill('#afo', '30% off / Meta ads');
      await shot('56-assign-choose-folder');
      await page.click('.modal-f >> text=Assign task');
      await page.waitForSelector('text=30% off / Meta ads');
      const b = await bannerPng('30% off', 10);
      const st = env.call(A, 'api_startUpload', { kind: 'version', taskId: tid, title: '30% off Meta 1', fileName: 'x.png', size: b.length }).data;
      const v = env.call(A, 'api_uploadChunk', st.uploadId, 0, b.toString('base64')).data.versionId;
      env.call(A, 'api_submitForApproval', tid, [v]); env.call(LEADER, 'api_leaderDecision', v, 'approved', '');
      // the requester sees all creatives in the sale, not just theirs
      await fresh.click('[data-tab="my"]');
      await fresh.waitForSelector('[data-campview]');
      await fresh.click('[data-campview]');
      await fresh.waitForSelector('.modal [data-cv]');
      const n = await fresh.locator('.modal [data-cv]').count();
      assert.ok(n >= 3, 'sees creatives from other requests too, got ' + n);
      assert.ok((await fresh.textContent('.modal')).includes('30% off / Meta ads'));
      await fresh.waitForTimeout(300);
      await fresh.screenshot({ path: path.join(OUT, '57-requester-sees-whole-sale.png') });
      await fresh.close();
    });

    await step('Bonus points: set when assigning, shown to the designer, counted on My Points', async () => {
      await page.goto(BASE + '/page?as=' + LEADER);
      await page.waitForSelector('.kpis');
      await page.click('[data-r="tasks"]');
      await page.waitForSelector('[data-assign-new]');
      await page.click('[data-assign-new]');
      await page.waitForSelector('#dtBp');
      await page.fill('#dtT', 'Brand film storyboard');
      await page.selectOption('#dtA', A);
      await page.fill('#dtD', future(5));
      await page.fill('#dtBp', '50');
      await shot('58-assign-with-bonus');
      await page.click('.modal-f >> text=Assign task');
      await page.waitForSelector('.bonus-badge');
      assert.ok((await page.textContent('.bonus-badge')).includes('+50'));
      await page.goto(BASE + '/page?as=' + A);
      await page.waitForSelector('#dtabs');
      await page.click('#dtabs [data-tab="all"]');
      await page.waitForSelector('.bonus-badge');
      assert.ok((await page.textContent('#view')).includes('+50 bonus pts on completion'));
      await shot('59-designer-sees-bonus');
      await page.click('[data-r="rewards"]');
      await page.waitForSelector('.rank-hero');
      assert.ok((await page.textContent('.rank-hero')).includes('task bonuses'));
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
