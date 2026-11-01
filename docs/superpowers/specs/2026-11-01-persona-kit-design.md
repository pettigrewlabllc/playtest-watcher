# Persona kit: build a named persona from whatever data you have, use it from any CLI or IDE

Date: 2026-11-01. Status: draft 1, for Fable review. Builds on `2026-10-31-persona-engine-design.md` (the
dimensions, limits, compiler and harness), which stays the engine. This spec is the product around it.

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
4. **Where is each one?** A path, a folder or a URL the user can already read. For each source the intake
   reads a sample, proposes a mapping (§5), shows it as plain sentences ("first tap = time from
   `screen_view` to the next `tap`, median per session"), and asks to confirm or fix.
5. **Consent.** For real people: did each person agree, and a parent for anyone under 13? It records the
   answer per person in the persona's provenance. No yes, no build. Description-only personas skip this.
6. **For a group: one blended persona or a panel?** (§6). Default: blended, with the panel offered.

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
| Game or app event data | Yes: first tap, gap between actions, error rate, idle, fail streak before quitting, reflex misses | Pace, persistence, recovery, exploration | Weakly, from what they choose to do | Measured |
| Recordings | Yes, through Muse moments: reading, stuck time, what made them quit | Most, through Muse (with its known blind spot: quiet focus read as bored) | From what they say out loud | Measured, Muse-read |
| Interview or survey | No | Self-reported only, marked as such | Yes, the main source | Self-report |
| Profile facts (age, interests, likes) | No, except age choosing the reflex default | No | Yes, as priors | Guess |
| Written description | As priors placed inside a reference range (the engine's `placeLevel`) | As priors | As priors | Guess |

Two rules fall out of the table and the intake says them out loud:

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
  Facebook "Download your information" JSON (profile and interests only; the person runs the download
  themselves); free text. Analytics exports from PostHog, Amplitude, GA4 and Mixpanel are CSV or JSON
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
  `field` with a `scale` (likert5, yes/no, 0 to 10). Anything else gets `script: measures/x.js`, a function
  from rows to a number.
- **Guessing the first mapping:** the intake samples the columns and event names, matches them against
  each measure's description (Muse Wonder, one call, the schema forces a known measure or "none"), and
  shows its guesses as sentences for the user to confirm. Unmatched measures stay empty and fall back to
  priors; the card says which.
- **Custom dimensions** must say what they `control`: a harness setting, a prompt rule, or `report` (only
  shown on the card). A dimension that controls nothing gets a warning at build: it can't change a run.

## 6. Groups: ten kids into one persona, or a panel of ten

Two modes, because they answer different questions:

- **Blended persona** ("what does a typical kid in this class do?"). Each dimension and limit is the
  median across members who have evidence for it; its range is their spread (middle half). **Every member
  counts once**, however much data they have, so the kid who played for three hours doesn't become the
  persona. Each run draws its numbers from inside the range with a seed, so ten runs look like ten plausible
  members, not one average kid ten times. The card shows `n` per dimension ("read share from 7 of 10").
- **Panel** ("would any of them get stuck?"). The kit keeps one persona per member under the group's name
  and runs them all; the report shows the spread and calls out the members who failed where others didn't.
  A blended persona hides exactly that kid, which is why both exist.

A group smaller than 5 is marked **small group** on the card: a blended persona of three kids is close to a
copy of one of them. It still works locally; `persona share` refuses it (§10).

## 7. The persona file (persona/2)

Published as a JSON Schema in the package, so any tool can read and validate it. Changes from persona/1:

- `name`, `slug`, `version`, `kind` (`person` | `group` | `described`), `members` (count, opaque ids),
  `mode` (`blended` | `panel`)
- per dimension and limit: `value`, `lo`, `hi`, `n`, `basis` (`measured` | `self-report` | `guess`),
  `sources`, and **`controls`** (`harness:<setting>` | `prompt` | `report`)
- `provenance`: per source, path, date read, consent basis per member, the map.yaml hash
- `validation`: held-out score and what it was scored on, or null
- `target` is no longer baked in. A persona is built once and run against anything; limits that depend on
  the game type (fast games use the reflex limits) are chosen at run time, as action mode does now.

`persona/1` files (the four kids) load through a converter, so nothing built so far is lost.

## 8. Using it: one package, three doors

- **MCP server** (`persona mcp`), the main door for any IDE or CLI agent. Tools:
  `list_personas`, `show_persona`, `new_persona` (runs the intake as a back-and-forth with the user through
  the agent), `update_persona`, `run_persona(name, url, steps, mode: turn|action)`, `get_report`.
- **Agent skill** (`SKILL.md` shipped in the package): when to use personas, how to read a card, and the
  rule that a run's quotes are the model's words, not a real person's.
- **CLI**: `npx persona new | update | show | run | forget | share | export`.
- **`persona export maya --to prompt`**: `persona.prompt.md` for tools that can't run the harness. It says at
  the top that the numbers are advice there, not enforced.
- **Harnesses**: Playwright for web pages (turn mode, and point taps for canvas games), keyboard games
  (action mode), and our log bridge for Godot. Mobile through Maestro is later.
- **Reports**: one JSON plus markdown per run (steps, what it read and skipped, misses, where it got stuck),
  the same shape the runs page reads. A GitHub Action can run a persona on a preview URL and fail on a
  rule ("Maya can't reach the first Audit").

## 9. Validation: how far to trust a persona

When a person or group has more than one session of data, the build holds one back: build from the rest,
run on the held-out game or screen, compare the run with what really happened (the engine's
`compare_runs`). The score goes on the card. With no held-out data the card says "not validated", plainly.
My own result is the reason: four kids' personas tied with knowing only their age. A persona that can't show
it beats that baseline should say so.

## 10. Privacy and consent (what makes it enterprise-safe)

- **Raw data never moves.** Adapters read it in place; only `evidence.jsonl` numbers and the persona leave
  the read step. Nothing is uploaded except what a model call needs (Muse sees frames for recordings, and the
  intake sends column names and a few sample values when guessing a mapping; never names).
- **Consent per person, recorded.** Under-13s need a parent's yes. Profile data comes only from the
  person's own data download, never scraped.
- **Forget a person.** `persona forget <name> --member <id>` drops their evidence and rebuilds every
  version that used it.
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

1. **Thin slice (before Wednesday's submission, about a day):** persona/2 schema plus the persona/1
   converter; `persona export --to prompt`; the MCP server with `list_personas`, `show_persona` and
   `run_persona` over the existing build and run code; SKILL.md. A judge can install it and run the four
   kids' personas on their own page.
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
