import React, { useState, useMemo } from 'react';
import {
  Grid,
  AlertTriangle,
  Lightbulb,
  X,
  TrendingUp,
  ShoppingBag,
  Filter,
  ChevronDown,
  ChevronUp,
  Focus,
  Building2,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { ClosetItem } from '../types/closet';
import { useClosetStore } from '../hooks/useClosetStore';
import { ItemImage } from './ItemImage';
import { analyzeWardrobeStats, getNextSequentialId } from '../utils/closetDomain';

type MatrixFilter = 'all' | 'warning' | 'office' | 'long' | 'short';

const FILTER_OPTIONS: { id: MatrixFilter; label: string }[] = [
  { id: 'all', label: 'すべて' },
  { id: 'warning', label: '⚠️ 要注意アイテムのみ' },
  { id: 'office', label: '🏢 出社対応のみ' },
  { id: 'long', label: '🧥 長袖のみ' },
  { id: 'short', label: '☀️ 七分袖・半袖のみ' },
];

export const MatrixView: React.FC = () => {
  const {
    mergedClosetData,
    wifeNgPairs,
    shirts,
    pants,
    itemMap,
    isNgPair,
    registerWifeNg,
    removeWifeNg,
  } = useClosetStore();

  const [activeFilter, setActiveFilter] = useState<MatrixFilter>('all');
  const [selectedFocusItem, setSelectedFocusItem] = useState<ClosetItem | null>(null);
  const [isTableExpanded, setIsTableExpanded] = useState(false);
  const [selectedPair, setSelectedPair] = useState<{
    shirt: ClosetItem;
    pants: ClosetItem;
  } | null>(null);

  // ワードローブの健全性・偏り・穴の動的解析
  const stats = useMemo(
    () => analyzeWardrobeStats(shirts, pants, itemMap, wifeNgPairs),
    [shirts, pants, itemMap, wifeNgPairs]
  );

  const totalCombinations = shirts.length * pants.length;
  const officeAcePants = stats.officeAcePants;
  const nextPantsId = getNextSequentialId(mergedClosetData.items, 'pants');

  const totalOfficePairs = useMemo(
    () => stats.shirtStats.reduce((acc, s) => acc + s.officeRecommendIds.length, 0),
    [stats]
  );
  const totalNgPairs = useMemo(
    () => stats.shirtStats.reduce((acc, s) => acc + s.ngIds.length, 0),
    [stats]
  );

  // 要注意アイテムの抽出
  const lowOfficeShirts = useMemo(
    () => stats.shirtStats.filter((s) => s.officeRecommendIds.length <= 1),
    [stats]
  );
  const lowOfficePants = useMemo(
    () => stats.pantsStats.filter((p) => p.item.dressScore >= 3.0 && p.officeRecommendIds.length <= 1),
    [stats]
  );
  const highNgItems = useMemo(() => {
    return [
      ...stats.shirtStats.filter((s) => s.ngIds.length >= Math.ceil(pants.length * 0.4)),
      ...stats.pantsStats.filter((p) => p.ngIds.length >= Math.ceil(shirts.length * 0.4)),
    ];
  }, [stats, shirts.length, pants.length]);

  const getCellStatus = (shirt: ClosetItem, p: ClosetItem) => {
    const ngInfo = isNgPair(shirt.id, p.id);
    if (ngInfo.isWifeNg) {
      return { symbol: '🚨', label: '奥様NG', bg: 'bg-rose-950/80 text-rose-300 border-rose-700/60' };
    }
    if (ngInfo.isNg) {
      return { symbol: '×', label: '絶対NG', bg: 'bg-slate-900/90 text-slate-600 border-slate-800' };
    }

    const isOffice = shirt.officeRecommendIds.includes(p.id) || p.officeRecommendIds.includes(shirt.id);
    const isRemote = shirt.remoteRecommendIds.includes(p.id) || p.remoteRecommendIds.includes(shirt.id);

    if (isOffice) {
      return { symbol: '◎', label: '出社推奨', bg: 'bg-blue-900/60 text-blue-300 border-blue-700/60' };
    }
    if (isRemote) {
      return { symbol: '○', label: 'リモート推奨', bg: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/60' };
    }
    return { symbol: '△', label: '着用可', bg: 'bg-slate-800/40 text-slate-400 border-slate-700/40' };
  };

  // 統一フィルター適用後のシャツ・パンツリスト
  const filteredShirts = useMemo(() => {
    switch (activeFilter) {
      case 'warning':
        return shirts.filter((s) => {
          const isLowOffice = lowOfficeShirts.some((item) => item.item.id === s.id);
          const isHighNg = highNgItems.some((item) => item.item.id === s.id);
          const isBottleneck = stats.bottleneckShirts.some((item) => item.item.id === s.id);
          return isLowOffice || isHighNg || isBottleneck;
        });
      case 'office':
        return shirts.filter((s) => {
          return pants.some((p) => {
            const status = getCellStatus(s, p);
            return status.symbol === '◎';
          });
        });
      case 'long':
        return shirts.filter((s) => s.seasonSleeve?.includes('長袖') ?? true);
      case 'short':
        return shirts.filter((s) => (s.seasonSleeve?.includes('半袖') || s.seasonSleeve?.includes('七分袖')) ?? false);
      case 'all':
      default:
        return shirts;
    }
  }, [shirts, pants, activeFilter, lowOfficeShirts, highNgItems, stats]);

  const filteredPants = useMemo(() => {
    switch (activeFilter) {
      case 'warning':
        return pants.filter((p) => {
          const isLowOffice = lowOfficePants.some((item) => item.item.id === p.id);
          const isHighNg = highNgItems.some((item) => item.item.id === p.id);
          const isBottleneck = stats.bottleneckPants.some((item) => item.item.id === p.id);
          return isLowOffice || isHighNg || isBottleneck;
        });
      case 'office':
        return pants.filter((p) => {
          if (p.dressScore < 3.0) return false;
          return shirts.some((s) => {
            const status = getCellStatus(s, p);
            return status.symbol === '◎';
          });
        });
      case 'long':
        return pants;
      case 'short':
        return pants;
      case 'all':
      default:
        return pants;
    }
  }, [pants, shirts, activeFilter, lowOfficePants, highNgItems, stats]);

  // フォーカスアイテムが選択された場合の一覧
  const focusPartners = useMemo(() => {
    if (!selectedFocusItem) return [];
    if (selectedFocusItem.category === 'shirt') {
      return pants.map((p) => ({
        partner: p,
        status: getCellStatus(selectedFocusItem, p),
        ngInfo: isNgPair(selectedFocusItem.id, p.id),
      })).sort((a, b) => {
        const order: Record<string, number> = { '◎': 1, '○': 2, '△': 3, '🚨': 4, '×': 5 };
        return (order[a.status.symbol] || 99) - (order[b.status.symbol] || 99);
      });
    } else {
      return shirts.map((s) => ({
        partner: s,
        status: getCellStatus(s, selectedFocusItem),
        ngInfo: isNgPair(s.id, selectedFocusItem.id),
      })).sort((a, b) => {
        const order: Record<string, number> = { '◎': 1, '○': 2, '△': 3, '🚨': 4, '×': 5 };
        return (order[a.status.symbol] || 99) - (order[b.status.symbol] || 99);
      });
    }
  }, [selectedFocusItem, shirts, pants]);

  return (
    <div className="space-y-6 pb-20">
      {/* 動的ヘッダー */}
      <div className="p-4 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-slate-700/80 rounded-2xl shadow-xl">
        <div className="flex items-center gap-2 text-blue-400 font-bold text-sm mb-1">
          <Grid className="w-4 h-4 text-blue-400" />
          <span>全マトリクス一覧 (Matrix & Insights)</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          全{shirts.length}シャツ × {pants.length}パンツ（計{totalCombinations}通りの組み合わせ）の相性を網羅。
          ワードローブの死角・穴を発見し、1着ごとの詳細や奥様NGの切り替えが可能です。
        </p>
      </div>

      {/* 第1層：インサイト＆穴の発見ダッシュボード */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>ワードローブ健全性＆穴の発見</span>
          </h3>
          <span className="text-[10px] text-slate-400 font-mono">
            健全率 {(100 - (totalNgPairs / (totalCombinations || 1)) * 100).toFixed(0)}%
          </span>
        </div>

        {/* 健全性サマリーカウンター */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-xl">
            <div className="text-[10px] text-slate-400 font-semibold mb-0.5">総組合せ数</div>
            <div className="text-sm font-bold text-slate-200">{totalCombinations}通り</div>
          </div>
          <div className="p-3 bg-blue-950/40 border border-blue-900/50 rounded-xl">
            <div className="text-[10px] text-blue-300 font-semibold mb-0.5">出社◎相性</div>
            <div className="text-sm font-bold text-blue-400">{totalOfficePairs}組</div>
          </div>
          <div className="p-3 bg-rose-950/40 border border-rose-900/50 rounded-xl">
            <div className="text-[10px] text-rose-300 font-semibold mb-0.5">NG組合せ</div>
            <div className="text-sm font-bold text-rose-400">{totalNgPairs}組</div>
          </div>
        </div>

        {/* ボトルネック＆要注意アイテムカード */}
        {(lowOfficeShirts.length > 0 ||
          lowOfficePants.length > 0 ||
          highNgItems.length > 0) && (
          <div className="space-y-2">
            {lowOfficeShirts.length > 0 && (
              <div className="p-3.5 bg-amber-950/40 border border-amber-800/60 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-300 flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>出社◎が少ないシャツ（1着以下）</span>
                  </span>
                  <span className="text-[10px] bg-amber-900/60 text-amber-200 px-2 py-0.5 rounded-full font-bold">
                    {lowOfficeShirts.length}着
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  出社可能なパンツが限られており、平日のローテーションで詰まりやすい服です（タップして相性を確認）。
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {lowOfficeShirts.map(({ item, officeRecommendIds }) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedFocusItem(item)}
                      className={`min-h-[44px] px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                        selectedFocusItem?.id === item.id
                          ? 'bg-amber-500 text-slate-950 shadow-md ring-2 ring-amber-300'
                          : 'bg-slate-800/90 text-amber-200 border border-amber-700/60 hover:bg-slate-700'
                      }`}
                    >
                      <span>{item.id}</span>
                      <span className="text-[10px] font-normal opacity-80 truncate max-w-[80px]">
                        {item.name}
                      </span>
                      <span className="text-[10px] bg-amber-950/80 text-amber-300 px-1.5 py-0.5 rounded font-mono">
                        ◎{officeRecommendIds.length}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {lowOfficePants.length > 0 && (
              <div className="p-3.5 bg-amber-950/40 border border-amber-800/60 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-300 flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>出社◎が少ないスラックス（1着以下）</span>
                  </span>
                  <span className="text-[10px] bg-amber-900/60 text-amber-200 px-2 py-0.5 rounded-full font-bold">
                    {lowOfficePants.length}着
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  ドレス度3.0以上ですが合わせられるシャツが少なく、出社時に選ばれにくいスラックスです。
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {lowOfficePants.map(({ item, officeRecommendIds }) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedFocusItem(item)}
                      className={`min-h-[44px] px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                        selectedFocusItem?.id === item.id
                          ? 'bg-amber-500 text-slate-950 shadow-md ring-2 ring-amber-300'
                          : 'bg-slate-800/90 text-amber-200 border border-amber-700/60 hover:bg-slate-700'
                      }`}
                    >
                      <span>{item.id}</span>
                      <span className="text-[10px] font-normal opacity-80 truncate max-w-[80px]">
                        {item.name}
                      </span>
                      <span className="text-[10px] bg-amber-950/80 text-amber-300 px-1.5 py-0.5 rounded font-mono">
                        ◎{officeRecommendIds.length}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {highNgItems.length > 0 && (
              <div className="p-3.5 bg-rose-950/40 border border-rose-800/60 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-rose-300 flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                    <span>NG集中アイテム（NG率40%以上）</span>
                  </span>
                  <span className="text-[10px] bg-rose-900/60 text-rose-200 px-2 py-0.5 rounded-full font-bold">
                    {highNgItems.length}着
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {highNgItems.map(({ item, ngIds }) => {
                    const totalOpposite = item.category === 'shirt' ? pants.length : shirts.length;
                    const ngRatio = (ngIds.length / (totalOpposite || 1)) * 100;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setSelectedFocusItem(item)}
                        className={`min-h-[44px] px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                          selectedFocusItem?.id === item.id
                            ? 'bg-rose-500 text-white shadow-md ring-2 ring-rose-300'
                            : 'bg-slate-800/90 text-rose-200 border border-rose-700/60 hover:bg-slate-700'
                        }`}
                      >
                        <span>{item.id}</span>
                        <span className="text-[10px] font-normal opacity-80 truncate max-w-[80px]">
                          {item.name}
                        </span>
                        <span className="text-[10px] bg-rose-950/80 text-rose-300 px-1.5 py-0.5 rounded font-mono">
                          NG{ngIds.length} ({ngRatio.toFixed(0)}%)
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 第2層：アイテム別ドリルダウン表示（1着フォーカスビュー） */}
      {selectedFocusItem && (
        <section className="p-4 bg-slate-900/95 border-2 border-blue-500/80 rounded-2xl shadow-2xl space-y-3 animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Focus className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-bold text-white">
                アイテム個別ドリルダウン: <span className="text-blue-400 font-mono">{selectedFocusItem.id}</span>
              </h3>
            </div>
            <button
              onClick={() => setSelectedFocusItem(null)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-white rounded-lg bg-slate-800/60 hover:bg-slate-700 transition-colors"
              title="フォーカス解除"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-3 p-2.5 bg-slate-800/80 rounded-xl border border-slate-700/70">
            <div className="w-12 h-14 rounded-lg overflow-hidden bg-slate-950 flex-shrink-0">
              <ItemImage item={selectedFocusItem} showBadge={false} className="w-full h-full" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-white truncate">{selectedFocusItem.name}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {selectedFocusItem.category === 'shirt' ? 'シャツ' : 'パンツ'} • {selectedFocusItem.seasonSleeve || '通年'} • ドレス度 {selectedFocusItem.dressScore.toFixed(1)}
              </div>
              <div className="text-[10px] text-blue-300 mt-0.5 truncate">
                {selectedFocusItem.notes || 'メモなし'}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] font-bold text-slate-300 flex items-center justify-between">
              <span>{selectedFocusItem.category === 'shirt' ? '合わせられるパンツ一覧' : '合わせられるシャツ一覧'}</span>
              <span className="text-[10px] text-slate-400">タップで詳細・奥様NG切替</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {focusPartners.map(({ partner, status }) => {
                const shirtObj = selectedFocusItem.category === 'shirt' ? selectedFocusItem : partner;
                const pantsObj = selectedFocusItem.category === 'shirt' ? partner : selectedFocusItem;

                return (
                  <button
                    key={partner.id}
                    onClick={() => setSelectedPair({ shirt: shirtObj, pants: pantsObj })}
                    className={`min-h-[44px] p-2 rounded-xl border text-left flex items-center gap-2 transition-transform active:scale-95 ${status.bg}`}
                  >
                    <div className="w-8 h-8 rounded bg-slate-950 flex-shrink-0 overflow-hidden">
                      <ItemImage item={partner} showBadge={false} className="w-full h-full" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold font-mono">{partner.id}</span>
                        <span className="text-xs font-bold">{status.symbol}</span>
                      </div>
                      <div className="text-[9px] truncate opacity-90">{partner.name}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* 統一フィルターバー */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 px-1">
          <Filter className="w-3.5 h-3.5 text-blue-400" />
          <span>表示フィルター</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setActiveFilter(opt.id)}
              className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                activeFilter === opt.id
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40 ring-1 ring-blue-400'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-750 hover:text-white border border-slate-700/60'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* 記号の見方（凡例） */}
      <div className="flex items-center gap-2 flex-wrap text-xs bg-slate-800/70 p-3 rounded-xl border border-slate-700/60">
        <span className="flex items-center gap-1 text-blue-300 font-semibold">
          <span className="w-5 h-5 rounded bg-blue-900/80 flex items-center justify-center font-bold">◎</span>
          出社推奨
        </span>
        <span className="flex items-center gap-1 text-emerald-300 font-semibold">
          <span className="w-5 h-5 rounded bg-emerald-900/80 flex items-center justify-center font-bold">○</span>
          リモート推奨
        </span>
        <span className="flex items-center gap-1 text-slate-400">
          <span className="w-5 h-5 rounded bg-slate-800 flex items-center justify-center">△</span>
          着用可
        </span>
        <span className="flex items-center gap-1 text-rose-300 font-semibold">
          <span className="w-5 h-5 rounded bg-rose-950 flex items-center justify-center font-bold">🚨</span>
          奥様NG
        </span>
        <span className="flex items-center gap-1 text-slate-500">
          <span className="w-5 h-5 rounded bg-slate-900 flex items-center justify-center">×</span>
          絶対NG
        </span>
      </div>

      {/* 第3層：全体マトリックス表（高密度表＋モバイル折りたたみアコーディオン） */}
      <section className="bg-slate-850 border border-slate-700/80 rounded-2xl shadow-xl overflow-hidden">
        {/* モバイル向け折りたたみトグルボタン */}
        <button
          onClick={() => setIsTableExpanded(!isTableExpanded)}
          className="w-full min-h-[44px] p-3.5 bg-slate-800 hover:bg-slate-750 flex items-center justify-between text-left transition-colors border-b border-slate-700/60"
        >
          <div className="flex items-center gap-2">
            <Grid className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-bold text-white">
              全マトリックス表 ({filteredShirts.length}シャツ × {filteredPants.length}パンツ)
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {filteredShirts.length * filteredPants.length}セル
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs text-blue-400 font-semibold">
            <span>{isTableExpanded ? '表を閉じる' : '表を展開する'}</span>
            {isTableExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {isTableExpanded && (
          <div className="p-2.5 overflow-hidden animate-fade-in">
            {filteredShirts.length === 0 || filteredPants.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                該当するアイテムがありません。フィルター条件を変更してください。
              </div>
            ) : (
              <div className="overflow-x-auto no-scrollbar">
                <table className="w-full text-center border-collapse">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-20 bg-slate-900 p-2 text-[10px] text-slate-400 border border-slate-700/60 min-w-[70px]">
                        シャツ＼パンツ
                      </th>
                      {filteredPants.map((p) => (
                        <th
                          key={p.id}
                          className="p-1.5 min-w-[52px] bg-slate-900/90 border border-slate-700/60 text-[10px] text-slate-300"
                        >
                          <div className="w-10 h-10 mx-auto rounded overflow-hidden bg-slate-950 mb-1">
                            <ItemImage item={p} showBadge={false} className="w-full h-full" />
                          </div>
                          <button
                            onClick={() => setSelectedFocusItem(p)}
                            className="font-bold text-slate-200 hover:text-blue-400 block mx-auto underline-offset-2 hover:underline"
                            title={`${p.name} にフォーカス`}
                          >
                            {p.id}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredShirts.map((shirt) => (
                      <tr key={shirt.id}>
                        {/* Sticky Shirt header column */}
                        <th className="sticky left-0 z-10 bg-slate-900/95 p-1.5 text-left border border-slate-700/60 shadow-md">
                          <button
                            onClick={() => setSelectedFocusItem(shirt)}
                            className="flex items-center gap-1.5 text-left w-full hover:opacity-80 transition-opacity"
                            title={`${shirt.name} にフォーカス`}
                          >
                            <div className="w-8 h-8 rounded overflow-hidden bg-slate-950 flex-shrink-0">
                              <ItemImage item={shirt} showBadge={false} className="w-full h-full" />
                            </div>
                            <div className="min-w-0">
                              <span className="text-[10px] font-bold text-blue-400 block">{shirt.id}</span>
                              <span className="text-[9px] text-slate-300 truncate block max-w-[60px]">
                                {shirt.name.slice(0, 5)}
                              </span>
                            </div>
                          </button>
                        </th>

                        {/* Matrix Cells */}
                        {filteredPants.map((p) => {
                          const status = getCellStatus(shirt, p);
                          return (
                            <td
                              key={p.id}
                              onClick={() => setSelectedPair({ shirt, pants: p })}
                              className={`p-2 min-w-[44px] min-h-[44px] border border-slate-700/40 cursor-pointer transition-transform hover:scale-110 active:scale-95 ${status.bg}`}
                              title={`${shirt.name} × ${p.name}: ${status.label}`}
                            >
                              <span className="text-xs font-bold leading-none">{status.symbol}</span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ワードローブ偏り分析＆買い足しレコメンド */}
      <section className="space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5 px-1">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <span>ワードローブ偏り分析＆買い足しレコメンド</span>
        </h3>

        {/* Bias Insights Cards */}
        {(() => {
          const s1Item = shirts.find((s) => s.id === 'S1');
          const isOfficePair = (shirt: ClosetItem, p: ClosetItem) => {
            if (isNgPair(shirt.id, p.id).isNg) return false;
            return (
              shirt.officeRecommendIds.includes(p.id) ||
              p.officeRecommendIds.includes(shirt.id)
            );
          };

          const s1CompatibleOfficePants = s1Item
            ? officeAcePants.filter((p) => isOfficePair(s1Item, p))
            : [];
          const blackOfficeSlacks = pants.find((p) => p.name.includes('黒') && p.dressScore >= 3.5);
          const blackSlacksCompatibleShirts = blackOfficeSlacks
            ? shirts.filter((s) => isOfficePair(s, blackOfficeSlacks))
            : [];
          const isUniversalHub =
            Boolean(blackOfficeSlacks && blackSlacksCompatibleShirts.length === shirts.length);

          return (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-4 bg-slate-800/80 border border-slate-700/70 rounded-2xl space-y-2">
                  <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <Lightbulb className="w-4 h-4 text-amber-400" />
                    <span>出社エース（ドレス度3.5以上）: 現在 {officeAcePants.length} 本</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    パンツ全{pants.length}本中、安心感のある出社スラックスは{' '}
                    <strong>{officeAcePants.map((p) => `${p.id}（${p.name.slice(0, 7)}）`).join('、')}</strong> の計{officeAcePants.length}本です。
                    {officeAcePants.length <= 4
                      ? ' 週3回以上の出社が続くと冷却期間（連続着用回避）がタイトになりやすいため、着回しハブの強化が推奨されます。'
                      : ' 出社スラックス層がバランスよく揃っており、冷却期間を保ちながらローテーション可能です。'}
                  </p>
                </div>

                <div className="p-4 bg-slate-800/80 border border-slate-700/70 rounded-2xl space-y-2">
                  <div className="text-xs font-bold text-sky-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-sky-400" />
                    <span>S1（濃インディゴ）の出社パートナー: {s1CompatibleOfficePants.length} 本</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    S1は濃いネイビーのため、ネイビー系パンツと合わせると「作業着見え」で奥様NGになります。
                    現在出社で合わせられるパンツは{' '}
                    <strong>
                      {s1CompatibleOfficePants.length > 0
                        ? s1CompatibleOfficePants.map((p) => p.id).join('、')
                        : 'なし'}
                    </strong>{' '}
                    （計{s1CompatibleOfficePants.length}本）です。黒スラックスなどの導入でさらに着回しが広がります。
                  </p>
                </div>
              </div>

              {/* Recommended Buy Items or Congratulatory Card */}
              {blackOfficeSlacks ? (
                <div className="p-4 bg-gradient-to-r from-emerald-950/70 via-slate-900 to-teal-950/70 border border-emerald-600/50 rounded-2xl shadow-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                      <ShoppingBag className="w-4 h-4 text-emerald-400" />
                      <span>
                        {isUniversalHub
                          ? '【導入完了】万能出社ハブ（黒スラックス）稼働中'
                          : '【導入済み】出社対応黒スラックス登録済み'}
                      </span>
                    </span>
                    <span className="text-[10px] bg-emerald-600 text-white font-bold px-2 py-0.5 rounded-full">
                      {isUniversalHub
                        ? '全シャツ出社対応 ★★★★★'
                        : `出社対応: ${blackSlacksCompatibleShirts.length}/${shirts.length}`}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-700/60 space-y-1.5">
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>{blackOfficeSlacks.name}</span>
                      <span className="text-xs text-emerald-400 font-mono">({blackOfficeSlacks.id})</span>
                    </h4>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {isUniversalHub
                        ? `手持ちに黒スラックスが登録されており、S1（濃インディゴ）をはじめ全${shirts.length}着のシャツと出社コーデが可能な万能ハブとして稼働しています。`
                        : `手持ちに黒スラックスが登録されており、現在全${shirts.length}着中 ${blackSlacksCompatibleShirts.length}着（${blackSlacksCompatibleShirts.map((s) => s.id).join('、')}）と出社コーデが可能です。`}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-gradient-to-r from-slate-900 to-blue-950/80 border border-blue-600/50 rounded-2xl shadow-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-300 uppercase tracking-wider flex items-center gap-1.5">
                      <ShoppingBag className="w-4 h-4 text-blue-400" />
                      <span>【最優先】買い足すべき救世主アイテム</span>
                    </span>
                    <span className="text-[10px] bg-blue-600 text-white font-bold px-2 py-0.5 rounded-full">
                      投資対効果 ★★★★★
                    </span>
                  </div>

                  <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-700/60 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-white">
                        黒テーパードスラックス（通年・ドレス度4.5）
                      </h4>
                      <span className="text-xs text-slate-400 font-mono">{nextPantsId}候補</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      現在出社できる黒スラックスが未導入です。「出社できる黒スラックス」を1本導入するだけで、S1（濃インディゴ）をはじめ、白シャツ全種、サックス、生成りまで <strong>全シャツの出社コーデが即座に解禁</strong> されます。
                    </p>
                    <div className="text-[11px] text-blue-400 font-medium pt-1">
                      おすすめ仕様: ノータック〜ワンタック、ポリエステル混紡でシワになりにくく自宅洗濯可能なもの。
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </section>

      {/* Selected Pair Preview Modal */}
      {selectedPair && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl relative">
            <button
              onClick={() => setSelectedPair(null)}
              className="absolute top-4 right-4 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-white rounded-full bg-slate-800"
              title="閉じる"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-sm font-bold text-white pr-8">
              コーディネート相性詳細
            </h3>

            {/* Pair Photos */}
            <div className="grid grid-cols-2 gap-3 items-center">
              <div className="p-2.5 bg-slate-800/80 rounded-2xl border border-slate-700 text-center">
                <div className="w-20 h-24 mx-auto rounded-xl overflow-hidden bg-slate-950 mb-1.5">
                  <ItemImage item={selectedPair.shirt} className="w-full h-full" />
                </div>
                <div className="text-xs font-bold text-white truncate">{selectedPair.shirt.name}</div>
                <div className="text-[10px] text-blue-400 font-mono">{selectedPair.shirt.id}</div>
              </div>

              <div className="p-2.5 bg-slate-800/80 rounded-2xl border border-slate-700 text-center">
                <div className="w-20 h-24 mx-auto rounded-xl overflow-hidden bg-slate-950 mb-1.5">
                  <ItemImage item={selectedPair.pants} className="w-full h-full" />
                </div>
                <div className="text-xs font-bold text-white truncate">{selectedPair.pants.name}</div>
                <div className="text-[10px] text-emerald-400 font-mono">{selectedPair.pants.id}</div>
              </div>
            </div>

            {/* Status & Reason */}
            {(() => {
              const status = getCellStatus(selectedPair.shirt, selectedPair.pants);
              const ngCheck = isNgPair(selectedPair.shirt.id, selectedPair.pants.id);

              return (
                <div className="space-y-3">
                  <div className={`p-3 rounded-xl border text-xs font-bold ${status.bg} flex items-center justify-between`}>
                    <span>相性ステータス: {status.label}</span>
                    <span className="text-base">{status.symbol}</span>
                  </div>

                  {ngCheck.isNg && (
                    <div className="text-xs text-rose-300 bg-rose-950/60 p-3 rounded-xl border border-rose-900/50 leading-relaxed">
                      <strong>ダメ出し回避理由:</strong> {ngCheck.reason}
                    </div>
                  )}

                  {/* Toggle Wife NG button */}
                  <div className="pt-2">
                    {ngCheck.isWifeNg ? (
                      <button
                        onClick={() => {
                          removeWifeNg(selectedPair.shirt.id, selectedPair.pants.id);
                          setSelectedPair(null);
                        }}
                        className="w-full min-h-[44px] py-2.5 px-4 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 transition-colors"
                      >
                        🚨 奥様NGを解除する
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          registerWifeNg(selectedPair.shirt.id, selectedPair.pants.id);
                          setSelectedPair(null);
                        }}
                        className="w-full min-h-[44px] py-2.5 px-4 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/40 transition-colors"
                      >
                        🚨 奥様NGに登録する（候補から除外）
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};
