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

const SHEET_NAMES = {
  WEAR_HISTORY: 'wear_history',
  WIFE_NG: 'wife_ng',
  ANALYTICS: 'analytics',
  META_CONFIG: 'meta_config'
};

function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const wearSheet = getOrCreateSheet(ss, SHEET_NAMES.WEAR_HISTORY);
  wearSheet.clear();
  const wearHeaders = ['ID', '日付', 'シーン', 'シャツID', 'シャツ名', 'パンツID', 'パンツ名', 'タイムスタンプ'];
  wearSheet.getRange(1, 1, 1, wearHeaders.length).setValues([wearHeaders])
    .setBackground('#1e293b').setFontColor('#f8fafc').setFontWeight('bold');
  wearSheet.setFrozenRows(1);

  const ngSheet = getOrCreateSheet(ss, SHEET_NAMES.WIFE_NG);
  ngSheet.clear();
  const ngHeaders = ['シャツID', 'シャツ名', 'パンツID', 'パンツ名', 'NG理由', '登録日時'];
  ngSheet.getRange(1, 1, 1, ngHeaders.length).setValues([ngHeaders])
    .setBackground('#881337').setFontColor('#ffe4e6').setFontWeight('bold');
  ngSheet.setFrozenRows(1);

  const analyticsSheet = getOrCreateSheet(ss, SHEET_NAMES.ANALYTICS);
  analyticsSheet.clear();
  const analyticsHeaders = ['アイテムID', 'カテゴリ', 'アイテム名', '累計着用回数', '直近30日着用回数', '最終着用日', '稼働ステータス'];
  analyticsSheet.getRange(1, 1, 1, analyticsHeaders.length).setValues([analyticsHeaders])
    .setBackground('#0f172a').setFontColor('#38bdf8').setFontWeight('bold');
  analyticsSheet.setFrozenRows(1);

  const metaSheet = getOrCreateSheet(ss, SHEET_NAMES.META_CONFIG);
  metaSheet.clear();
  const metaHeaders = ['キー', '値', '最終更新日時'];
  metaSheet.getRange(1, 1, 1, metaHeaders.length).setValues([metaHeaders])
    .setBackground('#334155').setFontColor('#f1f5f9').setFontWeight('bold');
  metaSheet.setFrozenRows(1);

  const sheet1 = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (sheet1 && ss.getSheets().length > 1) {
    ss.deleteSheet(sheet1);
  }

  Logger.log('✅ Smart Closet スプレッドシートの初期セットアップが完了しました！');
}

function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const token = e && e.parameter ? e.parameter.token : null;
    
    if (!validateToken(ss, token)) {
      return createJsonResponse({ ok: false, error: '認証エラー: トークンが無効です' });
    }

    const wearHistory = readWearHistory(ss);
    const wifeNgPairs = readWifeNg(ss);
    const customClosetData = readCustomData(ss);

    return createJsonResponse({
      ok: true,
      wearHistory: wearHistory,
      wifeNgPairs: wifeNgPairs,
      customClosetData: customClosetData,
      syncedAt: new Date().toISOString()
    });
  } catch (err) {
    return createJsonResponse({ ok: false, error: err.toString() });
  }
}

function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ ok: false, error: 'リクエストデータが空です' });
    }

    const payload = JSON.parse(e.postData.contents);
    const token = payload.token || null;

    if (!validateToken(ss, token)) {
      return createJsonResponse({ ok: false, error: '認証エラー: トークンが無効です' });
    }

    const itemNamesMap = payload.itemNamesMap || {};

    if (Array.isArray(payload.wearHistory)) {
      writeWearHistory(ss, payload.wearHistory, itemNamesMap);
    }

    if (Array.isArray(payload.wifeNgPairs)) {
      writeWifeNg(ss, payload.wifeNgPairs, itemNamesMap);
    }

    if (payload.customClosetData !== undefined) {
      writeCustomData(ss, payload.customClosetData);
    }

    updateAnalyticsSheet(ss, payload.wearHistory || readWearHistory(ss), itemNamesMap);

    return createJsonResponse({
      ok: true,
      syncedAt: new Date().toISOString()
    });
  } catch (err) {
    return createJsonResponse({ ok: false, error: err.toString() });
  }
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

function validateToken(ss, token) {
  const metaSheet = ss.getSheetByName(SHEET_NAMES.META_CONFIG);
  if (!metaSheet || metaSheet.getLastRow() < 2) return true;
  
  const values = metaSheet.getRange(2, 1, metaSheet.getLastRow() - 1, 2).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === 'secretToken' && values[i][1]) {
      return values[i][1] === token;
    }
  }
  return true;
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
  const sheet = ss.getSheetByName(SHEET_NAMES.META_CONFIG);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === 'customClosetData' && values[i][1]) {
      try {
        return JSON.parse(values[i][1]);
      } catch (e) {
        return null;
      }
    }
  }
  return null;
}

function writeCustomData(ss, data) {
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.META_CONFIG);
  const now = new Date().toISOString();
  const jsonStr = data ? JSON.stringify(data) : '';

  let foundRow = -1;
  if (sheet.getLastRow() > 1) {
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < values.length; i++) {
      if (values[i][0] === 'customClosetData') {
        foundRow = i + 2;
        break;
      }
    }
  }

  if (foundRow > 0) {
    sheet.getRange(foundRow, 2, 1, 2).setValues([[jsonStr, now]]);
  } else {
    sheet.appendRow(['customClosetData', jsonStr, now]);
  }
}

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
  
  Object.keys(itemNamesMap).forEach(id => {
    const category = id.startsWith('S') ? 'シャツ' : 'パンツ';
    stats[id] = {
      id: id,
      category: category,
      name: itemNamesMap[id],
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
          name: itemNamesMap[id] || '',
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
