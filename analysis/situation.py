"""Session loading and the event bookkeeping shared by traits and simulation. Mirrors src/predict/rows.ts."""
import json
import re
from pathlib import Path

LABELS = ["confused", "stuck", "bored", "frustrated", "delighted", "none"]
MIN_CONFIDENCE = 0.5
SAME_FAILURE_MS = 50
RAPID_RETRY_MS = 1000


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


def ok_moments(moments):
    return [m for m in (moments or []) if m.get("status") == "ok" and m.get("label") != "none"
            and float(m.get("confidence", 0)) >= MIN_CONFIDENCE]


def load_session(d):
    d = Path(d)
    aligned = read_json(d / "aligned.json")
    if not aligned:
        raise SystemExit(f"no aligned.json in {d}")
    meta = read_json(d / "session.json", {}) or {}
    moments = read_json(d / "moments.json")
    return {"id": d.name, "dir": str(d), "kid": str(meta.get("kid", "?")).upper(), "game": str(meta.get("game", "unknown")),
            "round": str(meta.get("round", "learn")), "events": aligned.get("events", []),
            "duration_ms": aligned.get("durationMs"), "moments": moments if isinstance(moments, list) else None,
            "transcript": read_json(d / "transcript.json")}


def _is_block_start(e):
    return e.get("kind") == "progress" and str(e.get("type", "")).endswith("_start") and e.get("type") != "logger_start"


def _has_stage_number(e):
    return e.get("kind") == "progress" and any(f in (e.get("data") or {}) for f in ("level", "wave", "season"))


def blocks_of(events):
    starts = _is_block_start if sum(map(_is_block_start, events)) >= 2 else _has_stage_number
    b, out = 0, []
    for e in events:
        if starts(e):
            b += 1
        out.append(b)
    return out


def resolve_intents(debriefs, session_id, game, events):
    mine = [d for d in debriefs or [] if d.get("session") == session_id]
    pool = mine or [d for d in debriefs or [] if not d.get("session") and d.get("game") == game]
    types = sorted({e["type"] for e in events})
    out = {}
    for d in pool:
        for a in d.get("answers", []):
            if not a.get("intent"):
                continue
            if a.get("event"):
                out[a["event"]] = a["intent"]
                continue
            text = f"{a.get('q', '')} {a.get('a', '')}".lower()
            for t in types:
                toks = [x for x in re.split(r"[^a-z0-9]+", t.lower()) if len(x) >= 5]
                if any(re.search(r"\b" + re.escape(x), text) for x in toks):
                    out[t] = a["intent"]
    return out


def play_end_ms(session):
    ev = session["events"]
    debrief = next((e["ms"] for e in ev if e.get("type") == "debrief_start"), None)
    # events logged after the recording stopped (a long idle, page_hide) are not play
    return debrief if debrief is not None else (session.get("duration_ms") or (ev[-1]["ms"] if ev else 0))
