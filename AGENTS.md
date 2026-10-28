# AGENTS.md — Smart Closet AI Pair Programming Guidelines

This file serves as the operational contract for AI agents (Antigravity, Codex, etc.) working on this repository.

## 1. Project Overview & Target Persona
- **Goal:** Provide a 40s male professional (hybrid office worker + remote) a private, zero-stress PWA mobile web app that completely eliminates wife fashion disapproval ("ダメ出し") and makes morning wardrobe decisions in 1 second.
- **Key Hardware Target:** Google Pixel 9a (mobile one-handed thumb interaction) & Mac mini (wide desktop screen with 2-pane layout and full compatibility matrix).
- **Core Technology Stack:** React 18 + TypeScript + Vite, Tailwind CSS, `lucide-react`, `vite-plugin-pwa`, Open-Meteo API (Abiko, Chiba: `35.8644, 139.9708`).

## 2. Architecture & Knowledge Map

### Layer Responsibilities
- `src/components/`: Pure presentation & UI panels (TodayView, AiSyncView, MatrixView, modals).
- `src/hooks/`: React state orchestration (`useClosetStore.tsx` context & cooling).
- `src/utils/`: Pure domain logic & storage engines (`closetDomain.ts`, `imageStore.ts`, `imageProcessor.ts`, `syncReconcile.ts`).
- `src/types/`: TypeScript domain interfaces (`closet.ts`).
- `src/data/`: Master database (`closet.json`).
- `gas/`: Google Apps Script backend (`Code.gs` Single Source of Truth).
- `functions/`: Cloudflare Pages Functions (`api/bootstrap-config.ts` runtime secret distribution).
- `scripts/`: Verification & test suite (`validate-closet.mjs`, `test-gas-sync.mjs`, `sync-images.sh`).

### Task-Specific Knowledge Routers (Single Sources of Truth)
- **UI & Logic Specs:** Consult [docs/SPECIFICATION.md](docs/SPECIFICATION.md) for view behaviors and scoring algorithms.
- **Wardrobe & Styling Rules:** Consult [docs/STYLING_RULES.md](docs/STYLING_RULES.md) for 40s male color/pattern criteria and bias analysis.
- **Wardrobe Addition Skill:** Follow [.agents/skills/manage-wardrobe/SKILL.md](.agents/skills/manage-wardrobe/SKILL.md) when adding/editing clothes.
- **Infrastructure & Operations:** Consult [docs/OPERATIONS.md](docs/OPERATIONS.md) for Cloudflare Access, OAuth, secret rotation, and GAS redeployment.
- **PR Review Arenas:** Repository PR reviews are conducted in the ChatGPT project `smart-closet` and the Grok project `smart-closet`.

## 3. Architecture Invariants & Absolute Constraints
1. **Serverless Frontend & Human-in-the-Loop AI:**
   - **Never implement code that calls paid backend servers or external LLM APIs (e.g. Gemini API) directly from the client.**
   - Wardrobe additions and matrix recalculations use a Human-in-the-loop workflow: prompt generation -> user submits to Gemini -> imported JSON committed to `src/data/closet.json`.
2. **Local-First & Optional GAS Cloud Synchronization:**
   - **0-Second Decision Rule:** Morning decisions, wear recording, and recommendations operate locally via `localStorage` and memory with **0ms latency**. UI is never blocked by network calls.
   - **Cloud Sync (Auto & Manual):** Multi-device synchronization with Google Apps Script (`gas/Code.gs`) Web App has auto-sync (`gasConfig.autoSync`) enabled by default. When enabled, local modifications trigger non-blocking background pushes, and automatic synchronization runs on app launch, reconnect (online), and tab visibility return (pushes uncommitted changes if dirty, otherwise pulls). Manual sync ("今すぐ同期") coexists alongside auto-sync, and auto-sync can be toggled off in cloud settings.
   - **GAS Deployment Constraint:** Changes to `gas/Code.gs` do not take effect in production until redeployed to the existing Web App deployment (keeping the deployment URL unchanged; see [docs/OPERATIONS.md](docs/OPERATIONS.md)). Any PR modifying `gas/Code.gs` must explicitly note this redeployment requirement in the PR description.
3. **Single Source of Truth & LocalStorage Integration:**
   - Master data is `src/data/closet.json` in Git. User runtime state (`wearHistory`, emergency `wifeNgPairs`, custom imported data) is saved in browser `localStorage`.
   - Runtime wife NG pairs (`smart_closet_wife_ng`) must be merged into exported `closet.json` so that offline/backup data always preserves user decisions.
4. **Asset Rules (Private Google Drive Hosting & IndexedDB Persistence):**
   - **No Wardrobe Photos in Repository:** Private photos must never be committed to Git or hosted in `public/images/`.
   - **Private Drive Storage & IndexedDB:** Garment photos are stored in private Google Drive folder as `{ID}.jpg` and permanently cached in browser `IndexedDB` via GAS `getImageSyncPlan` & `fetchImages`. Display is served from local Blobs with SVG silhouette fallback.

## 4. Essential Commands
- `npm run dev`: Launch local development server
- `npm run check`: **Standard verification command** (`validate-data` + `test-sync` + `build`). Passing with **exit code 0 is mandatory** for all changes.
- `npm run test-sync`: Run GAS backend, sync logic, and domain unit tests
- `npm run validate-data`: Run integrity validator, privacy guard, and broken path check
- `npm run build`: Type-check (`tsc -b`) and build for production (`vite build`)

## 5. Wardrobe Domain Invariants
1. **Categories & Sequential IDs:** Shirts (`S1, S2...`), Pants (`P1, P2...`).
2. **Office Dress Code Invariant:** For office mode (`scene === 'office'`), pants with `dressScore < 3.0` (sweatpants/joggers) must be excluded from office candidates.
3. **Cooling Period Invariant:** Pants worn yesterday (`wearHistory`) are demoted to the bottom with a `⚠️ 昨日着用（冷却中）` badge.
4. **Wife NG Invariant:** Runtime flags (`smart_closet_wife_ng`) immediately exclude pairs from recommendation and take precedence.
5. **Styling Criteria Authority:** All color/pattern/tonal pairing rules and bias insights belong strictly to [docs/STYLING_RULES.md](docs/STYLING_RULES.md). Do not duplicate or invent ad-hoc fashion rules in code or constitution.

## 6. Definition of Done (DoD) & Guardrails
1. **No-Actionable Finding, Stop:** If research shows no problem or speculative changes are unwarranted, do not manufacture unnecessary code changes. Complete the task with an investigation report.
2. **No Escape Hatches:** Never suppress type errors or linter warnings with `@ts-ignore`, `@ts-nocheck`, or `eslint-disable`.
3. **Maintain Documentation Integrity:** When adding/renaming files or commands, keep doc paths in sync.
4. **Run Full Verification:** Always run `npm run check` and ensure exit code 0.
5. **Mobile Usability:** Keep mobile layout clean with tap targets at least 44x44px.
6. **Testing Policy:** Permanent automated tests are restricted to logic (data validation, domain functions, and GAS handlers). Because the Node test harness can only verify UI behavior via source-string matching, do not add new UI source-string tests. If an existing UI string assertion breaks due to a harmless change, delete the assertion rather than contorting code or tests to make it pass. UI quality is assured via code review against the plan/PR checklist and manual device verification.
7. **PR Etiquette:** Include a checklist of design conditions in every PR description (and explicitly note the GAS redeployment requirement whenever `gas/Code.gs` is modified). The implementer must never merge their own PR.
