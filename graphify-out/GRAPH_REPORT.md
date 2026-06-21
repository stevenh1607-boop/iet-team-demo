# Graph Report - ..  (2026-06-21)

## Corpus Check
- 25 files · ~430,258 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 163 nodes · 210 edges · 13 communities (8 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]

## God Nodes (most connected - your core abstractions)
1. `useData()` - 19 edges
2. `fmt()` - 11 edges
3. `IET Estimation Tool` - 9 edges
4. `SummaryScreen()` - 6 edges
5. `fmtHrs()` - 5 edges
6. `cartBetaCDF()` - 5 edges
7. `ErrorBoundary` - 5 edges
8. `scripts` - 4 edges
9. `EstimationScreen()` - 4 edges
10. `ReviewLines()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `Deploy to GitHub Pages Workflow` --references--> `IET Estimation Tool`  [INFERRED]
  .github/workflows/deploy.yml → README.md
- `vite.config.js` --conceptually_related_to--> `npm run build Step`  [INFERRED]
  README.md → .github/workflows/deploy.yml
- `dist/ Build Artifact` --references--> `index.html Entry Point`  [INFERRED]
  .github/workflows/deploy.yml → index.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CI/CD Build and Deploy Pipeline** — workflows_deploy_github_pages_deployment, workflows_deploy_npm_build, workflows_deploy_dist_artifact, index_html_entry [INFERRED 0.85]
- **IET Tool Tab UI Structure** — readme_iet_estimation_tool, readme_investment_setup_tab, readme_estimation_tab, readme_review_lines_tab, readme_summary_tab [EXTRACTED 1.00]

## Communities (13 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (42): APP_TABS, CART_DEFAULT_SETTINGS, CART_HELP, CART_LIKELIHOOD, CART_SYS, CATEGORY_COLORS, CLASS_COLOR, COMPLEXITY_DOT (+34 more)

### Community 1 - "Community 1"
Cohesion: 0.11
Nodes (25): CARTScreen(), ContributionSplitTab(), doGeneratePDF(), EquipmentCatalogueManager(), EquipmentPricingEditor(), EquipmentScreen(), EscalationEditor(), EstimationScreen() (+17 more)

### Community 2 - "Community 2"
Cohesion: 0.14
Nodes (18): index.html Entry Point, src/main.jsx Module Entry, React Root Mount (#root), Browser-Only Data Storage (No Persistence), IET Cost Calculation Logic, Estimation Tab, IET Estimation Tool, Investment Setup Tab (+10 more)

### Community 3 - "Community 3"
Cohesion: 0.11
Nodes (17): dependencies, react, react-dom, devDependencies, autoprefixer, postcss, tailwindcss, vite (+9 more)

### Community 4 - "Community 4"
Cohesion: 0.24
Nodes (10): cartBetaCDF(), cartBetacf(), cartBetaInv(), cartInvGrid(), cartLogGamma(), cartPertAB(), cartPertQuantile(), cartRng() (+2 more)

## Knowledge Gaps
- **61 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+56 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ErrorBoundary` connect `Community 5` to `Community 0`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `useData()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _62 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02631578947368421 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.11333333333333333 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.13725490196078433 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._