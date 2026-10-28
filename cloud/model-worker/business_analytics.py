"""Accounting only: never imports worker.py or submits predictions.

The systemd service reads existing credentials from the stopped/running container
configuration. Only normalized accounting records leave the VPS, never the key.
"""
import datetime as dt
import json
import subprocess
import urllib.request
from zoneinfo import ZoneInfo

ORIGIN = "https://instascanner.app/api/public/business-report/wavespeed"

def request(url, token, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={
        "Authorization": "Bearer " + token, "Content-Type": "application/json"})
    # Do not forward credentials through redirects.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as response:
        return json.load(response)

def collect(key, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    local = now.astimezone(ZoneInfo("Europe/Berlin"))
    start = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    records = {}
    for page in range(1, 101):
        result = request("https://api.wavespeed.ai/api/v3/billings/search", key, {
            "page": page, "page_size": 100, "sort": "created_at ASC",
            "start_time": start.isoformat(), "end_time": now.isoformat()})
        if result.get("code") != 200:
            raise ValueError("Billing request failed")
        data = result["data"]
        if data.get("page") != page or not isinstance(data.get("has_more"), bool) or not isinstance(data.get("items"), list):
            raise ValueError("Incomplete pagination")
        for item in data["items"]:
            record = {"id": item["uuid"], "type": item["billing_type"],
                      "usd": item["price"], "at": item["created_at"],
                      "task": (item.get("prediction") or {}).get("uuid")}
            if record["id"] in records and records[record["id"]] != record:
                raise ValueError("Inconsistent billing record")
            records[record["id"]] = record
        if not data["has_more"]:
            break
    else:
        raise ValueError("Billing pagination limit reached")
    balance = request("https://api.wavespeed.ai/api/v3/balance", key)
    if balance.get("code") != 200:
        raise ValueError("Balance request failed")
    return {"month": local.strftime("%Y-%m"), "observed": now.isoformat(),
            "balance": balance["data"]["balance"], "records": list(records.values())}

def main():
    config = json.loads(subprocess.check_output(["docker", "inspect", "kiikii-model-worker"]))[0]
    env = dict(v.split("=", 1) for v in config["Config"]["Env"])
    token = env["PIPELINE_WORKER_TOKEN"]
    if not request(ORIGIN, token).get("needed"):
        print("Accounting already current; no provider request.")
        return
    try:
        payload = collect(env["WAVESPEED_API_KEY"])
        result = request(ORIGIN, token, payload)
        if not result.get("ok"):
            raise ValueError("Accounting not saved")
        print("Accounting verified and saved; records:", len(payload["records"]))
    except Exception:
        try:
            request(ORIGIN, token, {"error": True})
        except Exception:
            pass
        # Never print raw exceptions, response bodies, tokens or request headers.
        raise SystemExit("Accounting refresh failed; previous values retained.")

if __name__ == "__main__":
    main()
