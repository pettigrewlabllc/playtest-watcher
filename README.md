# Informed Persona Testers

I've built twenty-some games with AI in the last six months. Building them isn't the slow part anymore. Finding the fun is, and that takes someone actually playing. My four kids are my playtesters, and a kid can only play a game fresh once.

So this repo (Playtest Watcher) does two things. It watches a real playtest: screen, face, hands and voice, lined up with the game's own event log, with Meta's models saying what the kid was going through and writing a fix list. Then it turns what it learned into **persona testers I can send into a game nobody has played yet**. A persona isn't a paragraph about a kid. It's measured limits (how long they look before they tap, how fast they go, how much they read, how often they miss, how many fails before they sour), and a harness holds a live AI player to them.

## See it without a key

```bash
npm install
npm start          # http://localhost:3058/runs.html
```

The runs page plays persona runs from `results/runs/` side by side, a step at a time: what the persona saw, what it said, what it tapped, what text it skipped, and where a tap missed. Nothing here calls a model or needs an account.

## Four ways to build a persona

| Start from | What's measured | What's a guess |
|---|---|---|
| **Recordings and an interview** (my kids) | How they play: first tap, pace, reading, misses, fail streaks, from the game's event log and Muse Spark watching the video | What they play for, from the interview, where they watch their own clips and react to ten game ideas |
| **One person's play plus their profile** (me: my play, and what Meta's ad settings show about me) | How they play | What drives them, from profile facts. Profile facts never set how fast someone plays |
| **A sentence** ("a 16-year-old who loves science and math but doesn't like reading") | Nothing | Everything, placed inside the range real players showed, never past it |
| **A group** (all five of us as one "family" persona) | The group's middle and spread, shown on the card | Each run plays as one real member, picked by a seed, so a run is never a mix of people who don't exist |

Where a persona has no measured number, the gap is filled from **published research by age**, never a guess: reaction time and its spread (Rutter et al. 2020, 12,327 people), touch misses by age and button size (Anthony 2019), reading speed (Brysbaert 2019), how much text people actually read (Nielsen 2008). Every number, its source, and how sure we are of it is in [`src/persona/norms.ts`](src/persona/norms.ts), rendered as [docs/persona-norms.md](docs/persona-norms.md). Two defaults have no credible source and say so: how many fails before someone gets frustrated, and how much of a game's instructions people read.

## How a persona plays

Muse Spark plays the real game in Chrome, from a screenshot plus the page's buttons and text. The harness holds it to the persona so it can't play like an AI:

- **Time.** The game's clock stops while Muse thinks, then moves on by the persona's own time to act. A slow persona burns more of a timed round than a fast one.
- **Reading.** Text the persona wouldn't have read is hidden from the screenshot; Muse only gets the first few words.
- **Accuracy.** Some taps land on the button next door, or 30 to 50 px off on a picture, at the persona's miss rate.
- **Patience.** After the persona's fail streak it's frustrated, and the harness, not the model, decides when it quits.
- **Fast games.** For timing games the clock freezes every 1.2 s of game time, Muse plans up to three moves, and the harness fires them at the persona's reaction time, a little off, and sometimes not at all.

```bash
# copy .env.example to .env.local and add a Meta Model API key first
PW_LIVE=1 npm run play -- A --game hoard-keeper --url http://localhost:3054/ --live                 # a measured kid
PW_LIVE=1 npm run play -- --describe "a 16-year-old who doesn't like reading" --name T --url <game> --live
PW_LIVE=1 npm run play -- F --blend <blend.json> --seed 3 --url <game> --live                         # a group
PW_LIVE=1 npm run play -- J --persona-file <persona.json> --limits-game bond-swap --url <game> --point --live   # canvas game
PW_LIVE=1 node src/agent/action.ts A --url <game> --keys "Space,ArrowDown" --controls "Space jumps." --live      # fast game
```

Every run is logged like a real playtest: events, a step log, a screenshot per step. A described persona is read once and saved, so it's the same persona in every game.

## What the personas found

On two builds no kid had played yet:

- **Hoard Keeper, the build with my kids' fixes in it.** The oldest kid's persona got the King's question wrong, read the screen that explains why ("I left 7 slips in the pit"), and set up the next one correctly. The youngest's never read the King's question, tapped "Biggest one" because the trophy was shiny, and happened to be right. The game can't tell a lucky answer from a real one. (`results/runs/20261101-141138-*-hoard-keeper-agent`)
- **Continental Drift, changed that morning.** The one sentence that explains the game ("find the few that came from somewhere else") sits in a panel at the bottom. Both kid personas skipped it under their reading limits and spent about three minutes going after Egypt's own pyramids. The hint "look for something to eat" sent them to Egypt's own bread. (`results/runs/20261101-141138-*-continental-drift-agent`)
- **Earlier, on Hoard Keeper:** the personas kept reading a blue gem icon as a frost dragon, which is a note about the art as much as the model.

## How accurate is it

Honest numbers, every one with a file in `results/`:

- **The kids checked Muse.** Watching their own clips, they picked Muse's exact word 5 times in 20 and agreed on good vs bad about three times in four. Twice Muse read a kid concentrating as bored. (`kid-check.json`)
- **Predictions frozen before four check sessions tied with knowing only the kid's age** (kappa 0.069 vs 0.067). (`group/scoreboard.json`)
- **Does a run play at the numbers it was given?** First tap held in all 6 Hoard Keeper runs checked. Time between actions held in 1 of 6: the harness adds its own pause each step, a bug to fix. Reading and error rate don't compare cleanly yet. (`group/validation.json`)
- **Does a kid's play on other games predict them on a new one?** 19 of 76 checks picked the right kid, which is exactly chance with four kids. (`group/validation.json`)
- **Muse reads a busy screen worse than my kids.** The personas filed about a third of Hoard Keeper slips wrong, against 18 to 19% for the kids. (`group/agent-vs-kid.json`)
- **On a canvas game, Muse's taps land 60 to 140 px from what it names.** Continental Drift runs measure the harness's aim as much as the game. A labelled grid on the screenshot is the next fix.

My bet is that more measured dimensions make a persona play closer to the person. Four kids isn't enough to prove it.

## Use it from an agent

[SKILL.md](SKILL.md) tells an agent (Claude Code, Codex, Gemini CLI, Cursor) how to build a persona, run it, and read what came back. The design for the full kit (an intake that asks what data you have, a mapping file, an MCP server) is in [docs/superpowers/specs/2026-11-01-persona-kit-design.md](docs/superpowers/specs/2026-11-01-persona-kit-design.md).

## Watching a playtest

```bash
npm run demo          # a fake 30-second session through the whole pipeline, no key, no spend
npm start             # recorder on http://localhost:3058/record.html
PW_LIVE=1 npm run watch -- <sessionId> --live
npm run blur          # blurred face video for the viewer
```

| Stage | What it does | Model |
|---|---|---|
| align | Puts every camera, the mic and the event log on one clock | none (ffmpeg) |
| transcribe | Who said what, and when | `muse-voice-transcribe-1.0` |
| candidates | Windows worth a look: fail streaks, long idles, the kid talking, a sweep every 60 s | none (rules) |
| explain | One call per window with face, hands and screen side by side, with sound | `muse-spark-1.2` |
| fixes | A ranked fix list, each fix tied to the moments behind it | `muse-wonder-1.0` |

`/view.html` plays a session back with the face blurred, a timeline of moments and the fix list. `/interview.html` runs the clip-and-ideas interview. `/narrate.html` is a teleprompter for recording the demo video's narration, one take per beat.

**What you need:** Node 22.18 or newer (it runs the TypeScript directly), ffmpeg on your PATH (or `FFMPEG_PATH`), Google Chrome for live play, and a Meta Model API key in `.env.local` for anything live. Games send events with [public/playtest-log.js](public/playtest-log.js) (web) or [godot/playtest_log.gd](godot/playtest_log.gd) (Godot). Hoard Keeper is my own game and isn't public, so point `--url` at yours.

## Privacy

Raw recordings stay in `recordings/`, which git ignores. Only short clips and session audio go to the Meta API, uploads expire after an hour, and the client refuses any `-contributor` model id. The viewer only ever serves the blurred face. The kids are A to D everywhere here, with no names, faces, voices or ages. A persona's rules never carry a kid's own words, and the exporter refuses to publish a run built from a family blend or a personal profile.

## Tests

```bash
npm test        # 201 tests (12 skip without the Python venv); a fake model client, never calls the API
python3 -m venv analysis/.venv && analysis/.venv/bin/pip install -r analysis/requirements.txt
cd analysis && .venv/bin/python -m pytest -q tests
```
