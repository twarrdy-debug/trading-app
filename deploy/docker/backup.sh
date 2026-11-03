#!/bin/sh
# Daily database backup, keeping KEEP_DAYS days (the privacy policy promises 30). Old copies go only
# after today's has been made and looks complete, and the newest is never removed.
#   /etc/cron.d/trading-backup: 0 3 * * * root /opt/trading-app/deploy/docker/backup.sh
set -eu

APP_DIR="${APP_DIR:-/opt/trading-app}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"

umask 077
mkdir -p "$BACKUP_DIR"
target="$BACKUP_DIR/trading-$(date +%F-%H%M).dump"
partial="$target.partial"
trap 'rm -f "$partial"' EXIT

cd "$APP_DIR"
docker compose exec -T db pg_dump -U trading -d trading -Fc > "$partial"
# A custom-format dump starts with PGDMP; an error message or an empty file does not.
[ "$(head -c 5 "$partial")" = "PGDMP" ] || { echo "backup failed: $partial is not a dump" >&2; exit 1; }
mv "$partial" "$target"

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'trading-*.dump' -mtime +"$KEEP_DAYS" ! -path "$target" -delete
