#!/usr/bin/env bash
# Updates the app in the LXC to the latest commit of the current branch.
# Run as root: /opt/trading-app/deploy/update.sh
set -euo pipefail

APP=/opt/trading-app
cd "$APP"

echo "→ Pobieram kod"
sudo -u trading git pull --ff-only

echo "→ Instaluję zależności"
sudo -u trading npm ci --no-audit --no-fund

echo "→ Buduję aplikację webową"
sudo -u trading npm run build

# Migrations and reference data run on start, so a restart is enough.
echo "→ Restartuję API"
systemctl restart trading-app

sleep 3
if systemctl is-active --quiet trading-app && curl -fsS http://127.0.0.1:3001/health >/dev/null; then
  echo "✓ Gotowe: $(git log -1 --format='%h %s')"
else
  echo "✗ API nie wystartowało. Logi: journalctl -u trading-app -n 50"
  exit 1
fi
