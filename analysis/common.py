"""Shared pieces of the player model: the trait shape, intervals, shrinkage, block bootstrap."""
import json
import math

import numpy as np

K_SHRINK = 5          # pseudo-observations pulling a kid's per-game value toward the group on that game
LEVEL = 0.90          # interval coverage
BOOT = 200


def num(x):
    """A JSON-safe float or None (never NaN or inf)."""
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def trait(value=None, lo=None, hi=None, n=0, games=(), adjusted=False, source="", **extra):
    t = {"value": num(value), "lo": num(lo), "hi": num(hi), "n": int(n), "games": sorted(set(games)),
         "adjusted": bool(adjusted), "source": source}
    if t["value"] is None:
        t["lo"] = t["hi"] = None
    for k, v in extra.items():
        t[k] = num(v) if isinstance(v, (float, np.floating)) else v
    return t


def interval(samples):
    """Percentile interval of the finite bootstrap replicates, or (None, None) with fewer than 10 of them."""
    s = np.asarray([x for x in samples if x is not None and math.isfinite(x)], dtype=float)
    if len(s) < 10:
        return None, None
    a = (1 - LEVEL) / 2
    return float(np.quantile(s, a)), float(np.quantile(s, 1 - a))


def block_resample(groups, rng):
    """groups: {stratum: [block ids]}. Resample blocks with replacement inside each stratum (a session)."""
    return {s: list(rng.choice(b, size=len(b), replace=True)) if b else [] for s, b in groups.items()}


def dump(obj, path):
    def clean(o):
        if isinstance(o, dict):
            return {str(k): clean(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [clean(v) for v in o]
        if isinstance(o, (float, np.floating)):
            return num(o)
        if isinstance(o, np.integer):
            return int(o)
        if isinstance(o, np.bool_):
            return bool(o)
        return o
    with open(path, "w") as f:
        json.dump(clean(obj), f, indent=2, allow_nan=False)
