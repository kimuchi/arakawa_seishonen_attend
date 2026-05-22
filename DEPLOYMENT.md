# デプロイガイド (Google Cloud Run / 無料枠)

荒川区青少年委員連絡会 出席簿 (Node.js 版) を **Google Cloud Run の無料枠** にデプロイする手順です。

- ローカルでの動作確認は省略し、最初から Cloud Run にデプロイします。
- 認証は **Application Default Credentials (ADC) のみ** ── サービスアカウントの JSON キーは作りません。
- 設定 (スプレッドシート ID、ICS取込URL) は **GCS バケットに永続化された `config.json`** に保存します。
- データ本体 (出席記録など) は Google スプレッドシートに保存されます (GAS 版から変更なし)。

---

## 構成図

```
[ブラウザ] ──HTTPS──▶ [Cloud Run (Node.js)] ──Sheets API──▶ [Google スプレッドシート]
                          │      ▲
                          │      └─ ADC (ランタイム SA、鍵なし)
                          │
                          └─ Volume Mount ──▶ [GCS バケット: config.json]
```

---

## 0. 無料枠について

Cloud Run には毎月の **無料枠** があります (1課金アカウントあたり):

| リソース | 無料枠 (月) |
|---|---|
| リクエスト数 | 200万件 |
| vCPU 秒 | 18万 |
| メモリ GiB 秒 | 36万 |
| ネットワーク下り (北米) | 1 GB |

このアプリは数人〜数十人の利用想定で、無料枠に十分収まる規模です。**無料枠を超えないために、本ガイドでは以下を徹底します**:

- `--min-instances=0` (アイドル時は完全停止)
- `--max-instances=1` (1 インスタンスで十分)
- `--cpu-throttling` (デフォルト・リクエスト中のみ課金対象)
- `--memory=512Mi` (最小)
- リージョンは `asia-northeast1` (東京) を推奨

GCS については asia-northeast1 の Standard Storage が $0.023/GB-月で、設定ファイル (数 KB) なら実質 0 円です。

---

## 1. 事前準備

### 1.1 GCP プロジェクトと CLI

```bash
# gcloud CLI を入れる (macOS Homebrew の例)
brew install --cask google-cloud-sdk
gcloud auth login

# プロジェクトを作成 (既存プロジェクトでも可)
gcloud projects create YOUR_PROJECT_ID --name="Arakawa Shussekibo"
gcloud config set project YOUR_PROJECT_ID

# 課金アカウントをリンク (無料枠を使うにも課金アカウント設定は必須)
# Console: https://console.cloud.google.com/billing からリンク
```

### 1.2 必要な API を有効化

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  sheets.googleapis.com \
  drive.googleapis.com \
  iamcredentials.googleapis.com \
  storage.googleapis.com
```

### 1.3 Artifact Registry リポジトリ

```bash
gcloud artifacts repositories create apps \
  --repository-format=docker \
  --location=asia-northeast1
```

### 1.4 ランタイム サービスアカウント (鍵は作らない)

```bash
gcloud iam service-accounts create shussekibo-runner \
  --display-name "Arakawa Shussekibo Runner"
```

メールアドレス: `shussekibo-runner@YOUR_PROJECT_ID.iam.gserviceaccount.com`
これがアプリが Sheets/Drive にアクセスするアカウントです。**JSON キーは作成しません**。

### 1.5 設定永続化用 GCS バケット

```bash
# バケット名はグローバルでユニーク。プロジェクトIDを含めるのが簡単
gsutil mb -l asia-northeast1 gs://YOUR_PROJECT_ID-shussekibo-config

# ランタイム SA に読み書き権限
gsutil iam ch \
  serviceAccount:shussekibo-runner@YOUR_PROJECT_ID.iam.gserviceaccount.com:objectAdmin \
  gs://YOUR_PROJECT_ID-shussekibo-config
```

### 1.6 (既存スプレッドシートを使う場合) 共有

対象スプレッドシートを開き、右上の「共有」から
`shussekibo-runner@YOUR_PROJECT_ID.iam.gserviceaccount.com` を **編集者** として追加してください (通知メールはオフで OK)。

新規にスプレッドシートを作る場合はこのステップ不要。デプロイ後の `/setup` 画面に「新規スプレッドシートを作成」ボタンがあります。

---

## 2. ビルドとデプロイ

リポジトリのルートで以下を実行します。

```bash
# (1) コンテナイメージをビルド & Artifact Registry に Push
gcloud builds submit \
  --tag asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/apps/arakawa-shussekibo:latest

# (2) Cloud Run にデプロイ (無料枠向け設定)
gcloud run deploy arakawa-shussekibo \
  --image asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/apps/arakawa-shussekibo:latest \
  --region asia-northeast1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances 1 \
  --timeout 300 \
  --service-account shussekibo-runner@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --set-env-vars TZ=Asia/Tokyo \
  --add-volume name=cfg,type=cloud-storage,bucket=YOUR_PROJECT_ID-shussekibo-config \
  --add-volume-mount volume=cfg,mount-path=/app/data
```

各オプションの意味:

| オプション | 効果 |
|---|---|
| `--allow-unauthenticated` | URL を知っていれば誰でもアクセス可。組織アカウントでガードしたい場合は `--no-allow-unauthenticated` に |
| `--memory 512Mi` `--cpu 1` | 無料枠に収まる最小構成 |
| `--concurrency 1` | 同時 1 リクエストずつ処理 (出席簿用途では充分) |
| `--min-instances 0` | **重要**。アイドル時はインスタンス 0 で無料 |
| `--max-instances 1` | スケールアウトしない (`config.json` の整合性を守るためにも 1 固定) |
| `--service-account` | ADC で使われるランタイム SA |
| `--set-env-vars TZ=Asia/Tokyo` | ICS取込時の時刻ズレ防止 |
| `--add-volume` / `--add-volume-mount` | `config.json` を GCS バケットに永続化 |

デプロイが完了すると `https://arakawa-shussekibo-XXXXXXXX-an.a.run.app` のような URL が表示されます。

---

## 3. 初回セットアップ (ブラウザから)

1. 表示された Cloud Run の URL を開く → 自動的に `/setup` にリダイレクト
2. 画面の「使用中のアカウント」欄に `shussekibo-runner@YOUR_PROJECT_ID.iam.gserviceaccount.com` が表示されていることを確認
3. 既存スプレッドシートを使う場合: そのスプレッドシート ID を入力
   - 新規作成する場合: 「共有先メールアドレス」に自分の Google アカウントを入れて「新規スプレッドシートを作成」を押す → ID が自動入力される
4. (任意) ICS取込URL を入力
5. 「💾 設定を保存して初期化」を押す → `config.json` が GCS バケットに書き込まれ、スプレッドシートの初期化 (シート作成 + 初期メンバ投入) が走ります
6. 3 秒後に `/` にリダイレクト → アプリ画面に遷移

これで完了。利用者には Cloud Run の URL を共有してください。

---

## 4. 設定の更新

設定タブの「キー / 値」(年度・日当単価など) は画面から直接保存できます。

スプレッドシート ID / ICS取込URL を変更したい場合は、ヘッダの「🔧 設定」または `/setup` を直接開いて、再度入力 → 「保存」してください。

---

## 5. アップデート手順

新しいバージョンを反映するには再ビルド & 再デプロイのみ:

```bash
gcloud builds submit \
  --tag asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/apps/arakawa-shussekibo:latest

gcloud run deploy arakawa-shussekibo \
  --image asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/apps/arakawa-shussekibo:latest \
  --region asia-northeast1
```

`config.json` は GCS バケット側にあるので、Cloud Run を更新してもデータ・設定は保持されます。スプレッドシート本体も影響を受けません。

---

## 6. 無料枠を超えないためのコツ

- **`--min-instances=0` を必ず守る**。1 にすると常時起動でほぼ確実に無料枠を超えます
- **`--max-instances=1` を維持**。`config.json` への同時書き込みを避ける目的でも 1 が安全です
- 不要になったコンテナイメージは Artifact Registry でローテーション
  - `gcloud artifacts docker images list asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/apps`
  - 古いタグを削除すると Storage 課金が減ります
- Cloud Build の無料枠 (1 日 120 分) で十分。CI 連携してビルド回数を制限してください

---

## 7. バックアップ・復旧

- **データ本体**: スプレッドシートは Google Drive の「バージョン履歴」(ファイル → バージョン履歴) から過去状態に戻せます。重要な節目で「名前付きバージョン」を保存しておくと安心です
- **設定**: `gsutil cp gs://YOUR_PROJECT_ID-shussekibo-config/config.json ~/Backup/` で随時バックアップ。`config.json` は秘密鍵を含まないので保管も気軽に

---

## 8. トラブルシュート

| 症状 | 対処 |
|---|---|
| デプロイ後 `/setup` で「ADC が検出できません」 | `--service-account shussekibo-runner@...` の指定漏れ。`gcloud run services describe arakawa-shussekibo --region asia-northeast1` で確認 |
| 「接続テスト」で `The caller does not have permission` | スプレッドシートに `shussekibo-runner@...` を「編集者」共有 |
| 接続テスト OK でも `/` で 503 が返る | 「設定を保存して初期化」未実行。`/setup` から再度保存 |
| `config.json` が読めない / 書けない | GCS バケットへの権限 (`objectAdmin`) を確認。Volume Mount の bucket 名が正しいかも要確認 |
| ICS取込で 0 件 | URL が iCal フィードか / 年度開始-終了の範囲内にイベントがあるかを確認 |
| 起動が遅い (コールドスタート) | `--min-instances=0` の影響。許容できなければ 1 にすると常時起動だが無料枠は超える |
| 無料枠超過の請求が来そう | Console → 課金 → 予算アラート で月額予算を $0 や $1 に設定 |

---

## 9. セキュリティ上の注意

- **SA キー JSON を作らない** 方針。必要になっても極力作成しないでください
- ログイン機構はありません。**公開 URL を不特定多数に共有しない** 運用を前提としています
- 利用者を限定したい場合は次のいずれかを検討:
  - `--no-allow-unauthenticated` + 利用者の Google アカウントに `roles/run.invoker` を付与 (組織アカウントで認証強制)
  - Cloud Load Balancer + IAP 経由でアクセス
- `config.json` には秘密鍵は含まれませんが、`spreadsheetId` の漏洩 = アクセス URL が推測されるリスクなので、GCS バケットは公開せず IAM で絞ってください

---

## 10. 削除 (片付け)

不要になった場合:

```bash
gcloud run services delete arakawa-shussekibo --region asia-northeast1
gsutil rm -r gs://YOUR_PROJECT_ID-shussekibo-config
gcloud artifacts repositories delete apps --location=asia-northeast1
gcloud iam service-accounts delete shussekibo-runner@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

スプレッドシートは Google ドライブに残ります (Cloud Run から切り離されるだけ)。

以上。
