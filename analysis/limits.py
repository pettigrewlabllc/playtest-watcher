"""Behaviour limits per kid per game (persona engine spec §0, §4), from the game's own event log.

Every limit is per game: games differ far more than kids do (a kid's first tap is 1.5 s in Current Cut and
6.6 s in Hoard Keeper), so pooling across games measures the games. Reading counts only text the kid closed
themselves: Factor Slicer's fact cards close on a 1.1 s timer, Current Cut's `why:` texts close themselves and
its `line:` text stays open all level, Hoard Keeper's `audit` question stays open while the kid builds the answer.

A limit for a game the kid hasn't played is a ratio to a reference run (Joel, kid J) on the games they have
played, applied to the reference run of the target game: `transfer()`.

    python analysis/limits.py --root recordings   -> recordings/group/limits.json
"""
import argparse
import json
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

GAP_MIN_S, GAP_MAX_S = 0.1, 30.0
READ_CPS = 15  # characters a second that count as reading

# Texts the kid closes by choice, per game (id prefix before ':' or '-').
KID_CLOSED = {
    "factor-slicer": {"lessons"},
    "bond-swap": {"intro", "entry", "lesson"},
    "hoard-keeper": {"coach", "intro", "shelf", "decree"},
    "current-cut": {"learn", "real"},
}
# The kid's own mistakes: (event type, kind) per game. Board states ("stuck") and life counters are not mistakes.
ERRORS = {
    "factor-slicer": {("wrong_cut", "fail")},
    "bond-swap": {("swap", "fail")},
    "hoard-keeper": {("file_item", "fail"), ("clean", "fail")},
    "current-cut": {("short_circuit", "fail")},
}

METRICS = ["first_tap_s", "action_gap_s", "read_ms_per_char", "read_share", "error_rate", "idle_per_min"]


def _prefix(text_id):
    return str(text_id).split(":")[0].split("-")[0]


def session_limits(events, game, duration_ms):
    """Raw limits for one session. Missing data -> None."""
    ev = [e for e in events if e.get("ms", 0) >= 0]
    out = {m: None for m in METRICS}

    taps = []
    shown = [e for e in ev if e["type"] == "screen"]
    firsts = [e for e in ev if e["type"] == "first_touch"]
    for s in shown:
        # strictly after: under a frozen page clock the tap that opens a screen and the screen's own event share a
        # millisecond, and counting that tap made half the first taps 0.0 s
        nxt = next((f for f in firsts if f["ms"] > s["ms"]), None)
        if nxt and nxt["ms"] - s["ms"] < 60000:
            taps.append((nxt["ms"] - s["ms"]) / 1000)
    if taps:
        out["first_tap_s"] = st.median(taps)

    att = [e for e in ev if e["kind"] == "attempt"]
    gaps = [(b["ms"] - a["ms"]) / 1000 for a, b in zip(att, att[1:])]
    gaps = [g for g in gaps if GAP_MIN_S <= g <= GAP_MAX_S]
    if gaps:
        out["action_gap_s"] = st.median(gaps)

    opened, per_char, read = {}, [], []
    for e in ev:
        d = e.get("data") or {}
        if e["type"] == "text_shown" and _prefix(d.get("id")) in KID_CLOSED.get(game, set()):
            opened[d.get("id")] = (e["ms"], d.get("chars") or 0)
        elif e["type"] == "text_closed" and d.get("id") in opened:
            t0, chars = opened.pop(d.get("id"))
            if chars >= 20:
                ms = e["ms"] - t0
                per_char.append(ms / chars)
                read.append(1 if ms >= chars * 1000 / READ_CPS else 0)
    if per_char:
        out["read_ms_per_char"] = st.median(per_char)
        out["read_share"] = sum(read) / len(read)

    errs = sum(1 for e in ev if (e["type"], e["kind"]) in ERRORS.get(game, set()))
    if att:
        out["error_rate"] = errs / len(att)

    mins = duration_ms / 60000
    if mins > 0:
        out["idle_per_min"] = sum(1 for e in ev if e["type"] == "idle") / mins
    return out


def _mean(vals):
    vals = [v for v in vals if v is not None]
    return sum(vals) / len(vals) if vals else None


def compute(root):
    """{kid: {game: {metric: value}}} averaged over a kid's sessions of a game; kid J is the reference."""
    root = Path(root)
    acc = {}
    for d in sorted(root.iterdir()):
        try:
            s = json.loads((d / "session.json").read_text())
            a = json.loads((d / "aligned.json").read_text())
        except (OSError, ValueError):
            continue
        kid, game, rnd = str(s.get("kid", "")).upper(), s.get("game"), s.get("round")
        if game not in KID_CLOSED or rnd not in ("learn", "check", "reference"):
            continue
        acc.setdefault(kid, {}).setdefault(game, []).append(session_limits(a["events"], game, a.get("durationMs", 0)))
    return {k: {g: {m: _mean([x[m] for x in xs]) for m in METRICS} for g, xs in games.items()} for k, games in acc.items()}


def transfer(per_game, kid, target, ref="J"):
    """Limits for `kid` on `target` built only from the kid's other games: the median ratio kid/reference over
    those games, times the reference's value on the target. Shares are capped at 1. Also returns the ratios'
    spread, so the persona shows how far to trust it."""
    out = {}
    refs = per_game.get(ref, {})
    for m in METRICS:
        ratios = []
        for g, v in per_game.get(kid, {}).items():
            if g == target:
                continue
            r = refs.get(g, {}).get(m)
            if v.get(m) is not None and r:
                ratios.append(v[m] / r)
        base = refs.get(target, {}).get(m)
        if not ratios or base is None:
            out[m] = {"value": None, "ratio": None, "lo": None, "hi": None, "from": []}
            continue
        r = st.median(ratios)
        val = base * r
        if m in ("read_share", "error_rate"):
            val = min(1.0, val)
        out[m] = {"value": val, "ratio": r, "lo": min(ratios), "hi": max(ratios),
                  "from": sorted(g for g in per_game[kid] if g != target and per_game[kid][g].get(m) is not None)}
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="recordings")
    a = ap.parse_args(argv)
    per_game = compute(a.root)
    games = sorted({g for k in per_game.values() for g in k})
    held_out = {k: {g: transfer(per_game, k, g) for g in games} for k in per_game if k != "J"}
    out = Path(a.root) / "group" / "limits.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"per_game": per_game, "held_out": held_out, "metrics": METRICS}, indent=2))
    for k in sorted(per_game):
        for g in sorted(per_game[k]):
            v = per_game[k][g]
            print(k, g.ljust(14), " ".join(f"{m}={v[m]:.2f}" if v[m] is not None else f"{m}=-" for m in METRICS))
    print(f"written to {out}")


if __name__ == "__main__":
    main()
