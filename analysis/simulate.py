"""Simulated playthroughs: a kid's own version of a reference playthrough.

Keep the reference's sequence of stages and attempts, resample each attempt's success from the kid's AFM skill for
that game, recompute the situation features along the simulated path (fail streaks, wheel-spinning, prev_label from
the model's own sampled reactions), and run a reaction-model variant. Output: per reference event, the mean
probability of each label over the simulations."""
import argparse
import math
import sys
from collections import Counter
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from afm import PAIR_MS  # noqa: E402
from common import dump  # noqa: E402
from situation import LABELS, SAME_FAILURE_MS, Stepper, read_json, stages_of  # noqa: E402

N_SIMS = 200


def pairs(events):
    """attempt index -> its outcome index, plus the consequence fails logged with that outcome (same instant)."""
    out, used = {}, set()
    for j, e in enumerate(events):
        if e["kind"] != "attempt":
            continue
        cands = []
        for k in range(j + 1, len(events)):
            o = events[k]
            if o["kind"] == "attempt" or o["ms"] - e["ms"] > PAIR_MS:
                break
            if o["kind"] in ("success", "fail") and k not in used:
                cands.append(k)
        if not cands:
            continue
        same = [k for k in cands if events[k]["type"] == e["type"]]
        k = (same or cands)[0]
        used.add(k)
        follow = [m for m in range(k + 1, len(events)) if events[m]["kind"] == "fail" and m not in used
                  and events[m]["ms"] - events[k]["ms"] <= SAME_FAILURE_MS]
        used.update(follow)
        out[j] = (k, follow)
    return out


def p_success(afm, kid, game, practice):
    c = (afm or {}).get("coef") or {}
    unit = (afm or {}).get("practice_unit", 10)
    if not c:
        return 0.5
    x = c["intercept"] + c["kid"].get(kid, 0.0) + c["game"].get(game, 0.0)
    x += (c["game_slope"].get(game, 0.0) + c["kid_slope"].get(kid, 0.0)) * practice / unit
    return 1 / (1 + math.exp(-x))


def outcome_types(events, pr):
    """The reference's most common success and fail types per attempt type, for relabelling flipped outcomes."""
    by = {}
    for j, (k, _) in pr.items():
        by.setdefault((events[j]["type"], events[k]["kind"]), Counter())[events[k]["type"]] += 1
    return {key: c.most_common(1)[0][0] for key, c in by.items()}


def simulate(events, game, kid, afm, model, n=N_SIMS, seed=0, draws=None):
    """Mean label probabilities per event (len(events) x 6) over n simulated playthroughs, and the mean success rate."""
    pr = pairs(events)
    types = outcome_types(events, pr)
    attempts = sorted(pr)
    rng = np.random.default_rng(seed)
    if draws is None:
        draws = np.random.default_rng(seed + 1).random((n, len(attempts)))
    # per simulation: which attempts succeed
    p = np.array([p_success(afm, kid, game, i) for i in range(len(attempts))])
    ok = draws < p[None, :]
    flip_kind = {}
    for a, (j, (k, follow)) in enumerate(sorted(pr.items())):
        flip_kind[k] = (a, j, follow)
    drop = {m: flip_kind[k][0] for k, (a, j, follow) in flip_kind.items() for m in follow}

    stages = stages_of(events)
    steppers = [Stepper() for _ in range(n)]
    prev = np.array(["none"] * n, dtype=object)
    prev_end = np.zeros(n)
    cur = np.array(["none"] * n, dtype=object)
    cur_ms = np.zeros(n)
    mean_P = np.zeros((len(events), len(LABELS)))
    cols = {c: np.zeros(n) for c in ("fail_streak", "s_since_success", "s_since_progress", "attempts_30s", "new_thing_10s",
                                     "text_chars_on_screen", "s_in_session", "explore_so_far", "help_so_far", "rapid_retry",
                                     "attempts_no_success")}
    for i, e in enumerate(events):
        kinds = [e["kind"]] * n
        tys = [e["type"]] * n
        if i in flip_kind:
            a, j, _ = flip_kind[i]
            for s in range(n):
                kinds[s] = "success" if ok[s, a] else "fail"
                if kinds[s] != e["kind"]:
                    tys[s] = types.get((events[j]["type"], kinds[s]), kinds[s])
        elif i in drop:
            a = drop[i]
            for s in range(n):
                if ok[s, a]:
                    kinds[s] = "other"    # the consequence of a failure that, in this simulation, didn't happen
        for s in range(n):
            f = steppers[s].step({**e, "kind": kinds[s], "type": tys[s]}, i)
            for c in cols:
                cols[c][s] = f[c]
        df = pd.DataFrame({**cols, "kind": kinds, "type": tys, "prev_label": prev, "kid": kid,
                           "s_since_moment": (e["ms"] - prev_end) / 1000})
        P = model.proba(df)
        mean_P[i] = P.mean(0)
        u = rng.random(n)
        sampled = np.array(LABELS, dtype=object)[np.minimum((P.cumsum(1) < u[:, None]).sum(1), len(LABELS) - 1)]
        ended = (cur != "none") & (sampled != cur)
        prev = np.where(ended, cur, prev)
        prev_end = np.where(ended, cur_ms, prev_end)
        cur = sampled
        cur_ms = np.where(sampled != "none", e["ms"], cur_ms)
    return mean_P, {"stages": stages, "success_rate": float(ok.mean()) if ok.size else None, "attempts": len(attempts)}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True)
    ap.add_argument("--afm")
    ap.add_argument("--kid", required=True)
    ap.add_argument("--target", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--n", type=int, default=N_SIMS)
    args = ap.parse_args(argv)

    import reaction  # noqa: F401  (models.joblib holds reaction.Model objects)
    models = joblib.load(Path(args.models) / "models.joblib")
    afm = read_json(args.afm, {}) if args.afm else {}
    aligned = read_json(Path(args.target) / "aligned.json")
    meta = read_json(Path(args.target) / "session.json", {}) or {}
    events = (aligned or {}).get("events", [])
    game, kid = str(meta.get("game", "unknown")), args.kid.upper()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    draws = np.random.default_rng(1).random((args.n, len(pairs(events))))
    summary = {"kid": kid, "game": game, "target": Path(args.target).name, "n": args.n, "variants": {}}
    for variant, model in models.items():
        P, info = simulate(events, game, kid, afm, model, n=args.n, draws=draws)
        frame = pd.DataFrame({"i": range(len(events)), "stage": info["stages"], "type": [e["type"] for e in events]})
        for j, l in enumerate(LABELS):
            frame[f"p_{l}"] = P[:, j]
        frame.to_csv(out / f"probs-{variant}.csv", index=False)
        summary["variants"][variant] = {"success_rate": info["success_rate"], "attempts": info["attempts"],
                                        "expected_rows": dict(zip(LABELS, P.sum(0).tolist()))}
    dump(summary, out / "simulation.json")


if __name__ == "__main__":
    main()
