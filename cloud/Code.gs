/**
 * 職人百寶箱 — 線上空間
 *
 * 這支程式部署成網頁應用程式後，App 的「管理者登入」才有地方可以存。
 * 資料寫進你自己的 Google 試算表，照片存進你自己的雲端硬碟。
 *
 * 安裝步驟見同資料夾的「安裝說明.md」。
 */

/** 第一次執行 setup() 前，先把這裡改成你要的通行碼。 */
var PASSCODE = '請改成你的通行碼';

var SHEET_NAME = '職人百寶箱_查驗紀錄';
var FOLDER_NAME = '職人百寶箱_自檢照片';
var TAB_REC = '查驗紀錄';
var TAB_ITEM = '檢查項目';

var HEAD_REC = ['編號', '檢查日期', '民國日期', '工程名稱', '承攬廠商', '區域', '樓層',
  '檢查位置', '分項工程', '施工流程', '抽查時機', '檢查人',
  '合格', '缺失', '無此項', '檢查結果', '改善狀態', '照片數', '上傳時間', '照片資料夾'];
var HEAD_ITEM = ['編號', '檢查日期', '區域樓層', '檢查位置', '分項工程',
  '施工流程', '管理項目', '抽查標準', '實際抽查情形', '抽查結果', '照片數'];

/* ---------- 安裝 ---------- */

function setup() {
  var props = PropertiesService.getScriptProperties();

  if (!PASSCODE || PASSCODE === '請改成你的通行碼') {
    throw new Error('請先把程式最上方的 PASSCODE 改成你要的通行碼，再執行 setup()。');
  }
  props.setProperty('PASSCODE', PASSCODE);

  var ss = props.getProperty('SHEET_ID') ? SpreadsheetApp.openById(props.getProperty('SHEET_ID')) : null;
  if (!ss) {
    ss = SpreadsheetApp.create(SHEET_NAME);
    props.setProperty('SHEET_ID', ss.getId());
  }
  ensureTab_(ss, TAB_REC, HEAD_REC);
  ensureTab_(ss, TAB_ITEM, HEAD_ITEM);
  var first = ss.getSheets()[0];
  if (first.getName() === '工作表1' && ss.getSheets().length > 2) ss.deleteSheet(first);

  var folderId = props.getProperty('FOLDER_ID');
  var folder = null;
  if (folderId) { try { folder = DriveApp.getFolderById(folderId); } catch (e) { folder = null; } }
  if (!folder) {
    folder = DriveApp.createFolder(FOLDER_NAME);
    props.setProperty('FOLDER_ID', folder.getId());
  }

  Logger.log('通行碼已設定。');
  Logger.log('試算表：' + ss.getUrl());
  Logger.log('照片資料夾：https://drive.google.com/drive/folders/' + folder.getId());
  Logger.log('接著依安裝說明「部署 → 新增部署作業 → 網頁應用程式」，取得 /exec 網址。');
}

function ensureTab_(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ---------- 入口 ---------- */

function doGet() {
  return HtmlService.createHtmlOutput(
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div style="font-family:system-ui;padding:2rem;line-height:1.8">' +
    '<h3>職人百寶箱 — 線上空間</h3>' +
    '<p>這個網址是給 App 用的，請在 App 的「管理者登入」裡貼上它。</p></div>');
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: '請求格式錯誤' });
  }

  var props = PropertiesService.getScriptProperties();
  var pass = props.getProperty('PASSCODE');
  if (!pass) return json_({ ok: false, error: '伺服器尚未執行 setup()' });
  if (String(body.pass || '') !== pass) return json_({ ok: false, error: '通行碼不正確' });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return json_({ ok: false, error: '伺服器忙碌中，請稍後再試' });
  }

  try {
    if (body.action === 'ping') return json_({ ok: true, count: countRecords_() });
    if (body.action === 'push') return json_(push_(body.record, body.photos || []));
    return json_({ ok: false, error: '不認得的動作：' + body.action });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 資料 ---------- */

function book_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('尚未執行 setup()');
  return SpreadsheetApp.openById(id);
}

function countRecords_() {
  var sh = book_().getSheetByName(TAB_REC);
  return Math.max(0, sh.getLastRow() - 1);
}

var MARK = { pass: '○', fail: '╳', na: '／' };

function push_(r, photos) {
  if (!r || !r.code) throw new Error('紀錄缺少編號');
  var ss = book_();
  var shRec = ensureTab_(ss, TAB_REC, HEAD_REC);
  var shItem = ensureTab_(ss, TAB_ITEM, HEAD_ITEM);

  var items = r.items || [];
  var c = { pass: 0, fail: 0, na: 0 };
  items.forEach(function (it) { if (c[it.result] !== undefined) c[it.result]++; });

  var folderUrl = '';
  if (photos.length) folderUrl = savePhotos_(r, photos);

  var row = [r.code, r.date || '', roc_(r.date), r.site || '', r.vendor || '',
    r.zone || '', r.floor || '', r.location || '', r.subproject || '',
    r.stage || '', r.timing || '', r.inspector || '',
    c.pass, c.fail, c.na,
    c.fail ? '有缺失' : '全部合格',
    r.result === 'fail' ? (r.fixed ? '已改善' : '待改善') : '—',
    photos.length, new Date(), folderUrl];

  var at = findRow_(shRec, r.code);
  if (at) shRec.getRange(at, 1, 1, row.length).setValues([row]);
  else shRec.appendRow(row);

  deleteRows_(shItem, r.code);
  if (items.length) {
    var zf = (r.zone || '') + ' ' + (r.floor || '');
    var rows = items.map(function (it) {
      return [r.code, r.date || '', zf, r.location || '', r.subproject || '',
        it.stage || '', it.item || '', it.std || '', it.actual || '',
        MARK[it.result] || '', (it.photos || []).length];
    });
    shItem.getRange(shItem.getLastRow() + 1, 1, rows.length, HEAD_ITEM.length).setValues(rows);
  }

  return { ok: true, code: r.code, photos: photos.length, count: countRecords_() };
}

function findRow_(sh, code) {
  var n = sh.getLastRow();
  if (n < 2) return 0;
  var col = sh.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) if (String(col[i][0]) === String(code)) return i + 2;
  return 0;
}

function deleteRows_(sh, code) {
  var n = sh.getLastRow();
  if (n < 2) return;
  var col = sh.getRange(2, 1, n - 1, 1).getValues();
  for (var i = col.length - 1; i >= 0; i--) {
    if (String(col[i][0]) === String(code)) sh.deleteRow(i + 2);
  }
}

function savePhotos_(r, photos) {
  var rootId = PropertiesService.getScriptProperties().getProperty('FOLDER_ID');
  var root = DriveApp.getFolderById(rootId);
  var name = r.code + '_' + (r.zone || '') + (r.floor || '') + '-' + (r.subproject || '');
  name = name.replace(/[\\/:*?"<>|]/g, '_');

  var it = root.getFoldersByName(name);
  var dir = it.hasNext() ? it.next() : root.createFolder(name);

  // 重傳時先清掉舊照片，避免同一筆查驗累積重複檔案或重複資料夾
  var oldFiles = dir.getFiles();
  while (oldFiles.hasNext()) oldFiles.next().setTrashed(true);
  var oldDirs = dir.getFolders();
  while (oldDirs.hasNext()) oldDirs.next().setTrashed(true);

  var shots = dir.createFolder('自檢照片');
  for (var i = 0; i < photos.length; i++) {
    var p = photos[i];
    var fn = pad_(i + 1) + '_' + String(p.item || '照片').replace(/[\\/:*?"<>|]/g, '_') + '.jpg';
    shots.createFile(Utilities.newBlob(Utilities.base64Decode(p.b64), 'image/jpeg', fn));
  }
  return 'https://drive.google.com/drive/folders/' + dir.getId();
}

function pad_(n) { return (n < 10 ? '0' : '') + n; }

function roc_(iso) {
  if (!iso) return '';
  var p = String(iso).split('-');
  if (p.length !== 3) return '';
  return String(Number(p[0]) - 1911) + p[1] + p[2];
}
