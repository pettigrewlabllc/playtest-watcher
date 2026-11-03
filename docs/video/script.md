# Demo video: narration script (for Joel to read and record)

About 3 minutes 10 at an easy pace, roughly 640 words. The picture stretches to fit your read, so go at your own pace. Read it like you're telling a friend. Pauses are marked `/`.
The picture for each part is in brackets. No kid appears on screen or in audio (Joel's call, 2026-11-01).
It runs in STAR order: the situation, the job, what I built, and what came out of it.

---

## Situation

**[0:00, two Timberline Trek runs side by side, already moving]**

These are two of my kids playing one of my new games... well kind of.  Cause they aren't.   When this was taken none one of them had played it yet.

**[0:10, the games' title screens, fast]**

In the last six months I've built twenty-some games with AI. I can code some... but I was never good at it.  Agentic coding lets me build and test, and play with ideas.   Vibe coding turns into slop when it isnt tested and the system is trusted too much.   Creativity is enabled with vibe coding and its fun. Ideas come out fast.  Building isn't the long part anymore. Finding the fun is.

## Task

**[0:28, plain text on dark]**

The first time you play a game, you’re figuring out the rules. I have four kids, they’re amazing playtesters, but they can only do that once. / The games are mine from before this hackathon. What I built this week is a way to make that first play as good a lesson for me as it is fun for them.

## Action

**[0:40, the viewer on Joel's own run: blurred face, hands, screen, the timeline filling in, then the fix list]**

Playtest Watcher records the screen, the player's face, their hands and what they say, all lined up with the game's own log. Muse Spark watches the moments that matter. Muse Wonder writes the fix list. / That's me playing, by the way. My kids stay off camera.

**[0:58, the interview page, then 5 of 20]**

After we did the recording and review, my kids checked the labels and accuracy to tune the model. They watched their own clips and picked the word that fit. Problem is my kids, in that environment look awkward.  Muse match rate was less then 50%. More then once it called a kid bored who was concentrating.  So I stopped trying to read faces for this persona builder.

**[1:14, the two persona cards, then their Hoard Keeper steps side by side]**

A persona is built from how a kid plays and what drives them. How long they look before they tap. How much they read. How often they miss. What they told me keeps them going. / A harness holds the AI to those limits. The game freezes while it thinks, then moves on at the kid's speed. Text the kid wouldn't read gets hidden. Some taps land on the wrong thing.

**[1:40, the four ways in, then Timberline with key badges]**

We used 4 different inputes to build the personas.  We got real data about game play, we had video of body language and hand placement analyzed by Muse, we had interviews with the kids, my facebook profile info, and we anchored baselines against published standards.  / This enables a developer to create a persona with the data they have.  If its just a made up persona, they can do that, but it gets more accurate by adding data.  This works for picking games, strategy games, and fast runner games work too, at a reaction time for their age.

**[1:52, a terminal: a persona built from an analytics export, its card, then the six MCP tools]**

You don't need my recorder to build a persona. Hand this tool an analytics export, a survey or a few profile facts. It asks for consent before it reads anything, and the card says which numbers were measured and which came from research. / Any agent that speaks MCP can build one, run it on your game and read the report.

## Result

**[2:04, Hoard Keeper, the new build: Player B's "machine was right" screen, Player A's blank question]**

“One of our games is a dragon game that secretly teaches SQL. Hoard Keeper was my kids’ least favorite game we’ve made. They didn’t understand it. We used the personas to drive the changes, clearer screens and better focus. They aren’t perfect, but after the fixes my daughter played it for thirty minutes before I made her turn it off.”

**[2:26, Continental Drift: the game's own screen, then the persona's, with tap rings]**

Another game: find the things in a country that came from somewhere else. That one sentence was buried at the bottom. The personas skipped it, the way my kids would, and spent three minutes clicking on Egypt’s own pyramids. So I fixed it before my kids burned their first play.

**[2:46, plain text on dark: what didn't work]**

It’s open source and it runs on your own machine. Bring an analytics export and a model key, from Meta, Claude or Gemini, and you can send a persona into your game tonight. Nothing to host.

**[3:00, end card]**

Every game I build can go through this loop. My kids play it, and I make it better. And anyone trying to make their agentic coding a little less sloppy can do the same.

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
| Build from an analytics export, a survey or profile facts | `src/kit/adapters.ts` (`fromEvents`, `fromSurvey`, `fromProfile`); the numbers on screen are the real output of `npm run persona -- new --answers examples/answers/analytics-player.yaml` (made-up example data), laid out as a table |
| Consent before anything is read | `src/kit/intake.ts` (`checkConsent` runs first in `buildPersona`) |
| The card says measured vs research | `renderCard`: each number tagged `measured, n=` or `from norms by age` |
| Any agent that speaks MCP; six tools on the card | `src/kit/mcp.ts` (list, show, new, validate, run, get_report, plus forget_persona added after the cut), a local stdio server |
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
