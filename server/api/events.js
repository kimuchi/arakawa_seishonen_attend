/**
 * api/events.js  イベント CRUD + 分類マスタ + ICS取込ルール (旧 50_Events_Api.gs)
 */
'use strict';

const sc = require('../sheets-client');
const { SHEET_NAMES } = require('../constants');
const { withLock, formatDate, formatTime } = require('../utils');

function rowToEvent(r) {
  return {
    id: Number(r['ID']),
    date: formatDate(r['日付']),
    startTime: typeof r['開始時刻'] === 'string' ? r['開始時刻'] : formatTime(r['開始時刻']),
    endTime: typeof r['終了時刻'] === 'string' ? r['終了時刻'] : formatTime(r['終了時刻']),
    allDay: r['終日'] === true || r['終日'] === 'TRUE',
    title: r['イベント名'] || '',
    category: r['分類'] || '',
    subcategory: r['サブ分類'] || '',
    dailyAllowance: r['日当対象'] === true || r['日当対象'] === 'TRUE',
    location: r['場所'] || '',
    note: r['備考'] || '',
    gCalendarId: r['GカレンダーID'] || '',
    gEventId: r['GイベントID'] || '',
    active: !(r['有効'] === false || r['有効'] === 'FALSE'),
  };
}

async function listEvents(filter = {}) {
  const { objects } = await sc.getSheetObjects(SHEET_NAMES.EVENTS);
  let events = objects.map(rowToEvent);
  if (!filter.includeInactive) events = events.filter(e => e.active !== false);
  if (filter.category) events = events.filter(e => e.category === filter.category);
  if (filter.subcategory) events = events.filter(e => e.subcategory === filter.subcategory);
  if (filter.dateFrom) events = events.filter(e => e.date >= filter.dateFrom);
  if (filter.dateTo) events = events.filter(e => e.date <= filter.dateTo);
  if (filter.allowanceOnly) events = events.filter(e => e.dailyAllowance === true);
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id - b.id)));
  return events;
}

async function addEvent(ev) {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.EVENTS);
    const id = sc.nextIdFromGrid(grid, 0);
    const row = [
      id, ev.date || '',
      ev.startTime || '', ev.endTime || '',
      !!ev.allDay,
      ev.title || '', ev.category || 'その他', ev.subcategory || '',
      !!ev.dailyAllowance,
      ev.location || '', ev.note || '',
      ev.gCalendarId || '', ev.gEventId || '',
      ev.active !== false,
    ];
    await sc.appendRowAfterGrid(SHEET_NAMES.EVENTS, grid, row, 0);
    return { id };
  });
}

async function updateEvent(ev) {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.EVENTS);
    const rowIdx = sc.findRowIndexById(grid, 0, ev.id);
    if (rowIdx < 0) throw new Error('該当イベントが見つかりません: ID=' + ev.id);
    const row = [
      ev.id, ev.date || '',
      ev.startTime || '', ev.endTime || '',
      !!ev.allDay,
      ev.title || '', ev.category || 'その他', ev.subcategory || '',
      !!ev.dailyAllowance,
      ev.location || '', ev.note || '',
      ev.gCalendarId || '', ev.gEventId || '',
      ev.active !== false,
    ];
    await sc.updateValues(sc.rangeFor(SHEET_NAMES.EVENTS, rowIdx, 1, 1, row.length), [row]);
    return { ok: true };
  });
}

async function deleteEvent(eventId) {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.EVENTS);
    const rowIdx = sc.findRowIndexById(grid, 0, eventId);
    if (rowIdx < 0) throw new Error('該当イベントが見つかりません。');
    const sheetId = await sc.getSheetIdByName(SHEET_NAMES.EVENTS);
    await sc.batchUpdate([{
      deleteDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: rowIdx - 1, endIndex: rowIdx },
      },
    }]);
    // 関連する出席行も削除
    const attGrid = await sc.getSheetGrid(SHEET_NAMES.ATTENDANCE);
    const attSheetId = await sc.getSheetIdByName(SHEET_NAMES.ATTENDANCE);
    if (attGrid.length >= 2 && attSheetId != null) {
      const toDelete = [];
      for (let i = 1; i < attGrid.length; i++) {
        if (Number(attGrid[i][1]) === Number(eventId)) toDelete.push(i);
      }
      const reqs = toDelete.sort((a, b) => b - a).map(i => ({
        deleteDimension: {
          range: { sheetId: attSheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 },
        },
      }));
      if (reqs.length > 0) await sc.batchUpdate(reqs);
    }
    return { ok: true };
  });
}

// ---------- 分類マスタ ----------
async function listClassifications() {
  const { objects } = await sc.getSheetObjects(SHEET_NAMES.CLASSIFICATION);
  return objects
    .filter(r => r['有効'] !== false && r['有効'] !== 'FALSE')
    .map(r => ({
      id: Number(r['ID']),
      category: r['分類'] || '',
      subcategory: r['サブ分類'] || '',
      defaultAllowance: r['日当対象デフォルト'] === true || r['日当対象デフォルト'] === 'TRUE',
      order: Number(r['表示順']) || 0,
    }))
    .sort((a, b) => a.order - b.order);
}

async function listClassificationsAll() {
  const { objects } = await sc.getSheetObjects(SHEET_NAMES.CLASSIFICATION);
  return objects.map(r => ({
    id: Number(r['ID']),
    category: r['分類'] || '',
    subcategory: r['サブ分類'] || '',
    defaultAllowance: r['日当対象デフォルト'] === true || r['日当対象デフォルト'] === 'TRUE',
    order: Number(r['表示順']) || 0,
    active: !(r['有効'] === false || r['有効'] === 'FALSE'),
  })).sort((a, b) => (a.order - b.order) || (a.id - b.id));
}

async function addClassification(item) {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.CLASSIFICATION);
    const id = sc.nextIdFromGrid(grid, 0);
    const order = Number(item.order) || (id * 10);
    const row = [
      id, item.category || '', item.subcategory || '',
      !!item.defaultAllowance, order, item.active !== false,
    ];
    await sc.appendRowAfterGrid(SHEET_NAMES.CLASSIFICATION, grid, row, 0);
    return { id };
  });
}

async function updateClassification(item) {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.CLASSIFICATION);
    const rowIdx = sc.findRowIndexById(grid, 0, item.id);
    if (rowIdx < 0) throw new Error('該当分類が見つかりません: ID=' + item.id);
    const row = [
      item.id, item.category || '', item.subcategory || '',
      !!item.defaultAllowance, Number(item.order) || 0, item.active !== false,
    ];
    await sc.updateValues(sc.rangeFor(SHEET_NAMES.CLASSIFICATION, rowIdx, 1, 1, row.length), [row]);
    return { ok: true };
  });
}

async function deleteClassification(id) {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.CLASSIFICATION);
    const rowIdx = sc.findRowIndexById(grid, 0, id);
    if (rowIdx < 0) throw new Error('該当分類が見つかりません。');
    const sheetId = await sc.getSheetIdByName(SHEET_NAMES.CLASSIFICATION);
    await sc.batchUpdate([{
      deleteDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: rowIdx - 1, endIndex: rowIdx },
      },
    }]);
    return { ok: true };
  });
}

async function reorderClassifications(orderedIds) {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.CLASSIFICATION);
    const reqs = [];
    (orderedIds || []).forEach((id, idx) => {
      const rowIdx = sc.findRowIndexById(grid, 0, id);
      if (rowIdx > 0) {
        // 表示順は5列目 (1-based) → A1の `E{rowIdx}`
        reqs.push({
          range: sc.rangeFor(SHEET_NAMES.CLASSIFICATION, rowIdx, 5, 1, 1),
          values: [[(idx + 1) * 10]],
        });
      }
    });
    // 並列で更新
    for (const r of reqs) {
      await sc.updateValues(r.range, r.values);
    }
    return { ok: true };
  });
}

// ---------- ICS取込ルール ----------
async function listIcsRules() {
  const { objects } = await sc.getSheetObjects(SHEET_NAMES.ICS_RULES);
  return objects.map(r => ({
    id: Number(r['ID']),
    pattern: r['パターン'] || '',
    matchType: r['マッチタイプ'] || 'contains',
    category: r['分類'] || '',
    subcategory: r['サブ分類'] || '',
    defaultAllowance: r['日当対象デフォルト'] === true || r['日当対象デフォルト'] === 'TRUE',
    order: Number(r['表示順']) || 0,
    active: !(r['有効'] === false || r['有効'] === 'FALSE'),
  })).sort((a, b) => (a.order - b.order) || (a.id - b.id));
}

async function addIcsRule(item) {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.ICS_RULES);
    const id = sc.nextIdFromGrid(grid, 0);
    const order = Number(item.order) || (id * 10);
    const row = [
      id, item.pattern || '', item.matchType || 'contains',
      item.category || '', item.subcategory || '',
      !!item.defaultAllowance, order, item.active !== false,
    ];
    await sc.appendRowAfterGrid(SHEET_NAMES.ICS_RULES, grid, row, 0);
    return { id };
  });
}

async function updateIcsRule(item) {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.ICS_RULES);
    const rowIdx = sc.findRowIndexById(grid, 0, item.id);
    if (rowIdx < 0) throw new Error('該当ルールが見つかりません: ID=' + item.id);
    const row = [
      item.id, item.pattern || '', item.matchType || 'contains',
      item.category || '', item.subcategory || '',
      !!item.defaultAllowance, Number(item.order) || 0, item.active !== false,
    ];
    await sc.updateValues(sc.rangeFor(SHEET_NAMES.ICS_RULES, rowIdx, 1, 1, row.length), [row]);
    return { ok: true };
  });
}

async function deleteIcsRule(id) {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.ICS_RULES);
    const rowIdx = sc.findRowIndexById(grid, 0, id);
    if (rowIdx < 0) throw new Error('該当ルールが見つかりません。');
    const sheetId = await sc.getSheetIdByName(SHEET_NAMES.ICS_RULES);
    await sc.batchUpdate([{
      deleteDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: rowIdx - 1, endIndex: rowIdx },
      },
    }]);
    return { ok: true };
  });
}

async function reorderIcsRules(orderedIds) {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.ICS_RULES);
    for (let i = 0; i < (orderedIds || []).length; i++) {
      const id = orderedIds[i];
      const rowIdx = sc.findRowIndexById(grid, 0, id);
      if (rowIdx > 0) {
        await sc.updateValues(sc.rangeFor(SHEET_NAMES.ICS_RULES, rowIdx, 7, 1, 1), [[(i + 1) * 10]]);
      }
    }
    return { ok: true };
  });
}

module.exports = {
  listEvents, addEvent, updateEvent, deleteEvent,
  listClassifications, listClassificationsAll, addClassification, updateClassification, deleteClassification, reorderClassifications,
  listIcsRules, addIcsRule, updateIcsRule, deleteIcsRule, reorderIcsRules,
};
