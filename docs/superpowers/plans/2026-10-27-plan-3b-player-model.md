# Plan 3b: Player model v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. TDD per task, commit per task.

**Goal:** Replace the fingerprint-plus-per-kid-classifier with the player model in spec section 3b (including "Revisions from prior work" and "What the first debriefs taught us"): computed traits with ranges and game adjustment, an AFM skill and learning-rate model, two reaction-model variants scored under leave-one-game-out, a simulated-playthrough predictor, and the reliability and ranking checks.

**Architecture:** The modelling moves into Python (`analysis/`, venv at `analysis/.venv`, add `statsmodels` and `scipy` to `requirements.txt`), fed by the Node row builder (`src/predict/rows.ts`), which gains the new situation features. Node wrappers in `src/predict/` call the Python CLIs and keep the existing CLI (`npm run predict -- ...`) working. Existing predictors and scoring (`predict.ts`, `score.ts`) are extended, not rewritten.

## Global Constraints

- Everything in Plan 3's Global Constraints still holds (no kid names in the repo, fake Meta client only, temp roots in tests, never the word "personality").
- Inputs per kid also include `recordings/kids/<letter>/debriefs.json` (array of `{ game, session, answers: [{ q, a, fun?, intent? }] }`), `ranking.json` (`{ order: string[] }`), and `recordings/kids.json` (`{ <LETTER>: { age, learn, check } }`, names are present there: never copy them into outputs).
- Every trait output is `{ value: number|null, lo: number|null, hi: number|null, n: number, games: string[], adjusted: boolean, source: string }`. `lo`/`hi` are a 90% interval. Never NaN.
- Shrinkage: a kid's per-game trait value is pulled toward the mean of all kids on that game with weight `n / (n + k)`, k = 5 observations (state `k` in the output).
- Games are compared only with other kids on the same game. With fewer than 2 kids on a game, `adjusted: false`.

## Task 1: Situation features (rows.ts)

Add to every row: `prev_label` (label of the most recent moment that ended before this event, else `none`), `s_since_moment`, `rapid_retry` (1 if an attempt comes < 1 s after a fail), `attempts_no_success` (attempts since the last success, the wheel-spinning count), and `intent` (from debriefs: an event type the kid called accidental gets `intent: 'accidental'`). Tests: each feature on a hand-built session, including a debrief that marks `compendium_open` accidental.

Changed during build: rows also carry `kid` and `block` (a new block at every `*_start` progress event except `logger_start`, falling back to progress events with a level, wave or season when a session has fewer than two; block 0 is everything before the first). A fail within 50 ms of the previous fail is the same failure and no longer adds to `fail_streak` (Factor Slicer logs `wrong_cut` and `life_lost` at the same instant, which doubled every streak). `s_since_moment` is seconds since the session started when no moment has ended yet. Debrief answers name their event with an optional `event` field (an event type); without it, an answer's intent applies to event types whose 5+ letter name tokens start a word in the question or answer ("Compendium" matches `compendium_open`). The real Bond Swap answer doesn't resolve: the Compendium event is logged as `entry_view`, so that answer needs `"event": "entry_view"` added by hand. With no moments (weak labels), `prev_label` stays `none`.

## Task 2: AFM skill and learning rate (analysis/afm.py)

`afm.py --rows all_rows.csv --out afm.json`. Rows are attempts with success outcomes (an `attempt` followed by `success` or `fail` of the same type within 2 s; unresolved attempts dropped). Practice = the kid's count of prior attempts on that game. Model: `logit P(success) ~ C(kid) + C(game) + C(game):practice + C(kid):practice` with L2 (sklearn LogisticRegression, C chosen by grouped CV over sessions). Output per kid and game: skill (kid + game intercept), learning rate (practice slope), each with a 90% interval from 200 bootstrap resamples **by run or level block**. pytest: a synthetic set with a planted fast learner and slow learner recovers the order of their slopes and their intervals don't overlap.

## Task 3: Trait estimators (analysis/traits.py)

`traits.py --sessions <dirs...> --kids kids.json --afm afm.json --out traits.json` producing per kid: the ten traits of spec 3b (frustration tolerance as k50 from a logistic of negative-moment-within-10 s against fail streak, recovery, learning rate and skill from AFM, persistence including wheel-spinning, exploration drive discounting accidental events, reading, pace, challenge appetite, stamina with the mood tap, expressiveness), plus `confusion_resolves` (share of confused moments followed by `none` or `delighted` rather than `frustrated` within 30 s), plus `said` values from the questionnaire and debrief fun scores, plus `gaps` where said and did disagree beyond the interval. Bootstrap intervals by run or level block; shrinkage and game adjustment per the constraints. pytest per trait on synthetic sessions, plus: an events-only session (no moments) yields nulls for moment-based traits, never errors.

Node: `src/predict/traits.ts` wraps it; `fingerprint.ts` stays only as the per-session feature source.

## Task 4: Two reaction-model variants and baselines (analysis/reaction.py)

Training data: rows from **all kids' learn sessions**. Variant `traits`: situation features + the kid's trait values (game-adjusted, shrunk) + traits × fail_streak and × s_since_success interactions. Variant `kid`: situation features + kid one-hot + kid × the same two situation features. Both L2 multinomial logistic. Baselines: `base_rate` (label rates by minute of session) and `markov` (first-order transitions from `prev_label`). Leave-one-game-out: hold out **every** kid's rows for the target game. Metrics per variant and baseline: macro-F1, per-label AUC (one-vs-rest), Cohen's kappa, label-mix total-variation distance. Output `reaction.json` and models. pytest: on synthetic data where the reaction depends on a trait (high-tolerance kids frustrate later), `traits` beats `base_rate` under LOGO; the held-out game never appears in a fold's training rows.

## Task 5: Simulated-playthrough predictor (analysis/simulate.py + predict.ts)

For a kid and a target session (a reference playthrough): keep its sequence of stages and attempts, resample each attempt's success from the kid's AFM skill for that game (games the kid hasn't played use the kid's skill shrunk to the group mean for that game, which the other kids' data provides), recompute situation features along the simulated path (fail streaks, wheel-spinning, prev_label from the model's own sampled reactions), and run both variants; 200 simulations; per stage, mean probability per label. Emit `prediction-model-traits.json` and `prediction-model-kid.json` in the existing `Prediction` shape so `score.ts` works unchanged. pytest: a high-skill kid gets fewer predicted frustrated moments than a low-skill kid on the same reference.

## Task 6: Reliability, ranking and fidelity in scoring

- `labels.json` per session (Joel's hand labels: `{ momentId: label }`); `npm run predict -- reliability` computes Cohen's kappa between Joel and Muse overall and per label across all labelled moments, and the scoreboard prints it **above** every prediction score, with a warning when below 0.6.
- Ranking check: for each kid with `ranking.json`, compare the model's predicted enjoyment order (mean P(delighted) − P(bored or frustrated) per game) with the kid's order; report Kendall's tau.
- Scoreboard adds per-label AUC, kappa and label-mix distance for each predictor, and both model variants.

## Task 7: Persona inputs

`persona.ts` lens and synthesis prompts take `traits.json` (with intervals, and "don't call a trait high or low if its interval spans the group mean"), the debrief answers as the kid's own words (quoted, marked "said"), the mood taps, and intent corrections. Evidence ids may now also be trait names. Fake-client tests updated.

Report per task: done or not, tests, commits, plan changes, anything unverified.
