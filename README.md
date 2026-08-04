# Fire Before Fire

Early electrical heating / fire-risk detection on an **ESP32** node.

The board reads **ACS712** (current) and **DS18B20** (temperature), derives heating features, scores risk with a threshold rule engine, and can override warnings with an on-device **Gaussian Naive Bayes** model once the labeled dataset is statistically sufficient. A SoftAP dashboard is served from LittleFS for phones and laptops — no cloud required. Labeled batch rows are **persisted on flash** so they survive power loss.

**Repository:** [github.com/sayan21m/fire-before-fire](https://github.com/sayan21m/fire-before-fire)

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

- SoftAP Wi‑Fi (`FireBeforeFire` / `firebefore123`) → dashboard at `http://192.168.4.1`
- Live KPIs, sparklines, monitoring charts, alerts, event history, CSV/JSON export
- Online/offline pill, theme toggle, auto-refresh, mobile-friendly layout
- Nine-parameter threshold table (manual + adaptive, never below factory defaults)
- Batch averaging (60 samples) → labeled `dataset[]` with target `0|1|2`
- **Persists dataset** to LittleFS `/dataset.bin` across power cycles; reloads + refits GNB on boot
- Sensor health in `/api/status` (`sensors.tempOk`); UI banner when DS18B20 is missing
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

Labeled `dataset[]` rows (max 100) are written to LittleFS as `/dataset.bin` after every batch collapse and reloaded on boot (GNB refits from the saved rows). Settings → **Dataset on flash** shows whether a file is present.

| Action                         | Dataset on flash        |
| ------------------------------ | ----------------------- |
| Power cycle / reset            | **Kept**                |
| `pio run -t upload` (firmware) | **Kept**                |
| `pio run -t uploadfs`          | **Wiped** (FS rewritten)|

---

## Quick start

### 1. Build & flash firmware

```bash
pio run -t upload --upload-port /dev/cu.usbserial-0001
```

Use the real USB-serial port (not Bluetooth earbuds / debug-console aliases). Close Serial Monitor if the port is busy.

### 2. Build CSS (when you change styles)

```bash
npx --yes tailwindcss@3.4.17 -i ./src-css/input.css -o ./data/app.css --minify
```

### 3. Upload web filesystem

```bash
pio run -t uploadfs --upload-port /dev/cu.usbserial-0001
```

Note: this rewrites LittleFS and clears `/dataset.bin`.

### 4. Open the dashboard

1. Join Wi‑Fi **FireBeforeFire** (password `firebefore123`)
2. Ignore “no internet” on the phone
3. Open **http://192.168.4.1**
4. Hard-refresh if the UI looks stale after `uploadfs`

Serial tips:

- `[AP] clients=N` — a client is on the SoftAP
- `DS18B20 devices found: N` — `0` means check GPIO 4 wiring / pull-up
- `[FS] saved dataset` / `loaded dataset` — persistence is working

Optional STA (home Wi‑Fi) can be set via `STA_SSID` / `STA_PASS` in `src/main.cpp` so a laptop can keep internet while still reaching the SoftAP dashboard.

---

## HTTP API

| Method   | Path              | Description                                                          |
| -------- | ----------------- | -------------------------------------------------------------------- |
| GET      | `/api/status`     | Live features, `sensors`, `persist`, thresholds, warnings, GNB state |
| GET      | `/api/dataset`    | Labeled dataset rows                                                 |
| GET      | `/api/gnb`        | Sufficiency / model / confidence                                     |
| GET/POST | `/api/thresholds` | Read / update warn–critical table                                    |
| POST     | `/api/adaptive`   | Enable adaptive thresholds                                           |
| POST     | `/api/defaults`   | Restore factory thresholds                                           |
| GET      | `/api/alerts`     | Recent alert log                                                     |

---

## Prediction pipeline

1. Sample ACS712 + DS18B20 each loop (~1 s); if temp is disconnected, keep current live and flag fault
2. Compute features (MA3, slopes, variance, power, temp acceleration)
3. **Rules:** debounce threshold breaches → risk % + warnings
4. Every **60** samples → batch average → append to `dataset[]` with `target` → **save `/dataset.bin`**
5. If dataset is sufficient → **fit Gaussian NB** (8 features; `powerW` excluded)
6. If NB confidence ≥ 60% **and** ≥ rule confidence → **NB drives** the warning banner

---

## Contributors

| Contributor       | GitHub / focus                                            | Highlights                                                                            |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Sayan Garai**   | [`sayan21m`](https://github.com/sayan21m) · `hardware-sg` | Project init, ESP32 firmware, SoftAP APIs, GNB, live UI, dataset persist, PR #1       |
| **Soumili Hazra** | `software-sh`                                             | Initial HTML dashboard structure and frontend scaffolding; later merge / cleanup PRs  |

See [docs/PROJECT_REPORT.md](docs/PROJECT_REPORT.md) for contribution stats and design notes.

---

## License / academic use

Intended for educational / prototype early-warning research. Not a certified fire-safety product. Always follow local electrical codes and use proper isolation when instrumenting mains circuits.
