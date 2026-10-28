import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent))
from helpers import ev, moment  # noqa: E402
from situation import ROW_COLUMNS, build_rows  # noqa: E402


def session(events, moments=None, kid="C"):
    return {"id": "s1", "kid": kid, "game": "g1", "events": events, "moments": moments}


def test_matches_the_node_row_builder():
    # the same session as tests/predict/rows.test.ts "situation features", with the same expected values
    evs = [ev(0, "progress", "level_start", level=1), ev(1000, "attempt"), ev(1200, "fail"), ev(1200, "fail", "life_lost"),
           ev(1800, "attempt"), ev(2000, "fail"), ev(4000, "attempt"), ev(4500, "success"),
           ev(6000, "progress", "level_start", level=2), ev(7000, "attempt"), ev(9000, "explore")]
    rows = build_rows(session(evs, [moment("m1", 1000, 2500, "frustrated"), moment("m2", 6500, 6800, "delighted", 0.3)]))
    assert sorted(rows[0]) == sorted(ROW_COLUMNS)
    assert rows[1]["prev_label"] == "none" and rows[1]["s_since_moment"] == 1
    assert rows[6]["prev_label"] == "frustrated" and rows[6]["s_since_moment"] == 1.5
    assert rows[9]["prev_label"] == "frustrated"
    assert [rows[i]["rapid_retry"] for i in (4, 6, 1)] == [1, 0, 0]
    assert rows[5]["fail_streak"] == 2
    assert [rows[i]["attempts_no_success"] for i in (1, 6, 7, 9)] == [1, 3, 0, 1]
    assert [rows[i]["block"] for i in (0, 7, 8)] == [1, 1, 2]
    assert rows[0]["stage"] == "1" and rows[8]["stage"] == "2"
    assert rows[2]["label"] == "frustrated" and rows[9]["label"] == "none"


def test_text_and_weak_labels():
    evs = [ev(0, "text_shown", id="t1", chars=120), ev(1000, "text_shown", id="t2", chars=30), ev(2000, "text_closed", id="t1"),
           ev(3000, "fail"), ev(4000, "fail"), ev(5000, "fail"), ev(12000, "idle")]
    rows = build_rows(session(evs))
    assert [r["text_chars_on_screen"] for r in rows[:3]] == [120, 150, 30]
    assert [r["label"] for r in rows] == ["none", "none", "none", "none", "none", "frustrated", "frustrated"]
    assert all(r["weak_labels"] == 1 for r in rows)


def test_rows_only_inside_the_recording_window():
    evs = [ev(-5000, "explore", "menu_look"), ev(0, "attempt"), ev(1000, "fail"), ev(2000, "attempt"),
           ev(3000, "debrief_start"), ev(4000, "attempt"), ev(9000, "idle")]
    s = {"id": "s", "kid": "C", "game": "g", "events": evs, "moments": [], "duration_ms": 8000}
    rows = build_rows(s)
    assert [r["i"] for r in rows] == [1, 2, 3]
    assert rows[0]["explore_so_far"] == 1
