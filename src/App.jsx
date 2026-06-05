import { useState, useMemo, useEffect, useCallback, createContext, useContext, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════
// IET ESTIMATION TOOL — FULL SCALE DEMO
// Live data from GitHub Pages /data/ JSON files
// LocalStorage persistence for investment saves
// ═══════════════════════════════════════════════════════════════════

const BASE = import.meta.env.BASE_URL || "/";

// ── DATA CONTEXT ────────────────────────────────────────────────
const DataCtx = createContext({ wbs:[], rates:[], supply:[], equipment:[], equipLookup:{}, commLookup:{}, loading:true, error:null });
function useData() { return useContext(DataCtx); }

// ── HELPERS ─────────────────────────────────────────────────────
const fmt    = n => n === 0 ? "–" : "$" + Math.round(n).toLocaleString("en-AU");
const fmtHrs = n => n === 0 ? "–" : n.toLocaleString("en-AU",{minimumFractionDigits:0,maximumFractionDigits:1}) + " hrs";
const fmtPct = n => (n*100).toFixed(1) + "%";

// ANS margins
const ANS_LAB  = 0.20;
const ANS_MAT  = 0.2686;
const ANS_CON  = 0.20;
const MAT_BURDEN = 0.0752;

function calcLine(item, qty, factor, delivery, installHrsOvrd, contractorRateOvrd, plantCostVal, materialsCostOvrd, isCommercial) {
  const q   = parseFloat(qty)   || 0;
  const f   = parseFloat(factor)|| 1;
  const isContr = (delivery || item.delivery_method || "EE Delivered") === "Contractor Delivered";
  const instHrsPU = (installHrsOvrd !== "" && installHrsOvrd != null)
    ? (parseFloat(installHrsOvrd) || 0)
    : (item.install_hrs_per || 0);
  const commHrsPU = item.comm_hrs_per || 0;
  const installHrs = q * f * instHrsPU;
  const commHrs    = q * commHrsPU;
  const eeRate     = item.ee_labour_rate || 246.95;
  const contrRate  = (contractorRateOvrd !== "" && contractorRateOvrd != null)
    ? (parseFloat(contractorRateOvrd) || 0)
    : item.contractor_rate || 0;
  const plant      = parseFloat(plantCostVal) || 0;
  const matOvrd    = (materialsCostOvrd !== "" && materialsCostOvrd != null)
    ? parseFloat(materialsCostOvrd) || 0 : null;
  const pce        = item.pce_price || 0;
  const equipCost  = q * (matOvrd !== null ? matOvrd : pce);
  const eeLabHrs   = isContr ? 0 : q * f * instHrsPU;
  const eeLabCost  = eeLabHrs * eeRate;
  const contrCost  = isContr ? q * f * contrRate : 0;
  const plantFact  = plant * f;
  const matBurden  = isCommercial ? 0 : equipCost * MAT_BURDEN;
  const eeInt  = eeLabCost + contrCost + plantFact + equipCost + matBurden;
  const comm   = eeLabCost*(1+ANS_LAB) + contrCost*(1+ANS_CON) + plantFact + equipCost*(1+ANS_MAT);
  return { q, f, isContr, installHrs, commHrs, eeLabHrs, eeLabCost,
           contrCost, plantFact, equipCost, matBurden, eeInt, comm,
           instHrsOverridden: installHrsOvrd !== "" && installHrsOvrd != null, instHrsPU };
}

// ── SHARED UI ───────────────────────────────────────────────────
function ScopeBadge({ scope }) {
  const s = {
    "Supply":          "bg-blue-100 text-blue-700 border border-blue-200",
    "Install":         "bg-purple-100 text-purple-700 border border-purple-200",
    "Commission":      "bg-teal-100 text-teal-700 border border-teal-200",
    "Supply & Install":"bg-indigo-100 text-indigo-700 border border-indigo-200",
    "Demolition/Removal":"bg-red-100 text-red-700 border border-red-200",
  }[scope] || "bg-gray-100 text-gray-500";
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${s}`}>{scope}</span>;
}

function Card({ children, className="" }) {
  return <div className={`border border-gray-200 rounded-lg shadow-sm overflow-hidden ${className}`}>{children}</div>;
}

function SectionHeader({ color="orange", title, subtitle }) {
  const c = { blue:"bg-blue-700", orange:"bg-orange-600", green:"bg-green-700",
              purple:"bg-purple-700", teal:"bg-teal-700", gray:"bg-gray-600" }[color]||"bg-gray-600";
  return (
    <div className={`px-3 py-2 ${c} text-white`}>
      <div className="text-xs font-bold uppercase tracking-wide">{title}</div>
      {subtitle && <div className="text-xs opacity-75 mt-0.5">{subtitle}</div>}
    </div>
  );
}

// ── INVESTMENT SETUP SCREEN ──────────────────────────────────────
const ESTIMATORS = [
  "Adrian Bruce","Adrian George","Alex Nourian","Ben Broekman","Ben Morgan",
  "Ben O'Reilly","Chris Boles","Daniel Lawrence","Daniel Miller","Jason Doyle",
  "Jeremy Whitford","Joshua Walker","Matt Baker","Rhys Lawler","Richard Gonzalez",
  "Ruth Thomas","Ryan Evans","Stephanie Dewar","Steven Hannigan","Stuart Harland",
  "Vish Kamtam","Wayne Trezise","TBD"
];
const REVIEWERS = ["Daniel Lawrence","Jeremy Whitford","Joshua Walker","Matt Baker",
  "Richard Gonzalez","Ryan Evans","Steven Hannigan","Stuart Harland","Wayne Trezise"];

function InvestmentSetup({ inv, onChange }) {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const upd = (k,v) => onChange({...inv, [k]:v});
  return (
    <div className="flex-1 overflow-y-auto bg-orange-50 p-4">
      <div className="max-w-5xl mx-auto space-y-4">

        <Card>
          <SectionHeader color="blue" title="Investment Identity" subtitle="Required before estimate lines can be entered" />
          <div className="p-4 grid grid-cols-3 gap-4 bg-white">
            <div className="col-span-3">
              <label className="text-xs font-semibold text-gray-600 block mb-1">Investment Name <span className="text-red-500">*</span></label>
              <input value={inv.name} onChange={e=>upd("name",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Investment Number</label>
              <input value={inv.number} onChange={e=>upd("number",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">WACS Number</label>
              <input value={inv.wacs} onChange={e=>upd("wacs",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Investment Type</label>
              <select value={inv.type} onChange={e=>upd("type",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                <option>Internally Funded</option><option>Commercially Funded</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Estimate Class</label>
              <select value={inv.estClass} onChange={e=>upd("estClass",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                {["Class 1","Class 2","Class 3","Class 4","Class 5"].map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Revision</label>
              <select value={inv.revision} onChange={e=>upd("revision",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                {["A","B","C","D","E"].map(r=><option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Complexity</label>
              <select value={inv.complexity} onChange={e=>upd("complexity",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                {["Medium","High","Very High"].map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">New Technology</label>
              <select value={inv.newTech} onChange={e=>upd("newTech",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                {["Limited","Moderate","Substantial"].map(t=><option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Estimated By</label>
              <select value={inv.estimatedBy} onChange={e=>upd("estimatedBy",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                {ESTIMATORS.map(n=><option key={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Reviewed By</label>
              <select value={inv.reviewedBy} onChange={e=>upd("reviewedBy",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                {REVIEWERS.map(n=><option key={n}>{n}</option>)}
              </select>
            </div>
          </div>
        </Card>

        <Card>
          <SectionHeader color="orange" title="Project Timeline" subtitle="Planning · Design · Construction phases" />
          <div className="p-4 bg-white grid grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Project Start Month</label>
              <select value={inv.startMonth} onChange={e=>upd("startMonth",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-orange-400">
                {months.map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Start Year</label>
              <select value={inv.startYear} onChange={e=>upd("startYear",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-orange-400">
                {[2025,2026,2027,2028,2029,2030].map(y=><option key={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Contingency — Internal</label>
              <div className="flex items-center gap-1">
                <input type="number" min="0" max="100" step="1" value={inv.contInt}
                  onChange={e=>upd("contInt",e.target.value)}
                  className="w-20 border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400" />
                <span className="text-xs text-gray-400">%</span>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Contingency — Commercial</label>
              <div className="flex items-center gap-1">
                <input type="number" min="0" max="100" step="1" value={inv.contComm}
                  onChange={e=>upd("contComm",e.target.value)}
                  className="w-20 border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400" />
                <span className="text-xs text-gray-400">%</span>
              </div>
            </div>
            {[
              {label:"Planning",   startK:"planStart",   durK:"planDur"},
              {label:"Design",     startK:"designStart", durK:"designDur"},
              {label:"Construction",startK:"constrStart",durK:"constrDur"},
            ].map(phase=>(
              <div key={phase.label} className="col-span-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">{phase.label} Start (Month #)</label>
                  <input type="number" min="1" value={inv[phase.startK]} onChange={e=>upd(phase.startK,e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">{phase.label} Duration (Months)</label>
                  <input type="number" min="1" value={inv[phase.durK]} onChange={e=>upd(phase.durK,e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400" />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="flex justify-end gap-3 pb-4">
          <button className="px-6 py-2 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded font-semibold shadow">
            Save Investment Setup →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── WBS NAV TREE ─────────────────────────────────────────────────
function WBSNavTree({ wbs, supply, activePhase, setActivePhase, selectedL4, onSelectL4, searchText }) {
  const [expanded, setExpanded] = useState({"3":true,"3.1":true,"3.1.3":true});
  const toggle = code => setExpanded(p=>({...p,[code]:!p[code]}));

  // Build tree structure from wbs records
  const tree = useMemo(() => {
    const byCode = {};
    wbs.forEach(r => { byCode[r.wbs_code] = r; });

    const phases = [1,2,3,4,5].map(n => {
      const root = byCode[String(n)];
      return { code: String(n), label: root?.description || `Phase ${n}`, children: [] };
    });

    // Add L2
    wbs.filter(r=>r.depth===2).forEach(r=>{
      const p = phases.find(p=>p.code===r.level_1?.toString());
      if(p) p.children.push({code:r.wbs_code,label:r.description,children:[]});
    });
    // Add L3
    wbs.filter(r=>r.depth===3).forEach(r=>{
      const l2key = r.wbs_code.split(".").slice(0,2).join(".");
      phases.forEach(p=>p.children.forEach(l2=>{
        if(l2.code===l2key) l2.children.push({code:r.wbs_code,label:r.description,children:[]});
      }));
    });
    // Add L4
    wbs.filter(r=>r.depth===4).forEach(r=>{
      const l3key = r.wbs_code.split(".").slice(0,3).join(".");
      phases.forEach(p=>p.children.forEach(l2=>l2.children.forEach(l3=>{
        if(l3.code===l3key) l3.children.push({code:r.wbs_code,label:r.description,children:null});
      })));
    });
    return phases;
  }, [wbs]);

  // Supply counts per L4
  const supplyCount = useMemo(()=>{
    const m={};
    supply.forEach(s=>{ m[s.l4_group]=(m[s.l4_group]||0)+1; });
    return m;
  },[supply]);

  const renderNode = (node, depth=0) => {
    const isLeaf = node.children === null;
    const isPhase = depth === 0;
    const exp = expanded[node.code];
    const isSel = selectedL4 === node.code;
    const count = supplyCount[node.code];

    return (
      <div key={node.code}>
        <div
          onClick={()=>{ if(isLeaf) onSelectL4(node.code); else toggle(node.code); }}
          className={`flex items-center gap-1 py-1 px-2 cursor-pointer rounded text-xs transition-colors
            ${isPhase ? "font-bold text-blue-300 hover:bg-blue-900" : ""}
            ${isSel ? "bg-blue-600 text-white" : !isPhase ? "text-gray-300 hover:bg-gray-700" : ""}
          `}
          style={{paddingLeft:`${8+depth*12}px`}}>
          <span className="w-3 text-center text-gray-500 flex-shrink-0">
            {isLeaf ? "·" : (exp ? "▾" : "▸")}
          </span>
          <span className={`font-mono text-xs flex-shrink-0 ${isSel?"text-blue-200":"text-gray-500"}`}>{node.code}</span>
          <span className="ml-1 truncate">{node.label}</span>
          {count > 0 && !isLeaf && (
            <span className={`ml-auto flex-shrink-0 text-xs px-1 rounded ${isSel?"bg-blue-500 text-white":"bg-gray-700 text-gray-400"}`}>{count}</span>
          )}
        </div>
        {!isLeaf && exp && node.children.map(child=>renderNode(child, depth+1))}
      </div>
    );
  };

  const phases = [
    {id:1,label:"1 · Planning"},
    {id:2,label:"2 · Design"},
    {id:3,label:"3 · Construction"},
    {id:4,label:"4 · Commissioning"},
    {id:5,label:"5 · M&C"},
  ];

  return (
    <div className="w-64 bg-gray-900 flex flex-col overflow-hidden flex-shrink-0">
      <div className="p-2 border-b border-gray-700">
        <input value={searchText.nav||""} onChange={e=>searchText.setNav(e.target.value)}
          placeholder="Search WBS…"
          className="w-full bg-gray-800 text-white text-xs px-2 py-1.5 rounded border border-gray-700 placeholder-gray-500 focus:outline-none focus:border-blue-500" />
      </div>
      <div className="flex border-b border-gray-700 overflow-x-auto">
        {phases.map(p=>(
          <button key={p.id} onClick={()=>setActivePhase(p.id)}
            className={`text-xs px-2 py-1.5 whitespace-nowrap flex-shrink-0 transition-colors ${activePhase===p.id?"bg-orange-600 text-white font-bold":"text-gray-400 hover:bg-gray-800"}`}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {(tree[activePhase-1]?.children||[]).map(node=>renderNode(node,0))}
      </div>
    </div>
  );
}

// ── ESTIMATION SCREEN ────────────────────────────────────────────
function EstimationScreen({ isCommercial, lines, setLines }) {
  const { wbs, supply, rates, loading } = useData();
  const [activePhase, setActivePhase]   = useState(3);
  const [selectedL4, setSelectedL4]     = useState("3.1.3.04");
  const [expandedRows, setExpandedRows] = useState({});
  const [navSearch, setNavSearch]       = useState("");

  // Filter supply items for selected L4 group
  const items = useMemo(()=>{
    if (!selectedL4) return [];
    if (navSearch) {
      return supply.filter(s=>
        s.description?.toLowerCase().includes(navSearch.toLowerCase()) ||
        s.wbs_code?.toLowerCase().includes(navSearch.toLowerCase())
      ).slice(0,50);
    }
    return supply.filter(s=>s.l4_group===selectedL4);
  },[supply, selectedL4, navSearch]);

  // L4 label
  const l4label = useMemo(()=>{
    const found = wbs.find(w=>w.wbs_code===selectedL4);
    return found?.description || selectedL4;
  },[wbs, selectedL4]);

  const getLine = code => lines[code] || {};
  const updLine = (code, key, val) => setLines(p=>({...p,[code]:{...p[code],[key]:val}}));

  const calcItem = useCallback((item)=>{
    const ln = getLine(item.wbs_code);
    return calcLine(item, ln.qty||"", ln.factor||"1", ln.delivery, ln.instHrsOvrd, ln.contrRate, ln.plant, ln.mats, isCommercial);
  },[lines, isCommercial]);

  const groupTotals = useMemo(()=>items.reduce((a,it)=>{
    const c=calcItem(it);
    return {installHrs:a.installHrs+c.installHrs,commHrs:a.commHrs+c.commHrs,eeTotal:a.eeTotal+c.eeInt,commTotal:a.commTotal+c.comm};
  },{installHrs:0,commHrs:0,eeTotal:0,commTotal:0}),[items,calcItem]);

  const investTotals = useMemo(()=>supply.reduce((a,it)=>{
    const c=calcItem(it);
    return {installHrs:a.installHrs+c.installHrs,commHrs:a.commHrs+c.commHrs,eeTotal:a.eeTotal+c.eeInt,commTotal:a.commTotal+c.comm};
  },{installHrs:0,commHrs:0,eeTotal:0,commTotal:0}),[supply,calcItem]);

  const linesEntered = Object.values(lines).filter(l=>parseFloat(l.qty)>0).length;

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-gray-50">
      <div className="text-center text-gray-400">
        <div className="text-3xl mb-3 animate-spin">⟳</div>
        <div className="text-sm font-semibold">Loading WBS data…</div>
        <div className="text-xs mt-1">Fetching 1,431 supply items from GitHub</div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* LEFT — WBS Nav */}
      <WBSNavTree
        wbs={wbs} supply={supply}
        activePhase={activePhase} setActivePhase={setActivePhase}
        selectedL4={selectedL4} onSelectL4={setSelectedL4}
        searchText={{nav:navSearch, setNav:setNavSearch}}
      />

      {/* CENTRE — Item list */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="bg-white border-b px-4 py-2 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="font-bold text-blue-900 text-sm">{selectedL4} — {l4label}</div>
            <div className="text-xs text-gray-400">{items.length} items · Click ▸ to expand cost detail</div>
          </div>
          <div className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded border">
            {items.filter(i=>parseFloat(getLine(i.wbs_code).qty||"0")>0).length} of {items.length} with quantities
          </div>
        </div>
        {/* Column headers */}
        <div className="bg-gray-50 border-b text-xs font-semibold text-gray-500 px-3 py-1.5 grid flex-shrink-0"
          style={{gridTemplateColumns:"16px 1fr 46px 72px 64px 90px 56px"}}>
          <div/><div>Description / WBS Code</div>
          <div className="text-center">UOM</div>
          <div className="text-center text-orange-700">Qty</div>
          <div className="text-center">Factor</div>
          <div className="text-center text-purple-700">Install Hrs</div>
          <div className="text-center text-gray-400">Expand</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 && (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
              {navSearch ? "No items match search" : "Select a WBS group from the left"}
            </div>
          )}
          {items.map((item,idx)=>{
            const ln = getLine(item.wbs_code);
            const qty = ln.qty||"";
            const factor = ln.factor||"1";
            const hasQty = parseFloat(qty)>0;
            const isExp  = !!expandedRows[item.wbs_code];
            const c = calcItem(item);
            const delivery = ln.delivery || item.delivery_method || "EE Delivered";
            const isContr  = delivery === "Contractor Delivered";
            const rowBase  = hasQty?"bg-blue-50 border-l-4 border-l-blue-500":idx%2===0?"bg-white":"bg-gray-50";
            return (
              <div key={item.wbs_code} className={`border-b ${rowBase} transition-colors`}>
                <div className="grid items-center px-3 py-2 text-xs"
                  style={{gridTemplateColumns:"16px 1fr 46px 72px 64px 90px 56px"}}>
                  <button onClick={()=>setExpandedRows(p=>({...p,[item.wbs_code]:!p[item.wbs_code]}))}
                    className={`text-center rounded text-xs w-4 h-4 flex items-center justify-center ${isExp?"bg-blue-600 text-white":"text-gray-300 hover:text-blue-500"}`}>
                    {isExp?"▾":"▸"}
                  </button>
                  <div className="min-w-0 pr-2">
                    <div className={`font-medium truncate ${hasQty?"text-blue-900":"text-gray-800"}`}>{item.description}</div>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      <span className="text-gray-400 font-mono text-xs">{item.wbs_code}</span>
                      {item.pce_price>0 && <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1">PCE {fmt(item.pce_price)}</span>}
                      {isContr
                        ? <span className="text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded px-1">Contractor</span>
                        : item.resource_main && item.resource_main !== "Supplier" &&
                          <span className="text-xs text-purple-600 bg-purple-50 border border-purple-200 rounded px-1">{item.resource_main}</span>
                      }
                      {item.resource_install && item.install_hrs_per>0 &&
                        <span className="text-xs text-blue-500 bg-blue-50 border border-blue-200 rounded px-1">Install: {item.resource_install}</span>}
                    </div>
                  </div>
                  <div className="text-center text-gray-500">{item.uom||"EA"}</div>
                  <div className="flex justify-center">
                    <input type="number" min="0" value={qty} onChange={e=>updLine(item.wbs_code,"qty",e.target.value)}
                      placeholder="0"
                      className={`w-16 text-center border rounded py-0.5 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-orange-400 ${hasQty?"border-orange-400 bg-orange-50 text-orange-800":"border-gray-300 text-gray-500"}`}/>
                  </div>
                  <div className="flex justify-center">
                    <input type="number" min="0.1" step="0.1" value={factor}
                      onChange={e=>updLine(item.wbs_code,"factor",e.target.value)}
                      className={`w-14 text-center border rounded py-0.5 text-xs focus:outline-none focus:ring-1 ${parseFloat(factor)!==1?"border-blue-400 bg-blue-50 text-blue-800 font-bold":"border-gray-200 text-gray-500"}`}/>
                  </div>
                  <div className={`text-center font-bold ${c.instHrsOverridden?"text-orange-600":hasQty?"text-purple-700":"text-gray-300"}`}>
                    {hasQty?<>{fmtHrs(c.installHrs)}{c.instHrsOverridden&&<span className="text-orange-400 ml-0.5">*</span>}</>:"–"}
                  </div>
                  <div className="text-center text-gray-300 text-xs">{isExp?"▲ close":"▸ costs"}</div>
                </div>

                {isExp && (
                  <div className="mx-3 mb-3 rounded-lg border border-blue-200 bg-white shadow-sm overflow-hidden">
                    <div className="bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 flex items-center justify-between">
                      <span>Cost Detail — {item.description?.split(" - ")[0]}</span>
                      <span className="text-blue-200 font-normal">
                        {isContr
                          ? `Contractor · Install: ${item.resource_install||item.resource_main||"—"} · Comm: ${item.resource_comm||"—"}`
                          : `${item.resource_main||"EE"} · Install: ${item.resource_install||item.resource_main||"—"} · Comm: ${item.resource_comm||"—"}`
                        }
                        {" · "}Std: {item.install_hrs_per}h install · {item.comm_hrs_per}h comm · {fmt(item.ee_labour_rate)}/hr
                      </span>
                    </div>
                    <div className="p-3 grid gap-3">
                      <div className="grid grid-cols-4 gap-3">
                        <div>
                          <label className="text-xs text-gray-500 block mb-0.5">Delivery Method</label>
                          <select value={delivery} onChange={e=>updLine(item.wbs_code,"delivery",e.target.value)}
                            className="text-xs border border-gray-300 rounded px-1.5 py-1 bg-white w-full focus:outline-none focus:ring-1 focus:ring-blue-400">
                            <option>EE Delivered</option><option>Contractor Delivered</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-0.5">Install Hrs/Unit Override</label>
                          <input type="number" min="0" value={ln.instHrsOvrd||""} placeholder={String(item.install_hrs_per||0)}
                            onChange={e=>updLine(item.wbs_code,"instHrsOvrd",e.target.value)}
                            className="w-full text-xs border border-purple-300 bg-purple-50 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-purple-400"/>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-0.5">Contractor Rate ($/unit)</label>
                          <input type="number" min="0" value={ln.contrRate||""} placeholder="0"
                            onChange={e=>updLine(item.wbs_code,"contrRate",e.target.value)}
                            className="w-full text-xs border border-teal-300 bg-teal-50 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-teal-400"/>
                        </div>
                        {hasQty && (
                          <div className="text-xs text-gray-500">
                            <div className="font-semibold mb-1 text-gray-600">Hours this item</div>
                            <div className="font-bold text-purple-700">{fmtHrs(c.installHrs)} install</div>
                            <div className="font-bold text-teal-700">{fmtHrs(c.commHrs)} comm</div>
                          </div>
                        )}
                      </div>
                      <div className="border-t border-gray-100"/>
                      <div className="grid grid-cols-4 gap-3">
                        <div>
                          <label className="text-xs text-gray-500 block mb-0.5">Equipment Price/Unit ($)</label>
                          <input type="number" min="0" value={ln.mats||""} placeholder={item.pce_price>0?String(item.pce_price):"0"}
                            onChange={e=>updLine(item.wbs_code,"mats",e.target.value)}
                            className="w-full text-xs border border-green-300 bg-green-50 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-green-400"/>
                          {item.pce_price>0&&<div className="text-xs text-amber-600 mt-0.5">PCE default: {fmt(item.pce_price)}</div>}
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-0.5">Plant & Machinery ($)</label>
                          <input type="number" min="0" value={ln.plant||""} placeholder="0"
                            onChange={e=>updLine(item.wbs_code,"plant",e.target.value)}
                            className="w-full text-xs border border-blue-200 bg-blue-50 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300"/>
                        </div>
                        {hasQty && (
                          <div className="col-span-2 bg-gray-50 rounded border border-gray-200 p-2 text-xs">
                            <div className="font-semibold text-gray-600 mb-1.5">Line Cost Breakdown</div>
                            <div className="space-y-0.5">
                              {!isContr&&<div className="flex justify-between"><span className="text-gray-500">EE Labour</span><span className="font-medium">{fmt(c.eeLabCost)}</span></div>}
                              {isContr&&<div className="flex justify-between"><span className="text-gray-500">Contractor</span><span className="font-medium">{fmt(c.contrCost)}</span></div>}
                              {c.equipCost>0&&<div className="flex justify-between"><span className="text-gray-500">Equipment</span><span className="font-medium">{fmt(c.equipCost)}</span></div>}
                              {c.plantFact>0&&<div className="flex justify-between"><span className="text-gray-500">Plant (×factor)</span><span className="font-medium">{fmt(c.plantFact)}</span></div>}
                              {c.matBurden>0&&<div className="flex justify-between"><span className="text-gray-500">Mat. Burden</span><span className="font-medium">{fmt(c.matBurden)}</span></div>}
                              <div className="border-t border-gray-200 mt-1 pt-1 flex justify-between font-bold">
                                <span className="text-blue-800">EE Internal</span><span className="text-blue-800">{fmt(c.eeInt)}</span>
                              </div>
                              <div className="flex justify-between font-bold">
                                <span className="text-orange-700">Commercial</span><span className="text-orange-700">{fmt(c.comm)}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="border-t border-gray-100 pt-2">
                        <label className="text-xs text-gray-500 block mb-1">Comments / Scope inclusions & exclusions</label>
                        <textarea value={ln.comments||""} onChange={e=>updLine(item.wbs_code,"comments",e.target.value)}
                          rows={2} placeholder="e.g. Includes conductor and insulators. Excludes foundation design."
                          className="w-full text-xs border border-gray-200 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300"/>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT — Live Cost */}
      <div className="w-56 bg-white border-l flex flex-col overflow-hidden flex-shrink-0">
        <div className="bg-orange-700 text-white text-xs font-bold px-3 py-2 uppercase tracking-wide">Live Cost Display</div>
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-2 bg-blue-50 border-b">
            <div className="text-xs font-bold text-blue-800 mb-2 uppercase tracking-wide truncate">{l4label}</div>
            {[
              {label:"Install Hours",value:fmtHrs(groupTotals.installHrs),color:"text-purple-700",bg:"bg-purple-50 border border-purple-100"},
              {label:"Commission Hours",value:fmtHrs(groupTotals.commHrs),color:"text-teal-700",bg:"bg-teal-50 border border-teal-100"},
            ].map(r=>(
              <div key={r.label} className={`flex justify-between items-center py-1 px-2 rounded mb-1 ${r.bg}`}>
                <span className="text-xs text-gray-600">{r.label}</span>
                <span className={`text-xs font-bold ${r.color}`}>{r.value}</span>
              </div>
            ))}
            <div className="my-2 border-t border-blue-200"/>
            <div className="flex justify-between items-center py-1.5 px-2 rounded bg-blue-100 mb-1">
              <span className="text-xs font-semibold text-blue-800">EE Internal</span>
              <span className="text-xs font-bold text-blue-900">{fmt(groupTotals.eeTotal)}</span>
            </div>
            <div className="flex justify-between items-center py-1.5 px-2 rounded bg-orange-100">
              <span className="text-xs font-semibold text-orange-800">Commercial</span>
              <span className="text-xs font-bold text-orange-900">{fmt(groupTotals.commTotal)}</span>
            </div>
          </div>
          <div className="px-3 py-2">
            <div className="text-xs font-bold text-gray-600 mb-2 uppercase tracking-wide border-b pb-1">Investment Totals</div>
            {[
              {label:"Install Hours",value:fmtHrs(investTotals.installHrs),color:"text-purple-700"},
              {label:"Commission Hrs",value:fmtHrs(investTotals.commHrs),color:"text-teal-700"},
            ].map(r=>(
              <div key={r.label} className="flex justify-between items-center py-1 border-b border-gray-100">
                <span className="text-xs text-gray-600">{r.label}</span>
                <span className={`text-xs font-bold ${r.color}`}>{r.value}</span>
              </div>
            ))}
            <div className="mt-2 py-1.5 px-2 bg-blue-800 rounded text-white flex justify-between items-center mb-1">
              <span className="text-xs font-semibold">EE Internal Total</span>
              <span className="text-xs font-bold">{fmt(investTotals.eeTotal)}</span>
            </div>
            <div className="py-1.5 px-2 bg-orange-600 rounded text-white flex justify-between items-center">
              <span className="text-xs font-semibold">Commercial Total</span>
              <span className="text-xs font-bold">{fmt(investTotals.commTotal)}</span>
            </div>
            <div className="mt-3 text-xs text-gray-400 text-center">{linesEntered} line{linesEntered!==1?"s":""} entered</div>
            <div className="mt-2 space-y-1 border-t border-gray-100 pt-2">
              <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Indicators</div>
              <div className="flex items-center gap-1.5 text-xs text-gray-500"><span className="text-orange-400">●</span>Row has overrides</div>
              <div className="flex items-center gap-1.5 text-xs text-gray-500"><span className="text-orange-600 font-bold">* hrs</span>Install hrs overridden</div>
              <div className="flex items-center gap-1.5 text-xs text-gray-500"><span className="bg-amber-100 text-amber-700 text-xs px-1 rounded">PCE</span>Period contract price</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── REVIEW LINES SCREEN ─────────────────────────────────────────
function ReviewLines({ lines, isCommercial }) {
  const { supply } = useData();
  const entered = supply.filter(s=>parseFloat(lines[s.wbs_code]?.qty||"0")>0);
  const totals = entered.reduce((a,item)=>{
    const ln=lines[item.wbs_code]||{};
    const c=calcLine(item,ln.qty||"",ln.factor||"1",ln.delivery,ln.instHrsOvrd,ln.contrRate,ln.plant,ln.mats,isCommercial);
    return {installHrs:a.installHrs+c.installHrs,commHrs:a.commHrs+c.commHrs,eeInt:a.eeInt+c.eeInt,comm:a.comm+c.comm};
  },{installHrs:0,commHrs:0,eeInt:0,comm:0});

  if (entered.length===0) return (
    <div className="flex-1 flex items-center justify-center bg-gray-50">
      <div className="text-center text-gray-400">
        <div className="text-4xl mb-3">📋</div>
        <div className="text-sm font-semibold text-gray-500">No lines entered yet</div>
        <div className="text-xs mt-1">Enter quantities in the Estimation tab to see lines here</div>
      </div>
    </div>
  );

  // Group by L1 phase
  const byPhase = {};
  entered.forEach(item=>{
    const phase=item.wbs_code.split(".")[0];
    if(!byPhase[phase]) byPhase[phase]=[];
    byPhase[phase].push(item);
  });

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Summary bar */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 grid grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-800">{entered.length}</div>
            <div className="text-xs text-gray-500">Lines Entered</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-700">{fmtHrs(totals.installHrs)}</div>
            <div className="text-xs text-gray-500">Install Hours</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-900">{fmt(totals.eeInt)}</div>
            <div className="text-xs text-gray-500">EE Internal Total</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-orange-700">{fmt(totals.comm)}</div>
            <div className="text-xs text-gray-500">Commercial Total</div>
          </div>
        </div>

        {Object.entries(byPhase).map(([phase,items])=>(
          <div key={phase} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="bg-gray-700 text-white text-xs font-bold px-4 py-2 uppercase tracking-wide">
              Phase {phase}
            </div>
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500">WBS Code</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500">Description</th>
                  <th className="text-center px-3 py-2 font-semibold text-gray-500">Qty</th>
                  <th className="text-center px-3 py-2 font-semibold text-gray-500">UOM</th>
                  <th className="text-right px-3 py-2 font-semibold text-purple-600">Install Hrs</th>
                  <th className="text-right px-3 py-2 font-semibold text-teal-600">Comm Hrs</th>
                  <th className="text-right px-3 py-2 font-semibold text-blue-700">EE Internal</th>
                  <th className="text-right px-3 py-2 font-semibold text-orange-700">Commercial</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500">Delivery</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item=>{
                  const ln=lines[item.wbs_code]||{};
                  const c=calcLine(item,ln.qty||"",ln.factor||"1",ln.delivery,ln.instHrsOvrd,ln.contrRate,ln.plant,ln.mats,isCommercial);
                  return (
                    <tr key={item.wbs_code} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-blue-600 whitespace-nowrap">{item.wbs_code}</td>
                      <td className="px-3 py-2 text-gray-800 max-w-xs truncate">{item.description}</td>
                      <td className="px-3 py-2 text-center font-bold text-orange-700">{ln.qty}</td>
                      <td className="px-3 py-2 text-center text-gray-500">{item.uom||"EA"}</td>
                      <td className="px-3 py-2 text-right font-medium text-purple-700">{fmtHrs(c.installHrs)}</td>
                      <td className="px-3 py-2 text-right font-medium text-teal-700">{fmtHrs(c.commHrs)}</td>
                      <td className="px-3 py-2 text-right font-bold text-blue-800">{fmt(c.eeInt)}</td>
                      <td className="px-3 py-2 text-right font-bold text-orange-700">{fmt(c.comm)}</td>
                      <td className="px-3 py-2 text-gray-500">{c.isContr?"Contractor":"EE"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── SUMMARY SCREEN ───────────────────────────────────────────────
function SummaryScreen({ inv, lines, isCommercial, equipSel, onSave, lastSaved }) {
  const { supply, commLookup } = useData();
  const entered = supply.filter(s=>parseFloat(lines[s.wbs_code]?.qty||"0")>0);

  // Phase 1-3, 5 rollups from entered supply items
  const phaseNames = {"1":"Planning","2":"Design","3":"Construction","4":"Commissioning","5":"M&C"};
  const byPhase = {};
  entered.forEach(item=>{
    const ph=item.wbs_code.split(".")[0];
    if(ph==="4") return; // Phase 4 is derived separately
    if(!byPhase[ph]) byPhase[ph]={eeInt:0,comm:0,installHrs:0,commHrs:0,lines:0};
    const ln=lines[item.wbs_code]||{};
    const c=calcLine(item,ln.qty||"",ln.factor||"1",ln.delivery,ln.instHrsOvrd,ln.contrRate,ln.plant,ln.mats,isCommercial);
    byPhase[ph].eeInt+=c.eeInt; byPhase[ph].comm+=c.comm;
    byPhase[ph].installHrs+=c.installHrs; byPhase[ph].commHrs+=c.commHrs;
    byPhase[ph].lines++;
  });

  // Phase 4 — derived from commission_wbs links on supply items
  // For each unique commission_wbs, sum qty across all supply items pointing to it
  const commTotals = {}; // comm_wbs -> {qty, hrs_per_unit, ...}
  entered.forEach(item=>{
    if(!item.commission_wbs || !commLookup[item.commission_wbs]) return;
    const qty = parseFloat(lines[item.wbs_code]?.qty||"0");
    const factor = parseFloat(lines[item.wbs_code]?.factor||"1");
    const commWbs = item.commission_wbs;
    if(!commTotals[commWbs]) commTotals[commWbs] = {
      qty:0, ...commLookup[commWbs]
    };
    commTotals[commWbs].qty += qty * factor;
  });

  const eeRate = 139.26; // default commissioning rate
  const phase4 = Object.entries(commTotals).reduce((a,[,ct])=>{
    const hrs = ct.qty * (ct.hrs_per_unit||0);
    const rate = ct.ee_labour_rate || eeRate;
    const cost = hrs * rate;
    const costComm = cost * (1 + ANS_LAB);
    return {commHrs: a.commHrs+hrs, eeInt: a.eeInt+cost, comm: a.comm+costComm, lines: a.lines+(ct.qty>0?1:0)};
  },{commHrs:0,eeInt:0,comm:0,lines:0});

  if(phase4.commHrs > 0) byPhase["4"] = {...phase4, installHrs:0};

  const grandEE   = Object.values(byPhase).reduce((a,p)=>a+p.eeInt,0);
  const grandComm = Object.values(byPhase).reduce((a,p)=>a+p.comm,0);
  const contPct = parseFloat(isCommercial?inv.contComm:inv.contInt)||10;
  const contAmt = (isCommercial?grandComm:grandEE) * contPct/100;
  const totalWithCont = (isCommercial?grandComm:grandEE) + contAmt;

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto space-y-4">

        {/* Investment header */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-lg font-bold text-gray-900">{inv.name||"Unnamed Investment"}</div>
              <div className="text-xs text-gray-400 mt-0.5">
                {inv.number} · {inv.estClass} · Rev {inv.revision} · {inv.type}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {lastSaved && <span className="text-xs text-green-600">✓ Saved {lastSaved}</span>}
              <button onClick={onSave}
                className="bg-green-700 hover:bg-green-600 text-white text-xs px-4 py-2 rounded font-semibold shadow">
                💾 Save Investment
              </button>
              <button className="bg-blue-700 hover:bg-blue-600 text-white text-xs px-4 py-2 rounded font-semibold shadow">
                ☁️ Export Copperleaf CSV
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center border-t border-gray-100 pt-3">
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Estimator</div>
              <div className="text-sm font-semibold text-gray-800">{inv.estimatedBy}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Reviewer</div>
              <div className="text-sm font-semibold text-gray-800">{inv.reviewedBy}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Complexity / New Tech</div>
              <div className="text-sm font-semibold text-gray-800">{inv.complexity} / {inv.newTech}</div>
            </div>
          </div>
        </div>

        {/* Phase rollup table */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="bg-blue-800 text-white text-xs font-bold px-4 py-2 uppercase tracking-wide">
            Cost Summary by Phase
          </div>
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-2 font-semibold text-gray-500">Phase</th>
                <th className="text-center px-4 py-2 font-semibold text-gray-500">Lines</th>
                <th className="text-right px-4 py-2 font-semibold text-purple-600">Install Hrs</th>
                <th className="text-right px-4 py-2 font-semibold text-teal-600">Comm Hrs</th>
                <th className="text-right px-4 py-2 font-semibold text-blue-700">EE Internal</th>
                <th className="text-right px-4 py-2 font-semibold text-orange-700">Commercial</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byPhase).map(([ph,p])=>(
                <tr key={ph} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-2 font-semibold text-gray-800">
                    Phase {ph} — {phaseNames[ph]||ph}
                    {ph==="4" && <span className="ml-2 text-xs font-normal text-teal-600 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded">auto-derived from supply links</span>}
                  </td>
                  <td className="px-4 py-2 text-center text-gray-500">{p.lines}</td>
                  <td className="px-4 py-2 text-right text-purple-700 font-medium">{fmtHrs(p.installHrs)}</td>
                  <td className="px-4 py-2 text-right text-teal-700 font-medium">{fmtHrs(p.commHrs)}</td>
                  <td className="px-4 py-2 text-right text-blue-800 font-bold">{fmt(p.eeInt)}</td>
                  <td className="px-4 py-2 text-right text-orange-700 font-bold">{fmt(p.comm)}</td>
                </tr>
              ))}
              {Object.keys(byPhase).length===0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No lines entered yet</td></tr>
              )}
            </tbody>
            {grandEE>0 && (
              <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                <tr>
                  <td className="px-4 py-2 font-bold text-gray-700">Base Total</td>
                  <td className="px-4 py-2 text-center font-bold text-gray-700">{entered.length}</td>
                  <td colSpan={2}/>
                  <td className="px-4 py-2 text-right font-bold text-blue-900 text-sm">{fmt(grandEE)}</td>
                  <td className="px-4 py-2 text-right font-bold text-orange-800 text-sm">{fmt(grandComm)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 text-gray-500">Contingency ({contPct}%)</td>
                  <td colSpan={4}/>
                  <td className="px-4 py-2 text-right text-orange-600 font-medium">{fmt(contAmt)}</td>
                </tr>
                <tr className="bg-orange-50">
                  <td className="px-4 py-2 font-bold text-orange-900 text-sm">TOTAL (incl. contingency)</td>
                  <td colSpan={4}/>
                  <td className="px-4 py-2 text-right font-bold text-orange-900 text-base">{fmt(totalWithCont)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* ANS Margin note for commercial */}
        {inv.type==="Commercially Funded" && grandComm>0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-xs text-orange-800">
            <span className="font-bold">ANS Margins applied:</span> Labour ×{fmtPct(ANS_LAB)} · Materials ×{fmtPct(ANS_MAT)} · Contractor ×{fmtPct(ANS_CON)}
            · EE Internal base: {fmt(grandEE)} · Commercial uplift: {fmt(grandComm-grandEE)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── SAVED INVESTMENTS SCREEN ─────────────────────────────────────
function SavedInvestments({ onLoad }) {
  const [saved, setSaved] = useState([]);
  useEffect(()=>{
    try {
      const raw = localStorage.getItem("iet_investments");
      if(raw) setSaved(JSON.parse(raw));
    } catch(e){}
  },[]);

  const del = (id) => {
    const updated = saved.filter(s=>s.id!==id);
    setSaved(updated);
    localStorage.setItem("iet_investments", JSON.stringify(updated));
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-base font-bold text-gray-900">Saved Investments</div>
            <div className="text-xs text-gray-500">Stored in browser localStorage · {saved.length} investment{saved.length!==1?"s":""}</div>
          </div>
        </div>
        {saved.length===0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
            <div className="text-3xl mb-2">💾</div>
            <div className="text-sm font-semibold">No saved investments yet</div>
            <div className="text-xs mt-1">Use the Summary tab to save an investment</div>
          </div>
        ) : (
          <div className="space-y-3">
            {saved.map(s=>(
              <div key={s.id} className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-900">{s.inv.name||"Unnamed"}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {s.inv.number} · {s.inv.estClass} · Rev {s.inv.revision} · {s.inv.type}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    Saved: {s.savedAt} · {s.linesCount} line{s.linesCount!==1?"s":""} ·
                    EE: {fmt(s.totalEE)} · Commercial: {fmt(s.totalComm)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={()=>onLoad(s)}
                    className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded font-semibold">
                    Load
                  </button>
                  <button onClick={()=>del(s.id)}
                    className="text-xs border border-red-200 text-red-500 hover:bg-red-50 px-3 py-1.5 rounded">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── WBS MANAGER ──────────────────────────────────────────────────
const WBS_PROFILES = [
  {id:"SCADA_RTC",name:"SCADA RTC",section:"SCADA",status:"Approved",tiers:[{f:1,t:2,s:1.00},{f:3,t:4,s:0.95},{f:5,t:7,s:0.90},{f:8,t:9,s:0.85},{f:10,t:null,s:0.80}]},
  {id:"SCADA_OTHER",name:"SCADA General",section:"SCADA",status:"Draft",tiers:[{f:1,t:2,s:1.00},{f:3,t:5,s:0.95},{f:6,t:null,s:0.90}]},
  {id:"HV_PLANT_OUTDOOR",name:"HV Plant — Outdoor",section:"HV Plant",status:"Pending",tiers:[{f:1,t:2,s:1.00},{f:3,t:5,s:0.80},{f:6,t:null,s:0.75}]},
  {id:"HV_PLANT_INSTR",name:"HV Plant — Instrument",section:"HV Plant",status:"Pending",tiers:[{f:1,t:2,s:1.00},{f:3,t:5,s:0.80},{f:6,t:null,s:0.75}]},
  {id:"PROTECTION_STD",name:"Protection Standard",section:"Protection",status:"Draft",tiers:[{f:1,t:2,s:1.00},{f:3,t:5,s:0.92},{f:6,t:9,s:0.87},{f:10,t:null,s:0.83}]},
  {id:"COMMS_STANDARD",name:"Communications",section:"Comms",status:"Draft",tiers:[{f:1,t:2,s:1.00},{f:3,t:6,s:0.90},{f:7,t:null,s:0.85}]},
];
const WBS_ST={Approved:"bg-green-100 text-green-700",Pending:"bg-yellow-100 text-yellow-700",Draft:"bg-gray-100 text-gray-500"};
const WBS_FC=f=>f>=1?"text-green-600":f>=0.90?"text-blue-600":f>=0.85?"text-yellow-600":f>=0.80?"text-orange-600":"text-red-600";
const WBS_ROLE_STYLES={"Lead Estimator":"bg-blue-100 text-blue-700","Senior Estimator":"bg-purple-100 text-purple-700","Estimator":"bg-gray-100 text-gray-600","Project Manager":"bg-green-100 text-green-700"};
const SAMPLE_PEOPLE=[
  {id:1,name:"Daniel Lawrence",email:"d.lawrence@essentialenergy.com.au",role:"Lead Estimator",team:"Zone Substation",canReview:true,active:true},
  {id:2,name:"Steven Hannigan",email:"s.hannigan@essentialenergy.com.au",role:"Lead Estimator",team:"Zone Substation",canReview:true,active:true},
  {id:3,name:"Richard Gonzalez",email:"r.gonzalez@essentialenergy.com.au",role:"Senior Estimator",team:"Subtransmission",canReview:true,active:true},
  {id:4,name:"Wayne Trezise",email:"w.trezise@essentialenergy.com.au",role:"Senior Estimator",team:"Commissioning",canReview:true,active:true},
  {id:5,name:"Joshua Walker",email:"j.walker@essentialenergy.com.au",role:"Estimator",team:"Zone Substation",canReview:false,active:true},
  {id:6,name:"Matt Baker",email:"m.baker@essentialenergy.com.au",role:"Estimator",team:"Communications",canReview:false,active:true},
  {id:7,name:"Ryan Evans",email:"r.evans@essentialenergy.com.au",role:"Estimator",team:"Civil & Earthing",canReview:false,active:true},
  {id:8,name:"Stephanie Dewar",email:"s.dewar@essentialenergy.com.au",role:"Project Manager",team:"Zone Substation",canReview:true,active:true},
  {id:9,name:"Adrian Bruce",email:"a.bruce@essentialenergy.com.au",role:"Estimator",team:"Subtransmission",canReview:false,active:true},
  {id:10,name:"Ben Morgan",email:"b.morgan@essentialenergy.com.au",role:"Estimator",team:"Zone Substation",canReview:false,active:false},
];

// ── VIRTUAL SCROLL LIST FOR WBS ITEMS ───────────────────────────
// Renders only visible rows — handles all 2,359 rows smoothly
const ROW_HEIGHT = 30; // px per row
const OVERSCAN   = 20; // extra rows above/below viewport

function WBSVirtualList({ rows, managerMode=false, editingWbs=null, editVals={}, setEditVals, onStartEdit, onSaveEdit, onCancelEdit, wbsOverrides={} }) {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  useEffect(()=>{
    const el = containerRef.current;
    if (!el) return;
    setContainerHeight(el.clientHeight);
    const onScroll = () => setScrollTop(el.scrollTop);
    const onResize = () => setContainerHeight(el.clientHeight);
    el.addEventListener('scroll', onScroll, {passive:true});
    window.addEventListener('resize', onResize);
    return ()=>{ el.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize); };
  },[]);

  // Reset scroll when rows change (new filter applied)
  useEffect(()=>{
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setScrollTop(0);
  },[rows]);

  const totalHeight = rows.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx   = Math.min(rows.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);
  const visibleRows = rows.slice(startIdx, endIdx);
  const offsetTop   = startIdx * ROW_HEIGHT;

  return (
    <div ref={containerRef} className="h-full overflow-y-auto relative">
      {/* Sticky header */}
      <table className="w-full text-xs table-fixed" style={{position:'sticky',top:0,zIndex:10}}>
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="text-left px-3 py-2 font-semibold text-gray-500 w-36">WBS Code</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-500">Description</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-500 w-36">Scope</th>
            <th className="text-center px-3 py-2 font-semibold text-gray-500 w-16">{managerMode?"Edit":"Lvl"}</th>
          </tr>
        </thead>
      </table>
      {/* Virtual scroll body */}
      <div style={{height: totalHeight, position:'relative'}}>
        <table className="w-full text-xs table-fixed" style={{position:'absolute',top:offsetTop,left:0,right:0}}>
          <colgroup>
            <col style={{width:'144px'}}/><col/><col style={{width:'144px'}}/><col style={{width:'40px'}}/>
          </colgroup>
          <tbody>
            {visibleRows.map(row=>{
              const isEditing = editingWbs === row.wbs_code;
              const isAdded   = !!wbsOverrides[row.wbs_code]?._added;
              return (
              <tr key={row.wbs_code}
                className={`border-b hover:bg-gray-50 ${isAdded?"bg-green-50":isEditing?"bg-blue-50":""}`}
                style={{height:ROW_HEIGHT}}>
                <td className="px-3 py-1 font-mono text-blue-700 whitespace-nowrap overflow-hidden text-ellipsis">
                  {row.wbs_code}
                  {isAdded && <span className="ml-1 text-xs text-green-600 font-semibold">NEW</span>}
                </td>
                <td className="px-3 py-1 overflow-hidden whitespace-nowrap"
                  style={{paddingLeft:`${12+((row.depth||1)-1)*10}px`}}>
                  {isEditing
                    ? <input value={editVals.description||""} onChange={e=>setEditVals(p=>({...p,description:e.target.value}))}
                        autoFocus
                        className="w-full border border-blue-400 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                        style={{height:"22px"}}/>
                    : <span className="text-gray-800">{row.description||<span className="text-gray-300 italic">—</span>}</span>
                  }
                </td>
                <td className="px-3 py-1">
                  {isEditing
                    ? <select value={editVals.scope||"Supply"} onChange={e=>setEditVals(p=>({...p,scope:e.target.value}))}
                        className="border border-blue-400 rounded px-1 py-0.5 text-xs bg-white focus:outline-none"
                        style={{height:"22px"}}>
                        {["Supply","Install","Commission","Supply & Install","Demolition/Removal"].map(s=><option key={s}>{s}</option>)}
                      </select>
                    : row.scope&&row.scope!=="nan"?<ScopeBadge scope={row.scope}/>:<span className="text-gray-300">—</span>
                  }
                </td>
                <td className="px-2 py-1 text-center">
                  {managerMode
                    ? isEditing
                      ? <div className="flex gap-1 justify-center">
                          <button onClick={()=>onSaveEdit(row.wbs_code)} className="text-green-600 hover:text-green-800 font-bold text-xs">✓</button>
                          <button onClick={onCancelEdit} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
                        </div>
                      : <button onClick={()=>onStartEdit(row)} className="text-blue-400 hover:text-blue-700 text-xs">Edit</button>
                    : <span className="text-gray-400">{row.depth}</span>
                  }
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


function WBSManager({ equipSel, setEquipSel }) {
  const {wbs:wbsCtx, rates, loading, error} = useData();
  const [tab,          setTab]         = useState("items");
  const [search,       setSearch]      = useState("");
  const [scopeFilter,  setScopeFilter] = useState("All");
  const [people,       setPeople]      = useState(SAMPLE_PEOPLE);
  const [showAdd,      setShowAdd]     = useState(false);
  const [newP,         setNewP]        = useState({name:"",email:"",role:"Estimator",team:"Zone Substation",canReview:false});

  // ── PIN-LOCKED MANAGER MODE ──
  const MANAGER_PIN = "1607";
  const [managerMode,  setManagerMode] = useState(false);
  const [showPinModal, setShowPinModal]= useState(false);
  const [pinInput,     setPinInput]    = useState("");
  const [pinError,     setPinError]    = useState(false);
  const pinRef = useRef(null);

  // ── WBS EDIT STATE ──
  const [wbsOverrides, setWbsOverrides] = useState({}); // {wbs_code: {description, scope}}
  const [editingWbs,   setEditingWbs]   = useState(null);
  const [editVals,     setEditVals]     = useState({});
  const [showAddWbs,   setShowAddWbs]   = useState(false);
  const [newWbs,       setNewWbs]       = useState({wbs_code:"",description:"",scope:"Supply",depth:6});

  // Merge overrides with context WBS
  const wbs = useMemo(()=>{
    if (!Object.keys(wbsOverrides).length) return wbsCtx;
    return wbsCtx.map(r => wbsOverrides[r.wbs_code] ? {...r,...wbsOverrides[r.wbs_code]} : r);
  },[wbsCtx, wbsOverrides]);

  const filtered = useMemo(()=>wbs.filter(r=>{
    const ms=!search||r.wbs_code.toLowerCase().includes(search.toLowerCase())||(r.description||"").toLowerCase().includes(search.toLowerCase());
    const sc=scopeFilter==="All"||(scopeFilter==="Inactive"&&r.active===false)||r.scope===scopeFilter;
    return ms&&sc;
  }),[wbs, search, scopeFilter]);

  const tryUnlock = () => {
    if (pinInput === MANAGER_PIN) {
      setManagerMode(true); setShowPinModal(false);
      setPinInput(""); setPinError(false);
    } else {
      setPinError(true); setPinInput("");
      setTimeout(()=>setPinError(false), 2000);
    }
  };

  const startEditWbs = (row) => {
    setEditingWbs(row.wbs_code);
    setEditVals({description: row.description||"", scope: row.scope||"Supply"});
  };
  const saveEditWbs = (code) => {
    setWbsOverrides(p=>({...p,[code]:editVals}));
    setEditingWbs(null);
  };
  const addWbsItem = () => {
    if (!newWbs.wbs_code.trim()||!newWbs.description.trim()) return;
    const depth = newWbs.wbs_code.trim().split(".").length;
    setWbsOverrides(p=>({...p,[newWbs.wbs_code.trim()]:{
      ...newWbs, depth, wbs_code:newWbs.wbs_code.trim(), _added:true
    }}));
    setShowAddWbs(false);
    setNewWbs({wbs_code:"",description:"",scope:"Supply",depth:6});
  };

  const addPerson=()=>{
    if(!newP.name.trim()||!newP.email.trim()) return;
    setPeople(p=>[...p,{id:Date.now(),...newP,active:true}]);
    setShowAdd(false);
    setNewP({name:"",email:"",role:"Estimator",team:"Zone Substation",canReview:false});
  };

  const equipSelectedCount = Object.values(equipSel).filter(q=>parseFloat(q)>0).length;
  const tabs=[
    {id:"items",   label:"📋 WBS Items",          count:wbs.length},
    {id:"rates",   label:"💲 Resource Rates",      count:rates.length},
    {id:"catalogue",label:"🔧 Equipment Catalogue",count:null},
    {id:"scaling", label:"📐 Comm Scaling",         count:WBS_PROFILES.length},
    {id:"people",  label:"👥 People & Roles",       count:people.filter(p=>p.active).length},
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50">

      {/* PIN Modal */}
      {showPinModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={()=>{setShowPinModal(false);setPinInput("");}}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-72" onClick={e=>e.stopPropagation()}>
            <div className="text-center mb-4">
              <div className="text-3xl mb-2">🔐</div>
              <div className="font-bold text-gray-900">Manager Mode</div>
              <div className="text-xs text-gray-500 mt-1">Enter your manager PIN to enable editing</div>
            </div>
            <input
              ref={pinRef}
              type="password" maxLength={8}
              value={pinInput} onChange={e=>setPinInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&tryUnlock()}
              placeholder="PIN"
              autoFocus
              className={`w-full text-center text-2xl font-mono tracking-widest border-2 rounded-lg px-3 py-3 mb-3 focus:outline-none ${pinError?"border-red-500 bg-red-50 animate-pulse":"border-gray-300 focus:border-blue-500"}`}
            />
            {pinError && <div className="text-xs text-red-600 text-center mb-2">Incorrect PIN — try again</div>}
            <div className="flex gap-2">
              <button onClick={()=>{setShowPinModal(false);setPinInput("");}}
                className="flex-1 text-xs border border-gray-200 text-gray-600 py-2 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={tryUnlock}
                className="flex-1 text-xs bg-blue-700 hover:bg-blue-600 text-white py-2 rounded-lg font-semibold">Unlock</button>
            </div>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="bg-white border-b flex items-end px-4 flex-shrink-0">
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 mr-1 -mb-px flex items-center gap-1.5 transition-colors
              ${tab===t.id?"border-blue-600 text-blue-700 bg-blue-50":"border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t.label}
            {t.count!=null && <span className="bg-gray-100 text-gray-500 text-xs px-1.5 py-0.5 rounded-full font-mono">{t.count}</span>}
          </button>
        ))}
        <div className="flex-1"/>
        {loading&&<span className="text-xs text-blue-500 animate-pulse pb-2 pr-2">⟳ Loading…</span>}
        {!loading&&!error&&<span className="text-xs text-green-600 pb-2 pr-2">✓ {wbs.length} WBS · {rates.length} rates</span>}
        {error&&<span className="text-xs text-red-500 pb-2 pr-2">⚠ {error}</span>}
      </div>

      {/* WBS Items */}
      {tab==="items"&&(
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Toolbar */}
          <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-shrink-0">
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search WBS code or description…"
              className="border border-gray-300 rounded px-2 py-1.5 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-blue-400"/>
            <div className="flex border border-gray-200 rounded overflow-hidden">
              {["All","Supply","Install","Commission","Supply & Install"].map(s=>(
                <button key={s} onClick={()=>setScopeFilter(s)}
                  className={`text-xs px-2.5 py-1.5 ${scopeFilter===s?"bg-blue-700 text-white":"text-gray-600 hover:bg-gray-50"}`}>{s}</button>
              ))}
            </div>
            <span className="text-xs text-gray-400">{filtered.length.toLocaleString()} items</span>
            <div className="flex-1"/>
            {managerMode ? (
              <>
                <button onClick={()=>setShowAddWbs(s=>!s)}
                  className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded font-semibold">
                  {showAddWbs?"✕ Cancel":"+ Add WBS Item"}
                </button>
                <button onClick={()=>setManagerMode(false)}
                  className="text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded font-semibold flex items-center gap-1.5">
                  🔓 Manager Mode <span className="opacity-75">— click to lock</span>
                </button>
              </>
            ) : (
              <button onClick={()=>setShowPinModal(true)}
                className="text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 hover:border-gray-400 px-3 py-1.5 rounded font-medium flex items-center gap-1.5">
                🔒 Manager Mode
              </button>
            )}
          </div>

          {/* Add WBS form */}
          {managerMode && showAddWbs && (
            <div className="bg-green-50 border-b border-green-200 px-4 py-3 flex-shrink-0">
              <div className="text-xs font-bold text-green-800 mb-2 uppercase tracking-wide">Add New WBS Item</div>
              <div className="grid grid-cols-5 gap-2 items-end">
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">WBS Code *</label>
                  <input value={newWbs.wbs_code} onChange={e=>setNewWbs(p=>({...p,wbs_code:e.target.value}))}
                    placeholder="e.g. 3.1.3.04.1.10"
                    className="w-full border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-green-400"/>
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 block mb-0.5">Description *</label>
                  <input value={newWbs.description} onChange={e=>setNewWbs(p=>({...p,description:e.target.value}))}
                    className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Scope</label>
                  <select value={newWbs.scope} onChange={e=>setNewWbs(p=>({...p,scope:e.target.value}))}
                    className="w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-green-400">
                    {["Supply","Install","Commission","Supply & Install","Demolition/Removal"].map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <button onClick={addWbsItem} disabled={!newWbs.wbs_code.trim()||!newWbs.description.trim()}
                    className="w-full text-xs bg-green-700 hover:bg-green-600 disabled:bg-gray-300 text-white px-3 py-1.5 rounded font-semibold">
                    Add Item
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Virtual list */}
          <div className="flex-1 overflow-hidden">
            {loading?(
              <div className="flex items-center justify-center h-full text-gray-400">
                <div className="text-center"><div className="text-2xl animate-spin mb-2">⟳</div><div className="text-sm">Loading WBS…</div></div>
              </div>
            ):(
              <WBSVirtualList
                rows={filtered}
                managerMode={managerMode}
                editingWbs={editingWbs}
                editVals={editVals}
                setEditVals={setEditVals}
                onStartEdit={startEditWbs}
                onSaveEdit={saveEditWbs}
                onCancelEdit={()=>setEditingWbs(null)}
                wbsOverrides={wbsOverrides}
              />
            )}
          </div>
        </div>
      )}

      {/* Resource Rates */}
      {tab==="rates"&&(
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b sticky top-0">
              <tr>
                {["Resource Type","AER Code","ERP Code","EE Internal $/hr","EE Commercial $/hr","ANS Margin %","UOM"].map(h=>(
                  <th key={h} className="text-left px-3 py-2 font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rates.map(r=>(
                <tr key={r.resource_type} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-1.5 font-medium text-gray-800">{r.resource_type}</td>
                  <td className="px-3 py-1.5 font-mono text-blue-700">{r.aer_code}</td>
                  <td className="px-3 py-1.5 text-gray-500">{r.erp_code}</td>
                  <td className="px-3 py-1.5 text-right font-medium text-blue-900">${r.ee_internal_rate?.toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-right font-medium text-orange-700">${r.ee_commercial_rate?.toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-right text-teal-700">{r.ans_margin_pct_labour!=null?(r.ans_margin_pct_labour*100).toFixed(1)+"%":"—"}</td>
                  <td className="px-3 py-1.5 text-gray-500">{r.uom}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Equipment Catalogue */}
      {tab==="catalogue"&&(
        <EquipmentCatalogueManager equipSel={equipSel} setEquipSel={setEquipSel}/>
      )}

      {/* Commissioning Scaling */}
      {tab==="scaling"&&(
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-4xl mx-auto space-y-3">
            {WBS_PROFILES.map(profile=>(
              <div key={profile.id} className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-sm text-gray-800">{profile.name}</span>
                    <span className="text-xs text-gray-400 font-mono">{profile.id}</span>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${WBS_ST[profile.status]}`}>{profile.status}</span>
                  </div>
                  <span className="text-xs text-gray-400">{profile.section}</span>
                </div>
                <div className="p-3 flex gap-2 flex-wrap">
                  {profile.tiers.map((tier,i)=>(
                    <div key={i} className="border border-gray-200 rounded p-2 text-center min-w-[72px] bg-gray-50">
                      <div className="text-xs text-gray-500 mb-1">Qty {tier.f}{tier.t?`–${tier.t}`:"+"}</div>
                      <div className={`text-sm font-bold ${WBS_FC(tier.s)}`}>{(tier.s*100).toFixed(0)}%</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* People & Roles */}
      {tab==="people"&&(
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-shrink-0">
            <button onClick={()=>setShowAdd(s=>!s)}
              className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded font-semibold">
              {showAdd?"Cancel":"+ Add Person"}
            </button>
          </div>
          {showAdd&&(
            <div className="bg-green-50 border-b border-green-200 px-4 py-3 flex-shrink-0">
              <div className="grid grid-cols-5 gap-2 items-end">
                <div><label className="text-xs text-gray-500 block mb-0.5">Full Name *</label>
                  <input value={newP.name} onChange={e=>setNewP(p=>({...p,name:e.target.value}))}
                    className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/></div>
                <div><label className="text-xs text-gray-500 block mb-0.5">Email *</label>
                  <input value={newP.email} onChange={e=>setNewP(p=>({...p,email:e.target.value}))}
                    className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/></div>
                <div><label className="text-xs text-gray-500 block mb-0.5">Role</label>
                  <select value={newP.role} onChange={e=>setNewP(p=>({...p,role:e.target.value}))}
                    className="w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-green-400">
                    {["Estimator","Senior Estimator","Lead Estimator","Project Manager"].map(r=><option key={r}>{r}</option>)}
                  </select></div>
                <div><label className="text-xs text-gray-500 block mb-0.5">Team</label>
                  <select value={newP.team} onChange={e=>setNewP(p=>({...p,team:e.target.value}))}
                    className="w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-green-400">
                    {["Zone Substation","Subtransmission","Communications","Commissioning","Civil & Earthing"].map(t=><option key={t}>{t}</option>)}
                  </select></div>
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-1 text-xs text-gray-600 mb-1 cursor-pointer">
                    <input type="checkbox" checked={newP.canReview} onChange={e=>setNewP(p=>({...p,canReview:e.target.checked}))}/> Can Review
                  </label>
                  <button onClick={addPerson} disabled={!newP.name.trim()||!newP.email.trim()}
                    className="flex-1 text-xs bg-green-700 hover:bg-green-600 disabled:bg-gray-300 text-white px-3 py-1.5 rounded font-semibold">Add</button>
                </div>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b sticky top-0">
                <tr>{["Name","Email","Role","Team","Reviewer","Status",""].map(h=>(
                  <th key={h} className="text-left px-3 py-2 font-semibold text-gray-500">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {people.map(p=>(
                  <tr key={p.id} className={`border-b ${p.active?"hover:bg-gray-50":"opacity-50 bg-gray-50"}`}>
                    <td className="px-3 py-2 font-semibold text-gray-800">{p.name}</td>
                    <td className="px-3 py-2 text-gray-500">{p.email}</td>
                    <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${WBS_ROLE_STYLES[p.role]||"bg-gray-100 text-gray-500"}`}>{p.role}</span></td>
                    <td className="px-3 py-2 text-gray-600">{p.team}</td>
                    <td className="px-3 py-2 text-center">{p.canReview?<span className="text-green-600 font-bold">✓</span>:<span className="text-gray-300">–</span>}</td>
                    <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${p.active?"bg-green-100 text-green-700":"bg-red-100 text-red-600"}`}>{p.active?"Active":"Inactive"}</span></td>
                    <td className="px-3 py-2">
                      {p.active
                        ?<button onClick={()=>setPeople(prev=>prev.map(x=>x.id===p.id?{...x,active:false}:x))} className="text-xs text-red-500 hover:text-red-700">Deactivate</button>
                        :<button onClick={()=>setPeople(prev=>prev.map(x=>x.id===p.id?{...x,active:true}:x))} className="text-xs text-green-600 hover:text-green-800">Reactivate</button>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}



// ── EQUIPMENT SCREEN ─────────────────────────────────────────────
const TYPE_COLORS = {
  PCE:   { badge:"bg-amber-100 text-amber-800 border border-amber-300",   icon:"🔩", label:"Period Contract" },
  LLT:   { badge:"bg-red-100 text-red-700 border border-red-300",         icon:"⏱", label:"Long Lead Time"  },
  SCADA: { badge:"bg-blue-100 text-blue-700 border border-blue-300",      icon:"📡", label:"SCADA"           },
  COMMS: { badge:"bg-purple-100 text-purple-700 border border-purple-300",icon:"📶", label:"Communications"  },
};

// ── EQUIPMENT SCREEN (Estimation Tool tab) ───────────────────────
// Shows ONLY items selected for this investment — procurement report view
function EquipmentScreen({ lines, setLines, isCommercial, inv }) {
  const { supply, equipLookup, loading } = useData();
  const ANS_mat = isCommercial ? (1 + ANS_MAT) : 1;

  // Classify using the definitive equipment_wbs_lookup first, then heuristic fallback
  const classifyItem = (item) => {
    // 1. Exact match in lookup (from PCE/SCADA/Comms sheets)
    if (equipLookup[item.wbs_code]) return equipLookup[item.wbs_code].type;
    // 2. Heuristic fallback for items not in the catalogue
    const wbs  = item.wbs_code || "";
    const desc = (item.description||"").toLowerCase();
    if (wbs.startsWith("3.5") || desc.includes("scada") || desc.includes("md303") || desc.includes("md100"))
      return "SCADA";
    if (wbs.split(".").slice(0,2).join(".")==="3.2" ||
        desc.includes("router") || desc.includes("comms") || desc.includes("fibre"))
      return "COMMS";
    if (item.pce_price > 0)
      return item.lead_time_weeks > 20 ? "LLT" : "PCE";
    return null;
  };

  // Supply items with quantities that are classifiable as equipment
  const selected = useMemo(()=>{
    return supply
      .filter(s => parseFloat(lines[s.wbs_code]?.qty||"0") > 0)
      .map(s => {
        const lk = equipLookup[s.wbs_code] || {};
        return {
          ...s,
          equipType: classifyItem(s),
          make:       lk.make || s.make || "",
          model:      lk.model || s.model || "",
          part_no:    lk.part_no || "",
          contract_no: lk.contract_no || "",
          lead_time_weeks: lk.lead_time_weeks || s.lead_time_weeks || 0,
          catalogue_id: lk.catalogue_id || "",
        };
      })
      .filter(s => s.equipType !== null);
  },[supply, lines, equipLookup]);

  const selByType = useMemo(()=>{
    const m = {"LLT":[],"PCE":[],"SCADA":[],"COMMS":[]};
    selected.forEach(s => { if(m[s.equipType]) m[s.equipType].push(s); });
    return m;
  },[selected]);

  const getPrice = (s) => parseFloat(lines[s.wbs_code]?.mats||"") || s.pce_price || 0;
  const grandTotal     = selected.reduce((a,s)=> a + parseFloat(lines[s.wbs_code]?.qty||"0") * getPrice(s), 0);
  const grandTotalComm = grandTotal * ANS_mat;
  const lltItems       = selected.filter(s=>s.equipType==="LLT");

  if (loading) return (
    <div className="flex-1 flex items-center justify-center text-gray-400">
      <div className="text-center"><div className="text-2xl animate-spin mb-2">⟳</div><div>Loading…</div></div>
    </div>
  );

  if (selected.length === 0) return (
    <div className="flex-1 flex items-center justify-center bg-gray-50">
      <div className="text-center text-gray-400">
        <div className="text-5xl mb-4">📦</div>
        <div className="text-sm font-semibold text-gray-500">No equipment items selected yet</div>
        <div className="text-xs mt-2 text-gray-400">Enter quantities for PCE, SCADA or Comms items in the Estimation tab — they will appear here automatically</div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
      <div className="max-w-6xl mx-auto space-y-4">

        {/* Report header */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-base font-bold text-gray-900">Equipment Schedule — Procurement Report</div>
              <div className="text-xs text-gray-400 mt-0.5">{inv.name || "Unnamed Investment"} · {inv.number} · Rev {inv.revision}</div>
              <div className="text-xs text-gray-400">Generated {new Date().toLocaleDateString("en-AU",{dateStyle:"long"})}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500 mb-1">Total Equipment Value</div>
              <div className="text-xl font-bold text-blue-900">{fmt(grandTotal)}</div>
              {isCommercial && <div className="text-sm font-bold text-orange-700">{fmt(grandTotalComm)} commercial</div>}
              <div className="text-xs text-gray-400 mt-1">{selected.length} item{selected.length!==1?"s":""} across {Object.values(selByType).filter(a=>a.length>0).length} categories</div>
            </div>
          </div>
          {lltItems.length > 0 && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded p-2 flex items-center gap-2">
              <span className="text-red-500 text-sm">⏱</span>
              <span className="text-xs text-red-700 font-semibold">
                {lltItems.length} Long Lead Time item{lltItems.length!==1?"s":""} — early procurement recommended
              </span>
              <span className="text-xs text-red-500 ml-2">{lltItems.map(e=>e.description.split(" ").slice(0,4).join(" ")).join(" · ")}</span>
            </div>
          )}
        </div>

        {/* One table per equipment type */}
        {["LLT","PCE","SCADA","COMMS"].map(type => {
          const items = selByType[type];
          if (!items?.length) return null;
          const tc = TYPE_COLORS[type];
          const typeTotal     = items.reduce((a,s)=> a + parseFloat(lines[s.wbs_code]?.qty||"0") * getPrice(s), 0);
          const typeTotalComm = typeTotal * ANS_mat;
          return (
            <div key={type} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b"
                style={{background: type==="LLT"?"#fef2f2":type==="PCE"?"#fffbeb":type==="SCADA"?"#eff6ff":"#faf5ff"}}>
                <div className="flex items-center gap-2">
                  <span className="text-lg">{tc.icon}</span>
                  <div>
                    <span className="font-bold text-sm text-gray-900">{tc.label} Equipment</span>
                    {type==="LLT" && <span className="ml-2 text-xs text-red-600 font-medium">— Order immediately, lead time &gt;20 weeks</span>}
                  </div>
                  <span className="text-xs text-gray-400 ml-1">({items.length} item{items.length!==1?"s":""})</span>
                </div>
                <div className="text-right">
                  <div className="font-bold text-sm text-gray-900">{fmt(typeTotal)}</div>
                  {isCommercial && <div className="text-xs font-bold text-orange-700">{fmt(typeTotalComm)} comm</div>}
                </div>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-gray-500 w-32">WBS Code</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-500">Description</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-500 w-28">Make / Model</th>
                    {type==="PCE"||type==="LLT" ? <th className="text-left px-3 py-2 font-semibold text-gray-500 w-24">Contract No.</th> : null}
                    {type==="PCE"||type==="LLT" ? <th className="text-center px-3 py-2 font-semibold text-red-600 w-20">Lead Time</th> : null}
                    <th className="text-right px-3 py-2 font-semibold text-gray-500 w-24">Unit Price</th>
                    <th className="text-center px-3 py-2 font-semibold text-orange-700 w-14">Qty</th>
                    <th className="text-right px-3 py-2 font-semibold text-teal-700 w-24">Line Total</th>
                    {isCommercial && <th className="text-right px-3 py-2 font-semibold text-orange-700 w-24">Commercial</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const qty    = parseFloat(lines[item.wbs_code]?.qty||"0");
                    const price  = getPrice(item);
                    const lt     = qty * price;
                    const ltComm = lt * ANS_mat;
                    // Look up matching equipment record for make/model/contract
                    return (
                      <tr key={item.wbs_code} className="border-b hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-blue-600 whitespace-nowrap">{item.wbs_code}</td>
                        <td className="px-3 py-2 text-gray-800 font-medium max-w-xs truncate">{item.description}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs font-mono truncate">{item.make||item.model||""}</td>
                        {type==="PCE"||type==="LLT" ? <td className="px-3 py-2 text-gray-500 font-mono text-xs">{item.contract_no||""}</td> : null}
                        {type==="PCE"||type==="LLT" ? (
                          <td className="px-3 py-2 text-center">
                            {item.lead_time_weeks > 0 && (
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${item.lead_time_weeks>20?"bg-red-100 text-red-700":"bg-gray-100 text-gray-500"}`}>
                                {item.lead_time_weeks}w
                              </span>
                            )}
                          </td>
                        ) : null}
                        <td className="px-3 py-2 text-right font-medium text-gray-800">
                          {price > 0 ? fmt(price) : <span className="text-orange-500">POA</span>}
                        </td>
                        <td className="px-3 py-2 text-center font-bold text-orange-700">{qty}</td>
                        <td className="px-3 py-2 text-right font-bold text-teal-700">
                          {price > 0 ? fmt(lt) : <span className="text-orange-500">POA</span>}
                        </td>
                        {isCommercial && (
                          <td className="px-3 py-2 text-right font-bold text-orange-700">
                            {price > 0 ? fmt(ltComm) : <span className="text-orange-500">POA</span>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr>
                    <td colSpan={type==="PCE"||type==="LLT" ? 5 : 3} className="px-3 py-1.5"/>
                    <td className="px-3 py-1.5 text-right text-xs font-bold text-gray-600">Subtotal</td>
                    <td className="px-3 py-1.5 text-center text-xs font-bold text-orange-700">
                      {items.reduce((a,s)=>a+parseFloat(lines[s.wbs_code]?.qty||"0"),0)}
                    </td>
                    <td className="px-3 py-1.5 text-right text-xs font-bold text-teal-700">{fmt(typeTotal)}</td>
                    {isCommercial && <td className="px-3 py-1.5 text-right text-xs font-bold text-orange-700">{fmt(typeTotalComm)}</td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          );
        })}

        {/* Grand total */}
        <div className="bg-teal-800 rounded-lg p-4 text-white flex items-center justify-between">
          <div>
            <div className="font-bold text-sm">Total Equipment Value — {inv.name||"Investment"}</div>
            <div className="text-xs opacity-75 mt-0.5">{selected.length} items · Escalated prices as at catalogue date</div>
            {isCommercial && <div className="text-xs opacity-75">Commercial includes ANS materials margin {(ANS_MAT*100).toFixed(1)}%</div>}
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{fmt(grandTotal)}</div>
            {isCommercial && <div className="text-sm font-bold text-orange-300">{fmt(grandTotalComm)} commercial</div>}
          </div>
        </div>

        {/* Procurement notes */}
        <div className="bg-white rounded-lg border border-gray-200 p-3 text-xs text-gray-500">
          <span className="font-semibold text-gray-700">Procurement Notes: </span>
          This schedule is for procurement planning purposes. All prices are escalated estimates from the period contract or supplier quotation.
          POA items require individual quotation. LLT items should be ordered immediately upon investment approval.
          Prices are exclusive of GST. Confirm current contract pricing with Procurement before issuing purchase orders.
        </div>

      </div>
    </div>
  );
}


// ── EQUIPMENT CATALOGUE MANAGER (WBS Manager tab) ────────────────
// Admin view — full catalogue, price editing, WBS assignment, add new items
function EquipmentCatalogueManager({ equipSel, setEquipSel }) {
  const { equipment, loading } = useData();
  const [typeFilter, setTypeFilter] = useState("All");
  const [catFilter,  setCatFilter]  = useState("All");
  const [search,     setSearch]     = useState("");
  const [editing,    setEditing]    = useState(null); // item id being edited
  const [editVals,   setEditVals]   = useState({});
  const [showAdd,    setShowAdd]    = useState(false);
  const [newItem,    setNewItem]    = useState({type:"PCE",description:"",category:"",make_model:"",wbs_code:"",contract_no:"",price:"",lead_time_weeks:"",unit:"EA",comments:""});
  const [localItems, setLocalItems] = useState(null); // overrides for edited prices

  // Use localItems if any edits have been made, else use context equipment
  const allItems = useMemo(()=> localItems || equipment, [localItems, equipment]);

  const categories = useMemo(()=>[
    ...new Set(allItems.filter(e=>typeFilter==="All"||e.type===typeFilter).map(e=>e.category).filter(Boolean))
  ].sort(),[allItems, typeFilter]);

  const filtered = useMemo(()=>allItems.filter(e=>{
    const mt = typeFilter==="All" || e.type===typeFilter;
    const mc = catFilter==="All"  || e.category===catFilter;
    const ms = !search || e.description?.toLowerCase().includes(search.toLowerCase())
      || e.wbs_code?.toLowerCase().includes(search.toLowerCase())
      || e.make_model?.toLowerCase().includes(search.toLowerCase());
    return mt && mc && ms;
  }),[allItems, typeFilter, catFilter, search]);

  const selectedCount = Object.values(equipSel).filter(q=>parseFloat(q)>0).length;

  const startEdit = (item) => {
    setEditing(item.id);
    setEditVals({ price: item.price, wbs_code: item.wbs_code, contract_no: item.contract_no||"",
                  lead_time_weeks: item.lead_time_weeks||"", comments: item.comments||"" });
  };
  const saveEdit = (itemId) => {
    const base = localItems || equipment;
    setLocalItems(base.map(e => e.id===itemId ? {
      ...e,
      price: parseFloat(editVals.price)||e.price,
      wbs_code: editVals.wbs_code||e.wbs_code,
      contract_no: editVals.contract_no,
      lead_time_weeks: parseFloat(editVals.lead_time_weeks)||0,
      is_llt: parseFloat(editVals.lead_time_weeks)>20,
      type: parseFloat(editVals.lead_time_weeks)>20 ? "LLT" : (e.source==="SCADA"?"SCADA":e.source==="Comms"?"COMMS":"PCE"),
      comments: editVals.comments,
    } : e));
    setEditing(null);
  };
  const addNewItem = () => {
    if (!newItem.description.trim()) return;
    const base = localItems || equipment;
    const id = `CUSTOM-${Date.now()}`;
    setLocalItems([...base, {
      ...newItem, id, source:"Custom",
      price: parseFloat(newItem.price)||0,
      lead_time_weeks: parseFloat(newItem.lead_time_weeks)||0,
      is_llt: parseFloat(newItem.lead_time_weeks)>20,
      type: parseFloat(newItem.lead_time_weeks)>20 ? "LLT" : newItem.type,
      make_model: newItem.make_model, voltage:"", is_poa: !newItem.price,
      current_price: parseFloat(newItem.price)||0, escalated_price: parseFloat(newItem.price)||0,
    }]);
    setShowAdd(false);
    setNewItem({type:"PCE",description:"",category:"",make_model:"",wbs_code:"",contract_no:"",price:"",lead_time_weeks:"",unit:"EA",comments:""});
  };

  if (loading) return <div className="flex-1 flex items-center justify-center text-gray-400 text-sm animate-pulse">Loading catalogue…</div>;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* LEFT — filter sidebar */}
      <div className="w-48 bg-white border-r flex flex-col flex-shrink-0 overflow-hidden">
        <div className="bg-teal-800 text-white px-3 py-2 flex-shrink-0">
          <div className="text-xs font-bold uppercase tracking-wide">Equipment Catalogue</div>
          <div className="text-xs opacity-75 mt-0.5">{allItems.length} items · {selectedCount} selected</div>
        </div>
        <div className="px-3 py-2 border-b flex-shrink-0">
          <div className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Type</div>
          {["All","PCE","LLT","SCADA","COMMS"].map(t=>(
            <button key={t} onClick={()=>{setTypeFilter(t);setCatFilter("All");}}
              className={`w-full text-left flex items-center justify-between px-2 py-1 rounded text-xs mb-0.5 ${typeFilter===t?"bg-teal-600 text-white":"text-gray-700 hover:bg-gray-100"}`}>
              <span>{t==="All"?"All Types":`${TYPE_COLORS[t]?.icon} ${TYPE_COLORS[t]?.label}`}</span>
              <span className={`text-xs px-1 rounded font-mono ${typeFilter===t?"bg-teal-500 text-white":"bg-gray-100 text-gray-500"}`}>
                {t==="All"?allItems.length:allItems.filter(e=>e.type===t).length}
              </span>
            </button>
          ))}
        </div>
        <div className="px-3 py-2 flex-1 overflow-y-auto">
          <div className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Category</div>
          <button onClick={()=>setCatFilter("All")}
            className={`w-full text-left px-2 py-1 rounded text-xs mb-0.5 ${catFilter==="All"?"bg-teal-50 text-teal-700 font-semibold":"text-gray-600 hover:bg-gray-50"}`}>
            All Categories
          </button>
          {categories.map(c=>(
            <button key={c} onClick={()=>setCatFilter(c)}
              className={`w-full text-left px-2 py-1 rounded text-xs mb-0.5 truncate ${catFilter===c?"bg-teal-50 text-teal-700 font-semibold":"text-gray-600 hover:bg-gray-50"}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* MAIN */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="bg-white border-b px-3 py-2 flex items-center gap-2 flex-shrink-0">
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search description, WBS, make/part…"
            className="border border-gray-300 rounded px-2 py-1.5 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-teal-400"/>
          {search && <button onClick={()=>setSearch("")} className="text-xs text-gray-400 hover:text-gray-600">✕</button>}
          <span className="text-xs text-gray-400">{filtered.length} items</span>
          <div className="flex-1"/>
          <button onClick={()=>setShowAdd(s=>!s)}
            className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded font-semibold">
            {showAdd?"Cancel":"+ Add Item"}
          </button>
        </div>

        {/* Add new item form */}
        {showAdd && (
          <div className="bg-green-50 border-b border-green-200 px-4 py-3 flex-shrink-0">
            <div className="text-xs font-bold text-green-800 mb-2 uppercase tracking-wide">Add New Equipment Item</div>
            <div className="grid grid-cols-6 gap-2 items-end">
              <div className="col-span-2">
                <label className="text-xs text-gray-500 block mb-0.5">Description *</label>
                <input value={newItem.description} onChange={e=>setNewItem(p=>({...p,description:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Type</label>
                <select value={newItem.type} onChange={e=>setNewItem(p=>({...p,type:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-green-400">
                  {["PCE","SCADA","COMMS"].map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Category</label>
                <input value={newItem.category} onChange={e=>setNewItem(p=>({...p,category:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Make / Part No.</label>
                <input value={newItem.make_model} onChange={e=>setNewItem(p=>({...p,make_model:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">WBS Code</label>
                <input value={newItem.wbs_code} onChange={e=>setNewItem(p=>({...p,wbs_code:e.target.value}))}
                  placeholder="e.g. 3.2.1.02.1.05"
                  className="w-full border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-green-400"/>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Contract No.</label>
                <input value={newItem.contract_no} onChange={e=>setNewItem(p=>({...p,contract_no:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Price ($)</label>
                <input type="number" value={newItem.price} onChange={e=>setNewItem(p=>({...p,price:e.target.value}))}
                  placeholder="0 = POA"
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Lead Time (weeks)</label>
                <input type="number" value={newItem.lead_time_weeks} onChange={e=>setNewItem(p=>({...p,lead_time_weeks:e.target.value}))}
                  placeholder=">20 = LLT"
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500 block mb-0.5">Comments</label>
                <input value={newItem.comments} onChange={e=>setNewItem(p=>({...p,comments:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
              </div>
              <div className="flex items-end">
                <button onClick={addNewItem} disabled={!newItem.description.trim()}
                  className="w-full text-xs bg-green-700 hover:bg-green-600 disabled:bg-gray-300 text-white px-3 py-1.5 rounded font-semibold">
                  Add Item
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Catalogue table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b sticky top-0 z-10">
              <tr>
                <th className="text-left px-2 py-2 font-semibold text-gray-500 w-14">Type</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-500 w-32">WBS Code</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-500">Description</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-500 w-24">Category</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-500 w-28">Make / Part</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-500 w-24">Contract</th>
                <th className="text-center px-2 py-2 font-semibold text-red-600 w-16">Lead</th>
                <th className="text-right px-2 py-2 font-semibold text-gray-500 w-24">Price</th>
                <th className="text-center px-2 py-2 font-semibold text-orange-700 w-16">Qty</th>
                <th className="text-center px-2 py-2 font-semibold text-gray-400 w-14">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => {
                const isEd  = editing === item.id;
                const qty   = equipSel[item.id]||"";
                const hasQty = parseFloat(qty) > 0;
                const tc    = TYPE_COLORS[item.type]||{badge:"bg-gray-100 text-gray-500",icon:"•"};
                return (
                  <tr key={item.id}
                    className={`border-b transition-colors ${hasQty?"bg-teal-50 border-l-4 border-l-teal-500":idx%2===0?"bg-white":"bg-gray-50"} hover:bg-teal-50`}>
                    <td className="px-2 py-1.5">
                      <span className={`text-xs px-1 py-0.5 rounded font-medium ${tc.badge}`}>{tc.icon}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      {isEd
                        ? <input value={editVals.wbs_code} onChange={e=>setEditVals(p=>({...p,wbs_code:e.target.value}))}
                            className="w-full border border-blue-300 rounded px-1 py-0.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"/>
                        : <span className="font-mono text-blue-600">{item.wbs_code||<span className="text-orange-400 italic">TBA</span>}</span>
                      }
                    </td>
                    <td className="px-2 py-1.5 text-gray-800 max-w-xs">
                      <div className="truncate font-medium">{item.description}</div>
                      {isEd
                        ? <input value={editVals.comments} onChange={e=>setEditVals(p=>({...p,comments:e.target.value}))}
                            placeholder="Comments…"
                            className="w-full mt-0.5 border border-gray-200 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"/>
                        : item.comments && <div className="text-gray-400 text-xs truncate">{item.comments}</div>
                      }
                    </td>
                    <td className="px-2 py-1.5 text-gray-500 truncate">{item.category}</td>
                    <td className="px-2 py-1.5 text-gray-500 font-mono text-xs truncate">{item.make_model}</td>
                    <td className="px-2 py-1.5">
                      {isEd
                        ? <input value={editVals.contract_no} onChange={e=>setEditVals(p=>({...p,contract_no:e.target.value}))}
                            className="w-full border border-gray-200 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"/>
                        : <span className="text-gray-500 font-mono">{item.contract_no}</span>
                      }
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {isEd
                        ? <input type="number" value={editVals.lead_time_weeks} onChange={e=>setEditVals(p=>({...p,lead_time_weeks:e.target.value}))}
                            className="w-12 border border-gray-200 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-300"/>
                        : item.lead_time_weeks>0 && (
                          <span className={`px-1 py-0.5 rounded text-xs font-medium ${item.is_llt?"bg-red-100 text-red-700":"bg-gray-100 text-gray-500"}`}>
                            {item.lead_time_weeks}w
                          </span>
                        )
                      }
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium text-gray-800">
                      {isEd
                        ? <input type="number" value={editVals.price} onChange={e=>setEditVals(p=>({...p,price:e.target.value}))}
                            className="w-20 border border-green-300 bg-green-50 rounded px-1 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-green-400"/>
                        : item.price>0 ? fmt(item.price) : <span className="text-orange-500">POA</span>
                      }
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex justify-center">
                        <input type="number" min="0" value={qty}
                          onChange={e=>setEquipSel(p=>({...p,[item.id]:e.target.value}))}
                          placeholder="0"
                          className={`w-14 text-center border rounded py-0.5 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-teal-400
                            ${hasQty?"border-teal-400 bg-teal-50 text-teal-800":"border-gray-300 text-gray-500"}`}/>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {isEd
                        ? <div className="flex gap-1 justify-center">
                            <button onClick={()=>saveEdit(item.id)} className="text-xs text-green-600 hover:text-green-800 font-semibold">✓</button>
                            <button onClick={()=>setEditing(null)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                          </div>
                        : <button onClick={()=>startEdit(item)} className="text-xs text-blue-400 hover:text-blue-700">Edit</button>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length===0 && (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">No items match filters</div>
          )}
        </div>
      </div>
    </div>
  );
}

const defaultInv = {
  name:"Marulan 132kV 3-Way Switching Station", number:"10007569",
  wacs:"N/A", type:"Commercially Funded", estClass:"Class 4", revision:"A",
  complexity:"High", newTech:"Moderate", estimatedBy:"Steven Hannigan",
  reviewedBy:"Daniel Lawrence", startMonth:"Jul", startYear:"2025",
  planStart:"1", planDur:"4", designStart:"1", designDur:"9",
  constrStart:"6", constrDur:"15", contInt:"10", contComm:"10",
};

const APP_TABS = [
  {id:"estimation", label:"⚡ Estimation Tool"},
  {id:"wbsmanager", label:"🗂 WBS Manager"},
  {id:"saved",      label:"💾 Saved Investments"},
];
const EST_TABS = [
  {id:"setup",      label:"⚙️ Investment Setup"},
  {id:"estimate",   label:"📐 Estimation"},
  {id:"equipment",  label:"🔧 Equipment"},
  {id:"review",     label:"📋 Review Lines"},
  {id:"summary",    label:"📊 Summary"},
];

export default function App() {
  const [appTab,      setAppTab]      = useState("estimation");
  const [estTab,      setEstTab]      = useState("estimate");
  const [isCommercial,setIsComm]      = useState(false);
  const [inv,         setInv]         = useState(defaultInv);
  const [lines,       setLines]       = useState({});
  const [lastSaved,   setLastSaved]   = useState(null);

  // Live data
  const [wbsData,     setWbsData]     = useState([]);
  const [ratesData,   setRatesData]   = useState([]);
  const [supplyData,  setSupplyData]  = useState([]);
  const [equipData,   setEquipData]   = useState([]);
  const [equipLookup,  setEquipLookup]  = useState({});
  const [commLookup,   setCommLookup]   = useState({}); // comm_wbs -> {hrs_per_unit, description}
  const [equipSel,    setEquipSel]    = useState({});
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);

  useEffect(()=>{
    Promise.all([
      fetch(`${BASE}data/wbs_master.json`).then(r=>{if(!r.ok)throw new Error("wbs_master "+r.status);return r.json();}),
      fetch(`${BASE}data/resource_rates.json`).then(r=>{if(!r.ok)throw new Error("resource_rates "+r.status);return r.json();}),
      fetch(`${BASE}data/supply_items.json`).then(r=>{if(!r.ok)throw new Error("supply_items "+r.status);return r.json();}),
      fetch(`${BASE}data/equipment.json`).then(r=>{if(!r.ok)return {items:[]};return r.json();}).catch(()=>({items:[]})),
      fetch(`${BASE}data/equipment_wbs_lookup.json`).then(r=>{if(!r.ok)return {lookup:{}};return r.json();}).catch(()=>({lookup:{}})),
      fetch(`${BASE}data/commission_lookup.json`).then(r=>{if(!r.ok)return {lookup:{}};return r.json();}).catch(()=>({lookup:{}})),
    ])
    .then(([wbs,rates,supply,equip,lookup,commLookup])=>{
      setWbsData(wbs.records||[]);
      setRatesData(rates.records||[]);
      setSupplyData(supply.items||[]);
      // Normalise equipment items into the shape EquipmentScreen expects
      const normalised = (equip.items||[]).map(e => {
        // Determine type badge: LLT takes priority over PCE
        let type = e.source === 'SCADA' ? 'SCADA'
                 : e.source === 'Comms' ? 'COMMS'
                 : e.is_llt            ? 'LLT'
                 :                       'PCE';
        // make_model: combine make + model for PCE, part_no for others
        const make_model = e.make && e.model ? `${e.make} / ${e.model}`
                         : e.part_no || e.catalogue_id || '';
        return {
          id:          e.id,
          type,
          source:      e.source,
          wbs_code:    e.wbs_code || '',
          description: e.description || e.item || '',
          category:    e.category || e.group || '',
          make_model,
          voltage:     e.family || '',
          contract_no: e.contract_no || '',
          item_no:     e.item_no || e.part_no || '',
          unit:        e.unit || 'EA',
          price:       e.escalated_price > 0 ? e.escalated_price : e.current_price || 0,
          current_price: e.current_price || 0,
          lead_time_weeks: e.lead_time_weeks || 0,
          is_llt:      !!e.is_llt,
          is_poa:      !!e.is_poa,
          comments:    e.comments || '',
        };
      });
      setEquipData(normalised);
      setEquipLookup(lookup.lookup || {});
      setCommLookup(commLookup.lookup || {});
      setLoading(false);
    })
    .catch(err=>{setError(err.message);setLoading(false);});
  },[]);

  const saveInvestment = useCallback(()=>{
    const supply = supplyData;
    const entered = supply.filter(s=>parseFloat(lines[s.wbs_code]?.qty||"0")>0);
    const totals = entered.reduce((a,item)=>{
      const ln=lines[item.wbs_code]||{};
      const c=calcLine(item,ln.qty||"",ln.factor||"1",ln.delivery,ln.instHrsOvrd,ln.contrRate,ln.plant,ln.mats,isCommercial);
      return {eeInt:a.eeInt+c.eeInt,comm:a.comm+c.comm};
    },{eeInt:0,comm:0});

    const record = {
      id: Date.now(),
      savedAt: new Date().toLocaleString("en-AU",{dateStyle:"short",timeStyle:"short"}),
      inv, lines, linesCount:entered.length,
      totalEE:Math.round(totals.eeInt), totalComm:Math.round(totals.comm),
    };
    try {
      const existing = JSON.parse(localStorage.getItem("iet_investments")||"[]");
      const updated = [record, ...existing.filter(s=>s.inv.number!==inv.number||s.inv.revision!==inv.revision)];
      localStorage.setItem("iet_investments", JSON.stringify(updated));
      setLastSaved(record.savedAt);
    } catch(e) { alert("Save failed — localStorage may be full"); }
  },[inv,lines,isCommercial,supplyData]);

  const loadInvestment = useCallback((record)=>{
    setInv(record.inv);
    setLines(record.lines||{});
    setLastSaved(record.savedAt);
    setAppTab("estimation");
    setEstTab("summary");
  },[]);

  const equipSelected = Object.values(equipSel).filter(q=>parseFloat(q)>0).length;
  const linesEntered = Object.values(lines).filter(l=>parseFloat(l.qty)>0).length;

  return (
    <DataCtx.Provider value={{wbs:wbsData,rates:ratesData,supply:supplyData,equipment:equipData,equipLookup,commLookup,loading,error}}>
      <div className="flex flex-col h-screen font-sans text-sm select-none">

        {/* Top nav */}
        <div className="bg-blue-900 text-white px-4 py-0 flex items-center gap-0 flex-shrink-0 shadow-lg">
          <div className="flex items-center gap-2 mr-5 py-3">
            <span className="text-orange-400 text-lg">⚡</span>
            <span className="font-bold text-sm tracking-wide">IET Demo</span>
            <span className="text-blue-500 text-xs">|</span>
            <span className="text-blue-300 text-xs truncate max-w-48">{inv.name}</span>
          </div>
          {APP_TABS.map(tab=>(
            <button key={tab.id} onClick={()=>setAppTab(tab.id)}
              className={`px-5 py-3 text-xs font-semibold transition-colors border-b-2 ${
                appTab===tab.id?"border-orange-400 text-white bg-blue-800":"border-transparent text-blue-300 hover:text-white hover:bg-blue-800"}`}>
              {tab.label}
              {tab.id==="saved"&&<span className="ml-1 text-xs bg-blue-700 text-blue-200 px-1.5 py-0.5 rounded-full font-mono">
                {(()=>{try{return JSON.parse(localStorage.getItem("iet_investments")||"[]").length}catch{return 0}})()}
              </span>}
            </button>
          ))}
          <div className="flex-1"/>
          {loading&&<span className="text-xs text-blue-300 animate-pulse pr-4">⟳ Loading live data…</span>}
          {!loading&&!error&&<span className="text-xs text-green-400 pr-4">✓ {wbsData.length} WBS · {supplyData.length} items · {equipData.length} equipment · {ratesData.length} rates</span>}
          {error&&<span className="text-xs text-red-400 pr-4">⚠ Data error — {error}</span>}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {appTab==="estimation" && (
            <>
              {/* Estimation sub-tabs */}
              <div className="bg-white border-b flex items-end px-4 flex-shrink-0 shadow-sm">
                {EST_TABS.map(tab=>(
                  <button key={tab.id} onClick={()=>setEstTab(tab.id)}
                    className={`relative px-4 py-2.5 text-xs font-semibold transition-colors border-b-2 mr-1 -mb-px ${
                      estTab===tab.id?"border-blue-600 text-blue-700 bg-blue-50":"border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"}`}>
                    {tab.label}
                    {tab.id==="review"&&linesEntered>0&&(
                      <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">{linesEntered}</span>
                    )}
                    {tab.id==="equipment"&&equipSelected>0&&(
                      <span className="absolute -top-1 -right-1 bg-teal-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">{equipSelected}</span>
                    )}
                  </button>
                ))}
                <div className="flex-1"/>
                <div className="flex items-center gap-3 pb-1">
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={isCommercial} onChange={e=>setIsComm(e.target.checked)} className="accent-orange-500"/>
                    <span className={isCommercial?"text-orange-600 font-semibold":"text-gray-500"}>
                      {isCommercial?"Commercial Rates":"EE Internal Rates"}
                    </span>
                  </label>
                  <span className="text-xs text-gray-400">{inv.estimatedBy}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                    inv.type==="Commercially Funded"?"bg-orange-100 text-orange-700":"bg-blue-100 text-blue-700"}`}>
                    {inv.type==="Commercially Funded"?"COMMERCIAL":"INTERNAL"}
                  </span>
                </div>
              </div>

              <div className="flex-1 overflow-hidden flex flex-col">
                {estTab==="setup"     && <InvestmentSetup inv={inv} onChange={setInv}/>}
                {estTab==="estimate"  && (
                  <div className="flex flex-1 overflow-hidden">
                    <EstimationScreen isCommercial={isCommercial} lines={lines} setLines={setLines}/>
                  </div>
                )}
                {estTab==="equipment" && <EquipmentScreen lines={lines} setLines={setLines} isCommercial={isCommercial} inv={inv}/>}
                {estTab==="review"    && <ReviewLines lines={lines} isCommercial={isCommercial}/>}
                {estTab==="summary"   && <SummaryScreen inv={inv} lines={lines} isCommercial={isCommercial} equipSel={equipSel} onSave={saveInvestment} lastSaved={lastSaved}/>}
              </div>
            </>
          )}
          {appTab==="wbsmanager" && <WBSManager equipSel={equipSel} setEquipSel={setEquipSel}/>}
          {appTab==="saved"      && <SavedInvestments onLoad={loadInvestment}/>}
        </div>
      </div>
    </DataCtx.Provider>
  );
}
