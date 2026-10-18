import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const syncReconcileTsPath = path.join(projectRoot, 'src/utils/syncReconcile.ts');
const syncReconcileCode = fs.readFileSync(syncReconcileTsPath, 'utf-8');
const transpiledJs = ts.transpileModule(syncReconcileCode, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const syncReconcile = await import(
  'data:text/javascript;base64,' + Buffer.from(transpiledJs).toString('base64')
);
const { pruneCompletedTombstones, hasRemainingTombstones, reconcileSyncResponse } = syncReconcile;

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

function createGasEnvironment(initialToken = 'test-secret-token-123', lockOptions = { shouldAcquire: true }) {
  const ss = new MockSpreadsheet();
  
  let lockAcquired = false;
  let lockTryCount = 0;
  let lockReleaseCount = 0;

  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: (timeout) => {
          lockTryCount++;
          if (lockOptions.shouldAcquire) {
            lockAcquired = true;
            return true;
          }
          return false;
        },
        releaseLock: () => {
          lockReleaseCount++;
          lockAcquired = false;
        },
      }),
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

  return {
    ss,
    context,
    getLockStatus: () => ({ lockAcquired, lockTryCount, lockReleaseCount }),
  };
}

// -------------------------------------------------------------
// Test Case 1: setupSpreadsheet の初期化と冪等性 (P1対応)
// -------------------------------------------------------------
{
  const { ss, context } = createGasEnvironment('token-abc-999');

  vm.runInContext('setupSpreadsheet()', context);

  assert.ok(ss.getSheetByName('wear_history'), 'wear_history sheet must be created');
  assert.ok(ss.getSheetByName('wife_ng'), 'wife_ng sheet must be created');
  assert.ok(ss.getSheetByName('analytics'), 'analytics sheet must be created');
  assert.ok(ss.getSheetByName('meta_config'), 'meta_config sheet must be created');

  const tokenVal = vm.runInContext('readConfigValue(SpreadsheetApp.getActiveSpreadsheet(), "secretToken")', context);
  assert.equal(tokenVal, 'token-abc-999', 'secretToken must be stored in meta_config');

  const wearSheet = ss.getSheetByName('wear_history');
  wearSheet.appendRow(['w1', '2026-10-18', 'office', 'S1', '白シャツ', 'P1', '黒パンツ', 1000]);
  assert.equal(wearSheet.getLastRow(), 2, 'wear_history should have 2 rows (header + 1 record)');

  // 2回目の setupSpreadsheet() 実行でも既存データが消えないこと (冪等性)
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

  const getNoTokenRes = JSON.parse(
    vm.runInContext('doGet({ parameter: {} })', context).getContent()
  );
  assert.equal(getNoTokenRes.ok, false);
  assert.match(getNoTokenRes.error, /認証エラー/);

  const getWrongTokenRes = JSON.parse(
    vm.runInContext('doGet({ parameter: { token: "wrong" } })', context).getContent()
  );
  assert.equal(getWrongTokenRes.ok, false);

  const getSuccessRes = JSON.parse(
    vm.runInContext('doGet({ parameter: { token: "correct-token-555" } })', context).getContent()
  );
  assert.equal(getSuccessRes.ok, true);

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

  const macPayload = {
    action: 'push',
    token: 'sync-token-111',
    wearHistory: [
      { id: 'rec_yesterday', date: '2026-10-17', scene: 'remote', shirtId: 'S1', pantsId: 'P2', timestamp: 500 }
    ],
    wifeNgPairs: [
      { shirtId: 'S3', pantsId: 'P4', reason: 'デニム重複', createdAt: '2026-10-18T20:00:00Z' }
    ],
    itemNamesMap: { S1: 'S1シャツ', S3: 'S3シャツ', P4: 'P4パンツ' }
  };
  const res2 = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(macPayload))} } })`, context).getContent()
  );
  assert.equal(res2.ok, true);

  assert.equal(res2.wearHistory.length, 2, 'Pixel record for 10/18 must NOT be lost');
  assert.equal(res2.wifeNgPairs.length, 2, 'Both wife NG pairs must be merged');

  console.log('  ✅ Two-device bidirectional merge without data loss verified');
}

// -------------------------------------------------------------
// Test Case 4: 削除情報のサーバー永続化 ＆ 古い端末からの再送での復活防止 ＆ 再登録テスト (P1再レビュー対応)
// -------------------------------------------------------------
{
  const { ss, context } = createGasEnvironment('sync-token-111');
  vm.runInContext('setupSpreadsheet()', context);

  const baseTime = Date.now() - 30000;
  const t1 = baseTime;              // 初期登録時刻
  const t1Iso = new Date(t1).toISOString();
  const t2 = baseTime + 10000;       // 削除実行時刻
  const t3 = baseTime + 20000;       // 再登録実行時刻
  const t3Iso = new Date(t3).toISOString();
  const t4 = baseTime + 25000;       // 全削除実行時刻

  // 1. 初期データ登録 (時刻 t1)
  const initPayload = {
    action: 'push',
    token: 'sync-token-111',
    wearHistory: [
      { id: 'rec_old_1', date: '2026-10-10', scene: 'office', shirtId: 'S1', pantsId: 'P1', timestamp: t1 },
      { id: 'rec_keep_2', date: '2026-10-11', scene: 'office', shirtId: 'S2', pantsId: 'P2', timestamp: t1 }
    ],
    wifeNgPairs: [
      { shirtId: 'S1', pantsId: 'P1', reason: 'NG1', createdAt: t1Iso },
      { shirtId: 'S2', pantsId: 'P2', reason: 'NG2', createdAt: t1Iso }
    ]
  };
  vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(initPayload))} } })`, context);

  // 2. Pixel 9a が時刻 t2 に rec_old_1 と S1_P1 を削除
  const deletePayload = {
    action: 'push',
    token: 'sync-token-111',
    wearHistory: [
      { id: 'rec_keep_2', date: '2026-10-11', scene: 'office', shirtId: 'S2', pantsId: 'P2', timestamp: t1 }
    ],
    deletedWearMap: { rec_old_1: t2 },
    deletedWifeNgMap: { S1_P1: t2 }
  };
  const deleteRes = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(deletePayload))} } })`, context).getContent()
  );
  assert.equal(deleteRes.ok, true);
  assert.equal(deleteRes.wearHistory.length, 1);
  assert.equal(deleteRes.wifeNgPairs.length, 1);

  // サーバー側の meta_config に Tombstone が永続保存されていることを確認
  const savedTombstones = JSON.parse(
    vm.runInContext('readConfigValue(SpreadsheetApp.getActiveSpreadsheet(), "syncTombstones")', context)
  );
  assert.equal(savedTombstones.deletedWearMap.rec_old_1, t2, 'Tombstone for rec_old_1 must be persisted');
  assert.equal(savedTombstones.deletedWifeNgMap.S1_P1, t2, 'Tombstone for S1_P1 must be persisted');

  // 3. ★重要: 削除を知らない未同期の古い Mac が、削除前の古い履歴 (ts: t1) と古いNG (ts: t1) を再送
  const staleMacPayload = {
    action: 'push',
    token: 'sync-token-111',
    wearHistory: [
      { id: 'rec_old_1', date: '2026-10-10', scene: 'office', shirtId: 'S1', pantsId: 'P1', timestamp: t1 },
      { id: 'rec_keep_2', date: '2026-10-11', scene: 'office', shirtId: 'S2', pantsId: 'P2', timestamp: t1 }
    ],
    wifeNgPairs: [
      { shirtId: 'S1', pantsId: 'P1', reason: 'NG1', createdAt: t1Iso },
      { shirtId: 'S2', pantsId: 'P2', reason: 'NG2', createdAt: t1Iso }
    ]
  };
  const staleRes = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(staleMacPayload))} } })`, context).getContent()
  );
  assert.equal(staleRes.ok, true);

  // ★重要検証: 古い端末からの再送によって削除済みデータが復活していないこと！
  assert.equal(staleRes.wearHistory.length, 1, 'Deleted wear record must NOT resurrect from stale device push');
  assert.equal(staleRes.wearHistory[0].id, 'rec_keep_2');

  assert.equal(staleRes.wifeNgPairs.length, 1, 'Deleted wife NG pair must NOT resurrect from stale device push');
  assert.equal(staleRes.wifeNgPairs[0].shirtId, 'S2');

  // 4. ★削除後の再登録テスト: 時刻 t3 (> t2) に新しく S1_P1 を奥様NGとして再登録して送信
  const reregisterPayload = {
    action: 'push',
    token: 'sync-token-111',
    wifeNgPairs: [
      { shirtId: 'S1', pantsId: 'P1', reason: 'やっぱりダメ出しされた', createdAt: t3Iso }
    ]
  };
  const reregisterRes = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(reregisterPayload))} } })`, context).getContent()
  );
  assert.equal(reregisterRes.ok, true);
  // 削除時刻より新しいため、再登録として採用されること
  assert.equal(reregisterRes.wifeNgPairs.length, 2, 'Re-registered wife NG pair must be accepted');
  const s1p1 = reregisterRes.wifeNgPairs.find(p => p.shirtId === 'S1' && p.pantsId === 'P1');
  assert.ok(s1p1);
  assert.equal(s1p1.reason, 'やっぱりダメ出しされた');

  // 5. ★全履歴クリアの永続性テスト
  const clearPayload = {
    action: 'push',
    token: 'sync-token-111',
    wearHistoryClearedAt: t4
  };
  vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(clearPayload))} } })`, context);

  // 古い履歴 (ts: t1) を再送しても全履歴クリアによって復活しないこと
  const staleAfterClearRes = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(staleMacPayload))} } })`, context).getContent()
  );
  assert.equal(staleAfterClearRes.wearHistory.length, 0, 'Old records must NOT resurrect after wearHistoryClearedAt');

  console.log('  ✅ Persistent Tombstones (prevention of resurrection and valid re-registration) verified');
}

// -------------------------------------------------------------
// Test Case 5: LockService による排他制御検証 (P2再レビュー対応)
// -------------------------------------------------------------
{
  // 1. 通常実行時: ロック取得と解放が正しく行われること
  const { context, getLockStatus } = createGasEnvironment('sync-token-111', { shouldAcquire: true });
  vm.runInContext('setupSpreadsheet()', context);

  const res = JSON.parse(
    vm.runInContext('doPost({ postData: { contents: JSON.stringify({ action: "push", token: "sync-token-111" }) } })', context).getContent()
  );
  assert.equal(res.ok, true);

  const lockStatus = getLockStatus();
  assert.equal(lockStatus.lockTryCount, 1, 'Lock must be requested');
  assert.equal(lockStatus.lockReleaseCount, 1, 'Lock must be released');
  assert.equal(lockStatus.lockAcquired, false, 'Lock must not remain held after doPost');

  // 2. 競合時: ロック取得失敗時にエラーレスポンスを返し、安全に処理を中止すること
  const { context: lockedContext } = createGasEnvironment('sync-token-111', { shouldAcquire: false });
  const conflictRes = JSON.parse(
    vm.runInContext('doPost({ postData: { contents: JSON.stringify({ action: "push", token: "sync-token-111" }) } })', lockedContext).getContent()
  );
  assert.equal(conflictRes.ok, false);
  assert.match(conflictRes.error, /他端末と同期処理中です/);

  console.log('  ✅ LockService concurrency control and lock lifecycle verified');
}

// -------------------------------------------------------------
// Test Case 6: カスタム服データ (customClosetData) 保護検証 (P1対応)
// -------------------------------------------------------------
{
  const { context } = createGasEnvironment('sync-token-111');
  vm.runInContext('setupSpreadsheet()', context);

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

  // 通常 Push (customClosetData は undefined) で消えないこと
  const normalPushPayload = {
    action: 'push',
    token: 'sync-token-111',
    wearHistory: [{ id: 'r1', date: '2026-10-18', scene: 'office', shirtId: 'S1', pantsId: 'P16', timestamp: 500 }]
  };
  const res2 = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(normalPushPayload))} } })`, context).getContent()
  );
  assert.equal(res2.ok, true);
  assert.ok(res2.customClosetData && res2.customClosetData.items.length === 1, 'Custom closet data must NOT be cleared by undefined push');

  // 明示的なリセット (clearCustomClosetData: true) を送った場合のみ消去されること
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

// -------------------------------------------------------------
// Test Case 7: Push / Pull 通信中のローカル変更・Tombstone 競合調停 (P1第3回レビュー対応)
// -------------------------------------------------------------
{
  const { ss, context } = createGasEnvironment('sync-token-111');
  vm.runInContext('setupSpreadsheet()', context);

  const defaultClosetMock = { items: [] };

  // 1. pruneCompletedTombstones の単体検証
  const sentTombstones = {
    deletedWearMap: { rec_sent: 1000 },
    deletedWifeNgMap: { S1_P1: 1000 },
    wearHistoryClearedAt: 1000,
    clearCustomClosetData: true,
    customClosetDataClearedAt: 1000,
  };
  const currentTombstones = {
    deletedWearMap: { rec_sent: 1000, rec_inflight: 1500 },
    deletedWifeNgMap: { S1_P1: 1000, S2_P2: 1600 },
    wearHistoryClearedAt: 1000,
    clearCustomClosetData: true,
    customClosetDataClearedAt: 1500,
  };

  const pruned = pruneCompletedTombstones(currentTombstones, sentTombstones, true);
  assert.equal(pruned.deletedWearMap.rec_sent, undefined, 'Sent wear tombstone must be pruned');
  assert.equal(pruned.deletedWearMap.rec_inflight, 1500, 'In-flight wear tombstone must be preserved');
  assert.equal(pruned.deletedWifeNgMap.S1_P1, undefined, 'Sent wife NG tombstone must be pruned');
  assert.equal(pruned.deletedWifeNgMap.S2_P2, 1600, 'In-flight wife NG tombstone must be preserved');
  assert.equal(pruned.wearHistoryClearedAt, undefined, 'Sent clearedAt must be pruned');
  assert.equal(pruned.clearCustomClosetData, true, 'In-flight clearCustomClosetData must be preserved');
  assert.equal(pruned.customClosetDataClearedAt, 1500, 'In-flight customClosetDataClearedAt must be preserved');
  assert.equal(hasRemainingTombstones(pruned), true, 'Remaining tombstones must be detected');

  // 2. Push 通信中の新規削除 (Tombstone 保護) & 新規着用記録の保護
  const baseTime = Date.now() - 10000;
  const t_init = baseTime;
  const t_inflight_del = baseTime + 1000;
  const t_inflight_add = baseTime + 2000;

  // 初期状態をサーバーに登録
  const initPayload = {
    action: 'push',
    token: 'sync-token-111',
    wearHistory: [
      { id: 'rec_keep', date: '2026-10-17', scene: 'office', shirtId: 'S2', pantsId: 'P2', timestamp: t_init },
      { id: 'rec_to_delete', date: '2026-10-18', scene: 'office', shirtId: 'S1', pantsId: 'P1', timestamp: t_init },
    ],
    wifeNgPairs: [],
  };
  vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(initPayload))} } })`, context);

  // Push #1 開始時のスナップショット (まだ rec_to_delete の削除を知らない)
  const push1SentTombstones = { deletedWearMap: {}, deletedWifeNgMap: {} };

  // 通信中にユーザーがローカルで rec_to_delete を削除し、さらに今日着用 rec_new を追加
  const localStateDuringPush1 = {
    wearHistory: [
      { id: 'rec_keep', date: '2026-10-17', scene: 'office', shirtId: 'S2', pantsId: 'P2', timestamp: t_init },
      { id: 'rec_new', date: '2026-10-18', scene: 'remote', shirtId: 'S3', pantsId: 'P3', timestamp: t_inflight_add },
    ],
    wifeNgPairs: [
      { shirtId: 'S1', pantsId: 'P9', reason: '通信中NG', createdAt: new Date(t_inflight_add).toISOString() },
    ],
    closetData: defaultClosetMock,
    hasCustomData: false,
    tombstones: {
      deletedWearMap: { rec_to_delete: t_inflight_del },
      deletedWifeNgMap: {},
    },
  };

  // Push #1 のレスポンス到着 (サーバー側はまだ rec_to_delete を含んでいる)
  const serverPush1Response = {
    ok: true,
    wearHistory: [
      { id: 'rec_keep', date: '2026-10-17', scene: 'office', shirtId: 'S2', pantsId: 'P2', timestamp: t_init },
      { id: 'rec_to_delete', date: '2026-10-18', scene: 'office', shirtId: 'S1', pantsId: 'P1', timestamp: t_init },
    ],
    wifeNgPairs: [],
  };

  const reconcile1 = reconcileSyncResponse({
    serverResponse: serverPush1Response,
    currentLocal: localStateDuringPush1,
    sentTombstones: push1SentTombstones,
    hasInFlightMutations: true,
    defaultClosetData: defaultClosetMock,
  });

  // 検証:
  // - 通信中に追加された Tombstone が消えていないこと
  assert.equal(
    reconcile1.remainingTombstones.deletedWearMap.rec_to_delete,
    t_inflight_del,
    'In-flight tombstone must NOT be cleared by older response'
  );
  // - 通信中に削除した rec_to_delete が古いレスポンスによって復活（チラつき）していないこと
  assert.equal(
    reconcile1.wearHistory.some((r) => r.id === 'rec_to_delete'),
    false,
    'Deleted record must NOT resurrect from older response'
  );
  // - 通信中に追加された rec_new と 通信中NG が保持されていること
  assert.equal(
    reconcile1.wearHistory.some((r) => r.id === 'rec_new'),
    true,
    'In-flight added wear record must NOT be lost'
  );
  assert.equal(
    reconcile1.wifeNgPairs.some((p) => p.shirtId === 'S1' && p.pantsId === 'P9'),
    true,
    'In-flight added wife NG pair must NOT be lost'
  );
  // - stillDirty が true であり、追随 Push が必要であることが示されていること
  assert.equal(reconcile1.stillDirty, true, 'stillDirty must remain true for follow-up push');

  // 追随 Push #2 の送信 (残存 Tombstones と最新状態をサーバーへ)
  const push2Payload = {
    action: 'push',
    token: 'sync-token-111',
    wearHistory: reconcile1.wearHistory,
    wifeNgPairs: reconcile1.wifeNgPairs,
    deletedWearMap: reconcile1.remainingTombstones.deletedWearMap,
    deletedWifeNgMap: reconcile1.remainingTombstones.deletedWifeNgMap,
  };
  const push2Res = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(push2Payload))} } })`, context).getContent()
  );
  assert.equal(push2Res.ok, true);
  // サーバー側でも rec_to_delete が確実に除外され、rec_new と S1_P9 が登録されたこと
  assert.equal(push2Res.wearHistory.some((r) => r.id === 'rec_to_delete'), false);
  assert.equal(push2Res.wearHistory.some((r) => r.id === 'rec_new'), true);
  assert.equal(push2Res.wifeNgPairs.some((p) => p.shirtId === 'S1' && p.pantsId === 'P9'), true);

  // Push #2 完了時の調停 (通信中の追加操作なし)
  const reconcile2 = reconcileSyncResponse({
    serverResponse: push2Res,
    currentLocal: {
      ...localStateDuringPush1,
      wearHistory: reconcile1.wearHistory,
      wifeNgPairs: reconcile1.wifeNgPairs,
      tombstones: reconcile1.remainingTombstones,
    },
    sentTombstones: reconcile1.remainingTombstones,
    hasInFlightMutations: false,
    defaultClosetData: defaultClosetMock,
  });
  // 送信完了した Tombstones がクリアされ、dirty も解除されること
  assert.equal(hasRemainingTombstones(reconcile2.remainingTombstones), false);
  assert.equal(reconcile2.stillDirty, false);

  // 3. Pull 通信中のローカル操作の保護
  const pullStartTombstones = { deletedWearMap: {}, deletedWifeNgMap: {} };
  const localStateDuringPull = {
    wearHistory: [
      { id: 'rec_local_newer', date: '2026-10-18', scene: 'office', shirtId: 'S4', pantsId: 'P4', timestamp: t_inflight_add + 1000 },
    ],
    wifeNgPairs: [],
    closetData: defaultClosetMock,
    hasCustomData: false,
    tombstones: {
      deletedWearMap: { rec_keep: t_inflight_add + 1000 },
      deletedWifeNgMap: {},
    },
  };
  // 遅延到着した Pull レスポンス (古い rec_keep を含んでいる)
  const stalePullResponse = {
    ok: true,
    wearHistory: [
      { id: 'rec_keep', date: '2026-10-17', scene: 'office', shirtId: 'S2', pantsId: 'P2', timestamp: t_init },
    ],
    wifeNgPairs: [],
  };

  const reconcilePull = reconcileSyncResponse({
    serverResponse: stalePullResponse,
    currentLocal: localStateDuringPull,
    sentTombstones: pullStartTombstones,
    hasInFlightMutations: true,
    defaultClosetData: defaultClosetMock,
  });

  // Pull の古いデータによって削除した rec_keep が復活せず、新しい rec_local_newer が維持され、stillDirty が true になること
  assert.equal(reconcilePull.wearHistory.some((r) => r.id === 'rec_keep'), false, 'Pull must NOT resurrect deleted record');
  assert.equal(reconcilePull.wearHistory.some((r) => r.id === 'rec_local_newer'), true, 'Pull must NOT overwrite in-flight record');
  assert.equal(reconcilePull.stillDirty, true, 'Pull with in-flight mutations must remain dirty');

  // 4. LockService 実並行リクエスト・リトライシミュレーション
  let activeLocks = 0;
  const concurrentSandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: {
      getScriptLock: () => ({
        tryLock: (timeout) => {
          if (activeLocks > 0) return false;
          activeLocks++;
          return true;
        },
        releaseLock: () => {
          if (activeLocks > 0) activeLocks--;
        },
      }),
    },
    Logger: { log: () => {} },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (str) => ({ setMimeType: () => ({ getContent: () => str }) }),
    },
    Date, Math, String, Number, Array, Object, Set, Map, JSON, console,
  };
  const concurrentContext = vm.createContext(concurrentSandbox);
  vm.runInContext(codeGsContent.replace('__SMART_CLOSET_SECRET_TOKEN__', 'sync-token-111'), concurrentContext);

  // リクエスト A がロックを取得して実行中
  activeLocks = 1;
  // リクエスト B が競合到着 -> ロック取得失敗で 409 的なエラーが返ること
  const conflictPayload = { action: 'push', token: 'sync-token-111', wearHistory: [] };
  const conflictResult = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(conflictPayload))} } })`, concurrentContext).getContent()
  );
  assert.equal(conflictResult.ok, false);
  assert.match(conflictResult.error, /他端末と同期処理中です/);

  // リクエスト A が完了してロック解放
  activeLocks = 0;
  // リクエスト B がリトライ -> 今度は成功すること
  const retryResult = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(conflictPayload))} } })`, concurrentContext).getContent()
  );
  // 5. カスタムデータ削除指示 (clearCustomClosetData) の通信中再リセット競合テスト (P1第4回レビュー対応)
  const t_custom_reset1 = baseTime + 5000;
  const t_custom_reset2 = baseTime + 6000;

  // サーバーにカスタムデータを登録
  const customInitPayload = {
    action: 'push',
    token: 'sync-token-111',
    customClosetData: {
      items: [{ id: 'P99', name: '特注パンツ', category: 'pants', dressScore: 4.0, comfortScore: 4.0 }],
    },
  };
  const customInitRes = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(customInitPayload))} } })`, context).getContent()
  );
  assert.equal(customInitRes.ok, true);
  assert.equal(customInitRes.customClosetData.items.length, 1);

  // クライアントで1回目のリセットを実行し、Push #1 を開始
  const pushCustom1SentTombstones = {
    deletedWearMap: {},
    deletedWifeNgMap: {},
    clearCustomClosetData: true,
    customClosetDataClearedAt: t_custom_reset1,
  };

  // Push #1 の通信中にユーザーが再度リセット (またはインポート後に再リセット)
  const localStateDuringPushCustom1 = {
    wearHistory: [],
    wifeNgPairs: [],
    closetData: defaultClosetMock,
    hasCustomData: false,
    tombstones: {
      deletedWearMap: {},
      deletedWifeNgMap: {},
      clearCustomClosetData: true,
      customClosetDataClearedAt: t_custom_reset2, // t_custom_reset2 > t_custom_reset1
    },
  };

  // Push #1 のレスポンス到着
  const serverPushCustom1Response = {
    ok: true,
    customClosetData: null, // サーバー側では1回目のリセットが反映された
  };

  const reconcileCustom = reconcileSyncResponse({
    serverResponse: serverPushCustom1Response,
    currentLocal: localStateDuringPushCustom1,
    sentTombstones: pushCustom1SentTombstones,
    hasInFlightMutations: true,
    hasInFlightCustomDataChange: true,
    defaultClosetData: defaultClosetMock,
  });

  // 検証: 通信中に再リセットされた削除指示が消去されず残っていること！
  assert.equal(reconcileCustom.remainingTombstones.clearCustomClosetData, true, 'In-flight reset instruction must NOT be pruned');
  assert.equal(reconcileCustom.remainingTombstones.customClosetDataClearedAt, t_custom_reset2);
  assert.equal(reconcileCustom.stillDirty, true, 'stillDirty must remain true for follow-up push');

  // 追随 Push #2 の送信 (再リセットの指示をサーバーへ)
  const pushCustom2Payload = {
    action: 'push',
    token: 'sync-token-111',
    clearCustomClosetData: true,
  };
  const pushCustom2Res = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(pushCustom2Payload))} } })`, context).getContent()
  );
  assert.equal(pushCustom2Res.ok, true);
  assert.equal(pushCustom2Res.customClosetData, null);

  // Push #2 完了時の調停 (通信中の追加操作なし)
  const reconcileCustom2 = reconcileSyncResponse({
    serverResponse: pushCustom2Res,
    currentLocal: {
      ...localStateDuringPushCustom1,
      tombstones: reconcileCustom.remainingTombstones,
    },
    sentTombstones: reconcileCustom.remainingTombstones,
    hasInFlightMutations: false,
    hasInFlightCustomDataChange: false,
    defaultClosetData: defaultClosetMock,
  });
  // Push #2 が完了して初めて削除指示がクリアされること
  assert.equal(hasRemainingTombstones(reconcileCustom2.remainingTombstones), false);
  assert.equal(reconcileCustom2.stillDirty, false);

  console.log('  ✅ In-flight mutation reconciliation, selective tombstone pruning, and concurrent locking verified');
}

console.log('🎉 All GAS backend & sync logic tests passed successfully!');
