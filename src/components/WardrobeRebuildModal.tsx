import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Copy,
  Check,
  AlertCircle,
  ArrowRight,
  ChevronRight,
  Layers,
  ShieldCheck,
  Trash2,
  Download,
  RefreshCw,
  Info,
  Upload,
  FileText,
} from 'lucide-react';
import { useClosetStore } from '../hooks/useClosetStore';
import { ItemImage } from './ItemImage';
import { getImageBlob } from '../utils/imageStore';
import {
  computeImageHashesFromBlob,
  generateRebuildContactSheets,
  downloadBlobAsFile,
  RebuildContactSheetResult,
} from '../utils/imageProcessor';
import {
  detectDuplicateGarmentGroups,
  previewDuplicateMerge,
  buildWardrobeRebuildPrompt,
  validateAndBuildRebuildDiffs,
  copyTextToClipboard,
} from '../utils/closetDomain';
import type {
  DuplicateGroupCandidate,
  DuplicateMergeSelection,
  RebuildItemDiff,
  RebuildFieldSelection,
  RebuildFieldKey,
} from '../types/closet';

interface WardrobeRebuildModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const WardrobeRebuildModal: React.FC<WardrobeRebuildModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    closetData,
    wearHistory,
    wifeNgPairs,
    mergeDuplicateGarments,
    applyWardrobeRebuild,
    gasConfig,
  } = useClosetStore();

  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);

  // ----------------------------------------------------
  // Step 1: 重複解消ステート
  // ----------------------------------------------------
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroupCandidate[]>([]);
  const [isDetectingDuplicates, setIsDetectingDuplicates] = useState(false);
  const [mergeSelections, setMergeSelections] = useState<Record<string, DuplicateMergeSelection>>({});
  const [deleteImagesOnGas, setDeleteImagesOnGas] = useState(true);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeSuccessMessage, setMergeSuccessMessage] = useState<string | null>(null);

  // ----------------------------------------------------
  // Step 2: コンタクトシート＆プロンプト生成ステート
  // ----------------------------------------------------
  const [contactSheets, setContactSheets] = useState<RebuildContactSheetResult[]>([]);
  const [isGeneratingSheets, setIsGeneratingSheets] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [rebuildJsonInput, setRebuildJsonInput] = useState('');
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ----------------------------------------------------
  // Step 3: 差分比較＆選択適用ステート
  // ----------------------------------------------------
  const [rebuildDiffs, setRebuildDiffs] = useState<RebuildItemDiff[]>([]);
  const [fieldSelections, setFieldSelections] = useState<Record<string, RebuildFieldSelection>>({});
  const [isApplyingRebuild, setIsApplyingRebuild] = useState(false);
  const [rebuildSuccessMessage, setRebuildSuccessMessage] = useState<string | null>(null);

  // モーダルオープン時の重複検出
  useEffect(() => {
    if (!isOpen) {
      // モーダルが閉じたら初期化
      setActiveStep(1);
      setMergeSuccessMessage(null);
      setRebuildSuccessMessage(null);
      setParseError(null);
      setSelectedFileName(null);
      return;
    }

    let isMounted = true;
    const runDuplicateDetection = async () => {
      setIsDetectingDuplicates(true);
      try {
        const hashes: Record<string, { sha256: string; dhash: string }> = {};
        for (const item of closetData.items) {
          const blob = await getImageBlob(item.id);
          if (blob) {
            try {
              const h = await computeImageHashesFromBlob(blob);
              hashes[item.id] = h;
            } catch (e) {
              console.warn(`画像ハッシュ計算失敗 [${item.id}]:`, e);
            }
          }
        }

        if (!isMounted) return;

        const groups = detectDuplicateGarmentGroups({
          items: closetData.items,
          imageHashes: hashes,
        });

        setDuplicateGroups(groups);

        const initialSelections: Record<string, DuplicateMergeSelection> = {};
        for (const g of groups) {
          initialSelections[g.groupId] = {
            survivorId: g.defaultSurvivorId,
            removedIds: g.itemIds.filter((id) => id !== g.defaultSurvivorId),
            included: true,
          };
        }
        setMergeSelections(initialSelections);
      } catch (err) {
        console.error('重複検出エラー:', err);
      } finally {
        if (isMounted) setIsDetectingDuplicates(false);
      }
    };

    runDuplicateDetection();

    return () => {
      isMounted = false;
    };
  }, [isOpen, closetData.items]);

  // 重複解消プレビューの計算
  const mergePreview = useMemo(() => {
    const selectionsList = Object.values(mergeSelections);
    return previewDuplicateMerge({
      closetData,
      wearHistory,
      wifeNgPairs,
      selections: selectionsList,
    });
  }, [closetData, wearHistory, wifeNgPairs, mergeSelections]);

  // 重複解消の survivor 切り替え
  const handleSurvivorChange = (groupId: string, newSurvivorId: string) => {
    const group = duplicateGroups.find((g) => g.groupId === groupId);
    if (!group) return;

    setMergeSelections((prev) => ({
      ...prev,
      [groupId]: {
        ...prev[groupId],
        survivorId: newSurvivorId,
        removedIds: group.itemIds.filter((id) => id !== newSurvivorId),
      },
    }));
  };

  // 重複解消グループの対象チェック切り替え
  const handleToggleGroupIncluded = (groupId: string) => {
    setMergeSelections((prev) => ({
      ...prev,
      [groupId]: {
        ...prev[groupId],
        included: !prev[groupId]?.included,
      },
    }));
  };

  // 重複解消の実行
  const handleExecuteMerge = async () => {
    const selectionsList = Object.values(mergeSelections).filter((s) => s.included);
    if (selectionsList.length === 0) return;

    setIsMerging(true);
    setMergeSuccessMessage(null);
    try {
      const res = await mergeDuplicateGarments(selectionsList, {
        deleteImages: deleteImagesOnGas && Boolean(gasConfig.webAppUrl),
      });

      if (res.ok) {
        setMergeSuccessMessage(
          `重複の統合が完了しました（${res.mergedCount}組を統合、${res.removedItemIds.length}着を整理）。`
        );
        // 重複グループリストをクリア
        setDuplicateGroups([]);
      } else {
        alert(`重複統合に失敗しました: ${res.error || '不明なエラー'}`);
      }
    } catch (err) {
      alert(`重複統合中にエラーが発生しました: ${(err as Error).message}`);
    } finally {
      setIsMerging(false);
    }
  };

  // ----------------------------------------------------
  // Step 2: コンタクトシート生成とプロンプトコピー
  // ----------------------------------------------------
  const handleGenerateContactSheets = async () => {
    setIsGeneratingSheets(true);
    try {
      const blobsMap = new Map<string, Blob>();
      for (const item of closetData.items) {
        const b = await getImageBlob(item.id);
        if (b) blobsMap.set(item.id, b);
      }

      const sheets = await generateRebuildContactSheets(closetData.items, blobsMap, 12);
      setContactSheets(sheets);
    } catch (err) {
      alert(`コンタクトシートの生成に失敗しました: ${(err as Error).message}`);
    } finally {
      setIsGeneratingSheets(false);
    }
  };

  const generatedPrompt = useMemo(() => {
    const sheetsCount = contactSheets.length > 0 ? contactSheets.length : Math.ceil(closetData.items.length / 12);
    return buildWardrobeRebuildPrompt({
      items: closetData.items,
      contactSheetsCount: sheetsCount,
    });
  }, [closetData.items, contactSheets.length]);

  const handleCopyPrompt = async () => {
    const ok = await copyTextToClipboard(generatedPrompt);
    if (ok) {
      setCopyStatus('success');
      setTimeout(() => setCopyStatus('idle'), 3000);
    } else {
      setCopyStatus('error');
    }
  };

  const processRebuildJsonText = (rawText: string) => {
    setParseError(null);
    const result = validateAndBuildRebuildDiffs(rawText, closetData.items);
    if (!result.valid || !result.diffs) {
      setParseError(result.error || 'JSONの解析に失敗しました。');
      return false;
    }

    setRebuildDiffs(result.diffs);

    const initialFieldSelections: Record<string, RebuildFieldSelection> = {};
    for (const d of result.diffs) {
      initialFieldSelections[d.id] = { ...d.defaultSelection };
    }
    setFieldSelections(initialFieldSelections);
    setActiveStep(3);
    return true;
  };

  const handleParseRebuildJson = () => {
    processRebuildJsonText(rebuildJsonInput);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    setParseError(null);

    try {
      let text = '';
      if (typeof file.text === 'function') {
        text = await file.text();
      } else {
        text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
          reader.readAsText(file, 'UTF-8');
        });
      }

      if (!text || !text.trim()) {
        setParseError(
          '選択されたファイルが空です。Geminiの回答JSONが含まれるファイル（.json / .txt）を選択してください。'
        );
        return;
      }

      setRebuildJsonInput(text);
      processRebuildJsonText(text);
    } catch (err) {
      console.error('File read error:', err);
      setParseError(
        'ファイルの読み取りに失敗しました。別のファイルを選択するか、テキストを貼り付けてください。'
      );
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // ----------------------------------------------------
  // Step 3: 差分選択適用のハンドラ
  // ----------------------------------------------------
  const handleToggleField = (itemId: string, field: RebuildFieldKey) => {
    setFieldSelections((prev) => {
      const current = prev[itemId] || {
        name: false,
        color: false,
        seasonSleeve: false,
        scores: false,
        measurements: false,
        notes: false,
        compatibility: false,
      };
      return {
        ...prev,
        [itemId]: {
          ...current,
          [field]: !current[field],
        },
      };
    });
  };

  const handleBatchSelectAll = (select: boolean, filterProtected = false) => {
    setFieldSelections(() => {
      const next: Record<string, RebuildFieldSelection> = {};
      for (const d of rebuildDiffs) {
        if (!select) {
          next[d.id] = {
            name: false,
            color: false,
            seasonSleeve: false,
            scores: false,
            measurements: false,
            notes: false,
            compatibility: false,
          };
        } else if (filterProtected) {
          next[d.id] = { ...d.defaultSelection };
        } else {
          next[d.id] = {
            name: d.changedFields.includes('name'),
            color: d.changedFields.includes('color'),
            seasonSleeve: d.changedFields.includes('seasonSleeve'),
            scores: d.changedFields.includes('scores'),
            measurements: d.changedFields.includes('measurements'),
            notes: d.changedFields.includes('notes'),
            compatibility: d.changedFields.includes('compatibility'),
          };
        }
      }
      return next;
    });
  };

  const handleApplyRebuild = () => {
    setIsApplyingRebuild(true);
    setRebuildSuccessMessage(null);
    try {
      const res = applyWardrobeRebuild(rebuildDiffs, fieldSelections);
      if (res.valid) {
        setRebuildSuccessMessage(
          `全件リビルドの適用が完了しました（${res.appliedItemsCount}着のデータを更新）。変更は自動でクラウドへ同期されます。`
        );
      } else {
        alert(`適応に失敗しました: ${res.error || '不明なエラー'}`);
      }
    } catch (err) {
      alert(`リビルド適用エラー: ${(err as Error).message}`);
    } finally {
      setIsApplyingRebuild(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="写真からの全件リビルド＆重複解消"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
    >
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* ヘッダー */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-400" />
              写真からの全件リビルド ＆ 重複解消
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              保存写真を正本として、13色パレット・属性・相性を丸ごと再構築します
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 -mr-2 text-slate-400 hover:text-white rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ステップナビゲーション */}
        <div className="flex border-b border-slate-200 bg-slate-50 text-xs sm:text-sm font-medium">
          <button
            onClick={() => setActiveStep(1)}
            className={`flex-1 py-3 px-2 sm:px-4 text-center border-b-2 transition-colors min-h-[44px] flex items-center justify-center gap-1.5 ${
              activeStep === 1
                ? 'border-indigo-600 text-indigo-700 bg-white font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-bold">
              1
            </span>
            <span>重複の検出・統合</span>
            {duplicateGroups.length > 0 && (
              <span className="px-1.5 py-0.2 text-[10px] bg-amber-500 text-white rounded-full">
                {duplicateGroups.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveStep(2)}
            className={`flex-1 py-3 px-2 sm:px-4 text-center border-b-2 transition-colors min-h-[44px] flex items-center justify-center gap-1.5 ${
              activeStep === 2
                ? 'border-indigo-600 text-indigo-700 bg-white font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-bold">
              2
            </span>
            <span>写真シート＆Gemini分析</span>
          </button>
          <button
            onClick={() => setActiveStep(3)}
            disabled={rebuildDiffs.length === 0}
            className={`flex-1 py-3 px-2 sm:px-4 text-center border-b-2 transition-colors min-h-[44px] flex items-center justify-center gap-1.5 ${
              activeStep === 3
                ? 'border-indigo-600 text-indigo-700 bg-white font-bold'
                : 'border-transparent text-slate-400 disabled:opacity-50'
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-bold">
              3
            </span>
            <span>差分比較＆選択適用</span>
          </button>
        </div>

        {/* コンテンツエリア */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* ==================================================== */}
          {/* STEP 1: 重複解消 */}
          {/* ==================================================== */}
          {activeStep === 1 && (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-blue-600 shrink-0" />
                  同一写真・重複登録の検出と統合
                </div>
                <p className="text-xs text-blue-800 leading-relaxed">
                  同じ写真を2回登録した二重登録を自動検出しました。残すIDを選択して統合できます。
                  <br />
                  <strong>【着用日の不変保証】</strong> 着用履歴の日付は一切変わらず、参照IDのみを残す服へ安全に差し替えます。
                </p>
              </div>

              {mergeSuccessMessage && (
                <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-4 text-sm text-emerald-900 font-medium flex items-center gap-2">
                  <Check className="w-5 h-5 text-emerald-600 shrink-0" />
                  {mergeSuccessMessage}
                </div>
              )}

              {isDetectingDuplicates ? (
                <div className="text-center py-12 text-slate-500 space-y-2">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-500" />
                  <p className="text-sm">服の写真ハッシュ（SHA-256 / dHash）を照合中...</p>
                </div>
              ) : duplicateGroups.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-slate-300 rounded-2xl bg-slate-50 space-y-3">
                  <ShieldCheck className="w-10 h-10 text-emerald-500 mx-auto" />
                  <div className="text-sm font-bold text-slate-800">重複は検出されませんでした</div>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    現在登録されている全{closetData.items.length}着に写真の二重登録はありません。次のステップへ進んでください。
                  </p>
                  <button
                    onClick={() => setActiveStep(2)}
                    className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-colors shadow-sm min-h-[44px]"
                  >
                    Step 2: 写真シート＆分析へ進む
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-sm font-bold text-slate-800 flex items-center justify-between">
                    <span>検出された重複グループ（全{duplicateGroups.length}組）</span>
                    <span className="text-xs text-slate-500 font-normal">
                      残す服をラジオボタンで選択してください
                    </span>
                  </div>

                  <div className="space-y-4">
                    {duplicateGroups.map((group) => {
                      const sel = mergeSelections[group.groupId];
                      const isIncluded = sel?.included ?? true;
                      const survivorId = sel?.survivorId || group.defaultSurvivorId;

                      return (
                        <div
                          key={group.groupId}
                          className={`border rounded-xl p-4 transition-all ${
                            isIncluded
                              ? 'border-indigo-300 bg-white shadow-sm'
                              : 'border-slate-200 bg-slate-50 opacity-60'
                          }`}
                        >
                          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                            <label className="flex items-center gap-2 cursor-pointer font-bold text-sm text-slate-800">
                              <input
                                type="checkbox"
                                checked={isIncluded}
                                onChange={() => handleToggleGroupIncluded(group.groupId)}
                                className="w-4 h-4 text-indigo-600 rounded"
                              />
                              <span>グループ: {group.itemIds.join(', ')}</span>
                            </label>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                              {group.similarityDetail}
                            </span>
                          </div>

                          {/* グループ内の服カード一覧 */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                            {group.itemIds.map((itemId) => {
                              const item = closetData.items.find((it) => it.id === itemId);
                              const isSurvivor = survivorId === itemId;

                              return (
                                <label
                                  key={itemId}
                                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all min-h-[44px] ${
                                    isSurvivor
                                      ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500'
                                      : 'border-slate-200 bg-white hover:border-slate-300'
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name={`survivor_${group.groupId}`}
                                    checked={isSurvivor}
                                    onChange={() => handleSurvivorChange(group.groupId, itemId)}
                                    className="w-4 h-4 text-indigo-600"
                                  />
                                  <div className="w-14 h-18 shrink-0 rounded overflow-hidden bg-slate-100 border border-slate-200">
                                    <ItemImage
                                      item={
                                        item || {
                                          id: itemId,
                                          category: group.category,
                                          name: itemId,
                                          imageUrl: '',
                                          seasonSleeve: '通年',
                                          dressScore: 3,
                                          comfortScore: 3,
                                          officeRecommendIds: [],
                                          remoteRecommendIds: [],
                                          ngIds: [],
                                          ngReason: '',
                                          notes: '',
                                        }
                                      }
                                      className="w-full h-full object-cover"
                                    />
                                  </div>
                                  <div className="flex-1 min-w-0 text-left">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-bold text-sm text-slate-900">[{itemId}]</span>
                                      {isSurvivor && (
                                        <span className="text-[10px] px-1.5 py-0.5 bg-indigo-600 text-white rounded font-bold">
                                          残す（主）
                                        </span>
                                      )}
                                      {!isSurvivor && (
                                        <span className="text-[10px] px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded">
                                          統合・削除
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-xs text-slate-600 truncate mt-0.5">
                                      {item?.name || '名称未設定'}
                                    </div>
                                    <div className="text-[11px] text-slate-400 mt-0.5">
                                      色: {item?.color || '未設定'} / 季節: {item?.seasonSleeve || '通年'}
                                    </div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 影響プレビューと実行オプション */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="font-bold text-xs text-slate-700">マージ実行プレビュー</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <div className="text-slate-500">整理される服</div>
                        <div className="text-base font-bold text-amber-600">
                          {mergePreview.totalRemovedCount} 着
                        </div>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <div className="text-slate-500">ID置換される着用履歴</div>
                        <div className="text-base font-bold text-indigo-600">
                          {mergePreview.affectedWearRecordsCount} 件
                        </div>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <div className="text-slate-500">統合される奥様NG</div>
                        <div className="text-base font-bold text-slate-700">
                          {mergePreview.affectedWifeNgCount} 件
                        </div>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <div className="text-slate-500">統合後の総着数</div>
                        <div className="text-base font-bold text-emerald-600">
                          {mergePreview.itemsAfterCount} 着
                        </div>
                      </div>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer pt-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={deleteImagesOnGas}
                        onChange={(e) => setDeleteImagesOnGas(e.target.checked)}
                        className="w-4 h-4 text-indigo-600 rounded"
                      />
                      <span>Google ドライブ上の不要写真もゴミ箱へ移動する（推奨）</span>
                    </label>

                    <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-end">
                      <button
                        onClick={handleExecuteMerge}
                        disabled={isMerging || mergePreview.totalRemovedCount === 0}
                        className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm flex items-center justify-center gap-2 min-h-[44px]"
                      >
                        {isMerging ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            統合処理中...
                          </>
                        ) : (
                          <>
                            <Trash2 className="w-4 h-4" />
                            選択した重複を統合・整理する
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => setActiveStep(2)}
                        className="px-4 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5 min-h-[44px]"
                      >
                        Step 2 へ進む
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================================================== */}
          {/* STEP 2: コンタクトシート生成＆Gemini分析 */}
          {/* ==================================================== */}
          {activeStep === 2 && (
            <div className="space-y-6">
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-sm text-indigo-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-indigo-600 shrink-0" />
                  写真コンタクトシート生成とGemini相談手順
                </div>
                <p className="text-xs text-indigo-800 leading-relaxed">
                  ワードローブ全{closetData.items.length}着の写真をIDラベル付きの「コンタクトシート画像」（1枚最大12着）として自動合成します。
                  シート画像をダウンロードし、プロンプトと一緒に Gemini（Google AI Pro）へ提出してください。
                </p>
              </div>

              {/* コンタクトシート生成エリア */}
              <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900">
                      1. 写真コンタクトシートの作成
                    </h3>
                    <p className="text-xs text-slate-500">
                      全{closetData.items.length}着 / 1シート最大12着（計{Math.ceil(closetData.items.length / 12)}枚）
                    </p>
                  </div>
                  <button
                    onClick={handleGenerateContactSheets}
                    disabled={isGeneratingSheets}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm flex items-center justify-center gap-1.5 min-h-[44px]"
                  >
                    {isGeneratingSheets ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        シート合成中...
                      </>
                    ) : (
                      <>
                        <Layers className="w-4 h-4" />
                        コンタクトシートを生成する
                      </>
                    )}
                  </button>
                </div>

                {contactSheets.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                    {contactSheets.map((sheet) => (
                      <div
                        key={sheet.sheetIndex}
                        className="border border-slate-200 rounded-lg p-2 bg-slate-50 flex flex-col items-center space-y-2"
                      >
                        <img
                          src={sheet.dataUrl}
                          alt={`Sheet ${sheet.sheetIndex}`}
                          className="w-full aspect-[3/4] object-contain rounded bg-white border border-slate-200"
                        />
                        <div className="text-[11px] font-bold text-slate-700">
                          シート {sheet.sheetIndex} / {sheet.totalSheets}
                        </div>
                        <button
                          onClick={() =>
                            downloadBlobAsFile(
                              sheet.blob,
                              `smart-closet-contact-sheet-${sheet.sheetIndex}.jpg`
                            )
                          }
                          className="w-full py-1.5 px-2 bg-white border border-slate-300 text-slate-700 rounded text-xs font-medium hover:bg-slate-100 flex items-center justify-center gap-1 min-h-[36px]"
                        >
                          <Download className="w-3.5 h-3.5" />
                          保存
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Geminiプロンプトコピーエリア */}
              <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-slate-900">
                    2. Gemini用プロンプト（確定13色パレット・判定アンカー準拠）
                  </h3>
                  <button
                    onClick={handleCopyPrompt}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 min-h-[40px]"
                  >
                    {copyStatus === 'success' ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-600" />
                        コピー完了!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        プロンプトをコピー
                      </>
                    )}
                  </button>
                </div>

                <div className="relative">
                  <textarea
                    readOnly
                    value={generatedPrompt}
                    rows={6}
                    className="w-full text-xs font-mono bg-slate-50 p-3 rounded-lg border border-slate-200 text-slate-700 resize-none outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* 回答JSON取り込みエリア */}
              <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-4">
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    3. Geminiの回答JSONを取り込み
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Geminiから返信された JSON（```json ... ``` を含む全文でも可）をファイルまたは貼り付けで取り込んでください。全着分の長文JSONはファイル選択が確実です。
                  </p>
                </div>

                {/* ファイル選択入り口 */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div>
                      <div className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                        <Upload className="w-3.5 h-3.5 text-indigo-600" />
                        ファイルから取り込む（長文推奨）
                      </div>
                      <div className="text-[11px] text-slate-500">
                        .json または .txt ファイルを選択すると、自動で検証して差分プレビューへ進みます
                      </div>
                    </div>
                    <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,.txt,application/json,text/plain"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full sm:w-auto px-4 py-2 bg-white border border-indigo-200 hover:border-indigo-400 text-indigo-700 rounded-lg text-xs font-bold transition-colors shadow-sm flex items-center justify-center gap-1.5 min-h-[44px]"
                      >
                        <FileText className="w-4 h-4" />
                        ファイルを選択
                      </button>
                    </div>
                  </div>
                  {selectedFileName && (
                    <div className="text-[11px] text-indigo-600 font-medium flex items-center gap-1 pt-0.5">
                      <Check className="w-3.5 h-3.5" />
                      読み込み済み: {selectedFileName}
                    </div>
                  )}
                </div>

                {/* テキスト貼り付けエリア */}
                <div className="space-y-2">
                  <div className="font-bold text-xs text-slate-700">
                    またはテキストを直接貼り付け
                  </div>
                  <textarea
                    value={rebuildJsonInput}
                    onChange={(e) => setRebuildJsonInput(e.target.value)}
                    placeholder={`{\n  "rebuildItems": [\n    { "id": "S1", "name": "...", "color": "濃紺", ... }\n  ]\n}`}
                    rows={6}
                    className="w-full text-xs font-mono p-3 rounded-lg border border-slate-300 text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {parseError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-start gap-2 whitespace-pre-line">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>{parseError}</div>
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleParseRebuildJson}
                    disabled={!rebuildJsonInput.trim()}
                    className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm flex items-center gap-2 min-h-[44px]"
                  >
                    JSONを検証して差分プレビューへ進む
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ==================================================== */}
          {/* STEP 3: 差分比較＆選択適用 */}
          {/* ==================================================== */}
          {activeStep === 3 && (
            <div className="space-y-6">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-800 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0" />
                  再分析結果の差分比較と選択適用
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  全上書きは行わず、変更点を確認して個別に適用できます。
                  <strong>確定済みの色</strong>や<strong>実寸データ</strong>は意図しない上書きを防ぐため、デフォルトで保護（チェックOFF）されています。
                </p>
              </div>

              {rebuildSuccessMessage && (
                <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-4 text-sm text-emerald-900 font-medium flex items-center gap-2">
                  <Check className="w-5 h-5 text-emerald-600 shrink-0" />
                  {rebuildSuccessMessage}
                </div>
              )}

              {/* 一括操作バー */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
                <div className="text-xs font-bold text-slate-700">
                  差分対象: 全{rebuildDiffs.length}着中 {rebuildDiffs.filter((d) => d.changedFields.length > 0).length}着に変更あり
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    onClick={() => handleBatchSelectAll(true, true)}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium min-h-[36px]"
                  >
                    安全デフォルト（保護維持）
                  </button>
                  <button
                    onClick={() => handleBatchSelectAll(true, false)}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium min-h-[36px]"
                  >
                    全項目を選択
                  </button>
                  <button
                    onClick={() => handleBatchSelectAll(false)}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium min-h-[36px]"
                  >
                    全解除
                  </button>
                </div>
              </div>

              {/* 差分カードリスト */}
              <div className="space-y-4">
                {rebuildDiffs.map((diff) => {
                  const selection = fieldSelections[diff.id] || diff.defaultSelection;
                  const hasDiff = diff.changedFields.length > 0;

                  return (
                    <div
                      key={diff.id}
                      className={`border rounded-xl p-4 transition-all ${
                        hasDiff ? 'border-slate-300 bg-white shadow-sm' : 'border-slate-200 bg-slate-50/50'
                      }`}
                    >
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-slate-900">[{diff.id}]</span>
                          <span className="text-xs text-slate-600 truncate max-w-[200px] sm:max-w-md">
                            {diff.before.name}
                          </span>
                        </div>
                        {hasDiff ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">
                            {diff.changedFields.length}項目に変更
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                            変更なし
                          </span>
                        )}
                      </div>

                      {hasDiff && (
                        <div className="mt-3 space-y-2 text-xs">
                          {/* 1. 名前 */}
                          {diff.changedFields.includes('name') && (
                            <label className="flex items-start gap-2 p-2 rounded bg-slate-50 hover:bg-slate-100 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selection.name}
                                onChange={() => handleToggleField(diff.id, 'name')}
                                className="w-4 h-4 mt-0.5 text-indigo-600 rounded"
                              />
                              <div className="flex-1">
                                <span className="font-bold text-slate-700">アイテム名:</span>
                                <div className="text-slate-500 line-through">{diff.before.name}</div>
                                <div className="text-emerald-700 font-medium">{diff.after.name}</div>
                              </div>
                            </label>
                          )}

                          {/* 2. 色（保護機能付き） */}
                          {diff.changedFields.includes('color') && (
                            <label className="flex items-start gap-2 p-2 rounded bg-slate-50 hover:bg-slate-100 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selection.color}
                                onChange={() => handleToggleField(diff.id, 'color')}
                                className="w-4 h-4 mt-0.5 text-indigo-600 rounded"
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-700">確定色 (13色):</span>
                                  {diff.isColorProtected && (
                                    <span className="text-[10px] px-1.5 py-0.2 bg-blue-100 text-blue-700 rounded font-medium">
                                      確定色保護中
                                    </span>
                                  )}
                                </div>
                                <div className="text-slate-500 line-through">
                                  {diff.before.color || '未設定'}
                                </div>
                                <div className="text-emerald-700 font-medium">{diff.after.color}</div>
                              </div>
                            </label>
                          )}

                          {/* 3. 季節・袖丈 */}
                          {diff.changedFields.includes('seasonSleeve') && (
                            <label className="flex items-start gap-2 p-2 rounded bg-slate-50 hover:bg-slate-100 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selection.seasonSleeve}
                                onChange={() => handleToggleField(diff.id, 'seasonSleeve')}
                                className="w-4 h-4 mt-0.5 text-indigo-600 rounded"
                              />
                              <div className="flex-1">
                                <span className="font-bold text-slate-700">季節・袖丈:</span>
                                <div className="text-slate-500 line-through">{diff.before.seasonSleeve}</div>
                                <div className="text-emerald-700 font-medium">
                                  {diff.after.seasonSleeve}
                                </div>
                              </div>
                            </label>
                          )}

                          {/* 4. スコア */}
                          {diff.changedFields.includes('scores') && (
                            <label className="flex items-start gap-2 p-2 rounded bg-slate-50 hover:bg-slate-100 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selection.scores}
                                onChange={() => handleToggleField(diff.id, 'scores')}
                                className="w-4 h-4 mt-0.5 text-indigo-600 rounded"
                              />
                              <div className="flex-1">
                                <span className="font-bold text-slate-700">ドレス度 / 快適度:</span>
                                <div className="text-slate-500 line-through">
                                  ドレス {diff.before.dressScore} / 快適 {diff.before.comfortScore}
                                </div>
                                <div className="text-emerald-700 font-medium">
                                  ドレス {diff.after.dressScore} / 快適 {diff.after.comfortScore}
                                </div>
                              </div>
                            </label>
                          )}

                          {/* 5. 相性配列 */}
                          {diff.changedFields.includes('compatibility') && (
                            <label className="flex items-start gap-2 p-2 rounded bg-slate-50 hover:bg-slate-100 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selection.compatibility}
                                onChange={() => handleToggleField(diff.id, 'compatibility')}
                                className="w-4 h-4 mt-0.5 text-indigo-600 rounded"
                              />
                              <div className="flex-1">
                                <span className="font-bold text-slate-700">相性・NG・理由:</span>
                                <div className="text-slate-500">
                                  現行: 出社[{(diff.before.officeRecommendIds || []).join(',')}] / NG[
                                  {(diff.before.ngIds || []).join(',')}]
                                  {diff.before.ngReason ? ` (理由: ${diff.before.ngReason})` : ''}
                                </div>
                                <div className="text-emerald-700 font-medium">
                                  新: 出社[{(diff.after.officeRecommendIds || []).join(',')}] / NG[
                                  {(diff.after.ngIds || []).join(',')}]
                                  {diff.after.ngReason ? ` (理由: ${diff.after.ngReason})` : ''}
                                </div>
                              </div>
                            </label>
                          )}

                          {/* 6. メモ */}
                          {diff.changedFields.includes('notes') && (
                            <label className="flex items-start gap-2 p-2 rounded bg-slate-50 hover:bg-slate-100 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selection.notes}
                                onChange={() => handleToggleField(diff.id, 'notes')}
                                className="w-4 h-4 mt-0.5 text-indigo-600 rounded"
                              />
                              <div className="flex-1">
                                <span className="font-bold text-slate-700">メモ:</span>
                                <div className="text-slate-500 line-through">{diff.before.notes || 'なし'}</div>
                                <div className="text-emerald-700 font-medium">{diff.after.notes || 'なし'}</div>
                              </div>
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 確定適用ボタン */}
              <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row gap-2 justify-end">
                <button
                  onClick={() => setActiveStep(2)}
                  className="px-4 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-50 transition-colors min-h-[44px]"
                >
                  Step 2 に戻る
                </button>
                <button
                  onClick={handleApplyRebuild}
                  disabled={isApplyingRebuild}
                  className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm flex items-center justify-center gap-2 min-h-[44px]"
                >
                  {isApplyingRebuild ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      適用中...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      選択した差分をワードローブへ適用する
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <div>
            奥様NG原則準拠 / クライアント直接LLM呼び出し不使用（Human-in-the-loop）
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-bold transition-colors min-h-[44px] flex items-center justify-center"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
