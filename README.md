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

Muse Spark plays the real game in Chrome. The harness holds it to the persona's limits so it can't play like an AI:

- **Time.** The game's clock stops while Muse thinks, then moves on by the kid's own time to act. A slow kid's persona burns more of a timed round than a fast one's.
- **Reading.** Text the kid wouldn't have read is hidden from the screenshot. Muse only gets the first few words.
- **Accuracy.** Some taps land on the button next door, at the kid's measured rate.
- **Patience.** After the kid's fail streak, the step is marked frustrated, and the harness decides when to quit, not the model.

The game's own logger stays on, so every run is a normal session with events, a step log and a screenshot per step. `/runs.html` plays two runs side by side.

## What I learned building it

- **Watching isn't the same as knowing.** Muse agrees with itself 83% of the time. When the kids watched their own clips, they picked the same word as Muse on 5 of 20 clips and agreed on good vs bad about three times in four. Muse kept reading a quiet kid who was concentrating as bored.
- **The predictions didn't beat age alone.** I froze predictions before four check sessions. The persona was the best predictor for two kids and below chance for one, and on average it tied with knowing nothing but their age.
- **Some limits carry over to a new game and some don't.** Built only from each kid's other games, reading speed ranked the four of them right in 5 of 6 pairs and first-tap time in 4 of 6. Error rate and idling didn't carry over at all.
- **The model has to be held to the limits, not asked.** Told to play like the kid, it quit after 37 seconds reciting the kid's interview words. None of the real kids quit early. Now the harness decides.
- **Muse still reads one screen worse than a kid.** In Hoard Keeper the agents filed 39 to 47% of slips wrong, against 18 to 19% for the real kids. The harness taps right every time when it knows the answer, so the gap is the model reading a busy screen: it keeps taking a blue gem icon for a frost dragon. That's also a useful note about the game.

## Watching a playtest

```bash
npm install
npm run demo          # a fake 30-second session through the whole pipeline, no key, no spend
npm start             # recorder on http://localhost:3058/record.html
PW_LIVE=1 npm run watch -- <sessionId> --live
npm run blur          # blurred face video for the viewer
```

Copy `.env.example` to `.env.local` and put your Meta Model API key in it first. [docs/session-day.md](docs/session-day.md) is the checklist I use with my kids. Games send events with [public/playtest-log.js](public/playtest-log.js) (web) or [godot/playtest_log.gd](godot/playtest_log.gd) (Godot), and a playtest link always starts the game from the beginning.

| Stage | What it does | Model |
|---|---|---|
| align | Puts every camera, the mic and the event log on one clock | none (ffmpeg) |
| transcribe | Who said what, and when | `muse-voice-transcribe-1.0` |
| candidates | Windows worth a look: fail streaks, long idles, the kid talking, and a sweep every 60 seconds | none (rules) |
| explain | One call per window with face, hands and screen side by side, with sound. Returns what the kid was going through, with the face, voice, hands and screen evidence | `muse-spark-1.2` |
| fixes | A ranked fix list, each fix tied to the moments behind it | `muse-wonder-1.0` |

`/view.html` plays a session back with the face blurred, a timeline of moments and the fix list. `/interview.html` runs the clip-and-ideas interview from the recorder.

## Privacy

Raw recordings stay in `recordings/`, which git ignores. Only short clips and session audio go to the Meta API, every upload expires after an hour, and the client refuses any `-contributor` model id. The viewer only ever serves the blurred face. The kids are Kid A to D everywhere in this repo, and a persona never repeats a kid's own words.

## Tests

```bash
npm test
cd analysis && .venv/bin/python -m pytest -q tests
```

The Node tests use a fake model client and never call the API. The Python side needs its own virtualenv: `python3 -m venv analysis/.venv && analysis/.venv/bin/pip install -r analysis/requirements.txt`. Live play needs Google Chrome installed.
