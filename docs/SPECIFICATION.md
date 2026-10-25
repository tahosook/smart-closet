# スマートクローゼット機能・画面・データ仕様書 (docs/SPECIFICATION.md)

本ドキュメントは、Smart Closet (`smart-closet`) の画面仕様、レスポンシブ設計、データモデル、および推薦・冷却ロジックを明文化した仕様書である。

---

## 1. システム概要 & アーキテクチャ原則

- **完全サーバーレス・APIキーレス（フロントエンド）:**
  - 外部LLM APIへの直接通信コードは実装しない（ユーザー自身がGoogle AI Pro / Geminiにプロンプトを貼り付けて再計算するHuman-in-the-loop方式）。
  - 気象データのみ、APIキー不要の Open-Meteo API をクライアントサイド（ブラウザ）から直接フェッチする。
- **ローカルファースト ＆ オプションGASクラウド同期（Cloudflare Pages 自動ブートストラップ）:**
  - **朝1秒の即決原則:** すべての操作（着用記録・奥様NG・推薦判定）は、まず `localStorage` と React Context 上で 0ms で完結。
  - **ゼロ入力ブートストラップ:** Cloudflare Access 背後の本番環境では、Pages Function (`/api/bootstrap-config`) から安全に GAS URL とシークレット合言葉が自動取得され、端末ごとの初期手入力が不要（合言葉や URL が消えた場合も自動復元）。詳細インフラ構成は [docs/OPERATIONS.md](./OPERATIONS.md) 参照。
  - **端末間シームレス同期:** Google Apps Script (`gas/Code.gs`) Web App を介して、Pixel 9a と Mac mini の間で着用履歴・奥様NGをバックグラウンド（非同期 Simple Request POST）で自動同期。オフライン時は保留フラグを保持し、次回接続時に自動再送。
  - **Google スプレッドシート連携:** `wear_history`、`wife_ng`、`analytics`（60日未着用アイテムの断捨離アラート、主力エース集計）をシート上に自動構築。写真フォルダ ID は `meta_config` シートが唯一の正本。
- **データの正本 (Single Source of Truth):**
  - マスターデータは `src/data/closet.json`（Git管理）。
  - 日常の状態変化（着用履歴、緊急の奥様NGペア登録、インポートされたカスタムデータ）は `localStorage` に保存され、起動時にマージして表示される。
  - `localStorage` に登録された奥様NGペアは、1クリックで `closet.json` スキーマにマージした完全版JSONとしてエクスポート（ダウンロードおよびクリップボードコピー）可能。

---

## 2. 画面・タブ仕様

### 共通レイアウト & レスポンシブ設計
- **モバイル (Google Pixel 9a):**
  - 片手親指操作を重視した1カラム構成。
  - 下部に固定された4タブナビゲーション（朝モード、服追加・AI、旅行、全マトリクス）。
  - タップターゲットは最低 44x44px を確保。
- **デスクトップ (Mac mini / ワイド画面):**
  - コンテナ幅を最大 `max-w-6xl` に拡張。
  - 朝モード（`TodayView`）は「左ペイン：天気・シーン・シャツ選択」「右ペイン：おすすめパンツ＆拡大表示」の2ペイン構成で一望可能。
  - 全マトリクス表（`MatrixView`）は全15パンツ列を横スクロールなしで快適に閲覧可能。

---

### Tab 1: 朝モード (`TodayView.tsx`)
毎朝1秒でその日のコーディネートを確定するための画面。

1. **気象連動ウィジェット (`WeatherWidget.tsx`):**
   - デフォルト位置：千葉県我孫子市 (`35.8644, 139.9708`)。現在地取得への切替・再取得も可能。
   - 当日の最高気温・最低気温・現在気温・天気を取得し、気温に応じた推奨袖丈（半袖・七分袖・長袖）を自動判定。手動切替も可能。
2. **シーン切替:**
   - 「🏢 オフィス出社」と「🏠 リモート＆外出」を1タップで切替。
3. **シャツ選択グリッド:**
   - 気温・袖丈に合致するシャツを上部に優先表示（1タップで選択）。
   - 気温外のシャツはアコーディオン内に折りたたまれ、必要に応じて展開・選択可能。
4. **【1秒即決】おすすめパンツカード:**
   - 選択されたシャツに対し、相性スコア順に第1候補・第2候補・第3候補を大判写真カードで提案。
   - 各カードには「相性理由」「ドレス度」「今日これ着る（決定ボタン）」「奥様NG登録ボタン」を配置。
   - 写真または虫眼鏡アイコンをタップすると、上下コーディネートを並べた拡大プレビューモーダルを表示。
5. **冷却期間バッジ (`⚠️ 昨日着用（冷却中）`):**
   - 昨日（または直近記録日）に着用したパンツは自動的に順位が末尾に下げられ、警告バッジを表示。
6. **その他の着用可能パンツ & NG一覧:**
   - 第4候補以降のパンツ、およびNG判定されたパンツ（理由・奥様NG解除ボタン付き）をアコーディオンで確認可能。
   - **出社モード時は、ドレス度 3.0 未満のスウェット・ジョガー系はすべてNGリスト側に分類され、候補から除外される。**

---

### Tab 2: 服の追加・AI再検討 (`AiSyncView.tsx`)
新しい服を購入した際、Gemini Pro に写真とデータを渡して決定論的にマージ・クラウド同期するための画面。手作業とアプリ間移動を最小化する3ステップ設計。

1. **Step 1: 写真の直接選択・端末保存 & Google ドライブ自動保存:**
   - 端末で写真を選択または撮影すると、クライアント側（Canvas）で長辺最大1200px・JPEG品質0.85に自動リサイズ・圧縮（白下地処理でPNG黒化防止）。
   - 端末の IndexedDB に 0ms で即時永続化され、アプリ内で即座に写真プレビューが表示される。
   - GAS 連携済みの場合は、Google ドライブの正本フォルダ（`meta_config` 登録フォルダ）へ自動で直接アップロード（ファイル名は `{ID}.jpg` で自動正規化、同名旧ファイルはゴミ箱退避）。
   - オフライン時やドライブ手動管理用のフォールバックダウンロード機能も併設。
2. **Step 2: チップ選択 & 単一アイテム用プロンプト生成:**
   - カテゴリ（パンツ／シャツ）、アイテム名、特徴メモを入力。
   - 季節・袖丈は自由テキストではなくプリセットのチップ選択（「長袖・通年」「春夏秋・七分袖」「春夏・半袖」「秋冬・長袖」等）。
   - ［📋 Gemini相談用プロンプトをコピー］を押すと、既存全データの再出力を求めず、**新規追加する1着分のみのJSON断片**（`officeRecommendIds`, `remoteRecommendIds`, `ngIds` を含む）を出力させる安全なプロンプトを生成。
3. **Step 3: 単一アイテムJSON貼り付け & 決定論的マージ・自動同期:**
   - Gemini から返ってきた1着分のJSONコードを貼り付けて［💾 JSONを適用して自動マージ・保存］を押す。
   - アプリ側ドメインロジック（`mergeSingleItemIntoClosetData`）が決定論的に実行され、既存アイテム間の相性配列（$S_i \times P_j$）を一切変更せず、新規アイテムと相手側アイテムの相互参照のみを安全に更新。
   - 適用完了と同時に GAS への自動クラウド同期（背景同期）がトリガーされ、Pixel 9a と Mac mini の同期を保つ。
   - ［JSON保存］ボタンでマージ済み最新 `closet.json` のエクスポート、および初期マスターデータへのリセット機能も完備。

---

### Tab 3: 旅行パッキング (`TravelPlannerView.tsx`)
荷物を最小化しながら奥様NGを100%回避するパッキング計画画面。

1. **旅行設定:**
   - 泊数（1泊2日〜4泊5日）および目的（出張・きれいめ重視 / 観光・快適さ重視）を選択。
2. **持ち物リスト自動算出:**
   - 着回し力の高い「厳選ボトムス2本」と「日数分のシャツ」を自動選定。
3. **日別タイムライン:**
   - ボトムス2本を1日おきに交互着用し、毎日異なるシャツを合わせるスケジュールと各日のTPOメモを一覧表示。
   - ［🔄 別の組み合わせパターンを再提案］でシード値を回転可能。

---

### Tab 4: 全マトリクス一覧 (`MatrixView.tsx`)
全アイテムの組み合わせ相性を一望し、ワードローブの死角やボトルネックを発見する管理者・分析画面。アイテム数増加（500セル超）でも破綻しない3層構造を採用。

1. **第1層：インサイト＆穴の発見ダッシュボード（最上部）:**
   - `analyzeWardrobeStats` によるワードローブ健全性サマリー（総組合せ数、出社◎相性数、NG組合せ数、健全率%）を表示。
   - ボトルネックアイテムの動的警告カード:
     - 出社◎が少ないシャツ（1着以下）
     - 出社◎が少ないスラックス（ドレス度3.0以上かつ出社◎1着以下）
     - NG集中アイテム（NG率40%以上）
     - 孤立アイテム（相性ペア極少）
   - 各要注意アイテムのバッジ・カードをタップすると、第2層（ドリルダウン）のフォーカス対象に即座に遷移。
2. **第2層：アイテム別ドリルダウン表示（1着フォーカスビュー）:**
   - 選択された1着（シャツまたはパンツ）に対し、相手側全アイテムとの相性をソート一覧（出社◎ → リモート○ → 着用可△ → 奥様NG🚨 → 絶対NG×）でカード表示。
   - 各カードをタップすると上下拡大プレビューモーダルが開き、奥様NGの即時登録・解除が可能。
3. **第3層：全体マトリックス表（高密度表＋統一フィルター＋モバイル折りたたみ）:**
   - 統一5フィルター: `すべて` / `⚠️ 要注意アイテムのみ` / `🏢 出社対応のみ` / `🧥 長袖のみ` / `☀️ 七分袖・半袖のみ` で瞬時に絞り込み。
   - モバイル向け折りたたみアコーディオン（画面を占有せず、必要な時だけ展開）。
   - 全セルのタップ領域を最低 44×44px（`min-w-[44px] min-h-[44px]`）確保。
4. **ワードローブ偏り分析＆買い足しレコメンド:**
   - 出社エース（ドレス度3.5以上）パンツの充足度、S1の相性パートナー状況を解説。
   - 次の連番ID（`getNextSequentialId` による採番）を用いた黒テーパードスラックス等の買い足し提案。

---

### 着用履歴モーダル (`HistoryModal.tsx`)
- ヘッダーの時計アイコンからいつでも呼び出し可能。
- 過去の着用履歴一覧（日付、シーン、シャツ名、パンツ名）の閲覧・個別削除・全クリア。
- **冷却期間クイックテスト（昨日着用シミュレート）:**
  - 任意のパンツをタップすると、「昨日着用」として即座に履歴を追加し、朝モードでの順位降格動作を即座にシミュレート可能。

---

### クラウド同期・スプレッドシート連携モーダル (`GasSyncModal.tsx`)
- ヘッダーの雲アイコンから呼び出し可能。
- **動的ステータス表示:** `未設定`（ローカルモード）、`同期中`（スピナー）、`同期完了`（緑ドット＆最終日時）、`オフライン保留中`（黄ドット）。
- **GAS Web App URL & 合言葉設定:** ユーザー自身の GAS URL を保存・管理。
- **クラウドから設定を自動取得:** ［☁️ クラウドから設定を自動取得］ボタンにより、いつでも Cloudflare Pages Functions から最新設定を再同期可能（ローカル環境や未設定時は手入力へフォールバック）。
- **手動同期アクション:**
  - ［🔄 スプレッドシートから取得 (Pull)］: スプレッドシート側の直接編集を即時反映。
  - ［☁️ 端末データをシートへ送信 (Push)］: 現在の履歴・NGデータをスプレッドシートへ強制送信。
- **3分でできる連携ガイド:** アプリ内からワンクリックで `gas/Code.gs` をコピー可能。

---

## 3. データモデル (TypeScript型定義)

```typescript
export type Category = 'shirt' | 'pants';
export type SceneMode = 'office' | 'remote';

export interface ClosetItem {
  id: string;                    // 例: "S1", "P15"
  category: Category;            // "shirt" | "pants"
  name: string;                  // 例: "白無地長袖シャツ（紺ボタン）"
  imageUrl: string;              // 例: "/images/S2.jpg"
  seasonSleeve: string;          // 例: "長袖・通年", "春夏・半袖", "春夏秋・七分袖"
  dressScore: number;            // 1.0 〜 5.0
  comfortScore: number;          // 1.0 〜 5.0
  officeRecommendIds: string[];  // 出社時のおすすめ相手ID配列
  remoteRecommendIds: string[];  // リモート時のおすすめ相手ID配列
  ngIds: string[];               // 絶対NGの相手ID配列
  ngReason: string;              // NG理由
  notes: string;                 // 特徴・役割メモ
}

export interface ClosetData {
  items: ClosetItem[];
  updatedAt?: number;            // カスタム服データの作成・インポート時刻
}

export interface WearRecord {
  id: string;                    // 一意ID
  date: string;                  // "YYYY-MM-DD"
  shirtId: string;
  pantsId: string;
  scene: SceneMode;
  timestamp: number;
}

export interface WifeNgPair {
  shirtId: string;
  pantsId: string;
  reason: string;
  createdAt: string;
}

export interface RecommendationResult {
  pants: ClosetItem;
  rank: number;
  isYesterdayWorn: boolean;
  score: number;
  affinityReason: string;
  dressScore: number;
  comfortScore: number;
  isOfficeRecommend: boolean;
  isRemoteRecommend: boolean;
}

export type SyncStatus = 'unconfigured' | 'idle' | 'syncing' | 'synced' | 'offline_pending' | 'error';

export interface GasSyncConfig {
  webAppUrl: string;
  secretToken?: string;
  autoSync: boolean;
  lastSyncedAt?: string;
  imageFolderId?: string;
  imagesLastUpdatedAt?: number;
}

export interface SyncTombstones {
  deletedWearMap: Record<string, number>;   // { [id]: deletedAtTimestamp }
  wearHistoryClearedAt?: number;
  deletedWifeNgMap: Record<string, number>; // { [shirtId_pantsId]: deletedAtTimestamp }
  clearCustomClosetData?: boolean;
  customClosetDataClearedAt?: number;       // カスタムデータリセット実行時刻タイムスタンプ
}

export interface GasSyncPayload {
  action: 'push' | 'pull';
  token?: string;
  wearHistory?: WearRecord[];
  wifeNgPairs?: WifeNgPair[];
  customClosetData?: ClosetData;
  customClosetDataUpdatedAt?: number;
  clearCustomClosetData?: boolean;
  customClosetDataClearedAt?: number;
  deletedWearMap?: Record<string, number>;
  wearHistoryClearedAt?: number;
  deletedWifeNgMap?: Record<string, number>;
  itemNamesMap?: Record<string, string>;
  imageFolderId?: string;
}

export interface GasSyncResponse {
  ok: boolean;
  error?: string;
  wearHistory?: WearRecord[];
  wifeNgPairs?: WifeNgPair[];
  customClosetData?: ClosetData | null;
  customClosetDataClearedAt?: number;
  tombstones?: SyncTombstones;
  imageFolderId?: string;
  imagesLastUpdatedAt?: number;
  syncedAt?: string;
}

export interface BootstrapConfigResponse {
  ok: boolean;
  webAppUrl?: string;
  secretToken?: string;
  userEmail?: string;
  error?: string;
}
```

---

## 4. 推薦・冷却スコアリングロジック

`useClosetStore.ts` における `getRecommendationsForShirt(shirtId, scene)` の算出ロジック：

1. **除外フィルター (NG判定):**
   - ① `wifeNgPairs`（奥様NG）に該当するペアはNGリストへ。
   - ② `shirt.ngIds` または `pants.ngIds` に含まれるペアはNGリストへ。
   - ③ **出社モード（`scene === 'office'`）かつ `pants.dressScore < 3.0`（スウェット・ジョガー系）は、オフィス不適合としてNGリストへ。**
2. **基本スコア算出:**
   - 出社モード: `score = (pants.dressScore * 1.5 + pants.comfortScore) * (isPrimaryRec ? 1.5 : isSecondaryRec ? 1.2 : 1.0)`
   - リモートモード: `score = (pants.comfortScore * 1.5 + pants.dressScore) * (isPrimaryRec ? 1.5 : isSecondaryRec ? 1.2 : 1.0)`
3. **冷却期間ソート:**
   - 直近着用日（昨日または履歴の最新日）に着用されたパンツは `isYesterdayWorn = true` となり、**未着用パンツの後に末尾ソート**される。
