import json
from pathlib import Path


def ev(ms, kind, type_=None, **data):
    return {"ms": ms, "type": type_ or kind, "kind": kind, "data": {"kind": kind, **data}}


def moment(id_, start, end, label, confidence=0.9, face="", voice="", hands=""):
    return {"id": id_, "startMs": start, "endMs": end, "triggers": [], "label": label, "confidence": confidence,
            "evidence": {"face": face, "voice": voice, "hands": hands, "screen": ""}, "game_context": "",
            "fix_hint": "", "status": "ok"}


def write_session(root, sid, kid, game, events, moments=None, round_="learn", duration=None):
    d = Path(root) / sid
    d.mkdir(parents=True, exist_ok=True)
    (d / "session.json").write_text(json.dumps({"id": sid, "kid": kid, "game": game, "round": round_}))
    last = events[-1]["ms"] if events else 0
    (d / "aligned.json").write_text(json.dumps({"t0": 0, "durationMs": duration or last, "tracks": {}, "events": events}))
    if moments is not None:
        (d / "moments.json").write_text(json.dumps(moments))
    return d


def write_kid(root, letter, questionnaire=None, debriefs=None):
    d = Path(root) / "kids" / letter.lower()
    d.mkdir(parents=True, exist_ok=True)
    if questionnaire is not None:
        (d / "questionnaire.json").write_text(json.dumps(questionnaire))
    if debriefs is not None:
        (d / "debriefs.json").write_text(json.dumps(debriefs))


def runs(n_runs, per_run, gap_ms=1000, fail_every=0, start=0, restart_ms=5000, explore_every=0):
    """n_runs runs of per_run attempts; every `fail_every`-th attempt fails; each run ends with a fail and a restart."""
    events, ms = [], start
    for r in range(n_runs):
        events.append(ev(ms, "progress", "run_start"))
        ms += 500
        for j in range(per_run):
            events.append(ev(ms, "attempt", "slice"))
            fail = fail_every and (j + 1) % fail_every == 0
            events.append(ev(ms + 100, "fail" if fail else "success", "wrong_cut" if fail else "slice_ok"))
            if explore_every and (j + 1) % explore_every == 0:
                events.append(ev(ms + 200, "explore", "menu_look"))
            ms += gap_ms
        events.append(ev(ms, "attempt", "slice"))
        events.append(ev(ms + 100, "fail", "wrong_cut"))
        events.append(ev(ms + 100, "progress", "run_end"))
        ms += restart_ms
    return events, ms
