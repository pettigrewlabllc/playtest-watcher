# Playtest Watcher

I make small games and my kids are the playtesters. Building the games stopped being the slow part a while ago. Watching the recordings is the slow part, and I only have four kids.

So this does two things. It watches a playtest for me: screen, face, hands and voice, lined up with the game's own event log, with Meta's models saying what the kid was going through at each moment and a fix list at the end. And it turns what it learns into **personas I can send into a game none of them have played yet**. A persona isn't a paragraph about a kid. It's a set of measured limits (how long they look at a new screen, how fast they tap, how much they read, how often they miss, how many fails before they sour), and a harness holds a live AI player to them.

## How a persona gets made

You can give it any of three things:

- **Recordings of them playing.** The limits are measured per game from the event log and timing, and the traits come from Muse Spark watching the video.
- **An interview.** The kid watches a few of their own clips and says what was going on, then rates ten game ideas. That gives what they play for, in their own words, and a check on whether Muse read them right.
- **A description.** "A 9-year-old who skips every instruction, taps really fast and gets annoyed after two fails." Muse Wonder places that on the same scales, inside the spread the real kids showed.

What comes out is a persona file: the limits, the traits that are clearly different from other kids (and how many that is, which is usually not many), what they play for, and a short card.

## How a persona plays

```bash
PW_LIVE=1 npm run play -- A --game hoard-keeper --steps 40 --live
PW_LIVE=1 npm run play -- --describe "a 9-year-old who skips every instruction" --name X --live
```

Muse Spark plays the real game in Chrome, from a screenshot plus the page's buttons and text. The harness holds it to the persona's limits so it can't play like an AI:

- **Time.** The game's clock stops while Muse thinks, then moves on by the kid's own time to act. A slow kid's persona burns more of a timed round than a fast one's.
- **Reading.** Text the kid wouldn't have read is hidden from the screenshot. Muse only gets the first few words.
- **Accuracy.** Some taps land on the button next door, at the kid's measured rate.
- **Patience.** After the kid's fail streak, the step is marked frustrated, and the harness decides when to quit, not the model.

The game's own logger stays on, so every run is a normal session with events, a step log and a screenshot per step. `/runs.html` plays two runs side by side.

**See it without a key:** `npm install`, `npm start`, then open http://localhost:3058/runs.html. It plays three committed runs from `results/runs/`: the youngest kid's persona, the oldest's, and the kid described in one sentence.

## Fast games

Some games are about timing, not taps. `src/agent/action.ts` handles those. Every second or so of game time it freezes the game, Muse looks and plans up to three moves for the next moment, and the harness carries them out the way the kid would: never sooner than their reaction time, off by their usual timing, and sometimes not at all. Muse's thinking time never counts, because the game only moves when the harness moves it.

```bash
PW_LIVE=1 node src/agent/action.ts A --url "<your game>" --keys "Space,ArrowDown" \
  --controls "Space jumps. Hold ArrowDown to duck." --state "<optional JS for the game's own score>" --live
```

The reaction time and timing are defaults for the kid's age, because the published numbers disagree a lot. How often a kid freezes is measured, from the numbers they let fall in Factor Slicer. On Timberline Trek, the youngest kid's persona got about a sixth of the way down the trail in half a minute, stumbled once and stayed ahead of the storm. Nobody has checked that against a kid playing Timberline yet.

## What I learned building it

Every number here has a file in `results/`, which you get with the clone.

- **Watching isn't the same as knowing.** Muse gives the same label to the same clip 83% of the time (`group/stability.json`). When the kids watched their own clips, they picked the same word as Muse on 5 of 20 and agreed on good vs bad about three times in four (`kid-check.json`). Twice it read a kid sitting still and concentrating as bored.
- **The predictions tied with knowing only the kid's age** (`group/scoreboard.json`). I froze them before four check sessions. They were scored against Muse's labels, which the kids only matched 5 times in 20, so it's a weak test either way. That's why the persona moved from a description to limits that get enforced.
- **With four kids, nothing carried from one game to another better than a coin flip.** Built only from each kid's other games and compared with what they did, the best were error rate (right order in 15 of 24 pairs) and time to first tap (14 of 24) (`group/limits.json`). That's a hint, not a finding.
- **The model has to be held to the limits, not asked.** Told to play like the kid, it quit after 37 seconds, reciting the kid's own interview words. Told not to repeat them, it still did. So the harness decides when a persona quits, and a kid's words never go into the rules it plays from.
- **The timing holds; the reading of the screen doesn't.** The agent's first taps land about a second after its limit, consistently, because the game shows the screen a moment before the harness starts counting. But in Hoard Keeper the agents filed about a third of the slips wrong, against 18 to 19% for the real kids (`group/agent-vs-kid.json`). In a probe where the harness read each slip's answer from the page and tapped it, all 8 filed right (that probe isn't in the repo), so the gap is the model reading a busy screen. It keeps taking a blue gem icon for a frost dragon, which is also a useful note about the game.

## Watching a playtest

```bash
npm install
npm run demo          # a fake 30-second session through the whole pipeline, no key, no spend
npm start             # recorder on http://localhost:3058/record.html
PW_LIVE=1 npm run watch -- <sessionId> --live
npm run blur          # blurred face video for the viewer
```

**What you need:** Node 22.18 or newer (it runs the TypeScript directly), ffmpeg on your PATH (or `FFMPEG_PATH`), and Google Chrome for live play. For anything live, copy `.env.example` to `.env.local` and put your Meta Model API key in it. Live play also needs a web game running with the event logger on it. The one I used, Hoard Keeper, is my own game and isn't public yet, so for your own game pass its address with `--url`. [docs/session-day.md](docs/session-day.md) is the checklist I use with my kids. Games send events with [public/playtest-log.js](public/playtest-log.js) (web) or [godot/playtest_log.gd](godot/playtest_log.gd) (Godot), and a playtest link always starts the game from the beginning.

| Stage | What it does | Model |
|---|---|---|
| align | Puts every camera, the mic and the event log on one clock | none (ffmpeg) |
| transcribe | Who said what, and when | `muse-voice-transcribe-1.0` |
| candidates | Windows worth a look: fail streaks, long idles, the kid talking, and a sweep every 60 seconds | none (rules) |
| explain | One call per window with face, hands and screen side by side, with sound. Returns what the kid was going through, with the face, voice, hands and screen evidence | `muse-spark-1.2` |
| fixes | A ranked fix list, each fix tied to the moments behind it | `muse-wonder-1.0` |

`/view.html` plays a session back with the face blurred, a timeline of moments and the fix list. `/interview.html` runs the clip-and-ideas interview from the recorder.

## Privacy

Raw recordings stay in `recordings/`, which git ignores. Only short clips and session audio go to the Meta API, every upload expires after an hour, and the client refuses any `-contributor` model id. The viewer only ever serves the blurred face. The kids are Kid A to D everywhere in this repo, and the rules a persona plays from never carry a kid's own words. Their quotes stay on the card, which is for people, and never leave this laptop.

## Tests

```bash
npm test
cd analysis && .venv/bin/python -m pytest -q tests
```

The Node tests use a fake model client and never call the API. The Python side needs its own virtualenv: `python3 -m venv analysis/.venv && analysis/.venv/bin/pip install -r analysis/requirements.txt`. Live play needs Google Chrome installed.
