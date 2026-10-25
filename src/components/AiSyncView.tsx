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
  Tag,
  FileText,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import { useClosetStore } from '../hooks/useClosetStore';
import { Category } from '../types/closet';
import { getNextSequentialId } from '../utils/closetDomain';
import { saveImageBlob, getImageBlob } from '../utils/imageStore';
import {
  processGarmentImage,
  uploadImageToGas,
  downloadBlobAsFile,
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

  // New item form state
  const [newCategory, setNewCategory] = useState<Category>('pants');
  const [newItemName, setNewItemName] = useState('');
  const [newItemNotes, setNewItemNotes] = useState('');
  const [newItemSleeve, setNewItemSleeve] = useState('通年');

  // Photo state
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [currentBlob, setCurrentBlob] = useState<Blob | null>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [imageUploadStatus, setImageUploadStatus] = useState<{
    type: 'idle' | 'uploading' | 'success' | 'error';
    text: string;
  }>({ type: 'idle', text: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Suggest next sequential IDs using getNextSequentialId
  const nextShirtId = getNextSequentialId(mergedClosetData.items, 'shirt');
  const nextPantsId = getNextSequentialId(mergedClosetData.items, 'pants');
  const targetId = newCategory === 'shirt' ? nextShirtId : nextPantsId;

  // カテゴリ変更時に季節・袖丈のデフォルト値を連動
  const handleCategoryChange = (cat: Category) => {
    setNewCategory(cat);
    if (cat === 'shirt') {
      if (!SHIRT_SLEEVE_PRESETS.includes(newItemSleeve)) {
        setNewItemSleeve(SHIRT_SLEEVE_PRESETS[0]);
      }
    } else {
      if (!PANTS_SLEEVE_PRESETS.includes(newItemSleeve)) {
        setNewItemSleeve(PANTS_SLEEVE_PRESETS[0]);
      }
    }
  };

  // 既存の保存済み画像があればプレビューに読み込む
  useEffect(() => {
    let isMounted = true;
    getImageBlob(targetId).then((blob) => {
      if (!isMounted) return;
      if (blob) {
        setCurrentBlob(blob);
        setPreviewDataUrl(URL.createObjectURL(blob));
      } else {
        setCurrentBlob(null);
        setPreviewDataUrl(null);
      }
    });
    setImageUploadStatus({ type: 'idle', text: '' });
    return () => {
      isMounted = false;
    };
  }, [targetId]);

  // 写真ファイル選択ハンドラー（クライアント圧縮 + IndexedDB即時保存 + GAS自動アップロード）
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

      // 2. 端末の IndexedDB に 0ms で即時保存（ローカルファースト）
      await saveImageBlob(targetId, blob, Date.now());

      // 3. GAS 設定がある場合は Google ドライブへ直接アップロード (条件1・2遵守)
      if (gasConfig.webAppUrl) {
        setImageUploadStatus({
          type: 'uploading',
          text: 'Google ドライブへ自動アップロード中...',
        });
        const uploadRes = await uploadImageToGas({
          webAppUrl: gasConfig.webAppUrl,
          secretToken: gasConfig.secretToken,
          itemId: targetId,
          dataUrl,
        });

        if (uploadRes.ok) {
          setImageUploadStatus({
            type: 'success',
            text: `Google ドライブの非公開フォルダへ「${targetId}.jpg」として自動保存しました！`,
          });
        } else {
          setImageUploadStatus({
            type: 'error',
            text: `ドライブ保存エラー: ${uploadRes.error || '通信エラー'}（端末内には保存済みです）`,
          });
        }
      } else {
        setImageUploadStatus({
          type: 'success',
          text: `端末内（IndexedDB）に「${targetId}」として写真を保存しました。`,
        });
      }
    } catch (err: any) {
      console.error('Image processing failed:', err);
      setImageUploadStatus({
        type: 'error',
        text: err?.message || '写真の処理に失敗しました。',
      });
    } finally {
      setIsProcessingImage(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 手元で {targetId}.jpg を端末保存するハンドラー
  const handleDownloadImage = () => {
    if (!currentBlob) return;
    downloadBlobAsFile(currentBlob, `${targetId}.jpg`);
  };

  // 単一アイテム出力に絞った軽量 Gemini プロンプトの生成
  const handleCopyPromptAndData = () => {
    // 相手カテゴリのアイテムサマリー一覧（既存配列を除いた軽量コンテキスト）
    const targetCategory = newCategory === 'shirt' ? 'pants' : 'shirt';
    const peerItems = mergedClosetData.items.filter(
      (item) => item.category === targetCategory
    );

    const peerSummaryText = peerItems
      .map(
        (item) =>
          `- [${item.id}] ${item.name}（${item.seasonSleeve}、ドレス度${item.dressScore}、快適度${item.comfortScore}）: ${item.notes}`
      )
      .join('\n');

    const itemInfoText = newItemName
      ? `【新規追加する服の情報】
- ID: ${targetId}
- カテゴリ: ${newCategory === 'shirt' ? 'シャツ (shirt)' : 'パンツ (pants)'}
- アイテム名: ${newItemName}
- 季節・袖丈: ${newItemSleeve}
- 特徴・素材・シルエット: ${newItemNotes || '特になし'}
- 写真ファイル名: ${targetId}.jpg (imageUrl には互換性のため "/images/${targetId}.jpg" を指定)`
      : `【新規追加する服の情報】
- ID: ${targetId}
- カテゴリ: ${newCategory === 'shirt' ? 'シャツ (shirt)' : 'パンツ (pants)'}
- 季節・袖丈: ${newItemSleeve}
- 特徴: 添付の写真を参照してアイテム名・特徴・スコアを判定してください。
- 写真ファイル名: ${targetId}.jpg (imageUrl には互換性のため "/images/${targetId}.jpg" を指定)`;

    const promptText = `あなたは40代後半男性（オフィス出社・リモートワーク併用）専属のプロスタイリストAIです。
以下の「新規追加する服の情報」を、現在のワードローブ（相手${targetCategory === 'shirt' ? 'シャツ' : 'パンツ'}一覧）と照らし合わせ、相性・NGを判定した【新規1着分のみのJSONオブジェクト】を出力してください。
（※全体データではなく、新規追加する1着分のみを単一JSONオブジェクトとして出力してください。双方向のリンク更新はアプリ側で自動マージされます）

${itemInfoText}

### 組み合わせる相手の現有${targetCategory === 'shirt' ? 'シャツ' : 'パンツ'}一覧:
${peerSummaryText}

### 判定・スタイリング絶対原則（奥様からのダメ出しを完全回避すること）
1. **同系色・濃紺同士の禁止**: 上下ともに濃紺・インディゴになる組み合わせ（例: S1 濃インディゴ × P1/P5/P6/P8/P11 濃紺系パンツ）は作業着・パジャマに見えるため絶対NG（ngIdsに追加、ngReasonを明記）。
2. **淡青×青デニムの禁止**: S3 サックスシャンブレーに薄青・ブルーデニム（P4/P7/P15）を合わせると全身が水色で繋がり休日のおじさん感が出るため絶対NG。
3. **淡色×淡色の膨張禁止**: S8 生成りワークシャツに淡いグレージュや薄グレー（P3/P9/P13）を合わせると輪郭がぼやけて膨張して見えるため絶対NG。
4. **柄×柄の完全禁止**: チェック・ストライプ・小紋柄シャツ（S5/S6/S9）と柄パンツ（P5/P10/P11）は絶対NG。柄パンツは白無地シャツ（S2/S4/S7）で消化すること。
5. **TPO分離と出社スウェット除外**:
   - 出社時（officeRecommendIds）: ドレス度 3.5 以上を優先。スウェット・ジョガー系（P2/P4/P13/P14/P15：ドレス度 3.0 未満）は出社候補から除外。
   - リモート時（remoteRecommendIds）: 快適度 4.0 以上を優先。
6. **買い足しハブ（黒スラックス等）の優遇**: もし黒の綺麗めテーパードスラックスが追加された場合は、出社相手に困っていたシャツの出社第1〜第2候補ハブとして積極的に組み込んでください。
7. **排他制約**: officeRecommendIds / remoteRecommendIds と ngIds に同一のIDを重複して含めないでください。

### 出力スキーマ厳密制約（新規1着分の単一JSONオブジェクトのみを出力すること）
\`\`\`json
{
  "id": "${targetId}",
  "category": "${newCategory}",
  "name": "${newItemName || 'アイテム名'}",
  "imageUrl": "/images/${targetId}.jpg",
  "seasonSleeve": "${newItemSleeve}",
  "dressScore": 4.0,
  "comfortScore": 4.0,
  "officeRecommendIds": [],
  "remoteRecommendIds": [],
  "ngIds": [],
  "ngReason": "なし（またはNG理由）",
  "notes": "役割・特徴の簡潔なメモ"
}
\`\`\`

出力形式: 説明文や前置きは一切含めず、上記スキーマを満たす単一の有効なJSONコードブロック（\`\`\`json ... \`\`\`）のみを出力してください。`;

    navigator.clipboard.writeText(promptText);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 3000);
  };

  const handleApplyJson = () => {
    setImportStatus(null);
    let raw = jsonInput.trim();
    if (!raw) {
      setImportStatus({
        type: 'error',
        message: 'JSONテキストを貼り付けてください。',
      });
      return;
    }

    // Strip markdown code block if present
    if (raw.startsWith('```json')) {
      raw = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (raw.startsWith('```')) {
      raw = raw.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const res = importCustomData(raw);
    if (res.success) {
      if (res.mode === 'single' && res.addedItem) {
        setImportStatus({
          type: 'success',
          message: `「${res.addedItem.name} (${res.addedItem.id})」を追加し、相手アイテム ${res.updatedPeersCount || 0}着の相性リストへ自動マージ＆クラウド同期を開始しました！`,
        });
      } else {
        setImportStatus({
          type: 'success',
          message: 'クローゼットデータを適用し、保存しました！',
        });
      }
      setJsonInput('');
    } else {
      setImportStatus({
        type: 'error',
        message:
          res.error || 'JSONの検証に失敗しました。形式を確認してください。',
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
          <span>服の追加・AI再検討 (Add & AI Sync)</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          新しい服を購入した際、Gemini Pro に写真と現在のデータを渡すだけで、40代男性の配色理論に基づいたおすすめ・NG判定を自動再計算して取り込めます。
        </p>
      </div>

      {/* Step 1: Photo selection, automatic normalization & direct upload */}
      <section className="bg-slate-800/80 border border-slate-700/70 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
            1
          </span>
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <Camera className="w-4 h-4 text-sky-400" />
            服の写真を選択・自動保存 (ID: {targetId})
          </h3>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed pl-8">
          スマホの写真を選択またはカメラ撮影すると、自動で「<strong className="text-amber-400 font-mono">{targetId}.jpg</strong>」にリサイズ・最適化され、端末（IndexedDB）へ即座に保存されます。
        </p>

        <div className="pl-8 space-y-3">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept="image/*"
            className="hidden"
          />

          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
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
                  <span>📷 写真を選択 / 撮影する</span>
                </>
              )}
            </button>

            {currentBlob && (
              <button
                type="button"
                onClick={handleDownloadImage}
                className="min-h-[44px] py-2.5 px-3 rounded-xl text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-1.5 transition-colors border border-slate-600"
                title={`${targetId}.jpg として端末にダウンロード保存`}
              >
                <Download className="w-4 h-4 text-sky-400" />
                <span>{targetId}.jpg 保存</span>
              </button>
            )}
          </div>

          {/* Photo Preview & Status */}
          {previewDataUrl && (
            <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-700/60 flex items-center gap-3">
              <div className="w-16 h-20 rounded-lg overflow-hidden bg-slate-950 flex-shrink-0 border border-slate-700">
                <img
                  src={previewDataUrl}
                  alt={targetId}
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-white font-mono">{targetId}.jpg</span>
                  <span className="text-[10px] bg-sky-950 text-sky-300 border border-sky-800 px-1.5 py-0.2 rounded font-bold">
                    端末内保存済
                  </span>
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
                  <p className="text-[10px] text-slate-400">
                    ※ 端末内（IndexedDB）にキャッシュ保存されています。
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Step 2: New Item Input & Single Item Prompt Copy */}
      <section className="bg-slate-800/80 border border-slate-700/70 rounded-2xl p-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
            2
          </span>
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <FileCode className="w-4 h-4 text-indigo-400" />
            特徴入力＆Gemini相談プロンプト生成（1着分のみ）
          </h3>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed pl-8">
          追加する服のカテゴリや季節・袖丈を選択すると、40代男性のNGルールと相手アイテム一覧が組み込まれた【新規1着分出力用】相談プロンプトを生成します。
        </p>

        <div className="pl-8 space-y-3">
          {/* Category selection */}
          <div>
            <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5 mb-1.5">
              <Tag className="w-3.5 h-3.5 text-blue-400" />
              <span>アイテム種別（自動採番ID: <strong className="text-amber-400 font-mono">{targetId}</strong>）</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleCategoryChange('pants')}
                className={`min-h-[44px] py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                  newCategory === 'pants'
                    ? 'bg-emerald-600/80 text-white border-emerald-500 shadow-md shadow-emerald-950'
                    : 'bg-slate-900/60 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                パンツ ({nextPantsId})
              </button>
              <button
                type="button"
                onClick={() => handleCategoryChange('shirt')}
                className={`min-h-[44px] py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                  newCategory === 'shirt'
                    ? 'bg-blue-600/80 text-white border-blue-500 shadow-md shadow-blue-950'
                    : 'bg-slate-900/60 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                シャツ ({nextShirtId})
              </button>
            </div>
          </div>

          {/* Item Name Input */}
          <div>
            <label className="text-[11px] font-bold text-slate-300 mb-1 block">
              アイテム名 (例: 黒テーパードスラックス)
            </label>
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder={newCategory === 'pants' ? '黒テーパードスラックス' : 'ストライプ長袖シャツ'}
              className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Structured Season/Sleeve Chips */}
          <div>
            <label className="text-[11px] font-bold text-slate-300 mb-1.5 flex items-center justify-between">
              <span>季節・袖丈（チップ選択）</span>
              <span className="text-[10px] text-blue-400 font-mono">現在: {newItemSleeve}</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(newCategory === 'shirt' ? SHIRT_SLEEVE_PRESETS : PANTS_SLEEVE_PRESETS).map(
                (preset) => {
                  const isSelected = newItemSleeve === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setNewItemSleeve(preset)}
                      className={`min-h-[44px] py-2.5 px-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center text-center ${
                        isSelected
                          ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-900/40 ring-1 ring-blue-400'
                          : 'bg-slate-900/70 text-slate-400 border-slate-700/80 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      {preset}
                    </button>
                  );
                }
              )}
            </div>
          </div>

          {/* Notes Input */}
          <div>
            <label className="text-[11px] font-bold text-slate-300 mb-1 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-indigo-400" />
              <span>特徴・素材・シルエット・役割メモ (任意)</span>
            </label>
            <input
              type="text"
              value={newItemNotes}
              onChange={(e) => setNewItemNotes(e.target.value)}
              placeholder="センタープレス、ストレッチ、自宅洗濯可、S1等の出社エース候補"
              className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
            />
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
                <span>コピー完了！ Gemini に貼り付けてください</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>📋 Gemini相談用プロンプトをコピー（1着分のみ出力）</span>
              </>
            )}
          </button>
        </div>
      </section>

      {/* Step 3: Apply JSON & Export */}
      <section className="bg-slate-800/80 border border-slate-700/70 rounded-2xl p-4 space-y-3">
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
          Geminiから出力された【1着分のJSON】を貼り付けると、アプリ側で既存服の相性配列を決定論的に自動マージし、即座にクラウド同期します。
        </p>

        <div className="pl-8 space-y-3">
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder={`{\n  "id": "${targetId}",\n  "category": "${newCategory}",\n  "name": "...",\n  "officeRecommendIds": [...],\n  ...\n}`}
            rows={6}
            className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
          />

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
