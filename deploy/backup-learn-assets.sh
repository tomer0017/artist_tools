#!/usr/bin/env bash
# Copy Learn's asset files beside the database dumps (ADR-0017,
# docs/ops/backups.md). Files never change (each is named by the SHA-256 of
# its bytes), so the copy is incremental: only files not copied before are
# copied, nothing is ever overwritten or deleted, and every file in the copy
# is checked against its name. Run as root, nightly by cron at 02:50.
#
#   studio-learn-assets-backup <environment>
#
# Exit code 1 if any file is unreadable or does not match its name.
set -euo pipefail
umask 077

ENV_NAME="${1:?usage: studio-learn-assets-backup <environment>}"
SRC="/var/lib/studio-companion/${ENV_NAME}/learn-assets"
DEST="/var/backups/learn-assets/${ENV_NAME}"
[ -d "$SRC" ] || { echo "no asset directory $SRC (deploy/install-learn-assets.sh)" >&2; exit 1; }
install -d -m 0700 "$DEST"

copied=0
problems=0
NAME='^[0-9a-f]{64}\.(jpg|png|webp|pdf)$'
shopt -s nullglob
for file in "$SRC"/*; do
  name="$(basename "$file")"
  # Only finished assets: temporary files (".<id>.<random>.tmp") and anything else are not copied.
  [[ -f "$file" && "$name" =~ $NAME ]] || continue
  [ -e "$DEST/$name" ] && continue
  cp --preserve=timestamps "$file" "$DEST/.$name.part"
  if [ "$(sha256sum "$DEST/.$name.part" | cut -d' ' -f1)" = "${name%.*}" ]; then
    mv "$DEST/.$name.part" "$DEST/$name"
    copied=$((copied + 1))
  else
    rm -f "$DEST/.$name.part"
    echo "PROBLEM: $SRC/$name does not match its name; not copied" >&2
    problems=$((problems + 1))
  fi
done

# The whole copy, checked: every file still has exactly the bytes its name says.
total=0
for file in "$DEST"/*; do
  name="$(basename "$file")"
  [[ "$name" =~ $NAME ]] || continue
  total=$((total + 1))
  if [ "$(sha256sum "$file" | cut -d' ' -f1)" != "${name%.*}" ]; then
    echo "PROBLEM: the backup copy of $name does not match its name" >&2
    problems=$((problems + 1))
  fi
done
in_source=$(find "$SRC" -maxdepth 1 -type f -regextype posix-extended -regex ".*/[0-9a-f]{64}\.(jpg|png|webp|pdf)" | wc -l)
echo "[learn-assets-backup ${ENV_NAME}] $(date -u +%Y-%m-%dT%H:%M:%SZ): $copied copied, $total in the copy ($in_source in the directory), $problems problem(s)"
[ "$problems" -eq 0 ]
