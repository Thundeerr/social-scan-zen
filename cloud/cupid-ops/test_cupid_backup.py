"""Exercise backup failure paths with temporary files and fake systemctl only."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


def bash_path():
    git_bash = Path("C:/Program Files/Git/bin/bash.exe")
    return str(git_bash) if git_bash.exists() else shutil.which("bash")


@unittest.skipUnless(bash_path(), "bash unavailable")
class BackupTests(unittest.TestCase):
    def run_backup(self, *, state="running", tar_error=False, thaw_error=False,
                   free="30000000", needed="1000", marker=False, cleanup=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = root / "backups"
            base.mkdir()
            commands = root / "bin"
            commands.mkdir()
            (root / "state").write_text(state)
            if marker:
                (base / ".backup-freeze-owned").touch()
            fake = r'''#!/usr/bin/env bash
case "${0##*/}" in
systemctl)
  echo "$*" >> "$TEST_ROOT/calls"
  case "$1" in
    is-active) echo active;;
    show) cat "$TEST_ROOT/state";;
    freeze) echo frozen > "$TEST_ROOT/state";;
    thaw) [[ "$THAW_ERROR" == 1 ]] && exit 1; echo running > "$TEST_ROOT/state";;
  esac;;
df) printf 'Filesystem 1024-blocks Used Available Capacity Mounted\nx 1 1 %s 1%% /\n' "$FREE";;
du) printf '%s profile\n' "$NEEDED";;
tar)
  [[ "$TAR_ERROR" == 1 ]] && exit 2
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == -cf ]]; then printf 'archive' > "$2"; break; fi
    shift
  done;;
esac
'''
            for name in ("systemctl", "df", "du", "tar"):
                target = commands / name
                target.write_text(fake, newline="\n")
                target.chmod(0o700)
            source = Path(__file__).with_name("cupid-backup.sh").read_text()
            script = root / "backup.sh"
            script.write_text(source.replace("/var/backups/cupid-browser", base.as_posix()), newline="\n")
            env = {**os.environ, "TEST_ROOT": root.as_posix(), "THAW_ERROR": "1" if thaw_error else "0",
                   "TAR_ERROR": "1" if tar_error else "0", "FREE": free, "NEEDED": needed}
            # Git Bash translates inherited Windows PATH. Export the test prefix
            # inside bash so fake systemctl cannot be confused with a real one.
            invocation = 'export PATH="$TEST_ROOT/bin:$PATH"; exec bash "$TEST_ROOT/backup.sh"'
            if cleanup:
                invocation += " --thaw-owned"
            result = subprocess.run([bash_path(), "-c", invocation], env=env, capture_output=True, text=True, timeout=15)
            return {"code": result.returncode, "state": (root / "state").read_text().strip(),
                    "marker": (base / ".backup-freeze-owned").exists(),
                    "calls": (root / "calls").read_text() if (root / "calls").exists() else "",
                    "stderr": result.stderr, "archives": len(list(base.glob("*/browser-state.tar")))}

    def test_success_resumes_browser_and_removes_only_marker(self):
        result = self.run_backup()
        self.assertEqual(result["code"], 0, result)
        self.assertEqual(result["state"], "running")
        self.assertFalse(result["marker"])
        self.assertEqual(result["archives"], 1)

    def test_tar_failure_always_resumes_owned_freeze(self):
        result = self.run_backup(tar_error=True)
        self.assertNotEqual(result["code"], 0)
        self.assertEqual(result["state"], "running")
        self.assertFalse(result["marker"])

    def test_preexisting_freeze_is_not_ours_to_thaw(self):
        result = self.run_backup(state="frozen")
        self.assertNotEqual(result["code"], 0)
        self.assertEqual(result["state"], "frozen")
        self.assertNotIn("thaw", result["calls"])

    def test_failed_thaw_cannot_claim_success_and_retains_recovery_marker(self):
        result = self.run_backup(thaw_error=True)
        self.assertNotEqual(result["code"], 0)
        self.assertEqual(result["state"], "frozen")
        self.assertTrue(result["marker"])
        self.assertEqual(result["archives"], 0)

    def test_stop_cleanup_recovers_only_owned_freeze(self):
        result = self.run_backup(state="frozen", marker=True, cleanup=True)
        self.assertEqual(result["code"], 0)
        self.assertEqual(result["state"], "running")
        self.assertFalse(result["marker"])
        untouched = self.run_backup(state="frozen", cleanup=True)
        self.assertEqual(untouched["state"], "frozen")
        self.assertNotIn("thaw", untouched["calls"])

    def test_space_reserve_includes_complete_snapshot_size(self):
        result = self.run_backup(free="12000000", needed="3000000")
        self.assertNotEqual(result["code"], 0)
        self.assertNotIn("freeze", result["calls"])


if __name__ == "__main__":
    unittest.main()
