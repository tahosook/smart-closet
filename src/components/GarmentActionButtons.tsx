import React from 'react';
import { Package, Undo2 } from 'lucide-react';
import { ClosetItem } from '../types/closet';

export interface ArchiveToggleButtonProps {
  item: ClosetItem;
  onArchive: (item: ClosetItem) => void;
  onUnarchive: (item: ClosetItem) => void;
  variant?: 'compact' | 'bar';
  className?: string;
}

export const ArchiveToggleButton: React.FC<ArchiveToggleButtonProps> = ({
  item,
  onArchive,
  onUnarchive,
  variant = 'compact',
  className = '',
}) => {
  const isBar = variant === 'bar';

  if (item.archived) {
    return (
      <button
        type="button"
        onClick={() => onUnarchive(item)}
        className={`min-h-[44px] bg-emerald-950/90 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 rounded-xl font-bold flex items-center justify-center transition-all active:scale-[0.98] shadow-sm ${
          isBar
            ? 'flex-1 py-2.5 px-4 text-xs sm:text-sm gap-2'
            : 'min-w-[56px] px-3 py-2 text-xs gap-1.5'
        } ${className}`}
        title={`${item.name} を出す`}
      >
        <Undo2 className="w-4 h-4 flex-shrink-0" />
        <span>出す</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onArchive(item)}
      className={`min-h-[44px] bg-slate-800/90 hover:bg-slate-800 border border-slate-700 hover:border-amber-700/80 transition-all flex items-center justify-center active:scale-[0.98] ${
        isBar
          ? 'flex-1 py-2.5 px-4 text-amber-300 hover:text-amber-200 rounded-xl text-xs sm:text-sm font-bold gap-2 shadow-sm'
          : 'px-2.5 py-1.5 text-slate-300 hover:text-amber-300 rounded-lg text-xs font-semibold gap-1 flex-shrink-0'
      } ${className}`}
      title={`${item.name} を片付ける`}
    >
      <Package className={`${isBar ? 'w-4 h-4' : 'w-3.5 h-3.5'} text-amber-400 flex-shrink-0`} />
      <span>片付ける</span>
    </button>
  );
};

export interface OuterwearToggleButtonProps {
  item: ClosetItem;
  onToggle: (item: ClosetItem) => void;
  variant?: 'compact' | 'bar';
  className?: string;
}

export const OuterwearToggleButton: React.FC<OuterwearToggleButtonProps> = ({
  item,
  onToggle,
  variant = 'compact',
  className = '',
}) => {
  if (item.category !== 'shirt') {
    return null;
  }

  const isBar = variant === 'bar';

  return (
    <button
      type="button"
      onClick={() => onToggle(item)}
      className={`min-h-[44px] bg-slate-800/80 hover:bg-slate-700 border border-slate-700 font-semibold flex items-center justify-center transition-all active:scale-[0.98] ${
        isBar
          ? 'flex-1 py-2.5 px-3 text-slate-200 rounded-xl text-xs sm:text-sm gap-1.5'
          : 'px-2 py-1 text-slate-300 rounded-lg text-[10px] gap-1'
      } ${className}`}
      title={item.isOuterwear ? '1枚ものに変更' : '羽織りに変更'}
    >
      <span>{item.isOuterwear ? '👔 1枚ものに変更' : '🧥 羽織りに変更'}</span>
    </button>
  );
};
