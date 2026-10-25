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

const closetDomainTsPath = path.join(projectRoot, 'src/utils/closetDomain.ts');
const closetDomainCode = fs.readFileSync(closetDomainTsPath, 'utf-8');
const transpiledDomainJs = ts.transpileModule(closetDomainCode, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const closetDomain = await import(
  'data:text/javascript;base64,' + Buffer.from(transpiledDomainJs).toString('base64')
);
const {
  validateClosetDataSchema,
  mergeClosetDataWithWifeNg,
  checkIsNgPair,
  getAffinityReason,
  calculateRecommendationsForShirt,
  getNextSequentialId,
  validateSingleClosetItem,
  mergeSingleItemIntoClosetData,
  analyzeWardrobeStats,
} = closetDomain;

console.log('🧪 Running GAS backend and sync logic tests...');

// 1. gas/Code.gs Single Source of Truth および GasSyncModal ?raw import の検証
const codeGsPath = path.join(projectRoot, 'gas/Code.gs');
const gasSyncModalPath = path.join(projectRoot, 'src/components/GasSyncModal.tsx');
const obsoleteTemplatePath = path.join(projectRoot, 'src/data/gasScriptTemplate.ts');

assert.ok(fs.existsSync(codeGsPath), 'gas/Code.gs must exist');
assert.equal(fs.existsSync(obsoleteTemplatePath), false, 'gasScriptTemplate.ts must be eliminated in favor of ?raw import');

const codeGsContent = fs.readFileSync(codeGsPath, 'utf-8');
const gasSyncModalContent = fs.readFileSync(gasSyncModalPath, 'utf-8');

assert.ok(
  gasSyncModalContent.includes("import GAS_SCRIPT_TEMPLATE from '../../gas/Code.gs?raw'"),
  'GasSyncModal.tsx must import GAS_SCRIPT_TEMPLATE directly via ?raw'
);

// clasp configuration and appsscript.json manifest validation
const appsscriptJsonPath = path.join(projectRoot, 'gas/appsscript.json');
const claspSamplePath = path.join(projectRoot, '.clasp.json.sample');

assert.ok(fs.existsSync(appsscriptJsonPath), 'gas/appsscript.json must exist');
assert.ok(fs.existsSync(claspSamplePath), '.clasp.json.sample must exist');

const appsscriptConfig = JSON.parse(fs.readFileSync(appsscriptJsonPath, 'utf-8'));
assert.equal(appsscriptConfig.runtimeVersion, 'V8', 'appsscript.json runtimeVersion must be V8');
assert.equal(appsscriptConfig.timeZone, 'Asia/Tokyo', 'appsscript.json timeZone must be Asia/Tokyo');
assert.equal(appsscriptConfig.webapp?.access, 'ANYONE_ANONYMOUS', 'appsscript.json webapp.access must be ANYONE_ANONYMOUS');
assert.equal(appsscriptConfig.webapp?.executeAs, 'USER_DEPLOYING', 'appsscript.json webapp.executeAs must be USER_DEPLOYING');

const claspSampleConfig = JSON.parse(fs.readFileSync(claspSamplePath, 'utf-8'));
assert.equal(claspSampleConfig.rootDir, './gas', '.clasp.json.sample rootDir must be ./gas');
assert.ok(claspSampleConfig.scriptId, '.clasp.json.sample must have a scriptId placeholder');

console.log('  ✅ Code.gs Single Source of Truth, clasp sample & appsscript.json verified');

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
    Utilities: {
      base64Encode: (bytes) => Buffer.from(bytes || '').toString('base64'),
      base64Decode: (str) => Buffer.from(str || '', 'base64'),
      newBlob: (bytes, contentType, name) => ({
        getBytes: () => bytes,
        getContentType: () => contentType,
        getName: () => name,
      }),
    },
    ScriptApp: {
      getOAuthToken: () => 'mock-oauth-token',
    },
    Drive: {
      Files: {
        list: () => ({ files: [] }),
      },
    },
    DriveApp: {
      getFolderById: (folderId) => ({
        getName: () => 'MockFolder_' + folderId,
        getId: () => folderId,
        getFiles: () => ({
          hasNext: () => false,
          next: () => null,
        }),
        getFilesByName: (fileName) => ({
          hasNext: () => false,
          next: () => null,
        }),
        createFile: (blob) => ({
          getId: () => 'created_file_id',
          getName: () => blob.getName(),
          getLastUpdated: () => new Date(),
        }),
      }),
      getFileById: () => ({
        getSize: () => 1024,
        getBlob: () => ({
          getContentType: () => 'image/jpeg',
          getBytes: () => Buffer.from('mock-image-bytes'),
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
// Test Case 2-B: 生 Code.gs（clasp push 想定）での fail-closed および meta_config 直接登録による認証検証
// -------------------------------------------------------------
{
  const ss = new MockSpreadsheet();
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        releaseLock: () => {},
      }),
    },
    Logger: { log: () => {} },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (str) => ({
        setMimeType: () => ({ getContent: () => str }),
      }),
    },
    Date, Math, String, Number, Array, Object, Set, Map, JSON, console,
  };
  const context = vm.createContext(sandbox);

  // トークン置換を行わず生の Code.gs で実行 (clasp push 相当)
  vm.runInContext(codeGsContent, context);
  vm.runInContext('setupSpreadsheet()', context);

  // 1. 初期状態（meta_config 未設定）: 正しい形式のトークンを送っても fail-closed で拒否される
  const unconfiguredRes = JSON.parse(
    vm.runInContext('doGet({ parameter: { token: "my-clasp-token" } })', context).getContent()
  );
  assert.equal(unconfiguredRes.ok, false);
  assert.match(unconfiguredRes.error, /認証エラー/);

  // 2. スプレッドシートの meta_config に secretToken を登録 (手動登録手順相当)
  const metaSheet = ss.getSheetByName('meta_config');
  assert.ok(metaSheet, 'meta_config sheet must exist after setupSpreadsheet');
  metaSheet.appendRow(['secretToken', 'my-clasp-token', new Date().toISOString()]);

  // 3. 不一致トークンでは拒否される
  const wrongTokenRes = JSON.parse(
    vm.runInContext('doGet({ parameter: { token: "wrong-token" } })', context).getContent()
  );
  assert.equal(wrongTokenRes.ok, false);
  assert.match(wrongTokenRes.error, /認証エラー/);

  // 4. meta_config に登録されたトークンと一致すれば認証成功する (GET & POST)
  const successGetRes = JSON.parse(
    vm.runInContext('doGet({ parameter: { token: "my-clasp-token" } })', context).getContent()
  );
  assert.equal(successGetRes.ok, true);

  const successPostRes = JSON.parse(
    vm.runInContext('doPost({ postData: { contents: JSON.stringify({ action: "push", token: "my-clasp-token" }) } })', context).getContent()
  );
  assert.equal(successPostRes.ok, true);

  console.log('  ✅ Clasp push raw Code.gs fail-closed & meta_config manual token registration verified');
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

  // 3. doGet でのロック制御検証 (マージ前改修)
  const getSuccess = JSON.parse(
    vm.runInContext('doGet({ parameter: { token: "sync-token-111" } })', context).getContent()
  );
  assert.equal(getSuccess.ok, true);
  const getLockStat = getLockStatus();
  assert.equal(getLockStat.lockTryCount, 2, 'Lock must be requested for doGet');
  assert.equal(getLockStat.lockReleaseCount, 2, 'Lock must be released after doGet');
  assert.equal(getLockStat.lockAcquired, false, 'Lock must not remain held after doGet');

  const getConflictRes = JSON.parse(
    vm.runInContext('doGet({ parameter: { token: "sync-token-111" } })', lockedContext).getContent()
  );
  assert.equal(getConflictRes.ok, false);
  assert.match(getConflictRes.error, /他端末と同期処理中です/);

  console.log('  ✅ LockService concurrency control and lock lifecycle verified (doGet & doPost)');
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
      items: [{ id: 'P16', name: '黒スラックス', category: 'pants', dressScore: 4.5, comfortScore: 4.0 }],
      updatedAt: 1000,
    },
    customClosetDataUpdatedAt: 1000,
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

  // ★重要検証 (第7回レビュー対応): タイムスタンプなしの古い削除指示 (clearCustomClosetData: true のみ) では消去されないこと
  const staleNoTsResetPayload = {
    action: 'push',
    token: 'sync-token-111',
    clearCustomClosetData: true,
  };
  const staleNoTsRes = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(staleNoTsResetPayload))} } })`, context).getContent()
  );
  assert.equal(staleNoTsRes.ok, true);
  assert.ok(staleNoTsRes.customClosetData && staleNoTsRes.customClosetData.items.length === 1, 'Custom closet data must NOT be cleared by timestamp-less reset');

  // ★正当なタイムスタンプ付きリセット (customClosetDataClearedAt: 2000 > 1000) を送った場合のみ消去されること
  const resetPayload = {
    action: 'push',
    token: 'sync-token-111',
    clearCustomClosetData: true,
    customClosetDataClearedAt: 2000,
  };
  const res3 = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(resetPayload))} } })`, context).getContent()
  );
  assert.equal(res3.ok, true);
  assert.equal(res3.customClosetData, null, 'Custom closet data must be cleared when valid timestamped clearCustomClosetData is sent');

  console.log('  ✅ Custom closet data protection, rejection of timestamp-less reset, and explicit reset verified');
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
    customClosetDataClearedAt: reconcileCustom.remainingTombstones.customClosetDataClearedAt,
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

// -------------------------------------------------------------
// Test Case 8: 別端末からの古いカスタムデータ復活防止 ＆ 正当な再インポート (P1第5回レビュー対応)
// -------------------------------------------------------------
{
  const { ss, context } = createGasEnvironment('sync-token-111');
  vm.runInContext('setupSpreadsheet()', context);

  const defaultClosetMock = { items: [] };
  const baseTime = Date.now() - 20000;
  const t0_imported = baseTime;              // 端末A・Bが共有していた古いカスタムデータの更新時刻
  const t1_deleted = baseTime + 10000;       // 端末Aがカスタムデータをリセットした時刻
  const t2_reimported = baseTime + 20000;    // 端末Aが新しいカスタムデータを正当に再インポートした時刻

  // 1. 端末 A がカスタム服データ (updatedAt: t0) をスプレッドシートに登録
  const initCustomPayload = {
    action: 'push',
    token: 'sync-token-111',
    customClosetData: {
      items: [{ id: 'P88', name: '旧カスタムパンツ', category: 'pants', dressScore: 4.0, comfortScore: 4.0 }],
      updatedAt: t0_imported,
    },
    customClosetDataUpdatedAt: t0_imported,
  };
  const initRes = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(initCustomPayload))} } })`, context).getContent()
  );
  assert.equal(initRes.ok, true);
  assert.equal(initRes.customClosetData.items.length, 1);

  // 2. 端末 A がカスタム服データをリセット (clearCustomClosetData: true, customClosetDataClearedAt: t1)
  const resetPayloadA = {
    action: 'push',
    token: 'sync-token-111',
    clearCustomClosetData: true,
    customClosetDataClearedAt: t1_deleted,
  };
  const resetResA = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(resetPayloadA))} } })`, context).getContent()
  );
  assert.equal(resetResA.ok, true);
  assert.equal(resetResA.customClosetData, null, 'Custom closet data must be cleared on server');

  // サーバー側の meta_config に customClosetDataClearedAt が永続化されていることを検証
  const savedTombstones = JSON.parse(
    vm.runInContext('readConfigValue(SpreadsheetApp.getActiveSpreadsheet(), "syncTombstones")', context)
  );
  assert.equal(savedTombstones.customClosetDataClearedAt, t1_deleted, 'customClosetDataClearedAt must be persisted in server tombstones');

  // 3. ★重要: 未同期の端末 B が古いカスタムデータ (updatedAt: t0 < t1) を保持したまま通常の Push を実行
  const stalePushPayloadB = {
    action: 'push',
    token: 'sync-token-111',
    wearHistory: [{ id: 'rec_b', date: '2026-10-18', scene: 'office', shirtId: 'S1', pantsId: 'P1', timestamp: t1_deleted + 100 }],
    customClosetData: {
      items: [{ id: 'P88', name: '旧カスタムパンツ', category: 'pants', dressScore: 4.0, comfortScore: 4.0 }],
      updatedAt: t0_imported,
    },
    customClosetDataUpdatedAt: t0_imported,
  };
  const staleResB = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(stalePushPayloadB))} } })`, context).getContent()
  );
  assert.equal(staleResB.ok, true);

  // ★重要検証: 古い端末からの再送によってカスタムデータがサーバー上で復活していないこと！
  assert.equal(staleResB.customClosetData, null, 'Stale custom closet data must NOT resurrect on server!');
  assert.equal(staleResB.customClosetDataClearedAt, t1_deleted, 'Server must return customClosetDataClearedAt to stale client');

  // 4. 端末 B 側でこのレスポンスを受信した際、端末 B のローカル状態も正しくリセットされること
  const localStateB = {
    wearHistory: stalePushPayloadB.wearHistory,
    wifeNgPairs: [],
    closetData: stalePushPayloadB.customClosetData,
    hasCustomData: true,
    tombstones: { deletedWearMap: {}, deletedWifeNgMap: {} },
  };
  const reconcileB = reconcileSyncResponse({
    serverResponse: staleResB,
    currentLocal: localStateB,
    sentTombstones: { deletedWearMap: {}, deletedWifeNgMap: {} },
    hasInFlightMutations: false,
    defaultClosetData: defaultClosetMock,
  });
  assert.equal(reconcileB.isCustomDataPresent, false, 'Client B must synchronize deletion from server');
  assert.deepEqual(reconcileB.closetData, defaultClosetMock);

  // 5. ★正当な再インポート: 削除時刻 t1 より新しい時刻 t2 に新カスタムデータをインポートして Push
  const reimportPayload = {
    action: 'push',
    token: 'sync-token-111',
    customClosetData: {
      items: [{ id: 'P100', name: '新カスタムスラックス', category: 'pants', dressScore: 4.8, comfortScore: 4.5 }],
      updatedAt: t2_reimported,
    },
    customClosetDataUpdatedAt: t2_reimported,
  };
  const reimportRes = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(reimportPayload))} } })`, context).getContent()
  );
  assert.equal(reimportRes.ok, true);
  assert.ok(reimportRes.customClosetData && reimportRes.customClosetData.items.length === 1, 'New custom closet data must be accepted');
  assert.equal(reimportRes.customClosetData.items[0].id, 'P100');

  // サーバー側 Tombstone の customClosetDataClearedAt が解除（0）されたことを確認
  const tombstonesAfterReimport = JSON.parse(
    vm.runInContext('readConfigValue(SpreadsheetApp.getActiveSpreadsheet(), "syncTombstones")', context)
  );
  assert.equal(tombstonesAfterReimport.customClosetDataClearedAt, 0, 'Tombstone must be cleared after newer reimport');

  // 5b. ★ChatGPT 第7回レビュー指摘: タイムスタンプなしの古い削除指示 (clearCustomClosetData: true) を Push しても消去されないこと
  const noTsResetPayloadB = {
    action: 'push',
    token: 'sync-token-111',
    clearCustomClosetData: true,
  };
  const noTsResetResB = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(noTsResetPayloadB))} } })`, context).getContent()
  );
  assert.equal(noTsResetResB.ok, true);
  assert.ok(noTsResetResB.customClosetData && noTsResetResB.customClosetData.items.length === 1, 'Timestamp-less deletion must NOT wipe out reimported custom data!');
  assert.equal(noTsResetResB.customClosetData.items[0].id, 'P100');

  // 6. ★ChatGPT 第6回レビュー指摘 (P1): 未同期の端末 B が古い削除指示 (t1 < t2) を保持したまま Push
  const staleResetPayloadB = {
    action: 'push',
    token: 'sync-token-111',
    wearHistory: [{ id: 'rec_b2', date: '2026-10-18', scene: 'remote', shirtId: 'S2', pantsId: 'P2', timestamp: t1_deleted + 200 }],
    clearCustomClosetData: true,
    customClosetDataClearedAt: t1_deleted,
  };
  const staleResetResB = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(staleResetPayloadB))} } })`, context).getContent()
  );
  assert.equal(staleResetResB.ok, true);
  // ★重要検証: 端末Aが t2 で再インポートした新データが、端末Bの古い削除指示 (t1) によって消去されていないこと！
  assert.ok(staleResetResB.customClosetData && staleResetResB.customClosetData.items.length === 1, 'Stale reset instruction must NOT wipe out newer reimported custom data!');
  assert.equal(staleResetResB.customClosetData.items[0].id, 'P100');
  const tombstonesAfterStaleReset = JSON.parse(
    vm.runInContext('readConfigValue(SpreadsheetApp.getActiveSpreadsheet(), "syncTombstones")', context)
  );
  assert.equal(tombstonesAfterStaleReset.customClosetDataClearedAt, 0, 'Server tombstone must remain 0 after ignoring stale deletion');

  // 7. ★正当な追随削除: 新データ (t2) より新しい時刻 t3 に削除指示が Push された場合は消去されること
  const t3_newer_delete = t2_reimported + 10000;
  const newerResetPayloadB = {
    action: 'push',
    token: 'sync-token-111',
    clearCustomClosetData: true,
    customClosetDataClearedAt: t3_newer_delete,
  };
  const newerResetResB = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(newerResetPayloadB))} } })`, context).getContent()
  );
  assert.equal(newerResetResB.ok, true);
  assert.equal(newerResetResB.customClosetData, null, 'Newer deletion instruction must wipe custom data');
  assert.equal(newerResetResB.customClosetDataClearedAt, t3_newer_delete, 'Server must return newer deletion timestamp');
  const tombstonesAfterNewerReset = JSON.parse(
    vm.runInContext('readConfigValue(SpreadsheetApp.getActiveSpreadsheet(), "syncTombstones")', context)
  );
  assert.equal(tombstonesAfterNewerReset.customClosetDataClearedAt, t3_newer_delete);

  console.log('  ✅ Stale custom closet data resurrection prevention, valid re-import, and stale deletion rejection verified');
}

// -------------------------------------------------------------
// Test Case 9: 配列フォールバックによるタイムスタンプ昇格防止 ＆ 同日着用上書きTombstone (横断監査対応)
// -------------------------------------------------------------
{
  const { ss, context } = createGasEnvironment('sync-token-222');
  vm.runInContext('setupSpreadsheet()', context);

  const baseTime = Date.now() - 30000;
  const t1_deleted = baseTime;
  const t2_readded = baseTime + 10000;

  // 1. 端末 A が奥様NG S1_P2 を再登録 (t2 > t1) して Push
  const readdPayloadA = {
    action: 'push',
    token: 'sync-token-222',
    wifeNgPairs: [{ shirtId: 'S1', pantsId: 'P2', reason: '再登録NG', createdAt: new Date(t2_readded).toISOString() }],
  };
  const readdResA = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(readdPayloadA))} } })`, context).getContent()
  );
  assert.equal(readdResA.ok, true);
  assert.equal(readdResA.wifeNgPairs.length, 1);

  // 2. 端末 B がオンライン復帰し、deletedWifeNgMap (t1) と deletedWifeNgKeys の両方を送信
  // （後方互換配列処理が t1 を now に昇格させて端末Aの再登録 t2 を消去しないことの検証）
  const stalePushPayloadB = {
    action: 'push',
    token: 'sync-token-222',
    deletedWifeNgMap: { 'S1_P2': t1_deleted },
    deletedWifeNgKeys: ['S1_P2'],
  };
  const staleResB = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(stalePushPayloadB))} } })`, context).getContent()
  );
  assert.equal(staleResB.ok, true);
  assert.equal(staleResB.wifeNgPairs.length, 1, 'Re-added wifeNg pair must NOT be deleted by stale tombstone with array fallback');
  assert.equal(staleResB.wifeNgPairs[0].shirtId, 'S1');
  assert.equal(staleResB.wifeNgPairs[0].pantsId, 'P2');

  // 2b. タイムスタンプなしの deletedWifeNgKeys のみを送信しても、端末Aの再登録 t2 が消去されないこと
  const noTsPushPayload = {
    action: 'push',
    token: 'sync-token-222',
    deletedWifeNgKeys: ['S1_P2'],
  };
  const noTsRes = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(noTsPushPayload))} } })`, context).getContent()
  );
  assert.equal(noTsRes.ok, true);
  assert.equal(noTsRes.wifeNgPairs.length, 1, 'Re-added wifeNg pair must NOT be deleted by timestamp-less deletedWifeNgKeys');

  // 2c. スプレッドシートに手動追加された登録日時なしの奥様NGペアが、現在時刻に補完されず、
  // タイムスタンプ付きの deletedWifeNgMap で正常に削除できることの検証
  const ngSheet = ss.getSheetByName('wife_ng');
  ngSheet.appendRow(['S5', '柄シャツ', 'P10', 'チェックパンツ', '手動追加NG', '']); // 登録日時が空
  const pullResManual = JSON.parse(
    vm.runInContext('doGet({ parameter: { token: "sync-token-222" } })', context).getContent()
  );
  assert.equal(pullResManual.ok, true);
  const manualPair = pullResManual.wifeNgPairs.find(p => p.shirtId === 'S5' && p.pantsId === 'P10');
  assert.ok(manualPair, 'Manual pair without createdAt must be read');
  assert.equal(manualPair.createdAt, '', 'Empty createdAt must remain empty, NOT synthesized to Date.now');

  // クライアントから S5_P10 の削除を Push -> createdAt が空（時刻0）なので正常に削除されること
  const deleteManualPayload = {
    action: 'push',
    token: 'sync-token-222',
    deletedWifeNgMap: { 'S5_P10': Date.now() },
  };
  const deleteManualRes = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(deleteManualPayload))} } })`, context).getContent()
  );
  assert.equal(deleteManualRes.ok, true);
  assert.equal(deleteManualRes.wifeNgPairs.some(p => p.shirtId === 'S5' && p.pantsId === 'P10'), false, 'Manual pair must be successfully deleted');

  // 3. 同日着用履歴の置換とTombstone検証
  const t0_wear = baseTime - 5000;
  const t1_wear_replace = baseTime;
  const t2_wear_delete = baseTime + 5000;

  // 初期状態: rec_old (t0) を登録
  const initWearPayload = {
    action: 'push',
    token: 'sync-token-222',
    wearHistory: [
      { id: '2026-10-18_old', date: '2026-10-18', scene: 'office', shirtId: 'S1', pantsId: 'P1', timestamp: t0_wear }
    ],
  };
  vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(initWearPayload))} } })`, context);

  // rec_new (t1) で上書き
  const wearReplacePayload = {
    action: 'push',
    token: 'sync-token-222',
    wearHistory: [
      { id: '2026-10-18_new', date: '2026-10-18', scene: 'office', shirtId: 'S2', pantsId: 'P2', timestamp: t1_wear_replace }
    ],
  };
  const wearReplaceRes = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(wearReplacePayload))} } })`, context).getContent()
  );
  assert.equal(wearReplaceRes.ok, true);
  assert.equal(wearReplaceRes.wearHistory[0].id, '2026-10-18_new');

  // サーバー側 Tombstone に rec_old が記録されたことを確認
  const tombstonesAfterReplace = JSON.parse(
    vm.runInContext('readConfigValue(SpreadsheetApp.getActiveSpreadsheet(), "syncTombstones")', context)
  );
  assert.ok(tombstonesAfterReplace.deletedWearMap['2026-10-18_old'] >= t1_wear_replace);

  // rec_new を削除 (t2)
  const wearDeletePayload = {
    action: 'push',
    token: 'sync-token-222',
    deletedWearMap: { '2026-10-18_new': t2_wear_delete },
    deletedWearIds: ['2026-10-18_new'],
  };
  const wearDeleteRes = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(wearDeletePayload))} } })`, context).getContent()
  );
  assert.equal(wearDeleteRes.ok, true);
  assert.equal(wearDeleteRes.wearHistory.length, 0);

  // 別端末から古い rec_old (t0) を Push しても復活しないこと！
  const staleOldWearPayload = {
    action: 'push',
    token: 'sync-token-222',
    wearHistory: [
      { id: '2026-10-18_old', date: '2026-10-18', scene: 'office', shirtId: 'S1', pantsId: 'P1', timestamp: t0_wear }
    ],
  };
  const staleOldRes = JSON.parse(
    vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(staleOldWearPayload))} } })`, context).getContent()
  );
  assert.equal(staleOldRes.ok, true);
  assert.equal(staleOldRes.wearHistory.length, 0, 'Replaced old wear record must NOT resurrect after newer record is deleted');

  console.log('  ✅ Array fallback timestamp preservation and superseded wear record safety verified');
}

// -------------------------------------------------------------
// Test Case 10: クライアント側 reconcileSyncResponse LWW 調停 (横断監査対応)
// -------------------------------------------------------------
{
  const defaultClosetMock = { items: [] };
  const baseTime = Date.now() - 10000;

  // 1. ローカルに古い削除 Tombstone (t1) が残っている状態で、サーバーから新しいカスタムデータ (t2 > t1) を受信
  const t1_local_del = baseTime;
  const t2_server_upd = baseTime + 5000;

  const localWithStaleDelete = {
    wearHistory: [],
    wifeNgPairs: [],
    closetData: defaultClosetMock,
    hasCustomData: false,
    tombstones: {
      deletedWearMap: {},
      deletedWifeNgMap: {},
      clearCustomClosetData: true,
      customClosetDataClearedAt: t1_local_del,
    },
  };

  const serverResponseWithNewCustom = {
    ok: true,
    wearHistory: [],
    wifeNgPairs: [],
    customClosetData: {
      items: [{ id: 'P99', name: '新カスタム', category: 'pants', dressScore: 4.0, comfortScore: 4.0 }],
      updatedAt: t2_server_upd,
    },
    tombstones: { deletedWearMap: {}, deletedWifeNgMap: {} },
  };

  const reconciled = reconcileSyncResponse({
    serverResponse: serverResponseWithNewCustom,
    currentLocal: localWithStaleDelete,
    sentTombstones: { deletedWearMap: {}, deletedWifeNgMap: {} },
    hasInFlightMutations: true,
    hasInFlightCustomDataChange: false,
    defaultClosetData: defaultClosetMock,
  });

  assert.equal(reconciled.isCustomDataPresent, true, 'Server newer custom data must win over local stale delete');
  assert.equal(reconciled.closetData.items[0].id, 'P99');
  assert.equal(reconciled.remainingTombstones.clearCustomClosetData, undefined, 'Stale local delete tombstone must be pruned');

  // 2. 逆にローカルに未送信の新しいカスタムデータ (t3) がある場合、サーバーの古いデータ (t2) に上書きされないこと
  const t3_local_upd = t2_server_upd + 5000;
  const localWithNewCustom = {
    wearHistory: [],
    wifeNgPairs: [],
    closetData: {
      items: [{ id: 'P101', name: 'ローカル最新カスタム', category: 'pants', dressScore: 5.0, comfortScore: 5.0 }],
      updatedAt: t3_local_upd,
    },
    hasCustomData: true,
    tombstones: { deletedWearMap: {}, deletedWifeNgMap: {} },
  };

  const reconciledLocalWins = reconcileSyncResponse({
    serverResponse: serverResponseWithNewCustom,
    currentLocal: localWithNewCustom,
    sentTombstones: { deletedWearMap: {}, deletedWifeNgMap: {} },
    hasInFlightMutations: true,
    hasInFlightCustomDataChange: false,
    defaultClosetData: defaultClosetMock,
  });

  assert.equal(reconciledLocalWins.isCustomDataPresent, true);
  assert.equal(reconciledLocalWins.closetData.items[0].id, 'P101', 'Local newer custom data must NOT be overwritten by older server data');

  console.log('  ✅ Client reconcileSyncResponse LWW resolution verified');
}

// -------------------------------------------------------------
// Test Case 12: Google ドライブ画像同期 (getImageSyncPlan & fetchImages)
// -------------------------------------------------------------
{
  const token = 'token-img-sync-test';
  const { ss, context } = createGasEnvironment(token);
  vm.runInContext('setupSpreadsheet()', context);

  // 1. フォルダID未登録時のエラーハンドリング
  const noFolderReq = {
    postData: {
      contents: JSON.stringify({
        token,
        action: 'getImageSyncPlan',
        localMeta: {},
      }),
    },
  };
  context.mockReqNoFolder = noFolderReq;
  const noFolderRes = JSON.parse(vm.runInContext('doPost(mockReqNoFolder).getContent()', context));
  assert.equal(noFolderRes.ok, false);
  assert.ok(noFolderRes.error.includes('画像フォルダ ID'));

  // 2. folderId の登録 (Push経由)
  const pushFolderReq = {
    postData: {
      contents: JSON.stringify({
        token,
        action: 'push',
        imageFolderId: 'folder-12345',
      }),
    },
  };
  context.mockPushFolder = pushFolderReq;
  const pushRes = JSON.parse(vm.runInContext('doPost(mockPushFolder).getContent()', context));
  assert.equal(pushRes.ok, true);
  assert.equal(pushRes.imageFolderId, 'folder-12345');

  // 3. Drive API のレスポンスをモック（同名ファイル・大文字小文字・HEIC除外）
  const t_old = 1700000000000;
  const t_new = 1700005000000;
  let passedQuery = '';

  context.Drive = {
    Files: {
      list: (params) => {
        passedQuery = params.q;
        if (params.pageSize === 1) {
          // 超軽量メタチェック用
          return { files: [{ modifiedTime: new Date(t_new).toISOString() }] };
        }
        return {
          files: [
            { id: 'f1_old', name: 's1.jpg', modifiedTime: new Date(t_old).toISOString(), size: 50000 },
            { id: 'f1_new', name: 'S1.JPG', modifiedTime: new Date(t_new).toISOString(), size: 60000, thumbnailLink: 'https://lh3.googleusercontent.com/d/xxx=s220' },
            { id: 'f2', name: 'p2.png', modifiedTime: new Date(t_new).toISOString(), size: 80000 },
            { id: 'f3', name: 'p3.heic', modifiedTime: new Date(t_new).toISOString(), size: 100000 }, // HEIC (除外されるべき)
            { id: 'f_huge', name: 'P4.jpg', modifiedTime: new Date(t_new).toISOString(), size: 3 * 1024 * 1024 }, // 2MB超過
          ],
        };
      },
    },
  };

  // 4. getImageSyncPlan の実行
  const planReq = {
    postData: {
      contents: JSON.stringify({
        token,
        action: 'getImageSyncPlan',
        localMeta: {
          S1: t_new, // 既に最新を持っている
          P2: t_old, // 古いものを持っている (更新必要)
        },
      }),
    },
  };
  context.mockPlanReq = planReq;
  const planRes = JSON.parse(vm.runInContext('doPost(mockPlanReq).getContent()', context));
  assert.equal(planRes.ok, true);
  assert.ok(passedQuery.includes('trashed = false'), 'Drive search query must include trashed = false');
  
  // validItemIds: S1, P2, P4 (HEIC は除外、IDは大文字正規化)
  assert.deepEqual(planRes.validItemIds, ['P2', 'P4', 'S1']);
  // neededItemIds: P2 (更新差分) と P4 (新規差分)、S1 はすでに最新なので不要
  assert.deepEqual(planRes.neededItemIds, ['P2', 'P4']);
  // HEIC 形式に対する警告が含まれていること (指摘B)
  assert.ok(planRes.warnings && planRes.warnings.some((w) => w.includes('p3.heic')), 'Warning for HEIC format must be returned');

  // 5. fetchImages の実行
  context.DriveApp = {
    getFileById: (id) => ({
      getSize: () => (id === 'f_huge' ? 3 * 1024 * 1024 : 10000),
      getBlob: () => ({
        getContentType: () => 'image/jpeg',
        getBytes: () => Buffer.from('mock-bytes-data'),
      }),
    }),
  };

  const fetchReq = {
    postData: {
      contents: JSON.stringify({
        token,
        action: 'fetchImages',
        itemIds: ['P2', 'P4'],
      }),
    },
  };
  context.mockFetchReq = fetchReq;
  const fetchRes = JSON.parse(vm.runInContext('doPost(mockFetchReq).getContent()', context));
  assert.equal(fetchRes.ok, true);
  assert.ok(fetchRes.images['P2'], 'P2 must be fetched as Base64 data URL');
  assert.equal(fetchRes.images['P4'], undefined, 'P4 exceeds 2MB and must be skipped');
  assert.ok(fetchRes.warnings.some((w) => w.includes('2MB')), 'Warning for 2MB limit must be recorded');

  console.log('  ✅ Google Drive image sync (plan, trashed=false, diff & fetch) verified');

  // 6. 回帰テスト: フォルダ切替＋アイテム単位取得失敗時の残存防止と再取得保証
  // (a) 初期状態: フォルダAで S1 と P4 を同期済み (P4 には旧フォルダAの画像が存在する)
  let currentSyncedFolderId = 'folder-A';
  let localImages = {
    S1: 'data:image/jpeg;base64,blob_A_s1',
    P4: 'data:image/jpeg;base64,blob_A_p4_old', // 旧フォルダの画像
  };
  let localMeta = {
    S1: t_new,
    P4: t_new,
  };

  // (b) フォルダBへの切替をシミュレート
  const targetFolderId = 'folder-B';
  const isDifferentFolder = Boolean(currentSyncedFolderId && currentSyncedFolderId !== targetFolderId);
  assert.equal(isDifferentFolder, true, 'isDifferentFolder must be true');

  // フォルダ切替時は localMeta を空にしてプラン要求
  const planLocalMeta = isDifferentFolder ? {} : localMeta;
  assert.deepEqual(planLocalMeta, {}, 'localMeta must be empty on folder change');

  const switchPlanReq = {
    postData: {
      contents: JSON.stringify({
        token,
        action: 'getImageSyncPlan',
        imageFolderId: targetFolderId,
        localMeta: planLocalMeta,
      }),
    },
  };
  context.mockSwitchPlanReq = switchPlanReq;
  const switchPlanRes = JSON.parse(vm.runInContext('doPost(mockSwitchPlanReq).getContent()', context));
  assert.equal(switchPlanRes.ok, true);
  assert.ok(switchPlanRes.validItemIds.includes('P4'), 'P4 must be in validItemIds of folder-B');
  assert.ok(switchPlanRes.neededItemIds.includes('P4'), 'P4 must be in neededItemIds');

  // 【最重要判断ロジック】
  // isDifferentFolder かつ validItemIds.length > 0 の場合、チャンク取得前に端末キャッシュを先行クリア
  if (isDifferentFolder && switchPlanRes.validItemIds.length > 0) {
    localImages = {};
    localMeta = {};
  }
  // この時点で旧フォルダの P4 画像は完全に消去されていること
  assert.equal(localImages['P4'], undefined, 'Old P4 image must be cleared before chunk fetch');

  // (c) チャンク取得実行: フォルダBでは S1 は成功するが、P4 は 2MB 超過で取得失敗
  const fetchChunkReq = {
    postData: {
      contents: JSON.stringify({
        token,
        action: 'fetchImages',
        imageFolderId: targetFolderId,
        itemIds: switchPlanRes.neededItemIds, // ['P2', 'P4', 'S1']
      }),
    },
  };
  context.mockFetchChunkReq = fetchChunkReq;
  const fetchChunkRes = JSON.parse(vm.runInContext('doPost(mockFetchChunkReq).getContent()', context));
  assert.equal(fetchChunkRes.ok, true);
  // P2, S1 は成功、P4 は 2MB 超過で失敗
  assert.ok(fetchChunkRes.images['S1']);
  assert.equal(fetchChunkRes.images['P4'], undefined, 'P4 must fail due to 2MB limit in folder-B');

  // 取得成功したアイテムのみ localImages, localMeta に保存
  for (const [id, dataUrl] of Object.entries(fetchChunkRes.images)) {
    localImages[id] = dataUrl;
    localMeta[id] = fetchChunkRes.timestamps[id];
  }
  // 同期成功後に syncedFolderId を更新
  currentSyncedFolderId = targetFolderId;

  // 【検証 1】取得失敗した P4 に旧フォルダAの画像が残っていないこと（SVG表示になる）
  assert.equal(localImages['P4'], undefined, 'P4 must NOT retain old folder image; must be undefined (SVG fallback)');
  // 【検証 2】P4 のタイムスタンプが localMeta に存在しないこと（未取得扱い）
  assert.equal(localMeta['P4'], undefined, 'P4 must NOT be in localMeta (treated as unacquired)');

  // (d) 次回同期 (同一 folder-B での再同期) の検証
  // P4 がサイズ修正されたり再試行される場合の挙動
  const isDifferentFolder2 = Boolean(currentSyncedFolderId && currentSyncedFolderId !== targetFolderId);
  assert.equal(isDifferentFolder2, false, 'Subsequent sync is same folder');
  const nextPlanLocalMeta = isDifferentFolder2 ? {} : localMeta;
  assert.ok(nextPlanLocalMeta['S1'], 'S1 has localMeta');
  assert.equal(nextPlanLocalMeta['P4'], undefined, 'P4 does not have localMeta');

  const retryPlanReq = {
    postData: {
      contents: JSON.stringify({
        token,
        action: 'getImageSyncPlan',
        imageFolderId: targetFolderId,
        localMeta: nextPlanLocalMeta,
      }),
    },
  };
  context.mockRetryPlanReq = retryPlanReq;
  const retryPlanRes = JSON.parse(vm.runInContext('doPost(mockRetryPlanReq).getContent()', context));
  assert.equal(retryPlanRes.ok, true);
  // S1 は取得済みなので neededItemIds に入らない
  assert.equal(retryPlanRes.neededItemIds.includes('S1'), false, 'S1 already acquired, must not be in neededItemIds');
  // 未取得の P4 は次回同期で自動的に neededItemIds に含まれること！
  assert.ok(retryPlanRes.neededItemIds.includes('P4'), 'Unacquired P4 must be automatically re-targeted in next sync');

  console.log('  ✅ Regression test: Folder switch with partial failure leaves no stale image & retries verified');
}

// -------------------------------------------------------------
// Test Case 13: Cloudflare Pages Function bootstrap-config.ts 単体テスト
// -------------------------------------------------------------
{
  const bootstrapTsPath = path.join(projectRoot, 'functions/api/bootstrap-config.ts');
  assert.ok(fs.existsSync(bootstrapTsPath), 'functions/api/bootstrap-config.ts must exist');

  const bootstrapCode = fs.readFileSync(bootstrapTsPath, 'utf-8');
  const transpiledBootstrap = ts.transpileModule(bootstrapCode, {
    compilerOptions: { module: ts.ModuleKind.ESNext },
  }).outputText;
  const { onRequestGet } = await import(
    'data:text/javascript;base64,' + Buffer.from(transpiledBootstrap).toString('base64')
  );

  const validUrl = 'https://script.google.com/macros/s/AKfycb_sample/exec';
  const validToken = 'sc_testtoken12345';
  const allowedEmails = 'tahosook@gmail.com,family@example.com';

  // 1. 環境変数未設定（Preview環境想定など） -> 404
  const resMissingEnv = await onRequestGet({
    request: new Request('https://smart-closet-djw.pages.dev/api/bootstrap-config', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'tahosook@gmail.com' },
    }),
    env: { GAS_WEB_APP_URL: validUrl }, // token, allowedEmails が欠落
  });
  assert.equal(resMissingEnv.status, 404);
  const dataMissingEnv = await resMissingEnv.json();
  assert.equal(dataMissingEnv.ok, false);
  assert.ok(resMissingEnv.headers.get('Cache-Control')?.includes('no-store'));

  // 1b. URLが https://script.google.com/ で始まらない場合 -> 404
  const resBadUrl = await onRequestGet({
    request: new Request('https://smart-closet-djw.pages.dev/api/bootstrap-config', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'tahosook@gmail.com' },
    }),
    env: {
      GAS_WEB_APP_URL: 'https://evil.example.com/exec',
      GAS_SECRET_TOKEN: validToken,
      ALLOWED_EMAILS: allowedEmails,
    },
  });
  assert.equal(resBadUrl.status, 404);

  // 2. メールヘッダー欠如（Cookie があってもヘッダーが無い場合は拒否） -> 401
  const resNoEmailHeader = await onRequestGet({
    request: new Request('https://smart-closet-djw.pages.dev/api/bootstrap-config', {
      headers: { Cookie: 'CF_Authorization=sample_jwt_cookie' },
    }),
    env: {
      GAS_WEB_APP_URL: validUrl,
      GAS_SECRET_TOKEN: validToken,
      ALLOWED_EMAILS: allowedEmails,
    },
  });
  assert.equal(resNoEmailHeader.status, 401);
  const dataNoEmail = await resNoEmailHeader.json();
  assert.equal(dataNoEmail.ok, false);
  assert.match(dataNoEmail.error, /Cf-Access-Authenticated-User-Email/);

  // 3. ALLOWED_EMAILS に含まれないメールアドレス -> 403
  const resForbidden = await onRequestGet({
    request: new Request('https://smart-closet-djw.pages.dev/api/bootstrap-config', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'unauthorized@example.com' },
    }),
    env: {
      GAS_WEB_APP_URL: validUrl,
      GAS_SECRET_TOKEN: validToken,
      ALLOWED_EMAILS: allowedEmails,
    },
  });
  assert.equal(resForbidden.status, 403);
  const dataForbidden = await resForbidden.json();
  assert.equal(dataForbidden.ok, false);

  // 4. 許可メールアドレス（大文字小文字不問） -> 200 + no-store + 設定JSON
  const resSuccess = await onRequestGet({
    request: new Request('https://smart-closet-djw.pages.dev/api/bootstrap-config', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'TAHOSOOK@GMAIL.COM' },
    }),
    env: {
      GAS_WEB_APP_URL: validUrl,
      GAS_SECRET_TOKEN: validToken,
      ALLOWED_EMAILS: allowedEmails,
    },
  });
  assert.equal(resSuccess.status, 200);
  assert.ok(resSuccess.headers.get('Cache-Control')?.includes('no-store'));
  const dataSuccess = await resSuccess.json();
  assert.equal(dataSuccess.ok, true);
  assert.equal(dataSuccess.webAppUrl, validUrl);
  assert.equal(dataSuccess.secretToken, validToken);
  assert.equal(dataSuccess.userEmail, 'tahosook@gmail.com');

  // 5. 複数許可メールの2番目（family@example.com） -> 200
  const resFamilySuccess = await onRequestGet({
    request: new Request('https://smart-closet-djw.pages.dev/api/bootstrap-config', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'family@example.com' },
    }),
    env: {
      GAS_WEB_APP_URL: validUrl,
      GAS_SECRET_TOKEN: validToken,
      ALLOWED_EMAILS: allowedEmails,
    },
  });
  assert.equal(resFamilySuccess.status, 200);
  const dataFamilySuccess = await resFamilySuccess.json();
  assert.equal(dataFamilySuccess.ok, true);

  console.log('  ✅ Cloudflare Pages Function bootstrap-config.ts (404/401/403/200 & no-store) verified');
}

// -------------------------------------------------------------
// Test Case 14: ブートストラップ発火条件判定と GAS 初回 Pull による imageFolderId 自動同期
// -------------------------------------------------------------
{
  // 1. ブートストラップ発火条件の判定ロジック検証
  const shouldBootstrap = (cfg) => {
    return !cfg.webAppUrl?.trim() || !cfg.secretToken?.trim();
  };

  assert.equal(shouldBootstrap({ webAppUrl: '', secretToken: '' }), true, 'Both empty must trigger');
  assert.equal(shouldBootstrap({ webAppUrl: '', secretToken: 'sc_token' }), true, 'Url empty must trigger');
  assert.equal(shouldBootstrap({ webAppUrl: 'https://...', secretToken: '' }), true, 'Token empty must trigger');
  assert.equal(shouldBootstrap({ webAppUrl: '   ', secretToken: '  ' }), true, 'Whitespace must trigger');
  assert.equal(shouldBootstrap({ webAppUrl: 'https://script.google.com/...', secretToken: 'sc_token' }), false, 'Both set must NOT trigger');

  // 1b. ペア置換ロジックの検証（レビュー指摘対応: 空URL+ローカル自動生成トークン保持端末での対不一致防止）
  const resolveBootstrapConfig = (prev, data, onlyFillMissing) => {
    const isPairIncomplete = !prev.webAppUrl?.trim() || !prev.secretToken?.trim();
    const shouldReplace = !onlyFillMissing || isPairIncomplete;
    const nextUrl = shouldReplace ? data.webAppUrl : prev.webAppUrl;
    const nextToken = shouldReplace ? data.secretToken : (prev.secretToken ?? '');
    return { webAppUrl: nextUrl, secretToken: nextToken };
  };

  const cloudData = { webAppUrl: 'https://script.google.com/.../exec', secretToken: 'sc_cloud_secret' };
  // ケースA: 旧端末で URL は空だがローカル生成トークンだけがある場合 -> 両方クラウド値に置換されること
  const migrated = resolveBootstrapConfig({ webAppUrl: '', secretToken: 'sc_old_local_token' }, cloudData, true);
  assert.equal(migrated.webAppUrl, cloudData.webAppUrl);
  assert.equal(migrated.secretToken, cloudData.secretToken, 'Stale local token must be replaced by cloud token when URL is missing');

  // ケースB: 完全に手動設定済みのペアがある場合 (onlyFillMissing: true) -> 既存値が維持されること
  const existingPair = { webAppUrl: 'https://custom.gas.url', secretToken: 'sc_custom_token' };
  const preserved = resolveBootstrapConfig(existingPair, cloudData, true);
  assert.equal(preserved.webAppUrl, existingPair.webAppUrl);
  assert.equal(preserved.secretToken, existingPair.secretToken);

  // ケースC: 手動再取得ボタン押下時 (onlyFillMissing: false) -> 強制的にクラウド値へ更新されること
  const refreshed = resolveBootstrapConfig(existingPair, cloudData, false);
  assert.equal(refreshed.webAppUrl, cloudData.webAppUrl);
  assert.equal(refreshed.secretToken, cloudData.secretToken);

  // 2. ブートストラップで取得した設定から GAS 初回 Pull で meta_config の imageFolderId を自動取得する検証
  const bootstrappedToken = 'sync-token-bootstrap-test';
  const { ss, context } = createGasEnvironment(bootstrappedToken);
  vm.runInContext('setupSpreadsheet()', context);

  // サーバー側の meta_config に imageFolderId を登録 (正本)
  const metaSheet = ss.getSheetByName('meta_config');
  metaSheet.appendRow(['imageFolderId', 'drive-folder-server-ssot', new Date().toISOString()]);

  // クライアントがブートストラップしたトークンで Pull (doGet) を実行
  const pullReq = { parameter: { token: bootstrappedToken, action: 'pull' } };
  context.mockPullReq = pullReq;
  const pullRes = JSON.parse(vm.runInContext('doGet(mockPullReq).getContent()', context));

  assert.equal(pullRes.ok, true);
  assert.equal(pullRes.imageFolderId, 'drive-folder-server-ssot', 'Pull response must contain imageFolderId from meta_config SSOT');

  // クライアント側で gasConfig を更新するシミュレーション
  let localGasConfig = {
    webAppUrl: 'https://script.google.com/macros/s/test/exec',
    secretToken: bootstrappedToken,
    autoSync: true,
    imageFolderId: undefined,
  };

  localGasConfig = {
    ...localGasConfig,
    imageFolderId: pullRes.imageFolderId !== undefined ? pullRes.imageFolderId : localGasConfig.imageFolderId,
  };

  assert.equal(localGasConfig.imageFolderId, 'drive-folder-server-ssot', 'localGasConfig must be automatically updated with imageFolderId');

  console.log('  ✅ Bootstrap trigger condition & imageFolderId SSOT sync verified');
}

// -------------------------------------------------------------
// 17. ドメインロジック & ランタイムバリデータの単体テスト
// -------------------------------------------------------------
{
  const rawCloset = JSON.parse(fs.readFileSync(path.join(projectRoot, 'src/data/closet.json'), 'utf-8'));

  // 1. 正常なマスターデータの検証
  const validRes = validateClosetDataSchema(rawCloset);
  assert.equal(validRes.valid, true, 'Original closet.json must pass validateClosetDataSchema');
  assert.ok(validRes.data && validRes.data.items.length === 24, 'Validated items must match 24');

  // 2. 欠落・型不正の拒否検証 (ChatGPT & Grok 2 指摘事項含む)
  // 2a. items が配列でない / 空
  assert.equal(validateClosetDataSchema({ items: 'not-array' }).valid, false);
  assert.equal(validateClosetDataSchema({ items: [] }).valid, false);

  // 2b. updatedAt が非数値
  assert.equal(validateClosetDataSchema({ items: rawCloset.items, updatedAt: 'not-a-number' }).valid, false);

  // 2c. imageUrl が欠落 / 非文字列
  const missingImageUrl = JSON.parse(JSON.stringify(rawCloset));
  delete missingImageUrl.items[0].imageUrl;
  assert.equal(validateClosetDataSchema(missingImageUrl).valid, false);
  missingImageUrl.items[0].imageUrl = {};
  assert.equal(validateClosetDataSchema(missingImageUrl).valid, false);

  // 2d. notes が欠落 / 非文字列
  const missingNotes = JSON.parse(JSON.stringify(rawCloset));
  delete missingNotes.items[0].notes;
  assert.equal(validateClosetDataSchema(missingNotes).valid, false);
  missingNotes.items[0].notes = null;
  assert.equal(validateClosetDataSchema(missingNotes).valid, false);

  // 2e. スコアが不正 (1.0 - 5.0 範囲外 / 文字列)
  const invalidScore = JSON.parse(JSON.stringify(rawCloset));
  invalidScore.items[0].dressScore = 6.0;
  assert.equal(validateClosetDataSchema(invalidScore).valid, false);
  invalidScore.items[0].dressScore = '4.5';
  assert.equal(validateClosetDataSchema(invalidScore).valid, false);

  // 2f. 配列要素が文字列でない
  const invalidArrayEl = JSON.parse(JSON.stringify(rawCloset));
  invalidArrayEl.items[0].ngIds = [123];
  assert.equal(validateClosetDataSchema(invalidArrayEl).valid, false);

  // 2g. 存在しない ID の参照
  const nonExistentRef = JSON.parse(JSON.stringify(rawCloset));
  nonExistentRef.items[0].officeRecommendIds.push('P999');
  assert.equal(validateClosetDataSchema(nonExistentRef).valid, false);

  // 2h. 推薦と NG の重複矛盾
  const conflictItem = JSON.parse(JSON.stringify(rawCloset));
  conflictItem.items[0].ngIds.push(conflictItem.items[0].officeRecommendIds[0]);
  assert.equal(validateClosetDataSchema(conflictItem).valid, false);

  // 3. 推薦・冷却スコアリングロジック (calculateRecommendationsForShirt)
  const itemMap = new Map();
  rawCloset.items.forEach((item) => itemMap.set(item.id, item));
  const pants = rawCloset.items.filter((item) => item.category === 'pants');

  // 3a. オフィス出社モードでのスウェット・ジョガー除外 (dressScore < 3.0)
  const officeRecs = calculateRecommendationsForShirt('S2', 'office', itemMap, pants, [], new Set());
  const sweatPantsIds = ['P2', 'P4', 'P13', 'P14', 'P15'];
  for (const sweatId of sweatPantsIds) {
    const isRecommended = officeRecs.recommended.some((r) => r.pants.id === sweatId);
    const isOtherOk = officeRecs.otherOk.some((r) => r.pants.id === sweatId);
    assert.equal(isRecommended, false, `Sweatpants ${sweatId} must NOT be in recommended for office`);
    assert.equal(isOtherOk, false, `Sweatpants ${sweatId} must NOT be in otherOk for office`);
    assert.ok(officeRecs.ngList.some((n) => n.pants.id === sweatId), `Sweatpants ${sweatId} must be in ngList for office`);
  }

  // 3b. 昨日着用パンツ（冷却中）の末尾降格
  const yesterdayWorn = new Set(['P8']); // P8 は S2 のオフィス第1候補
  const coolingRecs = calculateRecommendationsForShirt('S2', 'office', itemMap, pants, [], yesterdayWorn);
  const p8Rec = coolingRecs.recommended.find((r) => r.pants.id === 'P8');
  assert.ok(p8Rec, 'P8 must still be in recommended list');
  assert.equal(p8Rec.isYesterdayWorn, true, 'P8 must be marked as isYesterdayWorn');
  // 昨日着用でない推薦パンツが P8 より上位にあること
  const topRec = coolingRecs.recommended[0];
  assert.equal(topRec.isYesterdayWorn, false, 'Top recommendation must not be yesterday worn pants');
  assert.ok(p8Rec.rank > topRec.rank, 'Yesterday worn pants must be demoted in rank');

  // 3c. 奥様 NG ペアの即時除外
  const wifeNgPairs = [{ shirtId: 'S2', pantsId: 'P8', reason: '🚨 奥様ダメ出し', createdAt: new Date().toISOString() }];
  const wifeNgRecs = calculateRecommendationsForShirt('S2', 'office', itemMap, pants, wifeNgPairs, new Set());
  assert.equal(wifeNgRecs.recommended.some((r) => r.pants.id === 'P8'), false, 'Wife NG pair must be completely removed from recommended');
  assert.equal(wifeNgRecs.otherOk.some((r) => r.pants.id === 'P8'), false, 'Wife NG pair must be completely removed from otherOk');
  const p8WifeNg = wifeNgRecs.ngList.find((n) => n.pants.id === 'P8');
  assert.ok(p8WifeNg, 'P8 must be in ngList');
  assert.equal(p8WifeNg.isWifeNg, true, 'isWifeNg flag must be true');

  console.log('  ✅ Domain logic & runtime schema validator unit tests verified');
}

// -------------------------------------------------------------
// Test Case 18: 単一アイテム差分マージ＆ドメイン分析ロジック恒常テスト (Phase 1 恒常テスト)
// -------------------------------------------------------------
{
  const rawCloset = JSON.parse(fs.readFileSync(path.join(projectRoot, 'src/data/closet.json'), 'utf-8'));

  // 1. getNextSequentialId の検証
  assert.equal(getNextSequentialId(rawCloset.items, 'shirt'), 'S10', 'Next shirt should be S10');
  assert.equal(getNextSequentialId(rawCloset.items, 'pants'), 'P16', 'Next pants should be P16');

  // 欠番や順序不同、空配列のケース
  const disorderedItems = [
    { id: 'S1', category: 'shirt' },
    { id: 'S15', category: 'shirt' },
    { id: 'S3', category: 'shirt' },
  ];
  assert.equal(getNextSequentialId(disorderedItems, 'shirt'), 'S16', 'Should handle disordered and gap IDs correctly');
  assert.equal(getNextSequentialId([], 'shirt'), 'S1', 'Empty items should yield S1');
  assert.equal(getNextSequentialId([], 'pants'), 'P1', 'Empty items should yield P1');

  // 2. validateSingleClosetItem の境界ケース検証
  const validP16 = {
    id: 'P16',
    category: 'pants',
    name: '黒テーパードスラックス',
    imageUrl: '/images/P16.jpg',
    seasonSleeve: '通年',
    dressScore: 4.5,
    comfortScore: 4.0,
    officeRecommendIds: ['S1', 'S2', 'S3'],
    remoteRecommendIds: ['S4', 'S5'],
    ngIds: ['S8'],
    ngReason: '生成りワークシャツと黒スラックスはテイストが合わないため',
    notes: '万能黒スラックス',
  };

  const validRes = validateSingleClosetItem(validP16, rawCloset);
  assert.equal(validRes.valid, true, 'Valid single item must pass validation');
  assert.ok(validRes.item && validRes.item.id === 'P16');

  // 2a. 不正な基本フィールド
  assert.equal(validateSingleClosetItem(null, rawCloset).valid, false);
  assert.equal(validateSingleClosetItem({ ...validP16, id: 'P 16' }, rawCloset).valid, false, 'ID with space should fail');
  assert.equal(validateSingleClosetItem({ ...validP16, category: 'jacket' }, rawCloset).valid, false, 'Invalid category should fail');
  assert.equal(validateSingleClosetItem({ ...validP16, name: '' }, rawCloset).valid, false, 'Empty name should fail');
  assert.equal(validateSingleClosetItem({ ...validP16, dressScore: 0.5 }, rawCloset).valid, false, 'Score below 1.0 should fail');
  assert.equal(validateSingleClosetItem({ ...validP16, dressScore: 5.5 }, rawCloset).valid, false, 'Score above 5.0 should fail');

  // 2b. 既存IDと異なるカテゴリでの上書き拒否（レビュー指摘対応: S1=shirt に対する S1=pants の拒否）
  const crossCategoryItem = {
    ...validP16,
    id: 'S1', // 既存のシャツID
    category: 'pants', // カテゴリがパンツ
  };
  const crossCategoryRes = validateSingleClosetItem(crossCategoryItem, rawCloset);
  assert.equal(crossCategoryRes.valid, false, 'Importing item with same ID but different category must fail');
  assert.ok(
    crossCategoryRes.error && crossCategoryRes.error.includes('既にカテゴリ "shirt" として存在'),
    'Error message must state category mismatch'
  );

  // 2c. 存在しない相手IDの参照
  assert.equal(
    validateSingleClosetItem({ ...validP16, officeRecommendIds: ['S999'] }, rawCloset).valid,
    false,
    'Non-existent target ID must fail'
  );

  // 2d. 同一カテゴリのID参照（パンツなのにパンツIDを参照）
  assert.equal(
    validateSingleClosetItem({ ...validP16, officeRecommendIds: ['P1'] }, rawCloset).valid,
    false,
    'Same category reference must fail'
  );

  // 2e. 推薦と NG の重複矛盾
  assert.equal(
    validateSingleClosetItem(
      { ...validP16, officeRecommendIds: ['S1'], ngIds: ['S1'] },
      rawCloset
    ).valid,
    false,
    'Conflict between recommend and ngIds must fail'
  );
  assert.equal(
    validateSingleClosetItem(
      { ...validP16, remoteRecommendIds: ['S2'], ngIds: ['S2'] },
      rawCloset
    ).valid,
    false,
    'Conflict between remote recommend and ngIds must fail'
  );

  // 3. mergeSingleItemIntoClosetData の検証（不変性＆双方向更新）
  // マージ前の既存アイテム同士の相性スナップショットを記録
  const snapshotBefore = new Map();
  for (const item of rawCloset.items) {
    snapshotBefore.set(item.id, {
      office: [...item.officeRecommendIds],
      remote: [...item.remoteRecommendIds],
      ng: [...item.ngIds],
    });
  }

  const mergedCloset = mergeSingleItemIntoClosetData(rawCloset, validP16);
  assert.equal(mergedCloset.items.length, rawCloset.items.length + 1, 'Total item count must increase by 1');
  assert.ok(mergedCloset.items.some((i) => i.id === 'P16'), 'P16 must exist in merged items');

  // 3a. 【最重要】既存の全ペア（S1〜S9 と P1〜P15 の間）の相性が一切変化していないことの厳密検証
  for (const item of mergedCloset.items) {
    if (item.id === 'P16') continue;
    const prev = snapshotBefore.get(item.id);
    assert.ok(prev, `Previous snapshot for ${item.id} must exist`);

    if (item.category === 'pants') {
      // 既存のパンツ同士・シャツに対する配列は P16 を含まず、かつ完全一致すること
      assert.deepEqual(item.officeRecommendIds, prev.office, `Pants ${item.id} officeRecommendIds must not change`);
      assert.deepEqual(item.remoteRecommendIds, prev.remote, `Pants ${item.id} remoteRecommendIds must not change`);
      assert.deepEqual(item.ngIds, prev.ng, `Pants ${item.id} ngIds must not change`);
    } else {
      // シャツの場合、P16 以外の既存要素が完全に維持されていること
      const officeWithoutP16 = item.officeRecommendIds.filter((id) => id !== 'P16');
      const remoteWithoutP16 = item.remoteRecommendIds.filter((id) => id !== 'P16');
      const ngWithoutP16 = item.ngIds.filter((id) => id !== 'P16');

      assert.deepEqual(officeWithoutP16, prev.office, `Shirt ${item.id} existing office links must be intact`);
      assert.deepEqual(remoteWithoutP16, prev.remote, `Shirt ${item.id} existing remote links must be intact`);
      assert.deepEqual(ngWithoutP16, prev.ng, `Shirt ${item.id} existing ng links must be intact`);

      // 3b. 双方向リンクの自動反映の正確性検証
      if (validP16.officeRecommendIds.includes(item.id)) {
        assert.ok(item.officeRecommendIds.includes('P16'), `Shirt ${item.id} must have P16 in officeRecommendIds`);
      } else {
        assert.equal(item.officeRecommendIds.includes('P16'), false, `Shirt ${item.id} must NOT have P16 in officeRecommendIds`);
      }

      if (validP16.remoteRecommendIds.includes(item.id)) {
        assert.ok(item.remoteRecommendIds.includes('P16'), `Shirt ${item.id} must have P16 in remoteRecommendIds`);
      } else {
        assert.equal(item.remoteRecommendIds.includes('P16'), false, `Shirt ${item.id} must NOT have P16 in remoteRecommendIds`);
      }

      if (validP16.ngIds.includes(item.id)) {
        assert.ok(item.ngIds.includes('P16'), `Shirt ${item.id} must have P16 in ngIds`);
      } else {
        assert.equal(item.ngIds.includes('P16'), false, `Shirt ${item.id} must NOT have P16 in ngIds`);
      }
    }
  }

  // 3c. マージ後データが既存の全体バリデーション (validateClosetDataSchema) を通過すること
  const schemaValidation = validateClosetDataSchema(mergedCloset);
  assert.equal(schemaValidation.valid, true, 'Merged closet data must pass validateClosetDataSchema without errors');

  // 3d. 同一IDでの上書き更新検証（再マージ時）
  const updatedP16 = {
    ...validP16,
    name: '黒テーパードスラックス（更新版）',
    officeRecommendIds: ['S1'], // S2, S3 を外し S1 のみに変更
    ngIds: ['S4'],              // S8 を外し S4 を NG に変更
  };
  const reMerged = mergeSingleItemIntoClosetData(mergedCloset, updatedP16);
  assert.equal(reMerged.items.length, mergedCloset.items.length, 'Re-merging same ID must not increase item count');
  const foundP16 = reMerged.items.find((i) => i.id === 'P16');
  assert.equal(foundP16.name, '黒テーパードスラックス（更新版）');

  const s2Item = reMerged.items.find((i) => i.id === 'S2');
  const s4Item = reMerged.items.find((i) => i.id === 'S4');
  const s8Item = reMerged.items.find((i) => i.id === 'S8');
  assert.equal(s2Item.officeRecommendIds.includes('P16'), false, 'P16 should be removed from S2 officeRecommendIds after update');
  assert.ok(s4Item.ngIds.includes('P16'), 'P16 should be added to S4 ngIds after update');
  assert.equal(s8Item.ngIds.includes('P16'), false, 'P16 should be removed from S8 ngIds after update');

  // 4. analyzeWardrobeStats の分析ロジック検証
  const itemMap = new Map();
  rawCloset.items.forEach((item) => itemMap.set(item.id, item));
  const shirts = rawCloset.items.filter((item) => item.category === 'shirt');
  const pants = rawCloset.items.filter((item) => item.category === 'pants');

  const stats = analyzeWardrobeStats(shirts, pants, itemMap, []);
  assert.equal(stats.shirtStats.length, shirts.length);
  assert.equal(stats.pantsStats.length, pants.length);

  // S1 (濃インディゴ) は出社相手が少ないためボトルネックとして検出されること
  const s1Stat = stats.bottleneckShirts.find((s) => s.item.id === 'S1');
  assert.ok(s1Stat, 'S1 must be detected as a bottleneck shirt');
  assert.ok(s1Stat.bottleneckReason && s1Stat.bottleneckReason.length > 0);

  // 出社エースパンツのリストに P8 や P3 が含まれること
  assert.ok(stats.officeAcePants.some((p) => p.id === 'P8'));
  assert.ok(stats.officeAcePants.some((p) => p.id === 'P3'));

  console.log('  ✅ Single-item merge, sequential ID, validation & wardrobe analysis tests verified');
}

// -------------------------------------------------------------
// Test Case 19: uploadImage の Fail-Closed 認証・正本フォルダ強制・ファイル更新テスト (Phase 2 恒常テスト)
// -------------------------------------------------------------
{
  const correctToken = 'upload-secret-token-777';
  const { ss, context } = createGasEnvironment(correctToken);
  vm.runInContext('setupSpreadsheet()', context);

  // 1. 【条件1検証】Fail-Closed 認証: トークンなし、または誤ったトークンは拒否されること
  const unauthUploadReq = {
    postData: {
      contents: JSON.stringify({
        action: 'uploadImage',
        itemId: 'P16',
        base64Data: Buffer.from('fake-image-bytes').toString('base64'),
      }),
    },
  };
  context.mockUnauthUpload = unauthUploadReq;
  const unauthRes = JSON.parse(vm.runInContext('doPost(mockUnauthUpload).getContent()', context));
  assert.equal(unauthRes.ok, false, 'Unauthenticated uploadImage request must be rejected');
  assert.match(unauthRes.error, /認証エラー/, 'Must return authentication error');

  const wrongTokenReq = {
    postData: {
      contents: JSON.stringify({
        action: 'uploadImage',
        token: 'wrong-token',
        itemId: 'P16',
        base64Data: Buffer.from('fake-image-bytes').toString('base64'),
      }),
    },
  };
  context.mockWrongToken = wrongTokenReq;
  const wrongRes = JSON.parse(vm.runInContext('doPost(mockWrongToken).getContent()', context));
  assert.equal(wrongRes.ok, false, 'Wrong token must be rejected');

  // 2. 【条件2検証】保存先フォルダは meta_config の正本のみを使用:
  // (a) meta_config に未設定の場合、リクエストに imageFolderId を含めても拒否されること
  const noConfigFolderReq = {
    postData: {
      contents: JSON.stringify({
        action: 'uploadImage',
        token: correctToken,
        imageFolderId: 'attacker-folder-id', // リクエストの指定
        itemId: 'P16',
        base64Data: Buffer.from('fake-image-bytes').toString('base64'),
      }),
    },
  };
  context.mockNoConfigFolder = noConfigFolderReq;
  const noConfigFolderRes = JSON.parse(vm.runInContext('doPost(mockNoConfigFolder).getContent()', context));
  assert.equal(noConfigFolderRes.ok, false, 'Must fail when meta_config does not have imageFolderId');
  assert.ok(noConfigFolderRes.error.includes('画像フォルダ ID が未設定'), 'Error message must state missing config');

  // (b) meta_config に正本を設定した場合、リクエストに別フォルダを指定しても無視され、正本フォルダにのみ保存されること
  const serverFolderSSOT = 'folder-ssot-strictly-used';
  const metaSheet = ss.getSheetByName('meta_config');
  metaSheet.appendRow(['imageFolderId', serverFolderSSOT, new Date().toISOString()]);

  let requestedFolderId = '';
  let createdFileName = '';
  let trashedFilesCount = 0;
  const createdFilesMap = new Map();

  context.DriveApp = {
    getFolderById: (folderId) => {
      requestedFolderId = folderId;
      return {
        getName: () => 'SSOT_Folder',
        getFilesByName: (fileName) => {
          const files = createdFilesMap.get(fileName) || [];
          let idx = 0;
          return {
            hasNext: () => idx < files.length,
            next: () => {
              const f = files[idx++];
              return {
                setTrashed: (val) => {
                  if (val) trashedFilesCount++;
                },
              };
            },
          };
        },
        createFile: (blob) => {
          createdFileName = blob.getName();
          const fileObj = {
            id: 'file_' + blob.getName(),
            name: blob.getName(),
            modifiedTime: Date.now(),
          };
          const existing = createdFilesMap.get(blob.getName()) || [];
          createdFilesMap.set(blob.getName(), [...existing, fileObj]);
          return {
            getId: () => fileObj.id,
            getLastUpdated: () => new Date(fileObj.modifiedTime),
          };
        },
      };
    },
  };

  const uploadReqWithAttackerFolder = {
    postData: {
      contents: JSON.stringify({
        action: 'uploadImage',
        token: correctToken,
        imageFolderId: 'malicious-folder-specified-by-client', // 送信されても無視されるべき
        itemId: 'p16', // 小文字 -> 大文字 P16 に正規化されるべき
        mimeType: 'image/jpeg',
        base64Data: Buffer.from('valid-small-jpeg-data').toString('base64'),
      }),
    },
  };
  context.mockUploadClientReq = uploadReqWithAttackerFolder;
  const uploadSuccessRes = JSON.parse(vm.runInContext('doPost(mockUploadClientReq).getContent()', context));
  assert.equal(uploadSuccessRes.ok, true, 'Upload should succeed');
  assert.equal(uploadSuccessRes.itemId, 'P16', 'Item ID should be normalized to uppercase');
  assert.equal(
    requestedFolderId,
    serverFolderSSOT,
    'Upload MUST strictly use server meta_config imageFolderId, completely ignoring client-provided folder ID'
  );
  assert.equal(createdFileName, 'P16.jpg', 'Created file must be named {ITEM_ID}.jpg');

  // 3. 同名ファイル再アップロード時のゴミ箱移動（重複防止）検証
  const secondUploadReq = {
    postData: {
      contents: JSON.stringify({
        action: 'uploadImage',
        token: correctToken,
        itemId: 'P16',
        mimeType: 'image/jpeg',
        base64Data: Buffer.from('updated-jpeg-data').toString('base64'),
      }),
    },
  };
  context.mockSecondUpload = secondUploadReq;
  const secondRes = JSON.parse(vm.runInContext('doPost(mockSecondUpload).getContent()', context));
  assert.equal(secondRes.ok, true);
  assert.equal(trashedFilesCount, 1, 'Previous file with same name must be moved to trash');

  // 3b. ゴミ箱退避失敗時の処理中断（新規ファイル作成防止）検証 (ChatGPT & Grok レビュー指摘対応)
  let shouldFailTrash = true;
  let newFileCreatedOnFail = false;
  context.DriveApp.getFolderById = () => ({
    getName: () => 'SSOT_Folder',
    getFilesByName: () => {
      let count = 0;
      return {
        hasNext: () => count === 0,
        next: () => {
          count++;
          return {
            setTrashed: () => {
              if (shouldFailTrash) throw new Error('Permission denied on DriveApp.setTrashed');
            },
          };
        },
      };
    },
    createFile: () => {
      newFileCreatedOnFail = true;
      return { getId: () => 'unexpected', getLastUpdated: () => new Date() };
    },
  });

  const failTrashReq = {
    postData: {
      contents: JSON.stringify({
        action: 'uploadImage',
        token: correctToken,
        itemId: 'P16',
        mimeType: 'image/jpeg',
        base64Data: Buffer.from('data-when-trash-fails').toString('base64'),
      }),
    },
  };
  context.mockFailTrash = failTrashReq;
  const failTrashRes = JSON.parse(vm.runInContext('doPost(mockFailTrash).getContent()', context));
  assert.equal(failTrashRes.ok, false, 'Must fail when setTrashed fails');
  assert.equal(newFileCreatedOnFail, false, 'New file MUST NOT be created if trashing old file fails');
  assert.ok(failTrashRes.error.includes('ゴミ箱退避に失敗'), 'Error message must specify trash failure');

  // 4. 2MB 超過時の拒否検証
  const hugeData = Buffer.alloc(3 * 1024 * 1024, 'a').toString('base64');
  const hugeUploadReq = {
    postData: {
      contents: JSON.stringify({
        action: 'uploadImage',
        token: correctToken,
        itemId: 'P16',
        base64Data: hugeData,
      }),
    },
  };
  context.mockHugeUpload = hugeUploadReq;
  const hugeRes = JSON.parse(vm.runInContext('doPost(mockHugeUpload).getContent()', context));
  assert.equal(hugeRes.ok, false, 'Over-sized image must be rejected');
  assert.ok(hugeRes.error.includes('2MB'), 'Error message must specify 2MB limit');

  console.log('  ✅ uploadImage Fail-Closed auth, server SSOT folder & overwrite tests verified');
}

console.log('🎉 All GAS backend & sync logic tests passed successfully!');
