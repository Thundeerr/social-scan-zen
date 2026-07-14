## What the probe actually revealed

You were right — this isn't "nobody posted", it's a fetching failure the app is silently swallowing.

The endpoint is being hit, auth is correct, and it returns HTTP 200 — but the body is:

```
{ "edges": [], "page_info": {...}, "attempts": "18" }
```

`attempts: "18"` is `instagram-looter2` telling us its upstream Instagram scrape retried 18 times and gave up. The provider itself failed silently. Our code sees `edges: []` and records a normal "No new assets · 0 already archived" completed run — so from the operator's seat it looks like the network is quiet, when actually the provider is dead in the water for location feeds.

The parser is fine. The endpoint path is fine. The issue is:
1. **The response shape is different** — `edges` isn't in our fallback key list (we look for `items/posts/medias/data/edges/results` at the root, but the recursive `collectPostLike` walker never triggers because `edges` IS technically found as an array — it's just empty).
2. **Empty-with-high-attempts is a provider failure**, not a legitimate empty result — we should mark the run failed, not completed.
3. **`tab=ranked`** (currently in `RAPIDAPI_LOCATION_EXTRA_PARAMS`) is the harder tab for looter2 to scrape. `tab=recent` is far more reliable on this host.
4. **Zero-post completions overwrite the diagnostic hint** — after the scan, `phase_detail` becomes `"No new assets · 0 already archived"` and the top-level keys hint from the parsing phase is lost, so the DB shows nothing useful.

## Plan

1. **Retry with `tab=recent` before giving up.**  
   In `fetchLocation`, if the first call returns `edges: []` (or `posts` length 0) AND the response contains an `attempts` field > 1, retry the same URL with `tab=recent` (dropping any conflicting tab from `locationExtraParams`). If that also returns empty, try one more time with no `tab` at all.

2. **Detect and surface provider-side failures.**  
   When the response body has `edges: []` and a numeric `attempts` field ≥ 3 after all retries, treat it as a provider failure — throw a clean error like `Provider returned no data after 18 upstream attempts (tab=ranked/recent). Location feed endpoint is currently unreliable on this host.` This flips the run to `failed` with a meaningful reason instead of a fake "completed / 0 assets" success.

3. **Persist the response-shape hint after 0-post completed runs.**  
   In `executeLocationScan`, when the run legitimately completes with 0 posts (no provider-side retry storm — real empty), keep the shape summary in `phase_detail`: `"No new assets · shape=[edges,page_info,attempts] · attempts=18"`. So future zero-post runs are self-diagnosing without needing to click Probe.

4. **UI: show the real failure on the Scanner page.**  
   Recent Runs and the Queue already display `error` for failed rows — this comes for free once step 2 flips these to `failed`. Operator instantly sees "Provider returned no data after 18 upstream attempts" instead of a silent success.

5. **Verify with the existing Probe button.**  
   After the change, click Probe once — response should now include one of:
   - `Parsed posts` > 0 (recent tab worked → real fix), or
   - the probe still shows empty, but the next real scan will be marked `failed` with a clear message (correct diagnosis surfaced).

## Technical notes

- Files touched: `src/lib/instagram-provider.server.ts` (retry logic in `fetchLocation` + `probeLocation`), `src/lib/scanner-service.server.ts` (persist shape hint in the terminal `phase_detail`).
- Zero DB migrations. Zero UI changes — the Scanner page already renders `run.error` for failed rows.
- The `attempts` field is a looter2-specific tell but harmless to check for on other hosts (missing → treated as 0 → no false positives).
- No new secrets. If step 1 works, you can also drop `tab=ranked` from `RAPIDAPI_LOCATION_EXTRA_PARAMS` later; the fallback chain keeps it working either way.

## What you'll see when this is done

Either the Asset Inbox starts filling because `tab=recent` succeeds where `ranked` fails — or the Scanner page immediately shows every location marked `failed` with `"Provider returned no data after 18 upstream attempts"`, at which point we know the fix isn't in your code, it's a host swap (looter2's location feed is broken today; pick another RapidAPI Instagram host for locations).
