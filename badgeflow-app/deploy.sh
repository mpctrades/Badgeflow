#!/usr/bin/env bash
# Deploys this app to the dev server (dev.badgeflow.mpctrades.com).
# Uploads code, installs deps, applies DB migrations, builds, restarts.
# The server keeps its own .env and SQLite database; neither is overwritten.
set -euo pipefail

HOST="devteam02@187.52.115.100"
KEY="$HOME/.ssh/badgeflow_deploy"
DIR="apps/badgeflow-dev"
SSH=(ssh -i "$KEY" -o BatchMode=yes)

cd "$(dirname "$0")"
npm run typecheck

rsync -az --delete -e "ssh -i $KEY -o BatchMode=yes" \
  --exclude node_modules --exclude build --exclude .react-router \
  --exclude 'prisma/dev.sqlite*' --exclude .env --exclude .shopify --exclude .git \
  ./ "$HOST:$DIR/"

"${SSH[@]}" "$HOST" "cd ~/$DIR && npm ci --no-audit --no-fund && npx prisma generate && npx prisma migrate deploy && npm run build && sudo systemctl restart badgeflow-dev && sleep 3 && systemctl is-active badgeflow-dev"

curl -fsS -o /dev/null -w "https://dev.badgeflow.mpctrades.com -> %{http_code}\n" https://dev.badgeflow.mpctrades.com/
