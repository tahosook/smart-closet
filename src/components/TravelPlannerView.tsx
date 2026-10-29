import React, { useState, useMemo } from 'react';
import {
  Luggage,
  Calendar,
  Briefcase,
  Compass,
  RotateCw,
  Check,
  Info,
} from 'lucide-react';
import { ClosetItem } from '../types/closet';
import { useClosetStore } from '../hooks/useClosetStore';
import { ItemImage } from './ItemImage';

type TripPurpose = 'business' | 'leisure';

interface DayPlan {
  dayNumber: number;
  label: string;
  shirt: ClosetItem;
  pants: ClosetItem;
  sceneNote: string;
}

export const TravelPlannerView: React.FC = () => {
  const { shirts, pants, isNgPair } = useClosetStore();

  const [nights, setNights] = useState<number>(2); // 1 to 4 nights
  const [purpose, setPurpose] = useState<TripPurpose>('business');
  const [seed, setSeed] = useState<number>(0);

  const daysCount = nights + 1;

  // Auto-generate optimal 2 bottoms and shirt timeline
  const plan = useMemo(() => {
    if (shirts.length === 0 || pants.length === 0) {
      return { bottoms: [], days: [] };
    }
    // 1. Filter viable versatile bottoms
    // Exclude single-shirt-dependent bottoms like P5, P10, P11
    const versatilePants = pants.filter((p) => {
      if (purpose === 'business') {
        // Business trip needs dressScore >= 3.5
        return p.dressScore >= 3.5;
      } else {
        // Leisure trip needs comfortScore >= 3.5
        return p.comfortScore >= 3.5;
      }
    });

    // Score bottoms by versatility (how many shirts they can pair with without NG)
    const scoredPants = versatilePants.map((p) => {
      let compatibleShirts = 0;
      let scoreSum = 0;
      shirts.forEach((s) => {
        const { isNg } = isNgPair(s.id, p.id);
        if (!isNg) {
          compatibleShirts += 1;
          const isRec =
            purpose === 'business'
              ? s.officeRecommendIds.includes(p.id)
              : s.remoteRecommendIds.includes(p.id);
          scoreSum += isRec ? 3 : 1;
        }
      });
      return { pants: p, compatibleShirts, scoreSum };
    });

    scoredPants.sort((a, b) => b.scoreSum - a.scoreSum);

    // Pick top 2 distinct bottoms (e.g., P9 & P3 or P12 & P8)
    // Apply seed rotation if user clicks reroll
    const p1Index = seed % Math.max(1, scoredPants.length - 1);
    const p2Index = (p1Index + 1 + (seed % 2)) % scoredPants.length;

    const b1 = (scoredPants[p1Index] || scoredPants[0])?.pants || pants[0];
    const b2 = (scoredPants[p2Index] || scoredPants[1])?.pants || pants[1] || pants[0];

    // Pick N distinct shirts that match the alternating bottoms
    const usedShirtIds = new Set<string>();
    const dayPlans: DayPlan[] = [];

    const dayLabels = [
      'Day 1 (出発・移動・初日)',
      'Day 2 (現地活動・メイン日)',
      'Day 3 (打合せ・終日活動)',
      'Day 4 (予備日・滞在)',
      'Day 5 (最終日・帰路)',
    ];

    for (let day = 0; day < daysCount; day++) {
      // Alternate bottoms: Day 0 -> b1, Day 1 -> b2, Day 2 -> b1, etc.
      const currentBottom = day % 2 === 0 ? b1 : b2;

      // Find best candidate shirt for this bottom not yet used
      const candidates = shirts.filter(
        (s) => !usedShirtIds.has(s.id) && !isNgPair(s.id, currentBottom.id).isNg
      );

      // Sort candidate shirts by recommendation to this bottom
      candidates.sort((a, b) => {
        const aRec =
          purpose === 'business'
            ? a.officeRecommendIds.includes(currentBottom.id)
            : a.remoteRecommendIds.includes(currentBottom.id);
        const bRec =
          purpose === 'business'
            ? b.officeRecommendIds.includes(currentBottom.id)
            : b.remoteRecommendIds.includes(currentBottom.id);
        if (aRec !== bRec) return aRec ? -1 : 1;
        return b.dressScore - a.dressScore;
      });

      const selectedShirt = candidates[0] || shirts[0];
      usedShirtIds.add(selectedShirt.id);

      let sceneNote = '';
      if (day === 0) {
        sceneNote = '移動中の快適さと到着時の清潔感を両立したリラックスコーデ。';
      } else if (day === daysCount - 1) {
        sceneNote = '最終日の荷物整理と帰路移動に快適な組み合わせ。';
      } else {
        sceneNote =
          purpose === 'business'
            ? 'ビジネス商談・会食でも奥様目線・同僚目線で安心の好印象コーデ。'
            : '街歩きや観光でもシワになりにくく疲れにくいスマートカジュアル。';
      }

      dayPlans.push({
        dayNumber: day + 1,
        label: dayLabels[day] || `Day ${day + 1}`,
        shirt: selectedShirt,
        pants: currentBottom,
        sceneNote,
      });
    }

    return {
      bottoms: [b1, b2],
      days: dayPlans,
    };
  }, [nights, purpose, seed, shirts, pants, isNgPair, daysCount]);

  if (shirts.length === 0 || pants.length === 0) {
    return (
      <div className="space-y-6 pb-20">
        <div className="p-4 bg-gradient-to-r from-slate-900 via-indigo-950/60 to-slate-900 border border-slate-700/80 rounded-2xl shadow-xl">
          <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm mb-1">
            <Luggage className="w-4 h-4 text-indigo-400" />
            <span>旅行パッキング (Travel Planner)</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            最小限のボトムス（2本）を1日おきに交互着用し、日数分のシャツを着回すことで、荷物を極小化しながら奥様NGを100%回避します。
          </p>
        </div>
        <div className="bg-slate-800/80 border border-slate-700/70 rounded-2xl p-6 text-center text-slate-400 space-y-2">
          <p className="text-sm font-bold text-slate-300">現役のシャツまたはパンツがありません</p>
          <p className="text-xs text-slate-400">
            すべての服が「片付けた服」に入っているか、登録されていません。「マトリクス」の「片付けた服」から服を「出す」操作を行うと再開できます。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="p-4 bg-gradient-to-r from-slate-900 via-indigo-950/60 to-slate-900 border border-slate-700/80 rounded-2xl shadow-xl">
        <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm mb-1">
          <Luggage className="w-4 h-4 text-indigo-400" />
          <span>旅行パッキング (Travel Planner)</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          最小限のボトムス（2本）を1日おきに交互着用し、日数分のシャツを着回すことで、荷物を極小化しながら奥様NGを100%回避します。
        </p>
      </div>

      {/* Trip Config Controls */}
      <div className="bg-slate-800/80 border border-slate-700/70 rounded-2xl p-4 space-y-4 shadow-md">
        {/* Nights Selector */}
        <div>
          <label className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-blue-400" />
            <span>泊数（1〜4泊）を選択</span>
          </label>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setNights(n)}
                className={`py-2 px-1 rounded-xl text-xs font-bold border transition-all ${
                  nights === n
                    ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-900/40'
                    : 'bg-slate-900/60 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                <div>{n}泊{n + 1}日</div>
              </button>
            ))}
          </div>
        </div>

        {/* Purpose Selector */}
        <div>
          <label className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-emerald-400" />
            <span>旅行の目的</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPurpose('business')}
              className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all ${
                purpose === 'business'
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-900/40'
                  : 'bg-slate-900/60 text-slate-400 border-slate-700 hover:text-white'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span>🏢 出張・きれいめ重視</span>
            </button>
            <button
              onClick={() => setPurpose('leisure')}
              className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all ${
                purpose === 'leisure'
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-900/40'
                  : 'bg-slate-900/60 text-slate-400 border-slate-700 hover:text-white'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>🚗 観光・快適さ重視</span>
            </button>
          </div>
        </div>

        {/* Reshuffle button */}
        <button
          onClick={() => setSeed((prev) => prev + 1)}
          className="w-full py-2 px-3 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 transition-colors border border-slate-600/60"
        >
          <RotateCw className="w-3.5 h-3.5" />
          <span>🔄 別の組み合わせパターンを再提案</span>
        </button>
      </div>

      {/* Minimal Packing Summary Checklist */}
      <section className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-4 shadow-lg">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center justify-between">
          <span>🎒 パッキング持ち物リスト（最小限構成）</span>
          <span className="text-[11px] text-blue-400">
            ボトムス2本 ＋ シャツ{daysCount}枚
          </span>
        </h3>

        <div className="grid grid-cols-2 gap-3">
          {/* Bottoms */}
          <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-700/60">
            <div className="text-[11px] font-bold text-amber-400 mb-2 flex items-center gap-1">
              <Check className="w-3 h-3" />
              <span>持参ボトムス（厳選2本）</span>
            </div>
            <div className="space-y-2">
              {plan.bottoms.map((b, idx) => (
                <div key={b.id} className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg overflow-hidden bg-slate-800 flex-shrink-0">
                    <ItemImage item={b} showBadge={false} className="w-full h-full" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] text-slate-400 font-mono">
                      {idx === 0 ? '【初日着用】' : '【バッグ持参】'}
                    </div>
                    <div className="text-xs font-bold text-white truncate">{b.name}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Shirts */}
          <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-700/60">
            <div className="text-[11px] font-bold text-sky-400 mb-2 flex items-center gap-1">
              <Check className="w-3 h-3" />
              <span>持参シャツ（{daysCount}枚）</span>
            </div>
            <div className="space-y-1.5 max-h-36 overflow-y-auto no-scrollbar">
              {plan.days.map((d) => (
                <div key={d.dayNumber} className="flex items-center gap-2 text-xs">
                  <span className="text-[10px] font-mono text-slate-400 w-8">
                    D{d.dayNumber}:
                  </span>
                  <span className="text-white truncate font-medium">{d.shirt.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Day by Day Timeline */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5 px-1">
          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
          <span>日別コーディネート・タイムライン</span>
        </h3>

        <div className="space-y-3">
          {plan.days.map((d) => (
            <div
              key={d.dayNumber}
              className="p-3.5 bg-slate-800/80 border border-slate-700/70 rounded-2xl shadow-md space-y-2.5"
            >
              <div className="flex items-center justify-between text-xs border-b border-slate-700/50 pb-2">
                <span className="font-bold text-blue-400">{d.label}</span>
                <span className="text-[10px] text-slate-400">
                  {d.pants.name.split('（')[0]} 着用日
                </span>
              </div>

              {/* Garment pair visual */}
              <div className="grid grid-cols-2 gap-3 items-center">
                {/* Shirt */}
                <div className="p-2 bg-slate-900/90 rounded-xl border border-slate-700/50 flex items-center gap-2.5">
                  <div className="w-12 h-14 rounded-lg overflow-hidden bg-slate-950 flex-shrink-0">
                    <ItemImage item={d.shirt} className="w-full h-full" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[9px] text-blue-400 font-bold block">{d.shirt.id}</span>
                    <div className="text-xs font-bold text-white line-clamp-1">{d.shirt.name}</div>
                    <div className="text-[10px] text-slate-400 truncate mt-0.5">
                      {d.shirt.seasonSleeve}
                    </div>
                  </div>
                </div>

                {/* Pants */}
                <div className="p-2 bg-slate-900/90 rounded-xl border border-slate-700/50 flex items-center gap-2.5">
                  <div className="w-12 h-14 rounded-lg overflow-hidden bg-slate-950 flex-shrink-0">
                    <ItemImage item={d.pants} className="w-full h-full" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[9px] text-emerald-400 font-bold block">{d.pants.id}</span>
                    <div className="text-xs font-bold text-white line-clamp-1">{d.pants.name}</div>
                    <div className="text-[10px] text-slate-400 truncate mt-0.5">{d.pants.notes}</div>
                  </div>
                </div>
              </div>

              {/* Scene note */}
              <div className="flex items-start gap-1.5 text-[11px] text-slate-300 bg-slate-900/50 p-2 rounded-lg">
                <Info className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
                <span>{d.sceneNote}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
