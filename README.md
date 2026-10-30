# Playtest Watcher

I make small games and my kids are the playtesters. Building the games stopped being the slow part a while ago. Watching the recordings is the slow part.

Playtest Watcher records the game screen, the player's face, their hands and what they say out loud, all at once. It lines those up with the game's own event log, finds the moments worth a look, and asks Meta's models what the kid was going through at each one: confused, stuck, bored, frustrated, focused, engaged or delighted. Then it writes the fix list I'd write if I'd had time to watch the session twice.

After a few sessions it builds a persona for each kid from what they actually did, so the next build can be checked against them before a kid picks it up. That second half is the experiment, and it isn't proven yet. More on that below.

## Try it in two minutes, no key needed

You need Node 22.18 or newer (it runs the TypeScript directly) and ffmpeg on your path.

```bash
npm install
npm run demo
```

The demo makes a 30-second fake session (test-pattern video, a sine tone for audio, and a scripted event log where the player fails the same move four times and then goes idle) and runs the whole watch pipeline on it with a fake model client. It spends nothing. The labels and fixes it prints are canned, so it shows you the shape of the output, not real analysis. Everything it writes lands in `demo-out/session/`.

## Run it for real

1. Copy `.env.example` to `.env.local` and put your Meta Model API key in it.
2. `npm start` serves the recorder on http://localhost:3058. Open `/record.html` in Chrome, pick the cameras, share the game window, and play. [docs/session-day.md](docs/session-day.md) is the checklist I use with my kids.
3. Games send events to the server with a small script ([public/playtest-log.js](public/playtest-log.js) for web games, [godot/playtest_log.gd](godot/playtest_log.gd) for Godot). That's optional, but without events the tool can only go on speech and a timer.
4. Analyze a session:

```bash
PW_LIVE=1 npm run watch -- <sessionId> --live
```

Every stage writes its own file in the session folder, and a rerun skips stages that are already done. `--force <stage>` reruns that stage and everything after it.

## What happens to a session

| Stage | What it does | Model |
|---|---|---|
| align | Puts every camera, the mic and the event log on one clock | none (ffmpeg) |
| transcribe | Who said what, and when | `muse-voice-transcribe-1.0` |
| candidates | Picks windows worth a look: fail streaks, long idles, the kid talking, plus a sweep every 60 seconds so a quiet bored stretch still gets looked at | none (rules) |
| explain | One call per window with a side-by-side clip (face, hands, screen, with sound), the transcript and the game events. Returns a label, a runner-up label, confidence, where the kid was looking, whether they asked for help, whether they understood the goal, and the face, voice, hands and screen evidence | `muse-spark-1.2` |
| fixes | Turns the moments into a ranked fix list, each fix tied to the moments behind it | `muse-wonder-1.0` |

Spark 1.2 is on purpose. The 1.3 docs say its audio understanding is worse, and what the kid says out loud is half the signal.

## Personas and predictions

`npm run predict -- <command>` runs the second half. `npm run predict` on its own prints every command.

- `traits` estimates each kid's play traits (pace, persistence, recovery after a fail, how much they explore, and a few more), each with a 90% range, against the other kids on the same game.
- `persona <letter> --live` has Muse Wonder read the kid three ways (game designer, learning scientist, UX researcher), drops any claim that doesn't cite a real moment or a real trait, and combines what's left into one persona. If the result comes back empty or full of internal field names, it gets rejected and asked again.
- `predict` and `freeze` make predictions for a game the kid hasn't played yet and commit their hashes before the kid plays it, so nobody can tune the predictions after seeing the result.
- `logo <letter>` holds out one game at a time and scores every predictor against what really happened.
- `stability --live` asks Muse about the same clips twice and reports how often it gives the same label.

## What's honest to say right now

- Muse's labels are the ground truth here. I tried labelling clips by hand and agreed with Muse on about one in sixteen, mostly because I'm bad at it. So the labels are only checked against Muse itself (`stability`), not against a person.
- The data is small: four kids, four games, thirteen sessions of about ten minutes each.
- "Confused" is by far the most common label, and the per-kid reaction model is near chance so far. A predictor that always guesses the same thing may well win the scoring. If it does, that's the result.
- The viewer page and the face blur for it aren't built yet. Nothing with a kid's face goes anywhere public.

## Privacy

Raw recordings stay in `recordings/`, which git ignores. Only short moment clips and session audio go to the Meta API, every upload expires after an hour and is deleted once it's analyzed, and the client refuses any `-contributor` model id. The kids are Kid A to D everywhere in this repo.

## Tests

```bash
npm test
cd analysis && .venv/bin/python -m pytest -q tests
```

The Node tests run on a fake model client and never call the API. The Python side (`analysis/`) needs its own virtualenv: `python3 -m venv analysis/.venv && analysis/.venv/bin/pip install -r analysis/requirements.txt`.
