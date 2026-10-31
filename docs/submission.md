# Submission draft (for Joel's sign-off)

## Name

Playtest Watcher

## One line

Watches my kids playtest my games, then turns what it saw into personas I can send into games they haven't played yet.

## The problem

I make small games and my four kids are my playtesters. Building the games stopped being the slow part. Watching the playtests is the slow part. And I only have four kids, and once one of them has played a game, they can't play it fresh again.

## What it does

It records the game screen, the kid's face, their hands and their voice, lines all of it up with the game's own event log, and has Muse Spark say what the kid was going through at each moment that matters: confused, stuck, bored, frustrated, focused, into it. Muse Wonder turns that into the fix list I'd write if I had time to watch twice.

Then it builds a persona. Not a paragraph about a kid. A set of measured limits: how long they look at a new screen before they tap, how fast they go once they're moving, how much of the instructions they actually read, how often they miss, how many fails before they sour. You can build one from recordings, from a short interview where the kid watches their own clips, or from a sentence describing a kid.

A persona plays live. Muse Spark plays the real game in a browser, from a screenshot plus the page's buttons and text, and a harness holds it to the kid's limits. The game's clock stops while the model thinks and moves on by the kid's own reaction time. Text the kid wouldn't have read is hidden. Some taps land on the wrong button. After the kid's fail streak, it's frustrated, and the harness decides when it quits. Every run is logged like a real playtest, so it can be checked against the real kid.

## How it uses Meta's models

- `muse-spark-1.2` watches every moment (face, hands and screen side by side, with sound) and is the player in live persona runs.
- `muse-voice-transcribe-1.0` separates the kid's voice from mine.
- `muse-wonder-1.0` writes the fix lists, reads the interviews, and turns a written description into a persona.

## What I found

Every number has a file in the repo's `results/` folder.

- My kids checked Muse's work. Watching their own clips, they agreed with Muse on good vs bad about three times in four, but on the exact word only 5 times in 20. Twice Muse read a kid sitting still and concentrating as bored. So the tool now asks the kid.
- Predictions I froze before four check sessions tied with knowing only the kid's age. They were scored against Muse's labels, so it's a weak test either way. That's why the persona moved from a description to measured limits that get enforced.
- With four kids, nothing carried from one game to the next better than a coin flip. It's a hint at best, and the table is in the repo.
- Told to act like a kid, the model quit after 37 seconds, reciting that kid's own interview words. None of my kids quit early. Limits have to be enforced, not requested.
- The timing holds, but the persona players read a busy screen worse than my kids do: about a third of slips filed wrong, against under a fifth for the kids. That's partly the model and partly a real design problem in the game, and the run found it.

The whole build cost $59 in Meta API calls, every call logged.

Along the way the playtests produced a ranked fix list for each of my four games, ready to go into the games.

## What's next

Personas that play any web game or app, the same harness for Claude, Gemini and other agents through one persona file, and more kids than mine.

## Demo video shot list (about 3 minutes)

1. 0:00 The problem in one line.
2. 0:15 A kid playing (face blurred), with the viewer's timeline filling in with moments (sped up; it takes a few minutes).
3. 0:40 The fix list for that session, scrolling, with one moment clicked to jump to the clip.
4. 1:00 The interview: a kid watching their own clip and picking "Concentrating" where Muse said "bored" (captions over muted audio).
5. 1:25 Two persona cards side by side (the youngest kid and the oldest): the limits, and how few traits are clearly different.
6. 1:45 The runs page replaying both personas' runs through Hoard Keeper from their step logs: one skipping text and missing taps, one reading everything.
7. 2:20 A described kid ("skips every instruction, taps really fast") built from one sentence and playing.
8. 2:40 The honest results slide, then the repo link.

Any shot with a kid in it uses the blurred face and needs Joel's OK before it's public.
