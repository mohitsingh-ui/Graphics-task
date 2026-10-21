/**
 * Acceptance scenarios from the brief (section 17), run against the real
 * server code with in-memory Google service doubles.  Run: node test/scenarios.test.js
 */
const assert = require('assert');
const crypto = require('crypto');
const { createEnv } = require('./gas-mock');

const OWNER = 'owner@rosierfoods.com';
const LEADER = 'owner@rosierfoods.com';
const A = 'asha@rosierfoods.com';
const B = 'bilal@rosierfoods.com';
const REQUESTER = 'meera@rosierfoods.com';

let passed = 0;
const results = [];
function scenario(name, fn) {
  try { fn(); passed++; results.push('  ✓ ' + name); }
  catch (e) { results.push('  ✗ ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; }
}

const env = createEnv();
const { call, state } = env;

function ok(r) { if (!r || !r.ok) throw new Error('API error: ' + JSON.stringify(r && r.error)); return r.data; }
function err(r, code) { assert.strictEqual(r.ok, false, 'expected an error, got ' + JSON.stringify(r).slice(0, 200)); if (code) assert.strictEqual(r.error.code, code, JSON.stringify(r.error)); return r.error; }

/** Upload bytes the way the browser does: start + 4 MB base64 chunks. */
function upload(user, ctx, name, bytes) {
  const start = ok(call(user, 'api_startUpload', Object.assign({}, ctx, { fileName: name, size: bytes.length })));
  let off = 0, res;
  while (off < bytes.length) {
    const piece = bytes.subarray(off, Math.min(off + start.chunkBytes, bytes.length));
    res = ok(call(user, 'api_uploadChunk', start.uploadId, off, piece.toString('base64')));
    off += piece.length;
  }
  return res;
}
function png(size) { const b = crypto.randomBytes(size); b[0] = 0x89; b[1] = 0x50; b[2] = 0x4E; b[3] = 0x47; return b; }
function tokenFrom(url) { return /t=([A-Za-z0-9_-]+)/.exec(url)[1]; }
function reviewTokensFromMail(subjectPart) {
  const m = state.mail.filter(x => x.subject.includes(subjectPart)).pop();
  return (m.body.match(/t=([A-Za-z0-9_-]{40,60})/g) || []).map(x => x.slice(2));
}
const future = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

/* ---------- setup ---------- */
state.currentUser = OWNER;
env.ctx.setup();
ok(call(LEADER, 'api_saveUser', { email: A, name: 'Asha Designer', role: 'designer' }));
ok(call(LEADER, 'api_saveUser', { email: B, name: 'Bilal Designer', role: 'designer' }));
ok(call(LEADER, 'api_saveSettings', { publicUrl: 'https://script.google.com/macros/s/PUB/exec', internalUrl: 'https://script.google.com/macros/s/INT/exec' }));

let req1, task1;
let _tb2;
function taskB2() {
  if (_tb2) return _tb2;
  const sub = ok(call('', 'api_submitRequirement', { requesterName: 'Z', department: 'Sales', email: 'z@example.org', title: 'Time test',
    creativeType: 'other', purpose: 'p', brief: 'b', preferredDate: future(4), priorityRequested: 'Low' }));
  _tb2 = ok(call(LEADER, 'api_listTasks', {})).find(t => t.requirementId === sub.requirementId).taskId;
  return _tb2;
}

scenario('0. Setup created sheets, folders, leader, trigger; setup cannot be called by others', () => {
  const ss = Object.values(state.spreadsheets)[0];
  ['Users', 'Departments', 'Requirements', 'Tasks', 'TaskAssignments', 'TaskActivity', 'CreativeSubmissions', 'CreativeVersions',
    'ApprovalRequests', 'ApprovalDecisions', 'Notifications', 'Settings', 'ReviewTokens', 'ReferenceFiles'].forEach(n => assert.ok(ss.sheets[n], 'sheet ' + n));
  assert.ok(JSON.parse(state.props.FOLDER_IDS).submissions);
  assert.deepStrictEqual(state.triggers.map(t => t.fn).sort(), ['dailyBackup', 'hourlyMaintenance']);
  state.currentUser = A;
  assert.throws(() => env.ctx.setup(), /owner/);
  state.currentUser = '';
  assert.throws(() => env.ctx.setup(), /owner/);
  assert.throws(() => env.ctx.hourlyMaintenance({ triggerUid: 'fake' }), /owner/);
});

scenario('1. New requirement without login → saved, ID created, in leader queue', () => {
  const cfg = ok(call('', 'api_getFormConfig'));
  assert.ok(cfg.creativeTypes.find(t => t.id === 'website_banner'));
  const sub = ok(call('', 'api_submitRequirement', {
    requesterName: 'Meera', department: 'Marketing', email: REQUESTER, title: 'Diwali homepage banner',
    creativeType: 'website_banner', typeFields: { width: 1600, height: 1200, variants: 'Desktop + Mobile', cta: 'Shop now', placement: 'Homepage hero' },
    purpose: 'Website homepage sale promotion', brief: 'Warm festive banner with ghee jar', campaign: 'Diwali Sale', quantity: 5,
    referenceUrls: 'https://example.com/ref1\nhttps://example.com/ref2', preferredDate: future(10), priorityRequested: 'High',
    copyText: '=HYPERLINK("evil")'   // formula injection attempt must be stored as text
  }));
  assert.match(sub.requirementId, /^REQ-\d{4}-0001$/);
  // reference attachment through the public ticket
  const att = upload('', { kind: 'reference', ticket: sub.uploadTicket }, 'moodboard.png', png(5000));
  assert.ok(att.attachmentId);
  ok(call('', 'api_finalizeRequirement', sub.uploadTicket));
  req1 = sub.requirementId;
  const dash = ok(call(LEADER, 'api_leaderDashboard'));
  task1 = dash.incoming.find(t => t.requirementId === req1);
  assert.ok(task1, 'task in incoming queue');
  assert.strictEqual(task1.status, 'New Requirement');
  assert.strictEqual(task1.dimensions, '1600 × 1200 px');
  assert.strictEqual(dash.kpis.newRequirements, 1);
  const detail = ok(call(LEADER, 'api_getTask', task1.taskId));
  assert.strictEqual(detail.task.copyText, '=HYPERLINK("evil")');
  assert.strictEqual(detail.attachments.length, 1);
  assert.ok(state.mail.some(m => m.to === REQUESTER && /got your request/.test(m.subject)), 'requester confirmation');
  const n = ok(call(LEADER, 'api_getNotifications'));
  assert.ok(n.items.some(x => x.type === 'requirement_new'));
});

scenario('1b. Public form validation: domain (when switched on), required fields, honeypot, past dates', () => {
  const base = { requesterName: 'X', department: 'Sales', email: 'x@gmail.com', title: 'T', creativeType: 'other', purpose: 'p', brief: 'b', preferredDate: future(3), priorityRequested: 'Low' };
  ok(call(LEADER, 'api_saveSettings', { requireRequesterDomain: true }));
  assert.match(err(call('', 'api_submitRequirement', base), 'VALIDATION').message, /rosierfoods\.com/);
  ok(call(LEADER, 'api_saveSettings', { requireRequesterDomain: false }));
  err(call('', 'api_submitRequirement', Object.assign({}, base, { email: 'x@rosierfoods.com', brief: '' })), 'VALIDATION');
  err(call('', 'api_submitRequirement', Object.assign({}, base, { email: 'x@rosierfoods.com', gfx_trap_9: 'spam' })), 'VALIDATION');
  err(call('', 'api_submitRequirement', Object.assign({}, base, { email: 'x@rosierfoods.com', preferredDate: '2020-01-01' })), 'VALIDATION');
  err(call('', 'api_submitRequirement', Object.assign({}, base, { email: 'x@rosierfoods.com', creativeType: 'website_banner', typeFields: {} })), 'VALIDATION');
  err(call('', 'api_submitRequirement', Object.assign({}, base, { preferredTime: '25:00' })), 'VALIDATION');
  err(call('', 'api_submitRequirement', Object.assign({}, base, { preferredDate: new Date().toISOString().slice(0, 10), preferredTime: '00:00' })), 'VALIDATION');
});

scenario('Any email can raise a requirement and approve (default)', () => {
  const sub = ok(call('', 'api_submitRequirement', { requesterName: 'Agency', department: 'Other', email: 'designer@agency.example.com', title: 'Outside request',
    creativeType: 'other', purpose: 'p', brief: 'b', preferredDate: future(6), preferredTime: '15:30', priorityRequested: 'Low' }));
  ok(call('', 'api_finalizeRequirement', sub.uploadTicket));
  const t = ok(call(LEADER, 'api_listTasks', {})).find(x => x.requirementId === sub.requirementId);
  assert.strictEqual(t.dueDate, future(6));
  assert.strictEqual(t.dueTime, '15:30');
  ok(call(LEADER, 'api_setTaskStatus', t.taskId, 'Cancelled', { reason: 'test only' }));
});

scenario('Short email-style form: only who, department, requirement, deadline, count, references', () => {
  const sub = ok(call('', 'api_submitRequirement', { requesterName: 'Riya', email: 'riya@outlook.com', department: 'Sales',
    brief: 'Distributor meet standee\nSize 6x3 ft, logo top, QR bottom', preferredDate: future(5), preferredTime: '10:00', quantity: 3,
    referenceUrls: 'https://example.com/ref' }));
  // Browser autofill putting a URL into a field called "website" must not block a real person,
  // and email is optional: the request still gets a working tracking link for this device.
  const noMail = ok(call('', 'api_submitRequirement', { requesterName: 'Walk-in', department: 'Sales', website: 'https://autofill.example',
    brief: 'Shelf talker', preferredDate: future(5), quantity: 1, formOpenedMs: 45000 }));
  const mails = state.mail.length;
  ok(call('', 'api_finalizeRequirement', noMail.uploadTicket));
  assert.ok(state.mail.slice(mails).every(m => m.to && m.to.includes('@')), 'no email sent to an empty address');
  assert.ok(state.mail.slice(mails).some(m => /New requirement/.test(m.subject)), 'leader still alerted');
  const both = ok(call('', 'api_getMyRequests', [noMail.trackToken, sub.trackToken]));
  assert.ok(both.requests.some(r => r.title === 'Shelf talker') && both.requests.some(r => r.title === 'Distributor meet standee'));
  const onlyNoMail = ok(call('', 'api_getMyRequests', noMail.trackToken));
  assert.deepStrictEqual(onlyNoMail.requests.map(r => r.title), ['Shelf talker']);
  assert.strictEqual(onlyNoMail.email, '');
  ok(call(LEADER, 'api_setTaskStatus', ok(call(LEADER, 'api_listTasks', {})).find(x => x.requirementId === noMail.requirementId).taskId, 'Cancelled', { reason: 'test only' }));
  ok(call('', 'api_finalizeRequirement', sub.uploadTicket));
  const t = ok(call(LEADER, 'api_listTasks', {})).find(x => x.requirementId === sub.requirementId);
  assert.strictEqual(t.title, 'Distributor meet standee');
  assert.strictEqual(t.deliverablesRequired, '3');
  assert.strictEqual(t.priority, 'Medium');
  assert.strictEqual(t.dueTime, '10:00');
  err(call('', 'api_submitRequirement', { requesterName: 'R', email: 'r@x.com', department: 'Sales', preferredDate: future(5) }), 'VALIDATION'); // no requirement text
  ok(call(LEADER, 'api_setTaskStatus', t.taskId, 'Cancelled', { reason: 'test only' }));
});

scenario('Leader divides one requirement between designers', () => {
  const sub = ok(call('', 'api_submitRequirement', { requesterName: 'Riya', email: 'riya@outlook.com', department: 'Sales',
    brief: 'Festive social pack', preferredDate: future(5), quantity: 5 }));
  const t = ok(call(LEADER, 'api_listTasks', {})).find(x => x.requirementId === sub.requirementId);
  err(call(A, 'api_divideTask', t.taskId, { parts: [{ assigneeEmail: A, count: 3 }, { assigneeEmail: B, count: 2 }], dueDate: future(4), priority: 'High' }), 'FORBIDDEN');
  err(call(LEADER, 'api_divideTask', t.taskId, { parts: [{ assigneeEmail: A, count: 3 }], dueDate: future(4), priority: 'High' }), 'VALIDATION');
  const r = ok(call(LEADER, 'api_divideTask', t.taskId, { parts: [{ assigneeEmail: A, count: 3 }, { assigneeEmail: B, count: 2 }], dueDate: future(4), dueTime: '16:00', priority: 'High' }));
  assert.strictEqual(r.taskIds.length, 2);
  const a = ok(call(A, 'api_getTask', r.taskIds[0])).task, b = ok(call(B, 'api_getTask', r.taskIds[1])).task;
  assert.strictEqual(a.title, 'Festive social pack (1/2)'); assert.strictEqual(a.deliverablesRequired, '3'); assert.strictEqual(a.status, 'Assigned');
  assert.strictEqual(b.title, 'Festive social pack (2/2)'); assert.strictEqual(b.deliverablesRequired, '2'); assert.strictEqual(b.dueTime, '16:00');
  assert.strictEqual(b.requirementId, sub.requirementId);
  err(call(A, 'api_getTask', r.taskIds[1]), 'NOT_FOUND');   // each designer sees only their part
  assert.ok(ok(call(B, 'api_getNotifications')).items.some(n => n.type === 'task_assigned' && n.title.includes('(2/2)')));
  r.taskIds.forEach(id => ok(call(LEADER, 'api_setTaskStatus', id, 'Cancelled', { reason: 'test only' })));
});

scenario('Team leader raises a requirement while signed in', () => {
  const sub = ok(call(LEADER, 'api_submitRequirement', { requesterName: 'Owner', department: 'Marketing', email: LEADER, title: 'Leader brief',
    creativeType: 'other', purpose: 'p', brief: 'b', preferredDate: future(2), preferredTime: '11:00', priorityRequested: 'High' }));
  ok(call(LEADER, 'api_finalizeRequirement', sub.uploadTicket));
  const t = ok(call(LEADER, 'api_listTasks', {})).find(x => x.requirementId === sub.requirementId);
  const d = ok(call(LEADER, 'api_getTask', t.taskId));
  assert.ok(d.activity.some(a => a.action === 'created' && /portal/.test(a.note)), 'recorded as raised from the portal');
  assert.ok(!ok(call(LEADER, 'api_getNotifications')).items.some(n => n.type === 'requirement_new' && n.title.includes('Leader brief')), 'leader not notified about own request');
  // Form page is prefilled for signed-in team members
  state.currentUser = LEADER; env.ctx.DB_CACHE_ = {}; env.ctx.SETTINGS_MEMO_ = null;
  assert.ok(env.ctx.doGet({ parameter: { p: 'form' } }).html.includes('"email":"' + LEADER + '"'));
  state.currentUser = ''; env.ctx.DB_CACHE_ = {};
  assert.ok(env.ctx.doGet({ parameter: { p: 'form' } }).html.includes('var BOOT = {}'));
  ok(call(LEADER, 'api_setTaskStatus', t.taskId, 'Cancelled', { reason: 'test only' }));
});

scenario('2. Leader assigns to Designer A → appears on A’s dashboard', () => {
  err(call(A, 'api_assignTask', task1.taskId, { assigneeEmail: A, dueDate: future(5), priority: 'High' }), 'FORBIDDEN');
  ok(call(LEADER, 'api_assignTask', task1.taskId, { assigneeEmail: A, dueDate: future(5), priority: 'High', instructions: 'Use the gold palette' }));
  const d = ok(call(A, 'api_designerDashboard'));
  const t = d.tasks.find(x => x.taskId === task1.taskId);
  assert.ok(t);
  assert.strictEqual(t.status, 'Assigned');
  assert.strictEqual(t.instructions, 'Use the gold palette');
  assert.strictEqual(t.internalNotes, undefined, 'designer must not get internal notes');
  assert.ok(ok(call(A, 'api_getNotifications')).items.some(x => x.type === 'task_assigned'));
});

let taskB;
scenario('3. Privacy: Designer A cannot reach Designer B’s task by id; non-members are refused', () => {
  const sub = ok(call('', 'api_submitRequirement', { requesterName: 'R', department: 'Sales', email: 'r@rosierfoods.com', title: 'Sales deck cover',
    creativeType: 'presentation', purpose: 'Pitch', brief: 'Cover slide', preferredDate: future(4), priorityRequested: 'Medium' }));
  ok(call('', 'api_finalizeRequirement', sub.uploadTicket));
  taskB = ok(call(LEADER, 'api_listTasks', {})).find(t => t.requirementId === sub.requirementId).taskId;
  ok(call(LEADER, 'api_updateTask', taskB, { internalNotes: 'Bilal is slow on decks' }));
  ok(call(LEADER, 'api_assignTask', taskB, { assigneeEmail: B, dueDate: future(4), priority: 'Medium' }));
  err(call(A, 'api_getTask', taskB), 'NOT_FOUND');
  err(call(A, 'api_updateProgress', taskB, 50, ''), 'NOT_FOUND');
  err(call(A, 'api_startUpload', { kind: 'version', taskId: taskB, title: 'x', purpose: 'y', fileName: 'a.png', size: 10 }), 'NOT_FOUND');
  assert.ok(!ok(call(A, 'api_listTasks', {})).some(t => t.taskId === taskB));
  assert.ok(!ok(call(A, 'api_designerDashboard')).tasks.some(t => t.taskId === taskB));
  err(call(A, 'api_leaderDashboard'), 'FORBIDDEN');
  err(call(A, 'api_getReports', {}), 'FORBIDDEN');
  err(call(A, 'api_getSettings'), 'FORBIDDEN');
  err(call(A, 'api_listTeam'), 'FORBIDDEN');
  err(call(A, 'api_listApprovals', 'open'), 'FORBIDDEN');
  err(call('', 'api_getTask', task1.taskId), 'NOT_SIGNED_IN');
  err(call('stranger@rosierfoods.com', 'api_bootstrap'), 'NO_ACCESS');
  // A designer’s activity view must not reveal internal notes or other emails
  const act = ok(call(B, 'api_getTask', taskB)).activity;
  assert.ok(!JSON.stringify(act).includes('slow on decks'));
});

let ver1, deliv1;
scenario('4. Designer A uploads V1 → stored in Drive, linked to task, review request created', () => {
  ok(call(A, 'api_updateProgress', task1.taskId, 50, 'First draft'));
  assert.strictEqual(ok(call(A, 'api_getTask', task1.taskId)).task.status, 'In Progress');
  const bytes = png(9 * 1024 * 1024 + 123); // 3 chunks
  const r = upload(A, { kind: 'version', taskId: task1.taskId, title: 'Homepage banner — desktop', purpose: 'Website homepage sale promotion', deliverableType: 'Website banner', note: 'v1' }, 'banner.png', bytes);
  ver1 = r.versionId; deliv1 = r.deliverableId;
  assert.strictEqual(r.versionNo, 1);
  const v = env.state.files[Object.keys(env.state.files).find(id => env.state.files[id].name.includes('_V1_banner.png'))];
  assert.ok(v, 'file in Drive');
  assert.ok(Buffer.compare(v.bytes, bytes) === 0, 'bytes intact');
  const folders = JSON.parse(state.props.FOLDER_IDS);
  const yearFolder = Object.values(state.folders).find(f => f.parent === folders.submissions);
  assert.strictEqual(state.folders[v.parent].name, task1.taskId);
  assert.strictEqual(state.folders[v.parent].parent, yearFolder.id);
  const sub = ok(call(A, 'api_submitForApproval', task1.taskId, [ver1]));
  assert.strictEqual(sub.submitted, 1);
  assert.deepStrictEqual(sub.links, [], 'designers do not receive review links');
  const t = ok(call(LEADER, 'api_getTask', task1.taskId));
  assert.strictEqual(t.task.status, 'Submitted for Approval');
  assert.strictEqual(t.deliverables[0].versions[0].request.status, 'Open');
  assert.strictEqual(t.deliverables[0].versions[0].uploadedBy, A, 'leader sees uploader');
  assert.ok(reviewTokensFromMail('Ready for approval').length === 1, 'leader emailed review link');
  assert.ok(reviewTokensFromMail('Please review').length === 1, 'requester emailed review link');
  // wrong magic bytes are rejected
  err(call(A, 'api_uploadChunk', ok(call(A, 'api_startUpload', { kind: 'version', taskId: task1.taskId, title: 'fake', purpose: 'p', fileName: 'fake.png', size: 4 })).uploadId, 0, Buffer.from('abcd').toString('base64')), 'VALIDATION');
  err(call(A, 'api_startUpload', { kind: 'version', taskId: task1.taskId, title: 'x', purpose: 'p', fileName: 'run.exe', size: 4 }), 'VALIDATION');
});

let token1;
scenario('5. Anonymous review: valid link works without login and leaks nothing internal', () => {
  token1 = reviewTokensFromMail('Please review')[0];
  const r = ok(call('', 'api_getReview', token1));
  assert.strictEqual(r.state, 'open');
  assert.strictEqual(r.creative.title, 'Homepage banner — desktop');
  assert.strictEqual(r.creative.purpose, 'Website homepage sale promotion');
  assert.strictEqual(r.creative.dimensions, '1600 × 1200 px');
  assert.strictEqual(r.creative.campaign, 'Diwali Sale');
  assert.strictEqual(r.creative.version, 'V1');
  assert.strictEqual(r.creative.status, 'Awaiting Approval');
  assert.strictEqual(r.preview.kind, 'thumbnail', 'large image falls back to Drive thumbnail');
  const blob = JSON.stringify(Object.assign({}, r, { preview: null }));
  [A, 'Asha', 'asha', 'internal', 'gold palette', task1.taskId, 'drive.google.com', 'USR-', 'VER-', 'fileId', 'v1"'].forEach(s =>
    assert.ok(!blob.includes(s), 'review payload leaked: ' + s));
  const orig = call('', 'api_getReviewOriginal', token1, 'download');
  assert.strictEqual(orig.ok, true);
  assert.match(orig.data.fileName, /^Homepage_banner__desktop_V1\.png$|^Homepage_banner_desktop_V1\.png$/);
  assert.ok(!orig.data.fileName.includes(task1.taskId));
  assert.strictEqual(ok(call('', 'api_getReview', 'x'.repeat(43))).state, 'invalid');
  assert.strictEqual(ok(call('', 'api_getReview', '../../etc')).state, 'invalid');
});

scenario('5b. Designer cannot approve own work through the public link', () => {
  const e = err(call('', 'api_submitReview', token1, { decision: 'approved', reviewerName: 'Asha', reviewerEmail: A }), 'FORBIDDEN');
  assert.match(e.message, /own work/);
  err(call('', 'api_submitReview', token1, { decision: 'approved' }), 'VALIDATION'); // identity required by default
});

scenario('7. Revision: reviewer requests changes → designer sees feedback, uploads V2, resubmits', () => {
  err(call('', 'api_submitReview', token1, { decision: 'changes', comment: '', reviewerName: 'Meera', reviewerEmail: REQUESTER }), 'VALIDATION');
  ok(call('', 'api_submitReview', token1, { decision: 'changes', comment: 'Make the jar bigger and add the offer price', reviewerName: 'Meera', reviewerEmail: REQUESTER }));
  // duplicate decision is refused
  err(call('', 'api_submitReview', token1, { decision: 'approved', reviewerName: 'Meera', reviewerEmail: REQUESTER }), 'ALREADY_DECIDED');
  assert.strictEqual(ok(call('', 'api_getReview', token1)).state, 'decided');
  const t = ok(call(A, 'api_getTask', task1.taskId));
  assert.strictEqual(t.task.status, 'Changes Requested');
  const dec = t.deliverables[0].versions[0].decisions[0];
  assert.strictEqual(dec.comment, 'Make the jar bigger and add the offer price');
  assert.strictEqual(dec.reviewerEmail, undefined, 'designer does not see reviewer identity');
  assert.ok(ok(call(A, 'api_getNotifications')).items.some(x => x.type === 'changes_requested'));
  assert.ok(ok(call(LEADER, 'api_getNotifications')).items.some(x => x.type === 'changes_requested'));
  const dd = ok(call(A, 'api_designerDashboard'));
  assert.strictEqual(dd.kpis.changesRequested, 1);
  const r2 = upload(A, { kind: 'version', taskId: task1.taskId, deliverableId: deliv1, note: 'Bigger jar, price added' }, 'banner-v2.png', png(20000));
  assert.strictEqual(r2.versionNo, 2);
  ok(call(A, 'api_submitForApproval', task1.taskId, [r2.versionId]));
  assert.strictEqual(ok(call(A, 'api_getTask', task1.taskId)).task.status, 'Resubmitted for Approval');
});

scenario('8. Version history: V1 kept after V2; leader sees both with uploader', () => {
  const t = ok(call(LEADER, 'api_getTask', task1.taskId));
  const vs = t.deliverables[0].versions;
  assert.deepStrictEqual(vs.map(v => v.versionNo), ['2', '1']);
  assert.strictEqual(vs[1].status, 'Changes Requested');
  assert.ok(vs.every(v => v.uploadedBy === A));
  const p1 = ok(call(LEADER, 'api_getAsset', 'version', vs[1].versionId, 'preview'));
  const p2 = ok(call(LEADER, 'api_getAsset', 'version', vs[0].versionId, 'preview'));
  assert.ok(p1.dataUrl && p2.dataUrl);
  err(call(B, 'api_getAsset', 'version', vs[0].versionId, 'preview'), 'NOT_FOUND');
});

scenario('6 + 9. Approval recorded & notified; 1 of 5 approved does not complete the task', () => {
  const tok = reviewTokensFromMail('Please review')[0];
  const before = ok(call('', 'api_getReview', tok));
  assert.strictEqual(before.creative.version, 'V2');
  assert.strictEqual(before.history.length, 1, 'shows earlier feedback');
  ok(call('', 'api_submitReview', tok, { decision: 'approved', reviewerName: 'Meera', reviewerEmail: REQUESTER }));
  const t = ok(call(LEADER, 'api_getTask', task1.taskId));
  assert.strictEqual(t.deliverables[0].status, 'Approved');
  assert.strictEqual(t.deliverables[0].approvedVersionId, t.deliverables[0].versions[0].versionId);
  assert.notStrictEqual(t.task.status, 'Completed', 'needs 5 approved');
  assert.strictEqual(t.task.status, 'In Progress');
  const dec = t.deliverables[0].versions[0].decisions[0];
  assert.strictEqual(dec.reviewerEmail, REQUESTER);
  assert.ok(ok(call(LEADER, 'api_getNotifications')).items.some(x => x.type === 'creative_approved'));
  const folders = JSON.parse(state.props.FOLDER_IDS);
  assert.ok(Object.values(state.files).some(f => f.name.startsWith('APPROVED_') && state.folders[state.folders[f.parent].parent].parent === folders.approved), 'approved copy saved');
  // 100% progress must not complete
  ok(call(A, 'api_updateProgress', task1.taskId, 100, 'All done from my side'));
  assert.notStrictEqual(ok(call(A, 'api_getTask', task1.taskId)).task.status, 'Completed');
  err(call(A, 'api_setTaskStatus', task1.taskId, 'Completed', {}), 'FORBIDDEN');
  err(call(LEADER, 'api_setTaskStatus', task1.taskId, 'Completed', {}), 'VALIDATION');
  // remaining four creatives
  const ids = [];
  for (let i = 2; i <= 5; i++) ids.push(upload(A, { kind: 'version', taskId: task1.taskId, title: 'Banner ' + i, purpose: 'Homepage', note: '' }, 'b' + i + '.jpg', Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), crypto.randomBytes(2000)])).versionId);
  ok(call(A, 'api_submitForApproval', task1.taskId, []));
  const toks = reviewTokensFromMail('Please review');
  assert.strictEqual(toks.length, 4);
  toks.slice(0, 3).forEach(k => ok(call('', 'api_submitReview', k, { decision: 'approved', reviewerName: 'Meera', reviewerEmail: REQUESTER })));
  assert.strictEqual(ok(call(LEADER, 'api_getTask', task1.taskId)).task.status, 'Submitted for Approval');
  ok(call(LEADER, 'api_leaderDecision', ids[3], 'approved', 'Looks good'));
  const done = ok(call(LEADER, 'api_getTask', task1.taskId));
  assert.strictEqual(done.task.status, 'Completed');
  assert.ok(done.task.completedAt);
  assert.ok(state.mail.some(m => m.to === REQUESTER && /ready/.test(m.subject)));
});

scenario('Approval after change: a new version of an approved creative needs fresh approval', () => {
  ok(call(LEADER, 'api_setTaskStatus', task1.taskId, 'In Progress', { reason: 'Client wants one tweak' }));
  const r = upload(A, { kind: 'version', taskId: task1.taskId, deliverableId: deliv1, note: 'tweak' }, 'banner-v3.png', png(3000));
  assert.strictEqual(r.versionNo, 3);
  ok(call(A, 'api_submitForApproval', task1.taskId, [r.versionId]));
  const t = ok(call(LEADER, 'api_getTask', task1.taskId));
  const d = t.deliverables.find(x => x.deliverableId === deliv1);
  assert.strictEqual(d.status, 'Awaiting Approval');
  assert.strictEqual(d.versions.find(v => v.versionNo === '2').status, 'Approved', 'old approval stays on record');
  assert.notStrictEqual(t.task.status, 'Completed');
});

scenario('10. Expired, revoked and superseded links cannot approve', () => {
  const t = ok(call(LEADER, 'api_getTask', task1.taskId));
  const v3 = t.deliverables.find(x => x.deliverableId === deliv1).versions[0];
  const extra = tokenFrom(ok(call(LEADER, 'api_createReviewLink', v3.versionId)).url);
  ok(call(LEADER, 'api_revokeReviewLinks', v3.versionId));
  assert.strictEqual(ok(call('', 'api_getReview', extra)).state, 'revoked');
  err(call('', 'api_submitReview', extra, { decision: 'approved', reviewerName: 'M', reviewerEmail: REQUESTER }), 'LINK_CLOSED');
  // expiry
  const fresh = tokenFrom(ok(call(LEADER, 'api_createReviewLink', v3.versionId)).url);
  const ss = Object.values(state.spreadsheets)[0].sheets.ReviewTokens;
  const header = ss.data[0];
  const row = ss.data[ss.data.length - 1];
  row[header.indexOf('expiresAt')] = new Date(Date.now() - 1000).toISOString();
  assert.strictEqual(ok(call('', 'api_getReview', fresh)).state, 'expired');
  err(call('', 'api_submitReview', fresh, { decision: 'approved', reviewerName: 'M', reviewerEmail: REQUESTER }), 'LINK_CLOSED');
  err(call('', 'api_getReviewOriginal', fresh, 'view'), 'LINK_CLOSED');
  // superseded: submitting V4 kills V3 links
  const live = tokenFrom(ok(call(LEADER, 'api_createReviewLink', v3.versionId)).url);
  const r4 = upload(A, { kind: 'version', taskId: task1.taskId, deliverableId: deliv1 }, 'banner-v4.png', png(3000));
  ok(call(A, 'api_submitForApproval', task1.taskId, [r4.versionId]));
  assert.strictEqual(ok(call('', 'api_getReview', live)).state, 'superseded');
  err(call('', 'api_submitReview', live, { decision: 'approved', reviewerName: 'M', reviewerEmail: REQUESTER }), 'LINK_CLOSED');
  // tokens are stored hashed only
  assert.ok(!JSON.stringify(ss.data).includes(live));
});

scenario('11. Persistence: a fresh execution reads everything back from the sheet', () => {
  const t = ok(call(LEADER, 'api_getTask', task1.taskId));
  assert.ok(t.activity.length > 10);
  assert.ok(t.activity.some(a => a.action === 'comment') === false);
  ok(call(A, 'api_addComment', task1.taskId, 'Working on V4 now'));
  const again = ok(call(LEADER, 'api_getTask', task1.taskId));
  assert.ok(again.activity.some(a => a.action === 'comment' && a.note === 'Working on V4 now'));
  assert.ok(again.deliverables.length === 5);
  // Audit trail integrity: status rows record a real change, edits record which fields changed
  assert.ok(again.activity.filter(a => a.action === 'status').every(a => a.fromValue !== a.toValue), 'status log from/to must differ');
  ok(call(LEADER, 'api_updateTask', task1.taskId, { formats: 'PNG + JPG' }));
  const third = ok(call(LEADER, 'api_getTask', task1.taskId));
  assert.ok(third.activity.some(a => a.action === 'updated' && a.toValue === 'formats'), 'edit is logged');
});

scenario('Status rules: illegal manual transitions refused; hold/resume; cancel closes links', () => {
  err(call(B, 'api_setTaskStatus', taskB, 'Approved', {}), 'INVALID_TRANSITION');
  err(call(LEADER, 'api_setTaskStatus', taskB, 'Approved', {}), 'INVALID_TRANSITION');
  ok(call(B, 'api_setTaskStatus', taskB, 'In Progress', {}));
  ok(call(LEADER, 'api_setTaskStatus', taskB, 'On Hold', { reason: 'Waiting for photos' }));
  err(call(B, 'api_updateProgress', taskB, 25, ''), 'INVALID_STATE');
  ok(call(LEADER, 'api_resumeTask', taskB));
  assert.strictEqual(ok(call(B, 'api_getTask', taskB)).task.status, 'In Progress');
  const r = upload(B, { kind: 'version', taskId: taskB, title: 'Cover', purpose: 'Pitch' }, 'cover.pdf', Buffer.concat([Buffer.from('%PDF-1.7\n'), crypto.randomBytes(500)]));
  ok(call(B, 'api_submitForApproval', taskB, [r.versionId]));
  const tok = reviewTokensFromMail('Please review')[0];
  ok(call(LEADER, 'api_setTaskStatus', taskB, 'Cancelled', { reason: 'No longer needed' }));
  assert.strictEqual(ok(call('', 'api_getReview', tok)).state, 'revoked');
});

scenario('Reassignment: old designer loses access, new designer gains it, both notified', () => {
  ok(call(LEADER, 'api_assignTask', task1.taskId, { assigneeEmail: B, dueDate: future(2), priority: 'Urgent', note: 'Asha on leave' }));
  err(call(A, 'api_getTask', task1.taskId), 'NOT_FOUND');
  const t = ok(call(B, 'api_getTask', task1.taskId));
  assert.ok(t.deliverables[0].versions.every(v => v.uploadedBy === 'Previous designer'), 'B does not see A’s identity');
  assert.ok(ok(call(A, 'api_getNotifications')).items.some(x => x.type === 'task_reassigned'));
});

scenario('Reports & CSV are computed from records and leader-only', () => {
  const r = ok(call(LEADER, 'api_getReports', { from: future(-30), to: future(1) }));
  assert.strictEqual(r.summary.requirements, 7); // banner, deck, outside email, short form, divide test, leader brief
  assert.strictEqual(r.summary.decisions, 6); // 1 changes + 5 approvals
  const asha = r.designers.find(d => d.email === A);
  assert.strictEqual(asha.revisionCycles, 1);
  assert.ok(r.byDepartment.find(x => x.label === 'Marketing'));
  const csv = ok(call(LEADER, 'api_exportCsv', 'tasks', { from: future(-30), to: future(1) }));
  assert.ok(csv.csv.includes(task1.taskId));
  assert.ok(!/\n=|,=/.test(csv.csv), 'no raw formulas in CSV');
  err(call(B, 'api_exportCsv', 'tasks', {}), 'FORBIDDEN');
});

scenario('Team: deactivated user loses access immediately; last leader protected', () => {
  ok(call(LEADER, 'api_setUserActive', A, false));
  err(call(A, 'api_bootstrap'), 'NO_ACCESS');
  err(call(LEADER, 'api_setUserActive', LEADER, false), 'VALIDATION');
  err(call(LEADER, 'api_saveUser', { email: 'x@gmail.com', name: 'X', role: 'designer' }), 'VALIDATION');
  ok(call(LEADER, 'api_setUserActive', A, true));
});

scenario('Deadline time: overdue exactly after the due time, shown in notifications', () => {
  const today = env.ctx.isoDateOnly_();
  const nowIst = new Date(Date.now() + 330 * 60000);
  const hhmm = d => d.toISOString().slice(11, 16);
  const past = hhmm(new Date(nowIst.getTime() - 2 * 3600000)), later = hhmm(new Date(nowIst.getTime() + 2 * 3600000));
  const mk = (time) => ({ dueDate: today, dueTime: time, status: 'In Progress' });
  if (past < hhmm(nowIst)) assert.strictEqual(env.ctx.isOverdue_(mk(past)), true, 'past time today is overdue');
  if (later > hhmm(nowIst)) assert.strictEqual(env.ctx.isOverdue_(mk(later)), false, 'later time today is not overdue');
  assert.strictEqual(env.ctx.isOverdue_(mk('')), false, 'no time = end of day');
  ok(call(LEADER, 'api_assignTask', taskB2(), { assigneeEmail: A, dueDate: future(3), dueTime: '18:45', priority: 'High' }));
  const n = ok(call(A, 'api_getNotifications')).items[0];
  assert.match(n.body, /18:45/);
  err(call(LEADER, 'api_updateTask', taskB2(), { dueTime: '7pm' }), 'VALIDATION');
  ok(call(LEADER, 'api_updateTask', taskB2(), { dueTime: '' }));
  assert.strictEqual(ok(call(A, 'api_getTask', taskB2())).task.dueTime, '');
});

scenario('Live database from the previous version is upgraded in place', () => {
  const ss = Object.values(state.spreadsheets)[0];
  const tasks = ss.sheets.Tasks;
  const hdr = tasks.data[0], idx = hdr.indexOf('dueTime');
  const sample = tasks.data[1].slice(0, idx);
  tasks.data.forEach(row => { row[idx] = ''; });            // old sheet: no dueTime header
  ss.sheets.Requirements.data[0].splice(ss.sheets.Requirements.data[0].indexOf('preferredTime'), 2, '', '');
  state.props.SCHEMA_VERSION = '1';
  ok(call(LEADER, 'api_addComment', taskB2(), 'trigger a write'));
  assert.strictEqual(state.props.SCHEMA_VERSION, String(env.ctx.SCHEMA_VERSION));
  assert.strictEqual(tasks.data[0][idx], 'dueTime');
  assert.ok(ss.sheets.Requirements.data[0].includes('submittedBy'));
  assert.deepStrictEqual(tasks.data[1].slice(0, idx), sample, 'existing data untouched');
});

scenario('Maintenance trigger sends overdue + due-soon alerts once', () => {
  const t = ok(call(LEADER, 'api_listTasks', {})).find(x => x.taskId === task1.taskId);
  ok(call(LEADER, 'api_updateTask', task1.taskId, { dueDate: future(-1) }));
  state.currentUser = OWNER; env.ctx.DB_CACHE_ = {}; env.ctx.SETTINGS_MEMO_ = null;
  const trig = state.triggers[0];
  env.ctx.hourlyMaintenance({ triggerUid: trig.id });
  env.ctx.DB_CACHE_ = {};
  env.ctx.hourlyMaintenance({ triggerUid: trig.id });
  const n = ok(call(B, 'api_getNotifications')).items.filter(x => x.type === 'task_overdue' && x.title.includes(t.title));
  assert.strictEqual(n.length, 1);
});

scenario('Nightly backup copies the database to Drive and keeps the latest 30', () => {
  const trig = state.triggers.find(t => t.fn === 'dailyBackup');
  state.currentUser = A;                       // a designer can't trigger it by faking a trigger id
  assert.throws(() => env.ctx.dailyBackup({ triggerUid: 'fake' }), /owner/);
  state.currentUser = '';
  for (let i = 0; i < 33; i++) { env.ctx.DB_CACHE_ = {}; env.ctx.dailyBackup({ triggerUid: trig.id }); }
  const folderIds = JSON.parse(state.props.FOLDER_IDS);
  const backups = Object.values(state.folders).find(f => f.name === 'Backups' && f.parent === folderIds.system);
  const live = Object.values(state.files).filter(f => f.parent === backups.id && !f.trashed);
  assert.strictEqual(live.length, 30);
  const ss = Object.values(state.spreadsheets)[0];
  assert.ok(live.every(f => f.mime === 'application/vnd.google-apps.spreadsheet'));
  assert.ok(ok(call(LEADER, 'api_getSettings')).lastBackupAt);
});

scenario('Embedding: off by default; when on, form/app embeddable but review page never', () => {
  state.currentUser = '';
  env.ctx.DB_CACHE_ = {}; env.ctx.SETTINGS_MEMO_ = null;
  assert.strictEqual(env.ctx.doGet({ parameter: {} }).xframe, 'DEFAULT');
  ok(call(LEADER, 'api_saveSettings', { allowEmbedding: true }));
  state.currentUser = ''; env.ctx.DB_CACHE_ = {}; env.ctx.SETTINGS_MEMO_ = null;
  assert.strictEqual(env.ctx.doGet({ parameter: {} }).xframe, 'ALLOWALL');
  assert.strictEqual(env.ctx.doGet({ parameter: { p: 'review', t: 'x'.repeat(43) } }).xframe, 'DEFAULT');
  ok(call(LEADER, 'api_saveSettings', { allowEmbedding: false }));
});

scenario('Speed: repeat reads come from cache, and writes are seen immediately', () => {
  call(LEADER, 'api_getTask', task1.taskId);                       // warm
  Object.keys(state.stats).forEach(k => state.stats[k] = 0);
  call(LEADER, 'api_getTask', task1.taskId);
  assert.strictEqual(state.stats.opens + state.stats.reads, 0, 'cached read should not touch the Sheet');
  ok(call(LEADER, 'api_addComment', task1.taskId, 'cache check 123'));
  const after = ok(call(LEADER, 'api_getTask', task1.taskId));
  assert.ok(after.activity.some(a => a.note === 'cache check 123'), 'write visible right after');
  const ids = after.deliverables[0].versions.map(v => ({ kind: 'version', id: v.versionId }));
  const thumbs = ok(call(LEADER, 'api_getThumbs', ids));
  assert.strictEqual(Object.keys(thumbs).length, ids.length);
  const denied = ok(call(A, 'api_getThumbs', ids));               // A was reassigned off this task
  assert.ok(Object.values(denied).every(v => v === null), 'no thumbnails for tasks you cannot see');
});

scenario('My requests: private tracking link shows only your own requests and status', () => {
  const mk = (email, text) => {
    const s = ok(call('', 'api_submitRequirement', { requesterName: 'P', email, department: 'Sales', brief: text, preferredDate: future(6), quantity: 2 }));
    ok(call('', 'api_finalizeRequirement', s.uploadTicket));
    return s;
  };
  const s1 = mk('priya@gmail.com', 'Poster one'), s2 = mk('Priya@gmail.com', 'Poster two'), other = mk('someone@else.com', 'Not hers');
  assert.match(s1.trackToken, /^[A-Za-z0-9_-]{40,60}$/);
  const mine = ok(call('', 'api_getMyRequests', s2.trackToken));
  assert.strictEqual(mine.email, 'priya@gmail.com');
  assert.deepStrictEqual(mine.requests.map(r => r.title).sort(), ['Poster one', 'Poster two']);
  assert.ok(mine.requests.every(r => r.status === 'Received'));
  assert.ok(!JSON.stringify(mine).match(/asha|bilal|assignee|internalNotes|GFX-/i), 'no internal details');
  err(call('', 'api_getMyRequests', 'x'.repeat(43)), 'LINK_INVALID');
  // tracking link is in the confirmation email
  assert.ok(state.mail.some(m => m.to === 'priya@gmail.com' && /p=my&t=/.test(m.body)));
  // re-send link: same answer for unknown emails, email only to known
  const before = state.mail.length;
  assert.match(ok(call('', 'api_sendTrackLink', 'nobody@nowhere.com')).message, /If that email/);
  assert.strictEqual(state.mail.length, before);
  ok(call('', 'api_sendTrackLink', 'priya@gmail.com'));
  assert.strictEqual(state.mail.length, before + 1);
  // progress: assign, upload, submit -> "Ready for your review" with a working review button
  const tid = ok(call(LEADER, 'api_listTasks', {})).find(t => t.requirementId === s1.requirementId).taskId;
  ok(call(LEADER, 'api_assignTask', tid, { assigneeEmail: B, dueDate: future(5), priority: 'High' }));
  assert.strictEqual(ok(call('', 'api_getMyRequests', s1.trackToken)).requests.find(r => r.requirementId === s1.requirementId).status, 'In progress');
  const up = upload(B, { kind: 'version', taskId: tid, title: 'Poster A4' }, 'p.png', png(2000));
  ok(call(B, 'api_submitForApproval', tid, [up.versionId]));
  const r1 = ok(call('', 'api_getMyRequests', s1.trackToken)).requests.find(r => r.requirementId === s1.requirementId);
  assert.strictEqual(r1.status, 'Ready for your review');
  assert.strictEqual(r1.awaiting.length, 1);
  err(call('', 'api_trackReview', ok(call('', 'api_getMyRequests', other.trackToken)) && other.trackToken, up.versionId), 'NOT_FOUND'); // not their request
  const rev = ok(call('', 'api_trackReview', s1.trackToken, up.versionId));
  const tok = /t=([A-Za-z0-9_-]+)/.exec(rev.url)[1];
  ok(call('', 'api_submitReview', tok, { decision: 'approved', reviewerName: 'Priya', reviewerEmail: 'priya@gmail.com' }));
  // final files link by the designer -> download button + email
  err(call(A, 'api_setFinalLink', tid, 'https://drive.google.com/x'), 'NOT_FOUND');      // not their task
  err(call(B, 'api_setFinalLink', tid, 'javascript:alert(1)'), 'VALIDATION');
  ok(call(LEADER, 'api_updateTask', tid, { deliverablesRequired: 1 }));               // 1 of 1 approved -> completes
  ok(call(B, 'api_setFinalLink', tid, 'https://drive.google.com/drive/folders/abc'));
  const r2 = ok(call('', 'api_getMyRequests', s1.trackToken)).requests.find(r => r.requirementId === s1.requirementId);
  assert.strictEqual(r2.status, 'Completed');
  assert.deepStrictEqual(r2.finalLinks, ['https://drive.google.com/drive/folders/abc']);
  assert.ok(state.mail.some(m => m.to === 'priya@gmail.com' && m.body.includes('drive.google.com/drive/folders/abc')));
  // page route
  state.currentUser = ''; env.ctx.DB_CACHE_ = {}; env.ctx.SETTINGS_MEMO_ = null;
  assert.ok(env.ctx.doGet({ parameter: { p: 'my', t: s1.trackToken } }).html.includes('"tab":"my"'));
});

scenario('Pages render: public form, review, app shell, no-access', () => {
  const pub = env.ctx.doGet({ parameter: {} });
  state.currentUser = '';
  const form = env.ctx.doGet({ parameter: {} });
  assert.ok(form.html.includes('Request a creative') && form.html.includes('function api('));
  const rv = env.ctx.doGet({ parameter: { p: 'review', t: '<script>' } });
  assert.ok(rv.html.includes('var BOOT = {"token":""}'));
  state.currentUser = A;
  env.ctx.DB_CACHE_ = {};
  const app = env.ctx.doGet({ parameter: { p: 'app', r: 'task/GFX-2026-0001"></script>' } });
  assert.ok(app.html.includes('startApp'));
  assert.ok(!app.html.includes('"></script>"'));
  state.currentUser = 'stranger@rosierfoods.com';
  env.ctx.DB_CACHE_ = {};
  const no = env.ctx.doGet({ parameter: { p: 'app' } });
  assert.ok(no.html.includes('stranger@rosierfoods.com'));
  ['Form', 'Review', 'App', 'NoAccess'].forEach(n => {
    const html = env.ctx.doGet({ parameter: n === 'Review' ? { p: 'review' } : n === 'NoAccess' ? { p: 'app' } : {} }).html;
    const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
    scripts.forEach(s => { new Function(s.replace(/^<script>|<\/script>$/g, '')); }); // syntax check every inline script
  });
});

console.log('\nAcceptance scenarios\n' + results.join('\n') + '\n\n' + passed + '/' + results.length + ' passed');
