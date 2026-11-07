import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
  Thermometer,
  X,
  Maximize2,
  ArrowUp,
} from 'lucide-react';
import {
  SceneMode,
  ClosetItem,
  GarmentMeasurements,
  TodayTopCategoryFilter,
  TODAY_TOP_CATEGORY_FILTER_OPTIONS,
  SleeveCategory,
  isShirtMatchingSleeveCategory,
  isTopMatchingScene,
  selectRecommendedShirtsForToday,
} from '../types/closet';
import { useClosetStore } from '../hooks/useClosetStore';
import { WeatherWidget, WeatherData } from './WeatherWidget';
import { ItemImage } from './ItemImage';
import { FilterPillBar } from './FilterPillBar';
import { FullscreenPhotoViewer } from './FullscreenPhotoViewer';

function formatPantsMeasurements(m?: GarmentMeasurements): string | null {
  if (!m) return null;
  const parts: string[] = [];
  if (m.waist !== undefined) parts.push(`W ${m.waist}`);
  if (m.inseam !== undefined) parts.push(`股下 ${m.inseam}`);
  if (parts.length === 0) {
    if (m.totalLength !== undefined) parts.push(`総丈 ${m.totalLength}`);
    if (m.hemWidth !== undefined) parts.push(`裾幅 ${m.hemWidth}`);
  }
  return parts.length > 0 ? parts.join(' / ') + 'cm' : null;
}

function formatShirtMeasurements(m?: GarmentMeasurements): string | null {
  if (!m) return null;
  const parts: string[] = [];
  if (m.bodyLength !== undefined) parts.push(`着丈 ${m.bodyLength}`);
  if (m.chestWidth !== undefined) parts.push(`身幅 ${m.chestWidth}`);
  if (parts.length === 0) {
    if (m.shoulderWidth !== undefined) parts.push(`肩幅 ${m.shoulderWidth}`);
    if (m.sleeveLength !== undefined) parts.push(`袖丈 ${m.sleeveLength}`);
  }
  return parts.length > 0 ? parts.join(' / ') + 'cm' : null;
}

export const TodayView: React.FC = () => {
  const {
    shirts,
    wearHistory,
    itemMap,
    todayRecord,
    yesterdayWornPantsIds,
    getRecommendationsForShirt,
    recordWear,
    updateTodayOuterwear,
    registerWifeNg,
    removeWifeNg,
  } = useClosetStore();

  const [scene, setScene] = useState<SceneMode>('office');
  const [sleeveCategory, setSleeveCategory] = useState<SleeveCategory>('long');
  const [shirtTypeFilter, setShirtTypeFilter] = useState<TodayTopCategoryFilter>('single');
  const [showAllMatchingShirts, setShowAllMatchingShirts] = useState(false);
  const [showHiddenShirts, setShowHiddenShirts] = useState(false);
  const [showOtherPants, setShowOtherPants] = useState(false);
  const [showNgAccordion, setShowNgAccordion] = useState(false);
  const [isOuterwearAccordionOpen, setIsOuterwearAccordionOpen] = useState(false);
  const [selectedOuterwearId, setSelectedOuterwearId] = useState<string | undefined>(
    () => todayRecord?.outerwearId
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [zoomItemPair, setZoomItemPair] = useState<{ shirt: ClosetItem; pants: ClosetItem } | null>(
    null
  );
  const [singleZoomItem, setSingleZoomItem] = useState<ClosetItem | null>(null);

  const recommendationsRef = useRef<HTMLElement>(null);
  const shirtSectionRef = useRef<HTMLElement>(null);

  // Default selected top: today's recorded shirt (if active), or #1 recommended top for default office/long
  const [selectedShirtId, setSelectedShirtId] = useState<string>(() => {
    if (todayRecord?.shirtId && shirts.some((s) => s.id === todayRecord.shirtId)) {
      return todayRecord.shirtId;
    }
    const initialRecs = selectRecommendedShirtsForToday({
      shirts,
      sleeveCategory: 'long',
      scene: 'office',
      wearHistory,
      limit: 1,
    });
    return initialRecs.recommendedShirts[0]?.id || shirts[0]?.id || 'S1';
  });

  const handleSelectShirt = (shirtId: string) => {
    setSelectedShirtId(shirtId);
    // On mobile (< lg), smoothly scroll to recommendations so user immediately sees recommended bottoms
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setTimeout(() => {
        recommendationsRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 50);
    }
  };

  const handleScrollToShirts = () => {
    shirtSectionRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // 天気・シーン・着用履歴に基づくおすすめトップスの算出（パンツ推奨には依存しない）
  const recommendedResult = useMemo(() => {
    return selectRecommendedShirtsForToday({
      shirts,
      sleeveCategory,
      scene,
      wearHistory,
      limit: 3,
    });
  }, [shirts, sleeveCategory, scene, wearHistory]);

  const { hiddenShirts } = recommendedResult;

  // 条件（シーン、袖丈、種別フィルター）ごとの母集団を決定論的に解決する純粋ヘルパー
  const getTopPopulation = useCallback(
    (
      targetScene: SceneMode,
      targetSleeveCategory: SleeveCategory,
      targetFilter: TodayTopCategoryFilter
    ): ClosetItem[] => {
      const activeShirts = shirts.filter((s) => !s.archived);
      const matching = activeShirts.filter((s) =>
        isShirtMatchingSleeveCategory(s, targetSleeveCategory)
      );
      if (targetFilter === 'outerwear') {
        return matching.filter((s) => Boolean(s.isOuterwear));
      }
      const recs = selectRecommendedShirtsForToday({
        shirts,
        sleeveCategory: targetSleeveCategory,
        scene: targetScene,
        wearHistory,
        limit: 3,
      });
      return recs.scoredCandidates.map((c) => c.shirt);
    },
    [shirts, wearHistory]
  );

  // 現在の条件（シーン・気温・種別ピル）におけるトップス母集団
  const currentPopulation = useMemo(
    () => getTopPopulation(scene, sleeveCategory, shirtTypeFilter),
    [getTopPopulation, scene, sleeveCategory, shirtTypeFilter]
  );

  // 選択の自動変更ヘルパー:
  // 選択中トップスが新しい母集団の外に出た場合のみ、新しい母集団のおすすめ第1位（または先頭）へ移動する。
  const ensureSelectionInPopulation = useCallback(
    (
      targetScene: SceneMode,
      targetSleeveCategory: SleeveCategory,
      targetFilter: TodayTopCategoryFilter
    ) => {
      const population = getTopPopulation(targetScene, targetSleeveCategory, targetFilter);
      const currentSelected = shirts.find((s) => s.id === selectedShirtId);
      const isStillInPopulation =
        currentSelected && population.some((s) => s.id === currentSelected.id);

      if (!isStillInPopulation) {
        const nextTop = population[0];
        if (nextTop) {
          setSelectedShirtId(nextTop.id);
        }
      }
    },
    [getTopPopulation, selectedShirtId, shirts]
  );

  const handleSceneChange = (nextScene: SceneMode) => {
    setScene(nextScene);
    ensureSelectionInPopulation(nextScene, sleeveCategory, shirtTypeFilter);
  };

  const handleCategoryChange = (nextCategory: SleeveCategory) => {
    setSleeveCategory(nextCategory);
    ensureSelectionInPopulation(scene, nextCategory, shirtTypeFilter);
  };

  const handleWeatherLoaded = useCallback(
    (data: WeatherData) => {
      setSleeveCategory(data.recommendedCategory);
      ensureSelectionInPopulation(scene, data.recommendedCategory, shirtTypeFilter);
    },
    [ensureSelectionInPopulation, scene, shirtTypeFilter]
  );

  const handleFilterChange = (nextFilter: TodayTopCategoryFilter) => {
    setShirtTypeFilter(nextFilter);
    ensureSelectionInPopulation(scene, sleeveCategory, nextFilter);
  };

  const selectedShirt = useMemo(
    () =>
      shirts.find((s) => s.id === selectedShirtId) ||
      currentPopulation[0] ||
      shirts[0],
    [selectedShirtId, shirts, currentPopulation]
  );

  // 画面に表示する気温適合トップス（おすすめ枠3着 または 全件）
  // おすすめ枠表示時は、厳密におすすめ上位（最大3着）のみを表示し、選択中トップスの例外追加表示は行わない
  const visibleMatchingShirts = useMemo(() => {
    if (shirtTypeFilter === 'outerwear') {
      return currentPopulation;
    }
    if (showAllMatchingShirts) {
      return currentPopulation;
    }
    return recommendedResult.recommendedShirts;
  }, [
    shirtTypeFilter,
    showAllMatchingShirts,
    currentPopulation,
    recommendedResult.recommendedShirts,
  ]);

  const displayedHiddenShirts = useMemo(() => {
    if (shirtTypeFilter === 'outerwear') {
      return hiddenShirts.filter((s) => Boolean(s.isOuterwear));
    }
    return hiddenShirts.filter((s) => !s.isOuterwear && isTopMatchingScene(s, scene));
  }, [hiddenShirts, shirtTypeFilter, scene]);

  // todayRecord の変更に追従（undefined を含め常に同期）
  useEffect(() => {
    setSelectedOuterwearId(todayRecord?.outerwearId);
  }, [todayRecord?.outerwearId]);

  // 利用可能な羽織り候補（片付けていないシャツのうち isOuterwear: true かつ 選択中シャツ以外）
  const availableOuterwears = useMemo(() => {
    if (!selectedShirt) return [];
    return shirts.filter((s) => Boolean(s.isOuterwear) && s.id !== selectedShirt.id);
  }, [shirts, selectedShirt?.id]);

  const selectedOuterwear = useMemo(
    () => (selectedOuterwearId ? itemMap.get(selectedOuterwearId) : undefined),
    [selectedOuterwearId, itemMap]
  );

  // 羽織りの選択・解除ハンドラ
  const handleToggleOuterwear = (outerwearItem: ClosetItem) => {
    const nextId = selectedOuterwearId === outerwearItem.id ? undefined : outerwearItem.id;
    setSelectedOuterwearId(nextId);

    if (todayRecord && selectedShirt && todayRecord.shirtId === selectedShirt.id) {
      updateTodayOuterwear(nextId);
      if (nextId) {
        showToast(`🧥 羽織り「${outerwearItem.name}」を追加しました`);
      } else {
        showToast('🧥 羽織りを解除しました');
      }
    } else {
      if (nextId) {
        showToast(`🧥 羽織り「${outerwearItem.name}」を選択しました（パンツ決定時に記録されます）`);
      } else {
        showToast('🧥 羽織りを解除しました');
      }
    }
  };

  const handleClearOuterwear = () => {
    setSelectedOuterwearId(undefined);
    if (todayRecord && selectedShirt && todayRecord.shirtId === selectedShirt.id) {
      updateTodayOuterwear(undefined);
      showToast('🧥 羽織りを解除しました');
    }
  };

  const handleClearBannerOuterwear = () => {
    if (todayRecord) {
      updateTodayOuterwear(undefined);
      showToast('🧥 羽織りを解除しました');
    }
    if (selectedShirt && todayRecord?.shirtId === selectedShirt.id) {
      setSelectedOuterwearId(undefined);
    }
  };

  // If selected shirt is in hidden shirts, auto-expand so user knows what's selected
  const isSelectedShirtHidden = useMemo(
    () => (selectedShirt ? hiddenShirts.some((s) => s.id === selectedShirt.id) : false),
    [hiddenShirts, selectedShirt]
  );

  const { recommended, otherOk, ngList } = useMemo(
    () => (selectedShirt ? getRecommendationsForShirt(selectedShirt.id, scene) : { recommended: [], otherOk: [], ngList: [] }),
    [getRecommendationsForShirt, selectedShirt, scene]
  );

  // If today's chosen pants is in NG list for this shirt, auto-expand so user knows what's selected
  const isSelectedPantsInNg = useMemo(
    () =>
      Boolean(
        todayRecord &&
          selectedShirt &&
          todayRecord.shirtId === selectedShirt.id &&
          ngList.some((item) => item.pants.id === todayRecord.pantsId)
      ),
    [todayRecord, selectedShirt?.id, ngList]
  );

  // Auto-expand NG accordion once when selected shirt's worn pants is in NG list,
  // while allowing user to freely toggle (collapse/open) afterwards.
  useEffect(() => {
    if (isSelectedPantsInNg) {
      setShowNgAccordion(true);
    }
  }, [isSelectedPantsInNg]);

  const topRecommendations = recommended.slice(0, 3);
  const remainingRecommendations = recommended.slice(3);

  const handleSelectWear = (pantsItem: ClosetItem) => {
    recordWear(selectedShirt.id, pantsItem.id, scene, undefined, selectedOuterwearId);
    const outerwearPart = selectedOuterwear ? ` ＋ 🧥 ${selectedOuterwear.name}` : '';
    showToast(`✅ 今日のコーデ「${selectedShirt.name} × ${pantsItem.name}${outerwearPart}」を決定しました！`);
  };

  const handleRegisterWifeNg = (pantsItem: ClosetItem) => {
    registerWifeNg(selectedShirt.id, pantsItem.id);
    showToast(`🚨「${selectedShirt.name} × ${pantsItem.name}」を奥様NGに登録しました`);
  };

  const handleRemoveWifeNg = (pantsItem: ClosetItem) => {
    removeWifeNg(selectedShirt.id, pantsItem.id);
    showToast(`「${selectedShirt.name} × ${pantsItem.name}」の奥様NGを解除しました`);
  };

  if (shirts.length === 0) {
    return (
      <div className="p-8 text-center bg-slate-900/80 border border-slate-800 rounded-2xl space-y-3">
        <div className="text-3xl">👕</div>
        <h3 className="text-base font-bold text-white">利用可能なトップスがありません</h3>
        <p className="text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
          すべてのトップスが「片付けた服」に入っているか、登録されていません。「管理」タブの「ワードローブ整理」セクションから「出す」で戻すことができます。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 lg:space-y-4 pb-20">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-16 left-4 right-4 z-50 flex items-center justify-between p-3.5 bg-slate-900/95 border border-blue-500/80 rounded-xl shadow-2xl backdrop-blur-md text-white text-sm animate-bounce">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      {/* 2-Pane Responsive Grid (Desktop Mac mini & Mobile Pixel 9a) */}
      <div className="space-y-2.5 lg:space-y-0 lg:grid lg:grid-cols-12 lg:gap-6 lg:items-start">
        {/* Left Pane (Desktop 5 cols): Weather, Scene, Today Decision Banner, Shirt Grid */}
        <div className="space-y-2.5 lg:space-y-4 lg:col-span-5 lg:sticky lg:top-20">
          {/* 1. Weather Widget */}
          <WeatherWidget
            onWeatherLoaded={handleWeatherLoaded}
            activeCategory={sleeveCategory}
            onCategoryChange={handleCategoryChange}
          />

      {/* 2. Scene Selector */}
      <div className="bg-slate-800/90 p-1 rounded-xl sm:rounded-2xl border border-slate-700/80 flex shadow-md">
        <button
          onClick={() => handleSceneChange('office')}
          className={`flex-1 min-h-[44px] py-2 sm:py-2.5 px-2.5 sm:px-3 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${
            scene === 'office'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Building2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span>🏢 オフィス出社</span>
        </button>
        <button
          onClick={() => handleSceneChange('remote')}
          className={`flex-1 min-h-[44px] py-2 sm:py-2.5 px-2.5 sm:px-3 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${
            scene === 'remote'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Home className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span>🚶 外出</span>
        </button>
      </div>

      {/* Today's Decision Status Banner if already chosen */}
      {todayRecord && itemMap.get(todayRecord.shirtId) && itemMap.get(todayRecord.pantsId) && (
        <div className="py-2 px-3 sm:p-3 bg-gradient-to-r from-emerald-950/80 to-slate-900 border border-emerald-600/70 rounded-xl sm:rounded-2xl flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] text-emerald-300 font-semibold uppercase tracking-wider">
                本日の決定コーディネート
              </div>
              <div className="text-[11px] sm:text-xs font-bold text-white mt-0.5 truncate">
                {itemMap.get(todayRecord.shirtId)?.name} × {itemMap.get(todayRecord.pantsId)?.name}
                {todayRecord.outerwearId && itemMap.get(todayRecord.outerwearId) && (
                  <span className="text-amber-300 ml-1">
                    ＋ 🧥 {itemMap.get(todayRecord.outerwearId)?.name}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {todayRecord.outerwearId && (
              <button
                type="button"
                onClick={handleClearBannerOuterwear}
                className="min-h-[44px] px-2 py-1 text-[10px] bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-600"
                title="羽織りを外す"
              >
                羽織り解除
              </button>
            )}
            <span className="text-[10px] bg-emerald-900/60 text-emerald-300 px-2 py-1 rounded-md border border-emerald-700/50">
              {todayRecord.scene === 'office' ? '出社' : '外出'}
            </span>
          </div>
        </div>
      )}

      {/* 3. Upper: Shirt Grid (Weather-filtered) */}
      <section ref={shirtSectionRef} className="scroll-mt-16 space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            <span>今日のトップスを選ぶ（1タップ）</span>
          </h2>
          <span className="text-xs text-blue-400 font-medium">
            {shirtTypeFilter === 'single' &&
            !showAllMatchingShirts &&
            currentPopulation.length > recommendedResult.recommendedShirts.length
              ? `おすすめ ${visibleMatchingShirts.length}着 / 気温適合 ${currentPopulation.length}着`
              : `気温に最適 ${visibleMatchingShirts.length}着`}
          </span>
        </div>

        {/* Top Category Type Filter Pills (2 pills: 1枚もの / 羽織り) */}
        <FilterPillBar
          options={TODAY_TOP_CATEGORY_FILTER_OPTIONS}
          activeId={shirtTypeFilter}
          onSelect={handleFilterChange}
        />

        {/* Matching Shirts (Primary View - Large 3-Column Grid) */}
        <div className="grid grid-cols-3 gap-2">
          {visibleMatchingShirts.map((shirt) => {
            const isSelected = shirt.id === selectedShirt.id;
            return (
              <button
                key={shirt.id}
                onClick={() => handleSelectShirt(shirt.id)}
                className={`flex flex-col text-left p-1.5 rounded-xl border transition-all relative ${
                  isSelected
                    ? 'bg-blue-950/70 border-blue-500 ring-2 ring-blue-500/50 shadow-lg'
                    : 'bg-slate-800/80 border-slate-700/60 hover:border-slate-600 hover:bg-slate-800'
                }`}
              >
                <div className="aspect-square w-full rounded-lg overflow-hidden bg-slate-900">
                  <ItemImage item={shirt} className="w-full h-full" imgClassName="object-contain" />
                </div>
                <div className="mt-1 px-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-blue-400">{shirt.id}</span>
                    <span className="text-[9px] text-slate-400 truncate max-w-[55px]">
                      {shirt.seasonSleeve.split('・')[0]}
                    </span>
                  </div>
                  <div className="text-[11px] font-semibold text-slate-100 line-clamp-1 leading-tight mt-0.5">
                    {shirt.name}
                  </div>
                  {shirt.isOuterwear && (
                    <span className="inline-block mt-0.5 px-1 py-0.2 rounded text-[8px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-700/60">
                      🧥 羽織り
                    </span>
                  )}
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

        {/* All Matching Tops Expand Toggle */}
        {shirtTypeFilter === 'single' &&
          currentPopulation.length > recommendedResult.recommendedShirts.length && (
            <div className="pt-0.5">
              <button
                type="button"
                onClick={() => setShowAllMatchingShirts(!showAllMatchingShirts)}
                className="w-full min-h-[44px] py-2 px-3 rounded-xl bg-slate-800/40 hover:bg-slate-800/70 border border-slate-700/50 text-[11px] font-medium text-slate-300 hover:text-white flex items-center justify-between transition-colors active:scale-[0.99]"
              >
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                  <span>
                    {showAllMatchingShirts
                      ? '✨ おすすめのトップスに絞る'
                      : `👕 気温に合うトップスを全部見る（全${currentPopulation.length}着）`}
                  </span>
                </div>
                {showAllMatchingShirts ? (
                  <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>
            </div>
          )}

        {/* Hidden Tops Accordion Toggle (For tops that don't match today's weather) */}
        {displayedHiddenShirts.length > 0 && (
          <div className="pt-1">
            <button
              onClick={() => setShowHiddenShirts(!showHiddenShirts)}
              className="w-full min-h-[44px] py-2 px-3 rounded-xl bg-slate-800/40 hover:bg-slate-800/70 border border-slate-700/50 text-[11px] font-medium text-slate-400 hover:text-slate-200 flex items-center justify-between transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <Thermometer className="w-3.5 h-3.5 text-slate-500" />
                <span>
                  {showHiddenShirts || isSelectedShirtHidden
                    ? '気温外のトップスを折りたたむ'
                    : `今日の気温外のトップスも見る（${displayedHiddenShirts.length}着）`}
                </span>
              </div>
              {showHiddenShirts || isSelectedShirtHidden ? (
                <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              )}
            </button>

            {(showHiddenShirts || isSelectedShirtHidden) && (
              <div className="mt-2 p-2.5 bg-slate-900/60 rounded-xl border border-slate-800 space-y-2">
                <div className="text-[10px] text-slate-400 font-semibold px-1">
                  ※ 気温目安に合っていませんが、タップすれば選択できます
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {displayedHiddenShirts.map((shirt) => {
                    const isSelected = shirt.id === selectedShirt.id;
                    return (
                      <button
                        key={shirt.id}
                        onClick={() => handleSelectShirt(shirt.id)}
                        className={`flex flex-col text-left p-1.5 rounded-xl border transition-all relative ${
                          isSelected
                            ? 'bg-blue-950/70 border-blue-500 ring-2 ring-blue-500/50 shadow-lg'
                            : 'bg-slate-800/40 border-slate-700/40 hover:border-slate-600 hover:bg-slate-800 opacity-75 hover:opacity-100'
                        }`}
                      >
                        <div className="aspect-square w-full rounded-lg overflow-hidden bg-slate-900">
                          <ItemImage item={shirt} className="w-full h-full" imgClassName="object-contain" />
                        </div>
                        <div className="mt-1 px-0.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-slate-400">{shirt.id}</span>
                            <span className="text-[9px] text-amber-400/80 truncate">
                              {shirt.seasonSleeve.split('・')[0]}
                            </span>
                          </div>
                          <div className="text-[11px] font-semibold text-slate-300 line-clamp-1 leading-tight mt-0.5">
                            {shirt.name}
                          </div>
                          {shirt.isOuterwear && (
                            <span className="inline-block mt-0.5 px-1 py-0.2 rounded text-[8px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-700/60">
                              🧥 羽織り
                            </span>
                          )}
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
              </div>
            )}
          </div>
        )}
      </section>
        </div>

        {/* Right Pane (Desktop 7 cols): Instant Pants Decision Panel, Other Pants, NG List */}
        <div className="space-y-4 lg:col-span-7">
          {/* 4. Lower: Instant Pants Decision Panel (Large Photo Cards) */}
          <section ref={recommendationsRef} className="scroll-mt-16 space-y-3 pt-1 lg:pt-0">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            <span>【1秒即決】おすすめパンツ（写真拡大版）</span>
          </h2>
          <span className="text-xs text-slate-400">
            {selectedShirt.name.split('（')[0]} に合う候補
          </span>
        </div>

        {/* Selected Shirt Context Capsule with Mobile Quick Return */}
        <div className="p-2.5 bg-slate-800/80 border border-slate-700/80 rounded-xl flex items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-slate-900 border border-slate-700/60">
              <ItemImage item={selectedShirt} showBadge={false} className="w-full h-full" imgClassName="object-contain" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-bold text-blue-400">{selectedShirt.id}</span>
                <div className="text-xs font-bold text-white truncate">{selectedShirt.name}</div>
                {selectedShirt.color && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-medium text-slate-300 bg-slate-900 border border-slate-700">
                    🎨 {selectedShirt.color}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 truncate mt-0.5">{selectedShirt.notes}</div>
            </div>
          </div>

          <button
            onClick={handleScrollToShirts}
            className="lg:hidden flex items-center justify-center gap-1 min-h-[44px] min-w-[44px] px-3 py-2 -my-1 rounded-lg bg-blue-950/70 hover:bg-blue-900 border border-blue-700/50 text-[11px] font-bold text-blue-300 flex-shrink-0 transition-colors active:scale-95 shadow"
            title="トップス一覧へ戻る"
          >
            <ArrowUp className="w-3.5 h-3.5" />
            <span>トップス変更</span>
          </button>
        </div>

        {/* 4.5. Outerwear Manual Addition Selector (Optional, Max 1 item) */}
        {availableOuterwears.length > 0 && (
          <div className="p-2.5 bg-slate-800/60 border border-slate-700/60 rounded-xl space-y-2">
            <button
              type="button"
              onClick={() => setIsOuterwearAccordionOpen(!isOuterwearAccordionOpen)}
              className="w-full min-h-[44px] flex items-center justify-between text-left transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base flex-shrink-0">🧥</span>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <span>羽織りを1着追加する（任意・手動）</span>
                    {selectedOuterwear ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 truncate">
                        選択中: {selectedOuterwear.name}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 font-normal">（未選択）</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate mt-0.5">
                    カーディガン・ジップアップ・パーカー等から1着選べます（全{availableOuterwears.length}着）
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 text-slate-400 pl-2">
                {isOuterwearAccordionOpen ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </div>
            </button>

            {isOuterwearAccordionOpen && (
              <div className="pt-2 border-t border-slate-700/50 space-y-2">
                {selectedOuterwear && (
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[11px] text-amber-300 font-semibold truncate">
                      現在選択中: 🧥 {selectedOuterwear.name}
                    </span>
                    <button
                      type="button"
                      onClick={handleClearOuterwear}
                      className="min-h-[44px] px-3 py-1.5 text-xs text-rose-300 hover:text-white bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 rounded-lg transition-colors flex items-center gap-1 flex-shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>羽織りを解除</span>
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2">
                  {availableOuterwears.map((outer) => {
                    const isSelected = outer.id === selectedOuterwearId;
                    return (
                      <button
                        type="button"
                        key={outer.id}
                        onClick={() => handleToggleOuterwear(outer)}
                        className={`min-h-[44px] flex flex-col text-left p-1.5 rounded-xl border transition-all relative ${
                          isSelected
                            ? 'bg-amber-950/60 border-amber-500 ring-2 ring-amber-500/50 shadow-md'
                            : 'bg-slate-900/80 border-slate-700/60 hover:border-slate-600'
                        }`}
                      >
                        <div className="aspect-square w-full rounded-lg overflow-hidden bg-slate-950">
                          <ItemImage item={outer} className="w-full h-full" imgClassName="object-contain" />
                        </div>
                        <div className="mt-1 px-0.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-amber-400">{outer.id}</span>
                            <span className="text-[9px] text-slate-400 truncate max-w-[50px]">
                              {outer.seasonSleeve.split('・')[0]}
                            </span>
                          </div>
                          <div className="text-[11px] font-semibold text-slate-100 line-clamp-1 leading-tight mt-0.5">
                            {outer.name}
                          </div>
                          {outer.color && (
                            <div className="text-[9px] text-slate-400 mt-0.5 truncate">
                              🎨 {outer.color}
                            </div>
                          )}
                        </div>
                        {isSelected && (
                          <div className="absolute top-1 right-1 bg-amber-500 text-slate-950 p-0.5 rounded-full shadow">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Top Recommendations (1st to 3rd candidates) with ENLARGED photos */}
        {topRecommendations.length === 0 ? (
          <div className="p-6 bg-slate-800/40 border border-dashed border-slate-700 rounded-2xl text-center text-slate-400 text-sm">
            このトップスに合う推奨パンツがありません。
          </div>
        ) : (
          <div className="space-y-3.5">
            {topRecommendations.map((rec) => {
              const p = rec.pants;
              const isTodayChosen =
                todayRecord?.shirtId === selectedShirt.id && todayRecord?.pantsId === p.id;
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
                  <div className="flex gap-3.5 items-stretch">
                    {/* Enlarged Pants Photo Card (Optimized for 1:2 ~ 3:5 portrait aspect ratio) */}
                    <div
                      onClick={() => setZoomItemPair({ shirt: selectedShirt, pants: p })}
                      className="w-36 h-52 sm:w-44 sm:h-60 flex-shrink-0 rounded-2xl overflow-hidden bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 border border-slate-700/80 shadow-inner relative group cursor-pointer"
                      title="タップして上下拡大プレビュー"
                    >
                      <ItemImage
                        item={p}
                        className="w-full h-full p-1"
                        imgClassName="object-contain drop-shadow-md transition-transform group-hover:scale-105"
                      />

                      {/* Mini Shirt Thumbnail overlay in top-right corner */}
                      <div
                        className="absolute top-1.5 right-1.5 w-8 h-10 rounded-lg border border-slate-600/80 overflow-hidden shadow-lg bg-slate-900"
                        title="選択中のトップス"
                      >
                        <ItemImage item={selectedShirt} showBadge={false} className="w-full h-full" />
                      </div>

                      {/* Zoom hint icon */}
                      <div className="absolute bottom-1.5 right-1.5 p-1 rounded-md bg-slate-900/80 text-slate-400 backdrop-blur-sm group-hover:text-white transition-colors">
                        <Maximize2 className="w-3 h-3" />
                      </div>
                    </div>

                    {/* Information & Action Buttons */}
                    <div className="flex-1 flex flex-col justify-between min-w-0">
                      <div>
                        {/* Badges row */}
                        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                              rankColors[rec.rank - 1] || 'bg-slate-700 text-slate-300'
                            }`}
                          >
                            {rankLabels[rec.rank - 1] || `第${rec.rank}候補`}
                          </span>

                          {rec.isYesterdayWorn && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-950/70 text-rose-300 border border-rose-800/70 flex items-center gap-1">
                              ⚠️ 昨日着用（冷却中）
                            </span>
                          )}

                          <span className="px-1.5 py-0.5 rounded text-[9px] text-slate-400 bg-slate-900 border border-slate-700">
                            ドレス度 {p.dressScore}
                          </span>

                          {p.color && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-medium text-slate-300 bg-slate-900 border border-slate-700">
                              🎨 {p.color}
                            </span>
                          )}

                          {formatPantsMeasurements(p.measurements) && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] text-slate-400 bg-slate-900 border border-slate-700">
                              📏 {formatPantsMeasurements(p.measurements)}
                            </span>
                          )}
                        </div>

                        {/* Pants Name */}
                        <h3 className="text-sm sm:text-base font-bold text-white leading-snug line-clamp-2">
                          {p.name}
                        </h3>

                        {/* Affinity Reason */}
                        <p className="text-xs text-slate-300 leading-relaxed mt-1.5 line-clamp-3">
                          {rec.affinityReason}
                        </p>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-700/50">
                        <button
                          onClick={() => handleSelectWear(p)}
                          className={`flex-1 min-h-[44px] py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                            isTodayChosen
                              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                              : 'bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-900/40 active:scale-[0.98]'
                          }`}
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>{isTodayChosen ? '本日着用中' : '✅ 今日これ着る'}</span>
                        </button>

                        <button
                          onClick={() => handleRegisterWifeNg(p)}
                          className="min-h-[44px] min-w-[44px] py-2.5 px-3 rounded-xl text-[11px] font-semibold bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 flex items-center justify-center gap-1 transition-colors active:scale-[0.98]"
                          title="🚨 奥様NGに登録する（候補から除外）"
                        >
                          <span>🚨 奥様NGに登録</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Other Acceptable Pants Toggle (Enlarged cards) */}
        {(remainingRecommendations.length > 0 || otherOk.length > 0) && (
          <div className="pt-1">
            <button
              onClick={() => setShowOtherPants(!showOtherPants)}
              className="w-full min-h-[44px] py-2.5 px-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/70 text-xs font-semibold text-slate-300 flex items-center justify-between"
            >
              <span>その他の着用可能パンツ（{remainingRecommendations.length + otherOk.length}本）</span>
              {showOtherPants ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showOtherPants && (
              <div className="grid grid-cols-2 gap-2.5 mt-2">
                {[...remainingRecommendations, ...otherOk].map((rec) => {
                  const p = rec.pants;
                  return (
                    <div
                      key={p.id}
                      className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60 flex flex-col justify-between"
                    >
                      <div
                        onClick={() => setZoomItemPair({ shirt: selectedShirt, pants: p })}
                        className="aspect-[3/4] w-full rounded-xl overflow-hidden bg-slate-950 mb-2 border border-slate-700/40 cursor-pointer"
                        title="タップして拡大プレビュー"
                      >
                        <ItemImage item={p} className="w-full h-full p-1" />
                      </div>
                      <div className="min-w-0">
                        {rec.isYesterdayWorn && (
                          <span className="text-[9px] text-rose-300 bg-rose-950 px-1 py-0.5 rounded block mb-1 truncate">
                            ⚠️ 昨日着用（冷却中）
                          </span>
                        )}
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <div className="text-xs font-bold text-white truncate">{p.name}</div>
                          {p.color && (
                            <span className="text-[9px] text-slate-300 flex-shrink-0">
                              🎨 {p.color}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">{p.notes}</div>
                      </div>
                      <div className="flex gap-1.5 mt-2.5">
                        <button
                          onClick={() => handleSelectWear(p)}
                          className="flex-1 min-h-[44px] py-2 px-2 bg-slate-700 hover:bg-blue-600 rounded-lg text-xs font-bold text-white transition-colors flex items-center justify-center"
                        >
                          着る
                        </button>
                        <button
                          onClick={() => handleRegisterWifeNg(p)}
                          className="min-h-[44px] min-w-[44px] py-2 px-2.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors"
                          title="🚨 奥様NGに登録する（候補から除外）"
                        >
                          <span>🚨 奥様NGに登録</span>
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
            className="w-full min-h-[44px] py-2.5 px-3 rounded-xl bg-slate-900/80 hover:bg-slate-900 border border-rose-900/40 text-xs font-semibold text-rose-300 flex items-center justify-between transition-colors"
          >
            <div className="flex items-center gap-1.5 flex-wrap">
              <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>🚫 このトップスのNGパンツ（{ngList.length}本）</span>
              {isSelectedPantsInNg && (
                <span className="text-[10px] bg-emerald-950/90 text-emerald-300 border border-emerald-700/60 px-1.5 py-0.5 rounded font-bold">
                  本日着用中あり
                </span>
              )}
            </div>
            {showNgAccordion ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {showNgAccordion && (
            <div className="space-y-2 mt-2">
              {ngList.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400 bg-slate-900/60 rounded-xl">
                  このトップスにはNGパンツはありません。すべてのパンツと合わせられます。
                </div>
              ) : (
                ngList.map(({ pants: p, reason, isWifeNg }) => {
                  const isTodayChosen =
                    todayRecord?.shirtId === selectedShirt.id && todayRecord?.pantsId === p.id;
                  const isYesterdayWorn = yesterdayWornPantsIds.has(p.id);

                  return (
                    <div
                      key={p.id}
                      className={`p-3 rounded-xl border transition-all space-y-2.5 ${
                        isTodayChosen
                          ? 'bg-slate-900/95 border-emerald-500/80 ring-1 ring-emerald-500/30'
                          : 'bg-slate-900/90 border-rose-900/40'
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        {/* Photo thumbnail with pair zoom preview (tap to preview & wear) */}
                        <button
                          type="button"
                          onClick={() => setZoomItemPair({ shirt: selectedShirt, pants: p })}
                          className="w-12 h-16 rounded-lg overflow-hidden bg-slate-950 border border-slate-800 flex-shrink-0 cursor-pointer group relative"
                          title="タップして上下拡大プレビュー・着用"
                        >
                          <ItemImage
                            item={p}
                            showBadge={false}
                            className="w-full h-full"
                            imgClassName="object-contain transition-transform group-hover:scale-105"
                          />
                          <div className="absolute bottom-1 right-1 p-0.5 rounded bg-slate-900/80 text-slate-400">
                            <Maximize2 className="w-2.5 h-2.5" />
                          </div>
                        </button>

                        {/* Info area: ID, name, NG badge, cooling badge, color, today wear badge, reason */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] font-bold text-slate-400">{p.id}</span>
                            <span className="text-xs font-bold text-slate-200 truncate">{p.name}</span>
                            {isWifeNg ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-900/80 text-rose-200 border border-rose-700/60">
                                🚨 奥様NG
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-950/90 text-rose-300 border border-rose-800/60">
                                × 絶対NG
                              </span>
                            )}
                            {isTodayChosen && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-950/90 text-emerald-300 border border-emerald-700/60 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                本日着用中
                              </span>
                            )}
                            {isYesterdayWorn && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-950/70 text-rose-300 border border-rose-800/70">
                                ⚠️ 昨日着用（冷却中）
                              </span>
                            )}
                            {p.color && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium text-slate-300 bg-slate-900 border border-slate-700">
                                🎨 {p.color}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-rose-400/95 leading-snug line-clamp-2 mt-1">
                            理由: {reason}
                          </div>
                        </div>
                      </div>

                      {/* アクションボタン（奥様NG解除ボタン） */}
                      {isWifeNg && (
                        <div className="flex items-center justify-end pt-0.5">
                          <button
                            type="button"
                            onClick={() => handleRemoveWifeNg(p)}
                            className="min-h-[44px] min-w-[44px] px-3 py-2 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 rounded-xl transition-colors flex items-center justify-center gap-1 text-xs font-semibold flex-shrink-0 active:scale-[0.98]"
                            title="🚨 奥様NGを解除する"
                          >
                            <Undo2 className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>🚨 奥様NGを解除する</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </section>
        </div>
      </div>

      {/* Large Zoom Preview Modal (Side-by-side or stacked preview) */}
      {zoomItemPair && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl relative">
            <button
              onClick={() => {
                setZoomItemPair(null);
                setSingleZoomItem(null);
              }}
              className="absolute top-4 right-4 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-white rounded-full bg-slate-800 transition-colors"
              title="閉じる"
              aria-label="閉じる"
            >
              <X className="w-4 h-4" />
            </button>

            <div>
              <h3 className="text-sm font-bold text-white">上下コーディネート詳細</h3>
              <p className="text-[11px] text-slate-400">色の相性とシルエットの確認（写真をタップで全画面拡大）</p>
            </div>

            {/* Side-by-side large photo showcase */}
            <div className="grid grid-cols-2 gap-3 items-stretch">
              <div className="p-3 bg-slate-800/80 rounded-2xl border border-slate-700 flex flex-col items-center">
                <div className="text-[10px] font-bold text-blue-400 mb-1">{zoomItemPair.shirt.id} (トップス)</div>
                <button
                  type="button"
                  onClick={() => setSingleZoomItem(zoomItemPair.shirt)}
                  className="w-full h-44 rounded-xl overflow-hidden bg-slate-950 mb-2 relative group cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 text-left"
                  title={`${zoomItemPair.shirt.id} ${zoomItemPair.shirt.name} を全画面で拡大`}
                  aria-label={`${zoomItemPair.shirt.id} ${zoomItemPair.shirt.name} を全画面で拡大`}
                >
                  <ItemImage
                    item={zoomItemPair.shirt}
                    className="w-full h-full"
                    imgClassName="object-contain transition-transform group-hover:scale-105"
                  />
                  <div className="absolute bottom-1.5 right-1.5 p-1 rounded-md bg-slate-900/80 text-slate-300 backdrop-blur-sm group-hover:text-white transition-colors">
                    <Maximize2 className="w-3.5 h-3.5" />
                  </div>
                </button>
                <div className="text-xs font-bold text-white text-center line-clamp-1">
                  {zoomItemPair.shirt.name}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1 mt-1.5">
                  {zoomItemPair.shirt.color && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-medium text-slate-300 bg-slate-900 border border-slate-700">
                      🎨 {zoomItemPair.shirt.color}
                    </span>
                  )}
                  {formatShirtMeasurements(zoomItemPair.shirt.measurements) && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] text-slate-400 bg-slate-900 border border-slate-700">
                      📏 {formatShirtMeasurements(zoomItemPair.shirt.measurements)}
                    </span>
                  )}
                </div>
              </div>

              <div className="p-3 bg-slate-800/80 rounded-2xl border border-slate-700 flex flex-col items-center">
                <div className="text-[10px] font-bold text-emerald-400 mb-1">{zoomItemPair.pants.id} (パンツ)</div>
                <button
                  type="button"
                  onClick={() => setSingleZoomItem(zoomItemPair.pants)}
                  className="w-full h-44 rounded-xl overflow-hidden bg-slate-950 mb-2 relative group cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500 text-left"
                  title={`${zoomItemPair.pants.id} ${zoomItemPair.pants.name} を全画面で拡大`}
                  aria-label={`${zoomItemPair.pants.id} ${zoomItemPair.pants.name} を全画面で拡大`}
                >
                  <ItemImage
                    item={zoomItemPair.pants}
                    className="w-full h-full"
                    imgClassName="object-contain transition-transform group-hover:scale-105"
                  />
                  <div className="absolute bottom-1.5 right-1.5 p-1 rounded-md bg-slate-900/80 text-slate-300 backdrop-blur-sm group-hover:text-white transition-colors">
                    <Maximize2 className="w-3.5 h-3.5" />
                  </div>
                </button>
                <div className="text-xs font-bold text-white text-center line-clamp-1">
                  {zoomItemPair.pants.name}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1 mt-1.5">
                  {zoomItemPair.pants.color && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-medium text-slate-300 bg-slate-900 border border-slate-700">
                      🎨 {zoomItemPair.pants.color}
                    </span>
                  )}
                  {formatPantsMeasurements(zoomItemPair.pants.measurements) && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] text-slate-400 bg-slate-900 border border-slate-700">
                      📏 {formatPantsMeasurements(zoomItemPair.pants.measurements)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Action button inside modal */}
            <button
              onClick={() => {
                handleSelectWear(zoomItemPair.pants);
                setZoomItemPair(null);
                setSingleZoomItem(null);
              }}
              className="w-full min-h-[44px] py-2.5 px-4 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/40 flex items-center justify-center gap-1.5 transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>この組み合わせを着る</span>
            </button>
          </div>
        </div>
      )}

      {/* Single Item Fullscreen Zoom Overlay (Above Pair Modal) */}
      {singleZoomItem && zoomItemPair && (
        <FullscreenPhotoViewer
          items={[zoomItemPair.shirt, zoomItemPair.pants]}
          currentItemId={singleZoomItem.id}
          onSelectItem={(id) => {
            setSingleZoomItem(id === zoomItemPair.shirt.id ? zoomItemPair.shirt : zoomItemPair.pants);
          }}
          onClose={() => setSingleZoomItem(null)}
          showDetailsFooter={false}
        />
      )}
    </div>
  );
};
