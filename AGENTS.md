# AGENTS.md — Smart Closet AI Pair Programming Guidelines

This file serves as the operational contract for AI agents (Antigravity, Codex, etc.) working on this repository.

## 1. Project Overview & Target Persona
- **Goal:** Provide a 40s male professional (hybrid office worker + remote) a private, zero-stress PWA mobile web app that completely eliminates wife fashion disapproval ("ダメ出し") and makes morning wardrobe decisions in 1 second.
- **Key Hardware Target:** Google Pixel 9a (mobile one-handed thumb interaction) & Mac mini (wide desktop screen for the compatibility matrix).
- **Core Technology Stack:**
  - Framework: React 18 + TypeScript + Vite
  - Styling: Tailwind CSS (modern charcoal / dark-slate aesthetic with elegant royal blue accents, dark/light theme support)
  - Icons: `lucide-react`
  - PWA: `vite-plugin-pwa` (standalone installable on mobile)
  - External API: Open-Meteo API (weather & temperature for Abiko, Chiba: `35.8644, 139.9708`)

## 2. Directory Structure & Key Files
```text
smart-closet/
├── AGENTS.md                    # This guideline
├── .agents/skills/              # Antigravity project skills
│   └── manage-wardrobe/SKILL.md # Runbook for wardrobe additions/edits
├── scripts/
│   ├── sync-images.sh           # Image sync & ID normalization script
│   └── validate-closet.mjs      # Data & asset integrity validation CLI
├── src/
│   ├── data/closet.json         # Master database of 24 garments
│   ├── types/closet.ts          # TypeScript type definitions
│   ├── hooks/useClosetStore.ts  # State, cooling period & recommendation logic
│   ├── components/
│   │   ├── ItemImage.tsx        # Smart image component with fallback
│   │   ├── WeatherWidget.tsx    # Weather & sleeve advice widget
│   │   ├── TodayView.tsx        # Tab 1: Morning decision panel
│   │   ├── AiSyncView.tsx       # Tab 2: Clothes addition & AI JSON sync
│   │   ├── TravelPlannerView.tsx# Tab 3: Travel packing timeline
│   │   ├── MatrixView.tsx       # Tab 4: 9x15 full matrix & insights
│   │   └── HistoryModal.tsx     # Wear history inspection & test simulation
│   ├── App.tsx                  # Root shell with bottom tab navigation
│   ├── main.tsx
│   └── index.css
├── public/
│   ├── images/                  # S1.jpg ~ S9.jpg, P1.jpg ~ P15.jpg
│   └── icon.svg                 # App SVG icon
└── package.json
```

## 3. Essential Commands
- `npm run dev`: Launch local development server
- `npm run build`: Type-check (`tsc -b`) and build for production (`vite build`)
- `npm run sync-images`: Synchronize and normalize images from `~/Downloads` into `public/images/`
- `npm run validate-data`: Run integrity validator for `closet.json` and image files

## 4. Wardrobe Domain Invariants & Rules
1. **IDs and Categories:**
   - Shirts: `S1`, `S2`, `S3`, ... (Category: `"shirt"`)
   - Pants: `P1`, `P2`, `P3`, ... (Category: `"pants"`)
2. **Fashion Principles for 40s Male (Wife Approval Safety):**
   - **No Upper-Lower Navy/Indigo Monotone:** (e.g. S1 Dark Indigo × P1/P6/P8 Navy pants looks like pajamas or work uniform; must be marked `ngIds`).
   - **No Pattern-on-Pattern Clash:** (e.g. S5 Small pattern or S9 Stripe × P5/P10/P11 Patterned pants; must be marked `ngIds`).
   - **No Faded-on-Faded Blur:** (e.g. S8 Ecru × P3/P9 Light gray/greige causes a washed-out expand look; must be marked `ngIds`).
   - **White Shirts are Universal:** S2, S4, S7 pair with almost all pants including loud/patterned ones.
3. **Recommendation & Cooling Period:**
   - If a pants item was worn yesterday (`wearHistory`), its recommendation priority is automatically lowered to the bottom with a `⚠️ 昨日着用（冷却中）` badge to prevent repetitive outfits.
4. **Wife NG Registration (`🚨 奥様NG`):**
   - Any pair flagged by user must immediately be excluded from candidate lists and stored in `localStorage` under `smart_closet_wife_ng`.

## 5. Definition of Done (DoD)
Whenever you modify files or data:
1. Run `npm run validate-data` and ensure exit code 0 (zero errors).
2. Run `npm run build` and ensure TypeScript and Vite build pass with zero errors.
3. Keep mobile layout clean with tap targets at least 44x44px.
