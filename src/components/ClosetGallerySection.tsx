import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Images,
  Archive,
  ChevronLeft,
  ChevronRight,
  X,
  Package,
  Undo2,
  Check,
} from 'lucide-react';
import {
  ClosetItem,
  GalleryCategoryFilter,
  GALLERY_CATEGORY_FILTER_OPTIONS,
} from '../types/closet';
import { useClosetStore } from '../hooks/useClosetStore';
import { ItemImage } from './ItemImage';
import {
  filterAndSortGalleryItems,
  computeWearCountMap,
  resolveNextGalleryViewerItemId,
} from '../utils/closetDomain';

const SWIPE_THRESHOLD_PX = 40;
const TAP_MOVE_LIMIT_PX = 10;

export const ClosetGallerySection: React.FC = () => {
  const {
    closetData,
    wearHistory,
    archiveItem,
    unarchiveItem,
    toggleShirtOuterwear,
  } = useClosetStore();

  const [filter, setFilter] = useState<GalleryCategoryFilter>('all');
  const [includeArchived, setIncludeArchived] = useState<boolean>(false);
  const [viewerItemId, setViewerItemId] = useState<string | null>(null);

  // 着用回数マップの算出
  const wearCountMap = useMemo(() => computeWearCountMap(wearHistory), [wearHistory]);

  // 絞り込みおよびID順ソート済みアイテム一覧
  const displayedItems = useMemo(
    () => filterAndSortGalleryItems(closetData.items, filter, includeArchived),
    [closetData.items, filter, includeArchived]
  );

  // 現在ビューアで選択中のアイテム
  const currentViewerItem = useMemo(() => {
    if (!viewerItemId) return null;
    return displayedItems.find((it) => it.id === viewerItemId) || null;
  }, [displayedItems, viewerItemId]);

  const currentIndex = useMemo(() => {
    if (!currentViewerItem) return -1;
    return displayedItems.findIndex((it) => it.id === currentViewerItem.id);
  }, [displayedItems, currentViewerItem]);

  // ビューア内の服が操作等でリストから外れた場合のフォールバック追従
  const prevDisplayedItemsRef = useRef<ClosetItem[]>(displayedItems);
  useEffect(() => {
    if (viewerItemId && !displayedItems.some((it) => it.id === viewerItemId)) {
      const nextId = resolveNextGalleryViewerItemId(
        viewerItemId,
        prevDisplayedItemsRef.current,
        displayedItems
      );
      setViewerItemId(nextId);
    }
    prevDisplayedItemsRef.current = displayedItems;
  }, [displayedItems, viewerItemId]);

  // ビューアの前後移動
  const handlePrev = useCallback(() => {
    if (displayedItems.length === 0 || currentIndex === -1) return;
    const nextIdx = (currentIndex - 1 + displayedItems.length) % displayedItems.length;
    setViewerItemId(displayedItems[nextIdx].id);
  }, [displayedItems, currentIndex]);

  const handleNext = useCallback(() => {
    if (displayedItems.length === 0 || currentIndex === -1) return;
    const nextIdx = (currentIndex + 1) % displayedItems.length;
    setViewerItemId(displayedItems[nextIdx].id);
  }, [displayedItems, currentIndex]);

  // アイテム操作ハンドラー（同一イベント内で次の表示IDを解決し、モーダルのチラつきを防止）
  const handleArchive = useCallback(
    (item: ClosetItem) => {
      if (!includeArchived) {
        const nextDisplayed = displayedItems.filter((it) => it.id !== item.id);
        const nextId = resolveNextGalleryViewerItemId(item.id, displayedItems, nextDisplayed);
        setViewerItemId(nextId);
      }
      archiveItem(item.id);
    },
    [includeArchived, displayedItems, archiveItem]
  );

  const handleUnarchive = useCallback(
    (item: ClosetItem) => {
      unarchiveItem(item.id);
    },
    [unarchiveItem]
  );

  const handleToggleOuterwear = useCallback(
    (item: ClosetItem) => {
      const nextIsOuterwear = !item.isOuterwear;
      const willBeExcluded =
        (filter === 'shirt' && nextIsOuterwear) ||
        (filter === 'outerwear' && !nextIsOuterwear);

      if (willBeExcluded) {
        const nextDisplayed = displayedItems.filter((it) => it.id !== item.id);
        const nextId = resolveNextGalleryViewerItemId(item.id, displayedItems, nextDisplayed);
        setViewerItemId(nextId);
      }
      toggleShirtOuterwear(item.id, nextIsOuterwear);
    },
    [filter, displayedItems, toggleShirtOuterwear]
  );

  // キーボード操作（Escapeで閉じる、左右キーで移動）
  useEffect(() => {
    if (!currentViewerItem) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setViewerItemId(null);
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentViewerItem, handlePrev, handleNext]);

  // スワイプ検出
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const didSwipeRef = useRef<boolean>(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      touchStartRef.current = null;
      didSwipeRef.current = true;
      return;
    }
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    didSwipeRef.current = false;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const start = touchStartRef.current;
    touchStartRef.current = null;

    const touch = e.changedTouches[0];
    if (!touch) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absX >= SWIPE_THRESHOLD_PX && absX > absY) {
      didSwipeRef.current = true;
      if (deltaX > 0) {
        handlePrev();
      } else {
        handleNext();
      }
      return;
    }

    if (absX > TAP_MOVE_LIMIT_PX || absY > TAP_MOVE_LIMIT_PX) {
      didSwipeRef.current = true;
    }
  };

  const handleOverlayClick = () => {
    if (didSwipeRef.current) {
      didSwipeRef.current = false;
      return;
    }
    setViewerItemId(null);
  };

  return (
    <section className="space-y-3.5">
      {/* セクションタイトル ＆ 状態情報 */}
      <div className="flex items-center justify-between px-1">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Images className="w-5 h-5 text-blue-400" />
          <span>クローゼット写真一覧</span>
        </h2>
        <span className="text-xs font-mono font-bold text-blue-300 bg-blue-950/60 border border-blue-800/60 px-2.5 py-1 rounded-full">
          {displayedItems.length}着 表示中
        </span>
      </div>

      <p className="text-xs text-slate-400 px-1 leading-relaxed">
        服の写真を縦長一覧で確認できます。写真をタップすると全画面ビューアが開き、左右スワイプで前後の服を切り替えながら片付けや羽織り分類を変更できます。
      </p>

      {/* 絞り込みピル ＆ 片付けた服トグル */}
      <div className="space-y-2">
        {/* カテゴリ絞り込み（44px以上のタップターゲット） */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-900/80 border border-slate-800 rounded-xl">
          {GALLERY_CATEGORY_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setFilter(opt.id)}
              className={`min-h-[44px] flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${
                filter === opt.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* 片付けた服も表示トグル */}
        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            onClick={() => setIncludeArchived((prev) => !prev)}
            className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold border flex items-center gap-2 transition-all active:scale-[0.98] ${
              includeArchived
                ? 'bg-amber-950/70 border-amber-700/80 text-amber-300 shadow-sm'
                : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-300'
            }`}
          >
            <Archive className="w-4 h-4 text-amber-400" />
            <span>片付けた服も表示</span>
            <span
              className={`w-4 h-4 rounded flex items-center justify-center text-[10px] ${
                includeArchived
                  ? 'bg-amber-500 text-slate-950 font-extrabold'
                  : 'bg-slate-800 text-transparent border border-slate-700'
              }`}
            >
              {includeArchived && <Check className="w-3 h-3 stroke-[3]" />}
            </span>
          </button>
          <span className="text-[11px] text-slate-400">
            並び順: ID順（シャツ→パンツ）
          </span>
        </div>
      </div>

      {/* 3列・3:4 写真グリッド */}
      {displayedItems.length === 0 ? (
        <div className="p-8 text-center bg-slate-900/60 border border-slate-800 rounded-2xl text-xs text-slate-400 leading-relaxed space-y-1">
          <p className="font-bold text-slate-300">該当する服がありません</p>
          <p>絞り込み条件を変更するか、「片付けた服も表示」をオンにしてみてください。</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {displayedItems.map((item) => {
            const isShirt = item.category === 'shirt';
            const isArchived = Boolean(item.archived);

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setViewerItemId(item.id)}
                className={`flex flex-col text-left p-1.5 rounded-xl border transition-all relative group cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isArchived
                    ? 'bg-slate-900/40 border-amber-900/40 opacity-75 hover:opacity-100 hover:border-amber-700/60'
                    : 'bg-slate-900/90 border-slate-800 hover:border-slate-700 hover:bg-slate-800/80 shadow-md'
                }`}
                title={`${item.id} ${item.name} を拡大表示`}
              >
                {/* 縦長 3:4 写真エリア */}
                <div className="aspect-[3/4] w-full rounded-lg overflow-hidden bg-slate-950 relative">
                  <ItemImage
                    item={item}
                    showBadge={false}
                    className="w-full h-full"
                    imgClassName="w-full h-full object-contain transition-transform group-hover:scale-105"
                  />

                  {/* IDバッジ */}
                  <span
                    className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-bold font-mono shadow-md ${
                      isShirt
                        ? 'bg-blue-950/90 text-blue-300 border border-blue-800/80'
                        : 'bg-emerald-950/90 text-emerald-300 border border-emerald-800/80'
                    }`}
                  >
                    {item.id}
                  </span>

                  {/* 羽織りバッジ */}
                  {isShirt && item.isOuterwear && (
                    <span className="absolute top-1 right-1 px-1 py-0.5 rounded text-[9px] font-bold bg-indigo-950/90 text-indigo-300 border border-indigo-700/80 shadow-md">
                      🧥
                    </span>
                  )}

                  {/* 保管中バッジ */}
                  {isArchived && (
                    <span className="absolute bottom-1 left-1 right-1 text-center py-0.5 rounded text-[9px] font-bold bg-amber-950/95 text-amber-300 border border-amber-800/80 shadow-md truncate">
                      📦 片付けた服
                    </span>
                  )}
                </div>

                {/* アイテム名 */}
                <div className="mt-1 px-0.5">
                  <div className="text-[11px] font-semibold text-slate-200 truncate">
                    {item.name}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* 全画面スワイプビューア（モーダル） */}
      {currentViewerItem && (
        <div
          onClick={handleOverlayClick}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="fixed inset-0 z-50 flex flex-col bg-black/95 animate-fade-in select-none touch-pan-y"
          role="dialog"
          aria-modal="true"
          aria-label={`${currentViewerItem.id} ${currentViewerItem.name} の全画面表示`}
        >
          {/* 上部ヘッダーバー（位置表示・ID・閉じるボタン） */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 bg-slate-900/90 backdrop-blur-md border-b border-slate-800/80 flex-shrink-0 z-10 pt-safe"
          >
            {/* 左側: 位置インデックス ＆ IDバッジ */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-mono font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md">
                {currentIndex + 1} / {displayedItems.length}
              </span>
              <span
                className={`px-2 py-0.5 rounded-md text-xs font-bold font-mono border ${
                  currentViewerItem.category === 'shirt'
                    ? 'bg-blue-950/90 text-blue-300 border-blue-700/60'
                    : 'bg-emerald-950/90 text-emerald-300 border-emerald-700/60'
                }`}
              >
                {currentViewerItem.id}
              </span>
              {currentViewerItem.category === 'shirt' && currentViewerItem.isOuterwear && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-700/60">
                  🧥 羽織り
                </span>
              )}
              {currentViewerItem.archived && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-700/60">
                  📦 片付けた服
                </span>
              )}
            </div>

            {/* 右側: 前後切り替え ＆ 閉じるボタン */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                onClick={handlePrev}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                title="前の服へ"
                aria-label="前の服へ"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                title="次の服へ"
                aria-label="次の服へ"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  didSwipeRef.current = false;
                  setViewerItemId(null);
                }}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white transition-colors ml-1"
                title="閉じる"
                aria-label="閉じる"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* 中央大判写真エリア（できるだけ大きく表示、3:4比率維持） */}
          <div className="flex-1 min-h-0 w-full h-full flex items-center justify-center overflow-hidden bg-black relative p-2">
            <div className="aspect-[3/4] w-full max-w-[calc((100dvh-12rem)*0.75)] max-h-full flex items-center justify-center">
              <ItemImage
                item={currentViewerItem}
                showBadge={false}
                className="w-full h-full !rounded-none !bg-black"
                imgClassName="w-full h-full object-contain drop-shadow-2xl"
              />
            </div>

            {/* 左右タップ誘導ボタン（デスクトップ等での操作補助） */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
              className="absolute left-2 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] hidden sm:flex items-center justify-center rounded-full bg-slate-900/60 hover:bg-slate-900 text-slate-300 hover:text-white border border-slate-700/60 backdrop-blur-sm transition-all"
              title="前の服へ"
              aria-label="前の服へ"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] hidden sm:flex items-center justify-center rounded-full bg-slate-900/60 hover:bg-slate-900 text-slate-300 hover:text-white border border-slate-700/60 backdrop-blur-sm transition-all"
              title="次の服へ"
              aria-label="次の服へ"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>

          {/* 下部情報・整理アクションバー（属性・操作） */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900/95 backdrop-blur-md border-t border-slate-800 p-3 sm:p-4 flex-shrink-0 space-y-3 pb-safe z-10"
          >
            {/* 服の属性表示 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm sm:text-base font-bold text-white truncate">
                  {currentViewerItem.name}
                </h3>
                <span className="text-xs font-mono font-bold text-slate-300 bg-slate-800 px-2 py-0.5 rounded flex-shrink-0">
                  着用 {wearCountMap.get(currentViewerItem.id) || 0}回
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300 flex-wrap">
                <span>🎨 {currentViewerItem.color || '未設定'}</span>
                <span>•</span>
                <span>{currentViewerItem.seasonSleeve}</span>
                <span>•</span>
                <span>
                  {currentViewerItem.category === 'shirt'
                    ? currentViewerItem.isOuterwear
                      ? '羽織り'
                      : '1枚もの'
                    : 'パンツ'}
                </span>
                {currentViewerItem.notes && (
                  <>
                    <span>•</span>
                    <span className="text-slate-400 truncate max-w-xs">{currentViewerItem.notes}</span>
                  </>
                )}
              </div>
            </div>

            {/* アクションボタンバー（片付ける／出す、羽織り切り替え） */}
            <div className="flex items-center gap-2 pt-1">
              {/* 片付ける / 出すボタン */}
              {currentViewerItem.archived ? (
                <button
                  type="button"
                  onClick={() => handleUnarchive(currentViewerItem)}
                  className="flex-1 min-h-[44px] py-2.5 px-4 bg-emerald-950/90 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-sm"
                  title={`${currentViewerItem.name} を現役に復帰させる`}
                >
                  <Undo2 className="w-4 h-4" />
                  <span>出す</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleArchive(currentViewerItem)}
                  className="flex-1 min-h-[44px] py-2.5 px-4 bg-slate-800/90 hover:bg-slate-800 text-amber-300 hover:text-amber-200 border border-slate-700 hover:border-amber-700/80 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-sm"
                  title={`${currentViewerItem.name} を片付ける`}
                >
                  <Package className="w-4 h-4 text-amber-400" />
                  <span>片付ける</span>
                </button>
              )}

              {/* シャツの場合の羽織り切り替えボタン */}
              {currentViewerItem.category === 'shirt' && (
                <button
                  type="button"
                  onClick={() => handleToggleOuterwear(currentViewerItem)}
                  className="flex-1 min-h-[44px] py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                  title={currentViewerItem.isOuterwear ? '1枚ものに変更' : '羽織りに変更'}
                >
                  <span>
                    {currentViewerItem.isOuterwear ? '👔 1枚ものに変更' : '🧥 羽織りに変更'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
