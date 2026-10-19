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
    var out = fn();
    SpreadsheetApp.flush();
    return out;
  } finally {
    LOCK_DEPTH_ = 0;
    lock.releaseLock();
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
