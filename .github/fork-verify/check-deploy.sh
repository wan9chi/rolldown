#!/usr/bin/env bash
# Fork verification, Deploy to Void: show how `vp run docs:void` ran and what `void deploy`
# sent to the mock Void API, and compare that manifest with .vitepress/dist.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
dist=docs/.vitepress/dist

echo "::group::vp run --last-details (the last vp run: void deploy)"
vp run --last-details || true
echo "::endgroup::"

echo "::group::Mock Void API log"
cat "$RUNNER_TEMP/mock-void-api.log" || echo "(no requests)"
echo "::endgroup::"

echo "::group::void deploy log"
cat "$HOME"/.void/logs/deploy-*.jsonl 2>/dev/null | grep -E '"(deploy_start|github_oidc_exchange_success|project_resolved|preflight_start|preflight_end|presign_request_start|upload_urls_response|deploy_end)"' || true
echo "::endgroup::"

manifest="$RUNNER_TEMP/mock-void-manifest.txt"
if [ -f "$manifest" ]; then
  (cd "$dist" && find . -type f ! -name _redirects | sed 's#^\./#/#' | LC_ALL=C sort) > "$RUNNER_TEMP/dist-files.txt"
  LC_ALL=C sort "$manifest" -o "$manifest"
  echo "Files in $dist (without _redirects): $(wc -l < "$RUNNER_TEMP/dist-files.txt")"
  echo "Files in the manifest void deploy sent: $(wc -l < "$manifest")"
  if cmp -s "$RUNNER_TEMP/dist-files.txt" "$manifest"; then
    echo "The manifest lists exactly the files in $dist."
  else
    echo "::error::The manifest and $dist differ:"
    comm -3 "$RUNNER_TEMP/dist-files.txt" "$manifest" | head -20
  fi
else
  echo "::error::void deploy never reached preflight."
fi
if [ -n "${ALGOLIA_APP_ID:-}" ] && grep -rqF "$ALGOLIA_APP_ID" "$dist"; then
  echo "The deployed build embeds ALGOLIA_APP_ID ($ALGOLIA_APP_ID)."
else
  echo "::error::The deployed build does not embed ALGOLIA_APP_ID."
fi
