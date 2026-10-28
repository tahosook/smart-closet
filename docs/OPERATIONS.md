# Smart Closet インフラ構成・運用リファレンス (`docs/OPERATIONS.md`)

本ドキュメントは、Smart Closet (`smart-closet`) のインフラストラクチャ構成、Cloudflare Pages / Zero Trust / Google Cloud OAuth / GAS の接続関係、環境変数・シークレットの保管場所（正本）、および運用手順（合言葉ローテーション・家族追加手順）を記録・再現するためのリファレンスである。

---

## 1. システム全体アーキテクチャ & 接続関係図

```mermaid
flowchart TD
    subgraph Client["端末 (Pixel 9a / Mac mini)"]
        PWA["Smart Closet PWA (React + Vite)"]
        Local["localStorage (0ms即決)"]
        IDB["IndexedDB (服の写真Blobs)"]
    end

    subgraph CF["Cloudflare Edge Infrastructure"]
        CFA["Cloudflare Access (Zero Trust)<br/>アプリ: smart-closet-production<br/>認証: Google OAuth 2.0<br/>セッション: 1か月"]
        Pages["Cloudflare Pages (smart-closet)<br/>URL: smart-closet-djw.pages.dev"]
        Func["Pages Functions (/api/bootstrap-config)<br/>※Production Secret (URL/合言葉/許可メール) 保持"]
    end

    subgraph GoogleCloud["Google Cloud / Google Workspace"]
        OAuth["Google Cloud OAuth 2.0<br/>プロジェクト: cloudflare-access"]
        GAS["Google Apps Script Web App<br/>(gas/Code.gs)<br/>認証: Fail-Closed validateToken"]
        Sheet[("Google スプレッドシート<br/>・wear_history<br/>・wife_ng<br/>・analytics<br/>・meta_config (正本)")]
        Drive[("Google ドライブ (非公開)<br/>写真フォルダ: SmartCloset_Photos<br/>{ID}.jpg")]
    end

    Client -->|1. HTTPS リクエスト| CFA
    CFA -->|2. Google ログイン認証| OAuth
    CFA -->|3. 認証ヘッダー付与| Pages
    Pages --> PWA
    PWA -.->|初回未設定時: GET /api/bootstrap-config| Func
    Func -.->|URL & 合言葉を配布 (no-store)| PWA
    PWA <-->|バックグラウンド同期 (Push/Pull)| GAS
    GAS <--> Sheet
    GAS <--> Drive
    PWA <-->|写真Blobs保存・取得| IDB
    PWA <-->|日常データ記録| Local
```

---

## 2. データの正本 (Single Source of Truth) 一覧

| 設定・データ項目 | 正本の保管場所 (Single Source of Truth) | PWA への反映・同期経路 | 備考 |
| :--- | :--- | :--- | :--- |
| **服マスタデータ** | Git リポジトリ (`src/data/closet.json`) | ビルド時に静的バンドル | 24着の初期定義・採点・相性マトリクス |
| **GAS ソースコード** | Git リポジトリ (`gas/Code.gs`) | `clasp push` で Apps Script プロジェクトへ反映 | コード単体で完結する Single Source of Truth |
| **GAS ウェブアプリ URL** | Google Apps Script デプロイ設定<br/>＋ Cloudflare Pages Production Secret (`GAS_WEB_APP_URL`) | Pages Functions `/api/bootstrap-config` 経由で PWA に自動ブートストラップ | 公開リポジトリやビルド成果物には非公開 |
| **シークレット合言葉** | スプレッドシート `meta_config` シート (`secretToken`)<br/>＋ Cloudflare Pages Production Secret (`GAS_SECRET_TOKEN`) | Pages Functions `/api/bootstrap-config` 経由で PWA に自動ブートストラップ | GAS の Fail-Closed 認証に必須 |
| **写真フォルダ ID** | スプレッドシート `meta_config` シート (`imageFolderId`) | GAS 初回同期 (Pull/Push) のレスポンスから PWA へ自動配信 | **Cloudflare 側では二重管理せず、スプレッドシートのみを唯一の正本とする** |
| **服の写真実体** | Google ドライブ非公開フォルダ (`SmartCloset_Photos`) | GAS `fetchImages` 経由で Base64 取得し端末の `IndexedDB` へキャッシュ | Git リポジトリには一切コミットしない完全プライベート構成 |
| **着用履歴・奥様NG** | スプレッドシート (`wear_history`, `wife_ng`) ＋ 端末 `localStorage` | GAS 双方向マージ (LWW + Tombstones) で Pixel ⇔ Mac 間自動同期 | オフライン時は保留し次回接続時に自動同期 |

---

## 3. 構築済みインフラ設定実績（2026-10-25 構築・検証済み）

### 3.1 Cloudflare Pages
- **プロジェクト名:** `smart-closet`
- **本番 URL:** `https://smart-closet-djw.pages.dev`
- **GitHub 連携:** GitHub App `Cloudflare Workers and Pages` を「Only select repositories」で `tahosook/smart-closet` のみに限定認可。
- **ビルド設定:**
  - ビルドコマンド: `npm run build`
  - 出力ディレクトリ: `dist`
  - フレームワークプリセット: `None` (Vite)
- **ビルド環境変数 (Production / Preview 共通):**
  - `NODE_VERSION`: `20`
  - `VITE_BASE_PATH`: `/`
- **ランタイム環境変数 / Secret (★Production 環境のみ登録、Preview 環境には未登録):**
  - `GAS_WEB_APP_URL`: デプロイ済み GAS ウェブアプリの URL (Encrypted)
  - `GAS_SECRET_TOKEN`: スプレッドシート `meta_config` と一致するシークレット合言葉 (Encrypted)
  - `ALLOWED_EMAILS`: `tahosook@gmail.com` (Encrypted)
  - *※ Preview 環境ではこれらが未登録のため `/api/bootstrap-config` が 404 となり、安全に手入力モードへフォールバックします。*

### 3.2 Cloudflare Zero Trust (Access)
- **プラン:** Free プラン（支払い方法として Google Pay 登録済み、現時点で課金なし）
- **チーム名:** `smart-closet-djw-pages`
- **チームドメイン:** `https://smart-closet-djw-pages.cloudflareaccess.com`
- **Access アプリケーション:**
  - アプリケーション名: `smart-closet-production`
  - アプリケーションタイプ: `Self-hosted`
  - アプリケーションドメイン: `smart-closet-djw.pages.dev` (パス空欄＝ドメイン全体を保護)
  - セッション期間: `1か月 (1 month)`
- **アクセスポリシー:**
  - ポリシー名: `Allow tahosook only`
  - Action: `Allow`
  - Include ルール: `Selector: Emails` / `Value: tahosook@gmail.com`

### 3.3 Google Cloud (Identity Provider / OAuth 2.0)
- **Cloudflare Access 側の設定:** Zero Trust > Settings > Authentication > Login methods に `Google` を追加済み。
- **Google Cloud プロジェクト:** `cloudflare-access`
- **OAuth 2.0 クライアント ID / シークレット:**
  - 保管場所: Google Cloud Console (APIs & Services > Credentials) および Cloudflare Zero Trust Authentication 設定画面
  - 承認済みのリダイレクト URI: `https://smart-closet-djw-pages.cloudflareaccess.com/cdn-cgi/access/callback`
- **OAuth 同意画面ステータス:** **「テスト中 (Testing)」**
  - テストユーザー: `tahosook@gmail.com` のみ登録済み

### 3.4 旧 GitHub Pages の廃止実績
- デプロイワークフロー（`.github/workflows/deploy.yml`）を無効化し削除。
- GitHub リポジトリの Settings > Pages にて公開停止（Unpublish）実行済み。
- 旧 URL（`https://tahosook.github.io/smart-closet/`）が `404 Not Found` であることを確認済み。

---

## 4. 運用手順ランブック

### 4.1 シークレット合言葉 (`secretToken`) のローテーション手順
合言葉を変更（ローテーション）する場合は、保管場所である **以下の2か所を同じ新しい合言葉に更新** します：

1. **スプレッドシートの `meta_config` シートを更新:**
   - スプレッドシートを開き、`meta_config` シートの `secretToken` 行（通常2行目）の B列（値）に新しい合言葉（例: `sc_...`）を入力します。
2. **Cloudflare Pages の Production Secret を更新:**
   - Cloudflare Dashboard > Workers & Pages > `smart-closet` > Settings > Variables and Secrets を開きます。
   - Production の `GAS_SECRET_TOKEN` を新しい合言葉に書き換えて保存します。
   - **Deployments** タブを開き、最新デプロイの三点リーダーメニューから **「Retry deployment」** を実行して Functions に反映させます。
3. **クライアント端末への反映:**
   - Pixel 9a や Mac mini でアプリを開き、雲アイコン（クラウド同期モーダル）の「クラウドから設定を自動取得」ボタンをタップすると、新しい合言葉に即座に切り替わります（または手動入力して「設定を保存」）。

---

### 4.2 将来ユーザー（信頼できる家族等）を追加する際の手順
将来、信頼できる家族などに同じワードローブ・着用履歴データを共有する場合、以下の **3か所** の設定を追加します（人ごとにデータを分離するマルチテナント化は不要で、同じデータを共有する前提です）。

> [!IMPORTANT]
> **OAuth 同意画面が「テスト中」であることの注意点:**
> 現在 Google Cloud の OAuth 同意画面は「テスト中」のため、未登録の Google アカウントはログイン画面で弾かれます。そのため、必ず以下の手順 1（テストユーザー追加）を実施してください。

1. **Google Cloud Console (`cloudflare-access` プロジェクト):**
   - [Google Cloud Console](https://console.cloud.google.com/) > APIs & Services > OAuth consent screen を開きます。
   - 「Test users」欄の **「ADD USERS」** をクリックし、家族の Google アカウント（メールアドレス）を追加して保存します（※アプリを「本番公開」ステータスに移行した場合はこの手順は不要になります）。
2. **Cloudflare Zero Trust (`smart-closet-production` アプリケーション):**
   - Cloudflare Zero Trust Dashboard > Access > Applications > `smart-closet-production` を開きます。
   - Policies タブで対象ポリシーを編集し、Include ルールの Emails に家族のメールアドレスを追加します。
3. **Cloudflare Pages (`smart-closet` プロジェクト):**
   - Workers & Pages > `smart-closet` > Settings > Variables and Secrets を開きます。
   - Production の `ALLOWED_EMAILS` をカンマ区切りで更新します（例: `tahosook@gmail.com,family@example.com`）。
   - **Deployments** タブから **「Retry deployment」** を実行して反映します。
4. **反映確認:**
   - 家族のスマートフォン等のブラウザで `https://smart-closet-djw.pages.dev` にアクセスし、Google ログインを通過すると、手入力不要で同期設定が自動プロビジョニングされ、同じクローゼットデータが表示されます。

---

### 4.3 `gas/Code.gs` マージ後の手動デプロイ・本番検証手順
`gas/Code.gs` の変更は、GitHub へマージしただけでは本番の Google Apps Script Web アプリには反映されません。`gas/Code.gs` を変更する PR のマージ後は、必ず以下の手順で**既存のデプロイを新バージョンに更新**し、本番検証を実施してください。

> [!WARNING]
> **新規デプロイ作成の禁止（URL 不変の原則）:**
> 「新しいデプロイ」を作成するとウェブアプリ URL が変わってしまい、Cloudflare Pages の `GAS_WEB_APP_URL` や各端末の設定と不整合を起こします。必ず**既存のデプロイを編集して新バージョンを割り当てる**ことで、デプロイ URL を不変に保ってください。

1. **`gas/Code.gs` の Apps Script プロジェクトへの反映:**
   - `clasp push` を実行するか、スプレッドシートの「拡張機能」>「Apps Script」エディタを開き、マージ後の最新の `gas/Code.gs` 全文を貼り付けて保存（`Cmd+S` / `Ctrl+S`）します。
2. **既存 Web アプリ デプロイの新バージョンへの更新（URL 不変）:**
   - Apps Script エディタ右上の **「デプロイ」>「デプロイを管理」** を開きます。
   - 現在稼働中のウェブアプリ デプロイを選択し、右上の鉛筆アイコン（編集）をクリックします。
   - 「バージョン」ドロップダウンで **「新バージョン」** を選択し、**「デプロイ」** をクリックして完了します（※「デプロイ」>「新しいデプロイ」は選択しないこと）。
   - 表示されるウェブアプリ URL が従来と変わっていないことを確認します。
3. **デプロイ後の本番検証手順:**
   - **① トークンなし GET による Fail-Closed 認証エラー確認:**
     ブラウザ（シークレットウィンドウ等）または `curl -L "<GAS_WEB_APP_URL>"` で、トークンパラメータを付与せずに本番ウェブアプリ URL へ GET リクエストを送ります。Fail-Closed 認証が機能し、以下の認証エラー JSON が返ることを確認します。
     ```json
     {"ok":false,"error":"認証エラー: トークンが無効または未設定です"}
     ```
   - **② 実機での手動同期確認:**
     Pixel 9a または Mac mini で本番アプリ（`https://smart-closet-djw.pages.dev`）を開き、クラウド同期モーダルから **「今すぐ同期」** を押下して、エラーなく双方向同期が完了することを確認します。
