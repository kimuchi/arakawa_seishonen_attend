/**
 * utils.js
 * 共通ユーティリティ (旧 99_Utils.gs の移植)。
 */
'use strict';

function formatDate(d) {
  if (!d && d !== 0) return '';
  if (typeof d === 'string') {
    // YYYY-MM-DD or YYYY/MM/DD で始まる場合はそのまま整形
    const m = d.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) {
      return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
    }
  }
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  // Asia/Tokyo (JST固定 +09:00)
  const tzOffsetMs = 9 * 60 * 60 * 1000;
  const t = new Date(date.getTime() + tzOffsetMs);
  const y = t.getUTCFullYear();
  const mo = String(t.getUTCMonth() + 1).padStart(2, '0');
  const da = String(t.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function formatTime(d) {
  if (!d && d !== 0) return '';
  if (typeof d === 'string') {
    const m = d.match(/^(\d{2}):(\d{2})/);
    if (m) return m[1] + ':' + m[2];
  }
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  const tzOffsetMs = 9 * 60 * 60 * 1000;
  const t = new Date(date.getTime() + tzOffsetMs);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function parseDate(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  const parts = String(s).split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function normalizeTitle(s) {
  let v = String(s == null ? '' : s);
  try { v = v.normalize('NFKC'); } catch (e) { /* noop */ }
  v = v.replace(/　/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return v;
}

/**
 * 値を Sheets 用の表現に変換。
 * - Date は ISO 文字列
 * - undefined/null は空文字
 * その他はそのまま。
 */
function toCellValue(v) {
  if (v === undefined || v === null) return '';
  if (v instanceof Date) return v.toISOString();
  return v;
}

/**
 * 二次元配列の最後の非空行インデックスを返す (0始まり)。
 * 全行空なら -1。
 */
function lastDataRowIndex(rows, colIdx = 0) {
  let last = -1;
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i][colIdx];
    if (v !== '' && v !== null && v !== undefined) last = i;
  }
  return last;
}

/**
 * 単純な逐次実行ロック (in-process)。Express の単一プロセス前提。
 * Cloud Run の concurrency=1 でも安全に動く。
 */
class Mutex {
  constructor() {
    this._chain = Promise.resolve();
  }
  run(fn) {
    const p = this._chain.then(() => fn());
    // 例外時もチェーンを断たない
    this._chain = p.catch(() => {});
    return p;
  }
}

const sheetMutex = new Mutex();
function withLock(fn) {
  return sheetMutex.run(fn);
}

module.exports = {
  formatDate,
  formatTime,
  parseDate,
  normalizeTitle,
  toCellValue,
  lastDataRowIndex,
  withLock,
};
