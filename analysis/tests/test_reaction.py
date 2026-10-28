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


def test_unseen_kid_transfer_takes_traits_from_sessions_it_never_trains_on(tmp_path):
    dirs, rows = world(tmp_path)
    others = rows[rows["kid"] != "A"]
    report, final = reaction.run(others, [d for d in dirs if "/A-" not in d], str(tmp_path / "kids.json"), logo=False,
                                 trait_dirs=dirs)
    assert "A" not in report["kids"]                                  # no row of A in the fit
    assert "A" in report["trait_values"]                              # but A's traits are known
    assert report["trait_values"]["A"]["frustration_tolerance"] < 0
    assert set(final["traits"].table) >= {"A", "B", "C", "D"}


def _rows(spec):
    """spec: (session, label, moment id or '', count) runs of rows."""
    out = []
    for s, l, m, n in spec:
        out += [{"session": s, "label": l, "moment": m} for _ in range(n)]
    return pd.DataFrame(out)


def test_rows_are_weighted_by_their_moment():
    df = _rows([("s1", "none", "", 3), ("s1", "frustrated", "c001", 4), ("s1", "none", "", 1), ("s1", "frustrated", "c002", 1),
                ("s2", "stuck", "", 2), ("s2", "none", "", 1), ("s2", "stuck", "", 3)])
    w = reaction.row_weights(df)
    assert list(w[:3]) == [1, 1, 1]                       # each none row stands alone
    assert list(w[3:7]) == [0.25] * 4 and w[8] == 1       # a 4-row moment counts once, like a 1-row one
    assert list(w[9:11]) == [0.5, 0.5] and list(w[12:15]) == [1 / 3] * 3   # weak labels: a run is one unit
    units = reaction.moment_units(df)
    assert len(set(units[df["label"] == "frustrated"])) == 2 and len(set(units[df["label"] == "stuck"])) == 2


def test_min_class_counts_distinct_moments_not_rows(tmp_path):
    dirs, rows = world(tmp_path)
    rows = rows.copy()
    sid = rows["session"].iloc[0]
    idx = rows.index[(rows["session"] == sid) & (rows["label"] == "none")][:40]
    rows.loc[idx, "label"], rows.loc[idx, "moment"] = "bored", "one-long-moment"   # 40 rows, one moment
    m = reaction.Model("kid", sorted(rows["kid"].unique()), {}).fit(rows)
    assert "bored" not in m.classes and "frustrated" in m.classes
    assert reaction.MIN_CLASS == 5
