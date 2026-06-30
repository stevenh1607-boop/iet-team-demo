# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **This is the `iet-team-demo` branch** — a team review/demo deployment of the IET Estimation Tool.
> It differs from the production repo (`iet-estimation-tool_demo`) in one way only:
> investment records are persisted to a **shared Supabase table** instead of `localStorage`,
> so all team members see each other's saves. All calculation logic is identical.
> Never merge changes from this repo back into the production repo.

## Commands

```bash
npm run dev        # Vite dev server (hot reload) — requires .env with Supabase credentials
npm run build      # Production build → dist/
npm run preview    # Serve dist/ locally
```

There are no tests or linters configured. Syntax validation:
```bash
npx esbuild src/App.jsx --outfile=/dev/null    # exit 0 = no syntax errors
node -e "const fs=require('fs');const s=fs.readFileSync('src/App.jsx','utf8');const o=(s.match(/\{/g)||[]).length;const c=(s.match(/\}/g)||[]).length;console.log('Open:',o,'Close:',c,'Match:',o===c);"
```

Deployment: push to `main` → GitHub Actions builds and deploys to GitHub Pages automatically (`deploy.yml`).
Vite base path is `/iet-team-demo/` (differs from production repo which uses `/iet-estimation-tool_demo/`).

---

## Supabase backend (team-demo only)

Investment records are stored in a shared Supabase Postgres table instead of `localStorage`.

### Environment variables

Create `.env` in the repo root (gitignored — never commit):
```
VITE_SUPABASE_URL=https://gzdnnzzyqhdowedgsfea.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from Supabase dashboard>
```

Both variables must also exist as **GitHub Actions repository secrets** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) for the Pages build to embed them.

### Persistence adapter — `src/lib/investmentsStore.js`

Drop-in replacement for `localStorage.getItem/setItem("iet_investments")`. Exposes:
- `hydrate()` — async, fetches all rows from Supabase; fires on mount and window focus
- `getAll()` — synchronous; returns in-memory cache (may be `[]` before first hydrate resolves)
- `saveAll(records)` — updates cache immediately (optimistic), upserts to Supabase in background
- `removeOne(id)` — updates cache immediately, issues a real DELETE to Supabase
- `subscribe(fn)` — registers a callback fired on every cache change

All 9 call sites in `App.jsx` (`saveInvestment`, `loadInvestment` lock-claim, `releaseLock`, `commitStatus`, `confirmApproval`, `del`, `cloneInvestment`, `confirmImport`, `amendEstimate`) use these functions. The nav badge count also reads from `getAllInvestments()`.

### Supabase table — `iet_investments`

| Column | Type | Purpose |
|---|---|---|
| `id` | text PK | `record.id` |
| `inv_number` | text | Promoted for duplicate-warning queries |
| `inv_name` | text | Promoted for display |
| `inv_revision` | text | |
| `status` | text | Draft / Approved |
| `total_ee` | numeric | Promoted for hub sort |
| `total_comm` | numeric | |
| `saved_at_iso` | timestamptz | Hub default sort (desc) |
| `record_data` | jsonb | **Full record object** — authoritative source for all fields |
| `updated_at` | timestamptz | Server-side last-write (auto-updated by trigger) |

`record_data` IS the full record. Promoted columns exist only for indexing/filtering.
RLS is enabled with a fully open anon policy — acceptable for an internal demo, must not be carried into production.

### Other localStorage keys unchanged

`iet_programmes`, `iet_custom_templates`, `iet_recents`, `iet_theme`, `iet_session_user`, `iet_draft_recovery` all remain on `localStorage`. Only `iet_investments` moved to Supabase.

---

## Architecture

The entire application lives in **`src/App.jsx`** (~15,000 lines). Other source files:
- `src/components/ErrorBoundary.jsx`
- `src/lib/supabaseClient.js` — Supabase client init from env vars
- `src/lib/investmentsStore.js` — persistence adapter (see above)

No routing library — tab state is local React state in the `App` component.

### Data layer

All reference data is loaded at startup from **`public/data/*.json`** files:

| File | Purpose |
|---|---|
| `supply_items.json` | WBS items with standard install hours, crew sizes, labour rates |
| `resource_codes.json` | Labour resource definitions, EE internal + commercial rates, ANS margin per resource |
| `wbs_master.json` | Full 2,359-item WBS hierarchy |
| `commission_lookup.json` / `commission_scaling.json` | Phase 4 commissioning hours by equipment type |
| `equipment.json` / `equipment_pricing.json` | Optional equipment catalogue |
| `escalation_rates.json` | Annual escalation rates by stream (EE labour, contractors, materials) |
| `resource_rates.json` / `resource_rates_FULL_44.json` | Legacy rate tables (superseded by `resource_codes.json`) |

These are served via a `DataCtx` React context (`DataCtx.Provider` wraps the entire app at line ~14726). Components access data with `useData()` (line 640).

When an estimate is saved, the current `resourceCodes` snapshot is frozen into the investment record so rate changes don't retroactively alter saved estimates. The active snapshot is preferred over the live context in `DataCtx.Provider`.

---

### Cost calculation pipeline

The core calculation runs through three module-level functions called everywhere (SummaryScreen, ReviewLines, FinancialScreen, `doGeneratePDF`, Copperleaf XLSX export, CART):

1. **`buildPctBase(supply, lines, isCommercial, ratesLookup)`** (line ~752) — computes the pct-row cost base per WBS code. Must be called first; its output is passed as `pctBase` into `calcLine`.

2. **`calcLine(item, qty, factor, delivery, ...overrides..., isCommercial, resourceOvrd, ratesLookup, pctBase)`** (line ~775) — returns `{ eeInt, comm, installHrs, commHrs, eeLabCost, contrCost, equipCost, ... }` for a single supply line. The `isCommercial` flag switches between EE Internal and Commercial cost paths. EE Internal always uses `ee_internal_rate`; Commercial uses `ee_commercial_rate` (embedded ANS — do not re-apply). ANS uplift for contractors (`×1.20`) and materials (`×1.2686`) is applied inside this function for the Commercial path only.

3. **`aggregateInstallRows(supply, lines, resourceCodes)`** (line ~687) — aggregates install hours by resource for the hours summary.

**Constants** (line ~671–745):
- `ANS_CON = 0.20` — contractor ANS margin
- `ANS_MAT = 0.2686` — materials ANS margin
- `MAT_BURDEN = 0.0752` — materials burden (EE Internal only, not Commercial)

---

### Contingency — `resolveContingency` (line ~918)

```js
function resolveContingency(inv, base, isCommercial, tolerance=1)
```

Priority order:
1. If `inv.cartResult` exists, matches `isCommercial`, and `cartResult.base ≈ base` (within `tolerance=$1`) → use CART P50 (`cartResult.p50`)
2. If `inv.contIntDollar` / `inv.contCommDollar` is set (fixed dollar from CART D40 workbook import) → use that
3. Fall back to percentage: `inv.contInt` / `inv.contComm` applied to `base`

**Critical:** In `SummaryScreen` and `doGeneratePDF`, the EE and Commercial contingencies are resolved with **separate calls**:
- `contRes = resolveContingency(inv, contBase, isCommercial)` — Commercial stream (when `isCommercial=true`)
- `contResEE = resolveContingency(inv, grandEEwithOT, false)` — EE Internal stream always

This ensures the EE column uses `contIntDollar` (CART D40) even on Commercially Funded estimates, not a proportional share of the Commercial contingency.

---

### Investment type: EE Internal vs Commercially Funded

`isCommercial = inv.type === 'Commercially Funded'`

Differences when `isCommercial=true`:
- Phase 1 (Planning) costs suppressed to $0
- Contractors and Materials escalation included (EE-only otherwise)
- Commercial column shown alongside EE Internal in dual-column layout
- Contingency `%` label shows `contResEE.pct` (EE) / `contPct` (Commercial)
- Grand total uses `finalTotal = grandComm + contAmt + escResult.escComm`

---

### Escalation (`escResult`, line ~3603)

`useMemo` in `SummaryScreen`. Computes spend-profile-weighted escalation per phase using `escalationIndex()` against the project timeline. EE Labour escalation applies to all investment types; Contractor and Materials escalation only for Commercially Funded.

**No ANS uplift on escalation** — the prior `escContr*(1+ANS_CON) + escMat*(1+ANS_MAT)` formula was removed. The correct formula is:
```
escComm = (escEE + escContr + escMat) × (1 + contAmt/grandCommBase)
```
Verified against Kings Plains Option 2C: `$803,139 × 1.14927 = $923,026 ✓`

The `byPhase` accumulator uses raw pre-ANS `contrCost` and `equipCost` from `calcLine` (not commercial-uplifted values).

---

### CART — Contingency & Accuracy Range Tool (line ~12469)

Browser-side Monte Carlo simulation using PERT distributions (`cartPertQuantile`, seeded RNG). Runs risk factors against the base cost, produces a P50 which is stored in `inv.cartResult`. Once set, `resolveContingency` uses P50 in preference to the fixed-dollar or percentage fallback. CART result is invalidated when `cartResult.base` diverges from the live base by more than $1.

---

### Screens / major components

All screens are plain React functions; they receive `inv` and `lines` as props from `App`.

| Screen | Line | Purpose |
|---|---|---|
| `InvestmentSetup` | ~934 | Investment identity, timeline, contingency %, escalation rates, CART trigger |
| `EstimationScreen` | ~1565 | WBS navigator + supply line entry; all live cost display |
| `ReviewLines` | ~2734 | Tabular review of all entered lines with costs |
| `SummaryScreen` | ~3481 | Phase rollup, contingency, escalation, grand totals; PDF + XLSX export |
| `FinancialScreen` | ~3963 | Financial reporting view |
| `CARTScreen` | ~12716 | Monte Carlo risk simulation |
| `WBSManager` | ~9740 | Admin: edit WBS items, rates, scaling, equipment pricing |
| `PortfolioReportScreen` | ~6648 | Cross-investment portfolio summary |
| `InvestmentHub` | ~5000 | Investment list, import (.xlsm/.xlsx workbook or .json export) |
| `HelpScreen` | ~14804 | Help and guidance for team reviewers |

---

### PDF and XLSX export

- **`doGeneratePDF`** (line ~3075) — builds an HTML string, opens a print window. Has its own local re-derivation of all cost totals (uses `grandEEwithOTV` alias for `grandEEwithOT`). Must stay in sync with `SummaryScreen` calculation logic — when fixing a calculation bug, check both.
- **`generateCopperleafXLSX`** (line ~258) — generates Copperleaf spend template. Uses `buildPctBase` + `calcLine` directly.

---

### Workbook import

`.xlsm`/`.xlsx` import (in `InvestmentHub`) parses MASTER.xlsm cell references (e.g. `D40` for `contIntDollar`) to populate `inv` fields including fixed-dollar contingency amounts. The import path populates `inv.contIntDollar` and `inv.contCommDollar` which `resolveContingency` then consults.

---

## Updating the team-demo from production

When new fixes land on `iet-estimation-tool_demo/main`:

```bash
# In iet-estimation-tool_demo
git remote add team https://github.com/stevenh1607-boop/iet-team-demo.git   # if not already added
git push team main:main --force
```

Then in `iet-team-demo`:
```bash
git pull origin main
```

The `team` remote alias is not persisted between sessions — re-add it each time if missing.
The force-push overwrites team-demo's main with production code. The Supabase changes (`src/lib/`, `.gitignore`, `deploy.yml` env block, `vite.config.js` base path) live only in team-demo and must be re-applied if the repo is ever re-created from scratch.
