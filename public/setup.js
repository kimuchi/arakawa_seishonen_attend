/**
 * setup.js  初回セットアップ画面のロジック
 */
'use strict';

function $(id) { return document.getElementById(id); }

async function httpJson(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  let data;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) throw new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
  return data;
}

function setStatus(el, text, kind) {
  el.style.display = 'inline-block';
  el.className = 'setup-status setup-status--' + (kind || 'info');
  el.textContent = text;
}

function parseCredentialsJson() {
  const raw = $('credsJson').value.trim();
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj.client_email || !obj.private_key) {
      throw new Error('client_email / private_key が見つかりません。サービスアカウント JSON か確認してください。');
    }
    return obj;
  } catch (e) {
    throw new Error('JSON のパースに失敗: ' + e.message);
  }
}

async function refreshStatus() {
  try {
    const res = await httpJson('GET', '/api/setup/status');
    const d = res.data;
    $('configPathLabel').textContent = d.configPath;
    const box = $('statusBox');
    const parts = [];
    parts.push('<div>設定ファイル: <code>' + d.configPath + '</code></div>');
    parts.push('<div style="margin-top:6px;">');
    parts.push('  <span class="setup-status setup-status--' + (d.hasCredentials ? 'ok' : 'ng') + '">' + (d.hasCredentials ? '✔︎' : '✕') + ' 認証情報</span> ');
    parts.push('  <span class="setup-status setup-status--' + (d.hasSpreadsheetId ? 'ok' : 'ng') + '" style="margin-left:6px;">' + (d.hasSpreadsheetId ? '✔︎' : '✕') + ' スプレッドシートID</span> ');
    parts.push('  <span class="setup-status setup-status--' + (d.hasIcsUrl ? 'ok' : 'info') + '" style="margin-left:6px;">' + (d.hasIcsUrl ? '✔︎' : '○') + ' ICS取込URL</span>');
    parts.push('</div>');
    if (d.configured) {
      parts.push('<div style="margin-top:10px;"><a href="/" class="btn btn--primary btn--sm">→ アプリを開く</a></div>');
    }
    box.innerHTML = parts.join('');
  } catch (e) {
    $('statusBox').textContent = '取得失敗: ' + e.message;
  }
}

async function testConnection() {
  const el = $('testResult');
  try {
    const creds = parseCredentialsJson();
    const spreadsheetId = $('spreadsheetId').value.trim();
    if (!creds) throw new Error('サービスアカウント JSON を貼り付けてください。');
    if (!spreadsheetId) throw new Error('スプレッドシートID を入力してください。');
    setStatus(el, '確認中...', 'info');
    const res = await httpJson('POST', '/api/setup/test-connection', { credentials: creds, spreadsheetId });
    if (!res.ok) throw new Error(res.error);
    setStatus(el, `✔︎ 接続OK: 「${res.data.title}」 (${res.data.sheetCount} シート)`, 'ok');
  } catch (e) {
    setStatus(el, '✕ 接続失敗: ' + e.message, 'ng');
  }
}

async function createSpreadsheet() {
  const el = $('testResult');
  try {
    const creds = parseCredentialsJson();
    if (!creds) throw new Error('まずサービスアカウント JSON を貼り付けてください。');
    const title = $('spreadsheetTitle').value.trim();
    const shareRaw = ($('shareWith').value || '').trim();
    setStatus(el, '作成中...', 'info');
    let shareEmails = shareRaw ? shareRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    // 1件のみ送る (API は単一メール)、複数の場合は最初のみ
    const res = await httpJson('POST', '/api/setup/create-spreadsheet', {
      credentials: creds,
      title,
      shareWithEmail: shareEmails[0] || '',
    });
    if (!res.ok) throw new Error(res.error);
    $('spreadsheetId').value = res.data.spreadsheetId;
    let msg = `✔︎ 作成OK: ${res.data.spreadsheetUrl}`;
    setStatus(el, msg, 'ok');
  } catch (e) {
    setStatus(el, '✕ 作成失敗: ' + e.message, 'ng');
  }
}

async function saveAndInitialize() {
  const el = $('saveResult');
  try {
    setStatus(el, '保存中...', 'info');
    const payload = {};
    const credsRaw = $('credsJson').value.trim();
    if (credsRaw) {
      payload.credentials = parseCredentialsJson();
    }
    const credsPath = $('credsPath').value.trim();
    if (credsPath) payload.credentialsPath = credsPath;
    const sid = $('spreadsheetId').value.trim();
    if (sid) payload.spreadsheetId = sid;
    const ics = $('icsImportUrl').value.trim();
    payload.icsImportUrl = ics;
    const res = await httpJson('POST', '/api/setup', payload);
    if (!res.ok) throw new Error(res.error);
    setStatus(el, '✔︎ 保存しました。3秒後にアプリへ遷移します。', 'ok');
    setTimeout(() => { window.location.href = '/'; }, 3000);
  } catch (e) {
    setStatus(el, '✕ 保存失敗: ' + e.message, 'ng');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  refreshStatus();
  $('btnTest').addEventListener('click', testConnection);
  $('btnCreate').addEventListener('click', createSpreadsheet);
  $('btnSave').addEventListener('click', saveAndInitialize);
});
