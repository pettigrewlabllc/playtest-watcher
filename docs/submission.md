# Submission draft (for Joel's sign-off)

## Name

Informed Persona Testers (repo: playtest-watcher)

## One line

Persona testers built from how real people actually play, held to their measured limits, so I can playtest a game nobody has played yet.

## The problem

I've built twenty-some games with AI in the last six months. Vibe coding is fun and ideas come out fast, but vibe slop is what you get when nobody plays it enough. Building isn't the long part anymore. Finding the fun is. My four kids are my playtesters, and a kid can only play a game fresh once.

## What it does

It watches a real playtest: the game screen, the kid's face, hands and voice, lined up with the game's own event log. Muse Spark says what the kid was going through at each moment that matters, and Muse Wonder writes the fix list I'd write if I had time to watch twice.

Then it builds persona testers. Not a paragraph about a kid. Measured limits: how long they look before they tap, how fast they go, how much they read, how often they miss, how many fails before they sour. There are four ways in:

- **Recordings and an interview.** My kids, measured from their play, with what they play for in their own words.
- **One person's play plus their profile.** Me: my own play, and what Meta's ad settings show about me. Profile facts only tilt what drives the persona, never how fast it plays.
- **A sentence.** "A 16-year-old who loves science and math but doesn't like reading." Placed inside the range real players showed.
- **A group.** All five of us as one family persona. Each run plays as one real member, so it's never a mix of people who don't exist.

Where a persona has no measured number, the gap comes from published research by age (reaction time, touch accuracy, reading speed, how much people read), each with its source in the code.

A persona plays live. Muse Spark plays the real game in a browser and a harness holds it to the limits: the game's clock stops while the model thinks, text the persona wouldn't read is hidden, some taps miss, and the harness decides when it quits. Fast timing games get the same treatment at the persona's reaction time.

## How it uses Meta's models

- `muse-spark-1.2` watches every moment (face, hands and screen side by side, with sound) and is the player in every persona run.
- `muse-voice-transcribe-1.0` separates the kid's voice from mine.
- `muse-wonder-1.0` writes the fix lists, reads the interviews, and turns a sentence into a persona.

## What it found

On two builds no kid had played yet:

- In Hoard Keeper, one kid's persona never read the King's question, picked the biggest trophy because it was shiny, and happened to be right. The game can't tell a lucky answer from a real one.
- In Continental Drift, the one sentence that explains the game sits in a panel at the bottom. Both kid personas skipped it and spent three minutes going after Egypt's own pyramids. The hint then sent them to Egypt's own bread.

Two fixes before a kid ever saw either build. The playtests with my kids also produced a ranked fix list for each of four games.

## How accurate it is

Every number has a file in the repo's `results/` folder.

- My kids checked Muse's work: they picked its exact word 5 times in 20, and agreed on good vs bad about three times in four.
- Predictions frozen before four check sessions tied with knowing only the kid's age.
- Once I fixed the harness, pace and reading held within 1.5x of the persona's numbers in every committed run (2 of 2), and first tap in 1 of 2. Error rate doesn't compare yet: the setting is a missed tap, and the game counts wrong answers.
- With four kids, a kid's play on other games picked them out at chance. Limits carry over as a hint only.
- Muse reads a busy screen worse than my kids do.
- On a canvas game its taps used to land well off what it aimed at. A labelled grid on the screenshot fixed that in the one run I've tried: 9 of 9 on target, all of them big targets.

My bet is that more measured dimensions make a persona play closer to the person. Four kids isn't enough to prove it, and I'd rather say that than oversell it.

## Why Meta

Meta already sees how people actually use things: where they scroll past, what they skip, where they give up. Fed into this engine, that's a way to test a new feature against the people it's for before it ships.

I'd do it in a way that holds up. Personas built from groups, like first-time users on older Android phones or teens who skip onboarding text, never a copy of one person. Real people only by opting in, the way my kids did, with the persona staying theirs. Quest and Horizon first, where developers are already Meta's customers and need testers.

And it doesn't need anyone's data to work at all. Describe a kid in one sentence and it builds them inside a range real kids showed. The data makes it sharper. It isn't what makes it possible.

## What's next

The intake, the persona schema and the MCP server shipped this week. Next is more people than my family, presets for the common analytics tools so nobody has to write a mapping file, and phones.

## Cost

About $85 in Meta API calls for the whole build, every call logged in `results/spend.jsonl`.

## Video

About 3 minutes, narrated by me. No kid appears on screen or in audio. The beats and every claim's source are in [docs/video/script.md](video/script.md).
