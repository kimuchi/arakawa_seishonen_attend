/**
 * 70_Summary_Api.gs
 * 集計関連のAPI。
 *  - 年度サマリ、人別出席数・日当額、イベント別出席者数
 *  - 上半期/下半期での絞り込み
 */

/**
 * 人別サマリ。期間 (fullYear|firstHalf|secondHalf|custom) を指定して集計する。
 * @param {object} opt { period: 'fullYear' | 'firstHalf' | 'secondHalf' | 'custom', dateFrom, dateTo }
 */
function api_summarizeByMember(opt) {
  opt = opt || { period: 'fullYear' };
  try {
    const settings = readSettings_();
    const range = resolveDateRange_(opt, settings);
    const evRes = api_listEvents({ dateFrom: range.from, dateTo: range.to });
    if (!evRes.ok) throw new Error(evRes.error);
    const events = evRes.data;
    const eventsById = {};
    events.forEach(e => { eventsById[e.id] = e; });

    const memRes = api_listMembers();
    if (!memRes.ok) throw new Error(memRes.error);
    const members = memRes.data;

    const att = getSheet_(SHEET_NAMES.ATTENDANCE);
    const allAtt = att && att.getLastRow() >= 2
      ? att.getRange(2, 1, att.getLastRow() - 1, 7).getValues()
      : [];

    const daily = Number(settings['日当単価']) || FISCAL_YEAR_DEFAULT.DAILY_ALLOWANCE;

    // 集計用オブジェクト
    const summary = {};
    members.forEach(m => {
      summary[m.id] = {
        memberId: m.id,
        no: m.no,
        district: m.district,
        name: m.name,
        term: m.term,
        role: m.role,
        jissen: m.jissen,
        senmon: m.senmon,
        attendCount: 0,           // 出席数(全体)
        allowanceCount: 0,        // 日当対象への出席数
        allowanceAmount: 0,       // 日当額(円)
        byCategory: {}            // 分類別の出席数
      };
    });

    allAtt.forEach(row => {
      const eventId = Number(row[1]);
      const memberId = Number(row[2]);
      const status = row[3];
      if (status !== ATTENDANCE_STATUS.ATTENDED) return;
      const ev = eventsById[eventId];
      if (!ev) return;
      const s = summary[memberId];
      if (!s) return;
      s.attendCount++;
      if (ev.dailyAllowance) {
        s.allowanceCount++;
        s.allowanceAmount += daily;
      }
      const cat = ev.category || 'その他';
      s.byCategory[cat] = (s.byCategory[cat] || 0) + 1;
    });

    const data = Object.values(summary).sort((a, b) => (a.no || 9999) - (b.no || 9999));
    const districtTotals = {};
    const districtOrder = [];
    data.forEach(m => {
      const district = m.district || '未設定';
      if (!districtTotals[district]) {
        districtTotals[district] = {
          district: district,
          attendCount: 0,
          allowanceCount: 0,
          allowanceAmount: 0
        };
        districtOrder.push(district);
      }
      districtTotals[district].attendCount += m.attendCount;
      districtTotals[district].allowanceCount += m.allowanceCount;
      districtTotals[district].allowanceAmount += m.allowanceAmount;
    });
    const districtSummary = Object.values(districtTotals).sort((a, b) => {
      const ai = districtOrder.indexOf(a.district);
      const bi = districtOrder.indexOf(b.district);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return String(a.district).localeCompare(String(b.district), 'ja');
    });
    return {
      ok: true,
      data: {
        range: range,
        dailyAllowance: daily,
        totalEvents: events.length,
        totalAllowanceEvents: events.filter(e => e.dailyAllowance).length,
        members: data,
        districts: districtSummary
      }
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * イベント別サマリ(出席者数など)。
 */
function api_summarizeByEvent(opt) {
  opt = opt || { period: 'fullYear' };
  try {
    const settings = readSettings_();
    const range = resolveDateRange_(opt, settings);
    const evRes = api_listEvents({ dateFrom: range.from, dateTo: range.to });
    if (!evRes.ok) throw new Error(evRes.error);
    const events = evRes.data;

    const att = getSheet_(SHEET_NAMES.ATTENDANCE);
    const allAtt = att && att.getLastRow() >= 2
      ? att.getRange(2, 1, att.getLastRow() - 1, 7).getValues()
      : [];
    const countByEvent = {};
    allAtt.forEach(row => {
      if (row[3] === ATTENDANCE_STATUS.ATTENDED) {
        const eid = Number(row[1]);
        countByEvent[eid] = (countByEvent[eid] || 0) + 1;
      }
    });

    const data = events.map(e => ({
      ...e,
      attendCount: countByEvent[e.id] || 0
    }));

    return { ok: true, data: { range: range, events: data } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 期間の解決。
 */
function resolveDateRange_(opt, settings) {
  const start = settings['年度開始日'] || FISCAL_YEAR_DEFAULT.START_DATE;
  const end = settings['年度終了日'] || FISCAL_YEAR_DEFAULT.END_DATE;
  const firstHalfEnd = settings['上半期終了日'] || FISCAL_YEAR_DEFAULT.FIRST_HALF_END;
  const nextDayOfFirstHalf = (function () {
    const d = parseDate_(firstHalfEnd);
    if (!d) return null;
    d.setDate(d.getDate() + 1);
    return formatDate_(d);
  })();

  switch (opt.period) {
    case 'fiscalYear': {
      const fy = Number(opt.fiscalYear);
      if (!fy) throw new Error('集計年度が不正です。');
      const from = fy + '-04-01';
      const to = (fy + 1) + '-03-31';
      return { from: from, to: to, label: fy + '年度 (' + from + ' ～ ' + to + ')' };
    }
    case 'twoFiscalYears': {
      const fy = Number(opt.startFiscalYear);
      if (!fy) throw new Error('開始年度が不正です。');
      const from = fy + '-04-01';
      const to = (fy + 2) + '-03-31';
      return { from: from, to: to, label: fy + '年度〜' + (fy + 1) + '年度 (' + from + ' ～ ' + to + ')' };
    }
    case 'quarter': {
      const fy = Number(opt.fiscalYear);
      const q = Number(opt.quarter);
      if (!fy || !q || q < 1 || q > 4) throw new Error('四半期の指定が不正です。');
      const r = quarterRange_(fy, q);
      return { from: r.from, to: r.to, label: fy + '年度 Q' + q + ' (' + r.from + ' ～ ' + r.to + ')' };
    }
    case 'firstHalf':
      return { from: start, to: firstHalfEnd, label: '上半期 (' + start + ' ～ ' + firstHalfEnd + ')' };
    case 'secondHalf':
      return { from: nextDayOfFirstHalf, to: end, label: '下半期 (' + nextDayOfFirstHalf + ' ～ ' + end + ')' };
    case 'custom':
      return { from: opt.dateFrom || start, to: opt.dateTo || end, label: '期間指定 (' + (opt.dateFrom || start) + ' ～ ' + (opt.dateTo || end) + ')' };
    case 'fullYear':
    default:
      return { from: start, to: end, label: '年度 (' + start + ' ～ ' + end + ')' };
  }
}

/**
 * 四半期(Q1=4-6月, Q2=7-9月, Q3=10-12月, Q4=翌年1-3月)の期間を返す。
 */
function quarterRange_(fiscalYear, quarter) {
  const fy = Number(fiscalYear);
  const q = Number(quarter);
  const startMonths = { 1: 4, 2: 7, 3: 10, 4: 1 };
  const endMonths   = { 1: 6, 2: 9, 3: 12, 4: 3 };
  const startYearOffset = { 1: 0, 2: 0, 3: 0, 4: 1 };
  const endYearOffset   = { 1: 0, 2: 0, 3: 0, 4: 1 };
  const sy = fy + startYearOffset[q];
  const ey = fy + endYearOffset[q];
  const sm = startMonths[q];
  const em = endMonths[q];
  const lastDays = { 1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31 };
  let lastDay = lastDays[em];
  if (em === 2) {
    const isLeap = (ey % 4 === 0 && ey % 100 !== 0) || ey % 400 === 0;
    if (isLeap) lastDay = 29;
  }
  const pad = n => String(n).padStart(2, '0');
  return {
    from: sy + '-' + pad(sm) + '-01',
    to:   ey + '-' + pad(em) + '-' + pad(lastDay),
    fiscalYear: fy,
    quarter: q
  };
}

/**
 * 2年分(8四半期)の四半期サマリを一気に返す。
 * 各四半期について、出席延べ人数・日当対象出席・日当総額・ブロック別集計を含む。
 * @param {object} opt { startFiscalYear: 2026 }
 */
function api_summarizeQuartersOver2Years(opt) {
  opt = opt || {};
  try {
    const settings = readSettings_();
    const baseYear = Number(opt.startFiscalYear) || Number(settings['年度']) || FISCAL_YEAR_DEFAULT.YEAR;
    const daily = Number(settings['日当単価']) || FISCAL_YEAR_DEFAULT.DAILY_ALLOWANCE;

    const memRes = api_listMembers();
    if (!memRes.ok) throw new Error(memRes.error);
    const members = memRes.data;

    const quarters = [];
    for (let yOff = 0; yOff < 2; yOff++) {
      for (let q = 1; q <= 4; q++) {
        const fy = baseYear + yOff;
        const range = quarterRange_(fy, q);
        const evRes = api_listEvents({ dateFrom: range.from, dateTo: range.to });
        if (!evRes.ok) throw new Error(evRes.error);
        const events = evRes.data;
        const eventsById = {};
        events.forEach(e => { eventsById[e.id] = e; });

        const att = getSheet_(SHEET_NAMES.ATTENDANCE);
        const allAtt = att && att.getLastRow() >= 2
          ? att.getRange(2, 1, att.getLastRow() - 1, 7).getValues()
          : [];

        const districtTotals = {};
        let attendCount = 0;
        let allowanceCount = 0;
        let allowanceAmount = 0;

        const memberDistrict = {};
        members.forEach(m => { memberDistrict[m.id] = m.district || '未設定'; });

        allAtt.forEach(row => {
          const eventId = Number(row[1]);
          const memberId = Number(row[2]);
          const status = row[3];
          if (status !== ATTENDANCE_STATUS.ATTENDED) return;
          const ev = eventsById[eventId];
          if (!ev) return;
          attendCount++;
          const dist = memberDistrict[memberId] || '未設定';
          if (!districtTotals[dist]) {
            districtTotals[dist] = { district: dist, attendCount: 0, allowanceCount: 0, allowanceAmount: 0 };
          }
          districtTotals[dist].attendCount++;
          if (ev.dailyAllowance) {
            allowanceCount++;
            allowanceAmount += daily;
            districtTotals[dist].allowanceCount++;
            districtTotals[dist].allowanceAmount += daily;
          }
        });

        quarters.push({
          fiscalYear: fy,
          quarter: q,
          label: fy + '年度 Q' + q,
          range: range,
          totalEvents: events.length,
          totalAllowanceEvents: events.filter(e => e.dailyAllowance).length,
          attendCount: attendCount,
          allowanceCount: allowanceCount,
          allowanceAmount: allowanceAmount,
          districts: Object.values(districtTotals)
        });
      }
    }

    return {
      ok: true,
      data: {
        startFiscalYear: baseYear,
        endFiscalYear: baseYear + 1,
        dailyAllowance: daily,
        quarters: quarters
      }
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 設定シートを { key: value } の辞書として読み出す。
 */
function readSettings_() {
  const sheet = getSheet_(SHEET_NAMES.SETTINGS);
  if (!sheet) return {};
  const rows = sheetToObjects_(sheet);
  const result = {};
  rows.forEach(r => {
    result[r['キー']] = r['値'];
  });
  return result;
}

function api_getSettings() {
  try {
    return { ok: true, data: readSettings_() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function api_updateSetting(key, value) {
  try {
    return withLock_(() => {
      const sheet = getSheet_(SHEET_NAMES.SETTINGS);
      if (!sheet) throw new Error('設定シートがありません。');
      const last = sheet.getLastRow();
      if (last < 2) throw new Error('設定データがありません。');
      const keys = sheet.getRange(2, 1, last - 1, 1).getValues();
      for (let i = 0; i < keys.length; i++) {
        if (keys[i][0] === key) {
          sheet.getRange(i + 2, 2).setValue(value);
          return { ok: true };
        }
      }
      // 新規追加
      sheet.appendRow([key, value, '']);
      return { ok: true };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
