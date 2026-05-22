/**
 * 30_WebApp.gs
 * GAS WebAppのエントリポイント。
 *  - doGet: HTMLを返す
 *  - include: テンプレートから他のHTMLを取り込む(99_Utilsのinclude関数を使用)
 *  - 各種APIの軽い入口となる関数
 */

/**
 * WebApp入口。/exec アクセスでindex.htmlをレンダリングする。
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('index');
  template.bootData = getBootstrapData_();
  return template.evaluate()
    .setTitle('荒川区青少年委員連絡会 出席簿')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/**
 * 初期ブートストラップデータ。クライアントのロード直後に利用する値をまとめて返す。
 */
function getBootstrapData_() {
  try {
    const settings = api_getSettings();
    return {
      ok: true,
      email: getCurrentUserEmail_(),
      spreadsheetUrl: getSpreadsheet_().getUrl(),
      settings: settings.ok ? settings.data : {}
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message,
      hint: 'スプレッドシート未初期化の可能性があります。'
    };
  }
}

/**
 * UIから明示的に呼ばれる初期化API。
 */
function api_initializeSpreadsheet() {
  try {
    return { ok: true, data: initializeSpreadsheet() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * シートを開くためのURLを取得(UI用)。
 */
function api_getSpreadsheetUrl() {
  try {
    return { ok: true, data: { url: getSpreadsheet_().getUrl() } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
