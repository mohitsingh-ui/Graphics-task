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

/** "20% off / Meta ads" → "20% off/Meta ads" (max 3 levels, each part cleaned). '' if empty. */
function cleanPath_(p) {
  return String(p || '').split(/[\/>]+/).map(function (x) { return String(x).replace(/[\\:*?"<>|#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); })
    .filter(String).slice(0, 3).join('/');
}

/**
 * Where a creative is filed inside the request/campaign folder:
 * the folder the leader chose for the task, else the creative's category, else the task's category.
 */
function categoryOf_(task, d) {
  return cleanPath_(task && task.folderPath) || cleanPath_(d && d.deliverableType) || cleanPath_(task && task.creativeType) || 'Creatives';
}

/** Nested folders for a path like "20% off/Meta ads". */
function subPath_(root, path) {
  var f = root;
  String(path || 'Creatives').split('/').forEach(function (part) { if (part) f = subFolder_(f, part); });
  return f;
}

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
  var camp = campaignOf_(req);
  if (camp) return campaignFolder_(camp);          // campaign requests share the campaign's folder
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
    var cat = subPath_(root, categoryOf_(task, d));
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

/**
 * What a Drive link / zip covers: a campaign (id CMP-…, or any request/task that belongs to one)
 * or a single request. Returns { kind, req, campaign, tasks, title, label }.
 */
function finalScope_(u, id) {
  id = str_(id, 40, 'Request', true);
  var camp = /^CMP-/.test(id) ? dbGet_('Campaigns', id) : null, req = null;
  if (!camp) {
    req = dbGet_('Requirements', id);
    if (!req) { var t = dbGet_('Tasks', id); req = t && dbGet_('Requirements', t.requirementId); }
    if (!req) throw AppError_('NOT_FOUND', 'Request not found.');
    camp = campaignOf_(req);
  }
  var tasks = camp ? campaignTasks_(camp.campaignId)
    : dbFind_('Tasks', function (t) { return t.requirementId === req.requirementId && t.status !== STATUS.CANCELLED; });
  if (!camp && !req) throw AppError_('NOT_FOUND', 'Not found.');
  if (!isLeader_(u) && !tasks.some(function (t) { return t.assigneeEmail === u.email; })) throw AppError_('NOT_FOUND', 'Request not found.');
  return camp ? { kind: 'campaign', campaign: camp, req: req, tasks: tasks, title: camp.name, label: camp.name, id: camp.campaignId }
    : { kind: 'request', campaign: null, req: req, tasks: tasks, title: req.title, label: req.requirementId, id: req.requirementId };
}

function scopeFolder_(x) {
  return x.kind === 'campaign' ? campaignFolder_(dbGet_('Campaigns', x.campaign.campaignId)) : finalFolder_(dbGet_('Requirements', x.req.requirementId));
}

/** Puts every approved creative of these tasks into root / category (copies or moves as needed). Returns counts. */
function fileInto_(root, tasks) {
  var counts = {};
  approvedOf_(tasks).forEach(function (a) {
    var path = categoryOf_(a.task, a.d), cat = subPath_(root, path);
    counts[path] = (counts[path] || 0) + 1;
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
  return counts;
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
 * Makes sure every approved creative is in the folder (request or whole campaign) and,
 * if share is true, opens it to "anyone with the link (view)".
 */
function api_finalFolder(id, share) {
  return respond_(function () {
    var u = currentUser_();
    if (share && !isLeader_(u)) throw AppError_('FORBIDDEN', 'Only the team leader can share the folder publicly.');
    return withLock_(function () {
      var x = finalScope_(u, id), root = scopeFolder_(x);
      var counts = fileInto_(root, x.tasks);
      if (share) {
        try { root.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
        catch (e) {
          throw AppError_('DRIVE_SHARING', 'Google Drive didn’t allow a public link. In the Google Admin console, allow sharing outside rosierfoods.com (Apps → Google Workspace → Drive and Docs → Sharing settings), then try again.');
        }
        if (x.kind === 'campaign') dbUpdate_('Campaigns', x.campaign.campaignId, { shared: '1', updatedAt: nowIso_() });
        else dbUpdate_('Requirements', x.req.requirementId, { finalShared: '1', updatedAt: nowIso_() });
        if (x.tasks[0]) logActivity_(x.tasks[0].taskId, u, 'final_folder', '', 'shared', 'Final files folder shared (anyone with the link)', 'team');
      }
      var shared = x.kind === 'campaign' ? bool_(dbGet_('Campaigns', x.campaign.campaignId).shared) : bool_(dbGet_('Requirements', x.req.requirementId).finalShared);
      return {
        url: root.getUrl(), shared: shared, kind: x.kind, id: x.id, requirementId: x.req ? x.req.requirementId : '', title: x.title, label: x.label,
        campaignName: x.campaign ? x.campaign.name : '',
        requests: x.kind === 'campaign' ? campaignRequests_(x.campaign.campaignId).length : 1,
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
      var x = finalScope_(u, id);
      var folderId = x.kind === 'campaign' ? x.campaign.folderId : x.req.finalFolderId;
      if (folderId) { try { DriveApp.getFolderById(folderId).setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { /* ignore */ } }
      if (x.kind === 'campaign') dbUpdate_('Campaigns', x.campaign.campaignId, { shared: '', updatedAt: nowIso_() });
      else dbUpdate_('Requirements', x.req.requirementId, { finalShared: '', updatedAt: nowIso_() });
      return { shared: false };
    });
  });
}

/** Public link of a shared folder ('' if not shared) — the campaign's folder for campaign requests. */
function finalFolderUrl_(req) {
  if (!req) return '';
  var c = campaignOf_(req);
  var on = c ? bool_(c.shared) && c.folderId : bool_(req.finalShared) && req.finalFolderId;
  if (!on) return '';
  try { return DriveApp.getFolderById(c ? c.folderId : req.finalFolderId).getUrl(); } catch (e) { return ''; }
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
    var zip = Utilities.zip(blobs, cleanFolderName_(x.label + ' approved creatives') + '.zip');
    return { fileName: zip.getName(), mimeType: 'application/zip', base64: Utilities.base64Encode(zip.getBytes()), count: blobs.length };
  });
}

function finalSharedFlag_(r) { var c = campaignOf_(r); return c ? bool_(c.shared) && c.folderId : bool_(r.finalShared) && r.finalFolderId; }

/**
 * Leader: finished requests (every task completed), newest first, with what
 * was delivered and whether the Drive folder is shared. filter: { q, from, to }
 */
function api_listCompletedRequests(filter) {
  return respond_(function () {
    requireLeader_();
    filter = filter || {};
    var q = String(filter.q || '').toLowerCase().trim();
    var from = filter.from ? date_(filter.from, 'From') : '', to = filter.to ? date_(filter.to, 'To') : '';
    var byReq = {};
    dbAll_('Tasks').forEach(function (t) { if (t.status !== STATUS.CANCELLED) (byReq[t.requirementId] = byReq[t.requirementId] || []).push(t); });
    var dels = {}; dbAll_('CreativeSubmissions').forEach(function (d) { (dels[d.taskId] = dels[d.taskId] || []).push(d); });
    var out = [];
    dbAll_('Requirements').forEach(function (r) {
      var ts = byReq[r.requirementId] || [];
      if (!ts.length || !ts.every(function (t) { return t.status === STATUS.COMPLETED; })) return;
      var done = ts.map(function (t) { return t.completedAt; }).sort().pop() || '';
      var day = done ? isoDateOnly_(new Date(done)) : '';
      if ((from && day < from) || (to && day > to)) return;
      var cats = {}, approved = 0, rejected = 0;
      ts.forEach(function (t) {
        (dels[t.taskId] || []).forEach(function (d) {
          if (d.status === DSTATUS.REJECTED) { rejected++; return; }
          if (!d.approvedVersionId) return;
          approved++;
          var c = categoryOf_(t, d); cats[c] = (cats[c] || 0) + 1;
        });
      });
      var designers = ts.map(function (t) { return t.assigneeEmail ? displayName_(t.assigneeEmail) : ''; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
      var row = {
        requirementId: r.requirementId, title: r.title, department: r.department, requesterName: r.requesterName,
        submittedAt: r.submittedAt, completedAt: done, tasks: ts.length, firstTaskId: ts[0].taskId, designers: designers,
        approved: approved, rejected: rejected, categories: Object.keys(cats).sort().map(function (k) { return { name: k, count: cats[k] }; }),
        shared: !!finalSharedFlag_(r), hasFolder: !!(r.finalFolderId || (campaignOf_(r) || {}).folderId),
        campaignId: r.campaignId || '', campaignName: (campaignOf_(r) || {}).name || ''
      };
      if (q && [row.requirementId, row.title, row.department, row.requesterName, designers.join(' ')].join(' ').toLowerCase().indexOf(q) === -1) return;
      out.push(row);
    });
    out.sort(function (a, b) { return a.completedAt < b.completedAt ? 1 : -1; });
    return { rows: out.slice(0, 300), total: out.length };
  });
}
