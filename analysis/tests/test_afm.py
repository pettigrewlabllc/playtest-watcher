import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
import afm  # noqa: E402


def attempt_rows(kid, game, session, probs, rng, block_len=10, outcome_type="t_ok"):
    """One attempt then one outcome per opportunity; probs[j] is P(success) at practice j."""
    rows, ms = [], 0
    for j, p in enumerate(probs):
        block = j // block_len + 1
        ok = rng.random() < p
        rows.append(dict(session=session, kid=kid, game=game, i=len(rows), ms=ms, kind="attempt", type="t", block=block))
        rows.append(dict(session=session, kid=kid, game=game, i=len(rows), ms=ms + 300,
                         kind="success" if ok else "fail", type=outcome_type if ok else "t_bad", block=block))
        ms += 1500
    return rows


def planted(seed=0, n=240):
    rng = np.random.default_rng(seed)
    sig = lambda x: 1 / (1 + np.exp(-x))  # noqa: E731
    practice = np.arange(n) / 10
    rows = []
    for g, base in (("g1", -1.0), ("g2", -0.5)):
        rows += attempt_rows("F", g, f"F-{g}", sig(base + 0.35 * practice), rng)
        rows += attempt_rows("S", g, f"S-{g}", sig(base + 0.02 * practice), rng)
    return pd.DataFrame(rows)


def test_pairs_attempts_with_the_next_outcome_within_2s():
    df = pd.DataFrame([
        dict(session="s", kid="A", game="g", i=0, ms=0, kind="attempt", type="slice", block=1),
        dict(session="s", kid="A", game="g", i=1, ms=0, kind="success", type="slice_ok", block=1),
        dict(session="s", kid="A", game="g", i=2, ms=1000, kind="attempt", type="slice", block=1),
        dict(session="s", kid="A", game="g", i=3, ms=1000, kind="fail", type="wrong_cut", block=1),
        dict(session="s", kid="A", game="g", i=4, ms=1000, kind="fail", type="life_lost", block=1),
        dict(session="s", kid="A", game="g", i=5, ms=5000, kind="attempt", type="slice", block=2),
        dict(session="s", kid="A", game="g", i=6, ms=9000, kind="success", type="slice_ok", block=2),
        dict(session="s", kid="A", game="g", i=7, ms=9500, kind="attempt", type="swap", block=2),
        dict(session="s", kid="A", game="g", i=8, ms=9600, kind="success", type="bond", block=2),
        dict(session="s", kid="A", game="g", i=9, ms=9700, kind="fail", type="swap", block=2),
    ])
    att = afm.pair_attempts(df)
    # the 5 s attempt is unresolved; swap pairs with its own type but no swap ever succeeds, so swaps are left out
    assert list(att["y"]) == [1, 0]
    assert list(att["practice"]) == [0, 1]        # unresolved attempts still count as practice


def test_planted_fast_and_slow_learner(tmp_path):
    rows = tmp_path / "rows.csv"
    planted().to_csv(rows, index=False)
    out = tmp_path / "afm.json"
    r = subprocess.run([sys.executable, str(ROOT / "afm.py"), "--rows", str(rows), "--out", str(out), "--boot", "200"],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    res = json.loads(out.read_text())
    for g in ("g1", "g2"):
        fast = res["kids"]["F"]["games"][g]["learning_rate"]
        slow = res["kids"]["S"]["games"][g]["learning_rate"]
        assert fast["value"] > slow["value"]
        assert fast["lo"] > slow["hi"], (fast, slow)
        assert fast["adjusted"] is True and fast["n"] == 240
        assert set(fast) >= {"value", "lo", "hi", "n", "games", "adjusted", "source"}
    assert res["kids"]["F"]["learning_rate"]["lo"] > res["kids"]["S"]["learning_rate"]["hi"]
    assert res["kids"]["F"]["learning_rate"]["adjusted"] is True
    assert abs(res["kids"]["F"]["skill"]["value"] + res["kids"]["S"]["skill"]["value"]) < 1e-9   # centred on the kids sharing the games
    assert res["boot"]["unit"] == "block"
    assert 0 < res["C"]


def test_one_kid_on_a_game_is_not_adjusted_and_never_nan(tmp_path):
    df = planted()
    df = df[~((df["kid"] == "S") & (df["game"] == "g2"))]
    rows = tmp_path / "rows.csv"
    df.to_csv(rows, index=False)
    out = tmp_path / "afm.json"
    r = subprocess.run([sys.executable, str(ROOT / "afm.py"), "--rows", str(rows), "--out", str(out), "--boot", "20"],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    text = out.read_text()
    assert "NaN" not in text
    res = json.loads(text)
    assert res["kids"]["F"]["games"]["g2"]["skill"]["adjusted"] is False
    assert res["kids"]["F"]["games"]["g1"]["skill"]["adjusted"] is True
    df2 = df[df["game"] == "g2"]
    df2.to_csv(rows, index=False)
    subprocess.run([sys.executable, str(ROOT / "afm.py"), "--rows", str(rows), "--out", str(out), "--boot", "20"], check=True)
    alone = json.loads(out.read_text())["kids"]["F"]
    assert alone["skill"]["value"] is None and alone["skill"]["adjusted"] is False
    assert "g2" in res["games"] and "S" not in [k for k in res["kids"] if "g2" in res["kids"][k]["games"]]
