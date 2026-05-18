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
  dowelSpacing: 350
};

let lastResult = null;

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
    dowelSpacing: num("dowelSpacing")
  };

  inputs.L1 = Math.max(0.1, inputs.L1);
  inputs.L2 = Math.max(0.1, inputs.L2);
  inputs.Px = Math.max(0, Math.min(beamLength(inputs), inputs.Px));
  inputs.stationCount = Math.max(51, Math.min(501, inputs.stationCount));
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
    let V = 0;
    let M = 0;

    fe.reactions.forEach(r => {
      if (x + 1e-9 >= r.x) {
        V += r.vertical;
        M += r.vertical * (x - r.x);
      }
    });

    // Include fixed-end support moments when present, chiefly for cantilever.
    fe.supportMoments.forEach(r => {
      if (x + 1e-9 >= r.x) {
        M -= r.moment;
      }
    });

    V -= inputs.Wf * x;
    M -= inputs.Wf * x * x / 2;

    if (inputs.includePoint && inputs.Pf !== 0 && x + 1e-9 >= inputs.Px) {
      V -= inputs.Pf;
      M -= inputs.Pf * (x - inputs.Px);
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
  const combinedUtilization = flexRatio + combinedShearRatio;
  const combinedOk = combinedUtilization <= 1.0;

  const result = {
    inputs, section, fe, stations,
    summary: { maxV, maxMpos, maxMneg, maxMabs, maxQ, maxStress, Vc, Vs, Vr, VrMax, beta, thetaDeg, cotTheta, beamAvReqPerM: beamAvReqPerM2, highShearThreshold, sMax, AvMin, stirrupAvSet, stirrupAvPerM, dowelAvSet, dowelAvPerM, rhoReq, interfaceAvReqPerM, concreteLimit, unusedStirrupAv, additionalInterfaceReq, totalInterfaceAvailable, interfaceStressResistanceRaw, interfaceStressResistance, beamShearRatio, interfaceShearRatio, flexRatio, combinedShearRatio, combinedUtilization, combinedOk, verticalStrengthOk, verticalSpacingOk, minSteelOk, interfaceOk, flex }
  };

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
  renderElevation(result);
  renderCrossSection(result);
  renderCharts(result);
  renderTable(result);

  const ok = result.summary.verticalStrengthOk && result.summary.verticalSpacingOk && result.summary.minSteelOk && result.summary.interfaceOk && result.summary.flex.ok && result.summary.combinedOk;
  const hasWarning = !result.summary.flex.ok;
  const status = $("overallStatus");
  status.className = "status-chip " + (ok ? "ok" : hasWarning ? "warn" : "ng");
  status.textContent = ok ? "OK" : hasWarning ? "Review" : "NG";
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

function renderSummary(r) {
  const s = r.summary;
  const reactions = r.fe.reactions.map((rx, i) => `R${i + 1}=${fmt(rx.vertical, 0)}`).join(", ");
  $("summaryCards").innerHTML = [
    card("Max |Vf|", `${fmt(s.maxV, 0)} kN`, reactions),
    card("Max Mf", `${fmt(s.maxMabs, 0)} kN·m`, `+${fmt(s.maxMpos, 0)}, hog ${fmt(s.maxMneg, 0)}`),
    card("Max q + v", `${fmt(s.maxQ, 0)} kN/m · ${fmt(s.maxStress, 3)} MPa`, `${demandModelLabel(r.inputs.interfaceDemandModel)}`),
    card("dv / d", `${fmt(r.section.dv, 0)} / ${fmt(r.section.d, 0)} mm`, `z=${fmt(r.section.z, 0)} mm`),
    card("Beam shear steel", `${fmt(s.beamAvReqPerM, 0)} mm²/m`, `Vc=${fmt(s.Vc, 0)} kN`),
    card("Interface steel", `${fmt(s.interfaceAvReqPerM, 0)} req · ${fmt(s.additionalInterfaceReq, 0)} add`, `${interfaceConditionLabel(r.inputs.interfaceCondition)}`),
    card("ULS utilization", `${fmt(s.combinedUtilization, 2)}`, `M/Mr=${fmt(s.flexRatio, 2)}; V/Vr=${fmt(s.beamShearRatio, 2)}+${fmt(s.interfaceShearRatio, 2)} ≤ 1.0`)
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
    checkCard("Flexural estimate", s.flex.ok, `Mr≈${fmt(s.flex.Mr, 0)} kN·m vs Mf=${fmt(s.maxMabs, 0)} kN·m`, `Approximate singly-reinforced rectangular stress-block estimate. c≈${fmt(s.flex.c, 0)} mm.`, true),
    checkCard("Combined utilization", s.combinedOk, `M/Mr + V/Vr = ${fmt(s.combinedUtilization, 2)} ≤ 1.00`, `V/Vr is beam shear ${fmt(s.beamShearRatio, 2)} plus interface shear ${fmt(s.interfaceShearRatio, 2)}.`, true)
  ].join("");
}

function scaleX(x, L, left, width) {
  return left + (x / L) * width;
}

function miniPathData(stations, key, left, yTop, plotW, plotH, absMode) {
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
  const sy = y => yTop + (1 - ((y - ymin) / Math.max(1e-9, ymax - ymin))) * plotH;
  const path = stations.map((d, i) => `${i === 0 ? "M" : "L"} ${sx(d.x).toFixed(2)} ${sy(absMode ? Math.abs(d[key]) : d[key]).toFixed(2)}`).join(" ");
  return { path, zeroY: sy(0), ymax, ymin };
}

function buildMiniDiagram(r, key, label, unit, yTop, left, plotW, plotH, absMode) {
  const p = miniPathData(r.stations, key, left, yTop, plotW, plotH, absMode);
  const maxVal = Math.max(...r.stations.map(s => Math.abs(s[key])));
  return `
    <text x="${left}" y="${yTop - 9}" font-size="12" font-weight="800" fill="#34495e">${label}</text>
    <text x="${left + 92}" y="${yTop - 9}" font-size="11" fill="#667587">max ${fmt(maxVal, 1)} ${unit}</text>
    <line x1="${left}" y1="${yTop}" x2="${left}" y2="${yTop + plotH}" stroke="#c7d1dc"/>
    <line x1="${left}" y1="${yTop + plotH}" x2="${left + plotW}" y2="${yTop + plotH}" stroke="#c7d1dc"/>
    ${!absMode ? `<line x1="${left}" y1="${p.zeroY}" x2="${left + plotW}" y2="${p.zeroY}" stroke="#dbe3ec" stroke-dasharray="4 4"/>` : ""}
    <path d="${p.path}" fill="none" stroke="#1f6feb" stroke-width="2.2"/>`;
}

function buildShearZones(r, left, plotW, L, y) {
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
  const width = 980, height = 465, left = 78, right = 42;
  const L = beamLength(r.inputs);
  const plotW = width - left - right;
  const supports = supportLocations(r.inputs);
  const xP = r.inputs.Px;
  const includeP = r.inputs.includePoint && r.inputs.Pf !== 0;

  const pxPerMmAlongSpan = plotW / Math.max(1, L * 1000);
  const totalBeamH = clamp(r.inputs.h * pxPerMmAlongSpan, 42, 96);
  const slabH = clamp(r.inputs.slabDepth * pxPerMmAlongSpan, 8, totalBeamH - 12);
  const webH = Math.max(22, totalBeamH - slabH);
  const topY = 68;
  const jointY = topY + slabH;
  const bottomY = topY + totalBeamH;
  const zoneY = bottomY + 34;

  let arrows = "";
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

  const miniM = buildMiniDiagram(r, "M", "Mf diagram", "kN·m", 238, left, plotW, 70, false);
  const miniV = buildMiniDiagram(r, "V", "Vf diagram", "kN", 348, left, plotW, 70, false);

  $("beamElevation").innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Beam elevation with aligned demand diagrams">
    <defs>
      <marker id="arrowBlue" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#1f6feb"/></marker>
      <marker id="arrowRed" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#b3261e"/></marker>
    </defs>
    <text x="${left}" y="18" font-size="14" font-weight="800">Elevation: ${labelBeamSystem(r.inputs.beamSystem)}</text>
    <text x="${left + 245}" y="18" font-size="11" fill="#667587">Method: simplified CSA-style beam shear + ${demandModelLabel(r.inputs.interfaceDemandModel)} interface demand</text>
    <text x="${left}" y="36" font-size="11" fill="#667587">Wf=${fmt(r.inputs.Wf,1)} kN/m</text>
    ${arrows}
    ${pointSvg}
    <rect x="${left}" y="${topY}" width="${plotW}" height="${slabH}" rx="4" fill="#dce9f8" stroke="#5f6f82"/>
    <rect x="${left}" y="${jointY}" width="${plotW}" height="${webH}" rx="4" fill="#e8edf3" stroke="#5f6f82"/>
    <line x1="${left}" y1="${jointY}" x2="${left + plotW}" y2="${jointY}" stroke="#b26a00" stroke-width="3" stroke-dasharray="8 6"/>
    <text x="${left + 8}" y="${jointY - 7}" font-size="11" font-weight="800" fill="#6b4600">cold joint / roughened interface</text>
    ${supportSvg}
    <line x1="${left - 30}" y1="${topY}" x2="${left - 30}" y2="${bottomY}" stroke="#8091a5"/>
    <line x1="${left - 38}" y1="${topY}" x2="${left - 22}" y2="${topY}" stroke="#8091a5"/>
    <line x1="${left - 38}" y1="${bottomY}" x2="${left - 22}" y2="${bottomY}" stroke="#8091a5"/>
    <text x="${left - 45}" y="${topY + totalBeamH/2}" transform="rotate(-90 ${left - 45} ${topY + totalBeamH/2})" font-size="12" text-anchor="middle">h=${fmt(r.inputs.h,0)} mm</text>
    <line x1="${left}" y1="${bottomY + 52}" x2="${left + plotW}" y2="${bottomY + 52}" stroke="#8091a5"/>
    <line x1="${left}" y1="${bottomY + 45}" x2="${left}" y2="${bottomY + 59}" stroke="#8091a5"/>
    <line x1="${left + plotW}" y1="${bottomY + 45}" x2="${left + plotW}" y2="${bottomY + 59}" stroke="#8091a5"/>
    ${spanLabels}
    ${buildShearZones(r, left, plotW, L, zoneY)}
    ${miniM}
    ${miniV}
  </svg>`;
}

function labelBeamSystem(system) {
  if (system === "simple") return "single-span simply supported";
  if (system === "twoSpan") return "two-span continuous";
  if (system === "cantilever") return "cantilever";
  return system;
}

function renderCrossSection(r) {
  const w = 330, hSvg = 360;
  const x0 = 48, y0 = 62;
  const maxW = 230, maxH = 185;
  const scale = Math.min(maxW / Math.max(1, r.inputs.b), maxH / Math.max(1, r.inputs.h));
  const secW = r.inputs.b * scale;
  const secH = r.inputs.h * scale;
  const slabH = r.section.slabDepth * scale;
  const main = rebar(r.inputs.mainBar);
  const stirrup = rebar(r.inputs.stirrupBar);
  const dowel = rebar(r.inputs.dowelBar);
  const mainR = Math.max(1.35, (main.diameter * scale) / 2);
  const stirrupW = Math.max(1.05, stirrup.diameter * scale);
  const dowelW = Math.max(1.05, dowel.diameter * scale);
  const coverPx = Math.max(5, r.inputs.cover * scale);
  const innerX0 = x0 + coverPx + stirrupW;
  const innerX1 = x0 + secW - coverPx - stirrupW;
  const innerY0 = y0 + coverPx;
  const innerY1 = y0 + secH - coverPx;

  const count = Math.max(1, Math.round(r.inputs.mainCount));
  const usableW = Math.max(10, innerX1 - innerX0 - 2 * mainR);
  const maxCols = Math.max(1, Math.floor(usableW / Math.max(2.2 * mainR, 5)) + 1);
  const cols = Math.min(count, Math.max(2, Math.min(maxCols, Math.ceil(Math.sqrt(count * r.inputs.b / Math.max(1, r.inputs.h))))));
  const rows = Math.ceil(count / cols);
  let bars = "";
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const bx = innerX0 + mainR + col * (usableW / Math.max(1, cols - 1));
    const by = innerY1 - mainR - row * Math.max(2.6 * mainR, 7);
    if (by > innerY0 + mainR) bars += `<circle cx="${bx}" cy="${by}" r="${mainR}" fill="#1f2937"/>`;
  }

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

  const noteY = y0 + secH + 42;
  $("crossSection").innerHTML = `<svg viewBox="0 0 ${w} ${hSvg}" role="img" aria-label="Cross-section reinforcement drawn to scale">
    <text x="${x0}" y="22" font-size="14" font-weight="850">Cross-section</text>
    <text x="${x0}" y="39" font-size="11" fill="#2d3b4d">b=${fmt(r.inputs.b,0)} mm, h=${fmt(r.inputs.h,0)} mm</text>
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
    <text x="${x0}" y="${noteY}" font-size="10.5" fill="#2d3b4d"><tspan font-weight="800">Second slab:</tspan> t=${fmt(r.inputs.slabDepth,0)} mm · <tspan fill="#6b4600" font-weight="800">roughened interface</tspan></text>
    <text x="${x0}" y="${noteY + 17}" font-size="10.5" fill="#2a5caa">Primary: ${fmt(r.inputs.stirrupLegs,0)} legs ${r.inputs.stirrupBar} @ ${fmt(r.inputs.stirrupSpacing,0)} mm</text>
    <text x="${x0}" y="${noteY + 34}" font-size="10.5" fill="#b3261e">Add: ${fmt(r.inputs.dowelLegs,0)} legs ${r.inputs.dowelBar} @ ${fmt(r.inputs.dowelSpacing,0)} mm</text>
    <text x="${x0}" y="${noteY + 51}" font-size="10.5" fill="#1f2937">Bottom: ${fmt(r.inputs.mainCount,0)}-${r.inputs.mainBar}; bar diameters shown to drawing scale</text>
  </svg>`;
}

function renderCharts(r) {
  drawChart("momentChart", r.stations, "x", "M", "kN·m", false);
  drawChart("shearChart", r.stations, "x", "V", "kN", false);
  drawChart("flowChart", r.stations, "x", "qDesign", "kN/m", true);
  drawChart("stressChart", r.stations, "x", "vInterface", "MPa", true);
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
  const s = r.summary;
  const strategy = $("autoStrategy") ? val("autoStrategy") : "primaryOnly";
  const zones = $("autoZoneCount") ? val("autoZoneCount") : "1";
  const maxPractical = Math.max(75, num("autoMaxSpacing") || 450);
  const primarySet = s.stirrupAvSet;
  const dowel = rebar(r.inputs.dowelBar);
  const preferredDowelLegs = Math.max(4, Math.round(r.inputs.dowelLegs || 4));
  const dowelSet = preferredDowelLegs * dowel.area;
  let newPrimarySpacing = r.inputs.stirrupSpacing;
  let newDowelLegs = r.inputs.dowelLegs;
  let newDowelSpacing = r.inputs.dowelSpacing;
  let message = "";

  const minSteelSpacingLimit = primarySet > 0 ? primarySet * Math.max(1, r.inputs.fy) / Math.max(1, 0.06 * Math.sqrt(Math.max(0, r.inputs.fc)) * r.section.b) : 75;

  if (strategy === "primaryOnly") {
    const totalReq = r.inputs.allocation === "balance" ? s.interfaceAvReqPerM + s.beamAvReqPerM : s.interfaceAvReqPerM;
    const spacingLimit = Math.min(maxPractical, s.sMax, minSteelSpacingLimit, primarySet * 1000 / Math.max(1, totalReq));
    newPrimarySpacing = niceSpacing(spacingLimit);
    newDowelLegs = 0;
    newDowelSpacing = r.inputs.dowelSpacing;
    message = `Primary-only proposal: ${fmt(r.inputs.stirrupLegs,0)} legs ${r.inputs.stirrupBar} @ ${newPrimarySpacing} mm. Additional dowels set to 0.`;
  } else if (strategy === "addDowels") {
    const deficit = Math.max(0, s.interfaceAvReqPerM - s.unusedStirrupAv);
    if (deficit <= 0) {
      newDowelLegs = 0;
      message = `Existing primary detail has enough interface balance. No added dowels required by the selected method.`;
    } else {
      newDowelLegs = preferredDowelLegs;
      newDowelSpacing = niceSpacing(Math.min(maxPractical, dowelSet * 1000 / deficit));
      message = `Added-dowel proposal: keep primary @ ${fmt(r.inputs.stirrupSpacing,0)} mm; add ${newDowelLegs} legs ${r.inputs.dowelBar} @ ${newDowelSpacing} mm.`;
    }
  } else {
    newPrimarySpacing = niceSpacing(Math.min(maxPractical, s.sMax, minSteelSpacingLimit, r.inputs.stirrupSpacing));
    const newPrimaryPerM = primarySet / Math.max(1, newPrimarySpacing) * 1000;
    const unused = r.inputs.allocation === "balance" ? Math.max(0, newPrimaryPerM - s.beamAvReqPerM) : newPrimaryPerM;
    const deficit = Math.max(0, s.interfaceAvReqPerM - unused);
    if (deficit <= 0) {
      newDowelLegs = 0;
      message = `Hybrid proposal: tighten primary to ${fmt(r.inputs.stirrupLegs,0)} legs ${r.inputs.stirrupBar} @ ${newPrimarySpacing} mm. No added dowels required.`;
    } else {
      newDowelLegs = preferredDowelLegs;
      newDowelSpacing = niceSpacing(Math.min(maxPractical, dowelSet * 1000 / deficit));
      message = `Hybrid proposal: primary @ ${newPrimarySpacing} mm plus ${newDowelLegs} legs ${r.inputs.dowelBar} @ ${newDowelSpacing} mm.`;
    }
  }

  const zoneNote = zones === "3" ? " Zone concept: support zones A use this selected detail; zone B can be relaxed after checking the local station envelope." : " Uniform detail is applied for the whole member in the current input model.";
  if ($("autoDesignResult")) $("autoDesignResult").textContent = message + zoneNote;

  if (apply) {
    $("stirrupSpacing").value = newPrimarySpacing;
    $("dowelLegs").value = newDowelLegs;
    $("dowelSpacing").value = newDowelSpacing;
    runCalculations();
  }
}

function attachEvents() {
  document.querySelectorAll("input, select").forEach(el => {
    el.addEventListener("change", () => {
      if (el.id === "interfaceCondition") syncInterfaceDefaults();
      runCalculations();
    });
    el.addEventListener("input", () => {
      if (el.type === "number") runCalculations();
    });
  });
  $("runButton").addEventListener("click", runCalculations);
  $("resetDefaults").addEventListener("click", () => { applyDefaults(); runCalculations(); });
  $("downloadCsv").addEventListener("click", downloadCsv);
  if ($("autoDesignButton")) $("autoDesignButton").addEventListener("click", () => { $("autoDesignPanel").hidden = !$('autoDesignPanel').hidden; previewAutoDesign(false); });
  if ($("closeAutoDesign")) $("closeAutoDesign").addEventListener("click", () => { $("autoDesignPanel").hidden = true; });
  if ($("previewAutoDesign")) $("previewAutoDesign").addEventListener("click", () => previewAutoDesign(false));
  if ($("applyAutoDesign")) $("applyAutoDesign").addEventListener("click", () => previewAutoDesign(true));
}

document.addEventListener("DOMContentLoaded", () => {
  setupRebarSelects();
  applyDefaults();
  attachEvents();
  runCalculations();
});
