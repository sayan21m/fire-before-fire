/**
 * Fire Before Fire — Render ingest + GNB model store
 *
 * POST /api/ingest              → save dataset, fit GNB, store model
 * GET  /api/devices/:id/model   → download GNB params for ESP import
 * GET  /api/devices             → list devices
 * GET  /health
 */
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.CLOUD_API_KEY || "change-me-fbf-key";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DEVICES_DIR = path.join(DATA_DIR, "devices");
const HISTORY_DIR = path.join(DATA_DIR, "history");
const MODELS_DIR = path.join(DATA_DIR, "models");

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

fs.mkdirSync(DEVICES_DIR, { recursive: true });
fs.mkdirSync(HISTORY_DIR, { recursive: true });
fs.mkdirSync(MODELS_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

function auth(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  const alt = req.headers["x-api-key"] || "";
  if (token !== API_KEY && alt !== API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

function safeId(id) {
  return String(id || "unknown")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 64);
}

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

function fitGaussianNB(rows, deviceId) {
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
    let c = Number(r.target);
    if (!Number.isFinite(c)) c = 0;
    c = Math.max(0, Math.min(2, Math.round(c)));
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
    deviceId,
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
  };
}

function saveModel(deviceId, model) {
  const p = path.join(MODELS_DIR, `${deviceId}.json`);
  fs.writeFileSync(p, JSON.stringify(model, null, 2));
  return p;
}

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Fire Before Fire Cloud</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.5}
code{background:#f4f4f5;padding:.1rem .35rem;border-radius:4px}</style></head><body>
<h1>Fire Before Fire — Cloud</h1>
<p>Ingests full 100-row datasets, fits Gaussian NB, serves the model for ESP import.</p>
<ul>
  <li><a href="/health">/health</a></li>
  <li><code>POST /api/ingest</code></li>
  <li><code>GET /api/devices/:id/model</code></li>
</ul>
</body></html>`);
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "fire-before-fire-cloud",
    ts: new Date().toISOString(),
  });
});

app.post("/api/ingest", auth, (req, res) => {
  const body = req.body || {};
  const deviceId = safeId(
    body.deviceId || req.headers["x-device-id"] || "unknown",
  );
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const receivedAt = new Date().toISOString();

  const snapshot = {
    deviceId,
    receivedAt,
    full: !!body.full,
    datasetCount: body.datasetCount ?? rows.length,
    datasetMax: body.datasetMax ?? null,
    firmware: body.firmware || null,
    rowCount: rows.length,
    rows,
  };

  fs.writeFileSync(
    path.join(DEVICES_DIR, `${deviceId}.json`),
    JSON.stringify(snapshot, null, 2),
  );
  fs.appendFileSync(
    path.join(HISTORY_DIR, `${deviceId}.ndjson`),
    JSON.stringify({
      deviceId,
      receivedAt,
      datasetCount: snapshot.datasetCount,
      rowCount: rows.length,
      full: snapshot.full,
    }) + "\n",
  );

  let model = null;
  let modelError = null;
  try {
    model = fitGaussianNB(rows, deviceId);
    if (model) saveModel(deviceId, model);
    else modelError = "too few rows to fit";
  } catch (e) {
    modelError = String(e.message || e);
  }

  console.log(
    `[ingest] ${deviceId} rows=${rows.length} model=${model ? "ok" : modelError}`,
  );
  res.json({
    ok: true,
    deviceId,
    saved: rows.length,
    receivedAt,
    model: model
      ? {
          trainN: model.trainN,
          classCounts: model.classCounts,
          fittedAt: model.fittedAt,
        }
      : null,
    modelError,
  });
});

app.get("/api/devices", auth, (_req, res) => {
  const files = fs.readdirSync(DEVICES_DIR).filter((f) => f.endsWith(".json"));
  const devices = files.map((f) => {
    const id = f.replace(/\.json$/, "");
    try {
      const j = JSON.parse(
        fs.readFileSync(path.join(DEVICES_DIR, f), "utf8"),
      );
      const hasModel = fs.existsSync(path.join(MODELS_DIR, `${id}.json`));
      return {
        deviceId: j.deviceId,
        receivedAt: j.receivedAt,
        datasetCount: j.datasetCount,
        rowCount: j.rowCount,
        full: j.full,
        hasModel,
      };
    } catch {
      return { deviceId: id, error: "corrupt" };
    }
  });
  res.json({ count: devices.length, devices });
});

app.get("/api/devices/:id", auth, (req, res) => {
  const id = safeId(req.params.id);
  const p = path.join(DEVICES_DIR, `${id}.json`);
  if (!fs.existsSync(p)) return res.status(404).json({ error: "not found" });
  res.type("json").send(fs.readFileSync(p, "utf8"));
});

app.get("/api/devices/:id/model", auth, (req, res) => {
  const id = safeId(req.params.id);
  const p = path.join(MODELS_DIR, `${id}.json`);
  if (!fs.existsSync(p)) {
    // Try fitting from last snapshot
    const snapPath = path.join(DEVICES_DIR, `${id}.json`);
    if (!fs.existsSync(snapPath)) {
      return res.status(404).json({ error: "no dataset or model for device" });
    }
    try {
      const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
      const model = fitGaussianNB(snap.rows || [], id);
      if (!model) return res.status(422).json({ error: "cannot fit model" });
      saveModel(id, model);
      return res.json(model);
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    }
  }
  res.type("json").send(fs.readFileSync(p, "utf8"));
});

app.post("/api/devices/:id/model/refit", auth, (req, res) => {
  const id = safeId(req.params.id);
  const snapPath = path.join(DEVICES_DIR, `${id}.json`);
  if (!fs.existsSync(snapPath)) {
    return res.status(404).json({ error: "no dataset for device" });
  }
  try {
    const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
    const model = fitGaussianNB(snap.rows || [], id);
    if (!model) return res.status(422).json({ error: "cannot fit model" });
    saveModel(id, model);
    res.json({ ok: true, trainN: model.trainN, classCounts: model.classCounts });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`Fire Before Fire cloud on :${PORT}`);
  console.log(
    `API key: ${API_KEY !== "change-me-fbf-key" ? "custom" : "DEFAULT — set CLOUD_API_KEY"}`,
  );
});
