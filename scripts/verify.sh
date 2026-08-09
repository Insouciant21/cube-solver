#!/usr/bin/env bash
set -euo pipefail

npm run test:web
npm run lint:web
npm run typecheck:web
npm run build:web

(
  cd apps/api
  uv run pytest
  uv run ruff check .
  uv run mypy
)
