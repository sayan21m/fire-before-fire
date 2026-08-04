# Fire Before Fire

Early electrical heating / fire-risk detection on an **ESP32** node.

The board reads **ACS712** (current) and **DS18B20** (temperature), derives heating features, scores risk with a threshold rule engine, and can override warnings with an on-device **Gaussian Naive Bayes** model once the labeled dataset is statistically sufficient. A SoftAP dashboard is served from LittleFS for phones and laptops — no cloud required.

**Repository:** [github.com/sayan21m/fire-before-fire](https://github.com/sayan21m/fire-before-fire)

---

## Hardware

| Part               | Role                            | ESP32 pin           |
| ------------------ | ------------------------------- | ------------------- |
| ESP32 Dev Module   | MCU + SoftAP web server         | —                   |
| ACS712 (≈185 mV/A) | Load current                    | GPIO **34** (ADC)   |
| DS18B20            | Conductor / ambient temperature | GPIO **4** (1-Wire) |

Derived power for UI / thresholds:

\[
P \approx 230\,\mathrm{V} \times |I|
\]

---

## Features

- SoftAP Wi‑Fi (`FireBeforeFire` / `firebefore123`) → dashboard at `http://192.168.4.1`
- Live KPIs, sparklines, monitoring charts, alerts, event history
- Nine-parameter threshold table (manual + adaptive, never below factory defaults)
- Batch averaging (60 samples) → labeled `dataset[]` with target `0|1|2`
- **Persists dataset** on LittleFS across power cycles
- Gaussian NB fit when sufficiency score ≥ 6; overrides rules when confidence is high enough
- Offline-capable UI (bundled Tailwind CSS; Plotly loads only if the client has internet)

---

## Project layout

```
fire_before_fire/
├── platformio.ini          # ESP32 + LittleFS + libs
├── src/main.cpp            # Sensors, prediction, SoftAP, dataset persist
├── data/                   # Files uploaded to LittleFS
│   ├── index.html
│   ├── scripts.js
│   └── app.css
├── src-css/input.css       # Tailwind source
├── tailwind.config.js
├── docs/PROJECT_REPORT.md
└── README.md
```

---

## Dataset persistence

Labeled `dataset[]` rows are written to LittleFS as `/dataset.bin` after every batch collapse and reloaded on boot (GNB refits from the saved rows).

- Survives power loss and **firmware-only** uploads (`pio run -t upload`)
- **Wiped** by `pio run -t uploadfs` (full filesystem rewrite)

---

## Quick start

### 1. Build & flash firmware

```bash
pio run -t upload
```

### 2. Build CSS (when you change styles)

```bash
npx --yes tailwindcss@3.4.17 -i ./src-css/input.css -o ./data/app.css --minify
```

### 3. Upload web filesystem

Close Serial Monitor if the port is busy, then:

```bash
pio run -t uploadfs
```

### 4. Open the dashboard

1. Join Wi‑Fi **FireBeforeFire** (password `firebefore123`)
2. Ignore “no internet” on the phone
3. Open **http://192.168.4.1**

Serial tip: `[AP] clients=N` confirms a client is on the SoftAP.

---

## HTTP API

| Method   | Path              | Description                                    |
| -------- | ----------------- | ---------------------------------------------- |
| GET      | `/api/status`     | Live features, thresholds, warnings, GNB state |
| GET      | `/api/dataset`    | Labeled dataset rows                           |
| GET      | `/api/gnb`        | Sufficiency / model / confidence               |
| GET/POST | `/api/thresholds` | Read / update warn–critical table              |
| POST     | `/api/adaptive`   | Enable adaptive thresholds                     |
| POST     | `/api/defaults`   | Restore factory thresholds                     |
| GET      | `/api/alerts`     | Recent alert log                               |

---

## Prediction pipeline

1. Sample ACS712 + DS18B20 each loop (~1 s)
2. Compute features (MA3, slopes, variance, power, temp acceleration)
3. **Rules:** debounce threshold breaches → risk % + warnings
4. Every **60** samples → batch average → append to `dataset[]` with `target`
5. If dataset is sufficient → **fit Gaussian NB** (8 features; `powerW` excluded)
6. If NB confidence ≥ 60% **and** ≥ rule confidence → **NB drives** the warning banner

---

## Contributors

| Contributor       | GitHub / focus                                            | Highlights                                                                            |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Sayan Garai**   | [`sayan21m`](https://github.com/sayan21m) · `hardware-sg` | Project init, ESP32 firmware, SoftAP APIs, GNB pipeline, live dashboard wiring, PR #1 |
| **Soumili Hazra** | `software-sh`                                             | Initial HTML dashboard structure and frontend scaffolding                             |

See [docs/PROJECT_REPORT.md](docs/PROJECT_REPORT.md) for contribution stats and design notes.

---

## License / academic use

Intended for educational / prototype early-warning research. Not a certified fire-safety product. Always follow local electrical codes and use proper isolation when instrumenting mains circuits.
