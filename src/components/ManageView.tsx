import React, { useState } from 'react';
import {
  Archive,
  Package,
  ChevronDown,
  ChevronUp,
  Download,
  Copy,
  Check,
  AlertCircle,
  FolderSync,
  Layers,
  Zap,
  ShieldCheck,
} from 'lucide-react';
import {
  ShirtCategoryFilter,
  SHIRT_CATEGORY_FILTER_OPTIONS,
  RebuildMode,
} from '../types/closet';
import { useClosetStore } from '../hooks/useClosetStore';
import { ItemImage } from './ItemImage';
import { FilterPillBar } from './FilterPillBar';
import { ArchiveToggleButton, OuterwearToggleButton } from './GarmentActionButtons';
import { TravelPlannerView } from './TravelPlannerView';
import { ClosetGallerySection } from './ClosetGallerySection';
import { copyTextToClipboard, CopyFeedbackStatus } from '../utils/closetDomain';
import { WardrobeRebuildModal } from './WardrobeRebuildModal';

export const ManageView: React.FC = () => {
  const {
    mergedClosetData,
    shirts,
    pants,
    archivedItems,
    archiveItem,
    unarchiveItem,
    toggleShirtOuterwear,
  } = useClosetStore();

  const [isOrganizeOpen, setIsOrganizeOpen] = useState(false);
  const [organizeFilter, setOrganizeFilter] = useState<ShirtCategoryFilter>('all');
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [isRebuildOpen, setIsRebuildOpen] = useState(false);
  const [rebuildModalMode, setRebuildModalMode] = useState<RebuildMode>('quick');
  const [copiedJsonStatus, setCopiedJsonStatus] = useState<CopyFeedbackStatus>('idle');

  const filterItemByOuterwear = (item: (typeof shirts)[0]) => {
    if (item.category !== 'shirt') return true;
    if (organizeFilter === 'outerwear') return Boolean(item.isOuterwear);
    if (organizeFilter === 'single') return !item.isOuterwear;
    return true;
  };

  const displayedArchivedItems = archivedItems.filter(filterItemByOuterwear);
  const displayedShirts = shirts.filter(filterItemByOuterwear);

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

  return (
    <div className="space-y-6 pb-20">
      {/* ヘッダーカード */}
      <div className="p-4 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-slate-700/80 rounded-2xl shadow-xl">
        <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm mb-1">
          <FolderSync className="w-4 h-4 text-indigo-400" />
          <span>クローゼット管理・整理・旅行 (Wardrobe Management)</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          手持ち写真の一覧・整理、オフシーズンの服の片付け・復帰、旅行時のミニマルパッキング計画、ワードローブの全体見直し、およびデータの保存・コピー（バックアップ）を行えます。
        </p>
      </div>

      {/* セクション 1: クローゼット写真一覧（ギャラリー） */}
      <ClosetGallerySection />

      {/* セクション 2: ワードローブ整理 */}
      <section className="pt-6 border-t border-slate-800 space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Archive className="w-5 h-5 text-amber-400" />
            <span>📦 ワードローブ整理</span>
          </h2>
          <span className="text-xs font-mono font-bold text-amber-300 bg-amber-950/60 border border-amber-800/60 px-2.5 py-1 rounded-full">
            {archivedItems.length}着 片付けた服
          </span>
        </div>

        <p className="text-xs text-slate-400 px-1 leading-relaxed">
          着なくなった服やオフシーズンの服を片付けることができます。片付けた服は、毎日の朝画面・相性マトリクス・パッキング計画から除外されます。
        </p>

        {/* 絞り込みピル */}
        <FilterPillBar
          options={SHIRT_CATEGORY_FILTER_OPTIONS}
          activeId={organizeFilter}
          onSelect={setOrganizeFilter}
        />

        {/* 片付けた服一覧 */}
        <div className="space-y-2.5">
          <h3 className="text-xs font-bold text-slate-300 px-1 flex items-center gap-1.5">
            <span>片付けた服</span>
            <span className="text-[11px] font-mono text-slate-400 font-normal">（{displayedArchivedItems.length}着）</span>
          </h3>

          {displayedArchivedItems.length === 0 ? (
            <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-2xl text-center text-xs text-slate-400 leading-relaxed">
              {archivedItems.length === 0
                ? '現在片付けた服はありません。着なくなった服は下の「今着ている服から選んで片付ける」から片付けることができます。'
                : '現在の絞り込み条件に一致する片付けた服はありません。'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {displayedArchivedItems.map((item) => (
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
                        {item.category === 'shirt' && item.isOuterwear && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-700/60">
                            🧥 羽織り
                          </span>
                        )}
                        {item.color && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium text-slate-300 bg-slate-950 border border-slate-800">
                            🎨 {item.color}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {item.category === 'shirt' ? (item.isOuterwear ? '羽織り' : '1枚もの') : 'パンツ'} • {item.seasonSleeve} • ドレス度 {item.dressScore.toFixed(1)}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">
                        {item.notes || 'メモなし'}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    <ArchiveToggleButton
                      item={item}
                      onArchive={(it) => archiveItem(it.id)}
                      onUnarchive={(it) => unarchiveItem(it.id)}
                      variant="compact"
                    />
                    <OuterwearToggleButton
                      item={item}
                      onToggle={(it) => toggleShirtOuterwear(it.id, !it.isOuterwear)}
                      variant="compact"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 今着ている服から選んで片付けるアコーディオン */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setIsOrganizeOpen((prev) => !prev)}
            className="w-full min-h-[44px] px-4 py-3 bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl flex items-center justify-between text-xs font-bold text-slate-200 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-amber-400" />
              <span>今着ている服から選んで片付ける（全{shirts.length + pants.length}着）</span>
            </div>
            {isOrganizeOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>

          {isOrganizeOpen && (
            <div className="mt-3 space-y-4 p-3 bg-slate-950/60 border border-slate-800/80 rounded-2xl">
              {/* シャツ一覧 */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-blue-400 px-1 flex items-center justify-between">
                  <span>シャツ（👔 1枚もの・🧥 羽織り）（{displayedShirts.length} / 全{shirts.length}着）</span>
                  <span className="text-[10px] text-slate-400 font-normal">※上のピルで絞り込み中</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {displayedShirts.map((item) => (
                    <div
                      key={item.id}
                      className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl flex items-center justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-10 h-13 rounded-lg overflow-hidden bg-slate-950 border border-slate-800 flex-shrink-0">
                          <ItemImage item={item} showBadge={false} className="w-full h-full" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono bg-blue-950/80 text-blue-300 border border-blue-800/60">
                              {item.id}
                            </span>
                            <span className="text-xs font-bold text-slate-200 truncate">{item.name}</span>
                            {item.isOuterwear && (
                              <span className="px-1.5 py-0.2 rounded text-[8px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-700/60">
                                🧥 羽織り
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                            {item.color ? `🎨 ${item.color} · ` : ''}{item.seasonSleeve}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <OuterwearToggleButton
                          item={item}
                          onToggle={(it) => toggleShirtOuterwear(it.id, !it.isOuterwear)}
                          variant="compact"
                        />
                        <ArchiveToggleButton
                          item={item}
                          onArchive={(it) => archiveItem(it.id)}
                          onUnarchive={(it) => unarchiveItem(it.id)}
                          variant="compact"
                        />
                      </div>
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
                      <ArchiveToggleButton
                        item={item}
                        onArchive={(it) => archiveItem(it.id)}
                        onUnarchive={(it) => unarchiveItem(it.id)}
                        variant="compact"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* セクション 3: 旅行パッキングプランナー */}
      <section className="pt-6 border-t border-slate-800">
        <TravelPlannerView />
      </section>

      {/* セクション 4: 全体見直し ＆ バックアップ */}
      <section className="pt-6 border-t border-slate-800 space-y-4">
        <div className="px-1">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <FolderSync className="w-5 h-5 text-indigo-400" />
            <span>🔄 ワードローブ全体見直し ＆ 💾 バックアップ</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            登録済みの服の相性・羽織り再判定や写真からのフル見直し、最新データの保存を行えます。
          </p>
        </div>

        {/* 安心保護ポリシー明示バナー */}
        <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-2xl flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-300 leading-relaxed">
            <span className="font-bold text-white">🛡️ 安心保護ポリシー：</span>
            着用履歴・奥様NG・片付けた服の状態は、どちらの見直しを実行しても一切消えません。確定済みの色や実寸データも安全に保護されます。
          </div>
        </div>

        {/* 2カード構成の全体見直し入口 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* カード 1: クイック見直し */}
          <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-3 flex flex-col justify-between shadow-md">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-amber-300 flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>⚡ クイック見直し</span>
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60 font-medium">
                  写真不要・約1分
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                写真のアップロードは不要。登録済みの文字情報（名前・確定色・季節・メモ）から、最新ルールに基づき<strong>相性判定</strong>と<strong>羽織り分類</strong>のみを高速に見直します。
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setRebuildModalMode('quick');
                setIsRebuildOpen(true);
              }}
              className="w-full min-h-[44px] py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-md bg-amber-600 hover:bg-amber-500 text-slate-950 active:scale-[0.98]"
            >
              <Zap className="w-4 h-4 text-slate-950" />
              <span>⚡ クイック見直しを開始</span>
            </button>
          </div>

          {/* カード 2: フル見直し ＆ 重複統合 */}
          <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-3 flex flex-col justify-between shadow-md">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-indigo-300 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-indigo-400" />
                  <span>📸 フル見直し ＆ 重複統合</span>
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 font-medium">
                  写真を正本
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                保存写真を正本として、13色パレット確定色・実寸・名前・属性・相性を全面再導出します。同一写真の二重登録も自動検出して安全に1着へ統合できます。
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setRebuildModalMode('full');
                setIsRebuildOpen(true);
              }}
              className="w-full min-h-[44px] py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-md bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-950 active:scale-[0.98]"
            >
              <Layers className="w-4 h-4" />
              <span>📸 フル見直し・重複統合ウィザード</span>
            </button>
          </div>
        </div>

        {/* バックアップ・復旧（アコーディオン） */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setIsBackupOpen(!isBackupOpen)}
            className="w-full min-h-[44px] py-2.5 px-3 rounded-xl bg-slate-900/60 hover:bg-slate-800 text-slate-400 hover:text-slate-300 flex items-center justify-between text-xs transition-colors border border-slate-800/80"
          >
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <span>💾 データバックアップ（JSON保存・クリップボードコピー）</span>
            </span>
            {isBackupOpen ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {isBackupOpen && (
            <div className="mt-2 p-3 bg-slate-900/80 rounded-xl border border-slate-800 space-y-3 animate-fade-in">
              <p className="text-[11px] text-slate-400 leading-relaxed">
                現在のワードローブデータ（奥様NGマージ済み）をJSONファイルとして保存したり、クリップボードにコピーできます。
              </p>

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
              </div>
            </div>
          )}
        </div>
      </section>

      <WardrobeRebuildModal
        isOpen={isRebuildOpen}
        onClose={() => setIsRebuildOpen(false)}
        initialMode={rebuildModalMode}
      />
    </div>
  );
};
