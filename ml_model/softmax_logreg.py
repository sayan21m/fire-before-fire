"""
Multiclass logistic regression with softmax + cross-entropy.

  logits  z = X @ W + b          (n, C)
  probs   p = softmax(z)         (n, C)
  loss    L = -mean(sum y_onehot * log p) + (λ/2)||W||²
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from data import CLASS_NAMES, FEATURE_NAMES, N_CLASSES


def softmax(logits: np.ndarray) -> np.ndarray:
    """Numerically stable softmax along the last axis."""
    z = logits - np.max(logits, axis=-1, keepdims=True)
    exp = np.exp(z)
    return exp / np.sum(exp, axis=-1, keepdims=True)


def one_hot(y: np.ndarray, n_classes: int = N_CLASSES) -> np.ndarray:
    out = np.zeros((y.shape[0], n_classes), dtype=np.float64)
    out[np.arange(y.shape[0]), y] = 1.0
    return out


@dataclass
class SoftmaxLogReg:
    n_features: int
    n_classes: int = N_CLASSES
    lr: float = 0.05
    l2: float = 1e-3
    epochs: int = 800
    batch_size: int = 32
    seed: int = 42

    W: np.ndarray | None = None  # (F, C)
    b: np.ndarray | None = None  # (C,)
    mean_: np.ndarray | None = None
    std_: np.ndarray | None = None
    history_: list | None = None

    def _init_params(self) -> None:
        rng = np.random.default_rng(self.seed)
        # small random weights
        self.W = rng.normal(0.0, 0.01, size=(self.n_features, self.n_classes))
        self.b = np.zeros(self.n_classes, dtype=np.float64)

    def fit_scaler(self, X: np.ndarray) -> None:
        self.mean_ = X.mean(axis=0)
        self.std_ = X.std(axis=0)
        self.std_[self.std_ < 1e-8] = 1.0

    def transform(self, X: np.ndarray) -> np.ndarray:
        assert self.mean_ is not None and self.std_ is not None
        return (X - self.mean_) / self.std_

    def _class_weights(self, y: np.ndarray) -> np.ndarray:
        """Inverse-frequency weights to counter ok-heavy datasets."""
        counts = np.bincount(y, minlength=self.n_classes).astype(np.float64)
        counts[counts == 0] = 1.0
        w = counts.sum() / (self.n_classes * counts)
        return w

    def fit(self, X: np.ndarray, y: np.ndarray) -> "SoftmaxLogReg":
        self.fit_scaler(X)
        Xs = self.transform(X)
        self._init_params()
        assert self.W is not None and self.b is not None

        n = Xs.shape[0]
        cw = self._class_weights(y)
        sample_w = cw[y]
        Y = one_hot(y, self.n_classes)
        self.history_ = []
        rng = np.random.default_rng(self.seed)

        for epoch in range(self.epochs):
            idx = rng.permutation(n)
            Xs_shuf, Y_shuf, sw_shuf = Xs[idx], Y[idx], sample_w[idx]

            for start in range(0, n, self.batch_size):
                end = min(start + self.batch_size, n)
                xb = Xs_shuf[start:end]
                yb = Y_shuf[start:end]
                wb = sw_shuf[start:end][:, None]
                m = xb.shape[0]

                logits = xb @ self.W + self.b
                probs = softmax(logits)
                # weighted gradient of cross-entropy
                err = (probs - yb) * wb
                dW = (xb.T @ err) / m + self.l2 * self.W
                db = err.mean(axis=0)
                self.W -= self.lr * dW
                self.b -= self.lr * db

            if epoch % 50 == 0 or epoch == self.epochs - 1:
                logits = Xs @ self.W + self.b
                probs = softmax(logits)
                # weighted CE
                eps = 1e-12
                ce = -np.sum(Y * np.log(probs + eps), axis=1)
                loss = float(np.mean(ce * sample_w)) + 0.5 * self.l2 * float(
                    np.sum(self.W**2)
                )
                acc = float(np.mean(np.argmax(probs, axis=1) == y))
                self.history_.append(
                    {"epoch": epoch, "loss": loss, "acc": acc}
                )

        return self

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        assert self.W is not None and self.b is not None
        Xs = self.transform(X)
        return softmax(Xs @ self.W + self.b)

    def predict(self, X: np.ndarray) -> np.ndarray:
        return np.argmax(self.predict_proba(X), axis=1)

    def evaluate(self, X: np.ndarray, y: np.ndarray) -> dict:
        probs = self.predict_proba(X)
        pred = np.argmax(probs, axis=1)
        cm = np.zeros((self.n_classes, self.n_classes), dtype=int)
        for t, p in zip(y, pred):
            cm[int(t), int(p)] += 1
        per_class = {}
        for c in range(self.n_classes):
            tp = cm[c, c]
            support = int(cm[c].sum())
            pred_c = int(cm[:, c].sum())
            precision = tp / pred_c if pred_c else 0.0
            recall = tp / support if support else 0.0
            f1 = (
                2 * precision * recall / (precision + recall)
                if (precision + recall)
                else 0.0
            )
            per_class[CLASS_NAMES[c]] = {
                "precision": round(precision, 4),
                "recall": round(recall, 4),
                "f1": round(f1, 4),
                "support": support,
            }
        return {
            "accuracy": round(float(np.mean(pred == y)), 4),
            "confusion_matrix": cm.tolist(),
            "per_class": per_class,
            "class_names": list(CLASS_NAMES),
        }

    def to_dict(self) -> dict:
        assert self.W is not None and self.b is not None
        assert self.mean_ is not None and self.std_ is not None
        return {
            "type": "softmax_logistic_regression",
            "version": 1,
            "n_features": self.n_features,
            "n_classes": self.n_classes,
            "feature_names": list(FEATURE_NAMES),
            "class_names": list(CLASS_NAMES),
            "lr": self.lr,
            "l2": self.l2,
            "epochs": self.epochs,
            "mean": self.mean_.tolist(),
            "std": self.std_.tolist(),
            "W": self.W.tolist(),
            "b": self.b.tolist(),
            "history": self.history_ or [],
        }

    def save(self, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), indent=2))
        return path

    @classmethod
    def load(cls, path: str | Path) -> "SoftmaxLogReg":
        raw = json.loads(Path(path).read_text())
        model = cls(
            n_features=raw["n_features"],
            n_classes=raw["n_classes"],
            lr=raw.get("lr", 0.05),
            l2=raw.get("l2", 1e-3),
            epochs=raw.get("epochs", 800),
        )
        model.mean_ = np.asarray(raw["mean"], dtype=np.float64)
        model.std_ = np.asarray(raw["std"], dtype=np.float64)
        model.W = np.asarray(raw["W"], dtype=np.float64)
        model.b = np.asarray(raw["b"], dtype=np.float64)
        model.history_ = raw.get("history")
        return model
