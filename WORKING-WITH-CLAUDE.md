# Working With Claude on Whoosha

A meta-guide: how the project's docs are meant to work, and how to get good results from Claude / Claude Code on this codebase. This file is for **you** (and any future collaborator) — it's not auto-loaded every session. Edit it freely.

---

## 1. The doc system at a glance

Four docs plus a parked-specs folder, each with one job:

| File | Job | Answers |
|------|-----|---------|
| `BRIEFING.md` | Product + design intent | *What* are we building and *why* |
| `POLISH-STRATEGY.md` | Visual technique + iOS perf | *How* to render it without breaking iOS |
| `CLAUDE.md` | Session operating instructions | What Claude Code should do at session start |
| `WORKING-WITH-CLAUDE.md` (this) | How to run the doc system | How to keep all of the above useful |
| `docs/future/` | Parked specs (e.g. Nature Trace) | Ideas not yet greenlit — kept out of the session path |

**Source-of-truth precedence when two docs seem to overlap:** `BRIEFING` owns product behavior and design intent; `POLISH-STRATEGY` owns visual technique, perf rules, and implementation patterns. If they conflict on a visual topic, that's a bug — surface it, don't silently pick.

**The one place status lives:** the **Decision log** at the end of `POLISH-STRATEGY.md`. Nowhere else should carry a dated "current state" snapshot.

---

## 2. Core principles (why the docs are shaped this way)

These are the rules that keep the docs from rotting. Most of the cleanup this system has needed traced back to violating one of them.

1. **Timeless vs. time-bound.** A *section* should still be true a year from now. Anything only true "as of a date" — what shipped, what's next, what we tried — goes in the append-only Decision log, never in a section. If you catch yourself writing "currently" or "as of" in a section, it belongs in the log.
2. **One home per fact.** Any fact written in two places will eventually disagree with itself. Before adding something, ask "where does this already live?" and point to it rather than restating it.
3. **Constraints steer; descriptions drift.** The content that most changes Claude's behavior is *rules and limits* it can't derive on its own: the layer budget, the file-ownership split, "never swap color categories." Descriptions of what the code already does compete with the code as a source of truth and lose. Prefer encoding a rule over narrating the implementation.
4. **Negative knowledge is the highest-value content.** "We tried SVG filters, it tanked iOS, don't relitigate" prevents an agent from confidently re-suggesting a known failure. The Anti-patterns list and the Decision log's dead-ends are worth more than any feature description. Keep writing these down.
5. **Describe conventions, not inventories.** Folder *conventions* (where a new game goes, the naming pattern) stay valid as files change; a file *list* is stale on the next commit. Claude can `ls`.

---

## 3. Starting a task with Claude

`BRIEFING.md` is large — don't ask Claude to "read the whole briefing" for a scoped task. Point it at the sections that matter. A good kickoff names: the goal, the relevant BRIEFING section(s), and the relevant POLISH rules if visual.

**Kickoff template:**

```
Task: <one line — what should exist when this is done>
Read first: BRIEFING §<n> (<why>), POLISH-STRATEGY §<name> (<why, if visual>)
Constraints that apply: <e.g. layer budget, file-ownership split, color roles>
Commit: after each verified step.
```

**Resolved:** Claude reads sections named in the task rather than the whole briefing — `CLAUDE.md` says so directly. Full reads are token-expensive and dull the signal. For backlog stories, the kickoff template above *is* the story's "Read first" + "Constraints" fields, and there is now a Definition of Ready / Done (§6). Ad-hoc chat tasks still scope verification as they come up.

---

## 4. Drift prevention — the one rule that matters

At the end of any session that **added or removed a file, subsystem, dependency, or scope decision**, do both of these before considering it finished:

1. **Reconcile intent:** confirm `BRIEFING.md` still describes the intended product correctly. (It describes intent, not status — so most implementation changes shouldn't touch it. Scope changes — like deferring a feature — do.)
2. **Log the change:** append one line to the `POLISH-STRATEGY.md` Decision log — `YYYY-MM-DD — what changed — what stuck`.

Every drift this project has had to clean up (a dead payment dependency in three files, stale "next step" snapshots, a completed plan still listed as upcoming) would have been caught by this single habit. **Resolved:** this is now an explicit workflow rule in `CLAUDE.md` (rule 4) so Claude Code self-enforces it, not just you.

---

## 5. "I just decided/changed X — where does it go?"

A quick routing map for new content:

- **A product or scope decision** (feature in/out, tier change, a screen's purpose) → `BRIEFING.md`, in the relevant section.
- **A visual technique or perf rule** (how to render, what's banned on iOS) → `POLISH-STRATEGY.md` rules/anti-patterns.
- **Something we tried and its outcome** (worked or failed) → `POLISH-STRATEGY.md` Decision log. Always.
- **A rule for how Claude should operate** (verify on X, commit cadence) → `CLAUDE.md`.
- **An idea, request, bug, or "we should…"** → a `status:draft` issue (GitHub, or `/groom <idea>`). The backlog, not a doc, is where *what's next* lives.
- **A large parked spec** (pages of design, not yet greenlit) → `docs/future/<name>.md`, with a draft issue that links to it.
- **A tuning constant / pixel value** → the code, not the docs.

---

## 6. Running Whoosha as Product Owner

Destin owns **what** gets built and **whether it's accepted**. Agents own **how**, including proving everything a machine can prove. The bottleneck in this model is not agent speed. It's (a) how sharp each story's acceptance criteria are and (b) the on-device review queue. Most of the process exists to protect those two.

### Flow

```
idea ─▶ status:draft ─(PO grooms + promotes)─▶ status:ready ─(/story)─▶ status:in-progress
     ─▶ PR opened, status:review ─(PO iPhone check)─▶ merge = accepted, issue auto-closes
                    └─ feedback on the PR ─▶ /story N reworks the same branch
     any stage ─▶ status:blocked (agent asked a question; answer it on the issue, then set ready again)
```

| Command (in Claude Code) | Who runs it | What it does |
|---|---|---|
| `/backlog` | PO | Read-only view, with what needs you listed first |
| `/groom <n or idea>` | PO | Turns an idea or draft into a story worth promoting. Asks you at most 3 questions |
| `/story` | PO kicks it off | The agent takes the next Ready story, builds it on `story/N-slug`, and opens a PR |
| `/story N` | PO | Same, for a specific story, or rework after your PR feedback |

You can also do everything from GitHub on your phone: add or remove the `status:*` label to promote or park a story, comment to answer a blocked question, and merge to accept.

### Definition of Ready (you check this before adding `status:ready`)

- The story says who benefits and why.
- Acceptance criteria are split into **agent-verifiable** checkboxes and **on-device** checks. The on-device checks are specific ("hold cue lands on the corner"), never "looks good".
- "Read first" names doc sections, and constraints and out-of-scope are written down.
- Size is S or M. Split anything L.
- Nothing it is "Blocked by" is still open, and every product decision it depends on has been made. If one hasn't, the decision is a `po-task`.

### Definition of Done (the agent delivers this, you confirm it)

- Every agent-verifiable criterion is ticked in the PR, with *how* it was verified. `npm run build` is clean.
- The perf cost is stated in the PR (CLAUDE.md rule 2).
- The Decision log line is in the PR, ending in "On-device pending: …".
- Out-of-scope findings are filed as drafts, not fixed.
- **You** ran the on-device checks on the iPhone and merged. Until you merge, the story is not done.

### Labels (source of truth for state)

- **Status** (exactly one): `status:draft`, `status:ready`, `status:in-progress`, `status:review`, `status:blocked`. Done = closed.
- **Priority:** `P1` (next up), `P2` (soon), `P3` (someday). The picker takes P1 before P2 before P3, oldest first within a level.
- **Type:** `type:feature`, `type:polish`, `type:bug`, `type:chore`, `type:docs`, `type:spike` (investigate and recommend, no product change).
- **Area:** `game:<name>` for each game, plus `area:audio`, `area:customization`, `area:app`, `area:launch`.
- **Size:** `size:S`, `size:M`, `size:L`. The picker skips L.
- `verify:ios`: has on-device checks. `po-task`: work only you can do (device checks, decisions, recordings, Supabase dashboard changes). Agents never pick these up.

### Habits that keep it working

- **Keep 2–4 stories Ready.** A larger queue goes stale as the code moves, and an empty one leaves agents idle.
- **Clear review before adding work.** Agents stop at 3 stories in review, by design.
- **Write negative knowledge into stories.** "Don't use SVG filters here, see the Anti-patterns" in a story's constraints is worth more than a paragraph of description.
- **Use `type:spike` when you don't know what you want yet.** The agent investigates and comes back with options and a recommendation. Then you write the real story.
- Things the agent *can't* settle are the ones that need your senses: feel, audio, visual taste on the device. Put those in the on-device checks, not the agent-verifiable ones.
