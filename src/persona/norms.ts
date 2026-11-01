// Published norms behind every default the harness uses when a persona has no measured number of its own.
// Each norm names its source, how sure we are of the number (V: read in the paper itself; A: abstract only;
// M: measured in this project; X: no credible source, a labelled assumption), and what in the engine uses it.
// docs/persona-norms.md is generated from this file (`npm run norms-doc`), so the two can't drift.
//
// Rule: a measured number for the person always wins. These only fill gaps, and every run that leans on one
// says so in its log (the `note` each helper returns).

export type Confidence = 'V' | 'A' | 'M' | 'X';
export type Source = { cite: string; url: string; confidence: Confidence; quote?: string };
export type Norm = { id: string; what: string; usedBy: string; values: string; sources: Source[]; note?: string };

const RUTTER_2020: Source = {
  cite: 'Rutter, Vahia, Forester, Ressler & Germine (2020). Heterogeneous indicators of cognitive performance and performance variability across the lifespan. Frontiers in Aging Neuroscience 12:62. N=12,327, ages 10-70, web-based (device latency included, like our harness).',
  url: 'https://doi.org/10.3389/fnagi.2020.00062', confidence: 'V', quote: 'breakpoint at 14 years (age of best performance)',
};
const WOODS_2015: Source = {
  cite: 'Woods, Wyma, Yund, Herron & Reed (2015). Factors influencing the latency of simple reaction time. Frontiers in Human Neuroscience 9:131. N=1,469 adults 18-65, lab hardware.',
  url: 'https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2015.00131/full', confidence: 'V', quote: '231, 213 ms when corrected for hardware delays',
};
const ANTHONY_2019: Source = {
  cite: 'Anthony, L. (2019). Physical dimensions of children\'s touchscreen interactions: lessons from five years of study on the MTAGIC project. International Journal of Human-Computer Studies 128. Appendix B, smartphone, first-attempt misses.',
  url: 'https://doi.org/10.1016/j.ijhcs.2019.02.005', confidence: 'V', quote: 'Children miss more often than adults, and have more trouble with smaller targets',
};
const BRYSBAERT_2019: Source = {
  cite: 'Brysbaert, M. (2019). How many words do we read per minute? A review and meta-analysis of reading rate. Journal of Memory and Language 109:104047. 190 studies, 18,573 readers; school grades from Taylor (1965), Table 4, which Brysbaert notes is optimistic.',
  url: 'https://doi.org/10.1016/j.jml.2019.104047', confidence: 'V', quote: '238 words per minute (wpm) for non-fiction and 260 wpm for fiction',
};
const NIELSEN_2008: Source = {
  cite: 'Nielsen, J. (2008). How little do users read? Nielsen Norman Group (data: Weinreich et al. 2008, ACM Transactions on the Web; 25 adults, 45,237 page views).',
  url: 'https://www.nngroup.com/articles/how-little-do-users-read/', confidence: 'V', quote: 'at most 28% of the words during an average visit',
};
const NNG_KIDS_2019: Source = {
  cite: 'Sherwin, K. & Nielsen, J. (2019). Children\'s UX: usability issues in designing for young people. Nielsen Norman Group. 125 children aged 3-12; qualitative.',
  url: 'https://www.nngroup.com/articles/childrens-websites-usability-issues/', confidence: 'V',
};
const OUR_KIDS: Source = {
  cite: 'Playtest Watcher, four school-age on four web games, October 2026 (results/group/limits.json).',
  url: 'results/group/limits.json', confidence: 'M',
};
const ROOHI_2020: Source = {
  cite: 'Roohi, Relas, Takatalo, Heiskanen & Hämäläinen (2020). Predicting game difficulty and churn without players. CHI PLAY 2020. 95,266 players; churn modelled as failed attempts exceeding a per-player persistence draw (fitted values not published).',
  url: 'https://arxiv.org/abs/2008.12937', confidence: 'V',
};
const LOMAS_2013: Source = {
  cite: 'Lomas, Patel, Forlizzi & Koedinger (2013). Optimizing challenge in an educational game using large-scale design experiments. CHI 2013. ~10K and ~70K players.',
  url: 'https://doi.org/10.1145/2470654.2470668', confidence: 'V', quote: 'more engaged and played longer when the game was easier',
};
const QUANTIC: Source = {
  cite: 'Yee, N. / Quantic Foundry. Gamer Motivation Model: 12 motivations in 6 clusters (GDC 2020 slides). Age trend (competition falls most with age) from press coverage only.',
  url: 'https://quanticfoundry.com/wp-content/uploads/2020/08/GDC-2020-Slides-Player-Segments-Quantic-Foundry.pdf', confidence: 'V',
};
const BARTLE_1996: Source = { cite: 'Bartle, R. (1996). Hearts, clubs, diamonds, spades: players who suit MUDs.', url: 'https://mud.co.uk/richard/hcds.htm', confidence: 'V' };
const SDT_2006: Source = {
  cite: 'Ryan, Rigby & Przybylski (2006). The motivational pull of video games: a self-determination theory approach. Motivation and Emotion 30:347-363.',
  url: 'https://doi.org/10.1007/s11031-006-9051-8', confidence: 'V', quote: 'independently predict enjoyment and future game play',
};

// ---- reaction time (action mode: how soon after seeing something a move can land) --------------------------
// Rutter 2020, simple RT: median 301 ms at the sample's mean age 27.4; fastest at 14, falling 5.7 ms a year from
// 10 to 14 and rising about 1 ms a year after. That puts age 14 near 288 ms. Below 10 there is no verified
// norm, so the 10-14 slope is carried down and labelled an extrapolation.
const RT_AT_14 = 301 - (27.4 - 14) * 1.0;
export function reactionMs(age: number | null): { ms: number; note: string } {
  const a = age ?? 27;
  const ms = a < 14 ? RT_AT_14 + 5.7 * (14 - a) : RT_AT_14 + 1.0 * (a - 14);
  const src = age == null ? 'age unknown, adult assumed' : a < 10 ? `age ${a}: extrapolated below the youngest age measured (10)` : `age ${a}`;
  return { ms: Math.round(ms), note: `reaction ${Math.round(ms)} ms: simple reaction time norm, Rutter et al. 2020 (${src}), not measured for this person` };
}
// Within-person SD: 104 ms at the mean age, lowest at 17.8, falling 4.2 ms a year before and rising 0.44 after.
const SD_MIN = 104 - (27.4 - 17.8) * 0.44;
export function timingSdMs(age: number | null): number {
  const a = age ?? 27;
  return Math.round(a < 17.8 ? SD_MIN + 4.2 * (17.8 - a) : SD_MIN + 0.44 * (a - 17.8));
}

// ---- tap misses (turn mode: a tap that lands on the neighbouring button) ------------------------------------
// Anthony 2019, first-attempt misses on a 9.5 mm target (about a phone's standard button): 7-10 12%, 11-13 11%,
// 14-17 11%, adults 3%. This is the motor miss only. A person's measured error rate also counts wrong answers,
// so a measured number replaces this one, never adds to it.
export function tapMiss(age: number | null): { rate: number; note: string } {
  const a = age ?? 27;
  const rate = a >= 18 ? 0.03 : a >= 11 ? 0.11 : 0.12;
  return { rate, note: `tap miss ${Math.round(rate * 100)}%: touch norm for a 9.5 mm button, Anthony 2019${a < 7 ? ' (age under 7: the 7-10 value, unmeasured below)' : ''}` };
}

// ---- reading -------------------------------------------------------------------------------------------------
// Silent reading by school grade (Taylor 1965 via Brysbaert 2019), grade = age - 6; adults 238 wpm.
const WPM_BY_GRADE = [80, 115, 138, 158, 173, 185, 195, 204, 214, 224, 237, 250];
export function readingWpm(age: number | null): { wpm: number; note: string } {
  if (age == null || age >= 18) return { wpm: 238, note: 'adult silent reading 238 wpm (non-fiction), Brysbaert 2019' };
  const g = Math.max(1, Math.min(12, Math.round(age) - 6));
  return { wpm: WPM_BY_GRADE[g - 1], note: `grade ${g} silent reading ${WPM_BY_GRADE[g - 1]} wpm, Taylor 1965 via Brysbaert 2019 (optimistic)` };
}
// About 6 characters a word including the space: an approximation for English, labelled as one.
export const msPerChar = (wpm: number) => 60000 / (wpm * 6);

// Share of instruction text read. NN/g: adults read at most 28% of a page's words, about half only on pages of
// 111 words or fewer; children skip long instructions (qualitative). Game instruction screens are short, and
// our four kids read 36 to 71% on Hoard Keeper, so 0.5 is a labelled assumption between the two.
export const READ_SHARE_DEFAULT = 0.5;

// Fails in a row before someone sours: no credible published number exists (Roohi 2020 models it per player
// and doesn't publish the fit; Lomas 2013 found easier play kept players longer). 3 is an assumption.
export const SOUR_AFTER_FAILS_DEFAULT = 3;
// Reflex misses in a fast game (a planned move that never happens): measured, our four kids 5 to 9%.
export const REFLEX_MISS_DEFAULT = 0.06;

export const NORMS: Norm[] = [
  { id: 'reaction_ms', what: 'How soon a move can land after something appears (action mode)', usedBy: 'src/agent/action.ts reflexFor()',
    values: `age 14 ${Math.round(RT_AT_14)} ms (fastest); +5.7 ms a year younger (measured to 10, extrapolated below); +1 ms a year older. Lab hardware reads about 70 ms faster (Woods 2015: 213 to 231 ms for adults).`,
    sources: [RUTTER_2020, WOODS_2015], note: 'Web-based norms include device latency, which matches a browser harness better than lab numbers.' },
  { id: 'timing_sd_ms', what: 'How far off a planned move lands (action mode)', usedBy: 'src/agent/action.ts reflexFor()',
    values: `${Math.round(SD_MIN)} ms at 17.8 (steadiest); +4.2 ms a year younger; +0.44 ms a year older.`, sources: [RUTTER_2020] },
  { id: 'tap_miss', what: 'A tap that lands on the neighbouring button (turn mode)', usedBy: 'src/persona/compile.ts default error_rate',
    values: '9.5 mm button: ages 7-10 12%, 11-13 11%, 14-17 11%, adults 3%. Smaller 6.4 mm targets: 31%, 17%, 21%, 12%.',
    sources: [ANTHONY_2019], note: 'Motor misses only; a measured error rate (which includes wrong answers) replaces it.' },
  { id: 'reading_wpm', what: 'Reading speed, for read_ms_per_char', usedBy: 'src/persona/compile.ts default read_ms_per_char',
    values: `Silent wpm by grade 1-12: ${WPM_BY_GRADE.join(', ')}; adults 238 (non-fiction), range 175-300. The popular "300 wpm average" is unsupported.`,
    sources: [BRYSBAERT_2019], note: 'Converted at about 6 characters per word including the space.' },
  { id: 'read_share', what: 'Share of instruction text a person reads', usedBy: 'src/persona/compile.ts default read_share',
    values: `Default ${READ_SHARE_DEFAULT}. Adults read at most 28% of a web page (about 20% likely), half only on pages of 111 words or fewer. Children: youngest don't read, young read tentatively, older scan (no percentages). Our kids: 36-71% on Hoard Keeper.`,
    sources: [NIELSEN_2008, NNG_KIDS_2019, OUR_KIDS], note: 'Assumption between web-page data (long pages) and our measured kids (short game screens).' },
  { id: 'sour_after_fails', what: 'Fails in a row before frustration', usedBy: 'src/persona/compile.ts default sour_after_fails',
    values: `Default ${SOUR_AFTER_FAILS_DEFAULT}, an assumption.`, sources: [ROOHI_2020, LOMAS_2013],
    note: 'No credible published threshold exists for children or adults. Measure it per person (frustration_tolerance) wherever possible.' },
  { id: 'reflex_miss', what: 'A planned move that never happens (action mode)', usedBy: 'src/agent/action.ts reflexFor()',
    values: `Default ${REFLEX_MISS_DEFAULT}; our four kids measured 5 to 9% in Factor Slicer.`, sources: [OUR_KIDS] },
  { id: 'session_stamina', what: 'How long someone keeps playing when lost', usedBy: 'src/persona/compile.ts rulesText()',
    values: 'About ten minutes: every one of our kids played the full ten-minute session, lost or not.', sources: [OUR_KIDS],
    note: 'The "2-3 minutes of attention per year of age" rule has no primary source; not used.' },
  { id: 'drives', what: 'The ten drives a persona plays for', usedBy: 'src/persona/describe.ts, src/interview/script.ts',
    values: 'speed: QF Excitement, SDT competence. mastery: QF Challenge/Strategy, Bartle Achiever, SDT competence. creativity: QF Design, SDT autonomy. competition: QF Competition, Bartle Killer. collection and grind: QF Completion/Power, Bartle Achiever. story: QF Story/Fantasy. exploration: QF Discovery, Bartle Explorer, SDT autonomy. showing: QF Design, Bartle Socialiser. nurturing: no direct match (closest: Bartle Socialiser, SDT relatedness), so weakly grounded.',
    sources: [QUANTIC, BARTLE_1996, SDT_2006] },
];
