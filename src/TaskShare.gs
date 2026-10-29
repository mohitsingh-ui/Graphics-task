/**
 * TaskShare.gs — share one task with another department through a no-login
 * link. They see the brief, the hold reason (e.g. "Waiting for NI table and
 * barcode"), the designs so far (view + download), and can send back details
 * and files, which land on the task for the designer.
 *
 * Security: 256-bit token, only the hash stored; expires; can be withdrawn.
 * Designer names, internal notes and Drive links are never shown.
 */

var SHARE_DAYS = 30;

function shareUrl_(token) {
  var base = settings_().publicUrl;
  if (!base) { try { base = ScriptApp.getService().getUrl(); } catch (e) { base = ''; } }
  return base + '?p=share&t=' + token;
}

/** Creates a share token for a task. Caller holds the lock. */
function issueShare_(taskId, createdBy, note) {
  var token = randomToken_();
  dbInsert_('TaskShares', {
    shareId: 'SHR-' + uuid_(), tokenHash: sha256_(token), taskId: taskId, note: note || '', createdBy: createdBy || '',
    createdAt: nowIso_(), expiresAt: new Date(Date.now() + SHARE_DAYS * 864e5).toISOString(), revokedAt: '', lastOpenedAt: ''
  });
  return token;
}

function api_createTaskShare(taskId, note) {
  return respond_(function () {
    var u = currentUser_();
    note = str_(note, 200, 'Who it’s for', false);
    return withLock_(function () {
      var t = requireTask_(u, taskId);
      if (!taskPermissions_(u, t).canShare) throw AppError_('FORBIDDEN', 'You can’t share this task.');
      var token = issueShare_(t.taskId, u.email, note);
      logActivity_(t.taskId, u, 'shared', '', note || 'link', 'Shared with a link' + (note ? ' — ' + note : ''), 'team');
      return { url: shareUrl_(token), expiresInDays: SHARE_DAYS };
    });
  });
}

function api_listTaskShares(taskId) {
  return respond_(function () {
    var u = currentUser_();
    var t = requireTask_(u, taskId);
    return dbFind_('TaskShares', function (x) { return x.taskId === t.taskId && !x.revokedAt && new Date(x.expiresAt).getTime() > Date.now(); })
      .reverse().map(function (x) { return { shareId: x.shareId, note: x.note, createdAt: x.createdAt, expiresAt: x.expiresAt, lastOpenedAt: x.lastOpenedAt }; });
  });
}

function api_revokeTaskShare(shareId) {
  return respond_(function () {
    var u = currentUser_();
    return withLock_(function () {
      var x = dbGet_('TaskShares', str_(shareId, 60, 'Link', true));
      if (!x) throw AppError_('NOT_FOUND', 'Link not found.');
      requireTask_(u, x.taskId);
      dbUpdate_('TaskShares', x.shareId, { revokedAt: nowIso_() });
      return true;
    });
  });
}

/* ---------- public (no login) ---------- */

function shareFromToken_(token) {
  if (!TOKEN_RE.test(String(token || ''))) throw AppError_('LINK_INVALID', 'This link isn’t valid. Please check you copied the full link.');
  var hash = sha256_(token);
  var x = dbFind_('TaskShares', function (r) { return r.tokenHash === hash; })[0];
  if (!x) throw AppError_('LINK_INVALID', 'This link isn’t valid. Please check you copied the full link.');
  if (x.revokedAt) throw AppError_('LINK_CLOSED', 'This link has been withdrawn. Ask the graphics team for a new one.');
  if (new Date(x.expiresAt).getTime() < Date.now()) throw AppError_('LINK_EXPIRED', 'This link has expired. Ask the graphics team for a new one.');
  var t = dbGet_('Tasks', x.taskId);
  if (!t) throw AppError_('LINK_CLOSED', 'This task is no longer available.');
  return { share: x, task: t };
}

var SHARE_STATE = {};
SHARE_STATE[VSTATUS.DRAFT] = 'Work in progress';
SHARE_STATE[VSTATUS.AWAITING] = 'Waiting for approval';
SHARE_STATE[VSTATUS.CHANGES] = 'Changes requested';
SHARE_STATE[VSTATUS.APPROVED] = 'Approved';
SHARE_STATE[VSTATUS.SUPERSEDED] = 'Older version';

/** Latest version of each creative (+ the approved/final one if different). */
function shareVersions_(t) {
  var out = [];
  taskDeliverables_(t.taskId).forEach(function (d) {
    var vs = dbFind_('CreativeVersions', function (v) { return v.deliverableId === d.deliverableId; })
      .sort(function (a, b) { return Number(b.versionNo) - Number(a.versionNo); });
    if (!vs.length) return;
    var pick = [vs[0]];
    if (d.approvedVersionId && d.approvedVersionId !== vs[0].versionId) {
      var fin = vs.filter(function (v) { return v.versionId === d.approvedVersionId; })[0];
      if (fin) pick.push(fin);
    }
    pick.forEach(function (v) {
      var fin = d.approvedVersionId === v.versionId && v.status === VSTATUS.APPROVED;
      out.push({ kind: 'version', id: v.versionId, title: d.title, version: 'V' + v.versionNo, isFinal: fin,
        state: fin ? 'Final (approved)' : (SHARE_STATE[v.status] || v.status), ext: extOf_(v.fileName), size: v.sizeBytes, _f: v });
    });
  });
  return out;
}

function shareFiles_(t) {
  return dbFind_('ReferenceFiles', function (f) { return f.taskId === t.taskId || (!f.taskId && f.requirementId === t.requirementId); })
    .map(function (f) {
      return { kind: 'attachment', id: f.attachmentId, title: f.fileName, ext: extOf_(f.fileName), size: f.sizeBytes, uploadedAt: f.uploadedAt,
        from: /^shared link/.test(f.uploadedBy) ? f.uploadedBy.replace(/^shared link:?\s*/, '') || 'Shared link' : f.uploadedBy === 'requester' ? 'Requester' : 'Graphics team', _f: f };
    });
}

function strip_(o) { var r = {}; Object.keys(o).forEach(function (k) { if (k.charAt(0) !== '_') r[k] = o[k]; }); return r; }

function api_getShare(token) {
  return respond_(function () {
    rateLimit_('share:' + String(token).slice(0, 60), 120, 600);
    var x = shareFromToken_(token), t = x.task, s = settings_();
    var req = dbGet_('Requirements', t.requirementId) || {};
    if (!x.share.lastOpenedAt || Date.now() - new Date(x.share.lastOpenedAt).getTime() > 3600e3) {
      withLock_(function () { dbUpdate_('TaskShares', x.share.shareId, { lastOpenedAt: nowIso_() }); });
    }
    var updates = dbFind_('TaskActivity', function (a) { return a.taskId === t.taskId && ['hold', 'resume', 'shared_info', 'reopened'].indexOf(a.action) !== -1; })
      .slice(-30).reverse().map(function (a) {
        return { kind: a.action, at: a.createdAt, text: a.note, from: a.action === 'shared_info' ? a.toValue : 'Graphics team' };
      });
    return {
      companyName: s.companyName, taskId: t.taskId, requirementId: t.requirementId, title: t.title, brief: t.brief,
      department: req.department || '', requesterName: req.requesterName || '', quantity: Number(t.deliverablesRequired) || 0,
      status: t.status === STATUS.ON_HOLD ? 'On hold' : requesterStatus_([t]), dueText: t.status === STATUS.ON_HOLD ? '' : dueText_(t.dueDate, t.dueTime),
      hold: t.status === STATUS.ON_HOLD ? { reason: t.holdReason, dept: t.holdDept, waitingOn: HOLD_PARTIES[t.holdParty] || '', since: t.holdSince } : null,
      creatives: shareVersions_(t).map(strip_), files: shareFiles_(t).map(strip_), updates: updates,
      upload: { extensions: s.allowedExtensions, maxMB: s.maxPublicUploadMB, chunkBytes: LIMITS.CHUNK_BYTES }
    };
  });
}

function shareItem_(t, kind, id) {
  var list = kind === 'attachment' ? shareFiles_(t) : shareVersions_(t);
  var it = list.filter(function (x) { return x.id === String(id); })[0];
  if (!it) throw AppError_('NOT_FOUND', 'File not found.');
  return it;
}

function api_shareThumbs(token, items) {
  return respond_(function () {
    rateLimit_('sharethumb:' + String(token).slice(0, 60), 200, 600);
    var t = shareFromToken_(token).task, out = {};
    (Array.isArray(items) ? items : []).slice(0, 24).forEach(function (q) {
      var key = q.kind + ':' + q.id;
      try { var it = shareItem_(t, q.kind, q.id); out[key] = smallThumb_({ fileId: it._f.fileId, mime: it._f.mimeType, size: it._f.sizeBytes }); }
      catch (e) { out[key] = null; }
    });
    return out;
  });
}

function api_shareFile(token, kind, id, mode) {
  return respond_(function () {
    rateLimit_('sharefile:' + String(token).slice(0, 60), 200, 600);
    var t = shareFromToken_(token).task, it = shareItem_(t, kind === 'attachment' ? 'attachment' : 'version', id);
    if (mode === 'original') {
      var name = kind === 'attachment' ? it.title : (it.title || 'creative').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_' + it.version + '.' + (it.ext || 'bin');
      return originalOf_(it._f.fileId, name);
    }
    return previewOf_(it._f.fileId, it._f.mimeType, it._f.sizeBytes, 1600);
  });
}

/** Other department sends details (and says how many files they attached). */
function api_shareMessage(token, input) {
  return respond_(function () {
    rateLimit_('sharemsg:' + String(token).slice(0, 60), 20, 600);
    input = input || {};
    var name = str_(input.name, 100, 'Your name', true);
    var dept = str_(input.dept, 100, 'Department', false);
    var message = str_(input.message, 4000, 'Message', false);
    var files = Math.max(0, Math.min(50, Number(input.files) || 0));
    if (!message && !files) throw AppError_('VALIDATION', 'Write a message or attach a file.');
    return withLock_(function () {
      var t = shareFromToken_(token).task;
      var from = name + (dept ? ' (' + dept + ')' : '');
      var text = (message || '') + (files ? (message ? '\n' : '') + '📎 ' + files + ' file(s) attached' : '');
      logActivity_(t.taskId, { email: 'shared link', role: 'external' }, 'shared_info', '', from, text, 'team');
      var body = from + ' sent details for ' + t.taskId + ':\n\n' + text + (t.status === STATUS.ON_HOLD ? '\n\nThe task is on hold — resume it once you have everything.' : '');
      var mail = t.assigneeEmail ? [t.assigneeEmail] : [];
      notify_(mail, 'shared_info', 'Details received: ' + t.title, body, 'task/' + t.taskId, true);
      notify_(leaderEmails_().filter(function (e) { return mail.indexOf(e) === -1; }), 'shared_info', 'Details received: ' + t.title, body, 'task/' + t.taskId, mail.length === 0);
      return { message: 'Sent! The graphics team has been told.' };
    });
  });
}
