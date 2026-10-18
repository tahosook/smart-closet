---
name: manage-wardrobe
description: >-
  Use this skill when the user requests adding new garments (e.g. S10, P16), updating compatibility
  or NG rules in closet.json, or synchronizing fashion photos into the smart-closet app.
---

# Manage Wardrobe Skill

This skill guides the AI agent to reliably add, update, and validate clothes in the Smart Closet app.

## Workflow Steps

### 1. Synchronize / Place Image Assets
When a new garment photo is provided:
1. Ensure the image is placed in `public/images/<ID>.jpg` (e.g. `P16.jpg` or `S10.jpg`).
2. If the user placed a file in `~/Downloads/クローゼット24着_個別切り抜き画像一式` or similar with a Japanese name like `P16_黒スラックス.jpg`, run:
   ```bash
   ./scripts/sync-images.sh
   ```
3. Verify the file exists in `public/images/`.

### 2. Update `src/data/closet.json`
Add the new item to `items` adhering to the schema:
- `id`: Next sequential ID (`S10` for shirt, `P16` for pants).
- `category`: `"shirt"` or `"pants"`.
- `name`: Clean Japanese name (e.g. `"黒テーパードスラックス"`).
- `imageUrl`: `"/images/<ID>.jpg"`.
- `seasonSleeve`: e.g. `"通年"`, `"春夏・半袖"`, `"長袖・通年"`.
- `dressScore`: 1.0 - 5.0 (4.5 for formal slacks, 2.0 for sweatpants).
- `comfortScore`: 1.0 - 5.0.
- `officeRecommendIds`: Array of compatible shirt/pants IDs for office work.
- `remoteRecommendIds`: Array of compatible shirt/pants IDs for remote/casual.
- `ngIds`: Array of conflicting IDs based on the 40s male fashion principles.
- `ngReason`: Clear explanation of why pairs in `ngIds` look bad (e.g. "同系色濃紺による作業着見え").
- `notes`: Short role summary (e.g. "【万能出社エース】会食・出社").

**Important:** Update existing items' `officeRecommendIds`, `remoteRecommendIds`, or `ngIds` if the new item pairs with or conflicts with them.

### 3. Run Validation and Build
Always run:
```bash
npm run validate-data
npm run build
```
Verify 0 errors before reporting completion.
