import React, { useState, useEffect } from 'react';
import {
  X,
  Cloud,
  RefreshCw,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Key,
  UploadCloud,
  DownloadCloud,
  ShieldCheck,
  Sparkles,
  Image as ImageIcon,
  Trash2,
  Folder,
  Wrench,
  Settings,
} from 'lucide-react';
import { useClosetStore, generateSecretToken } from '../hooks/useClosetStore';
import {
  getLocalImageMeta,
  saveImageBlobs,
  pruneImages,
  clearAllImages,
  dataUrlToBlob,
  getAllImageKeys,
  getSyncedFolderId,
  setSyncedFolderId,
} from '../utils/imageStore';
import {
  GetImageSyncPlanResponse,
  FetchImagesResponse,
} from '../types/closet';
import GAS_SCRIPT_TEMPLATE from '../../gas/Code.gs?raw';

interface GasSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GasSyncModal: React.FC<GasSyncModalProps> = ({ isOpen, onClose }) => {
  const {
    syncStatus,
    gasConfig,
    lastSyncError,
    updateGasConfig,
    pullFromGas,
    pushToGas,
    fetchBootstrapConfig,
    closetData,
  } = useClosetStore();

  const [urlInput, setUrlInput] = useState(gasConfig.webAppUrl);
  const [tokenInput, setTokenInput] = useState(() => gasConfig.secretToken || '');
  const [autoSyncInput, setAutoSyncInput] = useState(gasConfig.autoSync);
  const [copiedScript, setCopiedScript] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // 折りたたみ制御（未連携時は接続設定を初期展開、連携済時はすべて折りたたむ）
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(!gasConfig.webAppUrl);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  // 個別操作・統合同期メッセージ
  const [manualSyncMsg, setManualSyncMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [unifiedSyncMsg, setUnifiedSyncMsg] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [isUnifiedSyncing, setIsUnifiedSyncing] = useState(false);

  // クラウドからの自動ブートストラップ状態
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [bootstrapMsg, setBootstrapMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 画像同期用の状態
  const [isImageSyncing, setIsImageSyncing] = useState(false);
  const [imageSyncProgress, setImageSyncProgress] = useState<string | null>(null);
  const [imageSyncResult, setImageSyncResult] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
    details?: string[];
  } | null>(null);

  // 写真ローカル状態（通信なし0ms判定）
  const [localImageCount, setLocalImageCount] = useState<number>(0);
  const [hasPhotoUpdate, setHasPhotoUpdate] = useState<boolean>(false);

  // モーダルオープン時または設定値変更時にフォーム入力欄へ反映
  useEffect(() => {
    if (isOpen) {
      setUrlInput(gasConfig.webAppUrl || '');
      setTokenInput(gasConfig.secretToken || '');
      setAutoSyncInput(gasConfig.autoSync);
      setIsConfigOpen(!gasConfig.webAppUrl);
    }
  }, [isOpen, gasConfig.webAppUrl, gasConfig.secretToken, gasConfig.autoSync]);

  // 写真の更新有無とローカル保存枚数の軽量ローカル判定（通信なし）
  const refreshPhotoStatus = React.useCallback(async () => {
    try {
      const keys = await getAllImageKeys();
      setLocalImageCount(keys.length);

      const targetFolder = gasConfig.imageFolderId;
      if (!targetFolder) {
        setHasPhotoUpdate(false);
        return;
      }

      const localMeta = await getLocalImageMeta();
      const syncedFolder = getSyncedFolderId();
      const timestamps = Object.values(localMeta);
      const maxLocalTs = timestamps.length > 0 ? Math.max(...timestamps) : 0;
      const remoteTs = gasConfig.imagesLastUpdatedAt || 0;
      const isFolderDifferent = Boolean(syncedFolder && syncedFolder !== targetFolder);

      // ワードローブ全アイテムとローカルキーの差分を確認（部分欠落の検出）
      const closetItemIds = closetData.items.map((i) => i.id);
      const hasMissingItems = closetItemIds.some((id) => !keys.includes(id));

      const needsUpdate =
        keys.length === 0 ||
        isFolderDifferent ||
        hasMissingItems ||
        (remoteTs > 0 && remoteTs > maxLocalTs);

      setHasPhotoUpdate(needsUpdate);
    } catch (e) {
      console.warn('Failed to inspect photo status', e);
    }
  }, [gasConfig.imageFolderId, gasConfig.imagesLastUpdatedAt, closetData.items]);

  useEffect(() => {
    if (isOpen) {
      refreshPhotoStatus();
    }
  }, [isOpen, refreshPhotoStatus]);

  if (!isOpen) return null;

  const handleAutoBootstrap = async () => {
    setIsBootstrapping(true);
    setBootstrapMsg(null);
    const success = await fetchBootstrapConfig({ onlyFillMissing: false });
    if (success) {
      setBootstrapMsg({ type: 'success', text: 'クラウドから最新の設定を取得しました！' });
    } else {
      setBootstrapMsg({
        type: 'error',
        text: '自動設定が見つかりませんでした。下のフォームから手動で設定してください。',
      });
    }
    setIsBootstrapping(false);
    setTimeout(() => setBootstrapMsg(null), 4000);
  };

  const handleRegenerateToken = () => {
    const newToken = generateSecretToken();
    setTokenInput(newToken);
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    const finalToken = tokenInput.trim() || generateSecretToken();
    if (!tokenInput.trim()) {
      setTokenInput(finalToken);
    }
    // フォルダIDはシートの meta_config が正本（表示専用）のため、既存の値を維持して保存
    updateGasConfig({
      webAppUrl: urlInput.trim(),
      secretToken: finalToken,
      autoSync: autoSyncInput,
      imageFolderId: gasConfig.imageFolderId,
      imagesLastUpdatedAt: gasConfig.imagesLastUpdatedAt,
    });
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  // Google ドライブ画像同期コントローラー（既存の安全弁・フォルダ切替・チャンク取得・確認ダイアログをすべて完全保持）
  const handleSyncImages = async (folderIdOverride?: string): Promise<boolean> => {
    const webAppUrl = urlInput.trim() || gasConfig.webAppUrl;
    if (!webAppUrl) {
      setImageSyncResult({
        type: 'error',
        text: '先に Web アプリ URL を設定してください。',
      });
      return false;
    }

    const folderId = (folderIdOverride || gasConfig.imageFolderId || '').trim();
    if (!folderId) {
      setImageSyncResult({
        type: 'error',
        text: 'Google ドライブの画像フォルダ ID が未設定です。スプレッドシートの meta_config シートで設定してください。',
      });
      return false;
    }

    setIsImageSyncing(true);
    setImageSyncProgress('同期プランを策定中...');
    setImageSyncResult(null);

    try {
      // 1. 端末の同期元フォルダ ID と現在のフォルダ ID を比較
      // 異なるフォルダに切り替わった場合は、古いフォルダの画像メタを使わず空にして全件再取得
      const lastSyncedFolderId = getSyncedFolderId();
      const isDifferentFolder = Boolean(lastSyncedFolderId && lastSyncedFolderId !== folderId);
      const localMeta = isDifferentFolder ? {} : await getLocalImageMeta();

      // 同期プランの策定リクエスト
      const planRes = await fetch(webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'getImageSyncPlan',
          token: tokenInput.trim() || gasConfig.secretToken,
          imageFolderId: folderId,
          localMeta,
        }),
      });

      if (!planRes.ok) throw new Error(`HTTPエラー ${planRes.status}`);
      const planData: GetImageSyncPlanResponse = await planRes.json();
      if (!planData.ok) throw new Error(planData.error || 'プラン策定エラー');

      const { validItemIds, neededItemIds, imagesLastUpdatedAt, warnings: planWarnings } = planData;
      const allWarnings: string[] = [];
      if (planWarnings && planWarnings.length > 0) {
        allWarnings.push(...planWarnings);
      }

      // フォルダ切替時かつ新フォルダに有効な画像が存在する場合、
      // 取得失敗アイテムに旧画像が残るのを防ぐため、チャンク取得前に端末キャッシュを全消去
      // (新フォルダが空の場合は誤消去防止のため既存の確認ダイアログフローに任せる)
      if (isDifferentFolder && validItemIds.length > 0) {
        setImageSyncProgress('旧フォルダのキャッシュをクリア中...');
        await clearAllImages();
      }

      // 2. チャンク取得 (6件ずつ)
      const CHUNK_SIZE = 6;
      let fetchedCount = 0;

      for (let i = 0; i < neededItemIds.length; i += CHUNK_SIZE) {
        const chunk = neededItemIds.slice(i, i + CHUNK_SIZE);
        setImageSyncProgress(`写真を取得中... (${fetchedCount}/${neededItemIds.length}枚)`);

        const fetchRes = await fetch(webAppUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'fetchImages',
            token: tokenInput.trim() || gasConfig.secretToken,
            imageFolderId: folderId,
            itemIds: chunk,
          }),
        });

        if (!fetchRes.ok) throw new Error(`HTTPエラー ${fetchRes.status}`);
        const fetchData: FetchImagesResponse = await fetchRes.json();
        if (!fetchData.ok) throw new Error(fetchData.error || '写真取得エラー');

        if (fetchData.warnings && fetchData.warnings.length > 0) {
          allWarnings.push(...fetchData.warnings);
        }

        // Blob 変換と保存
        const blobsMap: Record<string, Blob> = {};
        for (const [id, dataUrl] of Object.entries(fetchData.images)) {
          blobsMap[id] = await dataUrlToBlob(dataUrl);
        }
        await saveImageBlobs(blobsMap, fetchData.timestamps);

        fetchedCount += chunk.length;
        setImageSyncProgress(
          `写真を取得中... (${Math.min(fetchedCount, neededItemIds.length)}/${neededItemIds.length}枚)`
        );
      }

      // 3. 安全弁付き Prune (削除伝播)
      setImageSyncProgress('ローカル画像の整合性を確認中...');
      let pruneRes = await pruneImages(validItemIds);

      if (pruneRes.skipped) {
        let confirmMsg = '';
        if (pruneRes.reason === 'empty_valid_ids') {
          confirmMsg =
            'Google ドライブ上に写真が見つかりません。端末に保存されている写真をすべて削除して初期状態（SVG）に戻しますか？';
        } else if (pruneRes.reason === 'rapid_decrease') {
          confirmMsg =
            'ドライブ上の写真が端末保持数より大幅に減少しています。端末側の写真を一括削除して同期しますか？';
        }
        if (confirmMsg && window.confirm(confirmMsg)) {
          pruneRes = await pruneImages(validItemIds, true);
        }
      }

      // 4. 同期成功後に同期元フォルダ ID を保存
      setSyncedFolderId(folderId);

      // 設定のローカル更新
      updateGasConfig({
        imageFolderId: folderId,
        imagesLastUpdatedAt,
      });

      const totalLocal = (await getAllImageKeys()).length;
      let summary =
        neededItemIds.length > 0
          ? `写真同期完了: ${neededItemIds.length}枚の写真を更新しました（現在${totalLocal}着分保持）`
          : `写真データはすべて最新です（全${totalLocal}着分保持）`;
      if (pruneRes.prunedIds.length > 0) {
        summary += `、${pruneRes.prunedIds.length}枚の不要な写真を整理しました`;
      }

      setImageSyncResult({
        type: allWarnings.length > 0 ? 'warning' : 'success',
        text: summary,
        details: allWarnings.length > 0 ? allWarnings : undefined,
      });

      await refreshPhotoStatus();
      return true;
    } catch (err: any) {
      console.error('Image sync failed:', err);
      setImageSyncResult({
        type: 'error',
        text: err?.message || '写真同期中にエラーが発生しました',
      });
      return false;
    } finally {
      setIsImageSyncing(false);
      setImageSyncProgress(null);
    }
  };

  // 統合「今すぐ同期」コントローラー（条件1 & 条件2 を厳格に適用）
  const handleUnifiedSync = async () => {
    setIsUnifiedSyncing(true);
    setUnifiedSyncMsg(null);
    setImageSyncResult(null);

    try {
      // 【条件1】未送信フラグ (smart_closet_sync_dirty) を明示的に事前検査
      // 未送信がある場合は必ず pushToGas() を先に実行してシートへ送信・双方向マージを行う
      const isDirty = localStorage.getItem('smart_closet_sync_dirty') === 'true';
      let dataSyncOk = false;

      if (isDirty) {
        const pushOk = await pushToGas();
        if (pushOk) {
          // 送信成功後、最新状態の反映を pullFromGas() で確実に取得
          dataSyncOk = await pullFromGas();
        } else {
          // 未送信データの消失を防ぐため、送信失敗時は pull を実行せず中断
          dataSyncOk = false;
        }
      } else {
        dataSyncOk = await pullFromGas();
      }

      if (!dataSyncOk) {
        setUnifiedSyncMsg({
          type: 'error',
          text: '同期できませんでした。URLまたは通信環境を確認してください。',
        });
        return;
      }

      // データ同期で取得・更新された最新の config から imageFolderId を取得
      let latestFolderId = gasConfig.imageFolderId;
      try {
        const rawCfg = localStorage.getItem('smart_closet_gas_config');
        if (rawCfg) {
          const parsed = JSON.parse(rawCfg);
          if (parsed.imageFolderId) {
            latestFolderId = parsed.imageFolderId;
          }
        }
      } catch {
        // fallback to gasConfig.imageFolderId
      }

      // 【条件2】写真同期は既存の handleSyncImages（安全弁・フォルダ切替・チャンク取得・確認ダイアログ）をそのまま再利用
      if (latestFolderId) {
        const photoSyncOk = await handleSyncImages(latestFolderId);
        if (!photoSyncOk) {
          setUnifiedSyncMsg({
            type: 'warning',
            text: '服データは同期完了しましたが、写真の取得に失敗しました。下の詳細から再試行できます。',
          });
          return;
        }
      }

      setUnifiedSyncMsg({
        type: 'success',
        text: '同期完了しました（服データと写真が最新です）',
      });
      setTimeout(() => setUnifiedSyncMsg(null), 5000);
    } catch (err: any) {
      console.error('Unified sync failed:', err);
      setUnifiedSyncMsg({
        type: 'error',
        text: '同期中にエラーが発生しました: ' + (err?.message || ''),
      });
    } finally {
      setIsUnifiedSyncing(false);
      await refreshPhotoStatus();
    }
  };

  // 端末の画像キャッシュ全消去
  const handleClearImageCache = async () => {
    if (!window.confirm('端末に保存されている服の写真キャッシュを全消去して、初期状態（SVGシルエット表示）に戻しますか？\n（※Google ドライブ上の写真は消去されません）')) {
      return;
    }
    try {
      await clearAllImages();
      setImageSyncResult({
        type: 'success',
        text: '端末内の写真キャッシュを全消去しました。',
      });
      await refreshPhotoStatus();
    } catch (err: any) {
      setImageSyncResult({
        type: 'error',
        text: 'キャッシュ消去に失敗しました: ' + (err?.message || ''),
      });
    }
  };

  const handleCopyScript = async () => {
    try {
      const finalToken = tokenInput.trim() || generateSecretToken();
      if (!tokenInput.trim()) {
        setTokenInput(finalToken);
      }
      const customizedScript = GAS_SCRIPT_TEMPLATE.replace(
        '__SMART_CLOSET_SECRET_TOKEN__',
        finalToken
      );
      await navigator.clipboard.writeText(customizedScript);
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 2500);
    } catch (err) {
      console.error('Failed to copy GAS script:', err);
    }
  };

  const handleManualPull = async () => {
    setManualSyncMsg(null);
    const success = await pullFromGas();
    if (success) {
      setManualSyncMsg({ type: 'success', text: 'シートの最新データを取り直しました！' });
      await refreshPhotoStatus();
    } else {
      setManualSyncMsg({ type: 'error', text: '取り直しに失敗しました。URLまたはネット環境を確認してください。' });
    }
    setTimeout(() => setManualSyncMsg(null), 4000);
  };

  const handleManualPush = async () => {
    setManualSyncMsg(null);
    const success = await pushToGas();
    if (success) {
      setManualSyncMsg({ type: 'success', text: '端末の内容をシートへ反映しました！' });
      await refreshPhotoStatus();
    } else {
      setManualSyncMsg({ type: 'error', text: '反映に失敗しました。URLまたはネット環境を確認してください。' });
    }
    setTimeout(() => setManualSyncMsg(null), 4000);
  };

  const formatLastSync = (isoStr?: string) => {
    if (!isoStr) return 'まだ同期していません';
    const d = new Date(isoStr);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
      d.getMinutes()
    ).padStart(2, '0')}`;
  };

  const isConfigured = Boolean(gasConfig.webAppUrl);
  const isDirty = typeof window !== 'undefined' && localStorage.getItem('smart_closet_sync_dirty') === 'true';
  const isBusy = syncStatus === 'syncing' || isUnifiedSyncing || isImageSyncing;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-lg w-full p-4 sm:p-6 space-y-4 shadow-2xl relative max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <Cloud className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-1.5">
                クラウド同期
              </h3>
              <p className="text-[11px] text-slate-400">Pixel 9a ⇔ Mac mini 連携・断捨離分析</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-white rounded-full bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 no-scrollbar">
          {/* ======================================================== */}
          {/* 通常表示エリア（デフォルトで見える3要素）                 */}
          {/* 1. 状態表示                                              */}
          {/* 2. 「今すぐ同期」ボタン1つ                                */}
          {/* 3. 写真の状態表示                                        */}
          {/* ======================================================== */}

          {/* 1. 状態表示カード（平易な日本語表現） */}
          <div className="p-3.5 bg-slate-800/80 rounded-2xl border border-slate-700/60 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">同期状態</span>
              <div className="flex items-center gap-2">
                {!isConfigured ? (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                    <span className="text-xs font-bold text-slate-300">クラウド未連携（この端末のみに保存中）</span>
                  </>
                ) : isBusy ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                    <span className="text-xs font-bold text-blue-300">クラウドと同期しています...</span>
                  </>
                ) : syncStatus === 'error' ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                    <span className="text-xs font-bold text-rose-300">
                      同期できませんでした{lastSyncError ? ` (${lastSyncError})` : ''}
                    </span>
                  </>
                ) : isDirty ? (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-xs font-bold text-amber-300">未送信の変更があります</span>
                  </>
                ) : (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                    <span className="text-xs font-bold text-emerald-300">同期済み（最新です）</span>
                  </>
                )}
              </div>
            </div>

            <div className="text-right">
              <span className="text-[10px] text-slate-400 block">最終同期</span>
              <span className="text-xs font-medium text-slate-300">
                {formatLastSync(gasConfig.lastSyncedAt)}
              </span>
            </div>
          </div>

          {/* 2. 主ボタン：「今すぐ同期」ボタン1つ */}
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={handleUnifiedSync}
              disabled={!isConfigured || isBusy}
              className="w-full min-h-[48px] py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:opacity-50 text-white rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/40 active:scale-[0.99]"
            >
              <RefreshCw className={`w-4 h-4 ${isBusy ? 'animate-spin' : ''}`} />
              <span>{isBusy ? '同期しています...' : '今すぐ同期'}</span>
            </button>
            <p className="text-[11px] text-center text-slate-400">
              端末とシートを最新に揃え、写真の更新も反映します
            </p>
          </div>

          {/* 統合同期メッセージ表示 */}
          {unifiedSyncMsg && (
            <div
              className={`p-2.5 rounded-xl text-xs font-medium flex items-center gap-2 ${
                unifiedSyncMsg.type === 'success'
                  ? 'bg-emerald-950/60 border border-emerald-600/60 text-emerald-200'
                  : unifiedSyncMsg.type === 'warning'
                  ? 'bg-amber-950/60 border border-amber-600/60 text-amber-200'
                  : 'bg-rose-950/60 border border-rose-600/60 text-rose-200'
              }`}
            >
              {unifiedSyncMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-400" />
              )}
              <span>{unifiedSyncMsg.text}</span>
            </div>
          )}

          {/* 3. 写真の状態表示（確認できた事実のみを表示、更新時や同期進捗を表示） */}
          <div className="p-3 bg-slate-800/40 rounded-2xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-slate-300">
                <ImageIcon className="w-4 h-4 text-sky-400 flex-shrink-0" />
                <span className="font-medium">
                  {!gasConfig.imageFolderId ? (
                    <span className="text-slate-400">写真はシルエット表示モードです（写真フォルダ未設定）</span>
                  ) : isImageSyncing ? (
                    <span className="text-sky-300 font-bold">{imageSyncProgress || '写真を同期しています...'}</span>
                  ) : hasPhotoUpdate ? (
                    <span className="text-sky-300 font-bold">写真の更新があります（「今すぐ同期」で反映）</span>
                  ) : (
                    <span className="text-emerald-300">端末に{localImageCount}着分の写真を保存済み</span>
                  )}
                </span>
              </div>
            </div>

            {/* 写真同期の結果メッセージ（詳細があれば展開） */}
            {imageSyncResult && (
              <div
                className={`p-2 rounded-xl text-xs space-y-1 ${
                  imageSyncResult.type === 'success'
                    ? 'bg-emerald-950/60 border border-emerald-600/60 text-emerald-200'
                    : imageSyncResult.type === 'warning'
                    ? 'bg-amber-950/60 border border-amber-600/60 text-amber-200'
                    : 'bg-rose-950/60 border border-rose-600/60 text-rose-200'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {imageSyncResult.type === 'success' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                  )}
                  <span>{imageSyncResult.text}</span>
                </div>
                {imageSyncResult.details && (
                  <ul className="text-[11px] list-disc list-inside text-amber-300/90 pl-1 space-y-0.5">
                    {imageSyncResult.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* ======================================================== */}
          {/* 折りたたみセクション（詳細・復旧／接続設定／ガイド）       */}
          {/* ======================================================== */}

          {/* 折りたたみ1：詳細・復旧（シートとの個別やり直し） */}
          <div className="border border-slate-800 rounded-2xl bg-slate-900/50 overflow-hidden">
            <button
              type="button"
              onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
              className="w-full min-h-[44px] px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-slate-800/40 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold text-slate-200">
                  詳細・復旧（個別でやり直す場合）
                </span>
              </div>
              {isAdvancedOpen ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {isAdvancedOpen && (
              <div className="p-3.5 border-t border-slate-800/80 space-y-3 text-xs text-slate-300">
                <p className="text-[11px] text-slate-400">
                  通常は上の「今すぐ同期」で自動的に解決しますが、手動で個別に再取得または送信したい場合のみ使用します。
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleManualPull}
                    disabled={!isConfigured || isBusy}
                    className="min-h-[44px] py-2.5 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded-xl transition-colors border border-slate-700 text-left flex items-center gap-2"
                  >
                    <DownloadCloud className="w-4 h-4 text-blue-400 flex-shrink-0" />
                    <div>
                      <div className="font-bold text-xs">シートから取り直す</div>
                      <div className="text-[10px] text-slate-400">未送信データも統合して最新化</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={handleManualPush}
                    disabled={!isConfigured || isBusy}
                    className="min-h-[44px] py-2.5 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded-xl transition-colors border border-slate-700 text-left flex items-center gap-2"
                  >
                    <UploadCloud className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <div>
                      <div className="font-bold text-xs">端末の内容でシートを上書きする</div>
                      <div className="text-[10px] text-slate-400">現在の端末データをシートへ送信</div>
                    </div>
                  </button>
                </div>

                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => handleSyncImages()}
                    disabled={!isConfigured || isBusy || !gasConfig.imageFolderId}
                    className="w-full min-h-[44px] py-2 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded-xl transition-colors border border-slate-700 flex items-center justify-center gap-2"
                  >
                    <ImageIcon className="w-3.5 h-3.5 text-sky-400" />
                    <span className="font-semibold text-xs">写真データだけ再チェックする</span>
                  </button>
                </div>

                {manualSyncMsg && (
                  <div
                    className={`p-2.5 rounded-xl text-xs font-medium flex items-center gap-2 ${
                      manualSyncMsg.type === 'success'
                        ? 'bg-emerald-950/60 border border-emerald-600/60 text-emerald-200'
                        : 'bg-rose-950/60 border border-rose-600/60 text-rose-200'
                    }`}
                  >
                    {manualSyncMsg.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-400" />
                    )}
                    <span>{manualSyncMsg.text}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 折りたたみ2：接続設定 */}
          <div className="border border-slate-800 rounded-2xl bg-slate-900/50 overflow-hidden">
            <button
              type="button"
              onClick={() => setIsConfigOpen(!isConfigOpen)}
              className="w-full min-h-[44px] px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-slate-800/40 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-bold text-slate-200">
                  接続設定（URL・合言葉）
                </span>
              </div>
              {isConfigOpen ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {isConfigOpen && (
              <form onSubmit={handleSaveConfig} className="p-3.5 border-t border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between pb-1">
                  <span className="text-[11px] text-slate-400">端末への接続情報設定</span>
                  <button
                    type="button"
                    onClick={handleAutoBootstrap}
                    disabled={isBootstrapping}
                    className="min-h-[44px] py-1 px-3 bg-blue-600/30 hover:bg-blue-600 text-blue-200 hover:text-white disabled:opacity-40 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-blue-500/40"
                  >
                    {isBootstrapping ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>取得中...</span>
                      </>
                    ) : (
                      <>
                        <Cloud className="w-3.5 h-3.5" />
                        <span>クラウドから設定を自動取得</span>
                      </>
                    )}
                  </button>
                </div>

                {bootstrapMsg && (
                  <div
                    className={`p-2 rounded-xl text-[11px] font-medium flex items-center gap-1.5 ${
                      bootstrapMsg.type === 'success'
                        ? 'bg-emerald-950/60 border border-emerald-600/60 text-emerald-200'
                        : 'bg-amber-950/60 border border-amber-600/60 text-amber-200'
                    }`}
                  >
                    {bootstrapMsg.type === 'success' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
                    )}
                    <span>{bootstrapMsg.text}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    GAS ウェブアプリ URL
                  </label>
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    className="w-full min-h-[44px] bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    デプロイ時に発行されたウェブアプリのURLを貼り付けます。
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    シークレット合言葉（必須）
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder="英数字トークン（例: sc_abcdef123456）"
                      className="w-full min-h-[44px] bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                    />
                    <Key className="w-3.5 h-3.5 text-slate-500 absolute right-3 top-3.5" />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    ※ 変更が必要な場合は下の「セットアップガイド」から再生成できます。
                  </p>
                </div>

                {/* 画像フォルダID（表示専用：正本は meta_config シート） */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1 flex items-center justify-between">
                    <span>Google ドライブ画像フォルダ ID（表示専用）</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      readOnly
                      value={gasConfig.imageFolderId || ''}
                      placeholder="未設定（スプレッドシートの meta_config で設定）"
                      className="w-full min-h-[44px] bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none font-mono cursor-not-allowed select-all"
                    />
                    <Folder className="w-3.5 h-3.5 text-slate-500 absolute right-3 top-3.5" />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    ※ フォルダ ID の正本はスプレッドシートの meta_config シートです。変更する場合はシート側で編集してください。
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={autoSyncInput}
                      onChange={(e) => setAutoSyncInput(e.target.checked)}
                      className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0 w-4 h-4"
                    />
                    <span>操作時に自動で同期する</span>
                  </label>

                  <button
                    type="submit"
                    className="min-h-[44px] py-2 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-md shadow-blue-900/40"
                  >
                    {saveSuccess ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-300" />
                        <span>保存完了！</span>
                      </>
                    ) : (
                      <span>設定を保存</span>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* 折りたたみ3：セットアップガイド */}
          <div className="border border-slate-800 rounded-2xl bg-slate-900/50 overflow-hidden">
            <button
              type="button"
              onClick={() => setIsGuideOpen(!isGuideOpen)}
              className="w-full min-h-[44px] px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-slate-800/40 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-slate-200">
                  セットアップガイド・初期構築用ツール
                </span>
              </div>
              {isGuideOpen ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {isGuideOpen && (
              <div className="p-3.5 border-t border-slate-800/80 space-y-3 text-xs text-slate-300">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-white text-[11px]">
                    <span className="w-4 h-4 rounded-full bg-blue-600/30 text-blue-300 text-[10px] flex items-center justify-center font-mono">1</span>
                    <span>スプレッドシートを作成し Apps Script を開く</span>
                  </div>
                  <p className="text-[11px] text-slate-400 pl-5">
                    Google ドライブで新規スプレッドシートを作成し、メニューの「拡張機能」&gt;「Apps Script」を開きます。
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-bold text-white text-[11px]">
                      <span className="w-4 h-4 rounded-full bg-blue-600/30 text-blue-300 text-[10px] flex items-center justify-center font-mono">2</span>
                      <span>GASコードを貼り付けて初期化を実行</span>
                    </div>
                    <div className="flex items-center gap-2 pl-5 sm:pl-0">
                      <button
                        type="button"
                        onClick={handleCopyScript}
                        className="min-h-[44px] py-1.5 px-3 bg-blue-600/30 hover:bg-blue-600 text-blue-200 hover:text-white rounded-xl text-[11px] font-bold transition-all flex items-center gap-1.5 border border-blue-500/40"
                      >
                        {copiedScript ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-300" />
                            <span>コピーしました！</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>GASコードをコピー</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleRegenerateToken}
                        className="min-h-[44px] py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-[11px] font-semibold transition-all border border-slate-700"
                        title="合言葉を新しく生成"
                      >
                        合言葉を再生成
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 pl-5">
                    コピーしたコードをエディタに貼り付けて保存し、関数ドロップダウンで <code className="bg-slate-800 px-1 py-0.5 rounded text-amber-300">setupSpreadsheet</code> を選択して「実行」を押します（履歴・NG・断捨離分析シートが自動作成されます）。
                  </p>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-white text-[11px]">
                    <span className="w-4 h-4 rounded-full bg-blue-600/30 text-blue-300 text-[10px] flex items-center justify-center font-mono">3</span>
                    <span>ウェブアプリとしてデプロイしてURLを登録</span>
                  </div>
                  <p className="text-[11px] text-slate-400 pl-5">
                    右上の「デプロイ」&gt;「新しいデプロイ」を開き、種類「ウェブアプリ」、アクセスできるユーザー「全員」でデプロイします。発行されたURLを上記フォームに保存すれば完了です！
                  </p>
                </div>

                <div className="p-2.5 bg-blue-950/40 border border-blue-800/40 rounded-xl space-y-1">
                  <div className="text-[11px] font-bold text-blue-300 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>連携後のメリット</span>
                  </div>
                  <ul className="text-[10px] text-slate-300 list-disc list-inside space-y-0.5">
                    <li>Pixel 9a で朝決定した着用履歴が Mac mini 側にも自動反映</li>
                    <li>スプレッドシートの「analytics」シートで「60日以上未着用の服（断捨離候補）」が自動集計</li>
                    <li>スプレッドシート上で直接妻NGの行を追加・削除してもアプリに反映</li>
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* ======================================================== */}
          {/* 最下部：危険操作（写真キャッシュ全消去）                 */}
          {/* ======================================================== */}
          <div className="p-3 bg-slate-900 border border-slate-800/80 rounded-2xl flex items-center justify-between text-xs">
            <span className="text-[11px] text-slate-500">
              端末保存の写真をリセットしたい場合
            </span>
            <button
              type="button"
              onClick={handleClearImageCache}
              className="min-h-[44px] py-1.5 px-3 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded-xl transition-colors flex items-center gap-1.5 font-medium border border-rose-950/50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>写真キャッシュ全消去</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
