#!/usr/bin/env bash
# Deploy doc2dpp to https://doc2dpp.wisecraft.dev from a laptop: ./deploy/deploy.sh [branch]
# Safe to re-run. The first run also installs a private Node 24, the env file, the nginx site and the certificate.
# It only ever touches /opt/doc2dpp, /etc/doc2dpp, the doc2dpp nginx site and the doc2dpp PM2 app.
set -euo pipefail
HOST=${DEPLOY_HOST:-hetzner}
BRANCH=${1:-spec-1-integration}
DOMAIN=doc2dpp.wisecraft.dev
NODE_VERSION=v24.10.0
cd "$(dirname "$0")/.."

# Secrets: copy the local .env once (mode 600) and add a session secret; never overwrite an existing one.
if ! ssh "$HOST" test -f /etc/doc2dpp/env; then
  test -f .env || { echo "no local .env to seed /etc/doc2dpp/env from" >&2; exit 1; }
  ssh "$HOST" 'install -d -m 700 /etc/doc2dpp && umask 077 && cat > /etc/doc2dpp/env && echo "SESSION_SECRET=$(openssl rand -hex 32)" >> /etc/doc2dpp/env && chmod 600 /etc/doc2dpp/env' < .env
  echo "secrets: /etc/doc2dpp/env created (mode 600)"
fi

ssh "$HOST" BRANCH="$BRANCH" NODE_VERSION="$NODE_VERSION" DOMAIN="$DOMAIN" bash -s <<'REMOTE'
set -euo pipefail
NODE=/opt/doc2dpp/node
if [ "$($NODE/bin/node -v 2>/dev/null)" != "$NODE_VERSION" ]; then
  rm -rf $NODE.tmp && mkdir -p $NODE.tmp
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz" | tar -xJ -C $NODE.tmp --strip-components=1
  rm -rf $NODE && mv $NODE.tmp $NODE
fi
export PATH=$NODE/bin:$PATH

if [ ! -d /opt/doc2dpp/app/.git ]; then
  git clone --branch "$BRANCH" https://github.com/ArturShirokov/hackmeridian.git /opt/doc2dpp/app
fi
cd /opt/doc2dpp/app
git fetch --quiet origin "$BRANCH"
git checkout --quiet "$BRANCH"
git reset --quiet --hard "origin/$BRANCH"
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent

SITE=/etc/nginx/sites-enabled/$DOMAIN
if [ ! -f "$SITE" ]; then
  cp deploy/nginx.conf "$SITE"
  nginx -t && systemctl reload nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect --register-unsafely-without-email
fi
nginx -t

if pm2 describe doc2dpp >/dev/null 2>&1; then pm2 reload deploy/ecosystem.config.cjs --update-env
else pm2 start deploy/ecosystem.config.cjs; fi
pm2 save >/dev/null
REMOTE

for i in $(seq 1 30); do
  if curl -fsS "https://$DOMAIN/api/health"; then echo; echo "deployed $BRANCH to https://$DOMAIN"; exit 0; fi
  sleep 2
done
echo "health check failed: see ssh $HOST pm2 logs doc2dpp" >&2
exit 1
