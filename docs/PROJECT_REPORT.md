# Fire Before Fire — Project Report

**Repository:** https://github.com/sayan21m/fire-before-fire  
**Report date:** 4 August 2026  
**Branches of record:** `main`, `hardware-sg`, `software-sh`  
**Merged PRs (selected):** [#1](https://github.com/sayan21m/fire-before-fire/pull/1) (`hardware-sg` → `main`), [#5](https://github.com/sayan21m/fire-before-fire/pull/5) (`software-sh` → `main`)

> Updated from the local git history and codebase after dataset persistence and SoftAP UI hardening landed.

---

## 1. Executive summary

**Fire Before Fire** is an ESP32-based prototype that detects early electrical heating risk from **current** (ACS712) and **temperature** (DS18B20). The node hosts a SoftAP web dashboard (LittleFS), runs a weighted threshold rule engine, stores labeled batch averages on **flash** (`/dataset.bin`), and can switch to an on-device **Gaussian Naive Bayes** predictor when the dataset is statistically sufficient and model confidence exceeds the rule engine.

The work combines:

- Embedded sensing and signal features (with DS18B20 fault visibility)
- Risk scoring and adaptive thresholds
- A responsive SoftAP UI aligned to the real hardware
- Local labeled memory that survives reboot (no cloud required)
- An ML fallback path that does not require cloud training

---

## 2. Problem statement

Electrical fires often grow from sustained overcurrent, poor connections, and conductor heating long before smoke or flame sensors trip. Consumer IoT stacks usually need cloud connectivity. This project targets a **local-first** node that:

1. Measures load current and temperature near the circuit of interest
2. Derives dynamics (slopes, acceleration, variance) that precede steady overheating
3. Warns early via a browser UI on the same SoftAP
4. Keeps labeled batches across power cycles so GNB can resume after reboot
5. Learns a simple probabilistic model from its own labeled batches when enough data exists

---

## 3. System architecture

```
┌─────────────┐     ADC      ┌──────────────┐
│   ACS712    │─────────────►│              │
└─────────────┘   GPIO 34    │              │     SoftAP
┌─────────────┐   1-Wire     │    ESP32     │◄──────────────► Phone / laptop
│   DS18B20   │─────────────►│  firmware   │   192.168.4.1
└─────────────┘   GPIO 4     │  + LittleFS │
                             └──────┬───────┘
                                    │
                    Features → Rules → Alerts
                         ↓
              Dataset + target → /dataset.bin
                         ↓
                   Gaussian NB (optional override)
```

| Layer      | Implementation                                                                      |
| ---------- | ----------------------------------------------------------------------------------- |
| Sensing    | ACS712 current, DS18B20 temperature, zero-current calibration; `tempOk` health flag |
| Features   | MA3, slopes (5 s), variance, power ≈ 230×\|I\|, temp acceleration, EMA temp         |
| Rules      | Per-parameter warn/critical, importance weights, 3-hit debounce, deadbands          |
| Dataset    | Up to 100 batch averages; target 0/1/2; saved to `/dataset.bin`                     |
| ML         | On-device GNB; activate when score ≥ 6 and confidence gates pass                    |
| UI         | `data/` on LittleFS — dashboard, monitoring, hardware, stats, GNB, alerts, settings |
| API        | JSON REST under `/api/*` (includes `sensors` + `persist` on `/api/status`)          |

---

## 4. GitHub contribution analysis

Stats below are derived from **`git log --all`** on this clone (authors as recorded by GitHub / local config).

### 4.1 Contributors

| Contributor       | Identity / focus | Primary focus                                                                 |
| ----------------- | ---------------- | ----------------------------------------------------------------------------- |
| **Sayan Garai**   | `sayan21m`       | Repo init, ESP32 firmware, SoftAP APIs, GNB, live UI, dataset persist, docs   |
| **Soumili Hazra** | `software-sh`    | Initial dashboard HTML scaffolding; later merges / `.gitignore` / cleanup PRs |

### 4.2 Branch roles

| Branch        | Role                                                    |
| ------------- | ------------------------------------------------------- |
| `main`        | Integration branch                                      |
| `hardware-sg` | Sayan — sensors, firmware, prediction, SoftAP dashboard |
| `software-sh` | Soumili — early frontend; later UI / merge work         |

### 4.3 Commit timeline (selected)

| Date       | Author        | Message                                                                     |
| ---------- | ------------- | --------------------------------------------------------------------------- |
| 2026-07-27 | Sayan Garai   | `init: initialized project files`                                           |
| 2026-07-27 | Soumili Hazra | `feat: added index.html contining dashboard`                                |
| 2026-07-27 | Soumili Hazra | `feat: Initialize frontend dashboard with placeholder data`                 |
| 2026-08-03 | Sayan Garai   | `feat: live ESP32 SoftAP dashboard with rules+GNB fire prediction`          |
| 2026-08-03 | Sayan Garai   | `Merge pull request #1 from sayan21m/hardware-sg`                           |
| 2026-08-03 | Sayan Garai   | `docs: add README and project report; prettify web sources`                 |
| 2026-08-04 | Sayan Garai   | `feat: persist labeled dataset on LittleFS and harden live SoftAP UI`       |
| 2026-08-04 | Soumili Hazra | Merge PRs #2–#5 (cleanup / hardware / software-sh → main)                   |

### 4.4 Division of labor (plain language)

- **Soumili** established the **web dashboard shell** (layout, pages, charts placeholders) that later became the SoftAP UI, and helped integrate later branch merges.
- **Sayan** built the **hardware + firmware path**, replaced placeholders with live `/api/status` data, added prediction/GNB, bundled offline CSS, **persisted the dataset to LittleFS**, and hardened the live UI (sensor fault banner, online/offline, exports).

Together, the repo reflects a hardware/software split integrated on `main`.

---

## 5. Technical design

### 5.1 Feature vector

| Feature                      | Source                           |
| ---------------------------- | -------------------------------- |
| `currentA`                   | ACS712                           |
| `tempC`                      | DS18B20 (EMA)                    |
| `ma3I` / `ma3T`              | 3-sample moving averages         |
| `currentSlope` / `tempSlope` | ~5 s window                      |
| `varI`                       | Current variance over history    |
| `powerW`                     | 230 × \|I\|                      |
| `tempAcc`                    | Δ(tempSlope)/Δt                  |
| `target`                     | Label 0 ok / 1 warn / 2 critical |

### 5.2 Rule engine

- Importance-weighted contributions to `riskPercent`
- Debounce (`WARN_HOLD_COUNT = 3`) and deadbands to cut idle false alarms
- Adaptive thresholds may rise from calm data but **never fall below factory defaults**

### 5.3 Gaussian NB pipeline

1. Assess sufficiency (sample count, class coverage, imbalance) → score /10
2. Fit class means/variances/priors when score ≥ 6
3. Predict posteriors each loop
4. If `confidence ≥ 0.60` **and** `confidence ≥ ruleConfidence` → NB overrides warning UI

`powerW` is excluded from GNB features (algebraically tied to current).

### 5.4 Dataset persistence

- Binary file `/dataset.bin` on LittleFS (`magic`, `version`, `count`, `Features[]`)
- Written after each batch collapse; loaded in `setup` after LittleFS mount
- On load: restore `datasetCount`, last batch average, then `fitGaussianNB()`
- Firmware-only flash keeps the file; **`uploadfs` erases it**

### 5.5 Sensor fault path

If DS18B20 returns disconnect (`-127 °C` / 0 devices):

- Do **not** freeze the entire feature pipeline at boot zeros
- Still update live **current / power** for the API
- Expose `sensors.tempOk = false` and show a dashboard banner
- Full feature + labeling resumes when the sensor responds again

### 5.6 SoftAP UX constraints

SoftAP has no internet. Tailwind is **bundled** into `data/app.css`. Plotly is optional when the client is online. The UI also supports theme toggle, auto-refresh pause, history pagination, and CSV/JSON export of logged events / dataset snapshots when the device is reachable.

---

## 6. How to reproduce

```bash
git clone https://github.com/sayan21m/fire-before-fire.git
cd fire-before-fire
pio run -t upload --upload-port /dev/cu.usbserial-0001
npx --yes tailwindcss@3.4.17 -i ./src-css/input.css -o ./data/app.css --minify   # if CSS changed
pio run -t uploadfs --upload-port /dev/cu.usbserial-0001   # rewrites LittleFS (clears /dataset.bin)
```

Join SoftAP **FireBeforeFire** / **firebefore123** → open **http://192.168.4.1**.

---

## 7. Results & status

| Capability                           | Status                      |
| ------------------------------------ | --------------------------- |
| Current + temperature acquisition    | Implemented                 |
| Feature extraction + batch dataset   | Implemented                 |
| Dataset persist across reboot        | Implemented (`/dataset.bin`)|
| DS18B20 fault banner / API health    | Implemented                 |
| Rule-based warnings + settings UI    | Implemented                 |
| SoftAP dashboard (hardware-aligned)  | Implemented                 |
| On-device GNB with confidence gate   | Implemented                 |
| Multi-region / smoke / flame sensors | Out of scope for this board |
| Cloud upload / remote training       | Out of scope (local-first)  |
| Certified fire safety                | Not claimed                 |

**Practical note:** GNB stays on rules until the dataset contains enough **warn/critical** labels (idle-only class-0 data is insufficient by design). Idle current near **0 A** with a healthy temp sensor is normal with no load.

---

## 8. Risks & limitations

- Labels for `target` are derived from the same thresholds → **label leakage** if used as independent ground truth for research papers
- `uploadfs` clears persisted datasets; operators must re-collect after a full FS rewrite
- ACS712 / DS18B20 noise requires deadbands; calibration quality matters
- Missing DS18B20 pull-up / wiring yields `devices=0` and blocks temperature-driven labeling
- Mains instrumentation requires proper isolation and safety practice

---

## 9. Future work

- Independent hazard labels (operator tag or secondary sensor)
- Larger stratified collection for offline sklearn validation
- Optional STA mode for CDN charts while keeping SoftAP for field use
- Persist GNB model parameters separately (today the model is refit from the saved dataset)
- Expand to multi-node mesh when hardware allows

---

## 10. Conclusion

Fire Before Fire demonstrates a complete **local early-warning loop**: sense → feature → rules → labeled memory on flash → optional GNB → SoftAP dashboard. GitHub history shows collaboration between **frontend scaffolding (Soumili Hazra)** and **embedded + live integration (Sayan Garai)**, with dataset persistence closing the reboot gap that previously wiped on-device learning progress.

---

## Appendix A — Key paths

| Path              | Purpose                                 |
| ----------------- | --------------------------------------- |
| `src/main.cpp`    | Firmware (sense, rules, GNB, persist)   |
| `data/index.html` | Dashboard markup                        |
| `data/scripts.js` | Live UI / charts / API polling / export |
| `data/app.css`    | Bundled styles                          |
| `platformio.ini`  | Build & LittleFS                        |
| `/dataset.bin`    | On-device persisted labeled rows (FS)    |

## Appendix B — Default SoftAP

| Setting  | Value                |
| -------- | -------------------- |
| SSID     | `FireBeforeFire`     |
| Password | `firebefore123`      |
| URL      | `http://192.168.4.1` |

## Appendix C — `/api/status` extras

| Field                 | Meaning                                      |
| --------------------- | -------------------------------------------- |
| `sensors.tempOk`      | DS18B20 responding                           |
| `sensors.tempDevices` | 1-Wire device count                          |
| `persist.path`        | Always `/dataset.bin`                        |
| `persist.saved`       | File present on LittleFS                     |
| `persist.count`       | Rows currently in RAM dataset                |
