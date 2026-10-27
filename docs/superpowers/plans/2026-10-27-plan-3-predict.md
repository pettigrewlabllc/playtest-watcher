# Playtest Watcher Plan 3: Predict — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From any set of session folders, build each player's fingerprint, reaction model and persona; predict how a player will react to a recording of a game they haven't played, with four predictors; score predictions against real sessions (leave-one-game-out plus the frozen check round, normalized by the replay ceiling); and show it all in a viewer the demo video is filmed from.

**Architecture:** Node stages in `src/predict/` read session folders produced by Plans 1 and 2 and write per-player outputs under `recordings/players/<letter>/`. The reaction model is Python (scikit-learn) in `analysis/`, called from Node with `execFile`, exchanging JSON/CSV files. Scoring and video scripts are the only code that reads `study.json`. The viewer is static pages served by the existing server.

**Tech Stack:** Node 26 + Vitest; Python 3 in a uv venv at `analysis/.venv` (gitignored) with scikit-learn, pandas, joblib, pytest; Muse Wonder via the Plan 2 Meta client.

Spec: `docs/superpowers/specs/2026-10-27-playtest-watcher-design.md` sections 1 (grain, Stanford borrowings), 3 (units 10–16), 3a. Plan 2's `src/meta/client.ts` and `src/watch/*` types are the inputs.

## Global Constraints

- Inputs per session folder: `session.json` (`kid`, `game`, `round` in `learn|replay|check|reference`), `aligned.json`, `transcript.json`, `moments.json`, optional `recordings/kids/<letter>/questionnaire.json`. A session without media (events only) must still work: fingerprint and model use events; moments may be missing, in which case labels come only from events (`fail` streak and `idle` heuristics, flagged `weak_labels: true`).
- Outputs live in `recordings/players/<letter>/` (gitignored). Nothing about a kid is committed.
- Matching predictions to reality is by **game stage and event type**, never wall-clock time. A stage is the game's own progress unit (level, wave, rush/audit), taken from the most recent `progress` event's `level | wave | season | name` field.
- The four predictors are `baseline`, `questionnaire`, `persona`, `model`. Predictions for check sessions are **frozen**: written to `recordings/predictions/<checkSessionId>/<predictor>.json` and their SHA-256 hashes committed to `docs/frozen-predictions.md` (hashes only, no content) before the check session is recorded.
- Never call it a personality profile. Code names: `fingerprint`, `persona`, `player`, `reaction`.
- All Meta calls go through Plan 2's client (budget guard, fake mode default).

## File structure

```
analysis/
  requirements.txt       scikit-learn, pandas, joblib, pytest
  features.py            event rows -> feature matrix (pure)
  train.py               CLI: train per-player model, leave-one-session-out CV, importances
  predict.py             CLI: model + feature rows -> per-row label probabilities
  tests/test_features.py, tests/test_train.py
src/predict/
  stages.ts              stage(event, prev events) helper shared by fingerprint, features, scoring
  rows.ts                session -> feature rows CSV (one row per event, labels from moments)
  fingerprint.ts         session -> fingerprint; player -> averaged fingerprint + said-vs-did
  model.ts               Node wrapper around analysis/train.py and predict.py
  persona.ts             three expert lenses + synthesis (Muse Wonder) -> persona.json, persona.md
  predict.ts             four predictors -> prediction JSON keyed by stage
  score.ts               prediction vs real moments -> recall/precision; LOGO folds; replay ceiling
  types.ts               player types: k-means on fingerprints, nearest-type for thin players
  forget.ts              npm run forget -- <letter>
  run.ts                 npm run predict -- <command> ...
public/
  view.html              session viewer
  players.html           personas, fingerprints, said-vs-did, predictor scoreboard
tests/predict/
```

---

### Task 1: Stages and feature rows

**Produces:** `stageOf(events, i): string` (the stage at event `i`); `sessionRows(dir): Promise<Row[]>`, `writeRowsCsv(rows, file)`.
```ts
type Row = { session: string; game: string; i: number; ms: number; stage: string; kind: string; type: string;
  fail_streak: number; s_since_success: number; s_since_progress: number; attempts_30s: number;
  new_thing_10s: 0|1; text_chars_on_screen: number; s_in_session: number; explore_so_far: number; help_so_far: number;
  label: 'confused'|'stuck'|'bored'|'frustrated'|'delighted'|'none' };
```
- `label`: the label of the `ok` moment (confidence ≥ 0.5) whose window covers `ms`, else `none`. With no `moments.json`: `frustrated` if `fail_streak ≥ 3`, `stuck` on `idle` events, else `none`, and every row gets `weak_labels: 1`.
- `text_chars_on_screen`: sum of `chars` of `text_shown` events not yet closed.
- [ ] Tests on a hand-written 30-event session: each feature's value at chosen indexes; stage changes on `progress`; labels from overlapping moments; weak-label fallback. Commit.
- Changed during build: `Row` also carries `weak_labels: 0|1` (a CSV column, not a model feature). `stageOf` returns the bare field value as a string (`'3'`, `'w3'`) and `'start'` before any progress event; the `progress` event itself already belongs to the new stage. Overlapping moments: highest confidence wins. Weak labels check `frustrated` before `stuck`. Input types (`Aligned`, `Moment`, `Transcript`, `loadSession`) live in `src/predict/inputs.ts`, copied from Plan 2; reconcile at merge. `text_closed` is matched to `text_shown` by `data.id`, else first-in-first-out.

### Task 2: Fingerprint and said-vs-did

**Produces:** `sessionFingerprint(dir): Promise<Fingerprint>`, `playerFingerprint(letter, sessionDirs): Promise<PlayerFingerprint>`.
```ts
type Fingerprint = { fail_streak_before_negative: number|null; recovery_s: number|null; explore_share: number; read_share: number|null;
  read_dwell_per_100: number|null; attempts_per_min: number; hesitation_new_s: number|null; help_per_fail: number|null;
  first_touch_main_share: number|null; talk_per_min: number|null; reaction_mix: Record<string, number> };
type PlayerFingerprint = { letter: string; sessions: string[]; mean: Fingerprint; perGame: Record<string, Fingerprint>;
  said: Record<string, number|null>; did: Record<string, number|null>; gaps: { axis: string; said: number; did: number; note: string }[] };
```
- Definitions are exactly spec section 3a. `read_share`: `text_closed` at least `chars / 15` seconds after its `text_shown`.
- `did` maps fingerprint fields onto the seven questionnaire axes on the same -1..+1 scale (explore: `explore_share` z-scored against all players then clamped; read: `read_share`; persist: `fail_streak_before_negative` and `recovery_s`; pace: `attempts_per_min` and `hesitation_new_s`; social: `talk_per_min`; challenge and look: `null` unless derivable, never invented). `gaps` lists axes where `|said - did| ≥ 0.75`.
- [ ] Tests on synthetic sessions with known answers for every field; an events-only session yields nulls where data is missing, never NaN. Commit.
- Changed during build: `playerFingerprint(letter, sessionDirs, population?)` takes an optional list of other players' mean fingerprints for the z-scores; with fewer than 3 it falls back to fixed priors for ages 8 to 14 (`PRIORS` in `fingerprint.ts`). Every mappable axis is z-scored this way, not just explore. Sign follows the questionnaire (-1 is the A end: explore, read, stick with it, show, fast), so a high explore z gives a negative `did.explore`. `fail_streak_before_negative` is the max streak inside the first frustrated/bored moment's window (weak-label session: the streak at the first weakly labeled row). A `first_touch` counts as main when `data.main === true` or `data.target` starts with `main`; this is a convention Plan 1's snippet doesn't yet set, so the games need `data-pw="main..."` on the main action. `said` is read from `recordings/kids/<letter>/questionnaire.json` next to the session folders.

### Task 3: Python reaction model

**Setup:** `uv venv analysis/.venv && uv pip install -p analysis/.venv -r analysis/requirements.txt`. Add `analysis/.venv/` to `.gitignore`.

**Produces:**
- `train.py --rows rows.csv --out model_dir` → `model.joblib`, `cv.json` (`{ folds: [{ held_out_session, macro_f1, per_label }], mean_macro_f1, chosen: 'hgb'|'logreg', logreg_mean_macro_f1, hgb_mean_macro_f1 }`), `importances.json` (top 10 by permutation importance on the held-out folds).
- `predict.py --model model_dir --rows rows.csv --out probs.csv` (one row per input row: `i, stage, p_confused, ..., p_none`).
- `features.py`: one-hot `kind`; numeric features as-is; `game`, `session`, `type` are **not** features (the model must transfer across games).
- CV: leave-one-session-out. Model choice: `HistGradientBoostingClassifier(class_weight='balanced', max_depth=3)` vs `LogisticRegression(class_weight='balanced', max_iter=2000)` on standardized features; choose HGB only if its mean macro-F1 beats logreg by ≥ 0.02.
- [ ] pytest: a synthetic stream with a planted rule ("frustrated when fail_streak ≥ 4, else none", 3 sessions × 400 rows) is recovered with macro-F1 > 0.8 and `fail_streak` is the top importance; a dataset with one class only exits with a clear error; `predict.py` output rows match input rows. Commit.
- Changed during build: the venv installed cleanly on Python 3.15 (scikit-learn 1.9.1, pandas 3.1.0), no 3.12 fallback needed. With a single training session there is no CV: `folds` is empty, the mean scores are `null`, and logreg is chosen. A CV fold whose training split has one class predicts that class. Wrapper options take `{ root }` to point at a temp recordings dir; default `recordings/`. Model files go in `recordings/players/<letter>/model/`, rows in `players/<letter>/rows.csv`.

**Node wrapper (`model.ts`):** `trainPlayer(letter, sessionDirs)` writes rows and calls `train.py`; `predictRows(letter, rowsCsv)` calls `predict.py`. Vitest with the real venv (skipped with a clear message if the venv is absent).

### Task 4: Persona with expert lenses

**Produces:** `buildPersona(letter, sessionDirs, client): Promise<Persona>`, writes `persona.json` and `persona.md`.
- Three `muse-wonder-1.0` calls, schema `lens`, one per lens: **game designer** (what hooks and loses them, difficulty tolerance), **learning scientist** (how they figure things out, reading vs trying, persistence), **UX researcher** (where interfaces trip them, what they touch first, their tells). Each gets: fingerprint (mean and per game), said-vs-did gaps, top reaction-model importances, and up to 40 moments (label ≠ none, highest confidence first, with game context and evidence). Each returns `{ observations: { claim, evidence: string[] }[] }`; evidence items must be moment ids or fingerprint field names.
- One synthesis call, schema `persona`: `{ summary, tolerances: { fail_streak, recovery_s, idle_before_bored_s }, reads, explores, delights: string[], confuses: string[], tells: { stuck, bored, delighted }, said_vs_did: string[], predictions_guidance: string }`, keeping the lens observations under `lenses`.
- Validation: drop any observation whose evidence ids don't exist (log how many). The markdown never uses the word "personality".
- [ ] Tests with the fake client: four calls in order, evidence validation drops fabricated ids, markdown renders and contains no "personality". Commit.
- Changed during build: moment ids are qualified as `<sessionId>:<momentId>` (ids like `c001` repeat across sessions); evidence must use that form or a `Fingerprint` field name, and an observation with any unknown evidence item, or none, is dropped. Options are `{ root?, dir?, log? }` (`dir` is an explicit player output dir, used by leave-one-game-out folds). The word "personality" is scrubbed to "play style" in anything the model returns, as a belt on top of the prompt wording. Fake client now answers `lens`, `persona`, `prediction`. `inputs.ts` now re-exports the Plan 2 types (`Aligned`, `AlignedEvent`, `Moment`, `Label`, `LABELS`, `Transcript`) from `src/watch/`.

### Task 5: Four predictors

**Produces:** `predictSession(letter, targetSessionDir, client, predictors?): Promise<Record<Predictor, Prediction>>`.
```ts
type Prediction = { predictor: string; target: string; items: { stage: string; event_type: string; label: string; p: number; why: string }[] };
```
- The target is any session folder of the game to predict (a `reference` playthrough, a bot run, or another player's session); only its `aligned.json` events (and screen frames at stage starts, as text descriptions from its `moments.json` if present) are used, **never the target player's own moments**.
- `baseline` / `questionnaire` / `persona`: one Wonder call each, schema `prediction`, given the target's stage list and event summary per stage, plus respectively: "a child aged 8 to 14", the 12 answers with question text, or `persona.json`. Ask for at most 2 predicted reactions per stage, each with `p`.
- `model`: rows from the target session, `predictRows`, then per stage the label with the highest mean probability if it's not `none` and its mean `p ≥ 0.35`, plus any single row with `p ≥ 0.7` (its stage and event type).
- [ ] Tests: fake client returns canned predictions; the `model` predictor on a synthetic target with a planted fail streak predicts `frustrated` at that stage; the target's own moments are never read (spy on file reads). Commit.

### Task 6: Scoring, leave-one-game-out, replay ceiling

**Produces:** `scorePrediction(pred, realSessionDir): Score`, `logo(letter, client): Promise<LogoReport>`, `replayCeiling(sessionA, sessionB): Score`, `scoreboard(study): Promise<Scoreboard>`.
- Match: a real moment (ok, label ≠ none, confidence ≥ 0.5) is **hit** if the prediction has the same label at the same stage, or the same label at an adjacent stage with the same `event_type`. Recall = hits / real moments; precision = predicted items that match a real moment / predicted items. Also report label-mix similarity (1 - total variation distance between predicted and real label mixes) because it's robust when stage counts differ.
- `logo`: for each game the player has learn sessions in, rebuild fingerprint, model and persona **without** that game, predict that game's learn session, score. Persona and model rebuilt per fold (cache by fold key).
- `replayCeiling`: score the earlier session's real moments as if they were predictions for the later replay.
- `scoreboard`: reads `study.json` (`{ players: { A: { learn: [...], check: 'game', replay?: 'game' } }, frozen: { [checkSessionId]: { [predictor]: sha256 } } }`); verifies each frozen file's hash before scoring and refuses on mismatch; outputs per player, per predictor: LOGO recall/precision/mix, check-round recall/precision/mix, and normalized = recall / ceiling where a ceiling exists.
- [ ] Tests: hand-built prediction vs moments gives the exact recall/precision; adjacency rule; a tampered frozen file is refused; LOGO excludes the held-out game from fingerprint, rows and persona inputs (spy). Commit.

### Task 7: Player types (supported, not headlined)

**Produces:** `playerTypes(fingerprints, k?)`: standardize fingerprint fields, k-means (k = min(3, players - 1), deterministic seed), returns centroids with plain names from their most extreme fields, and `nearestType(fp)`. With fewer than 6 players it returns types with `confidence: 'illustrative'`.
- [ ] Tests on synthetic fingerprints in two obvious clusters. Commit.
- Changed during build: `nearestType` takes the fitted model too, `nearestType(model, fp)`, since it needs the centroids and scaling. Missing fingerprint fields count as the average (z = 0). Types are named from their two most extreme standardized fields (|z| >= 0.5). Initialisation is farthest-point from the first player, so results depend on player order but are repeatable. `confidence` is on the result, not each type.

### Task 8: CLI, freezing, forget

- `npm run predict -- fingerprint <letter>` | `train <letter>` | `persona <letter>` | `predict <letter> <targetSessionId>` | `freeze <letter> <targetSessionId> <checkLabel>` | `logo <letter>` | `scoreboard`.
- `freeze` runs all four predictors into `recordings/predictions/<checkLabel>/`, then appends the hashes to `docs/frozen-predictions.md` and `study.json`, and commits that doc with message `Freeze predictions for <checkLabel>` (hashes only).
- `npm run forget -- <letter>`: deletes `recordings/kids/<letter>`, `recordings/players/<letter>`, every session folder with that kid, and any predictions for them; asks for the letter typed twice; prints what it removed.
- [ ] Tests for freeze (hash written, file content unchanged) and forget (in a temp recordings root). Commit.

### Task 9: Viewer and players page

- `view.html?s=<sessionId>`: three video panes (face pane plays `clips/blurred/*.mp4` only; whole-session face video is never served), hands and screen synced by `offsetMs`, a timeline with coloured moment markers (click to seek), the kid's transcript beside it, the fix list. For a check session, a lane per predictor above the real-moment lane, aligned by stage.
- `players.html`: per player, the persona summary, fingerprint bars, said-vs-did gaps, top model features, and the scoreboard table (LOGO and check, raw and normalized), with player types marked illustrative.
- Server: add read-only `GET /api/sessions/:id/file/<name>` for whitelisted names (`aligned.json`, `moments.json`, `fixes.md`, `transcript.json`, `hands.mp4`, `screen.mp4`, `clips/blurred/<id>.mp4`) and `GET /api/players` (scoreboard + personas). **Never** `face.webm`, `face.mp4` or unblurred clips. Tests assert those are 404.
- Copy on these pages goes through `joel-voice` and Joel's sign-off.
- [ ] Verify in the browser at 1280 px with a synthetic session; screenshot for Joel. Commit.
