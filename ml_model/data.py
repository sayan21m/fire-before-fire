"""Load Fire Before Fire labeled CSVs into feature matrices."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Iterable

import numpy as np

# Match ESP / cloud GNB feature set (power excluded from the classifier)
FEATURE_KEYS = (
    "current",
    "temp",
    "ma3I",
    "ma3T",
    "currentSlope",
    "tempSlope",
    "varI",
    "tempAcc",
)
FEATURE_NAMES = (
    "|I|",
    "T",
    "|MA3I|",
    "MA3T",
    "|dI/dt|",
    "|dT/dt|",
    "varI",
    "|d2T|",
)
ABS_KEYS = frozenset(
    {"current", "ma3I", "currentSlope", "tempSlope", "tempAcc"}
)
CLASS_NAMES = ("ok", "warn", "critical")
N_CLASSES = 3


def _to_float(v: str | float | int | None) -> float:
    try:
        return float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0


def _target(row: dict) -> int:
    raw = row.get("target", "")
    try:
        t = int(float(raw))
        return max(0, min(N_CLASSES - 1, t))
    except (TypeError, ValueError):
        label = str(row.get("targetLabel", "")).strip().lower()
        return {"ok": 0, "warn": 1, "warning": 1, "critical": 2, "crit": 2}.get(
            label, 0
        )


def row_to_features(row: dict) -> np.ndarray:
    vals = []
    for key in FEATURE_KEYS:
        x = _to_float(row.get(key))
        if key in ABS_KEYS:
            x = abs(x)
        vals.append(x)
    return np.asarray(vals, dtype=np.float64)


def load_csv(path: str | Path) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    path = Path(path)
    with path.open(newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise ValueError(f"no rows in {path}")
    X = np.vstack([row_to_features(r) for r in rows])
    y = np.asarray([_target(r) for r in rows], dtype=np.int64)
    return X, y, rows


def load_many(paths: Iterable[str | Path]) -> tuple[np.ndarray, np.ndarray]:
    Xs, ys = [], []
    for p in paths:
        X, y, _ = load_csv(p)
        Xs.append(X)
        ys.append(y)
    return np.vstack(Xs), np.concatenate(ys)


def class_counts(y: np.ndarray) -> dict[str, int]:
    return {CLASS_NAMES[c]: int(np.sum(y == c)) for c in range(N_CLASSES)}
