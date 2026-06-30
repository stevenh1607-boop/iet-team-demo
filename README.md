# ⚡ IET Estimation Tool — Interactive Demo

A working prototype of the digital IET (Interim Estimation Tool) estimation platform.
Built with React + Vite + Tailwind CSS.

**Live demo:**[(https://stevenh1607-boop.github.io/iet-team-demo/)

---

## What this demo shows

This is a fully interactive prototype — all calculations run in the browser.
No database, no login, no IT infrastructure needed.

### ⚙️ Investment Setup tab
- Investment identity (name, number, type, class, revision)
- **Investment Type toggle** — switching to Commercially Funded shows a warning
  that Planning phase costs will be suppressed (zeroed) automatically
- Phase timeline — enter planning, design, and construction months and durations;
  the calendar dates calculate live and a colour-coded bar updates as you type
- Contingency percentages (separate internal / commercial)
- Annual escalation rates by resource stream (EE, Contractors, Materials) × FY2026–FY2029
- Invoicing milestones with percentage validation (commercial investments only)
- Estimator and Reviewer dropdowns with role and team badges

### 📐 Estimation tab
- **WBS Navigator** — browse the hierarchy tree (click to drill down) or search by
  description or WBS code
- **Supply items entry** — enter quantities, see install hours auto-calculate instantly
- **Expandable cost rows** — click ▸ on any row to override install hours, enter
  plant/equipment cost, materials, contractor rate, or switch delivery method
- **Live Cost Display** — EE Internal and Commercial totals update in real time
  as you type, including install hours and commission hours
- **🧩 Optional Equipment** — click to open a catalogue of ancillary SCADA items
  without WBS codes; select quantities to include in the estimate total

### 📋 Review Lines tab
- Placeholder — shows all entered lines for review

### 📊 Summary tab
- Placeholder — phase rollup totals and submit for review

---

## How to deploy (10 minutes)

### Step 1 — Create GitHub account and repository
1. Go to **github.com** → Sign up (free)
2. Click **+** → New repository
3. Name: `iet-estimation-tool` | Visibility: **Private** | ✅ Add README
4. Click **Create repository**

### Step 2 — Enable GitHub Pages
1. Go to your repo → **Settings** → **Pages**
2. Source → **GitHub Actions**
3. Click Save

### Step 3 — Upload the project files
1. Unzip **IET_GitHub_Project.zip**
2. Open your repo on github.com → click **uploading an existing file**
3. Drag the **contents** of the `iet-app` folder (not the folder itself)
   — you should see `package.json`, `vite.config.js`, `src/` etc. at the root level
4. Scroll down → **Commit changes**

GitHub Actions builds and deploys automatically (~2 minutes).

### Step 4 — Update vite.config.js
Open `vite.config.js` and change the base to match your repo name:
```js
base: '/iet-estimation-tool/',   // ← change this if your repo has a different name
```

### Step 5 — Share the URL
Go to **Settings → Pages** to find your live URL:
`https://YOUR-USERNAME.github.io/iet-estimation-tool`

Share this with your bosses — opens in any browser, no install.

---

## Important notes

**Data does not persist between sessions** — this is a demo. Quantities are
stored in browser memory only and reset when the page is refreshed.
Full data persistence requires Supabase (free) — see the Master Build Guide.

**Calculations are real** — all cost calculations match the Excel IET formula logic:
- EE Internal: Labour + Plant×Factor + Materials + Materials Burden (7.52%)
- Commercial: Labour×1.20 + Contractor×1.20 + Plant×Factor + Materials×1.2686
- Install hours auto-calculate from pre-agreed standard rates (crew × hrs/unit)
- Commercial investments suppress Planning phase costs to $0 automatically

**WBS data** — the navigator uses a representative sample of the Zone Substation
Construction WBS (Disconnectors, Circuit Breakers, Current Transformers).
The full 2,359-item WBS is in `WBS_Master.csv` and loads from Supabase in the
production version.

---

## Next steps after demo approval

1. Set up Supabase (free) → import the 7 CSV data files
2. Add Supabase credentials to `src/supabase.js`
3. Connect Power BI for reporting
4. Build the Power Apps version with Dataverse for full M365 integration

Full instructions in `IET_Master_Build_Guide.docx`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| GitHub Pages shows 404 | Check `vite.config.js` base matches your repo name exactly |
| Actions build fails | Go to Actions tab → click the failed run → read the error log |
| App shows blank page | Open browser DevTools (F12) → Console tab for errors |
| Wrong repo name in vite.config.js | Edit the file in GitHub → commit → redeploy |
