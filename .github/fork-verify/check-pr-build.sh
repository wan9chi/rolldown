#!/usr/bin/env bash
# Fork verification, PR runs: show how the cached build ran, check that its output has the
# search keys, then compare it with a fresh, uncached build of the same tree.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
dist=docs/.vitepress/dist

echo "::group::vp run --last-details (the Build Docs step)"
vp run --last-details || true
echo "::endgroup::"

echo "Files in $dist: $(find "$dist" -type f | wc -l)"
if [ -n "${ALGOLIA_APP_ID:-}" ] && grep -rqF "$ALGOLIA_APP_ID" "$dist"; then
  echo "The build embeds ALGOLIA_APP_ID ($ALGOLIA_APP_ID)."
else
  echo "::error::The build does not embed ALGOLIA_APP_ID."
fi

restored="$RUNNER_TEMP/restored-dist"
rm -rf "$restored" && cp -R "$dist" "$restored"
vp run --no-cache --filter rolldown-docs build > "$RUNNER_TEMP/fresh-build.log" 2>&1
echo "::group::Files that differ between this build and a fresh, uncached build"
diff -rq "$restored" "$dist" | sed "s#$RUNNER_TEMP/restored-dist#restored#; s#$dist#fresh#g" || true
echo "::endgroup::"
echo "Differing files: $(diff -rq "$restored" "$dist" | wc -l)"
