/**
 * Smart Closet - IndexedDB 画像ストレージユーティリティ
 * 
 * Google ドライブから同期された服の写真を端末内 (IndexedDB) に Blob バイナリとして永続保存し、
 * 0ms・完全オフラインでの写真表示と安全弁付き Prune（削除伝播）を実現します。
 */

const DB_NAME = 'smart_closet_image_db';
const DB_VERSION = 1;
const STORE_IMAGES = 'images';
const STORE_META = 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * IndexedDB インスタンスの初期化と取得
 */
function getDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('IndexedDB is not supported in this environment'));
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_IMAGES)) {
          db.createObjectStore(STORE_IMAGES);
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }

  return dbPromise;
}

/**
 * 端末ストレージの永続化リクエスト (仕様9)
 * ブラウザの容量逼迫による自動 Eviction を防止します。
 */
export async function initStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      const isPersisted = await navigator.storage.persist();
      console.log(`[imageStore] Storage persistence status: ${isPersisted ? 'PERSISTENT' : 'BEST-EFFORT'}`);
      return isPersisted;
    }
  } catch (err) {
    console.warn('[imageStore] Failed to request storage persistence:', err);
  }
  return false;
}

/**
 * 指定アイテムの画像 Blob を取得
 */
export async function getImageBlob(id: string): Promise<Blob | null> {
  const normId = id.toUpperCase();
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readonly');
    const store = tx.objectStore(STORE_IMAGES);
    const request = store.get(normId);

    request.onsuccess = () => resolve((request.result as Blob) || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 単一アイテムの画像 Blob とタイムスタンプを保存
 */
export async function saveImageBlob(id: string, blob: Blob, timestamp: number): Promise<void> {
  const normId = id.toUpperCase();
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_IMAGES, STORE_META], 'readwrite');
    tx.objectStore(STORE_IMAGES).put(blob, normId);
    tx.objectStore(STORE_META).put(timestamp, normId);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 複数アイテムの画像 Blob とタイムスタンプを一括保存
 */
export async function saveImageBlobs(
  blobsMap: Record<string, Blob>,
  timestamps: Record<string, number>
): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_IMAGES, STORE_META], 'readwrite');
    const imgStore = tx.objectStore(STORE_IMAGES);
    const metaStore = tx.objectStore(STORE_META);

    for (const [id, blob] of Object.entries(blobsMap)) {
      const normId = id.toUpperCase();
      imgStore.put(blob, normId);
      if (timestamps[id] !== undefined) {
        metaStore.put(timestamps[id], normId);
      }
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 保存済み画像の全キー一覧を取得
 */
export async function getAllImageKeys(): Promise<string[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readonly');
    const store = tx.objectStore(STORE_IMAGES);
    const request = store.getAllKeys();

    request.onsuccess = () => resolve((request.result as string[]) || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 保存済み画像のメタデータ（ID と最終更新日時マップ）を取得
 */
export async function getLocalImageMeta(): Promise<Record<string, number>> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const store = tx.objectStore(STORE_META);
    const metaMap: Record<string, number> = {};

    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        metaMap[cursor.key as string] = cursor.value as number;
        cursor.continue();
      } else {
        resolve(metaMap);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export interface PruneResult {
  prunedIds: string[];
  skipped: boolean;
  reason?: 'empty_valid_ids' | 'rapid_decrease';
}

/**
 * 安全弁付き Prune（削除伝播）処理 (仕様7)
 * ドライブ側で削除された画像を端末からも消去します。
 * 
 * @param validIds ドライブ上に現存する有効アイテムID一覧
 * @param force 警告ダイアログ等でユーザーが明示的に全削除を承認した場合に true
 */
export async function pruneImages(validIds: string[], force = false): Promise<PruneResult> {
  const normValidIds = new Set(validIds.map((id) => id.toUpperCase()));
  const localKeys = await getAllImageKeys();

  // 安全弁 1: ドライブ側が空配列の場合 (全削除ガード)
  if (normValidIds.size === 0 && localKeys.length > 0 && !force) {
    console.warn('[imageStore] Prune skipped: validItemIds is empty (safety guard triggered)');
    return { prunedIds: [], skipped: true, reason: 'empty_valid_ids' };
  }

  // 安全弁 2: 保持件数が10枚以上で50%以上激減している場合 (誤削除・誤設定ガード)
  if (localKeys.length >= 10 && normValidIds.size < localKeys.length * 0.5 && !force) {
    console.warn(
      `[imageStore] Prune skipped: rapid decrease detected (local: ${localKeys.length}, drive: ${normValidIds.size})`
    );
    return { prunedIds: [], skipped: true, reason: 'rapid_decrease' };
  }

  const idsToPrune = localKeys.filter((id) => !normValidIds.has(id));
  if (idsToPrune.length === 0) {
    return { prunedIds: [], skipped: false };
  }

  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_IMAGES, STORE_META], 'readwrite');
    const imgStore = tx.objectStore(STORE_IMAGES);
    const metaStore = tx.objectStore(STORE_META);

    for (const id of idsToPrune) {
      imgStore.delete(id);
      metaStore.delete(id);
    }

    tx.oncomplete = () => {
      console.log(`[imageStore] Pruned ${idsToPrune.length} orphaned images:`, idsToPrune);
      resolve({ prunedIds: idsToPrune, skipped: false });
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 端末の画像キャッシュとメタデータを全消去 (仕様7)
 */
export async function clearAllImages(): Promise<void> {
  clearSyncedFolderId();
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_IMAGES, STORE_META], 'readwrite');
    tx.objectStore(STORE_IMAGES).clear();
    tx.objectStore(STORE_META).clear();

    tx.oncomplete = () => {
      console.log('[imageStore] Cleared all local cached images and meta');
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

const STORAGE_KEY_SYNC_FOLDER_ID = 'smart_closet_image_sync_folder_id';

/**
 * 最後に写真同期を完了した Google ドライブのフォルダ ID を取得 (指摘1)
 */
export function getSyncedFolderId(): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem(STORAGE_KEY_SYNC_FOLDER_ID);
    }
  } catch (e) {
    console.warn('[imageStore] Failed to get syncedFolderId:', e);
  }
  return null;
}

/**
 * 写真同期完了時に同期元フォルダ ID を端末に保存 (指摘1)
 */
export function setSyncedFolderId(folderId: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(STORAGE_KEY_SYNC_FOLDER_ID, folderId.trim());
    }
  } catch (e) {
    console.warn('[imageStore] Failed to set syncedFolderId:', e);
  }
}

/**
 * 同期元フォルダ ID の記録をクリア (指摘1)
 */
export function clearSyncedFolderId(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(STORAGE_KEY_SYNC_FOLDER_ID);
    }
  } catch (e) {
    console.warn('[imageStore] Failed to clear syncedFolderId:', e);
  }
}

/**
 * 単一アイテムの画像 Blob とメタデータを本保存ストアから削除
 */
export async function deleteImageBlob(id: string): Promise<void> {
  const normId = id.toUpperCase();
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_IMAGES, STORE_META], 'readwrite');
    tx.objectStore(STORE_IMAGES).delete(normId);
    tx.objectStore(STORE_META).delete(normId);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Base64 Data URL を Blob に変換するヘルパー (仕様5)
 */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}

// ----------------------------------------------------
// 専用「下書き枠」画像ストア (条件1: 1枠のみ・リロード耐性・pruneImages非干渉)
// ----------------------------------------------------

const DRAFT_DB_NAME = 'smart_closet_draft_db';
const DRAFT_DB_VERSION = 1;
const STORE_DRAFT = 'draft';
const DRAFT_KEY = 'CURRENT_DRAFT';

let draftDbPromise: Promise<IDBDatabase> | null = null;

function getDraftDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('IndexedDB is not supported in this environment'));
  }

  if (!draftDbPromise) {
    draftDbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DRAFT_DB_NAME, DRAFT_DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_DRAFT)) {
          db.createObjectStore(STORE_DRAFT);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        draftDbPromise = null;
        reject(request.error);
      };
    });
  }

  return draftDbPromise;
}

export interface DraftImageData {
  blob: Blob;
  dataUrl: string;
  updatedAt: number;
}

/**
 * 服追加の下書き写真を保存 (条件1: 常に1枠のみを上書き)
 */
export async function saveDraftImage(blob: Blob, dataUrl: string): Promise<void> {
  const db = await getDraftDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DRAFT, 'readwrite');
    const store = tx.objectStore(STORE_DRAFT);
    const data: DraftImageData = { blob, dataUrl, updatedAt: Date.now() };
    store.put(data, DRAFT_KEY);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 服追加の下書き写真を取得 (条件1: 画面再入場・リロード時の自動復元用)
 */
export async function getDraftImage(): Promise<DraftImageData | null> {
  const db = await getDraftDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DRAFT, 'readonly');
    const store = tx.objectStore(STORE_DRAFT);
    const request = store.get(DRAFT_KEY);

    request.onsuccess = () => resolve((request.result as DraftImageData) || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 服追加の下書き写真を消去 (条件1: 取り込み成功時または明示的な破棄時に呼び出し)
 */
export async function clearDraftImage(): Promise<void> {
  const db = await getDraftDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DRAFT, 'readwrite');
    const store = tx.objectStore(STORE_DRAFT);
    store.delete(DRAFT_KEY);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
