import json
import subprocess
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).parent))
import reaction  # noqa: E402
from helpers import frustration_session, write_session  # noqa: E402
from situation import build_rows, load_session  # noqa: E402

TOLERANCE = {"A": 2, "B": 3, "C": 5, "D": 6}


def world(tmp_path):
    dirs, rows = [], []
    for gi, game in enumerate(["g1", "g2", "g3"]):
        for ki, (kid, tol) in enumerate(TOLERANCE.items()):
            e, m = frustration_session(tol, seed=gi * 10 + ki, spacing=1200 + 200 * gi)
            d = write_session(tmp_path, f"{kid}-{game}", kid, game, e, m)
            dirs.append(str(d))
            rows += build_rows(load_session(d))
    (tmp_path / "kids.json").write_text("{}")
    return dirs, pd.DataFrame(rows)


def test_traits_variant_beats_base_rate_under_logo(tmp_path):
    dirs, rows = world(tmp_path)
    report, final = reaction.run(rows, dirs, str(tmp_path / "kids.json"))
    p = report["pooled"]
    assert p["traits"]["macro_f1"] > p["base_rate"]["macro_f1"] + 0.1, p
    assert p["traits"]["auc"]["frustrated"] > 0.85
    assert p["kid"]["macro_f1"] > p["base_rate"]["macro_f1"]
    for n in ("traits", "kid", "base_rate", "markov"):
        assert set(p[n]) >= {"macro_f1", "auc", "kappa", "mix_tvd"}
    vals = report["trait_values"]
    assert vals["A"]["frustration_tolerance"] < 0 < vals["D"]["frustration_tolerance"]
    assert set(final) == {"traits", "kid"}


def test_held_out_game_never_in_training(tmp_path):
    dirs, rows = world(tmp_path)
    seen = []
    for game, tr, te in reaction.logo_splits(rows):
        assert game not in set(rows.iloc[tr]["game"])
        assert set(rows.iloc[te]["game"]) == {game}
        assert set(rows.iloc[te]["kid"]) == set(TOLERANCE)       # every kid's rows for that game are held out
        seen.append(game)
    assert seen == ["g1", "g2", "g3"]
    report, _ = reaction.run(rows, dirs, str(tmp_path / "kids.json"))
    for f in report["folds"]:
        assert f["held_out_game"] not in f["train_games"]


def test_rare_labels_are_not_modelled_and_cli_writes_outputs(tmp_path):
    dirs, rows = world(tmp_path)
    rows.loc[rows.index[:3], "label"] = "bored"   # 3 rows: below the per-fold minimum
    csv = tmp_path / "rows.csv"
    rows.to_csv(csv, index=False)
    out = tmp_path / "out"
    r = subprocess.run([sys.executable, str(ROOT / "reaction.py"), "--rows", str(csv), "--sessions", *dirs,
                        "--kids", str(tmp_path / "kids.json"), "--out", str(out)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    rep = json.loads((out / "reaction.json").read_text())
    assert rep["pooled"]["traits"]["predicted_mix"]["bored"] == 0
    assert (out / "models.joblib").exists()


def test_the_traits_carry_the_kid_difference(tmp_path, monkeypatch):
    dirs, rows = world(tmp_path)
    full, _ = reaction.run(rows, dirs, str(tmp_path / "kids.json"))
    monkeypatch.setattr(reaction, "trait_table", lambda t: {})   # every kid at the group mean: situation only
    blind, _ = reaction.run(rows, dirs, str(tmp_path / "kids.json"))
    assert full["pooled"]["traits"]["macro_f1"] > blind["pooled"]["traits"]["macro_f1"] + 0.05
