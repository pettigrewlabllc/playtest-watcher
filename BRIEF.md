# Playtest Watcher — starting brief

Written 2026-10-26 from the session that found the hackathon approval. Read this first.

## What it is

Joel's application to the **Meta Global AI Developer Hackathon** (Cerebral Valley), accepted 2026-10-26:

> I make small games and my kids are the playtesters. Building the games isn't the bottleneck anymore. Watching the recordings is. Playtest Watcher records three things at once: the game screen, the player's face, and the player thinking out loud. It transcribes what they say, lines all three up, and marks every moment they got confused, stuck, bored or delighted, tied to what was on screen at that second. Then it writes the fix list I'd write if I'd had time to watch it twice. Over many sessions it builds player personas from what real players actually did, so the next build can be tested against them before a kid ever picks it up.

## Hackathon facts (from the event page and emails, 2026-10-26)

- Runs Mon Oct 26 12:00 PM ET to **Wed Nov 4 9:00 PM ET** (7 PM MT). Submissions are due then. Judging runs Nov 4 to 8, and winners are announced Nov 9.
- Kickoff livestream is Oct 26 at 12 PM ET. Workshops and Discord office hours run Oct 27 to Nov 4.
- The problem statements and schedule are at cerebralvalley.ai/e/meta-ai-developer-hackathon/details. That page needs a sign-in: Joel's, Google, pettigrewlabllc@gmail.com. Never sign in for him.
- Tracks: **Indie** (solo; judged on creativity, technical ambition, whether it works) or **Startup** (judged on execution, holds up in production). Indie is the likely fit.
- Themes: "Build for Your World" (a problem you know firsthand). This project fits it exactly.
- Required: Meta models via the Meta Model API. The listed models are Muse Spark series, Muse Wonder, Muse Image, SAM 3.1 and Meta open weights, plus the Muse Code agent. Verify what each one actually does (vision, audio, video input) from the official docs before designing around it.
- Credits: $150 Meta API credits by form (Joel only; a credit card is needed on his Meta account; claim by Nov 4). Partners give select participants Baseten $100, Modal $100 and Fireworks $25. No spend beyond credits without Joel's OK (see `joel-spending-trust` memory).

## Decided so far

- **Devices: phone, iPad or laptop, depending on the game.** Capture has to work on all three. That is the first design question to settle.
- **Use the games' own event logs.** Fleet games already write timestamped play logs (epoch ms). For example, `pettigrew-lab/docs/superpowers/prototypes/snack-lob/playtests/*.json` log every `run/land/throw/fed/miss/lick/mission/stage` event, and the `.txt` files there are Joel's hand-written kid playtest notes beside the log. Aligning face, voice and screen to the game's event log beats guessing "what was on screen" from pixels, and those files are ready-made test data.
- **Personas:** the fleet already has a `persona-panel` skill (cast personas run cold against products). The "personas from real play" half should feed or replace that panel's casting, not duplicate it.

## Constraints

- **The players are Joel's children.** Faces and voices are sensitive. Keep raw recordings local and out of git (gitignore a `recordings/` dir). Send to the Meta API only what the analysis needs. Check Meta's data terms for retention and training use before uploading kid video. Nothing goes in a public demo without Joel's say-so. One son's photos already live outside every repo by rule (`private-refs/`), and the same care applies here.
- Fleet rules apply: never push without Joel's approval, never pin a model in image gen, and user-facing copy goes through `joel-voice`. The scope is 9 days, so YAGNI hard. The demo has to *work*.
- Pick a free dev port from the workspace CLAUDE.md port table (the next free one is around 3058) and add it to the table.

## Next step

Continue the `superpowers:brainstorming` flow already started: one question at a time, then 2–3 approaches, design approval, a spec at `docs/superpowers/specs/2026-10-26-playtest-watcher-design.md`, then `writing-plans`. The first open question is how to capture the screen, face and voice together on phone, iPad and laptop.
