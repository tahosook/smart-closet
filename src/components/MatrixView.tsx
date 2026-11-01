import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Grid,
  X,
  ShoppingBag,
  Filter,
  ChevronDown,
  ChevronUp,
  Focus,
  Building2,
  ShieldAlert,
  Sparkles,
  Copy,
  Check,
  AlertCircle,
  FileText,
  ShieldCheck,
} from 'lucide-react';
import { ClosetItem } from '../types/closet';
import { useClosetStore } from '../hooks/useClosetStore';
import { ItemImage } from './ItemImage';
import {
  analyzeWardrobeStats,
  buildShoppingConsultationPrompt,
  copyTextToClipboard,
  CopyFeedbackStatus,
} from '../utils/closetDomain';

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
    archivedItems,
    itemMap,
    wearHistory,
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

  // 買い足し相談用の任意メモとコピー状態
  const [consultationMemo, setConsultationMemo] = useState('');
  const [copiedConsultPromptStatus, setCopiedConsultPromptStatus] = useState<CopyFeedbackStatus>('idle');
  const consultPromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (consultPromptTimerRef.current) {
        clearTimeout(consultPromptTimerRef.current);
      }
    };
  }, []);

  // ワードローブの健全性・偏り・穴の動的解析
  const stats = useMemo(
    () => analyzeWardrobeStats(shirts, pants, itemMap, wifeNgPairs),
    [shirts, pants, itemMap, wifeNgPairs]
  );

  const totalCombinations = shirts.length * pants.length;

  const totalOfficePairs = useMemo(
    () => stats.shirtStats.reduce((acc, s) => acc + s.officeRecommendIds.length, 0),
    [stats]
  );
  const totalNgPairs = useMemo(
    () => stats.shirtStats.reduce((acc, s) => acc + s.ngIds.length, 0),
    [stats]
  );

  const handleCopyConsultationPrompt = useCallback(async () => {
    const promptText = buildShoppingConsultationPrompt({
      items: mergedClosetData.items,
      wifeNgPairs,
      wearHistory,
      userMemo: consultationMemo,
    });
    const ok = await copyTextToClipboard(promptText);
    if (consultPromptTimerRef.current) {
      clearTimeout(consultPromptTimerRef.current);
    }
    setCopiedConsultPromptStatus(ok ? 'success' : 'error');
    consultPromptTimerRef.current = setTimeout(() => {
      setCopiedConsultPromptStatus('idle');
      consultPromptTimerRef.current = null;
    }, 3000);
  }, [mergedClosetData.items, wifeNgPairs, wearHistory, consultationMemo]);

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

  const getCellStatus = useCallback((shirt: ClosetItem, p: ClosetItem) => {
    const ngInfo = isNgPair(shirt.id, p.id);
    if (ngInfo.isWifeNg) {
      return { symbol: '🚨', label: '奥様NG', bg: 'bg-rose-950/80 text-rose-300 border-rose-700/60' };
    }
    if (ngInfo.isNg) {
      return { symbol: '×', label: '絶対NG', bg: 'bg-slate-900/90 text-slate-600 border-slate-800' };
    }

    // 出社推奨: 双方向推薦かつスラックスのドレス度が3.0以上（analyzeWardrobeStatsと完全一致）
    const isOffice =
      (shirt.officeRecommendIds.includes(p.id) || p.officeRecommendIds.includes(shirt.id)) &&
      p.dressScore >= 3.0;
    const isRemote = shirt.remoteRecommendIds.includes(p.id) || p.remoteRecommendIds.includes(shirt.id);

    if (isOffice) {
      return { symbol: '◎', label: '出社推奨', bg: 'bg-blue-900/60 text-blue-300 border-blue-700/60' };
    }
    if (isRemote) {
      return { symbol: '○', label: 'リモート推奨', bg: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/60' };
    }
    return { symbol: '△', label: '着用可', bg: 'bg-slate-800/40 text-slate-400 border-slate-700/40' };
  }, [isNgPair]);

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
  }, [shirts, pants, activeFilter, lowOfficeShirts, highNgItems, stats, getCellStatus]);

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
  }, [pants, shirts, activeFilter, lowOfficePants, highNgItems, stats, getCellStatus]);

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
  }, [selectedFocusItem, shirts, pants, wifeNgPairs, isNgPair, getCellStatus]);

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

      {/* ワードローブ買い足し相談（Gemini スタイリスト対話） */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <ShoppingBag className="w-4 h-4 text-emerald-400" />
            <span>ワードローブ買い足し相談 (Gemini スタイリスト対話)</span>
          </h3>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] bg-slate-800 text-slate-300 border border-slate-700 px-2 py-0.5 rounded-full font-mono">
              現役 {shirts.length + pants.length}着
            </span>
            {archivedItems.length > 0 && (
              <span className="text-[10px] bg-amber-950/80 text-amber-300 border border-amber-800/60 px-2 py-0.5 rounded-full font-mono font-bold">
                保管中 {archivedItems.length}着
              </span>
            )}
          </div>
        </div>

        <div className="p-4 bg-slate-800/80 border border-slate-700/70 rounded-2xl shadow-xl space-y-3">
          <p className="text-xs text-slate-300 leading-relaxed">
            手持ちの現役ワードローブ全データ（相性・着用実績・奥様NG）と片付けた服（別枠）を埋め込んだ相談プロンプトを生成します。
            コピーして Gemini に貼り付けるだけで、手持ち服を活かせる買い足し候補や、買う代わりに片付けた服を出す提案を対話形式で自由に相談できます。
          </p>

          {/* 任意の1行相談メモ入力欄 */}
          <div>
            <label className="text-[11px] font-bold text-slate-300 mb-1 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-indigo-400" />
              <span>相談したい条件・悩み（任意・1行）</span>
            </label>
            <input
              type="text"
              value={consultationMemo}
              onChange={(e) => setConsultationMemo(e.target.value)}
              placeholder="例: 出社用のパンツを増やしたい、S1に合う服が欲しい、夏物を探している 等（空欄でもOK）"
              className="w-full min-h-[44px] p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* 奥様NG反映通知バッジ */}
          {wifeNgPairs.length > 0 && (
            <div className="p-2.5 bg-rose-950/40 border border-rose-800/40 rounded-xl flex items-center gap-2 text-[11px] text-rose-300">
              <ShieldCheck className="w-4 h-4 flex-shrink-0 text-rose-400" />
              <span>
                登録済みの<strong>奥様NG（{wifeNgPairs.length}件）</strong>も注意喚起（おすすめ除外対象）としてプロンプトに含めます。
              </span>
            </div>
          )}

          {/* プロンプトコピーボタン */}
          <button
            type="button"
            onClick={handleCopyConsultationPrompt}
            className={`w-full min-h-[44px] py-3 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg ${
              copiedConsultPromptStatus === 'success'
                ? 'bg-emerald-600 text-white'
                : copiedConsultPromptStatus === 'error'
                ? 'bg-rose-600 text-white'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/40 active:scale-[0.98]'
            }`}
          >
            {copiedConsultPromptStatus === 'success' ? (
              <>
                <Check className="w-4 h-4" />
                <span>コピー完了！ Gemini に貼って相談してください</span>
              </>
            ) : copiedConsultPromptStatus === 'error' ? (
              <>
                <AlertCircle className="w-4 h-4" />
                <span>コピーに失敗しました（もう一度お試しください）</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>📋 買い足し相談用プロンプトをコピー</span>
              </>
            )}
          </button>

          {/* 購入後の案内 */}
          <div className="p-2.5 bg-blue-950/40 border border-blue-800/40 rounded-xl text-[11px] text-blue-300 leading-relaxed">
            💡 相談して新しい服を購入した後は、「服追加・AI」タブから写真（＋A4用紙）を選んで登録できます。
          </div>
        </div>
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
