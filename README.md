# 荒川区青少年委員連絡会 出席簿システム（2026年度版）

Googleスプレッドシートをデータベースとして、Google Apps Script + HtmlService で動作するWeb出席簿システムです。

## 機能概要

- **出席登録**：イベントごとに〇×を一括登録。地区／実践部会／専門部会／氏名でメンバを絞り込み可能
- **イベント管理**：分類（ブロック／実践部会／専門部会／関連団体／全体事業など）と日当対象フラグ付きで登録・編集・削除
- **ICS自動取込**：Script Properties に設定した ICS URL から期間指定で一括取込（同日・同名は重複スキップ）
- **自動分類推定**：イベント名から分類を推定（「定例会」「南千住ブロック」「広報部会」等）
- **メンバ管理**：36名の初期メンバ投入後、Web画面・シート直接編集のどちらでも参照変更可
- **集計**：上半期／下半期／通年／任意期間で、メンバ別・イベント別に日当（500円×日数）を計算。CSV出力対応
- **設定**：年度開始日・終了日・上半期末・日当単価を画面から変更可能

## ディレクトリ構成

```
seishonen_shussekibo/
├── README.md
└── src/
    ├── appsscript.json         # マニフェスト（タイムゾーン／スコープ／WebApp設定）
    ├── 00_Constants.gs         # 定数・36名の初期メンバデータ・33種の初期分類
    ├── 10_Initializer.gs       # 初期化（スプレッドシート作成・各シート構築）
    ├── 20_Importer.gs          # ICS取込・自動分類（同日同名は重複スキップ）
    ├── 30_WebApp.gs            # doGet・ブートストラップ
    ├── 40_Members_Api.gs       # メンバCRUD
    ├── 50_Events_Api.gs        # イベントCRUD・分類マスタ
    ├── 60_Attendance_Api.gs    # 出席登録・一括更新
    ├── 70_Summary_Api.gs       # 集計・設定取得
    ├── 99_Utils.gs             # ユーティリティ（ロック・日付整形など）
    ├── appsscript.json
    ├── index.html
    ├── tab_dashboard.html   # ダッシュボードの初期プレースホルダ
    ├── tab_attendance.html  # 出席登録タブの初期プレースホルダ
    ├── tab_events.html      # イベント管理タブの初期プレースホルダ
    ├── tab_members.html     # メンバ管理タブの初期プレースホルダ
    ├── tab_summary.html     # 集計タブの初期プレースホルダ
    ├── tab_settings.html    # 設定タブの初期プレースホルダ
    ├── styles.html
    └── scripts.html
```

## セットアップ手順

### A. claspを使う場合（推奨）

1. 事前準備

   ```bash
   npm install -g @google/clasp
   clasp login
   ```

2. 新規スタンドアロンスクリプトを作成

   ```bash
   cd seishonen_shussekibo
   clasp create --type standalone --title "荒川青少年出席簿 2026"
   ```

3. `src/` に `.clasp.json` を寄せて push

   `.clasp.json`（自動生成されたものを編集）:

   ```json
   { "scriptId": "（create で生成されたID）", "rootDir": "./src" }
   ```

   ```bash
   clasp push -f
   clasp open-script
   ```

4. GASエディタで `createNewSpreadsheet` を1回だけ実行
   - 初回だけOAuth認可ダイアログが出るので承認
   - 実行後、ログにスプレッドシートのURLが表示され、必要シート（メンバ/イベント/出席/設定/分類）まで自動作成される

### B. clasp を使わずブラウザで直接貼り付ける場合

1. [script.google.com](https://script.google.com) で新規プロジェクト作成
2. マニフェストを表示する設定をONにして `appsscript.json` を貼り付け
3. 各 `.gs` と `.html` ファイルを同名で作成して中身を貼り付け
   - `.gs` は拡張子なしの「スクリプト」として追加
   - `.html` は「ファイル → HTML」として追加（`index`, `styles`, `scripts`）
4. `createNewSpreadsheet` を実行

## 初期化の2パターン

| 関数 | 用途 |
|---|---|
| `createNewSpreadsheet()` | スタンドアロン運用で、新規スプレッドシートを作成し、そのまま初期化まで実行する |
| `initializeSpreadsheet()` | すでにバインドされたスプレッドシート、または `PROP_KEYS.SPREADSHEET_ID` に保存済みのIDに対して初期化・再整備する |

どちらも、メンバ／分類マスタ／設定は **初回のみデータ投入** し、2回目以降はヘッダ行のみ再構築します（既存データは保持）。

## Web アプリとしてデプロイ（clasp）

`src/appsscript.json` に Web アプリ設定（`executeAs: USER_DEPLOYING`, `access: DOMAIN`）を含めているため、デプロイもCLIで完結できます。

1. 最新コードを push

   ```bash
   clasp push -f
   ```

2. 初回デプロイ（新規Deploymentを作る）

   ```bash
   clasp version "initial webapp release"
   clasp deploy --description "prod"
   ```

3. 2回目以降の更新デプロイ（同じDeployment IDを更新）

   ```bash
   clasp version "update: 変更内容メモ"
   clasp deploy --deploymentId <初回に発行されたDeployment ID> --description "prod"
   ```

4. URL確認と共有
   - `clasp open-script` でスクリプトエディタを開く
   - 「デプロイを管理」から対象Deploymentの **WebアプリURL** を確認して会員に共有

## ICS自動取込の使い方

出席簿Webアプリ → 「イベント管理」タブ → 「🔄 ICSを自動取込」ボタン

1. Script Properties に `ICS_IMPORT_URL` を設定（例：Googleカレンダーの秘密アドレス(iCal)）
2. 取込ボタンを押す
3. 年度開始日〜年度終了日の期間で自動取込

> 同じ「日付 + イベント名」のイベントは重複としてスキップされます。

## Script Properties の設定方法

Apps Script エディタ → 「プロジェクトの設定」→「スクリプト プロパティ」に以下を登録します。

- キー: `ICS_IMPORT_URL`
- 値: 取り込み元のICS URL

> 注意：繰り返しイベント（RRULE）の展開には対応していません。1回のみのイベントを取り込みます。

## 集計とCSVエクスポート

「集計」タブで、期間（設定年度／次年度／2年度通算／上半期／下半期／任意）を選択し「集計実行」。

- **メンバ別**：出席日数と日当（500円×日数）
- **ブロック別**：地区（ブロック）ごとの日当合計
- **CSV出力**：メンバ別に加えて、ブロック別合計も出力

ダウンロードボタンで UTF-8(BOM付き) CSV を出力します。Excelでそのまま開けます。

## データモデル（主要シート）

### メンバ
| No | 地区 | 氏名 | 期 | 役職 | 実践部会 | 専門部会 | 有効 |
|----|------|------|----|------|----------|----------|------|

### イベント
| ID | 日付 | 開始 | 終了 | イベント名 | 分類 | 日当対象 | 場所 | 備考 | GoogleカレンダーID | 登録日時 |

### 出席（縦持ち）
| ID | イベントID | メンバID | 出席区分 | 更新者 | 更新日時 | 備考 |

出席は「イベント×メンバ」の全組合せを保持せず、登録された分だけが行として存在します。1イベント一括保存時に、無い組合せは新規追加、既存行は値更新されます。

### 分類マスタ
| 分類名 | カテゴリ | 日当対象デフォルト |

## 運用メモ

- **会長（29番・木村）** は `実践部会=−`, `専門部会=−` として登録済みのため、部会フィルタに引っかかりません
- **同時編集の競合** は LockService で直列化されます
- **スプレッドシートIDの永続化** は PropertiesService（スクリプトプロパティ）で行います。引越しする場合は `SPREADSHEET_ID` を書き換えてください
- **年度切替時** は、新たに `createNewSpreadsheet` で別スプレッドシートを作るのがおすすめです（旧年度はそのまま保管）
- **2年1期運用** の場合、設定の「年度」を 2026 にしておくと、集計画面で「設定年度(2026)」「次年度(2027)」「2年度通算(2026-2027)」を切り替えて継続利用できます

## トラブルシュート

| 症状 | 対処 |
|---|---|
| 初回アクセスで認可エラー | GASエディタで `createNewSpreadsheet` を1回手動実行して認可を通す |
| ICS自動取込で0件 | `ICS_IMPORT_URL` のURLが有効か、年度期間内にイベントがあるか確認 |
| `Unknown command "clasp open"` | `@google/clasp` の新しいバージョンでは `clasp open-script` にコマンド名が変更。READMEの手順どおり `clasp open-script` を実行 |
| `Deployment ID` が分からない | `clasp deployments` で一覧を表示し、更新対象の Deployment ID を `clasp deploy --deploymentId ...` に指定 |
| `Exception: 「tab_dashboard」という HTML ファイルは見つかりませんでした` | `tab_*.html`（`tab_dashboard.html` など）をプロジェクトに作成してから `clasp push -f` を再実行 |
| `createNewSpreadsheet` 実行後に空のシートしかない | 最新コードでは `createNewSpreadsheet` が初期化まで実行。反映前に作成済みなら `initializeSpreadsheet()` を1回実行 |
| 「シート1」が残る | 初期化時に自動削除するよう実装済み。残っていれば手動で削除OK |

## ライセンス

社内利用向け。再配布不要。
