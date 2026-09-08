#!/usr/bin/env bash
# server.mjs / prompt.txt 등을 서버로 밀어넣고 gyeoldam-api 재시작.
# 사용: DEPLOY_TARGET=ubuntu@<host> ./deploy.sh   (.env / prompt.txt 는 서버 유지)
set -euo pipefail
cd "$(dirname "$0")"
: "${DEPLOY_TARGET:?DEPLOY_TARGET=ubuntu@<host> 를 지정해줘}"
KEY=${SSH_KEY:-$HOME/.ssh/id_ed25519}
REMOTE=${REMOTE_DIR:-/data/gyeoldam/app}

rsync -az --exclude .env --exclude node_modules --exclude deploy.sh --exclude 'prompt.example.txt' \
  -e "ssh -i $KEY" ./ "$DEPLOY_TARGET:$REMOTE/"
ssh -i "$KEY" "$DEPLOY_TARGET" "cd $REMOTE && npm install --omit=dev --no-audit --no-fund && sudo systemctl restart gyeoldam-api.service && sleep 2 && curl -s localhost:3110/health"
