# Playtest Watcher: design

Date: 2026-10-27. Status: draft for Joel's review.
Hackathon: Meta Global AI Developer Hackathon. Submission due **Wed Nov 4, 9:00 PM ET (7:00 PM MT)**.
Read `BRIEF.md` first for the backstory and constraints.

## 1. What we are proving

Watching playtest recordings is the bottleneck. Playtest Watcher records a kid playing (face, hands, voice, screen, game events), finds the moments that matter, writes the fix list, builds a persona of each kid from real play, and then **predicts how that kid will react to a game they have never played** before checking against the real session.

The deliverable is a measured result, not a claim: across 4 kids and 4 held-out games, what share of real reaction moments did each predictor catch? Three predictors are compared: a generic "a kid" baseline, the written Muse Wonder persona, and a per-kid reaction model trained on that kid's own play (section 3a).

**Framing rule.** This is a *player behavior model for game design*, built from how a kid plays. It is never called a personality profile or personality analysis, anywhere: code, copy, video, or submission. The hackathon lists "Personality Analyzers" as an anti-project.

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
2. Four personas, each with a play fingerprint (measured numbers), questionnaire answers, and a written profile citing the moments it was built from.
3. Four predictions scored against the real check sessions, with recall and precision for all three predictors.
4. A viewer that plays face (blurred), hands, and screen in sync with the timeline. The demo video is filmed from it.

### Grain: the session, not the study

The system knows only **sessions**: one player, one game build, an event stream, and optionally media, transcript and questionnaire. The 4x4 round-robin above is one study, written down in `study.json` (who plays what, which sessions are frozen checks) and read only by the scoring and video scripts. Nothing else in the code knows about it.

- **Three stages, each usable alone:** capture (recorder plus game logger) writes a session folder; watch (Plan 2) turns a session folder into moments; predict (Plan 3) turns any set of session folders into fingerprints, models, personas and predictions. A developer without cameras can skip capture and watch, and feed predict with game events only.
- **Personas update after every session.** One session gives a rough fingerprint; each new one sharpens it.
- **Evaluation is automatic leave-one-game-out:** for each player and each game they played, hide that game, predict it from the rest, and score. Four kids by four games gives 16 folds from the same recordings, on top of the 4 frozen check sessions that guard against fooling ourselves.
- **Player types** (clusters of fingerprints, with nearest-type matching for a player who has little data) are supported in code but presented as what happens at scale. Four players is too few to discover types, and the demo says so.

### What we borrow from Stanford's 1,052-person agents study

Park et al. 2024 (arXiv 2411.10109) built agents of 1,052 real people from 2-hour interviews and scored them against the people's own answers. Four of its methods carry over:

1. **Score against the kid's own consistency, not 100%.** People don't answer identically twice; the study reports accuracy as a share of each person's two-week test-retest agreement (agents reached 85% of it). We do the same: two kids replay one of their learning games on a later day (a **replay** round, 10 minutes each), and the reaction mix and moment positions between their two plays of that game are the ceiling. Predictions are reported as raw recall and as a share of that ceiling.
2. **The baselines that matter.** The study's interview agents beat agents given only demographics and agents given a short self-written paragraph. Our predictors line up with that exactly, so we run four, not three: `baseline` (age only, like demographics), `questionnaire` (the kid's 12 answers only, like the self-written paragraph), `persona` (built from observed play, like the interview), and `model` (the per-kid reaction model). If observed play beats self-report for kids too, that's the headline.
3. **Expert lenses.** The study had an LLM read each transcript as a psychologist, an economist and a sociologist, and kept those readings in the agent's memory. Our persona builder reads the sessions through three lenses, a game designer, a learning scientist and a UX researcher, one Muse Wonder call each, and the persona keeps all three.
4. **Consent and audit.** The study's agents aren't public, every use is logged, and people can withdraw. Ours: personas stay in `recordings/`, every model call that touches a kid's data is in `spend.jsonl` with the session id, and `npm run forget -- <kid>` deletes everything for that kid (recordings, personas, models, Meta file uploads still alive).

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
10. **Questionnaire** (`/questions`). Twelve two-choice questions per kid, answered once before their first session, scored onto seven play axes. Questions and scoring: `docs/questionnaire.md`. Saved to `recordings/kids/<letter>/questionnaire.json`.
11. **Fingerprint** (local, no model calls). Computes the play fingerprint per session and per kid from events, moments and transcript. See section 3a.
12. **Reaction model** (local, Python). Trains one model per kid on that kid's learning sessions. See section 3a.
13. **Persona.** After a kid's three learning sessions, one Muse Wonder call builds `persona.json` plus a readable `persona.md` from the fingerprint, the questionnaire, the reaction model's strongest features, and the moments. It covers patience before giving up, how much they read, what delights them, what confuses them, how they explore, and their tells (what their face and voice do when stuck). Every trait cites fingerprint numbers or moment IDs as evidence, and it calls out where what the kid said differs from what they did.
14. **Predict.** Given a held-out game's reference playthrough, three predictors each produce `prediction-<name>.json`, a list of `{event_index, stage, predicted_label, p, why}` **keyed to game events and stages, not clock time**, because the kid's run will not follow the same timing:
    - `baseline`: Muse Wonder with a generic "a child aged 8–14" profile;
    - `questionnaire`: Muse Wonder with only the kid's 12 answers;
    - `persona`: Muse Wonder with the kid's persona;
    - `model`: the kid's reaction model run over the reference playthrough's feature rows.
15. **Score** (local, no model calls). Matches the kid's real moments to each predictor's predictions by game stage and label. Reports recall (real moments that were predicted) and precision (predictions that happened) for all three predictors, per kid and overall. This is the number at the end of the video.
16. **Viewer page** (`/view/<session>`). Synced three-pane playback (blurred face, hands, screen), a timeline with coloured moment markers, a transcript, the fix list, and for check sessions, prediction vs real shown side by side. Also a `/personas` page.

## 3a. Play fingerprint and reaction model

Four kids is too few to train anything *across* kids, and three sessions is not a time series, so neither Prophet nor a cross-kid random forest fits. The data that is plentiful is **events within a session**: a 10-minute session logs hundreds of them. So the modelling happens at event level, per kid, with features that mean the same thing in every game.

### Game-agnostic event schema

Every game maps its own events onto shared kinds, in addition to its game-specific ones. Each logged event carries `kind` in `data`:

| kind | Meaning | Examples |
|---|---|---|
| `attempt` | the player tries the main action | slice, swap, file item, cut wire |
| `success` / `fail` | the attempt worked or didn't | correct slice / wrong cut |
| `progress` | a level, wave or round ends | `level_end`, `wave_start` |
| `explore` | anything off the main path | open Compendium, menu, settings, tap a decoration |
| `text_shown` / `text_closed` | a block of reading appears / goes away, with `chars` | hint, lesson card, instructions |
| `help` | the player asks for help | hint, Stir, undo |
| `new_thing` | something appears for the first time in this session | new atom, new part, new blade |
| `first_touch` | the first input after a new screen appears, with what was touched | |
| `idle` | no input for 8 s (logged by the snippet itself) | |
| `quit` | back out or close | |

### Fingerprint (one vector per session, averaged per kid)

Fail streak before the first frustrated or bored moment. Recovery time: seconds from a `fail` to the next `attempt`. Exploration share: `explore` events over all events. Reading: share of `text_shown` closed after enough time to read it (about 15 chars per second for this age), and median dwell per 100 chars. Pace: attempts per minute. Hesitation: median gap before acting on a `new_thing`. Help seeking: `help` per `fail`. First-touch habit: share of `first_touch` on the main action vs. elsewhere. Talk rate: kid utterances per minute (from the transcript). Reaction mix: share of each moment label.

The seven questionnaire axes map onto fingerprint fields (explore/finish to exploration share, read/try to reading, challenge/chill and stick with it/walk away to fail streak and recovery time, fast/careful to pace and hesitation, show/solo to talk rate), and the persona reports each pair side by side.

### Reaction model (per kid)

- **Rows:** one per game event in the kid's learning sessions, roughly 1,000 to 2,000 per kid.
- **Features** (computed at that event, game-agnostic): current fail streak, seconds since last success, seconds since last `progress`, attempts in the last 30 s, `new_thing` in the last 10 s, text on screen (chars), seconds in session, explore events so far, help used so far, the event's `kind`.
- **Label:** the moment label whose window covers the event (`none` if no moment does).
- **Model:** scikit-learn `HistGradientBoostingClassifier` with class weights, checked by leave-one-session-out cross validation (train on two learning sessions, test on the third). A logistic regression runs alongside as a sanity check. If the boosted model doesn't beat logistic regression in cross validation, the simpler one is used.
- **Output:** `model.joblib`, cross-validation scores, and the top features by permutation importance, which feed the persona ("Kid A's frustration tracks fail streak far more than time on task").
- **Prediction:** the reference playthrough's events are turned into the same feature rows. The model gives each row a probability per label, and runs of high probability become predicted moments.

Python 3 with scikit-learn, pandas and joblib, in `analysis/` with its own `requirements.txt`. Everything else stays Node.

## 3b. Player model v1 (the definition the persona rests on)

Added 2026-10-27 after the first four real sessions. The persona is **computed**, not written by a model. Muse does two jobs only: **perception** (labelling what a kid felt in a clip, transcribing what they said) and **narration** (writing the computed model up in words). It never invents a number, and every sentence it writes cites a trait or a moment.

### Four layers

1. **Observations.** Game events (all sessions), labelled moments (Muse Spark, with confidence), transcript turns, the operator's mood tap, the spoken debrief, the questionnaire. Each observation keeps its session, game and time.
2. **Traits.** About ten defined quantities, each computed by a fixed estimator, each carrying an estimate, an uncertainty, how many observations it rests on, and which game(s) it came from. Traits are **game-adjusted**: a raw number is compared with the other kids on the same game (three kids play every game), because a fail streak in Factor Slicer and one in Hoard Keeper don't mean the same thing.
3. **Reaction model.** Predicts P(reaction | situation) from game-agnostic situation features. Trained on **all kids together with a per-kid adjustment** (partial pooling), because one kid's three sessions are too few to fit alone, and the pooled part is what lets a kid's model transfer to a game they haven't played.
4. **Narrative.** Muse Wonder turns layers 2 and 3 into the readable persona (the three expert lenses, then a synthesis). It is the presentation, not the source of truth.

### Traits

| Trait | What it means | Estimator | Evidence |
|---|---|---|---|
| **Frustration tolerance** | How many failures in a row before they get upset | Logistic curve of P(frustrated or stuck moment within 10 s) against current fail streak; report k50, the streak where it crosses 0.5 | fail events, moments |
| **Recovery** | How fast they try again after failing | Median seconds from a fail to the next attempt; plus P(idle or quit within 15 s of a fail) | events |
| **Learning rate** | How quickly they get better within a game | Per run or level, error rate (fails per attempt) against run index; fit a power curve, report the exponent and the first-to-last improvement | runs, fails, attempts |
| **Persistence** | Whether they keep going when it's going badly | Share of runs that start within 20 s of a failed run; total time on a game after their worst run | progress events |
| **Exploration drive** | Pull toward things off the main path | Explore events per minute, game-adjusted; seconds before the first explore event | explore events |
| **Reading** | Whether they read text or skip it | P(text stays open long enough to read it at about 15 characters a second), by text length | text_shown/closed |
| **Pace** | Fast and impulsive versus careful | Attempts per minute (game-adjusted); median pause before acting on something new | attempts, new_thing |
| **Challenge appetite** | What happens when it gets easy | P(bored moment) during success streaks of 5 or more, and when no new_thing for 60 s | successes, moments |
| **Stamina** | How engagement changes over 10 minutes | Slope of negative-moment rate and of attempts per minute across the session, read alongside the mood tap | moments, events, mood |
| **Expressiveness** | Which channels show their reactions | Share of moments where face, voice and hands carried evidence; talk per minute | moment evidence, transcript |

Each trait also has a **said** value where the questionnaire or debrief speaks to it, so the model reports where a kid's own view and their play disagree (one kid said he walks away after losing a lot, then started 11 runs in 9 minutes).

### Uncertainty and updating

Every trait is an estimate with a range, not a label. With little data it's shrunk toward the average of all kids on that game (empirical-Bayes style: the less evidence, the closer to the group), and the range shows it. Each new session updates every trait it has evidence for. The persona page shows the range, and the narrative may not call a trait strong or weak when the range spans the middle.

### Reaction model (replaces the per-kid-only model in 3a)

- Rows: one per game event, from all kids' learning sessions.
- Features: the situation features from 3a (fail streak, seconds since success, seconds since progress, attempts in the last 30 s, new thing in the last 10 s, text on screen, time in session, explore and help so far, event kind), **plus** the kid's trait estimates, **plus** a per-kid indicator interacting with fail streak and time since success.
- Model: L2-regularised multinomial logistic regression, so the per-kid terms are shrunk toward the shared model when a kid has little data. Gradient boosting stays as a challenger and is used only if it wins leave-one-game-out by a clear margin.
- Holding out a game holds out every kid's rows for that game from training, not just the kid being predicted, so the model never sees the target game.

### Revisions from prior work (2026-10-27 review of learner-modelling, affect-detection and persona repos)

1. **Label reliability gate.** Affect-detection research doesn't trust labels until a human agrees with them (BROMP coders need Cohen's kappa ≥ 0.6). Joel hand-labels about 60 moment clips across the kids, blind to Muse's label, in a small labelling page. We report Cohen's kappa between Joel and Muse, overall and per label, before any prediction score, and we say plainly if it's below 0.6.
2. **Two reaction-model variants, never one.** With four kids, a kid's trait values are one constant per kid, so traits and a per-kid indicator measure the same thing and the indicator soaks up the credit. We fit (a) **traits × situation**, which can transfer and makes the persona earn its place, and (b) **kid × situation**, and report both under leave-one-game-out. If (a) keeps up with (b), the traits explain the kid.
3. **Learning rate and skill from the Additive Factors Model** (pyAFM's idea): `logit P(success) = kid + game + game × practice + kid × practice` (kid terms shrunk). The kid term is game-adjusted skill and the kid × practice slope is the learning rate. It replaces the per-kid power-curve fit and the ad hoc "compare with other kids on the same game" step for success-based traits.
4. **Affect dynamics.** A feeling tends to persist and to lead to certain next feelings (D'Mello and Graesser). We add situation features for the previous moment label and seconds since it, a baseline of base rate by time in session plus first-order transitions, and a trait for how often confusion resolves versus turns into frustration.
5. **Wheel-spinning and rapid retries.** Standard indicators from the same literature: attempts less than 1 s after a fail, and N or more attempts with no success. They become situation features and feed persistence.
6. **Simulate the kid's own playthrough.** A reference playthrough has someone else's fail streaks. For prediction we keep its sequence of stages and attempts, but resample each attempt's success from the kid's AFM skill for that game and recompute the situation features, many times over (Monte Carlo), feeding each run through the reaction model. Predicted reactions are the average over runs. This is the knowledge-tracing way round the "someone else's playthrough" problem.
7. **More fidelity measures.** Besides recall and precision: per-label AUC, Cohen's kappa against real moments, a distribution check of predicted versus real reaction mix (TinyTroupe-style), and a **ranking check**: each kid ranks the games they played in the debrief, and the model's predicted enjoyment must put them in the same order (ranks are more reliable than ratings, Yannakakis and Togelius).
8. **Name what's ours.** Frustration tolerance, recovery, reading and persistence follow established estimators. Exploration drive, challenge appetite, stamina and expressiveness are our own, and the write-up says so. Player types cite Drachen et al. 2009 for why they need hundreds of players.

### What the first debriefs taught us (2026-10-27)

The kids' own words changed what some events mean. One kid's single "explore" event was an accidental tap ("What's the compendium? I hit that accidentally"). Another's "gave up" on a question was curiosity ("I just wanted to see what would happen"). A third misread a UI element as a timer that wasn't one. So:

- **Debriefs can relabel intent.** `recordings/kids/<letter>/debriefs.json` holds answers per game, and an answer can carry an `intent` (accidental, curiosity, misread) tied to an event type. Trait estimators discount accidental events (exploration drive), and the persona reports the corrected reading.
- **Debriefs give the "why" logs can't.** Strategies ("I found the first multiple and counted from there"), misreadings and discovered mechanics ("holding my finger down kept the streak alive") go to the persona's evidence and to the fix list as **said** evidence, marked as the kid's words.
- **Fun scores and rankings** from debriefs are the ground truth for the ranking check.

### What this changes in Plan 3

Fingerprint becomes the trait estimators with ranges and game adjustment (plus the new learning rate, persistence, challenge appetite and stamina traits); the reaction model becomes the pooled model; the persona prompts take traits with ranges and must cite them; the debrief and mood feed the said-versus-did comparison.

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

- **Unit tests** (Vitest) for the pure parts: clock alignment, candidate detection, window merging, questionnaire scoring, fingerprint fields, and the scorer.
- **Model tests** (pytest) on synthetic event streams with a planted rule (for example, "bored after 4 fails in a row"): the model must recover it in cross validation and rank fail streak as its top feature. Fixtures come from the existing Snack Lob play logs (events only, no video).
- **Contract tests** for each model call, run against the fake client: the request is built correctly and malformed model output is handled.
- **End-to-end dry run** on a synthetic session (screen recording of a bot playing, no people) through every stage with the fake client.
- **One live smoke test** on that synthetic session once credits land, before any real kid session is sent.

## 8. Schedule

| Date | Work |
|---|---|
| Tue Oct 27 | Spec signed off. Camera spike. |
| Wed Oct 28 | Recorder, server, event bridge (with the shared event kinds) in the three web games. Questionnaire page. Joel signs off the questions. |
| Thu Oct 29 | Current Cut event autoload. Align, transcribe, candidates. **Questionnaires, then first learning sessions.** |
| Fri Oct 30 | Explain, hands, blur. Fingerprint. Live smoke test if credits have landed. |
| Sat Oct 31–Sun Nov 1 | Remaining learning sessions (12 in total). Fix lists. Viewer. Reaction model. |
| Sun Nov 1 | Personas. Reference playthroughs of all four games. |
| Mon Nov 2 | All three predictors run and frozen (committed with a timestamp) **before** the check sessions. Check sessions. |
| Tue Nov 3 | Scoring, viewer polish, last day for organiser questions. |
| Wed Nov 4 | Cut the 3-minute video, write the submission page, submit by 7:00 PM MT. |

Freezing predictions in git before the kids play the check games is what makes the result believable.

## 9. Out of scope

Live analysis during play. Personas controlling the game. More than four kids or four games. Cloud hosting. Any store build changes beyond the event log flag. Muse Image (unless a spare hour remains, for persona portraits that are clearly not the kids).

## 10. Open items for Joel

- **Track:** Indie or Startup. Check what the application says on the Cerebral Valley submission page.
- **Kid to letter, and which game each kid sits out.** The matrix above is a placeholder.
- **Reference playthroughs:** Joel plays each of the four games for 10 minutes, or uses the balance bot where a game has one.
