"""How far to trust a persona, from data already on disk (no model calls). Two checks:

1. Harness fidelity: does a persona run play at the numbers it was given? For each committed agent run, the limits
   the harness was told to hold (persona.json compiled.harness) against the same limits measured from the run's own
   game events by limits.py. Close on a limit means the harness enforces it; far means something else (Muse's own
   play, the game's design) is driving that number.
2. Input identification: before any play, is a kid's held-out persona (built from their other games) closer to
   that same kid's real numbers on the target game than to the other kids'? Chance is 1 in 4 per check. This is
   the ceiling for any "the persona plays like its own kid" claim: a run can't pick out its kid better than its
   inputs do.

    python analysis/validate.py --root results/runs --limits results/group/limits.json --out results/group/validation.json
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from compare_runs import _events  # noqa: E402
from limits import session_limits  # noqa: E402

# harness setting -> the limit limits.py measures for it
PAIRS = {"firstTapS": "first_tap_s", "actionGapS": "action_gap_s", "readShare": "read_share", "errorRate": "error_rate"}
KIDS = ["A", "B", "C", "D"]
CHECKED = ["first_tap_s", "action_gap_s", "read_share", "error_rate", "idle_per_min"]


def fidelity(root, only=None):
    rows = []
    for d in sorted(Path(root).iterdir()):
        if only and d.name not in only:
            continue
        p, s = d / "persona.json", d / "session.json"
        if not (p.exists() and s.exists() and (d / "events.jsonl").exists()):
            continue
        game = json.loads(s.read_text()).get("game")
        given = json.loads(p.read_text()).get("compiled", {}).get("harness")
        if not given:
            continue   # action-mode runs carry reflexes, not these settings
        evs, dur = _events(d)
        got = session_limits(evs, game, dur)
        first = (d / "steps.jsonl").read_text().split("\n", 1)[0] if (d / "steps.jsonl").exists() else ""
        # Runs from the fixed harness log each step's gap (gap_ms); earlier runs added the harness's own pauses on top.
        row = {"run": d.name, "game": game, "harness": "fixed" if '"gap_ms"' in first else "before-fix"}
        for h, m in PAIRS.items():
            g, v = given.get(h), got.get(m)
            row[m] = {"given": g, "measured": v, "ratio": round(v / g, 2) if g and v is not None else None}
        rows.append(row)
    summary = {}
    for group in ("fixed", "before-fix"):
        summary[group] = {}
        for m in PAIRS.values():
            rs = [r[m]["ratio"] for r in rows if r["harness"] == group and r[m]["ratio"] is not None]
            summary[group][m] = {"runs": len(rs), "within_x1.5": sum(1 for x in rs if 0.67 <= x <= 1.5), "ratios": rs}
    return rows, summary


def identification(limits):
    per, held = limits["per_game"], limits["held_out"]
    games = sorted({g for k in KIDS for g in held.get(k, {})})
    out, hits, total = {}, 0, 0
    for g in games:
        gh = gt = 0
        for k in KIDS:
            for m in CHECKED:
                pred = (held.get(k, {}).get(g, {}).get(m) or {}).get("value")
                real = {j: per.get(j, {}).get(g, {}).get(m) for j in KIDS}
                if pred is None or any(v is None for v in real.values()):
                    continue
                nearest = min(KIDS, key=lambda j: abs(real[j] - pred))
                gt += 1
                gh += nearest == k
        out[g] = {"hits": gh, "checks": gt}
        hits, total = hits + gh, total + gt
    return {"per_game": out, "hits": hits, "checks": total, "chance": round(total / len(KIDS), 1)}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="results/runs")
    ap.add_argument("--limits", default="results/group/limits.json")
    ap.add_argument("--out", default="results/group/validation.json")
    ap.add_argument("--runs", nargs="*", help="only these run folders (default: every run under --root)")
    a = ap.parse_args(argv)
    rows, summary = fidelity(a.root, set(a.runs) if a.runs else None)
    ident = identification(json.loads(Path(a.limits).read_text()))
    res = {"harness_fidelity": {"summary": summary, "runs": rows,
                                "note": "within_x1.5: measured within a factor of 1.5 of what the harness was told to hold"},
           "input_identification": ident}
    Path(a.out).write_text(json.dumps(res, indent=2))
    print(json.dumps({"fidelity": {g: {m: f'{v["within_x1.5"]} of {v["runs"]}' for m, v in ms.items()} for g, ms in summary.items()},
                      "identification": f'{ident["hits"]} of {ident["checks"]} (chance {ident["chance"]})', "per_game": ident["per_game"]}, indent=1))


if __name__ == "__main__":
    main()
