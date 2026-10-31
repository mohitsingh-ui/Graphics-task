/**
 * Campaigns.gs — group work under one name (e.g. "Diwali Sale").
 *
 * A campaign collects requests from any department plus tasks the leader
 * assigns directly. Every approved creative of every request in the campaign
 * is filed into ONE Drive folder, sorted by category:
 *
 *   03_Approved_Creatives / Campaigns / Diwali Sale /
 *        Meta ads / …   Listing images / …   Website banners / …
 *
 * One public link to that folder gives anyone (e.g. the tech team) every
 * creative, whoever made it and whoever asked for it.
 */

function campaignOf_(req) { return req && req.campaignId ? dbGet_('Campaigns', req.campaignId) : null; }

/** The campaign's Drive folder (created on first use). Caller holds the lock. */
function campaignFolder_(c) {
  if (c.folderId) { try { var f = DriveApp.getFolderById(c.folderId); if (!f.isTrashed()) return f; } catch (e) { /* recreate */ } }
  var parent = DriveApp.getFolderById(ensureFolderId_('approved', ['Campaigns']));
  var folder = parent.createFolder(cleanFolderName_(c.name));
  dbUpdate_('Campaigns', c.campaignId, { folderId: folder.getId(), updatedAt: nowIso_() });
  return folder;
}

function campaignRequests_(campaignId) { return dbFind_('Requirements', function (r) { return r.campaignId === campaignId; }); }

function campaignTasks_(campaignId) {
  var ids = {}; campaignRequests_(campaignId).forEach(function (r) { ids[r.requirementId] = true; });
  return dbFind_('Tasks', function (t) { return ids[t.requirementId] && t.status !== STATUS.CANCELLED; });
}

/** Approved creatives per category for a set of tasks. */
function categoryCounts_(tasks) {
  var cats = {}, approved = 0;
  approvedOf_(tasks).forEach(function (a) { var c = categoryOf_(a.task, a.d); cats[c] = (cats[c] || 0) + 1; approved++; });
  return { approved: approved, categories: Object.keys(cats).sort().map(function (k) { return { name: k, count: cats[k] }; }) };
}

function campaignDto_(c, withDetail) {
  var reqs = campaignRequests_(c.campaignId), tasks = campaignTasks_(c.campaignId), cc = categoryCounts_(tasks);
  var o = {
    campaignId: c.campaignId, name: c.name, active: bool_(c.active), shared: bool_(c.shared) && !!c.folderId, createdAt: c.createdAt,
    requests: reqs.length, tasks: tasks.length, done: tasks.filter(function (t) { return t.status === STATUS.COMPLETED; }).length,
    required: tasks.reduce(function (s, t) { return s + (Number(t.deliverablesRequired) || 0); }, 0),
    approved: cc.approved, categories: cc.categories,
    departments: reqs.map(function (r) { return r.department; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; })
  };
  if (withDetail) {
    o.requestList = reqs.map(function (r) {
      var ts = tasks.filter(function (t) { return t.requirementId === r.requirementId; });
      return { requirementId: r.requirementId, title: r.title, department: r.department, requesterName: r.requesterName, submittedAt: r.submittedAt,
        internal: !!r.submittedBy && !r.email && r.department === 'Graphics team', firstTaskId: ts[0] ? ts[0].taskId : '',
        status: ts.length ? requesterStatus_(ts) : 'Received', approved: categoryCounts_(ts).approved,
        required: ts.reduce(function (s, t) { return s + (Number(t.deliverablesRequired) || 0); }, 0) };
    }).sort(function (a, b) { return a.submittedAt < b.submittedAt ? 1 : -1; });
    var dc = {}; dbAll_('CreativeSubmissions').forEach(function (d) { (dc[d.taskId] = dc[d.taskId] || []).push(d); });
    o.taskList = tasks.map(function (t) {
      var ds = dc[t.taskId] || [];
      return { taskId: t.taskId, title: t.title, status: t.status, category: t.creativeType || '', assigneeName: t.assigneeEmail ? displayName_(t.assigneeEmail) : '',
        required: Number(t.deliverablesRequired) || 0, approved: ds.filter(function (d) { return d.approvedVersionId && d.status !== DSTATUS.REJECTED; }).length,
        dueDate: t.dueDate, dueTime: t.dueTime, requirementId: t.requirementId, overdue: isOverdue_(t), hold: t.status === STATUS.ON_HOLD };
    }).sort(function (a, b) { return a.dueDate > b.dueDate ? 1 : -1; });
  }
  return o;
}

function api_listCampaigns() {
  return respond_(function () {
    requireLeader_();
    return dbAll_('Campaigns').map(function (c) { return campaignDto_(c, false); })
      .sort(function (a, b) { return (b.active - a.active) || (a.createdAt < b.createdAt ? 1 : -1); });
  });
}

function api_getCampaign(campaignId) {
  return respond_(function () {
    requireLeader_();
    var c = dbGet_('Campaigns', str_(campaignId, 40, 'Campaign', true));
    if (!c) throw AppError_('NOT_FOUND', 'Campaign not found.');
    var out = campaignDto_(c, true);
    // Requests not in any campaign yet, to add with one click.
    out.addable = dbFind_('Requirements', function (r) { return !r.campaignId; })
      .sort(function (a, b) { return a.submittedAt < b.submittedAt ? 1 : -1; }).slice(0, 100)
      .map(function (r) { return { requirementId: r.requirementId, title: r.title, department: r.department }; });
    return out;
  });
}

function api_saveCampaign(input) {
  return respond_(function () {
    var u = requireLeader_();
    input = input || {};
    var name = str_(input.name, 80, 'Campaign name', true);
    return withLock_(function () {
      var dup = dbFind_('Campaigns', function (c) { return c.name.toLowerCase() === name.toLowerCase() && c.campaignId !== input.campaignId; })[0];
      if (dup) throw AppError_('VALIDATION', 'There is already a campaign called “' + dup.name + '”.');
      if (input.campaignId) {
        var c = dbGet_('Campaigns', input.campaignId);
        if (!c) throw AppError_('NOT_FOUND', 'Campaign not found.');
        dbUpdate_('Campaigns', c.campaignId, { name: name, active: input.active === undefined ? c.active : !!input.active, updatedAt: nowIso_() });
        if (c.folderId && c.name !== name) { try { DriveApp.getFolderById(c.folderId).setName(cleanFolderName_(name)); } catch (e) { /* ignore */ } }
        return campaignDto_(dbGet_('Campaigns', c.campaignId), false);
      }
      var row = dbInsert_('Campaigns', { campaignId: 'CMP-' + uuid_().slice(0, 8).toUpperCase(), name: name, folderId: '', shared: '', active: true,
        createdBy: u.email, createdAt: nowIso_(), updatedAt: nowIso_() });
      return campaignDto_(row, false);
    });
  });
}

/** Moves a request (and its approved files) into a campaign, or out of it with campaignId ''. */
function api_setRequestCampaign(id, campaignId) {
  return respond_(function () {
    var u = requireLeader_();
    return withLock_(function () {
      var req = dbGet_('Requirements', str_(id, 40, 'Request', true));
      if (!req) { var t = dbGet_('Tasks', id); req = t && dbGet_('Requirements', t.requirementId); }
      if (!req) throw AppError_('NOT_FOUND', 'Request not found.');
      var c = null;
      if (campaignId) { c = dbGet_('Campaigns', str_(campaignId, 40, 'Campaign', true)); if (!c) throw AppError_('NOT_FOUND', 'Campaign not found.'); }
      if ((req.campaignId || '') === (c ? c.campaignId : '')) return { campaignId: req.campaignId || '' };
      dbUpdate_('Requirements', req.requirementId, { campaignId: c ? c.campaignId : '', updatedAt: nowIso_() });
      var tasks = dbFind_('Tasks', function (t) { return t.requirementId === req.requirementId && t.status !== STATUS.CANCELLED; });
      // Re-file already-approved creatives into the new place.
      fileInto_(finalFolder_(dbGet_('Requirements', req.requirementId)), tasks);
      tasks.forEach(function (t) { logActivity_(t.taskId, u, 'campaign', '', c ? c.name : '', c ? 'Added to campaign “' + c.name + '”' : 'Removed from campaign', 'team'); });
      return { campaignId: c ? c.campaignId : '' };
    });
  });
}
