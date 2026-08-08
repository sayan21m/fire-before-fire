/**
 * Fire Before Fire — Render ingest + GNB training pipeline
 *
 * Boot: seed corpus from cloud/seed/*.csv → fit global GNB
 * POST /api/ingest              → append device rows → refit
 * GET  /api/devices/:id/model   → download latest GNB (seed + all ingests)
 * GET  /api/train/status        → corpus / model stats
 * POST /api/train/refit         → force refit on current corpus
 * GET  /api/devices             → list devices
 * GET  /health
 */
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { TrainPipeline } = require("./lib/pipeline");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.CLOUD_API_KEY || "change-me-fbf-key";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const SEED_DIR = process.env.SEED_DIR || path.join(__dirname, "seed");
const DEFAULT_DEVICE_ID = process.env.DEFAULT_DEVICE_ID || "esp32-01";

const pipeline = new TrainPipeline({
  dataDir: DATA_DIR,
  seedDir: SEED_DIR,
  defaultDeviceId: DEFAULT_DEVICE_ID,
});

const boot = pipeline.bootstrap();

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

app.get("/", (_req, res) => {
  const st = pipeline.status();
  res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Fire Before Fire Cloud</title>
<style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem;line-height:1.5}
code{background:#f4f4f5;padding:.1rem .35rem;border-radius:4px}</style></head><body>
<h1>Fire Before Fire — Cloud</h1>
<p>GNB pipeline: seed CSV → device ingest → refit corpus.</p>
<ul>
  <li>Corpus rows: <strong>${st.corpusRows}</strong> · classes [${st.classCounts.join(", ")}]</li>
  <li>Seed files: ${st.seededFiles.map((f) => `<code>${f}</code>`).join(" ") || "—"}</li>
  <li>Device ingests: ${st.ingestCount}</li>
  <li>Last fit: ${st.lastFitAt || "—"}</li>
</ul>
<ul>
  <li><a href="/health">/health</a></li>
  <li><code>POST /api/ingest</code> — device dataset → append + retrain</li>
  <li><code>GET /api/devices/:id/model</code> — GNB (ESP import)</li>
  <li><code>GET /api/devices/:id/logreg</code> — softmax LR (ESP import)</li>
  <li><code>GET /api/train/status</code></li>
  <li><code>POST /api/train/refit</code></li>
</ul>
</body></html>`);
});

app.get("/health", (_req, res) => {
  const st = pipeline.status();
  res.json({
    ok: true,
    service: "fire-before-fire-cloud",
    ts: new Date().toISOString(),
    corpusRows: st.corpusRows,
    lastFitAt: st.lastFitAt,
    boot,
  });
});

app.get("/api/train/status", auth, (_req, res) => {
  res.json(pipeline.status());
});

app.post("/api/train/refit", auth, (_req, res) => {
  const fit = pipeline.refit();
  if (!fit.ok) return res.status(422).json(fit);
  res.json({
    ok: true,
    trainN: fit.trainN,
    classCounts: fit.classCounts,
    fittedAt: fit.fittedAt,
  });
});

/** Ops: POST multipart-free JSON { csvText } or re-seed from disk. */
app.post("/api/train/seed", auth, (req, res) => {
  const body = req.body || {};
  let added = 0;
  if (typeof body.csvText === "string" && body.csvText.trim()) {
    const tag = safeId(body.tag || `upload-${Date.now()}.csv`);
    const tmp = path.join(SEED_DIR, tag.endsWith(".csv") ? tag : `${tag}.csv`);
    fs.mkdirSync(SEED_DIR, { recursive: true });
    fs.writeFileSync(tmp, body.csvText);
    added = pipeline.seedFromFile(tmp, { tag: path.basename(tmp) });
  } else {
    added = pipeline.seedFromCsvs({ force: !!body.force });
  }
  const fit = pipeline.refit();
  res.json({
    ok: true,
    added,
    trainN: fit.trainN,
    classCounts: fit.classCounts,
    status: pipeline.status(),
  });
});

app.post("/api/ingest", auth, (req, res) => {
  const body = req.body || {};
  const deviceId = safeId(
    body.deviceId || req.headers["x-device-id"] || DEFAULT_DEVICE_ID,
  );
  const rows = Array.isArray(body.rows) ? body.rows : [];

  const result = pipeline.ingestDevice({ deviceId, rows, body });
  console.log(
    `[ingest] ${deviceId} rows=${rows.length} corpus=${result.corpusSize} model=${
      result.model ? "ok" : result.modelError
    }`,
  );
  res.json(result);
});

app.get("/api/devices", auth, (_req, res) => {
  const files = fs
    .readdirSync(pipeline.devicesDir)
    .filter((f) => f.endsWith(".json"));
  const devices = files.map((f) => {
    const id = f.replace(/\.json$/, "");
    try {
      const j = JSON.parse(
        fs.readFileSync(path.join(pipeline.devicesDir, f), "utf8"),
      );
      const hasModel = fs.existsSync(
        path.join(pipeline.modelsDir, `${id}.json`),
      );
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
  res.json({
    count: devices.length,
    devices,
    train: pipeline.status(),
  });
});

app.get("/api/devices/:id", auth, (req, res) => {
  const id = safeId(req.params.id);
  const p = path.join(pipeline.devicesDir, `${id}.json`);
  if (!fs.existsSync(p)) return res.status(404).json({ error: "not found" });
  res.type("json").send(fs.readFileSync(p, "utf8"));
});

app.get("/api/devices/:id/model", auth, (req, res) => {
  const id = safeId(req.params.id);
  const model = pipeline.getModelForDevice(id);
  if (!model) {
    return res.status(404).json({
      error: "no dataset or model for device",
      hint: "seed CSV missing or corpus empty — check /api/train/status",
    });
  }
  res.json(model);
});

app.get("/api/devices/:id/logreg", auth, (req, res) => {
  const model = pipeline.getLogregModel();
  if (!model) {
    return res.status(404).json({
      error: "no softmax logreg model",
      hint: "place cloud/seed/softmax_logreg.json (from ml_model/pipeline.py)",
    });
  }
  const id = safeId(req.params.id);
  res.json({ ...model, deviceId: id });
});

app.post("/api/devices/:id/model/refit", auth, (req, res) => {
  const id = safeId(req.params.id);
  const fit = pipeline.refit({ deviceId: id });
  if (!fit.ok) return res.status(422).json(fit);
  res.json({
    ok: true,
    trainN: fit.trainN,
    classCounts: fit.classCounts,
    fittedAt: fit.fittedAt,
  });
});

app.listen(PORT, () => {
  console.log(`Fire Before Fire cloud on :${PORT}`);
  console.log(
    `API key: ${API_KEY !== "change-me-fbf-key" ? "custom" : "DEFAULT — set CLOUD_API_KEY"}`,
  );
  console.log(
    `Pipeline: corpus=${pipeline.status().corpusRows} seed=${SEED_DIR}`,
  );
});
