#!/usr/bin/env bash
# Build the browser-only version and publish it to the gh-pages branch (GitHub Pages).
# Usage: npm run deploy:pages
set -euo pipefail
cd "$(dirname "$0")/.."

remote="$(git remote get-url origin)"
npm --prefix server test
npm --prefix web run build:pages

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp -R web/dist/. "$tmp"
touch "$tmp/.nojekyll" # serve files as-is (no Jekyll processing)

git -C "$tmp" init -q -b gh-pages
git -C "$tmp" add -A
git -C "$tmp" commit -q -m "Deploy PlaceCal ($(date '+%Y-%m-%d %H:%M'))

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
# gh-pages only ever holds the latest build, so it is replaced on each deploy.
git -C "$tmp" push -q -f "$remote" gh-pages
echo "Published. GitHub Pages updates in about a minute."
