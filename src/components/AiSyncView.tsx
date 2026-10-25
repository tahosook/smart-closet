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
} from 'lucide-react';
import { useClosetStore } from '../hooks/useClosetStore';
import { Category, ClosetItem } from '../types/closet';
import { getNextSequentialId, switchDraftItemCategory } from '../utils/closetDomain';
import {
  saveDraftImage,
  getDraftImage,
  clearDraftImage,
  saveImageBlob,
} from '../utils/imageStore';
import {
  processGarmentImage,
  uploadImageToGas,
} from '../utils/imageProcessor';

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

export const AiSyncView: React.FC = () => {
  const {
    mergedClosetData,
    wifeNgPairs,
    gasConfig,
    importCustomData,
    resetToDefaultData,
  } = useClosetStore();

  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [importStatus, setImportStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Photo state (Dedicated draft 1 slot: 条件1)
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

  // Step 3: Parsed draft item for confirmation & inline fine-tuning (条件2)
  const [draftEditItem, setDraftEditItem] = useState<Partial<ClosetItem> | null>(null);
  const [isCategorySwitched, setIsCategorySwitched] = useState(false);

  // Suggest next sequential IDs using getNextSequentialId
  const nextShirtId = getNextSequentialId(mergedClosetData.items, 'shirt');
  const nextPantsId = getNextSequentialId(mergedClosetData.items, 'pants');

  // マウント時に専用下書き枠から復元（Geminiアプリ往復でのタブ再読み込み耐性: 条件1）
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

  // 写真ファイル選択ハンドラー（クライアント圧縮 + 専用下書き枠へ1枠自動保存: 条件1）
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingImage(true);
    setImageUploadStatus({ type: 'idle', text: '' });

    try {
      // 1. クライアント側で JPEG にリサイズ＆正規化 (長辺1200px, quality 0.85)
      const { blob, dataUrl } = await processGarmentImage(file, 1200, 0.85);
      setCurrentBlob(blob);
      setPreviewDataUrl(dataUrl);
      setIsDraftRestored(false);

      // 2. 専用下書き枠に1枠のみ上書き保存（本保存ストアおよび pruneImages と完全非干渉）
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

  // 下書き写真の明示的な取り消し・消去（中断ゴミの蓄積防止: 条件1）
  const handleClearPhoto = async () => {
    await clearDraftImage();
    setCurrentBlob(null);
    setPreviewDataUrl(null);
    setIsDraftRestored(false);
    setImageUploadStatus({ type: 'idle', text: '' });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // リアルタイムに JSON テキストを監視し、単一アイテム形式なら draftEditItem に反映
  useEffect(() => {
    const raw = jsonInput.trim();
    if (!raw) {
      setDraftEditItem(null);
      setIsCategorySwitched(false);
      return;
    }

    let clean = raw;
    if (clean.startsWith('```json')) {
      clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    try {
      const parsed = JSON.parse(clean);
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof parsed.id === 'string' &&
        (parsed.category === 'shirt' || parsed.category === 'pants')
      ) {
        setDraftEditItem((prev) => {
          // 既に同一ID・同一カテゴリで編集中の場合は微修正内容を維持
          if (prev && prev.id === parsed.id && prev.category === parsed.category) {
            return prev;
          }
          return parsed;
        });
      }
    } catch {
      // 構文不完全時は無視（編集中）
    }
  }, [jsonInput]);

  // Step 3 確認パネルで種別を手動切替（相性3配列の自動クリア & 注記表示: 条件2）
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

  // Step 3 確認パネルでのインライン微修正
  const handleUpdateDraftField = <K extends keyof ClosetItem>(
    field: K,
    value: ClosetItem[K]
  ) => {
    if (!draftEditItem) return;
    const updated = { ...draftEditItem, [field]: value };
    setDraftEditItem(updated);
    setJsonInput(JSON.stringify(updated, null, 2));
  };

  // 全自動判定用プロンプトの生成とコピー
  const handleCopyPromptAndData = () => {
    const allShirts = mergedClosetData.items.filter((item) => item.category === 'shirt');
    const allPants = mergedClosetData.items.filter((item) => item.category === 'pants');

    const shirtsSummary = allShirts
      .map(
        (s) =>
          `- [${s.id}] ${s.name}（${s.seasonSleeve}、ドレス度${s.dressScore}、快適度${s.comfortScore}）: ${s.notes}`
      )
      .join('\n');

    const pantsSummary = allPants
      .map(
        (p) =>
          `- [${p.id}] ${p.name}（${p.seasonSleeve}、ドレス度${p.dressScore}、快適度${p.comfortScore}）: ${p.notes}`
      )
      .join('\n');

    const wifeNgSummary =
      wifeNgPairs.length > 0
        ? wifeNgPairs.map((ng) => `- ${ng.shirtId} × ${ng.pantsId}: ${ng.reason}`).join('\n')
        : 'なし';

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
1. **同系色・濃紺同士の禁止**: 上下ともに濃紺・インディゴになる組み合わせ（例: S1 濃インディゴ × P1/P5/P6/P8/P11 濃紺系パンツ）は作業着・パジャマに見えるため絶対NG（ngIdsに追加、ngReasonを明記）。
2. **淡青×青デニムの禁止**: S3 サックスシャンブレーに薄青・ブルーデニム（P4/P7/P15）を合わせると全身が水色で繋がり休日のおじさん感が出るため絶対NG。
3. **淡色×淡色の膨張禁止**: S8 生成りワークシャツに淡いグレージュや薄グレー（P3/P9/P13）を合わせると輪郭がぼやけて膨張して見えるため絶対NG。
4. **柄×柄の完全禁止**: チェック・ストライプ・小紋柄シャツ（S5/S6/S9）と柄パンツ（P5/P10/P11）は絶対NG。柄パンツは白無地シャツ（S2/S4/S7）で消化すること。
5. **TPO分離と出社スウェット除外**:
   - 出社時（officeRecommendIds）: ドレス度 3.5 以上を優先。スウェット・ジョガー系（P2/P4/P13/P14/P15：ドレス度 3.0 未満）は出社候補から除外。
   - リモート時（remoteRecommendIds）: 快適度 4.0 以上を優先。
6. **買い足しハブ（黒スラックス等）の優遇**: もし黒の綺麗めテーパードスラックスが追加された場合は、出社相手に困っていたシャツの出社第1〜第2候補ハブとして積極的に組み込んでください。
7. **排他制約**: officeRecommendIds / remoteRecommendIds と ngIds に同一のIDを重複して含めないでください。相手カテゴリの現存IDのみを指定してください。

### 出力スキーマ厳密制約（新規1着分の単一JSONオブジェクトのみを出力すること）
\`\`\`json
{
  "id": "${manualCategory === 'pants' ? nextPantsId : nextShirtId}",
  "category": "${manualCategory === 'pants' ? 'pants' : 'shirt'}",
  "name": "写真から判定した名称",
  "imageUrl": "/images/${manualCategory === 'pants' ? nextPantsId : nextShirtId}.jpg",
  "seasonSleeve": "写真から判定した季節袖丈",
  "dressScore": 4.0,
  "comfortScore": 4.0,
  "officeRecommendIds": [],
  "remoteRecommendIds": [],
  "ngIds": [],
  "ngReason": "なし（またはNG理由）",
  "notes": "写真から読み取った素材感・シルエット・役割の簡潔なメモ"
}
\`\`\`

出力形式: 説明文や前置きは一切含めず、上記スキーマを満たす単一の有効なJSONコードブロック（\`\`\`json ... \`\`\`）のみを出力してください。`;

    navigator.clipboard.writeText(promptText);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 3000);
  };

  // Step 3: JSON適用・自動マージ・写真の本保存・下書き消去・GASアップロード連動
  const handleApplyJson = async () => {
    setImportStatus(null);
    let targetObj: Partial<ClosetItem> | null = draftEditItem;

    if (!targetObj) {
      let raw = jsonInput.trim();
      if (!raw) {
        setImportStatus({
          type: 'error',
          message: 'JSONテキストを貼り付けるか、確認パネルでアイテムを設定してください。',
        });
        return;
      }
      if (raw.startsWith('```json')) {
        raw = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (raw.startsWith('```')) {
        raw = raw.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      try {
        targetObj = JSON.parse(raw);
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : '形式不正';
        setImportStatus({
          type: 'error',
          message: `JSONのパースに失敗しました: ${errMsg}`,
        });
        return;
      }
    }

    const jsonString = JSON.stringify(targetObj);
    const res = importCustomData(jsonString);

    if (res.success) {
      const addedItem = res.addedItem;
      let extraMsg = '';

      // 写真の下書き本保存・GASアップロード・下書き消去（条件1）
      if (currentBlob && addedItem) {
        try {
          // 1. 確定したID（例: P16）で本保存ストアへ永続化 (0ms)
          await saveImageBlob(addedItem.id, currentBlob, Date.now());

          // 2. 専用下書き枠を消去（条件1: 中断ゴミの蓄積防止）
          await clearDraftImage();

          // 3. GAS 設定がある場合は Google ドライブ正本フォルダへ自動アップロード
          if (gasConfig.webAppUrl && previewDataUrl) {
            setImageUploadStatus({
              type: 'uploading',
              text: `Google ドライブへ「${addedItem.id}.jpg」を自動アップロード中...`,
            });
            uploadImageToGas({
              webAppUrl: gasConfig.webAppUrl,
              secretToken: gasConfig.secretToken,
              itemId: addedItem.id,
              dataUrl: previewDataUrl,
            }).then((uploadRes) => {
              if (uploadRes.ok) {
                setImageUploadStatus({
                  type: 'success',
                  text: `Google ドライブへ「${addedItem.id}.jpg」として自動保存しました！`,
                });
              } else {
                setImageUploadStatus({
                  type: 'error',
                  text: `ドライブ保存エラー: ${uploadRes.error || '通信エラー'}（端末内には保存済みです）`,
                });
              }
            });
            extraMsg = '（Google ドライブへ自動アップロード中）';
          } else {
            extraMsg = `（端末内 IndexedDB に「${addedItem.id}」として保存完了）`;
          }
        } catch (imgErr: unknown) {
          console.error('Failed to finalize draft image:', imgErr);
        }
      }

      setImportStatus({
        type: 'success',
        message: addedItem
          ? `「${addedItem.name} (${addedItem.id})」を追加し、相手アイテム ${res.updatedPeersCount || 0}着の相性リストへ自動マージ＆クラウド同期を開始しました！ ${extraMsg}`
          : 'クローゼットデータを適用し、保存しました！',
      });

      // フォームのクリーンアップ
      setJsonInput('');
      setDraftEditItem(null);
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
          新しい服の写真を選ぶだけで、Gemini が種別・名前・袖丈・スコア・既存服との相性を全自動判定します。事前の種別選択や名前入力は不要です。
        </p>
      </div>

      {/* Step 1: Photo selection, draft storage & restore (条件1) */}
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
                    ※ JSON取り込み成功時に確定ID（{nextShirtId} または {nextPantsId}）で本保存・ドライブ同期されます。
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

          {/* Collapsible Manual Override Accordion */}
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
                <span>📋 Gemini相談用プロンプトをコピー（次連番: {nextShirtId} / {nextPantsId}）</span>
              </>
            )}
          </button>
        </div>
      </section>

      {/* Step 3: Apply JSON, Confirmation & Fine-tuning Panel (条件2) */}
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
          Geminiから出力された【1着分のJSON】を貼り付けると、下に確認・微修正パネルが表示されます。内容を確認してマージ＆保存してください。
        </p>

        <div className="pl-8 space-y-3">
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder={`{\n  "id": "${nextShirtId} または ${nextPantsId}",\n  "category": "shirt または pants",\n  "name": "...",\n  "officeRecommendIds": [...],\n  ...\n}`}
            rows={5}
            className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
          />

          {/* Inline Confirmation & Fine-tuning Panel (条件2) */}
          {draftEditItem && (
            <div className="p-4 bg-slate-900/95 border border-indigo-500/50 rounded-2xl space-y-3.5 shadow-2xl">
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

              {/* Category Switcher (条件2: 種別切替時に相性3配列を自動クリア & 注記表示) */}
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

                {/* Alert Banner when category is switched (条件2) */}
                {isCategorySwitched && (
                  <div className="mt-2.5 p-2.5 bg-amber-950/60 border border-amber-800/80 rounded-xl flex items-start gap-2 text-xs text-amber-300">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-400 mt-0.5" />
                    <span>
                      ⚠️ 種別を変更したため、相性リスト（出社◎・リモート○・NG）は未設定（0件）になりました。再度 Gemini に相談するか、このまま追加して後から編集してください。
                    </span>
                  </div>
                )}
              </div>

              {/* Name input */}
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

              {/* Season Sleeve presets */}
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

              {/* Scores (Dress & Comfort) */}
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

              {/* Notes input */}
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

              {/* Compatibility summary chips */}
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

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={handleApplyJson}
              className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/40 flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all"
            >
              <Check className="w-4 h-4" />
              <span>💾 JSONを適用して自動マージ・保存</span>
            </button>

            <button
              onClick={handleDownloadJson}
              className="min-h-[44px] py-2.5 px-3 rounded-xl text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-1.5 transition-colors"
              title="マージ済み最新JSONをダウンロード（src/data/closet.json差し替え用）"
            >
              <Download className="w-4 h-4" />
              <span>JSON保存</span>
            </button>

            <button
              onClick={handleCopyMergedJson}
              className="min-h-[44px] py-2.5 px-3 rounded-xl text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-1.5 transition-colors"
              title="マージ済みJSONをクリップボードにコピー"
            >
              {copiedJson ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copiedJson ? 'コピー済' : 'JSONコピー'}</span>
            </button>

            <button
              onClick={handleReset}
              className="min-h-[44px] py-2.5 px-3 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-300 border border-slate-700 transition-colors"
              title="初期データに戻す"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
