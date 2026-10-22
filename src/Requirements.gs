/**
 * Requirements.gs — public requirement intake (no login).
 * Flow: api_submitRequirement → (api_startUpload/api_uploadChunk with the
 * returned upload ticket, per file) → api_finalizeRequirement.
 */

function api_getFormConfig() {
  return respond_(function () {
    var s = settings_();
    return {
      companyName: s.companyName,
      portalName: s.portalName,
      allowedDomain: s.requireRequesterDomain ? s.allowedDomain : '',
      brandGuidelinesUrl: s.brandGuidelinesUrl,
      priorities: s.priorities,
      creativeTypes: s.creativeTypes,
      departments: dbFind_('Departments', function (d) { return bool_(d.active); }).map(function (d) { return d.name; }),
      maxFiles: s.maxPublicFiles,
      maxFileMB: s.maxPublicUploadMB,
      extensions: s.publicExtensions,
      chunkBytes: LIMITS.CHUNK_BYTES
    };
  });
}

function api_submitRequirement(payload) {
  return respond_(function () {
    payload = payload || {};
    var s = settings_();

    // Spam guard: a hidden field only bots fill. It is named so browser autofill ignores it
    // (an earlier "website" field was being filled by Chrome autofill and blocked real people).
    if (payload.gfx_trap_9) throw AppError_('VALIDATION', 'Something went wrong sending this. Please reload the page and try again.');

    // A signed-in team member (e.g. the team leader) raising a requirement is recorded as such.
    var member = null;
    var signedIn = activeEmail_();
    if (signedIn) { var mu = userByEmail_(signedIn); if (mu && bool_(mu.active)) member = mu; }

    // The short form asks only: who, department, requirement, deadline, how many, references.
    // Older detailed fields are still accepted (and can be filled in by the leader later).
    var requirementText = str_(payload.brief || payload.requirement, LIMITS.TEXT_LONG, 'Requirement', true);
    var r = {
      requesterName: str_(payload.requesterName, 100, 'Your name', true),
      department: str_(payload.department, 100, 'Department', true),
      email: email_(payload.email, 'Email', !!(s.requireRequesterDomain && s.allowedDomain)),
      phone: str_(payload.phone, 20, 'Contact number', false),
      title: str_(payload.title, 150, 'Requirement title', false) || titleFrom_(requirementText),
      creativeType: str_(payload.creativeType, 50, 'Type of creative', false),
      purpose: str_(payload.purpose, 1000, 'Purpose', false),
      brief: requirementText,
      campaign: str_(payload.campaign, 150, 'Campaign', false),
      product: str_(payload.product, 150, 'Product / brand', false),
      quantity: int_(payload.quantity || 1, 1, 50, 'Number of creatives'),
      dimensions: str_(payload.dimensions, 200, 'Dimensions', false),
      platform: str_(payload.platform, 150, 'Platform / placement', false),
      copyText: str_(payload.copyText, LIMITS.TEXT_LONG, 'Copy', false),
      referenceUrls: urls_(payload.referenceUrls),
      preferredDate: date_(payload.preferredDate, 'Deadline date', true),
      preferredTime: time_(payload.preferredTime, 'Deadline time', false),
      priorityRequested: str_(payload.priorityRequested, 20, 'Priority', false) || 'Medium',
      instructions: str_(payload.instructions, LIMITS.TEXT_LONG, 'Additional instructions', false)
    };
    if (s.priorities.indexOf(r.priorityRequested) === -1) r.priorityRequested = s.priorities[Math.min(1, s.priorities.length - 1)];

    if (s.requireRequesterDomain && s.allowedDomain && !member && r.email && r.email.split('@')[1] !== s.allowedDomain.toLowerCase()) {
      throw AppError_('VALIDATION', 'Please use your @' + s.allowedDomain + ' work email.');
    }
    if (r.preferredDate < isoDateOnly_()) throw AppError_('VALIDATION', 'The deadline can’t be in the past.');
    if (r.preferredTime && dueEnd_(r.preferredDate, r.preferredTime).getTime() < Date.now()) throw AppError_('VALIDATION', 'That deadline time has already passed.');

    // Optional creative type (only sent by the old detailed form or API callers)
    var type = r.creativeType ? (s.creativeTypes || []).filter(function (t) { return t.id === r.creativeType; })[0] : null;
    if (r.creativeType && !type) throw AppError_('VALIDATION', 'Unknown type of creative.');
    var tf = {}, given = payload.typeFields || {};
    ((type && type.fields) || []).forEach(function (f) {
      var v = given[f.key];
      if (f.type === 'number') {
        if (v === '' || v === null || v === undefined) { if (f.required) throw AppError_('VALIDATION', f.label + ' is required.'); return; }
        tf[f.key] = int_(v, 0, 100000, f.label);
      } else if (f.type === 'select') {
        v = str_(v, 200, f.label, f.required);
        if (v) tf[f.key] = oneOf_(v, f.options || [], f.label);
      } else {
        v = str_(v, f.type === 'textarea' ? LIMITS.TEXT_LONG : 300, f.label, f.required);
        if (v) tf[f.key] = v;
      }
    });
    if (!r.dimensions && tf.width && tf.height) r.dimensions = tf.width + ' × ' + tf.height + ' px';
    if (!r.dimensions && tf.format) r.dimensions = tf.format;
    if (!r.platform) r.platform = tf.platform || tf.marketplace || tf.adPlatform || tf.placement || tf.channel || '';

    if (!member) {
      rateLimit_('submit:' + (r.email || r.requesterName.toLowerCase()), 6, 600);
      rateLimit_('submit:all', 120, 600);
    }

    var result = withLock_(function () {
      var reqId = nextSeqId_('REQ');
      var taskId = nextSeqId_('GFX');
      var folder = DriveApp.getFolderById(ensureFolderId_('references', [String(new Date().getFullYear())])).createFolder(reqId);
      var now = nowIso_();
      dbInsert_('Requirements', Object.assign({}, r, {
        requirementId: reqId, referenceUrls: r.referenceUrls.join('\n'), typeFields: JSON.stringify(tf),
        folderId: folder.getId(), status: 'Received', notifiedAt: '', submittedAt: now, updatedAt: now,
        submittedBy: member ? member.email : ''
      }));
      dbInsert_('Tasks', {
        taskId: taskId, requirementId: reqId, title: r.title,
        brief: r.brief, creativeType: type ? type.label : '', purpose: r.purpose, campaign: r.campaign, product: r.product,
        deliverablesRequired: String(r.quantity), dimensions: r.dimensions, formats: '', copyText: r.copyText,
        referenceUrls: r.referenceUrls.join('\n'), assigneeEmail: '', assignedBy: '', assignedAt: '',
        startDate: '', dueDate: r.preferredDate, dueTime: r.preferredTime, priority: r.priorityRequested, status: STATUS.NEW, prevStatus: '',
        progress: '0', instructions: r.instructions, internalNotes: '', folderId: folder.getId(), completedAt: '',
        dueSoonNotifiedAt: '', overdueNotifiedAt: '', createdBy: r.email || 'requester', createdAt: now, updatedAt: now
      });
      logActivity_(taskId, member ? { email: member.email, role: member.role } : { email: r.email, role: 'requester' }, 'created', '', STATUS.NEW,
        (member ? 'raised from the portal (' : 'via the request form (') + reqId + ')', 'team');
      return { requirementId: reqId, taskId: taskId, folderId: folder.getId(), trackToken: issueTrackToken_(r.email || 'req:' + reqId) };
    });

    var ticket = randomToken_();
    CacheService.getScriptCache().put('tkt_' + sha256_(ticket), JSON.stringify({
      requirementId: result.requirementId, taskId: result.taskId, folderId: result.folderId,
      files: 0, finalized: false
    }), LIMITS.UPLOAD_TTL_SEC);

    return { requirementId: result.requirementId, uploadTicket: ticket, trackToken: result.trackToken };
  });
}

/** Called after reference uploads finish (or straight away if there are none). */
function api_finalizeRequirement(ticket) {
  return respond_(function () {
    var info = readTicket_(ticket);
    if (info.finalized) return { requirementId: info.requirementId };
    info.finalized = true;
    CacheService.getScriptCache().put('tkt_' + sha256_(ticket), JSON.stringify(info), LIMITS.UPLOAD_TTL_SEC);
    withLock_(function () { notifyNewRequirement_(info.requirementId); });
    return { requirementId: info.requirementId };
  });
}

function readTicket_(ticket) {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(String(ticket || ''))) throw AppError_('INVALID_TICKET', 'This upload session has expired. Please submit the form again.');
  var raw = CacheService.getScriptCache().get('tkt_' + sha256_(ticket));
  if (!raw) throw AppError_('INVALID_TICKET', 'This upload session has expired. Your requirement was saved — please email any missing files to the graphics team.');
  return JSON.parse(raw);
}

/** Notify leaders + confirm to requester. Idempotent via notifiedAt. Caller holds the lock. */
function notifyNewRequirement_(requirementId) {
  var req = dbGet_('Requirements', requirementId);
  if (!req || req.notifiedAt) return;
  var task = dbFind_('Tasks', function (t) { return t.requirementId === requirementId; })[0];
  var files = dbFind_('ReferenceFiles', function (f) { return f.requirementId === requirementId; }).length;
  dbUpdate_('Requirements', requirementId, { notifiedAt: nowIso_(), updatedAt: nowIso_() });
  notify_(leaderEmails_().filter(function (e) { return e !== req.submittedBy; }), 'requirement_new', 'New requirement: ' + req.title,
    req.requesterName + ' (' + req.department + ') needs ' + req.quantity + ' creative(s) by ' + dueText_(req.preferredDate, req.preferredTime) +
    '.\n\n' + String(req.brief).slice(0, 400) + '\n\n' + files + ' reference file(s) attached.',
    task ? 'task/' + task.taskId : 'requirements');
  if (settings_().emailRequesterOnSubmit && req.email) {
    var link = trackUrl_(issueTrackToken_(req.email));
    sendMail_(req.email, 'We’ve got your request (' + requirementId + ')',
      'Hi ' + req.requesterName + ',\n\nYour request "' + req.title + '" has reached the graphics team.\n' +
      'Reference ID: ' + requirementId + '\nNeeded by: ' + dueText_(req.preferredDate, req.preferredTime) +
      '\n\nSee all your requests and their status any time:\n' + link +
      '\n\nYou’ll get a review link as soon as the creative is ready.', { label: 'See my requests', url: link });
  }
}

/** First line of the requirement, cut to a readable title. */
function titleFrom_(text) {
  var line = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(String)[0] || 'Creative request';
  if (line.length <= 80) return line;
  var cut = line.slice(0, 80);
  var sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut) + '…';
}
