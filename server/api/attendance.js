/**
 * api/attendance.js  出席 CRUD (旧 60_Attendance_Api.gs)
 */
'use strict';

const sc = require('../sheets-client');
const { SHEET_NAMES } = require('../constants');
const { withLock } = require('../utils');

async function getEventAttendance(eventId) {
  const grid = await sc.getSheetGrid(SHEET_NAMES.ATTENDANCE);
  const result = {};
  for (let i = 1; i < grid.length; i++) {
    const row = grid[i];
    if (Number(row[1]) === Number(eventId)) {
      result[Number(row[2])] = row[3] || '';
    }
  }
  return result;
}

async function getMemberAttendance(memberId) {
  const grid = await sc.getSheetGrid(SHEET_NAMES.ATTENDANCE);
  const result = {};
  for (let i = 1; i < grid.length; i++) {
    const row = grid[i];
    if (Number(row[2]) === Number(memberId)) {
      result[Number(row[1])] = row[3] || '';
    }
  }
  return result;
}

function findAttendanceRowIndex(grid, eventId, memberId) {
  for (let i = 1; i < grid.length; i++) {
    if (Number(grid[i][1]) === Number(eventId) && Number(grid[i][2]) === Number(memberId)) {
      return i + 1; // A1 row number
    }
  }
  return -1;
}

async function setAttendance({ eventId, memberId, status }, user = '') {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.ATTENDANCE);
    const rowIdx = findAttendanceRowIndex(grid, eventId, memberId);
    if (!status) {
      if (rowIdx > 0) {
        const sheetId = await sc.getSheetIdByName(SHEET_NAMES.ATTENDANCE);
        await sc.batchUpdate([{
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: rowIdx - 1, endIndex: rowIdx },
          },
        }]);
      }
      return { ok: true };
    }
    const now = new Date().toISOString();
    if (rowIdx > 0) {
      await sc.updateValues(sc.rangeFor(SHEET_NAMES.ATTENDANCE, rowIdx, 4, 1, 3), [[status, user, now]]);
    } else {
      const id = sc.nextIdFromGrid(grid, 0);
      const row = [id, Number(eventId), Number(memberId), status, user, now, ''];
      await sc.appendRowAfterGrid(SHEET_NAMES.ATTENDANCE, grid, row, 0);
    }
    return { ok: true };
  });
}

async function bulkSetAttendance(eventId, entries, user = '') {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.ATTENDANCE);

    // 既存の (eventId, memberId) → rowIdx を構築
    const existing = {};
    for (let i = 1; i < grid.length; i++) {
      if (Number(grid[i][1]) === Number(eventId)) {
        existing[Number(grid[i][2])] = i + 1;
      }
    }

    const now = new Date().toISOString();
    const sheetId = await sc.getSheetIdByName(SHEET_NAMES.ATTENDANCE);

    const toAppend = [];
    const toDelete = [];
    const toUpdate = [];
    let nextId = sc.nextIdFromGrid(grid, 0);

    (entries || []).forEach(e => {
      const memberId = Number(e.memberId);
      const status = e.status || '';
      const rowIdx = existing[memberId];
      if (!status) {
        if (rowIdx) toDelete.push(rowIdx);
      } else {
        if (rowIdx) toUpdate.push({ rowIdx, status });
        else toAppend.push([nextId++, Number(eventId), memberId, status, user, now, '']);
      }
    });

    // 削除 (行番号大きい順)
    const delReqs = toDelete.sort((a, b) => b - a).map(rowIdx => ({
      deleteDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: rowIdx - 1, endIndex: rowIdx },
      },
    }));
    if (delReqs.length > 0) await sc.batchUpdate(delReqs);

    // 更新
    for (const u of toUpdate) {
      await sc.updateValues(sc.rangeFor(SHEET_NAMES.ATTENDANCE, u.rowIdx, 4, 1, 3), [[u.status, user, now]]);
    }

    // 追加 (まとめて末尾追記)
    if (toAppend.length > 0) {
      // 削除後の grid は変わるが、appendValues は実際の末尾に追記してくれる
      await sc.appendValues(`'${SHEET_NAMES.ATTENDANCE}'!A:G`, toAppend);
    }

    return { updated: toUpdate.length, added: toAppend.length, deleted: toDelete.length };
  });
}

module.exports = { getEventAttendance, getMemberAttendance, setAttendance, bulkSetAttendance };
