import React, { useState } from 'react';
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
  } = useClosetStore();

  const [urlInput, setUrlInput] = useState(gasConfig.webAppUrl);
  const [tokenInput, setTokenInput] = useState(() => gasConfig.secretToken || generateSecretToken());
  const [autoSyncInput, setAutoSyncInput] = useState(gasConfig.autoSync);
  const [imageFolderIdInput, setImageFolderIdInput] = useState(gasConfig.imageFolderId || '');
  const [copiedScript, setCopiedScript] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(!gasConfig.webAppUrl);
  const [manualSyncMsg, setManualSyncMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 画像同期用の状態 (Phase 2)
  const [isImageSyncing, setIsImageSyncing] = useState(false);
  const [imageSyncProgress, setImageSyncProgress] = useState<string | null>(null);
  const [imageSyncResult, setImageSyncResult] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
    details?: string[];
  } | null>(null);

  // モーダルオープン時または外部Pull時に最新設定値を反映
  React.useEffect(() => {
    if (isOpen) {
      setImageFolderIdInput(gasConfig.imageFolderId || '');
    }
  }, [isOpen, gasConfig.imageFolderId]);

  if (!isOpen) return null;

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
    updateGasConfig({
      webAppUrl: urlInput.trim(),
      secretToken: finalToken,
      autoSync: autoSyncInput,
      imageFolderId: imageFolderIdInput.trim(),
    });
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  // Google ドライブ画像同期コントローラー (仕様6, 7)
  const handleSyncImages = async () => {
    const webAppUrl = urlInput.trim() || gasConfig.webAppUrl;
    if (!webAppUrl) {
      setImageSyncResult({
        type: 'error',
        text: '先に Web アプリ URL を設定してください。',
      });
      return;
    }
    // 指摘3: 入力欄の値を正とし、空の場合は保存値へフォールバックせず未設定エラーにする
    const folderId = imageFolderIdInput.trim();
    if (!folderId) {
      setImageSyncResult({
        type: 'error',
        text: 'Google ドライブの画像フォルダ ID が未設定です。フォルダ ID を入力してください。',
      });
      return;
    }

    setIsImageSyncing(true);
    setImageSyncProgress('同期プランを策定中...');
    setImageSyncResult(null);

    try {
      // 指摘1: 端末の同期元フォルダ ID と現在のフォルダ ID を比較
      // 異なるフォルダに切り替わった場合は、古いフォルダの画像メタを使わず空にして全件再取得
      const lastSyncedFolderId = getSyncedFolderId();
      const isDifferentFolder = Boolean(lastSyncedFolderId && lastSyncedFolderId !== folderId);
      const localMeta = isDifferentFolder ? {} : await getLocalImageMeta();

      // 1. 同期プランの策定リクエスト (仕様6 ステップ1)
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

      // 指摘対応: フォルダ切替時かつ新フォルダに有効な画像が存在する場合、
      // 取得失敗アイテムに旧画像が残るのを防ぐため、チャンク取得前に端末キャッシュを全消去
      // (新フォルダが空の場合は誤消去防止のため既存の確認ダイアログフローに任せる)
      if (isDifferentFolder && validItemIds.length > 0) {
        setImageSyncProgress('旧フォルダのキャッシュをクリア中...');
        await clearAllImages();
      }

      // 2. チャンク取得 (6件ずつ、仕様6 ステップ2)
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

        // Blob 変換と保存 (仕様5)
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

      // 3. 安全弁付き Prune (削除伝播、仕様7)
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

      // 4. 同期成功後に同期元フォルダ ID を保存 (指摘1)
      setSyncedFolderId(folderId);

      // 設定のローカル更新 (入力欄の folderId を正とする、指摘3)
      updateGasConfig({
        imageFolderId: folderId,
        imagesLastUpdatedAt,
      });

      const totalLocal = (await getAllImageKeys()).length;
      let summary =
        neededItemIds.length > 0
          ? `同期完了: ${neededItemIds.length}枚の写真を更新しました（現在${totalLocal}着分保持）`
          : `写真データはすべて最新です（全${totalLocal}着分保持）`;
      if (pruneRes.prunedIds.length > 0) {
        summary += `、${pruneRes.prunedIds.length}枚の不要な写真を整理しました`;
      }

      setImageSyncResult({
        type: allWarnings.length > 0 ? 'warning' : 'success',
        text: summary,
        details: allWarnings.length > 0 ? allWarnings : undefined,
      });
    } catch (err: any) {
      console.error('Image sync failed:', err);
      setImageSyncResult({
        type: 'error',
        text: err?.message || '写真同期中にエラーが発生しました',
      });
    } finally {
      setIsImageSyncing(false);
      setImageSyncProgress(null);
    }
  };

  // 端末の画像キャッシュ全消去 (仕様7)
  const handleClearImageCache = async () => {
    if (!window.confirm('端末に保存されている服の写真キャッシュを全消去して、初期状態（SVGシルエット表示）に戻しますか？')) {
      return;
    }
    try {
      await clearAllImages();
      setImageSyncResult({
        type: 'success',
        text: '端末内の写真キャッシュを全消去しました。',
      });
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
      setManualSyncMsg({ type: 'success', text: 'スプレッドシートから最新データを取得しました！' });
    } else {
      setManualSyncMsg({ type: 'error', text: '取得に失敗しました。URLまたはネット環境を確認してください。' });
    }
    setTimeout(() => setManualSyncMsg(null), 4000);
  };

  const handleManualPush = async () => {
    setManualSyncMsg(null);
    const success = await pushToGas();
    if (success) {
      setManualSyncMsg({ type: 'success', text: '現在の端末データをスプレッドシートへ送信・保存しました！' });
    } else {
      setManualSyncMsg({ type: 'error', text: '送信に失敗しました。URLまたはネット環境を確認してください。' });
    }
    setTimeout(() => setManualSyncMsg(null), 4000);
  };

  const formatLastSync = (isoStr?: string) => {
    if (!isoStr) return '未同期';
    const d = new Date(isoStr);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
      d.getMinutes()
    ).padStart(2, '0')}`;
  };

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
                クラウド同期 & スプレッドシート連携
              </h3>
              <p className="text-[11px] text-slate-400">Pixel 9a ⇔ Mac mini 自動同期・断捨離分析</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-full bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Card */}
        <div className="p-3.5 bg-slate-800/80 rounded-2xl border border-slate-700/60 flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">現在のステータス</span>
            <div className="flex items-center gap-2">
              {syncStatus === 'synced' && (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-bold text-emerald-300">同期完了（最終: {formatLastSync(gasConfig.lastSyncedAt)}）</span>
                </>
              )}
              {syncStatus === 'syncing' && (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                  <span className="text-xs font-bold text-blue-300">バックグラウンド同期中...</span>
                </>
              )}
              {syncStatus === 'offline_pending' && (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="text-xs font-bold text-amber-300">オフライン保留（次回接続時に自動同期）</span>
                </>
              )}
              {syncStatus === 'error' && (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                  <span className="text-xs font-bold text-rose-300">
                    通信エラー{lastSyncError ? ` (${lastSyncError})` : '（ローカル保存済）'}
                  </span>
                </>
              )}
              {syncStatus === 'unconfigured' && (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                  <span className="text-xs font-bold text-slate-400">未設定（端末内ローカル保存モード）</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleManualPull}
              disabled={!gasConfig.webAppUrl || syncStatus === 'syncing'}
              className="p-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded-xl transition-colors border border-slate-600"
              title="スプレッドシートから最新を取得 (Pull)"
            >
              <DownloadCloud className="w-4 h-4" />
            </button>
            <button
              onClick={handleManualPush}
              disabled={!gasConfig.webAppUrl || syncStatus === 'syncing'}
              className="p-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded-xl transition-colors border border-slate-600"
              title="端末データをシートへ送信 (Push)"
            >
              <UploadCloud className="w-4 h-4" />
            </button>
          </div>
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

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1 no-scrollbar">
          {/* Settings Form */}
          <form onSubmit={handleSaveConfig} className="space-y-3 bg-slate-800/40 p-3.5 rounded-2xl border border-slate-800">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                GAS ウェブアプリ URL
              </label>
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                デプロイ時に発行されたウェブアプリのURLを貼り付けます。
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1 flex items-center justify-between">
                <span>シークレット合言葉（必須・自動設定済）</span>
                <button
                  type="button"
                  onClick={handleRegenerateToken}
                  className="text-[10px] text-blue-400 hover:text-blue-300 underline font-normal"
                >
                  再生成
                </button>
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="英数字トークン（例: sc_abcdef123456）"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                />
                <Key className="w-3.5 h-3.5 text-slate-500 absolute right-3 top-2.5" />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                「GASコードをコピー」時にこの合言葉が自動でスクリプトに組み込まれます。
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1 flex items-center justify-between">
                <span>Google ドライブ画像フォルダ ID（完全非公開・任意）</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={imageFolderIdInput}
                  onChange={(e) => setImageFolderIdInput(e.target.value)}
                  placeholder="例: 1a2B3c4D5e... (フォルダURL末尾の英数字)"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                />
                <Folder className="w-3.5 h-3.5 text-slate-500 absolute right-3 top-2.5" />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                ドライブに作成した写真フォルダの URL 内の ID を入力します（公開共有は不要・非公開のままでOK）。
              </p>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={autoSyncInput}
                  onChange={(e) => setAutoSyncInput(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0 w-4 h-4"
                />
                <span>操作時にバックグラウンドで自動同期する</span>
              </label>

              <button
                type="submit"
                className="py-1.5 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-md shadow-blue-900/40"
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

          {/* Photo Synchronization Section (Phase 2) */}
          <div className="p-3.5 bg-slate-800/40 rounded-2xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-sky-600/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
                  <ImageIcon className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    服の写真データ同期
                    {gasConfig.imagesLastUpdatedAt ? (
                      <span className="text-[10px] font-normal text-emerald-400">
                        (更新有)
                      </span>
                    ) : null}
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    Google ドライブの写真を端末内（IndexedDB）へ安全に差分保存
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSyncImages}
                disabled={isImageSyncing}
                className="py-1.5 px-3 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-md shadow-sky-900/40"
              >
                {isImageSyncing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>同期中...</span>
                  </>
                ) : (
                  <>
                    <DownloadCloud className="w-3.5 h-3.5" />
                    <span>写真データを同期</span>
                  </>
                )}
              </button>
            </div>

            {/* Sync Progress Indicator */}
            {imageSyncProgress && (
              <div className="p-2.5 bg-sky-950/40 border border-sky-800/60 rounded-xl flex items-center gap-2 text-xs text-sky-200">
                <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin flex-shrink-0" />
                <span>{imageSyncProgress}</span>
              </div>
            )}

            {/* Sync Result Feedback */}
            {imageSyncResult && (
              <div
                className={`p-2.5 rounded-xl text-xs font-medium space-y-1 ${
                  imageSyncResult.type === 'success'
                    ? 'bg-emerald-950/60 border border-emerald-600/60 text-emerald-200'
                    : imageSyncResult.type === 'warning'
                    ? 'bg-amber-950/60 border border-amber-600/60 text-amber-200'
                    : 'bg-rose-950/60 border border-rose-600/60 text-rose-200'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {imageSyncResult.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  ) : imageSyncResult.type === 'warning' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
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

            {/* Cache Reset Action */}
            <div className="pt-1 flex items-center justify-between border-t border-slate-700/40 text-[11px] text-slate-400">
              <span>端末保存の写真を初期化したい場合</span>
              <button
                type="button"
                onClick={handleClearImageCache}
                className="text-rose-400 hover:text-rose-300 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-rose-950/40 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                <span>写真キャッシュ全消去</span>
              </button>
            </div>
          </div>

          {/* Guide Accordion */}
          <div className="border border-slate-800 rounded-2xl bg-slate-900/50 overflow-hidden">
            <button
              type="button"
              onClick={() => setIsGuideOpen(!isGuideOpen)}
              className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-slate-800/40 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-slate-200">
                  3分で完了！Google スプレッドシート連携ガイド
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
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-bold text-white text-[11px]">
                      <span className="w-4 h-4 rounded-full bg-blue-600/30 text-blue-300 text-[10px] flex items-center justify-center font-mono">2</span>
                      <span>GASコードを貼り付けて初期化を実行</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyScript}
                      className="py-1 px-2.5 bg-blue-600/30 hover:bg-blue-600 text-blue-200 hover:text-white rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 border border-blue-500/40"
                    >
                      {copiedScript ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-300" />
                          <span>コピーしました！</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>GASコードをコピー</span>
                        </>
                      )}
                    </button>
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
        </div>
      </div>
    </div>
  );
};
