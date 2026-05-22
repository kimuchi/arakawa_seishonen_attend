/**
 * importer.js  ICS取込 + 分類推定 + 重複除去 (旧 20_Importer.gs)
 */
'use strict';

const sc = require('./sheets-client');
const config = require('./config');
const { SHEET_NAMES, INITIAL_ICS_RULES } = require('./constants');
const { withLock, formatDate, formatTime, parseDate, normalizeTitle } = require('./utils');

function getConfiguredIcsUrl() {
  const cfg = config.loadConfig();
  if (!cfg || !cfg.icsImportUrl) {
    throw new Error('設定画面で ICS取込URL を設定してください。');
  }
  return cfg.icsImportUrl;
}

async function importFromConfiguredIcs(startDateStr, endDateStr, options) {
  const icsUrl = getConfiguredIcsUrl();
  return importFromIcsUrl(icsUrl, startDateStr, endDateStr, options);
}

async function importFromIcsUrl(icsUrl, startDateStr, endDateStr, options = {}) {
  if (!icsUrl) throw new Error('ICSのURLを指定してください。');
  const start = parseDate(startDateStr);
  const end = parseDate(endDateStr);
  if (!start || !end) throw new Error('開始日・終了日を yyyy-MM-dd 形式で指定してください。');

  const resp = await fetch(icsUrl, { redirect: 'follow' });
  if (!resp.ok) throw new Error('ICSの取得に失敗: ' + resp.status);
  const text = await resp.text();
  const parsed = parseIcs(text);
  const filtered = parsed.filter(ev => {
    const s = ev.startTime.getTime();
    return s >= start.getTime() && s <= end.getTime() + 24 * 60 * 60 * 1000;
  }).map(ev => {
    ev.gCalendarId = icsUrl;
    return ev;
  });
  return insertEvents(filtered, options);
}

async function insertEvents(eventList, options = {}) {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.EVENTS);
    // 既存重複チェック用
    const existingIds = {};
    const existingDateTitle = {};
    for (let i = 1; i < grid.length; i++) {
      const row = grid[i];
      const gid = String(row[12] || '').trim();
      if (gid) existingIds[gid] = true;
      const date = formatDate(row[1]);
      const title = normalizeTitle(row[5]);
      if (date && title) existingDateTitle[date + '|' + title] = true;
    }
    let nextId = sc.nextIdFromGrid(grid, 0);
    const defaultAllowance = options.defaultAllowance !== undefined ? !!options.defaultAllowance : false;
    const autoClassify = options.autoClassify !== false;
    const rows = [];
    const imported = [];
    let skipped = 0;
    const batchGid = {};
    const batchKey = {};

    const rules = await loadIcsRules();

    for (const ev of eventList) {
      const gid = String(ev.gEventId || '').trim();
      if (gid && existingIds[gid]) { skipped++; continue; }
      if (gid && batchGid[gid]) { skipped++; continue; }
      const eventDate = formatDate(ev.startTime);
      const titleRaw = ev.title || '(無題)';
      const titleNorm = normalizeTitle(titleRaw);
      const dupKey = eventDate + '|' + titleNorm;
      if (existingDateTitle[dupKey]) { skipped++; continue; }
      if (batchKey[dupKey]) { skipped++; continue; }
      const classify = autoClassify
        ? classifyByRules(titleRaw, rules)
        : { category: 'その他', subcategory: 'その他', dailyAllowance: defaultAllowance };
      const row = [
        nextId++, eventDate,
        ev.allDay ? '' : formatTime(ev.startTime),
        ev.allDay ? '' : formatTime(ev.endTime),
        !!ev.allDay,
        titleRaw,
        classify.category,
        classify.subcategory,
        classify.dailyAllowance !== undefined ? classify.dailyAllowance : defaultAllowance,
        ev.location || '', ev.description || '',
        ev.gCalendarId || '', gid, true,
      ];
      rows.push(row);
      existingDateTitle[dupKey] = true;
      batchKey[dupKey] = true;
      if (gid) batchGid[gid] = true;
      imported.push({
        id: row[0], date: row[1], title: row[5], category: row[6], subcategory: row[7],
      });
    }

    if (rows.length > 0) {
      await sc.appendValues(`'${SHEET_NAMES.EVENTS}'!A:N`, rows);
    }
    return { imported: rows.length, skipped, events: imported };
  });
}

async function dedupExistingEvents() {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.EVENTS);
    if (grid.length < 2) return { removed: 0, kept: 0 };

    const seenKey = {};
    const seenGid = {};
    const removeIds = [];
    const keptRows = [];
    for (let i = 1; i < grid.length; i++) {
      const row = grid[i];
      const id = Number(row[0]);
      if (!id) continue;
      const date = formatDate(row[1]);
      const title = normalizeTitle(row[5]);
      const gid = String(row[12] || '').trim();
      const key = date + '|' + title;
      if (gid && seenGid[gid]) { removeIds.push(id); continue; }
      if (date && title && seenKey[key]) { removeIds.push(id); continue; }
      if (gid) seenGid[gid] = true;
      if (date && title) seenKey[key] = true;
      keptRows.push(row);
    }
    if (removeIds.length === 0) return { removed: 0, kept: keptRows.length };

    // データ部分をクリアして再書き込み
    const sheetId = await sc.getSheetIdByName(SHEET_NAMES.EVENTS);
    await sc.clearRange(`'${SHEET_NAMES.EVENTS}'!A2:N`);
    if (keptRows.length > 0) {
      await sc.updateValues(sc.rangeFor(SHEET_NAMES.EVENTS, 2, 1, keptRows.length, 14), keptRows);
    }
    // 関連する出席行を削除
    const attGrid = await sc.getSheetGrid(SHEET_NAMES.ATTENDANCE);
    const attSheetId = await sc.getSheetIdByName(SHEET_NAMES.ATTENDANCE);
    if (attGrid.length >= 2 && attSheetId != null) {
      const removeSet = new Set(removeIds.map(Number));
      const toDelete = [];
      for (let i = 1; i < attGrid.length; i++) {
        if (removeSet.has(Number(attGrid[i][1]))) toDelete.push(i);
      }
      const reqs = toDelete.sort((a, b) => b - a).map(i => ({
        deleteDimension: {
          range: { sheetId: attSheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 },
        },
      }));
      if (reqs.length > 0) await sc.batchUpdate(reqs);
    }
    return { removed: removeIds.length, kept: keptRows.length };
  });
}

async function loadIcsRules() {
  try {
    const { objects } = await sc.getSheetObjects(SHEET_NAMES.ICS_RULES);
    if (objects.length > 0) {
      const rules = objects.map(r => ({
        pattern: String(r['パターン'] || ''),
        matchType: String(r['マッチタイプ'] || 'contains'),
        category: String(r['分類'] || ''),
        subcategory: String(r['サブ分類'] || ''),
        defaultAllowance: r['日当対象デフォルト'] === true || r['日当対象デフォルト'] === 'TRUE',
        order: Number(r['表示順']) || 0,
        active: !(r['有効'] === false || r['有効'] === 'FALSE'),
      })).sort((a, b) => a.order - b.order);
      return rules;
    }
  } catch (e) { /* ignore */ }
  return INITIAL_ICS_RULES.map(r => ({
    pattern: r.pattern,
    matchType: r.matchType || 'contains',
    category: r.category,
    subcategory: r.subcategory,
    defaultAllowance: !!r.defaultAllowance,
    order: 0,
    active: true,
  }));
}

function classifyByRules(name, rules) {
  const n = String(name || '');
  for (const r of rules) {
    if (!r.active) continue;
    if (!r.pattern) continue;
    let hit = false;
    if (r.matchType === 'regex') {
      try {
        const re = new RegExp(r.pattern);
        hit = re.test(n);
      } catch (e) { hit = false; }
    } else {
      hit = n.indexOf(r.pattern) >= 0;
    }
    if (hit) {
      return {
        category: r.category || 'その他',
        subcategory: r.subcategory || '',
        dailyAllowance: !!r.defaultAllowance,
      };
    }
  }
  return { category: 'その他', subcategory: 'その他', dailyAllowance: false };
}

async function previewClassification(name) {
  const rules = await loadIcsRules();
  return classifyByRules(name, rules);
}

// ---------- ICSパーサ ----------
function parseIcs(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === 'BEGIN:VEVENT') {
      cur = {};
    } else if (line === 'END:VEVENT') {
      if (cur) {
        const parsed = toParsedEvent(cur);
        if (parsed) events.push(parsed);
      }
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      let key = line.substring(0, idx);
      const value = line.substring(idx + 1);
      const semi = key.indexOf(';');
      const params = {};
      if (semi >= 0) {
        const paramPart = key.substring(semi + 1);
        key = key.substring(0, semi);
        paramPart.split(';').forEach(p => {
          const eq = p.indexOf('=');
          if (eq >= 0) params[p.substring(0, eq)] = p.substring(eq + 1);
        });
      }
      cur[key] = { value, params };
    }
  }
  return events;
}

function toParsedEvent(raw) {
  const dtstart = raw['DTSTART'];
  const dtend = raw['DTEND'] || raw['DTSTART'];
  if (!dtstart) return null;
  const allDay = (dtstart.params && dtstart.params['VALUE'] === 'DATE');
  const startTime = icsDateToDate(dtstart.value, dtstart.params, allDay);
  const endTime = icsDateToDate(dtend.value, dtend.params, allDay) || startTime;
  if (!startTime) return null;
  return {
    gEventId: raw['UID'] ? raw['UID'].value : '',
    title: raw['SUMMARY'] ? unescapeIcsText(raw['SUMMARY'].value) : '',
    location: raw['LOCATION'] ? unescapeIcsText(raw['LOCATION'].value) : '',
    description: raw['DESCRIPTION'] ? unescapeIcsText(raw['DESCRIPTION'].value) : '',
    startTime,
    endTime,
    allDay,
  };
}

function icsDateToDate(v, params, allDay) {
  if (!v) return null;
  const s = String(v).trim();
  if (allDay) {
    if (s.length < 8) return null;
    const y = parseInt(s.substring(0, 4), 10);
    const m = parseInt(s.substring(4, 6), 10) - 1;
    const d = parseInt(s.substring(6, 8), 10);
    return new Date(y, m, d);
  }
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const hh = parseInt(m[4], 10);
  const mm = parseInt(m[5], 10);
  const ss = parseInt(m[6], 10);
  if (m[7] === 'Z') {
    return new Date(Date.UTC(y, mo, d, hh, mm, ss));
  }
  return new Date(y, mo, d, hh, mm, ss);
}

function unescapeIcsText(s) {
  return String(s || '')
    .replace(/\\n/g, '\n')
    .replace(/\\N/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

module.exports = {
  importFromConfiguredIcs,
  importFromIcsUrl,
  dedupExistingEvents,
  previewClassification,
};
