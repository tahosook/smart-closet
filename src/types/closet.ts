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
  deletedWearIds?: string[];                // 下位互換用
  wearHistoryClearedAt?: number;
  deletedWifeNgMap: Record<string, number>; // { [shirtId_pantsId]: deletedAtTimestamp }
  deletedWifeNgKeys?: string[];             // 下位互換用
  clearCustomClosetData?: boolean;
  customClosetDataClearedAt?: number;       // カスタムデータリセット実行時刻タイムスタンプ
}

export interface GasSyncPayload {
  action: 'push' | 'pull';
  token?: string;
  wearHistory?: WearRecord[];
  wifeNgPairs?: WifeNgPair[];
  customClosetData?: ClosetData;
  clearCustomClosetData?: boolean;
  deletedWearMap?: Record<string, number>;
  deletedWearIds?: string[];
  wearHistoryClearedAt?: number;
  deletedWifeNgMap?: Record<string, number>;
  deletedWifeNgKeys?: string[];
  itemNamesMap?: Record<string, string>;
}

export interface GasSyncResponse {
  ok: boolean;
  error?: string;
  wearHistory?: WearRecord[];
  wifeNgPairs?: WifeNgPair[];
  customClosetData?: ClosetData | null;
  syncedAt?: string;
}


