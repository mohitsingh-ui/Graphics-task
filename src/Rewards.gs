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
 *   + first-time bonus when a creative was approved with no changes asked
 *   + on-time bonus for each task completed by its deadline (paused hold time isn't counted)
 *   − rejection penalty per rejected creative (if set)
 *   + reward points from the team leader
 * inPeriod(dateIso) → true marks points that also count for the period (e.g. this month).
 */
function pointsTable_(inPeriod) {
  var s = settings_(), per = {};
  inPeriod = inPeriod || function () { return false; };
  var users = {}; dbAll_('Users').forEach(function (x) { users[x.email.toLowerCase()] = x; });
  function P(e) {
    e = String(e || '').toLowerCase();
    return per[e] || (per[e] = { email: e, total: 0, period: 0, creatives: 0, creativePts: 0, firstTime: 0, onTime: 0, rejected: 0, rewards: 0, rewardCount: 0,
      // the same, counted only inside the period: { n: how many, pts: points }
      inPeriod: { creatives: { n: 0, pts: 0 }, firstTime: { n: 0, pts: 0 }, onTime: { n: 0, pts: 0 }, rejected: { n: 0, pts: 0 }, rewards: { n: 0, pts: 0 } } });
  }
  function add(e, pts, when, field, n) {
    if (!e) return;
    var x = P(e); x.total += pts; if (inPeriod(when)) x.period += pts;
    if (field) x[field] += (n === undefined ? pts : n);
  }
  function tally(e, kind, pts, when) {
    if (!e || !inPeriod(when)) return;
    var b = P(e).inPeriod[kind]; b.n++; b.pts += pts;
  }
  var versions = {}; dbAll_('CreativeVersions').forEach(function (v) { versions[v.versionId] = v; });
  var decByDel = {};
  dbAll_('ApprovalDecisions').forEach(function (d) { (decByDel[d.deliverableId] = decByDel[d.deliverableId] || []).push(d); });
  dbAll_('CreativeSubmissions').forEach(function (d) {
    var v = d.approvedVersionId && versions[d.approvedVersionId];
    var decs = (decByDel[d.deliverableId] || []).sort(function (a, b) { return a.decidedAt < b.decidedAt ? -1 : 1; });
    if (v && v.status === VSTATUS.APPROVED) {
      var who = String(v.uploadedBy).toLowerCase();
      var ok = decs.filter(function (x) { return x.versionId === v.versionId && x.decision === 'approved'; }).pop();
      var when = ok ? ok.decidedAt : v.uploadedAt;
      var pts = designationPoints_(users[who]);
      add(who, pts, when, 'creativePts');
      P(who).creatives++;
      tally(who, 'creatives', pts, when);
      var hadChanges = decs.some(function (x) { return x.decidedAt <= when && (x.decision === 'changes' || x.decision === 'rejected'); });
      if (!hadChanges && Number(s.pointsFirstTime)) { add(who, Number(s.pointsFirstTime), when, 'firstTime'); tally(who, 'firstTime', Number(s.pointsFirstTime), when); }
    }
    decs.forEach(function (x) {
      if (x.decision !== 'rejected') return;
      var rv = versions[x.versionId]; if (!rv) return;
      var w = String(rv.uploadedBy).toLowerCase();
      P(w).rejected++;
      tally(w, 'rejected', -(Number(s.pointsRejected) || 0), x.decidedAt);
      if (Number(s.pointsRejected)) add(w, -Number(s.pointsRejected), x.decidedAt);
    });
  });
  if (Number(s.pointsOnTime)) {
    dbAll_('Tasks').forEach(function (t) {
      if (t.status !== STATUS.COMPLETED || !t.assigneeEmail || !t.completedAt || !t.dueDate) return;
      var end = dueEnd_(t.dueDate, t.dueTime);
      if (end && new Date(t.completedAt).getTime() <= end.getTime()) { add(t.assigneeEmail, Number(s.pointsOnTime), t.completedAt, 'onTime', 1); tally(t.assigneeEmail, 'onTime', Number(s.pointsOnTime), t.completedAt); }
    });
  }
  dbAll_('Rewards').forEach(function (r) { add(r.userEmail, Number(r.points) || 0, r.givenAt, 'rewards'); P(r.userEmail).rewardCount++; tally(r.userEmail, 'rewards', Number(r.points) || 0, r.givenAt); });
  return per;
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
      return { email: x.email, name: x.name, designation: x.designation || '', total: t.total, month: t.period, creatives: t.creatives,
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
          rejected: me.rejected, rejectedPts: me.rejected * (Number(s.pointsRejected) || 0), rewards: me.rewards } },
      rules: { designations: s.designations, onTime: Number(s.pointsOnTime) || 0, firstTime: Number(s.pointsFirstTime) || 0, rejected: Number(s.pointsRejected) || 0 }
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
