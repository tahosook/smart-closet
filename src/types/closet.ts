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
}

export interface GasSyncResponse {
  ok: boolean;
  error?: string;
  wearHistory?: WearRecord[];
  wifeNgPairs?: WifeNgPair[];
  customClosetData?: ClosetData | null;
  customClosetDataClearedAt?: number;       // サーバー側のカスタムデータ削除時刻
  tombstones?: SyncTombstones;              // サーバー側の削除 Tombstone 状態
  syncedAt?: string;
}


