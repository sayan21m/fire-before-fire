# Fire Before Fire — Project Report

**Repository:** https://github.com/sayan21m/fire-before-fire  
**Report date:** 3 August 2026  
**Branches of record:** `main`, `hardware-sg`, `software-sh`  
**Merged PR:** [#1](https://github.com/sayan21m/fire-before-fire/pull/1) (`hardware-sg` → `main`)

> Generated from the local git history and codebase. No commits or pushes were made while producing this document.

---

## 1. Executive summary

**Fire Before Fire** is an ESP32-based prototype that detects early electrical heating risk from **current** (ACS712) and **temperature** (DS18B20). The node hosts a SoftAP web dashboard (LittleFS), runs a weighted threshold rule engine, stores labeled batch averages, and can switch to an on-device **Gaussian Naive Bayes** predictor when the dataset is statistically sufficient and model confidence exceeds the rule engine.

The work combines:

- Embedded sensing and signal features
- Risk scoring and adaptive thresholds
- A responsive SoftAP UI aligned to the real hardware
- An ML fallback path that does not require cloud training

---

## 2. Problem statement

Electrical fires often grow from sustained overcurrent, poor connections, and conductor heating long before smoke or flame sensors trip. Consumer IoT stacks usually need cloud connectivity. This project targets a **local-first** node that:

1. Measures load current and temperature near the circuit of interest
2. Derives dynamics (slopes, acceleration, variance) that precede steady overheating
3. Warns early via a browser UI on the same SoftAP
4. Learns a simple probabilistic model from its own labeled batches when enough data exists

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
                    Dataset + target
                         ↓
                   Gaussian NB (optional override)
```

| Layer    | Implementation                                                                      |
| -------- | ----------------------------------------------------------------------------------- |
| Sensing  | ACS712 current, DS18B20 temperature, zero-current calibration                       |
| Features | MA3, slopes (5 s), variance, power ≈ 230×\|I\|, temp acceleration, EMA temp         |
| Rules    | Per-parameter warn/critical, importance weights, 3-hit debounce, deadbands          |
| Dataset  | Up to 100 batch averages; target 0/1/2 from thresholds + temperature                |
| ML       | On-device GNB; activate when score ≥ 6 and confidence gates pass                    |
| UI       | `data/` on LittleFS — dashboard, monitoring, hardware, stats, GNB, alerts, settings |
| API      | JSON REST under `/api/*`                                                            |

---

## 4. GitHub contribution analysis

Stats below are derived from **`git log --all --numstat`** on this clone (authors normalized by email).

### 4.1 Contributors

| Contributor       | Identity                            | Commits | Lines added* | Lines removed* | Primary focus                                                     |
| ----------------- | ----------------------------------- | ------- | ------------ | -------------- | ----------------------------------------------------------------- |
| **Sayan Garai**   | `sayan21m` / sayangarai04@gmail.com | **3**   | **~3,057**   | **~1,090**     | Repo init, ESP32 firmware, SoftAP APIs, GNB, live UI, merge PR #1 |
| **Soumili Hazra** | soumilihazra997@gmail.com           | **2**   | **~1,890**   | **0**          | Initial dashboard HTML / frontend scaffolding                     |

\*Approximate churn from numstat (includes refactors and generated CSS).

### 4.2 Branch roles

| Branch        | Role                                                    |
| ------------- | ------------------------------------------------------- |
| `main`        | Integration branch (includes merged hardware work)      |
| `hardware-sg` | Sayan — sensors, firmware, prediction, SoftAP dashboard |
| `software-sh` | Soumili — early frontend dashboard commits              |

### 4.3 Commit timeline

| Date       | Author        | Message                                                            |
| ---------- | ------------- | ------------------------------------------------------------------ |
| 2026-07-27 | Sayan Garai   | `init: initialized project files`                                  |
| 2026-07-27 | Soumili Hazra | `feat: added index.html contining dashboard`                       |
| 2026-07-27 | Soumili Hazra | `feat: Initialize frontend dashboard with placeholder data`        |
| 2026-08-03 | Sayan Garai   | `feat: live ESP32 SoftAP dashboard with rules+GNB fire prediction` |
| 2026-08-03 | Sayan Garai   | `Merge pull request #1 from sayan21m/hardware-sg`                  |

### 4.4 Division of labor (plain language)

- **Soumili** established the **web dashboard shell** (layout, pages, charts placeholders) that later became the SoftAP UI.
- **Sayan** built the **hardware + firmware path**, replaced placeholders with live `/api/status` data, added prediction/GNB, bundled offline CSS, and merged the hardware branch into `main` via **PR #1**.

Together, the repo reflects a classic hardware/software split that was integrated on `main`.

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

### 5.4 SoftAP UX constraints

SoftAP has no internet. Tailwind is **bundled** into `data/app.css`. Plotly is optional when the client is online.

---

## 6. How to reproduce

```bash
git clone https://github.com/sayan21m/fire-before-fire.git
cd fire-before-fire
pio run -t upload
npx --yes tailwindcss@3.4.17 -i ./src-css/input.css -o ./data/app.css --minify   # if CSS changed
pio run -t uploadfs
```

Join SoftAP **FireBeforeFire** / **firebefore123** → open **http://192.168.4.1**.

---

## 7. Results & status

| Capability                           | Status                      |
| ------------------------------------ | --------------------------- |
| Current + temperature acquisition    | Implemented                 |
| Feature extraction + batch dataset   | Implemented                 |
| Rule-based warnings + settings UI    | Implemented                 |
| SoftAP dashboard (hardware-aligned)  | Implemented                 |
| On-device GNB with confidence gate   | Implemented                 |
| Multi-region / smoke / flame sensors | Out of scope for this board |
| Certified fire safety                | Not claimed                 |

**Practical note:** GNB stays on rules until the dataset contains enough **warn/critical** labels (idle-only class-0 data is insufficient by design).

---

## 8. Risks & limitations

- Labels for `target` are derived from the same thresholds → **label leakage** if used as independent ground truth for research papers
- SoftAP RAM dataset is volatile (lost on reboot)
- ACS712 / DS18B20 noise requires deadbands; calibration quality matters
- Mains instrumentation requires proper isolation and safety practice

---

## 9. Future work

- Persist dataset / model to flash or SD
- Independent hazard labels (operator tag or secondary sensor)
- Larger stratified collection for offline sklearn validation
- Optional STA mode for CDN charts while keeping SoftAP for field use
- Expand to multi-node mesh when hardware allows

---

## 10. Conclusion

Fire Before Fire demonstrates a complete **local early-warning loop**: sense → feature → rules → labeled memory → optional GNB → SoftAP dashboard. GitHub history shows clear collaboration between **frontend scaffolding (Soumili Hazra)** and **embedded + live integration (Sayan Garai)**, consolidated on `main` through PR #1.

---

## Appendix A — Key paths

| Path              | Purpose                        |
| ----------------- | ------------------------------ |
| `src/main.cpp`    | Firmware                       |
| `data/index.html` | Dashboard markup               |
| `data/scripts.js` | Live UI / charts / API polling |
| `data/app.css`    | Bundled styles                 |
| `platformio.ini`  | Build & LittleFS               |

## Appendix B — Default SoftAP

| Setting  | Value                |
| -------- | -------------------- |
| SSID     | `FireBeforeFire`     |
| Password | `firebefore123`      |
| URL      | `http://192.168.4.1` |
