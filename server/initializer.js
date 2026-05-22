/**
 * initializer.js
 * スプレッドシートの初期構築 (旧 10_Initializer.gs)。
 *  - 各シートの作成とヘッダー投入
 *  - 初期メンバ・分類マスタ・ICS取込ルール・設定の投入
 */
'use strict';

const {
  SHEET_NAMES,
  FISCAL_YEAR_DEFAULT,
  INITIAL_CLASSIFICATIONS,
  INITIAL_MEMBERS,
  INITIAL_ICS_RULES,
} = require('./constants');
const sc = require('./sheets-client');
const { withLock } = require('./utils');

async function initializeSpreadsheet() {
  return withLock(async () => {
    await ensureMembersSheet();
    await ensureEventsSheet();
    await ensureAttendanceSheet();
    await ensureSettingsSheet();
    await ensureClassificationSheet();
    await ensureIcsRulesSheet();

    // デフォルトの「シート1」「Sheet1」を削除
    for (const n of ['シート1', 'Sheet1']) {
      try { await sc.deleteSheetIfExists(n); } catch (e) { /* ignore */ }
    }
    return {
      spreadsheetId: sc.getSpreadsheetId(),
      spreadsheetUrl: sc.getSpreadsheetUrl(),
      message: '初期化が完了しました。',
    };
  });
}

async function writeHeadersIfNeeded(sheetName, headers) {
  const grid = await sc.getSheetGrid(sheetName);
  const need = !grid || grid.length === 0 || !grid[0] || grid[0].length === 0 || headers.some((h, i) => grid[0][i] !== h);
  if (need) {
    await sc.updateValues(sc.rangeFor(sheetName, 1, 1, 1, headers.length), [headers]);
  }
  // 必要ならフォーマット (背景色/太字) を付ける
  const sheetId = await sc.getSheetIdByName(sheetName);
  if (sheetId != null) {
    await sc.batchUpdate([
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: headers.length },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.94, green: 0.95, blue: 0.97 },
              textFormat: { bold: true },
              horizontalAlignment: 'CENTER',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
        },
      },
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount',
        },
      },
    ]);
  }
}

async function ensureMembersSheet() {
  const name = SHEET_NAMES.MEMBERS;
  await sc.ensureSheetExists(name);
  const headers = ['ID', 'No', '地区', '氏名', '期', '役職', '実践部会', '専門部会', '有効', '備考'];
  await writeHeadersIfNeeded(name, headers);
  // データ投入(空のときのみ)
  const grid = await sc.getSheetGrid(name);
  if (grid.length < 2) {
    const rows = INITIAL_MEMBERS.map((m, idx) => ([
      idx + 1, m.no, m.district, m.name, m.term, m.role,
      m.jissen, m.senmon, true, ''
    ]));
    await sc.updateValues(sc.rangeFor(name, 2, 1, rows.length, headers.length), rows);
  }
}

async function ensureEventsSheet() {
  const name = SHEET_NAMES.EVENTS;
  await sc.ensureSheetExists(name);
  const headers = [
    'ID', '日付', '開始時刻', '終了時刻', '終日',
    'イベント名', '分類', 'サブ分類', '日当対象',
    '場所', '備考', 'GカレンダーID', 'GイベントID', '有効',
  ];
  await writeHeadersIfNeeded(name, headers);
  // 日付列 (B) は yyyy-mm-dd、時刻列 (C/D) は hh:mm 表示書式に揃える
  const sheetId = await sc.getSheetIdByName(name);
  if (sheetId != null) {
    await sc.batchUpdate([
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 },
          cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 4 },
          cell: { userEnteredFormat: { numberFormat: { type: 'TIME', pattern: 'hh:mm' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      },
    ]);
  }
}

async function ensureAttendanceSheet() {
  const name = SHEET_NAMES.ATTENDANCE;
  await sc.ensureSheetExists(name);
  const headers = ['ID', 'イベントID', 'メンバID', '出席区分', '更新者', '更新日時', '備考'];
  await writeHeadersIfNeeded(name, headers);
}

async function ensureSettingsSheet() {
  const name = SHEET_NAMES.SETTINGS;
  await sc.ensureSheetExists(name);
  const headers = ['キー', '値', '説明'];
  await writeHeadersIfNeeded(name, headers);
  const grid = await sc.getSheetGrid(name);
  if (grid.length < 2) {
    const rows = [
      ['年度', FISCAL_YEAR_DEFAULT.YEAR, '対象年度(西暦)'],
      ['年度開始日', FISCAL_YEAR_DEFAULT.START_DATE, '年度の開始日 (yyyy-MM-dd)'],
      ['年度終了日', FISCAL_YEAR_DEFAULT.END_DATE, '年度の終了日 (yyyy-MM-dd)'],
      ['上半期終了日', FISCAL_YEAR_DEFAULT.FIRST_HALF_END, '上半期の最終日 (yyyy-MM-dd)'],
      ['日当単価', FISCAL_YEAR_DEFAULT.DAILY_ALLOWANCE, '1日あたりの日当(円)'],
      ['組織名', '荒川区青少年委員連絡会', '集計表ヘッダ等で使う'],
    ];
    await sc.updateValues(sc.rangeFor(name, 2, 1, rows.length, headers.length), rows);
  }
}

async function ensureClassificationSheet() {
  const name = SHEET_NAMES.CLASSIFICATION;
  await sc.ensureSheetExists(name);
  const headers = ['ID', '分類', 'サブ分類', '日当対象デフォルト', '表示順', '有効'];
  await writeHeadersIfNeeded(name, headers);
  const grid = await sc.getSheetGrid(name);
  if (grid.length < 2) {
    const rows = INITIAL_CLASSIFICATIONS.map((c, idx) => ([
      idx + 1, c.category, c.subcategory, c.defaultAllowance, (idx + 1) * 10, true
    ]));
    await sc.updateValues(sc.rangeFor(name, 2, 1, rows.length, headers.length), rows);
  }
}

async function ensureIcsRulesSheet() {
  const name = SHEET_NAMES.ICS_RULES;
  await sc.ensureSheetExists(name);
  const headers = ['ID', 'パターン', 'マッチタイプ', '分類', 'サブ分類', '日当対象デフォルト', '表示順', '有効'];
  await writeHeadersIfNeeded(name, headers);
  const grid = await sc.getSheetGrid(name);
  if (grid.length < 2) {
    const rows = INITIAL_ICS_RULES.map((r, idx) => ([
      idx + 1, r.pattern, r.matchType || 'contains',
      r.category, r.subcategory, !!r.defaultAllowance, (idx + 1) * 10, true
    ]));
    await sc.updateValues(sc.rangeFor(name, 2, 1, rows.length, headers.length), rows);
  }
}

module.exports = {
  initializeSpreadsheet,
};
