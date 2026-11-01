# Persona kit: build a named persona from whatever data you have, use it from any CLI or IDE

Date: 2026-11-01. Status: draft 2, Fable review folded in (§0). Builds on `2026-10-31-persona-engine-design.md` (the
dimensions, limits, compiler and harness), which stays the engine. This spec is the product around it.

## 0. Revision after the Fable review (2026-11-01)

Fable checked the draft against the code and the engine's results. Two blockers and six serious findings,
all accepted; the sections below are rewritten to match. In short:

1. **Limits are game numbers, not just people numbers (blocker).** The reference player's first tap is
   0.98 s on Current Cut and 4.57 s on Hoard Keeper, a bigger gap than between any two kids. The engine
   already learned this: limits carry over between games only as a ratio to a reference run. Draft 1 lost
   that. Now every limit is stored as a ratio with its reference (§7), and a run needs a reference run on the
   target (`persona reference --url`) or says, on the card and the report, which game's numbers it borrowed.
2. **Consent came after the data had been read and sampled to Muse (blocker).** Now consent is asked before
   any file is opened (§2 step 3), and the mapping guess sends column names and value shapes, never row
   values, through one `redact()` chokepoint with a test (§5, §10).
3. **Generic analytics can't produce most limits.** Reading, idle and reflex misses need events only our
   recorder logs, and souring comes from Muse's labels on video. §3 now splits "our recorder" from "a
   generic export" and the card marks each limit measured or default.
4. **Blended runs drew each number on its own,** making kids nobody is, on top of the harness's own
   per-step jitter. Now a blended run plays one real member's whole set of numbers (seeded); the median is
   for the card only (§6).
5. **Validation had no score** and could rarely run. Now it's defined, and offered only when a held-out
   session is playable; everything else says "not validated" (§9).
6. **The thin slice is a refactor of `play.ts`,** not a wrapper: it hard-wires `recordings/`, needs the
   watcher server, sees only real buttons, and a 40-step run outlasts an MCP tool call. Two days, not one (§12).
7. **The kids' persona/1 cards carry their words verbatim** ("I didn't understand it at all"), and Muse
   recited quotes like these during play. The converter strips them, with a test (§7).
8. **A described persona is placed inside four school-age kids on four of my games.** That range now ships
   as a named population file printed on the card, and a description can give absolute numbers instead (§3).

Smaller ones, also taken: the intake is a question-by-question state machine, not one tool call (§8);
one person alone has limits but no dimensions, since dimensions are differences from a group (§3); `forget`
needs a local id-to-label map and drops old versions that used the person (§10); custom prompt dimensions
need their own rule text, and the prompt export ships last because it is the version agents ignore (§5, §8);
the Facebook download stays in phase 4, adults only, reading two named files and never a folder (§4).

## 1. What it is

A developer wants a tester they can call by name ("Maya, 8, skips the text and taps fast") and run against
their game, app or site again and again. Today the engine builds personas only from my four kids, from files
in this repo's own layout. The kit turns it into a general tool:

- **Ask, don't assume.** It asks who the persona is, what data exists, and where it lives, then proposes how
  each data point maps onto the persona and lets the user fix it.
- **Any persona, not my kids.** One real person, a group of real people (ten kids blended into one
  persona), or nobody real (a written description).
- **Named and kept.** The result is an established persona with a name, a version history and a card that
  says what it's built from and how far to trust it.
- **Usable anywhere.** One package, three doors: an MCP server (Claude Code, Cursor, VS Code, Codex, Gemini
  CLI), an agent skill, and a plain CLI.

The engine's lesson carries over: **a persona is the limits the harness enforces, not a paragraph.** A data
point only earns its place if it moves a limit, a prompt rule, or the persona's confidence.

## 2. The flow

`persona new` in a terminal, or "make me a persona" to an agent with the MCP server or skill installed. Both
run the same intake, one question at a time:

1. **Who is this?** One real person / a group of real people / nobody real, I'll describe them.
2. **Name it.** Free text ("Maya", "Year 4 class", "Grandparents on tablets"). The slug is the folder name.
3. **What do you have?** Pick any (each shows what it can tell the persona, from the table in §3):
   - Game or app event data (an analytics export, a JSONL log, our recorder's sessions)
   - Recordings of them playing (screen, and face or hands if they agreed)
   - Interview or survey answers
   - Profile facts (age, interests, what they like, e.g. from the person's own Facebook data download)
   - A written description
4. **Consent, before anything is opened.** For real people: the user lists who is in it (labels they
   choose, kept only in a local file, §10), and confirms each agreed, and a parent for anyone under 13. No
   yes, no file is read. Description-only personas skip this.
5. **Where is each one?** A path, a folder or a URL the user can already read. For each source the intake
   reads it locally, proposes a mapping (§5), shows it as plain sentences ("first tap = time from
   `screen_view` to the next `tap`, median per session"), and asks to confirm or fix.
6. **What will it be tested on?** A URL to play once as the reference run (`persona reference`), or a game
   to borrow limits from, which every card and report then names (§7).
7. **For a group: one blended persona or a panel?** (§6). Default: blended, with the panel offered.

Then it builds and prints the **card**:

- name, version, who it's built from ("10 people, event data from 10, interviews from 4")
- the numbers the harness will enforce, each with its range ("looks 4 to 7 s at a new screen")
- what drives them, with the evidence behind each
- what's a guess (description or profile facts only) and what's measured
- a validation score when there was held-out data to check against (§9), or "not validated"

Saved to `personas/<slug>/` in the user's project:

```
personas/maya/
  persona.json        the persona (persona/2, §7)
  persona.prompt.md   the rules as a system prompt, for tools that can't run the harness
  map.yaml            how the sources became numbers (editable; rebuild after editing)
  evidence.jsonl      the data points it was built from (numbers only, §4)
  versions/           every earlier persona.json, by date
```

Later: `persona update maya` adds a source or a person and rebuilds as a new version; `persona show maya`
prints the card; `persona run maya --url …` plays; `persona forget maya --member p07` drops one person's
evidence and rebuilds (§10).

## 3. What each kind of data can tell the persona

| Source | Behaviour limits (enforced) | Dimensions | Drives (what they play for) | Confidence |
|---|---|---|---|---|
| Our recorder's events | Yes: first tap, gap, reading share and speed, error rate, idle, reflex misses (games that log misses) | Pace, persistence, recovery, exploration (groups only) | Weakly | Measured |
| A generic analytics export | First tap and gap (when the app logs screen views and taps, in ms); error rate and fail streak only when the user maps a fail event; reading only if the app logs text shown and closed with its length | Same, groups only | Weakly | Measured where mapped, default elsewhere |
| Recordings | Yes, through Muse moments: reading, stuck time, and the fail streak before they sour (from Muse's frustrated and stuck labels) | Most, through Muse (with its known blind spot: quiet focus read as bored) | From what they say out loud | Measured, Muse-read |
| Interview or survey | No | Self-reported only, marked as such | Yes, the main source | Self-report |
| Profile facts (age, interests, likes) | No, except age choosing the reflex default | No | Yes, as priors | Guess |
| Written description | As priors placed inside a reference range (the engine's `placeLevel`) | As priors | As priors | Guess |

**One person alone has limits but no dimensions.** Dimensions are differences from a group on the same
game; a single person has no group, so their card says "dimensions: none (needs a group to compare
against)". In a group, dimensions are relative to that group and the card says so.

**A described persona is placed inside a named population.** The engine's `placeLevel` puts a description
between the slowest, typical and fastest of the people it has seen. Today that is four school-age children on four web games (October 2026); it ships as a population file and is printed on every described card.
A description can also give numbers ("about 5 seconds before the first tap"), which override the placement.

Rules that fall out of the table, and the intake says them out loud:

- **Profile facts never set a limit.** Knowing someone likes horses says nothing about how fast they tap.
  They tilt drives and priors only, and the card marks them as guesses.
- **Measured beats guessed, per dimension.** A described persona that later gets event data keeps the
  description only where the data says nothing.

## 4. Evidence: one shape for every source

Adapters turn each source into data points. Raw data stays where it is; the kit keeps only numbers.

```json
{"member":"p03","source":"events","metric":"first_tap_s","value":4.2,"n":31,"from":"exports/class.csv","at":"2026-10-30","consent":"parent"}
```

- `member` is an opaque id the kit assigns. Names, faces, voices and free text never enter `evidence.jsonl`.
  Interview answers enter as drive scores with a short reason, never as quotes (the engine learned this when
  Muse recited a kid's quit quotes back during play).
- `n` is the sample behind the number, so a value from 3 events weighs less than one from 300.
- Adapters in v1: our recorder sessions; event JSONL or CSV (any columns, mapped in §5); survey CSV; a
  Facebook "Download your information" export, in phase 4 only: adults only (under-13s can't have
  accounts), and the adapter opens exactly two named files (profile information and ad interests), never the
  folder, which also holds messages, friends and locations; free text. Analytics exports from PostHog, Amplitude, GA4 and Mixpanel are CSV or JSON
  shapes the event adapter's mapping covers; named presets come later.

## 5. The mapping file: how data points become the persona

`map.yaml` is the flexible part. The intake writes a first guess; the user can edit it and rebuild.

```yaml
sources:
  events: { path: exports/class.csv, member: player_id, time: ts, event: name }
  survey: { path: exports/survey.csv, member: student_id }
measures:
  first_tap_s:   { from: events, median_of: gap, between: [screen_view, tap] }
  action_gap_s:  { from: events, median_of: gap, between: [tap, tap] }
  read_share:    { from: events, ratio: [instructions_read, instructions_shown] }
  error_rate:    { from: events, ratio: [answer_wrong, answer] }
  drive.mastery: { from: survey, field: q7, scale: likert5 }
  drive.story:   { from: survey, field: q9, scale: likert5 }
custom:
  reads_tooltips: { from: events, ratio: [tooltip_open, tooltip_shown], controls: prompt }
```

- **A small vocabulary covers most of it:** `median_of`, `ratio`, `rate_per_min`, `streak_before`,
  `open_ms_per_char` (shown, closed, chars), `field` with a `scale` (likert5, yes/no, 0 to 10), and a
  `time_unit` per source (s, ms, us, iso), since some exports round to whole seconds, which is too coarse for
  first tap. Anything else gets `script: measures/x.js`, a function from rows to a number.
- **Guessing the first mapping:** the intake sends Muse Wonder the column names and each column's shape
  (type, min and max, number of distinct values, and event names that match a short allow-list pattern),
  never a row's values, through the adapter layer's one `redact()` chokepoint. One call; the schema forces a
  known measure or "none". It shows its guesses as sentences for the user to confirm. Unmatched measures stay empty and fall back to
  priors; the card says which.
- **Custom dimensions** must say what they `control`: a harness setting, a prompt rule with its own text
  (`controls: {prompt: {low: "...", high: "..."}}`), or `report` (only shown on the card). A dimension that
  controls nothing gets a warning at build: it can't change a run.

## 6. Groups: ten kids into one persona, or a panel of ten

Two modes, because they answer different questions:

- **Blended persona** ("what does a typical kid in this class do?"). The card shows each dimension and
  limit as the median across members who have evidence for it, with their spread. **Every member counts
  once**, however much data they have; `n` only sets the confidence shown on the card, never a weight. **A
  blended run plays one real member's whole set of numbers**, picked by a seed, so ten runs are ten real
  kids from the class, never a mix nobody is (a fast first tap with careful reading and a high miss rate),
  and the harness's own per-step jitter isn't doubled. With fewer than 3 members holding evidence for a
  number, the card says "n too small" and shows no range.
- **Panel** ("would any of them get stuck?"). The kit keeps one persona per member under the group's name
  and runs them all; the report shows the spread and calls out the members who failed where others didn't.
  A blended persona hides exactly that kid, which is why both exist.

A group smaller than 5 is marked **small group** on the card: a blended persona of three kids is close to a
copy of one of them. It still works locally; `persona share` refuses it (§10).

## 7. The persona file (persona/2)

Published as a JSON Schema in the package, so any tool can read and validate it. Changes from persona/1:

- `name`, `slug`, `version`, `kind` (`person` | `group` | `described`), `members` (count, opaque ids),
  `mode` (`blended` | `panel`)
- per dimension and limit: `value`, `lo`, `hi`, `n`, `basis` (`measured` | `self-report` | `guess` |
  `default`), `sources`, and **`controls`** (`harness:<setting>` | `prompt` | `report`)
- **limits as ratios:** each limit stores `ratio` (the person's value over the reference player's on the
  same game), `reference_game`, `reference_value`, and the absolute value it was measured at. At run time the
  harness multiplies the ratio by the reference value on the target, from a `persona reference --url` run
  (Joel or a bot plays once; `limits.py` already handles a reference round). Without one, the run uses a
  named stand-in game and the card and report say "limits borrowed from <game>".
- `provenance`: per source, path, date read, consent basis per member, the map.yaml hash
- `validation`: held-out score and what it was scored on, or null
- `target` is no longer baked in: the ratios are the persona, and the target's reference run turns them
  into seconds. Fast games use the reflex limits, as action mode does now.

`persona/1` files (the four kids) load through a converter, built from `results/` (committed), not
`recordings/` (ignored). **The converter strips the kids' words:** `drives[].evidence` becomes a basis tag
(interview, strong or weak) and `card.*` becomes a one-line paraphrase or nothing. `show_persona` and every
export never emit a real person's quoted speech, and a test asserts no quoted string from an `interview.json`
survives conversion.

## 8. Using it: one package, three doors

- **MCP server** (`persona mcp`), the main door for any IDE or CLI agent. Tools:
  `list_personas`, `show_persona`, `new_persona` and `answer_intake` (the intake is a state machine:
  `new_persona` returns a draft id and the first question; each `answer_intake(draft, answer)` returns the
  next question or the card), `update_persona`, `run_persona(name, url, steps, mode: turn|action, point,
  progress)`, which returns a run id at once because a 40-step run takes minutes, and `get_report(run)`.
- **Agent skill** (`SKILL.md`, one page): when to use personas, how to read a card, where every default comes
  from (`src/persona/norms.ts`, rendered as `docs/persona-norms.md`: reaction time, timing spread, tap misses,
  reading speed and share, each with its published source and how sure we are of it), to relay intake
  questions to the user word for word and never answer them itself, and that a run's quotes are the model's
  words, not a real person's.
- **CLI**: `npx persona new | update | show | run | forget | share | export`.
- **`persona export maya --to prompt`**: `persona.prompt.md` for tools that can't run the harness. Its first
  line says the numbers are advice there, not enforced: the engine showed agents ignore a paragraph ("told
  reading 0.2, reads every word anyway"), which is the whole reason the harness exists.
- **Harnesses**: Playwright for web pages (turn mode, and point taps for canvas games), keyboard games
  (action mode), and our log bridge for Godot. Mobile through Maestro is later.
- **Reports**: one JSON plus markdown per run (steps, what it read and skipped, misses, where it got stuck),
  the same shape the runs page reads. A GitHub Action can run a persona on a preview URL and fail on a
  rule ("Maya can't reach the first Audit").

## 8b. Defaults come from published norms

When a persona has no measured number (a description, or a person with no recording of that kind of game), the
gap is filled from `src/persona/norms.ts` by age, never a bare guess: simple reaction time and its spread
(Rutter et al. 2020, 12,327 people, web-based), touch misses by age and target size (Anthony 2019), reading speed
by grade and for adults (Brysbaert 2019, with Taylor 1965's grade table), how much text people read (Nielsen
2008; NN/g children's studies), and the drive taxonomy (Quantic Foundry, Bartle 1996, Ryan, Rigby & Przybylski
2006). Two defaults have no credible source and say so: fails before frustration (3) and the share of game
instructions read (0.5). A measured number always replaces a norm; a run log names every norm it leaned on.

## 9. Validation: how far to trust a persona

**Superseded 2026-11-01** for the data we have (one session per kid per game, so no per-person range): validation
is harness fidelity plus input identification, `analysis/validate.py` (see `docs/hackathon-remaining.md` §1). The
original text follows for when there is more than one session per person.

**The score:** the share of limits where the agent's run lands inside the real person's range on a session
held back from the build, shown per limit. It is offered only when the held-out session came from our
recorder on a page the harness can play; numbers from an analytics export checked against more numbers from
the same export would agree by construction, so those personas say "not validated (no playable held-out
session)", plainly. `compare_runs` today prints a side-by-side table and needs this score added.
My own result is the reason: four kids' personas tied with knowing only their age, and their cards will say
exactly that. A persona that can't show it beats that baseline should say so.

## 10. Privacy and consent (what makes it enterprise-safe)

- **Raw data never moves.** Adapters read it in place; only `evidence.jsonl` numbers and the persona leave
  the read step. Nothing goes to a model except what a call needs, and all of it passes the adapter layer's
  `redact()`: Muse sees frames for recordings (after consent), and column names with value shapes when
  guessing a mapping, never row values. A test feeds a fixture with a name column and asserts no value from
  it reaches the model client.
- **Consent per person, recorded.** Under-13s need a parent's yes. Profile data comes only from the
  person's own data download, never scraped.
- **Forget a person.** A local `members.local.json` (never shared, never committed) maps each opaque id to
  the label the user gave. `persona forget <name> --member <label>` deletes that person's evidence, deletes
  every saved version whose provenance lists them, writes a tombstone line, and rebuilds the current version.
- **Sharing.** `persona share` exports a persona for someone else and refuses small groups and single real
  people unless the user confirms that person agreed to be shared.
- **Groups, not people, by default.** The same rule as the Meta pitch: personas from groups, real people only
  by opting in.

## 11. What exists and what's new

Exists (this repo): the dimensions and limits, `limits.py` measures for our recorder's events, the
compiler, `describePersona` with `placeLevel`, turn and action harnesses (point taps, progress counter,
limits from a similar game), the runs page, the spend cap.

New: the intake, the evidence format, adapters, `map.yaml` and its measures, groups (blended and panel),
persona/2 and its schema, the MCP server, the skill, the CLI, validation on the card, forget and share.

## 12. Order

1. **Thin slice (before Wednesday's submission, about two days, so tight):**
   - refactor `play()` to take `{outDir, sessionId, persona}`, never call the watcher server, and look at
     clickable elements beyond real buttons (anything with a click handler or `cursor: pointer`);
   - persona/2 schema and the persona/1 converter with quote stripping and its test, shipping
     `personas/a..d` built from `results/`;
   - the MCP server (`@modelcontextprotocol/sdk`): `list_personas`, `show_persona`, `run_persona` returning a
     run id, `get_report`; reports say "limits borrowed from hoard-keeper" until a reference run exists;
   - SKILL.md, one page; `export --to prompt` last.
   A judge with Chrome installed can run the four kids' personas on their own page.
2. **Intake and mapping:** the question flow, the event and survey adapters, `map.yaml` with the guessed
   first mapping, the card.
3. **Groups:** blended and panel, the small-group rule.
4. **Profile facts and description as sources;** validation on the card; forget and share.
5. Analytics presets, mobile harness, the GitHub Action.

## 13. Open for Joel

- Is "Persona kit" the name, or does it stay Playtest Watcher with personas as the headline feature?
- The small-group line: 5 members is my default for "can be shared". Higher for anything outside the
  family?
- Profile facts from a Facebook download: in v1 as a source, or held until the Meta pitch has an answer on
  how Meta would want that done?
