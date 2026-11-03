---
name: playtest-doubles
description: Build a persona tester from real people's data (recordings, an analytics export, a survey, profile facts), from a one-sentence description, or from a group, then run it against a web game or app held to measured limits and report what it saw, did, skipped and missed. Use when someone wants to playtest a game or flow as a specific kind of player before real players see it.
---

# Playtest Doubles

A persona is limits, not a paragraph: how long they look before the first tap, how fast they go, how much they
read, how often they miss, how many fails before they sour. A harness holds a live AI player (Muse Spark by
default, or Claude or Gemini) to them in Chrome. Every number says where it came from: measured, self-report, guess, or a published norm by age.

## Setup

- Node 22.18+ and Google Chrome. No clone needed:
  `claude mcp add playtest-doubles -- npx -y -p github:pettigrewlabllc/playtest-watcher playtest-doubles-mcp` (or your
  agent's equivalent). Without MCP: `npx -y -p github:pettigrewlabllc/playtest-watcher playtest-doubles <command>`.
  From a checkout: `node <repo>/src/kit/mcp.ts` and `npm run persona -- <command>`.
- Personas are saved in `<home>/personas/<slug>/persona.json` (earlier versions in `versions/`), runs in
  `<home>/recordings/<run>/`. Home is the repo in a checkout and `~/.playtest-doubles` when installed. The `where`
  command prints both, and `show_persona` gives the file. `PERSONAS_HOME` or `PERSONAS_DIR` moves them.
  Run ids live as long as the MCP server does, so read a finished run's `steps.jsonl` directly after a restart.
- Live runs need `PW_LIVE=1` and one model key in `<home>/.env.local` or the environment: `MODEL_API_KEY` (Meta),
  `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`. `PW_PROVIDER` picks one when several are set, `PW_MODEL` the model.
  Without a key the model client is fake and costs nothing, which is right for trying the flow (a run still needs Chrome and a game URL it can reach). The tool output
  says when it's fake.

## Build a persona: ask, don't assume

Ask the user each question yourself and pass their answers to `new_persona`. Never answer for them.

1. Is this one real person, a group of real people, or nobody real (a description)?
2. What should it be called?
3. For real people: did they agree, and a parent for anyone under 13? The tool refuses to read any data without
   this.
4. What data do they have, and where is it?
   - an analytics export (CSV or JSONL). A GA4/Firebase, GameAnalytics or Unity export needs no map: pass the path,
     and `player` if it holds several players. The card's notes list the export's most common events; to measure
     first tap and pace, write a two-line map that `extends` the preset with the user's tap event
     (`src/kit/presets/README.md`). Any other export gets a full map (`examples/data/events.map.yaml`); ask the user
     which events mean "new screen", "tap", "wrong", "right".
   - survey answers plus a mapping (`examples/data/survey.map.yaml`)
   - profile facts the person exported themselves (`examples/data/profile.yaml`)
   - recordings from this repo's recorder (`recorder`, with the recordings folder and the player's letter)
   - a one-sentence description
   - for a group: the member personas, already built

Show the card that comes back and point out which numbers were measured and which fall back to norms.

## Run it

`run_persona` with the persona, the game's URL, and for a game the persona has no numbers for, a similar game it
does (`limits_game`). For canvas games set `point`; if the game exposes its own fail and win counts, pass
`progress` as a JS expression returning `{fails, wins}`. It returns a run id; call `get_report` until it's done
(a 30-step run takes several minutes). A group plays one whole member per run, chosen by `seed`.

## Report what happened

Read the step log (`steps.jsonl`): what it read, what it skipped, what it tapped and what it meant to tap when it
missed, how it felt, what it said. Report findings as **what the persona did on which step**. Its words are the
model's, not a real person's. Say which limits were measured, borrowed from a similar game, or from norms.

## Forget one

When the user asks to delete a persona, confirm the slug with them, then call `forget_persona` with it twice
(`slug` and `confirm_slug`). It deletes the persona, every earlier version and every run it played. A group holds
full copies of its members, so a member in a group needs `with_groups` and takes the group with it; say so before
you do it. It never touches the files the persona was built from; tell the user where those are.

## Limits to state before claiming anything

- On the fixed harness, pace and reading land within 1.5x of the persona's numbers; first tap did in one of two runs. Error
  rate doesn't compare yet (`results/group/validation.json`).
- With four kids, a person's play on other games picked them out at chance: limits carry over as a hint.
- Muse misreads busy screens. Canvas taps go through a labelled grid and land on target, but check small targets.
- Never publish a persona or run built from a real person or a family; `npm run export-results` refuses them.
- On Muse Spark, spend is about $0.01 to $0.02 per step (`results/spend.jsonl` averages $0.016). Other models cost differently. Check `<home>/recordings/spend.jsonl`
  before a large batch. The accuracy numbers above are from Muse; Claude and Gemini haven't been measured.
