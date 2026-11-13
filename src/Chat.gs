/**
 * Chat.gs — one team chat for everyone on the graphics team (like a WhatsApp
 * group). Messages, links and files (references, screenshots) stay inside
 * the portal; nothing is emailed. The team leader can turn it off in Settings.
 * The page asks for new messages every few seconds while it is open.
 */

var CHAT_PAGE = 150;

function requireChat_() {
  var u = currentUser_();
  if (!settings_().teamChat) throw AppError_('FORBIDDEN', 'Team chat is turned off by the team leader.');
  return u;
}

function chatDto_(m) {
  var del = !!m.deletedAt;
  return {
    messageId: m.messageId, author: m.authorEmail, text: del ? '' : m.text, createdAt: m.createdAt, deleted: del, deletedAt: m.deletedAt || '',
    file: !del && m.fileId ? { name: m.fileName, mime: m.mimeType, size: Number(m.sizeBytes) || 0, isImage: INLINE_IMAGE_TYPES.indexOf(m.mimeType) !== -1 } : null
  };
}

/** People who can appear in the chat: name, nickname, photo. */
function chatPeople_() {
  var out = {};
  dbAll_('Users').forEach(function (x) {
    var pf = profileOf_(x.email);
    out[x.email.toLowerCase()] = { name: x.name, nickname: pf.nickname || '', photo: pf.photo || '', role: x.role, designation: x.designation || '', active: bool_(x.active) };
  });
  return out;
}

/**
 * Messages. opts.since (ISO): only what is new or deleted after it (for polling).
 * opts.before (ISO): older messages for "Load earlier". Neither: the latest page, plus people.
 */
function api_chatList(opts) {
  return respond_(function () {
    var u = requireChat_();
    opts = opts || {};
    var all = dbAll_('ChatMessages').slice().sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0; });
    var since = String(opts.since || ''), before = String(opts.before || '');
    var list, more = false;
    if (since) list = all.filter(function (m) { return m.createdAt > since || (m.deletedAt && m.deletedAt > since); });
    else {
      var pool = before ? all.filter(function (m) { return m.createdAt < before; }) : all;
      more = pool.length > CHAT_PAGE;
      list = pool.slice(-CHAT_PAGE);
    }
    var out = { messages: list.map(chatDto_), more: more, now: nowIso_(), me: u.email, leader: isLeader_(u) };
    if (!since) out.people = chatPeople_();
    return out;
  });
}

function api_chatSend(text) {
  return respond_(function () {
    var u = requireChat_();
    text = str_(text, 2000, 'Message', true);
    rateLimit_('chat:' + u.email, 40, 60);
    return withLock_(function () {
      var m = dbInsert_('ChatMessages', { messageId: 'MSG-' + uuid_(), authorEmail: u.email, text: text, fileId: '', fileName: '', mimeType: '', sizeBytes: '', createdAt: nowIso_(), deletedAt: '' });
      markChatSeen_(u.email, m.createdAt);
      return chatDto_(m);
    });
  });
}

/** Your own message (or any, for the team leader). The file goes to Drive's trash. */
function api_chatDelete(messageId) {
  return respond_(function () {
    var u = requireChat_();
    return withLock_(function () {
      var m = dbGet_('ChatMessages', str_(messageId, 60, 'Message', true));
      if (!m || m.deletedAt) throw AppError_('NOT_FOUND', 'Message not found.');
      if (m.authorEmail !== u.email && !isLeader_(u)) throw AppError_('FORBIDDEN', 'You can only delete your own messages.');
      if (m.fileId) { try { DriveApp.getFileById(m.fileId).setTrashed(true); } catch (e) { /* already gone */ } }
      dbUpdate_('ChatMessages', m.messageId, { deletedAt: nowIso_(), text: '' });
      return true;
    });
  });
}

/** Remembers the newest message you've seen, for the unread count on "Team chat". */
function api_chatSeen(iso) {
  return respond_(function () {
    var u = requireChat_();
    iso = String(iso || nowIso_()).slice(0, 30);
    var pf = profileOf_(u.email);
    if (pf.chatSeenAt && pf.chatSeenAt >= iso) return true;
    return withLock_(function () { markChatSeen_(u.email, iso); return true; });
  });
}

function markChatSeen_(email, iso) {
  if (dbGet_('Profiles', email)) { var pf = dbGet_('Profiles', email); if (!pf.chatSeenAt || pf.chatSeenAt < iso) dbUpdate_('Profiles', email, { chatSeenAt: iso }); }
  else dbInsert_('Profiles', { email: email, nickname: '', photo: '', portfolioUrl: '', bio: '', theme: '', accentColor: '', chatSeenAt: iso, updatedAt: nowIso_() });
}

/** Unread messages from others since you last opened the chat (capped at 99). */
function chatUnread_(email) {
  if (!settings_().teamChat) return 0;
  var seen = profileOf_(email).chatSeenAt || '';
  var n = 0;
  dbAll_('ChatMessages').forEach(function (m) { if (!m.deletedAt && m.authorEmail !== email && m.createdAt > seen) n++; });
  return Math.min(n, 99);
}

/** A file shared in the chat, for anyone on the team. */
function chatAssetRef_(u, id) {
  if (!settings_().teamChat) throw AppError_('FORBIDDEN', 'Team chat is turned off.');
  var m = dbGet_('ChatMessages', str_(id, 60, 'Message', true));
  if (!m || !m.fileId || m.deletedAt) throw AppError_('NOT_FOUND', 'File not found.');
  return { fileId: m.fileId, mime: m.mimeType, size: m.sizeBytes, name: m.fileName };
}
