/**
 * Review.gs — the public, no-login review page API.
 *
 * Everything returned here is built from an explicit allow-list
 * (reviewDto_). Designer names/emails, internal notes, task ids of other
 * work and Drive URLs are never included. The file itself is streamed by
 * the server, so the Drive file stays private.
 */

var TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/;

function lookupToken_(token) {
  if (!TOKEN_RE.test(String(token || ''))) return { state: 'invalid' };
  var hash = sha256_(token);
  var tok = dbFind_('ReviewTokens', function (k) { return k.tokenHash === hash; })[0];
  if (!tok) return { state: 'invalid' };
  var req = dbGet_('ApprovalRequests', tok.requestId);
  if (!req) return { state: 'invalid' };
  var ctx = { tok: tok, req: req };
  if (req.status === 'Decided') return Object.assign(ctx, { state: 'decided' });
  if (req.status === 'Superseded') return Object.assign(ctx, { state: 'superseded' });
  if (req.status === 'Cancelled') return Object.assign(ctx, { state: 'revoked' });
  if (tok.revokedAt) return Object.assign(ctx, { state: 'revoked' });
  if (new Date(tok.expiresAt).getTime() < Date.now()) return Object.assign(ctx, { state: 'expired' });
  var task = dbGet_('Tasks', req.taskId);
  if (!task || task.status === STATUS.CANCELLED || task.status === STATUS.ON_HOLD) return Object.assign(ctx, { state: 'revoked' });
  return Object.assign(ctx, { state: 'open' });
}

function sizeLabel_(n) {
  n = Number(n || 0);
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}

function reviewDto_(ctx, withPreview) {
  var s = settings_();
  var out = { state: ctx.state, companyName: s.companyName, portalName: s.portalName };
  if (ctx.state === 'invalid') return out;
  var v = dbGet_('CreativeVersions', ctx.req.versionId);
  var d = dbGet_('CreativeSubmissions', ctx.req.deliverableId);
  var t = dbGet_('Tasks', ctx.req.taskId);
  if (!v || !d || !t) return { state: 'invalid', companyName: s.companyName, portalName: s.portalName };

  out.creative = {
    title: d.title,
    purpose: d.purpose || t.purpose || String(t.brief || '').slice(0, 300),
    campaign: t.campaign,
    product: t.product,
    dimensions: t.dimensions,
    deliverableType: d.deliverableType || t.creativeType,
    version: 'V' + v.versionNo,
    status: ctx.state === 'open' ? 'Awaiting Approval' : (v.status === VSTATUS.SUPERSEDED ? 'Replaced by a newer version' : v.status),
    submittedOn: String(v.submittedAt || v.uploadedAt).slice(0, 10),
    fileType: (extOf_(v.fileName) || 'file').toUpperCase(),
    fileSize: sizeLabel_(v.sizeBytes)
  };
  if (ctx.state === 'decided') {
    var dec = dbFind_('ApprovalDecisions', function (x) { return x.requestId === ctx.req.requestId; })[0];
    if (dec) out.decision = { decision: dec.decision, decidedOn: String(dec.decidedAt).slice(0, 10), comment: dec.comment };
  }
  if (ctx.state === 'open') {
    out.identityMode = s.reviewerIdentity;
    out.allowDownload = !!s.allowReviewerDownload;
    out.isImage = INLINE_IMAGE_TYPES.indexOf(v.mimeType) !== -1 && Number(v.sizeBytes) <= LIMITS.ORIGINAL_INLINE_BYTES;
    out.canOpenOriginal = Number(v.sizeBytes) <= LIMITS.ORIGINAL_INLINE_BYTES;
    // Earlier feedback on this same creative, so the reviewer can check it was addressed.
    out.history = dbFind_('ApprovalDecisions', function (x) { return x.deliverableId === d.deliverableId; })
      .map(function (x) {
        var xv = dbGet_('CreativeVersions', x.versionId) || {};
        return { version: 'V' + xv.versionNo, decision: x.decision, comment: x.comment, decidedOn: String(x.decidedAt).slice(0, 10) };
      });
    if (withPreview) out.preview = previewOf_(v.fileId, v.mimeType, v.sizeBytes, 2000);
  }
  return out;
}

function api_getReview(token) {
  return respond_(function () {
    rateLimit_('review:' + String(token).slice(0, 60), 120, 600);
    var ctx = lookupToken_(token);
    if (ctx.state === 'open') {
      withLock_(function () { dbUpdate_('ReviewTokens', ctx.tok.tokenId, { lastOpenedAt: nowIso_() }); });
    }
    return reviewDto_(ctx, true);
  });
}

/** Full-resolution file for zoom / download (only while the link is open). */
function api_getReviewOriginal(token, purpose) {
  return respond_(function () {
    rateLimit_('reviewfile:' + String(token).slice(0, 60), 30, 600);
    var ctx = lookupToken_(token);
    if (ctx.state !== 'open') throw AppError_('LINK_CLOSED', 'This review link is no longer active.');
    var v = dbGet_('CreativeVersions', ctx.req.versionId);
    var d = dbGet_('CreativeSubmissions', ctx.req.deliverableId);
    if (purpose === 'download' && !settings_().allowReviewerDownload) throw AppError_('FORBIDDEN', 'Downloads are turned off for review links.');
    if (purpose !== 'download' && INLINE_IMAGE_TYPES.indexOf(v.mimeType) === -1) throw AppError_('VALIDATION', 'Use download to open this file type.');
    // Name the download after the creative, not the internal file name.
    var cleanName = (d.title || 'creative').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_V' + v.versionNo + '.' + (extOf_(v.fileName) || 'bin');
    return originalOf_(v.fileId, cleanName);
  });
}

function api_submitReview(token, input) {
  return respond_(function () {
    input = input || {};
    rateLimit_('reviewsubmit:' + String(token).slice(0, 60), 10, 600);
    var decision = oneOf_(String(input.decision || ''), ['approved', 'changes'], 'Decision');
    var comment = str_(input.comment, 4000, 'Feedback', decision === 'changes');
    if (decision === 'changes' && comment.length < 5) throw AppError_('VALIDATION', 'Please tell the team what to change.');
    var mode = settings_().reviewerIdentity;
    var reviewer = { name: '', email: '' };
    if (mode !== 'anonymous') {
      reviewer.name = str_(input.reviewerName, 100, 'Your name', mode === 'required');
      reviewer.email = email_(input.reviewerEmail, 'Your work email', mode === 'required');
    }
    return withLock_(function () {
      var ctx = lookupToken_(token);   // re-check inside the lock: prevents double decisions
      if (ctx.state === 'decided') throw AppError_('ALREADY_DECIDED', 'A decision has already been recorded for this creative. Thank you!');
      if (ctx.state !== 'open') throw AppError_('LINK_CLOSED', 'This review link is no longer active.');
      var v = dbGet_('CreativeVersions', ctx.req.versionId);
      var t = dbGet_('Tasks', ctx.req.taskId);
      if (reviewer.email && (reviewer.email === String(v.uploadedBy).toLowerCase() || reviewer.email === String(t.assigneeEmail).toLowerCase())) {
        throw AppError_('FORBIDDEN', 'The designer of a creative can’t approve their own work.');
      }
      applyDecision_(ctx.req, decision, comment, reviewer, 'public', null);
      return { state: 'decided', decision: decision };
    });
  });
}
