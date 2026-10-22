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
  return keys.indexOf(String(r.email || '').toLowerCase()) !== -1 || keys.indexOf(('req:' + r.requirementId).toLowerCase()) !== -1;
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
        .reduce(function (s, t) { return s + (Number(t.deliverablesRequired) || 0); }, 0);
      var awaiting = [];
      dels.forEach(function (d) {
        if (d.status !== DSTATUS.AWAITING) return;
        var v = dbGet_('CreativeVersions', d.latestVersionId);
        if (v && v.status === VSTATUS.AWAITING) awaiting.push({ versionId: v.versionId, title: d.title, version: 'V' + v.versionNo });
      });
      var creatives = [];
      dels.forEach(function (d) {
        var v = requesterVersion_(d);
        if (v) creatives.push({ versionId: v.versionId, title: d.title, version: 'V' + v.versionNo, state: creativeState_(d, v),
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
    return v.deliverableId === d.deliverableId && (v.status === VSTATUS.AWAITING || v.status === VSTATUS.CHANGES || v.status === VSTATUS.APPROVED);
  }).sort(function (x, y) { return Number(y.versionNo) - Number(x.versionNo); });
  return vs[0] || null;
}

function creativeState_(d, v) {
  if (v.status === VSTATUS.APPROVED) return 'Approved';
  if (v.status === VSTATUS.AWAITING) return 'Waiting for your review';
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

/** Emails a fresh tracking link. Same answer whether or not the email has requests. */
function api_sendTrackLink(email) {
  return respond_(function () {
    email = email_(email, 'Email', true);
    rateLimit_('tracksend:' + email, 3, 3600);
    rateLimit_('tracksend:all', 60, 600);
    var has = dbFind_('Requirements', function (r) { return String(r.email).toLowerCase() === email; }).length > 0;
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
        if (req && req.email && (t.status === STATUS.COMPLETED || t.status === STATUS.APPROVED)) {
          sendMail_(req.email, 'Final files for “' + req.title + '”', 'Hi ' + req.requesterName + ',\n\nThe final files are ready to download:\n' + url,
            { label: 'Open final files', url: url });
        }
      }
      return { finalLink: url };
    });
  });
}
