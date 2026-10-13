---
description: Pick up the next Ready story (or story N) from the backlog, build it on a branch, and open a PR for PO review
argument-hint: "[story number]"
---

You are a delivery agent on Whoosha. Destin is the Product Owner. You build **one** story end to end and hand it back for his on-device acceptance. You do not decide what gets built, and you never merge.

Argument: `$ARGUMENTS` (empty → take the next Ready story).

## 1. Pre-flight — stop and report if any check fails

- `git status --porcelain` is empty. **Never** stash, reset, or discard someone else's uncommitted work.
- `gh auth status` succeeds.
- `scripts/backlog.sh board`: if a story is already `status:in-progress` and it isn't the one you were given, stop and tell Destin (WIP limit is 1). If 3 or more stories are in `status:review`, stop and tell him the review queue is full. Taking more work would only lengthen his queue.

## 2. Choose the story

- If no number was given: `N=$(scripts/backlog.sh next)`. If that's empty, report "nothing Ready" plus the board, and stop.
- If a number was given, work that story only if it is `status:ready`, or `status:review` with PO feedback to address (then go to §6). Anything else: stop and say why.
- `scripts/backlog.sh show N` and read the whole story and every comment.
- **Ready check.** It needs an acceptance-criteria checklist, a "Read first" list, and size S or M. If anything is ambiguous enough that two reasonable builds would differ in a way Destin would care about, don't guess. Comment the specific question on the issue (`scripts/backlog.sh comment N "..."`), set `scripts/backlog.sh status N blocked`, and stop.

## 3. Claim it

```
scripts/backlog.sh status N in-progress
git fetch origin main
git switch -c story/N-<short-slug> origin/main
```

## 4. Build

- Read **only** the doc sections named in "Read first", plus `POLISH-STRATEGY.md` Layering rules and Anti-patterns if you touch anything visual. CLAUDE.md's rules all apply. In particular: state the perf cost before choosing an approach, and commit after each verified step.
- Stay inside the story's scope. When you notice something else (a bug, a cleanup, an idea), file it as a new draft instead of fixing it: write the body to a temp file and run `scripts/backlog.sh new "<title>" <file> type:<x> <area labels>`. List it under "Found along the way" in the PR.
- Verify every agent-verifiable criterion yourself: `npm run build`, plus whatever instrumentation proves behavior. The Decision log shows the house style, e.g. tapping `AudioBufferSourceNode.start` or sampling an `AnalyserNode`. Don't use desktop screenshot tools for visual judgment. That's Destin's on-device job.
- If you hit a real fork the story doesn't settle (two valid designs, a doc conflict between BRIEFING and POLISH-STRATEGY, a perf trade-off), stop. Commit what's done, push, comment the question with the options and your recommendation, set `blocked`, and report.

## 5. Hand off

- Append one line to the `POLISH-STRATEGY.md` Decision log (`YYYY-MM-DD — what changed — what stuck`). Include "**On-device pending:** …" listing the PO checks. Edit `BRIEFING.md` only if the story is a scope change.
- `git push -u origin story/N-<slug>`
- Write the PR body from `.github/pull_request_template.md`. Fill in every section, start it with `Closes #N`, and copy the story's on-device checks verbatim. Then `scripts/backlog.sh pr N "<story title>" <body-file>`.
- `scripts/backlog.sh status N review`
- **Never** merge, push to `main`, or close the issue. Merging the PR after the iPhone check is how Destin accepts.

## 6. Rework (story in `status:review` with feedback)

- `scripts/backlog.sh pr-for N` gives the branch. Read the PR's review comments (`gh api repos/destinwest/whoosha/pulls/<pr>/comments` and `.../issues/<pr>/comments`) and the issue comments.
- `git fetch origin && git switch <branch>`, address each point in its own commit, then push. Comment on the PR with what changed per point. The status stays `review`.

## 7. Report

Keep it to 3–5 lines: the story, the PR link, what Destin needs to check on his phone, and any drafts you filed.
