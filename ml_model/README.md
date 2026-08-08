# Softmax multiclass logistic regression

Offline NumPy trainer for Fire Before Fire. Use it to bootstrap or refresh the **seed** JSON; day-to-day learning on Render also **refits LR in Node** on every device ingest (`cloud/lib/logreg.js`).

## Train (offline)

```bash
pip install -r requirements.txt
python pipeline.py --csv ../dataset/dataset_1.csv
```

Useful flags:

```bash
python pipeline.py --csv ../dataset/dataset_1.csv --epochs 1200
python pipeline.py --help
```

## Outputs

| Path | Role |
| ---- | ---- |
| `artifacts/softmax_logreg.json` | Full local artifact (may include training history) |
| `artifacts/softmax_logreg.report.json` | Accuracy / per-class metrics when produced |
| `../cloud/seed/softmax_logreg.json` | Slim seed for Render cold start |
| `../data/softmax_logreg.json` | LittleFS seed shipped with `uploadfs` |

On-device / cloud inference: standardize features → logits `X @ W + b` → softmax over `{ok, warn, critical}`.

## How this fits the live system

1. **ESP** labels new batches with **fixed training bands** (not live alert thresholds), uploads via STA.
2. **Render** appends rows and refits **GNB + softmax LR** in process; ESP auto-pulls both.
3. **This Python pipeline** is optional for a stronger offline seed or when you want a report from a CSV before deploy.

Feature schema matches the ESP / `cloud/lib/gnb.js` 8-feature set (`power` excluded from the classifier).

See the root [README.md](../README.md) for SoftAP setup, cloud env vars, and Web Push.
