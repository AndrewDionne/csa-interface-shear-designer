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
  slabDepth: 350,
  fc: 50,
  fy: 400,
  lambda: 1.0,
  phiC: 0.65,
  phiS: 0.85,
  cover: 50,
  mainBar: "35M",
  mainCount: 28,
  shearMethod: "simplified",
  interfaceCondition: "roughened",
  interfaceDemandModel: "elastic",
  cohesion: 0.50,
  mu: 1.00,
  zFactor: 0.96,
  allocation: "balance",
  stirrupBar: "15M",
  stirrupLegs: 8,
  stirrupSpacing: 450,
  dowelBar: "15M",
  dowelLegs: 4,
  dowelSpacing: 350,
  zoneDesignMode: "zoned",
  zoneDesignStrategy: "primaryFirst",
  zoneMinSpacing: 100,
  zoneMaxSpacing: 450,
  zoneMaxCount: 5,
  zoneMinLength: 0
};

let lastResult = null;
let selectedStationIndex = 0;
let scrubDragActive = false;

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
  ["mainBar", "stirrupBar", "dowelBar"].forEach(id => {
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

function applyDefaults() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if ($(key)) $(key).value = value;
  }
  syncInterfaceDefaults();
  updateConditionalInputs();
}

function syncInterfaceDefaults() {
  const condition = val("interfaceCondition");
  if (condition === "roughened") {
    $("cohesion").value = "0.50";
    $("mu").value = "1.00";
    $("cohesion").disabled = true;
    $("mu").disabled = true;
  } else if (condition === "clean") {
    $("cohesion").value = "0.25";
    $("mu").value = "0.60";
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
  setParentLabelHidden("L2", system !== "twoSpan");
  setParentLabelHidden("Pf", !pointOn);
  setParentLabelHidden("Px", !pointOn);
  setParentLabelHidden("zoneMaxCount", mode !== "zoned");
  setParentLabelHidden("zoneMinLength", mode !== "zoned");
  setParentLabelHidden("dowelBar", val("zoneDesignStrategy") !== "addDowels" && num("dowelLegs") <= 0);
  setParentLabelHidden("dowelLegs", val("zoneDesignStrategy") !== "addDowels" && num("dowelLegs") <= 0);
  setParentLabelHidden("dowelSpacing", val("zoneDesignStrategy") !== "addDowels" && num("dowelLegs") <= 0);
}

function beamLength(inputs) {
  if (inputs.beamSystem === "twoSpan") return inputs.L1 + inputs.L2;
  return inputs.L1;
}

function supportLocations(inputs) {
  if (inputs.beamSystem === "simple") return [0, inputs.L1];
  if (inputs.beamSystem === "twoSpan") return [0, inputs.L1, inputs.L1 + inputs.L2];
  if (inputs.beamSystem === "cantilever") return [0];
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
  if (inputs.beamSystem === "cantilever") {
    const idx = xs.findIndex(x => Math.abs(x) < 1e-6);
    fixed.add(2 * idx + 1); // fixed rotation at cantilever root.
  }

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
    slabDepth: num("slabDepth"),
    fc: num("fc"),
    fy: num("fy"),
    lambda: num("lambda"),
    phiC: num("phiC"),
    phiS: num("phiS"),
    cover: num("cover"),
    mainBar: val("mainBar"),
    mainCount: num("mainCount"),
    shearMethod: val("shearMethod"),
    interfaceCondition: val("interfaceCondition"),
    interfaceDemandModel: val("interfaceDemandModel"),
    cohesion: num("cohesion"),
    mu: num("mu"),
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
  inputs.zoneMinSpacing = Math.max(50, inputs.zoneMinSpacing || 100);
  inputs.zoneMaxSpacing = Math.max(inputs.zoneMinSpacing, inputs.zoneMaxSpacing || 450);
  inputs.zoneMaxCount = Math.max(1, Math.min(9, inputs.zoneMaxCount || 5));
  inputs.zoneMinLength = Math.max(0, inputs.zoneMinLength || 0);
  return inputs;
}

function computeSection(inputs) {
  const main = rebar(inputs.mainBar);
  const stirrup = rebar(inputs.stirrupBar);
  const h = inputs.h;
  const b = inputs.b;
  const slabDepth = Math.min(inputs.slabDepth, inputs.h);
  const Ig = b * Math.pow(h, 3) / 12;
  const neutralAxisFromTop = h / 2;
  const areaAboveInterface = b * slabDepth;
  const yAbove = slabDepth / 2;
  const Q = areaAboveInterface * (neutralAxisFromTop - yAbove);
  const d = h - inputs.cover - stirrup.diameter - main.diameter / 2;
  const dv = Math.max(0.9 * d, 0.72 * h);
  const z = Math.max(0.5 * d, inputs.zFactor * d);
  const As = inputs.mainCount * main.area;

  return { Ig, neutralAxisFromTop, Q, d, dv, z, As, main, stirrup, h, b, slabDepth };
}

function computeStationResults(inputs, section, fe) {
  const Ltotal = beamLength(inputs);
  const stations = fe.xs.map(x => {
    // Plot and report internal actions just inside the member at the far end,
    // so the right support reaction does not force the last shear point to zero.
    const calcX = x >= Ltotal - 1e-9 ? Math.max(0, Ltotal - 1e-6) : x;
    let V = 0;
    let M = 0;

    fe.reactions.forEach(r => {
      if (calcX + 1e-9 >= r.x) {
        V += r.vertical;
        M += r.vertical * (calcX - r.x);
      }
    });

    // Include fixed-end support moments when present, chiefly for cantilever.
    fe.supportMoments.forEach(r => {
      if (calcX + 1e-9 >= r.x) {
        M -= r.moment;
      }
    });

    V -= inputs.Wf * calcX;
    M -= inputs.Wf * calcX * calcX / 2;

    if (inputs.includePoint && inputs.Pf !== 0 && calcX + 1e-9 >= inputs.Px) {
      V -= inputs.Pf;
      M -= inputs.Pf * (calcX - inputs.Px);
    }

    const qElastic = Math.abs(V) * 1000 * section.Q / section.Ig; // N/mm = kN/m
    const qCracked = Math.abs(V) * 1000 / Math.max(1, section.z); // N/mm = kN/m
    let qDesign = qElastic;
    if (inputs.interfaceDemandModel === "cracked") qDesign = qCracked;
    if (inputs.interfaceDemandModel === "max") qDesign = Math.max(qElastic, qCracked);
    const vInterface = qDesign / section.b;

    return { x, V, M, qElastic, qCracked, qDesign, vInterface };
  });

  return stations;
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

  const beta = 0.18;
  const thetaDeg = 35;
  const cotTheta = 1 / Math.tan(thetaDeg * Math.PI / 180);
  const sqrtFc = Math.sqrt(Math.max(0, inputs.fc));

  const Vc = inputs.phiC * inputs.lambda * beta * sqrtFc * section.b * section.dv / 1000; // kN
  const beamAvReqPerM = Math.max(0, (maxV - Vc) * 1000 / (inputs.phiS * inputs.fy * section.dv * cotTheta)); // mm²/mm
  const beamAvReqPerM2 = beamAvReqPerM * 1000; // mm²/m

  const highShearThreshold = 0.125 * inputs.lambda * inputs.phiC * sqrtFc * section.b * section.dv / 1000;
  const sMax = maxV > highShearThreshold ? Math.min(0.35 * section.dv, 300) : Math.min(0.7 * section.dv, 600);
  const AvMin = 0.06 * sqrtFc * section.b * inputs.stirrupSpacing / Math.max(1, inputs.fy); // mm² per set

  const stirrup = rebar(inputs.stirrupBar);
  const dowel = rebar(inputs.dowelBar);
  const stirrupAvSet = inputs.stirrupLegs * stirrup.area;
  const stirrupAvPerM = inputs.stirrupSpacing > 0 ? stirrupAvSet / inputs.stirrupSpacing * 1000 : 0;
  const dowelAvSet = inputs.dowelLegs * dowel.area;
  const dowelAvPerM = inputs.dowelSpacing > 0 ? dowelAvSet / inputs.dowelSpacing * 1000 : 0;

  const rhoReq = Math.max(0, (maxStress / (inputs.lambda * inputs.phiC) - inputs.cohesion) / Math.max(1e-9, inputs.mu * inputs.fy));
  const interfaceAvReqPerM = rhoReq * section.b * 1000; // mm²/m
  const concreteLimit = 0.25 * inputs.phiC * inputs.fc;

  const unusedStirrupAv = inputs.allocation === "balance"
    ? Math.max(0, stirrupAvPerM - beamAvReqPerM2)
    : stirrupAvPerM;

  const additionalInterfaceReq = Math.max(0, interfaceAvReqPerM - unusedStirrupAv);
  const totalInterfaceAvailable = unusedStirrupAv + dowelAvPerM;

  const Vs = inputs.phiS * (stirrupAvSet / Math.max(1, inputs.stirrupSpacing)) * inputs.fy * section.dv * cotTheta / 1000;
  const Vr = Vc + Vs;
  const VrMax = 0.25 * inputs.phiC * inputs.fc * section.b * section.dv / 1000;

  const verticalStrengthOk = Vr >= maxV;
  const verticalSpacingOk = inputs.stirrupSpacing <= sMax;
  const minSteelOk = stirrupAvSet >= AvMin;
  const interfaceOk = totalInterfaceAvailable >= interfaceAvReqPerM && maxStress <= concreteLimit;
  const flex = computeFlexuralEstimate(inputs, section, maxMabs);
  const rhoAvailableInterface = totalInterfaceAvailable / Math.max(1, section.b * 1000);
  const interfaceStressResistanceRaw = inputs.lambda * inputs.phiC * (inputs.cohesion + inputs.mu * rhoAvailableInterface * inputs.fy);
  const interfaceStressResistance = Math.min(concreteLimit, interfaceStressResistanceRaw);
  const beamShearRatio = maxV / Math.max(1e-9, Vr);
  const interfaceShearRatio = maxStress / Math.max(1e-9, interfaceStressResistance);
  const flexRatio = maxMabs / Math.max(1e-9, flex.Mr);
  const combinedShearRatio = beamShearRatio + interfaceShearRatio;
  const shearUtilizationOk = combinedShearRatio <= 1.0;
  const flexUtilizationOk = flexRatio <= 1.0;

  const result = {
    inputs, section, fe, stations,
    summary: { maxV, maxMpos, maxMneg, maxMabs, maxQ, maxStress, Vc, Vs, Vr, VrMax, beta, thetaDeg, cotTheta, beamAvReqPerM: beamAvReqPerM2, highShearThreshold, sMax, AvMin, stirrupAvSet, stirrupAvPerM, dowelAvSet, dowelAvPerM, rhoReq, interfaceAvReqPerM, concreteLimit, unusedStirrupAv, additionalInterfaceReq, totalInterfaceAvailable, interfaceStressResistanceRaw, interfaceStressResistance, beamShearRatio, interfaceShearRatio, flexRatio, combinedShearRatio, shearUtilizationOk, flexUtilizationOk, verticalStrengthOk, verticalSpacingOk, minSteelOk, interfaceOk, flex }
  };
  result.summary.zoneSchedule = computeZoneSchedule(result);
  Object.assign(result.summary, evaluateZoneScheduleUtilization(result));
  result.summary.beamShearRatio = result.summary.zoneBeamShearRatio;
  result.summary.interfaceShearRatio = result.summary.zoneInterfaceShearRatio;
  result.summary.combinedShearRatio = result.summary.zoneCombinedShearRatio;
  result.summary.shearUtilizationOk = result.summary.zoneCombinedShearRatio <= 1.0;

  lastResult = result;
  render(result);
}

function computeFlexuralEstimate(inputs, section, maxMabs) {
  const fc = inputs.fc;
  const alpha1 = Math.max(0.67, 0.85 - 0.0015 * fc);
  const beta1 = Math.max(0.67, 0.97 - 0.0025 * fc);
  const a = inputs.phiS * section.As * inputs.fy / Math.max(1, alpha1 * inputs.phiC * fc * section.b);
  const c = a / Math.max(0.1, beta1);
  const Mr = inputs.phiS * section.As * inputs.fy * (section.d - a / 2) / 1e6; // kN-m
  return { alpha1, beta1, a, c, Mr, ok: Mr >= maxMabs };
}

function render(result) {
  renderSummary(result);
  renderChecks(result);
  renderZoneSchedule(result);
  renderElevation(result);
  renderCrossSection(result);
  renderCharts(result);
  renderTable(result);
  renderReport(result);

  const ok = result.summary.verticalStrengthOk && result.summary.verticalSpacingOk && result.summary.minSteelOk && result.summary.interfaceOk && result.summary.flexUtilizationOk && result.summary.shearUtilizationOk;
  const hasWarning = !result.summary.flex.ok;
  const status = $("overallStatus");
  if (status) {
    status.className = "status-chip " + (ok ? "ok" : hasWarning ? "warn" : "ng");
    status.textContent = ok ? "OK" : hasWarning ? "Review" : "NG";
  }
}

function card(label, value, note = "") {
  return `<div class="card"><div class="label">${label}</div><div class="value">${value}</div>${note ? `<div class="note">${note}</div>` : ""}</div>`;
}

function interfaceConditionLabel(value) {
  if (value === "roughened") return "clean + intentionally roughened";
  if (value === "clean") return "clean, not intentionally roughened";
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
  const beamAvReqPerMm = Math.max(0, (Math.abs(station.V) - s.Vc) * 1000 / (r.inputs.phiS * r.inputs.fy * r.section.dv * s.cotTheta));
  const beamAvReqPerM = beamAvReqPerMm * 1000;
  const rhoReq = Math.max(0, (Math.abs(station.vInterface) / (r.inputs.lambda * r.inputs.phiC) - r.inputs.cohesion) / Math.max(1e-9, r.inputs.mu * r.inputs.fy));
  const interfaceAvReqPerM = rhoReq * r.section.b * 1000;
  const unusedStirrupAv = r.inputs.allocation === "balance"
    ? Math.max(0, s.stirrupAvPerM - beamAvReqPerM)
    : s.stirrupAvPerM;
  const addReq = Math.max(0, interfaceAvReqPerM - unusedStirrupAv);
  const totalAvailable = unusedStirrupAv + s.dowelAvPerM;
  const interfaceResistance = Math.min(s.concreteLimit, s.interfaceStressResistanceRaw);
  const beamRatio = Math.abs(station.V) / Math.max(1e-9, s.Vr);
  const interfaceRatio = Math.abs(station.vInterface) / Math.max(1e-9, interfaceResistance);
  const shearRatio = beamRatio + interfaceRatio;
  const flexRatio = Math.abs(station.M) / Math.max(1e-9, s.flex.Mr);
  return { beamAvReqPerM, interfaceAvReqPerM, unusedStirrupAv, addReq, totalAvailable, beamRatio, interfaceRatio, shearRatio, flexRatio, zone: stationZone(r, station) };
}

function localSpacingLimit(r, station) {
  const s = r.summary;
  const sqrtFc = Math.sqrt(Math.max(0, r.inputs.fc));
  const primarySet = Math.max(0, s.stirrupAvSet);
  const minSteelSpacingLimit = primarySet > 0 ? primarySet * Math.max(1, r.inputs.fy) / Math.max(1, 0.06 * sqrtFc * r.section.b) : 0;
  const sMaxLocal = Math.abs(station.V) > s.highShearThreshold ? Math.min(0.35 * r.section.dv, 300) : Math.min(0.7 * r.section.dv, 600);
  return { minSteelSpacingLimit, sMaxLocal };
}

function spacingOptions(minSpacing, maxSpacing) {
  const base = [600, 550, 500, 450, 400, 375, 350, 325, 300, 275, 250, 225, 200, 175, 150, 125, 100, 75, 50];
  const min = Math.max(50, Math.min(minSpacing || 50, maxSpacing || 600));
  const max = Math.max(min, maxSpacing || 600);
  const opts = base.filter(v => v >= min - 1e-9 && v <= max + 1e-9);
  if (!opts.includes(min)) opts.push(min);
  if (!opts.includes(max)) opts.push(max);
  return [...new Set(opts)].sort((a, b) => b - a);
}

function evaluateDetailAtStation(r, station, primarySpacing, dowelSpacing = null) {
  const s = r.summary;
  const i = r.inputs;
  const local = localDesignForStation(r, station);
  const primarySet = Math.max(0, s.stirrupAvSet);
  const dowelSet = Math.max(0, s.dowelAvSet);
  const primaryPerM = primarySet > 0 && primarySpacing > 0 ? primarySet / primarySpacing * 1000 : 0;
  const Vs = i.phiS * (primarySet / Math.max(1, primarySpacing)) * i.fy * r.section.dv * s.cotTheta / 1000;
  const Vr = s.Vc + Vs;
  const beamRatio = Math.abs(station.V) / Math.max(1e-9, Vr);
  const unused = i.allocation === "balance" ? Math.max(0, primaryPerM - local.beamAvReqPerM) : primaryPerM;
  const dowelPerM = dowelSet > 0 && dowelSpacing ? dowelSet / dowelSpacing * 1000 : 0;
  const totalInterfaceAvailable = unused + dowelPerM;
  const rho = totalInterfaceAvailable / Math.max(1, r.section.b * 1000);
  const interfaceResistanceRaw = i.lambda * i.phiC * (i.cohesion + i.mu * rho * i.fy);
  const interfaceResistance = Math.min(s.concreteLimit, interfaceResistanceRaw);
  const interfaceRatio = Math.abs(station.vInterface) / Math.max(1e-9, interfaceResistance);
  const shearRatio = beamRatio + interfaceRatio;
  const spacingLimit = localSpacingLimit(r, station);
  const minSteelOk = primarySet >= 0.06 * Math.sqrt(Math.max(0, i.fc)) * r.section.b * primarySpacing / Math.max(1, i.fy);
  const spacingOk = primarySpacing <= spacingLimit.sMaxLocal + 1e-9;
  const ok = shearRatio <= 1.0 + 1e-9 && spacingOk && minSteelOk;
  return { ...local, primarySpacing, primaryPerM, dowelSpacing, dowelPerM, totalInterfaceAvailable, interfaceResistance, beamRatio, interfaceRatio, shearRatio, Vs, Vr, spacingOk, minSteelOk, ok };
}

function stationDesignRequirement(r, station) {
  const i = r.inputs;
  const s = r.summary;
  const primarySet = Math.max(0, s.stirrupAvSet);
  const dowelSet = Math.max(0, s.dowelAvSet);
  const limits = localSpacingLimit(r, station);
  const zoneMin = Math.max(50, i.zoneMinSpacing);
  const zoneMax = Math.max(zoneMin, i.zoneMaxSpacing);
  const maxPrimarySpacing = Math.min(zoneMax, limits.minSteelSpacingLimit || zoneMax, limits.sMaxLocal);
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

  if (i.zoneDesignStrategy === "addDowels") {
    const selected = clamp(i.stirrupSpacing || maxPrimarySpacing, zoneMin, maxPrimarySpacing || zoneMin);
    best = bestWithDowels(niceSpacing(selected));
  } else {
    for (const ps of primaryOptions) {
      const trial = evaluateDetailAtStation(r, station, ps, null);
      if (!best || trial.shearRatio < best.shearRatio || (trial.ok && (!best.ok || ps > best.primarySpacing))) best = trial;
      if (trial.ok) return trial;
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
function segmentKey(seg) {
  return `${Math.round(seg.primarySpacing || 0)}|${seg.dowelSpacing ? Math.round(seg.dowelSpacing) : 0}|${seg.ok ? 1 : 0}`;
}

function zoneMinimumLength(r) {
  const userMin = r.inputs.zoneMinLength || 0;
  const twoD = 2 * r.section.d / 1000;
  return Math.max(userMin, twoD);
}

function recomputeSegment(r, x1, x2) {
  const gov = governingDesignForRange(r, x1, x2);
  return { x1, x2, gov, primarySpacing: gov.primarySpacing, dowelSpacing: gov.dowelSpacing, addReq: gov.addReq, ok: gov.ok };
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
      row = { key, name: `Zone ${rows.length + 1}`, ranges: [], gov: seg.gov, primarySpacing: seg.primarySpacing, dowelSpacing: seg.dowelSpacing, addReq: seg.addReq || 0, ok: seg.ok, mode: r.inputs.zoneDesignMode === "uniform" ? "Uniform" : "Zoned demand envelope" };
      rows.push(row);
    }
    row.ranges.push({ x1: seg.x1, x2: seg.x2 });
    if (seg.gov && (!row.gov || seg.gov.shearRatio > row.gov.shearRatio)) row.gov = seg.gov;
    row.addReq = Math.max(row.addReq || 0, seg.addReq || 0);
    row.ok = row.ok && seg.ok;
  }
  rows.forEach((row, idx) => {
    row.name = `Zone ${idx + 1}`;
    row.x1 = row.ranges[0].x1;
    row.x2 = row.ranges[row.ranges.length - 1].x2;
    row.length = row.ranges.reduce((sum, rg) => sum + Math.max(0, rg.x2 - rg.x1), 0);
  });
  return rows;
}

function computeZoneSchedule(r) {
  const i = r.inputs;
  const L = beamLength(i);

  if (i.zoneDesignMode === "uniform") {
    const gov = governingDesignForRange(r, 0, L);
    const actual = evaluateDetailAtStation(r, gov.station, i.stirrupSpacing, i.dowelLegs > 0 ? i.dowelSpacing : null);
    return consolidateScheduleRows(r, [{ x1: 0, x2: L, gov: actual, primarySpacing: i.stirrupSpacing, dowelSpacing: i.dowelLegs > 0 ? i.dowelSpacing : null, addReq: actual.addReq || 0, ok: actual.ok }]);
  }

  const stationReqs = r.stations.map(st => ({ station: st, req: stationDesignRequirement(r, st) }));
  let segments = [];
  let start = stationReqs[0];
  let currentKey = segmentKey(start.req);
  for (let idx = 1; idx < stationReqs.length; idx++) {
    const item = stationReqs[idx];
    const key = segmentKey(item.req);
    if (key !== currentKey) {
      segments.push(recomputeSegment(r, start.station.x, stationReqs[idx - 1].station.x));
      start = item;
      currentKey = key;
    }
  }
  segments.push(recomputeSegment(r, start.station.x, stationReqs[stationReqs.length - 1].station.x));
  segments = mergeAdjacentSameDetail(segments);

  const minLen = zoneMinimumLength(r);
  let changed = true;
  while (changed && segments.length > 1) {
    changed = false;
    for (let idx = 0; idx < segments.length; idx++) {
      const len = segments[idx].x2 - segments[idx].x1;
      if (len >= minLen - 1e-9) continue;
      if (idx === 0) {
        const newX = Math.min(L, segments[idx].x1 + minLen);
        if (segments[idx + 1] && newX < segments[idx + 1].x2 - 1e-6) {
          segments[idx] = recomputeSegment(r, segments[idx].x1, newX);
          segments[idx + 1] = recomputeSegment(r, newX, segments[idx + 1].x2);
          changed = true;
          break;
        }
      } else if (idx === segments.length - 1) {
        const newX = Math.max(0, segments[idx].x2 - minLen);
        if (segments[idx - 1] && newX > segments[idx - 1].x1 + 1e-6) {
          segments[idx - 1] = recomputeSegment(r, segments[idx - 1].x1, newX);
          segments[idx] = recomputeSegment(r, newX, segments[idx].x2);
          changed = true;
          break;
        }
      }
      const left = idx > 0 ? idx - 1 : null;
      const right = idx < segments.length - 1 ? idx + 1 : null;
      let mergeIdx = right;
      if (left !== null && right !== null) {
        const leftPenalty = Math.abs((segments[left].primarySpacing || 0) - (segments[idx].primarySpacing || 0));
        const rightPenalty = Math.abs((segments[right].primarySpacing || 0) - (segments[idx].primarySpacing || 0));
        mergeIdx = leftPenalty <= rightPenalty ? left : right;
      } else if (left !== null) {
        mergeIdx = left;
      }
      if (mergeIdx === null) break;
      const a = Math.min(idx, mergeIdx);
      const b = Math.max(idx, mergeIdx);
      const combined = recomputeSegment(r, segments[a].x1, segments[b].x2);
      segments.splice(a, 2, combined);
      changed = true;
      break;
    }
    segments = mergeAdjacentSameDetail(segments);
  }

  while (segments.length > i.zoneMaxCount) {
    let best = 0;
    let bestPenalty = Infinity;
    for (let idx = 0; idx < segments.length - 1; idx++) {
      const penalty = Math.abs((segments[idx].primarySpacing || 0) - (segments[idx + 1].primarySpacing || 0)) + Math.abs((segments[idx].dowelSpacing || 0) - (segments[idx + 1].dowelSpacing || 0));
      if (penalty < bestPenalty) { bestPenalty = penalty; best = idx; }
    }
    segments.splice(best, 2, recomputeSegment(r, segments[best].x1, segments[best + 1].x2));
    segments = mergeAdjacentSameDetail(segments);
  }

  return consolidateScheduleRows(r, segments);
}

function evaluateZoneScheduleUtilization(r) {
  const zones = r.summary.zoneSchedule || [];
  let maxBeam = 0;
  let maxInterface = 0;
  let maxCombined = 0;
  let controlling = null;
  for (const z of zones) {
    const ranges = z.ranges || [{ x1: z.x1, x2: z.x2 }];
    for (const rg of ranges) {
      const stations = r.stations.filter(st => st.x >= rg.x1 - 1e-9 && st.x <= rg.x2 + 1e-9);
      for (const st of stations) {
        const ev = evaluateDetailAtStation(r, st, z.primarySpacing, z.dowelSpacing || null);
        if (ev.shearRatio > maxCombined) {
          maxCombined = ev.shearRatio;
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
    maxCombined = r.summary.combinedShearRatio;
  }
  return { zoneBeamShearRatio: maxBeam, zoneInterfaceShearRatio: maxInterface, zoneCombinedShearRatio: maxCombined, zoneControlling: controlling };
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
    const dowelText = z.dowelSpacing ? `${fmt(i.dowelLegs,0)} legs ${i.dowelBar} @ ${fmt(z.dowelSpacing,0)} mm` : (z.addReq > 1e-9 ? `Needs ${fmt(z.addReq,0)} mm²/m added interface steel` : "None");
    const cls = z.ok ? "ok" : "ng";
    return `<tr class="${cls}">
      <td>${z.name}</td>
      <td>${ranges}</td>
      <td>${fmt(z.length ?? (z.x2 - z.x1),2)}</td>
      <td>${fmt(Math.abs(z.gov.station.V),0)}</td>
      <td>${fmt(Math.abs(z.gov.station.M),0)}</td>
      <td>${fmt(z.gov.interfaceAvReqPerM,0)}</td>
      <td>${fmt(i.stirrupLegs,0)} legs ${i.stirrupBar} @ ${fmt(z.primarySpacing,0)} mm</td>
      <td>${dowelText}</td>
      <td>${fmt(z.gov.shearRatio,2)}</td>
      <td><span class="mini-status ${cls}">${z.ok ? "OK" : "NG"}</span></td>
    </tr>`;
  }).join("");
  el.innerHTML = `<div class="zone-summary">Mode: <strong>${i.zoneDesignMode}</strong> · Strategy: <strong>${i.zoneDesignStrategy}</strong> · spacing range ${fmt(i.zoneMinSpacing,0)}–${fmt(i.zoneMaxSpacing,0)} mm · minimum zone length ${fmt(minLen,2)} m (≥2d)</div>
    <div class="table-wrap zone-table-wrap"><table class="zone-table">
      <thead><tr><th>Zone</th><th>x range, m</th><th>Total length, m</th><th>|Vf|, kN</th><th>|Mf|, kN·m</th><th>Interface req, mm²/m</th><th>Primary shear reinforcement</th><th>Added interface dowels</th><th>Shear util.</th><th>Status</th></tr></thead>
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
    card("dv / d", `${fmt(r.section.dv, 0)} / ${fmt(r.section.d, 0)} mm`, `z=${fmt(r.section.z, 0)} mm`),
    card("Beam shear steel", `${fmt(s.beamAvReqPerM, 0)} mm²/m`, `Vc=${fmt(s.Vc, 0)} kN`),
    card("Interface steel", `${fmt(s.interfaceAvReqPerM, 0)} req · ${fmt(s.additionalInterfaceReq, 0)} add`, interfaceConditionLabel(r.inputs.interfaceCondition)),
    card("Mf utilization", `${fmt(s.flexRatio, 2)}`, `Mf/Mr; Mr≈${fmt(s.flex.Mr,0)} kN·m`),
    card("Vf utilization", `${fmt(s.combinedShearRatio, 2)}`, `beam ${fmt(s.beamShearRatio, 2)} + interface ${fmt(s.interfaceShearRatio, 2)}`)
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
    checkCard("Vertical shear strength", s.verticalStrengthOk, `Vr=${fmt(s.Vr, 0)} kN ≥ Vf=${fmt(s.maxV, 0)} kN`, `Vc=${fmt(s.Vc, 0)} kN, Vs=${fmt(s.Vs, 0)} kN. Vr,max=${fmt(s.VrMax, 0)} kN.`),
    checkCard("Stirrup spacing", s.verticalSpacingOk, `s=${fmt(r.inputs.stirrupSpacing, 0)} mm ≤ ${fmt(s.sMax, 0)} mm`, `High-shear threshold=${fmt(s.highShearThreshold, 0)} kN.`),
    checkCard("Minimum shear steel", s.minSteelOk, `Av=${fmt(s.stirrupAvSet, 0)} mm² ≥ Av,min=${fmt(s.AvMin, 0)} mm²`, `Minimum steel checked for selected primary stirrup spacing.`),
    checkCard("Interface shear", s.interfaceOk, `Available=${fmt(s.totalInterfaceAvailable, 0)} mm²/m ≥ Req=${fmt(s.interfaceAvReqPerM, 0)} mm²/m`, `Unused stirrup balance=${fmt(s.unusedStirrupAv, 0)} mm²/m; added dowels=${fmt(s.dowelAvPerM, 0)} mm²/m.`),
    checkCard("Interface concrete limit", s.maxStress <= s.concreteLimit, `v=${fmt(s.maxStress, 3)} MPa ≤ ${fmt(s.concreteLimit, 2)} MPa`, `CSA-style upper-bound check 0.25ϕc f'c.`),
    checkCard("Zone schedule", (s.zoneSchedule || []).every(z => z.ok), `${(s.zoneSchedule || []).length} design zone${(s.zoneSchedule || []).length === 1 ? "" : "s"}`, `Uses local envelope; low-shear zones relax to code/minimum spacing where permitted.`),
    checkCard("Flexural utilization", s.flexUtilizationOk, `Mf/Mr = ${fmt(s.flexRatio, 2)} ≤ 1.00`, `Mr≈${fmt(s.flex.Mr, 0)} kN·m vs Mf=${fmt(s.maxMabs, 0)} kN·m. c≈${fmt(s.flex.c, 0)} mm.`, true),
    checkCard("Shear utilization", s.shearUtilizationOk, `Vf/Vr = ${fmt(s.combinedShearRatio, 2)} ≤ 1.00`, `Beam shear ${fmt(s.beamShearRatio, 2)} plus interface shear ${fmt(s.interfaceShearRatio, 2)}.`, true)
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
    const labelX = Math.min(left + plotW - 8, Math.max(left + 8, sx0 + 12));
    marker = `<circle cx="${sx0}" cy="${sy0}" r="4.2" fill="${stroke}" stroke="#fff" stroke-width="1.5"/>`;
    dynamicText = `<text x="${left + plotW - 8}" y="${yTop - 10}" text-anchor="end" font-size="11" font-weight="700" fill="#34495e">${fmt(raw, 1)} ${unit}</text>`;
  }
  return `
    <g class="mini-demand-diagram">
      <rect x="${left}" y="${yTop}" width="${plotW}" height="${plotH}" rx="8" fill="${bg}" stroke="#dbe3ec"/>
      <text x="${left}" y="${yTop - 10}" font-size="12" font-weight="850" fill="#34495e">${label}</text>
      ${dynamicText}
      ${!absMode ? `<line x1="${left}" y1="${p.zeroY}" x2="${left + plotW}" y2="${p.zeroY}" stroke="#c7d1dc" stroke-dasharray="5 5"/>` : `<line x1="${left}" y1="${p.zeroY}" x2="${left + plotW}" y2="${p.zeroY}" stroke="#c7d1dc"/>`}
      <path d="${fillPath}" fill="${fill}" opacity="0.16"/>
      <path d="${p.path}" fill="none" stroke="${stroke}" stroke-width="2.7"/>
      ${marker}
      <text x="${left + 8}" y="${yTop + 17}" font-size="10.5" fill="#667587">${fmt(p.ymax, 1)}</text>
      <text x="${left + 8}" y="${yTop + plotH - 7}" font-size="10.5" fill="#667587">${fmt(p.ymin, 1)}</text>
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
    marker = `<circle cx="${sx0}" cy="${sy0}" r="4.2" fill="#b26a00" stroke="#fff" stroke-width="1.5"/>`;
    dynamicText = `<text x="${left + plotW - 8}" y="${yTop - 10}" text-anchor="end" font-size="11" font-weight="700" fill="#34495e">q=${fmt(station.qDesign, 1)} kN/m · v=${fmt(station.vInterface, 3)} MPa</text>`;
  }
  return `
    <g class="mini-demand-diagram">
      <rect x="${left}" y="${yTop}" width="${plotW}" height="${plotH}" rx="8" fill="#fffaf2" stroke="#ead7b5"/>
      <text x="${left}" y="${yTop - 10}" font-size="12" font-weight="850" fill="#34495e">Interface q / v demand</text>
      ${dynamicText}
      <line x1="${left}" y1="${p.zeroY}" x2="${left + plotW}" y2="${p.zeroY}" stroke="#d9c4a0"/>
      <path d="${fillPath}" fill="#b26a00" opacity="0.18"/>
      <path d="${p.path}" fill="none" stroke="#b26a00" stroke-width="2.7"/>
      ${marker}
      <text x="${left + 8}" y="${yTop + 17}" font-size="10.5" fill="#806000">q: kN/m</text>
      <text x="${left + plotW - 8}" y="${yTop + 17}" text-anchor="end" font-size="10.5" fill="#806000">v: MPa</text>
      <text x="${left + 8}" y="${yTop + plotH - 7}" font-size="10.5" fill="#806000">0</text>
      <text x="${left + plotW - 8}" y="${yTop + plotH - 7}" text-anchor="end" font-size="10.5" fill="#806000">max ${fmt(qMax, 1)} / ${fmt(vMax, 3)}</text>
    </g>`;
}
function buildShearZones(r, left, plotW, L, y) {
  const schedule = r.summary.zoneSchedule || [];
  if (schedule.length) {
    return schedule.map((seg, idx) => {
      const color = idx % 2 === 0 ? "#b3261e" : "#b26a00";
      const ranges = seg.ranges || [{ x1: seg.x1, x2: seg.x2 }];
      return ranges.map((rg, ridx) => {
        const x1 = scaleX(rg.x1, L, left, plotW);
        const x2 = scaleX(rg.x2, L, left, plotW);
        const mid = (x1 + x2) / 2;
        const label = `${seg.name}: ${fmt(seg.primarySpacing,0)} mm${seg.dowelSpacing ? ` + D@${fmt(seg.dowelSpacing,0)}` : ""}`;
        return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="3.2"/>
                <line x1="${x1}" y1="${y - 12}" x2="${x1}" y2="${y + 12}" stroke="${color}" stroke-width="2"/>
                <line x1="${x2}" y1="${y - 8}" x2="${x2}" y2="${y + 8}" stroke="${color}" stroke-width="1.5" opacity="0.7"/>
                <text x="${mid}" y="${y + 21 + (ridx % 2) * 12}" text-anchor="middle" font-size="10.5" fill="${color}">${label}</text>`;
      }).join("");
    }).join("");
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
  return zones.map(seg => {
    const x1 = scaleX(seg.start, L, left, plotW);
    const x2 = scaleX(seg.end, L, left, plotW);
    const color = seg.zone === "A" ? "#b3261e" : "#b26a00";
    return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="3"/>
            <line x1="${x1}" y1="${y - 10}" x2="${x1}" y2="${y + 10}" stroke="${color}" stroke-width="2"/>
            <text x="${(x1 + x2)/2}" y="${y + 20}" text-anchor="middle" font-size="11" fill="${color}">Shear zone ${seg.zone}</text>`;
  }).join("");
}
function renderElevation(r) {
  const width = 980, height = 660, left = 78, right = 42;
  const L = beamLength(r.inputs);
  const plotW = width - left - right;
  const supports = supportLocations(r.inputs);
  const xP = r.inputs.Px;
  const includeP = r.inputs.includePoint && r.inputs.Pf !== 0;
  const st = activeStation(r);
  const local = st ? localDesignForStation(r, st) : null;

  const pxPerMmAlongSpan = plotW / Math.max(1, L * 1000);
  const totalBeamH = clamp(r.inputs.h * pxPerMmAlongSpan, 42, 96);
  const slabH = clamp(r.inputs.slabDepth * pxPerMmAlongSpan, 8, totalBeamH - 12);
  const webH = Math.max(22, totalBeamH - slabH);
  const topY = 68;
  const jointY = topY + slabH;
  const bottomY = topY + totalBeamH;
  const zoneY = bottomY + 38;
  const sliderTopY = zoneY + 6;

  let arrows = "";
  const wLabel = r.inputs.Wf !== 0 ? `<text x="${left + 3}" y="${topY - 22}" font-size="10.5" fill="#1f6feb">Wf=${fmt(r.inputs.Wf,1)} kN/m</text>` : "";
  const nArrows = 14;
  if (r.inputs.Wf !== 0) {
    for (let i = 0; i <= nArrows; i++) {
      const x = left + plotW * i / nArrows;
      arrows += `<line x1="${x}" y1="24" x2="${x}" y2="${topY - 6}" stroke="#1f6feb" stroke-width="2" marker-end="url(#arrowBlue)"/>`;
    }
  }

  const supportSvg = supports.map((sx, i) => {
    const x = scaleX(sx, L, left, plotW);
    if (r.inputs.beamSystem === "cantilever" && i === 0) {
      return `<rect x="${x - 12}" y="${topY - 18}" width="24" height="${totalBeamH + 42}" fill="#d9e2ec" stroke="#334e68"/>
              ${Array.from({ length: 7 }, (_, j) => `<line x1="${x - 18}" y1="${topY - 12 + j*14}" x2="${x - 36}" y2="${topY - 2 + j*14}" stroke="#8091a5"/>`).join("")}`;
    }
    return `<polygon points="${x},${bottomY + 4} ${x - 18},${bottomY + 34} ${x + 18},${bottomY + 34}" fill="#d9e2ec" stroke="#334e68"/>
            <line x1="${x - 28}" y1="${bottomY + 34}" x2="${x + 28}" y2="${bottomY + 34}" stroke="#334e68"/>`;
  }).join("");

  const pointSvg = includeP ? (() => {
    const x = scaleX(xP, L, left, plotW);
    return `<line x1="${x}" y1="14" x2="${x}" y2="${topY - 9}" stroke="#b3261e" stroke-width="4" marker-end="url(#arrowRed)"/>
            <text x="${x + 8}" y="24" fill="#b3261e" font-size="12" font-weight="800">Pf=${fmt(r.inputs.Pf, 0)} kN @ x=${fmt(xP, 2)} m</text>`;
  })() : "";

  const spanLabels = r.inputs.beamSystem === "twoSpan"
    ? `<text x="${scaleX(r.inputs.L1/2, L, left, plotW)}" y="${bottomY + 67}" text-anchor="middle" font-size="12">L1=${fmt(r.inputs.L1,2)} m</text>
       <text x="${scaleX(r.inputs.L1 + r.inputs.L2/2, L, left, plotW)}" y="${bottomY + 67}" text-anchor="middle" font-size="12">L2=${fmt(r.inputs.L2,2)} m</text>`
    : `<text x="${left + plotW/2}" y="${bottomY + 67}" text-anchor="middle" font-size="12">L=${fmt(r.inputs.L1,2)} m</text>`;

  const diagramTop = Math.max(270, sliderTopY + 34);
  const miniM = buildMiniDiagram(r, "M", "Mf diagram", "kN·m", diagramTop, left, plotW, 105, false, { positiveDown: true, bg: "#f7fbff", station: st });
  const miniV = buildMiniDiagram(r, "V", "Vf diagram", "kN", diagramTop + 132, left, plotW, 105, false, { bg: "#f7fafc", station: st });
  const miniInterface = buildMiniInterfaceDiagram(r, diagramTop + 264, left, plotW, 112, st);
  const cursorX = st ? scaleX(st.x, L, left, plotW) : left;
  const cursorBottom = diagramTop + 264 + 112;
  const zoneText = local ? `Shear zone ${local.zone}` : "";
  const cursorSvg = st ? `
    <line x1="${cursorX}" y1="${topY - 10}" x2="${cursorX}" y2="${cursorBottom}" stroke="#b3261e" stroke-width="1.5" stroke-dasharray="5 5"/>
    <circle cx="${cursorX}" cy="${jointY}" r="4" fill="#b3261e"/>
    <text x="${Math.min(width - 8, Math.max(8, cursorX))}" y="${zoneY - 14}" text-anchor="middle" font-size="10.5" fill="#b3261e" font-weight="700">x=${fmt(st.x,3)} m</text>
  ` : "";

  const svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Beam elevation with aligned demand diagrams">
    <defs>
      <marker id="arrowBlue" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#1f6feb"/></marker>
      <marker id="arrowRed" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#b3261e"/></marker>
    </defs>
    <text x="${left}" y="18" font-size="14" font-weight="800">Elevation: ${labelBeamSystem(r.inputs.beamSystem)}</text>
    ${wLabel}
    ${arrows}
    ${pointSvg}
    <rect x="${left}" y="${topY}" width="${plotW}" height="${slabH}" rx="4" fill="#dce9f8" stroke="#5f6f82"/>
    <rect x="${left}" y="${jointY}" width="${plotW}" height="${webH}" rx="4" fill="#e8edf3" stroke="#5f6f82"/>
    <line x1="${left}" y1="${jointY}" x2="${left + plotW}" y2="${jointY}" stroke="#b26a00" stroke-width="2.2" stroke-dasharray="7 6"/>
    <text x="${left + 8}" y="${jointY - 6}" font-size="11" fill="#6b4600" font-weight="700">cold joint / roughened interface</text>
    ${supportSvg}
    <line x1="${left - 24}" y1="${topY}" x2="${left - 24}" y2="${bottomY}" stroke="#8091a5"/>
    <line x1="${left - 38}" y1="${topY}" x2="${left - 22}" y2="${topY}" stroke="#8091a5"/>
    <line x1="${left - 38}" y1="${bottomY}" x2="${left - 22}" y2="${bottomY}" stroke="#8091a5"/>
    <text x="${left - 45}" y="${topY + totalBeamH/2}" transform="rotate(-90 ${left - 45} ${topY + totalBeamH/2})" font-size="12" text-anchor="middle">h=${fmt(r.inputs.h,0)} mm</text>
    <line x1="${left}" y1="${bottomY + 52}" x2="${left + plotW}" y2="${bottomY + 52}" stroke="#8091a5"/>
    <line x1="${left}" y1="${bottomY + 45}" x2="${left}" y2="${bottomY + 59}" stroke="#8091a5"/>
    <line x1="${left + plotW}" y1="${bottomY + 45}" x2="${left + plotW}" y2="${bottomY + 59}" stroke="#8091a5"/>
    ${spanLabels}
    ${buildShearZones(r, left, plotW, L, zoneY)}
    <text x="${left + plotW - 2}" y="${zoneY - 12}" text-anchor="end" font-size="11" fill="#667587">${zoneText}</text>
    ${miniM}
    ${miniV}
    ${miniInterface}
    ${cursorSvg}
  </svg>`;

  $("beamElevation").innerHTML = `
    <div class="beam-elev-wrap">
      ${svg}
      <div class="beam-slider-overlay" style="left:${(left / width * 100).toFixed(3)}%; width:${(plotW / width * 100).toFixed(3)}%; top:${(sliderTopY / height * 100).toFixed(3)}%;">
        <input id="stationSlider" type="range" min="0" max="${r.stations.length - 1}" step="1" value="${selectedStationIndex}" aria-label="Station along beam" />
      </div>
    </div>`;

  const slider = $("stationSlider");
  if (slider) {
    slider.addEventListener("input", () => {
      selectedStationIndex = parseInt(slider.value, 10) || 0;
      if (lastResult) {
        renderElevation(lastResult);
        renderCrossSection(lastResult);
      }
    });
  }
}
function labelBeamSystem(system) {
  if (system === "simple") return "single-span simply supported";
  if (system === "twoSpan") return "two-span continuous";
  if (system === "cantilever") return "cantilever";
  return system;
}

function zoneForStation(r, station) {
  const zones = r.summary.zoneSchedule || [];
  if (!station || !zones.length) return null;
  return zones.find(z => (z.ranges || [{ x1: z.x1, x2: z.x2 }]).some(rg => station.x >= rg.x1 - 1e-9 && station.x <= rg.x2 + 1e-9)) || zones[zones.length - 1];
}
function renderCrossSection(r) {
  const w = 500, hSvg = 520;
  const x0 = 82, y0 = 82;
  const maxW = 345, maxH = 278;
  const st = activeStation(r);
  const local = st ? localDesignForStation(r, st) : null;
  const zone = st ? zoneForStation(r, st) : null;
  const zonePrimarySpacing = zone ? zone.primarySpacing : r.inputs.stirrupSpacing;
  const zoneDowelSpacing = zone && zone.dowelSpacing ? zone.dowelSpacing : r.inputs.dowelSpacing;
  const scale = Math.min(maxW / Math.max(1, r.inputs.b), maxH / Math.max(1, r.inputs.h));
  const secW = r.inputs.b * scale;
  const secH = r.inputs.h * scale;
  const slabH = r.section.slabDepth * scale;
  const main = rebar(r.inputs.mainBar);
  const stirrup = rebar(r.inputs.stirrupBar);
  const dowel = rebar(r.inputs.dowelBar);
  const mainR = Math.max(2.0, (main.diameter * scale) / 2);
  const stirrupW = Math.max(1.5, stirrup.diameter * scale);
  const dowelW = Math.max(1.5, dowel.diameter * scale);
  const coverPx = Math.max(5, r.inputs.cover * scale);
  const innerX0 = x0 + coverPx + stirrupW;
  const innerX1 = x0 + secW - coverPx - stirrupW;
  const innerY0 = y0 + coverPx;
  const innerY1 = y0 + secH - coverPx;

  const count = Math.max(1, Math.round(r.inputs.mainCount));
  const rows = count === 1 ? 1 : 2;
  const bottomCount = rows === 1 ? count : Math.ceil(count / 2);
  const topCount = rows === 1 ? 0 : count - bottomCount;
  const rowGap = Math.max(2.9 * mainR, 12);
  const bottomYBars = innerY1 - mainR;
  const topYBars = bottomYBars - rowGap;

  function rowBars(n, y) {
    if (n <= 0) return "";
    const usable = Math.max(0, innerX1 - innerX0 - 2 * mainR);
    return Array.from({ length: n }, (_, i) => {
      const bx = n === 1 ? (innerX0 + innerX1) / 2 : innerX0 + mainR + i * (usable / Math.max(1, n - 1));
      return `<circle cx="${bx}" cy="${y}" r="${mainR}" fill="#1f2937"/>`;
    }).join("");
  }
  const bars = rowBars(topCount, topYBars) + rowBars(bottomCount, bottomYBars);

  const stirrupLegs = Math.max(0, Math.round(r.inputs.stirrupLegs));
  let legs = "";
  const nLegs = Math.min(24, stirrupLegs);
  for (let i = 0; i < nLegs; i++) {
    const lx = innerX0 + i * ((innerX1 - innerX0) / Math.max(1, nLegs - 1));
    legs += `<line x1="${lx}" y1="${innerY0}" x2="${lx}" y2="${innerY1}" stroke="#2a5caa" stroke-width="${stirrupW}" opacity="0.82"/>`;
  }

  const dowelLegs = Math.max(0, Math.round(r.inputs.dowelLegs));
  let dowels = "";
  const nDowels = Math.min(16, dowelLegs);
  for (let i = 0; i < nDowels; i++) {
    const dx = innerX0 + (i + 0.5) * ((innerX1 - innerX0) / Math.max(1, nDowels));
    dowels += `<path d="M${dx},${y0 + slabH - 18} V${y0 + slabH + 44} q0,8 8,8 h10" fill="none" stroke="#b3261e" stroke-width="${dowelW}" stroke-linecap="round"/>`;
  }

  const noteY = y0 + secH + 40;
  const stationTitle = st ? `Station x=${fmt(st.x,3)} m · Shear zone ${local.zone}` : "Selected section";
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
    <text x="${x0}" y="${noteY + 21}" font-size="12" fill="#2a5caa">Primary: ${fmt(r.inputs.stirrupLegs,0)} legs ${r.inputs.stirrupBar} @ ${fmt(zonePrimarySpacing,0)} mm${zone ? ` (${zone.name})` : ``}</text>
    <text x="${x0}" y="${noteY + 42}" font-size="12" fill="#b3261e">Add: ${r.inputs.dowelLegs > 0 && zoneDowelSpacing ? `${fmt(r.inputs.dowelLegs,0)} legs ${r.inputs.dowelBar} @ ${fmt(zoneDowelSpacing,0)} mm` : `None`}</text>
    <text x="${x0}" y="${noteY + 63}" font-size="12" fill="#1f2937">Bottom: ${fmt(r.inputs.mainCount,0)}-${r.inputs.mainBar}; shown in ${rows} row${rows>1?'s':''}</text>
    <text x="${x0}" y="${noteY + 84}" font-size="11" fill="#667587">${localLine}</text>
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

function reportLine(label, value, note = "") {
  return { label, value, note };
}

function buildCalculationReportSections(r) {
  const i = r.inputs;
  const sec = r.section;
  const s = r.summary;
  const main = rebar(i.mainBar);
  const stirrup = rebar(i.stirrupBar);
  const dowel = rebar(i.dowelBar);
  const slabArea = i.b * sec.slabDepth;
  const slabCentroid = sec.slabDepth / 2;
  const na = sec.neutralAxisFromTop;
  const qModel = demandModelLabel(i.interfaceDemandModel);
  const reactions = r.fe.reactions.map((rx, idx) => `R${idx + 1} = ${fmt(rx.vertical, 2)} kN at x=${fmt(rx.x, 3)} m`).join("; ");
  const st = activeStation(r);
  const local = st ? localDesignForStation(r, st) : null;

  return [
    {
      title: "1. Inputs and design assumptions",
      lines: [
        reportLine("Beam system", `${labelBeamSystem(i.beamSystem)}; L1=${fmt(i.L1,3)} m${i.beamSystem === "twoSpan" ? `, L2=${fmt(i.L2,3)} m` : ""}`),
        reportLine("Factored loading", `Wf=${fmt(i.Wf,3)} kN/m${i.includePoint ? `; Pf=${fmt(i.Pf,3)} kN at x=${fmt(i.Px,3)} m` : "; no point load included"}`),
        reportLine("Geometry", `b=${fmt(i.b,0)} mm; h=${fmt(i.h,0)} mm; second-placement slab depth=${fmt(sec.slabDepth,0)} mm`),
        reportLine("Materials", `f'c=${fmt(i.fc,2)} MPa; fy=${fmt(i.fy,0)} MPa; λ=${fmt(i.lambda,2)}; ϕc=${fmt(i.phiC,2)}; ϕs=${fmt(i.phiS,2)}`),
        reportLine("Interface assumption", `${interfaceConditionLabel(i.interfaceCondition)}; c=${fmt(i.cohesion,2)} MPa; μ=${fmt(i.mu,2)}; demand model=${qModel}`),
        reportLine("Selected reinforcement", `Primary=${fmt(i.stirrupLegs,0)} legs ${i.stirrupBar} @ ${fmt(i.stirrupSpacing,0)} mm; additional=${fmt(i.dowelLegs,0)} legs ${i.dowelBar} @ ${fmt(i.dowelSpacing,0)} mm; bottom steel=${fmt(i.mainCount,0)}-${i.mainBar}`)
      ]
    },
    {
      title: "2. Section properties for shear flow",
      lines: [
        reportLine("Gross inertia", `Ig = b h³ / 12 = ${fmt(i.b,0)} × ${fmt(i.h,0)}³ / 12 = ${fmt(sec.Ig,0)} mm⁴`),
        reportLine("Neutral axis", `ȳ = h / 2 = ${fmt(na,1)} mm from top for the gross rectangular section`),
        reportLine("Area above interface", `A = b ts = ${fmt(i.b,0)} × ${fmt(sec.slabDepth,0)} = ${fmt(slabArea,0)} mm²`),
        reportLine("First moment of area", `Q = A(ȳ - ts/2) = ${fmt(slabArea,0)} × (${fmt(na,1)} - ${fmt(slabCentroid,1)}) = ${fmt(sec.Q,0)} mm³`),
        reportLine("Effective depth", `d = h - cover - db,stirrup - db,main/2 = ${fmt(sec.d,1)} mm`, `${i.stirrupBar} db=${fmt(stirrup.diameter,1)} mm; ${i.mainBar} db=${fmt(main.diameter,1)} mm`),
        reportLine("Effective shear depth", `dv = max(0.9d, 0.72h) = max(${fmt(0.9*sec.d,1)}, ${fmt(0.72*i.h,1)}) = ${fmt(sec.dv,1)} mm`),
        reportLine("Cracked force-flow lever arm", `z = max(0.5d, ${fmt(i.zFactor,2)}d) = ${fmt(sec.z,1)} mm`)
      ]
    },
    {
      title: "3. Beam actions and demand envelopes",
      lines: [
        reportLine("Support reactions", reactions || "—"),
        reportLine("Maximum shear", `max |Vf| = ${fmt(s.maxV,2)} kN`),
        reportLine("Maximum moment", `max |Mf| = ${fmt(s.maxMabs,2)} kN·m`, `max sagging=${fmt(s.maxMpos,2)} kN·m; max hogging=${fmt(s.maxMneg,2)} kN·m`),
        reportLine("Elastic interface shear flow", `q = VQ/I; max q=${fmt(s.maxQ,2)} kN/m`),
        reportLine("Interface stress", `v = q / b = ${fmt(s.maxQ,2)} / ${fmt(i.b,0)} = ${fmt(s.maxStress,4)} MPa`)
      ]
    },
    {
      title: "4. Flexural resistance estimate",
      lines: [
        reportLine("Tension steel", `As = ${fmt(i.mainCount,0)} × ${fmt(main.area,0)} = ${fmt(sec.As,0)} mm²`),
        reportLine("Stress block factors", `α1=${fmt(s.flex.alpha1,3)}; β1=${fmt(s.flex.beta1,3)}`),
        reportLine("Compression block depth", `a = ϕs As fy / (α1 ϕc f'c b) = ${fmt(s.flex.a,1)} mm`),
        reportLine("Neutral axis depth", `c = a / β1 = ${fmt(s.flex.c,1)} mm from top`),
        reportLine("Moment resistance", `Mr = ϕs As fy(d - a/2) = ${fmt(s.flex.Mr,2)} kN·m`),
        reportLine("Flexural utilization", `Mf/Mr = ${fmt(s.flexRatio,3)} → ${reportStatus(s.flexUtilizationOk)}`)
      ]
    },
    {
      title: "5. Vertical beam shear design check",
      lines: [
        reportLine("Simplified shear parameters", `β=${fmt(s.beta,3)}; θ=${fmt(s.thetaDeg,1)}°; cotθ=${fmt(s.cotTheta,3)}`),
        reportLine("Concrete shear resistance", `Vc = ϕc λ β √f'c b dv = ${fmt(s.Vc,2)} kN`),
        reportLine("Beam shear steel required", `(Av/s)beam = max[0, (Vf - Vc) / (ϕs fy dv cotθ)] = ${fmt(s.beamAvReqPerM,2)} mm²/m`),
        reportLine("Primary stirrup area", `Av,set = ${fmt(i.stirrupLegs,0)} × ${fmt(stirrup.area,0)} = ${fmt(s.stirrupAvSet,0)} mm²`),
        reportLine("Primary stirrup steel per metre", `Av/s = ${fmt(s.stirrupAvSet,0)} / ${fmt(i.stirrupSpacing,0)} × 1000 = ${fmt(s.stirrupAvPerM,2)} mm²/m`),
        reportLine("Steel shear resistance", `Vs = ϕs(Av/s)fy dv cotθ = ${fmt(s.Vs,2)} kN`),
        reportLine("Total vertical shear resistance", `Vr = Vc + Vs = ${fmt(s.Vr,2)} kN → ${reportStatus(s.verticalStrengthOk)}`),
        reportLine("Maximum shear resistance", `Vr,max = 0.25 ϕc f'c b dv = ${fmt(s.VrMax,2)} kN`),
        reportLine("Spacing limit", `High-shear threshold=${fmt(s.highShearThreshold,2)} kN; smax=${fmt(s.sMax,1)} mm; selected s=${fmt(i.stirrupSpacing,0)} mm → ${reportStatus(s.verticalSpacingOk)}`),
        reportLine("Minimum shear reinforcement", `Av,min = 0.06√f'c b s / fy = ${fmt(s.AvMin,1)} mm²; provided=${fmt(s.stirrupAvSet,1)} mm² → ${reportStatus(s.minSteelOk)}`)
      ]
    },
    {
      title: "6. Cold-joint interface shear-transfer check",
      lines: [
        reportLine("Interface demand", `vf=${fmt(s.maxStress,4)} MPa from ${qModel}`),
        reportLine("Required clamping ratio", `ρv = max[0, (vf/(λϕc) - c) / (μ fy)] = ${fmt(s.rhoReq,6)}`),
        reportLine("Required crossing steel", `(Av/s)interface = ρv b × 1000 = ${fmt(s.interfaceAvReqPerM,2)} mm²/m`),
        reportLine("Concrete stress limit", `vlimit = 0.25ϕc f'c = ${fmt(s.concreteLimit,3)} MPa; vf=${fmt(s.maxStress,4)} MPa → ${reportStatus(s.maxStress <= s.concreteLimit)}`),
        reportLine("Interface stress resistance", `vr = min[0.25ϕc f'c, λϕc(c + μρv,prov fy)] = ${fmt(s.interfaceStressResistance,4)} MPa`)
      ]
    },
    {
      title: "7. Conservative steel allocation / additional dowel check",
      lines: [
        reportLine("Allocation method", i.allocation === "balance" ? "Subtract beam shear steel from available primary stirrup steel before crediting interface shear." : "Credit full crossing stirrup steel to the interface check."),
        reportLine("Unused primary stirrup balance", `Av,unused = ${fmt(s.unusedStirrupAv,2)} mm²/m`),
        reportLine("Additional interface steel required", `Av,add,req = max[0, Av,interface,req - Av,unused] = ${fmt(s.additionalInterfaceReq,2)} mm²/m`),
        reportLine("Additional dowel/hairpin provided", `Av,dowel = ${fmt(i.dowelLegs,0)} × ${fmt(dowel.area,0)} / ${fmt(i.dowelSpacing,0)} × 1000 = ${fmt(s.dowelAvPerM,2)} mm²/m`),
        reportLine("Total interface steel available", `Av,total = Av,unused + Av,dowel = ${fmt(s.totalInterfaceAvailable,2)} mm²/m → ${reportStatus(s.interfaceOk)}`)
      ]
    },
    {
      title: "8. Shear zone design schedule",
      lines: (s.zoneSchedule || []).map(z => reportLine(
        `${z.name} (${fmt(z.x1,2)}–${fmt(z.x2,2)} m)`,
        `${fmt(i.stirrupLegs,0)} legs ${i.stirrupBar} @ ${fmt(z.primarySpacing,0)} mm${z.dowelSpacing ? `; add ${fmt(i.dowelLegs,0)} legs ${i.dowelBar} @ ${fmt(z.dowelSpacing,0)} mm` : z.addReq > 1e-9 ? `; added interface steel required ${fmt(z.addReq,0)} mm²/m` : "; no added dowels"}`,
        `Governing station x=${fmt(z.gov.station.x,3)} m; |Vf|=${fmt(Math.abs(z.gov.station.V),1)} kN; |Mf|=${fmt(Math.abs(z.gov.station.M),1)} kN·m; status=${reportStatus(z.ok)}`
      ))
    },
    {
      title: "9. Utilization summary",
      lines: [
        reportLine("Flexure", `Mf/Mr = ${fmt(s.flexRatio,3)} → ${reportStatus(s.flexUtilizationOk)}`),
        reportLine("Beam shear", `Vbeam/Vr,beam = ${fmt(s.beamShearRatio,3)}`),
        reportLine("Interface shear", `Vinterface/Vr,interface = ${fmt(s.interfaceShearRatio,3)}`),
        reportLine("Combined shear utilization", `Vf/Vr = beam + interface = ${fmt(s.combinedShearRatio,3)} → ${reportStatus(s.shearUtilizationOk)}`),
        ...(st && local ? [reportLine("Selected station", `x=${fmt(st.x,3)} m; zone ${local.zone}; Vf=${fmt(st.V,2)} kN; Mf=${fmt(st.M,2)} kN·m; q=${fmt(st.qDesign,2)} kN/m; v=${fmt(st.vInterface,4)} MPa`)] : [])
      ]
    }
  ];
}

function renderReport(r) {
  const target = $("calculationReport");
  if (!target) return;
  const sections = buildCalculationReportSections(r);
  target.innerHTML = sections.map((sec, idx) => `
    <details class="report-section" ${idx < 3 ? "open" : ""}>
      <summary>${sec.title}</summary>
      <div class="report-lines">
        ${sec.lines.map(line => `
          <div class="report-row">
            <div class="report-label">${line.label}</div>
            <div class="report-value">${line.value}</div>
            ${line.note ? `<div class="report-subnote">${line.note}</div>` : ""}
          </div>`).join("")}
      </div>
    </details>`).join("");
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
    sec.lines.forEach(item => {
      lines.push(`- **${item.label}:** ${item.value}${item.note ? ` (${item.note})` : ""}`);
    });
    lines.push("");
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

function previewAutoDesign(apply = false) {
  if (!lastResult) runCalculations();
  const r = lastResult;
  const concept = $("autoZoneCount") ? val("autoZoneCount") : "zoned";
  const strategy = $("autoStrategy") ? val("autoStrategy") : "primaryOnly";
  const maxPractical = Math.max(75, num("autoMaxSpacing") || r.inputs.zoneMaxSpacing || 450);
  const zoneStrategy = strategy === "addDowels" ? "addDowels" : "primaryFirst";

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
  sim.summary.zoneSchedule = computeZoneSchedule(sim);
  Object.assign(sim.summary, evaluateZoneScheduleUtilization(sim));

  const zones = sim.summary.zoneSchedule || [];
  const minPrimary = zones.length ? Math.min(...zones.map(z => z.primarySpacing || sim.inputs.stirrupSpacing)) : sim.inputs.stirrupSpacing;
  const needsDowels = zones.some(z => z.dowelSpacing);
  const maxUtil = sim.summary.zoneCombinedShearRatio;
  const zoneText = concept === "uniform" ? "uniform" : "zoned";
  const message = `${zoneText} proposal: ${fmt(sim.inputs.stirrupLegs,0)} legs ${sim.inputs.stirrupBar}; tightest primary spacing ${fmt(minPrimary,0)} mm; ${needsDowels ? `added ${fmt(sim.inputs.dowelLegs,0)} legs ${sim.inputs.dowelBar} where required` : "no added dowels required"}. Max shear utilization ${fmt(maxUtil,2)}.`;

  if ($("autoDesignResult")) $("autoDesignResult").textContent = message;

  if (apply) {
    $("zoneDesignMode").value = sim.inputs.zoneDesignMode;
    $("zoneDesignStrategy").value = sim.inputs.zoneDesignStrategy;
    $("zoneMaxSpacing").value = maxPractical;
    $("stirrupSpacing").value = minPrimary;
    if (needsDowels && sim.inputs.dowelLegs > 0) {
      $("dowelLegs").value = sim.inputs.dowelLegs;
      const firstDowelZone = zones.find(z => z.dowelSpacing);
      if (firstDowelZone) $("dowelSpacing").value = firstDowelZone.dowelSpacing;
    } else {
      $("dowelLegs").value = 0;
    }
    updateConditionalInputs();
    runCalculations();
    if ($("autoDesignResult")) $("autoDesignResult").textContent = "Applied: " + message;
  }
}
function setStationFromClientX(clientX) {
  if (!lastResult) return;
  const host = $("beamElevation");
  const svg = host ? host.querySelector("svg") : null;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const leftPct = 78 / 980;
  const plotPct = 860 / 980;
  const ratio = clamp(((clientX - rect.left) / Math.max(1, rect.width) - leftPct) / plotPct, 0, 1);
  const targetX = ratio * beamLength(lastResult.inputs);
  let closest = 0;
  for (let i = 1; i < lastResult.stations.length; i++) {
    if (Math.abs(lastResult.stations[i].x - targetX) < Math.abs(lastResult.stations[closest].x - targetX)) closest = i;
  }
  selectedStationIndex = closest;
  renderElevation(lastResult);
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
      runCalculations();
    });
    el.addEventListener("input", () => {
      if (el.type === "number") { updateConditionalInputs(); runCalculations(); }
    });
  });
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
