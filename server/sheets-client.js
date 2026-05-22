/**
 * sheets-client.js
 * Google Sheets API および Drive API のラッパ。
 *  - 全シートをまるごとキャッシュ(短時間)し、頻繁な読み込みのコストを抑える。
 *  - ヘッダ行付きシートの「オブジェクトの配列」化や、IDによる行検索など、
 *    GAS版のヘルパ(99_Utils.gs)に近い API を提供する。
 */
'use strict';

const { google } = require('googleapis');
const config = require('./config');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

let _sheetsCache = null;
let _driveCache = null;
let _authCache = null;
let _credKey = null;

function getAuth() {
  const cfg = config.loadConfig();
  const creds = config.getGoogleCredentials(cfg);
  if (!creds) {
    throw new Error('Google認証情報が未設定です。設定画面で登録してください。');
  }
  const key = (creds.private_key || '') + '|' + (creds.client_email || '');
  if (_authCache && _credKey === key) return _authCache;
  _authCache = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: SCOPES,
  });
  _credKey = key;
  _sheetsCache = null;
  _driveCache = null;
  return _authCache;
}

function getSheetsApi() {
  if (_sheetsCache) return _sheetsCache;
  _sheetsCache = google.sheets({ version: 'v4', auth: getAuth() });
  return _sheetsCache;
}

function getDriveApi() {
  if (_driveCache) return _driveCache;
  _driveCache = google.drive({ version: 'v3', auth: getAuth() });
  return _driveCache;
}

function resetClients() {
  _authCache = null;
  _credKey = null;
  _sheetsCache = null;
  _driveCache = null;
}

function getSpreadsheetId() {
  const cfg = config.loadConfig();
  if (!cfg || !cfg.spreadsheetId) {
    throw new Error('スプレッドシートIDが未設定です。設定画面で登録してください。');
  }
  return cfg.spreadsheetId;
}

function getSpreadsheetUrl() {
  return `https://docs.google.com/spreadsheets/d/${getSpreadsheetId()}/edit`;
}

// ---------- 低レベル ----------

async function getSpreadsheetMeta(spreadsheetId) {
  const api = getSheetsApi();
  const res = await api.spreadsheets.get({
    spreadsheetId: spreadsheetId || getSpreadsheetId(),
    includeGridData: false,
  });
  return res.data;
}

async function getValues(rangeA1) {
  const api = getSheetsApi();
  const res = await api.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: rangeA1,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return res.data.values || [];
}

async function updateValues(rangeA1, values) {
  const api = getSheetsApi();
  await api.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: rangeA1,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

async function appendValues(rangeA1, values) {
  const api = getSheetsApi();
  await api.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: rangeA1,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
}

async function clearRange(rangeA1) {
  const api = getSheetsApi();
  await api.spreadsheets.values.clear({
    spreadsheetId: getSpreadsheetId(),
    range: rangeA1,
  });
}

async function batchUpdate(requests) {
  const api = getSheetsApi();
  const res = await api.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: { requests },
  });
  return res.data;
}

// ---------- 高レベル ----------

async function getSheetIdByName(name) {
  const meta = await getSpreadsheetMeta();
  const sh = (meta.sheets || []).find(s => s.properties && s.properties.title === name);
  return sh ? sh.properties.sheetId : null;
}

async function ensureSheetExists(name) {
  const meta = await getSpreadsheetMeta();
  const exists = (meta.sheets || []).some(s => s.properties && s.properties.title === name);
  if (exists) return;
  await batchUpdate([{ addSheet: { properties: { title: name } } }]);
}

async function deleteSheetIfExists(name) {
  const sheetId = await getSheetIdByName(name);
  if (sheetId == null) return;
  await batchUpdate([{ deleteSheet: { sheetId } }]);
}

/**
 * シート全体を二次元配列で取得。ヘッダ行 + データ行。
 */
async function getSheetGrid(name) {
  return getValues(`'${name}'`);
}

/**
 * ヘッダ行をキーにしたオブジェクト配列。
 * GAS 版 sheetToObjects_ に相当。
 */
async function getSheetObjects(name) {
  const grid = await getSheetGrid(name);
  if (!grid || grid.length < 2) return { headers: grid && grid[0] ? grid[0] : [], objects: [] };
  const headers = grid[0];
  const rows = grid.slice(1);
  const objects = rows.map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] === undefined ? '' : row[i]; });
    return obj;
  }).filter((o) => Object.values(o).some(v => v !== '' && v !== null && v !== undefined));
  return { headers, objects };
}

/**
 * 指定列(0始まり)で値が指定IDと一致する行の番号(2始まり, ヘッダ除外して2行目以降)を返す。
 */
function findRowIndexById(grid, colIdx, id) {
  for (let i = 1; i < grid.length; i++) {
    const v = grid[i][colIdx];
    if (v === '' || v === undefined || v === null) continue;
    if (Number(v) === Number(id)) return i + 1; // A1の行番号 (1始まり)
  }
  return -1;
}

/**
 * 指定列(0始まり)の最大値+1を返す。何もなければ1。
 */
function nextIdFromGrid(grid, colIdx) {
  let maxId = 0;
  for (let i = 1; i < grid.length; i++) {
    const v = Number(grid[i][colIdx]);
    if (!isNaN(v) && v > maxId) maxId = v;
  }
  return maxId + 1;
}

/**
 * 指定列の値が空でない最終行番号(1始まり)を返す。データが0行ならヘッダ行=1を返す。
 */
function lastDataRowFromGrid(grid, colIdx) {
  let last = 1;
  for (let i = 1; i < grid.length; i++) {
    const v = grid[i][colIdx];
    if (v !== '' && v !== null && v !== undefined) last = i + 1;
  }
  return last;
}

/**
 * A1表記のカラム名 (1=A, 27=AA ...) を生成。
 */
function colA1(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function rangeFor(sheet, row, col, numRows, numCols) {
  const c1 = colA1(col);
  const c2 = colA1(col + numCols - 1);
  return `'${sheet}'!${c1}${row}:${c2}${row + numRows - 1}`;
}

/**
 * 行を1行追記する。getSheetGrid を引数で受け取り、最終データ行+1 に setValues する。
 */
async function appendRowAfterGrid(sheetName, grid, row, idColIdx = 0) {
  const lastRow = lastDataRowFromGrid(grid, idColIdx);
  const startRow = lastRow + 1;
  await updateValues(
    rangeFor(sheetName, startRow, 1, 1, row.length),
    [row]
  );
  return startRow;
}

async function createNewSpreadsheet(title) {
  const api = getSheetsApi();
  const res = await api.spreadsheets.create({
    requestBody: {
      properties: {
        title: title || '2026年度荒川区青少年委員連絡会出席簿',
        locale: 'ja_JP',
        timeZone: 'Asia/Tokyo',
      },
    },
  });
  return res.data;
}

async function shareSpreadsheetWith(spreadsheetId, email, role = 'writer') {
  if (!email) return null;
  const drive = getDriveApi();
  const res = await drive.permissions.create({
    fileId: spreadsheetId,
    sendNotificationEmail: false,
    requestBody: {
      role,
      type: 'user',
      emailAddress: email,
    },
  });
  return res.data;
}

module.exports = {
  getAuth,
  getSheetsApi,
  getDriveApi,
  resetClients,
  getSpreadsheetId,
  getSpreadsheetUrl,
  getSpreadsheetMeta,
  getValues,
  updateValues,
  appendValues,
  clearRange,
  batchUpdate,
  getSheetIdByName,
  ensureSheetExists,
  deleteSheetIfExists,
  getSheetGrid,
  getSheetObjects,
  findRowIndexById,
  nextIdFromGrid,
  lastDataRowFromGrid,
  colA1,
  rangeFor,
  appendRowAfterGrid,
  createNewSpreadsheet,
  shareSpreadsheetWith,
};
