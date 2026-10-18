import React, { useState } from 'react';
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
} from 'lucide-react';
import { useClosetStore } from '../hooks/useClosetStore';
import { Category } from '../types/closet';

export const AiSyncView: React.FC = () => {
  const {
    mergedClosetData,
    wifeNgPairs,
    shirts,
    pants,
    importCustomData,
    resetToDefaultData,
  } = useClosetStore();

  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // New item form state
  const [newCategory, setNewCategory] = useState<Category>('pants');
  const [newItemName, setNewItemName] = useState('');
  const [newItemNotes, setNewItemNotes] = useState('');
  const [newItemSleeve, setNewItemSleeve] = useState('通年');

  // Suggest next sequential IDs
  const nextShirtId = `S${shirts.length + 1}`;
  const nextPantsId = `P${pants.length + 1}`;
  const targetId = newCategory === 'shirt' ? nextShirtId : nextPantsId;

  // Generate Gemini prompt with new item info and merged JSON data (incorporating wifeNgPairs)
  const handleCopyPromptAndData = () => {
    const itemInfoText = newItemName
      ? `【新規追加する服の情報】
- ID: ${targetId}
- カテゴリ: ${newCategory === 'shirt' ? 'シャツ (shirt)' : 'パンツ (pants)'}
- アイテム名: ${newItemName}
- 季節・袖丈: ${newItemSleeve}
- 特徴・素材・シルエット: ${newItemNotes || '特になし'}
- 画像配置パス: /images/${targetId}.jpg`
      : `【新規追加する服の情報】
- ID: ${targetId}
- カテゴリ: ${newCategory === 'shirt' ? 'シャツ (shirt)' : 'パンツ (pants)'}
- 特徴: 添付の写真を参照してアイテム名・特徴・スコアを判定してください。
- 画像配置パス: /images/${targetId}.jpg`;

    const promptText = `あなたは40代後半男性（オフィス出社・リモートワーク併用）専属のプロスタイリストAIです。
以下の「新規追加する服の情報」を、現在の「スマートクローゼットのマスターJSONデータ」に追加し、既存の服との相性・NG判定を更新した【完全な更新後JSON】を出力してください。

${itemInfoText}

### 判定・スタイリング絶対原則（奥様からのダメ出しを完全回避すること）
1. **同系色・濃紺同士の禁止**: 上下ともに濃紺・インディゴになる組み合わせ（例: S1 濃インディゴ × P1/P5/P6/P8/P11 濃紺系パンツ）は作業着・パジャマに見えるため絶対NG（ngIdsに追加、ngReasonを明記）。
2. **淡青×青デニムの禁止**: S3 サックスシャンブレーに薄青・ブルーデニム（P4/P7/P15）を合わせると全身が水色で繋がり休日のおじさん感が出るため絶対NG。
3. **淡色×淡色の膨張禁止**: S8 生成りワークシャツに淡いグレージュや薄グレー（P3/P9/P13）を合わせると輪郭がぼやけて膨張して見えるため絶対NG。
4. **柄×柄の完全禁止**: チェック・ストライプ・小紋柄シャツ（S5/S6/S9）と柄パンツ（P5/P10/P11）は絶対NG。柄パンツは白無地シャツ（S2/S4/S7）で消化すること。
5. **TPO分離と出社スウェット除外**:
   - 出社時（officeRecommendIds）: ドレス度 3.5 以上（P8濃紺、P9グレー、P3グレージュ、P12オリーブ等）を優先。スウェット・ジョガー系（P2/P4/P13/P14/P15：ドレス度 3.0 未満）は出社候補から除外。
   - リモート時（remoteRecommendIds）: 快適度 4.0 以上を優先。
6. **買い足しハブ（黒スラックス等）の優遇**: もし黒の綺麗めテーパードスラックスが追加された場合は、S1濃紺、S3サックス、S5小紋柄、S8生成りなど、出社相手に困っていた全シャツの出社第1〜第2候補ハブとして積極的に組み込んでください。
7. **双方向整合性の保持**: 新規アイテムを追加した際は、関係する既存アイテムの officeRecommendIds / remoteRecommendIds / ngIds も相互に更新し、RecommendとngIdsが重複しないようにしてください。

### 現在のマスターJSONデータ（奥様NG反映済み）:
\`\`\`json
${JSON.stringify(mergedClosetData, null, 2)}
\`\`\`

出力形式: 説明文や前置きは含めず、上記スキーマを満たす単一の有効なJSONコードブロック（\`\`\`json ... \`\`\`）のみを出力してください。`;

    navigator.clipboard.writeText(promptText);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 3000);
  };

  const handleApplyJson = () => {
    setImportStatus(null);
    let raw = jsonInput.trim();
    if (!raw) {
      setImportStatus({ type: 'error', message: 'JSONテキストを貼り付けてください。' });
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
      setImportStatus({
        type: 'success',
        message: '新しいクローゼットデータを適用し、保存しました！',
      });
      setJsonInput('');
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
      setImportStatus({ type: 'success', message: '初期マスターデータにリセットしました。' });
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

      {/* Step 1 */}
      <section className="bg-slate-800/80 border border-slate-700/70 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
            1
          </span>
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <Camera className="w-4 h-4 text-sky-400" />
            服の写真を撮影・保存
          </h3>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed pl-8">
          服を平置きまたはハンガーにかけ、スマホで撮影します。
        </p>

        <div className="pl-8 bg-slate-900/60 p-3 rounded-xl border border-slate-700/50 text-xs space-y-1.5">
          <div className="text-slate-400">推奨ファイル名:</div>
          <div className="flex flex-wrap gap-2">
            <span className="px-2.5 py-1 bg-slate-800 rounded-lg text-blue-400 font-mono font-bold">
              シャツ: public/images/{nextShirtId}.jpg
            </span>
            <span className="px-2.5 py-1 bg-slate-800 rounded-lg text-emerald-400 font-mono font-bold">
              パンツ: public/images/{nextPantsId}.jpg
            </span>
          </div>
          <p className="text-[11px] text-slate-400 pt-1">
            ※ Antigravityに「この写真で {nextPantsId} を追加して」とチャットで依頼することでも全自動で完了できます。
          </p>
        </div>
      </section>

      {/* Step 2: New Item Input & Prompt Copy */}
      <section className="bg-slate-800/80 border border-slate-700/70 rounded-2xl p-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
            2
          </span>
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <FileCode className="w-4 h-4 text-indigo-400" />
            新アイテムの特徴入力＆Gemini相談プロンプト生成
          </h3>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed pl-8">
          追加する服のカテゴリや特徴を入力すると、40代男性のNGルールと最新マスターデータが組み込まれた相談用プロンプトを生成します。
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
                onClick={() => setNewCategory('pants')}
                className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                  newCategory === 'pants'
                    ? 'bg-emerald-600/80 text-white border-emerald-500 shadow-md shadow-emerald-950'
                    : 'bg-slate-900/60 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                パンツ ({nextPantsId})
              </button>
              <button
                type="button"
                onClick={() => setNewCategory('shirt')}
                className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                  newCategory === 'shirt'
                    ? 'bg-blue-600/80 text-white border-blue-500 shadow-md shadow-blue-950'
                    : 'bg-slate-900/60 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                シャツ ({nextShirtId})
              </button>
            </div>
          </div>

          {/* Name & Season/Sleeve Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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
            <div>
              <label className="text-[11px] font-bold text-slate-300 mb-1 block">
                季節・袖丈 (例: 通年, 春夏・半袖)
              </label>
              <input
                type="text"
                value={newItemSleeve}
                onChange={(e) => setNewItemSleeve(e.target.value)}
                placeholder="通年"
                className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
              />
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

          {/* Wife NG Merge notice if any */}
          {wifeNgPairs.length > 0 && (
            <div className="p-2.5 bg-rose-950/40 border border-rose-800/40 rounded-xl flex items-center gap-2 text-[11px] text-rose-300">
              <ShieldCheck className="w-4 h-4 flex-shrink-0 text-rose-400" />
              <span>
                ブラウザで登録された<strong>奥様NG（{wifeNgPairs.length}件）</strong>をマージした最新JSONをプロンプトに組み込みます。
              </span>
            </div>
          )}

          {/* Copy Prompt Button */}
          <button
            onClick={handleCopyPromptAndData}
            className={`w-full py-3 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg ${
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
                <span>📋 Gemini相談用プロンプト＆データをコピー</span>
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
          Geminiから出力された新しいJSONコードを貼り付け、保存ボタンを押すと即座に反映されます。
        </p>

        <div className="pl-8 space-y-3">
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder='{"items": [ ... ]}'
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
              className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/40 flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all"
            >
              <Check className="w-4 h-4" />
              <span>💾 JSONを適用して上書き保存</span>
            </button>

            <button
              onClick={handleDownloadJson}
              className="py-2.5 px-3 rounded-xl text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-1.5 transition-colors"
              title="奥様NGマージ済みJSONをダウンロード（src/data/closet.json差し替え用）"
            >
              <Download className="w-4 h-4" />
              <span>JSON保存</span>
            </button>

            <button
              onClick={handleCopyMergedJson}
              className="py-2.5 px-3 rounded-xl text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-1.5 transition-colors"
              title="マージ済みJSONをクリップボードにコピー"
            >
              {copiedJson ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copiedJson ? 'コピー済' : 'JSONコピー'}</span>
            </button>

            <button
              onClick={handleReset}
              className="py-2.5 px-3 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-300 border border-slate-700 transition-colors"
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
