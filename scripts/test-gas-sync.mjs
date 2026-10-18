import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

console.log('🧪 Running GAS backend and sync logic tests...');

// 1. gas/Code.gs と src/data/gasScriptTemplate.ts の同期検証
const codeGsPath = path.join(projectRoot, 'gas/Code.gs');
const templateTsPath = path.join(projectRoot, 'src/data/gasScriptTemplate.ts');

assert.ok(fs.existsSync(codeGsPath), 'gas/Code.gs must exist');
assert.ok(fs.existsSync(templateTsPath), 'src/data/gasScriptTemplate.ts must exist');

const codeGsContent = fs.readFileSync(codeGsPath, 'utf-8');
const templateTsContent = fs.readFileSync(templateTsPath, 'utf-8');

assert.ok(
  templateTsContent.includes('export const GAS_SCRIPT_TEMPLATE = `'),
  'gasScriptTemplate.ts must export GAS_SCRIPT_TEMPLATE'
);
assert.ok(
  templateTsContent.includes(codeGsContent.trim()),
  'gasScriptTemplate.ts must contain exact code from gas/Code.gs'
);
console.log('  ✅ Template synchronization verified');

// 2. インメモリ Google Apps Script モック環境の構築
class MockRange {
  constructor(sheet, startRow, startCol, numRows, numCols) {
    this.sheet = sheet;
    this.startRow = startRow;
    this.startCol = startCol;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  setValues(values) {
    for (let r = 0; r < values.length; r++) {
      const rowIndex = this.startRow - 1 + r;
      if (!this.sheet.grid[rowIndex]) {
        this.sheet.grid[rowIndex] = [];
      }
      for (let c = 0; c < values[r].length; c++) {
        const colIndex = this.startCol - 1 + c;
        this.sheet.grid[rowIndex][colIndex] = values[r][c];
      }
    }
    return this;
  }

  getValues() {
    const result = [];
    for (let r = 0; r < this.numRows; r++) {
      const row = [];
      const rowIndex = this.startRow - 1 + r;
      for (let c = 0; c < this.numCols; c++) {
        const colIndex = this.startCol - 1 + c;
        const val = this.sheet.grid[rowIndex] ? this.sheet.grid[rowIndex][colIndex] : undefined;
        row.push(val !== undefined ? val : '');
      }
      result.push(row);
    }
    return result;
  }

  clearContent() {
    for (let r = 0; r < this.numRows; r++) {
      const rowIndex = this.startRow - 1 + r;
      if (this.sheet.grid[rowIndex]) {
        for (let c = 0; c < this.numCols; c++) {
          const colIndex = this.startCol - 1 + c;
          this.sheet.grid[rowIndex][colIndex] = '';
        }
      }
    }
    return this;
  }

  setBackground() { return this; }
  setFontColor() { return this; }
  setFontWeight() { return this; }
}

class MockSheet {
  constructor(name) {
    this.name = name;
    this.grid = []; // 2D array [row][col]
    this.frozenRows = 0;
  }

  getName() { return this.name; }

  getLastRow() {
    let last = 0;
    for (let r = 0; r < this.grid.length; r++) {
      const row = this.grid[r];
      if (row && row.some(cell => cell !== '' && cell !== undefined && cell !== null)) {
        last = r + 1;
      }
    }
    return last;
  }

  getRange(row, col, numRows = 1, numCols = 1) {
    return new MockRange(this, row, col, numRows, numCols);
  }

  appendRow(rowValues) {
    const nextRow = this.getLastRow() + 1;
    this.getRange(nextRow, 1, 1, rowValues.length).setValues([rowValues]);
    return this;
  }

  setFrozenRows(n) {
    this.frozenRows = n;
  }

  clear() {
    this.grid = [];
  }
}

class MockSpreadsheet {
  constructor() {
    this.sheets = new Map();
  }

  getSheets() {
    return Array.from(this.sheets.values());
  }

  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }

  insertSheet(name) {
    const sheet = new MockSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }

  deleteSheet(sheet) {
    this.sheets.delete(sheet.getName());
  }
}

function createGasEnvironment(initialToken = 'test-secret-token-123') {
  const ss = new MockSpreadsheet();
  
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
    },
    Logger: {
      log: () => {},
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (str) => ({
        setMimeType: () => ({
          getContent: () => str,
        }),
      }),
    },
    Date,
    Math,
    String,
    Number,
    Array,
    Object,
    Set,
    Map,
    JSON,
    console,
  };

  const context = vm.createContext(sandbox);

  // 実際の gas/Code.gs にトークンを差し込んで vm 上で実行
  const codeToRun = codeGsContent.replace('__SMART_CLOSET_SECRET_TOKEN__', initialToken);
  vm.runInContext(codeToRun, context);

  return { ss, context };
}

// -------------------------------------------------------------
// Test Case 1: setupSpreadsheet の初期化と冪等性 (P1対応)
// -------------------------------------------------------------
{
  const { ss, context } = createGasEnvironment('token-abc-999');

  // 初回セットアップ実行
  vm.runInContext('setupSpreadsheet()', context);

  assert.ok(ss.getSheetByName('wear_history'), 'wear_history sheet must be created');
  assert.ok(ss.getSheetByName('wife_ng'), 'wife_ng sheet must be created');
  assert.ok(ss.getSheetByName('analytics'), 'analytics sheet must be created');
  const metaSheet = ss.getSheetByName('meta_config');
  assert.ok(metaSheet, 'meta_config sheet must be created');

  // 初期トークンが登録されていること
  const tokenVal = vm.runInContext('readConfigValue(SpreadsheetApp.getActiveSpreadsheet(), "secretToken")', context);
  assert.equal(tokenVal, 'token-abc-999', 'secretToken must be stored in meta_config');

  // データを1件追加
  const wearSheet = ss.getSheetByName('wear_history');
  wearSheet.appendRow(['w1', '2026-10-18', 'office', 'S1', '白シャツ', 'P1', '黒パンツ', 1000]);
  assert.equal(wearSheet.getLastRow(), 2, 'wear_history should have 2 rows (header + 1 record)');

  // もう一度 setupSpreadsheet() を実行しても、追加したデータが消えないこと (冪等性)
  vm.runInContext('setupSpreadsheet()', context);
  assert.equal(wearSheet.getLastRow(), 2, 'Existing data must NOT be cleared on re-running setupSpreadsheet');
  const values = wearSheet.getRange(2, 1, 1, 8).getValues()[0];
  assert.equal(values[0], 'w1', 'Saved record ID must remain unchanged');

  console.log('  ✅ Idempotent setupSpreadsheet and data preservation verified');
}

// -------------------------------------------------------------
// Test Case 2: Fail-Closed 認証検証 (P1対応)
// -------------------------------------------------------------
{
  const { context } = createGasEnvironment('correct-token-555');
  vm.runInContext('setupSpreadsheet()', context);

  // トークンなしのリクエスト -> 拒否
  const getNoTokenRes = JSON.parse(
    vm.runInContext('doGet({ parameter: {} })', context).getContent()
  );
  assert.equal(getNoTokenRes.ok, false);
  assert.match(getNoTokenRes.error, /認証エラー/);

  // 間違ったトークン -> 拒否
  const getWrongTokenRes = JSON.parse(
    vm.runInContext('doGet({ parameter: { token: "wrong" } })', context).getContent()
  );
  assert.equal(getWrongTokenRes.ok, false);
  assert.match(getWrongTokenRes.error, /認証エラー/);

  // 正しいトークン -> 許可
  const getSuccessRes = JSON.parse(
    vm.runInContext('doGet({ parameter: { token: "correct-token-555" } })', context).getContent()
  );
  assert.equal(getSuccessRes.ok, true);

  // POST も同様に検証
  const postNoTokenRes = JSON.parse(
    vm.runInContext('doPost({ postData: { contents: JSON.stringify({ action: "push" }) } })', context).getContent()
  );
  assert.equal(postNoTokenRes.ok, false);

  const postSuccessRes = JSON.parse(
    vm.runInContext('doPost({ postData: { contents: JSON.stringify({ action: "push", token: "correct-token-555" }) } })', context).getContent()
  );
  assert.equal(postSuccessRes.ok, true);

  console.log('  ✅ Fail-Closed authentication (doGet & doPost) verified');
}

// -------------------------------------------------------------
// Test Case 3: 複数端末 (Pixel ⇔ Mac) の双方向競合マージ (P1対応)
// -------------------------------------------------------------
{
  const { context } = createGasEnvironment('sync-token-111');
  vm.runInContext('setupSpreadsheet()', context);

  // 1. Pixel 9a が朝 08:00 に「S2 × P8」を Push
  const pixelPayload = {
    action: 'push',
    token: 'sync-token-111',
    wearHistory: [
      { id: 'rec_today', date: '2026-10-18', scene: 'office', shirtId: 'S2', pantsId: 'P8', timestamp: 1000 },
      { id: 'rec_yesterday', date: '2026-10-17', scene: 'remote', shirtId: 'S1', pantsId: 'P2', timestamp: 500 }
    ],
    wifeNgPairs: [
      { shirtId: 'S1', pantsId: 'P5', reason: '色被り', createdAt: '2026-10-18T08:00:00Z' }
    ],
    itemNamesMap: { S1: 'S1シャツ', S2: 'S2シャツ', P2: 'P2パンツ', P8: 'P8スラックス' }
  };
  const res1 = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(pixelPayload))} } })`, context).getContent()
  );
  assert.equal(res1.ok, true);
  assert.equal(res1.wearHistory.length, 2);

  // 2. Mac mini が未同期の古い状態のまま（Pixelの履歴を知らない）、夜 20:00 に別の奥様NGを追加して Push
  const macPayload = {
    action: 'push',
    token: 'sync-token-111',
    wearHistory: [
      // Mac側は 10/18 の記録を知らず、10/17 の記録のみ持っている
      { id: 'rec_yesterday', date: '2026-10-17', scene: 'remote', shirtId: 'S1', pantsId: 'P2', timestamp: 500 }
    ],
    wifeNgPairs: [
      // Mac側で新しいNG「S3 × P4」を追加
      { shirtId: 'S3', pantsId: 'P4', reason: 'デニム重複', createdAt: '2026-10-18T20:00:00Z' }
    ],
    itemNamesMap: { S1: 'S1シャツ', S3: 'S3シャツ', P4: 'P4パンツ' }
  };
  const res2 = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(macPayload))} } })`, context).getContent()
  );
  assert.equal(res2.ok, true);

  // ★重要検証: Pixel が登録した 10/18 の記録が消去されずにマージされていること！
  assert.equal(res2.wearHistory.length, 2, 'Pixel record for 10/18 must NOT be overwritten or lost');
  const dates = res2.wearHistory.map(r => r.date);
  assert.ok(dates.includes('2026-10-18'), '10/18 record must be retained');
  assert.ok(dates.includes('2026-10-17'), '10/17 record must be retained');

  // 奥様NGもマージされ、S1×P5 と S3×P4 の両方が存在すること！
  assert.equal(res2.wifeNgPairs.length, 2, 'Both wife NG pairs must be merged');
  const ngKeys = res2.wifeNgPairs.map(p => `${p.shirtId}_${p.pantsId}`);
  assert.ok(ngKeys.includes('S1_P5'), 'S1_P5 must exist');
  assert.ok(ngKeys.includes('S3_P4'), 'S3_P4 must exist');

  console.log('  ✅ Two-device bidirectional merge without data loss verified');
}

// -------------------------------------------------------------
// Test Case 4: 削除 (Tombstone) 同期検証 (P1対応)
// -------------------------------------------------------------
{
  const { context } = createGasEnvironment('sync-token-111');
  vm.runInContext('setupSpreadsheet()', context);

  // 初期データ投入
  const initPayload = {
    action: 'push',
    token: 'sync-token-111',
    wearHistory: [
      { id: 'del_target_1', date: '2026-10-10', scene: 'office', shirtId: 'S1', pantsId: 'P1', timestamp: 100 },
      { id: 'keep_target_2', date: '2026-10-11', scene: 'office', shirtId: 'S2', pantsId: 'P2', timestamp: 200 }
    ],
    wifeNgPairs: [
      { shirtId: 'S1', pantsId: 'P1', reason: 'NG1', createdAt: '2026-10-10T00:00:00Z' },
      { shirtId: 'S2', pantsId: 'P2', reason: 'NG2', createdAt: '2026-10-10T00:00:00Z' }
    ]
  };
  vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(initPayload))} } })`, context);

  // 削除操作: del_target_1 を削除、S1_P1 をNG解除
  const deletePayload = {
    action: 'push',
    token: 'sync-token-111',
    wearHistory: [
      { id: 'keep_target_2', date: '2026-10-11', scene: 'office', shirtId: 'S2', pantsId: 'P2', timestamp: 200 }
    ],
    deletedWearIds: ['del_target_1'],
    deletedWifeNgKeys: ['S1_P1']
  };
  const deleteRes = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(deletePayload))} } })`, context).getContent()
  );
  assert.equal(deleteRes.ok, true);

  // 削除対象がシートからもマージ結果からも除外されていること
  assert.equal(deleteRes.wearHistory.length, 1);
  assert.equal(deleteRes.wearHistory[0].id, 'keep_target_2');

  assert.equal(deleteRes.wifeNgPairs.length, 1);
  assert.equal(deleteRes.wifeNgPairs[0].shirtId, 'S2');

  console.log('  ✅ Tombstone deletion synchronization verified');
}

// -------------------------------------------------------------
// Test Case 5: カスタム服データ (customClosetData) 保護検証 (P1対応)
// -------------------------------------------------------------
{
  const { context } = createGasEnvironment('sync-token-111');
  vm.runInContext('setupSpreadsheet()', context);

  // 1. 端末Aがカスタム服データ（P16追加版）を Push
  const customDataPayload = {
    action: 'push',
    token: 'sync-token-111',
    customClosetData: {
      items: [{ id: 'P16', name: '黒スラックス', category: 'pants', dressScore: 4.5, comfortScore: 4.0 }]
    }
  };
  const res1 = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(customDataPayload))} } })`, context).getContent()
  );
  assert.equal(res1.ok, true);
  assert.ok(res1.customClosetData && res1.customClosetData.items.length === 1);

  // 2. カスタムデータ未保持の端末Bが通常 Push (customClosetData は undefined)
  const normalPushPayload = {
    action: 'push',
    token: 'sync-token-111',
    wearHistory: [{ id: 'r1', date: '2026-10-18', scene: 'office', shirtId: 'S1', pantsId: 'P16', timestamp: 500 }]
    // customClosetData は未指定
  };
  const res2 = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(normalPushPayload))} } })`, context).getContent()
  );
  assert.equal(res2.ok, true);
  // ★端末Aが保存したカスタムデータが消えずに維持されていること！
  assert.ok(res2.customClosetData && res2.customClosetData.items.length === 1, 'Custom closet data must NOT be cleared by undefined push');

  // 3. 明示的なリセット (clearCustomClosetData: true) を送った場合のみ消去されること
  const resetPayload = {
    action: 'push',
    token: 'sync-token-111',
    clearCustomClosetData: true
  };
  const res3 = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(resetPayload))} } })`, context).getContent()
  );
  assert.equal(res3.ok, true);
  assert.equal(res3.customClosetData, null, 'Custom closet data must be cleared when clearCustomClosetData is true');

  console.log('  ✅ Custom closet data protection and explicit reset verified');
}

console.log('🎉 All GAS backend & sync logic tests passed successfully!');
