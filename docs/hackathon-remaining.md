# Meta hackathon: status and remaining plan (2026-11-01, Sunday night)

Due **Wed Nov 4, 9:00 PM ET (7:00 PM MT)**. Track: Indie (creativity, technical ambition, whether it works).
Spend $85.36 of the $120 stop ($150 credits), from `results/spend.jsonl`. Nothing left below needs a live run.
Repo: github.com/pettigrewlabllc/playtest-watcher, public, MIT.

## Done

- **Watching:** recorder (screen, face, hands, voice, game events), viewer, Muse Spark moments, Muse Wonder
  fix lists, voice separation. 13 learn + 4 check sessions from four kids; interviews with clip checks.
- **Persona engine:** measured limits, compiler, turn and action harnesses (frozen clock, hidden unread text,
  near-miss taps, point taps through a labelled grid for canvas games, reflexes), runs page, step logs.
- **Persona kit (merged, PR #3):** persona/2 schema with consent and quote rules, adapters (recorder, event
  export plus mapping file, survey, profile facts, one sentence, group), intake, versioned store, CLI, a local
  stdio MCP server (six tools, no hosting), CI on GitHub Actions.
- **Four ways in, all run:** kids (interview + play + video), Joel (play + profile facts, local only), a
  described 16-year-old, and a family blend (local only).
- **Published norms:** every default traced to a source (`src/persona/norms.ts`, `docs/persona-norms.md`).
- **Evidence in `results/`:** kid-check, frozen predictions (a tie with age only), fidelity on the fixed harness
  (pace 2 of 2, reading 2 of 2, first tap 1 of 2 within 1.5x; error rate not comparable), transfer at chance
  (19 of 76), agent-vs-kid, the canvas grid run (9 of 9 on target, `-grid` shots committed), spend.
- **Fresh-clone check (2026-11-01 night):** all three example answer files build in a clean clone with no key;
  a no-key build or run says it used the fake client.

## Not done, in order

1. **Joel reads the script** (`docs/video/script.md`) once, then records on the narration page
   (`npm start`, http://localhost:3058/narrate.html). Only the script needs his read before recording.
2. **Video** (Claude): cut takes to beats, add the intake beat (Puzzle Fan example and the Teen only, never a
   kid persona; under 15 s), retime captions, render through `hf.mjs`, frame-check. Frame-check adds: no
   "age", no "(N)" after a name, no clip playing, runs page captured with `?public`, cards say Player A/B.
3. **Joel confirms nobody played Timberline off-camera.** Every Timberline entry in `recordings/` is a persona
   run; there is no kid session.
4. **Joel reads README and submission** in the same sitting as the final video, then submits (sign-in, his step).

**Fallback:** if there's no narration by Tue 9 PM MT, the captions-only cut ships with the corrected captions.
**Added 2026-11-02:** analytics presets (GA4/Firebase, GameAnalytics, Unity), a forget command, `where`, npx install from GitHub, Anthropic and Gemini as model providers (not run live).
**Cut, decided:** validation on each card, a mobile harness, new live runs.
