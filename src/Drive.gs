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
