"""A persona's live run against the real kid on the same game: the same per-game measures as limits.py, how far
each got, and the reaction mix (the agent's own step labels vs Muse's labels on the kid's video).

    python analysis/compare_runs.py --root recordings <agent session> <kid session> [...more pairs]
"""
import argparse
import collections
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from limits import METRICS, session_limits  # noqa: E402

PROGRESS = ["rush_start", "rush_end", "audit_start", "audit_answer", "upgrade_unlocked"]


def _events(d):
    """Events with ms from the session's own clock: aligned.json for recorded sessions, the game's own t for agent runs."""
    a = d / "aligned.json"
    if a.exists():
        al = json.loads(a.read_text())
        return al["events"], al.get("durationMs", 0)
    raw = [json.loads(line) for line in (d / "events.jsonl").read_text().splitlines() if line.strip()]
    t0 = raw[0]["t"] if raw else 0
    evs = [{"ms": e["t"] - t0, "type": e["type"], "kind": (e.get("data") or {}).get("kind", ""), "data": e.get("data") or {}} for e in raw]
    return evs, (evs[-1]["ms"] if evs else 0)


def describe(d, game):
    evs, dur = _events(d)
    lim = session_limits(evs, game, dur)
    prog = collections.Counter(e["type"] for e in evs if e["type"] in PROGRESS)
    steps_f = d / "steps.jsonl"
    if steps_f.exists():
        labels = collections.Counter(json.loads(line)["label"] for line in steps_f.read_text().splitlines() if line.strip())
        src = "agent's own labels"
    else:
        ms = json.loads((d / "moments.json").read_text()) if (d / "moments.json").exists() else []
        labels = collections.Counter(m["label"] for m in ms if m.get("status") == "ok")
        src = "Muse on video"
    n = sum(labels.values()) or 1
    mix = {k: round(v / n, 2) for k, v in labels.most_common()}
    return {"minutes": round(dur / 60000, 1), **lim, "progress": dict(prog), "mix": mix, "mix_from": src}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="recordings")
    ap.add_argument("--game", default="hoard-keeper")
    ap.add_argument("pairs", nargs="+")
    a = ap.parse_args(argv)
    root = Path(a.root)
    out = []
    for agent, kid in zip(a.pairs[::2], a.pairs[1::2]):
        x, y = describe(root / agent, a.game), describe(root / kid, a.game)
        out.append({"agent": agent, "kid": kid, "agent_run": x, "kid_run": y})
        print(f"== {agent}  vs  {kid}")
        for m in ["minutes", *METRICS]:
            f = lambda v: "-" if v is None else f"{v:.2f}"  # noqa: E731
            print(f"  {m:17} agent {f(x[m]):>7}   kid {f(y[m]):>7}")
        print(f"  progress          agent {x['progress']}\n                    kid   {y['progress']}")
        print(f"  reactions         agent {x['mix']} ({x['mix_from']})\n                    kid   {y['mix']} ({y['mix_from']})")
    (root / "group").mkdir(exist_ok=True)
    (root / "group" / "agent-vs-kid.json").write_text(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
