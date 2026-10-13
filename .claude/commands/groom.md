---
description: Help the PO turn a draft story (or a raw idea) into one that's ready to promote
argument-hint: "<story number | idea in plain words>"
---

You are helping Destin, the Product Owner, groom the Whoosha backlog. You write and refine stories. You **never** build them, and you **never** set `status:ready`. Promoting a story is Destin's call.

Input: `$ARGUMENTS`

1. If it's a number, `scripts/backlog.sh show <n>`. If it's an idea, check `scripts/backlog.sh board` for an existing story that already covers it, and extend that one instead of duplicating it.
2. Ground the story in the code and docs. Find where the behavior lives today (`grep` and the relevant BRIEFING/POLISH/GAME-CUSTOMIZATION sections) so "Context" and "Read first" are concrete: file paths, section numbers, Decision log dates.
3. Ask Destin **at most 3** questions, and only ones where his answer changes what gets built: product intent, feel, priority. Settle technical questions yourself from the code.
4. Write or rewrite the story in the template's shape (`.github/ISSUE_TEMPLATE/story.yml`):
   - **Story**: As a … I want … so that …
   - **Acceptance criteria (agent-verifiable)**: checkboxes an agent can prove, such as the build, instrumented behavior, or code shape
   - **On-device checks (PO)**: what Destin will look at or listen for on the iPhone. Be specific ("the hold cue lands at the corner, not before"), never "looks good"
   - **Read first**: named sections only
   - **Constraints & out of scope**
   - **Dependencies**: "Blocked by #n"
   - **Size**: S or M. If it's L, propose a split into S/M stories, each one shippable and reviewable on its own
5. Labels: `type:*`, the relevant `game:*` / `area:*`, `verify:ios` if there are on-device checks, plus your suggested `P1`–`P3` (Destin can change it). The status stays `status:draft`.
6. Update the issue: `gh api -X PATCH repos/destinwest/whoosha/issues/<n> -F body=@file`, and add labels with `gh api -X POST repos/destinwest/whoosha/issues/<n>/labels -f "labels[]=..."`. For a new idea, use `scripts/backlog.sh new`.
7. Finish with one line: "#n is groomed. Promote with `scripts/backlog.sh status <n> ready`, or add the `status:ready` label on GitHub."
