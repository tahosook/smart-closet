import React, { useState } from 'react';
import {
  Grid,
  AlertTriangle,
  Lightbulb,
  X,
  TrendingUp,
  ShoppingBag,
} from 'lucide-react';
import { ClosetItem } from '../types/closet';
import { useClosetStore } from '../hooks/useClosetStore';
import { ItemImage } from './ItemImage';

export const MatrixView: React.FC = () => {
  const { shirts, pants, isNgPair, registerWifeNg, removeWifeNg } = useClosetStore();

  const [selectedPair, setSelectedPair] = useState<{
    shirt: ClosetItem;
    pants: ClosetItem;
  } | null>(null);

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

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="p-4 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-slate-700/80 rounded-2xl shadow-xl">
        <div className="flex items-center gap-2 text-blue-400 font-bold text-sm mb-1">
          <Grid className="w-4 h-4 text-blue-400" />
          <span>全マトリクス一覧 (Matrix & Insights)</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          全9シャツ × 15パンツ（計135通りの組み合わせ）の相性を網羅。マスをタップすると詳細確認や「奥様NG」の切り替えが可能です。
        </p>
      </div>

      {/* Legend */}
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

      {/* 135 Compatibility Matrix Table */}
      <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-2.5 shadow-xl overflow-hidden">
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-center border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-slate-900 p-2 text-[10px] text-slate-400 border border-slate-700/60 min-w-[70px]">
                  シャツ＼パンツ
                </th>
                {pants.map((p) => (
                  <th
                    key={p.id}
                    className="p-1.5 min-w-[52px] bg-slate-900/90 border border-slate-700/60 text-[10px] text-slate-300"
                  >
                    <div className="w-10 h-10 mx-auto rounded overflow-hidden bg-slate-950 mb-1">
                      <ItemImage item={p} showBadge={false} className="w-full h-full" />
                    </div>
                    <span className="font-bold text-slate-200">{p.id}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shirts.map((shirt) => (
                <tr key={shirt.id}>
                  {/* Sticky Shirt header column */}
                  <th className="sticky left-0 z-10 bg-slate-900/95 p-1.5 text-left border border-slate-700/60 shadow-md">
                    <div className="flex items-center gap-1.5">
                      <div className="w-8 h-8 rounded overflow-hidden bg-slate-950 flex-shrink-0">
                        <ItemImage item={shirt} showBadge={false} className="w-full h-full" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-[10px] font-bold text-blue-400 block">{shirt.id}</span>
                        <span className="text-[9px] text-slate-300 truncate block max-w-[60px]">
                          {shirt.name.slice(0, 5)}
                        </span>
                      </div>
                    </div>
                  </th>

                  {/* Matrix Cells */}
                  {pants.map((p) => {
                    const status = getCellStatus(shirt, p);
                    return (
                      <td
                        key={p.id}
                        onClick={() => setSelectedPair({ shirt, pants: p })}
                        className={`p-1.5 border border-slate-700/40 cursor-pointer transition-transform hover:scale-110 active:scale-95 ${status.bg}`}
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
      </div>

      {/* Wardrobe Bias Analysis & Smart Buy Recommendations */}
      <section className="space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5 px-1">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <span>ワードローブ偏り分析＆買い足しレコメンド</span>
        </h3>

        {/* Bias Insights Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-4 bg-slate-800/80 border border-slate-700/70 rounded-2xl space-y-2">
            <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
              <Lightbulb className="w-4 h-4 text-amber-400" />
              <span>出社エース（P3・P8・P9）への依存度過多</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              出社推奨パンツ15本中、安心感のある出社スラックスは <strong>P8（濃紺）</strong>、<strong>P9（ミディアムグレー）</strong>、<strong>P3（グレージュ）</strong> の実質3本に偏っています。週3回以上の出社が続くと冷却期間（連続着用回避）がタイトになる傾向があります。
            </p>
          </div>

          <div className="p-4 bg-slate-800/80 border border-slate-700/70 rounded-2xl space-y-2">
            <div className="text-xs font-bold text-sky-300 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-sky-400" />
              <span>S1（濃インディゴ）の出社相手不足</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              S1は濃いネイビーのため、ネイビー系パンツ（P1, P5, P6, P8, P11）と合わせると「作業着見え」で奥様NGになります。実質的にP3・P9・P12（オリーブ）の3本しか合わせられず、着回しが制限されています。
            </p>
          </div>
        </div>

        {/* Recommended Buy Items */}
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
              <span className="text-xs text-slate-400 font-mono">P16候補</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              現在手持ちの黒パンツは <strong>P2（黒スウェット）</strong> のみで出社不可です。「出社できる黒スラックス」を1本導入するだけで、S1（濃インディゴ）をはじめ、白シャツ全種、サックス、生成りまで <strong>全9シャツの出社コーデが即座に解禁</strong> されます。
            </p>
            <div className="text-[11px] text-blue-400 font-medium pt-1">
              おすすめ仕様: ノータック〜ワンタック、ポリエステル混紡でシワになりにくく自宅洗濯可能なもの。
            </div>
          </div>
        </div>
      </section>

      {/* Selected Pair Preview Modal */}
      {selectedPair && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl relative">
            <button
              onClick={() => setSelectedPair(null)}
              className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white rounded-full bg-slate-800"
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
                        className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 transition-colors"
                      >
                        🚨 奥様NGを解除する
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          registerWifeNg(selectedPair.shirt.id, selectedPair.pants.id);
                          setSelectedPair(null);
                        }}
                        className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/40 transition-colors"
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
