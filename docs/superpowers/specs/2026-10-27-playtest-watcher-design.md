# Playtest Watcher: design

Date: 2026-10-27. Status: draft for Joel's review.
Hackathon: Meta Global AI Developer Hackathon. Submission due **Wed Nov 4, 9:00 PM ET (7:00 PM MT)**.
Read `BRIEF.md` first for the backstory and constraints.

## 1. What we are proving

Watching playtest recordings is the bottleneck. Playtest Watcher records a kid playing (face, hands, voice, screen, game events), finds the moments that matter, writes the fix list, builds a persona of each kid from real play, and then **predicts how that kid will react to a game they have never played** before checking against the real session.

The deliverable is a measured result, not a claim: across 4 kids and 4 held-out games, what share of real reaction moments did each persona predict, compared with a generic "a kid" baseline?

### The experiment

Four games, four kids. Every kid plays three games for 10 minutes each (learning sessions). Each kid sits out a different game, so every game is predicted and checked exactly once.

| | Factor Slicer | Bond Swap | Hoard Keeper | Current Cut |
|---|---|---|---|---|
| Kid A | learn | learn | learn | **check** |
| Kid B | learn | learn | **check** | learn |
| Kid C | learn | **check** | learn | learn |
| Kid D | **check** | learn | learn | learn |

12 learning sessions plus 4 check sessions, about 160 minutes of kid time. The kid-to-letter mapping lives only in `recordings/kids.json` (gitignored). **The public repo never contains the kids' names, faces, or voices.**

Each held-out game also needs one **reference playthrough**: Joel (or the game's balance bot, where one exists) plays it for about 10 minutes with the event log on. The persona predicts from this, before the kid plays.

### Success criteria

1. A 10-minute session goes in and a moment timeline plus fix list comes out, without hand editing.
2. Four personas, each citing the moments it was built from.
3. Four predictions scored against the real check sessions, with recall and precision for both the persona and the generic baseline.
4. A viewer that plays face (blurred), hands, and screen in sync with the timeline. The demo video is filmed from it.

## 2. Meta models used (checked against dev.meta.ai/docs/models, 2026-10-27)

| Job | Model | Notes |
|---|---|---|
| Speech to text | `muse-voice-transcribe-1.0`, file API `POST /v1/asr/transcribe` | Turn-level timestamps and speaker diarization (kid vs Joel). No word-level timestamps. |
| Explain a moment from a clip | `muse-spark-1.2` | Takes video and audio. 1.3 is newer, but its docs say audio understanding is degraded, so we use 1.2 when the clip has sound. |
| Fix lists, personas, predictions | `muse-wonder-1.0` | Text synthesis over structured moment data. No video needed. |
| Hand tracking and face blur | `sam-3.1` via the Responses API | Text prompts ("hand", "face") return masks and track them across video frames. |
| Stretch: open-weight bonus prize | Muse Spark Open via Baseten or Modal | Only if credits arrive and time allows. Same prompt as Spark 1.2 for moment explanation. |

**Never use a `-contributor` model ID.** Contributor mode may train Meta's models on the content, and this content is kids' faces and voices. The API client refuses any model ID containing `contributor`.

Pricing was not on the public docs page. The first real call measures tokens and cost for one 15-second clip, and the budget guard (section 6) uses that figure.

## 3. Architecture

A local web app on Joel's laptop (option A from brainstorming). One Node server on **port 3058** serves the recorder and viewer pages, receives recordings and game events, and runs the pipeline. Stack: Node 22, TypeScript, Vite + React for the two pages, ffmpeg for media work. This matches the rest of the fleet.

```
recorder page ──chunks──▶ server ──▶ recordings/<session>/   (raw, local only)
games ──────────events──▶ server ──▶ recordings/<session>/events.jsonl
                                          │
                              pipeline (per session, cached per stage)
             align ▶ transcribe ▶ candidates ▶ explain ▶ fix list
                                          │
                     persona (per kid) ▶ predict (per held-out game) ▶ score
                                          │
                                   viewer page (blurred)
```

### Units

Each unit is one module with one job, reading and writing JSON files in the session folder so any stage can be rerun alone.

1. **Recorder page** (`/record`). Picks kid, game and round (learn or check). Opens camera 1 (face), camera 2 (hands, pointed at the desk), the mic, and a screen or window share. Records each with its own `MediaRecorder` (WebM), sends 1-second chunks to the server, and writes `manifest.json` with each track's start time in epoch ms. Shows four live previews and a big Start/Stop.
2. **Game event bridge.** Each game sends `{t, type, data}` events (t in epoch ms) to `POST /events/<session>`. The server stamps arrival time with its own clock as well, so a game running on the iPad lines up with the laptop's recordings without trusting the iPad's clock. The extra network delay (under 100 ms on home Wi-Fi) is negligible at moment scale.
   - Factor Slicer, Bond Swap, Hoard Keeper: a small `playtest-log.js` added to each game, active only when the URL has `?playtest=<session>`. Off by default, never in a store build.
   - Current Cut (Godot): a GDScript autoload doing the same over HTTP, enabled by a command-line flag. Laptop only.
3. **Align** (ffmpeg). Trims every track to a shared session clock, exports a 16 kHz WAV of the mic, and makes low-res proxies for analysis (480p, 5 fps for video sent to Spark).
4. **Transcribe.** Sends the WAV to Muse Voice Transcribe, then saves `transcript.json` (turns, speaker, start/end).
5. **Candidates** (local rules, no model calls). Marks windows worth a look:
   - from events: a retry or death, the same action repeated quickly, a long gap with no input (over 8 s), a quit or back-out, a level cleared fast;
   - from speech: any kid utterance, and loudness spikes (laughs, groans);
   - plus a sweep window every 60 s, so a silent, bored stretch is still looked at.
   Overlapping windows merge. Each window is 6 s before the trigger to 8 s after.
6. **Explain.** For each candidate, one Muse Spark 1.2 call. It gets a composite clip (face, hands and screen side by side, 480p, 5 fps, with audio), the transcript lines, and the game events in that window. It returns structured JSON:
   `{label: confused|stuck|bored|frustrated|delighted|none, confidence, evidence: {face, voice, hands, screen}, game_context, fix_hint}`.
   Results labelled `none`, or below a confidence threshold, are kept but hidden.
7. **Hands** (SAM 3.1). On the hands camera, tracks "hand" and "finger" through each moment clip, so the explanation can say where the kid tapped against what was on screen. Used only inside moment windows to keep cost down.
8. **Blur** (SAM 3.1 plus ffmpeg). Segments "face" on the face camera and writes a blurred copy. **The viewer and every export read only blurred files.** Unblurred video never leaves `recordings/`.
9. **Fix list.** One Muse Wonder call per session: moments in, a ranked fix list out (`fixes.md`), each item linked to its moment timestamps.
10. **Persona.** After a kid's three learning sessions, one Muse Wonder call builds `persona.json` plus a readable `persona.md`. It covers patience before giving up, how much they read, what delights them, what confuses them, and their tells (what their face and voice do when stuck), and every trait cites moment IDs as evidence.
11. **Predict.** Given a persona and a held-out game's reference playthrough (its events, transcript-free, plus screen proxy frames at key events), Muse Wonder predicts reactions **keyed to game events and stages, not clock time**, because the kid's run will not follow the same timing. Output: `prediction.json`, a list of `{stage_or_event, predicted_label, why}`. The same call is also run with a generic "a child aged 8–14" persona as the baseline.
12. **Score** (local, no model calls). Matches the kid's real moments to predictions by game stage or event type and label. Reports recall (real moments that were predicted), precision (predictions that happened), for persona and baseline, per kid and overall. This is the number at the end of the video.
13. **Viewer page** (`/view/<session>`). Synced three-pane playback (blurred face, hands, screen), a timeline with coloured moment markers, a transcript, the fix list, and for check sessions, prediction vs real shown side by side. Also a `/personas` page.

## 4. Capture setup and the two-camera risk

Joel has two cameras and a mic. Two USB cameras on one Mac usually work in Chrome, but they can fail when both share one USB bus at high resolution, and Chrome sometimes reports two identical camera names.

**Day-one spike (Tue Oct 27–Wed Oct 28), before anything else is built:** a bare page that opens both cameras, the mic and a screen share, records 10 minutes, and reports dropped frames and file sizes. Settings to start from: face camera 720p at 30 fps, hands camera 640x480 at 30 fps.

- If both cameras record cleanly: carry on with option A.
- If not, try in order: plug the cameras into different ports or hubs, then lower the resolution, then fall back to **OBS** recording one combined canvas (option C), with a clap or on-screen flash at the start to line it up with the game log.

**iPad play:** the iPad plugs into the Mac by cable and QuickTime's "Movie Recording" with the iPad as the source mirrors its screen. The recorder captures that window with the screen share. The games run from the laptop's server over Wi-Fi, so their events reach the laptop directly. If mirroring is flaky, the hands camera still shows the iPad screen well enough, and the event log carries the exact game state.

**Game devices:** Factor Slicer, Bond Swap and Hoard Keeper on the iPad. Current Cut on the laptop.

## 5. Privacy

- Raw recordings stay in `recordings/`, which is gitignored with every video and audio extension already blocked.
- Only short moment clips and session audio go to the Meta API, in standard mode only. Uploaded files are deleted through the Files API once their analysis is cached.
- Faces are blurred by SAM 3.1 before anything reaches the viewer, a screenshot, or the demo video.
- The repo is public under the hackathon rules. It holds code, prompts, and synthetic fixtures only. Kids are Kid A–D everywhere in the repo.
- Nothing goes in the demo video or the X post without Joel's sign-off.

## 6. Cost and failure handling

- **Budget guard.** The API client logs estimated cost per call to `spend.jsonl` and stops at a configurable cap (default $120 of the $150 credit). The pipeline runs in dry-run mode, with a fake model client and fixtures, until the credits show on the Billing page. A real call before then needs Joel's OK, since it would charge the card.
- **Cached stages.** Every stage writes its output file, and a rerun skips stages whose output exists, so a crash midway costs nothing to resume.
- **API failures.** Three retries with backoff, then the moment is marked `unanalyzed` and the session carries on. The viewer shows unanalyzed moments in grey.
- **Missing game events.** If a game sends no events, candidates fall back to speech, loudness and the 60-second sweep, and the session is flagged as weaker data.

## 7. Testing

- **Unit tests** (Vitest) for the pure parts: clock alignment, candidate detection, window merging, and the scorer. Fixtures come from the existing Snack Lob play logs (events only, no video).
- **Contract tests** for each model call, run against the fake client: the request is built correctly and malformed model output is handled.
- **End-to-end dry run** on a synthetic session (screen recording of a bot playing, no people) through every stage with the fake client.
- **One live smoke test** on that synthetic session once credits land, before any real kid session is sent.

## 8. Schedule

| Date | Work |
|---|---|
| Tue Oct 27 | Spec signed off. Camera spike. |
| Wed Oct 28 | Recorder, server, event bridge in the three web games. |
| Thu Oct 29 | Current Cut event autoload. Align, transcribe, candidates. **First learning sessions.** |
| Fri Oct 30 | Explain, hands, blur. Live smoke test if credits have landed. |
| Sat Oct 31–Sun Nov 1 | Remaining learning sessions (12 in total). Fix lists. Viewer. |
| Sun Nov 1 | Personas. Reference playthroughs of all four games. |
| Mon Nov 2 | Predictions written and frozen (committed with a timestamp) **before** the check sessions. Check sessions. |
| Tue Nov 3 | Scoring, viewer polish, last day for organiser questions. |
| Wed Nov 4 | Cut the 3-minute video, write the submission page, submit by 7:00 PM MT. |

Freezing predictions in git before the kids play the check games is what makes the result believable.

## 9. Out of scope

Live analysis during play. Personas controlling the game. More than four kids or four games. Cloud hosting. Any store build changes beyond the event log flag. Muse Image (unless a spare hour remains, for persona portraits that are clearly not the kids).

## 10. Open items for Joel

- **Track:** Indie or Startup. Check what the application says on the Cerebral Valley submission page.
- **Kid to letter, and which game each kid sits out.** The matrix above is a placeholder.
- **Reference playthroughs:** Joel plays each of the four games for 10 minutes, or uses the balance bot where a game has one.
