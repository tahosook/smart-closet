## Summary

- 

## Design Conditions Checklist / 設計条件チェックリスト

- [ ] **地図・用語先行の原則:** 新しい入口・機能・用語を追加・変更した場合、まず `docs/FEATURE_MAP.md`（本拠地・統一用語集）を更新したか？
- [ ] **仕様書の同期:** `docs/SPECIFICATION.md` に画面挙動・データモデル・ロジックの最新実態を反映したか（陳腐化した記述を残していないか）？
- [ ] **全体見直し4原則の遵守:**
  - [ ] Single Home（機能の本拠地は1か所か、不要な重複操作UIを作っていないか）
  - [ ] Unified Vocabulary（全画面・プロンプトで `FEATURE_MAP.md` の統一用語を使用しているか）
  - [ ] Progressive Disclosure（日常の朝1秒即決を阻害せず、低頻度操作は適切に格納されているか）
  - [ ] Zero Cognitive Load（複雑な保護・ルーティングをユーザーに暗記させていないか）
- [ ] **共通部品の再利用:** 既存の共通UI部品（`FilterPillBar`, `FullscreenPhotoViewer`, `GarmentActionButtons`）を活用し、独自の重複実装を行っていないか？
- [ ] **GAS再デプロイ要否:** `gas/Code.gs` を変更した場合、本番 Web アプリの再デプロイ手順（既存デプロイのバージョン更新）を明記したか？（変更なしの場合は「変更なし」）
- [ ] **完全検証:** `npm run check` が exit code 0 でパスすることを確認したか？

## Device Verification Record / 実機確認記録 (P5)

- **対象変更の有無:** [ ] UI・画面挙動・同期の変更あり / [ ] ドキュメント・CI・設定のみ（実機確認対象外）
- **Pixel 9a（モバイル・片手操作・44x44pxタップ領域）:** 未実施 / 確認済（確認内容・結果: ）
- **Mac mini（デスクトップ・2ペイン表示・相性表）:** 未実施 / 確認済（確認内容・結果: ）

## Post-Merge GAS Redeployment & Production Verification / マージ後GAS再デプロイ・本番確認記録 (P7)

- **`gas/Code.gs` の変更有無:** [ ] 変更なし（再デプロイ不要） / [ ] 変更あり（マージ後に以下の記録を記入）
- **既存 Web アプリデプロイの新バージョン更新（URL不変）:** 未実施 / 実施済（実施日時・バージョン: ）
- **本番確認①（トークンなし GET で Fail-Closed 認証エラー JSON が返ること）:** 未確認 / 確認済（結果: ）
- **本番確認②（実機の「今すぐ同期」がエラーなく完了すること）:** 未確認 / 確認済（結果: ）
