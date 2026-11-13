/**
 * Tracker.gs — "My requests" for requesters, without a login.
 *
 * Each requester gets a private tracking link (random 256-bit token; only
 * its hash is stored, tied to their email). The link lists their requests
 * and status. A lost link can be re-sent to the email address — the page
 * never reveals whether an email has requests, so emails can't be probed.
 * Designer names and internal notes are never included.
 */

var TRACK_DAYS = 180;

function trackUrl_(token) {
  var base = settings_().publicUrl;
  if (!base) { try { base = ScriptApp.getService().getUrl(); } catch (e) { base = ''; } }
  return base + '?p=my&t=' + token;
}

/** Creates a tracking token for an email (or "req:<id>" when no email was given). Caller holds the lock. */
function issueTrackToken_(key) {
  var token = randomToken_();
  dbInsert_('RequesterLinks', {
    linkId: 'TRK-' + uuid_(), email: String(key).toLowerCase(), tokenHash: sha256_(token),
    createdAt: nowIso_(), expiresAt: new Date(Date.now() + TRACK_DAYS * 864e5).toISOString(), lastUsedAt: ''
  });
  return token;
}

/** Tracking keys for one token or a list of tokens (from this device). Invalid ones are skipped if others work. */
function trackKeys_(tokens) {
  var list = (Array.isArray(tokens) ? tokens : [tokens]).slice(0, 30), keys = [], lastErr = null;
  list.forEach(function (t) { try { var k = trackEmail_(t); if (keys.indexOf(k) === -1) keys.push(k); } catch (e) { lastErr = e; } });
  if (!keys.length) throw lastErr || AppError_('LINK_INVALID', 'This link isn’t valid.');
  return keys;
}

function ownsRequirement_(keys, r) {
  if (keys.indexOf(('req:' + r.requirementId).toLowerCase()) !== -1) return true;
  return requesterEmails_(r).some(function (e) { return keys.indexOf(e) !== -1; });
}

/** Which of this link's emails owns the request (for "approved by"), or ''. */
function ownerKey_(keys, r) {
  return requesterEmails_(r).filter(function (e) { return keys.indexOf(e) !== -1; })[0] || '';
}

function trackEmail_(token) {
  if (!TOKEN_RE.test(String(token || ''))) throw AppError_('LINK_INVALID', 'This link isn’t valid. Enter your email below and we’ll send you a new one.');
  var hash = sha256_(token);
  var row = dbFind_('RequesterLinks', function (r) { return r.tokenHash === hash; })[0];
  if (!row) throw AppError_('LINK_INVALID', 'This link isn’t valid. Enter your email below and we’ll send you a new one.');
  if (new Date(row.expiresAt).getTime() < Date.now()) throw AppError_('LINK_EXPIRED', 'This link has expired. Enter your email below and we’ll send you a new one.');
  return row.email;
}

/** Plain-language status for one requirement, from its tasks. */
function requesterStatus_(tasks) {
  var live = tasks.filter(function (t) { return t.status !== STATUS.CANCELLED; });
  if (!live.length) return tasks.length ? 'Cancelled' : 'Received';
  var has = function (list) { return live.some(function (t) { return list.indexOf(t.status) !== -1; }); };
  if (live.every(function (t) { return t.status === STATUS.COMPLETED || t.status === STATUS.APPROVED; })) return 'Completed';
  if (live.some(function (t) { return t.status === STATUS.ON_HOLD && t.holdParty && t.holdParty !== 'internal'; })) return 'Waiting for your input';
  if (has([STATUS.SUBMITTED, STATUS.RESUBMITTED])) return 'Ready for your review';
  if (has([STATUS.CHANGES])) return 'Being revised';
  if (has([STATUS.ASSIGNED, STATUS.IN_PROGRESS, STATUS.APPROVED, STATUS.COMPLETED])) return 'In progress';
  if (has([STATUS.ON_HOLD])) return 'On hold';
  return 'Received';
}

function api_getMyRequests(token) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('track:' + keys.join(',').slice(0, 120), 60, 600);
    var reqs = dbFind_('Requirements', function (r) { return ownsRequirement_(keys, r); })
      .sort(function (a, b) { return a.submittedAt < b.submittedAt ? 1 : -1; }).slice(0, 100);
    var out = reqs.map(function (r) {
      var tasks = dbFind_('Tasks', function (t) { return t.requirementId === r.requirementId; });
      var ids = {}; tasks.forEach(function (t) { ids[t.taskId] = true; });
      var dels = dbFind_('CreativeSubmissions', function (d) { return ids[d.taskId]; });
      var required = tasks.filter(function (t) { return t.status !== STATUS.CANCELLED; })
        .reduce(function (s, t) { return s + filesRequired_(t); }, 0);
      var awaiting = [];
      dels.forEach(function (d) {
        if (d.status !== DSTATUS.AWAITING) return;
        var v = dbGet_('CreativeVersions', d.latestVersionId);
        if (v && v.status === VSTATUS.AWAITING) awaiting.push({ versionId: v.versionId, title: d.title, version: 'V' + v.versionNo });
      });
      var creatives = [];
      dels.forEach(function (d) {
        var v = requesterVersion_(d);
        if (v) creatives.push({ versionId: v.versionId, title: d.title, version: 'V' + v.versionNo, state: creativeState_(d, v), isFinal: d.approvedVersionId === v.versionId,
          ext: extOf_(v.fileName), isImage: INLINE_IMAGE_TYPES.indexOf(v.mimeType) !== -1, canDownload: v.status === VSTATUS.APPROVED });
      });
      var links = [];
      tasks.forEach(function (t) { if (t.finalLink && t.status !== STATUS.CANCELLED) links.push(t.finalLink); });
      return {
        requirementId: r.requirementId, title: r.title, brief: String(r.brief || '').slice(0, 280),
        department: r.department, quantity: r.quantity, submittedAt: r.submittedAt,
        deadlineDate: r.preferredDate, deadlineTime: r.preferredTime || '',
        status: requesterStatus_(tasks),
        approved: dels.filter(function (d) { return d.status === DSTATUS.APPROVED; }).length,
        required: required || Number(r.quantity) || 0,
        awaiting: awaiting,
        creatives: creatives,
        finalFolderUrl: finalFolderUrl_(r),
        campaign: r.campaignId ? (function () {
          var c = dbGet_('Campaigns', r.campaignId); if (!c) return null;
          return { campaignId: c.campaignId, name: c.name, approved: approvedOf_(campaignTasks_(c.campaignId)).length };
        })() : null,
        hold: (function () {
          var h = tasks.filter(function (t) { return t.status === STATUS.ON_HOLD && t.holdParty && t.holdParty !== 'internal'; })[0];
          return h ? { reason: h.holdReason, dept: h.holdDept, since: h.holdSince } : null;
        })(),
        reopened: tasks.some(function (t) { return t.reopenedAt && CLOSED.indexOf(t.status) === -1; }),
        raisedBy: String(r.email || '').toLowerCase(), raisedByName: r.requesterName || '', coOwners: coOwnersOf_(r),
        canEdit: ['Completed', 'Cancelled'].indexOf(requesterStatus_(tasks)) === -1,
        canReopen: !!settings_().requesterCanReopen && requesterStatus_(tasks) === 'Completed',
        edit: { title: r.title, brief: r.brief, instructions: r.instructions || '', copyText: r.copyText || '', preferredDate: r.preferredDate || '', preferredTime: r.preferredTime || '' },
        finalLinks: links.filter(function (l, i) { return links.indexOf(l) === i; })
      };
    });
    var email = keys.filter(function (k) { return k.indexOf('req:') !== 0; })[0] || '';
    return { email: email, requests: out };
  });
}

/**
 * The version a requester may see for a creative: the approved one, else the
 * one waiting for their review, else the last one they asked changes on.
 * Unsubmitted drafts are never shown.
 */
function requesterVersion_(d) {
  if (d.approvedVersionId) { var a = dbGet_('CreativeVersions', d.approvedVersionId); if (a && a.status === VSTATUS.APPROVED) return a; }
  var vs = dbFind_('CreativeVersions', function (v) {
    return v.deliverableId === d.deliverableId && [VSTATUS.AWAITING, VSTATUS.CHANGES, VSTATUS.APPROVED, VSTATUS.REJECTED].indexOf(v.status) !== -1;
  }).sort(function (x, y) { return Number(y.versionNo) - Number(x.versionNo); });
  return vs[0] || null;
}

function creativeState_(d, v) {
  if (v.status === VSTATUS.APPROVED) return 'Approved';
  if (v.status === VSTATUS.AWAITING) return 'Waiting for your review';
  if (v.status === VSTATUS.REJECTED) return 'Rejected';
  return 'Being revised';
}

/** A version the requester may see, from one of their own requests. */
function trackVersion_(keys, versionId) {
  var v = dbGet_('CreativeVersions', str_(versionId, 60, 'Creative', true));
  var d = v && dbGet_('CreativeSubmissions', v.deliverableId);
  var t = v && dbGet_('Tasks', v.taskId);
  var r = t && dbGet_('Requirements', t.requirementId);
  if (!r || !d || !ownsRequirement_(keys, r) || t.status === STATUS.CANCELLED) throw AppError_('NOT_FOUND', 'Creative not found.');
  var shown = requesterVersion_(d);
  if (!shown || shown.versionId !== v.versionId) throw AppError_('NOT_FOUND', 'Creative not found.');
  return { v: v, d: d };
}

/** Small previews for the requester's creatives. Returns { versionId: dataUrl|null }. */
function api_trackThumbs(token, versionIds) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackthumb:' + keys.join(',').slice(0, 120), 120, 600);
    var out = {};
    (Array.isArray(versionIds) ? versionIds : []).slice(0, 24).forEach(function (id) {
      try { var x = trackVersion_(keys, id); out[id] = smallThumb_({ fileId: x.v.fileId, mime: x.v.mimeType, size: x.v.sizeBytes }); }
      catch (e) { out[id] = null; }
    });
    return out;
  });
}

/** Large preview ('preview') or the full file ('original', approved creatives only). */
function api_trackFile(token, versionId, mode) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackfile:' + keys.join(',').slice(0, 120), 60, 600);
    var x = trackVersion_(keys, versionId);
    if (mode === 'original') {
      if (x.v.status !== VSTATUS.APPROVED) throw AppError_('FORBIDDEN', 'You can download a creative once it’s approved.');
      var name = (x.d.title || 'creative').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_V' + x.v.versionNo + '.' + (extOf_(x.v.fileName) || 'bin');
      return originalOf_(x.v.fileId, name);
    }
    return previewOf_(x.v.fileId, x.v.mimeType, x.v.sizeBytes, 1600);
  });
}

/** Fresh review link for a creative in one of the requester's own requests. */
function api_trackReview(token, versionId) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackrev:' + keys.join(',').slice(0, 120), 30, 600);
    return withLock_(function () {
      var v = dbGet_('CreativeVersions', str_(versionId, 60, 'Creative', true));
      var t = v && dbGet_('Tasks', v.taskId);
      var r = t && dbGet_('Requirements', t.requirementId);
      if (!r || !ownsRequirement_(keys, r)) throw AppError_('NOT_FOUND', 'Creative not found.');
      var rq = dbFind_('ApprovalRequests', function (x) { return x.versionId === v.versionId && x.status === 'Open'; })[0];
      if (!rq) throw AppError_('ALREADY_DECIDED', 'This creative is no longer waiting for review.');
      return { url: reviewUrl_(issueToken_(rq.requestId, 'requester')) };
    });
  });
}

/** Open review request for one of the requester's own creatives; fills reviewer from the request. Caller holds the lock. */
function trackOpenRequest_(keys, id, reviewer, named) {
  var v = dbGet_('CreativeVersions', str_(id, 60, 'Creative', true));
  var t = v && dbGet_('Tasks', v.taskId);
  var r = t && dbGet_('Requirements', t.requirementId);
  if (!r || !ownsRequirement_(keys, r)) throw AppError_('NOT_FOUND', 'Creative not found.');
  var rq = dbFind_('ApprovalRequests', function (x) { return x.versionId === v.versionId && x.status === 'Open'; })[0];
  if (!rq) throw AppError_('ALREADY_DECIDED', 'This creative is no longer waiting for review.');
  var em = ownerKey_(keys, r) || String(r.email || '').toLowerCase();
  if (em && (em === String(v.uploadedBy).toLowerCase() || em === String(t.assigneeEmail).toLowerCase())) {
    var me = userByEmail_(em);
    if (!(me && bool_(me.active) && me.role === ROLES.LEADER)) throw AppError_('FORBIDDEN', 'The designer of a creative can’t approve their own work.');
  }
  if (named) {
    var raiser = em === String(r.email || '').toLowerCase();
    reviewer.name = raiser ? r.requesterName || '' : (userByEmail_(em) || {}).name || em; reviewer.email = em || r.email || '';
  }
  return rq;
}

/** Requester approves several of their own creatives at once from "My requests". */
function api_trackApproveMany(token, versionIds) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackapprove:' + keys.join(',').slice(0, 120), 20, 600);
    var ids = (Array.isArray(versionIds) ? versionIds : []).map(String).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    if (!ids.length) throw AppError_('VALIDATION', 'Nothing to approve.');
    if (ids.length > 60) throw AppError_('VALIDATION', 'Approve up to 60 at a time.');
    return withLock_(function () {
      var reviewer = { name: '', email: '' }, named = settings_().reviewerIdentity !== 'anonymous';
      return approveMany_(ids, '', reviewer, 'public', null, function (id) { return trackOpenRequest_(keys, id, reviewer, named); });
    });
  });
}

/** Requester approves or asks for changes on one creative, from the gallery in "My requests". */
function api_trackDecide(token, versionId, decision, comment) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackdecide:' + keys.join(',').slice(0, 120), 60, 600);
    decision = oneOf_(String(decision || ''), ['approved', 'changes', 'rejected'], 'Decision');
    comment = str_(comment, 4000, 'Feedback', decision !== 'approved');
    if (decision !== 'approved' && comment.length < 5) throw AppError_('VALIDATION', decision === 'rejected' ? 'Say why it’s rejected.' : 'Please tell the team what to change.');
    return withLock_(function () {
      var reviewer = { name: '', email: '' };
      var rq = trackOpenRequest_(keys, versionId, reviewer, settings_().reviewerIdentity !== 'anonymous');
      applyDecision_(rq, decision, comment, reviewer, 'public', null);
      return { decision: decision };
    });
  });
}

/** The requester's request + its tasks, if this device/link owns it. */
function trackRequirement_(keys, requirementId) {
  var r = dbGet_('Requirements', str_(requirementId, 40, 'Request', true));
  if (!r || !ownsRequirement_(keys, r)) throw AppError_('NOT_FOUND', 'Request not found.');
  return { r: r, tasks: dbFind_('Tasks', function (t) { return t.requirementId === r.requirementId && t.status !== STATUS.CANCELLED; }) };
}

/** Link where the requester can send the missing details / files (e.g. NI table, barcode) for a request on hold. */
function api_trackShareLink(token, requirementId) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackshare:' + keys.join(',').slice(0, 120), 20, 600);
    return withLock_(function () {
      var x = trackRequirement_(keys, requirementId);
      var t = x.tasks.filter(function (t) { return t.status === STATUS.ON_HOLD; })[0] || x.tasks[0];
      if (!t) throw AppError_('NOT_FOUND', 'Nothing to send details for yet.');
      return { url: shareUrl_(issueShare_(t.taskId, 'requester', 'Requester link')) };
    });
  });
}

/** Requester asks for changes on a completed request; the team leader decides whether to reopen it. */
function api_trackAskChanges(token, requirementId, message) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackask:' + keys.join(',').slice(0, 120), 5, 3600);
    message = str_(message, 3000, 'What needs to change', true);
    if (message.length < 5) throw AppError_('VALIDATION', 'Describe what needs to change.');
    return withLock_(function () {
      var x = trackRequirement_(keys, requirementId);
      x.tasks.forEach(function (t) { logActivity_(t.taskId, { email: x.r.email || 'requester', role: 'requester' }, 'change_request', '', '', message, 'team'); });
      var t0 = x.tasks[0];
      notify_(leaderEmails_(), 'change_request', 'Changes asked on a finished request: ' + x.r.title,
        x.r.requesterName + ' (' + x.r.department + ') asks:\n\n“' + message + '”\n\n' + x.r.requirementId + ' — reopen the task if the changes should be made.',
        t0 ? 'task/' + t0.taskId : 'requirements', true);
      return { message: 'Sent to the graphics team. They’ll reopen the task and let you know.' };
    });
  });
}

/* ---------- whole campaign, for everyone who asked for something in it ---------- */

/** The campaign, if one of this device's/link's requests is in it. */
function trackCampaign_(keys, campaignId) {
  var c = dbGet_('Campaigns', str_(campaignId, 40, 'Campaign', true));
  if (!c || !campaignRequests_(c.campaignId).some(function (r) { return ownsRequirement_(keys, r); })) throw AppError_('NOT_FOUND', 'Campaign not found.');
  return c;
}

function trackCampaignItems_(keys, c) {
  var mine = {};
  campaignRequests_(c.campaignId).forEach(function (r) { if (ownsRequirement_(keys, r)) mine[r.requirementId] = true; });
  return approvedOf_(campaignTasks_(c.campaignId)).map(function (a) {
    return { versionId: a.v.versionId, title: a.d.title, version: 'V' + a.v.versionNo, path: categoryOf_(a.task, a.d), ext: extOf_(a.v.fileName),
      isImage: INLINE_IMAGE_TYPES.indexOf(a.v.mimeType) !== -1, mine: !!mine[a.task.requirementId], _v: a.v, _d: a.d };
  }).sort(function (x, y) { return x.path === y.path ? (x.title < y.title ? -1 : 1) : (x.path < y.path ? -1 : 1); });
}

/** Every approved creative in the campaign (all departments' requests + the team's own tasks). */
function api_trackCampaign(token, campaignId) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackcamp:' + keys.join(',').slice(0, 120), 60, 600);
    var c = trackCampaign_(keys, campaignId);
    var folderUrl = '';
    if (bool_(c.shared) && c.folderId) { try { folderUrl = DriveApp.getFolderById(c.folderId).getUrl(); } catch (e) { folderUrl = ''; } }
    return { campaignId: c.campaignId, name: c.name, folderUrl: folderUrl, items: trackCampaignItems_(keys, c).map(function (x) { var o = {}; Object.keys(x).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = x[k]; }); return o; }) };
  });
}

function trackCampaignVersion_(keys, campaignId, versionId) {
  var c = trackCampaign_(keys, campaignId);
  var it = trackCampaignItems_(keys, c).filter(function (x) { return x.versionId === String(versionId); })[0];
  if (!it) throw AppError_('NOT_FOUND', 'Creative not found.');
  return it;
}

function api_trackCampaignThumbs(token, campaignId, versionIds) {
  return respond_(function () {
    var keys = trackKeys_(token), c = trackCampaign_(keys, campaignId), out = {};
    var items = trackCampaignItems_(keys, c), byId = {};
    items.forEach(function (x) { byId[x.versionId] = x; });
    (Array.isArray(versionIds) ? versionIds : []).slice(0, 24).forEach(function (id) {
      var x = byId[id]; out[id] = x ? smallThumb_({ fileId: x._v.fileId, mime: x._v.mimeType, size: x._v.sizeBytes }) : null;
    });
    return out;
  });
}

function api_trackCampaignFile(token, campaignId, versionId, mode) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackcampfile:' + keys.join(',').slice(0, 120), 120, 600);
    var x = trackCampaignVersion_(keys, campaignId, versionId);
    if (mode === 'original') return originalOf_(x._v.approvedFileId || x._v.fileId, approvedName_(x._d, x._v));
    return previewOf_(x._v.fileId, x._v.mimeType, x._v.sizeBytes, 1600);
  });
}

/** Emails a fresh tracking link. Same answer whether or not the email has requests. */
function api_sendTrackLink(email) {
  return respond_(function () {
    email = email_(email, 'Email', true);
    rateLimit_('tracksend:' + email, 3, 3600);
    rateLimit_('tracksend:all', 60, 600);
    var has = dbFind_('Requirements', function (r) { return requesterEmails_(r).indexOf(email) !== -1; }).length > 0;
    if (has) {
      var token = withLock_(function () { return issueTrackToken_(email); });
      sendMail_(email, 'Your graphics requests', 'Here’s your private link to see all your requests and their status:\n\n' + trackUrl_(token) +
        '\n\nKeep it to yourself — anyone with this link can see your requests.', { label: 'See my requests', url: trackUrl_(token) });
    }
    return { message: 'If that email has requests with us, a link is on its way. Check your inbox (and spam).' };
  });
}

/* ---------- final files link (designer / leader) ---------- */

function api_setFinalLink(taskId, url) {
  return respond_(function () {
    var u = currentUser_();
    url = str_(url, 1000, 'Link', false);
    if (url && !/^https:\/\/[^\s<>"']+$/i.test(url)) throw AppError_('VALIDATION', 'Paste a full link starting with https://');
    return withLock_(function () {
      var t = requireTask_(u, taskId);
      if (!isLeader_(u) && t.assigneeEmail !== u.email) throw AppError_('NOT_FOUND', 'Task not found.');
      if (url === t.finalLink) return { finalLink: url };
      dbUpdate_('Tasks', t.taskId, { finalLink: url, updatedAt: nowIso_() });
      logActivity_(t.taskId, u, 'final_link', '', url ? 'added' : 'removed', url, 'team');
      if (url) {
        var req = dbGet_('Requirements', t.requirementId);
        notify_(leaderEmails_().filter(function (e) { return e !== u.email; }), 'final_link', 'Final files link added: ' + t.title, t.taskId + ' → ' + url, 'task/' + t.taskId, false);
        if (req && (t.status === STATUS.COMPLETED || t.status === STATUS.APPROVED)) {
          mailRequesters_(req, 'req_ready', 'Final files for “' + req.title + '”', 'Hi ' + req.requesterName + ',\n\nThe final files are ready to download:\n' + url,
            { label: 'Open final files', url: url });
        }
      }
      return { finalLink: url };
    });
  });
}


/* ---------- co-owners: more than one person owns a request ---------- */

var MAX_CO_OWNERS = 10;

/**
 * Adds a co-owner (caller holds the lock). They get their own "My requests"
 * link by email and from then on see, edit and approve the request like the
 * person who raised it.
 */
function addCoOwner_(r, email, byLabel) {
  email = email_(email, 'Email', true);
  var s = settings_();
  if (s.requireRequesterDomain && s.allowedDomain && email.split('@')[1] !== String(s.allowedDomain).toLowerCase()) {
    throw AppError_('VALIDATION', 'Only @' + s.allowedDomain + ' email addresses can be added.');
  }
  var list = coOwnersOf_(r);
  if (requesterEmails_(r).indexOf(email) !== -1) throw AppError_('VALIDATION', email + ' already owns this request.');
  if (list.length >= MAX_CO_OWNERS) throw AppError_('VALIDATION', 'Up to ' + MAX_CO_OWNERS + ' people can be added to one request.');
  list.push(email);
  dbUpdate_('Requirements', r.requirementId, { coOwners: list.join(','), updatedAt: nowIso_() });
  dbFind_('Tasks', function (t) { return t.requirementId === r.requirementId; }).forEach(function (t) {
    logActivity_(t.taskId, { email: byLabel, role: 'requester' }, 'co_owner', '', email, 'Added as a co-owner of the request', 'team');
  });
  if (s.emailNotifications && mailRule_('req_coowner')) {
    var link = trackUrl_(issueTrackToken_(email));
    sendMail_(email, 'You’ve been added to a graphics request (' + r.requirementId + ')',
      'Hi,\n\n' + byLabel + ' added you as an owner of the request "' + r.title + '" (' + r.requirementId + ').\n\n' +
      'You can follow it, edit the details and approve the creatives here:\n' + link, { label: 'Open my requests', url: link });
  }
  return list;
}

function removeCoOwner_(r, email, byLabel) {
  email = String(email || '').toLowerCase().trim();
  var list = coOwnersOf_(r);
  if (list.indexOf(email) === -1) throw AppError_('NOT_FOUND', 'That person isn’t a co-owner of this request.');
  list = list.filter(function (e) { return e !== email; });
  dbUpdate_('Requirements', r.requirementId, { coOwners: list.join(','), updatedAt: nowIso_() });
  dbFind_('Tasks', function (t) { return t.requirementId === r.requirementId; }).forEach(function (t) {
    logActivity_(t.taskId, { email: byLabel, role: 'requester' }, 'co_owner', email, '', 'Removed as a co-owner', 'team');
  });
  return list;
}

function ownersDto_(r) { return { raisedBy: String(r.email || '').toLowerCase(), raisedByName: r.requesterName || '', coOwners: coOwnersOf_(r) }; }

/** Requester (or a co-owner) adds someone by email from "My requests". */
function api_trackAddOwner(token, requirementId, email) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackowner:' + keys.join(',').slice(0, 120), 20, 3600);
    return withLock_(function () {
      var x = trackRequirement_(keys, requirementId);
      addCoOwner_(x.r, email, ownerKey_(keys, x.r) || x.r.requesterName || 'The requester');
      return ownersDto_(dbGet_('Requirements', x.r.requirementId));
    });
  });
}

/** Any owner can take a co-owner off (also themselves). The person who raised it always stays. */
function api_trackRemoveOwner(token, requirementId, email) {
  return respond_(function () {
    var keys = trackKeys_(token);
    return withLock_(function () {
      var x = trackRequirement_(keys, requirementId);
      removeCoOwner_(x.r, email, ownerKey_(keys, x.r) || 'The requester');
      return ownersDto_(dbGet_('Requirements', x.r.requirementId));
    });
  });
}

/** Team leader adds or removes request owners from the task page. */
function api_setRequestOwners(requirementId, input) {
  return respond_(function () {
    var u = requireLeader_();
    input = input || {};
    return withLock_(function () {
      var r = dbGet_('Requirements', str_(requirementId, 40, 'Request', true));
      if (!r) { var t = dbGet_('Tasks', requirementId); r = t && dbGet_('Requirements', t.requirementId); }
      if (!r) throw AppError_('NOT_FOUND', 'Request not found.');
      if (input.add) addCoOwner_(r, input.add, u.name + ' (graphics team)');
      if (input.remove) removeCoOwner_(dbGet_('Requirements', r.requirementId), input.remove, u.email);
      return ownersDto_(dbGet_('Requirements', r.requirementId));
    });
  });
}

/**
 * Any owner edits their request from "My requests" (until it's finished).
 * The brief, copy and instructions also update on the designers' tasks,
 * unless the leader already rewrote them there. The team is told what changed.
 */
function api_trackEditRequest(token, requirementId, patchIn) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackedit:' + keys.join(',').slice(0, 120), 20, 3600);
    patchIn = patchIn || {};
    var allowed = {
      title: function (v) { return str_(v, 150, 'Title', true); },
      brief: function (v) { var b = str_(v, LIMITS.TEXT_LONG, 'Brief', true); if (b.length < 5) throw AppError_('VALIDATION', 'Describe what you need.'); return b; },
      instructions: function (v) { return str_(v, LIMITS.TEXT_LONG, 'Instructions', false); },
      copyText: function (v) { return str_(v, LIMITS.TEXT_LONG, 'Copy', false); },
      preferredDate: function (v) { var d = date_(v, 'Needed by', true); if (d < isoDateOnly_()) throw AppError_('VALIDATION', 'The date can’t be in the past.'); return d; },
      preferredTime: function (v) { return time_(v, 'Time', false); }
    };
    var labels = { title: 'title', brief: 'brief', instructions: 'instructions', copyText: 'copy', preferredDate: 'needed-by date', preferredTime: 'time' };
    var patch = {};
    Object.keys(patchIn).forEach(function (k) { if (allowed[k]) patch[k] = allowed[k](patchIn[k]); });
    return withLock_(function () {
      var x = trackRequirement_(keys, requirementId), r = x.r;
      var all = dbFind_('Tasks', function (t) { return t.requirementId === r.requirementId; });
      var st = requesterStatus_(all);
      if (st === 'Completed') throw AppError_('INVALID_STATE', 'This request is finished. Use “Need changes?” to ask for changes.');
      if (st === 'Cancelled') throw AppError_('INVALID_STATE', 'This request was cancelled.');
      var changed = Object.keys(patch).filter(function (k) { return String(r[k] || '') !== String(patch[k]); });
      if (!changed.length) return { changed: [] };
      var p = {}; changed.forEach(function (k) { p[k] = patch[k]; });
      p.updatedAt = nowIso_();
      dbUpdate_('Requirements', r.requirementId, p);
      var who = ownerKey_(keys, r) || r.requesterName || 'The requester';
      var summary = 'Changed: ' + changed.map(function (k) { return labels[k]; }).join(', ') +
        (p.preferredDate || p.preferredTime ? ' · now needed by ' + dueText_(p.preferredDate || r.preferredDate, p.preferredTime !== undefined ? p.preferredTime : r.preferredTime) : '');
      x.tasks.forEach(function (t) {
        var tp = {};
        ['brief', 'copyText', 'instructions'].forEach(function (k) { if (p[k] !== undefined && String(t[k] || '') === String(r[k] || '')) tp[k] = p[k]; });
        if (Object.keys(tp).length) { tp.updatedAt = nowIso_(); dbUpdate_('Tasks', t.taskId, tp); }
        logActivity_(t.taskId, { email: who, role: 'requester' }, 'request_edited', '', '', summary + (p.brief ? '\n\nNew brief:\n' + p.brief : ''), 'team');
      });
      var mail = [];
      x.tasks.forEach(function (t) { if (t.assigneeEmail && mail.indexOf(t.assigneeEmail) === -1) mail.push(t.assigneeEmail); });
      leaderEmails_().forEach(function (e) { if (mail.indexOf(e) === -1) mail.push(e); });
      notify_(mail, 'request_edited', 'Request updated: ' + (p.title || r.title), who + ' updated ' + r.requirementId + '.\n\n' + summary +
        (p.brief ? '\n\nNew brief:\n' + p.brief.slice(0, 800) : ''), x.tasks[0] ? 'task/' + x.tasks[0].taskId : 'requirements', true);
      return { changed: changed };
    });
  });
}


/**
 * Requester (or a co-owner) reopens their finished request for changes, from "My requests".
 * versionIds: the creatives that need changes (empty = all). Every finished task holding one of
 * them goes back to the designer with the new date; the leader is told.
 */
function api_trackReopen(token, requirementId, input) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackreopen:' + keys.join(',').slice(0, 120), 10, 3600);
    if (!settings_().requesterCanReopen) throw AppError_('FORBIDDEN', 'Reopening is done by the graphics team lead. Use “Need changes?” instead.');
    input = input || {};
    var reason = str_(input.reason, 2000, 'What needs to change', true);
    if (reason.length < 5) throw AppError_('VALIDATION', 'Describe what needs to change.');
    var dueDate = date_(input.dueDate, 'Needed by', true), dueTime = time_(input.dueTime, 'Time', false);
    if (dueDate < isoDateOnly_()) throw AppError_('VALIDATION', 'The date can’t be in the past.');
    var vids = (Array.isArray(input.versionIds) ? input.versionIds : []).map(String).slice(0, 200);
    return withLock_(function () {
      var x = trackRequirement_(keys, requirementId);
      if (requesterStatus_(x.tasks) !== 'Completed') throw AppError_('INVALID_STATE', 'Only a finished request can be reopened.');
      var who = ownerKey_(keys, x.r) || '';
      var actor = { email: who || 'requester', role: 'requester', name: who && who === String(x.r.email || '').toLowerCase() ? x.r.requesterName : who || x.r.requesterName };
      var picks = {};
      vids.forEach(function (id) { var v = dbGet_('CreativeVersions', id); if (v) (picks[v.taskId] = picks[v.taskId] || []).push(v.deliverableId); });
      var done = x.tasks.filter(function (t) { return t.status === STATUS.COMPLETED || t.status === STATUS.APPROVED; });
      var targets = vids.length ? done.filter(function (t) { return picks[t.taskId]; }) : done;
      if (!targets.length) throw AppError_('VALIDATION', 'Choose at least one creative to change.');
      var n = 0;
      targets.forEach(function (t) { n += reopenTask_(t, actor, reason, dueDate, dueTime, picks[t.taskId] || [], false).length; });
      notify_(leaderEmails_(), 'change_request', 'Reopened by the requester: ' + x.r.title,
        (actor.name || 'The requester') + ' (' + x.r.department + ') reopened ' + x.r.requirementId + ' for changes — ' + n + ' creative(s), needed by ' + dueText_(dueDate, dueTime) + '.\n\n“' + reason + '”',
        'task/' + targets[0].taskId, true);
      return { reopened: n, tasks: targets.length, message: 'Reopened — the graphics team is working on your changes.' };
    });
  });
}
