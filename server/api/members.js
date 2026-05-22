/**
 * api/members.js  メンバ CRUD (旧 40_Members_Api.gs)
 */
'use strict';

const sc = require('../sheets-client');
const { SHEET_NAMES } = require('../constants');
const { withLock } = require('../utils');

async function listMembers() {
  const { objects } = await sc.getSheetObjects(SHEET_NAMES.MEMBERS);
  const members = objects
    .filter(r => r['有効'] !== false && r['有効'] !== 'FALSE')
    .map(r => ({
      id: Number(r['ID']),
      no: Number(r['No']) || null,
      district: r['地区'] || '',
      name: r['氏名'] || '',
      term: r['期'] || '',
      role: r['役職'] || '',
      jissen: r['実践部会'] || '',
      senmon: r['専門部会'] || '',
      note: r['備考'] || '',
    }))
    .sort((a, b) => (a.no || 9999) - (b.no || 9999));
  return members;
}

async function addMember(member) {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.MEMBERS);
    const id = sc.nextIdFromGrid(grid, 0);
    const row = [
      id,
      member.no || '',
      member.district || '',
      member.name || '',
      member.term || '',
      member.role || '',
      member.jissen || '-',
      member.senmon || '-',
      true,
      member.note || '',
    ];
    await sc.appendRowAfterGrid(SHEET_NAMES.MEMBERS, grid, row, 0);
    return { id };
  });
}

async function updateMember(member) {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.MEMBERS);
    const rowIdx = sc.findRowIndexById(grid, 0, member.id);
    if (rowIdx < 0) throw new Error('該当メンバが見つかりません: ID=' + member.id);
    const row = [
      member.id,
      member.no || '',
      member.district || '',
      member.name || '',
      member.term || '',
      member.role || '',
      member.jissen || '-',
      member.senmon || '-',
      member.active !== false,
      member.note || '',
    ];
    await sc.updateValues(sc.rangeFor(SHEET_NAMES.MEMBERS, rowIdx, 1, 1, row.length), [row]);
    return { ok: true };
  });
}

async function deleteMember(memberId) {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.MEMBERS);
    const rowIdx = sc.findRowIndexById(grid, 0, memberId);
    if (rowIdx < 0) throw new Error('該当メンバが見つかりません。');
    const sheetId = await sc.getSheetIdByName(SHEET_NAMES.MEMBERS);
    await sc.batchUpdate([{
      deleteDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: rowIdx - 1, endIndex: rowIdx },
      },
    }]);
    // 出席シートの関連行を削除
    const attGrid = await sc.getSheetGrid(SHEET_NAMES.ATTENDANCE);
    const attSheetId = await sc.getSheetIdByName(SHEET_NAMES.ATTENDANCE);
    if (attGrid.length >= 2 && attSheetId != null) {
      // 末尾から削除して行番号のずれを防ぐ
      const toDelete = [];
      for (let i = 1; i < attGrid.length; i++) {
        if (Number(attGrid[i][2]) === Number(memberId)) toDelete.push(i);
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

module.exports = { listMembers, addMember, updateMember, deleteMember };
