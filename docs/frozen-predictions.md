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
| check-c-bond-swap | null | 993031fd0d86c80fb3f042ae537bb7539129f23dd551266258465d89b475afe8 | 2026-10-30T22:35:45.208Z |
| check-c-bond-swap | baseline | c06e1ac3be872f9bd8e91095810ed8381ab773190bc5cee7f3a164977aa85939 | 2026-10-30T22:35:45.208Z |
| check-c-bond-swap | questionnaire | 226632f816be39c92815fd0bcb7a91df9dbdde0360e6872f092651d719cab964 | 2026-10-30T22:35:45.208Z |
| check-c-bond-swap | persona | 0ecf36016e4a2a9e9f224787437d77f0739ead2ecd63dea0ae9d0d9b86f4c353 | 2026-10-30T22:35:45.208Z |
| check-c-bond-swap | model | 1c3cea578fe8ee78bb4b2b2b77d05366c520b39748266d657317dd54ab6f0430 | 2026-10-30T22:35:45.208Z |
| check-c-bond-swap | model-traits | 99828c97cb41e1819960594c8e105bd4eff35b97d0adb1fb7360cea9a759b33b | 2026-10-30T22:35:45.208Z |
| check-c-bond-swap | model-kid | bb66e60ae9aa3cf02ed96ed1cd87d015027aeacaacff328bff22082ef4bd5338 | 2026-10-30T22:35:45.208Z |
