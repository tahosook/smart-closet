---
name: manage-wardrobe
description: >-
  Use this skill when the user requests adding new garments (e.g. S10, P16), updating compatibility
  or NG rules in closet.json, or synchronizing fashion photos into the smart-closet app.
---

# Manage Wardrobe Skill

This skill guides the AI agent to reliably add, update, and validate clothes in the Smart Closet app.

## Workflow Steps

### 1. Place Image Assets in Google Drive
When a new garment photo is provided:
1. **A4 White Paper Standardization:**
   - Photograph the garment with an A4 white sheet of paper (210×297mm) placed beside it.
   - The A4 sheet serves as an optical anchor for automatic white-balance lighting correction, physical dimension estimation (cm), and bounding box detection (`cropBox`).
2. Photos can be directly uploaded from the app's **AiSyncView (Tab 2)**:
   - Selecting a photo in the app automatically resizes/compresses it (JPEG max 1200px, quality 0.85) via HTML5 Canvas.
   - It is immediately saved into a dedicated draft storage slot (`smart_closet_draft_db`) so switching to the Gemini app and back preserves the photo even if the browser tab reloads.
   - The draft slot is strictly isolated from permanent image stores (`STORE_IMAGES` / `STORE_META`) and is immune to `pruneImages` deletion.
   - Upon JSON confirmation, the image is automatically cropped to the standardized `3:4` (`900×1200px`) aspect ratio with `#f8fafc` studio background margins, permanently committed to IndexedDB under the finalized ID (e.g. `P16`), and automatically uploaded to Google Drive as `{ID}.jpg`. The draft slot is then cleared.
   - If uploading manually, place `{ID}.jpg` directly into the private Google Drive folder and run photo sync.
3. **Never commit wardrobe photos to Git or `public/images/`** to preserve complete privacy.

### 2. Update `src/data/closet.json`
Consult **`docs/STYLING_RULES.md`** for 40s male fashion principles, bias analysis, and compatibility criteria.
Add the new item to `items` adhering to the schema:
- `id`: Next sequential ID (e.g. `getNextSequentialId(items, 'pants')` -> `P16`).
- `category`: `"shirt"` or `"pants"`.
- `name`: Clean Japanese name aligning with 12-color palette vocabulary (e.g. `"濃紺テーパードスラックス"`).
- `color`: 12-color palette value (`白`, `生成り`, `黒`, `チャコール`, `ミディアムグレー`, `ライトグレー`, `グレージュ`, `濃紺`, `ブルー`, `淡青`, `オリーブ`, `ブラウン`).
- `imageUrl`: `"/images/<ID>.jpg"`.
- `seasonSleeve`: Chip preset selection (e.g. `"通年"`, `"長袖・通年"`, `"春夏・半袖"`, `"春夏秋・七分袖"`).
- `dressScore`: 1.0 - 5.0 (4.5 for formal slacks, 2.0 for sweatpants).
- `comfortScore`: 1.0 - 5.0.
- `measurements`: Key dimensions estimated from A4 reference (shirts: `bodyLength`, `chestWidth`, `shoulderWidth`, `sleeveLength`; pants: `waist`, `inseam`, `totalLength`, `hemWidth` in cm, 10–200cm, 0.5cm steps) or omitted if not visible.
- `officeRecommendIds`: Array of compatible shirt/pants IDs for office work.
- `remoteRecommendIds`: Array of compatible shirt/pants IDs for remote/casual.
- `ngIds`: Array of conflicting IDs based on the 40s male fashion principles.
- `ngReason`: Clear explanation of why pairs in `ngIds` look bad (e.g. "同系色濃紺による作業着見え").
- `notes`: Short role summary (e.g. "【万能出社エース】会食・出社").

**Batch Color Updates:**
To update colors across multiple existing garments without touching names or compatibility matrices, copy the batch consultation prompt from Tab 2 backup accordion and import `{ "colorUpdates": [{ "id": "...", "color": "..." }] }`.

**Deterministic Single-Item Merge:**
When importing a single item JSON (via AiSyncView or `mergeSingleItemIntoClosetData`), the app deterministically updates bidirectional references without modifying any existing $S_i \times P_j$ relationships. If updating `closet.json` manually in Git, ensure existing items' arrays are symmetrically updated.

### 3. Run Validation and Build
Always run:
```bash
npm run check
```
Verify 0 errors before reporting completion.
