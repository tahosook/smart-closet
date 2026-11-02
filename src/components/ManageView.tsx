import React, { useState } from 'react';
import {
  Archive,
  Package,
  Undo2,
  ChevronDown,
  ChevronUp,
  Download,
  Copy,
  RotateCcw,
  Check,
  AlertCircle,
  FolderSync,
} from 'lucide-react';
import { useClosetStore } from '../hooks/useClosetStore';
import { ItemImage } from './ItemImage';
import { TravelPlannerView } from './TravelPlannerView';
import { copyTextToClipboard, CopyFeedbackStatus } from '../utils/closetDomain';
import { saveFailedDriveUploadsToStorage } from '../types/closet';

export const ManageView: React.FC = () => {
  const {
    mergedClosetData,
    shirts,
    pants,
    archivedItems,
    archiveItem,
    unarchiveItem,
    resetToDefaultData,
  } = useClosetStore();

  const [isOrganizeOpen, setIsOrganizeOpen] = useState(false);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [copiedJsonStatus, setCopiedJsonStatus] = useState<CopyFeedbackStatus>('idle');
  const [resetStatus, setResetStatus] = useState<string | null>(null);

  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(mergedClosetData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'closet.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyMergedJson = async () => {
    const ok = await copyTextToClipboard(JSON.stringify(mergedClosetData, null, 2));
    setCopiedJsonStatus(ok ? 'success' : 'error');
    setTimeout(() => {
      setCopiedJsonStatus('idle');
    }, 3000);
  };

  const handleReset = () => {
    if (window.confirm('初期マスターデータ（全24着）に戻しますか？\n※カスタム追加した服や設定はリセットされます。')) {
      resetToDefaultData();
      if (typeof window !== 'undefined' && window.localStorage) {
        saveFailedDriveUploadsToStorage(window.localStorage, []);
      }
      setResetStatus('初期マスターデータにリセットしました。');
      setTimeout(() => {
        setResetStatus(null);
      }, 4000);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* ヘッダーカード */}
      <div className="p-4 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-slate-700/80 rounded-2xl shadow-xl">
        <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm mb-1">
          <FolderSync className="w-4 h-4 text-indigo-400" />
          <span>クローゼット管理・整理・旅行 (Wardrobe Management)</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          オフシーズンの服の片付け・復帰、旅行時のミニマルパッキング計画、およびデータのバックアップ・復元を行えます。
        </p>
      </div>

      {/* セクション 1: ワードローブ整理 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Archive className="w-5 h-5 text-amber-400" />
            <span>📦 ワードローブ整理</span>
          </h2>
          <span className="text-xs font-mono font-bold text-amber-300 bg-amber-950/60 border border-amber-800/60 px-2.5 py-1 rounded-full">
            {archivedItems.length}着 保管中
          </span>
        </div>

        <p className="text-xs text-slate-400 px-1 leading-relaxed">
          着なくなった服やオフシーズンの服を片付けることができます。片付けた服は、毎日の朝画面・相性マトリクス・パッキング計画から除外されます。
        </p>

        {/* 片付けた服一覧 */}
        <div className="space-y-2.5">
          <h3 className="text-xs font-bold text-slate-300 px-1 flex items-center gap-1.5">
            <span>片付けた服</span>
            <span className="text-[11px] font-mono text-slate-400 font-normal">（{archivedItems.length}着）</span>
          </h3>

          {archivedItems.length === 0 ? (
            <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-2xl text-center text-xs text-slate-400 leading-relaxed">
              現在片付けた服はありません。着なくなった服は下の「現役の服から選んで片付ける」から仕舞うことができます。
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {archivedItems.map((item) => (
                <div
                  key={item.id}
                  className="p-3 bg-slate-900/90 border border-slate-800 rounded-2xl flex items-center justify-between gap-3 shadow-md"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-14 h-18 rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex-shrink-0">
                      <ItemImage item={item} showBadge={false} className="w-full h-full" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                            item.category === 'shirt'
                              ? 'bg-blue-950/80 text-blue-300 border border-blue-800/60'
                              : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                          }`}
                        >
                          {item.id}
                        </span>
                        <span className="text-xs font-bold text-white truncate">{item.name}</span>
                        {item.color && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium text-slate-300 bg-slate-950 border border-slate-800">
                            🎨 {item.color}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {item.category === 'shirt' ? 'シャツ' : 'パンツ'} • {item.seasonSleeve} • ドレス度 {item.dressScore.toFixed(1)}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">
                        {item.notes || 'メモなし'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => unarchiveItem(item.id)}
                    className="min-h-[44px] min-w-[56px] px-3 py-2 bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-800/80 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 flex-shrink-0 active:scale-95 shadow-sm"
                    title={`${item.name} を現役に復帰させる`}
                  >
                    <Undo2 className="w-4 h-4" />
                    <span>出す</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 現役の服から選んで片付けるアコーディオン */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setIsOrganizeOpen((prev) => !prev)}
            className="w-full min-h-[44px] px-4 py-3 bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl flex items-center justify-between text-xs font-bold text-slate-200 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-amber-400" />
              <span>現役の服から選んで片付ける（全{shirts.length + pants.length}着）</span>
            </div>
            {isOrganizeOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>

          {isOrganizeOpen && (
            <div className="mt-3 space-y-4 p-3 bg-slate-950/60 border border-slate-800/80 rounded-2xl">
              {/* シャツ一覧 */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-blue-400 px-1 flex items-center gap-1">
                  <span>👔 シャツ・トップス（{shirts.length}着）</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {shirts.map((item) => (
                    <div
                      key={item.id}
                      className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl flex items-center justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-10 h-13 rounded-lg overflow-hidden bg-slate-950 border border-slate-800 flex-shrink-0">
                          <ItemImage item={item} showBadge={false} className="w-full h-full" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono bg-blue-950/80 text-blue-300 border border-blue-800/60">
                              {item.id}
                            </span>
                            <span className="text-xs font-bold text-slate-200 truncate">{item.name}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                            {item.color ? `🎨 ${item.color} · ` : ''}{item.seasonSleeve}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => archiveItem(item.id)}
                        className="min-h-[44px] px-2.5 py-1.5 bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-amber-300 border border-slate-700 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 flex-shrink-0 active:scale-95"
                        title={`${item.name} を片付ける`}
                      >
                        <Package className="w-3.5 h-3.5 text-amber-400" />
                        <span>片付ける</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* パンツ一覧 */}
              <div className="space-y-2 pt-2 border-t border-slate-900">
                <div className="text-[11px] font-bold text-emerald-400 px-1 flex items-center gap-1">
                  <span>👖 パンツ・ボトムス（{pants.length}着）</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {pants.map((item) => (
                    <div
                      key={item.id}
                      className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl flex items-center justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-10 h-13 rounded-lg overflow-hidden bg-slate-950 border border-slate-800 flex-shrink-0">
                          <ItemImage item={item} showBadge={false} className="w-full h-full" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
                              {item.id}
                            </span>
                            <span className="text-xs font-bold text-slate-200 truncate">{item.name}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                            {item.color ? `🎨 ${item.color} · ` : ''}{item.seasonSleeve}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => archiveItem(item.id)}
                        className="min-h-[44px] px-2.5 py-1.5 bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-amber-300 border border-slate-700 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 flex-shrink-0 active:scale-95"
                        title={`${item.name} を片付ける`}
                      >
                        <Package className="w-3.5 h-3.5 text-amber-400" />
                        <span>片付ける</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* セクション 2: 旅行パッキングプランナー */}
      <section className="pt-6 border-t border-slate-800">
        <TravelPlannerView />
      </section>

      {/* セクション 3: バックアップ・復旧 */}
      <section className="pt-6 border-t border-slate-800 space-y-3">
        <button
          type="button"
          onClick={() => setIsBackupOpen(!isBackupOpen)}
          className="w-full min-h-[44px] py-2 px-3 rounded-xl bg-slate-900/60 hover:bg-slate-800 text-slate-400 hover:text-slate-300 flex items-center justify-between text-xs transition-colors border border-slate-800/80"
        >
          <span className="font-semibold text-slate-300 flex items-center gap-1.5">
            <span>💾 データのバックアップ・復旧（ファイル保存・初期データに戻す）</span>
          </span>
          {isBackupOpen ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {isBackupOpen && (
          <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 space-y-3 animate-fade-in">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              現在のワードローブデータ（奥様NGマージ済み）をJSONファイルとして保存したり、クリップボードにコピーできます。
              初期マスターデータに戻すことも可能です。
            </p>

            {resetStatus && (
              <div className="p-2.5 bg-emerald-950/80 border border-emerald-800 text-emerald-300 rounded-xl text-xs flex items-center gap-2">
                <Check className="w-4 h-4 flex-shrink-0" />
                <span>{resetStatus}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={handleDownloadJson}
                className="flex-1 min-h-[44px] py-2 px-3 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center gap-1.5 transition-colors border border-slate-700"
                title="マージ済み最新JSONをダウンロード（src/data/closet.json差し替え用）"
              >
                <Download className="w-4 h-4 text-blue-400" />
                <span>JSON保存</span>
              </button>

              <button
                type="button"
                onClick={handleCopyMergedJson}
                className={`flex-1 min-h-[44px] py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border ${
                  copiedJsonStatus === 'error'
                    ? 'bg-rose-950/60 border-rose-800/80 text-rose-300'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                }`}
                title="マージ済みJSONをクリップボードにコピー"
              >
                {copiedJsonStatus === 'success' ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>コピー済</span>
                  </>
                ) : copiedJsonStatus === 'error' ? (
                  <>
                    <AlertCircle className="w-4 h-4 text-rose-400" />
                    <span>コピー失敗</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>JSONコピー</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleReset}
                className="min-h-[44px] py-2 px-3 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-rose-950/60 text-rose-300 hover:text-rose-200 border border-slate-700 hover:border-rose-800/80 flex items-center justify-center gap-1.5 transition-colors"
                title="初期データに戻す"
              >
                <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
                <span>初期データに戻す</span>
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
