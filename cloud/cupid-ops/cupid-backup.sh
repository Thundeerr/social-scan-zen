#!/usr/bin/env bash
set -euo pipefail
umask 077
base=/var/backups/cupid-browser
unit=cupid-setup-chrome.service
exec 9>"$base/backup.lock"
flock -n 9 || exit 0
marker="$base/.backup-freeze-owned"
thaw_owned() {
  # The service cleanup may also run after an early exit. Never thaw a freeze
  # that belongs to another operator, or report success while ours remains.
  [[ -f "$marker" ]] || return 0
  systemctl thaw "$unit"
  [[ $(systemctl show "$unit" -p FreezerState --value) == running ]] || return 1
  rm -f -- "$marker"
}
if [[ ${1:-} == --thaw-owned ]]; then
  thaw_owned
  exit
fi
cleanup() {
  result=$?
  if ! thaw_owned; then
    echo 'cupid_backup_error: browser thaw not confirmed' >&2
    result=1
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# A marker left by an interrupted backup is ours to recover before starting.
thaw_owned
# Reserve both the complete snapshot size and 10 GiB for the other services.
# Apparent size includes sparse files that tar would otherwise expand.
free=$(df -Pk "$base" | awk 'NR==2 {print $4}')
needed=$(du -sk --apparent-size /var/lib/cupid-browser/profile /var/lib/cupid-browser/extension | awk '{sum+=$1} END {print sum}')
[[ $free =~ ^[0-9]+$ && $needed =~ ^[0-9]+$ ]]
if (( free < needed + needed / 20 + 10485760 )); then
  echo 'cupid_backup_skipped: insufficient space for snapshot plus 10 GiB reserve' >&2
  exit 1
fi
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dest="$base/$stamp-frozen-snapshot"
mkdir -m 700 "$dest"
active=$(systemctl is-active "$unit" || true)
if [[ "$active" == active ]]; then
  [[ $(systemctl show "$unit" -p FreezerState --value) == running ]]
  : > "$marker"
  systemctl freeze "$unit"
  [[ $(systemctl show "$unit" -p FreezerState --value) == frozen ]]
fi
# No process restart and no settings import. Capture a crash-consistent point
# while all Chrome processes are frozen, then resume before compression/checks.
timeout -k 5s 30s tar -C /var/lib/cupid-browser -cf "$dest/browser-state.tar.partial" profile extension
thaw_owned
mv "$dest/browser-state.tar.partial" "$dest/browser-state.tar"
sha256sum "$dest/browser-state.tar" > "$dest/SHA256SUMS"
tar -tf "$dest/browser-state.tar" >/dev/null
printf '%s\n' 'Frozen process snapshot; archive and checksum verified. No browser login restore test performed.' > "$dest/README.txt"
printf 'cupid_backup_created: %s\n' "$dest"
