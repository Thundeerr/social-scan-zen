import json
from pathlib import Path
import struct
import tempfile
import unittest
from cupid_health import assess, batches, changes, crc32c, observe, read_wal


def varint(value):
    out = bytearray()
    while value >= 128:
        out.append((value & 127) | 128)
        value >>= 7
    return bytes(out) + bytes([value])


def batch(sequence, key, value=None):
    key = key.encode()
    record = bytes([0 if value is None else 1]) + varint(len(key)) + key
    if value is not None:
        value = json.dumps(value).encode()
        record += varint(len(value)) + value
    return struct.pack("<QI", sequence, 1) + record


def frame(record, kind=1):
    crc = crc32c(bytes([kind]) + record)
    crc = (((crc >> 15) | (crc << 17)) + 0xA282EAD8) & 0xFFFFFFFF
    return struct.pack("<IHB", crc, len(record), kind) + record


class HealthTests(unittest.TestCase):
    def test_inactive_services_are_not_healthy(self):
        self.assertIn("service_not_running", assess({"services_active": False}, 10000)["issues"])

    def test_unknown_state_is_not_healthy(self):
        result = assess({"services_active": True}, 10000)
        self.assertIn("scan_unavailable", result["issues"])
        self.assertIn("bot_state_unavailable", result["issues"])

    def test_stale_future_and_zero_scan(self):
        for scan, issue in [(1, "scan_stale"), (20000000, "invalid_future_scan_time"), (0, "scan_unavailable")]:
            self.assertIn(issue, assess({"last_scan_epoch_ms": scan}, 10000)["issues"])

    def test_pause_and_zero_credits(self):
        result = assess({"bot_phase": "paused", "credits_remaining": 0}, 10000)
        self.assertIn("bot_paused", result["issues"])
        self.assertIn("credits_empty", result["issues"])

    def test_active_observation_does_not_assert_delivery(self):
        result = assess({"services_active": True, "last_scan_epoch_ms": 9999000, "bot_phase": "chatting"}, 10000)
        self.assertEqual(result["issues"], [])
        self.assertFalse(result["login_verified"])
        self.assertFalse(result["delivery_verified"])

    def test_private_fields_never_leave_observation(self):
        result = observe({"instagramReactStatus": "chatting|Sending message to PRIVATE_NAME",
                          "instagramLastConversationScan": 9999000, "token": "SECRET", "messages": ["PRIVATE_BODY"]})
        encoded = json.dumps(result)
        self.assertNotIn("PRIVATE", encoded)
        self.assertNotIn("SECRET", encoded)
        self.assertEqual(result["bot_phase"], "chatting")

    def test_unknown_vendor_format_remains_unknown(self):
        self.assertIsNone(observe({"instagramReactStatus": {"new": "format"}})["bot_phase"])

    def test_crc32c_known_vector(self):
        self.assertEqual(crc32c(b"123456789"), 0xE3069283)

    def test_complete_and_partial_records(self):
        record = batch(20, "instagramLastConversationScan", 10000)
        self.assertEqual(list(batches(frame(record))), [record])
        self.assertEqual(list(batches(frame(record)[:-1])), [])

    def test_corrupt_records_are_ignored(self):
        record = bytearray(frame(batch(20, "instagramReactStatus", "chatting")))
        record[-1] ^= 1
        self.assertEqual(list(batches(record)), [])

    def test_partial_logical_record_and_full_fragment(self):
        record = batch(20, "instagramReactStatus", "chatting")
        self.assertEqual(list(batches(frame(record[:5], 2))), [])
        self.assertEqual(list(batches(frame(record[:5], 2) + frame(record[5:], 4))), [record])

    def test_incomplete_batch_is_atomic(self):
        with self.assertRaises(ValueError):
            changes(batch(20, "key", "value")[:-1])

    def test_latest_sequence_and_delete_win(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "000001.log").write_bytes(frame(batch(30, "instagramReactStatus", "paused")))
            (root / "000002.log").write_bytes(frame(batch(20, "instagramReactStatus", "chatting")))
            self.assertEqual(read_wal(root)["instagramReactStatus"], "paused")
            (root / "000003.log").write_bytes(frame(batch(31, "instagramReactStatus")))
            self.assertNotIn("instagramReactStatus", read_wal(root))


if __name__ == "__main__":
    unittest.main()
