/**
 * Notifications.gs — audit log, in-app notifications and email.
 * Emails never mention which designer owns a task unless the recipient is
 * a team leader or that designer.
 */

/** Append to the task audit trail. visibility: 'team' (leader + assignee) or 'leader'. */
function logActivity_(taskId, actor, action, fromValue, toValue, note, visibility) {
  dbInsert_('TaskActivity', {
    activityId: 'ACT-' + uuid_(),
    taskId: taskId,
    actorEmail: actor ? actor.email || actor : 'system',
    actorRole: actor && actor.role ? actor.role : (actor === 'reviewer' ? 'reviewer' : 'system'),
    action: action,
    fromValue: fromValue || '',
    toValue: toValue || '',
    note: note || '',
    visibility: visibility || 'team',
    createdAt: nowIso_()
  });
}

function leaderEmails_() {
  return dbFind_('Users', function (u) { return u.role === ROLES.LEADER && bool_(u.active); })
    .map(function (u) { return u.email.toLowerCase(); });
}

/**
 * In-app notification (+ optional email) to team members.
 * route is an in-app path like "task/GFX-2026-0001".
 */
function notify_(emails, type, title, body, route, sendEmail) {
  var seen = {};
  var s = settings_();
  (emails || []).forEach(function (email) {
    email = String(email || '').toLowerCase();
    if (!email || seen[email]) return;
    seen[email] = true;
    dbInsert_('Notifications', {
      notificationId: 'NTF-' + uuid_(), recipientEmail: email, type: type, title: title, body: body,
      route: route || '', createdAt: nowIso_(), readAt: ''
    });
    if (sendEmail !== false && s.emailNotifications && mailRule_(NOTIFY_KIND_[type] || type)) {
      var link = s.internalUrl ? s.internalUrl + '?p=app&r=' + encodeURIComponent(route || '') : '';
      sendMail_(email, title, body, link ? { label: 'Open in portal', url: link } : null);
    }
  });
}

/** Notification type → the email switch in Settings → Emails (EMAIL_KINDS). */
var NOTIFY_KIND_ = {
  task_reassigned: 'task_assigned', creative_rejected: 'creative_changes', creative_skipped: 'creative_changes', changes_requested: 'creative_changes',
  task_overdue: 'task_due', task_due_soon: 'task_due', final_link: 'task_completed', request_edited: 'change_request'
};

/** True when the leader has this automatic email switched on (Settings → Emails). Unknown kinds are on. */
function mailRule_(kind) {
  if (!kind) return true;
  var k = EMAIL_KINDS.filter(function (x) { return x.id === kind; })[0];
  if (!k || k.always) return true;
  var rules = settings_().emailRules || {};
  return rules.hasOwnProperty(kind) ? rules[kind] !== false : k.def !== false;
}

/** Everyone who owns a request: the person who raised it plus anyone added as a co-owner. */
function requesterEmails_(r) {
  var out = [];
  [r && r.email].concat(coOwnersOf_(r)).forEach(function (e) { e = String(e || '').toLowerCase().trim(); if (e && out.indexOf(e) === -1) out.push(e); });
  return out;
}

function coOwnersOf_(r) {
  return String((r && r.coOwners) || '').split(/[\s,;]+/).map(function (e) { return e.toLowerCase().trim(); }).filter(Boolean);
}

/** Email the requester (and co-owners) if that kind of email is switched on. */
function mailRequesters_(r, kind, subject, body, button) {
  if (!settings_().emailNotifications || !mailRule_(kind)) return 0;
  var list = requesterEmails_(r);
  list.forEach(function (e) { sendMail_(e, subject, body, typeof button === 'function' ? button(e) : button); });
  return list.length;
}

var MAIL_QUEUE_ = [];

/** Queue an email; it is sent once the database lock is released, so saves stay quick for everyone. */
function sendMail_(to, subject, bodyText, button) {
  if (LOCK_DEPTH_ > 0) { MAIL_QUEUE_.push([to, subject, bodyText, button]); return true; }
  return sendMailNow_(to, subject, bodyText, button);
}

function flushMail_() {
  var q = MAIL_QUEUE_; MAIL_QUEUE_ = [];
  q.forEach(function (m) { sendMailNow_(m[0], m[1], m[2], m[3]); });
}

function sendMailNow_(to, subject, bodyText, button) {
  try {
    if (MailApp.getRemainingDailyQuota() < 1) { console.warn('Mail quota exhausted; skipped email to ' + to); return false; }
    var s = settings_();
    var html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#1f1d1a;line-height:1.55">' +
      '<p style="font-size:12px;color:#7a746b;margin:0 0 16px">' + esc_(s.companyName) + ' · ' + esc_(s.portalName) + '</p>' +
      '<h2 style="font-size:18px;margin:0 0 12px">' + esc_(subject) + '</h2>' +
      '<p style="white-space:pre-line;margin:0 0 20px">' + esc_(bodyText) + '</p>' +
      (button ? '<p><a href="' + esc_(button.url) + '" style="background:#A56312;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">' + esc_(button.label) + '</a></p>' : '') +
      '<p style="font-size:12px;color:#7a746b;margin-top:28px">This is an automated message from the graphics team portal.</p></div>';
    MailApp.sendEmail({ to: to, subject: '[' + s.portalName + '] ' + subject, htmlBody: html,
      body: bodyText + (button ? '\n\n' + button.label + ': ' + button.url : ''), name: s.portalName });
    return true;
  } catch (e) {
    console.warn('Email to ' + to + ' failed: ' + e);
    return false;
  }
}

/* ---------- client API ---------- */

function api_getNotifications() {
  return respond_(function () {
    var u = currentUser_();
    var mine = dbFind_('Notifications', function (n) { return n.recipientEmail === u.email; })
      .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    var chat = 0;
    try { chat = chatUnread_(u.email); } catch (e) { chat = 0; }
    return {
      chatUnread: chat,
      unread: mine.filter(function (n) { return !n.readAt; }).length,
      items: mine.slice(0, 40).map(function (n) {
        return pick_(n, ['notificationId', 'type', 'title', 'body', 'route', 'createdAt', 'readAt']);
      })
    };
  });
}

function api_markNotificationsRead(ids) {
  return respond_(function () {
    var u = currentUser_();
    var all = ids === 'all';
    var set = {};
    if (!all) (Array.isArray(ids) ? ids : []).slice(0, 200).forEach(function (i) { set[i] = true; });
    withLock_(function () {
      dbFind_('Notifications', function (n) {
        return n.recipientEmail === u.email && !n.readAt && (all || set[n.notificationId]);
      }).forEach(function (n) { dbUpdate_('Notifications', n.notificationId, { readAt: nowIso_() }); });
    });
    return true;
  });
}
