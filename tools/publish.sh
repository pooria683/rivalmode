#!/usr/bin/env bash
#
# Commit generated output and push it, surviving races with other workflows.
#
#   tools/publish.sh "<commit message>" <render command...>
#
# The hourly scoreboard, the daily rival scan and the one-off setup all write to
# the same files. If two of them run at once, the loser's push is rejected — and
# a naive `git pull --rebase` then conflicts inside a generated SVG. So on
# rejection we throw our generated output away, fast-forward to whatever landed,
# re-render on top of the new state, and try again.
#
# Requires: git identity configured (the workflows set it), GITHUB_REF_NAME set.

set -euo pipefail

MESSAGE="${1:?usage: publish.sh \"<message>\" <command...>}"
shift

BRANCH="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"
MAX_ATTEMPTS=3

# Locally there is often no remote; that is fine, we just commit.
HAS_REMOTE=0
if git remote get-url origin >/dev/null 2>&1; then
  HAS_REMOTE=1
fi

say() { printf '%s\n' "$*"; }

render() {
  if [ "$#" -eq 0 ]; then
    return 0
  fi
  "$@"
}

render "$@"

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  if [ -z "$(git status --porcelain)" ]; then
    say "nothing to commit — output already current"
    exit 0
  fi

  git add -A
  git commit -q -m "$MESSAGE"

  if [ "$HAS_REMOTE" -eq 0 ]; then
    say "committed locally (no origin remote configured)"
    exit 0
  fi

  if git push origin "HEAD:${BRANCH}"; then
    say "pushed to ${BRANCH} on attempt ${attempt}"
    exit 0
  fi

  say "push rejected (attempt ${attempt}/${MAX_ATTEMPTS}) — re-rendering on top of ${BRANCH}"
  git fetch --quiet origin "$BRANCH"
  # Generated files are derived data: never merge them, always regenerate.
  # Commit any human edits inside the generated files first, so a rebase can
  # never throw away someone else's work.
  git stash push --quiet --include-untracked -- assets 2>/dev/null || true
  git reset --hard --quiet "origin/${BRANCH}"
  # Re-apply the caller's own pending changes, if any.
  git stash pop --quiet 2>/dev/null || true
  render "$@"
done

say "could not publish after ${MAX_ATTEMPTS} attempts — the next scheduled run will pick it up"
git reset --hard "origin/${BRANCH}" >/dev/null 2>&1 || true
exit 1
