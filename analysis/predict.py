"""Run a trained reaction model over feature rows: one output row per input row, with a probability per label."""
import argparse
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from features import LABELS, feature_matrix  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--rows", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    bundle = joblib.load(Path(args.model) / "model.joblib")
    df = pd.read_csv(args.rows)
    proba = bundle["model"].predict_proba(feature_matrix(df)) if len(df) else np.zeros((0, 0))
    classes = list(bundle["model"].classes_)
    out = pd.DataFrame({"i": df["i"], "stage": df["stage"]})
    for label in LABELS:
        out[f"p_{label}"] = proba[:, classes.index(label)] if label in classes else 0.0
    out.to_csv(args.out, index=False)


if __name__ == "__main__":
    main()
