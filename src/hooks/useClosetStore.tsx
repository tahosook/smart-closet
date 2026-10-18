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
} from '../types/closet';
import defaultClosetData from '../data/closet.json';
import {
  hasRemainingTombstones,
  reconcileSyncResponse,
} from '../utils/syncReconcile';

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
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'sc_';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
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
  importCustomData: (jsonString: string) => { success: boolean; error?: string };
  resetToDefaultData: () => void;
  updateGasConfig: (newConfig: Partial<GasSyncConfig>) => void;
  pullFromGas: () => Promise<boolean>;
  pushToGas: () => Promise<boolean>;
}

const ClosetContext = createContext<ClosetStoreContextType | null>(null);

export const ClosetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1. Master closet data
  const [closetData, setClosetData] = useState<ClosetData>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CUSTOM_DATA);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.items)) return parsed;
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
            secretToken: parsed.secretToken || generateSecretToken(),
          };
        }
      }
    } catch (e) {
      console.error('Failed to parse GAS config:', e);
    }
    return {
      webAppUrl: '',
      secretToken: generateSecretToken(),
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
    if (wifeNgPairs.length === 0) return closetData;
    return {
      items: closetData.items.map((item) => {
        const relatedNgs = wifeNgPairs.filter((pair) =>
          item.category === 'shirt' ? pair.shirtId === item.id : pair.pantsId === item.id
        );
        if (relatedNgs.length === 0) return item;

        const additionalIds = relatedNgs.map((pair) =>
          item.category === 'shirt' ? pair.pantsId : pair.shirtId
        );
        const additionalSet = new Set(additionalIds);
        const mergedNgIds = Array.from(new Set([...item.ngIds, ...additionalIds]));
        const filteredOfficeRecommendIds = item.officeRecommendIds.filter(
          (id) => !additionalSet.has(id)
        );
        const filteredRemoteRecommendIds = item.remoteRecommendIds.filter(
          (id) => !additionalSet.has(id)
        );
        const hasNoNgText = item.ngReason.startsWith('なし');
        const mergedReason = hasNoNgText
          ? `奥様NG指定（${additionalIds.join(', ')}）`
          : item.ngReason.includes('奥様NG')
          ? item.ngReason
          : `${item.ngReason} / 奥様NG指定（${additionalIds.join(', ')}）`;

        return {
          ...item,
          officeRecommendIds: filteredOfficeRecommendIds,
          remoteRecommendIds: filteredRemoteRecommendIds,
          ngIds: mergedNgIds,
          ngReason: mergedReason,
        };
      }),
    };
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
      const wifeNg = wifeNgPairs.find(
        (p) => p.shirtId === shirtId && p.pantsId === pantsId
      );
      if (wifeNg) {
        return { isNg: true, reason: wifeNg.reason || '奥様NG指定', isWifeNg: true };
      }

      const shirt = itemMap.get(shirtId);
      if (shirt && shirt.ngIds.includes(pantsId)) {
        return { isNg: true, reason: shirt.ngReason || '相性NG', isWifeNg: false };
      }

      const p = itemMap.get(pantsId);
      if (p && p.ngIds.includes(shirtId)) {
        return { isNg: true, reason: p.ngReason || '相性NG', isWifeNg: false };
      }

      return { isNg: false, reason: '', isWifeNg: false };
    },
    [itemMap, wifeNgPairs]
  );

  const getAffinityReason = useCallback(
    (shirt: ClosetItem, pantsItem: ClosetItem, scene: SceneMode): string => {
      if (scene === 'office') {
        if (shirt.id === 'S2' || shirt.id === 'S4' || shirt.id === 'S7') {
          return `${pantsItem.name} の質感を清潔な白シャツが最大限に引き立てる王道オフィススタイル。`;
        }
        if (pantsItem.id === 'P8') {
          return `濃紺スラックスの端正なシルエットが、${shirt.name} を上品に引き締めます。`;
        }
        if (pantsItem.id === 'P9') {
          return `ミディアムグレーの万能性が発揮され、誠実さとこなれ感を両立する組み合わせ。`;
        }
        if (pantsItem.id === 'P3') {
          return `グレージュの柔らかなトーンが寒色シャツと美しく調和し、好印象を与えます。`;
        }
        return `ドレス度 ${((shirt.dressScore + pantsItem.dressScore) / 2).toFixed(1)}。出社・対面業務に最適な清潔感ある配色です。`;
      } else {
        if (pantsItem.comfortScore >= 4.5) {
          return `快適度 ${pantsItem.comfortScore.toFixed(1)}。長時間のデスクワークやリモートでもストレスフリーです。`;
        }
        return `リラックス感と画面越しの清潔感を両立できるスマートカジュアル。`;
      }
    },
    []
  );

  const getRecommendationsForShirt = useCallback(
    (shirtId: string, scene: SceneMode) => {
      const shirt = itemMap.get(shirtId);
      if (!shirt) {
        return { recommended: [], otherOk: [], ngList: [] };
      }

      const recommended: RecommendationResult[] = [];
      const otherOk: RecommendationResult[] = [];
      const ngList: { pants: ClosetItem; reason: string; isWifeNg: boolean }[] = [];

      pants.forEach((p) => {
        const ngCheck = isNgPair(shirt.id, p.id);
        if (ngCheck.isNg) {
          ngList.push({
            pants: p,
            reason: ngCheck.reason,
            isWifeNg: ngCheck.isWifeNg,
          });
          return;
        }

        if (scene === 'office' && p.dressScore < 3.0) {
          ngList.push({
            pants: p,
            reason: `オフィス出社不適合（ドレス度 ${p.dressScore}：スウェット・ジョガー系）`,
            isWifeNg: false,
          });
          return;
        }

        const isYesterdayWorn = yesterdayWornPantsIds.has(p.id);
        const isOfficeRec = shirt.officeRecommendIds.includes(p.id);
        const isRemoteRec = shirt.remoteRecommendIds.includes(p.id);
        const isPrimaryRec = scene === 'office' ? isOfficeRec : isRemoteRec;
        const isSecondaryRec =
          scene === 'office'
            ? p.officeRecommendIds.includes(shirt.id)
            : p.remoteRecommendIds.includes(shirt.id);

        const score =
          scene === 'office'
            ? (p.dressScore * 1.5 + p.comfortScore) * (isPrimaryRec ? 1.5 : isSecondaryRec ? 1.2 : 1.0)
            : (p.comfortScore * 1.5 + p.dressScore) * (isPrimaryRec ? 1.5 : isSecondaryRec ? 1.2 : 1.0);

        const reason = getAffinityReason(shirt, p, scene);

        const result: RecommendationResult = {
          pants: p,
          rank: 0,
          isYesterdayWorn,
          score,
          affinityReason: reason,
          dressScore: p.dressScore,
          comfortScore: p.comfortScore,
          isOfficeRecommend: isOfficeRec,
          isRemoteRecommend: isRemoteRec,
        };

        if (isPrimaryRec || isSecondaryRec) {
          recommended.push(result);
        } else {
          otherOk.push(result);
        }
      });

      const sortFn = (a: RecommendationResult, b: RecommendationResult) => {
        if (a.isYesterdayWorn !== b.isYesterdayWorn) {
          return a.isYesterdayWorn ? 1 : -1;
        }
        return b.score - a.score;
      };

      recommended.sort(sortFn);
      otherOk.sort(sortFn);

      recommended.forEach((rec, idx) => {
        rec.rank = idx + 1;
      });

      return {
        recommended,
        otherOk,
        ngList,
      };
    },
    [itemMap, pants, isNgPair, yesterdayWornPantsIds, getAffinityReason]
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
    };

    const payload: GasSyncPayload = {
      action: 'push',
      token: secretToken || undefined,
      wearHistory: stateRef.current.wearHistory,
      wifeNgPairs: stateRef.current.wifeNgPairs,
      customClosetData: hasCustomData ? stateRef.current.closetData : undefined,
      clearCustomClosetData: sentTombstones.clearCustomClosetData,
      deletedWearMap: sentTombstones.deletedWearMap,
      deletedWearIds: Object.keys(sentTombstones.deletedWearMap || {}),
      wearHistoryClearedAt: sentTombstones.wearHistoryClearedAt,
      deletedWifeNgMap: sentTombstones.deletedWifeNgMap,
      deletedWifeNgKeys: Object.keys(sentTombstones.deletedWifeNgMap || {}),
      itemNamesMap,
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
      setGasConfig((prev) => ({ ...prev, lastSyncedAt: syncedAt }));

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
      setGasConfig((prev) => ({ ...prev, lastSyncedAt: syncedAt }));

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

  // Initial sync on app start and reconnect listener (with strict autoSync check)
  useEffect(() => {
    if (!gasConfig.webAppUrl) {
      setSyncStatus('unconfigured');
      return;
    }

    if (gasConfig.autoSync) {
      const isDirty = localStorage.getItem(STORAGE_KEYS.SYNC_DIRTY) === 'true';
      if (isDirty) {
        pushToGas();
      } else {
        pullFromGas();
      }
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

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [gasConfig.webAppUrl, gasConfig.autoSync, pushToGas, pullFromGas]);

  // Actions
  const recordWear = useCallback(
    (shirtId: string, pantsId: string, scene: SceneMode, dateStr: string = getTodayString()) => {
      mutationSeqRef.current++;
      const now = Date.now();
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
      const now = Date.now();
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
    const now = Date.now();
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
      const exists = stateRef.current.wifeNgPairs.some((p) => p.shirtId === shirtId && p.pantsId === pantsId);
      if (!exists) {
        const updatedWifeNg: WifeNgPair[] = [
          {
            shirtId,
            pantsId,
            reason: customReason,
            createdAt: new Date().toISOString(),
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
      const now = Date.now();
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
    (jsonString: string): { success: boolean; error?: string } => {
      try {
        const parsed = JSON.parse(jsonString);
        if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
          return { success: false, error: 'JSONには有効な "items" 配列が必要です。' };
        }
        mutationSeqRef.current++;
        customDataSeqRef.current++;
        localStorage.setItem(STORAGE_KEYS.CUSTOM_DATA, jsonString);
        stateRef.current.closetData = parsed;
        const updatedTombstones: SyncTombstones = {
          ...stateRef.current.tombstones,
          clearCustomClosetData: false,
        };
        stateRef.current.tombstones = updatedTombstones;
        setClosetData(parsed);
        setTombstones(updatedTombstones);
        triggerBackgroundPush();
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e.message || 'JSONの解析に失敗しました。' };
      }
    },
    [triggerBackgroundPush]
  );

  const resetToDefaultData = useCallback(() => {
    mutationSeqRef.current++;
    customDataSeqRef.current++;
    localStorage.removeItem(STORAGE_KEYS.CUSTOM_DATA);
    stateRef.current.closetData = defaultClosetData as ClosetData;
    const updatedTombstones: SyncTombstones = {
      ...stateRef.current.tombstones,
      clearCustomClosetData: true,
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

  const contextValue: ClosetStoreContextType = {
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
  };

  return <ClosetContext.Provider value={contextValue}>{children}</ClosetContext.Provider>;
};

export function useClosetStore(): ClosetStoreContextType {
  const context = useContext(ClosetContext);
  if (!context) {
    throw new Error('useClosetStore must be used within a ClosetProvider');
  }
  return context;
}
