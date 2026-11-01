# Real-time live play: the four kid personas on Timberline Trek (2026-10-31)

Live play could only handle tap games until now. This adds a real-time mode and runs Players A to D on
Timberline Trek (the elk runner on PettigrewLab PR #396), course `?seed=3`, fall, clear day, at iPad landscape size.

**Short version.** On a normal run, all four personas got caught by the storm in the last three miles. Two
were caught inside Estes Park, walking past people at graze speed. The other two were caught just before town,
after long grazes in the meadow. The same kids' hands carrying out a complete plan, with no model choosing, get
home every time. So the hands don't lose these runs. What loses them: what the personas choose to do once the
storm is close (graze to full, walk the town), and two hazards they never work out (low branches and the hidden
lion).

## What changed in the harness

> **Overlap with action mode.** While this was being built, `main` gained `src/agent/action.ts` ("Action mode for
> fast games", d20c250). It does the same job a different way: Muse plans up to three timed moves every 1.2 s, and
> the harness fires them with the kid's reaction time and timing error. This branch keeps both. They share no
> code, and neither touches the other's files. The difference: action mode has Muse time each press itself, while
> here Muse names what to do about each kind of thing and the adapter times it on the frame. Which one to keep
> (or how to fold them together) is Joel's call. The reaction ages differ slightly too: this branch's table puts
> age 8 at 450 ms; action mode uses its own age defaults.


`src/agent/realtime.ts` (`npm run play:rt`) and the game adapter `public/adapters/timberline-trek.js`. The tap-game
harness (`play.ts`), Hoard Keeper live play and the demo are untouched.

- **Sliced clock.** The page clock is frozen while Muse looks and decides, then runs 350 ms slices of game time
  (`--slice`). Muse is asked again only when a new kind of thing comes on screen, something happens (a slip, a
  cow joins, a postcard), or 3 to 3.5 s pass (`--recheck`). The rest of the time the plan runs on its own. A
  three-minute run costs about 65 to 75 calls (about $0.85), not one call per slice.
- **New actions.** Each decision carries
  - `now`: jump, hold Graze for `hold_ms`, push, or ease, pressed after the kid's reaction time;
  - `plan`: when/do pairs for kinds of things ("log: jump", "branch: duck", "people: walk", "ring: wait",
    "food: eat", "warning: dont_eat", "storm: push").

  The adapter carries out the plan on the frame and works out the moment to act on each thing (the jump point
  for a log, the lead for a branch, whether a glowing ring will strike where you'll be). It presses the game's
  own keys (Space; ArrowDown held; ArrowRight/Left held), so nothing goes around the game's input.
- **Kid timing on every press**, drawn once for each thing on screen:
  - Reaction time holds back the earliest press, counted from when the thing came into view (for a ring, from
    when it lit).
  - A timing offset from the kid's spread moves the press earlier or later.
  - At the kid's slip rate the press is fumbled: four times the spread, and half of those are never pressed.
- **The game reports to the watcher with no changes to the game.** The adapter catches `window.TT`, wraps
  `TT.step`, and logs every game event as `tt_<event>` (fail, success or progress), along with clean passes, run
  start and end with the summary, jump presses as attempts, and the start/end/postcard screens. The harness injects it with
  `playtest-log.js`. A note for the Timberline session in the shared notes folder gives the one tag needed to log
  without the harness.
- **Hands-only mode** (`--hands-only`) plays a fixed, complete plan with no model. This is the reference run for
  a new game. It shows what the kid's timing alone costs, for free. `--played-before` marks progress as saved, so
  the run is a normal one (no coach, the real storm) rather than the first-run tutorial.

### Measured and assumed

| Setting | A (8) | B (14) | C (11) | D (13) | Where it comes from |
|---|---|---|---|---|---|
| Reaction time | 450 ms | 310 ms | 370 ms | 330 ms | **Assumed**: rough age norm for simple visual reaction time |
| Timing spread (sd) | 90 ms | 55 ms | 70 ms | 60 ms | **Assumed**: rough age norm for a press timed to something approaching |
| Slip rate | 19% | 7% | 12% | 16% | **Measured**: the kid's own Factor Slicer error rate, the only real-time game they played |
| First tap on a card, reading, fail streak | | | | | Measured, as in tap-game live play (Factor Slicer numbers, the nearest timed game) |

None of the four recorded games times a reaction to something appearing, so reaction time and spread can't come
from the kids. They come from an age table in `src/persona/realtime.ts`, and every persona file and run labels
them `assumed`. Using Factor Slicer's error rate as a slip rate is a stretch: a wrong cut there is a fast
decision error, not a fumbled thumb. It's the closest thing measured.

## Runs

Each persona played twice:

- **Session 1**: the first run (the coached tutorial, with a slower storm that never quite catches up), then
  "Run it again". Every session hit the 110-call cap partway through run 2.
- **Session 2**: one normal run (`--played-before`), after the fixes below.

Hands-only runs used the same course and timing.

| | First run (coached) | Session 1, run 2 at the call cap | Normal run (session 2) | Hands-only normal run |
|---|---|---|---|---|
| **A** | home, 1 cow, 19 slips | mile 8.8 | **caught by the storm, mile 19.1** (town), herd 2 | home, 3 cows |
| **B** | home, 3 cows, 8 slips | mile 5.8 | **caught, mile 19.5** (town), herd 3 | home, 6 cows |
| **C** | home, 1 cow, 9 slips | mile 7.5 | **caught, mile 16.9** (meadow), herd 2 | home, 5 cows |
| **D** | home, 4 cows, 7 slips | mile 7.5 | **caught, mile 19.1** (town), herd 4 | home, 5 cows |

Slips on the normal runs:

| | Branch | Log/rock bump | Lion | Creek splash | Ravine fall | Lightning | Storm catch (first warning) |
|---|---|---|---|---|---|---|---|
| A | 3 | 4 | 2 | 3 | 0 | 0 | 1 |
| B | 4 | 0 | 2 | 0 | 1 | 0 | 1 |
| C | 3 | 1 | 2 | 0 | 1 | 4 | 1 |
| D | 0 | 1 | 2 | 0 | 0 | 0 | 1 |

There were no bears on this course, and no runs spooked the people or clashed with the rival bull on the normal run.

## What killed them

1. **The storm, at the very end, every time.** It closed from 3 to 4 s behind in Aspen to under 1 s in the
   meadow and town. Each persona held Graze for 57 to 64 s of a roughly 200 s run, and kept holding it in the
   meadow at 95 to 100% energy ("food is right here so I keep eating"). In town they then walked past the people
   (the game's own "Walk! Hold Graze" cue), holding Graze or easing off with the storm 0.4 to 1.5 s behind. The
   hands-only plan stops eating at about 92% and only walks for the last few units before the crowd, and it gets
   home. The personas follow the game's advice faithfully, at the worst moment.
2. **Low branches** (3 to 4 a run for A, B and C). Twice a persona switched its plan to "branch: jump" after being
   hit, because jumping clears everything else. A hit them while already holding Graze for food ("I was holding
   graze and hit the branch"). That is a real game rule (grazing ducks), but nothing on screen says Graze and
   duck are the same button press.
3. **The lion** (2 a run, every persona, every run). The personas see a marmot or pika call out, keep eating, and
   get jumped: "Ugh not the lion AGAIN!", "I was just eating and the lion jumped me again, I don't know what to
   do". None of them connected the call with stopping eating, even B, who called Spruce "the lion story part".
4. **Lightning** hit only C (4 times on the normal run). The others' "ring: wait" plans got them through. Why C
   didn't, I haven't checked.

## Where they got confused or bored

- **By the harness's own labels.** "You are in the air" in the status line drew a whole reasoning step most
  times it appeared ("I'm already in the air so I don't need to press anything", dozens of steps). The
  `[warning] a marmot popped up and called out` label doesn't say what it warns of, which is fair to the game. The
  persona sees only what a kid sees. But Muse sometimes invented a thing to do about the marmot itself
  ("I want to jump over marmot"). Food is labelled by plant (sedge, willow, aspen), which the personas liked and
  repeated.
- **Persona drift.** A kid's drive turns into a rule ("Games about mastery put you off; say so"), and personas
  recited it every few steps once frustrated: A's "this mastery stuff is not fun", D's "I don't like speed
  games". On the normal runs, with the fail streak fixed (below), this mostly stopped: "frustrated" fell from 25
  to 45 steps a session to 0 or 1.
- **Real confusion worth taking to the game.** B on the fixed run: "I get to eat the striped one?" (aspen bark).
  D: "cool, the elk story is nice, but i dont see anything to jump on". C read the elk calves as something to
  look after, and grazed for them ("eat up little elk I love feeding you"). That isn't confusion, but it's why C
  ate the longest and was caught first.
- **Bored** showed up mostly on long empty stretches of the tundra and the meadow for A ("nothing ahead so I just
  keep running and look at the mountains"). Every persona praised the painted art, A most of all.
- **Noise.** About 1 to 2% of Muse's answers were garbage (a stray "_MAPDELIM_", one rude line, "I'm using
  natural language processing"). They're kept in the steps for the record and didn't change the plan.

## Harness bugs these runs found, and the fixes

- **The fail streak never reset on a clean jump.** The game only shows a clean pass as the streak going up, so
  session 1 told personas "you have failed seven times in a row" across many clean jumps. That inflated
  frustration and the drive recitation above. Fixed: the adapter reports each clean pass and the streak resets.
  **Session 1's frustration labels are not trustworthy**; session 2's are.
- **Graze flickered** every frame at the old 80% energy line (eat, cross it, stop, drop, eat). Fixed with a
  start and stop gap, as a kid holds the button until they feel full.
- **Presses made in the air were wasted.** Now the hands wait to land.
- **The windows for people and branches were the bot's last-frame leads** (0.8 and 1.2 units), tighter than any
  kid. Now they are 8 and 3 units.
- **An empty plan from Muse mid-run wiped the plan.** Now an empty plan keeps the old one.
- **Muse once answered with every action for every kind.** Now one action per kind is kept, the first.

## Fix list

For **Timberline Trek** (suggestions for the Timberline session; no game changes were made here):

1. **The town stretch with people is where every normal run was lost.** Walking at graze speed with the storm
   under a second behind is a trap. Ideas: ease the storm in town, put the crowd earlier in the stretch, or
   let a run past people cost a cow instead of making the kid walk.
2. **Say when you're full.** The personas held Graze at 95 to 100% energy for seconds at a time. A full belly
   could end the graze or show a cue.
3. **Tie the lookout call to the lion.** Two lion hits on every run, for every persona. The call needs to say
   "stop eating", or the lion needs to be visible a beat before it springs.
4. **Make "Graze ducks" visible** at the first branch outside the coached run, or keep the coach's "Duck! Hold
   Graze" cue for the first branch of the first few runs. Personas learned "jump" instead.
5. **Long empty stretches** in the tundra and meadow read as boring to the youngest persona.

For **Playtest Watcher**:

1. Reword the persona's state line (drop "in the air", or only show it when it changes).
2. Tone down drive rules once said: say a drive once a run, not every step.
3. Rerun session 1 under the fixed streak before quoting any of its frustration.
4. Per kid, a few more normal runs would show the spread. Each costs about $0.85.
5. The reaction-time age norms should be replaced with a real measurement if a kid ever plays a reaction game
   on the recorder.

## Cost

Real-time play used **$10.37** of Muse calls (769 calls, including the smoke tests), out of the $150 hackathon
credits. The spend log stood at **$73.16** total afterwards. The live runs were capped with
`PW_BUDGET_USD=76`.

## Where the runs are

The sessions sit under `recordings/` on Joel's machine (git-ignored; persona files, steps, actions, shots and
the watcher's event log):

- Session 1: `20261101-002118-{a,b,c,d}-timberline-trek-agent`
- Normal runs: `20261101-005159-{a,b,c,d}-timberline-trek-agent`
- Hands-only: `20261101-005020-a-…` and `20261101-010732-{b,c,d}-…`

Reproduce one with:

```
PW_LIVE=1 PW_BUDGET_USD=<cap> npm run play:rt -- C --url http://127.0.0.1:3073/index.html --course 3 --runs 1 --minutes 5 --max-calls 75 --recheck 3500 --seed 12 --played-before --live
```

Add `--hands-only` and drop `--live` for the free reference run.
