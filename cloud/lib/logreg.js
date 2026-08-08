/**
 * Softmax multiclass logistic regression — mirrors ml_model/softmax_logreg.py
 * so Render can refit on each device ingest (no Python required).
 */
const { fillFeatures, normalizeTarget } = require("./gnb");

const N_CLASSES = 3;
const N_FEATS = 8;
const CLASS_NAMES = ["ok", "warn", "critical"];
const FEATURE_NAMES = [
  "|I|",
  "T",
  "|MA3I|",
  "MA3T",
  "|dI/dt|",
  "|dT/dt|",
  "varI",
  "|d2T|",
];

function softmaxRows(logits) {
  // logits: n x C
  const n = logits.length;
  const out = Array.from({ length: n }, () => Array(N_CLASSES).fill(0));
  for (let i = 0; i < n; i++) {
    let max = -Infinity;
    for (let c = 0; c < N_CLASSES; c++) max = Math.max(max, logits[i][c]);
    let sum = 0;
    for (let c = 0; c < N_CLASSES; c++) {
      out[i][c] = Math.exp(logits[i][c] - max);
      sum += out[i][c];
    }
    for (let c = 0; c < N_CLASSES; c++) out[i][c] /= sum || 1;
  }
  return out;
}

function classWeights(y) {
  const counts = Array(N_CLASSES).fill(0);
  for (const t of y) counts[t] += 1;
  const n = y.length;
  return counts.map((c) => n / (N_CLASSES * Math.max(c, 1)));
}

/**
 * Fit softmax LR on corpus rows. Fast defaults for online ingest.
 */
function fitSoftmaxLogReg(rows, opts = {}) {
  const lr = opts.lr ?? 0.05;
  const l2 = opts.l2 ?? 1e-3;
  const epochs = opts.epochs ?? 250;
  const batchSize = opts.batchSize ?? 32;
  const seed = opts.seed ?? 42;

  const X = [];
  const y = [];
  for (const r of rows) {
    X.push(fillFeatures(r));
    y.push(normalizeTarget(r));
  }
  const n = X.length;
  if (n < 8) {
    return { ok: false, error: `need ≥8 rows, got ${n}` };
  }

  const mean = Array(N_FEATS).fill(0);
  const std = Array(N_FEATS).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < N_FEATS; j++) mean[j] += X[i][j];
  }
  for (let j = 0; j < N_FEATS; j++) mean[j] /= n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < N_FEATS; j++) {
      const d = X[i][j] - mean[j];
      std[j] += d * d;
    }
  }
  for (let j = 0; j < N_FEATS; j++) {
    std[j] = Math.sqrt(std[j] / n);
    if (std[j] < 1e-8) std[j] = 1;
  }

  const Xs = X.map((row) => row.map((v, j) => (v - mean[j]) / std[j]));

  // small random init (mulberry32)
  let s = seed >>> 0;
  const randn = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    // Box-Muller-ish cheap normal
    return (u - 0.5) * 0.02;
  };

  const W = Array.from({ length: N_FEATS }, () =>
    Array.from({ length: N_CLASSES }, () => randn()),
  );
  const b = Array(N_CLASSES).fill(0);
  const cw = classWeights(y);
  const sampleW = y.map((t) => cw[t]);

  const idx = Array.from({ length: n }, (_, i) => i);
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      s = (s + 0x6d2b79f5) >>> 0;
      const j = s % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };

  let lastAcc = 0;
  for (let epoch = 0; epoch < epochs; epoch++) {
    shuffle(idx);
    for (let start = 0; start < n; start += batchSize) {
      const end = Math.min(start + batchSize, n);
      const m = end - start;
      const logits = Array.from({ length: m }, () => Array(N_CLASSES).fill(0));
      for (let bi = 0; bi < m; bi++) {
        const i = idx[start + bi];
        for (let c = 0; c < N_CLASSES; c++) {
          let z = b[c];
          for (let j = 0; j < N_FEATS; j++) z += Xs[i][j] * W[j][c];
          logits[bi][c] = z;
        }
      }
      const probs = softmaxRows(logits);
      const dW = Array.from({ length: N_FEATS }, () => Array(N_CLASSES).fill(0));
      const db = Array(N_CLASSES).fill(0);
      for (let bi = 0; bi < m; bi++) {
        const i = idx[start + bi];
        const t = y[i];
        const sw = sampleW[i];
        for (let c = 0; c < N_CLASSES; c++) {
          const err = (probs[bi][c] - (c === t ? 1 : 0)) * sw;
          db[c] += err;
          for (let j = 0; j < N_FEATS; j++) dW[j][c] += Xs[i][j] * err;
        }
      }
      for (let c = 0; c < N_CLASSES; c++) {
        b[c] -= lr * (db[c] / m);
        for (let j = 0; j < N_FEATS; j++) {
          W[j][c] -= lr * (dW[j][c] / m + l2 * W[j][c]);
        }
      }
    }

    if (epoch === epochs - 1 || epoch % 50 === 0) {
      let correct = 0;
      for (let i = 0; i < n; i++) {
        let best = 0;
        let bestZ = -Infinity;
        for (let c = 0; c < N_CLASSES; c++) {
          let z = b[c];
          for (let j = 0; j < N_FEATS; j++) z += Xs[i][j] * W[j][c];
          if (z > bestZ) {
            bestZ = z;
            best = c;
          }
        }
        if (best === y[i]) correct++;
      }
      lastAcc = correct / n;
    }
  }

  const classCounts = Array(N_CLASSES).fill(0);
  for (const t of y) classCounts[t] += 1;

  const model = {
    type: "softmax_logistic_regression",
    version: 1,
    n_features: N_FEATS,
    n_classes: N_CLASSES,
    feature_names: FEATURE_NAMES,
    class_names: CLASS_NAMES,
    lr,
    l2,
    epochs,
    mean,
    std,
    W,
    b,
    trainN: n,
    classCounts,
    fittedAt: new Date().toISOString(),
    source: opts.source || "corpus",
    accuracy: Math.round(lastAcc * 10000) / 10000,
  };

  return { ok: true, model, trainN: n, accuracy: model.accuracy, classCounts };
}

module.exports = { fitSoftmaxLogReg, FEATURE_NAMES, CLASS_NAMES };
