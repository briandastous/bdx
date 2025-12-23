#!/usr/bin/env bash
set -euo pipefail

pnpm dlx openapi-typescript@6.7.5 \
  openapi/twitterapi.io.yaml \
  --output packages/twitterapi-io-types/src/index.ts
