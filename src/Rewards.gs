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

/** Points per person: total and this month. */
function rewardTotals_() {
  var month = isoDateOnly_().slice(0, 7), by = {};
  dbAll_('Rewards').forEach(function (r) {
    var e = String(r.userEmail).toLowerCase();
    var x = by[e] || (by[e] = { email: e, total: 0, month: 0, count: 0 });
    var p = Number(r.points) || 0;
    x.total += p; x.count++;
    if (String(r.givenAt).slice(0, 7) === month) x.month += p;
  });
  return by;
}

function api_listRewards() {
  return respond_(function () {
    var u = currentUser_();
    var totals = rewardTotals_();
    var board = dbFind_('Users', function (x) { return bool_(x.active) && x.role === ROLES.DESIGNER; }).map(function (x) {
      var t = totals[x.email.toLowerCase()] || { total: 0, month: 0, count: 0 };
      return { email: x.email, name: x.name, total: t.total, month: t.month, count: t.count };
    }).sort(function (a, b) { return b.total - a.total || b.month - a.month || (a.name < b.name ? -1 : 1); });
    var rows = dbAll_('Rewards').filter(function (r) { return isLeader_(u) || String(r.userEmail).toLowerCase() === u.email; })
      .sort(function (a, b) { return a.givenAt < b.givenAt ? 1 : -1; }).slice(0, 200).map(rewardDto_);
    var me = totals[u.email] || { total: 0, month: 0, count: 0 };
    return { badges: REWARD_BADGES, leaderboard: board, items: rows, me: { total: me.total, month: me.month, count: me.count } };
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
