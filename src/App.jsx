import { useState, useMemo, useEffect, useCallback, createContext, useContext, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════
// IET ESTIMATION TOOL — FULL SCALE DEMO
// Live data from GitHub Pages /data/ JSON files
// LocalStorage persistence for investment saves
// ═══════════════════════════════════════════════════════════════════

const BASE = import.meta.env.BASE_URL || "/";

// ── DATA CONTEXT ────────────────────────────────────────────────
const DataCtx = createContext({ wbs:[], rates:[], supply:[], equipment:[], equipLookup:{}, commLookup:{}, commProfiles:{}, escRates:null, resourceCodes:{}, invMats:[], matAssemblies:[], loading:true, error:null });

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
      const c = calcLine(item, ln.qty||"", ln.factor||"1", ln.delivery, ln.instHrsOvrd, ln.contrRate, ln.plant, ln.mats, isCommercial, ln.resourceOvrd, null, 0);
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

// WAFHA / Accommodation item detection — for supply items (not calcLine)
// UOM=day items with resource_main=Work Away From Home are day-rated,
// contribute NO install hours, and must not be flagged as GAP in the WBS editor.
const isWAFHAItem = (item) =>
  (item?.resource_main === "Work Away From Home") ||
  (item?.uom === "day" && (item?.description||"").toLowerCase().includes("accommodation"));

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

function calcLine(item, qty, factor, delivery, installHrsOvrd, contractorRateOvrd, plantCostVal, materialsCostOvrd, isCommercial, resourceOvrd, ratesLookup, pctBase) {
  const q   = parseFloat(qty)   || 0;
  const f   = parseFloat(factor)|| 1;
  const isContr = (delivery || item.delivery_method || "EE Delivered") === "Contractor Delivered";
  // install_hrs_per: used for supply items (propagated from linked install row)
  // ee_unit_hrs: used for install-scope rows shown directly (e.g. 3.1.1.12.4.01)
  const instHrsPU = (installHrsOvrd !== "" && installHrsOvrd != null)
    ? (parseFloat(installHrsOvrd) || 0)
    : (item.install_hrs_per != null ? item.install_hrs_per : (item.ee_unit_hrs || 0));
  const commHrsPU = item.comm_hrs_per || 0;
  const installHrs = q * f * instHrsPU;
  const commHrs    = q * commHrsPU;
  // Use resourceOvrd if set (Main Resource Code override for non-linked items)
  const effectiveResource = resourceOvrd || item.resource_main || "";
  const isWAFHA    = (effectiveResource === "Work Away From Home");
  // WAFHA rate: use manager-edited rate from ratesLookup if available, else item rate, else workbook default
  const wafhaRate  = ratesLookup?.["Work Away From Home"]
    ? (isCommercial
        ? (ratesLookup["Work Away From Home"].ee_commercial_rate || 345.83)
        : (ratesLookup["Work Away From Home"].ee_internal_rate   || 359.50))
    : (item.ee_labour_rate || 359.50);
  const eeRate     = isWAFHA ? wafhaRate : (item.ee_labour_rate || 246.95);
  // Percentage-of-total items: cost = pct × total non-prelim base for this L3 group
  const isPctItem  = !!(item.pct_of_total);
  const pctRate    = isPctItem ? ((pctBase || 0) * item.pct_of_total) : 0;
  const contrRate  = isPctItem
    ? pctRate   // derived from group total
    : (contractorRateOvrd !== "" && contractorRateOvrd != null)
      ? (parseFloat(contractorRateOvrd) || 0)
      : item.contractor_rate || 0;
  const plant      = parseFloat(plantCostVal) || 0;
  const matOvrd    = (materialsCostOvrd !== "" && materialsCostOvrd != null)
    ? parseFloat(materialsCostOvrd) || 0 : null;
  const pce        = item.pce_price || 0;
  const equipCost  = q * (matOvrd !== null ? matOvrd : pce);
  const eeLabHrs   = isContr ? 0 : (isWAFHA ? 0 : q * f * instHrsPU);
  const eeLabCost  = isContr ? 0 : (isWAFHA ? q * f * eeRate : eeLabHrs * eeRate);
  const contrCost  = isContr ? q * f * contrRate : 0;
  const plantFact  = plant * f;
  const matBurden  = isCommercial ? 0 : equipCost * MAT_BURDEN;
  const eeInt  = eeLabCost + contrCost + plantFact + equipCost + matBurden;
  const comm   = eeLabCost*(1+ANS_LAB) + contrCost*(1+ANS_CON) + plantFact + equipCost*(1+ANS_MAT);
  // WAFHA items: installHrs must always be 0 — they are day-rated, not hour-rated
  const finalInstallHrs = isWAFHA ? 0 : installHrs;
  return { q, f, isContr, isWAFHA, installHrs: finalInstallHrs, commHrs, eeLabHrs, eeLabCost,
           contrCost, plantFact, equipCost, matBurden, eeInt, comm,
           instHrsOverridden: installHrsOvrd !== "" && installHrsOvrd != null, instHrsPU,
           effectiveResource };
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

        {/* Invoicing Milestones Card */}
        <Card>
          <SectionHeader color="orange" title="Invoicing Milestones" subtitle="Milestone payment schedule (incoming money) — must sum to 100%" />
          <div className="p-4 bg-white space-y-2">
            <div className="grid grid-cols-12 gap-1 text-[10px] text-gray-400 font-semibold uppercase tracking-wide px-0.5 mb-1">
              <span className="col-span-7">Stage Description</span>
              <span className="col-span-2">Month #</span>
              <span className="col-span-2">% of Total</span>
              <span className="col-span-1"/>
            </div>
            {(inv.milestones||[]).map((m,i)=>(
              <div key={i} className="grid grid-cols-12 gap-1 items-center">
                <input value={m.stage} placeholder={`Milestone ${i+1} description`}
                  onChange={e=>{const ms=[...(inv.milestones||[])];ms[i]={...ms[i],stage:e.target.value};upd("milestones",ms);}}
                  className="col-span-7 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"/>
                <input type="number" min="1" value={m.month} placeholder="4"
                  onChange={e=>{const ms=[...(inv.milestones||[])];ms[i]={...ms[i],month:e.target.value};upd("milestones",ms);}}
                  className="col-span-2 border border-gray-200 rounded px-1.5 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-orange-400"/>
                <div className="col-span-2 flex items-center gap-0.5">
                  <input type="number" min="0" max="100" value={m.pct} placeholder="0"
                    onChange={e=>{const ms=[...(inv.milestones||[])];ms[i]={...ms[i],pct:e.target.value};upd("milestones",ms);}}
                    className="w-full border border-gray-200 rounded px-1.5 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-orange-400"/>
                  <span className="text-xs text-gray-400 flex-shrink-0">%</span>
                </div>
                <button onClick={()=>upd("milestones",(inv.milestones||[]).filter((_,j)=>j!==i))}
                  className="col-span-1 text-red-400 hover:text-red-600 text-xs text-center">✕</button>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1">
              {(()=>{const tot=(inv.milestones||[]).reduce((s,m)=>s+parseFloat(m.pct||0),0);return(
                <span className="text-xs">
                  <span className="text-gray-500">Total: </span>
                  <span className={Math.abs(tot-100)<0.01?"font-bold text-green-600":"font-bold text-amber-600"}>{tot}%</span>
                  {Math.abs(tot-100)>0.01&&<span className="text-amber-500 ml-2">⚠ must sum to 100%</span>}
                  {Math.abs(tot-100)<0.01&&<span className="text-green-600 ml-2">✓ feeds into cash flow chart</span>}
                </span>
              );})()}
              {(inv.milestones||[]).length < 10 &&
                <button onClick={()=>upd("milestones",[...(inv.milestones||[]),{stage:"",month:"",pct:"0"}])}
                  className="text-xs text-blue-600 hover:underline">+ Add milestone</button>}
            </div>
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
// ── INVENTORY & ASSEMBLY LOOKUP PANEL ────────────────────────────
// Searchable lookup for Inventory Materials and Material Assemblies
// shown as a collapsible drawer in the cost detail panel
function InvMatsLookup({ wbsCode }) {
  const { invMats, matAssemblies } = useData();
  const [open,    setOpen]    = useState(false);
  const [tab,     setTab]     = useState("assembly"); // "assembly" | "inventory"
  const [search,  setSearch]  = useState("");

  // Find assembly matching this WBS code
  const matchAssembly = matAssemblies.find(a => a.wbs_code === wbsCode);

  const filteredInv = useMemo(() => {
    if (!search.trim()) return invMats.slice(0, 50);
    const q = search.toLowerCase();
    return invMats.filter(i =>
      (i.description||"").toLowerCase().includes(q) ||
      (i.item_number||"").toLowerCase().includes(q) ||
      (i.category||"").toLowerCase().includes(q)
    ).slice(0, 80);
  }, [invMats, search]);

  const fmtP = v => v > 0 ? `$${v.toFixed(2)}` : "—";

  return (
    <div className="border-t border-gray-100 mt-2">
      <button onClick={()=>setOpen(o=>!o)}
        className="flex items-center gap-1.5 text-xs text-blue-700 hover:text-blue-900 py-1.5 font-medium w-full">
        <span>{open ? "▾" : "▸"}</span>
        <span>📦 Inventory Materials & Assemblies Lookup</span>
        {matchAssembly && <span className="bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 text-[10px] ml-1">Assembly available</span>}
      </button>

      {open && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden mb-2">
          {/* Tabs */}
          <div className="flex border-b border-gray-200 bg-white">
            {[
              {id:"assembly", label:`🔧 Assembly${matchAssembly?" (matched)":""}`},
              {id:"inventory", label:"📋 Inventory Materials"},
            ].map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)}
                className={`text-xs px-3 py-2 font-medium border-b-2 transition-colors ${tab===t.id?"border-blue-600 text-blue-700":"border-transparent text-gray-500 hover:text-gray-700"}`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab==="assembly" && (
            <div className="p-3">
              {matchAssembly ? (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-xs font-bold text-gray-800">{matchAssembly.description}</div>
                      <div className="text-[10px] text-gray-400">{matchAssembly.wbs_code} · Ref: {matchAssembly.reference||"—"}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold text-blue-700">{matchAssembly.total_cost ? `$${matchAssembly.total_cost.toFixed(2)}` : "—"}</div>
                      <div className="text-[10px] text-gray-400">total assembly cost</div>
                    </div>
                  </div>
                  <table className="w-full text-[10px] border-collapse">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="text-left px-2 py-1">Description</th>
                        <th className="text-left px-2 py-1">Inv Code</th>
                        <th className="text-right px-2 py-1">Qty</th>
                        <th className="text-left px-2 py-1">UOM</th>
                        <th className="text-right px-2 py-1">Unit Rate</th>
                        <th className="text-right px-2 py-1">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchAssembly.components.map((c,i)=>(
                        <tr key={i} className={i%2===0?"bg-white":"bg-gray-50"}>
                          <td className="px-2 py-0.5 text-gray-700">{c.description}</td>
                          <td className="px-2 py-0.5 font-mono text-gray-400">{c.inv_code||"—"}</td>
                          <td className="px-2 py-0.5 text-right">{c.qty}</td>
                          <td className="px-2 py-0.5 text-gray-400">{c.uom}</td>
                          <td className="px-2 py-0.5 text-right">{c.unit_price ? `$${c.unit_price.toFixed(2)}` : "—"}</td>
                          <td className="px-2 py-0.5 text-right font-semibold">{c.total ? `$${c.total.toFixed(2)}` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <div className="text-xs text-gray-400 py-4 text-center">No pre-built assembly found for WBS {wbsCode}</div>
              )}
            </div>
          )}

          {tab==="inventory" && (
            <div className="p-2">
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="Search inventory by description, item number or category…"
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs mb-2 focus:outline-none focus:ring-1 focus:ring-blue-400"/>
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-[10px] border-collapse">
                  <thead className="sticky top-0 bg-gray-100">
                    <tr>
                      <th className="text-left px-2 py-1">Item #</th>
                      <th className="text-left px-2 py-1">Description</th>
                      <th className="text-left px-2 py-1">Category</th>
                      <th className="text-left px-2 py-1">UOM</th>
                      <th className="text-right px-2 py-1">Last Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInv.map((item,i)=>(
                      <tr key={i} className={i%2===0?"bg-white":"bg-gray-50"}>
                        <td className="px-2 py-0.5 font-mono text-gray-500">{item.item_number}</td>
                        <td className="px-2 py-0.5 text-gray-700">{item.description}</td>
                        <td className="px-2 py-0.5 text-gray-400">{item.category}</td>
                        <td className="px-2 py-0.5 text-gray-400">{item.uom}</td>
                        <td className="px-2 py-0.5 text-right font-semibold text-blue-700">{fmtP(item.last_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!search && invMats.length > 50 && (
                  <div className="text-[10px] text-gray-400 text-center py-1">Showing 50 of {invMats.length} — search to filter</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Thin wrapper that scrolls the selected commissioning group into view
function CommScrollList({ selectedCommGroup, children }) {
  const containerRef = useRef(null);
  useEffect(()=>{
    if (!selectedCommGroup || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-comm-group="${selectedCommGroup}"]`);
    if (el) el.scrollIntoView({ behavior:"smooth", block:"start" });
  },[selectedCommGroup]);
  return <div ref={containerRef} className="flex-1 overflow-y-auto">{children}</div>;
}

function EstimationScreen({ isCommercial, lines, setLines }) {
  const { wbs, supply, rates, loading, commLookup, commProfiles } = useData();
  const ratesLookup = useMemo(() => {
    const map = {};
    (rates||[]).forEach(r => { map[r.resource_type] = r; });
    return map;
  }, [rates]);

  // Pre-compute L3 group base totals for percentage-of-total prelim items.
  // For each L3 group, sum contractor costs of all non-prelim items.
  // "ee" basis: sum EE labour costs of all non-prelim items.
  const pctBaseLookup = useMemo(() => {
    const groupContr = {}; // l3 → total contractor cost
    const groupEE    = {}; // l3 → total EE labour cost
    supply.forEach(item => {
      if (item.pct_of_total) return; // skip the prelim items themselves
      const ln  = lines[item.wbs_code] || {};
      const qty = parseFloat(ln.qty || "0");
      if (!qty) return;
      const l3 = item.wbs_code.split(".").slice(0, 3).join(".");
      const c  = calcLine(item, ln.qty||"", ln.factor||"1", ln.delivery,
                          ln.instHrsOvrd, ln.contrRate, ln.plant, ln.mats,
                          isCommercial, ln.resourceOvrd, ratesLookup, 0);
      groupContr[l3] = (groupContr[l3] || 0) + (c.contrCost || 0);
      groupEE[l3]    = (groupEE[l3]    || 0) + (c.eeLabCost || 0);
    });
    // Return lookup: wbs_code → pctBase value
    const lookup = {};
    supply.forEach(item => {
      if (!item.pct_of_total) return;
      const l3   = item.wbs_code.split(".").slice(0, 3).join(".");
      const base = item.pct_basis === "ee" ? (groupEE[l3] || 0) : (groupContr[l3] || 0);
      lookup[item.wbs_code] = base;
    });
    return lookup;
  }, [supply, lines, isCommercial, ratesLookup]);
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
  // PIN lock for resource code + install hrs editing
  const RESOURCE_PIN = "1607";
  const [resourceUnlocked, setResourceUnlocked] = useState(false);
  const [showResourcePin,  setShowResourcePin]  = useState(false);
  const [resPinInput,      setResPinInput]      = useState("");
  const [resPinError,      setResPinError]      = useState(false);
  const resPinRef = useRef(null);
  const tryResourceUnlock = () => {
    if (resPinInput === RESOURCE_PIN) {
      setResourceUnlocked(true); setShowResourcePin(false);
      setResPinInput(""); setResPinError(false);
    } else {
      setResPinError(true); setResPinInput("");
      setTimeout(()=>setResPinError(false), 2000);
    }
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
    return calcLine(item, ln.qty||"", ln.factor||"1", ln.delivery, ln.instHrsOvrd, ln.contrRate, ln.plant, ln.mats, isCommercial, ln.resourceOvrd, ratesLookup, pctBaseLookup[item.wbs_code] || 0);
  },[lines, isCommercial]);

  const groupTotals = useMemo(()=>items.reduce((a,it)=>{
    const c=calcItem(it);
    // commHrs from supply items must NOT appear in construction totals —
    // commissioning hours are accounted for separately via Phase 4 commTotals
    return {installHrs:a.installHrs+c.installHrs,commHrs:a.commHrs,eeTotal:a.eeTotal+c.eeInt,commTotal:a.commTotal+c.comm};
  },{installHrs:0,commHrs:0,eeTotal:0,commTotal:0}),[items,calcItem]);

  const investTotals = useMemo(()=>supply.reduce((a,it)=>{
    const c=calcItem(it);
    return {installHrs:a.installHrs+c.installHrs,commHrs:a.commHrs,eeTotal:a.eeTotal+c.eeInt,commTotal:a.commTotal+c.comm};
  },{installHrs:0,commHrs:0,eeTotal:0,commTotal:0}),[supply,calcItem]);

  const linesEntered = Object.values(lines).filter(l=>parseFloat(l.qty)>0 && !l._commOvrd).length;

  // ── PHASE 4 COMMISSIONING — derived from supply links ──────────
  const commTotals = useMemo(()=>{
    const m = {};
    supply.forEach(item => {
      const commWbs = item.commission_wbs;
      if (!commWbs || !commLookup[commWbs]) return;
      if (commLookup[commWbs].direct_entry) return; // qty entered directly, not auto-derived
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
      if (commLookup[commWbs]?.direct_entry) return; // handled by direct-entry section below
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

  // When navigating to Phase 4 — select the first active commissioning group
  useEffect(()=>{
    if (activePhase === 4) {
      const keys = Object.keys(commAllGroups).sort();
      if (keys.length > 0 && (!selectedCommGroup || !commAllGroups[selectedCommGroup]))
        setSelectedCommGroup(keys[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[activePhase]);

  // When a Phase 4 L4 is selected in the nav tree, jump to that commissioning group
  useEffect(()=>{
    if (activePhase === 4 && selectedL4 && commAllGroups[selectedL4]) {
      setSelectedCommGroup(selectedL4);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selectedL4, activePhase]);

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
      {/* Resource Code PIN Modal */}
      {showResourcePin && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={()=>{setShowResourcePin(false);setResPinInput("");}}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-72" onClick={e=>e.stopPropagation()}>
            <div className="text-center mb-4">
              <div className="text-3xl mb-2">🔐</div>
              <div className="font-bold text-gray-900">Unlock Resource Codes</div>
              <div className="text-xs text-gray-500 mt-1">Enter your manager PIN to edit resource codes and install hours</div>
            </div>
            <input
              ref={resPinRef}
              type="password" maxLength={8}
              value={resPinInput} onChange={e=>setResPinInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&tryResourceUnlock()}
              placeholder="PIN"
              autoFocus
              className={`w-full text-center text-2xl font-mono tracking-widest border-2 rounded-lg px-3 py-3 mb-3 focus:outline-none ${resPinError?"border-red-500 bg-red-50 animate-pulse":"border-gray-300 focus:border-blue-500"}`}
            />
            {resPinError && <div className="text-xs text-red-600 text-center mb-2">Incorrect PIN — try again</div>}
            <div className="flex gap-2">
              <button onClick={()=>{setShowResourcePin(false);setResPinInput("");}}
                className="flex-1 text-xs border border-gray-200 text-gray-600 py-2 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={tryResourceUnlock}
                className="flex-1 text-xs bg-blue-700 hover:bg-blue-600 text-white py-2 rounded-lg font-semibold">Unlock</button>
            </div>
          </div>
        </div>
      )}
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
                <div className="text-xs opacity-75">All items shown · Qty auto-derived from supply (DIRECT items: enter qty manually) · Scale applied · Override hrs if needed</div>
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
            <CommScrollList selectedCommGroup={selectedCommGroup}>
              {Object.entries(commAllGroups).sort().map(([l4, group]) => {
                const hasActive = group.items.some(i => i.derivedQty > 0);
                const isSelected = l4 === selectedCommGroup;
                return (
                  <div key={l4}>
                    <div
                      data-comm-group={l4}
                      className={`px-3 py-1 flex items-center gap-2 border-b-2 text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors
                        ${l4===selectedCommGroup
                          ? "bg-[#1e3a5f] text-white border-blue-400"
                          : hasActive
                            ? "bg-teal-700 text-white border-teal-500"
                            : "bg-gray-100 text-gray-500 border-gray-300"}`}
                      onClick={()=>setSelectedCommGroup(l4===selectedCommGroup?null:l4)}>
                      <span className="font-mono font-normal opacity-70">{l4}</span>
                      <span className="flex-1 truncate">{group.label}</span>
                      {hasActive && <span className="font-mono font-bold">{fmtHrs(group.totalHrs)}</span>}
                    </div>
                    {/* Items always visible — highlighted group scrolls into view via id */}
                    {group.items.map(item => {
                      const ovrdKey    = `comm_ovrd_${item.wbs}`;
                      const directKey  = `comm_direct_${item.wbs}`;
                      const ovrd       = lines[ovrdKey]?.qty ?? "";
                      const directQtyVal = lines[directKey]?.qty ?? "";
                      const setOvrd    = val => setLines(p=>({...p,[ovrdKey]:{qty:val,_commOvrd:true}}));
                      const setDirect  = val => setLines(p=>({...p,[directKey]:{qty:val,_commOvrd:true}}));
                      const isOvrd     = ovrd !== "" && ovrd !== undefined;
                      const effectiveHrs = isOvrd ? (parseFloat(ovrd)||0) : item.scaledHrs;
                      const cost       = effectiveHrs * (item.ee_labour_rate||139.26);
                      const hasQty     = item.derivedQty > 0;
                      return (
                        <div key={item.wbs}
                          className={`grid items-center px-3 py-1.5 border-b text-xs
                            ${hasQty||directQtyVal?"bg-teal-50":"bg-white hover:bg-gray-50"}
                            ${item.isDirectEntry?"border-l-4 border-l-teal-400":""}
                            ${isOvrd?"border-l-4 border-l-orange-400":""}`}
                          style={{gridTemplateColumns:"1fr 52px 64px 52px 76px 76px 86px 64px"}}>
                          <div className="min-w-0 pr-1">
                            <div className={`truncate font-medium ${hasQty||directQtyVal?"text-teal-900":"text-gray-500"}`}>
                              {item.description}
                              {item.isDirectEntry && <span className="ml-1.5 text-[9px] bg-teal-100 text-teal-700 border border-teal-200 rounded px-1 font-semibold">DIRECT</span>}
                            </div>
                            <div className="font-mono text-gray-400 text-xs">{item.wbs}{isOvrd&&<span className="ml-1 text-orange-500">⚡ override</span>}</div>
                          </div>
                          <div className="text-center text-gray-500">{item.hrs_per_unit||0}</div>
                          <div className="text-center font-bold">
                            {item.isDirectEntry ? (
                              <input type="number" min="0" step="1" value={directQtyVal}
                                onChange={e=>setDirect(e.target.value)}
                                placeholder="0"
                                title="Enter quantity directly — hours = qty × hrs/unit"
                                className="w-14 text-center border-2 border-teal-400 rounded py-0.5 text-xs font-bold bg-teal-50 text-teal-800 focus:outline-none focus:ring-1 focus:ring-teal-500"/>
                            ) : (
                              <span className={hasQty?"text-orange-700":"text-gray-300"}>
                                {hasQty ? item.derivedQty.toLocaleString("en-AU",{maximumFractionDigits:1}) : "—"}
                              </span>
                            )}
                          </div>
                          <div className={`text-center font-bold ${hasQty&&item.scale<1?"text-blue-700":hasQty?"text-gray-400":"text-gray-200"}`}>
                            {fmtPct(item.scale)}
                          </div>
                          <div className={`text-center font-bold ${hasQty||directQtyVal?"text-teal-700":"text-gray-300"}`}>
                            {(hasQty||directQtyVal) ? fmtHrs(item.scaledHrs) : "—"}
                          </div>
                          <div className="flex justify-center">
                            <input type="number" min="0" step="0.5" value={ovrd}
                              onChange={e=>setOvrd(e.target.value)}
                              placeholder={(hasQty||directQtyVal)?item.scaledHrs.toFixed(1):""}
                              className={`w-16 text-center border rounded py-0.5 text-xs font-bold focus:outline-none focus:ring-1
                                ${isOvrd?"border-orange-400 bg-orange-50 text-orange-800":"border-gray-200 text-gray-400"}`}/>
                          </div>
                          <div className={`text-right font-bold ${hasQty||directQtyVal?"text-blue-800":"text-gray-300"}`}>
                            {(hasQty||directQtyVal) ? fmt(cost) : "—"}
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
            </CommScrollList>
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
          <div className="text-center text-purple-700">Install Hrs <span className="text-gray-400 font-normal text-[9px] block leading-tight">(days for WAFHA)</span></div>
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
                      {isWAFHAItem(item) &&
                        <span className="text-xs text-amber-700 bg-amber-50 border border-amber-300 rounded px-1 font-semibold">WAFHA · day rate</span>}
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
                  <div className={`text-center font-bold ${
                    isWAFHAItem(item) ? (hasQty?"text-amber-600":"text-gray-300")
                    : c.instHrsOverridden?"text-orange-600":hasQty?"text-purple-700":"text-gray-300"}`}>
                    {isWAFHAItem(item)
                      ? (hasQty ? <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded px-1 font-semibold">{parseFloat(qty).toLocaleString("en-AU",{maximumFractionDigits:1})} days</span> : "–")
                      : (hasQty?<>{fmtHrs(c.installHrs)}{c.instHrsOverridden&&<span className="text-orange-400 ml-0.5">*</span>}</>:"–")
                    }
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
                          {isWAFHAItem(item)
                            ? ` · WAFHA/Accommodation — UOM: day · Rate: ${fmt(item.ee_labour_rate||359.50)}/day · No install hrs`
                            : `· Std: ${item.install_hrs_per}h install · ${item.comm_hrs_per}h comm · ${fmt(item.ee_labour_rate)}/hr`
                          }
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
                          {/* If item has no install_wbs, show Main Resource dropdown instead —
                              allows the estimator to correct the resource driving costs for
                              EE Delivered items that aren't part of a supply chain */}
                          {item.install_wbs ? (
                            <>
                              <label className="text-xs text-gray-500 block mb-0.5">Install Resource Code</label>
                              <select
                                value={(resourceOvrd[item.install_wbs]?.install) || item.resource_install || "ZS Electrical Technician"}
                                onChange={e=>setResourceOvrd(item.install_wbs, "install", e.target.value)}
                                className="text-xs border border-indigo-300 bg-indigo-50 rounded px-1.5 py-1 bg-white w-full focus:outline-none focus:ring-1 focus:ring-indigo-400">
                                {RESOURCE_TYPES.map(r=><option key={r}>{r}</option>)}
                              </select>
                              <div className="text-xs text-indigo-400 mt-0.5">↳ {item.install_wbs}</div>
                            </>
                          ) : (
                            <>
                              <label className="text-xs text-gray-500 block mb-0.5">
                                Main Resource Code
                                <span className="ml-1 text-gray-400 font-normal">(this item)</span>
                              </label>
                              <select
                                value={ln.resourceOvrd || item.resource_main || "ZS Electrical Technician"}
                                onChange={e=>updLine(item.wbs_code, "resourceOvrd", e.target.value)}
                                disabled={delivery === "Contractor Delivered"}
                                className="text-xs border border-indigo-300 bg-indigo-50 rounded px-1.5 py-1 bg-white w-full focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:bg-gray-100 disabled:text-gray-400">
                                {RESOURCE_TYPES.map(r=><option key={r}>{r}</option>)}
                              </select>
                              {delivery !== "Contractor Delivered" && (
                                <div className="text-xs text-indigo-400 mt-0.5">
                                  {ln.resourceOvrd && ln.resourceOvrd !== item.resource_main
                                    ? `↳ overriding: ${item.resource_main}`
                                    : `↳ default: ${item.resource_main}`}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        <div>
                          {item.commission_wbs ? (
                            <>
                              <label className="text-xs text-gray-500 block mb-0.5">Commission Resource Code</label>
                              <select
                                value={(resourceOvrd[item.commission_wbs]?.comm) || item.resource_comm || "ZS Specialist Technician"}
                                onChange={e=>setResourceOvrd(item.commission_wbs, "comm", e.target.value)}
                                className="text-xs border border-teal-300 bg-teal-50 rounded px-1.5 py-1 bg-white w-full focus:outline-none focus:ring-1 focus:ring-teal-400">
                                {RESOURCE_TYPES.map(r=><option key={r}>{r}</option>)}
                              </select>
                              <div className="text-xs text-teal-500 mt-0.5">↳ {item.commission_wbs}</div>
                            </>
                          ) : (
                            <>
                              <label className="text-xs text-gray-500 block mb-0.5">Commission Resource Code</label>
                              <select disabled className="text-xs border rounded px-1.5 py-1 w-full bg-gray-100 text-gray-400">
                                <option>— no commission link</option>
                              </select>
                              <div className="text-xs text-gray-400 mt-0.5">No commission scope linked</div>
                            </>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-0.5">Install Hrs/Unit Override</label>
                          {isWAFHAItem(item) && <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">WAFHA — day-rated, no install hrs override</div>}
                          {!isWAFHAItem(item) && <input type="number" min="0" value={ln.instHrsOvrd||""} placeholder={String(item.install_hrs_per||0)}
                            onChange={e=>updLine(item.wbs_code,"instHrsOvrd",e.target.value)}
                            className="w-full text-xs border border-purple-300 bg-purple-50 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-purple-400"/>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-0.5">Contractor Rate ($/unit)</label>
                          {item.pct_of_total ? (
                            // Percentage-of-total: auto-derived from L3 group total
                            <>
                              <div className="w-full text-xs border border-teal-200 bg-teal-50/50 rounded px-1.5 py-1 text-teal-800 font-semibold flex items-center justify-between">
                                <span className="text-teal-600">{(item.pct_of_total*100).toFixed(0)}% of {item.pct_basis==="ee"?"EE labour":"contractor"} total</span>
                                <span>= ${Math.round((pctBaseLookup[item.wbs_code]||0)*item.pct_of_total).toLocaleString("en-AU")}</span>
                              </div>
                              <div className="text-xs text-gray-400 mt-0.5">L3 {item.pct_basis==="ee"?"EE labour":"contractor"} base: ${Math.round(pctBaseLookup[item.wbs_code]||0).toLocaleString("en-AU")}</div>
                            </>
                          ) : (
                            <>
                              <input type="number" min="0" value={ln.contrRate||""}
                                placeholder={item.contractor_rate>0?String(Math.round(item.contractor_rate)):"0"}
                                onChange={e=>updLine(item.wbs_code,"contrRate",e.target.value)}
                                className="w-full text-xs border border-teal-300 bg-teal-50 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-teal-400"/>
                              {item.contractor_rate>0&&<div className="text-xs text-amber-600 mt-0.5">Default: ${Math.round(item.contractor_rate).toLocaleString("en-AU")}</div>}
                            </>
                          )}
                        </div>
                        {hasQty && (
                          <div className="text-xs text-gray-500">
                            <div className="font-semibold mb-1 text-gray-600">Hours this item</div>
                            <div className="font-bold text-purple-700">{fmtHrs(c.installHrs)} install</div>
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
                      <div className="border-t border-gray-100 pt-2 space-y-2">
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">Drawing / Reference</label>
                          <div className="flex gap-1.5 items-center">
                            <input value={ln.drawing||""}
                              onChange={e=>updLine(item.wbs_code,"drawing",e.target.value)}
                              placeholder="Drawing no. or https://..."
                              className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300"/>
                            {(ln.drawing||"").startsWith("http") && (
                              <a href={ln.drawing} target="_blank" rel="noopener noreferrer"
                                className="flex-shrink-0 text-xs bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 rounded px-2 py-1 flex items-center gap-1 font-medium">
                                🔗 Open
                              </a>
                            )}
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">Comments / Scope inclusions & exclusions</label>
                          <textarea value={ln.comments||""} onChange={e=>updLine(item.wbs_code,"comments",e.target.value)}
                            rows={2} placeholder="e.g. Includes conductor and insulators. Excludes foundation design."
                            className="w-full text-xs border border-gray-200 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300"/>
                        </div>
                      </div>
                      <InvMatsLookup wbsCode={item.wbs_code}/>
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
              {label:"Install Hours (excl. WAFHA)",value:fmtHrs(groupTotals.installHrs),color:"text-purple-700",bg:"bg-purple-50 border border-purple-100"},
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
              {label:"Install Hours (excl. WAFHA days)",value:fmtHrs(investTotals.installHrs),color:"text-purple-700"},
              {label:"Phase 4 Comm Hrs",value:fmtHrs(commGrandHrs),color:"text-teal-700"},
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
  const { supply, commLookup, commProfiles } = useData();
  const entered = supply.filter(s=>parseFloat(lines[s.wbs_code]?.qty||"0")>0);

  const totals = entered.reduce((a,item)=>{
    const ln=lines[item.wbs_code]||{};
    const c=calcLine(item,ln.qty||"",ln.factor||"1",ln.delivery,ln.instHrsOvrd,ln.contrRate,ln.plant,ln.mats,isCommercial,ln.resourceOvrd,null,0);
    return {installHrs:a.installHrs+c.installHrs,eeInt:a.eeInt+c.eeInt,comm:a.comm+c.comm};
  },{installHrs:0,eeInt:0,comm:0});

  // ── Build Phase 4 commissioning rows ──────────────────────────
  // Step 1: aggregate derived quantities from supply items (skip direct_entry items)
  const commTotals = {};
  entered.forEach(item=>{
    const cw=item.commission_wbs;
    if(!cw||!commLookup[cw]) return;
    if(commLookup[cw].direct_entry) return; // qty entered directly by estimator
    const qty=parseFloat(lines[item.wbs_code]?.qty||"0")*parseFloat(lines[item.wbs_code]?.factor||"1");
    if(!commTotals[cw]) commTotals[cw]={qty:0,...commLookup[cw]};
    commTotals[cw].qty+=qty;
  });

  // Step 2: build display rows — auto-derived + direct-entry
  const phase4Rows = [];
  Object.entries(commLookup).forEach(([commWbs, data])=>{
    const isDirect   = !!data.direct_entry;
    const derivedQty = isDirect
      ? (parseFloat(lines[`comm_direct_${commWbs}`]?.qty||"0")||0)
      : (commTotals[commWbs]?.qty||0);
    if(derivedQty<=0) return; // only show rows with qty
    const scale      = getScaleFactor(commProfiles, data.profile_id, derivedQty);
    const baseHrs    = derivedQty*(data.hrs_per_unit||0);
    const ovrd       = lines[`comm_ovrd_${commWbs}`]?.qty;
    const commHrs    = (ovrd!==undefined&&ovrd!=="")?parseFloat(ovrd)||0:baseHrs*scale;
    const rate       = data.ee_labour_rate||139.26;
    const eeInt      = commHrs*rate;
    const comm       = eeInt*(1+ANS_LAB);
    phase4Rows.push({ commWbs, data, derivedQty, isDirect, scale, baseHrs, commHrs, rate, eeInt, comm,
                      isHrsOvrd: ovrd!==undefined&&ovrd!=="" });
  });

  const phase4Totals = phase4Rows.reduce((a,r)=>({
    commHrs: a.commHrs+r.commHrs, eeInt: a.eeInt+r.eeInt, comm: a.comm+r.comm
  }),{commHrs:0,eeInt:0,comm:0});

  // Group supply items by L1 phase (excluding Phase 4 — handled separately)
  const byPhase = {};
  entered.forEach(item=>{
    const phase=item.wbs_code.split(".")[0];
    if(phase==="4") return;
    if(!byPhase[phase]) byPhase[phase]=[];
    byPhase[phase].push(item);
  });

  const hasAnyData = entered.length>0 || phase4Rows.length>0;

  if(!hasAnyData) return (
    <div className="flex-1 flex items-center justify-center bg-gray-50">
      <div className="text-center text-gray-400">
        <div className="text-4xl mb-3">📋</div>
        <div className="text-sm font-semibold text-gray-500">No lines entered yet</div>
        <div className="text-xs mt-1">Enter quantities in the Estimation tab to see lines here</div>
      </div>
    </div>
  );

  const colSpanBase = isCommercial ? 8 : 7; // cols in supply table
  const colSpanComm = isCommercial ? 7 : 6; // cols in commission table

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
      <div className="max-w-6xl mx-auto space-y-4">

        {/* ── Summary bar ── */}
        <div className={`bg-white rounded-lg border border-gray-200 shadow-sm p-4 grid gap-4 ${isCommercial?"grid-cols-5":"grid-cols-4"}`}>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-800">{entered.length}</div>
            <div className="text-xs text-gray-500">Supply Lines</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-700">{fmtHrs(totals.installHrs)}</div>
            <div className="text-xs text-gray-500">Install Hours</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-teal-700">{fmtHrs(phase4Totals.commHrs)}</div>
            <div className="text-xs text-gray-500">Comm Hours (Ph.4)</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-900">{fmt(totals.eeInt+phase4Totals.eeInt)}</div>
            <div className="text-xs text-gray-500">EE Internal Total</div>
          </div>
          {isCommercial && (
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-700">{fmt(totals.comm+phase4Totals.comm)}</div>
              <div className="text-xs text-gray-500">Commercial Total</div>
            </div>
          )}
        </div>

        {/* ── Supply phases (1–3, 5) ── */}
        {Object.entries(byPhase).sort().map(([phase,items])=>(
          <div key={phase} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="bg-gray-700 text-white text-xs font-bold px-4 py-2 uppercase tracking-wide flex items-center justify-between">
              <span>Phase {phase} — {{"1":"Planning","2":"Design","3":"Construction","5":"M&C"}[phase]||phase}</span>
              <span className="font-mono opacity-75">{items.length} lines</span>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 whitespace-nowrap">WBS Code</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500">Description</th>
                  <th className="text-center px-3 py-2 font-semibold text-gray-500">Qty</th>
                  <th className="text-center px-3 py-2 font-semibold text-gray-500">Factor</th>
                  <th className="text-center px-3 py-2 font-semibold text-gray-500">UOM</th>
                  <th className="text-right px-3 py-2 font-semibold text-purple-600 whitespace-nowrap">Install Hrs</th>
                  <th className="text-right px-3 py-2 font-semibold text-blue-700 whitespace-nowrap">EE Internal</th>
                  {isCommercial && <th className="text-right px-3 py-2 font-semibold text-orange-700 whitespace-nowrap">Commercial</th>}
                  <th className="text-left px-3 py-2 font-semibold text-gray-500">Delivery</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item,i)=>{
                  const ln=lines[item.wbs_code]||{};
                  const c=calcLine(item,ln.qty||"",ln.factor||"1",ln.delivery,ln.instHrsOvrd,ln.contrRate,ln.plant,ln.mats,isCommercial,ln.resourceOvrd,null,0);
                  return (
                    <tr key={item.wbs_code} className={`border-b ${i%2===0?"bg-white":"bg-gray-50"} hover:bg-blue-50`}>
                      <td className="px-3 py-1.5 font-mono text-blue-600 whitespace-nowrap text-[11px]">{item.wbs_code}</td>
                      <td className="px-3 py-1.5 text-gray-800 max-w-xs truncate" title={item.description}>{item.description}</td>
                      <td className="px-3 py-1.5 text-center font-bold text-orange-700">{ln.qty}</td>
                      <td className="px-3 py-1.5 text-center text-gray-500">{ln.factor||"1"}</td>
                      <td className="px-3 py-1.5 text-center text-gray-500">{item.uom||"each"}</td>
                      <td className="px-3 py-1.5 text-right font-medium text-purple-700">{fmtHrs(c.installHrs)||"—"}</td>
                      <td className="px-3 py-1.5 text-right font-bold text-blue-800">{fmt(c.eeInt)}</td>
                      {isCommercial && <td className="px-3 py-1.5 text-right font-bold text-orange-700">{fmt(c.comm)}</td>}
                      <td className="px-3 py-1.5 text-gray-500 text-[11px]">{c.isContr?"Contractor":"EE"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-100 border-t">
                <tr>
                  <td colSpan={5} className="px-3 py-1.5 font-semibold text-gray-600 text-[11px]">Phase {phase} totals</td>
                  <td className="px-3 py-1.5 text-right font-bold text-purple-700">
                    {fmtHrs(items.reduce((a,item)=>{
                      const ln=lines[item.wbs_code]||{};
                      const c=calcLine(item,ln.qty||"",ln.factor||"1",ln.delivery,ln.instHrsOvrd,ln.contrRate,ln.plant,ln.mats,isCommercial,ln.resourceOvrd,null,0);
                      return a+c.installHrs;
                    },0))||"—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-bold text-blue-900">
                    {fmt(items.reduce((a,item)=>{
                      const ln=lines[item.wbs_code]||{};
                      const c=calcLine(item,ln.qty||"",ln.factor||"1",ln.delivery,ln.instHrsOvrd,ln.contrRate,ln.plant,ln.mats,isCommercial,ln.resourceOvrd,null,0);
                      return a+c.eeInt;
                    },0))}
                  </td>
                  {isCommercial && <td className="px-3 py-1.5 text-right font-bold text-orange-800">
                    {fmt(items.reduce((a,item)=>{
                      const ln=lines[item.wbs_code]||{};
                      const c=calcLine(item,ln.qty||"",ln.factor||"1",ln.delivery,ln.instHrsOvrd,ln.contrRate,ln.plant,ln.mats,isCommercial,ln.resourceOvrd,null,0);
                      return a+c.comm;
                    },0))}
                  </td>}
                  <td/>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}

        {/* ── Phase 4 — Commissioning ── */}
        {phase4Rows.length>0 && (
          <div className="bg-white rounded-lg border border-teal-300 shadow-sm overflow-hidden">
            <div className="bg-teal-700 text-white text-xs font-bold px-4 py-2 uppercase tracking-wide flex items-center justify-between">
              <span>Phase 4 — Commissioning <span className="font-normal opacity-75 normal-case ml-2">auto-derived from supply quantities · scale factor applied</span></span>
              <span className="font-mono opacity-75">{phase4Rows.length} lines · {fmtHrs(phase4Totals.commHrs)}</span>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-teal-50 border-b border-teal-200">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 whitespace-nowrap">WBS Code</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500">Description</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500">Resource</th>
                  <th className="text-center px-3 py-2 font-semibold text-orange-700 whitespace-nowrap">Qty</th>
                  <th className="text-center px-3 py-2 font-semibold text-gray-500 whitespace-nowrap">Hrs/Unit</th>
                  <th className="text-center px-3 py-2 font-semibold text-blue-600 whitespace-nowrap">Scale</th>
                  <th className="text-right px-3 py-2 font-semibold text-teal-700 whitespace-nowrap">Comm Hrs</th>
                  <th className="text-right px-3 py-2 font-semibold text-blue-700 whitespace-nowrap">EE Internal</th>
                  {isCommercial && <th className="text-right px-3 py-2 font-semibold text-orange-700 whitespace-nowrap">Commercial</th>}
                  <th className="text-left px-3 py-2 font-semibold text-gray-500">Type</th>
                </tr>
              </thead>
              <tbody>
                {phase4Rows.sort((a,b)=>a.commWbs.localeCompare(b.commWbs)).map((row,i)=>(
                  <tr key={row.commWbs} className={`border-b ${i%2===0?"bg-white":"bg-teal-50/30"} hover:bg-teal-50`}>
                    <td className="px-3 py-1.5 font-mono text-teal-700 whitespace-nowrap text-[11px]">{row.commWbs}</td>
                    <td className="px-3 py-1.5 text-gray-800 max-w-xs truncate" title={row.data.description}>{row.data.description}</td>
                    <td className="px-3 py-1.5 text-gray-500 text-[11px] whitespace-nowrap">{row.data.resource_type}</td>
                    <td className="px-3 py-1.5 text-center font-bold text-orange-700">
                      {row.derivedQty.toLocaleString("en-AU",{maximumFractionDigits:1})}
                    </td>
                    <td className="px-3 py-1.5 text-center text-gray-500">{row.data.hrs_per_unit||0}</td>
                    <td className="px-3 py-1.5 text-center text-blue-600">
                      {row.scale < 1
                        ? <span className="font-bold text-blue-700">{fmtPct(row.scale)}</span>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right font-bold text-teal-700 whitespace-nowrap">
                      {fmtHrs(row.commHrs)}
                      {row.isHrsOvrd && <span className="ml-1 text-orange-500 text-[10px]">⚡ovrd</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right font-bold text-blue-800">{fmt(row.eeInt)}</td>
                    {isCommercial && <td className="px-3 py-1.5 text-right font-bold text-orange-700">{fmt(row.comm)}</td>}
                    <td className="px-3 py-1.5 text-[11px]">
                      {row.isDirect
                        ? <span className="bg-teal-100 text-teal-700 border border-teal-200 rounded px-1.5 py-0.5 font-semibold">DIRECT</span>
                        : <span className="text-gray-400">auto</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-teal-100 border-t border-teal-300">
                <tr>
                  <td colSpan={6} className="px-3 py-1.5 font-semibold text-teal-800 text-[11px]">Phase 4 totals (scale-adjusted)</td>
                  <td className="px-3 py-1.5 text-right font-bold text-teal-800">{fmtHrs(phase4Totals.commHrs)}</td>
                  <td className="px-3 py-1.5 text-right font-bold text-blue-900">{fmt(phase4Totals.eeInt)}</td>
                  {isCommercial && <td className="px-3 py-1.5 text-right font-bold text-orange-800">{fmt(phase4Totals.comm)}</td>}
                  <td/>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

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
    const c=calcLine(item,ln.qty||"",ln.factor||"1",ln.delivery,ln.instHrsOvrd,ln.contrRate,ln.plant,ln.mats,isCommercial,ln.resourceOvrd,null,0);
    byPhase[ph].eeInt+=c.eeInt; byPhase[ph].comm+=c.comm;
    byPhase[ph].installHrs+=c.installHrs;
    // commHrs from supply items excluded from construction phase —
    // they appear only in Phase 4 via the commissioning derivation below
    byPhase[ph].lines++;
    byPhase[ph].eeLabCost  += c.eeLabCost  || 0;
    byPhase[ph].contrCost  += c.contrCost  || 0;
    byPhase[ph].matCost    += c.equipCost  || 0; // PCE/materials
  });

  // Phase 4 derived (skip direct_entry items — those use estimator-entered qty)
  const commTotals = {};
  entered.forEach(item=>{
    if(!item.commission_wbs||!commLookup[item.commission_wbs]) return;
    if(commLookup[item.commission_wbs].direct_entry) return;
    const qty=parseFloat(lines[item.wbs_code]?.qty||"0");
    const factor=parseFloat(lines[item.wbs_code]?.factor||"1");
    const cw=item.commission_wbs;
    if(!commTotals[cw]) commTotals[cw]={qty:0,...commLookup[cw]};
    commTotals[cw].qty+=qty*factor;
  });
  const eeRate=139.26;
  const phase4=Object.entries(commTotals).reduce((a,[wbs,ct])=>{
    if(ct.qty<=0) return a;
    if(commLookup[wbs]?.direct_entry) return a;
    const scale=getScaleFactor(commProfiles,ct.profile_id,ct.qty);
    const baseHrs=ct.qty*(ct.hrs_per_unit||0);
    const ovrd=lines[`comm_ovrd_${wbs}`]?.qty;
    const hrs=ovrd!==undefined&&ovrd!==""?(parseFloat(ovrd)||0):baseHrs*scale;
    const rate=ct.ee_labour_rate||eeRate;
    const cost=hrs*rate;
    return {commHrs:a.commHrs+hrs,eeInt:a.eeInt+cost,comm:a.comm+cost*(1+ANS_LAB),lines:a.lines+1};
  },{commHrs:0,eeInt:0,comm:0,lines:0});
  if(phase4.commHrs>0) byPhase["4"]={...phase4,installHrs:0,eeLabCost:phase4.eeInt,contrCost:0,matCost:0};

  // commGrandHrs available locally for WBS table column
  const commGrandHrs = phase4.commHrs;

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
        m[ancestor].commHrs    += vals.commHrs; // only populated from Phase 4 commissioning rows
        m[ancestor].lines      += 1;
      }
    };
    entered.forEach(item=>{
      const ln=lines[item.wbs_code]||{};
      const c=calcLine(item,ln.qty||"",ln.factor||"1",ln.delivery,ln.instHrsOvrd,ln.contrRate,ln.plant,ln.mats,isCommercial,ln.resourceOvrd,null,0);
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
          <div className="py-1.5 text-center text-teal-600">
            {/* Comm hrs shown only at Phase 4 level via footer total */}
            {code==="4"&&commGrandHrs>0?<span className="font-bold">{fmtHrs(commGrandHrs)}</span>:"—"}
          </div>
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
              {p.installHrs>0 && <div className="text-xs text-purple-600 mt-1">{fmtHrs(p.installHrs)} install hrs</div>}
              {ph==="4" && p.commHrs>0 && <div className="text-xs text-teal-600 mt-0.5">{fmtHrs(p.commHrs)} comm hrs</div>}
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
              <div className="py-2 text-center text-teal-600 whitespace-nowrap">Comm Hrs<div className="text-[9px] font-normal text-gray-400">(Ph.4 derived)</div></div>
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
              <div className="py-2 text-center text-teal-700">{commGrandHrs>0?fmtHrs(commGrandHrs):"—"}</div>
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

// ── FINANCIAL REPORT SCREEN ──────────────────────────────────────
// Mirrors the Financial Report sheet: cost summary table, Commercial
// Project Agreement breakdown, and cash flow chart.
function FinancialScreen({ inv, lines, isCommercial }) {
  const { supply } = useData();

  const totals = useMemo(() => {
    // Mirrors Financial Report sheet exactly:
    // Sub-Contract  = contractor cost + plant (contractor delivered items)
    // Materials     = equipment/PCE cost (supply items with pce_price)
    // EE Internal   = EE labour cost + plant (EE delivered items) + WAFHA
    let subCost=0, matCost=0, eeCost=0;
    let subANS=0,  matANS=0,  eeANS=0;

    supply.forEach(item => {
      const ln = lines[item.wbs_code] || {};
      if (!parseFloat(ln.qty||"0")) return;
      const c = calcLine(item, ln.qty||"", ln.factor||"1", ln.delivery,
                         ln.instHrsOvrd, ln.contrRate, ln.plant, ln.mats, isCommercial,
                         ln.resourceOvrd);
      const isContr = (ln.delivery||item.delivery_method||"") === "Contractor Delivered";

      if (isContr) {
        // Sub-Contract: contractor cost + plant on contractor items
        const sc = (c.contrCost||0) + (c.plantFact||0);
        subCost += sc;
        subANS  += (c.contrCost||0)*ANS_CON;  // ANS only on labour portion
      } else {
        // EE Internal Works: EE labour + plant on EE items
        const ee = (c.eeLabCost||0) + (c.plantFact||0);
        eeCost += ee;
        eeANS  += (c.eeLabCost||0)*ANS_LAB;   // ANS only on labour portion
      }

      // Materials: equipment/PCE cost on all items
      matCost += c.equipCost||0;
      matANS  += (c.equipCost||0)*ANS_MAT;
    });

    const contPct   = parseFloat(inv.contingency||"0")/100;

    // Cost* column = base cost (no ANS, no contingency)
    const base      = subCost + matCost + eeCost;

    // Contingency applied to base
    const cont      = base * contPct;

    // Total Estimated Cost (Cost* column) = base + contingency
    const totalCost = base + cont;

    // Admin / ANS Burden = sum of all ANS margins
    const totalANS  = subANS + matANS + eeANS;

    // Contract Value = Cost* + ANS (what the customer pays)
    const cv        = totalCost + totalANS;

    // EE Internal ERP (Direct spend) = same as Cost* — no ANS applied
    // EE Internal ERP incl overheads = Cost* × overhead factor (~1.866)
    // overhead factor from Financial Report sheet = "*** Includes ** + corporate & network burden"
    const OVERHEAD = 1.866;
    const eeOH     = totalCost * OVERHEAD;

    const gst     = cv * 0.1;
    const gstInc  = cv + gst;

    // PA breakdown — derived from actual cost buckets
    const paDesign       = eeCost * 0.12;                   // ~12% of EE Internal = design labour
    const paConstruction = eeCost * 0.63;                   // ~63% of EE Internal = construction labour
    const paCommission   = eeCost * 0.25;                   // ~25% of EE Internal = commissioning labour
    const paMatContr     = matCost + subCost + matANS + subANS; // all materials + contractor + their ANS

    return {
      subCost, matCost, eeCost, subANS, matANS, eeANS, cont,
      totalCost, totalANS, cv, gst, gstInc, eeOH,
      paDesign, paConstruction, paCommission, paMatContr,
    };
  }, [supply, lines, isCommercial, inv]);

  // Cash flow — cumulative S-curve over project months
  const cashFlow = useMemo(() => {
    const conStart = parseInt(inv.constrStart||6);
    const conDur   = parseInt(inv.constrDur||15);
    const total    = Math.max(parseInt(inv.planDur||4)+1,
                              parseInt(inv.designStart||1)+parseInt(inv.designDur||9),
                              conStart+conDur);
    const MON = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
    const sm  = MON[inv.startMonth||"Jul"]||7;
    const sy  = parseInt(inv.startYear||2025);
    const lbl = i => { const o=sm-1+i; const mn=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return `${mn[(o%12)]}${String(sy+Math.floor(o/12)).slice(2)}`; };

    // S-curve weights
    const weights = Array.from({length:total},(_,i)=>{
      const m=i+1;
      if(m>=conStart && m<conStart+conDur){
        const mid=conStart+conDur/2;
        return Math.exp(-Math.pow((m-mid)/(conDur/3),2));
      }
      return m<conStart ? 0.3/(conStart-1||1) : 0;
    });
    const ws=weights.reduce((a,b)=>a+b,0)||1;
    const norm=weights.map(w=>w/ws);

    const milestones = Array(total).fill(0);
    const configMs=(inv.milestones||[]).filter(m=>parseFloat(m.pct||0)>0&&parseInt(m.month||0)>0);
    if (configMs.length>0) {
      configMs.forEach(m=>{const idx=Math.min(Math.max(0,parseInt(m.month)-1),total-1);milestones[idx]=(milestones[idx]||0)+parseFloat(m.pct)/100;});
    } else {
      milestones[0]=0.15;
      milestones[Math.min(conStart+Math.floor(conDur*0.4),total-1)]=0.35;
      milestones[Math.min(conStart+conDur-2,total-1)]=0.50;
    }

    let cumC=0,cumE=0,cumM=0;
    return Array.from({length:total},(_,i)=>{
      cumC+=norm[i]*(totals.totalCost/1e6);
      cumE+=norm[i]*(totals.eeOH/1e6);
      cumM+=milestones[i]*(totals.cv/1e6);
      return { lbl:lbl(i), cumC, cumE, cumM };
    });
  }, [inv, totals]);

  const maxY = Math.max(...cashFlow.map(r=>Math.max(r.cumC,r.cumE,r.cumM)))*1.12||1;
  const CW=700,CH=230,PL=52,PR=20,PT=18,PB=55;
  const W=CW-PL-PR, H=CH-PT-PB;
  const sx=cashFlow.length>1?W/(cashFlow.length-1):W;
  const sy=v=>H-(v/maxY)*H;
  const pts=key=>cashFlow.map((r,i)=>`${PL+i*sx},${PT+sy(r[key])}`).join(" ");
  const fmtD=n=>n===0?"–":"$"+Math.abs(n).toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2});
  const step=Math.max(1,Math.floor(cashFlow.length/14));

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto h-full bg-gray-50">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[#1e3a5f]">Financial Report — {inv.name||"Current Estimate"}</h2>
        <span className="text-xs text-gray-400 italic">All escalation costs excluded · {isCommercial?"Commercial (ANS) rates":"EE Internal rates"}</span>
      </div>

      {/* Cost summary + PA breakdown side by side */}
      <div className="flex gap-4 flex-wrap items-start">

        {/* Main cost table */}
        <div className="flex-1 min-w-[460px] bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-[#1e3a5f] text-white">
                {["Item","Cost* ($)","Admin / ANS Burden ($)","Contract Value ($)","EE Internal ERP** ($)","EE Internal ERP incl overheads*** ($)","Comments"].map(h=>(
                  <th key={h} className="px-2 py-2 font-semibold text-left whitespace-nowrap first:text-left text-right [&:first-child]:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                {label:"Sub-Contract",            cost:totals.subCost, ans:totals.subANS, note:"Including 'Contractors' & 'Plants'"},
                {label:"Materials",                cost:totals.matCost, ans:totals.matANS, note:""},
                {label:"Essential Energy Internal Works", cost:totals.eeCost, ans:totals.eeANS, note:"Including 'Internal resources' & 'WAFHA of EE'"},
              ].map(({label,cost,ans,note},i)=>{
                const cv=cost+ans;
                return (
                  <tr key={i} className={i%2===0?"bg-white":"bg-gray-50"}>
                    <td className="px-2 py-1.5 text-gray-800">{label}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtD(cost)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtD(ans)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtD(cv)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtD(cost)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtD(cv*1.866)}</td>
                    <td className="px-2 py-1.5 text-gray-400 italic text-[10px]">{note}</td>
                  </tr>
                );
              })}
              <tr className="bg-gray-100">
                <td className="px-2 py-1.5 text-gray-600">Contingency</td>
                <td colSpan={2}></td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtD(totals.cont)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtD(totals.cont)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtD(totals.cont*1.866)}</td>
                <td></td>
              </tr>
              <tr className="bg-[#1e3a5f] text-white font-bold">
                <td className="px-2 py-2">Total Estimated Cost</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtD(totals.totalCost)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtD(totals.totalANS)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtD(totals.cv)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtD(totals.totalCost)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtD(totals.eeOH)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
          <div className="px-3 py-2 border-t border-gray-100 text-[10px] text-gray-500 space-y-0.5">
            <div className="font-semibold">Finance's Notes:</div>
            <div>*Includes base cost, labour on-cost, fleet, and material on-cost</div>
            <div>** Includes * + contingency</div>
            <div>*** Includes ** + corporate &amp; network burden</div>
            <div className="italic">All escalation costs have been excluded from financial reports.</div>
          </div>
        </div>

        {/* Commercial PA breakdown */}
        <div className="w-72 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="bg-[#1e3a5f] text-white px-3 py-2 text-xs font-bold">Commercial Project Agreement Cost Breakdown</div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="px-3 py-1.5 text-left font-semibold text-gray-700">Component</th>
                <th className="px-3 py-1.5 text-right font-semibold text-gray-700">Estimate</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Project Management, Approvals and Administration", 0],
                ["Design",                totals.paDesign],
                ["Materials and contracts", totals.paMatContr],
                ["Construction",          totals.paConstruction],
                ["Commissioning",         totals.paCommission],
                ["GST",                   totals.gst],
              ].map(([lbl,val],i)=>(
                <tr key={i} className={i%2===0?"bg-white":"bg-gray-50"}>
                  <td className="px-3 py-1.5 text-gray-800">{lbl}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{val===0?"$\u00a0\u00a0\u00a0\u00a0\u00a0-":"$\u00a0"+val.toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                </tr>
              ))}
              <tr className="bg-gray-100 font-semibold">
                <td className="px-3 py-1.5 text-gray-800 text-[10px]">Estimated Construction Charges (GST exclusive) as at Execution Date</td>
                <td className="px-3 py-1.5 text-right tabular-nums">$ {totals.cv.toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
              </tr>
              <tr className="bg-gray-100 font-semibold">
                <td className="px-3 py-1.5 text-gray-800 text-[10px]">Estimated Construction Charges (GST inclusive) as at Execution Date</td>
                <td className="px-3 py-1.5 text-right tabular-nums">$ {totals.gstInc.toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
              </tr>
              <tr className="bg-[#1e3a5f]/10">
                <td className="px-3 py-1.5 font-bold text-[#1e3a5f]">Check</td><td></td>
              </tr>
              <tr className="bg-green-50">
                <td className="px-3 py-1.5 text-gray-700">PA Sum</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-green-700 font-semibold">$ {totals.cv.toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
              </tr>
              <tr>
                <td className="px-3 py-1.5 text-gray-700">Summary Commercial Total</td>
                <td className="px-3 py-1.5 text-right tabular-nums">$ {totals.cv.toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Cash Flow Chart */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3">
        <div className="text-xs font-bold text-gray-700 mb-1 text-center">Cash Flow ($M)</div>
        <svg width="100%" viewBox={`0 0 ${CW} ${CH}`} className="overflow-visible">
          {[0,0.25,0.5,0.75,1].map(f=>{
            const yv=PT+sy(f*maxY);
            return <g key={f}>
              <line x1={PL} y1={yv} x2={PL+W} y2={yv} stroke="#e5e7eb" strokeWidth="1"/>
              <text x={PL-3} y={yv+3} textAnchor="end" fontSize="8" fill="#6b7280">{(f*maxY).toFixed(2)}</text>
            </g>;
          })}
          <line x1={PL} y1={PT} x2={PL} y2={PT+H} stroke="#9ca3af" strokeWidth="1"/>
          <line x1={PL} y1={PT+H} x2={PL+W} y2={PT+H} stroke="#9ca3af" strokeWidth="1"/>
          <polyline points={pts("cumM")} fill="none" stroke="#eab308" strokeWidth="2"/>
          <polyline points={pts("cumC")} fill="none" stroke="#1e3a5f" strokeWidth="2"/>
          <polyline points={pts("cumE")} fill="none" stroke="#16a34a" strokeWidth="2"/>
          {cashFlow.map((r,i)=>i%step!==0?null:(
            <text key={i} x={PL+i*sx} y={PT+H+13} textAnchor="end" fontSize="8" fill="#6b7280"
                  transform={`rotate(-45,${PL+i*sx},${PT+H+13})`}>{r.lbl}</text>
          ))}
          {[
            {c:"#eab308",l:"Milestone Payments (Incoming Money)"},
            {c:"#1e3a5f",l:"Cost + Contingency"},
            {c:"#16a34a",l:"EE Internal ERP Costing incl overheads***"},
          ].map(({c,l},i)=>(
            <g key={i} transform={`translate(${PL+i*210},${CH-10})`}>
              <line x1={0} y1={0} x2={16} y2={0} stroke={c} strokeWidth="2"/>
              <text x={20} y={3} fontSize="8" fill="#374151">{l}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

// ── TEMPLATE LIBRARY ─────────────────────────────────────────────
// Pre-configured standard investment types for EE Zone Substation,
// Subtransmission and Comms work. Each template pre-populates the
// Investment Setup fields and seeds typical quantities into estimate lines.
const IET_TEMPLATES = [
  {
    id: "tmpl_3way_132",
    category: "Zone Substation",
    name: "132kV 3-Way Switching Station",
    description: "New greenfield 132kV outdoor switching station with 3 x 132kV circuit breaker bays, protection, SCADA and civil works.",
    estClass: "Class 5",
    type: "Commercially Funded",
    complexity: "High",
    icon: "⚡",
    tags: ["132kV", "Switching Station", "Greenfield", "3-Way"],
    inv: {
      name: "132kV 3-Way Switching Station",
      number: "",
      estClass: "Class 5",
      type: "Commercially Funded",
      complexity: "High",
      newTech: "No",
      planDur: "4",
      designDur: "9",
      constrDur: "15",
      designStart: "1",
      constrStart: "6",
      contingency: "20",
      startMonth: "Jul",
      startYear: "2025",
    },
    lines: {
      "3.1.1.01.2.01": { qty: "1", factor: "1" },   // Site mobilisation
      "3.1.1.14.2.02": { qty: "3", factor: "1" },   // CB Foundation 132kV x3
      "3.1.1.14.2.05": { qty: "6", factor: "1" },   // Disconnector Foundation 132kV x6
      "3.1.1.14.2.07": { qty: "3", factor: "1" },   // VT/CT Foundation 132kV x3
      "3.1.1.14.2.15": { qty: "4", factor: "1" },   // Bus Support Structure Foundation 132kV
      "3.1.1.12.1.02": { qty: "500", factor: "1" }, // Earthing conductor 95mm2
      "3.1.3.02.1.01": { qty: "3", factor: "1" },   // 132kV Live Tank CB x3
      "3.1.3.04.1.01": { qty: "6", factor: "1" },   // Disconnector 132kV x6
      "3.1.3.05.1.01": { qty: "3", factor: "1" },   // CT 132kV x3
      "3.1.3.06.1.01": { qty: "3", factor: "1" },   // VT 132kV x3
      "3.1.3.13.1.01": { qty: "150", factor: "1" }, // Aluminium Rigid Bus
      "3.1.3.19.1.01": { qty: "1", factor: "1" },   // Battery bank 110V
      "3.1.3.21.1.01": { qty: "1", factor: "1" },   // Marshalling cubicle
      "3.5.1.03.1.01": { qty: "1", factor: "1" },   // RTU cubicle
    },
  },
  {
    id: "tmpl_4way_132",
    category: "Zone Substation",
    name: "132kV 4-Way Switching Station",
    description: "New greenfield 132kV outdoor switching station with 4 x 132kV circuit breaker bays, protection, SCADA and civil works.",
    estClass: "Class 5",
    type: "Commercially Funded",
    complexity: "High",
    icon: "⚡",
    tags: ["132kV", "Switching Station", "Greenfield", "4-Way"],
    inv: {
      name: "132kV 4-Way Switching Station",
      number: "",
      estClass: "Class 5",
      type: "Commercially Funded",
      complexity: "High",
      newTech: "No",
      planDur: "4",
      designDur: "9",
      constrDur: "18",
      designStart: "1",
      constrStart: "6",
      contingency: "20",
      startMonth: "Jul",
      startYear: "2025",
    },
    lines: {
      "3.1.1.01.2.01": { qty: "1", factor: "1" },
      "3.1.1.14.2.02": { qty: "4", factor: "1" },   // CB Foundation 132kV x4
      "3.1.1.14.2.05": { qty: "8", factor: "1" },   // Disconnector Foundation 132kV x8
      "3.1.1.14.2.07": { qty: "4", factor: "1" },
      "3.1.1.14.2.15": { qty: "6", factor: "1" },
      "3.1.1.12.1.02": { qty: "650", factor: "1" },
      "3.1.3.02.1.01": { qty: "4", factor: "1" },   // 132kV CB x4
      "3.1.3.04.1.01": { qty: "8", factor: "1" },   // Disconnector 132kV x8
      "3.1.3.05.1.01": { qty: "4", factor: "1" },
      "3.1.3.06.1.01": { qty: "4", factor: "1" },
      "3.1.3.13.1.01": { qty: "200", factor: "1" },
      "3.1.3.19.1.01": { qty: "1", factor: "1" },
      "3.1.3.21.1.01": { qty: "2", factor: "1" },
      "3.5.1.03.1.01": { qty: "1", factor: "1" },
    },
  },
  {
    id: "tmpl_66kv_feeder",
    category: "Zone Substation",
    name: "Add 66kV Feeder to Existing Substation",
    description: "Addition of a new 66kV feeder bay to an existing zone substation, including CB, disconnectors, CT/VT, protection and SCADA modifications.",
    estClass: "Class 5",
    type: "Internally Funded",
    complexity: "Medium",
    icon: "🔌",
    tags: ["66kV", "Feeder", "Extension", "Zone Substation"],
    inv: {
      name: "Add 66kV Feeder Bay",
      number: "",
      estClass: "Class 5",
      type: "Internally Funded",
      complexity: "Medium",
      newTech: "No",
      planDur: "3",
      designDur: "6",
      constrDur: "9",
      designStart: "1",
      constrStart: "5",
      contingency: "15",
      startMonth: "Jul",
      startYear: "2025",
    },
    lines: {
      "3.1.1.14.2.01": { qty: "1", factor: "1" },   // CB Foundation 33~66kV
      "3.1.1.14.2.04": { qty: "2", factor: "1" },   // Disconnector Foundation 33~66kV x2
      "3.1.1.12.1.02": { qty: "100", factor: "1" }, // Earthing conductor
      "3.1.3.04.1.03": { qty: "2", factor: "1" },   // 66kV Disconnector x2
      "3.1.3.13.1.01": { qty: "50", factor: "1" },  // Aluminium Rigid Bus
      "3.1.3.19.1.01": { qty: "1", factor: "1" },   // Battery bank
      "3.5.1.03.1.01": { qty: "1", factor: "1" },   // RTU cubicle
    },
  },
  {
    id: "tmpl_132kv_feeder",
    category: "Zone Substation",
    name: "Add 132kV Feeder to Existing Substation",
    description: "Addition of a new 132kV feeder bay to an existing zone substation, including CB, disconnectors, CT/VT, foundations, protection and SCADA modifications.",
    estClass: "Class 5",
    type: "Internally Funded",
    complexity: "Medium",
    icon: "🔌",
    tags: ["132kV", "Feeder", "Extension", "Zone Substation"],
    inv: {
      name: "Add 132kV Feeder Bay",
      number: "",
      estClass: "Class 5",
      type: "Internally Funded",
      complexity: "Medium",
      newTech: "No",
      planDur: "3",
      designDur: "7",
      constrDur: "10",
      designStart: "1",
      constrStart: "5",
      contingency: "15",
      startMonth: "Jul",
      startYear: "2025",
    },
    lines: {
      "3.1.1.14.2.02": { qty: "1", factor: "1" },
      "3.1.1.14.2.05": { qty: "2", factor: "1" },
      "3.1.1.14.2.07": { qty: "1", factor: "1" },
      "3.1.1.12.1.02": { qty: "150", factor: "1" },
      "3.1.3.02.1.01": { qty: "1", factor: "1" },   // 132kV CB
      "3.1.3.04.1.01": { qty: "2", factor: "1" },   // 132kV Disconnector x2
      "3.1.3.05.1.01": { qty: "1", factor: "1" },   // CT 132kV
      "3.1.3.06.1.01": { qty: "1", factor: "1" },   // VT 132kV
      "3.1.3.13.1.01": { qty: "60", factor: "1" },
      "3.5.1.03.1.01": { qty: "1", factor: "1" },
    },
  },
  {
    id: "tmpl_power_transformer",
    category: "Zone Substation",
    name: "Replace / Install Power Transformer",
    description: "Supply and install of a new 132/33kV or 66/11kV power transformer including bund, earthing, oil containment and SCADA integration.",
    estClass: "Class 5",
    type: "Internally Funded",
    complexity: "Medium",
    icon: "🔄",
    tags: ["Transformer", "132kV", "66kV", "Replacement"],
    inv: {
      name: "Power Transformer Replacement",
      number: "",
      estClass: "Class 5",
      type: "Internally Funded",
      complexity: "Medium",
      newTech: "No",
      planDur: "3",
      designDur: "6",
      constrDur: "9",
      designStart: "1",
      constrStart: "5",
      contingency: "15",
      startMonth: "Jul",
      startYear: "2025",
    },
    lines: {
      "3.1.1.14.2.11": { qty: "1", factor: "1" },   // Transformer bund foundation ≤16MVA
      "3.1.1.14.2.18": { qty: "1", factor: "1" },   // FI Plant bund and foundation
      "3.1.1.12.1.16": { qty: "1", factor: "1" },   // Transformer earthing (new)
      "3.1.3.07.1.01": { qty: "1", factor: "1" },   // Power transformer ≤8MVA
      "3.5.1.03.1.01": { qty: "1", factor: "1" },   // RTU cubicle
    },
  },
  {
    id: "tmpl_protection_upgrade",
    category: "Zone Substation",
    name: "Protection & Control Upgrade",
    description: "Upgrade of protection relays, marshalling cubicles and control wiring at an existing zone substation bay.",
    estClass: "Class 5",
    type: "Internally Funded",
    complexity: "Medium",
    icon: "🛡️",
    tags: ["Protection", "Control", "Upgrade", "Zone Substation"],
    inv: {
      name: "Protection & Control Upgrade",
      number: "",
      estClass: "Class 5",
      type: "Internally Funded",
      complexity: "Medium",
      newTech: "No",
      planDur: "3",
      designDur: "6",
      constrDur: "6",
      designStart: "1",
      constrStart: "5",
      contingency: "15",
      startMonth: "Jul",
      startYear: "2025",
    },
    lines: {
      "3.1.3.20.1.01": { qty: "1", factor: "1" },   // Arc flash protection
      "3.1.3.21.1.01": { qty: "2", factor: "1" },   // Marshalling cubicle x2
      "3.5.1.03.1.01": { qty: "1", factor: "1" },   // RTU cubicle
    },
  },
  {
    id: "tmpl_battery_replacement",
    category: "Zone Substation",
    name: "DC Battery System Replacement",
    description: "Replacement of 110V DC NiCd battery bank and charger at an existing zone substation.",
    estClass: "Class 5",
    type: "Internally Funded",
    complexity: "Low",
    icon: "🔋",
    tags: ["Battery", "DC", "Replacement", "Zone Substation"],
    inv: {
      name: "DC Battery System Replacement",
      number: "",
      estClass: "Class 5",
      type: "Internally Funded",
      complexity: "Low",
      newTech: "No",
      planDur: "2",
      designDur: "3",
      constrDur: "3",
      designStart: "1",
      constrStart: "4",
      contingency: "10",
      startMonth: "Jul",
      startYear: "2025",
    },
    lines: {
      "3.1.3.19.1.01": { qty: "1", factor: "1" },   // Battery bank 110V NiCd
    },
  },
  {
    id: "tmpl_scada_upgrade",
    category: "SCADA & Comms",
    name: "SCADA RTU Upgrade",
    description: "Replacement of existing SCADA RTU cubicle and associated configuration, testing and commissioning at a zone substation.",
    estClass: "Class 5",
    type: "Internally Funded",
    complexity: "Low",
    icon: "📡",
    tags: ["SCADA", "RTU", "Upgrade"],
    inv: {
      name: "SCADA RTU Upgrade",
      number: "",
      estClass: "Class 5",
      type: "Internally Funded",
      complexity: "Low",
      newTech: "No",
      planDur: "2",
      designDur: "4",
      constrDur: "4",
      designStart: "1",
      constrStart: "4",
      contingency: "10",
      startMonth: "Jul",
      startYear: "2025",
    },
    lines: {
      "3.5.1.03.1.01": { qty: "1", factor: "1" },   // RTU cubicle
      "3.5.1.02.1.01": { qty: "1", factor: "1" },   // Metering/PQM Panel
    },
  },
  {
    id: "tmpl_sm_cable",
    category: "Subtransmission Mains",
    name: "Subtransmission Cable — Underground",
    description: "Installation of underground subtransmission cable route including trenching, conduit, cable and terminations.",
    estClass: "Class 5",
    type: "Commercially Funded",
    complexity: "Medium",
    icon: "🔶",
    tags: ["Subtransmission", "Cable", "Underground"],
    inv: {
      name: "Subtransmission Underground Cable",
      number: "",
      estClass: "Class 5",
      type: "Commercially Funded",
      complexity: "Medium",
      newTech: "No",
      planDur: "3",
      designDur: "6",
      constrDur: "9",
      designStart: "1",
      constrStart: "5",
      contingency: "20",
      startMonth: "Jul",
      startYear: "2025",
    },
    lines: {
      "3.3.1.05.1.01": { qty: "500", factor: "1" }, // ≥66kV Cable
      "3.3.1.06.1.01": { qty: "2", factor: "1" },   // 132kV cable terminations
      "3.1.1.16.2.01": { qty: "200", factor: "1" }, // 50mm HD conduit
    },
  },
];

const CATEGORY_COLORS = {
  "Zone Substation":      "bg-blue-100 text-blue-700 border border-blue-200",
  "Subtransmission Mains":"bg-orange-100 text-orange-700 border border-orange-200",
  "SCADA & Comms":        "bg-purple-100 text-purple-700 border border-purple-200",
  "Distribution":         "bg-green-100 text-green-700 border border-green-200",
};
const COMPLEXITY_DOT = { "High":"bg-red-400", "Medium":"bg-yellow-400", "Low":"bg-green-400" };

function TemplateLibrary({ onLoad, saved, setSaved }) {
  const [search,      setSearch]      = useState("");
  const [catFilter,   setCatFilter]   = useState("All");
  const [selected,    setSelected]    = useState(null);
  const [customName,  setCustomName]  = useState("");
  const [customNum,   setCustomNum]   = useState("");
  const [customClass, setCustomClass] = useState("");
  const [customType,  setCustomType]  = useState("");

  const categories = ["All", ...Array.from(new Set(IET_TEMPLATES.map(t=>t.category)))];

  const filtered = IET_TEMPLATES.filter(t => {
    const ms = !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.description.toLowerCase().includes(search.toLowerCase()) ||
      t.tags.some(tag=>tag.toLowerCase().includes(search.toLowerCase()));
    const cs = catFilter==="All" || t.category===catFilter;
    return ms && cs;
  });

  const openTemplate = (tmpl) => {
    const inv = {
      ...tmpl.inv,
      name:     customName  || tmpl.inv.name,
      number:   customNum   || "",
      estClass: customClass || tmpl.inv.estClass,
      type:     customType  || tmpl.inv.type,
    };
    const saveObj = {
      id:         `inv_${Date.now()}`,
      inv,
      lines:      tmpl.lines,
      status:     "Draft",
      totalEE:    0,
      totalComm:  0,
      linesCount: Object.keys(tmpl.lines).length,
      totalSupplyLines: Object.keys(tmpl.lines).length,
      savedAt:    new Date().toLocaleString("en-AU",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}),
      savedAtISO: new Date().toISOString(),
      _fromTemplate: tmpl.id,
    };
    onLoad(saveObj);
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left — template list */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-shrink-0">
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search templates…"
            className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"/>
          <div className="flex border border-gray-200 rounded overflow-hidden">
            {categories.map(c=>(
              <button key={c} onClick={()=>setCatFilter(c)}
                className={`text-xs px-2.5 py-1 transition-colors ${catFilter===c?"bg-blue-700 text-white":"text-gray-600 hover:bg-gray-50"}`}>{c}</button>
            ))}
          </div>
          <span className="text-xs text-gray-400">{filtered.length} templates</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 gap-3">
          {filtered.map(tmpl=>(
            <div key={tmpl.id}
              onClick={()=>{ setSelected(tmpl); setCustomName(tmpl.inv.name); setCustomNum(""); setCustomClass(tmpl.inv.estClass); setCustomType(tmpl.inv.type); }}
              className={`bg-white rounded-lg border-2 p-4 cursor-pointer transition-all ${selected?.id===tmpl.id?"border-blue-500 shadow-md":"border-gray-200 hover:border-blue-300 hover:shadow-sm"}`}>
              <div className="flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">{tmpl.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-gray-900 text-sm">{tmpl.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${CATEGORY_COLORS[tmpl.category]||"bg-gray-100 text-gray-500"}`}>{tmpl.category}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${CLASS_COLOR[tmpl.estClass]||"bg-gray-100 text-gray-500"}`}>{tmpl.inv.estClass}</span>
                    <span className="flex items-center gap-1 text-[10px] text-gray-500">
                      <span className={`w-1.5 h-1.5 rounded-full ${COMPLEXITY_DOT[tmpl.complexity]||"bg-gray-300"}`}/>
                      {tmpl.complexity} complexity
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{tmpl.description}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {tmpl.tags.map(tag=>(
                      <span key={tag} className="text-[10px] bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">{tag}</span>
                    ))}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-2">
                    {Object.keys(tmpl.lines).length} pre-populated scope lines · {tmpl.inv.planDur}m plan · {tmpl.inv.designDur}m design · {tmpl.inv.constrDur}m construction
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right — detail + customise panel */}
      {selected && (
        <div className="w-80 bg-white border-l flex flex-col overflow-hidden flex-shrink-0">
          <div className="bg-[#1e3a5f] text-white px-4 py-3 flex items-start justify-between flex-shrink-0">
            <div>
              <div className="font-bold text-sm leading-tight">{selected.name}</div>
              <div className="text-blue-300 text-xs mt-0.5">{selected.category}</div>
            </div>
            <button onClick={()=>setSelected(null)} className="text-blue-400 hover:text-white text-sm ml-2">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <div className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">Customise Before Opening</div>
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Investment Name</label>
                  <input value={customName} onChange={e=>setCustomName(e.target.value)}
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"/>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Investment Number</label>
                  <input value={customNum} onChange={e=>setCustomNum(e.target.value)}
                    placeholder="e.g. 10012345"
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"/>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500 block mb-0.5">Estimate Class</label>
                    <select value={customClass} onChange={e=>setCustomClass(e.target.value)}
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none">
                      {["Class 5","Class 4","Class 3","Class 2","Class 1"].map(c=><option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-0.5">Funding Type</label>
                    <select value={customType} onChange={e=>setCustomType(e.target.value)}
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none">
                      <option>Commercially Funded</option>
                      <option>Internally Funded</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">Pre-populated Scope</div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {Object.entries(selected.lines).map(([wbs, ln])=>(
                  <div key={wbs} className="flex items-center justify-between text-xs py-1 border-b border-gray-50">
                    <span className="font-mono text-gray-500 text-[10px]">{wbs}</span>
                    <span className="text-gray-700 font-semibold">Qty: {ln.qty}</span>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-gray-400 mt-2">All quantities are indicative and should be reviewed before estimating.</div>
            </div>

            <div>
              <div className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">Default Timeline</div>
              <div className="grid grid-cols-3 gap-1 text-center">
                {[["Planning",selected.inv.planDur+"m"],["Design",selected.inv.designDur+"m"],["Construction",selected.inv.constrDur+"m"]].map(([label,val])=>(
                  <div key={label} className="bg-gray-50 rounded p-2">
                    <div className="text-[10px] text-gray-400">{label}</div>
                    <div className="text-sm font-bold text-gray-700">{val}</div>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-gray-400 mt-1 text-center">Contingency: {selected.inv.contingency}%</div>
            </div>
          </div>

          <div className="border-t p-3 flex-shrink-0">
            <button onClick={()=>openTemplate(selected)}
              className="w-full bg-blue-700 hover:bg-blue-600 text-white text-sm py-2.5 rounded-lg font-bold flex items-center justify-center gap-2">
              {selected.icon} Open Template as New Estimate
            </button>
            <div className="text-[10px] text-gray-400 text-center mt-1.5">Opens in Estimation Tool · Save when ready to add to Portfolio</div>
          </div>
        </div>
      )}
    </div>
  );
}

function InvestmentHub({ onLoad, onNew, currentInv, currentLines }) {
  const [hubTab,      setHubTab]      = useState("portfolio");
  const [saved,       setSaved]       = useState([]);
  const [search,      setSearch]      = useState("");
  const [statusFilter,setStatusFilter]= useState("All");
  const [classFilter, setClassFilter] = useState("All");
  const [typeFilter,  setTypeFilter]  = useState("All");
  const [sortBy,      setSortBy]      = useState("savedAt");
  const [sortDir,     setSortDir]     = useState("desc");
  const [selected,    setSelected]    = useState(null);
  const [editStatus,  setEditStatus]  = useState(null); // id of investment being status-edited
  const [deleteModal, setDeleteModal] = useState(null); // { stage:1|2|3, inv:savedRecord }
  const [deleteRole,  setDeleteRole]  = useState(null); // "Senior Estimator"|"Manager"
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const DELETE_ROLES = ["Senior Estimator", "Lead Estimator", "Manager"];
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneSource,    setCloneSource]    = useState(null);
  const [cloneClass,     setCloneClass]     = useState("Class 4");
  const [cloneStatus,    setCloneStatus]    = useState("Draft");
  const [showImport,     setShowImport]     = useState(false);
  const [importText,     setImportText]     = useState("");
  const [importError,    setImportError]    = useState("");
  const [importPreview,  setImportPreview]  = useState(null);

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
  const startDelete = (s, e) => {
    if (e) e.stopPropagation();
    setDeleteModal({ stage:1, inv:s });
    setDeleteRole(null);
    setDeleteConfirmText("");
  };
  const confirmDelete = () => {
    if (!deleteModal?.inv) return;
    del(deleteModal.inv.id);
    setDeleteModal(null); setDeleteRole(null); setDeleteConfirmText("");
  };

  // Clone an investment — creates a new record with a new class, preserving all lines
  // Records cloned_from_id lineage for tracking Class 5→4→3→2 progression
  const CLASS_ORDER = ["Class 5","Class 4","Class 3","Class 2","Class 1"];
  const cloneInvestment = () => {
    if (!cloneSource) return;
    const newId = `inv_${Date.now()}`;
    const promoted = {
      ...cloneSource,
      id: newId,
      savedAt: new Date().toLocaleString("en-AU",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}),
      savedAtISO: new Date().toISOString(),
      status: cloneStatus,
      cloned_from_id: cloneSource.id,
      cloned_from_class: cloneSource.inv.estClass,
      inv: { ...cloneSource.inv, estClass: cloneClass },
    };
    const updated = [...saved, promoted];
    setSaved(updated);
    localStorage.setItem("iet_investments", JSON.stringify(updated));
    setShowCloneModal(false);
    setCloneSource(null);
    setSelected(promoted);
  };

  // Parse imported JSON — accepts a raw IET save blob or minimal JSON
  const parseImport = (text) => {
    setImportError("");
    setImportPreview(null);
    try {
      const raw = JSON.parse(text.trim());
      // Accept either a single save object or an array
      const obj = Array.isArray(raw) ? raw[0] : raw;
      if (!obj || !obj.inv) { setImportError("JSON must contain an 'inv' object with investment details."); return; }
      setImportPreview(obj);
    } catch(e) {
      setImportError("Invalid JSON — paste the full contents of a saved IET export file.");
    }
  };

  const confirmImport = () => {
    if (!importPreview) return;
    const newId = `inv_${Date.now()}`;
    const imported = {
      ...importPreview,
      id: newId,
      savedAt: new Date().toLocaleString("en-AU",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}),
      savedAtISO: new Date().toISOString(),
      status: importPreview.status || "Draft",
      _imported: true,
    };
    const updated = [...saved, imported];
    setSaved(updated);
    localStorage.setItem("iet_investments", JSON.stringify(updated));
    setShowImport(false);
    setImportText("");
    setImportPreview(null);
    setSelected(imported);
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
    <div className="flex flex-col flex-1 overflow-hidden bg-gray-50">

      {/* Hub Tab Bar */}
      <div className="bg-white border-b flex items-center px-4 gap-1 flex-shrink-0">
        {[
          {id:"portfolio", label:"📋 Portfolio"},
          {id:"templates", label:"🏗️ Template Library"},
          {id:"split",     label:"💰 Contribution Split"},
        ].map(t=>(
          <button key={t.id} onClick={()=>setHubTab(t.id)}
            className={`text-xs px-4 py-2.5 font-semibold border-b-2 transition-colors ${hubTab===t.id?"border-blue-700 text-blue-700":"border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t.label}
          </button>
        ))}
        <div className="flex-1"/>
        <button onClick={()=>setShowImport(true)}
          className="border border-gray-300 text-gray-600 hover:bg-gray-50 text-xs px-3 py-1.5 rounded font-semibold flex items-center gap-1.5 my-1.5">
          📥 Import Estimate
        </button>
        <button onClick={onNew}
          className="bg-orange-600 hover:bg-orange-500 text-white text-xs px-4 py-1.5 rounded font-bold flex items-center gap-1.5 shadow my-1.5 ml-2">
          ＋ New Estimate
        </button>
      </div>

      {/* Template Library tab */}
      {hubTab==="templates" && <TemplateLibrary onLoad={onLoad} saved={saved} setSaved={setSaved}/>}

      {/* Contribution Split tab */}
      {hubTab==="split" && <ContributionSplitTab saved={saved} setSaved={setSaved}/>}

      {/* Portfolio tab */}
      {hubTab==="portfolio" && <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header bar */}
        <div className="bg-white border-b px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <div>
            <div className="text-base font-bold text-gray-900">Investment Portfolio</div>
            <div className="text-xs text-gray-400">{filtered.length} of {saved.length} investments · Portfolio: {fmt(portTotals.comm)} commercial · {fmt(portTotals.ee)} EE internal</div>
          </div>
          <div className="flex-1"/>
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
                      <td className="px-3 py-2 text-right font-bold text-blue-800">{fmt(s.totalEE)}</td>
                      <td className="px-3 py-2 text-right font-bold text-orange-700">{fmt(s.totalComm)}</td>
                      <td className="px-3 py-2 text-right text-gray-400 whitespace-nowrap">{s.savedAt}</td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex gap-1 justify-center" onClick={e=>e.stopPropagation()}>
                          <button onClick={()=>onLoad(s)}
                            className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-2 py-1 rounded font-semibold">Open</button>
                          <button onClick={(e)=>startDelete(s,e)}
                            className="text-xs border border-red-200 text-red-400 hover:bg-red-50 px-1.5 py-1 rounded" title="Delete investment (requires authorisation)">🗑</button>
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



            {/* Clone Lineage */}
            {(selected.cloned_from_id || saved.some(s=>s.cloned_from_id===selected.id)) && (
              <div className="px-3 py-3 border-b">
                <div className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">Estimate Lineage</div>
                {selected.cloned_from_id && (()=>{
                  const parent = saved.find(s=>s.id===selected.cloned_from_id);
                  return <div className="flex items-center gap-2 text-xs mb-1.5">
                    <span className="text-gray-400">Promoted from</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${CLASS_COLOR[selected.cloned_from_class]||"bg-gray-100 text-gray-500"}`}>{selected.cloned_from_class}</span>
                    {parent && <span className="text-gray-600 font-semibold truncate max-w-[120px]">{parent.inv.name}</span>}
                  </div>;
                })()}
                {saved.filter(s=>s.cloned_from_id===selected.id).map(child=>(
                  <div key={child.id} className="flex items-center gap-2 text-xs mt-1">
                    <span className="text-gray-400">↳ Promoted to</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${CLASS_COLOR[child.inv.estClass]||"bg-gray-100 text-gray-500"}`}>{child.inv.estClass}</span>
                    <span className="text-gray-600 font-semibold truncate max-w-[100px]">{child.inv.name}</span>
                    <button onClick={()=>setSelected(child)} className="ml-auto text-blue-600 hover:underline text-[10px]">View</button>
                  </div>
                ))}
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
            <button onClick={()=>{setCloneSource(selected);const idx=CLASS_ORDER.indexOf(selected.inv.estClass);setCloneClass(idx>0?CLASS_ORDER[idx-1]:"Class 4");setShowCloneModal(true);}}
              className="w-full bg-purple-700 hover:bg-purple-600 text-white text-xs py-2 rounded font-semibold">
              🔁 Clone / Promote Estimate Class
            </button>
            <div className="flex gap-2">
              <button onClick={()=>exportPDF(selected)}
                className="flex-1 border border-gray-200 text-gray-600 text-xs py-1.5 rounded hover:bg-gray-50 hover:border-blue-400">📄 Export PDF</button>
              <button className="flex-1 border border-gray-200 text-gray-600 text-xs py-1.5 rounded hover:bg-gray-50">☁️ Copperleaf</button>
              <button onClick={(e)=>startDelete(selected,e)}
                className="border border-red-200 text-red-500 text-xs px-2 py-1.5 rounded hover:bg-red-50 flex items-center gap-1" title="Delete investment">🗑 Delete</button>
            </div>
          </div>
        </div>
      )}
      </div>}{/* end portfolio tab */}

      {/* ── DELETE INVESTMENT MODAL — 3-stage role-locked ── */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background:"rgba(0,0,0,0.55)"}}>
          <div className="bg-white rounded-xl shadow-2xl w-[460px] overflow-hidden">
            {/* Stage 1: Role selection */}
            {deleteModal.stage===1 && (
              <>
                <div className="bg-red-700 text-white px-5 py-4">
                  <div className="text-sm font-bold">🔒 Authorisation Required</div>
                  <div className="text-xs text-red-200 mt-1">Only Senior Estimators, Lead Estimators, or Managers may delete investments.</div>
                </div>
                <div className="p-5">
                  <div className="text-xs text-gray-500 mb-1 font-semibold">Investment to delete</div>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-4">
                    <div className="text-sm font-bold text-gray-800">{deleteModal.inv?.inv?.name||"Unnamed"}</div>
                    <div className="text-xs text-gray-400 font-mono">{deleteModal.inv?.inv?.number} · {deleteModal.inv?.inv?.estClass} · {deleteModal.inv?.status||"Draft"}</div>
                  </div>
                  <div className="text-xs text-gray-600 font-semibold mb-2">Select your role to proceed</div>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {DELETE_ROLES.map(r=>(
                      <button key={r} onClick={()=>setDeleteRole(r)}
                        className={`text-xs py-2.5 rounded border font-semibold transition-colors ${deleteRole===r?"bg-red-700 text-white border-red-700":"border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
                        {r}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={()=>{setDeleteModal(null);setDeleteRole(null);}} className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
                    <button onClick={()=>setDeleteModal(m=>({...m,stage:2}))} disabled={!deleteRole}
                      className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white rounded px-3 py-1.5 text-xs font-semibold">Continue →</button>
                  </div>
                </div>
              </>
            )}
            {/* Stage 2: Warning + type DELETE */}
            {deleteModal.stage===2 && (
              <>
                <div className="bg-red-700 text-white px-5 py-4">
                  <div className="text-sm font-bold">⚠️ Confirm Permanent Deletion</div>
                  <div className="text-xs text-red-200 mt-1">Acting as: {deleteRole}</div>
                </div>
                <div className="p-5">
                  <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-xs text-red-800 mb-4">
                    <div className="font-bold mb-1">This action cannot be undone.</div>
                    <div>Deleting <strong>{deleteModal.inv?.inv?.name}</strong> will permanently remove all estimate lines, phase breakdowns, and saved data for this investment.</div>
                  </div>
                  <div className="text-xs text-gray-600 font-semibold mb-1.5">Type DELETE to confirm</div>
                  <input autoFocus value={deleteConfirmText} onChange={e=>setDeleteConfirmText(e.target.value)}
                    placeholder='Type DELETE here'
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-400 mb-4"/>
                  <div className="flex gap-2">
                    <button onClick={()=>setDeleteModal(m=>({...m,stage:1}))} className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">← Back</button>
                    <button onClick={confirmDelete} disabled={deleteConfirmText!=="DELETE"}
                      className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white rounded px-3 py-1.5 text-xs font-bold">
                      🗑 Delete Investment
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── CLONE / PROMOTE MODAL ── */}
      {showCloneModal && cloneSource && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={()=>setShowCloneModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-[440px]" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">🔁</span>
              <div>
                <div className="font-bold text-gray-900">Clone & Promote Estimate</div>
                <div className="text-xs text-gray-500">Creates a new estimate at the promoted class, preserving all lines. The source is kept as-is.</div>
              </div>
            </div>

            {/* Source summary */}
            <div className="bg-gray-50 rounded-lg p-3 mb-4 border border-gray-200">
              <div className="text-xs text-gray-500 mb-1">Source estimate</div>
              <div className="font-semibold text-gray-800">{cloneSource.inv.name}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${CLASS_COLOR[cloneSource.inv.estClass]||""}`}>{cloneSource.inv.estClass}</span>
                <span className="text-xs text-gray-400">{cloneSource.inv.number}</span>
                <span className="text-xs text-gray-400">·</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_CFG[cloneSource.status||"Draft"]?.bg} ${STATUS_CFG[cloneSource.status||"Draft"]?.text}`}>{cloneSource.status||"Draft"}</span>
              </div>
            </div>

            {/* Arrow */}
            <div className="text-center text-gray-400 text-lg mb-4">↓ promote to</div>

            {/* Target class + status */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <label className="text-xs text-gray-500 block mb-1">New Estimate Class</label>
                <select value={cloneClass} onChange={e=>setCloneClass(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-400">
                  {CLASS_ORDER.map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Initial Status</label>
                <select value={cloneStatus} onChange={e=>setCloneStatus(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-400">
                  {["Draft","In Review","Approved","On Hold"].map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="text-xs text-gray-400 bg-blue-50 border border-blue-100 rounded p-2 mb-4">
              💡 All estimate lines, quantities, factors and costs are copied exactly. The clone is linked back to this source — the lineage chain is visible in the detail panel.
            </div>

            <div className="flex gap-3">
              <button onClick={()=>setShowCloneModal(false)}
                className="flex-1 border border-gray-200 text-gray-600 text-sm py-2 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={cloneInvestment}
                className="flex-1 bg-purple-700 hover:bg-purple-600 text-white text-sm py-2 rounded-lg font-bold">
                🔁 Clone to {cloneClass}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── IMPORT / UPGRADE MODAL ── */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={()=>{setShowImport(false);setImportText("");setImportPreview(null);setImportError("");}}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-[560px]" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">📥</span>
              <div>
                <div className="font-bold text-gray-900">Import Existing Estimate</div>
                <div className="text-xs text-gray-500">Paste the JSON export from a previously saved IET estimate to bring it into the Investment Hub.</div>
              </div>
            </div>

            {!importPreview ? (
              <>
                <div className="mb-3">
                  <label className="text-xs text-gray-500 block mb-1">Paste saved estimate JSON</label>
                  <textarea
                    value={importText}
                    onChange={e=>{ setImportText(e.target.value); if(e.target.value.trim()) parseImport(e.target.value); else { setImportError(""); setImportPreview(null); }}}
                    placeholder='{ "inv": { "name": "My Investment", "number": "10012345", ... }, "lines": { ... } }' 
                    rows={10}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"/>
                </div>
                {importError && (
                  <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">⚠ {importError}</div>
                )}
                <div className="text-xs text-gray-400 bg-amber-50 border border-amber-100 rounded p-2 mb-4">
                  💡 To export a saved estimate: open it from the Investment Hub → Save tab, then use your browser's developer tools or the app's export function to copy the JSON. In the full Power Platform build this will connect directly to Dataverse.
                </div>
                <div className="flex gap-3">
                  <button onClick={()=>{setShowImport(false);setImportText("");setImportError("");}}
                    className="flex-1 border border-gray-200 text-gray-600 text-sm py-2 rounded-lg hover:bg-gray-50">Cancel</button>
                  <button onClick={()=>parseImport(importText)} disabled={!importText.trim()}
                    className="flex-1 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-300 text-white text-sm py-2 rounded-lg font-bold">
                    Validate JSON →
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                  <div className="text-xs font-bold text-green-700 mb-2">✓ Valid estimate found</div>
                  {[
                    ["Investment Name",  importPreview.inv?.name||"—"],
                    ["Number",           importPreview.inv?.number||"—"],
                    ["Estimate Class",   importPreview.inv?.estClass||"—"],
                    ["Type",             importPreview.inv?.type||"—"],
                    ["Estimator",        importPreview.inv?.estimatedBy||"—"],
                    ["Lines",            importPreview.linesCount!=null ? `${importPreview.linesCount} entered` : "—"],
                    ["EE Internal",      importPreview.totalEE!=null ? fmt(importPreview.totalEE) : "—"],
                    ["Commercial",       importPreview.totalComm!=null ? fmt(importPreview.totalComm) : "—"],
                  ].map(([label,val])=>(
                    <div key={label} className="flex justify-between text-xs py-0.5">
                      <span className="text-gray-500">{label}</span>
                      <span className="font-semibold text-gray-800">{val}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-400 mb-4">The estimate will be added to your Investment Hub as a new entry. All existing estimates are unchanged.</div>
                <div className="flex gap-3">
                  <button onClick={()=>{ setImportPreview(null); }}
                    className="flex-1 border border-gray-200 text-gray-600 text-sm py-2 rounded-lg hover:bg-gray-50">← Back</button>
                  <button onClick={confirmImport}
                    className="flex-1 bg-green-700 hover:bg-green-600 text-white text-sm py-2 rounded-lg font-bold">
                    📥 Import to Hub
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── OLD SAVED INVESTMENTS (now replaced by hub) ──

// ── CONTRIBUTION SPLIT TAB ───────────────────────────────────────
// Reporting-only feature. Groups multiple saved investments under a
// parent programme. Each child investment has its OWN independent
// split method: Percentage | Capped | WBS Section | WBS Item.
// Programme bar aggregates all child resolved splits.
function ContributionSplitTab({ saved, setSaved }) {
  const { supply } = useData();
  const fmt  = (n) => `$${Math.round(n||0).toLocaleString("en-AU")}`;
  const pct  = (a,b) => b>0 ? Math.round(a/b*100) : 0;
  const EE_BLUE  = "#1e3a5f";
  const CUST_ORG = "#ea580c";

  // ID comparison: saved ids are numbers, select values are strings
  const findById = (invId) => saved.find(s=>String(s.id)===String(invId));

  // ── Programmes ────────────────────────────────────────────────
  const [programmes, setProgrammes] = useState(()=>{
    try{ return JSON.parse(localStorage.getItem("iet_programmes")||"[]"); }catch(e){ return []; }
  });
  const saveProgrammes = (p)=>{ setProgrammes(p); localStorage.setItem("iet_programmes",JSON.stringify(p)); };

  const [selectedProg, setSelectedProg] = useState(null);
  const [expandedChild, setExpandedChild] = useState(null); // invId of expanded child
  const [showNewProg, setShowNewProg]   = useState(false);
  const [newProgName, setNewProgName]   = useState("");
  const [newProgNum,  setNewProgNum]    = useState("");
  const [showAddInv,  setShowAddInv]    = useState(false);
  const [addInvRole,  setAddInvRole]    = useState("EE-funded");
  const [addInvId,    setAddInvId]      = useState("");
  const [expandedNodes, setExpandedNodes] = useState({});
  const toggleNode = (code)=>setExpandedNodes(e=>({...e,[code]:!e[code]}));

  const prog = programmes.find(p=>p.id===selectedProg)||null;

  // ── Helpers ──────────────────────────────────────────────────
  const getInvTotals = (invId)=>{
    const s = findById(invId);
    if(!s) return {ee:0,comm:0,name:"Unknown",type:"",number:"",estClass:"",status:"",revision:"",estimatedBy:"",reviewedBy:"",phaseBreakdown:{},savedAt:""};
    return {
      ee:s.totalEE||0, comm:s.totalComm||0,
      name:s.inv?.name||"Unnamed", number:s.inv?.number||"",
      type:s.inv?.type||"", estClass:s.inv?.estClass||"",
      status:s.status||"Draft", revision:s.inv?.revision||"",
      estimatedBy:s.inv?.estimatedBy||"", reviewedBy:s.inv?.reviewedBy||"",
      phaseBreakdown:s.phaseBreakdown||{}, savedAt:s.savedAt||"",
    };
  };

  // Resolve a single child's split → { eeSplit, custSplit, eePct, custPct, overCap, ritD }
  const resolveChildSplit = (child, totals)=>{
    const method  = child.splitMethod||"percentage";
    const base    = totals.comm>0 ? totals.comm : totals.ee;
    if(base<=0) return {eeSplit:0,custSplit:0,eePct:0,custPct:0,overCap:0,ritD:false};
    if(method==="percentage"){
      const eeP = parseFloat(child.eePct??25)/100;
      return {eeSplit:base*eeP,custSplit:base*(1-eeP),eePct:Math.round(eeP*100),custPct:Math.round((1-eeP)*100),overCap:0,ritD:false};
    }
    if(method==="capped"){
      const cap=parseFloat(child.eeCap||7000000);
      const eeSplit=Math.min(base,cap), custSplit=Math.max(0,base-cap);
      return {eeSplit,custSplit,eePct:pct(eeSplit,base),custPct:pct(custSplit,base),overCap:custSplit,ritD:custSplit>0};
    }
    if(method==="section"||method==="item"){
      // Sum tagged: lineTagging is per child, keyed by wbs_code (item) or l3 (section)
      const tagging=child.lineTagging||{};
      const rec=findById(child.invId);
      if(!rec) return {eeSplit:0,custSplit:0,eePct:0,custPct:0,overCap:0,ritD:false};
      const lines=rec.lines||{};
      const entered=supply.filter(s=>parseFloat(lines[s.wbs_code]?.qty||"0")>0);
      let eeAmt=0, custAmt=0, untagAmt=0;
      entered.forEach(item=>{
        const key=method==="section"?item.wbs_code.split(".").slice(0,3).join("."):item.wbs_code;
        const ln=lines[item.wbs_code]||{};
        // Use simple proportion of total based on qty — approximation for demo
        const tag=tagging[key];
        const share=1/entered.length*base;
        if(tag==="EE") eeAmt+=share;
        else if(tag==="Customer") custAmt+=share;
        else untagAmt+=share;
      });
      // Untagged defaults to Customer
      custAmt+=untagAmt;
      return {eeSplit:eeAmt,custSplit:custAmt,eePct:pct(eeAmt,base),custPct:pct(custAmt,base),overCap:0,ritD:false};
    }
    return {eeSplit:0,custSplit:0,eePct:0,custPct:0,overCap:0,ritD:false};
  };

  // Build full summary with per-child splits
  const getProgSummary = (p)=>{
    if(!p) return {totalEE:0,totalComm:0,totalEESplit:0,totalCustSplit:0,children:[]};
    const children=(p.children||[]).map(c=>{
      const t=getInvTotals(c.invId);
      const childSplit=resolveChildSplit(c,t);
      return {...c,...t,split:childSplit};
    });
    return {
      totalEE:children.reduce((a,c)=>a+c.ee,0),
      totalComm:children.reduce((a,c)=>a+c.comm,0),
      totalEESplit:children.reduce((a,c)=>a+c.split.eeSplit,0),
      totalCustSplit:children.reduce((a,c)=>a+c.split.custSplit,0),
      children,
    };
  };

  const summary = getProgSummary(prog);
  const progTotal = summary.totalEESplit+summary.totalCustSplit;
  const anyRitD   = summary.children.some(c=>c.split?.ritD);

  // ── Programme CRUD ────────────────────────────────────────────
  const updateProg = (updates)=>{
    const next=programmes.map(p=>p.id===selectedProg?{...p,...updates}:p);
    saveProgrammes(next);
  };
  // Update one child's attributes
  const updateChild = (invId, updates)=>{
    const children=(prog?.children||[]).map(c=>String(c.invId)===String(invId)?{...c,...updates}:c);
    updateProg({children});
  };
  const updateChildTagging = (invId, key, value)=>{
    const child=(prog?.children||[]).find(c=>String(c.invId)===String(invId));
    if(!child) return;
    const tagging={...child.lineTagging||{}};
    if(value===undefined) delete tagging[key]; else tagging[key]=value;
    updateChild(invId,{lineTagging:tagging});
  };

  const createProg = ()=>{
    if(!newProgName.trim()) return;
    const np={id:`prog_${Date.now()}`,name:newProgName.trim(),number:newProgNum.trim(),
      createdAt:new Date().toLocaleString("en-AU",{day:"2-digit",month:"short",year:"numeric"}),
      children:[]};
    const next=[...programmes,np];
    saveProgrammes(next); setSelectedProg(np.id);
    setShowNewProg(false); setNewProgName(""); setNewProgNum("");
  };
  const deleteProg = (id)=>{ saveProgrammes(programmes.filter(p=>p.id!==id)); if(selectedProg===id) setSelectedProg(null); };
  const addChildInv = ()=>{
    if(!addInvId||!prog) return;
    const sId=String(addInvId);
    if((prog.children||[]).find(c=>String(c.invId)===sId)){setShowAddInv(false);return;}
    updateProg({children:[...(prog.children||[]),{invId:sId,role:addInvRole,splitMethod:"percentage",eePct:25,eeCap:7000000,lineTagging:{}}]});
    setShowAddInv(false); setAddInvId(""); setExpandedChild(sId);
  };
  const removeChild = (invId)=>{
    updateProg({children:(prog.children||[]).filter(c=>String(c.invId)!==String(invId))});
    if(expandedChild===String(invId)) setExpandedChild(null);
  };

  const availableInvs=saved.filter(s=>!(prog?.children||[]).find(c=>String(c.invId)===String(s.id)));

  const METHOD_LABELS={percentage:"% Percentage",capped:"Capped ($7M)",section:"WBS Section",item:"WBS Item"};
  const METHOD_DESCS ={percentage:"Flat EE/Customer percentage ratio",capped:"EE capped at dollar amount; over-cap → Customer",section:"Tag whole WBS L3 sections to a funder",item:"Tag individual estimate line items to a funder"};

  // Build tag groups for a specific child
  const buildTagGroups = (child)=>{
    const rec=findById(child.invId);
    if(!rec) return [];
    const lines=rec.lines||{};
    const method=child.splitMethod;
    const entered=supply.filter(s=>parseFloat(lines[s.wbs_code]?.qty||"0")>0);
    const groupMap={};
    const seen=new Set();
    entered.forEach(item=>{
      const key=method==="section"?item.wbs_code.split(".").slice(0,3).join("."):item.wbs_code;
      const gk=item.wbs_code.split(".").slice(0,2).join(".");
      if(!seen.has(key)){
        seen.add(key);
        if(!groupMap[gk]) groupMap[gk]={label:gk,items:[]};
        groupMap[gk].items.push({key,label:item.description||key,l1:item.wbs_code.split(".")[0],l2:gk});
      }
    });
    return Object.entries(groupMap).sort(([a],[b])=>a.localeCompare(b));
  };

  // ── Report generator ─────────────────────────────────────────
  const generateReport = ()=>{
    if(!prog||!summary.children.length) return;
    const PHASE_NAMES={"1":"Planning","2":"Design","3":"Construction","4":"Commissioning","5":"M&C"};
    const fmtD=(n)=>`$${Math.round(n||0).toLocaleString("en-AU")}`;
    const fmtP=(n)=>`${Math.round(n||0)}%`;
    const pctOf=(a,b)=>b>0?Math.round(a/b*100):0;
    const methodLabel={percentage:"Percentage Split",capped:"Capped EE Contribution",section:"WBS Section Attribution",item:"WBS Item Attribution"};

    const invRows=summary.children.map(c=>{
      const pb=c.phaseBreakdown||{};
      const phaseRows=Object.entries(pb).sort().map(([ph,p])=>`
        <tr><td style="padding:5px 10px;color:#374151">Phase ${ph} — ${PHASE_NAMES[ph]||ph}</td>
        <td style="padding:5px 10px;text-align:right;color:#1e40af">${fmtD(p.eeInt)}</td>
        <td style="padding:5px 10px;text-align:right;color:#c2410c">${fmtD(p.comm)}</td>
        <td style="padding:5px 10px;text-align:right">${Math.round(p.installHrs||0).toLocaleString()} hrs</td></tr>`).join("");
      const rc=c.role==="EE-funded"?"#1e3a5f":c.role==="Customer-funded"?"#ea580c":"#6b7280";
      const ml=methodLabel[c.splitMethod||"percentage"]||"Percentage Split";
      return `
      <div class="inv-block">
        <div class="inv-header">
          <div><div class="inv-name">${c.name}</div>
            <div class="inv-meta">${c.number} · ${c.type==="Commercially Funded"?"Commercial (ANS)":"EE Internal"} · ${c.estClass} Rev ${c.revision||"1"}</div>
            <div class="inv-meta">Estimator: ${c.estimatedBy||"—"} · Reviewer: ${c.reviewedBy||"—"} · Status: ${c.status}</div>
            <div class="inv-meta" style="margin-top:2px"><strong>Attribution method:</strong> ${ml}</div>
          </div>
          <div class="role-badge" style="background:${rc}20;color:${rc};border:1px solid ${rc}40">${c.role}</div>
        </div>
        <div class="split-row">
          <div class="sbox ee"><div class="slabel">EE Funded</div><div class="sval">${fmtD(c.split.eeSplit)}</div><div class="slabel">${fmtP(c.split.eePct)} of total</div></div>
          <div class="sbox cu"><div class="slabel">Customer Funded</div><div class="sval">${fmtD(c.split.custSplit)}</div><div class="slabel">${fmtP(c.split.custPct)} of total</div></div>
          <div class="sbox"><div class="slabel">EE Internal Total</div><div class="sval" style="color:#1e3a5f">${fmtD(c.ee)}</div></div>
          <div class="sbox"><div class="slabel">Commercial Total</div><div class="sval" style="color:#ea580c">${fmtD(c.comm)}</div></div>
        </div>
        <div class="bar-wrap"><div class="bar-fill" style="width:${c.split.eePct}%;background:#1e3a5f"></div><div class="bar-fill" style="width:${c.split.custPct}%;background:#ea580c"></div></div>
        ${c.split.ritD?`<div class="rit">⚠️ EE contribution exceeds $7M cap by ${fmtD(c.split.overCap)}. RIT-D required.</div>`:""}
        ${Object.keys(pb).length>0?`<table style="width:100%;border-collapse:collapse;margin:10px 0;font-size:11px">
          <thead><tr style="background:#1e3a5f;color:#fff">
            <th style="text-align:left;padding:5px 10px">Phase</th>
            <th style="text-align:right;padding:5px 10px">EE Internal</th>
            <th style="text-align:right;padding:5px 10px">Commercial</th>
            <th style="text-align:right;padding:5px 10px">Install Hrs</th>
          </tr></thead><tbody>${phaseRows}</tbody>
        </table>`:`<p style="font-size:11px;color:#9ca3af;margin:8px 10px">No phase breakdown — save from Summary tab to populate.</p>`}
      </div>`;
    }).join("");

    const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Contribution Split Report — ${prog.name}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#1f2937;padding:24px}
h1{font-size:20px;color:#1e3a5f}h2{font-size:13px;color:#1e3a5f;margin:16px 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
.subtitle{color:#6b7280;font-size:11px;margin:4px 0 20px}
.header{border-bottom:3px solid #1e3a5f;padding-bottom:12px;margin-bottom:20px;display:flex;justify-content:space-between}
.meta-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
.meta-box{border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px}
.meta-label{font-size:9px;text-transform:uppercase;color:#9ca3af;letter-spacing:.05em;margin-bottom:2px}
.meta-value{font-weight:700;font-size:13px}
.prog-bar{height:20px;border-radius:8px;display:flex;overflow:hidden;background:#e5e7eb;margin:8px 0}
.bar-wrap{height:10px;border-radius:6px;display:flex;overflow:hidden;background:#e5e7eb;margin:8px 10px}
.bar-fill{height:100%}
.split-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px}
.sbox{border-radius:6px;padding:8px 10px;background:#f8fafc;border:1px solid #e5e7eb}
.sbox.ee{background:#EFF6FF;border-color:#BFDBFE}.sbox.cu{background:#FFF7ED;border-color:#FED7AA}
.slabel{font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px}
.sval{font-size:14px;font-weight:700}
.attr-table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:11px}
.attr-table th{background:#1e3a5f;color:#fff;padding:6px 10px;text-align:left;font-size:10px}
.attr-table td{padding:6px 10px;border-bottom:1px solid #f3f4f6}
.attr-table tr:nth-child(even) td{background:#f9fafb}
.attr-table tfoot td{font-weight:700;border-top:2px solid #1e3a5f}
.inv-block{border:1px solid #e5e7eb;border-radius:8px;margin-bottom:14px;overflow:hidden}
.inv-header{display:flex;justify-content:space-between;align-items:flex-start;padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e5e7eb}
.inv-name{font-size:13px;font-weight:700;color:#1e3a5f}.inv-meta{font-size:10px;color:#6b7280;margin-top:2px}
.role-badge{font-size:10px;font-weight:600;padding:3px 10px;border-radius:99px;white-space:nowrap}
.rit{background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:8px 10px;color:#991B1B;font-size:11px;margin:8px 10px}
.footer{margin-top:24px;padding-top:8px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:9px;display:flex;justify-content:space-between}
@media print{body{padding:10px}.inv-block{page-break-inside:avoid}}
</style></head><body>
<div class="header">
  <div><h1>${prog.name}</h1><div class="subtitle">${prog.number?prog.number+" · ":""}Contribution Split Report · Generated ${new Date().toLocaleDateString("en-AU",{dateStyle:"long"})}</div></div>
  <div style="text-align:right;font-size:9px;color:#9ca3af"><div>Essential Energy — IET Estimation Tool</div><div>Reporting only — not a Copperleaf export</div></div>
</div>
<h2>Programme Summary</h2>
<div class="meta-grid">
  <div class="meta-box"><div class="meta-label">Investments</div><div class="meta-value">${summary.children.length}</div></div>
  <div class="meta-box"><div class="meta-label">EE Funded (split)</div><div class="meta-value" style="color:#1e3a5f">${fmtD(summary.totalEESplit)}</div></div>
  <div class="meta-box"><div class="meta-label">Customer Funded (split)</div><div class="meta-value" style="color:#ea580c">${fmtD(summary.totalCustSplit)}</div></div>
  <div class="meta-box"><div class="meta-label">Portfolio Commercial</div><div class="meta-value">${fmtD(summary.totalComm)}</div></div>
</div>
<h2>Combined Funding Attribution</h2>
<div style="display:flex;justify-content:space-between;margin-bottom:4px">
  <span style="font-weight:700;color:#1e3a5f">EE: ${fmtD(summary.totalEESplit)} (${pctOf(summary.totalEESplit,progTotal)}%)</span>
  <span style="font-weight:700;color:#ea580c">Customer: ${fmtD(summary.totalCustSplit)} (${pctOf(summary.totalCustSplit,progTotal)}%)</span>
</div>
<div class="prog-bar">
  <div class="bar-fill" style="width:${pctOf(summary.totalEESplit,progTotal)}%;background:#1e3a5f"></div>
  <div class="bar-fill" style="width:${pctOf(summary.totalCustSplit,progTotal)}%;background:#ea580c"></div>
</div>
${anyRitD?`<div class="rit">⚠️ One or more investments have EE contributions exceeding the $7M regulatory cap. See investment detail below.</div>`:""}
<h2>Investment Attribution Summary</h2>
<table class="attr-table"><thead><tr>
  <th>Investment</th><th>Number</th><th>Class</th><th>Role</th><th>Method</th>
  <th style="text-align:right">EE Funded</th><th style="text-align:right">Customer Funded</th><th style="text-align:right">EE%</th>
</tr></thead><tbody>
${summary.children.map(c=>`<tr>
  <td>${c.name}</td><td style="font-family:monospace">${c.number}</td><td>${c.estClass}</td>
  <td style="color:${c.role==="EE-funded"?"#1e3a5f":c.role==="Customer-funded"?"#ea580c":"#374151"};font-weight:600">${c.role}</td>
  <td>${methodLabel[c.splitMethod||"percentage"]}</td>
  <td style="text-align:right;font-weight:600;color:#1e3a5f">${fmtD(c.split.eeSplit)}</td>
  <td style="text-align:right;font-weight:600;color:#ea580c">${fmtD(c.split.custSplit)}</td>
  <td style="text-align:right">${fmtP(c.split.eePct)}</td>
</tr>`).join("")}
</tbody><tfoot><tr>
  <td colspan="5">Programme Total</td>
  <td style="text-align:right;color:#1e3a5f">${fmtD(summary.totalEESplit)}</td>
  <td style="text-align:right;color:#ea580c">${fmtD(summary.totalCustSplit)}</td>
  <td style="text-align:right">${fmtP(pctOf(summary.totalEESplit,progTotal))}</td>
</tr></tfoot></table>
<h2>Investment Detail (per-investment attribution)</h2>
${invRows}
<div class="footer">
  <span>IET Estimation Tool — Programme Contribution Split Report</span>
  <span>${prog.name}${prog.number?` (${prog.number})`:""} · ${summary.children.length} investments · ${new Date().toLocaleString("en-AU")}</span>
</div>
<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}</script>
</body></html>`;

    const w=window.open("","_blank","width=1000,height=800");
    if(w){w.document.write(html);w.document.close();}
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Left: Programme list ── */}
      <div className="w-60 flex-shrink-0 border-r bg-white flex flex-col overflow-hidden">
        <div className="px-3 py-2.5 border-b flex items-center justify-between">
          <span className="text-xs font-bold text-gray-700">Programmes</span>
          <button onClick={()=>setShowNewProg(true)} className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-2 py-1 rounded font-semibold">+ New</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {programmes.length===0&&(
            <div className="text-xs text-gray-400 text-center px-4 py-8">No programmes yet.<br/>Create one to group investments.</div>
          )}
          {programmes.map(p=>{
            const s=getProgSummary(p); const isSel=selectedProg===p.id;
            return (
              <div key={p.id} onClick={()=>{setSelectedProg(isSel?null:p.id);setExpandedChild(null);}}
                className={`px-3 py-2.5 border-b cursor-pointer transition-colors ${isSel?"bg-blue-50 border-l-4 border-l-blue-700":"hover:bg-gray-50"}`}>
                <div className={`font-semibold text-xs truncate ${isSel?"text-blue-800":"text-gray-800"}`}>{p.name}</div>
                {p.number&&<div className="text-xs text-gray-400 font-mono">{p.number}</div>}
                <div className="text-xs text-gray-400 mt-0.5">{s.children.length} investments</div>
                <div className="flex gap-3 mt-1">
                  <span className="text-xs font-semibold" style={{color:EE_BLUE}}>{fmt(s.totalEESplit)} EE</span>
                  <span className="text-xs font-semibold" style={{color:CUST_ORG}}>{fmt(s.totalCustSplit)} Cust</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right: Programme detail ── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        {!prog ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="text-3xl mb-2">💰</div>
              <div className="text-sm font-semibold">Select or create a programme</div>
              <div className="text-xs mt-1 max-w-xs">Group investments and set a funding attribution method per investment — each child can have its own split.</div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="max-w-5xl mx-auto space-y-3">

              {/* Programme header */}
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-lg font-bold text-gray-900">{prog.name}</div>
                    {prog.number&&<div className="text-xs text-gray-400 font-mono">{prog.number} · Created {prog.createdAt}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={generateReport} disabled={!summary.children.length}
                      className="text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white px-3 py-1.5 rounded font-semibold flex items-center gap-1.5 shadow">
                      🖨️ Produce Report
                    </button>
                    <button onClick={()=>deleteProg(prog.id)} className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-2 py-1 rounded">Delete</button>
                  </div>
                </div>
              </div>

              {/* Summary bar */}
              {summary.children.length>0&&(
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
                <div className="text-xs font-bold text-gray-700 mb-2">Combined Funding Attribution</div>
                <div className="grid grid-cols-4 gap-3 mb-3">
                  {[
                    {label:"Investments",value:summary.children.length,plain:true},
                    {label:"EE Funded (split)",value:fmt(summary.totalEESplit),color:EE_BLUE},
                    {label:"Customer Funded (split)",value:fmt(summary.totalCustSplit),color:CUST_ORG},
                    {label:"Portfolio Commercial",value:fmt(summary.totalComm),plain:true},
                  ].map((m,i)=>(
                    <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <div className="text-xs text-gray-500">{m.label}</div>
                      <div className="text-sm font-bold mt-0.5" style={m.color?{color:m.color}:{}}>{m.value}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold" style={{color:EE_BLUE}}>EE: {fmt(summary.totalEESplit)} ({pct(summary.totalEESplit,progTotal)}%)</span>
                  <span className="font-semibold" style={{color:CUST_ORG}}>Customer: {fmt(summary.totalCustSplit)} ({pct(summary.totalCustSplit,progTotal)}%)</span>
                </div>
                <div className="h-3 rounded-full flex overflow-hidden bg-gray-100">
                  <div className="h-full transition-all" style={{width:`${pct(summary.totalEESplit,progTotal)}%`,background:EE_BLUE}}/>
                  <div className="h-full transition-all" style={{width:`${pct(summary.totalCustSplit,progTotal)}%`,background:CUST_ORG}}/>
                </div>
                {anyRitD&&<div className="mt-2 text-xs bg-red-50 border border-red-200 rounded px-3 py-1.5 text-red-700">⚠️ One or more investments exceed the $7M EE cap. See investment detail below.</div>}
              </div>
              )}

              {/* Child investments — accordion with per-child split */}
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b">
                  <span className="text-xs font-bold text-gray-700">Child Investments — click to set attribution</span>
                  <button onClick={()=>setShowAddInv(true)}
                    className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1 rounded font-semibold">+ Add investment</button>
                </div>

                {summary.children.length===0?(
                  <div className="text-xs text-gray-400 text-center py-8">No investments added yet.</div>
                ):(
                  <div>
                    {summary.children.map((c,idx)=>{
                      const isExp=expandedChild===String(c.invId);
                      const roleColor=c.role==="EE-funded"?EE_BLUE:c.role==="Customer-funded"?CUST_ORG:"#6b7280";
                      const tagGroups=isExp&&(c.splitMethod==="section"||c.splitMethod==="item")?buildTagGroups(c):[];

                      return (
                        <div key={c.invId} className={`border-b last:border-0 ${isExp?"border-l-4 border-l-blue-500":""}`}>
                          {/* Row header — click to expand */}
                          <div
                            className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${isExp?"bg-blue-50":"hover:bg-gray-50"}`}
                            onClick={()=>setExpandedChild(isExp?null:String(c.invId))}>
                            <span className="text-xs text-gray-400">{isExp?"▾":"▸"}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold text-gray-800 truncate">{c.name||"Unknown"}</div>
                              <div className="text-xs text-gray-400 font-mono">{c.number} · {c.type==="Commercially Funded"?"Commercial":"Internal"} · {c.estClass}</div>
                            </div>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                              style={{background:c.role==="EE-funded"?"#E6F1FB":c.role==="Customer-funded"?"#FFF7ED":"#F1EFE8",color:roleColor}}>
                              {c.role}
                            </span>
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">{METHOD_LABELS[c.splitMethod||"percentage"]}</span>
                            {/* Mini split bar */}
                            <div className="flex items-center gap-2 min-w-36">
                              <div className="flex-1 h-2 rounded-full flex overflow-hidden bg-gray-100">
                                <div style={{width:`${c.split.eePct}%`,background:EE_BLUE}} className="h-full transition-all"/>
                                <div style={{width:`${c.split.custPct}%`,background:CUST_ORG}} className="h-full transition-all"/>
                              </div>
                              <span className="text-xs font-semibold min-w-16 text-right" style={{color:EE_BLUE}}>{pct(c.split.eeSplit,c.split.eeSplit+c.split.custSplit)}% EE</span>
                            </div>
                            <div className="text-right min-w-24">
                              <div className="text-xs font-semibold" style={{color:EE_BLUE}}>{fmt(c.split.eeSplit)}</div>
                              <div className="text-xs font-semibold" style={{color:CUST_ORG}}>{fmt(c.split.custSplit)}</div>
                            </div>
                            <button onClick={e=>{e.stopPropagation();removeChild(c.invId);}} className="text-gray-300 hover:text-red-500 text-sm font-bold ml-1">✕</button>
                          </div>

                          {/* Expanded: per-child split controls */}
                          {isExp&&(
                            <div className="bg-white border-t border-blue-100 px-4 py-4 space-y-4">

                              {/* Role + method selectors */}
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <div className="text-xs font-semibold text-gray-600 mb-1.5">Funding role</div>
                                  <div className="flex border border-gray-200 rounded overflow-hidden">
                                    {["EE-funded","Customer-funded","Shared"].map(r=>(
                                      <button key={r} onClick={()=>updateChild(c.invId,{role:r})}
                                        className={`flex-1 text-xs py-1.5 font-semibold transition-colors ${c.role===r?"bg-blue-700 text-white":"text-gray-600 hover:bg-gray-50"}`}>{r}</button>
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-semibold text-gray-600 mb-1.5">Attribution method</div>
                                  <div className="flex border border-gray-200 rounded overflow-hidden">
                                    {["percentage","capped","section","item"].map(m=>(
                                      <button key={m} onClick={()=>updateChild(c.invId,{splitMethod:m})}
                                        className={`flex-1 text-xs py-1.5 font-semibold transition-colors ${(c.splitMethod||"percentage")===m?"bg-blue-700 text-white":"text-gray-600 hover:bg-gray-50"}`}>
                                        {METHOD_LABELS[m]}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="text-xs text-gray-400 mt-1">{METHOD_DESCS[c.splitMethod||"percentage"]}</div>
                                </div>
                              </div>

                              {/* Method-specific controls */}
                              {(c.splitMethod||"percentage")==="percentage"&&(
                                <div className="bg-gray-50 rounded-lg p-3">
                                  <div className="text-xs font-semibold text-gray-600 mb-2">EE funded percentage</div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs text-gray-500 min-w-20">0% Customer</span>
                                    <input type="range" min="0" max="100" step="5" value={c.eePct??25}
                                      onChange={e=>updateChild(c.invId,{eePct:parseFloat(e.target.value)})}
                                      className="flex-1"/>
                                    <span className="text-xs text-gray-500 min-w-20 text-right">100% EE</span>
                                  </div>
                                  <div className="flex justify-between mt-2">
                                    <span className="text-xs font-bold" style={{color:EE_BLUE}}>EE: {c.eePct??25}% — {fmt((c.comm||c.ee)*(c.eePct??25)/100)}</span>
                                    <span className="text-xs font-bold" style={{color:CUST_ORG}}>Customer: {100-(c.eePct??25)}% — {fmt((c.comm||c.ee)*(100-(c.eePct??25))/100)}</span>
                                  </div>
                                </div>
                              )}

                              {(c.splitMethod)==="capped"&&(
                                <div className="bg-gray-50 rounded-lg p-3">
                                  <div className="text-xs font-semibold text-gray-600 mb-2">EE contribution cap</div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs text-gray-500">Cap ($)</span>
                                    <input type="number" value={c.eeCap||7000000} step="100000"
                                      onChange={e=>updateChild(c.invId,{eeCap:parseFloat(e.target.value)})}
                                      className="border border-gray-300 rounded px-2 py-1 text-xs w-40 focus:outline-none focus:ring-1 focus:ring-blue-400"/>
                                    <span className="text-xs text-gray-400">Default $7M — RIT-D required to increase</span>
                                  </div>
                                  {c.split.ritD&&<div className="mt-2 text-xs bg-red-50 border border-red-200 rounded px-3 py-1.5 text-red-700">⚠️ Cap exceeded by {fmt(c.split.overCap)}. RIT-D required.</div>}
                                </div>
                              )}

                              {(c.splitMethod==="section"||c.splitMethod==="item")&&(
                                <div>
                                  <div className="text-xs font-semibold text-gray-600 mb-2">
                                    {c.splitMethod==="section"?"Tag WBS sections (L3) to a funder:":"Tag individual estimate line items to a funder:"}
                                  </div>
                                  {tagGroups.length===0?(
                                    <div className="text-xs text-gray-400 italic py-4 text-center bg-gray-50 rounded-lg">No entered quantities found for this investment. Enter quantities and save first.</div>
                                  ):(
                                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                                      {tagGroups.map(([gk,group])=>{
                                        const isOpen=expandedNodes[`${c.invId}_${gk}`]!==false;
                                        const tagging=c.lineTagging||{};
                                        const eeCount=group.items.filter(t=>tagging[t.key]==="EE").length;
                                        const custCount=group.items.filter(t=>tagging[t.key]==="Customer").length;
                                        const untagged=group.items.length-eeCount-custCount;
                                        return (
                                          <div key={gk} className="border-b last:border-0">
                                            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 cursor-pointer hover:bg-gray-100"
                                              onClick={()=>toggleNode(`${c.invId}_${gk}`)}>
                                              <span className="text-xs text-gray-400">{isOpen?"▾":"▸"}</span>
                                              <span className="text-xs font-mono font-semibold text-gray-700">{gk}</span>
                                              <span className="text-xs text-gray-400 flex-1">{group.items.length} {c.splitMethod==="section"?"sections":"items"}</span>
                                              <button onClick={e=>{e.stopPropagation();group.items.forEach(t=>updateChildTagging(c.invId,t.key,"EE"));}}
                                                className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded">All EE</button>
                                              <button onClick={e=>{e.stopPropagation();group.items.forEach(t=>updateChildTagging(c.invId,t.key,"Customer"));}}
                                                className="text-xs bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 px-2 py-0.5 rounded">All Cust</button>
                                              <span className="text-xs text-gray-400">
                                                {eeCount>0&&<span style={{color:EE_BLUE}}>{eeCount} EE </span>}
                                                {custCount>0&&<span style={{color:CUST_ORG}}>{custCount} Cust </span>}
                                                {untagged>0&&<span>{untagged} untagged</span>}
                                              </span>
                                            </div>
                                            {isOpen&&group.items.map(t=>{
                                              const tag=tagging[t.key];
                                              return (
                                                <div key={t.key} className={`flex items-center gap-2 px-5 py-1.5 border-t border-gray-100 ${tag==="EE"?"bg-blue-50":tag==="Customer"?"bg-orange-50":""}`}>
                                                  <span className="text-xs font-mono text-blue-700 min-w-36">{t.key}</span>
                                                  <span className="text-xs text-gray-600 flex-1 truncate">{t.label}</span>
                                                  <div className="flex border border-gray-200 rounded overflow-hidden">
                                                    {["EE","Customer",""].map((v,vi)=>(
                                                      <button key={vi}
                                                        onClick={()=>updateChildTagging(c.invId,t.key,v||undefined)}
                                                        className={`text-xs px-2.5 py-1 transition-colors ${tag===(v||undefined)
                                                          ?v==="EE"?"bg-blue-700 text-white":v==="Customer"?"bg-orange-600 text-white":"bg-gray-300 text-gray-700"
                                                          :"text-gray-500 hover:bg-gray-50"}`}>
                                                        {v||"—"}
                                                      </button>
                                                    ))}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* This child's resolved split */}
                              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                                <div className="text-xs font-semibold text-gray-600 mb-2">Resolved attribution for this investment</div>
                                <div className="flex items-center justify-between text-xs mb-1">
                                  <span style={{color:EE_BLUE}}>EE: {fmt(c.split.eeSplit)} ({c.split.eePct}%)</span>
                                  <span style={{color:CUST_ORG}}>Customer: {fmt(c.split.custSplit)} ({c.split.custPct}%)</span>
                                </div>
                                <div className="h-2 rounded-full flex overflow-hidden bg-gray-200">
                                  <div style={{width:`${c.split.eePct}%`,background:EE_BLUE}} className="h-full transition-all"/>
                                  <div style={{width:`${c.split.custPct}%`,background:CUST_ORG}} className="h-full transition-all"/>
                                </div>
                              </div>

                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>
          </div>
        )}
      </div>

      {/* ── New Programme modal ── */}
      {showNewProg&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background:"rgba(0,0,0,0.45)"}}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-[420px]">
            <div className="text-sm font-bold text-gray-900 mb-4">New Programme</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 font-semibold block mb-1">Programme name *</label>
                <input autoFocus value={newProgName} onChange={e=>setNewProgName(e.target.value)}
                  placeholder="e.g. Marulan Augmentation Programme"
                  className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"/>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold block mb-1">Programme number (optional)</label>
                <input value={newProgNum} onChange={e=>setNewProgNum(e.target.value)} placeholder="e.g. PROG-2026-001"
                  className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"/>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={()=>setShowNewProg(false)} className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={createProg} disabled={!newProgName.trim()}
                className="flex-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white rounded px-3 py-1.5 text-xs font-semibold">Create Programme</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add investment modal ── */}
      {showAddInv&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background:"rgba(0,0,0,0.45)"}}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-[480px]">
            <div className="text-sm font-bold text-gray-900 mb-4">Add Investment to Programme</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 font-semibold block mb-1">Select saved investment</label>
                <select value={addInvId} onChange={e=>setAddInvId(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
                  <option value="">— choose investment —</option>
                  {availableInvs.map(s=>(
                    <option key={s.id} value={s.id}>{s.inv?.name||"Unnamed"} ({s.inv?.number||"no number"}) · {s.inv?.type==="Commercially Funded"?"Commercial":"Internal"}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold block mb-1">Funding role in programme</label>
                <div className="flex gap-2">
                  {["EE-funded","Customer-funded","Shared"].map(r=>(
                    <button key={r} onClick={()=>setAddInvRole(r)}
                      className={`flex-1 text-xs py-2 rounded border font-semibold transition-colors ${addInvRole===r?"border-blue-700 bg-blue-700 text-white":"border-gray-300 text-gray-600 hover:bg-gray-50"}`}>{r}</button>
                  ))}
                </div>
              </div>
              {addInvId&&(()=>{
                const inv=findById(addInvId);
                if(!inv) return null;
                return (
                  <div className="bg-gray-50 rounded-lg p-3 text-xs">
                    <div className="font-semibold text-gray-700 mb-1">{inv.inv?.name}</div>
                    <div className="grid grid-cols-2 gap-1 text-gray-500">
                      <span>EE Internal:</span><span className="font-semibold" style={{color:EE_BLUE}}>{fmt(inv.totalEE)}</span>
                      <span>Commercial:</span><span className="font-semibold" style={{color:CUST_ORG}}>{fmt(inv.totalComm)}</span>
                      <span>Class:</span><span>{inv.inv?.estClass}</span>
                      <span>Status:</span><span>{inv.status||"Draft"}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={()=>{setShowAddInv(false);setAddInvId("");}} className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={addChildInv} disabled={!addInvId}
                className="flex-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white rounded px-3 py-1.5 text-xs font-semibold">Add to Programme</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


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

  const [scaleTab, setScaleTab] = useState("tiers");
  const [wbsSearch, setWbsSearch] = useState("");
  const [wbsScopeFilter, setWbsScopeFilter] = useState("All");
  const [wbsSectionFilter, setWbsSectionFilter] = useState("All");
  // Per-investment profile overrides: { wbs_code: profileId|"none" }
  const [wbsProfileOverrides, setWbsProfileOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem("iet_wbs_profile_overrides") || "{}"); } catch(e){ return {}; }
  });
  const setWbsOverride = (wbsCode, profileId) => {
    const next = {...wbsProfileOverrides, [wbsCode]: profileId};
    setWbsProfileOverrides(next);
    localStorage.setItem("iet_wbs_profile_overrides", JSON.stringify(next));
  };

  // Build a flat list of ALL commission and install wbs items from supply + commLookup
  const allWbsRows = useMemo(() => {
    const rows = [];
    // Commission scope items from commLookup
    Object.entries(commLookup).forEach(([wbsCode, data]) => {
      rows.push({
        wbs_code: wbsCode,
        description: data.description || wbsCode,
        scope: "Commission",
        section: data.section || (wbsCode.startsWith("4.2") ? "SCADA" : wbsCode.startsWith("4.3") ? "Protection" : wbsCode.startsWith("4.4") ? "Comms" : wbsCode.startsWith("4.1") ? "HV Plant" : "Other"),
        default_profile: data.profile_id || null,
      });
    });
    return rows.sort((a,b)=>a.wbs_code.localeCompare(b.wbs_code));
  }, [commLookup]);

  const filteredWbs = allWbsRows.filter(r => {
    const matchSearch = !wbsSearch || r.wbs_code.toLowerCase().includes(wbsSearch.toLowerCase()) || r.description.toLowerCase().includes(wbsSearch.toLowerCase());
    const matchScope = wbsScopeFilter === "All" || r.scope === wbsScopeFilter;
    const matchSection = wbsSectionFilter === "All" || r.section === wbsSectionFilter;
    return matchSearch && matchScope && matchSection;
  });

  const wbsSections = ["All", ...Array.from(new Set(allWbsRows.map(r=>r.section))).sort()];

  if (!Object.keys(profiles).length) return (
    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading scaling profiles…</div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-shrink-0">
        <div className="flex border border-gray-200 rounded overflow-hidden">
          {[{id:"tiers",label:"📊 Scale Profiles & Tiers"},{id:"assign",label:"🔗 WBS Assignment"}].map(t=>(
            <button key={t.id} onClick={()=>setScaleTab(t.id)}
              className={`text-xs px-3 py-1.5 font-semibold transition-colors ${scaleTab===t.id?"bg-blue-700 text-white":"text-gray-600 hover:bg-gray-50"}`}>{t.label}</button>
          ))}
        </div>
        <span className="text-xs text-gray-500">{Object.keys(profiles).length} profiles · {allWbsRows.length} WBS items</span>
        <div className="flex-1"/>
        {managerMode ? (
          <span className="text-xs bg-orange-100 text-orange-700 px-3 py-1.5 rounded font-semibold flex items-center gap-1.5">🔓 Manager Mode — edit enabled</span>
        ) : (
          <button onClick={onUnlock} className="text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded flex items-center gap-1.5">🔒 Manager Mode</button>
        )}
      </div>

      {/* ── WBS ASSIGNMENT TAB ── */}
      {scaleTab === "assign" && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-5xl mx-auto">
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-800 mb-4">
              ⚠️ Overrides here change the <strong>default profile</strong> for all future estimates. Per-investment scale overrides are set in the estimate entry screen (requires manager unlock on that estimate).
            </div>
            <div className="flex items-center gap-2 mb-3">
              <input value={wbsSearch} onChange={e=>setWbsSearch(e.target.value)}
                placeholder="Search WBS code or description…"
                className="border border-gray-300 rounded px-2 py-1.5 text-xs flex-1 focus:outline-none focus:ring-1 focus:ring-blue-400"/>
              <select value={wbsScopeFilter} onChange={e=>setWbsScopeFilter(e.target.value)}
                className="text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none">
                {["All","Commission"].map(s=><option key={s}>{s}</option>)}
              </select>
              <select value={wbsSectionFilter} onChange={e=>setWbsSectionFilter(e.target.value)}
                className="text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none">
                {wbsSections.map(s=><option key={s}>{s}</option>)}
              </select>
              {(wbsSearch||wbsScopeFilter!=="All"||wbsSectionFilter!=="All") && (
                <button onClick={()=>{setWbsSearch("");setWbsScopeFilter("All");setWbsSectionFilter("All");}} className="text-xs text-gray-400 hover:text-gray-600">✕ Clear</button>
              )}
            </div>
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">WBS code</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Description</th>
                    <th className="px-3 py-2 font-semibold text-gray-600 text-center">Scope</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Default profile</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Override profile</th>
                    <th className="px-3 py-2 font-semibold text-gray-600 text-center">Active</th>
                    {managerMode && <th className="px-3 py-2 w-20"/>}
                  </tr>
                </thead>
                <tbody>
                  {filteredWbs.length === 0 ? (
                    <tr><td colSpan={managerMode?7:6} className="px-3 py-6 text-center text-gray-400">No matching WBS items</td></tr>
                  ) : filteredWbs.map((r,i) => {
                    const ovrd = wbsProfileOverrides[r.wbs_code];
                    const activeProfile = ovrd !== undefined ? (ovrd === "none" ? null : ovrd) : r.default_profile;
                    const hasOverride = ovrd !== undefined;
                    return (
                      <tr key={r.wbs_code} className={`border-b ${i%2===0?"":"bg-gray-50/50"} ${hasOverride?"border-l-2 border-l-amber-400":""}`}>
                        <td className="px-3 py-2 font-mono text-blue-700">{r.wbs_code}</td>
                        <td className="px-3 py-2 text-gray-700 max-w-[240px] truncate">{r.description}</td>
                        <td className="px-3 py-2 text-center">
                          <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-xs font-medium">{r.scope}</span>
                        </td>
                        <td className="px-3 py-2">
                          {r.default_profile ? (
                            <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full text-xs font-medium">{r.default_profile}</span>
                          ) : (
                            <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full text-xs">None</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {managerMode ? (
                            <select
                              value={ovrd !== undefined ? ovrd : "__default__"}
                              onChange={e => {
                                const v = e.target.value;
                                if (v === "__default__") {
                                  const next = {...wbsProfileOverrides};
                                  delete next[r.wbs_code];
                                  setWbsProfileOverrides(next);
                                  localStorage.setItem("iet_wbs_profile_overrides", JSON.stringify(next));
                                } else {
                                  setWbsOverride(r.wbs_code, v);
                                }
                              }}
                              className="text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
                              <option value="__default__">— use default —</option>
                              <option value="none">None (no scaling)</option>
                              {Object.entries(profiles).map(([pid,p])=>(
                                <option key={pid} value={pid}>{pid} — {p.name}</option>
                              ))}
                            </select>
                          ) : (
                            hasOverride ? (
                              <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full text-xs font-medium">
                                {ovrd === "none" ? "None (overridden)" : ovrd}
                              </span>
                            ) : (
                              <span className="text-gray-400 text-xs italic">— use default —</span>
                            )
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {activeProfile ? (
                            <span className="bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full text-xs font-semibold">{activeProfile}</span>
                          ) : (
                            <span className="bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full text-xs">No scaling</span>
                          )}
                        </td>
                        {managerMode && (
                          <td className="px-3 py-2 text-center">
                            {hasOverride && (
                              <button onClick={()=>{
                                const next = {...wbsProfileOverrides};
                                delete next[r.wbs_code];
                                setWbsProfileOverrides(next);
                                localStorage.setItem("iet_wbs_profile_overrides", JSON.stringify(next));
                              }} className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-2 py-0.5 rounded">
                                Reset
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-gray-400 mt-2">{filteredWbs.length} items · {Object.keys(wbsProfileOverrides).length} overrides active (highlighted in amber)</div>
          </div>
        </div>
      )}
      {/* ── TIERS TAB ── */}
      {scaleTab === "tiers" && (
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
      )}
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

// ── SUPPLY ITEM RATES EDITOR ─────────────────────────────────────
// Allows the estimation manager to view and maintain contractor rates,
// EE labour rates, and EE unit hours for all supply items.
// Items with missing rates are flagged in amber — these are known data gaps.
function SupplyRatesEditor({ managerMode, onUnlock }) {
  const { supply } = useData();

  const [search,      setSearch]     = useState("");
  const [gapOnly,     setGapOnly]    = useState(false);
  const [phaseFilter, setPhaseFilter]= useState("All");
  const [overrides,   setOverrides]  = useState({});  // {wbs_code: {contractor_rate, ee_labour_rate, ee_unit_hrs}}
  const [editing,     setEditing]    = useState(null); // wbs_code being edited
  const [editVals,    setEditVals]   = useState({});

  // Merge overrides with supply data
  const merged = useMemo(() => supply.map(s => ({
    ...s,
    ...(overrides[s.wbs_code] || {}),
  })), [supply, overrides]);

  const filtered = useMemo(() => merged.filter(s => {
    const phase = s.wbs_code.split(".")[0];
    const matchPhase  = phaseFilter === "All" || phase === phaseFilter;
    const matchSearch = !search ||
      s.wbs_code.toLowerCase().includes(search.toLowerCase()) ||
      (s.description||"").toLowerCase().includes(search.toLowerCase());
    const isContractor = (s.delivery_method||"").includes("Contractor");
    const isWAFHASup = isWAFHAItem(s);
    const hasGap = isWAFHASup ? false : (isContractor
      ? !(s.contractor_rate > 0)
      : !(s.ee_unit_hrs > 0));
    const matchGap = !gapOnly || hasGap;
    return matchPhase && matchSearch && matchGap;
  }), [merged, search, gapOnly, phaseFilter]);

  const gapCount = useMemo(() => merged.filter(s => {
    if (isWAFHAItem(s)) return false; // WAFHA/day-rated items are never GAP
    const isContractor = (s.delivery_method||"").includes("Contractor");
    return isContractor ? !(s.contractor_rate > 0) : !(s.ee_unit_hrs > 0);
  }).length, [merged]);

  const startEdit = (s) => {
    if (!managerMode) return;
    setEditing(s.wbs_code);
    setEditVals({
      contractor_rate: s.contractor_rate || "",
      ee_labour_rate:  s.ee_labour_rate  || "",
      ee_unit_hrs:     s.ee_unit_hrs     || "",
    });
  };

  const saveEdit = (wbs_code) => {
    setOverrides(p => ({
      ...p,
      [wbs_code]: {
        contractor_rate: editVals.contractor_rate !== "" ? parseFloat(editVals.contractor_rate) : null,
        ee_labour_rate:  editVals.ee_labour_rate  !== "" ? parseFloat(editVals.ee_labour_rate)  : null,
        ee_unit_hrs:     editVals.ee_unit_hrs     !== "" ? parseFloat(editVals.ee_unit_hrs)      : null,
      }
    }));
    setEditing(null);
  };

  const phases = ["All","1","2","3","4","5"];
  const phaseLabels = {"All":"All Phases","1":"1 - Planning","2":"2 - Design","3":"3 - Construction","4":"4 - Commissioning","5":"5 - Other"};
  const fmtR = v => v > 0 ? "$"+Math.round(v).toLocaleString("en-AU") : "";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-48">
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search WBS code or description…"
            className="flex-1 text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"/>
        </div>
        <select value={phaseFilter} onChange={e=>setPhaseFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none">
          {phases.map(p=><option key={p} value={p}>{phaseLabels[p]}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-amber-700 cursor-pointer select-none">
          <input type="checkbox" checked={gapOnly} onChange={e=>setGapOnly(e.target.checked)}
            className="accent-amber-500"/>
          <span className="font-semibold">Show gaps only</span>
          <span className="bg-amber-100 text-amber-700 border border-amber-300 rounded px-1.5 py-0.5 font-bold">{gapCount}</span>
        </label>
        <span className="text-xs text-gray-400">{filtered.length} items shown</span>
        {managerMode
          ? <span className="text-xs bg-orange-100 text-orange-700 px-3 py-1.5 rounded font-semibold flex items-center gap-1.5">🔓 Manager Mode — click row to edit</span>
          : <button onClick={onUnlock} className="text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded flex items-center gap-1.5">🔒 Manager Mode</button>
        }
      </div>

      {/* Info banner */}
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-xs text-amber-800 flex-shrink-0 flex items-center gap-2">
        <span>⚠️</span>
        <span>Amber rows have missing rates — these are known data gaps from the source workbook. Enter values in Manager Mode to fill them. Changes apply to the current session only until exported to the database.</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#1e3a5f] text-white">
              <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">WBS Code</th>
              <th className="px-3 py-2 text-left font-semibold">Description</th>
              <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Delivery</th>
              <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Resource</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Contractor Rate ($/unit)</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">EE Labour Rate ($/hr)</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">EE Unit Hrs</th>
              <th className="px-3 py-2 text-center font-semibold whitespace-nowrap">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, i) => {
              const isContractor = (s.delivery_method||"").includes("Contractor");
              const isWAFHASup   = isWAFHAItem(s);
              const hasGap = isWAFHASup ? false : (isContractor ? !(s.contractor_rate > 0) : !(s.ee_unit_hrs > 0));
              const isEditing = editing === s.wbs_code;
              const rowBg = isEditing ? "bg-blue-50 border-l-2 border-blue-500"
                          : hasGap   ? (i%2===0?"bg-amber-50":"bg-amber-50/70")
                          : (i%2===0 ? "bg-white" : "bg-gray-50");

              if (isEditing) return (
                <tr key={s.wbs_code} className={rowBg}>
                  <td className="px-3 py-2 font-mono text-blue-800">{s.wbs_code}</td>
                  <td className="px-3 py-2 text-gray-700">{s.description}</td>
                  <td className="px-3 py-2 text-gray-500">{s.delivery_method}</td>
                  <td className="px-3 py-2 text-gray-500">{s.resource_main}</td>
                  <td className="px-2 py-1">
                    <input type="number" min="0" value={editVals.contractor_rate}
                      onChange={e=>setEditVals(p=>({...p,contractor_rate:e.target.value}))}
                      placeholder="0"
                      className="w-full border border-teal-400 rounded px-1.5 py-1 text-right focus:outline-none focus:ring-1 focus:ring-teal-500 bg-white"/>
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min="0" value={editVals.ee_labour_rate}
                      onChange={e=>setEditVals(p=>({...p,ee_labour_rate:e.target.value}))}
                      placeholder="0"
                      className="w-full border border-purple-400 rounded px-1.5 py-1 text-right focus:outline-none focus:ring-1 focus:ring-purple-500 bg-white"/>
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min="0" value={editVals.ee_unit_hrs}
                      onChange={e=>setEditVals(p=>({...p,ee_unit_hrs:e.target.value}))}
                      placeholder="0"
                      className="w-full border border-indigo-400 rounded px-1.5 py-1 text-right focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"/>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <div className="flex gap-1 justify-center">
                      <button onClick={()=>saveEdit(s.wbs_code)}
                        className="bg-blue-700 hover:bg-blue-600 text-white px-2 py-0.5 rounded text-[10px] font-semibold">Save</button>
                      <button onClick={()=>setEditing(null)}
                        className="border border-gray-300 text-gray-600 hover:bg-gray-50 px-2 py-0.5 rounded text-[10px]">Cancel</button>
                    </div>
                  </td>
                </tr>
              );

              return (
                <tr key={s.wbs_code}
                  onClick={()=>startEdit(s)}
                  className={`${rowBg} ${managerMode?"cursor-pointer hover:bg-blue-50/60":""} transition-colors`}>
                  <td className="px-3 py-1.5 font-mono text-gray-700 whitespace-nowrap">{s.wbs_code}</td>
                  <td className="px-3 py-1.5 text-gray-800 max-w-xs truncate" title={s.description}>{s.description}</td>
                  <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{s.delivery_method}</td>
                  <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{s.resource_main}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${s.contractor_rate>0?"text-teal-700":hasGap&&isContractor?"text-amber-500":"text-gray-300"}`}>
                    {fmtR(s.contractor_rate) || (isContractor && hasGap ? "⚠ missing" : "—")}
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${s.ee_labour_rate>0?"text-purple-700":"text-gray-300"}`}>
                    {fmtR(s.ee_labour_rate) || "—"}
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${
                    isWAFHASup ? "text-amber-600"
                    : s.ee_unit_hrs>0?"text-indigo-700":!isContractor&&hasGap?"text-amber-500":"text-gray-300"}`}>
                    {isWAFHASup
                      ? <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded px-1">day rate</span>
                      : (s.ee_unit_hrs > 0 ? s.ee_unit_hrs.toFixed(2)+" hrs" : (!isContractor && hasGap ? "⚠ missing" : "—"))
                    }
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {isWAFHASup
                      ? <span className="bg-amber-100 text-amber-700 border border-amber-300 rounded px-1.5 py-0.5 text-[10px] font-semibold">DAY</span>
                      : hasGap
                        ? <span className="bg-amber-100 text-amber-700 border border-amber-300 rounded px-1.5 py-0.5 text-[10px] font-semibold">GAP</span>
                        : <span className="bg-green-100 text-green-700 border border-green-300 rounded px-1.5 py-0.5 text-[10px] font-semibold">OK</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-16">No items match your filters.</div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// WBS ITEM EDITOR — merged WBS Items + Supply Rates in one screen
// Columns: WBS Code | Description | Scope | Delivery | Resource (main)
//          Install Resource | Comm Resource | Resource Options
//          Contractor Rate | EE Labour Rate | EE Unit Hrs | Materials Cost
//          Plant Cost | UOM | Install WBS | Commission WBS | Status/Gap
// Manager Mode (PIN-locked) enables inline editing of every field.
// ══════════════════════════════════════════════════════════════════
function WBSItemEditor({ wbs, supply, rates, managerMode, onUnlock, loading }) {
  const [search,      setSearch]      = useState("");
  const [phaseFilter, setPhaseFilter] = useState("All");
  const [scopeFilter, setScopeFilter] = useState("All");
  const [gapOnly,     setGapOnly]     = useState(false);
  const [showAdd,     setShowAdd]     = useState(false);
  const [editing,     setEditing]     = useState(null);
  const [editVals,    setEditVals]    = useState({});
  const [overrides,   setOverrides]   = useState({});
  const [deleteCode,  setDeleteCode]  = useState(null);
  const [deleteStage, setDeleteStage] = useState(0);

  // New WBS item form state
  const [newItem, setNewItem] = useState({
    wbs_code:"", description:"", scope:"Supply", delivery_method:"Contractor Delivered",
    resource_main:"Contractor - Electrical", resource_install:"", resource_comm:"",
    resource_options:"", uom:"each",
    contractor_rate:"", ee_labour_rate:"", ee_unit_hrs:"",
    pce_price:"", plant_cost:"", install_wbs:"", commission_wbs:"", comments:""
  });
  const [localSupply, setLocalSupply] = useState(null);
  const displaySupply = (localSupply || supply).map(s => ({...s, ...(overrides[s.wbs_code]||{})}));

  // Build rates lookup for resource options
  const resourceTypes = useMemo(()=> rates.map(r=>r.resource_type), [rates]);

  const gapCount = useMemo(()=> displaySupply.filter(s=>
    !s.pct_of_total && !(
      (s.contractor_rate > 0) || (s.ee_unit_hrs > 0) ||
      (s.ee_labour_rate  > 0) || (s.pce_price   > 0) || (s.plant_cost > 0)
    )
  ).length, [displaySupply]);

  const filtered = useMemo(()=>{
    const q = search.toLowerCase();
    return displaySupply.filter(s=>{
      const phase = s.wbs_code.split(".")[0];
      // GAP only when item has absolutely no pricing across all five cost fields
      const hasGap = s.pct_of_total ? false : !(
        (s.contractor_rate > 0) || (s.ee_unit_hrs > 0) ||
        (s.ee_labour_rate  > 0) || (s.pce_price   > 0) || (s.plant_cost > 0)
      );
      return (phaseFilter==="All" || phase===phaseFilter)
          && (scopeFilter==="All"  || (s.scope||"")===scopeFilter)
          && (!gapOnly || hasGap)
          && (!q || s.wbs_code.toLowerCase().includes(q) || (s.description||"").toLowerCase().includes(q)
               || (s.resource_main||"").toLowerCase().includes(q));
    });
  }, [displaySupply, search, phaseFilter, scopeFilter, gapOnly]);

  const startEdit = (s) => {
    if (!managerMode) return;
    setEditing(s.wbs_code);
    setEditVals({
      description:       s.description       || "",
      scope:             s.scope             || "Supply",
      delivery_method:   s.delivery_method   || "Contractor Delivered",
      resource_main:     s.resource_main     || "",
      resource_install:  s.resource_install  || "",
      resource_comm:     s.resource_comm     || "",
      resource_options:  s.resource_options  || "",
      uom:               s.uom               || "each",
      contractor_rate:   s.contractor_rate   != null ? s.contractor_rate : "",
      ee_labour_rate:    s.ee_labour_rate    != null ? s.ee_labour_rate  : "",
      ee_unit_hrs:       s.ee_unit_hrs       != null ? s.ee_unit_hrs     : "",
      pce_price:         s.pce_price         != null ? s.pce_price       : "",
      plant_cost:        s.plant_cost        != null ? s.plant_cost      : "",
      install_wbs:       s.install_wbs       || "",
      commission_wbs:    s.commission_wbs    || "",
      comments:          s.comments          || "",
    });
  };

  const saveEdit = (wbs_code) => {
    const toNum = v => v !== "" && v != null ? parseFloat(v) : null;
    setOverrides(p=>({...p, [wbs_code]: {
      description:      editVals.description,
      scope:            editVals.scope,
      delivery_method:  editVals.delivery_method,
      resource_main:    editVals.resource_main,
      resource_install: editVals.resource_install,
      resource_comm:    editVals.resource_comm,
      resource_options: editVals.resource_options,
      uom:              editVals.uom,
      contractor_rate:  toNum(editVals.contractor_rate),
      ee_labour_rate:   toNum(editVals.ee_labour_rate),
      ee_unit_hrs:      toNum(editVals.ee_unit_hrs),
      pce_price:        toNum(editVals.pce_price),
      plant_cost:       toNum(editVals.plant_cost),
      install_wbs:      editVals.install_wbs,
      commission_wbs:   editVals.commission_wbs,
      comments:         editVals.comments,
    }}));
    setEditing(null);
  };

  const addItem = () => {
    if (!newItem.wbs_code.trim() || !newItem.description.trim()) return;
    const toNum = v => v !== "" && v != null ? parseFloat(v) : null;
    const entry = {
      wbs_code:         newItem.wbs_code.trim(),
      l4_group:         newItem.wbs_code.trim().split(".").slice(0,4).join("."),
      description:      newItem.description.trim(),
      scope:            newItem.scope,
      delivery_method:  newItem.delivery_method,
      resource_main:    newItem.resource_main,
      resource_install: newItem.resource_install,
      resource_comm:    newItem.resource_comm,
      resource_options: newItem.resource_options,
      uom:              newItem.uom,
      contractor_rate:  toNum(newItem.contractor_rate),
      ee_labour_rate:   toNum(newItem.ee_labour_rate),
      ee_unit_hrs:      toNum(newItem.ee_unit_hrs),
      pce_price:        toNum(newItem.pce_price),
      plant_cost:       toNum(newItem.plant_cost),
      install_wbs:      newItem.install_wbs,
      commission_wbs:   newItem.commission_wbs,
      comments:         newItem.comments,
    };
    setLocalSupply(p => [...(p || supply), entry]);
    setNewItem({wbs_code:"",description:"",scope:"Supply",delivery_method:"Contractor Delivered",
      resource_main:"Contractor - Electrical",resource_install:"",resource_comm:"",
      resource_options:"",uom:"each",contractor_rate:"",ee_labour_rate:"",ee_unit_hrs:"",
      pce_price:"",plant_cost:"",install_wbs:"",commission_wbs:"",comments:""});
    setShowAdd(false);
  };

  const fmtR = v => v > 0 ? `$${parseFloat(v).toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2})}` : "";
  const fmtH = v => v > 0 ? `${parseFloat(v).toFixed(2)} hrs` : "";

  const DELIVERY_OPTIONS = ["Contractor Delivered","EE Delivered","Contractor or EE Delivered"];
  const SCOPE_OPTIONS    = ["Supply","Install","Commission","Supply & Install","Supply, Install & Commission","Demolition / Removal","Administration","Other"];
  const UOM_OPTIONS      = ["each","m","m2","m3","kg","km","day","lot","set","hr"];

  const INP = "w-full border rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white";
  const SEL = "w-full border rounded px-1 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400";

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Toolbar ── */}
      <div className="bg-white border-b px-3 py-2 flex items-center gap-2 flex-shrink-0 flex-wrap">
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search code, description, resource…"
          className="border border-gray-200 rounded px-2 py-1.5 text-xs w-52 focus:outline-none focus:ring-1 focus:ring-blue-400"/>
        <select value={phaseFilter} onChange={e=>setPhaseFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none">
          {["All","1","2","3","4","5"].map(p=>(
            <option key={p} value={p}>{p==="All"?"All Phases":`Phase ${p}`}</option>
          ))}
        </select>
        <select value={scopeFilter} onChange={e=>setScopeFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none">
          {["All","Supply","Install","Commission","Supply & Install"].map(s=>(
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-amber-700 cursor-pointer select-none">
          <input type="checkbox" checked={gapOnly} onChange={e=>setGapOnly(e.target.checked)} className="accent-amber-500"/>
          <span className="font-semibold">Gaps only</span>
          <span className="bg-amber-100 text-amber-700 border border-amber-300 rounded px-1.5 py-0.5 font-bold text-[10px]">{gapCount}</span>
        </label>
        <span className="text-xs text-gray-400">{filtered.length.toLocaleString()} items</span>
        <div className="flex-1"/>
        {managerMode ? (
          <>
            <button onClick={()=>setShowAdd(s=>!s)}
              className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded font-semibold">
              {showAdd?"✕ Cancel":"+ Add WBS Item"}
            </button>
            <button onClick={()=>{}} className="text-xs bg-orange-100 border border-orange-300 text-orange-700 px-3 py-1.5 rounded font-semibold flex items-center gap-1.5">
              🔓 Manager Mode
            </button>
          </>
        ) : (
          <button onClick={onUnlock} className="text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded font-medium flex items-center gap-1.5">
            🔒 Manager Mode
          </button>
        )}
      </div>

      {/* ── Gap banner ── */}
      {gapCount > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-xs text-amber-800 flex items-center gap-2 flex-shrink-0">
          <span>⚠️</span>
          <span><b>{gapCount} items</b> have missing rates (known data gaps from source workbook). Use Manager Mode to fill them — click any row to edit all fields.</span>
        </div>
      )}

      {/* ── Add New WBS Item form ── */}
      {managerMode && showAdd && (
        <div className="bg-green-50 border-b border-green-200 px-4 py-3 flex-shrink-0 overflow-x-auto">
          <div className="text-xs font-bold text-green-800 mb-2 uppercase tracking-wide flex items-center gap-2">
            <span>➕ Add New WBS Item</span>
            <span className="text-[10px] text-green-600 font-normal normal-case">Fill in the fields below — all rate fields are optional and can be updated later</span>
          </div>
          <div className="grid gap-2" style={{gridTemplateColumns:"repeat(18,minmax(80px,1fr))"}}>
            {[
              {label:"WBS Code *",        key:"wbs_code",        type:"text",  span:2, placeholder:"3.1.3.04.1.10", mono:true},
              {label:"Description *",     key:"description",     type:"text",  span:4, placeholder:"e.g. 132kV Circuit Breaker"},
              {label:"Scope",             key:"scope",           type:"sel",   span:2, opts:SCOPE_OPTIONS},
              {label:"Delivery",          key:"delivery_method", type:"sel",   span:2, opts:DELIVERY_OPTIONS},
              {label:"Main Resource",     key:"resource_main",   type:"sel",   span:2, opts:["Contractor - Civil","Contractor - Electrical","Contractor - Building","Contractor","ZS Electrical Technician","Substation Designer","Network Development Officer","Work Away From Home","Supplier","N.A.",...resourceTypes]},
              {label:"UOM",              key:"uom",             type:"sel",   span:1, opts:UOM_OPTIONS},
              {label:"Contractor Rate $", key:"contractor_rate", type:"num",   span:1, placeholder:"0"},
              {label:"EE Labour Rate $",  key:"ee_labour_rate",  type:"num",   span:1, placeholder:"139.26"},
              {label:"EE Unit Hrs",       key:"ee_unit_hrs",     type:"num",   span:1, placeholder:"0"},
              {label:"Materials $ (PCE)", key:"pce_price",       type:"num",   span:1, placeholder:"0"},
              {label:"Plant Cost $",      key:"plant_cost",      type:"num",   span:1, placeholder:"0"},
              {label:"Install WBS",       key:"install_wbs",     type:"text",  span:2, placeholder:"3.1.3.04.4.10", mono:true},
              {label:"Comm WBS",          key:"commission_wbs",  type:"text",  span:2, placeholder:"4.1.1.xx.x.xx", mono:true},
            ].map(({label,key,type,span,placeholder,opts,mono})=>(
              <div key={key} style={{gridColumn:`span ${span}`}}>
                <label className="text-[10px] text-gray-500 block mb-0.5 font-medium">{label}</label>
                {type==="sel" ? (
                  <select value={newItem[key]} onChange={e=>setNewItem(p=>({...p,[key]:e.target.value}))} className={SEL}>
                    {(opts||[]).filter((v,i,a)=>a.indexOf(v)===i).map(o=><option key={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={type==="num"?"number":"text"} min="0"
                    value={newItem[key]} placeholder={placeholder}
                    onChange={e=>setNewItem(p=>({...p,[key]:e.target.value}))}
                    className={`${INP} ${mono?"font-mono":""}`}/>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2 items-center">
            <button onClick={addItem}
              disabled={!newItem.wbs_code.trim()||!newItem.description.trim()}
              className="text-xs bg-green-700 hover:bg-green-600 disabled:bg-gray-300 text-white px-4 py-1.5 rounded font-bold">
              ✓ Add Item to WBS
            </button>
            <button onClick={()=>setShowAdd(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
            <span className="text-[10px] text-gray-400 ml-2">Install Resource and Commission Resource are set per-estimate in the Estimation Tool</span>
          </div>
        </div>
      )}

      {/* ── Main table ── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center"><div className="text-2xl animate-spin mb-2">⟳</div><div className="text-sm">Loading…</div></div>
          </div>
        ) : (
          <table className="text-xs border-collapse" style={{minWidth:"1800px",width:"100%"}}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#1e3a5f] text-white">
                <th className="px-2 py-2 text-left font-semibold whitespace-nowrap w-32">WBS Code</th>
                <th className="px-2 py-2 text-left font-semibold min-w-[220px]">Description</th>
                <th className="px-2 py-2 text-left font-semibold whitespace-nowrap w-28">Scope</th>
                <th className="px-2 py-2 text-left font-semibold whitespace-nowrap w-36">Delivery</th>
                <th className="px-2 py-2 text-left font-semibold whitespace-nowrap w-44">Main Resource</th>
                <th className="px-2 py-2 text-left font-semibold whitespace-nowrap w-16">UOM</th>
                <th className="px-2 py-2 text-right font-semibold whitespace-nowrap w-28">Contractor Rate ($)</th>
                <th className="px-2 py-2 text-right font-semibold whitespace-nowrap w-28">EE Labour Rate ($/hr)</th>
                <th className="px-2 py-2 text-right font-semibold whitespace-nowrap w-24">EE Unit Hrs</th>
                <th className="px-2 py-2 text-right font-semibold whitespace-nowrap w-28">Materials $ (PCE)</th>
                <th className="px-2 py-2 text-right font-semibold whitespace-nowrap w-24">Plant Cost ($)</th>
                <th className="px-2 py-2 text-left font-semibold whitespace-nowrap w-32">Install WBS</th>
                <th className="px-2 py-2 text-left font-semibold whitespace-nowrap w-32">Comm WBS</th>
                <th className="px-2 py-2 text-center font-semibold whitespace-nowrap w-16">Status</th>
                {managerMode && <th className="px-2 py-2 w-16"/>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => {
                const isC    = (s.delivery_method||"").includes("Contractor");
                const isPct  = !!s.pct_of_total;
                // GAP only when absolutely no pricing exists across all cost/rate fields
                const hasGap = isPct ? false : !(
                  (s.contractor_rate > 0) || (s.ee_unit_hrs > 0) ||
                  (s.ee_labour_rate  > 0) || (s.pce_price   > 0) || (s.plant_cost > 0)
                );
                const isEd   = editing === s.wbs_code;
                const rowBg  = isEd    ? "bg-blue-50"
                             : hasGap  ? (i%2===0?"bg-amber-50":"bg-amber-50/60")
                             : i%2===0 ? "bg-white" : "bg-gray-50";

                if (isEd) return (
                  <tr key={s.wbs_code} className="bg-blue-50 border-y-2 border-blue-400">
                    <td className="px-2 py-1.5 font-mono text-blue-800 whitespace-nowrap text-[10px]">{s.wbs_code}</td>
                    <td className="px-1 py-1"><input value={editVals.description} onChange={e=>setEditVals(p=>({...p,description:e.target.value}))} className={INP}/></td>
                    <td className="px-1 py-1"><select value={editVals.scope} onChange={e=>setEditVals(p=>({...p,scope:e.target.value}))} className={SEL}>{SCOPE_OPTIONS.map(o=><option key={o}>{o}</option>)}</select></td>
                    <td className="px-1 py-1"><select value={editVals.delivery_method} onChange={e=>setEditVals(p=>({...p,delivery_method:e.target.value}))} className={SEL}>{DELIVERY_OPTIONS.map(o=><option key={o}>{o}</option>)}</select></td>
                    <td className="px-1 py-1"><select value={editVals.resource_main} onChange={e=>setEditVals(p=>({...p,resource_main:e.target.value}))} className={SEL}>{["Contractor - Civil","Contractor - Electrical","Contractor - Building","Contractor","ZS Electrical Technician","Substation Designer","Network Development Officer","Work Away From Home","Supplier","N.A.",...resourceTypes].filter((v,i,a)=>a.indexOf(v)===i).map(o=><option key={o}>{o}</option>)}</select></td>
                    <td className="px-1 py-1"><select value={editVals.uom} onChange={e=>setEditVals(p=>({...p,uom:e.target.value}))} className={SEL}>{UOM_OPTIONS.map(o=><option key={o}>{o}</option>)}</select></td>
                    <td className="px-1 py-1"><input type="number" min="0" value={editVals.contractor_rate} onChange={e=>setEditVals(p=>({...p,contractor_rate:e.target.value}))} className={`${INP} text-right`} placeholder="0"/></td>
                    <td className="px-1 py-1"><input type="number" min="0" value={editVals.ee_labour_rate} onChange={e=>setEditVals(p=>({...p,ee_labour_rate:e.target.value}))} className={`${INP} text-right`} placeholder="0"/></td>
                    <td className="px-1 py-1"><input type="number" min="0" value={editVals.ee_unit_hrs} onChange={e=>setEditVals(p=>({...p,ee_unit_hrs:e.target.value}))} className={`${INP} text-right`} placeholder="0"/></td>
                    <td className="px-1 py-1"><input type="number" min="0" value={editVals.pce_price} onChange={e=>setEditVals(p=>({...p,pce_price:e.target.value}))} className={`${INP} text-right`} placeholder="0"/></td>
                    <td className="px-1 py-1"><input type="number" min="0" value={editVals.plant_cost} onChange={e=>setEditVals(p=>({...p,plant_cost:e.target.value}))} className={`${INP} text-right`} placeholder="0"/></td>
                    <td className="px-1 py-1"><input value={editVals.install_wbs} onChange={e=>setEditVals(p=>({...p,install_wbs:e.target.value}))} className={`${INP} font-mono text-[10px]`} placeholder="e.g. 3.1.x.xx.4.xx"/></td>
                    <td className="px-1 py-1"><input value={editVals.commission_wbs} onChange={e=>setEditVals(p=>({...p,commission_wbs:e.target.value}))} className={`${INP} font-mono text-[10px]`} placeholder="e.g. 4.1.x.xx.x.xx"/></td>
                    <td className="px-1 py-1 text-center">
                      <div className="flex flex-col gap-1">
                        <button onClick={()=>saveEdit(s.wbs_code)} className="bg-blue-700 hover:bg-blue-600 text-white px-2 py-0.5 rounded text-[10px] font-semibold">Save</button>
                        <button onClick={()=>setEditing(null)} className="border border-gray-300 text-gray-500 hover:bg-gray-50 px-2 py-0.5 rounded text-[10px]">Cancel</button>
                      </div>
                    </td>
                    {managerMode && <td/>}
                  </tr>
                );

                return (
                  <tr key={s.wbs_code}
                    onClick={()=>startEdit(s)}
                    className={`${rowBg} ${managerMode?"cursor-pointer hover:bg-blue-50/50":""} transition-colors`}>
                    <td className="px-2 py-1.5 font-mono text-gray-600 whitespace-nowrap text-[10px]">{s.wbs_code}</td>
                    <td className="px-2 py-1.5 text-gray-800 max-w-xs" title={s.description}>
                      <div className="truncate">{s.description}</div>
                      {s.comments && <div className="text-[10px] text-gray-400 truncate italic">{s.comments}</div>}
                    </td>
                    <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{s.scope}</td>
                    <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap text-[10px]">{s.delivery_method}</td>
                    <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap text-[10px]">{s.resource_main}</td>
                    <td className="px-2 py-1.5 text-gray-500 text-center">{s.uom}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap ${
                      isPct ? "text-teal-600" : s.contractor_rate>0 ? "text-teal-700" : hasGap&&isC ? "text-amber-500" : "text-gray-300"}`}>
                      {isPct ? `${(s.pct_of_total*100).toFixed(0)}% of L3` : (fmtR(s.contractor_rate) || "—")}
                    </td>
                    <td className={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${s.ee_labour_rate>0?"text-purple-700":"text-gray-300"}`}>
                      {fmtR(s.ee_labour_rate)||"—"}
                    </td>
                    <td className={`px-2 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap ${
                      s.ee_unit_hrs>0?"text-indigo-700":!isC&&!isPct&&hasGap?"text-amber-500":"text-gray-300"}`}>
                      {fmtH(s.ee_unit_hrs)||"—"}
                    </td>
                    <td className={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${s.pce_price>0?"text-green-700":"text-gray-300"}`}>
                      {fmtR(s.pce_price)||"—"}
                    </td>
                    <td className={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${s.plant_cost>0?"text-orange-600":"text-gray-300"}`}>
                      {fmtR(s.plant_cost)||"—"}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-gray-400 text-[10px] whitespace-nowrap">{s.install_wbs||"—"}</td>
                    <td className="px-2 py-1.5 font-mono text-gray-400 text-[10px] whitespace-nowrap">{s.commission_wbs||"—"}</td>
                    <td className="px-2 py-1.5 text-center">
                      {isPct
                        ? <span className="bg-teal-50 text-teal-700 border border-teal-200 rounded px-1.5 py-0.5 text-[10px] font-semibold">%</span>
                        : hasGap
                          ? <span className="bg-amber-100 text-amber-700 border border-amber-300 rounded px-1.5 py-0.5 text-[10px] font-semibold">GAP</span>
                          : <span className="bg-green-100 text-green-700 border border-green-300 rounded px-1.5 py-0.5 text-[10px] font-semibold">OK</span>
                      }
                    </td>
                    {managerMode && (
                      <td className="px-1 py-1.5 text-center">
                        {deleteCode===s.wbs_code ? (
                          <div className="flex gap-1 justify-center">
                            <button onClick={e=>{e.stopPropagation();setLocalSupply(p=>(p||supply).filter(x=>x.wbs_code!==s.wbs_code));setDeleteCode(null);}}
                              className="bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded">✓ Delete</button>
                            <button onClick={e=>{e.stopPropagation();setDeleteCode(null);}}
                              className="border text-gray-500 text-[10px] px-1.5 py-0.5 rounded">✕</button>
                          </div>
                        ) : (
                          <button onClick={e=>{e.stopPropagation();setDeleteCode(s.wbs_code);}}
                            className="text-red-400 hover:text-red-600 text-[10px]">✕</button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!loading && filtered.length===0 && (
          <div className="text-center text-gray-400 text-sm py-16">No items match your filters.</div>
        )}
      </div>
    </div>
  );
}

function WBSManager({ equipSel, setEquipSel }) {
  const {wbs:wbsCtx, supply, rates, loading, error} = useData();
  const [tab,          setTab]         = useState("items");
  const [search,       setSearch]      = useState("");
  const [scopeFilter,  setScopeFilter] = useState("All");
  const [people, setPeople] = useState(()=>{
    try{
      const raw=localStorage.getItem("iet_people");
      return raw?JSON.parse(raw):SAMPLE_PEOPLE;
    }catch(e){return SAMPLE_PEOPLE;}
  });
  const savePeople = (p)=>{ setPeople(p); localStorage.setItem("iet_people",JSON.stringify(p)); };
  const [showAdd,      setShowAdd]     = useState(false);
  const [newP,         setNewP]        = useState({name:"",email:"",role:"Estimator",team:"Zone Substation",canReview:false});
  const [peopleFilter, setPeopleFilter]= useState("active"); // "all"|"active"|"inactive"
  const [deletePersonModal, setDeletePersonModal] = useState(null); // person object
  const [deletePersonStage, setDeletePersonStage] = useState(1);

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
    const next=[...people,{id:Date.now(),...newP,active:true}];
    savePeople(next);
    setShowAdd(false);
    setNewP({name:"",email:"",role:"Estimator",team:"Zone Substation",canReview:false});
  };
  const togglePersonActive=(id,val)=>{
    savePeople(people.map(x=>x.id===id?{...x,active:val}:x));
  };
  const deletePerson=(id)=>{
    savePeople(people.filter(x=>x.id!==id));
    setDeletePersonModal(null); setDeletePersonStage(1);
  };

  const equipSelectedCount = Object.values(equipSel).filter(q=>parseFloat(q)>0).length;
  const tabs=[
    {id:"items",      label:"📋 WBS Item Editor",      count:wbs.length},
    {id:"rates",      label:"💲 Resource Rates",       count:rates.length},
    {id:"catalogue",  label:"🔧 Equipment Catalogue",  count:null},
    {id:"escalation", label:"📈 Escalation Rates",     count:null},
    {id:"scaling",    label:"📐 Comm Scaling",          count:WBS_PROFILES.length},
    {id:"people",     label:"👥 People & Roles",        count:people.filter(p=>p.active).length},
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
        <WBSItemEditor
          wbs={wbs}
          supply={supply}
          rates={rates}
          managerMode={managerMode}
          onUnlock={()=>setShowPinModal(true)}
          loading={loading}
        />
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
          {/* Toolbar */}
          <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-shrink-0">
            <button onClick={()=>setShowAdd(s=>!s)}
              className={`text-xs px-3 py-1.5 rounded font-semibold ${showAdd?"bg-gray-200 text-gray-700":"bg-green-700 hover:bg-green-600 text-white"}`}>
              {showAdd?"✕ Cancel":"+ Add Person"}
            </button>
            <div className="flex border border-gray-200 rounded overflow-hidden">
              {[["active","Active"],["inactive","Inactive"],["all","All"]].map(([v,l])=>(
                <button key={v} onClick={()=>setPeopleFilter(v)}
                  className={`text-xs px-3 py-1.5 font-semibold transition-colors ${peopleFilter===v?"bg-blue-700 text-white":"text-gray-600 hover:bg-gray-50"}`}>{l}</button>
              ))}
            </div>
            <span className="text-xs text-gray-400">{people.filter(p=>p.active).length} active · {people.filter(p=>!p.active).length} inactive</span>
            <div className="flex-1"/>
            {managerMode?(
              <span className="text-xs bg-orange-100 text-orange-700 px-3 py-1.5 rounded font-semibold">🔓 Manager Mode — delete enabled</span>
            ):(
              <button onClick={()=>setShowPinModal(true)} className="text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded flex items-center gap-1.5">🔒 Manager Mode (to delete)</button>
            )}
          </div>

          {/* Add person form */}
          {showAdd&&(
            <div className="bg-green-50 border-b border-green-200 px-4 py-3 flex-shrink-0">
              <div className="grid grid-cols-5 gap-2 items-end">
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Full Name *</label>
                  <input value={newP.name} onChange={e=>setNewP(p=>({...p,name:e.target.value}))}
                    className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Email *</label>
                  <input value={newP.email} onChange={e=>setNewP(p=>({...p,email:e.target.value}))}
                    className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Role</label>
                  <select value={newP.role} onChange={e=>setNewP(p=>({...p,role:e.target.value}))}
                    className="w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-green-400">
                    {["Estimator","Senior Estimator","Lead Estimator","Project Manager"].map(r=><option key={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Team</label>
                  <select value={newP.team} onChange={e=>setNewP(p=>({...p,team:e.target.value}))}
                    className="w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-green-400">
                    {["Zone Substation","Subtransmission","Communications","Commissioning","Civil & Earthing"].map(t=><option key={t}>{t}</option>)}
                  </select>
                </div>
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

          {/* People table */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b sticky top-0">
                <tr>
                  {["Name","Email","Role","Team","Can Review","Status","Actions"].map(h=>(
                    <th key={h} className="text-left px-3 py-2 font-semibold text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people
                  .filter(p=>peopleFilter==="all"||(peopleFilter==="active"&&p.active)||(peopleFilter==="inactive"&&!p.active))
                  .map(p=>(
                  <tr key={p.id} className={`border-b transition-colors ${p.active?"hover:bg-gray-50":"opacity-60 bg-gray-50 hover:bg-gray-100"}`}>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-gray-800">{p.name}</div>
                      {!p.active&&<div className="text-xs text-gray-400 italic">Inactive — not available for selection</div>}
                    </td>
                    <td className="px-3 py-2 text-gray-500">{p.email}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${WBS_ROLE_STYLES[p.role]||"bg-gray-100 text-gray-500"}`}>{p.role}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{p.team}</td>
                    <td className="px-3 py-2 text-center">
                      {p.canReview?<span className="text-green-600 font-bold text-sm">✓</span>:<span className="text-gray-300">–</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.active?"bg-green-100 text-green-700":"bg-gray-100 text-gray-500"}`}>
                        {p.active?"Active":"Inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {p.active?(
                          <button onClick={()=>togglePersonActive(p.id,false)}
                            className="text-xs text-amber-600 hover:text-amber-800 border border-amber-200 hover:border-amber-400 px-2 py-0.5 rounded">
                            Make Inactive
                          </button>
                        ):(
                          <button onClick={()=>togglePersonActive(p.id,true)}
                            className="text-xs text-green-600 hover:text-green-800 border border-green-200 hover:border-green-400 px-2 py-0.5 rounded">
                            Reactivate
                          </button>
                        )}
                        {managerMode?(
                          <button onClick={()=>{setDeletePersonModal(p);setDeletePersonStage(1);}}
                            className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-2 py-0.5 rounded">
                            🗑 Delete
                          </button>
                        ):(
                          <span className="text-xs text-gray-300" title="Unlock Manager Mode to delete">🔒</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Delete person modal — 2-stage */}
          {deletePersonModal&&(
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background:"rgba(0,0,0,0.55)"}}>
              <div className="bg-white rounded-xl shadow-2xl w-[420px] overflow-hidden">
                {deletePersonStage===1&&(
                  <>
                    <div className="bg-red-700 text-white px-5 py-4">
                      <div className="text-sm font-bold">⚠️ Delete Person Record</div>
                      <div className="text-xs text-red-200 mt-1">This will permanently remove this person from the system.</div>
                    </div>
                    <div className="p-5">
                      <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 mb-4">
                        <div className="text-sm font-bold text-gray-800">{deletePersonModal.name}</div>
                        <div className="text-xs text-gray-400">{deletePersonModal.email} · {deletePersonModal.role} · {deletePersonModal.team}</div>
                        {!deletePersonModal.active&&<div className="text-xs text-amber-600 mt-1">This person is already inactive.</div>}
                      </div>
                      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
                        💡 Consider making this person <strong>Inactive</strong> instead of deleting. Inactive people are hidden from dropdowns but their historical involvement in estimates is preserved.
                      </div>
                      <div className="flex gap-2">
                        <button onClick={()=>setDeletePersonModal(null)} className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
                        <button onClick={()=>setDeletePersonStage(2)} className="flex-1 bg-red-700 hover:bg-red-600 text-white rounded px-3 py-1.5 text-xs font-semibold">Delete anyway →</button>
                      </div>
                    </div>
                  </>
                )}
                {deletePersonStage===2&&(
                  <>
                    <div className="bg-red-700 text-white px-5 py-4">
                      <div className="text-sm font-bold">Confirm Permanent Delete</div>
                    </div>
                    <div className="p-5">
                      <div className="text-xs text-gray-600 mb-3">
                        Are you sure you want to permanently delete <strong>{deletePersonModal.name}</strong>? This cannot be undone.
                      </div>
                      <div className="flex gap-2">
                        <button onClick={()=>setDeletePersonStage(1)} className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">← Back</button>
                        <button onClick={()=>deletePerson(deletePersonModal.id)}
                          className="flex-1 bg-red-700 hover:bg-red-600 text-white rounded px-3 py-1.5 text-xs font-bold">🗑 Confirm Delete</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
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
  const { equipment, supply, loading } = useData();
  const [typeFilter, setTypeFilter] = useState("All");
  const [catFilter,  setCatFilter]  = useState("All");
  const [search,     setSearch]     = useState("");
  const [editing,    setEditing]    = useState(null);
  const [editVals,   setEditVals]   = useState({});
  const [showAdd,    setShowAdd]    = useState(false);
  const [localItems, setLocalItems] = useState(null);

  // ── Custom category management ─────────────────────────────
  // Seed from existing equipment data, allow manager to add new ones
  const [customCategories, setCustomCategories] = useState(() => {
    try { return JSON.parse(localStorage.getItem("iet_equip_categories") || "null") || null; }
    catch(e) { return null; }
  });
  const saveCustomCategories = (cats) => {
    setCustomCategories(cats);
    localStorage.setItem("iet_equip_categories", JSON.stringify(cats));
  };
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState("");

  const allItems = useMemo(() => localItems || equipment, [localItems, equipment]);

  // All known categories: union of data-derived + custom additions, per type
  const allCategories = useMemo(() => {
    const fromData = allItems.map(e => e.category).filter(Boolean);
    const custom   = customCategories || [];
    return [...new Set([...fromData, ...custom])].sort();
  }, [allItems, customCategories]);

  // Categories filtered to the current type selection
  const filteredCategories = useMemo(() => {
    if (typeFilter === "All") return allCategories;
    const fromType = allItems.filter(e => e.type === typeFilter).map(e => e.category).filter(Boolean);
    const custom   = customCategories || [];
    return [...new Set([...fromType, ...custom])].sort();
  }, [allItems, typeFilter, allCategories, customCategories]);

  // Build a set of all WBS codes currently in the catalogue for duplicate detection
  const usedWbsCodes = useMemo(() => new Set(allItems.map(e => e.wbs_code).filter(Boolean)), [allItems]);
  // Also check supply items - a wbs_code already in supply can receive equipment link but shouldn't be a NEW catalogue entry
  const supplyWbsCodes = useMemo(() => new Set((supply||[]).map(s => s.wbs_code).filter(Boolean)), [supply]);

  // ── New item form ─────────────────────────────────────────
  const [newItem, setNewItem] = useState({
    type:"PCE", description:"", category:"", make_model:"",
    wbs_code:"", contract_no:"", price:"", lead_time_weeks:"", unit:"EA", comments:""
  });

  // WBS code validation state
  const wbsVal = newItem.wbs_code.trim();
  const wbsInCatalogue = wbsVal && usedWbsCodes.has(wbsVal);
  const wbsInSupply    = wbsVal && supplyWbsCodes.has(wbsVal);
  const wbsOk          = wbsVal && !wbsInCatalogue;

  const filtered = useMemo(() => allItems.filter(e => {
    const mt = typeFilter === "All" || e.type === typeFilter;
    const mc = catFilter  === "All" || e.category === catFilter;
    const ms = !search || e.description?.toLowerCase().includes(search.toLowerCase())
      || e.wbs_code?.toLowerCase().includes(search.toLowerCase())
      || e.make_model?.toLowerCase().includes(search.toLowerCase());
    return mt && mc && ms;
  }), [allItems, typeFilter, catFilter, search]);

  const startEdit = (item) => {
    setEditing(item.id);
    setEditVals({
      price: item.price, wbs_code: item.wbs_code, contract_no: item.contract_no||"",
      lead_time_weeks: item.lead_time_weeks||"", comments: item.comments||""
    });
  };

  const saveEdit = (itemId) => {
    const base = localItems || equipment;
    setLocalItems(base.map(e => e.id === itemId ? {
      ...e,
      price:            parseFloat(editVals.price) || e.price,
      wbs_code:         editVals.wbs_code || e.wbs_code,
      contract_no:      editVals.contract_no,
      lead_time_weeks:  parseFloat(editVals.lead_time_weeks) || 0,
      is_llt:           parseFloat(editVals.lead_time_weeks) > 20,
      type:             parseFloat(editVals.lead_time_weeks) > 20 ? "LLT" : (e.source==="SCADA"?"SCADA":e.source==="Comms"?"COMMS":"PCE"),
      comments:         editVals.comments,
    } : e));
    setEditing(null);
  };

  const addNewItem = () => {
    if (!newItem.description.trim() || wbsInCatalogue) return;
    const base = localItems || equipment;
    const id   = `CUSTOM-${Date.now()}`;
    setLocalItems([...base, {
      ...newItem, id, source: "Custom",
      price:           parseFloat(newItem.price) || 0,
      lead_time_weeks: parseFloat(newItem.lead_time_weeks) || 0,
      is_llt:          parseFloat(newItem.lead_time_weeks) > 20,
      type:            parseFloat(newItem.lead_time_weeks) > 20 ? "LLT" : newItem.type,
      make_model:      newItem.make_model, voltage: "", is_poa: !newItem.price,
      current_price:   parseFloat(newItem.price) || 0,
      escalated_price: parseFloat(newItem.price) || 0,
    }]);
    setShowAdd(false);
    setNewItem({ type:"PCE", description:"", category:"", make_model:"", wbs_code:"", contract_no:"", price:"", lead_time_weeks:"", unit:"EA", comments:"" });
  };

  const addCategory = () => {
    const trimmed = newCategoryInput.trim();
    if (!trimmed) return;
    const existing = customCategories || allCategories;
    if (!existing.includes(trimmed)) {
      saveCustomCategories([...existing, trimmed]);
    }
    setNewCategoryInput("");
    setShowAddCategory(false);
    setNewItem(p => ({...p, category: trimmed}));
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
          {["All","PCE","LLT","SCADA","COMMS"].map(t => (
            <button key={t} onClick={() => { setTypeFilter(t); setCatFilter("All"); }}
              className={`w-full text-left flex items-center justify-between px-2 py-1 rounded text-xs mb-0.5 ${typeFilter===t?"bg-teal-600 text-white":"text-gray-700 hover:bg-gray-100"}`}>
              <span>{t==="All" ? "All Types" : `${TYPE_COLORS[t]?.icon} ${TYPE_COLORS[t]?.label}`}</span>
              <span className={`text-xs px-1 rounded font-mono ${typeFilter===t?"bg-teal-500 text-white":"bg-gray-100 text-gray-500"}`}>
                {t==="All" ? allItems.length : allItems.filter(e=>e.type===t).length}
              </span>
            </button>
          ))}
        </div>
        <div className="px-3 py-2 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</div>
            <button onClick={() => setShowAddCategory(s => !s)}
              className="text-xs text-teal-600 hover:text-teal-800 font-semibold" title="Add new category">+ Add</button>
          </div>
          {showAddCategory && (
            <div className="mb-2">
              <input autoFocus value={newCategoryInput} onChange={e => setNewCategoryInput(e.target.value)}
                onKeyDown={e => { if(e.key==="Enter") addCategory(); if(e.key==="Escape") setShowAddCategory(false); }}
                placeholder="New category name…"
                className="w-full border border-teal-300 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-400 mb-1"/>
              <div className="flex gap-1">
                <button onClick={addCategory} disabled={!newCategoryInput.trim()}
                  className="flex-1 text-[10px] bg-teal-700 disabled:opacity-40 hover:bg-teal-600 text-white rounded px-1 py-0.5 font-semibold">Add</button>
                <button onClick={() => { setShowAddCategory(false); setNewCategoryInput(""); }}
                  className="flex-1 text-[10px] border border-gray-300 text-gray-600 hover:bg-gray-50 rounded px-1 py-0.5">Cancel</button>
              </div>
            </div>
          )}
          <button onClick={() => setCatFilter("All")}
            className={`w-full text-left px-2 py-1 rounded text-xs mb-0.5 ${catFilter==="All"?"bg-teal-50 text-teal-700 font-semibold":"text-gray-600 hover:bg-gray-50"}`}>
            All Categories
          </button>
          {filteredCategories.map(c => (
            <button key={c} onClick={() => setCatFilter(c)}
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
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search description, WBS, make/part…"
            className="border border-gray-300 rounded px-2 py-1.5 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-teal-400"/>
          {search && <button onClick={() => setSearch("")} className="text-xs text-gray-400 hover:text-gray-600">✕</button>}
          <span className="text-xs text-gray-400">{filtered.length} items</span>
          <div className="flex-1"/>
          <button onClick={() => setShowAdd(s => !s)}
            className={`text-xs px-3 py-1.5 rounded font-semibold ${showAdd?"bg-gray-200 text-gray-700":"bg-green-700 hover:bg-green-600 text-white"}`}>
            {showAdd ? "✕ Cancel" : "+ Add Item"}
          </button>
        </div>

        {/* Add new item form */}
        {showAdd && (
          <div className="bg-green-50 border-b border-green-200 px-4 py-3 flex-shrink-0">
            <div className="text-xs font-bold text-green-800 mb-2 uppercase tracking-wide">Add New Equipment Item</div>
            <div className="grid grid-cols-6 gap-2 items-start">

              {/* Row 1 */}
              <div className="col-span-2">
                <label className="text-xs text-gray-500 block mb-0.5">Description *</label>
                <input value={newItem.description} onChange={e => setNewItem(p => ({...p, description:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Type</label>
                <select value={newItem.type} onChange={e => setNewItem(p => ({...p, type:e.target.value, category:""}))}
                  className="w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-green-400">
                  {["PCE","SCADA","COMMS","LLT"].map(t => (
                    <option key={t} value={t}>{TYPE_COLORS[t]?.icon} {TYPE_COLORS[t]?.label||t}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-0.5">
                  Category
                  <button onClick={() => setShowAddCategory(s => !s)}
                    className="ml-1 text-teal-600 hover:text-teal-800 font-semibold" title="Add new category">+ new</button>
                </label>
                {showAddCategory ? (
                  <div className="flex gap-1">
                    <input autoFocus value={newCategoryInput}
                      onChange={e => setNewCategoryInput(e.target.value)}
                      onKeyDown={e => { if(e.key==="Enter") addCategory(); if(e.key==="Escape") setShowAddCategory(false); }}
                      placeholder="New category…"
                      className="flex-1 border border-teal-300 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-400"/>
                    <button onClick={addCategory} disabled={!newCategoryInput.trim()}
                      className="text-[10px] bg-teal-700 disabled:opacity-40 text-white rounded px-1.5 py-1 font-semibold">✓</button>
                    <button onClick={() => { setShowAddCategory(false); setNewCategoryInput(""); }}
                      className="text-[10px] border border-gray-300 text-gray-600 hover:bg-gray-50 rounded px-1.5 py-1">✕</button>
                  </div>
                ) : (
                  <select value={newItem.category} onChange={e => setNewItem(p => ({...p, category:e.target.value}))}
                    className="w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-green-400">
                    <option value="">— select category —</option>
                    {filteredCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Make / Part No.</label>
                <input value={newItem.make_model} onChange={e => setNewItem(p => ({...p, make_model:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-0.5">WBS Code</label>
                <input value={newItem.wbs_code} onChange={e => setNewItem(p => ({...p, wbs_code:e.target.value}))}
                  placeholder="e.g. 3.2.1.02.1.05"
                  className={`w-full border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 ${
                    wbsInCatalogue ? "border-red-400 bg-red-50 focus:ring-red-400"
                    : wbsInSupply  ? "border-amber-400 bg-amber-50 focus:ring-amber-400"
                    : wbsOk        ? "border-green-400 bg-green-50 focus:ring-green-400"
                    : "focus:ring-green-400"
                  }`}/>
                {wbsInCatalogue && (
                  <div className="text-xs text-red-600 mt-0.5 flex items-center gap-1">
                    🚫 WBS code already in catalogue — cannot add duplicate
                  </div>
                )}
                {wbsInSupply && !wbsInCatalogue && (
                  <div className="text-xs text-amber-700 mt-0.5 flex items-center gap-1">
                    ℹ️ This WBS code exists in supply items — linking is allowed
                  </div>
                )}
                {wbsOk && !wbsInSupply && (
                  <div className="text-xs text-green-700 mt-0.5">✓ WBS code available</div>
                )}
              </div>

              {/* Row 2 */}
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Contract No.</label>
                <input value={newItem.contract_no} onChange={e => setNewItem(p => ({...p, contract_no:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Price ($)</label>
                <input type="number" value={newItem.price} onChange={e => setNewItem(p => ({...p, price:e.target.value}))}
                  placeholder="0 = POA"
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Lead Time (wks)</label>
                <input type="number" value={newItem.lead_time_weeks} onChange={e => setNewItem(p => ({...p, lead_time_weeks:e.target.value}))}
                  placeholder=">20 = LLT"
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500 block mb-0.5">Comments</label>
                <input value={newItem.comments} onChange={e => setNewItem(p => ({...p, comments:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
              </div>
              <div className="flex items-end">
                <button onClick={addNewItem}
                  disabled={!newItem.description.trim() || wbsInCatalogue}
                  title={wbsInCatalogue ? "WBS code already in catalogue" : !newItem.description.trim() ? "Description required" : ""}
                  className="w-full text-xs bg-green-700 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded font-semibold">
                  {wbsInCatalogue ? "🚫 Duplicate WBS" : "Add Item"}
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
                const isEd = editing === item.id;
                const tc   = TYPE_COLORS[item.type] || {badge:"bg-gray-100 text-gray-500", icon:"•"};
                return (
                  <tr key={item.id}
                    className={`border-b transition-colors ${idx%2===0?"bg-white":"bg-gray-50"} hover:bg-blue-50`}>
                    <td className="px-2 py-1.5">
                      <span className={`text-xs px-1 py-0.5 rounded font-medium ${tc.badge}`}>{tc.icon}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      {isEd
                        ? <input value={editVals.wbs_code} onChange={e => setEditVals(p => ({...p, wbs_code:e.target.value}))}
                            className="w-full border border-blue-300 rounded px-1 py-0.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"/>
                        : <span className="font-mono text-blue-600">{item.wbs_code || <span className="text-orange-400 italic">TBA</span>}</span>
                      }
                    </td>
                    <td className="px-2 py-1.5 text-gray-800 max-w-xs">
                      <div className="truncate font-medium">{item.description}</div>
                      {isEd
                        ? <input value={editVals.comments} onChange={e => setEditVals(p => ({...p, comments:e.target.value}))}
                            placeholder="Comments…"
                            className="w-full mt-0.5 border border-gray-300 rounded px-1 py-0.5 text-xs text-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"/>
                        : item.comments && <div className="text-gray-400 text-[10px] truncate">{item.comments}</div>
                      }
                    </td>
                    <td className="px-2 py-1.5 text-gray-500 text-[11px]">{item.category||"—"}</td>
                    <td className="px-2 py-1.5 text-gray-600 text-[11px] truncate max-w-[110px]">{item.make_model||"—"}</td>
                    <td className="px-2 py-1.5">
                      {isEd
                        ? <input value={editVals.contract_no} onChange={e => setEditVals(p => ({...p, contract_no:e.target.value}))}
                            className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400"/>
                        : <span className="text-gray-500 text-[11px]">{item.contract_no||"—"}</span>
                      }
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {isEd
                        ? <input type="number" value={editVals.lead_time_weeks}
                            onChange={e => setEditVals(p => ({...p, lead_time_weeks:e.target.value}))}
                            className="w-14 border border-red-300 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-red-400"/>
                        : item.lead_time_weeks > 0
                          ? <span className={`font-semibold ${item.lead_time_weeks>20?"text-red-600":"text-gray-500"}`}>{item.lead_time_weeks}w</span>
                          : <span className="text-gray-300">—</span>
                      }
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {isEd
                        ? <input type="number" value={editVals.price}
                            onChange={e => setEditVals(p => ({...p, price:e.target.value}))}
                            className="w-full border border-green-300 rounded px-1 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-green-400"/>
                        : item.is_poa || !item.price
                          ? <span className="text-amber-600 font-semibold text-[11px]">POA</span>
                          : <span className="font-semibold text-gray-800">${(item.price||0).toLocaleString("en-AU")}</span>
                      }
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {isEd ? (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => saveEdit(item.id)}
                            className="bg-blue-700 hover:bg-blue-600 text-white px-1.5 py-0.5 rounded text-[10px] font-semibold">Save</button>
                          <button onClick={() => setEditing(null)}
                            className="border border-gray-300 text-gray-600 hover:bg-gray-50 px-1.5 py-0.5 rounded text-[10px]">✕</button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(item)}
                          className="text-blue-500 hover:text-blue-700 text-[10px] border border-blue-200 hover:border-blue-400 px-1.5 py-0.5 rounded">Edit</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center text-gray-400 text-sm py-16">No items match your filters.</div>
          )}
        </div>
      </div>
    </div>
  );
}

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
  {id:"financial", label:"💰 Financial Report"},
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
  const [resourceCodes,setResourceCodes]= useState({});
  const [invMats,      setInvMats]      = useState([]);
  const [matAssemblies,setMatAssemblies]= useState([]);
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
      fetch(`${BASE}data/inventory_materials.json`).then(r=>{if(!r.ok)return [];return r.json();}).catch(()=>[]),
      fetch(`${BASE}data/material_assemblies.json`).then(r=>{if(!r.ok)return [];return r.json();}).catch(()=>[]),
    ])
    .then(([wbs,rates,supply,equip,lookup,commLookup,escRatesData,resourceCodesData,invMatsData,matAssData])=>{
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
      setInvMats(Array.isArray(invMatsData) ? invMatsData : []);
      setMatAssemblies(Array.isArray(matAssData) ? matAssData : []);
      setLoading(false);
    })
    .catch(err=>{setError(err.message);setLoading(false);});
  },[]);

  const saveInvestment = useCallback(()=>{
    const supply = supplyData;
    const entered = supply.filter(s=>parseFloat(lines[s.wbs_code]?.qty||"0")>0);
    const totals = entered.reduce((a,item)=>{
      const ln=lines[item.wbs_code]||{};
      const c=calcLine(item,ln.qty||"",ln.factor||"1",ln.delivery,ln.instHrsOvrd,ln.contrRate,ln.plant,ln.mats,isCommercial,ln.resourceOvrd,null,0);
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
    <DataCtx.Provider value={{wbs:wbsData,rates:ratesData,supply:supplyData,equipment:equipData,equipLookup,commLookup,commProfiles,escRates,resourceCodes,invMats,matAssemblies,loading,error}}>
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
                {estTab==="financial" && <FinancialScreen inv={inv} lines={lines} isCommercial={isCommercial}/>}
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
