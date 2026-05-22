/**
 * 20_Importer.gs
 * イベントの一括取り込み。
 *  - Script Propertiesで指定したICS URLからの取り込み
 *  - 任意ICSファイルURLからの取り込み（内部利用）
 *  - 分類の自動推定（イベント名に基づく）
 *
 * 取り込み結果は「イベント」シートに追記される。
 * 同じ日付 + 同じイベント名がすでに登録済みの場合はスキップする（重複登録を防ぐ）。
 */

/**
 * Script Propertiesに設定されたICS URLからイベントをインポート。
 */
function importFromConfiguredIcs(startDateStr, endDateStr, options) {
  const icsUrl = getConfiguredIcsUrl_();
  return importFromIcsUrl(icsUrl, startDateStr, endDateStr, options);
}

/**
 * ICSファイルURLからイベントをインポート。
 * Googleカレンダーの「秘密アドレス(iCal)」や他システムが発行するICSに対応。
 *
 * @param {string} icsUrl ICSファイルのURL
 * @param {string} startDateStr 開始日 (yyyy-MM-dd)
 * @param {string} endDateStr 終了日 (yyyy-MM-dd)
 * @param {object} options
 */
function importFromIcsUrl(icsUrl, startDateStr, endDateStr, options) {
  options = options || {};
  if (!icsUrl) throw new Error('ICSのURLを指定してください。');
  const start = parseDate_(startDateStr);
  const end = parseDate_(endDateStr);
  if (!start || !end) throw new Error('開始日・終了日を yyyy-MM-dd 形式で指定してください。');

  const resp = UrlFetchApp.fetch(icsUrl, { muteHttpExceptions: true, followRedirects: true });
  if (resp.getResponseCode() >= 400) {
    throw new Error('ICSの取得に失敗: ' + resp.getResponseCode());
  }
  const text = resp.getContentText();
  const parsed = parseIcs_(text);
  // 期間でフィルタ
  const filtered = parsed.filter(ev => {
    const s = ev.startTime.getTime();
    return s >= start.getTime() && s <= end.getTime() + 24 * 60 * 60 * 1000;
  }).map(ev => {
    ev.gCalendarId = icsUrl; // 出所
    return ev;
  });
  return insertEvents_(filtered, options);
}

function getConfiguredIcsUrl_() {
  const url = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.ICS_IMPORT_URL);
  if (!url) {
    throw new Error('Script Properties に ICS_IMPORT_URL が設定されていません。');
  }
  return url;
}

/**
 * イベント配列を「イベント」シートに書き込む。
 * 既存の「日付 + イベント名」と重複するものはスキップ。
 * autoClassify: trueなら分類を自動推定する。
 */
function insertEvents_(eventList, options) {
  return withLock_(() => {
    const sheet = getSheet_(SHEET_NAMES.EVENTS);
    if (!sheet) throw new Error('イベントシートがありません。initializeSpreadsheet()を先に実行してください。');

    // 既存データの重複判定キーを作成。
    //  - GイベントID (UID)
    //  - 日付 + 正規化タイトル (NFKC・連続空白圧縮・小文字化)
    const existingObjs = sheetToObjects_(sheet);
    const existingIds = {};
    const existingDateTitle = {};
    existingObjs.forEach(r => {
      const gid = String(r['GイベントID'] || '').trim();
      if (gid) existingIds[gid] = true;
      const date = formatDate_(r['日付']);
      const title = normalizeTitle_(r['イベント名']);
      if (date && title) existingDateTitle[date + '|' + title] = true;
    });

    let nextId = generateNextId_(sheet, 1);
    const defaultAllowance = options.defaultAllowance !== undefined ? !!options.defaultAllowance : false;
    const autoClassify = options.autoClassify !== false;
    const rows = [];
    const imported = [];
    let skipped = 0;
    const batchGid = {};
    const batchKey = {};

    eventList.forEach(ev => {
      const gid = String(ev.gEventId || '').trim();
      if (gid && existingIds[gid]) { skipped++; return; }
      if (gid && batchGid[gid]) { skipped++; return; }
      const eventDate = formatDate_(ev.startTime);
      const titleRaw = ev.title || '(無題)';
      const titleNorm = normalizeTitle_(titleRaw);
      const dupKey = eventDate + '|' + titleNorm;
      if (existingDateTitle[dupKey]) { skipped++; return; }
      if (batchKey[dupKey]) { skipped++; return; }
      const classify = autoClassify ? classifyEventName_(titleRaw) : { category: 'その他', subcategory: 'その他', dailyAllowance: defaultAllowance };
      const row = [
        nextId++,
        eventDate,
        ev.allDay ? '' : formatTime_(ev.startTime),
        ev.allDay ? '' : formatTime_(ev.endTime),
        !!ev.allDay,
        titleRaw,
        classify.category,
        classify.subcategory,
        classify.dailyAllowance !== undefined ? classify.dailyAllowance : defaultAllowance,
        ev.location || '',
        ev.description || '',
        ev.gCalendarId || '',
        gid,
        true
      ];
      rows.push(row);
      existingDateTitle[dupKey] = true;
      batchKey[dupKey] = true;
      if (gid) batchGid[gid] = true;
      imported.push({
        id: row[0], date: row[1], title: row[5], category: row[6], subcategory: row[7]
      });
    });

    if (rows.length > 0) {
      // getLastRow() はチェックボックス(false値)が並ぶとシート末を返すため、
      // 実データのある最終行 (ID列) をベースに追記する。
      const startRow = getLastDataRow_(sheet, 1) + 1;
      sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
    }

    return { imported: rows.length, skipped: skipped, events: imported };
  });
}

/**
 * イベントシートに既に登録されている重複イベントを 1 件残して削除する。
 * 重複の判定: 「日付 + 正規化タイトル」が一致するものは同じイベントとみなす。
 * 「GイベントID」も同じものが複数あればまとめて 1 件に。
 * 関連する出席行も、削除対象のイベントIDだけ削除する。
 *
 * @return {{removed:number, kept:number}}
 */
function dedupExistingEvents_() {
  return withLock_(() => {
    const sheet = getSheet_(SHEET_NAMES.EVENTS);
    if (!sheet) throw new Error('イベントシートがありません。');
    const lastRow = getLastDataRow_(sheet, 1);
    if (lastRow < 2) return { removed: 0, kept: 0 };
    const lastCol = 14;
    const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const seenKey = {};
    const seenGid = {};
    const removeIds = [];
    const keptRows = [];
    values.forEach((row) => {
      const id = Number(row[0]);
      if (!id) return;
      const date = formatDate_(row[1]);
      const title = normalizeTitle_(row[5]);
      const gid = String(row[12] || '').trim();
      const key = date + '|' + title;
      if (gid && seenGid[gid]) { removeIds.push(id); return; }
      if (date && title && seenKey[key]) { removeIds.push(id); return; }
      if (gid) seenGid[gid] = true;
      if (date && title) seenKey[key] = true;
      keptRows.push(row);
    });

    if (removeIds.length === 0) return { removed: 0, kept: keptRows.length };

    // シートを書き換える: 残す行だけを再書き込み、余剰行はクリア。
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    if (keptRows.length > 0) {
      sheet.getRange(2, 1, keptRows.length, lastCol).setValues(keptRows);
    }

    // 関連する出席行も削除
    const att = getSheet_(SHEET_NAMES.ATTENDANCE);
    if (att && att.getLastRow() >= 2) {
      const lastAttRow = getLastDataRow_(att, 1);
      const attValues = att.getRange(2, 1, lastAttRow - 1, 7).getValues();
      const removeSet = {};
      removeIds.forEach(id => { removeSet[id] = true; });
      for (let i = attValues.length - 1; i >= 0; i--) {
        if (removeSet[Number(attValues[i][1])]) {
          att.deleteRow(i + 2);
        }
      }
    }
    return { removed: removeIds.length, kept: keptRows.length };
  });
}

function api_dedupExistingEvents() {
  try {
    return { ok: true, data: dedupExistingEvents_() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * イベント名から分類を自動推定する。
 * シートに登録された「ICS取込ルール」を表示順で評価する。
 * シートが空・未初期化の場合は INITIAL_ICS_RULES をフォールバック。
 * @return {{category:string, subcategory:string, dailyAllowance:boolean}}
 */
function classifyEventName_(name) {
  const n = String(name || '');
  const rules = loadIcsRules_();
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (!r.active) continue;
    if (!r.pattern) continue;
    let hit = false;
    if (r.matchType === 'regex') {
      try {
        const re = new RegExp(r.pattern);
        hit = re.test(n);
      } catch (e) {
        hit = false;
      }
    } else {
      hit = n.indexOf(r.pattern) >= 0;
    }
    if (hit) {
      return {
        category: r.category || 'その他',
        subcategory: r.subcategory || '',
        dailyAllowance: !!r.defaultAllowance
      };
    }
  }
  return { category: 'その他', subcategory: 'その他', dailyAllowance: false };
}

/**
 * ICS取込ルールを「ICS取込ルール」シートから読み出す。
 * シートが無い・空の場合は INITIAL_ICS_RULES をそのまま返す。
 */
function loadIcsRules_() {
  try {
    const sheet = getSheet_(SHEET_NAMES.ICS_RULES);
    if (sheet && sheet.getLastRow() >= 2) {
      const rows = sheetToObjects_(sheet);
      const rules = rows.map(r => ({
        pattern: String(r['パターン'] || ''),
        matchType: String(r['マッチタイプ'] || 'contains'),
        category: String(r['分類'] || ''),
        subcategory: String(r['サブ分類'] || ''),
        defaultAllowance: r['日当対象デフォルト'] === true,
        order: Number(r['表示順']) || 0,
        active: r['有効'] !== false
      })).sort((a, b) => a.order - b.order);
      return rules;
    }
  } catch (e) {}
  return (typeof INITIAL_ICS_RULES !== 'undefined' ? INITIAL_ICS_RULES : []).map(r => ({
    pattern: r.pattern,
    matchType: r.matchType || 'contains',
    category: r.category,
    subcategory: r.subcategory,
    defaultAllowance: !!r.defaultAllowance,
    order: 0,
    active: true
  }));
}

// ===========================================================
// ICSパーサ
// ===========================================================
/**
 * ICSテキストをパースし、イベントの配列を返す。
 * 軽量パーサ：VEVENTブロックのみ抽出し、必要なフィールド(DTSTART/DTEND/SUMMARY/LOCATION/DESCRIPTION/UID)を取り出す。
 * 繰り返し(RRULE)は展開しない（単発イベントのみ想定）。
 */
function parseIcs_(text) {
  // 行連結(継続行: CRLF + space)
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
        const parsed = toParsedEvent_(cur);
        if (parsed) events.push(parsed);
      }
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      let key = line.substring(0, idx);
      const value = line.substring(idx + 1);
      // パラメータを分離 (例: DTSTART;TZID=Asia/Tokyo, DTSTART;VALUE=DATE)
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
      cur[key] = { value: value, params: params };
    }
  }
  return events;
}

function toParsedEvent_(raw) {
  const dtstart = raw['DTSTART'];
  const dtend = raw['DTEND'] || raw['DTSTART'];
  if (!dtstart) return null;
  const allDay = (dtstart.params && dtstart.params['VALUE'] === 'DATE');
  const startTime = icsDateToDate_(dtstart.value, dtstart.params, allDay);
  const endTime = icsDateToDate_(dtend.value, dtend.params, allDay) || startTime;
  if (!startTime) return null;
  return {
    gEventId: raw['UID'] ? raw['UID'].value : '',
    title: raw['SUMMARY'] ? unescapeIcsText_(raw['SUMMARY'].value) : '',
    location: raw['LOCATION'] ? unescapeIcsText_(raw['LOCATION'].value) : '',
    description: raw['DESCRIPTION'] ? unescapeIcsText_(raw['DESCRIPTION'].value) : '',
    startTime: startTime,
    endTime: endTime,
    allDay: allDay
  };
}

/**
 * ICSの日付文字列をDateに変換。
 *  - 20260515 (日付のみ)
 *  - 20260515T090000 (TZ指定)
 *  - 20260515T000000Z (UTC)
 */
function icsDateToDate_(v, params, allDay) {
  if (!v) return null;
  const s = String(v).trim();
  if (allDay) {
    // YYYYMMDD
    if (s.length < 8) return null;
    const y = parseInt(s.substring(0, 4), 10);
    const m = parseInt(s.substring(4, 6), 10) - 1;
    const d = parseInt(s.substring(6, 8), 10);
    return new Date(y, m, d);
  }
  // YYYYMMDDTHHMMSS(Z)
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
  // TZIDが指定されていてもTZ辞書を持たないので、ローカル(Asia/Tokyo)として扱う
  return new Date(y, mo, d, hh, mm, ss);
}

function unescapeIcsText_(s) {
  return String(s || '')
    .replace(/\\n/g, '\n')
    .replace(/\\N/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

// ===========================================================
// UIから呼び出すための薄いラッパ
// ===========================================================
function api_importFromConfiguredIcs(startDateStr, endDateStr, options) {
  try {
    return { ok: true, data: importFromConfiguredIcs(startDateStr, endDateStr, options) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
