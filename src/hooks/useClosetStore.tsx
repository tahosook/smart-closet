import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ClosetData,
  ClosetItem,
  SceneMode,
  WearRecord,
  WifeNgPair,
  RecommendationResult,
  SyncStatus,
  GasSyncConfig,
  GasSyncPayload,
  GasSyncResponse,
  SyncTombstones,
  BootstrapConfigResponse,
} from '../types/closet';
import defaultClosetData from '../data/closet.json';
import {
  hasRemainingTombstones,
  reconcileSyncResponse,
} from '../utils/syncReconcile';
import {
  validateClosetDataSchema,
  validateSingleClosetItem,
  mergeSingleItemIntoClosetData,
  applyBatchColorUpdates,
  mergeClosetDataWithWifeNg,
  checkIsNgPair,
  calculateRecommendationsForShirt,
} from '../utils/closetDomain';

const STORAGE_KEYS = {
  CUSTOM_DATA: 'smart_closet_custom_data',
  WEAR_HISTORY: 'smart_closet_wear_history',
  WIFE_NG: 'smart_closet_wife_ng',
  GAS_CONFIG: 'smart_closet_gas_config',
  SYNC_DIRTY: 'smart_closet_sync_dirty',
  SYNC_TOMBSTONES: 'smart_closet_sync_tombstones',
};

function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getYesterdayString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function generateSecretToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return 'sc_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ClosetStoreContextType {
  closetData: ClosetData;
  mergedClosetData: ClosetData;
  shirts: ClosetItem[];
  pants: ClosetItem[];
  itemMap: Map<string, ClosetItem>;
  wearHistory: WearRecord[];
  todayRecord: WearRecord | undefined;
  yesterdayWornPantsIds: Set<string>;
  wifeNgPairs: WifeNgPair[];
  syncStatus: SyncStatus;
  gasConfig: GasSyncConfig;
  lastSyncError: string | null;
  isNgPair: (shirtId: string, pantsId: string) => { isNg: boolean; reason: string; isWifeNg: boolean };
  getRecommendationsForShirt: (shirtId: string, scene: SceneMode) => {
    recommended: RecommendationResult[];
    otherOk: RecommendationResult[];
    ngList: { pants: ClosetItem; reason: string; isWifeNg: boolean }[];
  };
  recordWear: (shirtId: string, pantsId: string, scene: SceneMode, dateStr?: string) => void;
  simulateYesterdayWear: (pantsId: string) => void;
  removeWearRecord: (id: string) => void;
  clearAllWearHistory: () => void;
  registerWifeNg: (shirtId: string, pantsId: string, customReason?: string) => void;
  removeWifeNg: (shirtId: string, pantsId: string) => void;
  importCustomData: (jsonString: string) => {
    success: boolean;
    mode?: 'single' | 'full' | 'batch_color';
    addedItem?: ClosetItem;
    updatedPeersCount?: number;
    error?: string;
  };
  resetToDefaultData: () => void;
  updateGasConfig: (newConfig: Partial<GasSyncConfig>) => void;
  pullFromGas: () => Promise<boolean>;
  pushToGas: () => Promise<boolean>;
  fetchBootstrapConfig: (options?: { onlyFillMissing?: boolean }) => Promise<boolean>;
}

const ClosetContext = createContext<ClosetStoreContextType | null>(null);

export const ClosetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1. Master closet data
  const [closetData, setClosetData] = useState<ClosetData>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CUSTOM_DATA);
      if (saved) {
        const parsed = JSON.parse(saved);
        const validation = validateClosetDataSchema(parsed);
        if (validation.valid && validation.data) {
          return validation.data;
        }
        console.warn('Invalid custom closet data found in localStorage, falling back to default:', validation.error);
      }
    } catch (e) {
      console.error('Failed to parse custom closet data:', e);
    }
    return defaultClosetData as ClosetData;
  });

  // 2. Wear history
  const [wearHistory, setWearHistory] = useState<WearRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.WEAR_HISTORY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to parse wear history:', e);
    }
    return [];
  });

  // 3. Wife NG pairs
  const [wifeNgPairs, setWifeNgPairs] = useState<WifeNgPair[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.WIFE_NG);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to parse wife NG pairs:', e);
    }
    return [];
  });

  // 4. GAS Sync configuration
  const [gasConfig, setGasConfig] = useState<GasSyncConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.GAS_CONFIG);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return {
            ...parsed,
            webAppUrl: typeof parsed.webAppUrl === 'string' ? parsed.webAppUrl : '',
            secretToken: typeof parsed.secretToken === 'string' ? parsed.secretToken : '',
          };
        }
      }
    } catch (e) {
      console.error('Failed to parse GAS config:', e);
    }
    return {
      webAppUrl: '',
      secretToken: '',
      autoSync: true,
      lastSyncedAt: undefined,
    };
  });

  // 5. Tombstones for deleted records and custom data reset (timestamped maps)
  const [tombstones, setTombstones] = useState<SyncTombstones>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SYNC_TOMBSTONES);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          deletedWearMap: parsed.deletedWearMap || {},
          deletedWifeNgMap: parsed.deletedWifeNgMap || {},
          wearHistoryClearedAt: parsed.wearHistoryClearedAt,
          clearCustomClosetData: parsed.clearCustomClosetData,
          customClosetDataClearedAt: parsed.customClosetDataClearedAt,
        };
      }
    } catch (e) {
      console.error('Failed to parse tombstones:', e);
    }
    return { deletedWearMap: {}, deletedWifeNgMap: {} };
  });

  // 6. Sync runtime status
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => {
    return gasConfig.webAppUrl ? 'idle' : 'unconfigured';
  });
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);

  // Sync state refs & mutation sequence tracking to prevent stale closures and race conditions
  const mutationSeqRef = useRef<number>(0);
  const customDataSeqRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const pendingPushRef = useRef<boolean>(false);
  const lastAutoSyncAtRef = useRef<number>(0);

  const stateRef = useRef({
    closetData,
    wearHistory,
    wifeNgPairs,
    gasConfig,
    tombstones,
  });
  useEffect(() => {
    stateRef.current = { closetData, wearHistory, wifeNgPairs, gasConfig, tombstones };
  }, [closetData, wearHistory, wifeNgPairs, gasConfig, tombstones]);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.WEAR_HISTORY, JSON.stringify(wearHistory));
  }, [wearHistory]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.WIFE_NG, JSON.stringify(wifeNgPairs));
  }, [wifeNgPairs]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.GAS_CONFIG, JSON.stringify(gasConfig));
  }, [gasConfig]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SYNC_TOMBSTONES, JSON.stringify(tombstones));
  }, [tombstones]);

  // Merged ClosetData incorporating wifeNgPairs
  const mergedClosetData = useMemo<ClosetData>(() => {
    return mergeClosetDataWithWifeNg(closetData, wifeNgPairs);
  }, [closetData, wifeNgPairs]);

  const shirts = useMemo(
    () => closetData.items.filter((item) => item.category === 'shirt'),
    [closetData]
  );
  const pants = useMemo(
    () => closetData.items.filter((item) => item.category === 'pants'),
    [closetData]
  );

  const itemMap = useMemo(() => {
    const map = new Map<string, ClosetItem>();
    closetData.items.forEach((item) => map.set(item.id, item));
    return map;
  }, [closetData]);

  const itemNamesMap = useMemo(() => {
    const map: Record<string, string> = {};
    closetData.items.forEach((item) => {
      map[item.id] = item.name;
    });
    return map;
  }, [closetData]);

  const todayStr = getTodayString();
  const yesterdayStr = getYesterdayString();

  const todayRecord = useMemo(
    () => wearHistory.find((r) => r.date === todayStr),
    [wearHistory, todayStr]
  );

  const yesterdayWornPantsIds = useMemo(() => {
    const ids = new Set<string>();
    wearHistory
      .filter((r) => r.date === yesterdayStr)
      .forEach((r) => ids.add(r.pantsId));

    if (ids.size === 0) {
      const pastRecords = wearHistory
        .filter((r) => r.date < todayStr)
        .sort((a, b) => b.date.localeCompare(a.date));
      if (pastRecords.length > 0) {
        ids.add(pastRecords[0].pantsId);
      }
    }
    return ids;
  }, [wearHistory, yesterdayStr, todayStr]);

  const isNgPair = useCallback(
    (shirtId: string, pantsId: string): { isNg: boolean; reason: string; isWifeNg: boolean } => {
      return checkIsNgPair(shirtId, pantsId, itemMap, wifeNgPairs);
    },
    [itemMap, wifeNgPairs]
  );

  const getRecommendationsForShirt = useCallback(
    (shirtId: string, scene: SceneMode) => {
      return calculateRecommendationsForShirt(
        shirtId,
        scene,
        itemMap,
        pants,
        wifeNgPairs,
        yesterdayWornPantsIds
      );
    },
    [itemMap, pants, wifeNgPairs, yesterdayWornPantsIds]
  );

  // -------------------------------------------------------------
  // GAS クラウド同期ロジック (Push / Pull)
  // -------------------------------------------------------------

  const pushToGas = useCallback(async (): Promise<boolean> => {
    const { webAppUrl, secretToken } = stateRef.current.gasConfig;
    if (!webAppUrl || !webAppUrl.startsWith('http')) {
      setSyncStatus('unconfigured');
      return false;
    }

    // 既に通信中の場合はキューに積んで重複リクエストを抑止 (Single-Flight)
    if (inFlightRef.current) {
      pendingPushRef.current = true;
      return false;
    }

    inFlightRef.current = true;
    setSyncStatus('syncing');
    setLastSyncError(null);

    // 送信時の世代スナップショット
    const sentSeq = mutationSeqRef.current;
    const sentCustomDataSeq = customDataSeqRef.current;
    const hasCustomData = localStorage.getItem(STORAGE_KEYS.CUSTOM_DATA) !== null;
    const sentTombstones: SyncTombstones = {
      deletedWearMap: { ...stateRef.current.tombstones.deletedWearMap },
      deletedWifeNgMap: { ...stateRef.current.tombstones.deletedWifeNgMap },
      wearHistoryClearedAt: stateRef.current.tombstones.wearHistoryClearedAt,
      clearCustomClosetData: stateRef.current.tombstones.clearCustomClosetData,
      customClosetDataClearedAt: stateRef.current.tombstones.customClosetDataClearedAt,
    };

    const payload: GasSyncPayload = {
      action: 'push',
      token: secretToken || undefined,
      wearHistory: stateRef.current.wearHistory,
      wifeNgPairs: stateRef.current.wifeNgPairs,
      customClosetData: hasCustomData ? stateRef.current.closetData : undefined,
      customClosetDataUpdatedAt: hasCustomData ? stateRef.current.closetData.updatedAt : undefined,
      clearCustomClosetData: Boolean(
        sentTombstones.clearCustomClosetData || sentTombstones.customClosetDataClearedAt !== undefined
      ),
      customClosetDataClearedAt: sentTombstones.customClosetDataClearedAt,
      deletedWearMap: sentTombstones.deletedWearMap,
      wearHistoryClearedAt: sentTombstones.wearHistoryClearedAt,
      deletedWifeNgMap: sentTombstones.deletedWifeNgMap,
      itemNamesMap,
      imageFolderId: stateRef.current.gasConfig.imageFolderId,
    };

    try {
      const res = await fetch(webAppUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(payload),
        redirect: 'follow',
      });

      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }

      const data: GasSyncResponse = await res.json();
      if (!data.ok) {
        throw new Error(data.error || 'GASからのエラーレスポンス');
      }

      const hasInFlightMutations = mutationSeqRef.current > sentSeq;
      const hasInFlightCustomDataChange = customDataSeqRef.current > sentCustomDataSeq;

      const reconcileResult = reconcileSyncResponse({
        serverResponse: data,
        currentLocal: {
          wearHistory: stateRef.current.wearHistory,
          wifeNgPairs: stateRef.current.wifeNgPairs,
          closetData: stateRef.current.closetData,
          hasCustomData: localStorage.getItem(STORAGE_KEYS.CUSTOM_DATA) !== null,
          tombstones: stateRef.current.tombstones,
        },
        sentTombstones,
        hasInFlightMutations,
        hasInFlightCustomDataChange,
        defaultClosetData: defaultClosetData as ClosetData,
      });

      // 反映
      stateRef.current.wearHistory = reconcileResult.wearHistory;
      stateRef.current.wifeNgPairs = reconcileResult.wifeNgPairs;
      stateRef.current.closetData = reconcileResult.closetData;
      stateRef.current.tombstones = reconcileResult.remainingTombstones;

      setWearHistory(reconcileResult.wearHistory);
      localStorage.setItem(STORAGE_KEYS.WEAR_HISTORY, JSON.stringify(reconcileResult.wearHistory));

      setWifeNgPairs(reconcileResult.wifeNgPairs);
      localStorage.setItem(STORAGE_KEYS.WIFE_NG, JSON.stringify(reconcileResult.wifeNgPairs));

      setClosetData(reconcileResult.closetData);
      if (reconcileResult.isCustomDataPresent) {
        localStorage.setItem(STORAGE_KEYS.CUSTOM_DATA, JSON.stringify(reconcileResult.closetData));
      } else {
        localStorage.removeItem(STORAGE_KEYS.CUSTOM_DATA);
      }

      setTombstones(reconcileResult.remainingTombstones);
      if (hasRemainingTombstones(reconcileResult.remainingTombstones)) {
        localStorage.setItem(STORAGE_KEYS.SYNC_TOMBSTONES, JSON.stringify(reconcileResult.remainingTombstones));
      } else {
        localStorage.removeItem(STORAGE_KEYS.SYNC_TOMBSTONES);
      }

      const syncedAt = data.syncedAt || new Date().toISOString();
      setGasConfig((prev) => {
        const updated: GasSyncConfig = {
          ...prev,
          lastSyncedAt: syncedAt,
          imageFolderId: data.imageFolderId !== undefined ? data.imageFolderId : prev.imageFolderId,
          imagesLastUpdatedAt: data.imagesLastUpdatedAt !== undefined ? data.imagesLastUpdatedAt : prev.imagesLastUpdatedAt,
        };
        localStorage.setItem(STORAGE_KEYS.GAS_CONFIG, JSON.stringify(updated));
        return updated;
      });

      if (reconcileResult.stillDirty) {
        localStorage.setItem(STORAGE_KEYS.SYNC_DIRTY, 'true');
        pendingPushRef.current = true;
        setSyncStatus('syncing');
      } else {
        localStorage.removeItem(STORAGE_KEYS.SYNC_DIRTY);
        setSyncStatus('synced');
      }

      return true;
    } catch (err: any) {
      console.warn('GAS Push failed (will retry on next connection):', err);
      setLastSyncError(err?.message || '同期通信エラー');
      setSyncStatus(navigator.onLine ? 'error' : 'offline_pending');
      localStorage.setItem(STORAGE_KEYS.SYNC_DIRTY, 'true');
      return false;
    } finally {
      inFlightRef.current = false;
      if (pendingPushRef.current) {
        pendingPushRef.current = false;
        setTimeout(() => {
          pushToGas();
        }, 50);
      }
    }
  }, [itemNamesMap]);

  const pullFromGas = useCallback(async (): Promise<boolean> => {
    const { webAppUrl, secretToken } = stateRef.current.gasConfig;
    if (!webAppUrl || !webAppUrl.startsWith('http')) {
      setSyncStatus('unconfigured');
      return false;
    }

    // ローカルに未送信の変更がある場合、Pull すると上書き消失するため Push (双方向マージ) に切り替える
    const isDirty = localStorage.getItem(STORAGE_KEYS.SYNC_DIRTY) === 'true';
    if (isDirty) {
      return pushToGas();
    }

    if (inFlightRef.current) {
      return false;
    }

    inFlightRef.current = true;
    setSyncStatus('syncing');
    setLastSyncError(null);

    const pullStartSeq = mutationSeqRef.current;
    const pullStartCustomSeq = customDataSeqRef.current;

    try {
      const url = new URL(webAppUrl);
      url.searchParams.set('action', 'pull');
      if (secretToken) {
        url.searchParams.set('token', secretToken);
      }

      const res = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'follow',
      });

      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }

      const data: GasSyncResponse = await res.json();
      if (!data.ok) {
        throw new Error(data.error || 'GASからのエラーレスポンス');
      }

      const hasInFlightMutations =
        mutationSeqRef.current > pullStartSeq ||
        localStorage.getItem(STORAGE_KEYS.SYNC_DIRTY) === 'true';
      const hasInFlightCustomDataChange = customDataSeqRef.current > pullStartCustomSeq;

      const reconcileResult = reconcileSyncResponse({
        serverResponse: data,
        currentLocal: {
          wearHistory: stateRef.current.wearHistory,
          wifeNgPairs: stateRef.current.wifeNgPairs,
          closetData: stateRef.current.closetData,
          hasCustomData: localStorage.getItem(STORAGE_KEYS.CUSTOM_DATA) !== null,
          tombstones: stateRef.current.tombstones,
        },
        sentTombstones: { deletedWearMap: {}, deletedWifeNgMap: {} },
        hasInFlightMutations,
        hasInFlightCustomDataChange,
        defaultClosetData: defaultClosetData as ClosetData,
      });

      stateRef.current.wearHistory = reconcileResult.wearHistory;
      stateRef.current.wifeNgPairs = reconcileResult.wifeNgPairs;
      stateRef.current.closetData = reconcileResult.closetData;
      stateRef.current.tombstones = reconcileResult.remainingTombstones;

      setWearHistory(reconcileResult.wearHistory);
      localStorage.setItem(STORAGE_KEYS.WEAR_HISTORY, JSON.stringify(reconcileResult.wearHistory));

      setWifeNgPairs(reconcileResult.wifeNgPairs);
      localStorage.setItem(STORAGE_KEYS.WIFE_NG, JSON.stringify(reconcileResult.wifeNgPairs));

      setClosetData(reconcileResult.closetData);
      if (reconcileResult.isCustomDataPresent) {
        localStorage.setItem(STORAGE_KEYS.CUSTOM_DATA, JSON.stringify(reconcileResult.closetData));
      } else {
        localStorage.removeItem(STORAGE_KEYS.CUSTOM_DATA);
      }

      setTombstones(reconcileResult.remainingTombstones);
      if (hasRemainingTombstones(reconcileResult.remainingTombstones)) {
        localStorage.setItem(STORAGE_KEYS.SYNC_TOMBSTONES, JSON.stringify(reconcileResult.remainingTombstones));
      } else {
        localStorage.removeItem(STORAGE_KEYS.SYNC_TOMBSTONES);
      }

      const syncedAt = data.syncedAt || new Date().toISOString();
      setGasConfig((prev) => {
        const updated: GasSyncConfig = {
          ...prev,
          lastSyncedAt: syncedAt,
          imageFolderId: data.imageFolderId !== undefined ? data.imageFolderId : prev.imageFolderId,
          imagesLastUpdatedAt: data.imagesLastUpdatedAt !== undefined ? data.imagesLastUpdatedAt : prev.imagesLastUpdatedAt,
        };
        localStorage.setItem(STORAGE_KEYS.GAS_CONFIG, JSON.stringify(updated));
        return updated;
      });

      if (reconcileResult.stillDirty) {
        localStorage.setItem(STORAGE_KEYS.SYNC_DIRTY, 'true');
        pendingPushRef.current = true;
        setSyncStatus('syncing');
      } else {
        localStorage.removeItem(STORAGE_KEYS.SYNC_DIRTY);
        setSyncStatus('synced');
      }

      return true;
    } catch (err: any) {
      console.warn('GAS Pull failed:', err);
      setLastSyncError(err?.message || '同期通信エラー');
      setSyncStatus(navigator.onLine ? 'error' : 'offline_pending');
      return false;
    } finally {
      inFlightRef.current = false;
      if (pendingPushRef.current) {
        pendingPushRef.current = false;
        setTimeout(() => {
          pushToGas();
        }, 50);
      }
    }
  }, [pushToGas]);

  const triggerBackgroundPush = useCallback(() => {
    localStorage.setItem(STORAGE_KEYS.SYNC_DIRTY, 'true');
    if (stateRef.current.gasConfig.webAppUrl && stateRef.current.gasConfig.autoSync) {
      if (inFlightRef.current) {
        pendingPushRef.current = true;
      } else {
        setTimeout(() => {
          pushToGas();
        }, 50);
      }
    }
  }, [pushToGas]);

  const fetchBootstrapConfig = useCallback(
    async (options?: { onlyFillMissing?: boolean }): Promise<boolean> => {
      const onlyFillMissing = options?.onlyFillMissing ?? false;
      try {
        const res = await fetch('/api/bootstrap-config', {
          method: 'GET',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
          },
          cache: 'no-store',
        });
        const contentType = res.headers.get('content-type') || '';
        if (!res.ok || !contentType.includes('application/json')) {
          return false;
        }
        const data: BootstrapConfigResponse = await res.json();
        if (!data.ok || !data.webAppUrl || !data.secretToken) {
          return false;
        }

        setGasConfig((prev) => {
          // URLと合言葉は対（ペア）として機能するため、片方でも欠けている場合、または手動再取得時は両方をクラウド値で置き換える
          // （旧バージョン等で空URL＋ローカル自動生成トークンが残っていた場合に不一致で認証エラーになるのを防止）
          const isPairIncomplete = !prev.webAppUrl.trim() || !prev.secretToken?.trim();
          const shouldReplace = !onlyFillMissing || isPairIncomplete;
          const nextUrl = shouldReplace ? data.webAppUrl! : prev.webAppUrl;
          const nextToken = shouldReplace ? data.secretToken! : (prev.secretToken ?? '');

          const updated: GasSyncConfig = {
            ...prev,
            webAppUrl: nextUrl,
            secretToken: nextToken,
          };
          localStorage.setItem(STORAGE_KEYS.GAS_CONFIG, JSON.stringify(updated));
          stateRef.current.gasConfig = updated;
          return updated;
        });

        setSyncStatus('idle');
        return true;
      } catch (err) {
        // 静かにフォールバック（手動入力を妨げない）
        return false;
      }
    },
    []
  );

  // 初回マウント時: webAppUrl または secretToken のどちらかが空の場合に自動ブートストラップ実行
  // ※ ローカル開発環境 (import.meta.env.DEV) では Pages Functions (/api/...) が存在しないため
  // 不要な 404 コンソールエラーを防ぐため自動実行をスキップ（手動モーダル実行時は試行可能）
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const currentCfg = stateRef.current.gasConfig;
    if (!currentCfg.webAppUrl.trim() || !currentCfg.secretToken?.trim()) {
      fetchBootstrapConfig({ onlyFillMissing: true });
    }
  }, [fetchBootstrapConfig]);

  // Initial sync on app start, reconnect listener, and visibilitychange listener (with 30s throttle)
  useEffect(() => {
    if (!gasConfig.webAppUrl) {
      setSyncStatus('unconfigured');
      return;
    }

    const runAutoSync = () => {
      const cfg = stateRef.current.gasConfig;
      if (!cfg.webAppUrl || !cfg.autoSync) return;
      const nowMs = Date.now();
      if (nowMs - lastAutoSyncAtRef.current < 30_000) return;
      lastAutoSyncAtRef.current = nowMs;
      const isDirty = localStorage.getItem(STORAGE_KEYS.SYNC_DIRTY) === 'true';
      if (isDirty) {
        pushToGas();
      } else {
        pullFromGas();
      }
    };

    if (gasConfig.autoSync) {
      runAutoSync();
    }

    const handleOnline = () => {
      const cfg = stateRef.current.gasConfig;
      if (cfg.webAppUrl && cfg.autoSync) {
        const stillDirty = localStorage.getItem(STORAGE_KEYS.SYNC_DIRTY) === 'true';
        if (stillDirty) {
          pushToGas();
        }
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        runAutoSync();
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [gasConfig.webAppUrl, gasConfig.autoSync, pushToGas, pullFromGas]);

  // Actions
  const recordWear = useCallback(
    (shirtId: string, pantsId: string, scene: SceneMode, dateStr: string = getTodayString()) => {
      mutationSeqRef.current++;
      const now = Math.max(Date.now(), (stateRef.current.tombstones.wearHistoryClearedAt || 0) + 1);
      const replacedRecords = stateRef.current.wearHistory.filter((r) => r.date === dateStr);
      const filtered = stateRef.current.wearHistory.filter((r) => r.date !== dateStr);
      const newRecord: WearRecord = {
        id: `${dateStr}_${now}`,
        date: dateStr,
        shirtId,
        pantsId,
        scene,
        timestamp: now,
      };
      const updatedWear = [newRecord, ...filtered].sort((a, b) => b.date.localeCompare(a.date));

      let updatedTombstones = stateRef.current.tombstones;
      if (replacedRecords.length > 0) {
        const nextDeletedWearMap = { ...stateRef.current.tombstones.deletedWearMap };
        replacedRecords.forEach((r) => {
          if (r.id !== newRecord.id) {
            nextDeletedWearMap[r.id] = Math.max(nextDeletedWearMap[r.id] || 0, now);
          }
        });
        updatedTombstones = {
          ...stateRef.current.tombstones,
          deletedWearMap: nextDeletedWearMap,
        };
        stateRef.current.tombstones = updatedTombstones;
        setTombstones(updatedTombstones);
      }

      stateRef.current.wearHistory = updatedWear;
      setWearHistory(updatedWear);
      triggerBackgroundPush();
    },
    [triggerBackgroundPush]
  );

  const simulateYesterdayWear = useCallback(
    (pantsId: string) => {
      const yDate = getYesterdayString();
      recordWear('S2', pantsId, 'office', yDate);
    },
    [recordWear]
  );

  const removeWearRecord = useCallback(
    (id: string) => {
      mutationSeqRef.current++;
      const now = Math.max(Date.now(), (stateRef.current.tombstones.deletedWearMap?.[id] || 0) + 1);
      const updatedWear = stateRef.current.wearHistory.filter((r) => r.id !== id);
      const updatedTombstones: SyncTombstones = {
        ...stateRef.current.tombstones,
        deletedWearMap: { ...stateRef.current.tombstones.deletedWearMap, [id]: now },
      };
      stateRef.current.wearHistory = updatedWear;
      stateRef.current.tombstones = updatedTombstones;
      setWearHistory(updatedWear);
      setTombstones(updatedTombstones);
      triggerBackgroundPush();
    },
    [triggerBackgroundPush]
  );

  const clearAllWearHistory = useCallback(() => {
    mutationSeqRef.current++;
    const now = Math.max(Date.now(), (stateRef.current.tombstones.wearHistoryClearedAt || 0) + 1);
    const updatedTombstones: SyncTombstones = {
      ...stateRef.current.tombstones,
      wearHistoryClearedAt: now,
      deletedWearMap: {},
    };
    stateRef.current.wearHistory = [];
    stateRef.current.tombstones = updatedTombstones;
    setWearHistory([]);
    setTombstones(updatedTombstones);
    triggerBackgroundPush();
  }, [triggerBackgroundPush]);

  const registerWifeNg = useCallback(
    (shirtId: string, pantsId: string, customReason = '🚨 奥様からNG指定') => {
      mutationSeqRef.current++;
      const key = `${shirtId}_${pantsId}`;
      const prevDeletedAt = stateRef.current.tombstones.deletedWifeNgMap?.[key] || 0;
      const now = Math.max(Date.now(), prevDeletedAt + 1);
      const exists = stateRef.current.wifeNgPairs.some((p) => p.shirtId === shirtId && p.pantsId === pantsId);
      if (!exists) {
        const updatedWifeNg: WifeNgPair[] = [
          {
            shirtId,
            pantsId,
            reason: customReason,
            createdAt: new Date(now).toISOString(),
          },
          ...stateRef.current.wifeNgPairs,
        ];
        stateRef.current.wifeNgPairs = updatedWifeNg;
        setWifeNgPairs(updatedWifeNg);
      }
      const nextMap = { ...stateRef.current.tombstones.deletedWifeNgMap };
      delete nextMap[key];
      const updatedTombstones: SyncTombstones = {
        ...stateRef.current.tombstones,
        deletedWifeNgMap: nextMap,
      };
      stateRef.current.tombstones = updatedTombstones;
      setTombstones(updatedTombstones);
      triggerBackgroundPush();
    },
    [triggerBackgroundPush]
  );

  const removeWifeNg = useCallback(
    (shirtId: string, pantsId: string) => {
      mutationSeqRef.current++;
      const key = `${shirtId}_${pantsId}`;
      const now = Math.max(Date.now(), (stateRef.current.tombstones.deletedWifeNgMap?.[key] || 0) + 1);
      const updatedWifeNg = stateRef.current.wifeNgPairs.filter((p) => !(p.shirtId === shirtId && p.pantsId === pantsId));
      const updatedTombstones: SyncTombstones = {
        ...stateRef.current.tombstones,
        deletedWifeNgMap: { ...stateRef.current.tombstones.deletedWifeNgMap, [key]: now },
      };
      stateRef.current.wifeNgPairs = updatedWifeNg;
      stateRef.current.tombstones = updatedTombstones;
      setWifeNgPairs(updatedWifeNg);
      setTombstones(updatedTombstones);
      triggerBackgroundPush();
    },
    [triggerBackgroundPush]
  );

  const importCustomData = useCallback(
    (
      jsonString: string
    ): {
      success: boolean;
      mode?: 'single' | 'full' | 'batch_color';
      addedItem?: ClosetItem;
      updatedPeersCount?: number;
      error?: string;
    } => {
      try {
        const parsed = JSON.parse(jsonString);

        let finalData: ClosetData;
        let mode: 'single' | 'full' | 'batch_color' = 'full';
        let addedItem: ClosetItem | undefined = undefined;
        let updatedPeersCount = 0;

        // 一括色更新形式（colorUpdates 配列を含むオブジェクト、または直接の更新配列）かどうかの判別
        const isBatchCandidate =
          parsed &&
          typeof parsed === 'object' &&
          (Array.isArray((parsed as any).colorUpdates) ||
            (Array.isArray(parsed) &&
              parsed.length > 0 &&
              typeof (parsed[0] as any)?.id === 'string' &&
              (parsed[0] as any)?.color !== undefined));

        if (isBatchCandidate) {
          const batchRes = applyBatchColorUpdates(stateRef.current.closetData, parsed);
          if (!batchRes.valid || !batchRes.data) {
            return {
              success: false,
              error: batchRes.error || '色パレット一括更新データの検証に失敗しました。',
            };
          }
          mode = 'batch_color';
          finalData = batchRes.data;
          updatedPeersCount = batchRes.updatedCount || 0;
        } else if (
          parsed &&
          typeof parsed === 'object' &&
          !Array.isArray((parsed as any).items) &&
          typeof (parsed as any).id === 'string'
        ) {
          const singleRes = validateSingleClosetItem(parsed, stateRef.current.closetData);
          if (!singleRes.valid || !singleRes.item) {
            return {
              success: false,
              error: singleRes.error || '単一アイテムの検証に失敗しました。',
            };
          }
          mode = 'single';
          addedItem = singleRes.item;
          updatedPeersCount =
            singleRes.item.officeRecommendIds.length +
            singleRes.item.remoteRecommendIds.length +
            singleRes.item.ngIds.length;
          finalData = mergeSingleItemIntoClosetData(stateRef.current.closetData, singleRes.item);
        } else {
          // 全体データ形式
          const validation = validateClosetDataSchema(parsed);
          if (!validation.valid || !validation.data) {
            return {
              success: false,
              error: validation.error || 'JSONデータの検証に失敗しました。',
            };
          }
          finalData = validation.data;
        }

        mutationSeqRef.current++;
        customDataSeqRef.current++;
        const now = Math.max(
          Date.now(),
          (stateRef.current.closetData.updatedAt || 0) + 1,
          (stateRef.current.tombstones.customClosetDataClearedAt || 0) + 1
        );
        const dataWithTimestamp: ClosetData = {
          ...finalData,
          updatedAt: now,
        };
        localStorage.setItem(STORAGE_KEYS.CUSTOM_DATA, JSON.stringify(dataWithTimestamp));
        stateRef.current.closetData = dataWithTimestamp;
        const updatedTombstones: SyncTombstones = {
          ...stateRef.current.tombstones,
          clearCustomClosetData: false,
          customClosetDataClearedAt: undefined,
        };
        stateRef.current.tombstones = updatedTombstones;
        setClosetData(dataWithTimestamp);
        setTombstones(updatedTombstones);
        triggerBackgroundPush();
        return { success: true, mode, addedItem, updatedPeersCount };
      } catch (e: any) {
        return { success: false, error: e.message || 'JSONの解析に失敗しました。' };
      }
    },
    [triggerBackgroundPush]
  );

  const resetToDefaultData = useCallback(() => {
    mutationSeqRef.current++;
    customDataSeqRef.current++;
    const now = Math.max(Date.now(), (stateRef.current.tombstones.customClosetDataClearedAt || 0) + 1);
    localStorage.removeItem(STORAGE_KEYS.CUSTOM_DATA);
    stateRef.current.closetData = defaultClosetData as ClosetData;
    const updatedTombstones: SyncTombstones = {
      ...stateRef.current.tombstones,
      clearCustomClosetData: true,
      customClosetDataClearedAt: now,
    };
    stateRef.current.tombstones = updatedTombstones;
    setClosetData(defaultClosetData as ClosetData);
    setTombstones(updatedTombstones);
    triggerBackgroundPush();
  }, [triggerBackgroundPush]);

  const updateGasConfig = useCallback((newConfig: Partial<GasSyncConfig>) => {
    setGasConfig((prev) => {
      const updated = { ...prev, ...newConfig };
      if (!updated.webAppUrl) {
        setSyncStatus('unconfigured');
      } else if (prev.webAppUrl !== updated.webAppUrl) {
        setSyncStatus('idle');
      }
      return updated;
    });
  }, []);

  const contextValue: ClosetStoreContextType = useMemo(
    () => ({
      closetData,
      mergedClosetData,
      shirts,
      pants,
      itemMap,
      wearHistory,
      todayRecord,
      yesterdayWornPantsIds,
      wifeNgPairs,
      syncStatus,
      gasConfig,
      lastSyncError,
      isNgPair,
      getRecommendationsForShirt,
      recordWear,
      simulateYesterdayWear,
      removeWearRecord,
      clearAllWearHistory,
      registerWifeNg,
      removeWifeNg,
      importCustomData,
      resetToDefaultData,
      updateGasConfig,
      pullFromGas,
      pushToGas,
      fetchBootstrapConfig,
    }),
    [
      closetData,
      mergedClosetData,
      shirts,
      pants,
      itemMap,
      wearHistory,
      todayRecord,
      yesterdayWornPantsIds,
      wifeNgPairs,
      syncStatus,
      gasConfig,
      lastSyncError,
      isNgPair,
      getRecommendationsForShirt,
      recordWear,
      simulateYesterdayWear,
      removeWearRecord,
      clearAllWearHistory,
      registerWifeNg,
      removeWifeNg,
      importCustomData,
      resetToDefaultData,
      updateGasConfig,
      pullFromGas,
      pushToGas,
      fetchBootstrapConfig,
    ]
  );

  return <ClosetContext.Provider value={contextValue}>{children}</ClosetContext.Provider>;
};

export function useClosetStore(): ClosetStoreContextType {
  const context = useContext(ClosetContext);
  if (!context) {
    throw new Error('useClosetStore must be used within a ClosetProvider');
  }
  return context;
}
