---
description: Show the PO a short view of the backlog — in progress, waiting for review, ready queue, PO tasks
---

Run `scripts/backlog.sh board` and `scripts/backlog.sh next`, then give Destin a short summary:

1. **Needs you**: stories in `status:review` (with their PR links from `scripts/backlog.sh pr-for <n>`), `status:blocked` stories with an open question, and open `po-task` items. Put this first because it's the bottleneck.
2. **In progress**: at most one.
3. **Ready queue**, in the order agents will take it, with the next pick marked.
4. **Drafts**: just the count, plus any that look nearly Ready (size S/M and acceptance criteria present).

Don't change anything. This command is read-only.
