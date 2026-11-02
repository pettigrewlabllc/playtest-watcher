# Demo video: narration script (for Joel to read and record)

About 3 minutes 10 at an easy pace, roughly 640 words. The picture stretches to fit your read, so go at your own pace. Read it like you're telling a friend. Pauses are marked `/`.
The picture for each part is in brackets. No kid appears on screen or in audio (Joel's call, 2026-11-01).
It runs in STAR order: the situation, the job, what I built, and what came out of it.

---

## Situation

**[0:00, two Timberline Trek runs side by side, already moving]**

These are two of my kids playing my new game. / Except they're not. Neither one of them has played it yet.

**[0:10, the games' title screens, fast]**

In the last six months I've built twenty-some games with AI. Vibe coding is fun. Ideas come out fast. / But vibe slop is what you get when nobody checks it and plays it enough. Building isn't the long part anymore. Finding the fun is.

## Task

**[0:28, plain text on dark]**

My four kids are my playtesters, and a kid can only play a game fresh once. / So the job was to shorten that loop. A tester that plays like one of my kids, any time, on a game they've never seen.

## Action

**[0:40, the viewer on Joel's own run: blurred face, hands, screen, the timeline filling in, then the fix list]**

Playtest Watcher records the screen, the player's face, their hands and what they say, all lined up with the game's own log. Muse Spark watches the moments that matter. Muse Wonder writes the fix list. / That's me playing, by the way. My kids stay off camera.

**[0:58, the interview page, then 5 of 20]**

Then my kids checked its work. They watched their own clips and picked the word that fit. Muse matched them five times out of twenty. Twice it called a kid bored who was concentrating. / So I stopped trying to read faces.

**[1:14, the two persona cards, then their Hoard Keeper steps side by side]**

A persona is built from how a kid plays and what drives them. How long they look before they tap. How much they read. How often they miss. What they told me keeps them going. / A harness holds the AI to those limits. The game freezes while it thinks, then moves on at the kid's speed. Text the kid wouldn't read gets hidden. Some taps land on the wrong thing.

**[1:40, the four ways in, then Timberline with key badges]**

I built them four ways: my kids' play and interviews, my own play plus what Meta's ad settings say about me, one sentence about a made-up 16-year-old, and all five of us as one family. / Where nothing's measured, the gaps come from published research by age, and the source is in the code. Fast games work too, at a reaction time for their age.

**[1:52, a terminal: a persona built from an analytics export, its card, then the six MCP tools]**

You don't need my recorder to build one. Hand it an analytics export, a survey or a few profile facts. It asks for consent before it reads anything, and the card says which numbers were measured and which came from research. / Any agent that speaks MCP can build one, run it on your game and read the report.

## Result

**[2:04, Hoard Keeper, the new build: Player B's "machine was right" screen, Player A's blank question]**

Hoard Keeper got four rounds of fixes from my kids' playtests. Then the personas played the new build. / One kid's persona got the King's question wrong, read the screen that says why, and said, "I left seven slips in the pit." / Another one never read the King's question. It tapped Biggest because the trophy was shiny... and that happened to be right. The game can't tell a lucky answer from a real one yet.

**[2:26, Continental Drift: the game's own screen, then the persona's, with tap rings]**

Continental Drift had just changed, and no kid had played that build. / The one sentence that explains it sits in a panel at the bottom: find the few things that came from somewhere else. Both personas skipped it, and spent three minutes going after Egypt's own pyramids. Then the hint said look for something to eat, and they went after Egypt's own bread. / That's two fixes before a kid ever sees it.

**[2:46, plain text on dark: what didn't work]**

Here's what didn't work. / Predictions I froze before my kids played tied with knowing nothing but their age. Once I fixed the harness, pace and reading held. First tap held in one run out of two. And with four kids, nothing carried from one game to the next better than a coin flip.

**[3:00, end card]**

Every game I build goes through this loop, so making it shorter is a big deal. My bet is the more dimensions a persona has, the closer it plays to the kid. Four kids isn't enough to prove that yet. / Next is testing with the people you're building for, with their permission. / Informed Persona Testers. Built on Muse.

---

## Truth sheet (every claim, and where it comes from)

| Claim | Source |
|---|---|
| Neither kid has played Timberline Trek yet | Joel to confirm. No kid session of Timberline exists in `recordings/`. |
| Twenty-some games in six months | Joel, 2026-11-01 ("something like 20-25 games... in the last six months") |
| Four kids, my playtesters | `recordings/kids.json` (A to D); 13 learn and 4 check sessions |
| Records screen, face, hands, voice, lined up with the game's log | `src/watch/align.ts`, `public/record.html` |
| Muse Spark labels moments; Muse Wonder writes the fix list | `src/watch/explain.ts` (`muse-spark-1.2`), `src/watch/fixes.ts` (`muse-wonder-1.0`) |
| Kids matched Muse's exact word 5 of 20 times; twice "bored" for concentrating | `results/kid-check.json` |
| Limits measured from play; drives from the interview | `analysis/limits.py`, `results/group/limits.json`; `src/persona/build.ts` (`drives`) |
| Freezes the game while the AI thinks; hides unread text; misses taps | `src/agent/play.ts` (page clock, `hideSkipped`, `missTarget`, `missPoint`) |
| Describe a kid in one sentence | `src/persona/describe.ts` (`placeLevel`) |
| Fast games at an age reaction time | `src/agent/action.ts` (`reflexDefaults`, `schedule`) |
| Build from an analytics export, a survey or profile facts | `src/kit/adapters.ts` (`fromEvents`, `fromSurvey`, `fromProfile`); the card on screen is the real output of `npm run persona -- new --answers examples/answers/analytics-player.yaml` (made-up example data) |
| Consent before anything is read | `src/kit/intake.ts` (`checkConsent` runs first in `buildPersona`) |
| The card says measured vs research | `renderCard`: each number tagged `measured, n=` or `from norms by age` |
| Any agent that speaks MCP; six tools | `src/kit/mcp.ts` (list, show, new, validate, run, get_report), a local stdio server |
| Hoard Keeper got four rounds of fixes from the kids' playtests | hoard-keeper commits f86f0d6, c24f871, 3486547, 40ff7eb ("Kid playtest 1-4"); the build played is bae1914 |
| Player B: "I left 7 slips in the pit", then set up the Storm-only question | run `20261101-141138-b-hoard-keeper-agent`, steps 34 to 40. The "why" screen dates from build 3 (560422d), not the kids' fixes, so the script doesn't credit them for it. |
| Player A skipped the King's question, tapped Biggest "shiny", and Biggest was what the King asked | run `20261101-141138-a-hoard-keeper-agent`, steps 39 and 40 (`skipped` holds "What was the BIGGEST single haul...") |
| Continental Drift changed this morning; no kid has played this build | pettigrew-lab commit c623cc4d (2026-11-01 07:01); no Continental Drift kid session in `recordings/` |
| Both personas skipped the one explaining sentence | runs `20261101-141138-a/b-continental-drift-agent`, step 2 onward (`skipped`: "Lit up green on the map. Almost everything here is from Egypt...") |
| About three minutes going after Egypt's own things; the food hint | same runs: 3.6 and 3.1 minutes of game time; what each said it was aiming at (pyramid, flatbread); "Hint: look for something to eat." from step 6 (B). These runs predate the grid fix: Muse's tap points landed 60 to 140 px off what it named, so the claim is about intent, not where taps landed. With the grid, 9 of 9 landed (run `20261101-230511-t-continental-drift-agent`, big targets only). |
| Four ways in: kids, Joel's play plus Meta ad-settings facts, one sentence, a five-person family blend | `src/persona/{build,load,describe,blend}.ts`; Joel's and the family's runs stay local (their files carry personal details) |
| Gaps come from published research by age, sources in the code | `src/persona/norms.ts`, `docs/persona-norms.md` |
| Pace and reading hold on the fixed harness; first tap in one of two | `results/group/validation.json` "fixed": action gap 2 of 2, read share 2 of 2, first tap 1 of 2 within x1.5 (before the fix: action gap 1 of 6) |
| Frozen predictions tied with age only | `results/group/scoreboard.json` (persona mean kappa 0.069, age-only 0.067) |
| Muse reads a busy screen worse than the kids | `results/group/agent-vs-kid.json` (about a third of slips wrong vs 18 to 19%) |
| Nothing carried game to game better than chance | `results/group/validation.json`: 19 of 76 checks, chance 19 |
| More dimensions, closer to the kid | Joel's bet, stated as a bet. Not shown by these results. |
