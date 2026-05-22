/**
 * 50_Events_Api.gs
 * イベントのCRUDと分類マスタの参照。
 */

/**
 * イベント一覧を取得。日付(昇順)で並び替え。
 * フィルタ: ?category, ?subcategory, ?dateFrom, ?dateTo, ?includeInactive
 */
function api_listEvents(filter) {
  filter = filter || {};
  try {
    const sheet = getSheet_(SHEET_NAMES.EVENTS);
    if (!sheet) throw new Error('イベントシートがありません。');
    const rows = sheetToObjects_(sheet);
    let events = rows.map(rowToEvent_);
    if (!filter.includeInactive) events = events.filter(e => e.active !== false);
    if (filter.category) events = events.filter(e => e.category === filter.category);
    if (filter.subcategory) events = events.filter(e => e.subcategory === filter.subcategory);
    if (filter.dateFrom) events = events.filter(e => e.date >= filter.dateFrom);
    if (filter.dateTo) events = events.filter(e => e.date <= filter.dateTo);
    if (filter.allowanceOnly) events = events.filter(e => e.dailyAllowance === true);
    events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id - b.id)));
    return { ok: true, data: events };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function rowToEvent_(r) {
  return {
    id: Number(r['ID']),
    date: formatDate_(r['日付']),
    startTime: r['開始時刻'] instanceof Date ? formatTime_(r['開始時刻']) : (r['開始時刻'] || ''),
    endTime: r['終了時刻'] instanceof Date ? formatTime_(r['終了時刻']) : (r['終了時刻'] || ''),
    allDay: r['終日'] === true,
    title: r['イベント名'] || '',
    category: r['分類'] || '',
    subcategory: r['サブ分類'] || '',
    dailyAllowance: r['日当対象'] === true,
    location: r['場所'] || '',
    note: r['備考'] || '',
    gCalendarId: r['GカレンダーID'] || '',
    gEventId: r['GイベントID'] || '',
    active: r['有効'] !== false
  };
}

function api_addEvent(ev) {
  try {
    return withLock_(() => {
      const sheet = getSheet_(SHEET_NAMES.EVENTS);
      const id = generateNextId_(sheet, 1);
      appendDataRow_(sheet, [
        id,
        ev.date || '',
        ev.startTime || '',
        ev.endTime || '',
        !!ev.allDay,
        ev.title || '',
        ev.category || 'その他',
        ev.subcategory || '',
        !!ev.dailyAllowance,
        ev.location || '',
        ev.note || '',
        ev.gCalendarId || '',
        ev.gEventId || '',
        ev.active !== false
      ], 1);
      return { ok: true, data: { id: id } };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function api_updateEvent(ev) {
  try {
    return withLock_(() => {
      const sheet = getSheet_(SHEET_NAMES.EVENTS);
      const rowIdx = findRowById_(sheet, 1, ev.id);
      if (rowIdx < 0) throw new Error('該当イベントが見つかりません: ID=' + ev.id);
      sheet.getRange(rowIdx, 1, 1, 14).setValues([[
        ev.id,
        ev.date || '',
        ev.startTime || '',
        ev.endTime || '',
        !!ev.allDay,
        ev.title || '',
        ev.category || 'その他',
        ev.subcategory || '',
        !!ev.dailyAllowance,
        ev.location || '',
        ev.note || '',
        ev.gCalendarId || '',
        ev.gEventId || '',
        ev.active !== false
      ]]);
      return { ok: true };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function api_deleteEvent(eventId) {
  try {
    return withLock_(() => {
      const sheet = getSheet_(SHEET_NAMES.EVENTS);
      const rowIdx = findRowById_(sheet, 1, eventId);
      if (rowIdx < 0) throw new Error('該当イベントが見つかりません。');
      sheet.deleteRow(rowIdx);
      // 関連する出席も削除
      const att = getSheet_(SHEET_NAMES.ATTENDANCE);
      if (att && att.getLastRow() >= 2) {
        const values = att.getDataRange().getValues();
        for (let i = values.length - 1; i >= 1; i--) {
          if (Number(values[i][1]) === Number(eventId)) {
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

/**
 * 分類マスタを取得（有効なもののみ、表示順）。
 */
function api_listClassifications() {
  try {
    const sheet = getSheet_(SHEET_NAMES.CLASSIFICATION);
    if (!sheet) return { ok: true, data: [] };
    const rows = sheetToObjects_(sheet);
    const data = rows
      .filter(r => r['有効'] !== false)
      .map(r => ({
        id: Number(r['ID']),
        category: r['分類'] || '',
        subcategory: r['サブ分類'] || '',
        defaultAllowance: r['日当対象デフォルト'] === true,
        order: Number(r['表示順']) || 0
      }))
      .sort((a, b) => a.order - b.order);
    return { ok: true, data: data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 分類マスタを全件取得（編集用に無効も含める）。
 */
function api_listClassificationsAll() {
  try {
    const sheet = getSheet_(SHEET_NAMES.CLASSIFICATION);
    if (!sheet) return { ok: true, data: [] };
    const rows = sheetToObjects_(sheet);
    const data = rows.map(r => ({
      id: Number(r['ID']),
      category: r['分類'] || '',
      subcategory: r['サブ分類'] || '',
      defaultAllowance: r['日当対象デフォルト'] === true,
      order: Number(r['表示順']) || 0,
      active: r['有効'] !== false
    })).sort((a, b) => (a.order - b.order) || (a.id - b.id));
    return { ok: true, data: data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function api_addClassification(item) {
  try {
    return withLock_(() => {
      const sheet = getSheet_(SHEET_NAMES.CLASSIFICATION);
      if (!sheet) throw new Error('分類マスタがありません。');
      const id = generateNextId_(sheet, 1);
      const order = Number(item.order) || (id * 10);
      appendDataRow_(sheet, [
        id,
        item.category || '',
        item.subcategory || '',
        !!item.defaultAllowance,
        order,
        item.active !== false
      ], 1);
      return { ok: true, data: { id: id } };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function api_updateClassification(item) {
  try {
    return withLock_(() => {
      const sheet = getSheet_(SHEET_NAMES.CLASSIFICATION);
      if (!sheet) throw new Error('分類マスタがありません。');
      const rowIdx = findRowById_(sheet, 1, item.id);
      if (rowIdx < 0) throw new Error('該当分類が見つかりません: ID=' + item.id);
      sheet.getRange(rowIdx, 1, 1, 6).setValues([[
        item.id,
        item.category || '',
        item.subcategory || '',
        !!item.defaultAllowance,
        Number(item.order) || 0,
        item.active !== false
      ]]);
      return { ok: true };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function api_deleteClassification(id) {
  try {
    return withLock_(() => {
      const sheet = getSheet_(SHEET_NAMES.CLASSIFICATION);
      if (!sheet) throw new Error('分類マスタがありません。');
      const rowIdx = findRowById_(sheet, 1, id);
      if (rowIdx < 0) throw new Error('該当分類が見つかりません。');
      sheet.deleteRow(rowIdx);
      return { ok: true };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 分類マスタの並び替え。idリストの順序で表示順を 10, 20, 30 ... に振り直す。
 */
function api_reorderClassifications(orderedIds) {
  try {
    return withLock_(() => {
      const sheet = getSheet_(SHEET_NAMES.CLASSIFICATION);
      if (!sheet) throw new Error('分類マスタがありません。');
      const ids = orderedIds || [];
      ids.forEach((id, idx) => {
        const rowIdx = findRowById_(sheet, 1, id);
        if (rowIdx > 0) sheet.getRange(rowIdx, 5).setValue((idx + 1) * 10);
      });
      return { ok: true };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ===========================================================
// ICS取込ルール (CRUD)
// ===========================================================
function api_listIcsRules() {
  try {
    const sheet = getSheet_(SHEET_NAMES.ICS_RULES);
    if (!sheet) return { ok: true, data: [] };
    const rows = sheetToObjects_(sheet);
    const data = rows.map(r => ({
      id: Number(r['ID']),
      pattern: r['パターン'] || '',
      matchType: r['マッチタイプ'] || 'contains',
      category: r['分類'] || '',
      subcategory: r['サブ分類'] || '',
      defaultAllowance: r['日当対象デフォルト'] === true,
      order: Number(r['表示順']) || 0,
      active: r['有効'] !== false
    })).sort((a, b) => (a.order - b.order) || (a.id - b.id));
    return { ok: true, data: data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function api_addIcsRule(item) {
  try {
    return withLock_(() => {
      const sheet = getSheet_(SHEET_NAMES.ICS_RULES);
      if (!sheet) throw new Error('ICS取込ルールシートがありません。');
      const id = generateNextId_(sheet, 1);
      const order = Number(item.order) || (id * 10);
      appendDataRow_(sheet, [
        id,
        item.pattern || '',
        item.matchType || 'contains',
        item.category || '',
        item.subcategory || '',
        !!item.defaultAllowance,
        order,
        item.active !== false
      ], 1);
      return { ok: true, data: { id: id } };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function api_updateIcsRule(item) {
  try {
    return withLock_(() => {
      const sheet = getSheet_(SHEET_NAMES.ICS_RULES);
      if (!sheet) throw new Error('ICS取込ルールシートがありません。');
      const rowIdx = findRowById_(sheet, 1, item.id);
      if (rowIdx < 0) throw new Error('該当ルールが見つかりません: ID=' + item.id);
      sheet.getRange(rowIdx, 1, 1, 8).setValues([[
        item.id,
        item.pattern || '',
        item.matchType || 'contains',
        item.category || '',
        item.subcategory || '',
        !!item.defaultAllowance,
        Number(item.order) || 0,
        item.active !== false
      ]]);
      return { ok: true };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function api_deleteIcsRule(id) {
  try {
    return withLock_(() => {
      const sheet = getSheet_(SHEET_NAMES.ICS_RULES);
      if (!sheet) throw new Error('ICS取込ルールシートがありません。');
      const rowIdx = findRowById_(sheet, 1, id);
      if (rowIdx < 0) throw new Error('該当ルールが見つかりません。');
      sheet.deleteRow(rowIdx);
      return { ok: true };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function api_reorderIcsRules(orderedIds) {
  try {
    return withLock_(() => {
      const sheet = getSheet_(SHEET_NAMES.ICS_RULES);
      if (!sheet) throw new Error('ICS取込ルールシートがありません。');
      const ids = orderedIds || [];
      ids.forEach((id, idx) => {
        const rowIdx = findRowById_(sheet, 1, id);
        if (rowIdx > 0) sheet.getRange(rowIdx, 7).setValue((idx + 1) * 10);
      });
      return { ok: true };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 単一イベント名に対して現在のルールでどう分類されるかをプレビュー。
 */
function api_previewIcsClassification(name) {
  try {
    const result = classifyEventName_(name);
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
