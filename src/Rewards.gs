/**
 * Rewards.gs — the team leader recognises good work with badges and points.
 * Everyone on the team sees the leaderboard; designers see their own history.
 */

var REWARD_BADGES = [
  { id: 'star', label: 'Star creative', points: 50 },
  { id: 'speed', label: 'Super-fast delivery', points: 30 },
  { id: 'firsttime', label: 'Approved first time', points: 30 },
  { id: 'extra', label: 'Went the extra mile', points: 40 },
  { id: 'team', label: 'Team player', points: 20 },
  { id: 'month', label: 'Creative of the month', points: 100 },
  { id: 'custom', label: 'Special reward', points: 10 }
];

function badgeOf_(id) { return REWARD_BADGES.filter(function (b) { return b.id === id; })[0] || null; }

function rewardDto_(r) {
  var b = badgeOf_(r.badge) || { label: r.badge };
  return { rewardId: r.rewardId, userEmail: r.userEmail, userName: displayName_(r.userEmail), badge: r.badge, badgeLabel: b.label,
    points: Number(r.points) || 0, reason: r.reason, taskId: r.taskId, givenBy: displayName_(r.givenBy), givenAt: r.givenAt };
}

/** Points for one approved creative, from the person's designation (Settings → Designations). */
function designationPoints_(user) {
  var list = settings_().designations || [];
  var name = String((user && user.designation) || '').toLowerCase();
  var hit = list.filter(function (d) { return String(d.name).toLowerCase() === name; })[0];
  if (hit) return Number(hit.points) || 0;
  var mid = list.filter(function (d) { return /^graphic designer$/i.test(d.name); })[0];
  return mid ? Number(mid.points) || 0 : 10;
}

/**
 * Everyone's points, worked out from the records (nothing to keep in sync):
 *   + designation points for each approved creative (credited to whoever made the approved version)
 *     — a creative made in several sizes counts once (each size file earns a share), unless
 *       Settings → "Count every size as its own creative" is on
 *   + first-time bonus when a creative was approved with no changes asked (shared the same way)
 *   + on-time bonus for each task completed by its deadline (paused hold time isn't counted)
 *   + reopen bonus each time a finished task was reopened for changes, once it's finished again
 *   − rejection penalty per rejected creative (if set)
 *   + task bonus set by the leader, paid when the task is completed
 *   + reward points from the team leader
 * inPeriod(dateIso) → true marks points that also count for the period (e.g. this month).
 * ledger (optional array) receives one entry per point event — the points history.
 */
function pointsTable_(inPeriod, ledger) {
  var s = settings_(), per = {};
  inPeriod = inPeriod || function () { return false; };
  var users = {}; dbAll_('Users').forEach(function (x) { users[x.email.toLowerCase()] = x; });
  var tasks = {}; dbAll_('Tasks').forEach(function (t) { tasks[t.taskId] = t; });
  // Tasks where the leader set fixed points: no automatic points at all, only those (paid on completion).
  var isFixed = function (t) { return !!t && t.fixedPoints !== '' && t.fixedPoints !== undefined && t.fixedPoints !== null; };
  function P(e) {
    e = String(e || '').toLowerCase();
    return per[e] || (per[e] = { email: e, total: 0, period: 0, creatives: 0, creativePts: 0, firstTime: 0, onTime: 0, rejected: 0, rewards: 0, rewardCount: 0, bonus: 0, bonusCount: 0, reopen: 0, reopenCount: 0, fixed: 0, fixedCount: 0,
      // the same, counted only inside the period: { n: how many, pts: points }
      inPeriod: { creatives: { n: 0, pts: 0 }, firstTime: { n: 0, pts: 0 }, onTime: { n: 0, pts: 0 }, rejected: { n: 0, pts: 0 }, rewards: { n: 0, pts: 0 }, bonus: { n: 0, pts: 0 }, reopen: { n: 0, pts: 0 }, fixed: { n: 0, pts: 0 } } });
  }
  function r1(x) { return Math.round(x * 10) / 10; }
  /** One point event: adds to totals, the period tally and the history. */
  function ev(e, kind, pts, n, when, taskId, label, note) {
    if (!e) return;
    var x = P(e);
    x.total = r1(x.total + pts);
    var inP = inPeriod(when);
    if (inP) { x.period = r1(x.period + pts); var b = x.inPeriod[kind]; if (b) { b.n = r1(b.n + n); b.pts = r1(b.pts + pts); } }
    if (ledger) {
      var t = taskId && tasks[taskId];
      ledger.push({ email: x.email, kind: kind, points: r1(pts), count: n, when: when || '', taskId: taskId || '', taskTitle: t ? t.title : '', label: label || '', note: note || '' });
    }
  }
  var versions = {}; dbAll_('CreativeVersions').forEach(function (v) { versions[v.versionId] = v; });
  var decByDel = {};
  dbAll_('ApprovalDecisions').forEach(function (d) { (decByDel[d.deliverableId] = decByDel[d.deliverableId] || []).push(d); });
  dbAll_('CreativeSubmissions').forEach(function (d) {
    var v = d.approvedVersionId && versions[d.approvedVersionId];
    var decs = (decByDel[d.deliverableId] || []).sort(function (a, b) { return a.decidedAt < b.decidedAt ? -1 : 1; });
    var task = tasks[d.taskId] || {};
    if (isFixed(task)) return;
    // A creative in 2 sizes = 2 files; each file earns half, so the creative earns its points once.
    var nSizes = sizesOf_(task).length, share = !s.countEachSize && nSizes > 1 ? 1 / nSizes : 1;
    var sizeNote = share < 1 ? ' (1 of ' + nSizes + ' sizes)' : '';
    if (v && v.status === VSTATUS.APPROVED) {
      var who = String(v.uploadedBy).toLowerCase();
      var ok = decs.filter(function (x) { return x.versionId === v.versionId && x.decision === 'approved'; }).pop();
      var when = ok ? ok.decidedAt : v.uploadedAt;
      var pts = designationPoints_(users[who]) * share;
      ev(who, 'creatives', pts, share, when, d.taskId, 'Creative approved: ' + d.title + sizeNote, users[who] && users[who].designation ? users[who].designation : '');
      P(who).creatives = r1(P(who).creatives + share); P(who).creativePts = r1(P(who).creativePts + pts);
      var hadChanges = decs.some(function (x) { return x.decidedAt <= when && (x.decision === 'changes' || x.decision === 'rejected'); });
      // An extra option made after changes were asked on the original isn't a first-time approval.
      if (d.variantOf && (decByDel[d.variantOf] || []).some(function (x) { return x.decidedAt <= d.createdAt && (x.decision === 'changes' || x.decision === 'rejected'); })) hadChanges = true;
      if (!hadChanges && Number(s.pointsFirstTime)) {
        var ft = Number(s.pointsFirstTime) * share;
        ev(who, 'firstTime', ft, share, when, d.taskId, 'Approved first time: ' + d.title + sizeNote);
        P(who).firstTime = r1(P(who).firstTime + ft);
      }
    }
    decs.forEach(function (x) {
      if (x.decision !== 'rejected') return;
      var rv = versions[x.versionId]; if (!rv) return;
      var w = String(rv.uploadedBy).toLowerCase();
      P(w).rejected++;
      ev(w, 'rejected', -(Number(s.pointsRejected) || 0), 1, x.decidedAt, d.taskId, 'Creative rejected: ' + d.title, x.comment || '');
    });
  });
  Object.keys(tasks).forEach(function (id) {
    var t = tasks[id];
    if (t.status !== STATUS.COMPLETED || !t.assigneeEmail || !t.completedAt) return;
    if (isFixed(t)) {
      var fp = Number(t.fixedPoints) || 0;
      ev(t.assigneeEmail, 'fixed', fp, 1, t.completedAt, t.taskId, fp ? 'Fixed points for this task' : 'Task with no points (set by the leader)');
      P(t.assigneeEmail).fixed += fp; P(t.assigneeEmail).fixedCount++;
    } else if (Number(s.pointsOnTime) && t.dueDate) {
      var end = dueEnd_(t.dueDate, t.dueTime);
      if (end && new Date(t.completedAt).getTime() <= end.getTime()) {
        ev(t.assigneeEmail, 'onTime', Number(s.pointsOnTime), 1, t.completedAt, t.taskId, 'Task finished on time');
        P(t.assigneeEmail).onTime++;
      }
    }
    // Task bonus set by the leader when assigning: paid to the designer once the task is completed.
    var b = Number(t.bonusPoints) || 0;
    if (b) { ev(t.assigneeEmail, 'bonus', b, 1, t.completedAt, t.taskId, 'Task bonus'); P(t.assigneeEmail).bonus += b; P(t.assigneeEmail).bonusCount++; }
  });
  // Reopened for changes: extra for the designer each time, once the task is finished again.
  if (Number(s.pointsReopen)) {
    dbAll_('TaskActivity').forEach(function (a) {
      if (a.action !== 'reopened') return;
      var t = tasks[a.taskId];
      if (!t || isFixed(t) || t.status !== STATUS.COMPLETED || !t.assigneeEmail || !t.completedAt || a.createdAt > t.completedAt) return;
      if (String(a.actorEmail || '').toLowerCase() === String(t.assigneeEmail).toLowerCase()) return;   // reopened their own task: no bonus
      ev(t.assigneeEmail, 'reopen', Number(s.pointsReopen), 1, t.completedAt, t.taskId, 'Reopened task finished', String(a.note || '').split(' · ')[0]);
      P(t.assigneeEmail).reopen += Number(s.pointsReopen); P(t.assigneeEmail).reopenCount++;
    });
  }
  dbAll_('Rewards').forEach(function (r) {
    var b = badgeOf_(r.badge) || { label: r.badge };
    ev(r.userEmail, 'rewards', Number(r.points) || 0, 1, r.givenAt, r.taskId, 'Reward: ' + b.label, (r.reason ? '“' + r.reason + '” · ' : '') + 'from ' + displayName_(r.givenBy));
    P(r.userEmail).rewards += Number(r.points) || 0; P(r.userEmail).rewardCount++;
  });
  return per;
}

var POINT_KINDS = { creatives: 'Creative approved', firstTime: 'First-time approval', onTime: 'On time', bonus: 'Task bonus', fixed: 'Fixed task points', reopen: 'Reopened task', rewards: 'Reward', rejected: 'Rejected' };

/**
 * Points history: every point event, newest first. Leaders see anyone (or everyone);
 * designers only see their own. filter: { email, from, to (yyyy-mm-dd), kind }.
 */
function pointsHistory_(u, filter) {
  filter = filter || {};
  var email = String(filter.email || '').toLowerCase().trim();
  if (!isLeader_(u)) email = u.email;
  var from = filter.from ? date_(filter.from, 'From', false) : '', to = filter.to ? date_(filter.to, 'To', false) : '';
  var kind = filter.kind && POINT_KINDS[filter.kind] ? filter.kind : '';
  var ledger = [];
  pointsTable_(null, ledger);
  var tz = Session.getScriptTimeZone();
  var day = function (w) { try { return Utilities.formatDate(new Date(w), tz, 'yyyy-MM-dd'); } catch (e) { return ''; } };
  var rows = ledger.filter(function (x) {
    if (email && x.email !== email) return false;
    if (kind && x.kind !== kind) return false;
    var d = day(x.when);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return x.points !== 0 || x.kind === 'rejected' || x.kind === 'fixed';
  }).sort(function (a, b) { return a.when < b.when ? 1 : a.when > b.when ? -1 : 0; });
  var sum = rows.reduce(function (a, x) { return a + x.points; }, 0);
  var byKind = {};
  rows.forEach(function (x) { var k = byKind[x.kind] || (byKind[x.kind] = { kind: x.kind, label: POINT_KINDS[x.kind], n: 0, points: 0 }); k.n++; k.points = Math.round((k.points + x.points) * 10) / 10; });
  return { rows: rows, total: Math.round(sum * 10) / 10, count: rows.length, byKind: Object.keys(byKind).map(function (k) { return byKind[k]; }) };
}

function api_pointsHistory(filter) {
  return respond_(function () {
    var u = currentUser_();
    var h = pointsHistory_(u, filter);
    var names = {};
    dbAll_('Users').forEach(function (x) { names[x.email.toLowerCase()] = profileName_(x); });
    return {
      total: h.total, count: h.count, byKind: h.byKind, kinds: POINT_KINDS,
      rows: h.rows.slice(0, 600).map(function (x) { return Object.assign({ name: names[x.email] || x.email }, x); }),
      truncated: h.rows.length > 600,
      people: isLeader_(u) ? dbFind_('Users', function (x) { return x.role === ROLES.DESIGNER || bool_(x.active); }).map(function (x) { return { email: x.email, name: profileName_(x) }; }) : []
    };
  });
}

/** True for timestamps in the current month, in the portal's time zone (not UTC). */
function monthFn_() {
  var tz = Session.getScriptTimeZone(), m = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  return function (d) { if (!d) return false; var t = new Date(d); return !isNaN(t) && Utilities.formatDate(t, tz, 'yyyy-MM') === m; };
}

function api_listRewards() {
  return respond_(function () {
    var u = currentUser_(), s = settings_();
    var table = pointsTable_(monthFn_());
    var board = dbFind_('Users', function (x) { return bool_(x.active) && x.role === ROLES.DESIGNER; }).map(function (x) {
      var t = table[x.email.toLowerCase()] || { total: 0, period: 0, creatives: 0, onTime: 0, rewards: 0, rejected: 0, firstTime: 0, creativePts: 0, rewardCount: 0 };
      var pf = profileOf_(x.email);
      return { email: x.email, name: x.name, nickname: pf.nickname || '', photo: pf.photo || '', designation: x.designation || '', total: t.total, month: t.period, creatives: t.creatives,
        onTime: t.onTime, rewards: t.rewards, rejected: t.rejected };
    }).sort(function (a, b) { return b.total - a.total || b.month - a.month || (a.name < b.name ? -1 : 1); });
    board.forEach(function (x, i) { x.rank = i + 1; });
    var rows = dbAll_('Rewards').filter(function (r) { return isLeader_(u) || String(r.userEmail).toLowerCase() === u.email; })
      .sort(function (a, b) { return a.givenAt < b.givenAt ? 1 : -1; }).slice(0, 200).map(rewardDto_);
    var me = table[u.email] || { total: 0, period: 0, creatives: 0, creativePts: 0, firstTime: 0, onTime: 0, rejected: 0, rewards: 0, rewardCount: 0 };
    var mine = board.filter(function (x) { return x.email === u.email; })[0];
    return {
      badges: REWARD_BADGES, leaderboard: board, items: rows,
      me: { total: me.total, month: me.period, count: me.rewardCount, rank: mine ? mine.rank : null, of: board.length,
        designation: (userByEmail_(u.email) || {}).designation || '',
        breakdown: { creatives: me.creatives, creativePts: me.creativePts, firstTime: me.firstTime, onTime: me.onTime, onTimePts: me.onTime * (Number(s.pointsOnTime) || 0),
          rejected: me.rejected, rejectedPts: me.rejected * (Number(s.pointsRejected) || 0), rewards: me.rewards, bonus: me.bonus || 0, bonusCount: me.bonusCount || 0,
          reopen: me.reopen || 0, reopenCount: me.reopenCount || 0, fixed: me.fixed || 0, fixedCount: me.fixedCount || 0 } },
      rules: { designations: s.designations, onTime: Number(s.pointsOnTime) || 0, firstTime: Number(s.pointsFirstTime) || 0, rejected: Number(s.pointsRejected) || 0,
        reopen: Number(s.pointsReopen) || 0, countEachSize: !!s.countEachSize }
    };
  });
}

function api_giveReward(input) {
  return respond_(function () {
    var u = requireLeader_();
    input = input || {};
    var email = email_(input.userEmail, 'Team member', true);
    var member = userByEmail_(email);
    if (!member || !bool_(member.active)) throw AppError_('VALIDATION', 'Choose an active team member.');
    if (member.email === u.email) throw AppError_('VALIDATION', 'You can’t reward yourself.');
    var badge = badgeOf_(String(input.badge || ''));
    if (!badge) throw AppError_('VALIDATION', 'Choose a reward.');
    var points = input.points === '' || input.points === undefined || input.points === null ? badge.points : int_(input.points, 1, 1000, 'Points');
    var reason = str_(input.reason, 300, 'Reason', false);
    var taskId = str_(input.taskId, 40, 'Task', false);
    return withLock_(function () {
      if (taskId && !dbGet_('Tasks', taskId)) throw AppError_('NOT_FOUND', 'Task not found.');
      var r = dbInsert_('Rewards', {
        rewardId: 'RWD-' + uuid_(), userEmail: member.email, badge: badge.id, points: String(points), reason: reason,
        taskId: taskId, givenBy: u.email, givenAt: nowIso_()
      });
      if (taskId) logActivity_(taskId, u, 'reward', '', badge.label + ' (+' + points + ')', reason, 'team');
      notify_([member.email], 'reward', 'You got a reward: ' + badge.label + ' (+' + points + ' points)',
        (reason ? '“' + reason + '”' : 'Great work!') + ' — ' + u.name, 'rewards', true);
      return rewardDto_(r);
    });
  });
}

function api_deleteReward(rewardId) {
  return respond_(function () {
    requireLeader_();
    rewardId = str_(rewardId, 60, 'Reward', true);
    return withLock_(function () {
      if (!dbDeleteWhere_('Rewards', function (r) { return r.rewardId === rewardId; })) throw AppError_('NOT_FOUND', 'Reward not found.');
      return true;
    });
  });
}
