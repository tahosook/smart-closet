import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Images, Archive, Check } from 'lucide-react';
import {
  ClosetItem,
  GalleryCategoryFilter,
  GALLERY_CATEGORY_FILTER_OPTIONS,
} from '../types/closet';
import { useClosetStore } from '../hooks/useClosetStore';
import { ItemImage } from './ItemImage';
import { FilterPillBar } from './FilterPillBar';
import { FullscreenPhotoViewer } from './FullscreenPhotoViewer';
import {
  filterAndSortGalleryItems,
  computeWearCountMap,
  resolveNextGalleryViewerItemId,
} from '../utils/closetDomain';

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
        <FilterPillBar
          options={GALLERY_CATEGORY_FILTER_OPTIONS}
          activeId={filter}
          onSelect={setFilter}
        />

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

                  {/* 片付けた服バッジ */}
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
      {viewerItemId && (
        <FullscreenPhotoViewer
          items={displayedItems}
          currentItemId={viewerItemId}
          onSelectItem={setViewerItemId}
          onClose={() => setViewerItemId(null)}
          wearCountMap={wearCountMap}
          onArchive={handleArchive}
          onUnarchive={handleUnarchive}
          onToggleOuterwear={handleToggleOuterwear}
          showDetailsFooter={true}
        />
      )}
    </section>
  );
};
