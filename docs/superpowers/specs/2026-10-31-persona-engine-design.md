# Persona engine: design

Written 2026-10-31, after the four check sessions and interviews. It replaces the framing in
`2026-10-27-playtest-watcher-design.md` §1 ("prove a persona predicts a kid") with a product: **an informed
persona engine**. The recorder, the watch pipeline, the traits and the scoring all stay; they become the
inputs and the calibration of this engine.

## 0. Revision after the Fable review (2026-10-31, later the same day)

A plan review (verdict: rework needed) found three blockers; each was checked against the data before
changing this spec. What changed:

1. **The §2 table measured the games, not the kids.** Factor Slicer's fact cards close themselves after
   1.1 s (`playtest-hooks.js:88`); Current Cut's `learn:` and `real:` texts are tapped through at 14-20 ms a
   character while its `line:` texts stay open the whole level (~128 ms a character). Pooling those made "every
   kid skims", which is backwards: texts kids chose to close (Factor Slicer lessons, Hoard Keeper coach) stayed
   open longer than reading time. The numbers also came from an uncommitted script. Now: every limit is
   **per game**, reading counts **only text the kid closed**, a committed `analysis/limits.py` writes
   `recordings/group/limits.json`, and a limit on a new game is a **ratio to a reference run** on that game
   (Joel's run, or the game's balance bot). A new game needs one reference run first.
2. **Replay "calibration" was circular** (the agent would see the kid's own fails and idles). Dropped. A
   persona is scored only on a game its kid has not played, from Joel's reference run, the same way the frozen
   checks were; anything scored after 2026-10-31 is labelled post-hoc.
3. **A screenshot walkthrough can't exercise timing or accuracy limits.** Replaced by **live play on Hoard
   Keeper** (Joel's pick): Playwright drives the real game in Chrome; Muse Spark sees a screenshot plus the
   page's buttons and text and chooses an action. Playwright controls the page clock: game time is frozen
   while Muse thinks and advanced by the persona's own measured time per action, so a slow kid's persona spends
   more of the 60-second Rush than a fast one's. Text the persona wouldn't have read is cut before Muse sees
   it; a share of swipes and taps land on the wrong target by the persona's error rate. The game's own event
   logger stays on, so every run is an ordinary session the scorer and viewer already read.

Also from the review: only dimensions whose 90% range clears 0 produce rule lines, and the card says how many
that is; `time_pressure` and `novelty_need` are "not measurable with these games" (timers and repetition are
tied to which game it is); bored-derived dimensions are low-confidence for every kid (kid-vs-Muse kappa per kid
0.05 / 0.13 / -0.09 / 0.50 on 20 clips, chosen where Muse was most confident); forced labels in the step log
carry `forced: true`; the check result is "tied with age-only", not "best for two of four"; and the original
rule stands: this is a player behaviour model, never a personality profile.

Sections below are kept as written except where this revision overrides them; §2's table is superseded by
`limits.json`.

## 1. What it is

A developer gives the engine what they know about a player:

- a short **interview** (the questionnaire, plus the kid watching their own clips and rating game ideas),
- **recordings of play** (screen, face, hands, voice and the game's own event log), or
- a **written description** ("a 9-year-old who skips every instruction and quits after two fails").

The engine returns a **persona file**: about 20 numeric dimensions, each with a confidence and a note of
where it came from, plus behaviour limits in real units (seconds, characters a second, error rate), what the
player plays for, and a short readable card.

A **compiler** turns that file into rules and limits any agent can follow. A **harness** runs the agent
against a new game, app or site and enforces the limits the agent can't be trusted to keep. Every run returns
one **step log** in a fixed format. Where a real player exists, the engine **checks the persona against
them** by running it on something they already played and comparing the step log with their real moments.

```
inputs (interview / play / description)
   -> persona.json (dimensions + limits + drives + card)
   -> compiler (rules text + harness settings, per agent)
   -> agent run inside the harness (Muse first; Claude, Gemini, Codex by adapter)
   -> step log (one format)
   -> calibration against the real player, where we have one
```

The family's four kids are the worked examples and the calibration set.

## 2. Why the limits matter more than the description

An agent told "reading: 0.2" reads every word anyway. Agents read everything, never get bored, solve the
maths and never mis-tap. A child does all of these differently, and differently from each other:

| Measured from play (all learn and check sessions) | A | B | C | D |
|---|---|---|---|---|
| Seconds between actions (median) | 1.39 | 1.17 | 1.46 | 1.45 |
| Seconds to first tap on a new screen (median) | 2.22 | 2.49 | 2.37 | 2.31 |
| Text kept open, ms per character (median, texts of 20+ characters) | 44.5 | 52.5 | 41.3 | 37.1 |
| Share of attempts that fail | 0.21 | 0.09 | 0.21 | 0.16 |
| Idle stretches (8 s or more) per minute | 1.66 | 0.88 | 1.18 | 1.17 |
| Moments where they asked for help, per minute | 0.58 | 0.19 | 0.51 | 0.76 |

(Superseded, see §0: these pooled numbers mix tap-throughs, auto-closing cards and texts left open during a
task. The per-game, kid-closed version lives in `recordings/group/limits.json`.)

So the persona carries two layers, and the second one is enforced by code, not asked of the model:

1. **Dimensions** (§3): what kind of player this is, on comparable scales. These shape the rules text.
2. **Limits** (§4): how fast, how accurate, how much they read, how long before they sour or quit, in
   native units measured from video, events and timing. The harness applies these.

## 3. Dimensions

Scale: −1 to +1 against the population the persona was measured in (0 is typical), so a slider means the
same thing on every dimension. Each value carries `lo`/`hi` (90% range), `n`, and `sources`
(`play`, `muse`, `interview`, `questionnaire`, `description`, `tuned`).

Status: **have** = computed today; **partial** = the data exists, the roll-up doesn't; **new** = needs
defining.

### How they figure things out

| Dimension | Means | From play and Muse | From interview / questionnaire | Status |
|---|---|---|---|---|
| `exploration` | wanders off the main path vs straight to the goal | explore events per minute, accidental ones removed | questionnaire `explore`; pitch "secret map" | have |
| `reading` | reads instructions vs acts on gut | share of texts open long enough to read; ms per character open | questionnaire `read` | have |
| `experimenting` | tries things to see what happens | Muse evidence and quotes of "what if" testing; distinct actions tried per new screen | clip answers ("my goal was to see what would happen") | new |
| `help_seeking` | asks an adult vs works it out alone | `asked_for_help` per minute (Muse, every moment) | questionnaire `social` | partial |

### How they handle difficulty

| Dimension | Means | From play and Muse | From interview / questionnaire | Status |
|---|---|---|---|---|
| `frustration_tolerance` | fails in a row before they sour | fail streak at which P(frustrated or stuck) passes 50% | questionnaire `persist` | have |
| `persistence` | keeps going after failing | share of failed runs restarted within 20 s | questionnaire `persist` | have |
| `recovery` | how fast they try again after a fail | median seconds from fail to next attempt | | have |
| `time_pressure` | copes with timers and speed-ups | fail share and negative moments under timed vs untimed play | pitch "faster every time" | new |
| `confusion_recovery` | works out of confusion vs it turns into frustration | share of confused moments not followed by frustration within 30 s | | have |

### What they need

| Dimension | Means | From play and Muse | From interview | Status |
|---|---|---|---|---|
| `challenge_appetite` | wants it harder vs fine with easy | P(bored) during success streaks of 5+ | "too easy" answers; questionnaire `challenge` | have |
| `novelty_need` | bored by repetition | bored moments in repeated levels vs new ones | pitch "same short game over and over" | new |
| `clarity_need` | quits when the goal isn't clear | negative moments with `understood_goal: no`; quits after them | "I didn't understand it at all" | new |
| `stamina` | holds up over a session | slope of negative moments per minute | | have |

### What they play for (from the interview's ten ideas, Muse reading their reasons; −1 puts them off, +1 pulls them in)

`mastery`, `creativity`, `competition`, `collection`, `story`, `exploration_drive`, `progress`
(points, currency, upgrades), `showing_off`, `nurturing`, `speed`. Status: **have** (interview), seven to
ten of these feed the card and the rules; they are not on the −1..+1 population scale, they are the
kid's own pull.

### Ability

| Dimension | Means | Source | Status |
|---|---|---|---|
| `skill` | succeeds more than peers on the same games | AFM kid term (log-odds of success) | have |
| `learning_rate` | gets better faster | AFM slope per 10 attempts | have |

### How they show it (for reading recordings, never for acting)

`expressiveness` (face, emotional voice, body: have since 2026-10-30) and `talkativeness` (share of play
time talking: have, as `talk_share`). These calibrate the observer: a flat kid's missing "frustrated"
moments may be hidden, not absent. They do not change what the agent does.

## 4. Limits (enforced by the harness)

Native units, each measured per kid from events, timing and Muse's moments, with a per-game value where
the games differ a lot (A's recovery is 0.84 s in Bond Swap and 9.19 s in Hoard Keeper).

| Limit | Unit | Measured from | Harness action |
|---|---|---|---|
| `action_gap_s` | seconds (median, spread) | gaps between attempts | waits this long, sampled from the kid's spread, before each action |
| `first_tap_s` | seconds | screen shown to first touch | waits before acting on any new screen |
| `read_ms_per_char` + `read_share` | ms a character; share of texts read | text open time vs length | truncates each text the agent sees to what the kid reads in the time they keep it open; skips a text entirely at 1 − `read_share` |
| `error_rate` | share of actions | fail share, game-adjusted by `skill` | turns that share of intended taps into a near miss or the nearest wrong target |
| `recover_s` | seconds | fail to next attempt | pause after a fail |
| `sour_after_fails` | count | `frustration_tolerance` | after that many fails in a row, the agent must report frustrated and choose: ask for help (by `help_seeking`), keep going (by `persistence`) or quit |
| `idle_before_bored_s` | seconds | idle stretches before bored moments | a no-progress clock; past it the agent reports bored and may quit |
| `help_per_min` | rate | Muse `asked_for_help` | the budget for "ask an adult" steps |
| `session_minutes` | minutes | when negative moments climb (stamina) | ends the run, or forces a "still playing?" check |

The model decides *what* to do. The harness decides *how fast*, *how accurately*, *how much it read* and
*when it has had enough*. A model can't be trusted to make itself worse reliably; a harness can.

## 5. Where Muse is used

| Step | Model | Job |
|---|---|---|
| Moments from video | `muse-spark-1.2` | label each window with face, voice, hands and screen evidence; attention, help, goal understood, quote |
| Transcripts | `muse-voice-transcribe-1.0` | who said what, when |
| Interview reading | `muse-wonder-1.0` | motivation profile from the kid's own words |
| Card and rules | `muse-wonder-1.0` | the readable card; the rules text from the dimensions (§6) |
| Description input | `muse-wonder-1.0` | a written description into dimension values (§7) |
| The playing agent | `muse-spark-1.2` (sees screenshots) | acts as the persona inside the harness; other agents by adapter |

The numbers themselves (traits, limits) are computed locally from events and Muse's labels, so they are
repeatable and cost nothing to recompute.

## 6. Compiler

`persona.json` -> two outputs:

1. **Rules text**, one short line per dimension that is clearly away from typical, worded as instructions:
   - `reading` −0.6 -> "Read only the first sentence of any instruction. Skip tutorials until you are stuck twice."
   - `exploration` +0.6 -> "Before the obvious next step, try one thing you haven't touched."
   - `clarity_need` +0.7 -> "If you can't say the goal in one sentence, say you're lost and look for help."
   - `mastery` −1 -> "A puzzle with one right answer feels like a chore; say so."
   Dimensions near 0 add no line. Each line cites its dimension so a step log can be traced back.
2. **Harness settings**: the §4 limits as JSON.

The rules text is the same for every agent; adapters only change how it is delivered (system prompt, tool
set, screenshot cadence). Muse is the first adapter; Claude, Gemini and Codex adapters follow the same
contract.

## 7. Inputs and how they combine

| Input | Gives | Confidence |
|---|---|---|
| Play recordings | the measured dimensions and every limit | highest; ranges from the data |
| Interview | drives; kid-checked labels for their own clips; corrections ("that was concentrating, not bored") | high for drives, and it fixes Muse's misreads |
| Questionnaire | seven self-rated axes | low: kids' self-reports disagreed with their play (D said more challenge, played with less) |
| Description | any dimension it mentions | lowest; unmentioned dimensions take the population default with a wide range |
| Tuning | any slider | marked `tuned`, kept beside the measured value |

Order of precedence: play > interview > tuned > questionnaire > description. A tuned value never erases the
measured one; the file keeps both.

**Kid-checked corrections feed back into the labels.** The interviews showed Muse reads still, quiet
concentration as boredom (3 of the 4 clips Muse called bored, the kid didn't; 5 of 20 exact matches, 15 of
20 the same direction). Where a kid has checked clips, their word replaces Muse's for those moments, and
the dimensions built on boredom (`challenge_appetite`, `novelty_need`, `stamina`) are recomputed.

## 8. Step log (every run, every agent)

One JSON line per step:

```json
{ "t": 12.4, "screen": "level select", "action": "tap", "target": "level 3", "read": "first 40 of 180 characters",
  "label": "confused", "why": "I don't know which one is next", "rule": "clarity_need", "would_quit": false }
```

`label` uses the moment vocabulary (confused, stuck, bored, frustrated, focused, engaged, delighted, none), so
a run on a game a real kid played scores against their moments with the scoring we already have. A run ends
with a short summary in the kid's voice: what they liked, where they got lost, where they would have quit.

## 9. Calibration

For each real kid, run their persona on games they already played (replay mode: the agent sees the same
screens in the same order, from the recording), score its step log against their real moments, then adjust the
limits and dimensions within their ranges until it fits. The pre-registered scoring (stage-level kappa,
paired hits against `null`) is the measure. Kid-checked clips count first.

What it is honest to say: the engine is grounded (every number traces to a recording, an answer or a slider)
and checked against real kids where we have them. Whether a persona predicts a new game is measured per kid,
not assumed. The 2026-10-31 checks (persona best for two of four kids, tied with age-only on average) are the
starting point that calibration has to beat.

## 10. Scope

**By Wednesday (hackathon):**
1. `persona.json` schema v1 with the §3 dimensions and §4 limits, built for A–D from what we have. Two new
   roll-ups computed (`help_seeking`, `clarity_need`); `experimenting`, `time_pressure` and `novelty_need`
   defined, filled where the data supports it, otherwise default with a wide range.
2. Kid-checked corrections applied to the 20 interview clips.
3. Compiler: rules text and harness settings.
4. A **walkthrough** run on a new game: Muse plays from a series of screenshots inside the harness's reading,
   timing and patience limits, writing the step log and a summary in the kid's voice.
5. One calibration run: a kid's persona replayed on a game they played, scored against their real moments.
6. The "describe a kid" input.
7. Repo and README reorganised around input -> persona -> use.

**After:** live play (the agent drives a real browser or device with injected delays and near misses), the
Claude, Gemini and Codex adapters, a slider interface, apps and websites through the same event logger.

**Out of scope:** fast action games for live play. An agent acting on screenshots needs seconds per move, so
Factor Slicer style swiping can only be walked through or replayed, not played.

## 11. Open for Joel

- The dimension list (§3): anything missing from how you'd describe your kids, or anything here you'd never tune?
- `talkativeness` and `expressiveness` stay observer-only; agree?
- Description input: is age plus a paragraph enough, or should it ask a few fixed questions?

## 12. Results so far (2026-10-31, end of day)

**Built:** `analysis/limits.py` (per-game limits from kid-closed text), `src/persona/build.ts` (persona file),
`src/persona/compile.ts` (rules and harness settings), `src/persona/describe.ts` (a written description onto
the real kids' spread), `src/agent/play.ts` (live play on Hoard Keeper with the frozen page clock),
`analysis/compare_runs.py` (an agent run against the real kid), and `public/runs.html` (two runs side by side).

**Transfer of limits (built only from each kid's other three games, against what they did; pairs ordered
right out of 6 per game, pooled over all four games after a later review):** on Hoard Keeper reading speed was
5/6 and first tap 4/6, but pooled nothing clears chance (first tap 14/24, error rate 15/24, reading speed 13/21,
action gap 9/24, idling 11/24). With four kids this is a hint at most. (First taps are measured strictly after the
screen appears; counting a tap on the same millisecond had made half of the agents' first taps 0.0 s.) Error rates are under-predicted because Hoard Keeper was much harder for
the kids than for the reference player (C: predicted 9%, real 64%).

**Live play:** the personas play recognisably differently and stay in character (A: slower first tap,
skips text, misses taps, talks about building; B: reads everything, talks about the story and collecting),
and neither quits early, though that is the harness's rule and the runs cover two to three game-minutes against the
kids' seven to eleven. The agents' first taps land about a second after their limit, consistently (the game's
screen event fires before the harness starts counting). Muse files 39-47% of Rush slips wrong in the first fixed
runs and about a third in the final ones (`results/group/agent-vs-kid.json`), against the kids' 18-19%.
Four harness bugs were found and fixed on the way, each of which had inflated that number: events going to
another server on the same port; looking before waiting (acting on a moved-on screen); screenshots a frame
behind under the frozen clock; and Muse misreading the dragon art (now given each picture's alt text, size and
place). What remains is the game's own screen: a blue snowflake hint sits above every slip and the slips carry
colour-coded gem and moon icons, and the agent reads the blue gem as "frost". With the answer read from the
page, the harness files 8 of 8 correctly, so the remaining gap is the model's reading of this screen.

**Two things the model would not do on instruction alone,** now enforced by the harness instead: quitting
early (an early run recited the kid's quit reasons and left at 37 s; all four real kids played the full ten
minutes) and repeating the kid's own interview words (told not to, it still did; the quotes are now kept out
of the rules and stay on the card).

**What it is honest to claim:** the engine turns interviews, play recordings or a description into a persona
whose limits are measured per game and enforced on a live agent, and every run is logged like a real session
and compared with the real kid where one exists. It does not yet reproduce a kid's error rate on a screen the
model reads worse than a child, and the check-session predictions remain tied with age-only.
