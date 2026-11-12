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
| **着用履歴・奥様NG** | スプレッドシート (`wear_history`, `wife_ng`) ＋ 端末 `localStorage` | GAS 双方向マージ (LWW + Tombstones) で Pixel ⇔ Mac 間自動同期 | オフライン時は保留し次回接続時に自動同期。<br/>※アプリのバックアップ JSON（`closet.json` スキーマ）には着用履歴および独立した奥様NG配列（`wifeNgPairs`）は含まれないため、復旧正本はスプレッドシートの版数履歴となる（詳細は §4.5 参照）。 |

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

### 3.5 インフラ設定の定期再検証ルール
2026-10-25 の初期構築設定が時間経過や仕様変更でドリフト・失効することを防ぐため、以下のタイミングで設定状態と動作を再検証します。

| 検証タイミング（いつ） | 対象コンポーネント | 確認・実施する具体的内容（何を） | 異常時の対応 |
| :--- | :--- | :--- | :--- |
| **月次（毎月1日頃：Access セッション 1か月の満了に伴う再ログイン時）** | **Cloudflare Access & Google OAuth** | 1. Pixel 9a / Mac mini で Access のセッション期限切れ後に Google ログイン画面へ正常にリダイレクトされ、再認証が通過するか確認。<br/>2. Google Cloud Console (`cloudflare-access`) の OAuth 同意画面ステータス（「テスト中」）とテストユーザー（`tahosook@gmail.com`）が維持されているか確認。 | OAuth エラー時は Google Cloud Console の Credentials / Redirect URI と Zero Trust > Settings > Authentication > Login methods (`Google`) の Client ID / Secret を再照合。 |
| **四半期ごと（1月・4月・7月・10月の月初）および設定変更時** | **Cloudflare Pages Secrets & スプレッドシート `meta_config` の整合** | 1. Cloudflare Pages (`smart-closet`) の Production Secret（`GAS_WEB_APP_URL`, `GAS_SECRET_TOKEN`, `ALLOWED_EMAILS`）が登録・暗号化維持されており、Preview 環境には未登録のままであることを確認。<br/>2. スプレッドシート `meta_config` シートの `secretToken`・`imageFolderId` が意図した正本値と一致しているか確認。<br/>3. クラウド同期モーダルの「☁️ クラウドから設定を自動取得」を実行し、`/api/bootstrap-config` から正常に設定が配布され「今すぐ同期」が成功するか確認。 | 不一致がある場合は §4.1 の手順に従って `meta_config` と Pages Production Secret を揃え、Pages の「Retry deployment」を実行。 |
| **半年ごと（4月・10月の衣替え・全体見直し時）** | **Access ポリシー & GitHub 連携権限** | 1. Cloudflare Zero Trust > Access > Applications (`smart-closet-production`) の Include ルールが許可メールアドレスのみに限定されているか確認。<br/>2. GitHub App `Cloudflare Workers and Pages` の認可対象リポジトリが `tahosook/smart-closet` のみに限定されているか確認。 | 意図しないアカウントやリポジトリが含まれている場合は即座に削除し、§4.1 の合言葉ローテーションを実施。 |

---

## 4. 運用手順ランブック

### 4.1 シークレット合言葉 (`secretToken`) の脅威モデル・ローテーション方針・漏洩時対応

#### 脅威モデルと合言葉の役割
- **二重防御における位置づけ:**
  1. **フロントエンド（PWA ＆ `/api/bootstrap-config`）:** Cloudflare Access（Google OAuth 2.0）と `ALLOWED_EMAILS` により、オーナー（および明示的に追加した家族）以外のアクセスをエッジで遮断します。
  2. **バックエンド（GAS Web アプリ `gas/Code.gs`）:** GAS Web アプリはブラウザから CORS Simple Request で直接通信する仕様上、デプロイ設定が「アクセスできるユーザー: 全員」となります。そのため、万が一 GAS の実行 URL（`https://script.google.com/macros/s/.../exec`）が外部に知られるか推測された場合でも、第2の防壁として `meta_config` シートの `secretToken` による **Fail-Closed 認証（`validateToken`）** が機能し、正しい合言葉を持たないリクエスト（データの読み書き・写真の取得／アップロード／削除）をすべて拒否します。
- **保護対象と限界:**
  - `secretToken` と `GAS_WEB_APP_URL` が**同時に**第三者へ漏洩した場合、その第三者は GAS エンドポイントへ直接リクエストを送ることで、スプレッドシートのデータ（着用履歴・奥様NG・カスタム服データ）および Google ドライブ非公開フォルダ内の服写真へアクセス可能になります（Google アカウント自体の他ファイルにはアクセス不可ですが、GAS に付与された権限範囲の操作が可能になります）。

#### ローテーション方針と漏洩時の対応（「いつ・何を確認／実施するか」）

| トリガー（いつ） | 確認すること（何を） | 実施するアクション（どうするか） |
| :--- | :--- | :--- |
| **① 定期ローテーション（年1回：毎年10月のインフラ棚卸し時）** | ・直近1年間の同期エラー有無<br/>・スプレッドシート `meta_config` と Cloudflare Pages Production Secret の稼働状態 | 下部の「ローテーション実行手順（1〜3）」を実施し、新しい合言葉へ更新する。 |
| **② 端末の紛失・盗難・譲渡・廃棄時（発生時即時）** | ・紛失端末でログインしていた Google アカウントのセッション状態<br/>・スプレッドシート（`wear_history`, `wife_ng`, `meta_config`）および写真フォルダ（`SmartCloset_Photos`）に不審な書き換え・削除がないか | 1. Google アカウントの「デバイス」管理画面から紛失端末をログアウトさせる。<br/>2. Cloudflare Zero Trust > Access > Applications でセッションを無効化（Revoke）する。<br/>3. 下部の「ローテーション実行手順（1〜3）」を即座に実施して旧合言葉を無効化する。 |
| **③ 合言葉または GAS URL の漏洩疑い時（Git への誤コミット、画面共有・スクショへの映り込み、共有家族アカウントの変更時など・発生時即時）** | 1. `npm run validate-data`（Secret Guard）の検出結果と Git コミット履歴。<br/>2. スプレッドシートの「変更履歴（版数履歴）」および Google ドライブの「アクティビティ」で、意図しない日時・内容のアクセスや改ざんがないか確認。 | 1. **合言葉の即時無効化:** スプレッドシート `meta_config` の `secretToken` を直ちに新しい値へ書き換える（この瞬間に旧合言葉による通信は即座に拒否される）。<br/>2. **GAS URL も漏洩した場合:** Apps Script エディタの「デプロイを管理」で既存デプロイをアーカイブ（無効化）し、「新しいデプロイ」で新 URL を発行した上で、Cloudflare Pages の `GAS_WEB_APP_URL` も併せて更新する。<br/>3. 下部の「ローテーション実行手順（2〜3）」を完了させ、万一データ改ざんがあった場合は §4.5 の復旧手順でスプレッドシートを復元する。 |

#### ローテーション実行手順
合言葉を変更（ローテーション）する場合は、保管場所である **以下の2か所を同じ新しい合言葉に更新** します（新しい合言葉はアプリのクラウド同期モーダル ＞ セットアップガイド内の「合言葉を再生成」ボタン等で生成可能）：

1. **スプレッドシートの `meta_config` シートを更新:**
   - スプレッドシートを開き、`meta_config` シートの `secretToken` 行（通常2行目）の B列（値）に新しい合言葉を入力します（※この時点で旧合言葉による通信は即座に拒否されます）。
2. **Cloudflare Pages の Production Secret を更新:**
   - Cloudflare Dashboard > Workers & Pages > `smart-closet` > Settings > Variables and Secrets を開きます。
   - Production の `GAS_SECRET_TOKEN` を新しい合言葉に書き換えて保存します。
   - **Deployments** タブを開き、最新デプロイの三点リーダーメニューから **「Retry deployment」** を実行して Functions に反映させます。
3. **クライアント端末への反映と動作確認:**
   - Pixel 9a や Mac mini でアプリを開き、雲アイコン（クラウド同期モーダル）＞「接続設定」の「☁️ クラウドから設定を自動取得」ボタンをタップすると、新しい合言葉に即座に切り替わります（または手動入力して「設定を保存」）。
   - 続けて「今すぐ同期」をタップし、エラーなく「同期完了しました」と表示されることを確認します。

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

---

### 4.4 GAS および Cloudflare Pages のロールバック手順
デプロイ後に不具合や同期エラーが発覚した場合は、影響範囲に応じて以下の手順で即座にロールバック（切り戻し）を実施します。

#### A. Google Apps Script (`gas/Code.gs`) のロールバック手順（URL 不変）
1. **方式1：Apps Script の「デプロイを管理」から旧バージョンへ即時切り戻す（最速・推奨）:**
   - スプレッドシートの「拡張機能」>「Apps Script」を開き、右上の **「デプロイ」>「デプロイを管理」** を開きます。
   - 現在稼働中のウェブアプリ デプロイを選択し、右上の鉛筆アイコン（編集）をクリックします。
   - 「バージョン」ドロップダウンから、問題なく稼働していた **1つ前のバージョン番号** を選択し、**「デプロイ」** をクリックします（ウェブアプリ URL は変わりません）。
2. **方式2：Git 上の正常な `gas/Code.gs` から新バージョンとして再デプロイする:**
   - Git で問題のあるコミットを `git revert` するか、正常稼働していたコミットの `gas/Code.gs` を取得します。
   - §4.3 の手順 1〜2 に従い、Apps Script エディタへ貼り付けて保存し、既存デプロイの「新バージョン」としてデプロイします。
3. **切り戻し後の本番確認:**
   - §4.3 の手順 3（① トークンなし GET での Fail-Closed 認証エラー確認、② 実機での「今すぐ同期」成功確認）を実施し、正常復旧を確認します。

#### B. Cloudflare Pages（フロントエンド PWA / Pages Functions）のロールバック手順
1. **方式1：Cloudflare Dashboard から過去の正常デプロイへ即時 Rollback する（最速・数秒で反映）:**
   - Cloudflare Dashboard > Workers & Pages > `smart-closet` > **Deployments** タブを開きます。
   - Production デプロイ履歴の中から、切り戻したい正常なデプロイの右端にある三点リーダーメニュー（`...`）をクリックし、**「Rollback to this deployment」** を選択して確定します。
   - *※注意: Cloudflare Pages の即時 Rollback はビルド成果物と Functions コードを当時の状態に戻しますが、Settings > Variables and Secrets の環境変数・Secret 値は現在の設定が維持されます。Secret 変更起因の障害の場合は Secret 値も戻した上で「Retry deployment」を実行してください。*
2. **方式2：GitHub の `main` ブランチで Revert PR をマージする（恒久対応）:**
   - 即時 Rollback 後に `main` ブランチへ別コミットが push されると再び最新状態がデプロイされるため、恒久的には GitHub 上で該当 PR の **Revert PR** を作成・マージして Git の正本履歴と本番デプロイを一致させます。
3. **切り戻し後の端末反映確認:**
   - Pixel 9a / Mac mini でアプリを再読み込み（PWA Service Worker の更新反映のため必要に応じてタスクキルまたはスーパーリロード）し、画面表示および操作が正常であることを確認します。

---

### 4.5 着用履歴・奥様NGの誤消去・破損時の復旧手順

#### 前提知識：バックアップ JSON の対象範囲と「全履歴をクリア」の伝播仕様
1. **アプリのバックアップ JSON に含まれるもの・含まれないもの（現状仕様）:**
   - 管理タブ ＞「💾 データバックアップ（JSON保存・JSONコピー）」で出力される JSON は `ClosetData` スキーマ（`src/data/closet.json` 差し替え用）です。
   - ここには服一覧（`items`）に加え、出力時点で登録されていた奥様NGペアが各アイテムの `ngIds`・`ngReason` 等に**マージされた状態**で含まれますが、**着用履歴（`wearHistory`）は一切含まれず、独立した奥様NG配列（`wifeNgPairs`：個別の登録日時や「奥様NG」専用バッジ・個別解除用の元データ）もそのままの形では含まれません。**
   - したがって、着用履歴（`wearHistory`）と独立した奥様NG記録（`wifeNgPairs`）のバックアップ・復旧の正本は **Google スプレッドシート（`wear_history` シートおよび `wife_ng` シート）の版数履歴（変更履歴）** となります。
2. **「全履歴をクリア」や個別削除が全端末・スプレッドシートへ伝播する仕組み（Sync Tombstone）:**
   - 着用履歴モーダルで **「全履歴をクリア」**（または履歴の個別削除、奥様NGの解除）を実行すると、端末の `localStorage`（`smart_closet_sync_tombstones`）に削除タイムスタンプ（墓標：`wearHistoryClearedAt`、`deletedWearMap`、`deletedWifeNgMap`）が記録され、バックグラウンド Push によってスプレッドシートの `meta_config` シート内の `syncTombstones` 行へ永続化されます。
   - その後、別の端末（例: Pixel で全消去した後の Mac）が同期（Push/Pull）を行うと、サーバーの `syncTombstones` に記録された削除時刻（`wearHistoryClearedAt` 等）以前の古いデータはすべて「削除済み」としてフィルタリングされ、**全端末およびスプレッドシートから一斉に消去されます（古い端末から勝手に復活しないための LWW + Tombstone 設計）。**

> [!CAUTION]
> **復旧時の最重要ポイント（Tombstone の同時リセット）:**
> 誤って「全履歴をクリア」や奥様NG解除を行った後にスプレッドシートのデータだけを戻しても、端末側または `meta_config` シート側に**削除墓標（`syncTombstones`）が残っていると、次回同期時に「削除時刻より前のデータ」と判定されて再び自動消去されてしまいます。** 復旧時は必ず以下の手順どおりに `meta_config` の `syncTombstones` と端末側の状態を処理してください。

#### 復旧手順（スプレッドシートの版数履歴から戻す手順）

1. **全端末の自動同期の一時停止（またはアプリを閉じる）:**
   - 作業中に端末から削除墓標が再送信されるのを防ぐため、手元の端末（Pixel 9a / Mac mini）でクラウド同期モーダル ＞「接続設定」の「自動同期」チェックを一旦外して保存するか、ブラウザのタブを閉じます。
2. **Google スプレッドシートの「変更履歴（版数履歴）」からデータを復元:**
   - PC で対象の Google スプレッドシートを開き、上部メニュー **「ファイル」>「変更履歴」>「変更履歴を表示」**（`Cmd+Option+Shift+H` / `Ctrl+Alt+Shift+H`）を開きます。
   - 右ペインのタイムラインから、誤消去や破損が発生する直前の正常な版を選択します。
   - **方法A（スプレッドシート全体をその時点に戻す場合）:** 上部の **「この版を復元」** をクリックして確定します（`wear_history`、`wife_ng`、`meta_config` のすべてが正常時点に戻ります）。
   - **方法B（特定のシート・行のみを戻す場合）:** 過去の版の `wear_history` シートや `wife_ng` シートの該当セル範囲をコピーし、現在のシートへ貼り付けて戻します。
3. **`meta_config` シートの `syncTombstones`（削除墓標）の確認・クリア:**
   - スプレッドシートの `meta_config` シートを開き、A列が `syncTombstones` の行を確認します。
   - 方法Bでシート行のみを戻した場合や、復元した版に誤削除の墓標が含まれている場合は、`syncTombstones` 行の B列（値）を空欄にするか、初期値 `{"deletedWearMap":{},"deletedWifeNgMap":{},"wearHistoryClearedAt":0,"customClosetDataClearedAt":0}` に書き換えます。
4. **誤消去を実行した端末のローカル墓標クリアと「シートから取り直す」の実行:**
   - 誤消去を実行した端末で、もし未送信の削除墓標が残っている（「未送信の変更があります」表示になっている）場合は、ブラウザの開発者ツール（Application > Local Storage）またはサイトデータ消去で `smart_closet_sync_tombstones` と `smart_closet_sync_dirty` を削除します（※これを残したまま同期すると、端末側の未送信墓標が再び Push されてしまいます）。
   - クラウド同期モーダルを開き、折りたたみ「詳細・復旧（個別でやり直す場合）」の中の **「📥 シートから取り直す」**（または未送信がない状態で「今すぐ同期」）をタップします。
   - 復元された着用履歴・奥様NGが端末に表示されることを確認し、手順1でオフにした場合は「自動同期」をオンに戻します。
5. **他方の端末への反映:**
   - もう一方の端末でもアプリを開き、「今すぐ同期」（または「📥 シートから取り直す」）を実行して、両端末ともに復旧後のデータで揃っていることを確認します。
