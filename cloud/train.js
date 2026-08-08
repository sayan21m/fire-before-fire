#!/usr/bin/env node
/**
 * CLI: train / refit Gaussian NB from seed CSVs (+ optional extra CSV).
 *
 *   npm run train
 *   npm run train -- --csv ../dataset/dataset_1.csv
 *   npm run train -- --reset   # wipe corpus, re-seed, fit
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { TrainPipeline } = require("./lib/pipeline");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const SEED_DIR = process.env.SEED_DIR || path.join(__dirname, "seed");
const DEFAULT_DEVICE_ID = process.env.DEFAULT_DEVICE_ID || "esp32-01";

function parseArgs(argv) {
  const out = { csv: [], reset: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reset") out.reset = true;
    else if (a === "--csv" && argv[i + 1]) out.csv.push(argv[++i]);
    else if (a.startsWith("--csv=")) out.csv.push(a.slice(6));
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pipeline = new TrainPipeline({
    dataDir: DATA_DIR,
    seedDir: SEED_DIR,
    defaultDeviceId: DEFAULT_DEVICE_ID,
  });

  if (args.reset) {
    const corpusDir = path.join(DATA_DIR, "corpus");
    if (fs.existsSync(corpusDir)) {
      fs.rmSync(corpusDir, { recursive: true, force: true });
      console.log("[train] wiped corpus/");
    }
    const modelsDir = path.join(DATA_DIR, "models");
    if (fs.existsSync(modelsDir)) {
      for (const f of fs.readdirSync(modelsDir)) {
        if (f.endsWith(".json")) fs.unlinkSync(path.join(modelsDir, f));
      }
      console.log("[train] cleared models/");
    }
  }

  pipeline.ensureDirs();
  pipeline.seedFromCsvs({ force: args.reset });

  for (const csv of args.csv) {
    const abs = path.resolve(csv);
    if (!fs.existsSync(abs)) {
      console.error(`[train] CSV not found: ${abs}`);
      process.exit(1);
    }
    pipeline.seedFromFile(abs);
  }

  // Also pick up repo-level dataset/ if seed dir is empty and no --csv
  if (
    pipeline.listSeedCsvs().length === 0 &&
    args.csv.length === 0
  ) {
    const repoCsv = path.join(__dirname, "..", "dataset", "dataset_1.csv");
    if (fs.existsSync(repoCsv)) {
      console.log(`[train] falling back to ${repoCsv}`);
      pipeline.seedFromFile(repoCsv, { tag: "dataset_1.csv" });
    }
  }

  const fit = pipeline.refit();
  if (!fit.ok) {
    console.error("[train] fit failed:", fit.error);
    process.exit(1);
  }

  const st = pipeline.status();
  console.log(
    JSON.stringify(
      {
        ok: true,
        trainN: fit.trainN,
        classCounts: fit.classCounts,
        classesPresent: fit.classesPresent,
        fittedAt: fit.fittedAt,
        corpus: st,
        modelPaths: {
          global: path.join(DATA_DIR, "models", "global.json"),
          device: path.join(DATA_DIR, "models", `${DEFAULT_DEVICE_ID}.json`),
        },
      },
      null,
      2,
    ),
  );
}

main();
