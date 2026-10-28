import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).parent))
import traits  # noqa: E402
from helpers import ev, frustration_session, moment, runs, write_kid, write_session  # noqa: E402


def compute(root, dirs, afm=None):
    (Path(root) / "kids.json").write_text(json.dumps({"A": {"age": 9}, "B": {"age": 12}, "C": {"age": 10}}))
    return traits.compute([str(d) for d in dirs], str(Path(root) / "kids.json"), afm, boot=60)


def tr(res, kid, name, game=None):
    t = res["kids"][kid]["traits"][name]
    return t["per_game"][game] if game else t


def test_recovery_pace_and_persistence(tmp_path):
    ev_a, _ = runs(6, 10, gap_ms=2000, fail_every=3, restart_ms=8000)
    a = write_session(tmp_path, "sa", "A", "g", ev_a)
    res = compute(tmp_path, [a])
    rec = tr(res, "A", "recovery", "g")
    # fails mid-run are followed by the next attempt 1.9 s later; run-ending fails by 8.4 s; mid-run fails dominate
    assert rec["value"] == 1.9
    assert rec["adjusted"] is False and rec["games"] == ["g"]
    pace = tr(res, "A", "pace", "g")
    minutes = ev_a[-1]["ms"] / 60000
    assert abs(pace["value"] - 66 / minutes) < 1e-6
    per = tr(res, "A", "persistence", "g")
    assert per["value"] == 1.0 and per["n"] == 5     # five failed runs followed by another run within 20 s
    assert per["lo"] is not None


def test_persistence_counts_slow_restarts(tmp_path):
    e, _ = runs(5, 4, restart_ms=30000)
    a = write_session(tmp_path, "sa", "A", "g", e)
    assert tr(compute(tmp_path, [a]), "A", "persistence", "g")["value"] == 0.0


def test_exploration_discounts_accidental_events(tmp_path):
    e, ms = runs(4, 10)
    e = e + [ev(ms + 1000, "explore", "compendium_open"), ev(ms + 2000, "explore", "menu_look")]
    a = write_session(tmp_path, "sa", "A", "g", e)
    write_kid(tmp_path, "A", debriefs=[{"game": "g", "session": "sa", "answers": [
        {"q": "You opened the Compendium once.", "a": "I hit that accidentally", "intent": "accidental"}]}])
    res = compute(tmp_path, [a])
    ex = tr(res, "A", "exploration_drive", "g")
    assert abs(ex["value"] - 1 / ((ms + 2000) / 60000)) < 1e-6
    assert ex["accidental_discounted"] == 1
    assert res["kids"]["A"]["intents"] == [{"session": "sa", "type": "compendium_open", "intent": "accidental"}]


def test_reading(tmp_path):
    e = [ev(0, "progress", "run_start"),
         ev(1000, "text_shown", id="t1", chars=150), ev(12000, "text_closed", id="t1"),   # 11 s >= 10 s: read
         ev(13000, "text_shown", id="t2", chars=150), ev(14000, "text_closed", id="t2"),  # 1 s: skipped
         ev(15000, "text_shown", id="t3", chars=30), ev(18000, "text_closed", id="t3"),   # 3 s >= 2 s: read
         ev(20000, "progress", "run_start"), ev(21000, "attempt")]
    a = write_session(tmp_path, "sa", "A", "g", e)
    r = tr(compute(tmp_path, [a]), "A", "reading", "g")
    assert abs(r["value"] - 2 / 3) < 1e-9 and r["n"] == 3


def test_frustration_tolerance_k50(tmp_path):
    lo_e, lo_m = frustration_session(2, 0)
    hi_e, hi_m = frustration_session(5, 1)
    a = write_session(tmp_path, "sa", "A", "g", lo_e, lo_m)
    b = write_session(tmp_path, "sb", "B", "g", hi_e, hi_m)
    res = compute(tmp_path, [a, b])
    fa, fb = tr(res, "A", "frustration_tolerance", "g"), tr(res, "B", "frustration_tolerance", "g")
    assert fa["value"] < fb["value"]
    assert fa["adjusted"] and fb["adjusted"]
    assert fa["raw"] < fa["value"] < fa["group_mean"]    # shrunk toward the group on that game
    assert 1 <= fa["raw"] <= 3 and 4 <= fb["raw"] <= 6
    assert tr(res, "A", "frustration_tolerance")["value"] < 0 < tr(res, "B", "frustration_tolerance")["value"]


def test_moment_traits(tmp_path):
    e, mo, ms = [], [], 0
    e.append(ev(0, "progress", "run_start"))
    for j in range(12):  # a long success streak, bored from the 6th success on
        ms += 1000
        e += [ev(ms, "attempt"), ev(ms + 100, "success")]
    mo.append(moment("b1", 6500, 12500, "bored", face="yawn"))
    e.append(ev(20000, "progress", "run_start"))
    mo.append(moment("c1", 21000, 22000, "confused", face="frown", voice="huh"))
    mo.append(moment("c2", 61000, 62000, "confused", face="frown", voice="", hands="taps"))
    mo.append(moment("f1", 66000, 68000, "frustrated", voice="argh"))   # 4 s after c2 ends: c2 did not resolve
    e += [ev(30000, "attempt"), ev(30100, "success"), ev(55000, "attempt"), ev(55100, "success")]
    e.append(ev(60000, "progress", "run_start"))
    e.append(ev(119000, "attempt"))
    a = write_session(tmp_path, "sa", "A", "g", e, mo)
    res = compute(tmp_path, [a])
    assert tr(res, "A", "challenge_appetite", "g")["value"] > 0.5
    assert tr(res, "A", "confusion_resolves", "g")["value"] == 0.5
    ex = tr(res, "A", "expressiveness", "g")
    assert abs(ex["value"] - np.mean([1 / 3, 2 / 3, 2 / 3, 1 / 3])) < 1e-9
    assert ex["face"] == 0.75


def test_stamina_slope(tmp_path):
    e, mo = [], []
    for b in range(10):
        e.append(ev(b * 60000, "progress", "run_start"))
        e.append(ev(b * 60000 + 1000, "attempt"))
        for j in range(b):
            mo.append(moment(f"m{b}-{j}", b * 60000 + 2000 + j * 5000, b * 60000 + 3000 + j * 5000, "frustrated"))
    a = write_session(tmp_path, "sa", "A", "g", e, mo, duration=600000)
    st = tr(compute(tmp_path, [a]), "A", "stamina", "g")
    assert abs(st["value"] - 1.0) < 1e-6      # one more negative moment per minute, every minute
    assert "attempts_slope" in st


def test_events_only_session_gives_nulls_never_errors(tmp_path):
    e, _ = runs(5, 8, fail_every=2)
    a = write_session(tmp_path, "sa", "A", "g", e)
    res = compute(tmp_path, [a])
    for name in ("frustration_tolerance", "challenge_appetite", "expressiveness", "confusion_resolves"):
        t = tr(res, "A", name, "g")
        assert t["value"] is None and t["lo"] is None and t["hi"] is None
    assert tr(res, "A", "stamina", "g")["value"] is None
    assert tr(res, "A", "recovery", "g")["value"] is not None
    out = tmp_path / "traits.json"
    (tmp_path / "kids.json").write_text("{}")
    r = subprocess.run([sys.executable, str(ROOT / "traits.py"), "--sessions", str(a), "--kids", str(tmp_path / "kids.json"),
                        "--out", str(out), "--boot", "20"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert "NaN" not in out.read_text()
    t = json.loads(out.read_text())
    assert t["k"] == 5 and t["level"] == 0.9


def test_shrinkage_and_adjustment(tmp_path):
    ea, _ = runs(5, 10, gap_ms=1000)
    eb, _ = runs(5, 10, gap_ms=3000)
    ec, _ = runs(5, 10, gap_ms=2000)
    a = write_session(tmp_path, "sa", "A", "g", ea)
    b = write_session(tmp_path, "sb", "B", "g", eb)
    c = write_session(tmp_path, "sc", "C", "h", ec)
    res = compute(tmp_path, [a, b, c])
    pa, pb = tr(res, "A", "pace", "g"), tr(res, "B", "pace", "g")
    assert pa["adjusted"] and pb["adjusted"]
    w = pa["n"] / (pa["n"] + 5)
    assert abs(pa["value"] - (w * pa["raw"] + (1 - w) * pa["group_mean"])) < 1e-9
    assert pa["lo"] <= pa["value"] <= pa["hi"]
    assert tr(res, "A", "pace")["value"] > 0 > tr(res, "B", "pace")["value"]
    pc = tr(res, "C", "pace", "h")
    assert pc["adjusted"] is False and pc["value"] == pc["raw"]
    top = tr(res, "C", "pace")
    assert top["value"] is None and top["adjusted"] is False


def test_said_and_gaps(tmp_path):
    ea, _ = runs(6, 10, explore_every=10)      # A explores rarely
    eb, _ = runs(6, 10, explore_every=2)       # B explores a lot
    a = write_session(tmp_path, "sa", "A", "g", ea)
    b = write_session(tmp_path, "sb", "B", "g", eb)
    write_kid(tmp_path, "A", questionnaire={"kid": "a", "answers": {}, "scores": {"explore": -1, "read": None, "persist": 0}},
              debriefs=[{"game": "g", "session": "sa", "answers": [{"q": "From 1 to 5, how fun was that?", "a": "4", "fun": 4}]}])
    res = compute(tmp_path, [a, b])
    kid = res["kids"]["A"]
    assert kid["said"]["explore"] == -1 and kid["said"]["fun"] == {"g": 4}
    gap = [g for g in kid["gaps"] if g["axis"] == "explore"]
    assert gap and gap[0]["trait"] == "exploration_drive"
    assert res["kids"]["B"]["gaps"] == []


def test_afm_traits_come_from_afm_json(tmp_path):
    e, _ = runs(3, 5)
    a = write_session(tmp_path, "sa", "A", "g", e)
    afm = {"kids": {"A": {"skill": {"value": 0.4, "lo": 0.1, "hi": 0.7, "n": 18, "games": ["g"], "adjusted": True, "source": "afm"},
                          "learning_rate": {"value": None, "lo": None, "hi": None, "n": 18, "games": ["g"], "adjusted": False, "source": "afm"},
                          "games": {"g": {"skill": {"value": 1.2, "lo": 0.8, "hi": 1.6, "n": 18, "games": ["g"], "adjusted": True, "source": "afm"},
                                          "learning_rate": {"value": 0.1, "lo": -0.1, "hi": 0.3, "n": 18, "games": ["g"], "adjusted": True, "source": "afm"}}}}}}
    p = tmp_path / "afm.json"
    p.write_text(json.dumps(afm))
    res = compute(tmp_path, [a], str(p))
    assert tr(res, "A", "skill", "g")["value"] == 1.2
    assert tr(res, "A", "skill")["value"] == 0.4
    assert tr(res, "A", "learning_rate", "g")["hi"] == 0.3


def test_zero_counts_still_get_an_interval(tmp_path):
    e, _ = runs(6, 10)          # no explore events at all, every block agrees
    a = write_session(tmp_path, "sa", "A", "g", e)
    ex = tr(compute(tmp_path, [a]), "A", "exploration_drive", "g")
    assert ex["value"] == 0 and ex["lo"] == 0 and ex["hi"] > 0
