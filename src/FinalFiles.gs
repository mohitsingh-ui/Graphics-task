/**
 * FinalFiles.gs — every request gets one Drive folder holding all of its
 * approved creatives, even when the work was divided between designers:
 *
 *   03_Approved_Creatives / 2026 / REQ-2026-0012 — Diwali sale /
 *        Meta ads / …   Website banners / …   Listing images / …
 *
 * The leader can make the folder "anyone with the link can view" so people
 * outside the portal download straight from Drive, with no login. Replaced
 * approvals move to an "Older versions" sub-folder.
 */

function cleanFolderName_(s) { return String(s || '').replace(/[\\/:*?"<>|#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Creatives'; }

function categoryOf_(task, d) { return cleanFolderName_((d && d.deliverableType) || (task && task.creativeType) || 'Creatives'); }

/** Gets / creates a named sub-folder (cached by parent + name). */
function subFolder_(parent, name) {
  name = cleanFolderName_(name);
  var key = 'sf_' + sha256_(parent.getId() + '/' + name), cache = CacheService.getScriptCache(), id = cache.get(key);
  if (id) { try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* recreate */ } }
  var it = parent.getFoldersByName(name);
  var folder = it.hasNext() ? it.next() : parent.createFolder(name);
  cache.put(key, folder.getId(), 21600);
  return folder;
}

/** The request's final-files folder (created on first use). Caller holds the lock. */
function finalFolder_(req) {
  if (req.finalFolderId) {
    try { var f = DriveApp.getFolderById(req.finalFolderId); if (!f.isTrashed()) return f; } catch (e) { /* recreate */ }
  }
  var year = String(req.submittedAt || nowIso_()).slice(0, 4);
  var parent = DriveApp.getFolderById(ensureFolderId_('approved', [year]));
  var folder = parent.createFolder(cleanFolderName_(req.requirementId + ' — ' + (req.title || 'Request')));
  dbUpdate_('Requirements', req.requirementId, { finalFolderId: folder.getId(), updatedAt: nowIso_() });
  return folder;
}

function approvedName_(d, v) { return cleanFolderName_((d.title || 'Creative') + ' V' + v.versionNo) + (extOf_(v.fileName) ? '.' + extOf_(v.fileName) : ''); }

/** Copies an approved version into REQ folder / category. Earlier approved copy of the same creative → "Older versions". */
function fileApprovedCopy_(task, d, v) {
  try {
    var req = dbGet_('Requirements', task.requirementId);
    var root = req ? finalFolder_(req) : DriveApp.getFolderById(ensureFolderId_('approved', [String(new Date().getFullYear()), task.taskId]));
    var cat = subFolder_(root, categoryOf_(task, d));
    if (d.approvedVersionId && d.approvedVersionId !== v.versionId) {
      var old = dbGet_('CreativeVersions', d.approvedVersionId);
      if (old && old.approvedFileId) { try { DriveApp.getFileById(old.approvedFileId).moveTo(subFolder_(cat, 'Older versions')); } catch (e) { /* gone */ } }
    }
    return DriveApp.getFileById(v.fileId).makeCopy(approvedName_(d, v), cat).getId();
  } catch (e) {
    console.warn('Approved copy failed for ' + v.versionId + ': ' + e);
    return '';
  }
}

/** Request for a requirement id or a task id, plus the caller's access check. */
function finalScope_(u, id) {
  id = str_(id, 40, 'Request', true);
  var req = dbGet_('Requirements', id);
  if (!req) { var t = dbGet_('Tasks', id); req = t && dbGet_('Requirements', t.requirementId); }
  if (!req) throw AppError_('NOT_FOUND', 'Request not found.');
  var tasks = dbFind_('Tasks', function (t) { return t.requirementId === req.requirementId && t.status !== STATUS.CANCELLED; });
  if (!isLeader_(u) && !tasks.some(function (t) { return t.assigneeEmail === u.email; })) throw AppError_('NOT_FOUND', 'Request not found.');
  return { req: req, tasks: tasks };
}

/** Every approved creative in the request: [{task, d, v}]. */
function approvedOf_(tasks) {
  var out = [];
  tasks.forEach(function (t) {
    taskDeliverables_(t.taskId).forEach(function (d) {
      if (d.status !== DSTATUS.APPROVED && !d.approvedVersionId) return;
      var v = d.approvedVersionId && dbGet_('CreativeVersions', d.approvedVersionId);
      if (v && v.status === VSTATUS.APPROVED) out.push({ task: t, d: d, v: v });
    });
  });
  return out;
}

/**
 * Makes sure every approved creative of the request is in its folder (fixes
 * older approvals that were filed elsewhere) and, if share is true, opens the
 * folder to "anyone with the link (view)".
 */
function api_finalFolder(id, share) {
  return respond_(function () {
    var u = currentUser_();
    if (share && !isLeader_(u)) throw AppError_('FORBIDDEN', 'Only the team leader can share the folder publicly.');
    return withLock_(function () {
      var x = finalScope_(u, id), req = x.req;
      var root = finalFolder_(dbGet_('Requirements', req.requirementId));
      var counts = {};
      approvedOf_(x.tasks).forEach(function (a) {
        var cat = subFolder_(root, categoryOf_(a.task, a.d));
        counts[cat.getName()] = (counts[cat.getName()] || 0) + 1;
        var ok = false;
        if (a.v.approvedFileId) {
          try {
            var f = DriveApp.getFileById(a.v.approvedFileId), p = f.getParents();
            if (!p.hasNext() || p.next().getId() !== cat.getId()) f.moveTo(cat);
            ok = true;
          } catch (e) { ok = false; }
        }
        if (!ok) {
          try {
            var copy = DriveApp.getFileById(a.v.fileId).makeCopy(approvedName_(a.d, a.v), cat);
            dbUpdate_('CreativeVersions', a.v.versionId, { approvedFileId: copy.getId() });
          } catch (e) { console.warn('Could not file ' + a.v.versionId + ': ' + e); }
        }
      });
      if (share) {
        try { root.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
        catch (e) {
          throw AppError_('DRIVE_SHARING', 'Google Drive didn’t allow a public link. In the Google Admin console, allow sharing outside rosierfoods.com (Apps → Google Workspace → Drive and Docs → Sharing settings), then try again.');
        }
        dbUpdate_('Requirements', req.requirementId, { finalShared: '1', updatedAt: nowIso_() });
        if (x.tasks[0]) logActivity_(x.tasks[0].taskId, u, 'final_folder', '', 'shared', 'Final files folder shared (anyone with the link)', 'team');
      }
      return {
        url: root.getUrl(), shared: share ? true : bool_(dbGet_('Requirements', req.requirementId).finalShared),
        requirementId: req.requirementId, title: req.title,
        categories: Object.keys(counts).sort().map(function (k) { return { name: k, count: counts[k] }; }),
        total: Object.keys(counts).reduce(function (s, k) { return s + counts[k]; }, 0)
      };
    });
  });
}

function api_unshareFinalFolder(id) {
  return respond_(function () {
    var u = requireLeader_();
    return withLock_(function () {
      var req = finalScope_(u, id).req;
      if (req.finalFolderId) { try { DriveApp.getFolderById(req.finalFolderId).setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { /* ignore */ } }
      dbUpdate_('Requirements', req.requirementId, { finalShared: '', updatedAt: nowIso_() });
      return { shared: false };
    });
  });
}

/** Public link of a shared folder ('' if not shared). */
function finalFolderUrl_(req) {
  if (!req || !bool_(req.finalShared) || !req.finalFolderId) return '';
  try { return DriveApp.getFolderById(req.finalFolderId).getUrl(); } catch (e) { return ''; }
}

/** All approved creatives of a request (or one task) as a .zip, in category folders. */
function api_downloadApprovedZip(id, taskOnly) {
  return respond_(function () {
    var u = currentUser_();
    var x = finalScope_(u, id);
    var tasks = taskOnly ? x.tasks.filter(function (t) { return t.taskId === id; }) : x.tasks;
    var list = approvedOf_(tasks);
    if (!list.length) throw AppError_('VALIDATION', 'No approved creatives yet.');
    var total = 0, blobs = [], seen = {};
    list.forEach(function (a) {
      var f = fileOrNull_(a.v.approvedFileId) || fileOrNull_(a.v.fileId);
      if (!f) return;
      total += f.getSize();
      if (total > 45 * 1024 * 1024) throw AppError_('TOO_LARGE', 'These files are over 45 MB together — use “Drive link” and download the folder from Drive instead.');
      var name = categoryOf_(a.task, a.d) + '/' + approvedName_(a.d, a.v);
      if (seen[name]) name = name.replace(/(\.[^.]+)?$/, ' (' + (++seen[name]) + ')$1'); else seen[name] = 1;
      blobs.push(f.getBlob().setName(name));
    });
    var zip = Utilities.zip(blobs, cleanFolderName_(x.req.requirementId + ' approved creatives') + '.zip');
    return { fileName: zip.getName(), mimeType: 'application/zip', base64: Utilities.base64Encode(zip.getBytes()), count: blobs.length };
  });
}
