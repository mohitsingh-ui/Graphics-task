/**
 * Uploads.gs — chunked uploads from the browser into Google Drive.
 *
 * The browser sends 4 MB base64 chunks to the server; the server forwards
 * them to a Drive resumable-upload session. The session URI and the owner's
 * OAuth token never leave the server. Upload state is kept in CacheService
 * under an unguessable upload id bound to the uploader.
 *
 * kinds:
 *   reference — public requester attachments (bound to an upload ticket)
 *   taskref   — leader adds a reference file to a task
 *   version   — designer/leader uploads a creative version
 */

var MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  pdf: 'application/pdf', psd: 'image/vnd.adobe.photoshop', ai: 'application/postscript', eps: 'application/postscript',
  indd: 'application/x-indesign', tif: 'image/tiff', tiff: 'image/tiff', mp4: 'video/mp4', mov: 'video/quicktime',
  zip: 'application/zip', txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

/** Magic-byte signatures for formats where a mismatch is a red flag. */
var SIGNATURES = {
  png: [[0x89, 0x50, 0x4E, 0x47]],
  jpg: [[0xFF, 0xD8, 0xFF]], jpeg: [[0xFF, 0xD8, 0xFF]],
  gif: [[0x47, 0x49, 0x46, 0x38]],
  pdf: [[0x25, 0x50, 0x44, 0x46]],
  webp: [[0x52, 0x49, 0x46, 0x46]],
  psd: [[0x38, 0x42, 0x50, 0x53]],
  zip: [[0x50, 0x4B]], docx: [[0x50, 0x4B]], pptx: [[0x50, 0x4B]], xlsx: [[0x50, 0x4B]]
};

function uploadCache_() { return CacheService.getScriptCache(); }

function saveUpload_(id, rec) { uploadCache_().put('upl_' + sha256_(id), JSON.stringify(rec), LIMITS.UPLOAD_TTL_SEC); }

function loadUpload_(id) {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(String(id || ''))) throw AppError_('UPLOAD_EXPIRED', 'Upload session not found. Please try the file again.');
  var raw = uploadCache_().get('upl_' + sha256_(id));
  if (!raw) throw AppError_('UPLOAD_EXPIRED', 'Upload session expired. Please try the file again.');
  return JSON.parse(raw);
}

function validateFile_(fileName, size, extensions, maxMB) {
  var name = safeFileName_(fileName);
  var ext = extOf_(name);
  if (!ext || extensions.indexOf(ext) === -1) throw AppError_('VALIDATION', '"' + name + '" isn’t an allowed file type. Allowed: ' + extensions.join(', ') + '.');
  size = Number(size);
  if (!isFinite(size) || size <= 0) throw AppError_('VALIDATION', '"' + name + '" is empty.');
  if (size > maxMB * 1024 * 1024) throw AppError_('VALIDATION', '"' + name + '" is larger than ' + maxMB + ' MB.');
  return { name: name, ext: ext, size: size, mime: MIME_BY_EXT[ext] || 'application/octet-stream' };
}

function api_startUpload(ctx) {
  return respond_(function () {
    ctx = ctx || {};
    var s = settings_();
    var kind = oneOf_(String(ctx.kind || ''), ['reference', 'taskref', 'version'], 'Upload type');
    var rec = { kind: kind, received: 0 };
    var folder;

    if (kind === 'reference') {
      var info = readTicket_(ctx.ticket);
      if (info.finalized) throw AppError_('INVALID_TICKET', 'This requirement is already submitted.');
      if (info.files >= s.maxPublicFiles) throw AppError_('VALIDATION', 'You can attach up to ' + s.maxPublicFiles + ' files.');
      var f = validateFile_(ctx.fileName, ctx.size, s.publicExtensions, s.maxPublicUploadMB);
      info.files++;
      uploadCache_().put('tkt_' + sha256_(ctx.ticket), JSON.stringify(info), LIMITS.UPLOAD_TTL_SEC);
      rec.owner = 'ticket:' + sha256_(ctx.ticket);
      rec.requirementId = info.requirementId;
      rec.file = f;
      folder = DriveApp.getFolderById(info.folderId);
    } else {
      var u = currentUser_();
      var task = requireTask_(u, ctx.taskId);
      rec.owner = u.email;
      rec.taskId = task.taskId;
      rec.file = validateFile_(ctx.fileName, ctx.size, s.allowedExtensions, s.maxUploadMB);
      if (kind === 'taskref') {
        if (!isLeader_(u)) throw AppError_('FORBIDDEN', 'Only the team leader can add reference files to a task.');
        folder = task.folderId ? DriveApp.getFolderById(task.folderId) : ensureFolder_('references', [String(new Date().getFullYear()), task.requirementId]);
      } else {
        if (!taskPermissions_(u, task).canUpload) throw AppError_('INVALID_STATE', 'You can’t upload creatives while the task is ' + task.status.toLowerCase() + '.');
        rec.meta = {
          deliverableId: str_(ctx.deliverableId, 60, 'Deliverable', false),
          title: str_(ctx.title, 150, 'Creative title', !ctx.deliverableId),
          purpose: str_(ctx.purpose, 500, 'What the creative is for', false),
          deliverableType: str_(ctx.deliverableType, 100, 'Deliverable type', false),
          note: str_(ctx.note, 1000, 'Submission note', false)
        };
        if (rec.meta.deliverableId) {
          var d = dbGet_('CreativeSubmissions', rec.meta.deliverableId);
          if (!d || d.taskId !== task.taskId) throw AppError_('NOT_FOUND', 'That deliverable doesn’t belong to this task.');
        }
        folder = ensureFolder_('submissions', [String(new Date().getFullYear()), task.taskId]);
      }
    }

    rec.folderId = folder.getId();
    rec.sessionUri = startResumable_(rec.folderId, rec.file.name, rec.file.mime, rec.file.size);
    var uploadId = randomToken_();
    saveUpload_(uploadId, rec);
    return { uploadId: uploadId, chunkBytes: LIMITS.CHUNK_BYTES };
  });
}

/**
 * Upload one chunk. Chunks must arrive in order. The response for the last
 * chunk includes the created record (attachment or version).
 */
function api_uploadChunk(uploadId, offset, base64) {
  return respond_(function () {
    var rec = loadUpload_(uploadId);
    var user = null;
    if (rec.owner.indexOf('ticket:') !== 0) {
      user = currentUser_();
      if (user.email !== rec.owner) throw AppError_('UPLOAD_EXPIRED', 'Upload session not found.');
    }
    offset = Number(offset);
    if (offset !== rec.received) throw AppError_('UPLOAD_ORDER', 'Upload got out of sync. Please retry the file.');
    var bytes = Utilities.base64Decode(String(base64 || ''));
    if (!bytes.length) throw AppError_('VALIDATION', 'Empty chunk.');
    if (bytes.length > LIMITS.CHUNK_BYTES || offset + bytes.length > rec.file.size) throw AppError_('VALIDATION', 'Chunk is larger than expected.');
    var isLast = offset + bytes.length === rec.file.size;
    if (!isLast && bytes.length % (256 * 1024) !== 0) throw AppError_('VALIDATION', 'Invalid chunk size.');

    if (offset === 0 && SIGNATURES[rec.file.ext]) {
      var ok = SIGNATURES[rec.file.ext].some(function (sig) {
        return sig.every(function (b, i) { return ((bytes[i] + 256) % 256) === b; });
      });
      if (!ok) throw AppError_('VALIDATION', '"' + rec.file.name + '" doesn’t look like a real .' + rec.file.ext + ' file.');
    }

    var res = putChunk_(rec.sessionUri, bytes, offset, rec.file.size);
    if (!res.done) {
      rec.received = res.received || offset + bytes.length;
      saveUpload_(uploadId, rec);
      return { done: false, received: rec.received };
    }

    uploadCache_().remove('upl_' + sha256_(uploadId));
    var file = res.file;
    if (Number(file.size) !== rec.file.size) {
      console.warn('Size mismatch on upload ' + file.id + ': ' + file.size + ' vs ' + rec.file.size);
    }
    if (rec.kind === 'reference' || rec.kind === 'taskref') {
      return withLock_(function () {
        var att = dbInsert_('ReferenceFiles', {
          attachmentId: 'ATT-' + uuid_(), requirementId: rec.requirementId || (dbGet_('Tasks', rec.taskId) || {}).requirementId || '',
          taskId: rec.kind === 'taskref' ? rec.taskId : '', fileId: file.id, fileName: rec.file.name,
          mimeType: rec.file.mime, sizeBytes: String(rec.file.size), uploadedBy: user ? user.email : 'requester', uploadedAt: nowIso_()
        });
        if (rec.kind === 'taskref') logActivity_(rec.taskId, user, 'reference_added', '', rec.file.name, '', 'team');
        return { done: true, attachmentId: att.attachmentId, fileName: att.fileName };
      });
    }
    return Object.assign({ done: true }, createVersion_(user, rec, file));
  });
}

/** Creates a Draft version for an uploaded creative. */
function createVersion_(user, rec, file) {
  return withLock_(function () {
    var task = requireTask_(user, rec.taskId);
    if (!taskPermissions_(user, task).canUpload) throw AppError_('INVALID_STATE', 'This task no longer accepts uploads.');
    var now = nowIso_();
    var d;
    if (rec.meta.deliverableId) {
      d = dbGet_('CreativeSubmissions', rec.meta.deliverableId);
    } else {
      var n = taskDeliverables_(task.taskId).length + 1;
      d = dbInsert_('CreativeSubmissions', {
        deliverableId: task.taskId + '-D' + n, taskId: task.taskId, title: rec.meta.title, purpose: rec.meta.purpose,
        deliverableType: rec.meta.deliverableType || task.creativeType, status: DSTATUS.DRAFT, latestVersionNo: '0',
        latestVersionId: '', approvedVersionId: '', createdBy: user.email, createdAt: now, updatedAt: now
      });
    }
    // Only one unsubmitted draft per deliverable: an older draft is superseded.
    dbFind_('CreativeVersions', function (v) { return v.deliverableId === d.deliverableId && v.status === VSTATUS.DRAFT; })
      .forEach(function (v) { dbUpdate_('CreativeVersions', v.versionId, { status: VSTATUS.SUPERSEDED }); });

    var versionNo = Number(d.latestVersionNo || 0) + 1;
    var versionId = 'VER-' + uuid_();
    var niceName = d.deliverableId + '_V' + versionNo + '_' + rec.file.name;
    try { DriveApp.getFileById(file.id).setName(niceName); } catch (e) { console.warn('Rename failed: ' + e); }
    dbInsert_('CreativeVersions', {
      versionId: versionId, deliverableId: d.deliverableId, taskId: task.taskId, versionNo: String(versionNo),
      fileId: file.id, fileName: niceName, mimeType: rec.file.mime, sizeBytes: String(rec.file.size),
      note: rec.meta.note, uploadedBy: user.email, uploadedAt: now, status: VSTATUS.DRAFT, submittedAt: '', approvedFileId: ''
    });
    dbUpdate_('CreativeSubmissions', d.deliverableId, { latestVersionNo: String(versionNo), latestVersionId: versionId, updatedAt: now });
    logActivity_(task.taskId, user, 'upload', '', d.title + ' · V' + versionNo, rec.meta.note, 'team');
    if (task.status === STATUS.ASSIGNED) setStatus_(task, STATUS.IN_PROGRESS, user, 'First upload');
    return { versionId: versionId, deliverableId: d.deliverableId, versionNo: versionNo };
  });
}

/* ---------- internal file access (team only) ---------- */

/** Looks up a version/attachment file the current user may see. */
function assetRef_(u, kind, id) {
  if (kind === 'version') {
    var v = dbGet_('CreativeVersions', str_(id, 60, 'Version', true));
    if (!v) throw AppError_('NOT_FOUND', 'File not found.');
    requireTask_(u, v.taskId);
    return { fileId: v.fileId, mime: v.mimeType, size: v.sizeBytes, name: v.fileName };
  }
  if (kind === 'attachment') {
    var a = dbGet_('ReferenceFiles', str_(id, 60, 'Attachment', true));
    if (!a) throw AppError_('NOT_FOUND', 'File not found.');
    var task = a.taskId ? dbGet_('Tasks', a.taskId) : dbFind_('Tasks', function (t) {
      return t.requirementId === a.requirementId && (isLeader_(u) || t.assigneeEmail === u.email);
    })[0];
    if (!task) throw AppError_('NOT_FOUND', 'File not found.');
    requireTask_(u, task.taskId);
    return { fileId: a.fileId, mime: a.mimeType, size: a.sizeBytes, name: a.fileName };
  }
  throw AppError_('VALIDATION', 'Unknown file.');
}

/** Preview or original for a version/attachment the current user may see. */
function api_getAsset(kind, id, mode) {
  return respond_(function () {
    var u = currentUser_();
    var f = assetRef_(u, kind, id);
    if (mode === 'original') return originalOf_(f.fileId, f.name);
    if (mode === 'thumb') { var t = smallThumb_(f); return t ? { kind: 'thumbnail', dataUrl: t } : { kind: 'none' }; }
    var p = previewOf_(f.fileId, f.mime, f.size, 1600);
    if (mode === 'drive' && isLeader_(u)) { try { p.driveUrl = DriveApp.getFileById(f.fileId).getUrl(); } catch (e) { /* ignore */ } }
    return p;
  });
}

/** Many small thumbnails in one round trip. items: [{kind, id}] (max 24). Returns { "kind:id": dataUrl|null }. */
function api_getThumbs(items) {
  return respond_(function () {
    var u = currentUser_();
    var out = {};
    (Array.isArray(items) ? items : []).slice(0, 24).forEach(function (it) {
      var key = it.kind + ':' + it.id;
      try { out[key] = smallThumb_(assetRef_(u, it.kind, it.id)); } catch (e) { out[key] = null; }
    });
    return out;
  });
}

/** 480px thumbnail, cached for 6 hours (files never change once uploaded). */
function smallThumb_(f) {
  var cache = CacheService.getScriptCache(), key = 'th_' + f.fileId;
  var hit = cache.get(key);
  if (hit) return hit === '-' ? null : hit;
  var url = thumbnail_(f.fileId, 480);
  if (!url && INLINE_IMAGE_TYPES.indexOf(f.mime) !== -1 && Number(f.size) <= 300 * 1024) {
    var p = previewOf_(f.fileId, f.mime, f.size, 480); url = p.dataUrl || null;
  }
  try { cache.put(key, url && url.length < 95000 ? url : (url ? '' : '-'), 21600); } catch (e) { /* too big to cache */ }
  return url;
}
