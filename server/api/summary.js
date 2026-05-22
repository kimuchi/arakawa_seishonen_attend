/**
 * api/summary.js  集計 + 設定 (旧 70_Summary_Api.gs)
 */
'use strict';

const sc = require('../sheets-client');
const { SHEET_NAMES, FISCAL_YEAR_DEFAULT, ATTENDANCE_STATUS } = require('../constants');
const { withLock, parseDate, formatDate } = require('../utils');
const { listEvents } = require('./events');
const { listMembers } = require('./members');

async function readSettings() {
  const { objects } = await sc.getSheetObjects(SHEET_NAMES.SETTINGS);
  const result = {};
  objects.forEach(r => {
    result[r['キー']] = r['値'];
  });
  return result;
}

async function getSettings() {
  return readSettings();
}

async function updateSetting(key, value) {
  return withLock(async () => {
    const grid = await sc.getSheetGrid(SHEET_NAMES.SETTINGS);
    let foundRow = -1;
    for (let i = 1; i < grid.length; i++) {
      if (grid[i][0] === key) { foundRow = i + 1; break; }
    }
    if (foundRow > 0) {
      await sc.updateValues(sc.rangeFor(SHEET_NAMES.SETTINGS, foundRow, 2, 1, 1), [[value]]);
    } else {
      await sc.appendRowAfterGrid(SHEET_NAMES.SETTINGS, grid, [key, value, ''], 0);
    }
    return { ok: true };
  });
}

function fiscalHalfRange(fiscalYear, half, settings) {
  const fy = Number(fiscalYear);
  let halfEndMonth = 9;
  let halfEndDay = 30;
  const raw = (settings && settings['上半期終了日']) || FISCAL_YEAR_DEFAULT.FIRST_HALF_END;
  const m = String(raw).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    halfEndMonth = parseInt(m[2], 10);
    halfEndDay = parseInt(m[3], 10);
  }
  const pad = (n) => String(n).padStart(2, '0');
  const fyStart = fy + '-04-01';
  const fyEnd   = (fy + 1) + '-03-31';
  const halfEnd = fy + '-' + pad(halfEndMonth) + '-' + pad(halfEndDay);
  const halfEndDate = parseDate(halfEnd);
  let h2StartStr = (fy + '-' + pad(halfEndMonth) + '-' + pad(halfEndDay + 1));
  if (halfEndDate) {
    halfEndDate.setDate(halfEndDate.getDate() + 1);
    h2StartStr = formatDate(halfEndDate);
  }
  if (half === 'h1') return { from: fyStart, to: halfEnd, fiscalYear: fy, half: 'h1' };
  return { from: h2StartStr, to: fyEnd, fiscalYear: fy, half: 'h2' };
}

function resolveDateRange(opt, settings) {
  const start = settings['年度開始日'] || FISCAL_YEAR_DEFAULT.START_DATE;
  const end = settings['年度終了日'] || FISCAL_YEAR_DEFAULT.END_DATE;
  const firstHalfEnd = settings['上半期終了日'] || FISCAL_YEAR_DEFAULT.FIRST_HALF_END;
  const nextDayOfFirstHalf = (() => {
    const d = parseDate(firstHalfEnd);
    if (!d) return null;
    d.setDate(d.getDate() + 1);
    return formatDate(d);
  })();
  switch (opt.period) {
    case 'fiscalYear': {
      const fy = Number(opt.fiscalYear);
      if (!fy) throw new Error('集計年度が不正です。');
      const from = fy + '-04-01';
      const to = (fy + 1) + '-03-31';
      return { from, to, label: fy + '年度 (' + from + ' ～ ' + to + ')' };
    }
    case 'twoFiscalYears': {
      const fy = Number(opt.startFiscalYear);
      if (!fy) throw new Error('開始年度が不正です。');
      const from = fy + '-04-01';
      const to = (fy + 2) + '-03-31';
      return { from, to, label: fy + '年度〜' + (fy + 1) + '年度 (' + from + ' ～ ' + to + ')' };
    }
    case 'fiscalYearHalf': {
      const fy = Number(opt.fiscalYear);
      const half = String(opt.half || '').toLowerCase();
      if (!fy) throw new Error('集計年度が不正です。');
      if (half !== 'h1' && half !== 'h2') throw new Error('上半期/下半期の指定が不正です。');
      const r = fiscalHalfRange(fy, half, settings);
      const labelHalf = half === 'h1' ? '上半期' : '下半期';
      return { from: r.from, to: r.to, label: fy + '年度 ' + labelHalf + ' (' + r.from + ' ～ ' + r.to + ')' };
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

async function summarizeByMember(opt) {
  opt = opt || { period: 'fullYear' };
  const settings = await readSettings();
  const range = resolveDateRange(opt, settings);
  const events = await listEvents({ dateFrom: range.from, dateTo: range.to });
  const eventsById = {};
  events.forEach(e => { eventsById[e.id] = e; });
  const members = await listMembers();
  const attGrid = await sc.getSheetGrid(SHEET_NAMES.ATTENDANCE);
  const daily = Number(settings['日当単価']) || FISCAL_YEAR_DEFAULT.DAILY_ALLOWANCE;

  const summary = {};
  members.forEach(m => {
    summary[m.id] = {
      memberId: m.id, no: m.no, district: m.district, name: m.name,
      term: m.term, role: m.role, jissen: m.jissen, senmon: m.senmon,
      attendCount: 0, allowanceCount: 0, allowanceAmount: 0, byCategory: {},
    };
  });

  for (let i = 1; i < attGrid.length; i++) {
    const row = attGrid[i];
    const eventId = Number(row[1]);
    const memberId = Number(row[2]);
    const status = row[3];
    if (status !== ATTENDANCE_STATUS.ATTENDED) continue;
    const ev = eventsById[eventId];
    if (!ev) continue;
    const s = summary[memberId];
    if (!s) continue;
    s.attendCount++;
    if (ev.dailyAllowance) {
      s.allowanceCount++;
      s.allowanceAmount += daily;
    }
    const cat = ev.category || 'その他';
    s.byCategory[cat] = (s.byCategory[cat] || 0) + 1;
  }

  const data = Object.values(summary).sort((a, b) => (a.no || 9999) - (b.no || 9999));
  const districtTotals = {};
  const districtOrder = [];
  data.forEach(m => {
    const district = m.district || '未設定';
    if (!districtTotals[district]) {
      districtTotals[district] = { district, attendCount: 0, allowanceCount: 0, allowanceAmount: 0 };
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
    range, dailyAllowance: daily,
    totalEvents: events.length,
    totalAllowanceEvents: events.filter(e => e.dailyAllowance).length,
    members: data,
    districts: districtSummary,
  };
}

async function summarizeByEvent(opt) {
  opt = opt || { period: 'fullYear' };
  const settings = await readSettings();
  const range = resolveDateRange(opt, settings);
  const events = await listEvents({ dateFrom: range.from, dateTo: range.to });
  const attGrid = await sc.getSheetGrid(SHEET_NAMES.ATTENDANCE);
  const countByEvent = {};
  for (let i = 1; i < attGrid.length; i++) {
    const row = attGrid[i];
    if (row[3] === ATTENDANCE_STATUS.ATTENDED) {
      const eid = Number(row[1]);
      countByEvent[eid] = (countByEvent[eid] || 0) + 1;
    }
  }
  const data = events.map(e => ({ ...e, attendCount: countByEvent[e.id] || 0 }));
  return { range, events: data };
}

module.exports = {
  getSettings,
  updateSetting,
  summarizeByMember,
  summarizeByEvent,
};
