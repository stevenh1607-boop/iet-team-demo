import { useState, useMemo, useEffect, useCallback, createContext, useContext, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════
// IET ESTIMATION TOOL — FULL SCALE DEMO
// Live data from GitHub Pages /data/ JSON files
// LocalStorage persistence for investment saves
// ═══════════════════════════════════════════════════════════════════

const BASE = import.meta.env.BASE_URL || "/";

// ── DATA CONTEXT ────────────────────────────────────────────────
const DataCtx = createContext({ wbs:[], rates:[], supply:[], equipment:[], equipLookup:{}, commLookup:{}, commProfiles:{}, escRates:null, resourceCodes:{}, loading:true, error:null });

// ── COPPERLEAF CSV EXPORT ────────────────────────────────────────
// Matches Sync_To_C55 macro structure exactly:
//   - GROUP rows for each L1/L2/L3 WBS level
//   - SPEND rows per labour/contractor resource type (Hours or Dollars)
//   - Materials (Non-LLT): one aggregated Dollar row per L3.
//     SCADA and Comms equipment costs roll into this row — NOT separate named lines.
//   - Materials (LLT): one row per PCE item, Spend Name always "Materials (LLT)",
//     no item description (matches original macro Spend_Template blank LLT rows).
function generateCopperleafCSV(inv, lines, supply, commLookup, commProfiles, escRates, resourceCodes, isCommercial, equipLookup) {
  const isComm = inv.type === "Commercially Funded";

  // ── Project timeline ──────────────────────────────────────────
  const planStart  = parseInt(inv.planStart||1),  planDur   = parseInt(inv.planDur||4);
  const desStart   = parseInt(inv.designStart||1), desDur    = parseInt(inv.designDur||9);
  const conStart   = parseInt(inv.constrStart||6), conDur    = parseInt(inv.constrDur||15);
  const totalMonths = Math.max(planStart+planDur, desStart+desDur, conStart+conDur) - 1;

  // Phase → active months (1-based)
  const phaseMonths = {
    "1": Array.from({length:planDur}, (_,i)=>planStart+i),
    "2": Array.from({length:desDur},  (_,i)=>desStart+i),
    "3": Array.from({length:conDur},  (_,i)=>conStart+i),
    "4": Array.from({length:conDur},  (_,i)=>conStart+i),
    "5": [conStart+conDur-1, conStart+conDur],
  };

  const [startMon, startYr] = [inv.startMonth||"Jul", parseInt(inv.startYear||2025)];
  const MON_IDX = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
  const startMonNum = MON_IDX[startMon] || 7;
  const colDate = (monthNum) => {
    const totalMonOffset = startMonNum - 1 + monthNum - 1;
    const yr = startYr + Math.floor(totalMonOffset / 12);
    const mo = (totalMonOffset % 12) + 1;
    return `${yr}-${String(mo).padStart(2,"0")}-01`;
  };

  // ── Escalation factors ───────────────────────────────────────
  const escFactor = (phaseKey, cat) => {
    if (!escRates) return 0;
    const ratesArr = Object.values(escRates[cat].rates).map(r=>r/100);
    const months = phaseMonths[phaseKey] || [];
    if (!months.length) return 0;
    return months.reduce((s,m) => s + escalationIndex(m, ratesArr), 0) / months.length;
  };

  // ── Resource lookups ────────────────────────────────────────
  const getResCode     = (n) => resourceCodes[n]?.resource_code || "GMAT";
  const getAcctCode    = (n) => { const rc = resourceCodes[n]; if (!rc) return "001001"; return isComm ? rc.account_code_external : rc.account_code_internal; };
  const getCurrencyType = (n) => resourceCodes[n]?.currency_type || "Dollar";

  // ── Equipment source classification ─────────────────────────
  // SCADA / Comms → aggregate into Materials (Non-LLT) row
  // PCE / unknown  → individual Materials (LLT) row, no item name
  const getEquipSource = (wbs_code) => (equipLookup ? equipLookup[wbs_code] : null)?.source || "PCE";

  // ── Group entered lines by L3 ───────────────────────────────
  const entered = supply.filter(s => parseFloat(lines[s.wbs_code]?.qty||"0") > 0);

  const byL3 = {};
  entered.forEach(item => {
    const parts = item.wbs_code.split(".");
    const l1 = parts[0], l2 = parts.slice(0,2).join("."), l3 = parts.slice(0,3).join(".");
    if (!byL3[l3]) byL3[l3] = { l1, l2, l3, phase: l1, items:[] };
    byL3[l3].items.push(item);
  });

  const commByL3 = {};
  entered.forEach(item => {
    const cw = item.commission_wbs;
    if (!cw || !commLookup[cw]) return;
    const qty = parseFloat(lines[item.wbs_code]?.qty||"0") * parseFloat(lines[item.wbs_code]?.factor||"1");
    const l3 = cw.split(".").slice(0,3).join(".");
    if (!commByL3[l3]) commByL3[l3] = {};
    commByL3[l3][cw] = (commByL3[l3][cw]||0) + qty;
  });

  // ── CSV headers — matches Spend_Template columns exactly ────
  const monthCols = Array.from({length:totalMonths}, (_,i) => colDate(i+1));
  const staticHeaders = [
    "Group Path","Group Description","Id","Row Type","Currency / Unit",
    "Spend Name","Currency / Unit Type","Is Unshiftable","Account Code",
    "Resource Code","Labour Type",
    "LLT Description","LLT Item","LLT Quantity","Make / Model","Stock/Contract number","Voltage"
  ];
  const allHeaders = [...staticHeaders, ...monthCols];
  const csvRows = [allHeaders];

  // ── Helper: backslash-delimited group path ───────────────────
  const buildGroupPath = (l1, l2, l3) => `${l1}\\${l2}\\${l3}`;

  const writtenL1 = new Set(), writtenL2 = new Set(), writtenL3 = new Set();

  const writeGroupRow = (code, label) => {
    const row = Array(allHeaders.length).fill("");
    row[0] = label; // Group Path
    row[1] = label; // Group Description
    row[2] = code;  // Id
    row[3] = "Group";
    // row[5] (Spend Name) intentionally blank for GROUP rows — matches Spend_Template
    return row;
  };

  // ── Supply items: Phases 1–3, 5 ─────────────────────────────
  Object.entries(byL3).sort().forEach(([l3, group]) => {
    const { l1, l2, phase, items } = group;
    const phMonths = phaseMonths[phase] || [];
    const acct = isComm ? "001000" : "001001";

    // GROUP rows (L1, L2, L3)
    if (!writtenL1.has(l1)) { writtenL1.add(l1); csvRows.push(writeGroupRow(l1, `${l1} - Phase ${l1}`)); }
    if (!writtenL2.has(l2)) { writtenL2.add(l2); csvRows.push(writeGroupRow(l2, `${l2} - Group`)); }
    if (!writtenL3.has(l3)) { writtenL3.add(l3); csvRows.push(writeGroupRow(l3, `${l3} - Group`)); }

    // Labour / Contractor SPEND rows — one per resource type, aggregated across all items in L3
    const costByResource = {};
    items.forEach(item => {
      const ln = lines[item.wbs_code] || {};
      const c = calcLine(item, ln.qty||"", ln.factor||"1", ln.delivery, ln.instHrsOvrd, ln.contrRate, ln.plant, ln.mats, isCommercial);
      const isContr = (ln.delivery||item.delivery_method||"") === "Contractor Delivered";
      const res = isContr ? "Contractor" : (item.resource_main || "ZS Electrical Technician");
      if (!costByResource[res]) costByResource[res] = {hours:0, dollars:0};
      if (getCurrencyType(res) === "Hour") costByResource[res].hours  += c.installHrs || 0;
      else                                  costByResource[res].dollars += c.contrCost  || 0;
    });

    Object.entries(costByResource).forEach(([resName, costs]) => {
      const currType = getCurrencyType(resName);
      const totalVal = currType === "Hour" ? costs.hours : costs.dollars;
      if (totalVal <= 0) return;
      const ef = escFactor(phase, currType !== "Hour" ? "contractors" : "internal_ee");
      const perMonth = phMonths.length > 0 ? totalVal*(1+ef) / phMonths.length : 0;
      const row = Array(allHeaders.length).fill("");
      row[0]=buildGroupPath(l1,l2,l3); row[1]=`${l3} - Group`; row[2]=l3;
      row[3]="Spend"; row[4]="Unit"; row[5]=resName; row[6]=currType;
      row[7]="0"; row[8]=getAcctCode(resName); row[9]=getResCode(resName);
      row[10]=resourceCodes[resName]?.labour_type||"";
      phMonths.forEach(m=>{ const ci=staticHeaders.length+(m-1); if(ci<row.length) row[ci]=perMonth.toFixed(2); });
      csvRows.push(row);
    });

    // Materials rows — following original macro behaviour:
    //   SCADA + Comms equipment → aggregate into ONE Materials (Non-LLT) Dollar row
    //   PCE items → each gets its own Materials (LLT) row, Spend Name = "Materials (LLT)", no description
    let nonLLTTotal = 0;
    const lltRows = [];

    items.forEach(item => {
      const ln = lines[item.wbs_code] || {};
      const effQty = parseFloat(ln.qty||"0") * parseFloat(ln.factor||"1");
      if (effQty <= 0) return;
      const matPrice = parseFloat(ln.mats||"") || item.pce_price || 0;
      if (matPrice <= 0) return;
      const ef = escFactor(phase, "materials");
      const totalMat = effQty * matPrice * (isCommercial ? 1+ANS_MAT : 1) * (1+ef);
      const source = getEquipSource(item.wbs_code);
      if (source === "SCADA" || source === "Comms") {
        nonLLTTotal += totalMat;
      } else {
        // Store total cost plus equipment metadata for the LLT row
        const eq = equipLookup ? equipLookup[item.wbs_code] : null;
        lltRows.push({
          totalMat,
          desc: (eq?.description || item.description || "").substring(0, 100),
          category: eq?.category || "",
          qty: String(effQty),
          makeModel: [eq?.make, eq?.model].filter(Boolean).join(" "),
          contractNo: eq?.contract_no || "",
          voltage: eq?.voltage || eq?.family || ""
        });
      }
    });

    // Single aggregated Non-LLT row (SCADA + Comms rolled in)
    if (nonLLTTotal > 0) {
      const perMonth = phMonths.length > 0 ? nonLLTTotal / phMonths.length : 0;
      const row = Array(allHeaders.length).fill("");
      row[0]=buildGroupPath(l1,l2,l3); row[1]=`${l3} - Group`; row[2]=l3;
      row[3]="Spend"; row[4]="Unit"; row[5]="Materials (Non-LLT)"; row[6]="Dollar";
      row[7]="0"; row[8]=acct; row[9]="GMAT"; row[10]="";
      phMonths.forEach(m=>{ const ci=staticHeaders.length+(m-1); if(ci<row.length) row[ci]=perMonth.toFixed(2); });
      csvRows.push(row);
    }

    // One Materials (LLT) row per PCE item — Spend Name is "Materials (LLT)", metadata in cols 11-16
    lltRows.forEach(({ totalMat, desc, category, qty, makeModel, contractNo, voltage }) => {
      const perMonth = phMonths.length > 0 ? totalMat / phMonths.length : 0;
      const row = Array(allHeaders.length).fill("");
      row[0]=buildGroupPath(l1,l2,l3); row[1]=`${l3} - Group`; row[2]=l3;
      row[3]="Spend"; row[4]="Unit"; row[5]="Materials (LLT)"; row[6]="Dollar";
      row[7]="0"; row[8]=acct; row[9]="GMAT"; row[10]="";
      row[11]=desc; row[12]=category; row[13]=qty;
      row[14]=makeModel; row[15]=contractNo; row[16]=voltage;
      phMonths.forEach(m=>{ const ci=staticHeaders.length+(m-1); if(ci<row.length) row[ci]=perMonth.toFixed(2); });
      csvRows.push(row);
    });
  });

    // Commission rows (Phase 4)
  Object.entries(commByL3).sort().forEach(([l3, commWbsMap]) => {
    const l1 = "4", l2 = l3.split(".").slice(0,2).join(".");
    const phMonths = phaseMonths["4"] || [];

    if (!writtenL1.has(l1)) { writtenL1.add(l1); csvRows.push(writeGroupRow(l1,"4 - Commissioning",1)); }
    if (!writtenL2.has(l2)) { writtenL2.add(l2); csvRows.push(writeGroupRow(l2,`${l2} - Group`,2)); }
    if (!writtenL3.has(l3)) { writtenL3.add(l3); csvRows.push(writeGroupRow(l3,`${l3} - Group`,3)); }

    let totalHrs = 0;
    let commResName = "ZS Specialist Technician";
    Object.entries(commWbsMap).forEach(([cw, qty]) => {
      const cd = commLookup[cw];
      if (!cd) return;
      const scale  = getScaleFactor(commProfiles, cd.profile_id, qty);
      const ovrd   = lines[`comm_ovrd_${cw}`]?.qty;
      const hrs    = (ovrd !== undefined && ovrd !== "") ? (parseFloat(ovrd)||0) : qty*(cd.hrs_per_unit||0)*scale;
      totalHrs += hrs;
      if (cd.resource_type) commResName = cd.resource_type;
    });

    if (totalHrs <= 0) return;
    const ef = escFactor("4","internal_ee");
    const totalEscalated = totalHrs * (1+ef);
    const perMonth = phMonths.length > 0 ? totalEscalated / phMonths.length : 0;

    const row = Array(allHeaders.length).fill("");
    row[0] = buildGroupPath(l1, l2, l3);
    row[1] = `${l3} - Commissioning`;
    row[2] = l3; row[3] = "Spend"; row[4] = "Unit";
    row[5] = commResName; row[6] = "Hour"; row[7] = "0";
    row[8] = isComm ? "001000" : "001001";
    row[9] = getResCode(commResName);
    row[10] = resourceCodes[commResName]?.labour_type || "";
    phMonths.forEach(m => {
      const colIdx = staticHeaders.length + (m-1);
      if (colIdx < row.length) row[colIdx] = perMonth.toFixed(2);
    });
    csvRows.push(row);
  });

  // ── Convert to CSV string ────────────────────────────────────
  const csvContent = csvRows.map(row =>
    row.map(cell => {
      const s = String(cell ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")
  ).join("\n");

  return csvContent;
}

function downloadCSV(content, filename) {
  const blob = new Blob([content], {type:"text/csv;charset=utf-8;"});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
// Australian FY: July–June. Month 1 = project start = July of start year.
// Compound monthly escalation index per the ABS-based formula.
function escalationIndex(monthNum, annualRatesArr) {
  // annualRatesArr: [r_y1, r_y2, r_y3, r_y4] as decimals (e.g. 0.045)
  let cumulative = 1.0;
  let remaining  = monthNum;
  for (const rate of annualRatesArr) {
    const m = Math.min(remaining, 12);
    cumulative *= Math.pow(1 + rate, m / 12);
    remaining  -= m;
    if (remaining <= 0) break;
  }
  return cumulative - 1;
}

function calcEscalation(costBreakdown, escRates, inv) {
  // costBreakdown: { byPhase: { "1":{eeLabCost,contrCost,matCost}, ... } }
  // escRates: the escalation_rates.json object
  // inv: investment setup with phase timeline
  // Returns { escEE, escContr, escMat, escTotal, factors }
  if (!escRates) return { escEE:0, escContr:0, escMat:0, escTotal:0 };

  const startMonth = parseInt(inv.startMonth_num || 1); // fiscal month offset (always 1 for Jul start)
  const phases = [
    { key:"1", start: 1,                                  dur: parseInt(inv.planDur||4)  },
    { key:"2", start: parseInt(inv.designStart||1),       dur: parseInt(inv.designDur||9) },
    { key:"3", start: parseInt(inv.constrStart||6),       dur: parseInt(inv.constrDur||15) },
    { key:"4", start: parseInt(inv.constrStart||6),       dur: parseInt(inv.constrDur||15) }, // commission aligned to construction
    { key:"5", start: parseInt(inv.constrStart||6) + parseInt(inv.constrDur||15) - 1, dur: 2 },
  ];

  const rEE   = Object.values(escRates.internal_ee.rates).map(r=>r/100);
  const rContr = Object.values(escRates.contractors.rates).map(r=>r/100);
  const rMat  = Object.values(escRates.materials.rates).map(r=>r/100);

  let escEE=0, escContr=0, escMat=0;

  for (const ph of phases) {
    const costs = costBreakdown[ph.key];
    if (!costs || ph.dur <= 0) continue;
    // Average escalation index across the phase months
    let avgEE=0, avgContr=0, avgMat=0;
    for (let m = ph.start; m < ph.start + ph.dur; m++) {
      avgEE    += escalationIndex(m, rEE);
      avgContr += escalationIndex(m, rContr);
      avgMat   += escalationIndex(m, rMat);
    }
    avgEE    /= ph.dur;
    avgContr /= ph.dur;
    avgMat   /= ph.dur;

    escEE    += (costs.eeLabCost    || 0) * avgEE;
    escContr += (costs.contrCost    || 0) * avgContr;
    escMat   += (costs.matCost      || 0) * avgMat;
  }

  const escTotal = escEE + escContr + escMat;
  return { escEE, escContr, escMat, escTotal };
}
function useData() { return useContext(DataCtx); }

// ── HELPERS ─────────────────────────────────────────────────────
const fmt    = n => n === 0 ? "–" : "$" + Math.round(n).toLocaleString("en-AU");
const fmtHrs = n => n === 0 ? "–" : n.toLocaleString("en-AU",{minimumFractionDigits:0,maximumFractionDigits:1}) + " hrs";
const fmtPct = n => (n*100).toFixed(1) + "%";

// Scale factor lookup — inclusive tier ranges
function getScaleFactor(profiles, profileId, qty) {
  if (!profileId || !profiles[profileId]) return 1.00;
  const tiers = profiles[profileId].tiers;
  for (const tier of tiers) {
    if (qty >= tier.qty_from && (tier.qty_to === null || qty <= tier.qty_to))
      return tier.scale;
  }
  return 1.00;
}

// ANS margins
const ANS_LAB  = 0.20;
const ANS_MAT  = 0.2686;
const ANS_CON  = 0.20;

const RESOURCE_TYPES = [
  "ZS Electrical Technician","ZS Specialist Technician","Metering Technician - Zone Substation",
  "Electrical Worker - Transmission","Electrical Worker - Underground",
  "Cable Jointer - Distribution","Cable Jointer - Transmission",
  "Protection Engineer","Earthing Engineer","Engineer / Technical",
  "Substation Designer","Distribution Designer","Subtransmission Mains Designer",
  "SCADA Designer","Telecoms Designer","Telecomms Technician",
  "Project Manager","External Project Manager / Specialist Engineer",
  "Network Planner","Network Development Officer","Land & Routes Specialist",
  "Consultant","Contractor","Contractor - Civil","Contractor - Electrical",
  "Supplier","Work Away From Home","N.A.",
];
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

  // Supply counts per L4 — must be computed BEFORE tree so tree can filter by it
  const supplyCount = useMemo(()=>{
    const m={};
    supply.forEach(s=>{ m[s.l4_group]=(m[s.l4_group]||0)+1; });
    return m;
  },[supply]);

  // Build tree structure from wbs records — only include L4 nodes with supply items
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
    // Add L4 — only include nodes that have supply items
    wbs.filter(r=>r.depth===4).forEach(r=>{
      const l3key = r.wbs_code.split(".").slice(0,3).join(".");
      const hasItems = (supplyCount[r.wbs_code] || 0) > 0;
      if (!hasItems) return;
      phases.forEach(p=>p.children.forEach(l2=>l2.children.forEach(l3=>{
        if(l3.code===l3key) l3.children.push({code:r.wbs_code,label:r.description,children:null});
      })));
    });
    // Prune L3 nodes with no L4 children, then L2 nodes with no L3 children
    phases.forEach(p=>p.children.forEach(l2=>{
      l2.children = l2.children.filter(l3=>l3.children===null || l3.children.length>0);
    }));
    phases.forEach(p=>{
      p.children = p.children.filter(l2=>l2.children.length>0);
    });
    return phases;
  }, [wbs, supplyCount]);

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
    {id:4,label:"4 · Commissioning ⚡"},
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
  const { wbs, supply, rates, loading, commLookup, commProfiles } = useData();
  const [activePhase, setActivePhase]   = useState(3);
  const [selectedL4, setSelectedL4]     = useState("3.1.3.04");
  const [selectedCommGroup, setSelectedCommGroup] = useState(null);
  const [expandedRows, setExpandedRows] = useState({});
  // Resource code overrides — keyed by install_wbs/commission_wbs so changes
  // propagate to ALL supply items sharing that linked WBS code
  const [resourceOvrd, setResourceOvrdState] = useState({}); // {wbs: {install?, comm?}}
  const setResourceOvrd = (wbs, role, val) => {
    if (!wbs) return;
    setResourceOvrdState(p=>({...p,[wbs]:{...p[wbs],[role]:val}}));
  };
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

  const linesEntered = Object.values(lines).filter(l=>parseFloat(l.qty)>0 && !l._commOvrd).length;

  // ── PHASE 4 COMMISSIONING — derived from supply links ──────────
  const commTotals = useMemo(()=>{
    const m = {};
    supply.forEach(item => {
      const commWbs = item.commission_wbs;
      if (!commWbs || !commLookup[commWbs]) return;
      const qty    = parseFloat(lines[item.wbs_code]?.qty || "0");
      const factor = parseFloat(lines[item.wbs_code]?.factor || "1");
      if (!m[commWbs]) m[commWbs] = { qty:0, ...commLookup[commWbs] };
      m[commWbs].qty += qty * factor;
    });
    return m;
  },[supply, lines, commLookup]);

  const commGroups = useMemo(()=>{
    const g = {};
    Object.entries(commTotals).forEach(([commWbs, data])=>{
      if (data.qty <= 0) return;
      const l4 = commWbs.split('.').slice(0,4).join('.');
      if (!g[l4]) g[l4] = { items:[], totalHrs:0, totalCost:0 };
      const scale     = getScaleFactor(commProfiles, data.profile_id, data.qty);
      const baseHrs   = data.qty * (data.hrs_per_unit || 0);
      const ovrdKey   = `comm_ovrd_${commWbs}`;
      const ovrd      = lines[ovrdKey]?.qty;
      const scaledHrs = (ovrd !== undefined && ovrd !== "") ? (parseFloat(ovrd)||0) : baseHrs * scale;
      const rate      = data.ee_labour_rate || 139.26;
      g[l4].items.push({ commWbs, ...data, scale, baseHrs, scaledHrs, rate, isOverridden: ovrd !== undefined && ovrd !== "" });
      g[l4].totalHrs  += scaledHrs;
      g[l4].totalCost += scaledHrs * rate;
    });
    return g;
  },[commTotals, commProfiles, lines]);

  const commGrandHrs  = Object.values(commGroups).reduce((a,g)=>a+g.totalHrs, 0);
  const commGrandCost = Object.values(commGroups).reduce((a,g)=>a+g.totalCost, 0);

  // ALL 144 commission rows — always visible even when qty=0
  const commAllGroups = useMemo(()=>{
    const g = {};
    Object.entries(commLookup).forEach(([commWbs, data])=>{
      const l4 = commWbs.split('.').slice(0,4).join('.');
      if (!g[l4]) g[l4] = { label: data.description?.split(' - ')[0] || l4, items:[], totalHrs:0, totalCost:0 };
      const derivedQty = commTotals[commWbs]?.qty || 0;
      const scale      = getScaleFactor(commProfiles, data.profile_id, derivedQty);
      const baseHrs    = derivedQty * (data.hrs_per_unit || 0);
      const ovrdKey    = `comm_ovrd_${commWbs}`;
      const ovrd       = lines[ovrdKey]?.qty;
      const scaledHrs  = (ovrd !== undefined && ovrd !== "") ? (parseFloat(ovrd)||0) : baseHrs * scale;
      const rate       = data.ee_labour_rate || 139.26;
      const item       = { wbs:commWbs, ...data, derivedQty, scale, baseHrs, scaledHrs, rate, isOverridden: ovrd !== undefined && ovrd !== "" };
      g[l4].items.push(item);
      if (derivedQty > 0) {
        g[l4].totalHrs  += scaledHrs;
        g[l4].totalCost += scaledHrs * rate;
      }
    });
    return g;
  },[commLookup, commTotals, commProfiles, lines]);

  useEffect(()=>{
    if (activePhase === 4) {
      const keys = Object.keys(commGroups).sort();
      if (keys.length > 0 && (!selectedCommGroup || !commGroups[selectedCommGroup]))
        setSelectedCommGroup(keys[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[activePhase, commGroups]);

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

      {/* CENTRE + RIGHT — Phase 4 shows ALL commissioning rows; Phases 1-3/5 show supply items */}
      {activePhase === 4 ? (
        <>
          {/* COMMISSIONING — all 144 rows always visible, live-updating */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <div className="bg-teal-800 text-white px-4 py-2 flex items-center justify-between flex-shrink-0">
              <div>
                <div className="font-bold text-sm">Phase 4 — Commissioning</div>
                <div className="text-xs opacity-75">All items shown · Qty auto-derived from supply · Scale factor applied · Override hrs if needed</div>
              </div>
              <div className="text-right text-xs">
                <div className="font-bold">{fmtHrs(commGrandHrs)} total hrs</div>
                <div className="font-bold">{fmt(commGrandCost)} EE internal</div>
                {isCommercial && <div className="font-bold text-orange-300">{fmt(commGrandCost*(1+ANS_LAB))} comm</div>}
              </div>
            </div>
            <div className="bg-gray-50 border-b grid flex-shrink-0 text-xs font-semibold text-gray-500 px-3 py-1.5"
              style={{gridTemplateColumns:"1fr 52px 64px 52px 76px 76px 86px 64px"}}>
              <div>Description / WBS</div>
              <div className="text-center">Hrs/Unit</div>
              <div className="text-center text-orange-700">Derived Qty</div>
              <div className="text-center text-blue-700">Scale</div>
              <div className="text-center text-teal-700">Scaled Hrs</div>
              <div className="text-center text-orange-500">Override</div>
              <div className="text-right text-blue-800">EE Cost</div>
              <div className="text-center">Profile</div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {Object.entries(commAllGroups).sort().map(([l4, group]) => {
                const hasActive = group.items.some(i => i.derivedQty > 0);
                return (
                  <div key={l4}>
                    <div className={`px-3 py-1 flex items-center gap-2 border-b-2 border-gray-300 text-xs font-bold uppercase tracking-wide cursor-pointer
                      ${hasActive ? "bg-teal-700 text-white" : "bg-gray-100 text-gray-500"}`}
                      onClick={()=>setSelectedCommGroup(l4===selectedCommGroup?null:l4)}>
                      <span className="font-mono font-normal opacity-70">{l4}</span>
                      <span className="flex-1 truncate">{group.label}</span>
                      {hasActive && <span className="font-mono font-bold">{fmtHrs(group.totalHrs)}</span>}
                    </div>
                    {group.items.map(item => {
                      const ovrdKey = `comm_ovrd_${item.wbs}`;
                      const ovrd    = lines[ovrdKey]?.qty ?? "";
                      const setOvrd = val => setLines(p=>({...p,[ovrdKey]:{qty:val,_commOvrd:true}}));
                      const isOvrd  = ovrd !== "" && ovrd !== undefined;
                      const effectiveHrs = isOvrd ? (parseFloat(ovrd)||0) : item.scaledHrs;
                      const cost    = effectiveHrs * (item.ee_labour_rate||139.26);
                      const hasQty  = item.derivedQty > 0;
                      return (
                        <div key={item.wbs}
                          className={`grid items-center px-3 py-1.5 border-b text-xs
                            ${hasQty?"bg-teal-50":"bg-white hover:bg-gray-50"}
                            ${isOvrd?"border-l-4 border-l-orange-400":""}`}
                          style={{gridTemplateColumns:"1fr 52px 64px 52px 76px 76px 86px 64px"}}>
                          <div className="min-w-0 pr-1">
                            <div className={`truncate font-medium ${hasQty?"text-teal-900":"text-gray-500"}`}>{item.description}</div>
                            <div className="font-mono text-gray-400 text-xs">{item.wbs}{isOvrd&&<span className="ml-1 text-orange-500">⚡ override</span>}</div>
                          </div>
                          <div className="text-center text-gray-500">{item.hrs_per_unit||0}</div>
                          <div className={`text-center font-bold ${hasQty?"text-orange-700":"text-gray-300"}`}>
                            {hasQty ? item.derivedQty.toLocaleString('en-AU',{maximumFractionDigits:1}) : "—"}
                          </div>
                          <div className={`text-center font-bold ${hasQty&&item.scale<1?"text-blue-700":hasQty?"text-gray-400":"text-gray-200"}`}>
                            {fmtPct(item.scale)}
                          </div>
                          <div className={`text-center font-bold ${hasQty?"text-teal-700":"text-gray-300"}`}>
                            {hasQty ? fmtHrs(item.scaledHrs) : "—"}
                          </div>
                          <div className="flex justify-center">
                            <input type="number" min="0" step="0.5" value={ovrd}
                              onChange={e=>setOvrd(e.target.value)}
                              placeholder={hasQty?item.scaledHrs.toFixed(1):""}
                              className={`w-16 text-center border rounded py-0.5 text-xs font-bold focus:outline-none focus:ring-1
                                ${isOvrd?"border-orange-400 bg-orange-50 text-orange-800":"border-gray-200 text-gray-400"}`}/>
                          </div>
                          <div className={`text-right font-bold ${hasQty?"text-blue-800":"text-gray-300"}`}>
                            {hasQty ? fmt(cost) : "—"}
                          </div>
                          <div className="text-center">
                            {item.profile_id ? (
                              <span className={`text-xs px-1 py-0.5 rounded font-medium ${
                                item.profile_status==="Confirmed"?"bg-green-100 text-green-700":
                                "bg-yellow-100 text-yellow-700"}`}>
                                {item.profile_id==="HV_PLANT_OUTDOOR"?"HV-O":
                                 item.profile_id==="HV_PLANT_INSTRUMENT"?"HV-I":
                                 item.profile_id==="PROTECTION_STANDARD"?"PROT":
                                 item.profile_id==="SCADA_RTC"?"SCADA":
                                 item.profile_id==="COMMS_STANDARD"?"COMMS":"—"}
                              </span>
                            ) : <span className="text-gray-300">—</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          {/* RIGHT — commissioning summary */}
          <div className="w-52 bg-white border-l flex flex-col overflow-hidden flex-shrink-0">
            <div className="bg-teal-800 text-white text-xs font-bold px-3 py-2 uppercase tracking-wide">Commissioning Totals</div>
            <div className="flex-1 overflow-y-auto">
              {Object.entries(commAllGroups).filter(([,g])=>g.totalHrs>0).sort().map(([l4,g])=>(
                <div key={l4} className="px-3 py-1.5 border-b text-xs">
                  <div className="font-mono text-gray-400">{l4}</div>
                  <div className="flex justify-between">
                    <span className="text-teal-700 font-bold">{fmtHrs(g.totalHrs)}</span>
                    <span className="text-blue-800 font-bold">{fmt(g.totalCost)}</span>
                  </div>
                </div>
              ))}
              {Object.values(commAllGroups).every(g=>g.totalHrs===0) && (
                <div className="p-3 text-xs text-gray-400 text-center">Enter supply quantities to see costs</div>
              )}
            </div>
            <div className="border-t px-3 py-2 space-y-1">
              <div className="flex justify-between text-xs font-bold text-teal-700 border-b pb-1 mb-1">
                <span>Total Comm Hrs</span><span>{fmtHrs(commGrandHrs)}</span>
              </div>
              <div className="py-1.5 px-2 bg-blue-800 rounded text-white flex justify-between mb-1">
                <span className="text-xs font-semibold">EE Internal</span>
                <span className="text-xs font-bold">{fmt(commGrandCost)}</span>
              </div>
              {isCommercial && <div className="py-1.5 px-2 bg-orange-600 rounded text-white flex justify-between">
                <span className="text-xs font-semibold">Commercial</span>
                <span className="text-xs font-bold">{fmt(commGrandCost*(1+ANS_LAB))}</span>
              </div>}
            </div>
          </div>
        </>
      ) : (
        <>
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
                        <span className="text-xs text-blue-500 bg-blue-50 border border-blue-200 rounded px-1">Install: {resourceOvrd[item.install_wbs]?.install || item.resource_install}</span>}
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
                      <span className="flex items-center gap-2">
                        Cost Detail — {item.description?.split(" - ")[0]}
                        {item.comments && (
                          <span className="relative group">
                            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-400 text-white text-xs cursor-help hover:bg-white hover:text-blue-700 font-bold">i</span>
                            <span className="invisible group-hover:visible absolute left-0 top-6 z-50 w-80 bg-gray-900 text-white text-xs font-normal rounded-lg shadow-xl p-3 leading-relaxed">
                              <span className="block font-bold text-blue-300 mb-1">Database & Scope Notes</span>
                              {item.comments}
                            </span>
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-blue-200 font-normal">
                          {isContr
                            ? `Contractor · Install: ${item.resource_install||item.resource_main||"—"} · Comm: ${item.resource_comm||"—"}`
                            : `${item.resource_main||"EE"} · Install: ${item.resource_install||item.resource_main||"—"} · Comm: ${item.resource_comm||"—"}`
                          }
                          {" · "}Std: {item.install_hrs_per}h install · {item.comm_hrs_per}h comm · {fmt(item.ee_labour_rate)}/hr
                        </span>
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
                          <label className="text-xs text-gray-500 block mb-0.5">Install Resource Code</label>
                          <select
                            value={(resourceOvrd[item.install_wbs]?.install) || item.resource_install || "ZS Electrical Technician"}
                            onChange={e=>setResourceOvrd(item.install_wbs, "install", e.target.value)}
                            disabled={!item.install_wbs}
                            className="text-xs border border-indigo-300 bg-indigo-50 rounded px-1.5 py-1 bg-white w-full focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:bg-gray-100 disabled:text-gray-400">
                            {RESOURCE_TYPES.map(r=><option key={r}>{r}</option>)}
                          </select>
                          {item.install_wbs && <div className="text-xs text-indigo-400 mt-0.5">↳ {item.install_wbs}</div>}
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-0.5">Commission Resource Code</label>
                          <select
                            value={(resourceOvrd[item.commission_wbs]?.comm) || item.resource_comm || "ZS Specialist Technician"}
                            onChange={e=>setResourceOvrd(item.commission_wbs, "comm", e.target.value)}
                            disabled={!item.commission_wbs}
                            className="text-xs border border-teal-300 bg-teal-50 rounded px-1.5 py-1 bg-white w-full focus:outline-none focus:ring-1 focus:ring-teal-400 disabled:bg-gray-100 disabled:text-gray-400">
                            {RESOURCE_TYPES.map(r=><option key={r}>{r}</option>)}
                          </select>
                          {item.commission_wbs && <div className="text-xs text-teal-500 mt-0.5">↳ {item.commission_wbs}</div>}
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
        </>
      )}
    </div>
  );
}
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
        <div className={`bg-white rounded-lg border border-gray-200 shadow-sm p-4 grid gap-4 ${isCommercial?"grid-cols-4":"grid-cols-3"}`}>
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
          {isCommercial && (
          <div className="text-center">
            <div className="text-2xl font-bold text-orange-700">{fmt(totals.comm)}</div>
            <div className="text-xs text-gray-500">Commercial Total</div>
          </div>
          )}
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
                  {isCommercial && <th className="text-right px-3 py-2 font-semibold text-orange-700">Commercial</th>}
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
                      {isCommercial && <td className="px-3 py-2 text-right font-bold text-orange-700">{fmt(c.comm)}</td>}
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
  const { supply, wbs: wbsMaster, commLookup, commProfiles, escRates, resourceCodes, equipLookup } = useData();
  const entered = supply.filter(s=>parseFloat(lines[s.wbs_code]?.qty||"0")>0);
  const [openNodes, setOpenNodes] = useState({}); // {wbs_code: bool}

  const toggleNode = (code) => setOpenNodes(p=>({...p,[code]:!p[code]}));

  // Phase 1-3, 5 rollups
  const phaseNames = {"1":"Planning","2":"Design","3":"Construction","4":"Commissioning","5":"M&C"};
  const byPhase = {};
  entered.forEach(item=>{
    const ph=item.wbs_code.split(".")[0];
    if(ph==="4") return;
    if(!byPhase[ph]) byPhase[ph]={eeInt:0,comm:0,installHrs:0,commHrs:0,lines:0,eeLabCost:0,contrCost:0,matCost:0};
    const ln=lines[item.wbs_code]||{};
    const c=calcLine(item,ln.qty||"",ln.factor||"1",ln.delivery,ln.instHrsOvrd,ln.contrRate,ln.plant,ln.mats,isCommercial);
    byPhase[ph].eeInt+=c.eeInt; byPhase[ph].comm+=c.comm;
    byPhase[ph].installHrs+=c.installHrs; byPhase[ph].commHrs+=c.commHrs;
    byPhase[ph].lines++;
    byPhase[ph].eeLabCost  += c.eeLabCost  || 0;
    byPhase[ph].contrCost  += c.contrCost  || 0;
    byPhase[ph].matCost    += c.equipCost  || 0; // PCE/materials
  });

  // Phase 4 derived
  const commTotals = {};
  entered.forEach(item=>{
    if(!item.commission_wbs||!commLookup[item.commission_wbs]) return;
    const qty=parseFloat(lines[item.wbs_code]?.qty||"0");
    const factor=parseFloat(lines[item.wbs_code]?.factor||"1");
    const cw=item.commission_wbs;
    if(!commTotals[cw]) commTotals[cw]={qty:0,...commLookup[cw]};
    commTotals[cw].qty+=qty*factor;
  });
  const eeRate=139.26;
  const phase4=Object.entries(commTotals).reduce((a,[wbs,ct])=>{
    if(ct.qty<=0) return a;
    const scale=getScaleFactor(commProfiles,ct.profile_id,ct.qty);
    const baseHrs=ct.qty*(ct.hrs_per_unit||0);
    const ovrd=lines[`comm_ovrd_${wbs}`]?.qty;
    const hrs=ovrd!==undefined&&ovrd!==""?(parseFloat(ovrd)||0):baseHrs*scale;
    const rate=ct.ee_labour_rate||eeRate;
    const cost=hrs*rate;
    return {commHrs:a.commHrs+hrs,eeInt:a.eeInt+cost,comm:a.comm+cost*(1+ANS_LAB),lines:a.lines+1};
  },{commHrs:0,eeInt:0,comm:0,lines:0});
  if(phase4.commHrs>0) byPhase["4"]={...phase4,installHrs:0,eeLabCost:phase4.eeInt,contrCost:0,matCost:0};

  const grandEE   = Object.values(byPhase).reduce((a,p)=>a+p.eeInt,0);
  const grandComm = Object.values(byPhase).reduce((a,p)=>a+p.comm,0);
  const contPct   = parseFloat(isCommercial?inv.contComm:inv.contInt)||10;
  const contAmt   = (isCommercial?grandComm:grandEE)*contPct/100;
  const totalWithCont = (isCommercial?grandComm:grandEE)+contAmt;

  // ── ESCALATION ──────────────────────────────────────────────────
  // Calculate weighted escalation per phase using project timeline
  const escResult = useMemo(()=>{
    if (!escRates) return { escEE:0, escContr:0, escMat:0, escTotal:0, escComm:0, byCategory:{} };
    const rEE    = Object.values(escRates.internal_ee.rates).map(r=>r/100);
    const rContr = Object.values(escRates.contractors.rates).map(r=>r/100);
    const rMat   = Object.values(escRates.materials.rates).map(r=>r/100);

    const phaseDefs = {
      "1": { start:1,                                    dur:parseInt(inv.planDur||4)   },
      "2": { start:parseInt(inv.designStart||1),         dur:parseInt(inv.designDur||9) },
      "3": { start:parseInt(inv.constrStart||6),         dur:parseInt(inv.constrDur||15)},
      "4": { start:parseInt(inv.constrStart||6),         dur:parseInt(inv.constrDur||15)},
      "5": { start:parseInt(inv.constrStart||6)+parseInt(inv.constrDur||15)-1, dur:2   },
    };

    let escEE=0, escContr=0, escMat=0;
    Object.entries(byPhase).forEach(([ph, costs])=>{
      const pd = phaseDefs[ph];
      if (!pd || pd.dur <= 0) return;
      let avgEE=0, avgContr=0, avgMat=0;
      for (let m=pd.start; m<pd.start+pd.dur; m++) {
        avgEE    += escalationIndex(m, rEE);
        avgContr += escalationIndex(m, rContr);
        avgMat   += escalationIndex(m, rMat);
      }
      avgEE    /= pd.dur;
      avgContr /= pd.dur;
      avgMat   /= pd.dur;
      escEE    += (costs.eeLabCost||0) * avgEE;
      escContr += (costs.contrCost||0) * avgContr;
      escMat   += (costs.matCost||0)   * avgMat;
    });

    const escTotal = escEE + escContr + escMat;
    const escComm  = escTotal * (1 + ANS_LAB); // ANS uplift on escalation for commercial
    return {
      escEE, escContr, escMat, escTotal,
      escComm: isCommercial ? escComm : escTotal,
      byCategory: {
        "EE Labour":   { val: escEE,    pct: grandEE>0   ? escEE/grandEE*100   : 0 },
        "Contractors": { val: escContr, pct: grandEE>0   ? escContr/grandEE*100 : 0 },
        "Materials":   { val: escMat,   pct: grandEE>0   ? escMat/grandEE*100   : 0 },
      }
    };
  },[escRates, byPhase, inv, isCommercial]);

  const finalTotal = (isCommercial ? grandComm : grandEE) + contAmt + (isCommercial ? escResult.escComm : escResult.escTotal);

  // Build WBS tree down to L5 for each entered supply item + Phase 4 commission
  const nodeRollup = useMemo(()=>{
    const m = {};
    const accum = (code, vals) => {
      const parts = code.split('.');
      for (let d=1; d<=parts.length; d++) {
        const ancestor = parts.slice(0,d).join('.');
        if (!m[ancestor]) m[ancestor]={eeInt:0,comm:0,installHrs:0,commHrs:0,lines:0};
        m[ancestor].eeInt      += vals.eeInt;
        m[ancestor].comm       += vals.comm;
        m[ancestor].installHrs += vals.installHrs;
        m[ancestor].commHrs    += vals.commHrs;
        m[ancestor].lines      += 1;
      }
    };
    entered.forEach(item=>{
      const ln=lines[item.wbs_code]||{};
      const c=calcLine(item,ln.qty||"",ln.factor||"1",ln.delivery,ln.instHrsOvrd,ln.contrRate,ln.plant,ln.mats,isCommercial);
      accum(item.wbs_code, c);
    });
    // Phase 4 commission nodes — derived from commission links with scaling
    Object.entries(commTotals).forEach(([commWbs, ct])=>{
      if (ct.qty <= 0) return;
      const scale   = getScaleFactor(commProfiles, ct.profile_id, ct.qty);
      const baseHrs = ct.qty * (ct.hrs_per_unit||0);
      const ovrd    = lines[`comm_ovrd_${commWbs}`]?.qty;
      const hrs     = (ovrd!==undefined&&ovrd!=="")?(parseFloat(ovrd)||0):baseHrs*scale;
      const rate    = ct.ee_labour_rate || 139.26;
      const cost    = hrs * rate;
      accum(commWbs, { eeInt:cost, comm:cost*(1+ANS_LAB), installHrs:0, commHrs:hrs });
    });
    return m;
  },[entered, lines, isCommercial, commTotals, commProfiles]);

  // WBS description lookup (supply WBS + commission WBS)
  const descMap = useMemo(()=>{
    const m={};
    wbsMaster.forEach(r=>{ m[r.wbs_code]=r.description; });
    Object.entries(commLookup).forEach(([wbs,d])=>{ if(!m[wbs]) m[wbs]=d.description; });
    return m;
  },[wbsMaster, commLookup]);

  // Tree node renderer — L1 to L5 (L6 is item level, shown inline)
  const renderWBSNode = (code, depth=1) => {
    const roll = nodeRollup[code];
    if (!roll || roll.lines===0) return null;
    const desc  = descMap[code] || code;
    const isOpen = !!openNodes[code];
    const isLeaf = depth >= 5;

    // Find children at next depth
    const childCodes = depth < 5 ? Object.keys(nodeRollup).filter(k => {
      const parts = k.split('.');
      return parts.length === depth+1 && k.startsWith(code+'.');
    }).sort() : [];

    const indent = depth * 16;
    const bgColors = ["","bg-blue-50","bg-indigo-50","bg-gray-50","bg-white","bg-white"];
    const textColors = ["","text-blue-900","text-indigo-800","text-gray-800","text-gray-700","text-gray-600"];
    const fontWeights = ["","font-bold","font-bold","font-semibold","font-medium","font-normal"];

    return (
      <div key={code}>
        <div
          onClick={()=>!isLeaf && childCodes.length>0 && toggleNode(code)}
          className={`grid items-center border-b text-xs cursor-pointer hover:bg-yellow-50 ${bgColors[depth]||"bg-white"}
            ${depth<=2?"border-b-gray-300 border-b-2":"border-b-gray-100"}`}
          style={{gridTemplateColumns: isCommercial?"1fr 80px 80px 90px 90px":"1fr 80px 80px 90px",paddingLeft:`${indent}px`}}>
          <div className={`py-1.5 pr-2 flex items-center gap-1 ${textColors[depth]||"text-gray-600"}`}>
            {!isLeaf && childCodes.length>0 && (
              <span className="text-gray-400 w-3 flex-shrink-0">{isOpen?"▾":"▸"}</span>
            )}
            {(isLeaf || childCodes.length===0) && <span className="w-3 flex-shrink-0"/>}
            <span className="font-mono text-gray-400 text-xs flex-shrink-0">{code}</span>
            <span className={`truncate ${fontWeights[depth]||""}`}>{desc}</span>
          </div>
          <div className={`py-1.5 text-center text-purple-700 ${depth<=2?"font-bold":"font-medium"}`}>{roll.installHrs>0?fmtHrs(roll.installHrs):"—"}</div>
          <div className={`py-1.5 text-center text-teal-700 ${depth<=2?"font-bold":"font-medium"}`}>{roll.commHrs>0?fmtHrs(roll.commHrs):"—"}</div>
          <div className={`py-1.5 text-right pr-2 text-blue-800 ${depth<=2?"font-bold":"font-medium"}`}>{fmt(roll.eeInt)}</div>
          {isCommercial && <div className={`py-1.5 text-right pr-2 text-orange-700 ${depth<=2?"font-bold":"font-medium"}`}>{fmt(roll.comm)}</div>}
        </div>
        {isOpen && !isLeaf && childCodes.map(child=>renderWBSNode(child, depth+1))}
      </div>
    );
  };

  // Phase-level entries (L1) with their children
  const phaseNodes = useMemo(()=>{
    return Object.keys(nodeRollup).filter(k=>k.split('.').length===1).sort();
  },[nodeRollup]);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
      <div className="max-w-6xl mx-auto space-y-4">

        {/* Investment header */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-lg font-bold text-gray-900">{inv.name||"Unnamed Investment"}</div>
              <div className="text-xs text-gray-400 mt-0.5">{inv.number} · {inv.estClass} · Rev {inv.revision} · {inv.type}</div>
            </div>
            <div className="flex items-center gap-3">
              {lastSaved && <span className="text-xs text-green-600">✓ Saved {lastSaved}</span>}
              <button onClick={onSave} className="bg-green-700 hover:bg-green-600 text-white text-xs px-4 py-2 rounded font-semibold shadow">💾 Save Investment</button>
              <button onClick={()=>{
                const csv = generateCopperleafCSV(inv, lines, supply, commLookup, commProfiles, escRates, resourceCodes, isCommercial, equipLookup);
                const suffix = isCommercial ? "ANS_RATES" : "EE_RATES";
                const filename = `${inv.number||"IET"}_${suffix}_Copperleaf.csv`;
                downloadCSV(csv, filename);
              }} className="bg-teal-700 hover:bg-teal-600 text-white text-xs px-4 py-2 rounded font-semibold shadow">
                ☁️ Export Copperleaf CSV
              </button>
            </div>
          </div>
        </div>

        {/* Phase summary cards */}
        <div className="grid grid-cols-5 gap-2">
          {Object.entries(byPhase).map(([ph,p])=>(
            <div key={ph} className="bg-white rounded-lg border border-gray-200 p-3 text-center shadow-sm">
              <div className="text-xs font-bold text-gray-500 mb-1">Phase {ph} — {phaseNames[ph]||ph}</div>
              {ph==="4" && <div className="text-xs text-teal-600 mb-1">auto-derived</div>}
              <div className="text-sm font-bold text-blue-800">{fmt(p.eeInt)}</div>
              {isCommercial && <div className="text-xs font-bold text-orange-700">{fmt(p.comm)}</div>}
              <div className="text-xs text-purple-600 mt-1">{fmtHrs(p.installHrs+p.commHrs)}</div>
            </div>
          ))}
          {Object.keys(byPhase).length===0 && (
            <div className="col-span-5 bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-400">No lines entered yet</div>
          )}
        </div>

        {/* WBS Cost Tree — default all closed, expandable to L5 */}
        {phaseNodes.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-blue-800 text-white">
              <div className="font-bold text-sm">WBS Cost Breakdown</div>
              <div className="flex items-center gap-2">
                <button onClick={()=>setOpenNodes({})} className="text-xs bg-blue-700 hover:bg-blue-600 px-2 py-1 rounded">Collapse All</button>
                <button onClick={()=>{
                  const all={};
                  Object.keys(nodeRollup).filter(k=>k.split('.').length<5).forEach(k=>{all[k]=true;});
                  setOpenNodes(all);
                }} className="text-xs bg-blue-700 hover:bg-blue-600 px-2 py-1 rounded">Expand All</button>
              </div>
            </div>
            {/* Column headers */}
            <div className="grid border-b bg-gray-50 text-xs font-semibold text-gray-500"
              style={{gridTemplateColumns: isCommercial?"1fr 80px 80px 90px 90px":"1fr 80px 80px 90px"}}>
              <div className="px-3 py-2">WBS / Description</div>
              <div className="py-2 text-center text-purple-600">Install Hrs</div>
              <div className="py-2 text-center text-teal-600">Comm Hrs</div>
              <div className="py-2 text-right pr-2 text-blue-700">EE Internal</div>
              {isCommercial && <div className="py-2 text-right pr-2 text-orange-700">Commercial</div>}
            </div>
            {/* Phase nodes — all closed by default */}
            {phaseNodes.map(ph => renderWBSNode(ph, 1))}
            {/* Grand total footer */}
            <div className="grid border-t-2 border-gray-300 bg-gray-50 text-xs font-bold"
              style={{gridTemplateColumns: isCommercial?"1fr 80px 80px 90px 90px":"1fr 80px 80px 90px"}}>
              <div className="px-3 py-2 text-gray-700">Total (excl. contingency)</div>
              <div className="py-2 text-center text-purple-700">{Object.entries(nodeRollup).filter(([k])=>k.split('.').length===1).reduce((a,[,v])=>a+v.installHrs,0)>0?fmtHrs(Object.entries(nodeRollup).filter(([k])=>k.split('.').length===1).reduce((a,[,v])=>a+v.installHrs,0)):"—"}</div>
              <div className="py-2 text-center text-teal-700">{Object.entries(nodeRollup).filter(([k])=>k.split('.').length===1).reduce((a,[,v])=>a+v.commHrs,0)>0?fmtHrs(Object.entries(nodeRollup).filter(([k])=>k.split('.').length===1).reduce((a,[,v])=>a+v.commHrs,0)):"—"}</div>
              <div className="py-2 text-right pr-2 text-blue-900 text-sm">{fmt(grandEE)}</div>
              {isCommercial && <div className="py-2 text-right pr-2 text-orange-800 text-sm">{fmt(grandComm)}</div>}
            </div>
          </div>
        )}

        {/* Contingency + Escalation + Grand Total */}
        {grandEE>0 && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            {/* Contingency row */}
            <div className="grid text-xs border-b" style={{gridTemplateColumns: isCommercial?"1fr 100px 100px":"1fr 100px"}}>
              <div className="px-4 py-2 text-gray-600 font-medium">Base Estimate (excl. contingency &amp; escalation)</div>
              <div className="py-2 text-right pr-4 font-bold text-blue-900">{fmt(grandEE)}</div>
              {isCommercial && <div className="py-2 text-right pr-4 font-bold text-orange-800">{fmt(grandComm)}</div>}
            </div>
            <div className="grid text-xs border-b" style={{gridTemplateColumns: isCommercial?"1fr 100px 100px":"1fr 100px"}}>
              <div className="px-4 py-2 text-gray-600">
                Contingency ({contPct}%)
              </div>
              <div className="py-2 text-right pr-4 text-blue-600 font-medium">{fmt(contAmt * (grandEE/(grandComm||grandEE)))}</div>
              {isCommercial && <div className="py-2 text-right pr-4 text-orange-600 font-medium">{fmt(contAmt)}</div>}
            </div>

            {/* Escalation breakdown */}
            {escResult.escTotal > 0 && (
              <div className="border-b">
                <div className="grid text-xs bg-teal-50" style={{gridTemplateColumns: isCommercial?"1fr 100px 100px":"1fr 100px"}}>
                  <div className="px-4 py-2 font-semibold text-teal-800 flex items-center gap-2">
                    📈 Escalation
                    <span className="text-xs text-teal-600 font-normal">
                      (weighted avg across project timeline)
                    </span>
                  </div>
                  <div className="py-2 text-right pr-4 font-bold text-teal-700">{fmt(escResult.escTotal)}</div>
                  {isCommercial && <div className="py-2 text-right pr-4 font-bold text-teal-700">{fmt(escResult.escComm)}</div>}
                </div>
                {/* Category breakdown */}
                {Object.entries(escResult.byCategory).filter(([,v])=>v.val>0).map(([label,v])=>(
                  <div key={label} className="grid text-xs border-t border-teal-100 bg-teal-50/50"
                    style={{gridTemplateColumns: isCommercial?"1fr 100px 100px":"1fr 100px"}}>
                    <div className="px-6 py-1 text-teal-700">
                      ↳ {label} <span className="text-teal-400">({v.pct.toFixed(2)}% of base)</span>
                    </div>
                    <div className="py-1 text-right pr-4 text-teal-600 font-medium">{fmt(v.val)}</div>
                    {isCommercial && <div className="py-1 text-right pr-4 text-teal-500">{fmt(v.val*(1+ANS_LAB))}</div>}
                  </div>
                ))}
              </div>
            )}
            {!escRates && (
              <div className="px-4 py-2 text-xs text-amber-600 bg-amber-50 border-b">
                ⚠ Escalation rates not loaded — upload <span className="font-mono">escalation_rates.json</span> to public/data/
              </div>
            )}

            {/* FINAL TOTAL */}
            <div className="grid font-bold text-sm bg-blue-900 text-white"
              style={{gridTemplateColumns: isCommercial?"1fr 100px 100px":"1fr 100px"}}>
              <div className="px-4 py-3.5">
                TOTAL — Base + Contingency + Escalation
                <div className="text-xs font-normal opacity-75 mt-0.5">
                  {inv.name||"Investment"} · {inv.estClass} · Rev {inv.revision}
                </div>
              </div>
              <div className="py-3.5 text-right pr-4 text-white text-base">{fmt(finalTotal * (grandEE/(grandComm||grandEE)))}</div>
              {isCommercial && <div className="py-3.5 text-right pr-4 text-orange-300 text-base font-bold">{fmt(finalTotal)}</div>}
            </div>
          </div>
        )}

        {/* ANS note */}
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
// ── INVESTMENT HUB ───────────────────────────────────────────────
// Manager / senior stakeholder view — read-only portfolio overview
const STATUS_CFG = {
  "Draft":      { bg:"bg-gray-100",     text:"text-gray-600",   dot:"bg-gray-400"   },
  "In Review":  { bg:"bg-blue-100",     text:"text-blue-700",   dot:"bg-blue-500"   },
  "Approved":   { bg:"bg-green-100",    text:"text-green-700",  dot:"bg-green-500"  },
  "On Hold":    { bg:"bg-yellow-100",   text:"text-yellow-700", dot:"bg-yellow-500" },
  "Rejected":   { bg:"bg-red-100",      text:"text-red-700",    dot:"bg-red-500"    },
};
const CLASS_COLOR = {
  "Class 1":"bg-red-100 text-red-700","Class 2":"bg-orange-100 text-orange-700",
  "Class 3":"bg-yellow-100 text-yellow-700","Class 4":"bg-blue-100 text-blue-700",
  "Class 5":"bg-green-100 text-green-700",
};

function InvestmentHub({ onLoad, onNew, currentInv, currentLines }) {
  const [saved,       setSaved]       = useState([]);
  const [search,      setSearch]      = useState("");
  const [statusFilter,setStatusFilter]= useState("All");
  const [classFilter, setClassFilter] = useState("All");
  const [typeFilter,  setTypeFilter]  = useState("All");
  const [sortBy,      setSortBy]      = useState("savedAt");
  const [sortDir,     setSortDir]     = useState("desc");
  const [selected,    setSelected]    = useState(null);
  const [editStatus,  setEditStatus]  = useState(null); // id of investment being status-edited

  // Load from localStorage on mount and on focus
  const load = () => {
    try {
      const raw = localStorage.getItem("iet_investments");
      if (raw) setSaved(JSON.parse(raw));
    } catch(e){}
  };
  useEffect(()=>{ load(); window.addEventListener("focus",load); return ()=>window.removeEventListener("focus",load); },[]);

  const updateStatus = (id, newStatus) => {
    const updated = saved.map(s=>s.id===id ? {...s,status:newStatus} : s);
    setSaved(updated);
    localStorage.setItem("iet_investments", JSON.stringify(updated));
    setEditStatus(null);
  };
  const del = (id) => {
    const updated = saved.filter(s=>s.id!==id);
    setSaved(updated);
    localStorage.setItem("iet_investments", JSON.stringify(updated));
    if (selected?.id===id) setSelected(null);
  };

  // Completion %: lines entered / total supply lines for that investment
  const completion = (s) => {
    if (!s.totalSupplyLines || s.totalSupplyLines===0) return null;
    return Math.min(100, Math.round((s.linesCount / s.totalSupplyLines) * 100));
  };

  // ── PDF EXPORT via print iframe ──────────────────────────────
  const exportPDF = (s) => {
    const inv = s.inv;
    const phaseNames = {"1":"Planning","2":"Design","3":"Construction","4":"Commissioning","5":"M&C"};
    const comp = completion(s);
    const sc = STATUS_CFG[s.status||"Draft"] || STATUS_CFG.Draft;

    const phaseRows = Object.entries(s.phaseBreakdown||{}).sort().map(([ph,p])=>`
      <tr>
        <td style="padding:6px 10px;font-weight:600;color:#1e3a5f">Phase ${ph} — ${phaseNames[ph]||ph}</td>
        <td style="padding:6px 10px;text-align:right;color:#7c3aed">${p.installHrs?Math.round(p.installHrs)+' hrs':'—'}</td>
        <td style="padding:6px 10px;text-align:right;font-weight:700;color:#1e40af">$${Math.round(p.eeInt).toLocaleString('en-AU')}</td>
        <td style="padding:6px 10px;text-align:right;font-weight:700;color:#c2410c">$${Math.round(p.comm).toLocaleString('en-AU')}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
    <title>IET Estimate — ${inv.name}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 11px; color: #1f2937; margin: 0; padding: 20px; }
      h1 { font-size: 18px; color: #1e3a5f; margin: 0 0 4px; }
      .subtitle { color: #6b7280; font-size: 11px; margin-bottom: 16px; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e3a5f; padding-bottom: 12px; margin-bottom: 16px; }
      .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 600; }
      .status-draft { background:#f3f4f6;color:#6b7280; }
      .status-approved { background:#d1fae5;color:#065f46; }
      .status-review { background:#dbeafe;color:#1d4ed8; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
      th { background: #1e3a5f; color: white; padding: 6px 10px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
      td { border-bottom: 1px solid #e5e7eb; }
      tr:nth-child(even) td { background: #f8fafc; }
      .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
      .meta-box { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; }
      .meta-label { font-size: 9px; text-transform: uppercase; color: #9ca3af; letter-spacing: 0.5px; margin-bottom: 2px; }
      .meta-value { font-weight: 600; color: #1f2937; }
      .total-box { background: #1e3a5f; color: white; padding: 10px 14px; border-radius: 6px; display: inline-block; margin: 4px; }
      .total-label { font-size: 9px; opacity: 0.75; text-transform: uppercase; }
      .total-value { font-size: 16px; font-weight: 700; }
      .footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 9px; }
      @media print { body { padding: 10px; } }
    </style></head><body>

    <div class="header">
      <div>
        <h1>${inv.name||'Unnamed Investment'}</h1>
        <div class="subtitle">${inv.number} &nbsp;·&nbsp; ${inv.type} &nbsp;·&nbsp; ${inv.estClass} Rev ${inv.revision}
          &nbsp;·&nbsp; <span class="badge status-${(s.status||'Draft').toLowerCase().replace(' ','-')}">${s.status||'Draft'}</span>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:9px;color:#9ca3af">Essential Energy — IET Demo</div>
        <div style="font-size:9px;color:#9ca3af">Generated ${new Date().toLocaleDateString('en-AU',{dateStyle:'long'})}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-box"><div class="meta-label">Estimator</div><div class="meta-value">${inv.estimatedBy}</div></div>
      <div class="meta-box"><div class="meta-label">Reviewer</div><div class="meta-value">${inv.reviewedBy}</div></div>
      <div class="meta-box"><div class="meta-label">Complexity / New Tech</div><div class="meta-value">${inv.complexity} / ${inv.newTech}</div></div>
      <div class="meta-box"><div class="meta-label">Estimate Completion</div><div class="meta-value">${comp!==null?comp+'%':'—'} &nbsp;(${s.linesCount} of ${s.totalSupplyLines||'?'} lines)</div></div>
    </div>

    <h2 style="font-size:13px;color:#1e3a5f;margin:0 0 8px">Financial Summary</h2>
    <div style="margin-bottom:16px">
      <div class="total-box"><div class="total-label">EE Internal Total</div><div class="total-value">$${Math.round(s.totalEE).toLocaleString('en-AU')}</div></div>
      <div class="total-box" style="background:#ea580c"><div class="total-label">Commercial Total</div><div class="total-value">$${Math.round(s.totalComm).toLocaleString('en-AU')}</div></div>
      ${s.totalComm>s.totalEE?`<div class="total-box" style="background:#374151"><div class="total-label">ANS Uplift</div><div class="total-value">$${Math.round(s.totalComm-s.totalEE).toLocaleString('en-AU')}</div></div>`:''}
    </div>

    <h2 style="font-size:13px;color:#1e3a5f;margin:0 0 8px">Phase Breakdown</h2>
    <table>
      <thead><tr>
        <th>Phase</th><th style="text-align:right">Install Hrs</th>
        <th style="text-align:right">EE Internal</th><th style="text-align:right">Commercial</th>
      </tr></thead>
      <tbody>${phaseRows}</tbody>
      <tfoot><tr style="font-weight:700;background:#f8fafc">
        <td style="padding:8px 10px;border-top:2px solid #1e3a5f">Total</td>
        <td style="padding:8px 10px;text-align:right;border-top:2px solid #1e3a5f">—</td>
        <td style="padding:8px 10px;text-align:right;border-top:2px solid #1e3a5f;color:#1e40af">$${Math.round(s.totalEE).toLocaleString('en-AU')}</td>
        <td style="padding:8px 10px;text-align:right;border-top:2px solid #1e3a5f;color:#c2410c">$${Math.round(s.totalComm).toLocaleString('en-AU')}</td>
      </tr></tfoot>
    </table>

    <div class="footer">
      IET Estimation Tool — Demo &nbsp;·&nbsp; Saved ${s.savedAt} &nbsp;·&nbsp; ${inv.number} Rev ${inv.revision}
      &nbsp;·&nbsp; This estimate is ${s.status||'Draft'} and has not been formally approved.
    </div>

    <script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}</script>
    </body></html>`;

    const w = window.open('','_blank','width=900,height=700');
    w.document.write(html);
    w.document.close();
  };
  const statuses  = ["All","Draft","In Review","Approved","On Hold","Rejected"];
  const classes   = ["All","Class 1","Class 2","Class 3","Class 4","Class 5"];
  const types     = ["All","Commercially Funded","Internally Funded"];

  // Filter + sort
  const filtered = saved.filter(s=>{
    const ms = !search || s.inv.name?.toLowerCase().includes(search.toLowerCase())
      || s.inv.number?.toLowerCase().includes(search.toLowerCase())
      || s.inv.estimatedBy?.toLowerCase().includes(search.toLowerCase());
    const ss = statusFilter==="All" || (s.status||"Draft")===statusFilter;
    const cs = classFilter==="All"  || s.inv.estClass===classFilter;
    const ts = typeFilter==="All"   || s.inv.type===typeFilter;
    return ms && ss && cs && ts;
  }).sort((a,b)=>{
    let av,bv;
    if (sortBy==="name")      { av=a.inv.name;      bv=b.inv.name; }
    else if (sortBy==="comm") { av=a.totalComm;     bv=b.totalComm; }
    else if (sortBy==="ee")   { av=a.totalEE;       bv=b.totalEE; }
    else if (sortBy==="comp") { av=completion(a)||0; bv=completion(b)||0; }
    else { av=a.savedAtISO||a.savedAt; bv=b.savedAtISO||b.savedAt; }
    return sortDir==="asc" ? (av>bv?1:-1) : (av<bv?1:-1);
  });

  // Portfolio totals
  const portTotals = filtered.reduce((a,s)=>({
    ee:a.ee+s.totalEE, comm:a.comm+s.totalComm, count:a.count+1,
  }),{ee:0,comm:0,count:0});

  const SortBtn = ({col,label}) => (
    <button onClick={()=>{ if(sortBy===col) setSortDir(d=>d==="asc"?"desc":"asc"); else{setSortBy(col);setSortDir("desc");} }}
      className={`flex items-center gap-0.5 ${sortBy===col?"text-blue-600 font-bold":"text-gray-500 hover:text-gray-700"}`}>
      {label}{sortBy===col&&<span className="text-xs">{sortDir==="asc"?"↑":"↓"}</span>}
    </button>
  );

  return (
    <div className="flex flex-1 overflow-hidden bg-gray-50">

      {/* LEFT — filters + list */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header bar */}
        <div className="bg-white border-b px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <div>
            <div className="text-base font-bold text-gray-900">Investment Hub</div>
            <div className="text-xs text-gray-400">{filtered.length} of {saved.length} investments · Portfolio: {fmt(portTotals.comm)} commercial · {fmt(portTotals.ee)} EE internal</div>
          </div>
          <div className="flex-1"/>
          <button onClick={onNew}
            className="bg-orange-600 hover:bg-orange-500 text-white text-xs px-4 py-2 rounded font-bold flex items-center gap-1.5 shadow">
            ＋ New Estimate
          </button>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search name, number, estimator…"
            className="border border-gray-300 rounded px-2 py-1.5 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-blue-400"/>
          {search && <button onClick={()=>setSearch("")} className="text-xs text-gray-400 hover:text-gray-600">✕</button>}
        </div>

        {/* Filter bar */}
        <div className="bg-white border-b px-4 py-2 flex items-center gap-4 flex-shrink-0">
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 font-semibold">Status</span>
            <div className="flex border border-gray-200 rounded overflow-hidden">
              {statuses.map(s=>(
                <button key={s} onClick={()=>setStatusFilter(s)}
                  className={`text-xs px-2.5 py-1 transition-colors ${statusFilter===s?"bg-blue-700 text-white":"text-gray-600 hover:bg-gray-50"}`}>{s}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 font-semibold">Class</span>
            <div className="flex border border-gray-200 rounded overflow-hidden">
              {classes.map(c=>(
                <button key={c} onClick={()=>setClassFilter(c)}
                  className={`text-xs px-2 py-1 transition-colors ${classFilter===c?"bg-blue-700 text-white":"text-gray-600 hover:bg-gray-50"}`}>{c==="All"?"All":c.replace("Class ","C")}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 font-semibold">Type</span>
            <div className="flex border border-gray-200 rounded overflow-hidden">
              {types.map(t=>(
                <button key={t} onClick={()=>setTypeFilter(t)}
                  className={`text-xs px-2.5 py-1 transition-colors ${typeFilter===t?"bg-blue-700 text-white":"text-gray-600 hover:bg-gray-50"}`}>{t==="All"?"All":t==="Commercially Funded"?"Commercial":"Internal"}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {saved.length === 0 ? (
            <div className="flex items-center justify-center h-full text-center text-gray-400">
              <div>
                <div className="text-4xl mb-3">🔍</div>
                <div className="text-sm font-semibold">No investments saved yet</div>
                <div className="text-xs mt-1">Use the Estimation Tool → Summary tab to save investments</div>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">No investments match filters</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold"><SortBtn col="name" label="Investment"/></th>
                  <th className="px-3 py-2 font-semibold text-gray-500 text-center">Status</th>
                  <th className="px-3 py-2 font-semibold text-gray-500 text-center">Class</th>
                  <th className="px-3 py-2 font-semibold text-gray-500 text-center">Rev</th>
                  <th className="px-3 py-2 font-semibold text-gray-500 text-left">Estimator</th>
                  <th className="px-3 py-2 font-semibold text-gray-500 text-left">Reviewer</th>
                  <th className="px-3 py-2 font-semibold text-center"><SortBtn col="comp" label="Complete"/></th>
                  <th className="px-3 py-2 font-semibold text-right"><SortBtn col="ee" label="EE Internal"/></th>
                  <th className="px-3 py-2 font-semibold text-right"><SortBtn col="comm" label="Commercial"/></th>
                  <th className="px-3 py-2 font-semibold text-gray-500 text-right"><SortBtn col="savedAt" label="Saved"/></th>
                  <th className="px-3 py-2 w-16"/>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s=>{
                  const sc    = STATUS_CFG[s.status||"Draft"] || STATUS_CFG.Draft;
                  const cc    = CLASS_COLOR[s.inv.estClass]   || "bg-gray-100 text-gray-500";
                  const comp  = completion(s);
                  const isSel = selected?.id===s.id;
                  return (
                    <tr key={s.id}
                      onClick={()=>setSelected(isSel?null:s)}
                      className={`border-b cursor-pointer transition-colors ${isSel?"bg-blue-50 border-l-4 border-l-blue-500":"hover:bg-gray-50"}`}>
                      <td className="px-3 py-2">
                        <div className={`font-semibold truncate max-w-[200px] ${isSel?"text-blue-800":"text-gray-900"}`}>{s.inv.name||"Unnamed"}</div>
                        <div className="text-gray-400 font-mono">{s.inv.number} · {s.inv.type==="Commercially Funded"?"Commercial":"Internal"}</div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {editStatus===s.id ? (
                          <select autoFocus value={s.status||"Draft"} onChange={e=>updateStatus(s.id,e.target.value)}
                            onBlur={()=>setEditStatus(null)}
                            className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white focus:outline-none">
                            {["Draft","In Review","Approved","On Hold","Rejected"].map(st=><option key={st}>{st}</option>)}
                          </select>
                        ) : (
                          <span onClick={e=>{e.stopPropagation();setEditStatus(s.id);}}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer hover:opacity-80 ${sc.bg} ${sc.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sc.dot}`}/>
                            {s.status||"Draft"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${cc}`}>{s.inv.estClass}</span>
                      </td>
                      <td className="px-3 py-2 text-center text-gray-500 font-mono">{s.inv.revision}</td>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{s.inv.estimatedBy}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{s.inv.reviewedBy}</td>
                      <td className="px-3 py-2 text-center">
                        {comp !== null ? (
                          <div className="flex items-center gap-1.5 justify-center">
                            <div className="w-16 bg-gray-200 rounded-full h-1.5">
                              <div className={`h-1.5 rounded-full ${comp>=75?"bg-green-500":comp>=50?"bg-blue-500":comp>=25?"bg-yellow-500":"bg-red-400"}`}
                                style={{width:`${comp}%`}}/>
                            </div>
                            <span className={`font-mono font-bold ${comp>=75?"text-green-600":comp>=50?"text-blue-600":comp>=25?"text-yellow-600":"text-red-500"}`}>
                              {comp}%
                            </span>
                          </div>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-blue-800">{fmt(s.totalEE)}</td>
                      <td className="px-3 py-2 text-right font-bold text-orange-700">{fmt(s.totalComm)}</td>
                      <td className="px-3 py-2 text-right text-gray-400 whitespace-nowrap">{s.savedAt}</td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex gap-1 justify-center" onClick={e=>e.stopPropagation()}>
                          <button onClick={()=>onLoad(s)}
                            className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-2 py-1 rounded font-semibold">Open</button>
                          <button onClick={()=>del(s.id)}
                            className="text-xs border border-red-200 text-red-400 hover:bg-red-50 px-1.5 py-1 rounded">✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Portfolio footer */}
              {filtered.length > 1 && (
                <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                  <tr>
                    <td className="px-3 py-2 font-bold text-gray-700" colSpan={6}>Portfolio Total ({filtered.length} investments)</td>
                    <td className="px-3 py-2 text-center text-gray-500">
                      {Math.round(filtered.reduce((a,s)=>a+(completion(s)||0),0)/filtered.length)}% avg
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-blue-900">{fmt(portTotals.ee)}</td>
                    <td className="px-3 py-2 text-right font-bold text-orange-800">{fmt(portTotals.comm)}</td>
                    <td colSpan={2}/>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>

      {/* RIGHT — detail panel */}
      {selected && (
        <div className="w-80 bg-white border-l flex flex-col overflow-hidden flex-shrink-0">
          <div className="bg-blue-900 text-white px-4 py-3 flex items-start justify-between flex-shrink-0">
            <div>
              <div className="font-bold text-sm leading-tight">{selected.inv.name}</div>
              <div className="text-blue-300 text-xs mt-0.5">{selected.inv.number}</div>
            </div>
            <button onClick={()=>setSelected(null)} className="text-blue-400 hover:text-white text-sm ml-2">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Key info */}
            <div className="p-3 space-y-2 border-b">
              {[
                ["Status",      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CFG[selected.status||"Draft"]?.bg} ${STATUS_CFG[selected.status||"Draft"]?.text}`}>{selected.status||"Draft"}</span>],
                ["Estimate Class", <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${CLASS_COLOR[selected.inv.estClass]||""}`}>{selected.inv.estClass}</span>],
                ["Revision",    selected.inv.revision],
                ["Type",        selected.inv.type],
                ["Complexity",  selected.inv.complexity],
                ["New Tech",    selected.inv.newTech],
                ["Estimator",   selected.inv.estimatedBy],
                ["Reviewer",    selected.inv.reviewedBy],
                ["Saved",       selected.savedAt],
                ["Lines entered", `${selected.linesCount} of ${selected.totalSupplyLines||"?"} supply lines`],
              ].map(([label,val])=>(
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400 flex-shrink-0">{label}</span>
                  <span className="text-xs font-semibold text-gray-800 text-right">{val}</span>
                </div>
              ))}
            </div>

            {/* Completion bar */}
            {completion(selected) !== null && (
              <div className="px-3 py-3 border-b">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-500 font-semibold">Estimate Completion</span>
                  <span className="font-bold text-blue-700">{completion(selected)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div className={`h-3 rounded-full transition-all ${completion(selected)>=75?"bg-green-500":completion(selected)>=50?"bg-blue-500":completion(selected)>=25?"bg-yellow-500":"bg-red-400"}`}
                    style={{width:`${completion(selected)}%`}}/>
                </div>
                <div className="text-xs text-gray-400 mt-1">{selected.linesCount} of {selected.totalSupplyLines} lines</div>
              </div>
            )}

            {/* Financials */}
            <div className="px-3 py-3 border-b space-y-2">
              <div className="text-xs font-bold text-gray-600 uppercase tracking-wide">Financials</div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-500">EE Internal</span>
                <span className="text-xs font-bold text-blue-800">{fmt(selected.totalEE)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-500">Commercial Total</span>
                <span className="text-xs font-bold text-orange-700">{fmt(selected.totalComm)}</span>
              </div>
              {selected.totalComm > 0 && selected.totalEE > 0 && (
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500">ANS Uplift</span>
                  <span className="text-xs font-medium text-gray-600">{fmt(selected.totalComm - selected.totalEE)}</span>
                </div>
              )}
            </div>

            {/* Phase breakdown */}
            {selected.phaseBreakdown && Object.keys(selected.phaseBreakdown).length>0 && (
              <div className="px-3 py-3 border-b">
                <div className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">Phase Breakdown</div>
                {Object.entries(selected.phaseBreakdown).sort().map(([ph,p])=>(
                  <div key={ph} className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-gray-400 w-20 flex-shrink-0">Phase {ph}</span>
                    <div className="flex-1 bg-gray-100 rounded h-1.5">
                      <div className="h-1.5 rounded bg-blue-500"
                        style={{width:`${selected.totalEE>0?Math.round(p.eeInt/selected.totalEE*100):0}%`}}/>
                    </div>
                    <span className="text-xs font-medium text-blue-800 w-20 text-right">{fmt(p.eeInt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="border-t p-3 space-y-2 flex-shrink-0">
            <button onClick={()=>onLoad(selected)}
              className="w-full bg-blue-700 hover:bg-blue-600 text-white text-xs py-2 rounded font-semibold">
              📐 Open in Estimation Tool
            </button>
            <div className="flex gap-2">
              <button onClick={()=>exportPDF(selected)}
                className="flex-1 border border-gray-200 text-gray-600 text-xs py-1.5 rounded hover:bg-gray-50 hover:border-blue-400">📄 Export PDF</button>
              <button className="flex-1 border border-gray-200 text-gray-600 text-xs py-1.5 rounded hover:bg-gray-50">☁️ Copperleaf</button>
              <button onClick={()=>del(selected.id)}
                className="border border-red-200 text-red-500 text-xs px-2 py-1.5 rounded hover:bg-red-50">✕</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── OLD SAVED INVESTMENTS (now replaced by hub) ──
function SavedInvestments({ onLoad }) {
  return <InvestmentHub onLoad={onLoad}/>;
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

function WBSVirtualList({ rows, managerMode=false, editingWbs=null, editVals={}, setEditVals, onStartEdit, onSaveEdit, onCancelEdit, wbsOverrides={}, onDeleteWbs }) {
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
                      : <div className="flex gap-1.5 justify-center">
                          <button onClick={()=>onStartEdit(row)} className="text-blue-400 hover:text-blue-700 text-xs">Edit</button>
                          {isAdded && <button onClick={()=>onDeleteWbs&&onDeleteWbs(row.wbs_code)} className="text-red-400 hover:text-red-700 text-xs">Del</button>}
                        </div>
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


// ── RATES EDITOR ────────────────────────────────────────────────
function RatesEditor({ rates, managerMode, onUnlock }) {
  const [localRates, setLocalRates] = useState(null);
  const [editingRow,  setEditingRow]  = useState(null);
  const [editVals,    setEditVals]    = useState({});
  const display = localRates || rates;

  const startEdit = (r) => {
    setEditingRow(r.resource_type);
    setEditVals({
      ee_internal_rate:    r.ee_internal_rate,
      ee_commercial_rate:  r.ee_commercial_rate,
      ans_margin_pct_labour: r.ans_margin_pct_labour,
      aer_code:            r.aer_code || "",
      erp_code:            r.erp_code || "",
      uom:                 r.uom || "Hour",
    });
  };
  const saveEdit = (resource_type) => {
    const base = localRates || rates;
    setLocalRates(base.map(r => r.resource_type === resource_type ? {
      ...r,
      ee_internal_rate:    parseFloat(editVals.ee_internal_rate)    || r.ee_internal_rate,
      ee_commercial_rate:  parseFloat(editVals.ee_commercial_rate)  || r.ee_commercial_rate,
      ans_margin_pct_labour: parseFloat(editVals.ans_margin_pct_labour) || r.ans_margin_pct_labour,
      aer_code: editVals.aer_code,
      erp_code: editVals.erp_code,
      uom:      editVals.uom,
    } : r));
    setEditingRow(null);
  };

  const cols = ["Resource Type","AER Code","ERP Code","EE Internal $/hr","EE Commercial $/hr","ANS Margin %","UOM",""];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-shrink-0">
        <span className="text-xs text-gray-500">{display.length} resource types</span>
        <div className="flex-1"/>
        {managerMode ? (
          <span className="text-xs bg-orange-100 text-orange-700 px-3 py-1.5 rounded font-semibold flex items-center gap-1.5">🔓 Manager Mode — click row to edit</span>
        ) : (
          <button onClick={onUnlock} className="text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded flex items-center gap-1.5">🔒 Manager Mode</button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b sticky top-0 z-10">
            <tr>{cols.map(h=><th key={h} className="text-left px-3 py-2 font-semibold text-gray-500 whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody>
            {display.map(r => {
              const isEd = editingRow === r.resource_type;
              return (
                <tr key={r.resource_type} className={`border-b ${isEd?"bg-blue-50":"hover:bg-gray-50"}`}>
                  <td className="px-3 py-1.5 font-medium text-gray-800 max-w-xs">
                    <div className="truncate">{r.resource_type}</div>
                  </td>
                  <td className="px-3 py-1.5">
                    {isEd ? <input value={editVals.aer_code} onChange={e=>setEditVals(p=>({...p,aer_code:e.target.value}))}
                      className="w-20 border border-blue-300 rounded px-1 py-0.5 text-xs font-mono focus:outline-none"/> : <span className="font-mono text-blue-700">{r.aer_code}</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    {isEd ? <input value={editVals.erp_code} onChange={e=>setEditVals(p=>({...p,erp_code:e.target.value}))}
                      className="w-24 border border-blue-300 rounded px-1 py-0.5 text-xs focus:outline-none"/> : <span className="text-gray-500">{r.erp_code}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {isEd ? <input type="number" value={editVals.ee_internal_rate} onChange={e=>setEditVals(p=>({...p,ee_internal_rate:e.target.value}))}
                      className="w-20 border border-green-300 bg-green-50 rounded px-1 py-0.5 text-xs text-right focus:outline-none"/> : <span className="font-medium text-blue-900">${r.ee_internal_rate?.toFixed(2)}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {isEd ? <input type="number" value={editVals.ee_commercial_rate} onChange={e=>setEditVals(p=>({...p,ee_commercial_rate:e.target.value}))}
                      className="w-20 border border-orange-300 bg-orange-50 rounded px-1 py-0.5 text-xs text-right focus:outline-none"/> : <span className="font-medium text-orange-700">${r.ee_commercial_rate?.toFixed(2)}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {isEd ? <input type="number" step="0.001" value={(editVals.ans_margin_pct_labour*100).toFixed(1)} onChange={e=>setEditVals(p=>({...p,ans_margin_pct_labour:parseFloat(e.target.value)/100}))}
                      className="w-16 border border-teal-300 bg-teal-50 rounded px-1 py-0.5 text-xs text-right focus:outline-none"/> : <span className="text-teal-700">{r.ans_margin_pct_labour!=null?(r.ans_margin_pct_labour*100).toFixed(1)+"%":"—"}</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    {isEd ? <input value={editVals.uom} onChange={e=>setEditVals(p=>({...p,uom:e.target.value}))}
                      className="w-16 border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none"/> : <span className="text-gray-500">{r.uom}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-center whitespace-nowrap">
                    {managerMode && (isEd ? (
                      <div className="flex gap-1">
                        <button onClick={()=>saveEdit(r.resource_type)} className="text-green-600 hover:text-green-800 font-bold text-xs">✓</button>
                        <button onClick={()=>setEditingRow(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
                      </div>
                    ) : <button onClick={()=>startEdit(r)} className="text-blue-400 hover:text-blue-700 text-xs">Edit</button>)}
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


// ── SCALING EDITOR ───────────────────────────────────────────────
function ScalingEditor({ managerMode, onUnlock }) {
  const { commProfiles: ctxProfiles, commLookup } = useData();
  const [localProfiles, setLocalProfiles] = useState(null);
  const profiles = localProfiles || ctxProfiles;

  const PROFILE_STATUS = ["Confirmed","Pending","Draft"];
  const SC = {Confirmed:"bg-green-100 text-green-700", Pending:"bg-yellow-100 text-yellow-700", Draft:"bg-gray-100 text-gray-500"};
  const FC = f => f>=1?"text-green-600":f>=0.90?"text-blue-600":f>=0.85?"text-yellow-600":f>=0.80?"text-orange-600":"text-red-600";

  const updateTier = (profileId, tierIdx, field, val) => {
    const base = localProfiles || ctxProfiles;
    setLocalProfiles({...base, [profileId]: {
      ...base[profileId],
      tiers: base[profileId].tiers.map((t,i) => i===tierIdx ? {...t, [field]: val} : t)
    }});
  };
  const addTier = (profileId) => {
    const base = localProfiles || ctxProfiles;
    const tiers = base[profileId].tiers;
    const last  = tiers[tiers.length-1];
    setLocalProfiles({...base, [profileId]: {
      ...base[profileId],
      tiers: [...tiers, { qty_from: (last.qty_to||last.qty_from)+1, qty_to: null, scale: last.scale }]
    }});
  };
  const removeTier = (profileId, tierIdx) => {
    const base = localProfiles || ctxProfiles;
    if (base[profileId].tiers.length <= 1) return;
    setLocalProfiles({...base, [profileId]: {
      ...base[profileId],
      tiers: base[profileId].tiers.filter((_,i)=>i!==tierIdx)
    }});
  };
  const updateStatus = (profileId, status) => {
    const base = localProfiles || ctxProfiles;
    setLocalProfiles({...base, [profileId]: {...base[profileId], status}});
  };

  // Count items using each profile
  const profileCounts = {};
  Object.values(commLookup).forEach(item => {
    if (item.profile_id) profileCounts[item.profile_id] = (profileCounts[item.profile_id]||0)+1;
  });

  if (!Object.keys(profiles).length) return (
    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading scaling profiles…</div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-shrink-0">
        <span className="text-xs text-gray-500">{Object.keys(profiles).length} profiles · Changes apply immediately to commissioning calculations</span>
        <div className="flex-1"/>
        {managerMode ? (
          <span className="text-xs bg-orange-100 text-orange-700 px-3 py-1.5 rounded font-semibold flex items-center gap-1.5">🔓 Manager Mode — edit tiers below</span>
        ) : (
          <button onClick={onUnlock} className="text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded flex items-center gap-1.5">🔒 Manager Mode</button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-5xl mx-auto space-y-4">
          {Object.entries(profiles).map(([profileId, profile])=>(
            <div key={profileId} className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-sm text-gray-800">{profile.name}</span>
                  <span className="text-xs text-gray-400 font-mono">{profileId}</span>
                  {managerMode ? (
                    <select value={profile.status||"Pending"} onChange={e=>updateStatus(profileId,e.target.value)}
                      className={`text-xs px-2 py-0.5 rounded font-medium border-0 focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer ${SC[profile.status]||SC.Draft}`}>
                      {PROFILE_STATUS.map(s=><option key={s}>{s}</option>)}
                    </select>
                  ) : (
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${SC[profile.status]||SC.Draft}`}>{profile.status||"Draft"}</span>
                  )}
                  <span className="text-xs text-gray-400">{profileCounts[profileId]||0} commission items use this profile</span>
                </div>
                {managerMode && (
                  <button onClick={()=>addTier(profileId)}
                    className="text-xs bg-green-700 hover:bg-green-600 text-white px-2 py-1 rounded">+ Add Tier</button>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-center gap-1 flex-wrap">
                  {profile.tiers.map((tier,i)=>(
                    <div key={i} className={`relative border rounded-lg p-3 text-center min-w-[90px] ${managerMode?"border-blue-200 bg-blue-50":"border-gray-200 bg-gray-50"}`}>
                      {managerMode && (
                        <button onClick={()=>removeTier(profileId,i)}
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center leading-none hover:bg-red-700">×</button>
                      )}
                      <div className="text-xs text-gray-500 mb-2">Qty range</div>
                      <div className="flex items-center justify-center gap-1 mb-2">
                        {managerMode ? (
                          <>
                            <input type="number" min="1" value={tier.qty_from} onChange={e=>updateTier(profileId,i,'qty_from',parseFloat(e.target.value))}
                              className="w-10 text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"/>
                            <span className="text-gray-400 text-xs">–</span>
                            <input type="number" min="1" value={tier.qty_to??""} onChange={e=>updateTier(profileId,i,'qty_to',e.target.value?parseFloat(e.target.value):null)}
                              placeholder="∞"
                              className="w-10 text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"/>
                          </>
                        ) : (
                          <span className="text-xs font-medium text-gray-600">{tier.qty_from}{tier.qty_to?`–${tier.qty_to}`:"+∞"}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mb-1">Scale %</div>
                      {managerMode ? (
                        <input type="number" min="1" max="100" step="1"
                          value={Math.round(tier.scale*100)}
                          onChange={e=>updateTier(profileId,i,'scale',parseFloat(e.target.value)/100)}
                          className="w-16 text-center border border-gray-300 rounded px-1 py-1 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-blue-400"/>
                      ) : (
                        <div className={`text-lg font-bold ${FC(tier.scale)}`}>{(tier.scale*100).toFixed(0)}%</div>
                      )}
                      {tier.scale < 1 && (
                        <div className="text-xs text-gray-400 mt-1">save {((1-tier.scale)*100).toFixed(0)}%</div>
                      )}
                    </div>
                  ))}
                  {profile.tiers.length === 0 && (
                    <div className="text-sm text-gray-400 italic px-4">No tiers — scale factor = 1.0 (no reduction)</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ── ESCALATION EDITOR ────────────────────────────────────────────
function EscalationEditor({ managerMode, onUnlock }) {
  const { escRates: ctxRates } = useData();
  const [localRates, setLocalRates] = useState(null);
  const rates = localRates || ctxRates;

  const FYS = ["FY2026","FY2027","FY2028","FY2029"];
  const CATS = ["internal_ee","contractors","materials"];

  const updateRate = (cat, fy, val) => {
    const base = localRates || ctxRates;
    if (!base) return;
    setLocalRates({
      ...base,
      [cat]: { ...base[cat], rates: { ...base[cat].rates, [fy]: parseFloat(val)||0 } }
    });
  };

  // Show worked example of what the rates produce
  const exampleFactors = (cat) => {
    if (!rates) return {};
    const r = Object.values(rates[cat].rates).map(v=>v/100);
    const phaseFactors = {};
    [[1,4,"Planning"],[1,9,"Design"],[6,15,"Construction/Comm"]].forEach(([start,dur,label])=>{
      let avg = 0;
      for (let m=start; m<start+dur; m++) avg += escalationIndex(m, r);
      phaseFactors[label] = (avg/dur*100).toFixed(2);
    });
    return phaseFactors;
  };

  if (!rates) return (
    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
      Loading escalation rates…
    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-shrink-0">
        <div>
          <span className="text-xs font-semibold text-gray-700">Annual Escalation Rates</span>
          <span className="text-xs text-gray-400 ml-2">Source: ABS Producer Price Index — Construction</span>
        </div>
        <div className="flex-1"/>
        {managerMode ? (
          <span className="text-xs bg-orange-100 text-orange-700 px-3 py-1.5 rounded font-semibold">🔓 Manager Mode — click rates to edit</span>
        ) : (
          <button onClick={onUnlock} className="text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded flex items-center gap-1.5">🔒 Manager Mode</button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* Rate table */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="bg-blue-900 text-white px-4 py-2.5">
              <div className="font-bold text-sm">Annual Escalation Rates by Category</div>
              <div className="text-xs opacity-75 mt-0.5">Applied by fiscal year (Australian FY: July – June)</div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold text-gray-600">Category</th>
                  {FYS.map(fy=>(
                    <th key={fy} className="text-center px-4 py-2 font-semibold text-gray-600">{fy}</th>
                  ))}
                  <th className="text-left px-4 py-2 font-semibold text-gray-400 text-xs">Reference</th>
                </tr>
              </thead>
              <tbody>
                {CATS.map(cat=>{
                  const r = rates[cat];
                  return (
                    <tr key={cat} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 font-semibold text-gray-800">{r.label}</td>
                      {FYS.map(fy=>(
                        <td key={fy} className="px-4 py-3 text-center">
                          {managerMode ? (
                            <div className="flex items-center justify-center gap-1">
                              <input
                                type="number" min="0" max="20" step="0.1"
                                value={r.rates[fy]}
                                onChange={e=>updateRate(cat, fy, e.target.value)}
                                className="w-16 text-center border border-blue-300 bg-blue-50 rounded px-1.5 py-1 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-blue-400"
                              />
                              <span className="text-gray-500 text-xs">%</span>
                            </div>
                          ) : (
                            <span className={`text-sm font-bold ${r.rates[fy]>=5?"text-red-600":r.rates[fy]>=4?"text-orange-600":"text-green-600"}`}>
                              {r.rates[fy]}%
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-xs text-gray-400">{r.reference}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Worked example — phase escalation factors at current rates */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="bg-teal-800 text-white px-4 py-2.5">
              <div className="font-bold text-sm">Weighted Escalation Factors by Phase</div>
              <div className="text-xs opacity-75 mt-0.5">Average escalation index applied to each phase cost based on project timeline</div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold text-gray-600">Category</th>
                  <th className="text-center px-4 py-2 font-semibold text-gray-600">Planning (Months 1–4)</th>
                  <th className="text-center px-4 py-2 font-semibold text-gray-600">Design (Months 1–9)</th>
                  <th className="text-center px-4 py-2 font-semibold text-gray-600">Construction (Months 6–20)</th>
                </tr>
              </thead>
              <tbody>
                {CATS.map(cat=>{
                  const factors = exampleFactors(cat);
                  return (
                    <tr key={cat} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 font-semibold text-gray-700">{rates[cat].label}</td>
                      {["Planning","Design","Construction/Comm"].map(ph=>(
                        <td key={ph} className="px-4 py-3 text-center">
                          <span className="font-bold text-blue-800">{factors[ph]}%</span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500">
              ℹ Based on default timeline (Plan: months 1–4, Design: months 1–9, Construction: months 6–20).
              Actual factors calculated per investment timeline on the Summary tab.
            </div>
          </div>

          {/* Formula explanation */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-xs text-blue-800">
            <div className="font-bold mb-2">How escalation is calculated</div>
            <div className="space-y-1">
              <div>1. Each phase cost is split into Labour (EE), Contractors, and Materials.</div>
              <div>2. For each project month, an escalation index is computed: <span className="font-mono">(1+r_y1)^(m1/12) × (1+r_y2)^(m2/12) − 1</span></div>
              <div>3. The average index across the phase duration gives the phase escalation factor.</div>
              <div>4. Escalation cost = Base cost × Phase factor, summed across all phases.</div>
              <div>5. Rates are based on the Australian FY (Jul–Jun). FY2026 = Jul 2025 – Jun 2026.</div>
              <div className="mt-2 font-semibold">Reference: ABS Producer Price Index (PPI) — Heavy and Civil Engineering Construction</div>
            </div>
          </div>
        </div>
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

  // Delete WBS item — double confirm, only for items added in this session
  const [deleteWbs,   setDeleteWbs]   = useState(null);
  const [deleteStage, setDeleteStage] = useState(1);
  const confirmDeleteWbs = () => {
    setWbsOverrides(p=>{ const n={...p}; delete n[deleteWbs]; return n; });
    setDeleteWbs(null); setDeleteStage(1);
  };

  const addPerson=()=>{
    if(!newP.name.trim()||!newP.email.trim()) return;
    setPeople(p=>[...p,{id:Date.now(),...newP,active:true}]);
    setShowAdd(false);
    setNewP({name:"",email:"",role:"Estimator",team:"Zone Substation",canReview:false});
  };

  const equipSelectedCount = Object.values(equipSel).filter(q=>parseFloat(q)>0).length;
  const tabs=[
    {id:"items",     label:"📋 WBS Items",          count:wbs.length},
    {id:"rates",     label:"💲 Resource Rates",      count:rates.length},
    {id:"catalogue", label:"🔧 Equipment Catalogue", count:null},
    {id:"escalation",label:"📈 Escalation Rates",    count:null},
    {id:"scaling",   label:"📐 Comm Scaling",         count:WBS_PROFILES.length},
    {id:"people",    label:"👥 People & Roles",       count:people.filter(p=>p.active).length},
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

      {/* Delete WBS — double confirm */}
      {deleteWbs && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={()=>{setDeleteWbs(null);setDeleteStage(1);}}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-96" onClick={e=>e.stopPropagation()}>
            {deleteStage===1 ? (
              <>
                <div className="text-3xl text-center mb-2">⚠️</div>
                <div className="text-lg font-bold text-gray-900 text-center mb-1">Delete this WBS item?</div>
                <div className="text-sm text-gray-500 text-center mb-1 font-mono">{deleteWbs}</div>
                <div className="text-xs text-gray-400 text-center mb-4">
                  {wbsOverrides[deleteWbs]?.description}
                </div>
                <div className="flex gap-2">
                  <button onClick={()=>{setDeleteWbs(null);setDeleteStage(1);}}
                    className="flex-1 border border-gray-200 text-gray-600 text-sm py-2 rounded hover:bg-gray-50">Cancel</button>
                  <button onClick={()=>setDeleteStage(2)}
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm py-2 rounded font-semibold">Delete</button>
                </div>
              </>
            ) : (
              <>
                <div className="text-3xl text-center mb-2">🛑</div>
                <div className="text-lg font-bold text-red-700 text-center mb-1">Are you absolutely sure?</div>
                <div className="text-sm text-gray-500 text-center mb-4">
                  This will permanently remove WBS item <span className="font-mono">{deleteWbs}</span> from the catalogue. This cannot be undone.
                </div>
                <div className="flex gap-2">
                  <button onClick={()=>{setDeleteWbs(null);setDeleteStage(1);}}
                    className="flex-1 border border-gray-200 text-gray-600 text-sm py-2 rounded hover:bg-gray-50">Keep item</button>
                  <button onClick={confirmDeleteWbs}
                    className="flex-1 bg-red-700 hover:bg-red-800 text-white text-sm py-2 rounded font-bold">Yes, delete permanently</button>
                </div>
              </>
            )}
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
                onDeleteWbs={(code)=>{setDeleteWbs(code);setDeleteStage(1);}}
              />
            )}
          </div>
        </div>
      )}

      {/* Resource Rates */}
      {tab==="rates"&&(
        <RatesEditor rates={rates} managerMode={managerMode} onUnlock={()=>setShowPinModal(true)}/>
      )}

      {/* Equipment Catalogue */}
      {tab==="catalogue"&&(
        <EquipmentCatalogueManager equipSel={equipSel} setEquipSel={setEquipSel}/>
      )}

      {/* Escalation Rates */}
      {tab==="escalation"&&(
        <EscalationEditor managerMode={managerMode} onUnlock={()=>setShowPinModal(true)}/>
      )}

      {/* Commissioning Scaling */}
      {tab==="scaling"&&(
        <ScalingEditor managerMode={managerMode} onUnlock={()=>setShowPinModal(true)}/>
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
          <div className="text-xs opacity-75 mt-0.5">{allItems.length} items</div>
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
                <th className="text-center px-2 py-2 font-semibold text-gray-400 w-14">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => {
                const isEd  = editing === item.id;
                const tc    = TYPE_COLORS[item.type]||{badge:"bg-gray-100 text-gray-500",icon:"•"};
                return (
                  <tr key={item.id}
                    className={`border-b transition-colors ${idx%2===0?"bg-white":"bg-gray-50"} hover:bg-blue-50`}>
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
  {id:"hub",        label:"🔍 Investment Hub"},
  {id:"estimation", label:"⚡ Estimation Tool"},
  {id:"wbsmanager", label:"🗂 WBS Manager"},
];
const EST_TABS = [
  {id:"setup",    label:"⚙️ Investment Setup"},
  {id:"estimate", label:"📐 Estimation"},
  {id:"equipment",label:"📦 Equipment"},
  {id:"review",   label:"📋 Review Lines"},
  {id:"summary",  label:"📊 Summary"},
];

export default function App() {
  const [appTab,      setAppTab]      = useState("hub");
  const [estTab,      setEstTab]      = useState("estimate");
  const [inv,         setInv]         = useState(defaultInv);
  const [lines,       setLines]       = useState({});
  // Commercial rates only apply to Commercially Funded investments
  const isCommercial = inv.type === "Commercially Funded";
  const [lastSaved,   setLastSaved]   = useState(null);

  // Live data
  const [wbsData,     setWbsData]     = useState([]);
  const [ratesData,   setRatesData]   = useState([]);
  const [supplyData,  setSupplyData]  = useState([]);
  const [equipData,   setEquipData]   = useState([]);
  const [equipLookup,  setEquipLookup]  = useState({});
  const [commLookup,   setCommLookup]   = useState({}); // comm_wbs -> {hrs_per_unit, profile_id,...}
  const [commProfiles, setCommProfiles] = useState({}); // profile_id -> {tiers, name, status}
  const [escRates,     setEscRates]     = useState(null);
  const [resourceCodes,setResourceCodes]= useState({}); // escalation rates by category
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
      fetch(`${BASE}data/commission_scaling.json`).then(r=>{if(!r.ok)return {profiles:{},lookup:{}};return r.json();}).catch(()=>({profiles:{},lookup:{}})),
      fetch(`${BASE}data/escalation_rates.json`).then(r=>{if(!r.ok)return null;return r.json();}).catch(()=>null),
      fetch(`${BASE}data/resource_codes.json`).then(r=>{if(!r.ok)return {};return r.json();}).catch(()=>({})),
    ])
    .then(([wbs,rates,supply,equip,lookup,commLookup,escRatesData,resourceCodesData])=>{
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
      setCommProfiles(commLookup.profiles || {});
      setEscRates(escRatesData);
      setResourceCodes(resourceCodesData || {});
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
      const ph=item.wbs_code.split(".")[0];
      const bp={...a.byPhase};
      if(!bp[ph]) bp[ph]={eeInt:0,comm:0};
      bp[ph].eeInt+=c.eeInt; bp[ph].comm+=c.comm;
      return {eeInt:a.eeInt+c.eeInt,comm:a.comm+c.comm,installHrs:a.installHrs+c.installHrs,byPhase:bp};
    },{eeInt:0,comm:0,installHrs:0,byPhase:{}});

    const record = {
      id: Date.now(),
      savedAt: new Date().toLocaleString("en-AU",{dateStyle:"short",timeStyle:"short"}),
      savedAtISO: new Date().toISOString(),
      status: "Draft",
      inv, lines, linesCount:entered.length,
      totalSupplyLines: supply.filter(s=>s.scope==="Supply"||s.scope==="Supply & Install").length,
      totalEE:Math.round(totals.eeInt), totalComm:Math.round(totals.comm),
      totalInstallHrs: Math.round(totals.installHrs||0),
      phaseBreakdown: totals.byPhase||{},
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

  const [pendingNew,    setPendingNew]    = useState(false); // waiting for save-prompt confirm

  const newEstimate = useCallback(()=>{
    // Check if current estimate has unsaved lines
    const hasLines = Object.values(lines).some(l=>parseFloat(l.qty||"0")>0);
    if (hasLines) {
      setPendingNew(true); // triggers modal
    } else {
      setInv({...defaultInv, name:"", number:""});
      setLines({});
      setLastSaved(null);
      setAppTab("estimation");
      setEstTab("setup");
    }
  },[lines]);

  const confirmNew = useCallback((save)=>{
    if (save) saveInvestment();
    setInv({...defaultInv, name:"", number:""});
    setLines({});
    setLastSaved(null);
    setPendingNew(false);
    setAppTab("estimation");
    setEstTab("setup");
  },[saveInvestment]);

  const equipSelected = Object.values(equipSel).filter(q=>parseFloat(q)>0).length;
  const linesEntered = Object.values(lines).filter(l=>parseFloat(l.qty)>0).length;

  return (
    <DataCtx.Provider value={{wbs:wbsData,rates:ratesData,supply:supplyData,equipment:equipData,equipLookup,commLookup,commProfiles,escRates,resourceCodes,loading,error}}>
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
                  <span className={`text-xs font-semibold ${isCommercial?"text-orange-600":"text-blue-600"}`}>
                    {isCommercial?"Commercial + ANS Rates":"EE Internal Rates only"}
                  </span>
                  <span className="text-xs text-gray-400">{inv.estimatedBy}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                    inv.type==="Commercially Funded"?"bg-orange-100 text-orange-700":"bg-blue-100 text-blue-700"}`}>
                    {inv.type==="Commercially Funded"?"COMMERCIAL":"INTERNAL"}
                  </span>
                </div>
              </div>

              <div className="flex-1 overflow-hidden flex flex-col">
                {estTab==="setup"        && <InvestmentSetup inv={inv} onChange={setInv}/>}
                {estTab==="estimate"     && (
                  <div className="flex flex-1 overflow-hidden">
                    <EstimationScreen isCommercial={isCommercial} lines={lines} setLines={setLines}/>
                  </div>
                )}

                {estTab==="equipment"    && <EquipmentScreen lines={lines} setLines={setLines} isCommercial={isCommercial} inv={inv}/>}
                {estTab==="review"    && <ReviewLines lines={lines} isCommercial={isCommercial}/>}
                {estTab==="summary"   && <SummaryScreen inv={inv} lines={lines} isCommercial={isCommercial} equipSel={equipSel} onSave={saveInvestment} lastSaved={lastSaved}/>}
              </div>
            </>
          )}
          {appTab==="wbsmanager" && <WBSManager equipSel={equipSel} setEquipSel={setEquipSel}/>}
          {appTab==="hub"        && <InvestmentHub
            onLoad={(s)=>{loadInvestment(s);}}
            onNew={newEstimate}
            currentInv={inv}
            currentLines={lines}
          />}
        </div>

        {/* Save-before-new modal */}
        {pendingNew && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-96">
              <div className="text-lg font-bold text-gray-900 mb-1">Start new estimate?</div>
              <div className="text-sm text-gray-500 mb-4">
                You have unsaved quantities in <span className="font-semibold text-gray-800">{inv.name||"the current estimate"}</span>.
                Do you want to save before starting a new one?
              </div>
              <div className="flex gap-2">
                <button onClick={()=>confirmNew(true)}
                  className="flex-1 bg-green-700 hover:bg-green-600 text-white text-sm py-2 rounded font-semibold">
                  💾 Save then New
                </button>
                <button onClick={()=>confirmNew(false)}
                  className="flex-1 bg-red-600 hover:bg-red-500 text-white text-sm py-2 rounded font-semibold">
                  Discard & New
                </button>
                <button onClick={()=>setPendingNew(false)}
                  className="px-4 border border-gray-200 text-gray-600 text-sm py-2 rounded hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DataCtx.Provider>
  );
}
