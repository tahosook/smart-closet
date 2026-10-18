import React, { useState, useMemo } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Building2,
  Home,
  Check,
  Undo2,
} from 'lucide-react';
import { SceneMode, ClosetItem } from '../types/closet';
import { useClosetStore } from '../hooks/useClosetStore';
import { WeatherWidget } from './WeatherWidget';
import { ItemImage } from './ItemImage';

export const TodayView: React.FC = () => {
  const {
    shirts,
    itemMap,
    todayRecord,
    getRecommendationsForShirt,
    recordWear,
    registerWifeNg,
    removeWifeNg,
  } = useClosetStore();

  const [scene, setScene] = useState<SceneMode>('office');
  // Default selected shirt: S2 (white shirt) or first shirt or today's recorded shirt
  const [selectedShirtId, setSelectedShirtId] = useState<string>(
    () => todayRecord?.shirtId || 'S2'
  );
  const [showOtherPants, setShowOtherPants] = useState(false);
  const [showNgAccordion, setShowNgAccordion] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  const selectedShirt = useMemo(
    () => itemMap.get(selectedShirtId) || shirts[0],
    [itemMap, selectedShirtId, shirts]
  );

  const { recommended, otherOk, ngList } = useMemo(
    () => getRecommendationsForShirt(selectedShirt.id, scene),
    [getRecommendationsForShirt, selectedShirt.id, scene]
  );

  const topRecommendations = recommended.slice(0, 3);
  const remainingRecommendations = recommended.slice(3);

  const handleSelectWear = (pantsItem: ClosetItem) => {
    recordWear(selectedShirt.id, pantsItem.id, scene);
    showToast(`✅ 今日のコーデ「${selectedShirt.name} × ${pantsItem.name}」を決定しました！`);
  };

  const handleRegisterWifeNg = (pantsItem: ClosetItem) => {
    registerWifeNg(selectedShirt.id, pantsItem.id);
    showToast(`🚨「${selectedShirt.name} × ${pantsItem.name}」を奥様NGに登録しました`);
  };

  const handleRemoveWifeNg = (pantsItem: ClosetItem) => {
    removeWifeNg(selectedShirt.id, pantsItem.id);
    showToast(`「${selectedShirt.name} × ${pantsItem.name}」の奥様NGを解除しました`);
  };

  return (
    <div className="space-y-4 pb-20">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-16 left-4 right-4 z-50 flex items-center justify-between p-3.5 bg-slate-900/95 border border-blue-500/80 rounded-xl shadow-2xl backdrop-blur-md text-white text-sm animate-bounce">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      {/* 1. Weather Widget */}
      <WeatherWidget />

      {/* 2. Scene Selector */}
      <div className="bg-slate-800/90 p-1.5 rounded-2xl border border-slate-700/80 flex shadow-md">
        <button
          onClick={() => setScene('office')}
          className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${
            scene === 'office'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>🏢 オフィス出社</span>
        </button>
        <button
          onClick={() => setScene('remote')}
          className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${
            scene === 'remote'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Home className="w-4 h-4" />
          <span>🏠 リモート＆外出</span>
        </button>
      </div>

      {/* Today's Decision Status Banner if already chosen */}
      {todayRecord && itemMap.get(todayRecord.shirtId) && itemMap.get(todayRecord.pantsId) && (
        <div className="p-3 bg-gradient-to-r from-emerald-950/80 to-slate-900 border border-emerald-600/70 rounded-2xl flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            <div>
              <div className="text-[11px] text-emerald-300 font-semibold uppercase tracking-wider">
                本日の決定コーディネート
              </div>
              <div className="text-xs font-bold text-white mt-0.5">
                {itemMap.get(todayRecord.shirtId)?.name} × {itemMap.get(todayRecord.pantsId)?.name}
              </div>
            </div>
          </div>
          <span className="text-[10px] bg-emerald-900/60 text-emerald-300 px-2 py-1 rounded-md border border-emerald-700/50">
            {todayRecord.scene === 'office' ? '出社' : 'リモート'}
          </span>
        </div>
      )}

      {/* 3. Upper: Shirt Grid (9 shirts) */}
      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            今日のシャツを選ぶ（1タップ）
          </h2>
          <span className="text-xs text-slate-400">全{shirts.length}着</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {shirts.map((shirt) => {
            const isSelected = shirt.id === selectedShirt.id;
            return (
              <button
                key={shirt.id}
                onClick={() => setSelectedShirtId(shirt.id)}
                className={`flex flex-col text-left p-1.5 rounded-xl border transition-all relative ${
                  isSelected
                    ? 'bg-blue-950/60 border-blue-500 ring-2 ring-blue-500/50 shadow-lg'
                    : 'bg-slate-800/80 border-slate-700/60 hover:border-slate-600 hover:bg-slate-800'
                }`}
              >
                <div className="aspect-square w-full rounded-lg overflow-hidden bg-slate-900">
                  <ItemImage item={shirt} className="w-full h-full" />
                </div>
                <div className="mt-1 px-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-blue-400">{shirt.id}</span>
                    <span className="text-[9px] text-slate-400 truncate max-w-[55px]">
                      {shirt.seasonSleeve}
                    </span>
                  </div>
                  <div className="text-[11px] font-semibold text-slate-100 line-clamp-1 leading-tight mt-0.5">
                    {shirt.name}
                  </div>
                </div>

                {isSelected && (
                  <div className="absolute top-1 right-1 bg-blue-600 text-white p-0.5 rounded-full shadow">
                    <Check className="w-3 h-3 stroke-[3]" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* 4. Lower: Instant Pants Decision Panel */}
      <section className="space-y-3 pt-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            【1秒即決】おすすめパンツ
          </h2>
          <span className="text-xs text-slate-400">
            {selectedShirt.name.split('（')[0]} に合う候補
          </span>
        </div>

        {/* Selected Shirt Context Capsule */}
        <div className="p-2.5 bg-slate-800/60 border border-slate-700/60 rounded-xl flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-slate-900">
            <ItemImage item={selectedShirt} showBadge={false} className="w-full h-full" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-white truncate">{selectedShirt.name}</div>
            <div className="text-[11px] text-slate-400 truncate">{selectedShirt.notes}</div>
          </div>
        </div>

        {/* Top Recommendations (1st to 3rd candidates) */}
        {topRecommendations.length === 0 ? (
          <div className="p-6 bg-slate-800/40 border border-dashed border-slate-700 rounded-2xl text-center text-slate-400 text-sm">
            このシャツに合う推奨パンツがありません。
          </div>
        ) : (
          <div className="space-y-3">
            {topRecommendations.map((rec) => {
              const p = rec.pants;
              const isTodayChosen = todayRecord?.shirtId === selectedShirt.id && todayRecord?.pantsId === p.id;
              const rankLabels = ['🥇 第1候補', '🥈 第2候補', '🥉 第3候補'];
              const rankColors = [
                'bg-amber-500/20 text-amber-300 border-amber-500/40',
                'bg-slate-300/20 text-slate-200 border-slate-400/40',
                'bg-amber-700/20 text-amber-400 border-amber-700/40',
              ];

              return (
                <div
                  key={p.id}
                  className={`p-3.5 rounded-2xl border transition-all ${
                    isTodayChosen
                      ? 'bg-slate-800/95 border-emerald-500/80 ring-2 ring-emerald-500/30'
                      : 'bg-slate-800/90 border-slate-700/80 shadow-md'
                  }`}
                >
                  <div className="flex gap-3.5">
                    {/* Pants Photo Card */}
                    <div className="w-24 h-28 flex-shrink-0 rounded-xl overflow-hidden bg-slate-950 border border-slate-700/50">
                      <ItemImage item={p} className="w-full h-full" />
                    </div>

                    {/* Information */}
                    <div className="flex-1 flex flex-col justify-between min-w-0">
                      <div>
                        {/* Badges row */}
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                              rankColors[rec.rank - 1] || 'bg-slate-700 text-slate-300'
                            }`}
                          >
                            {rankLabels[rec.rank - 1] || `第${rec.rank}候補`}
                          </span>

                          {rec.isYesterdayWorn && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-950/70 text-rose-300 border border-rose-800/70 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 text-rose-400" />
                              昨日着用（冷却期間）
                            </span>
                          )}

                          <span className="px-1.5 py-0.5 rounded text-[9px] text-slate-400 bg-slate-900 border border-slate-700">
                            ドレス度 {p.dressScore}
                          </span>
                        </div>

                        {/* Pants Name */}
                        <h3 className="text-sm font-bold text-white leading-snug line-clamp-1">
                          {p.name}
                        </h3>

                        {/* Affinity Reason */}
                        <p className="text-[11px] text-slate-300 leading-relaxed mt-1 line-clamp-2">
                          {rec.affinityReason}
                        </p>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2 mt-2 pt-1 border-t border-slate-700/50">
                        <button
                          onClick={() => handleSelectWear(p)}
                          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                            isTodayChosen
                              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                              : 'bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-900/40 active:scale-[0.98]'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{isTodayChosen ? '本日着用中' : '✅ 今日これ着る'}</span>
                        </button>

                        <button
                          onClick={() => handleRegisterWifeNg(p)}
                          className="py-2 px-2.5 rounded-xl text-[11px] font-semibold bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 flex items-center gap-1 transition-colors active:scale-[0.98]"
                          title="この組み合わせを奥様NGリストに登録"
                        >
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                          <span className="hidden sm:inline">奥様NG</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Other Acceptable Pants Toggle */}
        {(remainingRecommendations.length > 0 || otherOk.length > 0) && (
          <div className="pt-1">
            <button
              onClick={() => setShowOtherPants(!showOtherPants)}
              className="w-full py-2.5 px-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/70 text-xs font-semibold text-slate-300 flex items-center justify-between"
            >
              <span>その他の着用可能パンツ（{remainingRecommendations.length + otherOk.length}本）</span>
              {showOtherPants ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showOtherPants && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                {[...remainingRecommendations, ...otherOk].map((rec) => {
                  const p = rec.pants;
                  return (
                    <div
                      key={p.id}
                      className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60 flex flex-col justify-between"
                    >
                      <div className="aspect-square w-full rounded-lg overflow-hidden bg-slate-900 mb-2">
                        <ItemImage item={p} className="w-full h-full" />
                      </div>
                      <div className="min-w-0">
                        {rec.isYesterdayWorn && (
                          <span className="text-[9px] text-rose-300 bg-rose-950 px-1 py-0.5 rounded block mb-1 truncate">
                            ⚠️ 昨日着用
                          </span>
                        )}
                        <div className="text-xs font-bold text-white truncate">{p.name}</div>
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">{p.notes}</div>
                      </div>
                      <div className="flex gap-1 mt-2">
                        <button
                          onClick={() => handleSelectWear(p)}
                          className="flex-1 py-1.5 px-2 bg-slate-700 hover:bg-blue-600 rounded-lg text-[10px] font-bold text-white transition-colors"
                        >
                          着る
                        </button>
                        <button
                          onClick={() => handleRegisterWifeNg(p)}
                          className="p-1.5 bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 rounded-lg text-[10px]"
                          title="奥様NG"
                        >
                          🚨
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 5. NG Accordion */}
        <div className="pt-2">
          <button
            onClick={() => setShowNgAccordion(!showNgAccordion)}
            className="w-full py-2.5 px-3 rounded-xl bg-slate-900/80 hover:bg-slate-900 border border-rose-900/40 text-xs font-semibold text-rose-300 flex items-center justify-between"
          >
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              <span>🚫 このシャツのNGパンツ（{ngList.length}本）</span>
            </div>
            {showNgAccordion ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showNgAccordion && (
            <div className="space-y-2 mt-2">
              {ngList.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400 bg-slate-900/60 rounded-xl">
                  このシャツにはNGパンツはありません。すべてのパンツと合わせられます。
                </div>
              ) : (
                ngList.map(({ pants: p, reason, isWifeNg }) => (
                  <div
                    key={p.id}
                    className="p-2.5 rounded-xl bg-slate-900/90 border border-rose-900/30 flex items-center justify-between opacity-80"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-950 flex-shrink-0 grayscale">
                        <ItemImage item={p} showBadge={false} className="w-full h-full" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-300 truncate">{p.name}</span>
                          {isWifeNg && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-900/70 text-rose-200">
                              奥様NG
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-rose-400/90 truncate mt-0.5">
                          理由: {reason}
                        </div>
                      </div>
                    </div>

                    {isWifeNg && (
                      <button
                        onClick={() => handleRemoveWifeNg(p)}
                        className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-colors flex items-center gap-1 text-[10px]"
                        title="奥様NGを解除"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        <span>解除</span>
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
