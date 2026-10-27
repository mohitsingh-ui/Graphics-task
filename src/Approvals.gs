/**
 * Approvals.gs — submitting versions for approval, review links and decisions.
 *
 * Review links: a 256-bit random token per link. Only its SHA-256 hash is
 * stored (ReviewTokens), with expiry and revocation. A token is scoped to
 * one approval request = one creative version. When a decision is made, or
 * a newer version is submitted, every token of that request stops working.
 */

function reviewUrl_(token) {
  var base = settings_().publicUrl;
  if (!base) { try { base = ScriptApp.getService().getUrl(); } catch (e) { base = ''; } }
  return base + '?p=review&t=' + token;
}

function issueToken_(requestId, actor) {
  var token = randomToken_();
  var days = Math.max(1, Math.min(90, Number(settings_().tokenExpiryDays) || 14));
  dbInsert_('ReviewTokens', {
    tokenId: 'TOK-' + uuid_(), requestId: requestId, tokenHash: sha256_(token), createdBy: actor ? actor.email || actor : 'system',
    createdAt: nowIso_(), expiresAt: new Date(Date.now() + days * 864e5).toISOString(), revokedAt: '', revokeReason: '', lastOpenedAt: ''
  });
  return token;
}

function revokeTokens_(requestId, reason) {
  dbFind_('ReviewTokens', function (k) { return k.requestId === requestId && !k.revokedAt; })
    .forEach(function (k) { dbUpdate_('ReviewTokens', k.tokenId, { revokedAt: nowIso_(), revokeReason: reason }); });
}

/** Supersede open requests for a deliverable (new version submitted). */
function supersedeOpenRequests_(deliverableId, exceptRequestId) {
  dbFind_('ApprovalRequests', function (r) {
    return r.deliverableId === deliverableId && r.status === 'Open' && r.requestId !== exceptRequestId;
  }).forEach(function (r) {
    dbUpdate_('ApprovalRequests', r.requestId, { status: 'Superseded', closedAt: nowIso_() });
    revokeTokens_(r.requestId, 'superseded');
    var v = dbGet_('CreativeVersions', r.versionId);
    if (v && v.status === VSTATUS.AWAITING) dbUpdate_('CreativeVersions', v.versionId, { status: VSTATUS.SUPERSEDED });
  });
}

function closeOpenRequests_(taskId, reason) {
  dbFind_('ApprovalRequests', function (r) { return r.taskId === taskId && r.status === 'Open'; }).forEach(function (r) {
    dbUpdate_('ApprovalRequests', r.requestId, { status: 'Cancelled', closedAt: nowIso_() });
    revokeTokens_(r.requestId, reason || 'cancelled');
  });
}

/**
 * Submit draft versions for approval. If versionIds is empty, every draft on
 * the task is submitted. Returns review links only to leaders.
 */
function api_submitForApproval(taskId, versionIds) {
  return respond_(function () {
    var u = currentUser_();
    return withLock_(function () {
      var task = requireTask_(u, taskId);
      if (!taskPermissions_(u, task).canUpload) throw AppError_('INVALID_STATE', 'This task can’t be submitted while it is ' + task.status.toLowerCase() + '.');
      var wanted = Array.isArray(versionIds) && versionIds.length ? versionIds : null;
      var drafts = dbFind_('CreativeVersions', function (v) {
        return v.taskId === task.taskId && v.status === VSTATUS.DRAFT && (!wanted || wanted.indexOf(v.versionId) !== -1);
      });
      if (!drafts.length) throw AppError_('VALIDATION', 'Upload a creative first — there’s nothing new to submit.');

      var links = [], lines = [];
      drafts.forEach(function (v) {
        var d = dbGet_('CreativeSubmissions', v.deliverableId);
        var requestId = 'APR-' + uuid_();
        supersedeOpenRequests_(d.deliverableId, null);
        dbInsert_('ApprovalRequests', { requestId: requestId, versionId: v.versionId, deliverableId: d.deliverableId,
          taskId: task.taskId, status: 'Open', createdBy: u.email, createdAt: nowIso_(), closedAt: '' });
        dbUpdate_('CreativeVersions', v.versionId, { status: VSTATUS.AWAITING, submittedAt: nowIso_() });
        // A new version after approval needs a fresh approval; the old approval stays on record.
        dbUpdate_('CreativeSubmissions', d.deliverableId, { status: DSTATUS.AWAITING, updatedAt: nowIso_() });
        var token = issueToken_(requestId, u);
        var url = reviewUrl_(token);
        links.push({ versionId: v.versionId, deliverable: d.title, versionNo: v.versionNo, url: url });
        lines.push('• ' + d.title + ' (V' + v.versionNo + '): ' + url);
        logActivity_(task.taskId, u, 'submitted', '', d.title + ' · V' + v.versionNo, '', 'team');
      });
      recomputeTaskStatus_(task.taskId, u);

      var leaders = leaderEmails_();
      notify_(leaders, 'approval_submitted', 'Ready for approval: ' + task.title,
        (isLeader_(u) ? 'Submitted' : displayName_(u.email) + ' submitted') + ' ' + drafts.length + ' creative(s) for ' + task.taskId + '.\n\nReview links:\n' + lines.join('\n'),
        'task/' + task.taskId);

      var s = settings_();
      var req = dbGet_('Requirements', task.requirementId);
      if (s.sendReviewLinkToRequester && req && req.email) {
        sendMail_(req.email, 'Please review: ' + task.title,
          'Hi ' + req.requesterName + ',\n\nThe graphics team has creative(s) ready for your approval on "' + req.title + '" (' + req.requirementId + ').\n\n' +
          lines.join('\n') + '\n\nOpen each link to approve it or ask for changes. Links expire in ' + s.tokenExpiryDays + ' days.', null);
      }
      return { submitted: drafts.length, links: isLeader_(u) ? links : [] };
    });
  });
}

/** Leader: create an additional review link for a version's open request. */
function api_createReviewLink(versionId) {
  return respond_(function () {
    var u = requireLeader_();
    return withLock_(function () {
      var r = dbFind_('ApprovalRequests', function (x) { return x.versionId === versionId && x.status === 'Open'; })[0];
      if (!r) throw AppError_('INVALID_STATE', 'This version isn’t waiting for approval.');
      var token = issueToken_(r.requestId, u);
      logActivity_(r.taskId, u, 'link_created', '', '', 'New review link created', 'leader');
      return { url: reviewUrl_(token), expiresInDays: settings_().tokenExpiryDays };
    });
  });
}

/** Leader: revoke every active review link for a version. */
function api_revokeReviewLinks(versionId) {
  return respond_(function () {
    var u = requireLeader_();
    return withLock_(function () {
      var reqs = dbFind_('ApprovalRequests', function (x) { return x.versionId === versionId; });
      if (!reqs.length) throw AppError_('NOT_FOUND', 'No review links for this version.');
      reqs.forEach(function (r) { revokeTokens_(r.requestId, 'revoked by leader'); });
      logActivity_(reqs[0].taskId, u, 'link_revoked', '', '', 'Review links revoked', 'leader');
      return true;
    });
  });
}

/** Leader approves / requests changes from inside the portal. */
function api_leaderDecision(versionId, decision, comment) {
  return respond_(function () {
    var u = requireLeader_();
    decision = oneOf_(String(decision || ''), ['approved', 'changes'], 'Decision');
    comment = str_(comment, 4000, 'Feedback', decision === 'changes');
    return withLock_(function () {
      var r = dbFind_('ApprovalRequests', function (x) { return x.versionId === versionId && x.status === 'Open'; })[0];
      if (!r) throw AppError_('ALREADY_DECIDED', 'This version is no longer waiting for approval.');
      // Team leaders may approve their own work.
      applyDecision_(r, decision, comment, { name: u.name, email: u.email }, 'portal', u);
      return { status: dbGet_('Tasks', r.taskId).status };
    });
  });
}

/** Who gets the approval / changes email: the designer who made the version and the current assignee (not whoever decided). */
function designerRecipients_(task, v, actor) {
  var me = actor && actor.email ? String(actor.email).toLowerCase() : '';
  return [v.uploadedBy, task.assigneeEmail].map(function (e) { return String(e || '').toLowerCase(); })
    .filter(function (e, i, a) { return e && e !== me && a.indexOf(e) === i; });
}

/** Records a decision. Caller holds the lock and has verified the request is Open. */
function applyDecision_(request, decision, comment, reviewer, channel, actor, opts) {
  var now = nowIso_();
  var v = dbGet_('CreativeVersions', request.versionId);
  var d = dbGet_('CreativeSubmissions', request.deliverableId);
  var task = dbGet_('Tasks', request.taskId);

  dbUpdate_('ApprovalRequests', request.requestId, { status: 'Decided', closedAt: now });
  revokeTokens_(request.requestId, 'used');
  dbInsert_('ApprovalDecisions', {
    decisionId: 'DEC-' + uuid_(), requestId: request.requestId, versionId: v.versionId, deliverableId: d.deliverableId,
    taskId: task.taskId, decision: decision, comment: comment || '', reviewerName: reviewer.name || '',
    reviewerEmail: reviewer.email || '', channel: channel, decidedBy: actor && actor.email ? actor.email : '', decidedAt: now
  });

  if (decision === 'approved') {
    var copyId = '';
    try {
      var folder = DriveApp.getFolderById(ensureFolderId_('approved', [String(new Date().getFullYear()), task.taskId]));
      copyId = DriveApp.getFileById(v.fileId).makeCopy('APPROVED_' + v.fileName, folder).getId();
    } catch (e) { console.warn('Approved copy failed for ' + v.versionId + ': ' + e); }
    dbUpdate_('CreativeVersions', v.versionId, { status: VSTATUS.APPROVED, approvedFileId: copyId });
    dbUpdate_('CreativeSubmissions', d.deliverableId, { status: DSTATUS.APPROVED, approvedVersionId: v.versionId, updatedAt: now });
  } else {
    dbUpdate_('CreativeVersions', v.versionId, { status: VSTATUS.CHANGES });
    dbUpdate_('CreativeSubmissions', d.deliverableId, { status: DSTATUS.CHANGES, updatedAt: now });
  }

  var label = decision === 'approved' ? 'Approved' : 'Changes requested';
  logActivity_(task.taskId, channel === 'public' ? 'reviewer' : actor, decision === 'approved' ? 'approved' : 'changes_requested',
    '', d.title + ' · V' + v.versionNo, comment || '', 'team');

  if (opts && opts.quiet) { recomputeTaskStatus_(task.taskId, 'system'); return { task: task, d: d, v: v }; }
  var who = reviewer.name ? reviewer.name + (reviewer.email ? ' (' + reviewer.email + ')' : '') : 'An anonymous reviewer';
  var title = label + ': ' + d.title + ' V' + v.versionNo;
  var mail = designerRecipients_(task, v, actor);
  // Email goes only to the designer. Leaders just see it in the portal's bell.
  notify_(mail, decision === 'approved' ? 'creative_approved' : 'changes_requested', title,
    (decision === 'approved' ? 'Nice work — this creative is approved.' : 'Feedback from the reviewer:\n\n' + comment), 'task/' + task.taskId, true);
  notify_(leaderEmails_().filter(function (e) { return mail.indexOf(e) === -1; }), decision === 'approved' ? 'creative_approved' : 'changes_requested',
    title, who + ' — ' + task.taskId + (comment ? '\n\n“' + comment + '”' : ''), 'task/' + task.taskId, false);
  recomputeTaskStatus_(task.taskId, 'system');
  return { task: task, d: d, v: v };
}

/**
 * Approves many creatives in one go. pick(versionId) returns the open request
 * or throws; skips anything already decided. One summary notification per task.
 * Caller holds the lock.
 */
function approveMany_(versionIds, comment, reviewer, channel, actor, pick) {
  var byTask = {}, approved = 0, skipped = [];
  versionIds.forEach(function (id) {
    var r;
    try { r = pick(id); } catch (e) { skipped.push({ versionId: id, reason: e.message || 'Skipped' }); return; }
    var res = applyDecision_(r, 'approved', comment, reviewer, channel, actor, { quiet: true });
    approved++;
    var g = (byTask[res.task.taskId] = byTask[res.task.taskId] || { task: res.task, titles: [], versions: [] });
    g.titles.push(res.d.title + ' V' + res.v.versionNo); g.versions.push(res.v);
  });
  var who = reviewer.name ? reviewer.name + (reviewer.email ? ' (' + reviewer.email + ')' : '') : 'An anonymous reviewer';
  Object.keys(byTask).forEach(function (tid) {
    var g = byTask[tid], n = g.titles.length, list = g.titles.join('\n');
    var title = 'Approved ' + n + ' creative' + (n > 1 ? 's' : '') + ': ' + g.task.title;
    var mail = [];
    g.versions.forEach(function (v) { designerRecipients_(g.task, v, actor).forEach(function (e) { if (mail.indexOf(e) === -1) mail.push(e); }); });
    notify_(mail, 'creative_approved', title, 'Nice work — these are approved:\n' + list + (comment ? '\n\n“' + comment + '”' : ''), 'task/' + tid, true);
    notify_(leaderEmails_().filter(function (e) { return mail.indexOf(e) === -1 && (!actor || e !== actor.email); }), 'creative_approved',
      title, who + ' — ' + tid + '\n\n' + list + (comment ? '\n\n“' + comment + '”' : ''), 'task/' + tid, false);
  });
  return { approved: approved, skipped: skipped };
}

/** Leader approves many creatives at once (max 60 per call). */
function api_leaderApproveMany(versionIds, comment) {
  return respond_(function () {
    var u = requireLeader_();
    var ids = (Array.isArray(versionIds) ? versionIds : []).map(String).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    if (!ids.length) throw AppError_('VALIDATION', 'Select at least one creative.');
    if (ids.length > 60) throw AppError_('VALIDATION', 'Approve up to 60 at a time.');
    comment = str_(comment, 4000, 'Feedback', false);
    return withLock_(function () {
      return approveMany_(ids, comment, { name: u.name, email: u.email }, 'portal', u, function (id) {
        var r = dbFind_('ApprovalRequests', function (x) { return x.versionId === id && x.status === 'Open'; })[0];
        if (!r) throw AppError_('ALREADY_DECIDED', 'No longer waiting for approval.');
        return r;
      });
    });
  });
}

/** Leader: open approval requests with context, for the Approvals page. */
function api_listApprovals(scope) {
  return respond_(function () {
    requireLeader_();
    var rows = dbAll_('ApprovalRequests');
    if (scope !== 'all') rows = rows.filter(function (r) { return r.status === 'Open'; });
    else rows = rows.slice(-200);
    return rows.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }).map(approvalRowDto_);
  });
}

function approvalRowDto_(r) {
  var v = dbGet_('CreativeVersions', r.versionId) || {};
  var d = dbGet_('CreativeSubmissions', r.deliverableId) || {};
  var t = dbGet_('Tasks', r.taskId) || {};
  var dec = dbFind_('ApprovalDecisions', function (x) { return x.requestId === r.requestId; })[0];
  return {
    requestId: r.requestId, status: r.status, createdAt: r.createdAt, closedAt: r.closedAt,
    versionId: v.versionId, versionNo: v.versionNo, fileName: v.fileName, mimeType: v.mimeType,
    deliverableTitle: d.title, deliverableId: d.deliverableId, taskId: t.taskId, taskTitle: t.title, campaign: t.campaign,
    dueDate: t.dueDate, dueTime: t.dueTime, uploadedBy: v.uploadedBy, uploadedByName: v.uploadedBy ? displayName_(v.uploadedBy) : '',
    decision: dec ? { decision: dec.decision, comment: dec.comment, reviewerName: dec.reviewerName, reviewerEmail: dec.reviewerEmail, decidedAt: dec.decidedAt, channel: dec.channel } : null
  };
}
