import { useState, useMemo } from "react";

// ════════════════════════════════════════════════════════════════
// IET ESTIMATION TOOL — COMBINED APP
// Tab 1: Estimation Entry Form
// Tab 2: WBS Manager (Admin)
// ════════════════════════════════════════════════════════════════


// ── DATA ────────────────────────────────────────────────────────
const PHASES = [
  { id: 1, label: "1 · Planning" },
  { id: 2, label: "2 · Design" },
  { id: 3, label: "3 · Construction" },
  { id: 4, label: "4 · Commission" },
  { id: 5, label: "5 · M&C" },
];

const WBS_TREE = {
  3: [
    { code: "3.1", label: "Zone Substation Construction", children: [
        { code: "3.1.1", label: "Earthing & Civil", children: [
            { code: "3.1.1.12", label: "Earthing", leaf: true },
            { code: "3.1.1.16", label: "Electrical Civil Works", leaf: true },
        ]},
        { code: "3.1.3", label: "HV Plant", children: [
            { code: "3.1.3.02", label: "Circuit Breakers", leaf: true },
            { code: "3.1.3.03", label: "Reclosers", leaf: true },
            { code: "3.1.3.04", label: "Disconnectors & Earth Switches", leaf: true },
            { code: "3.1.3.05", label: "Current Transformers", leaf: true },
            { code: "3.1.3.06", label: "Voltage Transformers", leaf: true },
            { code: "3.1.3.07", label: "Power Transformers", leaf: true },
            { code: "3.1.3.08", label: "Surge Arrestors", leaf: true },
            { code: "3.1.3.09", label: "Switchboards", leaf: true },
        ]},
    ]},
    { code: "3.2", label: "Comms Construction", children: [] },
    { code: "3.3", label: "Subtransmission Mains", children: [] },
    { code: "3.5", label: "Ancillary Construction", children: [] },
  ],
};

const SUPPLY_ITEMS = {
  "3.1.3.04": [
    { code: "3.1.3.04.1.01", desc: "Disconnector 132kV 2500A - Busbar Height 4000mm", uom: "EA", installHrsPer: 64, commHrsPer: 8, eeRate: 246.95, pcePrice: 48500 },
    { code: "3.1.3.04.1.02", desc: "Disconnector 132kV 2000A - Busbar Height 4000mm", uom: "EA", installHrsPer: 64, commHrsPer: 8, eeRate: 246.95, pcePrice: 46200 },
    { code: "3.1.3.04.1.09", desc: "Disconnector 66kV 2500A - Busbar Height 3500mm", uom: "EA", installHrsPer: 64, commHrsPer: 8, eeRate: 246.95, pcePrice: 32400 },
    { code: "3.1.3.04.1.10", desc: "Disconnector 66kV 2000A - Busbar Height 3500mm", uom: "EA", installHrsPer: 64, commHrsPer: 8, eeRate: 246.95, pcePrice: 30800 },
    { code: "3.1.3.04.1.25", desc: "Earth Switch 132kV 2500A - Busbar Height 4000mm", uom: "EA", installHrsPer: 32, commHrsPer: 4, eeRate: 246.95, pcePrice: 18600 },
    { code: "3.1.3.04.1.31", desc: "Earth Switch 66kV 2500A - Busbar Height 3500mm", uom: "EA", installHrsPer: 32, commHrsPer: 4, eeRate: 246.95, pcePrice: 14200 },
    { code: "3.1.3.04.1.32", desc: "Earth Switch 66kV 2000A - Busbar Height 3500mm", uom: "EA", installHrsPer: 32, commHrsPer: 4, eeRate: 246.95, pcePrice: 13800 },
    { code: "3.1.3.04.1.15", desc: "Disconnector 66kV Support Structure - Busbar Height 3500mm", uom: "EA", installHrsPer: 16, commHrsPer: 0, eeRate: 246.95, pcePrice: 4200 },
  ],
  "3.1.3.02": [
    { code: "3.1.3.02.1.01", desc: "132kV Live Tank Circuit Breaker - 3AP1-FG 145kV (SF6)", uom: "EA", installHrsPer: 160, commHrsPer: 48, eeRate: 246.95, pcePrice: 142000 },
    { code: "3.1.3.02.1.02", desc: "132kV Dead Tank Circuit Breaker (5 CT Cores) - 3AP1-DT 145kV", uom: "EA", installHrsPer: 160, commHrsPer: 48, eeRate: 246.95, pcePrice: 168000 },
    { code: "3.1.3.02.1.07", desc: "66kV Live Tank Circuit Breaker - Siemens 3AP1-FG 72.5kV (SF6)", uom: "EA", installHrsPer: 160, commHrsPer: 48, eeRate: 246.95, pcePrice: 98000 },
    { code: "3.1.3.02.1.06", desc: "66kV Fault Thrower - Siemens 3AP1-FS 72.5kV", uom: "EA", installHrsPer: 32, commHrsPer: 4, eeRate: 246.95, pcePrice: 54000 },
  ],
  "3.1.3.05": [
    { code: "3.1.3.05.1.01", desc: "Current Transformer - 132kV Oil/Paper 1000A - EPC International", uom: "EA", installHrsPer: 32, commHrsPer: 16, eeRate: 246.95, pcePrice: 12400 },
    { code: "3.1.3.05.1.02", desc: "Current Transformer - 66kV Oil/Paper 1000A - EPC International", uom: "EA", installHrsPer: 32, commHrsPer: 16, eeRate: 246.95, pcePrice: 9800 },
    { code: "3.1.3.05.1.04", desc: "Neutral Current Transformer - Epoxy Resin Cast <1kV", uom: "EA", installHrsPer: 2, commHrsPer: 4, eeRate: 246.95, pcePrice: 1200 },
  ],
};
// ── OPTIONAL EQUIPMENT CATALOGUE (from SCADA Equipment sheet — items without WBS) ─
const OPTIONAL_EQUIPMENT = {
  "3.5.1.03": [  // SCADA / RTC group
    { id:"OPT001", group:"MD303",           desc:"MD303cpu-CR (copper, GPS)",                  partNo:"MD303cpu-CR-GPS",  catId:"TEC0017", price:6372,  comments:"" },
    { id:"OPT002", group:"MD303",           desc:"MD303cpu-FR (fibre, GPS)",                   partNo:"MD303cpu-FR-GPS",  catId:"TEC0018", price:6730,  comments:"" },
    { id:"OPT003", group:"MD303 Options",   desc:"MD303cpu optional 3G Modem",                 partNo:"MD303cpu-3G",      catId:"TEC0020", price:0,     comments:"POA" },
    { id:"OPT004", group:"MD303 Options",   desc:"MD303cpu Mounting Plate Kit",                partNo:"MD303cpu-MPK",     catId:"TEC0021", price:418,   comments:"" },
    { id:"OPT005", group:"MD303 Options",   desc:"MD303 Copper SFP Transceiver (10/100 Mb/s)", partNo:"SFP-CE",          catId:"TEC0022", price:307,   comments:"Two per unit" },
    { id:"OPT006", group:"MD303 Options",   desc:"MD303 MM Fibre SFP Transceiver",             partNo:"SFP-FE",          catId:"TEC0023", price:281,   comments:"" },
    { id:"OPT007", group:"MD300io-r Range", desc:"MD300io-r 19in 16 Slot I/O Rack",            partNo:"MD300io-r",       catId:"TEC0001", price:4853,  comments:"" },
    { id:"OPT008", group:"MD300io-r Range", desc:"Digital Input Module 36.4mA",                partNo:"DIM302-36.4",     catId:"TEC0049", price:229,   comments:"" },
    { id:"OPT009", group:"MD300io-r Range", desc:"Digital Output Module",                      partNo:"DOM302",          catId:"TEC0007", price:250,   comments:"" },
    { id:"OPT010", group:"MD300io-r Range", desc:"Analogue Input Module 0-20mA",               partNo:"AIM302/F07R",     catId:"TEC0050", price:451,   comments:"" },
    { id:"OPT011", group:"MD300io-r Range", desc:"MD300io-r Power Supply",                     partNo:"E50",             catId:"TEC0002", price:1199,  comments:"" },
    { id:"OPT012", group:"DC Equipment",    desc:"1800W Benbro 110-48V DC Converter",          partNo:"BENBRO-1800W",    catId:"",        price:5300,  comments:"" },
    { id:"OPT013", group:"DC Equipment",    desc:"48V DC Distribution Board E type panel",     partNo:"",                catId:"",        price:6500,  comments:"" },
    { id:"OPT014", group:"DC Equipment",    desc:"Magellan 48V Battery Charger MCR2",          partNo:"MCR2-48V",        catId:"",        price:10200, comments:"" },
    { id:"OPT015", group:"DC Equipment",    desc:"Saft 48V Batteries NiCd 110Ah 38 Cells",    partNo:"SAFT-48V-110AH",  catId:"",        price:5643,  comments:"" },
    { id:"OPT016", group:"DC Equipment",    desc:"48V DC Battery Stand SGL2",                  partNo:"SGL2-STAND",      catId:"",        price:1000,  comments:"" },
    { id:"OPT017", group:"Cable",           desc:"2 pair twisted 7/0.3 overall screen 100m",   partNo:"",                catId:"",        price:226,   comments:"" },
    { id:"OPT018", group:"Cable",           desc:"4 pair twisted 7/0.3 overall screen 100m",   partNo:"",                catId:"",        price:210,   comments:"" },
    { id:"OPT019", group:"Cable",           desc:"8 pair twisted 7/0.3 overall screen 100m",   partNo:"",                catId:"",        price:320,   comments:"" },
    { id:"OPT020", group:"Cable",           desc:"12 pair twisted 7/0.3 overall screen 100m",  partNo:"",                catId:"",        price:450,   comments:"" },
  ],
};

// Map L4 group codes to optional equipment sections
const OPTIONAL_EQUIP_MAP = {
  "3.5.1.03": "3.5.1.03",  // SCADA RTC
  "3.1.3.04": null,          // Disconnectors — no optional equipment
  "3.1.3.02": null,          // Circuit Breakers — no optional equipment
};

// ── MANAGED LISTS (administered in WBS Manager) ─────────────────
const ESTIMATORS = [
  { name: "Daniel Lawrence",    role: "Lead Estimator",         team: "Zone Substation" },
  { name: "Sarah Chen",         role: "Estimator",              team: "Zone Substation" },
  { name: "Mark Thompson",      role: "Estimator",              team: "Subtransmission" },
  { name: "Priya Nair",         role: "Senior Estimator",       team: "Zone Substation" },
  { name: "James O'Brien",      role: "Estimator",              team: "Communications" },
  { name: "Kat Williams",       role: "Estimator",              team: "Subtransmission" },
  { name: "Michael Santos",     role: "Lead Estimator",         team: "Commissioning" },
  { name: "Anh Nguyen",         role: "Estimator",              team: "Zone Substation" },
  { name: "Tom Eriksson",       role: "Senior Estimator",       team: "Civil & Earthing" },
  { name: "Emma Blackwood",     role: "Project Manager",        team: "Zone Substation" },
];

const REVIEWERS = ESTIMATORS.filter(e =>
  ["Lead Estimator", "Senior Estimator", "Project Manager"].includes(e.role)
);


const fmt = (n) => n === 0 ? "–" : "$" + Math.round(n).toLocaleString("en-AU");
const fmtHrs = (n) => n === 0 ? "–" : n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + " hrs";

// ── SHARED COMPONENTS ────────────────────────────────────────────
// ── ESTIMATOR SELECT ─────────────────────────────────────────────
function EstimatorSelect({ value, onChange, list }) {
  const [open, setOpen] = useState(false);
  const selected = list.find(e => e.name === value) || null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between border border-gray-300 rounded px-2 py-1.5 text-xs bg-white hover:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 text-left"
      >
        <span className={selected ? "text-gray-800" : "text-gray-400"}>
          {selected ? (
            <span className="flex items-center gap-2">
              <span className="font-semibold">{selected.name}</span>
              <span className="text-gray-400">— {selected.role}</span>
              <span className="text-xs bg-blue-100 text-blue-700 px-1 rounded">{selected.team}</span>
            </span>
          ) : "Select estimator…"}
        </span>
        <span className="text-gray-400 ml-2">{open ? "▲" : "▾"}</span>
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-gray-200 rounded shadow-lg max-h-56 overflow-y-auto">
          {list.map(e => (
            <button
              key={e.name}
              type="button"
              onClick={() => { onChange(e.name); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center justify-between border-b border-gray-50 last:border-0 ${value === e.name ? "bg-blue-50" : ""}`}
            >
              <span>
                <span className={`font-semibold ${value === e.name ? "text-blue-800" : "text-gray-800"}`}>{e.name}</span>
                <span className="text-gray-400 ml-2">{e.role}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{e.team}</span>
                {value === e.name && <span className="text-blue-600 font-bold">✓</span>}
              </span>
            </button>
          ))}
          <div className="px-3 py-2 text-xs text-gray-400 bg-gray-50 border-t border-gray-100 flex items-center gap-1">
            <span>⚙️</span>
            <span>Manage estimator list in <span className="font-semibold text-blue-600">WBS Manager → People & Roles</span></span>
          </div>
        </div>
      )}
    </div>
  );
}

function FormField({ label, children, required, hint }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
        {label}
        {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <span className="text-xs text-gray-400">{hint}</span>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, className = "" }) {
  return (
    <input type="text" value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 ${className}`} />
  );
}

function NumberInput({ value, onChange, placeholder, min, step, suffix, className = "" }) {
  return (
    <div className="flex items-center gap-1">
      <input type="number" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} min={min} step={step}
        className={`border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 w-full ${className}`} />
      {suffix && <span className="text-xs text-gray-400 whitespace-nowrap">{suffix}</span>}
    </div>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
      {options.map(o => <option key={o}>{o}</option>)}
    </select>
  );
}

function SectionHeader({ color = "blue", title, subtitle }) {
  const colors = {
    blue:   "bg-blue-700 text-white",
    orange: "bg-orange-600 text-white",
    green:  "bg-green-700 text-white",
    purple: "bg-purple-700 text-white",
    teal:   "bg-teal-700 text-white",
    gray:   "bg-gray-600 text-white",
  };
  return (
    <div className={`px-3 py-2 rounded-t-md ${colors[color]}`}>
      <div className="text-xs font-bold uppercase tracking-wide">{title}</div>
      {subtitle && <div className="text-xs opacity-75 mt-0.5">{subtitle}</div>}
    </div>
  );
}

function Card({ children, className = "" }) {
  return (
    <div className={`border border-gray-200 rounded-md shadow-sm overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

// ── OVERRIDE INPUT (used in estimation) ─────────────────────────
function OverrideInput({ label, value, onChange, prefix = "", placeholder = "0", color = "blue", badge = null }) {
  const colors = {
    blue:   "border-blue-300 bg-blue-50 text-blue-800 focus:ring-blue-400",
    purple: "border-purple-300 bg-purple-50 text-purple-800 focus:ring-purple-400",
    green:  "border-green-300 bg-green-50 text-green-800 focus:ring-green-400",
    teal:   "border-teal-300 bg-teal-50 text-teal-800 focus:ring-teal-400",
    orange: "border-orange-300 bg-orange-50 text-orange-800 focus:ring-orange-400",
  };
  const isModified = value !== "" && value !== "0" && value !== placeholder;
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-center gap-1">
        <span className="text-gray-500 text-xs whitespace-nowrap">{label}</span>
        {badge && <span className="text-xs px-1 rounded bg-amber-100 text-amber-700 font-medium">{badge}</span>}
        {isModified && <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" title="Overridden" />}
      </div>
      <div className="flex items-center">
        {prefix && <span className="text-xs text-gray-400 mr-0.5">{prefix}</span>}
        <input type="number" min="0" step="any" value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full text-xs border rounded px-1.5 py-1 ${colors[color]} focus:outline-none focus:ring-1`} />
      </div>
    </div>
  );
}

// ── SCREEN: GENERAL INFORMATION ─────────────────────────────────
function GeneralInfoScreen() {
  const [invName, setInvName]           = useState("Marulan 132kV 3-Way Switching Station");
  const [invNumber, setInvNumber]       = useState("10007569");
  const [wacsNumber, setWacsNumber]     = useState("N/A");
  const [invType, setInvType]           = useState("Commercially Funded");
  const [estClass, setEstClass]         = useState("Class 4");
  const [revision, setRevision]         = useState("A");
  const [complexity, setComplexity]     = useState("High");
  const [newTech, setNewTech]           = useState("Moderate");
  const [spendProf, setSpendProf]       = useState("Default (Automatic)");
  const [estimatedBy, setEstimatedBy]   = useState("Daniel Lawrence");
  const [reviewedBy, setReviewedBy]     = useState("Priya Nair");
  const [startMonth, setStartMonth]     = useState("July");
  const [startYear, setStartYear]       = useState("2025");
  const [planStart, setPlanStart]       = useState("1");
  const [planDur, setPlanDur]           = useState("4");
  const [designStart, setDesignStart]   = useState("1");
  const [designDur, setDesignDur]       = useState("9");
  const [constrStart, setConstrStart]   = useState("6");
  const [constrDur, setConstrDur]       = useState("15");
  const [contInt, setContInt]           = useState("0.1");
  const [contComm, setContComm]         = useState("0.1");
  const [lltMode, setLltMode]           = useState("Manual");
  // Escalation rates
  const [escEEFY26, setEscEEFY26]       = useState("4.5");
  const [escEEFY27, setEscEEFY27]       = useState("3.8");
  const [escEEFY28, setEscEEFY28]       = useState("3.5");
  const [escEEFY29, setEscEEFY29]       = useState("3.5");
  const [escConFY26, setEscConFY26]     = useState("4.9");
  const [escConFY27, setEscConFY27]     = useState("4.5");
  const [escConFY28, setEscConFY28]     = useState("4.0");
  const [escConFY29, setEscConFY29]     = useState("3.5");
  const [escMatFY26, setEscMatFY26]     = useState("4.9");
  const [escMatFY27, setEscMatFY27]     = useState("4.0");
  const [escMatFY28, setEscMatFY28]     = useState("4.0");
  const [escMatFY29, setEscMatFY29]     = useState("4.0");
  // Invoicing milestones
  const [milestones, setMilestones] = useState([
    { stage: "Acceptance of offer and commencement", month: "1", pct: "15" },
    { stage: "Long lead-time equipment order placed", month: "4", pct: "35" },
    { stage: "Design completed, sub-contracts let", month: "10", pct: "45" },
    { stage: "Construction works 100% complete", month: "15", pct: "5" },
  ]);

  const updateMilestone = (i, field, val) => {
    setMilestones(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: val } : m));
  };
  const addMilestone = () => {
    if (milestones.length < 10) setMilestones(prev => [...prev, { stage: "", month: "", pct: "" }]);
  };
  const removeMilestone = (i) => setMilestones(prev => prev.filter((_, idx) => idx !== i));

  const totalPct = milestones.reduce((a, m) => a + (parseFloat(m.pct) || 0), 0);
  const isCommercial = invType === "Commercially Funded";

  // Derive timeline labels
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const startIdx = months.indexOf(startMonth);
  const getMonthLabel = (relMonth) => {
    const idx = (startIdx + (parseInt(relMonth) || 0) - 1) % 12;
    const yr = parseInt(startYear) + Math.floor((startIdx + (parseInt(relMonth) || 0) - 1) / 12);
    return `${months[idx < 0 ? idx + 12 : idx]} ${yr}`;
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-100 p-4">
      <div className="max-w-5xl mx-auto space-y-4">

        {/* ── INVESTMENT IDENTITY ── */}
        <Card>
          <SectionHeader color="blue" title="Investment Identity" subtitle="Core identifiers — required before any estimate lines can be entered" />
          <div className="p-4 grid grid-cols-3 gap-4 bg-white">
            <div className="col-span-3">
              <FormField label="Investment Name" required>
                <TextInput value={invName} onChange={setInvName} className="w-full" />
              </FormField>
            </div>
            <FormField label="Investment Number" required hint="EE investment reference">
              <TextInput value={invNumber} onChange={setInvNumber} />
            </FormField>
            <FormField label="WACS Number">
              <TextInput value={wacsNumber} onChange={setWacsNumber} />
            </FormField>
            <FormField label="Revision">
              <Select value={revision} onChange={setRevision} options={["A","B","C","D","E"]} />
            </FormField>
            <FormField label="Investment Type" required hint="Controls EE internal vs commercial rate streams">
              <Select value={invType} onChange={setInvType}
                options={["Internally Funded","Commercially Funded"]} />
            </FormField>
            <FormField label="Estimate Class" required>
              <Select value={estClass} onChange={setEstClass}
                options={["Class 1 (±5%)","Class 2 (±10%)","Class 3 (±20%)","Class 4 (±30%)","Class 5 (±50%)"]} />
            </FormField>
            <div className={`col-span-1 rounded px-3 py-2 text-xs font-bold flex items-center justify-center ${isCommercial ? "bg-orange-100 text-orange-800" : "bg-blue-100 text-blue-800"}`}>
              {isCommercial ? "⚡ Commercial Rates + ANS Margins" : "⚡ EE Internal Rates + Materials Burden"}
            </div>
            <FormField label="Investment Complexity">
              <Select value={complexity} onChange={setComplexity} options={["Medium","High","Very High"]} />
            </FormField>
            <FormField label="Use of New Technology">
              <Select value={newTech} onChange={setNewTech} options={["Limited","Moderate","Substantial"]} />
            </FormField>
            <FormField label="Spend Profile">
              <Select value={spendProf} onChange={setSpendProf} options={["Default (Automatic)","Manual"]} />
            </FormField>
            <FormField label="Estimated By" required hint="Managed in WBS Manager → People & Roles">
              <EstimatorSelect value={estimatedBy} onChange={setEstimatedBy} list={ESTIMATORS} />
            </FormField>
            <FormField label="Reviewed By" hint="Lead Estimators and PMs only">
              <EstimatorSelect value={reviewedBy} onChange={setReviewedBy} list={REVIEWERS} />
            </FormField>
          </div>
        </Card>

        {/* ── PHASE TIMELINE ── */}
        <Card>
          <SectionHeader color="teal" title="Phase Timeline"
            subtitle={isCommercial
              ? "Commercial investment — Planning phase WBS costs are suppressed (zeroed). Design and Construction only."
              : "Month numbers are relative to Investment Start — Month 1"} />
          <div className="p-4 bg-white space-y-4">
            {/* Start date */}
            {isCommercial && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 mb-3 flex items-start gap-2">
                <span className="text-orange-500 text-sm mt-0.5">⚠️</span>
                <div>
                  <div className="text-xs font-bold text-orange-800">Commercial Investment — Planning Phase Suppressed</div>
                  <div className="text-xs text-orange-700 mt-0.5">
                    All WBS Level 1 (Planning) costs are automatically zeroed in the escalation calculation and Copperleaf export.
                    Planning phase months and duration are still stored for timeline reference but contribute $0 to the estimate.
                    This matches the IET Excel behaviour: <code className="font-mono bg-orange-100 px-1 rounded">MID(wbs,1,1)="1" AND type="Commercially Funded" → cost = 0</code>
                  </div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-4 gap-4 pb-3 border-b border-gray-100">
              <FormField label="Investment Start Month" required hint="Month 1 — drives all escalation calculations">
                <Select value={startMonth} onChange={setStartMonth} options={["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]} />
              </FormField>
              <FormField label="Start Year" required>
                <Select value={startYear} onChange={setStartYear} options={["2024","2025","2026","2027","2028"]} />
              </FormField>
              <FormField label="LLT Procurement">
                <Select value={lltMode} onChange={setLltMode} options={["Default","Manual"]} />
              </FormField>
              <div className="flex items-end">
                <div className="bg-teal-50 border border-teal-200 rounded px-3 py-2 text-xs text-teal-800 w-full">
                  <div className="font-bold">Month 1 = {startMonth} {startYear}</div>
                  <div className="text-teal-600 mt-0.5">Copperleaf upload aligned to this</div>
                </div>
              </div>
            </div>

            {/* Phase table */}
            <div>
              <div className="grid text-xs font-semibold text-gray-500 uppercase tracking-wide pb-1 border-b border-gray-100"
                style={{ gridTemplateColumns: "1fr 120px 120px 160px 160px" }}>
                <div>Phase</div>
                <div className="text-center">Start Month</div>
                <div className="text-center">Duration (months)</div>
                <div className="text-center">Starts</div>
                <div className="text-center">Ends</div>
              </div>
              {[
                { label: "Planning", start: planStart, setStart: setPlanStart, dur: planDur, setDur: setPlanDur, color: "text-blue-700" },
                { label: "Design", start: designStart, setStart: setDesignStart, dur: designDur, setDur: setDesignDur, color: "text-purple-700" },
                { label: "Construction & Commissioning", start: constrStart, setStart: setConstrStart, dur: constrDur, setDur: setConstrDur, color: "text-orange-700" },
              ].map((phase, i) => (
                <div key={phase.label} className={`grid items-center py-2 border-b border-gray-50 ${i % 2 === 0 ? "bg-gray-50" : "bg-white"}`}
                  style={{ gridTemplateColumns: "1fr 120px 120px 160px 160px" }}>
                  <div className={`text-xs font-semibold ${phase.color} px-2`}>
                    {phase.label}
                    {phase.suppressed && <span className="ml-2 text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-medium">Costs suppressed — Commercial</span>}
                  </div>
                  <div className="flex justify-center">
                    <input type="number" min="1" value={phase.start} onChange={e => phase.setStart(e.target.value)}
                      className="w-16 text-center border border-gray-300 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                  <div className="flex justify-center">
                    <input type="number" min="1" value={phase.dur} onChange={e => phase.setDur(e.target.value)}
                      className="w-16 text-center border border-gray-300 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                  <div className={`text-center text-xs ${phase.color} font-medium`}>
                    {getMonthLabel(phase.start)}
                  </div>
                  <div className={`text-center text-xs ${phase.color} font-medium`}>
                    {getMonthLabel(parseInt(phase.start) + parseInt(phase.dur) - 1)}
                  </div>
                </div>
              ))}
            </div>

            {/* Visual timeline */}
            <div className="bg-gray-50 rounded p-3 mt-1">
              <div className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Timeline Preview</div>
              <div className="relative h-8 bg-gray-200 rounded overflow-hidden">
                {[
                  { start: parseInt(planStart)-1, dur: parseInt(planDur), color: "bg-blue-500", label: "Plan" },
                  { start: parseInt(designStart)-1, dur: parseInt(designDur), color: "bg-purple-500", label: "Design" },
                  { start: parseInt(constrStart)-1, dur: parseInt(constrDur), color: "bg-orange-500", label: "Constr" },
                ].map((b, i) => {
                  const total = Math.max(parseInt(planDur), parseInt(designStart)+parseInt(designDur)-1, parseInt(constrStart)+parseInt(constrDur)-1) + 2;
                  const leftPct = (b.start / total) * 100;
                  const widthPct = (b.dur / total) * 100;
                  return (
                    <div key={i} className={`absolute h-full ${b.color} opacity-80 flex items-center justify-center`}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}>
                      <span className="text-white text-xs font-bold truncate px-1">{b.label}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>{startMonth} {startYear}</span>
                <span>{getMonthLabel(parseInt(constrStart)+parseInt(constrDur))}</span>
              </div>
            </div>
          </div>
        </Card>

        {/* ── CONTINGENCY ── */}
        <Card>
          <SectionHeader color="green" title="Investment Contingency" subtitle="Applied proportionately across all resource types in escalation calculations" />
          <div className="p-4 bg-white grid grid-cols-2 gap-6">
            <FormField label="Internal Contingency %" hint="Applied to EE internal total">
              <NumberInput value={contInt} onChange={setContInt} placeholder="0.1" suffix="%" step="0.1" />
            </FormField>
            <FormField label="Commercial Contingency %" hint="Applied to commercial total (commercially funded investments only)">
              <NumberInput value={contComm} onChange={setContComm} placeholder="0.1" suffix="%" step="0.1"
                className={!isCommercial ? "opacity-40" : ""} />
            </FormField>
          </div>
        </Card>

        {/* ── ESCALATION RATES ── */}
        <Card>
          <SectionHeader color="orange" title="Annual Escalation Rates" subtitle="Applied by resource stream — compounds monthly across the investment timeline. Source: ABS / organisational policy." />
          <div className="p-4 bg-white space-y-3">
            <div className="grid text-xs font-semibold text-gray-500 uppercase tracking-wide pb-1 border-b border-gray-100"
              style={{ gridTemplateColumns: "1fr 100px 100px 100px 100px 120px" }}>
              <div>Resource Stream</div>
              <div className="text-center">FY2026</div>
              <div className="text-center">FY2027</div>
              <div className="text-center">FY2028</div>
              <div className="text-center">FY2029</div>
              <div className="text-center text-gray-400">Avg</div>
            </div>
            {[
              { label: "Internal EE Resources", color: "text-blue-700", vals: [escEEFY26, escEEFY27, escEEFY28, escEEFY29], sets: [setEscEEFY26, setEscEEFY27, setEscEEFY28, setEscEEFY29] },
              { label: "Contractors", color: "text-orange-700", vals: [escConFY26, escConFY27, escConFY28, escConFY29], sets: [setEscConFY26, setEscConFY27, setEscConFY28, setEscConFY29] },
              { label: "Materials", color: "text-green-700", vals: [escMatFY26, escMatFY27, escMatFY28, escMatFY29], sets: [setEscMatFY26, setEscMatFY27, setEscMatFY28, setEscMatFY29] },
            ].map((stream, si) => {
              const avg = (stream.vals.reduce((a, v) => a + (parseFloat(v) || 0), 0) / 4).toFixed(2);
              return (
                <div key={stream.label} className={`grid items-center py-2 rounded ${si % 2 === 0 ? "bg-gray-50" : "bg-white"}`}
                  style={{ gridTemplateColumns: "1fr 100px 100px 100px 100px 120px" }}>
                  <div className={`text-xs font-semibold ${stream.color} px-2`}>{stream.label}</div>
                  {stream.vals.map((v, vi) => (
                    <div key={vi} className="flex justify-center px-1">
                      <div className="flex items-center gap-0.5">
                        <input type="number" min="0" max="20" step="0.1" value={v}
                          onChange={e => stream.sets[vi](e.target.value)}
                          className="w-14 text-center border border-gray-300 rounded px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-orange-300" />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                    </div>
                  ))}
                  <div className="text-center text-xs font-bold text-gray-500">{avg}%</div>
                </div>
              );
            })}
            <div className="bg-orange-50 border border-orange-200 rounded px-3 py-2 text-xs text-orange-800">
              ⚠️  Rates source: ABS Producer Price Indices. Update annually. Changing rates after Copperleaf export has been generated will require a new export.
            </div>
          </div>
        </Card>

        {/* ── INVOICING MILESTONES ── */}
        {isCommercial && (
          <Card>
            <SectionHeader color="purple" title="Invoicing Milestones" subtitle="Commercially funded investments only — up to 10 milestones. Total must equal 100%." />
            <div className="p-4 bg-white space-y-2">
              <div className="grid text-xs font-semibold text-gray-500 uppercase tracking-wide pb-1 border-b border-gray-100"
                style={{ gridTemplateColumns: "1fr 80px 80px 30px" }}>
                <div>Milestone Description</div>
                <div className="text-center">Month</div>
                <div className="text-center">Percentage</div>
                <div />
              </div>
              {milestones.map((m, i) => (
                <div key={i} className="grid items-center gap-2" style={{ gridTemplateColumns: "1fr 80px 80px 30px" }}>
                  <input type="text" value={m.stage} onChange={e => updateMilestone(i, "stage", e.target.value)}
                    placeholder={`Milestone ${i+1} description`}
                    className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-300" />
                  <input type="number" min="1" value={m.month} onChange={e => updateMilestone(i, "month", e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-purple-300" />
                  <div className="flex items-center gap-0.5">
                    <input type="number" min="0" max="100" value={m.pct} onChange={e => updateMilestone(i, "pct", e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-purple-300 w-full" />
                    <span className="text-xs text-gray-400">%</span>
                  </div>
                  <button onClick={() => removeMilestone(i)} className="text-red-400 hover:text-red-600 text-sm text-center">×</button>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <button onClick={addMilestone} disabled={milestones.length >= 10}
                  className="text-xs text-purple-700 hover:text-purple-900 font-semibold disabled:opacity-40">
                  + Add Milestone
                </button>
                <div className={`text-xs font-bold px-2 py-1 rounded ${Math.abs(totalPct - 100) < 0.01 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                  Total: {totalPct.toFixed(0)}% {Math.abs(totalPct - 100) < 0.01 ? "✓" : `(${totalPct > 100 ? "over" : "under"} by ${Math.abs(100 - totalPct).toFixed(0)}%)`}
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* ── SAVE BUTTON ── */}
        <div className="flex justify-end gap-3 pb-4">
          <button className="px-4 py-2 text-xs border border-gray-300 rounded hover:bg-gray-50 text-gray-600">
            Discard Changes
          </button>
          <button className="px-6 py-2 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded font-semibold shadow">
            Save Investment Setup →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SCREEN: MAIN ESTIMATION ──────────────────────────────────────
function EstimationScreen({ isCommercial }) {
  const [activePhase, setActivePhase]         = useState(3);
  const [expandedNodes, setExpandedNodes]     = useState({ "3.1": true, "3.1.3": true });
  const [selectedGroup, setSelectedGroup]     = useState("3.1.3.04");
  const [searchText, setSearchText]           = useState("");
  const [expandedRows, setExpandedRows]       = useState({});
  const [breadcrumb, setBreadcrumb]           = useState(["3","3.1","3.1.3"]);
  const [quantities, setQuantities]           = useState({});
  const [factors, setFactors]                 = useState({});
  const [installHrsOverride, setInstHrsOvrd]  = useState({});
  const [plantCost, setPlantCost]             = useState({});
  const [materialsCost, setMatCost]           = useState({});
  const [contractorRate, setContrRate]        = useState({});
  const [deliveryMethod, setDelivMethod]      = useState({});
  const [comments, setComments]               = useState({});
  const [optEquipSelections, setOptEquipSelections] = useState({});  // {OPT001: qty, OPT002: qty}
  const [showOptEquip, setShowOptEquip]             = useState(false);

  const items = SUPPLY_ITEMS[selectedGroup] || [];

  const calcLine = (item) => {
    const qty       = parseFloat(quantities[item.code]) || 0;
    const factor    = parseFloat(factors[item.code]) || 1;
    const delivery  = deliveryMethod[item.code] || "EE Delivered";
    const isContr   = delivery === "Contractor Delivered";
    const ovrd      = parseFloat(installHrsOverride[item.code]);
    const instHrsPU = (!isNaN(ovrd) && ovrd >= 0) ? ovrd : item.installHrsPer;
    const installHrs = qty * factor * instHrsPU;
    const commHrs   = qty * item.commHrsPer;
    const plant     = parseFloat(plantCost[item.code]) || 0;
    const mats      = parseFloat(materialsCost[item.code]) || 0;
    const contrRate = parseFloat(contractorRate[item.code]) || 0;
    const eeLabHrs  = isContr ? 0 : qty * factor * (instHrsPU / 4);
    const eeLabCost = eeLabHrs * item.eeRate;
    const contrCost = isContr ? qty * factor * contrRate : 0;
    const plantFact = plant * factor;
    const equipCost = qty * (parseFloat(materialsCost[item.code]) || item.pcePrice);
    const matBurden = isCommercial ? 0 : mats * 0.0752;
    const eeInt     = eeLabCost + contrCost + plantFact + mats + matBurden + (qty * item.pcePrice);
    const comm      = eeLabCost*1.20 + contrCost*1.20 + plantFact + mats*1.2686 + (qty * item.pcePrice);
    return { qty, factor, delivery, installHrs, commHrs, eeLabHrs, eeLabCost,
             contrCost, plantFact, mats, matBurden, equipCost: qty*item.pcePrice,
             eeInt, comm,
             instHrsOverridden: !isNaN(ovrd) && ovrd !== item.installHrsPer, instHrsPU };
  };

  const groupTotals = useMemo(() => items.reduce((a, it) => {
    const c = calcLine(it);
    return { installHrs: a.installHrs+c.installHrs, commHrs: a.commHrs+c.commHrs,
             eeTotal: a.eeTotal+c.eeInt, commTotal: a.commTotal+c.comm };
  }, { installHrs:0, commHrs:0, eeTotal:0, commTotal:0 }), [items, quantities, factors, installHrsOverride, plantCost, materialsCost, contractorRate, deliveryMethod, isCommercial]);

  const optEquipTotal = useMemo(() => {
    return Object.entries(optEquipSelections).reduce((acc, [id, qty]) => {
      const item = Object.values(OPTIONAL_EQUIPMENT).flat().find(i => i.id === id);
      if (!item || !qty || parseFloat(qty) === 0 || item.price === 0) return acc;
      return acc + parseFloat(qty) * item.price;
    }, 0);
  }, [optEquipSelections]);

  const investTotals = useMemo(() => {
    const base = Object.values(SUPPLY_ITEMS).flat().reduce((a, it) => {
      const c = calcLine(it);
      return { installHrs: a.installHrs+c.installHrs, commHrs: a.commHrs+c.commHrs,
               eeTotal: a.eeTotal+c.eeInt, commTotal: a.commTotal+c.comm };
    }, { installHrs:0, commHrs:0, eeTotal:0, commTotal:0 });
    return { ...base, eeTotal: base.eeTotal, commTotal: base.commTotal };
  }, [quantities, factors, installHrsOverride, plantCost, materialsCost, contractorRate, deliveryMethod, isCommercial]);

  const toggleRow  = (code) => setExpandedRows(p => ({ ...p, [code]: !p[code] }));
  const toggleNode = (code) => setExpandedNodes(p => ({ ...p, [code]: !p[code] }));
  const selectGroup = (code, path) => { setSelectedGroup(code); setBreadcrumb(path); };

  const groupLabel = { "3.1.3.02":"Circuit Breakers","3.1.3.04":"Disconnectors & Earth Switches","3.1.3.05":"Current Transformers" }[selectedGroup] || selectedGroup;

  const renderTree = (nodes, depth=0, path=[]) => nodes.map(node => {
    const np = [...path, node.code];
    const exp = expandedNodes[node.code];
    const hasKids = node.children && node.children.length > 0;
    const isSel = selectedGroup === node.code;
    return (
      <div key={node.code}>
        <div onClick={() => { if (hasKids) toggleNode(node.code); if (node.leaf) selectGroup(node.code, np); }}
          className={`flex items-center gap-1 px-2 py-1 cursor-pointer rounded text-xs transition-colors ${isSel ? "bg-blue-700 text-white" : "text-gray-200 hover:bg-blue-800 hover:text-white"}`}
          style={{ paddingLeft: `${8+depth*14}px` }}>
          <span className="w-3 text-center text-gray-400">{hasKids ? (exp ? "▾" : "▸") : node.leaf ? "·" : ""}</span>
          <span className="font-mono text-gray-400 text-xs">{node.code}</span>
          <span className="ml-1 truncate">{node.label}</span>
        </div>
        {hasKids && exp && renderTree(node.children, depth+1, np)}
      </div>
    );
  });

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* LEFT */}
      <div className="w-60 bg-blue-950 flex flex-col overflow-hidden flex-shrink-0">
        <div className="p-2 border-b border-blue-800">
          <input value={searchText} onChange={e => setSearchText(e.target.value)}
            placeholder="Search WBS or description…"
            className="w-full bg-blue-900 text-white text-xs px-2 py-1.5 rounded border border-blue-700 placeholder-blue-400 focus:outline-none focus:border-blue-400" />
        </div>
        <div className="flex border-b border-blue-800 overflow-x-auto">
          {PHASES.map(p => (
            <button key={p.id} onClick={() => setActivePhase(p.id)}
              className={`text-xs px-2 py-1.5 whitespace-nowrap flex-shrink-0 transition-colors ${activePhase===p.id ? "bg-blue-700 text-white font-bold border-b-2 border-blue-400" : "text-blue-300 hover:bg-blue-900"}`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="px-2 py-1 text-xs text-blue-400 border-b border-blue-800 truncate">{breadcrumb.join(" › ")}</div>
        <div className="flex-1 overflow-y-auto py-1">
          {searchText
            ? Object.values(SUPPLY_ITEMS).flat().filter(i => i.desc.toLowerCase().includes(searchText.toLowerCase()) || i.code.startsWith(searchText))
                .map(i => <div key={i.code} onClick={() => { const l4=i.code.split(".").slice(0,4).join("."); selectGroup(l4,[i.code.split(".")[0],i.code.split(".").slice(0,2).join("."),l4]); setSearchText(""); }}
                  className="px-3 py-1 cursor-pointer hover:bg-blue-800 text-xs text-gray-200 truncate">
                  <span className="font-mono text-blue-400 mr-1">{i.code.split(".").slice(0,4).join(".")}</span>{i.desc}
                </div>)
            : renderTree(WBS_TREE[activePhase]||[], 0, [String(activePhase)])}
        </div>
      </div>

      {/* CENTRE */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="bg-white border-b px-4 py-2 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="font-bold text-blue-900 text-sm">{selectedGroup} — {groupLabel}</div>
            <div className="text-xs text-gray-500">Supply items · Click <span className="font-semibold text-blue-600">▸</span> to edit install hours, plant, materials or contractor rate</div>
          </div>
          <div className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded border">
            {items.filter(i => (parseFloat(quantities[i.code])||0)>0).length} of {items.length} with quantities
          </div>
        </div>
        <div className="bg-gray-50 border-b text-xs font-semibold text-gray-500 px-3 py-1.5 grid flex-shrink-0"
          style={{ gridTemplateColumns: "16px 1fr 46px 72px 68px 88px 60px" }}>
          <div/><div>Description / WBS Code</div><div className="text-center">UOM</div>
          <div className="text-center text-orange-700">Quantity</div><div className="text-center">Factor</div>
          <div className="text-center text-purple-700">Install Hrs</div><div className="text-center text-gray-400">Expand</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {items.map((item, idx) => {
            const qty = quantities[item.code] ?? "";
            const factor = factors[item.code] ?? "1";
            const hasQty = (parseFloat(qty)||0) > 0;
            const isExpanded = !!expandedRows[item.code];
            const c = calcLine(item);
            const delivery = deliveryMethod[item.code] || "EE Delivered";
            const isContr = delivery === "Contractor Delivered";
            const hasOverrides = !!(installHrsOverride[item.code]||plantCost[item.code]||materialsCost[item.code]||contractorRate[item.code]||comments[item.code]);
            const rowBase = hasQty ? "bg-blue-50 border-l-4 border-l-blue-500" : idx%2===0 ? "bg-white" : "bg-gray-50";
            return (
              <div key={item.code} className={`border-b ${rowBase} transition-colors`}>
                <div className="grid items-center px-3 py-2 text-xs" style={{ gridTemplateColumns: "16px 1fr 46px 72px 68px 88px 60px" }}>
                  <button onClick={() => toggleRow(item.code)}
                    className={`text-center rounded transition-colors text-xs w-4 h-4 flex items-center justify-center ${isExpanded ? "bg-blue-600 text-white" : "text-gray-300 hover:text-blue-500"}`}>
                    {isExpanded ? "▾" : "▸"}
                  </button>
                  <div className="min-w-0 pr-2">
                    <div className={`font-medium truncate ${hasQty ? "text-blue-900" : "text-gray-800"}`}>
                      {item.desc}{hasOverrides && <span className="ml-1 text-orange-400 text-xs">●</span>}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-gray-400 font-mono text-xs">{item.code}</span>
                      {item.pcePrice > 0 && <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1">PCE {fmt(item.pcePrice)}/EA</span>}
                      {isContr && <span className="text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded px-1">Contractor</span>}
                    </div>
                  </div>
                  <div className="text-center text-gray-500">{item.uom}</div>
                  <div className="flex justify-center">
                    <input type="number" min="0" value={qty} onChange={e => setQuantities(p => ({...p,[item.code]:e.target.value}))} placeholder="0"
                      className={`w-16 text-center border rounded py-0.5 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-orange-400 ${hasQty ? "border-orange-400 bg-orange-50 text-orange-800" : "border-gray-300 text-gray-600"}`} />
                  </div>
                  <div className="flex justify-center">
                    <input type="number" min="0.1" step="0.1" value={factor} onChange={e => setFactors(p => ({...p,[item.code]:e.target.value}))}
                      className={`w-14 text-center border rounded py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 ${parseFloat(factor)!==1 ? "border-blue-400 bg-blue-50 text-blue-800 font-bold" : "border-gray-200 text-gray-500"}`} />
                  </div>
                  <div className={`text-center font-bold ${c.instHrsOverridden ? "text-orange-600" : hasQty ? "text-purple-700" : "text-gray-300"}`}>
                    {hasQty ? <>{fmtHrs(c.installHrs)}{c.instHrsOverridden && <span className="text-orange-400 ml-0.5">*</span>}</> : "–"}
                  </div>
                  <div className="text-center text-gray-300 text-xs">{isExpanded ? "▲ close" : "▸ costs"}</div>
                </div>
                {isExpanded && (
                  <div className="mx-3 mb-3 mt-0 rounded-lg border border-blue-200 bg-white shadow-sm overflow-hidden">
                    <div className="bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 flex items-center justify-between">
                      <span>Cost Detail — {item.desc.split(" - ")[0]}</span>
                      <span className="text-blue-200 font-normal">Std: {item.installHrsPer} hrs/unit install · {item.commHrsPer} hrs/unit commission</span>
                    </div>
                    <div className="p-3 grid gap-3">
                      <div className="grid grid-cols-4 gap-3">
                        <div className="col-span-1 flex flex-col gap-0.5">
                          <span className="text-gray-500 text-xs">Delivery Method</span>
                          <select value={delivery} onChange={e => setDelivMethod(p => ({...p,[item.code]:e.target.value}))}
                            className="text-xs border border-gray-300 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                            <option>EE Delivered</option><option>Contractor Delivered</option>
                          </select>
                        </div>
                        <OverrideInput label="Install Hrs/Unit Override" value={installHrsOverride[item.code]??""} onChange={v => setInstHrsOvrd(p=>({...p,[item.code]:v}))} placeholder={String(item.installHrsPer)} color="purple" badge={c.instHrsOverridden?"overridden":null} />
                        <OverrideInput label="Contractor Rate ($/unit)" value={contractorRate[item.code]??""} onChange={v => setContrRate(p=>({...p,[item.code]:v}))} prefix="$" placeholder="0" color={isContr?"teal":"blue"} />
                        {hasQty && (
                          <div className="flex flex-col justify-end">
                            <div className="text-xs text-gray-400 mb-0.5">Hours this item</div>
                            <div className="text-xs font-bold text-purple-700">{fmtHrs(c.installHrs)} install</div>
                            <div className="text-xs font-bold text-teal-700">{fmtHrs(c.commHrs)} comm</div>
                          </div>
                        )}
                      </div>
                      <div className="border-t border-gray-100" />
                      <div>
                        <div className="text-xs font-semibold text-gray-600 mb-2">Equipment & Material Costs <span className="text-gray-400 font-normal">(not multiplied by factor)</span></div>
                        <div className="grid grid-cols-4 gap-3">
                          <div>
                            <OverrideInput label="Equipment Price/Unit ($)" value={materialsCost[item.code]??""} onChange={v => setMatCost(p=>({...p,[item.code]:v}))} prefix="$" placeholder={item.pcePrice>0?String(item.pcePrice):"0"} color="green" badge={item.pcePrice>0?"PCE":null} />
                            {item.pcePrice>0 && <div className="text-xs text-amber-600 mt-0.5">PCE default: {fmt(item.pcePrice)}/EA</div>}
                          </div>
                          <div>
                            <OverrideInput label="Plant & Machinery ($)" value={plantCost[item.code]??""} onChange={v => setPlantCost(p=>({...p,[item.code]:v}))} prefix="$" placeholder="0" color="blue" />
                            <div className="text-xs text-gray-400 mt-0.5">× factor applied</div>
                          </div>
                          {hasQty && (
                            <div className="col-span-2 bg-gray-50 rounded border border-gray-200 p-2 text-xs">
                              <div className="font-semibold text-gray-600 mb-1.5">Line Cost Breakdown</div>
                              <div className="space-y-0.5">
                                {!isContr && <div className="flex justify-between"><span className="text-gray-500">EE Labour</span><span className="font-medium">{fmt(c.eeLabCost)}</span></div>}
                                {isContr  && <div className="flex justify-between"><span className="text-gray-500">Contractor</span><span className="font-medium">{fmt(c.contrCost)}</span></div>}
                                {c.equipCost>0 && <div className="flex justify-between"><span className="text-gray-500">Equipment</span><span className="font-medium">{fmt(c.equipCost)}</span></div>}
                                {c.plantFact>0 && <div className="flex justify-between"><span className="text-gray-500">Plant (×factor)</span><span className="font-medium">{fmt(c.plantFact)}</span></div>}
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
                      </div>
                      <div className="border-t border-gray-100 pt-2">
                        <div className="text-xs text-gray-500 mb-1">Comments / Scope inclusions & exclusions</div>
                        <textarea value={comments[item.code]??""} onChange={e => setComments(p=>({...p,[item.code]:e.target.value}))}
                          placeholder="e.g. Includes conductor and insulators. Excludes foundation design." rows={2}
                          className="w-full text-xs border border-gray-200 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300 text-gray-700" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── OPTIONAL EQUIPMENT PICKER ── */}
      <div className="border-l border-gray-200 bg-white flex-shrink-0" style={{width: showOptEquip ? '320px' : '0', overflow: 'hidden', transition: 'width 0.2s'}}>
        <div className="w-80 flex flex-col h-full">
          <div className="bg-teal-700 text-white px-3 py-2 flex items-center justify-between flex-shrink-0">
            <span className="text-xs font-bold uppercase tracking-wide">🧩 Optional Equipment</span>
            <button onClick={() => setShowOptEquip(false)} className="text-teal-200 hover:text-white text-lg leading-none">×</button>
          </div>
          <div className="text-xs text-teal-700 bg-teal-50 px-3 py-1.5 border-b border-teal-200 flex-shrink-0">
            Ancillary items without WBS — select to include in estimate cost
          </div>
          <div className="flex-1 overflow-y-auto">
            {Object.values(OPTIONAL_EQUIPMENT).flat().map((item, idx) => {
              const qty = optEquipSelections[item.id] ?? "";
              const qtyNum = parseFloat(qty) || 0;
              const hasQty = qtyNum > 0;
              return (
                <div key={item.id} className={`px-3 py-2 border-b text-xs ${hasQty ? "bg-teal-50 border-l-4 border-l-teal-500" : idx%2===0?"bg-white":"bg-gray-50"}`}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      <div className={`font-medium truncate ${hasQty ? "text-teal-900" : "text-gray-700"}`}>{item.desc}</div>
                      <div className="flex items-center gap-1 mt-0.5">
                        {item.partNo && <span className="font-mono text-gray-400 text-xs">{item.partNo}</span>}
                        <span className="text-xs bg-teal-100 text-teal-600 px-1 rounded">{item.group}</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`font-bold text-xs ${item.price===0?"text-orange-500":"text-gray-700"}`}>
                        {item.price===0 ? "POA" : fmt(item.price)}
                      </div>
                      <div className="text-gray-400 text-xs">/EA</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" min="0" value={qty}
                      onChange={e => setOptEquipSelections(p => ({...p,[item.id]:e.target.value}))}
                      placeholder="0"
                      className={`w-16 text-center border rounded py-0.5 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-teal-400 ${hasQty?"border-teal-400 bg-teal-50 text-teal-800":"border-gray-300 text-gray-500"}`}
                    />
                    <span className="text-gray-400 text-xs">qty</span>
                    {hasQty && item.price > 0 && (
                      <span className="text-teal-700 font-bold text-xs ml-auto">{fmt(qtyNum * item.price)}</span>
                    )}
                    {hasQty && item.price === 0 && <span className="text-orange-500 text-xs ml-auto">POA</span>}
                  </div>
                  {item.comments && <div className="text-gray-400 text-xs mt-1 italic">{item.comments}</div>}
                </div>
              );
            })}
          </div>
          {optEquipTotal > 0 && (
            <div className="px-3 py-2 bg-teal-100 border-t border-teal-300 flex-shrink-0">
              <div className="flex justify-between font-bold text-xs text-teal-800">
                <span>Optional Equipment Total</span>
                <span>{fmt(optEquipTotal)}</span>
              </div>
              <div className="text-xs text-teal-600 mt-0.5">
                ⏳ WBS assignment pending — flagged for review before sign-off
              </div>
            </div>
          )}
          <div className="px-3 py-2 bg-gray-50 border-t text-xs text-gray-500 flex-shrink-0">
            💡 Use WBS Manager to assign WBS codes to these items before final estimate approval.
          </div>
        </div>
      </div>

      {/* RIGHT */}
      <div className="w-60 bg-white border-l flex flex-col overflow-hidden flex-shrink-0">
        <div className="bg-blue-900 text-white text-xs font-bold px-3 py-2 uppercase tracking-wide">Live Cost Display</div>
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-2 bg-blue-50 border-b">
            <div className="text-xs font-bold text-blue-800 mb-2 uppercase tracking-wide truncate">{groupLabel}</div>
            {[{label:"Install Hours",value:fmtHrs(groupTotals.installHrs),color:"text-purple-700",bg:"bg-purple-50 border border-purple-100"},{label:"Commission Hours",value:fmtHrs(groupTotals.commHrs),color:"text-teal-700",bg:"bg-teal-50 border border-teal-100"}].map(r=>(
              <div key={r.label} className={`flex justify-between items-center py-1 px-2 rounded mb-1 ${r.bg}`}>
                <span className="text-xs text-gray-600">{r.label}</span><span className={`text-xs font-bold ${r.color}`}>{r.value}</span>
              </div>
            ))}
            <div className="my-2 border-t border-blue-200" />
            <div className="flex justify-between items-center py-1.5 px-2 rounded bg-blue-100 mb-1">
              <span className="text-xs font-semibold text-blue-800">EE Internal</span><span className="text-xs font-bold text-blue-900">{fmt(groupTotals.eeTotal)}</span>
            </div>
            <div className="flex justify-between items-center py-1.5 px-2 rounded bg-orange-100">
              <span className="text-xs font-semibold text-orange-800">Commercial</span><span className="text-xs font-bold text-orange-900">{fmt(groupTotals.commTotal)}</span>
            </div>
          </div>
          <div className="px-3 py-2">
            <div className="text-xs font-bold text-gray-600 mb-2 uppercase tracking-wide border-b pb-1">Investment Running Totals</div>
            {[{label:"Total Install Hours",value:fmtHrs(investTotals.installHrs),color:"text-purple-700"},{label:"Total Commission Hrs",value:fmtHrs(investTotals.commHrs),color:"text-teal-700"}].map(r=>(
              <div key={r.label} className="flex justify-between items-center py-1 border-b border-gray-100">
                <span className="text-xs text-gray-600">{r.label}</span><span className={`text-xs font-bold ${r.color}`}>{r.value}</span>
              </div>
            ))}
            <div className="mt-2 py-1.5 px-2 bg-blue-800 rounded text-white flex justify-between items-center mb-1">
              <span className="text-xs font-semibold">EE Internal Total</span><span className="text-xs font-bold">{fmt(investTotals.eeTotal)}</span>
            </div>
            <div className="py-1.5 px-2 bg-orange-600 rounded text-white flex justify-between items-center">
              <span className="text-xs font-semibold">Commercial Total</span><span className="text-xs font-bold">{fmt(investTotals.commTotal)}</span>
            </div>
            <div className="mt-3 space-y-1">
              <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Indicators</div>
              <div className="flex items-center gap-1.5 text-xs text-gray-500"><span className="text-orange-400">●</span>Row has cost overrides</div>
              <div className="flex items-center gap-1.5 text-xs text-gray-500"><span className="text-orange-600 font-bold">* hrs</span>Install hrs overridden</div>
              <div className="flex items-center gap-1.5 text-xs text-gray-500"><span className="bg-amber-100 text-amber-700 text-xs px-1 rounded">PCE</span>Period contract price</div>
            </div>
            <div className="mt-3 text-xs text-gray-400 text-center">
              {Object.values(quantities).filter(q => parseFloat(q)>0).length} lines entered
              {optEquipTotal > 0 && (
                <div className="mt-2 py-1.5 px-2 bg-teal-700 rounded text-white flex justify-between items-center">
                  <span className="text-xs font-semibold">Optional Equip.</span>
                  <span className="text-xs font-bold">{fmt(optEquipTotal)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── APP ROOT ─────────────────────────────────────────────────────
const TABS = [
  { id: "info",       label: "⚙️ Investment Setup",    badge: null },
  { id: "estimate",   label: "📐 Estimation",           badge: null },
  { id: "review",     label: "📋 Review Lines",         badge: null },
  { id: "summary",    label: "📊 Summary",              badge: null },
];

function EstimationApp() {
  const [activeTab, setActiveTab]     = useState("estimate");
  const [isCommercial, setIsComm]     = useState(false);

  return (
    <div className="flex flex-col h-screen bg-gray-100 font-sans text-sm select-none">

      {/* TOP BAR */}
      <div className="bg-blue-900 text-white px-4 py-2 flex items-center justify-between shadow-lg flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-bold text-base tracking-wide">⚡ IET Estimation Tool</span>
          <span className="text-blue-300 text-xs">|</span>
          <span className="text-blue-200 text-xs">Marulan 132kV 3-Way Switching Station — 10007569</span>
          <span className="bg-yellow-500 text-yellow-900 text-xs font-bold px-2 py-0.5 rounded">DRAFT</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs cursor-pointer">
            <input type="checkbox" checked={isCommercial} onChange={e => setIsComm(e.target.checked)} className="accent-orange-400" />
            <span className={isCommercial ? "text-orange-300 font-bold" : "text-blue-300"}>
              {isCommercial ? "Commercial Rates" : "EE Internal Rates"}
            </span>
          </label>
          <span className="text-blue-300 text-xs">D. Lawrence</span>
          <button className="bg-green-700 hover:bg-green-600 text-xs px-3 py-1 rounded">☁️ Export Copperleaf</button>
        </div>
      </div>

      {/* TAB BAR */}
      <div className="bg-white border-b flex items-end px-4 flex-shrink-0 shadow-sm">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`relative px-4 py-2.5 text-xs font-semibold transition-colors border-b-2 mr-1 -mb-px ${
              activeTab === tab.id
                ? "border-blue-600 text-blue-700 bg-blue-50"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}>
            {tab.label}
            {tab.badge && (
              <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* SCREEN CONTENT */}
      {activeTab === "info" && <GeneralInfoScreen />}
      {activeTab === "estimate" && (
        <div className="flex flex-1 overflow-hidden">
          <EstimationScreen isCommercial={isCommercial} />
        </div>
      )}
      {activeTab === "review" && (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-gray-400">
            <div className="text-4xl mb-3">📋</div>
            <div className="text-sm font-semibold text-gray-500">Review Lines Screen</div>
            <div className="text-xs mt-1">All entered estimate lines — tabular view with edit/delete</div>
          </div>
        </div>
      )}
      {activeTab === "summary" && (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-gray-400">
            <div className="text-4xl mb-3">📊</div>
            <div className="text-sm font-semibold text-gray-500">Investment Summary Screen</div>
            <div className="text-xs mt-1">Phase rollups · EE Internal vs Commercial · Submit for Review</div>
          </div>
        </div>
      )}

      {/* BOTTOM BAR */}
      <div className="bg-gray-200 border-t text-xs text-gray-500 px-4 py-1 flex justify-between flex-shrink-0">
        <span>Auto-saving to Dataverse — all changes saved immediately</span>
        <span>Investment Type: <strong className={isCommercial ? "text-orange-700" : "text-blue-700"}>{isCommercial ? "Commercially Funded" : "Internally Funded"}</strong> · Estimate Class: Class 4 · Rev A</span>
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════
// WBS MANAGER — Tab 2
// ════════════════════════════════════════════════════════════════


// ── SAMPLE DATA ──────────────────────────────────────────────────
const SAMPLE_WBS = [
  { code:"3.1.3.04.1.01", parent:"3.1.3.04.1", depth:6, scope:"Supply",     desc:"Disconnector 132kV 2500A - Busbar Height 4000mm",       resource:"ZS Electrical Technician", delivery:"EE Delivered", uom:"EA", crew:null, hrs:null, active:true,  modified:"D. Lawrence",  modDate:"2026-05-20" },
  { code:"3.1.3.04.1.02", parent:"3.1.3.04.1", depth:6, scope:"Supply",     desc:"Disconnector 132kV 2000A - Busbar Height 4000mm",       resource:"ZS Electrical Technician", delivery:"EE Delivered", uom:"EA", crew:null, hrs:null, active:true,  modified:"D. Lawrence",  modDate:"2026-05-20" },
  { code:"3.1.3.04.1.09", parent:"3.1.3.04.1", depth:6, scope:"Supply",     desc:"Disconnector 66kV 2500A - Busbar Height 3500mm",        resource:"ZS Electrical Technician", delivery:"EE Delivered", uom:"EA", crew:null, hrs:null, active:true,  modified:"D. Lawrence",  modDate:"2026-05-20" },
  { code:"3.1.3.04.1.10", parent:"3.1.3.04.1", depth:6, scope:"Supply",     desc:"Disconnector 66kV 2000A - Busbar Height 3500mm",        resource:"ZS Electrical Technician", delivery:"EE Delivered", uom:"EA", crew:null, hrs:null, active:true,  modified:"S. Chen",      modDate:"2026-04-15" },
  { code:"3.1.3.04.1.15", parent:"3.1.3.04.1", depth:6, scope:"Supply",     desc:"Disconnector Support Structure 3500mm",                  resource:"ZS Electrical Technician", delivery:"EE Delivered", uom:"EA", crew:null, hrs:null, active:false, modified:"M. Thompson",  modDate:"2026-03-10" },
  { code:"3.1.3.04.4.01", parent:"3.1.3.04.4", depth:6, scope:"Install",    desc:"≥66kV Disconnector Install",                            resource:"ZS Electrical Technician", delivery:"EE Delivered", uom:"EA", crew:4,    hrs:16,   active:true,  modified:"D. Lawrence",  modDate:"2026-05-20" },
  { code:"3.1.3.04.4.03", parent:"3.1.3.04.4", depth:6, scope:"Install",    desc:"≥66kV Earth Switch Install",                            resource:"ZS Electrical Technician", delivery:"EE Delivered", uom:"EA", crew:4,    hrs:8,    active:true,  modified:"D. Lawrence",  modDate:"2026-05-20" },
  { code:"3.1.3.04.7.01", parent:"3.1.3.04.7", depth:6, scope:"Commission", desc:"≥66kV Disconnector Commission",                         resource:"ZS Specialist Technician", delivery:"EE Delivered", uom:"EA", crew:2,    hrs:4,    active:true,  modified:"P. Nair",      modDate:"2026-05-15" },
  { code:"3.1.3.02.1.01", parent:"3.1.3.02.1", depth:6, scope:"Supply",     desc:"132kV Live Tank Circuit Breaker - 3AP1-FG 145kV (SF6)", resource:"ZS Electrical Technician", delivery:"EE Delivered", uom:"EA", crew:null, hrs:null, active:true,  modified:"D. Lawrence",  modDate:"2026-05-20" },
  { code:"3.1.3.02.4.01", parent:"3.1.3.02.4", depth:6, scope:"Install",    desc:"≥66kV Circuit Breaker Install",                         resource:"ZS Electrical Technician", delivery:"EE Delivered", uom:"EA", crew:4,    hrs:40,   active:true,  modified:"D. Lawrence",  modDate:"2026-05-20" },
  { code:"3.1.3.02.7.01", parent:"3.1.3.02.7", depth:6, scope:"Commission", desc:"≥66kV Circuit Breaker Commission",                      resource:"ZS Specialist Technician", delivery:"EE Delivered", uom:"EA", crew:2,    hrs:24,   active:true,  modified:"P. Nair",      modDate:"2026-05-15" },
  { code:"3.1.3.05.1.01", parent:"3.1.3.05.1", depth:6, scope:"Supply",     desc:"Current Transformer 132kV Oil/Paper 1000A",             resource:"ZS Electrical Technician", delivery:"EE Delivered", uom:"EA", crew:null, hrs:null, active:true,  modified:"D. Lawrence",  modDate:"2026-05-20" },
  { code:"3.1.3.05.4.01", parent:"3.1.3.05.4", depth:6, scope:"Install",    desc:"≥66kV Current Transformer Install",                     resource:"ZS Electrical Technician", delivery:"EE Delivered", uom:"EA", crew:4,    hrs:8,    active:true,  modified:"D. Lawrence",  modDate:"2026-05-20" },
];

const SAMPLE_PEOPLE = [
  { id:1,  name:"Daniel Lawrence",  email:"d.lawrence@ee.com.au",   role:"Lead Estimator",   team:"Zone Substation",  canReview:true,  active:true  },
  { id:2,  name:"Sarah Chen",       email:"s.chen@ee.com.au",       role:"Estimator",        team:"Zone Substation",  canReview:false, active:true  },
  { id:3,  name:"Mark Thompson",    email:"m.thompson@ee.com.au",   role:"Estimator",        team:"Subtransmission",  canReview:false, active:true  },
  { id:4,  name:"Priya Nair",       email:"p.nair@ee.com.au",       role:"Senior Estimator", team:"Zone Substation",  canReview:true,  active:true  },
  { id:5,  name:"James O'Brien",    email:"j.obrien@ee.com.au",     role:"Estimator",        team:"Communications",   canReview:false, active:true  },
  { id:6,  name:"Michael Santos",   email:"m.santos@ee.com.au",     role:"Lead Estimator",   team:"Commissioning",    canReview:true,  active:true  },
  { id:7,  name:"Anh Nguyen",       email:"a.nguyen@ee.com.au",     role:"Estimator",        team:"Zone Substation",  canReview:false, active:true  },
  { id:8,  name:"Emma Blackwood",   email:"e.blackwood@ee.com.au",  role:"Project Manager",  team:"Zone Substation",  canReview:true,  active:true  },
  { id:9,  name:"Tom Eriksson",     email:"t.eriksson@ee.com.au",   role:"Senior Estimator", team:"Civil & Earthing", canReview:true,  active:false },
];

const WBS_SCOPES = ["All","Supply","Install","Commission","Supply & Install","Inactive"];
const WBS_SCOPE_STYLES = {
  "Supply":          "bg-blue-100 text-blue-700 border border-blue-200",
  "Install":         "bg-purple-100 text-purple-700 border border-purple-200",
  "Commission":      "bg-teal-100 text-teal-700 border border-teal-200",
  "Supply & Install":"bg-indigo-100 text-indigo-700 border border-indigo-200",
  "Demolition":      "bg-red-100 text-red-700 border border-red-200",
};
const WBS_ROLE_STYLES = {
  "Lead Estimator":   "bg-blue-100 text-blue-700",
  "Senior Estimator": "bg-purple-100 text-purple-700",
  "Estimator":        "bg-gray-100 text-gray-600",
  "Project Manager":  "bg-green-100 text-green-700",
};

// ── SMALL COMPONENTS ─────────────────────────────────────────────
function ScopeBadge({ scope }) {
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${WBS_SCOPE_STYLES[scope] || "bg-gray-100 text-gray-500"}`}>{scope}</span>;
}

function StdHrsBadge({ crew, hrs }) {
  if (!crew || !hrs) return <span className="text-xs text-gray-300">—</span>;
  const total = crew * hrs;
  return <span className="text-xs font-mono text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">{crew}×{hrs}={total}h</span>;
}

function WBSNavigatorItem({ node, selected, onSelect, depth = 0 }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasKids = node.children && node.children.length > 0;
  const isLeaf  = !hasKids;

  return (
    <div>
      <div
        onClick={() => { if (hasKids) setExpanded(e => !e); else onSelect(node); }}
        className={`flex items-center gap-1 py-1 px-2 cursor-pointer rounded mx-1 text-xs transition-colors ${
          selected?.code === node.code ? "bg-blue-700 text-white" : "text-gray-700 hover:bg-gray-100"
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <span className="w-3 text-center text-gray-400 flex-shrink-0">
          {hasKids ? (expanded ? "▾" : "▸") : "·"}
        </span>
        <span className="font-mono text-gray-400 text-xs flex-shrink-0">{node.code}</span>
        <span className="ml-1 truncate">{node.label}</span>
        {node.scope && <ScopeBadge scope={node.scope} />}
      </div>
      {hasKids && expanded && node.children.map(child => (
        <WBSNavigatorItem key={child.code} node={child} selected={selected} onSelect={onSelect} depth={depth + 1} />
      ))}
    </div>
  );
}

// Build tree from flat WBS list
const WBS_NAV_TREE = [
  { code:"3.1.3", label:"HV Plant", children: [
    { code:"3.1.3.02", label:"Circuit Breakers", children:[
      { code:"3.1.3.02.1", label:"Supply", scope:"Supply",     children:[] },
      { code:"3.1.3.02.4", label:"Install", scope:"Install",   children:[] },
      { code:"3.1.3.02.7", label:"Commission", scope:"Commission", children:[] },
    ]},
    { code:"3.1.3.04", label:"Disconnectors & Earth Switches", children:[
      { code:"3.1.3.04.1", label:"Supply", scope:"Supply",     children:[] },
      { code:"3.1.3.04.4", label:"Install", scope:"Install",   children:[] },
      { code:"3.1.3.04.7", label:"Commission", scope:"Commission", children:[] },
    ]},
    { code:"3.1.3.05", label:"Current Transformers", children:[
      { code:"3.1.3.05.1", label:"Supply", scope:"Supply",     children:[] },
      { code:"3.1.3.05.4", label:"Install", scope:"Install",   children:[] },
    ]},
  ]},
];

// ── DETAIL FORM ──────────────────────────────────────────────────
function DetailForm({ item, isNew, onSave, onCancel }) {
  const [desc,     setDesc]     = useState(item?.desc     || "");
  const [scope,    setScope]    = useState(item?.scope    || "Supply");
  const [resource, setResource] = useState(item?.resource || "ZS Electrical Technician");
  const [delivery, setDelivery] = useState(item?.delivery || "EE Delivered");
  const [uom,      setUom]      = useState(item?.uom      || "EA");
  const [crew,     setCrew]     = useState(item?.crew     || "");
  const [hrs,      setHrs]      = useState(item?.hrs      || "");
  const [reason,   setReason]   = useState("");
  const [approvedBy, setApprovedBy] = useState("");

  const isInstOrComm = scope === "Install" || scope === "Commission";
  const totalHrs = (parseFloat(crew) || 0) * (parseFloat(hrs) || 0);
  const hoursChanged = !isNew && item && (
    parseFloat(crew) !== item.crew || parseFloat(hrs) !== item.hrs
  );

  return (
    <div className="w-96 bg-white border-l flex flex-col overflow-hidden flex-shrink-0 shadow-xl">
      <div className={`px-4 py-3 text-white flex items-center justify-between ${isNew ? "bg-green-700" : "bg-blue-700"}`}>
        <div>
          <div className="text-xs font-bold uppercase tracking-wide">
            {isNew ? "Add New WBS Item" : "Edit WBS Item"}
          </div>
          {!isNew && item && <div className="font-mono text-xs opacity-75">{item.code}</div>}
        </div>
        <button onClick={onCancel} className="text-white opacity-60 hover:opacity-100 text-lg">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Description */}
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">Description <span className="text-red-500">*</span></label>
          <input value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="Full activity description…"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>

        {/* Scope + Delivery */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Scope <span className="text-red-500">*</span></label>
            <select value={scope} onChange={e => setScope(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
              {["Supply","Install","Commission","Supply & Install","Demolition / Removal"].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">UOM</label>
            <select value={uom} onChange={e => setUom(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
              {["EA","m","m²","hr","lot"].map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
        </div>

        {/* Resource + Delivery */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Default Resource</label>
            <select value={resource} onChange={e => setResource(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
              {["ZS Electrical Technician","ZS Specialist Technician","Project Manager","Substation Designer","Protection Engineer","Telecomms Technician"].map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Delivery Method</label>
            <select value={delivery} onChange={e => setDelivery(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option>EE Delivered</option>
              <option>Contractor Delivered</option>
            </select>
          </div>
        </div>

        {/* Standard Hours — only for Install/Commission */}
        {isInstOrComm && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
            <div className="text-xs font-bold text-purple-800 mb-2 uppercase tracking-wide">
              Pre-Agreed Standard Hours
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Crew Size</label>
                <input type="number" min="1" value={crew} onChange={e => setCrew(e.target.value)}
                  className="w-full border border-purple-300 rounded px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-purple-400 bg-white" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Hrs / Person</label>
                <input type="number" min="0.5" step="0.5" value={hrs} onChange={e => setHrs(e.target.value)}
                  className="w-full border border-purple-300 rounded px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-purple-400 bg-white" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Total Hrs/Unit</label>
                <div className={`border rounded px-2 py-1.5 text-xs text-center font-bold ${totalHrs > 0 ? "border-purple-400 bg-purple-100 text-purple-800" : "border-gray-200 bg-gray-50 text-gray-400"}`}>
                  {totalHrs > 0 ? `${totalHrs} hrs` : "—"}
                </div>
              </div>
            </div>
            {hoursChanged && (
              <div className="mt-2 bg-yellow-50 border border-yellow-300 rounded p-2">
                <div className="text-xs text-yellow-800 font-semibold mb-1">⚠️ Hours are changing</div>
                <div className="text-xs text-yellow-700 mb-2">
                  This will affect all future estimates. Historical estimates are not changed.
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Approved By <span className="text-red-500">*</span></label>
                  <input value={approvedBy} onChange={e => setApprovedBy(e.target.value)}
                    placeholder="Stakeholder manager name…"
                    className="w-full border border-yellow-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-yellow-400" />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Scope Links — only for Supply */}
        {scope === "Supply" && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="text-xs font-bold text-blue-800 mb-2 uppercase tracking-wide">
              Scope Links
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Linked Install Row</label>
                <select className="w-full border border-blue-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                  <option>3.1.3.04.4.01 — ≥66kV Disconnector Install</option>
                  <option>3.1.3.04.4.03 — ≥66kV Earth Switch Install</option>
                  <option>— None —</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Linked Commission Row</label>
                <select className="w-full border border-blue-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                  <option>4.1.2.03.7.01 — ≥66kV Disconnector Commission</option>
                  <option>— None —</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Change reason — edit only */}
        {!isNew && (
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Change Reason</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Required if editing standard hours. Optional otherwise."
              rows={2}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>
        )}
      </div>

      <div className="p-4 border-t flex gap-2">
        <button
          disabled={!desc.trim() || (isInstOrComm && hoursChanged && !approvedBy.trim())}
          onClick={() => onSave({ desc, scope, resource, delivery, uom, crew: parseFloat(crew)||null, hrs: parseFloat(hrs)||null })}
          className="flex-1 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-blue-300 text-white py-2 rounded font-semibold">
          {isNew ? "Create WBS Item" : "Save Changes"}
        </button>
        <button onClick={onCancel}
          className="px-4 text-xs border border-gray-300 hover:bg-gray-50 rounded text-gray-600">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── SCALE PROFILES (compact for integrated tab) ──────────────────
const WBS_PROFILES = [
  { id:"SCADA_RTC",         name:"SCADA RTC",            section:"SCADA",    status:"Approved", tiers:[{f:1,t:2,s:1.00},{f:3,t:4,s:0.95},{f:5,t:7,s:0.90},{f:8,t:9,s:0.85},{f:10,t:null,s:0.80}] },
  { id:"SCADA_OTHER",       name:"SCADA General",        section:"SCADA",    status:"Draft",    tiers:[{f:1,t:2,s:1.00},{f:3,t:5,s:0.95},{f:6,t:null,s:0.90}] },
  { id:"HV_PLANT_OUTDOOR",  name:"HV Plant — Outdoor",   section:"HV Plant", status:"Pending",  tiers:[{f:1,t:2,s:1.00},{f:3,t:5,s:0.80},{f:6,t:null,s:0.75}] },
  { id:"HV_PLANT_INSTR",    name:"HV Plant — Instrument",section:"HV Plant", status:"Pending",  tiers:[{f:1,t:2,s:1.00},{f:3,t:5,s:0.80},{f:6,t:null,s:0.75}] },
  { id:"PROTECTION_STD",    name:"Protection Standard",  section:"Protection",status:"Draft",   tiers:[{f:1,t:2,s:1.00},{f:3,t:5,s:0.92},{f:6,t:9,s:0.87},{f:10,t:null,s:0.83}] },
  { id:"COMMS_STANDARD",    name:"Communications",        section:"Comms",    status:"Draft",    tiers:[{f:1,t:2,s:1.00},{f:3,t:6,s:0.90},{f:7,t:null,s:0.85}] },
];

const WBS_ST = { Approved:"bg-green-100 text-green-700", Pending:"bg-yellow-100 text-yellow-700", Draft:"bg-gray-100 text-gray-500" };
const WBS_FC = (f) => f>=1?"text-green-600":f>=0.90?"text-blue-600":f>=0.85?"text-yellow-600":f>=0.80?"text-orange-600":"text-red-600";

// ── PEOPLE & ROLES TAB ───────────────────────────────────────────
function PeopleTab({ people, setPeople }) {
  const [search, setSearch]   = useState("");
  const [filter, setFilter]   = useState("Active");
  const [editing, setEditing] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newPerson, setNewPerson] = useState({ name:"", email:"", role:"Estimator", team:"Zone Substation", canReview:false });

  const filtered = people.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.email.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "All" || (filter === "Active" && p.active) || (filter === "Inactive" && !p.active) || (filter === "Reviewers" && p.canReview);
    return matchSearch && matchFilter;
  });

  const deactivate = (id) => setPeople(prev => prev.map(p => p.id===id ? {...p, active:false} : p));
  const reactivate = (id) => setPeople(prev => prev.map(p => p.id===id ? {...p, active:true} : p));
  const addPerson  = () => {
    setPeople(prev => [...prev, { id: Date.now(), ...newPerson, active:true }]);
    setShowAdd(false);
    setNewPerson({ name:"", email:"", role:"Estimator", team:"Zone Substation", canReview:false });
  };

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="bg-white border-b px-4 py-2 flex items-center gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name or email…"
          className="border border-gray-300 rounded px-2 py-1.5 text-xs w-56 focus:outline-none focus:ring-1 focus:ring-blue-400" />
        <div className="flex border border-gray-200 rounded overflow-hidden">
          {["Active","Inactive","Reviewers","All"].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 ${filter===f ? "bg-blue-700 text-white" : "text-gray-600 hover:bg-gray-50"}`}>
              {f}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={() => setShowAdd(true)}
          className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded font-semibold">
          + Add Person
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-green-50 border-b border-green-200 px-4 py-3">
          <div className="text-xs font-bold text-green-800 mb-2 uppercase tracking-wide">Add New Person</div>
          <div className="grid grid-cols-5 gap-2 items-end">
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">Full Name *</label>
              <input value={newPerson.name} onChange={e => setNewPerson(p => ({...p, name:e.target.value}))}
                className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">Email *</label>
              <input value={newPerson.email} onChange={e => setNewPerson(p => ({...p, email:e.target.value}))}
                className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">Role</label>
              <select value={newPerson.role} onChange={e => setNewPerson(p => ({...p, role:e.target.value}))}
                className="w-full border border-gray-300 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-green-400">
                {["Estimator","Senior Estimator","Lead Estimator","Project Manager"].map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">Team</label>
              <select value={newPerson.team} onChange={e => setNewPerson(p => ({...p, team:e.target.value}))}
                className="w-full border border-gray-300 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-green-400">
                {["Zone Substation","Subtransmission","Communications","Civil & Earthing","Commissioning"].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex gap-2 items-center">
              <label className="flex items-center gap-1 text-xs text-gray-600">
                <input type="checkbox" checked={newPerson.canReview} onChange={e => setNewPerson(p => ({...p, canReview:e.target.checked}))} className="accent-blue-600" />
                Can review
              </label>
              <button onClick={addPerson} disabled={!newPerson.name || !newPerson.email}
                className="text-xs bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white px-3 py-1 rounded font-semibold whitespace-nowrap">
                Add
              </button>
              <button onClick={() => setShowAdd(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Table header */}
      <div className="grid text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b px-4 py-2"
        style={{ gridTemplateColumns:"1fr 1fr 140px 160px 80px 80px 120px" }}>
        <div>Name</div><div>Email</div><div>Role</div><div>Team</div>
        <div className="text-center">Reviewer</div><div className="text-center">Active</div><div />
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map((p, i) => (
          <div key={p.id}
            className={`grid items-center px-4 py-2.5 border-b text-xs ${p.active ? (i%2===0?"bg-white":"bg-gray-50") : "bg-red-50 opacity-70"}`}
            style={{ gridTemplateColumns:"1fr 1fr 140px 160px 80px 80px 120px" }}>
            <div className="font-semibold text-gray-800">{p.name}</div>
            <div className="text-gray-500 truncate">{p.email}</div>
            <div><span className={`text-xs px-1.5 py-0.5 rounded font-medium ${WBS_ROLE_STYLES[p.role] || "bg-gray-100 text-gray-600"}`}>{p.role}</span></div>
            <div className="text-gray-600">{p.team}</div>
            <div className="text-center">{p.canReview ? <span className="text-green-600 font-bold">✓</span> : <span className="text-gray-300">—</span>}</div>
            <div className="text-center">{p.active ? <span className="text-green-600 font-bold">✓</span> : <span className="text-red-500 text-xs">Inactive</span>}</div>
            <div className="flex gap-1 justify-end">
              {p.active
                ? <button onClick={() => deactivate(p.id)} className="text-xs text-red-500 hover:text-red-700 border border-red-200 rounded px-2 py-0.5">Deactivate</button>
                : <button onClick={() => reactivate(p.id)} className="text-xs text-green-600 hover:text-green-800 border border-green-200 rounded px-2 py-0.5">Reactivate</button>}
            </div>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="bg-gray-100 border-t px-4 py-1.5 text-xs text-gray-500 flex gap-4">
        <span>{people.filter(p=>p.active).length} active</span>
        <span>{people.filter(p=>!p.active).length} inactive</span>
        <span>{people.filter(p=>p.canReview).length} can review</span>
      </div>
    </div>
  );
}

// ── SCALING PROFILES TAB (compact) ───────────────────────────────
function ScalingTab() {
  const [selected, setSelected] = useState("SCADA_RTC");
  const [previewQty, setPreviewQty] = useState(6);
  const [profiles, setProfiles] = useState(WBS_PROFILES);
  const profile = profiles.find(p => p.id === selected);

  const previewFactor = useMemo(() => {
    if (!profile) return 1;
    const match = profile.tiers.find(t => previewQty >= t.f && (t.t === null || previewQty <= t.t));
    return match ? match.s : 1;
  }, [profile, previewQty]);

  const updateTierFactor = (tierIdx, val) => {
    setProfiles(prev => prev.map(p => p.id !== selected ? p : {
      ...p, tiers: p.tiers.map((t, i) => i === tierIdx ? { ...t, s: val } : t)
    }));
  };

  const sections = [...new Set(PROFILES.map(p => p.section))];

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Profile list */}
      <div className="w-64 border-r bg-white flex flex-col overflow-hidden">
        <div className="p-2 border-b">
          <div className="text-xs font-bold text-gray-600 uppercase tracking-wide">Scaling Profiles</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sections.map(sec => (
            <div key={sec}>
              <div className="px-3 py-1 text-xs font-bold text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-t mt-1">{sec}</div>
              {profiles.filter(p => p.section === sec).map(p => (
                <div key={p.id} onClick={() => setSelected(p.id)}
                  className={`px-3 py-2 cursor-pointer border-b border-gray-100 transition-colors ${selected===p.id ? "bg-blue-50 border-l-4 border-l-blue-600" : "hover:bg-gray-50"}`}>
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-xs font-medium ${selected===p.id?"text-blue-800":"text-gray-700"}`}>{p.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${WBS_ST[p.status]}`}>{p.status}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{p.tiers.length} tiers</div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="p-2 border-t">
          <button className="w-full text-xs text-blue-700 border border-blue-300 rounded py-1.5 hover:bg-blue-50 font-semibold">
            + New Profile
          </button>
        </div>
      </div>

      {/* Tier editor */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 p-4 gap-4">
        {profile && (
          <>
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="bg-blue-700 text-white px-4 py-2 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold">{profile.name}</span>
                  <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${WBS_ST[profile.status]}`}>{profile.status}</span>
                </div>
                <span className="text-xs text-blue-200">Edit tier values below — changes save to Dataverse</span>
              </div>

              <div className="p-4">
                {/* Column labels */}
                <div className="grid text-xs font-semibold text-gray-500 uppercase mb-1"
                  style={{ gridTemplateColumns:"80px 80px 110px 80px 1fr" }}>
                  <div className="text-center">Qty From</div>
                  <div className="text-center">Qty To</div>
                  <div className="text-center">Scale Factor</div>
                  <div className="text-center">Reduction</div>
                  <div className="text-center">Visual</div>
                </div>

                {profile.tiers.map((tier, i) => (
                  <div key={i} className="grid items-center gap-2 py-2 border-b border-gray-100 last:border-0"
                    style={{ gridTemplateColumns:"80px 80px 110px 80px 1fr" }}>
                    <div className="text-center text-xs font-mono bg-gray-100 rounded px-2 py-1">{tier.f}</div>
                    <div className="text-center text-xs font-mono bg-gray-100 rounded px-2 py-1">{tier.t ?? "∞"}</div>
                    <div className="flex justify-center">
                      <input type="number" min="0.5" max="1.0" step="0.01"
                        value={tier.s}
                        onChange={e => updateTierFactor(i, parseFloat(e.target.value) || 1)}
                        className={`w-20 border rounded px-2 py-1 text-xs text-center font-bold focus:outline-none focus:ring-1 focus:ring-blue-400 ${FACTOR_COLOR(tier.s)}`} />
                    </div>
                    <div className={`text-xs font-bold text-center ${FC(tier.s)}`}>
                      {tier.s >= 1 ? "None" : `-${((1-tier.s)*100).toFixed(0)}%`}
                    </div>
                    <div className="bg-gray-100 rounded h-4 overflow-hidden">
                      <div className={`h-full rounded ${tier.s>=1?"bg-green-400":tier.s>=0.90?"bg-blue-400":tier.s>=0.80?"bg-orange-400":"bg-red-400"}`}
                        style={{ width:`${tier.s*100}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              {profile.status !== "Approved" && (
                <div className="px-4 pb-3">
                  <button className="text-xs bg-green-700 hover:bg-green-600 text-white px-4 py-1.5 rounded font-semibold">
                    Mark as Approved ✓
                  </button>
                  <span className="text-xs text-gray-400 ml-2">Requires stakeholder name and date before approving</span>
                </div>
              )}
            </div>

            {/* Live preview */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
              <div className="text-xs font-bold text-gray-700 mb-3 uppercase tracking-wide">Live Preview</div>
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Test quantity</label>
                  <input type="number" min="1" value={previewQty} onChange={e => setPreviewQty(parseInt(e.target.value)||1)}
                    className="w-20 border border-gray-300 rounded px-2 py-1.5 text-sm text-center font-bold focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
                <div className="text-2xl text-gray-300">→</div>
                <div className={`px-4 py-2 rounded-lg border-2 text-center ${FACTOR_COLOR(previewFactor)}`}>
                  <div className="text-lg font-bold">{previewFactor.toFixed(2)}</div>
                  <div className="text-xs">Scale Factor</div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 flex-1">
                  <div className="text-xs text-blue-700 font-semibold">Example: 32 base hrs/unit</div>
                  <div className="text-xs text-gray-600 mt-1">
                    Base total: <strong>{previewQty*32} hrs</strong>
                    <span className="mx-2 text-gray-300">→</span>
                    Scaled: <strong className="text-blue-700">{(previewQty*32*previewFactor).toFixed(1)} hrs</strong>
                    {previewFactor < 1 && <span className="ml-2 text-green-600">(saving {(previewQty*32*(1-previewFactor)).toFixed(1)} hrs)</span>}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── WBS MANAGER MAIN ─────────────────────────────────────────────
const WBS_TABS = [
  { id:"wbs",     label:"🏗️ WBS Items" },
  { id:"scaling", label:"📊 Commissioning Scaling" },
  { id:"people",  label:"👥 People & Roles" },
];

function WBSManager() {
  const [activeTab, setActiveTab]       = useState("wbs");
  const [wbsItems, setWbsItems]         = useState(SAMPLE_WBS);
  const [people, setPeople]             = useState(SAMPLE_PEOPLE);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [scopeFilter, setScopeFilter]   = useState("All");
  const [searchText, setSearchText]     = useState("");
  const [showDetail, setShowDetail]     = useState(false);
  const [editingItem, setEditingItem]   = useState(null);
  const [isNew, setIsNew]               = useState(false);
  const [deactivateId, setDeactivateId] = useState(null);
  const [deactivateReason, setDeactivateReason] = useState("");

  const displayItems = useMemo(() => {
    return wbsItems.filter(item => {
      const matchGroup = !selectedGroup || item.parent.startsWith(selectedGroup.code);
      const matchScope = scopeFilter === "All" || scopeFilter === "Inactive"
        ? (scopeFilter === "Inactive" ? !item.active : true)
        : item.scope === scopeFilter && item.active;
      const matchSearch = !searchText || item.desc.toLowerCase().includes(searchText.toLowerCase()) || item.code.includes(searchText);
      return matchGroup && matchScope && matchSearch;
    });
  }, [wbsItems, selectedGroup, scopeFilter, searchText]);

  const handleEdit = (item) => { setEditingItem(item); setIsNew(false); setShowDetail(true); };
  const handleAdd  = () => { setEditingItem(null); setIsNew(true); setShowDetail(true); };
  const handleSave = () => { setShowDetail(false); };
  const handleDeactivate = (item) => { setDeactivateId(item.code); setDeactivateReason(""); };
  const confirmDeactivate = () => {
    setWbsItems(prev => prev.map(w => w.code === deactivateId ? {...w, active:false} : w));
    setDeactivateId(null);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100 font-sans text-sm select-none">

      {/* TOP BAR */}
      <div className="bg-blue-900 text-white px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-bold">⚡ IET WBS Manager</span>
          <span className="text-xs bg-orange-500 px-2 py-0.5 rounded font-semibold">ADMIN</span>
          <span className="text-blue-300 text-xs">Restricted access — Lead Estimators & System Admins only</span>
        </div>
        <span className="text-blue-300 text-xs">D. Lawrence · Lead Estimator</span>
      </div>

      {/* TAB BAR */}
      <div className="bg-white border-b flex items-end px-4 flex-shrink-0 shadow-sm">
        {WBS_TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-xs font-semibold transition-colors border-b-2 mr-1 -mb-px ${
              activeTab === tab.id
                ? "border-blue-600 text-blue-700 bg-blue-50"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── WBS ITEMS TAB ── */}
      {activeTab === "wbs" && (
        <div className="flex flex-1 overflow-hidden">

          {/* Left: Navigator */}
          <div className="w-56 bg-white border-r flex flex-col overflow-hidden flex-shrink-0">
            <div className="p-2 border-b text-xs font-bold text-gray-600 uppercase tracking-wide bg-gray-50">
              WBS Navigator
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {WBS_NAV_TREE.map(node => (
                <WBSNavigatorItem key={node.code} node={node} selected={selectedGroup} onSelect={setSelectedGroup} />
              ))}
            </div>
            <div className="p-2 border-t">
              <button onClick={() => setSelectedGroup(null)}
                className="w-full text-xs text-gray-500 hover:text-blue-700 py-1">
                ← Show all items
              </button>
            </div>
          </div>

          {/* Centre: Item list */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">

            {/* Toolbar */}
            <div className="bg-white border-b px-3 py-2 flex items-center gap-2 flex-shrink-0">
              <input value={searchText} onChange={e => setSearchText(e.target.value)}
                placeholder="Search description or WBS code…"
                className="border border-gray-300 rounded px-2 py-1.5 text-xs w-52 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              <div className="flex border border-gray-200 rounded overflow-hidden">
                {WBS_SCOPES.map(s => (
                  <button key={s} onClick={() => setScopeFilter(s)}
                    className={`text-xs px-2.5 py-1.5 transition-colors ${scopeFilter===s ? "bg-blue-700 text-white" : "text-gray-600 hover:bg-gray-50"}`}>
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <span className="text-xs text-gray-400">{displayItems.length} items</span>
              <button onClick={handleAdd}
                className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded font-semibold">
                + Add WBS Item
              </button>
            </div>

            {/* Column headers */}
            <div className="grid text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b px-3 py-1.5 flex-shrink-0"
              style={{ gridTemplateColumns:"2fr 80px 80px 120px 100px 80px 120px" }}>
              <div>Description / WBS Code</div>
              <div className="text-center">Scope</div>
              <div className="text-center">UOM</div>
              <div className="text-center">Std Hours</div>
              <div className="text-center">Resource</div>
              <div className="text-center">Active</div>
              <div className="text-center">Actions</div>
            </div>

            {/* Rows */}
            <div className="flex-1 overflow-y-auto">
              {displayItems.map((item, idx) => (
                <div key={item.code}
                  className={`grid items-center px-3 py-2 border-b text-xs ${
                    !item.active ? "bg-red-50 opacity-70" :
                    idx%2===0 ? "bg-white" : "bg-gray-50"
                  }`}
                  style={{ gridTemplateColumns:"2fr 80px 80px 120px 100px 80px 120px" }}>

                  <div className="min-w-0 pr-2">
                    <div className={`font-medium truncate ${!item.active ? "line-through text-gray-400" : "text-gray-800"}`}>
                      {item.desc}
                    </div>
                    <div className="font-mono text-gray-400 text-xs">{item.code}</div>
                  </div>

                  <div className="flex justify-center">
                    <ScopeBadge scope={item.scope} />
                  </div>

                  <div className="text-center text-gray-500">{item.uom}</div>

                  <div className="flex justify-center">
                    <StdHrsBadge crew={item.crew} hrs={item.hrs} />
                  </div>

                  <div className="text-center text-gray-500 text-xs truncate px-1" title={item.resource}>
                    {item.resource?.split(" ").slice(-2).join(" ")}
                  </div>

                  <div className="text-center">
                    {item.active
                      ? <span className="text-green-600 font-bold">✓</span>
                      : <span className="text-red-500 text-xs font-semibold">Inactive</span>}
                  </div>

                  <div className="flex gap-1 justify-center">
                    <button onClick={() => handleEdit(item)}
                      className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-2 py-0.5 hover:bg-blue-50">
                      Edit
                    </button>
                    {item.active
                      ? <button onClick={() => handleDeactivate(item)}
                          className="text-xs text-red-500 hover:text-red-700 border border-red-200 rounded px-2 py-0.5 hover:bg-red-50">
                          Deactivate
                        </button>
                      : <button onClick={() => setWbsItems(prev => prev.map(w => w.code===item.code ? {...w,active:true} : w))}
                          className="text-xs text-green-600 hover:text-green-800 border border-green-200 rounded px-2 py-0.5 hover:bg-green-50">
                          Reactivate
                        </button>}
                  </div>
                </div>
              ))}
            </div>

            {/* Deactivation confirmation */}
            {deactivateId && (
              <div className="border-t bg-red-50 px-4 py-3 flex items-center gap-3 flex-shrink-0">
                <span className="text-xs font-bold text-red-700">⚠️ Deactivating: {deactivateId}</span>
                <input value={deactivateReason} onChange={e => setDeactivateReason(e.target.value)}
                  placeholder="Reason for deactivation (required)…"
                  className="flex-1 border border-red-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-red-400 bg-white" />
                <button onClick={confirmDeactivate} disabled={!deactivateReason.trim()}
                  className="text-xs bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white px-3 py-1.5 rounded font-semibold">
                  Confirm Deactivate
                </button>
                <button onClick={() => setDeactivateId(null)}
                  className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
              </div>
            )}
          </div>

          {/* Detail form slide-in */}
          {showDetail && (
            <DetailForm
              item={editingItem}
              isNew={isNew}
              onSave={handleSave}
              onCancel={() => setShowDetail(false)}
            />
          )}
        </div>
      )}

      {activeTab === "scaling" && <ScalingTab />}
      {activeTab === "people"  && <PeopleTab people={people} setPeople={setPeople} />}

      {/* BOTTOM BAR */}
      <div className="bg-gray-200 border-t text-xs text-gray-500 px-4 py-1 flex justify-between flex-shrink-0">
        <span>⚙️ IET WBS Manager · All changes logged to audit trail</span>
        <span>
          {wbsItems.filter(w=>w.active).length} active WBS items ·{" "}
          {people.filter(p=>p.active).length} active people ·{" "}
          {WBS_PROFILES.filter(p=>p.status==="Approved").length}/{PROFILES.length} profiles approved
        </span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// ROOT — switches between Estimation App and WBS Manager
// ════════════════════════════════════════════════════════════════
export default function App() {
  const [page, setPage] = useState("estimation");
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* App switcher bar */}
      <div style={{ background: "#0f2848", padding: "4px 16px", display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
        <span style={{ color: "#93c5fd", fontSize: "10px", fontWeight: "bold", marginRight: "8px" }}>
          IET PLATFORM
        </span>
        <button
          onClick={() => setPage("estimation")}
          style={{
            fontSize: "11px", padding: "4px 12px", borderRadius: "4px", border: "none",
            cursor: "pointer", fontWeight: page === "estimation" ? "bold" : "normal",
            background: page === "estimation" ? "#1d4ed8" : "transparent",
            color: page === "estimation" ? "white" : "#93c5fd",
          }}>
          📐 Estimation Tool
        </button>
        <button
          onClick={() => setPage("wbs")}
          style={{
            fontSize: "11px", padding: "4px 12px", borderRadius: "4px", border: "none",
            cursor: "pointer", fontWeight: page === "wbs" ? "bold" : "normal",
            background: page === "wbs" ? "#92400e" : "transparent",
            color: page === "wbs" ? "white" : "#f59e0b",
          }}>
          ⚙️ WBS Manager
        </button>
        <span style={{ marginLeft: "auto", color: "#475569", fontSize: "10px" }}>
          Demo — Essential Energy IET Platform
        </span>
      </div>
      {/* Page content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {page === "estimation" && <EstimationApp />}
        {page === "wbs"        && <WBSManager />}
      </div>
    </div>
  );
}
