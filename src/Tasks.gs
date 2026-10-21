/**
 * Tasks.gs — task workflow, dashboards and task detail.
 *
 * Status rules
 * ------------
 * Manual moves (see MANUAL_TRANSITIONS in Config.gs) are made by the leader;
 * a designer may only move Assigned → In Progress (also triggered by setting
 * progress above 0%). Everything from "Submitted for Approval" onwards is
 * driven by the system from creative submissions and review decisions
 * (recomputeTaskStatus_). A task becomes Completed only when every required
 * deliverable is approved — or when a leader overrides with a reason.
 */

/* ---------- system status engine ---------- */

function taskDeliverables_(taskId) {
  return dbFind_('CreativeSubmissions', function (d) { return d.taskId === taskId; });
}

/** Re-derive the task status from its deliverables. Caller holds the lock. */
function recomputeTaskStatus_(taskId, actor) {
  var task = dbGet_('Tasks', taskId);
  if (!task) return null;
  if ([STATUS.ON_HOLD, STATUS.CANCELLED, STATUS.COMPLETED].indexOf(task.status) !== -1) return task.status;
  if (PRE_ASSIGN.indexOf(task.status) !== -1) return task.status;

  var dels = taskDeliverables_(taskId);
  var required = Math.max(1, Number(task.deliverablesRequired) || 1);
  var approved = dels.filter(function (d) { return d.status === DSTATUS.APPROVED; }).length;
  var changes = dels.filter(function (d) { return d.status === DSTATUS.CHANGES; }).length;
  var awaiting = dels.filter(function (d) { return d.status === DSTATUS.AWAITING; });

  var next = task.status;
  if (approved >= required && changes === 0 && awaiting.length === 0) next = STATUS.APPROVED;
  else if (changes > 0) next = STATUS.CHANGES;
  else if (awaiting.length > 0) {
    var anyRevision = awaiting.some(function (d) { return Number(d.latestVersionNo) > 1; }) ||
      task.status === STATUS.CHANGES || task.status === STATUS.RESUBMITTED;
    next = anyRevision ? STATUS.RESUBMITTED : STATUS.SUBMITTED;
  } else if (dels.length > 0 || Number(task.progress) > 0) next = STATUS.IN_PROGRESS;

  if (next !== task.status) {
    setStatus_(task, next, actor || 'system', 'Updated automatically');
    task = dbGet_('Tasks', taskId);
  }
  if (task.status === STATUS.APPROVED && settings_().autoCompleteOnApproval) {
    completeTask_(task, actor || 'system', 'All ' + required + ' deliverable(s) approved');
  }
  return dbGet_('Tasks', taskId).status;
}

function setStatus_(task, to, actor, note) {
  var patch = { status: to, updatedAt: nowIso_() };
  if (to === STATUS.ON_HOLD) patch.prevStatus = task.status;
  if (to !== STATUS.COMPLETED && task.status === STATUS.COMPLETED) patch.completedAt = '';
  dbUpdate_('Tasks', task.taskId, patch);
  logActivity_(task.taskId, actor, 'status', task.status, to, note || '', 'team');
}

function completeTask_(task, actor, note) {
  dbUpdate_('Tasks', task.taskId, { status: STATUS.COMPLETED, completedAt: nowIso_(), progress: '100', updatedAt: nowIso_() });
  logActivity_(task.taskId, actor, 'status', task.status, STATUS.COMPLETED, note || '', 'team');
  var to = leaderEmails_();
  if (task.assigneeEmail) to.push(task.assigneeEmail);
  notify_(to, 'task_completed', 'Completed: ' + task.title, task.taskId + ' is complete. ' + (note || ''), 'task/' + task.taskId);
  var req = dbGet_('Requirements', task.requirementId);
  if (req) {
    var open = dbFind_('Tasks', function (t) {
      return t.requirementId === req.requirementId && CLOSED.indexOf(t.status) === -1 && t.taskId !== task.taskId;
    });
    if (open.length === 0) {
      dbUpdate_('Requirements', req.requirementId, { status: 'Completed', updatedAt: nowIso_() });
      if (settings_().emailNotifications) {
        var finals = dbFind_('Tasks', function (t) { return t.requirementId === req.requirementId && t.finalLink; })
          .map(function (t) { return t.finalLink; });
        if (task.finalLink && finals.indexOf(task.finalLink) === -1) finals.push(task.finalLink);
        var track = trackUrl_(issueTrackToken_(req.email));
        sendMail_(req.email, 'Your creative is ready (' + req.requirementId + ')',
          'Hi ' + req.requesterName + ',\n\nAll creatives for "' + req.title + '" are approved and complete.\n\n' +
          (finals.length ? 'Download the final files:\n' + finals.join('\n') : 'The graphics team will add the final files link shortly — it will appear on your requests page.') +
          '\n\nYour requests: ' + track, finals.length ? { label: 'Download final files', url: finals[0] } : { label: 'See my requests', url: track });
      }
    }
  }
}

/* ---------- DTOs ---------- */

var TASK_FIELDS_ALL = ['taskId', 'requirementId', 'title', 'brief', 'creativeType', 'purpose', 'campaign', 'product',
  'deliverablesRequired', 'dimensions', 'formats', 'copyText', 'referenceUrls', 'startDate', 'dueDate', 'dueTime', 'finalLink', 'priority',
  'status', 'progress', 'instructions', 'assignedAt', 'completedAt', 'createdAt', 'updatedAt'];

function taskDto_(t, user, extra) {
  var o = pick_(t, TASK_FIELDS_ALL);
  o.overdue = isOverdue_(t);
  o.referenceUrls = t.referenceUrls ? t.referenceUrls.split('\n') : [];
  if (isLeader_(user)) {
    o.assigneeEmail = t.assigneeEmail;
    o.assigneeName = t.assigneeEmail ? displayName_(t.assigneeEmail) : '';
    o.assignedBy = t.assignedBy;
    o.internalNotes = t.internalNotes;
    o.prevStatus = t.prevStatus;
  }
  if (extra) Object.assign(o, extra);
  return o;
}

function deliverableCounts_(taskId) {
  var dels = taskDeliverables_(taskId);
  return {
    deliverablesSubmitted: dels.length,
    deliverablesApproved: dels.filter(function (d) { return d.status === DSTATUS.APPROVED; }).length
  };
}

/* ---------- dashboards ---------- */

function api_bootstrap() {
  return respond_(function () {
    var u = currentUser_();
    var s = settings_();
    return {
      user: { email: u.email, name: u.name, role: u.role },
      companyName: s.companyName, portalName: s.portalName,
      priorities: s.priorities, statuses: STATUS_ORDER, progressSteps: PROGRESS_STEPS,
      creativeTypes: s.creativeTypes.map(function (t) { return { id: t.id, label: t.label }; }),
      chunkBytes: LIMITS.CHUNK_BYTES, maxUploadMB: s.maxUploadMB, extensions: s.allowedExtensions,
      workloadThreshold: s.workloadThreshold, brandGuidelinesUrl: s.brandGuidelinesUrl,
      publicUrl: s.publicUrl, internalUrl: s.internalUrl
    };
  });
}

function api_leaderDashboard() {
  return respond_(function () {
    var u = requireLeader_();
    var tasks = dbAll_('Tasks');
    var count = function (f) { return tasks.filter(f).length; };
    var monthStart = isoDateOnly_().slice(0, 7);
    var kpis = {
      newRequirements: count(function (t) { return t.status === STATUS.NEW; }),
      unassigned: count(function (t) { return PRE_ASSIGN.indexOf(t.status) !== -1; }),
      inProgress: count(function (t) { return t.status === STATUS.ASSIGNED || t.status === STATUS.IN_PROGRESS; }),
      awaitingApproval: count(function (t) { return t.status === STATUS.SUBMITTED || t.status === STATUS.RESUBMITTED; }),
      revisions: count(function (t) { return t.status === STATUS.CHANGES; }),
      completed: count(function (t) { return t.status === STATUS.COMPLETED; }),
      completedThisMonth: count(function (t) { return t.status === STATUS.COMPLETED && String(t.completedAt).slice(0, 7) === monthStart; }),
      overdue: count(isOverdue_)
    };
    var byNewest = function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; };
    var reqs = dbAll_('Requirements');
    var reqMap = {}; reqs.forEach(function (r) { reqMap[r.requirementId] = r; });
    var withReq = function (t) {
      var r = reqMap[t.requirementId] || {};
      return taskDto_(t, u, { requesterName: r.requesterName || '', department: r.department || '' });
    };

    var designers = dbFind_('Users', function (x) { return bool_(x.active); });
    var s = settings_();
    var workload = designers.map(function (d) {
      var mine = tasks.filter(function (t) { return t.assigneeEmail === d.email && CLOSED.indexOf(t.status) === -1 && t.status !== STATUS.APPROVED; });
      return {
        email: d.email, name: d.name, role: d.role,
        active: mine.filter(function (t) { return t.status !== STATUS.ON_HOLD; }).length,
        overdue: mine.filter(isOverdue_).length,
        awaiting: mine.filter(function (t) { return t.status === STATUS.SUBMITTED || t.status === STATUS.RESUBMITTED; }).length,
        overloaded: mine.length >= s.workloadThreshold
      };
    }).filter(function (w) { return w.role === ROLES.DESIGNER || w.active > 0; })
      .sort(function (a, b) { return b.active - a.active; });

    var pendingApprovals = dbFind_('ApprovalRequests', function (r) { return r.status === 'Open'; })
      .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }).slice(0, 8)
      .map(function (r) { return approvalRowDto_(r); });

    var activity = dbAll_('TaskActivity').slice(-25).reverse().map(function (a) {
      var t = dbGet_('Tasks', a.taskId);
      return activityDto_(a, u, t);
    });

    return {
      kpis: kpis,
      incoming: tasks.filter(function (t) { return t.status === STATUS.NEW || t.status === STATUS.UNDER_REVIEW; }).sort(byNewest).slice(0, 8).map(withReq),
      needsAssignment: tasks.filter(function (t) { return t.status === STATUS.READY; }).sort(byNewest).slice(0, 8).map(withReq),
      overdue: tasks.filter(isOverdue_).sort(function (a, b) { return (a.dueDate + a.dueTime) > (b.dueDate + b.dueTime) ? 1 : -1; }).slice(0, 8).map(withReq),
      pendingApprovals: pendingApprovals,
      workload: workload,
      workloadThreshold: s.workloadThreshold,
      activity: activity,
      campaigns: uniq_(tasks.map(function (t) { return t.campaign; }))
    };
  });
}

function api_designerDashboard() {
  return respond_(function () {
    var u = currentUser_();
    var mine = dbFind_('Tasks', function (t) { return t.assigneeEmail === u.email; });
    var today = isoDateOnly_();
    var weekAhead = isoDateOnly_(new Date(Date.now() + 7 * 864e5));
    var active = mine.filter(function (t) { return CLOSED.indexOf(t.status) === -1 && t.status !== STATUS.APPROVED; });
    var month = today.slice(0, 7);
    // Decisions count for the designer who uploaded that version.
    var myVersions = {};
    dbFind_('CreativeVersions', function (v) { return v.uploadedBy === u.email; }).forEach(function (v) { myVersions[v.versionId] = true; });
    var approvedThisMonth = dbFind_('ApprovalDecisions', function (d) {
      return myVersions[d.versionId] && d.decision === 'approved' && String(d.decidedAt).slice(0, 7) === month;
    }).length;

    // Personal stats (own data only)
    var completed = mine.filter(function (t) { return t.status === STATUS.COMPLETED && t.completedAt && t.assignedAt; });
    var avgDays = completed.length ? completed.reduce(function (s, t) {
      return s + (new Date(t.completedAt) - new Date(t.assignedAt)) / 864e5;
    }, 0) / completed.length : null;
    var myDecisions = dbFind_('ApprovalDecisions', function (d) { return myVersions[d.versionId]; });
    var approvals = myDecisions.filter(function (d) { return d.decision === 'approved'; }).length;

    return {
      kpis: {
        active: active.length,
        dueToday: active.filter(function (t) { return t.dueDate === today; }).length,
        upcoming: active.filter(function (t) { return t.dueDate > today && t.dueDate <= weekAhead; }).length,
        awaitingSubmission: active.filter(function (t) { return t.status === STATUS.ASSIGNED || t.status === STATUS.IN_PROGRESS; }).length,
        changesRequested: active.filter(function (t) { return t.status === STATUS.CHANGES; }).length,
        approvedThisMonth: approvedThisMonth
      },
      stats: {
        completedTotal: mine.filter(function (t) { return t.status === STATUS.COMPLETED; }).length,
        avgCompletionDays: avgDays === null ? null : Math.round(avgDays * 10) / 10,
        approvalRate: myDecisions.length ? Math.round(approvals / myDecisions.length * 100) : null,
        overdue: active.filter(isOverdue_).length
      },
      tasks: mine.sort(function (a, b) { return ((a.dueDate || '9') + (a.dueTime || '99')) > ((b.dueDate || '9') + (b.dueTime || '99')) ? 1 : -1; })
        .map(function (t) { return taskDto_(t, u, deliverableCounts_(t.taskId)); })
    };
  });
}

/** Leader task board with filters. */
function api_listTasks(filters) {
  return respond_(function () {
    var u = currentUser_();
    filters = filters || {};
    var rows = isLeader_(u) ? dbAll_('Tasks') : dbFind_('Tasks', function (t) { return t.assigneeEmail === u.email; });
    var q = String(filters.q || '').toLowerCase().trim();
    var reqMap = {}; dbAll_('Requirements').forEach(function (r) { reqMap[r.requirementId] = r; });
    rows = rows.filter(function (t) {
      if (filters.status && filters.status !== 'all') {
        if (filters.status === 'open') { if (CLOSED.indexOf(t.status) !== -1) return false; }
        else if (filters.status === 'overdue') { if (!isOverdue_(t)) return false; }
        else if (filters.status === 'unassigned') { if (PRE_ASSIGN.indexOf(t.status) === -1) return false; }
        else if (t.status !== filters.status) return false;
      }
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.campaign && t.campaign !== filters.campaign) return false;
      if (isLeader_(u) && filters.assignee) {
        if (filters.assignee === '__none' ? !!t.assigneeEmail : t.assigneeEmail !== filters.assignee) return false;
      }
      if (filters.dueFrom && (!t.dueDate || t.dueDate < filters.dueFrom)) return false;
      if (filters.dueTo && (!t.dueDate || t.dueDate > filters.dueTo)) return false;
      if (q) {
        var r = reqMap[t.requirementId] || {};
        var hay = [t.taskId, t.requirementId, t.title, t.campaign, t.product, t.creativeType, r.requesterName, r.department].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    return rows.map(function (t) {
      var r = reqMap[t.requirementId] || {};
      return taskDto_(t, u, Object.assign({ requesterName: r.requesterName || '', department: r.department || '' }, deliverableCounts_(t.taskId)));
    });
  });
}

/* ---------- task detail ---------- */

function api_getTask(taskId) {
  return respond_(function () {
    var u = currentUser_();
    var t = requireTask_(u, taskId);
    var leader = isLeader_(u);
    var req = dbGet_('Requirements', t.requirementId) || {};
    var typeDef = (settings_().creativeTypes || []).filter(function (x) { return x.id === req.creativeType; })[0];
    var tf = parseJson_(req.typeFields, {});
    var typeFields = typeDef ? (typeDef.fields || []).filter(function (f) { return tf[f.key] !== undefined && tf[f.key] !== ''; })
      .map(function (f) { return { label: f.label, value: String(tf[f.key]) }; }) : [];

    var attachments = dbFind_('ReferenceFiles', function (f) { return f.requirementId === t.requirementId || f.taskId === t.taskId; })
      .map(function (f) { return pick_(f, ['attachmentId', 'fileName', 'mimeType', 'sizeBytes', 'uploadedAt']); });

    var versions = dbFind_('CreativeVersions', function (v) { return v.taskId === t.taskId; });
    var decisions = dbFind_('ApprovalDecisions', function (d) { return d.taskId === t.taskId; });
    var requests = dbFind_('ApprovalRequests', function (r) { return r.taskId === t.taskId; });
    var deliverables = taskDeliverables_(t.taskId).map(function (d) {
      var vs = versions.filter(function (v) { return v.deliverableId === d.deliverableId; })
        .sort(function (a, b) { return Number(b.versionNo) - Number(a.versionNo); })
        .map(function (v) {
          var o = pick_(v, ['versionId', 'versionNo', 'fileName', 'mimeType', 'sizeBytes', 'note', 'uploadedAt', 'status', 'submittedAt']);
          o.uploadedBy = leader ? v.uploadedBy : (v.uploadedBy === u.email ? 'You' : 'Previous designer');
          if (leader) o.uploadedByName = displayName_(v.uploadedBy);
          o.decisions = decisions.filter(function (x) { return x.versionId === v.versionId; }).map(function (x) {
            var dd = pick_(x, ['decision', 'comment', 'decidedAt', 'channel']);
            if (leader) { dd.reviewerName = x.reviewerName; dd.reviewerEmail = x.reviewerEmail; dd.decidedBy = x.decidedBy; }
            return dd;
          });
          if (leader) {
            var rq = requests.filter(function (r) { return r.versionId === v.versionId; })[0];
            if (rq) {
              var now = Date.now();
              o.request = { requestId: rq.requestId, status: rq.status,
                activeLinks: dbFind_('ReviewTokens', function (k) {
                  return k.requestId === rq.requestId && !k.revokedAt && new Date(k.expiresAt).getTime() > now;
                }).length };
            }
          }
          return o;
        });
      return Object.assign(pick_(d, ['deliverableId', 'title', 'purpose', 'deliverableType', 'status', 'latestVersionNo', 'approvedVersionId', 'createdAt']),
        { versions: vs });
    });

    var activity = dbFind_('TaskActivity', function (a) { return a.taskId === t.taskId && (leader || a.visibility !== 'leader'); })
      .reverse().map(function (a) { return activityDto_(a, u, t); });

    var out = {
      task: taskDto_(t, u),
      requirement: {
        requirementId: req.requirementId || '', requesterName: req.requesterName || '', department: req.department || '',
        email: req.email || '', phone: leader ? req.phone || '' : '', submittedAt: req.submittedAt || '',
        platform: req.platform || '', preferredDate: req.preferredDate || '', preferredTime: req.preferredTime || '', priorityRequested: req.priorityRequested || '',
        quantity: req.quantity || '', typeFields: typeFields
      },
      attachments: attachments,
      deliverables: deliverables,
      activity: activity,
      permissions: taskPermissions_(u, t),
      brandGuidelinesUrl: settings_().brandGuidelinesUrl
    };
    if (leader) {
      out.assignments = dbFind_('TaskAssignments', function (a) { return a.taskId === t.taskId; }).reverse()
        .map(function (a) { return Object.assign(pick_(a, ['assigneeEmail', 'previousAssignee', 'assignedBy', 'dueDate', 'dueTime', 'priority', 'note', 'assignedAt']),
          { assigneeName: displayName_(a.assigneeEmail) }); });
      out.team = dbFind_('Users', function (x) { return bool_(x.active); }).map(function (x) {
        var load = dbFind_('Tasks', function (tt) { return tt.assigneeEmail === x.email && CLOSED.indexOf(tt.status) === -1 && tt.status !== STATUS.APPROVED; }).length;
        return { email: x.email, name: x.name, role: x.role, activeTasks: load };
      });
      out.siblingTasks = dbFind_('Tasks', function (x) { return x.requirementId === t.requirementId && x.taskId !== t.taskId; })
        .map(function (x) { return pick_(x, ['taskId', 'title', 'status']); });
    }
    return out;
  });
}

function taskPermissions_(u, t) {
  var leader = isLeader_(u);
  var isAssignee = t.assigneeEmail === u.email;
  var uploadable = [STATUS.ASSIGNED, STATUS.IN_PROGRESS, STATUS.SUBMITTED, STATUS.CHANGES, STATUS.RESUBMITTED, STATUS.APPROVED];
  var manual = Object.keys(MANUAL_TRANSITIONS[t.status] || {}).filter(function (to) {
    return MANUAL_TRANSITIONS[t.status][to].indexOf(u.role) !== -1;
  });
  return {
    canUpload: (isAssignee || leader) && uploadable.indexOf(t.status) !== -1,
    canProgress: (isAssignee || leader) && [STATUS.ASSIGNED, STATUS.IN_PROGRESS, STATUS.CHANGES, STATUS.SUBMITTED, STATUS.RESUBMITTED].indexOf(t.status) !== -1,
    canAssign: leader && CLOSED.indexOf(t.status) === -1,
    canSetFinalLink: (isAssignee || leader) && t.status !== STATUS.CANCELLED,
    canEdit: leader,
    canDecide: leader,
    canOverrideComplete: leader && [STATUS.COMPLETED, STATUS.CANCELLED].indexOf(t.status) === -1,
    canResume: leader && t.status === STATUS.ON_HOLD,
    transitions: manual
  };
}

function activityDto_(a, u, task) {
  var leader = isLeader_(u);
  var actor;
  if (a.actorRole === 'reviewer') actor = 'Reviewer';
  else if (a.actorRole === 'requester') actor = 'Requester';
  else if (a.actorRole === 'system' || a.actorEmail === 'system') actor = 'System';
  else if (leader) actor = displayName_(a.actorEmail);
  else if (a.actorEmail === u.email) actor = 'You';
  else if (a.actorRole === ROLES.LEADER) actor = 'Team Leader';
  else actor = 'Team member';
  var o = { action: a.action, fromValue: a.fromValue, toValue: a.toValue, note: a.note, createdAt: a.createdAt, actor: actor,
    taskId: a.taskId, taskTitle: task ? task.title : '' };
  // Assignment values carry emails; only leaders see them.
  if (!leader && a.action === 'assigned') { o.fromValue = ''; o.toValue = a.toValue === u.email ? 'You' : ''; }
  return o;
}

/* ---------- leader actions ---------- */

function api_assignTask(taskId, input) {
  return respond_(function () {
    var u = requireLeader_();
    input = input || {};
    var assignee = email_(input.assigneeEmail, 'Designer', true);
    var dueDate = date_(input.dueDate, 'Due date', true);
    var dueTime = time_(input.dueTime, 'Due time', false);
    var startDate = date_(input.startDate, 'Start date', false);
    var priority = oneOf_(str_(input.priority, 20, 'Priority', true), settings_().priorities, 'Priority');
    var instructions = str_(input.instructions, LIMITS.TEXT_LONG, 'Instructions', false);
    var note = str_(input.note, 1000, 'Note', false);
    return withLock_(function () {
      var t = requireTask_(u, taskId);
      assignInternal_(u, t, { assignee: assignee, dueDate: dueDate, dueTime: dueTime, startDate: startDate, priority: priority,
        instructions: input.instructions !== undefined ? instructions : undefined, note: note });
      return { status: dbGet_('Tasks', t.taskId).status };
    });
  });
}

function api_updateTask(taskId, patchIn) {
  return respond_(function () {
    var u = requireLeader_();
    patchIn = patchIn || {};
    var allowed = {
      title: function (v) { return str_(v, 150, 'Title', true); },
      brief: function (v) { return str_(v, LIMITS.TEXT_LONG, 'Brief', true); },
      purpose: function (v) { return str_(v, 1000, 'Purpose', false); },
      campaign: function (v) { return str_(v, 150, 'Campaign', false); },
      product: function (v) { return str_(v, 150, 'Product', false); },
      dimensions: function (v) { return str_(v, 200, 'Dimensions', false); },
      formats: function (v) { return str_(v, 200, 'Formats', false); },
      copyText: function (v) { return str_(v, LIMITS.TEXT_LONG, 'Copy', false); },
      instructions: function (v) { return str_(v, LIMITS.TEXT_LONG, 'Instructions', false); },
      internalNotes: function (v) { return str_(v, LIMITS.TEXT_LONG, 'Internal notes', false); },
      dueDate: function (v) { return date_(v, 'Due date', false); },
      dueTime: function (v) { return time_(v, 'Due time', false); },
      startDate: function (v) { return date_(v, 'Start date', false); },
      priority: function (v) { return oneOf_(v, settings_().priorities, 'Priority'); },
      deliverablesRequired: function (v) { return String(int_(v, 1, 50, 'Deliverables required')); },
      referenceUrls: function (v) { return urls_(v).join('\n'); }
    };
    var patch = {};
    Object.keys(patchIn).forEach(function (k) { if (allowed[k]) patch[k] = allowed[k](patchIn[k]); });
    if (!Object.keys(patch).length) throw AppError_('VALIDATION', 'Nothing to update.');
    return withLock_(function () {
      var t = requireTask_(u, taskId);
      patch.updatedAt = nowIso_();
      dbUpdate_('Tasks', t.taskId, patch);
      var changed = Object.keys(patch).filter(function (k) { return k !== 'updatedAt' && String(t[k]) !== String(patch[k]); });
      if (changed.length) {
        var leaderOnly = changed.length === 1 && changed[0] === 'internalNotes';
        logActivity_(t.taskId, u, 'updated', '', changed.join(', '), '', leaderOnly ? 'leader' : 'team');
        if ((patch.dueDate !== undefined && patch.dueDate !== t.dueDate) || (patch.dueTime !== undefined && patch.dueTime !== t.dueTime)) dbUpdate_('Tasks', t.taskId, { dueSoonNotifiedAt: '', overdueNotifiedAt: '' });
        if (t.assigneeEmail && !leaderOnly && (changed.indexOf('dueDate') !== -1 || changed.indexOf('dueTime') !== -1 || changed.indexOf('priority') !== -1 || changed.indexOf('instructions') !== -1)) {
          notify_([t.assigneeEmail], 'task_updated', 'Task updated: ' + t.title, 'The team leader changed: ' +
            changed.filter(function (c) { return c !== 'internalNotes'; }).join(', ') + '.', 'task/' + t.taskId, false);
        }
      }
      if (patch.deliverablesRequired) recomputeTaskStatus_(t.taskId, u);
      return { status: dbGet_('Tasks', t.taskId).status };
    });
  });
}

/** Manual status change. options.override + reason is needed to force Completed. */
function api_setTaskStatus(taskId, to, options) {
  return respond_(function () {
    var u = currentUser_();
    options = options || {};
    to = oneOf_(String(to || ''), STATUS_ORDER, 'Status');
    var reason = str_(options.reason, 1000, 'Reason', false);
    return withLock_(function () {
      var t = requireTask_(u, taskId);
      if (to === STATUS.COMPLETED && t.status !== STATUS.APPROVED) {
        if (!isLeader_(u)) throw AppError_('FORBIDDEN', 'Only the team leader can complete a task.');
        if (!options.override || !reason) throw AppError_('VALIDATION', 'Not all deliverables are approved. Add a reason to override and complete anyway.');
        completeTask_(t, u, 'Leader override: ' + reason);
        return { status: STATUS.COMPLETED };
      }
      var rules = MANUAL_TRANSITIONS[t.status] || {};
      if (!rules[to] || rules[to].indexOf(u.role) === -1) {
        throw AppError_('INVALID_TRANSITION', 'A task can’t move from "' + t.status + '" to "' + to + '"' + (isLeader_(u) ? '.' : ' by you.'));
      }
      if (to === STATUS.COMPLETED) { completeTask_(t, u, reason || 'Marked complete'); return { status: STATUS.COMPLETED }; }
      if (to === STATUS.CANCELLED) {
        // Close any open review links for this task.
        closeOpenRequests_(t.taskId, 'Task cancelled');
      }
      setStatus_(t, to, u, reason);
      if (to === STATUS.CANCELLED || to === STATUS.ON_HOLD) {
        if (t.assigneeEmail) notify_([t.assigneeEmail], 'task_status', to + ': ' + t.title, t.taskId + ' is now ' + to.toLowerCase() + (reason ? '. ' + reason : '.'), 'task/' + t.taskId);
      }
      // A reopened task stays In Progress until new work is submitted.
      return { status: dbGet_('Tasks', t.taskId).status };
    });
  });
}

function api_resumeTask(taskId) {
  return respond_(function () {
    var u = requireLeader_();
    return withLock_(function () {
      var t = requireTask_(u, taskId);
      if (t.status !== STATUS.ON_HOLD) throw AppError_('INVALID_STATE', 'This task is not on hold.');
      var back = t.prevStatus && t.prevStatus !== STATUS.ON_HOLD ? t.prevStatus : (t.assigneeEmail ? STATUS.ASSIGNED : STATUS.NEW);
      if (back === STATUS.COMPLETED || back === STATUS.CANCELLED) back = t.assigneeEmail ? STATUS.IN_PROGRESS : STATUS.NEW;
      setStatus_(t, back, u, 'Resumed');
      recomputeTaskStatus_(t.taskId, u);
      return { status: dbGet_('Tasks', t.taskId).status };
    });
  });
}

/** Leader splits a requirement into another task. */
function api_createTaskFromRequirement(requirementId, input) {
  return respond_(function () {
    var u = requireLeader_();
    input = input || {};
    var title = str_(input.title, 150, 'Title', true);
    var qty = int_(input.deliverablesRequired || 1, 1, 50, 'Deliverables required');
    return withLock_(function () {
      var req = dbGet_('Requirements', str_(requirementId, 40, 'Requirement', true));
      if (!req) throw AppError_('NOT_FOUND', 'Requirement not found.');
      var base = dbFind_('Tasks', function (t) { return t.requirementId === req.requirementId; })[0] || {};
      var taskId = nextSeqId_('GFX');
      var now = nowIso_();
      dbInsert_('Tasks', {
        taskId: taskId, requirementId: req.requirementId, title: title,
        brief: str_(input.brief, LIMITS.TEXT_LONG, 'Brief', false) || req.brief, creativeType: base.creativeType || req.creativeType,
        purpose: req.purpose, campaign: req.campaign, product: req.product, deliverablesRequired: String(qty),
        dimensions: str_(input.dimensions, 200, 'Dimensions', false) || req.dimensions, formats: '', copyText: req.copyText,
        referenceUrls: req.referenceUrls, assigneeEmail: '', assignedBy: '', assignedAt: '', startDate: '',
        dueDate: req.preferredDate, dueTime: req.preferredTime, priority: req.priorityRequested, status: STATUS.READY, prevStatus: '', progress: '0',
        instructions: req.instructions, internalNotes: '', folderId: req.folderId, completedAt: '', dueSoonNotifiedAt: '',
        overdueNotifiedAt: '', createdBy: u.email, createdAt: now, updatedAt: now
      });
      logActivity_(taskId, u, 'created', '', STATUS.READY, 'Split from ' + req.requirementId, 'team');
      return { taskId: taskId };
    });
  });
}


/** Assigns a task (caller holds the lock and has checked leader rights). */
function assignInternal_(u, t, o) {
  var assignee = o.assignee, dueDate = o.dueDate, dueTime = o.dueTime || '', startDate = o.startDate || '', priority = o.priority, note = o.note || '';
  var instructions = o.instructions;
  if (CLOSED.indexOf(t.status) !== -1) throw AppError_('INVALID_STATE', 'This task is ' + t.status.toLowerCase() + '. Reopen it before assigning.');
  var member = userByEmail_(assignee);
  if (!member || !bool_(member.active)) throw AppError_('VALIDATION', 'That person is not an active team member.');
  var previous = t.assigneeEmail;
  var patch = { assigneeEmail: member.email.toLowerCase(), assignedBy: u.email, assignedAt: nowIso_(), dueDate: dueDate, dueTime: dueTime,
    priority: priority, updatedAt: nowIso_() };
  if (startDate) patch.startDate = startDate;
  if (instructions !== undefined) patch.instructions = instructions;
  dbUpdate_('Tasks', t.taskId, patch);
  dbInsert_('TaskAssignments', { assignmentId: 'ASG-' + uuid_(), taskId: t.taskId, assigneeEmail: patch.assigneeEmail,
    previousAssignee: previous || '', assignedBy: u.email, dueDate: dueDate, dueTime: dueTime, priority: priority, note: note, assignedAt: nowIso_() });
  logActivity_(t.taskId, u, 'assigned', previous || '', patch.assigneeEmail, note, 'leader');
  logActivity_(t.taskId, u, 'assignment', '', previous ? 'reassigned' : 'assigned', 'due ' + dueText_(dueDate, dueTime) + ' · ' + priority + ' priority', 'team');

  var fresh = dbGet_('Tasks', t.taskId);
  if (PRE_ASSIGN.indexOf(fresh.status) !== -1) setStatus_(fresh, STATUS.ASSIGNED, u, '');
  else if (fresh.status === STATUS.ON_HOLD && PRE_ASSIGN.indexOf(fresh.prevStatus) !== -1) dbUpdate_('Tasks', t.taskId, { prevStatus: STATUS.ASSIGNED });

  var req = dbGet_('Requirements', t.requirementId);
  if (req && req.status === 'Received') dbUpdate_('Requirements', req.requirementId, { status: 'In work', updatedAt: nowIso_() });

  notify_([patch.assigneeEmail], previous ? 'task_reassigned' : 'task_assigned',
    (previous && previous !== patch.assigneeEmail ? 'Reassigned to you: ' : 'New task: ') + t.title,
    t.taskId + ' · due ' + dueText_(dueDate, dueTime) + ' · ' + priority + ' priority' + (instructions ? '\n\n' + instructions : ''), 'task/' + t.taskId);
  if (previous && previous !== patch.assigneeEmail) {
    notify_([previous], 'task_reassigned', 'Task moved off your list: ' + t.title, t.taskId + ' has been reassigned by the team leader.', 'overview');
  }
}

/**
 * Divide one task between several designers.
 * parts: [{ assigneeEmail, count, note }]. The first part keeps this task;
 * each other part becomes a new task on the same requirement, already assigned.
 */
function api_divideTask(taskId, input) {
  return respond_(function () {
    var u = requireLeader_();
    input = input || {};
    var parts = Array.isArray(input.parts) ? input.parts : [];
    if (parts.length < 2 || parts.length > 10) throw AppError_('VALIDATION', 'Choose between 2 and 10 designers.');
    var dueDate = date_(input.dueDate, 'Due date', true);
    var dueTime = time_(input.dueTime, 'Due time', false);
    var priority = oneOf_(str_(input.priority, 20, 'Priority', true), settings_().priorities, 'Priority');
    var clean = parts.map(function (p, i) {
      return {
        assignee: email_(p.assigneeEmail, 'Designer ' + (i + 1), true),
        count: int_(p.count, 1, 50, 'Creatives for designer ' + (i + 1)),
        note: str_(p.note, 1000, 'Note', false)
      };
    });
    return withLock_(function () {
      var t = requireTask_(u, taskId);
      if (CLOSED.indexOf(t.status) !== -1) throw AppError_('INVALID_STATE', 'This task is ' + t.status.toLowerCase() + '.');
      if (taskDeliverables_(t.taskId).length) throw AppError_('INVALID_STATE', 'Creatives were already uploaded on this task, so it can’t be divided. Use “Add task” for extra work instead.');
      clean.forEach(function (p) {
        var m = userByEmail_(p.assignee);
        if (!m || !bool_(m.active)) throw AppError_('VALIDATION', p.assignee + ' is not an active team member.');
      });
      var n = clean.length, baseTitle = t.title.replace(/ \(\d+\/\d+\)$/, '');
      var ids = [t.taskId];
      // Part 1 stays on this task
      dbUpdate_('Tasks', t.taskId, { title: baseTitle + ' (1/' + n + ')', deliverablesRequired: String(clean[0].count), updatedAt: nowIso_() });
      logActivity_(t.taskId, u, 'updated', '', 'divided into ' + n + ' parts', '', 'team');
      assignInternal_(u, dbGet_('Tasks', t.taskId), { assignee: clean[0].assignee, dueDate: dueDate, dueTime: dueTime, priority: priority, note: clean[0].note });
      // Parts 2..n become new tasks
      for (var i = 1; i < n; i++) {
        var newId = nextSeqId_('GFX');
        var now = nowIso_();
        var copy = {};
        SCHEMA.Tasks.forEach(function (c) { copy[c] = t[c]; });
        Object.assign(copy, {
          taskId: newId, title: baseTitle + ' (' + (i + 1) + '/' + n + ')', deliverablesRequired: String(clean[i].count),
          assigneeEmail: '', assignedBy: '', assignedAt: '', status: STATUS.READY, prevStatus: '', progress: '0',
          completedAt: '', dueSoonNotifiedAt: '', overdueNotifiedAt: '', internalNotes: '', createdBy: u.email, createdAt: now, updatedAt: now
        });
        dbInsert_('Tasks', copy);
        logActivity_(newId, u, 'created', '', STATUS.READY, 'Divided from ' + t.taskId, 'team');
        assignInternal_(u, dbGet_('Tasks', newId), { assignee: clean[i].assignee, dueDate: dueDate, dueTime: dueTime, priority: priority, note: clean[i].note });
        ids.push(newId);
      }
      return { taskIds: ids };
    });
  });
}

/* ---------- designer + leader actions ---------- */

function api_updateProgress(taskId, progress, note) {
  return respond_(function () {
    var u = currentUser_();
    var p = Number(progress);
    if (PROGRESS_STEPS.indexOf(p) === -1) throw AppError_('VALIDATION', 'Progress must be one of ' + PROGRESS_STEPS.join(', ') + '%.');
    note = str_(note, 1000, 'Progress note', false);
    return withLock_(function () {
      var t = requireTask_(u, taskId);
      if (!taskPermissions_(u, t).canProgress) throw AppError_('INVALID_STATE', 'Progress can’t be updated while the task is ' + t.status.toLowerCase() + '.');
      dbUpdate_('Tasks', t.taskId, { progress: String(p), updatedAt: nowIso_() });
      logActivity_(t.taskId, u, 'progress', t.progress + '%', p + '%', note, 'team');
      // 100% never completes a task; only approvals (or a leader override) do.
      if (t.status === STATUS.ASSIGNED && p > 0) setStatus_(dbGet_('Tasks', t.taskId), STATUS.IN_PROGRESS, u, 'Work started');
      return { status: dbGet_('Tasks', t.taskId).status, progress: p };
    });
  });
}

function api_addComment(taskId, text, leaderOnly) {
  return respond_(function () {
    var u = currentUser_();
    text = str_(text, 2000, 'Comment', true);
    return withLock_(function () {
      var t = requireTask_(u, taskId);
      var vis = isLeader_(u) && leaderOnly ? 'leader' : 'team';
      logActivity_(t.taskId, u, 'comment', '', '', text, vis);
      if (vis === 'team') {
        var to = isLeader_(u) ? [t.assigneeEmail] : leaderEmails_();
        notify_(to.filter(function (e) { return e && e !== u.email; }), 'comment', 'New comment on ' + t.taskId,
          (isLeader_(u) ? 'Team leader' : u.name) + ': ' + text.slice(0, 300), 'task/' + t.taskId, false);
      }
      return true;
    });
  });
}

function uniq_(arr) {
  var seen = {}, out = [];
  arr.forEach(function (x) { if (x && !seen[x]) { seen[x] = true; out.push(x); } });
  return out.sort();
}
