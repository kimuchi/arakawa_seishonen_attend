/**
 * server/index.js
 * Express でフロントエンド配信 + REST API を提供するメインサーバ。
 *
 * ルーティング:
 *   GET  /              フロント (config 未設定なら /setup にリダイレクト)
 *   GET  /setup         セットアップ画面
 *   POST /api/setup     セットアップ送信
 *   GET  /api/setup/status
 *   POST /api/setup/test-connection  認証情報疎通テスト
 *   POST /api/setup/create-spreadsheet  新規スプレッドシート作成
 *
 *   GET  /api/bootstrap  起動時データ
 *   POST /api/initialize-spreadsheet  シート群を作成/補完
 *
 *   GET  /api/members
 *   POST /api/members          (add)
 *   PUT  /api/members/:id      (update)
 *   DELETE /api/members/:id
 *
 *   GET  /api/events
 *   POST /api/events
 *   PUT  /api/events/:id
 *   DELETE /api/events/:id
 *
 *   GET  /api/classifications
 *   GET  /api/classifications/all
 *   POST /api/classifications
 *   PUT  /api/classifications/:id
 *   DELETE /api/classifications/:id
 *   POST /api/classifications/reorder
 *
 *   GET  /api/ics-rules
 *   POST /api/ics-rules
 *   PUT  /api/ics-rules/:id
 *   DELETE /api/ics-rules/:id
 *   POST /api/ics-rules/reorder
 *   POST /api/ics-rules/preview
 *
 *   GET  /api/attendance/:eventId
 *   POST /api/attendance/:eventId/bulk
 *
 *   GET  /api/settings
 *   POST /api/settings
 *   GET  /api/summary/by-member
 *   GET  /api/summary/by-event
 *
 *   POST /api/ics-import
 *   POST /api/dedup-events
 */
'use strict';

const express = require('express');
const path = require('path');
const config = require('./config');
const sc = require('./sheets-client');
const initializer = require('./initializer');
const importer = require('./importer');
const membersApi = require('./api/members');
const eventsApi = require('./api/events');
const attendanceApi = require('./api/attendance');
const summaryApi = require('./api/summary');

const app = express();
app.use(express.json({ limit: '2mb' }));

// 静的ファイル (public/) は /assets, /scripts.js, /styles.css などとして配信
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- ルーティング: トップページ ----------
app.get('/', (req, res) => {
  const cfg = config.loadConfig();
  if (!config.isConfigured(cfg)) {
    return res.redirect('/setup');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'app.html'));
});

app.get('/setup', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'setup.html'));
});

// ---------- セットアップAPI ----------
app.get('/api/setup/status', (req, res) => {
  const cfg = config.loadConfig() || {};
  const hasCreds = !!config.getGoogleCredentialsSafe(cfg);
  res.json({
    ok: true,
    data: {
      configured: config.isConfigured(cfg),
      hasCredentials: hasCreds,
      hasSpreadsheetId: !!cfg.spreadsheetId,
      hasIcsUrl: !!cfg.icsImportUrl,
      configPath: config.getConfigPath(),
      port: config.getPort(cfg),
    },
  });
});

app.post('/api/setup/test-connection', async (req, res) => {
  try {
    const { credentials, spreadsheetId } = req.body || {};
    if (!credentials) throw new Error('credentials を指定してください。');
    if (!spreadsheetId) throw new Error('スプレッドシートIDを指定してください。');
    // 一時的に config を組み立てて疎通確認
    const tmpCfg = { googleCredentials: credentials, spreadsheetId };
    // 認証して、対象スプレッドシートのメタ情報を取得してみる
    const { google } = require('googleapis');
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
    });
    const api = google.sheets({ version: 'v4', auth });
    const meta = await api.spreadsheets.get({ spreadsheetId, includeGridData: false });
    res.json({
      ok: true,
      data: {
        spreadsheetId: meta.data.spreadsheetId,
        title: meta.data.properties && meta.data.properties.title,
        sheetCount: (meta.data.sheets || []).length,
        clientEmail: credentials.client_email,
      },
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/setup/create-spreadsheet', async (req, res) => {
  try {
    const { credentials, title, shareWithEmail } = req.body || {};
    if (!credentials) throw new Error('credentials を指定してください。');
    const { google } = require('googleapis');
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });
    const created = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: title || '2026年度荒川区青少年委員連絡会出席簿',
          locale: 'ja_JP',
          timeZone: 'Asia/Tokyo',
        },
      },
    });
    const newId = created.data.spreadsheetId;
    if (shareWithEmail) {
      try {
        await drive.permissions.create({
          fileId: newId,
          sendNotificationEmail: false,
          requestBody: { role: 'writer', type: 'user', emailAddress: shareWithEmail },
        });
      } catch (e) {
        // 共有失敗は致命的ではない
        console.warn('[setup] share failed:', e.message);
      }
    }
    res.json({
      ok: true,
      data: {
        spreadsheetId: newId,
        spreadsheetUrl: created.data.spreadsheetUrl
          || `https://docs.google.com/spreadsheets/d/${newId}/edit`,
      },
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/setup', async (req, res) => {
  try {
    const { credentials, credentialsPath, spreadsheetId, icsImportUrl, port } = req.body || {};
    const next = config.loadConfig() || {};
    if (credentials && typeof credentials === 'object') {
      next.googleCredentials = credentials;
      // 排他: パス指定が残っていれば削除
      delete next.googleCredentialsPath;
    } else if (credentialsPath) {
      next.googleCredentialsPath = credentialsPath;
      delete next.googleCredentials;
    }
    if (spreadsheetId) next.spreadsheetId = spreadsheetId;
    if (icsImportUrl !== undefined) next.icsImportUrl = icsImportUrl;
    if (port) next.port = Number(port) || 8080;
    config.saveConfig(next);
    sc.resetClients();
    // 初期化を試行 (失敗しても設定は保存済)
    let initInfo = null;
    try {
      initInfo = await initializer.initializeSpreadsheet();
    } catch (e) {
      console.warn('[setup] init warning:', e.message);
    }
    res.json({ ok: true, data: { configured: true, initInfo } });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 設定単体の更新 (設定タブ内の「設定ファイル管理」用)
app.post('/api/setup/update', async (req, res) => {
  try {
    const patch = req.body || {};
    const next = config.loadConfig() || {};
    if (Object.prototype.hasOwnProperty.call(patch, 'icsImportUrl')) {
      next.icsImportUrl = patch.icsImportUrl;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'spreadsheetId')) {
      next.spreadsheetId = patch.spreadsheetId;
    }
    if (patch.credentials && typeof patch.credentials === 'object') {
      next.googleCredentials = patch.credentials;
      delete next.googleCredentialsPath;
    }
    config.saveConfig(next);
    sc.resetClients();
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ---------- 認証/初期化ガード ----------
function requireConfigured(req, res, next) {
  const cfg = config.loadConfig();
  if (!config.isConfigured(cfg)) {
    return res.status(503).json({ ok: false, error: '未設定です。先に /setup でセットアップしてください。' });
  }
  next();
}

// ---------- ブートストラップ ----------
app.get('/api/bootstrap', async (req, res) => {
  try {
    const cfg = config.loadConfig() || {};
    if (!config.isConfigured(cfg)) {
      return res.json({ ok: false, error: '未設定', hint: '/setup でセットアップしてください。' });
    }
    let settings = {};
    try {
      settings = await summaryApi.getSettings();
    } catch (e) {
      return res.json({ ok: false, error: e.message, hint: 'スプレッドシート未初期化の可能性があります。' });
    }
    res.json({
      ok: true,
      data: {
        spreadsheetUrl: sc.getSpreadsheetUrl(),
        spreadsheetId: sc.getSpreadsheetId(),
        icsImportUrl: cfg.icsImportUrl || '',
        settings,
      },
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/initialize-spreadsheet', requireConfigured, async (req, res) => {
  try {
    const r = await initializer.initializeSpreadsheet();
    res.json({ ok: true, data: r });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ---------- メンバ ----------
app.get('/api/members', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await membersApi.listMembers() }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/api/members', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await membersApi.addMember(req.body) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.put('/api/members/:id', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await membersApi.updateMember({ ...req.body, id: Number(req.params.id) }) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.delete('/api/members/:id', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await membersApi.deleteMember(Number(req.params.id)) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// ---------- イベント ----------
app.get('/api/events', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await eventsApi.listEvents(req.query || {}) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/api/events', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await eventsApi.addEvent(req.body) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.put('/api/events/:id', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await eventsApi.updateEvent({ ...req.body, id: Number(req.params.id) }) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.delete('/api/events/:id', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await eventsApi.deleteEvent(Number(req.params.id)) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// ---------- 分類マスタ ----------
app.get('/api/classifications', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await eventsApi.listClassifications() }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.get('/api/classifications/all', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await eventsApi.listClassificationsAll() }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/api/classifications', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await eventsApi.addClassification(req.body) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.put('/api/classifications/:id', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await eventsApi.updateClassification({ ...req.body, id: Number(req.params.id) }) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.delete('/api/classifications/:id', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await eventsApi.deleteClassification(Number(req.params.id)) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/api/classifications/reorder', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await eventsApi.reorderClassifications(req.body && req.body.orderedIds) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// ---------- ICS取込ルール ----------
app.get('/api/ics-rules', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await eventsApi.listIcsRules() }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/api/ics-rules', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await eventsApi.addIcsRule(req.body) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.put('/api/ics-rules/:id', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await eventsApi.updateIcsRule({ ...req.body, id: Number(req.params.id) }) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.delete('/api/ics-rules/:id', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await eventsApi.deleteIcsRule(Number(req.params.id)) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/api/ics-rules/reorder', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await eventsApi.reorderIcsRules(req.body && req.body.orderedIds) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/api/ics-rules/preview', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await importer.previewClassification((req.body && req.body.name) || '') }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// ---------- 出席 ----------
app.get('/api/attendance/:eventId', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await attendanceApi.getEventAttendance(Number(req.params.eventId)) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/api/attendance/:eventId/bulk', requireConfigured, async (req, res) => {
  try {
    const eid = Number(req.params.eventId);
    const entries = (req.body && req.body.entries) || [];
    res.json({ ok: true, data: await attendanceApi.bulkSetAttendance(eid, entries) });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ---------- 設定 ----------
app.get('/api/settings', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await summaryApi.getSettings() }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/api/settings', requireConfigured, async (req, res) => {
  try {
    const { key, value } = req.body || {};
    res.json({ ok: true, data: await summaryApi.updateSetting(key, value) });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ---------- 集計 ----------
app.post('/api/summary/by-member', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await summaryApi.summarizeByMember(req.body || {}) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/api/summary/by-event', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await summaryApi.summarizeByEvent(req.body || {}) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// ---------- ICSインポート ----------
app.post('/api/ics-import', requireConfigured, async (req, res) => {
  try {
    const { startDate, endDate, options } = req.body || {};
    res.json({ ok: true, data: await importer.importFromConfiguredIcs(startDate, endDate, options || {}) });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/api/dedup-events', requireConfigured, async (req, res) => {
  try { res.json({ ok: true, data: await importer.dedupExistingEvents() }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// ---------- 404 / エラー ----------
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'Not Found' });
  }
  next();
});

app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ ok: false, error: err && err.message ? err.message : 'Internal error' });
});

// ---------- 起動 ----------
const cfg = config.loadConfig();
const port = config.getPort(cfg);
app.listen(port, () => {
  console.log(`荒川区青少年委員連絡会 出席簿 listening on http://localhost:${port}`);
  console.log(`設定ファイル: ${config.getConfigPath()}`);
  if (!config.isConfigured(cfg)) {
    console.log('  → 未設定です。 http://localhost:' + port + '/setup でセットアップを行ってください。');
  }
});
