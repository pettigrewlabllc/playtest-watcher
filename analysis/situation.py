"""Session loading and the event bookkeeping shared by traits and simulation. Mirrors src/predict/rows.ts."""
import json
import re
from collections import deque
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
    """The recording window ends at Stop (durationMs), or just before debrief_start. Mirrors rows.ts playEndMs."""
    ev = session["events"]
    debrief = next((e["ms"] for e in ev if e.get("type") == "debrief_start"), None)
    if debrief is not None:
        return debrief - 1
    d = session.get("duration_ms")
    return d if d and d > 0 else float("inf")


def in_window(session, e, end=None):
    return 0 <= e["ms"] <= (play_end_ms(session) if end is None else end)


FALLBACK_FIELDS = ("level", "wave", "season", "name")
ROW_COLUMNS = ["session", "game", "i", "ms", "stage", "kind", "type", "fail_streak", "s_since_success", "s_since_progress",
               "attempts_30s", "new_thing_10s", "text_chars_on_screen", "s_in_session", "explore_so_far", "help_so_far",
               "label", "weak_labels", "kid", "block", "prev_label", "s_since_moment", "rapid_retry", "attempts_no_success", "intent"]


def _num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    if isinstance(v, (int, float)) or (isinstance(v, str) and v != ""):
        return str(v)
    return None


def _level_start(e, st):
    lv = _num((e.get("data") or {}).get("level"))
    return f"level {lv}" if e.get("type") == "level_start" and lv is not None else None


def _factor_slicer(e, st):
    b = _num((e.get("data") or {}).get("blade"))
    return f"blade {b}" if e.get("type") == "wave_start" and b is not None else None


def _hoard_keeper(e, st):
    d, t = e.get("data") or {}, e.get("type")
    if t == "rush_start" and _num(d.get("season")) is not None:
        st["season"], st["audit"] = _num(d.get("season")), None
        return f"season {st['season']} rush"
    if st.get("season") is None:
        return None
    if t == "audit_start" and _num(d.get("index")) is not None:
        st["audit"], st["of"] = int(float(d["index"])), d.get("of")
        return f"season {st['season']} audit-{st['audit']}"
    if t == "audit_answer" and st.get("audit") is not None and st["of"] is not None and st["audit"] == int(float(st["of"])):
        st["audit"] = None
        return f"season {st['season']} shop"
    return None


def _fallback(e, st):
    if e.get("kind") != "progress" or e.get("type") == "screen":
        return None
    for f in FALLBACK_FIELDS:
        v = _num((e.get("data") or {}).get(f))
        if v is not None:
            return v
    return None


STAGE_MAPS = {"bond-swap": _level_start, "current-cut": _level_start, "factor-slicer": _factor_slicer, "hoard-keeper": _hoard_keeper}


def stage_info_of(events, game=""):
    """(key, run) per event: the game's own content unit, never a screen name. Mirrors src/predict/stages.ts."""
    step, st, key, run, out = STAGE_MAPS.get(game, _fallback), {}, "start", 0, []
    for e in events:
        if e.get("type") == "run_start":
            run += 1
        key = step(e, st) or key
        out.append((key, run))
    return out


def stages_of(events, game=""):
    return [k for k, _ in stage_info_of(events, game)]


PAIR_MS = 2000


def resolvable_types(events):
    """Attempt types whose success is ever logged; only these count toward wheel-spinning (mirrors rows.ts)."""
    out = set()
    for j, e in enumerate(events):
        if e["kind"] != "attempt":
            continue
        for o in events[j + 1:]:
            if o["kind"] == "attempt" or o["ms"] - e["ms"] > PAIR_MS:
                break
            if o["kind"] == "success":
                out.add(e["type"])
                break
            if o["kind"] == "fail":
                break
    return out


class Stepper:
    """The situation features of rows.ts, one event at a time, so a simulation can change outcomes as it goes.
    prev_label and s_since_moment are left to the caller (moments, or the simulation's own sampled reactions)."""

    def __init__(self, resolvable=None):
        self.resolvable = resolvable
        self.fail_streak, self.last_fail, self.no_success = 0, -float("inf"), 0
        self.last_success, self.last_progress, self.explore, self.help = 0, 0, 0, 0
        self.attempts, self.new_things, self.open_text = deque(), deque(), []

    def step(self, e, i=0):
        k, t = e["kind"], e["ms"]
        d = e.get("data") or {}
        chars = d.get("chars") if isinstance(d.get("chars"), (int, float)) else 0
        tid = d.get("id") if isinstance(d.get("id"), str) else None
        rapid = 0
        if k == "fail":
            if t - self.last_fail > SAME_FAILURE_MS:
                self.fail_streak += 1
            self.last_fail = t
        elif k == "success":
            self.fail_streak, self.no_success, self.last_success = 0, 0, t
        elif k == "progress":
            self.last_progress = t
        elif k == "attempt":
            self.attempts.append(t)
            if self.resolvable is None or e["type"] in self.resolvable:
                self.no_success += 1
            rapid = int(t - self.last_fail < RAPID_RETRY_MS)
        elif k == "new_thing":
            self.new_things.append(t)
        elif k == "explore":
            self.explore += 1
        elif k == "help":
            self.help += 1
        elif k == "text_shown":
            self.open_text.append((tid or f"#{i}", chars))
        elif k == "text_closed":
            at = next((j for j, o in enumerate(self.open_text) if o[0] == tid), None) if tid else (0 if self.open_text else None)
            if at is not None:
                self.open_text.pop(at)
        while self.attempts and self.attempts[0] <= t - 30000:
            self.attempts.popleft()
        while self.new_things and self.new_things[0] < t - 10000:
            self.new_things.popleft()
        return {"fail_streak": self.fail_streak, "s_since_success": (t - self.last_success) / 1000,
                "s_since_progress": (t - self.last_progress) / 1000,
                "attempts_30s": len(self.attempts),
                "new_thing_10s": int(bool(self.new_things)),
                "text_chars_on_screen": sum(c for _, c in self.open_text), "s_in_session": t / 1000,
                "explore_so_far": self.explore, "help_so_far": self.help, "rapid_retry": rapid,
                "attempts_no_success": self.no_success}


def build_rows(session, intents=None, moments="from_session"):
    """rows.ts buildRows in Python (labels, weak labels, prev_label from moments)."""
    events = session["events"]
    ms_ = session["moments"] if moments == "from_session" else moments
    weak = ms_ is None
    real = ok_moments(ms_)
    ended = sorted(real, key=lambda m: m["endMs"])
    stages, blocks = stages_of(events, session["game"]), blocks_of(events)
    st, rows = Stepper(resolvable_types(events)), []
    end = play_end_ms(session)
    for i, e in enumerate(events):
        f = st.step(e, i)
        if not in_window(session, e, end):
            continue
        label = "none"
        if weak:
            if f["fail_streak"] >= 3:
                label = "frustrated"
            elif e["kind"] == "idle":
                label = "stuck"
        else:
            best = -1
            for m in real:
                if m["startMs"] <= e["ms"] <= m["endMs"] and m["confidence"] > best:
                    best, label = m["confidence"], m["label"]
        prev = None
        for m in ended:
            if m["endMs"] < e["ms"]:
                prev = m
            else:
                break
        rows.append({"session": session["id"], "game": session["game"], "i": i, "ms": e["ms"], "stage": stages[i],
                     "kind": e["kind"], "type": e["type"], **f, "label": label, "weak_labels": int(weak),
                     "kid": session["kid"], "block": blocks[i], "prev_label": prev["label"] if prev else "none",
                     "s_since_moment": (e["ms"] - (prev["endMs"] if prev else 0)) / 1000,
                     "intent": (intents or {}).get(e["type"], "none")})
    return rows
