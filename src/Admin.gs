/**
 * Admin.gs — team management, settings and Drive health (leader only),
 * plus the hourly maintenance job.
 */

/* ---------- team ---------- */

function api_listTeam() {
  return respond_(function () {
    requireLeader_();
    var tasks = dbAll_('Tasks');
    return {
      users: dbAll_('Users').map(function (x) {
        var mine = tasks.filter(function (t) { return t.assigneeEmail === x.email; });
        return Object.assign(pick_(x, ['userId', 'email', 'name', 'role', 'createdAt']), {
          active: bool_(x.active),
          activeTasks: mine.filter(function (t) { return CLOSED.indexOf(t.status) === -1 && t.status !== STATUS.APPROVED; }).length,
          completed: mine.filter(function (t) { return t.status === STATUS.COMPLETED; }).length
        });
      }),
      departments: dbAll_('Departments').map(function (d) { return { departmentId: d.departmentId, name: d.name, active: bool_(d.active) }; }),
      allowedDomain: settings_().allowedDomain
    };
  });
}

function api_saveUser(input) {
  return respond_(function () {
    var u = requireLeader_();
    input = input || {};
    var email = email_(input.email, 'Email', true);
    var name = str_(input.name, 100, 'Name', true);
    var role = oneOf_(String(input.role || ''), [ROLES.LEADER, ROLES.DESIGNER], 'Role');
    var domain = settings_().allowedDomain;
    if (domain && email.split('@')[1] !== domain.toLowerCase()) {
      throw AppError_('VALIDATION', 'Team members must use an @' + domain + ' Google account, because the internal portal only lets in your Workspace domain.');
    }
    return withLock_(function () {
      var existing = userByEmail_(email);
      if (existing) {
        if (existing.email === u.email && role !== ROLES.LEADER) throw AppError_('VALIDATION', 'You can’t remove your own leader role.');
        dbUpdate_('Users', existing.userId, { name: name, role: role, updatedAt: nowIso_() });
      } else {
        dbInsert_('Users', { userId: 'USR-' + uuid_().slice(0, 8), email: email, name: name, role: role, active: true,
          createdAt: nowIso_(), updatedAt: nowIso_() });
        var s = settings_();
        if (s.internalUrl) sendMail_(email, 'You’ve been added to the graphics team portal',
          'Hi ' + name + ',\n\n' + u.name + ' added you to the ' + s.portalName + ' as ' + (role === ROLES.LEADER ? 'a team leader' : 'a designer') +
          '.\nSign in with your company Google account.', { label: 'Open the portal', url: s.internalUrl });
      }
      syncDriveAccess_(email, role, true);
      return true;
    });
  });
}

function api_setUserActive(email, active) {
  return respond_(function () {
    var u = requireLeader_();
    email = email_(email, 'Email', true);
    if (email === u.email) throw AppError_('VALIDATION', 'You can’t deactivate yourself.');
    return withLock_(function () {
      var x = userByEmail_(email);
      if (!x) throw AppError_('NOT_FOUND', 'User not found.');
      if (!active && x.role === ROLES.LEADER && leaderEmails_().length <= 1) throw AppError_('VALIDATION', 'There must be at least one active team leader.');
      dbUpdate_('Users', x.userId, { active: !!active, updatedAt: nowIso_() });
      syncDriveAccess_(email, x.role, !!active);
      return { openTasks: dbFind_('Tasks', function (t) { return t.assigneeEmail === email && CLOSED.indexOf(t.status) === -1; }).length };
    });
  });
}

/** Leaders get editor access to the Drive root so they can manage folders. Designers get none. */
function syncDriveAccess_(email, role, active) {
  try {
    var root = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID'));
    var isEditor = root.getEditors().some(function (e) { return e.getEmail().toLowerCase() === email; });
    if (active && role === ROLES.LEADER && !isEditor) root.addEditor(email);
    if ((!active || role !== ROLES.LEADER) && isEditor && email !== Session.getEffectiveUser().getEmail().toLowerCase()) root.removeEditor(email);
  } catch (e) { console.warn('Drive access sync failed for ' + email + ': ' + e); }
}

function api_saveDepartment(input) {
  return respond_(function () {
    requireLeader_();
    input = input || {};
    var name = str_(input.name, 100, 'Department', true);
    return withLock_(function () {
      if (input.departmentId) {
        if (!dbGet_('Departments', input.departmentId)) throw AppError_('NOT_FOUND', 'Department not found.');
        dbUpdate_('Departments', input.departmentId, { name: name, active: input.active !== false });
      } else {
        if (dbFind_('Departments', function (d) { return d.name.toLowerCase() === name.toLowerCase(); }).length) throw AppError_('VALIDATION', 'That department already exists.');
        dbInsert_('Departments', { departmentId: 'DEP-' + uuid_().slice(0, 8), name: name, active: true, createdAt: nowIso_() });
      }
      return true;
    });
  });
}

/* ---------- settings ---------- */

function api_getSettings() {
  return respond_(function () {
    requireLeader_();
    var s = settings_();
    var quota = null;
    try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { quota = null; }
    var out = {};
    Object.keys(EDITABLE_SETTINGS).forEach(function (k) { out[k] = s[k]; });
    var props = PropertiesService.getScriptProperties();
    return {
      settings: out,
      drive: driveHealth_(),
      databaseUrl: SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID')).getUrl(),
      mailQuotaRemaining: quota,
      statuses: STATUS_ORDER,
      transitions: MANUAL_TRANSITIONS
    };
  });
}

function api_saveSettings(patch) {
  return respond_(function () {
    var u = requireLeader_();
    patch = patch || {};
    var clean = {};
    Object.keys(patch).forEach(function (k) {
      var type = EDITABLE_SETTINGS[k];
      if (!type) return;
      var v = patch[k];
      if (Array.isArray(type)) clean[k] = oneOf_(String(v), type, k);
      else if (type === 'boolean') clean[k] = !!v;
      else if (type === 'number') clean[k] = int_(v, 0, 100000, k);
      else if (type === 'url') { v = str_(v, 500, k, false); if (v && !/^https:\/\/[^\s<>"']+$/.test(v)) throw AppError_('VALIDATION', k + ' must be an https:// link.'); clean[k] = v; }
      else if (type === 'list') {
        var list = (Array.isArray(v) ? v : String(v).split(',')).map(function (x) { return String(x).trim(); }).filter(String);
        if (!list.length) throw AppError_('VALIDATION', k + ' can’t be empty.');
        clean[k] = list.map(function (x) { return str_(x, 50, k, true); });
        if (k === 'allowedExtensions' || k === 'publicExtensions') clean[k] = clean[k].map(function (x) { return x.toLowerCase().replace(/^\./, ''); });
      } else if (type === 'json') {
        var parsed = typeof v === 'string' ? parseJson_(v, null) : v;
        clean[k] = validateCreativeTypes_(parsed);
      } else clean[k] = str_(v, 200, k, false);
    });
    if (clean.tokenExpiryDays !== undefined && (clean.tokenExpiryDays < 1 || clean.tokenExpiryDays > 90)) throw AppError_('VALIDATION', 'Link expiry must be 1–90 days.');
    if (clean.maxUploadMB !== undefined && clean.maxUploadMB > 2000) throw AppError_('VALIDATION', 'Max upload must be 2000 MB or less.');
    return withLock_(function () {
      Object.keys(clean).forEach(function (k) {
        setSettingRaw_(k, typeof clean[k] === 'object' ? JSON.stringify(clean[k]) : String(clean[k]));
      });
      return { saved: Object.keys(clean) };
    });
  });
}

function validateCreativeTypes_(list) {
  if (!Array.isArray(list) || !list.length) throw AppError_('VALIDATION', 'Creative types must be a non-empty list.');
  var ids = {};
  return list.map(function (t) {
    var id = str_(t.id, 40, 'Type id', true);
    if (!/^[a-z0-9_]+$/.test(id) || ids[id]) throw AppError_('VALIDATION', 'Type ids must be unique, lowercase, letters/numbers/underscores.');
    ids[id] = true;
    return {
      id: id, label: str_(t.label, 80, 'Type label', true),
      fields: (t.fields || []).map(function (f) {
        var type = oneOf_(String(f.type || 'text'), ['text', 'textarea', 'number', 'select'], 'Field type');
        var o = { key: str_(f.key, 40, 'Field key', true), label: str_(f.label, 80, 'Field label', true), type: type, required: !!f.required };
        if (!/^[a-zA-Z0-9_]+$/.test(o.key)) throw AppError_('VALIDATION', 'Field keys must be letters/numbers/underscores.');
        if (type === 'select') {
          o.options = (f.options || []).map(function (x) { return str_(x, 80, 'Option', true); });
          if (!o.options.length) throw AppError_('VALIDATION', 'Select field "' + o.label + '" needs options.');
        }
        return o;
      })
    };
  });
}

/* ---------- maintenance (time-driven trigger) ---------- */

/**
 * Runs hourly: deadline reminders, overdue alerts, and any requirement
 * whose leader notification was missed (e.g. the requester closed the tab
 * before attachments finished).
 */
function hourlyMaintenance(e) {
  // Only runs from its own installed trigger (or the owner in the editor).
  var fromTrigger = e && e.triggerUid && ScriptApp.getProjectTriggers().some(function (t) { return t.getUniqueId() === e.triggerUid; });
  if (!fromTrigger) guardOwner_();
  withLock_(function () {
    var s = settings_();
    var now = Date.now();
    var leaders = leaderEmails_();

    dbFind_('Requirements', function (r) { return !r.notifiedAt && now - new Date(r.submittedAt).getTime() > 20 * 60000; })
      .forEach(function (r) { notifyNewRequirement_(r.requirementId); });

    dbAll_('Tasks').forEach(function (t) {
      if (!t.assigneeEmail || !t.dueDate) return;
      if ([STATUS.COMPLETED, STATUS.CANCELLED, STATUS.APPROVED, STATUS.ON_HOLD].indexOf(t.status) !== -1) return;
      var end = dueEnd_(t.dueDate);
      if (!end) return;
      var left = end.getTime() - now;
      if (left < 0 && !t.overdueNotifiedAt) {
        dbUpdate_('Tasks', t.taskId, { overdueNotifiedAt: nowIso_() });
        logActivity_(t.taskId, 'system', 'overdue', '', '', 'Past due date ' + t.dueDate, 'team');
        notify_([t.assigneeEmail].concat(leaders), 'task_overdue', 'Overdue: ' + t.title, t.taskId + ' was due on ' + t.dueDate + '.', 'task/' + t.taskId);
      } else if (left >= 0 && left <= s.dueSoonHours * 3600000 && !t.dueSoonNotifiedAt) {
        dbUpdate_('Tasks', t.taskId, { dueSoonNotifiedAt: nowIso_() });
        notify_([t.assigneeEmail], 'task_due_soon', 'Due soon: ' + t.title, t.taskId + ' is due on ' + t.dueDate + '.', 'task/' + t.taskId);
      }
    });
  });
}
