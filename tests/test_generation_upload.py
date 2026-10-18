import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("source_upload",
    Path(__file__).resolve().parents[1] / "cloud/model-worker/source_upload.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class UploadTest(unittest.TestCase):
    def test_authenticated_download_and_hash(self):
        body = b"sample video bytes"
        job = {"id": "11111111-1111-4111-8111-111111111111",
               "lease": "22222222-2222-4222-8222-222222222222",
               "source_sha256": hashlib.sha256(body).hexdigest()}
        with tempfile.TemporaryDirectory() as folder, patch.object(module.urllib.request, "build_opener") as build:
            build.return_value.open.return_value = io.BytesIO(body)
            target = Path(folder) / "source.part"
            module.download_upload("https://example.test", "test-token", job, target)
            self.assertEqual(target.read_bytes(), body)
            request = build.return_value.open.call_args.args[0]
            self.assertTrue(request.full_url.startswith("https://example.test/api/model-pipeline/source?"))
            self.assertEqual(request.get_header("Authorization"), "Bearer test-token")
            build.return_value.open.return_value = io.BytesIO(b"different bytes")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                module.download_upload("https://example.test", "test-token", job, Path(folder) / "bad.part")
    def test_reject_redirects(self):
        with self.assertRaisesRegex(ValueError, "redirects"):
            module.NoRedirect().redirect_request(None)
    def test_reject_invalid_job_before_network(self):
        with self.assertRaises(ValueError):
            module.download_upload("https://example.test", "test", {"id": "../secret"}, Path("unused"))

if __name__ == "__main__":
    unittest.main()
