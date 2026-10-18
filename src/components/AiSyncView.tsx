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
} from 'lucide-react';
import { useClosetStore } from '../hooks/useClosetStore';

export const AiSyncView: React.FC = () => {
  const { closetData, shirts, pants, importCustomData, resetToDefaultData } = useClosetStore();

  const [copied, setCopied] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Suggest next IDs
  const nextShirtId = `S${shirts.length + 1}`;
  const nextPantsId = `P${pants.length + 1}`;

  // Generate Gemini prompt with current active JSON data
  const handleCopyPromptAndData = () => {
    const promptText = `あなたは40代後半男性（オフィス出社・リモートワーク併用）専属のプロスタイリストAIです。
以下の「スマートクローゼットのマスターJSONデータ」に、新しく撮影した服（添付写真または説明）を追加し、既存の服との相性・NG判定を更新した【完全な更新後JSON】を出力してください。

### 判定・スタイリング方針（最重要：奥様からのダメ出しを完全回避すること）
1. **上下ネイビー/濃紺の同系色NG**: 上下ともに濃紺・インディゴになる組み合わせは「作業着・パジャマ見え」するため絶対NG（ngIdsに追加、ngReasonを明記）。
2. **柄×柄の衝突NG**: チェック、ストライプ、小紋柄同士はチグハグになるため絶対NG。柄物には白無地シャツを優先推奨。
3. **ぼやけ・膨張NG**: 生成りワークシャツ等の淡いアースカラーと、淡いグレー/グレージュパンツは輪郭がぼやけて太って見えるためNG。
4. **ドレス度・快適度スコア**: 1.0〜5.0（出社スラックスは4.0〜4.5、スウェットは1.5〜2.0）。
5. **双方向整合性**: 新規アイテムを追加した際は、関係する既存アイテムの officeRecommendIds / remoteRecommendIds / ngIds も必要に応じて相互更新してください。

### 現在の closet.json データ:
\`\`\`json
${JSON.stringify(closetData, null, 2)}
\`\`\`

出力形式: 説明文は含めず、上記スキーマを満たす単一の有効なJSONコードブロック（\`\`\`json ... \`\`\`）のみを出力してください。`;

    navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
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
    const blob = new Blob([JSON.stringify(closetData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'closet.json';
    a.click();
    URL.revokeObjectURL(url);
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

      {/* Step 2 */}
      <section className="bg-slate-800/80 border border-slate-700/70 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
            2
          </span>
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <FileCode className="w-4 h-4 text-indigo-400" />
            Gemini相談用プロンプト＆データをコピー
          </h3>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed pl-8">
          ワンクリックで「40代男性のNGルール指示文」と「現在の全{closetData.items.length}着のJSON」がクリップボードにコピーされます。Geminiアプリに写真と一緒に貼り付けて送信してください。
        </p>

        <div className="pl-8">
          <button
            onClick={handleCopyPromptAndData}
            className={`w-full py-3 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg ${
              copied
                ? 'bg-emerald-600 text-white'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/40 active:scale-[0.98]'
            }`}
          >
            {copied ? (
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

      {/* Step 3 */}
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
              title="ローカルのsrc/data/closet.json差し替え用にダウンロード"
            >
              <Download className="w-4 h-4" />
              <span>JSON保存</span>
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
