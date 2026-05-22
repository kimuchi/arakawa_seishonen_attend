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
  const lastRow = getLastDataRow_(sheet, idColumnIndex);
  if (lastRow < 2) return 1;
  const ids = sheet.getRange(2, idColumnIndex, lastRow - 1, 1).getValues()
    .map(r => Number(r[0]))
    .filter(n => !isNaN(n) && n > 0);
  return ids.length === 0 ? 1 : Math.max.apply(null, ids) + 1;
}

/**
 * 指定列にデータが入っている最終行番号を返す。
 *
 * sheet.getLastRow() は「コンテンツがある最終行」を返すが、
 * insertCheckboxes() でチェックボックスを全行に張ると、その行も
 * 「false 値あり = コンテンツあり」と判定されて max 行を返してしまう。
 * これを避けるため、ID 列 (またはユーザ指定列) で空でないセルの最大行を
 * 探して返す。
 */
function getLastDataRow_(sheet, dataColumnIndex) {
  if (!sheet) return 1;
  const col = dataColumnIndex || 1;
  const maxRow = sheet.getLastRow();
  if (maxRow < 2) return 1;
  const values = sheet.getRange(2, col, maxRow - 1, 1).getValues();
  let last = 1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i][0];
    if (v !== '' && v !== null && v !== undefined) last = i + 2;
  }
  return last;
}

/**
 * シートの末尾(実データの最終行+1)に1行を追記する。
 * sheet.appendRow() は内部で getLastRow() を使うため、
 * insertCheckboxes() などで全行に値があると判定される場合に
 * 想定外の遠い行へ書き込んでしまう。これを避けるため、ID列の
 * 実データ最終行 + 1 へ setValues で書き込む。
 *
 * @param {Sheet} sheet
 * @param {Array} row 1行分の配列
 * @param {number=} idColumnIndex 実データ判定に使う列(既定: 1)
 */
function appendDataRow_(sheet, row, idColumnIndex) {
  const startRow = getLastDataRow_(sheet, idColumnIndex || 1) + 1;
  sheet.getRange(startRow, 1, 1, row.length).setValues([row]);
}

/**
 * イベント名・キー比較用のタイトル正規化。
 *  - 前後トリム
 *  - 連続する空白を1つに圧縮
 *  - 全角空白 → 半角空白
 *  - 小文字化
 *  - Unicode 互換正規化 (NFKC) で全角英数→半角など
 */
function normalizeTitle_(s) {
  let v = String(s == null ? '' : s);
  try { v = v.normalize('NFKC'); } catch (e) {}
  v = v.replace(/　/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return v;
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
