
/* ======================= Config.gs ======================= */
/**
 * Config.gs — constants, schema and default settings.
 * Everything here is static. Runtime settings live in the Settings sheet.
 */

var APP_NAME = 'Graphics Team Portal';

/** Sheet name → column list. The first column is the primary key. */
var SCHEMA = {
  Users: ['userId', 'email', 'name', 'role', 'active', 'createdAt', 'updatedAt', 'designation'],
  Departments: ['departmentId', 'name', 'active', 'createdAt'],
  Requirements: ['requirementId', 'requesterName', 'department', 'email', 'phone', 'title', 'creativeType',
    'purpose', 'brief', 'campaign', 'product', 'quantity', 'dimensions', 'platform', 'copyText',
    'referenceUrls', 'typeFields', 'preferredDate', 'priorityRequested', 'instructions', 'folderId',
    'status', 'notifiedAt', 'submittedAt', 'updatedAt', 'preferredTime', 'submittedBy', 'finalFolderId', 'finalShared', 'campaignId'],
  ReferenceFiles: ['attachmentId', 'requirementId', 'taskId', 'fileId', 'fileName', 'mimeType', 'sizeBytes',
    'uploadedBy', 'uploadedAt'],
  Tasks: ['taskId', 'requirementId', 'title', 'brief', 'creativeType', 'purpose', 'campaign', 'product',
    'deliverablesRequired', 'dimensions', 'formats', 'copyText', 'referenceUrls', 'assigneeEmail',
    'assignedBy', 'assignedAt', 'startDate', 'dueDate', 'priority', 'status', 'prevStatus', 'progress',
    'instructions', 'internalNotes', 'folderId', 'completedAt', 'dueSoonNotifiedAt', 'overdueNotifiedAt',
    'createdBy', 'createdAt', 'updatedAt', 'dueTime', 'finalLink',
    'holdReason', 'holdParty', 'holdDept', 'holdSince', 'heldMs', 'reopenedAt', 'reopenReason', 'reopenCount', 'folderPath', 'bonusPoints'],
  TaskAssignments: ['assignmentId', 'taskId', 'assigneeEmail', 'previousAssignee', 'assignedBy', 'dueDate',
    'priority', 'note', 'assignedAt', 'dueTime'],
  TaskActivity: ['activityId', 'taskId', 'actorEmail', 'actorRole', 'action', 'fromValue', 'toValue', 'note',
    'visibility', 'createdAt'],
  CreativeSubmissions: ['deliverableId', 'taskId', 'title', 'purpose', 'deliverableType', 'status',
    'latestVersionNo', 'latestVersionId', 'approvedVersionId', 'createdBy', 'createdAt', 'updatedAt'],
  CreativeVersions: ['versionId', 'deliverableId', 'taskId', 'versionNo', 'fileId', 'fileName', 'mimeType',
    'sizeBytes', 'note', 'uploadedBy', 'uploadedAt', 'status', 'submittedAt', 'approvedFileId'],
  ApprovalRequests: ['requestId', 'versionId', 'deliverableId', 'taskId', 'status', 'createdBy', 'createdAt',
    'closedAt'],
  ReviewTokens: ['tokenId', 'requestId', 'tokenHash', 'createdBy', 'createdAt', 'expiresAt', 'revokedAt',
    'revokeReason', 'lastOpenedAt'],
  ApprovalDecisions: ['decisionId', 'requestId', 'versionId', 'deliverableId', 'taskId', 'decision', 'comment',
    'reviewerName', 'reviewerEmail', 'channel', 'decidedBy', 'decidedAt'],
  Notifications: ['notificationId', 'recipientEmail', 'type', 'title', 'body', 'route', 'createdAt', 'readAt'],
  Settings: ['key', 'value', 'updatedAt'],
  RequesterLinks: ['linkId', 'email', 'tokenHash', 'createdAt', 'expiresAt', 'lastUsedAt'],
  Rewards: ['rewardId', 'userEmail', 'badge', 'points', 'reason', 'taskId', 'givenBy', 'givenAt'],
  ReviewBatches: ['batchId', 'tokenHash', 'title', 'versionIds', 'createdBy', 'createdAt', 'expiresAt', 'revokedAt', 'lastOpenedAt'],
  Campaigns: ['campaignId', 'name', 'folderId', 'shared', 'active', 'createdBy', 'createdAt', 'updatedAt'],
  TaskShares: ['shareId', 'tokenHash', 'taskId', 'note', 'createdBy', 'createdAt', 'expiresAt', 'revokedAt', 'lastOpenedAt']
};

/** Bump when columns are appended to SCHEMA; Db.gs migrates the live sheet once. */
var SCHEMA_VERSION = 10;

var ROLES = { LEADER: 'leader', DESIGNER: 'designer' };

var STATUS = {
  NEW: 'New Requirement',
  UNDER_REVIEW: 'Under Review',
  READY: 'Ready for Assignment',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  SUBMITTED: 'Submitted for Approval',
  CHANGES: 'Changes Requested',
  RESUBMITTED: 'Resubmitted for Approval',
  APPROVED: 'Approved',
  COMPLETED: 'Completed',
  ON_HOLD: 'On Hold',
  CANCELLED: 'Cancelled'
};

var STATUS_ORDER = [STATUS.NEW, STATUS.UNDER_REVIEW, STATUS.READY, STATUS.ASSIGNED, STATUS.IN_PROGRESS,
  STATUS.SUBMITTED, STATUS.CHANGES, STATUS.RESUBMITTED, STATUS.APPROVED, STATUS.COMPLETED, STATUS.ON_HOLD,
  STATUS.CANCELLED];

/** Who a task is waiting on while it is on hold. Only 'internal' counts against the graphics team. */
var HOLD_PARTIES = { requester: 'The requester', other: 'Another department', internal: 'Our team' };

/** Statuses where the task still needs an owner. */
var PRE_ASSIGN = [STATUS.NEW, STATUS.UNDER_REVIEW, STATUS.READY];
/** Statuses that count as "closed". */
var CLOSED = [STATUS.COMPLETED, STATUS.CANCELLED];

/** Deliverable (creative submission) and version statuses. */
var DSTATUS = { DRAFT: 'Draft', AWAITING: 'Awaiting Approval', CHANGES: 'Changes Requested', APPROVED: 'Approved', REJECTED: 'Rejected' };
var VSTATUS = { DRAFT: 'Draft', AWAITING: 'Awaiting Approval', CHANGES: 'Changes Requested', APPROVED: 'Approved',
  SUPERSEDED: 'Superseded', REJECTED: 'Rejected' };

/**
 * Manual status transitions. System transitions (upload, review decisions)
 * are applied by recomputeTaskStatus_ and are not listed here.
 * Format: from → { to: [roles allowed] }
 */
var MANUAL_TRANSITIONS = (function () {
  var L = [ROLES.LEADER], LD = [ROLES.LEADER, ROLES.DESIGNER];
  var t = {};
  t[STATUS.NEW] = mk([[STATUS.UNDER_REVIEW, L], [STATUS.READY, L], [STATUS.ON_HOLD, L], [STATUS.CANCELLED, L]]);
  t[STATUS.UNDER_REVIEW] = mk([[STATUS.READY, L], [STATUS.NEW, L], [STATUS.ON_HOLD, L], [STATUS.CANCELLED, L]]);
  t[STATUS.READY] = mk([[STATUS.UNDER_REVIEW, L], [STATUS.ON_HOLD, L], [STATUS.CANCELLED, L]]);
  t[STATUS.ASSIGNED] = mk([[STATUS.IN_PROGRESS, LD], [STATUS.ON_HOLD, L], [STATUS.CANCELLED, L]]);
  t[STATUS.IN_PROGRESS] = mk([[STATUS.ON_HOLD, L], [STATUS.CANCELLED, L]]);
  t[STATUS.SUBMITTED] = mk([[STATUS.ON_HOLD, L], [STATUS.CANCELLED, L]]);
  t[STATUS.CHANGES] = mk([[STATUS.ON_HOLD, L], [STATUS.CANCELLED, L]]);
  t[STATUS.RESUBMITTED] = mk([[STATUS.ON_HOLD, L], [STATUS.CANCELLED, L]]);
  t[STATUS.APPROVED] = mk([[STATUS.COMPLETED, L], [STATUS.IN_PROGRESS, L]]);
  t[STATUS.COMPLETED] = mk([]);                                      // reopen: api_reopenTask
  t[STATUS.ON_HOLD] = mk([[STATUS.CANCELLED, L]]);                   // resume handled separately
  t[STATUS.CANCELLED] = mk([[STATUS.NEW, L]]);                       // restore
  function mk(pairs) { var o = {}; pairs.forEach(function (p) { o[p[0]] = p[1]; }); return o; }
  return t;
})();

var PROGRESS_STEPS = [0, 25, 50, 75, 100];

/** Default settings. Leaders can change these from the Settings page. */
var DEFAULT_SETTINGS = {
  companyName: 'Rosier Foods',
  portalName: APP_NAME,
  allowedDomain: '',            // filled at setup from the owner's email domain
  requireRequesterDomain: false, // true = requester email must belong to allowedDomain
  allowEmbedding: false,        // let the form/app load inside Google Sites or another site
  publicUrl: '',                // Public deployment /exec URL
  internalUrl: '',              // Internal deployment /exec URL
  brandGuidelinesUrl: '',
  priorities: ['Low', 'Medium', 'High', 'Urgent'],
  reviewerIdentity: 'required', // required | optional | anonymous
  allowReviewerDownload: true,
  tokenExpiryDays: 14,
  emailNotifications: true,
  emailRequesterOnSubmit: true,
  sendReviewLinkToRequester: true,
  autoCompleteOnApproval: true,
  workloadThreshold: 5,
  dueSoonHours: 24,
  maxUploadMB: 200,
  maxPublicUploadMB: 25,
  maxPublicFiles: 10,
  allowedExtensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'psd', 'ai', 'eps', 'indd', 'tif',
    'tiff', 'mp4', 'mov', 'gif', 'zip', 'docx', 'pptx', 'xlsx', 'txt'],
  publicExtensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'docx', 'pptx', 'xlsx', 'txt', 'zip'],
  // Folder names inside each request's shared Drive folder (one per kind of creative).
  creativeCategories: ['Meta ads', 'Website banners', 'Collection page banners', 'Listing images', 'Social media posts', 'Packaging', 'Print', 'Other'],
  // Points per approved creative, by designation. Edit in Settings.
  designations: [
    { name: 'Intern', points: 5 }, { name: 'Junior Graphic Designer', points: 8 }, { name: 'Graphic Designer', points: 10 },
    { name: 'Senior Graphic Designer', points: 12 }, { name: 'Lead Designer', points: 15 }],
  pointsOnTime: 20,          // per task completed by its deadline (hold time not counted)
  pointsFirstTime: 5,        // per creative approved without any changes
  pointsRejected: 0,         // taken off per rejected creative (0 = no penalty)
  theme: 'rosier',           // colour theme for every page (see THEMES)
  accentColor: '',           // optional custom accent colour (#rrggbb) on top of the theme
  creativeTypes: [
    { id: 'social_post', label: 'Social media post', fields: [
      { key: 'platform', label: 'Platform', type: 'select', required: true,
        options: ['Instagram', 'Facebook', 'LinkedIn', 'X (Twitter)', 'YouTube', 'WhatsApp', 'Multiple'] },
      { key: 'format', label: 'Format', type: 'select', required: true,
        options: ['Feed post 1:1 (1080×1080)', 'Feed post 4:5 (1080×1350)', 'Story / Reel cover 9:16 (1080×1920)',
          'Carousel', 'Landscape 16:9 (1920×1080)', 'Custom'] },
      { key: 'variations', label: 'Number of variations', type: 'number', required: false },
      { key: 'caption', label: 'Caption (if you have one)', type: 'textarea', required: false }] },
    { id: 'website_banner', label: 'Website banner', fields: [
      { key: 'width', label: 'Width (px)', type: 'number', required: true },
      { key: 'height', label: 'Height (px)', type: 'number', required: true },
      { key: 'variants', label: 'Variants', type: 'select', required: true,
        options: ['Desktop only', 'Mobile only', 'Desktop + Mobile'] },
      { key: 'cta', label: 'CTA button text', type: 'text', required: false },
      { key: 'placement', label: 'Placement on site', type: 'text', required: true }] },
    { id: 'marketplace', label: 'Marketplace / quick-commerce listing', fields: [
      { key: 'marketplace', label: 'Marketplace', type: 'select', required: true,
        options: ['Amazon', 'Flipkart', 'Blinkit', 'Zepto', 'Instamart', 'Other'] },
      { key: 'assetKind', label: 'What is needed', type: 'select', required: true,
        options: ['Listing images', 'A+ content', 'Banner / ad creative', 'Brand store'] },
      { key: 'sku', label: 'SKU / product variant', type: 'text', required: false }] },
    { id: 'performance_ad', label: 'Performance ad (Meta / Google)', fields: [
      { key: 'adPlatform', label: 'Ad platform', type: 'select', required: true,
        options: ['Meta', 'Google Display', 'YouTube', 'Other'] },
      { key: 'sizes', label: 'Sizes needed', type: 'text', required: true },
      { key: 'headline', label: 'Headline / hook', type: 'text', required: false },
      { key: 'cta', label: 'CTA', type: 'text', required: false }] },
    { id: 'print', label: 'Print (poster, flyer, standee)', fields: [
      { key: 'printSize', label: 'Print size', type: 'text', required: true },
      { key: 'orientation', label: 'Orientation', type: 'select', required: false, options: ['Portrait', 'Landscape'] },
      { key: 'bleed', label: 'Bleed / printer specs', type: 'text', required: false }] },
    { id: 'packaging', label: 'Packaging / label', fields: [
      { key: 'packFormat', label: 'Pack format & size', type: 'text', required: true },
      { key: 'dieline', label: 'Dieline available?', type: 'select', required: true, options: ['Yes, attached', 'No'] }] },
    { id: 'email', label: 'Email / WhatsApp creative', fields: [
      { key: 'channel', label: 'Channel', type: 'select', required: true, options: ['Email', 'WhatsApp', 'SMS / RCS'] },
      { key: 'width', label: 'Width (px)', type: 'number', required: false }] },
    { id: 'presentation', label: 'Presentation / deck', fields: [
      { key: 'slides', label: 'Approx. number of slides', type: 'number', required: false },
      { key: 'template', label: 'Template to use', type: 'text', required: false }] },
    { id: 'other', label: 'Something else', fields: [] }
  ]
};

/** Keys a leader may edit from the Settings page, and their types. */
var EDITABLE_SETTINGS = {
  companyName: 'string', portalName: 'string', allowedDomain: 'string', requireRequesterDomain: 'boolean',
  allowEmbedding: 'boolean', publicUrl: 'url', internalUrl: 'url', brandGuidelinesUrl: 'url', priorities: 'list',
  reviewerIdentity: ['required', 'optional', 'anonymous'], allowReviewerDownload: 'boolean',
  tokenExpiryDays: 'number', emailNotifications: 'boolean', emailRequesterOnSubmit: 'boolean',
  sendReviewLinkToRequester: 'boolean', autoCompleteOnApproval: 'boolean', workloadThreshold: 'number',
  dueSoonHours: 'number', maxUploadMB: 'number', maxPublicUploadMB: 'number', maxPublicFiles: 'number',
  allowedExtensions: 'list', publicExtensions: 'list', creativeTypes: 'json',
  creativeCategories: 'list', designations: 'designations', theme: 'theme', accentColor: 'color', pointsOnTime: 'number', pointsFirstTime: 'number', pointsRejected: 'number'
};

/** Drive folders created under the root. */
var DRIVE_FOLDERS = {
  references: '01_Incoming_References',
  submissions: '02_Creative_Submissions',
  approved: '03_Approved_Creatives',
  brand: '04_Brand_Guidelines',
  exports: '05_Exports',
  system: '00_System'
};

/** Hard technical limits (not editable). */
var LIMITS = {
  CHUNK_BYTES: 4 * 1024 * 1024,        // multiple of 256 KB, required by Drive resumable upload
  PREVIEW_INLINE_BYTES: 2 * 1024 * 1024,   // bigger images are shown via Drive's (much smaller) rendered preview
  ORIGINAL_INLINE_BYTES: 20 * 1024 * 1024,
  TEXT_SHORT: 200,
  TEXT_LONG: 8000,
  UPLOAD_TTL_SEC: 21600
};

/* ======================= Util.gs ======================= */
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

/** 24-hour "HH:MM", or "" when optional and empty. */
function time_(v, field, required) {
  var s = str_(v, 5, field, required);
  if (!s) return '';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw AppError_('VALIDATION', (field || 'Time') + ' must be a time like 17:30.');
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
function dueEnd_(dueDate, dueTime) {
  if (!dueDate) return null;
  var d = new Date(dueDate + 'T' + (dueTime ? dueTime + ':00' : '23:59:59') + tzOffset_());
  return isNaN(d.getTime()) ? null : d;
}

function tzOffset_() {
  var z = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kolkata', 'Z'); // +0530
  return z.slice(0, 3) + ':' + z.slice(3);
}

/** "2026-10-24" + "17:30" → "2026-10-24 17:30" for messages. */
function dueText_(date, time) { return date ? date + (time ? ' ' + time : '') : 'no date'; }

function isOverdue_(task) {
  if (CLOSED.indexOf(task.status) !== -1 || task.status === STATUS.APPROVED || task.status === STATUS.ON_HOLD) return false;
  var end = dueEnd_(task.dueDate, task.dueTime);
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

/* ======================= Db.gs ======================= */
/**
 * Db.gs — Google Sheets as a table store.
 * - Every cell is plain text (columns are formatted "@" at setup), so ids,
 *   dates and phone numbers are never auto-converted by Sheets.
 * - Reads are cached for the duration of one server call; writes invalidate.
 * - All writes must happen inside withLock_ so concurrent submissions
 *   cannot interleave.
 */

var DB_CACHE_ = {};
var DB_SS_ = null;
var LOCK_DEPTH_ = 0;
var DIRTY_ = {};

function ss_() {
  if (DB_SS_) return DB_SS_;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw AppError_('NOT_CONFIGURED', 'The portal is not set up yet. Ask the administrator to run setup().');
  DB_SS_ = SpreadsheetApp.openById(id);
  return DB_SS_;
}

function sheet_(table) {
  if (!SCHEMA[table]) throw new Error('Unknown table ' + table);
  var ss = ss_(), sh = ss.getSheetByName(table);
  if (sh) return sh;
  // A table added by a newer version (e.g. after an update) — create it now, so read-only pages work straight away.
  var lock = LockService.getScriptLock(), mine = LOCK_DEPTH_ === 0;
  if (mine && !lock.tryLock(20000)) throw AppError_('BUSY', 'The portal is busy. Please try again in a moment.');
  try {
    sh = ss.getSheetByName(table);
    if (!sh) {
      var cols = SCHEMA[table];
      sh = ss.insertSheet(table);
      sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
      sh.setFrozenRows(1);
      sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
      console.log('Created missing sheet ' + table);
    }
    return sh;
  } finally { if (mine) lock.releaseLock(); }
}

/** Run fn while holding the script lock. Re-entrant within one execution. */
function withLock_(fn) {
  if (LOCK_DEPTH_ > 0) { LOCK_DEPTH_++; try { return fn(); } finally { LOCK_DEPTH_--; } }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw AppError_('BUSY', 'The portal is busy right now. Please try again in a moment.');
  LOCK_DEPTH_ = 1;
  try {
    DB_CACHE_ = {}; // always read fresh data once we own the lock
    DIRTY_ = {};
    tcacheEnsureTags_();
    migrateSchema_();
    var out = fn();
    SpreadsheetApp.flush();
    return out;
  } finally {
    // New tags make every cached copy of a changed table stale at once.
    try { tcacheBump_(Object.keys(DIRTY_)); } catch (e) { console.warn('cache bump failed: ' + e); }
    DIRTY_ = {};
    LOCK_DEPTH_ = 0;
    lock.releaseLock();
    flushMail_();
  }
}

/** Formula-injection guard: Sheets would treat these leading characters as a formula. */
function cellOut_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  if (/^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

function cellIn_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  v = String(v);
  if (v.charAt(0) === "'") return v.slice(1);
  return v;
}

/** All rows as objects. Each object carries a hidden _row index. */
function dbAll_(table) {
  if (DB_CACHE_[table]) return DB_CACHE_[table];
  // A table written in this request must not come from the shared cache (it was taken before the write).
  var cached = DIRTY_[table] ? null : tcacheGet_(table);
  if (cached) { DB_CACHE_[table] = cached; return cached; }
  var tagBefore = tcacheTag_(table);
  var sh = sheet_(table);
  var cols = SCHEMA[table];
  var last = sh.getLastRow();
  var rows = [];
  if (last >= 2) {
    var values = sh.getRange(2, 1, last - 1, cols.length).getValues();
    for (var i = 0; i < values.length; i++) {
      var r = values[i];
      if (r[0] === '' || r[0] === null) continue;
      var o = {};
      for (var c = 0; c < cols.length; c++) o[cols[c]] = cellIn_(r[c]);
      Object.defineProperty(o, '_row', { value: i + 2, enumerable: false });
      rows.push(o);
    }
  }
  DB_CACHE_[table] = rows;
  // Only cache if no write landed while we were reading (tag unchanged).
  if (tagBefore && tagBefore === tcacheTag_(table)) tcachePut_(table, rows, tagBefore);
  return rows;
}

function dbFind_(table, pred) { return dbAll_(table).filter(pred); }

function dbGet_(table, id) {
  var key = SCHEMA[table][0];
  var rows = dbAll_(table);
  for (var i = 0; i < rows.length; i++) if (rows[i][key] === id) return rows[i];
  return null;
}

function dbInsert_(table, obj) {
  if (LOCK_DEPTH_ === 0) throw new Error('dbInsert_ outside lock');
  var cols = SCHEMA[table];
  var sh = sheet_(table);
  var row = cols.map(function (c) { return cellOut_(obj[c]); });
  DIRTY_[table] = true;
  var at = Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(at, 1, 1, cols.length).setValues([row]);
  var stored = {};
  cols.forEach(function (c, i) { stored[c] = cellIn_(row[i]); });
  Object.defineProperty(stored, '_row', { value: at, enumerable: false });
  if (DB_CACHE_[table]) DB_CACHE_[table].push(stored);
  if (table === 'Settings') SETTINGS_MEMO_ = null;
  return stored;
}

function dbUpdate_(table, id, patch) {
  if (LOCK_DEPTH_ === 0) throw new Error('dbUpdate_ outside lock');
  var current = dbGet_(table, id);
  if (!current) throw AppError_('NOT_FOUND', 'Record not found.');
  var cols = SCHEMA[table];
  var merged = {};
  cols.forEach(function (c) { merged[c] = patch.hasOwnProperty(c) ? patch[c] : current[c]; });
  var row = cols.map(function (c) { return cellOut_(merged[c]); });
  DIRTY_[table] = true;
  sheet_(table).getRange(current._row, 1, 1, cols.length).setValues([row]);
  // Replace the cached row with a new object. Objects callers already hold
  // stay as "before" snapshots, so code can compare old vs new values.
  var fresh = {};
  cols.forEach(function (c, i) { fresh[c] = cellIn_(row[i]); });
  Object.defineProperty(fresh, '_row', { value: current._row, enumerable: false });
  var cache = DB_CACHE_[table];
  if (cache) { var idx = cache.indexOf(current); if (idx !== -1) cache[idx] = fresh; else delete DB_CACHE_[table]; }
  if (table === 'Settings') SETTINGS_MEMO_ = null;
  return fresh;
}

/* ---------- settings ---------- */

function getSettingRaw_(key) {
  var row = dbGet_('Settings', key);
  return row ? row.value : null;
}

function setSettingRaw_(key, value) {
  if (dbGet_('Settings', key)) dbUpdate_('Settings', key, { value: value, updatedAt: nowIso_() });
  else dbInsert_('Settings', { key: key, value: value, updatedAt: nowIso_() });
}

var SETTINGS_MEMO_ = null;

/** Defaults merged with stored values. */
function settings_() {
  if (SETTINGS_MEMO_) return SETTINGS_MEMO_;
  var s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  dbAll_('Settings').forEach(function (r) {
    if (!DEFAULT_SETTINGS.hasOwnProperty(r.key)) return;
    var def = DEFAULT_SETTINGS[r.key];
    if (typeof def === 'boolean') s[r.key] = bool_(r.value);
    else if (typeof def === 'number') s[r.key] = Number(r.value);
    else if (typeof def === 'object') s[r.key] = parseJson_(r.value, def);
    else s[r.key] = r.value;
  });
  SETTINGS_MEMO_ = s;
  return s;
}

/**
 * Brings an existing database up to the current SCHEMA once per version:
 * writes any missing header names (new columns are only ever appended)
 * and keeps every column formatted as plain text. Caller holds the lock.
 */
/** Deletes every row matching pred. Returns how many were removed. Caller holds the lock. */
function dbDeleteWhere_(table, pred) {
  if (LOCK_DEPTH_ === 0) throw new Error('dbDeleteWhere_ outside lock');
  var rows = dbFind_(table, pred).map(function (r) { return r._row; }).sort(function (a, b) { return b - a; });
  if (!rows.length) return 0;
  var sh = sheet_(table);
  // Delete bottom-up, merging neighbouring rows into one call.
  var i = 0;
  while (i < rows.length) {
    var end = rows[i], start = end;
    while (i + 1 < rows.length && rows[i + 1] === start - 1) { start--; i++; }
    sh.deleteRows(start, end - start + 1);
    i++;
  }
  DIRTY_[table] = true;
  delete DB_CACHE_[table]; // row numbers changed; re-read next time
  return rows.length;
}

function migrateSchema_() {
  var props = PropertiesService.getScriptProperties();
  if (Number(props.getProperty('SCHEMA_VERSION') || 1) >= SCHEMA_VERSION) return;
  if (!props.getProperty('SPREADSHEET_ID')) return;
  var ss = ss_();
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var cols = SCHEMA[name];
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    var header = sh.getRange(1, 1, 1, cols.length).getValues()[0];
    for (var i = 0; i < cols.length; i++) {
      if (String(header[i]) === cols[i]) continue;
      if (String(header[i]) !== '') throw new Error('Sheet "' + name + '" column ' + (i + 1) + ' is "' + header[i] + '", expected "' + cols[i] + '".');
      sh.getRange(1, i + 1, 1, 1).setValues([[cols[i]]]).setFontWeight('bold');
    }
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
  });
  props.setProperty('SCHEMA_VERSION', String(SCHEMA_VERSION));
}

/* ---------- shared read cache (CacheService) ----------
 * Each table has a "tag" that changes on every write (bumped after the
 * write is flushed, while the script lock is still held). A cached copy
 * is used only if it was taken under the current tag, so readers can
 * never see stale data after a write. Manual edits made directly in the
 * Sheet show up within TCACHE_TTL seconds.
 */
var TCACHE_TTL = 600;
var TCACHE_CHUNK = 90000;
var TCACHE_MAX_CHUNKS = 30;

function tcache_() { return CacheService.getScriptCache(); }
function tcacheTag_(table) { try { return tcache_().get('tt_' + table); } catch (e) { return null; } }

function tcacheEnsureTags_() {
  try {
    var c = tcache_(), keys = Object.keys(SCHEMA).map(function (t) { return 'tt_' + t; });
    var have = c.getAll(keys), missing = {};
    keys.forEach(function (k) { if (!have[k]) missing[k] = uuid_(); });
    if (Object.keys(missing).length) c.putAll(missing, 21600);
  } catch (e) { /* cache is optional */ }
}

function tcacheBump_(tables) {
  if (!tables.length) return;
  var o = {};
  tables.forEach(function (t) { o['tt_' + t] = uuid_(); });
  tcache_().putAll(o, 21600);
}

function tcacheGet_(table) {
  try {
    var c = tcache_();
    var tag = c.get('tt_' + table);
    if (!tag) return null;
    var meta = parseJson_(c.get('tm_' + table), null);
    if (!meta || meta.tag !== tag) return null;
    var keys = [];
    for (var i = 0; i < meta.n; i++) keys.push('tc_' + table + '_' + i);
    var parts = c.getAll(keys), str = '';
    for (var j = 0; j < keys.length; j++) { if (parts[keys[j]] === undefined || parts[keys[j]] === null) return null; str += parts[keys[j]]; }
    var packed = JSON.parse(str), cols = SCHEMA[table];
    return packed.map(function (r) {
      var o = {};
      for (var k = 0; k < cols.length; k++) o[cols[k]] = r[k + 1];
      Object.defineProperty(o, '_row', { value: r[0], enumerable: false });
      return o;
    });
  } catch (e) { return null; }
}

function tcachePut_(table, rows, tag) {
  try {
    var cols = SCHEMA[table];
    var str = JSON.stringify(rows.map(function (o) { return [o._row].concat(cols.map(function (c) { return o[c]; })); }));
    var n = Math.ceil(str.length / TCACHE_CHUNK) || 1;
    if (n > TCACHE_MAX_CHUNKS) return;               // very large tables are read straight from the Sheet
    var o = {};
    for (var i = 0; i < n; i++) o['tc_' + table + '_' + i] = str.slice(i * TCACHE_CHUNK, (i + 1) * TCACHE_CHUNK);
    o['tm_' + table] = JSON.stringify({ tag: tag, n: n });
    tcache_().putAll(o, TCACHE_TTL);
  } catch (e) { /* cache is optional */ }
}

/* ======================= Auth.gs ======================= */
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

/* ======================= Drive.gs ======================= */
/**
 * Drive.gs — all Google Drive access.
 *
 * Access model: every file lives in the script owner's Drive (or a shared
 * folder the owner controls). Nothing is shared publicly. Users and
 * reviewers never get Drive URLs; the server reads files with the owner's
 * authority after checking permissions, and sends bytes to the browser.
 * The owner's OAuth token is only ever used server-side (UrlFetchApp).
 * For speed, the browser may send file bytes straight to a Drive upload
 * session the server opened. That session URL can only write that one new
 * file; the server checks the finished file (size + file signature) and
 * deletes it if it doesn't match.
 */

function folderIds_() {
  var ids = parseJson_(PropertiesService.getScriptProperties().getProperty('FOLDER_IDS'), null);
  if (!ids) throw AppError_('NOT_CONFIGURED', 'Drive folders are not set up. Run setup().');
  return ids;
}

/** Get or create a nested folder path under one of the base folders. */
function ensureFolder_(baseKey, parts) {
  var folder;
  try { folder = DriveApp.getFolderById(folderIds_()[baseKey]); }
  catch (e) { throw AppError_('DRIVE_ERROR', 'A portal Drive folder is missing. Ask the team leader to check Settings → Drive health.'); }
  parts.forEach(function (name) {
    name = String(name).replace(/[\\/]/g, '-').slice(0, 100);
    var it = folder.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : folder.createFolder(name);
  });
  return folder;
}

/** Like ensureFolder_ but returns just the id, cached so repeat uploads skip the Drive folder walk. */
function ensureFolderId_(baseKey, parts) {
  var key = 'fld_' + sha256_(baseKey + '/' + parts.join('/'));
  var cache = CacheService.getScriptCache();
  var id = cache.get(key);
  if (id) return id;
  id = ensureFolder_(baseKey, parts).getId();
  cache.put(key, id, 21600);
  return id;
}

function driveApi_(method, url, opts) {
  opts = opts || {};
  var params = {
    method: method,
    headers: Object.assign({ Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, opts.headers || {}),
    muteHttpExceptions: true,
    followRedirects: opts.followRedirects !== false
  };
  if (opts.payload !== undefined) params.payload = opts.payload;
  if (opts.contentType) params.contentType = opts.contentType;
  return UrlFetchApp.fetch(url, params);
}

/* ---------- resumable uploads ---------- */

/** Starts a Drive resumable upload session; returns the session URI (kept server-side only). */
function startResumable_(folderId, fileName, mimeType, sizeBytes, origin) {
  var headers = { 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(sizeBytes) };
  // Opening the session with the browser's origin lets that page send the bytes directly (CORS).
  if (origin) headers.Origin = origin;
  var res = driveApi_('post',
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size',
    {
      contentType: 'application/json; charset=UTF-8',
      payload: JSON.stringify({ name: fileName, parents: [folderId], mimeType: mimeType }),
      headers: headers
    });
  var code = res.getResponseCode();
  if (code !== 200) {
    console.error('Resumable start failed ' + code + ' ' + res.getContentText().slice(0, 500));
    throw AppError_('DRIVE_ERROR', 'Google Drive refused the upload. Please try again.');
  }
  var h = res.getHeaders();
  var uri = h.Location || h.location;
  if (!uri) throw AppError_('DRIVE_ERROR', 'Google Drive did not start the upload session.');
  return uri;
}

/**
 * Sends one chunk. Returns {done:false, received:n} or {done:true, file:{id,name,mimeType,size}}.
 */
function putChunk_(sessionUri, bytes, offset, total) {
  var end = offset + bytes.length - 1;
  var res = driveApi_('put', sessionUri, {
    payload: bytes,
    contentType: 'application/octet-stream',
    headers: { 'Content-Range': 'bytes ' + offset + '-' + end + '/' + total },
    followRedirects: false
  });
  var code = res.getResponseCode();
  if (code === 308) {
    var range = res.getHeaders().Range || res.getHeaders().range || '';
    var m = /bytes=0-(\d+)/.exec(range);
    return { done: false, received: m ? Number(m[1]) + 1 : 0 };
  }
  if (code === 200 || code === 201) return { done: true, file: JSON.parse(res.getContentText()) };
  console.error('Chunk upload failed ' + code + ' ' + res.getContentText().slice(0, 500));
  throw AppError_('DRIVE_ERROR', 'Upload to Google Drive failed (' + code + '). Please retry the file.');
}

/** Asks Drive how far an upload session got. {done:false, received:n} or {done:true, file}. */
function sessionStatus_(sessionUri, total) {
  var res = driveApi_('put', sessionUri, { payload: '', headers: { 'Content-Range': 'bytes */' + total }, followRedirects: false });
  var code = res.getResponseCode();
  if (code === 308) {
    var range = res.getHeaders().Range || res.getHeaders().range || '';
    var m = /bytes=0-(\d+)/.exec(range);
    return { done: false, received: m ? Number(m[1]) + 1 : 0 };
  }
  if (code === 200 || code === 201) return { done: true, file: JSON.parse(res.getContentText()) };
  console.error('Upload status failed ' + code + ' ' + res.getContentText().slice(0, 300));
  throw AppError_('UPLOAD_EXPIRED', 'This upload session has expired. Please try the file again.');
}

/** First bytes of a Drive file (for the file-signature check). */
function headBytes_(fileId, n) {
  var res = driveApi_('get', 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media&supportsAllDrives=true',
    { headers: { Range: 'bytes=0-' + (n - 1) } });
  var code = res.getResponseCode();
  if (code !== 200 && code !== 206) return null;
  return res.getBlob().getBytes().slice(0, n);
}

/* ---------- reading files for previews ---------- */

function fileOrNull_(fileId) {
  try { return DriveApp.getFileById(fileId); } catch (e) { return null; }
}

var INLINE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

/**
 * Preview for any stored file. Images up to a size limit are sent as-is;
 * everything else (PDF, PSD, AI, large images, video) uses Drive's own
 * thumbnail renderer, fetched server-side.
 */
function previewOf_(fileId, mimeType, sizeBytes, maxDim) {
  var file = fileOrNull_(fileId);
  if (!file) return { kind: 'missing', message: 'This file is no longer available in Google Drive. The team has been told.' };
  var size = Number(sizeBytes || file.getSize() || 0);
  var mime = mimeType || file.getMimeType();
  if (INLINE_IMAGE_TYPES.indexOf(mime) !== -1 && size <= LIMITS.PREVIEW_INLINE_BYTES) {
    var b = file.getBlob();
    return { kind: 'image', dataUrl: 'data:' + mime + ';base64,' + Utilities.base64Encode(b.getBytes()) };
  }
  var thumb = thumbnail_(fileId, maxDim || 1600);
  if (thumb) return { kind: 'thumbnail', dataUrl: thumb };
  return { kind: 'none', message: 'No preview is available for this file type. Use download to open it.' };
}

function thumbnail_(fileId, dim) {
  try {
    var meta = driveApi_('get', 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
      '?fields=thumbnailLink,hasThumbnail&supportsAllDrives=true');
    if (meta.getResponseCode() !== 200) return null;
    var j = JSON.parse(meta.getContentText());
    if (!j.thumbnailLink) return null;
    var url = j.thumbnailLink.replace(/=s\d+(-[a-z]+)?$/, '') + '=s' + dim;
    var img = driveApi_('get', url);
    if (img.getResponseCode() !== 200) return null;
    var blob = img.getBlob();
    return 'data:' + (blob.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    console.warn('Thumbnail failed for ' + fileId + ': ' + e);
    return null;
  }
}

/** Whole file as base64 for "view original"/download, within a safe size. */
function originalOf_(fileId, fileName) {
  var file = fileOrNull_(fileId);
  if (!file) throw AppError_('FILE_MISSING', 'This file is no longer available in Google Drive.');
  if (file.getSize() > LIMITS.ORIGINAL_INLINE_BYTES) {
    throw AppError_('TOO_LARGE', 'This file is larger than 20 MB, so it can’t be opened here. Ask the graphics team for a copy.');
  }
  var b = file.getBlob();
  return { fileName: fileName || file.getName(), mimeType: file.getMimeType(), base64: Utilities.base64Encode(b.getBytes()) };
}

function driveHealth_() {
  var ids = folderIds_(), out = [];
  Object.keys(DRIVE_FOLDERS).forEach(function (k) {
    var ok = false, url = '';
    try { var f = DriveApp.getFolderById(ids[k]); ok = !f.isTrashed(); url = f.getUrl(); } catch (e) { ok = false; }
    var sharing = '';
    try { if (ok) sharing = String(DriveApp.getFolderById(ids[k]).getSharingAccess()); } catch (e) { sharing = 'unknown'; }
    out.push({ key: k, name: DRIVE_FOLDERS[k], ok: ok, url: url, sharing: sharing });
  });
  var rootUrl = '';
  try { rootUrl = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID')).getUrl(); } catch (e) { rootUrl = ''; }
  return { folders: out, rootUrl: rootUrl };
}

/* ======================= Notifications.gs ======================= */
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
    if (sendEmail !== false && s.emailNotifications) {
      var link = s.internalUrl ? s.internalUrl + '?p=app&r=' + encodeURIComponent(route || '') : '';
      sendMail_(email, title, body, link ? { label: 'Open in portal', url: link } : null);
    }
  });
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
    return {
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

/* ======================= Setup.gs ======================= */
/**
 * Setup.gs — one-time installation. Run setup() from the Apps Script editor.
 *
 * Optional Script Properties you may set BEFORE running setup():
 *   ADMIN_EMAIL     — first team leader (defaults to the account running setup)
 *   ROOT_FOLDER_ID  — an existing Drive folder to use as the portal root
 *   SPREADSHEET_ID  — an existing (empty) spreadsheet to use as the database
 * setup() is safe to run again: it only adds what is missing.
 */

function setup() {
  guardOwner_();
  var props = PropertiesService.getScriptProperties();
  var owner = Session.getEffectiveUser().getEmail().toLowerCase();

  // 1. Drive root + folders
  var root;
  if (props.getProperty('ROOT_FOLDER_ID')) {
    root = DriveApp.getFolderById(props.getProperty('ROOT_FOLDER_ID'));
  } else {
    root = DriveApp.createFolder(APP_NAME);
    props.setProperty('ROOT_FOLDER_ID', root.getId());
  }
  var folderIds = parseJson_(props.getProperty('FOLDER_IDS'), {});
  Object.keys(DRIVE_FOLDERS).forEach(function (key) {
    if (folderIds[key]) { try { DriveApp.getFolderById(folderIds[key]); return; } catch (e) { /* recreate */ } }
    var it = root.getFoldersByName(DRIVE_FOLDERS[key]);
    folderIds[key] = (it.hasNext() ? it.next() : root.createFolder(DRIVE_FOLDERS[key])).getId();
  });
  props.setProperty('FOLDER_IDS', JSON.stringify(folderIds));

  // 2. Database spreadsheet
  var ss;
  if (props.getProperty('SPREADSHEET_ID')) {
    ss = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
  } else {
    ss = SpreadsheetApp.create(APP_NAME + ' — Database');
    props.setProperty('SPREADSHEET_ID', ss.getId());
    try { DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(folderIds.system)); } catch (e) { /* stays in My Drive */ }
  }
  DB_SS_ = ss;
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = SCHEMA[name];
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    var header = sh.getRange(1, 1, 1, cols.length).getValues()[0];
    if (header.join('|') !== cols.join('|')) {
      // Only write headers on a fresh sheet; never silently rewrite a populated one.
      if (sh.getLastRow() > 1 && String(header[0]) !== '') {
        throw new Error('Sheet "' + name + '" has unexpected headers. Fix them manually or use an empty spreadsheet.');
      }
      sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    }
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.setFrozenRows(1);
  });
  var stray = ss.getSheetByName('Sheet1');
  if (stray && ss.getSheets().length > 1 && stray.getLastRow() === 0) ss.deleteSheet(stray);

  // Protect the database: only the owner can edit by hand.
  ss.getSheets().forEach(function (sh) {
    try {
      var p = sh.protect().setDescription('Managed by ' + APP_NAME);
      p.getEditors().forEach(function (ed) { if (ed.getEmail().toLowerCase() !== owner) p.removeEditor(ed); });
      if (p.canDomainEdit()) p.setDomainEdit(false);
    } catch (e) { /* protection is best-effort */ }
  });

  withLock_(function () {
    // 3. Settings
    if (!getSettingRaw_('allowedDomain')) setSettingRaw_('allowedDomain', owner.split('@')[1] || '');

    // 4. First team leader
    var admin = (props.getProperty('ADMIN_EMAIL') || owner).toLowerCase().trim();
    var existing = userByEmail_(admin);
    if (!existing) {
      dbInsert_('Users', { userId: 'USR-' + uuid_().slice(0, 8), email: admin, name: admin.split('@')[0],
        role: ROLES.LEADER, active: true, createdAt: nowIso_(), updatedAt: nowIso_() });
    } else if (existing.role !== ROLES.LEADER || !bool_(existing.active)) {
      dbUpdate_('Users', existing.userId, { role: ROLES.LEADER, active: true, updatedAt: nowIso_() });
    }

    // 5. Default departments
    if (dbAll_('Departments').length === 0) {
      ['Marketing', 'Performance Marketing', 'Sales', 'E-commerce', 'Operations', 'HR', 'Founders Office', 'Other']
        .forEach(function (d) {
          dbInsert_('Departments', { departmentId: 'DEP-' + uuid_().slice(0, 8), name: d, active: true, createdAt: nowIso_() });
        });
    }
  });

  PropertiesService.getScriptProperties().setProperty('SCHEMA_VERSION', String(SCHEMA_VERSION));
  installTriggers();

  console.log('Setup complete.');
  console.log('Database: ' + ss.getUrl());
  console.log('Drive root: ' + root.getUrl());
  console.log('Next: Deploy → New deployment (twice). See docs/DEPLOYMENT.md.');
  return { spreadsheetUrl: ss.getUrl(), rootFolderUrl: root.getUrl() };
}

/** (Re)creates the hourly maintenance and nightly backup triggers. */
function installTriggers() {
  guardOwner_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['hourlyMaintenance', 'dailyBackup'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('hourlyMaintenance').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(2).create();
}

/**
 * Emergency helper: make someone a team leader from the editor
 * (e.g. if the only leader left the company).
 * Set Script Property ADMIN_EMAIL then run this.
 */
function promoteAdminFromProperty() {
  guardOwner_();
  var email = (PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || '').toLowerCase().trim();
  if (!email) throw new Error('Set the ADMIN_EMAIL script property first.');
  withLock_(function () {
    var u = userByEmail_(email);
    if (u) dbUpdate_('Users', u.userId, { role: ROLES.LEADER, active: true, updatedAt: nowIso_() });
    else dbInsert_('Users', { userId: 'USR-' + uuid_().slice(0, 8), email: email, name: email.split('@')[0],
      role: ROLES.LEADER, active: true, createdAt: nowIso_(), updatedAt: nowIso_() });
  });
  console.log(email + ' is now a team leader.');
}

/* ======================= Requirements.gs ======================= */
/**
 * Requirements.gs — public requirement intake (no login).
 * Flow: api_submitRequirement → (api_startUpload/api_uploadChunk with the
 * returned upload ticket, per file) → api_finalizeRequirement.
 */

function api_getFormConfig() {
  return respond_(function () {
    var s = settings_();
    return {
      companyName: s.companyName,
      portalName: s.portalName,
      allowedDomain: s.requireRequesterDomain ? s.allowedDomain : '',
      brandGuidelinesUrl: s.brandGuidelinesUrl,
      priorities: s.priorities,
      creativeTypes: s.creativeTypes,
      departments: dbFind_('Departments', function (d) { return bool_(d.active); }).map(function (d) { return d.name; }),
      maxFiles: s.maxPublicFiles,
      maxFileMB: s.maxPublicUploadMB,
      extensions: s.publicExtensions,
      chunkBytes: LIMITS.CHUNK_BYTES,
      campaigns: dbFind_('Campaigns', function (c) { return bool_(c.active); }).map(function (c) { return { campaignId: c.campaignId, name: c.name }; })
    };
  });
}

function api_submitRequirement(payload) {
  return respond_(function () {
    payload = payload || {};
    var s = settings_();

    // Spam guard: a hidden field only bots fill. It is named so browser autofill ignores it
    // (an earlier "website" field was being filled by Chrome autofill and blocked real people).
    if (payload.gfx_trap_9) throw AppError_('VALIDATION', 'Something went wrong sending this. Please reload the page and try again.');

    // A signed-in team member (e.g. the team leader) raising a requirement is recorded as such.
    var member = null;
    var signedIn = activeEmail_();
    if (signedIn) { var mu = userByEmail_(signedIn); if (mu && bool_(mu.active)) member = mu; }

    // The short form asks only: who, department, requirement, deadline, how many, references.
    // Older detailed fields are still accepted (and can be filled in by the leader later).
    var requirementText = str_(payload.brief || payload.requirement, LIMITS.TEXT_LONG, 'Requirement', true);
    var r = {
      requesterName: str_(payload.requesterName, 100, 'Your name', true),
      department: str_(payload.department, 100, 'Department', true),
      email: email_(payload.email, 'Email', !!(s.requireRequesterDomain && s.allowedDomain)),
      phone: str_(payload.phone, 20, 'Contact number', false),
      title: str_(payload.title, 150, 'Requirement title', false) || titleFrom_(requirementText),
      creativeType: str_(payload.creativeType, 50, 'Type of creative', false),
      purpose: str_(payload.purpose, 1000, 'Purpose', false),
      brief: requirementText,
      campaign: str_(payload.campaign, 150, 'Campaign', false),
      product: str_(payload.product, 150, 'Product / brand', false),
      quantity: int_(payload.quantity || 1, 1, 50, 'Number of creatives'),
      dimensions: str_(payload.dimensions, 200, 'Dimensions', false),
      platform: str_(payload.platform, 150, 'Platform / placement', false),
      copyText: str_(payload.copyText, LIMITS.TEXT_LONG, 'Copy', false),
      referenceUrls: urls_(payload.referenceUrls),
      preferredDate: date_(payload.preferredDate, 'Deadline date', true),
      preferredTime: time_(payload.preferredTime, 'Deadline time', false),
      priorityRequested: str_(payload.priorityRequested, 20, 'Priority', false) || 'Medium',
      instructions: str_(payload.instructions, LIMITS.TEXT_LONG, 'Additional instructions', false),
      campaignId: str_(payload.campaignId, 40, 'Campaign', false)
    };
    if (r.campaignId) { var cmp = dbGet_('Campaigns', r.campaignId); if (!cmp || !bool_(cmp.active)) r.campaignId = ''; }
    if (s.priorities.indexOf(r.priorityRequested) === -1) r.priorityRequested = s.priorities[Math.min(1, s.priorities.length - 1)];

    if (s.requireRequesterDomain && s.allowedDomain && !member && r.email && r.email.split('@')[1] !== s.allowedDomain.toLowerCase()) {
      throw AppError_('VALIDATION', 'Please use your @' + s.allowedDomain + ' work email.');
    }
    if (r.preferredDate < isoDateOnly_()) throw AppError_('VALIDATION', 'The deadline can’t be in the past.');
    if (r.preferredTime && dueEnd_(r.preferredDate, r.preferredTime).getTime() < Date.now()) throw AppError_('VALIDATION', 'That deadline time has already passed.');

    // Optional creative type (only sent by the old detailed form or API callers)
    var type = r.creativeType ? (s.creativeTypes || []).filter(function (t) { return t.id === r.creativeType; })[0] : null;
    if (r.creativeType && !type) throw AppError_('VALIDATION', 'Unknown type of creative.');
    var tf = {}, given = payload.typeFields || {};
    ((type && type.fields) || []).forEach(function (f) {
      var v = given[f.key];
      if (f.type === 'number') {
        if (v === '' || v === null || v === undefined) { if (f.required) throw AppError_('VALIDATION', f.label + ' is required.'); return; }
        tf[f.key] = int_(v, 0, 100000, f.label);
      } else if (f.type === 'select') {
        v = str_(v, 200, f.label, f.required);
        if (v) tf[f.key] = oneOf_(v, f.options || [], f.label);
      } else {
        v = str_(v, f.type === 'textarea' ? LIMITS.TEXT_LONG : 300, f.label, f.required);
        if (v) tf[f.key] = v;
      }
    });
    if (!r.dimensions && tf.width && tf.height) r.dimensions = tf.width + ' × ' + tf.height + ' px';
    if (!r.dimensions && tf.format) r.dimensions = tf.format;
    if (!r.platform) r.platform = tf.platform || tf.marketplace || tf.adPlatform || tf.placement || tf.channel || '';

    if (!member) {
      rateLimit_('submit:' + (r.email || r.requesterName.toLowerCase()), 6, 600);
      rateLimit_('submit:all', 120, 600);
    }

    var result = withLock_(function () {
      var reqId = nextSeqId_('REQ');
      var taskId = nextSeqId_('GFX');
      var folder = DriveApp.getFolderById(ensureFolderId_('references', [String(new Date().getFullYear())])).createFolder(reqId);
      var now = nowIso_();
      dbInsert_('Requirements', Object.assign({}, r, {
        requirementId: reqId, referenceUrls: r.referenceUrls.join('\n'), typeFields: JSON.stringify(tf),
        folderId: folder.getId(), status: 'Received', notifiedAt: '', submittedAt: now, updatedAt: now,
        submittedBy: member ? member.email : ''
      }));
      dbInsert_('Tasks', {
        taskId: taskId, requirementId: reqId, title: r.title,
        brief: r.brief, creativeType: type ? type.label : '', purpose: r.purpose, campaign: r.campaign, product: r.product,
        deliverablesRequired: String(r.quantity), dimensions: r.dimensions, formats: '', copyText: r.copyText,
        referenceUrls: r.referenceUrls.join('\n'), assigneeEmail: '', assignedBy: '', assignedAt: '',
        startDate: '', dueDate: r.preferredDate, dueTime: r.preferredTime, priority: r.priorityRequested, status: STATUS.NEW, prevStatus: '',
        progress: '0', instructions: r.instructions, internalNotes: '', folderId: folder.getId(), completedAt: '',
        dueSoonNotifiedAt: '', overdueNotifiedAt: '', createdBy: r.email || 'requester', createdAt: now, updatedAt: now
      });
      logActivity_(taskId, member ? { email: member.email, role: member.role } : { email: r.email, role: 'requester' }, 'created', '', STATUS.NEW,
        (member ? 'raised from the portal (' : 'via the request form (') + reqId + ')', 'team');
      return { requirementId: reqId, taskId: taskId, folderId: folder.getId(), trackToken: issueTrackToken_(r.email || 'req:' + reqId) };
    });

    var ticket = randomToken_();
    CacheService.getScriptCache().put('tkt_' + sha256_(ticket), JSON.stringify({
      requirementId: result.requirementId, taskId: result.taskId, folderId: result.folderId,
      files: 0, finalized: false
    }), LIMITS.UPLOAD_TTL_SEC);

    return { requirementId: result.requirementId, uploadTicket: ticket, trackToken: result.trackToken };
  });
}

/** Called after reference uploads finish (or straight away if there are none). */
function api_finalizeRequirement(ticket) {
  return respond_(function () {
    var info = readTicket_(ticket);
    if (info.finalized) return { requirementId: info.requirementId };
    info.finalized = true;
    CacheService.getScriptCache().put('tkt_' + sha256_(ticket), JSON.stringify(info), LIMITS.UPLOAD_TTL_SEC);
    withLock_(function () { notifyNewRequirement_(info.requirementId); });
    return { requirementId: info.requirementId };
  });
}

function readTicket_(ticket) {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(String(ticket || ''))) throw AppError_('INVALID_TICKET', 'This upload session has expired. Please submit the form again.');
  var raw = CacheService.getScriptCache().get('tkt_' + sha256_(ticket));
  if (!raw) throw AppError_('INVALID_TICKET', 'This upload session has expired. Your requirement was saved — please email any missing files to the graphics team.');
  return JSON.parse(raw);
}

/** Notify leaders + confirm to requester. Idempotent via notifiedAt. Caller holds the lock. */
function notifyNewRequirement_(requirementId) {
  var req = dbGet_('Requirements', requirementId);
  if (!req || req.notifiedAt) return;
  var task = dbFind_('Tasks', function (t) { return t.requirementId === requirementId; })[0];
  var files = dbFind_('ReferenceFiles', function (f) { return f.requirementId === requirementId; }).length;
  dbUpdate_('Requirements', requirementId, { notifiedAt: nowIso_(), updatedAt: nowIso_() });
  notify_(leaderEmails_().filter(function (e) { return e !== req.submittedBy; }), 'requirement_new', 'New requirement: ' + req.title,
    req.requesterName + ' (' + req.department + ') needs ' + req.quantity + ' creative(s) by ' + dueText_(req.preferredDate, req.preferredTime) +
    '.\n\n' + String(req.brief).slice(0, 400) + '\n\n' + files + ' reference file(s) attached.',
    task ? 'task/' + task.taskId : 'requirements');
  if (settings_().emailRequesterOnSubmit && req.email) {
    var link = trackUrl_(issueTrackToken_(req.email));
    sendMail_(req.email, 'We’ve got your request (' + requirementId + ')',
      'Hi ' + req.requesterName + ',\n\nYour request "' + req.title + '" has reached the graphics team.\n' +
      'Reference ID: ' + requirementId + '\nNeeded by: ' + dueText_(req.preferredDate, req.preferredTime) +
      '\n\nSee all your requests and their status any time:\n' + link +
      '\n\nYou’ll get a review link as soon as the creative is ready.', { label: 'See my requests', url: link });
  }
}

/** First line of the requirement, cut to a readable title. */
function titleFrom_(text) {
  var line = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(String)[0] || 'Creative request';
  if (line.length <= 80) return line;
  var cut = line.slice(0, 80);
  var sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut) + '…';
}

/* ======================= Tasks.gs ======================= */
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
  if (task.status === STATUS.ON_HOLD) {
    // On hold (e.g. waiting for the NI table): once every creative is approved, the hold ends and the task completes.
    var hd = taskDeliverables_(taskId), need = Math.max(1, Number(task.deliverablesRequired) || 1);
    var allOk = hd.filter(function (d) { return d.status === DSTATUS.APPROVED; }).length >= need &&
      !hd.some(function (d) { return d.status === DSTATUS.CHANGES || d.status === DSTATUS.AWAITING; });
    if (!allOk) return task.status;
    endHold_(task, actor || 'system', 'All creatives approved', true);
    task = dbGet_('Tasks', taskId);
  }
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
  // Email the designer; leaders see it in the portal's bell only.
  var done = task.assigneeEmail ? [String(task.assigneeEmail).toLowerCase()] : [];
  notify_(done, 'task_completed', 'Completed: ' + task.title, task.taskId + ' is complete. ' + (note || ''), 'task/' + task.taskId, true);
  notify_(leaderEmails_().filter(function (e) { return done.indexOf(e) === -1; }), 'task_completed', 'Completed: ' + task.title, task.taskId + ' is complete. ' + (note || ''), 'task/' + task.taskId, false);
  var req = dbGet_('Requirements', task.requirementId);
  if (req) {
    var open = dbFind_('Tasks', function (t) {
      return t.requirementId === req.requirementId && CLOSED.indexOf(t.status) === -1 && t.taskId !== task.taskId;
    });
    if (open.length === 0) {
      dbUpdate_('Requirements', req.requirementId, { status: 'Completed', updatedAt: nowIso_() });
      if (settings_().emailNotifications && req.email) {
        var finals = dbFind_('Tasks', function (t) { return t.requirementId === req.requirementId && t.finalLink; })
          .map(function (t) { return t.finalLink; });
        if (task.finalLink && finals.indexOf(task.finalLink) === -1) finals.push(task.finalLink);
        var folderUrl = finalFolderUrl_(req);
        if (folderUrl) finals.unshift(folderUrl);
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
  'status', 'progress', 'instructions', 'assignedAt', 'completedAt', 'createdAt', 'updatedAt', 'folderPath', 'bonusPoints'];

function taskDto_(t, user, extra) {
  var o = pick_(t, TASK_FIELDS_ALL);
  o.overdue = isOverdue_(t);
  o.referenceUrls = t.referenceUrls ? t.referenceUrls.split('\n') : [];
  o.hold = t.status === STATUS.ON_HOLD ? { reason: t.holdReason || '', party: t.holdParty || 'internal', partyLabel: HOLD_PARTIES[t.holdParty] || HOLD_PARTIES.internal,
    dept: t.holdDept || '', since: t.holdSince || '' } : null;
  o.heldDays = Math.round((Number(t.heldMs) || 0) / 864e5 * 10) / 10;
  o.reopenedAt = t.reopenedAt || ''; o.reopenReason = t.reopenReason || ''; o.reopenCount = Number(t.reopenCount) || 0;
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
      departments: dbFind_('Departments', function (d) { return bool_(d.active); }).map(function (d) { return d.name; }),
      categories: s.creativeCategories || [], designations: (s.designations || []).map(function (d) { return d.name; }),
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
      overdue: count(isOverdue_),
      onHoldOthers: count(function (t) { return t.status === STATUS.ON_HOLD && t.holdParty && t.holdParty !== 'internal'; }),
      onHoldInternal: count(function (t) { return t.status === STATUS.ON_HOLD && (!t.holdParty || t.holdParty === 'internal'); })
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
        overdue: active.filter(isOverdue_).length,
        points: (pointsTable_(monthFn_())[u.email] || { total: 0 }).total,
        pointsMonth: (pointsTable_(monthFn_())[u.email] || { period: 0 }).period
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
    var cmpMap = {}; if (isLeader_(u)) dbAll_('Campaigns').forEach(function (c) { cmpMap[c.campaignId] = c.name; });
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
      var ex = { requesterName: r.requesterName || '', department: r.department || '' };
      if (isLeader_(u) && r.campaignId) { ex.campaignId = r.campaignId; ex.campaignName = cmpMap[r.campaignId] || ''; }
      return taskDto_(t, u, Object.assign(ex, deliverableCounts_(t.taskId)));
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

    // When a request is divided between designers, every part shows the whole request's progress.
    var parts = t.requirementId ? dbFind_('Tasks', function (x) { return x.requirementId === t.requirementId && x.status !== STATUS.CANCELLED; }) : [];
    var requestParts = parts.length > 1 ? parts.map(function (x) {
      var mine = x.assigneeEmail === u.email;
      return {
        taskId: leader || mine ? x.taskId : '', title: x.title, status: x.status, mine: mine,
        assigneeName: x.assigneeEmail ? (leader || mine ? displayName_(x.assigneeEmail) : 'Another designer') : 'Not assigned',
        required: Number(x.deliverablesRequired) || 0, approved: deliverableCounts_(x.taskId).deliverablesApproved
      };
    }) : [];

    var out = {
      requestParts: requestParts,
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
      out.folderOptions = folderOptions_(req);
      out.folderRoot = req.campaignId ? ((dbGet_('Campaigns', req.campaignId) || {}).name || '') : req.requirementId;
      out.suggestedCampaign = !req.campaignId && req.campaign ? req.campaign : '';
      out.campaign = req.campaignId ? { campaignId: req.campaignId, name: (dbGet_('Campaigns', req.campaignId) || {}).name || '' } : null;
      out.campaigns = dbFind_('Campaigns', function (c) { return bool_(c.active) || c.campaignId === req.campaignId; }).map(function (c) { return { campaignId: c.campaignId, name: c.name }; });
      out.siblings = dbFind_('Tasks', function (x) { return x.requirementId === t.requirementId && x.taskId !== t.taskId; }).length;
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
  // Uploads continue while a task is on hold (e.g. waiting for the NI table), as long as someone is assigned.
  var uploadable = [STATUS.ASSIGNED, STATUS.IN_PROGRESS, STATUS.SUBMITTED, STATUS.CHANGES, STATUS.RESUBMITTED, STATUS.APPROVED]
    .concat(t.assigneeEmail ? [STATUS.ON_HOLD] : []);
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
    canResume: (leader || isAssignee) && t.status === STATUS.ON_HOLD,
    canHold: (leader || isAssignee) && CLOSED.indexOf(t.status) === -1 && t.status !== STATUS.ON_HOLD,
    canReopen: leader && t.status === STATUS.COMPLETED,
    canShare: leader || isAssignee,
    transitions: manual
  };
}

function activityDto_(a, u, task) {
  var leader = isLeader_(u);
  var actor;
  if (a.actorRole === 'reviewer') actor = 'Reviewer';
  else if (a.actorRole === 'requester') actor = 'Requester';
  else if (a.actorRole === 'external') actor = a.toValue || 'Shared link';
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
        instructions: input.instructions !== undefined ? instructions : undefined, note: note,
        folderPath: input.folderPath !== undefined ? str_(input.folderPath, 250, 'Folder', false) : undefined,
        bonusPoints: input.bonusPoints });
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
      referenceUrls: function (v) { return urls_(v).join('\n'); },
      creativeType: function (v) { return str_(v, 80, 'Category', false); },
      folderPath: function (v) { return cleanPath_(str_(v, 250, 'Folder', false)); },
      bonusPoints: function (v) { return v === '' || v === null ? '' : String(int_(v, 0, 1000, 'Bonus points')); }
    };
    var patch = {};
    Object.keys(patchIn).forEach(function (k) { if (allowed[k]) patch[k] = allowed[k](patchIn[k]); });
    if (!Object.keys(patch).length) throw AppError_('VALIDATION', 'Nothing to update.');
    return withLock_(function () {
      var t = requireTask_(u, taskId);
      patch.updatedAt = nowIso_();
      dbUpdate_('Tasks', t.taskId, patch);
      if ((patch.folderPath !== undefined && patch.folderPath !== (t.folderPath || '')) || (patch.creativeType !== undefined && patch.creativeType !== t.creativeType)) {
        // Approved files move to the new location right away.
        try { var sc = finalScope_(u, t.taskId); fileInto_(scopeFolder_(sc), [dbGet_('Tasks', t.taskId)]); } catch (e) { console.warn('Refile failed: ' + e); }
      }
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
      if (to === STATUS.ON_HOLD) {
        if (!reason) throw AppError_('VALIDATION', 'Say why the task is on hold.');
        holdTask_(t, u, { reason: reason, party: 'internal' });
        return { status: STATUS.ON_HOLD };
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

/* ---------- hold / resume / reopen ---------- */

/**
 * Puts a task on hold with a reason and who it's waiting on.
 * While on hold: no deadline, no overdue alerts, files stay viewable, uploads
 * and approvals can continue. Time on hold is not counted against the team
 * when it's waiting on the requester or another department.
 */
function holdTask_(t, u, o) {
  var party = HOLD_PARTIES[o.party] ? o.party : 'internal';
  setStatus_(t, STATUS.ON_HOLD, u, '');   // the reason is logged once, in the 'hold' entry below
  dbUpdate_('Tasks', t.taskId, { holdReason: o.reason, holdParty: party, holdDept: o.dept || '', holdSince: nowIso_(), updatedAt: nowIso_() });
  logActivity_(t.taskId, u, 'hold', '', HOLD_PARTIES[party] + (o.dept ? ' · ' + o.dept : ''), o.reason, 'team');
  var who = (u && u.name) || 'The team';
  var body = t.taskId + ' is on hold.\n\nReason: ' + o.reason + (party !== 'internal' ? '\nWaiting on: ' + (o.dept || HOLD_PARTIES[party]) + '\n\nThe deadline is paused until it resumes.' : '');
  var mail = [t.assigneeEmail].filter(function (e) { return e && e !== (u && u.email); });
  notify_(mail, 'task_status', 'On hold: ' + t.title, body, 'task/' + t.taskId, true);
  notify_(leaderEmails_().filter(function (e) { return e !== (u && u.email) && mail.indexOf(e) === -1; }), 'task_status', 'On hold: ' + t.title, body + '\n\nPut on hold by ' + who + '.', 'task/' + t.taskId, false);
  var req = dbGet_('Requirements', t.requirementId);
  if (o.notifyRequester && party !== 'internal' && req && req.email) {
    var link = trackUrl_(issueTrackToken_(req.email));
    sendMail_(req.email, 'We need something from you: ' + req.title + ' (' + req.requirementId + ')',
      'Hi ' + req.requesterName + ',\n\nYour request "' + req.title + '" is on hold until we get this:\n\n' + o.reason +
      (o.dept ? '\n\nFrom: ' + o.dept : '') + '\n\nThe design work so far is ready for you to see. Send the details from your requests page:\n' + link, { label: 'Send the details', url: link });
  }
}

/** Ends a hold: adds the held time to heldMs and, unless the hold was ours, moves the deadline out by the same amount. */
function endHold_(t, actor, note, silent, newDue) {
  var since = t.holdSince ? new Date(t.holdSince).getTime() : Date.now();
  var held = Math.max(0, Date.now() - since);
  var patch = { heldMs: String((Number(t.heldMs) || 0) + held), holdSince: '', holdReason: '', holdParty: '', holdDept: '',
    overdueNotifiedAt: '', dueSoonNotifiedAt: '', updatedAt: nowIso_() };
  if (newDue && newDue.dueDate) { patch.dueDate = newDue.dueDate; patch.dueTime = newDue.dueTime || ''; }
  else if (t.holdParty && t.holdParty !== 'internal' && t.dueDate) {
    var end = dueEnd_(t.dueDate, t.dueTime);
    // Deadline was paused: whatever time was left when the hold began is given back.
    if (end && end.getTime() > since) {
      var shifted = new Date(end.getTime() + held);
      patch.dueDate = Utilities.formatDate(shifted, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (t.dueTime) patch.dueTime = Utilities.formatDate(shifted, Session.getScriptTimeZone(), 'HH:mm');
    } else if (end) {
      // It was already late when put on hold — give one day after resuming.
      var d1 = new Date(Date.now() + 864e5);
      patch.dueDate = Utilities.formatDate(d1, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
  }
  dbUpdate_('Tasks', t.taskId, patch);
  var back = t.prevStatus && t.prevStatus !== STATUS.ON_HOLD ? t.prevStatus : (t.assigneeEmail ? STATUS.ASSIGNED : STATUS.NEW);
  if (back === STATUS.COMPLETED || back === STATUS.CANCELLED) back = t.assigneeEmail ? STATUS.IN_PROGRESS : STATUS.NEW;
  setStatus_(dbGet_('Tasks', t.taskId), back, actor, note || 'Resumed');
  logActivity_(t.taskId, actor, 'resume', '', '', (note || 'Resumed') + ' · on hold ' + Math.max(1, Math.round(held / 864e5 * 10) / 10) + ' day(s)' +
    (patch.dueDate && patch.dueDate !== t.dueDate ? ' · new due ' + dueText_(patch.dueDate, patch.dueTime !== undefined ? patch.dueTime : t.dueTime) : ''), 'team');
  if (!silent && t.assigneeEmail && (!actor || actor.email !== t.assigneeEmail)) {
    notify_([t.assigneeEmail], 'task_status', 'Resumed: ' + t.title, t.taskId + ' is active again.' + (patch.dueDate ? ' Due ' + dueText_(patch.dueDate, patch.dueTime || '') + '.' : ''), 'task/' + t.taskId, true);
  }
}

function api_holdTask(taskId, input) {
  return respond_(function () {
    var u = currentUser_();
    input = input || {};
    var reason = str_(input.reason, 1000, 'Reason', true);
    if (reason.length < 4) throw AppError_('VALIDATION', 'Say why the task is on hold, e.g. “Waiting for NI table and barcode”.');
    var party = oneOf_(String(input.party || 'internal'), Object.keys(HOLD_PARTIES), 'Waiting on');
    var dept = str_(input.dept, 100, 'Department', false);
    return withLock_(function () {
      var t = requireTask_(u, taskId);
      if (!taskPermissions_(u, t).canHold) throw AppError_('INVALID_STATE', 'This task can’t be put on hold now.');
      holdTask_(t, u, { reason: reason, party: party, dept: dept, notifyRequester: input.notifyRequester !== false });
      return { status: STATUS.ON_HOLD };
    });
  });
}

/** Resume a held task. input.dueDate/dueTime (optional) set a new deadline; otherwise it is moved out by the time held. */
function api_resumeTask(taskId, input) {
  return respond_(function () {
    var u = currentUser_();
    input = input || {};
    var due = input.dueDate ? { dueDate: date_(input.dueDate, 'Due date', true), dueTime: time_(input.dueTime, 'Due time', false) } : null;
    return withLock_(function () {
      var t = requireTask_(u, taskId);
      if (t.status !== STATUS.ON_HOLD) throw AppError_('INVALID_STATE', 'This task is not on hold.');
      if (!taskPermissions_(u, t).canResume) throw AppError_('FORBIDDEN', 'Only the team leader or the assigned designer can resume this task.');
      endHold_(t, u, 'Resumed', false, due);
      recomputeTaskStatus_(t.taskId, u);
      return { status: dbGet_('Tasks', t.taskId).status, dueDate: dbGet_('Tasks', t.taskId).dueDate };
    });
  });
}

/**
 * Leader reopens a completed task for new changes. The approved files stay as
 * the "final" versions until new ones are approved. input: { reason, deliverableIds?, dueDate, dueTime }
 */
function api_reopenTask(taskId, input) {
  return respond_(function () {
    var u = requireLeader_();
    input = input || {};
    var reason = str_(input.reason, 2000, 'What needs to change', true);
    if (reason.length < 5) throw AppError_('VALIDATION', 'Describe the changes needed.');
    var dueDate = date_(input.dueDate, 'New due date', true), dueTime = time_(input.dueTime, 'Due time', false);
    if (dueDate < isoDateOnly_()) throw AppError_('VALIDATION', 'The new due date can’t be in the past.');
    return withLock_(function () {
      var t = requireTask_(u, taskId);
      if (t.status !== STATUS.COMPLETED && t.status !== STATUS.APPROVED) throw AppError_('INVALID_STATE', 'Only a completed task can be reopened.');
      var dels = taskDeliverables_(t.taskId);
      var pick = Array.isArray(input.deliverableIds) && input.deliverableIds.length ? input.deliverableIds.map(String) : dels.map(function (d) { return d.deliverableId; });
      var chosen = dels.filter(function (d) { return pick.indexOf(d.deliverableId) !== -1; });
      if (!chosen.length && dels.length) throw AppError_('VALIDATION', 'Choose at least one creative to change.');
      var now = nowIso_();
      chosen.forEach(function (d) { dbUpdate_('CreativeSubmissions', d.deliverableId, { status: DSTATUS.CHANGES, updatedAt: now }); });
      dbUpdate_('Tasks', t.taskId, {
        status: STATUS.CHANGES, prevStatus: t.status, completedAt: '', progress: '50', dueDate: dueDate, dueTime: dueTime,
        reopenedAt: now, reopenReason: reason, reopenCount: String((Number(t.reopenCount) || 0) + 1),
        overdueNotifiedAt: '', dueSoonNotifiedAt: '', updatedAt: now
      });
      logActivity_(t.taskId, u, 'reopened', t.status, STATUS.CHANGES, reason + ' · ' + chosen.length + ' creative(s) · due ' + dueText_(dueDate, dueTime), 'team');
      var req = dbGet_('Requirements', t.requirementId);
      if (req && req.status === 'Completed') dbUpdate_('Requirements', req.requirementId, { status: 'Received', updatedAt: now });
      if (t.assigneeEmail && t.assigneeEmail !== u.email) {
        notify_([t.assigneeEmail], 'task_reopened', 'Reopened for changes: ' + t.title,
          'What needs to change:\n\n' + reason + '\n\nCreatives: ' + chosen.map(function (d) { return d.title; }).join(', ') + '\nDue ' + dueText_(dueDate, dueTime) +
          '\n\nThe approved files stay as the final versions until the new ones are approved.', 'task/' + t.taskId, true);
      }
      return { status: STATUS.CHANGES, reopened: chosen.length };
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
  if (o.folderPath !== undefined) patch.folderPath = cleanPath_(o.folderPath);
  if (o.bonusPoints !== undefined && o.bonusPoints !== '' && o.bonusPoints !== null) patch.bonusPoints = String(int_(o.bonusPoints, 0, 1000, 'Bonus points'));
  var bonus = Number(patch.bonusPoints !== undefined ? patch.bonusPoints : t.bonusPoints) || 0;
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
    t.taskId + ' · due ' + dueText_(dueDate, dueTime) + ' · ' + priority + ' priority' + (bonus ? '\n\nBonus: +' + bonus + ' points when this task is completed.' : '') +
    (instructions ? '\n\n' + instructions : ''), 'task/' + t.taskId);
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
        note: str_(p.note, 1000, 'Note', false),
        category: str_(p.category, 80, 'Category', false),
        folderPath: cleanPath_(str_(p.folderPath, 250, 'Folder', false)),
        bonusPoints: p.bonusPoints === '' || p.bonusPoints === undefined || p.bonusPoints === null ? undefined : int_(p.bonusPoints, 0, 1000, 'Bonus points')
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
      var partTitle = function (i) { return baseTitle + (clean[i].category ? ' — ' + clean[i].category : '') + ' (' + (i + 1) + '/' + n + ')'; };
      dbUpdate_('Tasks', t.taskId, { title: partTitle(0), deliverablesRequired: String(clean[0].count),
        creativeType: clean[0].category || t.creativeType, folderPath: clean[0].folderPath || t.folderPath || '', updatedAt: nowIso_() });
      logActivity_(t.taskId, u, 'updated', '', 'divided into ' + n + ' parts', '', 'team');
      assignInternal_(u, dbGet_('Tasks', t.taskId), { assignee: clean[0].assignee, dueDate: dueDate, dueTime: dueTime, priority: priority, note: clean[0].note, bonusPoints: clean[0].bonusPoints });
      // Parts 2..n become new tasks
      for (var i = 1; i < n; i++) {
        var newId = nextSeqId_('GFX');
        var now = nowIso_();
        var copy = {};
        SCHEMA.Tasks.forEach(function (c) { copy[c] = t[c]; });
        Object.assign(copy, {
          taskId: newId, title: partTitle(i), deliverablesRequired: String(clean[i].count), creativeType: clean[i].category || t.creativeType,
          folderPath: clean[i].folderPath || t.folderPath || '',
          assigneeEmail: '', assignedBy: '', assignedAt: '', status: STATUS.READY, prevStatus: '', progress: '0',
          completedAt: '', dueSoonNotifiedAt: '', overdueNotifiedAt: '', internalNotes: '', createdBy: u.email, createdAt: now, updatedAt: now
        });
        dbInsert_('Tasks', copy);
        logActivity_(newId, u, 'created', '', STATUS.READY, 'Divided from ' + t.taskId, 'team');
        assignInternal_(u, dbGet_('Tasks', newId), { assignee: clean[i].assignee, dueDate: dueDate, dueTime: dueTime, priority: priority, note: clean[i].note, bonusPoints: clean[i].bonusPoints });
        ids.push(newId);
      }
      return { taskIds: ids };
    });
  });
}

/**
 * Leader gives the team work directly — no request form. Creates an internal
 * request (so tracking, folders and reports work the same) and assigns it.
 */
function api_createDirectTask(input) {
  return respond_(function () {
    var u = requireLeader_();
    input = input || {};
    var s = settings_();
    var title = str_(input.title, 150, 'Task title', true);
    var brief = str_(input.brief, LIMITS.TEXT_LONG, 'Details', false) || title;
    var assignee = email_(input.assigneeEmail, 'Designer', true);
    var qty = int_(input.quantity || 1, 1, 50, 'Number of creatives');
    var dueDate = date_(input.dueDate, 'Due date', true), dueTime = time_(input.dueTime, 'Due time', false);
    if (dueDate < isoDateOnly_()) throw AppError_('VALIDATION', 'The due date can’t be in the past.');
    var priority = oneOf_(str_(input.priority, 20, 'Priority', false) || 'Medium', s.priorities, 'Priority');
    var category = str_(input.category, 80, 'Category', false);
    var folderPath = cleanPath_(str_(input.folderPath, 250, 'Folder', false));
    var department = str_(input.department, 100, 'Department', false) || 'Graphics team';
    var refs = urls_(input.referenceUrls);
    var intoReq = str_(input.requirementId, 40, 'Request', false), intoCamp = str_(input.campaignId, 40, 'Campaign', false);
    return withLock_(function () {
      var m = userByEmail_(assignee);
      if (!m || !bool_(m.active)) throw AppError_('VALIDATION', 'Choose an active team member.');
      var now = nowIso_();
      if (intoReq) {
        // Extra work inside an existing request: same folder, same Drive link, same tracking for the requester.
        var req0 = dbGet_('Requirements', intoReq);
        if (!req0) throw AppError_('NOT_FOUND', 'Request not found.');
        var tid = nextSeqId_('GFX');
        dbInsert_('Tasks', {
          taskId: tid, requirementId: req0.requirementId, title: title, brief: brief, creativeType: category, purpose: '', campaign: '', product: '',
          deliverablesRequired: String(qty), dimensions: '', formats: '', copyText: '', referenceUrls: refs.join('\n') || req0.referenceUrls,
          assigneeEmail: '', assignedBy: '', assignedAt: '', startDate: '', dueDate: dueDate, dueTime: dueTime, priority: priority,
          status: STATUS.READY, prevStatus: '', progress: '0', instructions: '', internalNotes: '', folderId: req0.folderId, completedAt: '',
          dueSoonNotifiedAt: '', overdueNotifiedAt: '', createdBy: u.email, createdAt: now, updatedAt: now, folderPath: folderPath
        });
        if (req0.status === 'Completed') dbUpdate_('Requirements', req0.requirementId, { status: 'In work', updatedAt: now });
        logActivity_(tid, u, 'created', '', STATUS.READY, 'added by the team leader to ' + req0.requirementId, 'team');
        assignInternal_(u, dbGet_('Tasks', tid), { assignee: m.email, dueDate: dueDate, dueTime: dueTime, priority: priority, instructions: str_(input.instructions, 2000, 'Instructions', false), bonusPoints: input.bonusPoints });
        return { taskId: tid, requirementId: req0.requirementId, campaignId: req0.campaignId || '' };
      }
      if (intoCamp && !dbGet_('Campaigns', intoCamp)) throw AppError_('NOT_FOUND', 'Campaign not found.');
      var reqId = nextSeqId_('REQ'), taskId = nextSeqId_('GFX');
      var folder = DriveApp.getFolderById(ensureFolderId_('references', [String(new Date().getFullYear())])).createFolder(reqId);
      dbInsert_('Requirements', {
        requirementId: reqId, requesterName: u.name, department: department, email: '', phone: '', title: title, creativeType: '',
        purpose: '', brief: brief, campaign: '', product: '', quantity: String(qty), dimensions: '', platform: '', copyText: '',
        referenceUrls: refs.join('\n'), typeFields: '{}', preferredDate: dueDate, priorityRequested: priority, instructions: '',
        folderId: folder.getId(), status: 'Received', notifiedAt: now, submittedAt: now, updatedAt: now, preferredTime: dueTime, submittedBy: u.email,
        campaignId: intoCamp || ''
      });
      dbInsert_('Tasks', {
        taskId: taskId, requirementId: reqId, title: title, brief: brief, creativeType: category, purpose: '', campaign: '', product: '',
        deliverablesRequired: String(qty), dimensions: '', formats: '', copyText: '', referenceUrls: refs.join('\n'),
        assigneeEmail: '', assignedBy: '', assignedAt: '', startDate: '', dueDate: dueDate, dueTime: dueTime, priority: priority,
        status: STATUS.READY, prevStatus: '', progress: '0', instructions: '', internalNotes: '', folderId: folder.getId(), completedAt: '',
        dueSoonNotifiedAt: '', overdueNotifiedAt: '', createdBy: u.email, createdAt: now, updatedAt: now, folderPath: folderPath
      });
      logActivity_(taskId, u, 'created', '', STATUS.READY, 'created by the team leader (' + reqId + ')', 'team');
      assignInternal_(u, dbGet_('Tasks', taskId), { assignee: m.email, dueDate: dueDate, dueTime: dueTime, priority: priority, instructions: str_(input.instructions, 2000, 'Instructions', false), bonusPoints: input.bonusPoints });
      return { taskId: taskId, requirementId: reqId, campaignId: intoCamp || '' };
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

/* ---------- delete (team leader) ---------- */

/**
 * Permanently deletes a task with its creatives, versions, review links,
 * decisions and activity. If it was the only task of its requirement, the
 * requirement (and its reference files) goes too, so it disappears from the
 * requester's "My requests". Drive files are moved to the Drive trash
 * (recoverable for 30 days), and nightly backups keep the old rows.
 */
function api_deleteTask(taskId) {
  return respond_(function () {
    var u = requireLeader_();
    return withLock_(function () {
      var t = requireTask_(u, taskId);
      var id = t.taskId;
      var files = [];
      dbFind_('CreativeVersions', function (v) { return v.taskId === id; }).forEach(function (v) { files.push(v.fileId, v.approvedFileId); });
      var requestIds = {};
      dbFind_('ApprovalRequests', function (r) { return r.taskId === id; }).forEach(function (r) { requestIds[r.requestId] = true; });

      var siblings = dbFind_('Tasks', function (x) { return x.requirementId === t.requirementId && x.taskId !== id; });
      var dropReq = !!t.requirementId && !siblings.length;
      var req = dropReq ? dbGet_('Requirements', t.requirementId) : null;

      dbFind_('ReferenceFiles', function (a) { return a.taskId === id || (dropReq && a.requirementId === t.requirementId); })
        .forEach(function (a) { files.push(a.fileId); });

      dbDeleteWhere_('ReviewTokens', function (k) { return requestIds[k.requestId]; });
      dbDeleteWhere_('ApprovalDecisions', function (x) { return x.taskId === id; });
      dbDeleteWhere_('ApprovalRequests', function (x) { return x.taskId === id; });
      dbDeleteWhere_('CreativeVersions', function (x) { return x.taskId === id; });
      dbDeleteWhere_('CreativeSubmissions', function (x) { return x.taskId === id; });
      dbDeleteWhere_('TaskAssignments', function (x) { return x.taskId === id; });
      dbDeleteWhere_('TaskActivity', function (x) { return x.taskId === id; });
      dbDeleteWhere_('Notifications', function (x) { return x.route === 'task/' + id; });
      dbDeleteWhere_('ReferenceFiles', function (a) { return a.taskId === id || (dropReq && a.requirementId === t.requirementId); });
      dbDeleteWhere_('Tasks', function (x) { return x.taskId === id; });
      if (dropReq) {
        dbDeleteWhere_('Requirements', function (r) { return r.requirementId === t.requirementId; });
      }

      files.filter(Boolean).forEach(function (f) { try { DriveApp.getFileById(f).setTrashed(true); } catch (e) { /* already gone */ } });
      if (dropReq && req && req.folderId) { try { DriveApp.getFolderById(req.folderId).setTrashed(true); } catch (e) { /* ignore */ } }

      if (t.assigneeEmail && t.assigneeEmail !== u.email) {
        notify_([t.assigneeEmail], 'task_deleted', 'Task deleted: ' + t.title, id + ' was deleted by ' + u.name + '. No further work is needed.', 'overview', false);
      }
      console.log('Task ' + id + ' deleted by ' + u.email + (dropReq ? ' (with requirement ' + t.requirementId + ')' : ''));
      return { deleted: id, requirementDeleted: dropReq ? t.requirementId : '' };
    });
  });
}

/* ======================= Uploads.gs ======================= */
/**
 * Uploads.gs — chunked uploads from the browser into Google Drive.
 *
 * Fast path: the server opens a Drive resumable-upload session for one file
 * and hands the browser that session URL; the browser sends the bytes
 * straight to Drive in one request, then calls api_finishUpload, which checks
 * the finished file's size and signature (and deletes it if wrong).
 * Fallback: if the direct send fails (e.g. a network that blocks it), the
 * browser sends 4 MB base64 chunks through api_uploadChunk, continuing from
 * wherever Drive stopped. The owner's OAuth token never leaves the server.
 * Upload state is kept in CacheService under an unguessable upload id bound
 * to the uploader.
 *
 * kinds:
 *   reference — public requester attachments (bound to an upload ticket)
 *   taskref   — leader adds a reference file to a task
 *   version   — designer/leader uploads a creative version
 */

var MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  pdf: 'application/pdf', psd: 'image/vnd.adobe.photoshop', ai: 'application/postscript', eps: 'application/postscript',
  indd: 'application/x-indesign', tif: 'image/tiff', tiff: 'image/tiff', mp4: 'video/mp4', mov: 'video/quicktime',
  zip: 'application/zip', txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

/** Magic-byte signatures for formats where a mismatch is a red flag. */
var SIGNATURES = {
  png: [[0x89, 0x50, 0x4E, 0x47]],
  jpg: [[0xFF, 0xD8, 0xFF]], jpeg: [[0xFF, 0xD8, 0xFF]],
  gif: [[0x47, 0x49, 0x46, 0x38]],
  pdf: [[0x25, 0x50, 0x44, 0x46]],
  webp: [[0x52, 0x49, 0x46, 0x46]],
  psd: [[0x38, 0x42, 0x50, 0x53]],
  zip: [[0x50, 0x4B]], docx: [[0x50, 0x4B]], pptx: [[0x50, 0x4B]], xlsx: [[0x50, 0x4B]]
};

function uploadCache_() { return CacheService.getScriptCache(); }

function saveUpload_(id, rec) { uploadCache_().put('upl_' + sha256_(id), JSON.stringify(rec), LIMITS.UPLOAD_TTL_SEC); }

function loadUpload_(id) {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(String(id || ''))) throw AppError_('UPLOAD_EXPIRED', 'Upload session not found. Please try the file again.');
  var raw = uploadCache_().get('upl_' + sha256_(id));
  if (!raw) throw AppError_('UPLOAD_EXPIRED', 'Upload session expired. Please try the file again.');
  return JSON.parse(raw);
}

function validateFile_(fileName, size, extensions, maxMB) {
  var name = safeFileName_(fileName);
  var ext = extOf_(name);
  if (!ext || extensions.indexOf(ext) === -1) throw AppError_('VALIDATION', '"' + name + '" isn’t an allowed file type. Allowed: ' + extensions.join(', ') + '.');
  size = Number(size);
  if (!isFinite(size) || size <= 0) throw AppError_('VALIDATION', '"' + name + '" is empty.');
  if (size > maxMB * 1024 * 1024) throw AppError_('VALIDATION', '"' + name + '" is larger than ' + maxMB + ' MB.');
  return { name: name, ext: ext, size: size, mime: MIME_BY_EXT[ext] || 'application/octet-stream' };
}

function api_startUpload(ctx) {
  return respond_(function () {
    ctx = ctx || {};
    var s = settings_();
    var kind = oneOf_(String(ctx.kind || ''), ['reference', 'taskref', 'version', 'share'], 'Upload type');
    var rec = { kind: kind, received: 0, sigChecked: false };
    var folderId;

    if (kind === 'reference') {
      var f = validateFile_(ctx.fileName, ctx.size, s.publicExtensions, s.maxPublicUploadMB);
      // Files upload in parallel, so the per-request file count is updated under a short lock.
      var lk = LockService.getScriptLock();
      if (!lk.tryLock(10000)) throw AppError_('BUSY', 'Busy — please try again.');
      var info;
      try {
        info = readTicket_(ctx.ticket);
        if (info.finalized) throw AppError_('INVALID_TICKET', 'This requirement is already submitted.');
        if (info.files >= s.maxPublicFiles) throw AppError_('VALIDATION', 'You can attach up to ' + s.maxPublicFiles + ' files.');
        info.files++;
        uploadCache_().put('tkt_' + sha256_(ctx.ticket), JSON.stringify(info), LIMITS.UPLOAD_TTL_SEC);
      } finally { lk.releaseLock(); }
      rec.owner = 'ticket:' + sha256_(ctx.ticket);
      rec.requirementId = info.requirementId;
      rec.file = f;
      folderId = info.folderId;
    } else if (kind === 'share') {
      // Another department sending files through a shared task link (no login).
      var sx = shareFromToken_(ctx.share);
      rateLimit_('shareupload:' + String(ctx.share).slice(0, 60), 30, 600);
      rec.owner = 'share:' + sha256_(ctx.share);
      rec.taskId = sx.task.taskId;
      rec.requirementId = sx.task.requirementId;
      rec.from = str_(ctx.uploaderName, 100, 'Your name', false);
      rec.file = validateFile_(ctx.fileName, ctx.size, s.allowedExtensions, s.maxPublicUploadMB);
      folderId = sx.task.folderId || ensureFolderId_('references', [String(new Date().getFullYear()), sx.task.requirementId]);
    } else {
      var u = currentUser_();
      var task = requireTask_(u, ctx.taskId);
      rec.owner = u.email;
      rec.taskId = task.taskId;
      rec.file = validateFile_(ctx.fileName, ctx.size, s.allowedExtensions, s.maxUploadMB);
      if (kind === 'taskref') {
        if (!isLeader_(u)) throw AppError_('FORBIDDEN', 'Only the team leader can add reference files to a task.');
        folderId = task.folderId || ensureFolderId_('references', [String(new Date().getFullYear()), task.requirementId]);
      } else {
        if (!taskPermissions_(u, task).canUpload) throw AppError_('INVALID_STATE', 'You can’t upload creatives while the task is ' + task.status.toLowerCase() + '.');
        rec.meta = {
          deliverableId: str_(ctx.deliverableId, 60, 'Deliverable', false),
          title: str_(ctx.title, 150, 'Creative title', !ctx.deliverableId),
          purpose: str_(ctx.purpose, 500, 'What the creative is for', false),
          deliverableType: str_(ctx.deliverableType, 100, 'Deliverable type', false),
          note: str_(ctx.note, 1000, 'Submission note', false)
        };
        if (rec.meta.deliverableId) {
          var d = dbGet_('CreativeSubmissions', rec.meta.deliverableId);
          if (!d || d.taskId !== task.taskId) throw AppError_('NOT_FOUND', 'That deliverable doesn’t belong to this task.');
        }
        folderId = ensureFolderId_('submissions', [String(new Date().getFullYear()), task.taskId]);
      }
    }

    rec.folderId = folderId;
    var origin = /^https:\/\/[a-z0-9.-]+\.(googleusercontent|google)\.com$/i.test(String(ctx.origin || '')) ? String(ctx.origin) : '';
    rec.sessionUri = startResumable_(rec.folderId, rec.file.name, rec.file.mime, rec.file.size, origin);
    var uploadId = randomToken_();
    saveUpload_(uploadId, rec);
    return { uploadId: uploadId, chunkBytes: LIMITS.CHUNK_BYTES, direct: origin ? rec.sessionUri : '' };
  });
}

/** Loads an upload and checks it belongs to the caller. Returns {rec, user}. */
function ownUpload_(uploadId) {
  var rec = loadUpload_(uploadId);
  var user = null;
  if (rec.owner.indexOf('ticket:') !== 0 && rec.owner.indexOf('share:') !== 0) {
    user = currentUser_();
    if (user.email !== rec.owner) throw AppError_('UPLOAD_EXPIRED', 'Upload session not found.');
  }
  return { rec: rec, user: user };
}

function signatureOk_(ext, bytes) {
  if (!SIGNATURES[ext]) return true;
  return SIGNATURES[ext].some(function (sig) {
    return sig.every(function (b, i) { return ((bytes[i] + 256) % 256) === b; });
  });
}

/**
 * Upload one chunk (fallback path). Chunks must arrive in order. The response
 * for the last chunk includes the created record (attachment or version).
 */
function api_uploadChunk(uploadId, offset, base64) {
  return respond_(function () {
    var o = ownUpload_(uploadId), rec = o.rec, user = o.user;
    offset = Number(offset);
    if (offset !== rec.received) throw AppError_('UPLOAD_ORDER', 'Upload got out of sync. Please retry the file.');
    var bytes = Utilities.base64Decode(String(base64 || ''));
    if (!bytes.length) throw AppError_('VALIDATION', 'Empty chunk.');
    if (bytes.length > LIMITS.CHUNK_BYTES || offset + bytes.length > rec.file.size) throw AppError_('VALIDATION', 'Chunk is larger than expected.');
    var isLast = offset + bytes.length === rec.file.size;
    if (!isLast && bytes.length % (256 * 1024) !== 0) throw AppError_('VALIDATION', 'Invalid chunk size.');

    if (offset === 0) {
      if (!signatureOk_(rec.file.ext, bytes)) throw AppError_('VALIDATION', '"' + rec.file.name + '" doesn’t look like a real .' + rec.file.ext + ' file.');
      rec.sigChecked = true;
    }

    var res = putChunk_(rec.sessionUri, bytes, offset, rec.file.size);
    if (!res.done) {
      rec.received = res.received || offset + bytes.length;
      saveUpload_(uploadId, rec);
      return { done: false, received: rec.received };
    }
    return completeUpload_(uploadId, rec, user, res.file);
  });
}

/**
 * Where an upload stands after a direct send. If Drive has the whole file it
 * is checked and recorded ({done:true,...}); otherwise returns
 * {done:false, received:n} so the browser can send the rest in chunks.
 */
function api_finishUpload(uploadId) {
  return respond_(function () {
    var o = ownUpload_(uploadId), rec = o.rec, user = o.user;
    var st = sessionStatus_(rec.sessionUri, rec.file.size);
    if (!st.done) {
      rec.received = st.received;
      saveUpload_(uploadId, rec);
      return { done: false, received: st.received };
    }
    return completeUpload_(uploadId, rec, user, st.file);
  });
}

/** Verifies a finished Drive file and records it. */
function completeUpload_(uploadId, rec, user, file) {
  uploadCache_().remove('upl_' + sha256_(uploadId));
  var bad = '';
  if (Number(file.size) !== rec.file.size) bad = '"' + rec.file.name + '" didn’t arrive complete. Please try again.';
  else if (!rec.sigChecked && SIGNATURES[rec.file.ext]) {
    var head = headBytes_(file.id, 8);
    if (!head || !signatureOk_(rec.file.ext, head)) bad = '"' + rec.file.name + '" doesn’t look like a real .' + rec.file.ext + ' file.';
  }
  if (bad) {
    try { DriveApp.getFileById(file.id).setTrashed(true); } catch (e) { console.warn('Could not remove rejected upload ' + file.id); }
    throw AppError_('VALIDATION', bad);
  }
  if (rec.kind === 'share') {
    return withLock_(function () {
      var att = dbInsert_('ReferenceFiles', {
        attachmentId: 'ATT-' + uuid_(), requirementId: rec.requirementId || '', taskId: rec.taskId, fileId: file.id, fileName: rec.file.name,
        mimeType: rec.file.mime, sizeBytes: String(rec.file.size), uploadedBy: 'shared link: ' + (rec.from || ''), uploadedAt: nowIso_()
      });
      return { done: true, attachmentId: att.attachmentId, fileName: att.fileName };
    });
  }
  if (rec.kind === 'reference' || rec.kind === 'taskref') {
    return withLock_(function () {
      var att = dbInsert_('ReferenceFiles', {
        attachmentId: 'ATT-' + uuid_(), requirementId: rec.requirementId || (dbGet_('Tasks', rec.taskId) || {}).requirementId || '',
        taskId: rec.kind === 'taskref' ? rec.taskId : '', fileId: file.id, fileName: rec.file.name,
        mimeType: rec.file.mime, sizeBytes: String(rec.file.size), uploadedBy: user ? user.email : 'requester', uploadedAt: nowIso_()
      });
      if (rec.kind === 'taskref') logActivity_(rec.taskId, user, 'reference_added', '', rec.file.name, '', 'team');
      return { done: true, attachmentId: att.attachmentId, fileName: att.fileName };
    });
  }
  return Object.assign({ done: true }, createVersion_(user, rec, file));
}

/** Creates a Draft version for an uploaded creative. */
function createVersion_(user, rec, file) {
  return withLock_(function () {
    var task = requireTask_(user, rec.taskId);
    if (!taskPermissions_(user, task).canUpload) throw AppError_('INVALID_STATE', 'This task no longer accepts uploads.');
    var now = nowIso_();
    var d;
    if (rec.meta.deliverableId) {
      d = dbGet_('CreativeSubmissions', rec.meta.deliverableId);
    } else {
      var n = taskDeliverables_(task.taskId).length + 1;
      d = dbInsert_('CreativeSubmissions', {
        deliverableId: task.taskId + '-D' + n, taskId: task.taskId, title: rec.meta.title, purpose: rec.meta.purpose,
        deliverableType: rec.meta.deliverableType || task.creativeType, status: DSTATUS.DRAFT, latestVersionNo: '0',
        latestVersionId: '', approvedVersionId: '', createdBy: user.email, createdAt: now, updatedAt: now
      });
    }
    // Only one unsubmitted draft per deliverable: an older draft is superseded.
    dbFind_('CreativeVersions', function (v) { return v.deliverableId === d.deliverableId && v.status === VSTATUS.DRAFT; })
      .forEach(function (v) { dbUpdate_('CreativeVersions', v.versionId, { status: VSTATUS.SUPERSEDED }); });

    var versionNo = Number(d.latestVersionNo || 0) + 1;
    var versionId = 'VER-' + uuid_();
    var niceName = d.deliverableId + '_V' + versionNo + '_' + rec.file.name;
    try { DriveApp.getFileById(file.id).setName(niceName); } catch (e) { console.warn('Rename failed: ' + e); }
    dbInsert_('CreativeVersions', {
      versionId: versionId, deliverableId: d.deliverableId, taskId: task.taskId, versionNo: String(versionNo),
      fileId: file.id, fileName: niceName, mimeType: rec.file.mime, sizeBytes: String(rec.file.size),
      note: rec.meta.note, uploadedBy: user.email, uploadedAt: now, status: VSTATUS.DRAFT, submittedAt: '', approvedFileId: ''
    });
    dbUpdate_('CreativeSubmissions', d.deliverableId, { latestVersionNo: String(versionNo), latestVersionId: versionId, updatedAt: now });
    logActivity_(task.taskId, user, 'upload', '', d.title + ' · V' + versionNo, rec.meta.note, 'team');
    if (task.status === STATUS.ASSIGNED) setStatus_(task, STATUS.IN_PROGRESS, user, 'First upload');
    return { versionId: versionId, deliverableId: d.deliverableId, versionNo: versionNo };
  });
}

/* ---------- internal file access (team only) ---------- */

/** Looks up a version/attachment file the current user may see. */
function assetRef_(u, kind, id) {
  if (kind === 'version') {
    var v = dbGet_('CreativeVersions', str_(id, 60, 'Version', true));
    if (!v) throw AppError_('NOT_FOUND', 'File not found.');
    requireTask_(u, v.taskId);
    return { fileId: v.fileId, mime: v.mimeType, size: v.sizeBytes, name: v.fileName };
  }
  if (kind === 'attachment') {
    var a = dbGet_('ReferenceFiles', str_(id, 60, 'Attachment', true));
    if (!a) throw AppError_('NOT_FOUND', 'File not found.');
    var task = a.taskId ? dbGet_('Tasks', a.taskId) : dbFind_('Tasks', function (t) {
      return t.requirementId === a.requirementId && (isLeader_(u) || t.assigneeEmail === u.email);
    })[0];
    if (!task) throw AppError_('NOT_FOUND', 'File not found.');
    requireTask_(u, task.taskId);
    return { fileId: a.fileId, mime: a.mimeType, size: a.sizeBytes, name: a.fileName };
  }
  throw AppError_('VALIDATION', 'Unknown file.');
}

/** Preview or original for a version/attachment the current user may see. */
function api_getAsset(kind, id, mode) {
  return respond_(function () {
    var u = currentUser_();
    var f = assetRef_(u, kind, id);
    if (mode === 'original') return originalOf_(f.fileId, f.name);
    if (mode === 'thumb') { var t = smallThumb_(f); return t ? { kind: 'thumbnail', dataUrl: t } : { kind: 'none' }; }
    var p = previewOf_(f.fileId, f.mime, f.size, 1600);
    if (mode === 'drive' && isLeader_(u)) { try { p.driveUrl = DriveApp.getFileById(f.fileId).getUrl(); } catch (e) { /* ignore */ } }
    return p;
  });
}

/** Many small thumbnails in one round trip. items: [{kind, id}] (max 24). Returns { "kind:id": dataUrl|null }. */
function api_getThumbs(items) {
  return respond_(function () {
    var u = currentUser_();
    var out = {};
    (Array.isArray(items) ? items : []).slice(0, 24).forEach(function (it) {
      var key = it.kind + ':' + it.id;
      try { out[key] = smallThumb_(assetRef_(u, it.kind, it.id)); } catch (e) { out[key] = null; }
    });
    return out;
  });
}

/** 480px thumbnail, cached for 6 hours (files never change once uploaded). */
function smallThumb_(f) {
  var cache = CacheService.getScriptCache(), key = 'th_' + f.fileId;
  var hit = cache.get(key);
  if (hit) return hit === '-' ? null : hit;
  var url = thumbnail_(f.fileId, 480);
  if (!url && INLINE_IMAGE_TYPES.indexOf(f.mime) !== -1 && Number(f.size) <= 300 * 1024) {
    var p = previewOf_(f.fileId, f.mime, f.size, 480); url = p.dataUrl || null;
  }
  try { cache.put(key, url && url.length < 95000 ? url : (url ? '' : '-'), 21600); } catch (e) { /* too big to cache */ }
  return url;
}

/* ======================= Approvals.gs ======================= */
/**
 * Approvals.gs — submitting versions for approval, review links and decisions.
 *
 * Review links: a 256-bit random token per link. Only its SHA-256 hash is
 * stored (ReviewTokens), with expiry and revocation. A token is scoped to
 * one approval request = one creative version. When a decision is made, or
 * a newer version is submitted, every token of that request stops working.
 */

function reviewUrl_(token) {
  var base = settings_().publicUrl;
  if (!base) { try { base = ScriptApp.getService().getUrl(); } catch (e) { base = ''; } }
  return base + '?p=review&t=' + token;
}

function issueToken_(requestId, actor) {
  var token = randomToken_();
  var days = Math.max(1, Math.min(90, Number(settings_().tokenExpiryDays) || 14));
  dbInsert_('ReviewTokens', {
    tokenId: 'TOK-' + uuid_(), requestId: requestId, tokenHash: sha256_(token), createdBy: actor ? actor.email || actor : 'system',
    createdAt: nowIso_(), expiresAt: new Date(Date.now() + days * 864e5).toISOString(), revokedAt: '', revokeReason: '', lastOpenedAt: ''
  });
  return token;
}

function revokeTokens_(requestId, reason) {
  dbFind_('ReviewTokens', function (k) { return k.requestId === requestId && !k.revokedAt; })
    .forEach(function (k) { dbUpdate_('ReviewTokens', k.tokenId, { revokedAt: nowIso_(), revokeReason: reason }); });
}

/** Supersede open requests for a deliverable (new version submitted). */
function supersedeOpenRequests_(deliverableId, exceptRequestId) {
  dbFind_('ApprovalRequests', function (r) {
    return r.deliverableId === deliverableId && r.status === 'Open' && r.requestId !== exceptRequestId;
  }).forEach(function (r) {
    dbUpdate_('ApprovalRequests', r.requestId, { status: 'Superseded', closedAt: nowIso_() });
    revokeTokens_(r.requestId, 'superseded');
    var v = dbGet_('CreativeVersions', r.versionId);
    if (v && v.status === VSTATUS.AWAITING) dbUpdate_('CreativeVersions', v.versionId, { status: VSTATUS.SUPERSEDED });
  });
}

function closeOpenRequests_(taskId, reason) {
  dbFind_('ApprovalRequests', function (r) { return r.taskId === taskId && r.status === 'Open'; }).forEach(function (r) {
    dbUpdate_('ApprovalRequests', r.requestId, { status: 'Cancelled', closedAt: nowIso_() });
    revokeTokens_(r.requestId, reason || 'cancelled');
  });
}

/**
 * Submit draft versions for approval. If versionIds is empty, every draft on
 * the task is submitted. Returns review links only to leaders.
 */
function api_submitForApproval(taskId, versionIds) {
  return respond_(function () {
    var u = currentUser_();
    return withLock_(function () {
      var task = requireTask_(u, taskId);
      if (!taskPermissions_(u, task).canUpload) throw AppError_('INVALID_STATE', 'This task can’t be submitted while it is ' + task.status.toLowerCase() + '.');
      var wanted = Array.isArray(versionIds) && versionIds.length ? versionIds : null;
      var drafts = dbFind_('CreativeVersions', function (v) {
        return v.taskId === task.taskId && v.status === VSTATUS.DRAFT && (!wanted || wanted.indexOf(v.versionId) !== -1);
      });
      if (!drafts.length) throw AppError_('VALIDATION', 'Upload a creative first — there’s nothing new to submit.');

      var links = [], lines = [];
      drafts.forEach(function (v) {
        var d = dbGet_('CreativeSubmissions', v.deliverableId);
        var requestId = 'APR-' + uuid_();
        supersedeOpenRequests_(d.deliverableId, null);
        dbInsert_('ApprovalRequests', { requestId: requestId, versionId: v.versionId, deliverableId: d.deliverableId,
          taskId: task.taskId, status: 'Open', createdBy: u.email, createdAt: nowIso_(), closedAt: '' });
        dbUpdate_('CreativeVersions', v.versionId, { status: VSTATUS.AWAITING, submittedAt: nowIso_() });
        // A new version after approval needs a fresh approval; the old approval stays on record.
        dbUpdate_('CreativeSubmissions', d.deliverableId, { status: DSTATUS.AWAITING, updatedAt: nowIso_() });
        var token = issueToken_(requestId, u);
        var url = reviewUrl_(token);
        links.push({ versionId: v.versionId, deliverable: d.title, versionNo: v.versionNo, url: url });
        lines.push('• ' + d.title + ' (V' + v.versionNo + '): ' + url);
        logActivity_(task.taskId, u, 'submitted', '', d.title + ' · V' + v.versionNo, '', 'team');
      });
      recomputeTaskStatus_(task.taskId, u);

      var leaders = leaderEmails_();
      notify_(leaders, 'approval_submitted', 'Ready for approval: ' + task.title,
        (isLeader_(u) ? 'Submitted' : displayName_(u.email) + ' submitted') + ' ' + drafts.length + ' creative(s) for ' + task.taskId + '.\n\nReview links:\n' + lines.join('\n'),
        'task/' + task.taskId);

      var s = settings_();
      var req = dbGet_('Requirements', task.requirementId);
      if (s.sendReviewLinkToRequester && req && req.email) {
        sendMail_(req.email, 'Please review: ' + task.title,
          'Hi ' + req.requesterName + ',\n\nThe graphics team has creative(s) ready for your approval on "' + req.title + '" (' + req.requirementId + ').\n\n' +
          lines.join('\n') + '\n\nOpen each link to approve it or ask for changes. Links expire in ' + s.tokenExpiryDays + ' days.', null);
      }
      return { submitted: drafts.length, links: isLeader_(u) ? links : [] };
    });
  });
}

/** Leader: create an additional review link for a version's open request. */
function api_createReviewLink(versionId) {
  return respond_(function () {
    var u = requireLeader_();
    return withLock_(function () {
      var r = dbFind_('ApprovalRequests', function (x) { return x.versionId === versionId && x.status === 'Open'; })[0];
      if (!r) throw AppError_('INVALID_STATE', 'This version isn’t waiting for approval.');
      var token = issueToken_(r.requestId, u);
      logActivity_(r.taskId, u, 'link_created', '', '', 'New review link created', 'leader');
      return { url: reviewUrl_(token), expiresInDays: settings_().tokenExpiryDays };
    });
  });
}

/** Leader: revoke every active review link for a version. */
function api_revokeReviewLinks(versionId) {
  return respond_(function () {
    var u = requireLeader_();
    return withLock_(function () {
      var reqs = dbFind_('ApprovalRequests', function (x) { return x.versionId === versionId; });
      if (!reqs.length) throw AppError_('NOT_FOUND', 'No review links for this version.');
      reqs.forEach(function (r) { revokeTokens_(r.requestId, 'revoked by leader'); });
      logActivity_(reqs[0].taskId, u, 'link_revoked', '', '', 'Review links revoked', 'leader');
      return true;
    });
  });
}

/** Leader approves / requests changes from inside the portal. */
function api_leaderDecision(versionId, decision, comment) {
  return respond_(function () {
    var u = requireLeader_();
    decision = oneOf_(String(decision || ''), ['approved', 'changes', 'rejected'], 'Decision');
    comment = str_(comment, 4000, 'Feedback', decision !== 'approved');
    return withLock_(function () {
      var r = dbFind_('ApprovalRequests', function (x) { return x.versionId === versionId && x.status === 'Open'; })[0];
      if (!r) throw AppError_('ALREADY_DECIDED', 'This version is no longer waiting for approval.');
      // Team leaders may approve their own work.
      applyDecision_(r, decision, comment, { name: u.name, email: u.email }, 'portal', u);
      return { status: dbGet_('Tasks', r.taskId).status };
    });
  });
}

/** Who gets the approval / changes email: the designer who made the version and the current assignee (not whoever decided). */
function designerRecipients_(task, v, actor) {
  var me = actor && actor.email ? String(actor.email).toLowerCase() : '';
  return [v.uploadedBy, task.assigneeEmail].map(function (e) { return String(e || '').toLowerCase(); })
    .filter(function (e, i, a) { return e && e !== me && a.indexOf(e) === i; });
}

/** Records a decision. Caller holds the lock and has verified the request is Open. */
function applyDecision_(request, decision, comment, reviewer, channel, actor, opts) {
  var now = nowIso_();
  var v = dbGet_('CreativeVersions', request.versionId);
  var d = dbGet_('CreativeSubmissions', request.deliverableId);
  var task = dbGet_('Tasks', request.taskId);

  dbUpdate_('ApprovalRequests', request.requestId, { status: 'Decided', closedAt: now });
  revokeTokens_(request.requestId, 'used');
  dbInsert_('ApprovalDecisions', {
    decisionId: 'DEC-' + uuid_(), requestId: request.requestId, versionId: v.versionId, deliverableId: d.deliverableId,
    taskId: task.taskId, decision: decision, comment: comment || '', reviewerName: reviewer.name || '',
    reviewerEmail: reviewer.email || '', channel: channel, decidedBy: actor && actor.email ? actor.email : '', decidedAt: now
  });

  if (decision === 'approved') {
    // The approved copy goes into the request's shared folder, in a sub-folder for its kind of creative.
    var copyId = fileApprovedCopy_(task, d, v);
    dbUpdate_('CreativeVersions', v.versionId, { status: VSTATUS.APPROVED, approvedFileId: copyId });
    dbUpdate_('CreativeSubmissions', d.deliverableId, { status: DSTATUS.APPROVED, approvedVersionId: v.versionId, updatedAt: now });
  } else if (decision === 'rejected') {
    dbUpdate_('CreativeVersions', v.versionId, { status: VSTATUS.REJECTED });
    dbUpdate_('CreativeSubmissions', d.deliverableId, { status: DSTATUS.REJECTED, updatedAt: now });
  } else {
    dbUpdate_('CreativeVersions', v.versionId, { status: VSTATUS.CHANGES });
    dbUpdate_('CreativeSubmissions', d.deliverableId, { status: DSTATUS.CHANGES, updatedAt: now });
  }

  var label = decision === 'approved' ? 'Approved' : decision === 'rejected' ? 'Rejected' : 'Changes requested';
  var action = decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'changes_requested';
  logActivity_(task.taskId, channel === 'public' ? 'reviewer' : actor, action, '', d.title + ' · V' + v.versionNo, comment || '', 'team');

  if (opts && opts.quiet) { recomputeTaskStatus_(task.taskId, 'system'); return { task: task, d: d, v: v }; }
  var who = reviewer.name ? reviewer.name + (reviewer.email ? ' (' + reviewer.email + ')' : '') : 'An anonymous reviewer';
  var title = label + ': ' + d.title + ' V' + v.versionNo;
  var mail = designerRecipients_(task, v, actor);
  // Email goes only to the designer. Leaders just see it in the portal's bell.
  var ntype = decision === 'approved' ? 'creative_approved' : decision === 'rejected' ? 'creative_rejected' : 'changes_requested';
  notify_(mail, ntype, title,
    (decision === 'approved' ? 'Nice work — this creative is approved.' : decision === 'rejected' ? 'This creative won’t be used.\n\nReason: ' + comment +
      '\n\nIf the task still needs more creatives, upload a new one.' : 'Feedback from the reviewer:\n\n' + comment), 'task/' + task.taskId, true);
  notify_(leaderEmails_().filter(function (e) { return mail.indexOf(e) === -1; }), ntype,
    title, who + ' — ' + task.taskId + (comment ? '\n\n“' + comment + '”' : ''), 'task/' + task.taskId, false);
  recomputeTaskStatus_(task.taskId, 'system');
  return { task: task, d: d, v: v };
}

/**
 * Approves many creatives in one go. pick(versionId) returns the open request
 * or throws; skips anything already decided. One summary notification per task.
 * Caller holds the lock.
 */
function approveMany_(versionIds, comment, reviewer, channel, actor, pick) {
  var byTask = {}, approved = 0, skipped = [];
  versionIds.forEach(function (id) {
    var r;
    try { r = pick(id); } catch (e) { skipped.push({ versionId: id, reason: e.message || 'Skipped' }); return; }
    var res = applyDecision_(r, 'approved', comment, reviewer, channel, actor, { quiet: true });
    approved++;
    var g = (byTask[res.task.taskId] = byTask[res.task.taskId] || { task: res.task, titles: [], versions: [] });
    g.titles.push(res.d.title + ' V' + res.v.versionNo); g.versions.push(res.v);
  });
  var who = reviewer.name ? reviewer.name + (reviewer.email ? ' (' + reviewer.email + ')' : '') : 'An anonymous reviewer';
  Object.keys(byTask).forEach(function (tid) {
    var g = byTask[tid], n = g.titles.length, list = g.titles.join('\n');
    var title = 'Approved ' + n + ' creative' + (n > 1 ? 's' : '') + ': ' + g.task.title;
    var mail = [];
    g.versions.forEach(function (v) { designerRecipients_(g.task, v, actor).forEach(function (e) { if (mail.indexOf(e) === -1) mail.push(e); }); });
    notify_(mail, 'creative_approved', title, 'Nice work — these are approved:\n' + list + (comment ? '\n\n“' + comment + '”' : ''), 'task/' + tid, true);
    notify_(leaderEmails_().filter(function (e) { return mail.indexOf(e) === -1 && (!actor || e !== actor.email); }), 'creative_approved',
      title, who + ' — ' + tid + '\n\n' + list + (comment ? '\n\n“' + comment + '”' : ''), 'task/' + tid, false);
  });
  return { approved: approved, skipped: skipped };
}

/** Leader approves many creatives at once (max 60 per call). */
function api_leaderApproveMany(versionIds, comment) {
  return respond_(function () {
    var u = requireLeader_();
    var ids = (Array.isArray(versionIds) ? versionIds : []).map(String).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    if (!ids.length) throw AppError_('VALIDATION', 'Select at least one creative.');
    if (ids.length > 60) throw AppError_('VALIDATION', 'Approve up to 60 at a time.');
    comment = str_(comment, 4000, 'Feedback', false);
    return withLock_(function () {
      return approveMany_(ids, comment, { name: u.name, email: u.email }, 'portal', u, function (id) {
        var r = dbFind_('ApprovalRequests', function (x) { return x.versionId === id && x.status === 'Open'; })[0];
        if (!r) throw AppError_('ALREADY_DECIDED', 'No longer waiting for approval.');
        return r;
      });
    });
  });
}

/** Leader: open approval requests with context, for the Approvals page. */
function api_listApprovals(scope) {
  return respond_(function () {
    requireLeader_();
    var rows = dbAll_('ApprovalRequests');
    if (scope !== 'all') rows = rows.filter(function (r) { return r.status === 'Open'; });
    else rows = rows.slice(-200);
    return rows.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }).map(approvalRowDto_);
  });
}

function approvalRowDto_(r) {
  var v = dbGet_('CreativeVersions', r.versionId) || {};
  var d = dbGet_('CreativeSubmissions', r.deliverableId) || {};
  var t = dbGet_('Tasks', r.taskId) || {};
  var dec = dbFind_('ApprovalDecisions', function (x) { return x.requestId === r.requestId; })[0];
  return {
    requestId: r.requestId, status: r.status, createdAt: r.createdAt, closedAt: r.closedAt,
    versionId: v.versionId, versionNo: v.versionNo, fileName: v.fileName, mimeType: v.mimeType,
    deliverableTitle: d.title, deliverableId: d.deliverableId, taskId: t.taskId, taskTitle: t.title, campaign: t.campaign,
    dueDate: t.dueDate, dueTime: t.dueTime, uploadedBy: v.uploadedBy, uploadedByName: v.uploadedBy ? displayName_(v.uploadedBy) : '',
    decision: dec ? { decision: dec.decision, comment: dec.comment, reviewerName: dec.reviewerName, reviewerEmail: dec.reviewerEmail, decidedAt: dec.decidedAt, channel: dec.channel } : null
  };
}

/* ======================= Review.gs ======================= */
/**
 * Review.gs — the public, no-login review page API.
 *
 * Everything returned here is built from an explicit allow-list
 * (reviewDto_). Designer names/emails, internal notes, task ids of other
 * work and Drive URLs are never included. The file itself is streamed by
 * the server, so the Drive file stays private.
 */

var TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/;

function lookupToken_(token) {
  if (!TOKEN_RE.test(String(token || ''))) return { state: 'invalid' };
  var hash = sha256_(token);
  var tok = dbFind_('ReviewTokens', function (k) { return k.tokenHash === hash; })[0];
  if (!tok) return { state: 'invalid' };
  var req = dbGet_('ApprovalRequests', tok.requestId);
  if (!req) return { state: 'invalid' };
  var ctx = { tok: tok, req: req };
  if (req.status === 'Decided') return Object.assign(ctx, { state: 'decided' });
  if (req.status === 'Superseded') return Object.assign(ctx, { state: 'superseded' });
  if (req.status === 'Cancelled') return Object.assign(ctx, { state: 'revoked' });
  if (tok.revokedAt) return Object.assign(ctx, { state: 'revoked' });
  if (new Date(tok.expiresAt).getTime() < Date.now()) return Object.assign(ctx, { state: 'expired' });
  var task = dbGet_('Tasks', req.taskId);
  // A task on hold (e.g. waiting for the NI table) can still be reviewed.
  if (!task || task.status === STATUS.CANCELLED) return Object.assign(ctx, { state: 'revoked' });
  return Object.assign(ctx, { state: 'open' });
}

function sizeLabel_(n) {
  n = Number(n || 0);
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}

function reviewDto_(ctx, withPreview) {
  var s = settings_();
  var out = { state: ctx.state, companyName: s.companyName, portalName: s.portalName };
  if (ctx.state === 'invalid') return out;
  var v = dbGet_('CreativeVersions', ctx.req.versionId);
  var d = dbGet_('CreativeSubmissions', ctx.req.deliverableId);
  var t = dbGet_('Tasks', ctx.req.taskId);
  if (!v || !d || !t) return { state: 'invalid', companyName: s.companyName, portalName: s.portalName };

  out.creative = {
    title: d.title,
    purpose: d.purpose || t.purpose || String(t.brief || '').slice(0, 300),
    campaign: t.campaign,
    product: t.product,
    dimensions: t.dimensions,
    deliverableType: d.deliverableType || t.creativeType,
    version: 'V' + v.versionNo,
    status: ctx.state === 'open' ? 'Awaiting Approval' : (v.status === VSTATUS.SUPERSEDED ? 'Replaced by a newer version' : v.status),
    submittedOn: String(v.submittedAt || v.uploadedAt).slice(0, 10),
    fileType: (extOf_(v.fileName) || 'file').toUpperCase(),
    fileSize: sizeLabel_(v.sizeBytes)
  };
  if (ctx.state === 'decided') {
    var dec = dbFind_('ApprovalDecisions', function (x) { return x.requestId === ctx.req.requestId; })[0];
    if (dec) out.decision = { decision: dec.decision, decidedOn: String(dec.decidedAt).slice(0, 10), comment: dec.comment };
  }
  if (ctx.state === 'open') {
    out.identityMode = s.reviewerIdentity;
    out.allowDownload = !!s.allowReviewerDownload;
    out.isImage = INLINE_IMAGE_TYPES.indexOf(v.mimeType) !== -1 && Number(v.sizeBytes) <= LIMITS.ORIGINAL_INLINE_BYTES;
    out.canOpenOriginal = Number(v.sizeBytes) <= LIMITS.ORIGINAL_INLINE_BYTES;
    // Earlier feedback on this same creative, so the reviewer can check it was addressed.
    out.history = dbFind_('ApprovalDecisions', function (x) { return x.deliverableId === d.deliverableId; })
      .map(function (x) {
        var xv = dbGet_('CreativeVersions', x.versionId) || {};
        return { version: 'V' + xv.versionNo, decision: x.decision, comment: x.comment, decidedOn: String(x.decidedAt).slice(0, 10) };
      });
    if (withPreview) out.preview = previewOf_(v.fileId, v.mimeType, v.sizeBytes, 2000);
  }
  return out;
}

function api_getReview(token) {
  return respond_(function () {
    rateLimit_('review:' + String(token).slice(0, 60), 120, 600);
    var ctx = lookupToken_(token);
    if (ctx.state === 'open') {
      withLock_(function () { dbUpdate_('ReviewTokens', ctx.tok.tokenId, { lastOpenedAt: nowIso_() }); });
    }
    return reviewDto_(ctx, true);
  });
}

/** Full-resolution file for zoom / download (only while the link is open). */
function api_getReviewOriginal(token, purpose) {
  return respond_(function () {
    rateLimit_('reviewfile:' + String(token).slice(0, 60), 30, 600);
    var ctx = lookupToken_(token);
    if (ctx.state !== 'open') throw AppError_('LINK_CLOSED', 'This review link is no longer active.');
    var v = dbGet_('CreativeVersions', ctx.req.versionId);
    var d = dbGet_('CreativeSubmissions', ctx.req.deliverableId);
    if (purpose === 'download' && !settings_().allowReviewerDownload) throw AppError_('FORBIDDEN', 'Downloads are turned off for review links.');
    if (purpose !== 'download' && INLINE_IMAGE_TYPES.indexOf(v.mimeType) === -1) throw AppError_('VALIDATION', 'Use download to open this file type.');
    // Name the download after the creative, not the internal file name.
    var cleanName = (d.title || 'creative').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_V' + v.versionNo + '.' + (extOf_(v.fileName) || 'bin');
    return originalOf_(v.fileId, cleanName);
  });
}

function api_submitReview(token, input) {
  return respond_(function () {
    input = input || {};
    rateLimit_('reviewsubmit:' + String(token).slice(0, 60), 10, 600);
    var decision = oneOf_(String(input.decision || ''), ['approved', 'changes', 'rejected'], 'Decision');
    var comment = str_(input.comment, 4000, 'Feedback', decision !== 'approved');
    if (decision !== 'approved' && comment.length < 5) throw AppError_('VALIDATION', decision === 'rejected' ? 'Say why it’s rejected.' : 'Please tell the team what to change.');
    var mode = settings_().reviewerIdentity;
    var reviewer = { name: '', email: '' };
    if (mode !== 'anonymous') {
      reviewer.name = str_(input.reviewerName, 100, 'Your name', mode === 'required');
      reviewer.email = email_(input.reviewerEmail, 'Your work email', mode === 'required');
    }
    return withLock_(function () {
      var ctx = lookupToken_(token);   // re-check inside the lock: prevents double decisions
      if (ctx.state === 'decided') throw AppError_('ALREADY_DECIDED', 'A decision has already been recorded for this creative. Thank you!');
      if (ctx.state !== 'open') throw AppError_('LINK_CLOSED', 'This review link is no longer active.');
      var v = dbGet_('CreativeVersions', ctx.req.versionId);
      var t = dbGet_('Tasks', ctx.req.taskId);
      var rv = reviewer.email ? userByEmail_(reviewer.email) : null;
      var isLeaderReviewer = rv && bool_(rv.active) && rv.role === ROLES.LEADER;   // leaders may approve their own work
      if (reviewer.email && !isLeaderReviewer && (reviewer.email === String(v.uploadedBy).toLowerCase() || reviewer.email === String(t.assigneeEmail).toLowerCase())) {
        throw AppError_('FORBIDDEN', 'The designer of a creative can’t approve their own work.');
      }
      applyDecision_(ctx.req, decision, comment, reviewer, 'public', null);
      return { state: 'decided', decision: decision };
    });
  });
}

/* ======================= Admin.gs ======================= */
/**
 * Admin.gs — team management, settings and Drive health (leader only),
 * plus the hourly maintenance job.
 */

/* ---------- team ---------- */

function api_listTeam() {
  return respond_(function () {
    requireLeader_();
    var tasks = dbAll_('Tasks');
    return {
      users: dbAll_('Users').map(function (x) {
        var mine = tasks.filter(function (t) { return t.assigneeEmail === x.email; });
        return Object.assign(pick_(x, ['userId', 'email', 'name', 'role', 'createdAt', 'designation']), {
          active: bool_(x.active),
          activeTasks: mine.filter(function (t) { return CLOSED.indexOf(t.status) === -1 && t.status !== STATUS.APPROVED; }).length,
          completed: mine.filter(function (t) { return t.status === STATUS.COMPLETED; }).length
        });
      }),
      departments: dbAll_('Departments').map(function (d) { return { departmentId: d.departmentId, name: d.name, active: bool_(d.active) }; }),
      allowedDomain: settings_().allowedDomain,
      designations: settings_().designations
    };
  });
}

function api_saveUser(input) {
  return respond_(function () {
    var u = requireLeader_();
    input = input || {};
    var email = email_(input.email, 'Email', true);
    var name = str_(input.name, 100, 'Name', true);
    var role = oneOf_(String(input.role || ''), [ROLES.LEADER, ROLES.DESIGNER], 'Role');
    var designation = str_(input.designation, 60, 'Designation', false);
    var domain = settings_().allowedDomain;
    if (domain && email.split('@')[1] !== domain.toLowerCase()) {
      throw AppError_('VALIDATION', 'Team members must use an @' + domain + ' Google account, because the internal portal only lets in your Workspace domain.');
    }
    return withLock_(function () {
      var existing = userByEmail_(email);
      if (existing) {
        if (existing.email === u.email && role !== ROLES.LEADER) throw AppError_('VALIDATION', 'You can’t remove your own leader role.');
        dbUpdate_('Users', existing.userId, { name: name, role: role, designation: designation, updatedAt: nowIso_() });
      } else {
        dbInsert_('Users', { userId: 'USR-' + uuid_().slice(0, 8), email: email, name: name, role: role, active: true,
          createdAt: nowIso_(), updatedAt: nowIso_(), designation: designation });
        var s = settings_();
        if (s.internalUrl) sendMail_(email, 'You’ve been added to the graphics team portal',
          'Hi ' + name + ',\n\n' + u.name + ' added you to the ' + s.portalName + ' as ' + (role === ROLES.LEADER ? 'a team leader' : 'a designer') +
          '.\nSign in with your company Google account.', { label: 'Open the portal', url: s.internalUrl });
      }
      syncDriveAccess_(email, role, true);
      return true;
    });
  });
}

function api_setUserActive(email, active) {
  return respond_(function () {
    var u = requireLeader_();
    email = email_(email, 'Email', true);
    if (email === u.email) throw AppError_('VALIDATION', 'You can’t deactivate yourself.');
    return withLock_(function () {
      var x = userByEmail_(email);
      if (!x) throw AppError_('NOT_FOUND', 'User not found.');
      if (!active && x.role === ROLES.LEADER && leaderEmails_().length <= 1) throw AppError_('VALIDATION', 'There must be at least one active team leader.');
      dbUpdate_('Users', x.userId, { active: !!active, updatedAt: nowIso_() });
      syncDriveAccess_(email, x.role, !!active);
      return { openTasks: dbFind_('Tasks', function (t) { return t.assigneeEmail === email && CLOSED.indexOf(t.status) === -1; }).length };
    });
  });
}

/** Leaders get editor access to the Drive root so they can manage folders. Designers get none. */
function syncDriveAccess_(email, role, active) {
  try {
    var root = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID'));
    var isEditor = root.getEditors().some(function (e) { return e.getEmail().toLowerCase() === email; });
    if (active && role === ROLES.LEADER && !isEditor) root.addEditor(email);
    if ((!active || role !== ROLES.LEADER) && isEditor && email !== Session.getEffectiveUser().getEmail().toLowerCase()) root.removeEditor(email);
  } catch (e) { console.warn('Drive access sync failed for ' + email + ': ' + e); }
}

function api_saveDepartment(input) {
  return respond_(function () {
    requireLeader_();
    input = input || {};
    var name = str_(input.name, 100, 'Department', true);
    return withLock_(function () {
      if (input.departmentId) {
        if (!dbGet_('Departments', input.departmentId)) throw AppError_('NOT_FOUND', 'Department not found.');
        dbUpdate_('Departments', input.departmentId, { name: name, active: input.active !== false });
      } else {
        if (dbFind_('Departments', function (d) { return d.name.toLowerCase() === name.toLowerCase(); }).length) throw AppError_('VALIDATION', 'That department already exists.');
        dbInsert_('Departments', { departmentId: 'DEP-' + uuid_().slice(0, 8), name: name, active: true, createdAt: nowIso_() });
      }
      return true;
    });
  });
}

/* ---------- settings ---------- */

function api_getSettings() {
  return respond_(function () {
    requireLeader_();
    var s = settings_();
    var quota = null;
    try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { quota = null; }
    var out = {};
    Object.keys(EDITABLE_SETTINGS).forEach(function (k) { out[k] = s[k]; });
    var props = PropertiesService.getScriptProperties();
    return {
      settings: out,
      drive: driveHealth_(),
      databaseUrl: SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID')).getUrl(),
      mailQuotaRemaining: quota,
      lastBackupAt: getSettingRaw_('lastBackupAt') || '',
      statuses: STATUS_ORDER,
      transitions: MANUAL_TRANSITIONS
    };
  });
}

function api_saveSettings(patch) {
  return respond_(function () {
    var u = requireLeader_();
    patch = patch || {};
    var clean = {};
    Object.keys(patch).forEach(function (k) {
      var type = EDITABLE_SETTINGS[k];
      if (!type) return;
      var v = patch[k];
      if (Array.isArray(type)) clean[k] = oneOf_(String(v), type, k);
      else if (type === 'boolean') clean[k] = !!v;
      else if (type === 'number') clean[k] = int_(v, 0, 100000, k);
      else if (type === 'url') { v = str_(v, 500, k, false); if (v && !/^https:\/\/[^\s<>"']+$/.test(v)) throw AppError_('VALIDATION', k + ' must be an https:// link.'); clean[k] = v; }
      else if (type === 'list') {
        var list = (Array.isArray(v) ? v : String(v).split(',')).map(function (x) { return String(x).trim(); }).filter(String);
        if (!list.length) throw AppError_('VALIDATION', k + ' can’t be empty.');
        clean[k] = list.map(function (x) { return str_(x, 50, k, true); });
        if (k === 'allowedExtensions' || k === 'publicExtensions') clean[k] = clean[k].map(function (x) { return x.toLowerCase().replace(/^\./, ''); });
      } else if (type === 'theme') {
        clean[k] = oneOf_(String(v || 'rosier'), Object.keys(THEMES), 'Theme');
      } else if (type === 'color') {
        v = String(v || '').trim();
        if (v && !/^#[0-9a-f]{6}$/i.test(v)) throw AppError_('VALIDATION', 'Colour must look like #a56312.');
        clean[k] = v.toLowerCase();
      } else if (type === 'designations') {
        var ds = typeof v === 'string' ? parseJson_(v, null) : v;
        if (!Array.isArray(ds) || !ds.length || ds.length > 20) throw AppError_('VALIDATION', 'Add between 1 and 20 designations.');
        clean[k] = ds.map(function (d) { return { name: str_(d && d.name, 60, 'Designation', true), points: int_(d && d.points, 0, 1000, 'Points') }; });
      } else if (type === 'json') {
        var parsed = typeof v === 'string' ? parseJson_(v, null) : v;
        clean[k] = validateCreativeTypes_(parsed);
      } else clean[k] = str_(v, 200, k, false);
    });
    if (clean.tokenExpiryDays !== undefined && (clean.tokenExpiryDays < 1 || clean.tokenExpiryDays > 90)) throw AppError_('VALIDATION', 'Link expiry must be 1–90 days.');
    if (clean.maxUploadMB !== undefined && clean.maxUploadMB > 2000) throw AppError_('VALIDATION', 'Max upload must be 2000 MB or less.');
    return withLock_(function () {
      Object.keys(clean).forEach(function (k) {
        setSettingRaw_(k, typeof clean[k] === 'object' ? JSON.stringify(clean[k]) : String(clean[k]));
      });
      return { saved: Object.keys(clean) };
    });
  });
}

function validateCreativeTypes_(list) {
  if (!Array.isArray(list) || !list.length) throw AppError_('VALIDATION', 'Creative types must be a non-empty list.');
  var ids = {};
  return list.map(function (t) {
    var id = str_(t.id, 40, 'Type id', true);
    if (!/^[a-z0-9_]+$/.test(id) || ids[id]) throw AppError_('VALIDATION', 'Type ids must be unique, lowercase, letters/numbers/underscores.');
    ids[id] = true;
    return {
      id: id, label: str_(t.label, 80, 'Type label', true),
      fields: (t.fields || []).map(function (f) {
        var type = oneOf_(String(f.type || 'text'), ['text', 'textarea', 'number', 'select'], 'Field type');
        var o = { key: str_(f.key, 40, 'Field key', true), label: str_(f.label, 80, 'Field label', true), type: type, required: !!f.required };
        if (!/^[a-zA-Z0-9_]+$/.test(o.key)) throw AppError_('VALIDATION', 'Field keys must be letters/numbers/underscores.');
        if (type === 'select') {
          o.options = (f.options || []).map(function (x) { return str_(x, 80, 'Option', true); });
          if (!o.options.length) throw AppError_('VALIDATION', 'Select field "' + o.label + '" needs options.');
        }
        return o;
      })
    };
  });
}

/* ---------- maintenance (time-driven trigger) ---------- */

/**
 * Runs hourly: deadline reminders, overdue alerts, and any requirement
 * whose leader notification was missed (e.g. the requester closed the tab
 * before attachments finished).
 */
function hourlyMaintenance(e) {
  // Only runs from its own installed trigger (or the owner in the editor).
  var fromTrigger = e && e.triggerUid && ScriptApp.getProjectTriggers().some(function (t) { return t.getUniqueId() === e.triggerUid; });
  if (!fromTrigger) guardOwner_();
  withLock_(function () {
    var s = settings_();
    var now = Date.now();
    var leaders = leaderEmails_();

    dbFind_('Requirements', function (r) { return !r.notifiedAt && now - new Date(r.submittedAt).getTime() > 20 * 60000; })
      .forEach(function (r) { notifyNewRequirement_(r.requirementId); });

    dbAll_('Tasks').forEach(function (t) {
      if (!t.assigneeEmail || !t.dueDate) return;
      if ([STATUS.COMPLETED, STATUS.CANCELLED, STATUS.APPROVED, STATUS.ON_HOLD].indexOf(t.status) !== -1) return;
      var end = dueEnd_(t.dueDate, t.dueTime);
      if (!end) return;
      var left = end.getTime() - now;
      if (left < 0 && !t.overdueNotifiedAt) {
        dbUpdate_('Tasks', t.taskId, { overdueNotifiedAt: nowIso_() });
        logActivity_(t.taskId, 'system', 'overdue', '', '', 'Past due ' + dueText_(t.dueDate, t.dueTime), 'team');
        notify_([t.assigneeEmail].concat(leaders), 'task_overdue', 'Overdue: ' + t.title, t.taskId + ' was due ' + dueText_(t.dueDate, t.dueTime) + '.', 'task/' + t.taskId);
      } else if (left >= 0 && left <= s.dueSoonHours * 3600000 && !t.dueSoonNotifiedAt) {
        dbUpdate_('Tasks', t.taskId, { dueSoonNotifiedAt: nowIso_() });
        notify_([t.assigneeEmail], 'task_due_soon', 'Due soon: ' + t.title, t.taskId + ' is due ' + dueText_(t.dueDate, t.dueTime) + '.', 'task/' + t.taskId);
      }
    });
  });
}

/* ---------- nightly backup ---------- */

var BACKUP_KEEP = 30;

function fromOwnTrigger_(e) {
  return !!(e && e.triggerUid && ScriptApp.getProjectTriggers().some(function (t) { return t.getUniqueId() === e.triggerUid; }));
}

/**
 * Runs nightly (~2 AM): copies the database spreadsheet into
 * 00_System/Backups in Drive and keeps the latest 30 copies.
 * Creative files are never deleted by the portal, so they need no copy.
 * Can also be run by hand from the editor.
 */
function dailyBackup(e) {
  if (!fromOwnTrigger_(e)) guardOwner_();
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  var folder = ensureFolder_('system', ['Backups']);
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd_HHmm');
  var copy = DriveApp.getFileById(id).makeCopy('DB backup ' + stamp, folder);
  var all = [];
  var it = folder.getFiles();
  while (it.hasNext()) { var f = it.next(); if (/^DB backup /.test(f.getName())) all.push(f); }
  all.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });   // newest first (names sort by date)
  all.slice(BACKUP_KEEP).forEach(function (f) { f.setTrashed(true); });       // to Trash, recoverable for 30 days
  withLock_(function () { setSettingRaw_('lastBackupAt', nowIso_()); setSettingRaw_('lastBackupFileId', copy.getId()); });
  return copy.getId();
}

/* ======================= Reports.gs ======================= */
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
    .map(function (t) { return workDays_(t); });

  // Revision cycles: "changes" decisions per completed task
  var changesByTask = {};
  decisions.forEach(function (d) { if (d.decision === 'changes') changesByTask[d.taskId] = (changesByTask[d.taskId] || 0) + 1; });

  // Decisions are credited to whoever uploaded that version (survives reassignment).
  var uploaderByVersion = {};
  dbAll_('CreativeVersions').forEach(function (v) { uploaderByVersion[v.versionId] = String(v.uploadedBy).toLowerCase(); });

  var versionsIn = dbAll_('CreativeVersions').filter(function (v) { return inRange_(v.uploadedAt, r); });
  var ptsTable = pointsTable_(function (d) { return inRange_(d, r); });
  var users = dbAll_('Users');
  var designers = users.map(function (u) {
    var mine = tasks.filter(function (t) { return t.assigneeEmail === u.email; });
    var doneIn = mine.filter(function (t) { return t.status === STATUS.COMPLETED && inRange_(t.completedAt, r); });
    var dec = decisionsIn.filter(function (d) { return uploaderByVersion[d.versionId] === u.email.toLowerCase(); });
    var approved = dec.filter(function (d) { return d.decision === 'approved'; }).length;
    // Creatives done = distinct creatives approved in the period, credited to who uploaded the approved version.
    var doneSet = {};
    dec.forEach(function (d) { if (d.decision === 'approved') doneSet[d.deliverableId] = true; });
    var uploaded = {};
    versionsIn.forEach(function (v) { if (String(v.uploadedBy).toLowerCase() === u.email.toLowerCase()) uploaded[v.deliverableId] = true; });
    var pts = ptsTable[u.email.toLowerCase()] || { period: 0, total: 0 };
    return {
      creativesRejected: dec.filter(function (d) { return d.decision === 'rejected'; }).length,
      points: pts.period, pointsTotal: pts.total, designation: u.designation || '',
      creativesDone: Object.keys(doneSet).length,
      creativesUploaded: Object.keys(uploaded).length,
      name: u.name, email: u.email, role: u.role, active: bool_(u.active),
      assigned: assigns.filter(function (a) { return a.assigneeEmail === u.email && inRange_(a.assignedAt, r); }).length,
      completed: doneIn.length,
      avgCompletionDays: round1_(avg_(doneIn.filter(function (t) { return t.assignedAt; }).map(function (t) { return workDays_(t); }))),
      activeNow: mine.filter(function (t) { return CLOSED.indexOf(t.status) === -1 && t.status !== STATUS.APPROVED; }).length,
      overdueNow: mine.filter(isOverdue_).length,
      revisionCycles: dec.filter(function (d) { return d.decision === 'changes'; }).length,
      approvalRate: dec.length ? Math.round(approved / dec.length * 100) : null
    };
  }).filter(function (d) { return d.role === ROLES.DESIGNER || d.assigned || d.completed || d.activeNow || d.creativesDone; })
    .sort(function (a, b) { return b.creativesDone - a.creativesDone || (a.name < b.name ? -1 : 1); });
  var creativesDoneTotal = {};
  decisionsIn.forEach(function (d) { if (d.decision === 'approved') creativesDoneTotal[d.deliverableId] = true; });

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
      decisions: decisionsIn.length,
      onHoldOthers: tasks.filter(function (t) { return t.status === STATUS.ON_HOLD && t.holdParty && t.holdParty !== 'internal'; }).length,
      onHoldInternal: tasks.filter(function (t) { return t.status === STATUS.ON_HOLD && (!t.holdParty || t.holdParty === 'internal'); }).length,
      creativesDone: Object.keys(creativesDoneTotal).length,
      creativesRejected: decisionsIn.filter(function (d) { return d.decision === 'rejected'; }).length
    },
    designers: designers,
    points: pointsReport_(r, ptsTable),
    byDepartment: groupCount(tasksCreatedIn, function (t) { return (reqMap[t.requirementId] || {}).department; }),
    byCreativeType: groupCount(tasksCreatedIn, function (t) { return t.creativeType; }),
    weekly: Object.keys(weekly).map(function (k) { return weekly[k]; }).sort(sortP),
    monthly: Object.keys(monthly).map(function (k) { return monthly[k]; }).sort(sortP)
  };
}

function api_getReports(range) {
  return respond_(function () { requireLeader_(); return computeReport_(range); });
}

/** Points & rewards for the period: per-person breakdown, rewards given, badges used. */
function pointsReport_(r, table) {
  var people = dbFind_('Users', function (x) { return x.role === ROLES.DESIGNER || (table[x.email.toLowerCase()] && table[x.email.toLowerCase()].period); })
    .map(function (x) {
      var t = table[x.email.toLowerCase()] || { period: 0, total: 0, inPeriod: null };
      var p = t.inPeriod || { creatives: { n: 0, pts: 0 }, firstTime: { n: 0, pts: 0 }, onTime: { n: 0, pts: 0 }, rejected: { n: 0, pts: 0 }, rewards: { n: 0, pts: 0 }, bonus: { n: 0, pts: 0 } };
      return { name: x.name, email: x.email, designation: x.designation || '', active: bool_(x.active), period: t.period, total: t.total,
        creatives: p.creatives, firstTime: p.firstTime, onTime: p.onTime, rejected: p.rejected, rewards: p.rewards, bonus: p.bonus || { n: 0, pts: 0 } };
    }).sort(function (a, b) { return b.period - a.period || b.total - a.total; });
  people.forEach(function (x, i) { x.rank = i + 1; });
  var given = dbAll_('Rewards').filter(function (x) { return inRange_(x.givenAt, r); })
    .sort(function (a, b) { return a.givenAt < b.givenAt ? 1 : -1; }).map(rewardDto_);
  var badges = {};
  given.forEach(function (g) { var b = badges[g.badgeLabel] || (badges[g.badgeLabel] = { label: g.badgeLabel, count: 0, points: 0 }); b.count++; b.points += g.points; });
  return {
    people: people, given: given,
    badges: Object.keys(badges).map(function (k) { return badges[k]; }).sort(function (a, b) { return b.count - a.count; }),
    rewardPoints: given.reduce(function (s, g) { return s + g.points; }, 0)
  };
}

/** Days from assignment to completion, minus time spent on hold. */
function workDays_(t) {
  return Math.max(0, hoursBetween_(t.assignedAt, t.completedAt) / 24 - (Number(t.heldMs) || 0) / 864e5);
}

/** CSV text for download. kind: tasks | designers | decisions */
function api_exportCsv(kind, range) {
  return respond_(function () {
    requireLeader_();
    var r = reportRange_(range);
    var rows;
    if (kind === 'designers') {
      var rep = computeReport_(r);
      rows = [['Designer', 'Email', 'Designation', 'Points (period)', 'Creatives rejected', 'Creatives done (approved)', 'Creatives uploaded', 'Tasks assigned', 'Tasks completed', 'Avg completion (days)', 'Active now', 'Overdue now', 'Revision cycles', 'Approval rate %']]
        .concat(rep.designers.map(function (d) { return [d.name, d.email, d.designation, d.points, d.creativesRejected, d.creativesDone, d.creativesUploaded, d.assigned, d.completed, d.avgCompletionDays, d.activeNow, d.overdueNow, d.revisionCycles, d.approvalRate]; }));
    } else if (kind === 'points') {
      var pr = computeReport_(r).points;
      rows = [['Rank', 'Designer', 'Email', 'Designation', 'Points in period', 'Points all time', 'Creatives approved', 'Creative points',
        'Approved first time', 'First-time points', 'Tasks on time', 'On-time points', 'Rejected', 'Rejection points', 'Rewards', 'Reward points', 'Task bonuses', 'Bonus points']]
        .concat(pr.people.map(function (x) { return [x.rank, x.name, x.email, x.designation, x.period, x.total, x.creatives.n, x.creatives.pts,
          x.firstTime.n, x.firstTime.pts, x.onTime.n, x.onTime.pts, x.rejected.n, x.rejected.pts, x.rewards.n, x.rewards.pts, x.bonus.n, x.bonus.pts]; }));
    } else if (kind === 'rewards') {
      rows = [['Given at', 'Designer', 'Email', 'Reward', 'Points', 'Message', 'Task', 'Given by']]
        .concat(computeReport_(r).points.given.map(function (g) { return [g.givenAt, g.userName, g.userEmail, g.badgeLabel, g.points, g.reason, g.taskId, g.givenBy]; }));
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

/* ======================= Tracker.gs ======================= */
/**
 * Tracker.gs — "My requests" for requesters, without a login.
 *
 * Each requester gets a private tracking link (random 256-bit token; only
 * its hash is stored, tied to their email). The link lists their requests
 * and status. A lost link can be re-sent to the email address — the page
 * never reveals whether an email has requests, so emails can't be probed.
 * Designer names and internal notes are never included.
 */

var TRACK_DAYS = 180;

function trackUrl_(token) {
  var base = settings_().publicUrl;
  if (!base) { try { base = ScriptApp.getService().getUrl(); } catch (e) { base = ''; } }
  return base + '?p=my&t=' + token;
}

/** Creates a tracking token for an email (or "req:<id>" when no email was given). Caller holds the lock. */
function issueTrackToken_(key) {
  var token = randomToken_();
  dbInsert_('RequesterLinks', {
    linkId: 'TRK-' + uuid_(), email: String(key).toLowerCase(), tokenHash: sha256_(token),
    createdAt: nowIso_(), expiresAt: new Date(Date.now() + TRACK_DAYS * 864e5).toISOString(), lastUsedAt: ''
  });
  return token;
}

/** Tracking keys for one token or a list of tokens (from this device). Invalid ones are skipped if others work. */
function trackKeys_(tokens) {
  var list = (Array.isArray(tokens) ? tokens : [tokens]).slice(0, 30), keys = [], lastErr = null;
  list.forEach(function (t) { try { var k = trackEmail_(t); if (keys.indexOf(k) === -1) keys.push(k); } catch (e) { lastErr = e; } });
  if (!keys.length) throw lastErr || AppError_('LINK_INVALID', 'This link isn’t valid.');
  return keys;
}

function ownsRequirement_(keys, r) {
  return keys.indexOf(String(r.email || '').toLowerCase()) !== -1 || keys.indexOf(('req:' + r.requirementId).toLowerCase()) !== -1;
}

function trackEmail_(token) {
  if (!TOKEN_RE.test(String(token || ''))) throw AppError_('LINK_INVALID', 'This link isn’t valid. Enter your email below and we’ll send you a new one.');
  var hash = sha256_(token);
  var row = dbFind_('RequesterLinks', function (r) { return r.tokenHash === hash; })[0];
  if (!row) throw AppError_('LINK_INVALID', 'This link isn’t valid. Enter your email below and we’ll send you a new one.');
  if (new Date(row.expiresAt).getTime() < Date.now()) throw AppError_('LINK_EXPIRED', 'This link has expired. Enter your email below and we’ll send you a new one.');
  return row.email;
}

/** Plain-language status for one requirement, from its tasks. */
function requesterStatus_(tasks) {
  var live = tasks.filter(function (t) { return t.status !== STATUS.CANCELLED; });
  if (!live.length) return tasks.length ? 'Cancelled' : 'Received';
  var has = function (list) { return live.some(function (t) { return list.indexOf(t.status) !== -1; }); };
  if (live.every(function (t) { return t.status === STATUS.COMPLETED || t.status === STATUS.APPROVED; })) return 'Completed';
  if (live.some(function (t) { return t.status === STATUS.ON_HOLD && t.holdParty && t.holdParty !== 'internal'; })) return 'Waiting for your input';
  if (has([STATUS.SUBMITTED, STATUS.RESUBMITTED])) return 'Ready for your review';
  if (has([STATUS.CHANGES])) return 'Being revised';
  if (has([STATUS.ASSIGNED, STATUS.IN_PROGRESS, STATUS.APPROVED, STATUS.COMPLETED])) return 'In progress';
  if (has([STATUS.ON_HOLD])) return 'On hold';
  return 'Received';
}

function api_getMyRequests(token) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('track:' + keys.join(',').slice(0, 120), 60, 600);
    var reqs = dbFind_('Requirements', function (r) { return ownsRequirement_(keys, r); })
      .sort(function (a, b) { return a.submittedAt < b.submittedAt ? 1 : -1; }).slice(0, 100);
    var out = reqs.map(function (r) {
      var tasks = dbFind_('Tasks', function (t) { return t.requirementId === r.requirementId; });
      var ids = {}; tasks.forEach(function (t) { ids[t.taskId] = true; });
      var dels = dbFind_('CreativeSubmissions', function (d) { return ids[d.taskId]; });
      var required = tasks.filter(function (t) { return t.status !== STATUS.CANCELLED; })
        .reduce(function (s, t) { return s + (Number(t.deliverablesRequired) || 0); }, 0);
      var awaiting = [];
      dels.forEach(function (d) {
        if (d.status !== DSTATUS.AWAITING) return;
        var v = dbGet_('CreativeVersions', d.latestVersionId);
        if (v && v.status === VSTATUS.AWAITING) awaiting.push({ versionId: v.versionId, title: d.title, version: 'V' + v.versionNo });
      });
      var creatives = [];
      dels.forEach(function (d) {
        var v = requesterVersion_(d);
        if (v) creatives.push({ versionId: v.versionId, title: d.title, version: 'V' + v.versionNo, state: creativeState_(d, v), isFinal: d.approvedVersionId === v.versionId,
          ext: extOf_(v.fileName), isImage: INLINE_IMAGE_TYPES.indexOf(v.mimeType) !== -1, canDownload: v.status === VSTATUS.APPROVED });
      });
      var links = [];
      tasks.forEach(function (t) { if (t.finalLink && t.status !== STATUS.CANCELLED) links.push(t.finalLink); });
      return {
        requirementId: r.requirementId, title: r.title, brief: String(r.brief || '').slice(0, 280),
        department: r.department, quantity: r.quantity, submittedAt: r.submittedAt,
        deadlineDate: r.preferredDate, deadlineTime: r.preferredTime || '',
        status: requesterStatus_(tasks),
        approved: dels.filter(function (d) { return d.status === DSTATUS.APPROVED; }).length,
        required: required || Number(r.quantity) || 0,
        awaiting: awaiting,
        creatives: creatives,
        finalFolderUrl: finalFolderUrl_(r),
        campaign: r.campaignId ? (function () {
          var c = dbGet_('Campaigns', r.campaignId); if (!c) return null;
          return { campaignId: c.campaignId, name: c.name, approved: approvedOf_(campaignTasks_(c.campaignId)).length };
        })() : null,
        hold: (function () {
          var h = tasks.filter(function (t) { return t.status === STATUS.ON_HOLD && t.holdParty && t.holdParty !== 'internal'; })[0];
          return h ? { reason: h.holdReason, dept: h.holdDept, since: h.holdSince } : null;
        })(),
        reopened: tasks.some(function (t) { return t.reopenedAt && CLOSED.indexOf(t.status) === -1; }),
        finalLinks: links.filter(function (l, i) { return links.indexOf(l) === i; })
      };
    });
    var email = keys.filter(function (k) { return k.indexOf('req:') !== 0; })[0] || '';
    return { email: email, requests: out };
  });
}

/**
 * The version a requester may see for a creative: the approved one, else the
 * one waiting for their review, else the last one they asked changes on.
 * Unsubmitted drafts are never shown.
 */
function requesterVersion_(d) {
  if (d.approvedVersionId) { var a = dbGet_('CreativeVersions', d.approvedVersionId); if (a && a.status === VSTATUS.APPROVED) return a; }
  var vs = dbFind_('CreativeVersions', function (v) {
    return v.deliverableId === d.deliverableId && [VSTATUS.AWAITING, VSTATUS.CHANGES, VSTATUS.APPROVED, VSTATUS.REJECTED].indexOf(v.status) !== -1;
  }).sort(function (x, y) { return Number(y.versionNo) - Number(x.versionNo); });
  return vs[0] || null;
}

function creativeState_(d, v) {
  if (v.status === VSTATUS.APPROVED) return 'Approved';
  if (v.status === VSTATUS.AWAITING) return 'Waiting for your review';
  if (v.status === VSTATUS.REJECTED) return 'Rejected';
  return 'Being revised';
}

/** A version the requester may see, from one of their own requests. */
function trackVersion_(keys, versionId) {
  var v = dbGet_('CreativeVersions', str_(versionId, 60, 'Creative', true));
  var d = v && dbGet_('CreativeSubmissions', v.deliverableId);
  var t = v && dbGet_('Tasks', v.taskId);
  var r = t && dbGet_('Requirements', t.requirementId);
  if (!r || !d || !ownsRequirement_(keys, r) || t.status === STATUS.CANCELLED) throw AppError_('NOT_FOUND', 'Creative not found.');
  var shown = requesterVersion_(d);
  if (!shown || shown.versionId !== v.versionId) throw AppError_('NOT_FOUND', 'Creative not found.');
  return { v: v, d: d };
}

/** Small previews for the requester's creatives. Returns { versionId: dataUrl|null }. */
function api_trackThumbs(token, versionIds) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackthumb:' + keys.join(',').slice(0, 120), 120, 600);
    var out = {};
    (Array.isArray(versionIds) ? versionIds : []).slice(0, 24).forEach(function (id) {
      try { var x = trackVersion_(keys, id); out[id] = smallThumb_({ fileId: x.v.fileId, mime: x.v.mimeType, size: x.v.sizeBytes }); }
      catch (e) { out[id] = null; }
    });
    return out;
  });
}

/** Large preview ('preview') or the full file ('original', approved creatives only). */
function api_trackFile(token, versionId, mode) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackfile:' + keys.join(',').slice(0, 120), 60, 600);
    var x = trackVersion_(keys, versionId);
    if (mode === 'original') {
      if (x.v.status !== VSTATUS.APPROVED) throw AppError_('FORBIDDEN', 'You can download a creative once it’s approved.');
      var name = (x.d.title || 'creative').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_V' + x.v.versionNo + '.' + (extOf_(x.v.fileName) || 'bin');
      return originalOf_(x.v.fileId, name);
    }
    return previewOf_(x.v.fileId, x.v.mimeType, x.v.sizeBytes, 1600);
  });
}

/** Fresh review link for a creative in one of the requester's own requests. */
function api_trackReview(token, versionId) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackrev:' + keys.join(',').slice(0, 120), 30, 600);
    return withLock_(function () {
      var v = dbGet_('CreativeVersions', str_(versionId, 60, 'Creative', true));
      var t = v && dbGet_('Tasks', v.taskId);
      var r = t && dbGet_('Requirements', t.requirementId);
      if (!r || !ownsRequirement_(keys, r)) throw AppError_('NOT_FOUND', 'Creative not found.');
      var rq = dbFind_('ApprovalRequests', function (x) { return x.versionId === v.versionId && x.status === 'Open'; })[0];
      if (!rq) throw AppError_('ALREADY_DECIDED', 'This creative is no longer waiting for review.');
      return { url: reviewUrl_(issueToken_(rq.requestId, 'requester')) };
    });
  });
}

/** Open review request for one of the requester's own creatives; fills reviewer from the request. Caller holds the lock. */
function trackOpenRequest_(keys, id, reviewer, named) {
  var v = dbGet_('CreativeVersions', str_(id, 60, 'Creative', true));
  var t = v && dbGet_('Tasks', v.taskId);
  var r = t && dbGet_('Requirements', t.requirementId);
  if (!r || !ownsRequirement_(keys, r)) throw AppError_('NOT_FOUND', 'Creative not found.');
  var rq = dbFind_('ApprovalRequests', function (x) { return x.versionId === v.versionId && x.status === 'Open'; })[0];
  if (!rq) throw AppError_('ALREADY_DECIDED', 'This creative is no longer waiting for review.');
  var em = String(r.email || '').toLowerCase();
  if (em && (em === String(v.uploadedBy).toLowerCase() || em === String(t.assigneeEmail).toLowerCase())) {
    var me = userByEmail_(em);
    if (!(me && bool_(me.active) && me.role === ROLES.LEADER)) throw AppError_('FORBIDDEN', 'The designer of a creative can’t approve their own work.');
  }
  if (named) { reviewer.name = r.requesterName || ''; reviewer.email = r.email || ''; }
  return rq;
}

/** Requester approves several of their own creatives at once from "My requests". */
function api_trackApproveMany(token, versionIds) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackapprove:' + keys.join(',').slice(0, 120), 20, 600);
    var ids = (Array.isArray(versionIds) ? versionIds : []).map(String).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    if (!ids.length) throw AppError_('VALIDATION', 'Nothing to approve.');
    if (ids.length > 60) throw AppError_('VALIDATION', 'Approve up to 60 at a time.');
    return withLock_(function () {
      var reviewer = { name: '', email: '' }, named = settings_().reviewerIdentity !== 'anonymous';
      return approveMany_(ids, '', reviewer, 'public', null, function (id) { return trackOpenRequest_(keys, id, reviewer, named); });
    });
  });
}

/** Requester approves or asks for changes on one creative, from the gallery in "My requests". */
function api_trackDecide(token, versionId, decision, comment) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackdecide:' + keys.join(',').slice(0, 120), 60, 600);
    decision = oneOf_(String(decision || ''), ['approved', 'changes', 'rejected'], 'Decision');
    comment = str_(comment, 4000, 'Feedback', decision !== 'approved');
    if (decision !== 'approved' && comment.length < 5) throw AppError_('VALIDATION', decision === 'rejected' ? 'Say why it’s rejected.' : 'Please tell the team what to change.');
    return withLock_(function () {
      var reviewer = { name: '', email: '' };
      var rq = trackOpenRequest_(keys, versionId, reviewer, settings_().reviewerIdentity !== 'anonymous');
      applyDecision_(rq, decision, comment, reviewer, 'public', null);
      return { decision: decision };
    });
  });
}

/** The requester's request + its tasks, if this device/link owns it. */
function trackRequirement_(keys, requirementId) {
  var r = dbGet_('Requirements', str_(requirementId, 40, 'Request', true));
  if (!r || !ownsRequirement_(keys, r)) throw AppError_('NOT_FOUND', 'Request not found.');
  return { r: r, tasks: dbFind_('Tasks', function (t) { return t.requirementId === r.requirementId && t.status !== STATUS.CANCELLED; }) };
}

/** Link where the requester can send the missing details / files (e.g. NI table, barcode) for a request on hold. */
function api_trackShareLink(token, requirementId) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackshare:' + keys.join(',').slice(0, 120), 20, 600);
    return withLock_(function () {
      var x = trackRequirement_(keys, requirementId);
      var t = x.tasks.filter(function (t) { return t.status === STATUS.ON_HOLD; })[0] || x.tasks[0];
      if (!t) throw AppError_('NOT_FOUND', 'Nothing to send details for yet.');
      return { url: shareUrl_(issueShare_(t.taskId, 'requester', 'Requester link')) };
    });
  });
}

/** Requester asks for changes on a completed request; the team leader decides whether to reopen it. */
function api_trackAskChanges(token, requirementId, message) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackask:' + keys.join(',').slice(0, 120), 5, 3600);
    message = str_(message, 3000, 'What needs to change', true);
    if (message.length < 5) throw AppError_('VALIDATION', 'Describe what needs to change.');
    return withLock_(function () {
      var x = trackRequirement_(keys, requirementId);
      x.tasks.forEach(function (t) { logActivity_(t.taskId, { email: x.r.email || 'requester', role: 'requester' }, 'change_request', '', '', message, 'team'); });
      var t0 = x.tasks[0];
      notify_(leaderEmails_(), 'change_request', 'Changes asked on a finished request: ' + x.r.title,
        x.r.requesterName + ' (' + x.r.department + ') asks:\n\n“' + message + '”\n\n' + x.r.requirementId + ' — reopen the task if the changes should be made.',
        t0 ? 'task/' + t0.taskId : 'requirements', true);
      return { message: 'Sent to the graphics team. They’ll reopen the task and let you know.' };
    });
  });
}

/* ---------- whole campaign, for everyone who asked for something in it ---------- */

/** The campaign, if one of this device's/link's requests is in it. */
function trackCampaign_(keys, campaignId) {
  var c = dbGet_('Campaigns', str_(campaignId, 40, 'Campaign', true));
  if (!c || !campaignRequests_(c.campaignId).some(function (r) { return ownsRequirement_(keys, r); })) throw AppError_('NOT_FOUND', 'Campaign not found.');
  return c;
}

function trackCampaignItems_(keys, c) {
  var mine = {};
  campaignRequests_(c.campaignId).forEach(function (r) { if (ownsRequirement_(keys, r)) mine[r.requirementId] = true; });
  return approvedOf_(campaignTasks_(c.campaignId)).map(function (a) {
    return { versionId: a.v.versionId, title: a.d.title, version: 'V' + a.v.versionNo, path: categoryOf_(a.task, a.d), ext: extOf_(a.v.fileName),
      isImage: INLINE_IMAGE_TYPES.indexOf(a.v.mimeType) !== -1, mine: !!mine[a.task.requirementId], _v: a.v, _d: a.d };
  }).sort(function (x, y) { return x.path === y.path ? (x.title < y.title ? -1 : 1) : (x.path < y.path ? -1 : 1); });
}

/** Every approved creative in the campaign (all departments' requests + the team's own tasks). */
function api_trackCampaign(token, campaignId) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackcamp:' + keys.join(',').slice(0, 120), 60, 600);
    var c = trackCampaign_(keys, campaignId);
    var folderUrl = '';
    if (bool_(c.shared) && c.folderId) { try { folderUrl = DriveApp.getFolderById(c.folderId).getUrl(); } catch (e) { folderUrl = ''; } }
    return { campaignId: c.campaignId, name: c.name, folderUrl: folderUrl, items: trackCampaignItems_(keys, c).map(function (x) { var o = {}; Object.keys(x).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = x[k]; }); return o; }) };
  });
}

function trackCampaignVersion_(keys, campaignId, versionId) {
  var c = trackCampaign_(keys, campaignId);
  var it = trackCampaignItems_(keys, c).filter(function (x) { return x.versionId === String(versionId); })[0];
  if (!it) throw AppError_('NOT_FOUND', 'Creative not found.');
  return it;
}

function api_trackCampaignThumbs(token, campaignId, versionIds) {
  return respond_(function () {
    var keys = trackKeys_(token), c = trackCampaign_(keys, campaignId), out = {};
    var items = trackCampaignItems_(keys, c), byId = {};
    items.forEach(function (x) { byId[x.versionId] = x; });
    (Array.isArray(versionIds) ? versionIds : []).slice(0, 24).forEach(function (id) {
      var x = byId[id]; out[id] = x ? smallThumb_({ fileId: x._v.fileId, mime: x._v.mimeType, size: x._v.sizeBytes }) : null;
    });
    return out;
  });
}

function api_trackCampaignFile(token, campaignId, versionId, mode) {
  return respond_(function () {
    var keys = trackKeys_(token);
    rateLimit_('trackcampfile:' + keys.join(',').slice(0, 120), 120, 600);
    var x = trackCampaignVersion_(keys, campaignId, versionId);
    if (mode === 'original') return originalOf_(x._v.approvedFileId || x._v.fileId, approvedName_(x._d, x._v));
    return previewOf_(x._v.fileId, x._v.mimeType, x._v.sizeBytes, 1600);
  });
}

/** Emails a fresh tracking link. Same answer whether or not the email has requests. */
function api_sendTrackLink(email) {
  return respond_(function () {
    email = email_(email, 'Email', true);
    rateLimit_('tracksend:' + email, 3, 3600);
    rateLimit_('tracksend:all', 60, 600);
    var has = dbFind_('Requirements', function (r) { return String(r.email).toLowerCase() === email; }).length > 0;
    if (has) {
      var token = withLock_(function () { return issueTrackToken_(email); });
      sendMail_(email, 'Your graphics requests', 'Here’s your private link to see all your requests and their status:\n\n' + trackUrl_(token) +
        '\n\nKeep it to yourself — anyone with this link can see your requests.', { label: 'See my requests', url: trackUrl_(token) });
    }
    return { message: 'If that email has requests with us, a link is on its way. Check your inbox (and spam).' };
  });
}

/* ---------- final files link (designer / leader) ---------- */

function api_setFinalLink(taskId, url) {
  return respond_(function () {
    var u = currentUser_();
    url = str_(url, 1000, 'Link', false);
    if (url && !/^https:\/\/[^\s<>"']+$/i.test(url)) throw AppError_('VALIDATION', 'Paste a full link starting with https://');
    return withLock_(function () {
      var t = requireTask_(u, taskId);
      if (!isLeader_(u) && t.assigneeEmail !== u.email) throw AppError_('NOT_FOUND', 'Task not found.');
      if (url === t.finalLink) return { finalLink: url };
      dbUpdate_('Tasks', t.taskId, { finalLink: url, updatedAt: nowIso_() });
      logActivity_(t.taskId, u, 'final_link', '', url ? 'added' : 'removed', url, 'team');
      if (url) {
        var req = dbGet_('Requirements', t.requirementId);
        notify_(leaderEmails_().filter(function (e) { return e !== u.email; }), 'final_link', 'Final files link added: ' + t.title, t.taskId + ' → ' + url, 'task/' + t.taskId, false);
        if (req && req.email && (t.status === STATUS.COMPLETED || t.status === STATUS.APPROVED)) {
          sendMail_(req.email, 'Final files for “' + req.title + '”', 'Hi ' + req.requesterName + ',\n\nThe final files are ready to download:\n' + url,
            { label: 'Open final files', url: url });
        }
      }
      return { finalLink: url };
    });
  });
}

/* ======================= Rewards.gs ======================= */
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
    return per[e] || (per[e] = { email: e, total: 0, period: 0, creatives: 0, creativePts: 0, firstTime: 0, onTime: 0, rejected: 0, rewards: 0, rewardCount: 0, bonus: 0, bonusCount: 0,
      // the same, counted only inside the period: { n: how many, pts: points }
      inPeriod: { creatives: { n: 0, pts: 0 }, firstTime: { n: 0, pts: 0 }, onTime: { n: 0, pts: 0 }, rejected: { n: 0, pts: 0 }, rewards: { n: 0, pts: 0 }, bonus: { n: 0, pts: 0 } } });
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
  // Task bonus set by the leader when assigning: paid to the designer once the task is completed.
  dbAll_('Tasks').forEach(function (t) {
    var b = Number(t.bonusPoints) || 0;
    if (!b || t.status !== STATUS.COMPLETED || !t.assigneeEmail) return;
    add(t.assigneeEmail, b, t.completedAt, 'bonus'); P(t.assigneeEmail).bonusCount++; tally(t.assigneeEmail, 'bonus', b, t.completedAt);
  });
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
          rejected: me.rejected, rejectedPts: me.rejected * (Number(s.pointsRejected) || 0), rewards: me.rewards, bonus: me.bonus || 0, bonusCount: me.bonusCount || 0 } },
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

/* ======================= BatchReview.gs ======================= */
/**
 * BatchReview.gs — one no-login link to review many creatives at once
 * (e.g. for the founder on his phone). The leader picks creatives that are
 * waiting for approval; the link shows them as a gallery where each can be
 * approved or sent back with feedback, or all approved together.
 *
 * Security: 256-bit random token, only its SHA-256 hash stored; it expires,
 * can be revoked, and only covers the creatives chosen when it was made.
 * Designer names, internal notes and Drive links are never shown.
 */

function batchUrl_(token) {
  var base = settings_().publicUrl;
  if (!base) { try { base = ScriptApp.getService().getUrl(); } catch (e) { base = ''; } }
  return base + '?p=batch&t=' + token;
}

/** Leader: make a review link for several creatives that are waiting for approval. */
function api_createBatchLink(versionIds, title) {
  return respond_(function () {
    var u = requireLeader_();
    var ids = (Array.isArray(versionIds) ? versionIds : []).map(String).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    if (!ids.length) throw AppError_('VALIDATION', 'Choose at least one creative.');
    if (ids.length > 100) throw AppError_('VALIDATION', 'Share up to 100 creatives in one link.');
    title = str_(title, 120, 'Title', false);
    return withLock_(function () {
      var open = ids.filter(function (id) {
        return dbFind_('ApprovalRequests', function (x) { return x.versionId === id && x.status === 'Open'; }).length > 0;
      });
      if (!open.length) throw AppError_('VALIDATION', 'None of these creatives are waiting for approval.');
      var token = randomToken_();
      var days = Number(settings_().tokenExpiryDays) || 7;
      dbInsert_('ReviewBatches', {
        batchId: 'BAT-' + uuid_(), tokenHash: sha256_(token), title: title || (open.length + ' creatives for review'),
        versionIds: open.join(','), createdBy: u.email, createdAt: nowIso_(),
        expiresAt: new Date(Date.now() + days * 864e5).toISOString(), revokedAt: '', lastOpenedAt: ''
      });
      var tasks = {};
      open.forEach(function (id) { var v = dbGet_('CreativeVersions', id); if (v) tasks[v.taskId] = true; });
      Object.keys(tasks).forEach(function (tid) { logActivity_(tid, u, 'link_created', '', '', 'Shared in a review link: ' + (title || open.length + ' creatives'), 'leader'); });
      return { url: batchUrl_(token), count: open.length, skipped: ids.length - open.length, expiresInDays: days };
    });
  });
}

/** Leader: list / revoke shared links. */
function api_listBatchLinks() {
  return respond_(function () {
    requireLeader_();
    return dbAll_('ReviewBatches').slice(-50).reverse().map(function (b) {
      return { batchId: b.batchId, title: b.title, count: String(b.versionIds).split(',').filter(String).length, createdAt: b.createdAt,
        expiresAt: b.expiresAt, revoked: !!b.revokedAt, lastOpenedAt: b.lastOpenedAt };
    });
  });
}

function api_revokeBatchLink(batchId) {
  return respond_(function () {
    requireLeader_();
    return withLock_(function () {
      var b = dbGet_('ReviewBatches', str_(batchId, 60, 'Link', true));
      if (!b) throw AppError_('NOT_FOUND', 'Link not found.');
      dbUpdate_('ReviewBatches', b.batchId, { revokedAt: nowIso_() });
      return true;
    });
  });
}

/* ---------- public (no login) ---------- */

function batchFromToken_(token) {
  if (!TOKEN_RE.test(String(token || ''))) throw AppError_('LINK_INVALID', 'This link isn’t valid. Please check you copied the full link.');
  var hash = sha256_(token);
  var b = dbFind_('ReviewBatches', function (x) { return x.tokenHash === hash; })[0];
  if (!b) throw AppError_('LINK_INVALID', 'This link isn’t valid. Please check you copied the full link.');
  if (b.revokedAt) throw AppError_('LINK_CLOSED', 'This review link has been withdrawn. Ask the graphics team for a new one.');
  if (new Date(b.expiresAt).getTime() < Date.now()) throw AppError_('LINK_EXPIRED', 'This review link has expired. Ask the graphics team for a new one.');
  return b;
}

function batchIds_(b) { return String(b.versionIds || '').split(',').filter(String); }

/** One creative in the link. state: open | approved | changes | closed. */
function batchItem_(versionId) {
  var v = dbGet_('CreativeVersions', versionId);
  if (!v) return null;
  var d = dbGet_('CreativeSubmissions', v.deliverableId) || {};
  var t = dbGet_('Tasks', v.taskId);
  if (!t) return null;
  var openReq = dbFind_('ApprovalRequests', function (x) { return x.versionId === versionId && x.status === 'Open'; })[0];
  var dec = dbFind_('ApprovalDecisions', function (x) { return x.versionId === versionId; }).pop();
  var state = openReq && t.status !== STATUS.CANCELLED ? 'open'
    : v.status === VSTATUS.APPROVED ? 'approved' : v.status === VSTATUS.CHANGES ? 'changes' : v.status === VSTATUS.REJECTED ? 'rejected' : 'closed';
  return {
    versionId: v.versionId, title: d.title || 'Creative', version: 'V' + v.versionNo, task: t.title, purpose: d.purpose || '',
    ext: extOf_(v.fileName), isImage: INLINE_IMAGE_TYPES.indexOf(v.mimeType) !== -1, state: state,
    comment: dec && (state === 'changes' || state === 'rejected') ? dec.comment : '', _v: v, _t: t, _req: openReq
  };
}

function publicItem_(it) {
  var o = {}; Object.keys(it).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = it[k]; }); return o;
}

function api_getBatch(token) {
  return respond_(function () {
    rateLimit_('batch:' + String(token).slice(0, 60), 120, 600);
    var b = batchFromToken_(token);
    var s = settings_();
    var items = batchIds_(b).map(batchItem_).filter(Boolean).map(publicItem_);
    if (!b.lastOpenedAt || Date.now() - new Date(b.lastOpenedAt).getTime() > 3600e3) {
      withLock_(function () { dbUpdate_('ReviewBatches', b.batchId, { lastOpenedAt: nowIso_() }); });
    }
    return { title: b.title, companyName: s.companyName, expiresAt: b.expiresAt, reviewerIdentity: s.reviewerIdentity,
      allowDownload: !!s.allowReviewerDownload, items: items };
  });
}

function batchVersion_(b, versionId) {
  versionId = str_(versionId, 60, 'Creative', true);
  if (batchIds_(b).indexOf(versionId) === -1) throw AppError_('NOT_FOUND', 'Creative not found in this link.');
  var it = batchItem_(versionId);
  if (!it) throw AppError_('NOT_FOUND', 'This creative is no longer available.');
  return it;
}

function api_batchThumbs(token, versionIds) {
  return respond_(function () {
    rateLimit_('batchthumb:' + String(token).slice(0, 60), 200, 600);
    var b = batchFromToken_(token), out = {};
    (Array.isArray(versionIds) ? versionIds : []).slice(0, 24).forEach(function (id) {
      try { var it = batchVersion_(b, id); out[id] = smallThumb_({ fileId: it._v.fileId, mime: it._v.mimeType, size: it._v.sizeBytes }); }
      catch (e) { out[id] = null; }
    });
    return out;
  });
}

function api_batchFile(token, versionId, mode) {
  return respond_(function () {
    rateLimit_('batchfile:' + String(token).slice(0, 60), 200, 600);
    var b = batchFromToken_(token), it = batchVersion_(b, versionId);
    if (mode === 'original') {
      if (!settings_().allowReviewerDownload) throw AppError_('FORBIDDEN', 'Downloads are turned off for review links.');
      var name = (it.title || 'creative').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_' + it.version + '.' + (it.ext || 'bin');
      return originalOf_(it._v.fileId, name);
    }
    return previewOf_(it._v.fileId, it._v.mimeType, it._v.sizeBytes, 1600);
  });
}

/** Reviewer name/email per the "reviewer identity" setting. */
function batchReviewer_(input) {
  var mode = settings_().reviewerIdentity, r = { name: '', email: '' };
  input = input || {};
  if (mode !== 'anonymous') {
    r.name = str_(input.reviewerName, 100, 'Your name', mode === 'required');
    r.email = email_(input.reviewerEmail, 'Your email', false);   // name is enough for a shared link
  }
  return r;
}

/** Throws if the reviewer is the creative's own designer (team leaders excepted). */
function checkNotOwnWork_(reviewer, v, t) {
  if (!reviewer.email) return;
  var e = reviewer.email.toLowerCase();
  if (e !== String(v.uploadedBy).toLowerCase() && e !== String(t.assigneeEmail).toLowerCase()) return;
  var m = userByEmail_(e);
  if (m && bool_(m.active) && m.role === ROLES.LEADER) return;
  throw AppError_('FORBIDDEN', 'The designer of a creative can’t approve their own work.');
}

function api_batchDecide(token, versionId, decision, comment, who) {
  return respond_(function () {
    rateLimit_('batchdecide:' + String(token).slice(0, 60), 120, 600);
    decision = oneOf_(String(decision || ''), ['approved', 'changes', 'rejected'], 'Decision');
    comment = str_(comment, 4000, 'Feedback', decision !== 'approved');
    if (decision !== 'approved' && comment.length < 5) throw AppError_('VALIDATION', decision === 'rejected' ? 'Say why it’s rejected.' : 'Please tell the team what to change.');
    var reviewer = batchReviewer_(who);
    return withLock_(function () {
      var b = batchFromToken_(token), it = batchVersion_(b, versionId);
      if (it.state !== 'open') throw AppError_('ALREADY_DECIDED', 'A decision has already been recorded for this creative.');
      checkNotOwnWork_(reviewer, it._v, it._t);
      applyDecision_(it._req, decision, comment, reviewer, 'public', null);
      return { state: decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'changes' };
    });
  });
}

function api_batchApproveAll(token, versionIds, who) {
  return respond_(function () {
    rateLimit_('batchall:' + String(token).slice(0, 60), 20, 600);
    var reviewer = batchReviewer_(who);
    return withLock_(function () {
      var b = batchFromToken_(token);
      var ids = (Array.isArray(versionIds) ? versionIds : batchIds_(b)).map(String).slice(0, 100);
      return approveMany_(ids, '', reviewer, 'public', null, function (id) {
        var it = batchVersion_(b, id);
        if (it.state !== 'open') throw AppError_('ALREADY_DECIDED', 'Already decided.');
        checkNotOwnWork_(reviewer, it._v, it._t);
        return it._req;
      });
    });
  });
}

/* ======================= TaskShare.gs ======================= */
/**
 * TaskShare.gs — share one task with another department through a no-login
 * link. They see the brief, the hold reason (e.g. "Waiting for NI table and
 * barcode"), the designs so far (view + download), and can send back details
 * and files, which land on the task for the designer.
 *
 * Security: 256-bit token, only the hash stored; expires; can be withdrawn.
 * Designer names, internal notes and Drive links are never shown.
 */

var SHARE_DAYS = 30;

function shareUrl_(token) {
  var base = settings_().publicUrl;
  if (!base) { try { base = ScriptApp.getService().getUrl(); } catch (e) { base = ''; } }
  return base + '?p=share&t=' + token;
}

/** Creates a share token for a task. Caller holds the lock. */
function issueShare_(taskId, createdBy, note) {
  var token = randomToken_();
  dbInsert_('TaskShares', {
    shareId: 'SHR-' + uuid_(), tokenHash: sha256_(token), taskId: taskId, note: note || '', createdBy: createdBy || '',
    createdAt: nowIso_(), expiresAt: new Date(Date.now() + SHARE_DAYS * 864e5).toISOString(), revokedAt: '', lastOpenedAt: ''
  });
  return token;
}

function api_createTaskShare(taskId, note) {
  return respond_(function () {
    var u = currentUser_();
    note = str_(note, 200, 'Who it’s for', false);
    return withLock_(function () {
      var t = requireTask_(u, taskId);
      if (!taskPermissions_(u, t).canShare) throw AppError_('FORBIDDEN', 'You can’t share this task.');
      var token = issueShare_(t.taskId, u.email, note);
      logActivity_(t.taskId, u, 'shared', '', note || 'link', 'Shared with a link' + (note ? ' — ' + note : ''), 'team');
      return { url: shareUrl_(token), expiresInDays: SHARE_DAYS };
    });
  });
}

function api_listTaskShares(taskId) {
  return respond_(function () {
    var u = currentUser_();
    var t = requireTask_(u, taskId);
    return dbFind_('TaskShares', function (x) { return x.taskId === t.taskId && !x.revokedAt && new Date(x.expiresAt).getTime() > Date.now(); })
      .reverse().map(function (x) { return { shareId: x.shareId, note: x.note, createdAt: x.createdAt, expiresAt: x.expiresAt, lastOpenedAt: x.lastOpenedAt }; });
  });
}

function api_revokeTaskShare(shareId) {
  return respond_(function () {
    var u = currentUser_();
    return withLock_(function () {
      var x = dbGet_('TaskShares', str_(shareId, 60, 'Link', true));
      if (!x) throw AppError_('NOT_FOUND', 'Link not found.');
      requireTask_(u, x.taskId);
      dbUpdate_('TaskShares', x.shareId, { revokedAt: nowIso_() });
      return true;
    });
  });
}

/* ---------- public (no login) ---------- */

function shareFromToken_(token) {
  if (!TOKEN_RE.test(String(token || ''))) throw AppError_('LINK_INVALID', 'This link isn’t valid. Please check you copied the full link.');
  var hash = sha256_(token);
  var x = dbFind_('TaskShares', function (r) { return r.tokenHash === hash; })[0];
  if (!x) throw AppError_('LINK_INVALID', 'This link isn’t valid. Please check you copied the full link.');
  if (x.revokedAt) throw AppError_('LINK_CLOSED', 'This link has been withdrawn. Ask the graphics team for a new one.');
  if (new Date(x.expiresAt).getTime() < Date.now()) throw AppError_('LINK_EXPIRED', 'This link has expired. Ask the graphics team for a new one.');
  var t = dbGet_('Tasks', x.taskId);
  if (!t) throw AppError_('LINK_CLOSED', 'This task is no longer available.');
  return { share: x, task: t };
}

var SHARE_STATE = {};
SHARE_STATE[VSTATUS.DRAFT] = 'Work in progress';
SHARE_STATE[VSTATUS.AWAITING] = 'Waiting for approval';
SHARE_STATE[VSTATUS.CHANGES] = 'Changes requested';
SHARE_STATE[VSTATUS.APPROVED] = 'Approved';
SHARE_STATE[VSTATUS.SUPERSEDED] = 'Older version';

/** Latest version of each creative (+ the approved/final one if different). */
function shareVersions_(t) {
  var out = [];
  taskDeliverables_(t.taskId).forEach(function (d) {
    var vs = dbFind_('CreativeVersions', function (v) { return v.deliverableId === d.deliverableId; })
      .sort(function (a, b) { return Number(b.versionNo) - Number(a.versionNo); });
    if (!vs.length) return;
    var pick = [vs[0]];
    if (d.approvedVersionId && d.approvedVersionId !== vs[0].versionId) {
      var fin = vs.filter(function (v) { return v.versionId === d.approvedVersionId; })[0];
      if (fin) pick.push(fin);
    }
    pick.forEach(function (v) {
      var fin = d.approvedVersionId === v.versionId && v.status === VSTATUS.APPROVED;
      out.push({ kind: 'version', id: v.versionId, title: d.title, version: 'V' + v.versionNo, isFinal: fin,
        state: fin ? 'Final (approved)' : (SHARE_STATE[v.status] || v.status), ext: extOf_(v.fileName), size: v.sizeBytes, _f: v });
    });
  });
  return out;
}

function shareFiles_(t) {
  return dbFind_('ReferenceFiles', function (f) { return f.taskId === t.taskId || (!f.taskId && f.requirementId === t.requirementId); })
    .map(function (f) {
      return { kind: 'attachment', id: f.attachmentId, title: f.fileName, ext: extOf_(f.fileName), size: f.sizeBytes, uploadedAt: f.uploadedAt,
        from: /^shared link/.test(f.uploadedBy) ? f.uploadedBy.replace(/^shared link:?\s*/, '') || 'Shared link' : f.uploadedBy === 'requester' ? 'Requester' : 'Graphics team', _f: f };
    });
}

function strip_(o) { var r = {}; Object.keys(o).forEach(function (k) { if (k.charAt(0) !== '_') r[k] = o[k]; }); return r; }

function api_getShare(token) {
  return respond_(function () {
    rateLimit_('share:' + String(token).slice(0, 60), 120, 600);
    var x = shareFromToken_(token), t = x.task, s = settings_();
    var req = dbGet_('Requirements', t.requirementId) || {};
    if (!x.share.lastOpenedAt || Date.now() - new Date(x.share.lastOpenedAt).getTime() > 3600e3) {
      withLock_(function () { dbUpdate_('TaskShares', x.share.shareId, { lastOpenedAt: nowIso_() }); });
    }
    var updates = dbFind_('TaskActivity', function (a) { return a.taskId === t.taskId && ['hold', 'resume', 'shared_info', 'reopened'].indexOf(a.action) !== -1; })
      .slice(-30).reverse().map(function (a) {
        return { kind: a.action, at: a.createdAt, text: a.note, from: a.action === 'shared_info' ? a.toValue : 'Graphics team' };
      });
    return {
      companyName: s.companyName, taskId: t.taskId, requirementId: t.requirementId, title: t.title, brief: t.brief,
      department: req.department || '', requesterName: req.requesterName || '', quantity: Number(t.deliverablesRequired) || 0,
      status: t.status === STATUS.ON_HOLD ? 'On hold' : requesterStatus_([t]), dueText: t.status === STATUS.ON_HOLD ? '' : dueText_(t.dueDate, t.dueTime),
      hold: t.status === STATUS.ON_HOLD ? { reason: t.holdReason, dept: t.holdDept, waitingOn: HOLD_PARTIES[t.holdParty] || '', since: t.holdSince } : null,
      creatives: shareVersions_(t).map(strip_), files: shareFiles_(t).map(strip_), updates: updates,
      upload: { extensions: s.allowedExtensions, maxMB: s.maxPublicUploadMB, chunkBytes: LIMITS.CHUNK_BYTES }
    };
  });
}

function shareItem_(t, kind, id) {
  var list = kind === 'attachment' ? shareFiles_(t) : shareVersions_(t);
  var it = list.filter(function (x) { return x.id === String(id); })[0];
  if (!it) throw AppError_('NOT_FOUND', 'File not found.');
  return it;
}

function api_shareThumbs(token, items) {
  return respond_(function () {
    rateLimit_('sharethumb:' + String(token).slice(0, 60), 200, 600);
    var t = shareFromToken_(token).task, out = {};
    (Array.isArray(items) ? items : []).slice(0, 24).forEach(function (q) {
      var key = q.kind + ':' + q.id;
      try { var it = shareItem_(t, q.kind, q.id); out[key] = smallThumb_({ fileId: it._f.fileId, mime: it._f.mimeType, size: it._f.sizeBytes }); }
      catch (e) { out[key] = null; }
    });
    return out;
  });
}

function api_shareFile(token, kind, id, mode) {
  return respond_(function () {
    rateLimit_('sharefile:' + String(token).slice(0, 60), 200, 600);
    var t = shareFromToken_(token).task, it = shareItem_(t, kind === 'attachment' ? 'attachment' : 'version', id);
    if (mode === 'original') {
      var name = kind === 'attachment' ? it.title : (it.title || 'creative').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_' + it.version + '.' + (it.ext || 'bin');
      return originalOf_(it._f.fileId, name);
    }
    return previewOf_(it._f.fileId, it._f.mimeType, it._f.sizeBytes, 1600);
  });
}

/** Other department sends details (and says how many files they attached). */
function api_shareMessage(token, input) {
  return respond_(function () {
    rateLimit_('sharemsg:' + String(token).slice(0, 60), 20, 600);
    input = input || {};
    var name = str_(input.name, 100, 'Your name', true);
    var dept = str_(input.dept, 100, 'Department', false);
    var message = str_(input.message, 4000, 'Message', false);
    var files = Math.max(0, Math.min(50, Number(input.files) || 0));
    if (!message && !files) throw AppError_('VALIDATION', 'Write a message or attach a file.');
    return withLock_(function () {
      var t = shareFromToken_(token).task;
      var from = name + (dept ? ' (' + dept + ')' : '');
      var text = (message || '') + (files ? (message ? '\n' : '') + '📎 ' + files + ' file(s) attached' : '');
      logActivity_(t.taskId, { email: 'shared link', role: 'external' }, 'shared_info', '', from, text, 'team');
      var body = from + ' sent details for ' + t.taskId + ':\n\n' + text + (t.status === STATUS.ON_HOLD ? '\n\nThe task is on hold — resume it once you have everything.' : '');
      var mail = t.assigneeEmail ? [t.assigneeEmail] : [];
      notify_(mail, 'shared_info', 'Details received: ' + t.title, body, 'task/' + t.taskId, true);
      notify_(leaderEmails_().filter(function (e) { return mail.indexOf(e) === -1; }), 'shared_info', 'Details received: ' + t.title, body, 'task/' + t.taskId, mail.length === 0);
      return { message: 'Sent! The graphics team has been told.' };
    });
  });
}

/* ======================= FinalFiles.gs ======================= */
/**
 * FinalFiles.gs — every request gets one Drive folder holding all of its
 * approved creatives, even when the work was divided between designers:
 *
 *   03_Approved_Creatives / 2026 / REQ-2026-0012 — Diwali sale /
 *        Meta ads / …   Website banners / …   Listing images / …
 *
 * The leader can make the folder "anyone with the link can view" so people
 * outside the portal download straight from Drive, with no login. Replaced
 * approvals move to an "Older versions" sub-folder.
 */

function cleanFolderName_(s) { return String(s || '').replace(/[\\/:*?"<>|#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Creatives'; }

/** "20% off / Meta ads" → "20% off/Meta ads" (max 3 levels, each part cleaned). '' if empty. */
function cleanPath_(p) {
  return String(p || '').split(/[\/>]+/).map(function (x) { return String(x).replace(/[\\:*?"<>|#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); })
    .filter(String).slice(0, 3).join('/');
}

/**
 * Where a creative is filed inside the request/campaign folder:
 * the folder the leader chose for the task, else the creative's category, else the task's category.
 */
function categoryOf_(task, d) {
  return cleanPath_(task && task.folderPath) || cleanPath_(d && d.deliverableType) || cleanPath_(task && task.creativeType) || 'Creatives';
}

/** Nested folders for a path like "20% off/Meta ads". */
function subPath_(root, path) {
  var f = root;
  String(path || 'Creatives').split('/').forEach(function (part) { if (part) f = subFolder_(f, part); });
  return f;
}

/** Gets / creates a named sub-folder (cached by parent + name). */
function subFolder_(parent, name) {
  name = cleanFolderName_(name);
  var key = 'sf_' + sha256_(parent.getId() + '/' + name), cache = CacheService.getScriptCache(), id = cache.get(key);
  if (id) { try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* recreate */ } }
  var it = parent.getFoldersByName(name);
  var folder = it.hasNext() ? it.next() : parent.createFolder(name);
  cache.put(key, folder.getId(), 21600);
  return folder;
}

/** The request's final-files folder (created on first use). Caller holds the lock. */
function finalFolder_(req) {
  var camp = campaignOf_(req);
  if (camp) return campaignFolder_(camp);          // campaign requests share the campaign's folder
  if (req.finalFolderId) {
    try { var f = DriveApp.getFolderById(req.finalFolderId); if (!f.isTrashed()) return f; } catch (e) { /* recreate */ }
  }
  var year = String(req.submittedAt || nowIso_()).slice(0, 4);
  var parent = DriveApp.getFolderById(ensureFolderId_('approved', [year]));
  var folder = parent.createFolder(cleanFolderName_(req.requirementId + ' — ' + (req.title || 'Request')));
  dbUpdate_('Requirements', req.requirementId, { finalFolderId: folder.getId(), updatedAt: nowIso_() });
  return folder;
}

function approvedName_(d, v) { return cleanFolderName_((d.title || 'Creative') + ' V' + v.versionNo) + (extOf_(v.fileName) ? '.' + extOf_(v.fileName) : ''); }

/** Copies an approved version into REQ folder / category. Earlier approved copy of the same creative → "Older versions". */
function fileApprovedCopy_(task, d, v) {
  try {
    var req = dbGet_('Requirements', task.requirementId);
    var root = req ? finalFolder_(req) : DriveApp.getFolderById(ensureFolderId_('approved', [String(new Date().getFullYear()), task.taskId]));
    var cat = subPath_(root, categoryOf_(task, d));
    if (d.approvedVersionId && d.approvedVersionId !== v.versionId) {
      var old = dbGet_('CreativeVersions', d.approvedVersionId);
      if (old && old.approvedFileId) { try { DriveApp.getFileById(old.approvedFileId).moveTo(subFolder_(cat, 'Older versions')); } catch (e) { /* gone */ } }
    }
    return DriveApp.getFileById(v.fileId).makeCopy(approvedName_(d, v), cat).getId();
  } catch (e) {
    console.warn('Approved copy failed for ' + v.versionId + ': ' + e);
    return '';
  }
}

/**
 * What a Drive link / zip covers: a campaign (id CMP-…, or any request/task that belongs to one)
 * or a single request. Returns { kind, req, campaign, tasks, title, label }.
 */
function finalScope_(u, id) {
  id = str_(id, 40, 'Request', true);
  var camp = /^CMP-/.test(id) ? dbGet_('Campaigns', id) : null, req = null;
  if (!camp) {
    req = dbGet_('Requirements', id);
    if (!req) { var t = dbGet_('Tasks', id); req = t && dbGet_('Requirements', t.requirementId); }
    if (!req) throw AppError_('NOT_FOUND', 'Request not found.');
    camp = campaignOf_(req);
  }
  var tasks = camp ? campaignTasks_(camp.campaignId)
    : dbFind_('Tasks', function (t) { return t.requirementId === req.requirementId && t.status !== STATUS.CANCELLED; });
  if (!camp && !req) throw AppError_('NOT_FOUND', 'Not found.');
  if (!isLeader_(u) && !tasks.some(function (t) { return t.assigneeEmail === u.email; })) throw AppError_('NOT_FOUND', 'Request not found.');
  return camp ? { kind: 'campaign', campaign: camp, req: req, tasks: tasks, title: camp.name, label: camp.name, id: camp.campaignId }
    : { kind: 'request', campaign: null, req: req, tasks: tasks, title: req.title, label: req.requirementId, id: req.requirementId };
}

function scopeFolder_(x) {
  return x.kind === 'campaign' ? campaignFolder_(dbGet_('Campaigns', x.campaign.campaignId)) : finalFolder_(dbGet_('Requirements', x.req.requirementId));
}

/** Puts every approved creative of these tasks into root / category (copies or moves as needed). Returns counts. */
function fileInto_(root, tasks) {
  var counts = {};
  approvedOf_(tasks).forEach(function (a) {
    var path = categoryOf_(a.task, a.d), cat = subPath_(root, path);
    counts[path] = (counts[path] || 0) + 1;
    var ok = false;
    if (a.v.approvedFileId) {
      try {
        var f = DriveApp.getFileById(a.v.approvedFileId), p = f.getParents();
        if (!p.hasNext() || p.next().getId() !== cat.getId()) f.moveTo(cat);
        ok = true;
      } catch (e) { ok = false; }
    }
    if (!ok) {
      try {
        var copy = DriveApp.getFileById(a.v.fileId).makeCopy(approvedName_(a.d, a.v), cat);
        dbUpdate_('CreativeVersions', a.v.versionId, { approvedFileId: copy.getId() });
      } catch (e) { console.warn('Could not file ' + a.v.versionId + ': ' + e); }
    }
  });
  return counts;
}

/** Every approved creative in the request: [{task, d, v}]. */
function approvedOf_(tasks) {
  var out = [];
  tasks.forEach(function (t) {
    taskDeliverables_(t.taskId).forEach(function (d) {
      if (d.status !== DSTATUS.APPROVED && !d.approvedVersionId) return;
      var v = d.approvedVersionId && dbGet_('CreativeVersions', d.approvedVersionId);
      if (v && v.status === VSTATUS.APPROVED) out.push({ task: t, d: d, v: v });
    });
  });
  return out;
}

/**
 * Makes sure every approved creative is in the folder (request or whole campaign) and,
 * if share is true, opens it to "anyone with the link (view)".
 */
function api_finalFolder(id, share) {
  return respond_(function () {
    var u = currentUser_();
    if (share && !isLeader_(u)) throw AppError_('FORBIDDEN', 'Only the team leader can share the folder publicly.');
    return withLock_(function () {
      var x = finalScope_(u, id), root = scopeFolder_(x);
      var counts = fileInto_(root, x.tasks);
      if (share) {
        try { root.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
        catch (e) {
          throw AppError_('DRIVE_SHARING', 'Google Drive didn’t allow a public link. In the Google Admin console, allow sharing outside rosierfoods.com (Apps → Google Workspace → Drive and Docs → Sharing settings), then try again.');
        }
        if (x.kind === 'campaign') dbUpdate_('Campaigns', x.campaign.campaignId, { shared: '1', updatedAt: nowIso_() });
        else dbUpdate_('Requirements', x.req.requirementId, { finalShared: '1', updatedAt: nowIso_() });
        if (x.tasks[0]) logActivity_(x.tasks[0].taskId, u, 'final_folder', '', 'shared', 'Final files folder shared (anyone with the link)', 'team');
      }
      var shared = x.kind === 'campaign' ? bool_(dbGet_('Campaigns', x.campaign.campaignId).shared) : bool_(dbGet_('Requirements', x.req.requirementId).finalShared);
      return {
        url: root.getUrl(), shared: shared, kind: x.kind, id: x.id, requirementId: x.req ? x.req.requirementId : '', title: x.title, label: x.label,
        campaignName: x.campaign ? x.campaign.name : '',
        requests: x.kind === 'campaign' ? campaignRequests_(x.campaign.campaignId).length : 1,
        categories: Object.keys(counts).sort().map(function (k) { return { name: k, count: counts[k] }; }),
        total: Object.keys(counts).reduce(function (s, k) { return s + counts[k]; }, 0)
      };
    });
  });
}

function api_unshareFinalFolder(id) {
  return respond_(function () {
    var u = requireLeader_();
    return withLock_(function () {
      var x = finalScope_(u, id);
      var folderId = x.kind === 'campaign' ? x.campaign.folderId : x.req.finalFolderId;
      if (folderId) { try { DriveApp.getFolderById(folderId).setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { /* ignore */ } }
      if (x.kind === 'campaign') dbUpdate_('Campaigns', x.campaign.campaignId, { shared: '', updatedAt: nowIso_() });
      else dbUpdate_('Requirements', x.req.requirementId, { finalShared: '', updatedAt: nowIso_() });
      return { shared: false };
    });
  });
}

/** Public link of a shared folder ('' if not shared) — the campaign's folder for campaign requests. */
function finalFolderUrl_(req) {
  if (!req) return '';
  var c = campaignOf_(req);
  var on = c ? bool_(c.shared) && c.folderId : bool_(req.finalShared) && req.finalFolderId;
  if (!on) return '';
  try { return DriveApp.getFolderById(c ? c.folderId : req.finalFolderId).getUrl(); } catch (e) { return ''; }
}

/** All approved creatives of a request (or one task) as a .zip, in category folders. */
function api_downloadApprovedZip(id, taskOnly) {
  return respond_(function () {
    var u = currentUser_();
    var x = finalScope_(u, id);
    var tasks = taskOnly ? x.tasks.filter(function (t) { return t.taskId === id; }) : x.tasks;
    var list = approvedOf_(tasks);
    if (!list.length) throw AppError_('VALIDATION', 'No approved creatives yet.');
    var total = 0, blobs = [], seen = {};
    list.forEach(function (a) {
      var f = fileOrNull_(a.v.approvedFileId) || fileOrNull_(a.v.fileId);
      if (!f) return;
      total += f.getSize();
      if (total > 45 * 1024 * 1024) throw AppError_('TOO_LARGE', 'These files are over 45 MB together — use “Drive link” and download the folder from Drive instead.');
      var name = categoryOf_(a.task, a.d) + '/' + approvedName_(a.d, a.v);
      if (seen[name]) name = name.replace(/(\.[^.]+)?$/, ' (' + (++seen[name]) + ')$1'); else seen[name] = 1;
      blobs.push(f.getBlob().setName(name));
    });
    var zip = Utilities.zip(blobs, cleanFolderName_(x.label + ' approved creatives') + '.zip');
    return { fileName: zip.getName(), mimeType: 'application/zip', base64: Utilities.base64Encode(zip.getBytes()), count: blobs.length };
  });
}

function finalSharedFlag_(r) { var c = campaignOf_(r); return c ? bool_(c.shared) && c.folderId : bool_(r.finalShared) && r.finalFolderId; }

/**
 * Leader: finished requests (every task completed), newest first, with what
 * was delivered and whether the Drive folder is shared. filter: { q, from, to }
 */
function api_listCompletedRequests(filter) {
  return respond_(function () {
    requireLeader_();
    filter = filter || {};
    var q = String(filter.q || '').toLowerCase().trim();
    var from = filter.from ? date_(filter.from, 'From') : '', to = filter.to ? date_(filter.to, 'To') : '';
    var byReq = {};
    dbAll_('Tasks').forEach(function (t) { if (t.status !== STATUS.CANCELLED) (byReq[t.requirementId] = byReq[t.requirementId] || []).push(t); });
    var dels = {}; dbAll_('CreativeSubmissions').forEach(function (d) { (dels[d.taskId] = dels[d.taskId] || []).push(d); });
    var out = [];
    dbAll_('Requirements').forEach(function (r) {
      var ts = byReq[r.requirementId] || [];
      if (!ts.length || !ts.every(function (t) { return t.status === STATUS.COMPLETED; })) return;
      var done = ts.map(function (t) { return t.completedAt; }).sort().pop() || '';
      var day = done ? isoDateOnly_(new Date(done)) : '';
      if ((from && day < from) || (to && day > to)) return;
      var cats = {}, approved = 0, rejected = 0;
      ts.forEach(function (t) {
        (dels[t.taskId] || []).forEach(function (d) {
          if (d.status === DSTATUS.REJECTED) { rejected++; return; }
          if (!d.approvedVersionId) return;
          approved++;
          var c = categoryOf_(t, d); cats[c] = (cats[c] || 0) + 1;
        });
      });
      var designers = ts.map(function (t) { return t.assigneeEmail ? displayName_(t.assigneeEmail) : ''; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
      var row = {
        requirementId: r.requirementId, title: r.title, department: r.department, requesterName: r.requesterName,
        submittedAt: r.submittedAt, completedAt: done, tasks: ts.length, firstTaskId: ts[0].taskId, designers: designers,
        approved: approved, rejected: rejected, categories: Object.keys(cats).sort().map(function (k) { return { name: k, count: cats[k] }; }),
        shared: !!finalSharedFlag_(r), hasFolder: !!(r.finalFolderId || (campaignOf_(r) || {}).folderId),
        campaignId: r.campaignId || '', campaignName: (campaignOf_(r) || {}).name || ''
      };
      if (q && [row.requirementId, row.title, row.department, row.requesterName, designers.join(' ')].join(' ').toLowerCase().indexOf(q) === -1) return;
      out.push(row);
    });
    out.sort(function (a, b) { return a.completedAt < b.completedAt ? 1 : -1; });
    return { rows: out.slice(0, 300), total: out.length };
  });
}

/* ======================= Campaigns.gs ======================= */
/**
 * Campaigns.gs — group work under one name (e.g. "Diwali Sale").
 *
 * A campaign collects requests from any department plus tasks the leader
 * assigns directly. Every approved creative of every request in the campaign
 * is filed into ONE Drive folder, sorted by category:
 *
 *   03_Approved_Creatives / Campaigns / Diwali Sale /
 *        Meta ads / …   Listing images / …   Website banners / …
 *
 * One public link to that folder gives anyone (e.g. the tech team) every
 * creative, whoever made it and whoever asked for it.
 */

function campaignOf_(req) { return req && req.campaignId ? dbGet_('Campaigns', req.campaignId) : null; }

/** The campaign's Drive folder (created on first use). Caller holds the lock. */
function campaignFolder_(c) {
  if (c.folderId) { try { var f = DriveApp.getFolderById(c.folderId); if (!f.isTrashed()) return f; } catch (e) { /* recreate */ } }
  var parent = DriveApp.getFolderById(ensureFolderId_('approved', ['Campaigns']));
  var folder = parent.createFolder(cleanFolderName_(c.name));
  dbUpdate_('Campaigns', c.campaignId, { folderId: folder.getId(), updatedAt: nowIso_() });
  return folder;
}

function campaignRequests_(campaignId) { return dbFind_('Requirements', function (r) { return r.campaignId === campaignId; }); }

function campaignTasks_(campaignId) {
  var ids = {}; campaignRequests_(campaignId).forEach(function (r) { ids[r.requirementId] = true; });
  return dbFind_('Tasks', function (t) { return ids[t.requirementId] && t.status !== STATUS.CANCELLED; });
}

/** Approved creatives per category for a set of tasks. */
function categoryCounts_(tasks) {
  var cats = {}, approved = 0;
  approvedOf_(tasks).forEach(function (a) { var c = categoryOf_(a.task, a.d); cats[c] = (cats[c] || 0) + 1; approved++; });
  return { approved: approved, categories: Object.keys(cats).sort().map(function (k) { return { name: k, count: cats[k] }; }) };
}

function campaignDto_(c, withDetail) {
  var reqs = campaignRequests_(c.campaignId), tasks = campaignTasks_(c.campaignId), cc = categoryCounts_(tasks);
  var o = {
    campaignId: c.campaignId, name: c.name, active: bool_(c.active), shared: bool_(c.shared) && !!c.folderId, createdAt: c.createdAt,
    requests: reqs.length, tasks: tasks.length, done: tasks.filter(function (t) { return t.status === STATUS.COMPLETED; }).length,
    required: tasks.reduce(function (s, t) { return s + (Number(t.deliverablesRequired) || 0); }, 0),
    approved: cc.approved, categories: cc.categories,
    departments: reqs.map(function (r) { return r.department; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; })
  };
  if (withDetail) {
    o.requestList = reqs.map(function (r) {
      var ts = tasks.filter(function (t) { return t.requirementId === r.requirementId; });
      return { requirementId: r.requirementId, title: r.title, department: r.department, requesterName: r.requesterName, submittedAt: r.submittedAt,
        internal: !!r.submittedBy && !r.email && r.department === 'Graphics team', firstTaskId: ts[0] ? ts[0].taskId : '',
        status: ts.length ? requesterStatus_(ts) : 'Received', approved: categoryCounts_(ts).approved,
        required: ts.reduce(function (s, t) { return s + (Number(t.deliverablesRequired) || 0); }, 0) };
    }).sort(function (a, b) { return a.submittedAt < b.submittedAt ? 1 : -1; });
    var dc = {}; dbAll_('CreativeSubmissions').forEach(function (d) { (dc[d.taskId] = dc[d.taskId] || []).push(d); });
    o.taskList = tasks.map(function (t) {
      var ds = dc[t.taskId] || [];
      return { taskId: t.taskId, title: t.title, status: t.status, category: t.creativeType || '', assigneeName: t.assigneeEmail ? displayName_(t.assigneeEmail) : '',
        required: Number(t.deliverablesRequired) || 0, approved: ds.filter(function (d) { return d.approvedVersionId && d.status !== DSTATUS.REJECTED; }).length,
        dueDate: t.dueDate, dueTime: t.dueTime, requirementId: t.requirementId, overdue: isOverdue_(t), hold: t.status === STATUS.ON_HOLD };
    }).sort(function (a, b) { return a.dueDate > b.dueDate ? 1 : -1; });
  }
  return o;
}

function api_listCampaigns() {
  return respond_(function () {
    requireLeader_();
    return dbAll_('Campaigns').map(function (c) { return campaignDto_(c, false); })
      .sort(function (a, b) { return (b.active - a.active) || (a.createdAt < b.createdAt ? 1 : -1); });
  });
}

function api_getCampaign(campaignId) {
  return respond_(function () {
    requireLeader_();
    var c = dbGet_('Campaigns', str_(campaignId, 40, 'Campaign', true));
    if (!c) throw AppError_('NOT_FOUND', 'Campaign not found.');
    var out = campaignDto_(c, true);
    // Requests not in any campaign yet, to add with one click.
    out.addable = dbFind_('Requirements', function (r) { return !r.campaignId; })
      .sort(function (a, b) { return a.submittedAt < b.submittedAt ? 1 : -1; }).slice(0, 100)
      .map(function (r) { return { requirementId: r.requirementId, title: r.title, department: r.department }; });
    out.addableTasks = addableTasks_(c.campaignId);
    return out;
  });
}

function api_saveCampaign(input) {
  return respond_(function () {
    var u = requireLeader_();
    input = input || {};
    var name = str_(input.name, 80, 'Campaign name', true);
    return withLock_(function () {
      var dup = dbFind_('Campaigns', function (c) { return c.name.toLowerCase() === name.toLowerCase() && c.campaignId !== input.campaignId; })[0];
      if (dup) throw AppError_('VALIDATION', 'There is already a campaign called “' + dup.name + '”.');
      if (input.campaignId) {
        var c = dbGet_('Campaigns', input.campaignId);
        if (!c) throw AppError_('NOT_FOUND', 'Campaign not found.');
        dbUpdate_('Campaigns', c.campaignId, { name: name, active: input.active === undefined ? c.active : !!input.active, updatedAt: nowIso_() });
        if (c.folderId && c.name !== name) { try { DriveApp.getFolderById(c.folderId).setName(cleanFolderName_(name)); } catch (e) { /* ignore */ } }
        return campaignDto_(dbGet_('Campaigns', c.campaignId), false);
      }
      var row = dbInsert_('Campaigns', { campaignId: 'CMP-' + uuid_().slice(0, 8).toUpperCase(), name: name, folderId: '', shared: '', active: true,
        createdBy: u.email, createdAt: nowIso_(), updatedAt: nowIso_() });
      return campaignDto_(row, false);
    });
  });
}

/** Moves a request (and its approved files) into a campaign, or out of it with campaignId ''. */
function api_setRequestCampaign(id, campaignId) {
  return respond_(function () {
    var u = requireLeader_();
    return withLock_(function () {
      var req = dbGet_('Requirements', str_(id, 40, 'Request', true));
      if (!req) { var t = dbGet_('Tasks', id); req = t && dbGet_('Requirements', t.requirementId); }
      if (!req) throw AppError_('NOT_FOUND', 'Request not found.');
      var c = null;
      if (campaignId) { c = dbGet_('Campaigns', str_(campaignId, 40, 'Campaign', true)); if (!c) throw AppError_('NOT_FOUND', 'Campaign not found.'); }
      if ((req.campaignId || '') === (c ? c.campaignId : '')) return { campaignId: req.campaignId || '' };
      dbUpdate_('Requirements', req.requirementId, { campaignId: c ? c.campaignId : '', updatedAt: nowIso_() });
      var tasks = dbFind_('Tasks', function (t) { return t.requirementId === req.requirementId && t.status !== STATUS.CANCELLED; });
      // Re-file already-approved creatives into the new place.
      fileInto_(finalFolder_(dbGet_('Requirements', req.requirementId)), tasks);
      tasks.forEach(function (t) { logActivity_(t.taskId, u, 'campaign', '', c ? c.name : '', c ? 'Added to campaign “' + c.name + '”' : 'Removed from campaign', 'team'); });
      return { campaignId: c ? c.campaignId : '' };
    });
  });
}

/** Tasks that could be added to a campaign (anything not cancelled and not already in it). */
function addableTasks_(campaignId) {
  var reqMap = {}, cmpMap = {};
  dbAll_('Requirements').forEach(function (r) { reqMap[r.requirementId] = r; });
  dbAll_('Campaigns').forEach(function (c) { cmpMap[c.campaignId] = c.name; });
  var perReq = {};
  dbAll_('Tasks').forEach(function (t) { if (t.status !== STATUS.CANCELLED) perReq[t.requirementId] = (perReq[t.requirementId] || 0) + 1; });
  return dbFind_('Tasks', function (t) {
    var r = reqMap[t.requirementId];
    return r && t.status !== STATUS.CANCELLED && (r.campaignId || '') !== campaignId;
  }).sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1; }).slice(0, 300).map(function (t) {
    var r = reqMap[t.requirementId];
    return { taskId: t.taskId, requirementId: t.requirementId, title: t.title, status: t.status,
      assigneeName: t.assigneeEmail ? displayName_(t.assigneeEmail) : '', department: r.department || '',
      inCampaign: r.campaignId ? (cmpMap[r.campaignId] || '') : '', sameRequest: (perReq[t.requirementId] || 1) - 1 };
  });
}

/**
 * Leader: put already-assigned tasks into a campaign (or a new one named newName), so their files land in one Drive folder.
 * Campaigns hold whole requests, so every task of the same request moves with it.
 */
function api_setTasksCampaign(taskIds, campaignId, newName) {
  return respond_(function () {
    var u = requireLeader_();
    if (!Array.isArray(taskIds) || !taskIds.length) throw AppError_('VALIDATION', 'Pick at least one task.');
    if (taskIds.length > 500) throw AppError_('VALIDATION', 'Too many tasks at once.');
    return withLock_(function () {
      var c = null;
      newName = str_(newName, 80, 'Campaign name', false);
      if (newName) {
        c = dbFind_('Campaigns', function (x) { return x.name.toLowerCase() === newName.toLowerCase(); })[0];
        if (!c) c = dbInsert_('Campaigns', { campaignId: 'CMP-' + uuid_().slice(0, 8).toUpperCase(), name: newName, folderId: '', shared: '', active: true,
          createdBy: u.email, createdAt: nowIso_(), updatedAt: nowIso_() });
      } else if (campaignId) {
        c = dbGet_('Campaigns', str_(campaignId, 40, 'Campaign', true));
        if (!c) throw AppError_('NOT_FOUND', 'Campaign not found.');
      }
      var reqIds = {}, order = [];
      taskIds.forEach(function (id) {
        var t = dbGet_('Tasks', str_(id, 40, 'Task', true));
        if (!t) throw AppError_('NOT_FOUND', 'Task ' + id + ' not found.');
        if (!reqIds[t.requirementId]) { reqIds[t.requirementId] = 1; order.push(t.requirementId); }
      });
      var target = c ? c.campaignId : '', moved = 0, requests = 0;
      order.forEach(function (rid) {
        var req = dbGet_('Requirements', rid);
        if (!req || (req.campaignId || '') === target) return;
        dbUpdate_('Requirements', rid, { campaignId: target, updatedAt: nowIso_() });
        var tasks = dbFind_('Tasks', function (t) { return t.requirementId === rid && t.status !== STATUS.CANCELLED; });
        fileInto_(finalFolder_(dbGet_('Requirements', rid)), tasks);
        tasks.forEach(function (t) { logActivity_(t.taskId, u, 'campaign', '', c ? c.name : '', c ? 'Added to campaign “' + c.name + '”' : 'Removed from campaign', 'team'); });
        moved += tasks.length; requests++;
      });
      return { campaignId: target, campaignName: c ? c.name : '', tasks: moved, requests: requests };
    });
  });
}

/** Folder choices for a request/campaign: folders already used there + the category list from Settings. */
function folderOptions_(req) {
  var tasks = req && req.campaignId ? campaignTasks_(req.campaignId)
    : (req ? dbFind_('Tasks', function (t) { return t.requirementId === req.requirementId; }) : []);
  var seen = {}, out = [];
  function add(p) { p = cleanPath_(p); if (p && !seen[p.toLowerCase()]) { seen[p.toLowerCase()] = 1; out.push(p); } }
  tasks.forEach(function (t) { add(t.folderPath); add(t.creativeType); });
  dbAll_('CreativeSubmissions').forEach(function (d) { if (tasks.some(function (t) { return t.taskId === d.taskId; })) add(d.deliverableType); });
  (settings_().creativeCategories || []).forEach(add);
  return out;
}

/** Leader: folder choices for "Assign a task" (scope = CMP-…, REQ-… or '' for a new request). */
function api_folderOptions(scope) {
  return respond_(function () {
    requireLeader_();
    scope = str_(scope, 40, 'Scope', false);
    if (/^CMP-/.test(scope)) {
      var c = dbGet_('Campaigns', scope);
      return { root: c ? c.name : '', options: folderOptions_({ campaignId: scope, requirementId: '' }) };
    }
    var r = scope ? dbGet_('Requirements', scope) : null;
    return { root: r ? (r.campaignId ? (dbGet_('Campaigns', r.campaignId) || {}).name : r.requirementId) : 'the new request', options: folderOptions_(r) };
  });
}

/** Leader: turn the requester's typed sale name into a campaign (or join the existing one with that name) and add the request. */
function api_campaignFromSuggestion(id) {
  return respond_(function () {
    var u = requireLeader_();
    return withLock_(function () {
      var req = dbGet_('Requirements', str_(id, 40, 'Request', true));
      if (!req) { var t = dbGet_('Tasks', id); req = t && dbGet_('Requirements', t.requirementId); }
      if (!req || !req.campaign) throw AppError_('NOT_FOUND', 'No campaign name on this request.');
      var name = str_(req.campaign, 80, 'Campaign name', true);
      var c = dbFind_('Campaigns', function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0];
      if (!c) c = dbInsert_('Campaigns', { campaignId: 'CMP-' + uuid_().slice(0, 8).toUpperCase(), name: name, folderId: '', shared: '', active: true, createdBy: u.email, createdAt: nowIso_(), updatedAt: nowIso_() });
      dbUpdate_('Requirements', req.requirementId, { campaignId: c.campaignId, updatedAt: nowIso_() });
      var tasks = dbFind_('Tasks', function (t) { return t.requirementId === req.requirementId && t.status !== STATUS.CANCELLED; });
      fileInto_(finalFolder_(dbGet_('Requirements', req.requirementId)), tasks);
      tasks.forEach(function (t) { logActivity_(t.taskId, u, 'campaign', '', c.name, 'Added to campaign “' + c.name + '”', 'team'); });
      return { campaignId: c.campaignId, name: c.name };
    });
  });
}

/* ======================= Theme.gs ======================= */
/**
 * Theme.gs — portal colour themes (Settings → Look & feel). Every page
 * includes <?!= themeCss_() ?> after the base styles, which overrides the CSS
 * variables. A custom accent colour can be layered on any theme.
 */

var THEMES = {
  rosier:   { label: 'Rosier (warm)', accent: '#a56312' },
  ocean:    { label: 'Ocean blue', accent: '#1f6fb2' },
  forest:   { label: 'Forest green', accent: '#2e6f40' },
  plum:     { label: 'Plum', accent: '#7b3f8f' },
  rose:     { label: 'Rose', accent: '#b23a5b' },
  slate:    { label: 'Slate', accent: '#3e4c59' },
  midnight: { label: 'Midnight (dark)', accent: '#e0a052', dark: true }
};

function hexRgb_(hex) { var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return null; var n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function mix_(rgb, to, t) { return '#' + rgb.map(function (c, i) { var v = Math.round(c + (to[i] - c) * t); return ('0' + v.toString(16)).slice(-2); }).join(''); }

/** The CSS for the current theme ('' for the default look). */
function themeCss_() {
  var s;
  try { s = settings_(); } catch (e) { return ''; }
  var th = THEMES[s.theme] || THEMES.rosier;
  var accent = hexRgb_(s.accentColor) || hexRgb_(th.accent);
  if (!th.dark && s.theme === 'rosier' && !s.accentColor) return '';
  var v = {};
  if (th.dark) {
    v = { '--bg': '#131519', '--surface': '#1c1f25', '--surface-2': '#22262d', '--line': '#2f343c', '--line-strong': '#3c424c',
      '--text': '#eceae6', '--text-2': '#b7b2a9', '--text-3': '#8d887f', '--muted-soft': '#2a2e35',
      '--ok': '#5fbf87', '--ok-soft': '#1e3427', '--warn': '#e0b052', '--warn-soft': '#3a3020', '--bad': '#f07a6e', '--bad-soft': '#3d2522',
      '--info': '#7fb0ea', '--info-soft': '#1f2c3d', '--shadow': '0 1px 2px rgba(0,0,0,.4)', '--shadow-lg': '0 12px 32px rgba(0,0,0,.5)' };
    v['--accent'] = mix_(accent, [0, 0, 0], 0);
    v['--accent-ink'] = mix_(accent, [255, 255, 255], .25);
    v['--accent-soft'] = mix_(accent, [28, 31, 37], .78);
  } else {
    v['--accent'] = mix_(accent, [0, 0, 0], 0);
    v['--accent-ink'] = mix_(accent, [0, 0, 0], .25);
    v['--accent-soft'] = mix_(accent, [255, 255, 255], .88);
  }
  return '<style id="theme">:root{' + Object.keys(v).map(function (k) { return k + ':' + v[k]; }).join(';') + '}' +
    (th.dark ? 'input,select,textarea{background:var(--surface-2);color:var(--text);border-color:var(--line-strong)}' +
      '.btn{background:var(--surface-2);color:var(--text);border-color:var(--line-strong)}.btn.primary,.btn.ok{color:#111}' +
      'table.t th{background:var(--surface-2)}.modal{background:var(--surface)}' : '') + '</style>';
}

function api_listThemes() {
  return respond_(function () {
    requireLeader_();
    return Object.keys(THEMES).map(function (k) { return { id: k, label: THEMES[k].label, accent: THEMES[k].accent, dark: !!THEMES[k].dark }; });
  });
}

/* ======================= Code.gs ======================= */
/**
 * Code.gs — web app entry point and page routing.
 *
 * The same code is deployed twice (see docs/DEPLOYMENT.md):
 *   Public   — Execute as: Me · Access: Anyone       → form + review pages
 *   Internal — Execute as: Me · Access: Anyone within your domain → dashboards
 *
 * Routes (?p=):
 *   form    — requirement form (default for anyone who isn't a team member)
 *   review  — creative review page (&t=<token>)
 *   app     — team dashboards (default for team members); &r=<route> deep link
 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var page = String(p.p || '');
  var s;
  try { s = settings_(); } catch (err) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:40px">The portal isn’t set up yet. The administrator needs to run <code>setup()</code>.</p>');
  }

  if (page === 'review') {
    // The review page is never embeddable, so its Approve button can't be clickjacked.
    return render_('Review', { token: TOKEN_RE.test(String(p.t || '')) ? String(p.t) : '' }, 'Review creative · ' + s.companyName, false);
  }

  if (page === 'share') {
    return render_('Share', { token: TOKEN_RE.test(String(p.t || '')) ? String(p.t) : '' }, 'Shared task · ' + s.companyName, false);
  }

  if (page === 'batch') {
    // Never embeddable, so its Approve buttons can't be clickjacked.
    return render_('Batch', { token: TOKEN_RE.test(String(p.t || '')) ? String(p.t) : '' }, 'Review creatives · ' + s.companyName, false);
  }

  if (page === 'app' || page === '') {
    var email = activeEmail_();
    var member = email ? userByEmail_(email) : null;
    if (member && bool_(member.active)) {
      var route = String(p.r || '').replace(/[^\w\-\/]/g, '').slice(0, 80);
      // Pre-load the first screen's data into the page so it opens without extra round trips.
      var pre = { api_bootstrap: api_bootstrap(), api_getNotifications: api_getNotifications() };
      if (!route || route === 'overview') {
        if (member.role === ROLES.LEADER) pre.api_leaderDashboard = api_leaderDashboard();
        else pre.api_designerDashboard = api_designerDashboard();
      }
      return render_('App', { route: route, pre: pre }, s.portalName, s.allowEmbedding);
    }
    if (page === 'app') {
      return render_('NoAccess', { email: email, publicUrl: s.publicUrl }, s.portalName);
    }
  }
  var formBoot = {};
  if (page === 'my') formBoot.tab = 'my';
  if (page === 'my' && TOKEN_RE.test(String(p.t || ''))) formBoot.track = String(p.t);
  var who = activeEmail_();
  var tm = who ? userByEmail_(who) : null;
  if (tm && bool_(tm.active)) { formBoot.name = tm.name; formBoot.email = tm.email; formBoot.backUrl = s.internalUrl || ''; }
  return render_('Form', formBoot, 'Request a creative · ' + s.companyName, s.allowEmbedding);
}

function render_(file, boot, title, embeddable) {
  var t = HtmlService.createTemplateFromFile(file);
  // Boot data is JSON-encoded and "<" escaped so it can't break out of the script tag.
  t.bootJson = JSON.stringify(boot || {}).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
  return t.evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(embeddable ? HtmlService.XFrameOptionsMode.ALLOWALL : HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Used inside templates: <?!= include_('Styles') ?> */
function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
