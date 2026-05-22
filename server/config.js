/**
 * config.js
 * 単一の config.json を読み書きする。
 *  - 既定パス: ./data/config.json (環境変数 CONFIG_PATH で上書き可能)
 *  - 設定項目:
 *      spreadsheetId      : 連携先スプレッドシートのID
 *      spreadsheetTitle   : 新規作成時のタイトル
 *      icsImportUrl       : ICS取込URL
 *      googleCredentials  : サービスアカウントJSON (オブジェクトとして埋め込む)
 *      googleCredentialsPath : サービスアカウントJSONファイルへの絶対/相対パス
 *      port               : HTTPポート (デフォルト 8080)
 *  - googleCredentials か googleCredentialsPath、または環境変数
 *    GOOGLE_APPLICATION_CREDENTIALS (パス) / GOOGLE_CREDENTIALS_JSON (生JSON)
 *    のいずれかが解決できれば認証可能。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_FILE = process.env.CONFIG_PATH
  || path.join(process.cwd(), 'data', 'config.json');

function getConfigPath() {
  return DEFAULT_CONFIG_FILE;
}

function ensureConfigDir() {
  const dir = path.dirname(DEFAULT_CONFIG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadConfig() {
  try {
    if (!fs.existsSync(DEFAULT_CONFIG_FILE)) return null;
    const raw = fs.readFileSync(DEFAULT_CONFIG_FILE, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error('[config] load error:', e.message);
    return null;
  }
}

function saveConfig(cfg) {
  ensureConfigDir();
  const data = JSON.stringify(cfg, null, 2);
  fs.writeFileSync(DEFAULT_CONFIG_FILE, data, { encoding: 'utf8', mode: 0o600 });
  return cfg;
}

function updateConfig(patch) {
  const cur = loadConfig() || {};
  const next = { ...cur, ...patch };
  return saveConfig(next);
}

function getGoogleCredentials(cfg) {
  // 優先順位: configのインライン > configのパス指定 > 環境変数の生JSON > 環境変数のパス
  if (cfg && cfg.googleCredentials && typeof cfg.googleCredentials === 'object') {
    return cfg.googleCredentials;
  }
  if (cfg && cfg.googleCredentialsPath) {
    const p = path.isAbsolute(cfg.googleCredentialsPath)
      ? cfg.googleCredentialsPath
      : path.join(process.cwd(), cfg.googleCredentialsPath);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
    throw new Error('指定されたサービスアカウントJSONが見つかりません: ' + p);
  }
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  }
  return null;
}

function isConfigured(cfg) {
  if (!cfg) return false;
  const hasCreds = !!getGoogleCredentialsSafe(cfg);
  return hasCreds && !!cfg.spreadsheetId;
}

function getGoogleCredentialsSafe(cfg) {
  try {
    return getGoogleCredentials(cfg);
  } catch (e) {
    return null;
  }
}

function getPort(cfg) {
  return Number(process.env.PORT) || Number(cfg && cfg.port) || 8080;
}

module.exports = {
  getConfigPath,
  loadConfig,
  saveConfig,
  updateConfig,
  getGoogleCredentials,
  getGoogleCredentialsSafe,
  isConfigured,
  getPort,
};
