import React, { useState, useRef, useEffect } from 'react';
import {
  Copy,
  Check,
  Download,
  RotateCcw,
  Sparkles,
  Camera,
  FileCode,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  FileText,
  ShieldCheck,
  RefreshCw,
  X,
  ChevronDown,
  ChevronUp,
  Sliders,
  Palette,
  Crop,
  Ruler,
} from 'lucide-react';
import { useClosetStore } from '../hooks/useClosetStore';
import {
  Category,
  ClosetItem,
  GarmentMeasurements,
  GarmentCropBox,
  ColorUpdateItem,
  BatchGarmentDraftItem,
  MAX_BATCH_GARMENTS,
} from '../types/closet';
import {
  getNextSequentialId,
  switchDraftItemCategory,
  GARMENT_COLOR_PALETTE,
  GARMENT_COLOR_ANCHOR_GUIDE,
  isValidGarmentColor,
  normalizeCropBox,
  validateGarmentMeasurements,
  assignSequentialIdsForBatch,
  validateSingleClosetItem,
} from '../utils/closetDomain';
import {
  saveDraftImage,
  getDraftImage,
  clearDraftImage,
  saveImageBlob,
} from '../utils/imageStore';
import {
  processGarmentImage,
  cropAndNormalizeGarmentImage,
  uploadImageToGas,
} from '../utils/imageProcessor';
import { getColorForPalette } from './ItemImage';

const SHIRT_SLEEVE_PRESETS = [
  '長袖・通年',
  '春夏秋・七分袖',
  '春夏・半袖',
  '秋冬・長袖',
];

const PANTS_SLEEVE_PRESETS = [
  '通年',
  '春夏秋',
  '春夏',
  '秋冬',
];

const SHIRT_MEASUREMENT_FIELDS: { key: keyof GarmentMeasurements; label: string; desc: string }[] = [
  { key: 'bodyLength', label: '着丈', desc: '衿リブ下〜裾' },
  { key: 'chestWidth', label: '身幅', desc: '両脇下の直線距離' },
  { key: 'shoulderWidth', label: '肩幅', desc: '両肩先の直線距離' },
  { key: 'sleeveLength', label: '袖丈', desc: '肩先〜袖口' },
];

const PANTS_MEASUREMENT_FIELDS: { key: keyof GarmentMeasurements; label: string; desc: string }[] = [
  { key: 'waist', label: 'ウエスト', desc: '内周目安' },
  { key: 'inseam', label: '股下', desc: '股の十字縫目〜裾' },
  { key: 'totalLength', label: '総丈', desc: 'ウエスト上端〜裾' },
  { key: 'hemWidth', label: '裾幅', desc: '裾の直線距離' },
];

interface ParsedSyncInput {
  kind: 'single' | 'batch_color' | 'batch_garments' | 'invalid';
  item?: Partial<ClosetItem>;
  cropBox?: GarmentCropBox | null;
  batchColorUpdates?: ColorUpdateItem[];
  batchGarments?: BatchGarmentDraftItem[];
  error?: string;
}

/**
 * 貼り付けられた JSON テキストから単一アイテム、一括色更新、またはまとめ撮り一括服オブジェクトを安全に解析するヘルパー
 */
function parseSyncInputJson(rawText: string): ParsedSyncInput {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { kind: 'invalid', error: 'JSONテキストを貼り付けてください。' };
  }

  let clean = trimmed;
  if (clean.startsWith('```json')) {
    clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (clean.startsWith('```')) {
    clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const parsed = JSON.parse(clean);

    // 1. 一括色更新形式: { "colorUpdates": [...] } または 配列
    if (parsed && typeof parsed === 'object') {
      const candidates = Array.isArray((parsed as any).colorUpdates)
        ? (parsed as any).colorUpdates
        : Array.isArray(parsed) &&
          parsed.length > 0 &&
          typeof (parsed[0] as any)?.id === 'string' &&
          (parsed[0] as any)?.color !== undefined &&
          (parsed[0] as any)?.category === undefined
        ? parsed
        : null;

      if (candidates) {
        const batchList: ColorUpdateItem[] = [];
        for (const c of candidates) {
          if (c && typeof c.id === 'string' && typeof c.color === 'string') {
            batchList.push({ id: c.id.trim().toUpperCase(), color: c.color.trim() as any });
          }
        }
        if (batchList.length > 0) {
          return { kind: 'batch_color', batchColorUpdates: batchList };
        }
      }
    }

    // 2. まとめ撮り服形式: { "garments": [...] } または 服ドラフト配列
    if (parsed && typeof parsed === 'object') {
      const batchCandidates = Array.isArray((parsed as any).garments)
        ? (parsed as any).garments
        : Array.isArray(parsed) &&
          parsed.length > 0 &&
          ((parsed[0] as any)?.category === 'shirt' ||
            (parsed[0] as any)?.category === 'pants' ||
            ((parsed[0] as any)?.name !== undefined && (parsed[0] as any)?.id === undefined))
        ? parsed
        : null;

      if (batchCandidates && batchCandidates.length > 0) {
        return {
          kind: 'batch_garments',
          batchGarments: batchCandidates as BatchGarmentDraftItem[],
        };
      }
    }

    // 3. 単一アイテム形式
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof parsed.id === 'string' &&
      (parsed.category === 'shirt' || parsed.category === 'pants')
    ) {
      const cropBox = normalizeCropBox(parsed.cropBox) ?? null;
      return { kind: 'single', item: parsed, cropBox };
    }

    return {
      kind: 'invalid',
      error:
        '単一アイテム形式（id と category）、まとめ撮り形式（garments 配列）、または一括色更新形式（colorUpdates）を満たしていません。',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '構文エラー';
    return { kind: 'invalid', error: `JSON構文が不正または不完全です: ${msg}` };
  }
}

export const AiSyncView: React.FC = () => {
  const {
    mergedClosetData,
    wifeNgPairs,
    gasConfig,
    importCustomData,
    importBatchGarments,
    resetToDefaultData,
  } = useClosetStore();

  // Registration Mode ('single' or 'batch')
  const [registrationMode, setRegistrationMode] = useState<'single' | 'batch'>('single');

  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedBatchPrompt, setCopiedBatchPrompt] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [importStatus, setImportStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [isBackupOpen, setIsBackupOpen] = useState(false);

  // Photo state (Dedicated draft 1 slot)
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [currentBlob, setCurrentBlob] = useState<Blob | null>(null);
  const [isDraftRestored, setIsDraftRestored] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [imageUploadStatus, setImageUploadStatus] = useState<{
    type: 'idle' | 'uploading' | 'success' | 'error';
    text: string;
  }>({ type: 'idle', text: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2: 1-line optional memo & optional manual override
  const [optionalNote, setOptionalNote] = useState('');
  const [isManualOverrideOpen, setIsManualOverrideOpen] = useState(false);
  const [manualCategory, setManualCategory] = useState<'auto' | Category>('auto');
  const [manualItemName, setManualItemName] = useState('');
  const [manualSleeve, setManualSleeve] = useState('');

  // Step 3: Parsed draft item for confirmation & inline fine-tuning (Single mode)
  const [draftEditItem, setDraftEditItem] = useState<Partial<ClosetItem> | null>(null);
  const [draftCropBox, setDraftCropBox] = useState<GarmentCropBox | null>(null);
  const [applySmartCrop, setApplySmartCrop] = useState<boolean>(true);
  const [normalizedPreviewUrl, setNormalizedPreviewUrl] = useState<string | null>(null);
  const [draftBatchUpdates, setDraftBatchUpdates] = useState<ColorUpdateItem[] | null>(null);
  const [isCategorySwitched, setIsCategorySwitched] = useState(false);

  // Step 3: Batch garments drafts & toggles (Batch mode)
  const [draftBatchGarments, setDraftBatchGarments] = useState<BatchGarmentDraftItem[] | null>(null);
  const [batchIncludedFlags, setBatchIncludedFlags] = useState<boolean[]>([]);
  const [batchSmartCropFlags, setBatchSmartCropFlags] = useState<boolean[]>([]);
  const [batchNormalizedPreviews, setBatchNormalizedPreviews] = useState<(string | null)[]>([]);
  const [isApplyingBatch, setIsApplyingBatch] = useState(false);

  // Suggest next sequential IDs using getNextSequentialId
  const nextShirtId = getNextSequentialId(mergedClosetData.items, 'shirt');
  const nextPantsId = getNextSequentialId(mergedClosetData.items, 'pants');

  // Count unconfirmed color garments
  const unconfirmedColorCount = mergedClosetData.items.filter((item) => !item.color).length;

  // マウント時に専用下書き枠から復元（Geminiアプリ往復でのタブ再読み込み耐性）
  useEffect(() => {
    let isMounted = true;
    getDraftImage().then((draft) => {
      if (!isMounted) return;
      if (draft) {
        setCurrentBlob(draft.blob);
        setPreviewDataUrl(draft.dataUrl);
        setIsDraftRestored(true);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // 写真ファイル選択ハンドラー（クライアント圧縮 + 専用下書き枠へ1枠自動保存）
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingImage(true);
    setImageUploadStatus({ type: 'idle', text: '' });

    try {
      // 1. クライアント側で JPEG にリサイズ＆正規化 (まとめ撮りモードは長辺2000px、通常時は1200px, quality 0.85)
      const maxDimension = registrationMode === 'batch' ? 2000 : 1200;
      const { blob, dataUrl } = await processGarmentImage(file, maxDimension, 0.85);
      setCurrentBlob(blob);
      setPreviewDataUrl(dataUrl);
      setIsDraftRestored(false);

      // 2. 専用下書き枠に1枠のみ上書き保存
      await saveDraftImage(blob, dataUrl);
    } catch (err: unknown) {
      console.error('Image processing failed:', err);
      const errMsg = err instanceof Error ? err.message : '写真の処理に失敗しました。';
      setImageUploadStatus({
        type: 'error',
        text: errMsg,
      });
    } finally {
      setIsProcessingImage(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 下書き写真の明示的な取り消し・消去
  const handleClearPhoto = async () => {
    await clearDraftImage();
    setCurrentBlob(null);
    setPreviewDataUrl(null);
    setNormalizedPreviewUrl(null);
    setBatchNormalizedPreviews([]);
    setIsDraftRestored(false);
    setImageUploadStatus({ type: 'idle', text: '' });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // リアルタイムに JSON テキストを監視し、有効な単一アイテム、一括色更新、またはまとめ撮り服なら同期
  useEffect(() => {
    const parseRes = parseSyncInputJson(jsonInput);
    if (parseRes.kind === 'single' && parseRes.item) {
      setDraftEditItem(parseRes.item);
      setDraftCropBox(parseRes.cropBox ?? null);
      if (parseRes.cropBox && normalizeCropBox(parseRes.cropBox)) {
        setApplySmartCrop(true);
      }
      setDraftBatchUpdates(null);
      setDraftBatchGarments(null);
      setIsCategorySwitched(false);
    } else if (parseRes.kind === 'batch_color' && parseRes.batchColorUpdates) {
      setDraftBatchUpdates(parseRes.batchColorUpdates);
      setDraftEditItem(null);
      setDraftCropBox(null);
      setDraftBatchGarments(null);
      setIsCategorySwitched(false);
    } else if (parseRes.kind === 'batch_garments' && parseRes.batchGarments) {
      setDraftBatchGarments(parseRes.batchGarments);
      setBatchIncludedFlags((prev) => {
        if (prev.length === parseRes.batchGarments!.length) return prev;
        return parseRes.batchGarments!.map(() => true);
      });
      setBatchSmartCropFlags((prev) => {
        if (prev.length === parseRes.batchGarments!.length) return prev;
        return parseRes.batchGarments!.map(() => true);
      });
      setDraftEditItem(null);
      setDraftCropBox(null);
      setDraftBatchUpdates(null);
      setIsCategorySwitched(false);
    } else {
      setDraftEditItem(null);
      setDraftCropBox(null);
      setDraftBatchUpdates(null);
      setDraftBatchGarments(null);
      setIsCategorySwitched(false);
    }
  }, [jsonInput]);

  // 下書き写真と切り抜き設定の変更に応じて、リアルタイムに3:4正規化プレビューを生成（単一アイテム用）
  useEffect(() => {
    let isMounted = true;
    if (!previewDataUrl || typeof document === 'undefined') {
      setNormalizedPreviewUrl(null);
      return;
    }

    const effectiveCropBox =
      applySmartCrop && draftCropBox && normalizeCropBox(draftCropBox) ? draftCropBox : null;

    cropAndNormalizeGarmentImage(previewDataUrl, effectiveCropBox, 0.06, 0.85)
      .then((res) => {
        if (isMounted) {
          setNormalizedPreviewUrl(res.dataUrl);
        }
      })
      .catch((err) => {
        console.warn('Failed to generate 3:4 preview:', err);
        if (isMounted) {
          setNormalizedPreviewUrl(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [previewDataUrl, draftCropBox, applySmartCrop]);

  // 下書き写真と切り抜き設定の変更に応じて、リアルタイムに3:4正規化プレビューを生成（まとめ撮り複数服用）
  useEffect(() => {
    let isMounted = true;
    if (
      !previewDataUrl ||
      !draftBatchGarments ||
      draftBatchGarments.length === 0 ||
      typeof document === 'undefined'
    ) {
      setBatchNormalizedPreviews([]);
      return;
    }

    Promise.all(
      draftBatchGarments.map(async (draft, idx) => {
        const shouldCrop = batchSmartCropFlags[idx] !== false;
        const cropBox =
          shouldCrop && draft.cropBox && normalizeCropBox(draft.cropBox) ? draft.cropBox : null;
        try {
          const res = await cropAndNormalizeGarmentImage(previewDataUrl, cropBox, 0.06, 0.85);
          return res.dataUrl;
        } catch (err) {
          console.warn(`Failed to generate 3:4 preview for batch item ${idx}:`, err);
          return null;
        }
      })
    ).then((previews) => {
      if (isMounted) {
        setBatchNormalizedPreviews(previews);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [previewDataUrl, draftBatchGarments, batchSmartCropFlags]);

  // Step 3 単一確認パネルで種別を手動切替（相性3配列の自動クリア & 注記表示）
  const handleSwitchCategory = (targetCategory: Category) => {
    if (!draftEditItem || draftEditItem.category === targetCategory) return;
    const switched = switchDraftItemCategory(
      draftEditItem,
      targetCategory,
      mergedClosetData.items
    );
    setDraftEditItem(switched);
    setIsCategorySwitched(true);
    setJsonInput(JSON.stringify(switched, null, 2));
  };

  // Step 3 単一確認パネルでのインライン微修正
  const handleUpdateDraftField = <K extends keyof ClosetItem>(
    field: K,
    value: ClosetItem[K]
  ) => {
    if (!draftEditItem) return;
    const updated = { ...draftEditItem, [field]: value };
    setDraftEditItem(updated);
    setJsonInput(JSON.stringify(updated, null, 2));
  };

  // Step 3 単一寸法（GarmentMeasurements）の微修正ハンドラー
  const handleUpdateMeasurement = (key: keyof GarmentMeasurements, rawVal: string) => {
    if (!draftEditItem) return;
    const currentM: GarmentMeasurements = { ...(draftEditItem.measurements || {}) };
    if (rawVal.trim() === '') {
      delete currentM[key];
    } else {
      const num = parseFloat(rawVal);
      if (!isNaN(num)) {
        currentM[key] = num;
      }
    }
    const hasKeys = Object.keys(currentM).length > 0;
    const updatedM = hasKeys ? currentM : undefined;
    handleUpdateDraftField('measurements', updatedM);
  };

  // Step 3 まとめ撮り確認パネルでの種別切替ハンドラー
  const handleSwitchBatchItemCategory = (idx: number, targetCategory: Category) => {
    if (!draftBatchGarments) return;
    const item = draftBatchGarments[idx];
    if (item.category === targetCategory) return;
    const switched = switchDraftItemCategory(item, targetCategory, mergedClosetData.items);
    const nextList = [...draftBatchGarments];
    nextList[idx] = switched as BatchGarmentDraftItem;
    setDraftBatchGarments(nextList);
    setJsonInput(JSON.stringify({ garments: nextList }, null, 2));
  };

  // Step 3 まとめ撮り確認パネルでのフィールド更新ハンドラー
  const handleUpdateBatchItemField = <K extends keyof BatchGarmentDraftItem>(
    idx: number,
    field: K,
    value: BatchGarmentDraftItem[K]
  ) => {
    if (!draftBatchGarments) return;
    const nextList = [...draftBatchGarments];
    nextList[idx] = { ...nextList[idx], [field]: value };
    setDraftBatchGarments(nextList);
    setJsonInput(JSON.stringify({ garments: nextList }, null, 2));
  };

  // Step 3 まとめ撮り確認パネルでの寸法更新ハンドラー
  const handleUpdateBatchMeasurement = (
    idx: number,
    key: keyof GarmentMeasurements,
    rawVal: string
  ) => {
    if (!draftBatchGarments) return;
    const target = draftBatchGarments[idx];
    const currentM: GarmentMeasurements = { ...(target.measurements || {}) };
    if (rawVal.trim() === '') {
      delete currentM[key];
    } else {
      const num = parseFloat(rawVal);
      if (!isNaN(num)) {
        currentM[key] = num;
      }
    }
    const hasKeys = Object.keys(currentM).length > 0;
    const updatedM = hasKeys ? currentM : undefined;
    handleUpdateBatchItemField(idx, 'measurements', updatedM);
  };

  // プロンプトの生成とコピー（通常モード／まとめ撮りモード）
  const handleCopyPromptAndData = () => {
    const allShirts = mergedClosetData.items.filter((item) => item.category === 'shirt');
    const allPants = mergedClosetData.items.filter((item) => item.category === 'pants');

    const shirtsSummary = allShirts
      .map(
        (s) =>
          `- [${s.id}] ${s.name}（色: ${s.color ?? '未設定'}、${s.seasonSleeve}、ドレス度${s.dressScore}、快適度${s.comfortScore}）: ${s.notes}`
      )
      .join('\n');

    const pantsSummary = allPants
      .map(
        (p) =>
          `- [${p.id}] ${p.name}（色: ${p.color ?? '未設定'}、${p.seasonSleeve}、ドレス度${p.dressScore}、快適度${p.comfortScore}）: ${p.notes}`
      )
      .join('\n');

    const wifeNgSummary =
      wifeNgPairs.length > 0
        ? wifeNgPairs.map((ng) => `- ${ng.shirtId} × ${ng.pantsId}: ${ng.reason}`).join('\n')
        : 'なし';

    // まとめ撮りモード専用プロンプトの生成
    if (registrationMode === 'batch') {
      const promptText = `あなたは40代後半男性（オフィス出社・リモートワーク併用）専属のプロスタイリストAIです。
添付された【複数着（推奨2〜3着・最大3着）が写った写真】を解析し、それぞれの服について相性・NG・寸法・切り抜き領域を判定した【まとめ撮り一括登録用JSON】を出力してください。
（※各服のID採番および双方向リンク更新はアプリ側で決定論的に自動マージされます）

### 登録写真の基準化指示（色・寸法・切り抜き）
1. **ホワイトバランスと12色パレット判定**:
   - 写真内に置かれたA4白用紙（210×297mm、白）を全着共通のホワイトバランス基準とし、照明の色かぶりを差し引いたうえで各服の色（color）を判定してください。
   - 各服の色は必ず次の【12色パレット】から1つ選択してください:
     ${GARMENT_COLOR_PALETTE.join('／')}
   - 色の境界判定アンカー:
${GARMENT_COLOR_ANCHOR_GUIDE}
   - 各服のアイテム名（name）の色表記も、12色パレットの語彙に寄せて命名してください（例: 「ネイビー」ではなく「濃紺」）。

2. **A4用紙を基準とした実寸（cm）推定**:
   - 写真内のA4白用紙（長辺297mm × 短辺210mm）を共通の物差しとして、各服の主要寸法（実寸目安）を cm（10〜200cm、0.5cm刻み）で推定し、"measurements" に格納してください。
     - シャツ（shirt）の場合:
       - bodyLength: 着丈（衿リブ下〜裾）
       - chestWidth: 身幅（両脇下の直線距離）
       - shoulderWidth: 肩幅（両肩先の直線距離）
       - sleeveLength: 袖丈（肩先〜袖口）
     - パンツ（pants）の場合:
       - waist: ウエスト内周目安（平置き×2）
       - inseam: 股下（股の十字縫い目〜裾）
       - totalLength: 総丈（ウエスト上端〜裾）
       - hemWidth: 裾幅（裾の直線距離）
   - 写真内にA4用紙が写っていない場合は推定せず、"measurements": null としてください（推定値は買い物比較用の目安です）。

3. **着ごとの服領域座標（cropBox）の出力**:
   - 写真からA4用紙や周囲の床・背景、および【隣の服】を除いた「その服本体のみの外接矩形」を、画像全体の幅・高さを 0〜1000 とした正規化整数座標で "cropBox" として各着ごとに出力してください:
     {"ymin": 上端0..1000, "xmin": 左端0..1000, "ymax": 下端0..1000, "xmax": 右端0..1000}
   - 服領域が判別できない場合は "cropBox": null としてください。

### 服の検出と判定指示
- 写真内のすべての服（1〜3着、最大3着）を検出し、左から順（または上から順）に配列 "garments" として出力してください。
- 各服のカテゴリ: シャツ（shirt）かパンツ（pants）かを写真から自動判定してください。
- 各服のスコア判定: 40代男性のTPO（出社・リモート）に応じたドレス度（dressScore: 1.0〜5.0）、快適度（comfortScore: 1.0〜5.0）を写真の生地感やシルエットから付与してください。
- 各服の季節・袖丈（seasonSleeve）: 写真からシャツなら「長袖・通年 / 春夏秋・七分袖 / 春夏・半袖 / 秋冬・長袖」、パンツなら「通年 / 春夏秋 / 春夏 / 秋冬」を判定してください。
- ユーザー補足メモ: ${optionalNote.trim() || '特になし（写真からすべて判定してください）'}

### 組み合わせる相手の現有ワードローブ一覧
【現有シャツ一覧】
${shirtsSummary}

【現有パンツ一覧】
${pantsSummary}

【登録済み 奥様NGペア（これらは絶対に推薦せずNGとして扱うこと）】
${wifeNgSummary}

### 判定・スタイリング絶対原則（奥様からのダメ出しを完全回避すること）
1. **同系色・濃紺同士の禁止**: 上下ともに濃紺・インディゴになる組み合わせ（例: 濃紺シャツ × 濃紺系パンツ）は作業着・パジャマに見えるため絶対NG（ngIdsに追加、ngReasonを明記）。
2. **淡青×青デニムの禁止**: サックス（淡青）にブルーデニム（ブルー）を合わせると全身が水色で繋がり休日のおじさん感が出るため絶対NG。
3. **淡色×淡色の膨張禁止**: 生成りに淡いグレージュやライトグレーを合わせると輪郭がぼやけて膨張して見えるため絶対NG。
4. **柄×柄の完全禁止**: チェック・ストライプ・小紋柄シャツと柄パンツは絶対NG。柄パンツは白無地シャツで消化すること。
5. **TPO分離と出社スウェット除外**:
   - 出社時（officeRecommendIds）: ドレス度 3.5 以上を優先。スウェット・ジョガー系（ドレス度 3.0 未満）は出社候補から除外。
   - リモート時（remoteRecommendIds）: 快適度 4.0 以上を優先。
6. **買い足しハブ（黒スラックス等）の優遇**: もし黒の綺麗めテーパードスラックスが追加された場合は、出社相手に困っていたシャツの出社第1〜第2候補ハブとして積極的に組み込んでください。
7. **排他制約と相性の対象範囲（重要）**:
   - officeRecommendIds / remoteRecommendIds と ngIds に同一のIDを重複して含めないでください。
   - **バッチ内の服同士の相性は含めず、現存する相手カテゴリの服（現有シャツ一覧／現有パンツ一覧）のIDのみを指定してください。**

### 出力スキーマ厳密制約（まとめ撮り一括登録用JSON）
\`\`\`json
{
  "garments": [
    {
      "category": "shirt または pants",
      "name": "12色パレットの語彙に寄せた適切な日本語名称",
      "color": "12色パレット（白／生成り／黒／チャコール／ミディアムグレー／ライトグレー／グレージュ／濃紺／ブルー／淡青／オリーブ／ブラウン）から1つ選択",
      "seasonSleeve": "写真から判定した季節・袖丈（シャツ: 長袖・通年 / 春夏秋・七分袖 / 春夏・半袖 / 秋冬・長袖、パンツ: 通年 / 春夏秋 / 春夏 / 秋冬）",
      "dressScore": 4.0,
      "comfortScore": 4.0,
      "measurements": {
        "bodyLength": 72.0,
        "chestWidth": 54.0,
        "shoulderWidth": 46.0,
        "sleeveLength": 60.0
      },
      "cropBox": {
        "ymin": 120,
        "xmin": 180,
        "ymax": 890,
        "xmax": 450
      },
      "officeRecommendIds": ["相手カテゴリの現存ID"],
      "remoteRecommendIds": ["相手カテゴリの現存ID"],
      "ngIds": ["相手カテゴリの現存ID"],
      "ngReason": "なし（またはNG理由）",
      "notes": "写真から読み取った素材感・シルエットの簡潔なメモ"
    }
  ]
}
\`\`\`

※重要制約:
- 検出する服は写真内の最大3着までとしてください（1〜3着）。
- ID（id）および画像パス（imageUrl）はアプリ側で決定論的に連番採番・割り当てを行うため、Gemini側での出力は不要です（出力されていてもアプリ側で安全に再採番されます）。
- A4用紙が確認できない場合、measurements は null としてください。
- 出力形式: 説明文や前置きは一切含めず、上記スキーマを満たす単一の有効なJSONコードブロック（\`\`\`json ... \`\`\`）のみを出力してください。`;

      navigator.clipboard.writeText(promptText);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 3000);
      return;
    }

    // 手動指定がある場合のインストラクション
    const categoryInstruction =
      manualCategory !== 'auto'
        ? `- カテゴリ指定: 必ず "${manualCategory}"（${manualCategory === 'shirt' ? 'シャツ' : 'パンツ'}）として判定してください。`
        : `- カテゴリ判定: 添付の写真を見て、シャツ（shirt）かパンツ（pants）かを自動判定してください。`;

    const nameInstruction = manualItemName.trim()
      ? `- アイテム名指定: "${manualItemName.trim()}"`
      : `- アイテム名判定: 写真の視覚的特徴（色・トーン・柄・素材感・シルエット等）から適切な日本語アイテム名を命名してください。`;

    const sleeveInstruction = manualSleeve
      ? `- 季節・袖丈指定: "${manualSleeve}"`
      : `- 季節・袖丈判定: 写真から季節・袖丈（シャツなら「長袖・通年」「春夏秋・七分袖」「春夏・半袖」「秋冬・長袖」、パンツなら「通年」「春夏秋」「春夏」「秋冬」のいずれか）を判定してください。`;

    const promptText = `あなたは40代後半男性（オフィス出社・リモートワーク併用）専属のプロスタイリストAIです。
添付された服の写真を解析し、以下の指示および現在のワードローブ一覧と照らし合わせ、相性・NGを判定した【新規1着分のみのJSONオブジェクト】を出力してください。
（※全体データではなく、新規追加する1着分のみを単一JSONオブジェクトとして出力してください。双方向のリンク更新はアプリ側で自動マージされます）

### 登録写真の基準化指示（色・寸法・切り抜き）
1. **ホワイトバランスと12色パレット判定**:
   - 写真内に置かれたA4白用紙（210×297mm、白）をホワイトバランスの基準とし、照明の色かぶりを差し引いたうえで服の色（color）を判定してください。
   - 服の色は必ず次の【12色パレット】から1つ選択してください:
     ${GARMENT_COLOR_PALETTE.join('／')}
   - 色の境界判定アンカー:
${GARMENT_COLOR_ANCHOR_GUIDE}
   - 新規アイテムのアイテム名（name）の色表記も、12色パレットの語彙に寄せて命名してください（例: 「ネイビー」ではなく「濃紺」）。

2. **A4用紙を基準とした実寸（cm）推定**:
   - 写真内にA4白用紙（長辺297mm × 短辺210mm）が確認できる場合、用紙を物差しとして主要寸法（実寸目安）を cm（10〜200cm、0.5cm刻み）で推定し、"measurements" に格納してください。
     - シャツ（shirt）の場合:
       - bodyLength: 着丈（衿リブ下〜裾）
       - chestWidth: 身幅（両脇下の直線距離）
       - shoulderWidth: 肩幅（両肩先の直線距離）
       - sleeveLength: 袖丈（肩先〜袖口）
     - パンツ（pants）の場合:
       - waist: ウエスト内周目安（平置き×2）
       - inseam: 股下（股の十字縫い目〜裾）
       - totalLength: 総丈（ウエスト上端〜裾）
       - hemWidth: 裾幅（裾の直線距離）
   - 写真内にA4用紙が写っていない場合は推定せず、"measurements": null としてください（推定値は買い物比較用の目安です）。

3. **服の領域座標（cropBox）の出力**:
   - 写真からA4用紙や周囲の床・背景を除いた「服本体のみの外接矩形」を、画像全体の幅・高さを 0〜1000 とした正規化整数座標で "cropBox" として出力してください:
     {"ymin": 上端0..1000, "xmin": 左端0..1000, "ymax": 下端0..1000, "xmax": 右端0..1000}
   - 服領域が判別できない場合は "cropBox": null としてください。

### 新規追加する服の判定指示
${categoryInstruction}
- IDと画像パスの決定順序:
  - シャツ（shirt）と判定した場合: "id": "${nextShirtId}", "imageUrl": "/images/${nextShirtId}.jpg"
  - パンツ（pants）と判定した場合: "id": "${nextPantsId}", "imageUrl": "/images/${nextPantsId}.jpg"
${nameInstruction}
${sleeveInstruction}
- スコア判定: 40代男性のTPO（出社・リモート）に応じたドレス度（dressScore: 1.0〜5.0）、快適度（comfortScore: 1.0〜5.0）を写真の生地感やシルエットから付与してください。
- ユーザー補足メモ: ${optionalNote.trim() || '特になし（写真からすべて判定してください）'}

### 組み合わせる相手の現有ワードローブ一覧
【現有シャツ一覧】
${shirtsSummary}

【現有パンツ一覧】
${pantsSummary}

【登録済み 奥様NGペア（これらは絶対に推薦せずNGとして扱うこと）】
${wifeNgSummary}

### 判定・スタイリング絶対原則（奥様からのダメ出しを完全回避すること）
1. **同系色・濃紺同士の禁止**: 上下ともに濃紺・インディゴになる組み合わせ（例: S1 濃紺 × P1/P5/P6/P8/P11 濃紺系パンツ）は作業着・パジャマに見えるため絶対NG（ngIdsに追加、ngReasonを明記）。
2. **淡青×青デニムの禁止**: S3 サックス（淡青）にブルーデニム（P4/P7/P15: ブルー）を合わせると全身が水色で繋がり休日のおじさん感が出るため絶対NG。
3. **淡色×淡色の膨張禁止**: S8 生成りに淡いグレージュやライトグレー（P3/P9/P13）を合わせると輪郭がぼやけて膨張して見えるため絶対NG。
4. **柄×柄の完全禁止**: チェック・ストライプ・小紋柄シャツ（S5/S6/S9）と柄パンツ（P5/P10/P11）は絶対NG。柄パンツは白無地シャツ（S2/S4/S7）で消化すること。
5. **TPO分離と出社スウェット除外**:
   - 出社時（officeRecommendIds）: ドレス度 3.5 以上を優先。スウェット・ジョガー系（P2/P4/P13/P14/P15：ドレス度 3.0 未満）は出社候補から除外。
   - リモート時（remoteRecommendIds）: 快適度 4.0 以上を優先。
6. **買い足しハブ（黒スラックス等）の優遇**: もし黒の綺麗めテーパードスラックスが追加された場合は、出社相手に困っていたシャツの出社第1〜第2候補ハブとして積極的に組み込んでください。
7. **排他制約**: officeRecommendIds / remoteRecommendIds と ngIds に同一のIDを重複して含めないでください。相手カテゴリの現存IDのみを指定してください。

### 出力スキーマ厳密制約（新規1着分の単一JSONオブジェクトのみを出力すること）
\`\`\`json
{
  "id": "写真からシャツと判定した場合は \\"${nextShirtId}\\"、パンツと判定した場合は \\"${nextPantsId}\\"",
  "category": "写真から判定した種別（\\"shirt\\" または \\"pants\\"）",
  "name": "12色パレットの語彙に寄せた適切な日本語名称",
  "color": "12色パレット（白／生成り／黒／チャコール／ミディアムグレー／ライトグレー／グレージュ／濃紺／ブルー／淡青／オリーブ／ブラウン）から1つ選択",
  "imageUrl": "写真からシャツと判定した場合は \\"/images/${nextShirtId}.jpg\\"、パンツと判定した場合は \\"/images/${nextPantsId}.jpg\\"",
  "seasonSleeve": "写真から判定した季節・袖丈（シャツ: 長袖・通年 / 春夏秋・七分袖 / 春夏・半袖 / 秋冬・長袖、パンツ: 通年 / 春夏秋 / 春夏 / 秋冬）",
  "dressScore": 4.0,
  "comfortScore": 4.0,
  "measurements": {
    "bodyLength": 72.0,
    "chestWidth": 54.0,
    "shoulderWidth": 46.0,
    "sleeveLength": 60.0
  },
  "cropBox": {
    "ymin": 120,
    "xmin": 180,
    "ymax": 890,
    "xmax": 820
  },
  "officeRecommendIds": ["相手カテゴリの現存ID"],
  "remoteRecommendIds": ["相手カテゴリの現存ID"],
  "ngIds": ["相手カテゴリの現存ID"],
  "ngReason": "なし（またはNG理由）",
  "notes": "写真から読み取った素材感・シルエット・役割の簡潔なメモ"
}
\`\`\`

※重要制約（アプリの自動検証必須条件）:
- シャツ（shirt）と判定した場合は、必ず id: "${nextShirtId}"、imageUrl: "/images/${nextShirtId}.jpg" としてください。
- パンツ（pants）と判定した場合は、必ず id: "${nextPantsId}"、imageUrl: "/images/${nextPantsId}.jpg" としてください。
- category と id の接頭辞（S / P）の不一致は、アプリのデータ保護検証によって自動で拒否されます。
- A4用紙が確認できない場合、measurements は null としてください。
- 出力形式: 説明文や前置きは一切含めず、上記スキーマを満たす単一の有効なJSONコードブロック（\`\`\`json ... \`\`\`）のみを出力してください。`;

    navigator.clipboard.writeText(promptText);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 3000);
  };

  // 既存服の色パレット一括相談プロンプトの生成とコピー
  const handleCopyBatchColorPrompt = () => {
    const items = mergedClosetData.items;
    const itemsList = items
      .map(
        (item) =>
          `- [${item.id}] ${item.name}（カテゴリ: ${
            item.category === 'shirt' ? 'シャツ' : 'パンツ'
          }、現在の色: ${item.color || '未確定'}）: ${item.notes || 'メモなし'}`
      )
      .join('\n');

    const promptText = `あなたは40代後半男性専属のプロスタイリストAIです。
以下は現在アプリに登録されている全${items.length}着の服リストです。
各アイテムの名称・メモ・カテゴリから、照明の色かぶりや曖昧さを排除し、下記の12色パレットおよび境界判定アンカーに最も合致する【確定色】を判定してください。

### 12色パレット
${GARMENT_COLOR_PALETTE.join('／')}

### 境界判定アンカー（色の基準）
${GARMENT_COLOR_ANCHOR_GUIDE}

### 対象アイテム一覧（全${items.length}着）
${itemsList}

### 出力スキーマ厳密制約（事故防止ルール・名前保護）
1. 各要素は必ず "id" と "color" の2項目のみとし、"name" などの他フィールドは絶対に出力しないでください（名前の書き換え事故を完全に防止するためです）。
2. 色は必ず12色パレット（${GARMENT_COLOR_PALETTE.join('／')}）から選んでください。「ネイビー」は「濃紺」に統合されているため「濃紺」を指定してください。
3. 出力形式: 説明文や前置きは含めず、以下のJSONコードブロックのみを出力してください。
\`\`\`json
{
  "colorUpdates": [
    { "id": "S1", "color": "濃紺" },
    { "id": "S2", "color": "白" }
  ]
}
\`\`\``;

    navigator.clipboard.writeText(promptText);
    setCopiedBatchPrompt(true);
    setTimeout(() => setCopiedBatchPrompt(false), 3000);
  };

  // Step 3: JSON適用・自動マージ・写真の本保存・下書き消去・GASアップロード連動
  const handleApplyJson = async () => {
    setImportStatus(null);
    const parseRes = parseSyncInputJson(jsonInput);

    // 一括色更新の適用
    if (parseRes.kind === 'batch_color') {
      const payload = JSON.stringify({
        colorUpdates: parseRes.batchColorUpdates ?? [],
      });
      const res = importCustomData(payload);
      if (res.success) {
        setImportStatus({
          type: 'success',
          message: `全${res.updatedPeersCount || 0}着の色パレットを一括更新しました！（既存のアイテム名・相性は保護されています）`,
        });
        setJsonInput('');
        setDraftBatchUpdates(null);
      } else {
        setImportStatus({
          type: 'error',
          message: res.error || '色パレット一括更新に失敗しました。形式を確認してください。',
        });
      }
      return;
    }

    // 単一アイテムの適用
    if (!parseRes.item || parseRes.kind !== 'single') {
      setImportStatus({
        type: 'error',
        message: parseRes.error || '有効な単一アイテムのJSONテキストを貼り付けてください。',
      });
      return;
    }

    // 微調整中の draftEditItem を採用
    const candidateItem = draftEditItem ? { ...draftEditItem } : { ...parseRes.item };

    // 寸法値の健全化（10〜200cmの範囲外があれば除去・0.5cm刻み正規化）
    candidateItem.measurements = validateGarmentMeasurements(
      candidateItem.measurements,
      candidateItem.category
    );

    // cropBox は画像切り抜き用メタデータのため、アイテムスキーマから除去
    delete (candidateItem as any).cropBox;

    const jsonString = JSON.stringify(candidateItem);
    const res = importCustomData(jsonString);

    if (res.success) {
      const addedItem = res.addedItem;
      let extraMsg = '';

      // 写真の下書き本保存・3:4正規化・GASアップロード・下書き消去
      if (currentBlob && addedItem) {
        try {
          const effectiveCropBox =
            applySmartCrop && draftCropBox && normalizeCropBox(draftCropBox) ? draftCropBox : null;
          let finalBlob = currentBlob;
          let finalDataUrl = previewDataUrl;
          let isNormalized = false;

          if (previewDataUrl && typeof document !== 'undefined') {
            try {
              const normalized = await cropAndNormalizeGarmentImage(
                previewDataUrl,
                effectiveCropBox,
                0.06,
                0.85
              );
              finalBlob = normalized.blob;
              finalDataUrl = normalized.dataUrl;
              isNormalized = true;
            } catch (cropErr) {
              console.warn('Smart crop failed, fallback to original blob:', cropErr);
            }
          }

          // 1. 確定したIDで画像を本保存ストアへ永続化 (0ms)
          await saveImageBlob(addedItem.id, finalBlob, Date.now());

          // 2. 専用下書き枠を消去（中断ゴミの蓄積防止）
          await clearDraftImage();

          const label = isNormalized ? '3:4正規化版' : '元画像フォールバック';

          // 3. GAS 設定がある場合は Google ドライブ正本フォルダへ自動アップロード
          if (gasConfig.webAppUrl && finalDataUrl) {
            setImageUploadStatus({
              type: 'uploading',
              text: `Google ドライブへ「${addedItem.id}.jpg（${label}）」を自動アップロード中...`,
            });
            uploadImageToGas({
              webAppUrl: gasConfig.webAppUrl,
              secretToken: gasConfig.secretToken,
              itemId: addedItem.id,
              dataUrl: finalDataUrl,
            }).then((uploadRes) => {
              if (uploadRes.ok) {
                setImageUploadStatus({
                  type: 'success',
                  text: `Google ドライブへ「${addedItem.id}.jpg（${label}）」として自動保存しました！`,
                });
              } else {
                setImageUploadStatus({
                  type: 'error',
                  text: `ドライブ保存エラー: ${uploadRes.error || '通信エラー'}（端末内には保存済みです）`,
                });
              }
            });
            extraMsg = isNormalized
              ? '（Google ドライブへ3:4正規化画像を自動アップロード中）'
              : '（※画像正規化に失敗したため、Google ドライブへ元画像を自動アップロード中）';
          } else {
            extraMsg = isNormalized
              ? `（端末内 IndexedDB に「${addedItem.id}（3:4正規化版）」として保存完了）`
              : `（※画像正規化に失敗したため、端末内 IndexedDB に「${addedItem.id}（元画像）」として保存完了）`;
          }
        } catch (imgErr: unknown) {
          console.error('Failed to finalize draft image:', imgErr);
        }
      }

      const colorStatusNote = !addedItem?.color
        ? addedItem?.notes?.includes('色の目安：')
          ? '（色未確定・メモに目安記録済）'
          : '（色未確定）'
        : '';

      setImportStatus({
        type: 'success',
        message: addedItem
          ? `「${addedItem.name} (${addedItem.id})」${colorStatusNote}を追加し、相手アイテム ${res.updatedPeersCount || 0}着の相性リストへ自動マージ＆クラウド同期を開始しました！ ${extraMsg}`
          : 'クローゼットデータを適用し、保存しました！',
      });

      // フォームのクリーンアップ
      setJsonInput('');
      setDraftEditItem(null);
      setDraftCropBox(null);
      setNormalizedPreviewUrl(null);
      setCurrentBlob(null);
      setPreviewDataUrl(null);
      setIsDraftRestored(false);
      setOptionalNote('');
      setIsCategorySwitched(false);
    } else {
      setImportStatus({
        type: 'error',
        message: res.error || 'JSONの検証に失敗しました。形式を確認してください。',
      });
    }
  };

  // Step 3: まとめ撮り服の一括マージ・保存・画像処理ハンドラー
  const handleApplyBatchGarments = async () => {
    if (!draftBatchGarments || draftBatchGarments.length === 0) return;
    setImportStatus(null);
    setIsApplyingBatch(true);

    try {
      const result = importBatchGarments(draftBatchGarments, batchIncludedFlags);

      if (!result.valid && result.appliedCount === 0) {
        setImportStatus({
          type: 'error',
          message: result.error || 'まとめ撮り一括登録の検証に失敗しました。',
        });
        return;
      }

      // 適用成功した着の画像処理（3:4正規化プレビュー保存およびGoogleドライブ同期）
      const appliedResults = result.results.filter(
        (r) => r.status === 'applied' && r.assignedId && r.item
      );

      let uploadSuccessCount = 0;
      let uploadFailCount = 0;

      if (previewDataUrl && appliedResults.length > 0) {
        for (let i = 0; i < result.results.length; i++) {
          const resItem = result.results[i];
          if (resItem.status !== 'applied' || !resItem.assignedId) continue;

          const draft = draftBatchGarments[i];
          const shouldCrop = batchSmartCropFlags[i] !== false;
          const effectiveCropBox =
            shouldCrop && draft?.cropBox && normalizeCropBox(draft.cropBox)
              ? draft.cropBox
              : null;

          let finalBlob = currentBlob;
          let finalDataUrl = previewDataUrl;
          let isNormalized = false;

          try {
            const normalized = await cropAndNormalizeGarmentImage(
              previewDataUrl,
              effectiveCropBox,
              0.06,
              0.85
            );
            finalBlob = normalized.blob;
            finalDataUrl = normalized.dataUrl;
            isNormalized = true;
          } catch (cropErr) {
            console.warn(`Smart crop failed for ${resItem.assignedId}, fallback to original blob:`, cropErr);
          }

          // 1. 確定したIDで画像を本保存ストア（IndexedDB）へ永続化 (0ms)
          if (finalBlob) {
            await saveImageBlob(resItem.assignedId, finalBlob, Date.now());
          }

          // 2. GAS 設定がある場合は Google ドライブ正本フォルダへ自動アップロード（直列進行・進捗表示）
          if (gasConfig.webAppUrl && finalDataUrl) {
            const label = isNormalized ? '3:4正規化版' : '元画像フォールバック';
            setImageUploadStatus({
              type: 'uploading',
              text: `Google ドライブへ「${resItem.assignedId}.jpg（${label}）」を一括アップロード中 (${uploadSuccessCount + uploadFailCount + 1}/${appliedResults.length}着)...`,
            });
            try {
              const uploadRes = await uploadImageToGas({
                webAppUrl: gasConfig.webAppUrl,
                secretToken: gasConfig.secretToken,
                itemId: resItem.assignedId,
                dataUrl: finalDataUrl,
              });
              if (uploadRes.ok) {
                uploadSuccessCount++;
              } else {
                uploadFailCount++;
              }
            } catch (uErr) {
              uploadFailCount++;
            }
          }
        }
      }

      if (gasConfig.webAppUrl && appliedResults.length > 0) {
        if (uploadFailCount === 0) {
          setImageUploadStatus({
            type: 'success',
            text: `Google ドライブへ全${uploadSuccessCount}着の画像を保存しました！`,
          });
        } else {
          setImageUploadStatus({
            type: 'error',
            text: `ドライブ保存: ${uploadSuccessCount}着成功 / ${uploadFailCount}着失敗（端末内 IndexedDB には全着保存済みです）`,
          });
        }
      }

      // 部分適用（一部失敗）か全着成功かの判定
      const remaining = result.remainingDrafts ?? [];
      if (remaining.length > 0) {
        // 部分適用: 失敗した着を下書きに残し、元画像は消去しない（再試行可能）
        setJsonInput(JSON.stringify({ garments: remaining }, null, 2));
        setDraftBatchGarments(remaining);
        setBatchIncludedFlags(remaining.map(() => true));
        setBatchSmartCropFlags(remaining.map(() => true));

        setImportStatus({
          type: 'success',
          message: `一部の服（${result.appliedCount}着）を登録しました！ 失敗した ${remaining.length}着 は下書きに残しています。内容を確認・修正して再登録してください。`,
        });
      } else {
        // 全着成功: 下書き写真を消去しフォームをリセット
        await clearDraftImage();
        setJsonInput('');
        setDraftBatchGarments(null);
        setBatchIncludedFlags([]);
        setBatchSmartCropFlags([]);
        setBatchNormalizedPreviews([]);
        setCurrentBlob(null);
        setPreviewDataUrl(null);
        setIsDraftRestored(false);
        setOptionalNote('');

        const unconfirmedCount = appliedResults.filter((r) => r.unconfirmedColorHint || r.warning).length;
        const colorNoteMsg =
          unconfirmedCount > 0
            ? `（うち${unconfirmedCount}着は色未確定として登録し、メモに目安を追記しました。後から一括色相談で確定できます）`
            : '';

        setImportStatus({
          type: 'success',
          message: `全${result.appliedCount}着を一括マージ・保存しました！ ${colorNoteMsg}`,
        });
      }
    } catch (err: unknown) {
      console.error('Failed to apply batch garments:', err);
      const msg = err instanceof Error ? err.message : 'まとめ撮り登録に失敗しました。';
      setImportStatus({
        type: 'error',
        message: msg,
      });
    } finally {
      setIsApplyingBatch(false);
    }
  };

  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(mergedClosetData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'closet.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyMergedJson = () => {
    navigator.clipboard.writeText(JSON.stringify(mergedClosetData, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 3000);
  };

  const handleReset = () => {
    if (window.confirm('初期マスターデータ（全24着）に戻しますか？')) {
      resetToDefaultData();
      setImportStatus({
        type: 'success',
        message: '初期マスターデータにリセットしました。',
      });
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Header card */}
      <div className="p-4 bg-gradient-to-r from-blue-950/70 via-slate-900 to-indigo-950/70 border border-blue-800/50 rounded-2xl shadow-xl">
        <div className="flex items-center gap-2 text-blue-400 font-bold text-sm mb-1">
          <Sparkles className="w-4 h-4 text-blue-400" />
          <span>服の追加・AIおまかせ登録 (Add & AI Sync)</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          新しい服の写真を選ぶだけで、Gemini が種別・A4参照の色パレット・寸法・名前・切り抜き範囲・既存服との相性を全自動判定します。事前の種別選択や名前入力は不要です。
        </p>
      </div>

      {/* Step 1: Photo selection, draft storage & restore */}
      <section className="bg-slate-800/80 border border-slate-700/70 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
            1
          </span>
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <Camera className="w-4 h-4 text-sky-400" />
            服の写真を選択（自動下書き保存）
          </h3>
        </div>

        {/* Registration Mode Switcher */}
        <div className="pl-8">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setRegistrationMode('single')}
              className={`min-h-[44px] py-2 px-3 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition-all ${
                registrationMode === 'single'
                  ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-950 ring-1 ring-blue-400'
                  : 'bg-slate-900/60 text-slate-400 border-slate-700 hover:text-white'
              }`}
            >
              <span>👕 1着ずつ登録（通常）</span>
            </button>
            <button
              type="button"
              onClick={() => setRegistrationMode('batch')}
              className={`min-h-[44px] py-2 px-3 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition-all ${
                registrationMode === 'batch'
                  ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-950 ring-1 ring-blue-400'
                  : 'bg-slate-900/60 text-slate-400 border-slate-700 hover:text-white'
              }`}
            >
              <span>🧥 まとめ撮り一括登録（最大3着）</span>
            </button>
          </div>
        </div>

        {/* Dynamic A4 Paper & Photography Guide Banner */}
        <div className="pl-8">
          {registrationMode === 'single' ? (
            <div className="p-2.5 bg-blue-950/40 border border-blue-800/40 rounded-xl text-xs text-blue-300 leading-relaxed">
              💡 服の隣に <strong>A4の白い紙（210×297mm）</strong> を置いて撮影すると、AIがA4用紙を参照して色判定（色かぶり考慮）・実寸（cm）推定・服だけの自動切り抜き（3:4配置）を行います。
            </div>
          ) : (
            <div className="p-2.5 bg-blue-950/40 border border-blue-800/40 rounded-xl text-xs text-blue-300 leading-relaxed">
              💡 <strong>服同士を重ねず、少し間を空けて並べ</strong>、その隣に <strong>A4の白い紙（210×297mm）を1枚</strong> 置いて撮影してください（推奨2〜3着・最大3着）。AIがA4用紙を全着共通の基準として色判定（色かぶり考慮）・実寸（cm）推定・着ごとの自動切り抜き（3:4配置）を行います。
            </div>
          )}
        </div>

        <p className="text-xs text-slate-300 leading-relaxed pl-8">
          スマホの写真を選択またはカメラ撮影します。写真はアプリ内の専用下書き枠に自動保存されるため、Gemini アプリに切り替えて戻っても消えません。
        </p>

        <div className="pl-8 space-y-3">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept="image/*"
            className="hidden"
          />

          <div className="flex flex-wrap gap-2.5 items-center">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessingImage}
              className="min-h-[44px] py-2.5 px-4 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 text-white shadow-lg shadow-sky-900/40 flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
            >
              {isProcessingImage ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>画像を処理中...</span>
                </>
              ) : (
                <>
                  <Camera className="w-4 h-4" />
                  <span>{previewDataUrl ? '📷 写真を変更する' : '📷 写真を選択 / 撮影する'}</span>
                </>
              )}
            </button>

            {previewDataUrl && (
              <button
                type="button"
                onClick={handleClearPhoto}
                className="min-h-[44px] py-2.5 px-3 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-800/60 flex items-center justify-center gap-1.5 transition-all"
              >
                <X className="w-4 h-4 text-rose-400" />
                <span>写真を取り消す</span>
              </button>
            )}
          </div>

          {/* Photo Preview & Draft Status */}
          {previewDataUrl && (
            <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-700/60 flex items-center gap-3">
              <div className="w-16 h-20 rounded-lg overflow-hidden bg-slate-950 flex-shrink-0 border border-slate-700">
                <img
                  src={previewDataUrl}
                  alt="下書き写真"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-white">下書き写真</span>
                  <span className="text-[10px] bg-sky-950 text-sky-300 border border-sky-800 px-1.5 py-0.5 rounded font-bold">
                    下書き1枠保存中
                  </span>
                  {isDraftRestored && (
                    <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      自動復元済
                    </span>
                  )}
                </div>
                {imageUploadStatus.text ? (
                  <p
                    className={`text-[11px] leading-relaxed flex items-center gap-1 ${
                      imageUploadStatus.type === 'success'
                        ? 'text-emerald-300'
                        : imageUploadStatus.type === 'error'
                        ? 'text-amber-300'
                        : 'text-sky-300'
                    }`}
                  >
                    {imageUploadStatus.type === 'uploading' && (
                      <RefreshCw className="w-3 h-3 animate-spin flex-shrink-0" />
                    )}
                    {imageUploadStatus.type === 'success' && (
                      <CheckCircle2 className="w-3 h-3 flex-shrink-0 text-emerald-400" />
                    )}
                    {imageUploadStatus.type === 'error' && (
                      <AlertCircle className="w-3 h-3 flex-shrink-0 text-amber-400" />
                    )}
                    <span>{imageUploadStatus.text}</span>
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {registrationMode === 'batch'
                      ? '※ JSON取り込み時に各着へ連番IDを自動割り当てし、3:4正規化本保存・ドライブ同期されます。'
                      : `※ JSON取り込み成功時に確定ID（${nextShirtId} または ${nextPantsId}）で3:4正規化本保存・ドライブ同期されます。`}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Step 2: 1-line optional memo & Prompt Generation */}
      <section className="bg-slate-800/80 border border-slate-700/70 rounded-2xl p-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
            2
          </span>
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <FileCode className="w-4 h-4 text-indigo-400" />
            プロンプトコピー ＆ Geminiに写真相談
          </h3>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed pl-8">
          プロンプトをコピーして Gemini に写真と一緒に送信するだけです。写真で判別しにくい特徴がある場合のみ、1行メモを入力してください。
        </p>

        <div className="pl-8 space-y-3">
          {/* Optional 1-line memo */}
          <div>
            <label className="text-[11px] font-bold text-slate-300 mb-1 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-indigo-400" />
              <span>補足メモ（任意・1行）</span>
            </label>
            <input
              type="text"
              value={optionalNote}
              onChange={(e) => setOptionalNote(e.target.value)}
              placeholder="例: ストレッチあり、麻混で涼しい、ウエストゴム 等（空欄でもOK）"
              className="w-full min-h-[44px] p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Collapsible Manual Override Accordion (Single mode only) */}
          {registrationMode === 'single' && (
            <div className="border border-slate-700/60 rounded-xl overflow-hidden bg-slate-900/40">
              <button
                type="button"
                onClick={() => setIsManualOverrideOpen(!isManualOverrideOpen)}
                className="w-full min-h-[44px] px-3.5 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-300 hover:text-white transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-slate-400" />
                  <span>⚙️ 種別・名前・袖丈を手動で固定する（任意）</span>
                </span>
                {isManualOverrideOpen ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>

              {isManualOverrideOpen && (
                <div className="p-3.5 border-t border-slate-800 space-y-3 bg-slate-900/70">
                  {/* Manual Category Selection */}
                  <div>
                    <label className="text-[11px] font-bold text-slate-300 mb-1.5 block">
                      種別指定
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setManualCategory('auto')}
                        className={`min-h-[44px] py-2 px-2 rounded-xl text-xs font-bold border transition-all ${
                          manualCategory === 'auto'
                            ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-950'
                            : 'bg-slate-900/60 text-slate-400 border-slate-700 hover:text-white'
                        }`}
                      >
                        AIにおまかせ
                      </button>
                      <button
                        type="button"
                        onClick={() => setManualCategory('shirt')}
                        className={`min-h-[44px] py-2 px-2 rounded-xl text-xs font-bold border transition-all ${
                          manualCategory === 'shirt'
                            ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-950'
                            : 'bg-slate-900/60 text-slate-400 border-slate-700 hover:text-white'
                        }`}
                      >
                        シャツ ({nextShirtId})
                      </button>
                      <button
                        type="button"
                        onClick={() => setManualCategory('pants')}
                        className={`min-h-[44px] py-2 px-2 rounded-xl text-xs font-bold border transition-all ${
                          manualCategory === 'pants'
                            ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-950'
                            : 'bg-slate-900/60 text-slate-400 border-slate-700 hover:text-white'
                        }`}
                      >
                        パンツ ({nextPantsId})
                      </button>
                    </div>
                  </div>

                  {/* Manual Item Name */}
                  <div>
                    <label className="text-[11px] font-bold text-slate-300 mb-1 block">
                      アイテム名固定
                    </label>
                    <input
                      type="text"
                      value={manualItemName}
                      onChange={(e) => setManualItemName(e.target.value)}
                      placeholder="指定がなければ写真から自動命名"
                      className="w-full min-h-[44px] p-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* Manual Season/Sleeve */}
                  <div>
                    <label className="text-[11px] font-bold text-slate-300 mb-1.5 block">
                      季節・袖丈固定
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(manualCategory === 'shirt'
                        ? SHIRT_SLEEVE_PRESETS
                        : PANTS_SLEEVE_PRESETS
                      ).map((preset) => {
                        const isSelected = manualSleeve === preset;
                        return (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setManualSleeve(isSelected ? '' : preset)}
                            className={`min-h-[44px] py-2 px-2 rounded-xl text-xs font-bold border transition-all ${
                              isSelected
                                ? 'bg-blue-600 text-white border-blue-500 shadow-md ring-1 ring-blue-400'
                                : 'bg-slate-950 text-slate-400 border-slate-700 hover:text-white'
                            }`}
                          >
                            {preset}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Wife NG notice */}
          {wifeNgPairs.length > 0 && (
            <div className="p-2.5 bg-rose-950/40 border border-rose-800/40 rounded-xl flex items-center gap-2 text-[11px] text-rose-300">
              <ShieldCheck className="w-4 h-4 flex-shrink-0 text-rose-400" />
              <span>
                登録済みの<strong>奥様NG（{wifeNgPairs.length}件）</strong>と競合しないようプロンプトを構築します。
              </span>
            </div>
          )}

          {/* Copy Prompt Button */}
          <button
            onClick={handleCopyPromptAndData}
            className={`w-full min-h-[44px] py-3 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg ${
              copiedPrompt
                ? 'bg-emerald-600 text-white'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/40 active:scale-[0.98]'
            }`}
          >
            {copiedPrompt ? (
              <>
                <Check className="w-4 h-4" />
                <span>コピー完了！ Gemini に写真と一緒に貼ってください</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>
                  {registrationMode === 'batch'
                    ? '📋 まとめ撮り用プロンプトをコピー（推奨2〜3着・最大3着）'
                    : `📋 Gemini相談用プロンプトをコピー（次連番: ${nextShirtId} / ${nextPantsId}）`}
                </span>
              </>
            )}
          </button>
        </div>
      </section>

      {/* Step 3: Apply JSON, Confirmation & Fine-tuning Panel */}
      <section className="bg-slate-800/80 border border-slate-700/70 rounded-2xl p-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
            3
          </span>
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <ArrowRight className="w-4 h-4 text-emerald-400" />
            AIが出力したJSONを貼り付けて適用
          </h3>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed pl-8">
          Geminiから出力された【1着分のJSON】（またはまとめ撮り一括登録JSON・色一括更新JSON）を貼り付けると、下に確認・微修正パネルが表示されます。
        </p>

        <div className="pl-8 space-y-3">
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder={
              registrationMode === 'batch'
                ? `{\n  "garments": [\n    {\n      "category": "shirt",\n      "name": "...",\n      "color": "濃紺",\n      "cropBox": { ... },\n      ...\n    }\n  ]\n}`
                : `{\n  "id": "${nextShirtId} または ${nextPantsId}",\n  "category": "shirt または pants",\n  "color": "濃紺",\n  "name": "...",\n  "measurements": { ... },\n  "cropBox": { ... },\n  ...\n}`
            }
            rows={5}
            className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
          />

          {/* Case A: Batch Color Updates Preview Card */}
          {draftBatchUpdates && (
            <div className="p-4 bg-slate-900/95 border border-amber-500/50 rounded-2xl space-y-3 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <Palette className="w-4 h-4 text-amber-400" />
                  色パレット一括更新プレビュー（全{draftBatchUpdates.length}着）
                </span>
                <span className="text-[10px] text-slate-400">※名前や相性リストは変更されません</span>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                {draftBatchUpdates.map((update) => {
                  const existing = mergedClosetData.items.find(
                    (i) => i.id.toUpperCase() === update.id.toUpperCase()
                  );
                  const isColorValid = isValidGarmentColor(update.color);
                  return (
                    <div
                      key={update.id}
                      className="p-2 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="font-bold text-blue-400 font-mono">{update.id}</span>
                        <span className="text-slate-300 truncate">
                          {existing ? existing.name : '（未登録アイテム）'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 font-medium">
                        <span className="text-slate-400 text-[11px]">
                          {existing?.color ? existing.color : '未設定'}
                        </span>
                        <span className="text-slate-500">→</span>
                        <span
                          className={`font-bold px-1.5 py-0.5 rounded text-[11px] ${
                            isColorValid
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : 'bg-rose-950 text-rose-300 border border-rose-800'
                          }`}
                        >
                          🎨 {update.color}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleApplyJson}
                className="w-full min-h-[44px] py-3 px-4 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/40 flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
              >
                <Check className="w-4 h-4" />
                <span>💾 色パレット一括更新を適用（{draftBatchUpdates.length}着）</span>
              </button>
            </div>
          )}

          {/* Case B: Single Item Inline Confirmation & Fine-tuning Panel */}
          {draftEditItem && (
            <div className="p-4 bg-slate-900/95 border border-indigo-500/50 rounded-2xl space-y-4 shadow-2xl">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                    取り込み内容の確認・微修正 (ID: {draftEditItem.id})
                  </span>
                </div>
                <span className="text-[11px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800 px-2 py-0.5 rounded-lg">
                  {draftEditItem.category === 'shirt' ? 'シャツ' : 'パンツ'}
                </span>
              </div>

              {/* 1. Category Switcher */}
              <div>
                <label className="text-[11px] font-bold text-slate-300 mb-1.5 block">
                  種別（もしAIの判定が違っていればここで切替）
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleSwitchCategory('shirt')}
                    className={`min-h-[44px] py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                      draftEditItem.category === 'shirt'
                        ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-950 ring-1 ring-blue-400'
                        : 'bg-slate-950 text-slate-400 border-slate-700 hover:text-white'
                    }`}
                  >
                    シャツ ({nextShirtId})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchCategory('pants')}
                    className={`min-h-[44px] py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                      draftEditItem.category === 'pants'
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-950 ring-1 ring-emerald-400'
                        : 'bg-slate-950 text-slate-400 border-slate-700 hover:text-white'
                    }`}
                  >
                    パンツ ({nextPantsId})
                  </button>
                </div>

                {isCategorySwitched && (
                  <div className="mt-2.5 p-2.5 bg-amber-950/60 border border-amber-800/80 rounded-xl flex items-start gap-2 text-xs text-amber-300">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-400 mt-0.5" />
                    <span>
                      ⚠️ 種別を変更したため、相性リスト（出社◎・リモート○・NG）は未設定（0件）になりました。再度 Gemini に相談するか、このまま追加して後から編集してください。
                    </span>
                  </div>
                )}
              </div>

              {/* 2. Color Palette Chips */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5 text-blue-400" />
                    <span>色パレット（12色から1つ選択）</span>
                  </label>
                  <span className="text-[10px] text-blue-400 font-mono">
                    選択中: {draftEditItem.color || '未設定'}
                  </span>
                </div>

                {/* Validation warning if color is missing or invalid */}
                {(!draftEditItem.color || !isValidGarmentColor(draftEditItem.color)) && (
                  <div className="mb-2 p-2 bg-amber-950/60 border border-amber-800/70 rounded-xl flex items-center gap-2 text-xs text-amber-300">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-400" />
                    <span>
                      ⚠️ 色：未確定{draftEditItem.color ? `（目安：${draftEditItem.color}）` : ''} — 下の12色からタップして確定するか、未確定のまま登録できます。
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {GARMENT_COLOR_PALETTE.map((c) => {
                    const isSelected = draftEditItem.color === c;
                    const chipStyle = getColorForPalette(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => handleUpdateDraftField('color', c)}
                        className={`min-h-[44px] py-2 px-2.5 rounded-xl text-xs font-bold border flex items-center justify-center gap-2 transition-all ${
                          isSelected
                            ? 'bg-blue-600/30 text-white border-blue-400 ring-2 ring-blue-500/60 shadow-lg'
                            : 'bg-slate-950/80 text-slate-300 border-slate-700/80 hover:border-slate-500 hover:text-white'
                        }`}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-full flex-shrink-0 shadow-inner"
                          style={{
                            backgroundColor: chipStyle.fill,
                            border: `1.5px solid ${chipStyle.stroke}`,
                          }}
                        />
                        <span>{c}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. Measurements Inputs */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-1 mb-1.5">
                  <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                    <Ruler className="w-3.5 h-3.5 text-emerald-400" />
                    <span>実寸目安（cm）</span>
                  </label>
                  <span className="text-[10px] text-slate-400">
                    有効範囲：10〜200cm（0.5cm刻み・空欄で未設定）
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(draftEditItem.category === 'shirt'
                    ? SHIRT_MEASUREMENT_FIELDS
                    : PANTS_MEASUREMENT_FIELDS
                  ).map((f) => {
                    const fieldVal = draftEditItem.measurements?.[f.key];
                    const isOutOfRange =
                      fieldVal !== undefined && (fieldVal < 10 || fieldVal > 200);
                    return (
                      <div key={f.key} className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-300 flex items-center justify-between px-0.5">
                          <span>{f.label}</span>
                          <span className="text-[9px] text-slate-500">{f.desc}</span>
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min={10}
                            max={200}
                            step={0.5}
                            value={fieldVal ?? ''}
                            onChange={(e) => handleUpdateMeasurement(f.key, e.target.value)}
                            placeholder="未設定"
                            className={`w-full min-h-[44px] p-2.5 pr-8 rounded-xl bg-slate-950 border text-xs text-white focus:outline-none focus:border-blue-500 font-mono ${
                              isOutOfRange
                                ? 'border-amber-500/80 text-amber-200'
                                : 'border-slate-700'
                            }`}
                          />
                          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 font-mono pointer-events-none">
                            cm
                          </span>
                        </div>
                        {isOutOfRange && (
                          <p className="text-[9px] text-amber-400 px-0.5">
                            ※10〜200cm外（保存時除外）
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 4. Smart Cropping Preview & Toggle */}
              {previewDataUrl && (
                <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                      <Crop className="w-3.5 h-3.5 text-blue-400" />
                      <span>3:4 画像正規化プレビュー</span>
                    </span>
                    {draftCropBox && normalizeCropBox(draftCropBox) ? (
                      <span className="text-[10px] text-emerald-400 bg-emerald-950/80 border border-emerald-800/80 px-1.5 py-0.5 rounded font-mono">
                        服領域座標あり
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded font-mono">
                        全体配置フォールバック
                      </span>
                    )}
                  </div>

                  {/* Toggle Checkbox */}
                  <label className="min-h-[44px] flex items-center gap-2.5 p-2 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer hover:bg-slate-850 transition-colors">
                    <input
                      type="checkbox"
                      checked={applySmartCrop}
                      onChange={(e) => setApplySmartCrop(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 bg-slate-950 border-slate-700"
                    />
                    <div className="text-xs text-slate-200">
                      <span className="font-bold">✂️ 自動切り抜きを適用</span>
                      <span className="text-[10px] text-slate-400 ml-1.5">
                        （A4用紙を除いて服本体を中心に3:4配置）
                      </span>
                    </div>
                  </label>

                  {/* Preview Image */}
                  <div className="flex items-center gap-3 pt-1">
                    <div className="w-20 h-28 rounded-xl overflow-hidden bg-slate-950 border border-slate-700 flex-shrink-0 relative shadow-inner">
                      {normalizedPreviewUrl ? (
                        <img
                          src={normalizedPreviewUrl}
                          alt="3:4正規化プレビュー"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-500">
                          生成中...
                        </div>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 leading-relaxed space-y-1">
                      <div className="text-white font-semibold">
                        {applySmartCrop && draftCropBox && normalizeCropBox(draftCropBox)
                          ? '服本体の自動切り抜き（3:4 900×1200px）'
                          : '全体画像の中央配置（3:4 900×1200px 余白フォールバック）'}
                      </div>
                      <p>
                        確定時にこの3:4画像が IndexedDB と Google ドライブ正本へ保存されます。
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 5. Name input */}
              <div>
                <label className="text-[11px] font-bold text-slate-300 mb-1 block">
                  アイテム名
                </label>
                <input
                  type="text"
                  value={draftEditItem.name || ''}
                  onChange={(e) => handleUpdateDraftField('name', e.target.value)}
                  className="w-full min-h-[44px] p-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* 6. Season Sleeve presets */}
              <div>
                <label className="text-[11px] font-bold text-slate-300 mb-1.5 flex items-center justify-between">
                  <span>季節・袖丈</span>
                  <span className="text-[10px] text-blue-400 font-mono">
                    選択中: {draftEditItem.seasonSleeve || '未設定'}
                  </span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(draftEditItem.category === 'shirt'
                    ? SHIRT_SLEEVE_PRESETS
                    : PANTS_SLEEVE_PRESETS
                  ).map((preset) => {
                    const isSelected = draftEditItem.seasonSleeve === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handleUpdateDraftField('seasonSleeve', preset)}
                        className={`min-h-[44px] py-2 px-2 rounded-xl text-xs font-bold border transition-all ${
                          isSelected
                            ? 'bg-blue-600 text-white border-blue-500 shadow-md ring-1 ring-blue-400'
                            : 'bg-slate-950 text-slate-400 border-slate-700 hover:text-white'
                        }`}
                      >
                        {preset}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 7. Scores (Dress & Comfort) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 mb-1 flex items-center justify-between">
                    <span>ドレス度 (1.0〜5.0)</span>
                    <span className="text-[10px] text-amber-400 font-mono font-bold">
                      {draftEditItem.dressScore ?? 3.5}
                    </span>
                  </label>
                  <input
                    type="range"
                    min="1.0"
                    max="5.0"
                    step="0.5"
                    value={draftEditItem.dressScore ?? 3.5}
                    onChange={(e) =>
                      handleUpdateDraftField('dressScore', parseFloat(e.target.value))
                    }
                    className="w-full accent-amber-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-300 mb-1 flex items-center justify-between">
                    <span>快適度 (1.0〜5.0)</span>
                    <span className="text-[10px] text-emerald-400 font-mono font-bold">
                      {draftEditItem.comfortScore ?? 3.5}
                    </span>
                  </label>
                  <input
                    type="range"
                    min="1.0"
                    max="5.0"
                    step="0.5"
                    value={draftEditItem.comfortScore ?? 3.5}
                    onChange={(e) =>
                      handleUpdateDraftField('comfortScore', parseFloat(e.target.value))
                    }
                    className="w-full accent-emerald-500"
                  />
                </div>
              </div>

              {/* 8. Notes input */}
              <div>
                <label className="text-[11px] font-bold text-slate-300 mb-1 block">
                  メモ・特徴
                </label>
                <input
                  type="text"
                  value={draftEditItem.notes || ''}
                  onChange={(e) => handleUpdateDraftField('notes', e.target.value)}
                  className="w-full min-h-[44px] p-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* 9. Compatibility summary chips */}
              <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2">
                <span className="text-[11px] font-bold text-slate-400 block">相性リストサマリー</span>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-lg bg-blue-950/80 text-blue-300 border border-blue-800">
                    出社おすすめ: <strong>{draftEditItem.officeRecommendIds?.length ?? 0}着</strong>
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                    リモートおすすめ: <strong>{draftEditItem.remoteRecommendIds?.length ?? 0}着</strong>
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-rose-950/80 text-rose-300 border border-rose-800">
                    NG: <strong>{draftEditItem.ngIds?.length ?? 0}着</strong>
                  </span>
                </div>
                {draftEditItem.ngReason && draftEditItem.ngReason !== 'なし' && (
                  <p className="text-[11px] text-rose-400">
                    NG理由: {draftEditItem.ngReason}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Case C: Batch Garments Confirmation & Fine-tuning Panel */}
          {draftBatchGarments && draftBatchGarments.length > 0 && (() => {
            const assignedBatch = assignSequentialIdsForBatch(
              mergedClosetData.items,
              draftBatchGarments,
              batchIncludedFlags
            );
            const includedCount = batchIncludedFlags.filter(Boolean).length;
            const totalCount = draftBatchGarments.length;

            return (
              <div className="p-4 bg-slate-900/95 border border-indigo-500/50 rounded-2xl space-y-4 shadow-2xl">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                      まとめ撮り確認パネル（全{totalCount}着）
                    </span>
                  </div>
                  <span className="text-[11px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800 px-2 py-0.5 rounded-lg">
                    {includedCount}着 登録対象 / {totalCount}着
                  </span>
                </div>

                {totalCount > MAX_BATCH_GARMENTS && (
                  <div className="p-2.5 bg-rose-950/80 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400 mt-0.5" />
                    <span>
                      まとめ撮りの上限（最大{MAX_BATCH_GARMENTS}着）を超えています（現在{totalCount}着）。
                      チェックを外して{MAX_BATCH_GARMENTS}着以下にするか、JSONを修正してください。
                    </span>
                  </div>
                )}

                <div className="p-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-slate-300 leading-relaxed">
                  💡 AIが写真から検出した各着の切り抜き・種別・色・寸法です。問題なければそのまま最下部の<strong>［選択した{includedCount}着を一括マージ・保存］</strong>をタップするだけで登録完了します（微修正は任意です）。
                </div>

                <div className="space-y-4">
                  {draftBatchGarments.map((draft, idx) => {
                    const isIncluded = batchIncludedFlags[idx] !== false;
                    const assignedItem = assignedBatch[idx];
                    const assignedId = isIncluded ? assignedItem?.id : undefined;
                    const previewUrl = batchNormalizedPreviews[idx];
                    const shouldCrop = batchSmartCropFlags[idx] !== false;

                    // 個別アイテムのリアルタイム検証
                    const category = draft.category;
                    const tempCandidate: ClosetItem = {
                      id: assignedId || (category === 'pants' ? 'P999' : 'S999'),
                      category: category === 'pants' ? 'pants' : 'shirt',
                      name: draft.name || '無名',
                      color: draft.color as any,
                      imageUrl: `/images/${assignedId || (category === 'pants' ? 'P999' : 'S999')}.jpg`,
                      seasonSleeve: draft.seasonSleeve || '通年',
                      dressScore: draft.dressScore ?? 3.5,
                      comfortScore: draft.comfortScore ?? 3.5,
                      measurements: draft.measurements,
                      officeRecommendIds: draft.officeRecommendIds || [],
                      remoteRecommendIds: draft.remoteRecommendIds || [],
                      ngIds: draft.ngIds || [],
                      ngReason: draft.ngReason || 'なし',
                      notes: draft.notes || '',
                    };
                    const validation = (category === 'shirt' || category === 'pants')
                      ? validateSingleClosetItem(tempCandidate, mergedClosetData)
                      : { valid: false, error: '種別（category）が未設定です。' };

                    const isColorValid = isValidGarmentColor(draft.color);

                    return (
                      <div
                        key={idx}
                        className={`p-3.5 rounded-xl border transition-all space-y-3 ${
                          !isIncluded
                            ? 'bg-slate-950/40 border-slate-800/60 opacity-60'
                            : 'bg-slate-950/90 border-slate-700/80 shadow-md'
                        }`}
                      >
                        {/* Card Header: Checkbox + Assigned ID + Status Badge */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                          <label className="min-h-[44px] flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isIncluded}
                              onChange={(e) => {
                                const nextFlags = [...batchIncludedFlags];
                                nextFlags[idx] = e.target.checked;
                                setBatchIncludedFlags(nextFlags);
                              }}
                              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 bg-slate-900 border-slate-700"
                            />
                            <span className="text-xs font-bold text-white">
                              この服を登録する（{idx + 1}着目）
                            </span>
                          </label>

                          <div className="flex items-center gap-1.5 flex-wrap">
                            {isIncluded && assignedId ? (
                              <span className="text-xs font-mono font-bold bg-blue-950 text-blue-300 border border-blue-800 px-2 py-0.5 rounded">
                                ID: {assignedId}
                              </span>
                            ) : (
                              <span className="text-xs font-mono text-slate-500 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
                                （除外中）
                              </span>
                            )}

                            {isIncluded && (
                              <span
                                className={`text-[11px] px-2 py-0.5 rounded font-bold ${
                                  validation.valid
                                    ? isColorValid
                                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                      : 'bg-amber-950 text-amber-300 border border-amber-800'
                                    : 'bg-rose-950 text-rose-300 border border-rose-800'
                                }`}
                              >
                                {validation.valid
                                  ? isColorValid
                                    ? '✅ 検証OK'
                                    : `⚠️ 色：未確定${draft.color ? `（目安：${draft.color}）` : ''}`
                                  : `❌ ${validation.error}`}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Card Content (shown when included) */}
                        {isIncluded && (
                          <div className="space-y-3 pt-1">
                            {/* Category Switcher */}
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 mb-1 block">
                                種別（シャツ／パンツ）
                              </label>
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleSwitchBatchItemCategory(idx, 'shirt')}
                                  className={`min-h-[44px] py-1.5 px-3 rounded-xl text-xs font-bold border transition-all ${
                                    draft.category === 'shirt'
                                      ? 'bg-blue-600 text-white border-blue-500 shadow-md ring-1 ring-blue-400'
                                      : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                                  }`}
                                >
                                  シャツ
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSwitchBatchItemCategory(idx, 'pants')}
                                  className={`min-h-[44px] py-1.5 px-3 rounded-xl text-xs font-bold border transition-all ${
                                    draft.category === 'pants'
                                      ? 'bg-emerald-600 text-white border-emerald-500 shadow-md ring-1 ring-emerald-400'
                                      : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                                  }`}
                                >
                                  パンツ
                                </button>
                              </div>
                            </div>

                            {/* Color Palette Chips */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                                  <Palette className="w-3 h-3 text-blue-400" />
                                  <span>色パレット</span>
                                </label>
                                <span className="text-[10px] text-blue-400 font-mono">
                                  選択中: {draft.color || '未確定'}
                                </span>
                              </div>

                              {(!draft.color || !isColorValid) && (
                                <div className="mb-2 p-2 bg-amber-950/60 border border-amber-800/70 rounded-xl flex items-center gap-2 text-xs text-amber-300">
                                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
                                  <span>
                                    ⚠️ 色：未確定{draft.color ? `（目安：${draft.color}）` : ''} — 12色チップから選択して確定するか、未確定のまま登録できます。
                                  </span>
                                </div>
                              )}

                              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                                {GARMENT_COLOR_PALETTE.map((c) => {
                                  const isSelected = draft.color === c;
                                  const chipStyle = getColorForPalette(c);
                                  return (
                                    <button
                                      key={c}
                                      type="button"
                                      onClick={() => handleUpdateBatchItemField(idx, 'color', c)}
                                      className={`min-h-[44px] py-1.5 px-2 rounded-xl text-[11px] font-bold border flex items-center justify-center gap-1.5 transition-all ${
                                        isSelected
                                          ? 'bg-blue-600/30 text-white border-blue-400 ring-2 ring-blue-500/60 shadow-lg'
                                          : 'bg-slate-900 text-slate-300 border-slate-700/80 hover:border-slate-500 hover:text-white'
                                      }`}
                                    >
                                      <span
                                        className="w-3 h-3 rounded-full flex-shrink-0 shadow-inner"
                                        style={{
                                          backgroundColor: chipStyle.fill,
                                          border: `1.5px solid ${chipStyle.stroke}`,
                                        }}
                                      />
                                      <span>{c}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* 3:4 Crop Preview & Toggle */}
                            {previewDataUrl && (
                              <div className="p-2.5 bg-slate-900/80 rounded-xl border border-slate-800 space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                                    <Crop className="w-3 h-3 text-blue-400" />
                                    <span>3:4 切り抜きプレビュー</span>
                                  </span>
                                  {draft.cropBox && normalizeCropBox(draft.cropBox) ? (
                                    <span className="text-[9px] text-emerald-400 bg-emerald-950/80 border border-emerald-800/80 px-1.5 py-0.5 rounded font-mono">
                                      服領域座標あり
                                    </span>
                                  ) : (
                                    <span className="text-[9px] text-slate-400 bg-slate-950 border border-slate-800 px-1.5 py-0.5 rounded font-mono">
                                      全体配置
                                    </span>
                                  )}
                                </div>

                                <label className="min-h-[44px] flex items-center gap-2 p-1.5 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={shouldCrop}
                                    onChange={(e) => {
                                      const nextFlags = [...batchSmartCropFlags];
                                      nextFlags[idx] = e.target.checked;
                                      setBatchSmartCropFlags(nextFlags);
                                    }}
                                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 bg-slate-900 border-slate-700"
                                  />
                                  <span className="text-[11px] text-slate-300">
                                    ✂️ 自動切り抜きを適用（服本体を中心に3:4配置）
                                  </span>
                                </label>

                                <div className="flex items-center gap-2.5 pt-1">
                                  <div className="w-16 h-22 rounded-lg overflow-hidden bg-slate-950 border border-slate-700 flex-shrink-0 relative">
                                    {previewUrl ? (
                                      <img
                                        src={previewUrl}
                                        alt={`3:4プレビュー ${idx + 1}`}
                                        className="w-full h-full object-contain"
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center text-[9px] text-slate-500">
                                        生成中...
                                      </div>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-slate-400 leading-relaxed">
                                    確定時にこの3:4画像が ID「{assignedId || 'S/P'}」として保存されます。
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Measurements Inputs */}
                            <div>
                              <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                                <label className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                                  <Ruler className="w-3 h-3 text-emerald-400" />
                                  <span>実寸目安（cm）</span>
                                </label>
                                <span className="text-[9px] text-slate-500">
                                  10〜200cm（0.5cm刻み・空欄で未設定）
                                </span>
                              </div>

                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {(draft.category === 'shirt'
                                  ? SHIRT_MEASUREMENT_FIELDS
                                  : PANTS_MEASUREMENT_FIELDS
                                ).map((f) => {
                                  const fieldVal = draft.measurements?.[f.key];
                                  const isOutOfRange =
                                    fieldVal !== undefined && (fieldVal < 10 || fieldVal > 200);
                                  return (
                                    <div key={f.key} className="space-y-0.5">
                                      <label className="text-[9px] font-bold text-slate-400 flex items-center justify-between px-0.5">
                                        <span>{f.label}</span>
                                        <span className="text-[8px] text-slate-500">{f.desc}</span>
                                      </label>
                                      <div className="relative">
                                        <input
                                          type="number"
                                          min={10}
                                          max={200}
                                          step={0.5}
                                          value={fieldVal ?? ''}
                                          onChange={(e) => handleUpdateBatchMeasurement(idx, f.key, e.target.value)}
                                          placeholder="未設定"
                                          className={`w-full min-h-[44px] p-2 pr-7 rounded-xl bg-slate-900 border text-xs text-white focus:outline-none focus:border-blue-500 font-mono ${
                                            isOutOfRange
                                              ? 'border-amber-500/80 text-amber-200'
                                              : 'border-slate-700'
                                          }`}
                                        />
                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-500 font-mono pointer-events-none">
                                          cm
                                        </span>
                                      </div>
                                      {isOutOfRange && (
                                        <p className="text-[8px] text-amber-400 px-0.5">
                                          ※10〜200cm外（保存時除外）
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Item Name */}
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 mb-1 block">
                                アイテム名
                              </label>
                              <input
                                type="text"
                                value={draft.name || ''}
                                onChange={(e) => handleUpdateBatchItemField(idx, 'name', e.target.value)}
                                className="w-full min-h-[44px] p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                              />
                            </div>

                            {/* Season / Sleeve presets */}
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 mb-1 flex items-center justify-between">
                                <span>季節・袖丈</span>
                                <span className="text-[10px] text-blue-400 font-mono">
                                  選択中: {draft.seasonSleeve || '未設定'}
                                </span>
                              </label>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                                {(draft.category === 'shirt'
                                  ? SHIRT_SLEEVE_PRESETS
                                  : PANTS_SLEEVE_PRESETS
                                ).map((preset) => {
                                  const isSelected = draft.seasonSleeve === preset;
                                  return (
                                    <button
                                      key={preset}
                                      type="button"
                                      onClick={() => handleUpdateBatchItemField(idx, 'seasonSleeve', preset)}
                                      className={`min-h-[44px] py-1.5 px-2 rounded-xl text-xs font-bold border transition-all ${
                                        isSelected
                                          ? 'bg-blue-600 text-white border-blue-500 shadow-md ring-1 ring-blue-400'
                                          : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                                      }`}
                                    >
                                      {preset}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Scores (Dress & Comfort) */}
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-[10px] font-bold text-slate-400 mb-1 flex items-center justify-between">
                                  <span>ドレス度 (1.0〜5.0)</span>
                                  <span className="text-[10px] text-amber-400 font-mono font-bold">
                                    {draft.dressScore ?? 3.5}
                                  </span>
                                </label>
                                <input
                                  type="range"
                                  min="1.0"
                                  max="5.0"
                                  step="0.5"
                                  value={draft.dressScore ?? 3.5}
                                  onChange={(e) =>
                                    handleUpdateBatchItemField(idx, 'dressScore', parseFloat(e.target.value))
                                  }
                                  className="w-full accent-amber-500 min-h-[44px]"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-bold text-slate-400 mb-1 flex items-center justify-between">
                                  <span>快適度 (1.0〜5.0)</span>
                                  <span className="text-[10px] text-emerald-400 font-mono font-bold">
                                    {draft.comfortScore ?? 3.5}
                                  </span>
                                </label>
                                <input
                                  type="range"
                                  min="1.0"
                                  max="5.0"
                                  step="0.5"
                                  value={draft.comfortScore ?? 3.5}
                                  onChange={(e) =>
                                    handleUpdateBatchItemField(idx, 'comfortScore', parseFloat(e.target.value))
                                  }
                                  className="w-full accent-emerald-500 min-h-[44px]"
                                />
                              </div>
                            </div>

                            {/* Notes input */}
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 mb-1 block">
                                メモ・特徴
                              </label>
                              <input
                                type="text"
                                value={draft.notes || ''}
                                onChange={(e) => handleUpdateBatchItemField(idx, 'notes', e.target.value)}
                                className="w-full min-h-[44px] p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                              />
                            </div>

                            {/* Compatibility summary */}
                            <div className="p-2.5 bg-slate-900/60 rounded-xl border border-slate-800 space-y-1">
                              <span className="text-[10px] font-bold text-slate-400 block">相性リストサマリー</span>
                              <div className="flex flex-wrap gap-1.5 text-[11px]">
                                <span className="px-2 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800">
                                  出社おすすめ: <strong>{draft.officeRecommendIds?.length ?? 0}着</strong>
                                </span>
                                <span className="px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                                  リモートおすすめ: <strong>{draft.remoteRecommendIds?.length ?? 0}着</strong>
                                </span>
                                <span className="px-2 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800">
                                  NG: <strong>{draft.ngIds?.length ?? 0}着</strong>
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Batch Apply Button */}
                <button
                  type="button"
                  onClick={handleApplyBatchGarments}
                  disabled={isApplyingBatch || includedCount === 0 || totalCount > MAX_BATCH_GARMENTS}
                  className="w-full min-h-[44px] py-3 px-4 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white shadow-lg shadow-emerald-900/40 flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
                >
                  {isApplyingBatch ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>一括マージ・保存中...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>💾 選択した{includedCount}着を一括マージ・保存</span>
                    </>
                  )}
                </button>
              </div>
            );
          })()}

          {importStatus && (
            <div
              className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                importStatus.type === 'success'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                  : 'bg-rose-950/80 text-rose-300 border border-rose-800'
              }`}
            >
              {importStatus.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
              )}
              <span>{importStatus.message}</span>
            </div>
          )}

          {/* Main Apply Button */}
          {!draftBatchUpdates && !draftBatchGarments && (
            <button
              onClick={handleApplyJson}
              className="w-full min-h-[44px] py-3 px-4 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/40 flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
            >
              <Check className="w-4 h-4" />
              <span>💾 JSONを適用して自動マージ・保存</span>
            </button>
          )}

          {/* Collapsible Backup, Reset & Batch Color Consult Section */}
          <div className="pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setIsBackupOpen(!isBackupOpen)}
              className="w-full min-h-[44px] py-2 px-3 rounded-xl bg-slate-900/60 hover:bg-slate-800 text-slate-400 hover:text-slate-300 flex items-center justify-between text-xs transition-colors border border-slate-800/80"
            >
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <span>📦 バックアップ・復旧（色一括相談・ファイル保存・初期データに戻す）</span>
                {unconfirmedColorCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-950 text-amber-300 border border-amber-800 font-bold font-mono">
                    未確定 {unconfirmedColorCount}着
                  </span>
                )}
              </span>
              {isBackupOpen ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {isBackupOpen && (
              <div className="p-3 mt-2 bg-slate-900/80 rounded-xl border border-slate-800 space-y-3">
                {/* Batch Color Consultation Section */}
                <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                      <Palette className="w-4 h-4 text-amber-400" />
                      <span>既存服の色パレット一括相談</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      全{mergedClosetData.items.length}着中 未確定 {unconfirmedColorCount}着
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    全アイテムの情報と12色パレット基準を Gemini に相談するプロンプトです。Geminiから返ってきた
                    <code>&#123; "colorUpdates": [...] &#125;</code>
                    を上のStep 3に貼り付けるだけで、名前を変えずに全着の色のみを一括確定できます。
                  </p>
                  <button
                    type="button"
                    onClick={handleCopyBatchColorPrompt}
                    className="w-full min-h-[44px] py-2.5 px-3 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-950 flex items-center justify-center gap-1.5 transition-all"
                  >
                    {copiedBatchPrompt ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>コピー完了！ Gemini に貼って相談してください</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>🎨 既存服の色パレット一括相談プロンプトをコピー</span>
                      </>
                    )}
                  </button>
                </div>

                <p className="text-[11px] text-slate-400">
                  通常は上の保存ボタンだけで完了します。ファイルの直接管理や初期化を行う場合のみ使用します。
                </p>

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadJson}
                    className="flex-1 min-h-[44px] py-2 px-3 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center gap-1.5 transition-colors border border-slate-700"
                    title="マージ済み最新JSONをダウンロード（src/data/closet.json差し替え用）"
                  >
                    <Download className="w-4 h-4 text-blue-400" />
                    <span>JSON保存</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyMergedJson}
                    className="flex-1 min-h-[44px] py-2 px-3 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center gap-1.5 transition-colors border border-slate-700"
                    title="マージ済みJSONをクリップボードにコピー"
                  >
                    {copiedJson ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedJson ? 'コピー済' : 'JSONコピー'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleReset}
                    className="min-h-[44px] py-2 px-3 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-rose-950/60 text-rose-300 hover:text-rose-200 border border-slate-700 hover:border-rose-800/80 flex items-center justify-center gap-1.5 transition-colors"
                    title="初期データに戻す"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
                    <span>初期データに戻す</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
