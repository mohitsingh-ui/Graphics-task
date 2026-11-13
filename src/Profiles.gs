/**
 * Profiles.gs — every team member's own profile: nickname, photo, portfolio
 * link, a short bio and (if the leader allows it) their own portal colours.
 * The profile page also shows their points, rank and tips to grow.
 */

var PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;

/** The profile row for an email ({} when they haven't set anything). */
function profileOf_(email) {
  email = String(email || '').toLowerCase();
  return (email && dbGet_('Profiles', email)) || {};
}

/** Display name for lists and history (the real name; the nickname is shown beside it). */
function profileName_(user) { return user ? user.name : ''; }

function publicProfile_(x, table, board) {
  var pf = profileOf_(x.email), t = (table && table[x.email.toLowerCase()]) || { total: 0, period: 0 };
  var rank = board ? board.filter(function (b) { return b.email === x.email; })[0] : null;
  return {
    email: x.email, name: x.name, nickname: pf.nickname || '', photo: pf.photo || '', role: x.role, designation: x.designation || '',
    portfolioUrl: pf.portfolioUrl || '', bio: pf.bio || '', active: bool_(x.active),
    points: t.total || 0, month: t.period || 0, rank: rank ? rank.rank : null
  };
}

/** Leaderboard order for designers (same as the Leaderboard page). */
function boardOf_(table) {
  var list = dbFind_('Users', function (x) { return bool_(x.active) && x.role === ROLES.DESIGNER; }).map(function (x) {
    var t = table[x.email.toLowerCase()] || { total: 0, period: 0 };
    return { email: x.email, name: x.name, total: t.total, month: t.period };
  }).sort(function (a, b) { return b.total - a.total || b.month - a.month || (a.name < b.name ? -1 : 1); });
  list.forEach(function (x, i) { x.rank = i + 1; });
  return list;
}

/** Profile page. email = '' for your own; any team member can see a teammate's profile. */
function api_getProfile(email) {
  return respond_(function () {
    var u = currentUser_(), s = settings_();
    var target = email ? userByEmail_(email_(email, 'Email', true)) : userByEmail_(u.email);
    if (!target) throw AppError_('NOT_FOUND', 'Team member not found.');
    var mine = target.email.toLowerCase() === u.email;
    var table = pointsTable_(monthFn_()), board = boardOf_(table);
    var out = publicProfile_(target, table, board);
    out.mine = mine; out.of = board.length;
    var t = table[target.email.toLowerCase()] || {};
    out.breakdown = { creatives: t.creatives || 0, creativePts: t.creativePts || 0, firstTime: t.firstTime || 0, onTime: t.onTime || 0, bonus: t.bonus || 0,
      reopen: t.reopen || 0, reopenCount: t.reopenCount || 0, rewards: t.rewards || 0, rewardCount: t.rewardCount || 0, rejected: t.rejected || 0 };
    var tasks = dbFind_('Tasks', function (x) { return x.assigneeEmail === target.email.toLowerCase(); });
    out.stats = {
      active: tasks.filter(function (x) { return CLOSED.indexOf(x.status) === -1 && x.status !== STATUS.APPROVED; }).length,
      completed: tasks.filter(function (x) { return x.status === STATUS.COMPLETED; }).length
    };
    out.team = dbFind_('Users', function (x) { return bool_(x.active); }).map(function (x) { return publicProfile_(x, table, board); })
      .sort(function (a, b) { return (a.rank || 99) - (b.rank || 99) || (a.name < b.name ? -1 : 1); });
    if (mine || isLeader_(u)) {
      out.tips = profileTips_(target, out, t, tasks, s);
      out.completeness = profileCompleteness_(out);
    }
    if (mine) {
      var pf = profileOf_(target.email);
      out.theme = pf.theme || ''; out.accentColor = pf.accentColor || '';
      out.allowPersonalTheme = !!s.allowPersonalTheme;
      out.themes = Object.keys(THEMES).map(function (k) { return { id: k, label: THEMES[k].label, accent: THEMES[k].accent, dark: !!THEMES[k].dark }; });
      out.teamTheme = s.theme; out.teamAccent = s.accentColor;
      var hist = pointsHistory_(u, {});
      out.recent = hist.rows.slice(0, 8);
    }
    return out;
  });
}

function profileCompleteness_(p) {
  var items = [
    { key: 'photo', label: 'Add a profile photo', done: !!p.photo },
    { key: 'nickname', label: 'Pick a nickname the team knows you by', done: !!p.nickname },
    { key: 'portfolio', label: 'Add your portfolio link (Behance, Dribbble, Drive…)', done: !!p.portfolioUrl },
    { key: 'bio', label: 'Write a line about what you love designing', done: !!p.bio }
  ];
  return { percent: Math.round(items.filter(function (i) { return i.done; }).length / items.length * 100), items: items };
}

/** Plain tips from the person's own numbers. */
function profileTips_(user, p, t, tasks, s) {
  var tips = [];
  var created = Number(t.creatives) || 0, first = s.pointsFirstTime ? (Number(t.firstTime) || 0) / Number(s.pointsFirstTime) : 0;
  var done = tasks.filter(function (x) { return x.status === STATUS.COMPLETED; });
  var onTime = Number(t.onTime) || 0;
  if (created >= 3 && s.pointsFirstTime && first / created < 0.6) {
    tips.push('Only ' + Math.round(first / created * 100) + '% of your creatives get approved first time. Re-read the brief and references before you send — each first-time approval adds +' + s.pointsFirstTime + '.');
  } else if (created >= 3 && s.pointsFirstTime) {
    tips.push(Math.round(first / created * 100) + '% of your creatives are approved first time — great. Keep checking the brief before sending.');
  }
  if (done.length >= 2 && s.pointsOnTime && onTime / done.length < 0.8) {
    tips.push(onTime + ' of ' + done.length + ' finished tasks were on time. Tell your leader early if a deadline looks tight — on-time tasks add +' + s.pointsOnTime + ' each.');
  }
  if (Number(t.rejected)) tips.push(t.rejected + ' creative(s) were rejected. Ask the requester for the reason so the next one lands.');
  if (!p.portfolioUrl) tips.push('Add your portfolio link so the team can see your best work.');
  if (!p.photo) tips.push('Add a photo — it shows on the leaderboard and in team chat.');
  if (s.pointsReopen) tips.push('Reopened tasks earn +' + s.pointsReopen + ' once you finish the changes.');
  if (!tasks.filter(function (x) { return CLOSED.indexOf(x.status) === -1; }).length) tips.push('No open tasks right now — ask your leader for the next one.');
  return tips.slice(0, 6);
}

/** Save your own profile. Only the fields given are changed. */
function api_saveProfile(input) {
  return respond_(function () {
    var u = currentUser_(), s = settings_();
    input = input || {};
    var patch = {};
    if (input.nickname !== undefined) patch.nickname = str_(input.nickname, 40, 'Nickname', false);
    if (input.bio !== undefined) patch.bio = str_(input.bio, 300, 'About you', false);
    if (input.portfolioUrl !== undefined) {
      var url = str_(input.portfolioUrl, 500, 'Portfolio link', false);
      if (url && !/^https?:\/\/[^\s<>"']+$/i.test(url)) throw AppError_('VALIDATION', 'The portfolio link must start with https://');
      patch.portfolioUrl = url;
    }
    if (input.photo !== undefined) {
      var ph = String(input.photo || '');
      if (ph && (!PHOTO_RE.test(ph) || ph.length > 60000)) throw AppError_('VALIDATION', 'That photo couldn’t be used. Try a JPG or PNG.');
      patch.photo = ph;
    }
    if (input.theme !== undefined || input.accentColor !== undefined) {
      if (!s.allowPersonalTheme) throw AppError_('FORBIDDEN', 'The team leader has turned off personal colours.');
      var th = String(input.theme || '');
      if (th && !THEMES[th]) throw AppError_('VALIDATION', 'Unknown theme.');
      var acc = String(input.accentColor || '').trim().toLowerCase();
      if (acc && !/^#[0-9a-f]{6}$/.test(acc)) throw AppError_('VALIDATION', 'Colour must look like #a56312.');
      patch.theme = th; patch.accentColor = th ? acc : '';
    }
    if (!Object.keys(patch).length) throw AppError_('VALIDATION', 'Nothing to save.');
    return withLock_(function () {
      patch.updatedAt = nowIso_();
      if (dbGet_('Profiles', u.email)) dbUpdate_('Profiles', u.email, patch);
      else dbInsert_('Profiles', Object.assign({ email: u.email, nickname: '', photo: '', portfolioUrl: '', bio: '', theme: '', accentColor: '', chatSeenAt: '' }, patch));
      return { saved: Object.keys(patch) };
    });
  });
}
