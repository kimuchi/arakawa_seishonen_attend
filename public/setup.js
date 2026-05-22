/**
 * setup.js  初回セットアップ画面のロジック (ADC 版)
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

async function refreshStatus() {
  try {
    const res = await httpJson('GET', '/api/setup/status');
    const d = res.data;
    $('configPathLabel').textContent = d.configPath;
    if (d.spreadsheetId && !$('spreadsheetId').value) $('spreadsheetId').value = d.spreadsheetId;
    if (d.icsImportUrl && !$('icsImportUrl').value) $('icsImportUrl').value = d.icsImportUrl;

    const box = $('statusBox');
    const parts = [];
    parts.push('<div>設定ファイル: <code>' + d.configPath + '</code></div>');
    parts.push('<div style="margin-top:6px;">');
    parts.push('  <span class="setup-status setup-status--' + (d.hasActiveAccount ? 'ok' : 'ng') + '">' + (d.hasActiveAccount ? '✔︎' : '✕') + ' 認証 (ADC)</span> ');
    parts.push('  <span class="setup-status setup-status--' + (d.hasSpreadsheetId ? 'ok' : 'ng') + '" style="margin-left:6px;">' + (d.hasSpreadsheetId ? '✔︎' : '✕') + ' スプレッドシートID</span> ');
    parts.push('  <span class="setup-status setup-status--' + (d.hasIcsUrl ? 'ok' : 'info') + '" style="margin-left:6px;">' + (d.hasIcsUrl ? '✔︎' : '○') + ' ICS取込URL</span>');
    parts.push('</div>');
    if (d.configured) {
      parts.push('<div style="margin-top:10px;"><a href="/" class="btn btn--primary btn--sm">→ アプリを開く</a></div>');
    }
    box.innerHTML = parts.join('');

    const accountBox = $('accountBox');
    if (d.activeAccount) {
      accountBox.innerHTML = '使用中のアカウント: <code style="background:#eef2ff;padding:2px 8px;border-radius:4px;font-size:13px;">'
        + d.activeAccount.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))
        + '</code><div style="margin-top:8px;font-size:12px;color:#6b7280;">このメールアドレスを対象スプレッドシートに「編集者」として共有してください。</div>';
    } else {
      accountBox.innerHTML = '<span class="setup-status setup-status--ng">✕ ADC が検出できません</span>'
        + '<div style="margin-top:8px;font-size:12px;color:#6b7280;">Cloud Run ならランタイム SA の紐付け、ローカル開発なら <code>gcloud auth application-default login</code> を実行してください。</div>';
    }
  } catch (e) {
    $('statusBox').textContent = '取得失敗: ' + e.message;
  }
}

async function testConnection() {
  const el = $('testResult');
  try {
    const spreadsheetId = $('spreadsheetId').value.trim();
    if (!spreadsheetId) throw new Error('スプレッドシートID を入力してください。');
    setStatus(el, '確認中...', 'info');
    const res = await httpJson('POST', '/api/setup/test-connection', { spreadsheetId });
    if (!res.ok) throw new Error(res.error);
    const acct = res.data.activeAccount ? ` / 認証: ${res.data.activeAccount}` : '';
    setStatus(el, `✔︎ 接続OK: 「${res.data.title}」 (${res.data.sheetCount} シート)${acct}`, 'ok');
  } catch (e) {
    setStatus(el, '✕ 接続失敗: ' + e.message, 'ng');
  }
}

async function createSpreadsheet() {
  const el = $('testResult');
  try {
    const title = $('spreadsheetTitle').value.trim();
    const shareRaw = ($('shareWith').value || '').trim();
    setStatus(el, '作成中...', 'info');
    const shareEmails = shareRaw ? shareRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const res = await httpJson('POST', '/api/setup/create-spreadsheet', {
      title,
      shareWithEmail: shareEmails[0] || '',
    });
    if (!res.ok) throw new Error(res.error);
    $('spreadsheetId').value = res.data.spreadsheetId;
    setStatus(el, `✔︎ 作成OK: ${res.data.spreadsheetUrl}`, 'ok');
  } catch (e) {
    setStatus(el, '✕ 作成失敗: ' + e.message, 'ng');
  }
}

async function saveAndInitialize() {
  const el = $('saveResult');
  try {
    setStatus(el, '保存中...', 'info');
    const payload = {
      spreadsheetId: $('spreadsheetId').value.trim(),
      icsImportUrl: $('icsImportUrl').value.trim(),
    };
    if (!payload.spreadsheetId) throw new Error('スプレッドシートID を入力してください。');
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
