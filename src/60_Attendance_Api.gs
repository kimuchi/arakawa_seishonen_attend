/**
 * 60_Attendance_Api.gs
 * 出席データのCRUD。
 * 縦持ちテーブル: (イベントID, メンバID) のペアでユニーク。
 *
 * パフォーマンス上の注意:
 *  - レコード数の概算: 36名 × 約90イベント = 約3,240行/年度。GAS+Sheetsで充分扱える規模。
 *  - 一括更新API api_bulkSetAttendance を用意し、1イベント分を一括で書き戻せるようにする。
 */

/**
 * 指定イベントの出席データを取得。
 * イベントIDを渡すとメンバIDごとの出席区分を返す。
 * @param {number} eventId
 * @return {{ok:boolean, data:object|null}}  data: { [memberId]: '出席'|'欠席'|'' }
 */
function api_getEventAttendance(eventId) {
  try {
    const sheet = getSheet_(SHEET_NAMES.ATTENDANCE);
    if (!sheet) return { ok: true, data: {} };
    const rows = sheetToObjects_(sheet);
    const result = {};
    rows.forEach(r => {
      if (Number(r['イベントID']) === Number(eventId)) {
        result[Number(r['メンバID'])] = r['出席区分'] || '';
      }
    });
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 指定メンバの年度全体の出席データを取得。
 * @return {{ok:boolean, data:object}} data: { [eventId]: '出席'|'欠席'|'' }
 */
function api_getMemberAttendance(memberId) {
  try {
    const sheet = getSheet_(SHEET_NAMES.ATTENDANCE);
    if (!sheet) return { ok: true, data: {} };
    const rows = sheetToObjects_(sheet);
    const result = {};
    rows.forEach(r => {
      if (Number(r['メンバID']) === Number(memberId)) {
        result[Number(r['イベントID'])] = r['出席区分'] || '';
      }
    });
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 単一の出席レコードを設定(出席/欠席/空の切替)。
 * 空("")を渡すと該当レコードを削除する。
 */
function api_setAttendance(eventId, memberId, status) {
  try {
    return withLock_(() => {
      const sheet = getSheet_(SHEET_NAMES.ATTENDANCE);
      const rowIdx = findAttendanceRow_(sheet, eventId, memberId);
      if (!status) {
        // 削除
        if (rowIdx > 0) sheet.deleteRow(rowIdx);
        return { ok: true };
      }
      const now = new Date();
      const user = getCurrentUserEmail_();
      if (rowIdx > 0) {
        sheet.getRange(rowIdx, 4, 1, 3).setValues([[status, user, now]]);
      } else {
        const id = generateNextId_(sheet, 1);
        sheet.appendRow([id, Number(eventId), Number(memberId), status, user, now, '']);
      }
      return { ok: true };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 1イベント分をまとめて更新。画面で〇/×を編集してから一括保存するのに使う。
 * @param {number} eventId
 * @param {Array<{memberId:number, status:string}>} entries
 */
function api_bulkSetAttendance(eventId, entries) {
  try {
    return withLock_(() => {
      const sheet = getSheet_(SHEET_NAMES.ATTENDANCE);
      if (!sheet) throw new Error('出席シートがありません。');
      const now = new Date();
      const user = getCurrentUserEmail_();

      // 既存レコードのマップを作る
      const allValues = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues() : [];
      const existing = {}; // key: eventId-memberId => rowIdx(1-based, シート上)
      for (let i = 0; i < allValues.length; i++) {
        const row = allValues[i];
        if (Number(row[1]) === Number(eventId)) {
          existing[Number(row[2])] = i + 2;
        }
      }

      // 更新・追加・削除リストを作る
      const toAppend = [];
      const toDelete = []; // 行番号(大きい順に削除)
      const toUpdate = []; // {rowIdx, status}

      let nextId = generateNextId_(sheet, 1);

      entries.forEach(e => {
        const memberId = Number(e.memberId);
        const status = e.status || '';
        const rowIdx = existing[memberId];
        if (!status) {
          if (rowIdx) toDelete.push(rowIdx);
        } else {
          if (rowIdx) {
            toUpdate.push({ rowIdx: rowIdx, status: status });
          } else {
            toAppend.push([nextId++, Number(eventId), memberId, status, user, now, '']);
          }
        }
      });

      // 削除は末尾から順に
      toDelete.sort((a, b) => b - a).forEach(idx => sheet.deleteRow(idx));

      // 更新
      toUpdate.forEach(u => {
        sheet.getRange(u.rowIdx, 4, 1, 3).setValues([[u.status, user, now]]);
      });

      // 追加
      if (toAppend.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, 7).setValues(toAppend);
      }

      return { ok: true, data: { updated: toUpdate.length, added: toAppend.length, deleted: toDelete.length } };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function findAttendanceRow_(sheet, eventId, memberId) {
  if (sheet.getLastRow() < 2) return -1;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  for (let i = 0; i < values.length; i++) {
    if (Number(values[i][1]) === Number(eventId) && Number(values[i][2]) === Number(memberId)) {
      return i + 2;
    }
  }
  return -1;
}
