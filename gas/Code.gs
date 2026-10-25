/**
 * Smart Closet - Google Apps Script バックエンド
 * 
 * 【初期セットアップ方法】
 * 1. Google スプレッドシートを新規作成します。
 * 2. メニュー「拡張機能」>「Apps Script」を開きます。
 * 3. このコードをエディタに貼り付けて保存（Ctrl+S / Cmd+S）します。
 * 4. 関数選択ドロップダウンで「setupSpreadsheet」を選択し、「実行」をクリックします（初回承認が必要）。
 * 5. 右上「デプロイ」>「新しいデプロイ」を開きます。
 *    - 種類の選択:「ウェブアプリ」
 *    - 次のユーザーとして実行:「自分」
 *    - アクセスできるユーザー:「全員」
 * 6. 発行された「ウェブアプリ URL」をコピーし、Smart Closet アプリのクラウド設定に貼り付けます。
 */

// アプリからコピーする際に、ユーザー固有のシークレットトークンに自動置換されます
const DEFAULT_SECRET_TOKEN = '__SMART_CLOSET_SECRET_TOKEN__';

const SHEET_NAMES = {
  WEAR_HISTORY: 'wear_history',
  WIFE_NG: 'wife_ng',
  ANALYTICS: 'analytics',
  META_CONFIG: 'meta_config'
};

/**
 * 初回・再設定用: 必要なシートとヘッダー書式を冪等に構築（既存データは消去しません）
 */
function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. wear_history シート
  const wearHeaders = ['ID', '日付', 'シーン', 'シャツID', 'シャツ名', 'パンツID', 'パンツ名', 'タイムスタンプ'];
  ensureSheetWithHeaders(ss, SHEET_NAMES.WEAR_HISTORY, wearHeaders, '#1e293b', '#f8fafc');

  // 2. wife_ng シート
  const ngHeaders = ['シャツID', 'シャツ名', 'パンツID', 'パンツ名', 'NG理由', '登録日時'];
  ensureSheetWithHeaders(ss, SHEET_NAMES.WIFE_NG, ngHeaders, '#881337', '#ffe4e6');

  // 3. analytics (断捨離・稼働率分析) シート
  const analyticsHeaders = ['アイテムID', 'カテゴリ', 'アイテム名', '累計着用回数', '直近30日着用回数', '最終着用日', '稼働ステータス'];
  ensureSheetWithHeaders(ss, SHEET_NAMES.ANALYTICS, analyticsHeaders, '#0f172a', '#38bdf8');

  // 4. meta_config シート
  const metaHeaders = ['キー', '値', '最終更新日時'];
  ensureSheetWithHeaders(ss, SHEET_NAMES.META_CONFIG, metaHeaders, '#334155', '#f1f5f9');

  // 初期シークレットトークンの登録（未登録かつプレースホルダーでない場合）
  if (DEFAULT_SECRET_TOKEN && DEFAULT_SECRET_TOKEN !== '__SMART_CLOSET_SECRET_TOKEN__') {
    const existingToken = readConfigValue(ss, 'secretToken');
    if (!existingToken) {
      writeConfigValue(ss, 'secretToken', DEFAULT_SECRET_TOKEN);
      Logger.log('🔑 シークレットトークンを meta_config に初期登録しました');
    }
  }

  // デフォルトの余分なシート1があれば削除（データがない場合のみ）
  const sheet1 = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (sheet1 && ss.getSheets().length > 1 && sheet1.getLastRow() <= 1) {
    try {
      ss.deleteSheet(sheet1);
    } catch (e) {
      // 無視
    }
  }

  Logger.log('✅ Smart Closet スプレッドシートのセットアップが完了しました（既存データは保護されています）');
}

/**
 * 危険: 全データを完全に消去して初期化したい場合のみ手動実行する関数
 */
function resetAllDataDangerously() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [SHEET_NAMES.WEAR_HISTORY, SHEET_NAMES.WIFE_NG, SHEET_NAMES.ANALYTICS, SHEET_NAMES.META_CONFIG].forEach(name => {
    const s = ss.getSheetByName(name);
    if (s) s.clear();
  });
  setupSpreadsheet();
  Logger.log('⚠️ 全シートのデータを消去して初期化しました');
}

/**
 * GET リクエストハンドラ (Pull: スプレッドシートから最新データを取得)
 */
function doGet(e) {
  const lock = LockService.getScriptLock();
  const hasLock = lock.tryLock(10000);
  if (!hasLock) {
    return createJsonResponse({
      ok: false,
      error: '他端末と同期処理中です。少し待ってから再試行してください'
    });
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const token = e && e.parameter ? e.parameter.token : null;
    
    // Fail-Closed 認証検証
    if (!validateToken(ss, token)) {
      return createJsonResponse({ ok: false, error: '認証エラー: トークンが無効または未設定です' });
    }

    const wearHistory = readWearHistory(ss);
    const wifeNgPairs = readWifeNg(ss);
    const customClosetData = readCustomData(ss);
    const tombstones = readTombstones(ss);
    const imageFolderId = readConfigValue(ss, 'imageFolderId') || '';
    const imagesLastUpdatedAt = getImagesLastUpdatedAt(imageFolderId);

    return createJsonResponse({
      ok: true,
      wearHistory: wearHistory,
      wifeNgPairs: wifeNgPairs,
      customClosetData: customClosetData,
      customClosetDataClearedAt: tombstones.customClosetDataClearedAt || undefined,
      tombstones: tombstones,
      imageFolderId: imageFolderId,
      imagesLastUpdatedAt: imagesLastUpdatedAt,
      syncedAt: new Date().toISOString()
    });
  } catch (err) {
    return createJsonResponse({ ok: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

/**
 * POST リクエストハンドラ (Push: 排他制御 ＋ サーバー永続Tombstoneによる双方向マージ)
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  // 同時リクエストの競合を防ぐため最大10秒間ロック取得を待機 (P2対応)
  const hasLock = lock.tryLock(10000);
  if (!hasLock) {
    return createJsonResponse({
      ok: false,
      error: '他端末と同期処理中です。少し待ってから再試行してください'
    });
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ ok: false, error: 'リクエストデータが空です' });
    }

    const payload = JSON.parse(e.postData.contents);
    const token = payload.token || null;

    // Fail-Closed 認証検証
    if (!validateToken(ss, token)) {
      return createJsonResponse({ ok: false, error: '認証エラー: トークンが無効または未設定です' });
    }

    // Google ドライブ画像同期アクションのルーティング (Phase 2)
    if (payload.action === 'getImageSyncPlan') {
      return handleGetImageSyncPlan(ss, payload);
    }
    if (payload.action === 'fetchImages') {
      return handleFetchImages(ss, payload);
    }
    if (payload.action === 'uploadImage') {
      return handleUploadImage(ss, payload);
    }

    const itemNamesMap = payload.itemNamesMap || {};

    // サーバー側に永続化されている Tombstone の読み取りとマージ (P1対応)
    const tombstones = readTombstones(ss);
    integrateIncomingTombstones(tombstones, payload);

    // 1. wearHistory の双方向マージ & Tombstone 削除（古い端末からの復活をブロック）
    const existingWearHistory = readWearHistory(ss);
    const mergedWearHistory = mergeWearHistory(
      existingWearHistory,
      Array.isArray(payload.wearHistory) ? payload.wearHistory : [],
      tombstones
    );
    writeWearHistory(ss, mergedWearHistory, itemNamesMap);

    // 2. wifeNgPairs の双方向マージ & Tombstone 削除（古い端末からの復活をブロック）
    const existingWifeNg = readWifeNg(ss);
    const mergedWifeNg = mergeWifeNg(
      existingWifeNg,
      Array.isArray(payload.wifeNgPairs) ? payload.wifeNgPairs : [],
      tombstones
    );
    writeWifeNg(ss, mergedWifeNg, itemNamesMap);

    // 3. customClosetData の保護更新 (LWW-Element-Set セマンティクス)
    const existingCustom = readCustomData(ss);
    const existingUpdatedAt = (existingCustom && Number(existingCustom.updatedAt)) || 0;
    const currentClearedAt = Number(tombstones.customClosetDataClearedAt || 0);

    const incomingClearedAt = Number(payload.customClosetDataClearedAt || 0);
    const isDeletionRequested =
      payload.clearCustomClosetData === true || incomingClearedAt > 0;

    const incomingCustom =
      payload.customClosetData && Array.isArray(payload.customClosetData.items)
        ? payload.customClosetData
        : null;
    const incomingUpdatedAt = incomingCustom
      ? Number(payload.customClosetDataUpdatedAt || incomingCustom.updatedAt || 0)
      : 0;

    if (isDeletionRequested && (!incomingCustom || incomingClearedAt >= incomingUpdatedAt)) {
      // タイムスタンプのない古い削除指示（incomingClearedAt === 0）で、
      // サーバー上の既存データを消去することはできない（古いクライアントからの遅延Push対策）。
      // 既存データがある場合は、正当な削除時刻 incomingClearedAt が存在し、
      // かつ既存データの更新時刻以上の場合のみ削除を実行する。
      if (!existingCustom) {
        if (incomingClearedAt > 0) {
          tombstones.customClosetDataClearedAt = Math.max(currentClearedAt, incomingClearedAt);
        }
      } else if (incomingClearedAt > 0 && incomingClearedAt >= existingUpdatedAt) {
        writeCustomData(ss, null);
        tombstones.customClosetDataClearedAt = Math.max(currentClearedAt, incomingClearedAt);
      } else {
        // タイムスタンプなし（incomingClearedAt === 0）または既存データより古い削除指示は破棄し、既存データを保護
      }
    } else if (incomingCustom) {
      // 削除時刻より新しく、かつ既存データの更新時刻以上の場合のみ保存
      const isNewerThanDeletion = currentClearedAt === 0 || incomingUpdatedAt > currentClearedAt;
      const isNewerThanExisting = !existingCustom || incomingUpdatedAt >= existingUpdatedAt;
      if (isNewerThanDeletion && isNewerThanExisting) {
        writeCustomData(ss, incomingCustom);
        tombstones.customClosetDataClearedAt = 0;
      }
    }
    // undefined の場合は既存のカスタムデータを保護（何もしない）

    // 4. 更新後の Tombstone をサーバー側に永続保存
    writeTombstones(ss, tombstones);

    // 5. analytics シートの再集計
    updateAnalyticsSheet(ss, mergedWearHistory, itemNamesMap);

    // 6. imageFolderId の更新 (送信されている場合)
    if (payload.imageFolderId !== undefined) {
      writeConfigValue(ss, 'imageFolderId', String(payload.imageFolderId).trim());
    }
    const currentFolderId = readConfigValue(ss, 'imageFolderId') || '';
    const imagesLastUpdatedAt = getImagesLastUpdatedAt(currentFolderId);

    // マージ後の最新データを返却（古い状態の端末もこれで最新化される）
    return createJsonResponse({
      ok: true,
      wearHistory: mergedWearHistory,
      wifeNgPairs: mergedWifeNg,
      customClosetData: readCustomData(ss),
      customClosetDataClearedAt: tombstones.customClosetDataClearedAt || undefined,
      tombstones: tombstones,
      imageFolderId: currentFolderId,
      imagesLastUpdatedAt: imagesLastUpdatedAt,
      syncedAt: new Date().toISOString()
    });
  } catch (err) {
    return createJsonResponse({ ok: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// -------------------------------------------------------------
// サーバー側 Tombstone 永続化 & LWW-Element-Set マージロジック
// -------------------------------------------------------------

function readTombstones(ss) {
  const val = readConfigValue(ss, 'syncTombstones');
  if (!val) {
    return {
      deletedWearMap: {},
      deletedWifeNgMap: {},
      wearHistoryClearedAt: 0,
      customClosetDataClearedAt: 0
    };
  }
  try {
    const parsed = JSON.parse(val);
    return {
      deletedWearMap: parsed.deletedWearMap || {},
      deletedWifeNgMap: parsed.deletedWifeNgMap || {},
      wearHistoryClearedAt: Number(parsed.wearHistoryClearedAt) || 0,
      customClosetDataClearedAt: Number(parsed.customClosetDataClearedAt) || 0
    };
  } catch (e) {
    return {
      deletedWearMap: {},
      deletedWifeNgMap: {},
      wearHistoryClearedAt: 0,
      customClosetDataClearedAt: 0
    };
  }
}

function writeTombstones(ss, tombstones) {
  writeConfigValue(ss, 'syncTombstones', JSON.stringify(tombstones));
}

function integrateIncomingTombstones(serverTombstones, payload) {
  // 1. 全削除タイムスタンプの統合
  if (payload.wearHistoryClearedAt) {
    serverTombstones.wearHistoryClearedAt = Math.max(
      serverTombstones.wearHistoryClearedAt || 0,
      Number(payload.wearHistoryClearedAt) || 0
    );
  }

  // 2. 着用履歴の個別削除マップの統合（正当なタイムスタンプを持つ削除のみ統合）
  if (payload.deletedWearMap && typeof payload.deletedWearMap === 'object') {
    Object.keys(payload.deletedWearMap).forEach(id => {
      const ts = Number(payload.deletedWearMap[id] || 0);
      if (ts > 0) {
        serverTombstones.deletedWearMap[id] = Math.max(
          serverTombstones.deletedWearMap[id] || 0,
          ts
        );
      }
    });
  }

  // 3. 奥様NGの個別削除マップの統合（正当なタイムスタンプを持つ削除のみ統合）
  if (payload.deletedWifeNgMap && typeof payload.deletedWifeNgMap === 'object') {
    Object.keys(payload.deletedWifeNgMap).forEach(key => {
      const ts = Number(payload.deletedWifeNgMap[key] || 0);
      if (ts > 0) {
        serverTombstones.deletedWifeNgMap[key] = Math.max(
          serverTombstones.deletedWifeNgMap[key] || 0,
          ts
        );
      }
    });
  }
}

/**
 * 着用履歴のマージ (LWW-Element-Set)
 * - 全削除タイムスタンプ wearHistoryClearedAt 以前のデータは除外
 * - deletedWearMap に記録された削除時刻以前のデータは除外（古い端末からの復活をブロック）
 * - 削除時刻より新しいタイムスタンプのデータは再登録として認め、Tombstone を解除
 */
function mergeWearHistory(existingList, incomingList, tombstones) {
  const map = new Map();

  const addRecord = (r) => {
    if (!r || !r.id || !r.date) return;
    const rTime = r.timestamp || 0;

    // 全履歴クリアより古いデータは除外
    if (tombstones.wearHistoryClearedAt && rTime <= tombstones.wearHistoryClearedAt) {
      return;
    }

    // 削除タイムスタンプとの比較
    const deletedAt = tombstones.deletedWearMap[r.id];
    if (deletedAt) {
      if (rTime <= deletedAt) {
        // 削除前の古いデータが送られてきたので復活をブロック！
        return;
      } else {
        // 削除後に新しく再登録されたデータなので Tombstone を解除
        delete tombstones.deletedWearMap[r.id];
      }
    }

    // 同一日付を主キーとして最新タイムスタンプを優先
    const key = r.date;
    const existing = map.get(key);
    if (!existing || rTime >= (existing.timestamp || 0)) {
      if (existing && existing.id !== r.id) {
        tombstones.deletedWearMap[existing.id] = Math.max(
          tombstones.deletedWearMap[existing.id] || 0,
          rTime
        );
      }
      map.set(key, r);
    } else if (existing.id !== r.id) {
      tombstones.deletedWearMap[r.id] = Math.max(
        tombstones.deletedWearMap[r.id] || 0,
        existing.timestamp || 0
      );
    }
  };

  (existingList || []).forEach(addRecord);
  (incomingList || []).forEach(addRecord);

  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * 奥様NGペアのマージ (LWW-Element-Set)
 * - deletedWifeNgMap に記録された削除時刻以前のペアは除外（古い端末からの復活をブロック）
 * - 削除時刻より新しい createdAt のペアは再登録として認め、Tombstone を解除
 */
function mergeWifeNg(existingList, incomingList, tombstones) {
  const map = new Map();

  const addPair = (p) => {
    if (!p || !p.shirtId || !p.pantsId) return;
    const key = p.shirtId + '_' + p.pantsId;
    const pTime = p.createdAt ? new Date(p.createdAt).getTime() : 0;

    // 削除タイムスタンプとの比較
    const deletedAt = tombstones.deletedWifeNgMap[key];
    if (deletedAt) {
      if (pTime <= deletedAt) {
        // 削除前の古いペアが送られてきたので復活をブロック！
        return;
      } else {
        // 削除後に新しく再登録されたペアなので Tombstone を解除
        delete tombstones.deletedWifeNgMap[key];
      }
    }

    const existing = map.get(key);
    if (!existing) {
      map.set(key, p);
    } else {
      const existingTime = existing.createdAt ? new Date(existing.createdAt).getTime() : 0;
      if (pTime >= existingTime) {
        map.set(key, p);
      }
    }
  };

  (existingList || []).forEach(addPair);
  (incomingList || []).forEach(addPair);

  return Array.from(map.values());
}

// -------------------------------------------------------------
// ヘルパー関数群
// -------------------------------------------------------------

function ensureSheetWithHeaders(ss, name, headers, bgColor, fontColor) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  // 1行目のヘッダーを設定（既存データ行は消去しない）
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground(bgColor).setFontColor(fontColor).setFontWeight('bold');
  sheet.setFrozenRows(1);

  return sheet;
}

function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Fail-Closed 認証:
 * トークン未指定、または meta_config の secretToken が未設定/不一致の場合はすべて拒否
 */
function validateToken(ss, token) {
  if (!token || typeof token !== 'string' || token.trim() === '') {
    return false;
  }

  const storedToken = readConfigValue(ss, 'secretToken');
  if (!storedToken || storedToken === '__SMART_CLOSET_SECRET_TOKEN__') {
    return false; // Fail-Closed
  }

  return storedToken === token.trim();
}

function readConfigValue(ss, key) {
  const metaSheet = ss.getSheetByName(SHEET_NAMES.META_CONFIG);
  if (!metaSheet || metaSheet.getLastRow() < 2) return null;
  const values = metaSheet.getRange(2, 1, metaSheet.getLastRow() - 1, 2).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === key) {
      return String(values[i][1] || '').trim();
    }
  }
  return null;
}

function writeConfigValue(ss, key, val) {
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.META_CONFIG);
  const now = new Date().toISOString();
  let foundRow = -1;

  if (sheet.getLastRow() > 1) {
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < values.length; i++) {
      if (values[i][0] === key) {
        foundRow = i + 2;
        break;
      }
    }
  }

  if (foundRow > 0) {
    sheet.getRange(foundRow, 2, 1, 2).setValues([[val, now]]);
  } else {
    sheet.appendRow([key, val, now]);
  }
}

function readWearHistory(ss) {
  const sheet = ss.getSheetByName(SHEET_NAMES.WEAR_HISTORY);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  const list = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (!row[0] || !row[1]) continue;
    list.push({
      id: String(row[0]),
      date: formatDateString(row[1]),
      scene: row[2] === 'remote' ? 'remote' : 'office',
      shirtId: String(row[3] || ''),
      pantsId: String(row[5] || ''),
      timestamp: Number(row[7]) || (new Date(row[1])).getTime()
    });
  }
  return list.sort((a, b) => b.date.localeCompare(a.date));
}

function writeWearHistory(ss, list, itemNamesMap) {
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.WEAR_HISTORY);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).clearContent();
  }
  if (!list || list.length === 0) return;

  const rows = list.map(item => [
    item.id,
    item.date,
    item.scene,
    item.shirtId,
    itemNamesMap[item.shirtId] || '',
    item.pantsId,
    itemNamesMap[item.pantsId] || '',
    item.timestamp || ''
  ]);

  sheet.getRange(2, 1, rows.length, 8).setValues(rows);
}

function readWifeNg(ss) {
  const sheet = ss.getSheetByName(SHEET_NAMES.WIFE_NG);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  const list = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (!row[0] || !row[2]) continue;
    list.push({
      shirtId: String(row[0]),
      pantsId: String(row[2]),
      reason: String(row[4] || '🚨 奥様からNG指定'),
      createdAt: row[5] ? (typeof row[5] === 'string' ? row[5] : (row[5] instanceof Date ? row[5].toISOString() : String(row[5]))) : ''
    });
  }
  return list;
}

function writeWifeNg(ss, list, itemNamesMap) {
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.WIFE_NG);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).clearContent();
  }
  if (!list || list.length === 0) return;

  const rows = list.map(item => [
    item.shirtId,
    itemNamesMap[item.shirtId] || '',
    item.pantsId,
    itemNamesMap[item.pantsId] || '',
    item.reason || '🚨 奥様からNG指定',
    item.createdAt || ''
  ]);

  sheet.getRange(2, 1, rows.length, 6).setValues(rows);
}

function readCustomData(ss) {
  const val = readConfigValue(ss, 'customClosetData');
  if (!val) return null;
  try {
    return JSON.parse(val);
  } catch (e) {
    return null;
  }
}

function writeCustomData(ss, data) {
  const jsonStr = data ? JSON.stringify(data) : '';
  writeConfigValue(ss, 'customClosetData', jsonStr);
}

/**
 * 着用履歴を集計し、アイテム稼働率と断捨離アラートを更新
 */
function updateAnalyticsSheet(ss, wearHistory, itemNamesMap) {
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.ANALYTICS);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).clearContent();
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
  const thirtyDaysStr = formatDateString(thirtyDaysAgo);
  const sixtyDaysAgo = new Date(now.getTime() - (60 * 24 * 60 * 60 * 1000));
  const sixtyDaysStr = formatDateString(sixtyDaysAgo);

  const stats = {};
  
  Object.keys(itemNamesMap || {}).forEach(id => {
    const category = id.startsWith('S') ? 'シャツ' : 'パンツ';
    stats[id] = {
      id: id,
      category: category,
      name: itemNamesMap[id] || '',
      totalCount: 0,
      recentCount: 0,
      lastDate: '-'
    };
  });

  (wearHistory || []).forEach(record => {
    [record.shirtId, record.pantsId].forEach(id => {
      if (!id) return;
      if (!stats[id]) {
        stats[id] = {
          id: id,
          category: id.startsWith('S') ? 'シャツ' : 'パンツ',
          name: (itemNamesMap && itemNamesMap[id]) || '',
          totalCount: 0,
          recentCount: 0,
          lastDate: '-'
        };
      }
      stats[id].totalCount += 1;
      if (record.date >= thirtyDaysStr) {
        stats[id].recentCount += 1;
      }
      if (stats[id].lastDate === '-' || record.date > stats[id].lastDate) {
        stats[id].lastDate = record.date;
      }
    });
  });

  const rows = Object.values(stats).sort((a, b) => {
    if (a.category !== b.category) return a.category === 'シャツ' ? -1 : 1;
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  }).map(item => {
    let status = '✅ 適正稼働';
    if (item.totalCount === 0 || (item.lastDate !== '-' && item.lastDate < sixtyDaysStr)) {
      status = '⚠️ 断捨離候補 (60日未着用)';
    } else if (item.recentCount >= 4) {
      status = '🔥 主力エース (直近4回以上)';
    }

    return [
      item.id,
      item.category,
      item.name,
      item.totalCount,
      item.recentCount,
      item.lastDate,
      status
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 7).setValues(rows);
  }
}

function formatDateString(val) {
  if (!val) return '';
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  return String(val).slice(0, 10);
}

// -------------------------------------------------------------
// Google ドライブ画像同期ロジック (Phase 2)
// -------------------------------------------------------------

// サポートする画像拡張子の正規表現 (大文字小文字不問: jpg, jpeg, png, webp)
const SUPPORTED_IMAGE_REGEX = /^([A-Za-z0-9_-]+)\.(jpe?g|png|webp)$/i;
// ブラウザ非対応または推奨されない画像形式 (HEIC, HEIF, BMP 等) の検出用正規表現 (指摘B)
const UNSUPPORTED_IMAGE_REGEX = /^([A-Za-z0-9_-]+)\.(heic|heif|bmp|gif|tiff|svg)$/i;

/**
 * 画像フォルダ内の最新更新タイムスタンプを超軽量に取得 (仕様4)
 * orderBy: 'modifiedTime desc', pageSize: 1 で最新1件のみ取得
 */
function getImagesLastUpdatedAt(folderId) {
  if (!folderId) return 0;
  try {
    if (typeof Drive !== 'undefined' && Drive.Files && Drive.Files.list) {
      const res = Drive.Files.list({
        q: "'" + folderId + "' in parents and trashed = false",
        orderBy: 'modifiedTime desc',
        pageSize: 1,
        fields: 'files(modifiedTime)'
      });
      if (res && res.files && res.files.length > 0) {
        return new Date(res.files[0].modifiedTime).getTime();
      }
    } else if (typeof DriveApp !== 'undefined') {
      const folder = DriveApp.getFolderById(folderId);
      const files = folder.getFiles();
      let maxTime = 0;
      while (files.hasNext()) {
        const file = files.next();
        const time = file.getLastUpdated().getTime();
        if (time > maxTime) maxTime = time;
      }
      return maxTime;
    }
  } catch (err) {
    Logger.log('⚠️ Warning in getImagesLastUpdatedAt: ' + err.toString());
  }
  return 0;
}

/**
 * フォルダ内の全ファイルから、アイテムID -> 最新ファイル情報のマップを構築
 * 同名ファイルは modifiedTime が最新のものを優先 (決定3)
 * IDは大文字に正規化 (仕様8)
 * trashed = false でゴミ箱ファイルを除外 (仕様3)
 * 非対応形式 (HEIC等) を検知して warnings を収集 (指摘B)
 */
function scanImageFolder(folderId) {
  const itemMap = {};
  const warnings = [];

  if (typeof Drive !== 'undefined' && Drive.Files && Drive.Files.list) {
    let pageToken = null;
    do {
      const res = Drive.Files.list({
        q: "'" + folderId + "' in parents and trashed = false",
        pageSize: 100,
        fields: 'nextPageToken, files(id, name, modifiedTime, thumbnailLink, size, mimeType)',
        pageToken: pageToken
      });
      if (res && res.files) {
        for (let i = 0; i < res.files.length; i++) {
          const f = res.files[i];
          const fileName = f.name || '';
          const match = fileName.match(SUPPORTED_IMAGE_REGEX);
          if (match) {
            const itemId = match[1].toUpperCase();
            const modifiedTime = new Date(f.modifiedTime).getTime();
            if (!itemMap[itemId] || modifiedTime > itemMap[itemId].modifiedTime) {
              itemMap[itemId] = {
                fileId: f.id,
                name: fileName,
                modifiedTime: modifiedTime,
                thumbnailLink: f.thumbnailLink,
                size: Number(f.size || 0),
                mimeType: f.mimeType
              };
            }
          } else {
            // 指摘B: HEIC や非対応形式の注意喚起
            const unMatch = fileName.match(UNSUPPORTED_IMAGE_REGEX);
            if (unMatch) {
              warnings.push(`[${fileName}] はブラウザ非対応の形式です。jpg または png に変換して保存してください`);
            }
          }
        }
      }
      pageToken = res ? res.nextPageToken : null;
    } while (pageToken);
  } else if (typeof DriveApp !== 'undefined') {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      const fileName = f.getName() || '';
      const match = fileName.match(SUPPORTED_IMAGE_REGEX);
      if (match) {
        const itemId = match[1].toUpperCase();
        const modifiedTime = f.getLastUpdated().getTime();
        if (!itemMap[itemId] || modifiedTime > itemMap[itemId].modifiedTime) {
          itemMap[itemId] = {
            fileId: f.getId(),
            name: fileName,
            modifiedTime: modifiedTime,
            thumbnailLink: null,
            size: f.getSize(),
            mimeType: f.getMimeType()
          };
        }
      } else {
        const unMatch = fileName.match(UNSUPPORTED_IMAGE_REGEX);
        if (unMatch) {
          warnings.push(`[${fileName}] はブラウザ非対応の形式です。jpg または png に変換して保存してください`);
        }
      }
    }
  }

  return { itemMap: itemMap, warnings: warnings };
}

/**
 * 画像同期プランの策定 (action: 'getImageSyncPlan', 仕様6)
 */
function handleGetImageSyncPlan(ss, payload) {
  const folderId = (payload && payload.imageFolderId) || readConfigValue(ss, 'imageFolderId');
  if (!folderId) {
    return createJsonResponse({
      ok: false,
      error: 'Google ドライブの画像フォルダ ID が設定されていません。クラウド設定画面または meta_config に登録してください。'
    });
  }

  try {
    const localMeta = (payload && payload.localMeta) || {};
    const scanResult = scanImageFolder(folderId);
    const itemMap = scanResult.itemMap;
    const warnings = scanResult.warnings;
    const validItemIds = Object.keys(itemMap).sort();
    const neededItemIds = [];
    let latestTime = 0;

    for (let i = 0; i < validItemIds.length; i++) {
      const id = validItemIds[i];
      const info = itemMap[id];
      if (info.modifiedTime > latestTime) {
        latestTime = info.modifiedTime;
      }
      const localTime = localMeta[id] || 0;
      if (localTime === 0 || info.modifiedTime > localTime) {
        neededItemIds.push(id);
      }
    }

    return createJsonResponse({
      ok: true,
      validItemIds: validItemIds,
      neededItemIds: neededItemIds,
      imagesLastUpdatedAt: latestTime,
      warnings: warnings
    });
  } catch (err) {
    return createJsonResponse({ ok: false, error: '画像フォルダ走査エラー: ' + err.toString() });
  }
}

/**
 * 指定アイテムの写真データをバッチ取得して Base64 化 (action: 'fetchImages', 仕様2, 6, 8)
 */
function handleFetchImages(ss, payload) {
  const folderId = (payload && payload.imageFolderId) || readConfigValue(ss, 'imageFolderId');
  if (!folderId) {
    return createJsonResponse({ ok: false, error: '画像フォルダ ID が未設定です' });
  }

  const itemIds = Array.isArray(payload && payload.itemIds) ? payload.itemIds : [];
  if (itemIds.length === 0) {
    return createJsonResponse({ ok: true, images: {}, timestamps: {}, warnings: [] });
  }

  try {
    const scanResult = scanImageFolder(folderId);
    const itemMap = scanResult.itemMap;
    const images = {};
    const timestamps = {};
    const warnings = [];

    const token = typeof ScriptApp !== 'undefined' ? ScriptApp.getOAuthToken() : '';

    for (let i = 0; i < itemIds.length; i++) {
      const id = itemIds[i].toUpperCase();
      const info = itemMap[id];
      if (!info) {
        warnings.push(`[${id}] フォルダ内に有効な画像ファイルが見つかりません`);
        continue;
      }

      try {
        let imageBlob = null;

        // 1. thumbnailLink の活用 (=s1024 高解像度サムネイル取得, 仕様2-a)
        if (info.thumbnailLink && typeof UrlFetchApp !== 'undefined' && token) {
          const s1024Url = info.thumbnailLink.replace(/=s\d+/, '=s1024');
          const res = UrlFetchApp.fetch(s1024Url, {
            headers: { Authorization: 'Bearer ' + token },
            muteHttpExceptions: true
          });
          if (res.getResponseCode() === 200) {
            imageBlob = res.getBlob();
          }
        }

        // 2. thumbnailLink 不在時または失敗時の原画フォールバック (上限2MB, 仕様2-c, 仕様8)
        if (!imageBlob && typeof DriveApp !== 'undefined') {
          const file = DriveApp.getFileById(info.fileId);
          const size = file.getSize();
          if (size > 2 * 1024 * 1024) {
            warnings.push(
              `[${id}] ファイルサイズが上限(2MB)を超えているためスキップされました (実測: ${(size / 1024 / 1024).toFixed(1)}MB)`
            );
            continue;
          }
          imageBlob = file.getBlob();
        }

        if (!imageBlob) {
          warnings.push(`[${id}] 画像データの取得に失敗しました`);
          continue;
        }

        // 動的 MIME 取得 (仕様2-b)
        const mimeType = imageBlob.getContentType() || 'image/jpeg';
        const base64Str = Utilities.base64Encode(imageBlob.getBytes());
        images[id] = `data:${mimeType};base64,${base64Str}`;
        timestamps[id] = info.modifiedTime;
      } catch (err) {
        warnings.push(`[${id}] 画像取得エラー: ${err.toString()}`);
      }
    }

    return createJsonResponse({
      ok: true,
      images: images,
      timestamps: timestamps,
      warnings: warnings
    });
  } catch (err) {
    return createJsonResponse({ ok: false, error: '画像バッチ取得エラー: ' + err.toString() });
  }
}

/**
 * アプリから直接送信された服の写真をドライブ正本フォルダへ保存 (action: 'uploadImage')
 * - 条件1: validateToken による認証通過後のみ実行
 * - 条件2: payload のフォルダ指定は無視し、meta_config の正本フォルダのみを使用
 */
function handleUploadImage(ss, payload) {
  // 条件2遵守: サーバー側の meta_config のみを唯一の正本とする
  const folderId = readConfigValue(ss, 'imageFolderId');
  if (!folderId) {
    return createJsonResponse({
      ok: false,
      error: 'Google ドライブの画像フォルダ ID が未設定です。スプレッドシートの meta_config に登録してください。'
    });
  }

  const rawId = payload && payload.itemId;
  if (!rawId || typeof rawId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(rawId)) {
    return createJsonResponse({ ok: false, error: 'アイテムIDの形式が不正です' });
  }
  const itemId = rawId.toUpperCase();

  const base64Str = (payload && payload.base64Data) || '';
  if (!base64Str) {
    return createJsonResponse({ ok: false, error: '画像データが空です' });
  }

  try {
    const bytes = Utilities.base64Decode(base64Str);
    if (bytes.length > 2 * 1024 * 1024) {
      return createJsonResponse({
        ok: false,
        error: `画像サイズが上限(2MB)を超えています (実測: ${(bytes.length / 1024 / 1024).toFixed(1)}MB)`
      });
    }

    const mimeType = (payload && payload.mimeType) || 'image/jpeg';
    const fileName = itemId + '.jpg';
    const blob = Utilities.newBlob(bytes, mimeType, fileName);

    if (typeof DriveApp === 'undefined') {
      return createJsonResponse({ ok: false, error: 'DriveApp が利用できません' });
    }

    const folder = DriveApp.getFolderById(folderId);

    // 同名の既存ファイルがあれば重複防止のため古いファイルをゴミ箱へ移動
    const existingFiles = folder.getFilesByName(fileName);
    while (existingFiles.hasNext()) {
      const oldFile = existingFiles.next();
      try {
        oldFile.setTrashed(true);
      } catch (e) {
        return createJsonResponse({
          ok: false,
          error: '既存ファイル(' + fileName + ')のゴミ箱退避に失敗しました: ' + e.toString()
        });
      }
    }

    const newFile = folder.createFile(blob);
    const modifiedTime = newFile.getLastUpdated().getTime();

    return createJsonResponse({
      ok: true,
      itemId: itemId,
      fileId: newFile.getId(),
      modifiedTime: modifiedTime
    });
  } catch (err) {
    return createJsonResponse({ ok: false, error: '画像アップロード保存エラー: ' + err.toString() });
  }
}

/**
 * ユーザーがエディタから手動実行して Drive 読み取り権限を初回承認するための関数 (決定1)
 */
function testDriveAccess() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const folderId = readConfigValue(ss, 'imageFolderId');
  Logger.log('🔍 Drive 権限テストを開始します (登録 folderId: ' + (folderId || '未設定') + ')');
  try {
    if (folderId && typeof DriveApp !== 'undefined') {
      const folder = DriveApp.getFolderById(folderId);
      Logger.log('📁 フォルダ検出成功: ' + folder.getName());
      const files = folder.getFiles();
      let count = 0;
      while (files.hasNext() && count < 5) {
        const f = files.next();
        Logger.log('  - ' + f.getName() + ' (' + f.getSize() + ' bytes)');
        count++;
      }
    } else {
      Logger.log('ℹ️ imageFolderId は未登録ですが、DriveApp API の呼び出し権限は正常に認可されました');
    }
    Logger.log('✅ Drive access OK');
  } catch (e) {
    Logger.log('❌ Drive access error: ' + e.toString());
  }
}

/**
 * ルーティングと既存同期の検証用関数 (指示1)
 */
function verifyRoutingAndSync() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const token = readConfigValue(ss, 'secretToken');
  Logger.log('🔑 secretToken: ' + (token ? '設定済み' : '未設定'));

  // 1. 通常のデータ同期 (doGet) のテスト
  const getReq = { parameter: { token: token } };
  const getRes = JSON.parse(doGet(getReq).getContent());
  Logger.log('✅ doGet (Pull) 検証: ok=' + getRes.ok + ', wearCount=' + (getRes.wearHistory ? getRes.wearHistory.length : 0) + ', imageFolderId=' + (getRes.imageFolderId || '未登録'));

  // 2. 画像同期プラン (getImageSyncPlan) のルーティングテスト
  const postReq = {
    postData: {
      contents: JSON.stringify({
        token: token,
        action: 'getImageSyncPlan',
        localMeta: {}
      })
    }
  };
  const planRes = JSON.parse(doPost(postReq).getContent());
  Logger.log('✅ getImageSyncPlan 検証: ok=' + planRes.ok + ', error=' + (planRes.error || 'なし'));

  return { getRes: getRes, planRes: planRes };
}

