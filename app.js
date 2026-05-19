const REBAR = [
  { size: "10M", area: 100, diameter: 11.3 },
  { size: "15M", area: 200, diameter: 16.0 },
  { size: "20M", area: 300, diameter: 19.5 },
  { size: "25M", area: 500, diameter: 25.2 },
  { size: "30M", area: 700, diameter: 29.9 },
  { size: "35M", area: 1000, diameter: 35.7 },
  { size: "45M", area: 1500, diameter: 43.7 },
  { size: "55M", area: 2500, diameter: 56.4 }
];

const DEFAULTS = {
  beamSystem: "simple",
  stationCount: 201,
  L1: 16,
  L2: 16,
  Wf: 544,
  Pf: 0,
  Px: 8,
  includePoint: "no",
  h: 1800,
  b: 3000,
  sectionModel: "rectangular",
  flangeWidth: 3000,
  flangeDepth: 350,
  slabDepth: 350,
  fc: 50,
  fy: 400,
  lambda: 1.0,
  phiC: 0.65,
  phiS: 0.85,
  cover: 50,
  mainBar: "35M",
  mainCount: 28,
  bottomRows: 1,
  topBar: "35M",
  topCount: 0,
  topRows: 1,
  barRowSpacing: 75,
  shearMethod: "simplified",
  Es: 200000,
  ag: 20,
  szeMode: "auto",
  sze: 300,
  interfaceCondition: "roughened",
  interfaceDemandModel: "elastic",
  cohesion: 0.50,
  mu: 1.00,
  zMode: "auto",
  zFactor: 0.96,
  allocation: "balance",
  stirrupBar: "15M",
  stirrupLegs: 8,
  stirrupSpacing: 450,
  dowelBar: "15M",
  dowelLegs: 4,
  dowelSpacing: 350,
  zoneDesignMode: "zoned",
  zoneDesignStrategy: "primaryOnly",
  zoneMinSpacing: 100,
  zoneMaxSpacing: 450,
  zoneMaxCount: 5,
  zoneMinLength: 0
};

let lastResult = null;
let selectedStationIndex = 0;
let scrubDragActive = false;
let designZones = []; // flattened compatibility view used by the calculation engine
let zoneDefinitions = [];
let zoneAssignments = [];
let zoneDefinitionIdCounter = 1;
let zoneAssignmentIdCounter = 1;

function $(id) {
  return document.getElementById(id);
}

function num(id) {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : 0;
}

function val(id) {
  return $(id).value;
}

function fmt(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: digits });
  if (abs >= 100) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (abs >= 10) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function rebar(size) {
  return REBAR.find(r => r.size === size) || REBAR[0];
}

function setupRebarSelects() {
  ["mainBar", "topBar", "stirrupBar", "dowelBar"].forEach(id => {
    const el = $(id);
    el.innerHTML = "";
    REBAR.forEach(r => {
      const opt = document.createElement("option");
      opt.value = r.size;
      opt.textContent = `${r.size} (${r.area} mm²)`;
      el.appendChild(opt);
    });
  });
}

function rebarOptions(selected) {
  return REBAR.map(r => `<option value="${r.size}" ${r.size === selected ? "selected" : ""}>${r.size} (${r.area} mm²)</option>`).join("");
}

function beamLengthFromCurrentInputs() {
  const temp = {
    beamSystem: val("beamSystem"),
    L1: Math.max(0.1, num("L1")),
    L2: Math.max(0.1, num("L2"))
  };
  return beamLength(temp);
}

function baseZoneDefinition() {
  return {
    id: zoneDefinitions[0]?.id || zoneDefinitionIdCounter++,
    label: "Zone 1",
    isBase: true,
    stirrupBar: val("stirrupBar") || DEFAULTS.stirrupBar,
    stirrupLegs: num("stirrupLegs") || DEFAULTS.stirrupLegs,
    stirrupSpacing: num("stirrupSpacing") || DEFAULTS.stirrupSpacing,
    dowelBar: val("dowelBar") || DEFAULTS.dowelBar,
    dowelLegs: num("dowelLegs"),
    dowelSpacing: num("dowelSpacing") || DEFAULTS.dowelSpacing
  };
}

function zoneFromBaseInputs(x1 = 0, x2 = null) {
  const L = beamLengthFromCurrentInputs();
  const def = baseZoneDefinition();
  return {
    ...def,
    assignmentId: zoneAssignments[0]?.id || 1,
    x1,
    x2: x2 ?? L
  };
}

function normalizeZoneDefinition(def, idx = 0) {
  const base = baseZoneDefinition();
  const isBase = idx === 0 || def?.isBase;
  if (isBase) return { ...base, id: def?.id || base.id, label: "Zone 1", isBase: true };
  return {
    id: def?.id || zoneDefinitionIdCounter++,
    label: def?.label || `Zone ${idx + 1}`,
    isBase: false,
    stirrupBar: def?.stirrupBar || val("stirrupBar") || DEFAULTS.stirrupBar,
    stirrupLegs: Math.max(0, Math.round(+def?.stirrupLegs || 0)),
    stirrupSpacing: Math.max(25, +def?.stirrupSpacing || DEFAULTS.stirrupSpacing),
    dowelBar: def?.dowelBar || val("dowelBar") || DEFAULTS.dowelBar,
    dowelLegs: Math.max(0, Math.round(+def?.dowelLegs || 0)),
    dowelSpacing: Math.max(25, +def?.dowelSpacing || DEFAULTS.dowelSpacing)
  };
}

function ensureZoneModel() {
  const L = beamLengthFromCurrentInputs();
  if (!zoneDefinitions.length) zoneDefinitions = [baseZoneDefinition()];
  zoneDefinitions[0] = normalizeZoneDefinition(zoneDefinitions[0], 0);
  zoneDefinitions = zoneDefinitions.map((z, idx) => normalizeZoneDefinition(z, idx));

  if (!zoneAssignments.length) {
    zoneAssignments = [{ id: zoneAssignmentIdCounter++, defId: zoneDefinitions[0].id, x1: 0, x2: L, isBase: true }];
  }
  zoneAssignments[0] = {
    ...(zoneAssignments[0] || {}),
    id: zoneAssignments[0]?.id || zoneAssignmentIdCounter++,
    defId: zoneDefinitions[0].id,
    x1: 0,
    x2: L,
    isBase: true
  };
  const definitionIds = new Set(zoneDefinitions.map(z => z.id));
  zoneAssignments = zoneAssignments.map((a, idx) => {
    const isBase = idx === 0 || a?.isBase;
    const defId = isBase ? zoneDefinitions[0].id : (definitionIds.has(+a?.defId) ? +a.defId : zoneDefinitions[0].id);
    const x1 = isBase ? 0 : clamp(Number.isFinite(+a?.x1) ? +a.x1 : 0, 0, L);
    const x2 = isBase ? L : clamp(Number.isFinite(+a?.x2) ? +a.x2 : L, 0, L);
    return {
      id: a?.id || zoneAssignmentIdCounter++,
      defId,
      x1: Math.min(x1, x2),
      x2: Math.max(x1, x2),
      isBase
    };
  });

  designZones = flattenZoneAssignments(L);
}

function flattenZoneAssignments(L = beamLengthFromCurrentInputs()) {
  const byId = new Map(zoneDefinitions.map(z => [z.id, z]));
  return zoneAssignments.map((a, idx) => {
    const def = byId.get(a.defId) || zoneDefinitions[0] || baseZoneDefinition();
    return {
      ...def,
      id: def.id,
      assignmentId: a.id,
      label: def.label || (idx === 0 ? "Zone 1" : `Zone ${idx + 1}`),
      x1: idx === 0 ? 0 : clamp(+a.x1 || 0, 0, L),
      x2: idx === 0 ? L : clamp(+a.x2 || 0, 0, L)
    };
  }).filter((z, idx) => idx === 0 || z.x2 > z.x1 + 1e-9);
}

function ensureDesignZones() {
  ensureZoneModel();
}

function collectDesignZones(inputs) {
  ensureZoneModel();
  const L = beamLength(inputs);
  const zones = flattenZoneAssignments(L);
  const base = { ...zones[0], x1: 0, x2: L, label: "Zone 1" };
  const extras = inputs.zoneDesignMode === "uniform" ? [] : zones.slice(1).map((z, idx) => ({
    ...z,
    label: z.label || `Zone ${idx + 2}`,
    x1: clamp(+z.x1 || 0, 0, L),
    x2: clamp(+z.x2 || 0, 0, L)
  })).filter(z => z.x2 > z.x1 + 1e-9);
  return [base, ...extras].map((z, idx) => ({ ...z, id: z.id || idx + 1, label: idx === 0 ? "Zone 1" : (z.label || `Zone ${idx + 1}`) }));
}

function renderZoneEditor() {
  const el = $("zoneEditor");
  if (!el) return;
  ensureZoneModel();
  const L = beamLengthFromCurrentInputs();
  const definitionRows = zoneDefinitions.map((z, idx) => {
    const isBase = idx === 0 || z.isBase;
    return `<div class="zone-card zone-definition-card" data-zone-definition-id="${z.id}">
      <div class="zone-card-head">
        <strong>${z.label}${isBase ? " — base definition" : ""}</strong>
        ${isBase ? `<span class="small-muted">Edited in Zone 1 fields above</span>` : `<button class="mini-button zone-definition-delete" type="button" data-zone-definition-id="${z.id}">×</button>`}
      </div>
      <div class="zone-card-grid">
        ${isBase ? `<div class="zone-inherit-note">This definition is the default full-span reinforcement. Edit its bars, legs, and spacing in the Zone 1 fields above.</div>` : `
          <label>Definition name<input class="zone-input" data-kind="definition" data-zone-definition-id="${z.id}" data-field="label" type="text" value="${z.label}"></label>
          <label>Primary bar<select class="zone-input" data-kind="definition" data-zone-definition-id="${z.id}" data-field="stirrupBar">${rebarOptions(z.stirrupBar)}</select></label>
          <label>Primary legs<input class="zone-input" data-kind="definition" data-zone-definition-id="${z.id}" data-field="stirrupLegs" type="number" min="0" step="1" value="${Math.round(z.stirrupLegs || 0)}"></label>
          <label>Primary spacing, mm<input class="zone-input" data-kind="definition" data-zone-definition-id="${z.id}" data-field="stirrupSpacing" type="number" min="50" step="25" value="${Math.round(z.stirrupSpacing || 0)}"></label>
          <label>Dowel bar<select class="zone-input" data-kind="definition" data-zone-definition-id="${z.id}" data-field="dowelBar">${rebarOptions(z.dowelBar)}</select></label>
          <label>Dowel legs<input class="zone-input" data-kind="definition" data-zone-definition-id="${z.id}" data-field="dowelLegs" type="number" min="0" step="1" value="${Math.round(z.dowelLegs || 0)}"></label>
          <label>Dowel spacing, mm<input class="zone-input" data-kind="definition" data-zone-definition-id="${z.id}" data-field="dowelSpacing" type="number" min="50" step="25" value="${Math.round(z.dowelSpacing || 0)}"></label>`}
      </div>
    </div>`;
  }).join("");

  const assignmentRows = zoneAssignments.map((a, idx) => {
    const isBase = idx === 0 || a.isBase;
    const defOptions = zoneDefinitions.map(z => `<option value="${z.id}" ${z.id === a.defId ? "selected" : ""}>${z.label}</option>`).join("");
    return `<div class="zone-card zone-assignment-card" data-zone-assignment-id="${a.id}">
      <div class="zone-card-head">
        <strong>${isBase ? "Base assignment — full beam" : `Assignment ${idx}`}</strong>
        ${isBase ? `<span class="small-muted">Zone 1 fallback everywhere</span>` : `<button class="mini-button zone-assignment-delete" type="button" data-zone-assignment-id="${a.id}">×</button>`}
      </div>
      <div class="zone-card-grid">
        <label>Use zone definition<select class="zone-input" data-kind="assignment" data-zone-assignment-id="${a.id}" data-field="defId" ${isBase ? "disabled" : ""}>${defOptions}</select></label>
        <label>x start, m<input class="zone-input" data-kind="assignment" data-zone-assignment-id="${a.id}" data-field="x1" type="number" min="0" max="${L}" step="0.05" value="${Number(a.x1 || 0).toFixed(3)}" ${isBase ? "readonly" : ""}></label>
        <label>x end, m<input class="zone-input" data-kind="assignment" data-zone-assignment-id="${a.id}" data-field="x2" type="number" min="0" max="${L}" step="0.05" value="${Number(a.x2 || 0).toFixed(3)}" ${isBase ? "readonly" : ""}></label>
      </div>
    </div>`;
  }).join("");

  el.innerHTML = `<div class="zone-editor-section">
      <div class="zone-editor-subhead"><h4>Zone definitions</h4><button class="secondary-button" id="addZoneDefinitionButton" type="button">+ Add definition</button></div>
      <div class="small-muted zone-editor-help">Define reinforcement once. A definition can then be assigned to multiple non-contiguous x-ranges.</div>
      ${definitionRows}
    </div>
    <div class="zone-editor-section">
      <div class="zone-editor-subhead"><h4>Zone assignments</h4><button class="secondary-button" id="addZoneAssignmentButton" type="button">+ Add assignment</button></div>
      <div class="small-muted zone-editor-help">Assignments control where each definition applies. Later assignments override earlier assignments where ranges overlap.</div>
      ${assignmentRows}
    </div>`;

  const addDef = $("addZoneDefinitionButton");
  if (addDef) addDef.addEventListener("click", addZoneDefinition);
  const addAssign = $("addZoneAssignmentButton");
  if (addAssign) addAssign.addEventListener("click", addZoneAssignment);
}

function addZoneDefinition() {
  ensureZoneModel();
  const base = zoneDefinitions[0] || baseZoneDefinition();
  zoneDefinitions.push({
    ...base,
    id: zoneDefinitionIdCounter++,
    isBase: false,
    label: `Zone ${zoneDefinitions.length + 1}`
  });
  renderZoneEditor();
  runCalculations();
}

function addZoneAssignment() {
  ensureZoneModel();
  const L = beamLengthFromCurrentInputs();
  const n = zoneAssignments.length;
  const width = Math.max(0.5, Math.min(2.0, L / 4));
  const start = Math.max(0, Math.min(L - width, n * width));
  const def = zoneDefinitions[zoneDefinitions.length - 1] || zoneDefinitions[0];
  zoneAssignments.push({
    id: zoneAssignmentIdCounter++,
    defId: def.id,
    x1: start,
    x2: Math.min(L, start + width),
    isBase: false
  });
  renderZoneEditor();
  runCalculations();
}

function addUserZone() {
  addZoneAssignment();
}

function updateZoneFromEvent(el) {
  const kind = el.dataset.kind || (el.dataset.zoneAssignmentId ? "assignment" : "definition");
  const field = el.dataset.field;
  if (!field) return;
  if (kind === "assignment") {
    const id = parseInt(el.dataset.zoneAssignmentId || el.dataset.zoneId, 10);
    const assignment = zoneAssignments.find(z => z.id === id);
    if (!assignment || assignment.isBase) return;
    if (["x1", "x2", "defId"].includes(field)) assignment[field] = parseFloat(el.value) || 0;
  } else {
    const id = parseInt(el.dataset.zoneDefinitionId || el.dataset.zoneId, 10);
    const def = zoneDefinitions.find(z => z.id === id);
    if (!def || def.isBase) return;
    if (["stirrupLegs", "stirrupSpacing", "dowelLegs", "dowelSpacing"].includes(field)) {
      def[field] = parseFloat(el.value) || 0;
    } else {
      def[field] = el.value;
    }
  }
  ensureZoneModel();
  runCalculations();
}

function deleteZoneDefinition(id) {
  ensureZoneModel();
  const def = zoneDefinitions.find(z => z.id === id);
  if (!def || def.isBase) return;
  zoneDefinitions = zoneDefinitions.filter(z => z.id !== id);
  zoneAssignments = zoneAssignments.filter((a, idx) => idx === 0 || a.defId !== id);
  renderZoneEditor();
  runCalculations();
}

function deleteZoneAssignment(id) {
  zoneAssignments = zoneAssignments.filter((z, idx) => idx === 0 || z.id !== id);
  renderZoneEditor();
  runCalculations();
}

function deleteZone(id) {
  deleteZoneAssignment(id);
}

function zoneDetailSignature(z) {
  return [z.stirrupBar, Math.round(z.stirrupLegs || 0), Math.round(z.stirrupSpacing || z.primarySpacing || 0), z.dowelBar, Math.round(z.dowelLegs || 0), Math.round(z.dowelSpacing || 0)].join("|");
}

function resetZoneModelFromFlattenedZones(zones) {
  const L = beamLengthFromCurrentInputs();
  const list = Array.isArray(zones) && zones.length ? zones : [zoneFromBaseInputs(0, L)];
  const base = list[0];
  if (base) {
    if ($("stirrupBar")) $("stirrupBar").value = base.stirrupBar;
    if ($("stirrupLegs")) $("stirrupLegs").value = base.stirrupLegs;
    if ($("stirrupSpacing")) $("stirrupSpacing").value = base.stirrupSpacing || base.primarySpacing;
    if ($("dowelBar")) $("dowelBar").value = base.dowelBar;
    if ($("dowelLegs")) $("dowelLegs").value = base.dowelLegs;
    if ($("dowelSpacing")) $("dowelSpacing").value = base.dowelSpacing || DEFAULTS.dowelSpacing;
  }
  zoneDefinitions = [];
  zoneAssignments = [];
  ensureZoneModel();
  const bySignature = new Map([[zoneDetailSignature(zoneDefinitions[0]), zoneDefinitions[0].id]]);
  list.slice(1).forEach((z, idx) => {
    const sig = zoneDetailSignature(z);
    let defId = bySignature.get(sig);
    if (!defId) {
      defId = zoneDefinitionIdCounter++;
      zoneDefinitions.push({
        id: defId,
        isBase: false,
        label: z.label || `Zone ${zoneDefinitions.length + 1}`,
        stirrupBar: z.stirrupBar,
        stirrupLegs: z.stirrupLegs,
        stirrupSpacing: z.stirrupSpacing || z.primarySpacing,
        dowelBar: z.dowelBar,
        dowelLegs: z.dowelLegs || 0,
        dowelSpacing: z.dowelSpacing || DEFAULTS.dowelSpacing
      });
      bySignature.set(sig, defId);
    }
    zoneAssignments.push({
      id: zoneAssignmentIdCounter++,
      defId,
      x1: clamp(+z.x1 || 0, 0, L),
      x2: clamp(+z.x2 || 0, 0, L),
      isBase: false
    });
  });
  ensureZoneModel();
}

function applyDefaults() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if ($(key)) $(key).value = value;
  }
  syncInterfaceDefaults();
  designZones = [];
  zoneDefinitions = [];
  zoneAssignments = [];
  zoneDefinitionIdCounter = 1;
  zoneAssignmentIdCounter = 1;
  ensureDesignZones();
  updateConditionalInputs();
  renderZoneEditor();
}

function syncInterfaceDefaults() {
  const condition = val("interfaceCondition");
  const presets = {
    clean: { c: "0.25", mu: "0.60" },
    roughened: { c: "0.50", mu: "1.00" },
    monolithic: { c: "1.00", mu: "1.40" },
    steel: { c: "0.00", mu: "0.60" }
  };
  if (presets[condition]) {
    $("cohesion").value = presets[condition].c;
    $("mu").value = presets[condition].mu;
    $("cohesion").disabled = true;
    $("mu").disabled = true;
  } else {
    $("cohesion").disabled = false;
    $("mu").disabled = false;
  }
}

function setParentLabelHidden(id, hidden) {
  const el = $(id);
  if (!el) return;
  const label = el.closest("label");
  if (label) label.hidden = hidden;
}

function updateConditionalInputs() {
  const system = val("beamSystem");
  const pointOn = val("includePoint") === "yes";
  const mode = val("zoneDesignMode");
  setParentLabelHidden("L2", system !== "twoSpan" && system !== "spanCantilever");
  setParentLabelHidden("Pf", !pointOn);
  setParentLabelHidden("Px", !pointOn);
  const sectionModel = val("sectionModel");
  const shearMethod = val("shearMethod");
  const zMode = val("zMode");
  const szeMode = val("szeMode");
  setParentLabelHidden("flangeWidth", sectionModel !== "flanged");
  setParentLabelHidden("flangeDepth", sectionModel !== "flanged");
  setParentLabelHidden("Es", shearMethod !== "general");
  setParentLabelHidden("szeMode", shearMethod !== "general");
  setParentLabelHidden("sze", shearMethod !== "general" || szeMode !== "manual");
  setParentLabelHidden("zFactor", zMode !== "factor");
  setParentLabelHidden("zoneMaxCount", mode !== "zoned");
  setParentLabelHidden("zoneMinLength", mode !== "zoned");
  setParentLabelHidden("dowelBar", val("zoneDesignStrategy") !== "addDowels" && num("dowelLegs") <= 0);
  setParentLabelHidden("dowelLegs", val("zoneDesignStrategy") !== "addDowels" && num("dowelLegs") <= 0);
  setParentLabelHidden("dowelSpacing", val("zoneDesignStrategy") !== "addDowels" && num("dowelLegs") <= 0);
}

function beamLength(inputs) {
  if (inputs.beamSystem === "twoSpan" || inputs.beamSystem === "spanCantilever") return inputs.L1 + inputs.L2;
  return inputs.L1;
}

function supportLocations(inputs) {
  if (inputs.beamSystem === "simple") return [0, inputs.L1];
  if (inputs.beamSystem === "twoSpan") return [0, inputs.L1, inputs.L1 + inputs.L2];
  if (inputs.beamSystem === "spanCantilever") return [0, inputs.L1];
  return [0, inputs.L1];
}

function buildNodes(inputs) {
  const Ltotal = beamLength(inputs);
  const baseCount = Math.max(51, Math.min(501, inputs.stationCount));
  const xs = new Set();
  for (let i = 0; i < baseCount; i++) {
    xs.add(round6(Ltotal * i / (baseCount - 1)));
  }
  supportLocations(inputs).forEach(x => xs.add(round6(x)));
  if (inputs.includePoint && inputs.Pf !== 0 && inputs.Px >= 0 && inputs.Px <= Ltotal) xs.add(round6(inputs.Px));
  return [...xs].sort((a, b) => a - b);
}

function round6(x) {
  return Math.round(x * 1e6) / 1e6;
}

function zeroMatrix(n) {
  return Array.from({ length: n }, () => Array(n).fill(0));
}

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.concat([b[i]]));

  for (let k = 0; k < n; k++) {
    let pivot = k;
    let max = Math.abs(M[k][k]);
    for (let i = k + 1; i < n; i++) {
      const test = Math.abs(M[i][k]);
      if (test > max) { max = test; pivot = i; }
    }
    if (max < 1e-12) throw new Error("Singular stiffness matrix. Check support conditions.");
    if (pivot !== k) [M[k], M[pivot]] = [M[pivot], M[k]];

    const diag = M[k][k];
    for (let j = k; j <= n; j++) M[k][j] /= diag;

    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const factor = M[i][k];
      for (let j = k; j <= n; j++) M[i][j] -= factor * M[k][j];
    }
  }

  return M.map(row => row[n]);
}

function runBeamFE(inputs, section) {
  const xs = buildNodes(inputs);
  const n = xs.length;
  const dof = 2 * n;
  const K = zeroMatrix(dof);
  const F = Array(dof).fill(0);

  const E = 30000; // MPa, only relative stiffness is needed for uniform section.
  const EI = E * section.Ig; // N*mm²

  for (let e = 0; e < n - 1; e++) {
    const Lmm = (xs[e + 1] - xs[e]) * 1000;
    if (Lmm <= 0) continue;
    const L = Lmm;
    const kfac = EI / Math.pow(L, 3);
    const ke = [
      [12, 6 * L, -12, 6 * L],
      [6 * L, 4 * L * L, -6 * L, 2 * L * L],
      [-12, -6 * L, 12, -6 * L],
      [6 * L, 2 * L * L, -6 * L, 4 * L * L]
    ].map(row => row.map(v => kfac * v));

    // Consistent nodal load vector. Vertical DOF positive upward. Wf is downward.
    const q = -inputs.Wf; // N/mm because 1 kN/m = 1 N/mm.
    const fe = [q * L / 2, q * L * L / 12, q * L / 2, -q * L * L / 12];

    const ids = [2 * e, 2 * e + 1, 2 * (e + 1), 2 * (e + 1) + 1];
    for (let i = 0; i < 4; i++) {
      F[ids[i]] += fe[i];
      for (let j = 0; j < 4; j++) K[ids[i]][ids[j]] += ke[i][j];
    }
  }

  if (inputs.includePoint && inputs.Pf !== 0) {
    const xLoad = Math.max(0, Math.min(beamLength(inputs), inputs.Px));
    let idx = xs.findIndex(x => Math.abs(x - xLoad) < 1e-6);
    if (idx < 0) {
      idx = xs.reduce((best, x, i) => Math.abs(x - xLoad) < Math.abs(xs[best] - xLoad) ? i : best, 0);
    }
    F[2 * idx] += -inputs.Pf * 1000; // kN to N, downward.
  }

  const fixed = new Set();
  const supports = supportLocations(inputs);
  supports.forEach(sx => {
    const idx = xs.findIndex(x => Math.abs(x - sx) < 1e-6);
    if (idx >= 0) fixed.add(2 * idx); // vertical fixed.
  });
  // A previous pure fixed-end cantilever option has been replaced by a span + cantilever overhang.
  // The spanCantilever system is supported at x=0 and x=L1 with a free overhang to x=L1+L2.

  const free = [];
  for (let i = 0; i < dof; i++) if (!fixed.has(i)) free.push(i);

  const Kff = free.map(i => free.map(j => K[i][j]));
  const Ff = free.map(i => F[i]);
  const uf = solveLinear(Kff, Ff);
  const u = Array(dof).fill(0);
  free.forEach((id, i) => u[id] = uf[i]);

  const R = Array(dof).fill(0);
  for (let i = 0; i < dof; i++) {
    let sum = 0;
    for (let j = 0; j < dof; j++) sum += K[i][j] * u[j];
    R[i] = sum - F[i];
  }

  const reactions = supports.map(sx => {
    const idx = xs.findIndex(x => Math.abs(x - sx) < 1e-6);
    return {
      x: sx,
      vertical: idx >= 0 ? R[2 * idx] / 1000 : 0,
      moment: idx >= 0 ? R[2 * idx + 1] / 1e6 : 0
    };
  });

  return { xs, reactions, supportMoments: reactions.filter(r => Math.abs(r.moment) > 1e-6) };
}

function collectInputs() {
  const inputs = {
    beamSystem: val("beamSystem"),
    stationCount: Math.round(num("stationCount")),
    L1: num("L1"),
    L2: num("L2"),
    Wf: num("Wf"),
    Pf: num("Pf"),
    Px: num("Px"),
    includePoint: val("includePoint") === "yes",
    h: num("h"),
    b: num("b"),
    sectionModel: val("sectionModel"),
    flangeWidth: num("flangeWidth"),
    flangeDepth: num("flangeDepth"),
    slabDepth: num("slabDepth"),
    fc: num("fc"),
    fy: num("fy"),
    lambda: num("lambda"),
    phiC: num("phiC"),
    phiS: num("phiS"),
    cover: num("cover"),
    mainBar: val("mainBar"),
    mainCount: num("mainCount"),
    bottomRows: num("bottomRows"),
    topBar: val("topBar"),
    topCount: num("topCount"),
    topRows: num("topRows"),
    barRowSpacing: num("barRowSpacing"),
    shearMethod: val("shearMethod"),
    Es: num("Es"),
    ag: num("ag"),
    szeMode: val("szeMode"),
    sze: num("sze"),
    interfaceCondition: val("interfaceCondition"),
    interfaceDemandModel: val("interfaceDemandModel"),
    cohesion: num("cohesion"),
    mu: num("mu"),
    zMode: val("zMode"),
    zFactor: num("zFactor"),
    allocation: val("allocation"),
    stirrupBar: val("stirrupBar"),
    stirrupLegs: num("stirrupLegs"),
    stirrupSpacing: num("stirrupSpacing"),
    dowelBar: val("dowelBar"),
    dowelLegs: num("dowelLegs"),
    dowelSpacing: num("dowelSpacing"),
    zoneDesignMode: val("zoneDesignMode"),
    zoneDesignStrategy: val("zoneDesignStrategy"),
    zoneMinSpacing: num("zoneMinSpacing"),
    zoneMaxSpacing: num("zoneMaxSpacing"),
    zoneMaxCount: Math.round(num("zoneMaxCount")),
    zoneMinLength: num("zoneMinLength")
  };

  inputs.L1 = Math.max(0.1, inputs.L1);
  inputs.L2 = Math.max(0.1, inputs.L2);
  inputs.Px = Math.max(0, Math.min(beamLength(inputs), inputs.Px));
  inputs.stationCount = Math.max(51, Math.min(501, inputs.stationCount));
  inputs.b = Math.max(1, inputs.b);
  inputs.h = Math.max(1, inputs.h);
  inputs.flangeWidth = Math.max(inputs.b, inputs.flangeWidth || inputs.b);
  inputs.flangeDepth = Math.max(0, Math.min(inputs.h, inputs.flangeDepth || inputs.slabDepth || 0));
  inputs.slabDepth = Math.max(0, Math.min(inputs.h, inputs.slabDepth || 0));
  inputs.mainCount = Math.max(0, Math.round(inputs.mainCount || 0));
  inputs.bottomRows = Math.max(1, Math.min(2, Math.round(inputs.bottomRows || 1)));
  inputs.topCount = Math.max(0, Math.round(inputs.topCount || 0));
  inputs.topRows = Math.max(1, Math.min(2, Math.round(inputs.topRows || 1)));
  inputs.barRowSpacing = Math.max(25, inputs.barRowSpacing || 75);
  inputs.Es = Math.max(1, inputs.Es || 200000);
  inputs.ag = Math.max(0, inputs.ag || 20);
  inputs.szeMode = inputs.szeMode === "manual" ? "manual" : "auto";
  inputs.sze = Math.max(0, inputs.sze || 300);
  inputs.zoneMinSpacing = Math.max(50, inputs.zoneMinSpacing || 100);
  inputs.zoneMaxSpacing = Math.max(inputs.zoneMinSpacing, inputs.zoneMaxSpacing || 450);
  inputs.zoneMaxCount = Math.max(1, Math.min(9, inputs.zoneMaxCount || 5));
  inputs.zoneMinLength = Math.max(0, inputs.zoneMinLength || 0);
  inputs.designZones = collectDesignZones(inputs);
  return inputs;
}

function rectangleComponent(width, height, yTop = 0, label = "component") {
  return { width: Math.max(0, width), height: Math.max(0, height), yTop: Math.max(0, yTop), label };
}

function componentArea(comp) {
  return Math.max(0, comp.width) * Math.max(0, comp.height);
}

function componentCentroidFromTop(comp) {
  return comp.yTop + comp.height / 2;
}

function componentInertiaAboutOwnCentroid(comp) {
  return comp.width * Math.pow(comp.height, 3) / 12;
}

function buildSectionComponents(inputs) {
  const h = Math.max(1, inputs.h);
  const bw = Math.max(1, inputs.b);
  if (inputs.sectionModel === "flanged") {
    const bf = Math.max(bw, inputs.flangeWidth || bw);
    const tf = clamp(inputs.flangeDepth || inputs.slabDepth || 0, 0, h);
    const overhang = Math.max(0, bf - bw);
    const components = [rectangleComponent(bw, h, 0, "web")];
    if (overhang > 0 && tf > 0) components.push(rectangleComponent(overhang, tf, 0, "top flange overhang"));
    return components;
  }
  return [rectangleComponent(bw, h, 0, "rectangular section")];
}

function grossPropertiesFromComponents(components) {
  const area = components.reduce((sum, c) => sum + componentArea(c), 0);
  const ybar = area > 0 ? components.reduce((sum, c) => sum + componentArea(c) * componentCentroidFromTop(c), 0) / area : 0;
  const Ig = components.reduce((sum, c) => {
    const A = componentArea(c);
    const dy = componentCentroidFromTop(c) - ybar;
    return sum + componentInertiaAboutOwnCentroid(c) + A * dy * dy;
  }, 0);
  return { area, ybar, Ig };
}

function areaAboveInterfaceFromComponents(components, yInterface) {
  let area = 0;
  let firstMoment = 0;
  for (const c of components) {
    const top = c.yTop;
    const bottom = c.yTop + c.height;
    const clipTop = top;
    const clipBottom = Math.min(bottom, yInterface);
    const hh = Math.max(0, clipBottom - clipTop);
    if (hh <= 0 || c.width <= 0) continue;
    const A = c.width * hh;
    const y = clipTop + hh / 2;
    area += A;
    firstMoment += A * y;
  }
  return { area, centroid: area > 0 ? firstMoment / area : 0 };
}

function compressionAreaAndCentroid(components, depth, totalDepth, face = "top") {
  const a = clamp(depth || 0, 0, totalDepth);
  let area = 0;
  let firstMomentFromFace = 0;
  for (const c of components) {
    const top = c.yTop;
    const bottom = c.yTop + c.height;
    let clipTop, clipBottom;
    if (face === "top") {
      clipTop = top;
      clipBottom = Math.min(bottom, a);
    } else {
      clipTop = Math.max(top, totalDepth - a);
      clipBottom = bottom;
    }
    const hh = Math.max(0, clipBottom - clipTop);
    if (hh <= 0 || c.width <= 0) continue;
    const A = c.width * hh;
    const yGlobal = clipTop + hh / 2;
    const yFace = face === "top" ? yGlobal : totalDepth - yGlobal;
    area += A;
    firstMomentFromFace += A * yFace;
  }
  return { area, centroidFromFace: area > 0 ? firstMomentFromFace / area : 0 };
}

function computeFlexuralCapacityForFace(inputs, section, As, d, face = "top") {
  const fc = Math.max(0, inputs.fc);
  const alpha1 = Math.max(0.67, 0.85 - 0.0015 * fc);
  const beta1 = Math.max(0.67, 0.97 - 0.0025 * fc);
  const T = Math.max(0, inputs.phiS * As * inputs.fy);
  if (T <= 0 || fc <= 0 || d <= 0) {
    return { alpha1, beta1, As, a: 0, c: 0, compressionCentroid: 0, z: Math.max(0, 0.9 * d), Mr: 0, available: false };
  }
  let lo = 0;
  let hi = section.h;
  for (let iter = 0; iter < 70; iter++) {
    const mid = (lo + hi) / 2;
    const comp = compressionAreaAndCentroid(section.components, mid, section.h, face);
    const C = alpha1 * inputs.phiC * fc * comp.area;
    if (C < T) lo = mid; else hi = mid;
  }
  const a = hi;
  const comp = compressionAreaAndCentroid(section.components, a, section.h, face);
  const z = Math.max(1, d - comp.centroidFromFace);
  const c = a / Math.max(0.1, beta1);
  const Mr = T * z / 1e6;
  return { alpha1, beta1, As, a, c, compressionCentroid: comp.centroidFromFace, z, Mr, available: true };
}

function longitudinalCentroidFromFace(inputs, bar, count, rows) {
  const n = Math.max(0, Math.round(count || 0));
  if (n <= 0) return inputs.cover + bar.diameter / 2;
  const rowCount = Math.max(1, Math.min(2, Math.round(rows || 1)));
  const usedRows = n <= 1 ? 1 : rowCount;
  const base = Math.max(0, inputs.cover) + rebar(inputs.stirrupBar).diameter + bar.diameter / 2;
  return base + (usedRows - 1) * Math.max(25, inputs.barRowSpacing || 75) / 2;
}

function computeSection(inputs) {
  const main = rebar(inputs.mainBar);
  const topBar = rebar(inputs.topBar || inputs.mainBar);
  const stirrup = rebar(inputs.stirrupBar);
  const h = Math.max(1, inputs.h);
  const b = Math.max(1, inputs.b);
  const slabDepth = Math.min(Math.max(0, inputs.slabDepth), h);
  const components = buildSectionComponents(inputs);
  const gross = grossPropertiesFromComponents(components);
  const areaAbove = areaAboveInterfaceFromComponents(components, slabDepth);
  const Q = Math.max(0, areaAbove.area * (gross.ybar - areaAbove.centroid));
  const bottomCentroidFromBottom = longitudinalCentroidFromFace(inputs, main, inputs.mainCount, inputs.bottomRows);
  const topCentroidFromTop = longitudinalCentroidFromFace(inputs, topBar, inputs.topCount, inputs.topRows);
  const dBottom = h - bottomCentroidFromBottom;
  const dTop = h - topCentroidFromTop;
  const d = Math.max(1, dBottom);
  const dv = Math.max(0.9 * d, 0.72 * h);
  const AsBottom = Math.max(0, inputs.mainCount * main.area);
  const AsTop = Math.max(0, inputs.topCount * topBar.area);

  const flexPos = computeFlexuralCapacityForFace(inputs, { components, h }, AsBottom, dBottom, "top");
  const flexNeg = computeFlexuralCapacityForFace(inputs, { components, h }, AsTop, dTop, "bottom");
  const zOptions = [
    { source: "positive-moment compression block", flex: flexPos, z: flexPos.z, available: flexPos.available },
    { source: "negative-moment compression block", flex: flexNeg, z: flexNeg.z, available: flexNeg.available }
  ].filter(o => o.available && Number.isFinite(o.z) && o.z > 0);
  const zSelected = zOptions.length ? zOptions.reduce((best, cur) => cur.z < best.z ? cur : best, zOptions[0]) : { source: "fallback lever arm", flex: flexPos, z: Math.max(0.5 * d, 0.9 * d), available: false };
  const autoZ = zSelected.z;
  const manualZ = Math.max(0.5 * d, (inputs.zFactor || 0.9) * d);
  const z = inputs.zMode === "factor" ? manualZ : autoZ;
  const zBlock = inputs.zMode === "factor" ? { source: "manual z/d override", flex: flexPos, z } : zSelected;

  return {
    components,
    area: gross.area,
    Ig: gross.Ig,
    neutralAxisFromTop: gross.ybar,
    Q,
    areaAboveInterface: areaAbove.area,
    areaAboveCentroid: areaAbove.centroid,
    d,
    dBottom,
    dTop,
    bottomRows: inputs.bottomRows,
    topRows: inputs.topRows,
    barRowSpacing: inputs.barRowSpacing,
    bottomCentroidFromBottom,
    topCentroidFromTop,
    dv,
    z,
    zAuto: autoZ,
    zManual: manualZ,
    zSource: zBlock.source,
    zBlock: zBlock.flex,
    zBlockAvailable: zBlock.available,
    As: AsBottom,
    AsBottom,
    AsTop,
    main,
    topBar,
    stirrup,
    h,
    b,
    flangeWidth: inputs.sectionModel === "flanged" ? Math.max(b, inputs.flangeWidth || b) : b,
    flangeDepth: inputs.sectionModel === "flanged" ? Math.min(h, inputs.flangeDepth || 0) : 0,
    slabDepth,
    flexPos,
    flexNeg
  };
}

function internalActionsAt(inputs, fe, x) {
  const Ltotal = beamLength(inputs);
  const calcX = x >= Ltotal - 1e-9 ? Math.max(0, Ltotal - 1e-6) : clamp(x, 0, Ltotal);
  let V = 0;
  let M = 0;

  fe.reactions.forEach(r => {
    if (calcX + 1e-9 >= r.x) {
      V += r.vertical;
      M += r.vertical * (calcX - r.x);
    }
  });

  fe.supportMoments.forEach(r => {
    if (calcX + 1e-9 >= r.x) M -= r.moment;
  });

  V -= inputs.Wf * calcX;
  M -= inputs.Wf * calcX * calcX / 2;

  if (inputs.includePoint && inputs.Pf !== 0 && calcX + 1e-9 >= inputs.Px) {
    V -= inputs.Pf;
    M -= inputs.Pf * (calcX - inputs.Px);
  }

  return { V, M };
}

function zForMoment(section, M) {
  if (M < -1e-9 && section.flexNeg && section.flexNeg.available) return section.flexNeg.z;
  if (M > 1e-9 && section.flexPos) return section.flexPos.z;
  return section.z;
}

function criticalStationXs(inputs, section, fe) {
  const L = beamLength(inputs);
  const xs = new Set(fe.xs.map(round6));
  const add = x => { if (Number.isFinite(x) && x >= -1e-9 && x <= L + 1e-9) xs.add(round6(clamp(x, 0, L))); };

  supportLocations(inputs).forEach(x => {
    add(x);
    add(x + section.d / 1000);
    add(x - section.d / 1000);
    add(x + section.dv / 1000);
    add(x - section.dv / 1000);
  });
  if (inputs.includePoint && inputs.Pf !== 0) {
    add(inputs.Px);
    add(inputs.Px - 1e-6);
    add(inputs.Px + 1e-6);
    add(inputs.Px - section.d / 1000);
    add(inputs.Px + section.d / 1000);
  }
  (inputs.designZones || []).forEach(z => { add(z.x1); add(z.x2); });

  const events = [...new Set([0, L, ...supportLocations(inputs), ...(inputs.includePoint && inputs.Pf !== 0 ? [inputs.Px] : [])].map(round6))].sort((a,b)=>a-b);
  for (let idx = 0; idx < events.length - 1; idx++) {
    const a = events[idx], b = events[idx + 1];
    if (b <= a + 1e-9) continue;
    const left = a + 1e-7;
    const right = b - 1e-7;
    const Va = internalActionsAt(inputs, fe, left).V;
    const Vb = internalActionsAt(inputs, fe, right).V;
    if (Math.abs(Va) < 1e-6) add(a);
    if (Math.abs(Vb) < 1e-6) add(b);
    if (Va === 0 || Vb === 0 || Va * Vb < 0) {
      let lo = left, hi = right, flo = Va;
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        const fm = internalActionsAt(inputs, fe, mid).V;
        if (Math.abs(fm) < 1e-7) { lo = hi = mid; break; }
        if (flo * fm <= 0) { hi = mid; } else { lo = mid; flo = fm; }
      }
      add((lo + hi) / 2);
    }
  }
  return [...xs].sort((a, b) => a - b);
}

function computeStationResults(inputs, section, fe) {
  return criticalStationXs(inputs, section, fe).map(x => {
    const { V, M } = internalActionsAt(inputs, fe, x);
    const qElastic = section.Ig > 0 ? Math.abs(V) * 1000 * section.Q / section.Ig : 0; // N/mm = kN/m
    const localZ = Math.max(1, inputs.zMode === "factor" ? section.z : zForMoment(section, M));
    const qCracked = Math.abs(V) * 1000 / localZ; // N/mm = kN/m
    let qDesign = qElastic;
    if (inputs.interfaceDemandModel === "cracked") qDesign = qCracked;
    if (inputs.interfaceDemandModel === "max") qDesign = Math.max(qElastic, qCracked);
    const vInterface = qDesign / section.b;
    return { x, V, M, qElastic, qCracked, qDesign, vInterface, z: localZ };
  });
}

function maxAbs(stations, key) {
  return stations.reduce((m, s) => Math.max(m, Math.abs(s[key])), 0);
}

function maxValue(stations, key) {
  return stations.reduce((m, s) => Math.max(m, s[key]), -Infinity);
}

function minValue(stations, key) {
  return stations.reduce((m, s) => Math.min(m, s[key]), Infinity);
}

function tensionSteelForMoment(section, M) {
  if (M < -1e-9) return section.AsTop;
  return section.AsBottom;
}

function effectiveAggregateSize(inputs) {
  const ag = Math.max(0, inputs.ag || 0);
  const fc = Math.max(0, inputs.fc || 0);
  if (fc <= 60) return ag;
  if (fc >= 70) return 0;
  return ag * (70 - fc) / 10;
}

function equivalentCrackSpacing(inputs, section) {
  // CSA A23.3:24 Eq. 11.10 uses s_z. Because this app does not yet model
  // individual longitudinal reinforcement layers, use s_z = d_v as the documented
  // default approximation.
  const sz = Math.max(1, section.dv);
  const agEff = effectiveAggregateSize(inputs);
  const szeEq = 35 * sz / (15 + agEff);
  return { sz, agEff, sze: Math.max(0.85 * sz, szeEq), szeEq };
}

function computeShearParameters(inputs, section, station, primarySet = 0, spacing = 1) {
  const sqrtFcRaw = Math.sqrt(Math.max(0, inputs.fc));
  const sqrtFc = Math.min(sqrtFcRaw, 8.0); // Clause 11.3.4 cap for Vc.
  const AvMin = 0.06 * sqrtFcRaw * section.b * Math.max(1, spacing) / Math.max(1, inputs.fy); // Eq. 11.1.
  const hasMinTransverse = primarySet >= AvMin - 1e-9;
  const eqSze = equivalentCrackSpacing(inputs, section);
  const fy = Math.max(1, inputs.fy);
  let beta = 0.18;
  let thetaDeg = 35;
  let epsilonX = null;
  let sze = null;
  let betaBasis = "";
  let thetaBasis = "";
  const warnings = [];

  if (inputs.shearMethod === "general") {
    const As = Math.max(1, tensionSteelForMoment(section, station.M));
    const VfN = Math.abs(station.V) * 1000; // N
    const mOverDv = Math.abs(station.M) * 1e6 / Math.max(1, section.dv); // N
    const mTerm = Math.max(mOverDv, VfN); // Clause 11.3.6.4(a), with Vp=0.
    const numerator = mTerm + VfN; // no prestress, axial load, or Ap terms in this app.
    epsilonX = numerator / Math.max(1, 2 * inputs.Es * As);
    epsilonX = clamp(epsilonX, 0, 0.003); // Clause 11.3.6.4(f).
    if (inputs.szeMode === "manual") {
      sze = Math.max(0, inputs.sze || 300);
      betaBasis = "Clause 11.3.6.4 Eq. 11.11 with manual s_ze";
    } else {
      sze = hasMinTransverse ? 300 : eqSze.sze;
      betaBasis = hasMinTransverse
        ? "Clause 11.3.6.4 Eq. 11.11; s_ze = 300 mm because Eq. 11.1 minimum transverse reinforcement is provided"
        : "Clause 11.3.6.4 Eq. 11.11 using Eq. 11.10 for s_ze";
    }
    beta = (0.40 / (1 + 1500 * epsilonX)) * (1300 / (1000 + sze));
    thetaDeg = 29 + 7000 * epsilonX;
    thetaBasis = "Clause 11.3.6.4 Eq. 11.12";
  } else {
    thetaDeg = 35;
    thetaBasis = "Clause 11.3.6.3 simplified method";
    if (inputs.fc > 60) warnings.push("Simplified method clause basis requires f'c <= 60 MPa; use the general method or a separate review.");
    if (hasMinTransverse) {
      beta = fy <= 400 ? 0.18 : 0.4 / (1 + fy / 320);
      betaBasis = fy <= 400
        ? "Clause 11.3.6.3(a): beta = 0.18 because Eq. 11.1 minimum transverse reinforcement is provided and fy <= 400 MPa"
        : "Clause 11.3.6.3(a): beta = 0.4/(1 + fy/320) because Eq. 11.1 minimum transverse reinforcement is provided and fy > 400 MPa";
    } else {
      const denom = eqSze.agEff >= 20 ? section.dv : eqSze.sze;
      sze = denom;
      beta = fy <= 400 ? 230 / (1000 + denom) : 520 / ((1 + fy / 320) * (1000 + denom));
      betaBasis = fy <= 400
        ? `Clause 11.3.6.3(b/c): beta = 230/(1000 + ${eqSze.agEff >= 20 ? "d_v" : "s_ze"}) because Eq. 11.1 minimum transverse reinforcement is not provided`
        : `Clause 11.3.6.3(b/c): beta = 520/[(1 + fy/320)(1000 + ${eqSze.agEff >= 20 ? "d_v" : "s_ze"})] because Eq. 11.1 minimum transverse reinforcement is not provided and fy > 400 MPa`;
    }
  }

  beta = Math.max(0.05, beta); // Clause 11.3.4.
  const cotTheta = 1 / Math.tan(thetaDeg * Math.PI / 180);
  return {
    beta, thetaDeg, cotTheta, epsilonX, sze, sqrtFc, sqrtFcRaw, AvMin, hasMinTransverse,
    betaBasis, thetaBasis, warnings, sz: eqSze.sz, agEffective: eqSze.agEff, szeEq: eqSze.sze
  };
}

function shearStateAtStation(r, station, primarySpacing = null, detail = null) {
  const i = r.inputs;
  const sec = r.section;
  const stirrupBar = detail?.stirrupBar || i.stirrupBar;
  const stirrupLegs = detail?.stirrupLegs ?? i.stirrupLegs;
  const spacing = Math.max(1, primarySpacing ?? i.stirrupSpacing);
  const primarySet = Math.max(0, (+stirrupLegs || 0) * rebar(stirrupBar).area);
  const params = computeShearParameters(i, sec, station, primarySet, spacing);
  const Vc = i.phiC * i.lambda * params.beta * params.sqrtFc * sec.b * sec.dv / 1000; // Clause 11.3.4 Eq. 11.6.
  const Vs = i.phiS * (primarySet / spacing) * i.fy * sec.dv * params.cotTheta / 1000; // Clause 11.3.5.1 Eq. 11.7.
  const VrRaw = Vc + Vs; // no Vp in this app; Clause 11.3.3 Eq. 11.4.
  const VrMax = 0.25 * i.phiC * i.fc * sec.b * sec.dv / 1000; // Clause 11.3.3 Eq. 11.5.
  const Vr = Math.min(VrRaw, VrMax);
  const beamAvReqPerM = Math.max(0, (Math.abs(station.V) - Vc) * 1000 / (i.phiS * i.fy * sec.dv * params.cotTheta)) * 1000;
  const minSteelRequired = Math.abs(station.V) > Vc + 1e-9 || sec.h > 750; // Clause 11.2.8.1(a/b), Vp=0.
  const highShearThreshold = 0.125 * i.lambda * i.phiC * i.fc * sec.b * sec.dv / 1000; // Clause 11.3.8.3, Vp=0, torsion not included.
  const sMax = Math.abs(station.V) > highShearThreshold ? Math.min(0.35 * sec.dv, 300) : Math.min(0.7 * sec.dv, 600);
  const beamRatio = Math.abs(station.V) / Math.max(1e-9, Vr);
  return {
    ...params, Vc, Vs, VrRaw, Vr, VrMax, beamAvReqPerM, highShearThreshold, sMax,
    AvMin: params.AvMin, minSteelRequired, primarySet, primarySpacing: spacing, beamRatio,
    vcClause: "CSA A23.3:24 Clause 11.3.4 Eq. 11.6",
    vsClause: "CSA A23.3:24 Clause 11.3.5.1 Eq. 11.7",
    vrClause: "CSA A23.3:24 Clause 11.3.1 and 11.3.3 Eq. 11.3 to 11.5",
    minSteelClause: "CSA A23.3:24 Clause 11.2.8 Eq. 11.1",
    spacingClause: Math.abs(station.V) > highShearThreshold ? "CSA A23.3:24 Clause 11.3.8.3" : "CSA A23.3:24 Clause 11.3.8.1"
  };
}

function interfaceRequiredForStress(r, vStress) {
  const i = r.inputs;
  const rhoReq = Math.max(0, (Math.abs(vStress) / (i.lambda * i.phiC) - i.cohesion) / Math.max(1e-9, i.mu * i.fy));
  return { rhoReq, interfaceAvReqPerM: rhoReq * r.section.b * 1000 };
}

function interfaceResistanceFromSteel(r, availableAvPerM) {
  const i = r.inputs;
  const concreteLimit = 0.25 * i.phiC * i.fc;
  const rho = Math.max(0, availableAvPerM) / Math.max(1, r.section.b * 1000);
  const raw = i.lambda * i.phiC * (i.cohesion + i.mu * rho * i.fy);
  return { rho, raw, concreteLimit, resistance: Math.min(concreteLimit, raw) };
}

function computeFlexuralEstimate(inputs, section, maxMpos, maxMneg) {
  const posDemand = Math.max(0, maxMpos);
  const negDemand = Math.max(0, -maxMneg);
  const pos = section.flexPos;
  const neg = section.flexNeg;
  const posRatio = posDemand / Math.max(1e-9, pos.Mr);
  const negRatio = negDemand <= 1e-9 ? 0 : negDemand / Math.max(1e-9, neg.Mr);
  const governingRatio = Math.max(posRatio, negRatio);
  const negChecked = negDemand <= 1e-9 || neg.available;
  return {
    alpha1: pos.alpha1,
    beta1: pos.beta1,
    a: pos.a,
    c: pos.c,
    Mr: pos.Mr,
    pos,
    neg,
    posDemand,
    negDemand,
    posRatio,
    negRatio,
    governingRatio,
    negChecked,
    ok: posRatio <= 1.0 + 1e-9 && (negDemand <= 1e-9 || negRatio <= 1.0 + 1e-9)
  };
}

function baseSummaryFromStations(result) {
  const r = result;
  const i = r.inputs;
  const stirrup = rebar(i.stirrupBar);
  const dowel = rebar(i.dowelBar);
  const stirrupAvSet = i.stirrupLegs * stirrup.area;
  const stirrupAvPerM = i.stirrupSpacing > 0 ? stirrupAvSet / i.stirrupSpacing * 1000 : 0;
  const dowelAvSet = i.dowelLegs * dowel.area;
  const dowelAvPerM = i.dowelSpacing > 0 ? dowelAvSet / i.dowelSpacing * 1000 : 0;
  const concreteLimit = 0.25 * i.phiC * i.fc;
  let governing = null;
  for (const st of r.stations) {
    const sh = shearStateAtStation(r, st, i.stirrupSpacing, { stirrupBar: i.stirrupBar, stirrupLegs: i.stirrupLegs });
    const req = interfaceRequiredForStress(r, st.vInterface);
    const unused = i.allocation === "balance" ? Math.max(0, stirrupAvPerM - sh.beamAvReqPerM) : stirrupAvPerM;
    const total = unused + dowelAvPerM;
    const ir = interfaceResistanceFromSteel(r, total);
    const interfaceRatio = Math.abs(st.vInterface) / Math.max(1e-9, ir.resistance);
    const trial = { station: st, sh, req, unused, total, ir, interfaceRatio, governingRatio: Math.max(sh.beamRatio, interfaceRatio) };
    if (!governing || trial.governingRatio > governing.governingRatio) governing = trial;
  }
  const g = governing || { sh: shearStateAtStation(r, r.stations[0]), req: {rhoReq:0, interfaceAvReqPerM:0}, unused:0, total:0, ir: interfaceResistanceFromSteel(r,0), interfaceRatio:0, governingRatio:0 };
  return {
    beta: g.sh.beta,
    thetaDeg: g.sh.thetaDeg,
    cotTheta: g.sh.cotTheta,
    epsilonX: g.sh.epsilonX,
    sze: g.sh.sze,
    sqrtFcEff: g.sh.sqrtFc,
    sqrtFcRaw: g.sh.sqrtFcRaw,
    hasMinTransverse: g.sh.hasMinTransverse,
    minSteelRequired: g.sh.minSteelRequired,
    betaBasis: g.sh.betaBasis,
    thetaBasis: g.sh.thetaBasis,
    shearWarnings: g.sh.warnings || [],
    agEffective: g.sh.agEffective,
    sz: g.sh.sz,
    szeEq: g.sh.szeEq,
    Vc: g.sh.Vc,
    Vs: g.sh.Vs,
    Vr: g.sh.Vr,
    VrRaw: g.sh.VrRaw,
    VrMax: g.sh.VrMax,
    beamAvReqPerM: g.sh.beamAvReqPerM,
    highShearThreshold: g.sh.highShearThreshold,
    sMax: g.sh.sMax,
    AvMin: g.sh.AvMin,
    stirrupAvSet,
    stirrupAvPerM,
    dowelAvSet,
    dowelAvPerM,
    rhoReq: g.req.rhoReq,
    interfaceAvReqPerM: g.req.interfaceAvReqPerM,
    concreteLimit,
    unusedStirrupAv: g.unused,
    additionalInterfaceReq: Math.max(0, g.req.interfaceAvReqPerM - g.unused),
    totalInterfaceAvailable: g.total,
    interfaceStressResistanceRaw: g.ir.raw,
    interfaceStressResistance: g.ir.resistance,
    beamShearRatio: g.sh.beamRatio,
    interfaceShearRatio: g.interfaceRatio,
    governingShearRatio: g.governingRatio,
    combinedShearRatio: g.governingRatio,
    shearUtilizationOk: g.sh.beamRatio <= 1.0 + 1e-9 && g.interfaceRatio <= 1.0 + 1e-9,
    verticalStrengthOk: g.sh.beamRatio <= 1.0 + 1e-9,
    verticalSpacingOk: i.stirrupSpacing <= g.sh.sMax + 1e-9,
    minSteelOk: stirrupAvSet >= g.sh.AvMin - 1e-9,
    interfaceOk: g.total >= g.req.interfaceAvReqPerM - 1e-9 && Math.abs(g.station?.vInterface ?? 0) <= concreteLimit + 1e-9,
    baseControlling: g
  };
}

function complianceStatuses(s) {
  const zoneRows = s.zoneSchedule || [];
  const zoneOk = zoneRows.length ? zoneRows.every(z => z.ok) : s.shearUtilizationOk;
  const strengthOk = s.verticalStrengthOk && s.interfaceOk && (s.maxStress <= s.concreteLimit + 1e-9) && zoneOk;
  const flexOk = s.flexUtilizationOk;
  const detailingOk = s.zoneSpacingOk !== false && s.zoneMinSteelOk !== false && s.zonePracticalSpacingOk !== false;
  const analysisReview = s.deepBeamFlag || !s.flex?.negChecked;
  return {
    analysis: analysisReview ? "review" : "ok",
    strength: strengthOk && flexOk ? "ok" : "ng",
    detailing: detailingOk ? "ok" : "review",
    csa: strengthOk && flexOk && detailingOk && !analysisReview ? "review" : (strengthOk && flexOk ? "review" : "ng")
  };
}

function runCalculations() {
  const inputs = collectInputs();
  const section = computeSection(inputs);
  const fe = runBeamFE(inputs, section);
  const stations = computeStationResults(inputs, section, fe);

  const maxV = maxAbs(stations, "V");
  const maxMpos = maxValue(stations, "M");
  const maxMneg = minValue(stations, "M");
  const maxMabs = maxAbs(stations, "M");
  const maxQ = maxAbs(stations, "qDesign");
  const maxStress = maxAbs(stations, "vInterface");
  const flex = computeFlexuralEstimate(inputs, section, maxMpos, maxMneg);
  const flexRatio = flex.governingRatio;
  const flexUtilizationOk = flex.ok;
  const deepBeamFlag = beamLength(inputs) * 1000 / Math.max(1, section.h) < 4;

  const result = { inputs, section, fe, stations, summary: { maxV, maxMpos, maxMneg, maxMabs, maxQ, maxStress, flex, flexRatio, flexUtilizationOk, deepBeamFlag } };
  Object.assign(result.summary, baseSummaryFromStations(result));
  result.summary.zoneSchedule = computeZoneSchedule(result);
  Object.assign(result.summary, evaluateZoneScheduleUtilization(result));
  result.summary.beamShearRatio = result.summary.zoneBeamShearRatio;
  result.summary.interfaceShearRatio = result.summary.zoneInterfaceShearRatio;
  result.summary.governingShearRatio = result.summary.zoneGoverningShearRatio;
  result.summary.combinedShearRatio = result.summary.zoneGoverningShearRatio;
  result.summary.verticalStrengthOk = result.summary.zoneVerticalStrengthOk;
  result.summary.verticalSpacingOk = result.summary.zoneSpacingOk;
  result.summary.minSteelOk = result.summary.zoneMinSteelOk;
  result.summary.interfaceOk = result.summary.zoneInterfaceOk && result.summary.maxStress <= result.summary.concreteLimit + 1e-9;
  result.summary.shearUtilizationOk = result.summary.zoneVerticalStrengthOk && result.summary.zoneInterfaceOk;
  result.summary.compliance = complianceStatuses(result.summary);

  lastResult = result;
  render(result);
}

function render(result) {
  renderComplianceDashboard(result);
  renderSummary(result);
  renderChecks(result);
  renderZoneSchedule(result);
  renderElevation(result);
  renderStationUtilizationDashboard(result);
  renderCrossSection(result);
  renderCharts(result);
  renderTable(result);
  renderReport(result);

  const csa = result.summary.compliance?.csa || "review";
  const status = $("overallStatus");
  if (status) {
    status.className = "status-chip " + (csa === "ok" ? "ok" : csa === "ng" ? "ng" : "warn");
    status.textContent = csa === "ok" ? "OK" : csa === "ng" ? "NG" : "Review";
  }
}

function card(label, value, note = "") {
  return `<div class="card"><div class="label">${label}</div><div class="value">${value}</div>${note ? `<div class="note">${note}</div>` : ""}</div>`;
}

function interfaceConditionLabel(value) {
  if (value === "roughened") return "clean + intentionally roughened to at least 5 mm amplitude";
  if (value === "clean") return "clean, not intentionally roughened";
  if (value === "monolithic") return "concrete placed monolithically";
  if (value === "steel") return "concrete anchored to as-rolled structural steel";
  return "custom interface coefficients";
}

function demandModelLabel(value) {
  if (value === "elastic") return "elastic VQ/I";
  if (value === "cracked") return "cracked V/z";
  return "max(elastic, cracked)";
}

function activeStation(r) {
  if (!r || !r.stations.length) return null;
  selectedStationIndex = clamp(Math.round(selectedStationIndex), 0, r.stations.length - 1);
  return r.stations[selectedStationIndex];
}

function stationZone(r, station) {
  if (!station) return "B";
  return Math.abs(station.V) > r.summary.highShearThreshold ? "A" : "B";
}

function localDesignForStation(r, station) {
  const s = r.summary;
  const sh = shearStateAtStation(r, station, r.inputs.stirrupSpacing, { stirrupBar: r.inputs.stirrupBar, stirrupLegs: r.inputs.stirrupLegs });
  const req = interfaceRequiredForStress(r, station.vInterface);
  const unusedStirrupAv = r.inputs.allocation === "balance"
    ? Math.max(0, s.stirrupAvPerM - sh.beamAvReqPerM)
    : s.stirrupAvPerM;
  const addReq = Math.max(0, req.interfaceAvReqPerM - unusedStirrupAv);
  const totalAvailable = unusedStirrupAv + s.dowelAvPerM;
  const ir = interfaceResistanceFromSteel(r, totalAvailable);
  const interfaceRatio = Math.abs(station.vInterface) / Math.max(1e-9, ir.resistance);
  const shearRatio = Math.max(sh.beamRatio, interfaceRatio);
  const flexRatio = station.M >= 0
    ? Math.abs(station.M) / Math.max(1e-9, s.flex.pos.Mr)
    : Math.abs(station.M) / Math.max(1e-9, s.flex.neg.Mr);
  return {
    beamAvReqPerM: sh.beamAvReqPerM,
    interfaceAvReqPerM: req.interfaceAvReqPerM,
    rhoReq: req.rhoReq,
    unusedStirrupAv,
    addReq,
    totalAvailable,
    beamRatio: sh.beamRatio,
    interfaceRatio,
    shearRatio,
    flexRatio,
    zone: stationZone(r, station),
    shear: sh,
    interfaceResistance: ir.resistance
  };
}

function localSpacingLimit(r, station, detail = null) {
  const sh = shearStateAtStation(r, station, null, detail || { stirrupBar: r.inputs.stirrupBar, stirrupLegs: r.inputs.stirrupLegs });
  const primarySet = detail ? Math.max(0, (+detail.stirrupLegs || 0) * rebar(detail.stirrupBar || r.inputs.stirrupBar).area) : Math.max(0, r.summary.stirrupAvSet);
  const minSteelSpacingLimit = sh.minSteelRequired && primarySet > 0 ? primarySet * Math.max(1, r.inputs.fy) / Math.max(1, 0.06 * Math.sqrt(Math.max(0, r.inputs.fc)) * r.section.b) : Infinity;
  return { minSteelSpacingLimit, sMaxLocal: sh.sMax, minSteelRequired: sh.minSteelRequired };
}

function evaluateDetailAtStation(r, station, primarySpacing, dowelSpacing = null, detail = null) {
  const i = r.inputs;
  const stirrupBar = detail?.stirrupBar || i.stirrupBar;
  const stirrupLegs = detail?.stirrupLegs ?? i.stirrupLegs;
  const dowelBar = detail?.dowelBar || i.dowelBar;
  const dowelLegs = detail?.dowelLegs ?? i.dowelLegs;
  const primarySet = Math.max(0, (+stirrupLegs || 0) * rebar(stirrupBar).area);
  const dowelSet = Math.max(0, (+dowelLegs || 0) * rebar(dowelBar).area);
  const spacing = Math.max(1, primarySpacing || i.stirrupSpacing);
  const primaryPerM = primarySet > 0 && spacing > 0 ? primarySet / spacing * 1000 : 0;
  const sh = shearStateAtStation(r, station, spacing, { stirrupBar, stirrupLegs });
  const req = interfaceRequiredForStress(r, station.vInterface);
  const unused = i.allocation === "balance" ? Math.max(0, primaryPerM - sh.beamAvReqPerM) : primaryPerM;
  const dowelPerM = dowelSet > 0 && dowelSpacing ? dowelSet / dowelSpacing * 1000 : 0;
  const totalInterfaceAvailable = unused + dowelPerM;
  const ir = interfaceResistanceFromSteel(r, totalInterfaceAvailable);
  const interfaceRatio = Math.abs(station.vInterface) / Math.max(1e-9, ir.resistance);
  const shearRatio = Math.max(sh.beamRatio, interfaceRatio);
  const spacingLimit = localSpacingLimit(r, station, { stirrupBar, stirrupLegs });
  const minSteelOk = !sh.minSteelRequired || primarySet >= sh.AvMin - 1e-9;
  const spacingOk = spacing <= spacingLimit.sMaxLocal + 1e-9;
  const interfaceOk = totalInterfaceAvailable >= req.interfaceAvReqPerM - 1e-9 && Math.abs(station.vInterface) <= ir.concreteLimit + 1e-9;
  const practicalSpacingOk = spacing >= i.zoneMinSpacing - 1e-9 && spacing <= i.zoneMaxSpacing + 1e-9 && (!dowelSpacing || (dowelSpacing >= i.zoneMinSpacing - 1e-9 && dowelSpacing <= i.zoneMaxSpacing + 1e-9));
  const ok = sh.beamRatio <= 1.0 + 1e-9 && interfaceRatio <= 1.0 + 1e-9 && spacingOk && minSteelOk && interfaceOk && practicalSpacingOk;
  const reason = governingReason({ beamRatio: sh.beamRatio, interfaceRatio, spacingOk, minSteelOk, interfaceOk, practicalSpacingOk });
  return {
    stirrupBar,
    stirrupLegs,
    dowelBar,
    dowelLegs,
    primarySpacing: spacing,
    primarySet,
    primaryPerM,
    dowelSpacing,
    dowelSet,
    dowelPerM,
    totalInterfaceAvailable,
    interfaceResistance: ir.resistance,
    interfaceResistanceRaw: ir.raw,
    concreteLimit: ir.concreteLimit,
    beamRatio: sh.beamRatio,
    interfaceRatio,
    shearRatio,
    governingShearRatio: shearRatio,
    Vs: sh.Vs,
    Vc: sh.Vc,
    Vr: sh.Vr,
    VrRaw: sh.VrRaw,
    VrMax: sh.VrMax,
    beta: sh.beta,
    thetaDeg: sh.thetaDeg,
    cotTheta: sh.cotTheta,
    epsilonX: sh.epsilonX,
    beamAvReqPerM: sh.beamAvReqPerM,
    interfaceAvReqPerM: req.interfaceAvReqPerM,
    rhoReq: req.rhoReq,
    unusedStirrupAv: unused,
    addReq: Math.max(0, req.interfaceAvReqPerM - unused),
    spacingOk,
    minSteelOk,
    interfaceOk,
    practicalSpacingOk,
    ok,
    reason,
    zone: stationZone(r, station)
  };
}

function governingReason(ev) {
  if (!ev.spacingOk) return "spacing limit";
  if (!ev.minSteelOk) return "minimum shear steel";
  if (!ev.practicalSpacingOk) return "practical spacing limit";
  if (!ev.interfaceOk) return "interface steel / concrete limit";
  if ((ev.beamRatio || 0) >= (ev.interfaceRatio || 0)) return "vertical beam shear";
  return "interface shear";
}

function stationDesignRequirement(r, station) {
  const i = r.inputs;
  const s = r.summary;
  const primarySet = Math.max(0, s.stirrupAvSet);
  const dowelSet = Math.max(0, s.dowelAvSet);
  const limits = localSpacingLimit(r, station);
  const zoneMin = Math.max(50, i.zoneMinSpacing);
  const zoneMax = Math.max(zoneMin, i.zoneMaxSpacing);
  const maxPrimarySpacing = Math.min(zoneMax, Number.isFinite(limits.minSteelSpacingLimit) ? limits.minSteelSpacingLimit : zoneMax, limits.sMaxLocal);
  const primaryOptions = spacingOptions(zoneMin, maxPrimarySpacing);
  const dowelOptions = spacingOptions(zoneMin, zoneMax);

  function bestWithDowels(primarySpacing) {
    let best = evaluateDetailAtStation(r, station, primarySpacing, null);
    if (best.ok || dowelSet <= 0) return best;
    for (const ds of dowelOptions) {
      const trial = evaluateDetailAtStation(r, station, primarySpacing, ds);
      if (trial.ok) return trial;
      if (!best || trial.shearRatio < best.shearRatio) best = trial;
    }
    return best;
  }

  let best = null;
  const selected = niceSpacing(clamp(i.stirrupSpacing || maxPrimarySpacing, zoneMin, maxPrimarySpacing || zoneMin));

  if (i.zoneDesignStrategy === "addDowels") {
    best = bestWithDowels(selected);
  } else if (i.zoneDesignStrategy === "primaryOnly") {
    for (const ps of primaryOptions) {
      const trial = evaluateDetailAtStation(r, station, ps, null);
      if (!best || trial.shearRatio < best.shearRatio || (trial.ok && (!best.ok || ps > best.primarySpacing))) best = trial;
      if (trial.ok) return { ...trial, limits };
    }
  } else {
    // primaryFirst and hybrid: tighten primary stirrups first, then add dowels only if the tightest practical primary spacing is still insufficient.
    for (const ps of primaryOptions) {
      const trial = evaluateDetailAtStation(r, station, ps, null);
      if (!best || trial.shearRatio < best.shearRatio || (trial.ok && (!best.ok || ps > best.primarySpacing))) best = trial;
      if (trial.ok) return { ...trial, limits };
    }
    const tightest = primaryOptions[primaryOptions.length - 1] || zoneMin;
    const withDowels = bestWithDowels(tightest);
    if (!best || withDowels.shearRatio < best.shearRatio) best = withDowels;
  }

  return { ...best, limits };
}

function governingDesignForRange(r, x1, x2) {
  const stations = r.stations.filter(st => st.x >= x1 - 1e-9 && st.x <= x2 + 1e-9);
  const list = stations.length ? stations : [r.stations.reduce((best, st) => Math.abs(st.x - (x1 + x2)/2) < Math.abs(best.x - (x1 + x2)/2) ? st : best, r.stations[0])];
  let gov = null;
  for (const st of list) {
    const req = stationDesignRequirement(r, st);
    const trial = { ...req, station: st };
    if (!gov) { gov = trial; continue; }
    const trialDowel = trial.dowelSpacing || Infinity;
    const govDowel = gov.dowelSpacing || Infinity;
    const trialScore = (trial.ok ? 0 : -100000) - (trial.primarySpacing || 9999) - 0.1 * trialDowel + 1000 * (trial.shearRatio || 0);
    const govScore = (gov.ok ? 0 : -100000) - (gov.primarySpacing || 9999) - 0.1 * govDowel + 1000 * (gov.shearRatio || 0);
    if (trial.primarySpacing < gov.primarySpacing - 1e-9 ||
        (Math.abs(trial.primarySpacing - gov.primarySpacing) < 1e-9 && trialDowel < govDowel - 1e-9) ||
        (!trial.ok && gov.ok) ||
        (Math.abs(trial.primarySpacing - gov.primarySpacing) < 1e-9 && Math.abs(trialDowel - govDowel) < 1e-9 && trialScore > govScore)) {
      gov = trial;
    }
  }
  return gov;
}

function detailKeyFromZone(z) {
  return [z.stirrupBar, Math.round(z.stirrupLegs || 0), Math.round(z.primarySpacing || z.stirrupSpacing || 0), z.dowelBar, Math.round(z.dowelLegs || 0), z.dowelSpacing ? Math.round(z.dowelSpacing) : 0, z.ok ? 1 : 0].join("|");
}

function segmentKey(seg) {
  return detailKeyFromZone(seg);
}

function zoneMinimumLength(r) {
  const userMin = r.inputs.zoneMinLength || 0;
  const twoD = 2 * r.section.d / 1000;
  return Math.max(userMin, twoD);
}

function evaluateExplicitZoneSegment(r, x1, x2, detail) {
  const stations = r.stations.filter(st => st.x >= x1 - 1e-9 && st.x <= x2 + 1e-9);
  const list = stations.length ? stations : [r.stations.reduce((best, st) => Math.abs(st.x - (x1 + x2)/2) < Math.abs(best.x - (x1 + x2)/2) ? st : best, r.stations[0])];
  let gov = null;
  for (const st of list) {
    const ev = evaluateDetailAtStation(r, st, detail.stirrupSpacing, detail.dowelLegs > 0 ? detail.dowelSpacing : null, detail);
    const trial = { ...ev, station: st };
    if (!gov || trial.shearRatio > gov.shearRatio || (!trial.ok && gov.ok)) gov = trial;
  }
  const minLenOk = (x2 - x1) >= zoneMinimumLength(r) - 1e-9 || Math.abs((x2 - x1) - beamLength(r.inputs)) < 1e-9;
  return {
    x1,
    x2,
    minLenOk,
    id: detail.id,
    sourceLabel: detail.label,
    gov,
    stirrupBar: detail.stirrupBar,
    stirrupLegs: detail.stirrupLegs,
    primarySpacing: detail.stirrupSpacing,
    dowelBar: detail.dowelBar,
    dowelLegs: detail.dowelLegs,
    dowelSpacing: detail.dowelLegs > 0 ? detail.dowelSpacing : null,
    addReq: gov?.addReq || 0,
    ok: Boolean(gov?.ok) && minLenOk
  };
}

function mergeAdjacentSameDetail(segments) {
  const out = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (prev && segmentKey(prev) === segmentKey(seg) && Math.abs(prev.x2 - seg.x1) < 1e-6) {
      prev.x2 = seg.x2;
      if (seg.gov && (!prev.gov || seg.gov.shearRatio > prev.gov.shearRatio)) prev.gov = seg.gov;
      prev.addReq = Math.max(prev.addReq || 0, seg.addReq || 0);
      prev.ok = prev.ok && seg.ok;
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}

function consolidateScheduleRows(r, segments) {
  const rows = [];
  for (const seg of segments) {
    const key = segmentKey(seg);
    let row = rows.find(z => z.key === key);
    if (!row) {
      row = {
        key,
        name: seg.sourceLabel || `Zone ${rows.length + 1}`,
        ranges: [],
        gov: seg.gov,
        stirrupBar: seg.stirrupBar,
        stirrupLegs: seg.stirrupLegs,
        primarySpacing: seg.primarySpacing,
        dowelBar: seg.dowelBar,
        dowelLegs: seg.dowelLegs,
        dowelSpacing: seg.dowelSpacing,
        addReq: seg.addReq || 0,
        minLenOk: seg.minLenOk !== false,
        ok: seg.ok,
        mode: r.inputs.zoneDesignMode === "uniform" ? "Uniform" : "Editable zones"
      };
      rows.push(row);
    }
    row.ranges.push({ x1: seg.x1, x2: seg.x2 });
    if (seg.gov && (!row.gov || seg.gov.shearRatio > row.gov.shearRatio)) row.gov = seg.gov;
    row.addReq = Math.max(row.addReq || 0, seg.addReq || 0);
    row.minLenOk = row.minLenOk && seg.minLenOk !== false;
    row.ok = row.ok && seg.ok;
  }
  rows.forEach((row, idx) => {
    if (!row.name) row.name = `Zone ${idx + 1}`;
    row.x1 = row.ranges[0].x1;
    row.x2 = row.ranges[row.ranges.length - 1].x2;
    row.length = row.ranges.reduce((sum, rg) => sum + Math.max(0, rg.x2 - rg.x1), 0);
  });
  return rows;
}

function computeZoneSchedule(r) {
  const i = r.inputs;
  const L = beamLength(i);
  const zones = (i.designZones && i.designZones.length ? i.designZones : [{
    label: "Zone 1", x1: 0, x2: L, stirrupBar: i.stirrupBar, stirrupLegs: i.stirrupLegs, stirrupSpacing: i.stirrupSpacing, dowelBar: i.dowelBar, dowelLegs: i.dowelLegs, dowelSpacing: i.dowelSpacing
  }]);
  const base = { ...zones[0], x1: 0, x2: L, label: "Zone 1" };
  const extras = i.zoneDesignMode === "uniform" ? [] : zones.slice(1).filter(z => z.x2 > z.x1 + 1e-9);
  const bounds = new Set([0, L]);
  extras.forEach(z => { bounds.add(clamp(z.x1, 0, L)); bounds.add(clamp(z.x2, 0, L)); });
  const xs = [...bounds].sort((a, b) => a - b);
  let segments = [];
  for (let idx = 0; idx < xs.length - 1; idx++) {
    const x1 = xs[idx], x2 = xs[idx + 1];
    if (x2 <= x1 + 1e-9) continue;
    const xm = (x1 + x2) / 2;
    const override = [...extras].reverse().find(z => xm >= z.x1 - 1e-9 && xm <= z.x2 + 1e-9);
    const detail = override || base;
    segments.push(evaluateExplicitZoneSegment(r, x1, x2, detail));
  }
  segments = mergeAdjacentSameDetail(segments);
  return consolidateScheduleRows(r, segments);
}

function stationsForRange(r, x1, x2) {
  const stations = r.stations.filter(st => st.x >= x1 - 1e-9 && st.x <= x2 + 1e-9);
  if (stations.length) return stations;
  const mid = (x1 + x2) / 2;
  return [r.stations.reduce((best, st) => Math.abs(st.x - mid) < Math.abs(best.x - mid) ? st : best, r.stations[0])];
}

function evaluateZoneScheduleUtilization(r) {
  const zones = r.summary.zoneSchedule || [];
  let maxBeam = 0;
  let maxInterface = 0;
  let maxGoverning = 0;
  let controlling = null;
  let zoneVerticalStrengthOk = true;
  let zoneSpacingOk = true;
  let zoneMinSteelOk = true;
  let zoneInterfaceOk = true;
  let zonePracticalSpacingOk = true;

  for (const z of zones) {
    const ranges = z.ranges || [{ x1: z.x1, x2: z.x2 }];
    for (const rg of ranges) {
      const stations = stationsForRange(r, rg.x1, rg.x2);
      for (const st of stations) {
        const ev = evaluateDetailAtStation(r, st, z.primarySpacing, z.dowelSpacing || null, z);
        zoneVerticalStrengthOk = zoneVerticalStrengthOk && ev.beamRatio <= 1.0 + 1e-9;
        zoneSpacingOk = zoneSpacingOk && ev.spacingOk;
        zoneMinSteelOk = zoneMinSteelOk && ev.minSteelOk;
        zoneInterfaceOk = zoneInterfaceOk && ev.interfaceOk && ev.interfaceRatio <= 1.0 + 1e-9;
        zonePracticalSpacingOk = zonePracticalSpacingOk && ev.practicalSpacingOk;
        if (ev.shearRatio > maxGoverning) {
          maxGoverning = ev.shearRatio;
          maxBeam = ev.beamRatio;
          maxInterface = ev.interfaceRatio;
          controlling = { station: st, zone: z, ev };
        }
      }
    }
  }
  if (!zones.length) {
    maxBeam = r.summary.beamShearRatio;
    maxInterface = r.summary.interfaceShearRatio;
    maxGoverning = Math.max(maxBeam, maxInterface);
    zoneVerticalStrengthOk = r.summary.verticalStrengthOk;
    zoneSpacingOk = r.summary.verticalSpacingOk;
    zoneMinSteelOk = r.summary.minSteelOk;
    zoneInterfaceOk = r.summary.interfaceOk;
  }
  return {
    zoneBeamShearRatio: maxBeam,
    zoneInterfaceShearRatio: maxInterface,
    zoneGoverningShearRatio: maxGoverning,
    zoneCombinedShearRatio: maxGoverning,
    zoneControlling: controlling,
    zoneVerticalStrengthOk,
    zoneSpacingOk,
    zoneMinSteelOk,
    zoneInterfaceOk,
    zonePracticalSpacingOk
  };
}

function renderZoneSchedule(r) {
  const el = $("zoneSchedule");
  if (!el) return;
  const zones = r.summary.zoneSchedule || [];
  if (!zones.length) {
    el.innerHTML = `<div class="small-muted">No zone schedule generated.</div>`;
    return;
  }
  const i = r.inputs;
  const minLen = zoneMinimumLength(r);
  const rows = zones.map(z => {
    const ranges = (z.ranges || [{ x1: z.x1, x2: z.x2 }]).map(rg => `${fmt(rg.x1,2)}–${fmt(rg.x2,2)}`).join("; ");
    const dowelText = z.dowelSpacing && z.dowelLegs > 0 ? `${fmt(z.dowelLegs,0)} legs ${z.dowelBar} @ ${fmt(z.dowelSpacing,0)} mm` : (z.addReq > 1e-9 ? `Needs ${fmt(z.addReq,0)} mm²/m added interface steel` : "None");
    const cls = z.ok ? "ok" : "ng";
    return `<tr class="${cls}">
      <td>${z.name}</td>
      <td>${ranges}</td>
      <td>${fmt(z.length ?? (z.x2 - z.x1),2)}</td>
      <td>${fmt(Math.abs(z.gov.station.V),0)}</td>
      <td>${fmt(Math.abs(z.gov.station.M),0)}</td>
      <td>${fmt(z.gov.interfaceAvReqPerM,0)}</td>
      <td>${fmt(z.stirrupLegs,0)} legs ${z.stirrupBar} @ ${fmt(z.primarySpacing,0)} mm</td>
      <td>${dowelText}</td>
      <td>${z.gov.reason || "—"}</td>
      <td>${fmt(z.gov.beamRatio,2)} / ${fmt(z.gov.interfaceRatio,2)}</td>
      <td><span class="mini-status ${cls}">${z.ok ? "OK" : "NG"}</span></td>
    </tr>`;
  }).join("");
  el.innerHTML = `<div class="zone-summary">Mode: <strong>${i.zoneDesignMode}</strong> · Strategy: <strong>${i.zoneDesignStrategy}</strong> · ${zones.length} editable schedule row${zones.length === 1 ? "" : "s"} · minimum zone length guide ${fmt(minLen,2)} m (≥2d)</div>
    <div class="table-wrap zone-table-wrap"><table class="zone-table">
      <thead><tr><th>Zone</th><th>x range, m</th><th>Total length, m</th><th>|Vf|, kN</th><th>|Mf|, kN·m</th><th>Interface req, mm²/m</th><th>Primary shear reinforcement</th><th>Added interface dowels</th><th>Governing reason</th><th>Beam / interface util.</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}
function renderSummary(r) {
  const s = r.summary;
  const reactions = r.fe.reactions.map((rx, i) => `R${i + 1}=${fmt(rx.vertical, 0)}`).join(", ");
  $("summaryCards").innerHTML = [
    card("Max |Vf|", `${fmt(s.maxV, 0)} kN`, reactions),
    card("Max |Mf|", `${fmt(s.maxMabs, 0)} kN·m`, `+${fmt(s.maxMpos, 0)}, hog ${fmt(s.maxMneg, 0)}`),
    card("Max q + v", `${fmt(s.maxQ, 0)} kN/m · ${fmt(s.maxStress, 3)} MPa`, demandModelLabel(r.inputs.interfaceDemandModel)),
    card("dv / d / z", `${fmt(r.section.dv, 0)} / ${fmt(r.section.d, 0)} / ${fmt(r.section.z, 0)} mm`, r.inputs.zMode === "auto" ? `${r.section.zSource}; bottom bars ${r.inputs.bottomRows} row${r.inputs.bottomRows > 1 ? "s" : ""}` : "manual z/d"),
    card("Beam shear steel", `${fmt(s.beamAvReqPerM, 0)} mm²/m`, `Vc=${fmt(s.Vc, 0)} kN`),
    card("Interface steel", `${fmt(s.interfaceAvReqPerM, 0)} req · ${fmt(s.additionalInterfaceReq, 0)} add`, interfaceConditionLabel(r.inputs.interfaceCondition)),
    card("Flexural utilization", `${fmt(s.flexRatio, 2)}`, `+ ${fmt(s.flex.posRatio,2)} · − ${fmt(s.flex.negRatio,2)}`),
    card("Shear utilization", `${fmt(s.governingShearRatio, 2)}`, `max(beam ${fmt(s.beamShearRatio, 2)}, interface ${fmt(s.interfaceShearRatio, 2)})`)
  ].join("");
}


function complianceCard(label, status, value, note = "") {
  const cls = status === "ok" ? "ok" : status === "ng" ? "ng" : "warn";
  const txt = status === "ok" ? "OK" : status === "ng" ? "NG" : "REVIEW";
  return `<div class="compliance-card ${cls}">
    <div class="label">${label}</div>
    <div class="result">${txt}</div>
    <div class="value">${value}</div>
    ${note ? `<div class="note">${note}</div>` : ""}
  </div>`;
}

function renderComplianceDashboard(r) {
  const el = $("complianceGrid");
  if (!el) return;
  const s = r.summary;
  const c = s.compliance || complianceStatuses(s);
  el.innerHTML = [
    complianceCard("Analysis model", c.analysis, s.deepBeamFlag ? "Deep-beam / D-region flag" : "Beam model accepted", `${r.inputs.shearMethod === "general" ? "General β/θ from εx" : "Simplified β/θ"}; ${r.section.components.length} section component${r.section.components.length === 1 ? "" : "s"}.`),
    complianceCard("Strength checks", c.strength, `V beam ${fmt(s.beamShearRatio,2)} · interface ${fmt(s.interfaceShearRatio,2)} · flex ${fmt(s.flexRatio,2)}`, "Beam shear, interface shear, concrete interface limit, and sign-aware flexure are checked separately."),
    complianceCard("Detailing checks", c.detailing, `Spacing ${s.zoneSpacingOk ? "OK" : "NG"} · min steel ${s.zoneMinSteelOk ? "OK" : "NG"}`, "Limited review only: spacing/minimum shear steel/practical spacing. Anchorage and development are not yet checked."),
    complianceCard("CSA compliance", c.csa, "Engineer review required", "CSA A23.3:24 shear-expression excerpt is implemented for Clauses 11.2.8, 11.3, and 11.5. Anchorage/development under Clause 11.5.6 and full detailing remain not checked.")
  ].join("");
}

function checkCard(label, ok, value, note, warn = false) {
  const cls = ok ? "ok" : warn ? "warn" : "ng";
  const txt = ok ? "OK" : warn ? "REVIEW" : "NG";
  return `<div class="check-card ${cls}">
    <div class="label">${label}</div>
    <div class="result">${txt}</div>
    <div class="value">${value}</div>
    <div class="note">${note}</div>
  </div>`;
}

function renderChecks(r) {
  const s = r.summary;
  $("checksGrid").innerHTML = [
    checkCard("Vertical shear strength", s.verticalStrengthOk, `Vf/Vr = ${fmt(s.beamShearRatio, 2)} ≤ 1.00`, `CSA A23.3:24 11.3.1/11.3.3: Vc=${fmt(s.Vc, 0)} kN, Vs=${fmt(s.Vs, 0)} kN, Vr=${fmt(s.Vr, 0)} kN; Vr,max=${fmt(s.VrMax, 0)} kN.`),
    checkCard("Stirrup spacing", s.verticalSpacingOk, `zone spacing ≤ local smax`, `CSA A23.3:24 11.3.8: governing local smax=${fmt(s.sMax, 0)} mm. Zone schedule is authoritative.`),
    checkCard("Minimum shear steel", s.minSteelOk, s.minSteelRequired ? `zone Av ≥ Av,min` : `not required at governing station`, `CSA A23.3:24 11.2.8 Eq. 11.1 checked at each scheduled zone spacing when required.`),
    checkCard("Interface shear", s.interfaceOk, `Interface ratio = ${fmt(s.interfaceShearRatio, 2)} ≤ 1.00`, `Unused stirrup balance is credited only after vertical beam shear demand is satisfied; dowels are then added as required.`),
    checkCard("Interface concrete limit", s.maxStress <= s.concreteLimit, `v=${fmt(s.maxStress, 3)} MPa ≤ ${fmt(s.concreteLimit, 2)} MPa`, `CSA A23.3:24 Clause 11.5.1 / Eq. 11.25 upper bound 0.25ϕc f'c.`),
    checkCard("Zone schedule", (s.zoneSchedule || []).every(z => z.ok), `${(s.zoneSchedule || []).length} design zone${(s.zoneSchedule || []).length === 1 ? "" : "s"}`, `Uses local envelope; low-shear zones relax to code/minimum spacing where permitted.`),
    checkCard("Flexural utilization", s.flexUtilizationOk, `governing Mf/Mr = ${fmt(s.flexRatio, 2)} ≤ 1.00`, `Positive ratio ${fmt(s.flex.posRatio, 2)}; negative ratio ${fmt(s.flex.negRatio, 2)}${s.flex.negChecked ? "." : "; top steel not defined for hogging demand."}`, !s.flexUtilizationOk || !s.flex.negChecked),
    checkCard("Separated shear utilization", s.shearUtilizationOk, `max(beam, interface) = ${fmt(s.governingShearRatio, 2)} ≤ 1.00`, `Beam shear ${fmt(s.beamShearRatio, 2)} and interface shear ${fmt(s.interfaceShearRatio, 2)} are not summed.`),
    checkCard("Deep-beam / D-region flag", !s.deepBeamFlag, s.deepBeamFlag ? `L/h < 4` : `L/h OK`, `No strut-and-tie model is included; flagged cases need separate D-region review.`, true)
  ].join("");
}

function scaleX(x, L, left, width) {
  return left + (x / L) * width;
}

function miniPathData(stations, key, left, yTop, plotW, plotH, absMode, positiveDown = false) {
  const xs = stations.map(s => s.x);
  const ys = stations.map(s => absMode ? Math.abs(s[key]) : s[key]);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  let ymin = Math.min(...ys), ymax = Math.max(...ys);
  if (Math.abs(ymax - ymin) < 1e-9) { ymax += 1; ymin -= absMode ? 0 : 1; }
  if (!absMode) {
    const m = Math.max(Math.abs(ymin), Math.abs(ymax));
    ymin = -m; ymax = m;
  } else {
    ymin = 0;
  }
  const sx = x => left + ((x - xmin) / Math.max(1e-9, xmax - xmin)) * plotW;
  const sy = y => {
    const ratio = (y - ymin) / Math.max(1e-9, ymax - ymin);
    return positiveDown ? yTop + ratio * plotH : yTop + (1 - ratio) * plotH;
  };
  const valueAt = d => absMode ? Math.abs(d[key]) : d[key];
  const points = stations.map(d => ({ x: d.x, value: valueAt(d), sx: sx(d.x), sy: sy(valueAt(d)) }));
  const path = points.map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.sx.toFixed(2)} ${pt.sy.toFixed(2)}`).join(" ");
  return { path, points, zeroY: sy(0), ymax, ymin, sx, sy, valueAt };
}

function fillToZeroPaths(points, zeroY, absMode) {
  if (!points.length) return "";
  if (absMode) {
    const curve = points.map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.sx.toFixed(2)} ${pt.sy.toFixed(2)}`).join(" ");
    return `${curve} L ${points[points.length - 1].sx.toFixed(2)} ${zeroY.toFixed(2)} L ${points[0].sx.toFixed(2)} ${zeroY.toFixed(2)} Z`;
  }

  const paths = [];
  let seg = [];
  const pushSeg = () => {
    if (seg.length < 2) { seg = []; return; }
    const curve = seg.map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.sx.toFixed(2)} ${pt.sy.toFixed(2)}`).join(" ");
    paths.push(`${curve} L ${seg[seg.length - 1].sx.toFixed(2)} ${zeroY.toFixed(2)} L ${seg[0].sx.toFixed(2)} ${zeroY.toFixed(2)} Z`);
    seg = [];
  };

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (seg.length === 0) seg.push(a);
    const crosses = (a.value < 0 && b.value > 0) || (a.value > 0 && b.value < 0);
    if (crosses) {
      const t = Math.abs(a.value) / Math.max(1e-12, Math.abs(a.value) + Math.abs(b.value));
      const xz = a.sx + (b.sx - a.sx) * t;
      const zeroPoint = { sx: xz, sy: zeroY, value: 0 };
      seg.push(zeroPoint);
      pushSeg();
      seg.push(zeroPoint);
    }
    seg.push(b);
  }
  pushSeg();
  return paths.join(" ");
}

function buildMiniDiagram(r, key, label, unit, yTop, left, plotW, plotH, absMode, options = {}) {
  const positiveDown = Boolean(options.positiveDown);
  const p = miniPathData(r.stations, key, left, yTop, plotW, plotH, absMode, positiveDown);
  const maxVal = Math.max(...r.stations.map(s => Math.abs(s[key])));
  const bg = options.bg || "#f7fafc";
  const stroke = options.stroke || "#1f6feb";
  const fill = options.fill || stroke;
  const fillPath = fillToZeroPaths(p.points, p.zeroY, absMode);
  const st = options.station || null;
  let marker = "";
  let dynamicText = "";
  if (st) {
    const raw = absMode ? Math.abs(st[key]) : st[key];
    const sx0 = p.sx(st.x);
    const sy0 = p.sy(raw);
    marker = `<circle cx="${sx0}" cy="${sy0}" r="5" fill="${stroke}" stroke="#fff" stroke-width="1.8"/>`;
    dynamicText = `<text x="${left + plotW - 8}" y="${yTop - 14}" text-anchor="end" font-size="12.5" font-weight="800" fill="#26394d">${fmt(raw, 1)} ${unit}</text>`;
  }
  return `
    <g class="mini-demand-diagram">
      <rect x="${left}" y="${yTop}" width="${plotW}" height="${plotH}" rx="10" fill="${bg}" stroke="#dbe3ec"/>
      <text x="${left}" y="${yTop - 14}" font-size="13.5" font-weight="900" fill="#26394d">${label}</text>
      ${dynamicText}
      ${!absMode ? `<line x1="${left}" y1="${p.zeroY}" x2="${left + plotW}" y2="${p.zeroY}" stroke="#c7d1dc" stroke-dasharray="5 5"/>` : `<line x1="${left}" y1="${p.zeroY}" x2="${left + plotW}" y2="${p.zeroY}" stroke="#c7d1dc"/>`}
      <path d="${fillPath}" fill="${fill}" opacity="0.16"/>
      <path d="${p.path}" fill="none" stroke="${stroke}" stroke-width="3.1"/>
      ${marker}
      <text x="${left + 10}" y="${yTop + 19}" font-size="11.5" fill="#667587">${fmt(p.ymax, 1)}</text>
      <text x="${left + 10}" y="${yTop + plotH - 8}" font-size="11.5" fill="#667587">${fmt(p.ymin, 1)}</text>
    </g>`;
}
function buildMiniInterfaceDiagram(r, yTop, left, plotW, plotH, station = null) {
  const qMax = Math.max(...r.stations.map(s => Math.abs(s.qDesign)));
  const vMax = Math.max(...r.stations.map(s => Math.abs(s.vInterface)));
  const local = r.stations.map(s => ({ x: s.x, qNorm: qMax > 0 ? Math.abs(s.qDesign) / qMax : 0 }));
  const p = miniPathData(local, "qNorm", left, yTop, plotW, plotH, true, false);
  const fillPath = fillToZeroPaths(p.points, p.zeroY, true);
  let marker = "";
  let dynamicText = "";
  if (station) {
    const qNorm = qMax > 0 ? Math.abs(station.qDesign) / qMax : 0;
    const sx0 = p.sx(station.x);
    const sy0 = p.sy(qNorm);
    marker = `<circle cx="${sx0}" cy="${sy0}" r="4.8" fill="#1f6feb" stroke="#fff" stroke-width="1.8"/>`;
    dynamicText = `<text x="${left + plotW - 8}" y="${yTop - 14}" text-anchor="end" font-size="12.5" font-weight="800" fill="#26394d">q=${fmt(station.qDesign, 1)} kN/m · v=${fmt(station.vInterface, 3)} MPa</text>`;
  }
  return `
    <g class="mini-demand-diagram">
      <rect x="${left}" y="${yTop}" width="${plotW}" height="${plotH}" rx="10" fill="#f3f8ff" stroke="#c9dcf5"/>
      <text x="${left}" y="${yTop - 14}" font-size="13.5" font-weight="900" fill="#26394d">Interface q / v demand</text>
      ${dynamicText}
      <line x1="${left}" y1="${p.zeroY}" x2="${left + plotW}" y2="${p.zeroY}" stroke="#b7c9de"/>
      <path d="${fillPath}" fill="#1f6feb" opacity="0.17"/>
      <path d="${p.path}" fill="none" stroke="#1f6feb" stroke-width="3.1"/>
      ${marker}
      <text x="${left + 10}" y="${yTop + 18}" font-size="11.5" fill="#285a8f">q: kN/m</text>
      <text x="${left + plotW - 10}" y="${yTop + 18}" text-anchor="end" font-size="11.5" fill="#285a8f">v: MPa</text>
      <text x="${left + 10}" y="${yTop + plotH - 7}" font-size="11.5" fill="#285a8f">0</text>
      <text x="${left + plotW - 10}" y="${yTop + plotH - 7}" text-anchor="end" font-size="11.5" fill="#285a8f">max ${fmt(qMax, 1)} / ${fmt(vMax, 3)}</text>
    </g>`;
}
function zoneColour(idx) {
  const palette = ["#b3261e", "#b26a00", "#5d3fd3", "#0f766e", "#7a2e83"];
  return palette[idx % palette.length];
}
function zoneLabel(seg) {
  const primary = `${seg.name}: ${fmt(seg.stirrupLegs,0)}-${seg.stirrupBar} @ ${fmt(seg.primarySpacing,0)} mm`;
  const dowels = seg.dowelSpacing ? `${fmt(seg.dowelLegs,0)}-${seg.dowelBar} dowels @ ${fmt(seg.dowelSpacing,0)} mm` : "no added dowels";
  return { primary, dowels };
}
function scheduledUtilizationAtStation(r, station) {
  if (!r || !station) return null;
  const zone = zoneForStation(r, station);
  if (!zone) return null;
  const ev = evaluateDetailAtStation(r, station, zone.primarySpacing, zone.dowelSpacing || null, zone);
  return { ...ev, zoneName: zone.name || zone.label || "Zone", zone };
}

function utilizationColour(util) {
  if (!Number.isFinite(util)) return "#94a3b8";
  if (util > 1.0 + 1e-9) return "#b3261e";
  if (util >= 0.85) return "#b26a00";
  return "#137333";
}

function buildUtilizationBand(r, left, plotW, L, yTop, bandH, station = null) {
  const stations = r.stations || [];
  if (stations.length < 2) return "";
  const labelY = yTop - 12;
  const midY = yTop + bandH / 2;
  const intervals = [];
  for (let idx = 0; idx < stations.length - 1; idx++) {
    const a = stations[idx];
    const b = stations[idx + 1];
    if (b.x <= a.x + 1e-9) continue;
    const evA = scheduledUtilizationAtStation(r, a);
    const evB = scheduledUtilizationAtStation(r, b);
    const util = Math.max(evA?.shearRatio || 0, evB?.shearRatio || 0);
    const ok = (evA?.ok !== false) && (evB?.ok !== false) && util <= 1.0 + 1e-9;
    intervals.push({ x1: a.x, x2: b.x, util, ok, reason: !ok ? (evA?.reason || evB?.reason || "review") : (evA?.reason || "OK") });
  }
  const rects = intervals.map(seg => {
    const x1 = scaleX(seg.x1, L, left, plotW);
    const x2 = scaleX(seg.x2, L, left, plotW);
    const color = utilizationColour(seg.util);
    return `<rect x="${x1}" y="${yTop}" width="${Math.max(1, x2 - x1)}" height="${bandH}" fill="${color}" opacity="${seg.ok ? 0.28 : 0.58}"/>`;
  }).join("");
  const failMarkers = intervals.filter(seg => !seg.ok).map(seg => {
    const x1 = scaleX(seg.x1, L, left, plotW);
    const x2 = scaleX(seg.x2, L, left, plotW);
    return `<line x1="${(x1+x2)/2}" y1="${yTop - 4}" x2="${(x1+x2)/2}" y2="${yTop + bandH + 4}" stroke="#b3261e" stroke-width="1.8" stroke-dasharray="4 4"/>`;
  }).join("");
  const selected = station ? scheduledUtilizationAtStation(r, station) : null;
  const selectedText = selected ? `${selected.zoneName}: utilization ${fmt(selected.shearRatio,2)} · ${selected.ok ? "OK" : "NG / " + selected.reason}` : "";
  return `<g class="scheduled-utilization-band">
    <text x="${left}" y="${labelY}" font-size="13" font-weight="900" fill="#26394d">Scheduled utilization along beam</text>
    <text x="${left + plotW - 2}" y="${labelY}" text-anchor="end" font-size="12" font-weight="800" fill="#667587">green &lt;0.85 · amber 0.85–1.0 · red &gt;1.0</text>
    <rect x="${left}" y="${yTop}" width="${plotW}" height="${bandH}" rx="8" fill="#eef3f8" stroke="#cbd8e6"/>
    ${rects}
    ${failMarkers}
    <line x1="${left}" y1="${midY}" x2="${left + plotW}" y2="${midY}" stroke="#ffffff" stroke-width="1.1" opacity="0.55"/>
    <text x="${left + 9}" y="${yTop + bandH + 16}" font-size="12" font-weight="800" fill="${selected && !selected.ok ? "#b3261e" : "#26394d"}">${selectedText}</text>
  </g>`;
}
function buildStirrupIntervalTicks(x1m, x2m, spacingMm, L, left, plotW, yTop, zoneH, options = {}) {
  const spacingM = Math.max(0.025, (+spacingMm || 0) / 1000);
  const xStart = Math.max(0, +x1m || 0);
  const xEnd = Math.max(xStart, +x2m || xStart);
  if (xEnd <= xStart + 1e-9 || !Number.isFinite(spacingM)) return "";
  const y1 = options.y1 ?? (yTop + 10);
  const y2 = options.y2 ?? (yTop + zoneH - 12);
  const stroke = options.stroke || "#c5ced8";
  const width = options.width || 0.9;
  const dash = options.dash ? ` stroke-dasharray="${options.dash}"` : "";
  const maxTicks = 220;
  const ticks = [];
  let x = xStart;
  let n = 0;
  while (x <= xEnd + 1e-9 && n < maxTicks) {
    const sx = scaleX(Math.min(x, xEnd), L, left, plotW);
    ticks.push(`<line x1="${sx}" y1="${y1}" x2="${sx}" y2="${y2}" stroke="${stroke}" stroke-width="${width}"${dash}/>`);
    x += spacingM;
    n += 1;
  }
  if (Math.abs((x - spacingM) - xEnd) > spacingM * 0.25 && n < maxTicks) {
    const sx = scaleX(xEnd, L, left, plotW);
    ticks.push(`<line x1="${sx}" y1="${y1}" x2="${sx}" y2="${y2}" stroke="${stroke}" stroke-width="${width}"${dash}/>`);
  }
  return ticks.join("");
}

function buildShearZones(r, left, plotW, L, yTop, zoneH = 64) {
  const schedule = r.summary.zoneSchedule || [];
  const labelY = yTop + 18;
  const noteY = yTop + 36;
  const rangeY = yTop + zoneH - 12;
  const bandBg = `<rect x="${left}" y="${yTop}" width="${plotW}" height="${zoneH}" rx="10" fill="#f7f9fc" stroke="#d7e0ea"/>`;
  const axisLine = `<line x1="${left}" y1="${rangeY}" x2="${left + plotW}" y2="${rangeY}" stroke="#d0d9e4" stroke-width="1.1"/>`;

  if (schedule.length) {
    const zoneSvg = schedule.map((seg, idx) => {
      const ranges = seg.ranges || [{ x1: seg.x1, x2: seg.x2 }];
      const labels = zoneLabel(seg);
      return ranges.map((rg, ridx) => {
        const x1 = scaleX(rg.x1, L, left, plotW);
        const x2 = scaleX(rg.x2, L, left, plotW);
        const mid = (x1 + x2) / 2;
        const minLabelWidth = 132;
        const small = Math.abs(x2 - x1) < minLabelWidth;
        const tx = small ? Math.min(left + plotW - 6, Math.max(left + 6, mid)) : mid;
        const intervalTicks = buildStirrupIntervalTicks(rg.x1, rg.x2, seg.primarySpacing, L, left, plotW, yTop, zoneH);
        const dowelTicks = seg.dowelSpacing
          ? buildStirrupIntervalTicks(rg.x1, rg.x2, seg.dowelSpacing, L, left, plotW, yTop, zoneH, { y1: yTop + zoneH - 24, y2: yTop + zoneH - 6, stroke: "#9eb3c7", width: 1.05, dash: "3 3" })
          : "";
        const labelPrefix = ranges.length > 1 ? `${seg.name || seg.label || "Zone"} (${ridx + 1})` : (seg.name || seg.label || "Zone");
        return `<g class="zone-interval-range">
                <rect x="${x1}" y="${yTop + 4}" width="${Math.max(1, x2 - x1)}" height="${zoneH - 8}" rx="8" fill="#ffffff" opacity="0.62" stroke="#d4dde7" stroke-width="1"/>
                ${intervalTicks}
                ${dowelTicks}
                <line x1="${x1}" y1="${yTop - 4}" x2="${x1}" y2="${yTop + zoneH + 5}" stroke="#6b7d91" stroke-width="1.5"/>
                <line x1="${x2}" y1="${yTop - 2}" x2="${x2}" y2="${yTop + zoneH + 3}" stroke="#6b7d91" stroke-width="1.2" opacity="0.9"/>
                <line x1="${x1}" y1="${rangeY}" x2="${x2}" y2="${rangeY}" stroke="#718296" stroke-width="2.2" stroke-linecap="round"/>
                <text x="${tx}" y="${labelY}" text-anchor="middle" font-size="12.8" font-weight="900" fill="#26394d">${labelPrefix}: ${fmt(seg.primarySpacing,0)} mm stirrups</text>
                <text x="${tx}" y="${noteY}" text-anchor="middle" font-size="11.5" font-weight="750" fill="#5d6f82">${seg.stirrupLegs}-${seg.stirrupBar}${seg.dowelSpacing ? ` + ${fmt(seg.dowelSpacing,0)} mm dowels` : ""}</text>
              </g>`;
      }).join("");
    }).join("");
    return `${bandBg}${axisLine}${zoneSvg}`;
  }

  const high = r.summary.highShearThreshold;
  const stations = r.stations;
  const zones = [];
  let start = stations[0].x;
  let current = Math.abs(stations[0].V) > high ? "A" : "B";
  for (let i = 1; i < stations.length; i++) {
    const z = Math.abs(stations[i].V) > high ? "A" : "B";
    if (z !== current) {
      zones.push({ start, end: stations[i - 1].x, zone: current });
      start = stations[i - 1].x;
      current = z;
    }
  }
  zones.push({ start, end: stations[stations.length - 1].x, zone: current });
  const fallback = zones.map((seg) => {
    const x1 = scaleX(seg.start, L, left, plotW);
    const x2 = scaleX(seg.end, L, left, plotW);
    const ticks = buildStirrupIntervalTicks(seg.start, seg.end, r.inputs.stirrupSpacing, L, left, plotW, yTop, zoneH);
    return `<g class="zone-interval-range">
            <rect x="${x1}" y="${yTop + 4}" width="${Math.max(1, x2 - x1)}" height="${zoneH - 8}" rx="8" fill="#ffffff" opacity="0.62" stroke="#d4dde7" stroke-width="1"/>
            ${ticks}
            <line x1="${x1}" y1="${rangeY}" x2="${x2}" y2="${rangeY}" stroke="#718296" stroke-width="2.2" stroke-linecap="round"/>
            <line x1="${x1}" y1="${yTop - 3}" x2="${x1}" y2="${yTop + zoneH + 3}" stroke="#6b7d91" stroke-width="1.3"/>
            <text x="${(x1 + x2)/2}" y="${labelY}" text-anchor="middle" font-size="12.4" font-weight="900" fill="#26394d">Shear zone ${seg.zone}</text>
          </g>`;
  }).join("");
  return `${bandBg}${axisLine}${fallback}`;
}

function renderElevation(r) {
  const width = 1000, height = 850, left = 86, right = 48;
  const L = beamLength(r.inputs);
  const plotW = width - left - right;
  const supports = supportLocations(r.inputs);
  const xP = r.inputs.Px;
  const includeP = r.inputs.includePoint && r.inputs.Pf !== 0;
  const st = activeStation(r);
  const local = st ? localDesignForStation(r, st) : null;

  const pxPerMmAlongSpan = plotW / Math.max(1, L * 1000);
  const totalBeamH = clamp(r.inputs.h * pxPerMmAlongSpan, 46, 102);
  const slabH = clamp(r.inputs.slabDepth * pxPerMmAlongSpan, 10, totalBeamH - 14);
  const webH = Math.max(24, totalBeamH - slabH);
  const topY = 104;
  const jointY = topY + slabH;
  const bottomY = topY + totalBeamH;
  const supportBaseY = bottomY + 38;
  const dimY = bottomY + 70;
  const zoneTop = dimY + 40;
  const zoneH = 72;
  const zoneMidY = zoneTop + zoneH / 2;

  let arrows = "";
  const wLabel = r.inputs.Wf !== 0 ? `<text x="${left + 3}" y="${topY - 39}" font-size="12.5" font-weight="800" fill="#1f6feb">Wf=${fmt(r.inputs.Wf,1)} kN/m</text>` : "";
  const nArrows = 14;
  if (r.inputs.Wf !== 0) {
    for (let i = 0; i <= nArrows; i++) {
      const x = left + plotW * i / nArrows;
      arrows += `<line x1="${x}" y1="54" x2="${x}" y2="${topY - 8}" stroke="#1f6feb" stroke-width="2.3" marker-end="url(#arrowBlue)"/>`;
    }
  }

  const supportSvg = supports.map((sx, i) => {
    const x = scaleX(sx, L, left, plotW);
    if (false && r.inputs.beamSystem === "cantilever" && i === 0) {
      return `<rect x="${x - 12}" y="${topY - 18}" width="24" height="${totalBeamH + 42}" fill="#d9e2ec" stroke="#334e68"/>
              ${Array.from({ length: 7 }, (_, j) => `<line x1="${x - 18}" y1="${topY - 12 + j*14}" x2="${x - 36}" y2="${topY - 2 + j*14}" stroke="#8091a5"/>`).join("")}`;
    }
    return `<polygon points="${x},${bottomY + 5} ${x - 19},${supportBaseY} ${x + 19},${supportBaseY}" fill="#d9e2ec" stroke="#334e68"/>
            <line x1="${x - 30}" y1="${supportBaseY}" x2="${x + 30}" y2="${supportBaseY}" stroke="#334e68"/>`;
  }).join("");

  const pointSvg = includeP ? (() => {
    const x = scaleX(xP, L, left, plotW);
    return `<line x1="${x}" y1="44" x2="${x}" y2="${topY - 10}" stroke="#b3261e" stroke-width="4" marker-end="url(#arrowRed)"/>
            <text x="${x + 9}" y="48" fill="#b3261e" font-size="13" font-weight="900">Pf=${fmt(r.inputs.Pf, 0)} kN @ x=${fmt(xP, 2)} m</text>`;
  })() : "";

  const dimArrowLeft = `<marker id="dimArrowLeft" markerWidth="9" markerHeight="9" refX="4" refY="4" orient="auto"><path d="M8,0 L0,4 L8,8" fill="none" stroke="#60748a" stroke-width="1.6"/></marker>`;
  const dimArrowRight = `<marker id="dimArrowRight" markerWidth="9" markerHeight="9" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="none" stroke="#60748a" stroke-width="1.6"/></marker>`;
  const spanDims = r.inputs.beamSystem === "twoSpan"
    ? [{ x1: 0, x2: r.inputs.L1, label: `L1 = ${fmt(r.inputs.L1,2)} m` }, { x1: r.inputs.L1, x2: L, label: `L2 = ${fmt(r.inputs.L2,2)} m` }]
    : r.inputs.beamSystem === "spanCantilever"
      ? [{ x1: 0, x2: r.inputs.L1, label: `span = ${fmt(r.inputs.L1,2)} m` }, { x1: r.inputs.L1, x2: L, label: `cantilever = ${fmt(r.inputs.L2,2)} m` }]
      : [{ x1: 0, x2: L, label: `L = ${fmt(r.inputs.L1,2)} m` }];
  const spanLabels = spanDims.map(d => {
    const x1 = scaleX(d.x1, L, left, plotW);
    const x2 = scaleX(d.x2, L, left, plotW);
    const mid = (x1 + x2) / 2;
    return `<line x1="${x1}" y1="${dimY}" x2="${x2}" y2="${dimY}" stroke="#60748a" stroke-width="1.4" marker-start="url(#dimArrowLeft)" marker-end="url(#dimArrowRight)"/>
            <line x1="${x1}" y1="${dimY - 10}" x2="${x1}" y2="${dimY + 10}" stroke="#8091a5"/>
            <line x1="${x2}" y1="${dimY - 10}" x2="${x2}" y2="${dimY + 10}" stroke="#8091a5"/>
            <rect x="${mid - 48}" y="${dimY - 18}" width="96" height="17" rx="8" fill="#ffffff" opacity="0.92"/>
            <text x="${mid}" y="${dimY - 5}" text-anchor="middle" font-size="13" font-weight="850" fill="#334e68">${d.label}</text>`;
  }).join("");

  const diagramTop = zoneTop + zoneH + 66;
  const diagramH = 102;
  const diagramGap = 48;
  const interfaceH = 52;
  const miniM = buildMiniDiagram(r, "M", "Mf diagram", "kN·m", diagramTop, left, plotW, diagramH, false, { positiveDown: true, bg: "#f7fbff", station: st });
  const miniV = buildMiniDiagram(r, "V", "Vf diagram", "kN", diagramTop + diagramH + diagramGap, left, plotW, diagramH, false, { bg: "#f7fafc", station: st });
  const interfaceTop = diagramTop + (diagramH + diagramGap) * 2;
  const miniInterface = buildMiniInterfaceDiagram(r, interfaceTop, left, plotW, interfaceH, st);
  const cursorX = st ? scaleX(st.x, L, left, plotW) : left;
  const cursorBottom = interfaceTop + interfaceH + 8;
  const scheduledLocal = st ? scheduledUtilizationAtStation(r, st) : null;
  const zoneText = scheduledLocal ? `Active: ${scheduledLocal.zoneName}${scheduledLocal.ok ? "" : " · review"}` : (local ? `Active: ${local.zone}` : "");
  const cursorLabel = st ? `x=${fmt(st.x,3)} m` : "";
  const cursorLabelX = st ? Math.min(left + plotW - 74, Math.max(left + 74, cursorX)) : left;
  const cursorSvg = st ? `
    <line x1="${cursorX}" y1="${topY - 14}" x2="${cursorX}" y2="${cursorBottom}" stroke="#b3261e" stroke-width="1.8" stroke-dasharray="6 6"/>
    <circle cx="${cursorX}" cy="${jointY}" r="4.6" fill="#b3261e" stroke="#fff" stroke-width="1.2"/>
    <circle cx="${cursorX}" cy="${zoneMidY}" r="4.3" fill="#b3261e" stroke="#fff" stroke-width="1.1"/>
    <rect x="${cursorLabelX - 74}" y="${zoneTop + zoneH + 14}" width="148" height="19" rx="9" fill="#fff" stroke="#f0b7b2" opacity="0.96"/>
    <text x="${cursorLabelX}" y="${zoneTop + zoneH + 28}" text-anchor="middle" font-size="12.2" fill="#b3261e" font-weight="900">${cursorLabel}</text>
  ` : "";

  const sliderTop = topY - 18;
  const sliderHeight = cursorBottom - sliderTop;
  const svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Beam elevation with aligned demand diagrams">
    <defs>
      <marker id="arrowBlue" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#1f6feb"/></marker>
      <marker id="arrowRed" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#b3261e"/></marker>
      ${dimArrowLeft}
      ${dimArrowRight}
    </defs>
    <text x="${left}" y="24" font-size="16" font-weight="900" fill="#17202a">Elevation: ${labelBeamSystem(r.inputs.beamSystem)}</text>
    ${wLabel}
    ${arrows}
    ${pointSvg}
    <rect x="${left}" y="${topY}" width="${plotW}" height="${slabH}" rx="5" fill="#dce9f8" stroke="#5f6f82"/>
    <rect x="${left}" y="${jointY}" width="${plotW}" height="${webH}" rx="5" fill="#e8edf3" stroke="#5f6f82"/>
    <line x1="${left}" y1="${jointY}" x2="${left + plotW}" y2="${jointY}" stroke="#b26a00" stroke-width="2.5" stroke-dasharray="7 6"/>
    <text x="${left + 10}" y="${jointY - 7}" font-size="12.2" fill="#6b4600" font-weight="850">cold joint / roughened interface</text>
    ${supportSvg}
    <line x1="${left - 26}" y1="${topY}" x2="${left - 26}" y2="${bottomY}" stroke="#8091a5"/>
    <line x1="${left - 40}" y1="${topY}" x2="${left - 24}" y2="${topY}" stroke="#8091a5"/>
    <line x1="${left - 40}" y1="${bottomY}" x2="${left - 24}" y2="${bottomY}" stroke="#8091a5"/>
    <text x="${left - 48}" y="${topY + totalBeamH/2}" transform="rotate(-90 ${left - 48} ${topY + totalBeamH/2})" font-size="12.5" font-weight="800" text-anchor="middle" fill="#334e68">h=${fmt(r.inputs.h,0)} mm</text>
    ${spanLabels}
    <text x="${left}" y="${zoneTop - 12}" font-size="13" font-weight="900" fill="#26394d">Design zones / scheduled reinforcement</text>
    <text x="${left + plotW - 2}" y="${zoneTop - 12}" text-anchor="end" font-size="12" fill="#667587" font-weight="800">${zoneText}</text>
    ${buildShearZones(r, left, plotW, L, zoneTop, zoneH)}
    ${miniM}
    ${miniV}
    ${miniInterface}
    ${cursorSvg}
  </svg>`;

  $("beamElevation").innerHTML = `
    <div class="beam-elev-wrap">
      ${svg}
      <div class="beam-slider-overlay" style="left:${(left / width * 100).toFixed(3)}%; width:${(plotW / width * 100).toFixed(3)}%; top:${(sliderTop / height * 100).toFixed(3)}%; height:${(sliderHeight / height * 100).toFixed(3)}%;">
        <input id="stationSlider" type="range" min="0" max="${r.stations.length - 1}" step="1" value="${selectedStationIndex}" aria-label="Station along beam" />
      </div>
    </div>`;

  const slider = $("stationSlider");
  if (slider) {
    slider.addEventListener("input", () => {
      selectedStationIndex = parseInt(slider.value, 10) || 0;
      if (lastResult) {
        renderElevation(lastResult);
        renderStationUtilizationDashboard(lastResult);
        renderCrossSection(lastResult);
      }
    });
  }
}
function labelBeamSystem(system) {
  if (system === "simple") return "single-span simply supported";
  if (system === "twoSpan") return "two-span continuous";
  if (system === "spanCantilever") return "span + cantilever overhang";
  return system;
}

function zoneForStation(r, station) {
  const zones = r.summary.zoneSchedule || [];
  if (!station || !zones.length) return null;
  return zones.find(z => (z.ranges || [{ x1: z.x1, x2: z.x2 }]).some(rg => station.x >= rg.x1 - 1e-9 && station.x <= rg.x2 + 1e-9)) || zones[zones.length - 1];
}
function stationUtilizationValues(r) {
  const st = activeStation(r);
  if (!st) return null;
  const zone = zoneForStation(r, st);
  const scheduled = scheduledUtilizationAtStation(r, st);
  const flexMr = st.M >= 0 ? r.summary.flex.pos.Mr : r.summary.flex.neg.Mr;
  const flexRatio = Math.abs(st.M) / Math.max(1e-9, flexMr);
  const beamRatio = scheduled ? scheduled.beamRatio : 0;
  const interfaceRatio = scheduled ? scheduled.interfaceRatio : 0;
  return {
    station: st,
    zone,
    scheduled,
    x: st.x,
    flexRatio,
    beamRatio,
    interfaceRatio,
    mf: Math.abs(st.M),
    mr: flexMr,
    vf: Math.abs(st.V),
    vr: scheduled?.Vr || 0,
    vi: Math.abs(st.vInterface),
    vri: scheduled?.interfaceResistance || 0,
    ok: (flexRatio <= 1.0 + 1e-9) && (scheduled ? scheduled.ok : true)
  };
}

function utilStatusClass(value) {
  if (!Number.isFinite(value)) return "review";
  if (value > 1.0 + 1e-9) return "ng";
  if (value >= 0.85) return "warn";
  return "ok";
}

function utilMiniCard(label, ratio, detail) {
  const cls = utilStatusClass(ratio);
  return `<div class="util-mini-card ${cls}">
    <div class="util-mini-label">${label}</div>
    <div class="util-mini-value">${fmt(ratio, 2)}</div>
    <div class="util-mini-detail">${detail}</div>
  </div>`;
}

function renderStationUtilizationDashboard(r) {
  const el = $("stationUtilizationDashboard");
  if (!el) return;
  const u = stationUtilizationValues(r);
  if (!u) {
    el.innerHTML = "";
    return;
  }
  const zoneName = u.scheduled?.zoneName || u.zone?.name || u.zone?.label || "Base reinforcement";
  const governing = Math.max(u.flexRatio, u.beamRatio, u.interfaceRatio);
  const statusCls = utilStatusClass(governing);
  el.innerHTML = `<div class="station-utilization-head">
      <div>
        <h3>Station utilization</h3>
        <div class="station-utilization-subtitle">x = ${fmt(u.x, 3)} m · ${zoneName}</div>
      </div>
      <div class="station-utilization-chip ${statusCls}">${governing <= 1.0 + 1e-9 ? "OK" : "NG"}</div>
    </div>
    <div class="station-utilization-grid">
      ${utilMiniCard("Mf / Mr", u.flexRatio, `${fmt(u.mf,1)} / ${fmt(u.mr,1)} kN·m`)}
      ${utilMiniCard("Vf / Vr", u.beamRatio, `${fmt(u.vf,1)} / ${fmt(u.vr,1)} kN`)}
      ${utilMiniCard("Vinterface / Vr interface", u.interfaceRatio, `${fmt(u.vi,3)} / ${fmt(u.vri,3)} MPa`)}
    </div>
    <div class="station-utilization-note">Interface resistance uses only the unused stirrup balance plus dowels, so primary stirrup steel is not double counted when the balance allocation is selected.</div>`;
}

function renderCrossSection(r) {
  const w = 500, hSvg = 520;
  const x0 = 82, y0 = 82;
  const maxW = 345, maxH = 278;
  const st = activeStation(r);
  const local = st ? localDesignForStation(r, st) : null;
  const scheduledLocal = st ? scheduledUtilizationAtStation(r, st) : null;
  const zone = st ? zoneForStation(r, st) : null;
  const zonePrimarySpacing = zone ? zone.primarySpacing : r.inputs.stirrupSpacing;
  const zoneDowelSpacing = zone && zone.dowelSpacing ? zone.dowelSpacing : r.inputs.dowelSpacing;
  const zoneStirrupBar = zone ? zone.stirrupBar : r.inputs.stirrupBar;
  const zoneStirrupLegs = zone ? zone.stirrupLegs : r.inputs.stirrupLegs;
  const zoneDowelBar = zone ? zone.dowelBar : r.inputs.dowelBar;
  const zoneDowelLegs = zone ? zone.dowelLegs : r.inputs.dowelLegs;
  const scale = Math.min(maxW / Math.max(1, r.inputs.b), maxH / Math.max(1, r.inputs.h));
  const secW = r.inputs.b * scale;
  const secH = r.inputs.h * scale;
  const slabH = r.section.slabDepth * scale;
  const main = rebar(r.inputs.mainBar);
  const topMain = rebar(r.inputs.topBar || r.inputs.mainBar);
  const stirrup = rebar(zoneStirrupBar);
  const dowel = rebar(zoneDowelBar);
  const mainR = Math.max(2.0, (main.diameter * scale) / 2);
  const topMainR = Math.max(2.0, (topMain.diameter * scale) / 2);
  const stirrupW = Math.max(1.5, stirrup.diameter * scale);
  const dowelW = Math.max(1.5, dowel.diameter * scale);
  const coverPx = Math.max(5, r.inputs.cover * scale);
  const innerX0 = x0 + coverPx + stirrupW;
  const innerX1 = x0 + secW - coverPx - stirrupW;
  const innerY0 = y0 + coverPx;
  const innerY1 = y0 + secH - coverPx;

  const bottomCountTotal = Math.max(0, Math.round(r.inputs.mainCount));
  const bottomRows = bottomCountTotal <= 1 ? 1 : Math.max(1, Math.min(2, Math.round(r.inputs.bottomRows || 1)));
  const bottomNearCount = bottomRows === 1 ? bottomCountTotal : Math.ceil(bottomCountTotal / 2);
  const bottomFarCount = bottomRows === 1 ? 0 : bottomCountTotal - bottomNearCount;
  const topCountTotal = Math.max(0, Math.round(r.inputs.topCount || 0));
  const topRows = topCountTotal <= 1 ? 1 : Math.max(1, Math.min(2, Math.round(r.inputs.topRows || 1)));
  const topNearCount = topRows === 1 ? topCountTotal : Math.ceil(topCountTotal / 2);
  const topFarCount = topRows === 1 ? 0 : topCountTotal - topNearCount;
  const bottomRowGap = Math.max((r.inputs.barRowSpacing || 75) * scale, 2.9 * mainR, 12);
  const topRowGap = Math.max((r.inputs.barRowSpacing || 75) * scale, 2.9 * topMainR, 12);
  const bottomYNear = innerY1 - mainR;
  const bottomYFar = bottomYNear - bottomRowGap;
  const topYNear = innerY0 + topMainR;
  const topYFar = topYNear + topRowGap;

  function rowBars(n, y, radius, fill = "#1f2937") {
    if (n <= 0) return "";
    const usable = Math.max(0, innerX1 - innerX0 - 2 * radius);
    return Array.from({ length: n }, (_, i) => {
      const bx = n === 1 ? (innerX0 + innerX1) / 2 : innerX0 + radius + i * (usable / Math.max(1, n - 1));
      return `<circle cx="${bx}" cy="${y}" r="${radius}" fill="${fill}"/>`;
    }).join("");
  }
  const bars = [
    rowBars(topNearCount, topYNear, topMainR, "#374151"),
    rowBars(topFarCount, topYFar, topMainR, "#374151"),
    rowBars(bottomFarCount, bottomYFar, mainR, "#1f2937"),
    rowBars(bottomNearCount, bottomYNear, mainR, "#1f2937")
  ].join("");

  const stirrupLegs = Math.max(0, Math.round(zoneStirrupLegs));
  let legs = "";
  const nLegs = Math.min(24, stirrupLegs);
  for (let i = 0; i < nLegs; i++) {
    const lx = innerX0 + i * ((innerX1 - innerX0) / Math.max(1, nLegs - 1));
    legs += `<line x1="${lx}" y1="${innerY0}" x2="${lx}" y2="${innerY1}" stroke="#2a5caa" stroke-width="${stirrupW}" opacity="0.82"/>`;
  }

  const dowelLegs = Math.max(0, Math.round(zoneDowelLegs));
  let dowels = "";
  const nDowels = Math.min(16, dowelLegs);
  for (let i = 0; i < nDowels; i++) {
    const dx = innerX0 + (i + 0.5) * ((innerX1 - innerX0) / Math.max(1, nDowels));
    dowels += `<path d="M${dx},${y0 + slabH - 18} V${y0 + slabH + 44} q0,8 8,8 h10" fill="none" stroke="#b3261e" stroke-width="${dowelW}" stroke-linecap="round"/>`;
  }

  const noteY = y0 + secH + 40;
  const stationTitle = st ? `Station x=${fmt(st.x,3)} m · ${scheduledLocal?.zoneName || `Shear zone ${local.zone}`} · U=${fmt(scheduledLocal?.shearRatio ?? local.shearRatio,2)}` : "Selected section";
  const localLine = local ? `Local req: beam Av=${fmt(local.beamAvReqPerM,0)} mm²/m · interface Av=${fmt(local.interfaceAvReqPerM,0)} mm²/m · add=${fmt(local.addReq,0)} mm²/m` : "";
  $("crossSection").innerHTML = `<svg viewBox="0 0 ${w} ${hSvg}" role="img" aria-label="Cross-section reinforcement drawn to scale">
    <text x="${x0}" y="24" font-size="17" font-weight="850">Cross-section</text>
    <text x="${x0}" y="43" font-size="12" fill="#2d3b4d">${stationTitle}</text>
    <text x="${x0}" y="59" font-size="11" fill="#667587">b=${fmt(r.inputs.b,0)} mm, h=${fmt(r.inputs.h,0)} mm</text>
    <rect x="${x0}" y="${y0}" width="${secW}" height="${secH}" fill="#edf2f7" stroke="#4a5568" stroke-width="1.6"/>
    <rect x="${x0}" y="${y0}" width="${secW}" height="${slabH}" fill="#dce9f8" stroke="#4a5568" stroke-width="1.0"/>
    <line x1="${x0}" y1="${y0 + slabH}" x2="${x0 + secW}" y2="${y0 + slabH}" stroke="#b26a00" stroke-width="2.4" stroke-dasharray="7 6"/>
    ${legs}
    <rect x="${innerX0}" y="${innerY0}" width="${innerX1 - innerX0}" height="${innerY1 - innerY0}" rx="7" fill="none" stroke="#2a5caa" stroke-width="${Math.max(1.5, stirrupW)}"/>
    ${dowels}
    ${bars}
    <line x1="${x0}" y1="${y0 - 13}" x2="${x0 + secW}" y2="${y0 - 13}" stroke="#8091a5"/>
    <line x1="${x0}" y1="${y0 - 18}" x2="${x0}" y2="${y0 - 8}" stroke="#8091a5"/>
    <line x1="${x0 + secW}" y1="${y0 - 18}" x2="${x0 + secW}" y2="${y0 - 8}" stroke="#8091a5"/>
    <text x="${x0 + secW/2}" y="${y0 - 19}" text-anchor="middle" font-size="10.5">b</text>
    <line x1="${x0 - 20}" y1="${y0}" x2="${x0 - 20}" y2="${y0 + secH}" stroke="#8091a5"/>
    <line x1="${x0 - 26}" y1="${y0}" x2="${x0 - 14}" y2="${y0}" stroke="#8091a5"/>
    <line x1="${x0 - 26}" y1="${y0 + secH}" x2="${x0 - 14}" y2="${y0 + secH}" stroke="#8091a5"/>
    <text x="${x0 - 30}" y="${y0 + secH/2}" transform="rotate(-90 ${x0 - 30} ${y0 + secH/2})" font-size="10.5" text-anchor="middle">h</text>
    <text x="${x0}" y="${noteY}" font-size="12" fill="#2d3b4d"><tspan font-weight="800">Second slab:</tspan> t=${fmt(r.inputs.slabDepth,0)} mm · <tspan fill="#6b4600" font-weight="800">roughened interface</tspan></text>
    <text x="${x0}" y="${noteY + 21}" font-size="12" fill="#2a5caa">Primary: ${fmt(zoneStirrupLegs,0)} legs ${zoneStirrupBar} @ ${fmt(zonePrimarySpacing,0)} mm${zone ? ` (${zone.name})` : ``}</text>
    <text x="${x0}" y="${noteY + 42}" font-size="12" fill="#b3261e">Add: ${zoneDowelLegs > 0 && zoneDowelSpacing ? `${fmt(zoneDowelLegs,0)} legs ${zoneDowelBar} @ ${fmt(zoneDowelSpacing,0)} mm` : `None`}</text>
    <text x="${x0}" y="${noteY + 63}" font-size="12" fill="#1f2937">Bottom: ${fmt(r.inputs.mainCount,0)}-${r.inputs.mainBar}; ${bottomRows} row${bottomRows>1?'s':''}; d=${fmt(r.section.dBottom,0)} mm</text>
    <text x="${x0}" y="${noteY + 84}" font-size="12" fill="#374151">Top: ${fmt(r.inputs.topCount,0)}-${r.inputs.topBar}; ${topRows} row${topRows>1?'s':''}; d₋=${fmt(r.section.dTop,0)} mm</text>
    <text x="${x0}" y="${noteY + 105}" font-size="11" fill="#667587">${localLine}</text>
  </svg>`;
}
function renderCharts(r) {
  // Diagrams are now rendered once in the beam elevation panel so that demand
  // curves stay vertically aligned with the member geometry.
}

function drawChart(id, data, xKey, yKey, unit, abs) {
  const W = 640, H = 260, ml = 58, mr = 16, mt = 20, mb = 38;
  const pw = W - ml - mr, ph = H - mt - mb;
  const xs = data.map(d => d[xKey]);
  const ysRaw = data.map(d => abs ? Math.abs(d[yKey]) : d[yKey]);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  let ymin = Math.min(...ysRaw), ymax = Math.max(...ysRaw);
  if (Math.abs(ymax - ymin) < 1e-9) {
    ymax += 1;
    ymin -= abs ? 0 : 1;
  }
  if (!abs) {
    const m = Math.max(Math.abs(ymin), Math.abs(ymax));
    ymin = -m; ymax = m;
  } else {
    ymin = 0;
  }
  const sx = x => ml + ((x - xmin) / Math.max(1e-9, xmax - xmin)) * pw;
  const sy = y => mt + (1 - ((y - ymin) / Math.max(1e-9, ymax - ymin))) * ph;
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"} ${sx(d[xKey]).toFixed(2)} ${sy(abs ? Math.abs(d[yKey]) : d[yKey]).toFixed(2)}`).join(" ");
  const zeroY = sy(0);
  $(id).innerHTML = `<svg viewBox="0 0 ${W} ${H}">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>
    <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ph}" stroke="#c7d1dc"/>
    <line x1="${ml}" y1="${mt + ph}" x2="${ml + pw}" y2="${mt + ph}" stroke="#c7d1dc"/>
    ${!abs ? `<line x1="${ml}" y1="${zeroY}" x2="${ml + pw}" y2="${zeroY}" stroke="#dbe3ec" stroke-dasharray="4 4"/>` : ""}
    <path d="${path}" fill="none" stroke="#1f6feb" stroke-width="2.6"/>
    <text x="${ml}" y="14" font-size="11" fill="#667587">max ${fmt(Math.max(...ysRaw.map(Math.abs)),2)} ${unit}</text>
    <text x="${ml}" y="${H - 8}" font-size="11" fill="#667587">x, m</text>
    <text x="8" y="${mt + 8}" font-size="11" fill="#667587">${fmt(ymax,2)}</text>
    <text x="8" y="${mt + ph}" font-size="11" fill="#667587">${fmt(ymin,2)}</text>
  </svg>`;
}

function renderTable(r) {
  const tbody = $("stationTable").querySelector("tbody");
  const maxRows = 220;
  const step = Math.max(1, Math.floor(r.stations.length / maxRows));
  tbody.innerHTML = r.stations.filter((_, i) => i % step === 0 || i === r.stations.length - 1).map(s => `
    <tr>
      <td>${fmt(s.x, 3)}</td>
      <td>${fmt(s.V, 2)}</td>
      <td>${fmt(s.M, 2)}</td>
      <td>${fmt(s.qDesign, 2)}</td>
      <td>${fmt(s.vInterface, 4)}</td>
    </tr>
  `).join("");
}


function reportStatus(ok) {
  return ok ? "OK" : "NG";
}

function reportStatusHtml(ok) {
  return `<span class="report-status ${ok ? "ok" : "ng"}">${reportStatus(ok)}</span>`;
}

function reportText(html) {
  return { type: "text", html };
}

function reportNote(html) {
  return { type: "note", html };
}

function reportFormula(html) {
  return { type: "formula", html };
}

function reportResult(html, ok = null) {
  return { type: "result", html, ok };
}

function reportTable(headers, rows) {
  return { type: "table", headers, rows };
}

function reportFigure(svg, caption = "") {
  return { type: "figure", svg, caption };
}

function ffrac(num, den) {
  return `<span class="frac"><span>${num}</span><span>${den}</span></span>`;
}

function sub(name, suffix) {
  return `${name}<sub>${suffix}</sub>`;
}

function maxStationBy(r, key) {
  return r.stations.reduce((best, st) => Math.abs(st[key]) > Math.abs(best[key]) ? st : best, r.stations[0]);
}

function maxStationByValue(r, fn) {
  return r.stations.reduce((best, st) => fn(st) > fn(best) ? st : best, r.stations[0]);
}

function rangeText(ranges) {
  return (ranges || []).map(rg => `${fmt(rg.x1,2)}–${fmt(rg.x2,2)} m`).join("; ");
}


function sectionGeometryFigure(r) {
  const i = r.inputs;
  const sec = r.section;
  const W = 640, H = 290;
  const x = 110, y = 40, bw = 290, bh = 180;
  const slabH = Math.max(28, bh * (sec.slabDepth / Math.max(1, i.h)));
  const jointY = y + slabH;
  const naY = y + bh * (sec.neutralAxisFromTop / Math.max(1, i.h));
  const slabCy = y + slabH / 2;
  const dimColor = '#7b8ba1';
  const steelBlue = '#4f83c2';
  const outline = '#49617c';
  const accent = '#b26a00';
  const red = '#a12b2b';
  const qx1 = 515, qx2 = 595;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Section geometry sketch for interface shear calculations">
    <defs>
      <marker id="arrowGrey" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="#66788f"/>
      </marker>
      <marker id="arrowBrown2" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="${accent}"/>
      </marker>
    </defs>

    <rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="#edf2f7" stroke="${outline}" stroke-width="2"/>
    <rect x="${x}" y="${y}" width="${bw}" height="${slabH}" fill="#dfe9f5" stroke="none"/>
    <rect x="${x+24}" y="${y+14}" width="${bw-48}" height="${Math.max(18, slabH-26)}" fill="rgba(255,255,255,0.30)" stroke="${accent}" stroke-width="1.6"/>

    <line x1="${x}" y1="${jointY}" x2="${x+bw}" y2="${jointY}" stroke="${accent}" stroke-width="2.4" stroke-dasharray="8 6"/>
    <text x="${x+10}" y="${jointY-8}" font-size="13" fill="#6a4700" font-weight="600">cold joint / interface</text>

    <line x1="${x-38}" y1="${y}" x2="${x-38}" y2="${y+bh}" stroke="${dimColor}" stroke-width="1.5"/>
    <line x1="${x-48}" y1="${y}" x2="${x-28}" y2="${y}" stroke="${dimColor}" stroke-width="1.5"/>
    <line x1="${x-48}" y1="${y+bh}" x2="${x-28}" y2="${y+bh}" stroke="${dimColor}" stroke-width="1.5"/>
    <text x="${x-60}" y="${y + bh/2}" transform="rotate(-90 ${x-60} ${y + bh/2})" font-size="18" fill="#22313f" text-anchor="middle">h</text>

    <line x1="${x}" y1="${y-28}" x2="${x+bw}" y2="${y-28}" stroke="${dimColor}" stroke-width="1.5"/>
    <line x1="${x}" y1="${y-37}" x2="${x}" y2="${y-19}" stroke="${dimColor}" stroke-width="1.5"/>
    <line x1="${x+bw}" y1="${y-37}" x2="${x+bw}" y2="${y-19}" stroke="${dimColor}" stroke-width="1.5"/>
    <text x="${x+bw/2}" y="${y-34}" font-size="18" fill="#22313f" text-anchor="middle">b</text>

    <line x1="${x+bw+24}" y1="${y}" x2="${x+bw+24}" y2="${jointY}" stroke="${dimColor}" stroke-width="1.5"/>
    <line x1="${x+bw+14}" y1="${y}" x2="${x+bw+34}" y2="${y}" stroke="${dimColor}" stroke-width="1.5"/>
    <line x1="${x+bw+14}" y1="${jointY}" x2="${x+bw+34}" y2="${jointY}" stroke="${dimColor}" stroke-width="1.5"/>
    <text x="${x+bw+42}" y="${y + slabH/2 + 6}" font-size="18" fill="#22313f">t</text>

    <line x1="${x-16}" y1="${naY}" x2="${x+bw+8}" y2="${naY}" stroke="${red}" stroke-width="1.7" stroke-dasharray="6 5"/>
    <text x="${x+bw+18}" y="${naY-4}" font-size="16" fill="${red}">gross NA at ȳ</text>

    <text x="${x+34}" y="${y+34}" font-size="18" fill="#6a4700">A<tspan baseline-shift="sub" font-size="12">slab</tspan> = b·t</text>

    <line x1="${x+bw/2}" y1="${slabCy+2}" x2="${x+bw/2}" y2="${naY-4}" stroke="#66788f" stroke-width="1.8" marker-end="url(#arrowGrey)"/>
    <text x="${x+bw/2 + 12}" y="${(slabCy + naY)/2 + 6}" font-size="18" fill="#22313f">Q = A<tspan baseline-shift="sub" font-size="12">above</tspan>(ȳ − y<tspan baseline-shift="sub" font-size="12">above</tspan>)</text>

    <line x1="${qx1}" y1="${jointY}" x2="${qx2}" y2="${jointY}" stroke="${accent}" stroke-width="3" marker-end="url(#arrowBrown2)"/>
    <text x="${qx2+8}" y="${jointY+6}" font-size="18" fill="#22313f">q along interface</text>
  </svg>`;
}

function demandFigure(r) {
  const i = r.inputs;
  const L = beamLength(i);
  const w = 470, h = 180, x0 = 40, y0 = 88, bw = 380;
  const jointY = y0 - 10;
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Beam demand sketch">
    <line x1="${x0}" y1="${y0}" x2="${x0 + bw}" y2="${y0}" stroke="#5f6f82" stroke-width="5"/>
    <line x1="${x0}" y1="${jointY}" x2="${x0 + bw}" y2="${jointY}" stroke="#b26a00" stroke-width="2.2" stroke-dasharray="7 5"/>
    <polygon points="${x0},${y0+4} ${x0-14},${y0+28} ${x0+14},${y0+28}" fill="#d9e2ec" stroke="#334e68"/>
    <polygon points="${x0+bw},${y0+4} ${x0+bw-14},${y0+28} ${x0+bw+14},${y0+28}" fill="#d9e2ec" stroke="#334e68"/>
    ${Array.from({length:9},(_,k)=>{const x=x0+bw*(k/8); return `<line x1="${x}" y1="24" x2="${x}" y2="${jointY-6}" stroke="#1f6feb" marker-end="url(#arrowBlue2)"/>`;}).join('')}
    <text x="${x0+2}" y="18" font-size="11" fill="#1f6feb">Wf</text>
    <text x="${x0+bw/2}" y="${y0+52}" font-size="11" text-anchor="middle">span L</text>
    <path d="M${x0+12},${y0-34} Q${x0+bw/2},${y0-92} ${x0+bw-12},${y0-34}" fill="none" stroke="#1f6feb" stroke-width="2.5"/>
    <text x="${x0+bw/2}" y="${y0-96}" font-size="11" text-anchor="middle">Mf envelope</text>
    <path d="M${x0},${y0+38} L${x0+bw},${y0+76}" fill="none" stroke="#1f6feb" stroke-width="2.5"/>
    <text x="${x0+bw-8}" y="${y0+74}" font-size="11" text-anchor="end">Vf envelope</text>
    <text x="${x0+150}" y="${jointY-14}" font-size="11" fill="#6b4600">interface shear demand q and stress v = q/b</text>
    <defs><marker id="arrowBlue2" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#1f6feb"/></marker></defs>
  </svg>`;
}

function shearTrussFigure(r) {
  return `<svg viewBox="0 0 470 175" role="img" aria-label="Vertical shear truss analogy sketch">
    <rect x="45" y="42" width="350" height="88" fill="#edf2f7" stroke="#4a5568"/>
    <path d="M70 115 L120 57 L170 115 L220 57 L270 115 L320 57" fill="none" stroke="#2a5caa" stroke-width="2.5"/>
    <line x1="70" y1="50" x2="70" y2="122" stroke="#b3261e" stroke-width="3"/>
    <line x1="170" y1="50" x2="170" y2="122" stroke="#b3261e" stroke-width="3"/>
    <line x1="270" y1="50" x2="270" y2="122" stroke="#b3261e" stroke-width="3"/>
    <text x="53" y="28" font-size="11">Concrete compression field at angle θ</text>
    <text x="297" y="77" font-size="11" fill="#b3261e">Stirrups provide V_s</text>
    <text x="53" y="147" font-size="11">Concrete provides V_c</text>
    <text x="55" y="165" font-size="11">Check: V_r = V_c + V_s ≥ V_f</text>
  </svg>`;
}

function interfaceFrictionFigure(r) {
  return `<svg viewBox="0 0 470 185" role="img" aria-label="Interface shear-friction concept sketch">
    <rect x="55" y="28" width="320" height="34" fill="#dce9f8" stroke="#49617c"/>
    <rect x="55" y="62" width="320" height="74" fill="#edf2f7" stroke="#49617c"/>
    <line x1="55" y1="62" x2="375" y2="62" stroke="#b26a00" stroke-width="2.4" stroke-dasharray="7 5"/>
    <line x1="120" y1="14" x2="120" y2="107" stroke="#b3261e" stroke-width="3"/>
    <line x1="210" y1="14" x2="210" y2="107" stroke="#b3261e" stroke-width="3"/>
    <line x1="300" y1="14" x2="300" y2="107" stroke="#b3261e" stroke-width="3"/>
    <line x1="88" y1="47" x2="152" y2="47" stroke="#b26a00" stroke-width="2.4" marker-end="url(#arrowBrown)"/>
    <text x="156" y="51" font-size="11">interface demand q</text>
    <text x="389" y="64" font-size="11">roughened cold joint</text>
    <text x="389" y="92" font-size="11">crossing steel ratio ρ_v</text>
    <text x="389" y="110" font-size="11">resistance v_r = λϕ_c(c + μρ_v f_y)</text>
    <defs><marker id="arrowBrown" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#b26a00"/></marker></defs>
  </svg>`;
}


function buildCalculationReportSections(r) {
  const i = r.inputs;
  const sec = r.section;
  const s = r.summary;
  const main = rebar(i.mainBar);
  const topMain = rebar(i.topBar || i.mainBar);
  const stirrup = rebar(i.stirrupBar);
  const dowel = rebar(i.dowelBar);
  const slabArea = sec.areaAboveInterface;
  const slabCentroid = sec.areaAboveCentroid;
  const na = sec.neutralAxisFromTop;
  const qModel = demandModelLabel(i.interfaceDemandModel);
  const reactions = r.fe.reactions.map((rx, idx) => `R<sub>${idx + 1}</sub> = ${fmt(rx.vertical, 2)} kN at x=${fmt(rx.x, 3)} m`).join("; ");
  const govV = maxStationBy(r, "V");
  const govM = maxStationBy(r, "M");
  const govQ = maxStationByValue(r, st => Math.abs(st.qDesign));
  const st = activeStation(r);
  const local = st ? localDesignForStation(r, st) : null;
  const govShearStation = s.zoneControlling?.station || s.baseControlling?.station || govV;
  const govShearV = Math.abs(govShearStation?.V ?? s.maxV);
  const beamReqPerMm = s.beamAvReqPerM / 1000;
  const primaryPerMm = s.stirrupAvPerM / 1000;
  const interfaceReqPerMm = s.interfaceAvReqPerM / 1000;
  const addReqPerMm = s.additionalInterfaceReq / 1000;
  const interfaceSteelBalanceOk = s.totalInterfaceAvailable >= s.interfaceAvReqPerM - 1e-9;
  const addedDowelOk = s.dowelAvPerM >= s.additionalInterfaceReq - 1e-9;
  const minLen = zoneMinimumLength(r);
  const qFormula = i.interfaceDemandModel === "cracked"
    ? `${sub("q", "f")} = ${ffrac("|V<sub>f</sub>| × 1000", "z")}`
    : i.interfaceDemandModel === "max"
      ? `${sub("q", "f")} = max(${ffrac("|V<sub>f</sub>| × 1000 × Q", "I<sub>g</sub>")}, ${ffrac("|V<sub>f</sub>| × 1000", "z")})`
      : `${sub("q", "f")} = ${ffrac("|V<sub>f</sub>| × 1000 × Q", "I<sub>g</sub>")}`;

  const zoneRows = (s.zoneSchedule || []).map(z => {
    const ev = z.gov || {};
    const zDowel = z.dowelSpacing && z.dowelLegs > 0 ? `${fmt(z.dowelLegs,0)} legs ${z.dowelBar} @ ${fmt(z.dowelSpacing,0)} mm` : "None";
    return [
      z.name,
      rangeText(z.ranges || [{ x1: z.x1, x2: z.x2 }]),
      `${fmt(z.length,2)} m`,
      `${fmt(z.stirrupLegs,0)} legs ${z.stirrupBar} @ ${fmt(z.primarySpacing,0)} mm`,
      zDowel,
      `${fmt(Math.abs(ev.station?.V ?? 0),1)} kN`,
      `${fmt(ev.beamRatio ?? 0,3)} / ${fmt(ev.interfaceRatio ?? 0,3)}`,
      reportStatus(z.ok)
    ];
  });

  const zoneCalcRows = (s.zoneSchedule || []).map(z => {
    const ev = z.gov || {};
    const rg = z.ranges || [{ x1: z.x1, x2: z.x2 }];
    const avPrimary = (z.stirrupLegs || 0) * rebar(z.stirrupBar).area / Math.max(1, z.primarySpacing) * 1000;
    const beamReq = ev.beamAvReqPerM ?? 0;
    const unused = i.allocation === "balance" ? Math.max(0, avPrimary - beamReq) : avPrimary;
    const dowelPerM = z.dowelSpacing && z.dowelLegs > 0 ? (z.dowelLegs || 0) * rebar(z.dowelBar).area / Math.max(1, z.dowelSpacing) * 1000 : 0;
    const available = unused + dowelPerM;
    const addReq = Math.max(0, (ev.interfaceAvReqPerM ?? 0) - unused);
    return [
      z.name,
      rangeText(rg),
      `${fmt(avPrimary,0)}`,
      `${fmt(beamReq,0)}`,
      `${fmt(unused,0)}`,
      `${fmt(ev.interfaceAvReqPerM ?? 0,0)}`,
      `${fmt(addReq,0)}`,
      `${fmt(dowelPerM,0)}`,
      `${fmt(available,0)}`
    ];
  });

  return [
    {
      title: "1. Calculation set and inputs",
      blocks: [
        reportText("<strong>What this calculation set does:</strong> starting from the selected beam system and factored loads, the app determines the governing beam actions, converts those actions into cold-joint interface demand, checks vertical beam shear and interface shear-transfer resistance, then develops a practical shear-zone schedule."),
        reportText("<strong>Calculation sequence:</strong> (1) define inputs and section geometry, (2) solve beam actions and interface demand, (3) check flexural reasonableness, (4) check vertical beam shear, spacing, and minimum steel, (5) check interface shear-transfer, (6) allocate crossing steel and determine added dowels if required, and (7) generate a consolidated zone schedule."),
        reportTable(["Item", "Value"], [
          ["Beam system", `${labelBeamSystem(i.beamSystem)}; L1=${fmt(i.L1,3)} m${i.beamSystem === "twoSpan" ? `; L2=${fmt(i.L2,3)} m` : ""}`],
          ["Factored loading", `Wf=${fmt(i.Wf,3)} kN/m${i.includePoint ? `; Pf=${fmt(i.Pf,3)} kN at x=${fmt(i.Px,3)} m` : "; no point load included"}`],
          ["Section", `${i.sectionModel}; b_w=${fmt(i.b,0)} mm; h=${fmt(i.h,0)} mm; second-placement depth t=${fmt(sec.slabDepth,0)} mm${i.sectionModel === "flanged" ? `; b_f=${fmt(sec.flangeWidth,0)} mm; t_f=${fmt(sec.flangeDepth,0)} mm` : ""}`],
          ["Code basis", `CSA A23.3:24 shear excerpt: Clauses 11.2.8, 11.3, and 11.5. Full anchorage/detailing still require engineering review.`],
          ["Materials", `f′c=${fmt(i.fc,2)} MPa; fy=${fmt(i.fy,0)} MPa; a_g=${fmt(i.ag,0)} mm; λ=${fmt(i.lambda,2)}; ϕc=${fmt(i.phiC,2)}; ϕs=${fmt(i.phiS,2)}`],
          ["Interface", `${interfaceConditionLabel(i.interfaceCondition)}; c=${fmt(i.cohesion,2)} MPa; μ=${fmt(i.mu,2)}; demand model=${qModel}`],
          ["Reinforcement basis", `Bottom steel ${fmt(i.mainCount,0)}-${i.mainBar} in ${fmt(i.bottomRows,0)} row${i.bottomRows > 1 ? "s" : ""}; top steel ${fmt(i.topCount,0)}-${i.topBar} in ${fmt(i.topRows,0)} row${i.topRows > 1 ? "s" : ""}; row spacing ${fmt(i.barRowSpacing,0)} mm; primary shear ${fmt(i.stirrupLegs,0)} legs ${i.stirrupBar}; additional dowel/hairpin ${fmt(i.dowelLegs,0)} legs ${i.dowelBar}`],
          ["Zone rules", `${i.zoneDesignMode}; spacing range ${fmt(i.zoneMinSpacing,0)}–${fmt(i.zoneMaxSpacing,0)} mm; minimum zone length = max(user input, 2d) = ${fmt(minLen,2)} m`]
        ]),
        reportNote("Variables are introduced and defined in the calculation steps where they are first used.")
      ]
    },
    {
      title: "2. Find the section geometry and compression block used for interface demand",
      blocks: [
        reportText("<strong>Purpose of this step:</strong> determine the geometric properties required to convert the beam shear force into horizontal shear flow on the cold joint, then calculate one flexural compression-block lever arm, z, for the cracked-force-flow demand option. The gross section properties are calculated from section components, so a rectangular section and an optional flanged/T-section use the same engine."),
        reportFigure(sectionGeometryFigure(r), "Section geometry sketch showing the cold joint, slab area above the interface, neutral axis, and the first-moment lever arm used for Q."),
        reportTable(["Variable", "Meaning", "Current value"], [
          ["b", "beam/interface width", `${fmt(i.b,0)} mm`],
          ["h", "total overall depth", `${fmt(i.h,0)} mm`],
          ["t", "second-placement slab depth above interface", `${fmt(sec.slabDepth,0)} mm`],
          ["ȳ", "gross-section neutral axis from top", `${fmt(na,1)} mm`],
          ["A_above", "area above interface from section components", `${fmt(slabArea,0)} mm²`],
          ["Q", "first moment of A_above about the gross neutral axis", `${fmt(sec.Q,0)} mm³`],
          ["I_g", "gross second moment of area", `${fmt(sec.Ig,0)} mm⁴`],
          ["d", "effective depth to centroid of bottom tension steel", `${fmt(sec.d,1)} mm`],
          ["bar rows", "longitudinal bar row layout used to calculate d", `bottom ${fmt(i.bottomRows,0)} row${i.bottomRows > 1 ? "s" : ""}; top ${fmt(i.topRows,0)} row${i.topRows > 1 ? "s" : ""}; row spacing ${fmt(i.barRowSpacing,0)} mm`],
          ["d_v", "effective shear depth", `${fmt(sec.dv,1)} mm`],
          ["z", "single lever arm used for cracked force-flow demand", `${fmt(sec.z,1)} mm (${sec.zSource})`]
        ]),
        reportText("The formulas below calculate those geometry terms step by step."),
        reportFormula(`I<sub>g</sub> = Σ(I<sub>component</sub> + AΔy²)`),
        reportResult(`I<sub>g</sub> = ${fmt(sec.Ig,0)} mm<sup>4</sup>; gross area = ${fmt(sec.area,0)} mm²`),
        reportFormula(`ȳ = ${ffrac("ΣAy", "ΣA")}`),
        reportResult(`ȳ = ${fmt(na,1)} mm from top`),
        reportFormula(`A<sub>above</sub> = area of all section components above the cold-joint elevation`),
        reportResult(`A<sub>above</sub> = ${fmt(slabArea,0)} mm<sup>2</sup>; y<sub>above</sub> = ${fmt(slabCentroid,1)} mm`),
        reportFormula(`Q = A<sub>above</sub>(ȳ - y<sub>above</sub>) = ${fmt(slabArea,0)}(${fmt(na,1)} - ${fmt(slabCentroid,1)})`),
        reportResult(`Q = ${fmt(sec.Q,0)} mm<sup>3</sup>`),
        reportFormula(`Bottom steel centroid from bottom face = cover + d<sub>b,stirrup</sub> + d<sub>b,main</sub>/2 + (rows - 1)s<sub>row</sub>/2`),
        reportFormula(`y<sub>s,bottom</sub> = ${fmt(i.cover,0)} + ${fmt(stirrup.diameter,1)} + ${fmt(main.diameter,1)}/2 + (${fmt(i.bottomRows,0)} - 1)${fmt(i.barRowSpacing,0)}/2 = ${fmt(sec.bottomCentroidFromBottom,1)} mm`),
        reportFormula(`d = h - y<sub>s,bottom</sub> = ${fmt(i.h,0)} - ${fmt(sec.bottomCentroidFromBottom,1)}`),
        reportResult(`d = ${fmt(sec.d,1)} mm`),
        reportFormula(`d<sub>v</sub> = max(0.9d, 0.72h) = max(${fmt(0.9*sec.d,1)}, ${fmt(0.72*i.h,1)})`),
        reportResult(`d<sub>v</sub> = ${fmt(sec.dv,1)} mm`),
        reportText("Compression-block calculation for the cracked force-flow lever arm:"),
        reportFormula(`T = ϕ<sub>s</sub>A<sub>s</sub>f<sub>y</sub> = ${fmt(i.phiS,2)}(${fmt(sec.zBlock?.As || 0,0)})(${fmt(i.fy,0)}) = ${fmt((i.phiS * (sec.zBlock?.As || 0) * i.fy)/1000,1)} kN`),
        reportFormula(`Solve a such that C = α<sub>1</sub>ϕ<sub>c</sub>f′<sub>c</sub>A<sub>comp</sub>(a) = T`),
        reportResult(`α<sub>1</sub> = ${fmt(sec.zBlock?.alpha1 || 0,3)}; β<sub>1</sub> = ${fmt(sec.zBlock?.beta1 || 0,3)}; a = ${fmt(sec.zBlock?.a || 0,1)} mm; c = a/β<sub>1</sub> = ${fmt(sec.zBlock?.c || 0,1)} mm`),
        reportFormula(`z = d - y<sub>C</sub>, where y<sub>C</sub> is the compression-resultant centroid from the compression face`),
        reportResult(`y<sub>C</sub> = ${fmt(sec.zBlock?.compressionCentroid || 0,1)} mm; z = ${fmt(sec.z,1)} mm`)
      ]
    },
    {
      title: "3. Find the beam actions and convert them to cold-joint demand",
      blocks: [
        reportText("<strong>Purpose of this step:</strong> solve the beam for the factored shear and moment envelopes, then convert the governing vertical shear into horizontal shear flow demand on the cold joint. The beam solver determines V_f and M_f along the span; the interface-demand model then converts V_f into q and v."),
        reportTable(["Variable", "Meaning", "Governing value"], [
          ["V_f", "factored beam shear", `${fmt(s.maxV,2)} kN at x≈${fmt(govV.x,3)} m`],
          ["M_f", "factored bending moment", `${fmt(s.maxMabs,2)} kN·m at x≈${fmt(govM.x,3)} m`],
          ["q_elastic", "interface shear flow from VQ/I", `${fmt(govQ.qElastic,2)} kN/m`],
          ["q_cracked", "cracked force-flow demand |V|/z", `${fmt(govQ.qCracked,2)} kN/m`],
          ["q_design", "selected governing interface demand", `${fmt(govQ.qDesign,2)} kN/m at x≈${fmt(govQ.x,3)} m`],
          ["v_f", "interface stress = q_design/b", `${fmt(s.maxStress,4)} MPa`]
        ]),
        reportText("For the rightmost station, the internal action is evaluated just inside the support so the plotted and reported shear does not artificially return to zero at the support node."),
        reportResult(reactions || "No support reactions reported"),
        reportFormula(`max |V<sub>f</sub>| = ${fmt(s.maxV,2)} kN at approximately x = ${fmt(govV.x,3)} m`),
        reportFormula(`max |M<sub>f</sub>| = ${fmt(s.maxMabs,2)} kN·m at approximately x = ${fmt(govM.x,3)} m`),
        reportText("The interface demand model selected in the app is used as follows."),
        reportFormula(qFormula),
        reportFormula(`At governing interface station x = ${fmt(govQ.x,3)} m: q<sub>elastic</sub> = ${fmt(govQ.qElastic,2)} kN/m; q<sub>cracked</sub> = ${fmt(govQ.qCracked,2)} kN/m; q<sub>design</sub> = ${fmt(govQ.qDesign,2)} kN/m`),
        reportFormula(`v<sub>f</sub> = ${ffrac("q<sub>design</sub>", "b")} = ${ffrac(fmt(s.maxQ,2), fmt(i.b,0))}`),
        reportResult(`v<sub>f</sub> = ${fmt(s.maxStress,4)} MPa`)
      ]
    },
    {
      title: "4. Check sign-aware flexural reasonableness",
      blocks: [
        reportText("<strong>Purpose of this step:</strong> estimate whether the selected longitudinal steel is reasonable for the moment signs produced by the selected beam model. Positive sagging moment uses bottom steel; negative hogging moment uses top steel. This remains a simplified flexural reasonableness check, not a full flexural design module."),
        reportTable(["Variable", "Meaning", "Current value"], [
          ["A_s,bottom", "bottom longitudinal steel for positive moment", `${fmt(sec.AsBottom,0)} mm² (${fmt(i.mainCount,0)}-${i.mainBar})`],
          ["A_s,top", "top longitudinal steel for negative moment", `${fmt(sec.AsTop,0)} mm² (${fmt(i.topCount,0)}-${i.topBar})`],
          ["M_f,+", "maximum sagging moment", `${fmt(s.flex.posDemand,2)} kN·m`],
          ["M_f,-", "maximum hogging moment demand", `${fmt(s.flex.negDemand,2)} kN·m`],
          ["M_r,+", "estimated positive moment resistance", `${fmt(s.flex.pos.Mr,2)} kN·m`],
          ["M_r,-", "estimated negative moment resistance", s.flex.neg.available ? `${fmt(s.flex.neg.Mr,2)} kN·m` : "not available — no top steel"]
        ]),
        reportFormula(`Positive flexure: a<sub>+</sub> = ${fmt(s.flex.pos.a,1)} mm; z<sub>+</sub> = ${fmt(s.flex.pos.z,1)} mm; M<sub>r,+</sub> = ϕ<sub>s</sub>A<sub>s,bottom</sub>f<sub>y</sub>z<sub>+</sub> = ${fmt(s.flex.pos.Mr,2)} kN·m`),
        reportFormula(s.flex.neg.available ? `Negative flexure: a<sub>-</sub> = ${fmt(s.flex.neg.a,1)} mm; z<sub>-</sub> = ${fmt(s.flex.neg.z,1)} mm; M<sub>r,-</sub> = ϕ<sub>s</sub>A<sub>s,top</sub>f<sub>y</sub>z<sub>-</sub> = ${fmt(s.flex.neg.Mr,2)} kN·m` : `Negative flexure: top steel count = ${fmt(i.topCount,0)}, so hogging-moment capacity is not available.`),
        reportFormula(`${ffrac("M<sub>f,+</sub>", "M<sub>r,+</sub>")} = ${fmt(s.flex.posRatio,3)}; ${ffrac("M<sub>f,-</sub>", "M<sub>r,-</sub>")} = ${fmt(s.flex.negRatio,3)}`),
        reportResult(`Governing flexural utilization = ${fmt(s.flexRatio,3)} → ${reportStatusHtml(s.flexUtilizationOk)}`, s.flexUtilizationOk),
        ...(!s.flex.negChecked ? [reportNote("Negative bending is present, but no top longitudinal steel is defined. Add top steel or treat the flexural check as incomplete.")] : [])
      ]
    },
    {
      title: "5. Check vertical beam shear strength — CSA A23.3:24 Clause 11.3",
      blocks: [
        reportText("<strong>Purpose of this step:</strong> verify that the selected stirrup arrangement provides sufficient vertical beam shear resistance using the CSA A23.3:24 shear expressions from Clause 11.3. The app includes no prestress term Vp and no torsion resistance in this workflow."),
        reportTable(["Variable", "Clause reference / meaning", "Current value"], [
          ["Design requirement", "Clause 11.3.1 Eq. 11.3: V_r ≥ V_f", `governing |V_f|=${fmt(govShearV,2)} kN`],
          ["V_r expression", "Clause 11.3.3 Eq. 11.4 and Eq. 11.5", `V_r=min(V_c+V_s, V_r,max)`],
          ["β", s.betaBasis || "Clause 11.3.6", `${fmt(s.beta,3)}`],
          ["θ", s.thetaBasis || "Clause 11.3.6", `${fmt(s.thetaDeg,1)}°`],
          ["ε_x", "Clause 11.3.6.4 Eq. 11.13, general method only", i.shearMethod === "general" ? `${fmt(s.epsilonX,6)}` : "not used"],
          ["s_ze", "Clause 11.3.6.4 Eq. 11.11 / Eq. 11.10", Number.isFinite(s.sze) ? `${fmt(s.sze,1)} mm` : "not used"],
          ["√f′c used", "Clause 11.3.4: √f′c shall not be taken greater than 8 MPa", `${fmt(s.sqrtFcEff,3)}${s.sqrtFcRaw > 8 ? ` (raw ${fmt(s.sqrtFcRaw,3)} capped)` : ""}`],
          ["V_c", "Clause 11.3.4 Eq. 11.6", `${fmt(s.Vc,2)} kN`],
          ["V_s", "Clause 11.3.5.1 Eq. 11.7 for transverse reinforcement perpendicular to member axis", `${fmt(s.Vs,2)} kN`],
          ["V_r", "governing vertical shear resistance", `${fmt(s.Vr,2)} kN`]
        ]),
        ...(i.shearMethod === "general" ? [
          reportFormula(`ε<sub>x</sub> = ${ffrac("max(M<sub>f</sub>/d<sub>v</sub>, V<sub>f</sub>) + V<sub>f</sub>", "2E<sub>s</sub>A<sub>s</sub>")} = ${fmt(s.epsilonX,6)} &nbsp; <span class="clause-ref">CSA A23.3:24 11.3.6.4 Eq. 11.13, with V<sub>p</sub>=0 and no axial/prestress terms</span>`),
          reportFormula(`β = ${ffrac("0.40", "1 + 1500ε<sub>x</sub>")} ${ffrac("1300", "1000 + s<sub>ze</sub>")} ≥ 0.05 = ${fmt(s.beta,3)} &nbsp; <span class="clause-ref">Eq. 11.11</span>`),
          reportFormula(`θ = 29 + 7000ε<sub>x</sub> = ${fmt(s.thetaDeg,1)}° &nbsp; <span class="clause-ref">Eq. 11.12</span>`)
        ] : [
          reportFormula(`${s.betaBasis || "Simplified-method β basis not reported"}`),
          reportFormula(`θ = 35° &nbsp; <span class="clause-ref">CSA A23.3:24 Clause 11.3.6.3 simplified method</span>`)
        ]),
        reportFormula(`V<sub>c</sub> = ${ffrac("ϕ<sub>c</sub>λβ√f′<sub>c</sub>b<sub>w</sub>d<sub>v</sub>", "1000")} = ${ffrac(`${fmt(i.phiC,2)}(${fmt(i.lambda,2)})(${fmt(s.beta,3)})(${fmt(s.sqrtFcEff,3)})(${fmt(i.b,0)})(${fmt(sec.dv,1)})`, "1000")} &nbsp; <span class="clause-ref">Eq. 11.6</span>`),
        reportResult(`V<sub>c</sub> = ${fmt(s.Vc,2)} kN`),
        reportFormula(`V<sub>s</sub> = ${ffrac("ϕ<sub>s</sub>A<sub>v</sub>f<sub>yt</sub>d<sub>v</sub>cotθ", "s")} &nbsp; <span class="clause-ref">Eq. 11.7</span>`),
        reportFormula(`${ffrac("A<sub>v</sub>", "s")}<sub>beam req</sub> = max[0, ${ffrac("(V<sub>f</sub> - V<sub>c</sub>)1000", "ϕ<sub>s</sub>f<sub>yt</sub>d<sub>v</sub>cotθ")}] = ${fmt(beamReqPerMm,3)} mm<sup>2</sup>/mm`),
        reportResult(`${ffrac("A<sub>v</sub>", "s")}<sub>beam req</sub> = ${fmt(s.beamAvReqPerM,0)} mm<sup>2</sup>/m`),
        reportFormula(`A<sub>v,set</sub> = ${fmt(i.stirrupLegs,0)}(${fmt(stirrup.area,0)}) = ${fmt(s.stirrupAvSet,0)} mm<sup>2</sup>`),
        reportFormula(`${ffrac("A<sub>v</sub>", "s")}<sub>selected</sub> = ${ffrac(fmt(s.stirrupAvSet,0), fmt(i.stirrupSpacing,0))} = ${fmt(primaryPerMm,3)} mm<sup>2</sup>/mm = ${fmt(s.stirrupAvPerM,0)} mm<sup>2</sup>/m`),
        reportResult(`V<sub>s</sub> = ${fmt(s.Vs,2)} kN; V<sub>r,raw</sub> = V<sub>c</sub> + V<sub>s</sub> = ${fmt(s.VrRaw,2)} kN; design V<sub>r</sub> = min(V<sub>r,raw</sub>, V<sub>r,max</sub>) = ${fmt(s.Vr,2)} kN`),
        reportFormula(`V<sub>r,max</sub> = ${ffrac("0.25ϕ<sub>c</sub>f′<sub>c</sub>b<sub>w</sub>d<sub>v</sub>", "1000")} = ${fmt(s.VrMax,2)} kN &nbsp; <span class="clause-ref">Eq. 11.5</span>`),
        reportResult(`Vertical shear strength check: V<sub>r</sub> ${s.Vr >= govShearV ? "≥" : "<"} V<sub>f</sub> → ${reportStatusHtml(s.verticalStrengthOk)}`, s.verticalStrengthOk),
        ...(s.shearWarnings || []).map(w => reportNote(w))
      ]
    },
    {
      title: "6. Check stirrup spacing and minimum shear steel — CSA A23.3:24 Clauses 11.2.8 and 11.3.8",
      blocks: [
        reportText("<strong>Purpose of this step:</strong> check the CSA minimum shear-reinforcement requirement and the maximum spacing limits. The final zone schedule repeats these checks locally using each zone spacing."),
        reportTable(["Variable", "Clause reference / meaning", "Current value"], [
          ["Minimum shear steel required?", "Clause 11.2.8.1: required where V_f > V_c + V_p, or for beams with h > 750 mm", s.minSteelRequired ? "yes" : "no at governing station"],
          ["A_v,min", "Clause 11.2.8.2 Eq. 11.1", `${fmt(s.AvMin,1)} mm² per stirrup set at selected spacing`],
          ["A_v,set", "provided area in one selected stirrup set", `${fmt(s.stirrupAvSet,1)} mm²`],
          ["V_threshold", "Clause 11.3.8.3 threshold for half-spacing rule", `${fmt(s.highShearThreshold,2)} kN`],
          ["s_max", "Clause 11.3.8.1 or 11.3.8.3", `${fmt(s.sMax,1)} mm`]
        ]),
        reportFormula(`A<sub>v,min</sub> = ${ffrac("0.06√f′<sub>c</sub>b<sub>w</sub>s", "f<sub>yt</sub>")} = ${ffrac(`0.06(${fmt(s.sqrtFcRaw,3)})(${fmt(i.b,0)})(${fmt(i.stirrupSpacing,0)})`, fmt(i.fy,0))} &nbsp; <span class="clause-ref">Eq. 11.1</span>`),
        reportResult(`A<sub>v,min</sub> = ${fmt(s.AvMin,1)} mm<sup>2</sup>; provided A<sub>v,set</sub> = ${fmt(s.stirrupAvSet,1)} mm<sup>2</sup> → ${reportStatusHtml(s.minSteelOk)}`, s.minSteelOk),
        reportFormula(`V<sub>threshold</sub> = ${ffrac("0.125λϕ<sub>c</sub>f′<sub>c</sub>b<sub>w</sub>d<sub>v</sub>", "1000")} = ${fmt(s.highShearThreshold,2)} kN &nbsp; <span class="clause-ref">Clause 11.3.8.3, with V<sub>p</sub>=0</span>`),
        reportFormula(`If above threshold: s ≤ min(0.35d<sub>v</sub>, 300) = min(${fmt(0.35*sec.dv,1)}, 300). Otherwise: s ≤ min(0.70d<sub>v</sub>, 600) = min(${fmt(0.70*sec.dv,1)}, 600).`),
        reportResult(`Global governing s<sub>max</sub> = ${fmt(s.sMax,1)} mm; selected input s = ${fmt(i.stirrupSpacing,0)} mm → ${reportStatusHtml(s.verticalSpacingOk)}`, s.verticalSpacingOk),
        reportNote("Clause 11.3.8.4 transverse spacing across the member width is not yet checked because the app does not model individual leg positions across b_w. Include this in the later detailing review.")
      ]
    },
    {
      title: "7. Find the cold-joint interface shear-transfer reinforcement required — CSA A23.3:24 Clause 11.5",
      blocks: [
        reportText("<strong>Purpose of this step:</strong> determine how much reinforcement must cross the cold joint so the interface can transfer the required horizontal shear flow. The current implementation assumes reinforcement crossing a horizontal interface at α_f = 90°, with no permanent normal force N/Ag, so Eq. 11.25 reduces to the familiar cohesion-plus-friction form."),
        reportTable(["Variable", "Clause reference / meaning", "Current value"], [
          ["Interface condition", "Clause 11.5.2 values of c and μ", `${interfaceConditionLabel(i.interfaceCondition)}`],
          ["c", "cohesion factor", `${fmt(i.cohesion,2)} MPa`],
          ["μ", "friction coefficient", `${fmt(i.mu,2)}`],
          ["α_f", "angle between shear-friction reinforcement and shear plane", `90° assumed`],
          ["N/A_g", "permanent normal stress, compression positive", `0 MPa assumed`],
          ["ρ_v,req", "required ratio of reinforcement crossing the interface", `${fmt(s.rhoReq,6)}`],
          ["(A_v/s)_interface req", "required crossing steel per unit length", `${fmt(s.interfaceAvReqPerM,0)} mm²/m`],
          ["v_limit", "upper concrete-interface stress limit", `${fmt(s.concreteLimit,3)} MPa`]
        ]),
        reportFormula(`v<sub>r</sub> = λϕ<sub>c</sub>(c + μσ) + ϕ<sub>s</sub>ρ<sub>v</sub>f<sub>y</sub>cosα<sub>f</sub> &nbsp; <span class="clause-ref">Eq. 11.25</span>`),
        reportFormula(`σ = ρ<sub>v</sub>f<sub>y</sub>sinα<sub>f</sub> + ${ffrac("N", "A<sub>g</sub>")} ; &nbsp; ρ<sub>v</sub> = ${ffrac("A<sub>vf</sub>", "A<sub>cv</sub>")} &nbsp; <span class="clause-ref">Eq. 11.27 and Eq. 11.28</span>`),
        reportText(`With α<sub>f</sub>=90° and N/A<sub>g</sub>=0, the app uses v<sub>r</sub> = λϕ<sub>c</sub>(c + μρ<sub>v</sub>f<sub>y</sub>). Selected coefficients: c=${fmt(i.cohesion,2)} MPa and μ=${fmt(i.mu,2)}.`),
        reportFormula(`ρ<sub>v,req</sub> = ${ffrac("v<sub>f</sub>/(λϕ<sub>c</sub>) - c", "μf<sub>y</sub>")} = ${ffrac(`${fmt(s.maxStress,4)}/(${fmt(i.lambda,2)}×${fmt(i.phiC,2)}) - ${fmt(i.cohesion,2)}`, `${fmt(i.mu,2)}(${fmt(i.fy,0)})`)}`),
        reportResult(`ρ<sub>v,req</sub> = ${fmt(s.rhoReq,6)}`),
        reportFormula(`${ffrac("A<sub>v</sub>", "s")}<sub>interface req</sub> = ρ<sub>v,req</sub>b<sub>w</sub> = ${fmt(s.rhoReq,6)}(${fmt(i.b,0)})`),
        reportResult(`${ffrac("A<sub>v</sub>", "s")}<sub>interface req</sub> = ${fmt(interfaceReqPerMm,3)} mm<sup>2</sup>/mm = ${fmt(s.interfaceAvReqPerM,0)} mm<sup>2</sup>/m`),
        reportFormula(`λϕ<sub>c</sub>(c + μσ) ≤ 0.25ϕ<sub>c</sub>f′<sub>c</sub> = 0.25(${fmt(i.phiC,2)})(${fmt(i.fc,1)}) = ${fmt(s.concreteLimit,3)} MPa &nbsp; <span class="clause-ref">Eq. 11.25 limit</span>`),
        reportResult(`Demand v<sub>f</sub> = ${fmt(s.maxStress,4)} MPa → ${reportStatusHtml(s.maxStress <= s.concreteLimit)}`, s.maxStress <= s.concreteLimit),
        reportNote("Clause 11.5.6 requires shear-friction reinforcement to be anchored on each side of the shear plane so f_y can be developed. Anchorage/development is still reported as not checked in this app version.")
      ]
    },
    {
      title: "8. Determine required interface reinforcement, unused stirrup balance, and added dowels",
      blocks: [
        reportText("<strong>Purpose of this step:</strong> check the interface crossing-steel balance in the correct order: first find the required interface shear reinforcement, then subtract the portion of the primary stirrups already needed for vertical beam shear, then calculate the additional required interface steel, and finally compare that shortfall with the provided dowels/hairpins."),
        reportText(i.allocation === "balance"
          ? "The selected allocation method avoids double counting: primary stirrups are first assigned to vertical beam shear, and only the unused portion is credited to interface shear-transfer."
          : "The selected allocation method credits the full crossing stirrup steel to the interface check. The unused-balance lines are still shown for review, but the design is not using the conservative balance allocation."),
        reportTable(["Variable", "Meaning", "Current value"], [
          ["(A_v/s)_interface req", "required crossing steel from Calculation Set 7", `${fmt(s.interfaceAvReqPerM,0)} mm²/m`],
          ["(A_v/s)_prov,stirrups", "provided primary stirrup steel crossing the interface", `${fmt(s.stirrupAvPerM,0)} mm²/m`],
          ["(A_v/s)_beam req", "portion of primary stirrups required for vertical beam shear", `${fmt(s.beamAvReqPerM,0)} mm²/m`],
          ["(A_v/s)_unused", "primary stirrup balance available for interface clamping", `${fmt(s.unusedStirrupAv,0)} mm²/m`],
          ["(A_v/s)_add req", "required added dowel/hairpin steel after unused stirrup balance", `${fmt(s.additionalInterfaceReq,0)} mm²/m`],
          ["(A_v/s)_dowel", "provided added dowel/hairpin steel", `${fmt(s.dowelAvPerM,0)} mm²/m`],
          ["(A_v/s)_available", "unused stirrup balance plus dowels", `${fmt(s.totalInterfaceAvailable,0)} mm²/m`]
        ]),
        reportFormula(`${ffrac("A<sub>v</sub>", "s")}<sub>interface req</sub> = ${fmt(s.interfaceAvReqPerM,0)} mm<sup>2</sup>/m`),
        reportFormula(`${ffrac("A<sub>v</sub>", "s")}<sub>prov,stirrups</sub> = ${ffrac("A<sub>v,set</sub>", "s")} = ${ffrac(fmt(s.stirrupAvSet,0), fmt(i.stirrupSpacing,0))}`),
        reportResult(`${ffrac("A<sub>v</sub>", "s")}<sub>prov,stirrups</sub> = ${fmt(primaryPerMm,3)} mm<sup>2</sup>/mm = ${fmt(s.stirrupAvPerM,0)} mm<sup>2</sup>/m`),
        reportFormula(`${ffrac("A<sub>v</sub>", "s")}<sub>unused</sub> = max[0, ${ffrac("A<sub>v</sub>", "s")}<sub>prov,stirrups</sub> - ${ffrac("A<sub>v</sub>", "s")}<sub>beam req</sub>] = max[0, ${fmt(s.stirrupAvPerM,0)} - ${fmt(s.beamAvReqPerM,0)}]`),
        reportResult(`${ffrac("A<sub>v</sub>", "s")}<sub>unused</sub> = ${fmt(s.unusedStirrupAv,0)} mm<sup>2</sup>/m`),
        reportFormula(`${ffrac("A<sub>v</sub>", "s")}<sub>add req</sub> = max[0, ${ffrac("A<sub>v</sub>", "s")}<sub>interface req</sub> - ${ffrac("A<sub>v</sub>", "s")}<sub>unused</sub>] = max[0, ${fmt(s.interfaceAvReqPerM,0)} - ${fmt(s.unusedStirrupAv,0)}]`),
        reportResult(`${ffrac("A<sub>v</sub>", "s")}<sub>add req</sub> = ${fmt(addReqPerMm,3)} mm<sup>2</sup>/mm = ${fmt(s.additionalInterfaceReq,0)} mm<sup>2</sup>/m`),
        reportFormula(`${ffrac("A<sub>v</sub>", "s")}<sub>dowel</sub> = ${ffrac(`${fmt(i.dowelLegs,0)}(${fmt(dowel.area,0)})`, fmt(i.dowelSpacing,0))}`),
        reportResult(`${ffrac("A<sub>v</sub>", "s")}<sub>dowel</sub> = ${fmt(s.dowelAvPerM,0)} mm<sup>2</sup>/m; required added amount = ${fmt(s.additionalInterfaceReq,0)} mm<sup>2</sup>/m → ${reportStatusHtml(addedDowelOk)}`, addedDowelOk),
        reportFormula(`${ffrac("A<sub>v</sub>", "s")}<sub>available</sub> = ${ffrac("A<sub>v</sub>", "s")}<sub>unused</sub> + ${ffrac("A<sub>v</sub>", "s")}<sub>dowel</sub> = ${fmt(s.unusedStirrupAv,0)} + ${fmt(s.dowelAvPerM,0)} = ${fmt(s.totalInterfaceAvailable,0)} mm<sup>2</sup>/m`),
        reportResult(`${ffrac("A<sub>v</sub>", "s")}<sub>interface req</sub> ${interfaceSteelBalanceOk ? "≤" : ">"} ${ffrac("A<sub>v</sub>", "s")}<sub>unused</sub> + ${ffrac("A<sub>v</sub>", "s")}<sub>dowel</sub> : ${fmt(s.interfaceAvReqPerM,0)} ${interfaceSteelBalanceOk ? "≤" : ">"} ${fmt(s.unusedStirrupAv,0)} + ${fmt(s.dowelAvPerM,0)} = ${fmt(s.totalInterfaceAvailable,0)} → ${reportStatusHtml(interfaceSteelBalanceOk)}`, interfaceSteelBalanceOk)
      ]
    },
    {
      title: "9. Generate and read the shear-zone design schedule",
      blocks: [
        reportText("<strong>Purpose of this step:</strong> turn the continuous demand envelope into a practical reinforcement schedule. Each design zone is governed by the worst station inside that zone, the selected spacing is checked against the zone demand, and adjacent ranges with the same reinforcement are consolidated into a single schedule row."),
        reportText("To follow the schedule: read the x-range, then apply the listed primary stirrup spacing and any added interface dowels over that range. The local-allocation table below shows how each zone's selected reinforcement compares with the governing beam and interface demands."),
        reportTable(["Zone", "x range", "Length", "Primary shear reinforcement", "Added interface dowels", "Gov |Vf|", "Beam / interface util.", "Status"], zoneRows),
        reportText("Local allocation summary by zone, in mm²/m:"),
        reportTable(["Zone", "x range", "Primary Av/s", "Beam req", "Unused", "Interface req", "Add req", "Dowel Av/s", "Available"], zoneCalcRows)
      ]
    },
    {
      title: "10. Final utilization summary",
      blocks: [
        reportText("<strong>Purpose of this step:</strong> summarize the governing utilization checks so the final design can be reviewed quickly after the step-by-step calculations above."),
        reportFormula(`${ffrac("M<sub>f</sub>", "M<sub>r</sub>")} = ${fmt(s.flexRatio,3)} → ${reportStatusHtml(s.flexUtilizationOk)}`),
        reportFormula(`${ffrac("V<sub>beam</sub>", "V<sub>r,beam</sub>")} = ${fmt(s.beamShearRatio,3)}`),
        reportFormula(`${ffrac("V<sub>interface</sub>", "V<sub>r,interface</sub>")} = ${fmt(s.interfaceShearRatio,3)}`),
        reportFormula(`Separated shear utilization = max(${ffrac("V<sub>beam</sub>", "V<sub>r,beam</sub>")}, ${ffrac("V<sub>interface</sub>", "V<sub>r,interface</sub>")}) = max(${fmt(s.beamShearRatio,3)}, ${fmt(s.interfaceShearRatio,3)}) = ${fmt(s.governingShearRatio,3)}`),
        reportResult(`Separated shear checks ${s.shearUtilizationOk ? "pass" : "do not pass"}; beam and interface ratios are not summed → ${reportStatusHtml(s.shearUtilizationOk)}`, s.shearUtilizationOk),
        ...(st && local ? [reportNote(`Currently selected station: x=${fmt(st.x,3)} m; zone ${local.zone}; Vf=${fmt(st.V,2)} kN; Mf=${fmt(st.M,2)} kN·m; q=${fmt(st.qDesign,2)} kN/m; v=${fmt(st.vInterface,4)} MPa.`)] : [])
      ]
    }
  ];
}

function renderReport(r) {
  const target = $("calculationReport");
  if (!target) return;
  const sections = buildCalculationReportSections(r);
  target.innerHTML = sections.map((sec) => `
    <details class="report-section enhanced-report-section" open>
      <summary>${sec.title}</summary>
      <div class="report-blocks">
        ${sec.blocks.map(renderReportBlock).join("")}
      </div>
    </details>`).join("");
}

function renderReportBlock(block) {
  if (block.type === "text") return `<p class="report-paragraph">${block.html}</p>`;
  if (block.type === "note") return `<div class="report-follow-note">${block.html}</div>`;
  if (block.type === "formula") return `<div class="report-equation">${block.html}</div>`;
  if (block.type === "result") {
    const cls = block.ok === null ? "" : block.ok ? " ok" : " ng";
    return `<div class="report-result${cls}">${block.html}</div>`;
  }
  if (block.type === "table") {
    return `<div class="report-table-wrap"><table class="report-calc-table"><thead><tr>${block.headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${block.rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  if (block.type === "figure") {
    return `<figure class="report-figure">${block.svg}${block.caption ? `<figcaption>${block.caption}</figcaption>` : ""}</figure>`;
  }
  return "";
}

function plainReportText(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<sup>(.*?)<\/sup>/gi, "^$1")
    .replace(/<sub>(.*?)<\/sub>/gi, "_$1")
    .replace(/<span class="frac"><span>(.*?)<\/span><span>(.*?)<\/span><\/span>/gi, "($1)/($2)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function reportMarkdown(r) {
  const sections = buildCalculationReportSections(r);
  const lines = [
    "# CSA A23.3 cold-joint interface shear + beam shear calculation report",
    "",
    `Generated from current app inputs. Beam system: ${labelBeamSystem(r.inputs.beamSystem)}.`,
    ""
  ];
  sections.forEach(sec => {
    lines.push(`## ${sec.title}`, "");
    sec.blocks.forEach(block => {
      if (block.type === "text" || block.type === "note") {
        lines.push(plainReportText(block.html), "");
      } else if (block.type === "formula") {
        lines.push(`$$ ${plainReportText(block.html)} $$`, "");
      } else if (block.type === "result") {
        lines.push(`**${plainReportText(block.html)}**`, "");
      } else if (block.type === "table") {
        lines.push(`| ${block.headers.join(" | ")} |`);
        lines.push(`| ${block.headers.map(() => "---").join(" | ")} |`);
        block.rows.forEach(row => lines.push(`| ${row.map(cell => plainReportText(cell)).join(" | ")} |`));
        lines.push("");
      }
    });
  });
  return lines.join("\n");
}

async function copyReportMarkdown() {
  if (!lastResult) return;
  const md = reportMarkdown(lastResult);
  try {
    await navigator.clipboard.writeText(md);
    if ($("copyReportMarkdown")) $("copyReportMarkdown").textContent = "Copied";
    setTimeout(() => { if ($("copyReportMarkdown")) $("copyReportMarkdown").textContent = "Copy Markdown"; }, 1400);
  } catch (err) {
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "csa_interface_shear_calculation_report.md";
    a.click();
    URL.revokeObjectURL(url);
  }
}

function downloadCsv() {
  if (!lastResult) return;
  const rows = [["x_m", "Vf_kN", "Mf_kNm", "q_elastic_kN_per_m", "q_cracked_kN_per_m", "q_design_kN_per_m", "interface_stress_MPa"]];
  lastResult.stations.forEach(s => rows.push([s.x, s.V, s.M, s.qElastic, s.qCracked, s.qDesign, s.vInterface]));
  const csv = rows.map(row => row.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "beam_interface_shear_station_results.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function niceSpacing(limit) {
  const options = [600, 550, 500, 450, 400, 375, 350, 325, 300, 275, 250, 225, 200, 175, 150, 125, 100, 75];
  const positive = Number.isFinite(limit) && limit > 0 ? limit : 75;
  return options.find(v => v <= positive) || 75;
}


function buildAutoZones(sim, concept) {
  const L = beamLength(sim.inputs);
  const base = sim.inputs.designZones?.[0] || {
    label: "Zone 1", x1: 0, x2: L, stirrupBar: sim.inputs.stirrupBar, stirrupLegs: sim.inputs.stirrupLegs, stirrupSpacing: sim.inputs.stirrupSpacing, dowelBar: sim.inputs.dowelBar, dowelLegs: sim.inputs.dowelLegs, dowelSpacing: sim.inputs.dowelSpacing
  };
  if (concept === "uniform") {
    const gov = governingDesignForRange(sim, 0, L);
    return [{ ...base, id: zoneDefinitionIdCounter++, label: "Zone 1", x1: 0, x2: L, stirrupSpacing: gov.primarySpacing, dowelLegs: gov.dowelSpacing ? (base.dowelLegs || sim.inputs.dowelLegs || 4) : 0, dowelSpacing: gov.dowelSpacing || base.dowelSpacing }];
  }

  const reqs = sim.stations.map(st => ({ station: st, req: stationDesignRequirement(sim, st) }));
  let pieces = [];
  let startItem = reqs[0];
  let currentKey = `${startItem.req.primarySpacing}|${startItem.req.dowelSpacing || 0}|${startItem.req.ok ? 1 : 0}`;
  for (let idx = 1; idx < reqs.length; idx++) {
    const key = `${reqs[idx].req.primarySpacing}|${reqs[idx].req.dowelSpacing || 0}|${reqs[idx].req.ok ? 1 : 0}`;
    if (key !== currentKey) {
      pieces.push({ x1: startItem.station.x, x2: reqs[idx - 1].station.x, req: startItem.req });
      startItem = reqs[idx];
      currentKey = key;
    }
  }
  pieces.push({ x1: startItem.station.x, x2: reqs[reqs.length - 1].station.x, req: startItem.req });

  const minLen = zoneMinimumLength(sim);
  pieces = pieces.filter(p => p.x2 > p.x1 + 1e-9);
  let changed = true;
  while (changed && pieces.length > 1) {
    changed = false;
    for (let idx = 0; idx < pieces.length; idx++) {
      if (pieces[idx].x2 - pieces[idx].x1 >= minLen - 1e-9) continue;
      const mergeWith = idx === 0 ? 1 : idx === pieces.length - 1 ? idx - 1 : ((pieces[idx-1].x2 - pieces[idx-1].x1) <= (pieces[idx+1].x2 - pieces[idx+1].x1) ? idx - 1 : idx + 1);
      const a = Math.min(idx, mergeWith), b = Math.max(idx, mergeWith);
      const x1 = pieces[a].x1, x2 = pieces[b].x2;
      const gov = governingDesignForRange(sim, x1, x2);
      pieces.splice(a, 2, { x1, x2, req: gov });
      changed = true;
      break;
    }
  }
  while (pieces.length > sim.inputs.zoneMaxCount) {
    let best = 0, penalty = Infinity;
    for (let idx = 0; idx < pieces.length - 1; idx++) {
      const p = Math.abs((pieces[idx].req.primarySpacing || 0) - (pieces[idx+1].req.primarySpacing || 0)) + Math.abs((pieces[idx].req.dowelSpacing || 0) - (pieces[idx+1].req.dowelSpacing || 0));
      if (p < penalty) { penalty = p; best = idx; }
    }
    const x1 = pieces[best].x1, x2 = pieces[best+1].x2;
    const gov = governingDesignForRange(sim, x1, x2);
    pieces.splice(best, 2, { x1, x2, req: gov });
  }
  const zones = pieces.map((p, idx) => ({
    ...base,
    id: zoneDefinitionIdCounter++,
    label: `Zone ${idx + 1}`,
    x1: p.x1,
    x2: p.x2,
    stirrupSpacing: p.req.primarySpacing,
    dowelLegs: p.req.dowelSpacing ? (base.dowelLegs || sim.inputs.dowelLegs || 4) : 0,
    dowelSpacing: p.req.dowelSpacing || base.dowelSpacing
  }));
  if (zones.length) zones[0].label = "Zone 1";
  return zones.length ? zones : [{ ...base, id: zoneDefinitionIdCounter++, label: "Zone 1", x1: 0, x2: L }];
}

function previewAutoDesign(apply = false) {
  if (!lastResult) runCalculations();
  const r = lastResult;
  const concept = $("zoneDesignMode") ? val("zoneDesignMode") : "zoned";
  const strategy = $("zoneDesignStrategy") ? val("zoneDesignStrategy") : "primaryOnly";
  const maxPractical = Math.max(75, num("zoneMaxSpacing") || r.inputs.zoneMaxSpacing || 450);
  const zoneStrategy = strategy === "addDowels" ? "addDowels" : strategy === "primaryOnly" || strategy === "primaryFirst" ? "primaryOnly" : "hybrid";

  const sim = {
    ...r,
    inputs: {
      ...r.inputs,
      zoneDesignMode: concept === "uniform" ? "uniform" : "zoned",
      zoneDesignStrategy: zoneStrategy,
      zoneMaxSpacing: maxPractical,
      dowelLegs: strategy === "addDowels" && r.inputs.dowelLegs <= 0 ? 4 : r.inputs.dowelLegs
    },
    summary: { ...r.summary }
  };
  const dowel = rebar(sim.inputs.dowelBar);
  sim.summary.dowelAvSet = sim.inputs.dowelLegs * dowel.area;
  sim.summary.dowelAvPerM = sim.inputs.dowelSpacing > 0 ? sim.summary.dowelAvSet / sim.inputs.dowelSpacing * 1000 : 0;
  const proposedZones = buildAutoZones(sim, concept);
  sim.inputs.designZones = proposedZones;
  sim.summary.zoneSchedule = computeZoneSchedule(sim);
  Object.assign(sim.summary, evaluateZoneScheduleUtilization(sim));

  const zones = sim.summary.zoneSchedule || [];
  const minPrimary = zones.length ? Math.min(...zones.map(z => z.primarySpacing || sim.inputs.stirrupSpacing)) : sim.inputs.stirrupSpacing;
  const needsDowels = zones.some(z => z.dowelSpacing && z.dowelLegs > 0);
  const maxUtil = sim.summary.zoneGoverningShearRatio;
  const zoneText = concept === "uniform" ? "uniform" : "zoned";
  const message = `${zoneText} proposal: ${zones.length} editable zone${zones.length === 1 ? "" : "s"}; tightest primary spacing ${fmt(minPrimary,0)} mm; ${needsDowels ? "added dowels where required" : "no added dowels required"}. Max shear utilization ${fmt(maxUtil,2)}.`;

  if ($("autoDesignResult")) $("autoDesignResult").textContent = message;

  if (apply) {
    $("zoneDesignMode").value = sim.inputs.zoneDesignMode;
    $("zoneDesignStrategy").value = sim.inputs.zoneDesignStrategy;
    $("zoneMaxSpacing").value = maxPractical;
    resetZoneModelFromFlattenedZones(proposedZones.map((z, idx) => ({ ...z, label: idx === 0 ? "Zone 1" : (z.label || `Zone ${idx + 1}`) })));
    updateConditionalInputs();
    renderZoneEditor();
    runCalculations();
    if ($("autoDesignResult")) $("autoDesignResult").textContent = "Designed: " + message;
  }
}
function setStationFromClientX(clientX) {
  if (!lastResult) return;
  const host = $("beamElevation");
  const svg = host ? host.querySelector("svg") : null;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const leftPct = 86 / 1000;
  const plotPct = 866 / 1000;
  const ratio = clamp(((clientX - rect.left) / Math.max(1, rect.width) - leftPct) / plotPct, 0, 1);
  const targetX = ratio * beamLength(lastResult.inputs);
  let closest = 0;
  for (let i = 1; i < lastResult.stations.length; i++) {
    if (Math.abs(lastResult.stations[i].x - targetX) < Math.abs(lastResult.stations[closest].x - targetX)) closest = i;
  }
  selectedStationIndex = closest;
  renderElevation(lastResult);
  renderStationUtilizationDashboard(lastResult);
  renderCrossSection(lastResult);
}

function attachScrubberDrag() {
  const host = $("beamElevation");
  if (!host) return;
  host.addEventListener("pointerdown", event => {
    if (!lastResult) return;
    scrubDragActive = true;
    host.setPointerCapture?.(event.pointerId);
    setStationFromClientX(event.clientX);
    event.preventDefault();
  });
  host.addEventListener("pointermove", event => {
    if (!scrubDragActive) return;
    setStationFromClientX(event.clientX);
    event.preventDefault();
  });
  const stop = () => { scrubDragActive = false; };
  host.addEventListener("pointerup", stop);
  host.addEventListener("pointercancel", stop);
  window.addEventListener("pointerup", stop);
}

function attachEvents() {
  document.querySelectorAll("input, select").forEach(el => {
    el.addEventListener("change", () => {
      if (el.id === "interfaceCondition") syncInterfaceDefaults();
      updateConditionalInputs();
      if (["beamSystem","L1","L2","stirrupBar","stirrupLegs","stirrupSpacing","dowelBar","dowelLegs","dowelSpacing"].includes(el.id)) renderZoneEditor();
      runCalculations();
    });
    el.addEventListener("input", () => {
      if (el.type === "number") {
        updateConditionalInputs();
        if (["L1","L2","stirrupLegs","stirrupSpacing","dowelLegs","dowelSpacing"].includes(el.id)) renderZoneEditor();
        runCalculations();
      }
    });
  });
  if ($("addZoneButton")) $("addZoneButton").addEventListener("click", addUserZone);
  if ($("zoneEditor")) {
    $("zoneEditor").addEventListener("input", event => {
      if (event.target.classList.contains("zone-input")) updateZoneFromEvent(event.target);
    });
    $("zoneEditor").addEventListener("change", event => {
      if (event.target.classList.contains("zone-input")) updateZoneFromEvent(event.target);
    });
    $("zoneEditor").addEventListener("click", event => {
      if (event.target.classList.contains("zone-assignment-delete")) deleteZoneAssignment(parseInt(event.target.dataset.zoneAssignmentId, 10));
      if (event.target.classList.contains("zone-definition-delete")) deleteZoneDefinition(parseInt(event.target.dataset.zoneDefinitionId, 10));
      if (event.target.classList.contains("zone-delete")) deleteZone(parseInt(event.target.dataset.zoneId, 10));
    });
  }
  $("runButton").addEventListener("click", runCalculations);
  $("resetDefaults").addEventListener("click", () => { applyDefaults(); runCalculations(); });
  $("downloadCsv").addEventListener("click", downloadCsv);
  if ($("copyReportMarkdown")) $("copyReportMarkdown").addEventListener("click", copyReportMarkdown);
  if ($("printReport")) $("printReport").addEventListener("click", () => window.print());
  if ($("autoDesignButton")) $("autoDesignButton").addEventListener("click", () => { $("autoDesignPanel").hidden = !$('autoDesignPanel').hidden; previewAutoDesign(false); });
  if ($("closeAutoDesign")) $("closeAutoDesign").addEventListener("click", () => { $("autoDesignPanel").hidden = true; });
  if ($("previewAutoDesign")) $("previewAutoDesign").addEventListener("click", () => previewAutoDesign(false));
  if ($("applyAutoDesign")) $("applyAutoDesign").addEventListener("click", () => previewAutoDesign(true));
  attachScrubberDrag();
}

document.addEventListener("DOMContentLoaded", () => {
  setupRebarSelects();
  applyDefaults();
  attachEvents();
  runCalculations();
});
