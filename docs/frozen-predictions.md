# Frozen predictions

SHA-256 hashes of each predictor's output for a check round, committed before that check session is recorded. Hashes only: the predictions themselves stay in `recordings/`.

## Pre-registered analysis

Written before any check session is scored (freeze adds it if it is missing, and refuses once a check score exists). It does not change after that.

- **Primary metric:** stage-level Cohen's kappa on the check session, between each predictor's top label per stage and the most common real label per stage (`none` where a stage has none), at a matched budget: every predictor, `null` included, gives at most 2 reactions per stage. One number per predictor per check round; `null` is the floor.
- **Presentation:** per check session, paired hit/miss counts per predictor over the same real moments (a hit is a predicted reaction that matches the moment), with the split against `null`: both hit, only this predictor, only `null`, neither.
- **Read beside reliability:** the scoreboard prints the label reliability line first. Below kappa 0.6 between the hand labels and Muse's, no prediction score is taken as meaningful.
- Everything else (recall, precision, mix, AUC, leave-one-game-out, traits transfer) is secondary.

| Check | Predictor | SHA-256 | Frozen at |
| --- | --- | --- | --- |
