#!/usr/bin/env python3
"""
Train multiclass logistic regression (softmax) on Fire Before Fire CSVs.

  python pipeline.py
  python pipeline.py --csv ../dataset/dataset_1.csv
  python pipeline.py --csv ../dataset/dataset_1.csv --epochs 1200 --out artifacts/model.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data import CLASS_NAMES, FEATURE_NAMES, class_counts, load_csv, load_many
from softmax_logreg import SoftmaxLogReg

DEFAULT_CSV = ROOT.parent / "dataset" / "dataset_1.csv"
DEFAULT_OUT = ROOT / "artifacts" / "softmax_logreg.json"


def stratified_split(
    X: np.ndarray, y: np.ndarray, test_frac: float, seed: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Hold out ~test_frac per class when possible; tiny classes stay in train."""
    rng = np.random.default_rng(seed)
    train_idx, test_idx = [], []
    for c in np.unique(y):
        idx = np.where(y == c)[0]
        rng.shuffle(idx)
        if len(idx) < 3:
            # keep rare classes fully in train so gradients see them
            train_idx.extend(idx.tolist())
            continue
        n_test = max(1, int(round(len(idx) * test_frac)))
        test_idx.extend(idx[:n_test].tolist())
        train_idx.extend(idx[n_test:].tolist())
    if not test_idx:
        # fallback random split
        n = len(y)
        perm = rng.permutation(n)
        n_test = max(1, int(n * test_frac))
        test_idx = perm[:n_test].tolist()
        train_idx = perm[n_test:].tolist()
    tr = np.asarray(train_idx)
    te = np.asarray(test_idx)
    return X[tr], y[tr], X[te], y[te]


def run(args: argparse.Namespace) -> dict:
    csv_paths = [Path(p) for p in args.csv]
    for p in csv_paths:
        if not p.exists():
            raise FileNotFoundError(p)

    if len(csv_paths) == 1:
        X, y, _ = load_csv(csv_paths[0])
    else:
        X, y = load_many(csv_paths)

    print(f"loaded {len(y)} rows from {[str(p) for p in csv_paths]}")
    print(f"features ({X.shape[1]}): {list(FEATURE_NAMES)}")
    print(f"class counts: {class_counts(y)}")

    X_train, y_train, X_test, y_test = stratified_split(
        X, y, test_frac=args.test_frac, seed=args.seed
    )
    print(
        f"split train={len(y_train)} {class_counts(y_train)}  "
        f"test={len(y_test)} {class_counts(y_test)}"
    )

    model = SoftmaxLogReg(
        n_features=X.shape[1],
        lr=args.lr,
        l2=args.l2,
        epochs=args.epochs,
        batch_size=args.batch_size,
        seed=args.seed,
    )
    model.fit(X_train, y_train)

    train_metrics = model.evaluate(X_train, y_train)
    test_metrics = model.evaluate(X_test, y_test)
    print(f"train accuracy: {train_metrics['accuracy']}")
    print(f"test  accuracy: {test_metrics['accuracy']}")
    print("test per-class:")
    for name, m in test_metrics["per_class"].items():
        print(
            f"  {name:8s}  P={m['precision']:.3f}  R={m['recall']:.3f}  "
            f"F1={m['f1']:.3f}  n={m['support']}"
        )
    print("confusion (rows=true, cols=pred):", test_metrics["confusion_matrix"])

    out = Path(args.out)
    model.save(out)
    report = {
        "csv": [str(p) for p in csv_paths],
        "n_rows": int(len(y)),
        "class_counts": class_counts(y),
        "train": train_metrics,
        "test": test_metrics,
        "model_path": str(out),
        "last_history": (model.history_ or [])[-3:],
    }
    report_path = out.with_suffix(".report.json")
    report_path.write_text(json.dumps(report, indent=2))
    print(f"saved model  → {out}")
    print(f"saved report → {report_path}")

    # Keep device/cloud seeds in sync (slim JSON, no training history)
    slim = {
        "type": "softmax_logistic_regression",
        "version": 1,
        "n_features": model.n_features,
        "n_classes": model.n_classes,
        "feature_names": list(FEATURE_NAMES),
        "class_names": list(CLASS_NAMES),
        "mean": model.mean_.tolist(),
        "std": model.std_.tolist(),
        "W": model.W.tolist(),
        "b": model.b.tolist(),
    }
    for dest in (
        ROOT.parent / "cloud" / "seed" / "softmax_logreg.json",
        ROOT.parent / "data" / "softmax_logreg.json",
    ):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(slim, indent=2))
        print(f"synced seed  → {dest}")
    return report


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Softmax multiclass logistic regression pipeline"
    )
    p.add_argument(
        "--csv",
        nargs="+",
        default=[str(DEFAULT_CSV)],
        help="Labeled CSV path(s)",
    )
    p.add_argument("--out", default=str(DEFAULT_OUT), help="Output model JSON")
    p.add_argument("--epochs", type=int, default=1000)
    p.add_argument("--lr", type=float, default=0.08)
    p.add_argument("--l2", type=float, default=1e-3)
    p.add_argument("--batch-size", type=int, default=16)
    p.add_argument("--test-frac", type=float, default=0.25)
    p.add_argument("--seed", type=int, default=42)
    return p.parse_args()


if __name__ == "__main__":
    run(parse_args())
