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

    const existingObjs = sheetToObjects_(sheet);
    const existingIds = {};
    const existingDateTitle = {};
    existingObjs.forEach(r => {
      if (r['GイベントID']) existingIds[String(r['GイベントID'])] = true;
      const date = formatDate_(r['日付']);
      const title = String(r['イベント名'] || '').trim().toLowerCase();
      if (date && title) existingDateTitle[date + '|' + title] = true;
    });

    let nextId = generateNextId_(sheet, 1);
    const defaultAllowance = options.defaultAllowance !== undefined ? !!options.defaultAllowance : false;
    const autoClassify = options.autoClassify !== false;
    const rows = [];
    const imported = [];
    let skipped = 0;

    eventList.forEach(ev => {
      if (ev.gEventId && existingIds[ev.gEventId]) { skipped++; return; }
      const eventDate = formatDate_(ev.startTime);
      const eventTitle = String(ev.title || '(無題)').trim().toLowerCase();
      const dupKey = eventDate + '|' + eventTitle;
      if (existingDateTitle[dupKey]) { skipped++; return; }
      const classify = autoClassify ? classifyEventName_(ev.title) : { category: 'その他', subcategory: 'その他', dailyAllowance: defaultAllowance };
      const row = [
        nextId++,
        eventDate,
        ev.allDay ? '' : formatTime_(ev.startTime),
        ev.allDay ? '' : formatTime_(ev.endTime),
        !!ev.allDay,
        ev.title || '(無題)',
        classify.category,
        classify.subcategory,
        classify.dailyAllowance !== undefined ? classify.dailyAllowance : defaultAllowance,
        ev.location || '',
        ev.description || '',
        ev.gCalendarId || '',
        ev.gEventId || '',
        true
      ];
      rows.push(row);
      existingDateTitle[dupKey] = true;
      imported.push({
        id: row[0], date: row[1], title: row[5], category: row[6], subcategory: row[7]
      });
    });

    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }

    return { imported: rows.length, skipped: skipped, events: imported };
  });
}

/**
 * イベント名から分類を自動推定する。
 * シンプルなキーワードマッチだが、前年度のイベント名パターンをカバー。
 * @return {{category:string, subcategory:string, dailyAllowance:boolean}}
 */
function classifyEventName_(name) {
  const n = String(name || '');
  const map = [
    // ブロック
    { re: /(ブロック研修|城北ブロック|ブロック会議)/, c: 'ブロック', s: '全ブロック合同', a: true },
    // 実践部会(タグ付き)
    { re: /【校庭】|校庭利用|みんなで遊ぼう/, c: '実践部会', s: '校庭', a: true },
    { re: /【少年】|少年企画|少年部会/, c: '実践部会', s: '少年', a: true },
    { re: /【青年】|青年部会|青年企画/, c: '実践部会', s: '青年', a: true },
    // 専門部会(タグ付き)
    { re: /【調査研修】|調査研修部会/, c: '専門部会', s: '調査研修', a: true },
    { re: /【総務】|総務部会/, c: '専門部会', s: '総務', a: true },
    { re: /【広報】|広報部会/, c: '専門部会', s: '広報', a: true },
    // 関連団体
    { re: /【都連】|都連|東京都青少年委員|青少年委員大会/, c: '関連団体', s: '都連(東京都青少年委員会連合会)', a: true },
    { re: /荒小連|中高生キャンプ/, c: '関連団体', s: '荒小連(荒川小学生連合)', a: true },
    { re: /子ども会/, c: '関連団体', s: '子ども会', a: true },
    { re: /ロータリー/, c: '関連団体', s: 'ロータリークラブ', a: false },
    { re: /アリストック/, c: '関連団体', s: 'アリストック', a: true },
    { re: /青少年問題協議/, c: '関連団体', s: '青少年問題協議会', a: true },
    { re: /薬物乱用/, c: '関連団体', s: '薬物乱用防止推進協議会', a: true },
    { re: /社会を明るくする/, c: '関連団体', s: '社会を明るくする運動', a: true },
    // 全体事業
    { re: /定例会/, c: '全体事業', s: '定例会', a: true },
    { re: /(荒青連|青少年委員連絡会)総会|総会・懇親会|総会/, c: '全体事業', s: '総会', a: true },
    { re: /チャレンジ共和国|プレチャレンジ/, c: '全体事業', s: 'チャレンジ共和国', a: true },
    { re: /チャレンジキャンプ/, c: '全体事業', s: 'チャレンジキャンプ', a: true },
    { re: /さくら教室|さくらお楽しみ/, c: '全体事業', s: 'さくら教室', a: true },
    { re: /川の手|あらかわまつり/, c: '全体事業', s: '川の手あらかわまつり', a: true },
    { re: /二十歳のつどい|はたちのつどい/, c: '全体事業', s: '二十歳のつどい', a: true },
    { re: /退任式/, c: '全体事業', s: '退任式', a: true },
    { re: /宿泊研修/, c: '全体事業', s: '宿泊研修', a: true },
    { re: /日帰り研修/, c: '全体事業', s: '日帰り研修', a: true },
    { re: /忘年会|懇親会/, c: '全体事業', s: '忘年会・懇親会', a: false },
    { re: /自主研修/, c: '全体事業', s: '自主研修', a: false },
    { re: /タノシバ/, c: '全体事業', s: 'タノシバ', a: true }
  ];
  for (let i = 0; i < map.length; i++) {
    if (map[i].re.test(n)) {
      return { category: map[i].c, subcategory: map[i].s, dailyAllowance: map[i].a };
    }
  }
  return { category: 'その他', subcategory: 'その他', dailyAllowance: false };
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
