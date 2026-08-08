# Softmax multiclass logistic regression (offline)

Train on labeled Fire Before Fire CSVs, then sync weights for the ESP / Render:

```bash
pip install -r requirements.txt
python pipeline.py --csv ../dataset/dataset_1.csv
```

Outputs slim JSON to `artifacts/`, `../cloud/seed/softmax_logreg.json`, and `../data/softmax_logreg.json`.

On-device inference: standardize → logits `Wᵀx' + b` → softmax. See root `README.md` and `docs/PROJECT_REPORT.md`.
