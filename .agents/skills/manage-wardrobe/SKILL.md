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
1. Photos can be directly uploaded from the app's **AiSyncView (Tab 2)**:
   - Selecting a photo in the app automatically resizes/compresses it (JPEG max 1200px, quality 0.85) via HTML5 Canvas.
   - It is saved to browser `IndexedDB` with 0ms latency for immediate display.
   - If GAS cloud sync is connected, it is automatically uploaded to the user's private Google Drive folder as `{ID}.jpg` (e.g. `P16.jpg` or `S10.jpg`).
   - If uploading manually, place `{ID}.jpg` directly into the private Google Drive folder and run photo sync.
2. **Never commit wardrobe photos to Git or `public/images/`** to preserve complete privacy.

### 2. Update `src/data/closet.json`
Consult **`docs/STYLING_RULES.md`** for 40s male fashion principles, bias analysis, and compatibility criteria.
Add the new item to `items` adhering to the schema:
- `id`: Next sequential ID (e.g. `getNextSequentialId(items, 'pants')` -> `P16`).
- `category`: `"shirt"` or `"pants"`.
- `name`: Clean Japanese name (e.g. `"黒テーパードスラックス"`).
- `imageUrl`: `"/images/<ID>.jpg"`.
- `seasonSleeve`: Chip preset selection (e.g. `"通年"`, `"長袖・通年"`, `"春夏・半袖"`, `"春夏秋・七分袖"`).
- `dressScore`: 1.0 - 5.0 (4.5 for formal slacks, 2.0 for sweatpants).
- `comfortScore`: 1.0 - 5.0.
- `officeRecommendIds`: Array of compatible shirt/pants IDs for office work.
- `remoteRecommendIds`: Array of compatible shirt/pants IDs for remote/casual.
- `ngIds`: Array of conflicting IDs based on the 40s male fashion principles.
- `ngReason`: Clear explanation of why pairs in `ngIds` look bad (e.g. "同系色濃紺による作業着見え").
- `notes`: Short role summary (e.g. "【万能出社エース】会食・出社").

**Deterministic Single-Item Merge:**
When importing a single item JSON (via AiSyncView or `mergeSingleItemIntoClosetData`), the app deterministically updates bidirectional references without modifying any existing $S_i \times P_j$ relationships. If updating `closet.json` manually in Git, ensure existing items' arrays are symmetrically updated.

### 3. Run Validation and Build
Always run:
```bash
npm run check
```
Verify 0 errors before reporting completion.
