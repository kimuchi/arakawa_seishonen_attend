/**
 * 10_Initializer.gs
 * スプレッドシートの初期構築。
 *  - 各シートの作成とヘッダー投入
 *  - 初期メンバの投入
 *  - 分類マスタの投入
 *  - 設定（年度、日当単価、上半期末日等）の投入
 *
 * 実行方法:
 *   (1) コンテナバインド（スプレッドシートを開いた状態で拡張機能→Apps Script）
 *       の場合は initializeSpreadsheet() をそのまま実行。
 *   (2) スタンドアロンの場合、先に SpreadsheetApp.create() で新規作成するか、
 *       既存のIDを PropertiesService.setProperty('SPREADSHEET_ID', '...') で登録。
 */

/**
 * エントリポイント。すべてのシートを作成・初期化する。
 * 既に存在するシートがあれば、ヘッダー/書式のみ上書きしてデータは保持する。
 */
function initializeSpreadsheet() {
  const ss = ensureSpreadsheet_();
  withLock_(() => {
    ensureMembersSheet_(ss);
    ensureEventsSheet_(ss);
    ensureAttendanceSheet_(ss);
    ensureSettingsSheet_(ss);
    ensureClassificationSheet_(ss);
  });
  // デフォルトの「シート1」が残っていれば削除
  try {
    const defaultSheet = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
    if (defaultSheet && ss.getSheets().length > 1) {
      ss.deleteSheet(defaultSheet);
    }
  } catch (e) {}
  SpreadsheetApp.flush();
  return {
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    message: '初期化が完了しました。'
  };
}

/**
 * コンテナバインドされていないスタンドアロンプロジェクトで、
 * 新規にスプレッドシートを作成してIDを登録し、必要シートまで初期化する。
 * @param {string} title スプレッドシートのタイトル
 */
function createNewSpreadsheet(title) {
  const name = title || '2026年度荒川区青少年委員連絡会出席簿';
  const ss = SpreadsheetApp.create(name);
  PropertiesService.getScriptProperties().setProperty(PROP_KEYS.SPREADSHEET_ID, ss.getId());

  // 作成直後に必要シートを初期化し、空のスプレッドシートのままにならないようにする。
  const initResult = initializeSpreadsheet();

  return {
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    initialized: true,
    message: initResult.message
  };
}

/**
 * スプレッドシート本体を確保（なければ作成）。
 */
function ensureSpreadsheet_() {
  try {
    return getSpreadsheet_();
  } catch (e) {
    const info = createNewSpreadsheet('2026年度荒川区青少年委員連絡会出席簿');
    return SpreadsheetApp.openById(info.spreadsheetId);
  }
}

// ===========================================================
// メンバシート
// ===========================================================
function ensureMembersSheet_(ss) {
  const headers = ['ID', 'No', '地区', '氏名', '期', '役職', '実践部会', '専門部会', '有効', '備考'];
  const sheet = ss.getSheetByName(SHEET_NAMES.MEMBERS) || ss.insertSheet(SHEET_NAMES.MEMBERS);
  writeHeaders_(sheet, headers);

  // データ投入（まだ空の場合のみ）
  if (sheet.getLastRow() < 2) {
    const rows = INITIAL_MEMBERS.map((m, idx) => ([
      idx + 1,
      m.no,
      m.district,
      m.name,
      m.term,
      m.role,
      m.jissen,
      m.senmon,
      true,
      ''
    ]));
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  // 書式設定
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 50);   // ID
  sheet.setColumnWidth(2, 50);   // No
  sheet.setColumnWidth(3, 100);  // 地区
  sheet.setColumnWidth(4, 120);  // 氏名
  sheet.setColumnWidth(5, 60);   // 期
  sheet.setColumnWidth(6, 180);  // 役職
  sheet.setColumnWidth(7, 100);  // 実践部会
  sheet.setColumnWidth(8, 100);  // 専門部会
  sheet.setColumnWidth(9, 60);   // 有効
  sheet.setColumnWidth(10, 180); // 備考

  // 地区・部会にプルダウン
  applyValidation_(sheet, 3, DISTRICTS.concat([]));
  applyValidation_(sheet, 7, JISSEN_BUKAI.concat(['-']));
  applyValidation_(sheet, 8, SENMON_BUKAI.concat(['-']));
  applyBooleanValidation_(sheet, 9);
}

// ===========================================================
// イベントシート
// ===========================================================
function ensureEventsSheet_(ss) {
  const headers = [
    'ID', '日付', '開始時刻', '終了時刻', '終日',
    'イベント名', '分類', 'サブ分類', '日当対象',
    '場所', '備考', 'GカレンダーID', 'GイベントID', '有効'
  ];
  const sheet = ss.getSheetByName(SHEET_NAMES.EVENTS) || ss.insertSheet(SHEET_NAMES.EVENTS);
  writeHeaders_(sheet, headers);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 50);
  sheet.setColumnWidth(2, 100);
  sheet.setColumnWidth(3, 70);
  sheet.setColumnWidth(4, 70);
  sheet.setColumnWidth(5, 50);
  sheet.setColumnWidth(6, 280);
  sheet.setColumnWidth(7, 100);
  sheet.setColumnWidth(8, 160);
  sheet.setColumnWidth(9, 80);
  sheet.setColumnWidth(10, 160);
  sheet.setColumnWidth(11, 220);
  sheet.setColumnWidth(12, 220);
  sheet.setColumnWidth(13, 220);
  sheet.setColumnWidth(14, 60);

  // 分類プルダウン
  const categories = INITIAL_CLASSIFICATIONS
    .map(c => c.category)
    .filter((v, i, arr) => arr.indexOf(v) === i);
  applyValidation_(sheet, 7, categories);
  applyBooleanValidation_(sheet, 5);
  applyBooleanValidation_(sheet, 9);
  applyBooleanValidation_(sheet, 14);
  // 日付列の書式
  sheet.getRange('B2:B').setNumberFormat('yyyy-mm-dd');
  sheet.getRange('C2:C').setNumberFormat('hh:mm');
  sheet.getRange('D2:D').setNumberFormat('hh:mm');
}

// ===========================================================
// 出席シート(縦持ち)
// ===========================================================
function ensureAttendanceSheet_(ss) {
  const headers = ['ID', 'イベントID', 'メンバID', '出席区分', '更新者', '更新日時', '備考'];
  const sheet = ss.getSheetByName(SHEET_NAMES.ATTENDANCE) || ss.insertSheet(SHEET_NAMES.ATTENDANCE);
  writeHeaders_(sheet, headers);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 60);
  sheet.setColumnWidth(2, 80);
  sheet.setColumnWidth(3, 80);
  sheet.setColumnWidth(4, 80);
  sheet.setColumnWidth(5, 180);
  sheet.setColumnWidth(6, 160);
  sheet.setColumnWidth(7, 200);
  applyValidation_(sheet, 4, [ATTENDANCE_STATUS.ATTENDED, ATTENDANCE_STATUS.ABSENT]);
  sheet.getRange('F2:F').setNumberFormat('yyyy-mm-dd hh:mm:ss');
}

// ===========================================================
// 設定シート
// ===========================================================
function ensureSettingsSheet_(ss) {
  const headers = ['キー', '値', '説明'];
  const sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS) || ss.insertSheet(SHEET_NAMES.SETTINGS);
  writeHeaders_(sheet, headers);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 400);
  if (sheet.getLastRow() < 2) {
    const rows = [
      ['年度', FISCAL_YEAR_DEFAULT.YEAR, '対象年度(西暦)'],
      ['年度開始日', FISCAL_YEAR_DEFAULT.START_DATE, '年度の開始日 (yyyy-MM-dd)'],
      ['年度終了日', FISCAL_YEAR_DEFAULT.END_DATE, '年度の終了日 (yyyy-MM-dd)'],
      ['上半期終了日', FISCAL_YEAR_DEFAULT.FIRST_HALF_END, '上半期の最終日 (yyyy-MM-dd)'],
      ['日当単価', FISCAL_YEAR_DEFAULT.DAILY_ALLOWANCE, '1日あたりの日当(円)'],
      ['組織名', '荒川区青少年委員連絡会', '集計表ヘッダ等で使う']
    ];
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.getRange('B2:B').setNumberFormat('@');
}

// ===========================================================
// 分類マスタシート
// ===========================================================
function ensureClassificationSheet_(ss) {
  const headers = ['ID', '分類', 'サブ分類', '日当対象デフォルト', '表示順', '有効'];
  const sheet = ss.getSheetByName(SHEET_NAMES.CLASSIFICATION) || ss.insertSheet(SHEET_NAMES.CLASSIFICATION);
  writeHeaders_(sheet, headers);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 60);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 220);
  sheet.setColumnWidth(4, 140);
  sheet.setColumnWidth(5, 80);
  sheet.setColumnWidth(6, 60);
  if (sheet.getLastRow() < 2) {
    const rows = INITIAL_CLASSIFICATIONS.map((c, idx) => ([
      idx + 1,
      c.category,
      c.subcategory,
      c.defaultAllowance,
      (idx + 1) * 10,
      true
    ]));
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  applyBooleanValidation_(sheet, 4);
  applyBooleanValidation_(sheet, 6);
}

// ===========================================================
// 内部ヘルパ
// ===========================================================
function writeHeaders_(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold')
    .setBackground('#f0f3f7')
    .setHorizontalAlignment('center');
}

function applyValidation_(sheet, col, list) {
  if (!list || list.length === 0) return;
  const range = sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(list, true)
    .setAllowInvalid(true)
    .build();
  range.setDataValidation(rule);
}

function applyBooleanValidation_(sheet, col) {
  const range = sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1);
  range.insertCheckboxes();
}
