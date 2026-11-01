---
name: informed-persona-testers
description: Build a persona tester from real people's play (or a one-sentence description, or a group) and run it against a web game or app, held to measured limits, then read what it saw, did, skipped and missed. Use when someone wants to playtest a game or flow as a specific kind of player before real players see it.
---

# Informed Persona Testers

A persona is limits, not a paragraph: how long they look before the first tap, how fast they go, how much they
read, how often they miss, how many fails before they sour. A harness holds a live Muse Spark player to them in
Chrome. Run everything from this repo's root.

## Setup

- Node 22.18+, Google Chrome, `npm install`.
- For live runs: copy `.env.example` to `.env.local` and add a Meta Model API key. Every run needs `PW_LIVE=1`
  and `--live`; without them the model client is fake and costs nothing (good for a dry run).
- Start the watcher so runs can log: `npm start` (port 3058). The game must be served at a URL the harness can
  open. Games that load `public/playtest-log.js` log their own events; others work, with less in the log.

## Pick the way in

Ask the user which of these they have, and don't assume:

| They have | Command shape |
|---|---|
| Recorded sessions of a player in `recordings/` | `npm run play -- <letter> --game <name>` |
| A saved persona file (a person's play plus profile facts) | `npm run play -- <letter> --persona-file <path> --limits-game <similar game>` |
| Only a description | `npm run play -- --describe "<one sentence>" --name <letter>` (read once, saved, reused) |
| A group blend file | `npm run play -- <letter> --blend <path> --seed <n>` (each run plays one real member) |

Then add `--url <game> --steps 30`. For a canvas game, also `--point` and, if the game exposes its own fail and
win counts, `--progress "<js returning {fails, wins}>"`. For a fast timing game, use
`node src/agent/action.ts` with `--keys` and `--controls` instead.

A game nobody has played has no limits of its own: `--limits-game` borrows the person's numbers from the most
similar game they did play, and the run says so. Missing numbers come from published norms by age
(`src/persona/norms.ts`, `docs/persona-norms.md`), never a guess.

## Read the result

- `recordings/<session>/steps.jsonl`: one line per step, with what it read, what it skipped, what it tapped (and
  what it meant to tap when it missed), how it felt, and what it said.
- `recordings/<session>/summary.json`: counts and the feeling mix.
- `/runs.html` shows two runs side by side, a step at a time.

Report findings as **what the persona did on which step**, quoting its step log. Its words are the model's,
not a real person's. Say which limits were measured and which came from norms or a borrowed game.

## Know the limits before you claim anything

- First tap holds; time between actions runs slow (the harness adds its own pause per step); reading and error
  rate don't compare cleanly yet (`results/group/validation.json`).
- With four kids, a person's play on other games picked them out at chance: limits carry over as a hint only.
- Muse misreads busy screens and its canvas taps land 60 to 140 px off, so a struggling canvas run may be the
  harness's aim, not the game.
- Never publish a run built from a family blend or a personal profile; `npm run export-results` refuses them.
- Spend: about $0.02 to $0.03 per step on Muse Spark. Check `recordings/spend.jsonl` before a large batch.
