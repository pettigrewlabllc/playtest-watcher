# Persona norms: where the defaults come from

Generated from `src/persona/norms.ts` by `npm run norms-doc`. Do not edit by hand.

A persona's own measured numbers always win. These published norms only fill gaps (a described persona, or a
person with no recording of a fast game), and every run that leans on one says so in its log.

## Defaults by age

| Age | Reaction (ms) | Timing spread (ms) | Tap miss | Reading (wpm) | Reading (ms/char) |
|---|---|---|---|---|---|
| 6 | 333 | 149 | 12% | 80 | 125 |
| 8 | 322 | 141 | 12% | 115 | 87 |
| 10 | 310 | 133 | 12% | 158 | 63 |
| 12 | 299 | 124 | 11% | 185 | 54 |
| 14 | 288 | 116 | 11% | 204 | 49 |
| 16 | 290 | 107 | 11% | 224 | 45 |
| adult | 301 | 104 | 3% | 238 | 42 |

Ages under 10 extrapolate the reaction-time slope below the youngest age measured, and under 7 reuse the
touch value for 7-10. Both are labelled that way in run logs.

## Each norm and its sources

### How soon a move can land after something appears (action mode) (`reaction_ms`)

Used by: src/agent/action.ts reflexFor().

age 14 288 ms (fastest); +5.7 ms a year younger (measured to 10, extrapolated below); +1 ms a year older. Lab hardware reads about 70 ms faster (Woods 2015: 213 to 231 ms for adults).

Web-based norms include device latency, which matches a browser harness better than lab numbers.

- Rutter, Vahia, Forester, Ressler & Germine (2020). Heterogeneous indicators of cognitive performance and performance variability across the lifespan. Frontiers in Aging Neuroscience 12:62. N=12,327, ages 10-70, web-based (device latency included, like our harness). [read in the source itself] https://doi.org/10.3389/fnagi.2020.00062 ("breakpoint at 14 years (age of best performance)")
- Woods, Wyma, Yund, Herron & Reed (2015). Factors influencing the latency of simple reaction time. Frontiers in Human Neuroscience 9:131. N=1,469 adults 18-65, lab hardware. [read in the source itself] https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2015.00131/full ("231, 213 ms when corrected for hardware delays")

### How far off a planned move lands (action mode) (`timing_sd_ms`)

Used by: src/agent/action.ts reflexFor().

100 ms at 17.8 (steadiest); +4.2 ms a year younger; +0.44 ms a year older.

- Rutter, Vahia, Forester, Ressler & Germine (2020). Heterogeneous indicators of cognitive performance and performance variability across the lifespan. Frontiers in Aging Neuroscience 12:62. N=12,327, ages 10-70, web-based (device latency included, like our harness). [read in the source itself] https://doi.org/10.3389/fnagi.2020.00062 ("breakpoint at 14 years (age of best performance)")

### A tap that lands on the neighbouring button (turn mode) (`tap_miss`)

Used by: src/persona/compile.ts default error_rate.

9.5 mm button: ages 7-10 12%, 11-13 11%, 14-17 11%, adults 3%. Smaller 6.4 mm targets: 31%, 17%, 21%, 12%.

Motor misses only; a measured error rate (which includes wrong answers) replaces it.

- Anthony, L. (2019). Physical dimensions of children's touchscreen interactions: lessons from five years of study on the MTAGIC project. International Journal of Human-Computer Studies 128. Appendix B, smartphone, first-attempt misses. [read in the source itself] https://doi.org/10.1016/j.ijhcs.2019.02.005 ("Children miss more often than adults, and have more trouble with smaller targets")

### Reading speed, for read_ms_per_char (`reading_wpm`)

Used by: src/persona/compile.ts default read_ms_per_char.

Silent wpm by grade 1-12: 80, 115, 138, 158, 173, 185, 195, 204, 214, 224, 237, 250; adults 238 (non-fiction), range 175-300. The popular "300 wpm average" is unsupported.

Converted at about 6 characters per word including the space.

- Brysbaert, M. (2019). How many words do we read per minute? A review and meta-analysis of reading rate. Journal of Memory and Language 109:104047. 190 studies, 18,573 readers; school grades from Taylor (1965), Table 4, which Brysbaert notes is optimistic. [read in the source itself] https://doi.org/10.1016/j.jml.2019.104047 ("238 words per minute (wpm) for non-fiction and 260 wpm for fiction")

### Share of instruction text a person reads (`read_share`)

Used by: src/persona/compile.ts default read_share.

Default 0.5. Adults read at most 28% of a web page (about 20% likely), half only on pages of 111 words or fewer. Children: youngest don't read, young read tentatively, older scan (no percentages). Our kids: 36-71% on Hoard Keeper.

Assumption between web-page data (long pages) and our measured kids (short game screens).

- Nielsen, J. (2008). How little do users read? Nielsen Norman Group (data: Weinreich et al. 2008, ACM Transactions on the Web; 25 adults, 45,237 page views). [read in the source itself] https://www.nngroup.com/articles/how-little-do-users-read/ ("at most 28% of the words during an average visit")
- Sherwin, K. & Nielsen, J. (2019). Children's UX: usability issues in designing for young people. Nielsen Norman Group. 125 children aged 3-12; qualitative. [read in the source itself] https://www.nngroup.com/articles/childrens-websites-usability-issues/
- Playtest Watcher, four school-age on four web games, October 2026 (results/group/limits.json). [measured in this project] results/group/limits.json

### Fails in a row before frustration (`sour_after_fails`)

Used by: src/persona/compile.ts default sour_after_fails.

Default 3, an assumption.

No credible published threshold exists for children or adults. Measure it per person (frustration_tolerance) wherever possible.

- Roohi, Relas, Takatalo, Heiskanen & Hämäläinen (2020). Predicting game difficulty and churn without players. CHI PLAY 2020. 95,266 players; churn modelled as failed attempts exceeding a per-player persistence draw (fitted values not published). [read in the source itself] https://arxiv.org/abs/2008.12937
- Lomas, Patel, Forlizzi & Koedinger (2013). Optimizing challenge in an educational game using large-scale design experiments. CHI 2013. ~10K and ~70K players. [read in the source itself] https://doi.org/10.1145/2470654.2470668 ("more engaged and played longer when the game was easier")

### A planned move that never happens (action mode) (`reflex_miss`)

Used by: src/agent/action.ts reflexFor().

Default 0.06; our four kids measured 5 to 9% in Factor Slicer.

- Playtest Watcher, four school-age on four web games, October 2026 (results/group/limits.json). [measured in this project] results/group/limits.json

### How long someone keeps playing when lost (`session_stamina`)

Used by: src/persona/compile.ts rulesText().

About ten minutes: every one of our kids played the full ten-minute session, lost or not.

The "2-3 minutes of attention per year of age" rule has no primary source; not used.

- Playtest Watcher, four school-age on four web games, October 2026 (results/group/limits.json). [measured in this project] results/group/limits.json

### The ten drives a persona plays for (`drives`)

Used by: src/persona/describe.ts, src/interview/script.ts.

speed: QF Excitement, SDT competence. mastery: QF Challenge/Strategy, Bartle Achiever, SDT competence. creativity: QF Design, SDT autonomy. competition: QF Competition, Bartle Killer. collection and grind: QF Completion/Power, Bartle Achiever. story: QF Story/Fantasy. exploration: QF Discovery, Bartle Explorer, SDT autonomy. showing: QF Design, Bartle Socialiser. nurturing: no direct match (closest: Bartle Socialiser, SDT relatedness), so weakly grounded.

- Yee, N. / Quantic Foundry. Gamer Motivation Model: 12 motivations in 6 clusters (GDC 2020 slides). Age trend (competition falls most with age) from press coverage only. [read in the source itself] https://quanticfoundry.com/wp-content/uploads/2020/08/GDC-2020-Slides-Player-Segments-Quantic-Foundry.pdf
- Bartle, R. (1996). Hearts, clubs, diamonds, spades: players who suit MUDs. [read in the source itself] https://mud.co.uk/richard/hcds.htm
- Ryan, Rigby & Przybylski (2006). The motivational pull of video games: a self-determination theory approach. Motivation and Emotion 30:347-363. [read in the source itself] https://doi.org/10.1007/s11031-006-9051-8 ("independently predict enjoyment and future game play")

## Left out on purpose

- "300 words a minute" as the average adult reading speed: unsupported (Brysbaert 2019 finds 238).
- "2-3 minutes of attention per year of age": no primary source found anywhere.
- Any number of fails before a child or adult quits: none published; ours is a labelled assumption.
