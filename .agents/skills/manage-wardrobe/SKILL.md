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
1. Photos are stored in the user's private Google Drive folder (e.g. `SmartCloset_Photos`) with the name `<ID>.jpg` (e.g. `P16.jpg` or `S10.jpg`).
2. **Never commit wardrobe photos to Git or `public/images/`** to preserve complete privacy.
3. The user synchronizes photos into the app via the cloud sync modal ("写真を今すぐ同期"), which permanently caches them in browser `IndexedDB`.

### 2. Update `src/data/closet.json`
Consult **`docs/STYLING_RULES.md`** for 40s male fashion principles, bias analysis, and compatibility criteria.
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

**Important:** Update existing items' `officeRecommendIds`, `remoteRecommendIds`, or `ngIds` if the new item pairs with or conflicts with them (preserving bidirectional integrity).

### 3. Run Validation and Build
Always run:
```bash
npm run check
```
Verify 0 errors before reporting completion.
