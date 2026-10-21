/**
 * In-memory stand-ins for the Google Apps Script services the portal uses,
 * so the real server code (src/*.gs) can be exercised end-to-end in Node.
 * This is a test double for development only — production uses real Google services.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function signed(buf) { return Array.from(buf).map(b => (b > 127 ? b - 256 : b)); }
function unsigned(arr) { return Buffer.from(arr.map(b => (b < 0 ? b + 256 : b))); }

function createEnv(opts = {}) {
  const state = {
    currentUser: '',
    owner: opts.owner || 'owner@rosierfoods.com',
    props: {},
    cache: new Map(),
    spreadsheets: {},
    folders: {},
    files: {},
    sessions: {},
    mail: [],
    triggers: [],
    fetchLog: []
  };
  let idc = 0;
  const nid = p => p + (++idc).toString(36) + crypto.randomBytes(3).toString('hex');

  /* ---------- Sheets ---------- */
  function makeSheet(name) {
    const sh = { name, data: [], maxCols: 26, maxRows: 1000 };
    function ensure(r, c) { while (sh.data.length < r) sh.data.push([]); for (let i = 0; i < r; i++) while (sh.data[i].length < c) sh.data[i].push(''); }
    const api = {
      getName: () => name,
      getLastRow: () => { let last = 0; sh.data.forEach((row, i) => { if (row.some(v => v !== '' && v !== null)) last = i + 1; }); return last; },
      getMaxColumns: () => sh.maxCols,
      getMaxRows: () => sh.maxRows,
      insertColumnsAfter: (a, n) => { sh.maxCols += n; },
      setFrozenRows: () => {},
      protect: () => ({ setDescription() { return this; }, getEditors: () => [], removeEditor() {}, canDomainEdit: () => false, setDomainEdit() {} }),
      getRange: (r, c, nr = 1, nc = 1) => { const rg = {
        getValues: () => { ensure(r + nr - 1, c + nc - 1); return sh.data.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc).map(v => v)); },
        setValues: vals => {
          if (vals.length !== nr || vals[0].length !== nc) throw new Error('setValues dimension mismatch');
          ensure(r + nr - 1, c + nc - 1);
          vals.forEach((row, i) => row.forEach((v, j) => {
            // Sheets: a leading apostrophe forces text and is not part of the value.
            if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
            else if (typeof v === 'string' && /^=/.test(v)) throw new Error('Formula written to sheet: ' + v);
            sh.data[r - 1 + i][c - 1 + j] = v;
          }));
          return rg;
        },
        setNumberFormat() { return rg; },
        setFontWeight() { return rg; }
      }; return rg; }
    };
    sh.api = api;
    return sh;
  }
  function makeSpreadsheet(name) {
    const id = nid('ss');
    const s = { id, name, sheets: {} };
    s.sheets.Sheet1 = makeSheet('Sheet1');
    s.api = {
      getId: () => id,
      getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
      getSheetByName: n => (s.sheets[n] ? s.sheets[n].api : null),
      insertSheet: n => { s.sheets[n] = makeSheet(n); return s.sheets[n].api; },
      getSheets: () => Object.values(s.sheets).map(x => x.api),
      deleteSheet: sh => { delete s.sheets[sh.getName()]; }
    };
    state.spreadsheets[id] = s;
    state.files[id] = { id, name, mime: 'application/vnd.google-apps.spreadsheet', bytes: Buffer.alloc(0), parent: null };
    return s.api;
  }

  /* ---------- Drive ---------- */
  function folderApi(f) {
    return {
      getId: () => f.id,
      getName: () => f.name,
      getUrl: () => 'https://drive.google.com/drive/folders/' + f.id,
      isTrashed: () => !!f.trashed,
      getSharingAccess: () => 'PRIVATE',
      getFiles: () => iter(Object.values(state.files).filter(x => x.parent === f.id && !x.trashed).map(fileApi)),
      getFoldersByName: n => iter(Object.values(state.folders).filter(x => x.parent === f.id && x.name === n && !x.trashed).map(folderApi)),
      createFolder: n => folderApi(newFolder(n, f.id)),
      getEditors: () => f.editors.map(e => ({ getEmail: () => e })),
      addEditor: e => { f.editors.push(e); },
      removeEditor: e => { f.editors = f.editors.filter(x => x !== e); }
    };
  }
  function iter(list) { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }
  function newFolder(name, parent) { const f = { id: nid('fo'), name, parent, editors: [] }; state.folders[f.id] = f; return f; }
  function fileApi(f) {
    return {
      getId: () => f.id, getName: () => f.name, setName: n => { f.name = n; return this; },
      getSize: () => f.bytes.length, getMimeType: () => f.mime, getUrl: () => 'https://drive.google.com/file/d/' + f.id,
      getBlob: () => ({ getBytes: () => signed(f.bytes), getContentType: () => f.mime }),
      makeCopy: (name, folder) => { const c = { id: nid('fi'), name, mime: f.mime, bytes: Buffer.from(f.bytes), parent: folder.getId() }; state.files[c.id] = c; return fileApi(c); },
      moveTo: folder => { f.parent = folder.getId(); },
      setTrashed: v => { f.trashed = !!v; }
    };
  }
  const DriveApp = {
    createFolder: n => folderApi(newFolder(n, 'root')),
    getFolderById: id => { const f = state.folders[id]; if (!f) throw new Error('No folder ' + id); return folderApi(f); },
    getFileById: id => { const f = state.files[id]; if (!f || f.trashed) throw new Error('No file ' + id); return fileApi(f); }
  };

  /* ---------- UrlFetch (Drive REST) ---------- */
  function resp(code, body, headers = {}, bytes) {
    return {
      getResponseCode: () => code,
      getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)),
      getHeaders: () => headers,
      getBlob: () => ({ getBytes: () => signed(bytes || Buffer.alloc(0)), getContentType: () => 'image/png' })
    };
  }
  const UrlFetchApp = {
    fetch(url, p = {}) {
      state.fetchLog.push({ url, method: p.method });
      const auth = (p.headers || {}).Authorization;
      if (auth !== 'Bearer owner-token') return resp(401, { error: 'unauthorized' });
      if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable') && p.method === 'post') {
        const meta = JSON.parse(p.payload);
        const sid = nid('sess');
        state.sessions[sid] = { meta, total: Number(p.headers['X-Upload-Content-Length']), mime: p.headers['X-Upload-Content-Type'], chunks: [], received: 0 };
        return resp(200, '', { Location: 'https://upload.mock/session/' + sid });
      }
      if (url.startsWith('https://upload.mock/session/') && p.method === 'put') {
        const s = state.sessions[url.split('/').pop()];
        if (!s) return resp(404, 'gone');
        const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(p.headers['Content-Range']);
        const start = Number(m[1]), end = Number(m[2]);
        if (start !== s.received) return resp(400, 'bad offset');
        const buf = unsigned(p.payload);
        if (buf.length !== end - start + 1) return resp(400, 'bad length');
        s.chunks.push(buf); s.received += buf.length;
        if (s.received < s.total) return resp(308, '', { Range: 'bytes=0-' + (s.received - 1) });
        const id = nid('fi');
        state.files[id] = { id, name: s.meta.name, mime: s.mime, bytes: Buffer.concat(s.chunks), parent: s.meta.parents[0] };
        return resp(200, { id, name: s.meta.name, mimeType: s.mime, size: String(s.total) });
      }
      let mm = /drive\/v3\/files\/([^?]+)\?fields=thumbnailLink/.exec(url);
      if (mm) { return state.files[mm[1]] ? resp(200, { hasThumbnail: true, thumbnailLink: 'https://thumb.mock/' + mm[1] + '=s220' }) : resp(404, {}); }
      if (url.startsWith('https://thumb.mock/')) {
        const f = state.files[url.slice(19).split('=')[0]];
        const px = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
        return resp(200, '', {}, f && /^image\/(png|jpeg)/.test(f.mime) ? f.bytes : px);
      }
      return resp(404, 'unknown');
    }
  };

  /* ---------- misc services ---------- */
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    getUuid: () => crypto.randomUUID(),
    computeDigest: (alg, s) => signed(crypto.createHash('sha256').update(String(s), 'utf8').digest()),
    base64EncodeWebSafe: b => unsigned(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64Encode: b => unsigned(b).toString('base64'),
    base64Decode: s => signed(Buffer.from(s, 'base64')),
    formatDate: (d, tz, fmt) => {
      const shifted = new Date(d.getTime() + 330 * 60000); // Asia/Kolkata
      if (fmt === 'yyyy-MM-dd') return shifted.toISOString().slice(0, 10);
      if (fmt === 'Z') return '+0530';
      if (fmt === 'yyyy-MM-dd_HHmm') return shifted.toISOString().slice(0, 16).replace('T', '_').replace(':', '');
      throw new Error('fmt ' + fmt);
    }
  };
  const ctx = {
    console: { log() {}, warn() {}, error: (...a) => { if (opts.verbose) console.error(...a); } },
    Session: {
      getActiveUser: () => ({ getEmail: () => state.currentUser }),
      getEffectiveUser: () => ({ getEmail: () => state.owner }),
      getScriptTimeZone: () => 'Asia/Kolkata'
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in state.props ? state.props[k] : null), setProperty: (k, v) => { state.props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: k => (state.cache.has(k) ? state.cache.get(k) : null), put: (k, v) => { state.cache.set(k, String(v)); }, remove: k => state.cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { openById: id => state.spreadsheets[id].api, create: n => makeSpreadsheet(n), flush() {} },
    DriveApp, UrlFetchApp, Utilities,
    MailApp: { getRemainingDailyQuota: () => 100, sendEmail: m => state.mail.push(m) },
    ScriptApp: {
      getOAuthToken: () => 'owner-token',
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/PUBLIC/exec' }),
      getProjectTriggers: () => state.triggers.map(t => ({ getHandlerFunction: () => t.fn, getUniqueId: () => t.id })),
      deleteTrigger: t => { state.triggers = state.triggers.filter(x => x.id !== t.getUniqueId()); },
      newTrigger: fn => { const c = { create: () => { state.triggers.push({ fn, id: nid('trg') }); } }; const tb = { everyHours: () => c, everyDays: () => ({ atHour: () => c }) }; return { timeBased: () => tb }; }
    },
    HtmlService: {
      XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' },
      createHtmlOutputFromFile: name => ({ getContent: () => fs.readFileSync(path.join(SRC, name + '.html'), 'utf8') }),
      createHtmlOutput: html => ({ html, setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; }, getContent() { return html; } }),
      createTemplateFromFile: name => {
        const t = { _file: name };
        t.evaluate = () => {
          let src = fs.readFileSync(path.join(SRC, name + '.html'), 'utf8');
          src = src.replace(/<\?!=\s*([\s\S]+?)\s*\?>/g, (_, expr) => {
            const fn = new vm.Script('(' + expr + ')');
            return String(fn.runInContext(Object.assign(ctx, { bootJson: t.bootJson })));
          });
          return { html: src, file: name, setTitle(x) { this.title = x; return this; }, addMetaTag() { return this; }, setXFrameOptionsMode(m) { this.xframe = m; return this; }, getContent() { return src; } };
        };
        return t;
      }
    },
    Date, Math, JSON, Object, Array, String, Number, Boolean, Error, RegExp, isNaN, isFinite, encodeURIComponent, decodeURIComponent, parseInt
  };
  const SRC = process.env.GAS_SRC ? path.resolve(process.env.GAS_SRC) : path.join(__dirname, '..', 'src');
  vm.createContext(ctx);
  fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort().forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  });

  // Each "request" in Apps Script is a fresh execution: reset per-call caches.
  function call(user, fnName, ...args) {
    state.currentUser = user || '';
    vm.runInContext('DB_CACHE_ = {}; SETTINGS_MEMO_ = null; DB_SS_ = null; LOCK_DEPTH_ = 0;', ctx);
    const out = ctx[fnName](...args);
    return JSON.parse(JSON.stringify(out === undefined ? null : out));
  }
  return { ctx, state, call };
}

module.exports = { createEnv, signed, unsigned };
