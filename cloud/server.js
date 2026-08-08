/**
 * Fire Before Fire — Render ingest + GNB + softmax LR + Web Push OS alerts
 *
 * Boot: seed corpus + install softmax_logreg.json
 * POST /api/ingest                 → append rows → refit GNB
 * GET  /api/devices/:id/model|logreg
 * POST /api/devices/:id/notify     → OS Web Push to subscribed phones (auth)
 * GET  /notify                     → HTTPS page to grant OS notification permission
 * GET  /health
 */
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { TrainPipeline } = require("./lib/pipeline");
const { createPushStore } = require("./lib/push");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.CLOUD_API_KEY || "change-me-fbf-key";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const SEED_DIR = process.env.SEED_DIR || path.join(__dirname, "seed");
const DEFAULT_DEVICE_ID = process.env.DEFAULT_DEVICE_ID || "esp32-01";
const PUBLIC_DIR = path.join(__dirname, "public");

const pipeline = new TrainPipeline({
  dataDir: DATA_DIR,
  seedDir: SEED_DIR,
  defaultDeviceId: DEFAULT_DEVICE_ID,
});

const boot = pipeline.bootstrap();
const push = createPushStore({ dataDir: DATA_DIR });

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

app.get("/notify-sw.js", (_req, res) => {
  res.set("Service-Worker-Allowed", "/");
  res.set("Cache-Control", "no-cache");
  res.type("application/javascript");
  res.sendFile(path.join(PUBLIC_DIR, "notify-sw.js"));
});

app.get("/notify", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "notify.html"));
});

app.use(express.static(PUBLIC_DIR));

app.get("/", (_req, res) => {
  const st = pipeline.status();
  res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Fire Before Fire Cloud</title>
<style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem;line-height:1.5}
code{background:#f4f4f5;padding:.1rem .35rem;border-radius:4px}</style></head><body>
<h1>Fire Before Fire — Cloud</h1>
<p>GNB corpus + softmax LR hosting + <strong>OS Web Push</strong> alerts.</p>
<ul>
  <li>Corpus rows: <strong>${st.corpusRows}</strong></li>
  <li>Push enabled: <strong>${push.enabled ? "yes" : "no — set VAPID_* env"}</strong> · subscribers: ${push.count()}</li>
</ul>
<ul>
  <li><a href="/notify">/notify</a> — enable OS notifications (HTTPS)</li>
  <li><a href="/health">/health</a></li>
  <li><code>POST /api/devices/:id/notify</code> — ESP hazard → phone OS alert</li>
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
    pushEnabled: push.enabled,
    pushSubscribers: push.count(),
    boot,
  });
});

app.get("/api/push/vapid-public", (_req, res) => {
  if (!push.enabled || !push.publicKey) {
    return res.status(503).json({
      ok: false,
      error: "VAPID keys not configured on server (set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)",
    });
  }
  res.json({ ok: true, publicKey: push.publicKey });
});

app.post("/api/push/subscribe", (req, res) => {
  const body = req.body || {};
  const deviceId = safeId(body.deviceId || DEFAULT_DEVICE_ID);
  const result = push.subscribe(deviceId, body.subscription, {
    userAgent: body.userAgent || req.headers["user-agent"] || "",
  });
  if (!result.ok) return res.status(400).json(result);
  console.log(`[push] subscribe device=${deviceId} n=${result.count}`);
  res.json(result);
});

app.post("/api/push/test", async (req, res) => {
  const deviceId = safeId((req.body || {}).deviceId || DEFAULT_DEVICE_ID);
  const result = await push.notifyDevice(deviceId, {
    title: "Fire Before Fire — test",
    body: "OS notification path OK for " + deviceId,
    level: "warn",
    tag: "fbf-test",
  });
  res.status(result.ok ? 200 : 503).json(result);
});

app.post("/api/devices/:id/notify", auth, async (req, res) => {
  const id = safeId(req.params.id);
  const body = req.body || {};
  const level = body.level === "critical" ? "critical" : "warn";
  const title =
    body.title ||
    (level === "critical"
      ? "Fire Before Fire — CRITICAL"
      : "Fire Before Fire — Warning");
  const text =
    body.body ||
    body.message ||
    `${body.label || body.param || "hazard"}: ${body.value ?? ""}`;
  const result = await push.notifyDevice(id, {
    title,
    body: String(text),
    level,
    tag: body.tag || `fbf-${body.param || "alert"}-${body.ms || Date.now()}`,
    url: "/notify",
  });
  console.log(`[push] notify ${id} sent=${result.sent}/${result.subscribers || 0}`);
  res.status(result.ok ? 200 : 503).json(result);
});

app.get("/api/train/status", auth, (_req, res) => {
  res.json({ ...pipeline.status(), pushEnabled: push.enabled, pushSubscribers: push.count() });
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
    pushEnabled: push.enabled,
    pushSubscribers: push.count(),
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
    `Push: ${push.enabled ? "VAPID ready" : "DISABLED — set VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY"}`,
  );
  console.log(
    `Pipeline: corpus=${pipeline.status().corpusRows} seed=${SEED_DIR}`,
  );
});
