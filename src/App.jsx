import { useState, useMemo, useEffect, useCallback, createContext, useContext, useRef, Component } from "react";

// ═══════════════════════════════════════════════════════════════════
// IET ESTIMATION TOOL — FULL SCALE DEMO
// Live data from GitHub Pages /data/ JSON files
// LocalStorage persistence for investment saves
// ═══════════════════════════════════════════════════════════════════

const BASE = import.meta.env.BASE_URL || "/";

// ── DATA CONTEXT ────────────────────────────────────────────────
const DataCtx = createContext({ wbs:[], rates:[], supply:[], equipment:[], equipLookup:{}, commLookup:{}, commProfiles:{}, escRates:null, resourceCodes:{}, invMats:[], matAssemblies:[], equipPricing:{}, loading:true, error:null });

// ── COPPERLEAF CSV EXPORT ────────────────────────────────────────
// Matches Sync_To_C55 macro structure exactly:
//   - GROUP rows for each L1/L2/L3 WBS level
//   - SPEND rows per labour/contractor resource type (Hours or Dollars)
//   - Materials (Non-LLT): one aggregated Dollar row per L3.
//     SCADA and Comms equipment costs roll into this row — NOT separate named lines.
//   - Materials (LLT): one row per PCE item, Spend Name always "Materials (LLT)",
//     no item description (matches original macro Spend_Template blank LLT rows).
// ── WBS GROUP LABELS — exact text from Copperleaf Spend_Template ─────────────
const WBS_GROUP_LABELS = {
  "1":     "1 - PLANNING",
  "1.1":   "1.1 - Major Network Connections (Commercial)",
  "1.1.1": "1.1.1 - Commercial",
  "1.2":   "1.2 - Network Planning",
  "1.2.1": "1.2.1 - Network Planning",
  "1.3":   "1.3 - Network  Development (Investment Development)",
  "1.3.1": "1.3.1 - Investment Development",
  "2":     "2 - DESIGN",
  "2.1":   "2.1 - Zone Substation Design",
  "2.1.1": "2.1.1 - Zone Substation Design",
  "2.2":   "2.2 - Communications (Comms) Design",
  "2.2.1": "2.2.1 - Communications (Comms) Design",
  "2.3":   "2.3 - Subtransmission Mains Design",
  "2.3.1": "2.3.1 - Subtransmission Mains Design",
  "2.4":   "2.4 - Distribution Mains Design",
  "2.4.1": "2.4.1 - Distribution Mains Design",
  "2.5":   "2.5 - Land and Routes Design",
  "2.5.1": "2.5.1 - Land and Routes Design",
  "2.6":   "2.6 - Ancillary Design (Engineering Design)",
  "2.6.1": "2.6.1 - Ancillary Design (Engineering Design)",
  "3":     "3 - CONSTRUCTION",
  "3.1":   "3.1 - Zone Substation Construction",
  "3.1.1": "3.1.1 - Civil Construction",
  "3.1.2": "3.1.2 - Building Construction",
  "3.1.3": "3.1.3 - Electrical Construction",
  "3.1.4": "3.1.4 - ZS Procurement",
  "3.1.5": "3.1.5 - ZS Disposal",
  "3.2":   "3.2 - Communications (Comms) Construction",
  "3.2.1": "3.2.1 - Substations Communications (Comms) Construction",
  "3.2.2": "3.2.2 - Optical Fibre Cabling/Construction",
  "3.2.3": "3.2.3 - Comms Procurement",
  "3.3":   "3.3 - Subtransmission Mains (SM) Construction",
  "3.3.1": "3.3.1 - SM Construction",
  "3.3.2": "3.3.2 - SM Procurement",
  "3.3.3": "3.3.3 - SM Disposal (Placeholder Only)",
  "3.4":   "3.4 - Distribution Mains Construction (Placeholder Only)",
  "3.4.1": "3.4.1 - TBD (Placeholder Only)",
  "3.4.2": "3.4.2 - DM Procurement (Placeholder Only)",
  "3.4.3": "3.4.3 - DM Disposal (Placeholder Only)",
  "3.5":   "3.5 - Ancillary Construction",
  "3.5.1": "3.5.1 - Ancillary Construction",
  "4":     "4 - COMMISSIONING",
  "4.1":   "4.1 - EE's Commissioning",
  "4.1.1": "4.1.1 - Commissioning of Zone Substation Civil Construction",
  "4.1.2": "4.1.2 - Commissioning of Zone Substation Electrical Construction",
  "4.1.3": "4.1.3 - Commissioning of  Communication (Comms) Construction: Comms Systems & Accessories (Substations)",
  "4.1.4": "4.1.4 - Commissioning of Communication (Comms) Construction: Optical Fibre Cabling/Construction",
  "4.1.5": "4.1.5 - Commissioning of  Subtransmission Mains (SM) Construction",
  "4.1.6": "4.1.6 - Commissioning of Ancillary Construction",
  "5":     "5 - MONITORING & CONTROL",
  "5.1":   "5.1 - Monitoring & Control - General",
  "5.1.1": "5.1.1 - Project Management",
  "5.1.2": "5.1.2 - Project Management Procurement",
  "5.2":   "5.2 - Project Close-Out",
  "5.2.1": "5.2.1 - Project Close-Out",
};


// Generate Copperleaf-format XLSX (matches Spend_Template exactly)
// Returns a Blob for download — uses SheetJS (xlsx) loaded at runtime
async function generateCopperleafXLSX(inv, lines, supply, commLookup, commProfiles, escRates, resourceCodes, isCommercial, equipLookup) {
  // Dynamically load SheetJS if not already present
  if (!window.XLSX) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const XL = window.XLSX;

  const isComm = inv.type === "Commercially Funded";
  // Account code is per-resource: Internal=001001, External/Commercial=001000

  // ── Project timeline ─────────────────────────────────────────
  const planStart = parseInt(inv.planStart||1),  planDur  = parseInt(inv.planDur||4);
  const desStart  = parseInt(inv.designStart||1), desDur   = parseInt(inv.designDur||9);
  const conStart  = parseInt(inv.constrStart||6), conDur   = parseInt(inv.constrDur||15);
  const totalMonths = Math.max(planStart+planDur, desStart+desDur, conStart+conDur) - 1;

  const phaseMonths = {
    "1": Array.from({length:planDur}, (_,i)=>planStart+i),
    "2": Array.from({length:desDur},  (_,i)=>desStart+i),
    "3": Array.from({length:conDur},  (_,i)=>conStart+i),
    "4": Array.from({length:conDur},  (_,i)=>conStart+i),
    "5": [conStart+conDur-1, conStart+conDur],
  };

  const MON_IDX = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
  const startMonNum = MON_IDX[inv.startMonth||"Jul"] || 7;
  const startYr = parseInt(inv.startYear||2025);

  // Returns a JS Date for the given project month number (1-based)
  const monthDate = (monthNum) => {
    const totalOffset = startMonNum - 1 + monthNum - 1;
    const yr = startYr + Math.floor(totalOffset / 12);
    const mo = (totalOffset % 12) + 1;
    // Return Excel date serial (numeric) — Copperleaf requires plain numeric date serials, not ISO strings.
    // Excel serial = days since 1900-01-00 (25569 offset from JS epoch + Lotus bug adds 1).
    const d = new Date(Date.UTC(yr, mo - 1, 1));
    return Math.round(d.getTime() / 86400000) + 25569;
  };

  // ── Escalation ───────────────────────────────────────────────
  const escFactor = (phaseKey, cat) => {
    if (!escRates) return 0;
    const ratesArr = Object.values(escRates[cat].rates).map(r=>r/100);
    const months = phaseMonths[phaseKey] || [];
    if (!months.length) return 0;
    return months.reduce((s,m) => s + escalationIndex(m, ratesArr), 0) / months.length;
  };

  // ── Resource helpers — resource_codes.json keyed by resource_name ──────────
  // account codes: Internal=001001, External/Commercial=001000 (per workbook Spend_Template)
  const rc          = (n) => resourceCodes[n] || {};
  const getResCode      = (n) => rc(n).resource_code  || "GMAT";
  const getCurrencyType = (n) => rc(n).currency_type  || "Dollar";
  const getLabourType   = (n) => rc(n).labour_type    || "";
  const getAcctCode     = (n) => isComm
    ? (rc(n).account_code_external || "001000")
    : (rc(n).account_code_internal || "001001");
  const getEquipSource  = (wbs) => (equipLookup?.[wbs])?.source || "PCE";

  // ── Rows accumulator ─────────────────────────────────────────
  // Each row is an array of cell values (index 0-16 = static cols, 17+ = month dates)
  // Date cells will be actual JS Date objects so SheetJS serialises them as Excel dates
  const monthDates = Array.from({length:totalMonths}, (_,i) => monthDate(i+1));

  // Header row: 17 static labels + Date objects for each month
  const STATIC_HDRS = [
    "Group Path","Group Description","Id","Row Type","Currency / Unit",
    "Spend Name","Currency / Unit Type","Is Unshiftable","Account Code",
    "Resource Code","Labour Type",
    "LLT Description","LLT Item","LLT Quantity","Make / Model","Stock/Contract number","Voltage"
  ];
  const headerRow = [...STATIC_HDRS, ...monthDates];
  const rows = [headerRow];

  // ── Helper: write a GROUP row ─────────────────────────────────
  const writtenL1 = new Set(), writtenL2 = new Set(), writtenL3 = new Set();

  const writeGroup = (code) => {
    const label = WBS_GROUP_LABELS[code] || code;
    const parts = code.split(".");
    const depth = parts.length;
    const levelStr = depth === 1 ? "WBS Level 1" : depth === 2 ? "WBS Level 2" : "WBS Level 3";
    // Build the full backslash path
    let fullPath = label;
    if (depth >= 2) {
      const l1 = WBS_GROUP_LABELS[parts[0]] || parts[0];
      const l2 = WBS_GROUP_LABELS[parts.slice(0,2).join(".")] || parts.slice(0,2).join(".");
      fullPath = depth === 2 ? `${l1}\\${l2}` : `${l1}\\${l2}\\${label}`;
    }
    const row = new Array(17 + totalMonths).fill("");
    row[0] = fullPath;   // Group Path
    row[1] = levelStr;   // Group Description
    row[2] = code;       // Id
    row[3] = "Group";    // Row Type
    // col 4 (Currency/Unit) blank for Group
    row[5] = label;      // Spend Name = last segment label
    rows.push(row);
  };

  const ensureGroups = (l3code) => {
    const parts = l3code.split(".");
    const l1 = parts[0];
    const l2 = parts.slice(0,2).join(".");
    if (!writtenL1.has(l1)) { writtenL1.add(l1); writeGroup(l1); }
    if (!writtenL2.has(l2)) { writtenL2.add(l2); writeGroup(l2); }
    if (!writtenL3.has(l3code)) { writtenL3.add(l3code); writeGroup(l3code); }
  };

  // ── Helper: write a SPEND row ─────────────────────────────────
  const writeSpend = (l3code, spendName, currType, resCode, labourType, perMonthByMonthIdx, metaCols={}) => {
    const row = new Array(17 + totalMonths).fill("");
    // Cols A/B/C (group path/description/id) must be BLANK on Spend rows — working VBA export leaves these empty
    row[3] = "Spend";
    row[4] = "Unit";
    row[5] = spendName;
    row[6] = currType;
    row[7] = 0;
    row[8] = { t:"s", v:getAcctCode(spendName), z:"@" }; // text+@ — Copperleaf requires '001000 apostrophe prefix
    row[9] = resCode;
    row[10] = labourType;
    // Optional LLT/material metadata cols 11-16
    if (metaCols.lltDesc)     row[11] = metaCols.lltDesc;
    if (metaCols.lltItem)     row[12] = metaCols.lltItem;
    if (metaCols.lltQty)      row[13] = metaCols.lltQty;
    if (metaCols.makeModel)   row[14] = metaCols.makeModel;
    if (metaCols.contractNo)  row[15] = metaCols.contractNo;
    if (metaCols.voltage)     row[16] = metaCols.voltage;
    // Spread spend across month columns
    perMonthByMonthIdx.forEach(([mIdx, val]) => {
      // mIdx is 1-based project month; col index = 17 + (mIdx-1)
      const ci = 17 + (mIdx - 1);
      if (ci < row.length) row[ci] = val;
    });
    rows.push(row);
  };

  // ── Group entered supply items by L3 ─────────────────────────
  const entered = supply.filter(s => parseFloat(lines[s.wbs_code]?.qty||"0") > 0);

  const byL3 = {};
  entered.forEach(item => {
    const parts = item.wbs_code.split(".");
    const l1 = parts[0], l3 = parts.slice(0,3).join(".");
    if (!byL3[l3]) byL3[l3] = { l1, items:[] };
    byL3[l3].items.push(item);
  });

  // ── COMMISSION aggregation by L3 ─────────────────────────────
  const commByL3 = {};
  entered.forEach(item => {
    const cw = item.commission_wbs;
    if (!cw || !commLookup[cw]) return;
    if (commLookup[cw].direct_entry) return; // handled below
    const qty = parseFloat(lines[item.wbs_code]?.qty||"0") * parseFloat(lines[item.wbs_code]?.factor||"1");
    const l3 = cw.split(".").slice(0,3).join(".");
    if (!commByL3[l3]) commByL3[l3] = {};
    commByL3[l3][cw] = (commByL3[l3][cw]||0) + qty;
  });
  // Add direct-entry commission rows (earthing, PSN/CSN, misc)
  Object.entries(commLookup).filter(([,d])=>d.direct_entry).forEach(([cw, data])=>{
    const dq = parseFloat(lines[`comm_direct_${cw}`]?.qty||"0")||0;
    if (dq <= 0) return;
    const l3 = cw.split(".").slice(0,3).join(".");
    if (!commByL3[l3]) commByL3[l3] = {};
    commByL3[l3][cw] = (commByL3[l3][cw]||0) + dq;
  });

  // ── Write supply/install/design phases (1, 2, 3, 5) ──────────
  Object.entries(byL3).sort().forEach(([l3, {l1, items}]) => {
    const phase = l1;
    const phMonths = phaseMonths[phase] || [];
    if (!phMonths.length) return;

    ensureGroups(l3);

    // Aggregate labour/contractor by resource name
    const costByRes = {};
    items.forEach(item => {
      const ln = lines[item.wbs_code] || {};
      const c = calcLine(item, ln.qty||"", ln.factor||"1", ln.delivery, ln.instHrsOvrd,
                         ln.contrRate, ln.plant, ln.mats, isCommercial, ln.resourceOvrd, null, 0);
      const isContr = (ln.delivery||item.delivery_method||"") === "Contractor Delivered";
      const res = isContr ? "Contractor" : (item.resource_main || "ZS Electrical Technician");
      if (!costByRes[res]) costByRes[res] = {hours:0, dollars:0};
      if (getCurrencyType(res) === "Hour") costByRes[res].hours  += c.installHrs || 0;
      else                                  costByRes[res].dollars += c.contrCost  || 0;
      // WAFHA days
      if (isWAFHAItem(item) && (c.installHrs||0) > 0) {
        const wDays = parseFloat(ln.qty||"0") * parseFloat(ln.factor||"1");
        if (!costByRes["Work Away From Home"]) costByRes["Work Away From Home"] = {hours:0, dollars:0};
        costByRes["Work Away From Home"].hours += wDays;
      }
    });

    Object.entries(costByRes).forEach(([resName, costs]) => {
      const currType = getCurrencyType(resName);
      const isWAFHA  = resName === "Work Away From Home";
      const totalVal = isWAFHA ? costs.hours : (currType === "Hour" ? costs.hours : costs.dollars);
      if (totalVal <= 0) return;
      const cat = currType !== "Hour" ? "contractors" : "internal_ee";
      const ef  = escFactor(phase, cat);
      const perMonth = (totalVal * (1+ef)) / phMonths.length;
      const monthSpend = phMonths.map(m => [m, parseFloat(perMonth.toFixed(6))]);
      writeSpend(l3, resName, isWAFHA ? "Day" : currType,
                 getResCode(resName), getLabourType(resName), monthSpend);
    });

    // Material rows
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
        const eq = equipLookup?.[item.wbs_code] || null;
        lltRows.push({
          totalMat, effQty,
          desc:       (eq?.description || item.description || "").substring(0, 120),
          category:   eq?.category    || "",
          makeModel:  [eq?.make, eq?.model].map(v=>(!v||v==="nan"||v==="NaN")?"":String(v).trim()).filter(Boolean).join(" / "),
          contractNo: (!eq?.contract_no||eq?.contract_no==="nan"||eq?.contract_no==="NaN")?"":String(eq.contract_no).trim(),
          voltage:    (!eq?.voltage&&!eq?.family)?"":(!eq?.voltage||eq?.voltage==="nan")?String(eq?.family||"").trim():String(eq.voltage).trim(),
        });
      }
    });

    if (nonLLTTotal > 0) {
      const perMonth = nonLLTTotal / phMonths.length;
      writeSpend(l3, "Materials (Non-LLT)", "Dollar", "GMAT", "",
                 phMonths.map(m=>[m, parseFloat(perMonth.toFixed(6))]));
    }

    lltRows.forEach(({totalMat, effQty, desc, category, makeModel, contractNo, voltage}) => {
      const perMonth = totalMat / phMonths.length;
      writeSpend(l3, "Materials (LLT)", "Dollar", "LLMAT", "",
                 phMonths.map(m=>[m, parseFloat(perMonth.toFixed(6))]),
                 { lltDesc:desc, lltItem:category, lltQty:String(effQty),
                   makeModel, contractNo, voltage });
    });
  });

  // ── Commissioning (Phase 4) ───────────────────────────────────
  Object.entries(commByL3).sort().forEach(([l3, commWbsMap]) => {
    const phMonths = phaseMonths["4"] || [];
    if (!phMonths.length) return;

    ensureGroups(l3);

    // Aggregate hours per resource type in this L3
    const hrsByRes = {};
    Object.entries(commWbsMap).forEach(([cw, qty]) => {
      const cd = commLookup[cw];
      if (!cd) return;
      const scale = getScaleFactor(commProfiles, cd.profile_id, qty);
      const ovrd  = lines[`comm_ovrd_${cw}`]?.qty;
      const hrs   = (ovrd !== undefined && ovrd !== "") ? (parseFloat(ovrd)||0) : qty*(cd.hrs_per_unit||0)*scale;
      if (hrs <= 0) return;
      const res = cd.resource_type || "ZS Specialist Technician";
      hrsByRes[res] = (hrsByRes[res]||0) + hrs;
    });

    Object.entries(hrsByRes).forEach(([resName, totalHrs]) => {
      if (totalHrs <= 0) return;
      const ef = escFactor("4", "internal_ee");
      const perMonth = (totalHrs * (1+ef)) / phMonths.length;
      writeSpend(l3, resName, "Hour", getResCode(resName), getLabourType(resName),
                 phMonths.map(m=>[m, parseFloat(perMonth.toFixed(6))]));
    });
  });

  // ── Build workbook ────────────────────────────────────────────
  const wb = XL.utils.book_new();

  // Convert rows to AOA (array of arrays) for SheetJS
  // Date values will be formatted as Excel date serials
  const ws = XL.utils.aoa_to_sheet(rows);
  // Post-process header row: month serials are plain numbers — stamp mmm-yy format
  // and ensure type is numeric (n), NOT date (d) — Copperleaf reads the serial directly.
  for (let m = 0; m < totalMonths; m++) {
    const colIdx = 17 + m;
    const colLetter = XL.utils.encode_col(colIdx);
    const addr = colLetter + "1";
    if (ws[addr]) {
      ws[addr].t = "n";
      ws[addr].z = "mmm-yy";
      delete ws[addr].w;
    }
  }
  // Stamp @ format on every cell in col I (Account Code) — including header and empty cells.
  // The working VBA export applies @ to the whole column; Copperleaf validates this.
  for (let r = 1; r <= rows.length; r++) {
    const addr = "I" + r;
    if (!ws[addr]) {
      // Create empty cell with @ format so column-level format is present
      ws[addr] = { t:"s", v:"", z:"@" };
    } else {
      ws[addr].t = "s";
      ws[addr].v = ws[addr].v != null ? String(ws[addr].v) : "";
      ws[addr].z = "@";
      delete ws[addr].w;
    }
  }

  // Set column widths — col I (index 8) gets numFmt @ to match working file
  ws["!cols"] = [
    {wch:80},{wch:20},{wch:12},{wch:10},{wch:12},
    {wch:60},{wch:18},{wch:14},{wch:14,numFmt:"@"},{wch:20},{wch:14},
    {wch:80},{wch:24},{wch:12},{wch:30},{wch:22},{wch:10},
    ...Array(totalMonths).fill({wch:12}),
  ];

  // Freeze top row
  ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2" };

  XL.utils.book_append_sheet(wb, ws, "Spend");

  // Summary sheet — matches template metadata
  const now = new Date();
  const fmtDMY = d => {
    const dd = String(d.getDate()).padStart(2,"0");
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const yyyy = d.getFullYear();
    return dd+"/"+mm+"/"+yyyy;
  };
  const altStartStr = fmtDMY(new Date(startYr, startMonNum-1, 1));
  const exportDateStr = fmtDMY(now);
  const summaryData = [
    ["Please do not edit this worksheet. This worksheet contains critical information for forecast import."],
    ["Investment Name"],
    ["Investment Code"],
    ["Alternative"],
    ["Alternative Start Date", altStartStr],
    ["Export Date", exportDateStr],
    ["Export User", inv.estimatedBy || ""],
    ["Spend Amount", "Inflated"],
    ["Uninflated Fiscal Year"],
    ["Resource Display", "Unit"],
    ["Export spend values as", "Monthly"],
    ["Include loadings", "Yes"],
    ["Alternative ID"],
  ];
  const ws2 = XL.utils.aoa_to_sheet(summaryData);
  ws2["!cols"] = [{wch:70},{wch:20}];
  XL.utils.book_append_sheet(wb, ws2, "Summary");

  // Write to Blob
  const wbout = XL.write(wb, { bookType:"xlsx", type:"array", cellDates:true, bookSST:true });
  return new Blob([wbout], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
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

function Card({ children, className="" }) {
  return <div className={`border border-gray-200 rounded-lg shadow-sm overflow-hidden ${className}`}>{children}</div>;
}

function SectionHeader({ color="orange", title, subtitle }) {
  const c = { blue:"bg-[var(--primary-700)]", orange:"bg-orange-600", green:"bg-green-700",
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

// PIN field for team-leader unlock of approved estimates
// In the demo the PIN is the same manager PIN "1607" — in Power Platform this would be AD role check
function UnlockPinField({ onConfirm, onCancel }) {
  const TEAM_LEADER_PIN = "1607";
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const tryConfirm = () => {
    if (pin === TEAM_LEADER_PIN) { onConfirm(); }
    else { setErr(true); setPin(""); setTimeout(()=>setErr(false),1500); }
  };
  return (
    <div className="space-y-3">
      <input ref={ref} type="password" value={pin} onChange={e=>{setPin(e.target.value);setErr(false);}}
        onKeyDown={e=>{ if(e.key==="Enter") tryConfirm(); if(e.key==="Escape") onCancel(); }}
        placeholder="Enter team leader PIN"
        className={`w-full border rounded px-3 py-2 text-sm text-center tracking-widest font-mono focus:outline-none focus:ring-2 ${err?"border-red-400 ring-red-300 bg-red-50":"border-gray-300 focus:ring-green-400"}`}/>
      {err && <div className="text-xs text-red-600 text-center">Incorrect PIN — try again</div>}
      <div className="flex gap-2">
        <button onClick={onCancel}
          className="flex-1 text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 py-2 rounded font-semibold">
          Cancel
        </button>
        <button onClick={tryConfirm} disabled={!pin}
          className="flex-1 text-xs bg-green-700 hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-400 text-white py-2 rounded font-bold">
          🔓 Confirm &amp; Create Amendment
        </button>
      </div>
    </div>
  );
}

// Contingency resolution: before CART has been run, contingency is the
// estimator's pre-risk percentage applied to the base. Once CART has been
// run for THIS rate stream against a matching base, the $ figure switches
// to the CART P50 and the displayed % becomes that P50 expressed as a
// percentage of base. Re-running CART (or a base change) supersedes it —
// callers compare cartResult.base to the live base to detect staleness.
function resolveContingency(inv, base, isCommercial, tolerance=1){
  const pct = parseFloat(isCommercial?inv.contComm:inv.contInt)||10;
  const cr = inv.cartResult;
  if (cr && cr.isCommercial===isCommercial && Math.abs(cr.base-base)<=tolerance && base>0){
    return { amt:cr.p50, pct: cr.p50/base*100, source:"cart", cr };
  }
  // Fixed dollar contingency (e.g. CART P50 entered in the workbook's
  // General Information D40/D41, imported as a hard $ figure). Added to the
  // base regardless of base value, matching the MASTER Summary behaviour.
  const fixed = parseFloat(isCommercial?inv.contCommDollar:inv.contIntDollar);
  if (fixed && fixed>0){
    return { amt: fixed, pct: base>0 ? fixed/base*100 : 0, source:"fixed" };
  }
  return { amt: base*pct/100, pct, source:"manual" };
}

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
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Investment Number</label>
              <input value={inv.number} onChange={e=>upd("number",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">WACS Number</label>
              <input value={inv.wacs} onChange={e=>upd("wacs",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Investment Type</label>
              <select value={inv.type} onChange={e=>upd("type",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]">
                <option>Internally Funded</option><option>Commercially Funded</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Estimate Class</label>
              <select value={inv.estClass} onChange={e=>upd("estClass",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]">
                {["Class 1","Class 2","Class 3","Class 4","Class 5"].map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1 flex items-center gap-1.5">
                Revision
                {onChange===undefined||onChange===null ? <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-semibold">🔒 Auto on unlock</span> : null}
              </label>
              <div className="relative">
                <select value={inv.revision} onChange={e=>upd("revision",e.target.value)}
                  disabled={!upd||inv._locked}
                  className={`w-full border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)] ${
                    inv._locked ? "bg-green-50 border-green-300 text-green-800 font-bold cursor-not-allowed" : "border-gray-300 bg-white"
                  }`}>
                  {["A","B","C","D","E","F","G","H"].map(r=><option key={r}>{r}</option>)}
                </select>
                {inv._locked && <span className="absolute right-6 top-1/2 -translate-y-1/2 text-[9px] text-green-600 font-semibold pointer-events-none">APPROVED</span>}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Complexity</label>
              <select value={inv.complexity} onChange={e=>upd("complexity",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]">
                {["Medium","High","Very High"].map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">New Technology</label>
              <select value={inv.newTech} onChange={e=>upd("newTech",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]">
                {["Limited","Moderate","Substantial"].map(t=><option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Estimated By</label>
              <select value={inv.estimatedBy} onChange={e=>upd("estimatedBy",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]">
                {ESTIMATORS.map(n=><option key={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Reviewed By</label>
              <select value={inv.reviewedBy} onChange={e=>upd("reviewedBy",e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]">
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
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-600 block mb-1">
                Contingency — Internal
                <span className="text-gray-400 font-normal ml-1">% is the estimator's pre-risk input · $ populates once CART has been run</span>
              </label>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <input type="number" min="0" max="100" step="1" value={inv.contInt}
                    onChange={e=>upd("contInt",e.target.value)}
                    title="Pre-risk contingency percentage — your initial estimate before CART risk modelling"
                    className="w-20 border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400" />
                  <span className="text-xs text-gray-400">% pre-risk</span>
                </div>
                {inv.cartResult && inv.cartResult.isCommercial===false ? (
                  <div className="flex items-center gap-1.5 bg-purple-50 border border-purple-200 rounded px-2 py-1.5">
                    <span className="text-xs">🎲</span>
                    <span className="text-xs font-mono font-bold text-purple-800">{fmt(inv.cartResult.p50)}</span>
                    <span className="text-xs text-purple-500">({(inv.cartResult.p50/(inv.cartResult.base||1)*100).toFixed(1)}% · CART P50)</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-400">$</span>
                    <input type="number" min="0" step="1000" value={inv.contIntDollar}
                      onChange={e=>upd("contIntDollar",e.target.value)}
                      placeholder="CART $ (overrides %)"
                      title="Fixed contingency $ from CART P50 (workbook D40). Overrides the % when set."
                      className="w-32 border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-400" />
                    {inv.contIntDollar ? <span className="text-xs text-purple-600 font-semibold">CART $ active</span> : null}
                  </div>
                )}
              </div>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-600 block mb-1">
                Contingency — Commercial
                <span className="text-gray-400 font-normal ml-1">% is the estimator's pre-risk input · $ populates once CART has been run</span>
              </label>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <input type="number" min="0" max="100" step="1" value={inv.contComm}
                    onChange={e=>upd("contComm",e.target.value)}
                    title="Pre-risk contingency percentage — your initial estimate before CART risk modelling"
                    className="w-20 border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400" />
                  <span className="text-xs text-gray-400">% pre-risk</span>
                </div>
                {inv.cartResult && inv.cartResult.isCommercial===true ? (
                  <div className="flex items-center gap-1.5 bg-purple-50 border border-purple-200 rounded px-2 py-1.5">
                    <span className="text-xs">🎲</span>
                    <span className="text-xs font-mono font-bold text-purple-800">{fmt(inv.cartResult.p50)}</span>
                    <span className="text-xs text-purple-500">({(inv.cartResult.p50/(inv.cartResult.base||1)*100).toFixed(1)}% · CART P50)</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-400">$</span>
                    <input type="number" min="0" step="1000" value={inv.contCommDollar}
                      onChange={e=>upd("contCommDollar",e.target.value)}
                      placeholder="CART $ (overrides %)"
                      title="Fixed contingency $ from CART P50 (workbook D41). Overrides the % when set."
                      className="w-32 border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-400" />
                    {inv.contCommDollar ? <span className="text-xs text-purple-600 font-semibold">CART $ active</span> : null}
                  </div>
                )}
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
                  className="text-xs text-[var(--primary-600)] hover:underline">+ Add milestone</button>}
            </div>
          </div>
        </Card>

        <div className="flex justify-end gap-3 pb-4">
          <button className="px-6 py-2 text-xs bg-[var(--primary-700)] hover:bg-[var(--primary-600)] text-white rounded font-semibold shadow">
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
            ${isPhase ? "font-bold text-[var(--primary-300)] hover:bg-[var(--primary-900)]" : ""}
            ${isSel ? "bg-[var(--primary-600)] text-white" : !isPhase ? "text-gray-300 hover:bg-gray-700" : ""}
          `}
          style={{paddingLeft:`${8+depth*12}px`}}>
          <span className="w-3 text-center text-gray-500 flex-shrink-0">
            {isLeaf ? "·" : (exp ? "▾" : "▸")}
          </span>
          <span className={`font-mono text-xs flex-shrink-0 ${isSel?"text-[var(--primary-200)]":"text-gray-500"}`}>{node.code}</span>
          <span className="ml-1 truncate">{node.label}</span>
          {count > 0 && !isLeaf && (
            <span className={`ml-auto flex-shrink-0 text-xs px-1 rounded ${isSel?"bg-[var(--primary-500)] text-white":"bg-gray-700 text-gray-400"}`}>{count}</span>
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
          className="w-full bg-gray-800 text-white text-xs px-2 py-1.5 rounded border border-gray-700 placeholder-gray-500 focus:outline-none focus:border-[var(--primary-500)]" />
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
        className="flex items-center gap-1.5 text-xs text-[var(--primary-700)] hover:text-[var(--primary-900)] py-1.5 font-medium w-full">
        <span>{open ? "▾" : "▸"}</span>
        <span>📦 Inventory Materials & Assemblies Lookup</span>
        {matchAssembly && <span className="bg-[var(--primary-100)] text-[var(--primary-700)] rounded px-1.5 py-0.5 text-[10px] ml-1">Assembly available</span>}
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
                className={`text-xs px-3 py-2 font-medium border-b-2 transition-colors ${tab===t.id?"border-[var(--primary-600)] text-[var(--primary-700)]":"border-transparent text-gray-500 hover:text-gray-700"}`}>
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
                      <div className="text-xs font-bold text-[var(--primary-700)]">{matchAssembly.total_cost ? `$${matchAssembly.total_cost.toFixed(2)}` : "—"}</div>
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
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs mb-2 focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
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
                        <td className="px-2 py-0.5 text-right font-semibold text-[var(--primary-700)]">{fmtP(item.last_price)}</td>
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

  // Filter supply items for selected L4 group — keep Supply and Install separate
  const allL4Items = useMemo(()=>{
    if (!selectedL4) return [];
    if (navSearch) {
      return supply.filter(s=>
        s.description?.toLowerCase().includes(navSearch.toLowerCase()) ||
        s.wbs_code?.toLowerCase().includes(navSearch.toLowerCase())
      ).slice(0,50);
    }
    return supply.filter(s=>s.l4_group===selectedL4);
  },[supply, selectedL4, navSearch]);

  // Separate Supply rows from Install rows:
  // "Direct-entry" Install rows (no install_wbs parent link) are shown as regular estimatable
  // items — civil earthworks, cable trenching, conductor stringing etc. are priced this way.
  // "Derived" Install rows (have supply items that propagate qty to them) sit in the install
  // section at the bottom and are shown auto-derived, not directly enterable.
  const isDerivedInstall = (s) => s.scope === "Install" && !!s.install_wbs;
  const items = useMemo(()=>
    allL4Items.filter(s => s.scope !== "Install" || !s.install_wbs),
  [allL4Items]);
  const installItems = useMemo(()=>
    allL4Items.filter(s => s.scope === "Install" && !!s.install_wbs),
  [allL4Items]);

  // Build install aggregation: installWbsCode → { item, derivedHrs, derivedQty, linkedSupply[] }
  // derivedHrs = sum of (enteredQty × factor × install_hrs_per) for each supply item → this install
  const installAgg = useMemo(()=>{
    const agg = {};
    installItems.forEach(inst => {
      const linked = allL4Items.filter(s => s.scope !== "Install" && s.install_wbs === inst.wbs_code);
      let derivedHrs = 0;
      let derivedQty = 0;
      linked.forEach(sup => {
        const ln = lines[sup.wbs_code] || {};
        const q  = parseFloat(ln.qty || "0");
        const f  = parseFloat(ln.factor || "1");
        const h  = sup.install_hrs_per || 0;
        derivedHrs += q * f * h;
        derivedQty += q * f;
      });
      // Check for manual override on this install row
      const instLn  = lines[inst.wbs_code] || {};
      const ovrdHrs = instLn.instHrsOvrd !== "" && instLn.instHrsOvrd != null
        ? parseFloat(instLn.instHrsOvrd) || 0
        : null;
      const activeHrs = ovrdHrs !== null ? ovrdHrs : derivedHrs;
      // Delivery method for this install row (default from data or override)
      const delivery  = instLn.delivery || inst.delivery_method || "EE Delivered";
      const isContr   = delivery === "Contractor Delivered";
      // Resource override
      const resName   = resourceOvrd[inst.wbs_code]?.install || inst.resource_main || "ZS Electrical Technician";
      const resData   = ratesLookup[resName];
      const eeRate    = isCommercial
        ? (resData?.ee_commercial_rate || inst.ee_labour_rate || 246.95)
        : (resData?.ee_internal_rate   || inst.ee_labour_rate || 246.95);
      const contrRate = parseFloat(instLn.contrRate || "") || inst.contractor_rate || 0;
      // Cost calc
      const eeLabCost   = isContr ? 0 : activeHrs * eeRate;
      const contrCost   = isContr ? derivedQty * contrRate : 0;
      const eeInt       = eeLabCost + contrCost;
      const comm        = isContr ? contrCost * (1+ANS_CON) : eeLabCost * (1+ANS_LAB);
      agg[inst.wbs_code] = {
        item: inst, linked, derivedHrs, derivedQty,
        ovrdHrs, activeHrs, delivery, isContr,
        resName, eeRate, contrRate, eeLabCost, contrCost, eeInt, comm,
        isOverridden: ovrdHrs !== null,
      };
    });
    return agg;
  }, [installItems, allL4Items, lines, ratesLookup, isCommercial, resourceOvrd]);

  // L4 label
  const l4label = useMemo(()=>{
    const found = wbs.find(w=>w.wbs_code===selectedL4);
    return found?.description || selectedL4;
  },[wbs, selectedL4]);

  const getLine = code => lines[code] || {};

  // Direct-entry install rows with no pre-set hrs or rate — estimator must enter hrs in cost detail
  const MANUAL_HRS_INSTALLS = new Set([
    "3.1.3.07.4.04","3.1.3.07.4.05",
    "3.1.3.14.4.03",
    "3.1.3.24.4.01","3.1.3.24.4.02","3.1.3.24.4.03",
    "3.2.1.06.4.07","3.2.2.02.4.08",
    "3.3.1.05.4.03",
  ]);
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

  const commGrandHrs  = Object.values(commGroups).reduce((a,g)=>a+g.totalHrs, 0)
    + Object.entries(commLookup).filter(([,d])=>d.direct_entry).reduce((a,[wbs,data])=>{
        const dq = parseFloat(lines[`comm_direct_${wbs}`]?.qty||"0")||0;
        const ovrd = lines[`comm_ovrd_${wbs}`]?.qty;
        const hrs = (ovrd!==undefined&&ovrd!=="") ? (parseFloat(ovrd)||0) : dq*(data.hrs_per_unit||0);
        return a + hrs;
      }, 0);
  const commGrandCost = Object.values(commGroups).reduce((a,g)=>a+g.totalCost, 0)
    + Object.entries(commLookup).filter(([,d])=>d.direct_entry).reduce((a,[wbs,data])=>{
        const dq = parseFloat(lines[`comm_direct_${wbs}`]?.qty||"0")||0;
        const ovrd = lines[`comm_ovrd_${wbs}`]?.qty;
        const hrs = (ovrd!==undefined&&ovrd!=="") ? (parseFloat(ovrd)||0) : dq*(data.hrs_per_unit||0);
        return a + hrs*(data.ee_labour_rate||139.26);
      }, 0);

  // ALL 144 commission rows — always visible even when qty=0
  const commAllGroups = useMemo(()=>{
    const g = {};
    Object.entries(commLookup).forEach(([commWbs, data])=>{
      const l4 = commWbs.split('.').slice(0,4).join('.');
      if (!g[l4]) g[l4] = { label: data.description?.split(' - ')[0] || l4, items:[], totalHrs:0, totalCost:0 };
      const directKey  = `comm_direct_${commWbs}`;
      const directQty  = data.direct_entry ? (parseFloat(lines[directKey]?.qty||"0")||0) : 0;
      const derivedQty = commTotals[commWbs]?.qty || 0;
      const effectiveQty = data.direct_entry ? directQty : derivedQty;
      const scale      = getScaleFactor(commProfiles, data.profile_id, effectiveQty);
      const baseHrs    = effectiveQty * (data.hrs_per_unit || 0);
      const ovrdKey    = `comm_ovrd_${commWbs}`;
      const ovrd       = lines[ovrdKey]?.qty;
      const scaledHrs  = (ovrd !== undefined && ovrd !== "") ? (parseFloat(ovrd)||0) : baseHrs * scale;
      const rate       = data.ee_labour_rate || 139.26;
      const item       = { wbs:commWbs, ...data, derivedQty, directQty, effectiveQty, scale, baseHrs, scaledHrs, rate, isOverridden: ovrd !== undefined && ovrd !== "" };
      g[l4].items.push(item);
      if (effectiveQty > 0) {
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
              className={`w-full text-center text-2xl font-mono tracking-widest border-2 rounded-lg px-3 py-3 mb-3 focus:outline-none ${resPinError?"border-red-500 bg-red-50 animate-pulse":"border-gray-300 focus:border-[var(--primary-500)]"}`}
            />
            {resPinError && <div className="text-xs text-red-600 text-center mb-2">Incorrect PIN — try again</div>}
            <div className="flex gap-2">
              <button onClick={()=>{setShowResourcePin(false);setResPinInput("");}}
                className="flex-1 text-xs border border-gray-200 text-gray-600 py-2 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={tryResourceUnlock}
                className="flex-1 text-xs bg-[var(--primary-700)] hover:bg-[var(--primary-600)] text-white py-2 rounded-lg font-semibold">Unlock</button>
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
            <div className="flex-1 flex flex-col overflow-x-auto min-h-0">
            <div style={{minWidth:"680px"}} className="flex-1 flex flex-col min-h-0">
            <div className="bg-gray-50 border-b grid flex-shrink-0 text-xs font-semibold text-gray-500 px-3 py-1.5"
              style={{gridTemplateColumns:"1fr 52px 64px 52px 76px 76px 86px 64px"}}>
              <div>Description / WBS</div>
              <div className="text-center">Hrs/Unit</div>
              <div className="text-center text-orange-700">Derived Qty</div>
              <div className="text-center text-[var(--primary-700)]">Scale</div>
              <div className="text-center text-teal-700">Scaled Hrs</div>
              <div className="text-center text-orange-500">Override</div>
              <div className="text-right text-[var(--primary-800)]">EE Cost</div>
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
                          ? "bg-[#1e3a5f] text-white border-[var(--primary-400)]"
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
                      // For direct-entry items, effectiveQty comes from what the estimator typed
                      // For derived items, it comes from supply propagation
                      const isActive   = item.direct_entry ? (parseFloat(directQtyVal||"0")>0) : item.derivedQty > 0;
                      const effectiveHrs = isOvrd ? (parseFloat(ovrd)||0) : item.scaledHrs;
                      const cost       = effectiveHrs * (item.ee_labour_rate||139.26);
                      return (
                        <div key={item.wbs}
                          className={`grid items-center px-3 py-1.5 border-b text-xs
                            ${isActive?"bg-teal-50":"bg-white hover:bg-gray-50"}
                            ${item.direct_entry?"border-l-4 border-l-teal-400":""}
                            ${isOvrd?"border-l-4 border-l-orange-400":""}`}
                          style={{gridTemplateColumns:"1fr 52px 64px 52px 76px 76px 86px 64px"}}>
                          <div className="min-w-0 pr-1">
                            <div className={`truncate font-medium ${isActive?"text-teal-900":"text-gray-500"}`}>
                              {item.description}
                              {item.direct_entry && (
                                item.wbs.startsWith("4.1.1.01")
                                  ? <span className="ml-1.5 text-[9px] bg-amber-100 text-amber-700 border border-amber-300 rounded px-1 font-semibold">⚡ Enter hrs — earthing commission varies per site</span>
                                  : item.wbs.startsWith("4.1.3.05")
                                  ? <span className="ml-1.5 text-[9px] bg-amber-100 text-amber-700 border border-amber-300 rounded px-1 font-semibold">⚡ Enter hrs — PSN/CSN test count varies</span>
                                  : item.wbs.startsWith("4.1.2.06.7.04")
                                  ? <span className="ml-1.5 text-[9px] bg-[var(--primary-100)] text-[var(--primary-700)] border border-[var(--primary-200)] rounded px-1 font-semibold">Enter hrs — contractor supervision</span>
                                  : <span className="ml-1.5 text-[9px] bg-teal-100 text-teal-700 border border-teal-200 rounded px-1 font-semibold">Estimator enters qty</span>
                              )}
                            </div>
                            <div className="font-mono text-gray-400 text-xs">{item.wbs}{isOvrd&&<span className="ml-1 text-orange-500">⚡ override</span>}</div>
                          </div>
                          <div className="text-center text-gray-500">{item.hrs_per_unit||0}</div>
                          <div className="text-center font-bold">
                            {item.direct_entry ? (
                              <input type="number" min="0" step="1" value={directQtyVal}
                                onChange={e=>setDirect(e.target.value)}
                                placeholder="0"
                                title="Enter quantity directly — hours = qty × hrs/unit"
                                className="w-14 text-center border-2 border-teal-400 rounded py-0.5 text-xs font-bold bg-teal-50 text-teal-800 focus:outline-none focus:ring-1 focus:ring-teal-500"/>
                            ) : (
                              <span className={isActive?"text-orange-700":"text-gray-300"}>
                                {isActive ? item.derivedQty.toLocaleString("en-AU",{maximumFractionDigits:1}) : "—"}
                              </span>
                            )}
                          </div>
                          <div className={`text-center font-bold ${isActive&&item.scale<1?"text-[var(--primary-700)]":isActive?"text-gray-400":"text-gray-200"}`}>
                            {fmtPct(item.scale)}
                          </div>
                          <div className={`text-center font-bold ${isActive?"text-teal-700":"text-gray-300"}`}>
                            {(isActive) ? fmtHrs(item.scaledHrs) : "—"}
                          </div>
                          <div className="flex justify-center">
                            <input type="number" min="0" step="0.5" value={ovrd}
                              onChange={e=>setOvrd(e.target.value)}
                              placeholder={(isActive)?item.scaledHrs.toFixed(1):""}
                              className={`w-16 text-center border rounded py-0.5 text-xs font-bold focus:outline-none focus:ring-1
                                ${isOvrd?"border-orange-400 bg-orange-50 text-orange-800":"border-gray-200 text-gray-400"}`}/>
                          </div>
                          <div className={`text-right font-bold ${isActive?"text-[var(--primary-800)]":"text-gray-300"}`}>
                            {(isActive) ? fmt(cost) : "—"}
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
                    <span className="text-[var(--primary-800)] font-bold">{fmt(g.totalCost)}</span>
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
              <div className="py-1.5 px-2 bg-[var(--primary-800)] rounded text-white flex justify-between mb-1">
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
            <div className="font-bold text-[var(--primary-900)] text-sm">{selectedL4} — {l4label}</div>
            <div className="text-xs text-gray-400 flex items-center gap-2">
              {items.length} items · Click ▸ to expand cost detail
              {items.some(i=>i._priceFromEquipPricing) && (
                <span className="text-orange-600 text-[10px] bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded flex items-center gap-1">
                  ⚡ Prices updated from Equipment Pricing this session
                </span>
              )}
            </div>
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
          <div className="text-center text-orange-700 text-[9px] font-normal leading-tight">Materials<br/>cost only</div>
          <div className="text-center text-gray-400">Expand</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 && installItems.length === 0 && (
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
            const rowBase  = hasQty?"bg-[var(--primary-50)] border-l-4 border-l-[var(--primary-500)]":idx%2===0?"bg-white":"bg-gray-50";
            return (
              <div key={item.wbs_code} className={`border-b ${rowBase} transition-colors`}>
                <div className="grid items-center px-3 py-2 text-xs"
                  style={{gridTemplateColumns:"16px 1fr 46px 72px 64px 90px 56px"}}>
                  <button onClick={()=>setExpandedRows(p=>({...p,[item.wbs_code]:!p[item.wbs_code]}))}
                    className={`text-center rounded text-xs w-4 h-4 flex items-center justify-center ${isExp?"bg-[var(--primary-600)] text-white":"text-gray-300 hover:text-[var(--primary-500)]"}`}>
                    {isExp?"▾":"▸"}
                  </button>
                  <div className="min-w-0 pr-2">
                    <div className={`font-medium truncate ${hasQty?"text-[var(--primary-900)]":"text-gray-800"}`}>{item.description}</div>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      <span className="text-gray-400 font-mono text-xs">{item.wbs_code}</span>
                      {item.scope === "Install" && !item.install_wbs && (
                        MANUAL_HRS_INSTALLS.has(item.wbs_code)
                          ? <span className="text-xs text-amber-700 bg-amber-50 border border-amber-300 rounded px-1 font-semibold">⚠ Hrs required — enter in cost detail</span>
                          : <span className="text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded px-1 font-semibold">Direct-entry · Contractor</span>
                      )}
                      {item.pce_price>0 && <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1">PCE {fmt(item.pce_price)}</span>}
                      {isContr
                        ? <span className="text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded px-1">Contractor</span>
                        : item.resource_main && item.resource_main !== "Supplier" &&
                          <span className="text-xs text-purple-600 bg-purple-50 border border-purple-200 rounded px-1">{item.resource_main}</span>
                      }
                      {item.resource_install && item.install_hrs_per>0 &&
                        <span className="text-xs text-[var(--primary-500)] bg-[var(--primary-50)] border border-[var(--primary-200)] rounded px-1">Install: {resourceOvrd[item.install_wbs]?.install || item.resource_install}</span>}
                      {isWAFHAItem(item) &&
                        <span className="text-xs text-amber-700 bg-amber-50 border border-amber-300 rounded px-1 font-semibold">WAFHA · day rate</span>}
                    </div>
                  </div>
                  <div className="text-center text-gray-500">{item.uom||"EA"}</div>
                  <div className="flex justify-center">
                    <input type="number" min="0" value={qty} onChange={e=>updLine(item.wbs_code,"qty",e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&e.currentTarget.blur()}
                      placeholder="0"
                      className={`w-16 text-center border rounded py-0.5 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-orange-400 ${hasQty?"border-orange-400 bg-orange-50 text-orange-800":"border-gray-300 text-gray-500"}`}/>
                  </div>
                  <div className="flex justify-center">
                    <input type="number" min="0.1" step="0.1" value={factor}
                      onChange={e=>updLine(item.wbs_code,"factor",e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&e.currentTarget.blur()}
                      className={`w-14 text-center border rounded py-0.5 text-xs focus:outline-none focus:ring-1 ${parseFloat(factor)!==1?"border-[var(--primary-400)] bg-[var(--primary-50)] text-[var(--primary-800)] font-bold":"border-gray-200 text-gray-500"}`}/>
                  </div>
                  <div className="text-center">
                    {isWAFHAItem(item)
                      ? (hasQty ? <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded px-1 font-semibold">{parseFloat(qty).toLocaleString("en-AU",{maximumFractionDigits:1})} days</span> : <span className="text-gray-300">–</span>)
                      : item.install_wbs
                        ? <span className="text-[9px] text-purple-500 bg-purple-50 border border-purple-200 rounded px-1">↓ install row</span>
                        : hasQty && c.installHrs > 0
                          ? <span className="text-xs font-bold text-purple-700">{fmtHrs(c.installHrs)}</span>
                          : <span className="text-gray-300">–</span>
                    }
                  </div>
                  <div className="text-center text-gray-300 text-xs">{isExp?"▲ close":"▸ costs"}</div>
                </div>

                {isExp && (
                  <div className="mx-3 mb-3 rounded-lg border border-[var(--primary-200)] bg-white shadow-sm overflow-hidden">
                    <div className="bg-[var(--primary-700)] text-white text-xs font-semibold px-3 py-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        Cost Detail — {item.description?.split(" - ")[0]}
                        {item.drawing_ref && (
                          <span className="inline-flex items-center gap-1 bg-[var(--primary-500)] text-white text-xs font-mono px-1.5 py-0.5 rounded"
                            title="Standard drawing / reference from the estimation database">
                            📐 {item.drawing_ref}
                          </span>
                        )}
                        {item.comments && (
                          <span className="relative group">
                            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--primary-400)] text-white text-xs cursor-help hover:bg-white hover:text-[var(--primary-700)] font-bold">i</span>
                            <span className="invisible group-hover:visible absolute left-0 top-6 z-50 w-80 bg-gray-900 text-white text-xs font-normal rounded-lg shadow-xl p-3 leading-relaxed">
                              <span className="block font-bold text-[var(--primary-300)] mb-1">Database & Scope Notes</span>
                              {item.comments}
                            </span>
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-[var(--primary-200)] font-normal">
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
                            className="text-xs border border-gray-300 rounded px-1.5 py-1 bg-white w-full focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]">
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
                            onKeyDown={e=>e.key==="Enter"&&e.currentTarget.blur()}
                            className="w-full text-xs border border-purple-300 bg-purple-50 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-purple-400"/>}
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
                                onKeyDown={e=>e.key==="Enter"&&e.currentTarget.blur()}
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
                          <input type="number" min="0" value={ln.mats||""} placeholder={item.pce_price>0?item.pce_price.toFixed(2):"0"}
                          title={item._priceFromEquipPricing?"Price updated from Equipment Pricing this session":""}
                            onChange={e=>updLine(item.wbs_code,"mats",e.target.value)}
                            onKeyDown={e=>e.key==="Enter"&&e.currentTarget.blur()}
                            className="w-full text-xs border border-green-300 bg-green-50 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-green-400"/>
                          {item.pce_price>0&&<div className="text-xs text-amber-600 mt-0.5">PCE default: {fmt(item.pce_price)}</div>}
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-0.5">Plant & Machinery ($)</label>
                          <input type="number" min="0" value={ln.plant||""} placeholder="0"
                            onChange={e=>updLine(item.wbs_code,"plant",e.target.value)}
                            onKeyDown={e=>e.key==="Enter"&&e.currentTarget.blur()}
                            className="w-full text-xs border border-[var(--primary-200)] bg-[var(--primary-50)] rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--primary-300)]"/>
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
                                <span className="text-[var(--primary-800)]">EE Internal</span><span className="text-[var(--primary-800)]">{fmt(c.eeInt)}</span>
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
                              className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--primary-300)]"/>
                            {(ln.drawing||"").startsWith("http") && (
                              <a href={ln.drawing} target="_blank" rel="noopener noreferrer"
                                className="flex-shrink-0 text-xs bg-[var(--primary-50)] border border-[var(--primary-200)] text-[var(--primary-700)] hover:bg-[var(--primary-100)] rounded px-2 py-1 flex items-center gap-1 font-medium">
                                🔗 Open
                              </a>
                            )}
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">Comments / Scope inclusions & exclusions</label>
                          <textarea value={ln.comments||""} onChange={e=>updLine(item.wbs_code,"comments",e.target.value)}
                            rows={2} placeholder="e.g. Includes conductor and insulators. Excludes foundation design."
                            className="w-full text-xs border border-gray-200 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-[var(--primary-300)]"/>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* ── INSTALL ROWS (L5=4) — auto-derived from supply quantities ── */}
          {installItems.length > 0 && (
            <div className="sticky bottom-0 border-t-2 border-purple-300 bg-white shadow-lg">
              <div className="bg-purple-700 text-white text-xs font-bold px-4 py-2 flex items-center justify-between cursor-pointer"
                onClick={()=>setExpandedRows(p=>({...p,__installSection__:!p.__installSection__}))}>
                <span className="flex items-center gap-2">
                  🔧 {installItems.length} Install Row{installItems.length!==1?"s":""}
                  <span className="text-purple-300 font-normal">— system-calculated · read-only · click to review</span>
                </span>
                <span className="text-purple-200">{expandedRows.__installSection__ ? "▴" : "▾"} {Object.values(installAgg).reduce((a,r)=>a+r.activeHrs,0).toFixed(1)} hrs total</span>
              </div>
              {expandedRows.__installSection__ !== false && (
                <div className="bg-purple-50 border-b border-purple-200 px-4 py-2 flex items-center gap-2 text-xs text-purple-700">
                  <span>ℹ️</span>
                  <span>Install hours are <strong>pre-agreed standard rates</strong> automatically derived from your supply quantities. Overrides require team leader approval via the Review Lines tab.</span>
                </div>
              )}
              {expandedRows.__installSection__ !== false && installItems.map(inst => {
                const agg = installAgg[inst.wbs_code];
                if (!agg) return null;
                const instLn  = lines[inst.wbs_code] || {};
                const isExp   = !!expandedRows[inst.wbs_code];
                const hasHrs  = agg.activeHrs > 0;
                const rowBg   = hasHrs ? "bg-purple-50 border-l-4 border-l-purple-500" : "bg-white";
                return (
                  <div key={inst.wbs_code} className={`border-b border-purple-100 ${rowBg}`}>
                    <div className="grid items-center px-3 py-2 text-xs" style={{gridTemplateColumns:"16px 1fr 90px 110px 110px 80px 56px"}}>
                      <button onClick={()=>setExpandedRows(p=>({...p,[inst.wbs_code]:!p[inst.wbs_code]}))}
                        className={`text-center rounded text-xs w-4 h-4 flex items-center justify-center ${isExp?"bg-purple-600 text-white":"text-gray-300 hover:text-purple-500"}`}>
                        {isExp?"▾":"▸"}
                      </button>
                      <div className="min-w-0 pr-2">
                        <div className="font-medium text-purple-900">{inst.description}</div>
                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                          <span className="text-purple-400 font-mono text-xs">{inst.wbs_code}</span>
                          <span className="text-[9px] bg-purple-100 text-purple-700 border border-purple-200 rounded px-1">Install · L5=4</span>
                          {agg.isOverridden && <span className="text-[9px] bg-orange-100 text-orange-700 border border-orange-200 rounded px-1">⚡ manual override</span>}
                          <span className="text-[9px] text-gray-400">{agg.linked.length} supply item{agg.linked.length!==1?"s":""} linked</span>
                        </div>
                      </div>
                      <div className="text-center">
                        <div className={`text-xs font-bold ${agg.isOverridden?"text-orange-600":hasHrs?"text-purple-700":"text-gray-300"}`}>
                          {hasHrs ? fmtHrs(agg.activeHrs) : "—"}{agg.isOverridden&&<span className="text-orange-400 ml-0.5">*</span>}
                        </div>
                        {!agg.isOverridden && <div className="text-[9px] text-gray-400">auto</div>}
                      </div>
                      <div className="text-center text-[9px] text-gray-400 truncate px-1">{agg.delivery}</div>
                      <div className="text-right">
                        <div className={`text-xs font-bold ${hasHrs?"text-[var(--primary-800)]":"text-gray-300"}`}>{hasHrs?fmt(isCommercial?agg.comm:agg.eeInt):"—"}</div>
                        {hasHrs&&agg.isContr&&<div className="text-[9px] text-teal-600">Contractor</div>}
                      </div>
                      <div className="text-center text-[9px] text-gray-500 truncate px-1">{agg.resName.split(" ").slice(-2).join(" ")}</div>
                      <div className="text-center text-gray-300 text-xs">{isExp?"▲":"▸"}</div>
                    </div>
                    {isExp && (
                      <div className="mx-3 mb-3 rounded-lg border border-purple-200 bg-white shadow-sm overflow-hidden">
                        <div className="bg-purple-700 text-white text-xs font-semibold px-3 py-1.5 flex items-center justify-between">
                          <span>Install derivation — {inst.wbs_code}</span>
                          <span className="text-purple-300 text-[10px]">Read-only · overrides via Review Lines</span>
                        </div>
                        <div className="p-3 space-y-3">
                          <div>
                            <div className="text-xs font-semibold text-gray-600 mb-1.5">Derived from supply quantities:</div>
                            <div className="bg-gray-50 rounded border border-gray-200 overflow-hidden">
                              <table className="w-full text-xs">
                                <thead className="bg-gray-100 border-b">
                                  <tr>
                                    <th className="text-left px-2 py-1 font-semibold text-gray-500">Supply item</th>
                                    <th className="text-center px-2 py-1 font-semibold text-gray-500">Qty</th>
                                    <th className="text-center px-2 py-1 font-semibold text-gray-500">Hrs/unit</th>
                                    <th className="text-right px-2 py-1 font-semibold text-purple-700">= Install Hrs</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {agg.linked.map((sup,i)=>{
                                    const sl=lines[sup.wbs_code]||{};
                                    const sq=parseFloat(sl.qty||"0");
                                    const sf=parseFloat(sl.factor||"1");
                                    const sh=sup.install_hrs_per||0;
                                    const hrs=sq*sf*sh;
                                    return (
                                      <tr key={sup.wbs_code} className={`border-b border-gray-100 ${sq>0?"bg-purple-50/40":""}`}>
                                        <td className="px-2 py-1"><div className="truncate max-w-[200px] text-gray-700">{sup.description}</div><div className="font-mono text-gray-400 text-[10px]">{sup.wbs_code}</div></td>
                                        <td className="px-2 py-1 text-center font-bold text-orange-700">{sq>0?sq:"—"}</td>
                                        <td className="px-2 py-1 text-center text-gray-500">{sh}h</td>
                                        <td className={`px-2 py-1 text-right font-bold ${hrs>0?"text-purple-700":"text-gray-300"}`}>{hrs>0?fmtHrs(hrs):"—"}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                                <tfoot className="bg-purple-50 border-t-2 border-purple-200">
                                  <tr>
                                    <td colSpan={3} className="px-2 py-1.5 font-bold text-purple-800">Total derived install hours</td>
                                    <td className="px-2 py-1.5 text-right font-bold text-purple-800">{fmtHrs(agg.derivedHrs)}</td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="bg-gray-50 rounded border border-gray-200 px-2 py-1.5">
                              <div className="text-[9px] text-gray-400 uppercase tracking-wide mb-0.5">Install resource</div>
                              <div className="font-medium text-gray-700">{resourceOvrd[inst.wbs_code]?.install||inst.resource_main||"ZS Electrical Technician"}</div>
                            </div>
                            <div className="bg-gray-50 rounded border border-gray-200 px-2 py-1.5">
                              <div className="text-[9px] text-gray-400 uppercase tracking-wide mb-0.5">Active hrs {agg.isOverridden&&<span className="text-orange-500">⚡ overridden</span>}</div>
                              <div className={`font-bold ${agg.isOverridden?"text-orange-700":"text-purple-700"}`}>{agg.activeHrs.toFixed(1)} hrs</div>
                            </div>
                            <div className="bg-gray-50 rounded border border-gray-200 px-2 py-1.5">
                              <div className="text-[9px] text-gray-400 uppercase tracking-wide mb-0.5">{agg.isContr?"Contractor rate":"EE rate"}</div>
                              <div className="font-medium text-gray-700">{agg.isContr?fmt(agg.contrRate)+" /unit":fmt(agg.eeRate)+" /hr · "+fmt(agg.eeLabCost)+" total"}</div>
                            </div>
                          </div>

                          {/* Commission link summary — shows Phase 4 hrs that will be derived */}
                          {(()=>{
                            // Collect unique commission WBS codes from linked supply items
                            const commMap = {};
                            agg.linked.forEach(sup => {
                              const cw = sup.commission_wbs;
                              if (!cw) return;
                              const ln = lines[sup.wbs_code] || {};
                              const q  = parseFloat(ln.qty || "0");
                              if (!commMap[cw]) commMap[cw] = { qty:0, data: commLookup[cw] };
                              commMap[cw].qty += q;
                            });
                            const commEntries = Object.entries(commMap);
                            if (!commEntries.length) return (
                              <div className="text-[10px] text-gray-400 bg-gray-50 border border-gray-200 rounded px-2.5 py-1.5">
                                ⚠ No commission WBS linked to supply items in this install group — commission hrs will not flow to Phase 4
                              </div>
                            );
                            return (
                              <div className="bg-teal-50 border border-teal-200 rounded overflow-hidden">
                                <div className="bg-teal-700 text-white text-[10px] font-semibold px-2.5 py-1 flex items-center gap-2">
                                  <span>↳ Phase 4 Commission (auto-derived)</span>
                                </div>
                                <table className="w-full text-xs">
                                  <thead className="bg-teal-100 border-b border-teal-200">
                                    <tr>
                                      <th className="text-left px-2 py-1 font-semibold text-teal-800">Commission WBS</th>
                                      <th className="text-center px-2 py-1 font-semibold text-teal-800">Qty</th>
                                      <th className="text-center px-2 py-1 font-semibold text-teal-800">Hrs/unit</th>
                                      <th className="text-right px-2 py-1 font-semibold text-teal-800">= Comm Hrs</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {commEntries.map(([cw, {qty, data}]) => {
                                      const hpu  = data?.hrs_per_unit || 0;
                                      const hrs  = qty * hpu;
                                      const hasQ = qty > 0;
                                      return (
                                        <tr key={cw} className={`border-b border-teal-100 ${hasQ ? "bg-teal-50/60" : ""}`}>
                                          <td className="px-2 py-1">
                                            <div className="font-mono text-gray-500 text-[10px]">{cw}</div>
                                            <div className="text-gray-700 truncate max-w-[200px]">{data?.description || "—"}</div>
                                          </td>
                                          <td className={`px-2 py-1 text-center font-bold ${hasQ ? "text-teal-800" : "text-gray-300"}`}>{hasQ ? qty : "—"}</td>
                                          <td className="px-2 py-1 text-center text-gray-500">{hpu}h</td>
                                          <td className={`px-2 py-1 text-right font-bold ${hrs > 0 ? "text-teal-800" : "text-gray-300"}`}>
                                            {hrs > 0 ? fmtHrs(hrs) : "—"}
                                            {!data && <span className="ml-1 text-[9px] text-red-500">⚠ not in lookup</span>}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            );
                          })()}
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
      <div className="w-56 bg-white border-l flex flex-col overflow-hidden flex-shrink-0">
        <div className="bg-orange-700 text-white text-xs font-bold px-3 py-2 uppercase tracking-wide">Live Cost Display</div>
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-2 bg-[var(--primary-50)] border-b">
            <div className="text-xs font-bold text-[var(--primary-800)] mb-2 uppercase tracking-wide truncate">{l4label}</div>
            {[
              {label:"Install Hours (excl. WAFHA)",value:fmtHrs(groupTotals.installHrs),color:"text-purple-700",bg:"bg-purple-50 border border-purple-100"},
            ].map(r=>(
              <div key={r.label} className={`flex justify-between items-center py-1 px-2 rounded mb-1 ${r.bg}`}>
                <span className="text-xs text-gray-600">{r.label}</span>
                <span className={`text-xs font-bold ${r.color}`}>{r.value}</span>
              </div>
            ))}
            <div className="my-2 border-t border-[var(--primary-200)]"/>
            <div className="flex justify-between items-center py-1.5 px-2 rounded bg-[var(--primary-100)] mb-1">
              <span className="text-xs font-semibold text-[var(--primary-800)]">EE Internal</span>
              <span className="text-xs font-bold text-[var(--primary-900)]">{fmt(groupTotals.eeTotal)}</span>
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
            <div className="mt-2 py-1.5 px-2 bg-[var(--primary-800)] rounded text-white flex justify-between items-center mb-1">
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
            <div className="text-2xl font-bold text-[var(--primary-800)]">{entered.length}</div>
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
            <div className="text-2xl font-bold text-[var(--primary-900)]">{fmt(totals.eeInt+phase4Totals.eeInt)}</div>
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
                  <th className="text-right px-3 py-2 font-semibold text-[var(--primary-700)] whitespace-nowrap">EE Internal</th>
                  {isCommercial && <th className="text-right px-3 py-2 font-semibold text-orange-700 whitespace-nowrap">Commercial</th>}
                  <th className="text-left px-3 py-2 font-semibold text-gray-500">Delivery</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item,i)=>{
                  const ln=lines[item.wbs_code]||{};
                  const c=calcLine(item,ln.qty||"",ln.factor||"1",ln.delivery,ln.instHrsOvrd,ln.contrRate,ln.plant,ln.mats,isCommercial,ln.resourceOvrd,null,0);
                  return (
                    <tr key={item.wbs_code} className={`border-b ${i%2===0?"bg-white":"bg-gray-50"} hover:bg-[var(--primary-50)]`}>
                      <td className="px-3 py-1.5 font-mono text-[var(--primary-600)] whitespace-nowrap text-[11px]">{item.wbs_code}</td>
                      <td className="px-3 py-1.5 text-gray-800 max-w-xs truncate" title={item.description}>{item.description}</td>
                      <td className="px-3 py-1.5 text-center font-bold text-orange-700">{ln.qty}</td>
                      <td className="px-3 py-1.5 text-center text-gray-500">{ln.factor||"1"}</td>
                      <td className="px-3 py-1.5 text-center text-gray-500">{item.uom||"each"}</td>
                      <td className="px-3 py-1.5 text-right font-medium text-purple-700">{fmtHrs(c.installHrs)||"—"}</td>
                      <td className="px-3 py-1.5 text-right font-bold text-[var(--primary-800)]">{fmt(c.eeInt)}</td>
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
                  <td className="px-3 py-1.5 text-right font-bold text-[var(--primary-900)]">
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
                  <th className="text-center px-3 py-2 font-semibold text-[var(--primary-600)] whitespace-nowrap">Scale</th>
                  <th className="text-right px-3 py-2 font-semibold text-teal-700 whitespace-nowrap">Comm Hrs</th>
                  <th className="text-right px-3 py-2 font-semibold text-[var(--primary-700)] whitespace-nowrap">EE Internal</th>
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
                    <td className="px-3 py-1.5 text-center text-[var(--primary-600)]">
                      {row.scale < 1
                        ? <span className="font-bold text-[var(--primary-700)]">{fmtPct(row.scale)}</span>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right font-bold text-teal-700 whitespace-nowrap">
                      {fmtHrs(row.commHrs)}
                      {row.isHrsOvrd && <span className="ml-1 text-orange-500 text-[10px]">⚡ovrd</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right font-bold text-[var(--primary-800)]">{fmt(row.eeInt)}</td>
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
                  <td className="px-3 py-1.5 text-right font-bold text-[var(--primary-900)]">{fmt(phase4Totals.eeInt)}</td>
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
// ── SUMMARY SCREEN PDF EXPORT ────────────────────────────────────
function exportSummaryPDF(ctx) {
  const {
    inv, lines, isCommercial, byPhase, grandEE, grandComm,
    contPct, contAmt, escResult, finalTotal, commGrandHrs,
    nodeRollup, phaseNodes, openNodes, phaseNames, descMap, entered,
    supply, commTotals, commProfiles, ANS_LAB, ANS_MAT, ANS_CON,
    otCost, grandEEwithOT,
  } = ctx;

  // ── Modal for options ──────────────────────────────────────────
  const modalDiv = document.createElement('div');
  modalDiv.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;
    display:flex;align-items:center;justify-content:center;`;
  modalDiv.innerHTML = `
    <div style="background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.3);width:420px;overflow:hidden;">
      <div style="background:#1e3a5f;color:white;padding:16px 20px;">
        <div style="font-weight:700;font-size:15px;">📄 Export Summary PDF</div>
        <div style="font-size:11px;color:#93c5fd;margin-top:3px;">${inv.name||'Investment'} · ${inv.estClass} · Rev ${inv.revision||'A'}</div>
      </div>
      <div style="padding:20px;font-family:Arial,sans-serif;">
        <div style="font-size:12px;color:#374151;font-weight:600;margin-bottom:12px;">Export options</div>
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;background:#f9fafb;">
          <input type="checkbox" id="opt-wbs-expanded" checked style="margin-top:2px;width:14px;height:14px;accent-color:#1e3a5f;">
          <div>
            <div style="font-size:12px;font-weight:600;color:#111827;">WBS tree — current expanded state</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">Shows WBS nodes exactly as they appear on screen (open/closed). Uncheck to include all nodes fully expanded.</div>
          </div>
        </label>
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;background:#f9fafb;">
          <input type="checkbox" id="opt-line-detail" style="margin-top:2px;width:14px;height:14px;accent-color:#1e3a5f;">
          <div>
            <div style="font-size:12px;font-weight:600;color:#111827;">Include line detail</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">Append a table of all entered supply lines with qty, factor, and cost.</div>
          </div>
        </label>
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:10px;border:1px solid #dbeafe;border-radius:8px;background:#eff6ff;">
          <input type="checkbox" id="opt-financial" style="margin-top:2px;width:14px;height:14px;accent-color:#1e3a5f;">
          <div>
            <div style="font-size:12px;font-weight:600;color:#1d4ed8;">Include Financial Report</div>
            <div style="font-size:11px;color:#3b82f6;margin-top:2px;">Appends the PA breakdown, Sub-Contract / Materials / EE split, Contract Value, and ERP with overhead — same as the Financial Report tab.</div>
          </div>
        </label>
      </div>
      <div style="padding:0 20px 4px;">
        <div style="font-size:12px;color:#374151;font-weight:600;margin:8px 0 8px;border-top:1px solid #e5e7eb;padding-top:14px;">Report type</div>
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;background:#f9fafb;${isCommercial?'':'opacity:0.45;cursor:not-allowed;'}">
          <input type="radio" name="opt-report-type" id="opt-internal" value="internal" checked style="margin-top:2px;width:14px;height:14px;accent-color:#1e3a5f;">
          <div>
            <div style="font-size:12px;font-weight:600;color:#111827;">Internal report</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">Full breakdown including EE Internal costs, ANS margins and the 20% OT line — for internal use only.</div>
          </div>
        </label>
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:${isCommercial?'pointer':'not-allowed'};padding:10px;border:1px solid #fed7aa;border-radius:8px;background:#fff7ed;${isCommercial?'':'opacity:0.45;'}">
          <input type="radio" name="opt-report-type" id="opt-commercial" value="commercial" ${isCommercial?'':'disabled'} style="margin-top:2px;width:14px;height:14px;accent-color:#c2410c;">
          <div>
            <div style="font-size:12px;font-weight:600;color:#9a3412;">Commercial report</div>
            <div style="font-size:11px;color:#c2410c;margin-top:2px;">${isCommercial?'Hides EE Internal costs, ANS margins, OT and Cost* / Admin-Burden columns — shows Commercial / Contract Value figures only. Suitable to share externally.':'Not available — this investment has no commercial pricing.'}</div>
          </div>
        </label>
      </div>
      <div style="padding:0 20px 16px;display:flex;gap:8px;">
        <button id="btn-cancel" style="flex:1;border:1px solid #d1d5db;background:#f9fafb;color:#374151;padding:9px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Cancel</button>
        <button id="btn-export" style="flex:2;background:#1e3a5f;color:white;padding:9px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;border:none;">Generate PDF</button>
      </div>
    </div>`;

  document.body.appendChild(modalDiv);

  document.getElementById('btn-cancel').onclick = () => document.body.removeChild(modalDiv);

  document.getElementById('btn-export').onclick = () => {
    const useCurrentExpand = document.getElementById('opt-wbs-expanded').checked;
    const includeLines     = document.getElementById('opt-line-detail').checked;
    const includeFinancial = document.getElementById('opt-financial').checked;
    const commercialOnly   = isCommercial && document.getElementById('opt-commercial').checked;
    document.body.removeChild(modalDiv);
    doGeneratePDF({ inv, lines, isCommercial, byPhase, grandEE, grandComm,
      contPct, contAmt, escResult, finalTotal, commGrandHrs, nodeRollup,
      phaseNodes, openNodes, phaseNames, descMap, entered, supply, commTotals,
      commProfiles, ANS_LAB, ANS_MAT, ANS_CON, otCost, grandEEwithOT,
      useCurrentExpand, includeLines, includeFinancial, commercialOnly });
  };
}

function doGeneratePDF(ctx) {
  const {
    inv, lines, isCommercial, byPhase, grandEE, grandComm,
    contPct, contAmt, escResult, finalTotal, commGrandHrs, nodeRollup,
    phaseNodes, openNodes, phaseNames, descMap, entered, supply, commTotals,
    commProfiles, ANS_LAB, ANS_MAT, ANS_CON,
    useCurrentExpand, includeLines, includeFinancial,
  } = ctx;
  const otCostVal      = ctx.otCost || 0;
  const grandEEwithOTV = ctx.grandEEwithOT ?? (grandEE + otCostVal);
  const commercialOnly = !!ctx.commercialOnly && isCommercial; // hide EE Internal $/margins, show Commercial only

  const fmt  = (v) => '$' + Math.round(v||0).toLocaleString('en-AU');
  const fmtH = (v) => Math.round(v||0).toLocaleString('en-AU') + ' hrs';

  // ── WBS tree rendering ──────────────────────────────────────────
  const allOpenExpanded = {};
  Object.keys(nodeRollup).filter(k=>k.split('.').length<5).forEach(k=>{ allOpenExpanded[k]=true; });
  const activeOpen = useCurrentExpand ? openNodes : allOpenExpanded;

  const renderWBSRows = (code, depth) => {
    const roll = nodeRollup[code];
    if (!roll) return '';
    const isOpen = !!activeOpen[code];
    const childCodes = Object.keys(nodeRollup).filter(k => {
      const parts = k.split('.');
      return parts.length === depth+1 && k.startsWith(code+'.');
    }).sort();
    const isLeaf = depth >= 5 || childCodes.length === 0;
    const indent = (depth-1)*14;
    const bgColors = ['','#eff6ff','#eef2ff','#f9fafb','#ffffff','#ffffff'];
    const fwBold   = depth<=2 ? 'font-weight:700;' : depth===3 ? 'font-weight:600;' : '';
    const toggle   = (!isLeaf && childCodes.length>0) ? (isOpen?'▾ ':'▸ ') : '  ';
    const desc     = descMap[code] || code;
    const cols     = commercialOnly
      ? `<td style="padding:4px 6px;text-align:right;color:#7c3aed;">${roll.installHrs>0?fmtH(roll.installHrs):'—'}</td>
         <td style="padding:4px 6px;text-align:right;color:#0f766e;">${code==='4'&&commGrandHrs>0?fmtH(commGrandHrs):'—'}</td>
         <td style="padding:4px 6px;text-align:right;${fwBold}color:#c2410c;">${fmt(roll.comm)}</td>`
      : isCommercial
      ? `<td style="padding:4px 6px;text-align:right;color:#7c3aed;">${roll.installHrs>0?fmtH(roll.installHrs):'—'}</td>
         <td style="padding:4px 6px;text-align:right;color:#0f766e;">${code==='4'&&commGrandHrs>0?fmtH(commGrandHrs):'—'}</td>
         <td style="padding:4px 6px;text-align:right;${fwBold}color:#1e40af;">${fmt(roll.eeInt)}</td>
         <td style="padding:4px 6px;text-align:right;${fwBold}color:#c2410c;">${fmt(roll.comm)}</td>`
      : `<td style="padding:4px 6px;text-align:right;color:#7c3aed;">${roll.installHrs>0?fmtH(roll.installHrs):'—'}</td>
         <td style="padding:4px 6px;text-align:right;color:#0f766e;">${code==='4'&&commGrandHrs>0?fmtH(commGrandHrs):'—'}</td>
         <td style="padding:4px 6px;text-align:right;${fwBold}color:#1e40af;">${fmt(roll.eeInt)}</td>`;
    let html = `<tr style="background:${bgColors[depth]||'#fff'};border-bottom:1px solid #e5e7eb;">
      <td style="padding:4px 6px;padding-left:${6+indent}px;${fwBold}font-size:10px;">
        <span style="color:#9ca3af;">${toggle}</span>
        <span style="font-family:monospace;color:#9ca3af;font-size:9px;">${code}</span>
        <span style="margin-left:4px;">${desc}</span>
      </td>${cols}</tr>`;
    if (isOpen && !isLeaf) {
      childCodes.forEach(child => { html += renderWBSRows(child, depth+1); });
    }
    return html;
  };

  let wbsRows = '';
  phaseNodes.forEach(ph => { wbsRows += renderWBSRows(ph, 1); });

  // ── Phase cards ──────────────────────────────────────────────────
  const phaseCards = Object.entries(byPhase).map(([ph,p]) => `
    <div style="border:1px solid #e5e7eb;border-radius:6px;padding:10px;text-align:center;flex:1;min-width:100px;">
      <div style="font-size:9px;font-weight:700;color:#6b7280;text-transform:uppercase;margin-bottom:4px;">Phase ${ph} — ${phaseNames[ph]||ph}</div>
      ${ph==='4'?'<div style="font-size:9px;color:#0f766e;">auto-derived</div>':''}
      ${commercialOnly
        ? `<div style="font-size:13px;font-weight:700;color:#c2410c;">${fmt(p.comm)}</div>`
        : `<div style="font-size:13px;font-weight:700;color:#1e40af;">${fmt(p.eeInt)}</div>
           ${isCommercial?`<div style="font-size:11px;font-weight:700;color:#c2410c;">${fmt(p.comm)}</div>`:''}`}
      ${p.installHrs>0?`<div style="font-size:9px;color:#7c3aed;margin-top:2px;">${fmtH(p.installHrs)} install</div>`:''}
      ${ph==='4'&&p.commHrs>0?`<div style="font-size:9px;color:#0f766e;">${fmtH(p.commHrs)} comm</div>`:''}
    </div>`).join('');

  // ── WBS column headers ────────────────────────────────────────────
  const wbsColHdrs = commercialOnly
    ? `<th style="text-align:right;width:80px;color:#7c3aed;">Install Hrs</th>
       <th style="text-align:right;width:80px;color:#0f766e;">Comm Hrs</th>
       <th style="text-align:right;width:90px;color:#c2410c;">Commercial</th>`
    : isCommercial
    ? `<th style="text-align:right;width:80px;color:#7c3aed;">Install Hrs</th>
       <th style="text-align:right;width:80px;color:#0f766e;">Comm Hrs</th>
       <th style="text-align:right;width:90px;color:#1d4ed8;">EE Internal</th>
       <th style="text-align:right;width:90px;color:#c2410c;">Commercial</th>`
    : `<th style="text-align:right;width:80px;color:#7c3aed;">Install Hrs</th>
       <th style="text-align:right;width:80px;color:#0f766e;">Comm Hrs</th>
       <th style="text-align:right;width:90px;color:#1d4ed8;">EE Internal</th>`;

  // ── Grand total footer ─────────────────────────────────────────────
  const totalInstHrs = Object.entries(nodeRollup).filter(([k])=>k.split('.').length===1).reduce((a,[,v])=>a+v.installHrs,0);
  const wbsFooterCols = commercialOnly
    ? `<td style="text-align:right;padding:6px;">${totalInstHrs>0?fmtH(totalInstHrs):'—'}</td>
       <td style="text-align:right;padding:6px;">${commGrandHrs>0?fmtH(commGrandHrs):'—'}</td>
       <td style="text-align:right;padding:6px;font-weight:700;color:#c2410c;">${fmt(grandComm)}</td>`
    : isCommercial
    ? `<td style="text-align:right;padding:6px;">${totalInstHrs>0?fmtH(totalInstHrs):'—'}</td>
       <td style="text-align:right;padding:6px;">${commGrandHrs>0?fmtH(commGrandHrs):'—'}</td>
       <td style="text-align:right;padding:6px;font-weight:700;color:#1e40af;">${fmt(grandEE)}</td>
       <td style="text-align:right;padding:6px;font-weight:700;color:#c2410c;">${fmt(grandComm)}</td>`
    : `<td style="text-align:right;padding:6px;">${totalInstHrs>0?fmtH(totalInstHrs):'—'}</td>
       <td style="text-align:right;padding:6px;">${commGrandHrs>0?fmtH(commGrandHrs):'—'}</td>
       <td style="text-align:right;padding:6px;font-weight:700;color:#1e40af;">${fmt(grandEE)}</td>`;

  // ── Line detail table ─────────────────────────────────────────────
  let lineDetailSection = '';
  if (includeLines) {
    const lineRows = entered.map(item => {
      const ln = lines[item.wbs_code]||{};
      const qty = parseFloat(ln.qty||'0');
      const factor = parseFloat(ln.factor||'1');
      const delivery = ln.delivery||item.delivery_method||'EE Delivered';
      const desc = item.description||item.wbs_code;
      // simple cost display
      const eeHrs = qty * factor * (item.install_hrs_per||0);
      return `<tr style="border-bottom:1px solid #f3f4f6;font-size:10px;">
        <td style="padding:3px 6px;font-family:monospace;color:#9ca3af;font-size:9px;">${item.wbs_code}</td>
        <td style="padding:3px 6px;max-width:280px;overflow:hidden;">${desc}</td>
        <td style="padding:3px 6px;text-align:center;">${item.uom||'EA'}</td>
        <td style="padding:3px 6px;text-align:center;font-weight:600;">${qty}</td>
        <td style="padding:3px 6px;text-align:center;">${factor!==1?factor:''}</td>
        <td style="padding:3px 6px;text-align:center;font-size:9px;color:#6b7280;">${delivery==='Contractor Delivered'?'Contr.':'EE'}</td>
        <td style="padding:3px 6px;text-align:right;color:#7c3aed;">${eeHrs>0?fmtH(eeHrs):''}</td>
      </tr>`;
    }).join('');
    lineDetailSection = `
      <div style="page-break-before:always;"></div>
      <h2 style="font-size:13px;color:#1e3a5f;margin:0 0 8px;">Entered Supply Lines (${entered.length} items)</h2>
      <table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:16px;">
        <thead>
          <tr style="background:#1e3a5f;color:white;">
            <th style="padding:5px 6px;text-align:left;font-size:9px;">WBS</th>
            <th style="padding:5px 6px;text-align:left;font-size:9px;">Description</th>
            <th style="padding:5px 6px;text-align:center;width:40px;">UOM</th>
            <th style="padding:5px 6px;text-align:center;width:40px;">Qty</th>
            <th style="padding:5px 6px;text-align:center;width:50px;">Factor</th>
            <th style="padding:5px 6px;text-align:center;width:50px;">Delivery</th>
            <th style="padding:5px 6px;text-align:right;width:70px;">Est. Install Hrs</th>
          </tr>
        </thead>
        <tbody>${lineRows}</tbody>
      </table>`;
  }

  // ── Financial Report section ──────────────────────────────────────
  let financialSection = '';
  if (includeFinancial) {
    let subCost=0,matCost=0,eeCost=0,subANS=0,matANS=0,eeANS=0;
    supply.forEach(item => {
      const ln = lines[item.wbs_code]||{};
      if(!parseFloat(ln.qty||'0')) return;
      const c = calcLine(item,ln.qty||'',ln.factor||'1',ln.delivery,ln.instHrsOvrd,ln.contrRate,ln.plant,ln.mats,isCommercial,ln.resourceOvrd,null,0);
      const isContr=(ln.delivery||item.delivery_method||'')==='Contractor Delivered';
      if(isContr){subCost+=(c.contrCost||0)+(c.plantFact||0);subANS+=(c.contrCost||0)*ANS_CON;}
      else{eeCost+=(c.eeLabCost||0)+(c.plantFact||0);eeANS+=(c.eeLabCost||0)*ANS_LAB;}
      matCost+=c.equipCost||0; matANS+=(c.equipCost||0)*ANS_MAT;
    });
    const contPctF=parseFloat(inv.contingency||'0')/100;
    const base=subCost+matCost+eeCost;
    const cont=base*contPctF;
    const totalCost=base+cont;
    const totalANS=subANS+matANS+eeANS;
    const cv=totalCost+totalANS;
    const OVERHEAD=1.866;
    const eeOH=totalCost*OVERHEAD;
    const gst=cv*0.1;
    const gstInc=cv+gst;
    const paDesign=eeCost*0.12;
    const paConstruction=eeCost*0.63;
    const paManagement=eeCost*0.25;

    const finRow=(label,costStar,admin,total,bold)=>`
      <tr style="border-bottom:1px solid #e5e7eb;${bold?'font-weight:700;background:#f8fafc;':''}">
        <td style="padding:5px 8px;font-size:10px;">${label}</td>
        <td style="padding:5px 8px;text-align:right;font-size:10px;">${costStar!==null?fmt(costStar):''}</td>
        <td style="padding:5px 8px;text-align:right;font-size:10px;color:#6b7280;">${admin!==null?fmt(admin):''}</td>
        <td style="padding:5px 8px;text-align:right;font-size:10px;font-weight:600;">${total!==null?fmt(total):''}</td>
      </tr>`;

    const finRowComm=(label,total,bold)=>`
      <tr style="border-bottom:1px solid #e5e7eb;${bold?'font-weight:700;background:#f8fafc;':''}">
        <td style="padding:5px 8px;font-size:10px;">${label}</td>
        <td style="padding:5px 8px;text-align:right;font-size:10px;font-weight:600;">${fmt(total)}</td>
      </tr>`;

    financialSection = `
      <div style="page-break-before:always;"></div>
      <h2 style="font-size:13px;color:#1e3a5f;margin:0 0 8px;">Financial Report</h2>
      ${commercialOnly ? `
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <thead>
          <tr style="background:#1e3a5f;color:white;">
            <th style="padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase;">Category</th>
            <th style="padding:6px 8px;text-align:right;font-size:9px;text-transform:uppercase;">Contract Value</th>
          </tr>
        </thead>
        <tbody>
          ${finRowComm('Sub-Contract (Contractor Delivered)',subCost+subANS,false)}
          ${finRowComm('Materials (PCE/Equipment)',matCost+matANS,false)}
          ${finRowComm('EE Internal Works',eeCost+eeANS,false)}
          ${finRowComm('Contingency ('+parseFloat(inv.contingency||'0')+'%)',cont,false)}
          ${finRowComm('Contract Value (excl. GST)',cv,true)}
          ${finRowComm('GST (10%)',gst,false)}
          ${finRowComm('Contract Value (incl. GST)',gstInc,true)}
        </tbody>
      </table>` : `
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <thead>
          <tr style="background:#1e3a5f;color:white;">
            <th style="padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase;">Category</th>
            <th style="padding:6px 8px;text-align:right;font-size:9px;text-transform:uppercase;">Cost *</th>
            <th style="padding:6px 8px;text-align:right;font-size:9px;text-transform:uppercase;">Admin / ANS Burden</th>
            <th style="padding:6px 8px;text-align:right;font-size:9px;text-transform:uppercase;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${finRow('Sub-Contract (Contractor Delivered)',subCost,subANS,subCost+subANS,false)}
          ${finRow('Materials (PCE/Equipment)',matCost,matANS,matCost+matANS,false)}
          ${finRow('EE Internal Works',eeCost,eeANS,eeCost+eeANS,false)}
          ${finRow('Contingency ('+parseFloat(inv.contingency||'0')+'%)',cont,0,cont,false)}
          ${finRow('Total Estimated Cost',totalCost,null,null,true)}
          ${finRow('Admin / ANS Burden',null,totalANS,null,false)}
          ${finRow('Contract Value (excl. GST)',null,null,cv,true)}
          ${finRow('GST (10%)',null,null,gst,false)}
          ${finRow('Contract Value (incl. GST)',null,null,gstInc,true)}
        </tbody>
      </table>
      <h3 style="font-size:11px;color:#1e3a5f;margin:12px 0 6px;">EE Internal Cost</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
        <thead><tr style="background:#374151;color:white;">
          <th style="padding:5px 8px;text-align:left;font-size:9px;">Metric</th>
          <th style="padding:5px 8px;text-align:right;font-size:9px;">Value</th>
        </tr></thead>
        <tbody>
          <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:4px 8px;font-size:10px;">Direct Spend (Cost*)</td><td style="padding:4px 8px;text-align:right;font-size:10px;font-weight:600;">${fmt(totalCost)}</td></tr>
          <tr style="border-bottom:1px solid #e5e7eb;background:#f8fafc;"><td style="padding:4px 8px;font-size:10px;">Direct Spend incl. Overheads (×1.866)</td><td style="padding:4px 8px;text-align:right;font-size:10px;font-weight:700;color:#1e40af;">${fmt(eeOH)}</td></tr>
        </tbody>
      </table>`}
      <h3 style="font-size:11px;color:#1e3a5f;margin:12px 0 6px;">PA Breakdown (indicative)</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
        <thead><tr style="background:#374151;color:white;">
          <th style="padding:5px 8px;text-align:left;font-size:9px;">PA Category</th>
          <th style="padding:5px 8px;text-align:right;font-size:9px;">Estimated Amount</th>
        </tr></thead>
        <tbody>
          <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:4px 8px;font-size:10px;">Design</td><td style="padding:4px 8px;text-align:right;font-size:10px;">${fmt(paDesign)}</td></tr>
          <tr style="border-bottom:1px solid #e5e7eb;background:#f8fafc;"><td style="padding:4px 8px;font-size:10px;">Construction Labour</td><td style="padding:4px 8px;text-align:right;font-size:10px;">${fmt(paConstruction)}</td></tr>
          <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:4px 8px;font-size:10px;">Project Management</td><td style="padding:4px 8px;text-align:right;font-size:10px;">${fmt(paManagement)}</td></tr>
        </tbody>
      </table>`;
  }

  // ── Assemble full HTML ─────────────────────────────────────────────
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
  <title>IET Summary — ${inv.name||'Investment'}</title>
  <style>
    body { font-family:Arial,sans-serif;font-size:11px;color:#1f2937;margin:0;padding:20px; }
    h1 { font-size:18px;color:#1e3a5f;margin:0 0 4px; }
    h2 { font-size:13px;color:#1e3a5f;margin:16px 0 8px; }
    .subtitle { color:#6b7280;font-size:11px;margin-bottom:14px; }
    .header { display:flex;justify-content:space-between;align-items:flex-start;
              border-bottom:2px solid #1e3a5f;padding-bottom:12px;margin-bottom:14px; }
    table { width:100%;border-collapse:collapse;margin-bottom:14px; }
    th { background:#1e3a5f;color:white;padding:6px 8px;text-align:left;
         font-size:9px;text-transform:uppercase;letter-spacing:0.5px; }
    td { border-bottom:1px solid #e5e7eb; }
    tr:nth-child(even) td { background:#f8fafc; }
    .meta-grid { display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px; }
    .meta-box { border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px; }
    .meta-label { font-size:9px;text-transform:uppercase;color:#9ca3af;letter-spacing:0.5px;margin-bottom:2px; }
    .meta-value { font-weight:600;color:#1f2937;font-size:11px; }
    .phase-cards { display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap; }
    .total-band { display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap; }
    .total-box { background:#1e3a5f;color:white;padding:8px 12px;border-radius:6px;flex:1;min-width:120px; }
    .total-box.orange { background:#ea580c; }
    .total-box.gray { background:#374151; }
    .total-label { font-size:9px;opacity:0.75;text-transform:uppercase; }
    .total-value { font-size:15px;font-weight:700; }
    .footer { margin-top:20px;padding-top:8px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:9px; }
    .cont-row { background:#f0fdf4;border-left:3px solid #16a34a; }
    .esc-row { background:#f0fdfa;border-left:3px solid #0f766e; }
    .final-row { background:#1e3a5f;color:white;font-weight:700;font-size:13px; }
    .final-row td { color:white;border-bottom:none;padding:10px 8px; }
    @media print {
      body { padding:8px; }
      .page-break { page-break-before:always; }
      @page { margin:12mm; }
    }
  </style></head><body>

  <div class="header">
    <div>
      <h1>${inv.name||'Unnamed Investment'}</h1>
      <div class="subtitle">
        ${inv.number} &nbsp;·&nbsp; ${inv.type} &nbsp;·&nbsp;
        ${inv.estClass} Rev ${inv.revision||'A'} &nbsp;·&nbsp;
        ${isCommercial ? 'Commercial + ANS Rates' : 'EE Internal Rates'}
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:9px;color:#9ca3af;">Essential Energy — IET</div>
      <div style="font-size:9px;color:#9ca3af;">Generated ${new Date().toLocaleDateString('en-AU',{dateStyle:'long'})}</div>
    </div>
  </div>

  <!-- Investment metadata -->
  <div class="meta-grid">
    <div class="meta-box"><div class="meta-label">Estimator</div><div class="meta-value">${inv.estimatedBy||'—'}</div></div>
    <div class="meta-box"><div class="meta-label">Reviewer</div><div class="meta-value">${inv.reviewedBy||'—'}</div></div>
    <div class="meta-box"><div class="meta-label">Complexity / New Tech</div><div class="meta-value">${inv.complexity||'—'} / ${inv.newTech||'—'}</div></div>
    <div class="meta-box"><div class="meta-label">Timeline — Planning</div><div class="meta-value">${inv.planDur||'—'} months</div></div>
    <div class="meta-box"><div class="meta-label">Timeline — Design</div><div class="meta-value">${inv.designDur||'—'} months</div></div>
    <div class="meta-box"><div class="meta-label">Timeline — Construction</div><div class="meta-value">${inv.constrDur||'—'} months</div></div>
  </div>

  <!-- Phase summary cards -->
  <h2>Phase Summary</h2>
  <div class="phase-cards">${phaseCards}</div>

  <!-- Financial totals -->
  <div class="total-band">
    ${commercialOnly
      ? `<div class="total-box orange"><div class="total-label">Commercial Total</div><div class="total-value">${fmt(grandComm)}</div></div>`
      : `<div class="total-box"><div class="total-label">EE Internal Total</div><div class="total-value">${fmt(grandEEwithOTV)}</div></div>
         ${isCommercial?`<div class="total-box orange"><div class="total-label">Commercial Total</div><div class="total-value">${fmt(grandComm)}</div></div>`:''}
         ${grandComm>grandEE?`<div class="total-box gray"><div class="total-label">ANS Uplift</div><div class="total-value">${fmt(grandComm-grandEE)}</div></div>`:''}`}
  </div>

  <!-- WBS Cost Tree -->
  <h2>WBS Cost Breakdown ${useCurrentExpand?'(current view)':'(fully expanded)'}</h2>
  <table>
    <thead><tr>
      <th>WBS / Description</th>
      ${wbsColHdrs}
    </tr></thead>
    <tbody>${wbsRows}</tbody>
    <tfoot>
      <tr style="font-weight:700;background:#f0f4ff;border-top:2px solid #1e3a5f;font-size:11px;">
        <td style="padding:6px 8px;">Total (excl. contingency &amp; escalation)</td>
        ${wbsFooterCols}
      </tr>
    </tfoot>
  </table>

  <!-- Contingency + Escalation + Final Total -->
  <table>
    <tbody>
      ${(otCostVal>0 && !commercialOnly)?`
      <tr class="cont-row" style="background:#fffbeb;"><td style="padding:5px 8px;font-size:10px;color:#92400e;">Cost of 20% OT for Internal Resources</td>
        <td style="padding:5px 8px;text-align:right;color:#92400e;font-weight:600;">${fmt(otCostVal)}</td>
        ${isCommercial?`<td style="padding:5px 8px;text-align:right;color:#d97706;">—</td>`:''}
      </tr>`:''}
      <tr class="cont-row"><td style="padding:5px 8px;font-size:10px;">Base Estimate (excl. contingency &amp; escalation)</td>
        ${commercialOnly?'':`<td style="padding:5px 8px;text-align:right;font-weight:700;color:#1e40af;">${fmt(grandEEwithOTV)}</td>`}
        ${(isCommercial)?`<td style="padding:5px 8px;text-align:right;font-weight:700;color:#c2410c;">${fmt(grandComm)}</td>`:''}
      </tr>
      <tr class="cont-row"><td style="padding:5px 8px;font-size:10px;">Contingency (${contPct}%)</td>
        ${commercialOnly?'':`<td style="padding:5px 8px;text-align:right;">${fmt(contAmt*(grandEEwithOTV/(grandComm||grandEEwithOTV)))}</td>`}
        ${isCommercial?`<td style="padding:5px 8px;text-align:right;">${fmt(contAmt)}</td>`:''}
      </tr>
      ${escResult.escTotal>0?`
      <tr class="esc-row"><td style="padding:5px 8px;font-size:10px;">📈 Escalation (weighted avg)</td>
        ${commercialOnly?'':`<td style="padding:5px 8px;text-align:right;color:#0f766e;font-weight:600;">${fmt(escResult.escTotal)}</td>`}
        ${isCommercial?`<td style="padding:5px 8px;text-align:right;color:#0f766e;font-weight:600;">${fmt(escResult.escComm)}</td>`:''}
      </tr>`:''}
      <tr class="final-row">
        <td>TOTAL — Base + Contingency + Escalation &nbsp;·&nbsp; ${inv.estClass} Rev ${inv.revision||'A'}</td>
        ${commercialOnly?'':`<td style="text-align:right;">${fmt(finalTotal*(grandEEwithOTV/(grandComm||grandEEwithOTV)))}</td>`}
        ${isCommercial?`<td style="text-align:right;color:#fed7aa;">${fmt(finalTotal)}</td>`:''}
      </tr>
    </tbody>
  </table>

  ${(isCommercial&&grandComm>0&&!commercialOnly)?`
  <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:8px 12px;font-size:10px;color:#92400e;margin-bottom:12px;">
    <strong>ANS Margins:</strong> Labour ×${((ANS_LAB)*100).toFixed(0)}% &nbsp;·&nbsp;
    Materials ×${((ANS_MAT)*100).toFixed(0)}% &nbsp;·&nbsp;
    Contractor ×${((ANS_CON)*100).toFixed(0)}% &nbsp;·&nbsp;
    EE Internal base: ${fmt(grandEEwithOTV)} &nbsp;·&nbsp; Commercial uplift: ${fmt(grandComm-grandEEwithOTV)}
  </div>`:''}

  ${lineDetailSection}
  ${financialSection}

  <div class="footer">
    IET Estimation Tool — Essential Energy &nbsp;·&nbsp;
    ${inv.number} Rev ${inv.revision||'A'} · ${inv.estClass} &nbsp;·&nbsp;
    Estimator: ${inv.estimatedBy||'—'} &nbsp;·&nbsp; Generated ${new Date().toLocaleString('en-AU',{dateStyle:'medium',timeStyle:'short'})}
    <br>This document is ${inv.status||'Draft'} status and ${inv.status==='Approved'?'has been formally approved.':'has not been formally approved.'}
  </div>

  <script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}</script>
  </body></html>`;

  const w = window.open('','_blank','width=1000,height=800');
  w.document.write(html);
  w.document.close();
}

function SummaryScreen({ inv, lines, isCommercial, equipSel, onSave, lastSaved, estimateLocked }) {
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

  // Add direct-entry commission rows (earthing, PSN/CSN, misc) to phase4 totals
  const phase4Direct = Object.entries(commLookup).filter(([,d])=>d.direct_entry).reduce((a,[wbs,data])=>{
    const dq   = parseFloat(lines[`comm_direct_${wbs}`]?.qty||"0")||0;
    if (dq<=0) return a;
    const ovrd = lines[`comm_ovrd_${wbs}`]?.qty;
    const hrs  = (ovrd!==undefined&&ovrd!=="")?(parseFloat(ovrd)||0):dq*(data.hrs_per_unit||0);
    const rate = data.ee_labour_rate||139.26;
    const cost = hrs*rate;
    return {commHrs:a.commHrs+hrs,eeInt:a.eeInt+cost,comm:a.comm+cost*(1+ANS_LAB)};
  },{commHrs:0,eeInt:0,comm:0});
  const phase4Combined = {
    commHrs: phase4.commHrs + phase4Direct.commHrs,
    eeInt:   phase4.eeInt   + phase4Direct.eeInt,
    comm:    phase4.comm    + phase4Direct.comm,
    lines:   phase4.lines,
  };
  if(phase4Combined.commHrs>0) byPhase["4"]={...phase4Combined,installHrs:0,eeLabCost:phase4Combined.eeInt,contrCost:0,matCost:0};

  // commGrandHrs available locally for WBS table column
  const commGrandHrs = phase4Combined.commHrs;

  const grandEE   = Object.values(byPhase).reduce((a,p)=>a+p.eeInt,0);
  const grandComm = Object.values(byPhase).reduce((a,p)=>a+p.comm,0);

  // ── 20% OT for Internal Resources ───────────────────────────────
  // Mirrors the master workbook's "Cost of 20% Overtime for Internal
  // Resources" line on the Summary-Internal sheet — a single uplift
  // applied to the EE-delivered internal labour cost (not contractors,
  // not materials), derived from the Resource Rates "EE Internal +20% OT"
  // column vs the ordinary "EE Internal" rate.
  const otRatio = useMemo(()=>{
    const awd = Object.values(resourceCodes||{}).find(r=>r.erp_code==="AWD" && r.ee_internal_rate_ot && r.ee_internal_rate);
    return awd ? (awd.ee_internal_rate_ot/awd.ee_internal_rate - 1) : 0;
  },[resourceCodes]);
  const grandEELabCost = Object.values(byPhase).reduce((a,p)=>a+(p.eeLabCost||0),0);
  const otCost   = grandEELabCost * otRatio;
  const grandEEwithOT = grandEE + otCost;

  const contBase  = isCommercial?grandComm:grandEEwithOT;
  const contRes   = resolveContingency(inv, contBase, isCommercial);
  const contPct   = contRes.pct;
  const contAmt   = contRes.amt;
  const totalWithCont = contBase+contAmt;

  // ── ESCALATION ──────────────────────────────────────────────────
  // Calculate weighted escalation per phase using project timeline
  const escResult = useMemo(()=>{
    // EE Internal labour is NOT escalated — EE labour rates are reviewed
    // annually and already reflect current-year cost, so only Contractor
    // and Materials costs carry a forward escalation allowance.
    if (!escRates) return { escContr:0, escMat:0, escTotal:0, escComm:0, byCategory:{} };
    const rContr = Object.values(escRates.contractors.rates).map(r=>r/100);
    const rMat   = Object.values(escRates.materials.rates).map(r=>r/100);

    const phaseDefs = {
      "1": { start:1,                                    dur:parseInt(inv.planDur||4)   },
      "2": { start:parseInt(inv.designStart||1),         dur:parseInt(inv.designDur||9) },
      "3": { start:parseInt(inv.constrStart||6),         dur:parseInt(inv.constrDur||15)},
      "4": { start:parseInt(inv.constrStart||6),         dur:parseInt(inv.constrDur||15)},
      "5": { start:parseInt(inv.constrStart||6)+parseInt(inv.constrDur||15)-1, dur:2   },
    };

    let escContr=0, escMat=0;
    Object.entries(byPhase).forEach(([ph, costs])=>{
      const pd = phaseDefs[ph];
      if (!pd || pd.dur <= 0) return;
      let avgContr=0, avgMat=0;
      for (let m=pd.start; m<pd.start+pd.dur; m++) {
        avgContr += escalationIndex(m, rContr);
        avgMat   += escalationIndex(m, rMat);
      }
      avgContr /= pd.dur;
      avgMat   /= pd.dur;
      escContr += (costs.contrCost||0) * avgContr;
      escMat   += (costs.matCost||0)   * avgMat;
    });

    const escTotal = escContr + escMat;
    const escComm  = escTotal * (1 + ANS_LAB); // ANS uplift on escalation for commercial
    return {
      escContr, escMat, escTotal,
      escComm: isCommercial ? escComm : escTotal,
      byCategory: {
        "Contractors": { val: escContr, pct: grandEE>0   ? escContr/grandEE*100 : 0 },
        "Materials":   { val: escMat,   pct: grandEE>0   ? escMat/grandEE*100   : 0 },
      }
    };
  },[escRates, byPhase, inv, isCommercial]);

  const finalTotal = (isCommercial ? grandComm : grandEEwithOT) + contAmt + (isCommercial ? escResult.escComm : escResult.escTotal);

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
    const bgColors = ["","bg-[var(--primary-50)]","bg-indigo-50","bg-gray-50","bg-white","bg-white"];
    const textColors = ["","text-[var(--primary-900)]","text-indigo-800","text-gray-800","text-gray-700","text-gray-600"];
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
          <div className={`py-1.5 text-right pr-2 text-[var(--primary-800)] ${depth<=2?"font-bold":"font-medium"}`}>{fmt(roll.eeInt)}</div>
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
            <div className="flex items-center gap-3 flex-wrap justify-end">
              {lastSaved && <span className="text-xs text-green-600">✓ Saved {lastSaved}</span>}
              {estimateLocked
                ? <span className="text-xs bg-green-100 text-green-700 border border-green-300 px-3 py-2 rounded font-semibold flex items-center gap-1.5">🔒 Approved — read only</span>
                : <button onClick={onSave} className="bg-green-700 hover:bg-green-600 text-white text-xs px-4 py-2 rounded font-semibold shadow">💾 Save Investment</button>
              }
              <button onClick={()=>exportSummaryPDF({inv,lines,isCommercial,byPhase,grandEE,grandComm,contPct,contAmt,escResult,finalTotal,commGrandHrs,nodeRollup,phaseNodes,openNodes,phaseNames,descMap,entered,supply,commTotals,commProfiles,ANS_LAB,ANS_MAT,ANS_CON,otCost,grandEEwithOT})}
                className="bg-indigo-700 hover:bg-indigo-600 text-white text-xs px-4 py-2 rounded font-semibold shadow">
                📄 Export Summary PDF
              </button>
              <button onClick={()=>{
                const suffix = isCommercial ? "ANS_RATES" : "EE_RATES";
                const filename = `${inv.number||"IET"}_${suffix}_Copperleaf.xlsx`;
                generateCopperleafXLSX(inv, lines, supply, commLookup, commProfiles, escRates, resourceCodes, isCommercial, equipLookup)
                  .then(blob => downloadBlob(blob, filename))
                  .catch(err => alert("Export failed: " + err.message));
              }} className="bg-teal-700 hover:bg-teal-600 text-white text-xs px-4 py-2 rounded font-semibold shadow">
                ☁️ Export Copperleaf XLSX
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
              <div className="text-sm font-bold text-[var(--primary-800)]">{fmt(p.eeInt)}</div>
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
            <div className="flex items-center justify-between px-4 py-2 bg-[var(--primary-800)] text-white">
              <div className="font-bold text-sm">WBS Cost Breakdown</div>
              <div className="flex items-center gap-2">
                <button onClick={()=>setOpenNodes({})} className="text-xs bg-[var(--primary-700)] hover:bg-[var(--primary-600)] px-2 py-1 rounded">Collapse All</button>
                <button onClick={()=>{
                  const all={};
                  Object.keys(nodeRollup).filter(k=>k.split('.').length<5).forEach(k=>{all[k]=true;});
                  setOpenNodes(all);
                }} className="text-xs bg-[var(--primary-700)] hover:bg-[var(--primary-600)] px-2 py-1 rounded">Expand All</button>
              </div>
            </div>
            {/* Column headers */}
            <div className="grid border-b bg-gray-50 text-xs font-semibold text-gray-500"
              style={{gridTemplateColumns: isCommercial?"1fr 80px 80px 90px 90px":"1fr 80px 80px 90px"}}>
              <div className="px-3 py-2">WBS / Description</div>
              <div className="py-2 text-center text-purple-600">Install Hrs</div>
              <div className="py-2 text-center text-teal-600 whitespace-nowrap">Comm Hrs<div className="text-[9px] font-normal text-gray-400">(Ph.4 derived)</div></div>
              <div className="py-2 text-right pr-2 text-[var(--primary-700)]">EE Internal</div>
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
              <div className="py-2 text-right pr-2 text-[var(--primary-900)] text-sm">{fmt(grandEE)}</div>
              {isCommercial && <div className="py-2 text-right pr-2 text-orange-800 text-sm">{fmt(grandComm)}</div>}
            </div>
          </div>
        )}

        {/* Contingency + Escalation + Grand Total */}
        {grandEE>0 && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            {/* 20% OT for internal resources */}
            {otCost>0 && (
              <div className="grid text-xs border-b bg-amber-50" style={{gridTemplateColumns: isCommercial?"1fr 100px 100px":"1fr 100px"}}>
                <div className="px-4 py-2 text-amber-800 font-medium flex items-center gap-1.5">
                  Cost of 20% OT for Internal Resources
                  <span className="text-amber-500 font-normal" title="Combined 80% Ordinary + 20% Overtime rate vs Ordinary rate, applied to EE-delivered labour cost — see Resource Rates page">ⓘ</span>
                </div>
                <div className="py-2 text-right pr-4 text-amber-700 font-semibold">{fmt(otCost)}</div>
                {isCommercial && <div className="py-2 text-right pr-4 text-amber-400">—</div>}
              </div>
            )}
            {/* Contingency row */}
            <div className="grid text-xs border-b" style={{gridTemplateColumns: isCommercial?"1fr 100px 100px":"1fr 100px"}}>
              <div className="px-4 py-2 text-gray-600 font-medium">Base Estimate (excl. contingency &amp; escalation)</div>
              <div className="py-2 text-right pr-4 font-bold text-[var(--primary-900)]">{fmt(grandEEwithOT)}</div>
              {isCommercial && <div className="py-2 text-right pr-4 font-bold text-orange-800">{fmt(grandComm)}</div>}
            </div>
            <div className="grid text-xs border-b" style={{gridTemplateColumns: isCommercial?"1fr 100px 100px":"1fr 100px"}}>
              <div className="px-4 py-2 text-gray-600 flex items-center gap-1.5">
                Contingency ({contPct.toFixed(1)}%)
                {contRes.source==="cart"
                  ? <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-semibold" title={`CART P50 — run ${new Date(contRes.cr.runAt).toLocaleDateString("en-AU")}`}>🎲 CART P50</span>
                  : <span className="text-xs text-gray-400" title="Pre-risk estimator percentage — run CART to replace with a simulated P50">pre-risk</span>}
              </div>
              <div className="py-2 text-right pr-4 text-[var(--primary-600)] font-medium">
                {fmt(isCommercial ? contAmt * (grandEEwithOT/(grandComm||grandEEwithOT)) : contAmt)}
              </div>
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
            <div className="grid font-bold text-sm bg-[var(--primary-900)] text-white"
              style={{gridTemplateColumns: isCommercial?"1fr 100px 100px":"1fr 100px"}}>
              <div className="px-4 py-3.5">
                TOTAL — Base + Contingency + Escalation
                <div className="text-xs font-normal opacity-75 mt-0.5">
                  {inv.name||"Investment"} · {inv.estClass} · Rev {inv.revision}
                </div>
              </div>
              <div className="py-3.5 text-right pr-4 text-white text-base">{fmt(isCommercial ? finalTotal * (grandEEwithOT/(grandComm||grandEEwithOT)) : finalTotal)}</div>
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
  "In Review":  { bg:"bg-[var(--primary-100)]",     text:"text-[var(--primary-700)]",   dot:"bg-[var(--primary-500)]"   },
  "Approved":   { bg:"bg-green-100",    text:"text-green-700",  dot:"bg-green-500"  },
  "On Hold":    { bg:"bg-yellow-100",   text:"text-yellow-700", dot:"bg-yellow-500" },
  "Rejected":   { bg:"bg-red-100",      text:"text-red-700",    dot:"bg-red-500"    },
};
const CLASS_COLOR = {
  "Class 1":"bg-red-100 text-red-700","Class 2":"bg-orange-100 text-orange-700",
  "Class 3":"bg-yellow-100 text-yellow-700","Class 4":"bg-[var(--primary-100)] text-[var(--primary-700)]",
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

    // Cost* column = base cost (no ANS, no contingency)
    const base      = subCost + matCost + eeCost;

    // Contingency: CART P50 once run for this stream against this base,
    // else the estimator's pre-risk percentage (Investment Setup)
    const contRes   = resolveContingency(inv, base, isCommercial);
    const contPct   = contRes.pct/100;
    const cont      = contRes.amt;

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
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3 w-3/4">
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
  "Zone Substation":      "bg-[var(--primary-100)] text-[var(--primary-700)] border border-[var(--primary-200)]",
  "Subtransmission Mains":"bg-orange-100 text-orange-700 border border-orange-200",
  "SCADA & Comms":        "bg-purple-100 text-purple-700 border border-purple-200",
  "Distribution":         "bg-green-100 text-green-700 border border-green-200",
};
const COMPLEXITY_DOT = { "High":"bg-red-400", "Medium":"bg-yellow-400", "Low":"bg-green-400" };

function TemplateLibrary({ onLoad, saved, setSaved, currentInv, currentLines }) {
  const [search,      setSearch]      = useState("");
  const [catFilter,   setCatFilter]   = useState("All");
  const [selected,    setSelected]    = useState(null);
  const [customName,  setCustomName]  = useState("");
  const [customNum,   setCustomNum]   = useState("");
  const [customClass, setCustomClass] = useState("");
  const [customType,  setCustomType]  = useState("");

  // Custom templates stored in localStorage
  const [customTemplates, setCustomTemplates] = useState(() => {
    try { const r = localStorage.getItem("iet_custom_templates"); return r ? JSON.parse(r) : []; } catch(e) { return []; }
  });
  const saveCustomTemplates = (arr) => {
    setCustomTemplates(arr);
    localStorage.setItem("iet_custom_templates", JSON.stringify(arr));
  };

  // Save-as-template modal state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveForm, setSaveForm] = useState({
    name:"", category:"Zone Substation", icon:"⚡", description:"", tags:"", complexity:"Medium",
  });
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Count non-zero qty lines in current estimate
  const currentQtyLines = currentLines
    ? Object.entries(currentLines).filter(([,ln]) => parseFloat(ln.qty||0) > 0)
    : [];
  const hasEstimate = currentInv && currentInv.name && currentQtyLines.length > 0;

  const openSaveModal = () => {
    setSaveForm({
      name: currentInv?.name || "",
      category: "Zone Substation",
      icon: "⚡",
      description: "",
      tags: "",
      complexity: currentInv?.complexity || "Medium",
    });
    setSaveError("");
    setSaveSuccess(false);
    setShowSaveModal(true);
  };

  const doSaveTemplate = () => {
    if (!saveForm.name.trim()) { setSaveError("Template name is required."); return; }
    const lines = {};
    currentQtyLines.forEach(([wbs, ln]) => {
      lines[wbs] = { qty: ln.qty, factor: ln.factor || "1" };
    });
    const newTmpl = {
      id: `tmpl_custom_${Date.now()}`,
      _custom: true,
      category: saveForm.category,
      name: saveForm.name.trim(),
      description: saveForm.description.trim() || `Custom template built from ${currentInv.name}.`,
      estClass: currentInv.estClass || "Class 5",
      type: currentInv.type || "Internally Funded",
      complexity: saveForm.complexity,
      icon: saveForm.icon || "📋",
      tags: saveForm.tags.split(",").map(t=>t.trim()).filter(Boolean),
      inv: {
        name:        saveForm.name.trim(),
        number:      "",
        estClass:    currentInv.estClass || "Class 5",
        type:        currentInv.type || "Internally Funded",
        complexity:  currentInv.complexity || "Medium",
        newTech:     currentInv.newTech || "No",
        planDur:     currentInv.planDur || "3",
        designDur:   currentInv.designDur || "6",
        constrDur:   currentInv.constrDur || "12",
        designStart: currentInv.designStart || "1",
        constrStart: currentInv.constrStart || "4",
        contingency: currentInv.contingency || "15",
        startMonth:  currentInv.startMonth || "Jul",
        startYear:   currentInv.startYear || "2025",
      },
      lines,
      _savedAt: new Date().toISOString(),
      _sourceInv: currentInv.name,
    };
    saveCustomTemplates([...customTemplates, newTmpl]);
    setSaveSuccess(true);
    setTimeout(() => setShowSaveModal(false), 1200);
  };

  const deleteCustomTemplate = (id, e) => {
    e.stopPropagation();
    if (selected?.id === id) setSelected(null);
    saveCustomTemplates(customTemplates.filter(t => t.id !== id));
  };

  // Merge built-in + custom templates
  const allTemplates = [...IET_TEMPLATES, ...customTemplates];
  const categories = ["All", ...Array.from(new Set(allTemplates.map(t=>t.category)))];

  const filtered = allTemplates.filter(t => {
    const ms = !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.description.toLowerCase().includes(search.toLowerCase()) ||
      (t.tags||[]).some(tag=>tag.toLowerCase().includes(search.toLowerCase()));
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

  const ICONS = ["⚡","🏗️","🔌","📡","🔧","🏭","🌐","📋","⚙️","🔋","🛡️","📐"];
  const CATEGORIES = ["Zone Substation","Subtransmission Mains","SCADA & Comms","Distribution","Ancillary"];

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Save-as-template modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={()=>setShowSaveModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[90vh] flex flex-col overflow-hidden" onClick={e=>e.stopPropagation()}>
            <div className="bg-[#1e3a5f] text-white px-5 py-3.5 flex items-center justify-between flex-shrink-0">
              <div>
                <div className="font-bold text-sm">Save Current Estimate as Template</div>
                <div className="text-[var(--primary-300)] text-xs mt-0.5">{currentQtyLines.length} scope lines · Class 5</div>
              </div>
              <button onClick={()=>setShowSaveModal(false)} className="text-[var(--primary-300)] hover:text-white text-lg leading-none">✕</button>
            </div>

            {saveSuccess ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 gap-3">
                <div className="text-5xl">✅</div>
                <div className="text-lg font-bold text-green-700">Template saved!</div>
                <div className="text-sm text-gray-500">Available in the Template Library.</div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {/* Source info */}
                <div className="bg-[var(--primary-50)] border border-[var(--primary-200)] rounded-lg p-3 text-xs text-[var(--primary-800)]">
                  <div className="font-semibold mb-1">Source estimate</div>
                  <div className="text-[var(--primary-700)]">{currentInv?.name || "Unnamed"} · {currentInv?.estClass} · {currentQtyLines.length} lines with quantities</div>
                  <div className="text-[var(--primary-500)] mt-0.5">All current quantities, factors and delivery methods will be saved into the template.</div>
                </div>

                {/* Name */}
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Template Name *</label>
                  <input value={saveForm.name} onChange={e=>setSaveForm(p=>({...p,name:e.target.value}))}
                    className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"
                    placeholder="e.g. 132kV 3-Bay Zone Substation"/>
                </div>

                {/* Category + Icon */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-600 block mb-1">Category</label>
                    <select value={saveForm.category} onChange={e=>setSaveForm(p=>({...p,category:e.target.value}))}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none">
                      {CATEGORIES.map(c=><option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 block mb-1">Complexity</label>
                    <select value={saveForm.complexity} onChange={e=>setSaveForm(p=>({...p,complexity:e.target.value}))}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none">
                      {["Low","Medium","High","Very High"].map(c=><option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                {/* Icon picker */}
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Icon</label>
                  <div className="flex flex-wrap gap-1.5">
                    {ICONS.map(ic=>(
                      <button key={ic} onClick={()=>setSaveForm(p=>({...p,icon:ic}))}
                        className={`text-xl w-9 h-9 flex items-center justify-center rounded border-2 transition-colors ${saveForm.icon===ic?"border-[var(--primary-500)] bg-[var(--primary-50)]":"border-gray-200 hover:border-[var(--primary-300)]"}`}>
                        {ic}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Description</label>
                  <textarea value={saveForm.description} onChange={e=>setSaveForm(p=>({...p,description:e.target.value}))}
                    rows={2} placeholder="Brief description of what this template covers…"
                    className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                </div>

                {/* Tags */}
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Tags <span className="font-normal text-gray-400">(comma-separated)</span></label>
                  <input value={saveForm.tags} onChange={e=>setSaveForm(p=>({...p,tags:e.target.value}))}
                    placeholder="e.g. 132kV, Greenfield, Zone Substation"
                    className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                </div>

                {/* Scope preview */}
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Scope lines to save ({currentQtyLines.length})</label>
                  <div className="bg-gray-50 rounded border border-gray-200 max-h-36 overflow-y-auto">
                    {currentQtyLines.map(([wbs,ln])=>(
                      <div key={wbs} className="flex items-center justify-between px-2.5 py-1 border-b border-gray-100 last:border-0 text-xs">
                        <span className="font-mono text-gray-500 text-[10px]">{wbs}</span>
                        <span className="text-gray-700 font-semibold">Qty {ln.qty}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {saveError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{saveError}</div>}
              </div>
            )}

            {!saveSuccess && (
              <div className="border-t px-5 py-3 flex gap-2 flex-shrink-0">
                <button onClick={()=>setShowSaveModal(false)}
                  className="flex-1 text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 py-2 rounded font-semibold">
                  Cancel
                </button>
                <button onClick={doSaveTemplate}
                  className="flex-1 text-xs bg-[var(--primary-700)] hover:bg-[var(--primary-600)] text-white py-2 rounded font-bold">
                  💾 Save Template
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Left — template list */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-shrink-0 flex-wrap">
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search templates…"
            className="flex-1 min-w-32 border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
          <div className="flex border border-gray-200 rounded overflow-hidden">
            {categories.map(c=>(
              <button key={c} onClick={()=>setCatFilter(c)}
                className={`text-xs px-2.5 py-1 transition-colors ${catFilter===c?"bg-[var(--primary-700)] text-white":"text-gray-600 hover:bg-gray-50"}`}>{c}</button>
            ))}
          </div>
          <span className="text-xs text-gray-400">{filtered.length} templates</span>
          <div className="flex-1 min-w-0"/>
          {/* Save-as-template button */}
          <button
            onClick={hasEstimate ? openSaveModal : undefined}
            title={hasEstimate ? "Save current estimate as a reusable template" : "Open an estimate with quantities to save as template"}
            className={`text-xs px-3 py-1.5 rounded font-semibold flex items-center gap-1.5 transition-colors ${
              hasEstimate
                ? "bg-green-700 hover:bg-green-600 text-white cursor-pointer"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}>
            💾 Save Current as Template
            {!hasEstimate && <span className="text-[10px] font-normal opacity-75">(needs active estimate)</span>}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 gap-3">
          {filtered.map(tmpl=>(
            <div key={tmpl.id}
              onClick={()=>{ setSelected(tmpl); setCustomName(tmpl.inv.name); setCustomNum(""); setCustomClass(tmpl.inv.estClass); setCustomType(tmpl.inv.type); }}
              className={`bg-white rounded-lg border-2 p-4 cursor-pointer transition-all ${selected?.id===tmpl.id?"border-[var(--primary-500)] shadow-md":"border-gray-200 hover:border-[var(--primary-300)] hover:shadow-sm"}`}>
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
                    {tmpl._custom && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200 font-semibold">Custom</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{tmpl.description}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(tmpl.tags||[]).map(tag=>(
                      <span key={tag} className="text-[10px] bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">{tag}</span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="text-[10px] text-gray-400">
                      {Object.keys(tmpl.lines).length} pre-populated scope lines · {tmpl.inv.planDur}m plan · {tmpl.inv.designDur}m design · {tmpl.inv.constrDur}m construction
                    </div>
                    {tmpl._custom && (
                      <button
                        onClick={(e)=>deleteCustomTemplate(tmpl.id, e)}
                        className="text-[10px] text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors"
                        title="Delete this custom template">
                        🗑 Delete
                      </button>
                    )}
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
              <div className="text-[var(--primary-300)] text-xs mt-0.5">{selected.category}{selected._custom?" · Custom template":""}</div>
            </div>
            <button onClick={()=>setSelected(null)} className="text-[var(--primary-400)] hover:text-white text-sm ml-2">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <div className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">Customise Before Opening</div>
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Investment Name</label>
                  <input value={customName} onChange={e=>setCustomName(e.target.value)}
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Investment Number</label>
                  <input value={customNum} onChange={e=>setCustomNum(e.target.value)}
                    placeholder="e.g. 10012345"
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
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

            {selected._custom && selected._savedAt && (
              <div className="text-[10px] text-gray-400 bg-green-50 border border-green-100 rounded p-2">
                <span className="font-semibold text-green-700">Custom template</span> · Built from: {selected._sourceInv || "estimate"}<br/>
                Saved: {new Date(selected._savedAt).toLocaleString("en-AU",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}
              </div>
            )}
          </div>

          <div className="border-t p-3 flex-shrink-0 space-y-2">
            <button onClick={()=>openTemplate(selected)}
              className="w-full bg-[var(--primary-700)] hover:bg-[var(--primary-600)] text-white text-sm py-2.5 rounded-lg font-bold flex items-center justify-center gap-2">
              {selected.icon} Open Template as New Estimate
            </button>
            <div className="text-[10px] text-gray-400 text-center">Opens in Estimation Tool · Save when ready to add to Portfolio</div>
          </div>
        </div>
      )}
    </div>
  );
}

function InvestmentHub({ onLoad, onNew, currentInv, currentLines }) {
  // Resolved pricing context — used to freeze a rate snapshot at the moment of approval
  const { supply: snapSupply, rates: snapRates, commLookup: snapCommLookup } = useData();
  const [hubTab,      setHubTab]      = useState("portfolio");
  const [saved,       setSaved]       = useState([]);
  const [search,      setSearch]      = useState("");
  const [statusFilter,setStatusFilter]= useState("All");
  const [classFilter, setClassFilter] = useState("All");
  const [typeFilter,  setTypeFilter]  = useState("All");
  const [sortBy,      setSortBy]      = useState("savedAt");
  const [sortDir,     setSortDir]     = useState("desc");
  const [selected,    setSelected]    = useState(null);
  const [editStatus,      setEditStatus]     = useState(null); // id of investment being status-edited
  const [approveModal,    setApproveModal]   = useState(null); // {id, currentStatus} when PIN modal open
  const [approvePinVal,   setApprovePinVal]  = useState("");
  const [approvePinErr,   setApprovePinErr]  = useState(false);
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

  const APPROVE_PIN = "1607"; // Same manager PIN — in Power Platform this becomes AD role check

  // Commit a status change directly (non-Approve transitions)
  const commitStatus = (id, newStatus) => {
    const updated = saved.map(s=>s.id===id ? {...s,status:newStatus} : s);
    setSaved(updated);
    localStorage.setItem("iet_investments", JSON.stringify(updated));
    setEditStatus(null);
  };

  // Route status changes: Approved requires PIN; cannot change away from Approved via dropdown
  const updateStatus = (id, newStatus, currentStatus) => {
    if (currentStatus === "Approved") {
      // Once Approved, status is immutable via dropdown — use Unlock to Amend instead
      setEditStatus(null);
      return;
    }
    if (newStatus === "Approved") {
      // Require PIN to set Approved
      setApprovePinVal("");
      setApprovePinErr(false);
      setApproveModal({ id, currentStatus });
      setEditStatus(null);
      return;
    }
    commitStatus(id, newStatus);
  };

  const confirmApproval = (id) => {
    if (approvePinVal === APPROVE_PIN) {
      // ── Rate snapshot on approval (demo version of Prompt 5D) ──
      // Freeze the resolved prices and rate table at this moment so the
      // approved estimate never reprices when master rates/equipment
      // pricing change later. Never snapshot twice.
      const target = saved.find(s=>s.id===id);
      const rateSnapshot = target?.rateSnapshot || {
        takenAt: new Date().toISOString(),
        prices: Object.fromEntries((snapSupply||[]).filter(s=>s.pce_price!=null).map(s=>[s.wbs_code, s.pce_price])),
        rates: JSON.parse(JSON.stringify(snapRates||[])),
      };
      const updated = saved.map(s=>s.id===id ? {...s, status:"Approved", rateSnapshot} : s);
      setSaved(updated);
      localStorage.setItem("iet_investments", JSON.stringify(updated));
      setEditStatus(null);
      setApproveModal(null);
      setApprovePinVal("");
      setApprovePinErr(false);
    } else {
      setApprovePinErr(true);
      setApprovePinVal("");
      setTimeout(() => setApprovePinErr(false), 1500);
    }
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
      rateSnapshot: undefined, // new version re-prices against CURRENT rates — snapshot stays with the approved original
    };
    const updated = [...saved, promoted];
    setSaved(updated);
    localStorage.setItem("iet_investments", JSON.stringify(updated));
    setShowCloneModal(false);
    setCloneSource(null);
    setSelected(promoted);
  };

  // Parse imported JSON — accepts a raw IET save blob or minimal JSON
  const [importBusy, setImportBusy] = useState(false);
  const [importFileName, setImportFileName] = useState("");

  // Parse an IET estimate workbook (.xlsm/.xlsx) in the browser via SheetJS.
  // Reads 'General Information' (investment metadata, fixed label/value cells)
  // and 'Database & Estimate' (WBS col D, estimate quantity col AR, factor col U).
  const parseWorkbook = async (buf, fileName) => {
    setImportBusy(true);
    setImportError("");
    setImportPreview(null);
    try {
      if (!window.XLSX) {
        await new Promise((res,rej)=>{
          const s=document.createElement("script");
          s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
          s.onload=res; s.onerror=rej; document.head.appendChild(s);
        });
      }
      const XL = window.XLSX;
      const wbk = XL.read(buf, { type:"array", cellStyles:false, sheets:["General Information","Database & Estimate"] });
      const gi = wbk.Sheets["General Information"];
      const de = wbk.Sheets["Database & Estimate"];
      if (!gi || !de) { setImportError("Workbook doesn't look like an IET estimate — needs 'General Information' and 'Database & Estimate' sheets."); setImportBusy(false); return; }
      const cv = (sheet,addr)=>{ const c=sheet[addr]; return c==null?undefined:c.v; };
      const cs = (sheet,addr)=>{ const v=cv(sheet,addr); return v==null?"":String(v).trim(); };
      const EC = XL.utils.encode_cell;

      // ── General Information → inv ──
      // Hardened: labels are FOUND, not assumed at fixed rows — older
      // workbook versions (e.g. v1.1) moved fields between rows.
      // Scan the first 8 columns × 80 rows for each label; value is the
      // cell(s) immediately to the right of where the label was found.
      const giFind = (test) => {
        for (let r=0; r<80; r++) for (let c=0; c<8; c++) {
          const v = gi[EC({r,c})]?.v;
          if (typeof v==="string" && test(v.trim())) return {r,c};
        }
        return null;
      };
      const giVal = (test, offset=1) => {
        const p = giFind(test);
        if (!p) return "";
        const v = gi[EC({r:p.r, c:p.c+offset})]?.v;
        return v==null ? "" : String(v).trim();
      };
      const giNum = (test, offset=1) => {
        const p = giFind(test);
        if (!p) return undefined;
        const v = gi[EC({r:p.r, c:p.c+offset})]?.v;
        return typeof v==="number" ? v : undefined;
      };
      const eq = s => t => t===s;
      const starts = s => t => t.toLowerCase().startsWith(s.toLowerCase());

      const inv = { ...defaultInv };
      inv.name        = giVal(eq("Investment Name:")) || "Imported Estimate";
      inv.number      = giVal(eq("Investment No.:"));
      inv.wacs        = giVal(eq("WACS No.:")) || "N/A";
      inv.startMonth  = giVal(starts("Start Month of the Investment")) || inv.startMonth;
      inv.startYear   = giVal(starts("Start Month of the Investment"),2) || inv.startYear;
      inv.estimatedBy = giVal(starts("Estimated By")) || inv.estimatedBy;
      const rb        = giVal(starts("Reviewed By"));
      inv.reviewedBy  = rb==="TBD" ? "" : rb;
      inv.revision    = giVal(eq("Revision:")) || "A";
      inv.estClass    = giVal(eq("Estimate Class:")) || "Class 5";
      inv.type        = giVal(eq("Investment Type:")) || inv.type;
      inv.complexity  = giVal(eq("Investment Complexity:")) || inv.complexity;
      inv.newTech     = giVal(eq("Use of New Technology:")) || inv.newTech;
      inv.planStart   = giVal(starts("Planning Phase"))   || "1"; inv.planDur   = giVal(starts("Planning Phase"),2)   || "4";
      inv.designStart = giVal(starts("Design Phase"))     || "1"; inv.designDur = giVal(starts("Design Phase"),2)     || "9";
      inv.constrStart = giVal(starts("Construction"))     || "6"; inv.constrDur = giVal(starts("Construction"),2)     || "15";
      const ci = giNum(starts("Investment Contingency (Internally"));
      const cc = giNum(starts("Investment Contingency (Commercially"));
      // General Information D40/D41 hold the contingency. In the MASTER the
      // Summary reads these as a $ amount (C2571='General Information'!D40),
      // deriving the % as $/base. The blank template ships 0.001 as a
      // placeholder. So: a value >=1 is a CART $ figure (store as $ override);
      // a value <1 is a legacy fraction placeholder (read as a %).
      if (ci!==undefined){
        if (ci>=1) inv.contIntDollar = String(Math.round(ci*100)/100);
        else       inv.contInt = String(Math.round(ci*1000)/10);
      }
      if (cc!==undefined){
        if (cc>=1) inv.contCommDollar = String(Math.round(cc*100)/100);
        else       inv.contComm = String(Math.round(cc*1000)/10);
      }
      const ms=[];
      const inv1 = giFind(starts("Invoice 1"));
      if (inv1) for (let i=0;i<10;i++){
        const r=inv1.r+i;
        const lab=gi[EC({r,c:inv1.c})]?.v;
        if (typeof lab!=="string" || !/^Invoice \d+/.test(lab.trim())) continue;
        const stage=String(gi[EC({r,c:inv1.c+1})]?.v??"").trim();
        if (stage && stage!=="N.A.") ms.push({
          stage,
          month:String(gi[EC({r,c:inv1.c+2})]?.v??"").trim(),
          pct:String(gi[EC({r,c:inv1.c+3})]?.v??"0").trim(),
        });
      }
      if (ms.length) inv.milestones = ms;

      // ── Database & Estimate → lines ──
      // Hardened: columns are FOUND from the header rows (1–4), not assumed.
      // WBS = "WBS (Activity Code)"; quantity = the "Quantities" /
      // "Estimate Quantities" header (NOT "Database Quantity" or
      // "Total Quantity"); factor = "Factor Multiplier".
      const deRange = XL.utils.decode_range(de["!ref"]||"A1:A1");
      const maxHdrCol = Math.min(deRange.e.c, 120);
      const deFindCol = (test, avoid) => {
        for (let r=0; r<4; r++) for (let c=0; c<=maxHdrCol; c++) {
          const v = de[EC({r,c})]?.v;
          if (typeof v!=="string") continue;
          const t = v.trim().toLowerCase();
          if (avoid && avoid.some(a=>t.includes(a))) continue;
          if (test(t)) return c;
        }
        return -1;
      };
      let wbsCol = deFindCol(t=>t.startsWith("wbs (activity code)") || t==="wbs");
      if (wbsCol===-1) wbsCol = 3; // col D fallback (v2.x layout)
      let qtyCol = deFindCol(t=>t.includes("estimate quantities"));
      if (qtyCol===-1) qtyCol = deFindCol(t=>t==="quantities", ["database","total"]);
      if (qtyCol===-1) qtyCol = 43; // col AR fallback (v2.x layout)
      let facCol = deFindCol(t=>t.startsWith("factor multiplier"));
      if (facCol===-1) facCol = 20; // col U fallback
      let comCol = deFindCol(t=>t.startsWith("estimator's comments") || t.startsWith("estimators comments"));
      if (comCol===-1) comCol = 61; // col BJ fallback (v2.x layout)

      // Per-row override sources — present in completed estimate workbooks
      // even where the database has no default (e.g. Zone Substation design
      // rows under 2.x.x.xx.1.xx have no 'EE Unit Labour Hours' database
      // default, so any value the estimator typed here is 100% an override).
      let eeHrsCol = deFindCol(t=>t.startsWith("ee unit labour hours"));
      if (eeHrsCol===-1) eeHrsCol = 25; // col Z fallback
      let cRateCol = deFindCol(t=>t.startsWith("contractor unit rate"));
      if (cRateCol===-1) cRateCol = 23; // col X fallback
      let plantCol = deFindCol(t=>t.startsWith("plant/machinery cost") && !t.includes("factor"));
      if (plantCol===-1) plantCol = 30; // col AE fallback
      let matsCol  = deFindCol(t=>t.startsWith("materials cost") && !t.includes("of ee delivered"));
      if (matsCol===-1) matsCol = 32; // col AG fallback

      const itemByCode = new Map((snapSupply||[]).map(s=>[s.wbs_code,s]));
      const known = itemByCode;
      // Install rows whose labour is auto-derived from supply quantities (some
      // supply item's install_wbs targets them). The workbook books install
      // labour on the combined .4. install row AND carries the .1. supply rows;
      // the app re-derives install labour from the supply rows via installAgg,
      // so importing a quantity onto a derived install row double-counts the
      // labour. Skip those — installAgg rebuilds them from supply. Standalone
      // install rows (earthworks, fibre splicing, etc. with no supply feed) are
      // NOT in this set and keep their imported quantity.
      const derivedInstallSet = new Set((snapSupply||[]).map(s=>s.install_wbs).filter(Boolean));
      const lines = {};
      let matched=0, unmatched=0, commentCount=0, overrideCount=0, commDirectCount=0, derivedSkipped=0;

      // ── Import report — plain-text log for comparing against the source ──
      const rpt = { gi:[], qty:[], comments:[], overrides:[], commDirect:[], unmatched:[], derivedSkip:[] };
      rpt.gi.push(["Investment Name",        inv.name]);
      rpt.gi.push(["Investment No.",         inv.number]);
      rpt.gi.push(["WACS No.",               inv.wacs]);
      rpt.gi.push(["Start",                  `${inv.startMonth} ${inv.startYear}`]);
      rpt.gi.push(["Estimated By",           inv.estimatedBy]);
      rpt.gi.push(["Reviewed By",            inv.reviewedBy||"(blank — was TBD)"]);
      rpt.gi.push(["Revision",               inv.revision]);
      rpt.gi.push(["Estimate Class",         inv.estClass]);
      rpt.gi.push(["Investment Type",        inv.type]);
      rpt.gi.push(["Complexity",             inv.complexity]);
      rpt.gi.push(["Use of New Technology",  inv.newTech]);
      rpt.gi.push(["Planning Phase (start/dur)",     `${inv.planStart} / ${inv.planDur}`]);
      rpt.gi.push(["Design Phase (start/dur)",       `${inv.designStart} / ${inv.designDur}`]);
      rpt.gi.push(["Construction Phase (start/dur)", `${inv.constrStart} / ${inv.constrDur}`]);
      rpt.gi.push(["Contingency — Internal",  inv.contIntDollar ? ("$"+Number(inv.contIntDollar).toLocaleString()+" (CART $ from D40)") : (inv.contInt+"%")]);
      rpt.gi.push(["Contingency — Commercial",inv.contCommDollar ? ("$"+Number(inv.contCommDollar).toLocaleString()+" (CART $ from D41)") : (inv.contComm+"%")]);
      rpt.gi.push(["Milestones",              inv.milestones?.length ? `${inv.milestones.length} found` : "none found"]);
      (inv.milestones||[]).forEach(m=>rpt.gi.push(["  · "+m.stage.slice(0,60), `month ${m.month} · ${m.pct}%`]));

      for (let r=5; r<=deRange.e.r; r++){
        const wbsc = de[EC({r, c:wbsCol})]?.v;
        if (wbsc==null) continue;
        const code = String(wbsc).trim();
        if (!/^\d+(\.\w+)+$/.test(code)) continue;          // header/group noise guard
        const qty     = de[EC({r, c:qtyCol})]?.v;
        const q       = typeof qty==="number" ? qty : 0;
        const rawCom  = de[EC({r, c:comCol})]?.v;
        const comment = typeof rawCom==="string" ? rawCom.trim() : "";
        const hasQty  = typeof qty==="number" && qty>1e-6;     // float-residue guard
        if (!hasQty && !comment) continue;
        if (!known.has(code)) {
          // Not a supply-item WBS code — check direct-entry commissioning
          // rows (e.g. SCADA RTU Cubicle, Misc Works), which have no
          // database hours and are entered as a quantity per investment.
          const cd = snapCommLookup?.[code];
          if (cd && cd.direct_entry && hasQty){
            lines[`comm_direct_${code}`] = { qty: String(Math.round(qty*10000)/10000), _commOvrd:true };
            commDirectCount++;
            rpt.commDirect.push([code, cd.description||"", qty]);
          } else if (hasQty) { unmatched++; rpt.unmatched.push([code, qty]); }
          continue;
        }
        const item = itemByCode.get(code);
        const entry = lines[code] || {};
        const isDerivedInstall = derivedInstallSet.has(code);
        if (hasQty && isDerivedInstall){
          // Quantity intentionally NOT imported — install labour for this row
          // is derived from the linked supply quantities (prevents the double
          // count). Comments below are still captured.
          derivedSkipped++;
          rpt.derivedSkip.push([code, item.description||"", qty]);
        }
        if (hasQty && !isDerivedInstall){
          entry.qty = String(Math.round(qty*10000)/10000);
          const factor = de[EC({r, c:facCol})]?.v;
          if (typeof factor==="number" && factor!==1 && factor>0) entry.factor = String(factor);
          matched++;
          rpt.qty.push([code, item.description||"", entry.qty, entry.factor||"1"]);

          // ── Per-row overrides — only set when the workbook value
          // genuinely differs from the database default, so unedited
          // rows don't pick up redundant overrides equal to placeholders.
          const EPS = 1e-6;
          const eeHrs = de[EC({r, c:eeHrsCol})]?.v;
          if (typeof eeHrs==="number" && eeHrs>EPS){
            const dbHrs = item.install_hrs_per!=null ? item.install_hrs_per : (item.ee_unit_hrs||0);
            if (Math.abs(eeHrs-dbHrs)>EPS){
              entry.instHrsOvrd = String(Math.round(eeHrs*10000)/10000); overrideCount++;
              rpt.overrides.push([code, item.description||"", "EE Unit Labour Hours (col Z)", dbHrs, eeHrs]);
            }
          }
          const cRate = de[EC({r, c:cRateCol})]?.v;
          if (typeof cRate==="number" && cRate>EPS){
            const dbRate = item.contractor_rate||0;
            if (Math.abs(cRate-dbRate)>0.005){
              entry.contrRate = String(Math.round(cRate*100)/100); overrideCount++;
              rpt.overrides.push([code, item.description||"", "Contractor Unit Rate (col X)", dbRate, cRate]);
            }
          }
          const plant = de[EC({r, c:plantCol})]?.v;
          if (typeof plant==="number" && plant>EPS){
            entry.plant = String(Math.round(plant*100)/100); overrideCount++;  // no database default — always project-specific
            rpt.overrides.push([code, item.description||"", "Plant/Machinery Cost (col AE)", "(no db default)", plant]);
          }
          const matsUnit = de[EC({r, c:matsCol})]?.v;  // per-unit, same basis as pce_price (escalated)
          if (typeof matsUnit==="number" && matsUnit>EPS){
            const dbPce = item.pce_price||0;
            // Allow ±15% for routine price escalation between the database
            // extract date and the estimate's start date — only flag as an
            // override if the workbook price diverges beyond that band.
            const tolerance = Math.max(dbPce*0.15, 0.50);
            if (dbPce<=0 || Math.abs(matsUnit-dbPce)>tolerance){
              entry.mats = String(Math.round(matsUnit*100)/100); overrideCount++;
              rpt.overrides.push([code, item.description||"", "Materials Cost per unit (col AG)", dbPce, matsUnit]);
            }
          }
        }
        if (comment){
          entry.comments = comment; commentCount++;  // methodology notes — incl. rows without qty
          rpt.comments.push([code, hasQty?(item?.description||""):"(no quantity entered)", comment]);
        }
        lines[code] = entry;
      }

      // Totals for the hub list display
      let totalEE=0, totalComm=0;
      const isComm = inv.type==="Commercially Funded";
      (snapSupply||[]).forEach(item=>{
        const ln=lines[item.wbs_code];
        if(!ln) return;
        const c=calcLine(item, ln.qty, ln.factor||"1", undefined, undefined, undefined, undefined, undefined, isComm, undefined, null, 0);
        totalEE+=c.eeInt; totalComm+=c.comm;
      });

      // ── Render the report as plain text ──
      const L=[];
      const hr=()=>L.push("-".repeat(78));
      const sec=(title)=>{ L.push(""); L.push("="+("=".repeat(76))); L.push(title); L.push("="+("=".repeat(76))); };
      const fmtN=v=>typeof v==="number"?(Math.round(v*10000)/10000).toLocaleString("en-AU"):v;
      L.push("IET ESTIMATE IMPORT REPORT");
      L.push("Source file: "+fileName);
      L.push("Parsed:      "+new Date().toLocaleString("en-AU"));
      L.push("Columns detected — WBS:"+XL.utils.encode_col(wbsCol)+" Qty:"+XL.utils.encode_col(qtyCol)+" Factor:"+XL.utils.encode_col(facCol)
            +" Comments:"+XL.utils.encode_col(comCol)+" EE Hrs:"+XL.utils.encode_col(eeHrsCol)+" Contr Rate:"+XL.utils.encode_col(cRateCol)
            +" Plant:"+XL.utils.encode_col(plantCol)+" Materials:"+XL.utils.encode_col(matsCol));

      sec("GENERAL INFORMATION → INVESTMENT SETUP");
      rpt.gi.forEach(([k,v])=>L.push(k.padEnd(32)+": "+v));

      sec(`QUANTITY LINES — ${rpt.qty.length} of ${(snapSupply||[]).length} supply items`);
      L.push("WBS Code".padEnd(18)+"Qty".padStart(10)+"  Factor".padEnd(8)+"  Description");
      hr();
      rpt.qty.forEach(([code,desc,qty,fac])=>L.push(code.padEnd(18)+fmtN(qty).padStart(10)+"  "+String(fac).padEnd(8)+"  "+desc.slice(0,70)));

      sec(`DERIVED INSTALL ROWS SKIPPED — ${rpt.derivedSkip.length} (labour auto-derived from supply; quantity not imported to avoid double-count)`);
      L.push("WBS Code".padEnd(18)+"Wkbk Qty".padStart(10)+"  Description");
      hr();
      rpt.derivedSkip.forEach(([code,desc,qty])=>L.push(code.padEnd(18)+fmtN(qty).padStart(10)+"  "+String(desc).slice(0,70)));

      sec(`HOURS / COST OVERRIDES — ${rpt.overrides.length} (workbook value differs from database default)`);
      L.push("WBS Code".padEnd(18)+"Field".padEnd(32)+"DB Default".padStart(14)+"  Workbook Value".padStart(16)+"  Description");
      hr();
      rpt.overrides.forEach(([code,desc,field,oldV,newV])=>
        L.push(code.padEnd(18)+field.padEnd(32)+fmtN(oldV).toString().padStart(14)+("  "+fmtN(newV)).padStart(16)+"  "+desc.slice(0,50)));

      sec(`DIRECT-ENTRY COMMISSIONING — ${rpt.commDirect.length}`);
      L.push("WBS Code".padEnd(18)+"Qty".padStart(6)+"  Description");
      hr();
      rpt.commDirect.forEach(([code,desc,qty])=>L.push(code.padEnd(18)+fmtN(qty).toString().padStart(6)+"  "+desc.slice(0,70)));

      sec(`ESTIMATOR COMMENTS — ${rpt.comments.length}`);
      rpt.comments.forEach(([code,desc,comment])=>{
        L.push(code+"  "+desc.slice(0,60));
        comment.split(/\r?\n/).forEach(line=>L.push("    "+line));
        L.push("");
      });

      sec(`UNMATCHED CODES — ${rpt.unmatched.length} (had a quantity but no match in WBS master or commissioning lookup)`);
      L.push("These were SKIPPED. Usually superseded, custom, or relocated codes —");
      L.push("check the source workbook against the current WBS master if expected.");
      hr();
      rpt.unmatched.forEach(([code,qty])=>L.push(code.padEnd(18)+fmtN(qty)));

      sec("TOTALS");
      L.push("Lines with quantity:         "+matched);
      L.push("Estimator comments:          "+commentCount);
      L.push("Hours/cost overrides:        "+overrideCount);
      L.push("Direct-entry commissioning:  "+commDirectCount);
      L.push("Unmatched codes:             "+unmatched);
      L.push("");
      L.push("Computed Base Estimate (EE Internal): "+fmt(totalEE));
      L.push("Computed Base Estimate (Commercial):  "+fmt(totalComm));
      L.push("");
      L.push("Compare these totals and counts against the source workbook's Summary");
      L.push("sheet and Database & Estimate tab to confirm nothing was missed.");

      setImportPreview({
        inv, lines,
        linesCount: matched,
        commentCount,
        overrideCount,
        commDirectCount,
        importReport: L.join("\n"),
        totalSupplyLines: (snapSupply||[]).length,
        totalEE, totalComm,
        status:"Draft",
        _importSource:"excel",
        _importFile:fileName,
        _importUnmatched:unmatched,
      });
    } catch(e) {
      setImportError("Could not read workbook: "+e.message);
    }
    setImportBusy(false);
  };

  const handleImportFile = (file) => {
    if (!file) return;
    setImportFileName(file.name);
    setImportError("");
    setImportPreview(null);
    if (/\.json$/i.test(file.name)) {
      file.text().then(t=>{ setImportText(t); parseImport(t); });
    } else if (/\.(xlsx|xlsm)$/i.test(file.name)) {
      file.arrayBuffer().then(buf=>parseWorkbook(buf, file.name));
    } else {
      setImportError("Unsupported file type — use a .xlsm/.xlsx IET estimate workbook or a .json IET export.");
    }
  };

  // Download a saved record as IET JSON (round-trips through Import)
  const exportJSON = (rec) => {
    const clean = { ...rec };
    delete clean._editingBy;
    const blob = new Blob([JSON.stringify(clean,null,2)],{type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `IET_${(rec.inv?.number||"estimate")}_Rev${rec.inv?.revision||"A"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

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
      className={`flex items-center gap-0.5 ${sortBy===col?"text-[var(--primary-600)] font-bold":"text-gray-500 hover:text-gray-700"}`}>
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
            className={`text-xs px-4 py-2.5 font-semibold border-b-2 transition-colors ${hubTab===t.id?"border-[var(--primary-700)] text-[var(--primary-700)]":"border-transparent text-gray-500 hover:text-gray-700"}`}>
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
      {hubTab==="templates" && <TemplateLibrary onLoad={onLoad} saved={saved} setSaved={setSaved} currentInv={currentInv} currentLines={currentLines}/>}

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
            className="border border-gray-300 rounded px-2 py-1.5 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
          {search && <button onClick={()=>setSearch("")} className="text-xs text-gray-400 hover:text-gray-600">✕</button>}
        </div>

        {/* Filter bar */}
        <div className="bg-white border-b px-4 py-2 flex items-center gap-4 flex-shrink-0">
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 font-semibold">Status</span>
            <div className="flex border border-gray-200 rounded overflow-hidden">
              {statuses.map(s=>(
                <button key={s} onClick={()=>setStatusFilter(s)}
                  className={`text-xs px-2.5 py-1 transition-colors ${statusFilter===s?"bg-[var(--primary-700)] text-white":"text-gray-600 hover:bg-gray-50"}`}>{s}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 font-semibold">Class</span>
            <div className="flex border border-gray-200 rounded overflow-hidden">
              {classes.map(c=>(
                <button key={c} onClick={()=>setClassFilter(c)}
                  className={`text-xs px-2 py-1 transition-colors ${classFilter===c?"bg-[var(--primary-700)] text-white":"text-gray-600 hover:bg-gray-50"}`}>{c==="All"?"All":c.replace("Class ","C")}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 font-semibold">Type</span>
            <div className="flex border border-gray-200 rounded overflow-hidden">
              {types.map(t=>(
                <button key={t} onClick={()=>setTypeFilter(t)}
                  className={`text-xs px-2.5 py-1 transition-colors ${typeFilter===t?"bg-[var(--primary-700)] text-white":"text-gray-600 hover:bg-gray-50"}`}>{t==="All"?"All":t==="Commercially Funded"?"Commercial":"Internal"}</button>
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
                      className={`border-b cursor-pointer transition-colors ${isSel?"bg-[var(--primary-50)] border-l-4 border-l-[var(--primary-500)]":"hover:bg-gray-50"}`}>
                      <td className="px-3 py-2">
                        <div className={`font-semibold truncate max-w-[200px] ${isSel?"text-[var(--primary-800)]":"text-gray-900"}`}>{s.inv.name||"Unnamed"}</div>
                        <div className="text-gray-400 font-mono">{s.inv.number} · {s.inv.type==="Commercially Funded"?"Commercial":"Internal"}</div>
                        {s._editingBy && (
                          <div className="text-[10px] text-red-600 font-semibold mt-0.5" title={`Locked since ${s._editingBy.since?new Date(s._editingBy.since).toLocaleString("en-AU",{dateStyle:"short",timeStyle:"short"}):""}`}>
                            🔒 Editing: {s._editingBy.name}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {s.status==="Approved" ? (
                          /* Approved — immutable badge, no dropdown */
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.text}`}
                            title="Approved — use Unlock to Amend to create a new revision">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sc.dot}`}/>
                            {s.status} 🔒
                          </span>
                        ) : editStatus===s.id ? (
                          <select autoFocus value={s.status||"Draft"}
                            onChange={e=>updateStatus(s.id,e.target.value,s.status||"Draft")}
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
                      <td className="px-3 py-2 text-right font-bold text-[var(--primary-800)]">{fmt(s.totalEE)}</td>
                      <td className="px-3 py-2 text-right font-bold text-orange-700">{fmt(s.totalComm)}</td>
                      <td className="px-3 py-2 text-right text-gray-400 whitespace-nowrap">{s.savedAt}</td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex gap-1 justify-center" onClick={e=>e.stopPropagation()}>
                          <button onClick={()=>onLoad(s)}
                            className="text-xs bg-[var(--primary-700)] hover:bg-[var(--primary-600)] text-white px-2 py-1 rounded font-semibold">Open</button>
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
                    <td className="px-3 py-2 text-right font-bold text-[var(--primary-900)]">{fmt(portTotals.ee)}</td>
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
          <div className="bg-[var(--primary-900)] text-white px-4 py-3 flex items-start justify-between flex-shrink-0">
            <div>
              <div className="font-bold text-sm leading-tight">{selected.inv.name}</div>
              <div className="text-[var(--primary-300)] text-xs mt-0.5">{selected.inv.number}</div>
            </div>
            <button onClick={()=>setSelected(null)} className="text-[var(--primary-400)] hover:text-white text-sm ml-2">✕</button>
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
            {(selected.cloned_from_id || selected._amendmentOf || saved.some(s=>s.cloned_from_id===selected.id||s._amendmentOf===selected.id)) && (
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
                {selected._amendmentOf && (()=>{
                  const origin = saved.find(s=>s.id===selected._amendmentOf);
                  const fromRev = selected._amendmentOfRevision || origin?.inv?.revision || "A";
                  const toRev   = selected._amendmentToRevision || selected.inv?.revision || "B";
                  return <div className="flex items-center gap-2 text-xs mb-1.5 flex-wrap">
                    <span className="text-amber-600 font-semibold">✏️ Amendment of</span>
                    <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded text-xs font-medium">Approved</span>
                    <span className="text-gray-600 font-semibold truncate max-w-[80px]">{selected._amendmentOfName||origin?.inv?.name||"original"}</span>
                    <span className="font-mono text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">Rev {fromRev} → Rev {toRev}</span>
                    {origin && <button onClick={()=>setSelected(origin)} className="ml-auto text-[var(--primary-600)] hover:underline text-[10px]">View approved</button>}
                  </div>;
                })()}
                {saved.filter(s=>s.cloned_from_id===selected.id).map(child=>(
                  <div key={child.id} className="flex items-center gap-2 text-xs mt-1">
                    <span className="text-gray-400">↳ Promoted to</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${CLASS_COLOR[child.inv.estClass]||"bg-gray-100 text-gray-500"}`}>{child.inv.estClass}</span>
                    <span className="text-gray-600 font-semibold truncate max-w-[100px]">{child.inv.name}</span>
                    <button onClick={()=>setSelected(child)} className="ml-auto text-[var(--primary-600)] hover:underline text-[10px]">View</button>
                  </div>
                ))}
                {saved.filter(s=>s._amendmentOf===selected.id).map(amend=>(
                  <div key={amend.id} className="flex items-center gap-2 text-xs mt-1 flex-wrap">
                    <span className="text-amber-600">↳ Amendment</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_CFG[amend.status||"Draft"]?.bg} ${STATUS_CFG[amend.status||"Draft"]?.text}`}>{amend.status||"Draft"}</span>
                    <span className="font-mono text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">Rev {amend._amendmentOfRevision||selected.inv?.revision||"A"} → Rev {amend.inv?.revision||"B"}</span>
                    <span className="text-gray-600 font-semibold truncate max-w-[80px]">{amend.inv.name}</span>
                    <button onClick={()=>setSelected(amend)} className="ml-auto text-[var(--primary-600)] hover:underline text-[10px]">View</button>
                  </div>
                ))}
              </div>
            )}

            {/* Financials */}
            <div className="px-3 py-3 border-b space-y-2">
              <div className="text-xs font-bold text-gray-600 uppercase tracking-wide">Financials</div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-500">EE Internal</span>
                <span className="text-xs font-bold text-[var(--primary-800)]">{fmt(selected.totalEE)}</span>
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
                      <div className="h-1.5 rounded bg-[var(--primary-500)]"
                        style={{width:`${selected.totalEE>0?Math.round(p.eeInt/selected.totalEE*100):0}%`}}/>
                    </div>
                    <span className="text-xs font-medium text-[var(--primary-800)] w-20 text-right">{fmt(p.eeInt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="border-t p-3 space-y-2 flex-shrink-0">
            <button onClick={()=>onLoad(selected)}
              className="w-full bg-[var(--primary-700)] hover:bg-[var(--primary-600)] text-white text-xs py-2 rounded font-semibold">
              📐 Open in Estimation Tool
            </button>
            <button onClick={()=>{setCloneSource(selected);const idx=CLASS_ORDER.indexOf(selected.inv.estClass);setCloneClass(idx>0?CLASS_ORDER[idx-1]:"Class 4");setShowCloneModal(true);}}
              className="w-full bg-purple-700 hover:bg-purple-600 text-white text-xs py-2 rounded font-semibold">
              🔁 Clone / Promote Estimate Class
            </button>
            <div className="flex gap-2">
              <button onClick={()=>exportPDF(selected)}
                className="flex-1 border border-gray-200 text-gray-600 text-xs py-1.5 rounded hover:bg-gray-50 hover:border-[var(--primary-400)]">📄 Export PDF</button>
              <button onClick={()=>exportJSON(selected)}
                className="flex-1 border border-gray-200 text-gray-600 text-xs py-1.5 rounded hover:bg-gray-50 hover:border-[var(--primary-400)]">⬇ Export JSON</button>
              <button className="flex-1 border border-gray-200 text-gray-600 text-xs py-1.5 rounded hover:bg-gray-50">☁️ Copperleaf</button>
              <button onClick={(e)=>startDelete(selected,e)}
                className="border border-red-200 text-red-500 text-xs px-2 py-1.5 rounded hover:bg-red-50 flex items-center gap-1" title="Delete investment">🗑 Delete</button>
            </div>
          </div>
        </div>
      )}
      </div>}{/* end portfolio tab */}

      {/* ── APPROVE INVESTMENT MODAL — PIN gated ── */}
      {approveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background:"rgba(0,0,0,0.55)"}}>
          <div className="bg-white rounded-xl shadow-2xl w-[420px] overflow-hidden">
            <div className="bg-green-800 text-white px-5 py-4">
              <div className="text-sm font-bold">✅ Approve Estimate</div>
              <div className="text-xs text-green-200 mt-1">Team Leader PIN required — once approved this record is locked</div>
            </div>
            <div className="p-5 space-y-4">
              {(()=>{
                const rec = saved.find(s=>s.id===approveModal.id);
                return rec ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                    <div className="text-sm font-bold text-green-900">{rec.inv?.name||"Unnamed"}</div>
                    <div className="text-xs text-green-700 font-mono mt-0.5">{rec.inv?.number} · {rec.inv?.estClass} · Rev {rec.inv?.revision||"A"}</div>
                  </div>
                ) : null;
              })()}
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                <div className="font-semibold mb-1">Once approved:</div>
                <div>• The estimate is <span className="font-semibold">permanently locked</span> — no field can be edited</div>
                <div>• The status badge shows 🔒 and cannot be changed via dropdown</div>
                <div>• Any future changes require <span className="font-semibold">Unlock to Amend</span>, which creates a new revision</div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Team Leader PIN *</label>
                <input
                  type="password"
                  value={approvePinVal}
                  autoFocus
                  onChange={e=>{setApprovePinVal(e.target.value);setApprovePinErr(false);}}
                  onKeyDown={e=>{
                    if(e.key==="Enter") confirmApproval(approveModal.id);
                    if(e.key==="Escape"){setApproveModal(null);setApprovePinVal("");}
                  }}
                  placeholder="Enter PIN"
                  className={`w-full border rounded px-3 py-2 text-sm text-center tracking-widest font-mono focus:outline-none focus:ring-2 transition-colors ${
                    approvePinErr
                      ? "border-red-400 ring-red-300 bg-red-50"
                      : "border-gray-300 focus:ring-green-400"
                  }`}/>
                {approvePinErr && (
                  <div className="text-xs text-red-600 text-center mt-1">Incorrect PIN — try again</div>
                )}
              </div>
            </div>
            <div className="border-t px-5 py-3 flex gap-2">
              <button onClick={()=>{setApproveModal(null);setApprovePinVal("");setApprovePinErr(false);}}
                className="flex-1 text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 py-2 rounded font-semibold">
                Cancel
              </button>
              <button onClick={()=>confirmApproval(approveModal.id)} disabled={!approvePinVal}
                className="flex-1 text-xs bg-green-700 hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-400 text-white py-2 rounded font-bold">
                ✅ Confirm Approval
              </button>
            </div>
          </div>
        </div>
      )}

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
                  {["Draft","In Review","On Hold"].map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="text-xs text-gray-400 bg-[var(--primary-50)] border border-[var(--primary-100)] rounded p-2 mb-4">
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
                  <label className="text-xs text-gray-500 block mb-1">Estimate file (.xlsm / .xlsx IET workbook, or .json IET export)</label>
                  <label
                    onDragOver={e=>e.preventDefault()}
                    onDrop={e=>{e.preventDefault(); handleImportFile(e.dataTransfer.files?.[0]);}}
                    className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 hover:border-[var(--primary-400)] rounded-lg py-5 cursor-pointer text-center transition-colors">
                    <span className="text-2xl mb-1">{importBusy?"⏳":"📂"}</span>
                    <span className="text-xs font-semibold text-gray-600">{importBusy?"Reading workbook…":(importFileName||"Drop estimate file here or click to browse")}</span>
                    <span className="text-xs text-gray-400 mt-0.5">Reads 'General Information' + 'Database &amp; Estimate' quantities</span>
                    <input type="file" accept=".xlsm,.xlsx,.json" className="hidden"
                      onChange={e=>handleImportFile(e.target.files?.[0])}/>
                  </label>
                </div>
                <div className="text-xs text-gray-400 text-center mb-3">— or —</div>
                <div className="mb-3">
                  <label className="text-xs text-gray-500 block mb-1">Paste saved estimate JSON</label>
                  <textarea
                    value={importText}
                    onChange={e=>{ setImportText(e.target.value); if(e.target.value.trim()) parseImport(e.target.value); else { setImportError(""); setImportPreview(null); }}}
                    placeholder='{ "inv": { "name": "My Investment", "number": "10012345", ... }, "lines": { ... } }' 
                    rows={10}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)] resize-none"/>
                </div>
                {importError && (
                  <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">⚠ {importError}</div>
                )}
                <div className="text-xs text-gray-400 bg-amber-50 border border-amber-100 rounded p-2 mb-4">
                  💡 Excel import maps the workbook's General Information to Investment Setup and brings in every entered quantity (column AR of Database &amp; Estimate). JSON import round-trips with the ⬇ Export JSON button on any saved estimate. In the Power Platform build this connects directly to Dataverse.
                </div>
                <div className="flex gap-3">
                  <button onClick={()=>{setShowImport(false);setImportText("");setImportError("");}}
                    className="flex-1 border border-gray-200 text-gray-600 text-sm py-2 rounded-lg hover:bg-gray-50">Cancel</button>
                  <button onClick={()=>parseImport(importText)} disabled={!importText.trim()}
                    className="flex-1 bg-[var(--primary-700)] hover:bg-[var(--primary-600)] disabled:bg-gray-300 text-white text-sm py-2 rounded-lg font-bold">
                    Validate JSON →
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                  <div className="text-xs font-bold text-green-700 mb-2 flex items-center justify-between">
                    <span>✓ Valid estimate found{importPreview._importSource==="excel" && <span className="font-normal text-green-600"> — parsed from {importPreview._importFile}</span>}</span>
                    {importPreview.importReport && (
                      <button onClick={()=>{
                        const blob=new Blob([importPreview.importReport],{type:"text/plain"});
                        const a=document.createElement("a");
                        a.href=URL.createObjectURL(blob);
                        a.download=`IET_Import_Report_${(importPreview.inv?.number||"estimate")}.txt`;
                        a.click();
                        URL.revokeObjectURL(a.href);
                      }} className="text-xs border border-green-300 bg-white hover:bg-green-50 text-green-700 px-2 py-1 rounded font-semibold">
                        ⬇ Download Import Report (.txt)
                      </button>
                    )}
                  </div>
                  {[
                    ["Investment Name",  importPreview.inv?.name||"—"],
                    ["Number",           importPreview.inv?.number||"—"],
                    ["Estimate Class",   importPreview.inv?.estClass||"—"],
                    ["Type",             importPreview.inv?.type||"—"],
                    ["Estimator",        importPreview.inv?.estimatedBy||"—"],
                    ["Lines",            importPreview.linesCount!=null ? `${importPreview.linesCount} entered` : "—"],
                    ["Estimator Comments",importPreview.commentCount!=null ? `${importPreview.commentCount} imported` : "—"],
                    ["Hrs/Cost Overrides", importPreview.overrideCount!=null ? `${importPreview.overrideCount} imported` : "—"],
                    ["Direct-Entry Commissioning", importPreview.commDirectCount!=null ? `${importPreview.commDirectCount} imported` : "—"],
                    ["EE Internal",      importPreview.totalEE!=null ? fmt(importPreview.totalEE) : "—"],
                    ["Commercial",       importPreview.totalComm!=null ? fmt(importPreview.totalComm) : "—"],
                  ].map(([label,val])=>(
                    <div key={label} className="flex justify-between text-xs py-0.5">
                      <span className="text-gray-500">{label}</span>
                      <span className="font-semibold text-gray-800">{val}</span>
                    </div>
                  ))}
                </div>
                {importPreview._importUnmatched>0 && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
                    ⚠ {importPreview._importUnmatched} WBS code(s) in the workbook were not recognised against the current WBS master and were skipped. Usually superseded or custom codes — review the source workbook if the line count looks low.
                  </div>
                )}
                <div className="text-xs text-gray-400 mb-4">The estimate will be added to your Investment Hub as a new Draft. All existing estimates are unchanged.</div>
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
          <button onClick={()=>setShowNewProg(true)} className="text-xs bg-[var(--primary-700)] hover:bg-[var(--primary-600)] text-white px-2 py-1 rounded font-semibold">+ New</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {programmes.length===0&&(
            <div className="text-xs text-gray-400 text-center px-4 py-8">No programmes yet.<br/>Create one to group investments.</div>
          )}
          {programmes.map(p=>{
            const s=getProgSummary(p); const isSel=selectedProg===p.id;
            return (
              <div key={p.id} onClick={()=>{setSelectedProg(isSel?null:p.id);setExpandedChild(null);}}
                className={`px-3 py-2.5 border-b cursor-pointer transition-colors ${isSel?"bg-[var(--primary-50)] border-l-4 border-l-[var(--primary-700)]":"hover:bg-gray-50"}`}>
                <div className={`font-semibold text-xs truncate ${isSel?"text-[var(--primary-800)]":"text-gray-800"}`}>{p.name}</div>
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
                      className="text-xs bg-[var(--primary-700)] hover:bg-[var(--primary-600)] disabled:opacity-40 text-white px-3 py-1.5 rounded font-semibold flex items-center gap-1.5 shadow">
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
                    className="text-xs bg-[var(--primary-700)] hover:bg-[var(--primary-600)] text-white px-3 py-1 rounded font-semibold">+ Add investment</button>
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
                        <div key={c.invId} className={`border-b last:border-0 ${isExp?"border-l-4 border-l-[var(--primary-500)]":""}`}>
                          {/* Row header — click to expand */}
                          <div
                            className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${isExp?"bg-[var(--primary-50)]":"hover:bg-gray-50"}`}
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
                            <div className="bg-white border-t border-[var(--primary-100)] px-4 py-4 space-y-4">

                              {/* Role + method selectors */}
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <div className="text-xs font-semibold text-gray-600 mb-1.5">Funding role</div>
                                  <div className="flex border border-gray-200 rounded overflow-hidden">
                                    {["EE-funded","Customer-funded","Shared"].map(r=>(
                                      <button key={r} onClick={()=>updateChild(c.invId,{role:r})}
                                        className={`flex-1 text-xs py-1.5 font-semibold transition-colors ${c.role===r?"bg-[var(--primary-700)] text-white":"text-gray-600 hover:bg-gray-50"}`}>{r}</button>
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-semibold text-gray-600 mb-1.5">Attribution method</div>
                                  <div className="flex border border-gray-200 rounded overflow-hidden">
                                    {["percentage","capped","section","item"].map(m=>(
                                      <button key={m} onClick={()=>updateChild(c.invId,{splitMethod:m})}
                                        className={`flex-1 text-xs py-1.5 font-semibold transition-colors ${(c.splitMethod||"percentage")===m?"bg-[var(--primary-700)] text-white":"text-gray-600 hover:bg-gray-50"}`}>
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
                                      className="border border-gray-300 rounded px-2 py-1 text-xs w-40 focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
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
                                                className="text-xs bg-[var(--primary-50)] hover:bg-[var(--primary-100)] text-[var(--primary-700)] border border-[var(--primary-200)] px-2 py-0.5 rounded">All EE</button>
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
                                                <div key={t.key} className={`flex items-center gap-2 px-5 py-1.5 border-t border-gray-100 ${tag==="EE"?"bg-[var(--primary-50)]":tag==="Customer"?"bg-orange-50":""}`}>
                                                  <span className="text-xs font-mono text-[var(--primary-700)] min-w-36">{t.key}</span>
                                                  <span className="text-xs text-gray-600 flex-1 truncate">{t.label}</span>
                                                  <div className="flex border border-gray-200 rounded overflow-hidden">
                                                    {["EE","Customer",""].map((v,vi)=>(
                                                      <button key={vi}
                                                        onClick={()=>updateChildTagging(c.invId,t.key,v||undefined)}
                                                        className={`text-xs px-2.5 py-1 transition-colors ${tag===(v||undefined)
                                                          ?v==="EE"?"bg-[var(--primary-700)] text-white":v==="Customer"?"bg-orange-600 text-white":"bg-gray-300 text-gray-700"
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
                  className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold block mb-1">Programme number (optional)</label>
                <input value={newProgNum} onChange={e=>setNewProgNum(e.target.value)} placeholder="e.g. PROG-2026-001"
                  className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={()=>setShowNewProg(false)} className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={createProg} disabled={!newProgName.trim()}
                className="flex-1 bg-[var(--primary-700)] hover:bg-[var(--primary-600)] disabled:opacity-40 text-white rounded px-3 py-1.5 text-xs font-semibold">Create Programme</button>
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
                  className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)] bg-white">
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
                      className={`flex-1 text-xs py-2 rounded border font-semibold transition-colors ${addInvRole===r?"border-[var(--primary-700)] bg-[var(--primary-700)] text-white":"border-gray-300 text-gray-600 hover:bg-gray-50"}`}>{r}</button>
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
                className="flex-1 bg-[var(--primary-700)] hover:bg-[var(--primary-600)] disabled:opacity-40 text-white rounded px-3 py-1.5 text-xs font-semibold">Add to Programme</button>
            </div>
          </div>
        </div>
      )}
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
const WBS_FC=f=>f>=1?"text-green-600":f>=0.90?"text-[var(--primary-600)]":f>=0.85?"text-yellow-600":f>=0.80?"text-orange-600":"text-red-600";
const WBS_ROLE_STYLES={"Lead Estimator":"bg-[var(--primary-100)] text-[var(--primary-700)]","Senior Estimator":"bg-purple-100 text-purple-700","Estimator":"bg-gray-100 text-gray-600","Project Manager":"bg-green-100 text-green-700"};
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



// ── RATES EDITOR ────────────────────────────────────────────────
function RatesEditor({ rates, managerMode, onUnlock }) {
  // Source is resource_codes.json (keyed by name) — richer than old resource_rates.json
  const { resourceCodes: ctxRC } = useData();
  const [localRC,     setLocalRC]     = useState(null);
  const [editingKey,  setEditingKey]  = useState(null);
  const [editVals,    setEditVals]    = useState({});
  const [searchQ,     setSearchQ]     = useState("");
  const [filterUnit,  setFilterUnit]  = useState("All");

  // Merge ctx + any local overrides, convert to sorted array
  const baseRC = localRC || ctxRC || {};
  const rcArray = useMemo(()=>{
    const arr = Object.values(baseRC);
    return arr.sort((a,b)=>(a.resource_name||"").localeCompare(b.resource_name||""));
  }, [baseRC]);

  const filtered = useMemo(()=>{
    const q = searchQ.toLowerCase();
    return rcArray.filter(r => {
      const matchQ = !q || (r.resource_name||"").toLowerCase().includes(q)
        || (r.resource_code||"").toLowerCase().includes(q)
        || (r.wacs_craft||"").toLowerCase().includes(q)
        || (r.aer_code||"").toLowerCase().includes(q);
      const matchU = filterUnit === "All" || (r.currency_type||"Hour") === filterUnit;
      return matchQ && matchU;
    });
  }, [rcArray, searchQ, filterUnit]);

  const EDITABLE_FIELDS = [
    {key:"ee_internal_rate",    label:"EE Internal",    type:"number", cls:"text-right w-20 border-green-300 bg-green-50"},
    {key:"ee_internal_rate_ot", label:"EE Internal +20% OT", type:"number", cls:"text-right w-20 border-green-400 bg-green-100"},
    {key:"ee_commercial_rate",  label:"EE Commercial",  type:"number", cls:"text-right w-20 border-orange-300 bg-orange-50"},
    {key:"contractor_rate",     label:"Contr. Rate",    type:"number", cls:"text-right w-20 border-teal-300 bg-teal-50"},
    {key:"ans_margin_pct",      label:"ANS %",          type:"number", cls:"text-right w-14 border-purple-300"},
    {key:"aer_code",            label:"AER Code",       type:"text",   cls:"w-16 border-[var(--primary-300)] font-mono"},
    {key:"erp_code",            label:"ERP Code",       type:"text",   cls:"w-16 border-[var(--primary-200)]"},
    {key:"wacs_craft",          label:"WACS Craft",     type:"text",   cls:"w-24 border-indigo-300 font-mono"},
    {key:"resource_code",       label:"CL Code",        type:"text",   cls:"w-24 border-teal-300 font-mono"},
    {key:"currency_type",       label:"Unit",           type:"text",   cls:"w-14 border-gray-300"},
    {key:"labour_type",         label:"Labour Type",    type:"text",   cls:"w-20 border-gray-300"},
    {key:"account_code_internal",label:"Acct Internal", type:"text",   cls:"w-20 border-gray-300 font-mono"},
    {key:"account_code_external",label:"Acct External", type:"text",   cls:"w-20 border-gray-300 font-mono"},
  ];

  const startEdit = (r) => {
    setEditingKey(r.resource_name);
    const vals = {};
    EDITABLE_FIELDS.forEach(f => { vals[f.key] = r[f.key] ?? ""; });
    setEditVals(vals);
  };

  const saveEdit = (name) => {
    const updated = { ...baseRC };
    if (!updated[name]) return;
    const r = { ...updated[name] };
    EDITABLE_FIELDS.forEach(f => {
      if (f.type === "number") {
        const v = parseFloat(editVals[f.key]);
        if (!isNaN(v)) r[f.key] = v;
      } else {
        r[f.key] = editVals[f.key] ?? "";
      }
    });
    updated[name] = r;
    setLocalRC(updated);
    setEditingKey(null);
  };

  const dollarOrDash = v => v != null ? "$" + Number(v).toFixed(2) : "—";
  const pctOrDash = v => v != null ? (Number(v)*100).toFixed(2)+"%" : "—";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="bg-white border-b px-3 py-2 flex items-center gap-2 flex-shrink-0 flex-wrap">
        <input value={searchQ} onChange={e=>setSearchQ(e.target.value)}
          placeholder="Search name, CL code, WACS, AER…"
          className="border border-gray-300 rounded px-2 py-1 text-xs w-52 focus:outline-none focus:ring-1 focus:ring-[var(--primary-300)]"/>
        {searchQ && <button onClick={()=>setSearchQ("")} className="text-gray-400 text-xs hover:text-gray-600">✕</button>}
        <select value={filterUnit} onChange={e=>setFilterUnit(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none">
          <option>All</option>
          <option>Hour</option>
          <option>Dollar</option>
          <option>Day</option>
        </select>
        <span className="text-xs text-gray-400">{filtered.length} of {rcArray.length}</span>
        <div className="flex-1"/>
        {managerMode ? (
          <span className="text-xs bg-orange-100 text-orange-700 border border-orange-300 px-3 py-1.5 rounded font-semibold">🔓 Manager Mode — click row to edit</span>
        ) : (
          <button onClick={onUnlock} className="text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded flex items-center gap-1.5">🔒 Manager Mode</button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="text-xs w-full min-w-max">
          <thead className="bg-gray-50 border-b sticky top-0 z-10">
            <tr>
              <th className="text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap" style={{minWidth:"200px",width:"200px"}}>Resource Name</th>
              <th className="text-center px-2 py-2 font-semibold text-gray-500 whitespace-nowrap">Unit</th>
              <th className="text-right px-2 py-2 font-semibold text-green-700 whitespace-nowrap">EE Internal</th>
              <th className="text-right px-2 py-2 font-semibold text-green-800 whitespace-nowrap" title="Combined 80% Ordinary + 20% Overtime — used for WBS internal rate calculations">EE Internal +20% OT</th>
              <th className="text-right px-2 py-2 font-semibold text-orange-700 whitespace-nowrap">EE Commercial</th>
              <th className="text-right px-2 py-2 font-semibold text-teal-700 whitespace-nowrap">Contr. Rate</th>
              <th className="text-right px-2 py-2 font-semibold text-purple-700 whitespace-nowrap">ANS %</th>
              <th className="text-center px-2 py-2 font-semibold text-[var(--primary-700)] whitespace-nowrap">AER Code</th>
              <th className="text-center px-2 py-2 font-semibold text-gray-500 whitespace-nowrap">ERP Code</th>
              <th className="text-center px-2 py-2 font-semibold text-indigo-700 whitespace-nowrap">WACS Craft</th>
              <th className="text-center px-2 py-2 font-semibold text-teal-800 whitespace-nowrap">CL Code</th>
              <th className="text-center px-2 py-2 font-semibold text-gray-500 whitespace-nowrap">Labour Type</th>
              <th className="text-center px-2 py-2 font-semibold text-gray-500 whitespace-nowrap">Acct Internal</th>
              <th className="text-center px-2 py-2 font-semibold text-gray-500 whitespace-nowrap">Acct External</th>
              <th className="text-center px-2 py-2 font-semibold text-gray-400 whitespace-nowrap"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const isEd = editingKey === r.resource_name;
              const isDollar = (r.currency_type||"Hour") === "Dollar";
              const isDay    = (r.currency_type||"Hour") === "Day";
              const rowBg = isEd ? "bg-[var(--primary-50)]" : isDollar ? "bg-amber-50/40" : isDay ? "bg-orange-50/40" : "hover:bg-gray-50";
              const ef = v => isEd
                ? <input type="number" step="0.01" value={editVals[v]||""} onChange={e=>setEditVals(p=>({...p,[v]:e.target.value}))}
                    className="w-20 border border-green-300 bg-green-50 rounded px-1 py-0.5 text-xs text-right focus:outline-none"/>
                : null;
              const et = v => isEd
                ? <input type="text" value={editVals[v]||""} onChange={e=>setEditVals(p=>({...p,[v]:e.target.value}))}
                    className="w-24 border border-gray-300 rounded px-1 py-0.5 text-xs font-mono focus:outline-none"/>
                : null;
              return (
                <tr key={r.resource_name} className={`border-b transition-colors ${rowBg}`}>
                  <td className="px-3 py-1.5 font-medium text-gray-800" style={{minWidth:"200px"}}>
                    <span className="whitespace-nowrap">{r.resource_name}</span>
                  </td>
                  {/* Unit */}
                  <td className="px-2 py-1.5 text-center">
                    {isEd
                      ? <select value={editVals.currency_type||"Hour"} onChange={e=>setEditVals(p=>({...p,currency_type:e.target.value}))}
                          className="border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none">
                          <option>Hour</option><option>Dollar</option><option>Day</option>
                        </select>
                      : <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${isDollar?"bg-amber-100 text-amber-800":isDay?"bg-orange-100 text-orange-800":"bg-[var(--primary-100)] text-[var(--primary-800)]"}`}>{r.currency_type||"Hour"}</span>
                    }
                  </td>
                  {/* EE Internal */}
                  <td className="px-2 py-1.5 text-right">
                    {isEd
                      ? <input type="number" step="0.01" value={editVals.ee_internal_rate||""} onChange={e=>setEditVals(p=>({...p,ee_internal_rate:e.target.value}))}
                          className="w-20 border border-green-300 bg-green-50 rounded px-1 py-0.5 text-xs text-right focus:outline-none"/>
                      : <span className="font-medium text-green-800">{dollarOrDash(r.ee_internal_rate)}</span>
                    }
                  </td>
                  {/* EE Internal +20% OT — actual rate used for WBS internal calculations */}
                  <td className="px-2 py-1.5 text-right">
                    {isEd
                      ? <input type="number" step="0.01" value={editVals.ee_internal_rate_ot||""} onChange={e=>setEditVals(p=>({...p,ee_internal_rate_ot:e.target.value}))}
                          className="w-20 border border-green-400 bg-green-100 rounded px-1 py-0.5 text-xs text-right focus:outline-none"/>
                      : <span className="font-semibold text-green-900">{dollarOrDash(r.ee_internal_rate_ot ?? r.ee_internal_rate)}</span>
                    }
                  </td>
                  {/* EE Commercial */}
                  <td className="px-2 py-1.5 text-right">
                    {isEd
                      ? <input type="number" step="0.01" value={editVals.ee_commercial_rate||""} onChange={e=>setEditVals(p=>({...p,ee_commercial_rate:e.target.value}))}
                          className="w-20 border border-orange-300 bg-orange-50 rounded px-1 py-0.5 text-xs text-right focus:outline-none"/>
                      : <span className="font-medium text-orange-700">{dollarOrDash(r.ee_commercial_rate)}</span>
                    }
                  </td>
                  {/* Contractor Rate */}
                  <td className="px-2 py-1.5 text-right">
                    {isEd
                      ? <input type="number" step="0.01" value={editVals.contractor_rate||""} onChange={e=>setEditVals(p=>({...p,contractor_rate:e.target.value}))}
                          className="w-20 border border-teal-300 bg-teal-50 rounded px-1 py-0.5 text-xs text-right focus:outline-none"/>
                      : <span className="text-teal-700">{r.contractor_rate!=null?"$"+Number(r.contractor_rate).toFixed(2):"—"}</span>
                    }
                  </td>
                  {/* ANS % */}
                  <td className="px-2 py-1.5 text-right">
                    {isEd
                      ? <input type="number" step="0.01" value={editVals.ans_margin_pct!=null?(editVals.ans_margin_pct*100).toFixed(2):""} onChange={e=>setEditVals(p=>({...p,ans_margin_pct:parseFloat(e.target.value)/100||0}))}
                          className="w-16 border border-purple-300 rounded px-1 py-0.5 text-xs text-right focus:outline-none"/>
                      : <span className="text-purple-700">{r.ans_margin_pct!=null?(Number(r.ans_margin_pct)*100).toFixed(2)+"%":"—"}</span>
                    }
                  </td>
                  {/* AER Code */}
                  <td className="px-2 py-1.5 text-center">
                    {isEd
                      ? <input type="text" value={editVals.aer_code||""} onChange={e=>setEditVals(p=>({...p,aer_code:e.target.value}))}
                          className="w-16 border border-[var(--primary-300)] rounded px-1 py-0.5 text-xs font-mono focus:outline-none"/>
                      : <span className="font-mono text-[var(--primary-700)]">{r.aer_code||"—"}</span>
                    }
                  </td>
                  {/* ERP Code */}
                  <td className="px-2 py-1.5 text-center">
                    {isEd
                      ? <input type="text" value={editVals.erp_code||""} onChange={e=>setEditVals(p=>({...p,erp_code:e.target.value}))}
                          className="w-16 border border-gray-300 rounded px-1 py-0.5 text-xs font-mono focus:outline-none"/>
                      : <span className="font-mono text-gray-500">{r.erp_code||"—"}</span>
                    }
                  </td>
                  {/* WACS Craft */}
                  <td className="px-2 py-1.5 text-center">
                    {isEd
                      ? <input type="text" value={editVals.wacs_craft||""} onChange={e=>setEditVals(p=>({...p,wacs_craft:e.target.value}))}
                          className="w-28 border border-indigo-300 rounded px-1 py-0.5 text-xs font-mono focus:outline-none"/>
                      : <span className="font-mono text-indigo-700 text-[10px]">{r.wacs_craft||"—"}</span>
                    }
                  </td>
                  {/* CL Resource Code */}
                  <td className="px-2 py-1.5 text-center">
                    {isEd
                      ? <input type="text" value={editVals.resource_code||""} onChange={e=>setEditVals(p=>({...p,resource_code:e.target.value}))}
                          className="w-28 border border-teal-400 rounded px-1 py-0.5 text-xs font-mono focus:outline-none"/>
                      : <span className="font-mono text-teal-800 font-semibold text-[10px] bg-teal-50 px-1 rounded">{r.resource_code||"—"}</span>
                    }
                  </td>
                  {/* Labour Type */}
                  <td className="px-2 py-1.5 text-center">
                    {isEd
                      ? <input type="text" value={editVals.labour_type||""} onChange={e=>setEditVals(p=>({...p,labour_type:e.target.value}))}
                          className="w-24 border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none"/>
                      : <span className="text-gray-500">{r.labour_type||"—"}</span>
                    }
                  </td>
                  {/* Account Code Internal */}
                  <td className="px-2 py-1.5 text-center">
                    {isEd
                      ? <input type="text" value={editVals.account_code_internal||""} onChange={e=>setEditVals(p=>({...p,account_code_internal:e.target.value}))}
                          className="w-20 border border-gray-300 rounded px-1 py-0.5 text-xs font-mono focus:outline-none"/>
                      : <span className="font-mono text-gray-600">{r.account_code_internal||"001001"}</span>
                    }
                  </td>
                  {/* Account Code External */}
                  <td className="px-2 py-1.5 text-center">
                    {isEd
                      ? <input type="text" value={editVals.account_code_external||""} onChange={e=>setEditVals(p=>({...p,account_code_external:e.target.value}))}
                          className="w-20 border border-gray-300 rounded px-1 py-0.5 text-xs font-mono focus:outline-none"/>
                      : <span className="font-mono text-gray-600">{r.account_code_external||"001000"}</span>
                    }
                  </td>
                  {/* Actions */}
                  <td className="px-2 py-1.5 text-center whitespace-nowrap">
                    {managerMode && (isEd
                      ? <div className="flex gap-1">
                          <button onClick={()=>saveEdit(r.resource_name)} className="text-green-600 hover:text-green-800 font-bold text-xs bg-green-50 border border-green-300 rounded px-2 py-0.5">✓ Save</button>
                          <button onClick={()=>setEditingKey(null)} className="text-gray-400 hover:text-gray-600 text-xs border border-gray-200 rounded px-1.5 py-0.5">✕</button>
                        </div>
                      : <button onClick={()=>startEdit(r)} className="text-[var(--primary-400)] hover:text-[var(--primary-700)] text-xs border border-[var(--primary-200)] hover:border-[var(--primary-400)] rounded px-2 py-0.5">Edit</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer legend */}
      <div className="flex-shrink-0 border-t bg-gray-50 px-3 py-1.5 flex items-center gap-4 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="bg-[var(--primary-100)] text-[var(--primary-800)] px-1 rounded font-semibold">Hour</span> Labour resource</span>
        <span className="flex items-center gap-1"><span className="bg-amber-100 text-amber-800 px-1 rounded font-semibold">Dollar</span> Contractor / Materials</span>
        <span className="flex items-center gap-1"><span className="bg-orange-100 text-orange-800 px-1 rounded font-semibold">Day</span> WAFHA / Accommodation</span>
        <span className="ml-2">CL Code = Copperleaf Resource Code · WACS = ERP craft code · Account: Internal=001001 · External/Commercial=001000</span>
        {localRC && <span className="ml-auto text-orange-600 font-semibold">⚡ {Object.keys(localRC).length} local overrides (session only)</span>}
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
  const FC = f => f>=1?"text-green-600":f>=0.90?"text-[var(--primary-600)]":f>=0.85?"text-yellow-600":f>=0.80?"text-orange-600":"text-red-600";

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
              className={`text-xs px-3 py-1.5 font-semibold transition-colors ${scaleTab===t.id?"bg-[var(--primary-700)] text-white":"text-gray-600 hover:bg-gray-50"}`}>{t.label}</button>
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
                className="border border-gray-300 rounded px-2 py-1.5 text-xs flex-1 focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
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
                        <td className="px-3 py-2 font-mono text-[var(--primary-700)]">{r.wbs_code}</td>
                        <td className="px-3 py-2 text-gray-700 max-w-[240px] truncate">{r.description}</td>
                        <td className="px-3 py-2 text-center">
                          <span className="bg-[var(--primary-100)] text-[var(--primary-700)] px-1.5 py-0.5 rounded text-xs font-medium">{r.scope}</span>
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
                              className="text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)] bg-white">
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
                      className={`text-xs px-2 py-0.5 rounded font-medium border-0 focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)] cursor-pointer ${SC[profile.status]||SC.Draft}`}>
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
                    <div key={i} className={`relative border rounded-lg p-3 text-center min-w-[90px] ${managerMode?"border-[var(--primary-200)] bg-[var(--primary-50)]":"border-gray-200 bg-gray-50"}`}>
                      {managerMode && (
                        <button onClick={()=>removeTier(profileId,i)}
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center leading-none hover:bg-red-700">×</button>
                      )}
                      <div className="text-xs text-gray-500 mb-2">Qty range</div>
                      <div className="flex items-center justify-center gap-1 mb-2">
                        {managerMode ? (
                          <>
                            <input type="number" min="1" value={tier.qty_from} onChange={e=>updateTier(profileId,i,'qty_from',parseFloat(e.target.value))}
                              className="w-10 text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                            <span className="text-gray-400 text-xs">–</span>
                            <input type="number" min="1" value={tier.qty_to??""} onChange={e=>updateTier(profileId,i,'qty_to',e.target.value?parseFloat(e.target.value):null)}
                              placeholder="∞"
                              className="w-10 text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
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
                          className="w-16 text-center border border-gray-300 rounded px-1 py-1 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
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
            <div className="bg-[var(--primary-900)] text-white px-4 py-2.5">
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
                                className="w-16 text-center border border-[var(--primary-300)] bg-[var(--primary-50)] rounded px-1.5 py-1 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"
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
                          <span className="font-bold text-[var(--primary-800)]">{factors[ph]}%</span>
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
          <div className="bg-[var(--primary-50)] border border-[var(--primary-200)] rounded-lg p-4 text-xs text-[var(--primary-800)]">
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
  const [showWizard,  setShowWizard]  = useState(false);
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

  // WBS duplicate detection — all codes currently in supply (including session-added ones)
  const usedWbsCodesSupply = useMemo(()=> new Set(displaySupply.map(s=>s.wbs_code).filter(Boolean)), [displaySupply]);
  const wbsAddVal     = newItem.wbs_code.trim();
  const wbsAddDupe    = wbsAddVal && usedWbsCodesSupply.has(wbsAddVal);
  const wbsAddOk      = wbsAddVal && !wbsAddDupe;

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
    if (!newItem.wbs_code.trim() || !newItem.description.trim() || wbsAddDupe) return;
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

  const INP = "w-full border rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)] bg-white";
  const SEL = "w-full border rounded px-1 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]";

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Toolbar ── */}
      <div className="bg-white border-b px-3 py-2 flex items-center gap-2 flex-shrink-0 flex-wrap">
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search code, description, resource…"
          className="border border-gray-200 rounded px-2 py-1.5 text-xs w-52 focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
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
            <button onClick={()=>setShowWizard(true)}
              className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded font-semibold">
              + Add WBS Item
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
      {/* ── WBS Item Wizard modal ── */}
      {showWizard && (
        <WBSWizard
          onClose={()=>setShowWizard(false)}
          existingCodes={usedWbsCodesSupply}
          supplyItems={displaySupply}
          onSave={(entries) => {
            setLocalSupply(p => [...(p || supply), ...entries]);
            setShowWizard(false);
          }}
        />
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
                const rowBg  = isEd    ? "bg-[var(--primary-50)]"
                             : hasGap  ? (i%2===0?"bg-amber-50":"bg-amber-50/60")
                             : i%2===0 ? "bg-white" : "bg-gray-50";

                if (isEd) return (
                  <tr key={s.wbs_code} className="bg-[var(--primary-50)] border-y-2 border-[var(--primary-400)]">
                    <td className="px-2 py-1.5 font-mono text-[var(--primary-800)] whitespace-nowrap text-[10px]">{s.wbs_code}</td>
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
                        <button onClick={()=>saveEdit(s.wbs_code)} className="bg-[var(--primary-700)] hover:bg-[var(--primary-600)] text-white px-2 py-0.5 rounded text-[10px] font-semibold">Save</button>
                        <button onClick={()=>setEditing(null)} className="border border-gray-300 text-gray-500 hover:bg-gray-50 px-2 py-0.5 rounded text-[10px]">Cancel</button>
                      </div>
                    </td>
                    {managerMode && <td/>}
                  </tr>
                );

                return (
                  <tr key={s.wbs_code}
                    onClick={()=>startEdit(s)}
                    className={`${rowBg} ${managerMode?"cursor-pointer hover:bg-[var(--primary-50)]/50":""} transition-colors`}>
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

// ═══════════════════════════════════════════════════════════════════
// WBS LINK INTEGRITY PANEL
// ═══════════════════════════════════════════════════════════════════
function WBSIntegrityPanel({ wbs, supply, nullApproved, toggleNullApproved }) {
  const [activeSection, setActiveSection] = useState("install");
  const [lastRun, setLastRun] = useState(null);
  const [runCount, setRunCount] = useState(0);

  // Build lookup maps from WBS data
  const checks = useMemo(() => {
    if (!wbs || !wbs.length) return null;
    const allWbsCodes = new Set(wbs.map(r=>r.wbs_code));
    const installWbs  = new Set(wbs.filter(r=>r.scope==="Install").map(r=>r.wbs_code));
    const commWbs     = new Set(wbs.filter(r=>r.scope==="Commission").map(r=>r.wbs_code));
    const hrsMap      = Object.fromEntries(wbs.map(r=>[r.wbs_code, r.install_hrs_per ?? r.ee_unit_hrs ?? null]));

    // Supply rows from supply data (which has install_wbs and commission_wbs links)
    const supplyRows = supply || [];

    // CHECK-01: broken install link targets
    const brokenInstall = supplyRows.filter(s=>
      s.install_wbs && !allWbsCodes.has(s.install_wbs)
    ).map(s=>({wbs_code:s.wbs_code, description:s.description, linked:s.install_wbs, issue:"Target WBS not found"}));

    // CHECK-02: install link pointing to non-Install scope
    const wrongScopeInstall = supplyRows.filter(s=>
      s.install_wbs && allWbsCodes.has(s.install_wbs) && !installWbs.has(s.install_wbs)
    ).map(s=>({wbs_code:s.wbs_code, description:s.description, linked:s.install_wbs, issue:"Target is not Install scope"}));

    // CHECK-03: install rows with null/zero hours (from wbs data, scope=Install, has L6 code)
    const installNullHrs = wbs.filter(r=>{
      if (r.scope !== "Install") return false;
      const parts = (r.wbs_code||"").split(".");
      if (parts.length < 6) return false; // group headers only
      const hrs = r.install_hrs_per ?? r.ee_unit_hrs ?? null;
      return hrs === null || hrs === undefined || Number(hrs) === 0;
    });

    // CHECK-04: commission rows with null/zero hours (L6, scope=Commission)
    // Split: misc rows (approved to stay null) vs unexpected
    const MISC_COMM_PREFIX = "4.1.6.06.7"; // Miscellaneous works — intentionally null, user-entered
    const SCADA_RTU_PANEL  = ["4.1.6.02.7.01","4.1.6.02.7.02"]; // SCADA RTU panel rows — also intentional
    const commNullHrs = wbs.filter(r=>{
      if (r.scope !== "Commission") return false;
      const parts = (r.wbs_code||"").split(".");
      if (parts.length < 6) return false;
      const hrs = r.install_hrs_per ?? r.ee_unit_hrs ?? null;
      return hrs === null || hrs === undefined || Number(hrs) === 0;
    });

    // Separate misc (intentionally null) from unexpected
    const miscCommNull    = commNullHrs.filter(r=>r.wbs_code.startsWith(MISC_COMM_PREFIX)||SCADA_RTU_PANEL.includes(r.wbs_code));
    const unexpCommNull   = commNullHrs.filter(r=>!r.wbs_code.startsWith(MISC_COMM_PREFIX)&&!SCADA_RTU_PANEL.includes(r.wbs_code));

    // CHECK-05: supply with install but no commission (phase 3 active equipment)
    const PASSIVE_PREFIXES = ["3.1.3.12","3.1.3.15","3.1.3.16","3.1.3.17","3.1.3.13","3.2.1.07","3.2.2.03","3.3.1.09","3.3.1.10","3.3.1.11","3.3.1.13","3.3.1.14","3.3.1.06","3.3.1.04","3.1.2.02"];
    const installNoComm = supplyRows.filter(s=>{
      if (!s.install_wbs || s.commission_wbs) return false;
      const wbsc = s.wbs_code || "";
      if (!["3.1.3","3.1.5","3.2.1","3.2.2","3.5.1"].some(p=>wbsc.startsWith(p))) return false;
      if (PASSIVE_PREFIXES.some(p=>wbsc.startsWith(p))) return false;
      return true;
    }).map(s=>({wbs_code:s.wbs_code, description:s.description, linked:s.install_wbs, issue:"Has install link but no commission link"}));

    return {
      brokenInstall, wrongScopeInstall, installNullHrs,
      miscCommNull, unexpCommNull, installNoComm,
      totalIssues: brokenInstall.length + wrongScopeInstall.length + unexpCommNull.length,
      totalWarnings: installNullHrs.length + installNoComm.length,
    };
  }, [wbs, supply, runCount]);

  const runTest = () => { setLastRun(new Date()); setRunCount(c=>c+1); };

  if (!wbs || !wbs.length) return (
    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading WBS data…</div>
  );

  const C = checks;
  const allClear = C.totalIssues === 0;

  const Pill = ({n, approved, type})=>{
    const cls = type==="ok"?"bg-green-100 text-green-700":type==="warn"?"bg-amber-100 text-amber-700":"bg-red-100 text-red-700";
    const allApproved = approved != null && approved >= n && n > 0;
    return (
      <span className={`text-xs font-mono px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 ${allApproved?"bg-green-100 text-green-700":cls}`}>
        {n}
        {approved != null && n > 0 && (
          <span className="opacity-60 font-normal text-[10px]">·{approved}✓</span>
        )}
      </span>
    );
  };

  // Count approved items per section
  const installApproved  = C.installNullHrs.filter(r=>nullApproved[r.wbs_code]).length;
  const commApproved     = [...C.miscCommNull,...C.unexpCommNull].filter(r=>nullApproved[r.wbs_code]).length;
  const nocommApproved   = C.installNoComm.filter(r=>nullApproved["nocomm_"+r.wbs_code]).length;

  const sections = [
    {id:"install",  label:"Install hrs gaps",     count:C.installNullHrs.length,   approved:installApproved, type: C.installNullHrs.length>0&&installApproved<C.installNullHrs.length?"warn":"ok"},
    {id:"comm",     label:"Commission hrs gaps",   count:C.miscCommNull.length+C.unexpCommNull.length, approved:commApproved, type: C.unexpCommNull.filter(r=>!nullApproved[r.wbs_code]).length>0?"err":"ok"},
    {id:"nocomm",   label:"No commission link",    count:C.installNoComm.length,    approved:nocommApproved, type: C.installNoComm.length>0&&nocommApproved<C.installNoComm.length?"warn":"ok"},
    {id:"broken",   label:"Broken link targets",   count:C.brokenInstall.length+C.wrongScopeInstall.length, approved:null, type: (C.brokenInstall.length+C.wrongScopeInstall.length)>0?"err":"ok"},
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
      {/* Header toolbar */}
      <div className="bg-white border-b px-4 py-2.5 flex items-center gap-3 flex-shrink-0">
        <button onClick={runTest}
          className="text-xs px-3 py-1.5 bg-[var(--primary-700)] hover:bg-[var(--primary-600)] text-white rounded font-semibold flex items-center gap-1.5">
          🔍 Run checks
        </button>
        {lastRun && <span className="text-xs text-gray-400">Last run: {lastRun.toLocaleTimeString("en-AU")}</span>}
        <div className="flex-1"/>
        <div className={`text-xs font-semibold px-3 py-1.5 rounded ${allClear?"bg-green-100 text-green-700":"bg-red-100 text-red-700"}`}>
          {allClear?"✓ All critical checks pass":`⚠ ${C.totalIssues} issue${C.totalIssues!==1?"s":""} · ${C.totalWarnings} warning${C.totalWarnings!==1?"s":""}`}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left nav */}
        <div className="w-52 bg-white border-r flex-shrink-0 flex flex-col pt-2">
          {sections.map(s=>(
            <button key={s.id} onClick={()=>setActiveSection(s.id)}
              className={`text-left px-4 py-2.5 text-xs flex items-center justify-between gap-2 border-l-2 transition-colors
                ${activeSection===s.id?"border-[var(--primary-600)] bg-[var(--primary-50)] text-[var(--primary-800)] font-semibold":"border-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-800"}`}>
              <span>{s.label}</span>
              <Pill n={s.count} approved={s.approved} type={s.type==="err"?"err":s.type==="warn"?"warn":"ok"}/>
            </button>
          ))}
          <div className="mt-4 mx-3 border-t pt-3">
            <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-2">Legend</div>
            <div className="space-y-1.5 text-xs text-gray-500">
              <div><span className="inline-block w-2 h-2 rounded-full bg-red-400 mr-1.5"></span>Critical — fix before go-live</div>
              <div><span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1.5"></span>Warning — needs review</div>
              <div><span className="inline-block w-2 h-2 rounded-full bg-green-400 mr-1.5"></span>Pass</div>
            </div>
            <div className="mt-3 pt-2 border-t border-gray-100 text-[10px] text-gray-400 leading-relaxed">
              <span className="font-mono bg-gray-100 px-1 rounded">N·M✓</span> = N total · M approved<br/>
              Goes green when all approved
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-4">

          {/* INSTALL NULL HRS */}
          {activeSection==="install"&&(
            <div>
              <div className="mb-3">
                <div className="font-semibold text-sm text-gray-800 mb-1">CHECK-03 · Install rows with no standard hours</div>
                <div className="text-xs text-gray-500">Install WBS line items (L6) with null or zero ee_unit_hrs. These rows cannot auto-calculate EE labour cost. Civil earthworks and OPGW stringing hours need to be agreed with the relevant team.</div>
              </div>
              {C.installNullHrs.length===0?(
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-700">✓ All install rows have standard hours set</div>
              ):(
                <table className="w-full text-xs border-collapse">
                  <thead><tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 text-gray-500 font-medium">WBS Code</th>
                    <th className="text-left py-2 px-2 text-gray-500 font-medium">Description</th>
                    <th className="text-center py-2 px-2 text-gray-500 font-medium">Hrs</th>
                    <th className="text-center py-2 px-2 text-gray-500 font-medium">Approved null</th>
                    <th className="text-left py-2 px-2 text-gray-500 font-medium">Action</th>
                  </tr></thead>
                  <tbody>
                    {C.installNullHrs.map(r=>{
                      const approved = !!nullApproved[r.wbs_code];
                      return (
                        <tr key={r.wbs_code} className={`border-b border-gray-100 ${approved?"opacity-50":""}`}>
                          <td className="py-1.5 px-2 font-mono text-gray-600">{r.wbs_code}</td>
                          <td className="py-1.5 px-2 text-gray-700">{r.description||"—"}</td>
                          <td className="py-1.5 px-2 text-center"><span className="text-amber-600 font-semibold">null</span></td>
                          <td className="py-1.5 px-2 text-center">
                            <input type="checkbox" checked={approved} onChange={()=>toggleNullApproved(r.wbs_code)}
                              className="w-3.5 h-3.5 accent-[var(--primary-600)] cursor-pointer"/>
                          </td>
                          <td className="py-1.5 px-2 text-gray-400">{approved?"Acknowledged — no action needed":"Agree hrs with team lead"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* COMMISSION NULL HRS */}
          {activeSection==="comm"&&(
            <div className="space-y-6">
              {/* Unexpected null hrs */}
              <div>
                <div className="font-semibold text-sm text-gray-800 mb-1">CHECK-04a · Commission rows with unexpected null hours</div>
                <div className="text-xs text-gray-500 mb-3">Commission WBS line items (L6) with null hours that are NOT in the approved-null category. These need a decision: set a standard rate, or mark as approved for null.</div>
                {C.unexpCommNull.length===0?(
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-700">✓ No unexpected null commission hours</div>
                ):(
                  <table className="w-full text-xs border-collapse">
                    <thead><tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-2 text-gray-500 font-medium">WBS Code</th>
                      <th className="text-left py-2 px-2 text-gray-500 font-medium">Description</th>
                      <th className="text-center py-2 px-2 text-gray-500 font-medium">Approved null</th>
                      <th className="text-left py-2 px-2 text-gray-500 font-medium">Action</th>
                    </tr></thead>
                    <tbody>
                      {C.unexpCommNull.map(r=>{
                        const approved = !!nullApproved[r.wbs_code];
                        return (
                          <tr key={r.wbs_code} className={`border-b border-gray-100 ${approved?"opacity-50":""}`}>
                            <td className="py-1.5 px-2 font-mono text-gray-600">{r.wbs_code}</td>
                            <td className="py-1.5 px-2 text-gray-700">{r.description||"—"}</td>
                            <td className="py-1.5 px-2 text-center">
                              <input type="checkbox" checked={approved} onChange={()=>toggleNullApproved(r.wbs_code)}
                                className="w-3.5 h-3.5 accent-[var(--primary-600)] cursor-pointer"/>
                            </td>
                            <td className="py-1.5 px-2 text-gray-400">{approved?"Acknowledged":"Set standard hrs or approve as null"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Misc slots — intentionally null */}
              <div>
                <div className="font-semibold text-sm text-gray-800 mb-1">CHECK-04b · Miscellaneous & SCADA RTU panel rows <span className="text-xs font-normal text-gray-400 ml-1">— approved to remain null (user-entered)</span></div>
                <div className="text-xs text-gray-500 mb-3">These rows are intentionally null because hours vary per investment and are entered by the estimator at the time of estimation. No action needed — use the checkbox to acknowledge if needed.</div>
                <table className="w-full text-xs border-collapse">
                  <thead><tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 text-gray-500 font-medium">WBS Code</th>
                    <th className="text-left py-2 px-2 text-gray-500 font-medium">Description</th>
                    <th className="text-center py-2 px-2 text-gray-500 font-medium">Acknowledged</th>
                    <th className="text-left py-2 px-2 text-gray-500 font-medium">Type</th>
                  </tr></thead>
                  <tbody>
                    {C.miscCommNull.map(r=>{
                      const approved = !!nullApproved[r.wbs_code];
                      const isMisc = r.wbs_code.startsWith("4.1.6.06");
                      return (
                        <tr key={r.wbs_code} className="border-b border-gray-100">
                          <td className="py-1.5 px-2 font-mono text-gray-600">{r.wbs_code}</td>
                          <td className="py-1.5 px-2 text-gray-700">{r.description||"—"}</td>
                          <td className="py-1.5 px-2 text-center">
                            <input type="checkbox" checked={approved} onChange={()=>toggleNullApproved(r.wbs_code)}
                              className="w-3.5 h-3.5 accent-green-600 cursor-pointer"/>
                          </td>
                          <td className="py-1.5 px-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${isMisc?"bg-gray-100 text-gray-600":"bg-[var(--primary-100)] text-[var(--primary-700)]"}`}>
                              {isMisc?"Misc slot — estimator enters":"SCADA RTU panel"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* INSTALL NO COMMISSION */}
          {activeSection==="nocomm"&&(
            <div>
              <div className="mb-3">
                <div className="font-semibold text-sm text-gray-800 mb-1">CHECK-05 · Phase 3 active equipment — install link set but no commission link</div>
                <div className="text-xs text-gray-500">These supply items in active-equipment categories have an install link but no commission_wbs set. Passive/structural items are excluded. Confirm with stakeholders whether a commission WBS row is needed for each.</div>
              </div>
              {C.installNoComm.length===0?(
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-700">✓ No unexpected gaps found</div>
              ):(
                <table className="w-full text-xs border-collapse">
                  <thead><tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 text-gray-500 font-medium">Supply WBS</th>
                    <th className="text-left py-2 px-2 text-gray-500 font-medium">Description</th>
                    <th className="text-left py-2 px-2 text-gray-500 font-medium">Install link</th>
                    <th className="text-center py-2 px-2 text-gray-500 font-medium">Approved no-comm</th>
                  </tr></thead>
                  <tbody>
                    {C.installNoComm.map(r=>{
                      const approved = !!nullApproved["nocomm_"+r.wbs_code];
                      return (
                        <tr key={r.wbs_code} className={`border-b border-gray-100 ${approved?"opacity-50":""}`}>
                          <td className="py-1.5 px-2 font-mono text-gray-600">{r.wbs_code}</td>
                          <td className="py-1.5 px-2 text-gray-700">{r.description||"—"}</td>
                          <td className="py-1.5 px-2 font-mono text-purple-600">{r.linked}</td>
                          <td className="py-1.5 px-2 text-center">
                            <input type="checkbox" checked={approved} onChange={()=>toggleNullApproved("nocomm_"+r.wbs_code)}
                              className="w-3.5 h-3.5 accent-[var(--primary-600)] cursor-pointer"/>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* BROKEN LINKS */}
          {activeSection==="broken"&&(
            <div className="space-y-6">
              <div>
                <div className="font-semibold text-sm text-gray-800 mb-1">CHECK-01 · Install link target not found</div>
                <div className="text-xs text-gray-500 mb-3">Supply rows whose install_wbs value does not match any WBS code in the master list. Critical — hours cannot calculate.</div>
                {C.brokenInstall.length===0?(
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-700">✓ All install link targets exist</div>
                ):(
                  <table className="w-full text-xs border-collapse">
                    <thead><tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-2 text-gray-500 font-medium">Supply WBS</th>
                      <th className="text-left py-2 px-2 text-gray-500 font-medium">Description</th>
                      <th className="text-left py-2 px-2 text-gray-500 font-medium">Broken link target</th>
                    </tr></thead>
                    <tbody>
                      {C.brokenInstall.map(r=>(
                        <tr key={r.wbs_code} className="border-b border-gray-100">
                          <td className="py-1.5 px-2 font-mono text-gray-600">{r.wbs_code}</td>
                          <td className="py-1.5 px-2 text-gray-700">{r.description||"—"}</td>
                          <td className="py-1.5 px-2 font-mono text-red-600">{r.linked}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <div className="font-semibold text-sm text-gray-800 mb-1">CHECK-02 · Install link pointing to wrong scope</div>
                {C.wrongScopeInstall.length===0?(
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-700">✓ All install link targets have correct scope</div>
                ):(
                  <table className="w-full text-xs border-collapse">
                    <thead><tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-2 text-gray-500 font-medium">Supply WBS</th>
                      <th className="text-left py-2 px-2 text-gray-500 font-medium">Description</th>
                      <th className="text-left py-2 px-2 text-gray-500 font-medium">Link</th>
                      <th className="text-left py-2 px-2 text-gray-500 font-medium">Issue</th>
                    </tr></thead>
                    <tbody>
                      {C.wrongScopeInstall.map(r=>(
                        <tr key={r.wbs_code} className="border-b border-gray-100">
                          <td className="py-1.5 px-2 font-mono text-gray-600">{r.wbs_code}</td>
                          <td className="py-1.5 px-2 text-gray-700">{r.description||"—"}</td>
                          <td className="py-1.5 px-2 font-mono text-amber-700">{r.linked}</td>
                          <td className="py-1.5 px-2 text-red-600">{r.issue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

function WBSManager({ equipSel, setEquipSel, onPriceUpdate }) {
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

  // ── NULL-HRS APPROVED STATE ──
  const [nullApproved, setNullApproved] = useState(()=>{
    try{ const r=localStorage.getItem("iet_null_approved"); return r?JSON.parse(r):{}; }catch(e){return {};}
  });
  const toggleNullApproved = (wbsCode) => {
    setNullApproved(prev=>{
      const next={...prev,[wbsCode]:!prev[wbsCode]};
      localStorage.setItem("iet_null_approved",JSON.stringify(next));
      return next;
    });
  };

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
    const trimCode = newWbs.wbs_code.trim();
    if (!trimCode||!newWbs.description.trim()) return;
    // Block if already in wbs (including overrides already added)
    const alreadyExists = wbs.some(r => r.wbs_code === trimCode);
    if (alreadyExists) return;
    const depth = trimCode.split(".").length;
    setWbsOverrides(p=>({...p,[trimCode]:{
      ...newWbs, depth, wbs_code:trimCode, _added:true
    }}));
    setShowAddWbs(false);
    setNewWbs({wbs_code:"",description:"",scope:"Supply",depth:6});
  };
  // Real-time check for the WBS add form
  const wbsAddMgrVal  = newWbs.wbs_code.trim();
  const wbsAddMgrDupe = wbsAddMgrVal && wbs.some(r => r.wbs_code === wbsAddMgrVal);

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
    {id:"eqpricing",  label:"💲 Equipment Pricing",    count:null},
    {id:"escalation", label:"📈 Escalation Rates",     count:null},
    {id:"scaling",    label:"📐 Comm Scaling",          count:WBS_PROFILES.length},
    {id:"people",     label:"👥 People & Roles",        count:people.filter(p=>p.active).length},
    {id:"integrity",  label:"🔍 Link Integrity",        count:null},
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
              className={`w-full text-center text-2xl font-mono tracking-widest border-2 rounded-lg px-3 py-3 mb-3 focus:outline-none ${pinError?"border-red-500 bg-red-50 animate-pulse":"border-gray-300 focus:border-[var(--primary-500)]"}`}
            />
            {pinError && <div className="text-xs text-red-600 text-center mb-2">Incorrect PIN — try again</div>}
            <div className="flex gap-2">
              <button onClick={()=>{setShowPinModal(false);setPinInput("");}}
                className="flex-1 text-xs border border-gray-200 text-gray-600 py-2 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={tryUnlock}
                className="flex-1 text-xs bg-[var(--primary-700)] hover:bg-[var(--primary-600)] text-white py-2 rounded-lg font-semibold">Unlock</button>
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
              ${tab===t.id?"border-[var(--primary-600)] text-[var(--primary-700)] bg-[var(--primary-50)]":"border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t.label}
            {t.count!=null && <span className="bg-gray-100 text-gray-500 text-xs px-1.5 py-0.5 rounded-full font-mono">{t.count}</span>}
          </button>
        ))}
        <div className="flex-1"/>
        {loading&&<span className="text-xs text-[var(--primary-500)] animate-pulse pb-2 pr-2">⟳ Loading…</span>}
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
      {/* Equipment Pricing */}
      {tab==="eqpricing"&&(
        <EquipmentPricingEditor managerMode={managerMode} onUnlock={()=>setShowPinModal(true)} onPriceUpdate={onPriceUpdate}/>
      )}

      {/* Escalation Rates */}
      {tab==="escalation"&&(
        <EscalationEditor managerMode={managerMode} onUnlock={()=>setShowPinModal(true)}/>
      )}

      {/* Commissioning Scaling */}
      {tab==="scaling"&&(
        <ScalingEditor managerMode={managerMode} onUnlock={()=>setShowPinModal(true)}/>
      )}

      {/* Link Integrity Test */}
      {tab==="integrity"&&(
        <WBSIntegrityPanel wbs={wbs} supply={supply} nullApproved={nullApproved} toggleNullApproved={toggleNullApproved}/>
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
                  className={`text-xs px-3 py-1.5 font-semibold transition-colors ${peopleFilter===v?"bg-[var(--primary-700)] text-white":"text-gray-600 hover:bg-gray-50"}`}>{l}</button>
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
  SCADA: { badge:"bg-[var(--primary-100)] text-[var(--primary-700)] border border-[var(--primary-300)]",      icon:"📡", label:"SCADA"           },
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
  // Flag items whose price was updated from Equipment Pricing page this session
  const isPriceOverridden = (s) => !!(s._priceFromEquipPricing);
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
              <div className="text-xl font-bold text-[var(--primary-900)]">{fmt(grandTotal)}</div>
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
                        <td className="px-3 py-2 font-mono text-[var(--primary-600)] whitespace-nowrap">{item.wbs_code}</td>
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



// ── WBS ITEM WIZARD ──────────────────────────────────────────────────────────
// 4-step guided wizard for creating new WBS items with correct
// Supply -> Install -> Commission relationships enforced.
// Used from: WBSItemEditor "+ Add WBS Item" button
//            EquipmentCatalogueManager "+ Add Item" (Path B — no existing WBS)
// Accepts optional prefill props from the catalogue add flow.
// ─────────────────────────────────────────────────────────────────────────────

const WIZ_PHASE4_L4_GROUPS = ['4.1.1.01', '4.1.2.01', '4.1.2.02', '4.1.2.03', '4.1.2.04', '4.1.2.05', '4.1.2.06', '4.1.2.07', '4.1.2.08', '4.1.2.09', '4.1.2.10', '4.1.2.11', '4.1.2.12', '4.1.2.13', '4.1.2.14', '4.1.2.15', '4.1.2.16', '4.1.2.17', '4.1.2.18', '4.1.3.01', '4.1.3.02', '4.1.3.03', '4.1.3.04', '4.1.3.05', '4.1.4.01', '4.1.5.01', '4.1.6.01', '4.1.6.02', '4.1.6.03', '4.1.6.04', '4.1.6.05', '4.1.6.06'];


// Phase 3 L4 group descriptions (from Activity Codes sheet)
const WBS_L4_DESC = {
  '3.1.1.01':'Civil Construction Ancillary Items','3.1.1.02':'Demolition','3.1.1.03':'Clear / Grub',
  '3.1.1.04':'Strip','3.1.1.05':'Trenching (Including Backfilling)','3.1.1.06':'Bulk Earthworks',
  '3.1.1.07':'Detailed Earthworks','3.1.1.08':'Geotextiles','3.1.1.09':'Stormwater Drainage and Headwalls',
  '3.1.1.10':'Rock Protection','3.1.1.11':'Subsoil Drainage','3.1.1.12':'Earthing',
  '3.1.1.13':'Switchyard Surfacing & Access Roads','3.1.1.14':'Switchyard Equipment Foundations',
  '3.1.1.15':'Fencing','3.1.1.16':'Electrical Civil Works','3.1.1.17':'Water and Fire Fighting Equipment',
  '3.1.2.01':'Building Construction Ancillary Items','3.1.2.02':'Buildings - Prefabricated','3.1.2.03':'Buildings - Masonry',
  '3.1.3.01':'Electrical Construction Ancillary Items','3.1.3.02':'Circuit Breakers','3.1.3.03':'Reclosers',
  '3.1.3.04':'Disconnectors and Earth Switches','3.1.3.05':'Current Transformers','3.1.3.06':'Voltage Transformer',
  '3.1.3.07':'Power Transformer','3.1.3.08':'Surge Arrestors and Post Insulators','3.1.3.09':'Switchboards',
  '3.1.3.10':'Capacitor Banks and Reactive Plant','3.1.3.11':'Miscellaneous Equipment','3.1.3.12':'Structures',
  '3.1.3.13':'Busbar and Fittings','3.1.3.14':'HV Power Cables','3.1.3.15':'HV Power Cable Terminations (Standard)',
  '3.1.3.16':'HV Power Cable Terminations (Deadbreak Elbow)','3.1.3.17':'Self-Supporting HV Cable Terminations',
  '3.1.3.18':'Auxiliary TX and RMU / Switching Stations','3.1.3.19':'DC Distribution Equipment',
  '3.1.3.20':'Protection Relays','3.1.3.21':'Indoor Panels and Outdoor Cubicles',
  '3.1.3.22':'Control and Protection Cables','3.1.3.23':'Switchyard Lighting and General Power',
  '3.1.3.24':'Property Physical Security','3.1.4.01':'Project Supervision & Coordination',
  '3.1.4.02':'Contract Procurement','3.1.4.03':'Vehicle, Equipment & Resource Hire','3.1.4.04':'Consumables',
  '3.1.5.01':'ZS Disposal',
  '3.2.1.01':'Substations Comms Construction Ancillary Items','3.2.1.02':'Routers & Switches',
  '3.2.1.03':'Digital Radio','3.2.1.04':'UHF Voice Radio Equipment','3.2.1.05':'Microwave Radio Equipment',
  '3.2.1.06':'Equipment Panels & Racks','3.2.1.07':'Fibre & Networking Equipment',
  '3.2.2.01':'Optical Fibre Cabling/Construction Ancillary Items','3.2.2.02':'Fibre Cabling',
  '3.2.2.03':'Cabling Accessories','3.2.2.04':'Project Supervision & Coordination (Comms)',
  '3.2.3.01':'Contract Procurement (Comms)','3.2.3.02':'Vehicle, Equipment & Resource Hire (Comms)',
  '3.2.3.03':'Consumables (Comms)',
  '3.3.1.01':'SM Construction Ancillary Items','3.3.1.02':'Clear / Grub',
  '3.3.1.03':'Trenching (Including Backfilling) & Underboring','3.3.1.04':'Conduits & Pits',
  '3.3.1.05':'HV Power Cables','3.3.1.06':'HV Power Cable Terminations & Inline Jointing Kits',
  '3.3.1.07':'Hurdles (Overhead Construction)','3.3.1.08':'Pole Foundation','3.3.1.09':'Steel Poles',
  '3.3.1.10':'Timber Poles','3.3.1.11':'Composite Poles','3.3.1.12':'Demolition / Removal of Poles',
  '3.3.1.13':'Pole Top Assemblies','3.3.1.14':'Overhead Conductor',
  '3.3.2.01':'Contract Procurement (SM)','3.3.2.02':'Vehicle, Equipment & Resource Hire (SM)','3.3.2.03':'Consumables (SM)',
  '3.5.1.01':'Ancillary Construction Ancillary Items','3.5.1.02':'Metering & PQM',
  '3.5.1.03':'SCADA RTU Equipment','3.5.1.04':'SCADA Transducers','3.5.1.05':'SCADA Miscellaneous Equipment',
  '3.5.1.06':'Load Control FI Plant','3.5.1.07':'System Control','3.5.1.08':'Miscellaneous works',
};

// Phase 4 L4 group descriptions (from Activity Codes sheet)
const WIZ_PHASE4_DESC = {
  '4.1.1.01':'Earthing',
  '4.1.2.01':'Circuit Breakers','4.1.2.02':'Reclosers','4.1.2.03':'Disconnectors and Earth Switches',
  '4.1.2.04':'Current Transformers','4.1.2.05':'Voltage Transformer','4.1.2.06':'Power Transformer',
  '4.1.2.07':'Surge Arrestors and Post Insulators','4.1.2.08':'Switchboards',
  '4.1.2.09':'Capacitor Banks and Reactive Plant','4.1.2.10':'Miscellaneous Equipment',
  '4.1.2.11':'Busbar and Fittings','4.1.2.12':'HV Power Cables & Terminations',
  '4.1.2.13':'Auxiliary TX and RMU / Switching Stations','4.1.2.14':'DC Distribution Equipment',
  '4.1.2.15':'Protection Relays','4.1.2.16':'Indoor Panels and Outdoor Cubicles',
  '4.1.2.17':'Control and Protection Cables','4.1.2.18':'Switchyard Lighting and General Power',
  '4.1.3.01':'Routers & Switches','4.1.3.02':'Digital Radio','4.1.3.03':'UHF Voice Radio Equipment',
  '4.1.3.04':'Microwave Radio Equipment','4.1.3.05':'Fibre & Networking Equipment',
  '4.1.4.01':'Fibre Cabling',
  '4.1.5.01':'HV Power Cables',
  '4.1.6.01':'Metering & PQM','4.1.6.02':'SCADA RTU Equipment','4.1.6.03':'SCADA Transducers',
  '4.1.6.04':'SCADA Miscellaneous Equipment','4.1.6.05':'Load Control FI Plant','4.1.6.06':'Miscellaneous works',
};

// Phase 3 L4 -> Phase 4 L4 suggested commission group (name-matched from workbook)
// e.g. 3.1.3.04 "Disconnectors" -> 4.1.2.03 "Disconnectors and Earth Switches"
const WBS_P3_TO_P4_SUGGEST = {
  '3.1.1.12':'4.1.1.01', // Earthing -> Earthing
  '3.1.3.02':'4.1.2.01', // Circuit Breakers -> Circuit Breakers
  '3.1.3.03':'4.1.2.02', // Reclosers -> Reclosers
  '3.1.3.04':'4.1.2.03', // Disconnectors and Earth Switches -> Disconnectors and Earth Switches
  '3.1.3.05':'4.1.2.04', // Current Transformers -> Current Transformers
  '3.1.3.06':'4.1.2.05', // Voltage Transformer -> Voltage Transformer
  '3.1.3.07':'4.1.2.06', // Power Transformer -> Power Transformer
  '3.1.3.08':'4.1.2.07', // Surge Arrestors and Post Insulators -> Surge Arrestors and Post Insulators
  '3.1.3.09':'4.1.2.08', // Switchboards -> Switchboards
  '3.1.3.10':'4.1.2.09', // Capacitor Banks -> Capacitor Banks and Reactive Plant
  '3.1.3.11':'4.1.2.10', // Miscellaneous Equipment -> Miscellaneous Equipment
  '3.1.3.13':'4.1.2.11', // Busbar and Fittings -> Busbar and Fittings
  '3.1.3.14':'4.1.2.12', // HV Power Cables -> HV Power Cables & Terminations
  '3.1.3.15':'4.1.2.12', // HV Cable Terminations (Standard) -> HV Power Cables & Terminations
  '3.1.3.16':'4.1.2.12', // HV Cable Terminations (Deadbreak) -> HV Power Cables & Terminations
  '3.1.3.17':'4.1.2.12', // Self-Supporting HV Cable -> HV Power Cables & Terminations
  '3.1.3.18':'4.1.2.13', // Aux TX and RMU -> Auxiliary TX and RMU
  '3.1.3.19':'4.1.2.14', // DC Distribution -> DC Distribution Equipment
  '3.1.3.20':'4.1.2.15', // Protection Relays -> Protection Relays
  '3.1.3.21':'4.1.2.16', // Indoor Panels -> Indoor Panels and Outdoor Cubicles
  '3.1.3.22':'4.1.2.17', // Control and Protection Cables -> Control and Protection Cables
  '3.1.3.23':'4.1.2.18', // Switchyard Lighting -> Switchyard Lighting and General Power
  '3.2.1.02':'4.1.3.01', // Routers & Switches -> Routers & Switches
  '3.2.1.03':'4.1.3.02', // Digital Radio -> Digital Radio
  '3.2.1.04':'4.1.3.03', // UHF Voice Radio -> UHF Voice Radio Equipment
  '3.2.1.05':'4.1.3.04', // Microwave Radio -> Microwave Radio Equipment
  '3.2.1.07':'4.1.3.05', // Fibre & Networking -> Fibre & Networking Equipment
  '3.2.2.02':'4.1.4.01', // Fibre Cabling -> Fibre Cabling
  '3.3.1.05':'4.1.5.01', // HV Power Cables (SM) -> HV Power Cables
  '3.3.1.06':'4.1.5.01', // HV Cable Terminations (SM) -> HV Power Cables
  '3.5.1.02':'4.1.6.01', // Metering & PQM -> Metering & PQM
  '3.5.1.03':'4.1.6.02', // SCADA RTU -> SCADA RTU Equipment
  '3.5.1.04':'4.1.6.03', // SCADA Transducers -> SCADA Transducers
  '3.5.1.05':'4.1.6.04', // SCADA Misc -> SCADA Miscellaneous Equipment
  '3.5.1.06':'4.1.6.05', // Load Control -> Load Control FI Plant
  '3.5.1.08':'4.1.6.06', // Miscellaneous works -> Miscellaneous works
};
// Groups with NO commission equivalent (civil, structures, ancillary items etc)
const WBS_NO_COMMISSION = new Set([
  '3.1.1.01','3.1.1.02','3.1.1.03','3.1.1.04','3.1.1.05','3.1.1.06','3.1.1.07','3.1.1.08',
  '3.1.1.09','3.1.1.10','3.1.1.11','3.1.1.13','3.1.1.14','3.1.1.15','3.1.1.16','3.1.1.17',
  '3.1.2.01','3.1.2.02','3.1.2.03','3.1.3.01','3.1.3.12','3.1.3.24',
  '3.1.4.01','3.1.4.02','3.1.4.03','3.1.4.04','3.1.5.01',
  '3.2.1.01','3.2.1.06','3.2.2.01','3.2.2.03','3.2.2.04','3.2.3.01','3.2.3.02','3.2.3.03',
  '3.3.1.01','3.3.1.02','3.3.1.03','3.3.1.04','3.3.1.07','3.3.1.08','3.3.1.09','3.3.1.10',
  '3.3.1.11','3.3.1.12','3.3.1.13','3.3.1.14','3.3.2.01','3.3.2.02','3.3.2.03',
  '3.5.1.01','3.5.1.07',
]);

const WIZ_SCOPE_PATTERNS = [
  { id:"standard",  label:"Supply (.1) -> Install (.4) -> Commission (.7)",     desc:"Standard HV plant — 3 rows created" },
  { id:"combined",  label:"Supply & Install combined (.1 only, no separate .4)",  desc:"Items installed as supplied — 2 rows" },
  { id:"supplyonly",label:"Supply only — no field labour",                       desc:"Factory-installed or no labour cost — 1 row" },
  { id:"scada",     label:"SCADA / Comms — custom commission profile",           desc:"Non-standard commission scaling — 3 rows" },
];

const WIZ_SCALING_PROFILES = [
  "HV Plant Outdoor","HV Plant Indoor","SCADA RTC","Comms","Protection & Control","Transformer","None"
];

const WIZ_AER_TYPES = [
  "R1 -- Administration / Design","R2a -- Network Planner / SCADA Designer",
  "R2b -- Supervisor / Telecomms","R3a -- Protection / Project Engineer",
  "R3b -- External PM / Specialist","R4 -- Electrical Technician / Worker",
  "Contractor - Electrical","Contractor - Civil","Contractor - Building","Supplier / Materials","N.A."
];

const WIZ_DELIVERY = ["Contractor Delivered","EE Delivered","Contractor or EE Delivered"];

const WIZ_STEPS = [
  { id:"hierarchy", label:"Hierarchy",     short:"1" },
  { id:"supply",    label:"Supply item",   short:"2" },
  { id:"hours",     label:"Hours",         short:"3" },
  { id:"validate",  label:"Validate",      short:"4" },
];

const WIZ_PIN = "1607";

function WBSWizard({ onClose, onSave, prefill, existingCodes }) {
  const [step,       setStep]       = useState(0);
  const [pinInput,   setPinInput]   = useState("");
  const [pinError,   setPinError]   = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [govRef,     setGovRef]     = useState("");

  // Step 1 — hierarchy
  const [parentNode,   setParentNode]   = useState("");
  const [deviceCode,   setDeviceCode]   = useState("");
  const [deviceDesc,   setDeviceDesc]   = useState("");
  const [scopePattern, setScopePattern] = useState("standard");
  const [itemNo,       setItemNo]       = useState("01");

  // Step 2 — supply item
  const [supplyDesc, setSupplyDesc] = useState((prefill && prefill.description) || "");
  const [aer,        setAer]        = useState("Contractor - Electrical");
  const [delivery,   setDelivery]   = useState("Contractor Delivered");
  const [make,       setMake]       = useState((prefill && prefill.make_model) || "");
  const [price,      setPrice]      = useState((prefill && prefill.price) ? String(prefill.price) : "");
  const [isLLT,      setIsLLT]      = useState(false);

  // Commission WBS — separate Phase 4 code
  const [commL4Code,     setCommL4Code]     = useState("");
  const [commItemNo,     setCommItemNo]     = useState("01");

  // Step 3 -- hours
  const [installCrew,    setInstallCrew]    = useState("2");
  const [installHrs,     setInstallHrs]     = useState("8");
  const [commHrs,        setCommHrs]        = useState("4");
  const [scalingProfile, setScalingProfile] = useState("HV Plant Outdoor");

  const supplyCode  = deviceCode.trim() ? deviceCode.trim() + ".1." + itemNo : "";
  const installCode = deviceCode.trim() ? deviceCode.trim() + ".4." + itemNo : "";
  // Commission code uses Phase 4 L4 code (NOT derived from supply L4)
  const commCode    = (commL4Code.trim() && (scopePattern === "standard" || scopePattern === "scada"))
    ? commL4Code.trim() + ".7." + commItemNo : "";

  // Check if commission code already exists
  const dupComm = commCode && existingCodes && existingCodes.has(commCode);

  // Check if Phase 4 L4 group has ANY existing commission rows (validation)
  const commL4HasItems = useMemo(() => {
    if (!commL4Code.trim() || !existingCodes) return false;
    const prefix = commL4Code.trim() + ".7.";
    for (const code of existingCodes) { if (code.startsWith(prefix)) return true; }
    return false;
  }, [commL4Code, existingCodes]);

  const commTakenSuffixes = useMemo(() => {
    if (!commL4Code.trim() || !existingCodes) return new Set();
    const taken = new Set();
    for (const code of existingCodes) {
      if (code.startsWith(commL4Code.trim() + ".7.")) {
        const parts = code.split(".");
        if (parts.length === 6) taken.add(parts[5]);
      }
    }
    return taken;
  }, [commL4Code, existingCodes]);

  const commNextFree = useMemo(() => {
    for (let i = 1; i <= 99; i++) {
      const s = String(i).padStart(2, "0");
      if (!commTakenSuffixes.has(s)) return s;
    }
    return "99";
  }, [commTakenSuffixes]);


  const installHrsTotal = (parseFloat(installCrew) || 0) * (parseFloat(installHrs) || 0);
  const commHrsTotal    = parseFloat(commHrs) || 0;

  const dupSupply = supplyCode && existingCodes && existingCodes.has(supplyCode);

  // Description lookups for typed codes
  const l4Desc    = WBS_L4_DESC[deviceCode.trim()] || "";
  const commL4Desc = WIZ_PHASE4_DESC[commL4Code.trim()] || "";

  // Suggested Phase 4 commission group based on the Phase 3 L4
  const suggestedCommL4 = WBS_P3_TO_P4_SUGGEST[deviceCode.trim()] || "";
  const noCommissionGroup = WBS_NO_COMMISSION.has(deviceCode.trim());

  // L4 exists detection: check if ANY item with this L4 prefix exists
  // e.g. existingCodes has 3.1.1.16.1.01 -> L4 "3.1.1.16" already in use
  const l4Exists = useMemo(() => {
    if (!deviceCode.trim() || !existingCodes) return false;
    const prefix = deviceCode.trim() + ".";
    for (const code of existingCodes) {
      if (code.startsWith(prefix)) return true;
    }
    return false;
  }, [deviceCode, existingCodes]);

  // If L4 exists, find taken suffixes and auto-suggest next free one
  const takenSuffixes = useMemo(() => {
    if (!deviceCode.trim() || !existingCodes) return new Set();
    const taken = new Set();
    for (const code of existingCodes) {
      // code format: 3.1.1.16.1.05 -> scope=".1.", suffix="05"
      const parts = code.split(".");
      if (parts.length === 6 && code.startsWith(deviceCode.trim() + ".1.")) {
        taken.add(parts[5]);
      }
    }
    return taken;
  }, [deviceCode, existingCodes]);

  const nextFreeSuffix = useMemo(() => {
    for (let i = 1; i <= 99; i++) {
      const s = String(i).padStart(2, "0");
      if (!takenSuffixes.has(s)) return s;
    }
    return "99";
  }, [takenSuffixes]);

  // When L4 is detected as existing, auto-set itemNo to next free suffix
  // This runs when deviceCode changes and l4Exists becomes true
  const [autoSuffixApplied, setAutoSuffixApplied] = useState(false);

  const willCreate = () => {
    const rows = [];
    if (supplyCode) rows.push({ code: supplyCode,  scope: "Supply",     desc: supplyDesc || deviceDesc, hrs: null });
    if (installCode && scopePattern !== "supplyonly" && scopePattern !== "combined")
      rows.push({ code: installCode, scope: "Install",    desc: (supplyDesc || deviceDesc) + " -- install", hrs: installHrsTotal });
    if (commCode)
      rows.push({ code: commCode,    scope: "Commission", desc: (supplyDesc || deviceDesc) + " -- commission", hrs: commHrsTotal });
    return rows;
  };
  const rows = willCreate();

  const canNext = () => {
    const needsComm = scopePattern === "standard" || scopePattern === "scada";
    if (step === 0) return deviceCode.trim().length >= 7 && deviceDesc.trim() && !dupSupply
      && (!needsComm || (commL4Code.trim().length >= 7 && !dupComm));
    if (step === 1) return supplyDesc.trim().length > 0;
    if (step === 2) return installHrsTotal > 0 || scopePattern === "supplyonly";
    return false;
  };

  const trySubmit = () => {
    if (pinInput !== WIZ_PIN) { setPinError(true); setPinInput(""); return; }
    setPinError(false);
    const entries = rows.map(r => ({
      wbs_code: r.code, l4_group: deviceCode.trim(),
      description: r.desc, scope: r.scope,
      delivery_method: delivery, resource_main: aer, uom: "each",
      ee_unit_hrs: r.scope === "Install" ? installHrsTotal : r.scope === "Commission" ? commHrsTotal : null,
      pce_price:   r.scope === "Supply"  ? (parseFloat(price) || null) : null,
      install_wbs: supplyCode, commission_wbs: commCode || null,
      _pending_governance: true, _gov_ref: govRef, _wizard: true,
    }));
    if (onSave) onSave(entries);
    setSaved(true);
  };

  const fmtHrs = (h) => h > 0 ? h + " hrs/unit" : "--";

  const STEP_CLS = (idx) =>
    idx < step  ? "bg-green-600 text-white border-green-600"
    : idx === step ? "bg-[var(--primary-600)] text-white border-[var(--primary-600)]"
    :               "bg-white text-gray-400 border-gray-200";

  if (saved) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full mx-4 text-center">
        <div className="text-4xl mb-3">&#10003;</div>
        <div className="text-lg font-bold text-green-800 mb-2">WBS items created</div>
        <div className="text-sm text-gray-600 mb-2">{rows.length} row{rows.length !== 1 ? "s" : ""} saved as <span className="font-semibold text-amber-700">Pending Governance</span>.</div>
        <div className="text-xs text-gray-400 mb-4">Items will appear in the WBS editor marked pending. Cannot be used in estimates until WBS Manager confirms governance sign-off.</div>
        {govRef && <div className="text-xs text-[var(--primary-600)] mb-4">Governance ref: <span className="font-mono font-semibold">{govRef}</span></div>}
        <button onClick={onClose} className="bg-[var(--primary-700)] hover:bg-[var(--primary-600)] text-white px-6 py-2 rounded font-semibold text-sm">Done</button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl flex flex-col" style={{width:"780px",maxHeight:"90vh"}}>

        {/* Header + stepper */}
        <div className="bg-[#1e3a5f] text-white px-5 py-3 rounded-t-xl flex items-center gap-4 flex-shrink-0">
          <span className="font-semibold text-sm">New WBS item wizard</span>
          <div className="flex items-center gap-2 flex-1 overflow-hidden">
            {WIZ_STEPS.map((s, idx) => (
              <div key={s.id} className="flex items-center gap-1 min-w-0">
                <div className={`w-5 h-5 rounded-full border flex-shrink-0 flex items-center justify-center text-[10px] font-bold ${STEP_CLS(idx)}`}>
                  {idx < step ? "v" : s.short}
                </div>
                <span className={`text-xs truncate ${idx === step ? "text-white font-medium" : "text-[var(--primary-300)]"}`}>{s.label}</span>
                {idx < WIZ_STEPS.length - 1 && <div className="w-4 h-px bg-[var(--primary-700)] flex-shrink-0 ml-1"/>}
              </div>
            ))}
          </div>
          <button onClick={onClose} className="text-[var(--primary-300)] hover:text-white text-lg leading-none ml-2 flex-shrink-0">x</button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left sidebar */}
          <div className="w-44 flex-shrink-0 bg-gray-50 border-r px-3 py-4 flex flex-col gap-4 overflow-y-auto">
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-2">WBS context</div>
              <div className="text-[10px] text-gray-600 space-y-1">
                {parentNode && <div><span className="text-gray-400">Parent: </span><span className="font-mono font-medium">{parentNode}</span></div>}
                {deviceCode  && <div><span className="text-gray-400">L4: </span><span className="font-mono font-medium text-[var(--primary-700)]">{deviceCode}</span></div>}
                {deviceDesc  && <div><span className="text-gray-400">Group: </span><span className="font-medium">{deviceDesc}</span></div>}
              </div>
            </div>
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Will create</div>
              <div className="space-y-1.5">
                {[
                  { label:"Supply (.1)",     active: step > 0, skip: false },
                  { label:"Install (.4)",    active: step > 2, skip: scopePattern === "supplyonly" || scopePattern === "combined" },
                  { label:"Commission (.7)", active: step > 2, skip: scopePattern === "supplyonly" },
                ].map((r, i) => (
                  <div key={i} className={"flex items-center gap-1.5 text-[10px]" + (r.skip ? " opacity-30 line-through" : "")}>
                    <span className={"w-3 h-3 rounded-full flex-shrink-0 border " + (r.active ? "bg-green-500 border-green-500" : "bg-white border-gray-300")}/>
                    <span className={r.active ? "text-green-700" : "text-gray-400"}>{r.label}</span>
                  </div>
                ))}
              </div>
            </div>
            {prefill && (prefill.description || prefill.make_model) && (
              <div className="bg-[var(--primary-50)] border border-[var(--primary-200)] rounded p-2">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-[var(--primary-600)] mb-1">Pre-filled</div>
                <div className="text-[10px] text-[var(--primary-700)] space-y-0.5">
                  {prefill.description && <div>{prefill.description}</div>}
                  {prefill.make_model  && <div className="text-gray-500">{prefill.make_model}</div>}
                  {prefill.price > 0   && <div className="font-semibold">${parseFloat(prefill.price).toLocaleString()}</div>}
                </div>
              </div>
            )}
          </div>

          {/* Step content */}
          <div className="flex-1 overflow-y-auto p-4">

            {/* STEP 1 */}
            {step === 0 && (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-gray-700 pb-1.5 border-b">Step 1 -- place in WBS hierarchy</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">Parent node (optional context)</label>
                    <input value={parentNode} onChange={e=>setParentNode(e.target.value)}
                      placeholder="e.g. 3.1.3 -- HV plant"
                      className="w-full border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">L4 device group code *</label>
                    <input value={deviceCode} onChange={e=>setDeviceCode(e.target.value)}
                      placeholder="e.g. 3.1.3.04"
                      className={"w-full border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 " + (dupSupply ? "border-red-400 bg-red-50" : "focus:ring-[var(--primary-400)]")}/>
                    {l4Desc && (
                      <div className="text-[10px] text-[var(--primary-700)] font-semibold mt-0.5">
                        {deviceCode.trim()} -- {l4Desc}
                      </div>
                    )}
                    {l4Exists && !dupSupply && (
                      <div className="text-[10px] text-[var(--primary-600)] mt-0.5 flex items-center gap-1">
                        <span>&#9432;</span> Adding new item to existing group
                      </div>
                    )}
                    {dupSupply && <div className="text-[10px] text-red-600 mt-0.5">Supply code {supplyCode} already taken -- choose a different suffix</div>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">Device group description *</label>
                    <input value={deviceDesc} onChange={e=>setDeviceDesc(e.target.value)}
                      placeholder="e.g. 66kV Surge Arresters"
                      className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">Item suffix <span className="text-gray-400 font-normal">(or type any number)</span></label>
                    <input value={itemNo} onChange={e=>setItemNo(e.target.value.replace(/[^0-9]/g,"").padStart(2,"0").slice(-2) || e.target.value)}
                      list="item-suffix-list"
                      className={"w-full border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 " + (dupSupply ? "border-red-400 bg-red-50" : "border-gray-300 focus:ring-[var(--primary-400)]")}/>
                    <datalist id="item-suffix-list">
                      {Array.from({length:60},(_,i)=>String(i+1).padStart(2,"0")).map(n=><option key={n} value={n}/>)}
                    </datalist>
                  </div>
                </div>
                {supplyCode && (
                  <div className="bg-[var(--primary-50)] border border-[var(--primary-200)] rounded px-2 py-1.5 text-[10px] text-[var(--primary-700)]">
                    Supply: <span className="font-mono font-semibold">{supplyCode}</span>
                    {installCode && <span className="ml-3">Install: <span className="font-mono">{installCode}</span></span>}
                    {commCode && <span className="ml-3">Commission: <span className="font-mono font-semibold text-green-700">{commCode}</span></span>}
                    {(scopePattern === "standard" || scopePattern === "scada") && !commCode && (
                      <span className="ml-3 text-amber-700">Commission: needs Phase 4 code below</span>
                    )}
                  </div>
                )}

                {/* Phase 4 commission L4 code -- only shown for standard/scada patterns */}
                {(scopePattern === "standard" || scopePattern === "scada") && (
                  <div className="border border-purple-200 bg-purple-50 rounded p-2.5 space-y-2">
                    <div className="text-[10px] font-semibold text-purple-800">
                      Commission WBS -- Phase 4 group required
                      <span className="ml-2 font-normal text-purple-500">Commission codes are always 4.x.x.xx.7.xx -- separate from Phase 3</span>
                    </div>

                    {/* No-commission warning based on P3 L4 lookup */}
                    {noCommissionGroup && (
                      <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                        <span className="text-red-500 flex-shrink-0 mt-0.5">&#9888;</span>
                        <div className="text-[10px] text-red-800">
                          <span className="font-semibold">{l4Desc || deviceCode.trim()} does not have a commission scope.</span>{" "}
                          Civil, structural, ancillary and admin items are not commissioned.
                          Use <strong>Supply &amp; Install combined</strong> or <strong>Supply only</strong> instead.
                        </div>
                      </div>
                    )}

                    {/* Suggestion when P3->P4 mapping known */}
                    {suggestedCommL4 && !noCommissionGroup && (
                      <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded px-2 py-1.5">
                        <span className="text-green-600 text-sm flex-shrink-0">&#10003;</span>
                        <div className="text-[10px] text-green-800 flex-1">
                          Suggested commission group for <span className="font-mono font-semibold">{deviceCode.trim()}</span>
                          {l4Desc ? " (" + l4Desc + ")" : ""}:
                          <span className="font-mono font-semibold ml-1 text-purple-700">{suggestedCommL4}</span>
                          <span className="ml-1 text-green-700">-- {WIZ_PHASE4_DESC[suggestedCommL4]}</span>
                        </div>
                        {commL4Code !== suggestedCommL4 && (
                          <button onClick={()=>setCommL4Code(suggestedCommL4)}
                            className="text-[10px] bg-green-700 hover:bg-green-600 text-white px-2 py-0.5 rounded font-semibold flex-shrink-0">
                            Use
                          </button>
                        )}
                        {commL4Code === suggestedCommL4 && (
                          <span className="text-[10px] text-green-700 flex-shrink-0 font-semibold">Selected</span>
                        )}
                      </div>
                    )}

                    {/* No known mapping -- show all options */}
                    {!suggestedCommL4 && !noCommissionGroup && deviceCode.trim().length >= 7 && (
                      <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                        No automatic suggestion for <span className="font-mono">{deviceCode.trim()}</span>.
                        Select the Phase 4 group manually from the list below.
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-0.5">Phase 4 L4 group code *</label>
                        <input value={commL4Code} onChange={e=>setCommL4Code(e.target.value)}
                          list="comm-l4-list"
                          placeholder="e.g. 4.1.2.03"
                          className={"w-full border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 " + (dupComm ? "border-red-400 bg-red-50" : "border-purple-300 focus:ring-purple-400")}/>
                        <datalist id="comm-l4-list">
                          {WIZ_PHASE4_L4_GROUPS.map(g=>(
                            <option key={g} value={g}>{g} -- {WIZ_PHASE4_DESC[g]}</option>
                          ))}
                        </datalist>
                        {commL4Desc && (
                          <div className="text-[10px] text-purple-700 font-semibold mt-0.5">
                            {commL4Code.trim()} -- {commL4Desc}
                          </div>
                        )}
                        {commL4HasItems && (
                          <div className="text-[10px] text-[var(--primary-600)] mt-0.5">
                            {commTakenSuffixes.size} existing commission {commTakenSuffixes.size === 1 ? "row" : "rows"} in this group
                          </div>
                        )}
                        {dupComm && <div className="text-[10px] text-red-600 mt-0.5">Commission code {commCode} already taken</div>}
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-0.5">Commission item suffix</label>
                        <input value={commItemNo} onChange={e=>setCommItemNo(e.target.value)}
                          list="comm-suffix-list"
                          className="w-full border border-purple-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-purple-400"/>
                        <datalist id="comm-suffix-list">
                          {Array.from({length:60},(_,i)=>String(i+1).padStart(2,"0")).map(n=><option key={n} value={n}/>)}
                        </datalist>
                        {commTakenSuffixes.size > 0 && (
                          <div className="text-[10px] text-amber-700 mt-0.5">
                            Next free: <span className="font-mono font-semibold text-[var(--primary-700)]">{commNextFree}</span>
                            {commItemNo !== commNextFree && (
                              <button onClick={()=>setCommItemNo(commNextFree)}
                                className="ml-1 underline text-[var(--primary-600)] hover:text-[var(--primary-800)]">Use {commNextFree}</button>
                            )}
                          </div>
                        )}
                        {commCode && (
                          <div className="text-[10px] text-purple-700 font-mono mt-1 font-semibold">
                            Commission code: {commCode}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {l4Exists && takenSuffixes.size > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded px-2 py-2 text-[10px]">
                    <div className="font-semibold text-amber-800 mb-1">
                      Existing items in group {deviceCode.trim()} ({takenSuffixes.size} supply {takenSuffixes.size === 1 ? "row" : "rows"} found)
                    </div>
                    <div className="flex flex-wrap gap-1 mb-1">
                      {[...takenSuffixes].sort().map(s => (
                        <span key={s} className="bg-amber-200 text-amber-900 font-mono px-1.5 py-0.5 rounded text-[9px]">
                          {deviceCode.trim()}.1.{s}
                        </span>
                      ))}
                    </div>
                    <div className="text-amber-700">
                      Next free suffix: <span className="font-mono font-semibold text-[var(--primary-700)]">{nextFreeSuffix}</span>
                      {itemNo !== nextFreeSuffix && (
                        <button onClick={()=>setItemNo(nextFreeSuffix)}
                          className="ml-2 underline text-[var(--primary-600)] hover:text-[var(--primary-800)]">Use {nextFreeSuffix}</button>
                      )}
                    </div>
                  </div>
                )}
                <div>
                  <label className="text-[10px] text-gray-500 block mb-1.5">Scope pattern *</label>
                  <div className="space-y-1.5">
                    {WIZ_SCOPE_PATTERNS.map(p => (
                      <label key={p.id} className={"flex items-start gap-2 p-2 rounded border cursor-pointer text-xs " + (scopePattern === p.id ? "bg-[var(--primary-50)] border-[var(--primary-300)]" : "border-gray-200 hover:border-gray-300")}>
                        <input type="radio" name="scope_pattern" value={p.id}
                          checked={scopePattern === p.id} onChange={()=>setScopePattern(p.id)}
                          className="mt-0.5 flex-shrink-0"/>
                        <div>
                          <div className="font-medium text-gray-800">{p.label}</div>
                          <div className="text-gray-400 text-[10px]">{p.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2 */}
            {step === 1 && (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-gray-700 pb-1.5 border-b">Step 2 -- supply item definition</div>
                <div className="bg-[var(--primary-50)] border border-[var(--primary-200)] rounded px-2 py-1.5 text-[10px] text-[var(--primary-700)]">
                  Defining supply item for <span className="font-mono font-semibold">{supplyCode}</span>
                  {prefill && prefill.description ? " -- pre-filled from catalogue item." : ""}
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block mb-0.5">Item description *</label>
                  <input value={supplyDesc} onChange={e=>setSupplyDesc(e.target.value)}
                    placeholder="e.g. 66kV Surge Arrester -- 10kA station class"
                    className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                </div>
                {make !== "" && (
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">Make / model</label>
                    <input value={make} onChange={e=>setMake(e.target.value)}
                      className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">AER resource type *</label>
                    <select value={aer} onChange={e=>setAer(e.target.value)}
                      className="w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]">
                      {WIZ_AER_TYPES.map(t=><option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">Delivery method</label>
                    <select value={delivery} onChange={e=>setDelivery(e.target.value)}
                      className="w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]">
                      {WIZ_DELIVERY.map(d=><option key={d}>{d}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">Unit price / PCE price ($)</label>
                    <input type="number" min="0" step="0.01" value={price} onChange={e=>setPrice(e.target.value)}
                      placeholder="0 or leave blank for GAP"
                      className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                    {!price && <div className="text-[10px] text-amber-600 mt-0.5">No price -- will show as GAP</div>}
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">LLT item?</label>
                    <select value={isLLT ? "yes" : "no"} onChange={e=>setIsLLT(e.target.value === "yes")}
                      className="w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]">
                      <option value="no">No -- standard lead time</option>
                      <option value="yes">Yes -- triggers Copperleaf B-row</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3 */}
            {step === 2 && (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-gray-700 pb-1.5 border-b">Step 3 -- pre-agreed standard hours</div>
                <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-[10px] text-amber-800">
                  These are Class 4 pre-agreed standard hours. Estimators do <span className="font-semibold">not</span> enter install or commission hours -- they flow automatically.
                </div>
                {scopePattern === "supplyonly" ? (
                  <div className="bg-gray-50 border rounded p-4 text-center text-xs text-gray-500">Supply only -- no install or commission hours required.</div>
                ) : (
                  <div className="space-y-3">
                    {scopePattern !== "combined" && (
                      <div className="border rounded p-3">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-2 pb-1 border-b">Install hours -- {installCode}</div>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="text-[10px] text-gray-500 block mb-0.5">Crew size</label>
                            <input type="number" min="1" max="20" value={installCrew} onChange={e=>setInstallCrew(e.target.value)}
                              className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 block mb-0.5">Hours per person</label>
                            <input type="number" min="0" step="0.5" value={installHrs} onChange={e=>setInstallHrs(e.target.value)}
                              className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 block mb-0.5">Total hrs / unit</label>
                            <div className="border rounded px-2 py-1 text-xs font-bold bg-green-50 text-green-800 border-green-200">
                              {installHrsTotal > 0 ? installHrsTotal + " hrs" : "--"}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {(scopePattern === "standard" || scopePattern === "scada") && (
                      <div className="border rounded p-3">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-2 pb-1 border-b">Commission hours (base before scaling)</div>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="text-[10px] text-gray-500 block mb-0.5">Base hrs / unit</label>
                            <input type="number" min="0" step="0.5" value={commHrs} onChange={e=>setCommHrs(e.target.value)}
                              className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 block mb-0.5">Scaling profile</label>
                            <select value={scalingProfile} onChange={e=>setScalingProfile(e.target.value)}
                              className="w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]">
                              {WIZ_SCALING_PROFILES.map(p=><option key={p}>{p}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 block mb-0.5">Stored as</label>
                            <div className="border rounded px-2 py-1 text-xs font-bold bg-green-50 text-green-800 border-green-200">{commHrs || "--"} hrs (base)</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* STEP 4 */}
            {step === 3 && (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-gray-700 pb-1.5 border-b">Step 4 -- validate and governance</div>
                <div className="bg-green-50 border border-green-200 rounded px-3 py-2 text-[10px] text-green-700">
                  {rows.length} row{rows.length !== 1 ? "s" : ""} ready to create. Review before saving.
                </div>
                <table className="w-full text-[10px] border-collapse">
                  <thead>
                    <tr className="bg-gray-700 text-white">
                      {["WBS code","Scope","Description","Hrs / unit","Price / rate"].map(h=>(
                        <th key={h} className={"py-1.5 px-2 font-medium " + (h === "Hrs / unit" || h === "Price / rate" ? "text-right" : "text-left")}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-gray-50" : "bg-white"}>
                        <td className="py-1.5 px-2 font-mono text-[var(--primary-700)] font-semibold">{r.code}</td>
                        <td className="py-1.5 px-2">
                          <span className={"px-1.5 py-0.5 rounded text-[9px] font-semibold " + (r.scope==="Supply"?"bg-[var(--primary-100)] text-[var(--primary-800)]":r.scope==="Install"?"bg-green-100 text-green-800":"bg-amber-100 text-amber-800")}>{r.scope}</span>
                        </td>
                        <td className="py-1.5 px-2 text-gray-700">{r.desc}</td>
                        <td className="py-1.5 px-2 text-right text-gray-600">{r.hrs !== null ? fmtHrs(r.hrs) : "--"}</td>
                        <td className="py-1.5 px-2 text-right text-gray-600">{r.scope === "Supply" && price ? "$" + parseFloat(price).toLocaleString() : "--"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  {[["Delivery",delivery],["AER type",aer.split("--")[0].trim()],["Status on save","Pending Governance"]].map(([k,v],i)=>(
                    <div key={i} className="bg-gray-50 border rounded p-2">
                      <div className="text-gray-400 mb-0.5">{k}</div>
                      <div className={"font-medium " + (k==="Status on save"?"text-amber-700":"text-gray-700")}>{v}</div>
                    </div>
                  ))}
                </div>
                <div className="bg-amber-50 border border-amber-300 rounded p-3">
                  <div className="text-[10px] font-semibold text-amber-800 mb-2">Governance gate -- WBS Manager PIN required</div>
                  <div className="text-[10px] text-amber-700 mb-2">New WBS items are saved as Pending until governance sign-off is confirmed. Items are visible but cannot be used in estimates until activated.</div>
                  <div className="flex gap-3 items-end">
                    <div className="flex-1">
                      <label className="text-[10px] text-gray-500 block mb-0.5">WBS Manager PIN *</label>
                      <input type="password" value={pinInput} onChange={e=>{setPinInput(e.target.value);setPinError(false);}}
                        onKeyDown={e=>{ if(e.key==="Enter") trySubmit(); }}
                        placeholder="Enter PIN"
                        className={"w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 " + (pinError ? "border-red-400 bg-red-50 focus:ring-red-400" : "focus:ring-[var(--primary-400)]")}/>
                      {pinError && <div className="text-[10px] text-red-600 mt-0.5">Incorrect PIN</div>}
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-gray-500 block mb-0.5">Governance ref (optional)</label>
                      <input value={govRef} onChange={e=>setGovRef(e.target.value)}
                        placeholder="e.g. GOV-2026-041"
                        className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 flex justify-between items-center flex-shrink-0 bg-gray-50 rounded-b-xl">
          <button onClick={()=>setStep(s=>Math.max(0,s-1))}
            style={{visibility: step===0?"hidden":"visible"}}
            className="text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 px-4 py-1.5 rounded">
            Back
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancel</button>
            {step < 3 ? (
              <button onClick={()=>setStep(s=>s+1)} disabled={!canNext()}
                className="text-xs bg-[var(--primary-700)] hover:bg-[var(--primary-600)] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white px-5 py-1.5 rounded font-semibold">
                Next
              </button>
            ) : (
              <button onClick={trySubmit} disabled={!pinInput}
                className="text-xs bg-green-700 hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white px-5 py-1.5 rounded font-semibold">
                Create WBS items
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Escalation constants ──────────────────────────────────────────
// FY labels: index 0 = current base (FY26), 1-4 = FY27-FY30
const ESC_FY_LABELS = ["FY26","FY27","FY28","FY29","FY30"];
const ESC_STREAMS = {
  Materials:   { label:"Materials",    rates:[0, 0.049, 0.040, 0.040, 0.040] },
  Contractors: { label:"Contractors",  rates:[0, 0.049, 0.045, 0.040, 0.035] },
  EEInternal:  { label:"EE Internal",  rates:[0, 0.045, 0.038, 0.035, 0.035] },
  Manual:      { label:"Manual",       rates:null },
};

// Table showing escalated price across FYs for a given base price and stream
function EscPreviewTable({ basePrice, streamKey, manualRates, highlightFY }) {
  if (!basePrice || basePrice <= 0) return null;
  const streamRates = (ESC_STREAMS[streamKey]?.rates) || manualRates || [0,0,0,0,0];
  const rows = ESC_FY_LABELS.map((fy, idx) => {
    let cf = 1;
    for (let i = 1; i <= idx; i++) cf *= (1 + (streamRates[i] || 0));
    return { fy, price: basePrice * cf, rate: streamRates[idx] || 0 };
  });
  return (
    <table className="w-full text-[10px] border-collapse mt-2">
      <thead>
        <tr>
          {rows.map(({fy})=>(
            <th key={fy} className={`text-center py-1 px-2 font-semibold border border-gray-100 ${fy===highlightFY?"bg-amber-100 text-amber-800":"bg-gray-50 text-gray-500"}`}>{fy}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          {rows.map(({fy, price, rate}, i)=>(
            <td key={fy} className={`text-center py-1 px-2 border border-gray-100 font-mono ${fy===highlightFY?"bg-amber-50 text-amber-900 font-semibold":"text-gray-700"}`}>
              ${Math.round(price).toLocaleString("en-AU")}
              {i>0 && <div className="text-[8px] text-gray-400 font-normal">+{(rate*100).toFixed(1)}%</div>}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

// Sub-component: escalation stream selector
function EscStreamSelector({ streamKey, setStreamKey, manualRates, setManualRates, compact=false }) {
  const streamColors = {
    Materials:   "border-purple-400 bg-purple-50 text-purple-800",
    Contractors: "border-orange-400 bg-orange-50 text-orange-800",
    EEInternal:  "border-[var(--primary-400)] bg-[var(--primary-50)] text-[var(--primary-800)]",
    Manual:      "border-gray-400 bg-gray-50 text-gray-700",
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Escalation stream</div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(ESC_STREAMS).map(([key, s]) => (
          <button key={key}
            onClick={() => setStreamKey(key)}
            className={`text-[10px] px-2 py-0.5 rounded border font-medium transition-colors ${
              streamKey === key ? streamColors[key] : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
            }`}>
            {s.label}
            {s.rates && (
              <span className="ml-1 opacity-60">
                {s.rates.filter(r=>r>0).map(r=>(r*100).toFixed(1)+"%").join("/")}
              </span>
            )}
          </button>
        ))}
      </div>
      {streamKey === "Manual" && (
        <div className="flex gap-2 mt-1 flex-wrap items-end">
          {["FY27","FY28","FY29","FY30"].map((fy, i) => (
            <div key={fy} className="flex flex-col items-center gap-0.5">
              <span className="text-[9px] text-gray-400">{fy}</span>
              <input type="number" step="0.1" min="0" max="30"
                value={((manualRates?.[i+1]||0)*100).toFixed(1)}
                onChange={e => {
                  const next = [...(manualRates||[0,0,0,0,0])];
                  next[i+1] = parseFloat(e.target.value)/100 || 0;
                  setManualRates(next);
                }}
                className="w-16 border border-gray-300 rounded px-1.5 py-0.5 text-[10px] text-center focus:outline-none focus:ring-1 focus:ring-gray-400"
                placeholder="%"/>
            </div>
          ))}
          <span className="text-[9px] text-gray-400 italic pb-0.5">% per year</span>
        </div>
      )}
      {streamKey !== "Manual" && ESC_STREAMS[streamKey].rates && (
        <div className="text-[9px] text-gray-400">
          Workbook rates (FY27-FY30): {ESC_STREAMS[streamKey].rates.slice(1).map((r,i)=>`FY${27+i} ${(r*100).toFixed(1)}%`).join(" / ")}
        </div>
      )}
    </div>
  );
}

function EquipmentPricingEditor({ managerMode, onUnlock, onPriceUpdate }) {
  const { equipPricing: ctxPricing } = useData();
  const [localPricing, setLocalPricing] = useState(null);
  const [editingKey,   setEditingKey]   = useState(null);
  const [editVals,     setEditVals]     = useState({});
  const [expanded,     setExpanded]     = useState({});
  const [histTab,      setHistTab]      = useState({});
  const [search,       setSearch]       = useState("");
  const [sourceFilter, setSourceFilter] = useState("All");

  // Escalation stream state -- shared across all expanded item previews
  const [escStream,    setEscStream]    = useState("Materials");
  const [manualRates,  setManualRates]  = useState([0, 0.049, 0.040, 0.040, 0.040]);
  const [highlightFY,  setHighlightFY]  = useState("FY28");

  // Edit-panel escalation stream (independent from preview stream)
  const [editEscStream,   setEditEscStream]   = useState("Materials");
  const [editManualRates, setEditManualRates] = useState([0, 0.049, 0.040, 0.040, 0.040]);
  const [epShowAddPath, setEpShowAddPath] = useState(null);
  const [epWizardPrefill, setEpWizardPrefill] = useState({});

  const basePricing = localPricing || ctxPricing || {};

  // Single-rate compound formula -- used for stored escalated_price (existing behaviour)
  const calcEscalated = (basePrice, priceDate, escRate) => {
    if (!basePrice || basePrice <= 0) return null;
    const rate = escRate ?? 0.06;
    if (!priceDate) return basePrice * (1 + rate);
    const yearsElapsed = (Date.now() - new Date(priceDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    if (yearsElapsed <= 0) return basePrice;
    return basePrice * Math.pow(1 + rate, yearsElapsed);
  };

  // FY-stream escalation: compound IET stream rates up to a chosen FY
  const escToFY = (basePrice, streamKey, manual, targetFYLabel) => {
    if (!basePrice || basePrice <= 0) return null;
    const rates = ESC_STREAMS[streamKey].rates || manual || [0,0,0,0,0];
    const idx   = ESC_FY_LABELS.indexOf(targetFYLabel);
    if (idx < 0) return basePrice;
    let cf = 1;
    for (let i = 1; i <= idx; i++) cf *= (1 + (rates[i]||0));
    return basePrice * cf;
  };

  const pricingArray = useMemo(() =>
    Object.values(basePricing).sort((a, b) => (a.wbs_code||"").localeCompare(b.wbs_code||""))
  , [basePricing]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return pricingArray.filter(r => {
      const matchQ = !q
        || (r.wbs_code||"").toLowerCase().includes(q)
        || (r.description||"").toLowerCase().includes(q)
        || (r.make||"").toLowerCase().includes(q)
        || (r.model||"").toLowerCase().includes(q)
        || (r.category||"").toLowerCase().includes(q)
        || (r.contract_no||"").toLowerCase().includes(q);
      const matchS = sourceFilter === "All" || r.source === sourceFilter;
      return matchQ && matchS;
    });
  }, [pricingArray, search, sourceFilter]);

  const startEdit = (r) => {
    setEditingKey(r.wbs_code);
    setExpanded(p => ({...p, [r.wbs_code]: true}));
    setHistTab(p => ({...p, [r.wbs_code]: "history"}));
    setEditVals({
      base_price: r.base_price != null ? String(r.base_price) : "",
      price_date: r.price_date ?? "",
      esc_rate:   r.esc_rate  != null ? (r.esc_rate * 100).toFixed(1) : "6.0",
      comments:   r.comments  ?? "",
    });
  };

  const saveEdit = (key) => {
    const next = { ...basePricing };
    if (!next[key]) return;
    const oldRow  = next[key];
    const newBase = parseFloat(editVals.base_price);
    const newDate = editVals.price_date || oldRow.price_date;
    const newRate = parseFloat(editVals.esc_rate) / 100;
    const newEsc  = (!isNaN(newBase) && newDate && !isNaN(newRate))
      ? calcEscalated(newBase, newDate, newRate)
      : oldRow.escalated_price;
    const prevHistory = oldRow._history || [];
    const histEntry   = oldRow.base_price != null ? {
      fy: "Prior", base: oldRow.base_price, date: oldRow.price_date,
      updatedBy: "S. Hannigan", note: oldRow.comments || "",
    } : null;
    next[key] = {
      ...oldRow,
      base_price:      !isNaN(newBase) ? newBase : oldRow.base_price,
      price_date:      newDate,
      esc_rate:        !isNaN(newRate) ? newRate : oldRow.esc_rate,
      escalated_price: newEsc,
      comments:        editVals.comments,
      _edited:         true,
      _history:        histEntry ? [...prevHistory, histEntry] : prevHistory,
    };
    setLocalPricing(next);
    if (onPriceUpdate) onPriceUpdate(key, next[key]);
    setEditingKey(null);
  };

  const srcBadge = (src) => {
    const cfg = {
      PCE:   "bg-[var(--primary-100)] text-[var(--primary-800)] border-[var(--primary-200)]",
      SCADA: "bg-purple-100 text-purple-800 border-purple-200",
      Comms: "bg-teal-100 text-teal-800 border-teal-200",
    };
    return <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border ${cfg[src]||"bg-gray-100 text-gray-600"}`}>{src}</span>;
  };

  const fmtPrice = (v) => v != null && v > 0
    ? "$" + v.toLocaleString("en-AU", {minimumFractionDigits:2, maximumFractionDigits:2}) : "--";
  const fmtPriceRound = (v) => v != null && v > 0
    ? "$" + Math.round(v).toLocaleString("en-AU") : "--";

  const ageYears = (dateStr) => {
    if (!dateStr) return null;
    return (Date.now() - new Date(dateStr).getTime()) / (1000*60*60*24*365.25);
  };

  const staleCount  = filtered.filter(r => { const a = ageYears(r.price_date); return a === null || a > 2; }).length;
  const editedCount = Object.values(basePricing).filter(r => r._edited).length;
  const FY_OPTIONS  = ESC_FY_LABELS.slice(1);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Toolbar */}
      <div className="bg-white border-b px-3 py-2 flex items-center gap-2 flex-shrink-0 flex-wrap">
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search WBS, description, make, category..."
          className="border border-gray-300 rounded px-2 py-1 text-xs w-56 focus:outline-none focus:ring-1 focus:ring-[var(--primary-300)]"/>
        {search && <button onClick={()=>setSearch("")} className="text-gray-400 text-xs hover:text-gray-600">x</button>}
        <select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none">
          <option value="All">All sources</option>
          <option value="PCE">PCE / LLT</option>
          <option value="SCADA">SCADA</option>
          <option value="Comms">Comms</option>
        </select>
        <span className="text-xs text-gray-400">{filtered.length} items</span>
        {staleCount > 0 && (
          <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
            {staleCount} prices &gt;2yr old
          </span>
        )}
        {editedCount > 0 && (
          <span className="text-xs text-orange-700 bg-orange-50 border border-orange-200 px-2 py-1 rounded font-semibold">
            {editedCount} edited this session
          </span>
        )}
        <div className="flex-1"/>
        {managerMode ? (
          <>
            <button onClick={() => setEpShowAddPath("path-choice")}
              className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded font-semibold">+ Add Item</button>
            <span className="text-xs bg-orange-100 text-orange-700 border border-orange-300 px-3 py-1.5 rounded font-semibold">Manager Mode</span>
          </>
        ) : (
          <button onClick={onUnlock} className="text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded">Manager Mode</button>
        )}
      </div>

      {/* Data flow notice */}
      <div className="bg-[var(--primary-50)] border-b border-[var(--primary-200)] px-3 py-1.5 text-[10px] text-[var(--primary-700)] flex items-center gap-2 flex-shrink-0 flex-wrap">
        <span className="font-semibold">Data flow:</span>
        <span className="font-mono bg-[var(--primary-100)] px-1 rounded">Base Price (catalogue)</span>
        <span className="text-[var(--primary-400)]">stored as-is, not pre-escalated</span>
        <span>-&gt;</span>
        <span className="font-mono bg-green-100 text-green-800 px-1 rounded font-semibold">Escalated Cost</span>
        <span className="text-[var(--primary-400)]">derived by engine using project timeline + stream rates</span>
        <span>-&gt;</span>
        <span className="font-mono bg-orange-100 text-orange-800 px-1 rounded">pce_price -&gt; materials cost</span>
        <span className="ml-auto text-[var(--primary-400)] italic">Escalation preview is reference only</span>
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map(r => {
          const isEd    = editingKey === r.wbs_code;
          const isExp   = !!expanded[r.wbs_code];
          const itemTab = histTab[r.wbs_code] || "history";
          const esc     = calcEscalated(r.base_price, r.price_date, r.esc_rate);
          const age     = ageYears(r.price_date);
          const isStale = age === null || age > 2;
          const uplift  = esc && r.base_price ? esc - r.base_price : 0;

          return (
            <div key={r.wbs_code}
              className={`border-b ${isStale&&!isEd?"bg-amber-50/30":isEd?"bg-[var(--primary-50)]":r._edited?"bg-orange-50/30":""}`}>

              {/* Main compact row */}
              <div className="flex items-center px-3 py-2 gap-2 text-xs">
                <button
                  onClick={()=>setExpanded(p=>({...p,[r.wbs_code]:!p[r.wbs_code]}))}
                  className={`flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-xs transition-colors ${
                    isExp ? "bg-[var(--primary-600)] text-white" : "text-gray-300 hover:text-[var(--primary-500)] hover:bg-[var(--primary-50)]"
                  }`}>
                  {isExp ? "v" : ">"}
                </button>
                <span className="font-mono text-[10px] text-gray-500 flex-shrink-0 w-32">{r.wbs_code}</span>
                <span className="flex-shrink-0">{srcBadge(r.source)}</span>
                <span className="flex-1 min-w-0 text-gray-800 font-medium truncate" title={r.description}>
                  {r.description}
                  {r._edited && <span className="ml-1 text-[9px] text-orange-600 font-semibold"> edited</span>}
                </span>
                <span className="text-gray-400 text-[10px] w-28 flex-shrink-0 truncate hidden xl:block">{r.category}</span>

                {/* Base price */}
                <div className="flex-shrink-0 w-28 text-right">
                  {isEd ? (
                    <input type="number" step="0.01" value={editVals.base_price}
                      onChange={e=>setEditVals(p=>({...p,base_price:e.target.value}))}
                      className="w-full border border-[var(--primary-300)] bg-white rounded px-1.5 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"
                      placeholder="Base price"/>
                  ) : (
                    <span className="text-[var(--primary-800)] font-medium">{fmtPrice(r.base_price)}</span>
                  )}
                </div>

                {/* Price date */}
                <div className="flex-shrink-0 w-28 text-center">
                  {isEd ? (
                    <input type="date" value={editVals.price_date}
                      onChange={e=>setEditVals(p=>({...p,price_date:e.target.value}))}
                      className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                  ) : (
                    <span className={`text-[10px] ${isStale?"text-amber-700 font-semibold":"text-gray-500"}`}>
                      {r.price_date || "--"}
                      {isStale && age !== null && <span className="ml-1 text-[9px]">({age.toFixed(1)}y)</span>}
                    </span>
                  )}
                </div>

                {/* Esc rate */}
                <div className="flex-shrink-0 w-16 text-right">
                  {isEd ? (
                    <input type="number" step="0.1" min="0" max="50" value={editVals.esc_rate}
                      onChange={e=>setEditVals(p=>({...p,esc_rate:e.target.value}))}
                      className="w-full border border-purple-300 rounded px-1 py-0.5 text-xs text-right focus:outline-none"
                      placeholder="%"/>
                  ) : (
                    <span className="text-purple-700">{r.esc_rate != null ? (r.esc_rate*100).toFixed(1)+"%" : "--"}</span>
                  )}
                </div>

                <span className="text-gray-300 text-xs flex-shrink-0">-&gt;</span>

                {/* Escalated price (stored) */}
                <div className="flex-shrink-0 w-32 text-right">
                  {esc ? (
                    <div>
                      <div className={`font-bold ${isStale?"text-amber-700":"text-green-800"}`}>{fmtPrice(esc)}</div>
                      {uplift > 0.5 && <div className="text-[9px] text-gray-400">+{fmtPrice(uplift)} esc.</div>}
                    </div>
                  ) : <span className="text-gray-300">--</span>}
                </div>

                {/* Action buttons */}
                <div className="flex-shrink-0 flex gap-1 justify-end">
                  <button
                    onClick={()=>{setExpanded(p=>({...p,[r.wbs_code]:true}));setHistTab(p=>({...p,[r.wbs_code]:"history"}));}}
                    className="text-gray-400 hover:text-gray-700 text-[10px] border border-gray-200 hover:border-gray-300 rounded px-1.5 py-0.5"
                    title="Price history">Hist</button>
                  <button
                    onClick={()=>{setExpanded(p=>({...p,[r.wbs_code]:true}));setHistTab(p=>({...p,[r.wbs_code]:"escalation"}));}}
                    className="text-gray-400 hover:text-purple-600 text-[10px] border border-gray-200 hover:border-purple-300 rounded px-1.5 py-0.5"
                    title="Escalation preview">Esc</button>
                  {managerMode && (isEd ? (
                    <div className="flex gap-1">
                      <button onClick={()=>saveEdit(r.wbs_code)}
                        className="bg-green-700 hover:bg-green-600 text-white text-[10px] px-2 py-0.5 rounded font-bold">Save</button>
                      <button onClick={()=>setEditingKey(null)}
                        className="border border-gray-300 text-gray-500 text-[10px] px-1.5 py-0.5 rounded hover:bg-gray-50">x</button>
                    </div>
                  ) : (
                    <button onClick={()=>startEdit(r)}
                      className="text-[var(--primary-400)] hover:text-[var(--primary-700)] text-[10px] border border-[var(--primary-200)] hover:border-[var(--primary-400)] rounded px-2 py-0.5">
                      Edit
                    </button>
                  ))}
                </div>
              </div>

              {/* Expanded detail panel */}
              {isExp && (
                <div className="mx-3 mb-3 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden text-xs">

                  {/* Header */}
                  <div className="bg-gray-700 text-white px-3 py-1.5 flex items-center justify-between">
                    <span className="font-semibold">{r.wbs_code} -- {r.description}</span>
                    <div className="flex items-center gap-2">
                      {srcBadge(r.source)}
                      <button onClick={()=>setExpanded(p=>({...p,[r.wbs_code]:false}))}
                        className="text-gray-400 hover:text-white ml-2 text-xs">x</button>
                    </div>
                  </div>

                  {/* Tab bar */}
                  <div className="flex border-b border-gray-200 bg-gray-50">
                    {[
                      {id:"history",    label:"Price history"},
                      {id:"escalation", label:"Escalation preview"},
                      {id:"details",    label:"Item details"},
                    ].map(t => (
                      <button key={t.id}
                        onClick={()=>setHistTab(p=>({...p,[r.wbs_code]:t.id}))}
                        className={`px-3 py-1.5 text-[10px] font-medium border-b-2 transition-colors ${
                          itemTab===t.id
                            ? "border-[var(--primary-500)] text-[var(--primary-700)] bg-white"
                            : "border-transparent text-gray-500 hover:text-gray-700"
                        }`}>{t.label}</button>
                    ))}
                    {isEd && (
                      <button
                        onClick={()=>setHistTab(p=>({...p,[r.wbs_code]:"edit"}))}
                        className={`px-3 py-1.5 text-[10px] font-medium border-b-2 transition-colors ${
                          itemTab==="edit"
                            ? "border-[var(--primary-500)] text-[var(--primary-700)] bg-[var(--primary-50)]"
                            : "border-transparent text-[var(--primary-500)] hover:text-[var(--primary-700)]"
                        }`}>Edit price</button>
                    )}
                  </div>

                  {/* TAB: Price history */}
                  {itemTab === "history" && (
                    <div className="p-3">
                      <div className="text-[10px] text-[var(--primary-700)] bg-[var(--primary-50)] border border-[var(--primary-200)] rounded px-2 py-1.5 mb-3">
                        <span className="font-semibold">Base prices only</span> -- raw contract prices stored in the catalogue.
                        Escalation applied by estimation engine per project timeline. See Escalation preview tab to project forward.
                      </div>
                      <table className="w-full border-collapse text-[10px]">
                        <thead>
                          <tr className="border-b border-gray-200">
                            {["FY","Effective from","Expires","Base contract price","Change vs prior","Updated by","Notes"].map(h=>(
                              <th key={h} className={`py-1 px-2 text-gray-400 font-medium ${h==="Base contract price"||h==="Change vs prior"?"text-right":"text-left"}`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(r._history||[]).map((h, i, arr) => {
                            const prev  = i > 0 ? arr[i-1].base : null;
                            const delta = prev ? h.base - prev : null;
                            const pct   = prev ? ((h.base - prev) / prev * 100).toFixed(1) : null;
                            return (
                              <tr key={i} className="border-b border-gray-100">
                                <td className="py-1 px-2 text-gray-500">{h.fy||"Prior"}</td>
                                <td className="py-1 px-2 text-gray-500">{h.date||"--"}</td>
                                <td className="py-1 px-2 text-gray-400">--</td>
                                <td className="py-1 px-2 text-right text-gray-700 font-medium">{fmtPrice(h.base)}</td>
                                <td className="py-1 px-2 text-right">
                                  {delta == null ? <span className="text-gray-300">--</span>
                                    : delta > 0
                                      ? <span className="text-red-600">+{fmtPriceRound(delta)} (+{pct}%)</span>
                                      : <span className="text-green-600">{fmtPriceRound(delta)} ({pct}%)</span>}
                                </td>
                                <td className="py-1 px-2 text-gray-500">{h.updatedBy||"--"}</td>
                                <td className="py-1 px-2 text-gray-400 italic">{h.note||"--"}</td>
                              </tr>
                            );
                          })}
                          <tr className="bg-green-50 border-l-2 border-green-500">
                            <td className="py-1.5 px-2 text-green-700 font-semibold">FY26 Active</td>
                            <td className="py-1.5 px-2 text-gray-500">{r.price_date||"--"}</td>
                            <td className="py-1.5 px-2 text-gray-400">30 Jun 2026</td>
                            <td className="py-1.5 px-2 text-right font-bold text-green-800">{fmtPrice(r.base_price)}</td>
                            <td className="py-1.5 px-2 text-right text-gray-400 text-[9px]">current</td>
                            <td className="py-1.5 px-2 text-gray-500">S. Hannigan</td>
                            <td className="py-1.5 px-2 text-gray-400 italic truncate max-w-[160px]">{r.comments||"--"}</td>
                          </tr>
                          <tr className="border-b border-gray-100 bg-amber-50/40">
                            <td className="py-1 px-2 text-amber-600 font-medium">FY27</td>
                            <td colSpan={3} className="py-1 px-2 text-gray-300">Not yet set</td>
                            <td className="py-1 px-2 text-right text-amber-600 text-[9px]">update due</td>
                            <td colSpan={2} className="py-1 px-2 text-gray-300">--</td>
                          </tr>
                        </tbody>
                      </table>
                      {managerMode && (
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={()=>{startEdit(r);setHistTab(p=>({...p,[r.wbs_code]:"edit"}));}}
                            className="text-[10px] border border-[var(--primary-300)] text-[var(--primary-700)] hover:bg-[var(--primary-50)] rounded px-3 py-1">
                            Enter FY27 price
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB: Escalation preview */}
                  {itemTab === "escalation" && (
                    <div className="p-3">
                      <div className="text-[10px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 mb-3">
                        Preview only -- base price <span className="font-semibold text-[var(--primary-700)]">{fmtPrice(r.base_price)}</span> projected
                        forward using selected stream. Does not affect stored values. Choose stream or enter manual rates.
                      </div>
                      <div className="mb-3 p-2 bg-gray-50 border border-gray-200 rounded">
                        <EscStreamSelector streamKey={escStream} setStreamKey={setEscStream}
                          manualRates={manualRates} setManualRates={setManualRates} compact={true}/>
                      </div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-[10px] text-gray-500">Highlight FY:</span>
                        {FY_OPTIONS.map(fy => (
                          <button key={fy} onClick={()=>setHighlightFY(fy)}
                            className={`text-[10px] px-2 py-0.5 rounded border ${
                              highlightFY===fy ? "bg-[var(--primary-600)] text-white border-[var(--primary-600)]" : "border-gray-200 text-gray-500 hover:border-gray-300"
                            }`}>{fy}</button>
                        ))}
                        <span className="ml-2 text-[10px] text-[var(--primary-600)] font-semibold">
                          {fmtPriceRound(escToFY(r.base_price, escStream, manualRates, highlightFY))}/unit in {highlightFY}
                        </span>
                      </div>
                      {r.base_price > 0 ? (
                        <EscPreviewTable basePrice={r.base_price} streamKey={escStream}
                          manualRates={manualRates} highlightFY={highlightFY}/>
                      ) : (
                        <div className="text-gray-400 text-[10px] italic py-4 text-center">No base price set</div>
                      )}
                      <div className="text-[9px] text-gray-400 mt-2">
                        IET Escalation sheet rates: Materials 4.9/4.0/4.0/4.0% | Contractors 4.9/4.5/4.0/3.5% | EE Internal 4.5/3.8/3.5/3.5% (FY27-FY30)
                      </div>
                    </div>
                  )}

                  {/* TAB: Item details */}
                  {itemTab === "details" && (
                    <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-y border border-gray-100">
                      <div className="p-3 bg-[var(--primary-50)]/60 col-span-2">
                        <div className="text-[10px] text-gray-500 uppercase font-semibold mb-2 border-b pb-1">Pricing (base -- not escalated)</div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <div className="text-[10px] text-gray-400">Base contract price</div>
                            <div className="font-bold text-[var(--primary-800)] text-sm">{fmtPrice(r.base_price)}</div>
                            <div className="text-[10px] text-gray-400">as at {r.price_date||"unknown"}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-gray-400">Single-rate esc.</div>
                            <div className="font-bold text-purple-700 text-sm">{r.esc_rate != null ? (r.esc_rate*100).toFixed(1)+"%" : "--"}</div>
                            <div className="text-[10px] text-gray-400">legacy compound</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-gray-400">Stored escalated cost</div>
                            <div className={`font-bold text-sm ${isStale?"text-amber-700":"text-green-800"}`}>{fmtPrice(esc)}</div>
                            <div className="text-[10px] text-gray-400">
                              {age != null ? `${age.toFixed(1)} yr${age>=2?" old":""}` : "no date set"}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="p-3 col-span-2">
                        <div className="text-[10px] text-gray-500 uppercase font-semibold mb-2 border-b pb-1">Item Details</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                          {[
                            ["Category",        r.category],
                            ["Family/Voltage",   r.family],
                            ["Make",             r.make],
                            ["Model",            r.model],
                            ["Contract No.",     r.contract_no],
                            ["Item No.",         r.item_no],
                            ["Drawing No.",      r.drawing_no],
                            ["Lead Time",        r.lead_weeks ? r.lead_weeks + " weeks" : null],
                            ["Unit",             r.unit],
                          ].filter(([,v]) => v).map(([label, val]) => (
                            <div key={label} className="flex gap-1">
                              <span className="text-gray-400 flex-shrink-0 w-24">{label}:</span>
                              <span className="text-gray-700 font-medium">{val}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {(r.comments || r.price_comments) && (
                        <div className="p-3 col-span-4 bg-amber-50/40">
                          <div className="text-[10px] text-gray-500 uppercase font-semibold mb-1">Comments / Price Notes</div>
                          {r.price_comments && <div className="text-gray-700 mb-1">{r.price_comments}</div>}
                          {r.comments && r.comments !== r.price_comments && <div className="text-gray-500 italic">{r.comments}</div>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB: Edit price (Manager Mode only) */}
                  {itemTab === "edit" && isEd && (
                    <div className="p-3 bg-[var(--primary-50)] border-t-2 border-[var(--primary-400)]">
                      <div className="text-[10px] text-[var(--primary-700)] font-semibold uppercase mb-3">
                        Edit pricing -- enter the actual contract price. Do not pre-escalate.
                      </div>
                      <div className="grid grid-cols-4 gap-3 mb-3">
                        <div>
                          <label className="text-[10px] text-gray-500 block mb-0.5">Base price ($) *</label>
                          <input type="number" step="0.01" value={editVals.base_price}
                            onChange={e=>setEditVals(p=>({...p,base_price:e.target.value}))}
                            className="w-full border-2 border-[var(--primary-400)] rounded px-2 py-1 text-xs focus:outline-none"/>
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 block mb-0.5">Price date *</label>
                          <input type="date" value={editVals.price_date}
                            onChange={e=>setEditVals(p=>({...p,price_date:e.target.value}))}
                            className="w-full border-2 border-[var(--primary-400)] rounded px-2 py-1 text-xs focus:outline-none"/>
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 block mb-0.5">Single-rate esc. % (legacy)</label>
                          <input type="number" step="0.1" min="0" max="50" value={editVals.esc_rate}
                            onChange={e=>setEditVals(p=>({...p,esc_rate:e.target.value}))}
                            className="w-full border-2 border-purple-400 rounded px-2 py-1 text-xs focus:outline-none"/>
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 block mb-0.5">Price notes</label>
                          <input type="text" value={editVals.comments}
                            onChange={e=>setEditVals(p=>({...p,comments:e.target.value}))}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none"/>
                        </div>
                      </div>
                      {editVals.base_price && parseFloat(editVals.base_price) > 0 && (
                        <div className="mb-3 border border-purple-200 rounded bg-white p-2">
                          <div className="text-[10px] font-semibold text-purple-700 mb-2">
                            Escalation preview -- how this new price projects forward
                          </div>
                          <div className="mb-2 p-2 bg-gray-50 border border-gray-100 rounded">
                            <EscStreamSelector streamKey={editEscStream} setStreamKey={setEditEscStream}
                              manualRates={editManualRates} setManualRates={setEditManualRates} compact={true}/>
                          </div>
                          <EscPreviewTable basePrice={parseFloat(editVals.base_price)}
                            streamKey={editEscStream} manualRates={editManualRates} highlightFY={highlightFY}/>
                          <div className="text-[9px] text-gray-400 mt-1">
                            Preview only -- actual engine escalation depends on project timeline.
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button onClick={()=>saveEdit(r.wbs_code)}
                          className="bg-green-700 hover:bg-green-600 text-white text-xs px-4 py-1.5 rounded font-bold">Save Changes</button>
                        <button onClick={()=>setEditingKey(null)}
                          className="border border-gray-300 text-gray-600 text-xs px-3 py-1.5 rounded hover:bg-gray-50">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
            {search ? "No items match search" : "No equipment pricing data"}
          </div>
        )}
      </div>

      {/* Footer */}

      {/* EP: path-choice modal */}
      {epShowAddPath === "path-choice" && (
        <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-96">
            <div className="text-sm font-bold text-gray-800 mb-1">Add equipment item</div>
            <div className="text-xs text-gray-500 mb-4">Does this item map to an existing WBS supply code?</div>
            <div className="flex flex-col gap-2">
              <button onClick={() => setEpShowAddPath("fast")}
                className="flex items-start gap-3 p-3 border-2 border-green-300 rounded-lg hover:bg-green-50 text-left">
                <span className="text-green-600 font-bold text-base mt-0.5">A</span>
                <div>
                  <div className="text-xs font-semibold text-green-800">Yes -- existing WBS code</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">Fast path: add pricing metadata linked to an existing supply row.</div>
                </div>
              </button>
              <button onClick={() => { setEpShowAddPath("wizard"); setEpWizardPrefill({}); }}
                className="flex items-start gap-3 p-3 border-2 border-amber-300 rounded-lg hover:bg-amber-50 text-left">
                <span className="text-amber-600 font-bold text-base mt-0.5">B</span>
                <div>
                  <div className="text-xs font-semibold text-amber-800">No -- needs a new WBS code</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">Wizard: creates Supply, Install and Commission rows with governance PIN gate.</div>
                </div>
              </button>
            </div>
            <button onClick={() => setEpShowAddPath(null)}
              className="mt-4 text-xs text-gray-400 hover:text-gray-600 w-full text-center">Cancel</button>
          </div>
        </div>
      )}
      {epShowAddPath === "fast" && (
        <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl p-5 w-[480px]">
            <div className="text-sm font-bold text-gray-800 mb-2">Add item -- Path A (existing WBS)</div>
            <div className="text-[10px] text-[var(--primary-700)] bg-[var(--primary-50)] border border-[var(--primary-200)] rounded px-2 py-1.5 mb-3">Adds catalogue pricing metadata. Links to an existing supply WBS row. Active immediately.</div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {[["Description *","desc","text"],["Make / Model","make","text"],["WBS Code *","wbs","text"],["Price ($)","price","number"],["Contract No.","contract","text"],["Lead time (wks)","lead","number"]].map(([lbl,key,typ])=>(
                <div key={key}>
                  <label className="text-[10px] text-gray-500 block mb-0.5">{lbl}</label>
                  <input type={typ} min="0" value={epWizardPrefill[key]||""}
                    onChange={e=>setEpWizardPrefill(p=>({...p,[key]:e.target.value}))}
                    className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={()=>setEpShowAddPath(null)} className="text-xs text-gray-500 px-3 py-1.5">Cancel</button>
              <button onClick={()=>{setEpShowAddPath(null);setEpWizardPrefill({});}}
                className="text-xs bg-green-700 hover:bg-green-600 text-white px-4 py-1.5 rounded font-bold">Add to Pricing</button>
            </div>
          </div>
        </div>
      )}
      {epShowAddPath === "wizard" && (
        <WBSWizard
          onClose={()=>setEpShowAddPath(null)}
          prefill={epWizardPrefill}
          existingCodes={new Set(Object.keys(basePricing))}
          onSave={()=>setEpShowAddPath(null)}
        />
      )}
      <div className="flex-shrink-0 border-t bg-gray-50 px-3 py-1.5 flex items-center gap-4 text-[10px] text-gray-500 flex-wrap">
        <span><span className="bg-[var(--primary-100)] text-[var(--primary-800)] px-1 rounded font-semibold border border-[var(--primary-200)]">PCE</span> Period Contract</span>
        <span><span className="bg-purple-100 text-purple-800 px-1 rounded font-semibold border border-purple-200">SCADA</span> SCADA BOM</span>
        <span><span className="bg-teal-100 text-teal-800 px-1 rounded font-semibold border border-teal-200">Comms</span> Comms Price List</span>
        <span className="text-amber-700">Amber = &gt;2yr old</span>
        <span className="text-gray-400">Hist = price history | Esc = escalation preview</span>
        {editedCount > 0 && (
          <span className="ml-auto text-orange-600 font-semibold">{editedCount} prices edited this session -- raise WBS governance change for permanent update</span>
        )}
      </div>
    </div>
  );
}


function EquipmentCatalogueManager({ equipSel, setEquipSel }) {
  const { equipment, supply, wbs: wbsMaster, loading } = useData();
  const [typeFilter, setTypeFilter] = useState("All");
  const [catFilter,  setCatFilter]  = useState("All");
  const [search,     setSearch]     = useState("");
  const [editing,    setEditing]    = useState(null);
  const [editVals,   setEditVals]   = useState({});
  const [showAdd,    setShowAdd]    = useState(false);
  const [showAddPath, setShowAddPath] = useState(null); // null | "path-choice" | "fast" | "wizard"
  const [wizardPrefill, setWizardPrefill] = useState(null);
  const [localItems, setLocalItems] = useState(null);

  // ── PIN-locked Manager Mode ──────────────────────────────────
  const MANAGER_PIN    = "1607";
  const [managerMode,  setManagerMode]  = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput,     setPinInput]     = useState("");
  const [pinError,     setPinError]     = useState(false);
  const pinRef = useRef(null);
  const tryUnlock = () => {
    if (pinInput === MANAGER_PIN) {
      setManagerMode(true); setShowPinModal(false);
      setPinInput(""); setPinError(false);
    } else {
      setPinError(true); setPinInput("");
      setTimeout(() => setPinError(false), 2000);
    }
  };

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
  const wbsVal         = newItem.wbs_code.trim();
  const wbsInCatalogue = wbsVal && usedWbsCodes.has(wbsVal);
  const wbsInSupply    = wbsVal && supplyWbsCodes.has(wbsVal);
  // Also check wbsMaster (WBS item editor list) for existence
  const wbsInMaster    = wbsVal && (wbsMaster||[]).some(w => w.wbs_code === wbsVal);
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

      {/* ── PIN Modal ── */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background:"rgba(0,0,0,0.45)"}}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-80">
            <div className="text-sm font-bold text-gray-900 mb-1">Manager Mode</div>
            <div className="text-xs text-gray-500 mb-4">Enter PIN to enable editing and adding items</div>
            <input ref={pinRef} type="password" value={pinInput}
              onChange={e=>setPinInput(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter") tryUnlock(); if(e.key==="Escape") setShowPinModal(false); }}
              autoFocus placeholder="Enter PIN"
              className={`w-full border-2 rounded px-3 py-2 text-sm text-center font-mono tracking-widest focus:outline-none mb-3 ${pinError?"border-red-400 bg-red-50 animate-pulse":"border-gray-300 focus:border-[var(--primary-400)]"}`}/>
            {pinError && <div className="text-xs text-red-600 text-center mb-2">Incorrect PIN</div>}
            <div className="flex gap-2">
              <button onClick={()=>{setShowPinModal(false);setPinInput("");}} className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={tryUnlock} className="flex-1 bg-[var(--primary-700)] hover:bg-[var(--primary-600)] text-white rounded px-3 py-1.5 text-xs font-semibold">Unlock</button>
            </div>
          </div>
        </div>
      )}
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
          {managerMode ? (
            <>
              <button onClick={() => setShowAddPath("path-choice")}
                className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded font-semibold">
                + Add Item
              </button>
              <span className="text-xs bg-orange-100 text-orange-700 border border-orange-300 px-3 py-1.5 rounded font-semibold flex items-center gap-1.5">
                🔓 Manager Mode
              </span>
            </>
          ) : (
            <button onClick={() => setShowPinModal(true)}
              className="text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded flex items-center gap-1.5">
              🔒 Manager Mode
            </button>
          )}
        </div>

        {/* Add new item form */}
        {/* ── Add Item: path-choice modal ── */}
        {showAddPath === "path-choice" && (
          <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-96">
              <div className="text-sm font-bold text-gray-800 mb-1">Add equipment item</div>
              <div className="text-xs text-gray-500 mb-4">Does this item map to an existing WBS supply code?</div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setShowAddPath("fast")}
                  className="flex items-start gap-3 p-3 border-2 border-green-300 rounded-lg hover:bg-green-50 text-left">
                  <span className="text-green-600 text-lg mt-0.5">A</span>
                  <div>
                    <div className="text-xs font-semibold text-green-800">Yes -- existing WBS code</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">Fast path: add catalogue metadata and link to existing supply WBS row. No governance needed -- item is live immediately.</div>
                  </div>
                </button>
                <button
                  onClick={() => { setShowAddPath("wizard"); setWizardPrefill(null); }}
                  className="flex items-start gap-3 p-3 border-2 border-amber-300 rounded-lg hover:bg-amber-50 text-left">
                  <span className="text-amber-600 text-lg mt-0.5">B</span>
                  <div>
                    <div className="text-xs font-semibold text-amber-800">No -- needs a new WBS code</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">Wizard path: creates Supply, Install and Commission WBS rows with governance PIN gate. Item saved as Pending Governance.</div>
                  </div>
                </button>
              </div>
              <button onClick={() => setShowAddPath(null)}
                className="mt-4 text-xs text-gray-400 hover:text-gray-600 w-full text-center">Cancel</button>
            </div>
          </div>
        )}

        {/* ── Add Item: Path A fast form (existing WBS) ── */}
        {showAddPath === "fast" && (
          <div className="bg-green-50 border-b border-green-200 px-4 py-3 flex-shrink-0">
            <div className="text-xs font-bold text-green-800 mb-2 uppercase tracking-wide flex items-center gap-2">
              Path A -- Add Equipment Item (existing WBS)
              <span className="text-[10px] font-normal normal-case text-green-600">Links to an existing supply row</span>
            </div>
            <div className="grid grid-cols-6 gap-2 items-end">
              <div className="col-span-2">
                <label className="text-xs text-gray-500 block mb-0.5">Description *</label>
                <input value={newItem.description} onChange={e => setNewItem(p => ({...p, description:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"/>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Type</label>
                <select value={newItem.type} onChange={e => setNewItem(p => ({...p, type:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none">
                  {["PCE","SCADA","COMMS","LLT"].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Category</label>
                <select value={newItem.category} onChange={e => setNewItem(p => ({...p, category:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none">
                  {filteredCategories.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Make / Part No.</label>
                <input value={newItem.make_model} onChange={e => setNewItem(p => ({...p, make_model:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none"/>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">WBS Code (existing) *</label>
                <input value={newItem.wbs_code} onChange={e => setNewItem(p => ({...p, wbs_code:e.target.value}))}
                  placeholder="3.1.3.04.1.01"
                  className={`w-full border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 ${
                    wbsInCatalogue ? "border-red-400 bg-red-50" : wbsInSupply ? "border-green-400 bg-green-50" : "focus:ring-green-400"
                  }`}/>
                {wbsInCatalogue && <div className="text-[10px] text-red-600 mt-0.5">Already in catalogue</div>}
                {wbsInSupply && !wbsInCatalogue && <div className="text-[10px] text-green-700 mt-0.5">Found in supply items</div>}
                {!wbsInSupply && !wbsInCatalogue && newItem.wbs_code && (
                  <div className="text-[10px] text-amber-700 mt-0.5">
                    Not found in supply -- use Path B wizard to create WBS rows first.
                    <button onClick={() => { setWizardPrefill({description:newItem.description,make_model:newItem.make_model,price:newItem.price}); setShowAddPath("wizard"); }}
                      className="ml-1 underline text-[var(--primary-600)]">Switch to wizard</button>
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Price ($)</label>
                <input type="number" min="0" step="0.01" value={newItem.price}
                  onChange={e => setNewItem(p => ({...p, price:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none"/>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Lead time (wks)</label>
                <input type="number" min="0" value={newItem.lead_time_weeks}
                  onChange={e => setNewItem(p => ({...p, lead_time_weeks:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none"/>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Contract No.</label>
                <input value={newItem.contract_no || ""} onChange={e => setNewItem(p => ({...p, contract_no:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none"/>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500 block mb-0.5">Comments</label>
                <input value={newItem.comments} onChange={e => setNewItem(p => ({...p, comments:e.target.value}))}
                  className="w-full border rounded px-2 py-1 text-xs focus:outline-none"/>
              </div>
            </div>
            <div className="mt-2 flex gap-2 items-center">
              <button onClick={addNewItem}
                disabled={!newItem.description.trim() || wbsInCatalogue}
                className="text-xs bg-green-700 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded font-bold">
                Add to Catalogue
              </button>
              <button onClick={() => setShowAddPath(null)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
              <span className="text-[10px] text-gray-400 ml-2">Need a new WBS code?</span>
              <button onClick={() => { setWizardPrefill({description:newItem.description,make_model:newItem.make_model,price:newItem.price}); setShowAddPath("wizard"); }}
                className="text-[10px] text-amber-700 border border-amber-300 hover:bg-amber-50 rounded px-2 py-0.5">Use wizard (Path B)</button>
            </div>
          </div>
        )}

        {/* ── Add Item: Path B WBS wizard ── */}
        {showAddPath === "wizard" && (
          <WBSWizard
            onClose={() => setShowAddPath(null)}
            prefill={wizardPrefill}
            existingCodes={usedWbsCodes}
            onSave={(entries) => {
              // After wizard creates WBS rows, auto-open fast form pre-filled
              const firstEntry = entries[0];
              setNewItem(p => ({
                ...p,
                description: wizardPrefill?.description || firstEntry.description || "",
                make_model:  wizardPrefill?.make_model || "",
                price:       wizardPrefill?.price || "",
                wbs_code:    firstEntry.wbs_code || "",
              }));
              setShowAddPath("fast");
            }}
          />
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
                <th className="text-center px-2 py-2 font-semibold text-[var(--primary-500)] w-16" title="WBS linkage to supply items and WBS Master">Linked</th>
                <th className="text-center px-2 py-2 font-semibold text-gray-400 w-14">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => {
                const isEd = editing === item.id;
                const tc   = TYPE_COLORS[item.type] || {badge:"bg-gray-100 text-gray-500", icon:"•"};
                return (
                  <tr key={item.id}
                    className={`border-b transition-colors ${idx%2===0?"bg-white":"bg-gray-50"} hover:bg-[var(--primary-50)]`}>
                    <td className="px-2 py-1.5">
                      <span className={`text-xs px-1 py-0.5 rounded font-medium ${tc.badge}`}>{tc.icon}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      {isEd
                        ? <input value={editVals.wbs_code} onChange={e => setEditVals(p => ({...p, wbs_code:e.target.value}))}
                            className="w-full border border-[var(--primary-300)] rounded px-1 py-0.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                        : <span className="font-mono text-[var(--primary-600)]">{item.wbs_code || <span className="text-orange-400 italic">TBA</span>}</span>
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
                          : <span className="font-semibold text-gray-800">
      ${(item.price||0).toLocaleString("en-AU")}
      {item._priceFromEquipPricing && <span className="ml-1 text-[9px] text-orange-600" title="Price updated from Equipment Pricing this session">⚡</span>}
    </span>
                      }
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {(() => {
                        const wc = item.wbs_code;
                        const inSupply = wc && supplyWbsCodes.has(wc);
                        const inMaster = wc && (wbsMaster||[]).some(w => w.wbs_code === wc);
                        if (!wc) return managerMode ? (
                          <button onClick={() => { setWizardPrefill({description:item.description,make_model:item.make_model,price:item.price}); setShowAddPath("wizard"); }}
                            className="text-[10px] text-amber-700 border border-amber-300 hover:bg-amber-50 rounded px-1.5 py-0.5 font-semibold">+ Create WBS</button>
                        ) : <span className="text-gray-300 text-[10px]" title="No WBS code set">—</span>;
                        if (inSupply && inMaster) return (
                          <span className="bg-green-100 text-green-700 border border-green-300 rounded px-1 py-0.5 text-[10px] font-semibold" title="WBS code found in supply items and WBS Master — will appear in Estimation Tool">✓ Live</span>
                        );
                        if (inMaster && !inSupply) return (
                          <span className="bg-[var(--primary-100)] text-[var(--primary-700)] border border-[var(--primary-300)] rounded px-1 py-0.5 text-[10px] font-semibold" title="WBS code in WBS Master but not in supply — may not appear in estimation">WBS only</span>
                        );
                        if (inSupply && !inMaster) return (
                          <span className="bg-amber-100 text-amber-700 border border-amber-300 rounded px-1 py-0.5 text-[10px] font-semibold" title="WBS code in supply items — will show in estimation but not in WBS master list">Supply</span>
                        );
                        return <span className="bg-red-100 text-red-600 border border-red-200 rounded px-1 py-0.5 text-[10px] font-semibold" title="WBS code not found in supply items or WBS Master — item will not link to estimation tool">Unlinked</span>;
                      })()}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {isEd ? (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => saveEdit(item.id)}
                            className="bg-[var(--primary-700)] hover:bg-[var(--primary-600)] text-white px-1.5 py-0.5 rounded text-[10px] font-semibold">Save</button>
                          <button onClick={() => setEditing(null)}
                            className="border border-gray-300 text-gray-600 hover:bg-gray-50 px-1.5 py-0.5 rounded text-[10px]">✕</button>
                        </div>
                      ) : (
                        managerMode
                          ? <button onClick={() => startEdit(item)} className="text-[var(--primary-500)] hover:text-[var(--primary-700)] text-[10px] border border-[var(--primary-200)] hover:border-[var(--primary-400)] px-1.5 py-0.5 rounded">Edit</button>
                          : <span className="text-gray-300 text-[10px]" title="Unlock Manager Mode to edit">🔒</span>
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

const defaultInv = {
  name:"Marulan 132kV 3-Way Switching Station", number:"10007569",
  wacs:"N/A", type:"Commercially Funded", estClass:"Class 4", revision:"A",
  milestones:[
    {stage:"Acceptance of offer and commencement of works", month:"1",  pct:"15"},
    {stage:"Long lead-time equipment ordered",              month:"4",  pct:"35"},
    {stage:"Design completed, sub-contract works awarded",  month:"10", pct:"45"},
    {stage:"Construction works 100% completed",             month:"15", pct:"5"},
    {stage:"",                                              month:"",   pct:"0"},
  ],
  complexity:"High", newTech:"Moderate", estimatedBy:"Steven Hannigan",
  reviewedBy:"Daniel Lawrence", startMonth:"Jul", startYear:"2025",
  planStart:"1", planDur:"4", designStart:"1", designDur:"9",
  constrStart:"6", constrDur:"15", contInt:"10", contComm:"10",
  contIntDollar:"", contCommDollar:"",
};

// ── CART — CONTINGENCY & ACCURACY RANGE TOOL (Monte Carlo) ──────
// Replaces the XLSTAT-driven CART workbook. Systemic risk tables are
// AACE-derived (Class × Complexity × New Technology) — values lifted
// verbatim from the CART workbook 'Systemic Risk Tables' sheet.
// Order of axes: [estClass][newTech][complexity]
const CART_SYS = {
  // P50 portion — relative to Base Estimate
  p50: {
    "Class 1": { Limited:{Medium:.003, High:.012, "Very High":.0195}, Moderate:{Medium:.003, High:.012, "Very High":.0195}, Substantial:{Medium:.009, High:.0165,"Very High":.0285} },
    "Class 2": { Limited:{Medium:.009, High:.0165,"Very High":.0285}, Moderate:{Medium:.007, High:.028, "Very High":.0455}, Substantial:{Medium:.021, High:.0385,"Very High":.0665} },
    "Class 3": { Limited:{Medium:.005, High:.02,  "Very High":.03  }, Moderate:{Medium:.01,  High:.04,  "Very High":.065 }, Substantial:{Medium:.03,  High:.055, "Very High":.095 } },
    "Class 4": { Limited:{Medium:.03,  High:.055, "Very High":.095 }, Moderate:{Medium:.05,  High:.08,  "Very High":.11  }, Substantial:{Medium:.07,  High:.10,  "Very High":.135 } },
    "Class 5": { Limited:{Medium:.05,  High:.08,  "Very High":.11  }, Moderate:{Medium:.07,  High:.10,  "Very High":.135 }, Substantial:{Medium:.125, High:.15,  "Very High":.21  } },
  },
  // P10 portion — relative to (Base + P50 portion)
  p10: {
    "Class 1": { Limited:{Medium:-.0045,High:-.0135,"Very High":-.021 }, Moderate:{Medium:-.0045,High:-.0135,"Very High":-.021 }, Substantial:{Medium:-.0105,High:-.018, "Very High":-.0285} },
    "Class 2": { Limited:{Medium:-.0105,High:-.018, "Very High":-.0285}, Moderate:{Medium:-.0105,High:-.0315,"Very High":-.049 }, Substantial:{Medium:-.0245,High:-.042, "Very High":-.0665} },
    "Class 3": { Limited:{Medium:-.005, High:-.015, "Very High":-.035 }, Moderate:{Medium:-.015, High:-.045, "Very High":-.07  }, Substantial:{Medium:-.035, High:-.06,  "Very High":-.095 } },
    "Class 4": { Limited:{Medium:-.035, High:-.06,  "Very High":-.095 }, Moderate:{Medium:-.06,  High:-.085, "Very High":-.11  }, Substantial:{Medium:-.075, High:-.105, "Very High":-.13  } },
    "Class 5": { Limited:{Medium:-.06,  High:-.085, "Very High":-.11  }, Moderate:{Medium:-.075, High:-.105, "Very High":-.13  }, Substantial:{Medium:-.125, High:-.14,  "Very High":-.175 } },
  },
  // P90 portion — relative to (Base + P50 portion)
  p90: {
    "Class 1": { Limited:{Medium:.0045,High:.0165,"Very High":.03  }, Moderate:{Medium:.0045,High:.0165,"Very High":.03  }, Substantial:{Medium:.012, High:.024, "Very High":.0465} },
    "Class 2": { Limited:{Medium:.012, High:.024, "Very High":.0465}, Moderate:{Medium:.0105,High:.0385,"Very High":.07  }, Substantial:{Medium:.028, High:.056, "Very High":.1085} },
    "Class 3": { Limited:{Medium:.01,  High:.04,  "Very High":.06  }, Moderate:{Medium:.015, High:.055, "Very High":.1   }, Substantial:{Medium:.04,  High:.08,  "Very High":.155 } },
    "Class 4": { Limited:{Medium:.04,  High:.08,  "Very High":.155 }, Moderate:{Medium:.075, High:.13,  "Very High":.2   }, Substantial:{Medium:.11,  High:.175, "Very High":.265 } },
    "Class 5": { Limited:{Medium:.075, High:.13,  "Very High":.2   }, Moderate:{Medium:.11,  High:.175, "Very High":.265 }, Substantial:{Medium:.16,  High:.24,  "Very High":.37  } },
  },
};

// Residual likelihood matrix — verbatim from CART 'Project Specific' sheet
const CART_LIKELIHOOD = [
  { cat:"Rare (< 5%)",           low:0.01, ml:0.025, high:0.04 },
  { cat:"Unlikely (5 - 33%)",    low:0.05, ml:0.19,  high:0.33 },
  { cat:"Possible (34 - 66%)",   low:0.34, ml:0.50,  high:0.66 },
  { cat:"Likely (67 - 95%)",     low:0.67, ml:0.81,  high:0.95 },
  { cat:"Almost Certain (> 95%)",low:0.96, ml:0.975, high:0.99 },
];

const CART_DEFAULT_SETTINGS = {
  iterations: 10000,        // @RISK / CART workbook default
  seed: 1607,               // locked seed — reproducible runs
  sampling: "lhs",          // Latin Hypercube (CART workbook / @RISK / PRA convention)
  boundsMode: "percentile", // best/worst treated as P10/P90 (exact fit) vs absolute min/max
  occurrence: "expected",   // likelihood × impact each iteration (CART) vs Bernoulli event sim
  modeConvention: "pertMean", // distribution mode = (best+4×ML+worst)/6 (CART) vs Most Likely
  floorAtZero: true,        // EE Nominal — reported P-values floored at $0
  truncateSystemic: false,  // clamp systemic under-run (negative draws) at $0
  bins: 50,                 // histogram intervals (CART workbook: 50)
};
const CART_SETTINGS_KEY = "iet_cart_settings";
function loadCartSettings(){
  try {
    const raw = localStorage.getItem(CART_SETTINGS_KEY);
    if (raw) return { ...CART_DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* defaults */ }
  return { ...CART_DEFAULT_SETTINGS };
}

// ── CART numerical engine ────────────────────────────────────────
function cartRng(seed){ let a=seed>>>0; return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function cartLogGamma(x){ const c=[76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5]; let y=x,tmp=x+5.5; tmp-=(x+0.5)*Math.log(tmp); let ser=1.000000000190015; for(let j=0;j<6;j++) ser+=c[j]/++y; return -tmp+Math.log(2.5066282746310005*ser/x); }
function cartBetacf(a,b,x){ const MAXIT=200,EPS=3e-12,FPMIN=1e-300; const qab=a+b,qap=a+1,qam=a-1; let c=1,d=1-qab*x/qap; if(Math.abs(d)<FPMIN)d=FPMIN; d=1/d; let h=d; for(let m=1;m<=MAXIT;m++){ const m2=2*m; let aa=m*(b-m)*x/((qam+m2)*(a+m2)); d=1+aa*d; if(Math.abs(d)<FPMIN)d=FPMIN; c=1+aa/c; if(Math.abs(c)<FPMIN)c=FPMIN; d=1/d; h*=d*c; aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2)); d=1+aa*d; if(Math.abs(d)<FPMIN)d=FPMIN; c=1+aa/c; if(Math.abs(c)<FPMIN)c=FPMIN; d=1/d; const del=d*c; h*=del; if(Math.abs(del-1)<EPS)break; } return h; }
function cartBetaCDF(x,a,b){ if(x<=0)return 0; if(x>=1)return 1; const bt=Math.exp(cartLogGamma(a+b)-cartLogGamma(a)-cartLogGamma(b)+a*Math.log(x)+b*Math.log(1-x)); return x<(a+1)/(a+b+2) ? bt*cartBetacf(a,b,x)/a : 1-bt*cartBetacf(b,a,1-x)/b; }
function cartBetaInv(p,a,b){ let lo=0,hi=1; for(let i=0;i<80;i++){ const mid=(lo+hi)/2; if(cartBetaCDF(mid,a,b)<p) lo=mid; else hi=mid; } return (lo+hi)/2; }
function cartPertAB(a,m,b){ return [1+4*(m-a)/(b-a), 1+4*(b-m)/(b-a)]; }
function cartPertQuantile(p,a,m,b){ const [al,be]=cartPertAB(a,m,b); return a+(b-a)*cartBetaInv(p,al,be); }
// Solve PERT bounds so the 10th/90th percentiles land exactly on q10/q90
// (the CART workbook's XLSTAT fit attempts this but lands wide — see Help)
function cartSolveBounds(q10,mode,q90){
  if(!(q10<mode && mode<q90)){
    const span=Math.max(Math.abs(q90-q10),Math.abs(mode)||1,1);
    return [Math.min(q10,mode)-span*1e-6, Math.max(q90,mode)+span*1e-6];
  }
  let a=mode-2*(mode-q10), b=mode+2*(q90-mode);
  for(let i=0;i<60;i++){
    const c10=cartPertQuantile(0.10,a,mode,b), c90=cartPertQuantile(0.90,a,mode,b);
    const da=q10-c10, db=q90-c90;
    a+=da*1.2; b+=db*1.2;
    if(a>=mode) a=mode-(q90-q10)*1e-4;
    if(b<=mode) b=mode+(q90-q10)*1e-4;
    if(Math.abs(da)<(q90-q10)*1e-7 && Math.abs(db)<(q90-q10)*1e-7) break;
  }
  return [a,b];
}
function cartInvGrid(a,m,b,pts=1025){
  if(!(a<m && m<b)){ const v=(a+b)/2; return ()=>v; }
  const [al,be]=cartPertAB(a,m,b);
  const cdf=new Float64Array(pts), xs=new Float64Array(pts);
  for(let i=0;i<pts;i++){ const x=i/(pts-1); xs[i]=a+(b-a)*x; cdf[i]=cartBetaCDF(x,al,be); }
  return u=>{ let lo=0,hi=pts-1; while(hi-lo>1){ const mid=(lo+hi)>>1; if(cdf[mid]<u) lo=mid; else hi=mid; } const c0=cdf[lo],c1=cdf[hi]; const t=c1>c0?(u-c0)/(c1-c0):0; return xs[lo]+(xs[hi]-xs[lo])*t; };
}
function cartLhsU(n,rng){ const u=new Float64Array(n); for(let i=0;i<n;i++) u[i]=(i+rng())/n; for(let i=n-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); const t=u[i]; u[i]=u[j]; u[j]=t; } return u; }

function cartSystemicParams(base, estClass, complexity, newTech){
  const get=(tbl)=>((CART_SYS[tbl][estClass]||CART_SYS[tbl]["Class 5"])[newTech]||{})[complexity];
  const t50=get("p50")??0.10, t10=get("p10")??-0.10, t90=get("p90")??0.18;
  const p50c=base*t50;
  const p10c=(base+p50c)*(1+t10)-base;
  const p90c=(base+p50c)*(1+t90)-base;
  return { t10,t50,t90, p10c,p50c,p90c };
}

function cartRun(base, systemic, risks, S){
  const rng=cartRng(S.seed||1);
  const N=Math.max(100,Math.min(100000,S.iterations||10000));
  const draw=(inv)=>{ const u=S.sampling==="lhs"?cartLhsU(N,rng):Float64Array.from({length:N},()=>rng()); const out=new Float64Array(N); for(let i=0;i<N;i++) out[i]=inv(Math.min(Math.max(u[i],1e-9),1-1e-9)); return out; };
  // Systemic — assumed to occur (likelihood = 1)
  const [sa,sb]=S.boundsMode==="percentile"?cartSolveBounds(systemic.p10c,systemic.p50c,systemic.p90c):[Math.min(systemic.p10c,systemic.p50c),Math.max(systemic.p90c,systemic.p50c)];
  const sysDraws=draw(cartInvGrid(sa,systemic.p50c,sb));
  if(S.truncateSystemic) for(let i=0;i<N;i++) if(sysDraws[i]<0) sysDraws[i]=0;
  const riskDraws=risks.map(r=>{
    const mode=S.modeConvention==="pertMean"?(r.best+4*r.ml+r.worst)/6:r.ml;
    const [a,b]=S.boundsMode==="percentile"?cartSolveBounds(r.best,mode,r.worst):[r.best,r.worst];
    const lk=CART_LIKELIHOOD.find(l=>l.cat===r.likCat)||CART_LIKELIHOOD[3];
    return {
      imp: draw(cartInvGrid(a,mode,b)),
      lik: draw(cartInvGrid(lk.low,lk.ml,lk.high)),       // absolute bounds, per workbook
      occ: S.occurrence==="bernoulli"?draw(u=>u):null,    // uniform occurrence draws
    };
  });
  const totals=new Float64Array(N);
  for(let i=0;i<N;i++){
    let t=sysDraws[i];
    for(const rd of riskDraws){
      if(S.occurrence==="bernoulli"){ if(rd.occ[i]<rd.lik[i]) t+=rd.imp[i]; }
      else t+=rd.lik[i]*rd.imp[i];
    }
    totals[i]=t;
  }
  const sorted=Array.from(totals).sort((x,y)=>x-y);
  const q=p=>sorted[Math.min(N-1,Math.max(0,Math.round(p*(N-1))))];
  const mean=sorted.reduce((a,x)=>a+x,0)/N;
  const sd=Math.sqrt(sorted.reduce((a,x)=>a+(x-mean)*(x-mean),0)/(N-1));
  // Histogram
  const bins=Math.max(10,Math.min(100,S.bins||50));
  const lo=sorted[0], hi=sorted[N-1], w=(hi-lo)/bins||1;
  const hist=new Array(bins).fill(0);
  for(const x of sorted){ let k=Math.floor((x-lo)/w); if(k>=bins)k=bins-1; if(k<0)k=0; hist[k]++; }
  // Contribution shares (deterministic expected value per risk, like the workbook)
  const contrib=[{name:"Systemic",val:systemic.p50c}];
  risks.forEach(r=>{ const lk=CART_LIKELIHOOD.find(l=>l.cat===r.likCat)||CART_LIKELIHOOD[3]; contrib.push({name:(r.id?r.id+" — ":"")+(r.desc||"Risk"), val:lk.ml*((r.best+4*r.ml+r.worst)/6)}); });
  const contribTotal=contrib.reduce((a,c)=>a+c.val,0)||1;
  contrib.forEach(c=>{ c.pct=c.val/contribTotal; });
  const raw={p10:q(0.10),p50:q(0.50),p80:q(0.80),p90:q(0.90)};
  const flo=v=>S.floorAtZero?Math.max(0,v):v;
  return {
    N, seed:S.seed, raw, mean, sd,
    p10:flo(raw.p10), p50:flo(raw.p50), p80:flo(raw.p80), p90:flo(raw.p90),
    floored:S.floorAtZero&&(raw.p10<0||raw.p50<0),
    hist:{counts:hist,lo,hi,w}, sorted, contrib,
    deterministic: systemic.p50c + risks.reduce((a,r)=>{ const lk=CART_LIKELIHOOD.find(l=>l.cat===r.likCat)||CART_LIKELIHOOD[3]; return a+lk.ml*r.ml; },0),
    sysBounds:[sa,sb],
  };
}

// ── CART help content (searchable) ───────────────────────────────
const CART_HELP = [
  { id:"overview", title:"1. What is CART?", body:[
    "CART (Contingency and Accuracy Range Tool) sizes the contingency allowance for an estimate's Base Cost using Monte Carlo simulation. It replaces the Excel CART workbook that required an XLSTAT licence — the simulation now runs directly in the browser in under a second, with no add-in, no macro reset procedure and no manual histogram steps.",
    "The Base Estimate is the cost estimate excluding contingency and escalation. CART combines two sources of uncertainty on top of it: systemic risk (estimate-wide uncertainty driven by estimate class, complexity and use of new technology) and project-specific risks (discrete events from the Project Risk Register).",
    "The output is a probability distribution of total contingency, reported as P-values: P10, P50, P80 and P90.",
  ]},
  { id:"when", title:"2. When to run CART", body:[
    "Run CART after the estimate is complete: all quantities entered, reviewed, and the Base Estimate stable. Contingency is sized against the finished base — running it against a half-built estimate produces meaningless P-values.",
    "Only include project-specific risks that remain rated High or Very High AFTER mitigating controls have been applied (residual risk). Risks mitigated down to Medium or below are considered absorbed by systemic uncertainty and must not be double-counted in the register.",
    "When an estimate is cloned or promoted (Class 5 → 4 → 3), the risk register travels with it. Re-run the simulation on the new revision — the systemic ranges automatically tighten as the estimate class improves.",
  ]},
  { id:"register", title:"3. The risk register", body:[
    "Each risk needs: an ID and description (taken from the Project Risk Register), the residual likelihood category, and a three-point cost impact — Realistic Best Case, Most Likely Case and Realistic Worst Case.",
    "Only High and Very High residual risks belong in CART. The register enforces this with the rating field.",
    "A High or Very High residual risk cannot plausibly carry a Rare or Unlikely likelihood — the tool will warn if this combination is selected, mirroring the validation note in the CART workbook.",
    "The cost impact range should represent the cost if the risk occurs, not the expected (probability-weighted) cost — the simulation applies the likelihood itself.",
    "Incomplete risks are excluded from the run, not blocked: a risk needs a Worst case greater than zero and Best ≤ Most Likely ≤ Worst to be simulated. The run bar shows how many risks were excluded — check it before accepting results.",
    "Rate streams: the Base Estimate follows the investment's rate stream (EE Internal or Commercial with ANS), and the systemic component scales with it automatically. Risk cost impacts, however, are entered as plain dollars and are NOT converted between streams — when estimating a commercially funded investment, enter risk impacts at the rates the risk would actually be incurred at. This matches the CART workbook convention, where the same risk register was reused across the Internal and Commercial versions of an estimate.",
  ]},
  { id:"likelihood", title:"4. Residual likelihood matrix", body:[
    "Likelihood categories map to probability ranges sampled in the simulation (low / most likely / high): Rare 0.01 / 0.025 / 0.04 · Unlikely 0.05 / 0.19 / 0.33 · Possible 0.34 / 0.50 / 0.66 · Likely 0.67 / 0.81 / 0.95 · Almost Certain 0.96 / 0.975 / 0.99.",
    "The probability itself is uncertain, so each iteration samples a likelihood from a PERT distribution across the category's range, then multiplies it by the sampled cost impact (in the default Expected Value model).",
  ]},
  { id:"systemic", title:"5. Systemic risk", body:[
    "Systemic risk represents estimate-wide uncertainty that exists regardless of any specific risk event — it is assumed to occur (probability 1.0). Its range comes from an AACE-derived lookup keyed on three Investment Setup fields: Estimate Class, Complexity, and Use of New Technology.",
    "The table produces three multipliers: a P50 portion relative to the Base Estimate, and P10/P90 portions relative to (Base + P50 portion). For example, Class 4 / Very High complexity / Moderate new technology yields multipliers of -0.11 / +0.11 / +0.20 — meaning a project that is on the P50 systemic track could still come in up to 11% under or 20% over.",
    "Note the P10 portion is usually negative: at 10% confidence the estimate may underrun the base. This is the source of negative P10 contingency values — see section 9.",
  ]},
  { id:"engine", title:"6. The simulation engine", body:[
    "Sampling: Latin Hypercube by default (matching the CART workbook, @RISK and Primavera Risk Analysis), which stratifies each distribution so the tails are properly covered without needing extreme iteration counts. Plain Monte Carlo random sampling is available in Settings.",
    "Iterations: 10,000 by default — the CART workbook setting and the @RISK default; industry guidance for cost risk is 5,000–10,000 for stable tails. The seed is locked (default 1607) so every run with the same inputs reproduces the same result, which matters for review and audit.",
    "Distributions: every cost impact and likelihood is a PERT (Beta-PERT) distribution. Cost impacts treat Best/Worst as the P10/P90 of the distribution by default, with bounds solved numerically so those percentiles land exactly. Likelihoods use the category range as absolute bounds, matching the workbook.",
    "Each iteration computes: Total Contingency = Systemic draw + Σ (likelihood draw × impact draw) across all risks. P-values are read directly off the sorted simulation results.",
  ]},
  { id:"settings", title:"7. Settings reference", body:[
    "Iterations — number of simulated outcomes. More iterations = smoother tails, slightly slower. 10,000 is the nominal setting.",
    "Random seed — locks the random number stream. Identical inputs + identical seed = identical results. Change it only to test stability.",
    "Sampling — Latin Hypercube (recommended) or plain random Monte Carlo.",
    "Best/Worst interpretation — 'P10/P90 percentiles (exact fit)' solves the distribution so 10% of outcomes fall below Best and 10% above Worst. 'Absolute Min/Max' treats them as hard limits, producing a narrower distribution.",
    "Risk occurrence model — 'Expected value (CART)' multiplies sampled likelihood by sampled impact every iteration, matching the workbook. 'Bernoulli event simulation' rolls the dice: the risk either fully occurs or doesn't in each iteration (the @RISK risk-register convention). Bernoulli produces wider, lumpier distributions.",
    "Distribution mode — 'PERT mean (CART)' centres each impact distribution on (Best + 4×Most Likely + Worst) / 6, matching the workbook. 'Most Likely' centres it on the Most Likely value directly.",
    "Floor reported P-values at $0 — the EE Nominal setting. The raw simulated value is always shown alongside; flooring only affects the reported figure.",
    "Truncate systemic underrun — clamps negative systemic draws at $0 inside the simulation. This shifts the whole distribution up and is OFF by default; prefer the reporting floor.",
  ]},
  { id:"results", title:"8. Interpreting results", body:[
    "P50 is the median: a 50% chance contingency will be sufficient. P80 is more conservative and is a common funding benchmark; P90 is often used to inform management reserve on top of contingency.",
    "Base + Contingency at each P-value gives the probabilistic project cost. These values exclude escalation and forex, which are applied separately downstream.",
    "The histogram shows the shape of simulated contingency; the S-curve shows cumulative probability — read across from any confidence level to the contingency it requires.",
    "The contribution chart ranks the systemic component and each risk by expected-value share of total contingency, the same measure as the workbook's Contribution chart. Use it to target further mitigation.",
    "Results do not auto-refresh. If the estimate, the risk register, the systemic inputs or any setting changes after a run, an amber 'Inputs changed since last run — re-run' flag appears next to the Run button and the displayed results should be treated as superseded until the simulation is re-run.",
  ]},
  { id:"negative", title:"9. Why P10 can be negative — and what to do", body:[
    "A negative P10 contingency means that at 10% confidence the project comes in under the Base Estimate. Mathematically valid — the systemic P10 multiplier is negative for every class — but it reads poorly in funding submissions.",
    "Validation against six completed CART workbooks (Kings Plains 132kV and 66kV in both Internal and Commercial rate streams, and Honeymoon Mine Internal and Commercial — bases from $0.25M to $17.6M) found every workbook reported a negative P10, and in every case XLSTAT's distribution fitting delivered a systemic P10 roughly 4× the target: e.g. Kings Plains 132kV Commercial targeted -$0.21M but XLSTAT's solved bounds deliver -$0.86M. The overshoot ratio was systematic — 4.0× in all six workbooks — not random noise.",
    "This tool's exact percentile fit removes that artifact. Re-running all six workbooks with identical inputs under exact fit yields a positive P10 in every case without any flooring (from +$5k on Honeymoon Internal to +$385k on Kings Plains 66kV Internal). P50 lands 12–15% above the workbook value and P90 6–8% above — a consistent, slightly conservative shift caused by correcting the over-wide left tail.",
    "If a configuration still produces a negative P10 (very low class, low complexity, few risks), the nominal 'Floor reported P-values at $0' setting reports $0 while preserving the raw value as a footnote for transparency.",
  ]},
  { id:"industry", title:"10. How this compares to industry tools", body:[
    "@RISK (Lumivero) — Excel add-in, 10,000-iteration default, Latin Hypercube sampling, PERT among 35+ distributions, tornado sensitivity charts. CART in this tool mirrors those defaults.",
    "Oracle Primavera Risk Analysis (Pertmaster) — schedule + cost risk; practitioner guidance is 5,000–10,000 iterations with a locked seed for reproducibility, and optional convergence-based stopping.",
    "Safran Risk / RiskyProject — integrated cost-schedule risk with risk-driver correlation modelling. Correlation matrices are not modelled here (risks are independent, as in the CART workbook); if two register risks are strongly coupled, consider merging them into one entry with a combined impact range.",
    "XLSTAT (the workbook's engine) — general statistics add-in. Functional but requires a paid licence, manual histogram generation, fragile sheet-naming conventions and a multi-step reset procedure, all of which this page eliminates.",
  ]},
  { id:"workflow", title:"11. Quick workflow", body:[
    "1. Complete and review the estimate. 2. Open CART — confirm the Base Estimate and the systemic inputs (class / complexity / new technology) shown in the Systemic panel. 3. Add each High / Very High residual risk with its three-point cost impact. 4. Check Settings (nominal defaults are pre-applied). 5. Run Simulation. 6. Read P-values, review contribution ranking, export or record the chosen contingency. 7. Save the estimate — risks and the last run travel with the investment record, including through Clone / Promote.",
  ]},
  { id:"glossary", title:"12. Glossary", body:[
    "Base Estimate — cost estimate excluding contingency and escalation. · Residual risk — risk remaining after mitigating controls. · P-value (Pxx) — value with xx% probability that the outcome is at or below it. · PERT distribution — Beta distribution parameterised by minimum, mode and maximum; standard for three-point estimates. · Latin Hypercube — stratified sampling giving even coverage of each distribution. · Systemic risk — estimate-wide uncertainty assumed to occur. · Deterministic contingency — single-point check value: systemic P50 + Σ (most-likely likelihood × most-likely impact).",
  ]},
];

function cartHighlight(text, q){
  if(!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if(i===-1) return text;
  const parts=[]; let rest=text, key=0;
  let idx=rest.toLowerCase().indexOf(q.toLowerCase());
  while(idx!==-1){
    parts.push(<span key={key++}>{rest.slice(0,idx)}</span>);
    parts.push(<mark key={key++} className="bg-yellow-200 rounded px-0.5">{rest.slice(idx,idx+q.length)}</mark>);
    rest=rest.slice(idx+q.length);
    idx=rest.toLowerCase().indexOf(q.toLowerCase());
  }
  parts.push(<span key={key++}>{rest}</span>);
  return parts;
}

// ── CART SCREEN ──────────────────────────────────────────────────
function CARTScreen({ inv, lines, isCommercial, onChange, onSave, lastSaved, estimateLocked }) {
  const { supply, commLookup, commProfiles, resourceCodes } = useData();
  const [view, setView]         = useState("sim");     // sim | settings | help
  const [settings, setSettings] = useState(loadCartSettings);
  const [result, setResult]     = useState(null);
  const [runKey, setRunKey]     = useState("");
  const [helpQ, setHelpQ]       = useState("");
  const [helpSec, setHelpSec]   = useState("overview");
  const helpRefs = useRef({});

  const risks = inv.cartRisks || [];
  const setRisks = next => onChange(prev=>({ ...prev, cartRisks: next }));

  // Base Estimate — same basis as the Financial Report / Estimate Summary
  // contingency base (resolveContingency's `contBase`): EE Internal includes
  // the 20% OT for Internal Resources uplift, Commercial does not. Without
  // this, cartResult.base never matches those screens' base and the CART
  // P50 is silently ignored (falls back to the pre-risk %) due to
  // resolveContingency's staleness tolerance.
  const otRatio = useMemo(()=>{
    const awd = Object.values(resourceCodes||{}).find(r=>r.erp_code==="AWD" && r.ee_internal_rate_ot && r.ee_internal_rate);
    return awd ? (awd.ee_internal_rate_ot/awd.ee_internal_rate - 1) : 0;
  },[resourceCodes]);

  const baseEstimate = useMemo(()=>{
    let eeInt=0, comm=0, eeLabCost=0;
    supply.forEach(item=>{
      const ln=lines[item.wbs_code];
      if(!ln||parseFloat(ln.qty||"0")<=0) return;
      const c=calcLine(item, ln.qty||"", ln.factor||"1", ln.delivery, ln.instHrsOvrd, ln.contrRate, ln.plant, ln.mats, isCommercial, ln.resourceOvrd, null, 0);
      eeInt+=c.eeInt; comm+=c.comm; eeLabCost+=c.eeLabCost||0;
    });
    const commTotals={};
    supply.forEach(item=>{
      const cw=item.commission_wbs;
      if(!cw||!commLookup[cw]||commLookup[cw].direct_entry) return;
      const ln=lines[item.wbs_code];
      const qty=parseFloat(ln?.qty||"0")*parseFloat(ln?.factor||"1");
      if(qty<=0) return;
      commTotals[cw]=(commTotals[cw]||0)+qty;
    });
    Object.entries(commLookup).forEach(([commWbs,data])=>{
      const isDirect=!!data.direct_entry;
      const dq=isDirect?(parseFloat(lines[`comm_direct_${commWbs}`]?.qty||"0")||0):(commTotals[commWbs]||0);
      if(dq<=0) return;
      const scale=getScaleFactor(commProfiles,data.profile_id,dq);
      const ovrd=lines[`comm_ovrd_${commWbs}`]?.qty;
      const hrs=(ovrd!==undefined&&ovrd!=="")?(parseFloat(ovrd)||0):dq*(data.hrs_per_unit||0)*scale;
      const e=hrs*(data.ee_labour_rate||139.26);
      eeInt+=e; comm+=e*(1+ANS_LAB); eeLabCost+=e;
    });
    if (isCommercial) return comm;
    return eeInt + eeLabCost*otRatio;  // + 20% OT for Internal Resources, matching contBase
  },[supply,lines,isCommercial,commLookup,commProfiles,otRatio]);

  const systemic = useMemo(()=>cartSystemicParams(baseEstimate, inv.estClass||"Class 5", inv.complexity||"High", inv.newTech||"Moderate"),
    [baseEstimate, inv.estClass, inv.complexity, inv.newTech]);

  const inputKey = useMemo(()=>JSON.stringify({b:Math.round(baseEstimate),s:systemic,r:risks,t:settings}),[baseEstimate,systemic,risks,settings]);
  const stale = result && runKey!==inputKey;

  const updSetting=(k,v)=>{
    setSettings(s=>{ const next={...s,[k]:v}; try{localStorage.setItem(CART_SETTINGS_KEY,JSON.stringify(next));}catch{} return next; });
  };
  const applyPreset=(p)=>{
    const base={...CART_DEFAULT_SETTINGS};
    const next=p==="workbook"?{...base,floorAtZero:false}:base;
    setSettings(next);
    try{localStorage.setItem(CART_SETTINGS_KEY,JSON.stringify(next));}catch{}
  };

  const [justSaved, setJustSaved] = useState(false);
  const [pendingSaveRunAt, setPendingSaveRunAt] = useState(null);

  const run=()=>{
    const res=cartRun(baseEstimate, systemic, readyRisks, settings);
    setResult(res);
    setRunKey(inputKey);
    const cartResult = {
      p10:res.p10, p50:res.p50, p80:res.p80, p90:res.p90,
      base: baseEstimate, isCommercial, riskCount: readyRisks.length,
      runAt: new Date().toISOString(),
    };
    // Populate Investment Setup / Estimate Summary contingency — only after a run
    onChange(prev=>({ ...prev, cartResult }));
    // Auto-save: wait for `inv.cartResult` to reflect this run (next render,
    // once the state update above has propagated) before calling onSave —
    // onSave (saveInvestment) closes over `inv` from parent state, so it
    // must see the update first or it would persist the pre-CART record.
    if (onSave) setPendingSaveRunAt(cartResult.runAt);
  };

  useEffect(()=>{
    if (pendingSaveRunAt && inv.cartResult?.runAt===pendingSaveRunAt && onSave){
      onSave();
      setPendingSaveRunAt(null);
      setJustSaved(true);
      setTimeout(()=>setJustSaved(false),3000);
    }
  },[inv.cartResult, pendingSaveRunAt, onSave]);

  // Restore the simulation view when returning to this screen. `result`
  // (histogram, S-curve, contribution breakdown) is local component state
  // and is lost on navigation/remount, even though inv.cartResult — the
  // saved summary — persists. The engine is deterministic for a fixed seed,
  // so re-running with the current inputs reproduces an identical view as
  // long as nothing has changed; if something HAS changed, `stale` (below)
  // will correctly flag it against the saved cartResult.
  useEffect(()=>{
    if (!result && inv.cartResult && baseEstimate>0){
      const res=cartRun(baseEstimate, systemic, readyRisks, settings);
      setResult(res);
      setRunKey(inputKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[inv.cartResult, baseEstimate>0]);

  const updRisk=(i,k,v)=>setRisks(risks.map((r,j)=>j===i?{...r,[k]:v}:r));
  const addRisk=()=>setRisks([...risks,{ id:"R"+String(risks.length+1).padStart(3,"0"), desc:"", rating:"High", likCat:"Likely (67 - 95%)", best:"", ml:"", worst:"" }]);
  const delRisk=i=>setRisks(risks.filter((_,j)=>j!==i));

  const riskWarnings = risks.map(r=>{
    const w=[];
    const b=parseFloat(r.best)||0, m=parseFloat(r.ml)||0, wo=parseFloat(r.worst)||0;
    if(/Rare|Unlikely/.test(r.likCat)) w.push("A High/Very High residual risk cannot have Rare/Unlikely likelihood");
    if(b&&m&&wo&&!(b<=m&&m<=wo)) w.push("Best ≤ Most Likely ≤ Worst expected");
    if(!(wo>0)) w.push("Worst case cost required");
    return w;
  });
  const readyRisks = risks
    .map(r=>({ ...r, best:parseFloat(r.best)||0, ml:parseFloat(r.ml)||0, worst:parseFloat(r.worst)||0 }))
    .filter(r=>r.worst>0 && r.best<=r.ml && r.ml<=r.worst);

  const filteredHelp = CART_HELP.filter(s=>!helpQ || (s.title+" "+s.body.join(" ")).toLowerCase().includes(helpQ.toLowerCase()));
  const jumpHelp = id => { setHelpSec(id); helpRefs.current[id]?.scrollIntoView({behavior:"smooth",block:"start"}); };

  const pctOfBase = v => baseEstimate>0 ? (v/baseEstimate*100).toFixed(2)+"%" : "—";

  const VIEW_TABS=[{id:"sim",label:"🎲 Simulation"},{id:"settings",label:"⚙️ Settings"},{id:"help",label:"📖 Help Guide"}];

  // ── Charts (pure SVG) ──
  const Histogram = ()=>{
    if(!result) return null;
    const {counts,lo,w}=result.hist;
    const max=Math.max(...counts);
    const W=1400,H=320,pad=10;
    const bw=(W-2*pad)/counts.length;
    const x=v=>pad+((v-lo)/(result.hist.hi-lo||1))*(W-2*pad);
    return (
      <svg viewBox={`0 0 ${W} ${H+40}`} className="w-full">
        {counts.map((c,i)=>(
          <rect key={i} x={pad+i*bw+0.5} y={H-(c/max)*(H-10)} width={Math.max(bw-1,1)} height={(c/max)*(H-10)}
            className="fill-[var(--primary-400)]" opacity="0.85"/>
        ))}
        {[["P10",result.raw.p10,"#dc2626"],["P50",result.raw.p50,"#1d4ed8"],["P90",result.raw.p90,"#047857"]].map(([lab,v,col])=>(
          <g key={lab}>
            <line x1={x(v)} x2={x(v)} y1={6} y2={H} stroke={col} strokeWidth="2" strokeDasharray="6 4"/>
            <text x={x(v)+5} y={26} style={{fontSize:"22px"}} fill={col} fontWeight="bold">{lab}</text>
          </g>
        ))}
        <text x={pad} y={H+30} style={{fontSize:"22px"}} fill="#6b7280">{fmt(lo)}</text>
        <text x={W-pad} y={H+30} style={{fontSize:"22px"}} fill="#6b7280" textAnchor="end">{fmt(result.hist.hi)}</text>
      </svg>
    );
  };
  const SCurve = ()=>{
    if(!result) return null;
    const W=1400,H=320,pad=10;
    const s=result.sorted, n=s.length;
    const lo=s[0], hi=s[n-1];
    const pts=[];
    for(let i=0;i<=100;i++){
      const v=s[Math.min(n-1,Math.round(i/100*(n-1)))];
      pts.push(`${pad+((v-lo)/(hi-lo||1))*(W-2*pad)},${H-(i/100)*(H-10)}`);
    }
    const x=v=>pad+((v-lo)/(hi-lo||1))*(W-2*pad);
    return (
      <svg viewBox={`0 0 ${W} ${H+22}`} className="w-full">
        {[0.1,0.5,0.8,0.9].map(p=>(
          <line key={p} x1={pad} x2={W-pad} y1={H-p*(H-10)} y2={H-p*(H-10)} stroke="#e5e7eb" strokeWidth="1"/>
        ))}
        <polyline points={pts.join(" ")} fill="none" stroke="var(--primary-700)" strokeWidth="2"/>
        {[["P10",result.raw.p10,0.1,"#dc2626"],["P50",result.raw.p50,0.5,"#1d4ed8"],["P80",result.raw.p80,0.8,"#9333ea"],["P90",result.raw.p90,0.9,"#047857"]].map(([lab,v,p,col])=>(
          <g key={lab}>
            <circle cx={x(v)} cy={H-p*(H-10)} r="3.5" fill={col}/>
            <text x={x(v)+6} y={H-p*(H-10)+3} fontSize="10" fill={col} fontWeight="bold">{lab}</text>
          </g>
        ))}
        <text x={pad} y={H+16} fontSize="9" fill="#6b7280">{fmt(lo)}</text>
        <text x={W-pad} y={H+16} fontSize="9" fill="#6b7280" textAnchor="end">{fmt(hi)}</text>
      </svg>
    );
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-100">
      {/* Internal nav */}
      <div className="bg-white border-b px-4 flex items-center gap-1 flex-shrink-0">
        <span className="text-xs font-bold text-gray-700 mr-3 py-2.5">🎲 CART — Contingency &amp; Accuracy Range Tool</span>
        {VIEW_TABS.map(t=>(
          <button key={t.id} onClick={()=>setView(t.id)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${view===t.id?"border-[var(--primary-600)] text-[var(--primary-700)] bg-[var(--primary-50)]":"border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t.label}
          </button>
        ))}
        <div className="flex-1"/>
        {justSaved && <span className="text-xs text-green-600 mr-2">✓ Saved</span>}
        {lastSaved && !justSaved && <span className="text-xs text-gray-400 mr-2">Last saved {lastSaved}</span>}
        {estimateLocked
          ? <span className="text-xs bg-green-100 text-green-700 border border-green-300 px-2.5 py-1 rounded font-semibold mr-3">🔒 Approved — read only</span>
          : onSave && <button onClick={()=>{onSave(); setJustSaved(true); setTimeout(()=>setJustSaved(false),3000);}}
              className="bg-green-700 hover:bg-green-600 text-white text-xs px-3 py-1.5 rounded font-semibold mr-3">💾 Save Investment</button>}
        <span className="text-xs text-gray-400 py-2.5">{inv.estClass||"Class 5"} · {inv.complexity||"High"} complexity · {inv.newTech||"Moderate"} new tech</span>
      </div>

      {/* ════ SIMULATION VIEW ════ */}
      {view==="sim" && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-6xl mx-auto space-y-4">

            {baseEstimate<=0 && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 text-xs text-amber-800">
                ⚠️ <strong>No Base Estimate yet.</strong> CART is run after the estimate is completed — enter quantities in the Estimation tab first.
              </div>
            )}

            {/* Base + systemic */}
            <div className="grid grid-cols-2 gap-4">
              <Card className="bg-white">
                <SectionHeader color="blue" title="Base Estimate" subtitle="Excl. contingency & escalation — live from estimate"/>
                <div className="p-4">
                  <div className="text-2xl font-bold text-[var(--primary-900)] font-mono">{fmt(baseEstimate)}</div>
                  <div className="text-xs text-gray-500 mt-1">{isCommercial?"Commercial (ANS applied)":"EE Internal"} rate stream · {inv.name||"Untitled"} · Rev {inv.revision||"A"}</div>
                </div>
              </Card>
              <Card className="bg-white">
                <SectionHeader color="purple" title="Systemic Risk" subtitle="Assumed to occur — AACE table from Investment Setup"/>
                <div className="p-4 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-xs text-gray-500">P10 portion ({(systemic.t10*100).toFixed(1)}%)</div>
                    <div className={`text-sm font-mono font-bold ${systemic.p10c<0?"text-red-600":"text-gray-800"}`}>{fmt(systemic.p10c)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">P50 portion ({(systemic.t50*100).toFixed(1)}%)</div>
                    <div className="text-sm font-mono font-bold text-gray-800">{fmt(systemic.p50c)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">P90 portion ({(systemic.t90*100).toFixed(1)}%)</div>
                    <div className="text-sm font-mono font-bold text-gray-800">{fmt(systemic.p90c)}</div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Risk register */}
            <Card className="bg-white">
              <SectionHeader color="orange" title="Project-Specific Risk Register"
                subtitle="High / Very High residual risks only — after mitigating controls. Costs = impact if the risk occurs."/>
              <div className="p-3">
                {risks.length===0 && (
                  <div className="text-center text-xs text-gray-400 py-4">No risks added yet. Add the High / Very High residual risks from the Project Risk Register.</div>
                )}
                <div className="overflow-x-auto">
                <div style={{minWidth:"900px"}}>
                {risks.length>0 && (
                  <div className="grid text-xs font-semibold text-gray-500 px-2 pb-1"
                    style={{gridTemplateColumns:"70px 1fr 95px 165px 95px 95px 95px 30px"}}>
                    <div>ID</div><div>Risk Description</div><div>Residual Rating</div><div>Residual Likelihood</div>
                    <div className="text-right">Best $</div><div className="text-right">Most Likely $</div><div className="text-right">Worst $</div><div/>
                  </div>
                )}
                {risks.map((r,i)=>(
                  <div key={i} className="border-t border-gray-100 py-1.5 px-2">
                    <div className="grid gap-1.5 items-center" style={{gridTemplateColumns:"70px 1fr 95px 165px 95px 95px 95px 30px"}}>
                      <input value={r.id} onChange={e=>updRisk(i,"id",e.target.value)}
                        className="border border-gray-200 rounded px-1.5 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                      <input value={r.desc} onChange={e=>updRisk(i,"desc",e.target.value)} placeholder="Risk description from Project Risk Register"
                        className="border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                      <select value={r.rating} onChange={e=>updRisk(i,"rating",e.target.value)}
                        className={`border rounded px-1 py-1 text-xs font-semibold focus:outline-none ${r.rating==="Very High"?"border-red-300 bg-red-50 text-red-700":"border-orange-300 bg-orange-50 text-orange-700"}`}>
                        <option>High</option><option>Very High</option>
                      </select>
                      <select value={r.likCat} onChange={e=>updRisk(i,"likCat",e.target.value)}
                        className="border border-gray-200 rounded px-1 py-1 text-xs focus:outline-none">
                        {CART_LIKELIHOOD.map(l=><option key={l.cat}>{l.cat}</option>)}
                      </select>
                      <input value={r.best} onChange={e=>updRisk(i,"best",e.target.value)} placeholder="0" inputMode="decimal"
                        className="border border-gray-200 rounded px-1.5 py-1 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                      <input value={r.ml} onChange={e=>updRisk(i,"ml",e.target.value)} placeholder="0" inputMode="decimal"
                        className="border border-gray-200 rounded px-1.5 py-1 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                      <input value={r.worst} onChange={e=>updRisk(i,"worst",e.target.value)} placeholder="0" inputMode="decimal"
                        className="border border-gray-200 rounded px-1.5 py-1 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                      <button onClick={()=>delRisk(i)} className="text-gray-300 hover:text-red-600 text-sm">✕</button>
                    </div>
                    {riskWarnings[i].length>0 && (
                      <div className="text-xs text-amber-700 mt-1 pl-1">⚠ {riskWarnings[i].join(" · ")}</div>
                    )}
                  </div>
                ))}
                </div>
                </div>
                <button onClick={addRisk}
                  className="mt-2 text-xs border-2 border-dashed border-gray-300 hover:border-[var(--primary-400)] hover:text-[var(--primary-700)] text-gray-400 px-4 py-1.5 rounded-lg font-semibold w-full">
                  ＋ Add Residual Risk
                </button>
              </div>
            </Card>

            {/* Run bar */}
            <div className="flex items-center gap-3">
              <button onClick={run} disabled={baseEstimate<=0}
                className="bg-green-700 hover:bg-green-600 disabled:bg-gray-300 text-white text-sm px-6 py-2.5 rounded-lg font-bold shadow-sm">
                ▶ Run Simulation
              </button>
              <span className="text-xs text-gray-500">
                {settings.iterations.toLocaleString()} iterations · {settings.sampling==="lhs"?"Latin Hypercube":"Random MC"} · seed {settings.seed}
                {readyRisks.length<risks.length && <span className="text-amber-700"> · {risks.length-readyRisks.length} risk(s) incomplete — excluded</span>}
              </span>
              {stale && <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded font-semibold">Inputs changed since last run — re-run</span>}
            </div>

            {/* Results */}
            {result && (
              <>
                <div className={`grid gap-3 ${result.floored?"grid-cols-5":"grid-cols-5"}`}>
                  {[["P10",result.p10,result.raw.p10,"text-red-700","bg-red-50 border-red-200"],
                    ["P50",result.p50,result.raw.p50,"text-[var(--primary-800)]","bg-[var(--primary-50)] border-[var(--primary-200)]"],
                    ["P80",result.p80,result.raw.p80,"text-purple-700","bg-purple-50 border-purple-200"],
                    ["P90",result.p90,result.raw.p90,"text-green-800","bg-green-50 border-green-200"],
                  ].map(([lab,v,raw,col,box])=>(
                    <div key={lab} className={`rounded-lg border p-3 ${box}`}>
                      <div className="text-xs font-bold text-gray-500">{lab} Contingency</div>
                      <div className={`text-lg font-mono font-bold ${col}`}>{fmt(v)}</div>
                      <div className="text-xs text-gray-500">{pctOfBase(v)} of base{settings.floorAtZero&&raw<0&&<span className="text-amber-700"> · raw {fmt(raw)}</span>}</div>
                      <div className="text-xs text-gray-600 mt-1 font-mono">Base+: {fmt(baseEstimate+v)}</div>
                    </div>
                  ))}
                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                    <div className="text-xs font-bold text-gray-500">Deterministic Check</div>
                    <div className="text-lg font-mono font-bold text-gray-700">{fmt(result.deterministic)}</div>
                    <div className="text-xs text-gray-500">{pctOfBase(result.deterministic)} of base</div>
                    <div className="text-xs text-gray-400 mt-1">Mean {fmt(result.mean)} · SD {fmt(result.sd)}</div>
                  </div>
                </div>

                <Card className="bg-white">
                  <SectionHeader color="blue" title="Contingency Distribution" subtitle={`Histogram — ${settings.bins} intervals · ${result.N.toLocaleString()} iterations`}/>
                  <div className="p-3"><Histogram/></div>
                </Card>
                <Card className="bg-white">
                  <SectionHeader color="teal" title="Confidence S-Curve" subtitle="Cumulative probability vs contingency"/>
                  <div className="p-3"><SCurve/></div>
                </Card>

                <Card className="bg-white">
                  <SectionHeader color="gray" title="Contribution to Contingency" subtitle="Expected-value share — target further mitigation at the top of this list"/>
                  <div className="p-4 space-y-2">
                    {[...result.contrib].sort((a,b)=>b.val-a.val).map(c=>(
                      <div key={c.name} className="flex items-center gap-3">
                        <div className="w-72 text-xs text-gray-700 truncate" title={c.name}>{c.name}</div>
                        <div className="flex-1 bg-gray-100 rounded-full h-3">
                          <div className={`h-3 rounded-full ${c.name==="Systemic"?"bg-purple-500":"bg-orange-500"}`} style={{width:`${Math.max(c.pct*100,1)}%`}}/>
                        </div>
                        <div className="w-14 text-right text-xs font-mono text-gray-600">{(c.pct*100).toFixed(1)}%</div>
                        <div className="w-24 text-right text-xs font-mono text-gray-800">{fmt(c.val)}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              </>
            )}
          </div>
        </div>
      )}

      {/* ════ SETTINGS VIEW ════ */}
      {view==="settings" && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="flex items-center gap-2">
              <button onClick={()=>applyPreset("nominal")}
                className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded font-semibold">✓ EE Nominal (recommended)</button>
              <button onClick={()=>applyPreset("workbook")}
                className="text-xs border border-gray-300 hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded font-semibold">CART Workbook (unfloored)</button>
              <span className="text-xs text-gray-400 ml-2">Settings persist on this browser and apply to all estimates</span>
            </div>

            <Card className="bg-white">
              <SectionHeader color="blue" title="Simulation Engine"/>
              <div className="p-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Iterations</label>
                  <select value={settings.iterations} onChange={e=>updSetting("iterations",parseInt(e.target.value))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white">
                    {[1000,5000,10000,20000,50000].map(n=><option key={n} value={n}>{n.toLocaleString()}{n===10000?" (nominal — CART / @RISK default)":""}</option>)}
                  </select>
                  <div className="text-xs text-gray-400 mt-1">Industry guidance: 5,000–10,000 for stable cost tails</div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Random Seed</label>
                  <input value={settings.seed} inputMode="numeric"
                    onChange={e=>updSetting("seed",parseInt(e.target.value)||1)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs font-mono"/>
                  <div className="text-xs text-gray-400 mt-1">Locked seed = reproducible runs for review &amp; audit</div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Sampling Method</label>
                  <select value={settings.sampling} onChange={e=>updSetting("sampling",e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white">
                    <option value="lhs">Latin Hypercube (nominal — even tail coverage)</option>
                    <option value="random">Random Monte Carlo</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Histogram Intervals</label>
                  <select value={settings.bins} onChange={e=>updSetting("bins",parseInt(e.target.value))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white">
                    {[25,50,75,100].map(n=><option key={n} value={n}>{n}{n===50?" (CART workbook)":""}</option>)}
                  </select>
                </div>
              </div>
            </Card>

            <Card className="bg-white">
              <SectionHeader color="purple" title="Distribution Model"/>
              <div className="p-4 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Best / Worst Interpretation</label>
                  <select value={settings.boundsMode} onChange={e=>updSetting("boundsMode",e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white">
                    <option value="percentile">P10 / P90 percentiles — exact fit (nominal; corrects the workbook's wide XLSTAT fit)</option>
                    <option value="absolute">Absolute minimum / maximum (narrower distribution)</option>
                  </select>
                  <div className="text-xs text-gray-400 mt-1">Exact fit is the main reason this tool's P10 is materially less negative than the XLSTAT workbook — see Help §9</div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Risk Occurrence Model</label>
                  <select value={settings.occurrence} onChange={e=>updSetting("occurrence",e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white">
                    <option value="expected">Expected value — likelihood × impact each iteration (CART workbook)</option>
                    <option value="bernoulli">Bernoulli event simulation — risk fully occurs or not (@RISK register convention)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Impact Distribution Mode</label>
                  <select value={settings.modeConvention} onChange={e=>updSetting("modeConvention",e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white">
                    <option value="pertMean">PERT mean — (Best + 4×ML + Worst) / 6 (CART workbook)</option>
                    <option value="mostLikely">Most Likely value</option>
                  </select>
                </div>
              </div>
            </Card>

            <Card className="bg-white">
              <SectionHeader color="green" title="Reporting — keeping P10 non-negative"/>
              <div className="p-4 space-y-3">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={settings.floorAtZero} onChange={e=>updSetting("floorAtZero",e.target.checked)} className="mt-0.5 accent-green-700"/>
                  <span className="text-xs text-gray-700">
                    <strong>Floor reported P-values at $0</strong> (nominal). The simulation is untouched — only the reported figure is floored, with the raw value shown alongside for transparency. Recommended for funding submissions.
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={settings.truncateSystemic} onChange={e=>updSetting("truncateSystemic",e.target.checked)} className="mt-0.5 accent-green-700"/>
                  <span className="text-xs text-gray-700">
                    <strong>Truncate systemic underrun at $0</strong>. Clamps negative systemic draws inside the simulation. Shifts the whole distribution up — off by default; prefer the reporting floor above.
                  </span>
                </label>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ════ HELP VIEW ════ */}
      {view==="help" && (
        <div className="flex-1 flex overflow-hidden">
          {/* Contents panel */}
          <div className="w-64 bg-white border-r flex flex-col flex-shrink-0">
            <div className="p-3 border-b">
              <input value={helpQ} onChange={e=>setHelpQ(e.target.value)} placeholder="🔍 Search help…"
                className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
              {helpQ && <div className="text-xs text-gray-400 mt-1">{filteredHelp.length} of {CART_HELP.length} sections match</div>}
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide px-3 pb-1">Contents</div>
              {(helpQ?filteredHelp:CART_HELP).map(s=>(
                <button key={s.id} onClick={()=>jumpHelp(s.id)}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--primary-50)] ${helpSec===s.id?"text-[var(--primary-700)] font-semibold bg-[var(--primary-50)] border-l-2 border-[var(--primary-600)]":"text-gray-600"}`}>
                  {s.title}
                </button>
              ))}
              {helpQ && filteredHelp.length===0 && (
                <div className="px-3 py-4 text-xs text-gray-400">No sections match "{helpQ}"</div>
              )}
            </div>
          </div>
          {/* Help body */}
          <div className="flex-1 overflow-y-auto p-6 bg-white">
            <div className="max-w-3xl space-y-6">
              <div>
                <div className="text-lg font-bold text-gray-900">CART Help Guide</div>
                <div className="text-xs text-gray-500 mt-1">Contingency &amp; Accuracy Range Tool — Monte Carlo contingency for completed estimates. Replaces the XLSTAT CART workbook.</div>
              </div>
              {(helpQ?filteredHelp:CART_HELP).map(s=>(
                <div key={s.id} ref={el=>{helpRefs.current[s.id]=el;}} className="scroll-mt-4">
                  <div className="text-sm font-bold text-[var(--primary-800)] border-b border-gray-100 pb-1 mb-2">{cartHighlight(s.title,helpQ)}</div>
                  {s.body.map((p,i)=>(
                    <p key={i} className="text-xs text-gray-700 leading-relaxed mb-2">{cartHighlight(p,helpQ)}</p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SME REPORT SCREEN (S8) ───────────────────────────────────────
// Replicates the SME summary macros from the master workbook —
// filters the live estimate to each discipline's WBS scope and rolls
// costs up to summary WBS rows, grouped by delivery phase.
// Priority order matters: the FIRST discipline whose prefix matches
// claims the row (so PROT/CIVIL claim their 3.1.x groups before HV).
// The structure below is the DEFAULT — managers can rename, re-scope and
// reorder disciplines via the Edit Structure dialog (persisted locally).
const DEFAULT_SME_DISCIPLINES = [
  { id:"SCADA", label:"SCADA & Metering", icon:"📡", color:"teal",
    description:"SCADA RTUs, transducers, load control, system control & metering",
    macroName:"SCADA_Summary",
    prefixes:["2.6.1.02","2.6.1.04","2.6.1.05","3.5.1.02","3.5.1.03","3.5.1.04","3.5.1.05","3.5.1.06","3.5.1.07","4.1.6.01","4.1.6.02","4.1.6.03","4.1.6.04","4.1.6.05"] },
  { id:"PROT", label:"Protection", icon:"🛡", color:"red",
    description:"Protection relays, DC systems, panels & secondary cabling",
    macroName:"Protection_Summary",
    prefixes:["2.6.1.01","3.1.3.19","3.1.3.20","3.1.3.21","3.1.3.22","4.1.2.14","4.1.2.15","4.1.2.16","4.1.2.17"] },
  { id:"COMMS", label:"Comms", icon:"📶", color:"purple",
    description:"Communications design, equipment & optical fibre",
    macroName:"Comms_Summary",
    prefixes:["2.2","3.2","4.1.3","4.1.4"] },
  { id:"TRANS", label:"Subtransmission Mains", icon:"🗼", color:"orange",
    description:"SM design, construction & commissioning",
    macroName:"TransmissionServices_Summary",
    prefixes:["2.3","3.3","4.1.5"] },
  { id:"CIVIL", label:"Civil, Building & Earthing", icon:"🏗", color:"amber",
    description:"Civil & building construction, earthing engineering & commissioning",
    macroName:"CivilEarthing_Summary",
    prefixes:["2.6.1.03","3.1.1","3.1.2","4.1.1"] },
  { id:"HV", label:"HV Plant (Zone Sub)", icon:"⚡", color:"blue",
    description:"ZS design, primary plant, procurement & electrical commissioning",
    macroName:"HVPlant_Summary",
    prefixes:["2.1","3.1","4.1.2"] },
  { id:"OTHER", label:"Other / Ancillary", icon:"📦", color:"gray",
    description:"Planning, land & routes, ancillary items & handover",
    macroName:"Ancillary_Summary",
    prefixes:[], catchAll:true },
];

const SME_STORE_KEY = "iet_sme_disciplines";
function loadSmeDisciplines() {
  try {
    const raw = localStorage.getItem(SME_STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length &&
          parsed.every(d=>d.id && d.label && Array.isArray(d.prefixes))) {
        // Catch-all must exist and sit last so it only claims unmatched rows
        const real  = parsed.filter(d=>!d.catchAll);
        const other = parsed.find(d=>d.catchAll) || DEFAULT_SME_DISCIPLINES.find(d=>d.catchAll);
        return [...real, other];
      }
    }
  } catch { /* fall through to defaults */ }
  return DEFAULT_SME_DISCIPLINES;
}
function saveSmeDisciplines(discs) {
  try { localStorage.setItem(SME_STORE_KEY, JSON.stringify(discs)); } catch { /* ignore */ }
}

const SME_COLOR = {
  teal:   { card:"bg-teal-700",   active:"bg-teal-800 text-white",   hover:"hover:bg-teal-50"   },
  red:    { card:"bg-red-700",    active:"bg-red-800 text-white",    hover:"hover:bg-red-50"    },
  purple: { card:"bg-purple-700", active:"bg-purple-800 text-white", hover:"hover:bg-purple-50" },
  orange: { card:"bg-orange-700", active:"bg-orange-800 text-white", hover:"hover:bg-orange-50" },
  amber:  { card:"bg-amber-700",  active:"bg-amber-800 text-white",  hover:"hover:bg-amber-50"  },
  blue:   { card:"bg-blue-700",   active:"bg-blue-800 text-white",   hover:"hover:bg-blue-50"   },
  gray:   { card:"bg-gray-600",   active:"bg-gray-700 text-white",   hover:"hover:bg-gray-50"   },
};

const SME_PHASES = ["Planning","Design","Construction","Commissioning","Handover"];
const SME_PHASE_STYLES = {
  Planning:      { bg:"bg-gray-100",  border:"border-l-gray-400",   label:"bg-gray-200 text-gray-700",     bar:"bg-gray-400"   },
  Design:        { bg:"bg-indigo-50", border:"border-l-indigo-400", label:"bg-indigo-100 text-indigo-700", bar:"bg-indigo-400" },
  Construction:  { bg:"bg-blue-50",   border:"border-l-blue-400",   label:"bg-blue-100 text-blue-700",     bar:"bg-blue-400"   },
  Commissioning: { bg:"bg-teal-50",   border:"border-l-teal-400",   label:"bg-teal-100 text-teal-700",     bar:"bg-teal-400"   },
  Handover:      { bg:"bg-green-50",  border:"border-l-green-400",  label:"bg-green-100 text-green-700",   bar:"bg-green-400"  },
};

function smeClassify(code, discs) {
  let fallback = null;
  for (const d of discs) {
    if (d.catchAll) { fallback = d.id; continue; }
    if (d.prefixes.some(p => code === p || code.startsWith(p + "."))) return d.id;
  }
  return fallback || discs[discs.length-1].id;
}
function smePhase(code) {
  return { "1":"Planning", "2":"Design", "3":"Construction", "4":"Commissioning", "5":"Handover" }[code.split(".")[0]] || "Construction";
}

// ── SME STRUCTURE EDITOR ─────────────────────────────────────────
// Manager-only (PIN 1607, same as rates/scaling editors). Rename,
// re-scope, reorder, add or remove disciplines. Order = priority:
// the first discipline whose prefix matches a WBS code claims it.
function SMEStructureEditor({ discs, allCodes, onSave, onClose }) {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin]           = useState("");
  const [pinErr, setPinErr]     = useState(false);
  const [draft, setDraft]       = useState(()=>JSON.parse(JSON.stringify(discs)));
  const [newPrefix, setNewPrefix] = useState({});
  const pinRef = useRef(null);
  useEffect(()=>{ if(!unlocked) pinRef.current?.focus(); },[unlocked]);

  const tryPin = ()=>{
    if (pin==="1607") setUnlocked(true);
    else { setPinErr(true); setPin(""); setTimeout(()=>setPinErr(false),1500); }
  };

  // Live match counts against the current draft (priority order applied)
  const matchCounts = useMemo(()=>{
    const counts = {};
    draft.forEach(d=>{ counts[d.id]=0; });
    allCodes.forEach(code=>{
      let claimed = false;
      for (const d of draft) {
        if (d.catchAll) continue;
        if (d.prefixes.some(p=>code===p||code.startsWith(p+"."))) { counts[d.id]++; claimed=true; break; }
      }
      if (!claimed) { const ca = draft.find(d=>d.catchAll); if (ca) counts[ca.id]++; }
    });
    return counts;
  },[draft, allCodes]);

  const upd = (i,k,v) => setDraft(dr=>dr.map((d,j)=>j===i?{...d,[k]:v}:d));
  const move = (i,dir) => setDraft(dr=>{
    const j = i+dir;
    if (j<0 || j>=dr.length || dr[i].catchAll || dr[j].catchAll) return dr;
    const next = [...dr]; [next[i],next[j]]=[next[j],next[i]]; return next;
  });
  const removeDisc = i => setDraft(dr=>dr.filter((_,j)=>j!==i));
  const addPrefix = i => {
    const id = draft[i].id;
    const v  = (newPrefix[id]||"").trim();
    if (!v) return;
    if (!/^[0-9]+(\.[0-9A-Za-z]+)*$/.test(v)) { alert("Prefix must be a WBS code prefix like 3.1.3 or 4.1.2.15"); return; }
    if (draft[i].prefixes.includes(v)) { setNewPrefix(p=>({...p,[id]:""})); return; }
    setDraft(dr=>dr.map((d,j)=>j===i?{...d,prefixes:[...d.prefixes,v].sort()}:d));
    setNewPrefix(p=>({...p,[id]:""}));
  };
  const removePrefix = (i,pfx) => setDraft(dr=>dr.map((d,j)=>j===i?{...d,prefixes:d.prefixes.filter(p=>p!==pfx)}:d));
  const addDisc = () => setDraft(dr=>{
    const idx = dr.findIndex(d=>d.catchAll);
    const nd = { id:"CUSTOM_"+Date.now().toString(36), label:"New Discipline", icon:"🧩", color:"gray",
                 description:"", macroName:"Custom_Summary", prefixes:[] };
    const next = [...dr];
    next.splice(idx===-1?next.length:idx, 0, nd);
    return next;
  });
  const resetDefaults = () => {
    if (window.confirm("Reset SME report structure to the workbook defaults? Your custom disciplines and prefixes will be discarded.")) {
      setDraft(JSON.parse(JSON.stringify(DEFAULT_SME_DISCIPLINES)));
    }
  };
  const trySave = () => {
    if (draft.some(d=>!d.label.trim())) { alert("Every discipline needs a name"); return; }
    const empty = draft.filter(d=>!d.catchAll && d.prefixes.length===0);
    if (empty.length && !window.confirm(`${empty.map(d=>d.label).join(", ")} ${empty.length===1?"has":"have"} no WBS prefixes and will never match any rows. Save anyway?`)) return;
    onSave(draft);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[780px] max-h-[88vh] flex flex-col" onClick={e=>e.stopPropagation()}>
        <div className="bg-[var(--primary-900)] text-white px-5 py-4 rounded-t-xl flex items-center justify-between flex-shrink-0">
          <div>
            <div className="font-bold text-base">✏️ Edit SME Report Structure</div>
            <div className="text-[var(--primary-200)] text-xs mt-1">
              {unlocked
                ? "Order = priority — the first discipline whose prefix matches a WBS code claims the row"
                : "Manager access required to edit discipline structures"}
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--primary-200)] hover:text-white text-lg leading-none">✕</button>
        </div>

        {!unlocked ? (
          <div className="p-8 max-w-sm mx-auto w-full">
            <div className="text-xs text-gray-500 text-center mb-3">Enter the manager PIN to edit how WBS codes map to SME disciplines</div>
            <input ref={pinRef} type="password" value={pin}
              onChange={e=>{setPin(e.target.value);setPinErr(false);}}
              onKeyDown={e=>{ if(e.key==="Enter") tryPin(); if(e.key==="Escape") onClose(); }}
              placeholder="Manager PIN"
              className={`w-full border rounded px-3 py-2 text-sm text-center tracking-widest font-mono focus:outline-none focus:ring-2 ${pinErr?"border-red-400 ring-red-300 bg-red-50":"border-gray-300 focus:ring-[var(--primary-400)]"}`}/>
            {pinErr && <div className="text-xs text-red-600 text-center mt-2">Incorrect PIN — try again</div>}
            <button onClick={tryPin} disabled={!pin}
              className="w-full mt-3 text-xs bg-[var(--primary-700)] hover:bg-[var(--primary-600)] disabled:bg-gray-200 disabled:text-gray-400 text-white py-2 rounded font-bold">
              🔓 Unlock Editor
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
              {draft.map((d,i)=>(
                <div key={d.id} className={`bg-white rounded-lg border p-3 ${d.catchAll?"border-dashed border-gray-300":"border-gray-200 shadow-sm"}`}>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col">
                      <button onClick={()=>move(i,-1)} disabled={d.catchAll||i===0}
                        className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-20 leading-none">▲</button>
                      <button onClick={()=>move(i,1)} disabled={d.catchAll||i>=draft.length-2}
                        className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-20 leading-none">▼</button>
                    </div>
                    <input value={d.icon} onChange={e=>upd(i,"icon",e.target.value)} maxLength={4}
                      className="w-12 border border-gray-200 rounded px-1 py-1 text-center text-base focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                    <input value={d.label} onChange={e=>upd(i,"label",e.target.value)}
                      placeholder="Discipline name"
                      className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                    <select value={d.color} onChange={e=>upd(i,"color",e.target.value)}
                      className="border border-gray-200 rounded px-1 py-1.5 text-xs focus:outline-none">
                      {Object.keys(SME_COLOR).map(c=><option key={c} value={c}>{c}</option>)}
                    </select>
                    <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-1 rounded whitespace-nowrap"
                      title="WBS codes (supply + commissioning) this discipline currently claims">
                      {matchCounts[d.id]??0} codes
                    </span>
                    {!d.catchAll && (
                      <button onClick={()=>removeDisc(i)} title="Remove discipline"
                        className="text-gray-300 hover:text-red-600 text-sm px-1">✕</button>
                    )}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <input value={d.description} onChange={e=>upd(i,"description",e.target.value)}
                      placeholder="Short description"
                      className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs text-gray-600 focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                    <input value={d.macroName} onChange={e=>upd(i,"macroName",e.target.value)}
                      placeholder="Workbook macro name"
                      className="w-56 border border-gray-200 rounded px-2 py-1 text-xs font-mono text-gray-600 focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)]"/>
                  </div>
                  {d.catchAll ? (
                    <div className="mt-2 text-xs text-gray-400 italic">
                      Catch-all — automatically claims every WBS code not matched by a discipline above. Always last; cannot be removed.
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {d.prefixes.map(p=>(
                        <span key={p} className="inline-flex items-center gap-1 bg-[var(--primary-50)] text-[var(--primary-800)] border border-[var(--primary-200)] rounded px-1.5 py-0.5 text-xs font-mono">
                          {p}
                          <button onClick={()=>removePrefix(i,p)} className="text-[var(--primary-400)] hover:text-red-600 leading-none">×</button>
                        </span>
                      ))}
                      <input value={newPrefix[d.id]||""}
                        onChange={e=>setNewPrefix(np=>({...np,[d.id]:e.target.value}))}
                        onKeyDown={e=>{ if(e.key==="Enter") addPrefix(i); }}
                        placeholder="+ add WBS prefix"
                        className="w-32 border border-dashed border-gray-300 rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[var(--primary-400)] focus:border-solid"/>
                      {(newPrefix[d.id]||"").trim() && (
                        <button onClick={()=>addPrefix(i)}
                          className="text-xs bg-[var(--primary-700)] hover:bg-[var(--primary-600)] text-white px-2 py-0.5 rounded font-semibold">Add</button>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <button onClick={addDisc}
                className="w-full text-xs border-2 border-dashed border-gray-300 hover:border-[var(--primary-400)] hover:text-[var(--primary-700)] text-gray-400 py-2.5 rounded-lg font-semibold">
                ＋ Add Discipline
              </button>
            </div>

            <div className="px-4 py-3 border-t bg-white rounded-b-xl flex items-center gap-2 flex-shrink-0">
              <button onClick={resetDefaults}
                className="text-xs text-gray-500 hover:text-red-600 underline mr-auto">↺ Reset to workbook defaults</button>
              <button onClick={onClose}
                className="text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded font-semibold">Cancel</button>
              <button onClick={trySave}
                className="text-xs bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded font-bold">💾 Save Structure</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SMEReportScreen({ inv, lines, isCommercial }) {
  const { supply, commLookup, commProfiles } = useData();
  const [discs, setDiscs]                   = useState(loadSmeDisciplines);
  const [showEditor, setShowEditor]         = useState(false);
  const [selected, setSelected]             = useState("HV");
  const [expandedPhases, setExpandedPhases] = useState({Planning:true,Design:true,Construction:true,Commissioning:true,Handover:true});
  const [showMacroHint, setShowMacroHint]   = useState(false);
  const [exporting, setExporting]           = useState(false);

  // Every estimate row, tagged with discipline + phase
  const allRows = useMemo(()=>{
    const out = [];
    // Supply / install / direct lines (Phases 1, 2, 3, 5)
    supply.forEach(item=>{
      const ln = lines[item.wbs_code];
      if (!ln || parseFloat(ln.qty||"0")<=0) return;
      const c = calcLine(item, ln.qty||"", ln.factor||"1", ln.delivery, ln.instHrsOvrd, ln.contrRate, ln.plant, ln.mats, isCommercial, ln.resourceOvrd, null, 0);
      out.push({ wbs:item.wbs_code, desc:item.description, qty:c.q,
        phase:smePhase(item.wbs_code), disc:smeClassify(item.wbs_code, discs),
        supplyCost:c.equipCost, installHrs:c.installHrs, commHrs:0, eeInt:c.eeInt, comm:c.comm });
    });
    // Phase 4 commissioning rows — same derivation as Review Lines
    const commTotals = {};
    supply.forEach(item=>{
      const cw = item.commission_wbs;
      if (!cw || !commLookup[cw] || commLookup[cw].direct_entry) return;
      const ln  = lines[item.wbs_code];
      const qty = parseFloat(ln?.qty||"0") * parseFloat(ln?.factor||"1");
      if (qty<=0) return;
      commTotals[cw] = (commTotals[cw]||0) + qty;
    });
    Object.entries(commLookup).forEach(([commWbs, data])=>{
      const isDirect   = !!data.direct_entry;
      const derivedQty = isDirect
        ? (parseFloat(lines[`comm_direct_${commWbs}`]?.qty||"0")||0)
        : (commTotals[commWbs]||0);
      if (derivedQty<=0) return;
      const scale   = getScaleFactor(commProfiles, data.profile_id, derivedQty);
      const baseHrs = derivedQty*(data.hrs_per_unit||0);
      const ovrd    = lines[`comm_ovrd_${commWbs}`]?.qty;
      const commHrs = (ovrd!==undefined&&ovrd!=="") ? (parseFloat(ovrd)||0) : baseHrs*scale;
      const rate    = data.ee_labour_rate||139.26;
      const eeInt   = commHrs*rate;
      out.push({ wbs:commWbs, desc:data.description, qty:derivedQty,
        phase:"Commissioning", disc:smeClassify(commWbs, discs),
        supplyCost:0, installHrs:0, commHrs, eeInt, comm:eeInt*(1+ANS_LAB) });
    });
    return out;
  },[supply, lines, isCommercial, commLookup, commProfiles, discs]);

  const investEETotal = useMemo(()=>allRows.reduce((a,r)=>a+r.eeInt,0),[allRows]);

  const discTotals = useMemo(()=>{
    const t = {};
    discs.forEach(d=>{ t[d.id]={eeInt:0,count:0}; });
    allRows.forEach(r=>{ if(!t[r.disc]) t[r.disc]={eeInt:0,count:0}; t[r.disc].eeInt+=r.eeInt; t[r.disc].count++; });
    return t;
  },[allRows, discs]);

  const discipline = discs.find(d=>d.id===selected) || discs[0];
  const rows = useMemo(()=>
    allRows.filter(r=>r.disc===selected)
      .sort((a,b)=>a.wbs.localeCompare(b.wbs,undefined,{numeric:true})),
  [allRows, selected]);

  const phaseTotals = useMemo(()=>{
    const t = {};
    SME_PHASES.forEach(ph=>{
      const phRows = rows.filter(r=>r.phase===ph);
      t[ph] = {
        supplyCost: phRows.reduce((a,r)=>a+r.supplyCost,0),
        installHrs: phRows.reduce((a,r)=>a+r.installHrs,0),
        commHrs:    phRows.reduce((a,r)=>a+r.commHrs,0),
        eeInt:      phRows.reduce((a,r)=>a+r.eeInt,0),
        comm:       phRows.reduce((a,r)=>a+r.comm,0),
        count:      phRows.length,
      };
    });
    return t;
  },[rows]);

  const grandTotal = useMemo(()=>({
    supplyCost: rows.reduce((a,r)=>a+r.supplyCost,0),
    installHrs: rows.reduce((a,r)=>a+r.installHrs,0),
    commHrs:    rows.reduce((a,r)=>a+r.commHrs,0),
    eeInt:      rows.reduce((a,r)=>a+r.eeInt,0),
    comm:       rows.reduce((a,r)=>a+r.comm,0),
  }),[rows]);

  const sharePct = investEETotal>0 ? ((grandTotal.eeInt/investEETotal)*100).toFixed(1) : "0.0";

  const allCodes = useMemo(()=>[
    ...supply.map(s=>s.wbs_code),
    ...Object.keys(commLookup),
  ],[supply, commLookup]);

  const saveStructure = (next)=>{
    setDiscs(next);
    saveSmeDisciplines(next);
    if (!next.find(d=>d.id===selected)) setSelected(next[0].id);
    setShowEditor(false);
  };
  const togglePhase = ph => setExpandedPhases(prev=>({...prev,[ph]:!prev[ph]}));
  const cc = SME_COLOR[discipline.color];
  const gridCols = "150px 1fr 60px 95px 80px 80px 105px 110px";
  const fmtK2 = n => n>0 ? "$"+(n/1000).toFixed(0)+"k" : "–";

  const exportExcel = async ()=>{
    setExporting(true);
    try {
      if (!window.XLSX) {
        await new Promise((res,rej)=>{
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }
      const XL = window.XLSX;
      const data = [
        [`SME Report — ${discipline.label}`],
        [`${inv.name||"Untitled"} — ${inv.number||""} · ${isCommercial?"Commercial (ANS applied)":"EE Internal rates"}`],
        [],
        ["WBS Code","Description","Phase","Qty","Supply Cost","Install Hrs","Comm Hrs","EE Internal","Commercial"],
      ];
      rows.forEach(r=>data.push([r.wbs,r.desc,r.phase,r.qty,
        Math.round(r.supplyCost*100)/100, Math.round(r.installHrs*10)/10, Math.round(r.commHrs*10)/10,
        Math.round(r.eeInt*100)/100, Math.round(r.comm*100)/100]));
      data.push(["","GRAND TOTAL","","",
        Math.round(grandTotal.supplyCost*100)/100, Math.round(grandTotal.installHrs*10)/10, Math.round(grandTotal.commHrs*10)/10,
        Math.round(grandTotal.eeInt*100)/100, Math.round(grandTotal.comm*100)/100]);
      const ws = XL.utils.aoa_to_sheet(data);
      ws["!cols"] = [{wch:16},{wch:60},{wch:14},{wch:8},{wch:13},{wch:11},{wch:11},{wch:13},{wch:13}];
      const wb = XL.utils.book_new();
      XL.utils.book_append_sheet(wb, ws, discipline.label.slice(0,30).replace(/[\\/?*\[\]:]/g,""));
      XL.writeFile(wb, `SME_${discipline.id}_${(inv.number||"estimate").toString().replace(/\s+/g,"_")}.xlsx`);
    } catch(e) { alert("Export failed: " + e.message); }
    setExporting(false);
  };

  if (allRows.length===0) return (
    <div className="flex-1 flex items-center justify-center bg-gray-50">
      <div className="text-center text-gray-400">
        <div className="text-4xl mb-3">📡</div>
        <div className="text-sm font-semibold text-gray-500">No lines entered yet</div>
        <div className="text-xs mt-1">Enter quantities in the Estimation tab to build SME reports</div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-1 overflow-hidden bg-gray-100">

      {/* ── LEFT: DISCIPLINE SELECTOR ─────────────────────────── */}
      <div className="w-60 bg-white border-r flex flex-col flex-shrink-0 overflow-y-auto">
        <div className="px-3 py-2.5 bg-gray-50 border-b">
          <div className="text-xs font-bold text-gray-700 uppercase tracking-wide">SME Discipline</div>
          <div className="text-xs text-gray-400 mt-0.5">Select to view summary report</div>
        </div>

        <div className="flex-1 py-2 px-2 space-y-1">
          {discs.map(d=>{
            const active = d.id===discipline.id;
            const dcc    = SME_COLOR[d.color];
            const dt     = discTotals[d.id];
            if (d.catchAll && dt.count===0) return null;
            return (
              <button key={d.id} onClick={()=>setSelected(d.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                  active ? `${dcc.active} border-transparent shadow-sm`
                         : `bg-white border-gray-200 text-gray-700 ${dcc.hover}`}`}>
                <div className="flex items-center gap-2">
                  <span className="text-base">{d.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className={`font-semibold text-xs truncate ${active?"text-white":"text-gray-800"}`}>{d.label}</div>
                    <div className={`text-xs truncate mt-0.5 ${active?"text-white opacity-75":"text-gray-400"}`}>{d.description}</div>
                  </div>
                </div>
                <div className={`mt-1.5 flex items-center justify-between text-xs ${active?"text-white opacity-90":"text-gray-500"}`}>
                  <span>{dt.count} rows</span>
                  <span className="font-mono font-semibold">{fmtK2(dt.eeInt)}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="p-3 border-t bg-gray-50">
          <button onClick={()=>setShowEditor(true)}
            className="w-full text-xs border border-gray-300 hover:border-[var(--primary-400)] hover:text-[var(--primary-700)] text-gray-600 bg-white px-3 py-1.5 rounded font-semibold mb-2">
            ✏️ Edit Structure
          </button>
          <button onClick={()=>setShowMacroHint(h=>!h)} className="text-xs text-[var(--primary-700)] hover:underline w-full text-left">
            {showMacroHint?"▾":"▸"} About SME reports
          </button>
          {showMacroHint && (
            <div className="mt-2 text-xs text-gray-500 leading-relaxed">
              In the Excel workbook each SME macro filters the master estimate to the
              discipline's WBS scope and rolls costs up to summary level. This page
              replicates that output live from the current estimate — no macro run required.
            </div>
          )}
        </div>
      </div>

      {/* ── CENTRE: REPORT TABLE ──────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        <div className="px-4 py-2.5 border-b flex items-center justify-between flex-shrink-0 bg-white">
          <div className="flex items-center gap-3">
            <span className="text-xl">{discipline.icon}</span>
            <div>
              <div className="font-bold text-gray-900 text-sm">{discipline.label} — Summary WBS Report</div>
              <div className="text-xs text-gray-500">
                Replaces: <span className="font-mono text-gray-600">{discipline.macroName}</span>
                &ensp;·&ensp;{rows.length} WBS rows&ensp;·&ensp;
                <span className={isCommercial?"text-orange-700 font-semibold":"text-[var(--primary-700)] font-semibold"}>
                  {isCommercial?"Commercial (ANS applied)":"EE Internal rates"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {SME_PHASES.map(ph=> phaseTotals[ph].count===0 ? null : (
              <button key={ph} onClick={()=>togglePhase(ph)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  expandedPhases[ph] ? `${SME_PHASE_STYLES[ph].label} border-transparent`
                                     : "bg-gray-100 text-gray-400 border-gray-200"}`}>
                {expandedPhases[ph]?"▾":"▸"} {ph}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-shrink-0 bg-gray-100 border-b px-3 py-1.5 grid text-xs font-semibold text-gray-600"
          style={{gridTemplateColumns:gridCols}}>
          <div>WBS Code</div>
          <div>Description</div>
          <div className="text-right">Qty</div>
          <div className="text-right">Supply Cost</div>
          <div className="text-right">Install Hrs</div>
          <div className="text-right">Comm Hrs</div>
          <div className="text-right text-[var(--primary-700)]">EE Internal</div>
          <div className="text-right text-orange-700">Commercial</div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {rows.length===0 && (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
              No {discipline.label} lines in this estimate
            </div>
          )}
          {SME_PHASES.map(phase=>{
            const phRows = rows.filter(r=>r.phase===phase);
            if (phRows.length===0) return null;
            const pt = phaseTotals[phase];
            const ps = SME_PHASE_STYLES[phase];
            const expanded = expandedPhases[phase];

            return (
              <div key={phase}>
                <div onClick={()=>togglePhase(phase)}
                  className={`px-3 py-1.5 flex items-center justify-between cursor-pointer border-b border-t ${ps.bg} sticky top-0 z-10`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${ps.label}`}>{phase}</span>
                    <span className="text-xs text-gray-500">{pt.count} items</span>
                    {pt.installHrs>0 && <span className="text-xs text-purple-600 font-medium">{fmtHrs(pt.installHrs)} install</span>}
                    {pt.commHrs>0 && <span className="text-xs text-teal-600 font-medium">{fmtHrs(pt.commHrs)} commission</span>}
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-[var(--primary-800)] font-bold">{fmtK2(pt.eeInt)}</span>
                    {isCommercial && <span className="text-orange-700 font-bold">{fmtK2(pt.comm)}</span>}
                    <span className="text-gray-400">{expanded?"▴":"▾"}</span>
                  </div>
                </div>

                {expanded && phRows.map((row,idx)=>(
                  <div key={row.wbs}
                    className={`grid items-center px-3 py-1.5 border-b text-xs border-l-4 ${ps.border} transition-colors hover:bg-gray-50 ${idx%2===0?"bg-white":"bg-gray-50/50"}`}
                    style={{gridTemplateColumns:gridCols}}>
                    <div className="font-mono text-gray-500 text-xs">{row.wbs}</div>
                    <div className="text-gray-800 font-medium pr-2 truncate" title={row.desc}>{row.desc}</div>
                    <div className="text-right font-mono text-gray-600">{row.qty>0?(Math.round(row.qty*100)/100).toLocaleString("en-AU"):"–"}</div>
                    <div className="text-right font-mono text-gray-700">{row.supplyCost>0?fmt(row.supplyCost):"–"}</div>
                    <div className="text-right font-mono text-purple-700">{row.installHrs>0?fmtHrs(row.installHrs):"–"}</div>
                    <div className="text-right font-mono text-teal-700">{row.commHrs>0?fmtHrs(row.commHrs):"–"}</div>
                    <div className="text-right font-mono font-semibold text-[var(--primary-800)]">{fmt(row.eeInt)}</div>
                    <div className={`text-right font-mono font-semibold ${isCommercial?"text-orange-700":"text-gray-300"}`}>
                      {isCommercial?fmt(row.comm):"—"}
                    </div>
                  </div>
                ))}

                {expanded && (
                  <div className={`grid items-center px-3 py-1.5 border-b text-xs font-bold ${ps.bg} border-l-4 ${ps.border}`}
                    style={{gridTemplateColumns:gridCols}}>
                    <div className="col-span-3 text-gray-700 uppercase tracking-wide text-xs">{phase} Subtotal</div>
                    <div className="text-right font-mono text-gray-700">{pt.supplyCost>0?fmt(pt.supplyCost):"–"}</div>
                    <div className="text-right font-mono text-purple-700">{pt.installHrs>0?fmtHrs(pt.installHrs):"–"}</div>
                    <div className="text-right font-mono text-teal-700">{pt.commHrs>0?fmtHrs(pt.commHrs):"–"}</div>
                    <div className="text-right font-mono text-[var(--primary-900)]">{fmt(pt.eeInt)}</div>
                    <div className="text-right font-mono text-orange-800">{isCommercial?fmt(pt.comm):"—"}</div>
                  </div>
                )}
              </div>
            );
          })}

          {rows.length>0 && (
            <div className="grid items-center px-3 py-2 border-t-2 border-gray-400 text-xs font-bold bg-gray-800 text-white sticky bottom-0"
              style={{gridTemplateColumns:gridCols}}>
              <div className="col-span-3 uppercase tracking-wider text-gray-200">{discipline.label} — Grand Total</div>
              <div className="text-right font-mono">{grandTotal.supplyCost>0?fmt(grandTotal.supplyCost):"–"}</div>
              <div className="text-right font-mono text-purple-300">{grandTotal.installHrs>0?fmtHrs(grandTotal.installHrs):"–"}</div>
              <div className="text-right font-mono text-teal-300">{grandTotal.commHrs>0?fmtHrs(grandTotal.commHrs):"–"}</div>
              <div className="text-right font-mono text-blue-200 text-sm">{fmt(grandTotal.eeInt)}</div>
              <div className={`text-right font-mono text-sm ${isCommercial?"text-orange-300":"text-gray-500"}`}>
                {isCommercial?fmt(grandTotal.comm):"—"}
              </div>
            </div>
          )}
        </div>

        <div className="bg-gray-200 border-t text-xs text-gray-500 px-4 py-1 flex justify-between flex-shrink-0">
          <span>Live from current estimate — {rows.length} rows for {discipline.label} · {allRows.length} rows total across all disciplines</span>
          <span>
            Investment: <strong className={isCommercial?"text-orange-700":"text-[var(--primary-700)]"}>{inv.type||"—"}</strong>
            &ensp;·&ensp;{inv.estimateClass||"Class 5"} · Rev {inv.revision||"A"}
          </span>
        </div>
      </div>

      {/* ── RIGHT: DISCIPLINE SUMMARY PANEL ───────────────────── */}
      <div className="w-60 bg-white border-l flex flex-col flex-shrink-0 overflow-y-auto">
        <div className={`${cc.card} text-white text-xs font-bold px-3 py-2 uppercase tracking-wide flex items-center gap-2`}>
          <span>{discipline.icon}</span>
          <span>{discipline.label}</span>
        </div>

        <div className="p-3 space-y-2">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">SME Totals</div>
          <div className="flex justify-between items-center px-2 py-1.5 rounded bg-[var(--primary-50)]">
            <span className="text-xs text-gray-600">EE Internal Total</span>
            <span className="text-xs font-bold text-[var(--primary-800)]">{fmt(grandTotal.eeInt)}</span>
          </div>
          {isCommercial && (
            <>
              <div className="flex justify-between items-center px-2 py-1.5 rounded bg-orange-50">
                <span className="text-xs text-gray-600">Commercial Total</span>
                <span className="text-xs font-bold text-orange-700">{fmt(grandTotal.comm)}</span>
              </div>
              <div className="flex justify-between items-center px-2 py-1.5 rounded bg-red-50">
                <span className="text-xs text-gray-600">ANS Margin</span>
                <span className="text-xs font-bold text-red-700">{fmt(grandTotal.comm-grandTotal.eeInt)}</span>
              </div>
            </>
          )}

          <div className="mt-3 pt-2 border-t">
            <div className="text-xs text-gray-500 mb-1">Share of Investment</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-200 rounded-full h-2">
                <div className={`${cc.card} h-2 rounded-full`} style={{width:`${Math.min(parseFloat(sharePct),100)}%`}}/>
              </div>
              <span className="text-xs font-bold text-gray-700">{sharePct}%</span>
            </div>
            <div className="text-xs text-gray-400 mt-1">of {fmt(investEETotal)} EE Internal total</div>
          </div>
        </div>

        <div className="px-3 pb-3">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 pt-2 border-t">Phase Breakdown</div>
          {SME_PHASES.map(ph=>{
            const pt = phaseTotals[ph];
            if (pt.eeInt===0) return null;
            const pct = grandTotal.eeInt>0 ? ((pt.eeInt/grandTotal.eeInt)*100).toFixed(0) : 0;
            const ps  = SME_PHASE_STYLES[ph];
            return (
              <div key={ph} className="mb-2">
                <div className="flex justify-between text-xs mb-0.5">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${ps.label}`}>{ph}</span>
                  <span className="text-gray-600 font-mono text-xs">{fmtK2(pt.eeInt)}</span>
                </div>
                <div className="bg-gray-100 rounded-full h-1.5">
                  <div className={`${ps.bar} h-1.5 rounded-full opacity-80`} style={{width:`${pct}%`}}/>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-3 pb-3">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 pt-2 border-t">Hours Summary</div>
          {grandTotal.installHrs>0 && (
            <div className="flex justify-between items-center px-2 py-1.5 rounded mb-1 bg-purple-50">
              <span className="text-xs text-gray-600">Install Hours</span>
              <span className="text-xs font-bold text-purple-700">{fmtHrs(grandTotal.installHrs)}</span>
            </div>
          )}
          {grandTotal.commHrs>0 && (
            <div className="flex justify-between items-center px-2 py-1.5 rounded mb-1 bg-teal-50">
              <span className="text-xs text-gray-600">Commission Hours</span>
              <span className="text-xs font-bold text-teal-700">{fmtHrs(grandTotal.commHrs)}</span>
            </div>
          )}
          {grandTotal.installHrs===0 && grandTotal.commHrs===0 && (
            <div className="text-xs text-gray-400 px-2">No EE hours in this discipline</div>
          )}
        </div>

        <div className="p-3 border-t mt-auto">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Actions</div>
          <button onClick={exportExcel} disabled={exporting||rows.length===0}
            className="w-full text-xs bg-[var(--primary-700)] hover:bg-[var(--primary-600)] disabled:opacity-50 text-white px-3 py-2 rounded font-semibold mb-1.5">
            {exporting?"⟳ Exporting…":"⬇ Export to Excel"}
          </button>
          <button onClick={()=>window.print()}
            className="w-full text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded font-semibold">
            🖨 Print Report
          </button>
          <div className="text-xs text-gray-400 mt-2 text-center">
            Replaces: <span className="font-mono">{discipline.macroName}</span>
          </div>
        </div>
      </div>

      {showEditor && (
        <SMEStructureEditor discs={discs} allCodes={allCodes}
          onSave={saveStructure} onClose={()=>setShowEditor(false)}/>
      )}
    </div>
  );
}

const APP_TABS = [
  {id:"hub",        label:"🔍 Investment Hub"},
  {id:"estimation", label:"⚡ Estimation Tool"},
  {id:"wbsmanager", label:"🗂 WBS Manager"},
  {id:"settings",   label:"🎨 Settings"},
];

// ── THEMES ──────────────────────────────────────────────────────
// Each theme maps to a [data-theme] block in index.css that defines
// the --primary-50..900 (and --accent-*) CSS variables used across
// the app's headers, tabs, buttons, badges and links.
const THEMES = [
  {
    id: "ee", name: "Essential Energy", desc: "Corporate navy & orange (default)",
    swatches: ["#002266", "#1F478A", "#4A7BC1", "#FF5300"],
  },
  {
    id: "classic", name: "Classic Blue", desc: "Original demo blue theme",
    swatches: ["#1e3a8a", "#1d4ed8", "#3b82f6", "#ea580c"],
  },
  {
    id: "slate", name: "Slate", desc: "Neutral monochrome theme",
    swatches: ["#0f172a", "#334155", "#64748b", "#d97706"],
  },
];

// ── USER ACCESS / PINs ──────────────────────────────────────────
// Lightweight role + PIN model. In the Power Platform build this maps
// to Azure AD security groups; here it's localStorage-backed so the
// demo can show how a "logged in vs read-only" workflow would behave,
// and how an estimate gets locked to whoever is actively editing it.
const ROLES = [
  "ND Manager",
  "ND Team Leader",
  "Senior Engineering Officer",
  "Estimation Senior Specialist",
  "Estimation Specialist",
];
const DEFAULT_USERS = [
  {id:"u1", name:"Steven Hannigan", role:"Estimation Senior Specialist", pin:"1234"},
  {id:"u2", name:"Daniel Lawrence",  role:"ND Team Leader",               pin:"2345"},
  {id:"u3", name:"ND Manager",       role:"ND Manager",                   pin:"1607"},
];
const ROLES_THAT_CAN_RELEASE_LOCKS = ["ND Manager","ND Team Leader"];

const loadUsers = () => {
  try {
    const raw = localStorage.getItem("iet_users");
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return DEFAULT_USERS;
};
const saveUsers = (users) => {
  try { localStorage.setItem("iet_users", JSON.stringify(users)); } catch(e) {}
};

function UserAccessSettings({ users, setUsers, currentUser }) {
  const [showPins, setShowPins] = useState(false);
  const [draft, setDraft] = useState({ name:"", role:ROLES[ROLES.length-1], pin:"" });
  const [error, setError] = useState("");

  const update = (id, field, val) => {
    const updated = users.map(u=>u.id===id?{...u,[field]:val}:u);
    setUsers(updated); saveUsers(updated);
  };
  const remove = (id) => {
    const updated = users.filter(u=>u.id!==id);
    setUsers(updated); saveUsers(updated);
  };
  const addUser = () => {
    setError("");
    if (!draft.name.trim()) { setError("Enter a name."); return; }
    if (!/^\d{4}$/.test(draft.pin)) { setError("PIN must be exactly 4 digits."); return; }
    const updated = [...users, { id:`u_${Date.now()}`, name:draft.name.trim(), role:draft.role, pin:draft.pin }];
    setUsers(updated); saveUsers(updated);
    setDraft({ name:"", role:ROLES[ROLES.length-1], pin:"" });
  };

  return (
    <div className="mt-6">
      <h2 className="text-lg font-bold text-gray-900 mb-1">🔐 User Access &amp; PINs</h2>
      <p className="text-xs text-gray-500 mb-4">
        Add a 4-digit PIN for each person who needs to edit estimates. Anyone without a PIN sees the
        tool in <span className="font-semibold">read-only mode</span> (Investment Hub, summaries and
        financial reports remain visible). When a user opens an estimate, it's locked to them — other
        users see it as read-only with their name shown until the lock is released. ND Managers and
        ND Team Leaders can release a stuck lock.
      </p>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wide">
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Role</th>
              <th className="px-3 py-2 text-left">PIN</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u=>(
              <tr key={u.id} className="border-t border-gray-100">
                <td className="px-3 py-1.5">
                  <input value={u.name} onChange={e=>update(u.id,"name",e.target.value)}
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-[var(--primary-400)]"/>
                </td>
                <td className="px-3 py-1.5">
                  <select value={u.role} onChange={e=>update(u.id,"role",e.target.value)}
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:border-[var(--primary-400)]">
                    {ROLES.map(r=><option key={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <input value={u.pin} type={showPins?"text":"password"} maxLength={4} inputMode="numeric"
                    onChange={e=>update(u.id,"pin",e.target.value.replace(/\D/g,"").slice(0,4))}
                    className="w-20 border border-gray-200 rounded px-2 py-1 text-xs font-mono tracking-widest focus:outline-none focus:border-[var(--primary-400)]"/>
                </td>
                <td className="px-3 py-1.5 text-right">
                  {currentUser?.id===u.id && <span className="text-xs text-green-600 font-semibold mr-2">● signed in</span>}
                  <button onClick={()=>remove(u.id)} className="text-red-400 hover:bg-red-50 px-1.5 py-1 rounded">🗑</button>
                </td>
              </tr>
            ))}
            <tr className="border-t border-gray-100 bg-gray-50">
              <td className="px-3 py-1.5">
                <input value={draft.name} placeholder="New person's name" onChange={e=>setDraft(d=>({...d,name:e.target.value}))}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-[var(--primary-400)]"/>
              </td>
              <td className="px-3 py-1.5">
                <select value={draft.role} onChange={e=>setDraft(d=>({...d,role:e.target.value}))}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:border-[var(--primary-400)]">
                  {ROLES.map(r=><option key={r}>{r}</option>)}
                </select>
              </td>
              <td className="px-3 py-1.5">
                <input value={draft.pin} type={showPins?"text":"password"} maxLength={4} inputMode="numeric" placeholder="••••"
                  onChange={e=>setDraft(d=>({...d,pin:e.target.value.replace(/\D/g,"").slice(0,4)}))}
                  className="w-20 border border-gray-200 rounded px-2 py-1 text-xs font-mono tracking-widest focus:outline-none focus:border-[var(--primary-400)]"/>
              </td>
              <td className="px-3 py-1.5 text-right">
                <button onClick={addUser} className="text-xs bg-[var(--primary-700)] hover:bg-[var(--primary-600)] text-white px-2.5 py-1 rounded font-semibold">+ Add</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-between">
          {error && <span className="text-xs text-red-600">{error}</span>}
          <span className="flex-1"/>
          <button onClick={()=>setShowPins(s=>!s)} className="text-xs text-gray-500 hover:text-gray-700">
            {showPins?"🙈 Hide PINs":"👁 Show PINs"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Login modal — pick a person from the user list and enter their PIN.
function LoginModal({ users, onLogin, onClose }) {
  const [userId, setUserId] = useState(users[0]?.id || "");
  const [pin,    setPin]    = useState("");
  const [error,  setError]  = useState(false);

  const submit = () => {
    const u = users.find(x=>x.id===userId);
    if (u && u.pin === pin) { onLogin(u); }
    else { setError(true); setPin(""); setTimeout(()=>setError(false),1200); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[360px]" onClick={e=>e.stopPropagation()}>
        <div className="bg-[var(--primary-900)] text-white px-5 py-4 rounded-t-xl">
          <div className="font-bold text-base">🔑 Sign in</div>
          <div className="text-[var(--primary-200)] text-xs mt-1">Enter your PIN to make changes — viewing stays open to everyone</div>
        </div>
        <div className="p-5 space-y-3">
          {users.length===0 ? (
            <div className="text-xs text-gray-500">No users configured yet — add yourself in 🎨 Settings → User Access.</div>
          ) : (
            <>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Name</label>
                <select value={userId} onChange={e=>{setUserId(e.target.value);setPin("");setError(false);}}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-[var(--primary-500)]">
                  {users.map(u=><option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">PIN</label>
                <input autoFocus type="password" inputMode="numeric" maxLength={4} value={pin}
                  onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,4))}
                  onKeyDown={e=>{if(e.key==="Enter") submit();}}
                  className={`w-full border rounded px-2 py-1.5 text-sm font-mono tracking-[0.5em] text-center focus:outline-none ${error?"border-red-400 bg-red-50":"border-gray-300 focus:border-[var(--primary-500)]"}`}/>
                {error && <div className="text-xs text-red-600 mt-1">Incorrect PIN — try again.</div>}
              </div>
            </>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={submit} disabled={users.length===0 || pin.length!==4}
              className="flex-1 bg-[var(--primary-700)] hover:bg-[var(--primary-600)] disabled:opacity-40 text-white text-sm py-2 rounded font-semibold">
              Sign in
            </button>
            <button onClick={onClose} className="px-4 border border-gray-200 text-gray-600 text-sm py-2 rounded hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
function ThemeSettings({ theme, onChange, users, setUsers, currentUser }) {
  return (
    <div className="flex-1 overflow-auto p-6 bg-gray-50">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-lg font-bold text-gray-900 mb-1">🎨 Appearance</h2>
        <p className="text-xs text-gray-500 mb-5">
          Choose a colour theme for the demo. The Essential Energy theme matches our corporate
          branding (navy &amp; orange); the alternates are useful for contrast/comparison during
          stakeholder reviews. Your choice is saved in this browser only.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {THEMES.map(t => {
            const active = theme === t.id;
            return (
              <button key={t.id} onClick={() => onChange(t.id)}
                className={`text-left rounded-xl border-2 p-4 bg-white transition-all ${
                  active ? "border-[var(--primary-600)] shadow-md ring-2 ring-[var(--primary-200)]" : "border-gray-200 hover:border-gray-300 hover:shadow-sm"}`}>
                <div className="flex gap-1.5 mb-3">
                  {t.swatches.map((c,i)=>(
                    <div key={i} className="h-8 flex-1 rounded" style={{background:c}}/>
                  ))}
                </div>
                <div className="font-semibold text-sm text-gray-900 flex items-center gap-1.5">
                  {t.name}
                  {active && <span className="text-[var(--primary-600)]">✓</span>}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{t.desc}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-gray-700 mb-2">Live preview</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 py-1.5 rounded text-xs font-semibold text-white bg-[var(--primary-600)]">Primary button</span>
            <span className="px-3 py-1.5 rounded text-xs font-semibold border border-[var(--primary-200)] bg-[var(--primary-50)] text-[var(--primary-700)]">Light badge</span>
            <span className="px-3 py-1.5 rounded text-xs font-bold text-white" style={{background:"var(--accent-600)"}}>Accent</span>
            <span className="px-3 py-1.5 rounded text-xs font-semibold text-[var(--primary-700)] border-b-2 border-[var(--primary-600)] bg-[var(--primary-50)]">Active tab</span>
          </div>
        </div>

        <UserAccessSettings users={users} setUsers={setUsers} currentUser={currentUser}/>
      </div>
    </div>
  );
}
const EST_TABS = [
  {id:"setup",    label:"⚙️ Investment Setup"},
  {id:"estimate", label:"📐 Estimation"},
  {id:"equipment",label:"📦 Equipment"},
  {id:"review",   label:"📋 Review Lines"},
  {id:"summary",  label:"📊 Summary"},
  {id:"financial", label:"💰 Financial Report"},
  {id:"sme",       label:"📡 SME Reports"},
  {id:"cart",      label:"🎲 CART"},
];

// ── ERROR BOUNDARY ───────────────────────────────────────────────
// Catches any unhandled render errors and shows a recovery screen
// instead of a blank page.
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error:null, info:null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { this.setState({ error, info }); }
  render() {
    if (this.state.error) {
      return (
        <div style={{fontFamily:"monospace",padding:"2rem",maxWidth:"700px",margin:"2rem auto"}}>
          <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:"8px",padding:"1.5rem"}}>
            <div style={{fontWeight:"bold",color:"#991B1B",fontSize:"16px",marginBottom:"8px"}}>
              ⚠️ IET Estimation Tool — Render Error
            </div>
            <div style={{color:"#7F1D1D",fontSize:"13px",marginBottom:"12px"}}>
              {this.state.error?.message || "Unknown error"}
            </div>
            <details style={{fontSize:"11px",color:"#9CA3AF"}}>
              <summary style={{cursor:"pointer",marginBottom:"6px"}}>Stack trace</summary>
              <pre style={{overflow:"auto",maxHeight:"200px",background:"#F9FAFB",padding:"8px",borderRadius:"4px"}}>
                {this.state.error?.stack}
              </pre>
            </details>
            <button
              onClick={() => { this.setState({error:null,info:null}); window.location.reload(); }}
              style={{marginTop:"12px",background:"#1e3a5f",color:"#fff",border:"none",borderRadius:"6px",padding:"8px 16px",cursor:"pointer",fontSize:"12px"}}>
              🔄 Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [appTab,      setAppTab]      = useState("hub");
  const [estTab,      setEstTab]      = useState("estimate");

  // Theme — persisted in localStorage, applied to <html data-theme="...">
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("iet_theme") || "ee"; } catch { return "ee"; }
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("iet_theme", theme); } catch(e) {}
  }, [theme]);

  // ── User access / login ────────────────────────────────────────
  const [users, setUsersState] = useState(() => loadUsers());
  const setUsers = useCallback((u)=>{ setUsersState(u); saveUsers(u); }, []);
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const raw = sessionStorage.getItem("iet_session_user");
      if (!raw) return null;
      const sess = JSON.parse(raw);
      // Re-validate against the live user list (PIN/role may have changed)
      const fresh = loadUsers().find(u=>u.id===sess.id);
      return fresh || null;
    } catch { return null; }
  });
  const [showLogin, setShowLogin] = useState(false);
  const handleLogin = useCallback((u)=>{
    setCurrentUser(u);
    try { sessionStorage.setItem("iet_session_user", JSON.stringify(u)); } catch(e) {}
    setShowLogin(false);
  },[]);
  const handleLogout = useCallback(()=>{
    setCurrentUser(null);
    try { sessionStorage.removeItem("iet_session_user"); } catch(e) {}
  },[]);
  // Lock info for the estimate currently open: {name, role, since} of whoever else has it open
  const [editLockInfo, setEditLockInfo] = useState(null);
  // Release the edit-lock on a record (if held by currentUser, or forced by a manager/team leader)
  const releaseLock = useCallback((recordId, force=false)=>{
    if (!recordId) return;
    try {
      const existing = JSON.parse(localStorage.getItem("iet_investments")||"[]");
      const updated = existing.map(s=>{
        if (s.id!==recordId || !s._editingBy) return s;
        if (force || (currentUser && s._editingBy.name===currentUser.name)) {
          const {_editingBy, ...rest} = s; return rest;
        }
        return s;
      });
      localStorage.setItem("iet_investments", JSON.stringify(updated));
    } catch(e) {}
    setEditLockInfo(null);
  },[currentUser]);

  const [inv,         setInv]         = useState(defaultInv);
  const [lines,       setLines]       = useState({});
  // Commercial rates only apply to Commercially Funded investments
  const isCommercial = inv.type === "Commercially Funded";
  const [lastSaved,   setLastSaved]   = useState(null);
  // Change log — tracks edits to estimate lines & investment setup (declared
  // here, ahead of saveInvestment, since it's referenced in its deps array)
  const [changeLog, setChangeLog] = useState([]);
  const [showChangeLog, setShowChangeLog] = useState(false);

  // Track the portfolio record ID currently loaded (null = new/unsaved)
  const [currentRecordId, setCurrentRecordId] = useState(null);
  // Lock state — true when loaded from an Approved record
  const [estimateLocked,  setEstimateLocked]  = useState(false);
  // Rate snapshot of the currently loaded Approved record (null = live pricing)
  const [activeSnapshot,  setActiveSnapshot]  = useState(null);
  // Unlock-to-amend modal
  const [showUnlockModal, setShowUnlockModal] = useState(false);

  // Draft recovery — restore banner
  const [draftRecovery, setDraftRecovery] = useState(null); // {inv, lines, savedAt} | null
  // On mount, check for an interrupted session
  useEffect(() => {
    try {
      const raw = localStorage.getItem("iet_draft_recovery");
      if (!raw) return;
      const draft = JSON.parse(raw);
      // Only offer if it has real data
      const hasLines = draft.lines && Object.values(draft.lines).some(l => parseFloat(l.qty||"0") > 0);
      if (hasLines) setDraftRecovery(draft);
    } catch(e) {}
  }, []);

  // Autosave draft every 45s whenever lines or inv changes
  const draftTimerRef = useRef(null);
  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      try {
        const hasLines = Object.values(lines).some(l => parseFloat(l.qty||"0") > 0);
        if (hasLines) {
          localStorage.setItem("iet_draft_recovery", JSON.stringify({
            inv, lines, savedAt: new Date().toISOString(), recordId: currentRecordId,
          }));
        }
      } catch(e) {}
    }, 45000);
    return () => clearTimeout(draftTimerRef.current);
  }, [inv, lines, currentRecordId]);

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
  const [equipPricing, setEquipPricing]  = useState({});

  // Callback for EquipmentPricingEditor to update a single item
  // This triggers resolvedSupply/resolvedEquipment recompute via useMemo dependencies
  const handlePriceUpdate = useCallback((key, updatedRow) => {
    setEquipPricing(prev => ({ ...prev, [key]: updatedRow }));
  }, []);
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
      fetch(`${BASE}data/equipment_pricing.json`).then(r=>{if(!r.ok)return {};return r.json();}).catch(()=>({})),
      fetch(`${BASE}data/inventory_materials.json`).then(r=>{if(!r.ok)return [];return r.json();}).catch(()=>[]),
      fetch(`${BASE}data/material_assemblies.json`).then(r=>{if(!r.ok)return [];return r.json();}).catch(()=>[]),
    ])
    .then(([wbs,rates,supply,equip,lookup,commLookup,escRatesData,resourceCodesData,equipPricingData,invMatsData,matAssData])=>{
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
      setEquipPricing(equipPricingData || {});
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

    const now = new Date();
    const record = {
      id: currentRecordId || Date.now(),
      savedAt: now.toLocaleString("en-AU",{dateStyle:"short",timeStyle:"short"}),
      savedAtISO: now.toISOString(),
      status: "Draft",
      inv, lines, linesCount:entered.length, changeLog,
      totalSupplyLines: supply.filter(s=>s.scope==="Supply"||s.scope==="Supply & Install").length,
      totalEE:Math.round(totals.eeInt), totalComm:Math.round(totals.comm),
      totalInstallHrs: Math.round(totals.installHrs||0),
      phaseBreakdown: totals.byPhase||{},
    };
    try {
      const existing = JSON.parse(localStorage.getItem("iet_investments")||"[]");
      const updated = [record, ...existing.filter(s=>s.id!==record.id&&(s.inv.number!==inv.number||s.inv.revision!==inv.revision))];
      localStorage.setItem("iet_investments", JSON.stringify(updated));
      setCurrentRecordId(record.id);
      setLastSaved(record.savedAt);
      // Clear draft recovery — estimate is now formally saved
      localStorage.removeItem("iet_draft_recovery");
      setDraftRecovery(null);
    } catch(e) { alert("Save failed — localStorage may be full"); }
  },[inv,lines,isCommercial,supplyData,currentRecordId,changeLog]);

  const loadInvestment = useCallback((record)=>{
    const isApproved = record.status === "Approved";
    // Stamp _locked onto inv so the Setup form can show/disable accordingly
    setInv({...record.inv, _locked: isApproved});
    setLines(record.lines||{});
    setChangeLog(record.changeLog||[]);
    setLastSaved(record.savedAt);
    setCurrentRecordId(record.id || null);
    setEstimateLocked(isApproved);
    setActiveSnapshot(isApproved ? (record.rateSnapshot || null) : null);
    setAppTab("estimation");
    setEstTab("summary");
    // Clear draft recovery once deliberately loading a record
    localStorage.removeItem("iet_draft_recovery");
    setDraftRecovery(null);

    // ── Editing lock: claim the estimate for currentUser, or show
    // a read-only banner if someone else already has it open.
    if (isApproved) { setEditLockInfo(null); return; }
    const lock = record._editingBy;
    if (lock && (!currentUser || lock.name !== currentUser.name)) {
      setEditLockInfo(lock);
    } else if (currentUser) {
      setEditLockInfo(null);
      try {
        const existing = JSON.parse(localStorage.getItem("iet_investments")||"[]");
        const updated = existing.map(s=>s.id===record.id
          ? {...s, _editingBy:{name:currentUser.name, role:currentUser.role, since:new Date().toISOString()}}
          : s);
        localStorage.setItem("iet_investments", JSON.stringify(updated));
      } catch(e) {}
    } else {
      setEditLockInfo(null); // guest viewing — global read-only handles this
    }
  },[currentUser]);

  const [pendingNew,    setPendingNew]    = useState(false); // waiting for save-prompt confirm

  const newEstimate = useCallback(()=>{
    // Check if current estimate has unsaved lines
    const hasLines = Object.values(lines).some(l=>parseFloat(l.qty||"0")>0);
    if (hasLines) {
      setPendingNew(true); // triggers modal
    } else {
      releaseLock(currentRecordId);
      setInv({...defaultInv, name:"", number:""});
      setLines({});
      setChangeLog([]);
      setLastSaved(null);
      setCurrentRecordId(null);
      setEstimateLocked(false);
      setActiveSnapshot(null);
      setAppTab("estimation");
      setEstTab("setup");
    }
  },[lines,currentRecordId,releaseLock]);

  const confirmNew = useCallback((save)=>{
    if (save) saveInvestment();
    releaseLock(currentRecordId);
    setInv({...defaultInv, name:"", number:""});
    setLines({});
    setChangeLog([]);
    setLastSaved(null);
    setCurrentRecordId(null);
    setEstimateLocked(false);
    setActiveSnapshot(null);
    setPendingNew(false);
    setAppTab("estimation");
    setEstTab("setup");
  },[saveInvestment,currentRecordId,releaseLock]);

  // Unlock approved estimate — clone to new Draft, keep original intact
  // Revision sequence A→B→C→D→E→F→G→H
  const REVISIONS = ["A","B","C","D","E","F","G","H"];
  const nextRevision = (current) => {
    const idx = REVISIONS.indexOf((current||"A").toUpperCase());
    return REVISIONS[Math.min(idx + 1, REVISIONS.length - 1)];
  };

  // Unlock approved estimate — clone to new Draft with next revision letter, keep original intact
  const amendEstimate = useCallback(()=>{
    const currentRev = inv.revision || "A";
    const newRev     = nextRevision(currentRev);
    const baseName   = inv.name.replace(/\s*\(Amendment\w*\)\s*$/i, "").trim();
    const amendedInv = {
      ...inv,
      name:       baseName,   // same investment name — revision letter differentiates
      revision:   newRev,     // auto-incremented revision letter
      estClass:   "Class 5", // all revisions start at Class 5
      reviewedBy: "",         // clear reviewer — fresh review cycle
    };
    const now = new Date();
    const newId = Date.now();
    const amendRecord = {
      id: newId,
      savedAt: now.toLocaleString("en-AU",{dateStyle:"short",timeStyle:"short"}),
      savedAtISO: now.toISOString(),
      status: "Draft",
      inv: amendedInv,
      lines: JSON.parse(JSON.stringify(lines)), // deep copy
      linesCount: Object.values(lines).filter(l=>parseFloat(l.qty||"0")>0).length,
      totalSupplyLines: 0,
      totalEE: 0, totalComm: 0,
      _amendmentOf:         currentRecordId,
      _amendmentOfName:     inv.name,
      _amendmentOfRevision: currentRev,
      _amendmentToRevision: newRev,
    };
    try {
      const existing = JSON.parse(localStorage.getItem("iet_investments")||"[]");
      localStorage.setItem("iet_investments", JSON.stringify([amendRecord, ...existing]));
    } catch(e) {}
    setInv(amendedInv);
    setCurrentRecordId(newId);
    setEstimateLocked(false);
    setActiveSnapshot(null); // amendment re-prices against current rates
    setShowUnlockModal(false);
    setLastSaved(amendRecord.savedAt);
    setAppTab("estimation");
    setEstTab("setup"); // land on Setup so estimator sees the new revision letter
  },[inv, lines, currentRecordId]);
  // ── Change log — tracks edits to estimate lines & investment setup ──
  // Stored with the saved record so it survives reload/re-open.
  const FIELD_LABELS = {
    qty:"Quantity", factor:"Factor", delivery:"Delivery", instHrsOvrd:"Install Hrs (override)",
    contrRate:"Contractor Rate", plant:"Plant Cost", mats:"Materials Cost", resourceOvrd:"Resource Override",
  };
  const logChange = useCallback((entries)=>{
    if (!entries.length) return;
    setChangeLog(prev=>[...prev, ...entries].slice(-50));
  },[]);

  const trackedSetLines = useCallback((updater)=>{
    setLines(prev=>{
      const next = typeof updater==="function" ? updater(prev) : updater;
      const entries = [];
      const ts = new Date().toISOString();
      const codes = new Set([...Object.keys(prev||{}), ...Object.keys(next||{})]);
      codes.forEach(code=>{
        const before = prev?.[code] || {};
        const after  = next?.[code] || {};
        const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
        fields.forEach(f=>{
          if (f.startsWith("_")) return;
          const ov = before[f] ?? "";
          const nv = after[f] ?? "";
          if (String(ov) !== String(nv)) {
            const item = supplyData.find(s=>s.wbs_code===code);
            entries.push({
              ts, user: currentUser?.name || "Guest",
              wbsCode: code, description: item?.description || "",
              field: FIELD_LABELS[f] || f, oldVal: ov===""?"—":ov, newVal: nv===""?"—":nv,
            });
          }
        });
      });
      logChange(entries);
      return next;
    });
  },[supplyData,currentUser,logChange]);

  const trackedSetInv = useCallback((updater)=>{
    setInv(prev=>{
      const next = typeof updater==="function" ? updater(prev) : updater;
      const entries = [];
      const ts = new Date().toISOString();
      Object.keys(next||{}).forEach(f=>{
        if (f.startsWith("_")) return;
        const ov = prev?.[f] ?? "";
        const nv = next?.[f] ?? "";
        if (String(ov) !== String(nv)) {
          entries.push({
            ts, user: currentUser?.name || "Guest",
            wbsCode: "Setup", description: "Investment Setup",
            field: f, oldVal: ov===""?"—":String(ov), newVal: nv===""?"—":String(nv),
          });
        }
      });
      logChange(entries);
      return next;
    });
  },[currentUser,logChange]);

  // Revert a single change-log entry — sets that field back to its previous value
  const revertChange = useCallback((entry)=>{
    if (entry.wbsCode==="Setup") {
      trackedSetInv(prev=>({...prev, [entry.field]: entry.oldVal==="—"?"":entry.oldVal}));
    } else {
      const f = Object.keys(FIELD_LABELS).find(k=>FIELD_LABELS[k]===entry.field) || entry.field;
      trackedSetLines(prev=>({...prev, [entry.wbsCode]: {...(prev[entry.wbsCode]||{}), [f]: entry.oldVal==="—"?"":entry.oldVal}}));
    }
  },[trackedSetInv,trackedSetLines]);

  // Effective edit lock = Approved record, locked by another user, or not signed in (guest = read-only)
  const effectiveLocked = estimateLocked || !!editLockInfo || !currentUser;
  const linesEntered  = Object.values(lines).filter(l=>parseFloat(l.qty)>0).length;

  const equipSelected = Object.values(equipSel).filter(q=>parseFloat(q)>0).length;

  // ── Resolve equipment pricing into supply items ─────────────────────
  // equipPricing holds base_price + price_date + esc_rate for PCE/SCADA/Comms items.
  // When a manager edits a price in Equipment Pricing, the new escalated_price overrides
  // pce_price in supply. Everything that reads supply (calcLine, EquipmentScreen,
  // Copperleaf export, Equipment Catalogue) automatically picks up the updated price.
  const resolvedSupply = useMemo(() => {
    // Approved estimate loaded → prices come from the snapshot frozen at
    // approval, NOT from live equipment pricing / escalation (Prompt 3F).
    if (activeSnapshot?.prices) {
      return supplyData.map(item =>
        activeSnapshot.prices[item.wbs_code] != null
          ? { ...item, pce_price: activeSnapshot.prices[item.wbs_code] }
          : item
      );
    }
    if (!equipPricing || Object.keys(equipPricing).length === 0) return supplyData;
    return supplyData.map(item => {
      const ep = equipPricing[item.wbs_code];
      if (!ep) return item;
      // Use escalated_price if manager has saved an edit, otherwise recalculate on the fly
      const escalated = ep.escalated_price != null
        ? ep.escalated_price
        : (() => {
            const base = ep.base_price;
            const rate = ep.esc_rate ?? 0.06;
            const dateStr = ep.price_date;
            if (!base || base <= 0) return item.pce_price;
            if (!dateStr) return base * (1 + rate);
            const yrs = (Date.now() - new Date(dateStr).getTime()) / (1000*60*60*24*365.25);
            return yrs > 0 ? base * Math.pow(1 + rate, yrs) : base;
          })();
      if (escalated == null) return item;
      return { ...item, pce_price: escalated };
    });
  }, [supplyData, equipPricing, activeSnapshot]);

  // ── Resolve equipment pricing into the equipment catalogue items ────────
  const resolvedEquipment = useMemo(() => {
    if (!equipPricing || Object.keys(equipPricing).length === 0) return equipData;
    return equipData.map(item => {
      const ep = equipPricing[item.wbs_code];
      if (!ep) return item;
      const escalated = ep.escalated_price != null
        ? ep.escalated_price
        : (() => {
            const base = ep.base_price;
            const rate = ep.esc_rate ?? 0.06;
            const dateStr = ep.price_date;
            if (!base || base <= 0) return item.price;
            if (!dateStr) return base * (1 + rate);
            const yrs = (Date.now() - new Date(dateStr).getTime()) / (1000*60*60*24*365.25);
            return yrs > 0 ? base * Math.pow(1 + rate, yrs) : base;
          })();
      if (escalated == null) return item;
      return { ...item, price: escalated, _priceFromEquipPricing: true };
    });
  }, [equipData, equipPricing]);

  return (
    <ErrorBoundary>
    <DataCtx.Provider value={{wbs:wbsData,rates:(activeSnapshot?.rates?.length ? activeSnapshot.rates : ratesData),supply:resolvedSupply,equipment:resolvedEquipment,equipLookup,commLookup,commProfiles,escRates,resourceCodes,equipPricing,invMats,matAssemblies,loading,error}}>
      <div className="flex flex-col h-screen font-sans text-sm select-none">

        {/* Top nav */}
        <div className="bg-[var(--primary-900)] text-white px-4 py-0 flex items-center gap-0 flex-shrink-0 shadow-lg">
          <div className="flex items-center gap-2 mr-5 py-3">
            <span className="text-orange-400 text-lg">⚡</span>
            <span className="font-bold text-sm tracking-wide">IET Demo</span>
            <span className="text-[var(--primary-500)] text-xs">|</span>
            <span className="text-[var(--primary-300)] text-xs truncate max-w-48">{inv.name}</span>
          </div>
          {APP_TABS.map(tab=>(
            <button key={tab.id} onClick={()=>{
                if (appTab==="estimation" && tab.id!=="estimation" && !estimateLocked && !editLockInfo) releaseLock(currentRecordId);
                setAppTab(tab.id);
              }}
              className={`px-5 py-3 text-xs font-semibold transition-colors border-b-2 ${
                appTab===tab.id?"border-orange-400 text-white bg-[var(--primary-800)]":"border-transparent text-[var(--primary-300)] hover:text-white hover:bg-[var(--primary-800)]"}`}>
              {tab.label}
              {tab.id==="saved"&&<span className="ml-1 text-xs bg-[var(--primary-700)] text-[var(--primary-200)] px-1.5 py-0.5 rounded-full font-mono">
                {(()=>{try{return JSON.parse(localStorage.getItem("iet_investments")||"[]").length}catch{return 0}})()}
              </span>}
            </button>
          ))}
          <div className="flex-1"/>
          {loading&&<span className="text-xs text-[var(--primary-300)] animate-pulse pr-4">⟳ Loading live data…</span>}
          {!loading&&!error&&<span className="text-xs text-green-400 pr-4">✓ {wbsData.length} WBS · {supplyData.length} items · {equipData.length} equipment · {ratesData.length} rates</span>}
          {error&&<span className="text-xs text-red-400 pr-4">⚠ Data error — {error}</span>}
          {currentUser ? (
            <div className="flex items-center gap-2 pr-4 pl-2 border-l border-[var(--primary-700)] ml-2 h-full">
              <span className="text-xs text-white font-semibold">👤 {currentUser.name}</span>
              <span className="text-[10px] text-[var(--primary-300)]">{currentUser.role}</span>
              <button onClick={handleLogout} className="text-[10px] text-[var(--primary-300)] hover:text-white underline ml-1">Sign out</button>
            </div>
          ) : (
            <button onClick={()=>setShowLogin(true)}
              className="flex items-center gap-1.5 text-xs text-[var(--primary-200)] hover:text-white pr-4 pl-3 border-l border-[var(--primary-700)] ml-2 h-full">
              👁 Read-only · <span className="underline">Sign in</span>
            </button>
          )}
        </div>
        {showLogin && <LoginModal users={users} onLogin={handleLogin} onClose={()=>setShowLogin(false)}/>}

        {/* Draft recovery banner */}
        {draftRecovery && (
          <div className="bg-amber-50 border-b border-amber-300 px-4 py-2 flex items-center gap-3 flex-shrink-0 z-40">
            <span className="text-lg">⚠️</span>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-semibold text-amber-800">Unsaved draft recovered — </span>
              <span className="text-xs text-amber-700">
                {draftRecovery.inv?.name || "unnamed estimate"} · {Object.values(draftRecovery.lines||{}).filter(l=>parseFloat(l.qty||"0")>0).length} lines ·
                last autosaved {draftRecovery.savedAt ? new Date(draftRecovery.savedAt).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit"}) : "recently"}
              </span>
            </div>
            <button
              onClick={()=>{
                setInv(draftRecovery.inv);
                setLines(draftRecovery.lines||{});
                setCurrentRecordId(draftRecovery.recordId||null);
                setEstimateLocked(false);
                setActiveSnapshot(null);
                setDraftRecovery(null);
                localStorage.removeItem("iet_draft_recovery");
                setAppTab("estimation");
                setEstTab("estimate");
              }}
              className="text-xs bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded font-semibold flex-shrink-0">
              ↩ Restore Draft
            </button>
            <button
              onClick={()=>{ setDraftRecovery(null); localStorage.removeItem("iet_draft_recovery"); }}
              className="text-xs text-amber-600 hover:text-amber-800 px-2 py-1 rounded flex-shrink-0">
              Discard
            </button>
          </div>
        )}

        {/* Approved lock banner */}
        {estimateLocked && appTab==="estimation" && (
          <div className="bg-green-50 border-b border-green-300 px-4 py-2 flex items-center gap-3 flex-shrink-0 z-40">
            <span className="text-base">🔒</span>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-semibold text-green-800">Approved · Rev {inv.revision||"A"} — estimate is locked. </span>
              {activeSnapshot
                ? <span className="text-xs font-semibold text-green-800">🧊 Rates frozen at approval ({new Date(activeSnapshot.takenAt).toLocaleDateString("en-AU")}). </span>
                : <span className="text-xs font-semibold text-amber-700">⚠ Approved before rate snapshots — prices shown are CURRENT rates, not approval-date rates. </span>}
              <span className="text-xs text-green-700">Read-only. Unlock to create a new Draft at Rev {["A","B","C","D","E","F","G","H"][Math.min(["A","B","C","D","E","F","G","H"].indexOf((inv.revision||"A").toUpperCase())+1,7)]} — preserves this approved record.</span>
            </div>
            <button
              onClick={()=>setShowUnlockModal(true)}
              className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded font-semibold flex-shrink-0 flex items-center gap-1.5">
              🔓 Unlock to Amend
            </button>
          </div>
        )}

        {/* Editing-lock banner — someone else has this estimate open */}
        {editLockInfo && appTab==="estimation" && (
          <div className="bg-red-50 border-b border-red-300 px-4 py-2 flex items-center gap-3 flex-shrink-0 z-40">
            <span className="text-base">🔒</span>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-semibold text-red-800">Read-only — currently being edited by {editLockInfo.name} ({editLockInfo.role}). </span>
              <span className="text-xs text-red-700">
                Locked since {editLockInfo.since ? new Date(editLockInfo.since).toLocaleString("en-AU",{dateStyle:"short",timeStyle:"short"}) : "recently"}.
                Changes here won't be saved until the lock is released.
              </span>
            </div>
            {currentUser && ROLES_THAT_CAN_RELEASE_LOCKS.includes(currentUser.role) && (
              <button onClick={()=>releaseLock(currentRecordId, true)}
                className="text-xs bg-red-700 hover:bg-red-600 text-white px-3 py-1.5 rounded font-semibold flex-shrink-0">
                🔓 Release lock
              </button>
            )}
          </div>
        )}

        {/* Guest read-only banner */}
        {!currentUser && !editLockInfo && appTab==="estimation" && !estimateLocked && (
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-1.5 flex items-center gap-3 flex-shrink-0 z-40">
            <span className="text-xs text-gray-500">👁 Viewing in read-only mode.</span>
            <button onClick={()=>setShowLogin(true)} className="text-xs text-[var(--primary-700)] hover:underline font-semibold">Sign in to make changes</button>
          </div>
        )}
        {showUnlockModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={()=>setShowUnlockModal(false)}>
            <div className="bg-white rounded-xl shadow-2xl w-[440px]" onClick={e=>e.stopPropagation()}>
              <div className="bg-green-800 text-white px-5 py-4 rounded-t-xl">
                <div className="font-bold text-base">🔓 Unlock Approved Estimate</div>
                <div className="text-green-200 text-xs mt-1">Team Leader authorisation required</div>
              </div>
              <div className="p-5 space-y-4">
                {(()=>{
                  const curRev = inv.revision || "A";
                  const nxtRev = ["A","B","C","D","E","F","G","H"][Math.min(["A","B","C","D","E","F","G","H"].indexOf(curRev.toUpperCase())+1,7)];
                  return (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                      <div className="font-semibold mb-2">What happens when you unlock:</div>
                      <ul className="space-y-1.5 list-disc list-inside text-amber-700">
                        <li>The <span className="font-semibold">Rev {curRev} approved record stays locked</span> — permanent audit trail</li>
                        <li>A new <span className="font-semibold">Draft is created</span> with all quantities copied across</li>
                        <li>Revision automatically advances: <span className="font-mono font-bold text-amber-900">Rev {curRev} → Rev {nxtRev}</span></li>
                        <li>Estimate class resets to <span className="font-semibold">Class 5</span> — must go through review again</li>
                        <li>Reviewer is cleared — new sign-off required</li>
                      </ul>
                      <div className="mt-2.5 pt-2 border-t border-amber-200 flex items-center gap-2">
                        <span className="text-amber-600">New draft will be:</span>
                        <span className="font-mono font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded">{inv.name} · Rev {nxtRev} · Class 5 · Draft</span>
                      </div>
                    </div>
                  );
                })()}
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1.5">Team Leader PIN *</label>
                  <UnlockPinField onConfirm={amendEstimate} onCancel={()=>setShowUnlockModal(false)}/>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {appTab==="estimation" && (
            <>
              {/* Estimation sub-tabs */}
              <div className="bg-white border-b flex items-end px-4 flex-shrink-0 shadow-sm">
                {EST_TABS.map(tab=>(
                  <button key={tab.id} onClick={()=>setEstTab(tab.id)}
                    className={`relative px-4 py-2.5 text-xs font-semibold transition-colors border-b-2 mr-1 -mb-px ${
                      estTab===tab.id?"border-[var(--primary-600)] text-[var(--primary-700)] bg-[var(--primary-50)]":"border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"}`}>
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
                  <button onClick={()=>setShowChangeLog(true)}
                    className="relative text-xs font-semibold text-gray-500 hover:text-[var(--primary-700)] border border-gray-200 hover:border-[var(--primary-300)] rounded px-2 py-1 flex items-center gap-1">
                    📝 Recent Changes
                    {changeLog.length>0 && <span className="bg-[var(--primary-600)] text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">{Math.min(changeLog.length,99)}</span>}
                  </button>
                  <span className={`text-xs font-semibold ${isCommercial?"text-orange-600":"text-[var(--primary-600)]"}`}>
                    {isCommercial?"Commercial + ANS Rates":"EE Internal Rates only"}
                  </span>
                  <span className="text-xs text-gray-400">{inv.estimatedBy}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                    inv.type==="Commercially Funded"?"bg-orange-100 text-orange-700":"bg-[var(--primary-100)] text-[var(--primary-700)]"}`}>
                    {inv.type==="Commercially Funded"?"COMMERCIAL":"INTERNAL"}
                  </span>
                </div>
              </div>

              <div className="flex-1 overflow-hidden flex flex-col">
                {estTab==="setup"        && <InvestmentSetup inv={inv} onChange={effectiveLocked ? ()=>{} : trackedSetInv}/>}
                {estTab==="estimate"     && (
                  <div className="flex flex-1 overflow-hidden">
                    <EstimationScreen isCommercial={isCommercial} lines={lines} setLines={effectiveLocked ? ()=>{} : trackedSetLines}/>
                  </div>
                )}

                {estTab==="equipment"    && <EquipmentScreen lines={lines} setLines={effectiveLocked ? ()=>{} : trackedSetLines} isCommercial={isCommercial} inv={inv}/>}
                {estTab==="review"    && <ReviewLines lines={lines} isCommercial={isCommercial}/>}
                {estTab==="summary"   && <SummaryScreen inv={inv} lines={lines} isCommercial={isCommercial} equipSel={equipSel} onSave={effectiveLocked ? null : saveInvestment} lastSaved={lastSaved} estimateLocked={estimateLocked}/>}
                {estTab==="financial" && <FinancialScreen inv={inv} lines={lines} isCommercial={isCommercial}/>}
                {estTab==="sme"       && <SMEReportScreen inv={inv} lines={lines} isCommercial={isCommercial}/>}
                {estTab==="cart"      && <CARTScreen inv={inv} lines={lines} isCommercial={isCommercial} onChange={effectiveLocked ? ()=>{} : trackedSetInv} onSave={effectiveLocked ? null : saveInvestment} lastSaved={lastSaved} estimateLocked={estimateLocked}/>}
              </div>
            </>
          )}
          {appTab==="wbsmanager" && <WBSManager equipSel={equipSel} setEquipSel={setEquipSel} onPriceUpdate={handlePriceUpdate}/>}
          {appTab==="settings"   && <ThemeSettings theme={theme} onChange={setTheme} users={users} setUsers={setUsers} currentUser={currentUser}/>}
          {appTab==="hub"        && <InvestmentHub
            onLoad={(s)=>{loadInvestment(s);}}
            onNew={newEstimate}
            currentInv={inv}
            currentLines={lines}
          />}
        </div>

        {/* Recent changes modal */}
        {showChangeLog && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={()=>setShowChangeLog(false)}>
            <div className="bg-white rounded-xl shadow-2xl w-[560px] max-h-[80vh] flex flex-col" onClick={e=>e.stopPropagation()}>
              <div className="bg-[var(--primary-900)] text-white px-5 py-4 rounded-t-xl flex items-center justify-between">
                <div>
                  <div className="font-bold text-base">📝 Recent Changes</div>
                  <div className="text-[var(--primary-200)] text-xs mt-1">Last {Math.min(changeLog.length,10)} edits to this estimate — newest first</div>
                </div>
                <button onClick={()=>setShowChangeLog(false)} className="text-[var(--primary-200)] hover:text-white text-lg leading-none">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {changeLog.length===0 ? (
                  <div className="p-6 text-center text-sm text-gray-400">No changes recorded yet for this estimate.</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wide">
                      <tr>
                        <th className="px-3 py-2 text-left">Time</th>
                        <th className="px-3 py-2 text-left">User</th>
                        <th className="px-3 py-2 text-left">Item</th>
                        <th className="px-3 py-2 text-left">Field</th>
                        <th className="px-3 py-2 text-right">Was</th>
                        <th className="px-3 py-2 text-right">Now</th>
                        {!effectiveLocked && <th className="px-3 py-2"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {[...changeLog].slice(-10).reverse().map((c,i)=>(
                        <tr key={i} className={i%2===0?"bg-white":"bg-gray-50"}>
                          <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{new Date(c.ts).toLocaleString("en-AU",{dateStyle:"short",timeStyle:"short"})}</td>
                          <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">{c.user}</td>
                          <td className="px-3 py-1.5 text-gray-800">
                            <div className="font-mono">{c.wbsCode}</div>
                            {c.description && <div className="text-gray-400 text-[10px] truncate max-w-[140px]">{c.description}</div>}
                          </td>
                          <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{c.field}</td>
                          <td className="px-3 py-1.5 text-right text-red-500 font-mono">{String(c.oldVal)}</td>
                          <td className="px-3 py-1.5 text-right text-green-700 font-mono font-semibold">{String(c.newVal)}</td>
                          {!effectiveLocked && (
                            <td className="px-3 py-1.5 text-right">
                              <button onClick={()=>revertChange(c)}
                                className="text-[10px] text-[var(--primary-700)] hover:underline font-semibold whitespace-nowrap">
                                ↺ Revert
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {changeLog.length>0 && (
                <div className="px-4 py-2 border-t border-gray-100 text-[10px] text-gray-400">
                  {changeLog.length>10?`Showing the most recent 10 of ${changeLog.length} tracked changes. `:""}
                  Reverting creates a new change entry — it doesn't delete history.
                </div>
              )}
            </div>
          </div>
        )}

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
    </ErrorBoundary>
  );
}
