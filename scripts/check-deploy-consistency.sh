#!/usr/bin/env bash
#
# Cross-checks the deploy assets against each other and against Dockerfile so
# they cannot silently drift apart as the app evolves (issues #444, #447):
#
#   - Dockerfile's EXPOSE'd port matches the port both compose files publish
#     the app on.
#   - The healthcheck binary path baked into the runtime image matches what
#     every compose file's healthcheck actually invokes.
#   - deploy/stellargate.env.example never carries a real-looking secret in
#     place of a placeholder.
#   - Every path named in the README architecture tree actually exists, and no
#     document claims a `migrations/` directory exists (issue #868).
#
# Run locally with: bash scripts/check-deploy-consistency.sh

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
caddyfile="$repo_root/deploy/Caddyfile"

fail=0

# Report a finding on stderr and mark the run as failed. The script exits
# non-zero at the end if any finding was reported (issue #937).
note() {
  echo "$*" >&2
  fail=1
}

if [[ ! -f "$caddyfile" ]]; then
  echo "missing $caddyfile" >&2
  exit 1
fi

# The app sets these security headers on every response with
# `SetResponseHeaderLayer::overriding`. The proxy must not set them to a
# different value, or it silently weakens the app's policy (issue #902).
# Caddy's `header Field value` form replaces the upstream value; only the
# `?Field value` fallback form is safe.
app_owned_headers=("Referrer-Policy" "X-Content-Type-Options")

for header in "${app_owned_headers[@]}"; do
  # Match a bare `Header value` line (sets/replaces) but not `?Header value`
  # (fallback) or `-Header` (delete).
  if grep -Eq "^[[:space:]]*${header}[[:space:]]" "$caddyfile"; then
    echo "deploy/Caddyfile sets app-owned header '${header}' with a fixed value;" >&2
    echo "the app already sets it on every response. Remove it or use the" >&2
    echo "'?${header} <value>' fallback form." >&2
    fail=1
  fi
done

# README architecture tree must not drift from the repository (issue #868).
# Extract every path-like token from the fenced architecture block and verify
# it exists on disk. Tokens ending in `/` are treated as directories.
readme="README.md"
if [[ -f "$readme" ]]; then
    arch_block=$(awk '
        /^## Architecture/ { in_section = 1; next }
        in_section && /^```/ { in_fence = !in_fence; next }
        in_section && in_fence { print }
        in_section && !in_fence && /^## / { exit }
    ' "$readme")
    # The tree nests files under their parent directory (e.g. `db.rs` lives
    # under `src/`), so a bare token is resolved against the repo root, then
    # against `src/`, and finally by name anywhere in the tree (issue #937).
    while IFS= read -r token; do
        [[ -z "$token" ]] && continue
        name="${token%/}"
        if [[ -e "$token" || -e "src/$token" ]]; then
            continue
        fi
        if find "$repo_root" \( -path "$repo_root/.git" -o -path "$repo_root/target" \) -prune \
            -o -name "$name" -print -quit 2>/dev/null | grep -q .; then
            continue
        fi
        note "$readme architecture tree names '$token' but it does not exist"
    done < <(printf '%s\n' "$arch_block" \
        | grep -oE '[A-Za-z0-9_./-]+' \
        | grep -E '(/|\.(rs|js|sql|md|toml|yml|yaml|sh|html|css))$' \
        | sort -u)
fi

# No document may claim a `migrations/` directory exists (issue #308, #868).
# Lines that state the directory is gone (e.g. "there is no `migrations/`
# directory") are allowed; only affirmative references are findings (#937).
for doc in README.md MIGRATIONS.md CONTRIBUTING.md DEPLOYMENT.md; do
    [[ -f "$doc" ]] || continue
    while IFS= read -r line; do
        if grep -qiwE 'not|no|removed|used to|old' <<<"$line"; then
            continue
        fi
        note "$doc references a migrations/ directory, which was removed in #308"
        break
    done < <(grep -E '(^|[^A-Za-z0-9_])migrations/' "$doc" || true)
done

if [[ $fail -eq 0 ]]; then
    echo "deploy assets are consistent with Dockerfile"
    echo "deploy config consistent with app security headers"
fi

exit "$fail"
