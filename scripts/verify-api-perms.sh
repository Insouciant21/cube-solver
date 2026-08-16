#!/usr/bin/env bash
set -euo pipefail

# Verifies that apps/api/Dockerfile guarantees Python sources under
# /app/src remain readable by the runtime user (nobody), even though the
# committed source files carry mode 0600. A plain `COPY src ./src` would
# preserve 0600 and break the non-root container (PermissionError on
# reading /app/src/cube_api/__init__.py).
#
# Usage: bash scripts/verify-api-perms.sh
#   * Always performs a static policy check on the Dockerfile.
#   * If Docker is available, additionally builds the api image and checks
#     that the copied source files are readable by user nobody.

DOCKERFILE="${1:-apps/api/Dockerfile}"

if [[ ! -f "$DOCKERFILE" ]]; then
  echo "ERROR: Dockerfile not found: $DOCKERFILE" >&2
  exit 1
fi

copy_line="$(grep -nE '^COPY[[:space:]]+src[[:space:]]+\./src' "$DOCKERFILE" | head -1 || true)"
user_line="$(grep -nE '^USER[[:space:]]+nobody' "$DOCKERFILE" | head -1 || true)"

[[ -n "$copy_line" ]] || { echo "ERROR: missing 'COPY src ./src'" >&2; exit 1; }
[[ -n "$user_line" ]] || { echo "ERROR: missing 'USER nobody' (read-only constraint)" >&2; exit 1; }

copy_no="${copy_line%%:*}"

# There must be a `RUN chmod ... /app/src` between `COPY src` and `USER nobody`.
if ! awk -v after="$copy_no" '
  /^USER[[:space:]]+nobody/ { exit }
  NR > after && /^RUN/ && /chmod/ && /\/app\/src/ { ok = 1 }
  END { exit ok ? 0 : 1 }
' "$DOCKERFILE"; then
  echo "ERROR: Dockerfile must chmod /app/src (world-readable) after 'COPY src' and before 'USER nobody'" >&2
  exit 1
fi

# Reproduce the bug condition: the committed sources are 0600.
host_mode="$(stat -c '%a' apps/api/src/cube_api/__init__.py 2>/dev/null || echo '?')"
echo "host source mode:  $host_mode (0600 reproduces the reported PermissionError)"
echo "policy check:      OK (COPY src -> chmod /app/src -> USER nobody)"

# Optional end-to-end check when Docker is available.
if command -v docker >/dev/null 2>&1; then
  echo "docker:            building api image..."
  (cd apps/api && docker build -q -t cube-api-perm-check . )
  docker run --rm --user nobody --entrypoint sh cube-api-perm-check -c \
    'test -r /app/src/cube_api/__init__.py && test -x /usr/local/bin/ida_search_via_graph && echo "nobody can read source and execute IDA helper: OK"' \
    || { echo "ERROR: nobody cannot read /app/src in built image" >&2; exit 1; }
else
  echo "docker:            not available; skipped end-to-end check"
fi

echo "verify-api-perms: PASS"
