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

    // Bots fill the hidden "website" field; humans never see it.
    if (payload.website) throw AppError_('VALIDATION', 'Submission rejected.');

    var r = {
      requesterName: str_(payload.requesterName, 100, 'Your name', true),
      department: str_(payload.department, 100, 'Department', true),
      email: email_(payload.email, 'Email', true),
      phone: str_(payload.phone, 20, 'Contact number', false),
      title: str_(payload.title, 150, 'Requirement title', true),
      creativeType: str_(payload.creativeType, 50, 'Type of creative', true),
      purpose: str_(payload.purpose, 1000, 'Purpose', true),
      brief: str_(payload.brief, LIMITS.TEXT_LONG, 'Brief', true),
      campaign: str_(payload.campaign, 150, 'Campaign', false),
      product: str_(payload.product, 150, 'Product / brand', false),
      quantity: int_(payload.quantity || 1, 1, 50, 'Number of creatives'),
      dimensions: str_(payload.dimensions, 200, 'Dimensions', false),
      platform: str_(payload.platform, 150, 'Platform / placement', false),
      copyText: str_(payload.copyText, LIMITS.TEXT_LONG, 'Copy', false),
      referenceUrls: urls_(payload.referenceUrls),
      preferredDate: date_(payload.preferredDate, 'Preferred delivery date', true),
      priorityRequested: oneOf_(str_(payload.priorityRequested, 20, 'Priority', true), s.priorities, 'Priority'),
      instructions: str_(payload.instructions, LIMITS.TEXT_LONG, 'Additional instructions', false)
    };

    if (s.requireRequesterDomain && s.allowedDomain && r.email.split('@')[1] !== s.allowedDomain.toLowerCase()) {
      throw AppError_('VALIDATION', 'Please use your @' + s.allowedDomain + ' work email.');
    }
    if (r.preferredDate < isoDateOnly_()) throw AppError_('VALIDATION', 'The preferred delivery date can’t be in the past.');

    // Dynamic fields for the chosen creative type
    var type = (s.creativeTypes || []).filter(function (t) { return t.id === r.creativeType; })[0];
    if (!type) throw AppError_('VALIDATION', 'Please choose a type of creative.');
    var tf = {}, given = payload.typeFields || {};
    (type.fields || []).forEach(function (f) {
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

    rateLimit_('submit:' + r.email, 6, 600);
    rateLimit_('submit:all', 120, 600);

    var result = withLock_(function () {
      var reqId = nextSeqId_('REQ');
      var taskId = nextSeqId_('GFX');
      var folder = ensureFolder_('references', [String(new Date().getFullYear()), reqId]);
      var now = nowIso_();
      dbInsert_('Requirements', Object.assign({}, r, {
        requirementId: reqId, referenceUrls: r.referenceUrls.join('\n'), typeFields: JSON.stringify(tf),
        folderId: folder.getId(), status: 'Received', notifiedAt: '', submittedAt: now, updatedAt: now
      }));
      dbInsert_('Tasks', {
        taskId: taskId, requirementId: reqId, title: r.title,
        brief: r.brief, creativeType: type.label, purpose: r.purpose, campaign: r.campaign, product: r.product,
        deliverablesRequired: String(r.quantity), dimensions: r.dimensions, formats: '', copyText: r.copyText,
        referenceUrls: r.referenceUrls.join('\n'), assigneeEmail: '', assignedBy: '', assignedAt: '',
        startDate: '', dueDate: r.preferredDate, priority: r.priorityRequested, status: STATUS.NEW, prevStatus: '',
        progress: '0', instructions: r.instructions, internalNotes: '', folderId: folder.getId(), completedAt: '',
        dueSoonNotifiedAt: '', overdueNotifiedAt: '', createdBy: r.email, createdAt: now, updatedAt: now
      });
      logActivity_(taskId, { email: r.email, role: 'requester' }, 'created', '', STATUS.NEW, 'via the request form (' + reqId + ')', 'team');
      return { requirementId: reqId, taskId: taskId, folderId: folder.getId() };
    });

    var ticket = randomToken_();
    CacheService.getScriptCache().put('tkt_' + sha256_(ticket), JSON.stringify({
      requirementId: result.requirementId, taskId: result.taskId, folderId: result.folderId,
      files: 0, finalized: false
    }), LIMITS.UPLOAD_TTL_SEC);

    return { requirementId: result.requirementId, uploadTicket: ticket };
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
  notify_(leaderEmails_(), 'requirement_new', 'New requirement: ' + req.title,
    req.requesterName + ' (' + req.department + ') needs ' + req.quantity + ' × ' + req.creativeType + ' by ' + req.preferredDate +
    '.\nPriority asked: ' + req.priorityRequested + '. ' + files + ' reference file(s) attached.',
    task ? 'task/' + task.taskId : 'requirements');
  if (settings_().emailRequesterOnSubmit) {
    sendMail_(req.email, 'We’ve got your request (' + requirementId + ')',
      'Hi ' + req.requesterName + ',\n\nYour graphics requirement "' + req.title + '" has reached the graphics team.\n' +
      'Reference ID: ' + requirementId + '\nPreferred delivery: ' + req.preferredDate +
      '\n\nThe team leader will review it and you’ll get a review link once the creative is ready.', null);
  }
}
