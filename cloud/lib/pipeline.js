/**
 * Training pipeline:
 *   1. Seed corpus from cloud/seed/*.csv (dataset_1.csv …)
 *   2. Append device ingest batches
 *   3. Refit Gaussian NB on the full corpus after each change
 */

const fs = require("fs");
const path = require("path");
const { fitGaussianNB, parseCsv, normalizeTarget } = require("./gnb");

const GLOBAL_ID = "global";

class TrainPipeline {
  constructor(opts = {}) {
    this.dataDir = opts.dataDir;
    this.seedDir = opts.seedDir;
    this.defaultDeviceId = opts.defaultDeviceId || "esp32-01";

    this.corpusDir = path.join(this.dataDir, "corpus");
    this.batchesDir = path.join(this.corpusDir, "batches");
    this.modelsDir = path.join(this.dataDir, "models");
    this.devicesDir = path.join(this.dataDir, "devices");
    this.historyDir = path.join(this.dataDir, "history");
    this.corpusPath = path.join(this.corpusDir, "rows.ndjson");
    this.metaPath = path.join(this.corpusDir, "meta.json");
  }

  ensureDirs() {
    for (const d of [
      this.dataDir,
      this.corpusDir,
      this.batchesDir,
      this.modelsDir,
      this.devicesDir,
      this.historyDir,
    ]) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  readMeta() {
    if (!fs.existsSync(this.metaPath)) {
      return {
        seededFiles: [],
        rowCount: 0,
        lastFitAt: null,
        lastIngestAt: null,
        ingestCount: 0,
      };
    }
    try {
      return JSON.parse(fs.readFileSync(this.metaPath, "utf8"));
    } catch {
      return {
        seededFiles: [],
        rowCount: 0,
        lastFitAt: null,
        lastIngestAt: null,
        ingestCount: 0,
      };
    }
  }

  writeMeta(meta) {
    fs.writeFileSync(this.metaPath, JSON.stringify(meta, null, 2));
  }

  listSeedCsvs() {
    if (!fs.existsSync(this.seedDir)) return [];
    return fs
      .readdirSync(this.seedDir)
      .filter((f) => f.toLowerCase().endsWith(".csv"))
      .sort()
      .map((f) => path.join(this.seedDir, f));
  }

  /** Normalize a raw row into the corpus schema. */
  normalizeRow(r, source) {
    return {
      current: Number(r.current) || 0,
      temp: Number(r.temp) || 0,
      ma3I: Number(r.ma3I) || 0,
      ma3T: Number(r.ma3T) || 0,
      currentSlope: Number(r.currentSlope) || 0,
      tempSlope: Number(r.tempSlope) || 0,
      varI: Number(r.varI) || 0,
      power: Number(r.power) || 0,
      tempAcc: Number(r.tempAcc) || 0,
      target: normalizeTarget(r),
      targetLabel:
        r.targetLabel ||
        ["ok", "warn", "critical"][normalizeTarget(r)] ||
        "ok",
      source: source || r.source || "unknown",
    };
  }

  appendRows(rows, source) {
    if (!rows.length) return 0;
    const fd = fs.openSync(this.corpusPath, "a");
    let n = 0;
    try {
      for (const r of rows) {
        const row = this.normalizeRow(r, source);
        fs.writeSync(fd, JSON.stringify(row) + "\n");
        n++;
      }
    } finally {
      fs.closeSync(fd);
    }
    return n;
  }

  loadCorpus() {
    if (!fs.existsSync(this.corpusPath)) return [];
    const text = fs.readFileSync(this.corpusPath, "utf8");
    const rows = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        /* skip corrupt */
      }
    }
    return rows;
  }

  /**
   * Load any seed CSVs not yet applied. Idempotent via meta.seededFiles.
   * Returns number of new rows added.
   */
  seedFromCsvs({ force = false } = {}) {
    this.ensureDirs();
    const meta = this.readMeta();
    const seeded = new Set(meta.seededFiles || []);
    let added = 0;

    for (const csvPath of this.listSeedCsvs()) {
      const name = path.basename(csvPath);
      if (!force && seeded.has(name)) continue;

      const raw = fs.readFileSync(csvPath, "utf8");
      const parsed = parseCsv(raw);
      const n = this.appendRows(parsed, `seed:${name}`);
      seeded.add(name);
      added += n;
      console.log(`[pipeline] seeded ${name}: ${n} rows`);
    }

    meta.seededFiles = [...seeded];
    meta.rowCount = this.loadCorpus().length;
    this.writeMeta(meta);
    return added;
  }

  /** Force re-seed from a specific CSV path (CLI / ops). */
  seedFromFile(csvPath, { tag } = {}) {
    this.ensureDirs();
    const name = tag || path.basename(csvPath);
    const parsed = parseCsv(fs.readFileSync(csvPath, "utf8"));
    const n = this.appendRows(parsed, `seed:${name}`);
    const meta = this.readMeta();
    if (!meta.seededFiles.includes(name)) meta.seededFiles.push(name);
    meta.rowCount = this.loadCorpus().length;
    this.writeMeta(meta);
    console.log(`[pipeline] seeded file ${csvPath}: ${n} rows`);
    return n;
  }

  saveModel(id, model) {
    const p = path.join(this.modelsDir, `${id}.json`);
    fs.writeFileSync(p, JSON.stringify(model, null, 2));
    return p;
  }

  loadModel(id) {
    const p = path.join(this.modelsDir, `${id}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }

  /**
   * Fit on full corpus. Writes models/global.json and mirrors to defaultDeviceId
   * (and optionally the ingesting deviceId).
   */
  refit({ deviceId } = {}) {
    this.ensureDirs();
    const rows = this.loadCorpus();
    if (!rows.length) {
      return { ok: false, error: "empty corpus", trainN: 0 };
    }

    const corpusMeta = {
      rowCount: rows.length,
      seedFiles: this.readMeta().seededFiles,
      ingestCount: this.readMeta().ingestCount,
    };

    const globalModel = fitGaussianNB(rows, {
      deviceId: GLOBAL_ID,
      source: "corpus",
      corpus: corpusMeta,
    });
    if (!globalModel) {
      return { ok: false, error: "fit failed", trainN: 0 };
    }

    this.saveModel(GLOBAL_ID, globalModel);
    // ESP import uses device id — always keep default device in sync with global.
    this.saveModel(this.defaultDeviceId, {
      ...globalModel,
      deviceId: this.defaultDeviceId,
    });

    if (deviceId && deviceId !== this.defaultDeviceId && deviceId !== GLOBAL_ID) {
      this.saveModel(deviceId, { ...globalModel, deviceId });
    }

    const meta = this.readMeta();
    meta.rowCount = rows.length;
    meta.lastFitAt = globalModel.fittedAt;
    this.writeMeta(meta);

    console.log(
      `[pipeline] refit n=${globalModel.trainN} counts=[${globalModel.classCounts}] → global + ${this.defaultDeviceId}`,
    );

    return {
      ok: true,
      trainN: globalModel.trainN,
      classCounts: globalModel.classCounts,
      classesPresent: globalModel.classesPresent,
      fittedAt: globalModel.fittedAt,
      model: globalModel,
    };
  }

  /**
   * Device ingest: save snapshot, append to corpus, refit.
   */
  ingestDevice({ deviceId, rows, body = {} }) {
    this.ensureDirs();
    const id = deviceId || this.defaultDeviceId;
    const receivedAt = new Date().toISOString();
    const batchId = `${receivedAt.replace(/[:.]/g, "-")}_${id}`;

    const snapshot = {
      deviceId: id,
      receivedAt,
      full: !!body.full,
      datasetCount: body.datasetCount ?? rows.length,
      datasetMax: body.datasetMax ?? null,
      firmware: body.firmware || null,
      rowCount: rows.length,
      rows,
    };

    fs.writeFileSync(
      path.join(this.devicesDir, `${id}.json`),
      JSON.stringify(snapshot, null, 2),
    );
    fs.writeFileSync(
      path.join(this.batchesDir, `${batchId}.json`),
      JSON.stringify(
        {
          batchId,
          deviceId: id,
          receivedAt,
          rowCount: rows.length,
          full: snapshot.full,
        },
        null,
        2,
      ),
    );
    fs.appendFileSync(
      path.join(this.historyDir, `${id}.ndjson`),
      JSON.stringify({
        deviceId: id,
        receivedAt,
        datasetCount: snapshot.datasetCount,
        rowCount: rows.length,
        full: snapshot.full,
        batchId,
      }) + "\n",
    );

    const tagged = rows.map((r) => ({ ...r, source: `device:${id}` }));
    const added = this.appendRows(tagged, `device:${id}`);

    const meta = this.readMeta();
    meta.ingestCount = (meta.ingestCount || 0) + 1;
    meta.lastIngestAt = receivedAt;
    meta.rowCount = this.loadCorpus().length;
    this.writeMeta(meta);

    const fit = this.refit({ deviceId: id });

    return {
      ok: true,
      deviceId: id,
      saved: rows.length,
      corpusAdded: added,
      corpusSize: meta.rowCount,
      receivedAt,
      batchId,
      model: fit.ok
        ? {
            trainN: fit.trainN,
            classCounts: fit.classCounts,
            fittedAt: fit.fittedAt,
            classesPresent: fit.classesPresent,
          }
        : null,
      modelError: fit.ok ? null : fit.error,
    };
  }

  /**
   * Resolve model for ESP import: device → default → global → fit from corpus.
   */
  getModelForDevice(deviceId) {
    const id = deviceId || this.defaultDeviceId;
    let model = this.loadModel(id);
    if (model) return model;

    model = this.loadModel(this.defaultDeviceId);
    if (model) return { ...model, deviceId: id };

    model = this.loadModel(GLOBAL_ID);
    if (model) return { ...model, deviceId: id };

    const fit = this.refit({ deviceId: id });
    if (fit.ok) return this.loadModel(id) || fit.model;
    return null;
  }

  status() {
    const meta = this.readMeta();
    const corpus = this.loadCorpus();
    const counts = [0, 0, 0];
    for (const r of corpus) counts[normalizeTarget(r)] += 1;
    const hasGlobal = fs.existsSync(
      path.join(this.modelsDir, `${GLOBAL_ID}.json`),
    );
    const hasDefault = fs.existsSync(
      path.join(this.modelsDir, `${this.defaultDeviceId}.json`),
    );
    return {
      corpusRows: corpus.length,
      classCounts: counts,
      seededFiles: meta.seededFiles || [],
      ingestCount: meta.ingestCount || 0,
      lastFitAt: meta.lastFitAt,
      lastIngestAt: meta.lastIngestAt,
      seedDir: this.seedDir,
      models: { global: hasGlobal, defaultDevice: hasDefault },
      defaultDeviceId: this.defaultDeviceId,
    };
  }

  /** Cold start: seed CSVs if needed, then ensure a model exists. */
  bootstrap() {
    this.ensureDirs();
    const added = this.seedFromCsvs();
    const rows = this.loadCorpus();
    if (!rows.length) {
      console.log("[pipeline] bootstrap: empty corpus (no seed CSVs?)");
      return { seeded: added, fit: null };
    }
    const needFit =
      added > 0 ||
      !fs.existsSync(path.join(this.modelsDir, `${GLOBAL_ID}.json`));
    const fit = needFit ? this.refit() : { ok: true, skipped: true, trainN: rows.length };
    if (fit.skipped) {
      console.log(`[pipeline] bootstrap: corpus=${rows.length} model already present`);
    }
    return { seeded: added, fit };
  }
}

module.exports = { TrainPipeline, GLOBAL_ID };
