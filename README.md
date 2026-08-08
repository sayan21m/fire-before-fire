# Fire Before Fire

Early electrical heating / fire-risk detection on an **ESP32** node.

The board reads **ACS712** (current) and **DS18B20** (temperature), derives heating features, and scores risk with:

1. A **threshold rule engine** (always on — live alerts)
2. On-device **Gaussian Naive Bayes** (local fit when the labeled dataset is sufficient)
3. **Softmax logistic regression** (weights from LittleFS / cloud online refit / optional Python seed)
4. A **confidence-weighted ensemble** of GNB + LR that can override rules when confident

A SoftAP dashboard is served from LittleFS for phones and laptops. Labeled batch rows **persist on flash**. With home Wi‑Fi and an API key saved once, the node **automatically** uploads data to Render, which **refits GNB + softmax LR**, then the ESP pulls updated models.

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

### Networking & UI
- SoftAP `FireBeforeFire` with a **device-unique password** (`fbf` + last 6 hex of MAC) — printed on Serial at boot and shown in Settings after you connect → `http://192.168.4.1`
- SoftAP stays up in **AP+STA** while home Wi‑Fi is used for cloud sync
- Live KPIs, sparklines, monitoring charts, alerts, history, CSV/JSON export
- Installable PWA shell; in-app alerts over **WebSocket :81** (banner / beep / vibrate)
- **OS notifications** via HTTPS Web Push on Render (`/notify`) — SoftAP HTTP cannot grant OS permission
- Offline-capable UI (bundled Tailwind; Plotly loads only if the client has internet)

### Sensing & identity
- Per-device **sensor IDs + locations** under `deviceId` (e.g. `esp32-01` → `I-01` / `T-01`) — editable in Settings; shown on hardware cards and in alerts / push text
- Sensor health in `/api/status`; UI banner when DS18B20 is missing

### Rules & ML
- Nine-parameter threshold table (manual + adaptive, never below factory defaults) for **live alerts**
- Dataset rows labeled with **fixed training bands** (`TRAIN_LABEL`), **independent** of alert thresholds (reduces label leakage when adaptive/Settings change)
- Batch averaging (60 samples) → labeled `dataset[]` (max 100) → **persist** `/dataset.bin`
- **GNB + Softmax LR** side-by-side; **ensemble** can override rules when conf ≥ 55%

### Cloud
- Cloud API key is **not** hardcoded in firmware — set in Settings to match Render `CLOUD_API_KEY`
- HTTPS to Render uses **CA verification** (`src/certs.h`: GTS Root R4 + ISRG X1) — no `setInsecure()`
- **Auto sync:** ≥24 rows, ~every 5 min → ingest → cloud **refits GNB and LR** → ESP pulls both

---

## Project layout

```
fire_before_fire/
├── platformio.ini
├── src/
│   ├── main.cpp              # Firmware: sensors, rules, ML, SoftAP, sync, push
│   └── certs.h               # TLS roots (GTS R4 + ISRG X1)
├── data/                     # LittleFS UI (+ seeded softmax_logreg.json, PWA assets)
├── dataset/dataset_1.csv     # Offline labeled training CSV
├── ml_model/                 # Optional Python LR train → seed JSON
├── cloud/                    # Render: ingest, GNB+LR refit, Web Push
│   ├── server.js
│   ├── train.js
│   ├── public/               # /notify HTTPS subscribe page
│   ├── seed/                 # dataset_1.csv + softmax_logreg.json
│   └── lib/{pipeline,gnb,logreg,push}.js
├── src-css/input.css
├── docs/PROJECT_REPORT.md
└── render.yaml
```

---

## Dataset persistence

Labeled `dataset[]` rows (max 100) are written to LittleFS as `/dataset.bin` after every batch collapse and reloaded on boot (local GNB refits from saved rows unless a cloud GNB was imported). Settings → **Dataset on flash** shows whether a file is present.

| Action                         | Dataset on flash         |
| ------------------------------ | ------------------------ |
| Power cycle / reset            | **Kept**                 |
| `pio run -t upload` (firmware) | **Kept**                 |
| `pio run -t uploadfs`          | **Wiped** (FS rewritten) |

Also wiped by `uploadfs`: `/cloud_cfg.json`, `/gnb_model.json`, `/softmax_logreg.json` (re-seed LR from `data/softmax_logreg.json` on the next `uploadfs`). Re-enter home Wi‑Fi + API key in Settings after `uploadfs`.

---

## Prediction pipeline

1. Sample ACS712 + DS18B20 each loop (~1 s); if temp is disconnected, keep current live and flag fault
2. Compute features (MA3, slopes, variance, power, temp acceleration)
3. **Rules:** debounce using **live** `params[]` thresholds → risk % + warnings (alerts / WS / OS push)
4. Every **60** samples → batch average → append to `dataset[]` with **`computeTrainLabel()`** (fixed bands) → save `/dataset.bin`
5. If dataset is sufficient and no cloud GNB is locked in → **fit Gaussian NB** locally (8 features; `powerW` excluded)
6. If Softmax LR weights are loaded → **predict LR** every loop
7. **Ensemble:** confidence-weighted average of GNB + LR (agreement boost if both agree)
8. If ensemble confidence ≥ 55% **and** ≥ rule confidence → **ensemble drives** status / warning banner

`/api/status` features include both `trainLabel` and `ruleClass` so you can see the split. SoftAP Bayesian page shows GNB, LR, and ensemble posteriors separately.

---

## Softmax LR training

### Online (default on Render)
Each `POST /api/ingest` appends rows and **refits softmax LR in Node** (`cloud/lib/logreg.js`) → `data/models/softmax_logreg.json`. The ESP auto-pulls after sync. No Python required on Render.

### Offline seed (optional, stronger bootstrap)
```bash
cd ml_model
pip install -r requirements.txt
python pipeline.py --csv ../dataset/dataset_1.csv
```

Writes `ml_model/artifacts/` and syncs slim weights to:

- `cloud/seed/softmax_logreg.json` (cold-start seed if no online model yet)
- `data/softmax_logreg.json` (LittleFS seed on `uploadfs`)

---

## Cloud (Render)

Default host: [https://fire-before-fire.onrender.com](https://fire-before-fire.onrender.com)

### Server pipeline

1. Boot: seed corpus from `cloud/seed/*.csv`, fit GNB; install or keep online `softmax_logreg.json`
2. `POST /api/ingest`: append device rows → **refit GNB + softmax LR**
3. `GET /api/devices/:id/model` / `.../logreg`: ESP pulls latest weights
4. `POST /api/devices/:id/notify`: Web Push to phones subscribed at `/notify`

### On the ESP (auto-sync)

1. SoftAP → **Settings** → home Wi‑Fi + **Cloud API key** (match Render) → **Save & connect**
2. SoftAP stays up; STA reaches Render in the background
3. From **≥24** labeled rows, every **~5 minutes**: upload → pull GNB + LR  
   Manual import buttons remain as fallbacks

### Local cloud

```bash
cd cloud
cp .env.example .env   # set CLOUD_API_KEY + VAPID_* 
npm install
npm run train          # seed + fit GNB (+ LR if corpus ready)
npm start              # :3000
```

### Render environment

| Variable | Purpose |
| -------- | ------- |
| `CLOUD_API_KEY` | Must match SoftAP Settings → API key |
| `DEFAULT_DEVICE_ID` | Usually `esp32-01` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | OS Web Push |

Generate VAPID keys: `npx web-push generate-vapid-keys --json`.  
Subscribe phones at `https://fire-before-fire.onrender.com/notify?device=esp32-01` (use **home Wi‑Fi or mobile data**, not SoftAP).

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| POST | `/api/ingest` | Bearer | Append rows → refit **GNB + LR** |
| GET | `/api/devices/:id/model` | Bearer | Download GNB |
| GET | `/api/devices/:id/logreg` | Bearer | Download softmax LR |
| POST | `/api/devices/:id/notify` | Bearer | Hazard → OS Web Push |
| GET | `/api/push/vapid-public` | — | Public VAPID key |
| POST | `/api/push/subscribe` | — | Store push subscription |
| POST | `/api/push/test` | — | Test OS notification |
| GET | `/notify` | — | HTTPS subscribe page |
| GET | `/api/train/status` | Bearer | Corpus / fit stats |
| POST | `/api/train/refit` | Bearer | Force GNB + LR refit |
| GET | `/health` | — | Liveness (`pushEnabled`, corpus size) |

**Note:** Render free disks are **ephemeral** — corpus, online models, and push subscriptions can reset on cold start (seeds reload). Re-subscribe phones and wait for the next ESP sync after a wipe.

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

1. Open **Serial Monitor (115200)** — note SoftAP password (`Password: fbf……`)
2. Join Wi‑Fi **FireBeforeFire** with that password (ignore “no internet”)
3. Open **http://192.168.4.1**
4. **Settings** → SoftAP password is also shown there after connect
5. **Settings** → home Wi‑Fi + **Cloud API key** (= Render `CLOUD_API_KEY`) → **Save & connect**
6. Optional: set current/temp **sensor ID + location**
7. **App & phone notifications** → Enable OS notifications (open Render `/notify` on mobile data / home Wi‑Fi) and/or in-app alerts
8. Hard-refresh if the UI looks stale after `uploadfs`

### Serial tips

| Tag | Meaning |
| --- | ------- |
| SoftAP `Password:` | Device-unique WPA password |
| `[AP] clients=N` | Phone/laptop on SoftAP |
| `DS18B20 devices found: N` | `0` → check GPIO 4 / pull-up |
| `[FS] saved/loaded dataset` | Persistence OK |
| `[GNB]` / `[LR]` / `[ENS]` | Model decisions |
| `[CLOUD]` | Upload / model pull (TLS verified) |
| `[PUSH]` | OS notify POST to cloud |
| `[PWA]` | WebSocket alert broadcast |

---

## SoftAP HTTP API

| Method   | Path                       | Description |
| -------- | -------------------------- | ----------- |
| GET      | `/api/status`              | Live features (`trainLabel` / `ruleClass`), `sensors` (ids/locations), `network.apPass`, `cloud`, `gnb`, `logreg`, `ensemble` |
| GET      | `/api/dataset`             | Labeled dataset rows |
| GET      | `/api/gnb`                 | GNB sufficiency / model / confidence |
| GET/POST | `/api/cloud/config`        | STA + cloud URL/key + deviceId + sensor ids/locations |
| POST     | `/api/cloud/import-gnb`    | Manual GNB pull |
| POST     | `/api/cloud/import-logreg` | Manual LR pull |
| GET/POST | `/api/thresholds`          | Live alert warn–critical table |
| POST     | `/api/adaptive`            | Adaptive **alert** thresholds (does not change train labels) |
| POST     | `/api/defaults`            | Restore factory alert thresholds |
| GET      | `/api/alerts`              | Recent alert log |

SoftAP write APIs are still a **local trust boundary** (anyone on the SoftAP can change settings). Treat the SoftAP password as the gate for demos.

---

## Security notes (prototype)

| Item | Behavior |
| ---- | -------- |
| SoftAP password | Per-chip, not a shared hardcoded string |
| Cloud API key | Empty until set in Settings; must match Render |
| HTTPS | CA-verified roots in `src/certs.h` |
| Train vs alert labels | Independent bands vs live thresholds |
| Web Push subscribe | Open endpoints on `/notify` path — fine for a private demo; lock down for shared deploys |

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
