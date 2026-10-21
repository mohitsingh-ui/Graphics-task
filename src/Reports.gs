/**
 * Reports.gs — analytics computed from the live records (leader only).
 * Designers get their own stats through api_designerDashboard.
 */

function reportRange_(range) {
  range = range || {};
  var to = range.to ? date_(range.to, 'To date') : isoDateOnly_();
  var from = range.from ? date_(range.from, 'From date') : isoDateOnly_(new Date(Date.now() - 89 * 864e5));
  if (from > to) throw AppError_('VALIDATION', 'The start date must be before the end date.');
  return { from: from, to: to };
}

function inRange_(iso, r) {
  if (!iso) return false;
  var d = isoDateOnly_(new Date(iso));
  return d >= r.from && d <= r.to;
}

function hoursBetween_(a, b) { return (new Date(b).getTime() - new Date(a).getTime()) / 3600000; }

function avg_(arr) { return arr.length ? arr.reduce(function (s, x) { return s + x; }, 0) / arr.length : null; }

function round1_(n) { return n === null ? null : Math.round(n * 10) / 10; }

function isoWeek_(iso) {
  var d = new Date(iso);
  var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  var y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  var wk = Math.ceil(((t - y0) / 864e5 + 1) / 7);
  return t.getUTCFullYear() + '-W' + ('0' + wk).slice(-2);
}

function computeReport_(range) {
  var r = reportRange_(range);
  var tasks = dbAll_('Tasks');
  var reqs = dbAll_('Requirements');
  var assigns = dbAll_('TaskAssignments');
  var decisions = dbAll_('ApprovalDecisions');
  var requests = dbAll_('ApprovalRequests');
  var reqById = {}; requests.forEach(function (x) { reqById[x.requestId] = x; });
  var reqMap = {}; reqs.forEach(function (x) { reqMap[x.requirementId] = x; });

  var reqsIn = reqs.filter(function (x) { return inRange_(x.submittedAt, r); });
  var completedIn = tasks.filter(function (t) { return t.status === STATUS.COMPLETED && inRange_(t.completedAt, r); });
  var decisionsIn = decisions.filter(function (d) { return inRange_(d.decidedAt, r); });
  var tasksCreatedIn = tasks.filter(function (t) { return inRange_(t.createdAt, r); });

  var turnaround = decisionsIn.map(function (d) {
    var rq = reqById[d.requestId];
    return rq ? hoursBetween_(rq.createdAt, d.decidedAt) : null;
  }).filter(function (x) { return x !== null && x >= 0; });

  var completionDays = completedIn.filter(function (t) { return t.assignedAt; })
    .map(function (t) { return hoursBetween_(t.assignedAt, t.completedAt) / 24; });

  // Revision cycles: "changes" decisions per completed task
  var changesByTask = {};
  decisions.forEach(function (d) { if (d.decision === 'changes') changesByTask[d.taskId] = (changesByTask[d.taskId] || 0) + 1; });

  // Decisions are credited to whoever uploaded that version (survives reassignment).
  var uploaderByVersion = {};
  dbAll_('CreativeVersions').forEach(function (v) { uploaderByVersion[v.versionId] = String(v.uploadedBy).toLowerCase(); });

  var users = dbAll_('Users');
  var designers = users.map(function (u) {
    var mine = tasks.filter(function (t) { return t.assigneeEmail === u.email; });
    var doneIn = mine.filter(function (t) { return t.status === STATUS.COMPLETED && inRange_(t.completedAt, r); });
    var dec = decisionsIn.filter(function (d) { return uploaderByVersion[d.versionId] === u.email.toLowerCase(); });
    var approved = dec.filter(function (d) { return d.decision === 'approved'; }).length;
    return {
      name: u.name, email: u.email, role: u.role, active: bool_(u.active),
      assigned: assigns.filter(function (a) { return a.assigneeEmail === u.email && inRange_(a.assignedAt, r); }).length,
      completed: doneIn.length,
      avgCompletionDays: round1_(avg_(doneIn.filter(function (t) { return t.assignedAt; }).map(function (t) { return hoursBetween_(t.assignedAt, t.completedAt) / 24; }))),
      activeNow: mine.filter(function (t) { return CLOSED.indexOf(t.status) === -1 && t.status !== STATUS.APPROVED; }).length,
      overdueNow: mine.filter(isOverdue_).length,
      revisionCycles: dec.filter(function (d) { return d.decision === 'changes'; }).length,
      approvalRate: dec.length ? Math.round(approved / dec.length * 100) : null
    };
  }).filter(function (d) { return d.role === ROLES.DESIGNER || d.assigned || d.completed || d.activeNow; });

  function groupCount(list, keyFn) {
    var m = {};
    list.forEach(function (x) { var k = keyFn(x) || 'Unspecified'; m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).map(function (k) { return { label: k, count: m[k] }; }).sort(function (a, b) { return b.count - a.count; });
  }

  var weekly = {}, monthly = {};
  function bump(map, key, field) { map[key] = map[key] || { period: key, requirements: 0, completed: 0, approvals: 0 }; map[key][field]++; }
  reqsIn.forEach(function (x) { bump(weekly, isoWeek_(x.submittedAt), 'requirements'); bump(monthly, String(x.submittedAt).slice(0, 7), 'requirements'); });
  completedIn.forEach(function (t) { bump(weekly, isoWeek_(t.completedAt), 'completed'); bump(monthly, String(t.completedAt).slice(0, 7), 'completed'); });
  decisionsIn.filter(function (d) { return d.decision === 'approved'; }).forEach(function (d) {
    bump(weekly, isoWeek_(d.decidedAt), 'approvals'); bump(monthly, String(d.decidedAt).slice(0, 7), 'approvals');
  });
  var sortP = function (a, b) { return a.period > b.period ? 1 : -1; };
  var approvedCount = decisionsIn.filter(function (d) { return d.decision === 'approved'; }).length;

  return {
    range: r,
    summary: {
      requirements: reqsIn.length,
      tasksCreated: tasksCreatedIn.length,
      tasksCompleted: completedIn.length,
      overdueNow: tasks.filter(isOverdue_).length,
      avgCompletionDays: round1_(avg_(completionDays)),
      avgApprovalHours: round1_(avg_(turnaround)),
      revisionCycles: decisionsIn.filter(function (d) { return d.decision === 'changes'; }).length,
      avgRevisionsPerCompletedTask: round1_(avg_(completedIn.map(function (t) { return changesByTask[t.taskId] || 0; }))),
      approvalRate: decisionsIn.length ? Math.round(approvedCount / decisionsIn.length * 100) : null,
      decisions: decisionsIn.length
    },
    designers: designers,
    byDepartment: groupCount(tasksCreatedIn, function (t) { return (reqMap[t.requirementId] || {}).department; }),
    byCreativeType: groupCount(tasksCreatedIn, function (t) { return t.creativeType; }),
    weekly: Object.keys(weekly).map(function (k) { return weekly[k]; }).sort(sortP),
    monthly: Object.keys(monthly).map(function (k) { return monthly[k]; }).sort(sortP)
  };
}

function api_getReports(range) {
  return respond_(function () { requireLeader_(); return computeReport_(range); });
}

/** CSV text for download. kind: tasks | designers | decisions */
function api_exportCsv(kind, range) {
  return respond_(function () {
    requireLeader_();
    var r = reportRange_(range);
    var rows;
    if (kind === 'designers') {
      var rep = computeReport_(r);
      rows = [['Designer', 'Email', 'Assigned', 'Completed', 'Avg completion (days)', 'Active now', 'Overdue now', 'Revision cycles', 'Approval rate %']]
        .concat(rep.designers.map(function (d) { return [d.name, d.email, d.assigned, d.completed, d.avgCompletionDays, d.activeNow, d.overdueNow, d.revisionCycles, d.approvalRate]; }));
    } else if (kind === 'decisions') {
      rows = [['Decided at', 'Task', 'Deliverable', 'Version', 'Decision', 'Reviewer', 'Reviewer email', 'Channel', 'Comment']];
      dbAll_('ApprovalDecisions').filter(function (d) { return inRange_(d.decidedAt, r); }).forEach(function (d) {
        var v = dbGet_('CreativeVersions', d.versionId) || {}, del = dbGet_('CreativeSubmissions', d.deliverableId) || {};
        rows.push([d.decidedAt, d.taskId, del.title, 'V' + v.versionNo, d.decision, d.reviewerName, d.reviewerEmail, d.channel, d.comment]);
      });
    } else {
      var reqMap = {}; dbAll_('Requirements').forEach(function (x) { reqMap[x.requirementId] = x; });
      rows = [['Task ID', 'Requirement ID', 'Title', 'Department', 'Requester', 'Creative type', 'Campaign', 'Status', 'Priority',
        'Assignee', 'Assigned at', 'Due date', 'Due time', 'Completed at', 'Deliverables required', 'Progress %', 'Overdue', 'Created at']];
      dbAll_('Tasks').filter(function (t) { return inRange_(t.createdAt, r) || inRange_(t.completedAt, r); }).forEach(function (t) {
        var q = reqMap[t.requirementId] || {};
        rows.push([t.taskId, t.requirementId, t.title, q.department, q.requesterName, t.creativeType, t.campaign, t.status, t.priority,
          t.assigneeEmail, t.assignedAt, t.dueDate, t.dueTime, t.completedAt, t.deliverablesRequired, t.progress, isOverdue_(t) ? 'Yes' : 'No', t.createdAt]);
      });
    }
    var csv = rows.map(function (row) {
      return row.map(function (c) {
        var s = c === null || c === undefined ? '' : String(c);
        if (/^[=+\-@]/.test(s)) s = "'" + s;          // spreadsheet formula injection guard
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
    return { fileName: 'graphics-' + (kind || 'tasks') + '_' + r.from + '_to_' + r.to + '.csv', csv: '﻿' + csv };
  });
}
