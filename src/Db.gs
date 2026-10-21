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
  var sh = ss_().getSheetByName(table);
  if (!sh) throw AppError_('NOT_CONFIGURED', 'Database sheet "' + table + '" is missing. Run setup() again.');
  return sh;
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
  var cached = tcacheGet_(table);
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
