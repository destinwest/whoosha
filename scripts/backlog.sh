#!/usr/bin/env bash
# backlog.sh — tiny helper over the GitHub REST API for the Whoosha story backlog.
#
# Labels are the source of truth for story state (see WORKING-WITH-CLAUDE.md §6).
# Uses `gh api` REST calls only, so it works both in a local Claude Code session
# and in cloud sessions where GitHub GraphQL is unavailable.
#
# Usage:
#   scripts/backlog.sh board            # one-screen summary of every open story by status
#   scripts/backlog.sh next             # print the number of the story an agent should take next (or nothing)
#   scripts/backlog.sh show <n>         # title, labels, and body of story n
#   scripts/backlog.sh status <n> <s>   # set status label: draft|ready|in-progress|review|blocked
#   scripts/backlog.sh comment <n> <text>
#   scripts/backlog.sh new <title> <body-file> [label ...]   # create a story (defaults to status:draft)
#   scripts/backlog.sh pr <n> <title> <body-file>             # open a PR from the current story/<n>-* branch to main
#   scripts/backlog.sh pr-for <n>                             # print the open PR (number + url) for story n, if any
#
# Requires: gh (authenticated: `gh auth login`), jq is NOT required (uses gh --jq).

set -euo pipefail

REPO="${WHOOSHA_REPO:-destinwest/whoosha}"
STATUSES="draft ready in-progress review blocked"

die() { echo "backlog: $*" >&2; exit 1; }

open_issues() {
  # All open issues (not PRs), as TSV: number \t title \t comma-separated labels
  gh api --paginate "repos/$REPO/issues?state=open&per_page=100" \
    --jq '.[] | select(.pull_request == null) | [.number, .title, ([.labels[].name] | join(","))] | @tsv'
}

issue_is_open() {
  local state
  state=$(gh api "repos/$REPO/issues/$1" --jq '.state' 2>/dev/null || echo "missing")
  [[ "$state" == "open" ]]
}

# Story numbers this issue says it's blocked by ("Blocked by #12", "Depends on #7").
blockers_of() {
  gh api "repos/$REPO/issues/$1" --jq '.body // ""' \
    | grep -oiE '(blocked by|depends on)[^#]*#[0-9]+' \
    | grep -oE '#[0-9]+' | tr -d '#' || true
}

prio_rank() {
  case ",$1," in
    *,P1,*) echo 1 ;;
    *,P2,*) echo 2 ;;
    *,P3,*) echo 3 ;;
    *)      echo 9 ;;
  esac
}

cmd_board() {
  local rows
  rows=$(open_issues)
  for s in in-progress review ready blocked draft; do
    echo "== status:$s =="
    echo "$rows" | awk -F'\t' -v s="status:$s" '("," $3 ",") ~ ("," s ",") && ("," $3 ",") !~ /,po-task,/ { printf "  #%-4s %s  [%s]\n", $1, $2, $3 }'
  done
  echo "== po-task (yours, Destin) =="
  echo "$rows" | awk -F'\t' '("," $3 ",") ~ /,po-task,/ { printf "  #%-4s %s  [%s]\n", $1, $2, $3 }'
}

cmd_next() {
  # Candidates: status:ready, not po-task, size not L, all blockers closed.
  # Order: priority (P1 first), then oldest issue number.
  local best="" best_key="99999999"
  while IFS=$'\t' read -r num title labels; do
    [[ -z "$num" ]] && continue
    [[ ",$labels," == *",status:ready,"* ]] || continue
    [[ ",$labels," == *",po-task,"* ]] && continue
    [[ ",$labels," == *",size:L,"* ]] && continue
    local blocked=0
    for b in $(blockers_of "$num"); do
      if issue_is_open "$b"; then blocked=1; break; fi
    done
    [[ $blocked -eq 1 ]] && continue
    local key
    key=$(printf '%d%06d' "$(prio_rank "$labels")" "$num")
    if [[ "$key" < "$best_key" ]]; then best_key="$key"; best="$num"; fi
  done <<< "$(open_issues)"
  [[ -n "$best" ]] && echo "$best"
  return 0
}

cmd_show() {
  [[ $# -eq 1 ]] || die "usage: show <n>"
  gh api "repos/$REPO/issues/$1" \
    --jq '"#\(.number) \(.title)\nstate: \(.state)\nlabels: \([.labels[].name] | join(", "))\nurl: \(.html_url)\n\n\(.body // "")"'
  echo
  echo "---- comments ----"
  gh api "repos/$REPO/issues/$1/comments" --jq '.[] | "[\(.user.login) \(.created_at)]\n\(.body)\n"'
}

cmd_status() {
  [[ $# -eq 2 ]] || die "usage: status <n> <$STATUSES>"
  local n="$1" s="$2"
  [[ " $STATUSES " == *" $s "* ]] || die "unknown status '$s' (one of: $STATUSES)"
  for old in $STATUSES; do
    gh api -X DELETE "repos/$REPO/issues/$n/labels/status:$old" >/dev/null 2>&1 || true
  done
  gh api -X POST "repos/$REPO/issues/$n/labels" -f "labels[]=status:$s" >/dev/null
  echo "#$n → status:$s"
}

cmd_comment() {
  [[ $# -ge 2 ]] || die "usage: comment <n> <text>"
  local n="$1"; shift
  gh api -X POST "repos/$REPO/issues/$n/comments" -f "body=$*" --jq '.html_url'
}

cmd_new() {
  [[ $# -ge 2 ]] || die "usage: new <title> <body-file> [label ...]"
  local title="$1" body_file="$2"; shift 2
  local labels=("$@")
  local has_status=0
  for l in "${labels[@]:-}"; do [[ "$l" == status:* ]] && has_status=1; done
  [[ $has_status -eq 1 ]] || labels+=("status:draft")
  local args=(-X POST "repos/$REPO/issues" -f "title=$title" -F "body=@$body_file")
  for l in "${labels[@]}"; do [[ -n "$l" ]] && args+=(-f "labels[]=$l"); done
  gh api "${args[@]}" --jq '"#\(.number) \(.html_url)"'
}

cmd_pr() {
  [[ $# -eq 3 ]] || die "usage: pr <n> <title> <body-file>"
  local n="$1" title="$2" body_file="$3" branch
  branch=$(git rev-parse --abbrev-ref HEAD)
  [[ "$branch" == story/"$n"-* ]] || die "current branch '$branch' is not story/$n-*"
  gh api -X POST "repos/$REPO/pulls" -f "title=$title" -f "head=$branch" -f "base=main" \
    -F "body=@$body_file" --jq '"PR #\(.number) \(.html_url)"'
}

cmd_pr_for() {
  [[ $# -eq 1 ]] || die "usage: pr-for <n>"
  gh api --paginate "repos/$REPO/pulls?state=open&per_page=100" \
    --jq ".[] | select(.head.ref | startswith(\"story/$1-\")) | \"PR #\\(.number) \\(.head.ref) \\(.html_url)\""
}

sub="${1:-board}"; shift || true
case "$sub" in
  board)   cmd_board ;;
  next)    cmd_next ;;
  show)    cmd_show "$@" ;;
  status)  cmd_status "$@" ;;
  comment) cmd_comment "$@" ;;
  new)     cmd_new "$@" ;;
  pr)      cmd_pr "$@" ;;
  pr-for)  cmd_pr_for "$@" ;;
  *) die "unknown command '$sub' (board|next|show|status|comment|new|pr|pr-for)" ;;
esac
