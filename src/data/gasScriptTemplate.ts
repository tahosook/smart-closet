/**
 * Google Apps Script (Code.gs) のテンプレート文字列
 * アプリのクラウド設定モーダルから1クリックでコピー可能にするために保持
 */
export const GAS_SCRIPT_TEMPLATE = `/**
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

    return createJsonResponse({
      ok: true,
      wearHistory: wearHistory,
      wifeNgPairs: wifeNgPairs,
      customClosetData: customClosetData,
      customClosetDataClearedAt: tombstones.customClosetDataClearedAt || undefined,
      tombstones: tombstones,
      syncedAt: new Date().toISOString()
    });
  } catch (err) {
    return createJsonResponse({ ok: false, error: err.toString() });
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

    const isDeletionRequested =
      payload.clearCustomClosetData === true ||
      (payload.customClosetDataClearedAt !== undefined && Number(payload.customClosetDataClearedAt) > 0);
    const incomingClearedAt = Number(
      payload.customClosetDataClearedAt ||
      (payload.clearCustomClosetData === true ? Date.now() : 0)
    );

    const incomingCustom =
      payload.customClosetData && Array.isArray(payload.customClosetData.items)
        ? payload.customClosetData
        : null;
    const incomingUpdatedAt = incomingCustom
      ? Number(payload.customClosetDataUpdatedAt || incomingCustom.updatedAt || 0)
      : 0;

    if (isDeletionRequested && (!incomingCustom || incomingClearedAt >= incomingUpdatedAt)) {
      // 既存データがある場合は、削除時刻が既存データの更新時刻以上の場合のみ削除を実行
      // （新しく再インポートされたデータに対する古い端末からの遅延削除指示は破棄する）
      if (!existingCustom || incomingClearedAt >= existingUpdatedAt) {
        writeCustomData(ss, null);
        tombstones.customClosetDataClearedAt = Math.max(currentClearedAt, incomingClearedAt);
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

    // マージ後の最新データを返却（古い状態の端末もこれで最新化される）
    return createJsonResponse({
      ok: true,
      wearHistory: mergedWearHistory,
      wifeNgPairs: mergedWifeNg,
      customClosetData: readCustomData(ss),
      customClosetDataClearedAt: tombstones.customClosetDataClearedAt || undefined,
      tombstones: tombstones,
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
  const now = Date.now();

  // 1. 全削除タイムスタンプの統合
  if (payload.wearHistoryClearedAt) {
    serverTombstones.wearHistoryClearedAt = Math.max(
      serverTombstones.wearHistoryClearedAt || 0,
      payload.wearHistoryClearedAt
    );
  }

  // 2. 着用履歴の個別削除マップの統合
  if (payload.deletedWearMap && typeof payload.deletedWearMap === 'object') {
    Object.keys(payload.deletedWearMap).forEach(id => {
      const ts = payload.deletedWearMap[id] || now;
      serverTombstones.deletedWearMap[id] = Math.max(
        serverTombstones.deletedWearMap[id] || 0,
        ts
      );
    });
  }
  // 配列形式の後方互換（マップにタイムスタンプが存在しない場合のみ fallback）
  if (Array.isArray(payload.deletedWearIds)) {
    payload.deletedWearIds.forEach(id => {
      if (!payload.deletedWearMap || payload.deletedWearMap[id] === undefined) {
        serverTombstones.deletedWearMap[id] = Math.max(
          serverTombstones.deletedWearMap[id] || 0,
          now
        );
      }
    });
  }

  // 3. 奥様NGの個別削除マップの統合
  if (payload.deletedWifeNgMap && typeof payload.deletedWifeNgMap === 'object') {
    Object.keys(payload.deletedWifeNgMap).forEach(key => {
      const ts = payload.deletedWifeNgMap[key] || now;
      serverTombstones.deletedWifeNgMap[key] = Math.max(
        serverTombstones.deletedWifeNgMap[key] || 0,
        ts
      );
    });
  }
  // 配列形式の後方互換（マップにタイムスタンプが存在しない場合のみ fallback）
  if (Array.isArray(payload.deletedWifeNgKeys)) {
    payload.deletedWifeNgKeys.forEach(key => {
      if (!payload.deletedWifeNgMap || payload.deletedWifeNgMap[key] === undefined) {
        serverTombstones.deletedWifeNgMap[key] = Math.max(
          serverTombstones.deletedWifeNgMap[key] || 0,
          now
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
    item.timestamp || Date.now()
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
      createdAt: row[5] ? (typeof row[5] === 'string' ? row[5] : (row[5] instanceof Date ? row[5].toISOString() : String(row[5]))) : new Date().toISOString()
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
    item.createdAt || new Date().toISOString()
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
`;
