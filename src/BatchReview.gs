/**
 * BatchReview.gs — one no-login link to review many creatives at once
 * (e.g. for the founder on his phone). The leader picks creatives that are
 * waiting for approval; the link shows them as a gallery where each can be
 * approved or sent back with feedback, or all approved together.
 *
 * Security: 256-bit random token, only its SHA-256 hash stored; it expires,
 * can be revoked, and only covers the creatives chosen when it was made.
 * Designer names, internal notes and Drive links are never shown.
 */

function batchUrl_(token) {
  var base = settings_().publicUrl;
  if (!base) { try { base = ScriptApp.getService().getUrl(); } catch (e) { base = ''; } }
  return base + '?p=batch&t=' + token;
}

/** Leader: make a review link for several creatives that are waiting for approval. */
function api_createBatchLink(versionIds, title) {
  return respond_(function () {
    var u = requireLeader_();
    var ids = (Array.isArray(versionIds) ? versionIds : []).map(String).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    if (!ids.length) throw AppError_('VALIDATION', 'Choose at least one creative.');
    if (ids.length > 100) throw AppError_('VALIDATION', 'Share up to 100 creatives in one link.');
    title = str_(title, 120, 'Title', false);
    return withLock_(function () {
      var open = ids.filter(function (id) {
        return dbFind_('ApprovalRequests', function (x) { return x.versionId === id && x.status === 'Open'; }).length > 0;
      });
      if (!open.length) throw AppError_('VALIDATION', 'None of these creatives are waiting for approval.');
      var token = randomToken_();
      var days = Number(settings_().tokenExpiryDays) || 7;
      dbInsert_('ReviewBatches', {
        batchId: 'BAT-' + uuid_(), tokenHash: sha256_(token), title: title || (open.length + ' creatives for review'),
        versionIds: open.join(','), createdBy: u.email, createdAt: nowIso_(),
        expiresAt: new Date(Date.now() + days * 864e5).toISOString(), revokedAt: '', lastOpenedAt: ''
      });
      var tasks = {};
      open.forEach(function (id) { var v = dbGet_('CreativeVersions', id); if (v) tasks[v.taskId] = true; });
      Object.keys(tasks).forEach(function (tid) { logActivity_(tid, u, 'link_created', '', '', 'Shared in a review link: ' + (title || open.length + ' creatives'), 'leader'); });
      return { url: batchUrl_(token), count: open.length, skipped: ids.length - open.length, expiresInDays: days };
    });
  });
}

/** Leader: list / revoke shared links. */
function api_listBatchLinks() {
  return respond_(function () {
    requireLeader_();
    return dbAll_('ReviewBatches').slice(-50).reverse().map(function (b) {
      return { batchId: b.batchId, title: b.title, count: String(b.versionIds).split(',').filter(String).length, createdAt: b.createdAt,
        expiresAt: b.expiresAt, revoked: !!b.revokedAt, lastOpenedAt: b.lastOpenedAt };
    });
  });
}

function api_revokeBatchLink(batchId) {
  return respond_(function () {
    requireLeader_();
    return withLock_(function () {
      var b = dbGet_('ReviewBatches', str_(batchId, 60, 'Link', true));
      if (!b) throw AppError_('NOT_FOUND', 'Link not found.');
      dbUpdate_('ReviewBatches', b.batchId, { revokedAt: nowIso_() });
      return true;
    });
  });
}

/* ---------- public (no login) ---------- */

function batchFromToken_(token) {
  if (!TOKEN_RE.test(String(token || ''))) throw AppError_('LINK_INVALID', 'This link isn’t valid. Please check you copied the full link.');
  var hash = sha256_(token);
  var b = dbFind_('ReviewBatches', function (x) { return x.tokenHash === hash; })[0];
  if (!b) throw AppError_('LINK_INVALID', 'This link isn’t valid. Please check you copied the full link.');
  if (b.revokedAt) throw AppError_('LINK_CLOSED', 'This review link has been withdrawn. Ask the graphics team for a new one.');
  if (new Date(b.expiresAt).getTime() < Date.now()) throw AppError_('LINK_EXPIRED', 'This review link has expired. Ask the graphics team for a new one.');
  return b;
}

function batchIds_(b) { return String(b.versionIds || '').split(',').filter(String); }

/** One creative in the link. state: open | approved | changes | closed. */
function batchItem_(versionId) {
  var v = dbGet_('CreativeVersions', versionId);
  if (!v) return null;
  var d = dbGet_('CreativeSubmissions', v.deliverableId) || {};
  var t = dbGet_('Tasks', v.taskId);
  if (!t) return null;
  var openReq = dbFind_('ApprovalRequests', function (x) { return x.versionId === versionId && x.status === 'Open'; })[0];
  var dec = dbFind_('ApprovalDecisions', function (x) { return x.versionId === versionId; }).pop();
  var state = openReq && t.status !== STATUS.CANCELLED ? 'open'
    : v.status === VSTATUS.APPROVED ? 'approved' : v.status === VSTATUS.CHANGES ? 'changes' : 'closed';
  return {
    versionId: v.versionId, title: d.title || 'Creative', version: 'V' + v.versionNo, task: t.title, purpose: d.purpose || '',
    ext: extOf_(v.fileName), isImage: INLINE_IMAGE_TYPES.indexOf(v.mimeType) !== -1, state: state,
    comment: dec && state === 'changes' ? dec.comment : '', _v: v, _t: t, _req: openReq
  };
}

function publicItem_(it) {
  var o = {}; Object.keys(it).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = it[k]; }); return o;
}

function api_getBatch(token) {
  return respond_(function () {
    rateLimit_('batch:' + String(token).slice(0, 60), 120, 600);
    var b = batchFromToken_(token);
    var s = settings_();
    var items = batchIds_(b).map(batchItem_).filter(Boolean).map(publicItem_);
    if (!b.lastOpenedAt || Date.now() - new Date(b.lastOpenedAt).getTime() > 3600e3) {
      withLock_(function () { dbUpdate_('ReviewBatches', b.batchId, { lastOpenedAt: nowIso_() }); });
    }
    return { title: b.title, companyName: s.companyName, expiresAt: b.expiresAt, reviewerIdentity: s.reviewerIdentity,
      allowDownload: !!s.allowReviewerDownload, items: items };
  });
}

function batchVersion_(b, versionId) {
  versionId = str_(versionId, 60, 'Creative', true);
  if (batchIds_(b).indexOf(versionId) === -1) throw AppError_('NOT_FOUND', 'Creative not found in this link.');
  var it = batchItem_(versionId);
  if (!it) throw AppError_('NOT_FOUND', 'This creative is no longer available.');
  return it;
}

function api_batchThumbs(token, versionIds) {
  return respond_(function () {
    rateLimit_('batchthumb:' + String(token).slice(0, 60), 200, 600);
    var b = batchFromToken_(token), out = {};
    (Array.isArray(versionIds) ? versionIds : []).slice(0, 24).forEach(function (id) {
      try { var it = batchVersion_(b, id); out[id] = smallThumb_({ fileId: it._v.fileId, mime: it._v.mimeType, size: it._v.sizeBytes }); }
      catch (e) { out[id] = null; }
    });
    return out;
  });
}

function api_batchFile(token, versionId, mode) {
  return respond_(function () {
    rateLimit_('batchfile:' + String(token).slice(0, 60), 200, 600);
    var b = batchFromToken_(token), it = batchVersion_(b, versionId);
    if (mode === 'original') {
      if (!settings_().allowReviewerDownload) throw AppError_('FORBIDDEN', 'Downloads are turned off for review links.');
      var name = (it.title || 'creative').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_' + it.version + '.' + (it.ext || 'bin');
      return originalOf_(it._v.fileId, name);
    }
    return previewOf_(it._v.fileId, it._v.mimeType, it._v.sizeBytes, 1600);
  });
}

/** Reviewer name/email per the "reviewer identity" setting. */
function batchReviewer_(input) {
  var mode = settings_().reviewerIdentity, r = { name: '', email: '' };
  input = input || {};
  if (mode !== 'anonymous') {
    r.name = str_(input.reviewerName, 100, 'Your name', mode === 'required');
    r.email = email_(input.reviewerEmail, 'Your email', false);   // name is enough for a shared link
  }
  return r;
}

/** Throws if the reviewer is the creative's own designer (team leaders excepted). */
function checkNotOwnWork_(reviewer, v, t) {
  if (!reviewer.email) return;
  var e = reviewer.email.toLowerCase();
  if (e !== String(v.uploadedBy).toLowerCase() && e !== String(t.assigneeEmail).toLowerCase()) return;
  var m = userByEmail_(e);
  if (m && bool_(m.active) && m.role === ROLES.LEADER) return;
  throw AppError_('FORBIDDEN', 'The designer of a creative can’t approve their own work.');
}

function api_batchDecide(token, versionId, decision, comment, who) {
  return respond_(function () {
    rateLimit_('batchdecide:' + String(token).slice(0, 60), 120, 600);
    decision = oneOf_(String(decision || ''), ['approved', 'changes'], 'Decision');
    comment = str_(comment, 4000, 'Feedback', decision === 'changes');
    if (decision === 'changes' && comment.length < 5) throw AppError_('VALIDATION', 'Please tell the team what to change.');
    var reviewer = batchReviewer_(who);
    return withLock_(function () {
      var b = batchFromToken_(token), it = batchVersion_(b, versionId);
      if (it.state !== 'open') throw AppError_('ALREADY_DECIDED', 'A decision has already been recorded for this creative.');
      checkNotOwnWork_(reviewer, it._v, it._t);
      applyDecision_(it._req, decision, comment, reviewer, 'public', null);
      return { state: decision === 'approved' ? 'approved' : 'changes' };
    });
  });
}

function api_batchApproveAll(token, versionIds, who) {
  return respond_(function () {
    rateLimit_('batchall:' + String(token).slice(0, 60), 20, 600);
    var reviewer = batchReviewer_(who);
    return withLock_(function () {
      var b = batchFromToken_(token);
      var ids = (Array.isArray(versionIds) ? versionIds : batchIds_(b)).map(String).slice(0, 100);
      return approveMany_(ids, '', reviewer, 'public', null, function (id) {
        var it = batchVersion_(b, id);
        if (it.state !== 'open') throw AppError_('ALREADY_DECIDED', 'Already decided.');
        checkNotOwnWork_(reviewer, it._v, it._t);
        return it._req;
      });
    });
  });
}
