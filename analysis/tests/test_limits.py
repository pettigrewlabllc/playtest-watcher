from limits import session_limits, transfer


def ev(ms, type_, kind, **data):
    return {"ms": ms, "type": type_, "kind": kind, "data": data}


def test_reading_counts_only_text_the_kid_closed():
    events = [
        ev(0, "text_shown", "text_shown", id="fact-1", chars=40), ev(1100, "text_closed", "text_closed", id="fact-1"),  # auto-closed card
        ev(2000, "text_shown", "text_shown", id="lessons", chars=60), ev(8000, "text_closed", "text_closed", id="lessons"),  # read: 6 s > 4 s
        ev(9000, "text_shown", "text_shown", id="lessons-2", chars=60), ev(9600, "text_closed", "text_closed", id="lessons-2"),  # skipped
    ]
    lim = session_limits(events, "factor-slicer", 60000)
    assert lim["read_share"] == 0.5
    assert abs(lim["read_ms_per_char"] - (100 + 10) / 2) < 1e-9


def test_timing_errors_and_idles():
    events = [ev(0, "screen", "progress"), ev(2000, "first_touch", "first_touch"),
              ev(2000, "slice", "attempt"), ev(3000, "slice", "attempt"), ev(3000, "wrong_cut", "fail"),
              ev(5000, "slice", "attempt"), ev(5000, "life_lost", "fail"), ev(40000, "idle", "idle")]
    lim = session_limits(events, "factor-slicer", 60000)
    assert lim["first_tap_s"] == 2.0
    assert lim["action_gap_s"] == 1.5
    assert abs(lim["error_rate"] - 1 / 3) < 1e-9   # life_lost is a counter, not a mistake
    assert lim["idle_per_min"] == 1.0


def test_transfer_uses_only_other_games_and_caps_shares():
    per_game = {
        "J": {"g1": {"first_tap_s": 2.0, "read_share": 0.5}, "g2": {"first_tap_s": 1.0, "read_share": 0.5}, "t": {"first_tap_s": 4.0, "read_share": 0.8}},
        "A": {"g1": {"first_tap_s": 4.0, "read_share": 1.0}, "g2": {"first_tap_s": 3.0, "read_share": 1.0}, "t": {"first_tap_s": 99.0, "read_share": 0.0}},
    }
    for m in ("action_gap_s", "read_ms_per_char", "error_rate", "idle_per_min"):
        for k in per_game.values():
            for g in k.values():
                g[m] = None
    out = transfer(per_game, "A", "t")
    assert out["first_tap_s"]["value"] == 4.0 * 2.5     # median of ratios 2 and 3, never the target game
    assert out["first_tap_s"]["from"] == ["g1", "g2"]
    assert out["read_share"]["value"] == 1.0             # 0.8 * 2 capped
    assert out["error_rate"]["value"] is None
