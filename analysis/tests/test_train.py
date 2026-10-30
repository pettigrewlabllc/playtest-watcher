import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
from features import NUMERIC  # noqa: E402

KINDS = ["attempt", "success", "fail", "explore", "help"]


def planted(n_sessions=3, n=400, seed=0):
    """frustrated when fail_streak >= 4, else none; the other columns are noise."""
    rng = np.random.default_rng(seed)
    frames = []
    for s in range(n_sessions):
        d = {c: rng.random(n) * 10 for c in NUMERIC}
        d["fail_streak"] = rng.integers(0, 8, n)
        d["new_thing_10s"] = rng.integers(0, 2, n)
        d["kind"] = rng.choice(KINDS, n)
        d["session"] = f"s{s}"
        d["game"] = f"g{s}"
        d["i"] = np.arange(n)
        d["stage"] = "1"
        d["type"] = "t"
        d["label"] = np.where(d["fail_streak"] >= 4, "frustrated", "none")
        frames.append(pd.DataFrame(d))
    return pd.concat(frames, ignore_index=True)


def run(script, *args):
    return subprocess.run([sys.executable, str(ROOT / script), *args], capture_output=True, text=True)


def test_planted_rule_is_recovered(tmp_path):
    df = planted()
    df.to_csv(tmp_path / "rows.csv", index=False)
    r = run("train.py", "--rows", str(tmp_path / "rows.csv"), "--out", str(tmp_path / "m"))
    assert r.returncode == 0, r.stderr
    cv = json.loads((tmp_path / "m" / "cv.json").read_text())
    assert len(cv["folds"]) == 3
    assert {f["held_out_session"] for f in cv["folds"]} == {"s0", "s1", "s2"}
    assert cv["mean_macro_f1"] > 0.8
    assert cv["chosen"] in ("hgb", "logreg")
    assert cv["logreg_mean_macro_f1"] is not None and cv["hgb_mean_macro_f1"] is not None
    imp = json.loads((tmp_path / "m" / "importances.json").read_text())
    assert imp[0]["feature"] == "fail_streak"
    assert len(imp) <= 10
    assert (tmp_path / "m" / "model.joblib").exists()


def test_predict_rows_match_input(tmp_path):
    df = planted()
    df.to_csv(tmp_path / "rows.csv", index=False)
    assert run("train.py", "--rows", str(tmp_path / "rows.csv"), "--out", str(tmp_path / "m")).returncode == 0
    target = df[df.session == "s0"].head(50)
    target.to_csv(tmp_path / "t.csv", index=False)
    r = run("predict.py", "--model", str(tmp_path / "m"), "--rows", str(tmp_path / "t.csv"), "--out", str(tmp_path / "p.csv"))
    assert r.returncode == 0, r.stderr
    out = pd.read_csv(tmp_path / "p.csv")
    assert len(out) == 50
    assert out["i"].tolist() == target["i"].tolist()
    assert list(out.columns) == ["i", "stage", "p_confused", "p_stuck", "p_bored", "p_frustrated", "p_focused", "p_engaged", "p_delighted", "p_none"]
    assert np.allclose(out.filter(like="p_").sum(axis=1), 1.0)
    hi = out[target["fail_streak"].to_numpy() >= 4]
    assert (hi["p_frustrated"] > 0.5).mean() > 0.8


def test_single_class_exits_with_clear_error(tmp_path):
    df = planted()
    df["label"] = "none"
    df.to_csv(tmp_path / "rows.csv", index=False)
    r = run("train.py", "--rows", str(tmp_path / "rows.csv"), "--out", str(tmp_path / "m"))
    assert r.returncode != 0
    assert "only one label" in r.stderr


def test_single_session_trains_without_cv(tmp_path):
    df = planted(n_sessions=1)
    df.to_csv(tmp_path / "rows.csv", index=False)
    r = run("train.py", "--rows", str(tmp_path / "rows.csv"), "--out", str(tmp_path / "m"))
    assert r.returncode == 0, r.stderr
    cv = json.loads((tmp_path / "m" / "cv.json").read_text())
    assert cv["folds"] == [] and cv["mean_macro_f1"] is None and cv["chosen"] == "logreg"
