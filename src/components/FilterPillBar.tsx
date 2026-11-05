import React from 'react';
import { FilterOption } from '../types/closet';

export interface FilterPillBarProps<T extends string = string> {
  options: readonly FilterOption<T>[];
  activeId: string;
  onSelect: (id: T) => void;
  variant?: 'segmented' | 'wrap';
  className?: string;
}

export function FilterPillBar<T extends string = string>({
  options,
  activeId,
  onSelect,
  variant = 'segmented',
  className = '',
}: FilterPillBarProps<T>): React.ReactElement {
  if (variant === 'wrap') {
    return (
      <div className={`flex flex-wrap gap-1.5 flex-1 ${className}`}>
        {options.map((opt) => {
          const isSelected = activeId === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              className={`min-h-[44px] px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                isSelected
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40 ring-1 ring-blue-400'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-750 hover:text-white border border-slate-700/60'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-1.5 p-1 bg-slate-900/80 border border-slate-800 rounded-xl ${className}`}
    >
      {options.map((opt) => {
        const isSelected = activeId === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onSelect(opt.id)}
            className={`min-h-[44px] flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${
              isSelected
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
