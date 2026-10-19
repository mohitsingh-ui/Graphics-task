/**
 * Auth.gs — identity and role checks.
 *
 * Identity comes from Google: the internal web app is deployed with
 * "Execute as: Me" and "Who has access: Anyone within <your domain>", so
 * Session.getActiveUser() returns the signed-in Workspace user's email.
 * On the public deployment it returns "" and every internal call is refused.
 *
 * Roles are looked up in the Users sheet on every call (no client-side
 * session state is trusted), so deactivating a user takes effect immediately.
 */

function activeEmail_() {
  var e = '';
  try { e = Session.getActiveUser().getEmail() || ''; } catch (err) { e = ''; }
  return String(e).toLowerCase().trim();
}

function userByEmail_(email) {
  email = String(email || '').toLowerCase();
  if (!email) return null;
  var rows = dbFind_('Users', function (u) { return u.email.toLowerCase() === email; });
  return rows[0] || null;
}

/** Current team member or throws. */
function currentUser_() {
  var email = activeEmail_();
  if (!email) throw AppError_('NOT_SIGNED_IN', 'Please open the internal portal link and sign in with your company Google account.');
  var u = userByEmail_(email);
  if (!u || !bool_(u.active)) throw AppError_('NO_ACCESS', 'Your account (' + email + ') does not have access to the graphics team portal. Ask your team leader to add you.');
  return { email: u.email.toLowerCase(), name: u.name, role: u.role, userId: u.userId };
}

function requireLeader_() {
  var u = currentUser_();
  if (u.role !== ROLES.LEADER) throw AppError_('FORBIDDEN', 'Only the team leader can do this.');
  return u;
}

function isLeader_(u) { return u && u.role === ROLES.LEADER; }

/**
 * Loads a task the current user may see. Designers get NOT_FOUND (not
 * FORBIDDEN) for tasks that aren't theirs so ids can't be probed.
 */
function requireTask_(user, taskId) {
  var task = dbGet_('Tasks', str_(taskId, 40, 'Task ID', true));
  if (!task) throw AppError_('NOT_FOUND', 'Task not found.');
  if (isLeader_(user)) return task;
  if (task.assigneeEmail && task.assigneeEmail.toLowerCase() === user.email) return task;
  throw AppError_('NOT_FOUND', 'Task not found.');
}

/** Guard for functions that must only run from the script editor / triggers by the owner. */
function guardOwner_() {
  var effective = '';
  try { effective = Session.getEffectiveUser().getEmail().toLowerCase(); } catch (e) { effective = ''; }
  var active = activeEmail_();
  if (!effective || active !== effective) throw new Error('This function can only be run by the script owner from the Apps Script editor.');
}

function displayName_(email) {
  var u = userByEmail_(email);
  return u ? u.name : email;
}
