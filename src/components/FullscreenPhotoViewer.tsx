import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { ClosetItem } from '../types/closet';
import { ItemImage } from './ItemImage';
import { ArchiveToggleButton, OuterwearToggleButton } from './GarmentActionButtons';

const SWIPE_THRESHOLD_PX = 40;
const TAP_MOVE_LIMIT_PX = 10;

export interface FullscreenPhotoViewerProps {
  items: ClosetItem[];
  currentItemId: string | null;
  onSelectItem: (itemId: string) => void;
  onClose: () => void;
  wearCountMap?: Map<string, number>;
  onArchive?: (item: ClosetItem) => void;
  onUnarchive?: (item: ClosetItem) => void;
  onToggleOuterwear?: (item: ClosetItem) => void;
  showDetailsFooter?: boolean;
}

export const FullscreenPhotoViewer: React.FC<FullscreenPhotoViewerProps> = ({
  items,
  currentItemId,
  onSelectItem,
  onClose,
  wearCountMap,
  onArchive,
  onUnarchive,
  onToggleOuterwear,
  showDetailsFooter = true,
}) => {
  const currentItem = useMemo(() => {
    if (!currentItemId) return null;
    return items.find((it) => it.id === currentItemId) || null;
  }, [items, currentItemId]);

  const currentIndex = useMemo(() => {
    if (!currentItem) return -1;
    return items.findIndex((it) => it.id === currentItem.id);
  }, [items, currentItem]);

  const handlePrev = useCallback(() => {
    if (items.length <= 1 || currentIndex === -1) return;
    const nextIdx = (currentIndex - 1 + items.length) % items.length;
    onSelectItem(items[nextIdx].id);
  }, [items, currentIndex, onSelectItem]);

  const handleNext = useCallback(() => {
    if (items.length <= 1 || currentIndex === -1) return;
    const nextIdx = (currentIndex + 1) % items.length;
    onSelectItem(items[nextIdx].id);
  }, [items, currentIndex, onSelectItem]);

  // キーボード操作（Escapeで閉じる、左右キーで移動）
  useEffect(() => {
    if (!currentItem) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentItem, onClose, handlePrev, handleNext]);

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
    onClose();
  };

  if (!currentItem) return null;

  const hasMultiple = items.length > 1;

  return (
    <div
      onClick={handleOverlayClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="fixed inset-0 z-[60] flex flex-col bg-black/95 animate-fade-in select-none touch-pan-y"
      role="dialog"
      aria-modal="true"
      aria-label={`${currentItem.id} ${currentItem.name} の全画面表示`}
    >
      {/* 上部ヘッダーバー */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 bg-slate-900/90 backdrop-blur-md border-b border-slate-800/80 flex-shrink-0 z-10 pt-safe"
      >
        {/* 左側: 位置インデックス ＆ IDバッジ ＆ 名前（showDetailsFooter が false の場合） */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md flex-shrink-0">
            {currentIndex + 1} / {items.length}
          </span>
          <span
            className={`px-2 py-0.5 rounded-md text-xs font-bold font-mono flex-shrink-0 border ${
              currentItem.category === 'shirt'
                ? 'bg-blue-950/90 text-blue-300 border-blue-700/60'
                : 'bg-emerald-950/90 text-emerald-300 border-emerald-700/60'
            }`}
          >
            {currentItem.id}
          </span>
          {currentItem.category === 'shirt' && currentItem.isOuterwear && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-700/60 flex-shrink-0">
              🧥 羽織り
            </span>
          )}
          {currentItem.archived && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-700/60 flex-shrink-0">
              📦 片付けた服
            </span>
          )}
          {!showDetailsFooter && (
            <span className="text-sm sm:text-base font-bold text-white truncate ml-1">
              {currentItem.name}
            </span>
          )}
        </div>

        {/* 右側: 前後切り替え ＆ 閉じるボタン */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hasMultiple && (
            <>
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
            </>
          )}
          <button
            type="button"
            onClick={() => {
              didSwipeRef.current = false;
              onClose();
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
        <div
          className={`aspect-[3/4] w-full max-h-full flex items-center justify-center ${
            showDetailsFooter
              ? 'max-w-[calc((100dvh-12rem)*0.75)]'
              : 'max-w-[calc((100dvh-4rem)*0.75)]'
          }`}
        >
          <ItemImage
            item={currentItem}
            showBadge={false}
            className="w-full h-full !rounded-none !bg-black"
            imgClassName="w-full h-full object-contain drop-shadow-2xl"
          />
        </div>

        {/* 左右タップ誘導ボタン（デスクトップ等での操作補助） */}
        {hasMultiple && (
          <>
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
          </>
        )}
      </div>

      {/* 下部情報・整理アクションバー（showDetailsFooter が true の場合のみ表示） */}
      {showDetailsFooter && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="bg-slate-900/95 backdrop-blur-md border-t border-slate-800 p-3 sm:p-4 flex-shrink-0 space-y-3 pb-safe z-10"
        >
          {/* 服の属性表示 */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm sm:text-base font-bold text-white truncate">
                {currentItem.name}
              </h3>
              {wearCountMap && (
                <span className="text-xs font-mono font-bold text-slate-300 bg-slate-800 px-2 py-0.5 rounded flex-shrink-0">
                  着用 {wearCountMap.get(currentItem.id) || 0}回
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-300 flex-wrap">
              <span>🎨 {currentItem.color || '未設定'}</span>
              <span>•</span>
              <span>{currentItem.seasonSleeve}</span>
              <span>•</span>
              <span>
                {currentItem.category === 'shirt'
                  ? currentItem.isOuterwear
                    ? '羽織り'
                    : '1枚もの'
                  : 'パンツ'}
              </span>
              {currentItem.notes && (
                <>
                  <span>•</span>
                  <span className="text-slate-400 truncate max-w-xs">{currentItem.notes}</span>
                </>
              )}
            </div>
          </div>

          {/* アクションボタンバー（片付ける／出す、羽織り切り替え） */}
          {(onArchive || onToggleOuterwear) && (
            <div className="flex items-center gap-2 pt-1">
              {onArchive && onUnarchive && (
                <ArchiveToggleButton
                  item={currentItem}
                  onArchive={onArchive}
                  onUnarchive={onUnarchive}
                  variant="bar"
                />
              )}
              {onToggleOuterwear && currentItem.category === 'shirt' && (
                <OuterwearToggleButton
                  item={currentItem}
                  onToggle={onToggleOuterwear}
                  variant="bar"
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
