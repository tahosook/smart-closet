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
