# Smart Closet PWA (`smart-closet`)

毎朝1秒で奥様からのダメ出しを完全回避し、その日の服が決まる自分専用スマートクローゼットPWA。

---

## 1. 開発・検証・ビルド手順

```bash
# 依存パッケージのインストール
npm install

# ローカル開発サーバー起動 (Mac mini での確認用)
npm run dev

# データ整合性 + 型チェック + 本番ビルドの一括完全検証（DoD基準）
npm run check

# 本番ビルド (dist/ 出力)
npm run build

# 画像同期（~/Downloads から public/images/ への一括同期・リネーム）
npm run sync-images

# データ整合性・画像存在・Escape Hatch スキャン単体実行
npm run validate-data
```

---

## 2. 新しい服を買った時のアップデート手順

### パターンA: Google AI Pro（Gemini）手動連携フロー
1. 新しい服の写真を撮影し、次の連番ID（シャツなら `S10.jpg`、パンツなら `P16.jpg`）にリネームして `public/images/` に配置する。
2. アプリの **「服追加・AI」タブ** を開き、新アイテムのカテゴリ・名前・特徴メモを入力して **［📋 Gemini相談用プロンプト＆データをコピー］** を押す（奥様NGマージ済みの最新データと `docs/STYLING_RULES.md` 準拠の指示文がコピーされます）。
3. Google AI Pro（Gemini）を開き、コピーしたプロンプトと写真を送信する。
4. Geminiから出力されたJSONをコピーし、アプリの「JSONを貼り付けて適用」で動作確認する。
5. 画面上の **［JSON保存］** を押してダウンロードした `closet.json` を `src/data/closet.json` に上書き保存する。
6. `npm run check` を実行してエラー0件を確認し、Gitコミット＆プッシュする。

### パターンB: Antigravity AI エージェントによる全自動追加
1. 新しい服の写真を `~/Downloads/` または作業フォルダに保存する。
2. Antigravity チャットで「この写真で P16（黒スラックス）を追加して」と指示する。
3. エージェントが組み込みスキル `manage-wardrobe` を実行し、画像の配置、`closet.json` の相性ルール計算・更新、`npm run check` の検証までを自動実行します。

---

## 3. Cloudflare Pages デプロイ設定

* **Framework preset:** `Vite`
* **Build command:** `npm run build`
* **Build output directory:** `dist`
* **Node.js version:** `20` (またはそれ以降)
* **セキュリティ:** 個人利用のため、Cloudflare Zero Trust (Access) を設定し、本人の Google アカウントのみアクセス許可することを推奨。

---

## 4. ドキュメント一覧

- **[AGENTS.md](./AGENTS.md):** AIコーディングエージェント（Antigravity等）向けの開発憲法・禁止事項・DoD。
- **[docs/SPECIFICATION.md](./docs/SPECIFICATION.md):** 画面仕様・レスポンシブ要件・データモデル・推薦ロジック詳細定義書。
- **[docs/STYLING_RULES.md](./docs/STYLING_RULES.md):** 40代男性の鉄壁3原則（配色・柄・TPO）・初期24着偏り分析・買い足し指針。
