# 荒川区青少年委員連絡会 出席簿システム (Node.js / Cloud Run 版)

Google スプレッドシートをデータベースとして使う Web 出席簿システムの **Node.js 移植版** です。
Google Apps Script から Node.js (Express + Google Sheets API) に置き換え、Cloud Run / Docker / オンプレ Linux など **任意の環境にデプロイ可能** にしました。

> 📘 詳しい手順は **[DEPLOYMENT.md](./DEPLOYMENT.md)** (デプロイガイド) と **[USER_MANUAL.md](./USER_MANUAL.md)** (ユーザーマニュアル) を参照してください。
>
> 旧 GAS 版のソースは `legacy_gas/` にバックアップしてあります。

## 機能概要

- **出席登録**: イベントごとに〇/× を一括登録。地区/実践部会/専門部会/氏名で絞り込み可能
- **イベント管理**: 分類(ブロック / 実践部会 / 専門部会 / 関連団体 / 全体事業など) + 日当対象フラグ付きで登録・編集・削除
- **ICS自動取込**: 設定済みの ICS URL から、年度開始〜終了の期間で一括取込 (同日同名は重複スキップ)
- **自動分類推定**: イベント名 + 「ICS取込ルール」シートから自動分類
- **メンバ管理**: 36名の初期メンバを自動投入。Web画面 / シートのどちらでも編集可
- **集計**: 上半期 / 下半期 / 通年 / 任意期間で、メンバ別・ブロック別に日当 (500円 × 日数) を計算。CSV 出力可
- **設定**: 年度開始日・終了日・上半期末・日当単価を画面から変更可能
- **設定ファイル**: `config.json` 1 つに集約。初回起動時の `/setup` 画面で GUI 設定 → ファイル書き込み
- **認証は鍵レス (ADC)**: サービスアカウント JSON キーを作らず、Cloud Run のランタイム SA や `gcloud auth application-default login` の認証を自動採用

## クイックスタート

```bash
# 1. 依存をインストール
npm install

# 2. ADC 認証 (鍵レス、ローカル開発用)
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID

# 3. サーバ起動
npm start
# → http://localhost:8080 → 自動で /setup へ

# 4. /setup でスプレッドシート ID を登録 (認証は ADC 自動採用)
#    → 自動でシート初期化 → アプリ利用開始
```

詳しくは [DEPLOYMENT.md](./DEPLOYMENT.md) を。

## ディレクトリ構成

```
arakawa_seishonen_attend/
├── README.md
├── DEPLOYMENT.md           # デプロイガイド (推奨環境別の手順)
├── USER_MANUAL.md          # ユーザマニュアル (アプリ利用者向け)
├── package.json
├── Dockerfile              # Cloud Run / 任意のコンテナ環境向け
├── .dockerignore
├── .gitignore
├── data/
│   ├── config.example.json # 設定の雛形
│   └── config.json         # 初回セットアップで生成 (gitignore対象)
├── server/                 # バックエンド (Node.js + Express)
│   ├── index.js            # メインの HTTP サーバ
│   ├── config.js           # config.json 読み書き
│   ├── sheets-client.js    # Google Sheets API ラッパ
│   ├── initializer.js      # シート初期化
│   ├── importer.js         # ICS取込 + 分類推定
│   ├── constants.js        # 初期メンバ・分類・ICS取込ルール
│   ├── utils.js            # 日付/時刻フォーマット等
│   └── api/
│       ├── members.js
│       ├── events.js
│       ├── attendance.js
│       └── summary.js
├── public/                 # フロントエンド (素のHTML/CSS/JS)
│   ├── app.html            # メインの SPA (旧 index.html + tab_*.html)
│   ├── setup.html          # 初回セットアップ画面
│   ├── styles.css
│   ├── scripts.js          # アプリのクライアント JS
│   └── setup.js            # セットアップ画面の JS
└── legacy_gas/             # 旧 Google Apps Script 版 (アーカイブ)
    ├── 00_Constants.gs
    └── ...
```

## 主要 API エンドポイント

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/setup/status` | セットアップ状況 |
| POST | `/api/setup/test-connection` | 認証情報の疎通テスト |
| POST | `/api/setup/create-spreadsheet` | 新規スプレッドシート作成 |
| POST | `/api/setup` | 設定の保存 + シート初期化 |
| GET | `/api/bootstrap` | アプリ起動時のデータ取得 |
| POST | `/api/initialize-spreadsheet` | シートの再構築 |
| GET / POST / PUT / DELETE | `/api/members[/:id]` | メンバ CRUD |
| GET / POST / PUT / DELETE | `/api/events[/:id]` | イベント CRUD |
| GET / POST / PUT / DELETE | `/api/classifications[/:id]` | 分類マスタ CRUD |
| GET / POST / PUT / DELETE | `/api/ics-rules[/:id]` | ICS取込ルール CRUD |
| GET | `/api/attendance/:eventId` | 指定イベントの出席状況 |
| POST | `/api/attendance/:eventId/bulk` | 出席の一括更新 |
| GET / POST | `/api/settings` | 設定の取得/更新 (`年度`等) |
| POST | `/api/summary/by-member` | メンバ別集計 |
| POST | `/api/ics-import` | ICS取込 |
| POST | `/api/dedup-events` | 重複イベント掃除 |

## ライセンス

社内利用向け。再配布不要。
