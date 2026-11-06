"""Read-only Cupid health observations. Never opens/locks the live LevelDB.

Only complete WAL batches are read. SST/compacted-only values are unknown, not
healthy. Stored output contains only allowlisted operational fields, never chat
bodies, recipient names, cookies, credentials, or vendor storage dumps.
"""
import argparse
import datetime as dt
import json
import math
from pathlib import Path
import re
import struct
import subprocess
import time

BLOCK = 32768
SERVICES = tuple(f"cupid-setup-{s}.service" for s in ("chrome", "display", "vnc", "web"))
DATABASE = Path("/var/lib/cupid-browser/profile/Default/Local Extension Settings/agiianhjoknekpojmphjgolbjdkacidn")
STATE = Path("/var/lib/cupid-health/status.json")


def crc32c(data):
    crc = 0xFFFFFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ (0x82F63B78 if crc & 1 else 0)
    return crc ^ 0xFFFFFFFF


def varint(data, pos):
    value = 0
    for shift in range(0, 70, 7):
        if pos >= len(data):
            raise ValueError("partial varint")
        byte = data[pos]
        pos += 1
        value |= (byte & 127) << shift
        if byte < 128:
            return value, pos
    raise ValueError("oversized varint")


def field(data, pos):
    length, pos = varint(data, pos)
    if length > len(data) - pos:
        raise ValueError("partial field")
    return data[pos:pos + length], pos + length


def batches(data):
    """Yield complete LevelDB logical records; ignore a partially written tail."""
    pos, fragment = 0, None
    while pos + 7 <= len(data):
        if BLOCK - pos % BLOCK < 7:
            pos += BLOCK - pos % BLOCK
            continue
        checksum, length, kind = struct.unpack_from("<IHB", data, pos)
        if length > BLOCK - pos % BLOCK - 7 or pos + 7 + length > len(data):
            break
        pos += 7
        payload = data[pos:pos + length]
        pos += length
        actual = crc32c(bytes([kind]) + payload)
        masked = (((actual >> 15) | (actual << 17)) + 0xA282EAD8) & 0xFFFFFFFF
        if checksum != masked:
            fragment = None
            continue
        if kind == 1:
            fragment = None
            yield payload
        elif kind == 2:
            fragment = bytearray(payload)
        elif kind == 3 and fragment is not None:
            fragment.extend(payload)
        elif kind == 4 and fragment is not None:
            fragment.extend(payload)
            yield bytes(fragment)
            fragment = None
        else:
            fragment = None


def changes(batch):
    if len(batch) < 12:
        raise ValueError("short batch")
    sequence, count = struct.unpack_from("<QI", batch)
    if count > 100000:
        raise ValueError("oversized batch")
    result, pos = [], 12
    for index in range(count):
        if pos >= len(batch):
            raise ValueError("partial batch")
        tag = batch[pos]
        key, pos = field(batch, pos + 1)
        if tag == 1:
            value, pos = field(batch, pos)
        elif tag == 0:
            value = None
        else:
            raise ValueError("invalid tag")
        result.append((sequence + index, key.decode("utf-8"), value))
    if pos != len(batch):
        raise ValueError("trailing bytes")
    return result


def read_wal(directory):
    latest = {}
    for path in sorted(directory.glob("*.log")):
        try:
            if path.stat().st_size > 64 * 1024 * 1024:
                continue
            for batch in batches(path.read_bytes()):
                try:
                    parsed = changes(batch)
                except (ValueError, UnicodeError):
                    continue
                for sequence, key, value in parsed:
                    if sequence > latest.get(key, (-1, None))[0]:
                        latest[key] = (sequence, value)
        except OSError:
            continue  # Compaction can remove a file between listing and reading.
    output = {}
    for key, (_, value) in latest.items():
        if value is not None:
            try:
                output[key] = json.loads(value)
            except (ValueError, UnicodeError):
                pass
    return output


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def assess(observation, now):
    issues = []
    if observation.get("services_active") is not True:
        issues.append("service_not_running")
    scan = observation.get("last_scan_epoch_ms")
    age = None
    if numeric(scan) and scan > 0:
        age = (now * 1000 - scan) / 1000
        if age < -300:
            issues.append("invalid_future_scan_time")
        elif age > 1800:
            issues.append("scan_stale")
    else:
        issues.append("scan_unavailable")
    phase = observation.get("bot_phase")
    if phase in ("off", "paused", "stopped", "disabled"):
        issues.append("bot_paused")
    elif phase not in ("chatting", "scanning", "running", "waiting", "idle"):
        issues.append("bot_state_unavailable")
    credits = observation.get("credits_remaining")
    if numeric(credits) and credits <= 0:
        issues.append("credits_empty")
    return {**observation, "scan_age_seconds": round(age) if age is not None else None,
            "status": "attention" if issues else "observed_active",
            "issues": sorted(issues),
            "login_verified": False,
            "delivery_verified": False,
            "checked_at": dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat()}


def observe(values):
    # Filled from verified vendor keys, never search or serialize arbitrary values.
    result = {"last_scan_epoch_ms": None, "bot_phase": None, "credits_remaining": None}
    for key in ("instagramLastConversationScan",):
        if numeric(values.get(key)):
            result["last_scan_epoch_ms"] = values[key]
    status = values.get("instagramReactStatus")
    if isinstance(status, str):
        phase = status.split("|", 1)[0].lower()
        if re.fullmatch(r"[a-z_]{1,30}", phase):
            result["bot_phase"] = phase
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--inspect-keys", action="store_true", help="Only operational key names; never values")
    parser.add_argument("--stdout", action="store_true")
    args = parser.parse_args()
    values = read_wal(DATABASE)
    if args.inspect_keys:
        print(json.dumps(sorted(k for k in values if re.fullmatch(r"[A-Za-z_]{1,70}", k)
                                and re.search(r"status|scan|credit|actiontotal|enabled|running", k, re.I))))
        return
    statuses = [subprocess.run(["systemctl", "is-active", unit], capture_output=True, text=True).stdout.strip()
                for unit in SERVICES]
    result = assess({**observe(values), "services_active": all(s == "active" for s in statuses)}, time.time())
    if args.stdout:
        print(json.dumps(result, sort_keys=True))
        return
    STATE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    previous = {}
    try:
        previous = json.loads(STATE.read_text())
    except (OSError, ValueError):
        pass
    temporary = STATE.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, sort_keys=True) + "\n")
    temporary.chmod(0o600)
    temporary.replace(STATE)
    if previous.get("issues") != result["issues"]:
        print(json.dumps({"event": "cupid_health_changed", "status": result["status"], "issues": result["issues"]}))


if __name__ == "__main__":
    main()
