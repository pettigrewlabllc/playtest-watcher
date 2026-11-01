# Meta hackathon: status and remaining plan (2026-11-01, Sunday evening)

Due **Wed Nov 4, 9:00 PM ET (7:00 PM MT)**. Track: Indie (creativity, technical ambition, whether it works).
Spend so far $82.41 of the $120 stop ($150 credits). Repo: github.com/pettigrewlabllc/playtest-watcher,
**already public**, no LICENSE file.

## Done

- **Watching:** recorder (screen, face, hands, voice, game events), viewer, Muse Spark moments, Muse Wonder
  fix lists, voice separation. 13 learn + 4 check sessions from four kids; interviews with clip checks.
- **Persona engine:** measured limits, compiler, turn and action harnesses (frozen clock, hidden unread text,
  near-miss taps, point taps for canvas games, reflexes), runs page, step logs.
- **Four ways in, all built and run on Hoard Keeper (newest build), Continental Drift and Timberline:**
  kids (interview + play + video), Joel (play + Facebook ad-preference facts, local only), a described
  16-year-old (one sentence, read once and saved), and a family blend (5 people; each run plays one member).
- **Published norms:** every default traced to a source (`src/persona/norms.ts`, `docs/persona-norms.md`).
- **Evidence in `results/`:** kid-check (5 of 20 exact, ~3 in 4 same direction), frozen predictions (persona
  kappa 0.069 vs age-only 0.067, a tie), transfer (no better than chance), agent-vs-kid on Hoard Keeper
  (agents misfile ~1/3 of slips vs kids' 18-19%), stability, spend.
- **Kit spec** (Informed Personas) draft 2 with Fable's review folded in; nothing of the kit built yet.
- **Video:** draft 2 rendered (3:00, captions only, STAR order, Hoard Keeper and Continental Drift beats).
  Narration page built (teleprompter, per-beat takes, edit the script in place). Joel hasn't recorded yet.
- **Tests:** 201 pass (three slow prediction tests time out only under heavy machine load).

## Not done, in order

### 1. Validate the personas (done 2026-11-01, $0, after Fable's review)

Fable showed the planned $20 identification runs couldn't beat chance by construction: a held-out persona's
limits ARE its inputs, and those inputs already pick the right kid only at chance (4 of 20 on Hoard Keeper).
Replaced with two checks on data already on disk, `analysis/validate.py` -> `results/group/validation.json`:

- **Harness fidelity** (does a run play at the numbers it was given?), six committed Hoard Keeper runs:
  first tap within x1.5 of its setting in **6 of 6**; time between actions **1 of 6** (runs 1.5 to 3.8x slower:
  the harness adds its own 400 ms plus a fresh-frame wait after every step, a fixable harness bug); read share
  **2 of 6** (measured from how long text stays open, not from the harness's hide decision); error rate **0 of 6**
  (the setting is a tap miss, the measure counts wrong answers: not the same quantity).
- **Input identification:** a kid's held-out persona is closest to that same kid's real numbers on **19 of 76**
  checks, exactly chance (19). The README's "nothing carried game to game" result, now as a number.
- Optional, ~$2: C and D held-out runs on build 9 (worktree `hoard-keeper/.claude/worktrees/playtest-log-b9`,
  served on 3054) so the agent-vs-kid table covers all four kids. Not essential.
- The kit spec's §9 "inside the person's range" can't run with one session per kid per game; the definition is
  now these two checks.

### 2. Public repo walkthrough

**Done 2026-11-01 evening:** README rewritten as the walkthrough (name: Informed Persona Testers), SKILL.md added,
fresh clone checked (npm ci, server serves 9 runs and the narration page with no key, 189 tests pass + 12 skip
without the Python venv). History rewritten to drop the ages (GitHub Support purge of cached commits optional,
Joel's call; draft in recordings/github-support-request.md). LICENSE: MIT (Joel, 2026-11-01).

- LICENSE: **Joel's call** (MIT is the usual hackathon choice; without one the code is all rights reserved).
- README: lead with Informed Personas (four ways in, the norms, how to run one), keep the watching half
  second; the "See it without a key" path must work from a fresh clone (runs page from `results/`).
- Fresh-clone check: clone to a temp dir, `npm ci`, `npm test`, `npm start`, open the runs page.
- `SKILL.md` (one page) so an agent can drive it: build a persona, run it, read the card. The MCP server
  from the kit spec's thin slice is ~2 days; **proposed cut**, ship SKILL.md + the CLI commands instead.
- Privacy sweep of tracked files: no kid names, faces, voices, ages in public text; no Joel/family runs;
  Hoard Keeper is private (its code is not in the repo; `results/runs` holds screenshots of it).
  **Done in HEAD 2026-11-01:** the letter-age pairs and every "school-age" (which, with youngest/oldest in the
  README, gave two kids' ages away) replaced with "school-age"; test fixtures moved off real ages; the exporter
  now refuses family-blend and personal-file runs before touching `results/`. **Still in git history** since
  Oct 31: removing it needs a history rewrite and force-push of a public repo, which is Joel's call.

### 3. Video

**Script revised 2026-11-01 evening** (four ways in, norms, fidelity number, new name; ~585 words, ~3:10).
Waiting on Joel's read.

- Revise the script (Fable): lead the Result with what the personas found on builds no kid had played (a lucky
  answer the game can't tell from a real one; Continental Drift's one explaining sentence skipped; the blue gem
  read as frost), each tied to a step log. Technical ambition (frozen clock, hidden unread text, near-miss taps,
  reflex scheduling, published norms) gets real time. Joel + Facebook and the family blend get one line each:
  their evidence can't be published. Honest results stay, short, with the fidelity number.
  Through joel-voice; Joel signs off.
- Joel records on the narration page (one take per beat).
- Cut the takes to the beats, retime captions, add the new beats (Joel's persona, teen, family), render,
  frame-check, final file.

### 4. Submission text

**Rewritten 2026-11-01 evening** to the same story and numbers; shot list dropped. Waiting on Joel's sign-off.

- Drop the shot list (it still shows kids on camera, which the script ruled out), take spend from
  `results/spend.jsonl` at submit time ($59 is stale), "four ways in" not three.
- Update `docs/submission.md` to the same story and numbers; Joel signs off; Joel submits on the event site
  (sign-in required, so it's his step).

### 5. Small open items

- Name: Informed Personas (product) vs Informed Persona Testers; README and video follow the pick.
- Confirm no kid has played Timberline (the video opens on it).
- Copy sign-offs outstanding: README, submission, script, runs page, narration page strings.

## Proposed schedule

| When | What | Who |
|---|---|---|
| Sun night | Validation runs (step 1), README + SKILL.md draft, privacy sweep | Claude |
| Mon | Fresh-clone check; script revision; Joel reviews copy, picks license and name | Claude, then Joel |
| Mon night or Tue | Joel records narration | Joel |
| Tue | Cut audio, new beats, render, frame-check; submission text final | Claude |
| Wed by 5 PM MT | Joel watches the final video, submits | Joel |

**Fallback:** if there's no narration by Tue 9 PM MT, the captions-only cut ships with the revised captions.
**Cut order if time runs short:** MCP server (already cut), then the new video beats for Joel, the teen and the
family, then SKILL.md. **Never cut:** LICENSE, the privacy scrub, the submission text, the fresh-clone check.
