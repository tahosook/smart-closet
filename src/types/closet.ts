export type Category = 'shirt' | 'pants';
export type SceneMode = 'office' | 'remote';

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




