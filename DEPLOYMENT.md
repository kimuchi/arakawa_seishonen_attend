# デプロイガイド

荒川区青少年委員連絡会 出席簿 (Node.js / Cloud Run 版) のセットアップ・デプロイ手順をまとめます。

- **データ保存先**: Google スプレッドシート (これは GAS 版から変更なし)
- **アプリ実行環境**: Node.js 18+ (任意のサーバ・コンテナ環境で動作)
- **設定**: 単一の `config.json` ファイル + 初回起動時のセットアップ画面 (`/setup`)
- **ログイン機構**: なし (アプリにアクセスできる利用者は全員フル機能を使えます)

---

## 構成図

```
[ブラウザ] ── HTTP ──▶ [Node.js (Express)] ── Google API ──▶ [Google Sheets]
                              │
                              └─ config.json (認証情報・スプレッドシートID等)
```

---

## 0. 前提

| 項目 | 要件 |
|---|---|
| Node.js | 18 以上 (Cloud Run の Dockerfile では Node 22) |
| Google Cloud アカウント | 1つ。プロジェクトを作成できる権限 |
| Google スプレッドシート | サービスアカウントに編集権限を付与できるもの (なければ起動後に作成可能) |

---

## 1. Google Cloud 側の準備

### 1.1 プロジェクトの作成

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. 上部のプロジェクト選択 → 「新しいプロジェクト」を作成 (既存プロジェクトでも可)

### 1.2 API の有効化

[API ライブラリ](https://console.cloud.google.com/apis/library) で次の 2 つを有効化:

- **Google Sheets API**
- **Google Drive API**  (※ 新規スプレッドシート作成 / 共有設定で使用)

### 1.3 サービスアカウントの作成

1. [サービスアカウント](https://console.cloud.google.com/iam-admin/serviceaccounts) → 「サービスアカウントを作成」
2. 名前: `attendance-bot` (任意)、説明: `荒川区出席簿アプリ`
3. 役割は付与不要 (アプリは自分が作成したスプレッドシート以外にはアクセスしません)
4. 作成後、対象アカウントの「キー」タブ →「鍵を追加」→ **JSON** を選択
5. ダウンロードされた JSON ファイルを **大切に保管** (これがアプリの認証情報になります)

### 1.4 (既存スプレッドシートを使う場合) シートを共有

サービスアカウントのメールアドレス (例: `attendance-bot@your-project.iam.gserviceaccount.com`) を、対象スプレッドシートの「共有」から **編集者** として追加してください。

### 1.5 (新規にスプレッドシートを作る場合)

そのままで OK です。後述のセットアップ画面に「新規スプレッドシートを作成」ボタンがあります。サービスアカウントのドライブ上に作成されるので、必要に応じてセットアップ画面で共有先メールアドレスを指定してください。

---

## 2. ローカルでの動作確認

開発・運用前の動作確認に。

```bash
# 1. リポジトリを取得
git clone <このリポジトリ>
cd arakawa_seishonen_attend

# 2. 依存インストール
npm install

# 3. 起動
npm start
# → http://localhost:8080 にアクセス → 自動的に /setup へリダイレクト
```

ブラウザで `/setup` を開き、以下を入力 → 「設定を保存して初期化」:

1. サービスアカウント JSON (1.3 でダウンロードしたファイルの中身をそのまま貼る)
2. スプレッドシート ID (URL の `/d/【ここ】/edit` 部分) または「新規スプレッドシートを作成」
3. ICS取込URL (任意)

設定が `./data/config.json` に保存され、自動でスプレッドシート上に必要シート(メンバ・イベント・出席・設定・分類マスタ・ICS取込ルール) が作成されます。

> **NOTE**: 設定後は `/` がアプリ画面になります。設定をやり直すときはヘッダの「🔧 設定」リンク、または `/setup` を直接開いてください。

---

## 3. デプロイ方法

プラットフォーム非依存。代表的な4パターンを記載します。

### A. オンプレ Linux サーバ / VPS (systemd)

長期運用に向く最もシンプルな選択肢。

```bash
# Node.js 22 を入れる (例: NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# アプリを置く
sudo mkdir -p /opt/arakawa-shussekibo
sudo chown $USER /opt/arakawa-shussekibo
cd /opt/arakawa-shussekibo
git clone <このリポジトリ> .
npm ci --omit=dev

# systemd ユニット
sudo tee /etc/systemd/system/arakawa-shussekibo.service > /dev/null <<EOF
[Unit]
Description=Arakawa Seishonen Shussekibo
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/arakawa-shussekibo
Environment=PORT=8080
Environment=TZ=Asia/Tokyo
Environment=CONFIG_PATH=/opt/arakawa-shussekibo/data/config.json
ExecStart=/usr/bin/node server/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo mkdir -p /opt/arakawa-shussekibo/data
sudo chown -R www-data:www-data /opt/arakawa-shussekibo/data
sudo systemctl daemon-reload
sudo systemctl enable --now arakawa-shussekibo
```

`https://(サーバホスト):8080/setup` を開いてセットアップ → 完了。

リバースプロキシ(Nginx/Caddy)を前段に置くと、HTTPS化や 80/443 への変換が簡単です。

### B. Docker (任意のコンテナ環境)

```bash
# ビルド
docker build -t arakawa-shussekibo:latest .

# 設定永続化のためにボリュームをマウント
docker run -d --name arakawa-shussekibo \
  -p 8080:8080 \
  -v $(pwd)/data:/app/data \
  arakawa-shussekibo:latest

# 初回は http://localhost:8080/setup でセットアップ
```

### C. Google Cloud Run + GCS Volume Mount (推奨: マネージドで運用)

Cloud Run は基本的にステートレスですが、Cloud Run の **Volume Mount** 機能で GCS バケットをマウントすれば `config.json` を永続化できます。

#### C-1. 事前準備

```bash
gcloud config set project YOUR_PROJECT_ID

# 設定永続化用の GCS バケット
gsutil mb -l asia-northeast1 gs://YOUR_PROJECT_ID-shussekibo-config

# サービスアカウントを作成 (Cloud Run 実行用)
gcloud iam service-accounts create shussekibo-runner \
  --display-name "Arakawa Shussekibo Runner"

# このアカウントに GCS バケットの読み書き権限
gsutil iam ch \
  serviceAccount:shussekibo-runner@YOUR_PROJECT_ID.iam.gserviceaccount.com:objectAdmin \
  gs://YOUR_PROJECT_ID-shussekibo-config
```

#### C-2. デプロイ

```bash
# (1) コンテナイメージをビルド (Artifact Registry を使う想定)
gcloud builds submit --tag asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/apps/arakawa-shussekibo:latest

# (2) デプロイ (--add-volume と --add-volume-mount で /app/data に GCS をマウント)
gcloud run deploy arakawa-shussekibo \
  --image asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/apps/arakawa-shussekibo:latest \
  --region asia-northeast1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances 1 \
  --memory 512Mi \
  --service-account shussekibo-runner@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --set-env-vars TZ=Asia/Tokyo \
  --add-volume name=cfg,type=cloud-storage,bucket=YOUR_PROJECT_ID-shussekibo-config \
  --add-volume-mount volume=cfg,mount-path=/app/data
```

`--concurrency 1`、`--max-instances 1` にしているのは、`config.json` ファイルへの同時書き込みや排他制御を単純化するためです。利用人数が増えても、本アプリは数百件/日 規模を想定しており単一インスタンスで十分です。

#### C-3. 初回セットアップ

Cloud Run が払い出した URL の末尾に `/setup` をつけてアクセス → 認証情報やスプレッドシート ID を入力して保存。`config.json` は GCS バケット上に永続化されます。

### D. Google Cloud Run + Secret Manager (シークレットを Secret に分ける)

`config.json` 全体を Secret Manager に置き、コンテナにマウントする構成。

```bash
# シークレットを作る (テキスト=config.json の中身)
gcloud secrets create shussekibo-config --replication-policy="automatic"
gcloud secrets versions add shussekibo-config --data-file=./data/config.json

# Cloud Run の SA からアクセス権
gcloud secrets add-iam-policy-binding shussekibo-config \
  --member="serviceAccount:shussekibo-runner@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# デプロイ (シークレットを /app/data/config.json にマウント)
gcloud run deploy arakawa-shussekibo \
  --image ... \
  --update-secrets=/app/data/config.json=shussekibo-config:latest
```

> Secret Manager にマウントしたファイルは読み取り専用です。**設定タブからの編集は反映されないため、設定変更時は Secret のバージョンを更新する** 必要があります。
>
> 「画面から設定を保存できるようにする」要件を重視するなら、上の C (GCS Volume) を推奨します。

---

## 4. 設定ファイル仕様 (`config.json`)

```json
{
  "spreadsheetId": "1AbCdEfG...",
  "icsImportUrl": "https://calendar.google.com/calendar/ical/.../basic.ics",
  "port": 8080,
  "googleCredentials": {
    "type": "service_account",
    "project_id": "...",
    "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
    "client_email": "attendance-bot@your-project.iam.gserviceaccount.com",
    "...": "..."
  }
}
```

| キー | 必須 | 説明 |
|---|---|---|
| `spreadsheetId` | ✔︎ | データを書き込むスプレッドシートの ID |
| `googleCredentials` | △ | サービスアカウント JSON。`googleCredentialsPath` または環境変数で代替可。 |
| `googleCredentialsPath` | △ | サービスアカウント JSON ファイルのサーバ内パス |
| `icsImportUrl` | | ICS取込時の URL |
| `port` | | リッスンポート (デフォルト 8080。環境変数 `PORT` が優先) |

**環境変数で上書き可能**

| 環境変数 | 用途 |
|---|---|
| `CONFIG_PATH` | `config.json` の置き場所 (デフォルト `./data/config.json`) |
| `PORT` | リッスンポート |
| `TZ` | タイムゾーン。**ICS取込で時刻ズレが起きないよう `Asia/Tokyo` 推奨** |
| `GOOGLE_APPLICATION_CREDENTIALS` | サービスアカウント JSON のパス (config 未指定時のフォールバック) |
| `GOOGLE_CREDENTIALS_JSON` | サービスアカウント JSON の生 JSON 文字列 (config 未指定時のフォールバック) |

`CONFIG_PATH` を変えると、Cloud Run の Secret Mount や Docker Secret などに合わせやすくなります。

---

## 5. アップデート手順

### ローカル / VPS

```bash
git pull
npm ci --omit=dev
sudo systemctl restart arakawa-shussekibo
```

### Docker

```bash
git pull
docker build -t arakawa-shussekibo:latest .
docker stop arakawa-shussekibo && docker rm arakawa-shussekibo
docker run -d --name arakawa-shussekibo -p 8080:8080 -v $(pwd)/data:/app/data arakawa-shussekibo:latest
```

### Cloud Run

```bash
gcloud builds submit --tag asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/apps/arakawa-shussekibo:latest
gcloud run deploy arakawa-shussekibo --image asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/apps/arakawa-shussekibo:latest --region asia-northeast1
```

アプリ側のロジックや UI を更新する場合、データ (スプレッドシート) はそのまま使えます。

---

## 6. バックアップ・復旧

- **データ本体**: スプレッドシートは Google Drive の世代管理 (「ファイル」→「バージョン履歴」) で復旧可能。さらに重要なら、`gcloud sheets` 等で定期エクスポート (CSV / XLSX) する仕組みを追加してください。
- **設定**: `data/config.json` を別の安全な場所(USBメモリ / 別のクラウドストレージ)にコピーしておくと、復旧が早くなります。

---

## 7. トラブルシュート

| 症状 | 対処 |
|---|---|
| `/setup` にアクセスすると "認証情報が未設定" のまま | サービスアカウント JSON を貼り付け直してから「設定を保存して初期化」 |
| 「接続テスト」で `The caller does not have permission` | スプレッドシートにサービスアカウントを「編集者」共有 |
| 接続テスト OK でも `/` で 503 が返る | 「設定を保存して初期化」を実行していない可能性。/setup に戻って「設定を保存して初期化」 |
| Cloud Run で `config.json` が消える | Volume / Secret マウントが正しいか確認。`--add-volume` を忘れていると永続化されません |
| ICS取込で 0 件 | URL が iCal フィードか確認。年度開始/終了の範囲内にイベントがあるかも要確認 |

---

## 8. セキュリティ上の注意

- ログイン機構はありません。**公開 URL を不特定多数に共有しない** 運用を前提としています。
- Cloud Run の場合、`--no-allow-unauthenticated` で IAM 認証を要求する、Cloud Load Balancer + IAP で組織アカウント認証を被せる、等の対策を別途検討してください。
- `config.json` には秘密鍵が含まれます。サーバ上のパーミッションは `0600` で保存されますが、ホストレベルのアクセス制御も適切に。

以上。
