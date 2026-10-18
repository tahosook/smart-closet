import {
  ClosetData,
  GasSyncResponse,
  SyncTombstones,
  WearRecord,
  WifeNgPair,
} from '../types/closet';

/**
 * 送信済み Tombstones のタイムスタンプと比較し、通信完了後に残すべき未送信 Tombstones のみを抽出する
 */
export function pruneCompletedTombstones(
  current: SyncTombstones,
  sent: SyncTombstones,
  hasInFlightCustomDataChange = false
): SyncTombstones {
  const nextDeletedWearMap: Record<string, number> = {};
  for (const [id, currentTs] of Object.entries(current.deletedWearMap || {})) {
    const sentTs = sent.deletedWearMap ? sent.deletedWearMap[id] : undefined;
    // 送信対象に含まれていなかったか、送信開始後にさらに新しいタイムスタンプで更新された場合は保持
    if (sentTs === undefined || currentTs > sentTs) {
      nextDeletedWearMap[id] = currentTs;
    }
  }

  const nextDeletedWifeNgMap: Record<string, number> = {};
  for (const [key, currentTs] of Object.entries(current.deletedWifeNgMap || {})) {
    const sentTs = sent.deletedWifeNgMap ? sent.deletedWifeNgMap[key] : undefined;
    if (sentTs === undefined || currentTs > sentTs) {
      nextDeletedWifeNgMap[key] = currentTs;
    }
  }

  let nextWearHistoryClearedAt: number | undefined = undefined;
  if (current.wearHistoryClearedAt !== undefined) {
    if (
      sent.wearHistoryClearedAt === undefined ||
      current.wearHistoryClearedAt > sent.wearHistoryClearedAt
    ) {
      nextWearHistoryClearedAt = current.wearHistoryClearedAt;
    }
  }

  let nextCustomClosetDataClearedAt: number | undefined = undefined;
  if (current.clearCustomClosetData || current.customClosetDataClearedAt !== undefined) {
    const currentTs = current.customClosetDataClearedAt;
    const sentTs = sent.customClosetDataClearedAt;
    if (
      hasInFlightCustomDataChange ||
      !sent.clearCustomClosetData ||
      (currentTs !== undefined && (sentTs === undefined || currentTs > sentTs))
    ) {
      nextCustomClosetDataClearedAt = currentTs ?? (current.customClosetDataClearedAt || Date.now());
    }
  }
  const nextClearCustomClosetData =
    nextCustomClosetDataClearedAt !== undefined ? true : undefined;

  return {
    deletedWearMap: nextDeletedWearMap,
    deletedWearIds: Object.keys(nextDeletedWearMap),
    wearHistoryClearedAt: nextWearHistoryClearedAt,
    deletedWifeNgMap: nextDeletedWifeNgMap,
    deletedWifeNgKeys: Object.keys(nextDeletedWifeNgMap),
    clearCustomClosetData: nextClearCustomClosetData,
    customClosetDataClearedAt: nextCustomClosetDataClearedAt,
  };
}

/**
 * 未送信の Tombstone が存在するか判定
 */
export function hasRemainingTombstones(tombstones: SyncTombstones): boolean {
  if (tombstones.deletedWearMap && Object.keys(tombstones.deletedWearMap).length > 0) return true;
  if (tombstones.deletedWifeNgMap && Object.keys(tombstones.deletedWifeNgMap).length > 0) return true;
  if (tombstones.wearHistoryClearedAt !== undefined) return true;
  if (Boolean(tombstones.clearCustomClosetData) || tombstones.customClosetDataClearedAt !== undefined) return true;
  return false;
}

export interface ReconcileParams {
  serverResponse: GasSyncResponse;
  currentLocal: {
    wearHistory: WearRecord[];
    wifeNgPairs: WifeNgPair[];
    closetData: ClosetData;
    hasCustomData: boolean;
    tombstones: SyncTombstones;
  };
  sentTombstones: SyncTombstones;
  hasInFlightMutations: boolean;
  hasInFlightCustomDataChange?: boolean;
  defaultClosetData: ClosetData;
}

export interface ReconcileResult {
  wearHistory: WearRecord[];
  wifeNgPairs: WifeNgPair[];
  closetData: ClosetData;
  isCustomDataPresent: boolean;
  remainingTombstones: SyncTombstones;
  stillDirty: boolean;
}

/**
 * サーバーレスポンスと現在のローカル状態（通信中に発生した変更・Tombstone）を調停する純粋関数
 */
export function reconcileSyncResponse({
  serverResponse,
  currentLocal,
  sentTombstones,
  hasInFlightMutations,
  hasInFlightCustomDataChange = false,
  defaultClosetData,
}: ReconcileParams): ReconcileResult {
  const remainingTombstones = pruneCompletedTombstones(
    currentLocal.tombstones,
    sentTombstones,
    hasInFlightCustomDataChange
  );
  const remainingTombstonesPresent = hasRemainingTombstones(remainingTombstones);

  // 通信中にローカル操作がなく、未送信 Tombstone も残っていない場合はサーバーレスポンスをそのまま採用
  if (!hasInFlightMutations && !remainingTombstonesPresent) {
    let closetData = currentLocal.closetData;
    let isCustomDataPresent = currentLocal.hasCustomData;

    if (serverResponse.customClosetData && Array.isArray(serverResponse.customClosetData.items)) {
      closetData = serverResponse.customClosetData;
      isCustomDataPresent = true;
    } else if (sentTombstones.clearCustomClosetData || sentTombstones.customClosetDataClearedAt !== undefined) {
      closetData = defaultClosetData;
      isCustomDataPresent = false;
    } else if (
      (serverResponse.customClosetData === null || !serverResponse.customClosetData) &&
      serverResponse.customClosetDataClearedAt !== undefined &&
      serverResponse.customClosetDataClearedAt >= (currentLocal.closetData.updatedAt || 0)
    ) {
      closetData = defaultClosetData;
      isCustomDataPresent = false;
    }

    return {
      wearHistory: Array.isArray(serverResponse.wearHistory)
        ? serverResponse.wearHistory
        : currentLocal.wearHistory,
      wifeNgPairs: Array.isArray(serverResponse.wifeNgPairs)
        ? serverResponse.wifeNgPairs
        : currentLocal.wifeNgPairs,
      closetData,
      isCustomDataPresent,
      remainingTombstones: { deletedWearMap: {}, deletedWifeNgMap: {} },
      stillDirty: false,
    };
  }

  // 通信中に変更または未送信 Tombstone がある場合:
  const serverTombstones = serverResponse.tombstones;

  // 1. WearHistory の調停 (LWW + Tombstone フィルタ)
  const isWearRecordValid = (rec: WearRecord): boolean => {
    if (!rec || !rec.date) return false;
    const ts = rec.timestamp || 0;
    if (
      remainingTombstones.wearHistoryClearedAt !== undefined &&
      ts <= remainingTombstones.wearHistoryClearedAt
    ) {
      return false;
    }
    if (
      serverTombstones &&
      serverTombstones.wearHistoryClearedAt !== undefined &&
      ts <= serverTombstones.wearHistoryClearedAt
    ) {
      return false;
    }
    if (
      remainingTombstones.deletedWearMap &&
      remainingTombstones.deletedWearMap[rec.id] !== undefined &&
      ts <= remainingTombstones.deletedWearMap[rec.id]
    ) {
      return false;
    }
    if (
      serverTombstones &&
      serverTombstones.deletedWearMap &&
      serverTombstones.deletedWearMap[rec.id] !== undefined &&
      ts <= serverTombstones.deletedWearMap[rec.id]
    ) {
      return false;
    }
    return true;
  };

  const rawWearList: WearRecord[] = [
    ...(Array.isArray(serverResponse.wearHistory) ? serverResponse.wearHistory : []),
    ...currentLocal.wearHistory,
  ];

  const dateMap = new Map<string, WearRecord>();
  for (const rec of rawWearList) {
    if (!isWearRecordValid(rec)) continue;
    const existing = dateMap.get(rec.date);
    if (!existing || (rec.timestamp || 0) > (existing.timestamp || 0)) {
      dateMap.set(rec.date, rec);
    }
  }

  const mergedWearHistory = Array.from(dateMap.values()).sort((a, b) =>
    b.date.localeCompare(a.date)
  );

  // 2. WifeNgPairs の調停 (LWW + Tombstone フィルタ)
  const isWifeNgValid = (pair: WifeNgPair): boolean => {
    if (!pair || !pair.shirtId || !pair.pantsId) return false;
    const key = `${pair.shirtId}_${pair.pantsId}`;
    const createdTs = pair.createdAt ? new Date(pair.createdAt).getTime() : 0;
    if (
      remainingTombstones.deletedWifeNgMap &&
      remainingTombstones.deletedWifeNgMap[key] !== undefined &&
      createdTs <= remainingTombstones.deletedWifeNgMap[key]
    ) {
      return false;
    }
    if (
      serverTombstones &&
      serverTombstones.deletedWifeNgMap &&
      serverTombstones.deletedWifeNgMap[key] !== undefined &&
      createdTs <= serverTombstones.deletedWifeNgMap[key]
    ) {
      return false;
    }
    return true;
  };

  const rawWifeNgList: WifeNgPair[] = [
    ...(Array.isArray(serverResponse.wifeNgPairs) ? serverResponse.wifeNgPairs : []),
    ...currentLocal.wifeNgPairs,
  ];

  const ngMap = new Map<string, WifeNgPair>();
  for (const pair of rawWifeNgList) {
    if (!isWifeNgValid(pair)) continue;
    const key = `${pair.shirtId}_${pair.pantsId}`;
    const existing = ngMap.get(key);
    const pairTs = pair.createdAt ? new Date(pair.createdAt).getTime() : 0;
    const existingTs = existing && existing.createdAt ? new Date(existing.createdAt).getTime() : 0;
    if (!existing || pairTs >= existingTs) {
      ngMap.set(key, pair);
    }
  }

  const mergedWifeNgPairs = Array.from(ngMap.values()).sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || '')
  );

  // 3. ClosetData の調停 (LWW セマンティクス)
  let closetData = currentLocal.closetData;
  let isCustomDataPresent = currentLocal.hasCustomData;

  const serverCustom =
    serverResponse.customClosetData && Array.isArray(serverResponse.customClosetData.items)
      ? serverResponse.customClosetData
      : null;
  const serverUpd = serverCustom ? Number(serverCustom.updatedAt || 0) : 0;
  const serverDel = Number(serverResponse.customClosetDataClearedAt || 0);

  const localCustom = currentLocal.hasCustomData ? currentLocal.closetData : null;
  const localUpd = localCustom ? Number(localCustom.updatedAt || 0) : 0;
  const localDel = Number(remainingTombstones.customClosetDataClearedAt || 0);
  const isLocalDeletionRequested = Boolean(
    remainingTombstones.clearCustomClosetData || remainingTombstones.customClosetDataClearedAt !== undefined
  );

  if (hasInFlightCustomDataChange) {
    // 通信中にローカルでカスタムデータ操作があった場合はローカルを最優先
    closetData = currentLocal.closetData;
    isCustomDataPresent = currentLocal.hasCustomData;
  } else if (serverCustom && serverUpd >= localDel && serverUpd >= localUpd) {
    // サーバーのカスタムデータがローカルの削除・データより新しい場合はサーバーを採用
    closetData = serverCustom;
    isCustomDataPresent = true;
    if (remainingTombstones.customClosetDataClearedAt !== undefined && serverUpd > localDel) {
      delete remainingTombstones.customClosetDataClearedAt;
      delete remainingTombstones.clearCustomClosetData;
    }
  } else if (
    localCustom &&
    localUpd > serverUpd &&
    localUpd > serverDel &&
    (!isLocalDeletionRequested || localUpd > localDel)
  ) {
    // ローカルのカスタムデータがサーバーより新しい場合はローカルを保持
    closetData = localCustom;
    isCustomDataPresent = true;
  } else if (isLocalDeletionRequested && localDel >= serverUpd) {
    // ローカルの削除指示がサーバーデータより新しい場合は削除を採用
    closetData = defaultClosetData;
    isCustomDataPresent = false;
  } else if (
    !serverCustom &&
    (serverDel >= localUpd ||
      sentTombstones.clearCustomClosetData ||
      sentTombstones.customClosetDataClearedAt !== undefined)
  ) {
    // サーバー側で削除されている場合
    closetData = defaultClosetData;
    isCustomDataPresent = false;
  }

  return {
    wearHistory: mergedWearHistory,
    wifeNgPairs: mergedWifeNgPairs,
    closetData,
    isCustomDataPresent,
    remainingTombstones,
    stillDirty: true,
  };
}
