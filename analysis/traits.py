"""Player traits (spec 3b): computed estimators with 90% block-bootstrap intervals, shrunk toward the group on each
game and game-adjusted (a kid is only compared with other kids on the same game)."""
import argparse
import sys
from pathlib import Path

import numpy as np
from scipy import stats
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, str(Path(__file__).parent))
from common import BOOT, K_SHRINK, LEVEL, block_resample, dump, interval, num, trait  # noqa: E402
from situation import (RAPID_RETRY_MS, SAME_FAILURE_MS, blocks_of, load_session, ok_moments, play_end_ms,  # noqa: E402,F401
                       read_json, resolve_intents)

UPSET = {"frustrated", "stuck"}
NEGATIVE = {"frustrated", "stuck", "bored"}
READ_CPS = 15
RESTART_S = 20
WHEEL_N = 10
LONG_TEXT = 100

# name: (n unit, needs moments, source)
TRAITS = {
    "frustration_tolerance": ("fails", True, "k50 of a logistic of P(frustrated or stuck, now or before the next fail, within 10 s) on fail streak"),
    "recovery": ("fails", False, "median seconds from a fail to the next attempt"),
    "persistence": ("failed runs", False, "share of failed runs followed by a new run within 20 s"),
    "exploration_drive": ("minutes", False, "explore events per minute, accidental ones (debrief) left out; our own measure"),
    "reading": ("texts", False, f"share of texts left open long enough to read at {READ_CPS} characters a second"),
    "pace": ("minutes", False, "attempts per minute"),
    "challenge_appetite": ("success-streak events", True, "P(bored) during success streaks of 5 or more; our own measure"),
    "stamina": ("minutes", True, "slope of negative moments per minute across the session (per minute); our own measure"),
    "expressiveness": ("moments", True, "mean share of face, voice and hands carrying evidence per moment; our own measure"),
    "confusion_resolves": ("confused moments", True, "share of confused moments not followed by frustration within 30 s"),
}
AFM_TRAITS = ("skill", "learning_rate")
# questionnaire axis -> (trait, sign): -1 is the A end (explore, read, challenge, stick with it, show, fast), which is more of the trait
SAID_AXES = {"explore": "exploration_drive", "read": "reading", "challenge": "challenge_appetite",
             "persist": "persistence", "social": "expressiveness", "pace": "pace"}
SAID_STRONG = 0.5


def _active_or_starts(moments, t, until, labels):
    return any(m["label"] in labels and (m["startMs"] <= t <= m["endMs"] or t < m["startMs"] <= until) for m in moments)


def session_blocks(s, intents):
    """Per-block sufficient statistics for every trait, so a block bootstrap only re-aggregates."""
    end = play_end_ms(s)
    events = [e for e in s["events"] if e["ms"] <= end and e.get("type") != "debrief_start"]
    blocks = blocks_of(events)
    moments = ok_moments(s["moments"]) if s["moments"] is not None else None
    ids = sorted(set(blocks))
    first = {b: next(e["ms"] for e, bb in zip(events, blocks) if bb == b) for b in ids}
    if ids and 0 not in ids:
        first[ids[0]] = 0
    elif 0 in ids:
        first[0] = 0
    bounds = {b: (first[b], first[ids[i + 1]] if i + 1 < len(ids) else end) for i, b in enumerate(ids)}
    st = {b: dict(session=s["id"], block=b, start=bounds[b][0], minutes=max(0, bounds[b][1] - bounds[b][0]) / 60000,
                  attempts=0, explores=0, accidental=0, gaps=[], idleq=[], reads=[], pauses=[], wheel=0,
                  outcomes=[], last_fail=None, ft=[], bored_streak=[], neg=0, confused=[], channels=[],
                  has_moments=moments is not None) for b in ids}

    fail_streak, last_fail, no_success, succ_streak, new_at, opened = 0, -1e18, 0, 0, None, []
    for i, (e, b) in enumerate(zip(events, blocks)):
        k, t = e["kind"], e["ms"]
        x = st[b]
        if k == "fail":
            new_failure = t - last_fail > SAME_FAILURE_MS
            last_fail = t
            if not new_failure:
                continue
            fail_streak += 1
            succ_streak = 0
            x["outcomes"].append(0)
            x["last_fail"] = t
            nxt_attempt = next((f["ms"] for f in events[i + 1:] if f["kind"] == "attempt"), None)
            if nxt_attempt is not None:
                x["gaps"].append((nxt_attempt - t) / 1000)
            x["idleq"].append(int(any(f["kind"] in ("idle", "quit") and t < f["ms"] <= t + 15000 for f in events[i + 1:])))
            if moments is not None:
                nxt_fail = next((f["ms"] for f in events[i + 1:] if f["kind"] == "fail" and f["ms"] - t > SAME_FAILURE_MS), None)
                until = min(t + 10000, nxt_fail if nxt_fail is not None else t + 10000)
                x["ft"].append((fail_streak, int(_active_or_starts(moments, t, until, UPSET))))
        elif k == "success":
            fail_streak, no_success = 0, 0
            succ_streak += 1
            x["outcomes"].append(1)
            if moments is not None and succ_streak >= 5:
                x["bored_streak"].append(int(_active_or_starts(moments, t, t + 10000, {"bored"})))
        elif k == "attempt":
            x["attempts"] += 1
            no_success += 1
            if no_success >= WHEEL_N:
                x["wheel"] += 1
            if new_at is not None:
                st[new_at[1]]["pauses"].append((t - new_at[0]) / 1000)
                new_at = None
        elif k == "new_thing":
            new_at = (t, b)
        elif k == "explore":
            if intents.get(e["type"]) == "accidental":
                x["accidental"] += 1
            else:
                x["explores"] += 1
        elif k == "text_shown":
            chars = (e.get("data") or {}).get("chars") or 0
            opened.append(((e.get("data") or {}).get("id"), t, chars, b))
        elif k == "text_closed":
            tid = (e.get("data") or {}).get("id")
            at = next((j for j, o in enumerate(opened) if tid is not None and o[0] == tid), 0 if opened else None)
            if at is not None:
                _, t0, chars, b0 = opened.pop(at)
                if chars:
                    st[b0]["reads"].append((int((t - t0) / 1000 >= chars / READ_CPS), chars))

    if moments is not None:
        def block_at(ms):
            return max([b for b in ids if bounds[b][0] <= ms] or ids[:1])
        for m in moments:
            if not ids:
                break
            x = st[block_at(m["startMs"])]
            if m["label"] in NEGATIVE:
                x["neg"] += 1
            ev = m.get("evidence") or {}
            x["channels"].append([int(bool(str(ev.get(c, "")).strip())) for c in ("face", "voice", "hands")])
            if m["label"] == "confused":
                bad = any(o["label"] == "frustrated" and m["endMs"] < o["startMs"] <= m["endMs"] + 30000 for o in moments)
                x["confused"].append(0 if bad else 1)
    return [st[b] for b in ids]


def _restarts(bs):
    """(failed runs with a following run, restarted within 20 s) over a list of consecutive blocks of one session."""
    out = []
    for cur, nxt in zip(bs, bs[1:]):
        if cur["outcomes"] and cur["outcomes"][-1] == 0 and cur["last_fail"] is not None and nxt["session"] == cur["session"]:
            out.append(int((nxt["start"] - cur["last_fail"]) / 1000 <= RESTART_S))
    return out


def _slope(xs, ys, ws):
    xs, ys, ws = map(lambda a: np.asarray(a, float), (xs, ys, ws))
    if len(xs) < 3 or ws.sum() <= 0 or np.ptp(xs) == 0:
        return None
    mx = np.average(xs, weights=ws)
    my = np.average(ys, weights=ws)
    den = np.sum(ws * (xs - mx) ** 2)
    return float(np.sum(ws * (xs - mx) * (ys - my)) / den) if den > 0 else None


def _k50(pairs):
    if len(pairs) < 5:
        return None, None
    x = np.array([p[0] for p in pairs], float)[:, None]
    y = np.array([p[1] for p in pairs])
    if len(set(y)) < 2:
        return None, (float(x.max()) if y.max() == 0 else 0.0)
    m = LogisticRegression(C=10.0, max_iter=2000).fit(x, y)
    b0, b1 = float(m.intercept_[0]), float(m.coef_[0][0])
    if b1 <= 0:
        return None, None
    k = -b0 / b1
    if k > 2 * x.max():
        return None, float(x.max())
    return max(0.0, k), None


def exact_interval(name, bs):
    """Exact Poisson (rates) or Clopper-Pearson (shares) interval. A block bootstrap collapses to a point when every
    block agrees (no explore events at all, every text read); this keeps the sampling floor in that case."""
    a = (1 - LEVEL) / 2
    minutes = sum(b["minutes"] for b in bs)
    if name in ("pace", "exploration_drive") and minutes > 0:
        c = sum(b["attempts" if name == "pace" else "explores"] for b in bs)
        lo = stats.chi2.ppf(a, 2 * c) / 2 if c > 0 else 0.0
        hi = stats.chi2.ppf(1 - a, 2 * c + 2) / 2
        return lo / minutes, hi / minutes
    shares = {"reading": lambda: [x[0] for b in bs for x in b["reads"]], "persistence": lambda: _restarts(bs),
              "challenge_appetite": lambda: [x for b in bs for x in b["bored_streak"]],
              "confusion_resolves": lambda: [x for b in bs for x in b["confused"]]}
    if name in shares:
        r = shares[name]()
        if not r or (TRAITS[name][1] and not all(b["has_moments"] for b in bs)):
            return None, None
        k, n = sum(r), len(r)
        lo = stats.beta.ppf(a, k, n - k + 1) if k > 0 else 0.0
        hi = stats.beta.ppf(1 - a, k + 1, n - k) if k < n else 1.0
        return float(lo), float(hi)
    return None, None


def aggregate(name, bs):
    """(value, n) of one trait over a list of blocks (a kid's real blocks, or a bootstrap resample of them)."""
    if not bs:
        return None, 0
    minutes = sum(b["minutes"] for b in bs)
    if TRAITS[name][1] and not all(b["has_moments"] for b in bs):
        return None, 0
    if name == "recovery":
        g = [x for b in bs for x in b["gaps"]]
        return (float(np.median(g)) if g else None), len(g)
    if name == "pace":
        return (sum(b["attempts"] for b in bs) / minutes if minutes > 0 else None), round(minutes)
    if name == "exploration_drive":
        return (sum(b["explores"] for b in bs) / minutes if minutes > 0 else None), round(minutes)
    if name == "reading":
        r = [x[0] for b in bs for x in b["reads"]]
        return (float(np.mean(r)) if r else None), len(r)
    if name == "persistence":
        r = _restarts(bs)
        return (float(np.mean(r)) if r else None), len(r)
    if name == "frustration_tolerance":
        pairs = [p for b in bs for p in b["ft"]]
        return _k50(pairs)[0], len(pairs)
    if name == "challenge_appetite":
        r = [x for b in bs for x in b["bored_streak"]]
        return (float(np.mean(r)) if r else None), len(r)
    if name == "stamina":
        pts = [(b["start"] / 60000 + b["minutes"] / 2, b["neg"] / b["minutes"], b["minutes"]) for b in bs if b["minutes"] > 0]
        return _slope(*zip(*pts)) if len(pts) >= 3 else None, round(minutes)
    if name == "expressiveness":
        c = [np.mean(x) for b in bs for x in b["channels"]]
        return (float(np.mean(c)) if c else None), len(c)
    if name == "confusion_resolves":
        r = [x for b in bs for x in b["confused"]]
        return (float(np.mean(r)) if r else None), len(r)
    raise KeyError(name)


def extras(name, bs, sessions, intents):
    if name == "recovery":
        q = [x for b in bs for x in b["idleq"]]
        return {"p_idle_or_quit_15s": float(np.mean(q)) if q else None}
    if name == "pace":
        p = [x for b in bs for x in b["pauses"]]
        return {"new_thing_pause_s": float(np.median(p)) if p else None}
    if name == "exploration_drive":
        firsts = []
        for s in sessions:
            t = next((e["ms"] / 1000 for e in s["events"] if e["kind"] == "explore" and intents[s["id"]].get(e["type"]) != "accidental"), None)
            if t is not None:
                firsts.append(t)
        return {"first_explore_s": float(np.median(firsts)) if firsts else None, "accidental_discounted": sum(b["accidental"] for b in bs)}
    if name == "reading":
        r = [x for b in bs for x in b["reads"]]
        short = [x[0] for x in r if x[1] < LONG_TEXT]
        long_ = [x[0] for x in r if x[1] >= LONG_TEXT]
        return {"short_share": float(np.mean(short)) if short else None, "long_share": float(np.mean(long_)) if long_ else None}
    if name == "persistence":
        attempts = sum(b["attempts"] for b in bs)
        worst = [b for b in bs if len(b["outcomes"]) >= 3]
        after = None
        if worst:
            w = max(worst, key=lambda b: 1 - np.mean(b["outcomes"]))
            ends = [x["start"] + x["minutes"] * 60000 for x in bs if x["session"] == w["session"]]
            after = (max(ends) - (w["start"] + w["minutes"] * 60000)) / 1000
        return {"wheel_spin_share": sum(b["wheel"] for b in bs) / attempts if attempts else None, "time_after_worst_s": after}
    if name == "stamina":
        pts = [(b["start"] / 60000 + b["minutes"] / 2, b["attempts"] / b["minutes"], b["minutes"]) for b in bs if b["minutes"] > 0]
        mood = [str((e.get("data") or {}).get("mood")) for s in sessions for e in s["events"] if e.get("type") == "operator_mood"]
        return {"attempts_slope": _slope(*zip(*pts)) if len(pts) >= 3 else None, "mood": mood}
    if name == "expressiveness":
        ch = [x for b in bs for x in b["channels"]]
        talk = None
        turns = [t for s in sessions for t in ((s["transcript"] or {}).get("turns") or []) if t.get("who") == "kid"]
        mins = sum(b["minutes"] for b in bs)
        if any(s["transcript"] for s in sessions) and mins > 0:
            talk = len(turns) / mins
        share = {c: (float(np.mean([x[i] for x in ch])) if ch else None) for i, c in enumerate(("face", "voice", "hands"))}
        return {**share, "talk_per_min": talk}
    if name == "frustration_tolerance":
        _, censored = _k50([p for b in bs for p in b["ft"]])
        return {"censored_at": censored} if censored is not None else {}
    return {}


def _said(root, letter):
    kid_dir = None
    for l in (letter.lower(), letter.upper()):
        if (Path(root) / "kids" / l).is_dir():
            kid_dir = Path(root) / "kids" / l
            break
    q = read_json(kid_dir / "questionnaire.json", {}) if kid_dir else {}
    deb = read_json(kid_dir / "debriefs.json", []) if kid_dir else []
    said = {a: (num((q or {}).get("scores", {}).get(a))) for a in ("explore", "read", "challenge", "persist", "look", "social", "pace")}
    fun = {}
    for d in deb or []:
        for a in d.get("answers", []):
            if isinstance(a.get("fun"), (int, float)):
                fun[d.get("game")] = a["fun"]
    said["fun"] = fun
    return said, deb or []


def compute(session_dirs, kids_file, afm_file=None, boot=BOOT, seed=0):
    root = Path(kids_file).parent
    kids_meta = read_json(kids_file, {}) or {}
    sessions = [load_session(d) for d in session_dirs]
    debriefs, said = {}, {}
    for kid in sorted({s["kid"] for s in sessions}):
        said[kid], debriefs[kid] = _said(root, kid)
    intents = {s["id"]: resolve_intents(debriefs[s["kid"]], s["id"], s["game"], s["events"]) for s in sessions}

    cells = {}  # (kid, game) -> blocks
    for s in sessions:
        cells.setdefault((s["kid"], s["game"]), []).extend(session_blocks(s, intents[s["id"]]))
    rng = np.random.default_rng(seed)
    raw = {}
    for (kid, game), bs in cells.items():
        strata = {}
        for i, b in enumerate(bs):
            strata.setdefault(b["session"], []).append(i)
        reps = {n: [] for n in TRAITS}
        for _ in range(boot):
            pick = block_resample(strata, rng)
            sample = [bs[i] for s in sorted(pick) for i in sorted(pick[s])]
            for n in TRAITS:
                reps[n].append(aggregate(n, sample)[0])
        mine = [s for s in sessions if s["kid"] == kid and s["game"] == game]
        for n in TRAITS:
            v, cnt = aggregate(n, bs)
            raw[(kid, game, n)] = (v, cnt, np.array([np.nan if r is None else r for r in reps[n]], float),
                                   extras(n, bs, mine, intents), exact_interval(n, bs))

    games = sorted({g for _, g in cells})
    afm = read_json(afm_file, {}) if afm_file else {}
    out = {"k": K_SHRINK, "level": LEVEL, "boot": {"n": boot, "unit": "block", "within": "session"},
           "traits": {n: {"n_unit": u, "needs_moments": m, "source": src} for n, (u, m, src) in TRAITS.items()}, "kids": {}}
    kids = sorted({k for k, _ in cells})
    for kid in kids:
        out["kids"][kid] = {"letter": kid, "age": (kids_meta.get(kid) or {}).get("age"),
                            "sessions": sorted(s["id"] for s in sessions if s["kid"] == kid),
                            "games": sorted(g for k, g in cells if k == kid), "traits": {}, "said": said[kid], "gaps": [],
                            "intents": [{"session": sid, "type": t, "intent": i} for sid in sorted(intents) for t, i in sorted(intents[sid].items())
                                        if any(s["id"] == sid and s["kid"] == kid for s in sessions)]}

    for n, (unit, _, src) in TRAITS.items():
        for g in games:
            vals = {k: raw[(k, g, n)] for k in kids if (k, g, n) in raw and raw[(k, g, n)][0] is not None}
            adjusted = len(vals) >= 2
            mean = float(np.mean([v[0] for v in vals.values()])) if vals else None
            # the group mean is itself uncertain: bootstrap it from each kid's own replicates, in step
            mean_reps = np.nanmean(np.stack([v[2] for v in vals.values()]), axis=0) if adjusted else None
            for k in kids:
                if (k, g, n) not in raw:
                    continue
                v, cnt, reps, ex, (elo, ehi) = raw[(k, g, n)]
                w = cnt / (cnt + K_SHRINK) if adjusted else 1.0
                shrink = (lambda x: w * x + (1 - w) * mean) if adjusted else (lambda x: x)
                boot = (w * reps + (1 - w) * mean_reps) if adjusted else reps
                lo, hi = interval([r for r in boot if np.isfinite(r)]) if v is not None else (None, None)
                val = shrink(v) if v is not None else None
                if val is not None and lo is not None:
                    lo, hi = min(lo, val), max(hi, val)
                if val is not None and elo is not None:   # never narrower than the exact interval
                    lo, hi = min(lo, shrink(elo)) if lo is not None else shrink(elo), max(hi, shrink(ehi)) if hi is not None else shrink(ehi)
                t = trait(val, lo, hi, cnt, [g], adjusted, src, raw=v, group_mean=mean if adjusted else None, weight=w, n_unit=unit, **ex)
                t["_reps"] = (boot - mean_reps) if adjusted and v is not None else None
                out["kids"][k]["traits"].setdefault(n, {"per_game": {}})["per_game"][g] = t

    for kid in kids:
        for n in TRAITS:
            entry = out["kids"][kid]["traits"].setdefault(n, {"per_game": {}})
            per = entry["per_game"]
            adj = [(g, t) for g, t in per.items() if t["adjusted"] and t["value"] is not None]
            top = trait(None, n=sum(t["n"] for t in per.values()), games=list(per), adjusted=False,
                        source=TRAITS[n][2] + "; no game shared with another kid, see per_game" if not adj else
                        TRAITS[n][2] + "; difference from the group mean on the same game, n-weighted over games")
            if adj:
                ws = np.array([t["n"] for _, t in adj], float)
                ws = ws / ws.sum() if ws.sum() > 0 else np.full(len(adj), 1 / len(adj))
                val = float(sum(w * (t["value"] - t["group_mean"]) for w, (_, t) in zip(ws, adj)))
                reps = sum(w * t["_reps"] for w, (_, t) in zip(ws, adj))
                lo, hi = interval(list(reps))
                # never narrower than the per-game intervals carried through the same weights (conservative with 2+ games)
                clo = float(sum(w * (t["lo"] - t["group_mean"]) for w, (_, t) in zip(ws, adj) if t["lo"] is not None))
                chi = float(sum(w * (t["hi"] - t["group_mean"]) for w, (_, t) in zip(ws, adj) if t["hi"] is not None))
                lo, hi = (min(lo, val, clo), max(hi, val, chi)) if lo is not None else (min(val, clo), max(val, chi))
                top = trait(val, lo, hi, sum(t["n"] for _, t in adj), [g for g, _ in adj], True, top["source"])
            for t in per.values():
                t.pop("_reps", None)
            entry.update(top)

        a = (afm.get("kids") or {}).get(kid) or {}
        for n in AFM_TRAITS:
            per = {g: c[n] for g, c in (a.get("games") or {}).items() if n in c}
            top = a.get(n) or trait(None, games=list(per), source="afm: not run")
            out["kids"][kid]["traits"][n] = {**top, "per_game": per}

        s = said[kid]
        for axis, name in SAID_AXES.items():
            v, t = s.get(axis), out["kids"][kid]["traits"][name]
            if v is None or abs(v) < SAID_STRONG or not t["adjusted"] or t["lo"] is None:
                continue
            more = v < 0   # the A end of every mapped axis means more of the trait
            if (more and t["hi"] < 0) or (not more and t["lo"] > 0):
                out["kids"][kid]["gaps"].append({
                    "axis": axis, "trait": name, "said": v, "did": t["value"], "lo": t["lo"], "hi": t["hi"],
                    "note": f"said {'more' if more else 'less'} {axis} than most; plays with {'less' if more else 'more'} "
                            f"{name.replace('_', ' ')} than the group on the same game, and the {int(LEVEL * 100)}% range agrees"})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--sessions", nargs="+", required=True)
    ap.add_argument("--kids", required=True)
    ap.add_argument("--afm")
    ap.add_argument("--out", required=True)
    ap.add_argument("--boot", type=int, default=BOOT)
    args = ap.parse_args(argv)
    dump(compute(args.sessions, args.kids, args.afm, boot=args.boot), args.out)


if __name__ == "__main__":
    main()
