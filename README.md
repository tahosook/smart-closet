# Smart Closet PWA (`smart-closet`)

毎朝1秒で奥様からのダメ出しを完全回避し、その日の服が決まる自分専用スマートクローゼットPWA。

---

## 1. 開発・検証・ビルド手順

```bash
# 依存パッケージのインストール
npm install

# ローカル開発サーバー起動 (Mac mini での確認用)
npm run dev

# データ整合性 + 型チェック + 本番ビルドの一括完全検証（DoD基準）
npm run check

# 本番ビルド (dist/ 出力)
npm run build

# データ整合性・プライバシーガード・Escape Hatch スキャン単体実行
npm run validate-data
```

---

## 2. 新しい服を買った時のアップデート手順

服の写真は **Google ドライブの非公開フォルダ（例: `SmartCloset_Photos`）** で管理します（パブリックな Git リポジトリには服の写真を一切コミットしません）。

### パターンA: Google AI Pro（Gemini）手動連携フロー
1. 新しい服の写真を撮影し、次の連番ID（シャツなら `S10.jpg`、パンツなら `P16.jpg`）にリネームして、Google ドライブの非公開フォルダ（`SmartCloset_Photos`）にアップロードする。
2. アプリの **「服追加・AI」タブ** を開き、新アイテムのカテゴリ・名前・特徴メモを入力して **［📋 Gemini相談用プロンプト＆データをコピー］** を押す（奥様NGマージ済みの最新データと `docs/STYLING_RULES.md` 準拠の指示文がコピーされます）。
3. Google AI Pro（Gemini）を開き、コピーしたプロンプトと写真を送信する。
4. Geminiから出力されたJSONをコピーし、アプリの「JSONを貼り付けて適用」で動作確認する。
5. 画面上の **［JSON保存］** を押してダウンロードした `closet.json` を `src/data/closet.json` に上書き保存する。
6. `npm run check` を実行してエラー0件を確認し、Gitコミット＆プッシュする。
7. アプリの雲アイコン（クラウド同期）から **［写真を今すぐ同期］** をタップして、端末の IndexedDB に新しい服の写真を取り込む。

### パターンB: Antigravity AI エージェントによる追加
1. 新しい服の写真を Google ドライブの非公開フォルダに保存（またはチャットに添付）する。
2. Antigravity チャットで「P16（黒スラックス）を追加して」と指示する。
3. エージェントが `closet.json` の相性ルール計算・更新、`npm run check` の検証を実行します。
4. アプリ側でクラウド同期（写真同期）を実行して端末に取り込みます。

---

## 3. Google スプレッドシート（GAS）連携（端末間同期＆断捨離分析）

Pixel 9a と Mac mini の間で着用履歴・奥様NGを完全自動同期し、スプレッドシート上で「60日以上着ていない服（断捨離候補）」や稼働率を集計するためのセットアップ手順です。

### ステップ 1: スプレッドシートの作成 & Apps Script 起動
1. Google ドライブでスプレッドシートを新規作成し、メニュー「拡張機能」>「Apps Script」を開きます。
2. 左メニュー「プロジェクトの設定（歯車アイコン）」をクリックし、**「スクリプト ID」** をコピーします。

### ステップ 2: スクリプトコードの反映

コードの反映は、CLI（`clasp`）を使う方法と、ブラウザエディタへ手動コピペする方法のどちらでも可能です。

#### 方法 A: clasp CLI による自動反映（推奨）
1. **Google Apps Script API の有効化 (初回のみ):**
   - [Google Apps Script ユーザー設定](https://script.google.com/home/usersettings) を開き、「Google Apps Script API」を **オン** にします。
2. **clasp ログイン (初回のみ):**
   ```bash
   npm run gas:login
   ```
   ブラウザが開くので、スプレッドシートを作成した Google アカウントで認証します。
3. **スクリプト ID の設定:**
   - テンプレートから設定ファイルを作成します:
     ```bash
     cp .clasp.json.sample .clasp.json
     ```
   - `.clasp.json` を開き、ステップ 1 でコピーしたスクリプト ID を貼り付けます:
     ```json
     {
       "scriptId": "コピーしたスクリプトID",
       "rootDir": "./gas"
     }
     ```
     *※ `.clasp.json` は `.gitignore` されているため、誤って Git にコミットされる心配はありません。*
4. **Apps Script へのプッシュ:**
   ```bash
   npm run gas:push
   ```
   `gas/Code.gs` およびマニフェスト `gas/appsscript.json` が Apps Script プロジェクトへアップロードされます。

> [!NOTE]
> **便利な npm scripts:**
> - `npm run gas:login`: clasp ログイン
> - `npm run gas:push`: ローカルの `gas/`（Code.gs / appsscript.json）を Apps Script にプッシュ
> - `npm run gas:pull`: Apps Script 側のコードをローカルへプル（※手動コピペ併用時の注意点あり。後述の注意点を参照）
> - `npm run gas:open`: ブラウザで対象の Apps Script エディタを直接起動

#### 方法 B: ブラウザエディタへの手動コピペ（従来通り）
- 本リポジトリの `gas/Code.gs`（またはアプリ内ヘッダーの雲アイコン >「GASコードをコピー」）を Apps Script エディタに貼り付けて保存します。

### ステップ 3: シートの初期化 (初回のみ)
1. Apps Script エディタ（`npm run gas:open` で開けます）の関数選択プルダウンで `setupSpreadsheet` を選択し、「実行」をクリックします。
2. 権限確認のダイアログが表示されたら承認します（`wear_history`、`wife_ng`、`analytics`、`meta_config` シートが自動生成されます）。

### ステップ 4: 初回シークレット合言葉の登録 (clasp 利用時・初回のみ)
本アプリは不正アクセス防止のため、合言葉トークンが未設定の場合はすべてのリクエストを拒否（Fail-Closed）します。clasp push では Git への平文トークン漏洩を防ぐためプレースホルダーのままコードを反映するため、スプレッドシート側の `meta_config` シートに合言葉を1度登録します。

1. Smart Closet アプリのヘッダーにある **雲アイコン（クラウド同期）** をタップします。
2. 「シークレット合言葉」欄に表示されている文字列（自動生成された合言葉、またはご自身で決めた任意の合言葉）をコピーします。
3. スプレッドシートに戻り、下部のシートタブから **`meta_config`** シートを開きます。
4. 2行目に次のように入力します:
   - **A列（キー）:** `secretToken`
   - **B列（値）:** アプリからコピーした合言葉（例: `abc123xyz...`）
   *(※ C列「最終更新日時」は空欄で問題ありません)*

> [!NOTE]
> - すでに `meta_config` に `secretToken` が登録されている既存環境や、方法 B（手動コピペ）でモーダルからコピーしたコードを貼り付けた場合は、この登録手順は不要です。

### ステップ 5: ウェブアプリとしてデプロイ
1. 右上「デプロイ」>「新しいデプロイ」を開きます。
2. 種類の選択（歯車アイコン）で「ウェブアプリ」を選択します。
3. 次のように設定して「デプロイ」をクリックします:
   - **次のユーザーとして実行:** 自分 (`USER_DEPLOYING`)
   - **アクセスできるユーザー:** 全員 (`ANYONE_ANONYMOUS`)
4. 発行された **「ウェブアプリ URL」** をコピーします。

### ステップ 6: アプリへの登録（自動ブートストラップまたは手動登録）
- **Cloudflare Pages 本番環境（推奨）:**
  Cloudflare Access でログイン後、アプリを開くだけで `/api/bootstrap-config` から自動的に GAS URL と合言葉がブートストラップされ、初回自動同期で `meta_config` の画像フォルダ ID も取得されます（手入力不要）。
- **ローカル開発環境 (`npm run dev`) または手動設定時:**
  1. Smart Closet アプリのヘッダーにある **雲アイコン（クラウド同期）** をタップします。
  2. コピーしたウェブアプリ URL を貼り付け、シークレット合言葉がステップ 4 と一致していることを確認して「設定を保存」します。
  3. 以後、Pixel 9a や Mac mini で操作するたびにバックグラウンドで自動同期されます（オフライン時もローカル保存され、接続復帰時やアプリ画面復帰時に自動同期）。

### ステップ 7: 写真同期用 Google ドライブフォルダの設定（任意・写真同期利用時）
1. Google ドライブで服の写真を格納する非公開フォルダ（例: `SmartCloset_Photos`）を作成します。
2. フォルダの URL（`https://drive.google.com/drive/folders/<フォルダID>`）から **フォルダ ID** をコピーします。
3. アプリの雲アイコン（クラウド同期モーダル）を開き、「Google ドライブ画像同期」欄の「ドライブフォルダ ID」に貼り付けて保存します（またはスプレッドシートの `meta_config` シートに `imageFolderId` として登録）。
4. 「写真を今すぐ同期」を押すと、ドライブ内の写真（`S1.jpg` 等）が端末の IndexedDB にダウンロード・キャッシュされます。

> [!TIP]
> **運用上の注意点:**
> - **スクリプト更新時の再デプロイ:** `gas/Code.gs` を更新して `npm run gas:push` した後は、Apps Script 画面右上「デプロイ」>「デプロイを管理」から鉛筆アイコンをクリックし、バージョンを「新バージョン」にして再デプロイしてください（既存の Web アプリ URL がそのまま維持されます）。
> - **スプレッドシートへの手動追加:** `wife_ng` シートに手動で行を追加する場合は「登録日時」列に現在日時（例: `2026-10-18T12:00:00Z`）を記入してください（空欄の場合は古い登録として扱われ、過去にアプリ側で削除記録があるペアは除外されます）。

#### gas:pull 実行時のセキュリティ注意点（手動コピペ併用環境）
手動コピペ方式でセットアップした Apps Script プロジェクトでは、エディタ上の `Code.gs` にシークレット合言葉（実トークン）が直接埋め込まれている場合があります。

1. **正本管理の原則:**
   - clasp 運用では、プレースホルダー「`__SMART_CLOSET_SECRET_TOKEN__`」を含む**ローカルの `gas/Code.gs` が正本（Single Source of Truth）**であり、Apps Script 側のコードを正本にしない方針です。
2. **コミット前のトークン混入チェック:**
   - 手動コピペ併用環境に対して `npm run gas:pull` を実行すると、リモートからローカルの `gas/Code.gs` に実トークン入りのコードが上書き取得される可能性があります。**Git コミット前に、実トークンが含まれていないか必ず `git diff` 等で確認**してください。
3. **トークンが含まれていた場合・漏洩時の対応:**
   - 実トークンが含まれていた場合はそのままコミットせず、プレースホルダー「`__SMART_CLOSET_SECRET_TOKEN__`」に戻してください。
   - 万一 Git に公開してしまった場合は、直ちにアプリの雲アイコンから合言葉を再生成（ローテーション）し、アプリ設定の「設定を保存」とスプレッドシートの `meta_config` シートの `secretToken` も合わせて更新してください。

---

## 4. Cloudflare Pages 本番運用 & 自動ブートストラップ

Smart Closet は **Cloudflare Pages**（`https://smart-closet-djw.pages.dev`）へ移行し、**Cloudflare Access（Google ログイン認証・セッション期間1か月）** の背後で安全に稼働しています（旧 GitHub Pages は公開停止・Unpublish 済み）。

### 自動ブートストラップの仕組み
Cloudflare Access で認証されたユーザーに対して、同一オリジンの Pages Function（`/api/bootstrap-config`）が以下の安全策のもとで同期設定を自動配布します：
1. **成果物へのシークレット非混入:** `GAS_WEB_APP_URL` と `GAS_SECRET_TOKEN` は Cloudflare Pages の Production Secret（暗号化変数）としてのみ保持され、ビルド成果物（`dist/`）や公開 Git には一切含まれません。
2. **多層防御:** `Cf-Access-Authenticated-User-Email` ヘッダーと `ALLOWED_EMAILS`（`tahosook@gmail.com` 等）の照合を必須検証（Fail-Closed）。未登録の Preview 環境では 404 を返し、静かに手入力へフォールバックします。
3. **サーバー正本整合:** 写真フォルダ ID（`imageFolderId`）はスプレッドシートの `meta_config` シートを唯一の正本とし、ブートストラップ直後の初回同期（Pull）で自動セットされます。

### シークレット合言葉 (`secretToken`) のローテーション手順
合言葉を変更（ローテーション）する場合は、保管場所である **以下の2か所を同じ新しい値に更新** します：
1. **スプレッドシート `meta_config`:** `secretToken` 行の値を新しい合言葉に書き換える。
2. **Cloudflare Pages Production Secret:** Cloudflare Dashboard > Workers & Pages > `smart-closet` > Settings > Variables and Secrets で Production の `GAS_SECRET_TOKEN` を更新し、**Deployments から再デプロイ（Retry deployment）** を実行する。
3. **端末への反映:** アプリの雲アイコンを開き、「クラウドから設定を自動取得」ボタンをタップする。

*※ インフラの詳細構成、Google Cloud OAuth 設定、および将来の家族追加手順は [docs/OPERATIONS.md](./docs/OPERATIONS.md) を参照してください。*

---

## 5. ドキュメント一覧

- **[AGENTS.md](./AGENTS.md):** AIコーディングエージェント（Antigravity等）向けの開発憲法・禁止事項・DoD。
- **[docs/OPERATIONS.md](./docs/OPERATIONS.md):** インフラ構成・接続関係・Cloudflare Zero Trust / OAuth 設定実績・運用ランブック。
- **[docs/SPECIFICATION.md](./docs/SPECIFICATION.md):** 画面仕様・レスポンシブ要件・データモデル・推薦ロジック詳細定義書。
- **[docs/STYLING_RULES.md](./docs/STYLING_RULES.md):** 40代男性の鉄壁3原則（配色・柄・TPO）・初期24着偏り分析・買い足し指針。
