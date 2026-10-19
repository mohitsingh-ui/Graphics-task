/**
 * Util.gs — errors, the API wrapper, ids, hashing, validation helpers.
 * Functions ending in "_" are private: google.script.run cannot call them.
 */

function AppError_(code, message) {
  var e = new Error(message || code);
  e.appCode = code;
  e.isAppError = true;
  return e;
}

/**
 * Wraps every client-callable function. Known errors go back with a friendly
 * message; anything unexpected is logged server-side and returned as a
 * generic message so internals never leak to the browser.
 */
function respond_(fn) {
  try {
    var data = fn();
    return { ok: true, data: data === undefined ? null : data };
  } catch (err) {
    if (err && err.isAppError) {
      return { ok: false, error: { code: err.appCode, message: err.message } };
    }
    var ref = Utilities.getUuid().slice(0, 8);
    console.error('[' + ref + '] ' + (err && err.stack ? err.stack : err));
    return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong on our side (ref ' + ref + '). Please try again.' } };
  }
}

function nowIso_() { return new Date().toISOString(); }

function uuid_() { return Utilities.getUuid(); }

/** 256-bit random token, URL-safe. */
function randomToken_() {
  var raw = Utilities.getUuid() + Utilities.getUuid() + Date.now() + Math.random();
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw + Utilities.getUuid());
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function sha256_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

/** Sequential human id like GFX-2026-0001. Caller must hold the script lock. */
function nextSeqId_(prefix) {
  var year = new Date().getFullYear();
  var key = 'seq_' + prefix + '_' + year;
  var current = Number(getSettingRaw_(key) || 0) + 1;
  setSettingRaw_(key, String(current));
  return prefix + '-' + year + '-' + ('000' + current).slice(-Math.max(4, String(current).length));
}

/* ---------- validation ---------- */

function str_(v, max, field, required) {
  var s = v === null || v === undefined ? '' : String(v).trim();
  if (required && !s) throw AppError_('VALIDATION', (field || 'A required field') + ' is required.');
  if (s.length > (max || LIMITS.TEXT_SHORT)) throw AppError_('VALIDATION', (field || 'A field') + ' is too long.');
  return s;
}

function email_(v, field, required) {
  var s = str_(v, 254, field || 'Email', required).toLowerCase();
  if (s && !/^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(s)) throw AppError_('VALIDATION', (field || 'Email') + ' is not a valid email address.');
  return s;
}

function int_(v, min, max, field) {
  var n = Number(v);
  if (!isFinite(n) || Math.floor(n) !== n || n < min || n > max) {
    throw AppError_('VALIDATION', (field || 'Number') + ' must be a whole number between ' + min + ' and ' + max + '.');
  }
  return n;
}

function date_(v, field, required) {
  var s = str_(v, 30, field, required);
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s + 'T00:00:00').getTime())) {
    throw AppError_('VALIDATION', (field || 'Date') + ' is not a valid date.');
  }
  return s;
}

/** Keep only http(s) URLs, one per line. */
function urls_(v) {
  var list = Array.isArray(v) ? v : String(v || '').split(/[\n,\s]+/);
  var out = [];
  list.forEach(function (u) {
    u = String(u || '').trim();
    if (!u) return;
    if (!/^https?:\/\/[^\s<>"']+$/i.test(u) || u.length > 1000) throw AppError_('VALIDATION', 'Reference links must start with http:// or https://');
    if (out.indexOf(u) === -1) out.push(u);
  });
  if (out.length > 20) throw AppError_('VALIDATION', 'Please add at most 20 reference links.');
  return out;
}

function oneOf_(v, list, field) {
  if (list.indexOf(v) === -1) throw AppError_('VALIDATION', (field || 'Value') + ' is not allowed.');
  return v;
}

function extOf_(name) {
  var m = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

/** Strip path parts and odd characters from an uploaded file name. */
function safeFileName_(name) {
  var base = String(name || 'file').split(/[\\/]/).pop();
  base = base.replace(/[^\w.\- ()]+/g, '_').replace(/\s+/g, ' ').trim();
  return (base || 'file').slice(0, 120);
}

function isoDateOnly_(d) {
  return Utilities.formatDate(d || new Date(), Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd');
}

/** End of the due date (23:59:59 in the script time zone) as a Date. */
function dueEnd_(dueDate) {
  if (!dueDate) return null;
  var d = new Date(dueDate + 'T23:59:59' + tzOffset_());
  return isNaN(d.getTime()) ? null : d;
}

function tzOffset_() {
  var z = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kolkata', 'Z'); // +0530
  return z.slice(0, 3) + ':' + z.slice(3);
}

function isOverdue_(task) {
  if (CLOSED.indexOf(task.status) !== -1 || task.status === STATUS.APPROVED || task.status === STATUS.ON_HOLD) return false;
  var end = dueEnd_(task.dueDate);
  return !!end && end.getTime() < Date.now();
}

function bool_(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1'; }

function pick_(obj, keys) {
  var o = {};
  keys.forEach(function (k) { if (obj && obj[k] !== undefined) o[k] = obj[k]; });
  return o;
}

function parseJson_(s, fallback) {
  if (s === '' || s === null || s === undefined) return fallback;
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

/** Minimal HTML escaping for email bodies. */
function esc_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** Simple fixed-window rate limiter using CacheService. */
function rateLimit_(key, max, windowSec) {
  var cache = CacheService.getScriptCache();
  var k = 'rl_' + sha256_(key).slice(0, 40);
  var n = Number(cache.get(k) || 0);
  if (n >= max) throw AppError_('RATE_LIMIT', 'Too many requests. Please wait a few minutes and try again.');
  cache.put(k, String(n + 1), windowSec);
}
