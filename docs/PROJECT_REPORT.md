# Fire Before Fire — Project Report

**Repository:** https://github.com/sayan21m/fire-before-fire  
**Report date:** 8 August 2026  
**Cloud:** https://fire-before-fire.onrender.com  
**Branches of record:** `main`, `hardware-sg`, `software-sh`  
**Merged PRs (selected):** [#1](https://github.com/sayan21m/fire-before-fire/pull/1) (`hardware-sg` → `main`), [#5](https://github.com/sayan21m/fire-before-fire/pull/5) (`software-sh` → `main`)

> Updated to match the current codebase: SoftAP UI, dataset persistence, cloud GNB corpus, softmax logistic regression, confidence-weighted ensemble, and prototype auto cloud sync.

---

## 1. Executive summary

**Fire Before Fire** is an ESP32-based prototype that detects early electrical heating risk from **current** (ACS712) and **temperature** (DS18B20). The node hosts a SoftAP web dashboard (LittleFS), runs a weighted threshold rule engine, stores labeled batch averages on **flash** (`/dataset.bin`), and fuses two on-device ML predictors:

| Model | Origin | Role |
| ----- | ------ | ---- |
| **Gaussian Naive Bayes** | Local fit and/or Render corpus | Class posteriors from 8 features |
| **Softmax logistic regression** | `ml_model/` → LittleFS / cloud seed | Linear multiclass probabilities |
| **Ensemble** | Confidence-weighted average of both | Final ML override of rules |

With home Wi‑Fi configured once, the device **automatically** uploads labeled rows to Render and pulls updated GNB + LR weights (prototype; not production-grade OTA).

---

## 2. Problem statement

Electrical fires often grow from sustained overcurrent, poor connections, and conductor heating long before smoke or flame sensors trip. Consumer IoT stacks usually need always-on cloud connectivity. This project targets a **local-first** node that:

1. Measures load current and temperature near the circuit of interest
2. Derives dynamics (slopes, acceleration, variance) that precede steady overheating
3. Warns early via a browser UI on the same SoftAP
4. Keeps labeled batches across power cycles so learning can resume after reboot
5. Optionally syncs data and model weights to/from a small Render service for mentor demos and multi-device corpus growth

---

## 3. System architecture

```
┌─────────────┐     ADC      ┌──────────────────┐
│   ACS712    │─────────────►│                  │
└─────────────┘   GPIO 34    │      ESP32       │     SoftAP
┌─────────────┐   1-Wire     │  firmware        │◄──────────────► Phone / laptop
│   DS18B20   │─────────────►│  + LittleFS      │   192.168.4.1
└─────────────┘   GPIO 4     └────────┬─────────┘
                                      │
                 Features → Rules ────┤
                        ↓             │
              Dataset → /dataset.bin  │
                        ↓             │
              GNB  +  Softmax LR ─────┤
                        ↓             │
                   Ensemble ──────────┘
                                      │
                         STA (optional home Wi‑Fi)
                                      ▼
                          Render cloud (ingest + models)
```

| Layer      | Implementation |
| ---------- | -------------- |
| Sensing    | ACS712, DS18B20, zero-current calibration; `tempOk` health flag |
| Features   | MA3, slopes (5 s), variance, power ≈ 230×\|I\|, temp acceleration |
| Rules      | Warn/critical, importance weights, debounce, deadbands |
| Dataset    | Up to 100 batch averages; target 0/1/2; `/dataset.bin` |
| ML         | Local GNB + imported LR; ensemble override when confidence gates pass |
| UI         | `data/` on LittleFS — live KPIs, GNB/LR/ensemble page, settings |
| Cloud      | `cloud/` on Render — CSV seed, ingest, GNB refit, host LR JSON |
| Sync       | Auto upload (≥24 rows, ~5 min) + auto pull GNB/LR over STA |

---

## 4. GitHub contribution analysis

Stats below are derived from **`git log --all`** on this clone (authors as recorded by GitHub / local config).

### 4.1 Contributors

| Contributor       | Identity / focus | Primary focus |
| ----------------- | ---------------- | ------------- |
| **Sayan Garai**   | `sayan21m`       | Firmware, SoftAP APIs, GNB/LR ensemble, persist, cloud, docs |
| **Soumili Hazra** | `software-sh`    | Initial dashboard HTML scaffolding; later merges / cleanup |

### 4.2 Branch roles

| Branch        | Role |
| ------------- | ---- |
| `main`        | Integration branch |
| `hardware-sg` | Sayan — sensors, firmware, prediction, SoftAP dashboard |
| `software-sh` | Soumili — early frontend; later UI / merge work |

### 4.3 Commit timeline (selected)

| Date       | Author        | Message |
| ---------- | ------------- | ------- |
| 2026-07-27 | Sayan Garai   | `init: initialized project files` |
| 2026-07-27 | Soumili Hazra | `feat: added index.html contining dashboard` |
| 2026-08-03 | Sayan Garai   | `feat: live ESP32 SoftAP dashboard with rules+GNB fire prediction` |
| 2026-08-03 | Sayan Garai   | `docs: add README and project report; prettify web sources` |
| 2026-08-04 | Sayan Garai   | `feat: persist labeled dataset on LittleFS and harden live SoftAP UI` |
| 2026-08-04 | Soumili Hazra | Merge PRs #2–#5 (cleanup / hardware / software-sh → main) |
| 2026-08-08 | Sayan Garai   | Cloud ingest pipeline, Softmax LR, ensemble, auto sync (this revision) |

### 4.4 Division of labor (plain language)

- **Soumili** established the **web dashboard shell** that later became the SoftAP UI.
- **Sayan** built the **hardware + firmware path**, live APIs, GNB, dataset persistence, Softmax LR import, ensemble fusion, Render cloud service, and auto sync.

---

## 5. Technical design

### 5.1 Feature vector

| Feature                      | Source |
| ---------------------------- | ------ |
| `currentA`                   | ACS712 |
| `tempC`                      | DS18B20 (EMA) |
| `ma3I` / `ma3T`              | 3-sample moving averages |
| `currentSlope` / `tempSlope` | ~5 s window |
| `varI`                       | Current variance over history |
| `powerW`                     | 230 × \|I\| (UI / rules; excluded from GNB & LR) |
| `tempAcc`                    | Δ(tempSlope)/Δt |
| `target`                     | Label 0 ok / 1 warn / 2 critical |

Shared ML features (8): \|I\|, T, \|MA3I\|, MA3T, \|dI/dt\|, \|dT/dt\|, varI, \|d2T\|.

### 5.2 Rule engine

- Importance-weighted contributions to `riskPercent`
- Debounce (`WARN_HOLD_COUNT = 3`) and deadbands to cut idle false alarms
- Adaptive thresholds may rise from calm data but **never fall below factory defaults**

### 5.3 Gaussian NB

1. Assess sufficiency (count, class coverage, imbalance) → score /10  
2. Fit means / variances / priors when score ≥ 6 (or load cloud `/gnb_model.json`)  
3. Predict posteriors each loop  

### 5.4 Softmax logistic regression

1. Offline train: `ml_model/pipeline.py` on `dataset/dataset_1.csv` (NumPy softmax + CE)  
2. Export slim JSON (`mean`, `std`, `W`, `b`) to `data/` + `cloud/seed/`  
3. ESP: standardize → \(z = W^\top x' + b\) → softmax → class posteriors  
4. Loaded from LittleFS seed on boot and/or cloud `GET .../logreg`

### 5.5 Ensemble

- Always run ready models each loop (both predictions visible in UI / Serial)  
- Fuse: confidence-weighted average of class posteriors  
- If GNB and LR agree on the argmax class → slight confidence boost  
- Override rules when `ensConfidence ≥ 0.55` **and** ≥ `ruleConfidence`  
- `predictionSource`: `ensemble` | `gnb` | `logreg` | `rules`

### 5.6 Dataset persistence

- Binary `/dataset.bin` on LittleFS (`magic`, `version`, `count`, `Features[]`)  
- Written after each batch collapse; loaded after LittleFS mount  
- Firmware-only flash keeps the file; **`uploadfs` erases it**

### 5.7 Cloud sync (prototype)

| Trigger | Behavior |
| ------- | -------- |
| STA configured + ≥24 rows | Auto `POST /api/ingest` |
| Interval | Re-upload ~every 5 minutes while online |
| After successful upload | Auto-pull GNB + softmax LR |
| STA drop | Reconnect attempt ~every 30 s |
| Manual | SoftAP buttons still available |

Settings save STA SSID/password + cloud URL/API key/device id to `/cloud_cfg.json`.

### 5.8 Sensor fault path

If DS18B20 disconnects (`-127 °C` / 0 devices): keep live **current**, set `sensors.tempOk = false`, show banner; full labeling resumes when temp returns.

### 5.9 SoftAP UX

No internet on SoftAP. Tailwind is bundled in `data/app.css`. Theme toggle, auto-refresh pause, history pagination, CSV/JSON export supported.

---

## 6. How to reproduce

```bash
git clone https://github.com/sayan21m/fire-before-fire.git
cd fire-before-fire
pio run -t upload --upload-port /dev/cu.usbserial-0001
npx --yes tailwindcss@3.4.17 -i ./src-css/input.css -o ./data/app.css --minify   # if CSS changed
pio run -t uploadfs --upload-port /dev/cu.usbserial-0001   # rewrites LittleFS
```

Optional ML retrain:

```bash
cd ml_model && pip install -r requirements.txt
python pipeline.py --csv ../dataset/dataset_1.csv
```

Optional local cloud:

```bash
cd cloud && npm install && npm run train && npm start
```

Join SoftAP **FireBeforeFire** / **firebefore123** → **http://192.168.4.1** → Settings → home Wi‑Fi for auto sync.

---

## 7. Results & status

| Capability                              | Status |
| --------------------------------------- | ------ |
| Current + temperature acquisition       | Implemented |
| Feature extraction + batch dataset      | Implemented |
| Dataset persist across reboot           | Implemented (`/dataset.bin`) |
| DS18B20 fault banner / API health       | Implemented |
| Rule-based warnings + settings UI       | Implemented |
| SoftAP dashboard                        | Implemented |
| Installable PWA + phone notifications   | Implemented (WebSocket fan-out on :81) |
| On-device GNB                           | Implemented |
| Softmax LR (offline train + on-device)  | Implemented |
| GNB + LR ensemble                       | Implemented |
| Render ingest + GNB corpus              | Implemented |
| Auto upload + model pull (prototype)    | Implemented |
| Multi-region / smoke / flame sensors    | Out of scope |
| Production signed OTA / persistent disk | Not claimed |
| Certified fire safety                   | Not claimed |

**Practical note:** Idle-only class-0 data limits GNB sufficiency until warn/critical labels appear. Idle current near **0 A** with a healthy temp sensor is normal with no load.

---

## 8. Risks & limitations

- Labels for `target` come from the same thresholds → **label leakage** for formal ML evaluation  
- `uploadfs` clears dataset, cloud config, and imported models  
- Render free tier disk is **ephemeral**; seed files reload on cold start  
- Auto sync is a prototype (fixed interval, no model signing / versioning UI)  
- ACS712 / DS18B20 noise requires deadbands; calibration quality matters  
- Mains instrumentation requires proper isolation and safety practice  

---

## 9. Future work

- Independent hazard labels (operator tag or secondary sensor)  
- Model version field + “new model available” badge  
- Persistent cloud disk or object storage for long-lived corpora  
- Larger stratified collection for offline sklearn / LR validation  
- Multi-node device registry when hardware allows  

---

## 10. Conclusion

Fire Before Fire demonstrates a complete **local early-warning loop**—sense → feature → rules → labeled memory → GNB + Softmax LR → ensemble → SoftAP dashboard—with an optional **cloud sync path** for corpus growth and model refresh. GitHub history shows collaboration between **frontend scaffolding (Soumili Hazra)** and **embedded + ML/cloud integration (Sayan Garai)**.

---

## Appendix A — Key paths

| Path | Purpose |
| ---- | ------- |
| `src/main.cpp` | Firmware (sense, rules, GNB, LR, ensemble, persist, sync) |
| `data/index.html` / `scripts.js` / `app.css` | SoftAP UI |
| `data/softmax_logreg.json` | LittleFS seed LR weights |
| `dataset/dataset_1.csv` | Offline labeled CSV |
| `ml_model/` | Softmax LR training pipeline |
| `cloud/` | Render API, GNB corpus, seed models |
| `/dataset.bin` | On-device persisted rows |
| `/gnb_model.json` / `/softmax_logreg.json` | Imported / seeded ML weights |
| `/cloud_cfg.json` | STA + cloud settings |

## Appendix B — Default SoftAP

| Setting  | Value |
| -------- | ----- |
| SSID     | `FireBeforeFire` |
| Password | `firebefore123` |
| URL      | `http://192.168.4.1` |

## Appendix C — `/api/status` extras

| Field | Meaning |
| ----- | ------- |
| `sensors.tempOk` | DS18B20 responding |
| `persist.*` | Dataset flash status |
| `cloud.*` | STA / sync status (`trigger: auto_sync`) |
| `gnb.*` | Local/cloud GNB prediction |
| `logreg.*` | Softmax LR prediction |
| `ensemble.*` | Fused posteriors, agree flag, active override |
| `predictionSource` | `rules` \| `gnb` \| `logreg` \| `ensemble` |
