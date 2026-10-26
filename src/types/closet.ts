export type Category = 'shirt' | 'pants';
export type SceneMode = 'office' | 'remote';

/**
 * 標準色パレット（全12色、青の濃淡3段：濃紺（ネイビー含む）／ブルー／淡青）
 * 奥さんのNG判定3類型（濃紺×濃紺、淡青×ブルー/淡青、生成り×淡色）を再現する語彙
 */
export const GARMENT_COLOR_PALETTE = [
  '白',
  '生成り',
  '黒',
  'チャコール',
  'ミディアムグレー',
  'ライトグレー',
  'グレージュ',
  '濃紺',
  'ブルー',
  '淡青',
  'オリーブ',
  'ブラウン',
] as const;

export type GarmentColor = (typeof GARMENT_COLOR_PALETTE)[number];

/**
 * 主要実寸目安（cm、A4用紙 210×297mm 基準で推定／手動修正可）
 */
export interface GarmentMeasurements {
  // シャツ用 (category === 'shirt')
  bodyLength?: number;    // 着丈 (cm): 後ろ襟ぐり中央〜裾
  chestWidth?: number;    // 身幅 (cm): 両脇下の平置き直線幅
  shoulderWidth?: number; // 肩幅 (cm): 左肩先〜右肩先の直線幅
  sleeveLength?: number;  // 袖丈 (cm): 肩先〜袖口

  // パンツ用 (category === 'pants')
  waist?: number;         // ウエスト (cm): 平置き上端幅×2 の内周目安
  inseam?: number;        // 股下 (cm): 内股の縫い目〜裾
  totalLength?: number;   // 総丈 (cm): ウエスト上端〜裾までの全長
  hemWidth?: number;      // 裾幅 (cm): 裾の平置き幅
}

/**
 * Gemini Vision による服領域の正規化座標 (0〜1000)
 */
export interface GarmentCropBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface ClosetItem {
  id: string;
  category: Category;
  name: string;
  imageUrl: string;
  seasonSleeve: string;
  dressScore: number;
  comfortScore: number;
  officeRecommendIds: string[];
  remoteRecommendIds: string[];
  ngIds: string[];
  ngReason: string;
  notes: string;
  color?: GarmentColor;
  measurements?: GarmentMeasurements;
}

/**
 * 既存服の色パレット一括相談用のペイロード型（色のみを更新し名前は書き換えない）
 */
export interface ColorUpdateItem {
  id: string;
  color: GarmentColor;
}

export interface BatchColorUpdatesPayload {
  colorUpdates: ColorUpdateItem[];
}

export interface ClosetData {
  items: ClosetItem[];
  updatedAt?: number; // カスタム服データの作成・インポート時刻
}

export interface WearRecord {
  id: string;
  date: string; // YYYY-MM-DD
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
  customClosetDataUpdatedAt?: number;       // 送信カスタム服データの更新時刻
  clearCustomClosetData?: boolean;
  customClosetDataClearedAt?: number;       // カスタムデータ削除時刻
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
  customClosetDataClearedAt?: number;       // サーバー側のカスタムデータ削除時刻
  tombstones?: SyncTombstones;              // サーバー側の削除 Tombstone 状態
  imageFolderId?: string;                   // サーバー meta_config の画像フォルダID (Single Source of Truth)
  imagesLastUpdatedAt?: number;             // ドライブ内画像の最新更新タイムスタンプ (超軽量チェック用)
  syncedAt?: string;
}

// ----------------------------------------------------
// Google ドライブ画像同期関連の型定義 (Phase 1〜2)
// ----------------------------------------------------

export interface GetImageSyncPlanRequest {
  action: 'getImageSyncPlan';
  token?: string;
  localMeta: Record<string, number>; // { [itemId]: lastModifiedTimestamp }
}

export interface GetImageSyncPlanResponse {
  ok: boolean;
  error?: string;
  validItemIds: string[];            // ドライブ上に現存する全有効アイテムID (大文字正規化済み、Prune用)
  neededItemIds: string[];           // 新規または更新された取得対象アイテムID
  imagesLastUpdatedAt: number;       // フォルダ内の最新更新タイムスタンプ
  warnings?: string[];               // 非対応形式 (HEIC等) の注意喚起警告 (指摘B)
}

export interface FetchImagesRequest {
  action: 'fetchImages';
  token?: string;
  itemIds: string[];                 // チャンク指定された取得対象アイテムID (6〜8件)
}

export interface FetchImagesResponse {
  ok: boolean;
  error?: string;
  images: Record<string, string>;    // { [itemId]: "data:image/jpeg;base64,..." }
  timestamps: Record<string, number>;// { [itemId]: modifiedTimestamp }
  warnings?: string[];               // 非対応形式やサイズ超過等の警告
}

// ----------------------------------------------------
// Cloudflare Pages Functions ブートストラップ関連の型定義
// ----------------------------------------------------

export interface BootstrapConfigResponse {
  ok: boolean;
  webAppUrl?: string;
  secretToken?: string;
  userEmail?: string;
  error?: string;
}

// ----------------------------------------------------
// Google ドライブ画像直接アップロード関連の型定義
// ----------------------------------------------------

export interface UploadImageRequest {
  action: 'uploadImage';
  token?: string;
  itemId: string;
  mimeType: string;
  base64Data: string; // data URL または純粋な base64
}

export interface UploadImageResponse {
  ok: boolean;
  error?: string;
  itemId?: string;
  fileId?: string;
  modifiedTime?: number;
}

// ----------------------------------------------------
// ワードローブ分析・インサイト関連の型定義
// ----------------------------------------------------

export interface ItemCompatibilityStats {
  item: ClosetItem;
  officeRecommendIds: string[];
  remoteRecommendIds: string[];
  acceptableIds: string[];
  ngIds: string[];
  wifeNgIds: string[];
  isBottleneck: boolean;
  bottleneckReason?: string;
}

export interface WardrobeAnalysisResult {
  shirtStats: ItemCompatibilityStats[];
  pantsStats: ItemCompatibilityStats[];
  bottleneckShirts: ItemCompatibilityStats[];
  bottleneckPants: ItemCompatibilityStats[];
  officeAcePants: ClosetItem[];
}

// ----------------------------------------------------
// まとめ撮り一括登録関連の型定義
// ----------------------------------------------------

/**
 * まとめ撮り一括登録の最大着数（推奨2〜3着、ハード上限3着）
 */
export const MAX_BATCH_GARMENTS = 3;

/**
 * まとめ撮り1着分の下書きペイロード型（SingleItem + 個別cropBox）
 */
export interface BatchGarmentDraftItem extends Partial<ClosetItem> {
  cropBox?: GarmentCropBox | null;
}

export interface BatchGarmentsPayload {
  garments: BatchGarmentDraftItem[];
}

export interface BatchGarmentItemResult {
  index: number;
  status: 'applied' | 'failed' | 'skipped';
  assignedId?: string;
  name?: string;
  category?: Category;
  item?: ClosetItem;
  cropBox?: GarmentCropBox | null;
  updatedPeersCount?: number;
  warning?: string;
  unconfirmedColorHint?: string;
  error?: string;
}

export interface BatchGarmentsMergeResult {
  valid: boolean;
  data?: ClosetData;
  results: BatchGarmentItemResult[];
  appliedCount: number;
  failedCount: number;
  skippedCount: number;
  remainingDrafts: BatchGarmentDraftItem[];
  error?: string;
}


