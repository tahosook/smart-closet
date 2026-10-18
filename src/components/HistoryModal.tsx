import React from 'react';
import { X, Trash2, Calendar, Play } from 'lucide-react';
import { useClosetStore } from '../hooks/useClosetStore';
import { ItemImage } from './ItemImage';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HistoryModal: React.FC<HistoryModalProps> = ({ isOpen, onClose }) => {
  const {
    wearHistory,
    itemMap,
    pants,
    removeWearRecord,
    clearAllWearHistory,
    simulateYesterdayWear,
  } = useClosetStore();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl relative max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-400" />
            <h3 className="text-sm font-bold text-white">着用履歴＆冷却期間テスト</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-full bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Simulation for testing cooling period */}
        <div className="p-3 bg-slate-800/80 rounded-2xl border border-slate-700/60 space-y-2">
          <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
            <Play className="w-3.5 h-3.5 text-amber-400" />
            <span>冷却期間クイックテスト（昨日着用シミュレート）</span>
          </div>
          <p className="text-[11px] text-slate-400">
            パンツをタップすると「昨日着用」として履歴を1件即座に作成し、朝モードでの順位下げ動作を確認できます。
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {pants.slice(0, 6).map((p) => (
              <button
                key={p.id}
                onClick={() => simulateYesterdayWear(p.id)}
                className="py-1.5 px-2 bg-slate-700 hover:bg-amber-600/80 text-white rounded-lg text-[10px] font-bold flex-shrink-0 transition-colors"
                title={`${p.name} を昨日着用に設定`}
              >
                {p.id} を昨日着用
              </button>
            ))}
          </div>
        </div>

        {/* Wear History List */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 no-scrollbar">
          {wearHistory.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              まだ着用履歴がありません。「今日これ着る」を押すとここに記録されます。
            </div>
          ) : (
            wearHistory.map((rec) => {
              const shirt = itemMap.get(rec.shirtId);
              const p = itemMap.get(rec.pantsId);

              return (
                <div
                  key={rec.id}
                  className="p-2.5 bg-slate-800/70 border border-slate-700/60 rounded-xl flex items-center justify-between"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex -space-x-2 flex-shrink-0">
                      {shirt && (
                        <div className="w-8 h-8 rounded-lg overflow-hidden bg-slate-900 border border-slate-700">
                          <ItemImage item={shirt} showBadge={false} className="w-full h-full" />
                        </div>
                      )}
                      {p && (
                        <div className="w-8 h-8 rounded-lg overflow-hidden bg-slate-900 border border-slate-700">
                          <ItemImage item={p} showBadge={false} className="w-full h-full" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] text-blue-400 font-mono font-bold">
                        {rec.date} ({rec.scene === 'office' ? '出社' : 'リモート'})
                      </div>
                      <div className="text-xs font-semibold text-white truncate">
                        {shirt?.name || rec.shirtId} × {p?.name || rec.pantsId}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => removeWearRecord(rec.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors"
                    title="この履歴を削除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer actions */}
        {wearHistory.length > 0 && (
          <div className="pt-2 border-t border-slate-800 flex justify-end">
            <button
              onClick={() => {
                if (window.confirm('すべての着用履歴を削除しますか？')) {
                  clearAllWearHistory();
                }
              }}
              className="text-xs text-rose-400 hover:text-rose-300 font-medium"
            >
              全履歴をクリア
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
