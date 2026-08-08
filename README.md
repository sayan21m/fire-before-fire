# Fire Before Fire

Early electrical heating / fire-risk detection on an **ESP32** node.

The board reads **ACS712** (current) and **DS18B20** (temperature), derives heating features, and scores risk with:

1. A **threshold rule engine** (always on)
2. On-device **Gaussian Naive Bayes** (local fit when the labeled dataset is sufficient)
3. **Softmax logistic regression** (weights from `ml_model/` / LittleFS / cloud)
4. A **confidence-weighted ensemble** of GNB + LR that can override rules

A SoftAP dashboard is served from LittleFS for phones and laptops. Labeled batch rows **persist on flash**. With home Wi‑Fi saved once, the node **automatically** uploads data to Render and pulls updated models (prototype sync).

**Repository:** [github.com/sayan21m/fire-before-fire](https://github.com/sayan21m/fire-before-fire)  
**Cloud:** [fire-before-fire.onrender.com](https://fire-before-fire.onrender.com)

---

## Hardware

| Part               | Role                            | ESP32 pin           |
| ------------------ | ------------------------------- | ------------------- |
| ESP32 Dev Module   | MCU + SoftAP web server         | —                   |
| ACS712 (≈185 mV/A) | Load current                    | GPIO **34** (ADC)   |
| DS18B20            | Conductor / ambient temperature | GPIO **4** (1-Wire) |

DS18B20 needs **VCC, GND, data on GPIO 4**, and a **~4.7 kΩ pull-up** from data to 3.3 V. If the bus is open, serial shows `DS18B20 devices found: 0` and the dashboard shows a sensor-fault banner (current can still update).

Derived power for UI / thresholds:

\[
P \approx 230\,\mathrm{V} \times |I|
\]

At idle with no load, **current ≈ 0 A** (and power/risk near zero) is expected after deadband.

---

## Features

- SoftAP Wi‑Fi (`FireBeforeFire`, **device-unique password** printed on Serial / shown in Settings) → `http://192.168.4.1`
- Cloud API key is **not** baked into firmware — set it in Settings to match Render `CLOUD_API_KEY`
- HTTPS to Render uses **CA verification** (GTS Root R4 + ISRG X1); no `setInsecure()`
- Dataset ML labels use **fixed training bands**, independent of live alert thresholds (reduces label leakage)
- Live KPIs, sparklines, monitoring charts, alerts, event history, CSV/JSON export
- Online/offline pill, theme toggle, auto-refresh, mobile-friendly layout
- Nine-parameter threshold table (manual + adaptive, never below factory defaults)
- Batch averaging (60 samples) → labeled `dataset[]` with target `0|1|2`
- **Persists dataset** to LittleFS `/dataset.bin` across power cycles
- **GNB + Softmax LR** predictions shown side-by-side; **ensemble** drives final ML override
- Seeded `/softmax_logreg.json` on LittleFS; cloud can refresh GNB + LR
- **Auto cloud sync** (after home Wi‑Fi is saved): upload from ~24+ rows every ~5 min, then pull models
- Sensor health in `/api/status` (`sensors.tempOk`); UI banner when DS18B20 is missing
- Offline-capable UI (bundled Tailwind CSS; Plotly loads only if the client has internet)

---

## Project layout

```
fire_before_fire/
├── platformio.ini
├── src/main.cpp              # Firmware: sensors, rules, GNB+LR ensemble, SoftAP, auto cloud sync
├── data/                     # LittleFS UI (+ seeded softmax_logreg.json)
├── dataset/dataset_1.csv     # Offline labeled training CSV
├── ml_model/                 # Softmax logistic regression train pipeline (Python)
├── cloud/                    # Render ingest + GNB corpus + model hosting
│   ├── server.js
│   ├── train.js
│   ├── seed/                 # dataset_1.csv + softmax_logreg.json
│   └── lib/
├── src-css/input.css         # Tailwind source → data/app.css
├── docs/PROJECT_REPORT.md
└── render.yaml
```

---

## Dataset persistence

Labeled `dataset[]` rows (max 100) are written to LittleFS as `/dataset.bin` after every batch collapse and reloaded on boot (local GNB refits from the saved rows unless a cloud GNB was imported). Settings → **Dataset on flash** shows whether a file is present.

| Action                         | Dataset on flash        |
| ------------------------------ | ----------------------- |
| Power cycle / reset            | **Kept**                |
| `pio run -t upload` (firmware) | **Kept**                |
| `pio run -t uploadfs`          | **Wiped** (FS rewritten)|

Also wiped by `uploadfs`: `/cloud_cfg.json`, `/gnb_model.json`, `/softmax_logreg.json` (re-seed LR from `data/softmax_logreg.json` on the next `uploadfs`).

---

## Prediction pipeline

1. Sample ACS712 + DS18B20 each loop (~1 s); if temp is disconnected, keep current live and flag fault
2. Compute features (MA3, slopes, variance, power, temp acceleration)
3. **Rules:** debounce threshold breaches → risk % + warnings
4. Every **60** samples → batch average → append to `dataset[]` with `target` → **save `/dataset.bin`**
5. If dataset is sufficient → **fit Gaussian NB** locally (8 features; `powerW` excluded)
6. If Softmax LR weights are loaded → **predict LR** every loop
7. **Ensemble:** confidence-weighted average of GNB + LR posteriors (agreement boost if both agree)
8. If ensemble confidence ≥ 55% **and** ≥ rule confidence → **ensemble drives** status / warning banner

SoftAP Bayesian page shows **GNB**, **LR**, and **ensemble** posteriors separately.

---

## Softmax LR training (`ml_model/`)

Offline multiclass logistic regression with softmax + cross-entropy (NumPy):

```bash
cd ml_model
pip install -r requirements.txt
python pipeline.py --csv ../dataset/dataset_1.csv
```

Writes `ml_model/artifacts/` and syncs slim weights to:

- `cloud/seed/softmax_logreg.json` (Render / ESP import)
- `data/softmax_logreg.json` (LittleFS seed on `uploadfs`)

---

## Cloud (Render) — corpus GNB + hosted LR + auto device sync

Default host: [https://fire-before-fire.onrender.com](https://fire-before-fire.onrender.com)

**Server pipeline**

1. Boot: seed corpus from `cloud/seed/*.csv`, fit global GNB; install `softmax_logreg.json`
2. `POST /api/ingest`: append device rows → refit GNB
3. `GET /api/devices/:id/model` / `.../logreg`: ESP pulls latest weights

**On the ESP (prototype auto-sync)**

1. SoftAP → **Settings** → home Wi‑Fi + cloud URL/API key → **Save & connect** (once)
2. SoftAP stays up; STA reaches Render in the background
3. From **≥24** labeled rows, every **~5 minutes** (and on retries): upload dataset → pull GNB + LR  
   Manual **Upload & import GNB** / **Import softmax LR** buttons remain as fallbacks

Local cloud train:

```bash
cd cloud
npm install
npm run train              # seed + fit GNB
npm run train:reset        # wipe corpus, re-seed, fit
npm start                  # local API on :3000
```

Render env `CLOUD_API_KEY` must match the device key (`cloud/.env` / Settings).

Also set on Render for **OS notifications** (Web Push):

```text
VAPID_PUBLIC_KEY=…
VAPID_PRIVATE_KEY=…
VAPID_SUBJECT=mailto:you@example.com
```

Generate with `npx web-push generate-vapid-keys --json`. Subscribe phones at
`https://fire-before-fire.onrender.com/notify?device=esp32-01` (HTTPS required —
SoftAP HTTP cannot grant OS permission).

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| POST | `/api/ingest` | Bearer | Append device rows → refit GNB |
| GET | `/api/devices/:id/model` | Bearer | Download latest GNB |
| GET | `/api/devices/:id/logreg` | Bearer | Download softmax LR |
| POST | `/api/devices/:id/notify` | Bearer | ESP hazard → OS Web Push |
| GET | `/api/push/vapid-public` | — | Public VAPID key for subscribe page |
| POST | `/api/push/subscribe` | — | Store browser push subscription |
| POST | `/api/push/test` | — | Send a test OS notification |
| GET | `/notify` | — | HTTPS page to enable OS notifications |
| GET | `/api/train/status` | Bearer | Corpus / seed / fit stats |
| POST | `/api/train/refit` | Bearer | Force GNB refit |
| GET | `/health` | — | Liveness |

**Note:** Render free disks are ephemeral — seed CSVs/JSON reload on cold start; device uploads are re-learned after the next auto-sync.

---

## Quick start

### 1. Build & flash firmware

```bash
pio run -t upload --upload-port /dev/cu.usbserial-0001
```

Use the real USB-serial port. Close Serial Monitor if the port is busy.

### 2. Build CSS (when you change styles)

```bash
npx --yes tailwindcss@3.4.17 -i ./src-css/input.css -o ./data/app.css --minify
```

### 3. Upload web filesystem

```bash
pio run -t uploadfs --upload-port /dev/cu.usbserial-0001
```

Rewrites LittleFS (clears `/dataset.bin` and saved cloud config).

### 4. Open the dashboard

1. Join Wi‑Fi **FireBeforeFire** — password is **device-unique** (`fbf` + last 6 hex of MAC). Read it from Serial Monitor on boot, or from Settings after you connect.
2. Ignore “no internet” on the phone
3. Open **http://192.168.4.1**
4. **Settings** → home Wi‑Fi + **Cloud API key** (must match Render `CLOUD_API_KEY`) → **Save & connect**
5. **Settings → App & phone notifications** → **Enable OS notifications** (opens HTTPS `/notify` on Render; leave SoftAP first) + optional in-app alerts / Install app  
   Other phones on home Wi‑Fi: open the **LAN URL** shown there (ESP STA IP)
6. Hard-refresh if the UI looks stale after `uploadfs`

Serial tips:

- `[AP] clients=N` — a client is on the SoftAP
- `DS18B20 devices found: N` — `0` means check GPIO 4 wiring / pull-up
- `[FS] saved dataset` / `loaded dataset` — persistence is working
- `[GNB]` / `[LR]` / `[ENS]` — per-model and ensemble decisions
- `[CLOUD]` — auto upload / model pull
- `[PUSH]` — OS Web Push notify to cloud
- `[PWA]` — WebSocket alert broadcast to connected phones

---

## SoftAP HTTP API

| Method   | Path                       | Description |
| -------- | -------------------------- | ----------- |
| GET      | `/api/status`              | Live features, `sensors`, `persist`, `cloud`, `gnb`, `logreg`, `ensemble` |
| GET      | `/api/dataset`             | Labeled dataset rows |
| GET      | `/api/gnb`                 | GNB sufficiency / model / confidence |
| GET/POST | `/api/cloud/config`        | STA + cloud settings |
| POST     | `/api/cloud/import-gnb`    | Manual GNB pull |
| POST     | `/api/cloud/import-logreg` | Manual LR pull |
| GET/POST | `/api/thresholds`          | Read / update warn–critical table |
| POST     | `/api/adaptive`            | Enable adaptive thresholds |
| POST     | `/api/defaults`            | Restore factory thresholds |
| GET      | `/api/alerts`              | Recent alert log |

---

## Contributors

| Contributor       | GitHub / focus                                            | Highlights |
| ----------------- | --------------------------------------------------------- | ---------- |
| **Sayan Garai**   | [`sayan21m`](https://github.com/sayan21m) · `hardware-sg` | Firmware, SoftAP APIs, GNB/LR ensemble, persist, cloud sync, UI |
| **Soumili Hazra** | [`soumili122004`](https://github.com/soumili122004) · `software-sh` | Initial HTML dashboard scaffolding; later merge / cleanup PRs |

See [docs/PROJECT_REPORT.md](docs/PROJECT_REPORT.md) for contribution stats and design notes.

---

## License / academic use

Intended for educational / prototype early-warning research. Not a certified fire-safety product. Always follow local electrical codes and use proper isolation when instrumenting mains circuits.
