# Before-you-play questions (draft for Joel's sign-off)

Each kid answers once, before their first session. It takes about 3 minutes. Each question has two answers, and the kid picks the one that's more like them. There's no "both" option on purpose, because a forced pick tells us more. Joel can read them aloud for a younger kid.

The axis column is internal. Kids never see it.

| # | Question | A | B | Axis (A end / B end) |
|---|---|---|---|---|
| 1 | You start a new game. What do you do first? | Poke around and see what everything does. | Find out what I'm supposed to do and do it. | explore / finish |
| 2 | There's a door off to the side that doesn't go toward the goal. | Go in. Obviously. | Skip it. Maybe I'll come back. | explore / finish |
| 3 | A game shows you a page of instructions. | I read it. | I skip it and figure it out. | read / try |
| 4 | You're stuck. What helps most? | Reading the hint. | Trying stuff until something works. | read / try |
| 5 | Which sounds better? | A really hard level I beat on the tenth try. | An easy level that's fun the whole way. | challenge / chill |
| 6 | You lose three times in a row. | Try again. I've almost got it. | Go do something else for a while. | stick with it / walk away |
| 7 | A game gets hard really fast. | Now I want to beat it even more. | I'm kind of done with it. | stick with it / walk away |
| 8 | What makes you want to play a game? | It looks cool. | It has a cool trick to figure out. | look / system |
| 9 | Pick one. | Unlocking every character and look. | Figuring out the best way to win. | look / system |
| 10 | You beat a hard level. | Show somebody right away. | Just keep going. | show / solo |
| 11 | How do you like to play? | Fast. I figure it out as I go. | Slow. I think before I move. | fast / careful |
| 12 | A game with no score and no winning, just stuff to mess around with. | Sounds fun. | What's the point? | explore / finish |

One open question at the end, answered out loud and recorded with the session audio:

> What's your favorite game right now, and what's the best part of it?

## How it's scored

Each axis gets a score from -1 (all A) to +1 (all B), averaged over its questions. Explore/finish has three questions (1, 2, 12), stick with it/walk away has two (6, 7), and so on. Answers are saved locally to `recordings/kids/<letter>/questionnaire.json` and never committed.

These questions describe how a kid likes to play. They aren't a personality test, and nothing in the project calls them one.

## How it's used

The questionnaire is what the kid **says**. The play fingerprint is what the kid **does**. The analysis compares the two on the same axes. Where they disagree ("says they skip instructions, but read every Compendium entry") is one of the more interesting things we can show. The questionnaire also gives the reaction model a starting point before it has much play data.
