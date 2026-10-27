"""Train one player's reaction model. Leave-one-session-out CV picks boosted trees or logistic regression."""
import argparse
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).parent))
from features import FEATURE_NAMES, LABELS, feature_matrix  # noqa: E402

HGB_MARGIN = 0.02


def make_model(name: str):
    if name == "hgb":
        return HistGradientBoostingClassifier(class_weight="balanced", max_depth=3, random_state=0)
    return make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=2000))


def fit(name: str, X, y):
    """Fit, or return a constant predictor when the training split has a single class."""
    if len(set(y)) < 2:
        return ConstantModel(y[0])
    return make_model(name).fit(X, y)


class ConstantModel:
    def __init__(self, label):
        self.classes_ = np.array([label])

    def predict(self, X):
        return np.repeat(self.classes_[0], len(X))

    def predict_proba(self, X):
        return np.ones((len(X), 1))

    def score(self, X, y):  # permutation_importance asks for a scorer; we pass our own
        return 0.0


def macro_f1(y_true, y_pred):
    labels = sorted(set(y_true) | set(y_pred))
    return float(f1_score(y_true, y_pred, labels=labels, average="macro", zero_division=0))


def per_label_f1(y_true, y_pred):
    labels = sorted(set(y_true))
    scores = f1_score(y_true, y_pred, labels=labels, average=None, zero_division=0)
    return {l: float(s) for l, s in zip(labels, scores)}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    df = pd.read_csv(args.rows)
    if df.empty:
        sys.exit("train.py: the rows file is empty, nothing to train on")
    y = df["label"].astype(str).to_numpy()
    if len(set(y)) < 2:
        sys.exit(f"train.py: only one label ({y[0]!r}) in the training rows; a reaction model needs at least two classes")
    unknown = sorted(set(y) - set(LABELS))
    if unknown:
        sys.exit(f"train.py: unknown labels {unknown}")
    X = feature_matrix(df)
    sessions = df["session"].astype(str).to_numpy()
    names = sorted(set(sessions))

    folds, scores = [], {"hgb": [], "logreg": []}
    importance_sum = np.zeros(X.shape[1])
    fold_models = {}
    for held in names if len(names) > 1 else []:
        test = sessions == held
        fold = {}
        for name in ("hgb", "logreg"):
            m = fit(name, X[~test], y[~test])
            pred = m.predict(X[test])
            fold[name] = (m, macro_f1(y[test], pred), per_label_f1(y[test], pred))
            scores[name].append(fold[name][1])
        fold_models[held] = fold

    mean = {k: (float(np.mean(v)) if v else None) for k, v in scores.items()}
    chosen = "logreg"
    if mean["hgb"] is not None and mean["hgb"] >= mean["logreg"] + HGB_MARGIN:
        chosen = "hgb"

    for held, fold in fold_models.items():
        m, f1, per = fold[chosen]
        folds.append({"held_out_session": held, "macro_f1": f1, "per_label": per})
        test = sessions == held
        if isinstance(m, ConstantModel):
            continue
        r = permutation_importance(m, X[test], y[test], scoring="f1_macro", n_repeats=5, random_state=0)
        importance_sum += r.importances_mean

    final = fit(chosen, X, y)
    if not fold_models:  # a single session: importances on the training data, no CV
        r = permutation_importance(final, X, y, scoring="f1_macro", n_repeats=5, random_state=0)
        importance_sum = r.importances_mean
    else:
        importance_sum = importance_sum / len(fold_models)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": final, "chosen": chosen, "feature_names": FEATURE_NAMES}, out / "model.joblib")
    cv = {"folds": folds, "mean_macro_f1": mean[chosen], "chosen": chosen,
          "logreg_mean_macro_f1": mean["logreg"], "hgb_mean_macro_f1": mean["hgb"]}
    (out / "cv.json").write_text(json.dumps(cv, indent=2))
    top = np.argsort(-importance_sum)[:10]
    (out / "importances.json").write_text(json.dumps(
        [{"feature": FEATURE_NAMES[i], "importance": float(importance_sum[i])} for i in top], indent=2))


if __name__ == "__main__":
    main()
