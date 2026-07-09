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

**Resolved:** Claude reads sections named in the task rather than the whole briefing — `CLAUDE.md` says so directly. Full reads are token-expensive and dull the signal; this project isn't formal enough yet to warrant a fixed Definition-of-Done checklist per task type, so there isn't one — verification is scoped per task as it comes up.

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
- **An idea not yet greenlit** → `docs/future/<name>.md`.
- **A tuning constant / pixel value** → the code, not the docs.
