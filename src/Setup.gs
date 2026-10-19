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

  installTriggers();

  console.log('Setup complete.');
  console.log('Database: ' + ss.getUrl());
  console.log('Drive root: ' + root.getUrl());
  console.log('Next: Deploy → New deployment (twice). See docs/DEPLOYMENT.md.');
  return { spreadsheetUrl: ss.getUrl(), rootFolderUrl: root.getUrl() };
}

/** (Re)creates the hourly maintenance trigger. */
function installTriggers() {
  guardOwner_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'hourlyMaintenance') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('hourlyMaintenance').timeBased().everyHours(1).create();
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
