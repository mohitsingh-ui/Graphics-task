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
      var v = dbGet_('CreativeVersions', versionId);
      if (v.uploadedBy === u.email) throw AppError_('FORBIDDEN', 'You uploaded this version, so someone else needs to approve it.');
      applyDecision_(r, decision, comment, { name: u.name, email: u.email }, 'portal', u);
      return { status: dbGet_('Tasks', r.taskId).status };
    });
  });
}

/** Records a decision. Caller holds the lock and has verified the request is Open. */
function applyDecision_(request, decision, comment, reviewer, channel, actor) {
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
      var folder = ensureFolder_('approved', [String(new Date().getFullYear()), task.taskId]);
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

  var who = reviewer.name ? reviewer.name + (reviewer.email ? ' (' + reviewer.email + ')' : '') : 'An anonymous reviewer';
  notify_(leaderEmails_(), decision === 'approved' ? 'creative_approved' : 'changes_requested',
    label + ': ' + d.title + ' V' + v.versionNo,
    who + ' — ' + task.taskId + (comment ? '\n\n“' + comment + '”' : ''), 'task/' + task.taskId);
  if (task.assigneeEmail && leaderEmails_().indexOf(task.assigneeEmail) === -1) {
    notify_([task.assigneeEmail], decision === 'approved' ? 'creative_approved' : 'changes_requested',
      label + ': ' + d.title + ' V' + v.versionNo,
      (decision === 'approved' ? 'Nice work — this creative is approved.' : 'Feedback from the reviewer:\n\n' + comment), 'task/' + task.taskId);
  }
  recomputeTaskStatus_(task.taskId, 'system');
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
    dueDate: t.dueDate, uploadedBy: v.uploadedBy, uploadedByName: v.uploadedBy ? displayName_(v.uploadedBy) : '',
    decision: dec ? { decision: dec.decision, comment: dec.comment, reviewerName: dec.reviewerName, reviewerEmail: dec.reviewerEmail, decidedAt: dec.decidedAt, channel: dec.channel } : null
  };
}
