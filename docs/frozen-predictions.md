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
| check-d-factor-slicer | null | e75c803f4edd785cec19400aba7df82bfede30ac2531afbcd517019c7b9e1b95 | 2026-10-30T22:39:27.331Z |
| check-d-factor-slicer | baseline | d5c0c1eef2c7765add199fa38b2d1386919e4b4f45d24a9bd18b87a80681334e | 2026-10-30T22:39:27.331Z |
| check-d-factor-slicer | questionnaire | 2bd3b73b4b595b5754513b6c2f16a9761a631385d899b9a435ae83ece07453e9 | 2026-10-30T22:39:27.331Z |
| check-d-factor-slicer | persona | 2bcc68e78aa3e949d3a82626f27ddcbf1842e69069391a3f56879ec01c00c959 | 2026-10-30T22:39:27.331Z |
| check-d-factor-slicer | model | 2afec827039e1b733eff91bf80727e99557e08b09a28f6fcc1786fcad4f0d2e6 | 2026-10-30T22:39:27.331Z |
| check-d-factor-slicer | model-traits | 83c34f99d6e92cf8df4dbd2be19303600bab0f74dc9c92f7b1a7de88753e1d4c | 2026-10-30T22:39:27.331Z |
| check-d-factor-slicer | model-kid | 38831b2f1572414a692c7e1fae7c4feedf1217ce8c0e93a9f74e4526fa267b88 | 2026-10-30T22:39:27.331Z |
| check-a-current-cut | null | 0d2d944865c88ab23b8dd1d33af5d8624bb26531617833e5dc4d376e994aeec2 | 2026-10-30T22:47:34.616Z |
| check-a-current-cut | baseline | 520ad53111a9902826950b433afb92d8e5608cc6cde510476142a0b1f5f64d65 | 2026-10-30T22:47:34.616Z |
| check-a-current-cut | questionnaire | e44c0a94127fdbd5d55efbed633b8a930ab8d777395c5d6b1190e44b8658a037 | 2026-10-30T22:47:34.616Z |
| check-a-current-cut | persona | 7333d01ea09c01f9130e1a49bc3e7f6890c47e8cf15a086f57254a4e6bfcc564 | 2026-10-30T22:47:34.616Z |
| check-a-current-cut | model | 4e43775787fd7ed4279f224fefb6de0dbfe7337f8d8384be242c6d7a04b737bc | 2026-10-30T22:47:34.616Z |
| check-a-current-cut | model-traits | ec07c3b8378144fd1f6a12a8098489476c1b82a2c14dadd9cca5d0da49f28323 | 2026-10-30T22:47:34.616Z |
| check-a-current-cut | model-kid | fe16a446a347c652fbf7461f8e9bd3e920fb989d19f2346f0393cab68753e782 | 2026-10-30T22:47:34.616Z |
