---
name: informed-persona-testers
description: Build a persona tester from real people's data (recordings, an analytics export, a survey, profile facts), from a one-sentence description, or from a group, then run it against a web game or app held to measured limits and report what it saw, did, skipped and missed. Use when someone wants to playtest a game or flow as a specific kind of player before real players see it.
---

# Informed Persona Testers

A persona is limits, not a paragraph: how long they look before the first tap, how fast they go, how much they
read, how often they miss, how many fails before they sour. A harness holds a live Muse Spark player to them in
Chrome. Every number says where it came from: measured, self-report, guess, or a published norm by age.

## Setup

- Node 22.18+, Google Chrome, `npm install` in this repo.
- Through MCP: `claude mcp add personas -- node <repo>/src/kit/mcp.ts` (or your agent's equivalent).
  Without MCP, the same commands are `npm run persona -- <command>`.
- Live runs need `PW_LIVE=1` and a Meta Model API key in `<repo>/.env.local`. Without them the model client is
  fake and costs nothing, which is right for trying the flow.

## Build a persona: ask, don't assume

Ask the user each question yourself and pass their answers to `new_persona`. Never answer for them.

1. Is this one real person, a group of real people, or nobody real (a description)?
2. What should it be called?
3. For real people: did they agree, and a parent for anyone under 13? The tool refuses to read any data without
   this.
4. What data do they have, and where is it?
   - an event log (CSV or JSONL) plus a mapping file (copy `examples/data/events.map.yaml` and change the
     column and event names; ask the user which events mean "new screen", "tap", "wrong", "right")
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

## Limits to state before claiming anything

- First tap holds; time between actions and reading are still being validated (`results/group/validation.json`).
- With four kids, a person's play on other games picked them out at chance: limits carry over as a hint.
- Muse misreads busy screens; on canvas games check where its taps landed before blaming the game.
- Never publish a persona or run built from a real person or a family; `npm run export-results` refuses them.
- Spend is about $0.02 to $0.03 per step. Check `recordings/spend.jsonl` before a large batch.
