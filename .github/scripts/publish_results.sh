#!/usr/bin/env bash
# Commit a directory of results onto the `results` branch, where the web app
# reads them through the GitHub API.
#
#   publish_results.sh <source_dir> <dest_path_on_results_branch>
#
# Several runs can finish at once, so pushes retry with a rebase. Every run
# writes to its own folder, so the rebases never conflict.
#
# Needs GH_TOKEN (the workflow's github.token) and GITHUB_REPOSITORY.
set -euo pipefail

SRC="$1"
DEST="$2"
WORK="$(mktemp -d)"
REMOTE="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

git config --global user.name "github-actions[bot]"
git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"

if git fetch --quiet --depth=50 "$REMOTE" results 2>/dev/null; then
  git worktree add --detach "$WORK" FETCH_HEAD
else
  # First run ever: start the branch with no history from main.
  git worktree add --detach "$WORK"
  git -C "$WORK" checkout --orphan results-new
  git -C "$WORK" rm -rf --quiet .
fi

mkdir -p "$WORK/$DEST"
cp -r "$SRC"/. "$WORK/$DEST/"
git -C "$WORK" add -A
git -C "$WORK" commit --quiet -m "Results: $DEST"

for attempt in 1 2 3 4 5; do
  if git -C "$WORK" push --quiet "$REMOTE" HEAD:refs/heads/results; then
    echo "Published $DEST to the results branch"
    exit 0
  fi
  echo "Push rejected (another run finished first) -- retrying ($attempt/5)"
  sleep $((attempt * 3))
  git -C "$WORK" fetch --quiet --depth=50 "$REMOTE" results
  git -C "$WORK" rebase --quiet FETCH_HEAD
done

echo "::error::Couldn't publish results after 5 attempts"
exit 1
