/**
 * Gaussian Naive Bayes — matches ESP32 gnbFillFeatures() / fit path.
 */

const GNB_CLASSES = 3;
const GNB_FEATS = 8;
const GNB_VAR_FLOOR = 1e-6;
const FEAT_NAMES = [
  "|I|",
  "T",
  "|MA3I|",
  "MA3T",
  "|dI/dt|",
  "|dT/dt|",
  "varI",
  "|d2T|",
];

const LABEL_TO_TARGET = {
  ok: 0,
  normal: 0,
  warn: 1,
  warning: 1,
  critical: 2,
  crit: 2,
};

/** Match ESP32 gnbFillFeatures() */
function fillFeatures(r) {
  return [
    Math.abs(Number(r.current) || 0),
    Number(r.temp) || 0,
    Math.abs(Number(r.ma3I) || 0),
    Number(r.ma3T) || 0,
    Math.abs(Number(r.currentSlope) || 0),
    Math.abs(Number(r.tempSlope) || 0),
    Number(r.varI) || 0,
    Math.abs(Number(r.tempAcc) || 0),
  ];
}

function normalizeTarget(row) {
  if (row.target != null && row.target !== "") {
    const n = Number(row.target);
    if (Number.isFinite(n)) return Math.max(0, Math.min(2, Math.round(n)));
  }
  const label = String(row.targetLabel || row.label || "")
    .trim()
    .toLowerCase();
  if (label in LABEL_TO_TARGET) return LABEL_TO_TARGET[label];
  return 0;
}

function fitGaussianNB(rows, meta = {}) {
  const mean = Array.from({ length: GNB_CLASSES }, () =>
    Array(GNB_FEATS).fill(0),
  );
  const variance = Array.from({ length: GNB_CLASSES }, () =>
    Array(GNB_FEATS).fill(0),
  );
  const classCounts = Array(GNB_CLASSES).fill(0);
  const logPrior = Array(GNB_CLASSES).fill(0);

  const xs = [];
  for (const r of rows) {
    const c = normalizeTarget(r);
    const x = fillFeatures(r);
    xs.push({ c, x });
    classCounts[c] += 1;
    for (let j = 0; j < GNB_FEATS; j++) mean[c][j] += x[j];
  }

  const n = xs.length;
  if (n < 1) return null;

  for (let c = 0; c < GNB_CLASSES; c++) {
    if (classCounts[c] === 0) continue;
    for (let j = 0; j < GNB_FEATS; j++) mean[c][j] /= classCounts[c];
  }

  for (const { c, x } of xs) {
    for (let j = 0; j < GNB_FEATS; j++) {
      const d = x[j] - mean[c][j];
      variance[c][j] += d * d;
    }
  }

  for (let c = 0; c < GNB_CLASSES; c++) {
    if (classCounts[c] === 0) continue;
    const denom = classCounts[c] > 1 ? classCounts[c] - 1 : 1;
    for (let j = 0; j < GNB_FEATS; j++) {
      variance[c][j] /= denom;
      if (variance[c][j] < GNB_VAR_FLOOR) variance[c][j] = GNB_VAR_FLOOR;
    }
    logPrior[c] = Math.log(classCounts[c] / n);
  }

  const classesPresent = classCounts.filter((x) => x > 0).length;
  return {
    version: 1,
    type: "gaussian_nb",
    deviceId: meta.deviceId || "global",
    source: meta.source || "pipeline",
    fittedAt: new Date().toISOString(),
    classes: GNB_CLASSES,
    feats: GNB_FEATS,
    featNames: FEAT_NAMES,
    trainN: n,
    classCounts,
    classesPresent,
    mean,
    var: variance,
    logPrior,
    corpus: meta.corpus || null,
  };
}

/**
 * Minimal CSV parser for quoted fields (dataset_*.csv export format).
 */
function parseCsv(text) {
  const lines = String(text)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < headers.length) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = unquote(cols[j]);
    }
    rows.push(obj);
  }
  return rows;
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function unquote(s) {
  const t = String(s == null ? "" : s).trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/""/g, '"');
  }
  return t;
}

module.exports = {
  GNB_CLASSES,
  GNB_FEATS,
  GNB_VAR_FLOOR,
  FEAT_NAMES,
  fillFeatures,
  normalizeTarget,
  fitGaussianNB,
  parseCsv,
};
