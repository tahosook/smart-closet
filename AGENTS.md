# AGENTS.md — Smart Closet AI Pair Programming Guidelines

This file serves as the operational contract for AI agents (Antigravity, Codex, etc.) working on this repository.

## 1. Project Overview & Target Persona
- **Goal:** Provide a 40s male professional (hybrid office worker + remote) a private, zero-stress PWA mobile web app that completely eliminates wife fashion disapproval ("ダメ出し") and makes morning wardrobe decisions in 1 second.
- **Key Hardware Target:** Google Pixel 9a (mobile one-handed thumb interaction) & Mac mini (wide desktop screen with 2-pane layout and full compatibility matrix).
- **Core Technology Stack:**
  - Framework: React 18 + TypeScript + Vite
  - Styling: Tailwind CSS (modern charcoal / dark-slate aesthetic with elegant royal blue accents, dark/light theme support)
  - Icons: `lucide-react`
  - PWA: `vite-plugin-pwa` (standalone installable on mobile)
  - External API: Open-Meteo API (weather & temperature for Abiko, Chiba: `35.8644, 139.9708`)

## 2. Directory Structure & Key Files
```text
smart-closet/
├── .clasp.json.sample           # Clasp configuration template (scriptId placeholder)
├── AGENTS.md                    # This guideline (Constitution)
├── README.md                    # Human operator & deployment guide
├── gas/
│   ├── Code.gs                  # Google Apps Script Web App (Single Source of Truth; imported via ?raw into GasSyncModal)
│   └── appsscript.json          # Google Apps Script manifest (V8, Asia/Tokyo, webapp)
├── docs/
│   ├── SPECIFICATION.md         # UI, data model & scoring specifications
│   └── STYLING_RULES.md         # 40s male styling principles & bias analysis
├── .agents/skills/              # Antigravity project skills
│   └── manage-wardrobe/SKILL.md # Runbook for wardrobe additions/edits
├── scripts/
│   ├── sync-images.sh           # Image sync & ID normalization script
│   └── validate-closet.mjs      # Data & asset integrity validation CLI
├── src/
│   ├── data/
│   │   └── closet.json          # Master database of 24 garments (Single Source of Truth)
│   ├── types/closet.ts          # TypeScript type definitions (incl. GasSync)
│   ├── hooks/useClosetStore.tsx # Context Provider, state, cooling & GAS background sync
│   ├── components/
│   │   ├── ItemImage.tsx        # Smart image component with fallback
│   │   ├── WeatherWidget.tsx    # Weather & sleeve advice widget
│   │   ├── TodayView.tsx        # Tab 1: Morning decision panel (Desktop 2-pane support)
│   │   ├── AiSyncView.tsx       # Tab 2: Clothes addition & AI JSON sync
│   │   ├── TravelPlannerView.tsx# Tab 3: Travel packing timeline
│   │   ├── MatrixView.tsx       # Tab 4: 9x15 full matrix & insights
│   │   ├── HistoryModal.tsx     # Wear history inspection & test simulation
│   │   └── GasSyncModal.tsx     # Cloud sync & Google Spreadsheet integration modal
│   ├── App.tsx                  # Root shell with bottom tab navigation & desktop layout
│   ├── main.tsx
│   └── index.css
├── public/
│   └── icon.svg                 # App SVG icon (Wardrobe photos are abolished from Git; stored in private Drive)
└── package.json
```

## 3. Architecture Invariants & Absolute Constraints
1. **Serverless Frontend & Human-in-the-Loop AI:**
   - **Never implement code that calls paid backend servers or external LLM APIs (e.g. Gemini API) directly from the client.**
   - Adding garments or recalculating compatibility matrix uses a **Human-in-the-loop** workflow: the app generates a prompt + active JSON, the user submits it to Google AI Pro (Gemini), and the resulting JSON is imported and committed to `src/data/closet.json`.
2. **Local-First & Optional GAS Cloud Synchronization:**
   - **0-Second Decision Rule:** All morning decisions, wear recording, and recommendations operate locally via `localStorage` and memory with **0ms latency**. UI is never blocked by network calls.
   - **Multi-Device Background Sync:** To seamlessly sync wear history and wife NG pairs between Pixel 9a and Mac mini, users can optionally connect their personal Google Apps Script (`gas/Code.gs`) Web App. All syncing occurs strictly in the background (asynchronous simple request POST without blocking).
3. **Single Source of Truth & LocalStorage Integration:**
   - Master data is `src/data/closet.json` in Git.
   - User runtime state (`wearHistory`, emergency `wifeNgPairs`, custom imported data) is saved in browser `localStorage`.
   - Any runtime wife NG pairs (`smart_closet_wife_ng`) must be merged into exported/copied `closet.json` so that offline/backup data always preserves user decisions.
4. **Asset Rules (Private Google Drive Hosting & IndexedDB Persistence):**
   - **No Wardrobe Photos in Repository:** Private wardrobe photos must never be committed to Git or hosted in `public/images/`. The `public/images/` directory is abolished to ensure complete privacy.
   - **Private Drive Storage:** Garment photos are stored in the user's private Google Drive folder (e.g. `SmartCloset_Photos`) with the filename `{ID}.jpg` (e.g. `S1.jpg`, `P16.jpg`). Never use Japanese or irregular file names.
   - **IndexedDB Client Storage:** The app synchronizes photos via Google Apps Script (`getImageSyncPlan` & `fetchImages`) and caches them permanently in browser `IndexedDB`. Display is served from local Blobs with 0ms latency and full offline support.
   - **SVG Fallback:** If a photo is not yet synced in IndexedDB or not found, an SVG silhouette placeholder is displayed gracefully without breaking the layout.

## 4. Essential Commands
- `npm run dev`: Launch local development server
- `npm run check`: Run full verification (data integrity + privacy guard + escape hatch scan + type-check + build)
- `npm run build`: Type-check (`tsc -b`) and build for production (`vite build`)
- `npm run validate-data`: Run integrity validator for `closet.json`, escape hatch scan, and privacy guard (checks that no private photos exist in `public/`)

## 5. Wardrobe Domain Invariants & Rules (See docs/STYLING_RULES.md)
1. **IDs and Categories:**
   - Shirts: `S1`, `S2`, `S3`, ... (Category: `"shirt"`)
   - Pants: `P1`, `P2`, `P3`, ... (Category: `"pants"`)
2. **Fashion Principles for 40s Male (Wife Approval Safety):**
   - **No Upper-Lower Navy/Indigo Monotone:** (e.g. `S1` × `P1, P5, P6, P8, P11` looks like pajamas or work uniform; must be marked `ngIds`).
   - **No Light Blue on Blue Denim:** (e.g. `S3` Saxe chambray × `P4, P7, P15` blue denims looks like an uncoordinated weekend uncle; must be marked `ngIds`).
   - **No Pattern-on-Pattern Clash:** (e.g. `S5, S6, S9` Pattern shirts × `P5, P10, P11` Patterned pants; must be marked `ngIds`).
   - **No Faded-on-Faded Blur:** (e.g. `S8` Ecru × `P3, P9, P13` Light gray/greige causes a washed-out expand look; must be marked `ngIds`).
   - **White Shirts are Universal:** `S2, S4, S7` pair with all pants including loud/patterned ones.
   - **TPO Separation & Office Sweatpants Exclusion:** For office mode (`scene === 'office'`), pants with `dressScore < 3.0` (sweatpants/joggers: `P2, P4, P13, P14, P15`) must be excluded from office candidates.
3. **Recommendation & Cooling Period:**
   - If a pants item was worn yesterday (`wearHistory`), its recommendation priority is automatically lowered to the bottom with a `⚠️ 昨日着用（冷却中）` badge.
4. **Wife NG Registration (`🚨 奥様NG`):**
   - Any pair flagged by user must immediately be excluded from candidate lists and stored in `localStorage` under `smart_closet_wife_ng`.

## 6. Definition of Done (DoD) & Guardrails
Whenever you investigate or modify files:
1. **No-Actionable Finding, Stop:** If research shows no problem or speculative changes are unwarranted, do not manufacture unnecessary code changes. Complete the task with an investigation report.
2. **No Escape Hatches:** Never suppress type errors or linter warnings with `@ts-ignore`, `@ts-nocheck`, or `eslint-disable`.
3. **Run Full Verification:** Always run `npm run check` and ensure exit code 0 (zero errors in data integrity, zero escape hatches, TypeScript type-check and Vite build pass).
4. **Mobile Usability:** Keep mobile layout clean with tap targets at least 44x44px.
