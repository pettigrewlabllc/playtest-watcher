"""Additive Factors Model: logit P(success) = kid + game + game x practice + kid x practice, L2-shrunk.

Skill is the log-odds of success at practice 0 (intercept + kid + game); learning rate is the change in log-odds
per 10 attempts (game slope + kid slope). Intervals: block bootstrap inside each session (runs or levels resampled).
"""
import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss
from sklearn.model_selection import GroupKFold

sys.path.insert(0, str(Path(__file__).parent))
from common import BOOT, block_resample, dump, interval, trait  # noqa: E402

PAIR_MS = 2000
PRACTICE_UNIT = 10
C_GRID = [0.01, 0.1, 1.0, 10.0]


def pair_attempts(df: pd.DataFrame) -> pd.DataFrame:
    """One row per resolved attempt: the first success/fail within 2 s after it and before the next attempt,
    preferring one of the attempt's own type. Practice counts all of the kid's earlier attempts on the game."""
    out = []
    practice = {}
    df = df.copy()
    df["block"] = df["block"] if "block" in df else 0
    for session, s in sorted(df.groupby("session", sort=False), key=lambda x: str(x[0])):
        s = s.sort_values("i")
        recs = s.to_dict("records")
        used = set()
        for j, r in enumerate(recs):
            if r["kind"] != "attempt":
                continue
            key = (str(r["kid"]), str(r["game"]))
            p = practice.get(key, 0)
            practice[key] = p + 1
            cands = []
            for k in range(j + 1, len(recs)):
                o = recs[k]
                if o["kind"] == "attempt" or o["ms"] - r["ms"] > PAIR_MS:
                    break
                if o["kind"] in ("success", "fail") and k not in used:
                    cands.append(k)
            if not cands:
                continue
            same = [k for k in cands if recs[k]["type"] == r["type"]]
            k = (same or cands)[0]
            used.add(k)
            out.append(dict(session=str(session), kid=str(r["kid"]), game=str(r["game"]), block=int(r["block"]),
                            practice=p, y=1 if recs[k]["kind"] == "success" else 0))
    return pd.DataFrame(out, columns=["session", "kid", "game", "block", "practice", "y"])


def design(att, kids, games):
    x = att["practice"].to_numpy(float) / PRACTICE_UNIT
    k = np.stack([(att["kid"] == v).to_numpy(float) for v in kids], 1)
    g = np.stack([(att["game"] == v).to_numpy(float) for v in games], 1)
    return np.hstack([k, g, g * x[:, None], k * x[:, None]])


def fit(att, kids, games, C):
    y = att["y"].to_numpy()
    if len(set(y)) < 2:
        return None
    m = LogisticRegression(C=C, max_iter=5000).fit(design(att, kids, games), y)
    nk, ng = len(kids), len(games)
    c = m.coef_[0]
    return {"intercept": float(m.intercept_[0]),
            "kid": dict(zip(kids, c[:nk])), "game": dict(zip(games, c[nk:nk + ng])),
            "game_slope": dict(zip(games, c[nk + ng:nk + 2 * ng])), "kid_slope": dict(zip(kids, c[nk + 2 * ng:]))}


def cells(coef, pairs):
    """Skill and learning rate for each (kid, game)."""
    return {(k, g): (coef["intercept"] + coef["kid"][k] + coef["game"][g], coef["game_slope"][g] + coef["kid_slope"][k])
            for k, g in pairs}


def choose_C(att, kids, games):
    """Grouped CV over (session, block): every kid-game cell stays in training, neighbouring attempts stay together."""
    groups = att["session"] + "#" + att["block"].astype(str)
    n = groups.nunique()
    if n < 3:
        return 1.0, {}
    cv = GroupKFold(n_splits=min(5, n))
    X, y = design(att, kids, games), att["y"].to_numpy()
    losses = {}
    for C in C_GRID:
        ls = []
        for tr, te in cv.split(X, y, groups):
            if len(set(y[tr])) < 2:
                continue
            m = LogisticRegression(C=C, max_iter=5000).fit(X[tr], y[tr])
            ls.append(log_loss(y[te], m.predict_proba(X[te])[:, 1], labels=[0, 1]))
        if ls:
            losses[C] = float(np.mean(ls))
    if not losses:
        return 1.0, {}
    return min(losses, key=losses.get), losses


def run(df, boot=BOOT, seed=0):
    att = pair_attempts(df)
    if att.empty or att["y"].nunique() < 2:
        raise SystemExit("afm.py: need resolved attempts with both successes and failures")
    kids, games = sorted(att["kid"].unique()), sorted(att["game"].unique())
    C, losses = choose_C(att, kids, games)
    coef = fit(att, kids, games, C)
    pairs = sorted({(k, g) for k, g in zip(att["kid"], att["game"])})
    point = cells(coef, pairs)

    strata = {s: sorted(d["block"].unique()) for s, d in att.groupby("session")}
    by_block = {(s, b): d for (s, b), d in att.groupby(["session", "block"])}
    rng = np.random.default_rng(seed)
    reps = {p: ([], []) for p in pairs}
    kid_reps = {k: ([], []) for k in kids}
    for _ in range(boot):
        pick = block_resample(strata, rng)
        sample = pd.concat([by_block[(s, b)] for s, bs in pick.items() for b in bs], ignore_index=True)
        c = fit(sample, kids, games, C)
        if c is None:
            continue
        for p, (sk, lr) in cells(c, pairs).items():
            reps[p][0].append(sk)
            reps[p][1].append(lr)
        for k in kids:
            kid_reps[k][0].append(c["kid"][k])
            kid_reps[k][1].append(c["kid_slope"][k])

    kids_on = {g: sorted(att.loc[att["game"] == g, "kid"].unique()) for g in games}
    out = {"model": "logit P(success) = kid + game + game x practice + kid x practice",
           "practice_unit": PRACTICE_UNIT, "C": C, "cv_log_loss": losses,
           "boot": {"n": boot, "unit": "block", "within": "session"},
           "coef": coef, "games": {}, "kids": {}}
    for g in games:
        out["games"][g] = {"skill": coef["intercept"] + coef["game"][g], "learning_rate": coef["game_slope"][g],
                           "kids": kids_on[g], "attempts": int((att["game"] == g).sum())}
    for (k, g), (sk, lr) in point.items():
        cell = att[(att["kid"] == k) & (att["game"] == g)]
        n, nb = len(cell), cell.groupby("session")["block"].nunique().sum()
        adj = len(kids_on[g]) >= 2
        slo, shi = interval(reps[(k, g)][0])
        llo, lhi = interval(reps[(k, g)][1])
        out["kids"].setdefault(k, {"games": {}})["games"][g] = {
            "skill": trait(sk, slo, shi, n, [g], adj, "afm: log-odds of success at practice 0 (L2-shrunk)",
                           kid_term=coef["kid"][k], blocks=int(nb), success_rate=float(cell["y"].mean())),
            "learning_rate": trait(lr, llo, lhi, n, [g], adj, f"afm: change in log-odds per {PRACTICE_UNIT} attempts (L2-shrunk)",
                                   kid_slope=coef["kid_slope"][k], blocks=int(nb)),
        }
    for k in kids:
        mine = sorted(att.loc[att["kid"] == k, "game"].unique())
        shared = [g for g in mine if len(kids_on[g]) >= 2]
        n = int(att["kid"].isin([k]).sum() if not shared else ((att["kid"] == k) & att["game"].isin(shared)).sum())
        for name, key, j, what in (("skill", "kid", 0, "kid term: log-odds of success relative to the other kids on the same games"),
                                   ("learning_rate", "kid_slope", 1, f"kid slope: change in log-odds per {PRACTICE_UNIT} attempts relative to the other kids")):
            if shared:
                lo, hi = interval(kid_reps[k][j])
                out["kids"][k][name] = trait(coef[key][k], lo, hi, n, shared, True, f"afm {what} (L2-shrunk)")
            else:
                out["kids"][k][name] = trait(None, n=n, games=mine, source=f"afm {what}; not identified: no game shared with another kid")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--boot", type=int, default=BOOT)
    args = ap.parse_args(argv)
    dump(run(pd.read_csv(args.rows), boot=args.boot), args.out)


if __name__ == "__main__":
    main()
