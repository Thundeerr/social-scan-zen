# Cupid operations

These helpers observe the existing server browser and keep recovery snapshots.
They do not send DMs, import settings, start paid generation, or change vendor limits.

`cupid-health.timer` runs every five minutes. The root-only status file is
`/var/lib/cupid-health/status.json`; the journal records changed issue sets.
The reader validates complete LevelDB WAL records without opening/locking the
browser database and outputs only operational fields. Compacted/missing values
remain unknown. Fresh scanning is not proof of login validity, available credits,
or delivery. No external notification recipient has been added.

`cupid-backup.timer` takes a weekly snapshot Sunday at06:00 Europe/Berlin.
The browser process group is briefly frozen for a bounded archive capture, then
thawed without a restart. Cleanup tracks ownership and retries on service exit.
Archives stay root-only under `/var/backups/cupid-browser`; none are automatically
deleted. The job reserves estimated snapshot size plus10GiB free space, then
verifies the archive and checksum. These are crash-consistent snapshots; a real
browser-login restore has not been tested. Restore only into an isolated profile
during maintenance, never over the active browser.

Server validation on2026-11-06:19 Python/shell regressions passed, systemd unit
verification passed, both timers enabled, a new archive created successfully,
Chrome returned to `FreezerState=running` with zero restarts. Latest verified
archive: `/var/backups/cupid-browser/20261106T183909Z-frozen-snapshot/browser-state.tar`.

Read status:

```sh
sudo cat /var/lib/cupid-health/status.json
systemctl list-timers cupid-health.timer cupid-backup.timer
sudo journalctl -u cupid-health.service -u cupid-backup.service --since today
```

Install the matching `.service`, `.timer`, Python and shell files, preserving
the existing Cupid services. Create `/var/lib/cupid-health` and backup directory
with mode0700. Validate with `systemd-analyze verify`, then reload systemd.
Roll back this addition by disabling the two new timers; keep existing backups
and the original Cupid browser services. If a backup is active, stop it and
verify the Chrome freezer state before removing its cleanup helper.
