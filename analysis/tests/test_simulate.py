import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).parent))
import reaction  # noqa: E402
import simulate  # noqa: E402
from helpers import ev, frustration_session, write_session  # noqa: E402
from situation import build_rows, load_session  # noqa: E402


def afm_for(skills, game="g9"):
    return {"practice_unit": 10, "coef": {"intercept": 0.0, "kid": skills, "game": {game: 0.0},
                                          "game_slope": {game: 0.0}, "kid_slope": {k: 0.0 for k in skills}}}


def reference():
    events, ms = [ev(0, "progress", "run_start", wave=1)], 500
    for j in range(120):
        events += [ev(ms, "attempt", "slice"), ev(ms + 50, "success" if j % 2 else "fail", "slice_ok" if j % 2 else "wrong_cut")]
        if j % 2 == 0:
            events.append(ev(ms + 50, "fail", "life_lost"))
        ms += 1200
        if j % 30 == 29:
            events.append(ev(ms, "progress", "wave_start", wave=j // 30 + 2))
    return events


def trained(tmp_path):
    dirs, rows = [], []
    for gi, game in enumerate(["g1", "g2"]):
        for ki, (kid, tol) in enumerate({"A": 2, "B": 3, "C": 5}.items()):
            e, m = frustration_session(tol, seed=gi * 10 + ki)
            d = write_session(tmp_path, f"{kid}-{game}", kid, game, e, m)
            dirs.append(str(d))
            rows += build_rows(load_session(d))
    (tmp_path / "kids.json").write_text("{}")
    _, models = reaction.run(pd.DataFrame(rows), dirs, str(tmp_path / "kids.json"))
    return models


def test_pairs_and_consequence_fails():
    e = reference()[:8]
    pr = simulate.pairs(e)
    assert pr[1] == (2, [3])          # wrong_cut, with life_lost logged at the same instant
    assert pr[4] == (5, [])


def test_high_skill_kid_gets_fewer_frustrated_moments(tmp_path):
    models = trained(tmp_path)
    ref = reference()
    afm = afm_for({"A": 2.5, "B": -2.5})
    f = reaction.LABELS.index("frustrated")
    hi, info_hi = simulate.simulate(ref, "g9", "A", afm, models["kid"], n=60)
    lo, info_lo = simulate.simulate(ref, "g9", "B", afm, models["kid"], n=60)
    assert info_hi["success_rate"] > 0.85 and info_lo["success_rate"] < 0.15
    assert hi[:, f].sum() < lo[:, f].sum()
    assert np.allclose(hi.sum(1), 1)
    # same kid, same model: a low simulated skill still means more frustration
    lo_a, _ = simulate.simulate(ref, "g9", "A", afm_for({"A": -2.5}), models["kid"], n=60)
    assert hi[:, f].sum() < lo_a[:, f].sum()


def test_cli_writes_probabilities_per_variant(tmp_path):
    models = trained(tmp_path)
    import joblib
    mdir = tmp_path / "models"
    mdir.mkdir()
    joblib.dump(models, mdir / "models.joblib")
    (tmp_path / "afm.json").write_text(json.dumps(afm_for({"A": 0.5})))
    tgt = write_session(tmp_path, "ref-g9", "ref", "g9", reference(), round_="reference")
    out = tmp_path / "sim"
    r = subprocess.run([sys.executable, str(ROOT / "simulate.py"), "--models", str(mdir), "--afm", str(tmp_path / "afm.json"),
                        "--kid", "a", "--target", str(tgt), "--out", str(out), "--n", "20"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    for v in ("traits", "kid"):
        p = pd.read_csv(out / f"probs-{v}.csv")
        assert len(p) == len(reference()) and {"i", "stage", "type", "p_frustrated", "p_none"} <= set(p.columns)
    s = json.loads((out / "simulation.json").read_text())
    assert s["kid"] == "A" and s["n"] == 20
