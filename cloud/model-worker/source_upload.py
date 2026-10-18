"""Download a private upload through the authenticated application, never an arbitrary URL."""
import hashlib
import time
import urllib.parse
import urllib.request
import uuid

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("Source redirects are not allowed")

def download_upload(origin, token, job, target):
    query = urllib.parse.urlencode({"id": str(uuid.UUID(job["id"])), "lease": str(uuid.UUID(job["lease"]))})
    request = urllib.request.Request(origin + "/api/model-pipeline/source?" + query,
                                     headers={"Authorization": "Bearer " + token})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    digest = hashlib.sha256()
    size = 0
    deadline = time.monotonic() + 150
    with opener.open(request, timeout=25) as response, target.open("xb") as output:
        while True:
            if time.monotonic() > deadline:
                raise ValueError("Source timeout")
            block = response.read(256 * 1024)
            if not block:
                break
            size += len(block)
            if size > 40 * 1024 * 1024:
                raise ValueError("Source exceeds limit")
            digest.update(block)
            output.write(block)
    if not size or digest.hexdigest() != job["source_sha256"]:
        raise ValueError("Source hash mismatch")
