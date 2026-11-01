# Demo video: narration script (for Joel to read and record)

About 3 minutes at an easy pace, roughly 430 words. Read it like you're telling a friend. Pauses are marked `/`.
The picture for each part is in brackets. No kid appears on screen or in audio (Joel's call, 2026-11-01).

---

**[0:00, two Timberline Trek runs side by side, already moving]**

These are two of my kids playing my new game. / Except they're not. Neither one of them has played it yet.

**[0:12, the four games' title screens, quick]**

I make small games, and my four kids are my playtesters. Building the games stopped being the slow part. Watching the playtests is the slow part. / And once a kid has played a game, they can't play it fresh again.

**[0:30, the viewer on Joel's own run: blurred face, hands, screen, the timeline filling in, then the fix list]**

So I built Playtest Watcher. It records the screen, the player's face, their hands and what they say, and lines it all up with the game's own log. Muse Spark watches every moment that matters and says what the player was going through. Muse Wonder turns that into the fix list I'd write if I had time to watch it twice. / That's me playing, by the way. My kids stay off camera.

**[1:00, the interview page, then the kid-check numbers: 5 of 20]**

Then I had my kids check its work. They watched their own clips and picked the word that fit. Muse matched them on the exact word only five times out of twenty. Twice it called a kid bored who was sitting still and concentrating. / That changed what I built next.

**[1:20, a persona card, then the runs page: the youngest and the oldest in Hoard Keeper]**

A persona isn't a paragraph about a kid. It's limits, measured from how they play. How long they look at a new screen before they tap. How much of the instructions they actually read. How often they miss. / A harness holds the AI to those limits. It freezes the game while the AI thinks, then moves it on by the kid's own time. Text the kid wouldn't have read gets hidden. Some taps land on the wrong button. / Here's my youngest and my oldest playing the same game. One skips the instructions and misses taps. The other reads everything.

**[1:55, the described kid's card, then its run]**

You don't even need recordings. Describe a kid in one sentence, and it places them inside the range my real kids showed.

**[2:10, back to Timberline, the key badges flashing]**

Fast games work the same way. The game stops every second while Muse plans its next moves, and the harness fires them at a reaction time for the kid's age, a little off, and sometimes not at all.

**[2:30, plain text on dark: the three results]**

Here's what didn't work. / Predictions I froze before my kids played tied with knowing nothing but their age. Muse still reads a busy screen worse than my kids do. And with four kids, nothing carried from one game to the next better than a coin flip. / So everything here is measured, logged and checkable, and the repo has the numbers.

**[2:50, end card]**

Next is testing with the people you're actually building for, with their permission. / Playtest Watcher. Built on Muse.

---

## Truth sheet (every claim, and where it comes from)

| Claim | Source |
|---|---|
| Neither kid has played Timberline Trek yet | Joel to confirm. No kid session of Timberline exists in `recordings/`. |
| Four kids, my playtesters | `recordings/kids.json` (A to D); 13 learn and 4 check sessions |
| Records screen, face, hands, voice, lined up with the game's log | `src/watch/align.ts`, `public/record.html` |
| Muse Spark labels moments; Muse Wonder writes the fix list | `src/watch/explain.ts` (`muse-spark-1.2`), `src/watch/fixes.ts` (`muse-wonder-1.0`) |
| Kids matched Muse's exact word 5 of 20 times | `results/kid-check.json` |
| Twice Muse called a concentrating kid bored | `results/kid-check.json` pairs: two "focused" (Concentrating) vs "bored" |
| Limits measured from play: first tap, reading, misses | `analysis/limits.py`, `results/group/limits.json` |
| Freezes the game while the AI thinks; moves it by the kid's time; hides unread text; misses taps | `src/agent/play.ts` (page clock, `hideSkipped`, `missTarget`) |
| The youngest skips instructions and misses taps; the oldest reads everything | `results/runs/*-a-*` (16 skipped, 6 missed) and `*-b-*` (0 skipped, 1 missed) |
| A one-sentence description lands inside the real kids' range | `src/persona/describe.ts` (`placeLevel`; ±2 goes just past the edges) |
| Fast games: plans every second, fires at an age reaction time, off a little, sometimes not at all | `src/agent/action.ts` (`lookMs` 1200, `reflexDefaults`, `schedule`) |
| Frozen predictions tied with age only | `results/group/scoreboard.json` (persona mean kappa 0.069, age-only 0.067) |
| Muse reads a busy screen worse than the kids | `results/group/agent-vs-kid.json` (about a third of slips wrong vs 18 to 19%) |
| Nothing carried game to game better than chance | `results/group/limits.json`, pooled pair orderings (spec §12) |
