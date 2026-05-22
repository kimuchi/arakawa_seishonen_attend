# デプロイガイド

荒川区青少年委員連絡会 出席簿 (Node.js / Cloud Run 版) のセットアップ・デプロイ手順をまとめます。

- **データ保存先**: Google スプレッドシート (これは GAS 版から変更なし)
- **アプリ実行環境**: Node.js 18+ (任意のサーバ・コンテナ環境で動作)
- **設定**: 単一の `config.json` ファイル + 初回起動時のセットアップ画面 (`/setup`)
- **認証**: **Application Default Credentials (ADC) のみ** ── サービスアカウントの JSON キーは作成しません
- **ログイン機構**: なし (アプリにアクセスできる利用者は全員フル機能を使えます)

---

## 構成図

```
[ブラウザ] ── HTTP ──▶ [Node.js (Express)] ── Google API ──▶ [Google Sheets]
                              │  ▲
                              │  └─ ADC (Cloud Run の SA / gcloud ADC / WIF)
                              │
                              └─ config.json (スプレッドシートID・ICS取込URL等)
```

`config.json` に **秘密鍵は保存しません**。 認証は実行環境の Application Default Credentials を使い、Cloud Run ならランタイム SA、ローカルなら `gcloud auth application-default login` の認証情報が自動採用されます。

---

## 0. 前提

| 項目 | 要件 |
|---|---|
| Node.js | 18 以上 (Cloud Run の Dockerfile では Node 22) |
| Google Cloud アカウント | 1つ。プロジェクトを作成できる権限 |
| Google スプレッドシート | アプリが使う SA のメールアドレスに編集権限を付与できるもの (なければ起動後に作成可能) |

---

## 1. Google Cloud 側の準備 (鍵レス)

### 1.1 プロジェクトの作成

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. 上部のプロジェクト選択 → 「新しいプロジェクト」を作成 (既存プロジェクトでも可)

### 1.2 API の有効化

[API ライブラリ](https://console.cloud.google.com/apis/library) で次の 2 つを有効化:

- **Google Sheets API**
- **Google Drive API**  (※ 新規スプレッドシート作成 / 共有設定で使用)

### 1.3 サービスアカウントの作成 (キーは作らない)

1. [サービスアカウント](https://console.cloud.google.com/iam-admin/serviceaccounts) → 「サービスアカウントを作成」
2. 名前: `shussekibo-runner` (任意)
3. プロジェクト権限の付与は不要 (このアプリはユーザーが共有したスプレッドシート以外にはアクセスしません)
4. **「キー」タブで JSON キーを作成しない** ── キー漏洩・ローテーション運用の手間を排除するのが今回の方針です。
5. 作成後に表示されるメールアドレス (例: `shussekibo-runner@your-project.iam.gserviceaccount.com`) を控えておきます。これがアプリが使うアカウントです。

### 1.4 (既存スプレッドシートを使う場合) 共有設定

サービスアカウントのメールアドレスを、対象スプレッドシートの「共有」から **編集者** として追加してください (通知メールはオフで OK)。

### 1.5 (新規にスプレッドシートを作る場合)

そのままで OK です。後述のセットアップ画面に「新規スプレッドシートを作成」ボタンがあります。SA のドライブ上に作成されるので、セットアップ画面で共有先メールアドレスを指定し、自分の Google アカウントを編集者に入れておくのがおすすめです。

---

## 2. ローカルでの動作確認

開発・運用前の動作確認に。

```bash
# 1. リポジトリを取得
git clone <このリポジトリ>
cd arakawa_seishonen_attend

# 2. 依存インストール
npm install

# 3. ADC の準備 (鍵レス)
gcloud auth application-default login
gcloud auth application-default set-quota-project <あなたの GCP プロジェクトID>

# 4. 起動
npm start
# → http://localhost:8080 にアクセス → 自動的に /setup へリダイレクト
```

> `gcloud auth application-default login` を 1 回実行すると、`~/.config/gcloud/application_default_credentials.json` に短命の OAuth リフレッシュトークンが保存されます。アプリはこれを ADC として自動採用します。
>
> **注意**: この方法だと "アプリがアクセスする Google アカウント" は **あなたのユーザ アカウント** になります。試運用には十分ですが、本番ではユーザー個人ではなくサービスアカウントで動かしたいので、次節の Cloud Run などにデプロイしてください。

ブラウザで `/setup` を開き、以下を入力 → 「設定を保存して初期化」:

1. **使用中のアカウント** が表示されているか確認 (ADC が効いているかの目安)
2. スプレッドシート ID (URL の `/d/【ここ】/edit` 部分) または「新規スプレッドシートを作成」
3. ICS取込URL (任意)

設定が `./data/config.json` に保存され、自動でスプレッドシート上に必要シート(メンバ・イベント・出席・設定・分類マスタ・ICS取込ルール) が作成されます。

> 設定後は `/` がアプリ画面になります。設定をやり直すときはヘッダの「🔧 設定」リンク、または `/setup` を直接開いてください。

---

## 3. デプロイ方法

プラットフォーム非依存。代表的な4パターンを記載します。

### A. Google Cloud Run (推奨: マネージドで鍵レス運用)

Cloud Run はランタイム SA を紐付けるだけで ADC が自動で効くので、JSON キーは不要です。`config.json` は Cloud Run の **Volume Mount** で GCS バケットに永続化します。

#### A-1. 事前準備

```bash
gcloud config set project YOUR_PROJECT_ID

# (a) アプリ用のサービスアカウント (鍵は作らない)
gcloud iam service-accounts create shussekibo-runner \
  --display-name "Arakawa Shussekibo Runner"

# (b) 設定永続化用の GCS バケット
gsutil mb -l asia-northeast1 gs://YOUR_PROJECT_ID-shussekibo-config

# (c) ランタイム SA に GCS バケットへの読み書き権限
gsutil iam ch \
  serviceAccount:shussekibo-runner@YOUR_PROJECT_ID.iam.gserviceaccount.com:objectAdmin \
  gs://YOUR_PROJECT_ID-shussekibo-config

# (d) 対象スプレッドシートに上記 SA を「編集者」で共有しておく
#     (新規作成する場合はこのステップ不要。/setup の「新規作成」ボタンを使う)
```

#### A-2. デプロイ

```bash
# (1) コンテナイメージをビルド (Artifact Registry を使う想定)
gcloud builds submit --tag asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/apps/arakawa-shussekibo:latest

# (2) デプロイ
#     --service-account でランタイム SA を指定 → アプリ側で ADC が自動的に有効
#     --add-volume / --add-volume-mount で config.json を GCS に永続化
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

`--concurrency 1`、`--max-instances 1` にしているのは、`config.json` ファイルへの同時書き込みや排他制御を単純化するためです。本アプリは数百件/日 規模を想定しており単一インスタンスで十分です。

#### A-3. 初回セットアップ

Cloud Run が払い出した URL の末尾に `/setup` をつけてアクセスし、画面に表示される「使用中のアカウント」(= 上で指定した `shussekibo-runner@...`) が対象スプレッドシートに編集者で共有されていることを確認 → スプレッドシート ID を入れて「設定を保存して初期化」。

`config.json` は GCS バケット上に永続化されるので、コンテナが再起動しても消えません。

### B. オンプレ Linux サーバ / VPS (systemd)

ADC は **環境変数 `GOOGLE_APPLICATION_CREDENTIALS` が指す SA キー JSON** で動かすこともできますが、今回はキーレス方針なので、推奨は次のいずれか:

- **Workload Identity Federation (WIF)** で OIDC 認証 (オンプレ → GCP)
- **gcloud user credentials** をサーバ上でセットアップ (`gcloud auth application-default login`)

WIF が使える環境ならそれが最も安全です。簡易には gcloud user 認証で運用できます。

```bash
# Node.js 22 を入れる (例: NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# gcloud をインストールして実行ユーザで ADC ログイン
sudo apt-get install -y google-cloud-cli
sudo -u www-data gcloud auth application-default login
sudo -u www-data gcloud auth application-default set-quota-project YOUR_PROJECT_ID

# アプリ配置
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
# WIF を使う場合は GOOGLE_APPLICATION_CREDENTIALS=/path/to/wif-config.json
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

### C. Docker (任意のコンテナ環境)

ADC はコンテナ内では自動で検出できないため、明示的に渡します。

#### C-1. ローカルで動かす (個人開発)

```bash
docker build -t arakawa-shussekibo:latest .

# ホスト側 gcloud ADC をマウントして使う
docker run -d --name arakawa-shussekibo \
  -p 8080:8080 \
  -v $(pwd)/data:/app/data \
  -v $HOME/.config/gcloud:/home/node/.config/gcloud:ro \
  -e GOOGLE_APPLICATION_CREDENTIALS=/home/node/.config/gcloud/application_default_credentials.json \
  arakawa-shussekibo:latest
```

#### C-2. 任意のクラウド/VPS のコンテナ環境

GCP 外なら **Workload Identity Federation の構成ファイル** をマウントするのが鍵レスで推奨。

```bash
docker run -d --name arakawa-shussekibo \
  -p 8080:8080 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/wif/clientLibraryConfig.json:/app/wif.json:ro \
  -e GOOGLE_APPLICATION_CREDENTIALS=/app/wif.json \
  arakawa-shussekibo:latest
```

> WIF が組めない環境では、最終手段として「制限を絞った SA キー」を使うこともできますが、ローテーション運用が必要です。可能ならクラウドが提供するマネージド ID (Cloud Run / EKS の IRSA / Azure Workload Identity 等) を使ってください。

### D. Google Compute Engine / GKE

Cloud Run と同じく、インスタンス/Pod の SA を紐付けるだけで ADC が効きます。
GKE では Workload Identity を有効化して KSA に GSA をバインド → デプロイ。手順は GCP 公式を参照。

---

## 4. 設定ファイル仕様 (`config.json`)

```json
{
  "spreadsheetId": "1AbCdEfG...",
  "icsImportUrl": "https://calendar.google.com/calendar/ical/.../basic.ics",
  "port": 8080
}
```

| キー | 必須 | 説明 |
|---|---|---|
| `spreadsheetId` | ✔︎ | データを書き込むスプレッドシートの ID |
| `icsImportUrl` | | ICS取込時の URL |
| `port` | | リッスンポート (デフォルト 8080。環境変数 `PORT` が優先) |

**認証情報は config に書きません。** ADC の検出順は以下のとおりです (googleapis 内部で自動処理):

1. `GOOGLE_APPLICATION_CREDENTIALS` 環境変数が指すファイル (WIF 構成 / 旧 SA キー JSON)
2. `gcloud auth application-default login` の結果 (`~/.config/gcloud/application_default_credentials.json`)
3. GCP メタデータサーバ (Cloud Run / GCE / GKE / Cloud Functions のランタイム SA)

**その他の環境変数**

| 環境変数 | 用途 |
|---|---|
| `CONFIG_PATH` | `config.json` の置き場所 (デフォルト `./data/config.json`) |
| `PORT` | リッスンポート |
| `TZ` | タイムゾーン。**ICS取込で時刻ズレが起きないよう `Asia/Tokyo` 推奨** |

---

## 5. アップデート手順

### Cloud Run

```bash
gcloud builds submit --tag asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/apps/arakawa-shussekibo:latest
gcloud run deploy arakawa-shussekibo --image asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/apps/arakawa-shussekibo:latest --region asia-northeast1
```

### VPS

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
docker run ... arakawa-shussekibo:latest
```

アプリ側のロジックや UI を更新する場合、データ (スプレッドシート) はそのまま使えます。

---

## 6. バックアップ・復旧

- **データ本体**: スプレッドシートは Google Drive の世代管理 (「ファイル」→「バージョン履歴」) で復旧可能。さらに重要なら、定期エクスポート (CSV / XLSX) する仕組みを追加してください。
- **設定**: `data/config.json` を別の安全な場所(USBメモリ / 別のクラウドストレージ)にコピーしておくと、復旧が早くなります。秘密情報は含まれません。

---

## 7. トラブルシュート

| 症状 | 対処 |
|---|---|
| `/setup` で「ADC が検出できません」 | Cloud Run なら `--service-account` 指定を確認。ローカルなら `gcloud auth application-default login` を実行 |
| 「接続テスト」で `The caller does not have permission` | スプレッドシートに「使用中のアカウント」を「編集者」共有 |
| 接続テスト OK でも `/` で 503 が返る | 「設定を保存して初期化」を実行していない可能性。/setup に戻って「設定を保存して初期化」 |
| Cloud Run で `config.json` が消える | Volume マウントが正しいか確認。`--add-volume` を忘れていると永続化されません |
| ICS取込で 0 件 | URL が iCal フィードか確認。年度開始/終了の範囲内にイベントがあるかも要確認 |
| 「使用中のアカウント」が個人メールアドレスになる | ローカル開発で `gcloud auth application-default login` を実行した状態。本番デプロイ時は Cloud Run の SA が表示されます |

---

## 8. セキュリティ上の注意

- **JSON キーは作らない方針** です。万一 SA キーを使う場合は、最低権限・短期ローテーション・Secret Manager 経由の取り扱いを徹底してください。
- ログイン機構はありません。**公開 URL を不特定多数に共有しない** 運用を前提としています。
- Cloud Run の場合、`--no-allow-unauthenticated` で IAM 認証を要求する、Cloud Load Balancer + IAP で組織アカウント認証を被せる、等の対策を別途検討してください。
- `config.json` には秘密鍵は含まれませんが、`spreadsheetId` の漏洩 = アクセスURLが推測されるリスクなので、サーバ上のパーミッションは `0600` で保存されます。

以上。
