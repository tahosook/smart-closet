import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ClosetData,
  ClosetItem,
  SceneMode,
  WearRecord,
  WifeNgPair,
  RecommendationResult,
} from '../types/closet';
import defaultClosetData from '../data/closet.json';

const STORAGE_KEYS = {
  CUSTOM_DATA: 'smart_closet_custom_data',
  WEAR_HISTORY: 'smart_closet_wear_history',
  WIFE_NG: 'smart_closet_wife_ng',
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

export function useClosetStore() {
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

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.WEAR_HISTORY, JSON.stringify(wearHistory));
  }, [wearHistory]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.WIFE_NG, JSON.stringify(wifeNgPairs));
  }, [wifeNgPairs]);

  // Generate merged ClosetData incorporating wifeNgPairs from localStorage
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

  // Separate shirts and pants
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

  // Today and Yesterday records
  const todayStr = getTodayString();
  const yesterdayStr = getYesterdayString();

  const todayRecord = useMemo(
    () => wearHistory.find((r) => r.date === todayStr),
    [wearHistory, todayStr]
  );

  // Determine which pants were worn yesterday (or on most recent day before today)
  const yesterdayWornPantsIds = useMemo(() => {
    const ids = new Set<string>();
    // Check exact yesterday
    wearHistory
      .filter((r) => r.date === yesterdayStr)
      .forEach((r) => ids.add(r.pantsId));

    // Also check the most recent record before today if yesterday had no record
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

  // Check if a shirt and pants pair is NG
  const isNgPair = useCallback(
    (shirtId: string, pantsId: string): { isNg: boolean; reason: string; isWifeNg: boolean } => {
      // 1. Check Wife NG overrides
      const wifeNg = wifeNgPairs.find(
        (p) => p.shirtId === shirtId && p.pantsId === pantsId
      );
      if (wifeNg) {
        return { isNg: true, reason: wifeNg.reason || '奥様NG指定', isWifeNg: true };
      }

      // 2. Check shirt's ngIds
      const shirt = itemMap.get(shirtId);
      if (shirt && shirt.ngIds.includes(pantsId)) {
        return { isNg: true, reason: shirt.ngReason || '相性NG', isWifeNg: false };
      }

      // 3. Check pants' ngIds
      const p = itemMap.get(pantsId);
      if (p && p.ngIds.includes(shirtId)) {
        return { isNg: true, reason: p.ngReason || '相性NG', isWifeNg: false };
      }

      return { isNg: false, reason: '', isWifeNg: false };
    },
    [itemMap, wifeNgPairs]
  );

  // Generate affinity reason text
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

  // Get recommendations and NG items for a shirt
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

        // Office TPO rule: Exclude sweatpants/joggers (dressScore < 3.0) from office candidates
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

        // Score weighting
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

      // Sort with Cooling period penalty:
      // Yesterday worn items go to the bottom of the list
      const sortFn = (a: RecommendationResult, b: RecommendationResult) => {
        if (a.isYesterdayWorn !== b.isYesterdayWorn) {
          return a.isYesterdayWorn ? 1 : -1; // non-yesterday worn comes first
        }
        return b.score - a.score;
      };

      recommended.sort(sortFn);
      otherOk.sort(sortFn);

      // Assign ranks to the top recommendations
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

  // Actions
  const recordWear = useCallback(
    (shirtId: string, pantsId: string, scene: SceneMode, dateStr: string = getTodayString()) => {
      setWearHistory((prev) => {
        const filtered = prev.filter((r) => r.date !== dateStr);
        const newRecord: WearRecord = {
          id: `${dateStr}_${Date.now()}`,
          date: dateStr,
          shirtId,
          pantsId,
          scene,
          timestamp: Date.now(),
        };
        return [newRecord, ...filtered].sort((a, b) => b.date.localeCompare(a.date));
      });
    },
    []
  );

  const simulateYesterdayWear = useCallback(
    (pantsId: string) => {
      const yDate = getYesterdayString();
      recordWear('S2', pantsId, 'office', yDate);
    },
    [recordWear]
  );

  const removeWearRecord = useCallback((id: string) => {
    setWearHistory((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const clearAllWearHistory = useCallback(() => {
    setWearHistory([]);
  }, []);

  const registerWifeNg = useCallback(
    (shirtId: string, pantsId: string, customReason = '🚨 奥様からNG指定') => {
      setWifeNgPairs((prev) => {
        const exists = prev.some((p) => p.shirtId === shirtId && p.pantsId === pantsId);
        if (exists) return prev;
        return [
          {
            shirtId,
            pantsId,
            reason: customReason,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ];
      });
    },
    []
  );

  const removeWifeNg = useCallback((shirtId: string, pantsId: string) => {
    setWifeNgPairs((prev) =>
      prev.filter((p) => !(p.shirtId === shirtId && p.pantsId === pantsId))
    );
  }, []);

  const importCustomData = useCallback((jsonString: string): { success: boolean; error?: string } => {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
        return { success: false, error: 'JSONには有効な "items" 配列が必要です。' };
      }
      localStorage.setItem(STORAGE_KEYS.CUSTOM_DATA, jsonString);
      setClosetData(parsed);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'JSONの解析に失敗しました。' };
    }
  }, []);

  const resetToDefaultData = useCallback(() => {
    localStorage.removeItem(STORAGE_KEYS.CUSTOM_DATA);
    setClosetData(defaultClosetData as ClosetData);
  }, []);

  return {
    closetData,
    mergedClosetData,
    shirts,
    pants,
    itemMap,
    wearHistory,
    todayRecord,
    yesterdayWornPantsIds,
    wifeNgPairs,
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
  };
}
