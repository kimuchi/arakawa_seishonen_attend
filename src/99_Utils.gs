/**
 * 99_Utils.gs
 * 各モジュールで共通利用するユーティリティ関数。
 */

/**
 * スプレッドシート本体を取得。PropertiesServiceにIDを保存しておき、
 * どの関数からでも安定して取得できるようにする。
 */
function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.SPREADSHEET_ID);
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      // IDが無効な場合はフォールスルー
    }
  }
  // コンテナバインドされている場合はActiveを使う
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    PropertiesService.getScriptProperties().setProperty(PROP_KEYS.SPREADSHEET_ID, active.getId());
    return active;
  }
  throw new Error('スプレッドシートが見つかりません。まず initializeSpreadsheet() を実行してください。');
}

/**
 * 指定名のシートを取得。存在しなければnull。
 */
function getSheet_(name) {
  return getSpreadsheet_().getSheetByName(name);
}

/**
 * シートの全データを「オブジェクトの配列」として取得する。
 * 1行目をヘッダーとして扱う。
 */
function sheetToObjects_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const rows = values.slice(1);
  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  }).filter(obj => {
    // 全列空の行は無視
    return Object.values(obj).some(v => v !== '' && v !== null && v !== undefined);
  });
}

/**
 * 新規ID採番（既存の最大値+1）。
 * データが空のときは1を返す。
 */
function generateNextId_(sheet, idColumnIndex) {
  if (sheet.getLastRow() < 2) return 1;
  const ids = sheet.getRange(2, idColumnIndex, sheet.getLastRow() - 1, 1).getValues()
    .map(r => Number(r[0]))
    .filter(n => !isNaN(n) && n > 0);
  return ids.length === 0 ? 1 : Math.max.apply(null, ids) + 1;
}

/**
 * 日付をyyyy-MM-dd形式の文字列に整形。
 */
function formatDate_(d) {
  if (!d) return '';
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
}

/**
 * 時刻をHH:mm形式の文字列に整形。
 */
function formatTime_(d) {
  if (!d) return '';
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, 'Asia/Tokyo', 'HH:mm');
}

/**
 * yyyy-MM-dd文字列をDateに変換。
 */
function parseDate_(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  const parts = String(s).split('-').map(Number);
  if (parts.length !== 3) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/**
 * 指定シートから行番号を特定（ID列で検索）。見つからなければ-1。
 */
function findRowById_(sheet, idColumnIndex, id) {
  if (sheet.getLastRow() < 2) return -1;
  const ids = sheet.getRange(2, idColumnIndex, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (Number(ids[i][0]) === Number(id)) {
      return i + 2; // シート行番号(1始まり)
    }
  }
  return -1;
}

/**
 * 現在のユーザのメールアドレス。
 */
function getCurrentUserEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

/**
 * HtmlServiceのテンプレートに他のHTMLファイルを埋め込むためのヘルパ。
 * テンプレート内で <?!= include('styles'); ?> のように使う。
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * ログ（Stackdriver）に構造化ログを残す。
 */
function logInfo_(label, data) {
  try {
    console.log(label, JSON.stringify(data));
  } catch (e) {
    console.log(label, String(data));
  }
}

/**
 * ロック取得のラッパ。書き込み処理の直列化に使う。
 * @param {Function} fn 実行する関数
 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30 * 1000);
    return fn();
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
