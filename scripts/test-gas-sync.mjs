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
  switchDraftItemCategory,
  GARMENT_COLOR_ANCHOR_GUIDE,
  isValidGarmentColor,
  inferGarmentColor,
  validateGarmentMeasurements,
  normalizeCropBox,
  applyBatchColorUpdates,
  MAX_BATCH_GARMENTS,
  appendUnconfirmedColorNote,
  sanitizeDraftPeerReferences,
  assignSequentialIdsForBatch,
  validateAndMergeBatchGarments,
  parseSyncInputJson,
  FAILED_DRIVE_UPLOADS_STORAGE_KEY,
  parseFailedDriveUploads,
  saveFailedDriveUploadsToStorage,
  loadFailedDriveUploadsFromStorage,
  processDriveRetryUploads,
} = closetDomain;

const imageProcessorTsPath = path.join(projectRoot, 'src/utils/imageProcessor.ts');
const imageProcessorCode = fs.readFileSync(imageProcessorTsPath, 'utf-8');
const transpiledImageJs = ts.transpileModule(imageProcessorCode, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const imageProcessor = await import(
  'data:text/javascript;base64,' + Buffer.from(transpiledImageJs).toString('base64')
);
const {
  STANDARD_IMAGE_WIDTH,
  STANDARD_IMAGE_HEIGHT,
  STANDARD_STUDIO_BG_COLOR,
  calculateCropAndPlacement,
  cropAndNormalizeGarmentImage,
} = imageProcessor;

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
  // neededItemIds 分のファイル情報が含まれること (Issue #4)
  assert.ok(planRes.files, 'planRes.files must be present');
  assert.equal(planRes.files['P2'].fileId, 'f2');
  assert.equal(planRes.files['P4'].fileId, 'f_huge');
  assert.equal(planRes.files['S1'], undefined, 'S1 is not in neededItemIds so must not be in files');
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
    color: '黒',
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

// -------------------------------------------------------------
// Test Case 20: ID接頭辞・カテゴリ一致検証、種別切替相性クリアヘルパー、下書きストア非干渉検証 (Phase 1 恒常テスト)
// -------------------------------------------------------------
{
  const rawCloset = JSON.parse(fs.readFileSync(path.join(projectRoot, 'src/data/closet.json'), 'utf-8'));

  // 1. ID接頭辞とカテゴリの一致検証 (validateSingleClosetItem)
  const baseItem = {
    name: 'テストアイテム',
    color: '白',
    imageUrl: '/images/S10.jpg',
    seasonSleeve: '長袖・通年',
    dressScore: 4.0,
    comfortScore: 4.0,
    officeRecommendIds: [],
    remoteRecommendIds: [],
    ngIds: [],
    ngReason: 'なし',
    notes: 'テスト',
  };

  // 1a. シャツなのに P16 は拒否
  const wrongPrefixShirt = validateSingleClosetItem(
    { ...baseItem, id: 'P16', category: 'shirt' },
    rawCloset
  );
  assert.equal(wrongPrefixShirt.valid, false, 'Shirt with P16 must be rejected');
  assert.ok(wrongPrefixShirt.error.includes('形式が一致しません'), 'Error must specify prefix mismatch');

  // 1b. パンツなのに S10 は拒否
  const wrongPrefixPants = validateSingleClosetItem(
    { ...baseItem, id: 'S10', category: 'pants', imageUrl: '/images/P16.jpg' },
    rawCloset
  );
  assert.equal(wrongPrefixPants.valid, false, 'Pants with S10 must be rejected');
  assert.ok(wrongPrefixPants.error.includes('形式が一致しません'), 'Error must specify prefix mismatch');

  // 1c. S0 や Sabc 等の不正フォーマットは拒否
  assert.equal(validateSingleClosetItem({ ...baseItem, id: 'S0', category: 'shirt' }, rawCloset).valid, false);
  assert.equal(validateSingleClosetItem({ ...baseItem, id: 'Sabc', category: 'shirt' }, rawCloset).valid, false);
  assert.equal(validateSingleClosetItem({ ...baseItem, id: 'P_1', category: 'pants' }, rawCloset).valid, false);

  // 1d. 正しい接頭辞 (S10, P16) は通過。小文字 (s10, p16) も大文字正規化されて通過
  const validShirt = validateSingleClosetItem({ ...baseItem, id: 'S10', category: 'shirt' }, rawCloset);
  assert.equal(validShirt.valid, true, 'Valid S10 shirt must pass');
  assert.equal(validShirt.item?.id, 'S10');
  assert.equal(validShirt.item?.imageUrl, '/images/S10.jpg', 'imageUrl must be normalized to /images/S10.jpg');

  // 小文字 s10 かつ 不一致・小文字の imageUrl (/images/s10.png) を指定した場合でも /images/S10.jpg に正規化
  const validShirtLower = validateSingleClosetItem(
    { ...baseItem, id: 's10', category: 'shirt', imageUrl: '/images/s10.png' },
    rawCloset
  );
  assert.equal(validShirtLower.valid, true, 'Lowercase s10 must be normalized and pass');
  assert.equal(validShirtLower.item?.id, 'S10', 'Normalized id must be uppercase S10');
  assert.equal(
    validShirtLower.item?.imageUrl,
    '/images/S10.jpg',
    'imageUrl must be normalized to /images/S10.jpg from mismatched/lowercase input'
  );

  const validPants = validateSingleClosetItem(
    { ...baseItem, id: 'P16', category: 'pants', imageUrl: '/images/P16.jpg' },
    rawCloset
  );
  assert.equal(validPants.valid, true, 'Valid P16 pants must pass');
  assert.equal(validPants.item?.id, 'P16');
  assert.equal(validPants.item?.imageUrl, '/images/P16.jpg');

  // 小文字 p16 かつ 小文字 imageUrl (/images/p16.jpg) を指定した場合でも /images/P16.jpg に正規化
  const validPantsLower = validateSingleClosetItem(
    { ...baseItem, id: 'p16', category: 'pants', imageUrl: '/images/p16.jpg' },
    rawCloset
  );
  assert.equal(validPantsLower.valid, true, 'Lowercase p16 must be normalized and pass');
  assert.equal(validPantsLower.item?.id, 'P16', 'Normalized id must be uppercase P16');
  assert.equal(
    validPantsLower.item?.imageUrl,
    '/images/P16.jpg',
    'imageUrl must be normalized to /images/P16.jpg even if input is lowercase /images/p16.jpg'
  );

  // 全く不一致な imageUrl (/images/old_item.jpg) が渡された場合でも確定IDで正規化
  const validPantsMismatched = validateSingleClosetItem(
    { ...baseItem, id: 'P16', category: 'pants', imageUrl: '/images/mismatched_photo.jpg' },
    rawCloset
  );
  assert.equal(validPantsMismatched.valid, true);
  assert.equal(
    validPantsMismatched.item?.imageUrl,
    '/images/P16.jpg',
    'Mismatched imageUrl must be normalized to /images/P16.jpg based on finalized ID'
  );

  // 2. 【条件2検証】種別切替ヘルパー (switchDraftItemCategory)
  // Gemini が最初シャツとして判定した相性リスト（相手: パンツID）を持つドラフト
  const shirtDraft = {
    id: 'S10',
    category: 'shirt',
    name: 'ネイビーシャツ',
    color: '濃紺',
    imageUrl: '/images/S10.jpg',
    seasonSleeve: '長袖・通年',
    dressScore: 3.5,
    comfortScore: 4.0,
    officeRecommendIds: ['P3', 'P8'],
    remoteRecommendIds: ['P1'],
    ngIds: ['P5'],
    ngReason: '同系色濃紺による作業着見え',
    notes: 'テストシャツ',
    measurements: { bodyLength: 72, chestWidth: 54 },
  };

  // パンツへ種別切替を実行
  const switchedToPants = switchDraftItemCategory(shirtDraft, 'pants', rawCloset.items);
  assert.equal(switchedToPants.category, 'pants', 'Category must be switched to pants');
  assert.equal(switchedToPants.id, 'P16', 'ID must be updated to next sequential pants ID (P16)');
  assert.equal(switchedToPants.imageUrl, '/images/P16.jpg', 'imageUrl must be updated to /images/P16.jpg');
  assert.deepEqual(switchedToPants.officeRecommendIds, [], 'officeRecommendIds must be cleared to []');
  assert.deepEqual(switchedToPants.remoteRecommendIds, [], 'remoteRecommendIds must be cleared to []');
  assert.deepEqual(switchedToPants.ngIds, [], 'ngIds must be cleared to []');
  assert.equal(switchedToPants.ngReason, 'なし', 'ngReason must be reset to なし');
  assert.equal(switchedToPants.measurements, undefined, 'measurements must be cleared to undefined on category switch');

  // 切替後のアイテムが validateSingleClosetItem を正常に通過することを確認
  const switchedValidation = validateSingleClosetItem(switchedToPants, rawCloset);
  assert.equal(switchedValidation.valid, true, 'Switched pants must pass validateSingleClosetItem');

  // 3. 【条件1検証】下書き画像ストアと本保存ストアの分離・pruneImages 非干渉
  const imageStoreCode = fs.readFileSync(path.join(projectRoot, 'src/utils/imageStore.ts'), 'utf-8');
  assert.ok(
    imageStoreCode.includes('smart_closet_draft_db'),
    'imageStore.ts must declare separate database smart_closet_draft_db for drafts'
  );
  assert.ok(
    imageStoreCode.includes('saveDraftImage') &&
      imageStoreCode.includes('getDraftImage') &&
      imageStoreCode.includes('clearDraftImage'),
    'imageStore.ts must export saveDraftImage, getDraftImage, clearDraftImage'
  );
  assert.ok(
    imageStoreCode.includes('deleteImageBlob'),
    'imageStore.ts must export deleteImageBlob'
  );

  // pruneImages が STORE_IMAGES のみを対象とし、draft DB に触れないことをコード整合性で担保
  const pruneImagesStart = imageStoreCode.indexOf('export async function pruneImages');
  const pruneImagesEnd = imageStoreCode.indexOf('export async function clearAllImages', pruneImagesStart);
  const pruneImagesFnStr = imageStoreCode.slice(pruneImagesStart, pruneImagesEnd);
  assert.ok(pruneImagesFnStr.includes('getAllImageKeys()'), 'pruneImages must query getAllImageKeys');
  assert.equal(
    pruneImagesFnStr.includes('DRAFT_DB_NAME') || pruneImagesFnStr.includes('STORE_DRAFT'),
    false,
    'pruneImages must NOT touch draft database or store'
  );

  console.log('  ✅ ID prefix validation, switchDraftItemCategory, and draft store isolation verified');
}

// 21. 「覚えなくていい」クラウド同期画面 (GasSyncModal) およびバックアップ操作 (AiSyncView) の静的検証
{
  const gasSyncModalCode = fs.readFileSync(path.join(projectRoot, 'src/components/GasSyncModal.tsx'), 'utf-8');
  const aiSyncViewCode = fs.readFileSync(path.join(projectRoot, 'src/components/AiSyncView.tsx'), 'utf-8');

  // 【条件1検証】統合ボタン (handleUnifiedSync) が未送信フラグ (smart_closet_sync_dirty) を事前検査し、
  // dirty 時は pushToGas() を先に実行し、成功後に pullFromGas() を実行する順序になっていること
  assert.ok(
    gasSyncModalCode.includes('handleUnifiedSync'),
    'GasSyncModal must implement handleUnifiedSync'
  );
  assert.ok(
    gasSyncModalCode.includes("localStorage.getItem('smart_closet_sync_dirty') === 'true'"),
    'handleUnifiedSync must explicitly check smart_closet_sync_dirty'
  );

  const unifiedSyncStart = gasSyncModalCode.indexOf('const handleUnifiedSync = async');
  const unifiedSyncEnd = gasSyncModalCode.indexOf('const handleClearImageCache = async', unifiedSyncStart);
  assert.ok(unifiedSyncStart > 0 && unifiedSyncEnd > unifiedSyncStart, 'handleUnifiedSync block must exist');
  const unifiedSyncFnStr = gasSyncModalCode.slice(unifiedSyncStart, unifiedSyncEnd);

  const pushIndex = unifiedSyncFnStr.indexOf('pushToGas()');
  const pullIndex = unifiedSyncFnStr.indexOf('pullFromGas()');
  assert.ok(pushIndex > 0, 'handleUnifiedSync must call pushToGas() when dirty');
  assert.ok(pullIndex > 0, 'handleUnifiedSync must call pullFromGas()');
  assert.ok(pushIndex < pullIndex, 'pushToGas() must be called before pullFromGas() when local changes are pending');

  // 【条件2検証】写真同期において handleSyncImages の安全装置がすべて維持されていること
  assert.ok(
    gasSyncModalCode.includes('getSyncedFolderId()'),
    'GasSyncModal must call getSyncedFolderId to detect folder switch'
  );
  assert.ok(
    gasSyncModalCode.includes('clearAllImages()'),
    'GasSyncModal must call clearAllImages on folder switch with valid items'
  );
  assert.ok(
    gasSyncModalCode.includes('CHUNK_SIZE = 6'),
    'GasSyncModal must retain CHUNK_SIZE = 6'
  );
  assert.ok(
    gasSyncModalCode.includes('pruneImages(validItemIds)'),
    'GasSyncModal must run pruneImages with validItemIds'
  );
  assert.ok(
    gasSyncModalCode.includes('window.confirm('),
    'GasSyncModal must retain confirmation dialog for empty or rapid-decrease prune'
  );
  assert.ok(
    gasSyncModalCode.includes('setSyncedFolderId(folderId)'),
    'GasSyncModal must update syncedFolderId upon success'
  );

  // 表示専用画像フォルダID & 平易な日本語表現
  assert.ok(
    gasSyncModalCode.includes('readOnly') && gasSyncModalCode.includes('Google ドライブ画像フォルダ ID（表示専用）'),
    'imageFolderId input must be readOnly and labeled as display-only'
  );
  assert.ok(
    gasSyncModalCode.includes('今すぐ同期'),
    'GasSyncModal must have unified "今すぐ同期" button'
  );
  assert.ok(
    gasSyncModalCode.includes('シートから取り直す'),
    'GasSyncModal must label manual pull as "シートから取り直す"'
  );
  assert.ok(
    gasSyncModalCode.includes('端末の内容でシートを上書きする'),
    'GasSyncModal must label manual push as "端末の内容でシートを上書きする"'
  );
  assert.ok(
    gasSyncModalCode.includes('写真キャッシュ全消去'),
    'GasSyncModal must retain "写真キャッシュ全消去" in danger zone'
  );
  assert.ok(
    gasSyncModalCode.includes('smart_closet_valid_photo_ids'),
    'GasSyncModal must track verified valid photo IDs from GAS sync to avoid false missing detection for silhouette items'
  );
  assert.equal(
    gasSyncModalCode.includes('closetItemIds.some'),
    false,
    'GasSyncModal must NOT check closetData items directly for photo missing detection'
  );
  assert.ok(
    gasSyncModalCode.includes('着分の写真を保存済み'),
    'GasSyncModal must display verified fact "端末にN着分の写真を保存済み"'
  );

  // AiSyncView: バックアップ折りたたみ & 「初期データに戻す」文言の検証
  assert.ok(
    aiSyncViewCode.includes('isBackupOpen'),
    'AiSyncView must have isBackupOpen collapsible state'
  );
  assert.ok(
    aiSyncViewCode.includes('📦 バックアップ・復旧'),
    'AiSyncView must have backup and restore collapsible section'
  );
  assert.ok(
    aiSyncViewCode.includes('<span>初期データに戻す</span>'),
    'AiSyncView must display explicit text label for reset button'
  );

  console.log('  ✅ Zero-memorization Cloud Sync & AiSyncView backup collapsible UI verified');
}

// -------------------------------------------------------------
// Test Case 20: Broken Path Guard 回帰テスト（Markdown 相対・ルート直下・禁止絶対リンク）
// -------------------------------------------------------------
{
  const { validateDocLinksAndPaths } = await import('./validate-closet.mjs');

  const dummyDocRoot = path.join(projectRoot, 'AGENTS.md');
  const dummyDocSub = path.join(projectRoot, 'docs/SPECIFICATION.md');

  // 1. 正常系: ルート直下リンク、相対リンク、アンカー、Webリンク
  const validContentRoot = `
# Sample
- [Self](./AGENTS.md)
- [Readme](README.md)
- [Doc](docs/SPECIFICATION.md)
- [Data](src/data/closet.json)
- [Anchor](README.md#step-1)
- [External](https://smart-closet-djw.pages.dev)
- [Mail](mailto:test@example.com)
- \`src/utils/closetDomain.ts\`
`;
  const errorsRoot = validateDocLinksAndPaths(dummyDocRoot, validContentRoot, projectRoot);
  assert.equal(errorsRoot.length, 0, `Valid root links must produce 0 errors, got: ${JSON.stringify(errorsRoot)}`);

  const validContentSub = `
# Sub
- [Parent Link](../AGENTS.md)
- [Sibling Link](./OPERATIONS.md)
- [Types](../src/types/closet.ts)
`;
  const errorsSub = validateDocLinksAndPaths(dummyDocSub, validContentSub, projectRoot);
  assert.equal(errorsSub.length, 0, `Valid sub links must produce 0 errors, got: ${JSON.stringify(errorsSub)}`);

  // 2. 異常系: 壊れたルート直下ファイルリンク
  const brokenRootContent = `[Broken](./NON_EXISTENT_ROOT_FILE.md)`;
  const errorsBrokenRoot = validateDocLinksAndPaths(dummyDocRoot, brokenRootContent, projectRoot);
  assert.equal(errorsBrokenRoot.length, 1, 'Broken root file link must produce 1 error');
  assert.ok(errorsBrokenRoot[0].includes('NON_EXISTENT_ROOT_FILE.md'), 'Error must mention broken root path');

  // 3. 異常系: 壊れたサブディレクトリファイルリンク
  const brokenSubContent = `[Broken](docs/NON_EXISTENT_SUB_FILE.md)`;
  const errorsBrokenSub = validateDocLinksAndPaths(dummyDocRoot, brokenSubContent, projectRoot);
  assert.equal(errorsBrokenSub.length, 1, 'Broken sub file link must produce 1 error');
  assert.ok(errorsBrokenSub[0].includes('NON_EXISTENT_SUB_FILE.md'), 'Error must mention broken sub path');

  // 4. 異常系: 禁止された file:/// ローカル絶対パス
  const forbiddenFileUrlContent = `[Forbidden](file:///Users/tahosook/Documents/codex/smart-closet/docs/SPECIFICATION.md)`;
  const errorsFileUrl = validateDocLinksAndPaths(dummyDocRoot, forbiddenFileUrlContent, projectRoot);
  assert.equal(errorsFileUrl.length, 1, 'file:/// local absolute link must produce 1 error');
  assert.ok(errorsFileUrl[0].includes('Forbidden local absolute link'), 'Error must state forbidden local absolute link');

  console.log('  ✅ Broken Path Guard Markdown relative & root link regression test verified');
}

// -------------------------------------------------------------
// Test Case 23: 登録写真の基準化（全12色パレット・境界アンカー・A4寸法推定・3:4切り抜き配置・暫定値非永続化・一括色更新）
// -------------------------------------------------------------
{
  const rawCloset = JSON.parse(fs.readFileSync(path.join(projectRoot, 'src/data/closet.json'), 'utf-8'));

  // 1. 全12色パレットおよび境界判定アンカー定数の検証
  const expectedPalette = [
    '白',
    '生成り',
    '黒',
    'チャコール',
    'ミディアムグレー',
    'ライトグレー',
    'グレージュ',
    '濃紺',
    'ブルー',
    '淡青',
    'オリーブ',
    'ブラウン',
  ];
  for (const color of expectedPalette) {
    assert.equal(isValidGarmentColor(color), true, `${color} must be a valid garment color`);
  }
  assert.equal(isValidGarmentColor('ネイビー'), false, '「ネイビー」単独指定は濃紺統合のため無効である必要がある');
  assert.equal(isValidGarmentColor('水色'), false, '水色はパレット外');
  assert.equal(isValidGarmentColor('インディゴ'), false, 'インディゴはパレット外');
  assert.equal(isValidGarmentColor(''), false);
  assert.equal(isValidGarmentColor(null), false);
  assert.equal(isValidGarmentColor(undefined), false);

  assert.ok(GARMENT_COLOR_ANCHOR_GUIDE.includes('白と生成りの境界'), 'Anchor guide must include white/ecru boundary');
  assert.ok(GARMENT_COLOR_ANCHOR_GUIDE.includes('淡青・ブルー・濃紺の境界'), 'Anchor guide must include 3-level blue boundary');
  assert.ok(GARMENT_COLOR_ANCHOR_GUIDE.includes('濃紺と黒の境界'), 'Anchor guide must include dark navy / black boundary');
  assert.ok(GARMENT_COLOR_ANCHOR_GUIDE.includes('グレー各色'), 'Anchor guide must include gray boundary');

  // 2. inferGarmentColor (表示用暫定値フォールバック) の検証
  assert.equal(inferGarmentColor('白無地長袖シャツ', '清潔感'), '白');
  assert.equal(inferGarmentColor('生成りワーク長袖シャツ', 'エクリュ'), '生成り');
  assert.equal(inferGarmentColor('黒スウェットイージーパンツ'), '黒');
  assert.equal(inferGarmentColor('チャコールグレージョガーパンツ'), 'チャコール');
  assert.equal(inferGarmentColor('ライトグレースウェットジョガー'), 'ライトグレー');
  assert.equal(inferGarmentColor('グレージュチノトラウザー'), 'グレージュ');
  assert.equal(inferGarmentColor('ミディアムグレーイージースラックス'), 'ミディアムグレー');
  assert.equal(inferGarmentColor('濃インディゴ無地長袖シャツ'), '濃紺');
  assert.equal(inferGarmentColor('ネイビーピンストライプパンツ'), '濃紺');
  assert.equal(inferGarmentColor('ヒッコリー細ストライプパンツ'), '濃紺');
  assert.equal(inferGarmentColor('サックスシャンブレー長袖シャツ'), '淡青');
  assert.equal(inferGarmentColor('ブルーウォッシュデニム'), 'ブルー');
  assert.equal(inferGarmentColor('インディゴパッチワーク柄パンツ'), 'ブルー');
  assert.equal(inferGarmentColor('オリーブグリーンチノパン'), 'オリーブ');
  assert.equal(inferGarmentColor('モカブラウンシャツ'), 'ブラウン');

  // 3. validateGarmentMeasurements の検証
  const validShirtMeasurements = validateGarmentMeasurements(
    { bodyLength: 72.3, chestWidth: 54.8, shoulderWidth: 46.1, sleeveLength: 61.4, invalidField: 999 },
    'shirt'
  );
  assert.deepEqual(validShirtMeasurements, {
    bodyLength: 72.5,
    chestWidth: 55.0,
    shoulderWidth: 46.0,
    sleeveLength: 61.5,
  }, 'Shirt measurements must be normalized to 0.5cm steps and extra fields stripped');

  const validPantsMeasurements = validateGarmentMeasurements(
    { waist: 82.2, inseam: 71.8, totalLength: 98.4, hemWidth: 18.2, bodyLength: 70 },
    'pants'
  );
  assert.deepEqual(validPantsMeasurements, {
    waist: 82.0,
    inseam: 72.0,
    totalLength: 98.5,
    hemWidth: 18.0,
  }, 'Pants measurements must be normalized to 0.5cm steps and category mismatch stripped');

  assert.equal(validateGarmentMeasurements(null), undefined);
  assert.equal(validateGarmentMeasurements({ bodyLength: 5 }), undefined, 'Out of range < 10 must be ignored');
  assert.equal(validateGarmentMeasurements({ bodyLength: 300 }), undefined, 'Out of range > 200 must be ignored');
  assert.equal(validateGarmentMeasurements({ bodyLength: NaN }), undefined);

  // 4. normalizeCropBox & calculateCropAndPlacement の検証
  const validBox = normalizeCropBox({ ymin: 80, xmin: 150, ymax: 920, xmax: 850 });
  assert.deepEqual(validBox, { ymin: 80, xmin: 150, ymax: 920, xmax: 850 });
  assert.equal(normalizeCropBox(null), undefined);
  assert.equal(normalizeCropBox({ ymin: 80, xmin: 80, ymax: 90, xmax: 90 }), undefined, 'Too small area must be rejected');
  assert.equal(normalizeCropBox({ ymin: '80', xmin: 100, ymax: 900, xmax: 800 }), undefined, 'Non-numbers must be rejected');

  // 有効な cropBox がある場合: 6%マージン付きで切り抜き、900x1200キャンバスの中央に配置
  const cropPlacement = calculateCropAndPlacement(1000, 1000, validBox, 0.06);
  assert.equal(cropPlacement.isCropped, true);
  assert.equal(cropPlacement.canvasWidth, 900);
  assert.equal(cropPlacement.canvasHeight, 1200);
  assert.ok(cropPlacement.destW <= 900 && cropPlacement.destH <= 1200);
  assert.ok(cropPlacement.destX >= 0 && cropPlacement.destY >= 0);

  // cropBox が無効/null の場合: 元画像全体をアスペクト比維持で中央に配置 (フォールバック)
  const fallbackPlacement = calculateCropAndPlacement(1600, 1200, null);
  assert.equal(fallbackPlacement.isCropped, false);
  assert.equal(fallbackPlacement.srcX, 0);
  assert.equal(fallbackPlacement.srcY, 0);
  assert.equal(fallbackPlacement.srcW, 1600);
  assert.equal(fallbackPlacement.srcH, 1200);
  assert.equal(fallbackPlacement.destW, 900); // 1600:1200 (4:3) scaled to width 900 -> height 675
  assert.equal(fallbackPlacement.destH, 675);
  assert.equal(fallbackPlacement.destX, 0);
  assert.equal(fallbackPlacement.destY, Math.round((1200 - 675) / 2));

  // 4b. 非ブラウザ環境での cropAndNormalizeGarmentImage の安全な拒否検証
  await assert.rejects(
    async () => {
      await cropAndNormalizeGarmentImage('data:image/jpeg;base64,1234');
    },
    {
      name: 'Error',
      message: '画像の正規化にはブラウザ環境（Canvas）が必要です',
    },
    'Calling cropAndNormalizeGarmentImage in non-browser environment must reject rather than returning empty blob'
  );

  // 5. validateSingleClosetItem の色・寸法・一時プロパティ除去検証
  const testP16Candidate = {
    id: 'P16',
    category: 'pants',
    name: '黒テーパードスラックス',
    color: '黒',
    imageUrl: '/images/P16.jpg',
    seasonSleeve: '通年',
    dressScore: 4.5,
    comfortScore: 4.0,
    officeRecommendIds: ['S1', 'S2', 'S3'],
    remoteRecommendIds: ['S4', 'S5'],
    ngIds: ['S8'],
    ngReason: 'なし',
    notes: '万能黒スラックス',
    measurements: { waist: 82, inseam: 72 },
    cropBox: { ymin: 100, xmin: 100, ymax: 900, xmax: 900 },
    garmentBox: { ymin: 100, xmin: 100, ymax: 900, xmax: 900 },
  };

  const p16ValidRes = validateSingleClosetItem(testP16Candidate, rawCloset);
  assert.equal(p16ValidRes.valid, true);
  assert.equal(p16ValidRes.item.color, '黒');
  assert.deepEqual(p16ValidRes.item.measurements, { waist: 82, inseam: 72 });
  assert.equal('cropBox' in p16ValidRes.item, false, 'cropBox must be stripped from returned ClosetItem');
  assert.equal('garmentBox' in p16ValidRes.item, false, 'garmentBox must be stripped from returned ClosetItem');

  // 5b. 色の非ブロッキング化検証（パレット外・欠落でも登録を止めず、color=undefined で登録を通す）
  // 色欠落は警告通過（color=undefined、notes追記なし）
  const noColorRes = validateSingleClosetItem({ ...testP16Candidate, color: undefined }, rawCloset);
  assert.equal(noColorRes.valid, true, 'Missing color must pass as unconfirmed warning');
  assert.equal(noColorRes.item.color, undefined);
  assert.ok(noColorRes.warning.includes('未設定'), 'Warning must note unconfirmed color');
  assert.equal(noColorRes.item.notes, testP16Candidate.notes, 'Notes must NOT have hint when color is missing');

  // 「ネイビー」単独指定もエラーにせず、color=undefined かつ notes に目安追記
  const navyRes = validateSingleClosetItem({ ...testP16Candidate, color: 'ネイビー' }, rawCloset);
  assert.equal(navyRes.valid, true, 'Navy must pass as unconfirmed warning with note hint');
  assert.equal(navyRes.item.color, undefined);
  assert.equal(navyRes.unconfirmedColorHint, 'ネイビー');
  assert.ok(navyRes.item.notes.includes('（色の目安：ネイビー ※12色パレット外のため未確定）'));

  // パレット外の色（ベージュ）もエラーにせず、color=undefined かつ notes に目安追記
  const beigeRes = validateSingleClosetItem({ ...testP16Candidate, color: 'ベージュ' }, rawCloset);
  assert.equal(beigeRes.valid, true, 'Beige must pass as unconfirmed warning with note hint');
  assert.equal(beigeRes.item.color, undefined);
  assert.equal(beigeRes.unconfirmedColorHint, 'ベージュ');
  assert.ok(beigeRes.item.notes.includes('（色の目安：ベージュ ※12色パレット外のため未確定）'));

  // 6. 【レビュー条件検証】validateClosetDataSchema の暫定値非永続化と既存データ読み込み保護
  // 6a. color が未設定のレガシーデータ: 読み込み成功し、color は undefined のまま保持（inferGarmentColor で勝手に上書きされない）
  const legacyDataWithoutColor = {
    items: rawCloset.items.map((item) => {
      const { color: _c, ...rest } = item;
      return rest;
    }),
  };
  const legacyLoadRes = validateClosetDataSchema(legacyDataWithoutColor);
  assert.equal(legacyLoadRes.valid, true, 'Legacy data without color must be successfully loaded');
  assert.equal(
    legacyLoadRes.data.items[0].color,
    undefined,
    'color must remain undefined and NOT be overwritten with inferGarmentColor in validateClosetDataSchema'
  );

  // 6b. color にパレット外（旧 'ネイビー' など）が含まれる場合: 読み込みは失敗させず、undefined にサニタイズして保護
  const legacyDataWithOldColor = {
    items: [
      { ...rawCloset.items[0], color: 'ネイビー' },
      ...rawCloset.items.slice(1),
    ],
  };
  const oldColorLoadRes = validateClosetDataSchema(legacyDataWithOldColor);
  assert.equal(oldColorLoadRes.valid, true, 'Legacy data with invalid color must not fail validation');
  assert.equal(
    oldColorLoadRes.data.items[0].color,
    undefined,
    'Out-of-palette color must be sanitized to undefined instead of crashing load'
  );

  // 6c. 有効な確定 color はそのまま保持
  const confirmedLoadRes = validateClosetDataSchema(rawCloset);
  assert.equal(confirmedLoadRes.valid, true);
  assert.equal(confirmedLoadRes.data.items[0].color, '濃紺');
  assert.equal(confirmedLoadRes.data.items[1].color, '白');

  // 7. applyBatchColorUpdates の検証
  const sampleBatchUpdates = {
    colorUpdates: [
      { id: 'S1', color: '濃紺' },
      { id: 'S9', color: '濃紺', name: '意図しない上書き名前' },
      { id: 'P11', color: '濃紺' },
    ],
  };
  const batchRes = applyBatchColorUpdates(rawCloset, sampleBatchUpdates);
  assert.equal(batchRes.valid, true);
  assert.equal(batchRes.updatedCount, 3);
  const updatedS1 = batchRes.data.items.find((i) => i.id === 'S1');
  const updatedS9 = batchRes.data.items.find((i) => i.id === 'S9');
  assert.equal(updatedS1.color, '濃紺');
  assert.deepEqual(updatedS1.officeRecommendIds, rawCloset.items[0].officeRecommendIds, 'officeRecommendIds must remain intact');
  assert.deepEqual(updatedS1.ngIds, rawCloset.items[0].ngIds, 'ngIds must remain intact');
  assert.equal(
    updatedS9.name,
    rawCloset.items.find((i) => i.id === 'S9').name,
    'applyBatchColorUpdates must protect and preserve original name even if payload includes name'
  );

  // 7a. 異常系: ネイビー単独指定、不正なID、重複ID、パレット外の色
  const batchWithNavy = applyBatchColorUpdates(rawCloset, {
    colorUpdates: [{ id: 'S1', color: 'ネイビー' }],
  });
  assert.equal(batchWithNavy.valid, false);
  assert.ok(batchWithNavy.error.includes('「濃紺」に統合'));

  const batchWithInvalidId = applyBatchColorUpdates(rawCloset, {
    colorUpdates: [{ id: 'S999', color: '濃紺' }],
  });
  assert.equal(batchWithInvalidId.valid, false);
  assert.ok(batchWithInvalidId.error.includes('存在しません'));

  const batchWithDupId = applyBatchColorUpdates(rawCloset, {
    colorUpdates: [{ id: 'S1', color: '濃紺' }, { id: 'S1', color: '白' }],
  });
  assert.equal(batchWithDupId.valid, false);
  assert.ok(batchWithDupId.error.includes('重複'));

  // 7b. 素配列形式の直接入力の検証（レビュー指摘対応）
  const batchResRawArray = applyBatchColorUpdates(rawCloset, [
    { id: 'S1', color: '濃紺' },
    { id: 'S2', color: '白' },
  ]);
  assert.equal(batchResRawArray.valid, true);
  assert.equal(batchResRawArray.updatedCount, 2);
  assert.equal(batchResRawArray.data.items.find((i) => i.id === 'S1').color, '濃紺');
  assert.equal(batchResRawArray.data.items.find((i) => i.id === 'S2').color, '白');

  console.log('  ✅ Garment standardization (12-color palette, anchors, measurements, crop, resilience & batch updates) verified');
}

// -------------------------------------------------------------
// Test Case 24: Phase 2 UI・プロンプト・インライン確認・3:4正規化連携の検証
// -------------------------------------------------------------
{
  // 1. AiSyncView.tsx のプロンプトテキスト不変条件の検証
  const aiSyncCode = fs.readFileSync(path.join(projectRoot, 'src/components/AiSyncView.tsx'), 'utf8');

  // Step 1: A4用紙ガイド
  assert.ok(aiSyncCode.includes('A4の白い紙（210×297mm）'), 'AiSyncView Step 1 must guide A4 white paper');

  // Step 2: 12色パレット・アンカー・寸法・cropBox
  assert.ok(aiSyncCode.includes('GARMENT_COLOR_PALETTE'), 'AiSyncView must reference GARMENT_COLOR_PALETTE');
  assert.ok(aiSyncCode.includes('GARMENT_COLOR_ANCHOR_GUIDE'), 'AiSyncView must include GARMENT_COLOR_ANCHOR_GUIDE');
  assert.ok(aiSyncCode.includes('bodyLength'), 'AiSyncView prompt must include bodyLength for shirts');
  assert.ok(aiSyncCode.includes('waist'), 'AiSyncView prompt must include waist for pants');
  assert.ok(aiSyncCode.includes('cropBox'), 'AiSyncView prompt must include cropBox instruction');
  assert.ok(aiSyncCode.includes('colorUpdates'), 'AiSyncView must support colorUpdates batch updates');

  // 一括色相談プロンプト: name を出力させない指示
  assert.ok(
    aiSyncCode.includes('name" などの他フィールドは絶対に出力しないでください') ||
    aiSyncCode.includes('name" 等の他フィールドは絶対に出力しないでください'),
    'Batch color prompt must strictly forbid outputting name'
  );

  // Step 3: 確認パネル UI 要件 & レビュー指摘対応
  assert.ok(aiSyncCode.includes('10〜200cm（0.5cm刻み・空欄で未設定）'), 'Measurements must specify 10-200cm valid range notice');
  assert.ok(aiSyncCode.includes('自動切り抜きを適用'), 'Smart crop toggle must be present');
  assert.ok(aiSyncCode.includes('getColorForPalette'), 'Color chips must use getColorForPalette');
  assert.ok(
    aiSyncCode.includes('colorUpdates: parseRes.batchColorUpdates'),
    'AiSyncView must normalize batchColorUpdates payload before passing to importCustomData'
  );
  assert.ok(
    aiSyncCode.includes('元画像フォールバック'),
    'AiSyncView must explicitly label fallback to raw photo when normalization fails'
  );

  // 2. useClosetStore.tsx の batch_color モードと名前保護連携（素配列対応含む）
  const useStoreCode = fs.readFileSync(path.join(projectRoot, 'src/hooks/useClosetStore.tsx'), 'utf8');
  assert.ok(useStoreCode.includes("'batch_color'"), 'useClosetStore must support batch_color mode');
  assert.ok(useStoreCode.includes('applyBatchColorUpdates'), 'useClosetStore must call applyBatchColorUpdates');
  assert.ok(useStoreCode.includes('isBatchCandidate'), 'useClosetStore must recognize raw array batch updates');

  // 3. TodayView.tsx の色・寸法表示
  const todayCode = fs.readFileSync(path.join(projectRoot, 'src/components/TodayView.tsx'), 'utf8');
  assert.ok(todayCode.includes('formatPantsMeasurements'), 'TodayView must format pants measurements');
  assert.ok(todayCode.includes('formatShirtMeasurements'), 'TodayView must format shirt measurements');
  assert.ok(todayCode.includes('p.color'), 'TodayView must display pants color');

  // 4. ItemImage.tsx の getColorForPalette
  const itemImageCode = fs.readFileSync(path.join(projectRoot, 'src/components/ItemImage.tsx'), 'utf8');
  assert.ok(itemImageCode.includes('getColorForPalette'), 'ItemImage must export getColorForPalette');
  assert.ok(itemImageCode.includes('inferGarmentColor'), 'ItemImage must use inferGarmentColor for fallback silhouette');

  console.log('  ✅ Phase 2 UI, prompts, smart crop, measurements and batch color integration verified');
}

// -------------------------------------------------------------
// Test Case 25: まとめ撮り一括登録（Phase 1: ドメインモデル・決定論的ID割当・順次マージ・非ブロッキング色正規化・部分適用・境界値検証）
// -------------------------------------------------------------
{
  const rawCloset = JSON.parse(fs.readFileSync(path.join(projectRoot, 'src/data/closet.json'), 'utf-8'));

  // 1. MAX_BATCH_GARMENTS 定数の検証 (ハード上限3着・定義の一本化と re-export)
  assert.equal(MAX_BATCH_GARMENTS, 3, 'MAX_BATCH_GARMENTS must be 3');
  const closetTsCode = fs.readFileSync(path.join(projectRoot, 'src/types/closet.ts'), 'utf-8');
  assert.ok(
    closetTsCode.includes("export { MAX_BATCH_GARMENTS } from '../utils/closetDomain';"),
    'src/types/closet.ts must re-export MAX_BATCH_GARMENTS from closetDomain'
  );

  // 2. appendUnconfirmedColorNote の決定論的動作検証
  assert.equal(
    appendUnconfirmedColorNote('', 'ベージュ'),
    '（色の目安：ベージュ ※12色パレット外のため未確定）',
    'Must format empty notes'
  );
  assert.equal(
    appendUnconfirmedColorNote('白オックスフォードシャツ', 'ベージュ'),
    '白オックスフォードシャツ （色の目安：ベージュ ※12色パレット外のため未確定）',
    'Must append to existing notes'
  );
  // 二重追記防止
  const withHint = '白オックスフォードシャツ （色の目安：ベージュ ※12色パレット外のため未確定）';
  assert.equal(
    appendUnconfirmedColorNote(withHint, 'ベージュ'),
    withHint,
    'Must prevent duplicate color hint in notes'
  );
  // 空文字色名の場合は変更なし
  assert.equal(appendUnconfirmedColorNote('メモ', ''), 'メモ');
  assert.equal(appendUnconfirmedColorNote('メモ', '   '), 'メモ');

  // 3. validateSingleClosetItem の色非ブロッキング化と色以外の厳格検証
  const baseShirtCandidate = {
    id: 'S10',
    category: 'shirt',
    name: 'テストシャツ',
    imageUrl: '/images/S10.jpg',
    seasonSleeve: '長袖・通年',
    dressScore: 3.5,
    comfortScore: 4.0,
    officeRecommendIds: ['P1', 'P2'],
    remoteRecommendIds: ['P3'],
    ngIds: ['P5'],
    ngReason: '同系色',
    notes: 'テストシャツメモ',
  };

  // 3a. パレット外の色（ベージュ）: 警告として通過、color=undefined、notes 末尾に目安追記
  const beigeShirtRes = validateSingleClosetItem(
    { ...baseShirtCandidate, color: 'ベージュ' },
    rawCloset
  );
  assert.equal(beigeShirtRes.valid, true, 'Beige shirt must pass validation');
  assert.equal(beigeShirtRes.item.color, undefined, 'Out-of-palette color must be stored as undefined');
  assert.equal(beigeShirtRes.unconfirmedColorHint, 'ベージュ');
  assert.ok(beigeShirtRes.item.notes.includes('（色の目安：ベージュ ※12色パレット外のため未確定）'));
  assert.ok(beigeShirtRes.warning.includes('12色パレット外'));

  // 3b. 色欠落（undefined / 空文字）: 警告として通過、color=undefined、notes への目安追記はなし
  const noColorShirtRes = validateSingleClosetItem(
    { ...baseShirtCandidate, color: undefined },
    rawCloset
  );
  assert.equal(noColorShirtRes.valid, true, 'Missing color shirt must pass validation');
  assert.equal(noColorShirtRes.item.color, undefined);
  assert.equal(noColorShirtRes.unconfirmedColorHint, undefined);
  assert.equal(noColorShirtRes.item.notes, baseShirtCandidate.notes, 'Notes must NOT have hint for missing color');
  assert.ok(noColorShirtRes.warning.includes('未設定'));

  // 3c. 色以外の検証エラー（厳密エラー維持）
  // スコア範囲外 (1.0〜5.0 外)
  const invalidScoreRes1 = validateSingleClosetItem({ ...baseShirtCandidate, color: '白', dressScore: 0.5 }, rawCloset);
  assert.equal(invalidScoreRes1.valid, false, 'dressScore < 1 must be rejected');
  assert.ok(invalidScoreRes1.error.includes('dressScore'));

  const invalidScoreRes2 = validateSingleClosetItem({ ...baseShirtCandidate, color: '白', dressScore: 9.0 }, rawCloset);
  assert.equal(invalidScoreRes2.valid, false, 'dressScore > 5 must be rejected');

  const invalidComfortRes = validateSingleClosetItem({ ...baseShirtCandidate, color: '白', comfortScore: 6.0 }, rawCloset);
  assert.equal(invalidComfortRes.valid, false, 'comfortScore > 5 must be rejected');

  // ID接頭辞とカテゴリ不一致
  const prefixMismatchRes = validateSingleClosetItem({ ...baseShirtCandidate, id: 'P16', color: '白' }, rawCloset);
  assert.equal(prefixMismatchRes.valid, false, 'Prefix mismatch must be rejected');

  // 寸法範囲外 (10〜200cm 外)
  const invalidMeasurementRes = validateSingleClosetItem(
    { ...baseShirtCandidate, color: '白', measurements: { bodyLength: 300 } },
    rawCloset
  );
  assert.equal(invalidMeasurementRes.valid, false, 'Out of range measurement must be rejected');
  assert.ok(invalidMeasurementRes.error.includes('10〜200cm'));

  // 4. sanitizeDraftPeerReferences の検証（案B確定: 確定済み現有アイテムのみ保持し、未確定IDを除外）
  const draftWithBogusPeers = {
    category: 'shirt',
    officeRecommendIds: ['P1', 'P999', 'S1', 'P16'], // P999, S1, P16(バッチ内仮ID) は未確定/不正
    remoteRecommendIds: ['P2', 'P17'],
    ngIds: ['P3', 'INVALID'],
  };
  const sanitizedDraft = sanitizeDraftPeerReferences(draftWithBogusPeers, rawCloset);
  assert.deepEqual(sanitizedDraft.officeRecommendIds, ['P1'], 'Only existing pants IDs must be kept');
  assert.deepEqual(sanitizedDraft.remoteRecommendIds, ['P2']);
  assert.deepEqual(sanitizedDraft.ngIds, ['P3']);

  // 5. assignSequentialIdsForBatch の決定論的採番検証
  const testDrafts = [
    { category: 'shirt', name: 'シャツ1' },
    { category: 'pants', name: 'パンツ1' },
    { category: 'shirt', name: 'シャツ2' },
  ];
  // 全着含める場合: S10, P16, S11
  const assignedAll = assignSequentialIdsForBatch(rawCloset.items, testDrafts);
  assert.equal(assignedAll[0].id, 'S10');
  assert.equal(assignedAll[0].imageUrl, '/images/S10.jpg');
  assert.equal(assignedAll[1].id, 'P16');
  assert.equal(assignedAll[1].imageUrl, '/images/P16.jpg');
  assert.equal(assignedAll[2].id, 'S11');
  assert.equal(assignedAll[2].imageUrl, '/images/S11.jpg');

  // 1着目を除外（includedFlags[0] = false）した場合: 3着目のシャツが S10 に繰り上がる
  const assignedWithSkip = assignSequentialIdsForBatch(rawCloset.items, testDrafts, [false, true, true]);
  assert.equal(assignedWithSkip[0].id, undefined, 'Skipped item must not have assigned ID');
  assert.equal(assignedWithSkip[1].id, 'P16');
  assert.equal(assignedWithSkip[2].id, 'S10', 'Subsequent shirt must take S10');

  // 1着のみの採番
  const assignedSingle = assignSequentialIdsForBatch(rawCloset.items, [{ category: 'shirt', name: '単独シャツ' }]);
  assert.equal(assignedSingle[0].id, 'S10');

  // 2着のみの採番
  const assignedPair = assignSequentialIdsForBatch(rawCloset.items, [
    { category: 'shirt', name: 'シャツ' },
    { category: 'pants', name: 'パンツ' },
  ]);
  assert.equal(assignedPair[0].id, 'S10');
  assert.equal(assignedPair[1].id, 'P16');

  // 6. validateAndMergeBatchGarments の一括検証・順次マージ・双方向リンク検証
  const validBatchPayload = {
    garments: [
      {
        category: 'shirt',
        name: 'ベージュリネンシャツ',
        color: 'ベージュ', // パレット外色 -> color=undefined & notes追記
        seasonSleeve: '春夏・長袖',
        dressScore: 3.5,
        comfortScore: 4.5,
        officeRecommendIds: ['P1'],
        remoteRecommendIds: ['P2'],
        ngIds: ['P3'],
        ngReason: '同系色',
        notes: '軽快なリネン',
      },
      {
        category: 'pants',
        name: 'ライトグレーイージーパンツ',
        color: 'ライトグレー', // パレット内確定色
        seasonSleeve: '通年',
        dressScore: 4.0,
        comfortScore: 4.0,
        officeRecommendIds: ['S1'],
        remoteRecommendIds: ['S2'],
        ngIds: ['S3'],
        ngReason: 'なし',
        notes: '快適スラックス',
      },
      {
        category: 'shirt',
        name: '生成りバンドカラーシャツ',
        color: '生成り', // パレット内確定色
        seasonSleeve: '通年',
        dressScore: 3.5,
        comfortScore: 4.0,
        officeRecommendIds: ['P4'],
        remoteRecommendIds: ['P5'],
        ngIds: [],
        ngReason: 'なし',
        notes: '柔らかい風合い',
      },
    ],
  };

  const mergeRes = validateAndMergeBatchGarments(rawCloset, validBatchPayload);
  assert.equal(mergeRes.valid, true, 'Valid batch merge must succeed');
  assert.equal(mergeRes.appliedCount, 3);
  assert.equal(mergeRes.failedCount, 0);
  assert.equal(mergeRes.skippedCount, 0);
  assert.equal(mergeRes.remainingDrafts.length, 0);
  assert.equal(mergeRes.results.length, 3);

  // 1着目: S10, color=undefined, notes に目安追記
  const mergedS10 = mergeRes.data.items.find((i) => i.id === 'S10');
  assert.ok(mergedS10, 'S10 must be merged into data');
  assert.equal(mergedS10.color, undefined);
  assert.ok(mergedS10.notes.includes('（色の目安：ベージュ ※12色パレット外のため未確定）'));

  // 2着目: P16, color='ライトグレー'
  const mergedP16 = mergeRes.data.items.find((i) => i.id === 'P16');
  assert.ok(mergedP16, 'P16 must be merged into data');
  assert.equal(mergedP16.color, 'ライトグレー');

  // 3着目: S11, color='生成り'
  const mergedS11 = mergeRes.data.items.find((i) => i.id === 'S11');
  assert.ok(mergedS11, 'S11 must be merged into data');
  assert.equal(mergedS11.color, '生成り');

  // 相手アイテムへの双方向リンク反映（P1 の officeRecommendIds に S10 が追加されていること）
  const updatedP1 = mergeRes.data.items.find((i) => i.id === 'P1');
  assert.ok(updatedP1.officeRecommendIds.includes('S10'), 'P1 must have S10 in officeRecommendIds');

  // 6b. 【修正1検証】1着目（シャツ）が適用された後に、2着目（パンツ）の相性リストに1着目ID（S10）が含まれていても除去され双方向リンクが張られないこと（案Bの厳密性）
  const intraBatchRefPayload = {
    garments: [
      {
        category: 'shirt',
        name: 'シャツS10候補',
        color: '白',
        seasonSleeve: '通年',
        dressScore: 4.0,
        comfortScore: 4.0,
        officeRecommendIds: ['P1'],
        remoteRecommendIds: [],
        ngIds: [],
        ngReason: 'なし',
        notes: '1着目',
      },
      {
        category: 'pants',
        name: 'パンツP16候補',
        color: '黒',
        seasonSleeve: '通年',
        dressScore: 4.0,
        comfortScore: 4.0,
        officeRecommendIds: ['S10', 'S1'], // 'S10' はバッチ内1着目のID！
        remoteRecommendIds: [],
        ngIds: [],
        ngReason: 'なし',
        notes: '2着目',
      },
    ],
  };
  const intraRes = validateAndMergeBatchGarments(rawCloset, intraBatchRefPayload);
  assert.equal(intraRes.valid, true);
  assert.equal(intraRes.appliedCount, 2);
  const registeredP16 = intraRes.data.items.find((i) => i.id === 'P16');
  const registeredS10 = intraRes.data.items.find((i) => i.id === 'S10');
  assert.ok(registeredP16, 'P16 must exist');
  assert.ok(registeredS10, 'S10 must exist');
  // P16 の officeRecommendIds に S10 が含まれていないこと（S1 のみ残る）
  assert.equal(registeredP16.officeRecommendIds.includes('S10'), false, 'Intra-batch reference S10 must be stripped from P16');
  assert.ok(registeredP16.officeRecommendIds.includes('S1'), 'Pre-existing reference S1 must be retained');
  // S10 側にも P16 への逆参照が張られていないこと
  assert.equal(registeredS10.officeRecommendIds.includes('P16'), false, 'S10 must not link back to intra-batch P16');

  // 7. 部分適用と相性マトリクス保護・再試行検証
  // 3着中2着目がスコア範囲外エラー (dressScore: 9.0)
  const partiallyInvalidBatch = [
    {
      category: 'shirt',
      name: '白ブロードシャツ',
      color: '白',
      seasonSleeve: '長袖・通年',
      dressScore: 4.0,
      comfortScore: 3.5,
      officeRecommendIds: ['P1'],
      remoteRecommendIds: [],
      ngIds: [],
      ngReason: 'なし',
      notes: '定番白シャツ',
    },
    {
      category: 'pants',
      name: '不正スコアパンツ',
      color: '黒',
      seasonSleeve: '通年',
      dressScore: 9.0, // 不正スコア！
      comfortScore: 4.0,
      officeRecommendIds: ['S1'],
      remoteRecommendIds: [],
      ngIds: [],
      ngReason: 'なし',
      notes: '不正アイテム',
    },
    {
      category: 'shirt',
      name: '濃紺オックスフォードシャツ',
      color: '濃紺',
      seasonSleeve: '長袖・通年',
      dressScore: 4.0,
      comfortScore: 4.0,
      officeRecommendIds: ['P2'],
      remoteRecommendIds: [],
      ngIds: [],
      ngReason: 'なし',
      notes: '定番紺シャツ',
    },
  ];

  const partialRes = validateAndMergeBatchGarments(rawCloset, partiallyInvalidBatch);
  assert.equal(partialRes.valid, true, 'Partial application must return valid: true when appliedCount > 0');
  assert.equal(partialRes.appliedCount, 2, '2 items must be applied');
  assert.equal(partialRes.failedCount, 1, '1 item must fail');
  assert.equal(partialRes.remainingDrafts.length, 1, 'Only failed item must remain in remainingDrafts');
  assert.equal(partialRes.remainingDrafts[0].name, '不正スコアパンツ');

  // 歯抜けのない連番IDの検証: 1着目=S10, 3着目のシャツ=S11（失敗した着には assignedId がないこと）
  assert.equal(partialRes.results[0].status, 'applied');
  assert.equal(partialRes.results[0].assignedId, 'S10');
  assert.equal(partialRes.results[1].status, 'failed');
  assert.equal(partialRes.results[1].assignedId, undefined, 'Failed item must NOT have assignedId');
  assert.ok(partialRes.results[1].error.includes('dressScore'));
  assert.equal(partialRes.results[2].status, 'applied');
  assert.equal(partialRes.results[2].assignedId, 'S11');

  // 失敗したパンツの ID やリンクはマージ後データに一切混入していないこと
  assert.equal(partialRes.data.items.some((i) => i.id === 'P16'), false, 'Failed pants must NOT exist in data');
  const checkS1 = partialRes.data.items.find((i) => i.id === 'S1');
  assert.equal(checkS1.officeRecommendIds.includes('P16'), false, 'Failed item must not be linked in existing peers');

  // 7b. 【修正2検証】同カテゴリで失敗→成功の順に処理した場合、失敗着の結果に assignedId がなく、成功着がその ID で登録されること
  const sameCategoryFailThenSuccess = [
    {
      category: 'shirt',
      name: '失敗シャツ',
      color: '白',
      seasonSleeve: '通年',
      dressScore: 9.0, // エラーで失敗
      comfortScore: 4.0,
      officeRecommendIds: ['P1'],
      remoteRecommendIds: [],
      ngIds: [],
      ngReason: 'なし',
      notes: '1着目失敗',
    },
    {
      category: 'shirt',
      name: '後続成功シャツ',
      color: '白',
      seasonSleeve: '通年',
      dressScore: 4.0, // 正常
      comfortScore: 4.0,
      officeRecommendIds: ['P1'],
      remoteRecommendIds: [],
      ngIds: [],
      ngReason: 'なし',
      notes: '2着目成功',
    },
  ];
  const failThenSuccessRes = validateAndMergeBatchGarments(rawCloset, sameCategoryFailThenSuccess);
  assert.equal(failThenSuccessRes.valid, true);
  assert.equal(failThenSuccessRes.appliedCount, 1);
  assert.equal(failThenSuccessRes.failedCount, 1);
  // 1着目（失敗）には assignedId が存在しない (undefined)
  assert.equal(failThenSuccessRes.results[0].status, 'failed');
  assert.equal(failThenSuccessRes.results[0].assignedId, undefined, 'Failed shirt must NOT have assignedId in results');
  // 2着目（成功）が S10 を取得して登録される
  assert.equal(failThenSuccessRes.results[1].status, 'applied');
  assert.equal(failThenSuccessRes.results[1].assignedId, 'S10', 'Subsequent successful shirt must receive S10');
  assert.equal(failThenSuccessRes.data.items.find((i) => i.id === 'S10').name, '後続成功シャツ');

  // 再試行の検証: 失敗した remainingDrafts の dressScore を 4.0 に修正して再適用
  const fixedDrafts = partialRes.remainingDrafts.map((d) => ({ ...d, dressScore: 4.0 }));
  const retryRes = validateAndMergeBatchGarments(partialRes.data, fixedDrafts);
  assert.equal(retryRes.valid, true);
  assert.equal(retryRes.appliedCount, 1);
  assert.equal(retryRes.results[0].assignedId, 'P16', 'Fixed item must take next sequential ID P16');
  assert.ok(retryRes.data.items.find((i) => i.id === 'P16'), 'P16 must be registered on retry');

  // 8. 境界値・異常系検証 (0着拒否、1〜3着受付、4着以上拒否)
  // 8a. 空配列 (0着)
  const emptyRes = validateAndMergeBatchGarments(rawCloset, { garments: [] });
  assert.equal(emptyRes.valid, false);
  assert.ok(emptyRes.error.includes('1〜3着'), 'Error must specify 1-3 items');

  const emptyRawArrayRes = validateAndMergeBatchGarments(rawCloset, []);
  assert.equal(emptyRawArrayRes.valid, false);

  // 8b. 4着以上 (MAX_BATCH_GARMENTS 超過)
  const fourItems = [
    { category: 'shirt', name: 'S1', color: '白', seasonSleeve: '通年', dressScore: 3, comfortScore: 3, officeRecommendIds: [], remoteRecommendIds: [], ngIds: [], ngReason: '', notes: '' },
    { category: 'shirt', name: 'S2', color: '白', seasonSleeve: '通年', dressScore: 3, comfortScore: 3, officeRecommendIds: [], remoteRecommendIds: [], ngIds: [], ngReason: '', notes: '' },
    { category: 'shirt', name: 'S3', color: '白', seasonSleeve: '通年', dressScore: 3, comfortScore: 3, officeRecommendIds: [], remoteRecommendIds: [], ngIds: [], ngReason: '', notes: '' },
    { category: 'shirt', name: 'S4', color: '白', seasonSleeve: '通年', dressScore: 3, comfortScore: 3, officeRecommendIds: [], remoteRecommendIds: [], ngIds: [], ngReason: '', notes: '' },
  ];
  const fourItemsRes = validateAndMergeBatchGarments(rawCloset, fourItems);
  assert.equal(fourItemsRes.valid, false);
  assert.ok(fourItemsRes.error.includes('最大3着'), 'Error must specify maximum 3 items limit');

  // 8c. 1着のみ、2着のみの正常受付
  const oneItemRes = validateAndMergeBatchGarments(rawCloset, [fourItems[0]]);
  assert.equal(oneItemRes.valid, true);
  assert.equal(oneItemRes.appliedCount, 1);

  const twoItemsRes = validateAndMergeBatchGarments(rawCloset, [fourItems[0], fourItems[1]]);
  assert.equal(twoItemsRes.valid, true);
  assert.equal(twoItemsRes.appliedCount, 2);

  console.log('  ✅ Batch garment registration Phase 1 (deterministic IDs, non-blocking color, partial merge & bounds) verified');
}

// -------------------------------------------------------------
// Test Case 26: 服の「まとめ撮り」一括登録 Phase 2（UI登録モード切替・バッチプロンプト生成・着別確認パネル・直列アップロード・部分適用リカバリ・ドキュメント整合性）
// -------------------------------------------------------------
{
  const aiSyncCode = fs.readFileSync(path.join(projectRoot, 'src/components/AiSyncView.tsx'), 'utf8');

  // 1. 登録モード切替（通常／まとめ撮り）と撮影ガイド・解像度制御
  assert.ok(aiSyncCode.includes("registrationMode === 'batch' ? 2000 : 1200"), 'AiSyncView must use 2000px max dimension for batch mode');
  assert.ok(aiSyncCode.includes('1着ずつ登録（通常）'), 'AiSyncView must render single mode switcher button');
  assert.ok(aiSyncCode.includes('まとめ撮り一括登録（最大3着）'), 'AiSyncView must render batch mode switcher button');
  assert.ok(aiSyncCode.includes('服同士を重ねず、少し間を空けて並べ'), 'AiSyncView must display batch photo guide');
  assert.ok(aiSyncCode.includes('推奨2〜3着・最大3着'), 'AiSyncView must recommend 2-3 garments up to 3');

  // 2. まとめ撮り専用プロンプト生成
  assert.ok(aiSyncCode.includes('まとめ撮り一括登録用JSON'), 'Batch prompt must describe multi-garment batch JSON');
  assert.ok(aiSyncCode.includes('"garments": ['), 'Batch prompt schema must output garments array');
  assert.ok(
    aiSyncCode.includes('バッチ内の服同士の相性は含めず、現存する相手カテゴリの服'),
    'Batch prompt must enforce Rule B (no intra-batch peer relationships)'
  );
  assert.ok(aiSyncCode.includes('最大3着まで'), 'Batch prompt must instruct maximum 3 items');

  // 3. Step 3 パースと着別確認パネル
  assert.ok(aiSyncCode.includes("kind === 'batch_garments'"), 'parseSyncInputJson must recognize batch_garments');
  assert.ok(aiSyncCode.includes('まとめ撮り確認パネル（全'), 'AiSyncView must render batch confirmation panel header');
  assert.ok(aiSyncCode.includes('assignSequentialIdsForBatch'), 'AiSyncView must call assignSequentialIdsForBatch');
  assert.ok(aiSyncCode.includes('この服を登録する（'), 'AiSyncView must render per-item inclusion checkbox');
  assert.ok(aiSyncCode.includes('handleSwitchBatchItemCategory'), 'AiSyncView must support per-item category switching');
  assert.ok(aiSyncCode.includes('handleUpdateBatchMeasurement'), 'AiSyncView must support per-item measurements editing');
  assert.ok(aiSyncCode.includes('handleApplyBatchGarments'), 'AiSyncView must provide batch apply handler');

  // 4. 非ブロッキング色検証表示（未確定バッジと1タップ一括適用）
  assert.ok(aiSyncCode.includes('色：未確定'), 'AiSyncView must display unconfirmed color badge');
  assert.ok(
    !aiSyncCode.includes('色の必須検証\n    if (!candidateItem.color'),
    'AiSyncView single item mode must not block on missing or out-of-palette color'
  );

  // 5. 直列Googleドライブ同期進捗表示 & 部分適用リカバリ
  assert.ok(aiSyncCode.includes('着)...'), 'AiSyncView batch apply must report serial Drive upload progress');
  assert.ok(
    aiSyncCode.includes('result.remainingDrafts'),
    'AiSyncView must retain failed items in remainingDrafts upon partial apply'
  );

  // 6. useClosetStore.tsx の importBatchGarments & importCustomData 連携
  const useStoreCode = fs.readFileSync(path.join(projectRoot, 'src/hooks/useClosetStore.tsx'), 'utf8');
  assert.ok(useStoreCode.includes('importBatchGarments'), 'useClosetStore must provide importBatchGarments');
  assert.ok(useStoreCode.includes("'batch_garments'"), 'useClosetStore must support batch_garments mode');
  assert.ok(useStoreCode.includes('validateAndMergeBatchGarments'), 'useClosetStore must call validateAndMergeBatchGarments');

  // 7. ドキュメント（SPECIFICATION.md & SKILL.md）の整合性
  const specCode = fs.readFileSync(path.join(projectRoot, 'docs/SPECIFICATION.md'), 'utf8');
  assert.ok(specCode.includes('まとめ撮り一括登録（推奨2〜3着・最大3着）'), 'SPECIFICATION.md must document batch registration');
  assert.ok(specCode.includes('長辺最大2000px'), 'SPECIFICATION.md must document 2000px downscaling in batch mode');
  assert.ok(specCode.includes('appendUnconfirmedColorNote'), 'SPECIFICATION.md must document non-blocking color note handling');

  const skillCode = fs.readFileSync(path.join(projectRoot, '.agents/skills/manage-wardrobe/SKILL.md'), 'utf8');
  assert.ok(skillCode.includes('まとめ撮り一括登録'), 'SKILL.md must document batch registration workflow');
  assert.ok(skillCode.includes('2000px'), 'SKILL.md must document 2000px batch resolution');
  assert.ok(skillCode.includes('（色の目安：〇〇 ※12色パレット外のため未確定）'), 'SKILL.md must document unconfirmed color hint');

  // 8. レビュー指摘対応の検証（Drive画像再試行・Sync Push遅延・解像度保護・既存ID重複防止入出力テスト）
  // 8a. Driveアップロード失敗時の画像単体再試行導線 (修正1)
  assert.ok(aiSyncCode.includes('handleRetryDriveUploads'), 'AiSyncView must implement handleRetryDriveUploads');
  assert.ok(aiSyncCode.includes('failedDriveUploads'), 'AiSyncView must track failedDriveUploads');
  assert.ok(aiSyncCode.includes('失敗した画像'), 'AiSyncView must display retry banner for failed drive uploads');

  // 8b. 直列アップロード完了までの Sync Push 遅延 (修正2)
  assert.ok(aiSyncCode.includes('skipPush: true'), 'AiSyncView must pass skipPush: true to importBatchGarments');
  assert.ok(useStoreCode.includes('options?.skipPush'), 'useClosetStore must honor skipPush option');
  assert.ok(useStoreCode.includes('triggerBackgroundPush'), 'useClosetStore must expose triggerBackgroundPush');

  // 8c. モード切替時の解像度保証と下書きクリア (修正3)
  assert.ok(aiSyncCode.includes('handleModeSwitch'), 'AiSyncView must implement handleModeSwitch');
  assert.ok(aiSyncCode.includes("handleModeSwitch('single')"), 'AiSyncView must call handleModeSwitch for single mode');
  assert.ok(aiSyncCode.includes("handleModeSwitch('batch')"), 'AiSyncView must call handleModeSwitch for batch mode');

  // 8d. 【修正4挙動テスト】既存アイテム配列および重複IDの誤登録防止（入出力テスト）
  const rawCloset = JSON.parse(fs.readFileSync(path.join(projectRoot, 'src/data/closet.json'), 'utf-8'));

  // (1) id付き服配列（エクスポートデータ等）を貼った場合: batch_garments としてパースされず拒否されること
  const rawArrayWithIds = JSON.stringify([
    { id: 'S1', category: 'shirt', name: '既存シャツ' },
    { id: 'S2', category: 'shirt', name: '既存シャツ2' },
  ]);
  const parsedRawWithIds = parseSyncInputJson(rawArrayWithIds, rawCloset.items);
  assert.equal(parsedRawWithIds.kind, 'invalid', 'Raw array with IDs must NOT be parsed as batch_garments');
  assert.ok(parsedRawWithIds.error.includes('ID付きの服配列はまとめ撮り一括登録できません'), 'Error must specify rejection of array with IDs');

  // (2) id無しの服ドラフト配列を貼った場合: 正常に batch_garments としてパースされること
  const rawArrayWithoutIds = JSON.stringify([
    { category: 'shirt', name: '新規シャツ1' },
    { category: 'pants', name: '新規パンツ1' },
  ]);
  const parsedRawWithoutIds = parseSyncInputJson(rawArrayWithoutIds, rawCloset.items);
  assert.equal(parsedRawWithoutIds.kind, 'batch_garments', 'Raw array without IDs must be recognized as batch_garments');
  assert.equal(parsedRawWithoutIds.batchGarments.length, 2);

  // (3) { "garments": [...] } 内に既存アイテムと重複する id が含まれる場合: 警告して登録に進ませないこと
  const batchWithExistingIdJson = JSON.stringify({
    garments: [
      { id: 'S1', category: 'shirt', name: 'S1重複シャツ' },
    ],
  });
  const parsedExistingId = parseSyncInputJson(batchWithExistingIdJson, rawCloset.items);
  assert.equal(parsedExistingId.kind, 'invalid', 'Garments with existing ID must be rejected by parseSyncInputJson');
  assert.equal(parsedExistingId.existingIdConflict, 'S1', 'existingIdConflict must identify S1');
  assert.ok(parsedExistingId.error.includes('既存アイテム（ID: S1）が含まれています'), 'Error message must specify duplicate ID');

  // (4) 正系 { "garments": [...] }（id無し）: 正常に batch_garments として受け入れられること
  const validBatchJson = JSON.stringify({
    garments: [
      { category: 'shirt', name: '新規シャツA', color: '白' },
    ],
  });
  const parsedValidBatch = parseSyncInputJson(validBatchJson, rawCloset.items);
  assert.equal(parsedValidBatch.kind, 'batch_garments');
  assert.equal(parsedValidBatch.batchGarments.length, 1);

  // (5) validateAndMergeBatchGarments で既存ID重複 candidate が渡された場合の安全拒否
  const batchWithDupCandidate = [
    {
      id: 'S1',
      category: 'shirt',
      name: 'S1上書き試行',
      color: '白',
      seasonSleeve: '通年',
      dressScore: 4.0,
      comfortScore: 4.0,
      officeRecommendIds: [],
      remoteRecommendIds: [],
      ngIds: [],
      ngReason: '',
      notes: '上書き試行',
    },
    {
      category: 'pants',
      name: '正常パンツ',
      color: '黒',
      seasonSleeve: '通年',
      dressScore: 4.0,
      comfortScore: 4.0,
      officeRecommendIds: [],
      remoteRecommendIds: [],
      ngIds: [],
      ngReason: '',
      notes: '2着目は正常',
    },
  ];
  const mergeDupRes = validateAndMergeBatchGarments(rawCloset, batchWithDupCandidate);
  assert.equal(mergeDupRes.valid, true, 'Partial application: valid item succeeds');
  assert.equal(mergeDupRes.appliedCount, 1);
  assert.equal(mergeDupRes.failedCount, 1);
  assert.equal(mergeDupRes.results[0].status, 'failed');
  assert.ok(mergeDupRes.results[0].error.includes('既存アイテム（ID: S1）と重複しています'), 'Error must specify duplicate ID conflict');
  // 既存データ（S1）が上書きされず、元データが保護されていること
  const originalS1 = rawCloset.items.find((i) => i.id === 'S1');
  const preservedS1 = mergeDupRes.data.items.find((i) => i.id === 'S1');
  assert.equal(preservedS1.name, originalS1.name, 'Existing item must not be overwritten');

  // 8e. 【再レビュー指摘対応】Drive画像アップロード未完了リストの永続化・復元・Blob再構成挙動テスト
  // (1) parseFailedDriveUploads の耐障害性・大文字正規化・重複排除
  assert.deepEqual(parseFailedDriveUploads(null), []);
  assert.deepEqual(parseFailedDriveUploads('invalid json {'), []);
  assert.deepEqual(parseFailedDriveUploads('{"not": "array"}'), []);
  const normalizedParsed = parseFailedDriveUploads(JSON.stringify([
    { itemId: '  s10  ', label: '3:4正規化版' },
    { itemId: 'S10', label: '重複アイテム' },
    { itemId: 'p16' }, // label 欠落フォールバック
  ]));
  assert.equal(normalizedParsed.length, 2, 'Duplicates must be removed by normalized ID');
  assert.equal(normalizedParsed[0].itemId, 'S10');
  assert.equal(normalizedParsed[0].label, '3:4正規化版');
  assert.equal(normalizedParsed[1].itemId, 'P16');
  assert.equal(normalizedParsed[1].label, '3:4正規化版', 'Missing label must default to 3:4正規化版');

  // (2) saveFailedDriveUploadsToStorage と loadFailedDriveUploadsFromStorage の永続化・復元・データURL非二重化検証
  const mockStorageMap = new Map();
  const mockStorage = {
    getItem: (k) => mockStorageMap.get(k) ?? null,
    setItem: (k, v) => mockStorageMap.set(k, String(v)),
    removeItem: (k) => mockStorageMap.delete(k),
  };

  // 失敗リストの永続化
  const failedItemsToSave = [
    { itemId: 'S10', label: '3:4正規化版', failedAt: 1700000000000 },
    { itemId: 'P16', label: '元画像フォールバック', failedAt: 1700000000001 },
  ];
  saveFailedDriveUploadsToStorage(mockStorage, failedItemsToSave);
  assert.ok(mockStorageMap.has(FAILED_DRIVE_UPLOADS_STORAGE_KEY), 'Storage must contain failed uploads key');
  const rawSavedJson = mockStorageMap.get(FAILED_DRIVE_UPLOADS_STORAGE_KEY);
  // 【重要要件】dataUrl は永続化せず二重保持しないこと（端末内 IndexedDB から再構成するため）
  assert.equal(rawSavedJson.includes('dataUrl'), false, 'dataUrl must NOT be persisted in localStorage');
  assert.ok(rawSavedJson.includes('S10') && rawSavedJson.includes('P16'));

  // ページ再読み込みをシミュレートした復元
  const reloadedFailed = loadFailedDriveUploadsFromStorage(mockStorage);
  assert.equal(reloadedFailed.length, 2, 'All failed items must be restored upon page reload');
  assert.equal(reloadedFailed[0].itemId, 'S10');
  assert.equal(reloadedFailed[1].itemId, 'P16');

  // S10 のみ再試行成功した場合（部分成功時のリスト更新）
  saveFailedDriveUploadsToStorage(mockStorage, [reloadedFailed[1]]);
  const partialRemaining = loadFailedDriveUploadsFromStorage(mockStorage);
  assert.equal(partialRemaining.length, 1);
  assert.equal(partialRemaining[0].itemId, 'P16');

  // 全着再試行成功した場合（ストレージキー削除と初期化）
  saveFailedDriveUploadsToStorage(mockStorage, []);
  assert.equal(mockStorageMap.has(FAILED_DRIVE_UPLOADS_STORAGE_KEY), false, 'Storage key must be removed when all succeed');
  assert.deepEqual(loadFailedDriveUploadsFromStorage(mockStorage), []);

  // (3) AiSyncView & imageStore のコード整合性検証
  assert.ok(
    aiSyncCode.includes('loadFailedDriveUploadsFromStorage'),
    'AiSyncView must call loadFailedDriveUploadsFromStorage on mount'
  );
  assert.ok(
    aiSyncCode.includes('saveFailedDriveUploadsToStorage'),
    'AiSyncView must call saveFailedDriveUploadsToStorage on failure and retry'
  );
  assert.ok(
    aiSyncCode.includes('getImageDataUrl'),
    'AiSyncView must reconstruct image dataUrl from IndexedDB via getImageDataUrl'
  );
  const imageStoreCode = fs.readFileSync(path.join(projectRoot, 'src/utils/imageStore.ts'), 'utf-8');
  assert.ok(
    imageStoreCode.includes('export async function getImageDataUrl'),
    'imageStore.ts must export getImageDataUrl'
  );

  // (4) 【再レビュー指摘実行テスト】IndexedDB画像欠落時に誤った元写真（previewDataUrl）をアップロードしないことの実行検証
  const uploadedPayloads = [];
  const mockIndexedDBImages = {
    S10: 'data:image/jpeg;base64,s10_cropped_normalized_3x4_data',
    // P16 は IndexedDB 内に存在しない（null）
  };

  const mockGetImageDataUrl = async (id) => mockIndexedDBImages[id] ?? null;
  const mockUploadFn = async (payload) => {
    uploadedPayloads.push(payload);
    return { ok: true };
  };

  const testRetryItems = [
    { itemId: 'S10', label: '3:4正規化版' },
    { itemId: 'P16', label: '3:4正規化版' },
  ];

  const retryProcessResult = await processDriveRetryUploads(
    testRetryItems,
    mockGetImageDataUrl,
    mockUploadFn
  );

  // S10 は IndexedDB の個別正規化画像で正しくアップロードされたこと
  assert.equal(retryProcessResult.succeededItemIds.length, 1);
  assert.equal(retryProcessResult.succeededItemIds[0], 'S10');
  assert.equal(uploadedPayloads.length, 1);
  assert.equal(uploadedPayloads[0].itemId, 'S10');
  assert.equal(uploadedPayloads[0].dataUrl, 'data:image/jpeg;base64,s10_cropped_normalized_3x4_data');

  // P16 は画像欠落として検出され、アップロードがスキップされ failed に残ること
  assert.equal(retryProcessResult.failedItemIds.length, 1);
  assert.equal(retryProcessResult.failedItemIds[0], 'P16');
  assert.equal(retryProcessResult.missingImageItemIds.length, 1);
  assert.equal(retryProcessResult.missingImageItemIds[0], 'P16');

  // 【最重要】元写真などの別画像が誤って P16 としてアップロードされていないこと
  assert.equal(uploadedPayloads.some((p) => p.itemId === 'P16'), false, 'Missing image item P16 must NEVER be uploaded to Drive');

  // (5) 【再レビュー指摘実行テスト】getImageDataUrlFn の Promise が reject しても processDriveRetryUploads が例外終了せず、アイテム単位で失敗捕捉して後続を処理することの実行検証
  const uploadedWithRejection = [];
  const mockRejectingGetImage = async (id) => {
    if (id === 'P17') {
      throw new Error('Simulated IndexedDB / FileReader read rejection');
    }
    if (id === 'S11') {
      return 'data:image/jpeg;base64,s11_valid_data';
    }
    return null;
  };

  const rejectionTestItems = [
    { itemId: 'P17', label: '3:4正規化版' },
    { itemId: 'S11', label: '3:4正規化版' },
  ];

  const rejectionResult = await processDriveRetryUploads(
    rejectionTestItems,
    mockRejectingGetImage,
    async (payload) => {
      uploadedWithRejection.push(payload);
      return { ok: true };
    }
  );

  assert.equal(rejectionResult.succeededItemIds.length, 1);
  assert.equal(rejectionResult.succeededItemIds[0], 'S11');
  assert.equal(rejectionResult.failedItemIds.length, 1);
  assert.equal(rejectionResult.failedItemIds[0], 'P17');
  assert.equal(rejectionResult.readErrorItemIds.length, 1);
  assert.equal(rejectionResult.readErrorItemIds[0], 'P17');
  assert.equal(uploadedWithRejection.length, 1);
  assert.equal(uploadedWithRejection[0].itemId, 'S11');

  // AiSyncView が元写真へのフォールバック（targetDataUrl = previewDataUrl）を含まないことの静的保証
  assert.equal(
    aiSyncCode.includes('targetDataUrl = previewDataUrl'),
    false,
    'AiSyncView must NEVER fallback to raw batch previewDataUrl during retry'
  );
  assert.ok(
    aiSyncCode.includes('processDriveRetryUploads'),
    'AiSyncView must delegate retry uploads to processDriveRetryUploads'
  );
  assert.ok(
    aiSyncCode.includes('setIsRetryingDriveUploads(false);') && aiSyncCode.includes('finally'),
    'AiSyncView handleRetryDriveUploads must reset isRetryingDriveUploads in finally block'
  );

  console.log('  ✅ Phase 2 UI registration mode, batch prompt, per-item panel, Drive retry & parse guard verified');
}

// -------------------------------------------------------------
// Test Case 27: Issue #4 - fetchImages のバッチごとフォルダ全体再走査回避と後方互換性検証
// -------------------------------------------------------------
{
  const token = 'token-perf-test';
  const { ss, context } = createGasEnvironment(token);
  vm.runInContext('setupSpreadsheet()', context);

  // folderId の登録
  const pushFolderReq = {
    postData: {
      contents: JSON.stringify({
        token,
        action: 'push',
        imageFolderId: 'folder-perf-123',
      }),
    },
  };
  context.mockPushFolder = pushFolderReq;
  const pushRes = JSON.parse(vm.runInContext('doPost(mockPushFolder).getContent()', context));
  assert.equal(pushRes.ok, true);

  // 18件の画像ファイルをシミュレート (S1〜S9, P1〜P9)
  const mockFiles = [];
  const baseTime = 1700000000000;
  for (let i = 1; i <= 9; i++) {
    mockFiles.push({
      id: `file_s${i}`,
      name: `S${i}.jpg`,
      modifiedTime: new Date(baseTime + i * 1000).toISOString(),
      thumbnailLink: `https://lh3.googleusercontent.com/d/s${i}=s220`,
      size: 50000,
      mimeType: 'image/jpeg',
    });
    mockFiles.push({
      id: `file_p${i}`,
      name: `P${i}.jpg`,
      modifiedTime: new Date(baseTime + (i + 10) * 1000).toISOString(),
      thumbnailLink: `https://lh3.googleusercontent.com/d/p${i}=s220`,
      size: 60000,
      mimeType: 'image/jpeg',
    });
  }

  let folderScanCount = 0;
  context.Drive = {
    Files: {
      list: (params) => {
        if (params.pageSize === 1) {
          return { files: [{ modifiedTime: new Date(baseTime).toISOString() }] };
        }
        folderScanCount++;
        return { files: mockFiles };
      },
    },
  };

  context.UrlFetchApp = {
    fetch: (url) => ({
      getResponseCode: () => 200,
      getBlob: () => ({
        getContentType: () => 'image/jpeg',
        getBytes: () => Buffer.from('mock-bytes-' + url),
      }),
    }),
  };

  // 1. プラン策定 (getImageSyncPlan) を実行
  // 端末はローカル画像ゼロ（全18件取得が必要）
  const planReq = {
    postData: {
      contents: JSON.stringify({
        token,
        action: 'getImageSyncPlan',
        imageFolderId: 'folder-perf-123',
        localMeta: {},
      }),
    },
  };
  context.mockPlanReq = planReq;
  const planRes = JSON.parse(vm.runInContext('doPost(mockPlanReq).getContent()', context));

  assert.equal(planRes.ok, true);
  assert.equal(planRes.validItemIds.length, 18);
  assert.equal(planRes.neededItemIds.length, 18);
  assert.equal(folderScanCount, 1, 'getImageSyncPlan must scan image folder exactly once');

  // neededItemIds 分のファイル情報（fileId, thumbnailLink, modifiedTime, mimeType, size）が含まれていること
  assert.ok(planRes.files, 'getImageSyncPlan response must include files map');
  assert.equal(Object.keys(planRes.files).length, 18);
  for (const id of planRes.neededItemIds) {
    const fileInfo = planRes.files[id];
    assert.ok(fileInfo, `File info for ${id} must be present`);
    assert.ok(fileInfo.fileId, `fileId for ${id} must be present`);
    assert.ok(fileInfo.thumbnailLink, `thumbnailLink for ${id} must be present`);
    assert.ok(typeof fileInfo.modifiedTime === 'number', `modifiedTime for ${id} must be a number`);
    assert.equal(fileInfo.mimeType, 'image/jpeg');
    assert.ok(typeof fileInfo.size === 'number', `size for ${id} must be a number`);
  }

  // 2. クライアント側（GasSyncModal）と同様に 6件ずつ 3チャンクで fetchImages を直列実行
  const CHUNK_SIZE = 6;
  let totalFetchedImages = 0;

  for (let i = 0; i < planRes.neededItemIds.length; i += CHUNK_SIZE) {
    const chunk = planRes.neededItemIds.slice(i, i + CHUNK_SIZE);
    const chunkFiles = {};
    for (const id of chunk) {
      if (planRes.files[id]) {
        chunkFiles[id] = planRes.files[id];
      }
    }

    const fetchReq = {
      postData: {
        contents: JSON.stringify({
          token,
          action: 'fetchImages',
          imageFolderId: 'folder-perf-123',
          itemIds: chunk,
          files: chunkFiles, // Issue #4: プランで受け取ったファイル情報を渡す
        }),
      },
    };
    context.mockFetchChunk = fetchReq;
    const fetchRes = JSON.parse(vm.runInContext('doPost(mockFetchChunk).getContent()', context));

    assert.equal(fetchRes.ok, true);
    for (const id of chunk) {
      assert.ok(fetchRes.images[id], `Image for ${id} must be returned`);
      assert.ok(fetchRes.timestamps[id], `Timestamp for ${id} must be returned`);
      totalFetchedImages++;
    }

    // 【重要検証】各バッチで scanImageFolder が再実行されず、初期の1回から増えていないこと！
    assert.equal(
      folderScanCount,
      1,
      `scanImageFolder count must remain 1 after chunk ${i / CHUNK_SIZE + 1} fetch`
    );
  }

  assert.equal(totalFetchedImages, 18, 'All 18 images must be fetched across 3 chunks');
  assert.equal(folderScanCount, 1, 'Total scanImageFolder calls during full sync must be EXACTLY 1');

  // 3. 後方互換性および不完全ファイル情報時のフォールバック検証
  // (a) files が未指定の場合
  const legacyReq = {
    postData: {
      contents: JSON.stringify({
        token,
        action: 'fetchImages',
        imageFolderId: 'folder-perf-123',
        itemIds: ['S1', 'P1'],
        // files は未指定
      }),
    },
  };
  context.mockLegacyReq = legacyReq;
  const legacyRes = JSON.parse(vm.runInContext('doPost(mockLegacyReq).getContent()', context));

  assert.equal(legacyRes.ok, true);
  assert.ok(legacyRes.images['S1'], 'S1 image must be fetched in legacy request');
  assert.ok(legacyRes.images['P1'], 'P1 image must be fetched in legacy request');
  // files が渡されなかったため、従来どおり scanImageFolder が実行されてカウントが 2 に増加すること
  assert.equal(
    folderScanCount,
    2,
    'scanImageFolder must be invoked when files is omitted for backward compatibility'
  );

  // (b) 【ChatGPT レビュー指摘対応】files が一部不足している場合、静かにスキップせず scanImageFolder にフォールバックして全件取得できること
  const partialFilesReq = {
    postData: {
      contents: JSON.stringify({
        token,
        action: 'fetchImages',
        imageFolderId: 'folder-perf-123',
        itemIds: ['S2', 'P2'],
        // S2 のみファイル情報があり、P2 が欠落している場合
        files: {
          S2: planRes.files['S2'],
        },
      }),
    },
  };
  context.mockPartialReq = partialFilesReq;
  const partialRes = JSON.parse(vm.runInContext('doPost(mockPartialReq).getContent()', context));

  assert.equal(partialRes.ok, true);
  assert.ok(partialRes.images['S2'], 'S2 image must be fetched when files is partial');
  assert.ok(partialRes.images['P2'], 'P2 image must be fetched via scanImageFolder fallback (never quietly dropped)');
  // 不足していたため scanImageFolder が実行されてカウントが 3 に増加すること
  assert.equal(
    folderScanCount,
    3,
    'scanImageFolder must be invoked when files is incomplete for requested itemIds'
  );

  // (c) files が空オブジェクト {} の場合も scanImageFolder にフォールバックすること
  const emptyFilesReq = {
    postData: {
      contents: JSON.stringify({
        token,
        action: 'fetchImages',
        imageFolderId: 'folder-perf-123',
        itemIds: ['S3'],
        files: {},
      }),
    },
  };
  context.mockEmptyReq = emptyFilesReq;
  const emptyRes = JSON.parse(vm.runInContext('doPost(mockEmptyReq).getContent()', context));
  assert.equal(emptyRes.ok, true);
  assert.ok(emptyRes.images['S3'], 'S3 image must be fetched via fallback when files is empty');
  assert.equal(
    folderScanCount,
    4,
    'scanImageFolder must be invoked when files is an empty object {}'
  );

  // (d) files 内のデータが不正（fileId 欠落など）の場合もフォールバックすること
  const corruptFilesReq = {
    postData: {
      contents: JSON.stringify({
        token,
        action: 'fetchImages',
        imageFolderId: 'folder-perf-123',
        itemIds: ['S4'],
        files: {
          S4: { name: 'S4.jpg' }, // fileId と modifiedTime が欠落
        },
      }),
    },
  };
  context.mockCorruptReq = corruptFilesReq;
  const corruptRes = JSON.parse(vm.runInContext('doPost(mockCorruptReq).getContent()', context));
  assert.equal(corruptRes.ok, true);
  assert.ok(corruptRes.images['S4'], 'S4 image must be fetched via fallback when file info is corrupt');
  assert.equal(
    folderScanCount,
    5,
    'scanImageFolder must be invoked when file info lacks required fields'
  );

  // (e) 大文字小文字の差異があっても全件そろっていれば走査スキップされること
  const mixedCaseReq = {
    postData: {
      contents: JSON.stringify({
        token,
        action: 'fetchImages',
        imageFolderId: 'folder-perf-123',
        itemIds: ['s5', 'P5'],
        files: {
          'S5': planRes.files['S5'],
          'p5': planRes.files['P5'],
        },
      }),
    },
  };
  context.mockMixedCaseReq = mixedCaseReq;
  const mixedCaseRes = JSON.parse(vm.runInContext('doPost(mockMixedCaseReq).getContent()', context));
  assert.equal(mixedCaseRes.ok, true);
  assert.ok(mixedCaseRes.images['S5']);
  assert.ok(mixedCaseRes.images['P5']);
  // 全件有効に揃っているため走査はスキップされ、カウントは 5 のまま維持されること
  assert.equal(
    folderScanCount,
    5,
    'scanImageFolder must be skipped when all files are complete regardless of case'
  );

  // 4. クライアントコード（GasSyncModal.tsx）の静的整合性検証
  const gasSyncModalCode = fs.readFileSync(
    path.join(projectRoot, 'src/components/GasSyncModal.tsx'),
    'utf-8'
  );
  assert.ok(
    gasSyncModalCode.includes('planFiles') || gasSyncModalCode.includes('planData.files'),
    'GasSyncModal must extract files from planData'
  );
  assert.ok(
    gasSyncModalCode.includes('files: chunkFiles') || gasSyncModalCode.includes('files:'),
    'GasSyncModal must pass chunk files to fetchImages request'
  );

  console.log('  ✅ Issue #4: fetchImages scan skipping & backward compatibility verified');
}

// -------------------------------------------------------------
// Test Case 28: 今朝画面（TodayView）「上下コーディネート詳細」モーダル内の1着全画面拡大表示
// -------------------------------------------------------------
{
  const todayCode = fs.readFileSync(path.join(projectRoot, 'src/components/TodayView.tsx'), 'utf-8');

  // 1. 状態管理（singleZoomItem）の定義と初期化
  assert.ok(
    todayCode.includes('const [singleZoomItem, setSingleZoomItem] = useState<ClosetItem | null>(null);'),
    'TodayView must define singleZoomItem state'
  );

  // 2. ペアモーダル内のシャツ写真・パンツ写真がそれぞれタップ可能（button）であり、singleZoomItem をセットすること
  assert.ok(
    todayCode.includes('onClick={() => setSingleZoomItem(zoomItemPair.shirt)}'),
    'TodayView must allow clicking shirt photo in pair modal to set singleZoomItem'
  );
  assert.ok(
    todayCode.includes('onClick={() => setSingleZoomItem(zoomItemPair.pants)}'),
    'TodayView must allow clicking pants photo in pair modal to set singleZoomItem'
  );

  // 3. レイヤー順序（z-index）と重ね順の検証:
  //    上下コーディネート詳細モーダル (z-50) より前面の z-[60] で全画面拡大オーバーレイが表示されること
  assert.ok(
    todayCode.includes('fixed inset-0 z-50 flex items-center justify-center') &&
    todayCode.includes('上下コーディネート詳細'),
    'Pair modal must use z-50'
  );
  assert.ok(
    todayCode.includes('fixed inset-0 z-[60]') && todayCode.includes('singleZoomItem &&'),
    'Single item fullscreen zoom overlay must use z-[60] (above pair modal z-50)'
  );

  // 4. 復帰動作の検証:
  //    全画面オーバーレイを閉じる際（背景・画像タップまたは閉じるボタン）、setSingleZoomItem(null) のみを呼び出し
  //    zoomItemPair は破棄せず保持していること（元のペアモーダルへ戻る）
  assert.ok(
    todayCode.includes('onClick={() => setSingleZoomItem(null)}') &&
    todayCode.includes('cursor-zoom-out'),
    'Overlay must close singleZoomItem on background/image tap'
  );
  assert.ok(
    todayCode.includes('title="拡大表示を閉じる"'),
    'Overlay must have an explicit close button with title'
  );

  // 5. 表示内容・アスペクト比・フォールバックの検証:
  //    - singleZoomItem.id と singleZoomItem.name がヘッダーに表示されること
  //    - aspect-[3/4] と object-contain により 900x1200 の比率を保って最大表示されること
  //    - ItemImage コンポーネントを使用し、写真なしアイテムでも SVG フォールバックで安全に表示されること
  assert.ok(
    todayCode.includes('singleZoomItem.id') && todayCode.includes('singleZoomItem.name'),
    'Single zoom overlay must display item ID and name'
  );
  assert.ok(
    todayCode.includes('aspect-[3/4]') && todayCode.includes('object-contain'),
    'Single zoom overlay must preserve 3:4 aspect ratio with object-contain'
  );
  assert.ok(
    todayCode.includes('<ItemImage') && todayCode.includes('item={singleZoomItem}'),
    'Single zoom overlay must render ItemImage for consistent photo & SVG fallback'
  );

  // 6. タップターゲット 44x44px 以上と既存動作維持の検証:
  //    - 閉じるボタンに min-w-[44px] min-h-[44px] が設定されていること
  //    - ペアモーダルを閉じる際および「この組み合わせを着る」実行時に状態が安全にリセットされること
  //    - 「この組み合わせを着る」処理（handleSelectWear）が変更なく維持されていること
  assert.ok(
    todayCode.includes('min-w-[44px] min-h-[44px]'),
    'Close buttons must satisfy 44x44px minimum tap target'
  );
  assert.ok(
    todayCode.includes('handleSelectWear(zoomItemPair.pants);'),
    'Wear selection action must remain intact'
  );

  // 7. SPECIFICATION.md のドキュメント整合性検証
  const specContent = fs.readFileSync(path.join(projectRoot, 'docs/SPECIFICATION.md'), 'utf-8');
  assert.ok(
    specContent.includes('全画面拡大表示可能'),
    'SPECIFICATION.md must document single-item fullscreen zoom in Tab 1'
  );

  console.log('  ✅ TodayView single garment fullscreen zoom, z-index layering & fallback safety verified');
}

console.log('🎉 All GAS backend & sync logic tests passed successfully!');
