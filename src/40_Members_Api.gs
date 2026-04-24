/**
 * 40_Members_Api.gs
 * メンバのCRUD。
 */

/**
 * メンバ一覧。有効フラグが明示的にfalseのもののみ除外（空や未設定は有効扱い）。
 */
function api_listMembers() {
  try {
    const sheet = getSheet_(SHEET_NAMES.MEMBERS);
    if (!sheet) throw new Error('メンバシートがありません。');
    const rows = sheetToObjects_(sheet);
    const members = rows
      .filter(r => r['有効'] !== false)
      .map(r => ({
        id: Number(r['ID']),
        no: Number(r['No']) || null,
        district: r['地区'] || '',
        name: r['氏名'] || '',
        term: r['期'] || '',
        role: r['役職'] || '',
        jissen: r['実践部会'] || '',
        senmon: r['専門部会'] || '',
        note: r['備考'] || ''
      }))
      .sort((a, b) => (a.no || 9999) - (b.no || 9999));
    return { ok: true, data: members };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function api_addMember(member) {
  try {
    return withLock_(() => {
      const sheet = getSheet_(SHEET_NAMES.MEMBERS);
      const id = generateNextId_(sheet, 1);
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
        member.note || ''
      ];
      sheet.appendRow(row);
      return { ok: true, data: { id: id } };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function api_updateMember(member) {
  try {
    return withLock_(() => {
      const sheet = getSheet_(SHEET_NAMES.MEMBERS);
      const rowIdx = findRowById_(sheet, 1, member.id);
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
        member.note || ''
      ];
      sheet.getRange(rowIdx, 1, 1, row.length).setValues([row]);
      return { ok: true };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * メンバの削除(物理)。出席データも合わせて掃除する。
 * 通常は無効化(active=false)の方が安全だが、UIから明示的な削除を選べるようにする。
 */
function api_deleteMember(memberId) {
  try {
    return withLock_(() => {
      const sheet = getSheet_(SHEET_NAMES.MEMBERS);
      const rowIdx = findRowById_(sheet, 1, memberId);
      if (rowIdx < 0) throw new Error('該当メンバが見つかりません。');
      sheet.deleteRow(rowIdx);
      // 出席シートから関連行を削除
      const att = getSheet_(SHEET_NAMES.ATTENDANCE);
      if (att && att.getLastRow() >= 2) {
        const values = att.getDataRange().getValues();
        // 先頭行はヘッダ
        for (let i = values.length - 1; i >= 1; i--) {
          if (Number(values[i][2]) === Number(memberId)) {
            att.deleteRow(i + 1);
          }
        }
      }
      return { ok: true };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
